import { attributedBenchmarkLeaders, buildCategoryRankings, columnsWithPublishedValues, computeCategoryCoverage, dedupeModelsBySlug, getBenchmarkValue, hasBenchmarkValues, visibleRecipeLabel } from '../src/lib/leaderboard';
import type { LeaderboardModel } from '../src/lib/leaderboard';
import { BENCHMARK_COLUMNS } from '../src/lib/benchmark-catalog';
import { BENCHMARK_KEYS } from '../src/lib/merge-models';

function makeModel(
  name: string,
  benchmarks: Record<string, number | null>,
  overrides: Partial<LeaderboardModel> = {}
): LeaderboardModel {
  const coverage = Object.values(benchmarks).filter((value) => value !== null).length;
  return {
    name,
    provider: 'Test',
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    llm_stats_model_id: null,
    params_b: null,
    context_k: null,
    license: null,
    tier: '',
    vram_int4_gb: null,
    vram_fp16_gb: null,
    vision: false,
    moe_active_b: null,
    release: null,
    closed_source: false,
    benchmarks,
    source_count: Object.fromEntries(Object.keys(benchmarks).map((key) => [key, benchmarks[key] === null ? 0 : 1])),
    benchmark_sources: Object.fromEntries(Object.keys(benchmarks).map((key) => [key, []])),
    benchmark_coverage: coverage,
    input_price_per_m: null,
    output_price_per_m: null,
    effort_variants: [],
    best_effort: null,
    composite_score: 0,
    confidence: 0,
    coverage: 0,
    rank_status: 'ranked',
    family_coverage: 0,
    ...overrides,
  };
}

describe('leaderboard rankings', () => {
  test('exposes every collected benchmark as a sortable column', () => {
    expect(new Set(BENCHMARK_COLUMNS.map((column) => column.key))).toEqual(new Set(BENCHMARK_KEYS));
  });

  test('computes category coverage ratios correctly', () => {
    const model = makeModel('Sparse', {
      arena_elo: 1450,
      livebench_global: null,
      ifeval: null,
    });

    expect(computeCategoryCoverage(model, ['arena_elo', 'livebench_global', 'ifeval'])).toBeCloseTo(1 / 3);
  });

  test('ranks every measured model by score and keeps coverage as evidence', () => {
    const models = [
      makeModel('Sparse Winner', {
        arena_elo: 1500,
        livebench_global: null,
        ifeval: null,
      }),
      makeModel('Covered Model', {
        arena_elo: 1450,
        livebench_global: 75,
        ifeval: 70,
      }),
    ];

    const rankings = buildCategoryRankings(models, 'chat');

    expect(new Set(rankings.map((model) => model.name))).toEqual(new Set(['Sparse Winner', 'Covered Model']));
    expect(rankings[0].score).toBeGreaterThanOrEqual(rankings[1].score);
    expect(rankings.find((model) => model.name === 'Sparse Winner')?.coverage).toBeCloseTo(1 / 3);
  });

  test('dedupes colliding slugs by keeping the richer row', () => {
    const canonical = makeModel('Qwen3.5-35B-A3B', {
      arena_elo: 1400,
      mmlu_pro: 80,
      gpqa_diamond: 70,
    }, { slug: 'qwen3-5-35b-a3b', params_b: 35, vram_int4_gb: 21, composite_score: 59.5, benchmark_coverage: 3 });
    const ghost = makeModel('Qwen3.5.35b A3b', {
      arena_elo: 1300,
    }, { slug: 'qwen3-5-35b-a3b', params_b: null, vram_int4_gb: null, composite_score: 43.8, benchmark_coverage: 1 });

    const deduped = dedupeModelsBySlug([ghost, canonical, makeModel('Other', { arena_elo: 1200 })]);

    expect(deduped.map((model) => model.name)).toEqual(['Qwen3.5-35B-A3B', 'Other']);
    expect(deduped.every((model, index, rows) => rows.findIndex((row) => row.slug === model.slug) === index)).toBe(true);
  });

  test('hides LiveBench from recipes and columns when no model has a value', () => {
    const models = [
      makeModel('Filled', { arena_elo: 1400, swe_bench: 70, livebench_global: null, livebench_coding: null }),
    ];

    expect(hasBenchmarkValues(models, ['livebench_global', 'livebench_coding'])).toBe(false);
    expect(visibleRecipeLabel(['swe_bench', 'livebench_coding', 'ifeval'], models)).toBe('SWE-bench');
    expect(columnsWithPublishedValues(
      [{ key: 'swe_bench' }, { key: 'livebench_coding' }],
      models
    ).map((column) => column.key)).toEqual(['swe_bench']);
  });

  test('keeps AIME years separate so each column has an honest leader', () => {
    const model = makeModel('Fresh', {
      aime_2025: null,
      aime_2026: 95.3,
      math_500: null,
    });

    expect(getBenchmarkValue(model, 'aime_2025')).toBeNull();
    expect(getBenchmarkValue(model, 'aime_2026')).toBe(95.3);
  });
});

test('insufficient-evidence rows retain scores without taking ordinals from supported rows',()=>{
  const models=[makeModel('Sparse',{gpqa_diamond:95},{rank_status:'insufficient_evidence',composite_score:90}),makeModel('Supported',{gpqa_diamond:80},{rank_status:'ranked',composite_score:70}),makeModel('Provisional',{gpqa_diamond:70},{rank_status:'provisional',composite_score:60})];
  const rows=buildCategoryRankings(models,'overall');
  expect(rows.map(row=>[row.name,row.rank])).toEqual([['Sparse',null],['Supported',1],['Provisional',2]]);
  expect(rows[0].score).toBe(90);
});


test('raw result cards require selected evaluator provenance and preserve ties', () => {
  const model = (name: string, value: number, source_id: string, selected = true) => makeModel(name, { livebench_mathematics: value }, {
    benchmark_sources: { livebench_mathematics: [{ source_id, source_name: source_id, model_name: name, value, selected }] },
  });
  const leaders = attributedBenchmarkLeaders([
    model('Archived', 100, 'fallback'), model('Vendor', 99, 'zeroeval'),
    model('Unselected', 98, 'livebench', false), model('Tie A', 97, 'livebench'),
    model('Tie B', 97, 'livebench'), model('Lower', 90, 'livebench'),
  ], 'livebench_mathematics', 'livebench');
  expect(leaders?.models.map(row => row.name)).toEqual(['Tie A', 'Tie B']);
  expect(leaders?.participants).toBe(3);
  expect(leaders?.value).toBe(97);
  expect(attributedBenchmarkLeaders([model('No evaluator', 100, 'fallback')], 'livebench_mathematics', 'livebench')).toBeNull();
});
