export type FitLevel = 'fits-well' | 'borderline' | 'too-large';
export type HardwarePlatform = 'mac' | 'pc' | 'cpu';

export interface GpuPreset {
  label: string;
  vram: number;
}

export interface HardwareGpu {
  label: string;
  vramGb: number;
}

export interface HardwareSpec {
  platform: HardwarePlatform;
  systemRamGb: number;
  unifiedMemoryGb: number;
  gpus: HardwareGpu[];
  cpuCores?: number | null;
  // Peak memory bandwidth in GB/s when known (SBC presets set it). Decode is
  // memory-bound, so this drives the honest tok/s estimate.
  memoryBandwidthGBs?: number | null;
}

export interface HardwareFitResult {
  fit: FitLevel;
  bestQuant: string;
  memoryRequiredGb: number;
  availableMemoryGb: number;
  headroom: number;
  explanation: string;
  memoryType: string;
  speedHint: string;
  usesOffload: boolean;
  // Rough decode speed when the spec's memory bandwidth is known; null otherwise.
  tokSecEstimate: number | null;
}

export interface ModelHardwareInfo {
  name: string;
  params_b: number | null;
  vram_int4_gb: number | null;
  vram_fp16_gb: number | null;
}

export interface QuantMemoryTargets {
  q4: number | null;
  q8: number | null;
  fp16: number | null;
  note: string | null;
}

export interface HardwareRecommendation {
  key: string;
  label: string;
  quant: string;
  acceleratorGb: number;
  unifiedMemoryGb: number;
  cpuOnlyRamGb: number;
  systemRamGb: number;
  gpuPlan: string;
  note: string;
}

export const GPU_PRESETS: GpuPreset[] = [
  { label: 'GTX 1060 (6GB)', vram: 6 },
  { label: 'GTX 1070 (8GB)', vram: 8 },
  { label: 'GTX 1080 (8GB)', vram: 8 },
  { label: 'GTX 1080 Ti (11GB)', vram: 11 },
  { label: 'GTX 1660 (6GB)', vram: 6 },
  { label: 'GTX 1660 SUPER (6GB)', vram: 6 },
  { label: 'RTX 2060 (6GB)', vram: 6 },
  { label: 'RTX 2070 (8GB)', vram: 8 },
  { label: 'RTX 2080 Ti (11GB)', vram: 11 },
  { label: 'RTX 3060 (12GB)', vram: 12 },
  { label: 'RTX 3070 (8GB)', vram: 8 },
  { label: 'RTX 3080 (10GB)', vram: 10 },
  { label: 'RTX 3090 (24GB)', vram: 24 },
  { label: 'RTX 4060 (8GB)', vram: 8 },
  { label: 'RTX 4060 Ti (16GB)', vram: 16 },
  { label: 'RTX 4070 (12GB)', vram: 12 },
  { label: 'RTX 4070 Ti SUPER (16GB)', vram: 16 },
  { label: 'RTX 4080 SUPER (16GB)', vram: 16 },
  { label: 'RTX 4090 (24GB)', vram: 24 },
  { label: 'RTX 5070 Ti (16GB)', vram: 16 },
  { label: 'RTX 5080 (16GB)', vram: 16 },
  { label: 'RTX 5090 (32GB)', vram: 32 },
  { label: 'RX 7900 XTX (24GB)', vram: 24 },
  { label: 'RX 9070 XT (16GB)', vram: 16 },
  { label: 'A6000 (48GB)', vram: 48 },
];

export const RAM_OPTIONS = [8, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512];

// Single-board computers and edge devices. Jetsons share one LPDDR pool
// between CPU and GPU, so they behave like small unified-memory machines;
// Pi-class boards are CPU-only inference on LPDDR.
export interface SbcPreset {
  label: string;
  kind: 'unified' | 'cpu';
  memoryGb: number;
  memoryBandwidthGBs: number;
  cpuCores: number;
  note: string;
}

