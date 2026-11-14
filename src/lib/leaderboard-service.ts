import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  fetchArenaELO,
  fetchBFCL,
  fetchTerminalBench,
  fetchCodeArenaScores,
  type FetchSourceOptions,
  fetchLiveBench2Scores,
  fetchLiveBenchScores,
  fetchLLMStatsRecentScorecards,
  fetchSWEBench,
  fetchZeroEval,
} from './live-sources';
import { mergeAllSources, SCORING_VERSION } from './merge-models';
import type { LeaderboardData, LeaderboardSourceStatus } from './leaderboard';
import {
  acquireRefreshLock,
  readSharedCache,
  releaseRefreshLock,
  writeSharedCache,
} from './store';
import {
  classifySourceStatus,
  deriveDataSourceLabel,
  isStale,
  type SourceStatus,
  SNAPSHOT_FRESH_MS,
  snapshotExpired,
} from './trust';

// Re-export so consumers can import the honesty-label helper from the service
// module directly (per the trust-contract test note).
export { deriveDataSourceLabel } from './trust';

// 30 minutes: a page load is never more than one cache window behind the
// sources, so a model indexed upstream shows up within ~half an hour.
const CACHE_TTL_MS = SNAPSHOT_FRESH_MS;

// A model that fails to refresh within this window is treated as stale and the
// API stops claiming it is freshly live. Matches the curated fallback cadence.
const STALE_MAX_AGE_DAYS = 14;

type CacheStatus = 'HIT' | 'HIT-SHARED' | 'MISS' | 'STALE' | 'ERROR-STALE' | 'FALLBACK';

// Honesty fields the sibling adds as OPTIONAL to LeaderboardData. We widen
// locally so this module compiles whether or not that type change has landed
// yet, and populate the fields by name. Once the sibling's optional fields ship
// on LeaderboardData these intersect cleanly.
interface HonestyFields {
  usedFallback: boolean;
  dataDate: string | null;
  stale: boolean;
  degradedSources: string[];
  dataSourceLabel: 'live' | 'partial' | 'fallback';
}

// Per-source status is attached to each source row. The `status` key is consumed
// by /api/sources; LeaderboardSourceStatus is sibling-owned so we widen locally.
type SourceStatusRow = LeaderboardSourceStatus & { status: SourceStatus };

type HonestLeaderboardData = LeaderboardData & HonestyFields;

interface CacheEntry {
  data: LeaderboardData;
  timestamp: number;
}

interface LeaderboardFetchResult {
  data: LeaderboardData;
  cacheStatus: CacheStatus;
  cacheAgeSeconds: number;
}

interface FallbackModel {
  name: string;
  provider?: string;
  slug?: string;
  llm_stats_model_id?: string | null;
  params_b?: number | null;
  context_k?: number | null;
  license?: string | null;
  tier?: string;
  vram_int4_gb?: number | null;
  vram_fp16_gb?: number | null;
  vision?: boolean;
  moe_active_b?: number | null;
  release?: string | null;
  closed_source?: boolean;
  benchmarks?: Record<string, number | null>;
  [key: string]: unknown;
}

interface FallbackFile {
  _updated?: string;
  models?: FallbackModel[];
}

