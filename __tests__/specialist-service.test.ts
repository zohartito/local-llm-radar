jest.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
jest.mock('../src/lib/specialist-fetch', () => ({ fetchSpecialistSnapshot: jest.fn() }));

import saved from '../data/specialist-snapshots.json';
import { getSpecialistData } from '../src/lib/specialist-service';
import { fetchSpecialistSnapshot } from '../src/lib/specialist-fetch';
import type { SpecialistSnapshot } from '../src/lib/model-types';

const fetchSnapshot = jest.mocked(fetchSpecialistSnapshot);

afterEach(() => jest.resetAllMocks());

it('preserves the original timestamp and clearly labels an unavailable-source fallback', async () => {
  fetchSnapshot.mockRejectedValue(new Error('Source schema changed'));
  const original = saved.find(row => row.boardId === 'embeddings')!;
  const before = JSON.stringify(original);
  const result = await getSpecialistData('embeddings');
  expect(result).toMatchObject({ status: 'saved', checkedAt: original.checkedAt, benchmark: original.benchmark });
  // Date provenance is attached after cache lookup; all saved facts/timestamps remain intact.
  expect(result!.rows).toMatchObject(original.rows);
  expect(result!.rows.find(row => row.name === 'google/embeddinggemma-2')?.releaseEvidence?.sourceUrl).toBe('https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/');
  expect(JSON.stringify(original)).toBe(before);
});

it('reports old cache data as stale rather than refreshing its timestamp', async () => {
  const snapshot: SpecialistSnapshot = { ...(saved[0] as SpecialistSnapshot), checkedAt: '2020-01-01T00:00:00Z' };
  fetchSnapshot.mockResolvedValue(snapshot);
  expect(await getSpecialistData(snapshot.boardId)).toMatchObject({ status: 'source', stale: true, checkedAt: snapshot.checkedAt });
});

it('does not fetch or substitute text rankings for unknown board IDs', async () => {
  expect(await getSpecialistData('not-a-board')).toBeNull();
  expect(fetchSnapshot).not.toHaveBeenCalled();
});

it('rejects a cached result from a different benchmark edition', async () => {
  fetchSnapshot.mockResolvedValue({ ...(saved[0] as SpecialistSnapshot), benchmark: 'Old edition' });
  const result = await getSpecialistData('embeddings');
  expect(result).toMatchObject({ status: 'saved', benchmark: 'MTEB(Multilingual, v2)' });
});
