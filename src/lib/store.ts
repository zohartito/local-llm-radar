/**
 * Shared persistence layer (Upstash Redis) — fusion opus4.8-gpt5.5 spec.
 *
 * Three coordinated uses on ONE free Upstash database:
 *   1. Shared hot cache + single-flight refresh lock — fixes the cross-instance /
 *      cold-start duplication that hammers HuggingFace into HTTP 429s. Only the
 *      lock winner re-fetches all sources; every other serverless instance reads
 *      the shared blob. Soft-TTL: the key lives for days but freshness is gated by
 *      `freshUntil` inside the value, so during a 429 storm instances serve the
 *      last-good shared data instead of all collapsing to a live re-fetch.
 *   2. Compact daily rank snapshots — a tiny per-day time-series that powers the
 *      week-over-week "Trend" deltas.
 *   3. Per-model scorecard cache, coalescing lease, and public rate budget.
 *
 * Deployed live paths require a complete Redis credential pair — either
 * UPSTASH_REDIS_REST_URL/_TOKEN (hand-configured Upstash) or KV_REST_API_URL/
 * _TOKEN (Vercel Upstash marketplace integration). Missing or failed Redis is
 * represented explicitly and callers fail closed; Jest injects a fake client
 * through setPersistenceForTests instead of exercising a local coordination
 * fallback.
 */
import { Redis } from '@upstash/redis';
import { SCORING_VERSION } from './merge-models';
import { buildCategoryRankings, CATEGORY_DEFINITIONS } from './leaderboard';
import { isValidScorecard } from './scorecard-schema';
import { isValidCachedLeaderboard, isValidRankMap } from './leaderboard-cache-schema';
import { SNAPSHOT_FRESH_MS, snapshotExpired } from './trust';
import type { LeaderboardData } from './leaderboard';

export { isValidScorecard } from './scorecard-schema';

const KEY_PREFIX = 'llmr:v2'; // v2 tracks SCORING_VERSION; bump to abandon old blobs
// Rolling deployments and previews must not overwrite another method’s current snapshot.
const CACHE_KEY = `${KEY_PREFIX}:leaderboard:${SCORING_VERSION}:current`;
const LOCK_KEY = `${KEY_PREFIX}:refresh:${SCORING_VERSION}:lock`;
const SCORECARD_CACHE_PREFIX = `${KEY_PREFIX}:scorecard:`;
const SCORECARD_RATE_PREFIX = `${KEY_PREFIX}:scorecard-rate:`;
const SCORECARD_LEASE_PREFIX = `${KEY_PREFIX}:scorecard-lease:`;
const SCORECARD_LEASE_TTL_S = 30;
const SCORECARD_POSITIVE_TTL_MS = 15 * 60 * 1000;
const SCORECARD_NEGATIVE_TTL_MS = 60 * 1000;
const SNAP_INDEX = `${KEY_PREFIX}:snapshots:dates`;
const snapKey = (date: string) => `${KEY_PREFIX}:snapshot:${date}`;

const FRESH_MS = SNAPSHOT_FRESH_MS; // logical freshness window (30 min — page loads stay ~half an hour behind sources at worst)
const CACHE_TTL_S = 7 * 24 * 60 * 60; // Redis key lifetime (serve-stale headroom)
const LOCK_TTL_S = 120; // refresh lock self-expiry
const SNAP_TTL_S = 400 * 24 * 60 * 60; // ~13 months of history

export type RefreshLockResult =
  | { state: 'acquired'; token: string }
  | { state: 'contended' }
  | { state: 'unavailable' };
export type ScorecardLeaseResult = RefreshLockResult;
export type SharedScorecardRead<T> =
  | { state: 'hit'; value: T; pttlMs: number }
  | { state: 'miss' }
  | { state: 'unavailable' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Upstash may deserialize the first EVAL array member before returning it.
 * Scorecard entries are always the one-field `{ value }` envelope written below;
 * accept either transport shape, but never treat an arbitrary Redis value as one. */
function decodeScorecardCacheEnvelope(value: unknown): Record<string, unknown> | null {
  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  if (!isRecord(parsed) || !Object.hasOwn(parsed, 'value') || Object.keys(parsed).length !== 1) return null;
  const cachedValue = parsed.value;
  return cachedValue === null || isValidScorecard(cachedValue) ? parsed : null;
}

let _redis: Redis | null | undefined;
export function setPersistenceForTests(redis: Redis | null | undefined): void {
  _redis = redis;
}
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  // Two supported provisioning paths. Each is resolved as a COMPLETE pair, so a
  // half-configured environment still fails closed instead of pairing a URL from
  // one source with a token from the other:
  //   1. Hand-configured Upstash project → UPSTASH_REDIS_REST_URL/_TOKEN
  //   2. Vercel Upstash marketplace integration → KV_REST_API_URL/_TOKEN
  // Redis.fromEnv() only reads (1), which silently left marketplace-provisioned
  // deployments with no Redis at all — and therefore permanently on the curated
  // fallback, since a missing lock aborts the refresh before any source fetch.
  const credentials =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
      ? { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }
      : process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
        ? { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN }
        : null;
  _redis = credentials ? new Redis(credentials) : null;
  return _redis;
}

