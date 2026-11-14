import saved from '../data/specialist-snapshots.json';
import { embeddingRows } from '../src/lib/embedding-catalog';
import { parseMteb } from '../src/lib/specialist-parsers';
import { getSpecialistBoard, matchesSpecialistSearch, rankSpecialistRows, type SpecialistRow, type SpecialistSnapshot } from '../src/lib/model-types';

const omni: SpecialistRow = { id: 'org/omni', name: 'org/omni', provider: 'org', url: null, score: 80, openWeights: true, inputModalities: ['text', 'image', 'audio', 'video'], details: {} };
const imageOnly: SpecialistRow = { ...omni, id: 'image', inputModalities: ['image'], score: 99 };

describe('one embedding catalog, separate evaluations', () => {
  it('accepts everyday model names without requiring exact repository punctuation', () => {
    const model = { ...omni, name: 'google/embeddinggemma-2', provider: 'Google' };
    expect(matchesSpecialistSearch(model, 'EmbeddingGemma 2')).toBe(true);
    expect(matchesSpecialistSearch(model, '  GOOGLE gemma-2 ')).toBe(true);
    expect(matchesSpecialistSearch(model, 'gemma 3')).toBe(false);
    expect(matchesSpecialistSearch(model, '')).toBe(true);
  });
  it('joins exact models once without averaging or borrowing scores', () => {
    const snapshots = [{ boardId: 'image-embeddings', rows: [omni, imageOnly] }, { boardId: 'audio-embeddings', rows: [{ ...omni, score: 20 }, { ...omni, id: 'other', score: 100 }] }];
    const image = embeddingRows(snapshots, 'image-embeddings', true);
    expect(image.map(row => [row.id, row.score])).toEqual([['org/omni', 80], ['other', null]]);
    expect(embeddingRows(snapshots, 'audio-embeddings', true).find(row => row.id === omni.id)?.score).toBe(20);
    expect(rankSpecialistRows(image, 'desc').find(row => row.id === 'other')?.rank).toBeNull();
    const singleView = embeddingRows(snapshots, 'image-embeddings', false);
    expect(singleView).toHaveLength(2);
    expect(singleView[0].benchmarks).toMatchObject({ 'suite:image-embeddings': 80, 'suite:audio-embeddings': 20, 'suite:embeddings': null });
  });
  it('requires all requested inputs and never infers them from board membership', () => {
    const snapshots: Pick<SpecialistSnapshot, 'boardId' | 'rows'>[] = [{ boardId: 'image-embeddings', rows: [omni, imageOnly, { ...omni, id: 'two', inputModalities: ['text', 'image'] }, { ...omni, id: 'unknown', inputModalities: undefined }] }];
    expect(embeddingRows(snapshots, 'image-embeddings', true, ['audio', 'image']).map(row => row.id)).toEqual(['org/omni']);
    expect(embeddingRows(snapshots, 'image-embeddings', true)).toHaveLength(2);
  });
  it('keeps experiment variants distinct and handles conflicting capabilities conservatively', () => {
    const variant = { ...omni, id: omni.id + '::{"dimensions":512}' };
    const data = [{ boardId: 'image-embeddings', rows: [omni, variant] }, { boardId: 'audio-embeddings', rows: [{ ...omni, inputModalities: ['text', 'image'] as SpecialistRow['inputModalities'] }] }];
    expect(embeddingRows(data, 'image-embeddings', true)).toHaveLength(2);
    expect(embeddingRows(data, 'image-embeddings', true, ['audio']).map(row => row.id)).toEqual([variant.id]);
  });
  it('preserves explicit input metadata and leaves missing metadata unknown', () => {
    const board = getSpecialistBoard('audio-embeddings')!;
    const raw = { model: { name: 'org/embed', modelType: 'dense', modalities: ['text', 'audio', 'audio', 'unsupported'] }, meanTask: 0.5, scoresByTask: { a: 0.5 } };
    const payload = (rows: unknown[]) => JSON.stringify({ benchmarkName: board.benchmark, tasks: ['a'], rows });
    const results = parseMteb(payload([raw, { ...raw, model: { name: 'unknown', modelType: 'dense' } }]), board);
    expect(results[0].inputModalities).toEqual(['audio', 'text']);
    expect(results[1].inputModalities).toEqual([]);
    const gemma = parseMteb(payload([{ ...raw, totalParamsB: 0.271, model: { ...raw.model, name: 'google/embeddinggemma-2', license: 'gemma' } }]), board)[0];
    expect(gemma.details).toMatchObject({ 'Parameters (B)': 0.74, 'Benchmark-reported parameters (B)': 0.271, License: 'Apache-2.0' });
    expect(gemma.score).toBe(50);
  });
  it('makes DigUp’s EmbeddingGemma 2 discoverable without ranking its incomplete image evaluation', () => {
    const data = saved as SpecialistSnapshot[];
    const rows = embeddingRows(data, 'image-embeddings', true, ['text', 'image', 'audio', 'video']);
    const gemma = rows.filter(row => row.id === 'google/embeddinggemma-2');
    expect(gemma).toHaveLength(1);
    expect(gemma[0].inputModalities).toHaveLength(4);
    const imageResult = data.find(snapshot => snapshot.boardId === 'image-embeddings')!.rows.find(row => row.id === gemma[0].id);
    expect(gemma[0].score).toBe(imageResult?.score ?? null);
    expect(embeddingRows(data, 'audio-embeddings', true).find(row => row.id === gemma[0].id)?.score).toBeGreaterThan(0);
  });
  it('does not publish paper dates as checkpoint release dates or discard other metadata', () => {
    const board = getSpecialistBoard('embeddings')!;
    for (const name of ['sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2', 'sentence-transformers/paraphrase-multilingual-mpnet-base-v2', 'sentence-transformers/LaBSE']) {
      const row = parseMteb(JSON.stringify({ benchmarkName: board.benchmark, tasks: ['a'], rows: [{
        model: { name, modelType: 'dense', releaseDate: '2019-11-01', license: 'apache-2.0' },
        totalParamsB: 0.1, meanTask: 0.5, scoresByTask: { a: 0.5 },
      }] }), board)[0];
      expect(row.releaseDate).toBeNull();
      expect(row.details).toMatchObject({ 'Benchmark-reported date': '2019-11-01', 'Parameters (B)': 0.1, License: 'apache-2.0' });
      expect(row.details['Metadata note']).toContain('paper date');
      expect(row.score).toBe(50);
    }
  });
  it('labels the image suite task-type mean and rejects an upstream aggregation change', () => {
    const board = getSpecialistBoard('image-embeddings')!;
    const payload = { benchmarkName: board.benchmark, tasks: ['a'], rows: [], aggregations: ['mean_task_type', 'task_types'] };
    expect(board.metric).toBe('Mean (Task Type)');
    expect(() => parseMteb(JSON.stringify(payload), board)).not.toThrow();
    expect(() => parseMteb(JSON.stringify({ ...payload, aggregations: ['mean_task'] }), board)).toThrow('aggregation changed');
  });
});
