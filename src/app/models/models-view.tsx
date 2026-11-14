'use client';

import { siteLeaderboard, type SiteLeaderboardProps } from '@/lib/site-data';
import { textReleaseEvidence } from '@/lib/model-release';

import { ReleaseDate } from '@/components/ReleaseDate';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { DataLoadError } from '@/components/DataLoadError';
import { DataFreshnessBadge } from '@/components/DataFreshnessBadge';
import type { LeaderboardData, LeaderboardModel } from '@/lib/leaderboard';
import { dedupeModelsBySlug } from '@/lib/leaderboard';
import { matchesSearchQuery } from '@/lib/search';

const TIER_COLORS: Record<string, string> = {
  'S': 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  'A': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  'B': 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  'C': 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  'D': 'bg-zinc-500/20 text-zinc-400 border-zinc-500/40',
};

function makeSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function ModelsPage({ initialData }: SiteLeaderboardProps) {
  const [models, setModels] = useState<LeaderboardModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<LeaderboardData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [compareSlugs, setCompareSlugs] = useState<string[]>([]);

  useEffect(() => {
    siteLeaderboard(initialData)
      .then((data: LeaderboardData) => {
        setModels(dedupeModelsBySlug(data.models || []));
        setSnapshot(data);
        setLoading(false);
      })
      .catch(() => { setLoadError(true); setLoading(false); });
  }, [initialData]);

  if (loadError) return <DataLoadError />;

  const providers = [...new Set(models.map(m => m.provider))].sort();

  const filtered = models.filter(m => {
    if (search && !matchesSearchQuery(search, m.name, m.provider, m.slug, m.llm_stats_model_id)) return false;
    if (tierFilter !== 'all' && m.tier !== tierFilter) return false;
    if (providerFilter !== 'all' && m.provider !== providerFilter) return false;
    return true;
  });

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 mb-2 inline-block">
          &larr; Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-zinc-100">All Models</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {loading
            ? 'Loading published models...'
            : `${models.filter((model) => !model.closed_source).length} open-weight and ${models.filter((model) => model.closed_source).length} closed or weight-unverified models.`}
        </p>
      </div>

      {snapshot && <div className="mb-4"><DataFreshnessBadge {...snapshot} /></div>}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <input
          type="text"
          placeholder="Search models..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm placeholder:text-zinc-600 focus:border-zinc-600 focus:ring-1 focus:ring-emerald-500/20 w-64"
        />
        <div className="flex items-center gap-1">
          {['all', 'S', 'A', 'B', 'C', 'D'].map(t => (
            <button
              key={t}
              onClick={() => setTierFilter(t)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                tierFilter === t ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t === 'all' ? 'All Tiers' : `Tier ${t}`}
            </button>
          ))}
        </div>
        <select
          value={providerFilter}
          onChange={e => setProviderFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs cursor-pointer"
        >
          <option value="all">All Providers</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="text-xs text-zinc-600 ml-auto">{loading ? 'Loading...' : `${filtered.length} models`}</span>
        {compareSlugs.length > 0 && (
          <Link
            href={`/compare?models=${compareSlugs.join(',')}`}
            className="px-2.5 py-1.5 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-500"
          >
            Compare {compareSlugs.length}
          </Link>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-zinc-800 rounded-lg">
        {loading ? (
          <div className="animate-pulse h-96" />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80">
                <th className="px-2 py-2 w-8" title="Add to Compare" />
                <th className="px-3 py-2 text-left text-zinc-400 font-medium min-w-[200px]">Model</th>
                <th className="px-2 py-2 text-center text-zinc-400 font-medium">Released</th>
                <th className="px-2 py-2 text-center text-zinc-400 font-medium">Params</th>
                <th className="px-2 py-2 text-center text-zinc-400 font-medium">Context</th>
                <th className="px-2 py-2 text-center text-zinc-400 font-medium">License</th>
                <th className="px-2 py-2 text-center text-zinc-400 font-medium">VRAM Q4</th>
                <th className="px-2 py-2 text-center text-zinc-400 font-medium">VRAM FP16</th>
                <th className="px-2 py-2 text-center text-zinc-400 font-medium" title="Published API pricing per 1M tokens, input / output">$/M in·out</th>
                <th className="px-2 py-2 text-center text-zinc-400 font-medium" title="Effort level of the model's best published legacy LiveBench v1 run">v1 Effort</th>
                <th className="px-2 py-2 text-center text-zinc-400 font-medium">Code Arena</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, i) => (
                <tr
                  key={m.slug || makeSlug(m.name)}
                  className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${i % 2 === 0 ? '' : 'bg-zinc-900/30'}`}
                >
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={compareSlugs.includes(m.slug)}
                      onChange={() => setCompareSlugs((current) => (
                        current.includes(m.slug)
                          ? current.filter((slug) => slug !== m.slug)
                          : [...current, m.slug]
                      ))}
                      className="rounded border-zinc-600 bg-zinc-800 text-emerald-500 cursor-pointer"
                      aria-label={`Compare ${m.name}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${TIER_COLORS[m.tier] || TIER_COLORS['D']}`}>
                        {m.tier}
                      </span>
                      <div>
                        <Link href={`/models/${m.slug || makeSlug(m.name)}`} className="text-zinc-200 hover:text-emerald-400 font-medium">
                          {m.name}
                        </Link>
                        <div className="text-[10px] text-zinc-600">{m.provider}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center text-zinc-500 tabular-nums"><ReleaseDate value={m.release} evidence={textReleaseEvidence(m)} /></td>
                  <td className="px-2 py-2 text-center text-zinc-400 tabular-nums">{m.params_b ? `${m.params_b}B` : '—'}</td>
                  <td className="px-2 py-2 text-center text-zinc-500 tabular-nums">{m.context_k ? `${m.context_k}K` : '—'}</td>
                  <td className="px-2 py-2 text-center text-zinc-500 text-[10px] truncate max-w-[80px]" title={m.license || ''}>{m.license || '—'}</td>
                  <td className="px-2 py-2 text-center text-zinc-400 tabular-nums">{m.vram_int4_gb ? `${m.vram_int4_gb}GB` : '—'}</td>
                  <td className="px-2 py-2 text-center text-zinc-500 tabular-nums">{m.vram_fp16_gb ? `${m.vram_fp16_gb}GB` : '—'}</td>
                  <td className="px-2 py-2 text-center text-zinc-400 tabular-nums">
                    {m.input_price_per_m != null && m.output_price_per_m != null
                      ? `$${m.input_price_per_m} / $${m.output_price_per_m}`
                      : '—'}
                  </td>
                  <td className="px-2 py-2 text-center text-zinc-500">{m.best_effort ?? '—'}</td>
                  <td className="px-2 py-2 text-center text-zinc-400 tabular-nums">{m.benchmarks.code_arena !== null ? Math.round(m.benchmarks.code_arena).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
