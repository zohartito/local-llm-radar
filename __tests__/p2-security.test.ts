import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isAuthorizedRefresh } from '../src/lib/refresh-auth';
import { acquireRefreshLock, acquireScorecardLease, readSharedCache, readSharedScorecard, setPersistenceForTests } from '../src/lib/store';
import { SCORING_VERSION } from '../src/lib/merge-models';
import { fetchArenaELO, fetchZeroEval, isConsensusEligibleScorecardBenchmark, readBoundedBody } from '../src/lib/live-sources';
import { isValidBenchmarkValue, mergeAllSources } from '../src/lib/merge-models';
import { allowScorecardRequest, clearScorecardCacheForTests, getCachedScorecard, setScorecardFetcherForTests } from '../src/lib/scorecard-cache';
import { isPersistableLiveRefresh, refreshOutcomeResponse } from '../src/lib/leaderboard-service';

describe('P2 transport budgets and fixed-upstream behavior', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects an oversized streamed body before parsing it', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(32)); controller.close(); },
    });
    await expect(readBoundedBody(new Response(body), 16, 'test'),).rejects.toThrow('byte budget');
  });

  it('treats a redirect and oversized ZeroEval response as source failures', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://example.test' } }))
      .mockResolvedValueOnce(new Response('x'.repeat(1_000_001), { status: 200 }));
    await expect(fetchZeroEval()).resolves.toMatchObject({ models: [], error: expect.stringContaining('redirect refused') });
    await expect(fetchZeroEval()).resolves.toMatchObject({ models: [], error: expect.stringContaining('byte budget') });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caps hostile dataset pagination before issuing unbounded fan-out', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ rows: [], num_rows_total: Number.MAX_SAFE_INTEGER }), { status: 200 }),
    );
    await fetchArenaELO();
    // A dataset claiming MAX_SAFE_INTEGER rows must still produce a bounded walk.
    // The Arena source now requests a 600-row window (6 pages of 100) rather than
    // the global 2,000-row / 20-page ceiling: all 389 published models live in the
    // first 400 rows, and the 20-page walk was timing out from Vercel and
    // returning zero rows. The cap is what this test guards — it is now tighter.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(20);
  });
});

