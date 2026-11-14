import { loadSiteLeaderboard } from '@/lib/site-leaderboard';
import Dashboard from './dashboard-view';

// ISR: cached page, regenerated at most every 5 minutes (see site-leaderboard.ts).
export const dynamic = 'force-static';
export const revalidate = 300;

export default async function Page() {
  return <Dashboard initialData={await loadSiteLeaderboard()} />;
}
