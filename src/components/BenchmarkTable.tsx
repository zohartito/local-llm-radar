'use client';

import { textReleaseEvidence } from '@/lib/model-release';

import { compareReleaseDates } from '@/lib/model-release';
import { ReleaseDate } from '@/components/ReleaseDate';
import { useState } from 'react';
import Link from 'next/link';
import { benchmarkColorClass, leaderboardStyles, providerButtonClass, rankingCardClass } from './leaderboard-presentation';
import {
  CATEGORY_DEFINITIONS,
  columnsWithPublishedValues,
  getBenchmarkValue,
  computeLeaderboardCategoryScore,
  hasBenchmarkValues,
  LIVEBENCH_KEYS,
  type LeaderboardModel,
} from '@/lib/leaderboard';
import { BENCHMARK_COLUMNS, benchmarkColumnFor, benchmarkProvenanceLabel } from '@/lib/benchmark-catalog';
import { CATEGORY_TESTS, comparisonCohorts, comparisonValue, comparisonRanks, comparisonTestLabel, comparisonCategoryLabel, defaultCategoryTest } from '@/lib/benchmark-comparisons';
import { matchesSearchQuery } from '@/lib/search';

type ModelEntry = LeaderboardModel;

// Headline Local Dev Score. Lives on the model as a top-level field (0–100),
// not inside `benchmarks`, so it is handled separately from BENCHMARK_COLS.
const COMPOSITE_KEY = 'composite_score';

const TIER_COLORS: Record<string, string> = {
  'S': 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  'A': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  'B': 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  'C': 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  'D': 'bg-zinc-500/20 text-zinc-400 border-zinc-500/40',
};

function ScoreCell({ value, isElo, best, worst, primary, provenance, curated }: {
  value: number | null;
  isElo?: boolean;
  best: number;
  worst: number;
  primary?: boolean;
  provenance?: string;
  curated?: boolean;
}) {
  const borderClass = primary ? 'border-l-2 border-l-emerald-500/40 bg-emerald-950/10' : '';
  if (value === null || value === undefined) {
    return <td className={`px-2 py-1.5 text-center text-zinc-700 ${borderClass}`}>—</td>;
  }

  const colorClass = benchmarkColorClass(value, best, worst);

  const display = isElo ? Math.round(value).toLocaleString() : `${value.toFixed(1)}%`;

  return (
    <td title={provenance} className={`px-2 py-1.5 text-center text-xs tabular-nums ${colorClass} ${borderClass}`}>
      {display}{curated && <sup aria-label="curated fallback">*</sup>}
    </td>
  );
}

// Composite cell: the headline 0–100 Local Dev Score. Color-graded green→red
// like benchmark cells, but always on a fixed 0–100 scale and visually emphasized.
function CompositeCell({ value }: { value: number | null }) {
  const borderClass = 'border-l-2 border-l-emerald-500/40 bg-emerald-950/10';
  if (value === null || value === undefined) {
    return <td className={`px-2 py-1.5 text-center text-zinc-700 ${borderClass}`}>—</td>;
  }

  const ratio = Math.max(0, Math.min(1, value / 100));
  let colorClass = 'text-zinc-300';
  if (ratio >= 0.8) colorClass = 'text-emerald-400 font-semibold';
  else if (ratio >= 0.6) colorClass = 'text-emerald-500/80 font-medium';
  else if (ratio >= 0.4) colorClass = 'text-zinc-300';
  else if (ratio >= 0.2) colorClass = 'text-orange-400/80';
  else colorClass = 'text-red-400/80';

  return (
    <td className={`px-2 py-1.5 text-center text-sm tabular-nums ${colorClass} ${borderClass}`}>
      {value.toFixed(1)}
    </td>
  );
}

