import { NextRequest } from 'next/server';
import type { LeaderboardModel } from '../src/lib/leaderboard';
import { GET as leaderboardGET } from '../src/app/api/leaderboard/route';
import { GET as modelsGET } from '../src/app/api/models/route';
import { GET as rankingsGET } from '../src/app/api/rankings/route';
import { GET as specialistGET } from '../src/app/api/leaderboards/[type]/route';
import { getLeaderboardData } from '../src/lib/leaderboard-service';
import { getSpecialistData } from '../src/lib/specialist-service';
import { SPECIALIST_BOARDS } from '../src/lib/model-types';
import { SOURCE_CREDITS, isWithheldBoardSource, isWithheldSourceId } from '../src/lib/source-credits';
import { redactSpecialistRowsForPublicApi } from '../src/lib/public-api';

jest.mock('../src/lib/leaderboard-service', () => ({ getLeaderboardData: jest.fn() }));
jest.mock('../src/lib/specialist-service', () => ({ getSpecialistData: jest.fn() }));

// Invented values: the test checks which sources' values the public API serves.
function model(): LeaderboardModel {
  return {
    name: 'Example 1', slug: 'example-1', slug_aliases: [], provider: 'Example', closed_source: false, release: '2026-01-02',
    params_b: 8, context_k: 128, vram_int4_gb: 5, vram_fp16_gb: 16, composite_score: 61, benchmark_coverage: 4, rank_status: 'ranked',
    input_price_per_m: 1.5, output_price_per_m: 3,
    effort_variants: [{ variant_name: 'example-1-high', effort: 'high', livebench_global: 70.1, livebench_coding: 71.2, livebench_reasoning: 72.3, run_cost_usd: 12 }],
    benchmarks: { livebench2_overall: 66.6, gpqa_diamond: 55.5, arena_elo: 1333, swe_bench: 44.4 },
    benchmark_sources: {
      livebench2_overall: [{ source_id: 'livebench2', source_name: 'LiveBench 2.0', model_name: 'example-1', value: 66.6, selected: true, data_date: '2026-11-01' }],
      gpqa_diamond: [{ source_id: 'zeroeval', source_name: 'ZeroEval', model_name: 'example-1', value: 55.5, selected: true }],
      arena_elo: [{ source_id: 'lmarena', source_name: 'LMArena', model_name: 'example-1', value: 1333, selected: true }],
      swe_bench: [{ source_id: 'swebench', source_name: 'SWE-bench Verified', model_name: 'example-1', value: 44.4, selected: true }],
    },
    metadata_sources: {
      params_b: [{ source_id: 'zeroeval', value: 8, selected: true }],
      context_k: [{ source_id: 'verified', value: 128, selected: true }],
      release: [{ source_id: 'zeroeval', value: '2026-01-02', selected: true }, { source_id: 'lmarena', value: '2026-01-02', selected: false }],
    },
  } as unknown as LeaderboardModel;
}

beforeEach(() => {
  jest.mocked(getLeaderboardData).mockResolvedValue({ data: { models: [model()], sources: [], updated: '2026-11-14T09:00:00Z' }, cacheStatus: 'HIT', cacheAgeSeconds: 0 } as never);
});

test('every text source id is reviewed and the 11 unlicensed sources plus ZeroEval are withheld', () => {
  for (const id of ['zeroeval', 'livebench2', 'livebench', 'bfcl', 'terminalbench', 'openllm']) expect(isWithheldSourceId(id)).toBe(true);
  for (const id of ['lmarena', 'codearena', 'llmstats_recent', 'swebench', 'verified', 'fallback']) expect(isWithheldSourceId(id)).toBe(false);
  expect(isWithheldSourceId('a-new-unreviewed-source')).toBe(true);
  const withheldBoards = new Set(SPECIALIST_BOARDS.filter(board => isWithheldBoardSource(board.source)).map(board => board.source));
  expect([...withheldBoards].sort()).toEqual(['3D Arena', 'Agentset', 'MMAU', 'MMMU', 'OCRBench', 'Video-MME']);
  // A board with a committed snapshot must never be one whose values are withheld.
  for (const board of SPECIALIST_BOARDS) if (board.snapshotLicence) expect(isWithheldBoardSource(board.source)).toBe(false);
  expect(SOURCE_CREDITS.some(credit => credit.note?.includes('Data by LLM Stats'))).toBe(true);
});

test('/api/leaderboard returns nulls with source info for withheld sources and keeps licensed values', async () => {
  const body = await (await leaderboardGET()).json();
  const row = body.models[0];
  expect(row.benchmarks).toEqual({ livebench2_overall: null, gpqa_diamond: null, arena_elo: 1333, swe_bench: 44.4 });
  expect(row.benchmark_sources.gpqa_diamond[0]).toMatchObject({ source_id: 'zeroeval', value: null, withheld: true, source_url: 'https://llm-stats.com' });
  expect(row.benchmark_sources.arena_elo[0].value).toBe(1333);
  expect(row.input_price_per_m).toBeNull();
  expect(row.effort_variants[0]).toMatchObject({ effort: 'high', livebench_global: null, livebench_coding: null, run_cost_usd: 12 });
  // Facts and our own memory estimates stay, even when ZeroEval supplied them.
  expect(row).toMatchObject({ params_b: 8, context_k: 128, release: '2026-01-02', vram_int4_gb: 5, vram_fp16_gb: 16 });
  expect(row.metadata_sources.params_b[0]).toMatchObject({ source_id: 'zeroeval', value: 8 });
  expect(row.composite_score).toBe(61);
  expect(row.withheld_sources.map((source: { id: string }) => source.id)).toEqual(['livebench', 'livebench2', 'zeroeval']);
  expect(body.dataLicence.withheldSources.map((source: { id: string }) => source.id)).toContain('bfcl');
  expect(JSON.stringify(body)).not.toContain('55.5');
  expect(JSON.stringify(body)).not.toContain('66.6');
});

