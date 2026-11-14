import { ranksForCategory } from '../src/lib/store';
import { mergeAllSources, scoreCategoryAnchored } from '../src/lib/merge-models';
import { refreshOutcomeResponse } from '../src/lib/leaderboard-service';
import { computeHardwareFit, type HardwareSpec } from '../src/lib/hardware';
import { buildCategoryHardwareRecommendations } from '../src/lib/hardware-ranking';
import type { SourceResult } from '../src/lib/live-sources';
import type { LeaderboardData } from '../src/lib/leaderboard';
import { findModelBySlug } from '../src/lib/leaderboard';

const source = (id: string, scores: Record<string, number>, extra = {}): SourceResult => ({
  source_id: id, source_name: id, fetched_at: '2026-10-22T12:00:00Z',
  models: [{ name: 'Test 8B', license: 'Apache 2.0', params_b: 8, scores, ...extra }],
});

test('vendor reporting of a benchmark receives less evidence weight than its evaluator', () => {
  const direct = mergeAllSources([source('zeroeval', {}), source('livebench', { livebench_coding: 80 })])[0];
  const vendor = mergeAllSources([source('zeroeval', { livebench_coding: 80 })])[0];
  expect(scoreCategoryAnchored(vendor, ['livebench_coding'])).toBeLessThan(scoreCategoryAnchored(direct, ['livebench_coding'])!);
});

test('two feeds from the same publisher do not corroborate their own report', () => {
  const once = mergeAllSources([source('zeroeval', { gpqa_diamond: 80 })])[0];
  const twice = mergeAllSources([source('zeroeval', { gpqa_diamond: 80 }), source('llmstats_recent', { gpqa_diamond: 80 })])[0];
  expect(twice.composite_score).toBe(once.composite_score);
  expect(twice.confidence).toBe(once.confidence);
});

test('curated fallback never contaminates a live enrichment result', () => {
  const model = mergeAllSources([
    source('zeroeval', { gpqa_diamond: 80 }), source('bfcl', { bfcl: 25.8 }),
  ], { models: [{ name: 'Test 8B', bfcl: 76.1, humaneval: 55 }] })[0];
  expect(model.benchmarks.bfcl).toBe(25.8);
  expect(model.benchmark_sources.bfcl).toHaveLength(1);
  expect(model.benchmarks.humaneval).toBeNull();
  expect(model.benchmark_sources.humaneval).toEqual([]);
});

test('direct evaluator observation wins over conflicting vendor report without a synthetic midpoint', () => {
  const model = mergeAllSources([
    source('zeroeval', { swe_bench: 90 }), source('swebench', { swe_bench: 60 }),
  ])[0];
  expect(model.benchmarks.swe_bench).toBe(60);
  expect(model.benchmark_sources.swe_bench).toEqual([
    expect.objectContaining({ source_id: 'swebench', value: 60, selected: true }),
    expect.objectContaining({ source_id: 'zeroeval', value: 90, selected: false }),
  ]);
});

test('exact source IDs disambiguate releases that share a broad model alias', () => {
  const models = mergeAllSources([
    { ...source('zeroeval', {}), models: [
      { name: 'Example Base', llm_stats_model_id: 'example-base', scores: { gpqa_diamond: 40 } },
      { name: 'Example Instruct', llm_stats_model_id: 'example-instruct', scores: { gpqa_diamond: 80 } },
    ] },
    { ...source('bfcl', {}), models: [
      { name: 'example-base', scores: { bfcl: 10 } },
      { name: 'example-instruct', scores: { bfcl: 60 } },
    ] },
  ]);
  expect(models.find((m) => m.llm_stats_model_id === 'example-base')?.benchmarks.bfcl).toBe(10);
  expect(models.find((m) => m.llm_stats_model_id === 'example-instruct')?.benchmarks.bfcl).toBe(60);
});

test('unknown weight availability is not recommended as downloadable', () => {
  const [model] = mergeAllSources([{ ...source('zeroeval', {}), models: [{ name: 'Mystery 8B', params_b: 8, scores: { gpqa_diamond: 80 } }] }]);
  expect(model.weight_status).toBe('unknown');
  expect(model.closed_source).toBe(true);
});

