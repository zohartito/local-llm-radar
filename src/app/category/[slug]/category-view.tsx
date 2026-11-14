'use client';

import { siteLeaderboard, type SiteLeaderboardProps } from '@/lib/site-data';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { BenchmarkTable } from '@/components/BenchmarkTable';
import { DataLoadError } from '@/components/DataLoadError';
import { DataFreshnessBadge } from '@/components/DataFreshnessBadge';
import { CATEGORY_DEFINITIONS, dedupeModelsBySlug, type LeaderboardData } from '@/lib/leaderboard';
import { comparisonCategoryLabel } from '@/lib/benchmark-comparisons';

export default function CategoryPage({ params, initialData }: SiteLeaderboardProps & { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const valid = CATEGORY_DEFINITIONS.some(category => category.key === slug);

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    siteLeaderboard(initialData).then((result: LeaderboardData) => {
      if (!controller.signal.aborted) setData(result);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [valid, initialData]);

  if (!valid) return <DataLoadError message="Unknown category. Choose a category from the navigation." />;
  if (failed) return <DataLoadError />;
  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 mb-2 inline-block">Dashboard</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-bold text-zinc-100">{comparisonCategoryLabel(slug)} comparison</h1>
          {data && <DataFreshnessBadge {...data} dataDate={data.dataDate ?? data.updated} />}
        </div>
      </div>
      {data ? <BenchmarkTable key={slug} models={dedupeModelsBySlug(data.models)} initialCategory={slug} /> : <p className="text-zinc-500">Loading benchmark results…</p>}
    </div>
  );
}