const SOURCE_DEFINITIONS = [
  {
    id: 'zeroeval',
    name: 'ZeroEval / llm-stats.com',
    url: 'https://api.zeroeval.com/leaderboard/models/full',
    fetch: fetchZeroEval,
    timeout_ms: 8000,
  },
  {
    id: 'lmarena',
    // Brand moved: lmarena.ai now 301-redirects to arena.ai (verified 2026-08-15).
    // The HuggingFace dataset below is unchanged and still matches arena.ai's
    // published board within 1 ELO point across its top 15.
    name: 'LMArena / arena.ai Chatbot Arena (style-controlled text leaderboard)',
    url: 'https://datasets-server.huggingface.co/rows?dataset=lmarena-ai%2Fleaderboard-dataset&config=text_style_control&split=latest&offset=0&length=100',
    fetch: fetchArenaELO,
    // The paged HuggingFace dataset walk legitimately needs >15s (OLLB's walk
    // already takes ~14s). 40s was still aborting on cold serverless instances
    // (observed live 2026-08-15: "operation was aborted due to timeout", 0 rows,
    // which silently removed ~200 models from the roster). Route maxDuration is
    // 60s; 50s leaves merge + response headroom while surviving a slow walk.
    timeout_ms: 50000,
  },
  {
    id: 'codearena',
    name: 'LLM Stats Code Arena',
    url: 'https://llm-stats.com/leaderboards/llm-leaderboard',
    fetch: fetchCodeArenaScores,
    timeout_ms: 10000,
  },
  {
    id: 'llmstats_recent',
    name: 'LLM Stats Recent Scorecards',
    url: 'https://llm-stats.com/llm-updates',
    fetch: fetchLLMStatsRecentScorecards,
    timeout_ms: 15000,
  },
  {
    id: 'livebench2', name: 'LiveBench 2.0', url: 'https://livebench.ai/', fetch: fetchLiveBench2Scores, timeout_ms: 15000,
  },
  {
    id: 'livebench',
    name: 'LiveBench v1 (legacy edition)',
    // Display URL only — the fetcher discovers the newest table_<date>.csv at
    // runtime from the livebench.ai bundle, so no date is pinned here.
    url: 'https://livebench.ai/v1/',
    fetch: fetchLiveBenchScores,
    // Higher budget: on a cold instance the fetcher discovers the latest table
    // date (homepage + bundle + HEAD probes) before pulling table/categories/
    // cost files, so 8s was too tight and dropped this reliability:1.0 source.
    timeout_ms: 20000,
  },
  {
    id: 'bfcl',
    name: 'BFCL — Berkeley Function-Calling Leaderboard',
    url: 'https://gorilla.cs.berkeley.edu/leaderboard.html',
    fetch: fetchBFCL,
    // One 33KB static CSV. `bfcl` was already a scoring key but carried 11 of
    // 508 models because nothing ever fetched it; the CSV has 109.
    timeout_ms: 10000,
  },
  {
    id: 'terminalbench',
    name: 'Terminal-Bench 4.0 (agentic terminal tasks)',
    url: 'https://www.tbench.ai/',
    fetch: fetchTerminalBench,
    // One 164KB server-rendered page, parsed with the existing flight decoder.
    timeout_ms: 15000,
  },
  {
    id: 'swebench',
    name: 'SWE-bench Verified',
    url: 'https://www.swebench.com',
    fetch: fetchSWEBench,
    timeout_ms: 8000,
  },
] as const;

// L1 in-process cache. The cross-instance problem this TODO used to describe is
// SOLVED: readSharedCache/writeSharedCache in store.ts provide the shared
// Upstash-backed L2 blob plus a single-flight refresh lock, so cold starts read
// the shared result instead of each re-fetching every upstream.
let cache: CacheEntry | null = null;
export interface RefreshOutcome {
  data: LeaderboardData;
  writtenAt: number;
  refreshed: boolean;
  stale: boolean;
}
let refreshPromise: Promise<RefreshOutcome> | null = null;

export async function getLeaderboardData(opts: { forceRefresh?: boolean } = {}): Promise<LeaderboardFetchResult> {
  const { forceRefresh = false } = opts;
  const now = Date.now();

  if (cache && !forceRefresh && now - cache.timestamp < CACHE_TTL_MS) {
    return {
      data: withResponseFreshness(cache.data, cache.timestamp),
      cacheStatus: 'HIT',
      cacheAgeSeconds: Math.round((now - cache.timestamp) / 1000),
    };
  }

  // L2: cross-instance shared cache (Upstash). Returns null without Redis, so
  // single-instance behavior is unchanged. This is what stops every cold
  // serverless instance from independently re-fetching all sources and tripping
  // HuggingFace 429s — they read the shared blob instead.
  if (!forceRefresh) {
    const shared = await readSharedCache();
    if (shared) {
      // Preserve the blob's real age: stamping Date.now() here would let a
      // 29-minute-old blob live another full CACHE_TTL_MS locally (~60 min
      // effective staleness on a nominally 30-minute window).
      cache = { data: shared.data, timestamp: shared.writtenAt };
      return {
        data: withResponseFreshness(shared.data, shared.writtenAt, shared.stale),
        cacheStatus: shared.stale ? 'STALE' : 'HIT-SHARED',
        cacheAgeSeconds: Math.max(0, Math.round((now - shared.writtenAt) / 1000)),
      };
    }
  }

  if (refreshPromise) {
    if (cache && !forceRefresh) {
      return {
        data: withResponseFreshness(cache.data, cache.timestamp),
        cacheStatus: 'STALE',
        cacheAgeSeconds: Math.round((now - cache.timestamp) / 1000),
      };
    }

    try {
      const outcome = await refreshPromise;
      cache = { data: outcome.data, timestamp: outcome.writtenAt };
      return refreshOutcomeResponse(outcome);
    } catch {
      return lastGoodOrFallbackResponse();
    }
  }

  refreshPromise = refreshWithLock();

  try {
    const outcome = await refreshPromise;
    cache = { data: outcome.data, timestamp: outcome.writtenAt };
    return refreshOutcomeResponse(outcome);
  } catch {
    return lastGoodOrFallbackResponse();
  } finally {
    refreshPromise = null;
  }
}

