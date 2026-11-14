import { benchmarkColumnFor } from './benchmark-catalog';
import type { MergedModel } from './merge-models';
import { SCORING_CATEGORIES, scoreCategoryAnchored } from './merge-models';

export type LeaderboardModel = MergedModel;

export interface LeaderboardSourceStatus {
  id: string;
  name: string;
  url: string;
  count: number;
  error?: string;
  duration_ms: number;
  fetched_at: string;
  // Upstream publication date, when the source exposes one. Distinct from
  // fetched_at: a source can respond instantly with weeks-old data.
  data_date?: string | null;
  date_kind?: 'benchmark_edition' | 'publication';
  historical?: boolean;
  status?: 'ok' | 'degraded' | 'error';
}

export interface LeaderboardData {
  models: LeaderboardModel[];
  sources: LeaderboardSourceStatus[];
  updated: string;
  // Honesty surface (declared here; a sibling service populates them). When the
  // live primary sources are empty/failed, the pipeline must transparently flag
  // that curated fallback data is being shown rather than presenting it as live.
  usedFallback?: boolean;
  dataDate?: string | null;
  stale?: boolean;
  degradedSources?: string[];
  dataSourceLabel?: 'live' | 'partial' | 'fallback';
  scoringVersion?: string;
  fallbackCellCount?: number;
}

const OVERALL_BENCHMARKS = Array.from(new Set(Object.values(SCORING_CATEGORIES).flat()));

// Category recipes use the exact arrays that feed the core scorer. Keeping a
// second hand-written list here previously let the cards and table answer the
// same question with different benchmarks.
export const CATEGORY_DEFINITIONS = [
  {
    key: 'overall',
    label: 'Overall index',
    desc: 'The same coding-tilted Capability Score used by the main leaderboard',
    benchmarks: OVERALL_BENCHMARKS,
    color: 'emerald',
  },
  {
    key: 'coding',
    label: 'Coding',
    desc: 'Weighted mix of coding evaluations; coverage and harnesses differ by model',
    benchmarks: SCORING_CATEGORIES.coding,
    color: 'sky',
  },
  {
    key: 'agentic',
    label: 'Agentic & Tools',
    desc: 'Agentic coding, repository work, terminal, browsing, and tool-use evaluations',
    benchmarks: SCORING_CATEGORIES.agentic,
    color: 'rose',
  },
  {
    key: 'reasoning',
    label: 'Reasoning',
    desc: 'Weighted reasoning evaluations; no-tools HLE is separate from tool-assisted HLE',
    benchmarks: SCORING_CATEGORIES.reasoning,
    color: 'violet',
  },
  {
    key: 'math',
    label: 'Math',
    desc: 'Weighted mathematics evaluations, with AIME test years kept separate',
    benchmarks: SCORING_CATEGORIES.math,
    color: 'amber',
  },
  {
    key: 'chat',
    label: 'Chat & instructions',
    desc: 'LMArena ELO, LiveBench Global, IFEval',
    benchmarks: ['arena_elo', 'livebench_global', 'ifeval'],
    color: 'teal',
  },
] as const;

export type CategoryKey = typeof CATEGORY_DEFINITIONS[number]['key'];

export const LIVEBENCH_KEYS = [
  'livebench_global',
  'livebench_coding',
  'livebench_reasoning',
  'livebench_mathematics',
  'livebench_agentic_coding',
  'livebench_data_analysis',
  'livebench_language',
  'livebench_if',
] as const;

/** Top values among imported, selected evaluator observations, not every run
 * published by that evaluator. Preserve ties instead of inventing one winner. */
export function attributedBenchmarkLeaders(models: LeaderboardModel[], key: string, sourceId: string) {
  const participants = models.filter(model => {
    const value = model.benchmarks[key];
    return value != null && Number.isFinite(value) && model.benchmark_sources[key]?.some(row =>
      row.selected === true && row.source_id === sourceId && !row.is_fallback && row.value === value
    );
  });
  if (!participants.length) return null;
  const value = Math.max(...participants.map(model => model.benchmarks[key]!));
  return {
    value,
    participants: participants.length,
    models: participants.filter(model => model.benchmarks[key] === value),
  };
}

