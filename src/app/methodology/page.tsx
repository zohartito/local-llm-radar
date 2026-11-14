import Link from 'next/link';
import { BENCH_ANCHORS, COMPOSITE_WEIGHTS, SCORING_CATEGORIES, SCORING_VERSION } from '@/lib/merge-models';

export default function MethodologyPage() {
  return <article className="mx-auto max-w-5xl space-y-6 px-4 py-8 text-sm text-zinc-300">
    <h1 className="text-2xl font-bold text-zinc-100">How to read this radar</h1>
    <p>We aggregate published results. We do not run these evaluations ourselves. Different models have different test coverage,
      reasoning settings, scaffolds, and publication dates. This site is a starting point for comparison, not proof that one model will outperform another on your workload.</p>
    <h2 className="text-lg font-semibold">Category comparisons use the same test</h2>
    <p>The dashboard, category pages, Compare and Hardware category recommendations open a named benchmark. Positions use its published score from one evaluator and dataset edition, with shared positions for exact ties. Missing, conflicting, vendor-only or differently dated results cannot fill a gap in that comparison. Extra benchmarks do not increase the selected test score. Effort and harness settings can still differ: a position describes this test, not universal task superiority.</p>
    <p>Overall, Coding, Reasoning and Agentic default to LiveBench 2.0. Its overall score uses the edition’s published suite weights and requires a complete run. Math stays on the labeled v1 task set because 2.0 has no standalone math suite. Chat defaults to the Arena preference rating, which measures human preference rather than correctness. Other reported numbers remain inspectable in the table. Benchmarks without sufficiently identified evaluator results have no comparable-test positions. Historical weighted-index positions are never reused as benchmark trends.</p>
    <h2 className="text-lg font-semibold">Capability Score is an optional experimental index</h2>
    <p>Version <code>{SCORING_VERSION}</code>. The score is a coding-weighted index, not an accuracy percentage.
      Each available result is normalized against the fixed bands below, weighted by benchmark and source reliability, and
      shrunk toward a fixed prior of 35 with weight 0.5. An unmeasured category contributes that prior; an entirely unmeasured model scores zero.
      Model release age and your hardware do not change measured capability.</p>
    <div className="overflow-x-auto"><table className="w-full text-left">
      <caption className="text-left text-zinc-500 mb-2">Current category definitions, read directly from the scorer</caption>
      <thead><tr><th className="p-2">Category</th><th className="p-2">Weight</th><th className="p-2">Inputs</th></tr></thead>
      <tbody>{Object.entries(SCORING_CATEGORIES).map(([category, keys]) => <tr key={category} className="border-t border-zinc-800">
        <td className="p-2">{category}</td><td className="p-2">{Math.round(COMPOSITE_WEIGHTS[category as keyof typeof COMPOSITE_WEIGHTS] * 100)}%</td>
        <td className="p-2 text-xs">{keys.join(', ')}</td>
      </tr>)}</tbody>
    </table></div>
    <p>Within a category, available cells are averaged with reliability weights. These are product choices, not statistically calibrated probabilities.
      More coverage can change a score, including lowering it when new results are weaker. The prior also means additional high results can raise a model above another model with a better result on their shared test. Models are not compared on a common complete test set. Index positions do not establish task superiority; inspect shared tests and original evaluation conditions.</p>
    <h2 className="text-lg font-semibold">Evidence and attribution</h2>
    <p>Each benchmark cell selects an actual reported value: direct evaluator first, then aggregator/vendor. Archived benchmark numbers without cell-level source receipts are excluded from both display and scoring. The archived roster and explicitly attributed metadata can still fill gaps. Equal-priority sources use a stable publisher order. Alternate reports remain inspectable; they are never averaged into a new result.</p>
    <p>Vendor and aggregator results remain visible, with source reliability capped at 0.5;
      preference arenas at 0.35. Direct evaluator data can use the benchmark reliability up to 1. Every cell receives a 0.75 support multiplier;
      multiple websites repeating a number do not establish independent confirmation. The evidence indicator measures weighted coverage, not the probability that the ranking is correct.</p>
    <p>A fully ranked evidence status requires breadth across benchmark families and at least one evaluator-tier result. Vendor-only evidence remains provisional. This is an evidence gate, not independent certification of every cell.</p>
    <p>Comparable-test positions use descending scores within the selected evaluator edition and weight-access filter. Search and provider filtering on the dashboard preserve those positions. Exact ties share a position. An unknown or conflicting result has no position. Sorting a vendor-reported column permits inspection but does not assign a comparable-test rank. The optional index mode is explicitly separate.
      Tier letters are fixed score bands, not endorsements of production readiness. Some model rows combine best published results from different effort or scaffold configurations;
      they may not describe one reproducible configuration. Open a model to inspect its source values and effort variants.</p>
    <h2 className="text-lg font-semibold">Fetch time is not evaluation time</h2>
    <p>A snapshot is reused for up to 30 minutes during normal operation. A daily Vercel cron is configured for 09:00 UTC;
      successful execution must be checked operationally. Failures can leave older snapshots visible with a warning.
      “Sources fetched” describes retrieval, not a new benchmark run. A benchmark edition date is not the date every model was tested.
      The ingested LiveBench v1 results are a legacy edition, separate from the current LiveBench 2.0 board. For v1, each model’s selected run maximizes its global average; a category card does not search all effort variants for that category’s maximum. See <Link className="text-emerald-400 underline" href="/admin">Data health</Link> for source status and available dates.</p>
    <h2 className="text-lg font-semibold">Hardware estimates need a runtime check</h2>
    <p>Q4 uses approximately 0.55 GB per billion total parameters plus 2 GB; Q8 uses 1.1 plus 1.5 GB; FP16 uses 2 plus 2 GB.
      Architecture-specific overrides may apply. Total MoE weights need storage even when only a subset is active per token.
      These approximate GB figures are not precise checkpoint sizes, and context-dependent KV cache is not modeled.</p>
    <p>Planning budgets reserve 25% of Mac unified memory, 40% of CPU RAM, and 10% of combined multi-GPU VRAM for splitting.
      A further 10% headroom distinguishes comfortable from tight estimated fits. System RAM is separate from VRAM.
      The default hardware shortlist excludes GPU/CPU offload candidates. A memory estimate does not verify backend support, available quantizations, load success, task quality, or tokens per second.</p>
    <h2 className="text-lg font-semibold">Fixed normalization bands</h2>
    <p>Normalized value = clamp(100 × (value − low) ÷ (high − low), 0, 100). Reliability below is capped further by source type.
      Only keys listed in the category recipes above affect the score; other bands are retained for display-only metrics. These bands are heuristic and versioned; changing them requires a scoring-version change and discards incompatible cached rankings.</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-xs">
      <thead><tr><th className="p-2">Benchmark</th><th>Low</th><th>High</th><th>Reliability</th></tr></thead>
      <tbody>{Object.entries(BENCH_ANCHORS).map(([key, band]) => <tr key={key} className="border-t border-zinc-800">
        <td className="p-2">{key}</td><td>{band.lo}</td><td>{band.hi}</td><td>{band.reliability}</td>
      </tr>)}</tbody>
    </table></div>
    <p>Video has a separate <Link className="text-emerald-400 underline" href="/video">fit and throughput log</Link>.
      It is not part of this score or automatic benchmark refresh. Measurement, vendor claim, prediction, and unmeasured entries are distinct.</p>
  </article>;
}
