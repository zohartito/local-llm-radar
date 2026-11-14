import {
  liveBenchBaseName,
  liveBenchEffortLabel,
  parseLLMStatsCodeArenaModels,
  parseLLMStatsModelScorecard,
  parseLLMStatsRecentUpdates,
  scorecardBenchmarkKey,
} from '../src/lib/live-sources';

describe('scorecard benchmark semantics', () => {
  test('keeps HLE tool conditions in separate columns', () => {
    expect(scorecardBenchmarkKey({ benchmark_id: "humanity's-last-exam", analysis_method: 'No tools' })).toBe('hle_no_tools');
    expect(scorecardBenchmarkKey({ benchmark_id: "humanity's-last-exam", analysis_method: 'With tools' })).toBe('hle_tools');
    expect(scorecardBenchmarkKey({ benchmark_id: "humanity's-last-exam", analysis_method: null })).toBe('hle');
  });
});

// Terminal-Bench editions are different task sets. llm-stats publishes each
// under its own id (census of 50 recent scorecards, 2026-10-23: 2.1 x20,
// 4.0 x20, 3.0 x4, 4.0-aa x4). Folding 2.x/3.0 into the 4.0-anchored key put
// vendor 2.1 scores up to 90.6 beside a 4.0 board whose best is 64.8.
describe('scorecard benchmark editions stay separate', () => {
  test.each([
    ['terminal-bench-2', 'terminal_bench_2'],
    ['terminal-bench-2.1', 'terminal_bench_2_1'],
    ['terminal-bench-3.0', 'terminal_bench_3'],
    ['terminal-bench-4.0', 'terminal_bench_4'],
    ['terminal-bench-4.0-aa', 'terminal_bench_4'],
    ['livecodebench-v6', 'livecodebench'],
    ['livecodebench-pro', 'livecodebench_pro'],
  ])('%s -> %s', (benchmarkId, expected) => {
    expect(scorecardBenchmarkKey({ benchmark_id: benchmarkId, analysis_method: null })).toBe(expected);
  });

  test('no scorecard edition maps into the unversioned terminal_bench key', () => {
    for (const id of ['terminal-bench-2', 'terminal-bench-2.1', 'terminal-bench-3.0', 'terminal-bench-4.0', 'terminal-bench-science-0.1']) {
      expect(scorecardBenchmarkKey({ benchmark_id: id, analysis_method: null })).not.toBe('terminal_bench');
    }
    expect(scorecardBenchmarkKey({ benchmark_id: 'terminal-bench-science-0.1', analysis_method: null })).toBeNull();
  });
});

describe('parseLLMStatsCodeArenaModels', () => {
  test('extracts Code Arena ratings from the LLM Stats page payload', () => {
    const html = `
      <html>
        <body>
          <script>self.__next_f.push([1,"7:[[\\\"$\\\",\\\"$L12\\\",null,{}],[\\\"$\\\",\\\"$L13\\\",null,{\\\"initialData\\\":[{\\\"model_id\\\":\\\"claude-opus-4-6\\\",\\\"name\\\":\\\"Claude Opus 4.6\\\",\\\"organization\\\":\\\"Anthropic\\\",\\\"license\\\":\\\"proprietary\\\",\\\"params\\\":null,\\\"context\\\":200000,\\\"release_date\\\":\\\"2026-02-24\\\",\\\"multimodal\\\":false,\\\"coding_arena_score\\\":19.94454603985671},{\\\"model_id\\\":\\\"missing-score\\\",\\\"name\\\":\\\"Missing Score\\\",\\\"coding_arena_score\\\":null}],\\\"initialFilterOptions\\\":{}}]]\\n"])</script>
        </body>
      </html>
    `;

    const models = parseLLMStatsCodeArenaModels(html);

    expect(models).toEqual([
      expect.objectContaining({
        name: 'Claude Opus 4.6',
        provider: 'Anthropic',
        license: 'proprietary',
        context_k: 200,
        is_open: false,
        scores: {
          code_arena: 1994,
        },
      }),
    ]);
  });

  test('keeps only Code Arena scores in the final inclusive 600–2600 ELO domain', () => {
    const rows = [599, 600, 2600, 2601].map((coding_arena_score) => ({
      model_id: `model-${coding_arena_score}`,
      name: `Model ${coding_arena_score}`,
      coding_arena_score,
    }));
    const flight = `7:[["$","$L13",null,{"initialData":${JSON.stringify(rows)}}]]\n`;
    const html = `<script>self.__next_f.push([1,${JSON.stringify(flight)}])</script>`;

    expect(parseLLMStatsCodeArenaModels(html).map((model) => model.scores.code_arena)).toEqual([600, 2600]);
  });
});

