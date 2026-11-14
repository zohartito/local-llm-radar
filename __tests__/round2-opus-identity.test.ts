import { mergeAllSources, SCORING_VERSION, type MergedModel } from '../src/lib/merge-models';
import { findModelBySlug } from '../src/lib/leaderboard';
import type { SourceModel, SourceResult } from '../src/lib/live-sources';

// Round-two identity and metadata regressions (R2-OPUS-01/02, C2-01/02).
// Every fixture mirrors a row observed in the 2026-10-23T00:47Z capture.

function source(source_id: string, models: SourceModel[]): SourceResult {
  return { source_id, source_name: source_id, models, fetched_at: '2026-10-23T00:00:00.000Z' };
}

function catalog(id: string, name: string, extra: Partial<SourceModel> = {}): SourceModel {
  return { name, llm_stats_model_id: id, provider: 'Vendor', license: 'proprietary', scores: { gpqa_diamond: 50 }, ...extra };
}

const byId = (models: MergedModel[], id: string) => models.find((model) => model.llm_stats_model_id === id)!;

describe('R2-OPUS-01: board rows join their own release, never a sibling', () => {
  test('each Claude 3.5 Sonnet release keeps its own Arena rating', () => {
    const models = mergeAllSources([
      source('zeroeval', [catalog('claude-3-5-sonnet-20240620', 'Claude 3.5 Sonnet'), catalog('claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet')]),
      source('lmarena', [
        { name: 'Claude 3.5 Sonnet (20241022)', scores: { arena_elo: 1374 } },
        { name: 'Claude 3.5 Sonnet (20240620)', scores: { arena_elo: 1343 } },
      ]),
    ]);
    expect(byId(models, 'claude-3-5-sonnet-20240620').benchmarks.arena_elo).toBe(1343);
    expect(byId(models, 'claude-3-5-sonnet-20241022').benchmarks.arena_elo).toBe(1374);
  });

  test('a different product (Chat) or release code (0314) becomes its own row', () => {
    const models = mergeAllSources([
      source('zeroeval', [catalog('gpt-5.2-2025-12-11', 'GPT-5.2'), catalog('gpt-4-0613', 'GPT-4')]),
      source('lmarena', [
        { name: 'GPT-5.2 Chat (20260210)', scores: { arena_elo: 1475 } },
        { name: 'GPT-5.2', scores: { arena_elo: 1435 } },
        { name: 'GPT-4 (0314)', scores: { arena_elo: 1288 } },
        { name: 'GPT-4 (0613)', scores: { arena_elo: 1276 } },
      ]),
    ]);
    expect(byId(models, 'gpt-5.2-2025-12-11').benchmarks.arena_elo).toBe(1435);
    expect(byId(models, 'gpt-4-0613').benchmarks.arena_elo).toBe(1276);
    expect(models.find((model) => model.name === 'GPT-5.2 Chat (20260210)')?.benchmarks.arena_elo).toBe(1475);
    expect(models.find((model) => model.name === 'GPT-4 (0314)')?.benchmarks.arena_elo).toBe(1288);
  });

  test('name-only releases that differ by alpha/beta, context size or date stay separate', () => {
    const models = mergeAllSources([
      source('zeroeval', [catalog('anchor', 'Anchor')]),
      source('lmarena', [
        { name: 'Zephyr 7B Alpha', scores: { arena_elo: 1127 } },
        { name: 'Zephyr 7B Beta', scores: { arena_elo: 1131 } },
        { name: 'Phi-3 Mini 4K Instruct', scores: { arena_elo: 1128 } },
        { name: 'Phi-3 Mini 128K Instruct', scores: { arena_elo: 1130 } },
        { name: 'Kimi K2 Preview (0711)', scores: { arena_elo: 1418 } },
        { name: 'Kimi K2 Preview (0905)', scores: { arena_elo: 1419 } },
      ]),
    ]);
    const arena = (name: string) => models.find((model) => model.name === name)?.benchmarks.arena_elo;
    expect(arena('Zephyr 7B Alpha')).toBe(1127);
    expect(arena('Zephyr 7B Beta')).toBe(1131);
    expect(arena('Phi-3 Mini 4K Instruct')).toBe(1128);
    expect(arena('Phi-3 Mini 128K Instruct')).toBe(1130);
    expect(arena('Kimi K2 Preview (0711)')).toBe(1418);
    expect(arena('Kimi K2 Preview (0905)')).toBe(1419);
  });

  test('effort variants of one product still report the best published setting', () => {
    const models = mergeAllSources([
      source('zeroeval', [catalog('claude-opus-4-7', 'Claude Opus 4.7')]),
      source('lmarena', [
        { name: 'Claude Opus 4.7', scores: { arena_elo: 1494 } },
        { name: 'Claude Opus 4.7 (High)', scores: { arena_elo: 1501 } },
      ]),
    ]);
    const opus = byId(models, 'claude-opus-4-7');
    expect(opus.benchmarks.arena_elo).toBe(1501);
    expect(opus.benchmark_sources.arena_elo[0].model_name).toBe('Claude Opus 4.7 (High)');
  });

  test('full dates must agree across years; MMDD codes use real month/day grammar', () => {
    const models = mergeAllSources([
      source('zeroeval', [catalog('example-2024-06-20', 'Example'), catalog('other-1022', 'Other')]),
      source('lmarena', [
        { name: 'Example (2025-06-20)', scores: { arena_elo: 1300 } },
        { name: 'Other (1103)', scores: { arena_elo: 1200 } },
      ]),
    ]);
    expect(byId(models, 'example-2024-06-20').benchmarks.arena_elo).toBeNull();
    expect(byId(models, 'other-1022').benchmarks.arena_elo).toBeNull();
  });

  test('a dated board name joins the catalog row released that day, not an unconfirmed one', () => {
    const models = mergeAllSources([
      source('zeroeval', [
        catalog('o4-mini', 'o4-mini', { release: '2025-04-16' }),
        catalog('deepseek-v2.5', 'DeepSeek-V2.5', { release: '2024-09-05' }),
      ]),
      source('lmarena', [
        { name: 'o4-mini (2025-04-16)', scores: { arena_elo: 1391 } },
        { name: 'DeepSeek-V2.5', scores: { arena_elo: 1307 } },
        { name: 'DeepSeek-V2.5 (1210)', scores: { arena_elo: 1323 } },
      ]),
    ]);
    expect(byId(models, 'o4-mini').benchmarks.arena_elo).toBe(1391);
    expect(byId(models, 'deepseek-v2.5').benchmarks.arena_elo).toBe(1307);
    expect(models.find((model) => model.name === 'DeepSeek-V2.5 (1210)')?.benchmarks.arena_elo).toBe(1323);
  });

  test('an undated name with several candidate releases is ambiguous', () => {
    const models = mergeAllSources([
      source('zeroeval', [
        catalog('kimi-k2-instruct', 'Kimi K2 Instruct'),
        catalog('kimi-k2-thinking-0905', 'Kimi K2-Thinking-0905'),
      ]),
      source('swebench', [
        { name: 'kimi-k2-instruct', scores: { swe_bench: 53.4 } },
        { name: 'Kimi-K2-Thinking', scores: { swe_bench: 63.4 } },
      ]),
    ]);
    expect(byId(models, 'kimi-k2-instruct').benchmarks.swe_bench).toBe(53.4);
    expect(byId(models, 'kimi-k2-thinking-0905').benchmarks.swe_bench).toBeNull();
  });

  test('another board can still enrich a model only LMArena lists', () => {
    const models = mergeAllSources([
      source('zeroeval', [catalog('anchor', 'Anchor')]),
      source('lmarena', [{ name: 'DeepSeek-V4-Flash', scores: { arena_elo: 1436 } }]),
      source('livebench', [{ name: 'deepseek-v4-flash', scores: { livebench_global: 65.48 } }]),
    ]);
    expect(models.find((model) => model.name === 'DeepSeek-V4-Flash')?.benchmarks.livebench_global).toBe(65.48);
  });
});