export const SBC_PRESETS: SbcPreset[] = [
  {
    label: 'Raspberry Pi Zero 2 W (0.5GB)',
    kind: 'cpu', memoryGb: 0.5, memoryBandwidthGBs: 3, cpuCores: 4,
    note: 'About 0.5GB of memory: below the smallest Q4 planning estimate here (2GB of overhead alone), so no listed model fits. Shown for comparison.',
  },
  {
    label: 'Raspberry Pi 4 (8GB)',
    kind: 'cpu', memoryGb: 8, memoryBandwidthGBs: 6, cpuCores: 4,
    note: '8GB of LPDDR4 shared with the OS. Small quantized models fit the planning budget; expect low memory bandwidth. Speed is not measured here.',
  },
  {
    label: 'Raspberry Pi 5 (8GB)',
    kind: 'cpu', memoryGb: 8, memoryBandwidthGBs: 17, cpuCores: 4,
    note: '8GB of LPDDR4X. 3–4B models at Q4 fit the planning budget. Speed is not measured here.',
  },
  {
    label: 'Raspberry Pi 5 (16GB)',
    kind: 'cpu', memoryGb: 16, memoryBandwidthGBs: 17, cpuCores: 4,
    note: '16GB of LPDDR4X. 7–8B models at Q4 fit the planning budget; memory bandwidth is the same as the 8GB board. Speed is not measured here.',
  },
  {
    label: 'Orange Pi 5 Plus (16GB)',
    kind: 'cpu', memoryGb: 16, memoryBandwidthGBs: 20, cpuCores: 8,
    note: 'RK3588, 16GB. This estimate is CPU memory only; NPU runtimes such as RKLLM have their own model support. Verify with your runtime.',
  },
  {
    label: 'Orange Pi 5 Plus (32GB)',
    kind: 'cpu', memoryGb: 32, memoryBandwidthGBs: 20, cpuCores: 8,
    note: 'RK3588, 32GB. 13B-class quantized models fit the planning budget. Speed is not measured here.',
  },
  {
    label: 'Jetson Orin Nano Super (8GB)',
    kind: 'unified', memoryGb: 8, memoryBandwidthGBs: 102, cpuCores: 6,
    note: '8GB of unified memory shared by CPU and GPU. Small quantized models fit the planning budget. Verify runtime support and speed yourself.',
  },
  {
    label: 'Jetson Orin NX (16GB)',
    kind: 'unified', memoryGb: 16, memoryBandwidthGBs: 102, cpuCores: 8,
    note: '16GB of unified memory. 7–8B models at Q4 fit the planning budget; larger models depend on context length. Speed is not measured here.',
  },
  {
    label: 'Jetson AGX Orin (64GB)',
    kind: 'unified', memoryGb: 64, memoryBandwidthGBs: 205, cpuCores: 12,
    note: '64GB of unified memory. 30B-class quantized models fit the planning budget. Speed is not measured here.',
  },
];

export function sbcPresetToSpec(preset: SbcPreset): HardwareSpec {
  if (preset.kind === 'unified') {
    return {
      platform: 'mac', // unified-memory semantics (shared CPU/GPU pool)
      unifiedMemoryGb: preset.memoryGb,
      systemRamGb: preset.memoryGb,
      gpus: [],
      cpuCores: preset.cpuCores,
      memoryBandwidthGBs: preset.memoryBandwidthGBs,
    };
  }
  return {
    platform: 'cpu',
    unifiedMemoryGb: 0,
    systemRamGb: preset.memoryGb,
    gpus: [],
    cpuCores: preset.cpuCores,
    memoryBandwidthGBs: preset.memoryBandwidthGBs,
  };
}

/**
 * Rough decode speed: token generation is memory-bandwidth-bound, so
 * tok/s ≈ effective bandwidth / bytes read per token (≈ model footprint).
 * Legacy bandwidth heuristic, not a measured throughput model. Kept for API
 * compatibility; not used in fit results or displayed as per-model speed.
 */
export function estimateTokensPerSecond(spec: HardwareSpec, modelFootprintGb: number): number | null {
  const bandwidth = spec.memoryBandwidthGBs;
  if (!bandwidth || modelFootprintGb <= 0) return null;
  return round1((bandwidth * 0.55) / modelFootprintGb);
}