export function isPersistenceEnabled(): boolean {
  return getRedis() !== null;
}

interface StoredCache {
  data: LeaderboardData;
  writtenAt?: number; // absent on blobs written before this field shipped
  freshUntil: number;
  staleUntil: number;
  scoringVersion: string;
}

export interface SharedCacheHit {
  data: LeaderboardData;
  writtenAt: number;
  stale: boolean;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
function epochDayOf(date: string): number {
  return Math.floor(Date.parse(date) / 86_400_000);
}

// ---- Shared hot cache -------------------------------------------------------

export async function readSharedCache(
  opts: { allowStale?: boolean } = {},
): Promise<SharedCacheHit | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const entry = await r.get<StoredCache>(CACHE_KEY);
    if (!entry || !isValidCachedLeaderboard(entry.data)) return null;
    if (entry.scoringVersion !== SCORING_VERSION ||
        (entry.data.scoringVersion !== undefined && entry.data.scoringVersion !== SCORING_VERSION)) return null;
    const now = Date.now();
    const writtenAt = entry.writtenAt ?? entry.freshUntil - FRESH_MS;
    if (![writtenAt, entry.freshUntil, entry.staleUntil].every(Number.isFinite) ||
        writtenAt < 0 || writtenAt > now || entry.freshUntil <= writtenAt ||
        entry.freshUntil > writtenAt + FRESH_MS || entry.staleUntil < entry.freshUntil ||
        entry.staleUntil > writtenAt + CACHE_TTL_S * 1000 || Date.parse(entry.data.updated) > writtenAt) return null;
    const stale = now >= entry.freshUntil || snapshotExpired(entry.data.dataDate ?? entry.data.updated, now);
    if (stale && !opts.allowStale) return null;
    if (Date.now() >= entry.staleUntil) return null;
    // writtenAt lets callers preserve the blob's REAL age instead of
    // restarting the clock on promotion to their local cache (which would
    // let 30-minute data live for nearly an hour). Older blobs derive it.
    return { data: entry.data, writtenAt, stale };
  } catch {
    return null; // a Redis hiccup must never break the read path
  }
}

export async function writeSharedCache(data: LeaderboardData, token: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  const now = Date.now();
  const entry: StoredCache = {
    data,
    writtenAt: now,
    freshUntil: now + FRESH_MS,
    staleUntil: now + CACHE_TTL_S * 1000,
    scoringVersion: SCORING_VERSION,
  };
  try {
    // Ownership must still hold at publication time, not merely before fetching.
    const result = await r.eval(
      'if redis.call("get", KEYS[1]) ~= ARGV[1] then return 0 end; redis.call("set", KEYS[2], ARGV[2], "EX", ARGV[3]); return 1',
      [LOCK_KEY, CACHE_KEY], [token, JSON.stringify(entry), String(CACHE_TTL_S)],
    );
    return Number(result) === 1;
  } catch {
    return false;
  }
}

// ---- Single-flight refresh lock --------------------------------------------

// Missing, partial, or unavailable Redis is never a local-lock fallback. That
// would make a serverless fleet lose its only distributed coordination boundary.
export async function acquireRefreshLock(): Promise<RefreshLockResult> {
  const r = getRedis();
  if (!r) return { state: 'unavailable' };
  const token = crypto.randomUUID();
  try {
    const ok = await r.set(LOCK_KEY, token, { nx: true, ex: LOCK_TTL_S });
    return ok === 'OK' ? { state: 'acquired', token } : { state: 'contended' };
  } catch {
    return { state: 'unavailable' };
  }
}

// Compare-and-delete so one request can't release another request's lock.
export async function releaseRefreshLock(token: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
      [LOCK_KEY],
      [token],
    );
  } catch {
    /* lock self-expires via TTL */
  }
}

// ---- Shared per-model scorecard cache and public rate budget ---------------

