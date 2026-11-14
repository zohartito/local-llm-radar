import { safeScorecardLink } from '@/lib/scorecard-response';

interface Observation {
  source_id: string;
  value: string | number | boolean;
  selected: boolean;
  is_fallback?: boolean;
  source_url?: string;
}
interface Props {
  observations?: Partial<Record<string, Observation[]>>;
  sources?: Array<{ id: string; name: string; url: string }>;
}
const LABELS: Record<string, string> = {
  provider: 'Provider', license: 'License', params_b: 'Total parameters', context_k: 'Context',
  release: 'Release', vision: 'Vision support', is_open: 'Source weight-availability flags',
};
function valueLabel(field: string, value: Observation['value']): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (field === 'params_b') return `${value}B`;
  if (field === 'context_k') return `${value}K tokens`;
  return String(value);
}

/** Native details/summary makes evidence available to keyboard and touch users. */
export function MetadataDisclosure({ observations, sources = [] }: Props) {
  const fields = Object.entries(observations ?? {}).filter(([, rows]) => rows?.length);
  if (!fields.length) return null;
  return (
    <details className="mb-8 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <summary className="cursor-pointer text-sm font-medium text-zinc-300 focus-visible:outline-2 focus-visible:outline-emerald-400">
        Inspect metadata sources and conflicting reports
      </summary>
      <p className="mt-3 text-xs text-zinc-500">
        Selected marks the observation used above. Alternate reports remain visible; they are not averaged.
        Aggregator and archived values can contain errors. Downloadability also considers the license; conflicting claims can leave availability unverified. Context limits can depend on extensions and runtime support;
        check the publisher&apos;s model card before downloading or deploying.
      </p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 text-xs">
        {fields.map(([field, rows]) => (
          <div key={field} className="min-w-0">
            <dt className="font-medium text-zinc-300">{LABELS[field] ?? field}</dt>
            <dd className="mt-1">
              <ul className="space-y-1 text-zinc-400">
                {rows!.map((row, index) => {
                  const source = sources.find(item => item.id === row.source_id);
                  const label = row.is_fallback ? 'Curated archive' : row.source_id === 'verified' ? 'Publisher model card (checked correction)' : source?.name ?? row.source_id;
                  const href = safeScorecardLink(row.source_url ?? source?.url);
                  return (
                    <li key={`${row.source_id}-${index}`} className="break-words">
                      <span className={row.selected ? 'text-emerald-300' : ''}>
                        {valueLabel(field, row.value)}{row.selected ? ' · selected' : ''}
                      </span>{' · '}
                      {href ? <a href={href} target="_blank" rel="noreferrer" className="underline hover:text-zinc-200">{label}</a> : label}
                    </li>
                  );
                })}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
