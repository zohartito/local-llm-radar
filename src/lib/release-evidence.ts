import { z } from 'zod';
import registry from '../../data/model-release-evidence.json';
import { normalizeReleaseDate, type ReleaseEvidence } from './model-release';
import type { SpecialistRow } from './model-types';

const httpsUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
});
const date = z.string().refine(value => value.length === 10 && normalizeReleaseDate(value) === value, 'Invalid calendar date');
const schema = z.array(z.object({
  id: z.string().min(1), date, boards: z.array(z.string().min(1)).min(1), names: z.array(z.string().min(1)).min(1),
  sourceUrl: httpsUrl, checkedAt: date, event: z.literal('Model / weights release'), note: z.string().min(1),
  proof: z.object({ url: httpsUrl, anchor: z.string().min(1), within: z.number().int().min(1).max(40000), includes: z.array(z.string().min(1)).min(1) }),
}));
export function validateReleaseRegistry(input: unknown) {
  const records = schema.parse(input);
  const ids = new Set<string>(), identities = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id) || record.date > record.checkedAt) throw new Error('Duplicate or future release claim');
    ids.add(record.id);
    for (const board of record.boards) for (const name of record.names) {
      const key = JSON.stringify([board, name]);
      if (identities.has(key)) throw new Error(`Conflicting release identity: ${key}`);
      identities.add(key);
    }
  }
  return records;
}
export const RELEASE_RECORDS = validateReleaseRegistry(registry);
export type ReleaseRecord = typeof RELEASE_RECORDS[number];
const index = new Map(RELEASE_RECORDS.flatMap(record => record.boards.flatMap(board => record.names.map(name => [JSON.stringify([board, name]), record] as const))));

/** Reviewed exact identities only. Submission dates and sibling model names are never fallbacks. */
export function enrichReleaseDate(boardId: string, row: SpecialistRow): SpecialistRow {
  if (row.identityKind === 'submission') return row;
  const record = index.get(JSON.stringify([boardId, row.name]));
  if (!record) return row;
  const evidence: ReleaseEvidence = { sourceUrl: record.sourceUrl, checkedAt: record.checkedAt, event: record.event, note: record.note };
  return { ...row, releaseDate: record.date, releaseEvidence: evidence, details: { ...row.details,
    ...(row.releaseDate && normalizeReleaseDate(row.releaseDate) !== record.date ? { 'Upstream release date': row.releaseDate } : {}),
    'Release evidence': record.note, 'Release source': record.sourceUrl,
  } };
}

/** Recheck the reviewed source excerpt, never promote a newly found date automatically. */
export function checkReleaseProof(record: ReleaseRecord, body: string): boolean {
  const start = body.indexOf(record.proof.anchor);
  if (start < 0) return false;
  const section = body.slice(start, start + record.proof.within);
  return record.proof.includes.every(token => section.includes(token));
}
