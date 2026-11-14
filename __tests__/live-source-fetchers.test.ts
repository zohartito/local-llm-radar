import { fetchLiveBenchScores, fetchSWEBench, fetchTerminalBench, fetchZeroEval, parseSweBenchCategories } from '../src/lib/live-sources';

// Fixtures mirror the upstream shapes observed on 2026-10-19:
//  - livebench.ai (LiveBench 2.0) serves the v1 tables under /v1/ and 404s the root paths
//  - www.tbench.ai server-renders the current board at / (every /leaderboard/... path 308s)
//  - www.swebench.com embeds its data in <script type="application/json" id="leaderboard-data">

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

afterEach(() => jest.restoreAllMocks());

describe('LiveBench v1 tables moved under /v1/', () => {
  test('requests /v1/ table, categories and cost files and parses the scores', async () => {
    const seen: string[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = urlOf(input);
      seen.push(url);
      if (url === 'https://livebench.ai/') {
        return new Response('<script defer="defer" src="./static/js/main.abc123.js"></script>', { status: 200 });
      }
      if (url.endsWith('/static/js/main.abc123.js')) {
        return new Response('const v=["2026-01-08","2026-06-25"].map(e=>({id:e}));', { status: 200 });
      }
      if (url === 'https://livebench.ai/v1/table_2026_06_25.csv') {
        return new Response('model,task_a,task_b\nModel-X,60,80\n', { status: 200 });
      }
      if (url === 'https://livebench.ai/v1/categories_2026_06_25.json') {
        return new Response(JSON.stringify({ Coding: ['task_a'], Reasoning: ['task_b'] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const result = await fetchLiveBenchScores();

    expect(result.error).toBeUndefined();
    expect(result.data_date).toBe('2026-06-25');
    expect(result.models).toHaveLength(1);
    expect(result.models[0].scores.livebench_coding).toBe(60);
    expect(seen.some((u) => /livebench\.ai\/table_/.test(u))).toBe(false);
  });

  // Without the categories file every row's category map is empty and the old
  // parser published livebench_global = 0 for all ~70 models: a missing file
  // became a measured zero on the highest-reliability benchmark.
  test('a missing categories file fails the source instead of publishing zeros', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = urlOf(input);
      if (url === 'https://livebench.ai/') {
        return new Response('<script defer="defer" src="./static/js/main.abc123.js"></script>', { status: 200 });
      }
      if (url.endsWith('/static/js/main.abc123.js')) {
        return new Response('const v=["2026-06-25"];', { status: 200 });
      }
      if (url === 'https://livebench.ai/v1/table_2026_06_25.csv') {
        return new Response('model,task_a,task_b\nModel-X,60,80\n', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const result = await fetchLiveBenchScores();

    expect(result.models).toHaveLength(0);
    expect(result.error).toMatch(/categories/i);
  });
});

describe('Terminal-Bench is read from the root page', () => {
  // Shape of one board row as served on 2026-10-23 (trimmed): the label omits
  // the vendor's family name ("Opus 5.5"); only model_org identifies it.
  function tbRow(label: string, org: string, accuracy: number, date: string) {
    return {
      rank: 1,
      metadata: {
        date,
        model_org: { url: 'https://example.com', label: org },
        agent_display: { url: 'https://example.com', label: 'Some Agent' },
        model_display: { url: 'https://example.com', label },
        reasoning_effort: 'max',
      },
      metrics: { accuracy, n_trials: 330 },
    };
  }
  function tbPage(title: string, rows: unknown[]) {
    const payload = `1d:{"leaderboard":{"name":"4-0-0","title":"${title}"},"rows":${JSON.stringify(rows)}}`;
    return `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`;
  }

  test('parses board rows from https://www.tbench.ai/ into the edition key', async () => {
    const html = tbPage('Terminal-Bench 4.0', [
      tbRow('Opus 5.5', 'Anthropic', 64.85, '2026-09-22'),
      tbRow('Opus 5.5', 'Anthropic', 60.1, '2026-09-29'),
      tbRow('Grok 4.7', 'xAI', 37.58, '2026-08-01'),
    ]);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(html, { status: 200 }));

    const result = await fetchTerminalBench();

    expect(urlOf(fetchMock.mock.calls[0][0])).toBe('https://www.tbench.ai/');
    expect(result.error).toBeUndefined();
    expect(result.source_name).toBe('Terminal-Bench 4.0');
    // Newest submission on the board, not the fetch time.
    expect(result.data_date).toBe('2026-09-29');
    const byName = Object.fromEntries(result.models.map((m) => [m.name, m.scores]));
    // Without "Claude" no roster model matched and every Anthropic row was dropped.
    expect(byName).toEqual({
      'Claude Opus 5.5': { terminal_bench_4: 64.9 },
      'Grok 4.7': { terminal_bench_4: 37.6 },
    });
    expect(result.models.find((m) => m.name === 'Claude Opus 5.5')?.provider).toBe('Anthropic');
  });

  test('an unrecognized edition is an error, never merged into the 4.0 key', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(
      tbPage('Terminal-Bench 5.0', [tbRow('Opus 6', 'Anthropic', 40, '2027-01-01')]), { status: 200 }));
    const result = await fetchTerminalBench();
    expect(result.models).toHaveLength(0);
    expect(result.error).toMatch(/edition/i);
  });

  test('a redirect is still refused, never followed', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 308, headers: { location: '/' } }));
    const result = await fetchTerminalBench();
    expect(result.models).toHaveLength(0);
    expect(result.error).toMatch(/redirect refused/i);
  });
});

