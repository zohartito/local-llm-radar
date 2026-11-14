import { buildBenchmarkRankings, CATEGORY_TESTS, COMPARISON_VERSION, comparisonCategoryLabel, comparisonTestLabel } from '@/lib/benchmark-comparisons';
import { NextRequest, NextResponse } from 'next/server';
import { buildCategoryRankings, getCategoryDefinition, resolveCategoryKey } from '@/lib/leaderboard';
import { getLeaderboardData } from '@/lib/leaderboard-service';
import { publicApiNotice, redactModelForPublicApi } from '@/lib/public-api';
import { readRankSnapshotAround, ranksForCategory, isComparableRankData } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const requestedCategory = searchParams.get('category') || 'overall';
  const category = resolveCategoryKey(requestedCategory);
  const onlyLocal = searchParams.get('local') === 'true';
  if (category !== requestedCategory && requestedCategory !== 'tool-use') {
    return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
  }
  const requestedLimit = Number(searchParams.get('limit') || 50);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(2000, Math.floor(requestedLimit))) : 50;

  const { data } = await getLeaderboardData();
  const mode = searchParams.get('mode') ?? 'benchmark';
  if (!['benchmark', 'index'].includes(mode)) return NextResponse.json({ error: 'Unknown comparison mode' }, { status: 400 });
  const benchmark = searchParams.get('benchmark') ?? undefined;
  if (benchmark && !(CATEGORY_TESTS[category] ?? []).includes(benchmark)) {
    return NextResponse.json({ error: 'Test is not available in this category' }, { status: 400 });
  }
  const comparison = buildBenchmarkRankings(data.models, category, { onlyLocal, limit, benchmark, cohortId: searchParams.get('cohort') ?? undefined });
  if (searchParams.has('cohort') && !comparison.cohort) return NextResponse.json({ error: 'Unknown benchmark edition' }, { status: 400 });
  const rankings = mode === 'index' ? buildCategoryRankings(data.models, category, { onlyLocal, limit }) : comparison.rankings;

  // Week-over-week Trend deltas from the ~7-days-ago rank snapshot. Null without
  // Redis or until history exists, so rows keep rank_change: null, which the UI
  // renders as "no movement yet" rather than a fabricated 0.
  // Stored snapshots rank all models. Comparing those positions to an open-only
  // view fabricates movement, so that view has no historical delta yet.
  const trendEligible = mode === 'index' && !onlyLocal && isComparableRankData(data);
  const snapshot = trendEligible ? await readRankSnapshotAround(7) : null;
  const previousRanks = snapshot ? ranksForCategory(snapshot, category) : null;
  // Ranks are computed from the full data first; only then are values from
  // sources without a redistribution licence withheld. A benchmark-mode score is
  // that test's raw value; an index score is derived across tests and stays.
  const scoreSourceId = mode === 'benchmark' ? comparison.cohort?.sourceId ?? null : null;
  const rankingsWithTrend = rankings.map((row) => {
    const previous = row.rank === null ? null : previousRanks?.[row.slug] ?? null;
    return {
      ...redactModelForPublicApi(row, scoreSourceId),
      previous_rank: previous,
      // positive = moved up toward rank 1
      rank_change: previous == null || row.rank === null ? null : previous - row.rank,
    };
  });

  return NextResponse.json({
    mode,
    comparisonVersion: COMPARISON_VERSION,
    comparison: mode === 'benchmark' ? { benchmark: comparison.benchmark, cohort: comparison.cohort, cohorts: comparison.cohorts } : null,
    scoringVersion: data.scoringVersion,
    dataSourceLabel: data.dataSourceLabel,
    dataDate: data.dataDate,
    usedFallback: data.usedFallback,
    stale: data.stale,
    degradedSources: data.degradedSources,
    category,
    categoryMeta: mode === 'index' ? getCategoryDefinition(category) : { ...getCategoryDefinition(category), label: comparisonCategoryLabel(category), desc: comparisonTestLabel(comparison.benchmark), benchmarks: [comparison.benchmark] },
    snapshotDate: data.updated,
    trendSnapshotDate: snapshot?.date ?? null,
    trendUnavailableReason: mode === 'benchmark' ? 'benchmark-history-unavailable' : onlyLocal ? 'filtered-roster' : !trendEligible ? 'current-snapshot-degraded' : !snapshot ? 'no-compatible-history' : null,
    rankings: rankingsWithTrend,
    dataLicence: publicApiNotice(),
  });
}
