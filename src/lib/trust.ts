/**
 * Pure trust/honesty helpers shared by the leaderboard data pipeline and UI.
 *
 * No imports, no network, no I/O — every function is deterministic given its
 * arguments (an optional `now` is injectable so time-based logic is testable).
 * These are the contract names sibling agents import; keep them exact.
 */

const MS_PER_DAY = 86_400_000;

export type SourceStatus = 'ok' | 'degraded' | 'error';

/**
 * Classify a single source fetch attempt.
 *   !attempted                         -> 'error'
 *   attempted && !ok                   -> 'error'
 *   attempted && ok && rowCount <= 0   -> 'degraded'
 *   attempted && ok && rowCount > 0    -> 'ok'
 */
export function classifySourceStatus(input: {
  attempted: boolean;
  ok: boolean;
  rowCount: number;
  error?: string | null;
}): SourceStatus {
  if (!input.attempted) return 'error';
  if (!input.ok) return 'error';
  if (input.rowCount <= 0) return 'degraded';
  return 'ok';
}

/**
 * True if the data is stale: the timestamp is missing/unparseable, OR it is
 * older than `maxAgeDays`. `now` defaults to Date.now() and is injectable.
 */
export function isStale(updatedISO: string | null, maxAgeDays: number, now?: number): boolean {
  if (updatedISO === null) return true;
  const parsed = Date.parse(updatedISO);
  if (!Number.isFinite(parsed)) return true;
  const current = now ?? Date.now();
  return current - parsed > maxAgeDays * MS_PER_DAY;
}

export interface FreshnessInfo {
  dataDate: string | null;
  ageDays: number | null;
  stale: boolean;
}

/**
 * Derive freshness facts from a timestamp.
 * When the timestamp is missing/unparseable, ageDays is null and stale is true.
 */
export function freshnessOf(updatedISO: string | null, maxAgeDays: number, now?: number): FreshnessInfo {
  const stale = isStale(updatedISO, maxAgeDays, now);

  if (updatedISO === null) {
    return { dataDate: null, ageDays: null, stale };
  }
  const parsed = Date.parse(updatedISO);
  if (!Number.isFinite(parsed)) {
    return { dataDate: updatedISO, ageDays: null, stale };
  }

  const current = now ?? Date.now();
  const ageDays = (current - parsed) / MS_PER_DAY;
  return { dataDate: updatedISO, ageDays, stale };
}

export type DataSourceLabel = 'live' | 'partial' | 'fallback';

/**
 * Derive the user-facing honesty label for the dataset.
 *   usedFallback        -> 'fallback'
 *   degradedCount > 0   -> 'partial'
 *   otherwise           -> 'live'
 */
export function deriveDataSourceLabel(input: {
  usedFallback: boolean;
  livePrimaryModelCount: number;
  degradedCount: number;
}): DataSourceLabel {
  if (input.usedFallback) return 'fallback';
  if (input.degradedCount > 0) return 'partial';
  return 'live';
}

/** The source-fetch freshness window; shared by API caching and open browser tabs. */
export const SNAPSHOT_FRESH_MS = 30 * 60 * 1000;

export function snapshotExpired(snapshotDate: string | null | undefined, now = Date.now()): boolean {
  const timestamp = snapshotDate ? Date.parse(snapshotDate) : NaN;
  return !Number.isFinite(timestamp) || timestamp > now || now - timestamp >= SNAPSHOT_FRESH_MS;
}

/** Never let a CDN extend the lifetime of a body that still claims freshness. */
export function leaderboardCacheControl(input: {
  cacheAgeSeconds: number;
  stale?: boolean;
  usedFallback?: boolean;
  dataSourceLabel?: string;
  snapshotDate?: string | null;
}, now = Date.now()): string {
  const timestamp = input.snapshotDate ? Date.parse(input.snapshotDate) : NaN;
  if (input.stale || input.usedFallback || input.dataSourceLabel !== 'live' ||
      !Number.isFinite(input.cacheAgeSeconds) || input.cacheAgeSeconds < 0 ||
      !Number.isFinite(timestamp) || timestamp > now) return 'no-store';
  const ageMs = Math.max(input.cacheAgeSeconds * 1000, now - timestamp);
  // One-second margin covers rounded origin age and transport latency. No SWR:
  // a stale body has to be relabeled at the origin before being served again.
  const ttl = Math.min(300, Math.floor((SNAPSHOT_FRESH_MS - ageMs) / 1000) - 1);
  return ttl > 0 ? `public, max-age=0, s-maxage=${ttl}, must-revalidate` : 'no-store';
}
