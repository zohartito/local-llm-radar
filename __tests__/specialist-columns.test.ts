import { specialistColumns, sortSpecialistRows } from '../src/lib/specialist-columns';
import { rankSpecialistRows, type SpecialistRow } from '../src/lib/model-types';

const row = (id: string, score: number | null, benchmarks: SpecialistRow['benchmarks']): SpecialistRow => ({ id, name: id, provider: '', url: null, score, openWeights: null, details: {}, benchmarks });

it('sorts component metrics numerically, with zero and missing cells preserved in both directions', () => {
  const rows = [row('ten', 90, { 'Text edit distance': 0.1 }), row('zero', 80, { 'Text edit distance': 0 }), row('missing', null, {}), row('two', 70, { 'Text edit distance': 0.02 })];
  const column = specialistColumns(rows, 'Overall', 'desc', '/ 100').find(c => c.label === 'Text edit distance')!;
  expect(column.direction).toBe('asc');
  const ranked = rankSpecialistRows(rows, 'desc');
  expect(sortSpecialistRows(ranked, column, 'asc').map(r => [r.id, r.rank])).toEqual([['zero', 2], ['two', 3], ['ten', 1], ['missing', null]]);
  expect(sortSpecialistRows(ranked, column, 'desc').map(r => r.id)).toEqual(['ten', 'two', 'zero', 'missing']);
});

it('exposes group and suite metrics by default and individual tests on request', () => {
  const rows = [row('a', 80, { 'group:Retrieval': 85, 'task:A': 90, 'suite:embeddings': 80, 'suite:audio-embeddings': 30 })];
  const defaults = specialistColumns(rows, 'MTEB', 'desc', '/ 100', 'embeddings');
  expect(defaults.map(c => c.id)).toEqual(['release', 'score', 'group:Retrieval', 'suite:audio-embeddings']);
  expect(specialistColumns(rows, 'MTEB', 'desc', '/ 100', 'embeddings', true).some(c => c.id === 'task:A')).toBe(true);
});

it('shows reranker accuracy, latency, and price separately with appropriate sort direction', () => {
  const rows = [{ ...row('a', 1200, {}), details: { 'nDCG@10': 0.09, 'Latency (ms)': 999, 'USD / 1M tokens': 0.02, License: 'Apache 2.0' } }];
  const columns = specialistColumns(rows, 'Elo', 'desc', 'Elo');
  expect(columns.find(c => c.label === 'nDCG@10')).toMatchObject({ quality: true, direction: 'desc', digits: 5 });
  expect(columns.find(c => c.label === 'Latency (ms)')).toMatchObject({ direction: 'asc' });
  expect(columns.find(c => c.label === '$ / 1M tokens')?.value(rows[0])).toBe(0.02);
});