export const DEFAULT_HARDWARE_PROFILES: Array<{ slug: string; name: string; spec: HardwareSpec }> = [
  {
    slug: 'macbook-m4-max-64gb',
    name: 'MacBook M4 Max 64GB',
    spec: { platform: 'mac', unifiedMemoryGb: 64, systemRamGb: 64, gpus: [], cpuCores: 14 },
  },
  {
    slug: 'rtx-4070-ti-super',
    name: 'RTX 4070 Ti SUPER 16GB',
    spec: { platform: 'pc', unifiedMemoryGb: 0, systemRamGb: 64, gpus: [{ label: 'RTX 4070 Ti SUPER (16GB)', vramGb: 16 }], cpuCores: 12 },
  },
  {
    slug: 'dual-4090',
    name: 'Dual RTX 4090',
    spec: {
      platform: 'pc',
      unifiedMemoryGb: 0,
      systemRamGb: 128,
      gpus: [
        { label: 'RTX 4090 (24GB)', vramGb: 24 },
        { label: 'RTX 4090 (24GB)', vramGb: 24 },
      ],
      cpuCores: 16,
    },
  },
  {
    slug: 'cpu-only-128gb',
    name: 'CPU-only 128GB RAM',
    spec: { platform: 'cpu', unifiedMemoryGb: 0, systemRamGb: 128, gpus: [], cpuCores: 16 },
  },
];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function estimateQ8Vram(paramsB: number | null): number | null {
  if (!paramsB) return null;
  return round1(paramsB * 1.1 + 1.5);
}

type HardwareFootprintOverride = {
  q4Gb: number;
  effectiveParamsB: number;
  note: string;
};

const HARDWARE_FOOTPRINT_OVERRIDES: Record<string, HardwareFootprintOverride> = {
  // Qwen's model card lists 125B + 51B n-gram + 4B MTP parameters (180B).
  // https://huggingface.co/Qwen/Qwen3.8-Flash-Next, checked 2026-10-22.
  // Apply the same approximate Q4 formula to the total: 180 * 0.55 + 2.
  // This is a conservative all-weights estimate, not a measured GGUF size.
  'qwen3-8-flash-next': {
    q4Gb: 101,
    effectiveParamsB: 180,
    note: 'Estimates all 180B parameters including published n-gram and MTP weights. Actual memory depends on quantization and which components the runtime loads.',
  },
};

function hardwareSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function estimateModelVram(name: string, paramsB: number | null): { q4: number | null; fp16: number | null } {
  if (!paramsB) return { q4: null, fp16: null };
  const override = HARDWARE_FOOTPRINT_OVERRIDES[hardwareSlug(name)];
  const effectiveParamsB = override?.effectiveParamsB ?? paramsB;
  return {
    q4: override?.q4Gb ?? Math.round(paramsB * 0.55 + 2),
    fp16: Math.round(effectiveParamsB * 2 + 2),
  };
}

export function getQuantMemoryTargets(model: ModelHardwareInfo): QuantMemoryTargets {
  const override = HARDWARE_FOOTPRINT_OVERRIDES[hardwareSlug(model.name)];
  const effectiveParamsB = override?.effectiveParamsB ?? model.params_b;
  const estimated = estimateModelVram(model.name, model.params_b);
  return {
    q4: override?.q4Gb ?? model.vram_int4_gb ?? estimated.q4,
    q8: estimateQ8Vram(effectiveParamsB),
    fp16: override ? estimated.fp16 : model.vram_fp16_gb ?? estimated.fp16,
    note: override?.note ?? null,
  };
}

function roundUpRam(targetGb: number): number {
  const rounded = RAM_OPTIONS.find((value) => value >= targetGb);
  if (rounded) return rounded;
  return Math.ceil(targetGb / 64) * 64;
}

function pickGpuPlan(requiredGb: number): string {
  const singleCard = [48, 32, 24, 16, 12, 10, 8]
    .filter((value) => value >= requiredGb)
    .sort((a, b) => a - b)[0];

  if (singleCard) return `1x ${singleCard}GB GPU`;

  let bestPlan: { count: number; size: number; total: number } | null = null;
  for (const size of [48, 32, 24, 16]) {
    for (let count = 2; count <= 6; count += 1) {
      const effective = size * count * 0.9;
      if (effective < requiredGb) continue;
      const candidate = { count, size, total: size * count };
      if (!bestPlan || candidate.total < bestPlan.total || (candidate.total === bestPlan.total && candidate.count < bestPlan.count)) {
        bestPlan = candidate;
      }
    }
  }

  return bestPlan ? `${bestPlan.count}x ${bestPlan.size}GB GPUs` : `~${Math.ceil(requiredGb)}GB total accelerator memory`;
}

