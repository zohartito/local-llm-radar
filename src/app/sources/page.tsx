import type { Metadata } from 'next';
import { SOURCE_CREDITS } from '@/lib/source-credits';

export const metadata: Metadata = {
  title: 'Sources & licences · Local LLM Radar',
  description: 'Every data source used by Local LLM Radar, with its licence or terms.',
};

function external(url: string) {
  return url.startsWith('/') ? {} : { target: '_blank', rel: 'noopener noreferrer' };
}

export default function SourcesPage() {
  return <article className="mx-auto max-w-5xl space-y-4 px-4 py-8 text-sm text-zinc-300">
    <h1 className="text-2xl font-bold text-zinc-100">Sources &amp; licences</h1>
    <p><strong className="text-zinc-100">Data by <a href="https://llm-stats.com" {...external('https://llm-stats.com')} className="text-emerald-400 hover:underline">LLM Stats</a>.</strong> Local LLM Radar is free and non-commercial: no ads, nothing sold. We show published results with credit; we do not run these evaluations ourselves.</p>
    <p className="text-zinc-400">Sources without a licence that allows redistribution are shown here with credit, but the public JSON APIs (<code>/api/leaderboard</code>, <code>/api/models</code>, <code>/api/rankings</code>, <code>/api/leaderboards/…</code>) return their scores (and ZeroEval prices) as null with the source name and link. Only results under a licence that allows redistribution are kept as saved fallback snapshots; the rest are fetched live and show “unavailable” when the source is down.</p>
    <div className="overflow-x-auto"><table className="w-full text-left">
      <thead><tr className="text-xs text-zinc-500"><th className="p-2">Source</th><th className="p-2">Used for</th><th className="p-2">Licence or terms</th><th className="p-2">Public API</th></tr></thead>
      <tbody>{SOURCE_CREDITS.map(credit => <tr key={credit.name} className="border-t border-zinc-800 align-top">
        <td className="p-2"><a href={credit.url} {...external(credit.url)} className="font-medium text-zinc-200 hover:text-emerald-400">{credit.name}</a></td>
        <td className="p-2 text-xs text-zinc-400">{credit.use}</td>
        <td className="p-2 text-xs"><a href={credit.termsUrl} {...external(credit.termsUrl)} className="text-emerald-400 hover:underline">{credit.licence}</a>{credit.note && <span className="block text-zinc-400 mt-1">{credit.note}</span>}</td>
        <td className="p-2 text-xs text-zinc-400">{credit.linkOnly ? 'Linked only, not imported' : credit.withheldInApi ? 'Values withheld' : 'Values included'}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="text-xs text-zinc-500">Licence verdicts were checked against each source&apos;s own terms on 2026-11-14. This is not legal advice. Re-check a source&apos;s terms before reusing its data.</p>
  </article>;
}
