import saved from '../data/specialist-snapshots.json';
import { SPECIALIST_BOARDS, getSpecialistBoard, rankSpecialistRows, type SpecialistRow } from '../src/lib/model-types';
import { parseMteb, parseMmmu, parseOmniDoc, parseRerankers, parseSpecialistSnapshot, safeSourceUrl } from '../src/lib/specialist-parsers';
import { fetchSpecialistSnapshot } from '../src/lib/specialist-fetch';

const checkedAt = '2026-10-24T12:00:00.000Z';
const flight = (text: string) => `<script>self.__next_f.push([1,${JSON.stringify(text.slice(0, 90))}])</script><script>self.__next_f.push([1,${JSON.stringify(text.slice(90))}])</script>`;
const row = (id: string, score: number | null): SpecialistRow => ({ id, name: id, provider: '', url: null, score, openWeights: null, details: {} });

describe('task-specific rank boundaries', () => {
  it('ranks lower WER first, preserves zero, ties, and missing observations', () => {
    const input = [row('missing', null), row('b', 2), row('a', 0), row('c', 2), row('d', 4)];
    expect(rankSpecialistRows(input, 'asc').map(r => [r.id, r.rank])).toEqual([['a', 1], ['b', 2], ['c', 2], ['d', 4], ['missing', null]]);
    expect(input[0].id).toBe('missing');
    expect(rankSpecialistRows(input, 'desc')[0].id).toBe('d');
  });

  it('commits a real, edition-matched fallback only for boards whose results licence allows it', () => {
    expect(new Set(SPECIALIST_BOARDS.map(b => b.id)).size).toBe(SPECIALIST_BOARDS.length);
    const allowed = new Set(SPECIALIST_BOARDS.filter(b => b.snapshotLicence).map(b => b.id));
    expect(saved.filter(s => !allowed.has(s.boardId)).map(s => s.boardId)).toEqual([]);
    for (const board of SPECIALIST_BOARDS.filter(b => b.snapshotLicence)) {
      const snapshot = saved.find(s => s.boardId === board.id);
      expect(snapshot?.benchmark).toBe(board.benchmark);
      expect(snapshot!.rows.length).toBeGreaterThan(1);
      expect(new Set(snapshot!.rows.map(r => r.id)).size).toBe(snapshot!.rows.length);
      expect(snapshot!.rows.some(r => r.score !== null && Number.isFinite(r.score))).toBe(true);
      expect(Date.parse(snapshot!.checkedAt)).toBeGreaterThan(0);
      // Next's fetch cache serializes the snapshot inside a JSON response body.
      expect(Buffer.byteLength(JSON.stringify(JSON.stringify(snapshot)))).toBeLessThan(2 * 1024 * 1024);
    }
    expect(getSpecialistBoard('unknown')).toBeUndefined();
  });
});

describe('MTEB provenance and coverage', () => {
  const board = getSpecialistBoard('embeddings')!;
  const model = { name: 'org/embed', url: 'https://huggingface.co/org/embed', modelType: 'dense', openWeights: true, releaseDate: '2026-10-06' };
  const base = { model, meanTask: 0.7, scoresByTask: { a: 0.8, b: 0.6 }, embeddingDim: 1024, maxTokens: 8192 };
  const payload = (rows: unknown[]) => JSON.stringify({ benchmarkName: board.benchmark, tasks: ['a', 'b'], rows });
  it('preserves model release metadata separately from evaluation dates', () => {
    expect(parseMteb(payload([base]), board)[0].releaseDate).toBe('2026-10-06');
    expect(parseMteb(payload([{ ...base, model: { ...model, releaseDate: null } }]), board)[0].releaseDate).toBeNull();
  });

  it('keeps experiment IDs and scales the documented 0–1 score once', () => {
    const rows = parseMteb(payload([base, { ...base, experiments: { dimensions: 512 } }]), board);
    expect(rows[0].score).toBe(70);
    expect(rows[1].id).not.toBe(rows[0].id);
    expect(rows[1].details.Experiment).toContain('512');
  });
  it('exposes task and complete group scores without comparing partial group averages', () => {
    const text = JSON.stringify({ benchmarkName: board.benchmark, tasks: ['a', 'b'],
      tasksMeta: [{ name: 'a', type: 'Retrieval' }, { name: 'b', type: 'Retrieval' }, { name: 'outside', type: 'Classification' }],
      rows: [{ ...base, scoresByTaskType: { Retrieval: 0.7, Classification: 1 } },
        { ...base, scoresByTask: { a: 0 }, scoresByTaskType: { Retrieval: 0 } }],
    });
    const [complete, partial] = parseMteb(text, board);
    expect(complete.benchmarks).toEqual({ 'group:Retrieval': 70, 'task:a': 80, 'task:b': 60 });
    expect(partial.benchmarks).toEqual({ 'group:Retrieval': null, 'task:a': 0 });
    expect(partial.score).toBeNull();
    expect(parseMteb(payload([{ ...base, zeroShotPct: -1 }]), board)[0].details['Zero-shot %']).toBeUndefined();
    expect(parseMteb(payload([{ ...base, zeroShotPct: 0 }]), board)[0].details['Zero-shot %']).toBe(0);
  });
  it('never turns partial coverage or null scores into rankings', () => {
    const rows = parseMteb(payload([{ ...base, meanTask: null }, { ...base, scoresByTask: { a: 0.8 } }]), board);
    expect(rows.map(r => r.score)).toEqual([null, null]);
    expect(parseMteb(payload([{ ...base, model: { ...model, modelType: 'cross-encoder' } }]), board)).toEqual([]);
  });
  it('rejects wrong editions and conflicting model identities', () => {
    expect(() => parseMteb(payload([base]).replace(board.benchmark, 'Old edition'), board)).toThrow('suite changed');
    expect(() => parseSpecialistSnapshot(payload([base, { ...base, meanTask: 0.8 }]), board, checkedAt)).toThrow('Conflicting');
  });
});

