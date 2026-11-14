import { mergeAllSources } from '../src/lib/merge-models';
import type { SourceResult } from '../src/lib/live-sources';

function makeSource(source_id: string, models: SourceResult['models']): SourceResult {
  return {
    source_id,
    source_name: source_id,
    models,
    fetched_at: '2026-04-07T00:00:00.000Z',
  };
}

describe('mergeAllSources', () => {
  test('matches LiveBench variants to the correct top model instead of older siblings', () => {
    const results: SourceResult[] = [
      makeSource('lmarena', [
        { name: 'claude-opus-4-thinking', scores: { arena_elo: 1400 } },
        { name: 'claude-opus-4-6-thinking', scores: { arena_elo: 1500 } },
      ]),
      makeSource('zeroeval', [
        { name: 'Claude Opus 4', provider: 'Anthropic', scores: { gpqa_diamond: 84 } },
        { name: 'Claude Opus 4.6', provider: 'Anthropic', scores: { gpqa_diamond: 91.3 } },
      ]),
      makeSource('livebench', [
        { name: 'claude-opus-4-6-thinking-auto-high-effort', scores: { livebench_global: 87 } },
      ]),
    ];

    const merged = mergeAllSources(results);
    const opus4 = merged.find((model) => model.name === 'Claude Opus 4');
    const opus46 = merged.find((model) => model.name === 'Claude Opus 4.6');

    expect(opus4?.benchmarks.livebench_global).toBeNull();
    expect(opus46?.benchmarks.livebench_global).toBe(87);
  });

  test('keeps GPT-5.4 mini separate from GPT-5.4 while still merging effort variants', () => {
    const results: SourceResult[] = [
      makeSource('lmarena', [
        { name: 'gpt-5.4-high', provider: 'openai', scores: { arena_elo: 1475 } },
        { name: 'gpt-5.4-mini-high', provider: 'openai', scores: { arena_elo: 1420 } },
      ]),
      makeSource('zeroeval', [
        { name: 'GPT-5.4', provider: 'OpenAI', scores: { gpqa_diamond: 92.8 } },
        { name: 'GPT-5.4 mini', provider: 'OpenAI', scores: { gpqa_diamond: 88 } },
      ]),
      makeSource('livebench', [
        { name: 'gpt-5.4-xhigh', scores: { livebench_global: 90 } },
        { name: 'gpt-5.4-mini-xhigh', scores: { livebench_global: 70 } },
      ]),
    ];

    const merged = mergeAllSources(results);
    const gpt54 = merged.find((model) => model.name === 'GPT-5.4');
    const gpt54Mini = merged.find((model) => model.name === 'GPT-5.4 mini');

    expect(gpt54?.benchmarks.livebench_global).toBe(90);
    expect(gpt54Mini?.benchmarks.livebench_global).toBe(70);
  });

  test('does not collapse GPT-4.5 into GPT-5.4 when version digits are reordered', () => {
    const results: SourceResult[] = [
      makeSource('lmarena', [
        { name: 'gpt-4.5-preview-2025-02-27', provider: 'openai', scores: { arena_elo: 1451 } },
        { name: 'gpt-5.4-high', provider: 'openai', scores: { arena_elo: 1497 } },
      ]),
      makeSource('zeroeval', [
        { name: 'GPT-4.5', provider: 'OpenAI', scores: { gpqa_diamond: 81.2 } },
        { name: 'GPT-5.4', provider: 'OpenAI', scores: { gpqa_diamond: 92.8 } },
      ]),
      makeSource('livebench', [
        { name: 'gpt-5.4-xhigh', scores: { livebench_global: 80.3 } },
      ]),
    ];

    const merged = mergeAllSources(results);
    const gpt45 = merged.find((model) => model.name === 'GPT-4.5');
    const gpt54 = merged.find((model) => model.name === 'GPT-5.4');

    expect(gpt45?.benchmarks.livebench_global).toBeNull();
    expect(gpt54?.benchmarks.livebench_global).toBe(80.3);
  });

  test('deduplicates multiple variants from the same source before counting source confidence', () => {
    const results: SourceResult[] = [
      makeSource('lmarena', [
        { name: 'gpt-5.4', provider: 'OpenAI', scores: { arena_elo: 1428 } },
        { name: 'gpt-5.4-high', provider: 'OpenAI', scores: { arena_elo: 1497 } },
      ]),
      makeSource('zeroeval', [
        { name: 'GPT-5.4', provider: 'OpenAI', scores: { gpqa_diamond: 92.8 } },
      ]),
    ];

    const merged = mergeAllSources(results);
    const gpt54 = merged.find((model) => model.name === 'GPT-5.4');

    expect(gpt54?.benchmarks.arena_elo).toBe(1497);
    expect(gpt54?.source_count.arena_elo).toBe(1);
    expect(gpt54?.benchmark_sources.arena_elo).toEqual([
      expect.objectContaining({
        source_id: 'lmarena',
        model_name: 'gpt-5.4-high',
        value: 1497,
      }),
    ]);
  });

  test('keeps the roster name for display; a curated spelling only becomes a URL alias', () => {
    // v5-identity: curated spellings ("Qwen1.5.72b Chat", "Codellama 34b
    // Instruct") used to outscore live LMArena names and silently rename and
    // re-slug 23 live rows. Curated names name a row only when no roster
    // source does (see 'uses curated fallback as the roster ...').
    const results: SourceResult[] = [
      makeSource('zeroeval', [
        { name: 'DeepSeek-V3.2 (Thinking)', provider: 'DeepSeek', scores: { swe_bench: 73.1 } },
      ]),
      makeSource('livebench', [
        { name: 'deepseek-v3.2-thinking', scores: { livebench_global: 65 } },
      ]),
    ];

    const fallback = {
      models: [
        {
          name: 'DeepSeek V3.2',
          provider: 'DeepSeek',
          closed_source: false,
          params_b: 685,
        },
      ],
    };

    const merged = mergeAllSources(results, fallback);
    const model = merged.find((entry) => entry.name === 'DeepSeek-V3.2 (Thinking)');

    expect(model).toBeDefined();
    expect(model?.benchmarks.livebench_global).toBe(65);
    expect(model?.provider).toBe('DeepSeek');
    expect(model?.slug_aliases).toContain('deepseek-v3-2');
    expect(model?.params_b).toBe(685);
  });

  test('never fills missing benchmark cells with uncited archived values', () => {
    const results: SourceResult[] = [
      makeSource('lmarena', [
        { name: 'gpt-5.4-high', provider: 'OpenAI', scores: { arena_elo: 1497 } },
      ]),
      makeSource('zeroeval', [
        { name: 'GPT-5.4', provider: 'OpenAI', scores: { gpqa_diamond: 92.8 } },
      ]),
    ];

    const fallback = {
      models: [
        {
          name: 'GPT-5.4',
          provider: 'OpenAI',
          arena_elo: 1462,
          livebench_global: 80.3,
        },
      ],
    };

    const merged = mergeAllSources(results, fallback);
    const gpt54 = merged.find((model) => model.name === 'GPT-5.4');

    expect(gpt54?.benchmarks.arena_elo).toBe(1497);
    expect(gpt54?.benchmarks.livebench_global).toBeNull();
    expect(gpt54?.source_count.arena_elo).toBe(1);
  });

  test('does not inject fallback-only models when live primary sources are healthy', () => {
    const results: SourceResult[] = [
      makeSource('lmarena', [
        { name: 'gpt-5.4-high', provider: 'OpenAI', scores: { arena_elo: 1497 } },
      ]),
      makeSource('zeroeval', [
        { name: 'GPT-5.4', provider: 'OpenAI', scores: { gpqa_diamond: 92.8 } },
      ]),
    ];

    const fallback = {
      models: [
        { name: 'GPT-5.4', provider: 'OpenAI', livebench_global: 80.3 },
        { name: 'GLM-5.1', provider: 'Zhipu AI', arena_elo: 1464 },
      ],
    };

    const merged = mergeAllSources(results, fallback);

    expect(merged.find((model) => model.name === 'GPT-5.4')?.benchmarks.livebench_global).toBeNull();
    expect(merged.find((model) => model.name === 'GLM-5.1')).toBeUndefined();
  });

  test('uses curated fallback as the roster only when primary live sources are unavailable', () => {
    const results: SourceResult[] = [
      makeSource('livebench', [
        { name: 'gpt-5.4-xhigh', scores: { livebench_global: 80.3 } },
      ]),
    ];

    const fallback = {
      models: [
        { name: 'GPT-5.4', provider: 'OpenAI', arena_elo: 1497 },
      ],
    };

    const merged = mergeAllSources(results, fallback);
    const gpt54 = merged.find((model) => model.name === 'GPT-5.4');

    expect(gpt54).toBeDefined();
    expect(gpt54?.benchmarks.arena_elo).toBeNull();
    expect(gpt54?.benchmarks.livebench_global).toBe(80.3);
  });

  test('matches effort suffixes, and preview rows only where the catalog identity is the preview', () => {
    // v5-identity: "preview" names a checkpoint. Gemini 3.1 Pro's upstream ID is
    // itself gemini-3.1-pro-preview, so its preview rows join; a preview row must
    // not fill a released model whose identity has no preview (o1-preview is not o1).
    const results: SourceResult[] = [
      makeSource('zeroeval', [
        { name: 'Gemini 3.1 Pro', llm_stats_model_id: 'gemini-3.1-pro-preview', provider: 'Google', scores: { gpqa_diamond: 94.3 } },
        { name: 'Qwen 3.5 397B', provider: 'Qwen', scores: { gpqa_diamond: 81.1 } },
        { name: 'o1', llm_stats_model_id: 'o1-2024-12-17', provider: 'OpenAI', scores: { gpqa_diamond: 78 } },
      ]),
      makeSource('livebench', [
        { name: 'gemini-3.1-pro-preview-high', scores: { livebench_global: 73.2 } },
        { name: 'qwen-3.5-397b-thinking', scores: { livebench_global: 65.4 } },
        { name: 'o1-preview', scores: { livebench_global: 50.1 } },
      ]),
    ];

    const merged = mergeAllSources(results);

    expect(merged.find((model) => model.name === 'Gemini 3.1 Pro')?.benchmarks.livebench_global).toBe(73.2);
    expect(merged.find((model) => model.name === 'Qwen 3.5 397B')?.benchmarks.livebench_global).toBe(65.4);
    expect(merged.find((model) => model.name === 'o1')?.benchmarks.livebench_global).toBeNull();
  });

  test('merges Code Arena family variants onto the canonical model name', () => {
    const results: SourceResult[] = [
      makeSource('codearena', [
        { name: 'claude-opus-4-6-thinking-auto-high-effort', scores: { code_arena: 1994 } },
      ]),
      makeSource('zeroeval', [
        { name: 'Claude Opus 4.6', provider: 'Anthropic', scores: { gpqa_diamond: 91.3 } },
      ]),
    ];

    const merged = mergeAllSources(results);
    const opus46 = merged.find((model) => model.name === 'Claude Opus 4.6');

    expect(opus46).toBeDefined();
    expect(opus46?.benchmarks.code_arena).toBe(1994);
    expect(opus46?.source_count.code_arena).toBe(1);
    expect(opus46?.benchmark_sources.code_arena).toEqual([
      expect.objectContaining({
        source_id: 'codearena',
        model_name: 'claude-opus-4-6-thinking-auto-high-effort',
        value: 1994,
      }),
    ]);
  });

  test('matches Gemma instruction-tuned rows from LiveBench onto the base family', () => {
    const results: SourceResult[] = [
      makeSource('zeroeval', [
        { name: 'Gemma 4 31B', provider: 'Google', scores: { gpqa_diamond: 84.3 } },
      ]),
      makeSource('livebench', [
        { name: 'gemma-4-31b-it', scores: { livebench_global: 61.3 } },
      ]),
    ];

    const merged = mergeAllSources(results);
    const gemma = merged.find((model) => model.name === 'Gemma 4 31B');

    expect(gemma).toBeDefined();
    expect(gemma?.benchmarks.livebench_global).toBe(61.3);
  });

  test('keeps code arena-only primary roster models instead of dropping sparse rows', () => {
    const results: SourceResult[] = [
      makeSource('zeroeval', [
        { name: 'Qwen3-Coder', provider: 'Qwen', scores: { gpqa_diamond: null } },
      ]),
      makeSource('codearena', [
        { name: 'Qwen3-Coder', provider: 'Qwen', scores: { code_arena: 600 } },
      ]),
    ];

    const merged = mergeAllSources(results);
    const model = merged.find((entry) => entry.name === 'Qwen3-Coder');

    expect(model).toBeDefined();
    expect(model?.benchmarks.code_arena).toBe(600);
    expect(model?.benchmark_coverage).toBe(1);
  });

  test('matches non-thinking variants onto the base family when sources disagree on phrasing', () => {
    const results: SourceResult[] = [
      makeSource('zeroeval', [
        { name: 'DeepSeek V3.2', provider: 'DeepSeek', scores: { gpqa_diamond: 82.4 } },
      ]),
      makeSource('codearena', [
        { name: 'DeepSeek-V3.2 (Non-thinking)', provider: 'DeepSeek', scores: { code_arena: 703 } },
      ]),
    ];

    const merged = mergeAllSources(results);
    const model = merged.find((entry) => entry.name === 'DeepSeek V3.2');

    expect(model).toBeDefined();
    expect(model?.benchmarks.code_arena).toBe(703);
  });

  test('matches short release-tag variants like 0309 onto the canonical family', () => {
    const results: SourceResult[] = [
      makeSource('lmarena', [
        { name: 'Grok 4.20 Multi Agent Beta 0309', provider: 'xAI', scores: { arena_elo: 1447 } },
      ]),
      makeSource('codearena', [
        { name: 'Grok-4.20 Multi-Agent Beta', provider: 'xAI', scores: { code_arena: 600 } },
      ]),
    ];

    const merged = mergeAllSources(results);
    const model = merged.find((entry) =>
      entry.benchmark_sources.code_arena.some((source) => source.model_name === 'Grok-4.20 Multi-Agent Beta')
    );

    expect(model).toBeDefined();
    expect(model?.benchmarks.arena_elo).toBe(1447);
    expect(model?.benchmarks.code_arena).toBe(600);
  });

  test('preserves the linked LLM Stats model id on the merged canonical model', () => {
    const results: SourceResult[] = [
      makeSource('zeroeval', [
        {
          name: 'Gemma 4 31B',
          provider: 'Google',
          llm_stats_model_id: 'gemma-4-31b-it',
          scores: { gpqa_diamond: 84.3 },
        },
      ]),
      makeSource('livebench', [
        { name: 'gemma-4-31b-it', scores: { livebench_global: 61.3 } },
      ]),
    ];

    const merged = mergeAllSources(results);
    const gemma = merged.find((entry) => entry.name === 'Gemma 4 31B');

    expect(gemma?.llm_stats_model_id).toBe('gemma-4-31b-it');
    expect(gemma?.benchmarks.livebench_global).toBe(61.3);
  });

  test('sorts benchmark-rich frontier models ahead of sparse coding-only rows in default API order', () => {
    const results: SourceResult[] = [
      makeSource('zeroeval', [
        {
          name: 'Claude Opus 4.7',
          provider: 'Anthropic',
          scores: {
            code_arena: 2006,
            gpqa_diamond: 94.2,
            swe_bench: 87.6,
            hle: 54.7,
          },
        },
        {
          name: 'Sparse Coding Hero',
          provider: 'Example',
          scores: {
            code_arena: 1900,
          },
        },
      ]),
      makeSource('livebench', [
        {
          name: 'claude-opus-4-7',
          scores: {
            livebench_global: 76.9,
            livebench_reasoning: 87.7,
            livebench_coding: 82.1,
            livebench_mathematics: 93.1,
          },
        },
      ]),
    ];

    const merged = mergeAllSources(results);

    expect(merged[0]?.name).toBe('Claude Opus 4.7');
    expect(merged.findIndex((model) => model.name === 'Sparse Coding Hero')).toBeGreaterThan(0);
  });

  test('assigns a non-empty frontier tier when Arena ELO is missing but live benchmark coverage is strong', () => {
    const results: SourceResult[] = [
      makeSource('zeroeval', [
        {
          name: 'Claude Opus 4.7',
          provider: 'Anthropic',
          scores: {
            code_arena: 2006,
            gpqa_diamond: 94.2,
            swe_bench: 87.6,
            mmlu_pro: 89.4,
            ifeval: 91.2,
            aime_2025: 92.7,
            hle: 54.7,
          },
        },
      ]),
      makeSource('livebench', [
        {
          name: 'claude-opus-4-7',
          scores: {
            livebench_global: 76.9,
            livebench_reasoning: 87.7,
            livebench_coding: 82.1,
            livebench_mathematics: 93.1,
          },
        },
      ]),
    ];

    const merged = mergeAllSources(results);
    const opus47 = merged.find((model) => model.name === 'Claude Opus 4.7');

    expect(opus47).toBeDefined();
    expect(opus47?.tier).not.toBe('');
  });

  test('adds recent LLM Stats scorecard releases to the roster before ZeroEval and LMArena catch up', () => {
    const results: SourceResult[] = [
      makeSource('llmstats_recent', [
        {
          name: 'Qwen3.6 Plus',
          provider: 'Alibaba Cloud / Qwen Team',
          llm_stats_model_id: 'qwen3.6-plus',
          release: '2026-03-31',
          vision: true,
          scores: {
            aime_2026: 95.3,
            mmlu_pro: 88.5,
            ifeval: 94.3,
            gpqa_diamond: 90.4,
          },
        },
      ]),
    ];

    const merged = mergeAllSources(results);
    const qwen36 = merged.find((model) => model.name === 'Qwen3.6 Plus');

    expect(qwen36).toBeDefined();
    expect(qwen36?.llm_stats_model_id).toBe('qwen3.6-plus');
    expect(qwen36?.benchmarks.aime_2026).toBe(95.3);
    expect(qwen36?.benchmarks.mmlu_pro).toBe(88.5);
    expect(qwen36?.benchmarks.ifeval).toBe(94.3);
  });
});