const BENCHMARK_DISPLAY_LABELS: Record<string, string> = {
  code_arena: 'Code Arena',
  arena_elo: 'LMArena',
  livebench_global: 'LiveBench',
  gpqa_diamond: 'GPQA',
  swe_bench: 'SWE-bench',
  aime_2025: 'AIME 2025',
  mmlu_pro: 'MMLU-Pro',
  ifeval: 'IFEval',
  livebench_coding: 'LiveBench Code',
  livebench_reasoning: 'LiveBench Reasoning',
  livebench_mathematics: 'LiveBench Math',
  livebench_agentic_coding: 'LiveBench Agentic',
  livebench_data_analysis: 'LiveBench Data',
  livebench_language: 'LiveBench Language',
  livebench_if: 'LiveBench IF',
  livecodebench: 'LiveCode',
  math_500: 'MATH-500',
  aime_2026: 'AIME 2026',
  swe_bench_pro: 'SWE-Pro',
  terminal_bench: 'Terminal-Bench',
  mcp_atlas: 'MCP Atlas',
  toolathlon: 'Toolathlon',
  browsecomp: 'BrowseComp',
  deepswe: 'DeepSWE',
  hle_no_tools: 'HLE No Tools',
  hle_tools: 'HLE + Tools',
  hle: 'HLE Unspecified',
};

export function hasBenchmarkValues(
  models: ReadonlyArray<{ benchmarks?: Record<string, number | null> | undefined }>,
  keys: readonly string[]
): boolean {
  return models.some((model) => keys.some((key) => model.benchmarks?.[key] != null));
}

export function visibleRecipeLabel(
  benchmarkKeys: readonly string[],
  models: ReadonlyArray<{ benchmarks?: Record<string, number | null> | undefined }>
): string {
  const present = benchmarkKeys.filter((key) => hasBenchmarkValues(models, [key]));
  if (present.length === 0) return 'No published scores in this snapshot';
  return present.map((key) => benchmarkColumnFor(key)?.label ?? BENCHMARK_DISPLAY_LABELS[key] ?? key).join(', ');
}

export function categoryRecipeLabel(
  category: { key: CategoryKey; benchmarks: readonly string[] },
  models: ReadonlyArray<{ benchmarks?: Record<string, number | null> | undefined }>
): string {
  if (category.key === 'overall') {
    const visibleSignals = category.benchmarks.filter((key) => hasBenchmarkValues(models, [key])).length;
    return `Capability Score · ${visibleSignals} inputs across 5 categories`;
  }
  return visibleRecipeLabel(category.benchmarks, models);
}

export function columnsWithPublishedValues<T extends { key: string }>(
  columns: readonly T[],
  models: ReadonlyArray<{ benchmarks?: Record<string, number | null> | undefined }>
): T[] {
  return columns.filter((column) => hasBenchmarkValues(models, [column.key]));
}

const CATEGORY_ALIASES: Record<string, CategoryKey> = {
  'tool-use': 'agentic',
};

export function makeSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function resolveCategoryKey(key: string): CategoryKey {
  const candidate = CATEGORY_ALIASES[key] || key;
  if (CATEGORY_DEFINITIONS.some((category) => category.key === candidate)) {
    return candidate as CategoryKey;
  }
  return 'overall';
}

export function getCategoryDefinition(key: string) {
  const resolved = resolveCategoryKey(key);
  return CATEGORY_DEFINITIONS.find((category) => category.key === resolved) || CATEGORY_DEFINITIONS[0];
}

export function getBenchmarkValue(model: Pick<LeaderboardModel, 'benchmarks'>, key: string): number | null {
  return model.benchmarks[key] ?? null;
}

export function countBenchmarkCoverage(model: Pick<LeaderboardModel, 'benchmarks'>): number {
  return Object.values(model.benchmarks).filter((value) => value !== null).length;
}

export function computeCategoryCoverage(
  model: Pick<LeaderboardModel, 'benchmarks'>,
  benchmarkKeys: readonly string[]
): number {
  if (benchmarkKeys.length === 0) return 0;
  const present = benchmarkKeys.filter((key) => getBenchmarkValue(model, key) !== null).length;
  return present / benchmarkKeys.length;
}

