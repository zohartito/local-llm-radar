'use client';

import { siteLeaderboard, type SiteLeaderboardProps } from '@/lib/site-data';
import { textReleaseEvidence } from '@/lib/model-release';

import { defaultCategoryTest, buildBenchmarkRankings } from '@/lib/benchmark-comparisons';
import { benchmarkColumnFor } from '@/lib/benchmark-catalog';
import { ReleaseDate } from '@/components/ReleaseDate';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { DataLoadError } from '@/components/DataLoadError';
import { BenchmarkTable } from '@/components/BenchmarkTable';
import { DataFreshnessBadge, type DataSourceLabel } from '@/components/DataFreshnessBadge';
import { dedupeModelsBySlug, hasBenchmarkValues, LIVEBENCH_KEYS, type LeaderboardData, type LeaderboardModel } from '@/lib/leaderboard';

// Honesty fields added to the /api/leaderboard payload. Kept optional/defensive
// so the dashboard still renders if the API has not yet been deployed with them.
interface LeaderboardHonesty {
  usedFallback?: boolean;
  dataDate?: string | null;
  stale?: boolean;
  degradedSources?: string[];
  dataSourceLabel?: DataSourceLabel;
}

type LeaderboardResponse = LeaderboardData & LeaderboardHonesty;

// Follow the same edition selector as the table, Compare and Hardware.
const FRONTIER_BENCHMARKS = ['overall', 'coding', 'reasoning', 'agentic'].map(category => {
  const key = defaultCategoryTest(category);
  return { key, label: benchmarkColumnFor(key)!.label };
});

const NEW_ARRIVAL_WINDOW_DAYS = 30;

function isNewArrival(release: string | null | undefined): boolean {
  if (!release) return false;
  const releasedAt = Date.parse(release);
  if (!Number.isFinite(releasedAt)) return false;
  const ageDays = (Date.now() - releasedAt) / 86_400_000;
  return ageDays >= 0 && ageDays <= NEW_ARRIVAL_WINDOW_DAYS;
}

