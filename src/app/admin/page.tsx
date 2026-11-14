'use client';

import { useState, useEffect } from 'react';
import { DataLoadError } from '@/components/DataLoadError';
import { SourceHealthCard } from '@/components/SourceHealthCard';
import type { LeaderboardSourceStatus } from '@/lib/leaderboard';

interface SourcesResponse {
  cronRefresh?: { lastAttempt: { attemptedAt: string; refreshed: boolean } | null; lastSuccess: { attemptedAt: string } | null };
  fallbackCellCount?: number | null;
  sources: LeaderboardSourceStatus[];
  staleSources: LeaderboardSourceStatus[];
  stats: {
    total_models: number;
    open_weight_models: number;
    closed_models: number;
    total_benchmarks: number;
  };
}

export default function AdminPage() {
  const [data, setData] = useState<SourcesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cronSecret, setCronSecret] = useState('');
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await fetch('/api/sources');
      if (!res.ok) throw new Error('Sources unavailable');
      const response = await res.json() as SourcesResponse;
      setData(response);
      setLoading(false);
    }

    void load().catch(() => { setLoadError(true); setLoading(false); });
  }, []);

  async function loadData() {
    setLoading(true);
    const res = await fetch('/api/sources');
    if (!res.ok) { setLoading(false); throw new Error('Sources unavailable'); }
    const response = await res.json() as SourcesResponse;
    setData(response);
    setLoading(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    setRefreshNotice(null);
    try {
      // Refresh authentication is mandatory in every environment. Send the
      // configured secret as x-cron-secret when it is entered.
      const headers: Record<string, string> = {};
      const trimmedSecret = cronSecret.trim();
      if (trimmedSecret) headers['x-cron-secret'] = trimmedSecret;

      const res = await fetch('/api/refresh', { method: 'POST', headers });
      const result = await res.json().catch(() => ({}));

      if (res.status === 401) {
        setRefreshError(
          result?.error
            ? `${result.error}. Enter the CRON_SECRET above and try again.`
            : 'Unauthorized — this refresh endpoint requires a secret. Enter the CRON_SECRET above and try again.'
        );
        return;
      }

      if (!res.ok) {
        setRefreshError(result?.error || `Refresh failed (HTTP ${res.status}).`);
        return;
      }

      console.log('Refresh result:', result);
      setRefreshNotice(
        result?.sourceCount !== undefined
          ? `Refreshed — ${result.sourceCount} sources responded.`
          : 'Refresh complete.'
      );
      await loadData();
    } catch (err) {
      console.error(err);
      setRefreshError(err instanceof Error ? err.message : 'Refresh request failed.');
    } finally {
      setRefreshing(false);
    }
  }

  if (loadError) return <DataLoadError />;

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-800 rounded w-48" />
          <div className="grid grid-cols-3 gap-4">
            {[1,2,3].map(i => <div key={i} className="h-32 bg-zinc-900 rounded-lg" />)}
          </div>
        </div>
      </div>
    );
  }

  const staleSlugs = new Set((data?.staleSources || []).map((source) => source.id));

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-wrap gap-4 items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Source Health & Admin</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Text leaderboard sources and nightly refresh. Specialist boards report their own source or saved-snapshot status on each board.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={cronSecret}
            onChange={(e) => setCronSecret(e.target.value)}
            placeholder="CRON_SECRET (required)"
            aria-label="CRON_SECRET"
            className="px-3 py-2 rounded-lg text-sm bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 w-48"
          />
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors cursor-pointer"
          >
            {refreshing ? 'Refreshing...' : 'Run Refresh'}
          </button>
        </div>
      </div>

      {refreshError && (
        <div className="mb-6 px-4 py-3 rounded-lg border border-red-900/60 bg-red-950/40 text-sm text-red-300">
          {refreshError}
        </div>
      )}
      {refreshNotice && (
        <div className="mb-6 px-4 py-3 rounded-lg border border-emerald-900/60 bg-emerald-950/40 text-sm text-emerald-300">
          {refreshNotice}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="text-xs text-zinc-500">Total Models</div>
          <div className="text-2xl font-bold text-zinc-200">{data?.stats?.total_models || 0}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="text-xs text-zinc-500">Open-Weight</div>
          <div className="text-2xl font-bold text-emerald-400">{data?.stats?.open_weight_models || 0}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="text-xs text-zinc-500">Closed / unverified weights</div>
          <div className="text-2xl font-bold text-amber-400">{data?.stats?.closed_models || 0}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="text-xs text-zinc-500">Benchmark Results</div>
          <div className="text-2xl font-bold text-zinc-200">{data?.stats?.total_benchmarks || 0}</div>
        </div>
      </div>

      {/* Source health */}
      <div className="mb-6 rounded-lg border border-zinc-800 p-4 text-sm text-zinc-400">
        <p>Last successful cron refresh: {data?.cronRefresh?.lastSuccess?.attemptedAt ?? 'No receipt available'}</p>
        <p>Last recorded attempt: {data?.cronRefresh?.lastAttempt ? `${data.cronRefresh.lastAttempt.attemptedAt} — ${data.cronRefresh.lastAttempt.refreshed ? 'fetched' : 'failed or deferred'}` : 'Unknown'}</p>
        <p>Curated fallback cells in this snapshot: {data?.fallbackCellCount ?? 'Unknown'}</p>
        <p className="mt-2 text-xs">Scheduled and manually triggered cron runs share this receipt; it does not identify which triggered the run. A receipt proves that a fetch completed, not that all benchmark results are current or independently verified.</p>
      </div>
      <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Data Sources</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {(data?.sources || []).map((source) => (
          <SourceHealthCard
            key={source.id}
            source={source}
            isStale={staleSlugs.has(source.id)}
          />
        ))}
      </div>

      <div className="mt-8 p-4 rounded-lg border border-zinc-800 bg-zinc-900/50">
        <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Pipeline Notes</h3>
        <div className="text-xs text-zinc-500 space-y-1">
          <p>The live leaderboard fetches ZeroEval, recent LLM Stats scorecards, Code Arena, LMArena, legacy LiveBench v1, BFCL, Terminal-Bench, and SWE-bench directly on cache miss.</p>
          <p>Each cell selects a published observation, preferring direct evaluators over aggregators and excluding uncited archived benchmark values, in <code className="bg-zinc-800 px-1 rounded">src/lib/merge-models.ts</code>.</p>
          <p>The sole Vercel cron is configured to warm <code className="bg-zinc-800 px-1 rounded">/api/refresh/cron</code> daily at 09:00 UTC. The normal cache window is 30 minutes; public reads can also refresh expired data.</p>
          <p>Source status reflects the displayed snapshot. The latest cron attempt and success are stored separately when Redis is configured; a schedule alone does not prove execution.</p>
        </div>
      </div>
    </div>
  );
}