export async function readSharedScorecard<T>(modelId: string): Promise<SharedScorecardRead<T>> {
  const r = getRedis();
  if (!r) return { state: 'unavailable' };
  const key = `${SCORECARD_CACHE_PREFIX}${encodeURIComponent(modelId)}`;
  try {
    // GET + PTTL must be one atomic operation: separate calls can observe a new
    // cache generation with an old TTL (or the reverse) and over-cache it locally.
    const result = await r.eval(
      'local v=redis.call("get", KEYS[1]); if not v then return {false, -2} end; return {v, redis.call("pttl", KEYS[1])}',
      [key], [],
    ) as unknown;
    if (!Array.isArray(result) || result.length !== 2) return { state: 'unavailable' };
    const [serialized, pttlMs] = result;
    // Redis Lua's `false` becomes null in some Upstash response paths. These
    // are the only two valid cache-miss representations, and only with PTTL -2.
    if (serialized === false || serialized === null) {
      return pttlMs === -2 ? { state: 'miss' } : { state: 'unavailable' };
    }
    const entry = decodeScorecardCacheEnvelope(serialized);
    if (!entry || !Number.isSafeInteger(pttlMs) || pttlMs <= 0) return { state: 'unavailable' };
    const maxTtlMs = entry.value === null ? SCORECARD_NEGATIVE_TTL_MS : SCORECARD_POSITIVE_TTL_MS;
    if (pttlMs > maxTtlMs) return { state: 'unavailable' };
    return { state: 'hit', value: entry as T, pttlMs };
  } catch { return { state: 'unavailable' }; }
}

export async function acquireScorecardLease(modelId: string, ttlSeconds = SCORECARD_LEASE_TTL_S): Promise<ScorecardLeaseResult> {
  const r = getRedis();
  if (!r) return { state: 'unavailable' };
  const token = crypto.randomUUID();
  try {
    const ok = await r.set(`${SCORECARD_LEASE_PREFIX}${encodeURIComponent(modelId)}`, token, { nx: true, ex: ttlSeconds });
    return ok === 'OK' ? { state: 'acquired', token } : { state: 'contended' };
  } catch { return { state: 'unavailable' }; }
}

/** Fence the cache write behind the lease token. A late fetcher whose lease
 * expired cannot publish an old result over the new lease generation. */
export async function writeScorecardIfLeaseOwner<T>(modelId: string, token: string, value: T, ttlSeconds: number): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    const result = await r.eval(
      'if redis.call("get", KEYS[1]) ~= ARGV[1] then return 0 end; redis.call("set", KEYS[2], ARGV[2], "EX", ARGV[3]); return 1',
      [`${SCORECARD_LEASE_PREFIX}${encodeURIComponent(modelId)}`, `${SCORECARD_CACHE_PREFIX}${encodeURIComponent(modelId)}`],
      [token, JSON.stringify(value), String(ttlSeconds)],
    );
    return Number(result) === 1;
  } catch { return false; }
}

export async function releaseScorecardLease(modelId: string, token: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
      [`${SCORECARD_LEASE_PREFIX}${encodeURIComponent(modelId)}`], [token],
    );
  } catch { /* lease expiry is the safe fallback */ }
}

/** Atomically consumes a Redis-backed budget. No Redis means deny, rather than
 * silently replacing a cross-instance control with an in-memory one. */
export type ScorecardBudgetResult = 'allowed' | 'exhausted' | 'unavailable';
export async function consumeSharedScorecardBudget(clientKey: string, limit: number, windowSeconds: number): Promise<ScorecardBudgetResult> {
  const r = getRedis();
  if (!r) return 'unavailable';
  const key = `${SCORECARD_RATE_PREFIX}${encodeURIComponent(clientKey.slice(0, 160))}`;
  try {
    const count = await r.eval(
      'local n=redis.call("incr", KEYS[1]); if n == 1 then redis.call("expire", KEYS[1], ARGV[1]) end; return n',
      [key], [String(windowSeconds)],
    ) as unknown;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) return 'unavailable';
    return count <= limit ? 'allowed' : 'exhausted';
  } catch { return 'unavailable'; }
}

/** Compatibility for callers that need only a fail-closed permission decision. */
export async function takeSharedScorecardBudget(clientKey: string, limit: number, windowSeconds: number): Promise<boolean> {
  return await consumeSharedScorecardBudget(clientKey, limit, windowSeconds) === 'allowed';
}

// ---- Daily rank snapshots ---------------------------------------------------

export interface RankSnapshot {
  date: string;
  updated: string;
  scoringVersion: string;
  quality: string;
  ranks: {
    overall: Record<string, number>;
    categories: Record<string, Record<string, number>>;
  };
}

export interface RefreshReceipt {
  attemptedAt: string;
  refreshed: boolean;
  cacheStatus: string;
  snapshotDate: string;
  sourceCount: number;
  degradedSources: string[];
  scoringVersion: string;
}

