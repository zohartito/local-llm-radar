import { unstable_cache } from 'next/cache';
import saved from '../../data/specialist-snapshots.json';
import { getSpecialistBoard, type SpecialistBoard, type SpecialistSnapshot } from './model-types';
import { fetchSpecialistSnapshot } from './specialist-fetch';
import { enrichReleaseDate } from './release-evidence';

// This app has not enabled Cache Components. Cache the compact parsed result,
// not the multi-megabyte source HTML. No new scheduler or text-score changes.
// Board config (including edition/URL) is part of the key. Bump the explicit
// version whenever parser semantics change; imported code is not in Next's key.
const cachedSnapshot = unstable_cache(async (board: SpecialistBoard) => {
  return fetchSpecialistSnapshot(board);
}, ['specialist-boards-v9-vision-releases'], { revalidate: 3600 });

export async function getSpecialistData(id: string) {
  const board = getSpecialistBoard(id);
  if (!board) return null;
  try {
    const snapshot = await cachedSnapshot(board);
    if (snapshot.boardId !== id || snapshot.benchmark !== board.benchmark) throw new Error('Incompatible cached edition');
    return { ...snapshot, rows: snapshot.rows.map(row => enrichReleaseDate(id, row)), status: 'source' as const, stale: Date.now() - Date.parse(snapshot.checkedAt) > 86_400_000 };
  } catch {
    const snapshot = (saved as SpecialistSnapshot[]).find(value => value.boardId === id && value.benchmark === board.benchmark);
    if (snapshot) return { ...snapshot, rows: snapshot.rows.map(row => enrichReleaseDate(id, row)), status: 'saved' as const, stale: Date.now() - Date.parse(snapshot.checkedAt) > 86_400_000 };
    return { boardId: id, benchmark: board.benchmark, checkedAt: null, sourceUpdatedAt: null, rows: [], status: 'unavailable' as const, stale: true };
  }
}