export default function Dashboard({ initialData }: SiteLeaderboardProps) {
  const [models, setModels] = useState<LeaderboardModel[]>([]);
  const [freshness, setFreshness] = useState<LeaderboardHonesty | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    siteLeaderboard(initialData)
      .then((data: LeaderboardResponse) => {
        setModels(dedupeModelsBySlug(data.models || []));
        setFreshness({
          dataSourceLabel: data.dataSourceLabel,
          dataDate: data.dataDate ?? data.updated ?? null,
          stale: data.stale,
          degradedSources: data.degradedSources,
        });
        setLoading(false);
      })
      .catch(() => { setLoadError(true); setLoading(false); });
  }, [initialData]);

  if (loadError) return <DataLoadError />;

  if (loading) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-800 rounded w-72" />
          <div className="h-4 bg-zinc-800 rounded w-96" />
          <div className="h-[600px] bg-zinc-900 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-bold text-zinc-100">Local LLM Radar</h1>
          <DataFreshnessBadge
            dataSourceLabel={freshness?.dataSourceLabel}
            dataDate={freshness?.dataDate}
            stale={freshness?.stale}
            degradedSources={freshness?.degradedSources}
          />
        </div>
        <p className="text-sm text-zinc-500 mt-1">
          Attributed benchmark aggregation from {[
            'ZeroEval',
            'LLM Stats Code Arena',
            'LMArena',
            ...(hasBenchmarkValues(models, LIVEBENCH_KEYS) ? ['LiveBench'] : []),
            'SWE-bench',
          ].join(', ')}.
          Category comparisons use one named benchmark and evaluator edition at a time. Capability Score remains an optional experimental index across different tests. Vendor-reported values are attributed; uncited archived benchmark numbers are excluded. Open-weight-only is one toggle away; the Hardware page estimates what might fit your machine.
        </p>
      </div>

      {/* CTA to hardware page — top of page */}
      <Link
        href="/hardware"
        className="mb-6 flex items-center gap-3 bg-gradient-to-r from-emerald-900/40 to-sky-900/40 border border-emerald-700/40 rounded-lg p-4 hover:border-emerald-600/60 transition-colors group"
      >
        <div className="w-10 h-10 rounded-lg bg-emerald-600/30 flex items-center justify-center text-lg shrink-0">
          &#9881;
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-zinc-100 group-hover:text-emerald-300 transition-colors">
            Which models might fit my machine?
          </div>
          <div className="text-xs text-zinc-500">
            Enter your Mac or PC specs to compare estimated memory fit and benchmark indices.
          </div>
        </div>
        <span className="text-zinc-500 group-hover:text-emerald-400 transition-colors text-lg">&rarr;</span>
      </Link>

      <Link href="/voice" className="mb-6 block rounded-lg border border-sky-800/50 bg-sky-950/20 p-4 hover:border-sky-600/60">
        <span className="text-sm font-semibold text-sky-200">Talk to your coding agents, or compare local voice models →</span>
        <p className="mt-1 text-xs text-zinc-400">PersonaPlex, MiniCPM-o, VoiceChat and speech bridges: runtime requirements, tool support and evidence for your GPUs and Mac.</p>
      </Link>

      {/* Frontier right now: per-source leaders + newest arrivals. */}
      {models.length > 0 && (() => {
        const leaders = FRONTIER_BENCHMARKS.flatMap(bench => {
          const result = buildBenchmarkRankings(models, 'overall', { benchmark: bench.key });
          const top = result.rankings.filter(row => row.rank === 1);
          return top.length ? [{ ...bench, models: top, value: top[0].score!, edition: result.cohort!.edition, participants: result.cohort!.participants }] : [];
        });

        const arrivals = models
          .filter((m) => isNewArrival(m.release))
          .sort((a, b) => b.release!.localeCompare(a.release!) || a.name.localeCompare(b.name))
          .slice(0, 6);

        return (
          <div className="mb-6">
            <div className="flex flex-wrap items-baseline gap-2 mb-2">
              <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">LiveBench 2.0 · top imported results</h2>
              <span className="text-[11px] text-zinc-600">
                Leaders among imported runs for the published edition. Overall uses the evaluator’s suite weights and requires a complete run. <a href="https://livebench.ai/" target="_blank" rel="noopener noreferrer" className="text-emerald-400 underline">Evaluator results and run settings</a>
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {leaders.length === 0 && <p className="col-span-full text-sm text-amber-300">No current-edition evaluator results are available in this snapshot.</p>}
              {leaders.map(({ key, label, models: topModels, value, edition, participants }) => (
                <div key={key} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                  <div className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1">{label} · {topModels.length > 1 ? 'joint top imported' : 'top imported'}</div>
                  {topModels.map(model => <div key={model.slug}>
                    <Link href={`/models/${model.slug}`} className="text-sm font-semibold text-zinc-100 hover:text-emerald-300">{model.name}</Link>
                    <div className="text-[10px] text-zinc-500">Released <ReleaseDate value={model.release} evidence={textReleaseEvidence(model)} /></div>
                    <div className="text-[10px] text-zinc-400">Dataset edition: {edition}</div>
                  </div>)}
                  <div className="text-[11px] text-zinc-400 font-mono tabular-nums">{value.toFixed(1)} · {participants} imported models</div>
                </div>
              ))}
            </div>
            {arrivals.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Reported releases · last 30 days:</span>
                {arrivals.map((m) => (
                  <Link
                    key={m.slug}
                    href={`/models/${m.slug}`}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-emerald-700/60 hover:text-emerald-300 transition-colors"
                    title={`Source-reported release ${m.release ?? 'recently'} — Capability Score ${m.composite_score}`}
                  >
                    {m.name} · <ReleaseDate value={m.release} evidence={textReleaseEvidence(m)} linked={false} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Tier legend with explanations */}
      <div className="flex flex-wrap items-center gap-4 mb-6 text-xs text-zinc-500">
        <span className="text-zinc-400 font-medium">Tiers:</span>
        {[
          { t: 'S', label: 'Index ≥75', desc: 'A fixed score band; not a task-quality or runtime guarantee' },
          { t: 'A', label: 'Index 60–75', desc: 'Capability Score at least 60 and below 75' },
          { t: 'B', label: 'Index 45–60', desc: 'Capability Score at least 45 and below 60' },
          { t: 'C', label: 'Index 30–45', desc: 'Capability Score at least 30 and below 45' },
          { t: 'D', label: 'Index <30', desc: 'Low index; may reflect sparse evidence, not speed or size' },
        ].map(({ t, label, desc }) => (
          <span key={t} className="flex items-center gap-1" title={desc}>
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${
              t === 'S' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
              t === 'A' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
              t === 'B' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' :
              t === 'C' ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' :
              'bg-zinc-500/20 text-zinc-400 border-zinc-500/40'
            }`}>{t}</span>
            <span>{label}</span>
          </span>
        ))}
        <span className="ml-auto text-zinc-600">Click any column header to sort</span>
      </div>

      <BenchmarkTable models={models} />
    </div>
  );
}
