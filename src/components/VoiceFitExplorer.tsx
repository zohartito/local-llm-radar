'use client';

import { useState } from 'react';
import type { VoiceEvidence, VoiceFit, VoiceFitCatalog, VoiceFitRow, VoiceMachineId } from '@/lib/voice-fit';
import { voiceFitForMachine, voiceShortlist, type VoiceIntent } from '@/lib/voice-fit-selection';

const FIT_LABEL: Record<VoiceFit['status'], string> = {
  candidate: 'Test candidate',
  conditional: 'Conditional',
  'over-budget': 'Below stated requirement',
  'not-supported': 'Different platform',
  unknown: 'Unverified',
  'integration-required': 'Integration required',
  measured: 'Local run recorded',
};
const ARCHITECTURE_LABEL: Record<VoiceFitRow['architecture'], string> = {
  'native-full-duplex': 'Native full duplex',
  'cascade-full-duplex': 'Full-duplex cascade',
  'turn-based': 'Turn-based speech',
  'speech-bridge': 'Agent speech bridge',
  asr: 'Speech recognition only',
  tts: 'Speech synthesis only',
};
const TOOL_LABEL: Record<VoiceFitRow['tools']['status'], string> = {
  structured: 'Structured tool calls',
  'external-tools': 'Assistant tools',
  'not-supported': 'Tools not supported',
  'not-established': 'Agent tools unverified',
  'integration-required': 'Real harness required',
};
const PROVENANCE_LABEL: Record<string, string> = {
  published: 'Published claim',
  inference: 'Our inference',
  estimate: 'Estimate',
  'local-measurement': 'Local measurement',
  unknown: 'Unknown / unmeasured',
};

function Provenance({ value }: { value: string }) {
  return <span className="inline-block rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">{PROVENANCE_LABEL[value]}</span>;
}

