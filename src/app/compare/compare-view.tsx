'use client';

import { siteLeaderboard, type SiteLeaderboardProps } from '@/lib/site-data';
import { textReleaseEvidence } from '@/lib/model-release';

import { buildBenchmarkRankings, comparisonTestLabel, defaultCategoryTest, type ComparisonCohort } from '@/lib/benchmark-comparisons';
import { ReleaseDate } from '@/components/ReleaseDate';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  flattenLeaderboardModel,
  type LeaderboardData,
  dedupeModelsBySlug,
  findModelBySlug,
} from '@/lib/leaderboard';
import { DataLoadError } from '@/components/DataLoadError';
import { DataFreshnessBadge } from '@/components/DataFreshnessBadge';
import { matchesSearchQuery } from '@/lib/search';

interface CompareModel {
  metadata_sources?: import('@/lib/merge-models').MergedModel['metadata_sources'];
  name: string;
  slug: string;
  slug_aliases?: string[];
  provider: string;
  release: string | null;
  model_type: string;
  rank_status?: string;
  license: string | null;
  parameter_count: number | null;
  estimated_vram_q4_gb: number | null;
  composite_score?: number | null;
  benchmarks?: Record<string, number | null>;
}

interface RankingRow {
  slug: string;
  rank: number | null;
  score: number | null;
}

const COMPARE_CATEGORIES = ['overall', 'coding', 'agentic', 'reasoning', 'math', 'chat'] as const;