export function computeRawCategoryAverage(model: Pick<LeaderboardModel, 'benchmarks'>, benchmarkKeys: readonly string[]): number | null {
  const values = benchmarkKeys
    .map((key) => getBenchmarkValue(model, key))
    .filter((value): value is number => value !== null);

  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Anchored + shrinkage category score (v2-anchored), 0-100.
 *
 * Reimplemented to use FIXED per-benchmark anchors and shrinkage toward a fixed
 * prior, so a category score no longer depends on the live population (`allModels`).
 * Adding/removing a model never re-ranks the others. The `allModels` parameter is
 * retained only to preserve the call signature other code imports.
 */
export function computeNormalizedCategoryScore(
  model: Pick<LeaderboardModel, 'benchmarks'> & Partial<Pick<LeaderboardModel, 'source_count' | 'benchmark_sources' | 'release'>>,
  benchmarkKeys: readonly string[],
  allModels?: Array<Pick<LeaderboardModel, 'benchmarks'>>
): number | null {
  // `allModels` is retained only to preserve the call signature other modules
  // import; fixed anchors mean the score no longer depends on the population.
  void allModels;
  return scoreCategoryAnchored(model, benchmarkKeys);
}

export function computeLeaderboardCategoryScore(
  model: LeaderboardModel,
  categoryKey: string,
  allModels?: LeaderboardModel[]
): number | null {
  const category = getCategoryDefinition(categoryKey);
  if (category.key === 'overall') return Number.isFinite(model.composite_score) ? model.composite_score : null;
  return computeNormalizedCategoryScore(model, category.benchmarks, allModels);
}

export function classifyModelType(model: Pick<LeaderboardModel, 'closed_source' | 'weight_status'>): 'open-weight' | 'closed' | 'unknown' {
  if (model.weight_status === 'unknown') return 'unknown';
  return model.closed_source ? 'closed' : 'open-weight';
}

// Slugify collapses punctuation, so "Qwen3.5-35B-A3B" and "Qwen3.5.35b A3b"
// share a slug. The merge still emits both; list UIs key on slug and React
// warns. Keep the richer row (more filled benchmarks, then a size, then score).
export type DedupeableModel = {
  name: string;
  slug?: string;
  benchmark_coverage?: number;
  composite_score?: number | null;
  params_b?: number | null;
  vram_int4_gb?: number | null;
  parameter_count?: number | null;
  estimated_vram_q4_gb?: number | null;
  benchmarks?: Record<string, number | null>;
};

function modelRichness(model: DedupeableModel): number {
  const filled = model.benchmarks
    ? Object.values(model.benchmarks).filter((value) => value !== null && value !== undefined).length
    : 0;
  const coverage = model.benchmark_coverage ?? filled;
  const hasSize = (
    model.params_b != null
    || model.vram_int4_gb != null
    || model.parameter_count != null
    || model.estimated_vram_q4_gb != null
  ) ? 1 : 0;
  const score = model.composite_score ?? 0;
  return coverage * 1_000_000 + hasSize * 1_000 + score;
}

export function dedupeModelsBySlug<T extends DedupeableModel>(models: T[]): T[] {
  const bySlug = new Map<string, T>();
  for (const model of models) {
    const slug = model.slug || makeSlug(model.name);
    const candidate = { ...model, slug };
    const existing = bySlug.get(slug);
    if (!existing || modelRichness(candidate) > modelRichness(existing)) {
      bySlug.set(slug, candidate);
    }
  }
  return [...bySlug.values()];
}

export function flattenLeaderboardModel(model: LeaderboardModel) {
  return {
    ...model,
    slug: model.slug || makeSlug(model.name),
    slug_aliases: model.slug_aliases ?? [],
    parameter_count: model.params_b,
    benchmark_coverage: model.benchmark_coverage ?? countBenchmarkCoverage(model),
    model_type: classifyModelType(model),
    estimated_vram_q4_gb: model.vram_int4_gb,
    estimated_vram_fp16_gb: model.vram_fp16_gb,
    is_multimodal: model.vision,
  };
}

export function buildCategoryRankings(
  models: LeaderboardModel[],
  categoryKey: string,
  opts: { limit?: number; onlyLocal?: boolean } = {}
) {
  const { limit = models.length, onlyLocal = false } = opts;
  const category = getCategoryDefinition(categoryKey);
  const pool = onlyLocal ? models.filter((model) => !model.closed_source) : models;

  let ordinal = 0;
  const ranked = pool
    .map((model) => ({
      ...flattenLeaderboardModel(model),
      score: computeLeaderboardCategoryScore(model, category.key, pool),
      coverage: computeCategoryCoverage(model, category.benchmarks),
    }))
    .filter((model): model is ReturnType<typeof flattenLeaderboardModel> & { score: number; coverage: number } =>
      model.score !== null
    )
    .sort((a, b) => (
      b.score - a.score
      || b.coverage - a.coverage
      || (b.composite_score ?? -1) - (a.composite_score ?? -1)
      || a.name.localeCompare(b.name)
    ))
    .slice(0, limit)
    .map((model) => ({
      ...model,
      rank: model.rank_status === 'insufficient_evidence' ? null : ++ordinal,
      rank_change: null,
      previous_rank: null,
    }));

  return ranked;
}

export function findModelBySlug<T extends Pick<LeaderboardModel, 'slug' | 'name' | 'slug_aliases'>>(models: T[], slug: string): T | null {
  const direct = models.find((model) => model.slug === slug);
  if (direct) return direct;
  const matches = models.filter((model) => model.slug_aliases ? model.slug_aliases.includes(slug) : makeSlug(model.name) === slug);
  return matches.length === 1 ? matches[0] : null;
}
