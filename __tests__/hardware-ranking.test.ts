import {
  buildCategoryHardwareRecommendations,
  compareHardwareModelsByBenchmark,
  compareHardwareModelsForCategory,
  fitHardwareModels,
  openWeightModels,
  type HardwareRankedModel,
} from '../src/lib/hardware-ranking';
import { computeHardwareFit, primaryGpuOnlySpec, type HardwareSpec } from '../src/lib/hardware';
import type { LeaderboardModel } from '../src/lib/leaderboard';

function benchmarkModel(
  name: string,
  score: number,
  hardware: Pick<LeaderboardModel, 'params_b' | 'vram_int4_gb' | 'vram_fp16_gb'>
): LeaderboardModel {
  return {
    name,
    slug: name.toLowerCase().replaceAll(' ', '-'),
    provider: 'Test',
    benchmark_sources: { livebench2_overall: [{source_id: 'livebench2', source_name: 'LiveBench 2.0', value: score, data_date: '2026-06-25', selected: true}] },
    tier: 'B',
    composite_score: score,
    params_b: hardware.params_b,
    vram_int4_gb: hardware.vram_int4_gb,
    vram_fp16_gb: hardware.vram_fp16_gb,
    benchmarks: {
      livebench2_overall: score,
      arena_elo: 1000 + score,
      gpqa_diamond: score,
      swe_bench: score,
      mmlu_pro: score,
      ifeval: score,
    },
  } as unknown as LeaderboardModel;
}