describe('parseLLMStatsModelScorecard', () => {
  test('extracts model-page scorecard benchmarks and provenance from the Next payload', () => {
    const html = `
      <html>
        <body>
          <script>self.__next_f.push([1,"7:[[\\\"$\\\",\\\"$L12\\\",null,{}],[\\\"$\\\",\\\"$L13\\\",null,{\\\"params\\\":{\\\"id\\\":\\\"gemma-4-31b-it\\\"},\\\"initialModelData\\\":{\\\"model_id\\\":\\\"gemma-4-31b-it\\\",\\\"name\\\":\\\"Gemma 4 31B\\\",\\\"organization\\\":{\\\"id\\\":\\\"google\\\",\\\"name\\\":\\\"Google\\\"},\\\"release_date\\\":\\\"2026-04-02\\\",\\\"sources\\\":{\\\"api_ref\\\":\\\"https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/\\\",\\\"scorecard_blog\\\":\\\"https://huggingface.co/blog/gemma4\\\",\\\"weights\\\":\\\"https://huggingface.co/google/gemma-4-31B-it\\\"},\\\"benchmarks\\\":[{\\\"benchmark_id\\\":\\\"aime-2026\\\",\\\"name\\\":\\\"AIME 2026\\\",\\\"categories\\\":[\\\"math\\\",\\\"reasoning\\\"],\\\"max_score\\\":1,\\\"score\\\":0.892,\\\"normalized_score\\\":0.892,\\\"verified\\\":false,\\\"self_reported\\\":true,\\\"self_reported_source\\\":\\\"https://huggingface.co/blog/gemma4\\\",\\\"analysis_method\\\":\\\"No tools\\\"},{\\\"benchmark_id\\\":\\\"gpqa\\\",\\\"name\\\":\\\"GPQA\\\",\\\"categories\\\":[\\\"science\\\"],\\\"max_score\\\":1,\\\"score\\\":0.843,\\\"normalized_score\\\":0.843,\\\"verified\\\":true,\\\"self_reported\\\":false,\\\"self_reported_source\\\":null,\\\"analysis_method\\\":null}]}}]]\\n"])</script>
        </body>
      </html>
    `;

    const scorecard = parseLLMStatsModelScorecard(html, 'gemma-4-31b-it');

    expect(scorecard).toEqual({
      model_id: 'gemma-4-31b-it',
      name: 'Gemma 4 31B',
      organization: 'Google',
      release_date: '2026-04-02',
      params_b: null,
      license: null,
      sources: {
        api_ref: 'https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/',
        scorecard_blog: 'https://huggingface.co/blog/gemma4',
        weights: 'https://huggingface.co/google/gemma-4-31B-it',
      },
      benchmarks: [
        expect.objectContaining({
          benchmark_id: 'aime-2026',
          name: 'AIME 2026',
          normalized_score: 0.892,
          self_reported: true,
          source_url: 'https://huggingface.co/blog/gemma4',
          analysis_method: 'No tools',
        }),
        expect.objectContaining({
          benchmark_id: 'gpqa',
          name: 'GPQA',
          normalized_score: 0.843,
          verified: true,
          self_reported: false,
        }),
      ],
    });
  });
});

