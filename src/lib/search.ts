export function normalizeSearchText(value: string | null | undefined): string {
  if (!value) return '';

  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesSearchQuery(
  query: string,
  ...values: Array<string | null | undefined>
): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const haystack = values
    .map((value) => normalizeSearchText(value))
    .filter(Boolean)
    .join(' ');

  if (!haystack) return false;

  return normalizedQuery
    .split(' ')
    .every((token) => haystack.includes(token));
}