test('fallback spelling cannot rename a stable live model', () => {
  const [model] = mergeAllSources([
    { ...source('zeroeval', {}), models: [{ name: 'Qwen3.5-35B-A3B', llm_stats_model_id: 'qwen3.5-35b-a3b', scores: { gpqa_diamond: 84.2 } }] },
  ], { models: [{ name: 'Qwen3.5.35b A3b', gpqa_diamond: 80 }] });
  expect(model.name).toBe('Qwen3.5-35B-A3B');
});

test('old model URLs resolve after a canonical display-name change', () => {
  const models = mergeAllSources([
    { ...source('zeroeval', {}), models: [
      { name: 'IBM Granite 4.2 8B', llm_stats_model_id: 'granite-4.2-8b', scores: { gpqa_diamond: 60 } },
      { name: 'Muse Wonder', llm_stats_model_id: 'muse-wonder-1.0', scores: { gpqa_diamond: 80 } },
      { name: 'Muse Wonder', llm_stats_model_id: 'muse-wonder', scores: { gpqa_diamond: 60 } },
    ] },
  ]);
  expect(findModelBySlug(models, 'granite-4-2-8b')?.name).toBe('IBM Granite 4.2 8B');
  expect(findModelBySlug(models, 'ibm-granite-4-2-8b')?.llm_stats_model_id).toBe('granite-4.2-8b');
  expect(findModelBySlug(models, 'muse-wonder')?.llm_stats_model_id).toBe('muse-wonder-1.0');
  expect(findModelBySlug(models, 'muse-wonder-unversioned')?.llm_stats_model_id).toBe('muse-wonder');
});

test('vendor-only breadth remains provisional until an evaluator supplies evidence', () => {
  const scores = { gpqa_diamond: 80, swe_bench: 70, swe_bench_pro: 60, mcp_atlas: 70, aime_2025: 90, mmlu_pro: 80 };
  const vendor = mergeAllSources([source('zeroeval', scores)])[0];
  const evaluated = mergeAllSources([source('zeroeval', scores), source('swebench', { swe_bench: 70 })])[0];
  expect(vendor.rank_status).toBe('provisional');
  expect(evaluated.rank_status).toBe('ranked');
});

test('hardware cards require a matching evaluator test instead of unrelated index evidence', () => {
  const spec: HardwareSpec = { platform: 'mac', unifiedMemoryGb: 64, systemRamGb: 64, gpus: [] };
  const [base] = mergeAllSources([source('zeroeval', { swe_bench: 70, gpqa_diamond: 80 }), { ...source('livebench2', { livebench2_overall: 70 }), data_date: '2026-06-25' }]);
  const measured = { ...base, name: 'Measured', rank_status: 'ranked' as const, composite_score: 60, hwFit: computeHardwareFit(base, spec) };
  const unsupported = { ...measured, name: 'Unsupported', slug: 'unsupported', benchmark_sources: {}, rank_status: 'insufficient_evidence' as const, composite_score: 99 };
  const result = buildCategoryHardwareRecommendations([unsupported, measured])[0];
  expect(result.model?.name).toBe('Measured');
  expect(result.coverage).toBe(1);
  expect(result.qualified).toBe(true);
});

test('model age alone does not reduce a measured capability score', () => {
  const scores = { swe_bench: 70, gpqa_diamond: 80 };
  const recent = mergeAllSources([source('zeroeval', scores, { release: '2026-10-01' })])[0];
  const old = mergeAllSources([source('zeroeval', scores, { release: '2020-01-01' })])[0];
  expect(old.composite_score).toBe(recent.composite_score);
});

test('stale-cache response marks the response body stale without altering last-good data', () => {
  const data = { models: [], sources: [], updated: '2026-10-20T00:00:00Z', stale: false, dataSourceLabel: 'live' } as LeaderboardData;
  const result = refreshOutcomeResponse({ data, writtenAt: Date.now() - 3600000, refreshed: false, stale: true });
  expect(result.data.stale).toBe(true);
  expect(result.data.dataSourceLabel).toBe('partial');
  expect(data.stale).toBe(false);
});