describe('parseLLMStatsRecentUpdates', () => {
  test('extracts recent release model ids from the LLM Stats updates payload', () => {
    const html = `
      <html>
        <body>
          <script>self.__next_f.push([1,"7:[[\\\"$\\\",\\\"$L12\\\",null,{}],[\\\"$\\\",\\\"$L13\\\",null,{\\\"recentUpdates\\\":[{\\\"model_id\\\":\\\"claude-opus-4-7\\\",\\\"name\\\":\\\"Claude Opus 4.7\\\",\\\"organization\\\":\\\"Anthropic\\\",\\\"release_date\\\":\\\"2026-04-16\\\",\\\"announcement_date\\\":\\\"2026-04-16\\\",\\\"license_id\\\":\\\"proprietary\\\",\\\"multimodal\\\":true},{\\\"model_id\\\":\\\"qwen3.6-plus\\\",\\\"name\\\":\\\"Qwen3.6 Plus\\\",\\\"organization\\\":\\\"Alibaba Cloud / Qwen Team\\\",\\\"release_date\\\":\\\"2026-03-31\\\",\\\"announcement_date\\\":\\\"2026-04-02\\\",\\\"license_id\\\":\\\"proprietary\\\",\\\"multimodal\\\":true}]}]]\\n"])</script>
        </body>
      </html>
    `;

    const updates = parseLLMStatsRecentUpdates(html);

    expect(updates).toEqual([
      expect.objectContaining({
        model_id: 'claude-opus-4-7',
        name: 'Claude Opus 4.7',
        release_date: '2026-04-16',
      }),
      expect.objectContaining({
        model_id: 'qwen3.6-plus',
        name: 'Qwen3.6 Plus',
        announcement_date: '2026-04-02',
      }),
    ]);
  });
});

describe('flight payload decoding across split chunks', () => {
  test('extracts a scorecard whose object is split mid-string across two push chunks', () => {
    // Real-world failure mode: Next.js streams the flight payload as many
    // push() chunks and large objects split across chunk boundaries.
    const part1 =
      '7:[[\\"$\\",\\"$L13\\",null,{\\"initialModelData\\":{\\"model_id\\":\\"kimi-k3\\",\\"name\\":\\"Kimi K3\\",\\"organization\\":\\"Moonshot AI\\",\\"release_date\\":\\"2026-07-16\\",\\"benchmarks\\":[{\\"benchmark_id\\":\\"gpqa\\",\\"name\\":\\"GPQA\\",\\"scor';
    const part2 =
      'e\\":0.876,\\"normalized_score\\":0.876,\\"verified\\":true,\\"self_reported\\":false,\\"self_reported_source\\":null,\\"analysis_method\\":null}]}}]]';
    const html = `
      <script>self.__next_f.push([1,"${part1}"])</script>
      <script>self.__next_f.push([1,"${part2}"])</script>
    `;

    const scorecard = parseLLMStatsModelScorecard(html, 'kimi-k3');

    expect(scorecard.model_id).toBe('kimi-k3');
    expect(scorecard.name).toBe('Kimi K3');
    expect(scorecard.benchmarks).toHaveLength(1);
    expect(scorecard.benchmarks[0].score).toBeCloseTo(0.876);
  });

  test('skips a "$ref" occurrence and reads the inline modelData object instead', () => {
    // Current llm-stats pages reference the object
    // ("initialModelData":"$30:props:modelData") and inline it elsewhere.
    const refChunk =
      '8:{\\"initialModelData\\":\\"$30:props:modelData\\",\\"zeroevalPricing\\":null}';
    const dataChunk =
      '30:{\\"props\\":{\\"modelData\\":{\\"model_id\\":\\"gpt-5.6-sol\\",\\"name\\":\\"GPT-5.6 Sol\\",\\"organization\\":\\"OpenAI\\",\\"release_date\\":\\"2026-07-09\\",\\"param_count\\":2800000000000,\\"license\\":{\\"id\\":\\"mit\\",\\"name\\":\\"MIT\\"},\\"benchmarks\\":[{\\"benchmark_id\\":\\"swe-bench-verified\\",\\"name\\":\\"SWE-bench Verified\\",\\"score\\":0.81,\\"normalized_score\\":0.81,\\"verified\\":true,\\"self_reported\\":false,\\"self_reported_source\\":null,\\"analysis_method\\":null}]}}}';
    const html = `
      <script>self.__next_f.push([1,"${refChunk}"])</script>
      <script>self.__next_f.push([1,"${dataChunk}"])</script>
    `;

    const scorecard = parseLLMStatsModelScorecard(html, 'gpt-5.6-sol');

    expect(scorecard.model_id).toBe('gpt-5.6-sol');
    expect(scorecard.benchmarks).toHaveLength(1);
    expect(scorecard.benchmarks[0].benchmark_id).toBe('swe-bench-verified');
    // param_count and license ride along so brand-new models are hardware-fit-checkable.
    expect(scorecard.params_b).toBe(2800);
    expect(scorecard.license).toBe('MIT');
  });
});

