import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboardData } from '@/lib/leaderboard-service';
import { writeDailyRankSnapshot, recordCronRefresh } from '@/lib/store';
import { isAuthorizedRefresh } from '@/lib/refresh-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorizedRefresh(request.headers)) {
    return NextResponse.json(
      { error: 'Unauthorized cron refresh request' },
      { status: 401 }
    );
  }

  const { data, cacheStatus } = await getLeaderboardData({ forceRefresh: true });
  const refreshed = cacheStatus === 'MISS' && !data.usedFallback;
  const receiptRecorded = await recordCronRefresh({
    attemptedAt: new Date().toISOString(), refreshed, cacheStatus,
    snapshotDate: data.updated,
    sourceCount: data.sources.filter((source) => !source.error && source.count > 0).length,
    degradedSources: data.degradedSources ?? [],
  });
  if (!refreshed) {
    return NextResponse.json({ refreshed: false, cacheStatus, error: 'Live refresh did not complete; snapshot skipped' }, { status: 503 });
  }

  // Append today's rank snapshot for week-over-week Trend deltas. No-op without
  // Redis; internally skips fallback days so a bad-source day cannot fabricate
  // rank movement.
  await writeDailyRankSnapshot(data);

  return NextResponse.json({
    refreshed: true,
    receiptRecorded,
    cacheStatus,
    updated: data.updated,
    sourceCount: data.sources.filter((source) => !source.error && source.count > 0).length,
  });
}