async function lastGoodOrFallbackResponse(): Promise<LeaderboardFetchResult> {
  if (cache) {
    return {
      data: withResponseFreshness(cache.data, cache.timestamp, true),
      cacheStatus: 'ERROR-STALE',
      cacheAgeSeconds: Math.round((Date.now() - cache.timestamp) / 1000),
    };
  }

  const shared = await readSharedCache({ allowStale: true });
  if (shared) {
    cache = { data: shared.data, timestamp: shared.writtenAt };
    return {
      data: withResponseFreshness(shared.data, shared.writtenAt, true),
      cacheStatus: 'ERROR-STALE',
      cacheAgeSeconds: Math.max(0, Math.round((Date.now() - shared.writtenAt) / 1000)),
    };
  }
  return fallbackResponse();
}

export function clearLeaderboardCache() {
  cache = null;
  refreshPromise = null;
}

// Cross-instance single-flight refresh. Lock losers and lock outages serve only
// a last-good shared blob; they never fan out to every upstream during pressure.
export function refreshOutcomeResponse(outcome: RefreshOutcome): LeaderboardFetchResult {
  return {
    data: withResponseFreshness(outcome.data, outcome.writtenAt, outcome.stale),
    cacheStatus: outcome.refreshed ? 'MISS' : outcome.stale ? 'STALE' : 'HIT-SHARED',
    cacheAgeSeconds: Math.max(0, Math.round((Date.now() - outcome.writtenAt) / 1000)),
  };
}

/** Recompute at response time; never mutate or re-date the last-good snapshot. */
export function withResponseFreshness(data: LeaderboardData, writtenAt: number, failedRefresh = false): LeaderboardData {
  const stale = Boolean(data.stale || failedRefresh || !Number.isFinite(writtenAt) || Date.now() - writtenAt >= CACHE_TTL_MS || snapshotExpired(data.dataDate ?? data.updated));
  return {
    ...data,
    stale,
    dataSourceLabel: data.usedFallback ? 'fallback' : stale ? 'partial' : data.dataSourceLabel,
  };
}

// PRIMARY sources define the roster; the rest only enrich it. Losing one is not
// a degraded refresh, it is a different (smaller) catalog.
const PRIMARY_SOURCE_IDS = new Set(['lmarena', 'zeroeval']);

export function primarySourcesMissing(data: LeaderboardData): string[] {
  return (data.sources ?? [])
    .filter((source) => PRIMARY_SOURCE_IDS.has(source.id) && source.count === 0)
    .map((source) => source.id);
}

export function isPersistableLiveRefresh(data: LeaderboardData): boolean {
  const honesty = data as LeaderboardData & { usedFallback?: boolean };
  if (honesty.usedFallback || data.models.length === 0) return false;
  // A refresh that lost a primary source must never overwrite a last-good blob
  // that still has it. On 2026-08-15 an lmarena timeout returned 0 rows and the
  // roster silently fell from ~508 models to ~307 while the badge still read
  // "Partial — 2 sources degraded". Serving slightly older complete data beats
  // publishing a catalog with 40% of the models missing and no warning.
  return primarySourcesMissing(data).length === 0;
}