// Per-row trust chip: a 5-dot coverage meter (how many tracked benchmarks back
// this row) plus a single confidence dot (green/amber/grey). Makes a thin,
// single-source number look visibly different from a well-supported one.
function ConfidenceChip({ confidence, coverage }: { confidence: number | null; coverage: number | null }) {
  const cov = coverage === null || coverage === undefined ? null : Math.max(0, Math.min(1, coverage));
  const conf = confidence === null || confidence === undefined ? null : Math.max(0, Math.min(1, confidence));

  const filledDots = cov === null ? 0 : Math.round(cov * 5);

  // Confidence is now reliability-weighted coverage (supportSum / 14 tracked
  // keys), so it is strictly monotone in evidence and its practical ceiling is
  // set by how many benchmarks anyone actually publishes — the best-measured
  // model in the field reads ~0.47, not ~1.0. Thresholds are calibrated to that
  // real range so the dot stays informative instead of grading everything low.
  let confDot = 'bg-zinc-700';
  let confLabel = 'unknown';
  if (conf !== null) {
    if (conf >= 0.45) { confDot = 'bg-emerald-400'; confLabel = 'high'; }
    else if (conf >= 0.25) { confDot = 'bg-amber-400'; confLabel = 'medium'; }
    else { confDot = 'bg-zinc-500'; confLabel = 'low'; }
  }

  const coveragePct = cov === null ? 'unknown' : `${Math.round(cov * 100)}%`;
  const title = `Evidence coverage: ${confLabel}${conf !== null ? ` (${Math.round(conf * 100)}%)` : ''} · Benchmark coverage: ${coveragePct}`;

  return (
    <td className="px-2 py-1.5" title={title}>
      <div className="flex items-center justify-center gap-1.5">
        <span className="flex items-center gap-0.5" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={`w-1 h-2.5 rounded-sm ${i < filledDots ? 'bg-sky-400/80' : 'bg-zinc-800'}`}
            />
          ))}
        </span>
        <span className={`w-2 h-2 rounded-full ${confDot}`} aria-hidden="true" />
      </div>
    </td>
  );
}

// Published benchmark numbers are effort-specific: on the 2026-06-25 LiveBench
// table, gemini-3.1-pro-preview-HIGH and claude-fable-5-MAX-EFFORT sit in the
// same list as bare grok-4.6 and kimi-k3, which are standard-effort runs.
// Ranking those together while hiding the label makes an unequal comparison look
// equal, so the effort a row was measured at is shown next to the model name.
const ELEVATED_EFFORTS = new Set(['max', 'xhigh', 'high', 'thinking']);

function EffortBadge({ model }: { model: ModelEntry }) {
  const effort = model.best_effort;
  if (!effort) return null;

  const elevated = ELEVATED_EFFORTS.has(effort.toLowerCase());
  const cost = model.effort_variants?.[0]?.run_cost_usd ?? null;
  const costText = typeof cost === 'number' ? ` · benchmark run cost $${Math.round(cost).toLocaleString()}` : '';

  return (
    <span
      className={`text-[8px] px-1 py-0.5 rounded border uppercase ${
        elevated
          ? 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30'
          : 'bg-zinc-800 text-zinc-400 border-zinc-700'
      }`}
      title={`Legacy LiveBench v1 run at "${effort}" reasoning effort${costText}. Rows measured at different effort levels are not directly comparable.`}
    >
      {effort}
    </span>
  );
}

const PAGE_SIZE = 50;
const LOW_COVERAGE_THRESHOLD = 4;