function CompareContent({ initialData }: SiteLeaderboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modelSlugs = searchParams.get('models')?.split(',').filter(Boolean) || [];
  const modelSlugsKey = modelSlugs.join(',');
  const [cohorts, setCohorts] = useState<Record<string, ComparisonCohort | null>>({});
  const [rankings, setRankings] = useState<Record<string, RankingRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [snapshot, setSnapshot] = useState<LeaderboardData | null>(null);
  const [addSlug, setAddSlug] = useState('');
  const [filter, setFilter] = useState('');
  const [allModels, setAllModels] = useState<CompareModel[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadCatalog() {
      try {
        // One complete snapshot: no 500-model/200-rank truncation or mixed refreshes.
        const data: LeaderboardData = await siteLeaderboard(initialData);
        if (controller.signal.aborted) return;
        const models = dedupeModelsBySlug(data.models);
        setAllModels(models.map(flattenLeaderboardModel));
        const comparisons = COMPARE_CATEGORIES.map(category => [category, buildBenchmarkRankings(models, category)] as const);
        setRankings(Object.fromEntries(comparisons.map(([category, result]) => [category, result.rankings])));
        setCohorts(Object.fromEntries(comparisons.map(([category, result]) => [category, result.cohort])));
        setSnapshot(data);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadCatalog();
    return () => controller.abort();
  }, [initialData]);

  const models = dedupeModelsBySlug(modelSlugsKey.split(',').filter(Boolean).map((slug) => findModelBySlug(allModels, slug)).filter((model): model is CompareModel => model !== null));

  function setSlugs(next: string[]) {
    router.replace(next.length ? `/compare?models=${next.join(',')}` : '/compare', { scroll: false });
    setAddSlug('');
  }

  function getRankForModel(category: string, slug: string) {
    return (rankings[category] || []).find((entry) => entry.slug === slug);
  }

  function categoryView(category: string, model: CompareModel) {
    const ranked = getRankForModel(category, model.slug);
    if (ranked && ranked.score !== null) return { kind: 'ranked' as const, rank: ranked.rank, score: ranked.score };
    return { kind: 'empty' as const };
  }

  if (loadError) return <DataLoadError />;

  if (loading) {
    return <div className="max-w-6xl mx-auto px-4 py-8"><div className="animate-pulse h-96 bg-zinc-900 rounded-lg" /></div>;
  }

  const addable = allModels.filter((model) => (
    !models.some((selected) => selected.slug === model.slug)
    && (!filter || matchesSearchQuery(filter, model.name, model.provider, model.slug))
  ));

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-xl font-bold text-zinc-100 mb-2">Compare Models</h1>
      <p className="text-xs text-zinc-500 mb-6">
        Each row compares one named test from the same evaluator and edition. A dash means no matching result. Ties share positions; effort and harness settings can differ. Capability Score is separate experimental analysis, not the basis for these positions.
      </p>

      <DataFreshnessBadge {...snapshot} />
      <div className="flex flex-wrap items-center gap-3 my-6">
        <input
          type="text"
          placeholder="Filter the list..."
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm placeholder:text-zinc-600 w-48"
        />
        <select
          value={addSlug}
          onChange={(event) => setAddSlug(event.target.value)}
          className="min-w-0 max-w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm"
        >
          <option value="">{addable.length ? 'Add a model...' : 'No matches'}</option>
          {addable.map((model) => (
            <option key={model.slug} value={model.slug}>{model.name}</option>
          ))}
        </select>
        <button
          onClick={() => { if (addSlug && !modelSlugs.includes(addSlug)) setSlugs([...models.map((model) => model.slug), addSlug]); }}
          disabled={!addSlug}
          className="px-3 py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white cursor-pointer"
        >
          Add
        </button>
      </div>

      {models.length === 0 ? (
        <div className="text-center py-20 text-zinc-600">
          <p className="text-lg mb-2">Add models with the dropdown above</p>
          <p className="text-sm">
            Or tick rows on the <Link href="/models" className="text-emerald-400 hover:underline">Models</Link> page and open Compare from there.
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase w-40">Metric</th>
                {models.map((model) => (
                  <th key={model.slug} className="px-4 py-3 text-left text-xs font-medium text-zinc-300">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/models/${model.slug}`} className="hover:text-emerald-400">
                        {model.name}
                      </Link>
                      <button
                        type="button"
                        onClick={() => setSlugs(models.filter((selected) => selected.slug !== model.slug).map((selected) => selected.slug))}
                        className="text-[10px] text-zinc-600 hover:text-zinc-300 cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`px-1 py-0.5 rounded text-[9px] ${
                          model.model_type === 'open-weight' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-amber-900/40 text-amber-400'
                        }`}
                      >
                        {model.model_type === 'open-weight' ? 'OPEN' : model.model_type === 'closed' ? 'API' : 'WEIGHTS UNKNOWN'}
                      </span>
                      {model.parameter_count != null && (
                        <span className="text-[10px] text-zinc-600">{model.parameter_count}B</span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              <tr className="bg-zinc-800/20">
                <td className="px-4 py-2 text-xs text-zinc-500">Released</td>
                {models.map(model => <td key={model.slug} className="px-4 py-2 text-xs text-zinc-400"><ReleaseDate value={model.release} evidence={textReleaseEvidence(model)} /></td>)}
              </tr>
              <tr className="bg-zinc-800/20">
                <td className="px-4 py-2 text-xs text-zinc-500">Capability Score</td>
                {models.map((model) => (
                  <td key={model.slug} className="px-4 py-2 text-xs font-mono text-emerald-400">
                    {model.composite_score != null ? model.composite_score.toFixed(1) : '—'}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-4 py-2 text-xs text-zinc-500">Evidence status</td>
                {models.map((model) => <td key={model.slug} className="px-4 py-2 text-xs text-zinc-400">{model.rank_status?.replaceAll('_', ' ') ?? 'unknown'}</td>)}
              </tr>
              <tr className="bg-zinc-800/20">
                <td className="px-4 py-2 text-xs text-zinc-500">VRAM (Q4)</td>
                {models.map((model) => (
                  <td key={model.slug} className="px-4 py-2 text-xs font-mono text-zinc-400">
                    {model.estimated_vram_q4_gb ? `${model.estimated_vram_q4_gb}GB` : '—'}
                    {model.estimated_vram_q4_gb != null && (
                      <div className="text-[10px] text-zinc-600 font-sans">Fit is on the <Link href="/hardware" className="text-zinc-500 hover:text-emerald-400">Hardware</Link> page</div>
                    )}
                  </td>
                ))}
              </tr>
              <tr className="bg-zinc-800/20">
                <td className="px-4 py-2 text-xs text-zinc-500">License</td>
                {models.map((model) => (
                  <td key={model.slug} className="px-4 py-2 text-xs text-zinc-400 truncate max-w-32">
                    {model.license || '—'}
                  </td>
                ))}
              </tr>
              {COMPARE_CATEGORIES.map((cat) => (
                <tr key={cat} className="hover:bg-zinc-800/30">
                  <td className="px-4 py-2 text-xs text-zinc-400 capitalize">{comparisonTestLabel(defaultCategoryTest(cat))}<div className="mt-1 text-[10px] normal-case text-zinc-500">{cohorts[cat]?.edition ?? 'Dataset date not supplied'}</div></td>
                  {models.map((model) => {
                    const view = categoryView(cat, model);
                    if (view.kind === 'empty') {
                      return <td key={model.slug} className="px-4 py-2 text-xs text-zinc-700">—</td>;
                    }

                    const isBest = view.rank !== null && models.every((other) => {
                      const otherView = categoryView(cat, other);
                      return otherView.kind === 'empty' || view.score >= otherView.score;
                    });
                    return (
                      <td key={model.slug} className="px-4 py-2">
                        <span className={`text-xs font-mono ${isBest ? 'text-emerald-400 font-semibold' : 'text-zinc-300'}`}>
                          {view.rank === null ? 'Unranked' : `#${view.rank}`}
                        </span>
                        <span className="text-xs text-zinc-600 ml-2">({view.score.toFixed(2)})</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ComparePage({ initialData }: SiteLeaderboardProps) {
  return (
    <Suspense fallback={<div className="max-w-6xl mx-auto px-4 py-8"><div className="animate-pulse h-96 bg-zinc-900 rounded-lg" /></div>}>
      <CompareContent initialData={initialData} />
    </Suspense>
  );
}
