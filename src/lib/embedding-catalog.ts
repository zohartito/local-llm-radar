import { INPUT_LABELS, type InputModality, type SpecialistRow, type SpecialistSnapshot } from './model-types';

export const EMBEDDING_TESTS = [
  { id: 'embeddings', label: 'Text · many languages' },
  { id: 'embeddings-english', label: 'Text · English' },
  { id: 'image-embeddings', label: 'Images' },
  { id: 'audio-embeddings', label: 'Audio' },
  { id: 'video-embeddings', label: 'Video' },
  { id: 'document-retrieval', label: 'Document pages' },
  { id: 'code-embeddings', label: 'Code' },
];

export type EmbeddingSnapshot = Omit<SpecialistSnapshot, 'checkedAt'> & { checkedAt: string | null; status: 'source' | 'saved' | 'unavailable'; stale: boolean };

/** Same source identity + experiment = one model row. Never combine test scores. */
export function embeddingRows(snapshots: Pick<SpecialistSnapshot, 'boardId' | 'rows'>[], selectedTest: string, mixed: boolean, requiredInputs: InputModality[] = []): SpecialistRow[] {
  const catalog = new Map<string, Map<string, SpecialistRow>>();
  for (const snapshot of snapshots) {
    for (const row of snapshot.rows) {
      const observations = catalog.get(row.id) ?? new Map<string, SpecialistRow>();
      observations.set(snapshot.boardId, row);
      catalog.set(row.id, observations);
    }
  }
  return [...catalog.values()].flatMap(observations => {
    const rows = [...observations.values()];
    // If snapshots disagree, only advertise capabilities on which they agree.
    // Missing metadata is unknown, not evidence for or against a capability.
    const knownInputs = rows.map(row => row.inputModalities).filter((inputs): inputs is InputModality[] => !!inputs?.length);
    const inputs = knownInputs[0]?.filter(input => knownInputs.every(values => values.includes(input))) ?? [];
    if (mixed && (inputs.length < 2 || !requiredInputs.every(input => inputs.includes(input)))) return [];
    const selected = observations.get(selectedTest);
    if (!mixed && !selected) return [];
    const base = selected ?? rows[0];
    return [{ ...base, score: selected?.score ?? null, inputModalities: inputs,
      // Group and task columns always belong to the selected test, even for unranked models.
      benchmarks: { ...selected?.benchmarks, ...Object.fromEntries(EMBEDDING_TESTS.map(test => [`suite:${test.id}`, observations.get(test.id)?.score ?? null])) },
      details: { ...base.details, 'Details from test': EMBEDDING_TESTS.find(test => test.id === (selected ? selectedTest : observations.keys().next().value))?.label ?? selectedTest, 'Accepted inputs (source reported)': inputs.map(input => INPUT_LABELS[input]).join(', '),
        ...Object.fromEntries(EMBEDDING_TESTS.map(test => [test.label + ' test', observations.has(test.id) ? observations.get(test.id)!.score === null ? 'Incomplete evaluation · no rank' : `${observations.get(test.id)!.score!.toFixed(2)} / 100` : 'No result in this suite'])),
      },
    }];
  });
}
