import { NextResponse } from 'next/server';
import { getLeaderboardData } from '@/lib/leaderboard-service';
import { buildLeaderboardPayload } from '@/lib/leaderboard-payload';
import { publicApiNotice, redactModelForPublicApi } from '@/lib/public-api';
import { leaderboardCacheControl } from '@/lib/trust';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  // Public reads never control upstream refresh work. Scheduled/manual refresh
  // endpoints are authenticated separately; this route can only serve cache.
  const result = await getLeaderboardData();
  const { data, cacheStatus, cacheAgeSeconds } = result;
  const payload = buildLeaderboardPayload(result);
  const { usedFallback, dataDate, stale, dataSourceLabel } = payload;

  const successfulSources = data.sources.filter((source) => !source.error).length;
  // Site pages read the full snapshot through a server function; this public
  // API withholds values from sources without a redistribution licence.
  const body = { ...payload, models: payload.models.map((model) => redactModelForPublicApi(model)), dataLicence: publicApiNotice() };

  const headers: Record<string, string> = {
    'X-Cache': cacheStatus,
    'X-Cache-Age': String(cacheAgeSeconds),
    'X-Sources': String(successfulSources),
    'X-Data-Source': dataSourceLabel,
    'Cache-Control': leaderboardCacheControl({ cacheAgeSeconds, stale, usedFallback, dataSourceLabel, snapshotDate: dataDate ?? data.updated }),
  };

  if (usedFallback) {
    headers['X-Cache'] = 'FALLBACK';
  }

  return NextResponse.json(body, { headers });
}