test('memory over budget is not described as a non-offloaded fit', () => {
  const spec: HardwareSpec = { platform: 'mac', unifiedMemoryGb: 64, systemRamGb: 64, gpus: [] };
  const fit = computeHardwareFit({ name: 'Over budget', params_b: 88, vram_int4_gb: 50, vram_fp16_gb: 178 }, spec);
  expect(fit?.fit).toBe('too-large');
});

test('a CPU-offloaded large model cannot displace a model that fits accelerator memory', () => {
  const spec: HardwareSpec = { platform: 'pc', unifiedMemoryGb: 0, systemRamGb: 128, gpus: [{ label: '16GB', vramGb: 16 }] };
  const models = mergeAllSources([
    { ...source('zeroeval', {}), models: [
      { name: 'Small 8B', license: 'Apache 2.0', params_b: 8, scores: { swe_bench: 60, gpqa_diamond: 70 } },
      { name: 'Large 70B', license: 'Apache 2.0', params_b: 70, scores: { swe_bench: 95, gpqa_diamond: 95 } },
    ] },
    { ...source('livebench2', {}), data_date: '2026-11-06', models: [
      { name: 'Small 8B', scores: { livebench2_overall: 60 } },
      { name: 'Large 70B', scores: { livebench2_overall: 95 } },
    ] },
  ]);
  const recommendation = buildCategoryHardwareRecommendations(models.map((m) => ({ ...m, hwFit: computeHardwareFit(m, spec) })))[0];
  expect(recommendation.model?.name).toBe('Small 8B');
});


test('historical ranks from an older scoring method cannot create a trend', () => {
  expect(ranksForCategory({ date: '2026-10-15', updated: '2026-10-15', scoringVersion: 'v3-anchored', quality: 'live', ranks: { overall: { model: 1 }, categories: {} } }, 'overall')).toBeNull();
});

test('a failed cron attempt preserves the last successful receipt', async () => {
  const { setPersistenceForTests, recordCronRefresh, readCronRefreshStatus } = await import('../src/lib/store');
  const values = new Map<string, unknown>();
  setPersistenceForTests({
    set: async (key: string, value: unknown) => { values.set(key, value); return 'OK'; },
    get: async (key: string) => values.get(key) ?? null,
  } as never);
  try {
    const receipt = { attemptedAt: '2026-10-22T09:00:00Z', refreshed: true, cacheStatus: 'MISS', snapshotDate: '2026-10-22T09:00:00Z', sourceCount: 8, degradedSources: [] };
    expect(await recordCronRefresh(receipt)).toBe(true);
    await recordCronRefresh({ ...receipt, attemptedAt: '2026-10-23T09:00:00Z', refreshed: false, cacheStatus: 'ERROR-STALE' });
    const status = await readCronRefreshStatus();
    expect(status.lastAttempt?.refreshed).toBe(false);
    expect(status.lastSuccess?.attemptedAt).toBe('2026-10-22T09:00:00Z');
  } finally { setPersistenceForTests(undefined); }
});


test('uncited archive values cannot increase any score or evidence measure', () => {
  const live = [source('zeroeval', { gpqa_diamond: 80 })];
  const baseline = mergeAllSources(live)[0];
  const withArchive = mergeAllSources(live, { models: [{ name: 'Test 8B', livebench_global: 100, livebench_coding: 100, livebench_mathematics: 100, math_500: 100, aime_2025: 100 }] })[0];
  expect(withArchive.benchmarks).toEqual(baseline.benchmarks);
  expect(withArchive.composite_score).toBe(baseline.composite_score);
  expect(withArchive.confidence).toBe(baseline.confidence);
  expect(withArchive.family_coverage).toBe(baseline.family_coverage);
  expect(withArchive.rank_status).toBe(baseline.rank_status);
});
