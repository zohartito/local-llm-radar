import { dedupeModelsBySlug, type LeaderboardData } from './leaderboard';

type LeaderboardResult = { data: LeaderboardData; cacheStatus: string; cacheAgeSeconds: number };

/** The full leaderboard snapshot with its honesty fields, shared by the site and the public API. */
export function buildLeaderboardPayload({ data }: LeaderboardResult) {
  // Honesty fields are populated by the leaderboard service. Read them
  // defensively so older cached payloads still produce a consistent body.
  const usedFallback = data.usedFallback ?? false;
  const dataDate = data.dataDate ?? null;
  const stale = data.stale ?? false;
  const degradedSources = data.degradedSources ?? [];
  const dataSourceLabel = data.dataSourceLabel ?? (usedFallback ? 'fallback' : 'live');

  // When serving the curated fallback, "updated" must reflect the REAL data
  // date, not a fresh-live timestamp. The service already sets data.updated to
  // dataDate in the fallback path; mirror it here defensively.
  return {
    ...data,
    models: dedupeModelsBySlug(data.models),
    usedFallback,
    dataDate,
    stale,
    degradedSources,
    dataSourceLabel,
    updated: usedFallback ? (dataDate ?? data.updated) : data.updated,
  };
}

export type LeaderboardPayload = ReturnType<typeof buildLeaderboardPayload>;
