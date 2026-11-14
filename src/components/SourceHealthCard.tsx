'use client';

type SourceStatus = 'ok' | 'degraded' | 'error';

interface SourceHealthCardProps {
  source: {
    id: string;
    name: string;
    url: string;
    count: number;
    error?: string;
    status?: SourceStatus;
    duration_ms: number;
    fetched_at: string;
    data_date?: string | null;
    date_kind?: 'benchmark_edition' | 'publication';
    historical?: boolean;
  };
  isStale: boolean;
}

export function SourceHealthCard({ source, isStale }: SourceHealthCardProps) {
  // Prefer the explicit per-source status when the API provides it; otherwise
  // derive it from the error field for backward compatibility.
  const status: SourceStatus = source.status
    ?? (source.error ? 'error' : 'ok');
  const isError = status === 'error';
  const isDegraded = status === 'degraded';
  const lastFetch = source.fetched_at ? new Date(source.fetched_at) : null;

  const timeSince = lastFetch
    ? formatTimeSince(lastFetch)
    : 'Never';

  // Degraded outranks stale for the card accent; error always wins.
  const containerClass = isError
    ? 'border-red-800/50 bg-red-950/20'
    : isDegraded
    ? 'border-amber-700/50 bg-amber-950/15'
    : isStale
    ? 'border-amber-800/50 bg-amber-950/20'
    : 'border-zinc-800 bg-zinc-900';

  const dotClass = isError
    ? 'bg-red-400'
    : isDegraded || isStale
    ? 'bg-amber-400'
    : 'bg-emerald-400';

  const statusText = isError ? 'Error' : isDegraded ? 'No usable rows' : isStale ? 'Fetch overdue' : 'Fetched';
  const statusTextClass = isError
    ? 'text-red-400'
    : isDegraded || isStale
    ? 'text-amber-400'
    : 'text-emerald-400';

  return (
    <div className={`border rounded-lg p-4 ${containerClass}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-zinc-200">{source.name}</h3>
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
      </div>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-zinc-500">{source.date_kind === 'benchmark_edition' ? 'Benchmark edition' : 'Publication date'}</span>
          <span className="text-zinc-400">{source.data_date ?? 'Unknown'}</span>
        </div>
        {source.historical && <p className="text-amber-400">Historical dataset; a fresh fetch does not update its benchmark edition.</p>}
        <div className="flex justify-between">
          <span className="text-zinc-500">Last fetch</span>
          <span className={`${isStale ? 'text-amber-400' : 'text-zinc-400'}`}>
            {timeSince}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Models</span>
          <span className="text-zinc-400">{source.count}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Status</span>
          <span className={statusTextClass} title={isDegraded ? 'Reachable but returned no usable rows' : undefined}>
            {statusText}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Latency</span>
          <span className="text-zinc-400">{source.duration_ms}ms</span>
        </div>
        {source.error && (
          <div className="mt-2 p-2 rounded bg-red-950/30 border border-red-900/30">
            <span className="text-red-400 text-[10px] break-all">{source.error}</span>
          </div>
        )}
        {isDegraded && !source.error && (
          <div className="mt-2 p-2 rounded bg-amber-950/30 border border-amber-900/30">
            <span className="text-amber-400 text-[10px]">Degraded — reachable but returned no usable rows</span>
          </div>
        )}
        {isStale && (
          <div className="mt-2 p-2 rounded bg-amber-950/30 border border-amber-900/30">
            <span className="text-amber-400 text-[10px]">Data is stale — refresh needed</span>
          </div>
        )}
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block mt-2 text-zinc-500 hover:text-zinc-300 truncate"
        >
          {source.url}
        </a>
      </div>
    </div>
  );
}

function formatTimeSince(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
