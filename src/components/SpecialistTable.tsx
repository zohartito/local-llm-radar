'use client';

import { ReleaseDate } from './ReleaseDate';
import { Fragment, useMemo, useState } from 'react';
import { matchesSpecialistSearch, type SpecialistRow } from '@/lib/model-types';
import { specialistColumns, sortSpecialistRows } from '@/lib/specialist-columns';
import { rankSpecialistByColumn, specialistCardColumns, specialistDisplayName, specialistEvidence, specialistMetricDisplay } from '@/lib/specialist-presentation';
import { benchmarkColorClass, leaderboardStyles, providerButtonClass, rankingCardClass } from './leaderboard-presentation';

interface Props {
  rows: SpecialistRow[];
  metric: string;
  direction: 'asc' | 'desc';
  unit: string;
  sourceUrl: string;
  boardId?: string;
}
const PAGE_SIZE = 50;

export function SpecialistTable({ rows, metric, direction, unit, sourceUrl, boardId }: Props) {
  const [query, setQuery] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [provider, setProvider] = useState('all');
  const [architecture, setArchitecture] = useState('all');
  const [individualTests, setIndividualTests] = useState(false);
  const [sort, setSort] = useState({ id: 'score', direction });
  const [rankingId, setRankingId] = useState('score');
  const [page, setPage] = useState(0);
  const columns = useMemo(() => specialistColumns(rows, metric, direction, unit, boardId, individualTests), [rows, metric, direction, unit, boardId, individualTests]);
  const primary = columns.find(column => column.id === 'score')!;
  const sortColumn = columns.find(column => column.id === sort.id) ?? primary;
  const rankColumn = columns.find(column => column.id === rankingId) ?? primary;
  const sortDirection = sortColumn.id === sort.id ? sort.direction : direction;
  const types = [...new Set(rows.map(row => row.details.Type).filter((type): type is string => typeof type === 'string'))].sort();
  const visibleRows = rows.filter(row => (!openOnly || row.openWeights === true) && (architecture === 'all' || row.details.Type === architecture));
  const providerCounts = new Map<string, number>();
  for (const row of visibleRows) if (row.provider) providerCounts.set(row.provider, (providerCounts.get(row.provider) ?? 0) + 1);
  const leadingProviders = sortSpecialistRows(visibleRows, primary, direction).filter(row => row.score !== null).slice(0, 20).map(row => row.provider).filter(Boolean);
  const providers = [...new Set([...leadingProviders, ...[...providerCounts.keys()].sort((a, b) => providerCounts.get(b)! - providerCounts.get(a)! || a.localeCompare(b))])];
  const shownProviders = providers.slice(0, 18).sort((a, b) => a.localeCompare(b));
  const otherProviders = providers.slice(18).sort((a, b) => a.localeCompare(b));
  const scoped = visibleRows.filter(row => provider === 'all' || row.provider === provider);
  const ranked = rankSpecialistByColumn(scoped, rankColumn);
  const filtered = sortSpecialistRows(ranked, sortColumn, sortDirection).filter(row => matchesSpecialistSearch(row, query));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const hasTasks = rows.some(row => Object.keys(row.benchmarks ?? {}).some(key => key.startsWith('task:')));
  const cards = specialistCardColumns(columns).map(column => ({ column, leader: sortSpecialistRows(scoped, column, column.direction).find(row => typeof column.value(row) === 'number') }));
  const ranges = new Map(columns.filter(column => column.quality).map(column => {
    const values = visibleRows.map(row => column.value(row)).filter((value): value is number => typeof value === 'number');
    return [column.id, { best: values.length ? (column.direction === 'asc' ? Math.min(...values) : Math.max(...values)) : 0, worst: values.length ? (column.direction === 'asc' ? Math.max(...values) : Math.min(...values)) : 0 }];
  }));
  const chooseColumn = (id: string, toggle: boolean) => {
    const column = columns.find(value => value.id === id)!;
    setSort({ id, direction: toggle && sortColumn.id === id ? sortDirection === 'desc' ? 'asc' : 'desc' : column.direction });
    if (column.quality) setRankingId(id);
    setPage(0);
  };
  const filterProvider = (value: string) => { setProvider(value === provider ? 'all' : value); setPage(0); };
  const header = (column: typeof primary) => <th key={column.id} scope="col" aria-sort={sortColumn.id === column.id ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} title={`${column.description}${column.unit ? ` Units: ${column.unit}.` : ''}`} className={`px-2 py-2 text-center font-medium min-w-[65px] ${column.id === 'score' ? 'min-w-[95px] text-emerald-400 border-l-2 border-l-emerald-500/40 bg-emerald-950/20' : 'text-zinc-400'}`}>
    <button type="button" onClick={() => chooseColumn(column.id, true)} className="cursor-pointer hover:text-emerald-300 max-w-36" aria-label={`Sort by ${column.label}`}>
      {column.id === 'detail:Parameters (B)' ? 'Params' : column.id === 'detail:Max tokens' ? 'Ctx' : column.label}{sortColumn.id === column.id ? sortDirection === 'desc' ? ' ↓' : ' ↑' : ''}
    </button>
  </th>;
  return <section aria-label="Leaderboard results">
    <div className="flex flex-wrap items-center gap-4 mb-6 text-xs text-zinc-500">
      <span className="text-zinc-400 font-medium">Scores:</span>
      {[['text-emerald-400 border-emerald-500/40 bg-emerald-500/20', 'High'], ['text-zinc-300 border-zinc-500/40 bg-zinc-500/20', 'Mid'], ['text-red-400 border-red-500/40 bg-red-500/20', 'Low']].map(([color, label]) => <span key={label} className="flex items-center gap-1" title="Relative to published values in the same benchmark column; not a universal model tier"><span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${color}`}>●</span>{label}</span>)}
      <span className="text-[10px] text-zinc-600">Within each benchmark</span><span className="ml-auto text-zinc-600">Click any column header to sort · <a href="/releases" className="hover:text-emerald-400 underline">Release dates & sources</a></span>
    </div>
    <div id="leaderboard-rankings" className="mb-4 scroll-mt-4">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Rank by use case</div>
      <div className={`grid grid-cols-2 md:grid-cols-3 ${cards.length === 6 ? 'lg:grid-cols-6' : cards.length === 5 ? 'lg:grid-cols-5' : cards.length === 4 ? 'lg:grid-cols-4' : cards.length === 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-3'} gap-2 mb-4`}>
        {cards.map(({ column, leader }) => <button key={column.id} type="button" aria-pressed={sortColumn.id === column.id} onClick={() => chooseColumn(column.id, false)} title={column.description} className={`${rankingCardClass(sortColumn.id === column.id)} min-h-[130px] flex flex-col items-start cursor-pointer`}>
          <div className={`text-[11px] font-semibold ${sortColumn.id === column.id ? 'text-emerald-400' : 'text-zinc-400'} mb-0.5`}>{column.id === 'score' ? 'Best Overall' : column.label}</div>
          <div className="text-[9px] text-zinc-600 mb-1.5">{column.id === 'score' ? metric : column.quality ? `${column.direction === 'asc' ? 'Lower' : 'Higher'} score is better` : column.direction === 'asc' ? 'Lowest reported value' : 'Highest reported value'}</div>
          <div className="w-full text-xs font-semibold text-zinc-200 truncate">{leader ? `${column.quality ? '#1 ' : ''}${specialistDisplayName(leader)}` : 'No reported result'}</div>
          {leader && <div className="text-[9px] text-zinc-500">Released <ReleaseDate value={leader.releaseDate} evidence={leader.releaseEvidence} submission={leader.identityKind === 'submission'} linked={false} /></div>}
          <div className="mt-0.5 text-[9px] text-zinc-600">{leader ? `${specialistMetricDisplay(column, column.value(leader))}${column.unit === '/ 100' ? ' / 100' : ''} · ${scoped.filter(row => column.value(row) !== null).length} models` : 'Missing results stay unranked'}</div>
          <span className="mt-1.5 inline-block text-[9px] text-zinc-500">Rank this table &rarr;</span>
        </button>)}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-1.5 mb-4" role="group" aria-label="Model filters">
      <input type="search" aria-label="Search models" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Search model, provider, or slug..." className={leaderboardStyles.filterInput} />
      <button type="button" aria-pressed={provider === 'all'} onClick={() => { setProvider('all'); setPage(0); }} className={providerButtonClass(provider === 'all')}>All</button>
      {shownProviders.map(value => <button type="button" key={value} aria-pressed={provider === value} onClick={() => filterProvider(value)} className={providerButtonClass(provider === value)}>{value}</button>)}
      {otherProviders.length > 0 && <select aria-label="More providers" value={otherProviders.includes(provider) ? provider : ''} onChange={event => { setProvider(event.target.value || 'all'); setPage(0); }} className="px-2 py-1 max-w-48 rounded bg-zinc-800 text-zinc-400 text-xs"><option value="">More providers</option>{otherProviders.map(value => <option key={value} value={value}>{value}</option>)}</select>}
      <span className="text-zinc-700 mx-1">|</span>
      <button type="button" onClick={() => { setOpenOnly(value => !value); setProvider('all'); setPage(0); }} className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${openOnly ? 'bg-zinc-800 text-zinc-400 hover:text-zinc-200' : 'bg-orange-600 text-white'}`}>{openOnly ? 'Open-weight only' : 'All models'}</button>
      {types.length > 1 && <select aria-label="Architecture" value={architecture} onChange={event => { setArchitecture(event.target.value); setProvider('all'); setPage(0); }} className="px-2 py-1 max-w-48 rounded bg-zinc-800 text-zinc-400 text-xs"><option value="all">All architectures</option>{types.map(type => <option key={type}>{type}</option>)}</select>}
      {hasTasks && <button type="button" aria-pressed={individualTests} onClick={() => setIndividualTests(value => !value)} className={providerButtonClass(individualTests)}>Individual tests</button>}
      <span className="text-[10px] text-zinc-600 ml-auto" aria-live="polite">Ranked by: {rankColumn.label}{sortColumn.quality ? '' : ` · Sorted by ${sortColumn.label}`} ({openOnly ? 'open-weight only' : 'all published models'})</span>
    </div>
    <div className="relative overflow-x-auto border border-zinc-800 rounded-lg" tabIndex={0} role="region" aria-label="Scrollable benchmark comparison">
      <table className={leaderboardStyles.table}>
        <caption className="sr-only">Ranked by {rankColumn.label}, {rankColumn.direction === 'asc' ? 'lower' : 'higher'} is better. Scroll sideways for all benchmarks. Missing scores have no rank.</caption>
        <thead><tr className={leaderboardStyles.headRow}>
          <th scope="col" className="px-2 py-2 text-center text-zinc-500 font-medium w-8">#</th>
          <th scope="col" className="px-3 py-2 text-left text-zinc-400 font-medium sticky left-0 bg-zinc-900/95 z-10 min-w-[180px]">Model</th>
          {columns.map(column => <Fragment key={column.id}>{header(column)}{column.id === 'score' && <th scope="col" className="px-2 py-2 text-center text-zinc-400 font-medium min-w-[64px]" title="Reported test coverage, not independent evaluation or confidence. Open for provenance.">Evidence</th>}</Fragment>)}
        </tr></thead>
        <tbody>{filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((row, index) => {
          const closed = row.openWeights === false;
          const evidence = specialistEvidence(row, columns);
          const filled = evidence.total ? Math.round(evidence.reported / evidence.total * 5) : 0;
          return <tr key={row.id} className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${closed ? 'bg-orange-950/10' : index % 2 === 0 ? '' : 'bg-zinc-900/30'}`}>
            <td className={`${leaderboardStyles.cell} text-zinc-500 font-medium`}>{row.rank ?? '—'}</td>
            <th scope="row" className={`px-3 py-1.5 text-left font-normal sticky left-0 z-10 max-w-[260px] ${closed ? 'bg-orange-950/20' : 'bg-zinc-950/95'}`}>
              <div className="flex items-center gap-2">
                <span title={closed ? 'Closed weights' : row.openWeights ? 'Downloadable weights confirmed by source' : 'Weights access unconfirmed'} className={`inline-flex shrink-0 items-center justify-center w-5 h-5 rounded text-[8px] font-bold border ${closed ? 'bg-orange-500/20 text-orange-300 border-orange-500/40' : row.openWeights ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-zinc-500/20 text-zinc-400 border-zinc-500/40'}`}>{closed ? '$$' : row.openWeights ? '↓' : '?'}</span>
                <div><div className="flex items-center gap-1.5">
                  <a href={row.url ?? sourceUrl} title={row.name} target="_blank" rel="noopener noreferrer" className={`${closed ? 'text-orange-200/80' : 'text-zinc-200'} hover:text-emerald-400 font-medium break-words`}>{specialistDisplayName(row)}</a>
                  {closed && <span className="text-[8px] px-1 py-0.5 rounded bg-orange-500/15 text-orange-400 border border-orange-500/25">CLOSED</span>}
                  {(row.inputModalities?.length ?? 0) > 1 && <span title={row.inputModalities!.join(', ')} className="text-[9px] px-1 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">MULTI</span>}
                  {row.details.Experiment && <span title={String(row.details.Experiment)} className="text-[8px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">CONFIG</span>}
                </div><div className="text-[10px] text-zinc-600">{row.provider || 'Provider not reported'}</div></div>
              </div>
            </th>
            {columns.map(column => {
              const value = column.value(row);
              const range = ranges.get(column.id);
              const color = value === null ? 'text-zinc-700' : column.id === 'score' ? 'text-zinc-300 text-sm' : column.quality && typeof value === 'number' && range ? benchmarkColorClass(value, range.best, range.worst) : 'text-zinc-500';
              return <Fragment key={column.id}>
                <td title={value === null ? column.id === 'release' ? 'Release date not reported' : 'No result reported' : `${column.label}: ${value}${column.unit ? ` ${column.unit}` : ''}`} className={`${leaderboardStyles.cell} ${color} ${column.id === 'score' ? 'border-l-2 border-l-emerald-500/40 bg-emerald-950/10' : ''} ${column.numeric ? 'whitespace-nowrap' : 'text-[10px] max-w-[100px] truncate'}`}>{column.id === 'release' ? <ReleaseDate value={row.releaseDate} evidence={row.releaseEvidence} submission={row.identityKind === 'submission'} /> : specialistMetricDisplay(column, value)}</td>
                {column.id === 'score' && <td className="px-2 py-1.5 text-zinc-500">
                  <details><summary className="cursor-pointer list-none" aria-label={`Evidence for ${row.name}`} title={`${evidence.reported}/${evidence.total} ${evidence.label}. Click for details.`}>
                    <span className="flex items-center justify-center gap-1.5"><span className="flex items-center gap-0.5" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <span key={i} className={`w-1 h-2.5 rounded-sm ${i < filled ? 'bg-sky-400/80' : 'bg-zinc-800'}`} />)}</span><span className="w-2 h-2 rounded-full bg-zinc-500" aria-hidden="true" /></span>
                  </summary>
                    <div className="w-56 mt-2 text-[10px] text-left"><p>{evidence.reported}/{evidence.total} {evidence.label}.</p><dl className="mt-2 space-y-1">{Object.entries(row.details).map(([key, detail]) => <div key={key} className="break-words"><dt className="inline text-zinc-500">{key}: </dt><dd className="inline text-zinc-300">{detail}</dd></div>)}</dl><a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-emerald-400">Benchmark source ↗</a></div>
                  </details>
                </td>}
              </Fragment>;
            })}
          </tr>;
        })}</tbody>
      </table>
      {filtered.length === 0 && <p className="p-8 text-center text-sm text-zinc-400">{openOnly && !visibleRows.length ? 'This source does not confirm downloadable weights. Select All models to see its results.' : 'No models match these filters.'}</p>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
      <span className="text-[10px] text-zinc-500" aria-live="polite">Showing {filtered.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} models</span>
      {pageCount > 1 && <div className="flex gap-1">{[['First', 0], ['Prev', currentPage - 1], ['Next', currentPage + 1], ['Last', pageCount - 1]].map(([label, target], index) => <Fragment key={label}>{index === 2 && <span className="px-2 py-1 text-[10px] text-zinc-500">Page {currentPage + 1} of {pageCount}</span>}<button type="button" disabled={Number(target) < 0 || Number(target) >= pageCount || Number(target) === currentPage} onClick={() => setPage(Number(target))} className="px-2 py-1 rounded text-[10px] bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-default cursor-pointer">{label}</button></Fragment>)}</div>}
    </div>
    <div className="mt-4 space-y-1 text-[10px] text-zinc-600">
      <p>Click a ranking card or benchmark header to rank that test. Search keeps those ranks; provider, architecture, and access filters rank the selected group. Missing scores stay unranked.</p>
      <p>Colors compare published values within each column, respecting whether higher or lower is better. Evidence bars show reported coverage, not confidence or independent evaluations. Different tests are never averaged.</p>
      <p>↓ confirms downloadable weights; $$ means closed weights; ? means access is unconfirmed. Check the model license before use. Scores are rounded for display and sorted at full precision.</p>
    </div>
  </section>;
}