async function refreshWithLock(): Promise<RefreshOutcome> {
  const lock = await acquireRefreshLock();
  if (lock.state !== 'acquired') {
    const shared = await readSharedCache({ allowStale: true });
    if (shared) return { data: shared.data, writtenAt: shared.writtenAt, refreshed: false, stale: shared.stale };
    throw new Error(lock.state === 'contended' ? 'Refresh already in progress; no shared cache yet' : 'Refresh lock unavailable; refusing upstream fan-out');
  }
  try {
    const data = await fetchAllSources();
    // A fallback/empty result is a failed live refresh. It may be returned to a
    // caller with explicit fallback status, but must never overwrite last-good
    // Redis data or advance the shared cache timestamp.
    if (!isPersistableLiveRefresh(data)) {
      throw new Error('Live refresh produced fallback or empty data; refusing shared-cache persistence');
    }
    if (!await writeSharedCache(data, lock.token)) {
      throw new Error('Shared cache persistence failed; refusing uncoordinated live result');
    }
    return { data, writtenAt: Date.now(), refreshed: true, stale: false };
  } finally {
    await releaseRefreshLock(lock.token);
  }
}

async function fetchAllSources(): Promise<LeaderboardData> {
  const startedAt = Date.now();
  // Env-gated sources simply don't participate
  // until configured — no permanent "degraded" badge for an unconfigured key.
  const activeSources = SOURCE_DEFINITIONS.filter((source) => {
    const requiresEnv = (source as { requiresEnv?: string }).requiresEnv;
    return !requiresEnv || Boolean(process.env[requiresEnv]);
  });
  const settled = await Promise.all(
    activeSources.map(async (source) => {
      const sourceStart = Date.now();
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), source.timeout_ms);
      try {
        const result = await source.fetch({ signal: controller.signal } satisfies FetchSourceOptions);
        return {
          ...result,
          duration_ms: Date.now() - sourceStart,
          url: source.url,
          source_name: source.name,
        };
      } catch (error) {
        return {
          source_id: source.id,
          source_name: source.name,
          models: [],
          fetched_at: new Date().toISOString(),
          error: controller.signal.aborted
            ? `${source.name}: timed out after ${source.timeout_ms}ms`
            : error instanceof Error
              ? error.message
              : 'Unknown fetch error',
          duration_ms: Date.now() - sourceStart,
          url: source.url,
        };
      } finally {
        clearTimeout(timeoutHandle);
      }
    })
  );

  const sources: SourceStatusRow[] = settled.map((result) => {
    const rowCount = result.models.length;
    // A source "attempted" the fetch unless it threw before producing a result;
    // here every settled entry attempted. "ok" means no error was recorded.
    // A reachable-but-empty source (0 rows) classifies as 'degraded', not 'ok'.
    const status = classifySourceStatus({
      attempted: true,
      ok: !result.error,
      rowCount,
      error: result.error ?? null,
    });

    return {
      id: result.source_id,
      name: result.source_name,
      url: result.url,
      count: rowCount,
      error: result.error,
      duration_ms: result.duration_ms,
      fetched_at: result.fetched_at,
      // Upstream publication date when the fetcher could read one, so a source
      // that responds fast with old data cannot pass as fresh.
      data_date: (result as { data_date?: string | null }).data_date ?? null,
      // A table filename dates the task edition, not each model's evaluation.
      date_kind: ['livebench2', 'livebench'].includes(result.source_id) ? 'benchmark_edition' : 'publication',
      historical: result.source_id === 'ollb' || result.source_id === 'livebench',
      status,
    };
  });

  // Low-trust, enrichment-only sources (e.g. the retired OLLB snapshot) are
  // routinely empty/erroring by nature; counting them as "degraded" would force a
  // permanent "Partial" badge and train users to ignore the honesty signal.
  const lowTrustIds = new Set<string>(
    SOURCE_DEFINITIONS.filter((s) => (s as { lowTrust?: boolean }).lowTrust).map((s) => s.id),
  );
  // Any source that is not fully healthy (errored OR reachable-but-empty),
  // excluding the low-trust enrichment sources above.
  const degradedSources = sources
    .filter((source) => source.status !== 'ok' && !lowTrustIds.has(source.id))
    .map((source) => source.id);
  const degradedCount = degradedSources.length;

  const fallback = loadFallbackFile();
  // Pass the curated date through so the merge's dataDate reflects the real
  // curated snapshot (e.g. 2026-04-08) when it stands in as the roster.
  // Explicitly lower-trust sources are enrichment-only and never enter live
  // consensus calculations, even when they return a plausible row.
  const trustedResults = settled.filter((result) => !lowTrustIds.has(result.source_id));
  const models = mergeAllSources(trustedResults, { ...fallback, _updated: fallback._updated });

  // The sibling attaches honesty flags onto the merge result. Read them by name;
  // fall back to safe defaults if the sibling change has not landed yet.
  const usedFallback = Boolean((models as unknown as { usedFallback?: boolean }).usedFallback);
  const mergeDataDate = (models as unknown as { dataDate?: string | null }).dataDate ?? null;

  // Live data is timestamped "now". Fallback data must surface the REAL curated
  // date, never a fresh-live timestamp.
  const dataDate = usedFallback
    ? mergeDataDate ?? fallback._updated ?? null
    : mergeDataDate ?? new Date(startedAt).toISOString();

  const livePrimaryModelCount = usedFallback ? 0 : models.length;
  // A primary-source outage is reported as a full degradation, not a mild one.
  // It removes models from the catalog outright rather than thinning a column.
  const primaryDown = sources.some((source) => ['lmarena', 'zeroeval'].includes(source.id) && source.count === 0);
  const dataSourceLabel = deriveDataSourceLabel({
    usedFallback,
    livePrimaryModelCount,
    degradedCount: primaryDown ? Math.max(degradedCount, 1) : degradedCount,
  });
  const stale = isStale(dataDate, STALE_MAX_AGE_DAYS);

  const data: HonestLeaderboardData = {
    models,
    sources,
    scoringVersion: SCORING_VERSION,
    fallbackCellCount: models.reduce((sum, model) => sum + Object.values(model.benchmark_sources).filter((rows) => rows.some((row) => row.is_fallback)).length, 0),
    // When fallback stands in, "updated" must reflect the real curated date,
    // not the current refresh time.
    updated: usedFallback ? (dataDate ?? new Date(startedAt).toISOString()) : new Date(startedAt).toISOString(),
    usedFallback,
    dataDate,
    stale,
    degradedSources,
    dataSourceLabel,
  };

  return data;
}

