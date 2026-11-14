/**
 * Video fit / throughput catalog.
 *
 * Deliberately not part of the text-model composite. Rows are per weight-build
 * measurement logs: runs-or-doesn't, peak memory, throughput, license territory.
 * There is no composite score and no quality ranking.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const VIDEO_FIT_KIND = 'video-fit-log' as const;
export const VIDEO_FIT_ROUTE = '/video';

export type Provenance = 'measurement' | 'vendor_claim' | 'prediction' | 'unmeasured';
export type RunStatus = 'yes' | 'yes-with-offload' | 'no' | 'unmeasured';
export type LicenseStatus = 'us-ok' | 'us-excluded';
export type FileRole = 'transformer' | 'text_encoder' | 'video_vae' | 'audio_vae' | 'upscaler' | 'other';
export type MachineId = 'cuda-16gb' | 'mps-64gb';

export interface ProvenancedGb {
  value: number | null;
  unit?: string;
  provenance: Provenance;
  note?: string;
}

export interface VideoFilePart {
  role: FileRole;
  name: string;
  size_gb: number;
  provenance: Provenance;
  note?: string;
}

export interface MeasuredPeak {
  value_gb: number | null;
  of_gb: number | null;
  what: 'swap' | 'cuda_vram' | 'unified' | null;
  provenance: Provenance;
  hardware: string;
  note?: string;
}

export interface RunResult {
  status: RunStatus;
  provenance: Provenance;
  hardware: string;
  stack?: string;
  note?: string;
  failure?: {
    error_verbatim: string;
    when: string;
    wall_clock_s: number | null;
    diffusion_steps_executed: number | null;
    root_cause?: string;
  };
}

export interface ThroughputCell {
  provenance: Provenance;
  hardware: string;
  compute_seconds_per_output_second: number | null;
  output_seconds: number | null;
  compute_seconds: number | null;
  resolution: string | null;
  duration_s: number | null;
  fps: number | null;
  steps: string | null;
  note: string;
}

export interface LicenseCell {
  status: LicenseStatus;
  separate_authorization_required: boolean;
  provenance: Provenance;
  source_url: string;
  note: string;
}

export interface VideoFitRow {
  id: string;
  model: string;
  version: string;
  /** Model release date, not the measurement or weight-build date. */
  release?: string | null;
  weight_build: string;
  quantization: string;
  total_download_gb: ProvenancedGb;
  files: VideoFilePart[];
  vram: {
    stated_gb: ProvenancedGb;
    measured_peak: MeasuredPeak;
  };
  runs: Record<MachineId, RunResult>;
  throughput: ThroughputCell[];
  license: LicenseCell;
}

export interface VideoFitCatalog {
  _comment: string;
  _updated: string;
  machines: Record<MachineId, { id: MachineId; label: string; detail: string }>;
  rows: VideoFitRow[];
}

const PROVENANCE: ReadonlySet<string> = new Set(['measurement', 'vendor_claim', 'prediction', 'unmeasured']);
const RUN_STATUS: ReadonlySet<string> = new Set(['yes', 'yes-with-offload', 'no', 'unmeasured']);
const LICENSE_STATUS: ReadonlySet<string> = new Set(['us-ok', 'us-excluded']);

function isProvenance(value: string): value is Provenance {
  return PROVENANCE.has(value);
}

function fail(message: string): never {
  throw new Error(`video-fit catalog: ${message}`);
}

function assertCellProvenance(label: string, provenance: string): Provenance {
  if (!isProvenance(provenance)) fail(`${label} has invalid provenance ${provenance}`);
  return provenance;
}

function validateThroughput(cell: ThroughputCell, rowId: string): void {
  assertCellProvenance(`${rowId} throughput`, cell.provenance);
  if (!cell.hardware || !cell.hardware.trim()) {
    fail(`${rowId} throughput cell is missing hardware — vendor/datacenter numbers must name the machine in the same cell`);
  }
  if (cell.provenance === 'vendor_claim' && cell.compute_seconds_per_output_second != null) {
    const named = /GB200|H100|B200|A100|datacenter/i.test(cell.hardware);
    if (!named) {
      fail(`${rowId} vendor throughput must name datacenter hardware in the same cell`);
    }
  }
}

function validateRow(row: VideoFitRow): void {
  if (!row.id || !row.model || !row.weight_build) fail('row missing id/model/weight_build');
  assertCellProvenance(`${row.id} total_download_gb`, row.total_download_gb.provenance);
  for (const file of row.files) {
    assertCellProvenance(`${row.id} file ${file.name}`, file.provenance);
  }
  assertCellProvenance(`${row.id} stated vram`, row.vram.stated_gb.provenance);
  assertCellProvenance(`${row.id} measured peak`, row.vram.measured_peak.provenance);
  for (const machine of ['cuda-16gb', 'mps-64gb'] as const) {
    const run = row.runs[machine];
    if (!run) fail(`${row.id} missing run cell for ${machine}`);
    assertCellProvenance(`${row.id} ${machine}`, run.provenance);
    if (!RUN_STATUS.has(run.status)) fail(`${row.id} ${machine} bad status`);
    if (run.status === 'no' && run.provenance === 'measurement' && !run.failure?.error_verbatim) {
      fail(`${row.id} measured no must include the verbatim error`);
    }
    if (run.provenance === 'prediction' && !/predict/i.test(`${run.note ?? ''} ${run.failure?.root_cause ?? ''}`)) {
      fail(`${row.id} ${machine} prediction must say so in the note or root cause`);
    }
  }
  if (!LICENSE_STATUS.has(row.license.status)) fail(`${row.id} bad license status`);
  if (row.license.status === 'us-excluded' && !row.license.separate_authorization_required) {
    fail(`${row.id} us-excluded must set separate_authorization_required`);
  }
  for (const cell of row.throughput) validateThroughput(cell, row.id);
}

export function parseVideoFitCatalog(raw: unknown): VideoFitCatalog {
  if (typeof raw !== 'object' || raw === null) fail('root is not an object');
  const catalog = raw as VideoFitCatalog;
  if (!Array.isArray(catalog.rows) || catalog.rows.length === 0) fail('rows must be a non-empty array');
  for (const row of catalog.rows) validateRow(row);
  return catalog;
}

export function loadVideoFitCatalog(): VideoFitCatalog {
  const raw: unknown = JSON.parse(readFileSync(path.join(process.cwd(), 'data', 'video-fit.json'), 'utf8'));
  return parseVideoFitCatalog(raw);
}

export function provenanceLabel(provenance: Provenance): string {
  switch (provenance) {
    case 'measurement':
      return 'measured';
    case 'vendor_claim':
      return 'vendor claim';
    case 'prediction':
      return 'prediction';
    case 'unmeasured':
      return 'unmeasured';
    default: {
      const _exhaustive: never = provenance;
      return _exhaustive;
    }
  }
}

export function runStatusLabel(status: RunStatus): string {
  switch (status) {
    case 'yes':
      return 'yes';
    case 'yes-with-offload':
      return 'yes, with offload';
    case 'no':
      return 'no';
    case 'unmeasured':
      return 'unmeasured';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