function cpuSpeedHint(spec: HardwareSpec, usesOffload: boolean): string {
  if (!usesOffload && spec.platform !== 'cpu') {
    return spec.gpus.length > 1
      ? 'Multi-GPU splitting works, but throughput depends on your inference stack.'
      : 'Speed will mostly depend on the GPU and inference engine you use.';
  }

  const cores = spec.cpuCores ?? null;
  if (cores === null) {
    return spec.platform === 'cpu'
      ? 'CPU-only runs are possible, but speed depends heavily on your CPU and memory bandwidth.'
      : 'Offloaded runs depend heavily on CPU cores and system memory bandwidth.';
  }
  if (cores >= 24) {
    return spec.platform === 'cpu'
      ? 'Plenty of CPU headroom for a CPU-only run, though it will still trail a GPU by a wide margin.'
      : 'Strong CPU headroom for offload and tensor sharding.';
  }
  if (cores >= 12) {
    return spec.platform === 'cpu'
      ? 'Usable for CPU-only inference, but expect slower prompt processing and token generation.'
      : 'Good enough for offload, though large contexts may still feel sluggish.';
  }
  return spec.platform === 'cpu'
    ? 'This is likely to be very slow CPU-only unless the model is tiny.'
    : 'A weaker CPU can bottleneck offloaded or multi-GPU runs.';
}

export function getAvailableInferenceMemory(spec: HardwareSpec): {
  availableGb: number;
  memoryType: string;
  display: string;
  installedAcceleratorGb: number;
} {
  if (spec.platform === 'mac') {
    const availableGb = round1(spec.unifiedMemoryGb * 0.75);
    return {
      availableGb,
      memoryType: 'unified memory',
      display: `${availableGb}GB usable (${spec.unifiedMemoryGb}GB unified)`,
      installedAcceleratorGb: spec.unifiedMemoryGb,
    };
  }

  if (spec.platform === 'cpu') {
    const availableGb = round1(spec.systemRamGb * 0.6);
    return {
      availableGb,
      memoryType: 'RAM',
      display: `~${availableGb}GB usable (${spec.systemRamGb}GB RAM, CPU-only)`,
      installedAcceleratorGb: 0,
    };
  }

  const totalGpuGb = spec.gpus.reduce((sum, gpu) => sum + gpu.vramGb, 0);
  const hasMultipleGpus = spec.gpus.length > 1;
  const availableGb = round1(totalGpuGb * (hasMultipleGpus ? 0.9 : 1));
  const gpuLabel = spec.gpus.length > 0
    ? spec.gpus.map((gpu) => gpu.vramGb).join(' + ')
    : '0';

  return {
    availableGb,
    memoryType: 'VRAM',
    display: hasMultipleGpus
      ? `${availableGb}GB usable VRAM (${gpuLabel}GB = ${totalGpuGb}GB installed); ${spec.systemRamGb}GB system RAM is offload only`
      : `${availableGb}GB VRAM; ${spec.systemRamGb}GB system RAM is offload only`,
    installedAcceleratorGb: totalGpuGb,
  };
}

export function primaryGpuOnlySpec(spec: HardwareSpec): HardwareSpec | null {
  if (spec.platform !== 'pc' || spec.gpus.length < 2) return null;
  return { ...spec, gpus: [spec.gpus[0]] };
}

export function summarizeHardwareSpec(spec: HardwareSpec): string {
  return getAvailableInferenceMemory(spec).display;
}