describe('published evaluator parsers', () => {
  it('keeps MMMU-Pro separate from original MMMU and excludes non-model baselines', () => {
    const info = { name: 'Vision A', type: 'open_source', date: '2026-01-01' };
    const rows = parseMmmu(JSON.stringify({ leaderboardData: [
      { info, pro: { overall: '72.5', vision: '71.0', original: '74.0', source: 'author' }, validation: { overall: '95' } },
      { info: { ...info, name: 'Original-only' }, validation: { overall: '99' } },
      { info: { ...info, type: 'human_expert' }, pro: { overall: '99' } },
      { info: { ...info, type: 'random_frequent' }, pro: { overall: '22' } },
    ] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].releaseDate).toBeUndefined();
    expect(rows[0].benchmarks).toEqual({ 'MMMU-Pro Vision': 71, 'MMMU-Pro Standard': 74 });
    expect(rows[0]).toMatchObject({ score: 72.5, details: { Evidence: 'Author submitted' } });
  });
  it('treats missing license/access metadata as unknown', () => {
    const rerank = flight(`"entries":${JSON.stringify([{ name: 'r', provider: 'lab', score: 1300, license: 'Apache 2.0', avgNdcg10: 0.2 }])}`);
    expect(parseRerankers(rerank)[0]).toMatchObject({ openWeights: null, score: 1300, details: { 'nDCG@10': 0.2 } });
  });
  it('accepts only the pinned full-document OCR edition', () => {
    const table = '<table><caption>Comprehensive evaluation of document parsing on OmniDocBench (v1.6_full)</caption><tr>' + ['OCR', 'Specialized VLMs', '1B', '<strong>96.5</strong>', '0.1', '90', '95', '96', '0.2'].map(s => `<td>${s}</td>`).join('') + '</tr></table>';
    expect(parseOmniDoc(table)[0]).toMatchObject({ name: 'OCR', score: 96.5, details: { Type: 'Specialized VLMs' } });
    expect(parseOmniDoc(table)[0].benchmarks).toEqual({ 'Text edit distance': 0.1, 'Formula CDM': 90, 'Table TEDS': 95, 'Table TEDS-S': 96, 'Reading-order edit distance': 0.2 });
    expect(() => parseOmniDoc(table.replace('v1.6_full', 'v1.5'))).toThrow('edition changed');
  });
});

describe('source transport boundaries', () => {
  it('rejects active URLs and untrusted endpoint hosts', async () => {
    expect(safeSourceUrl('javascript:alert(1)')).toBeNull();
    expect(safeSourceUrl('https://user:password@example.com')).toBeNull();
    expect(safeSourceUrl('/image/model', 'https://example.org')).toBe('https://example.org/image/model');
    await expect(fetchSpecialistSnapshot({ ...SPECIALIST_BOARDS[0], dataUrl: 'http://127.0.0.1/private' })).rejects.toThrow('Unsupported');
  });
});