function fallbackResponse(): LeaderboardFetchResult {
  const data = loadFallbackAsLeaderboardData();
  return {
    data,
    cacheStatus: 'FALLBACK',
    cacheAgeSeconds: 0,
  };
}

function loadFallbackFile(): FallbackFile {
  try {
    const filePath = path.join(process.cwd(), 'data', 'curated-models.json');
    return JSON.parse(readFileSync(filePath, 'utf8')) as FallbackFile;
  } catch {
    return { models: [] };
  }
}

function loadFallbackAsLeaderboardData(): LeaderboardData {
  const fallback = loadFallbackFile();

  // Route curated models through the authoritative merge with NO live sources.
  // With no primary source the merge promotes the curated file to the roster and
  // computes the full MergedModel scoring fields (composite_score, confidence,
  // coverage, tiers) identically to the live path — no divergent hand-built shape.
  const models = mergeAllSources([], { ...fallback, _updated: fallback._updated });

  // Prefer the merge-reported dataDate; fall back to the curated file's _updated.
  const mergeDataDate = (models as unknown as { dataDate?: string | null }).dataDate ?? null;
  const dataDate = mergeDataDate ?? fallback._updated ?? null;
  const dataSourceLabel = deriveDataSourceLabel({
    usedFallback: true,
    livePrimaryModelCount: 0,
    degradedCount: 0,
  });

  const data: HonestLeaderboardData = {
    models,
    scoringVersion: SCORING_VERSION,
    fallbackCellCount: models.reduce((sum, model) => sum + Object.values(model.benchmark_sources).filter((rows) => rows.some((row) => row.is_fallback)).length, 0),
    sources: [],
    // Curated fallback: surface the REAL curated date, never a fresh timestamp.
    updated: dataDate ?? new Date().toISOString(),
    usedFallback: true,
    dataDate,
    stale: isStale(dataDate, STALE_MAX_AGE_DAYS),
    degradedSources: [],
    dataSourceLabel,
  };

  return data;
}
