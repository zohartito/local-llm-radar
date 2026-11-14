/** Preserve published calendar precision. Never substitute evaluation/check dates. */
export interface ReleaseEvidence {
  sourceUrl: string;
  checkedAt?: string;
  event: string;
  note: string;
}

export function textReleaseEvidence(model: { metadata_sources?: { release?: { selected: boolean; source_id: string; source_url?: string }[] } }): ReleaseEvidence | undefined {
  const selected = model.metadata_sources?.release?.find(row => row.selected && row.source_id === 'verified' && row.source_url);
  return selected ? { sourceUrl: selected.source_url!, event: 'Model release', note: 'Reviewed primary-source correction for this exact model version.' } : undefined;
}

export function normalizeReleaseDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value.trim());
  if (!match || (value.includes('T') && !match[3])) return null;
  const [, year, month, day] = match;
  if (+year < 1900 || +year > 2100 || (month && (+month < 1 || +month > 12))) return null;
  if (day && (+day < 1 || +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate())) return null;
  return [year, month, day].filter(Boolean).join('-');
}

export function formatReleaseDate(value: unknown): string {
  const date = normalizeReleaseDate(value);
  if (!date) return 'Unknown';
  if (date.length === 4) return date;
  const full = date.length === 7 ? `${date}-01` : date;
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', ...(date.length === 10 ? { day: 'numeric' as const } : {}), timeZone: 'UTC' }).format(new Date(`${full}T00:00:00Z`));
}

/** Unknown dates stay last for both newest-first and oldest-first sorting. */
export function compareReleaseDates(a: unknown, b: unknown, direction: 'asc' | 'desc'): number {
  const av = normalizeReleaseDate(a), bv = normalizeReleaseDate(b);
  if (!av) return bv ? 1 : 0;
  if (!bv) return -1;
  return (direction === 'asc' ? 1 : -1) * av.localeCompare(bv);
}