describe('hardware-aware category recommendations', () => {
  test('fit annotations preserve distinct catalog products and releases for both GPU scopes', () => {
    const model = benchmarkModel('Command R', 55, { params_b: 35, vram_int4_gb: 22, vram_fp16_gb: 72 });
    const plus = { ...model, name: 'Command R+', slug: 'command-r-plus-04-2024' };
    const dated = { ...model, name: 'Command R (08-2024)', slug: 'command-r-08-2024' };
    const datedPlus = { ...plus, name: 'Command R+ (08-2024)', slug: 'command-r-plus-08-2024' };
    const catalog = [model, plus, dated, datedPlus];
    const spec: HardwareSpec = {
      platform: 'pc', systemRamGb: 128, unifiedMemoryGb: 0,
      gpus: [{ label: 'Primary', vramGb: 16 }, { label: 'Second', vramGb: 48 }],
    };

    for (const scope of [spec, primaryGpuOnlySpec(spec)!]) {
      const fitted = fitHardwareModels(catalog, scope);
      expect(fitted.map(row => row.slug)).toEqual(catalog.map(row => row.slug));
      expect(fitted.map(row => row.name)).toEqual(catalog.map(row => row.name));
      expect(fitted.every(row => row.hwFit !== null)).toBe(true);
    }
    expect(fitHardwareModels(catalog, spec)[0].hwFit?.fit).toBe('fits-well');
    expect(fitHardwareModels(catalog, primaryGpuOnlySpec(spec)!)[0].hwFit?.usesOffload).toBe(true);
  });

  test('the runnable recommendation changes only when a second GPU makes the stronger model runnable', () => {
    const dualSpec: HardwareSpec = {
      platform: 'pc',
      systemRamGb: 32,
      unifiedMemoryGb: 0,
      gpus: [
        { label: 'RTX 4070 Ti SUPER (16GB)', vramGb: 16 },
        { label: 'A6000 (48GB)', vramGb: 48 },
      ],
    };
    const singleSpec = primaryGpuOnlySpec(dualSpec)!;
    const small = benchmarkModel('Clean 8B', 55, { params_b: 8, vram_int4_gb: 6, vram_fp16_gb: 18 });
    const large = benchmarkModel('Strong 70B', 90, { params_b: 70, vram_int4_gb: 40, vram_fp16_gb: 142 });
    const catalog = [small, large];

    const fitFor = (spec: HardwareSpec): HardwareRankedModel[] => catalog.map((model) => ({
      ...model,
      hwFit: computeHardwareFit(model, spec),
    }));

    const singleOverall = buildCategoryHardwareRecommendations(fitFor(singleSpec), catalog)[0];
    const dualOverall = buildCategoryHardwareRecommendations(fitFor(dualSpec), catalog)[0];

    expect(singleOverall.model?.name).toBe('Clean 8B');
    expect(dualOverall.model?.name).toBe('Strong 70B');
  });

  test('the same evaluator test sets the order; unrelated coverage cannot overtake it', () => {
    const stronger = benchmarkModel('Stronger sparse model', 90, { params_b: 70, vram_int4_gb: 40, vram_fp16_gb: 142 });
    stronger.benchmarks = {
      livebench2_overall: 90,
      arena_elo: null,
      gpqa_diamond: null,
      swe_bench: null,
      mmlu_pro: null,
      ifeval: null,
    };
    const weaker = benchmarkModel('Weaker covered model', 60, { params_b: 8, vram_int4_gb: 6, vram_fp16_gb: 18 });
    const spec: HardwareSpec = {
      platform: 'pc', systemRamGb: 128, unifiedMemoryGb: 0,
      gpus: [{ label: 'A6000', vramGb: 48 }],
    };
    const ranked = [stronger, weaker].map((model) => ({ ...model, hwFit: computeHardwareFit(model, spec) }));

    expect([...ranked].sort((a, b) => compareHardwareModelsForCategory(a, b, 'chat', ['livebench2_overall'], ranked))[0].name)
      .toBe('Stronger sparse model');
  });

  test('a benchmark column ranks every measured row and places missing results last', () => {
    const leader = benchmarkModel('Measured provisional leader', 50, { params_b: 8, vram_int4_gb: 6, vram_fp16_gb: 18 });
    leader.rank_status = 'provisional';
    leader.benchmarks.gpqa_diamond = 95;
    const runnerUp = benchmarkModel('Measured runner-up', 90, { params_b: 8, vram_int4_gb: 6, vram_fp16_gb: 18 });
    runnerUp.benchmarks.gpqa_diamond = 90;
    const missing = benchmarkModel('Missing score', 99, { params_b: 8, vram_int4_gb: 6, vram_fp16_gb: 18 });
    missing.benchmarks.gpqa_diamond = null;
    const rows = [missing, runnerUp, leader].map((model) => ({ ...model, hwFit: null }));

    expect(rows.sort((a, b) => compareHardwareModelsByBenchmark(a, b, 'gpqa_diamond')).map((model) => model.name))
      .toEqual(['Measured provisional leader', 'Measured runner-up', 'Missing score']);
  });

  test('the Hardware catalog excludes API-only rows without excluding open-weight providers', () => {
    const open = benchmarkModel('GPT OSS', 80, { params_b: 20, vram_int4_gb: 13, vram_fp16_gb: 42 });
    open.closed_source = false;
    const api = benchmarkModel('Hosted API', 90, { params_b: 20, vram_int4_gb: 13, vram_fp16_gb: 42 });
    api.closed_source = true;

    expect(openWeightModels([api, open]).map((model) => model.name)).toEqual(['GPT OSS']);
  });
});

test('hardware cannot silently substitute an older open-model edition when the catalog moves on', () => {
  const open = benchmarkModel('Open 8B', 80, {params_b:8,vram_int4_gb:6,vram_fp16_gb:18});
  const latest = benchmarkModel('New closed model', 90, {params_b:8,vram_int4_gb:6,vram_fp16_gb:18});
  latest.closed_source = true;
  latest.benchmark_sources.livebench2_overall[0].data_date = '2026-07-01';
  const spec: HardwareSpec = {platform:'mac',unifiedMemoryGb:64,systemRamGb:64,gpus:[]};
  const recommendations = buildCategoryHardwareRecommendations(fitHardwareModels([open],spec), [open,latest]);
  expect(recommendations[0].model).toBeNull();
});
