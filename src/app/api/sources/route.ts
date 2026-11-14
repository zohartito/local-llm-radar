import { NextResponse } from 'next/server';
import { getLeaderboardData } from '@/lib/leaderboard-service';
import { readCronRefreshStatus } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const [{ data }, cronRefresh] = await Promise.all([getLeaderboardData(), readCronRefreshStatus()]);

  // Honesty fields populated by the leaderboard service (sibling adds them as
  // OPTIONAL to LeaderboardData). Read defensively. Each source row also carries
  // a `status` of 'ok' | 'degraded' | 'error' from classifySourceStatus.
  const honesty = data as typeof data & {
    usedFallback?: boolean;
    dataDate?: string | null;
    stale?: boolean;
    degradedSources?: string[];
    dataSourceLabel?: 'live' | 'partial' | 'fallback';
  };
  const sources = data.sources as Array<
    (typeof data.sources)[number] & { status?: 'ok' | 'degraded' | 'error' }
  >;

  const usedFallback = honesty.usedFallback ?? false;
  const dataDate = honesty.dataDate ?? null;
  const stale = honesty.stale ?? false;
  const degradedSources =
    honesty.degradedSources ?? sources.filter((source) => source.status && source.status !== 'ok').map((source) => source.id);
  const dataSourceLabel = honesty.dataSourceLabel ?? (usedFallback ? 'fallback' : 'live');

  const stats = {
    total_models: data.models.length,
    open_weight_models: data.models.filter((model) => !model.closed_source).length,
    closed_models: data.models.filter((model) => model.closed_source).length,
    total_benchmarks: data.models.reduce(
      (sum, model) => sum + Object.values(model.benchmarks).filter((value) => value !== null).length,
      0
    ),
    unique_metrics: new Set(
      data.models.flatMap((model) =>
        Object.entries(model.benchmarks)
          .filter(([, value]) => value !== null)
          .map(([key]) => key)
      )
    ).size,
    // Surface the REAL data date, not just whatever was stamped on refresh.
    last_data_update: dataDate ?? data.updated,
  };

  // A source is unhealthy if it errored, is reachable-but-empty (0 rows -> its
  // classified status is 'degraded'/'error'), or its data is too old.
  const staleSources = sources.filter((source) => {
    if (source.status && source.status !== 'ok') return true;
    if (source.error) return true;
    if (source.count <= 0) return true;
    const fetchedAt = new Date(source.fetched_at).getTime();
    return Number.isNaN(fetchedAt) || Date.now() - fetchedAt > 25 * 60 * 60 * 1000;
  });

  return NextResponse.json({
    cronRefresh,
    scoringVersion: data.scoringVersion,
    fallbackCellCount: data.fallbackCellCount ?? null,
    sources: data.sources,
    staleSources,
    degradedSources,
    refreshLogs: [],
    stats,
    updated: dataDate ?? data.updated,
    usedFallback,
    dataDate,
    stale,
    dataSourceLabel,
  });
}
