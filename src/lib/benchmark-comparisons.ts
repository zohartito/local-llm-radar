import { benchmarkColumnFor } from './benchmark-catalog';
import { flattenLeaderboardModel, getCategoryDefinition, type LeaderboardModel } from './leaderboard';

import { LIVEBENCH2_METRICS } from './livebench-v2';

export const COMPARISON_VERSION = 'same-test-v2';

// Explicit evaluator/edition allowlist. Vendor reports remain in the matrix and
// optional indices, but unknown task sets cannot earn a comparable-test rank.
const EVALUATORS: Record<string, { source: string; url: string; dated?: boolean }> = {
  ...Object.fromEntries(Object.keys(LIVEBENCH2_METRICS).map(k => ['livebench2_' + k, { source: 'livebench2', url: 'https://livebench.ai/', dated: true }])),
  livebench_global: { source: 'livebench', url: 'https://livebench.ai/v1/', dated: true },
  livebench_coding: { source: 'livebench', url: 'https://livebench.ai/v1/', dated: true },
  livebench_reasoning: { source: 'livebench', url: 'https://livebench.ai/v1/', dated: true },
  livebench_mathematics: { source: 'livebench', url: 'https://livebench.ai/v1/', dated: true },
  livebench_agentic_coding: { source: 'livebench', url: 'https://livebench.ai/v1/', dated: true },
  livebench_data_analysis: { source: 'livebench', url: 'https://livebench.ai/v1/', dated: true },
  livebench_language: { source: 'livebench', url: 'https://livebench.ai/v1/', dated: true },
  livebench_if: { source: 'livebench', url: 'https://livebench.ai/v1/', dated: true },
  terminal_bench_4: { source: 'terminalbench', url: 'https://www.tbench.ai/' },
  swe_bench: { source: 'swebench', url: 'https://www.swebench.com/' },
  bfcl: { source: 'bfcl', url: 'https://gorilla.cs.berkeley.edu/leaderboard.html' },
  arena_elo: { source: 'lmarena', url: 'https://arena.ai/leaderboard/text' },
  code_arena: { source: 'codearena', url: 'https://llm-stats.com/leaderboards/llm-leaderboard' },
};

export const CATEGORY_TESTS: Record<string, readonly string[]> = {
  overall: ['livebench2_overall', 'livebench2_data_analysis', 'livebench2_browser', 'livebench2_design', 'livebench2_research', 'livebench_global', 'livebench_data_analysis', 'livebench_language', 'livebench_if'],
  coding: ['livebench2_coding', 'livebench_coding', 'swe_bench', 'code_arena'],
  agentic: ['livebench2_long_agentic', 'livebench_agentic_coding', 'terminal_bench_4', 'swe_bench', 'bfcl'],
  reasoning: ['livebench2_reasoning', 'livebench_reasoning'],
  math: ['livebench_mathematics'],
  chat: ['arena_elo', 'livebench_if'],
};

export function defaultCategoryTest(category: string): string {
  return CATEGORY_TESTS[category]?.[0] ?? CATEGORY_TESTS.overall[0];
}

export function comparisonTestLabel(key: string): string {
  const label = benchmarkColumnFor(key)?.label ?? key;
  if (key.startsWith('livebench2_')) return label.replace('LB2 ', 'LiveBench 2.0 · ');
  return key.startsWith('livebench_') ? `${label.replace('LB ', 'LiveBench ')} · legacy v1` : label;
}

export function comparisonCategoryLabel(key: string): string {
  return key === 'overall' ? 'Overall' : getCategoryDefinition(key).label;
}

export interface ComparisonCohort {
  id: string;
  benchmark: string;
  sourceId: string;
  sourceName: string;
  edition: string | null;
  url: string;
  participants: number;
}

function observations(model: LeaderboardModel, key: string) {
  const evaluator = EVALUATORS[key];
  if (!evaluator) return [];
  return (model.benchmark_sources?.[key] ?? []).filter(row =>
    row.source_id === evaluator.source && !row.is_fallback && Number.isFinite(row.value)
    && (!evaluator.dated || /^\d{4}-\d{2}-\d{2}$/.test(row.data_date ?? ''))
  );
}

function cohortId(key: string, row: ReturnType<typeof observations>[number]): string {
  return JSON.stringify([key, row.source_id, row.source_name, row.data_date ?? null]);
}

/** Same key, evaluator, source-described edition and dataset date. Never pool
 * missing metadata into a dated edition, or choose a model's best source. */
export function comparisonCohorts(models: LeaderboardModel[], key: string): ComparisonCohort[] {
  const groups = new Map<string, ComparisonCohort>();
  for (const model of models) {
    for (const row of observations(model, key)) {
      const id = cohortId(key, row);
      if (!groups.has(id)) groups.set(id, {
        id, benchmark: key, sourceId: row.source_id, sourceName: row.source_name,
        edition: row.data_date ?? null, url: EVALUATORS[key].url, participants: 0,
      });
    }
  }
  for (const group of groups.values()) {
    group.participants = models.filter(model => comparisonValue(model, group) !== null).length;
  }
  // The newest explicit edition wins; never silently fall back per model.
  return [...groups.values()].filter(group => group.participants > 0).sort((a, b) =>
    (b.edition ?? '').localeCompare(a.edition ?? '') || b.participants - a.participants || a.id.localeCompare(b.id)
  );
}

export function comparisonValue(model: LeaderboardModel, cohort?: ComparisonCohort | null): number | null {
  if (!cohort) return null;
  const rows = observations(model, cohort.benchmark).filter(row => cohortId(cohort.benchmark, row) === cohort.id);
  // Conflicting observations in one edition are not a license to cherry-pick.
  const values = [...new Set(rows.map(row => row.value))];
  return values.length === 1 ? values[0] : null;
}

export function categoryComparison(models: LeaderboardModel[], category: string) {
  return comparisonCohorts(models, defaultCategoryTest(category))[0] ?? null;
}

export function comparisonRanks(models: LeaderboardModel[], cohort?: ComparisonCohort | null): Map<string, number> {
  const measured = models.map(model => ({ model, value: comparisonValue(model, cohort) }))
    .filter((row): row is { model: LeaderboardModel; value: number } => row.value !== null)
    .sort((a, b) => b.value - a.value || a.model.slug.localeCompare(b.model.slug));
  let rank = 0;
  let previous: number | null = null;
  return new Map(measured.map(({ model, value }, index) => {
    if (previous !== value) rank = index + 1;
    previous = value;
    return [model.slug, rank];
  }));
}

export function buildBenchmarkRankings(models: LeaderboardModel[], category: string, opts: {
  onlyLocal?: boolean; limit?: number; benchmark?: string; cohortId?: string;
} = {}) {
  const key = opts.benchmark ?? defaultCategoryTest(category);
  const cohorts = comparisonCohorts(models, key);
  const cohort = opts.cohortId ? cohorts.find(group => group.id === opts.cohortId) ?? null : cohorts[0] ?? null;
  const pool = opts.onlyLocal ? models.filter(model => !model.closed_source) : models;
  const ranks = comparisonRanks(pool, cohort);
  const rankings = pool.map(model => ({
    ...flattenLeaderboardModel(model), score: comparisonValue(model, cohort), rank: ranks.get(model.slug) ?? null,
    rank_change: null, previous_rank: null,
  })).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.name.localeCompare(b.name))
    .slice(0, opts.limit ?? pool.length);
  return { benchmark: key, cohort, cohorts, rankings };
}