test('/api/models applies the same filter to flattened rows', async () => {
  const body = await (await modelsGET(new NextRequest('http://localhost/api/models'))).json();
  expect(body.models[0]).toMatchObject({ parameter_count: 8, estimated_vram_q4_gb: 5, input_price_per_m: null, benchmarks: { gpqa_diamond: null, arena_elo: 1333 } });
});

test('/api/rankings keeps ranks but withholds a benchmark-mode score from an unlicensed evaluator', async () => {
  const body = await (await rankingsGET(new NextRequest('http://localhost/api/rankings?category=overall'))).json();
  expect(body.comparison.benchmark).toBe('livebench2_overall');
  expect(body.rankings[0]).toMatchObject({ slug: 'example-1', rank: 1, score: null });
  expect(JSON.stringify(body)).not.toContain('66.6');
  const chat = await (await rankingsGET(new NextRequest('http://localhost/api/rankings?category=chat'))).json();
  expect(chat.rankings[0]).toMatchObject({ rank: 1, score: 1333 });
});

function specialistSnapshot(boardId: string) {
  return {
    boardId, benchmark: 'example', checkedAt: '2026-11-14T09:00:00Z', sourceUpdatedAt: null, status: 'source', stale: false,
    rows: [
      { id: 'a', name: 'Model A', provider: 'Example', url: null, score: 81.25, openWeights: true, benchmarks: { part: 79.5 }, details: { Size: '7B', Votes: 1200 }, interval: [80, 82] },
      { id: 'b', name: 'Model B', provider: 'Example', url: null, score: 61.75, openWeights: false, details: {} },
    ],
  };
}

test('RAD-08: specialist redaction keeps allowed facts and withholds score-bearing details', () => {
  const board = SPECIALIST_BOARDS.find(board => board.id === 'vision')!;
  const row = specialistSnapshot('vision').rows[0];
  const input = { ...row, details: { Size: '8B', 'Reported date': '2026-01-01', 'Source license label': 'Open source', 'nDCG@10': 0.8, Price: 2, Votes: 100, Unknown: 93 } };
  const [redacted] = redactSpecialistRowsForPublicApi(board, [input]);
  expect(redacted.details).toEqual({ Size: '8B', 'Reported date': '2026-01-01', 'Source license label': 'Open source' });
  expect(redacted.score).toBeNull();
  expect(redacted.interval).toBeUndefined();
  expect(input.details['nDCG@10']).toBe(0.8);
});

test('/api/leaderboards for an unlicensed board returns ranks with null values and source info', async () => {
  jest.mocked(getSpecialistData).mockResolvedValue(specialistSnapshot('audio-understanding') as never);
  const response = await specialistGET(new Request('http://localhost/api/leaderboards/audio-understanding'), { params: Promise.resolve({ type: 'audio-understanding' }) });
  const body = await response.json();
  expect(body.rows.map((row: { name: string; rank: number; score: null }) => [row.name, row.rank, row.score])).toEqual([['Model A', 1, null], ['Model B', 2, null]]);
  expect(body.rows[0].benchmarks).toEqual({ part: null });
  expect(body.rows[0].details).toEqual({ Size: '7B' });
  expect(body.dataLicence).toMatchObject({ source: 'MMAU', valuesWithheld: true });
  expect(body.dataLicence.sourceUrl).toContain('sakshi113.github.io');
  expect(JSON.stringify(body)).not.toContain('81.25');
});

test('/api/leaderboards for an MTEB board still returns values', async () => {
  jest.mocked(getSpecialistData).mockResolvedValue(specialistSnapshot('embeddings') as never);
  const response = await specialistGET(new Request('http://localhost/api/leaderboards/embeddings'), { params: Promise.resolve({ type: 'embeddings' }) });
  const body = await response.json();
  expect(body.rows[0]).toMatchObject({ rank: 1, score: 81.25, benchmarks: { part: 79.5 } });
  expect(body.dataLicence).toMatchObject({ source: 'MTEB', licence: 'CC0 1.0', valuesWithheld: false });
});

test('KITTI keeps its values with the non-commercial share-alike licence attached', async () => {
  jest.mocked(getSpecialistData).mockResolvedValue(specialistSnapshot('depth-estimation') as never);
  const body = await (await specialistGET(new Request('http://localhost/api/leaderboards/depth-estimation'), { params: Promise.resolve({ type: 'depth-estimation' }) })).json();
  // Lower error ranks first on KITTI.
  expect(body.rows.map((row: { score: number }) => row.score)).toEqual([61.75, 81.25]);
  expect(body.dataLicence).toMatchObject({ licence: 'CC BY-NC-SA 3.0', valuesWithheld: false });
});
