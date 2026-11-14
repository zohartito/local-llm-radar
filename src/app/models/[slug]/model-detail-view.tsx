'use client';

import { siteLeaderboard, type SiteLeaderboardProps } from '@/lib/site-data';
import { textReleaseEvidence } from '@/lib/model-release';

import { ReleaseDate } from '@/components/ReleaseDate';
import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { DataLoadError } from '@/components/DataLoadError';
import { DataFreshnessBadge } from '@/components/DataFreshnessBadge';
import { MetadataDisclosure } from '@/components/MetadataDisclosure';
import {
  findModelBySlug,
  getBenchmarkValue,
  type LeaderboardData,
  type LeaderboardModel,
} from '@/lib/leaderboard';
import {
  DEFAULT_HARDWARE_PROFILES,
  buildHardwareRecommendations,
  computeHardwareFit,
  summarizeHardwareSpec,
} from '@/lib/hardware';
import type { LLMStatsModelScorecard } from '@/lib/live-sources';
import { safeScorecardLink, scorecardFromApiResponse } from '@/lib/scorecard-response';
import { benchmarkSourceKind, BENCHMARK_COLUMNS } from '@/lib/benchmark-catalog';

const BENCHMARK_CATEGORIES: Record<string, string> = {
  livebench_global: 'Composite',
  livebench_coding: 'Coding',
  livebench_reasoning: 'Reasoning',
  livebench_mathematics: 'Math',
  livebench_agentic_coding: 'Agentic',
  livebench_data_analysis: 'Analysis',
  livebench_language: 'Language',
  livebench_if: 'Chat',
  swe_bench: 'Coding',
  swe_bench_pro: 'Coding',
  deepswe: 'Coding',
  terminal_bench: 'Agentic',
  mcp_atlas: 'Agentic',
  toolathlon: 'Agentic',
  browsecomp: 'Agentic',
  bfcl: 'Agentic',
  ifeval: 'Chat',
  gpqa_diamond: 'Reasoning',
  hle_no_tools: 'Reasoning',
  hle_tools: 'Agentic',
  hle: 'Unspecified',
  mmlu_pro: 'Knowledge',
  arc_agi: 'Reasoning',
  simpleqa: 'Knowledge',
  frontier_math: 'Math',
  aime_2026: 'Math',
  aime_2025: 'Math',
  math_500: 'Math',
  mgsm: 'Math',
  livecodebench: 'Coding',
  humaneval: 'Coding',
  codeforces_elo: 'Coding',
  code_arena: 'Coding',
  arena_elo: 'Chat',
};

// Model detail pages use the same complete benchmark inventory as both
// leaderboard tables. This prevents the detail view from silently merging
// test years or hiding agent/tool benchmarks that the user can sort elsewhere.
const BENCHMARK_META = BENCHMARK_COLUMNS.map((column) => ({
  key: column.key,
  label: column.label,
  desc: column.tooltip,
  category: BENCHMARK_CATEGORIES[column.key] ?? 'Other',
  isElo: column.isElo,
}));

const TIER_COLORS: Record<string, string> = {
  'S': 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  'A': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  'B': 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  'C': 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  'D': 'bg-zinc-500/20 text-zinc-400 border-zinc-500/40',
};

const TIER_LABELS: Record<string, string> = {
  'S': 'Index ≥75',
  'A': 'Index 60–75',
  'B': 'Index 45–60',
  'C': 'Index 30–45',
  'D': 'Index <30',
};

function formatScorecardRaw(score: number | null, maxScore: number | null): string {
  if (score === null) return '—';
  if (maxScore !== null) {
    const precision = maxScore <= 1 ? 3 : maxScore <= 10 ? 2 : 1;
    return `${score.toFixed(precision)} / ${maxScore}`;
  }
  return score.toFixed(score >= 100 ? 0 : 3);
}

function formatScorecardNormalized(value: number | null): string {
  if (value === null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-').map(Number);
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(year, month - 1, day)));
    }
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return value;
  }
}

