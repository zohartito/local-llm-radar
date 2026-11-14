import { buildBenchmarkRankings, CATEGORY_TESTS, comparisonCohorts, comparisonRanks, comparisonValue, defaultCategoryTest } from '../src/lib/benchmark-comparisons';
import type { LeaderboardModel } from '../src/lib/leaderboard';
import { GET } from '../src/app/api/rankings/route';
import { NextRequest } from 'next/server';
import { getLeaderboardData } from '../src/lib/leaderboard-service';

jest.mock('../src/lib/leaderboard-service', () => ({ getLeaderboardData: jest.fn() }));

function model(name: string, key: string, value: number | null, date: string | null = '2026-06-25', source = 'livebench'): LeaderboardModel {
  return {
    name, slug: name, slug_aliases: [], provider: 'Example', closed_source: false, release: '2026-01-01',
    benchmarks: { [key]: value }, composite_score: 50, benchmark_coverage: 1, rank_status: 'insufficient_evidence',
    benchmark_sources: value === null ? {} : { [key]: [{ source_id: source, source_name: 'Evaluator edition', value, selected: true, data_date: date }] },
  } as unknown as LeaderboardModel;
}

test.each(Object.keys(CATEGORY_TESTS))('%s uses one named test; reporting unrelated results cannot improve rank', category => {
  const key = defaultCategoryTest(category);
  const source = category === 'chat' ? 'lmarena' : key.startsWith('livebench2_') ? 'livebench2' : 'livebench';
  const higher = model('higher', key, 97, '2026-06-25', source);
  const lower = model('lower', key, 89, '2026-06-25', source);
  lower.benchmarks.aime_2025 = 100;
  lower.benchmarks.mcp_atlas = 100;
  lower.composite_score = 100;
  const missing = model('missing', key, null);
  missing.composite_score = 100;
  const { rankings } = buildBenchmarkRankings([lower, missing, higher], category);
  expect(rankings.map(row => [row.name, row.score, row.rank])).toEqual([['higher', 97, 1], ['lower', 89, 2], ['missing', null, null]]);
});

test('the screenshot math and agentic counterexamples rank by their shared tests', () => {
  const opus = model('opus-5.5', 'livebench_mathematics', 97.08);
  const gpt = model('gpt-5.2', 'livebench_mathematics', 93.17);
  gpt.benchmarks.aime_2025 = 100;
  expect(buildBenchmarkRankings([gpt, opus], 'math').rankings[0].name).toBe('opus-5.5');
  const kimi = model('kimi', 'livebench_agentic_coding', 62.17);
  kimi.benchmarks.browsecomp = 91.2;
  kimi.benchmarks.mcp_atlas = 84.2;
  kimi.benchmarks.toolathlon = 73.2;
  const opusAgent = model('opus-5.5', 'livebench_agentic_coding', 71.72);
  expect(buildBenchmarkRankings([kimi, opusAgent], 'agentic', { benchmark: 'livebench_agentic_coding' }).rankings[0].name).toBe('opus-5.5');
});

test('different editions, vendor values, fallback, unknown dates and missing cells never fill a cohort gap', () => {
  const key = 'livebench_mathematics';
  const fresh = model('fresh', key, 90);
  const old = model('old', key, 100, '2026-05-01');
  const vendor = model('vendor', key, 100, '2026-06-25', 'zeroeval');
  const fallback = model('fallback', key, 100);
  fallback.benchmark_sources[key][0].is_fallback = true;
  const undated = model('undated', key, 100, null);
  const pool = [fresh, old, vendor, fallback, undated];
  const view = buildBenchmarkRankings(pool, 'math');
  expect(view.cohorts).toHaveLength(2);
  expect(view.rankings.filter(row => row.rank !== null).map(row => row.name)).toEqual(['fresh']);
  const previous = buildBenchmarkRankings(pool, 'math', { cohortId: view.cohorts[1].id });
  expect(previous.rankings.filter(row => row.rank !== null).map(row => row.name)).toEqual(['old']);
  expect(buildBenchmarkRankings(pool, 'math', { cohortId: 'invalid' }).rankings.every(row => row.rank === null)).toBe(true);
});

test('ties share competition rank; source ordering and model order do not choose a winner', () => {
  const key = 'livebench_global';
  const models = [model('b', key, 90), model('c', key, 0), model('a', key, 90)];
  const cohort = comparisonCohorts(models, key)[0];
  expect([...comparisonRanks(models, cohort)]).toEqual([['a', 1], ['b', 1], ['c', 3]]);
  models[0].benchmark_sources[key].push({ ...models[0].benchmark_sources[key][0], value: 99, selected: false });
  expect(comparisonValue(models[0], cohort)).toBeNull();
});

test('ambiguous benchmark editions remain inspectable but cannot earn comparison positions', () => {
  const m = model('kimi', 'toolathlon', 73.2, null, 'zeroeval');
  expect(comparisonCohorts([m], 'toolathlon')).toEqual([]);
});

test('the public category API defaults to the same test and never reuses index history', async () => {
  const higher = model('higher', 'livebench_mathematics', 97);
  const missing = model('missing', 'livebench_mathematics', null);
  jest.mocked(getLeaderboardData).mockResolvedValue({ data: { models: [higher, missing], sources: [], updated: '2026-10-26T17:00:00Z' }, cacheStatus: 'HIT', cacheAgeSeconds: 0 });
  const data = await (await GET(new NextRequest('http://localhost/api/rankings?category=math'))).json();
  expect(data.mode).toBe('benchmark');
  expect(data.comparison.benchmark).toBe('livebench_mathematics');
  expect(data.rankings.map((row: {rank: number | null}) => row.rank)).toEqual([1, null]);
  expect(data.trendUnavailableReason).toBe('benchmark-history-unavailable');
  expect(data.rankings.every((row: {rank_change: number | null}) => row.rank_change === null)).toBe(true);
  expect((await GET(new NextRequest('http://localhost/api/rankings?category=math&benchmark=aime_2025'))).status).toBe(400);
  expect((await GET(new NextRequest('http://localhost/api/rankings?category=math&cohort=unknown'))).status).toBe(400);
});
