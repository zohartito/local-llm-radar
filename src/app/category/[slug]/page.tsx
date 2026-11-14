import { CATEGORY_DEFINITIONS } from '@/lib/leaderboard';
import { loadSiteLeaderboard } from '@/lib/site-leaderboard';
import CategoryPage from './category-view';

// ISR: cached page, regenerated at most every 5 minutes (see site-leaderboard.ts).
export const dynamic = 'force-static';
export const revalidate = 300;

export function generateStaticParams() {
  return CATEGORY_DEFINITIONS.map(category => ({ slug: category.key }));
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <CategoryPage params={params} initialData={await loadSiteLeaderboard()} />;
}
