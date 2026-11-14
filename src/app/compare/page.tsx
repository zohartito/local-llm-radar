import { loadSiteLeaderboard } from '@/lib/site-leaderboard';
import ComparePage from './compare-view';

// ISR: cached page, regenerated at most every 5 minutes (see site-leaderboard.ts).
// The selected models come from the query string and are read in the browser.
export const dynamic = 'force-static';
export const revalidate = 300;

export default async function Page() {
  return <ComparePage initialData={await loadSiteLeaderboard()} />;
}
