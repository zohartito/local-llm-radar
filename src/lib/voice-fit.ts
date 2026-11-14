/** Voice evidence is intentionally independent of text capability scoring. */
import { z } from 'zod';

export const VOICE_FIT_ROUTE = '/voice';
export const VOICE_FIT_KIND = 'voice-fit-log';
export const VOICE_MACHINE_IDS = ['a6000-48', '4070ti-super-16', 'm4-max-64'] as const;
const machineId = z.enum(VOICE_MACHINE_IDS);
const text = z.string().trim().min(1);
const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const date = z.iso.date();
const sourceIds = z.array(id);
const receipt = z.object({
  path: text,
  machine: machineId,
  recorded: date,
  runtime: text,
  workload: text,
}).strict();

const evidence = z.object({
  text,
  provenance: z.enum(['published', 'inference', 'unknown']),
  sources: sourceIds,
}).strict().refine(v => v.provenance === 'unknown' || v.sources.length > 0, {
  message: 'Published claims and inferences need sources',
});

const metric = z.object({
  label: text,
  value: z.number().finite().positive().nullable(),
  unit: z.enum(['GB', 'GiB', 'ms', 's', 'RTF']),
  quantity: z.enum(['runtime-requirement', 'download', 'peak-memory', 'latency', 'throughput']),
  provenance: z.enum(['published', 'estimate', 'local-measurement', 'unknown']),
  hardware: text,
  conditions: text,
  sources: sourceIds,
  receipt: receipt.optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.value === null) !== (value.provenance === 'unknown')) {
    ctx.addIssue({ code: 'custom', message: 'Unknown metrics must be null; numeric values need evidence' });
  }
  if (['published', 'estimate'].includes(value.provenance) && !value.sources.length) {
    ctx.addIssue({ code: 'custom', message: 'Numeric claims need sources' });
  }
  if (value.provenance === 'local-measurement' && !value.receipt) {
    ctx.addIssue({ code: 'custom', message: 'A local measurement needs a dated machine/runtime/workload receipt' });
  }
  const memory = ['runtime-requirement', 'download', 'peak-memory'].includes(value.quantity);
  if (memory !== ['GB', 'GiB'].includes(value.unit)) {
    ctx.addIssue({ code: 'custom', message: 'Metric quantity and unit disagree' });
  }
});

const fit = z.object({
  status: z.enum(['candidate', 'conditional', 'over-budget', 'not-supported', 'unknown', 'integration-required', 'measured']),
  provenance: z.enum(['inference', 'unknown', 'local-measurement']),
  note: text,
  sources: sourceIds,
  receipt: receipt.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'measured' || value.provenance === 'local-measurement') {
    if (value.status !== 'measured' || value.provenance !== 'local-measurement' || !value.receipt) {
      ctx.addIssue({ code: 'custom', message: 'Measured fit requires a local run receipt, never a publisher result' });
    }
  } else if (value.status === 'unknown' ? value.provenance !== 'unknown' : value.provenance !== 'inference') {
    ctx.addIssue({ code: 'custom', message: 'Untested fit must be an inference or explicitly unknown' });
  }
  if (value.provenance === 'inference' && !value.sources.length) {
    ctx.addIssue({ code: 'custom', message: 'Fit inferences need sources' });
  }
});

const row = z.object({
  id,
  model: text,
  runtime: text,
  maintainer: z.enum(['official', 'community', 'proposed-integration']),
  architecture: z.enum(['native-full-duplex', 'cascade-full-duplex', 'turn-based', 'speech-bridge', 'asr', 'tts']),
  interaction: evidence,
  persona: evidence,
  tools: z.object({
    status: z.enum(['structured', 'external-tools', 'not-supported', 'not-established', 'integration-required']),
    evidence,
  }).strict(),
  languages: evidence,
  caveat: evidence,
  metrics: z.array(metric),
  fits: z.record(machineId, fit),
}).strict();

const schema = z.object({
  kind: z.literal('voice-fit-log'),
  checked: date,
  scope: text,
  machines: z.array(z.object({
    id: machineId,
    label: text,
    capacity_gib: z.number().positive(),
    memory_type: z.enum(['dedicated-vram', 'unified-memory']),
    provenance: z.enum(['live-inventory', 'saved-inventory']),
    checked: date,
    note: text,
  }).strict()).length(3),
  sources: z.array(z.object({
    id,
    title: text,
    url: z.url().refine(v => new URL(v).protocol === 'https:', 'Source links must use HTTPS'),
    checked: date,
    publisher: text,
  }).strict()).min(1),
  rows: z.array(row).min(1),
}).strict().superRefine((catalog, ctx) => {
  const sources = new Set(catalog.sources.map(s => s.id));
  if (sources.size !== catalog.sources.length) ctx.addIssue({ code: 'custom', message: 'Duplicate source ID' });
  if (new Set(catalog.rows.map(r => r.id)).size !== catalog.rows.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate runtime row ID' });
  }
  if (new Set(catalog.machines.map(m => m.id)).size !== VOICE_MACHINE_IDS.length) {
    ctx.addIssue({ code: 'custom', message: 'Each single-device hardware scope must appear exactly once' });
  }
  for (const item of catalog.rows) {
    const cells = [item.interaction, item.persona, item.tools.evidence, item.languages, item.caveat,
      ...item.metrics, ...Object.values(item.fits)];
    for (const cell of cells) {
      for (const source of cell.sources) {
        if (!sources.has(source)) ctx.addIssue({ code: 'custom', message: `${item.id}: unknown source ${source}` });
      }
    }
    for (const machine of VOICE_MACHINE_IDS) {
      if (item.fits[machine].receipt && item.fits[machine].receipt?.machine !== machine) {
        ctx.addIssue({ code: 'custom', message: `${item.id}: a local receipt cannot certify a different machine` });
      }
    }
  }
});

export type VoiceFitCatalog = z.infer<typeof schema>;
export type VoiceFitRow = VoiceFitCatalog['rows'][number];
export type VoiceMachineId = z.infer<typeof machineId>;
export type VoiceFit = z.infer<typeof fit>;
export type VoiceEvidence = z.infer<typeof evidence>;
export type VoiceMetric = z.infer<typeof metric>;

export function parseVoiceFitCatalog(raw: unknown): VoiceFitCatalog {
  return schema.parse(raw);
}
