import { loadSiteLeaderboard } from '@/lib/site-leaderboard';
import ModelDetailPage from './model-detail-view';

// ISR: each model page is rendered on its first visit, cached, and regenerated
// at most every 5 minutes (see site-leaderboard.ts). None is prerendered at build.
export const dynamic = 'force-static';
export const revalidate = 300;

export function generateStaticParams() {
  return [];
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <ModelDetailPage params={params} initialData={await loadSiteLeaderboard()} />;
}