/** Durable operational evidence; no secrets or upstream response bodies. */
export async function recordCronRefresh(receipt: Omit<RefreshReceipt, 'scoringVersion'>): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const record = { ...receipt, scoringVersion: SCORING_VERSION };
  try {
    await redis.set(`${KEY_PREFIX}:cron:last-attempt`, record, { ex: SNAP_TTL_S });
    if (record.refreshed) await redis.set(`${KEY_PREFIX}:cron:last-success`, record, { ex: SNAP_TTL_S });
    return true;
  } catch { return false; }
}

export async function readCronRefreshStatus(): Promise<{ lastAttempt: RefreshReceipt | null; lastSuccess: RefreshReceipt | null }> {
  const redis = getRedis();
  if (!redis) return { lastAttempt: null, lastSuccess: null };
  try {
    const [lastAttempt, lastSuccess] = await Promise.all([
      redis.get<RefreshReceipt>(`${KEY_PREFIX}:cron:last-attempt`),
      redis.get<RefreshReceipt>(`${KEY_PREFIX}:cron:last-success`),
    ]);
    return { lastAttempt, lastSuccess };
  } catch { return { lastAttempt: null, lastSuccess: null }; }
}

function ranksFromRows(rows: Array<{ slug: string; rank: number | null }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) if (row.rank !== null) out[row.slug] = row.rank;
  return out;
}

// Write today's rank snapshot. Skips fallback days so a bad-source day never
// fabricates rank movement (consistent with the data-honesty stance). Idempotent.
export async function writeDailyRankSnapshot(data: LeaderboardData): Promise<void> {
  const r = getRedis();
  if (!r) return;
  if (!isComparableRankData(data)) return;
  if (!data.models || data.models.length === 0) return;

  const limit = data.models.length;
  const overall = ranksFromRows(buildCategoryRankings(data.models, 'overall', { limit }));
  const categories: Record<string, Record<string, number>> = {};
  for (const cat of CATEGORY_DEFINITIONS) {
    if (cat.key === 'overall') continue;
    categories[cat.key] = ranksFromRows(buildCategoryRankings(data.models, cat.key, { limit }));
  }

  const date = todayUTC();
  const snapshot: RankSnapshot = {
    date,
    updated: data.updated,
    scoringVersion: SCORING_VERSION,
    quality: 'live',
    ranks: { overall, categories },
  };

  try {
    await Promise.all([
      r.set(snapKey(date), snapshot, { ex: SNAP_TTL_S }),
      r.zadd(SNAP_INDEX, { score: epochDayOf(date), member: date }),
    ]);
  } catch {
    /* snapshot is best-effort; a miss just means no Trend for that day */
  }
}

// Return the snapshot closest to (today - daysAgo), searching a small backward
// window so a single missed cron day doesn't blank the Trend column. Null when
// there is no snapshot old enough yet (honest "no history" rather than fake 0).
export async function readRankSnapshotAround(daysAgo = 7): Promise<RankSnapshot | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const target = Math.floor(Date.now() / 86_400_000) - daysAgo;
    const members = (await r.zrange(SNAP_INDEX, target - 3, target, { byScore: true })) as string[];
    // A failed write can leave an index member without a usable value. Search
    // the complete bounded window rather than giving up on its newest member.
    if (!Array.isArray(members)) return null;
    for (const date of [...members].reverse().slice(0, 4)) {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const day = epochDayOf(date);
      if (!Number.isFinite(day) || day < target - 3 || day > target) continue;
      const snapshot = await r.get<RankSnapshot>(snapKey(date));
      if (isValidRankSnapshot(snapshot) && snapshot.date === date) return snapshot;
    }
    return null;
  } catch {
    return null;
  }
}

export function ranksForCategory(
  snapshot: RankSnapshot,
  categoryKey: string,
): Record<string, number> | null {
  if (!isValidRankSnapshot(snapshot)) return null;
  if (categoryKey === 'overall') return snapshot.ranks.overall;
  return snapshot.ranks.categories[categoryKey] ?? null;
}


/** Both sides of a movement claim must represent a healthy current-method roster. */
export function isComparableRankData(data: LeaderboardData): boolean {
  return data.scoringVersion === SCORING_VERSION && data.dataSourceLabel === 'live' &&
    !data.usedFallback && !data.stale && !data.degradedSources?.length &&
    !snapshotExpired(data.dataDate ?? data.updated);
}

function isValidRankSnapshot(value: unknown): value is RankSnapshot {
  if (!isRecord(value) || value.scoringVersion !== SCORING_VERSION || value.quality !== 'live' ||
      typeof value.date !== 'string' || typeof value.updated !== 'string' ||
      !Number.isFinite(Date.parse(value.updated)) || !isRecord(value.ranks) ||
      !isValidRankMap(value.ranks.overall) || !isRecord(value.ranks.categories)) return false;
  return Object.values(value.ranks.categories).every(isValidRankMap);
}
