'use client';

import { useState } from 'react';
import Link from 'next/link';
import { EMBEDDING_TESTS, embeddingRows, type EmbeddingSnapshot } from '@/lib/embedding-catalog';
import { getSpecialistBoard, INPUT_LABELS, type InputModality } from '@/lib/model-types';
import { SpecialistTable } from './SpecialistTable';
import { SpecialistHeader, SpecialistRankingBanner } from './leaderboard-presentation';

const views = [
  { id: 'text', label: 'Text', test: 'embeddings' },
  { id: 'mixed', label: 'Multimodal / mixed input', test: 'embeddings' },
  { id: 'images', label: 'Images', test: 'image-embeddings' },
  { id: 'audio', label: 'Audio', test: 'audio-embeddings' },
  { id: 'video', label: 'Video', test: 'video-embeddings' },
  { id: 'documents', label: 'Document pages', test: 'document-retrieval' },
  { id: 'code', label: 'Code', test: 'code-embeddings' },
];

export function EmbeddingExplorer({ snapshots, initialView }: { snapshots: EmbeddingSnapshot[]; initialView: string }) {
  const initial = views.find(view => view.id === initialView) ?? views[0];
  const [view, setView] = useState(initial.id);
  const [test, setTest] = useState(initial.test);
  const [inputs, setInputs] = useState<InputModality[]>(['text', 'image', 'audio', 'video']);
  const mixed = view === 'mixed';
  const snapshot = snapshots.find(value => value.boardId === test)!;
  const board = getSpecialistBoard(test)!;
  const rows = embeddingRows(snapshots, test, mixed, inputs);
  const unavailable = snapshots.filter(value => value.status !== 'source' || value.stale);

  return <div>
    <nav aria-label="Embedding type" className="flex flex-wrap items-center gap-1 pt-3">
      {views.map(option => <button key={option.id} type="button" aria-pressed={view === option.id} onClick={() => { setView(option.id); setTest(option.test); }} className={`px-2.5 py-1 rounded text-xs transition-colors ${view === option.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'}`}>{option.label}</button>)}
      {view === 'text' && <select aria-label="Languages" value={test} onChange={event => setTest(event.target.value)} className="ml-auto h-6 rounded bg-zinc-900 border border-zinc-800 px-2 text-xs text-zinc-400"><option value="embeddings">Many languages</option><option value="embeddings-english">English</option></select>}
    </nav>
    <div className="py-8">
    <SpecialistHeader title="Embedding leaderboard" checkedAt={snapshot.checkedAt} status={snapshot.status} stale={snapshot.stale} description={<>
      Compare embedding models for search, retrieval, and similarity. Multimodal models accept several input types, including EmbeddingGemma 2 used by DigUp. Results from <a href={board.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400">{board.benchmark}</a> are shown alongside separate tests; choose a ranking to find the leaders for your task.
    </>} />
    {mixed && <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-6 text-xs text-zinc-400">
      <fieldset className="flex flex-wrap items-center gap-3"><legend className="sr-only">Must accept</legend><span>Must accept:</span>{(Object.keys(INPUT_LABELS) as InputModality[]).map(input => <label key={input} className="flex items-center gap-1.5"><input type="checkbox" className="accent-emerald-400" checked={inputs.includes(input)} onChange={event => setInputs(current => event.target.checked ? [...current, input] : current.filter(value => value !== input))} />{INPUT_LABELS[input]}</label>)}</fieldset>
      <label className="flex items-center gap-2">Rank by test<select className="min-w-0 max-w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1" value={test} onChange={event => setTest(event.target.value)}>{EMBEDDING_TESTS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
    </div>}
    <SpecialistRankingBanner />
    {snapshot.status !== 'source' || snapshot.stale ? <p role="status" className="mb-4 text-xs text-amber-200">{snapshot.status === 'unavailable' ? 'This test is unavailable. No saved scores are available.' : 'Showing saved or older results for this test. See source dates below.'}</p> : null}
    {unavailable.some(value => value.boardId !== test) && <p className="mb-4 text-xs text-amber-200">Some other tests use saved results or are unavailable. Check “Sources & test details” for each date.</p>}
    <SpecialistTable key={view} boardId={test} rows={rows} metric={`${board.benchmark.split('(')[0]} score`} direction="desc" unit="/ 100" sourceUrl={board.sourceUrl} />

    <details className="mt-6 rounded-lg border border-zinc-800 p-4 text-xs text-zinc-400">
      <summary className="cursor-pointer font-medium text-zinc-200">Sources & test details</summary>
      <div className="mt-4 space-y-4">
        <p>{board.caveat} These tests cover several embedding tasks, not just file search. A missing or incomplete evaluation has no rank.</p>
        <p>Mixed-input models accept at least two input types. Accepted inputs do not guarantee every combination works together in a single request. Input labels come from MTEB model metadata, not from which leaderboard a model appears on. Mixed-input results join identical model and experiment IDs across tests. Scores from different tests are never averaged.</p>
        <ul className="space-y-2">{snapshots.map(source => <li key={source.boardId}><a className="text-emerald-400 hover:underline" href={getSpecialistBoard(source.boardId)!.sourceUrl} target="_blank" rel="noopener noreferrer">{source.benchmark} ↗</a> · {source.status === 'source' ? source.stale ? 'Older cached response' : 'Source response' : source.status === 'saved' ? 'Saved snapshot' : 'Unavailable'} · checked {source.checkedAt ? new Date(source.checkedAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'never'}</li>)}</ul>
        <p>Sources refresh on request with an hourly cache. Check dates describe when we retrieved results; overall evaluation dates are unavailable in these feeds.</p>
      </div>
    </details>
    <p className="mt-4 text-xs text-zinc-400">Already have search working? <Link href="/leaderboards/rerankers" className="text-emerald-400 hover:underline">Compare rerankers</Link> to improve the order of your search results.</p>
    </div>
  </div>;
}
