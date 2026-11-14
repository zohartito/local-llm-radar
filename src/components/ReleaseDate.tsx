import { formatReleaseDate, normalizeReleaseDate, type ReleaseEvidence } from '@/lib/model-release';

export function ReleaseDate({ value, evidence, submission = false, linked = true }: { value?: string | null; evidence?: ReleaseEvidence; submission?: boolean; linked?: boolean }) {
  if (submission) return <span title="Team / method submission, not an identified model release. See Submitted for its benchmark date.">N/A</span>;
  const date = normalizeReleaseDate(value);
  if (!date) return <span title="No supported model release date available; see Releases for coverage">Unknown</span>;
  const label = <time dateTime={date} title={evidence ? `${evidence.event}. ${evidence.note}${evidence.checkedAt ? ` Checked ${evidence.checkedAt}.` : ''}` : 'Source-reported model release date; not independently verified by Radar'} className="whitespace-nowrap">{formatReleaseDate(date)}</time>;
  return evidence && linked ? <a href={evidence.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400 underline decoration-dotted underline-offset-4">{label}</a> : label;
}
