import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSpecialistBoard, SPECIALIST_BOARDS } from '@/lib/model-types';
import { getSpecialistData } from '@/lib/specialist-service';
import { SpecialistTable } from '@/components/SpecialistTable';
import { SpecialistHeader, SpecialistRankingBanner } from '@/components/leaderboard-presentation';
import { creditForBoardSource } from '@/lib/source-credits';

export const dynamic = 'force-dynamic';
export const dynamicParams = false;

export function generateStaticParams() {
  return SPECIALIST_BOARDS.map(board => ({ type: board.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }): Promise<Metadata> {
  const { type } = await params;
  const name = getSpecialistBoard(type)?.name;
  return { title: `${name ?? 'Leaderboard not found'} | Local LLM Radar` };
}

export default async function SpecialistPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const board = getSpecialistBoard(type);
  if (!board) notFound();
  const snapshot = await getSpecialistData(type);
  if (!snapshot) notFound();
  const old = snapshot.stale;
  const credit = creditForBoardSource(board.source);
  return <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <SpecialistHeader title={`${board.name} leaderboard`} checkedAt={snapshot.checkedAt} status={snapshot.status} stale={snapshot.stale} description={<>
      {board.description} Compare published results from <a href={board.sourceUrl} className="hover:text-emerald-400" target="_blank" rel="noopener noreferrer">{board.source} · {board.benchmark}</a>. Choose a ranking below to compare the models by score, with the available benchmark numbers and specifications together.
    </>} />
    {board.scopeNote && <p className="mb-5 text-xs text-zinc-400">{board.scopeNote}</p>}
    <SpecialistRankingBanner />
    {(snapshot.status !== 'source' || old) && <p role="status" className="mb-4 text-xs text-amber-200">{snapshot.status === 'unavailable' ? 'Source unavailable. No saved results for this test.' : 'Showing saved or older results. See source details below.'}</p>}
    <SpecialistTable key={type} boardId={type} rows={snapshot.rows} metric={board.metric} direction={board.direction} unit={board.unit} sourceUrl={board.sourceUrl} />
    {credit && <p className="mt-3 text-xs text-zinc-500">Data: <a href={board.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-emerald-400">{board.source}</a> · <a href={credit.termsUrl} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-emerald-400">{credit.licence}</a>{credit.note ? ` · ${credit.note}` : ''} · <a href="/sources" className="text-zinc-400 hover:text-emerald-400">All sources &amp; licences</a></p>}
    <details className="mt-6 rounded-xl border border-zinc-800 p-5">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-200 mb-2">Sources & how to read this ranking</summary>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-zinc-200">{board.benchmark}</p>
        <a href={board.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-emerald-400 hover:underline">Source: {board.source} ↗</a>
      </div>
      <p className={`text-xs ${snapshot.status !== 'source' || old ? 'text-amber-300' : 'text-zinc-400'}`}>
        {snapshot.status === 'saved' ? 'Source unavailable or changed — showing a saved snapshot.' : snapshot.status === 'unavailable' ? 'Source unavailable. No saved results for this benchmark edition.' : old ? 'Cached source response is older than 24 hours; refresh may be delayed.' : 'Source response · refreshes on demand (1-hour cache).'}
        {snapshot.checkedAt && ` Last successful check: ${new Date(snapshot.checkedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC.`}
      </p>
      <p className="text-xs text-zinc-500">{snapshot.sourceUpdatedAt ? `Source publication date: ${snapshot.sourceUpdatedAt.slice(0, 10)}.` : 'Overall evaluation/publication date unavailable in this data feed.'} A source check does not mean the models were evaluated today.</p>
    </div>

      <p className="text-sm leading-6 text-zinc-400">{board.caveat}</p>
      <p className="text-xs text-zinc-500 mt-3">Scores are published by the linked evaluator; Local LLM Radar has not rerun these evaluations. This board is separate from the text Capability Score and its hardware estimates.</p>
    </details>
  </div>;
}
