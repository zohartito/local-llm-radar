import Link from 'next/link';
import saved from '../../../data/specialist-snapshots.json';
import { getLeaderboardData } from '@/lib/leaderboard-service';
import { SPECIALIST_BOARDS, type SpecialistSnapshot } from '@/lib/model-types';
import { compareReleaseDates } from '@/lib/model-release';
import { releaseCoverage, releaseInventory } from '@/lib/release-inventory';
import { ReleaseDate } from '@/components/ReleaseDate';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Model release dates | Local LLM Radar' };
const statuses = { reviewed: 'Primary source reviewed', reported: 'Source reported', unknown: 'Unknown', submission: 'Submission · not a model release' };

export default async function ReleasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const query = value('q'), board = value('board'), status = value('status');
  const { data } = await getLeaderboardData();
  const inventory = releaseInventory(saved as SpecialistSnapshot[], data.models);
  const scope = inventory.filter(row => (!board || row.boardId === board) && row.name.toLowerCase().includes(query.toLowerCase()));
  const counts = releaseCoverage(scope);
  const filtered = scope.filter(row => !status || row.status === status).sort((a, b) => compareReleaseDates(a.date, b.date, 'desc') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(filtered.length / 100));
  const page = Math.min(pages, Math.max(1, Number.parseInt(value('page'), 10) || 1));
  const pageLink = (target: number) => `/releases?${new URLSearchParams({ q: query, board, status, page: String(target) })}`;
  const snapshotDates = [...new Set(saved.map(snapshot => snapshot.checkedAt.slice(0, 10)))].sort();
  return <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-5">
    <header><h1 className="text-2xl font-bold">Model release dates</h1><p className="mt-2 text-sm text-zinc-400">Find when a model became available and check the evidence. Reviewed dates link to primary announcements or weights releases. Other dates remain labeled as source reported or unknown.</p></header>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">{Object.entries(statuses).map(([key, label]) => <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"><p className="text-xs text-zinc-400">{label}</p><p className="text-xl tabular-nums text-emerald-400 mt-1">{counts[key as keyof typeof counts]}</p></div>)}</div>
    <form action="/releases" className="flex flex-wrap gap-2 items-end">
      <label className="text-xs text-zinc-400 flex flex-col gap-1 grow">Search models<input name="q" defaultValue={query} placeholder="Model name" className="px-3 py-2 bg-zinc-900 rounded border border-zinc-800 text-sm text-zinc-200" /></label>
      <label className="text-xs text-zinc-400 flex flex-col gap-1">Board<select name="board" defaultValue={board} className="max-w-64 px-2 py-2 bg-zinc-900 rounded border border-zinc-800 text-sm"><option value="">All boards</option><option value="text">Text / LLMs</option>{SPECIALIST_BOARDS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="text-xs text-zinc-400 flex flex-col gap-1">Date evidence<select name="status" defaultValue={status} className="px-2 py-2 max-w-64 bg-zinc-900 rounded border border-zinc-800 text-sm"><option value="">All</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm">Apply filters</button><Link href="/releases" className="px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200">Reset</Link>
    </form>
    <p className="text-xs text-zinc-500">{filtered.length} board entries · newest known dates first · a model can appear in several tests. Specialist inventory uses saved captures from {snapshotDates[0]}–{snapshotDates.at(-1)}; open a board for its current results. Text inventory: {data.usedFallback ? 'saved fallback' : data.stale ? 'cached / stale' : 'current cached roster'}. A source check is not a model release.</p>
    <div className="overflow-x-auto rounded-lg border border-zinc-800" tabIndex={0} role="region" aria-label="Model release date comparison"><table className="w-full text-xs"><thead className="bg-zinc-900 text-zinc-400"><tr>{['Model', 'Board', 'Released', 'Evidence', 'Source / notes'].map(label => <th scope="col" key={label} className="p-3 text-left font-medium">{label}</th>)}</tr></thead>
      <tbody>{filtered.slice((page - 1) * 100, page * 100).map(row => <tr key={row.id} className="border-t border-zinc-800 hover:bg-zinc-900/50"><th scope="row" className="p-3 text-left font-medium min-w-44"><Link href={row.href} className="hover:text-emerald-400">{row.name}</Link></th><td className="p-3 text-zinc-400">{row.board}</td><td className="p-3 text-zinc-400"><ReleaseDate value={row.date} evidence={row.evidence} submission={row.status === 'submission'} /></td><td className={`p-3 ${row.status === 'reviewed' ? 'text-emerald-400' : 'text-zinc-500'}`}>{statuses[row.status]}</td><td className="p-3 min-w-52 max-w-sm text-zinc-500">{row.evidence?.note ?? (row.status === 'submission' ? 'See the benchmark submission date on its board.' : row.date ? 'Reported by the upstream catalog; not independently verified.' : 'No supported release date found in the captured sources.')}{row.sourceUrl && <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="block mt-1 text-emerald-400 hover:underline">{row.evidence ? 'Primary release source' : 'Model / benchmark source'} ↗</a>}</td></tr>)}</tbody></table>
      {!filtered.length && <p className="p-8 text-center text-zinc-500">No entries match these filters.</p>}
    </div>
    <div className="flex gap-4 items-center text-xs text-zinc-400">{page > 1 && <Link href={pageLink(page - 1)} className="text-emerald-400">← Previous</Link>}<span>Page {page} of {pages}</span>{page < pages && <Link href={pageLink(page + 1)} className="text-emerald-400">Next →</Link>}</div>
    <p className="text-xs text-zinc-500">Paper dates, repository creation, benchmark submissions and check timestamps are never used as substitutes for model release dates. The release audit tool rechecks reviewed sources and produces a queue of missing dates; newly discovered dates require source review before publication.</p>
  </div>;
}
