import Link from 'next/link';
import { VoiceFitExplorer } from '@/components/VoiceFitExplorer';
import { loadVoiceFitCatalog } from '@/lib/voice-fit-catalog';

export const metadata = {
  title: 'Voice Models & Agent Interfaces — Local LLM Radar',
  description: 'Source-backed conversational voice runtimes, local speech interfaces for coding agents, and hardware-fit evidence for A6000, 4070 Ti SUPER and M4 Max.',
};

export default function VoiceFitPage() {
  const catalog = loadVoiceFitCatalog();
  return <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
    <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">← Dashboard</Link>
    <header className="mb-6 mt-4">
      <p className="text-xs text-amber-300">Manual evidence review · sources checked {catalog.checked} · no local voice benchmarks</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-100">Voice Models & Agent Interfaces</h1>
      <p className="mt-3 max-w-4xl text-sm leading-relaxed text-zinc-400">{catalog.scope} Voice quality, conversational timing and sustained coding ability are separate questions. This catalog keeps speech evidence outside the text Capability Score.</p>
    </header>
    <VoiceFitExplorer catalog={catalog} />
  </div>;
}