function hostLabel(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export default function ModelDetailPage({ params, initialData }: SiteLeaderboardProps & { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [model, setModel] = useState<LeaderboardModel | null>(null);
  const [allModels, setAllModels] = useState<LeaderboardModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<LeaderboardData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [showRawSources, setShowRawSources] = useState(true);
  const [scorecard, setScorecard] = useState<LLMStatsModelScorecard | null>(null);
  const [scorecardLoading, setScorecardLoading] = useState(false);
  const [scorecardError, setScorecardError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(false);
      setModel(null);
      setScorecard(null);
      setScorecardError(null);
      setScorecardLoading(false);

      let catalogLoaded = false;
      try {
        const data: LeaderboardData = await siteLeaderboard(initialData);
        if (cancelled) return;

        const models = data.models || [];
        const selected = findModelBySlug(models, slug);
        setAllModels(models);
        setSnapshot(data);
        setModel(selected);
        catalogLoaded = true;
        setLoading(false);

        if (!selected?.llm_stats_model_id) {
          return;
        }

        setScorecardLoading(true);
        const scorecardResponse = await fetch(`/api/models/${encodeURIComponent(selected.slug || slug)}/scorecard`);
        const payload = await scorecardResponse.json().catch(() => null);
        if (cancelled) return;

        if (!scorecardResponse.ok) {
          setScorecardError(payload?.error || 'Failed to load published scorecard');
          return;
        }

        const publishedScorecard = scorecardFromApiResponse(payload);
        if (!publishedScorecard) {
          setScorecardError('No published scorecard is available for this model yet.');
          return;
        }
        setScorecard(publishedScorecard);
      } catch {
        if (cancelled) return;
        if (catalogLoaded) setScorecardError('Published scorecard is unavailable. The catalog results remain visible.');
        else setLoadError(true);
        setLoading(false);
      } finally {
        if (!cancelled) setScorecardLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug, initialData]);

  if (loadError) return <DataLoadError />;

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-800 rounded w-64" />
          <div className="h-64 bg-zinc-900 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center">
        <h1 className="text-xl text-zinc-300">{['command-a', 'mai-1-preview'].includes(slug) ? 'Model link withdrawn' : 'Model not found'}</h1>
        <p className="text-sm text-zinc-500 mt-2">
          {['command-a', 'mai-1-preview'].includes(slug)
            ? 'This older URL combined reports for different models. It was withdrawn to avoid showing another model’s scores under this name. Browse the catalog for a specific release.'
            : <>No model matching &ldquo;{slug}&rdquo; is present in the current snapshot.</>}
        </p>
        <Link href="/models" className="text-emerald-400 hover:underline mt-4 inline-block">
          Browse model catalog
        </Link>
      </div>
    );
  }

  const totalTrackedBenchmarks = BENCHMARK_META.length;
  const scorecardResources = scorecard ? [
    { label: 'Announcement', url: scorecard.sources.api_ref || null },
    { label: 'Scorecard blog', url: scorecard.sources.scorecard_blog || null },
    { label: 'Weights', url: scorecard.sources.weights || null },
    { label: 'Playground', url: scorecard.sources.playground || null },
    { label: 'Paper', url: scorecard.sources.paper || null },
  ].map((entry) => ({ label: entry.label, url: safeScorecardLink(entry.url) }))
    .filter((entry): entry is { label: string; url: string } => entry.url !== null) : [];

  const ranges: Record<string, { best: number; worst: number }> = {};
  for (const bm of BENCHMARK_META) {
    const vals = allModels
      .map((entry) => getBenchmarkValue(entry, bm.key))
      .filter((value): value is number => value !== null);
    ranges[bm.key] = vals.length > 0
      ? { best: Math.max(...vals), worst: Math.min(...vals) }
      : { best: 100, worst: 0 };
  }

  const availableBenchmarks = BENCHMARK_META.filter((benchmark) => getBenchmarkValue(model, benchmark.key) !== null);
  const hwFits = (model.closed_source ? [] : DEFAULT_HARDWARE_PROFILES)
    .map((profile) => {
      const fit = computeHardwareFit(model, profile.spec);
      return fit ? { profile, fit } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const hardwareRecommendations = model.closed_source ? [] : buildHardwareRecommendations(model);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 mb-2 inline-block">
          &larr; Dashboard
        </Link>
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <span className={`inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold border ${TIER_COLORS[model.tier] || TIER_COLORS['D']}`}>
            {model.tier}
          </span>
          <h1 className="text-2xl font-bold text-zinc-100">{model.name}</h1>
          {model.vision && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">Vision</span>}
          {model.moe_active_b && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">MoE</span>}
        </div>
        <p className="text-sm text-zinc-500">
          {model.provider} &middot; Tier {model.tier} ({TIER_LABELS[model.tier] || 'Unknown'})
          <> &middot; Released <ReleaseDate value={model.release} evidence={textReleaseEvidence(model)} /></>
          <span> &middot; {availableBenchmarks.length}/{totalTrackedBenchmarks} displayed benchmarks filled</span>
        </p>
      </div>

      {snapshot && <div className="mb-4"><DataFreshnessBadge {...snapshot} /></div>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        {[
          { label: 'Parameters', value: model.params_b ? `${model.params_b}B` : '—', sub: model.moe_active_b ? `${model.moe_active_b}B active (MoE)` : null },
          { label: 'Context', value: model.context_k ? `${model.context_k}K tokens` : '—', sub: 'reported limit; runtime dependent' },
          { label: 'VRAM (Q4)', value: model.vram_int4_gb ? `${model.vram_int4_gb}GB` : '—', sub: model.vram_fp16_gb ? `FP16: ${model.vram_fp16_gb}GB` : null },
          { label: 'License', value: model.license || '—', sub: 'reported license; inspect the terms' },
          {
            label: 'API Price',
            value: model.input_price_per_m != null && model.output_price_per_m != null
              ? `From $${model.input_price_per_m} / $${model.output_price_per_m}`
              : '—',
            sub: model.input_price_per_m != null ? 'USD per 1M input / output tokens · reported; verify provider rates' : 'no published pricing',
          },
        ].map((s) => (
          <div key={s.label} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{s.label}</div>
            <div className="text-base sm:text-lg font-semibold text-zinc-200 break-words">{s.value}</div>
            {s.sub && <div className="text-[10px] text-zinc-500 mt-0.5">{s.sub}</div>}
          </div>
        ))}
      </div>

      <MetadataDisclosure observations={model.metadata_sources} sources={snapshot?.sources} />

      {(model.effort_variants ?? []).length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Effort Levels</h2>
            <span className="text-[11px] text-zinc-600">
              Published legacy LiveBench v1 runs per reasoning effort — score and measured run cost
            </span>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Effort</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">LiveBench Global</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Coding</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Reasoning</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Run Cost (Measured)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {(model.effort_variants ?? []).map((variant, index) => (
                  <tr key={variant.variant_name} className="hover:bg-zinc-800/30">
                    <td className="px-4 py-2">
                      <span className="text-zinc-200 font-medium">{variant.effort}</span>
                      {index === 0 && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          best score
                        </span>
                      )}
                      <div className="text-[10px] text-zinc-600 font-mono">{variant.variant_name}</div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-zinc-200">
                      {variant.livebench_global !== null ? variant.livebench_global.toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-zinc-400">
                      {variant.livebench_coding !== null ? variant.livebench_coding.toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-zinc-400">
                      {variant.livebench_reasoning !== null ? variant.livebench_reasoning.toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-zinc-300">
                      {variant.run_cost_usd !== null ? `$${variant.run_cost_usd.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-zinc-800 text-[10px] text-zinc-600">
              Run cost is LiveBench&rsquo;s measured spend for its full benchmark suite at that effort.
              Cost depends on the provider, token use, and evaluation configuration; it is not a throughput measurement.
            </div>
          </div>
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Benchmark Scores</h2>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-600">
              Selected published values
            </span>
            <button
              onClick={() => setShowRawSources((value) => !value)}
              className="px-2.5 py-1 rounded text-[11px] font-medium bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              {showRawSources ? 'Hide raw source values' : 'Show raw source values'}
            </button>
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Benchmark</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Category</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Score</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase w-40">Relative</th>
                {showRawSources && <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Sources</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {BENCHMARK_META.map((bm) => {
                const val = getBenchmarkValue(model, bm.key);
                const rawSources = model.benchmark_sources?.[bm.key] || [];
                const range = ranges[bm.key];
                const ratio = val !== null && range.best !== range.worst
                  ? (val - range.worst) / (range.best - range.worst)
                  : null;

                let colorClass = 'text-zinc-600';
                if (ratio !== null) {
                  if (ratio >= 0.8) colorClass = 'text-emerald-400';
                  else if (ratio >= 0.6) colorClass = 'text-emerald-500/80';
                  else if (ratio >= 0.4) colorClass = 'text-zinc-300';
                  else if (ratio >= 0.2) colorClass = 'text-orange-400/80';
                  else colorClass = 'text-red-400/80';
                }

                return (
                  <tr key={bm.key} className="hover:bg-zinc-800/30">
                    <td className="px-4 py-2">
                      <div className="text-zinc-300 font-medium">{bm.label}</div>
                      <div className="text-[10px] text-zinc-600">{bm.desc}</div>
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-500">{bm.category}</td>
                    <td className={`px-4 py-2 text-right font-mono tabular-nums ${colorClass}`}>
                      {val !== null
                        ? (bm.isElo ? Math.round(val).toLocaleString() : `${val.toFixed(1)}%`)
                        : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {ratio !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                ratio >= 0.8 ? 'bg-emerald-400' :
                                ratio >= 0.6 ? 'bg-emerald-500/80' :
                                ratio >= 0.4 ? 'bg-zinc-400' :
                                ratio >= 0.2 ? 'bg-orange-400' :
                                'bg-red-400'
                              }`}
                              style={{ width: `${Math.max(ratio * 100, 2)}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-zinc-600 w-8 text-right">{Math.round(ratio * 100)}%</span>
                        </div>
                      ) : (
                        <span className="text-zinc-700 text-xs">N/A</span>
                      )}
                    </td>
                    {showRawSources && (
                      <td className="px-4 py-2 align-top">
                        {rawSources.length > 0 ? (
                          <div className="space-y-1">
                            {rawSources.length > 1 && (
                              <div className="text-[10px] text-zinc-600">
                                {rawSources.length} reports; selected value marked below
                              </div>
                            )}
                            {rawSources.map((source) => (
                              <div key={`${bm.key}-${source.source_id}-${source.model_name}`} className="text-[11px] leading-4">
                                <span className="text-zinc-300">{source.source_name}{source.selected ? " · selected" : ""} · {benchmarkSourceKind(source.source_id)}</span>
                                <span className="text-zinc-600"> · {source.model_name}{source.effort ? ' · ' + source.effort + ' effort' : ''}</span>
                                <span className="text-zinc-400">
                                  {' '}· {bm.isElo ? Math.round(source.value).toLocaleString() : `${source.value.toFixed(1)}%`}
                                </span>
                                {source.data_date && <span className="ml-1 text-zinc-500">· source date {source.data_date}</span>}
                                {source.is_fallback && (
                                  <span className="ml-1 text-[10px] text-amber-400">fallback</span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-zinc-700 text-xs">N/A</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Published Scorecard Benchmarks</h2>
            <p className="text-xs text-zinc-600 mt-1">
              Extra published benchmarks from the model&apos;s public LLM Stats page. These can include self-reported provider numbers, so they are shown separately from the selected results above.
            </p>
          </div>
          {scorecard && (
            <div className="text-[11px] text-zinc-500">
              {scorecard.organization || model.provider}
              {formatDate(scorecard.release_date) && <span> · {formatDate(scorecard.release_date)}</span>}
            </div>
          )}
        </div>

        {scorecardLoading ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 animate-pulse">
            <div className="h-4 w-48 rounded bg-zinc-800 mb-3" />
            <div className="h-28 rounded bg-zinc-950" />
          </div>
        ) : scorecard ? (
          <div className="space-y-3">
            {scorecardResources.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {scorecardResources.map((resource) => (
                  <a
                    key={resource.label}
                    href={resource.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                  >
                    <span>{resource.label}</span>
                    <span className="text-zinc-600">{hostLabel(resource.url)}</span>
                  </a>
                ))}
              </div>
            )}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-x-auto" role="region" aria-label="Published scorecard benchmarks" tabIndex={0}>
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-800">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Benchmark</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Normalized</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Raw</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {scorecard.benchmarks.map((entry) => {
                    const sourceUrl = safeScorecardLink(entry.source_url);
                    const sourceHost = hostLabel(sourceUrl);
                    const statusClasses = entry.verified
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : entry.self_reported
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30';

                    return (
                      <tr key={entry.benchmark_id} className="hover:bg-zinc-800/30">
                        <td className="px-4 py-2">
                          <div className="text-zinc-300 font-medium">{entry.name}</div>
                          <div className="text-[10px] text-zinc-600">
                            {entry.categories.join(', ') || 'uncategorized'}
                            {entry.analysis_method && <span> · {entry.analysis_method}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-zinc-300">
                          {formatScorecardNormalized(entry.normalized_score)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-zinc-500">
                          {formatScorecardRaw(entry.score, entry.max_score)}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${statusClasses}`}>
                            {entry.verified ? 'Marked verified by source' : entry.self_reported ? 'Self-reported' : 'Published'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-[11px] text-zinc-400">
                          {sourceUrl ? (
                            <a href={sourceUrl} target="_blank" rel="noreferrer" className="hover:text-zinc-200">
                              {sourceHost || sourceUrl}
                            </a>
                          ) : (
                            <span className="text-zinc-700">N/A</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-500">
            {scorecardError || 'No linked published scorecard is available for this model yet.'}
          </div>
        )}
      </div>

      {hardwareRecommendations.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">What It Takes To Run Locally</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {hardwareRecommendations.map((entry) => (
              <div key={entry.key} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <div className="text-sm font-semibold text-zinc-200 mb-1">{entry.label}</div>
                <div className="text-[11px] text-zinc-600 mb-3">{entry.note}</div>
                <div className="space-y-1.5 text-sm text-zinc-400">
                  <div><span className="text-zinc-500">Quality target:</span> {entry.quant}</div>
                  <div><span className="text-zinc-500">GPU route:</span> {entry.gpuPlan}</div>
                  <div><span className="text-zinc-500">Unified memory:</span> {entry.unifiedMemoryGb}GB</div>
                  <div><span className="text-zinc-500">CPU-only RAM:</span> ~{entry.cpuOnlyRamGb}GB</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-8">
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Estimated Hardware Fits</h2>
        {model.closed_source && <p className="text-sm text-zinc-500 mb-3">Local fit recommendations require verified downloadable weights. This model is closed or its weight availability is unverified.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {hwFits.map((entry) => (
            <div
              key={entry.profile.slug}
              className={`border rounded-lg p-4 ${
                entry.fit.fit === 'fits-well' ? 'border-emerald-800/50 bg-emerald-950/10' :
                entry.fit.fit === 'borderline' ? 'border-amber-800/50 bg-amber-950/10' :
                'border-red-800/50 bg-red-950/10'
              }`}
            >
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="text-sm font-medium text-zinc-300">{entry.profile.name}</span>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                  entry.fit.fit === 'fits-well' ? 'bg-emerald-900/40 text-emerald-400' :
                  entry.fit.fit === 'borderline' ? 'bg-amber-900/40 text-amber-400' :
                  'bg-red-900/40 text-red-400'
                }`}>
                  {entry.fit.fit === 'fits-well' ? 'Estimated fit' : entry.fit.fit === 'borderline' ? 'Tight estimate' : 'Too Large'}
                </span>
              </div>
              <div className="text-[11px] text-zinc-600 mb-2">{summarizeHardwareSpec(entry.profile.spec)}</div>
              <p className="text-xs text-zinc-500">{entry.fit.explanation}</p>
              <p className="text-xs text-zinc-400 mt-1">Estimated fitting quantization: {entry.fit.bestQuant}</p>
              <p className="text-[11px] text-zinc-600 mt-2">{entry.fit.speedHint}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-8">
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
          Why This Model Ranks Where It Does
        </h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-400 space-y-2">
          <p>
            <strong className="text-zinc-300">{model.name}</strong> is rated <strong className="text-zinc-300">Tier {model.tier}</strong> ({TIER_LABELS[model.tier]}) based on fixed thresholds in our weighted index. This is not a guarantee of task quality, deployment readiness, or statistical superiority.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Scores across {availableBenchmarks.length} of {BENCHMARK_META.length} tracked leaderboard benchmarks</li>
            <li>Raw per-source values are available in the benchmark table so you can inspect the attribution behind each number</li>
            {scorecard && <li>{scorecard.benchmarks.length} extra published scorecard benchmarks are available below, including vendor-reported and display-only tests</li>}
            {model.benchmarks.code_arena !== null && <li>Code Arena score of {Math.round(model.benchmarks.code_arena).toLocaleString()} from public human votes on coding tasks</li>}
            {model.benchmarks.arena_elo !== null && <li>LMArena ELO of {Math.round(model.benchmarks.arena_elo).toLocaleString()} from overall human preference votes</li>}
            {model.benchmarks.swe_bench !== null && <li>SWE-bench score of {model.benchmarks.swe_bench}% on real-world software engineering tasks</li>}
            {model.params_b && <li>Parameter count of {model.params_b}B{model.moe_active_b ? ` (MoE: only ${model.moe_active_b}B active per token)` : ''} — useful for estimating the memory tier needed to run it locally</li>}
            {model.vision && <li>Supports vision/image input — can process screenshots, diagrams, and photos</li>}
            {model.vram_int4_gb && <li>~{model.vram_int4_gb}GB VRAM at Q4 quantization</li>}
          </ul>
          <p className="text-zinc-500 text-xs mt-3">
            The ranking table above selects published results, preferring direct evaluators to aggregators. Uncited archived benchmark values are excluded. The published scorecard section is there to fill in extra real numbers without pretending they were independently verified by the same source set.
          </p>
        </div>
      </div>

      <Link href="/" className="text-emerald-400 hover:underline text-sm">
        &larr; Back to dashboard
      </Link>
    </div>
  );
}