describe('pricing and effort variant threading', () => {
  test('carries published pricing and effort variants onto the merged model', () => {
    const zeroeval = makeSource('zeroeval', [
      {
        name: 'GPT-5.5',
        provider: 'OpenAI',
        license: 'proprietary',
        input_price_per_m: 1.25,
        output_price_per_m: 10,
        scores: { gpqa_diamond: 88 },
      },
    ]);
    const livebench = makeSource('livebench', [
      {
        name: 'gpt-5.5-xhigh',
        scores: { livebench_global: 79.9 },
        effort_variants: [
          {
            variant_name: 'gpt-5.5-xhigh',
            effort: 'xhigh',
            livebench_global: 79.9,
            livebench_coding: 80.1,
            livebench_reasoning: 85.2,
            run_cost_usd: 538.23,
          },
          {
            variant_name: 'gpt-5.5',
            effort: 'standard',
            livebench_global: 72.2,
            livebench_coding: 71.4,
            livebench_reasoning: 78.9,
            run_cost_usd: 194.24,
          },
        ],
      },
    ]);

    const merged = mergeAllSources([zeroeval, livebench]);
    const model = merged.find((m) => m.name === 'GPT-5.5');

    expect(model).toBeDefined();
    expect(model!.input_price_per_m).toBe(1.25);
    expect(model!.output_price_per_m).toBe(10);
    expect(model!.effort_variants).toHaveLength(2);
    expect(model!.best_effort).toBe('xhigh');
    expect(model!.effort_variants[0].run_cost_usd).toBeCloseTo(538.23);
  });

  test('models without published pricing or variants stay null/empty', () => {
    const zeroeval = makeSource('zeroeval', [
      { name: 'Mystery Model', scores: { gpqa_diamond: 50 } },
    ]);

    const merged = mergeAllSources([zeroeval]);
    const model = merged.find((m) => m.name === 'Mystery Model');

    expect(model!.input_price_per_m).toBeNull();
    expect(model!.output_price_per_m).toBeNull();
    expect(model!.effort_variants).toEqual([]);
    expect(model!.best_effort).toBeNull();
  });
});

