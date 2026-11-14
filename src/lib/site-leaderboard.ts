import { getLeaderboardData } from './leaderboard-service';
import { buildLeaderboardPayload, type LeaderboardPayload } from './leaderboard-payload';

/**
 * Full leaderboard snapshot for the site's own pages, which show every source's
 * values with credit. The public JSON API (/api/leaderboard) withholds scores
 * from sources without a redistribution licence (docs/DATA-SOURCES.md), so pages
 * never read it.
 *
 * Pages that call this export `revalidate = 300` and `dynamic = 'force-static'`:
 * the rendered page is cached (ISR) and regenerated at most every 5 minutes.
 * force-static is needed because the Redis client sends `no-store` fetches,
 * which would otherwise make the page fully dynamic. Those Redis reads still
 * run uncached each time the page is regenerated.
 */
export async function loadSiteLeaderboard(): Promise<LeaderboardPayload | null> {
  try {
    return buildLeaderboardPayload(await getLeaderboardData());
  } catch {
    return null;
  }
}
