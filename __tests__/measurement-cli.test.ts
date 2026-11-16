import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(process.cwd(), '.next', 'audit-tests');
mkdirSync(root, { recursive: true });
const directory = () => mkdtempSync(path.join(root, 'measurement-'));
const run = (out: string, extraEnv: Record<string, string> = {}) => spawnSync(process.execPath, [
  '--require', './__tests__/fixtures/measurement-runtime.cjs', '--import', 'tsx',
  'scripts/measure-local.ts', '--model', 'invented:1b', '--machine', 'synthetic',
  '--host', 'http://measurement.invalid', '--remote', '--runs', '1', '--out', out,
], { encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH, HOME: out, ...extraEnv } });

test('RAD-01: repeated measurements preserve both receipts', () => {
  const out = directory();
  const first = run(out);
  expect(first.status).toBe(0);
  const firstPath = first.stdout.match(/Wrote (.+)/)![1];
  const bytes = readFileSync(firstPath, 'utf8');
  const second = run(out);
  expect(second.status).toBe(0);
  const secondPath = second.stdout.match(/Wrote (.+)/)![1];
  expect(secondPath).not.toBe(firstPath);
  expect(readFileSync(firstPath, 'utf8')).toBe(bytes);
  expect(JSON.parse(readFileSync(secondPath, 'utf8')).model.name).toBe('invented:1b');
  if (process.platform !== 'win32') expect(statSync(path.dirname(secondPath)).mode & 0o777).toBe(0o700);
}, 15000);

test('RAD-12: an existing output symlink is refused without changing its target', () => {
  const out = directory();
  const sentinel = path.join(out, 'sentinel.txt');
  writeFileSync(sentinel, 'preserve me');
  const result = run(out, { TEST_OUTPUT_SYMLINK: sentinel });
  expect(readFileSync(sentinel, 'utf8')).toBe('preserve me');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('EEXIST');
}, 10000);

test.each(['', '1'])('RAD-04: generation failure exits and stops sampling (pending request=%s)', hang => {
  const result = run(directory(), { TEST_GENERATION_ERROR: '1', TEST_HANG_SAMPLER: hang });
  expect(result.stderr).toContain('synthetic generation failure');
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).not.toContain('Wrote');
}, 10000);
