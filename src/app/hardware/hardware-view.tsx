'use client';

import { siteLeaderboard, type SiteLeaderboardProps } from '@/lib/site-data';
import { textReleaseEvidence } from '@/lib/model-release';

import { categoryComparison, comparisonCohorts, comparisonValue, comparisonRanks, comparisonTestLabel, defaultCategoryTest } from '@/lib/benchmark-comparisons';
import { ReleaseDate } from '@/components/ReleaseDate';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { DataFreshnessBadge, type DataSourceLabel } from '@/components/DataFreshnessBadge';
import {
  CATEGORY_DEFINITIONS,
  columnsWithPublishedValues,
  dedupeModelsBySlug,
  getBenchmarkValue,
  type LeaderboardData,
  type LeaderboardModel,
} from '@/lib/leaderboard';
import { BENCHMARK_COLUMNS, benchmarkColumnFor, benchmarkProvenanceLabel } from '@/lib/benchmark-catalog';
import {
  GPU_PRESETS,
  SBC_PRESETS,
  buildHardwareRecommendations,
  getAvailableInferenceMemory,
  getQuantMemoryTargets,
  primaryGpuOnlySpec,
  sbcPresetToSpec,
  type FitLevel,
  type HardwarePlatform,
  type HardwareSpec,
} from '@/lib/hardware';
import {
  buildCategoryHardwareRecommendations,
  compareHardwareModelsByBenchmark,
  compareHardwareModelsForCategory,
  fitHardwareModels,
  isHardwareRunnable,
  openWeightModels,
  type HardwareRankedModel,
} from '@/lib/hardware-ranking';
import { matchesSearchQuery } from '@/lib/search';

type CuratedModel = LeaderboardModel;

type ModelWithFit = HardwareRankedModel;

// --- Mac product lines, chips, and memory configs ---
const MAC_PRODUCTS = ['MacBook Air', 'MacBook Pro', 'Mac Mini', 'iMac', 'Mac Studio', 'Mac Pro'];

const MAC_CHIPS: Record<string, string[]> = {
  'MacBook Air': ['Intel (2018-2020)', 'M1', 'M2', 'M3', 'M4'],
  'MacBook Pro': ['Intel (2015-2019)', 'Intel (2020)', 'M1', 'M1 Pro', 'M1 Max', 'M2', 'M2 Pro', 'M2 Max', 'M3', 'M3 Pro', 'M3 Max', 'M4', 'M4 Pro', 'M4 Max', 'M5', 'M5 Pro', 'M5 Max'],
  'Mac Mini': ['Intel (2014-2018)', 'Intel (2020)', 'M1', 'M2', 'M2 Pro', 'M4', 'M4 Pro'],
  'iMac': ['Intel (2015-2019)', 'Intel (2020)', 'M1', 'M3', 'M4'],
  'Mac Studio': ['M1 Max', 'M1 Ultra', 'M2 Max', 'M2 Ultra', 'M4 Max', 'M3 Ultra', 'M5 Max', 'M5 Ultra'],
  'Mac Pro': ['Intel (2019)', 'M2 Ultra'],
};

// 'intel' flag marks Intel chips — these use CPU-only inference (no unified memory GPU)
const INTEL_CHIPS = new Set([
  'Intel (2014-2018)', 'Intel (2015-2019)', 'Intel (2018-2020)', 'Intel (2019)', 'Intel (2020)',
]);

const MAC_MEMORY: Record<string, number[]> = {
  // MacBook Air
  'MacBook Air|Intel (2018-2020)': [8, 16],
  'MacBook Air|M1': [8, 16],
  'MacBook Air|M2': [8, 16, 24],
  'MacBook Air|M3': [8, 16, 24],
  'MacBook Air|M4': [16, 24, 32],
  // MacBook Pro
  'MacBook Pro|Intel (2015-2019)': [8, 16],
  'MacBook Pro|Intel (2020)': [16, 32],
  'MacBook Pro|M1': [8, 16],
  'MacBook Pro|M1 Pro': [16, 32],
  'MacBook Pro|M1 Max': [32, 64],
  'MacBook Pro|M2': [8, 16, 24],
  'MacBook Pro|M2 Pro': [16, 32],
  'MacBook Pro|M2 Max': [32, 64, 96],
  'MacBook Pro|M3': [8, 16, 24],
  'MacBook Pro|M3 Pro': [18, 36],
  'MacBook Pro|M3 Max': [36, 48, 64, 96, 128],
  'MacBook Pro|M4': [16, 24, 32],
  'MacBook Pro|M4 Pro': [24, 48],
  // Apple specs verified 2026-10-22: support.apple.com/en-us/121553 and
  // apple.com/macbook-pro/specs/; options span chip-bin configurations.
  'MacBook Pro|M4 Max': [36, 48, 64, 128],
  'MacBook Pro|M5': [16, 24, 32],
  'MacBook Pro|M5 Pro': [24, 48, 64],
  'MacBook Pro|M5 Max': [36, 48, 64, 128],
  // Mac Mini
  'Mac Mini|Intel (2014-2018)': [4, 8, 16],
  'Mac Mini|Intel (2020)': [8, 16, 32, 64],
  'Mac Mini|M1': [8, 16],
  'Mac Mini|M2': [8, 16, 24],
  'Mac Mini|M2 Pro': [16, 32],
  'Mac Mini|M4': [16, 24, 32],
  'Mac Mini|M4 Pro': [24, 48, 64],
  // iMac
  'iMac|Intel (2015-2019)': [8, 16, 32],
  'iMac|Intel (2020)': [8, 16, 32, 64, 128],
  'iMac|M1': [8, 16],
  'iMac|M3': [8, 16, 24],
  'iMac|M4': [16, 24, 32],
  // Mac Studio
  'Mac Studio|M1 Max': [32, 64],
  'Mac Studio|M1 Ultra': [64, 128],
  'Mac Studio|M2 Max': [32, 64, 96],
  'Mac Studio|M2 Ultra': [64, 128, 192],
  'Mac Studio|M4 Max': [36, 48, 64, 128],
  // M3 Ultra originally shipped up to 512 GB (Apple newsroom 2025-03);
  // historical owner configurations remain valid after sales options change.
  'Mac Studio|M3 Ultra': [96, 256, 512],
  // apple.com/mac-studio/specs/, verified 2026-10-22.
  'Mac Studio|M5 Max': [36, 48, 64, 128],
  'Mac Studio|M5 Ultra': [96, 256, 512],
  // Mac Pro
  'Mac Pro|Intel (2019)': [32, 48, 96, 192, 384, 768, 1536],
  'Mac Pro|M2 Ultra': [64, 128, 192],
};

