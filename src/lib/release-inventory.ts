import { getSpecialistBoard, type SpecialistSnapshot } from './model-types';
import { enrichReleaseDate } from './release-evidence';
import { normalizeReleaseDate, textReleaseEvidence, type ReleaseEvidence } from './model-release';
import type { MergedModel } from './merge-models';

export interface ReleaseEntry {
  id: string; name: string; boardId: string; board: string; href: string;
  date: string | null; status: 'reviewed' | 'reported' | 'unknown' | 'submission';
  sourceUrl: string | null; evidence?: ReleaseEvidence;
}
/** Board entries, not unique model counts: the same model can participate in several tests. */
export function releaseInventory(snapshots: SpecialistSnapshot[], textModels: Pick<MergedModel, 'slug' | 'name' | 'release' | 'metadata_sources'>[] = []): ReleaseEntry[] {
  const specialist = snapshots.flatMap(snapshot => snapshot.rows.map(raw => {
    const row = enrichReleaseDate(snapshot.boardId, raw);
    const date = row.identityKind === 'submission' ? null : normalizeReleaseDate(row.releaseDate);
    return { id: `${snapshot.boardId}:${row.id}`, name: row.name, boardId: snapshot.boardId, board: getSpecialistBoard(snapshot.boardId)?.name ?? snapshot.boardId,
      href: `/leaderboards/${snapshot.boardId}`, date,
      status: row.identityKind === 'submission' ? 'submission' as const : date ? row.releaseEvidence ? 'reviewed' as const : 'reported' as const : 'unknown' as const,
      sourceUrl: row.releaseEvidence?.sourceUrl ?? row.url, evidence: row.releaseEvidence,
    };
  }));
  return [...specialist, ...textModels.map(row => {
    const date = normalizeReleaseDate(row.release), evidence = textReleaseEvidence(row);
    return { id: `text:${row.slug}`, name: row.name, boardId: 'text', board: 'Text / LLMs', href: `/models/${encodeURIComponent(row.slug)}`, date,
      status: date ? evidence ? 'reviewed' as const : 'reported' as const : 'unknown' as const, sourceUrl: evidence?.sourceUrl ?? null, evidence };
  })];
}

export function releaseCoverage(entries: ReleaseEntry[]) {
  return entries.reduce((counts, row) => { counts[row.status]++; return counts; }, { reviewed: 0, reported: 0, unknown: 0, submission: 0 });
}
