'use client';

import { useEffect, useState } from 'react';
import { snapshotExpired } from '@/lib/trust';

export type DataSourceLabel = 'live' | 'partial' | 'fallback';

interface DataFreshnessBadgeProps {
  dataSourceLabel?: DataSourceLabel;
  dataDate?: string | null;
  stale?: boolean;
  degradedSources?: string[];
}

// Date-only strings ("2026-08-03") are calendar dates, not instants. `new Date()`
// parses them as UTC midnight, which `toLocaleDateString` then renders as the
// PREVIOUS day for visitors behind UTC (e.g. "Aug 2" in PDT) — the badge was
// quietly a day behind the file it cites. Pin date-only values to UTC.
function parseDataDate(dataDate?: string | null): Date | null {
  if (!dataDate) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataDate);
  const parsed = dateOnly
    ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])))
    : new Date(dataDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDataDate(dataDate?: string | null): string {
  if (!dataDate) return 'an unknown date';
  const parsed = parseDataDate(dataDate);
  if (!parsed) return dataDate;
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    // Only safe to pin UTC for date-only values; full timestamps keep local time.
    ...(/^\d{4}-\d{2}-\d{2}$/.test(dataDate) ? { timeZone: 'UTC' } : {}),
  });
}

// Calendar-day age of the data, so "cached from Aug 3" is legible as e.g.
// "11 days old" without the visitor doing date math.
function dataAgeDays(dataDate?: string | null): number | null {
  const parsed = parseDataDate(dataDate);
  if (!parsed) return null;
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86_400_000));
}

function formatAge(ageDays: number | null): string {
  if (ageDays === null) return '';
  if (ageDays === 0) return 'today';
  return `${ageDays} day${ageDays === 1 ? '' : 's'} old`;
}

/**
 * Honesty surface for the leaderboard. Makes the data provenance unmistakable so
 * cached or fallback data is never silently presented as live:
 *   - live     → green "Live" pill
 *   - partial  → amber "Partial — N sources degraded" pill
 *   - fallback → red "Showing cached data from <date>" pill
 * A separate "stale" warning chip is shown whenever the data is past its freshness window.
 */
export function DataFreshnessBadge({
  dataSourceLabel = 'partial',
  dataDate = null,
  stale = false,
  degradedSources = [],
}: DataFreshnessBadgeProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 15_000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
  }, []);
  // A tab can outlive its response. Recompute locally without refetching or
  // changing the snapshot's timestamp; returning from sleep updates immediately.
  const expired = snapshotExpired(dataDate, now);
  const displayStale = stale || (dataSourceLabel !== 'fallback' && expired);
  const displayLabel = dataSourceLabel === 'live' && displayStale ? 'partial' : dataSourceLabel;
  const degradedCount = degradedSources.length;
  const ageDays = dataAgeDays(dataDate);
  const ageText = formatAge(ageDays);

  let pillClass: string;
  let dotClass: string;
  let label: string;
  let title: string;

  if (displayLabel === 'fallback') {
    pillClass = 'bg-red-500/15 text-red-300 border-red-500/40';
    dotClass = 'bg-red-400';
    label = `Showing cached data from ${formatDataDate(dataDate)}${ageText ? ` (${ageText})` : ''}`;
    title = 'A live refresh is unavailable. The leaderboard is being served from a cached/curated snapshot — these are not freshly fetched numbers.';
  } else if (displayLabel === 'partial') {
    pillClass = 'bg-amber-500/15 text-amber-300 border-amber-500/40';
    dotClass = 'bg-amber-400';
    label = displayStale ? 'Cached snapshot — refresh overdue' : degradedCount ? `Partial — ${degradedCount} source${degradedCount === 1 ? '' : 's'} degraded` : 'Source freshness unverified';
    title = degradedCount > 0
      ? `Some sources returned no data or errored, so a few benchmarks may be thinner than usual. Degraded: ${degradedSources.join(', ')}`
      : 'The snapshot is past its freshness window or its time is unavailable. Reload to check for a newer snapshot.';
  } else {
    pillClass = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
    dotClass = 'bg-emerald-400';
    label = 'Sources fetched';
    title = 'Active sources responded at the snapshot time. This is not a live evaluation: benchmark editions, publication dates, and fallback values vary.';
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium ${pillClass}`}
        title={title}
      >
        <span className={`w-2 h-2 rounded-full ${dotClass}`} aria-hidden="true" />
        {label}
      </span>

      {dataSourceLabel !== 'fallback' && dataDate && (
        <span className="text-[10px] text-zinc-500" title="Snapshot build time, not the date each model was evaluated">
          snapshot {formatDataDate(dataDate)}{ageText ? ` · ${ageText}` : ''}
        </span>
      )}

      {displayStale && (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-amber-500/15 text-amber-300 border-amber-500/40 text-[11px] font-medium"
          title="The displayed data is past its expected freshness window. A refresh is needed for current numbers."
        >
          <span className="w-2 h-2 rounded-full bg-amber-400" aria-hidden="true" />
          Stale — refresh needed
        </span>
      )}
    </div>
  );
}
