import type { SpecialistRow } from './model-types';
import { sortSpecialistRows, type SpecialistColumn } from './specialist-columns';

export function specialistDisplayName(row: SpecialistRow) {
  const prefix = `${row.provider}/`;
  return row.provider && row.name.startsWith(prefix) ? row.name.slice(prefix.length) : row.name;
}

/** Selecting a benchmark ranks that benchmark, never a mixture of test scores. */
export function rankSpecialistByColumn(rows: SpecialistRow[], column: SpecialistColumn) {
  let previous: number | null = null;
  let rank: number | null = null;
  return sortSpecialistRows(rows, column, column.direction).map((row, index) => {
    const value = column.value(row);
    if (typeof value !== 'number') return { ...row, rank: null };
    if (value !== previous) rank = index + 1;
    previous = value;
    return { ...row, rank };
  });
}

export function specialistEvidence(row: SpecialistRow, columns: SpecialistColumn[]) {
  const tasks = String(row.details['Tasks reported'] ?? '').match(/^(\d+)\/(\d+)$/);
  if (tasks && Number(tasks[2]) > 0) return { reported: Number(tasks[1]), total: Number(tasks[2]), label: 'tests reported in the selected suite' };
  const metrics = columns.filter(column => column.quality && !column.id.startsWith('suite:') && !column.id.startsWith('task:'));
  return { reported: metrics.filter(column => column.value(row) !== null).length, total: metrics.length, label: 'published metrics from this source; not independent evaluations' };
}

export function specialistMetricDisplay(column: SpecialistColumn, value: string | number | null) {
  if (value === null) return '—';
  if (typeof value === 'string') return column.id === 'detail:License' && /^https?:/.test(value) ? 'Custom' : value;
  if (column.id === 'detail:Parameters (B)') return `${Number(value.toFixed(2))}B`;
  if (column.id === 'detail:Max tokens') return value >= 1000 ? `${Math.round(value / 1000)}K` : String(value);
  const display = new Intl.NumberFormat('en-US', { maximumFractionDigits: column.digits ?? 4, minimumFractionDigits: column.quality ? Math.min(column.digits ?? 1, 1) : 0 }).format(value);
  return `${display}${column.unit === '%' ? '%' : ''}`;
}

export function specialistCardColumns(columns: SpecialistColumn[]) {
  const primary = columns.find(column => column.id === 'score');
  const quality = columns.filter(column => column.quality && column.id !== 'score' && !column.id.startsWith('task:') && !column.id.startsWith('suite:'));
  const supporting = columns.filter(column => /^detail:(Latency|Speed factor|USD|Votes)/.test(column.id));
  return [...(primary ? [primary] : []), ...quality, ...supporting].slice(0, 6);
}