function SourceLinks({ ids, catalog }: { ids: string[]; catalog: VoiceFitCatalog }) {
  return <span className="inline-flex flex-wrap gap-2">{ids.map(id => {
    const index = catalog.sources.findIndex(source => source.id === id);
    const source = catalog.sources[index];
    return <a key={id} href={source.url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline" title={`${source.title} · checked ${source.checked}`} aria-label={`Source ${index + 1}: ${source.title}`}>[{index + 1}]</a>;
  })}</span>;
}

function Evidence({ cell, catalog }: { cell: VoiceEvidence; catalog: VoiceFitCatalog }) {
  return <div className="text-sm leading-relaxed text-zinc-300"><p>{cell.text}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-xs"><Provenance value={cell.provenance} /><SourceLinks ids={cell.sources} catalog={catalog} /></div></div>;
}

function FitBadge({ fit }: { fit: VoiceFit }) {
  const style = fit.status === 'candidate' || fit.status === 'measured'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
    : fit.status === 'over-budget' ? 'border-red-500/40 bg-red-500/10 text-red-300'
      : 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return <span className={`inline-block rounded border px-2 py-1 text-xs ${style}`}>{FIT_LABEL[fit.status]}</span>;
}

function RuntimeDetails({ row, machine, catalog }: { row: VoiceFitRow; machine: VoiceMachineId; catalog: VoiceFitCatalog }) {
  const fit = voiceFitForMachine(row, machine);
  const evidenceFields = [
    ['Conversation', row.interaction], ['Persona & voice', row.persona],
    ['Tools & agent work', row.tools.evidence], ['Language', row.languages], ['Limits', row.caveat],
  ] as const;
  return (
    <details id={row.id} className="scroll-mt-20 rounded-xl border border-zinc-800 bg-zinc-900/30 open:bg-zinc-900/50">
      <summary className="cursor-pointer px-4 py-4 text-sm font-semibold text-zinc-100 sm:px-5">
        {row.model}<span className="ml-2 font-normal text-zinc-400">{row.runtime}</span>
      </summary>
      <div className="space-y-5 border-t border-zinc-800 p-4 sm:p-5">
        <div className="rounded-lg border border-zinc-700 p-3">
          <div className="flex flex-wrap items-center gap-2"><FitBadge fit={fit} /><Provenance value={fit.provenance} /></div>
          <p className="mt-2 text-sm text-zinc-300">{fit.note}</p>
          <div className="mt-1 text-xs"><SourceLinks ids={fit.sources} catalog={catalog} /></div>
        </div>
        <dl className="grid gap-5 md:grid-cols-2">
          {evidenceFields.map(([label, cell]) => <div key={label}><dt className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt><dd><Evidence cell={cell} catalog={catalog} /></dd></div>)}
        </dl>
        <div className="overflow-x-auto rounded-lg border border-zinc-800" tabIndex={0} role="region" aria-label={`${row.model} memory and performance evidence`}>
          <table className="w-full min-w-[640px] text-left text-xs">
            <caption className="p-3 text-left text-sm font-medium text-zinc-200">Memory & performance evidence</caption>
            <thead className="bg-zinc-950/50 text-zinc-400"><tr><th scope="col" className="p-3">Quantity</th><th scope="col" className="p-3">Value & unit</th><th scope="col" className="p-3">Evidence</th><th scope="col" className="p-3">Hardware & conditions</th></tr></thead>
            <tbody>{row.metrics.map(metric => <tr key={metric.label} className="border-t border-zinc-800 align-top">
              <th scope="row" className="p-3 font-normal text-zinc-300">{metric.label}</th>
              <td className="whitespace-nowrap p-3 font-mono text-zinc-200">{metric.value === null ? 'Unknown' : `${metric.value} ${metric.unit}`}</td>
              <td className="p-3"><Provenance value={metric.provenance} /><div className="mt-1"><SourceLinks ids={metric.sources} catalog={catalog} /></div></td>
              <td className="max-w-lg p-3 leading-relaxed text-zinc-400"><span className="text-zinc-300">{metric.hardware}.</span> {metric.conditions}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

export function VoiceFitExplorer({ catalog }: { catalog: VoiceFitCatalog }) {
  const [machine, setMachine] = useState<VoiceMachineId>('a6000-48');
  const [intent, setIntent] = useState<VoiceIntent>('coding-agents');
  const selectedMachine = catalog.machines.find(item => item.id === machine)!;
  const shortlist = voiceShortlist(catalog, machine, intent);
  const shortlistIds = new Set(shortlist.map(row => row.id));

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5" aria-label="Choose voice task and hardware">
        <div className="grid gap-4 md:grid-cols-2">
          <div><label htmlFor="voice-intent" className="mb-2 block text-sm font-medium text-zinc-200">What do you want to do?</label>
            <select id="voice-intent" value={intent} onChange={event => setIntent(event.target.value as VoiceIntent)} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm">
              <option value="coding-agents">Control my coding agents</option><option value="conversation">Explore natural local conversation</option>
            </select>
          </div>
          <div><label htmlFor="voice-machine" className="mb-2 block text-sm font-medium text-zinc-200">Hardware scope</label>
            <select id="voice-machine" value={machine} onChange={event => setMachine(event.target.value as VoiceMachineId)} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm">
              {catalog.machines.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-zinc-400">{selectedMachine.note} Inventory checked {selectedMachine.checked}. These are manually assessed capacity profiles, not a live free-memory monitor. The two PC GPUs are assessed separately; system RAM is not VRAM.</p>
      </section>

      <section aria-live="polite" aria-atomic="true" className="rounded-xl border border-emerald-800/60 bg-gradient-to-br from-emerald-950/50 to-zinc-900/50 p-5 sm:p-6">
        <p className="text-xs uppercase tracking-wider text-emerald-400">Recommendation for your task · inference, not a benchmark winner</p>
        {intent === 'coding-agents' ? <>
          <h2 className="mt-2 text-xl font-semibold text-zinc-100">Give your existing coding agent a voice.</h2>
          <p className="mt-3 max-w-4xl text-sm leading-relaxed text-zinc-300">Keep the real Codex or Claude Code session, its selected model and reasoning effort, workspace, tools and permissions. The agent should continue working after you stop speaking, with spoken progress and a way to steer the same task. A small speech model does not supply that reasoning or persistence.</p>
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-lg border border-emerald-900 bg-zinc-950/40 p-3"><span className="text-xs text-emerald-400">1 · Hear you</span><p className="mt-1">Scrivo / local ASR</p><p className="mt-1 text-xs text-zinc-400">Mac: optional Nemotron streaming. Windows: Whisper. Existing Parakeet is another integration candidate.</p></div>
            <div className="rounded-lg border border-emerald-900 bg-zinc-950/40 p-3"><span className="text-xs text-emerald-400">2 · Do the work</span><p className="mt-1">Real persistent agent session</p><p className="mt-1 text-xs text-zinc-400">Preserve agent execution and settings; generic text chat alone is insufficient.</p></div>
            <div className="rounded-lg border border-emerald-900 bg-zinc-950/40 p-3"><span className="text-xs text-emerald-400">3 · Speak back</span><p className="mt-1">Kokoro speech output</p><p className="mt-1 text-xs text-zinc-400">Read useful progress and results. Agent work continues independently of playback.</p></div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-emerald-200">Integration required. Speech can be local while the selected coding model remains hosted. This page has not connected or benchmarked that bridge. <SourceLinks ids={['scrivo', 'nemotron-asr', 'kokoro', 'codex-app-server', 'claude-headless']} catalog={catalog} /></p>
        </> : <>
          <h2 className="mt-2 text-xl font-semibold text-zinc-100">Trials for {selectedMachine.label}</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">{shortlist.length ? shortlist.map(row => `${row.model} (${row.runtime})`).join('; ') : 'No first-trial candidate established for this scope.'}</p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">These have a plausible published runtime path for this capacity. There are no comparable local latency, interruption or task-success measurements to choose a universal winner. Review conditional ports and requirements below.</p>
        </>}
      </section>

      <aside className="rounded-xl border border-sky-900/60 bg-sky-950/20 p-4 text-sm leading-relaxed text-zinc-300">
        <h2 className="font-semibold text-sky-200">Also check the voice features in your existing agent app</h2>
        <p className="mt-2">Where enabled, native Codex Voice continues the current task with its selected model and permissions, including steering ongoing work. Availability on this account has not been verified. Claude Code voice dictation provides spoken input. These are hosted reference options, separate from the local runtime comparison. <SourceLinks ids={['codex-voice', 'claude-voice']} catalog={catalog} /></p>
      </aside>

      <section aria-labelledby="voice-comparison-title">
        <h2 id="voice-comparison-title" className="text-lg font-semibold text-zinc-100">Runtime comparison</h2>
        <p className="mb-3 mt-1 text-xs leading-relaxed text-zinc-400">Highlighted rows match the selected task. Order is editorial, not a quality ranking. Full duplex means listening while speaking; a cascade uses separate recognition, reasoning and synthesis components. ASR and TTS alone are components, not conversational agents.</p>
        <div className="overflow-x-auto rounded-xl border border-zinc-800" tabIndex={0} role="region" aria-label="Voice runtime comparison; scroll horizontally on small screens">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead className="bg-zinc-900 text-xs uppercase text-zinc-400"><tr><th scope="col" className="p-4">Model / exact runtime</th><th scope="col" className="p-4">Conversation & tools</th><th scope="col" className="p-4">{selectedMachine.label}</th></tr></thead>
            <tbody>{catalog.rows.map(row => {
              const fit = voiceFitForMachine(row, machine);
              return <tr key={row.id} className={`border-t border-zinc-800 align-top ${shortlistIds.has(row.id) ? 'bg-emerald-950/20' : 'bg-zinc-900/20'}`}>
                <th scope="row" className="w-[30%] p-4 font-normal"><a href={`#${row.id}`} className="font-semibold text-zinc-100 hover:text-emerald-300">{row.model}</a><p className="mt-1 text-xs leading-relaxed text-zinc-400">{row.runtime}</p><p className="mt-2 text-[11px] text-zinc-500">{row.maintainer === 'proposed-integration' ? 'Proposed integration' : `${row.maintainer} runtime`}</p></th>
                <td className="w-[27%] p-4"><p className="text-zinc-300">{ARCHITECTURE_LABEL[row.architecture]}</p><p className="mt-2 text-xs text-zinc-400">{TOOL_LABEL[row.tools.status]}</p></td>
                <td className="p-4"><FitBadge fit={fit} /><p className="mt-2 text-xs leading-relaxed text-zinc-400">{fit.note}</p><div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><Provenance value={fit.provenance} /><SourceLinks ids={fit.sources} catalog={catalog} /></div></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="voice-evidence-title">
        <h2 id="voice-evidence-title" className="text-lg font-semibold text-zinc-100">Inspect the evidence</h2>
        <p className="mb-3 mt-1 text-xs leading-relaxed text-zinc-400">Published requirements, download sizes, third-party machine peaks and local measurements are different quantities. GB is preserved as the source reports it; inventory uses GiB. No local voice runs are recorded. Source-check dates do not mean a model was benchmarked that day.</p>
        <div className="space-y-3">{catalog.rows.map(row => <RuntimeDetails key={row.id} row={row} machine={machine} catalog={catalog} />)}</div>
      </section>
      <section className="rounded-xl border border-zinc-800 p-4 sm:p-5" aria-labelledby="voice-sources-title">
        <h2 id="voice-sources-title" className="text-lg font-semibold text-zinc-100">Sources & check dates</h2>
        <ol className="mt-3 grid list-inside list-decimal gap-3 text-xs md:grid-cols-2">{catalog.sources.map(source => <li key={source.id} className="text-zinc-400"><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">{source.title}</a><p className="mt-1">{source.publisher} · checked {source.checked}</p></li>)}</ol>
      </section>
    </div>
  );
}
