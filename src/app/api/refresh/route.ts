import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboardData } from '@/lib/leaderboard-service';
import { isAuthorizedRefresh } from '@/lib/refresh-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isAuthorizedRefresh(request.headers)) {
    return NextResponse.json(
      { error: 'Unauthorized refresh request' },
      { status: 401 }
    );
  }

  const { data, cacheStatus } = await getLeaderboardData({ forceRefresh: true });
  if (cacheStatus !== 'MISS' || data.usedFallback) {
    return NextResponse.json({ refreshed: false, cacheStatus, error: 'Live refresh did not complete' }, { status: 503 });
  }

  return NextResponse.json({
    refreshed: true,
    cacheStatus,
    updated: data.updated,
    sourceCount: data.sources.filter((source) => !source.error).length,
  });
}

export async function GET() {
  return NextResponse.json({
    message: 'Use POST to refresh live source data',
    hint: 'curl -X POST http://localhost:3000/api/refresh',
  });
}
