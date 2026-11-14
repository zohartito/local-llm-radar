import { fetchLLMStatsModelScorecard, type LLMStatsModelScorecard } from './live-sources';
import { acquireScorecardLease, readSharedScorecard, releaseScorecardLease, takeSharedScorecardBudget, consumeSharedScorecardBudget, writeScorecardIfLeaseOwner } from './store';

const TTL_MS = 15 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 12;
const MAX_GLOBAL_REQUESTS_PER_WINDOW = 60;
const FETCH_DEADLINE_MS = 12_000;
const TTL_SAFETY_MARGIN_MS = 1_000;

type Cached = { value: LLMStatsModelScorecard | null; expiresAt: number };
export type CachedScorecard = { value: LLMStatsModelScorecard; cacheTtlSeconds: number };
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<CachedScorecard | null>>();
export class ScorecardRequestError extends Error {
  constructor(public readonly status: 429 | 503) {
    super(status === 429 ? 'Too many uncached scorecard requests' : 'Scorecard service temporarily unavailable');
  }
}

type SharedCached = { value: LLMStatsModelScorecard | null };
let scorecardFetcher: (modelId: string, opts: { signal: AbortSignal }) => Promise<LLMStatsModelScorecard | null> = fetchLLMStatsModelScorecard;

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchWithinLeaseDeadline(modelId: string): Promise<{ value: LLMStatsModelScorecard | null; timedOut: boolean }> {
  const deadlineAt = Date.now() + FETCH_DEADLINE_MS;
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);
  let deadlineTimer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<{ value: null; timedOut: true }>((resolve) => {
    deadlineTimer = setTimeout(() => resolve({ value: null, timedOut: true }), FETCH_DEADLINE_MS);
  });
  // The race is deliberate even though the signal is passed through. A fetcher
  // may ignore abort; its caller returns at 12s and retains the 30s lease until
  // expiry, preventing a second upstream fetch during that unknown tail.
  let outcome: { value: LLMStatsModelScorecard | null; timedOut: boolean };
  try {
    outcome = await Promise.race([
      scorecardFetcher(modelId, { signal: controller.signal }).then((value) => ({ value, timedOut: false })),
      deadline,
    ]);
  } finally { clearTimeout(abortTimer); clearTimeout(deadlineTimer!); }
  // Timer callback ordering is not a fencing primitive. Check the monotonic
  // deadline again before the caller attempts a lease-fenced Redis write.
  return Date.now() >= deadlineAt ? { value: null, timedOut: true } : outcome;
}

function resultFromCache(value: LLMStatsModelScorecard | null, expiresAt: number): CachedScorecard | null {
  if (!value) return null;
  const cacheTtlSeconds = Math.floor((expiresAt - Date.now()) / 1000);
  return cacheTtlSeconds > 0 ? { value, cacheTtlSeconds } : null;
}

function remember(modelId: string, value: LLMStatsModelScorecard | null, pttlMs: number): CachedScorecard | null {
  const expiresAt = Date.now() + pttlMs - TTL_SAFETY_MARGIN_MS;
  if (expiresAt <= Date.now()) return null;
  cache.set(modelId, { value, expiresAt });
  return resultFromCache(value, expiresAt);
}

/** Redis is the authoritative cross-instance cache. The in-process maps only
 * coalesce same-instance requests after that distributed boundary succeeds. */
export async function getCachedScorecard(modelId: string, clientKey = 'public-unattributed'): Promise<CachedScorecard | null> {
  const now = Date.now();
  const existing = cache.get(modelId);
  if (existing && existing.expiresAt > now) return resultFromCache(existing.value, existing.expiresAt);
  const shared = await readSharedScorecard<SharedCached>(modelId);
  if (shared.state === 'unavailable') throw new ScorecardRequestError(503);
  if (shared.state === 'hit') return remember(modelId, shared.value.value, shared.pttlMs);
  const pending = inflight.get(modelId);
  if (pending) return pending;
  const request = resolveScorecardMiss(modelId, clientKey).finally(() => inflight.delete(modelId));
  inflight.set(modelId, request);
  return request;
}

async function resolveScorecardMiss(modelId: string, clientKey: string): Promise<CachedScorecard | null> {
  const lease = await acquireScorecardLease(modelId);
  if (lease.state === 'unavailable') throw new ScorecardRequestError(503);
  if (lease.state === 'contended') {
    // A remote winner owns the fetch. Poll only its Redis result; never turn
    // contention into a second upstream request.
    for (let attempt = 0; attempt < 4; attempt++) {
      await delay(100 * (attempt + 1));
      const shared = await readSharedScorecard<SharedCached>(modelId);
      if (shared.state === 'unavailable') throw new ScorecardRequestError(503);
      if (shared.state === 'hit') return remember(modelId, shared.value.value, shared.pttlMs);
    }
    return null;
  }
  let retainLeaseUntilExpiry = false;
  try {
    // Cache hits, unknown model URLs, and followers of an in-flight fetch never
    // spend the upstream budget. Only the winning lease may start a fetch.
    const budget = await scorecardRequestBudget(clientKey);
    if (budget !== 'allowed') throw new ScorecardRequestError(budget === 'exhausted' ? 429 : 503);
    const fetched = await fetchWithinLeaseDeadline(modelId);
    // A fetcher may ignore AbortSignal and still be running after this deadline.
    // Retain the distributed lease in that case: releasing it would let a second
    // request overlap the unknown live fetch. The fixed TTL recovers liveness.
    if (fetched.timedOut) {
      retainLeaseUntilExpiry = true;
      return null;
    }
    const value = fetched.value;
    const ttlSeconds = value ? TTL_MS / 1000 : NEGATIVE_TTL_MS / 1000;
    if (!await writeScorecardIfLeaseOwner(modelId, lease.token, { value }, ttlSeconds)) return null;
    // Read back through the atomic GET/PTTL path so L1 and CDN freshness derive
    // from this exact cache generation rather than a post-write nominal TTL.
    const shared = await readSharedScorecard<SharedCached>(modelId);
    return shared.state === 'hit' ? remember(modelId, shared.value.value, shared.pttlMs) : null;
  } finally {
    if (!retainLeaseUntilExpiry) await releaseScorecardLease(modelId, lease.token);
  }
}

export async function scorecardRequestBudget(clientKey: string) {
  const clientBudget = await consumeSharedScorecardBudget(clientKey, MAX_REQUESTS_PER_WINDOW, 60);
  if (clientBudget !== 'allowed') return clientBudget;
  // A distributed ceiling also bounds fan-out from many distinct visitors.
  // Check the client first so an exhausted visitor cannot spend this pool.
  return consumeSharedScorecardBudget('upstream-global', MAX_GLOBAL_REQUESTS_PER_WINDOW, 60);
}

export async function allowScorecardRequest(clientKey: string): Promise<boolean> {
  return takeSharedScorecardBudget(clientKey, MAX_REQUESTS_PER_WINDOW, 60);
}

export function clearScorecardCacheForTests(): void {
  cache.clear(); inflight.clear(); scorecardFetcher = fetchLLMStatsModelScorecard;
}

export function setScorecardFetcherForTests(fetcher: (modelId: string, opts: { signal: AbortSignal }) => Promise<LLMStatsModelScorecard | null>): void {
  scorecardFetcher = fetcher;
}