describe('published price pair selection', () => {
  test('keeps a real published pair (cheapest) instead of a median across variants', () => {
    const zeroeval = makeSource('zeroeval', [
      {
        name: 'DeepSeek-V3.2 (Thinking)',
        input_price_per_m: 2,
        output_price_per_m: 20,
        scores: { gpqa_diamond: 80 },
      },
      {
        name: 'DeepSeek-V3.2 (Non-thinking)',
        input_price_per_m: 0.075,
        output_price_per_m: 0.3,
        scores: { gpqa_diamond: 70 },
      },
    ]);

    const merged = mergeAllSources([zeroeval]);
    const model = merged.find((m) => m.name.startsWith('DeepSeek-V3.2'));

    // Cheapest published pair, exactly as published — no $1.04 median, no cent rounding.
    expect(model!.input_price_per_m).toBe(0.075);
    expect(model!.output_price_per_m).toBe(0.3);
  });

  // A proprietary API model must never be published as open-weight. Qwen3.8 Max
  // (2400B, ~1322GB int4, license "Proprietary") was flagged open because a
  // source is_open flag overrode the license, and because a tie resolved open.
  test('an explicit proprietary license beats source open-flags and ties resolve closed', () => {
    const proprietary = mergeAllSources([
      makeSource('zeroeval', [
        { name: 'Mega Max', provider: 'Qwen', license: 'Proprietary', is_open: true, scores: { gpqa_diamond: 90 } },
      ]),
    ]).find((m) => m.name === 'Mega Max');
    expect(proprietary?.closed_source).toBe(true);

    // One open vote against one closed vote is not a majority for open.
    const tied = mergeAllSources([
      makeSource('zeroeval', [{ name: 'Tied Model', provider: 'Acme', is_open: true, scores: { gpqa_diamond: 80 } }]),
      makeSource('llmstats_recent', [{ name: 'Tied Model', provider: 'Acme', is_open: false, scores: { hle: 30 } }]),
    ]).find((m) => m.name === 'Tied Model');
    expect(tied?.closed_source).toBe(true);

    // A genuine open-weight model is unaffected.
    const open = mergeAllSources([
      makeSource('zeroeval', [
        { name: 'Free Model', provider: 'Qwen', license: 'apache_2_0', is_open: true, scores: { gpqa_diamond: 85 } },
      ]),
    ]).find((m) => m.name === 'Free Model');
    expect(open?.closed_source).toBe(false);
  });

  test('a downloadable-weight license beats the provider default for GPT-OSS and Gemma', () => {
    const merged = mergeAllSources([
      makeSource('zeroeval', [
        { name: 'GPT OSS 20B', provider: 'OpenAI', license: 'apache_2_0', is_open: false, scores: { gpqa_diamond: 80 } },
        { name: 'Gemma 3 27B', provider: 'Google', license: 'gemma', is_open: false, scores: { gpqa_diamond: 75 } },
        { name: 'Gemini API', provider: 'Google', license: 'Proprietary', is_open: true, scores: { gpqa_diamond: 90 } },
      ]),
    ]);

    expect(merged.find((model) => model.name === 'GPT OSS 20B')?.closed_source).toBe(false);
    expect(merged.find((model) => model.name === 'Gemma 3 27B')?.closed_source).toBe(false);
    expect(merged.find((model) => model.name === 'Gemini API')?.closed_source).toBe(true);
  });

  // AUDIT-2026-08-14 finding 13: one company appeared as two provider chips
  // because sources spell it both bare and with an "-ai" suffix.
  test('collapses -ai suffixed provider spellings onto one provider', () => {
    const merged = mergeAllSources([
      makeSource('zeroeval', [
        { name: 'Phi Alpha', provider: 'Microsoft', scores: { gpqa_diamond: 70 } },
        { name: 'Phi Beta', provider: 'Microsoft-ai', scores: { gpqa_diamond: 71 } },
        { name: 'Mercury One', provider: 'Inception', scores: { gpqa_diamond: 60 } },
        { name: 'Mercury Two', provider: 'Inception-ai', scores: { gpqa_diamond: 61 } },
      ]),
    ]);
    const providers = new Set(merged.map((m) => m.provider));
    expect(providers.has('Microsoft')).toBe(true);
    expect(providers.has('Microsoft-ai')).toBe(false);
    expect(providers.has('Inception')).toBe(true);
    expect(providers.has('Inception-ai')).toBe(false);
  });

  // Regression: removing a benchmark must never raise a model's composite.
  // The v2 scorer renormalized the composite over only the categories a model
  // had data for, so deleting the ONLY benchmark in a category deleted that
  // category's weight entirely. With real Claude Fable 5 values, dropping
  // livebench_reasoning (89.7 — a benchmark it LEADS) raised its composite from
  // 62.0 to 64.2 and moved it from #2 to #1 ahead of Gemini 3.1 Pro.
  describe('composite monotonicity', () => {
    const FABLE_BENCHMARKS: Record<string, number> = {
      arena_elo: 1507, code_arena: 2023, livebench_agentic_coding: 62.2,
      livebench_coding: 86, livebench_global: 83, livebench_reasoning: 89.7,
      swe_bench: 95,
    };

    const compositeFor = (scores: Record<string, number>): number => {
      const merged = mergeAllSources([makeSource('zeroeval', [{ name: 'Monotonicity Probe', scores }])]);
      return merged.find((m) => m.name === 'Monotonicity Probe')!.composite_score;
    };

    // GUARANTEED: emptying a whole scoring category cannot raise the composite.
    // This is the defect that inverted the public board — the category's weight
    // used to disappear with it, making total absence cheaper than thin presence.
    test('emptying a scoring category never increases the composite', () => {
      const baseline = compositeFor(FABLE_BENCHMARKS);
      expect(baseline).toBeGreaterThan(0);

      // livebench_reasoning is Fable's ONLY reasoning-category key, and
      // code_arena + swe_bench + the livebench coding keys are its coding ones.
      for (const soleKey of ['livebench_reasoning', 'livebench_global']) {
        const reduced = { ...FABLE_BENCHMARKS };
        delete reduced[soleKey];
        expect(compositeFor(reduced)).toBeLessThanOrEqual(baseline);
      }
    });

    // NOT guaranteed, and deliberately pinned so the bound cannot drift silently:
    // removing a single below-average cell from a category that still has other
    // cells raises that category's mean, which is inherent to averaging. It is a
    // real (small) incentive to withhold a weak result. The rank gate limits the
    // blast radius — a vendor cannot withhold its way past the family threshold —
    // but the effect is not zero, so it is bounded and asserted rather than
    // claimed to be absent.
    test('withholding a single weak cell moves the composite by less than 0.5', () => {
      const baseline = compositeFor(FABLE_BENCHMARKS);
      let worst = 0;
      for (const key of Object.keys(FABLE_BENCHMARKS)) {
        const reduced = { ...FABLE_BENCHMARKS };
        delete reduced[key];
        worst = Math.max(worst, compositeFor(reduced) - baseline);
      }
      expect(worst).toBeLessThan(0.5);
      // Rounding and revised evidence weights can make this fixture
      // exactly zero; the safety bound does not require a harmful effect.
    });

    test('dropping livebench_reasoning specifically does not raise the score', () => {
      const withReasoning = compositeFor(FABLE_BENCHMARKS);
      const withoutReasoning = { ...FABLE_BENCHMARKS };
      delete withoutReasoning.livebench_reasoning;
      expect(compositeFor(withoutReasoning)).toBeLessThanOrEqual(withReasoning);
    });
  });
});
