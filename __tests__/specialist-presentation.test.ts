import { specialistColumns } from '../src/lib/specialist-columns';
import { rankSpecialistByColumn, specialistCardColumns, specialistDisplayName, specialistEvidence } from '../src/lib/specialist-presentation';
import { benchmarkColorClass } from '../src/components/leaderboard-presentation';
import type { SpecialistRow } from '../src/lib/model-types';

const row = (id: string, score: number | null, retrieval: number | null): SpecialistRow => ({ id, name: `org/${id}`, provider: 'org', score, url: null, openWeights: true, details: {}, benchmarks: { 'group:Retrieval': retrieval } });

it('ranks the selected benchmark, preserves ties and primary scores, and leaves missing results unranked', () => {
  const rows = [row('a', 90, 20), row('b', 80, 50), row('tie', null, 50), row('zero', 99, 0), row('missing', 100, null)];
  const column = specialistColumns(rows, 'MTEB', 'desc', '/ 100').find(c => c.id === 'group:Retrieval')!;
  expect(rankSpecialistByColumn(rows, column).map(r => [r.id, r.rank, r.score])).toEqual([['b', 1, 80], ['tie', 1, null], ['a', 3, 90], ['zero', 4, 99], ['missing', null, 100]]);
});

it('uses lower-is-better ranking and colors for error metrics', () => {
  const rows = [row('a', 20, null), row('b', 5, null)];
  const primary = specialistColumns(rows, 'WER', 'asc', '%').find(c => c.id === 'score')!;
  expect(rankSpecialistByColumn(rows, primary).map(r => r.id)).toEqual(['b', 'a']);
  expect(benchmarkColorClass(5, 5, 20)).toContain('emerald');
  expect(benchmarkColorClass(20, 5, 20)).toContain('red');
});

it('uses source task coverage for evidence and keeps incomplete suites separate from component ranks', () => {
  const model = { ...row('a', null, 90), details: { 'Tasks reported': '2/131' } };
  const columns = specialistColumns([model], 'MTEB', 'desc', '/ 100');
  expect(specialistEvidence(model, columns)).toMatchObject({ reported: 2, total: 131 });
  expect(specialistDisplayName(model)).toBe('a');
  expect(model.name).toBe('org/a');
  expect(specialistCardColumns(columns).map(c => c.id)).toEqual(['score', 'group:Retrieval']);
});