export function BenchmarkTable({ models, initialCategory = 'overall' }: { models: ModelEntry[]; initialCategory?: string }) {
  const [sortKey, setSortKey] = useState<string | null>(defaultCategoryTest(initialCategory));
  const [testKey, setTestKey] = useState(defaultCategoryTest(initialCategory));
  const [cohortId, setCohortId] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [useCase, setUseCase] = useState<string>(initialCategory);
  // Default to the FULL board including closed APIs. Opening on open-weight-only
  // hid the frontier — a first-time visitor saw Kimi/GLM/Qwen and none of the
  // models the field is actually measured against, which reads as a broken or
  // out-of-date leaderboard rather than a deliberate filter. "Open-weight only"
  // is one click away and the Hardware page answers what actually runs locally.
  const [showClosed, setShowClosed] = useState(true);
  const [page, setPage] = useState(0);

  const openModels = models.filter(m => !m.closed_source);
  const closedModels = models.filter(m => m.closed_source);
  const hasClosedModels = closedModels.length > 0;

  const visibleModels = showClosed ? models : openModels;

  const providers = [...new Set(visibleModels.map(m => m.provider))].sort();
  const activeCat = CATEGORY_DEFINITIONS.find((category) => category.key === useCase) || CATEGORY_DEFINITIONS[0];
  const indexMode = testKey === 'index';
  const cohorts = comparisonCohorts(models, testKey);
  const cohort = (cohortId ? cohorts.find(group => group.id === cohortId) : cohorts[0]) ?? null;
  const ranks = comparisonRanks(visibleModels, cohort);
  const selectedColumn = benchmarkColumnFor(testKey);
  const visibleCols = columnsWithPublishedValues(BENCHMARK_COLUMNS, models).filter(col => indexMode || !cohort || col.key !== testKey);
  const testOptions = [...new Set([...(CATEGORY_TESTS[activeCat.key] ?? []), ...(!indexMode ? [testKey] : [])])];

  const filtered = visibleModels.filter((model) => {
    if (providerFilter !== 'all' && model.provider !== providerFilter) return false;
    if (search && !matchesSearchQuery(search, model.name, model.provider, model.slug, model.llm_stats_model_id)) return false;
    return true;
  });

  const categoryScores = new Map(filtered.map(model => [model.slug, computeLeaderboardCategoryScore(model, activeCat.key)]));
  const categorySort = indexMode && activeCat.key !== 'overall';
  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === 'release') return compareReleaseDates(a.release, b.release, sortDir);
    // If a specific column header is clicked, sort by that
    if (sortKey) {
      let aVal: number | null = null;
      let bVal: number | null = null;

      if (sortKey === 'name') {
        return sortDir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      } else if (sortKey === COMPOSITE_KEY) {
        aVal = a.composite_score ?? null;
        bVal = b.composite_score ?? null;
      } else if (sortKey === 'params') {
        aVal = a.params_b;
        bVal = b.params_b;
      } else if (sortKey === 'vram') {
        aVal = a.vram_int4_gb;
        bVal = b.vram_int4_gb;
      } else {
        aVal = cohort ? comparisonValue(a, cohort) : getBenchmarkValue(a, sortKey);
        bVal = cohort ? comparisonValue(b, cohort) : getBenchmarkValue(b, sortKey);
      }

      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    }

    // Weighted-index mode is an explicit opt-in, never a comparable-test rank.
    const aScore = categoryScores.get(a.slug) ?? -1;
    const bScore = categoryScores.get(b.slug) ?? -1;
    return bScore - aScore;
  });


  // Compute best/worst per column for color scaling (across all visible)
  const ranges: Record<string, { best: number; worst: number }> = {};
  for (const col of BENCHMARK_COLUMNS) {
    const values = visibleModels.map(m => getBenchmarkValue(m, col.key)).filter((v): v is number => v !== null);
    if (values.length > 0) {
      ranges[col.key] = { best: Math.max(...values), worst: Math.min(...values) };
    } else {
      ranges[col.key] = { best: 100, worst: 0 };
    }
  }

  function handleSort(key: string) {
    if (benchmarkColumnFor(key) && key !== testKey) { setTestKey(key); setCohortId(''); }
    if (key === COMPOSITE_KEY) setTestKey('index');
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(0);
  }

  function handleCategoryChange(key: string) {
    setUseCase(key);
    setTestKey(defaultCategoryTest(key));
    setCohortId('');
    setSortKey(defaultCategoryTest(key));
    setSortDir('desc');
    setPage(0);
  }

  const sortArrow = (key: string) =>
    sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  return (
    <div>
      {/* Category ranking tabs */}
      <div className="mb-4">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Compare by category</div>
        <p className="mb-3 text-xs text-zinc-400">
          Each category opens one named test. Only results from the same evaluator and edition receive a position; missing results stay unranked. <Link href="/methodology" className="text-emerald-400 underline">How scores work</Link>
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
          {CATEGORY_DEFINITIONS.map(cat => {
            const active = useCase === cat.key;
            const colorMap: Record<string, { border: string; bg: string; text: string; ring: string }> = {
              emerald: { border: 'border-emerald-700/60', bg: 'bg-emerald-950/30', text: 'text-emerald-400', ring: 'ring-emerald-500/30' },
              sky: { border: 'border-sky-700/60', bg: 'bg-sky-950/30', text: 'text-sky-400', ring: 'ring-sky-500/30' },
              rose: { border: 'border-rose-700/60', bg: 'bg-rose-950/30', text: 'text-rose-400', ring: 'ring-rose-500/30' },
              violet: { border: 'border-violet-700/60', bg: 'bg-violet-950/30', text: 'text-violet-400', ring: 'ring-violet-500/30' },
              amber: { border: 'border-amber-700/60', bg: 'bg-amber-950/30', text: 'text-amber-400', ring: 'ring-amber-500/30' },
              teal: { border: 'border-teal-700/60', bg: 'bg-teal-950/30', text: 'text-teal-400', ring: 'ring-teal-500/30' },
            };
            const c = colorMap[cat.color] || colorMap.emerald;
            return (
              <div
                key={cat.key}
                className={rankingCardClass(active, cat.color)}
              >
                <button
                  onClick={() => handleCategoryChange(cat.key)}
                  className="block w-full text-left cursor-pointer"
                  title={`Compare ${comparisonCategoryLabel(cat.key)} using ${comparisonTestLabel(defaultCategoryTest(cat.key))}`}
                >
                  <div className={`text-[11px] font-semibold ${active ? c.text : 'text-zinc-400'} mb-0.5`}>
                    {comparisonCategoryLabel(cat.key)}
                  </div>
                  <div className="text-[9px] text-zinc-600 mb-1.5">{comparisonTestLabel(defaultCategoryTest(cat.key))}</div>
                </button>
                <Link
                  href={`/category/${cat.key}`}
                  className="mt-1.5 inline-block text-[9px] text-zinc-500 hover:text-emerald-400 transition-colors"
                >
                  View comparison &rarr;
                </Link>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mb-4 space-y-2" aria-label="Benchmark comparison">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2 text-zinc-400">
            Compare using
            <select aria-label="Comparison test" value={testKey} onChange={event => {
              const key = event.target.value;
              setTestKey(key); setCohortId(''); setSortKey(key === 'index' ? null : key); setSortDir('desc'); setPage(0);
            }} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200">
              {testOptions.map(key => <option key={key} value={key}>{comparisonTestLabel(key)}</option>)}
              <option value="index">Weighted index (different tests)</option>
            </select>
          </label>
          {cohorts.length > 1 && <label className="flex items-center gap-2 text-zinc-400">
            Results
            <select aria-label="Benchmark edition" value={cohort?.id ?? ''} onChange={event => { setCohortId(event.target.value); setPage(0); }} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200">
              {cohorts.map(group => <option key={group.id} value={group.id}>{group.sourceName} · {group.edition ?? 'date not supplied'}</option>)}
            </select>
          </label>}
        </div>
        <p className="text-xs text-zinc-400" role="status">
          {indexMode ? 'Experimental weighted index: different test sets and reporting coverage affect these numbers. No comparable-test positions are assigned.'
            : cohort ? <><a href={cohort.url} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">{cohort.sourceName} ↗</a>{' · '}{cohort.edition ? `Dataset edition ${cohort.edition}` : 'Dataset date not supplied'}{' · '}{ranks.size} models with results. Ties share a position. Effort and harness settings can differ; inspect the source before drawing broader conclusions.</>
            : 'No comparable evaluator results for this test. Reported values remain in the model evidence; no positions are assigned.'}
        </p>
      </div>

      {/* Search + provider filter + closed-source toggle */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <input
          type="text"
          placeholder="Search model, provider, or slug..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className={leaderboardStyles.filterInput}
        />
        <button
          onClick={() => setProviderFilter('all')}
          className={providerButtonClass(providerFilter === 'all')}
        >
          All
        </button>
        {providers.map(p => (
          <button
            key={p}
            onClick={() => setProviderFilter(p === providerFilter ? 'all' : p)}
            className={providerButtonClass(providerFilter === p)}
          >
            {p}
          </button>
        ))}
        {hasClosedModels && (
          <>
            <span className="text-zinc-700 mx-1">|</span>
            <button
              onClick={() => { setShowClosed(v => !v); setProviderFilter('all'); setPage(0); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                showClosed
                  ? 'bg-orange-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {showClosed ? 'All models' : 'Open-weight only'}
            </button>
          </>
        )}
        <span className="text-[10px] text-zinc-600 ml-auto">
          Ordered by: {sortKey === COMPOSITE_KEY
            ? 'Capability Score'
            : sortKey
              ? sortKey === 'release' ? 'Release date' : benchmarkColumnFor(sortKey) ? comparisonTestLabel(sortKey) : sortKey
              : activeCat.key === 'overall' ? 'Overall index (experimental)' : `${activeCat.label} index (experimental)`}
          {showClosed ? ' (tracked models)' : ' (open-weight only)'}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-zinc-800 rounded-lg">
        <table className={leaderboardStyles.table}>
          <thead>
            <tr className={leaderboardStyles.headRow}>
              <th className="px-2 py-2 text-center text-zinc-500 font-medium w-8">#</th>
              <th
                className="px-3 py-2 text-left text-zinc-400 font-medium cursor-pointer hover:text-zinc-200 sticky left-0 bg-zinc-900/95 z-10 min-w-[180px]"
                onClick={() => handleSort('name')}
                tabIndex={0}
                aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleSort('name'); } }}
              >
                Model{sortArrow('name')}
              </th>
              <th className="px-2 py-2 text-center text-zinc-400 font-medium min-w-[100px]" aria-sort={sortKey === 'release' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => handleSort('release')} className="cursor-pointer hover:text-zinc-200" title="Source-reported model release date. Click to sort newest or oldest first.">Released{sortArrow('release')}</button>
              </th>
              <th
                className="px-2 py-2 text-center text-zinc-400 font-medium cursor-pointer hover:text-zinc-200 min-w-[60px]"
                onClick={() => handleSort('params')}
                tabIndex={0}
                aria-sort={sortKey === 'params' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleSort('params'); } }}
                title="Total parameters in billions, not a quality score. All MoE weights require memory even though only a subset activates per token."
              >
                Params{sortArrow('params')}
              </th>
              <th className="px-2 py-2 text-center text-zinc-400 font-medium min-w-[50px]" title="Context window in thousands of tokens. How much text the model can read/write at once. 128K ≈ a 300-page book.">Ctx</th>
              <th className="px-2 py-2 text-center text-zinc-400 font-medium min-w-[70px]" title="Reported weight license. Check the linked terms for obligations and restrictions.">License</th>
              <th
                className="px-2 py-2 text-center text-zinc-400 font-medium cursor-pointer hover:text-zinc-200 min-w-[60px]"
                onClick={() => handleSort('vram')}
                tabIndex={0}
                aria-sort={sortKey === 'vram' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleSort('vram'); } }}
                title="Estimated Q4 memory target; runtime support and context-dependent memory are not verified."
              >
                VRAM Q4{sortArrow('vram')}
              </th>
              {!indexMode && cohort && <th className="px-2 py-2 text-center font-medium text-emerald-400 border-l-2 border-l-emerald-500/40 bg-emerald-950/20 min-w-[90px]" aria-sort={sortKey === testKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => handleSort(testKey)} className="cursor-pointer">{selectedColumn?.label ?? 'Test score'}{sortArrow(testKey)}</button></th>}
              {categorySort && <th className="px-2 py-2 text-center font-medium min-w-[95px] text-amber-300" aria-sort="descending" title="Our weighted category index, including a fixed-prior adjustment for sparse evidence. Not a measured accuracy percentage.">{activeCat.label} index ↓</th>}
              <th
                className="px-2 py-2 text-center font-medium cursor-pointer hover:text-emerald-300 min-w-[95px] text-emerald-400 border-l-2 border-l-emerald-500/40 bg-emerald-950/20"
                onClick={() => handleSort(COMPOSITE_KEY)}
                tabIndex={0}
                aria-sort={sortKey === COMPOSITE_KEY ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleSort(COMPOSITE_KEY); } }}
                title="Capability Score (0–100): a weighted index across the tracked benchmarks, tilted toward coding work. It is a heuristic comparison, not a measured accuracy percentage or proof of superiority; it does not measure whether the model fits your GPU — a 2400B API-only model can score well here and be unrunnable locally. The Hardware page answers the fit question. Chat-preference Arena ELO is a secondary signal."
              >
                Capability Score{sortArrow(COMPOSITE_KEY)}
              </th>
              <th
                className="px-2 py-2 text-center text-zinc-400 font-medium min-w-[64px]"
                title="Evidence: how many tracked benchmarks back this row (5-dot coverage meter) and overall confidence (green = high, amber = medium, grey = low/unknown). Repeated reports do not establish independent evaluation. This is weighted coverage, not a probability of correctness."
              >
                Evidence
              </th>
              {visibleCols.map(col => (
                <th
                  key={col.key}
                  className={`px-2 py-2 text-center font-medium cursor-pointer hover:text-zinc-200 min-w-[65px] ${
                    col.primary
                      ? 'text-emerald-400 border-l-2 border-l-emerald-500/40 bg-emerald-950/20'
                      : 'text-zinc-400'
                  }`}
                  onClick={() => handleSort(col.key)}
                tabIndex={0}
                aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleSort(col.key); } }}
                  title={col.tooltip}
                >
                  {col.label}{sortArrow(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((model, idx) => {
              const i = page * PAGE_SIZE + idx;
              const isClosed = model.closed_source;
              return (
              <tr
                key={model.slug || model.name}
                className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${
                  isClosed ? 'bg-orange-950/10' : i % 2 === 0 ? '' : 'bg-zinc-900/30'
                }`}
              >
                <td className="px-2 py-1.5 text-center tabular-nums text-zinc-500 font-medium">
                  {indexMode ? '—' : ranks.get(model.slug) ?? '—'}
                </td>
                <td className={`px-3 py-1.5 sticky left-0 z-10 ${isClosed ? 'bg-orange-950/20' : 'bg-zinc-950/95'}`}>
                  <div className="flex items-center gap-2">
                    {isClosed ? (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[8px] font-bold border bg-orange-500/20 text-orange-300 border-orange-500/40" title="Closed-source — not locally runnable">
                        $$
                      </span>
                    ) : model.tier ? (
                      <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${TIER_COLORS[model.tier] || TIER_COLORS['D']}`}>
                        {model.tier}
                      </span>
                    ) : null}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Link href={`/models/${model.slug}`} className={`${isClosed ? 'text-orange-200/80' : 'text-zinc-200'} hover:text-emerald-400 font-medium`}>
                          {model.name}
                        </Link>
                        {model.rank_status === 'provisional' && <span className="text-[9px] text-amber-400">Provisional</span>}
                        {isClosed && <span className="text-[8px] px-1 py-0.5 rounded bg-orange-500/15 text-orange-400 border border-orange-500/25">{model.weight_status === 'unknown' ? 'WEIGHTS UNKNOWN' : 'CLOSED'}</span>}
                        {model.benchmark_coverage < LOW_COVERAGE_THRESHOLD && (
                          <span
                            className="text-[8px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700"
                            title={`Only ${model.benchmark_coverage} tracked benchmarks currently filled for this row`}
                          >
                            LOW DATA
                          </span>
                        )}
                        {testKey.startsWith('livebench_') && <EffortBadge model={model} />}
                        {testKey.startsWith('livebench2_') && cohort && comparisonValue(model, cohort) !== null && model.benchmark_sources[testKey]?.filter(s => s.source_id === 'livebench2' && s.data_date === cohort.edition && s.effort).slice(0, 1).map(s =>
                          <span key={s.model_name} title="Effort reported for this LiveBench 2.0 run" className="text-[9px] uppercase text-fuchsia-300">{s.effort}</span>)}
                        {model.vision && <span className="text-[9px] px-1 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30" title="Supports vision/image input">VLM</span>}
                        {model.moe_active_b && <span className="text-[9px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30" title={`MoE: ${model.moe_active_b}B active params`}>MoE</span>}
                      </div>
                      <div className="text-[10px] text-zinc-600">{model.provider}</div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-center text-zinc-500 tabular-nums"><ReleaseDate value={model.release} evidence={textReleaseEvidence(model)} /></td>
                <td className="px-2 py-1.5 text-center text-zinc-400 tabular-nums">
                  {model.params_b ? (
                    <div>
                      <span>{model.params_b}B</span>
                      {model.moe_active_b && <div className="text-[9px] text-violet-400">{model.moe_active_b}B active</div>}
                    </div>
                  ) : '—'}
                </td>
                <td className="px-2 py-1.5 text-center text-zinc-500 tabular-nums">
                  {model.context_k ? `${model.context_k}K` : '—'}
                </td>
                <td className="px-2 py-1.5 text-center text-zinc-500 text-[10px] max-w-[70px] truncate" title={model.license || ''}>
                  {model.license || '—'}
                </td>
                <td className="px-2 py-1.5 text-center text-zinc-400 tabular-nums">
                  {model.vram_int4_gb ? `${model.vram_int4_gb}GB` : '—'}
                </td>
                {!indexMode && cohort && <td className="px-2 py-1.5 text-center tabular-nums text-emerald-400 border-l-2 border-l-emerald-500/40 bg-emerald-950/10" title={cohort ? `${cohort.sourceName}; ${cohort.edition ?? 'date not supplied'}` : 'No matching evaluator result'}>{comparisonValue(model, cohort) === null ? '—' : selectedColumn?.isElo ? comparisonValue(model, cohort)!.toLocaleString() : `${comparisonValue(model, cohort)!.toFixed(2)}%`}</td>}
                {categorySort && <CompositeCell value={categoryScores.get(model.slug) ?? null} />}
                <CompositeCell value={model.composite_score ?? null} />
                <ConfidenceChip
                  confidence={model.confidence ?? null}
                  coverage={model.coverage ?? null}
                />
                {visibleCols.map(col => (
                  <ScoreCell
                    key={col.key}
                    provenance={benchmarkProvenanceLabel(model, col.key)}
                    curated={model.benchmark_sources?.[col.key]?.some((row) => row.is_fallback)}
                    value={getBenchmarkValue(model, col.key)}
                    isElo={col.isElo}
                    best={ranges[col.key].best}
                    worst={ranges[col.key].worst}
                    primary={col.primary}
                  />
                ))}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {sorted.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-[10px] text-zinc-500">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length} models
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              className="px-2 py-1 rounded text-[10px] bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-default cursor-pointer"
            >
              First
            </button>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded text-[10px] bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-default cursor-pointer"
            >
              Prev
            </button>
            <span className="px-2 py-1 text-[10px] text-zinc-500">
              Page {page + 1} of {Math.ceil(sorted.length / PAGE_SIZE)}
            </span>
            <button
              onClick={() => setPage(p => Math.min(Math.ceil(sorted.length / PAGE_SIZE) - 1, p + 1))}
              disabled={(page + 1) * PAGE_SIZE >= sorted.length}
              className="px-2 py-1 rounded text-[10px] bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-default cursor-pointer"
            >
              Next
            </button>
            <button
              onClick={() => setPage(Math.ceil(sorted.length / PAGE_SIZE) - 1)}
              disabled={(page + 1) * PAGE_SIZE >= sorted.length}
              className="px-2 py-1 rounded text-[10px] bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-default cursor-pointer"
            >
              Last
            </button>
          </div>
        </div>
      )}

      <p className="text-[10px] text-zinc-600 mt-2">
        Data sourced from {[
          'ZeroEval',
          'LLM Stats Code Arena',
          'LMArena',
          ...(hasBenchmarkValues(models, LIVEBENCH_KEYS) ? ['LiveBench'] : []),
          'BFCL',
          'Terminal-Bench',
          'SWE-bench',
        ].join(', ')}. Normal cache window: 30 minutes; failures can serve older snapshots.
      </p>
      <p className="text-[10px] text-zinc-700 mt-1">
        Benchmark cells select a published observation, preferring direct evaluators to aggregators. Uncited archived benchmark values are excluded. Open a model to inspect alternate reports.
      </p>
      <p className="text-[10px] text-zinc-700 mt-1">
        Code Arena is taken directly from the public LLM Stats leaderboard and converted from its raw site payload to the visible 0–2000 rating scale shown on that page.
      </p>
      <p className="text-[10px] text-zinc-700 mt-1">
        Hover a cell for attribution or open any model for its source breakdown. Uncited archived benchmark values are excluded. The default view compares one evaluator test and dataset edition. Use the <Link href="/hardware" className="text-zinc-500 hover:text-emerald-400">Hardware</Link> page for memory-fit estimates. Toggle &ldquo;Open-weight only&rdquo; to hide closed APIs, or click any of the collected benchmark columns to order its reported values. Missing results stay visible at the end with no ordinal; the Evidence column describes overall reporting coverage, not confidence in the selected test rank.
      </p>
      <p className="text-[10px] text-zinc-700 mt-1">
        Category buttons select a named test. Extra reported benchmarks cannot change its score or position. The optional weighted index combines different test sets and receives no comparable-test positions. Rows with fewer than 4 filled metrics are flagged as low data.
      </p>
      <p className="text-[10px] text-zinc-700 mt-1">
        Variant suffixes like <span className="text-zinc-500">thinking</span> and <span className="text-zinc-500">high</span> may be grouped as effort settings for the same release. Product and release variants such as preview remain separate.
      </p>
    </div>
  );
}