describe('P2 auth, lock, and score-domain boundaries', () => {
  const originalSecret = process.env.CRON_SECRET;
  afterEach(() => { process.env.CRON_SECRET = originalSecret; setPersistenceForTests(undefined); clearScorecardCacheForTests(); });

  it('fails closed when cron authentication is not configured', () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedRefresh(new Headers({ 'x-vercel-cron': '1', authorization: 'Bearer attacker' }))).toBe(false);
    process.env.CRON_SECRET = 'expected';
    expect(isAuthorizedRefresh(new Headers({ authorization: 'Bearer expected' }))).toBe(true);
  });

  it('does not grant a local refresh token when Redis is absent or fails', async () => {
    setPersistenceForTests(null);
    await expect(acquireRefreshLock()).resolves.toEqual({ state: 'unavailable' });
    setPersistenceForTests({ set: jest.fn().mockRejectedValue(new Error('redis offline')) } as never);
    await expect(acquireRefreshLock()).resolves.toEqual({ state: 'unavailable' });
  });

  it('uses an expiring shared scorecard budget and denies when Redis is absent', async () => {
    setPersistenceForTests(null);
    await expect(allowScorecardRequest('test-client')).resolves.toBe(false);
    let count = 0;
    const evalMock = jest.fn().mockImplementation(async () => ++count);
    setPersistenceForTests({ eval: evalMock } as never);
    for (let i = 0; i < 12; i++) await expect(allowScorecardRequest('test-client')).resolves.toBe(true);
    await expect(allowScorecardRequest('test-client')).resolves.toBe(false);
    expect(evalMock.mock.calls[0][0]).toContain('expire');
  });

  it('fails closed on malformed or out-of-range shared scorecard budget results', async () => {
    for (const invalid of [null, false, '', 0, -1, 1.5, 13, Number.MAX_SAFE_INTEGER + 1]) {
      setPersistenceForTests({ eval: jest.fn().mockResolvedValue(invalid) } as never);
      await expect(allowScorecardRequest('test-client')).resolves.toBe(false);
    }
  });

  it('distinguishes scorecard Redis errors from cache misses and exposes lease contention', async () => {
    setPersistenceForTests({ eval: jest.fn().mockResolvedValue([false, -2]) } as never);
    await expect(readSharedScorecard('model')).resolves.toEqual({ state: 'miss' });
    setPersistenceForTests({ eval: jest.fn().mockResolvedValue([null, -2]) } as never);
    await expect(readSharedScorecard('model')).resolves.toEqual({ state: 'miss' });
    for (const malformedMiss of [[false, -1], [null, 0], [false, -2.5], [false, -2, 'extra']]) {
      setPersistenceForTests({ eval: jest.fn().mockResolvedValue(malformedMiss) } as never);
      await expect(readSharedScorecard('model')).resolves.toEqual({ state: 'unavailable' });
    }
    setPersistenceForTests({ eval: jest.fn().mockRejectedValue(new Error('redis down')) } as never);
    await expect(readSharedScorecard('model')).resolves.toEqual({ state: 'unavailable' });
    setPersistenceForTests({ set: jest.fn().mockResolvedValue(null) } as never);
    await expect(acquireScorecardLease('model')).resolves.toEqual({ state: 'contended' });
  });

  it('accepts both Upstash scorecard EVAL transport shapes only for the exact bounded cache schema', async () => {
    const scorecard = {
      model_id: 'model', name: 'Model', organization: null, release_date: null, params_b: 7, license: null,
      sources: { api_ref: null },
      benchmarks: [{ benchmark_id: 'gpqa', name: 'GPQA', description: null, categories: ['science'], modality: null, max_score: 1, score: 0.75, normalized_score: 0.75, verified: true, self_reported: false, source_url: null, analysis_method: null }],
    };
    const unknownSource = { ...scorecard, sources: { bogus: null } };
    const nonFiniteBenchmark = { ...scorecard, benchmarks: [{ ...scorecard.benchmarks[0], score: Infinity }] };
    setPersistenceForTests({
      eval: jest.fn()
        .mockResolvedValueOnce([JSON.stringify({ value: scorecard }), 30_000])
        .mockResolvedValueOnce([{ value: scorecard }, 30_000])
        .mockResolvedValueOnce([{ value: { bogus: true } }, 30_000])
        .mockResolvedValueOnce([{ value: unknownSource }, 30_000])
        .mockResolvedValueOnce([{ value: nonFiniteBenchmark }, 30_000])
        .mockResolvedValueOnce([{ value: scorecard }, 900_001])
        .mockResolvedValueOnce([{ value: null }, 60_001]),
    } as never);
    await expect(readSharedScorecard<{ value: typeof scorecard }>('model')).resolves.toMatchObject({ state: 'hit', value: { value: scorecard }, pttlMs: 30_000 });
    await expect(readSharedScorecard<{ value: typeof scorecard }>('model')).resolves.toMatchObject({ state: 'hit', value: { value: scorecard }, pttlMs: 30_000 });
    await expect(readSharedScorecard('model')).resolves.toEqual({ state: 'unavailable' });
    await expect(readSharedScorecard('model')).resolves.toEqual({ state: 'unavailable' });
    await expect(readSharedScorecard('model')).resolves.toEqual({ state: 'unavailable' });
    await expect(readSharedScorecard('model')).resolves.toEqual({ state: 'unavailable' });
    await expect(readSharedScorecard('model')).resolves.toEqual({ state: 'unavailable' });
  });

  it('coalesces a scorecard fetch through a Redis lease and persists before serving', async () => {
    const values = new Map<string, unknown>();
    const redis = {
      set: jest.fn(async (key: string, value: unknown, options?: { nx?: boolean }) => {
        if (options?.nx && values.has(key)) return null;
        values.set(key, value); return 'OK';
      }),
      eval: jest.fn(async (script: string, keys: string[], args: string[]) => {
        if (script.startsWith('local v=')) {
          const value = values.get(keys[0]);
          // Upstash's client can deserialize the EVAL array's JSON value for us.
          return value ? [value, 900_000] : [false, -2];
        }
        if (keys.length === 2) { values.set(keys[1], JSON.parse(args[1])); return 1; }
        return 1;
      }),
    };
    setPersistenceForTests(redis as never);
    const fetcher = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { model_id: 'model', name: 'Model', organization: null, release_date: null, params_b: null, license: null, sources: {}, benchmarks: [] };
    });
    setScorecardFetcherForTests(fetcher);
    const [first, second] = await Promise.all([getCachedScorecard('model'), getCachedScorecard('model')]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first?.value.model_id).toBe('model');
    expect(second?.value.model_id).toBe('model');
    expect(redis.set).toHaveBeenCalled();
  });

  it('retains a timed-out scorecard lease until TTL expiry so abort-ignoring fetchers cannot overlap', async () => {
    jest.useFakeTimers();
    try {
      const values = new Map<string, unknown>();
      const expiresAt = new Map<string, number>();
      const redis = {
        set: jest.fn(async (key: string, value: unknown, options?: { nx?: boolean; ex?: number }) => {
          const expiry = expiresAt.get(key);
          if (options?.nx && expiry && expiry > Date.now()) return null;
          values.set(key, value);
          if (options?.ex) expiresAt.set(key, Date.now() + options.ex * 1_000);
          return 'OK';
        }),
        eval: jest.fn(async (script: string, keys: string[], args: string[]) => {
          if (script.startsWith('local v=')) { const value = values.get(keys[0]); return value ? [value, 9_000] : [false, -2]; }
          if (keys.length === 2) {
            const leaseExpiresAt = expiresAt.get(keys[0]);
            if (values.get(keys[0]) !== args[0] || !leaseExpiresAt || leaseExpiresAt <= Date.now()) return 0;
            values.set(keys[1], JSON.parse(args[1]));
            return 1;
          }
          if (values.get(keys[0]) === args[0]) values.delete(keys[0]);
          return 1;
        }),
      };
      setPersistenceForTests(redis as never);
      const fetcher = jest.fn(async () => {
        if (fetcher.mock.calls.length === 1) await new Promise((resolve) => setTimeout(resolve, 21_000));
        return { model_id: 'long', name: 'Long', organization: null, release_date: null, params_b: null, license: null, sources: {}, benchmarks: [] };
      });
      setScorecardFetcherForTests(fetcher);
      const first = getCachedScorecard('long');
      // Let Redis miss/lease microtasks schedule both the 12s deadline and
      // intentionally late 21s fetch before advancing fake time.
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(12_000);
      await expect(first).resolves.toBeNull();
      expect(redis.set.mock.calls[0][2]).toMatchObject({ ex: 30 });
      expect([...values.keys()].some((key) => key.endsWith(':scorecard:long'))).toBe(false);
      // Calls at 12s and 21s only observe contention and poll Redis; neither
      // starts a second upstream fetch while the first ignores AbortSignal.
      const atTwelveSeconds = getCachedScorecard('long');
      await jest.advanceTimersByTimeAsync(1_000);
      await expect(atTwelveSeconds).resolves.toBeNull();
      await jest.advanceTimersByTimeAsync(8_000);
      const atTwentyOneSeconds = getCachedScorecard('long');
      await jest.advanceTimersByTimeAsync(1_000);
      await expect(atTwentyOneSeconds).resolves.toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(9_000);
      await expect(getCachedScorecard('long')).resolves.toMatchObject({ value: { model_id: 'long' } });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { jest.useRealTimers(); }
  });

  it('preserves stale shared-cache age instead of restamping it as fresh', async () => {
    const writtenAt = Date.now() - 3_600_000;
    setPersistenceForTests({ get: jest.fn().mockResolvedValue({ data: { models: [], sources: [], updated: '2026-01-01T00:00:00.000Z' }, writtenAt, freshUntil: writtenAt + 1_800_000, staleUntil: Date.now() + 60_000, scoringVersion: SCORING_VERSION }) } as never);
    await expect(readSharedCache({ allowStale: true })).resolves.toMatchObject({ writtenAt, stale: true });
    const served = refreshOutcomeResponse({ data: { models: [], sources: [], updated: '2026-01-01T00:00:00.000Z' }, writtenAt, refreshed: false, stale: true });
    expect(served.cacheStatus).toBe('STALE');
    expect(served.cacheAgeSeconds).toBeGreaterThanOrEqual(3600);
    expect(isPersistableLiveRefresh({ models: [], sources: [], updated: '2026-01-01T00:00:00.000Z' })).toBe(false);
    expect(isPersistableLiveRefresh({ models: [{ slug: 'live' }] as never, sources: [], updated: '2026-01-01T00:00:00.000Z', usedFallback: true })).toBe(false);
  });

  // Observed live 2026-08-15: an lmarena timeout returned 0 rows, the roster
  // silently fell from ~508 models to ~307, and the badge still read
  // "Partial — 2 sources degraded". A refresh missing a PRIMARY source must not
  // overwrite a last-good blob that still has it.
  it('refuses to persist a refresh that lost a primary roster source', () => {
    const sourceRow = (id: string, count: number) => ({
      id, name: id, url: 'https://example.test', count, duration_ms: 1, fetched_at: '2026-08-15T00:00:00.000Z',
    });
    const base = { models: [{ slug: 'live' }] as never, updated: '2026-08-15T00:00:00.000Z' };

    expect(isPersistableLiveRefresh({
      ...base,
      sources: [sourceRow('lmarena', 389), sourceRow('zeroeval', 358), sourceRow('livebench', 0)],
    })).toBe(true);

    expect(isPersistableLiveRefresh({
      ...base,
      sources: [sourceRow('lmarena', 0), sourceRow('zeroeval', 358)],
    })).toBe(false);

    expect(isPersistableLiveRefresh({
      ...base,
      sources: [sourceRow('lmarena', 389), sourceRow('zeroeval', 0)],
    })).toBe(false);
  });

  it('rejects non-finite and out-of-domain values before consensus', () => {
    expect(isValidBenchmarkValue('gpqa_diamond', Infinity)).toBe(false);
    expect(isValidBenchmarkValue('gpqa_diamond', 101)).toBe(false);
    expect(isValidBenchmarkValue('arena_elo', 1500)).toBe(true);
    expect(isValidBenchmarkValue('code_arena', 599)).toBe(false);
    expect(isValidBenchmarkValue('code_arena', 600)).toBe(true);
    expect(isValidBenchmarkValue('code_arena', 2600)).toBe(true);
    expect(isValidBenchmarkValue('code_arena', 2601)).toBe(false);
    // POLICY CHANGE 2026-08-15, deliberate and measured. Vendor-self-reported
    // values are now ingested instead of dropped: a 159-model census found
    // `verified` is never true (0 of 3,171 rows) while 3,067 are self_reported,
    // so excluding them discarded ~97% of all published benchmark data —
    // Grok 4.6 kept 0 of 10 benchmarks, GPT-5.6 Sol 1 of 44, and six of the top
    // fifteen models had no SWE-bench at all.
    //
    // The trust guarantee moved from EXCLUSION to WEIGHT + ATTRIBUTION: these
    // values arrive under the `llmstats_recent` source id so every cell stays
    // attributable in `benchmark_sources`, and they carry reliability 0.35-0.5
    // against LiveBench's 1.0, so a vendor's own number cannot dominate a rank.
    expect(isConsensusEligibleScorecardBenchmark({ self_reported: true })).toBe(true);
    expect(isConsensusEligibleScorecardBenchmark({ self_reported: false })).toBe(true);
    const merged = mergeAllSources([{ source_id: 'lmarena', source_name: 'Arena', fetched_at: '2026-01-01T00:00:00Z', models: [{ name: 'Safe model', scores: { arena_elo: Infinity, gpqa_diamond: 101, code_arena: -1 } }] }]);
    // Invalid-only rows never acquire the minimum real measurement required
    // to become a visible primary-roster model.
    expect(merged).toHaveLength(0);
  });
});

