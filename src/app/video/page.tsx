import { ReleaseDate } from '@/components/ReleaseDate';
import Link from 'next/link';
import {
  loadVideoFitCatalog,
  provenanceLabel,
  runStatusLabel,
  type MachineId,
  type MeasuredPeak,
  type Provenance,
  type ProvenancedGb,
  type RunResult,
  type RunStatus,
  type ThroughputCell,
  type VideoFitRow,
} from '@/lib/video-fit';

export const metadata = {
  title: 'Video Model Fit — Local LLM Radar',
  description:
    'Does a given video-generation weight build actually run on consumer hardware, and how fast — a fit and throughput log, not a quality ranking.',
};

const PROVENANCE_STYLE: Record<Provenance, string> = {
  measurement: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  vendor_claim: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  prediction: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
  unmeasured: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/40',
};

const RUN_STYLE: Record<RunStatus, string> = {
  yes: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  'yes-with-offload': 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  no: 'bg-red-500/15 text-red-300 border-red-500/40',
  unmeasured: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/40',
};

function Tag({ provenance }: { provenance: Provenance }) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${PROVENANCE_STYLE[provenance]}`}
    >
      {provenanceLabel(provenance)}
    </span>
  );
}

function fmtGb(gb: number | null): string {
  if (gb === null) return '—';
  if (gb < 1) return `${Math.round(gb * 1000)} MB`;
  return `${gb} GB`;
}

function GbCell({ label, gb }: { label: string; gb: ProvenancedGb }) {
  return (
    <div className="text-sm text-zinc-300">
      {label}: <span className="font-mono">{fmtGb(gb.value)}</span> <Tag provenance={gb.provenance} />
      {gb.note ? <p className="mt-1 text-xs leading-relaxed text-zinc-500">{gb.note}</p> : null}
    </div>
  );
}

function PeakCell({ peak }: { peak: MeasuredPeak }) {
  const measured =
    peak.value_gb === null
      ? '—'
      : peak.of_gb !== null
        ? `${peak.value_gb} / ${peak.of_gb} GB${peak.what ? ` ${peak.what}` : ''}`
        : `${peak.value_gb} GB${peak.what ? ` ${peak.what}` : ''}`;

  return (
    <div className="text-sm text-zinc-300">
      Measured peak: <span className="font-mono">{measured}</span>{' '}
      <Tag provenance={peak.provenance} />
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        {peak.hardware}
        {peak.note ? ` · ${peak.note}` : ''}
      </p>
    </div>
  );
}

function RunCard({ label, run }: { label: string; run: RunResult }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded border px-2 py-0.5 text-sm font-medium ${RUN_STYLE[run.status]}`}>
          {runStatusLabel(run.status)}
        </span>
        <Tag provenance={run.provenance} />
      </div>
      {run.note ? <p className="text-xs leading-relaxed text-zinc-400">{run.note}</p> : null}
      {run.stack ? (
        <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-zinc-500">{run.stack}</p>
      ) : null}

      {run.failure ? (
        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
            {run.provenance === 'prediction' ? 'Predicted failure' : 'Recorded failure, verbatim'} — {run.failure.when}
          </div>
          <pre className="overflow-x-auto rounded border border-red-900/40 bg-red-950/20 p-2 text-[11px] leading-relaxed text-red-200">
            {run.failure.error_verbatim}
          </pre>
          <p className="mt-1 text-xs text-zinc-500">
            {[
              run.failure.wall_clock_s !== null ? `${run.failure.wall_clock_s}s wall clock` : null,
              run.failure.diffusion_steps_executed !== null
                ? `${run.failure.diffusion_steps_executed} diffusion steps executed`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {run.failure.root_cause ? (
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">{run.failure.root_cause}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ThroughputRow({ cell }: { cell: ThroughputCell }) {
  const headline =
    cell.compute_seconds_per_output_second === null
      ? cell.output_seconds === 0 ? 'No output produced — throughput not measurable' : 'Throughput not measured'
      : `${cell.compute_seconds_per_output_second}s compute per second of output`;

  const params = [
    cell.resolution,
    cell.duration_s !== null ? `${cell.duration_s}s` : null,
    cell.fps !== null ? `${cell.fps} fps` : null,
    cell.steps,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="text-sm text-zinc-300">
        {headline} <Tag provenance={cell.provenance} />
      </div>
      <div className="mt-1 text-xs text-zinc-500">
        on {cell.hardware}
        {params ? ` · ${params}` : ''}
      </div>
      {cell.note ? (
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">{cell.note}</p>
      ) : null}
    </div>
  );
}

function RowCard({ row, machines }: { row: VideoFitRow; machines: Record<MachineId, { label: string; detail: string }> }) {
  return (
    <section className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-zinc-100">
          {row.model} {row.version}
          <span className="ml-2 font-mono text-sm font-normal text-zinc-400">{row.weight_build}</span>
        </h2>
        <div className="font-mono text-sm text-zinc-400">
          {fmtGb(row.total_download_gb.value)} total <Tag provenance={row.total_download_gb.provenance} />
        </div>
      </div>

      <p className="mb-3 text-xs text-zinc-500">Model released <ReleaseDate value={row.release} /></p>
      {row.total_download_gb.note ? <p className="mb-4 text-xs text-zinc-500">{row.total_download_gb.note}</p> : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <RunCard label={machines['cuda-16gb'].label} run={row.runs['cuda-16gb']} />
        <RunCard label={machines['mps-64gb'].label} run={row.runs['mps-64gb']} />
      </div>

      <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Memory</div>
        <GbCell label="Stated requirement" gb={row.vram.stated_gb} />
        <div className="mt-2">
          <PeakCell peak={row.vram.measured_peak} />
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Throughput</div>
        <div className="space-y-2">
          {row.throughput.length > 0 ? (
            row.throughput.map((cell, i) => <ThroughputRow key={`${row.id}-tp-${i}`} cell={cell} />)
          ) : (
            <p className="text-xs text-zinc-500">No throughput recorded.</p>
          )}
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Recorded components</div>
        <p className="mb-2 text-xs text-zinc-500">Partial inventory. Reported load sizes and published file sizes are different quantities; these entries do not reconcile the total download.</p>
        <div className="flex flex-wrap gap-2">
          {row.files.map((file) => (
            <div
              key={`${row.id}-${file.name}`}
              className="rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-xs text-zinc-300"
              title={file.name}
            >
              {file.role}: <span className="font-mono">{fmtGb(file.size_gb)}</span>{' '}
              <Tag provenance={file.provenance} />
              {file.note ? <p className="mt-1 max-w-lg text-xs text-zinc-500">{file.note}</p> : null}
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
          Recorded territory availability (US)
          <Tag provenance={row.license.provenance} />
        </div>
        <span
          className={`rounded border px-2 py-0.5 text-sm font-medium ${
            row.license.status === 'us-excluded' ? RUN_STYLE.no : RUN_STYLE.yes
          }`}
        >
          {row.license.status === 'us-excluded' ? 'US user excluded' : 'No US territory exclusion recorded'}
        </span>
        {row.license.separate_authorization_required ? (
          <span className="ml-2 text-xs text-amber-300">separate authorization required</span>
        ) : null}
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">{row.license.note}</p>
        <a
          href={row.license.source_url}
          className="mt-1 inline-block max-w-full break-all font-mono text-[11px] text-zinc-500 hover:text-zinc-300"
          target="_blank"
          rel="noopener noreferrer"
        >
          {row.license.source_url}
        </a>
      </div>
    </section>
  );
}

export default function VideoFitPage() {
  const catalog = loadVideoFitCatalog();

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">
        ← Dashboard
      </Link>

      <header className="mt-3 mb-6">
        <p className="mb-2 text-xs text-amber-400">Manual fit log · measurements last recorded {catalog._updated}. Source checks may be newer; this page is not a live benchmark feed.</p>
        <h1 className="text-2xl font-bold text-zinc-100">Video Model Fit</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
          Does a given video-generation weight build actually <em>run</em> on consumer hardware, how
          does it fail when it doesn&apos;t, how much compute does it cost per second of output, and
          may a US-based user even use the weights. This is a <strong>fit and throughput log</strong>{' '}
          — deliberately <strong>not</strong> a quality ranking. There is no &ldquo;best video
          model&rdquo; score here, and no cell blends a measurement with a vendor claim.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 text-xs text-zinc-400">
        <span className="text-zinc-500">Every cell is tagged:</span>
        <span className="flex items-center gap-1">
          <Tag provenance="measurement" /> recorded observation; raw run receipts are not attached
        </span>
        <span className="flex items-center gap-1">
          <Tag provenance="vendor_claim" /> vendor-published, hardware named
        </span>
        <span className="flex items-center gap-1">
          <Tag provenance="prediction" /> inferred, not run
        </span>
        <span className="flex items-center gap-1">
          <Tag provenance="unmeasured" /> not established this pass
        </span>
      </div>

      <div className="space-y-5">
        {catalog.rows.map((row) => (
          <RowCard key={row.id} row={row} machines={catalog.machines} />
        ))}
      </div>

      <p className="mt-6 text-xs leading-relaxed text-zinc-500">
        Machines — {catalog.machines['cuda-16gb'].detail} · {catalog.machines['mps-64gb'].detail}.
        Data: <span className="font-mono">data/video-fit.json</span> (updated {catalog._updated}).
        This log is intentionally separate from the text-model scoring engine; see{' '}
        <span className="font-mono">docs/SCORING.md</span>.
      </p>
    </div>
  );
}
