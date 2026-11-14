import type { LeaderboardPayload } from './leaderboard-payload';

/**
 * Props for the site's client views. The ISR server page (see
 * src/lib/site-leaderboard.ts) passes the full snapshot; null means it could
 * not be loaded and the view shows its load error.
 */
export interface SiteLeaderboardProps { initialData: LeaderboardPayload | null }

export function siteLeaderboard(initialData: LeaderboardPayload | null): Promise<LeaderboardPayload> {
  return initialData ? Promise.resolve(initialData) : Promise.reject(new Error('Leaderboard unavailable'));
}
