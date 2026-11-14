import { NextResponse } from 'next/server';
import { ScorecardRequestError, getCachedScorecard } from '@/lib/scorecard-cache';
import { scorecardClientKey } from '@/lib/request-client';
import { findModelBySlug } from '@/lib/leaderboard';
import { getLeaderboardData } from '@/lib/leaderboard-service';

export const dynamic = 'force-dynamic';
// 60s, not 30: getLeaderboardData() below can trigger a full cold refresh whose
// slowest source (LMArena) is budgeted 40s — a 30s ceiling would kill the route
// before the scorecard fetch even starts.
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { data } = await getLeaderboardData();
  const model = findModelBySlug(data.models, slug);

  if (!model) {
    return NextResponse.json({ error: 'Model not found' }, { status: 404 });
  }

  if (!model.llm_stats_model_id) {
    return NextResponse.json({ error: 'No LLM Stats model page is linked for this model yet' }, { status: 404 });
  }

  let cachedScorecard: Awaited<ReturnType<typeof getCachedScorecard>> | null = null;
  try {
    cachedScorecard = await getCachedScorecard(model.llm_stats_model_id, scorecardClientKey(request));
  } catch (error) {
    if (error instanceof ScorecardRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
    }
    cachedScorecard = null;
  }
  const scorecard = cachedScorecard?.value ?? null;

  if (
    cachedScorecard == null ||
    scorecard == null ||
    (typeof scorecard === 'object' && Object.keys(scorecard).length === 0)
  ) {
    return NextResponse.json(
      { available: false, slug, reason: 'scorecard source unavailable' },
      { status: 200 }
    );
  }

  return NextResponse.json(
    { available: true, slug, scorecard },
    {
      headers: {
        // Derived from the same Redis PTTL generation as the L1 cache.
        'Cache-Control': `public, s-maxage=${cachedScorecard.cacheTtlSeconds}, stale-while-revalidate=0`,
      },
    }
  );
}

