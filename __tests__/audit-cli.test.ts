import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import fixture from './fixtures/synthetic-sources.json';
import { SPECIALIST_BOARDS, rankSpecialistRows } from '../src/lib/model-types';
import { parseSpecialistSnapshot } from '../src/lib/specialist-parsers';
import { redactSpecialistRowsForPublicApi } from '../src/lib/public-api';

const root = path.join(process.cwd(), '.next', 'audit-tests');
mkdirSync(root, { recursive: true });
const directory = () => mkdtempSync(path.join(root, 'audit-'));
const run = (args: string[]) => spawnSync(process.execPath, [
  '--require', './__tests__/fixtures/offline-runtime.cjs', '--import', 'tsx', ...args,
], { encoding: 'utf8', timeout: 15000, env: { PATH: process.env.PATH, HOME: root } });
const read = (out: string, file: string) => JSON.parse(readFileSync(path.join(out, file), 'utf8'));

test('RAD-02: total upstream outage writes honest fallback receipts and fails', () => {
  const out = directory();
  const result = run(['scripts/audit-live-data.ts', '--out', out]);
  const receipt = read(out, 'leaderboard.json');
  const fallback = read(process.cwd(), 'data/curated-models.json');
  expect(receipt.sources).toHaveLength(9);
  expect(receipt.sources.every((source: { status: string }) => source.status === 'error')).toBe(true);
  expect(receipt).toMatchObject({ usedFallback: true, stale: true, dataSourceLabel: 'fallback', updated: fallback._updated, dataDate: fallback._updated });
  expect(receipt.degradedSources).toHaveLength(9);
  expect(result.status).toBe(1);
});

test('RAD-02: replay uses captured timestamps and reports missing required sources', () => {
  const out = directory();
  const captured = fixture.sources.map(source => ({ ...source, fetched_at: '2020-01-02T00:00:00Z' }));
  writeFileSync(path.join(out, 'sources.json'), JSON.stringify({ capturedAt: '2020-01-03T00:00:00Z', sources: captured }));
  const result = run(['scripts/audit-live-data.ts', '--out', out, '--replay']);
  expect(read(out, 'leaderboard.json')).toMatchObject({ usedFallback: false, stale: true, updated: '2020-01-02T00:00:00Z', dataDate: '2020-01-02T00:00:00Z', dataSourceLabel: 'partial' });
  expect(result.status).toBe(1);
});

test('RAD-05: specialist replay checks redacted fields and ranks from raw values', () => {
  const out = directory();
  const board = SPECIALIST_BOARDS.find(board => board.id === 'vision')!;
  const raw = JSON.stringify({ leaderboardData: [
    { info: { name: 'Invented VLM A', type: 'open_source', date: '2026-01-01' }, pro: { overall: 65, vision: 70, original: 60 } },
    { info: { name: 'Invented VLM B', type: 'proprietary', date: '2026-01-01' }, pro: { overall: 35, vision: 40, original: 30 } },
  ] });
  const parsed = parseSpecialistSnapshot(raw, board, '2026-01-02T00:00:00Z');
  expect(parsed.rows).toHaveLength(2);
  const live = { ...parsed, rows: redactSpecialistRowsForPublicApi(board, rankSpecialistRows(parsed.rows, board.direction)) };
  writeFileSync(path.join(out, 'vision.raw'), raw);
  writeFileSync(path.join(out, 'vision.json'), JSON.stringify(live));
  run(['scripts/audit-specialist-data.ts', out, '--replay']);
  const receipt = () => read(out, 'specialist-verification.json').find((row: { board: string }) => row.board === 'vision');
  expect(receipt()).toMatchObject({ rows: 2, differences: [] });
  // Other boards have no fixtures here; inspect this board's receipt only.
  live.rows[0].rank = 2;
  writeFileSync(path.join(out, 'vision.json'), JSON.stringify(live));
  run(['scripts/audit-specialist-data.ts', out, '--replay']);
  expect(receipt().error).toContain('rank');
});
