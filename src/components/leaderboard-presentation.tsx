import type { ReactNode } from 'react';

/** Shared presentation for the text dashboard and specialist leaderboards. */
const cardColors: Record<string, string> = {
  emerald: 'border-emerald-700/60 bg-emerald-950/30 ring-1 ring-emerald-500/30',
  sky: 'border-sky-700/60 bg-sky-950/30 ring-1 ring-sky-500/30',
  rose: 'border-rose-700/60 bg-rose-950/30 ring-1 ring-rose-500/30',
  violet: 'border-violet-700/60 bg-violet-950/30 ring-1 ring-violet-500/30',
  amber: 'border-amber-700/60 bg-amber-950/30 ring-1 ring-amber-500/30',
  teal: 'border-teal-700/60 bg-teal-950/30 ring-1 ring-teal-500/30',
};
export function rankingCardClass(active: boolean, color = 'emerald') {
  return `border rounded-lg p-2.5 text-left transition-all ${active ? cardColors[color] ?? cardColors.emerald : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'}`;
}
export function providerButtonClass(active: boolean) {
  return `px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${active ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`;
}
export function benchmarkColorClass(value: number, best: number, worst: number) {
  const ratio = best !== worst ? (value - worst) / (best - worst) : 0.5;
  return ratio >= 0.8 ? 'text-emerald-400 font-medium' : ratio >= 0.6 ? 'text-emerald-500/80' : ratio >= 0.4 ? 'text-zinc-300' : ratio >= 0.2 ? 'text-orange-400/80' : 'text-red-400/80';
}
export const leaderboardStyles = {
  table: 'w-full text-xs',
  headRow: 'border-b border-zinc-800 bg-zinc-900/80',
  cell: 'px-2 py-1.5 text-center tabular-nums',
  filterInput: 'px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs placeholder:text-zinc-600 focus:border-zinc-600 focus:ring-1 focus:ring-emerald-500/20 min-w-[240px]',
};

export function SpecialistHeader({ title, description, checkedAt, status, stale }: { title: string; description: ReactNode; checkedAt: string | null; status: string; stale: boolean }) {
  return <div className="mb-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h1 className="text-2xl font-bold text-zinc-100">{title}</h1>
      <span title="Retrieval date, not the date models were evaluated" className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border ${status !== 'source' || stale ? 'text-amber-300 border-amber-700/50 bg-amber-950/30' : 'text-emerald-300 border-emerald-700/40 bg-emerald-950/30'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${status !== 'source' || stale ? 'bg-amber-400' : 'bg-emerald-400'}`} />
        {status === 'unavailable' ? 'Source unavailable' : `${status === 'saved' ? 'Saved results' : stale ? 'Older results' : 'Source checked'} · ${checkedAt?.slice(0, 10) ?? 'Unknown date'}`}
      </span>
    </div>
    <p className="text-sm text-zinc-500 mt-1">{description}</p>
  </div>;
}

export function SpecialistRankingBanner() {
  return <a href="#leaderboard-rankings" className="mb-6 flex items-center gap-3 bg-gradient-to-r from-emerald-900/40 to-sky-900/40 border border-emerald-700/40 rounded-lg p-4 hover:border-emerald-600/60 transition-colors group">
    <div className="w-10 h-10 rounded-lg bg-emerald-600/30 flex items-center justify-center text-lg shrink-0">&#9776;</div>
    <div className="flex-1"><div className="text-sm font-semibold text-zinc-100 group-hover:text-emerald-300 transition-colors">Which models are best for your task?</div><div className="text-xs text-zinc-500">Choose a ranking below, then compare scores, benchmarks, and model details together.</div></div>
    <span className="text-zinc-500 group-hover:text-emerald-400 transition-colors text-lg">&rarr;</span>
  </a>;
}
