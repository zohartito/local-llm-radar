import { RELEASE_RECORDS, checkReleaseProof, enrichReleaseDate, validateReleaseRegistry } from '../src/lib/release-evidence';
import { releaseInventory, releaseCoverage } from '../src/lib/release-inventory';
import type { SpecialistRow, SpecialistSnapshot } from '../src/lib/model-types';
const row = (name: string): SpecialistRow => ({ id: name, name, provider: '', score: 50, url: null, openWeights: null, details: {}, releaseDate: null });
it('enriches exact names within their reviewed board without borrowing dates for siblings or submissions', () => {
  const original = row('D-FINE-N');
  expect(enrichReleaseDate('object-detection', original)).toMatchObject({ releaseDate: '2024-11-07', releaseEvidence: { sourceUrl: expect.stringContaining('Peterande/D-FINE') }, score: 50 });
  expect(enrichReleaseDate('object-detection', row('D-FINE-S')).releaseDate).toBe('2024-10-18');
  expect(enrichReleaseDate('depth-estimation', original).releaseDate).toBeNull();
  expect(enrichReleaseDate('object-detection', row('D-FINE-N Preview')).releaseDate).toBeNull();
  expect(enrichReleaseDate('object-detection', { ...original, identityKind: 'submission' }).releaseDate).toBeNull();
  expect(original.releaseDate).toBeNull();
  expect(original.details).toEqual({});
});
it('retains conflicting upstream dates as evidence and rejects duplicate, invalid or future reviewed claims', () => {
  expect(enrichReleaseDate('object-detection', { ...row('D-FINE-N'), releaseDate: '2024-10-18' }).details['Upstream release date']).toBe('2024-10-18');
  const first = RELEASE_RECORDS[0];
  expect(() => validateReleaseRegistry([first, { ...first, id: 'different' }])).toThrow('Conflicting');
  expect(() => validateReleaseRegistry([{ ...first, date: '2024-02-30' }])).toThrow();
  expect(() => validateReleaseRegistry([{ ...first, date: '2027-01-01' }])).toThrow('future');
  expect(() => validateReleaseRegistry([{ ...first, sourceUrl: 'javascript:alert(1)' }])).toThrow();
});
it('requires the reviewed dated availability excerpt; unrelated paper/repository dates cannot pass', () => {
  const record = RELEASE_RECORDS.find(r => r.id === 'unidepth-v1')!;
  expect(checkReleaseProof(record, '`01.04.2024`: Inference code and V1 models are released.')).toBe(true);
  expect(checkReleaseProof(record, '`01.04.2024`: Paper submitted.')).toBe(false);
  expect(checkReleaseProof(record, 'created_at: 2024-04-01')).toBe(false);
  expect(checkReleaseProof(record, '01.04.2024 ' + ' '.repeat(200) + 'Inference code and V1 models are released.')).toBe(false);
});
it('counts board entries honestly and keeps submissions outside missing-model-date coverage', () => {
  const snapshots: SpecialistSnapshot[] = [{ boardId: 'object-detection', benchmark: 'fixture', checkedAt: '2026-10-27', sourceUpdatedAt: null, rows: [row('D-FINE-N'), row('Mystery'), { ...row('Reported'), releaseDate: '2025-01' }, { ...row('Team'), identityKind: 'submission' }] }];
  const inventory = releaseInventory(snapshots);
  expect(releaseCoverage(inventory)).toEqual({ reviewed: 1, reported: 1, unknown: 1, submission: 1 });
  expect(inventory.find(r => r.name === 'Reported')?.date).toBe('2025-01');
});

it('links the existing EmbeddingGemma 2 date to its dated launch without treating a page update as release evidence', () => {
  const enriched = enrichReleaseDate('embeddings', { ...row('google/embeddinggemma-2'), releaseDate: '2026-10-06' });
  expect(enriched).toMatchObject({ releaseDate: '2026-10-06', releaseEvidence: { sourceUrl: 'https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/' } });
  const record = RELEASE_RECORDS.find(r => r.id === 'embeddinggemma-2')!;
  expect(checkReleaseProof(record, 'Last updated 2026-10-06 UTC.')).toBe(false);
  expect(checkReleaseProof(record, 'Oct 06, 2026 Today, we’re launching EmbeddingGemma 2')).toBe(true);
});