describe('R2-OPUS-02: "+" is part of the product name', () => {
  test('Command A rows never fill Command A+, and R vs R+ keep separate URLs', () => {
    const models = mergeAllSources([
      source('zeroeval', [catalog('command-a-plus-05-2026', 'Command A+')]),
      source('lmarena', [
        { name: 'Command R+ (08-2024)', scores: { arena_elo: 1276 } },
        { name: 'Command R (08-2024)', scores: { arena_elo: 1251 } },
      ]),
      source('bfcl', [
        { name: 'Command A', scores: { bfcl: 46.5 } },
        { name: 'Command A Reasoning', scores: { bfcl: 57.1 } },
      ]),
    ]);
    expect(byId(models, 'command-a-plus-05-2026').benchmarks.bfcl).toBeNull();
    const plus = models.find((model) => model.name === 'Command R+ (08-2024)')!;
    const plain = models.find((model) => model.name === 'Command R (08-2024)')!;
    expect(plus.benchmarks.arena_elo).toBe(1276);
    expect(plain.benchmarks.arena_elo).toBe(1251);
    expect(plus.slug).not.toBe(plain.slug);
    expect(findModelBySlug(models, plain.slug)?.name).toBe('Command R (08-2024)');
  });
});

describe('C2-01: curated metadata only fills fields no live source published', () => {
  const live = source('zeroeval', [catalog('qwen3-30b-a3b', 'Qwen3 30B A3B', {
    license: 'apache_2_0', params_b: 30.5, context_k: 128, vision: false, release: '2025-04-29',
  })]);
  const fallback = {
    _updated: '2026-08-01',
    models: [{
      name: 'Qwen3 30B A3B', llm_stats_model_id: 'qwen3-30b-a3b', params_b: 35, context_k: 1000,
      vision: true, release: '2026-03', license: 'Apache 2.0', closed_source: false, moe_active_b: 3.3,
    }],
  };

  test('live values win outright and are never blended with curated ones', () => {
    const model = byId(mergeAllSources([live], fallback), 'qwen3-30b-a3b');
    expect(model.params_b).toBe(30.5);
    expect(model.context_k).toBe(128);
    expect(model.vision).toBe(false);
    expect(model.release).toBe('2025-04-29');
    // Same license claim, shown in its readable spelling.
    expect(model.license).toBe('Apache 2.0');
    expect(model.moe_active_b).toBe(3.3);
    expect(model.metadata_sources?.params_b).toEqual([
      { source_id: 'zeroeval', value: 30.5, selected: true },
      { source_id: 'fallback', value: 35, selected: false, is_fallback: true },
    ]);
  });

  test('curated values fill a field the live source left empty, attributed as fallback', () => {
    const sparse = source('zeroeval', [catalog('qwen3-30b-a3b', 'Qwen3 30B A3B', { license: 'apache_2_0' })]);
    const model = byId(mergeAllSources([sparse], fallback), 'qwen3-30b-a3b');
    expect(model.params_b).toBe(35);
    expect(model.metadata_sources?.params_b).toEqual([{ source_id: 'fallback', value: 35, selected: true, is_fallback: true }]);
  });

  test('one source with several rows reports one actual value, not a median', () => {
    const models = mergeAllSources([
      source('zeroeval', [catalog('anchor', 'Anchor')]),
      source('lmarena', [
        { name: 'Example Model', scores: { arena_elo: 1200 } },
        { name: 'Example Model (High)', scores: { arena_elo: 1210 } },
      ]),
      source('codearena', [
        { name: 'Example Model', params_b: 20, scores: { code_arena: 1500 } },
        { name: 'Example Model (High)', params_b: 30, scores: { code_arena: 1600 } },
      ]),
    ]);
    expect(models.find((model) => model.name === 'Example Model')?.params_b).toBe(20);
  });
});

