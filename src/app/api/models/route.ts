import { NextRequest, NextResponse } from 'next/server';
import { dedupeModelsBySlug, flattenLeaderboardModel, classifyModelType } from '@/lib/leaderboard';
import { getLeaderboardData } from '@/lib/leaderboard-service';
import { publicApiNotice, redactModelForPublicApi } from '@/lib/public-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get('type') || undefined;
  const search = searchParams.get('search') || undefined;
  // A bare call used to return 100 of ~508 rows with nothing in the response
  // saying so, which reads as "this is the whole roster". Default to the full
  // roster and report truncation explicitly when a caller asks for less.
  const MAX_LIMIT = 1000;
  const DEFAULT_LIMIT = 500;
  const rawLimit = parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 0), MAX_LIMIT) : DEFAULT_LIMIT;
  const rawOffset = parseInt(searchParams.get('offset') || '0', 10);
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

  const { data } = await getLeaderboardData();

  const filtered = data.models
    .filter((model) => {
      if (type && type !== 'all') {
        const modelType = classifyModelType(model);
        if (modelType !== type) return false;
      }

      if (!search) return true;

      const query = search.toLowerCase();
      return (
        model.slug.includes(query) ||
        model.name.toLowerCase().includes(query) ||
        model.provider.toLowerCase().includes(query)
      );
    })
    .map(flattenLeaderboardModel);

  const unique = dedupeModelsBySlug(filtered);

  // Values from sources without a redistribution licence are withheld (docs/DATA-SOURCES.md).
  const page = unique.slice(offset, offset + limit).map((model) => redactModelForPublicApi(model));

  return NextResponse.json({
    updated: data.updated,
    scoringVersion: data.scoringVersion,
    dataSourceLabel: data.dataSourceLabel,
    usedFallback: data.usedFallback,
    stale: data.stale,
    degradedSources: data.degradedSources,
    models: page,
    total: unique.length,
    limit,
    offset,
    // Explicit so a consumer never mistakes a page for the whole roster.
    truncated: offset + page.length < unique.length,
    dataLicence: publicApiNotice(),
  });
}