const GPU_PRESET_OPTIONS = [{ label: 'Custom...', vram: 0 }, ...GPU_PRESETS];

const LOW_COVERAGE_THRESHOLD = 4;
const PAGE_SIZE = 40;

const TIER_EXPLAINERS: Record<string, { label: string; desc: string }> = {
  'S': { label: 'Index ≥75', desc: 'Capability Score at least 75. A heuristic score band, not a runtime or task-quality guarantee.' },
  'A': { label: 'Index 60–75', desc: 'Capability Score at least 60 and below 75; inspect the underlying tests and coverage.' },
  'B': { label: 'Index 45–60', desc: 'Capability Score at least 45 and below 60; missing evidence can affect the result.' },
  'C': { label: 'Index 30–45', desc: 'Capability Score at least 30 and below 45; this is not a measure of model size or speed.' },
  'D': { label: 'Index <30', desc: 'Capability Score below 30. Evidence may be limited; evaluate your own workload.' },
};

const TIER_COLORS: Record<string, string> = {
  'S': 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  'A': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  'B': 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  'C': 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  'D': 'bg-zinc-500/20 text-zinc-400 border-zinc-500/40',
};

const FIT_STYLES: Record<FitLevel, { bg: string; text: string; dot: string; label: string }> = {
  'fits-well': { bg: 'bg-emerald-900/40', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Fits Well' },
  'borderline': { bg: 'bg-amber-900/40', text: 'text-amber-400', dot: 'bg-amber-400', label: 'Borderline' },
  'too-large': { bg: 'bg-red-900/40', text: 'text-red-400', dot: 'bg-red-400', label: 'Too Large' },
};

interface GpuConfigState {
  id: number;
  preset: string;
  customVram: number;
}

const PC_QUICK_PROFILES: Array<{
  key: string;
  label: string;
  detail: string;
  systemRamGb: number;
  cpuCores: number;
  gpus: Array<Omit<GpuConfigState, 'id'>>;
}> = [
  {
    key: '4070-a6000',
    label: '4070 Ti SUPER + A6000',
    detail: '64GB installed VRAM · 128GB system RAM',
    systemRamGb: 128,
    cpuCores: 8,
    gpus: [
      { preset: 'RTX 4070 Ti SUPER (16GB)', customVram: 16 },
      { preset: 'A6000 (48GB)', customVram: 48 },
    ],
  },
  {
    key: 'a6000',
    label: 'A6000 workstation',
    detail: '48GB VRAM · 128GB system RAM',
    systemRamGb: 128,
    cpuCores: 8,
    gpus: [{ preset: 'A6000 (48GB)', customVram: 48 }],
  },
  {
    key: '4070',
    label: '4070 Ti SUPER desktop',
    detail: '16GB VRAM · 64GB system RAM',
    systemRamGb: 64,
    cpuCores: 8,
    gpus: [{ preset: 'RTX 4070 Ti SUPER (16GB)', customVram: 16 }],
  },
];

export default function HardwarePage({ initialData }: SiteLeaderboardProps) {
  const [models, setModels] = useState<CuratedModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [freshness, setFreshness] = useState<{
    dataSourceLabel?: DataSourceLabel;
    dataDate?: string | null;
    stale?: boolean;
    degradedSources?: string[];
  } | null>(null);
  const [filterFit, setFilterFit] = useState<'all' | 'fits'>('fits');

  // Hardware spec state
  const [platform, setPlatform] = useState<HardwarePlatform | 'sbc'>('mac');
  const [sbcLabel, setSbcLabel] = useState(SBC_PRESETS[2].label);
  const [macProduct, setMacProduct] = useState('MacBook Pro');
  const [macChip, setMacChip] = useState('M4 Max');
  const [macMemory, setMacMemory] = useState(64);
  const [useCustomUnifiedMemory, setUseCustomUnifiedMemory] = useState(false);
  const [customUnifiedMemory, setCustomUnifiedMemory] = useState(64);
  const [gpuConfigs, setGpuConfigs] = useState<GpuConfigState[]>([
    { id: 1, preset: 'RTX 4070 Ti SUPER (16GB)', customVram: 16 },
  ]);
  const [nextGpuId, setNextGpuId] = useState(2);
  const [sysRam, setSysRam] = useState(64);
  const [cpuCores, setCpuCores] = useState(12);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [useCase, setUseCase] = useState<string>('overall');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  // Derived Mac options
  const availableChips = MAC_CHIPS[macProduct] || [];
  const currentChip = availableChips.includes(macChip) ? macChip : availableChips[availableChips.length - 1] || 'M1';
  const memoryKey = `${macProduct}|${currentChip}`;
  const availableMemory = MAC_MEMORY[memoryKey] || [8, 16];
  const currentMemory = availableMemory.includes(macMemory) ? macMemory : availableMemory[availableMemory.length - 1];
  const isIntelMac = INTEL_CHIPS.has(currentChip);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    siteLeaderboard(initialData)
      .then((data: LeaderboardData) => {
        if (!active) return;
        setModels(dedupeModelsBySlug(data.models || []));
        setFreshness({
          dataSourceLabel: data.dataSourceLabel,
          dataDate: data.dataDate ?? data.updated ?? null,
          stale: data.stale,
          degradedSources: data.degradedSources,
        });
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) return;
        setLoadError('The model catalog could not be loaded. Your hardware settings are safe; retry the data request.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey, initialData]);

  // Derive spec from selections
  const spec: HardwareSpec = (() => {
    if (platform === 'mac') {
      if (useCustomUnifiedMemory) {
        return { platform: 'mac', unifiedMemoryGb: customUnifiedMemory, systemRamGb: customUnifiedMemory, gpus: [], cpuCores };
      }
      if (isIntelMac) {
        return { platform: 'cpu', unifiedMemoryGb: 0, systemRamGb: currentMemory, gpus: [], cpuCores };
      }
      return { platform: 'mac', unifiedMemoryGb: currentMemory, systemRamGb: currentMemory, gpus: [], cpuCores };
    }
    if (platform === 'cpu') {
      return { platform: 'cpu', unifiedMemoryGb: 0, systemRamGb: sysRam, gpus: [], cpuCores };
    }
    if (platform === 'sbc') {
      const preset = SBC_PRESETS.find((entry) => entry.label === sbcLabel) ?? SBC_PRESETS[0];
      return sbcPresetToSpec(preset);
    }
    return {
      platform: 'pc',
      unifiedMemoryGb: 0,
      systemRamGb: sysRam,
      cpuCores,
      gpus: gpuConfigs
        .map((gpu) => {
          const preset = GPU_PRESET_OPTIONS.find((option) => option.label === gpu.preset);
          return {
            label: gpu.preset === 'Custom...' ? `Custom GPU ${gpu.customVram}GB` : gpu.preset,
            vramGb: gpu.preset === 'Custom...' ? gpu.customVram : (preset?.vram ?? 0),
          };
        })
        .filter((gpu) => gpu.vramGb > 0),
    };
  })();

  const memorySummary = getAvailableInferenceMemory(spec);
  const availableDisplay = memorySummary.display;
  const hasMultipleGpus = spec.gpus.length > 1;
  const localModels = openWeightModels(models);
  const totalTrackedBenchmarks = localModels[0] ? Object.keys(localModels[0].benchmarks).length : 0;
  const visibleBenchmarkCols = columnsWithPublishedValues(BENCHMARK_COLUMNS, localModels);

  // Compute fits
  const modelsWithFit = fitHardwareModels(localModels, spec);

  const singleGpuSpec = primaryGpuOnlySpec(spec);
  const singleGpuModels: ModelWithFit[] | null = singleGpuSpec
    ? fitHardwareModels(localModels, singleGpuSpec)
    : null;

  const fitFiltered = filterFit === 'fits'
    ? modelsWithFit.filter(isHardwareRunnable)
    : modelsWithFit;
  const filtered = fitFiltered.filter((model) => (
    !search || matchesSearchQuery(search, model.name, model.provider, model.slug, model.llm_stats_model_id)
  ));

  // Compute category scores for all models
  const activeCat = CATEGORY_DEFINITIONS.find((category) => category.key === useCase) || CATEGORY_DEFINITIONS[0];
  const categoryCohort = categoryComparison(models, activeCat.key);
  const selectedTest = sortKey ?? defaultCategoryTest(activeCat.key);
  const selectedCohort = sortKey ? comparisonCohorts(models, sortKey)[0] ?? null : categoryCohort;

  const recommendations = buildCategoryHardwareRecommendations(modelsWithFit, models);
  const singleGpuRecommendations = singleGpuModels
    ? buildCategoryHardwareRecommendations(singleGpuModels, models)
    : null;
  const activeRecommendation = recommendations.find((entry) => entry.key === useCase) ?? recommendations[0];
  const activeSingleGpuRecommendation = singleGpuRecommendations?.find((entry) => entry.key === useCase) ?? null;

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey && BENCHMARK_COLUMNS.some(c => c.key === sortKey)) {
      return compareHardwareModelsByBenchmark(a, b, sortKey, sortDir, selectedCohort);
    }
    return compareHardwareModelsForCategory(a, b, activeCat.key, activeCat.benchmarks, models, categoryCohort);
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedModels = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const runnableModels = modelsWithFit.filter(isHardwareRunnable);
  const topRunnableModel = activeRecommendation?.model ?? null;
  const topRunnableSpecs = topRunnableModel ? buildHardwareRecommendations(topRunnableModel) : [];

  const singleGpuBySlug = new Map((singleGpuModels ?? []).map((model) => [model.slug, model]));
  const newlyCleanFits = singleGpuModels
    ? modelsWithFit
        .filter((model) => (
          model.hwFit?.fit === 'fits-well'
          && singleGpuBySlug.get(model.slug)?.hwFit?.fit !== 'fits-well'
        ))
        .sort((a, b) => compareHardwareModelsForCategory(a, b, activeCat.key, activeCat.benchmarks, models, categoryCohort))
    : [];

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(0);
  }

  const sortArrow = (key: string) => sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  function updateGpuConfig(id: number, patch: Partial<GpuConfigState>) {
    setGpuConfigs((current) => current.map((gpu) => (gpu.id === id ? { ...gpu, ...patch } : gpu)));
  }

  function addGpuConfig() {
    setGpuConfigs((current) => [...current, { id: nextGpuId, preset: 'Custom...', customVram: 16 }]);
    setNextGpuId((value) => value + 1);
  }

  function removeGpuConfig(id: number) {
    setGpuConfigs((current) => current.filter((gpu) => gpu.id !== id));
  }

  function applyPcQuickProfile(profile: (typeof PC_QUICK_PROFILES)[number]) {
    setPlatform('pc');
    setSysRam(profile.systemRamGb);
    setCpuCores(profile.cpuCores);
    setGpuConfigs(profile.gpus.map((gpu, index) => ({ ...gpu, id: index + 1 })));
    setNextGpuId(profile.gpus.length + 1);
  }

  const fitsCount = modelsWithFit.filter(m => m.hwFit?.fit === 'fits-well').length;
  const borderCount = modelsWithFit.filter(m => m.hwFit?.fit === 'borderline').length;
  const tooLargeCount = modelsWithFit.filter(m => m.hwFit?.fit === 'too-large').length;
  const unknownFitCount = modelsWithFit.filter(m => m.hwFit === null).length;
  const singleGpuFitsCount = singleGpuModels?.filter((model) => model.hwFit?.fit === 'fits-well').length ?? 0;
  const cleanFitGain = Math.max(0, fitsCount - singleGpuFitsCount);
  const singleGpuMemorySummary = singleGpuSpec ? getAvailableInferenceMemory(singleGpuSpec) : null;
  const modelBudgetGain = singleGpuMemorySummary
    ? Math.max(0, Math.round((memorySummary.availableGb - singleGpuMemorySummary.availableGb) * 10) / 10)
    : 0;
  const recommendationChanged = Boolean(
    activeRecommendation?.model
    && activeSingleGpuRecommendation?.model
    && (
      activeRecommendation.model.slug !== activeSingleGpuRecommendation.model.slug
      || activeRecommendation.model.hwFit?.bestQuant !== activeSingleGpuRecommendation.model.hwFit?.bestQuant
    )
  );

  // Benchmark ranges for color scaling
  const ranges: Record<string, { best: number; worst: number }> = {};
  for (const col of BENCHMARK_COLUMNS) {
    const vals = localModels.map((model) => getBenchmarkValue(model, col.key)).filter((value): value is number => value !== null);
    ranges[col.key] = vals.length > 0 ? { best: Math.max(...vals), worst: Math.min(...vals) } : { best: 100, worst: 0 };
  }

  function scoreColor(val: number | null, key: string) {
    if (val === null) return 'text-zinc-700';
    const r = ranges[key];
    const range = r.best - r.worst;
    const ratio = range > 0 ? (val - r.worst) / range : 0.5;
    if (ratio >= 0.8) return 'text-emerald-400 font-medium';
    if (ratio >= 0.6) return 'text-emerald-500/80';
    if (ratio >= 0.4) return 'text-zinc-300';
    if (ratio >= 0.2) return 'text-orange-400/80';
    return 'text-red-400/80';
  }

  const categoryScores = new Map(sorted.map((model) => [
    model.slug,
    comparisonValue(model, categoryCohort),
  ]));
  const rowRanks = comparisonRanks(filtered, selectedCohort);

  if (loading) {
    return (
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-800 rounded w-72" />
          <div className="h-[600px] bg-zinc-900 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 mb-2 inline-block">&larr; Dashboard</Link>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-100">What Can I Run?</h1>
          <p className="text-sm text-zinc-400 mt-1 max-w-2xl">
            Build your machine below. Selections recalculate memory estimates. These are not measurements on your machine: runtime support, checkpoint availability, context length, KV cache, and actual speed still need checking.
          </p>
        </div>
        <DataFreshnessBadge
          dataSourceLabel={freshness?.dataSourceLabel}
          dataDate={freshness?.dataDate}
          stale={freshness?.stale}
          degradedSources={freshness?.degradedSources}
        />
      </div>

      {loadError && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200" role="alert">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setLoadError(null);
              setReloadKey((value) => value + 1);
            }}
            className="rounded-lg border border-red-800 bg-red-900/40 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-900/70"
          >
            Retry
          </button>
        </div>
      )}

      <p className="mb-5 text-sm text-zinc-400">For conversational speech and coding-agent voice interfaces, see the separate <Link href="/voice" className="text-emerald-400 hover:underline">Voice hardware comparison</Link>. Speech runtimes have different memory and latency requirements.</p>

      {/* Hardware spec builder */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-6">
        <div className="flex flex-wrap gap-6">
          {/* Platform toggle */}
          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">Platform</div>
            <div className="flex gap-1" role="group" aria-label="Hardware platform">
              <button
                type="button"
                aria-pressed={platform === 'mac'}
                onClick={() => setPlatform('mac')}
                className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors ${
                  platform === 'mac' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Mac / Unified
              </button>
              <button
                type="button"
                aria-pressed={platform === 'pc'}
                onClick={() => setPlatform('pc')}
                className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors ${
                  platform === 'pc' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                PC / GPUs
              </button>
              <button
                type="button"
                aria-pressed={platform === 'cpu'}
                onClick={() => setPlatform('cpu')}
                className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors ${
                  platform === 'cpu' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                CPU-only
              </button>
              <button
                type="button"
                aria-pressed={platform === 'sbc'}
                onClick={() => setPlatform('sbc')}
                className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors ${
                  platform === 'sbc' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                SBC / Edge
              </button>
            </div>
          </div>

          {/* Mac 3-step picker or custom unified memory */}
          {platform === 'mac' ? (
            <>
              <div className="min-w-[190px]">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">Memory Mode</div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-pressed={!useCustomUnifiedMemory}
                    onClick={() => setUseCustomUnifiedMemory(false)}
                    className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors ${
                      !useCustomUnifiedMemory ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Preset Mac
                  </button>
                  <button
                    type="button"
                    aria-pressed={useCustomUnifiedMemory}
                    onClick={() => setUseCustomUnifiedMemory(true)}
                    className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors ${
                      useCustomUnifiedMemory ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Custom UMA
                  </button>
                </div>
              </div>

              {useCustomUnifiedMemory ? (
                <div>
                  <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">Unified Memory</label>
                  <input
                    type="number"
                    min={8}
                    max={512}
                    value={customUnifiedMemory}
                    onChange={(e) => setCustomUnifiedMemory(Number(e.target.value))}
                    className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs w-24"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">Product</label>
                    <select
                      value={macProduct}
                      onChange={e => { setMacProduct(e.target.value); }}
                      className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs cursor-pointer min-w-[150px]"
                    >
                      {MAC_PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">Chip</label>
                    <select
                      value={currentChip}
                      onChange={e => setMacChip(e.target.value)}
                      className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs cursor-pointer min-w-[120px]"
                    >
                      {availableChips.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">Memory</label>
                    <select
                      value={currentMemory}
                      onChange={e => setMacMemory(Number(e.target.value))}
                      className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs cursor-pointer min-w-[100px]"
                    >
                      {availableMemory.map(m => <option key={m} value={m}>{m}GB</option>)}
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">CPU Cores</label>
                <input
                  type="number"
                  min={2}
                  max={128}
                  value={cpuCores}
                  onChange={(e) => setCpuCores(Number(e.target.value))}
                  className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs w-20"
                />
              </div>
            </>
          ) : platform === 'cpu' ? (
            <>
              <div>
                <label htmlFor="cpu-system-ram" className="text-[10px] text-zinc-400 uppercase tracking-wider block mb-1.5">System RAM</label>
                <input
                  id="cpu-system-ram"
                  type="number"
                  min={8}
                  max={1024}
                  value={sysRam}
                  onChange={e => setSysRam(Number(e.target.value))}
                  aria-describedby="cpu-system-ram-help"
                  className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs w-28"
                />
                <div id="cpu-system-ram-help" className="mt-1 max-w-[220px] text-[10px] leading-snug text-zinc-500">
                  CPU-only inference uses this memory directly; the model budget reserves about 40% for the OS and runtime.
                </div>
              </div>
              <div>
                <label htmlFor="cpu-cores" className="text-[10px] text-zinc-400 uppercase tracking-wider block mb-1.5">Physical CPU Cores</label>
                <input
                  id="cpu-cores"
                  type="number"
                  min={2}
                  max={128}
                  value={cpuCores}
                  onChange={(e) => setCpuCores(Number(e.target.value))}
                  className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs w-20"
                />
                <div className="mt-1 text-[10px] text-zinc-500">Used for the speed guidance.</div>
              </div>
            </>
          ) : platform === 'sbc' ? (
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">Device</label>
              <select
                value={sbcLabel}
                onChange={(e) => setSbcLabel(e.target.value)}
                className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs cursor-pointer min-w-[240px]"
              >
                {SBC_PRESETS.map((preset) => (
                  <option key={preset.label} value={preset.label}>{preset.label}</option>
                ))}
              </select>
              <div className="text-[10px] text-zinc-600 mt-1.5 max-w-[380px]">
                {(SBC_PRESETS.find((entry) => entry.label === sbcLabel) ?? SBC_PRESETS[0]).note}
              </div>
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="pc-system-ram" className="text-[10px] text-zinc-400 uppercase tracking-wider block mb-1.5">System RAM <span className="normal-case tracking-normal text-zinc-500">(regular PC memory)</span></label>
                <input
                  id="pc-system-ram"
                  type="number"
                  min={8}
                  max={1024}
                  value={sysRam}
                  onChange={e => setSysRam(Number(e.target.value))}
                  aria-describedby="pc-system-ram-help"
                  className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs w-28"
                />
                <div id="pc-system-ram-help" className="mt-1 max-w-[220px] text-[10px] leading-snug text-zinc-500">
                  Used for CPU offload and overflow. It is never added to your fast VRAM total.
                </div>
              </div>
              <div>
                <label htmlFor="pc-cpu-cores" className="text-[10px] text-zinc-400 uppercase tracking-wider block mb-1.5">Physical CPU Cores</label>
                <input
                  id="pc-cpu-cores"
                  type="number"
                  min={2}
                  max={128}
                  value={cpuCores}
                  onChange={(e) => setCpuCores(Number(e.target.value))}
                  className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs w-20"
                />
                <div className="mt-1 text-[10px] text-zinc-500">Only affects offload guidance.</div>
              </div>
            </>
          )}
        </div>

        {platform === 'pc' && (
          <div className="mt-4 pt-4 border-t border-zinc-800 space-y-3">
            <div>
              <div className="text-[10px] text-zinc-400 uppercase tracking-wider mb-2">Quick setups</div>
              <div className="flex flex-wrap gap-2">
                {PC_QUICK_PROFILES.map((profile) => (
                  <button
                    key={profile.key}
                    type="button"
                    onClick={() => applyPcQuickProfile(profile)}
                    className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-3 py-2 text-left transition-colors hover:border-emerald-700/70 hover:bg-emerald-950/20"
                  >
                    <span className="block text-xs font-medium text-zinc-200">{profile.label}</span>
                    <span className="block text-[10px] text-zinc-500">{profile.detail}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] text-zinc-400 uppercase tracking-wider">GPU stack</div>
                <div className="text-[11px] text-zinc-500">Each card keeps its own VRAM. Multi-GPU mode combines them with a 10% tensor-splitting reserve.</div>
              </div>
              <button
                type="button"
                onClick={addGpuConfig}
                className="px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:text-white cursor-pointer"
              >
                + Add GPU
              </button>
            </div>

            <div className="space-y-2">
              {gpuConfigs.map((gpu, index) => (
                <div key={gpu.id} className="flex flex-wrap items-end gap-3 p-3 rounded border border-zinc-800 bg-zinc-950/40">
                  <div>
                    <label htmlFor={`gpu-${gpu.id}`} className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">GPU {index + 1}</label>
                    <select
                      id={`gpu-${gpu.id}`}
                      value={gpu.preset}
                      onChange={(e) => updateGpuConfig(gpu.id, { preset: e.target.value })}
                      className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs cursor-pointer min-w-[220px]"
                    >
                      {GPU_PRESET_OPTIONS.map((option) => (
                        <option key={option.label} value={option.label}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  {gpu.preset === 'Custom...' && (
                    <div>
                      <label htmlFor={`gpu-${gpu.id}-vram`} className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">VRAM (GB)</label>
                      <input
                        id={`gpu-${gpu.id}-vram`}
                        type="number"
                        min={1}
                        max={256}
                        value={gpu.customVram}
                        onChange={(e) => updateGpuConfig(gpu.id, { customVram: Number(e.target.value) })}
                        className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs w-24"
                      />
                    </div>
                  )}

                  {gpuConfigs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeGpuConfig(gpu.id)}
                      className="px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-500 hover:text-zinc-200 cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Hardware result summary */}
        <div className="mt-4 grid gap-2 border-t border-zinc-800 pt-4 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
          <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-500">Model memory budget</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums text-zinc-100">{memorySummary.availableGb}GB</div>
            <div className="text-[10px] leading-snug text-zinc-400">{availableDisplay}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{spec.platform === 'pc' ? 'System RAM' : 'Installed memory'}</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums text-zinc-200">
              {spec.platform === 'pc' ? `${spec.systemRamGb}GB` : `${memorySummary.installedAcceleratorGb || spec.systemRamGb}GB`}
            </div>
            <div className="text-[10px] text-zinc-500">
              {spec.platform === 'pc' ? 'Overflow/offload only — not part of VRAM' : memorySummary.memoryType}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Catalog fit</div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" /><span className="text-zinc-300">{fitsCount} clean</span></span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" /><span className="text-zinc-400">{borderCount} borderline</span></span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400" /><span className="text-zinc-500">{tooLargeCount} too large</span></span>
            </div>
            <div className="mt-1 text-[10px] text-zinc-500">
              Recalculated across {localModels.length} open-weight models · {unknownFitCount} missing a reliable size.
            </div>
          </div>
        </div>
      </div>

      {singleGpuSpec && activeRecommendation?.model && activeSingleGpuRecommendation?.model && (
        <section className="mb-6 rounded-xl border border-sky-800/60 bg-gradient-to-r from-sky-950/35 to-emerald-950/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-sky-400">GPU 2 impact · {activeCat.label}</div>
              <div className="mt-1 text-sm text-zinc-200">
                {recommendationChanged ? (
                  <>
                    GPU 1 alone: <span className="font-medium text-zinc-400">{activeSingleGpuRecommendation.model.name} ({activeSingleGpuRecommendation.model.hwFit?.bestQuant})</span>
                    {' '}<span className="px-1 text-sky-500">→</span>{' '}
                    Full stack: <span className="font-semibold text-emerald-300">{activeRecommendation.model.name} ({activeRecommendation.model.hwFit?.bestQuant})</span>
                  </>
                ) : (
                  <>
                    The winner stays <span className="font-semibold text-zinc-100">{activeRecommendation.model.name}</span>, but the full stack improves its quant or headroom and widens the clean-fit catalog.
                  </>
                )}
              </div>
              {newlyCleanFits.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[10px] uppercase tracking-wider text-zinc-500">Top newly clean fits</span>
                  {newlyCleanFits.slice(0, 4).map((model) => (
                    <Link
                      key={model.slug}
                      href={`/models/${model.slug}`}
                      className="rounded-full border border-sky-800/50 bg-sky-950/40 px-2 py-1 text-[10px] text-sky-200 hover:border-sky-600"
                    >
                      {model.name} · {model.hwFit?.bestQuant}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-5 text-right">
              <div>
                <div className="text-2xl font-semibold tabular-nums text-emerald-300">+{cleanFitGain}</div>
                <div className="text-[10px] text-zinc-500">clean fits</div>
              </div>
              <div>
                <div className="text-2xl font-semibold tabular-nums text-sky-300">+{modelBudgetGain}GB</div>
                <div className="text-[10px] text-zinc-500">model budget</div>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="mb-5 rounded-lg border border-zinc-800 bg-zinc-900/45 px-4 py-3 text-xs text-zinc-400">
        <span className="font-medium text-zinc-200">Capability order stays fixed when you change hardware.</span>{' '}
        Your GPU stack changes memory-fit estimates and the default fit pool. Insufficient-evidence rows follow rankable rows; raw benchmark sorts include all measured rows. Switch to All open weights to compare the complete local catalog.
      </div>

      {/* Category selector + top runnable recommendation */}
      {runnableModels.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[10px] text-zinc-400 uppercase tracking-wider">Highest reported test score among estimated fits</div>
            <div className="text-[10px] text-zinc-500">Only matching evaluator results are ranked. Missing results remain visible; raw reported columns can be inspected separately.</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {recommendations.map(rec => {
              const active = useCase === rec.key;
              const colorMap: Record<string, { border: string; bg: string; text: string; ring: string }> = {
                emerald: { border: 'border-emerald-700/60', bg: 'bg-emerald-950/30', text: 'text-emerald-400', ring: 'ring-emerald-500/30' },
                sky: { border: 'border-sky-700/60', bg: 'bg-sky-950/30', text: 'text-sky-400', ring: 'ring-sky-500/30' },
                rose: { border: 'border-rose-700/60', bg: 'bg-rose-950/30', text: 'text-rose-400', ring: 'ring-rose-500/30' },
                violet: { border: 'border-violet-700/60', bg: 'bg-violet-950/30', text: 'text-violet-400', ring: 'ring-violet-500/30' },
                amber: { border: 'border-amber-700/60', bg: 'bg-amber-950/30', text: 'text-amber-400', ring: 'ring-amber-500/30' },
                teal: { border: 'border-teal-700/60', bg: 'bg-teal-950/30', text: 'text-teal-400', ring: 'ring-teal-500/30' },
              };
              const c = colorMap[rec.color] || colorMap.emerald;
              return (
                <button
                  key={rec.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setUseCase(rec.key); setSortKey(null); setPage(0); }}
                  className={`border rounded-lg p-2.5 text-left cursor-pointer transition-all ${
                    active ? `${c.border} ${c.bg} ring-1 ${c.ring}` : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'
                  }`}
                >
                  <div className={`text-[11px] font-semibold ${active ? c.text : 'text-zinc-400'} mb-0.5`}>
                    {rec.label}
                  </div>
                  <div className="text-[9px] text-zinc-600 mb-1.5">{comparisonTestLabel(defaultCategoryTest(rec.key))}</div>
                  {rec.model ? (
                    <div>
                      <div className="text-sm font-semibold text-zinc-100 truncate">{rec.model.name}</div>
                      <div className="text-[9px] text-zinc-500">Released <ReleaseDate value={rec.model.release} evidence={textReleaseEvidence(rec.model)} linked={false} /></div>
                      <div className="text-[10px] text-zinc-400">Score {rec.score.toFixed(2)} &middot; {rec.model.hwFit?.bestQuant} &middot; {rec.model.provider}</div>
                      {!rec.qualified && (
                        <div
                          className="mt-1 inline-block text-[9px] px-1 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-800/50"
                          title={rec.model.rank_status !== 'ranked' ? 'The overall evidence requirements (family breadth and an evaluator-tier result) are not met. Treat this pick as provisional.' : 'Less than half of this category’s tracked benchmarks are present. Treat this category pick as provisional.'}
                        >
                          {rec.model.rank_status !== 'ranked' ? 'Provisional evidence' : 'Thin category coverage'} — {Math.round(rec.coverage * rec.benchmarks.length)}/{rec.benchmarks.length} benchmarks
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[10px] text-zinc-600">Not enough benchmark data to rank</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tier explanations */}
      <div className="flex flex-wrap gap-2 mb-4">
        {Object.entries(TIER_EXPLAINERS).map(([t, info]) => (
          <div key={t} className="flex items-start gap-1.5 text-[10px]" title={info.desc}>
            <span className={`inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold border shrink-0 mt-0.5 ${TIER_COLORS[t] || TIER_COLORS['D']}`}>{t}</span>
            <span><span className="text-zinc-400 font-medium">{info.label}:</span> <span className="text-zinc-600">{info.desc}</span></span>
          </div>
        ))}
      </div>

      {topRunnableModel && topRunnableSpecs.length > 0 && (
        <div className="mb-5 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/45 p-4">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-500">Estimated fit · {activeCat.label}</div>
              <div className="mt-1 text-xl font-semibold text-zinc-100">{topRunnableModel.name}</div>
              <div className="text-xs text-zinc-400">{topRunnableModel.provider} · test score {activeRecommendation?.score.toFixed(2) ?? '—'}</div>
              {topRunnableModel.hwFit && (
                <div className="mt-2 text-[11px] text-zinc-400">
                  <span className={`font-medium ${FIT_STYLES[topRunnableModel.hwFit.fit].text}`}>
                    {FIT_STYLES[topRunnableModel.hwFit.fit].label}
                  </span>
                  {' '}at {topRunnableModel.hwFit.bestQuant} · {topRunnableModel.hwFit.memoryRequiredGb}GB model footprint · {Math.max(0, topRunnableModel.hwFit.headroom).toFixed(1)}GB headroom
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {activeRecommendation && !activeRecommendation.qualified && (
                <span className="rounded border border-amber-800/60 bg-amber-950/40 px-2 py-1 text-[10px] text-amber-300">Provisional recommendation</span>
              )}
              <Link href={`/models/${topRunnableModel.slug}`} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500">
                Open model details
              </Link>
            </div>
          </div>
          <div className="px-4 pt-3 text-[10px] uppercase tracking-wider text-zinc-500">Generic setup targets for this model class</div>
          <div className="grid grid-cols-1 gap-3 p-4 pt-2 md:grid-cols-3">
            {topRunnableSpecs.map((entry) => (
              <div key={entry.key} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="text-[11px] font-semibold text-zinc-300 mb-1">{entry.label}</div>
                <div className="text-[10px] text-zinc-600 mb-2">{entry.note}</div>
                <div className="space-y-1 text-[11px] text-zinc-400">
                  <div><span className="text-zinc-500">Target:</span> {entry.quant}</div>
                  <div><span className="text-zinc-500">GPU:</span> {entry.gpuPlan}</div>
                  <div><span className="text-zinc-500">Unified:</span> {entry.unifiedMemoryGb}GB</div>
                  <div><span className="text-zinc-500">CPU-only:</span> ~{entry.cpuOnlyRamGb}GB RAM</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(0); }}
          placeholder="Search open-weight models..."
          aria-label="Search open-weight models"
          className="min-w-[220px] rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-700"
        />
        <button
          onClick={() => { setFilterFit('fits'); setPage(0); }}
          className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
            filterFit === 'fits' ? 'bg-emerald-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Estimated fits ({runnableModels.length})
        </button>
        <button
          onClick={() => { setFilterFit('all'); setPage(0); }}
          className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
            filterFit === 'all' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          All open weights ({localModels.length})
        </button>
        <span className="text-[10px] text-zinc-600 ml-2">
          Ranked by: {comparisonTestLabel(selectedTest)} · rank is within this filtered view
        </span>
      </div>

      <p className="mb-3 text-xs text-zinc-400">
        {selectedCohort ? <><a href={selectedCohort.url} className="text-emerald-400 hover:underline" target="_blank" rel="noreferrer">{selectedCohort.sourceName} ↗</a> · {selectedCohort.edition ? `Dataset edition ${selectedCohort.edition}` : 'Dataset date not supplied'}. Only matching test results receive positions; effort and harness settings can differ.</> : 'No matching evaluator results for this test. Models without a result are unranked.'}
      </p>
      {/* Table */}
      <div className="overflow-x-auto border border-zinc-800 rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/80">
              <th className="px-2 py-2 text-center text-zinc-500 font-medium w-8">#</th>
              <th className="px-3 py-2 text-left text-zinc-400 font-medium sticky left-0 bg-zinc-900/95 z-10 min-w-[180px]">Model</th>
              <th className="px-2 py-2 text-center text-zinc-400 font-medium">Released</th>
              <th className="px-2 py-2 text-center text-zinc-400 font-medium min-w-[55px]" title="Total model parameters in billions. Parameter count estimates weight memory; it does not establish quality.">Params</th>
              <th className="px-2 py-2 text-center text-zinc-400 font-medium min-w-[65px]" title="Approximate Q4 weight memory plus a fixed overhead; not a measured runtime or context limit.">VRAM Q4</th>
              <th className="px-3 py-2 text-left text-zinc-400 font-medium min-w-[95px]" title="Whether this model fits in your hardware's available memory.">HW Fit</th>
              <th className="px-2 py-2 text-center text-zinc-400 font-medium min-w-[55px]" title="Highest estimated precision within the planning budget. A compatible build and equivalent benchmark quality are not guaranteed.">Quant</th>
              <th className="px-2 py-2 text-center text-emerald-400 font-medium min-w-[70px]" title="Reported result on the named category test, within one evaluator edition. Hardware fit determines eligibility, not the score.">
                {benchmarkColumnFor(defaultCategoryTest(activeCat.key))?.label} Score
              </th>
              {visibleBenchmarkCols.map(col => (
                <th
                  key={col.key}
                  className="px-2 py-2 text-center text-zinc-400 font-medium min-w-[60px] cursor-pointer hover:text-zinc-200"
                  onClick={() => handleSort(col.key)}
                  title={col.tooltip}
                >
                  {col.label}{sortArrow(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagedModels.map((model, i) => {
              const fit = model.hwFit;
              const style = fit ? FIT_STYLES[fit.fit] : null;
              return (
                <tr
                  key={model.slug}
                  className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${i % 2 === 0 ? '' : 'bg-zinc-900/30'}`}
                >
                  <td className="px-2 py-1.5 text-center tabular-nums text-zinc-500 font-medium">
                    {rowRanks.get(model.slug) ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 sticky left-0 bg-zinc-950/95 z-10">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${TIER_COLORS[model.tier] || TIER_COLORS['D']}`}>
                        {model.tier}
                      </span>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Link href={`/models/${model.slug}`} className="text-zinc-200 hover:text-emerald-400 font-medium">
                            {model.name}
                          </Link>
                          {model.benchmark_coverage < LOW_COVERAGE_THRESHOLD && (
                            <span
                              className="text-[8px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700"
                              title={`Only ${model.benchmark_coverage} tracked benchmarks currently filled for this row`}
                            >
                              LOW DATA
                            </span>
                          )}
                          {model.vision && <span className="text-[9px] px-1 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30" title="Supports vision/image input">VLM</span>}
                          {model.moe_active_b && <span className="text-[9px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30" title={`MoE: ${model.moe_active_b}B active params`}>MoE</span>}
                        </div>
                        <div className="text-[10px] text-zinc-600">
                          {model.provider}
                          {totalTrackedBenchmarks > 0 && (
                            <span> · {model.benchmark_coverage}/{totalTrackedBenchmarks} benchmarks</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-center text-zinc-500 tabular-nums"><ReleaseDate value={model.release} evidence={textReleaseEvidence(model)} /></td>
                  <td className="px-2 py-1.5 text-center text-zinc-400 tabular-nums">
                    {model.params_b ? `${model.params_b}B` : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-center text-zinc-400 tabular-nums">
                    {getQuantMemoryTargets(model).q4 ? `${getQuantMemoryTargets(model).q4}GB` : '—'}
                    {getQuantMemoryTargets(model).note && (
                      <div className="text-[8px] text-amber-500" title={getQuantMemoryTargets(model).note ?? undefined}>architecture-adjusted</div>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {style ? (
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium ${style.bg} ${style.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                        {style.label}
                      </span>
                    ) : (
                      <span className="text-zinc-700">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center text-zinc-500 text-[11px]">
                    {fit?.bestQuant || '—'}
                    {fit?.tokSecEstimate != null && (
                      <div className="text-[9px] text-zinc-600" title="Rough decode speed from the device's memory bandwidth — real speed varies with engine and context">
                        ~{fit.tokSecEstimate} tok/s
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center font-medium tabular-nums text-emerald-400">
                    {categoryScores.get(model.slug)?.toFixed(1) ?? '—'}
                  </td>
                  {visibleBenchmarkCols.map(col => {
                    const val = getBenchmarkValue(model, col.key);
                    return (
                      <td key={col.key} title={benchmarkProvenanceLabel(model, col.key)} className={`px-2 py-1.5 text-center tabular-nums ${scoreColor(val, col.key)}`}>
                        {val !== null ? (col.isElo ? Math.round(val).toLocaleString() : `${val.toFixed(1)}%`) : '—'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={8 + visibleBenchmarkCols.length} className="px-4 py-12 text-center text-zinc-600">No models match your hardware specs and search. Try switching to &ldquo;All open weights&rdquo;.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {sorted.length > PAGE_SIZE && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-500">
          <span>
            Showing {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, sorted.length)} of {sorted.length} ranked models
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage(0)}
              className="rounded bg-zinc-800 px-2 py-1 hover:text-zinc-200 disabled:cursor-default disabled:opacity-30"
            >
              First
            </button>
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              className="rounded bg-zinc-800 px-2 py-1 hover:text-zinc-200 disabled:cursor-default disabled:opacity-30"
            >
              Prev
            </button>
            <span className="px-2">Page {safePage + 1} of {pageCount}</span>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              className="rounded bg-zinc-800 px-2 py-1 hover:text-zinc-200 disabled:cursor-default disabled:opacity-30"
            >
              Next
            </button>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(pageCount - 1)}
              className="rounded bg-zinc-800 px-2 py-1 hover:text-zinc-200 disabled:cursor-default disabled:opacity-30"
            >
              Last
            </button>
          </div>
        </div>
      )}

      <p className="text-[10px] text-zinc-600 mt-3">
        Planning estimates: Q4 0.55 GB per billion parameters + 2 GB; Q8 1.1 GB per billion + 1.5 GB; FP16 2 GB per billion + 2 GB. KV cache is context-dependent and is not calculated. Mac unified memory: ~75% usable for inference.
        {hasMultipleGpus && ' Multi-GPU: VRAM is combined but requires framework support (llama.cpp, vLLM). Expect ~10% overhead from tensor splitting.'}
        {platform === 'cpu' && ' CPU-only mode is modeled as RAM-bound and speed-sensitive, so treat borderline fits as “possible, but slow.”'}
        No per-model speed measurements are available. Offload candidates remain in All open weights, outside the default estimated-fit recommendations.
        {!hasMultipleGpus && platform !== 'cpu' && platform !== 'sbc' && ' Actual usage varies with context length and inference framework (llama.cpp, vLLM, etc).'}
      </p>
      <p className="text-[10px] text-zinc-700 mt-1">
        Every downloadable-weight model remains in the All view. Category scores set the order; benchmark coverage is an evidence warning, never a hidden ranking bonus. Click any benchmark header to rank the current view by that exact benchmark, with missing results placed last.
      </p>
    </div>
  );
}