describe('P2 legacy fallback safety', () => {
  it('keeps the unproven fallback read-only with no scheduled writer path', () => {
    const script = readFileSync(path.join(process.cwd(), 'scripts', 'update-scores.mjs'), 'utf8');
    const legacy = JSON.parse(readFileSync(path.join(process.cwd(), 'data', 'curated-models.json'), 'utf8')) as { _provenance?: unknown };
    expect(script).not.toContain('writeFileSync');
    expect(script).toContain('Fallback persistence is permanently disabled');
    expect(legacy._provenance).toBeUndefined();
    expect(readdirSync(path.join(process.cwd(), '.github', 'workflows'))).not.toContain('daily-update.yml');
  });
});

describe('P2 workflow pins', () => {
  it('pins every action regardless of publisher and removes unverifiable privileged workflows', () => {
    for (const file of readdirSync(path.join(process.cwd(), '.github', 'workflows')).filter((name) => name.endsWith('.yml'))) {
      const workflow = readFileSync(path.join(process.cwd(), '.github', 'workflows', file), 'utf8');
      for (const action of workflow.matchAll(/^\s*-?\s*uses:\s*[^\s@]+@([^\s#]+)/gm)) {
        expect(action[1]).toMatch(/^[a-f0-9]{40}$/);
      }
      expect(workflow).not.toMatch(/anthropics\/claude-code-action|gitleaks\/gitleaks-action/);
    }
  });
});
