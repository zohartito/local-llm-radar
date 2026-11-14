/**
 * Manual, all-or-nothing refresh of the checked-in public-source fallback.
 * Only boards with a `snapshotLicence` are captured: other sources' results may
 * be shown at request time but not redistributed (docs/DATA-SOURCES.md).
 */
import { writeFile } from 'node:fs/promises';
import { SPECIALIST_BOARDS, type SpecialistSnapshot } from '../src/lib/model-types';
import { fetchSpecialistSnapshot } from '../src/lib/specialist-fetch';

async function main() {
  const snapshots: SpecialistSnapshot[] = [];
  // Keep upstream load bounded; do not add a scheduled workflow for this script.
  const boards = SPECIALIST_BOARDS.filter(board => board.snapshotLicence);
  for (let start = 0; start < boards.length; start += 3) {
    const batch = await Promise.all(boards.slice(start, start + 3).map(async board => {
      const snapshot = await fetchSpecialistSnapshot(board);
      console.log(`${board.id}: ${snapshot.rows.length} rows, ${snapshot.rows.filter(row => row.score !== null).length} scored`);
      return snapshot;
    }));
    snapshots.push(...batch);
  }
  await writeFile(new URL('../data/specialist-snapshots.json', import.meta.url), JSON.stringify(snapshots, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
