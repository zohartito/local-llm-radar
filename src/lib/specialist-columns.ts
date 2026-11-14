import { normalizeReleaseDate } from './model-release';
import { EMBEDDING_TESTS } from './embedding-catalog';
import { getSpecialistBoard, INPUT_LABELS, type SpecialistRow } from './model-types';

export interface SpecialistColumn {
  id: string;
  label: string;
  description: string;
  direction: 'asc' | 'desc';
  numeric: boolean;
  quality?: boolean;
  digits?: number;
  unit?: string;
  value: (row: SpecialistRow) => string | number | null;
}

const metricNames: Record<string, string> = { 'AA dataset WER': 'AA-AgentTalk WER', 'VoxPopuli WER': 'VoxPopuli-Cleaned-AA WER', 'Earnings22 WER': 'Earnings22-Cleaned-AA WER' };
const groupNames: Record<string, string> = {
  Retrieval: 'Retrieval', Classification: 'Classification', Clustering: 'Clustering',
  STS: 'Similarity', BitextMining: 'Translation matching', Reranking: 'Reranking',
  PairClassification: 'Pair classification', MultilabelClassification: 'Multi-label',
  InstructionReranking: 'Instruction reranking', Any2AnyRetrieval: 'Cross-modal retrieval',
};
const specs: [string, string, boolean][] = [
  ['Parameters (B)', 'Params (B)', true], ['Size', 'Size', false],
  ['Max tokens', 'Context', true], ['Dimensions', 'Dimensions', true],
  ['Params (M)', 'Params (M)', true], ['Resolution', 'Resolution', false], ['License', 'License', false], ['Host', 'Host', false], ['Frames', 'Frames / sampling', false],
];
const supporting: [string, string, boolean][] = [
  ['nDCG@10', 'nDCG@10', true], ['Tasks reported', 'Tests reported', false],
  ['Latency (ms)', 'Latency (ms)', true], ['Speed factor', 'Speed factor', true],
  ['USD / 1M tokens', '$ / 1M tokens', true], ['USD / 1k images', '$ / 1k images', true],
  ['USD / minute', '$ / minute', true], ['USD / 1k minutes', '$ / 1k minutes', true],
  ['USD / 1M characters', '$ / 1M characters', true], ['Votes', 'Votes', true],
  ['Reported date', 'Reported date', false], ['Submission date', 'Submitted', false], ['Runtime', 'Runtime', false], ['Environment', 'Environment', false], ['Training data', 'Training data', false],
  ['Zero-shot %', 'Zero-shot %', true], ['Chunking', 'Chunking', false],
  ['Type', 'Architecture', false], ['Evidence', 'Evidence', false], ['Source license label', 'Source access label', false],
];
const detailColumn = ([key, label, numeric]: [string, string, boolean]): SpecialistColumn => ({
  id: `detail:${key}`, label, description: key === 'nDCG@10' ? 'Source-reported nDCG@10; higher is better.' : key,
  direction: /Latency|USD/.test(key) ? 'asc' : numeric ? 'desc' : 'asc', numeric,
  quality: key === 'nDCG@10', digits: key === 'nDCG@10' ? 5 : 4,
  value: row => row.details[key] ?? null,
});

/** The source's units and benchmark boundaries stay visible in the matrix. */
export function specialistColumns(rows: SpecialistRow[], metric: string, direction: 'asc' | 'desc', unit: string, boardId?: string, individualTests = false): SpecialistColumn[] {
  const has = (key: string) => rows.some(row => row.details[key] !== undefined);
  const keys = [...new Set(rows.flatMap(row => Object.keys(row.benchmarks ?? {})))];
  const benchmarks = keys.filter(key => (!key.startsWith('task:') || individualTests) && key !== `suite:${boardId}`)
    .sort((a, b) => {
      const order = (key: string) => key.startsWith('suite:') ? 2 : key.startsWith('task:') ? 3 : 1;
      const groupOrder = ['Retrieval', 'STS', 'Reranking', 'Classification', 'Clustering'];
      const priority = (key: string) => groupOrder.includes(key.slice(6)) ? groupOrder.indexOf(key.slice(6)) : 99;
      return order(a) - order(b) || priority(a) - priority(b) || a.localeCompare(b);
    }).map((key): SpecialistColumn => {
      const [kind, name] = key.split(':');
      const suite = kind === 'suite' ? getSpecialistBoard(name) : undefined;
      const rule = boardId ? getSpecialistBoard(boardId)?.metrics?.[key] : undefined;
      const lower = rule ? rule.direction === 'asc' : /WER|edit distance/.test(key);
      const label = kind === 'group' ? groupNames[name] ?? name : kind === 'task' ? key.slice(5) : kind === 'suite' ? EMBEDDING_TESTS.find(test => test.id === name)?.label ?? name : metricNames[key] ?? key;
      return {
        id: key, label, quality: true, numeric: true, direction: lower ? 'asc' : 'desc',
        unit: rule?.unit ?? (/WER/.test(key) ? '%' : /edit distance/.test(key) ? '' : '/ 100'), digits: rule?.digits ?? (/edit distance/.test(key) ? 4 : 2),
        description: suite ? `${suite.benchmark}. Separate evaluation; scores are not averaged across suites.` : kind === 'group' ? `${name}: source average, shown only for complete coverage of this task group in the selected suite.` : kind === 'task' ? `${label}: source task score in the selected suite, scaled to 100.` : `${label}; ${lower ? 'lower' : 'higher'} is better.`,
        value: row => row.benchmarks?.[key] ?? null,
      };
    });
  return [
    { id: 'release', label: 'Released', description: 'Source-reported model release date. Unknown means the source does not provide a date; report and evaluation dates are separate.', direction: 'desc', numeric: false, value: row => normalizeReleaseDate(row.releaseDate) },
    ...specs.filter(([key]) => has(key)).map(detailColumn),
    { id: 'score', label: metric, description: `${metric}; ${direction === 'asc' ? 'lower' : 'higher'} is better. Ranks use this score.`, direction, numeric: true, quality: true, unit, digits: 2, value: row => row.score },
    ...supporting.filter(([key]) => key === 'nDCG@10' && has(key)).map(detailColumn),
    ...benchmarks,
    ...(rows.some(row => row.interval) ? [{ id: 'interval', label: '95% CI', description: 'Published 95% confidence interval for the primary score', direction: 'desc' as const, numeric: false, value: (row: SpecialistRow) => row.interval ? `${row.interval[0].toFixed(1)}–${row.interval[1].toFixed(1)}` : null }] : []),
    ...(rows.some(row => row.inputModalities?.length) ? [{ id: 'inputs', label: 'Inputs', description: 'Source-reported accepted inputs', direction: 'asc' as const, numeric: false, value: (row: SpecialistRow) => row.inputModalities?.map(input => INPUT_LABELS[input]).join(', ') ?? null }] : []),
    ...supporting.filter(([key]) => key !== 'nDCG@10' && has(key)).map(detailColumn),
  ];
}

/** Missing cells sort last in either direction; ranks are not changed by sorting. */
export function sortSpecialistRows<T extends SpecialistRow>(rows: T[], column: SpecialistColumn, direction: 'asc' | 'desc'): T[] {
  return [...rows].sort((a, b) => {
    const av = column.value(a), bv = column.value(b);
    if (av === null) return bv === null ? a.id.localeCompare(b.id) : 1;
    if (bv === null) return -1;
    const delta = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true });
    return (direction === 'asc' ? delta : -delta) || a.id.localeCompare(b.id);
  });
}