describe('C2-02: openness and licenses are deterministic and conservative', () => {
  test('source order cannot change license, provider or openness', () => {
    const sources = [
      source('zeroeval', [catalog('minimax-m3', 'MiniMax M3', { license: 'mit', provider: 'MiniMax' })]),
      source('lmarena', [{ name: 'MiniMax M3', license: 'MiniMax Community License', provider: 'minimax', scores: { arena_elo: 1400 } }]),
    ];
    const forward = byId(mergeAllSources(sources), 'minimax-m3');
    const reversed = byId(mergeAllSources([...sources].reverse()), 'minimax-m3');
    expect([reversed.license, reversed.provider, reversed.weight_status]).toEqual([forward.license, forward.provider, forward.weight_status]);
    expect(forward.license).toBe('mit');
  });

  test('a model-named license id is not the Qwen license, and closed claims keep Qwen3.8 Max closed', () => {
    const model = byId(mergeAllSources([
      source('zeroeval', [catalog('qwen3.8-max', 'Qwen3.8 Max', { license: 'qwen3_8_max', is_open: true, provider: 'Qwen' })]),
      source('lmarena', [{ name: 'Qwen3.8-Max', license: 'Proprietary', is_open: false, scores: { arena_elo: 1483 } }]),
    ]), 'qwen3.8-max');
    expect(model.closed_source).toBe(true);
    expect(model.weight_status).toBe('closed');
  });

  test('live sources that contradict each other make openness unknown, not open', () => {
    const model = byId(mergeAllSources([
      source('zeroeval', [catalog('example-open', 'Example Open', { license: 'proprietary', is_open: false })]),
      source('lmarena', [{ name: 'Example Open', license: 'Apache 2.0', is_open: true, scores: { arena_elo: 1300 } }]),
    ]), 'example-open');
    expect(model.weight_status).toBe('unknown');
    expect(model.closed_source).toBe(true);
  });

  test('a verified primary-source record settles a known upstream error, with its URL', () => {
    const model = byId(mergeAllSources([
      source('zeroeval', [catalog('gemma-3n-e4b-it', 'Gemma 3n E4B Instructed', { license: 'proprietary', is_open: false, provider: 'Google' })]),
      source('lmarena', [{ name: 'Gemma 3n E4B IT', license: 'Gemma', is_open: true, scores: { arena_elo: 1318 } }]),
    ]), 'gemma-3n-e4b-it');
    expect(model.weight_status).toBe('open');
    expect(model.license).toBe('Gemma');
    expect(model.metadata_sources?.license?.[0]).toEqual({ source_id: 'verified', value: 'Gemma', selected: true, source_url: 'https://huggingface.co/google/gemma-3n-E4B-it' });
  });
  test('release corrections apply to exact checkpoints and preserve upstream evidence', () => {
    const dates = {
      'gemini-2.5-pro': '2025-06-17', 'gemini-2.5-flash': '2025-06-17',
      'gemini-2.5-flash-lite': '2025-07-22', 'mistral-large-3-2509': '2025-12-02',
      'mistral-large-3-675b-base-2512': '2025-12-02', 'mistral-large-latest': '2025-12-02',
      'command-r-plus-04-2024': '2024-04-04',
    };
    for (const [id, release] of Object.entries(dates)) {
      const [model] = mergeAllSources([source('zeroeval', [catalog(id, id, { release: '2025-01-01' })])]);
      expect(model.release).toBe(release);
      expect(model.metadata_sources?.release).toEqual(expect.arrayContaining([
        expect.objectContaining({ source_id: 'verified', value: release, selected: true, source_url: expect.stringMatching(/^https:/) }),
        expect.objectContaining({ source_id: 'zeroeval', value: '2025-01-01', selected: false }),
      ]));
      expect(model.benchmarks.gpqa_diamond).toBe(50);
    }
    const [preview] = mergeAllSources([source('zeroeval', [catalog('gemini-2.5-pro-preview-06-05', 'Gemini 2.5 Pro Preview 06-05', { release: '2025-06-05' })])]);
    expect(preview.release).toBe('2025-06-05');
  });
});

test('identity semantics carry their own scoring version', () => {
  expect(SCORING_VERSION).toBe('v7-editioned');
});