describe('ZeroEval full leaderboard', () => {
  // Field names as served by api.zeroeval.com/leaderboard/models/full on
  // 2026-10-23. The agentic columns equal the bare llm-stats scorecard ids that
  // llmstats_recent maps to the same keys, but cover every model, so a model
  // leaving the 120-day scorecard window no longer loses them.
  test('reads the agentic columns for every model, not only recent ones', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([{
      model_id: 'qwen3.5-35b-a3b', name: 'Qwen3.5-35B-A3B', organization: 'Alibaba Cloud / Qwen Team',
      license: 'Apache 2.0', release_date: '2026-02-24', gpqa_score: 0.842,
      swe_bench_pro_score: 0.5, browsecomp_score: 0.61, toolathlon_score: 0.4, mcp_atlas_score: 0.7,
    }]), { status: 200 }));

    const result = await fetchZeroEval();

    expect(result.error).toBeUndefined();
    expect(result.models[0].scores).toEqual(expect.objectContaining({
      gpqa_diamond: 84.2, swe_bench_pro: 50, browsecomp: 61, toolathlon: 40, mcp_atlas: 70,
    }));
  });

  test('a payload with rows but no recognised score column is schema drift, not an empty success', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([
      { model_id: 'a', name: 'A', gpqa_pct: 80 },
      { model_id: 'b', name: 'B', swe_pro: 0.4 },
    ]), { status: 200 }));

    const result = await fetchZeroEval();

    expect(result.models).toHaveLength(0);
    expect(result.error).toMatch(/schema/i);
  });

  test('an unknown license leaves openness unknown instead of open', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([
      { model_id: 'u', name: 'U', license: 'unknown', gpqa_score: 0.5 },
      { model_id: 'p', name: 'P', license: 'proprietary', gpqa_score: 0.5 },
      { model_id: 'o', name: 'O', license: 'apache_2_0', gpqa_score: 0.5 },
    ]), { status: 200 }));

    const result = await fetchZeroEval();

    expect(result.models.map((m) => m.is_open)).toEqual([undefined, false, true]);
  });
});

describe('SWE-bench reads the leaderboard-data script', () => {
  const categories = [
    { name: 'Multilingual', results: [] },
    { name: 'Verified', results: [
      { resolved: 79.2, tags: ['Model: claude-opus-4-5'] },
      { resolved: 76.4, tags: ['Model: claude-opus-4-5'] },
      { resolved: 70.0, tags: ['Org: AgentOnly'] },
    ] },
  ];

  test('parses the tagged JSON script and keeps the best row per model', async () => {
    const html = `<html><script type="application/json" id="leaderboard-data">${JSON.stringify(categories)}</script></html>`;
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(html, { status: 200 }));

    const result = await fetchSWEBench();

    expect(result.error).toBeUndefined();
    expect(result.models).toEqual([{ name: 'claude-opus-4-5', scores: { swe_bench: 79.2 } }]);
  });

  test('still accepts the legacy inline layout', () => {
    const legacy = `<script>var d = [{"name": "bash-only", "results": []}, {"name": "Verified", "results": []}]</script>`;
    expect(parseSweBenchCategories(legacy).map((c) => c.name)).toEqual(['bash-only', 'Verified']);
  });

  test('a page with neither layout is an error, not an empty success', () => {
    expect(() => parseSweBenchCategories('<html></html>')).toThrow(/Could not find data/);
  });
});
