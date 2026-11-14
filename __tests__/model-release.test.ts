import { compareReleaseDates, formatReleaseDate, normalizeReleaseDate } from '../src/lib/model-release';
import { specialistColumns, sortSpecialistRows } from '../src/lib/specialist-columns';
import type { SpecialistRow } from '../src/lib/model-types';

it('preserves source calendar dates and precision without local timezone shifts', () => {
  expect(normalizeReleaseDate('2026-10-06T00:00:00.000Z')).toBe('2026-10-06');
  expect(normalizeReleaseDate('2026-10-06T00:00:00+14:00')).toBe('2026-10-06');
  expect(formatReleaseDate('2026-10-06')).toBe('Oct 6, 2026');
  expect(formatReleaseDate('2026-10')).toBe('Oct 2026');
  expect(formatReleaseDate('2026')).toBe('2026');
  expect(normalizeReleaseDate('2024-02-29')).toBe('2024-02-29');
  for (const value of [null, undefined, '', 'Unknown', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-10T00:00:00Z', '01/02/2026']) {
    expect(normalizeReleaseDate(value)).toBeNull();
    expect(formatReleaseDate(value)).toBe('Unknown');
  }
});

it('sorts release dates with unknowns last and never ranks on report dates', () => {
  const dates = [null, '2026-06-05', 'invalid', '2025-10-23'];
  expect([...dates].sort((a,b) => compareReleaseDates(a,b,'desc'))).toEqual(['2026-06-05', '2025-10-23', null, 'invalid']);
  expect([...dates].sort((a,b) => compareReleaseDates(a,b,'asc'))).toEqual(['2025-10-23', '2026-06-05', null, 'invalid']);
  const rows: SpecialistRow[] = dates.map((releaseDate, i) => ({ id: String(i), name: String(i), provider: '', url: null, score: i, openWeights: null, releaseDate, details: { 'Reported date': '2026-10-25' } }));
  const column = specialistColumns(rows, 'Score', 'desc', '/ 100')[0];
  expect(column.id).toBe('release');
  expect(column.quality).toBeFalsy();
  expect(sortSpecialistRows(rows, column, 'desc').map(r => r.id)).toEqual(['1','3','0','2']);
  expect(column.value(rows[0])).toBeNull();
});