export function computeHardwareFit(model: ModelHardwareInfo, spec: HardwareSpec): HardwareFitResult | null {
  const { q4, q8, fp16 } = getQuantMemoryTargets(model);
  if (q4 === null && q8 === null && fp16 === null) return null;

  const { availableGb, memoryType } = getAvailableInferenceMemory(spec);
  if (availableGb <= 0) return null;
  const cpuOnly = spec.platform === 'cpu';

  const describe = (targetGb: number, quant: string, fit: FitLevel, usesOffload: boolean, extra: string) => ({
    fit,
    bestQuant: quant,
    memoryRequiredGb: round1(targetGb),
    availableMemoryGb: availableGb,
    headroom: round1(availableGb - targetGb),
    explanation: extra,
    memoryType,
    speedHint: cpuSpeedHint(spec, usesOffload),
    usesOffload,
    tokSecEstimate: null, // No measured per-model/runtime throughput available.
  });

  if (fp16 !== null && fp16 <= availableGb * 0.9) {
    return describe(
      fp16,
      'FP16',
      cpuOnly ? 'borderline' : 'fits-well',
      false,
      cpuOnly
        ? 'It fits in RAM at FP16, but CPU-only inference will still be much slower than a GPU or unified-memory setup.'
        : `Full precision with about ${Math.max(0, Math.round(availableGb - fp16))}GB ${memoryType} to spare.`
    );
  }
  if (q8 !== null && q8 <= availableGb * 0.9) {
    return describe(
      q8,
      'Q8',
      cpuOnly ? 'borderline' : 'fits-well',
      false,
      cpuOnly
        ? 'It fits in RAM at Q8, but CPU-only inference will still be noticeably slower than an accelerated setup.'
        : `Q8 is a comfortable fit with about ${Math.max(0, Math.round(availableGb - q8))}GB ${memoryType} to spare.`
    );
  }
  if (q4 !== null && q4 <= availableGb * 0.9) {
    return describe(
      q4,
      'Q4',
      cpuOnly ? 'borderline' : 'fits-well',
      false,
      cpuOnly
        ? 'It fits in RAM at Q4, but CPU-only inference is still best treated as a patience-required fallback.'
        : `Q4 is estimated to fit with about ${Math.max(0, Math.round(availableGb - q4))}GB ${memoryType} headroom.`
    );
  }
  if (q4 !== null && q4 <= availableGb) {
    return describe(q4, 'Q4', 'borderline', false, 'This is a tight Q4 fit. Expect shorter contexts, smaller batches, or more tuning.');
  }
  if (q4 !== null && spec.platform === 'pc' && spec.systemRamGb >= q4 * 1.5) {
    return describe(q4, 'Q4 + offload', 'borderline', true, `Estimated RAM capacity permits testing GPU offload; it will lean on ${spec.systemRamGb}GB of system RAM and slow down noticeably.`);
  }
  if (q4 !== null && spec.platform === 'cpu' && spec.systemRamGb >= q4 / 0.6) {
    return describe(q4, 'CPU-only Q4', 'borderline', true, 'A CPU-only run is technically possible, but it will be much slower than a GPU or unified-memory setup.');
  }

  return describe(
    q4 ?? q8 ?? fp16 ?? 0,
    '—',
    'too-large',
    spec.platform === 'cpu',
    `Needs roughly ${Math.ceil(q4 ?? q8 ?? fp16 ?? 0)}GB, but only ${Math.floor(availableGb)}GB is realistically available.`
  );
}

export function buildHardwareRecommendations(model: ModelHardwareInfo): HardwareRecommendation[] {
  const { q4, q8, fp16 } = getQuantMemoryTargets(model);
  const recommendations: HardwareRecommendation[] = [];

  const addRecommendation = (key: string, label: string, quant: string, targetGb: number | null, note: string) => {
    if (targetGb === null) return;
    recommendations.push({
      key,
      label,
      quant,
      acceleratorGb: round1(targetGb),
      unifiedMemoryGb: roundUpRam(targetGb / 0.75),
      cpuOnlyRamGb: roundUpRam((targetGb / 0.6) * 1.1),
      systemRamGb: roundUpRam(Math.max(16, targetGb * 1.5)),
      gpuPlan: pickGpuPlan(targetGb),
      note,
    });
  };

  addRecommendation(
    'minimum',
    'Minimum practical local setup',
    'Q4',
    q4,
    'Estimated Q4 memory target. Check checkpoint availability, runtime support, and context requirements before downloading.'
  );
  addRecommendation(
    'comfortable',
    'Comfortable local setup',
    q8 !== null ? 'Q8' : 'Q4',
    q8 ?? q4,
    q8 !== null
      ? 'Estimated Q8 memory target; no task-quality or runtime measurement is implied.'
      : 'Q8 is not available from the current metadata, so this falls back to the Q4 target.'
  );
  addRecommendation(
    'full-quality',
    'FP16 memory target',
    'FP16',
    fp16,
    'Estimated FP16 memory. Hosted providers may use different weights and settings; equivalent quality is not established.'
  );

  return recommendations;
}
