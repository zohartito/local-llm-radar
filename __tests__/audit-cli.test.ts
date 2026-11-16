import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import fixture from './fixtures/synthetic-sources.json';

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