describe('liveBenchEffortLabel', () => {
  test.each([
    ['claude-opus-4-7-xhigh-effort', 'xhigh'],
    ['claude-opus-4-8-xhigh-effort', 'xhigh'],
    ['claude-sonnet-4-6-thinking-auto-medium-effort', 'medium'],
    ['claude-opus-4-5-20251101-thinking-64k-high-effort', 'high'],
    ['gpt-5.4-nano-xhigh', 'xhigh'],
    ['gemini-3.1-pro-preview-high', 'high'],
    ['deepseek-v3.2-non-thinking', 'non-thinking'],
    ['deepseek-v3.2-thinking', 'thinking'],
    ['gpt-5.5', 'standard'],
    ['gpt-5.6-sol-max-effort', 'max'],
    ['gpt-5.6-sol-max', 'max'],
    ['gpt-5.6-terra-max', 'max'],
    ['grok-5-ultra-effort', 'ultra'],
    ['qwen-max', 'standard'],
  ])('%s -> %s', (rawName, expected) => {
    expect(liveBenchEffortLabel(rawName)).toBe(expected);
  });
});

describe('liveBenchBaseName', () => {
  test('groups effort and thinking variants under one base', () => {
    const base = liveBenchBaseName('gpt-5.5-xhigh');
    expect(liveBenchBaseName('gpt-5.5-high')).toBe(base);
    expect(liveBenchBaseName('gpt-5.5')).toBe(base);
  });

  test('strips dash dates so dated snapshots group with their base', () => {
    expect(liveBenchBaseName('gpt-5.2-2025-12-11-high')).toBe('gpt-5.2');
  });

  test('max-effort rows group with their base while bare -max stays a model name', () => {
    expect(liveBenchBaseName('gpt-5.6-sol-max-effort')).toBe('gpt-5.6-sol');
    // Bare -max with a version digit is an effort level (LiveBench convention)...
    expect(liveBenchBaseName('gpt-5.6-sol-max')).toBe('gpt-5.6-sol');
    // ...but digit-less product names keep it.
    expect(liveBenchBaseName('qwen-max')).toBe('qwen-max');
  });

  // The 2026-06-25 table carries qwen3.7-max and qwen3.8-max: Qwen's "Max" is a
  // product tier (Qwen3.8 Max is a separate 2.4T model on the roster), not an
  // effort level, so stripping it filed both under non-existent "qwen3.8".
  test('Qwen product-tier Max is a model name, not an effort level', () => {
    expect(liveBenchBaseName('qwen3.8-max')).toBe('qwen3.8-max');
    expect(liveBenchBaseName('qwen3.7-max')).toBe('qwen3.7-max');
    expect(liveBenchEffortLabel('qwen3.8-max')).toBe('standard');
    expect(liveBenchBaseName('gpt-6-astra-max')).toBe('gpt-6-astra');
  });

  test('non-thinking groups with thinking instead of leaving a stray -non base', () => {
    expect(liveBenchBaseName('deepseek-v3.2-non-thinking')).toBe(liveBenchBaseName('deepseek-v3.2-thinking'));
    expect(liveBenchBaseName('deepseek-v3.2-non-thinking')).toBe('deepseek-v3.2');
  });
});
