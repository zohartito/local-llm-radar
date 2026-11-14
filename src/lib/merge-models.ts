import { LIVEBENCH2_METRICS } from './livebench-v2';
/**
 * Attributed merging for LLM benchmark data. Select an actual published
 * observation, preferring the evaluator to aggregators. Uncited archived
 * benchmark numbers are not published.
 * Keep alternate observations inspectable; never manufacture a midpoint.
 */

import type { SourceResult, SourceModel, EffortVariant } from './live-sources';
import { estimateModelVram } from './hardware';

export interface BenchmarkSourceValue {
  source_id: string;
  source_name: string;
  model_name: string;
  effort?: string;
  value: number;
  is_fallback?: boolean;
  data_date?: string | null;
  selected?: boolean;
}

export interface MergedModel {
  name: string;
  provider: string;
  slug: string;
  slug_aliases?: string[];
  llm_stats_model_id: string | null;
  params_b: number | null;
  context_k: number | null;
  license: string | null;
  tier: string;
  vram_int4_gb: number | null;
  vram_fp16_gb: number | null;
  vision: boolean;
  moe_active_b: number | null;
  release: string | null;
  closed_source: boolean;
  weight_status?: 'open' | 'closed' | 'unknown';
  benchmarks: Record<string, number | null>;
  source_count: Record<string, number>; // per-benchmark source count for confidence
  benchmark_sources: Record<string, BenchmarkSourceValue[]>;
  benchmark_coverage: number;
  // Source-reported enrichment: published API pricing (USD per M tokens) and
  // per-effort benchmark variants. Null/empty when no source publishes them —
  // never estimated.
  input_price_per_m: number | null;
  output_price_per_m: number | null;
  effort_variants: EffortVariant[];
  best_effort: string | null; // effort label of the top-scoring published variant
  // Versioned evidence-weighted scoring. composite_score is the default sort key
  // ("Local Dev Score"); confidence/coverage form a separate trust axis.
  composite_score: number; // 0-100, coding-tilted weighted average of category scores
  confidence: number; // 0-1, reliability-weighted evidence over the FIXED tracked-key count
  coverage: number; // 0-1, present tracked benchmarks / total tracked benchmarks
  // Evidence status. Only 'ranked' rows can be qualified picks. Provisional rows
  // keep a labeled position; insufficient_evidence rows get no composite or
  // category ordinal and no trend.
  rank_status: RankStatus;
  family_coverage: number; // 0-1, observed independent evidence families / all families
  // Every source's claim for each metadata field, most authoritative first, with
  // the displayed one marked `selected`. Curated values carry is_fallback.
  metadata_sources?: Partial<Record<MetadataField, MetadataSourceValue[]>>;
}

export type MetadataField = 'provider' | 'license' | 'params_b' | 'context_k' | 'release' | 'vision' | 'is_open';

export interface MetadataSourceValue {
  source_id: string;
  value: string | number | boolean;
  selected: boolean;
  is_fallback?: boolean;
  source_url?: string;
}

// Versioned scoring stamp so consumers can detect/methodology changes.
// v4 changed source selection, evidence weights, benchmark editions and anchors.
// v5 changes identity: a source row joins a catalog model only when product
// tokens and release markers agree, and metadata comes from one authority-
// ordered observation instead of a blend of live and curated values.
// v6 also excludes uncited archived benchmark values. Old cache blobs and rank
// snapshots cannot be compared with this version.
// v7 adds current-edition comparison observations without changing the index recipe.
export const SCORING_VERSION = 'v7-editioned';

interface CollapsedSourceModel extends SourceModel {
  selected_names?: Record<string, string>;
  // The catalog identity this group resolved to. Callers reuse it instead of
  // re-resolving the group's display name, which can differ from its rows.
  identity: string;
}

interface CollapsedSourceGroup {
  names: string[];
  rows: SourceModel[];
  llmStatsModelIds: string[];
  scores: Record<string, { value: number; modelName: string }>;
  pricePairs: PricePair[];
  effortVariants: EffortVariant[];
}

// Metadata for rows of one source that resolved to one model: the first
// published value in name order, never a median or max of several rows.
function groupMetadata(rows: SourceModel[]): Pick<SourceModel, 'provider' | 'license' | 'params_b' | 'context_k' | 'release' | 'vision' | 'is_open'> {
  const ordered = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const first = <T,>(read: (row: SourceModel) => T | null | undefined): T | undefined => {
    for (const row of ordered) {
      const value = read(row);
      if (value !== null && value !== undefined && value !== '') return value;
    }
    return undefined;
  };
  return {
    provider: first((row) => row.provider),
    license: first((row) => row.license),
    params_b: first((row) => row.params_b) ?? null,
    context_k: first((row) => row.context_k) ?? null,
    release: first((row) => row.release) ?? null,
    vision: ordered.some((row) => row.vision === true) ? true : ordered.some((row) => row.vision === false) ? false : undefined,
    is_open: first((row) => row.is_open),
  };
}

// A price pair as one source actually published it. Pairs are never averaged
// across variants/aliases — that would fabricate a price nobody charges.
interface PricePair {
  input: number | null;
  output: number | null;
}

// Cheapest published pair wins (the "from $X" convention): lowest input price,
// ties broken by output price. Returns nulls when nothing was published.
function pickPublishedPricePair(pairs: PricePair[]): PricePair {
  if (pairs.length === 0) return { input: null, output: null };
  const sorted = [...pairs].sort((a, b) => {
    const aInput = a.input ?? Infinity;
    const bInput = b.input ?? Infinity;
    if (aInput !== bInput) return aInput - bInput;
    return (a.output ?? Infinity) - (b.output ?? Infinity);
  });
  return sorted[0];
}

const MATCH_VARIANT_TOKENS = new Set([
  'thinking',
  'reasoning',
  'reasoner',
  'non',
  'nothinking',
  'nonthinking',
  'it',
  'preview',
  'latest',
  'high',
  'medium',
  'low',
  'xhigh',
  'auto',
  'effort',
  'beta',
  'alpha',
  'experimental',
  'base',
  'chat',
  'instruct',
]);

// Name normalization for matching across sources.
// Uses a token set instead of substring containment so "claude-opus-4-6"
// cannot accidentally fuzzy-match the older "claude-opus-4". Text tokens are
// sorted, but numeric version tokens keep their original order so GPT-4.5 and
// GPT-5.4 do not collapse onto the same key.
function normalize(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) return '';
  const normalized = (name.split('/').pop() || name)
    .toLowerCase()
    .replace(/20\d{2}[-_.]?\d{2}[-_.]?\d{2}/g, ' ')
    // Explicit "-max-effort"/"-ultra-effort" suffixes are effort variants, but
    // bare "max" must stay a name token (Qwen-Max is a distinct model).
    .replace(/[-_. ](max|ultra)[-_. ]?effort/g, ' ')
    .replace(/\(([^)]*)\)/g, ' $1 ')
    // "Command R+" is a different model from "Command R"; keep the plus.
    .replace(/\+/g, ' plus ')
    .replace(/[_/]+/g, ' ')
    .replace(/[^a-z0-9.\-\s]+/g, ' ');

  const tokens = normalized
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((token) => token.replace(/^v(?=\d)/, ''))
    .flatMap((token) => {
      const compactVersion = token.match(/^([a-z]+)(\d+(?:\.\d+)*)$/);
      if (compactVersion && compactVersion[1] !== 'o') {
        return [compactVersion[1], compactVersion[2]];
      }
      return [token];
    })
    .filter((token) => !MATCH_VARIANT_TOKENS.has(token))
    .filter((token) => !/^beta\d*$/.test(token))
    .filter((token) => !/^20\d{2}$/.test(token))
    // Month-day release codes ("0613", "1022") are release markers, not versions.
    .filter((token) => !MONTH_DAY.test(token))
    .filter((token) => !/^\d+k$/.test(token));

  const textTokens: string[] = [];
  const versionTokens: string[] = [];

  for (const token of tokens) {
    if (/^\d+(?:\.\d+)*$/.test(token)) {
      versionTokens.push(...token.split('.'));
      continue;
    }
    textTokens.push(token);
  }

  const key = `${textTokens.sort().join(':')}::${versionTokens.join('.')}`;
  return key === '::' ? '' : key;
}

// normalize() drops these so an undated or differently-worded name can still
// find its catalog row, but they name a different product or checkpoint, not
// an inference setting: GPT-5.2 Chat is not GPT-5.2, Zephyr Alpha is not Beta,
// Phi-3 Mini 128K is not 4K, o1-preview is not o1.
const PRODUCT_VARIANT_TOKENS = new Set(['chat', 'base', 'preview', 'latest', 'alpha', 'beta', 'experimental', 'plus']);
// A "32K" right after one of these is a thinking budget, not a context variant.
const SETTING_TOKENS = new Set(['thinking', 'reasoning', 'reasoner', 'high', 'medium', 'low', 'xhigh', 'minimal', 'auto', 'effort']);
const DATE_PATTERN = /20\d{2}[-_.]?(\d{2})[-_.]?(\d{2})/g;

function variantName(name: unknown): string {
  return typeof name === 'string' ? (name.split('/').pop() || name).toLowerCase() : '';
}

function productTokens(name: unknown): string[] {
  const tokens = variantName(name).replace(DATE_PATTERN, ' ').replace(/\+/g, ' plus ').split(/[^a-z0-9]+/).filter(Boolean);
  const found = new Set<string>();
  tokens.forEach((token, index) => {
    if (PRODUCT_VARIANT_TOKENS.has(token)) found.add(token);
    else if (/^beta\d*$/.test(token)) found.add('beta');
    else if (/^\d+k$/.test(token) && !SETTING_TOKENS.has(tokens[index - 1] ?? '')) found.add(token);
  });
  return [...found].sort();
}

// Release markers: full dates ("2024-10-22", "20241022") as YYYYMMDD and short
// month-day codes ("(1022)", "-0613") as MMDD. normalize() deletes both. Two
// rows whose markers share no release are different releases.
const MONTH_DAY = /^(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;

function releaseMarkers(name: unknown): string[] {
  const markers = new Set<string>();
  const undated = variantName(name).replace(DATE_PATTERN, (match, month: string, day: string) => {
    if (!MONTH_DAY.test(`${month}${day}`)) return match;
    markers.add(match.replace(/[-_.]/g, ''));
    return ' ';
  });
  for (const token of undated.split(/[^a-z0-9]+/)) if (MONTH_DAY.test(token)) markers.add(token);
  return [...markers].sort();
}

// Full dates must agree exactly; a short MMDD code matches the same month-day
// of a full date only (resolveAlias still requires that to be unambiguous).
function sameRelease(a: string, b: string): boolean {
  return a === b || (a.length !== b.length && a.slice(-4) === b.slice(-4));
}

// normalize() plus the product tokens: equal strict keys differ at most in
// effort/thinking settings, instruct/it wording and release markers.
function strictKey(name: unknown): string {
  const base = normalize(name);
  return base ? `${base}|${productTokens(name).join(',')}` : '';
}


/**
 * A published LLM Stats identifier is authoritative across its own feeds.
 * Keep two distinct IDs separate even when a provider reuses a display name;
 * a name is only the conservative fallback for sources without an upstream
 * stable identity, and it keeps product tokens and release markers so two
 * name-only releases never collapse into one row.
 */
function modelIdentityKey(model: { name: unknown; llm_stats_model_id?: unknown }): string {
  const nameKey = strictKey(model.name);
  if (!nameKey) return '';
  const id = model.llm_stats_model_id;
  if (typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    return `llm-stats:${id}`;
  }
  const markers = releaseMarkers(model.name);
  return `name:${nameKey}${markers.length ? `@${markers.join(',')}` : ''}`;
}

function slugify(name: string): string {
  // "Command R+" and "Command R" must not share a URL.
  return name.toLowerCase().replace(/\+/g, '-plus').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// These ambiguous public URLs resolved to these exact upstream records in the
// production snapshot captured 2026-10-22 (audit evidence). Preserve that
// meaning while dated releases gain stable-ID URLs. Never guess a new version.
const LEGACY_URL_MODEL_IDS: Record<string, string> = {
  'muse-wonder': 'muse-wonder-1.0',
  'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
  'gpt-4o': 'gpt-4o-2024-08-06',
};

function stableModelSlug(name: string, id: string | null): string {
  const slug = slugify(id ?? name);
  return LEGACY_URL_MODEL_IDS[slug] && LEGACY_URL_MODEL_IDS[slug] !== id ? `${slug}-unversioned` : slug;
}

// Match exact published names/IDs before attempting the legacy variant alias.
// Preserve dates and instruct/base/thinking here: they can identify different
// releases. An ambiguous broad alias must never override an exact match.
function exactAlias(name: unknown): string {
  return typeof name === 'string'
    ? (name.split('/').pop() || name).toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '')
    : '';
}

function observationPriority(observation: BenchmarkSourceValue): number {
  if (observation.is_fallback || observation.source_id === 'fallback') return 0;
  if (['livebench', 'swebench', 'terminalbench', 'bfcl', 'artificialanalysis', 'livebench2', 'lmarena', 'codearena'].includes(observation.source_id)) return 2;
  return 1;
}

// All benchmark keys we track
export const BENCHMARK_KEYS = [
  ...Object.keys(LIVEBENCH2_METRICS).map(key => 'livebench2_' + key),
  'code_arena', 'arena_elo', 'mmlu_pro', 'gpqa_diamond', 'ifeval',
  'swe_bench', 'humaneval', 'livecodebench',
  'bfcl', 'codeforces_elo', 'aime_2025', 'aime_2026', 'math_500', 'mgsm',
  'livebench_global', 'livebench_reasoning', 'livebench_coding',
  'livebench_agentic_coding', 'livebench_mathematics',
  'livebench_data_analysis', 'livebench_language', 'livebench_if',
  'arc_agi', 'hle_no_tools', 'hle_tools', 'hle_no_tools_text', 'hle_tools_text', 'hle_verified', 'hle', 'simpleqa', 'frontier_math',
  'swe_bench_pro', 'terminal_bench', 'terminal_bench_2', 'terminal_bench_2_1', 'terminal_bench_3', 'terminal_bench_4', 'livecodebench_pro', 'browsecomp', 'mcp_atlas',
  'toolathlon', 'deepswe',
];

/** Last trust boundary before consensus: reject NaN/Infinity and values outside
 * the published measurement domain, regardless of which fetcher produced them. */
export function isValidBenchmarkValue(key: string, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (key === 'codeforces_elo') return value >= 0 && value <= 4000;
  if (key === 'arena_elo') return value >= 600 && value <= 2600;
  // Code Arena is published as an ELO-style rating. This matches the parser's
  // scale guard so malformed low normalized values cannot reach consensus.
  if (key === 'code_arena') return value >= 600 && value <= 2600;
  return value >= 0 && value <= 100;
}

/**
 * Fixed per-benchmark anchors (panel spec, v2-anchored).
 *
 * normalize(key, raw) = clamp(100 * (raw - lo) / (hi - lo), 0, 100)
 *
 * These constants are FIXED — they do NOT depend on the live population — so
 * adding or removing a model never re-ranks the others. `lo`/`hi` pin a
 * realistic dynamic band per benchmark (chance-level floors for hard
 * multiple-choice tests, achievable ceilings for unsolved benchmarks, and
 * fixed ELO bands for arena-style metrics). `reliability` weights each
 * benchmark's trustworthiness as a signal: hold-out / verified harnesses
 * (LiveBench, SWE-bench) are 1.0; crowd-vote arenas are 0.5.
 */
// 2026-10-22 census updates: observed maxima Codeforces 2727, LB agentic 77.3,
// MATH-500 98, ARC 95, FrontierMath 89, SimpleQA 97.1. Raised saturated bands
// with headroom (percentage bands stop at 100); raw observations remain visible.
export const BENCH_ANCHORS: Record<string, { lo: number; hi: number; reliability: number }> = {
  // ELO-style (fixed bands, higher = better)
  // Both ceilings were also outgrown (observed maxima on 2026-08-15: arena_elo
  // 1507 across 3 models, code_arena 2407 across 6). Raised with headroom so the
  // frontier is not compressed into a single pinned value.
  // Chat-PREFERENCE votes, not capability (see this column's own UI tooltip).
  arena_elo: { lo: 1000, hi: 1550, reliability: 0.35 },
  // code_arena reliability cut 0.5 -> 0.35. It is a human vote arena and it
  // disagrees with held-out evaluation in ways that are not survivable at higher
  // weight: measured 2026-08-15, GPT-5.6 Terra scores 1185 (near the floor) while
  // placing top-ten on LiveBench Global at 77.9, and DeepSeek-V4-Flash-0731 tops
  // the arena at 2407 with no LiveBench result to check it against. Rank
  // correlation with LiveBench Global is only +0.68 across the 29 models
  // carrying both. Kept as a coding signal, no longer able to dominate one.
  code_arena: { lo: 1000, hi: 2500, reliability: 0.35 },
  codeforces_elo: { lo: 0, hi: 3000, reliability: 0.7 },

  // Verified / hold-out coding + agentic harnesses
  // hi was 80, which the field outgrew: on 2026-08-15, 16 of 134 measured models
  // scored >= 80, so normalizeAnchored's Math.min(100, ...) pinned all of them to
  // exactly 100. Claude Fable 5's 95.0 and Gemini 3.1 Pro's 80.6 both normalized
  // to 100 and a real 14.4-point lead vanished before scoring. Ceilings must sit
  // above the observed field or the top of the scale goes flat.
  swe_bench: { lo: 0, hi: 100, reliability: 1.0 },
  livecodebench: { lo: 0, hi: 100, reliability: 0.9 },
  humaneval: { lo: 0, hi: 100, reliability: 0.6 },

  // LiveBench family (contamination-resistant hold-out, refreshed monthly)
  livebench_global: { lo: 0, hi: 100, reliability: 1.0 },
  livebench_coding: { lo: 0, hi: 100, reliability: 1.0 },
  // hi 100 -> 70. Agentic coding is genuinely hard: across the 36 measured
  // models the field spans 18.5-65.2 and NOBODY approaches 100, so a 0-100
  // anchor compressed every model into the bottom two thirds and made attempting
  // the benchmark a penalty. Claude Fable 5 leads the field at 62.2 (Gemini 3.1
  // Pro scores 44.1) yet that 62.2 sat below its own 86/89.7/95 on other evals
  // and dragged its average down — withholding it RAISED the composite by 2.3.
  // 70 sits just above the observed maximum, so leading the field reads as
  // leading the field.
  livebench_agentic_coding: { lo: 0, hi: 85, reliability: 1.0 },
  livebench_reasoning: { lo: 0, hi: 100, reliability: 1.0 },
  livebench_mathematics: { lo: 0, hi: 100, reliability: 1.0 },
  livebench_data_analysis: { lo: 0, hi: 100, reliability: 1.0 },
  livebench_language: { lo: 0, hi: 100, reliability: 1.0 },
  livebench_if: { lo: 0, hi: 100, reliability: 1.0 },

  // Reasoning / knowledge (4-choice -> chance floor 25 for GPQA)
  // Reliability now encodes COMPARABILITY — how safely one model's number can be
  // set against another's — not how respected the benchmark is. LiveBench runs
  // every model on the same tasks with a labeled effort setting, so it stays at
  // 1.0. These three are overwhelmingly vendor-self-reported under undisclosed
  // prompting and effort, and MMLU-Pro is saturated on top of that. Measured
  // 2026-08-15, breadth of vendor disclosure was doing the ranking: of the 36
  // models with LiveBench Global, every one of the top 11 was pushed DOWN by the
  // composite while Gemini 3.1 Pro alone rose 9 places (LiveBench #12 -> #3),
  // purely because Google publishes GPQA + MMLU-Pro + ARC-AGI + AIME and OpenAI,
  // Anthropic and Moonshot publish fewer.
  gpqa_diamond: { lo: 25, hi: 100, reliability: 0.7 },
  mmlu_pro: { lo: 0, hi: 100, reliability: 0.5 },
  ifeval: { lo: 0, hi: 100, reliability: 0.6 },

  // ---- Aug-2026 agentic generation --------------------------------------
  // lo/hi MEASURED from a 159-model census of llm-stats scorecards on
  // 2026-08-15 (observed min-max shown per line), with headroom above the
  // observed maximum so a future leader is not clamped flat. Deliberately NOT
  // derived from each benchmark's declared max_score field: the census found
  // that field unreliable (mbpp declares 100 for 0-1 data, codeforces declares
  // 3000 for percentiles), and three separate saturated-ceiling bugs this
  // session came from ceilings that were assumed rather than measured.
  // reliability 0.5: these are vendor-self-reported under undisclosed
  // conditions, same tier as mmlu_pro, so they inform but cannot dominate.
  swe_bench_pro: { lo: 0, hi: 90, reliability: 0.5 },   // observed 40.2-80.0, 45 models / 17 vendors
  // Terminal-Bench 4.0 since 2026-10-19 (the site now serves only the current board):
  // observed 11.2-64.9 across 23 models; hi keeps the ~7% headroom the 2.1 anchor had (88.8 -> 95).
  terminal_bench_4: { lo: 0, hi: 70, reliability: 0.5 },
  browsecomp: { lo: 0, hi: 100, reliability: 0.5 },     // observed 35.5-91.2, 44 models / 18 vendors
  mcp_atlas: { lo: 0, hi: 95, reliability: 0.5 },       // observed 56.1-88.1, 30 models / 12 vendors
  toolathlon: { lo: 0, hi: 85, reliability: 0.5 },      // observed 26.9-75.6, 30 models / 11 vendors
  deepswe: { lo: 0, hi: 85, reliability: 0.5 },         // observed 12.0-73.0, 24 models / 8 vendors

  // Math (saturating self-reported, capped ceilings)
  // Saturated, confirmed independently by two research passes (2026-08-15):
  // five models are tied at a literal 1.000 on aime_2025, aime_2026 sits in a
  // 0.99 cluster, and frontier labs have stopped reporting math_500 — AIME
  // appeared on 0 of 8 official model cards checked. A benchmark everyone aces
  // carries no ranking information, so these inform the Math category but can no
  // longer move it much. They stay visible as columns.
  aime_2025: { lo: 0, hi: 100, reliability: 0.35 },
  aime_2026: { lo: 0, hi: 100, reliability: 0.35 },
  math_500: { lo: 0, hi: 100, reliability: 0.3 },
  mgsm: { lo: 0, hi: 100, reliability: 0.6 },

  // Tool-use / function calling
  bfcl: { lo: 0, hi: 100, reliability: 0.85 },

  // Frontier / hard (very low ceilings — almost unsolved)
  // Vendor-run and thin (17 of 522 models); comparable only loosely.
  // hi 50 -> 90. Same saturated-ceiling bug as swe_bench had: the field now
  // reaches 85.0, so every score at or above 50 was clamped to a flat 100 —
  // Gemini 3.1 Pro's 77.1 was collecting a free perfect mark.
  arc_agi: { lo: 0, hi: 100, reliability: 0.5 },
  frontier_math: { lo: 0, hi: 95, reliability: 0.9 },
  // hi 50 -> 75. Third saturated ceiling found this session: the 159-model
  // census (2026-08-15) observed HLE reaching 64.7, so everything above 50 was
  // clamping to a flat 100. hle is also PROMOTED into scoring below — it was
  // collected and displayed but referenced by no category despite 59 models and
  // 15 vendors publishing it, the widest coverage of any untracked benchmark.
  hle: { lo: 0, hi: 75, reliability: 0.6 },
  hle_no_tools: { lo: 0, hi: 75, reliability: 0.6 },
  hle_tools: { lo: 0, hi: 75, reliability: 0.35 },

  // Factuality
  simpleqa: { lo: 0, hi: 100, reliability: 0.7 },
};

// Default anchor for any benchmark key not explicitly listed: treat as a
// 0-100 percentage with neutral reliability. Keeps the scorer total even if a
// new live key appears before its anchor is curated.
const DEFAULT_ANCHOR = { lo: 0, hi: 100, reliability: 0.7 } as const;

function anchorFor(key: string): { lo: number; hi: number; reliability: number } {
  // aime_2025 is the alias the scorer reads; honor the aime_2026 anchor too.
  return BENCH_ANCHORS[key] ?? DEFAULT_ANCHOR;
}

function normalizeAnchored(key: string, raw: number): number {
  const { lo, hi } = anchorFor(key);
  if (hi <= lo) return 0;
  const scaled = (100 * (raw - lo)) / (hi - lo);
  return Math.min(100, Math.max(0, scaled));
}

// Shrinkage toward a FIXED prior (NOT a population mean) so category scores are
// stable as the roster changes.
const SHRINK_PRIOR = 35;
// Lowered 1.5 -> 0.5. Shrinkage was doing double duty: regularizing noisy cells
// AND penalizing thin coverage. The family-based rank gate (computeRankStatus)
// now handles evidence sufficiency directly, so shrinkage only has to regularize.
//
// At 1.5 the penalty was severe enough to invert real results: Claude Fable 5's
// reasoning rests on a single held-out cell (LiveBench Reasoning 89.7) and was
// crushed to 56.9, while Gemini 3.1 Pro's four vendor-reported cells averaging
// ~82 landed at 65.2 — so the model with the WEAKER number won the category by
// having more numbers. Measured across the 35 models carrying LiveBench Global,
// Spearman agreement between the composite and LiveBench order rises 0.443 ->
// 0.582 at K=0.5.
//
// It keeps improving to ~0.70 at K=0.1, but that is fitting a free parameter to
// one benchmark rather than choosing a regularizer, so it stops here.
const SHRINK_K = 0.5;

// Category buckets the composite combines. Keys map to BENCH_ANCHORS entries.
export const SCORING_CATEGORIES = {
  // humaneval dropped: all 7 independent panel lineages called it saturated
  // (frontier >95% on 164 problems), contaminated, and redundant with
  // livecodebench. Its own reliability was already down-weighted to 0.6.
  coding: ['livebench_coding', 'livebench_agentic_coding', 'swe_bench', 'swe_bench_pro', 'deepswe', 'code_arena', 'livecodebench'],
  agentic: ['livebench_agentic_coding', 'swe_bench', 'terminal_bench_4', 'mcp_atlas', 'toolathlon', 'browsecomp', 'bfcl', 'ifeval'],
  // Only condition-labelled no-tools HLE is comparable as raw reasoning.
  // Unspecified HLE stays visible but cannot move the composite; HLE with
  // tools measures a model+tool system and is likewise displayed separately.
  reasoning: ['livebench_reasoning', 'gpqa_diamond', 'hle_no_tools', 'mmlu_pro', 'arc_agi'],
  // NEW category. livebench_mathematics was collected, anchored and displayed
  // but referenced by no scoring category, so LB Math contributed exactly zero
  // to the headline number despite being one of the five evaluations that
  // actually run every model on the same tasks.
  math: ['livebench_mathematics', 'aime_2026', 'aime_2025', 'math_500'],
  // arena_elo stays in scope but is heavily down-weighted via its reliability,
  // NOT removed. Deleting it was tried and backfired: it also removed arena from
  // the independent-evidence family count, dropping Claude Fable 5 to 3 families
  // and unranking the model that leads LiveBench Global. Low-quality evidence is
  // still evidence of coverage; reliability is the correct dial, not deletion.
  overall: ['livebench_global', 'arena_elo', 'gpqa_diamond', 'swe_bench', 'mmlu_pro', 'ifeval'],
} as const;

type ScoringCategory = keyof typeof SCORING_CATEGORIES;

// Coding-tilted fixed weights; missing categories contribute the prior.
export const COMPOSITE_WEIGHTS: Record<ScoringCategory, number> = {
  coding: 0.40,
  agentic: 0.22,
  reasoning: 0.18,
  math: 0.10,
  overall: 0.10,
};

/**
 * The five LiveBench evaluations are the PRIMARY basis for every category.
 *
 * They are the only benchmarks in this dataset that run every model on the same
 * tasks, in one harness, with the reasoning effort recorded — which is the whole
 * question a ranking has to answer: did these two models take the same test?
 * Everything else here is vendor-self-reported under undisclosed conditions
 * (GPQA, MMLU-Pro, AIME, ARC-AGI), a human popularity vote (Code Arena, LMArena)
 * or scaffold-dependent (SWE-bench).
 *
 * Coverage is the hard limit on going further: only 36 of 508 models carry all
 * five, and only 8 of 303 open-weight models do — of which exactly one fits a
 * 16 GB card. So the secondary benchmarks cannot simply be dropped; they are the
 * only evidence most locally-runnable models have. They stay in the categories
 * as fallback and are held down by reliability instead (LiveBench 1.0 vs
 * 0.35-0.7), so where LiveBench exists it dominates, and where it does not the
 * row is still scored — and flagged by rank_status as the weaker basis it is.
 */
const LIVEBENCH_PRIMARY_KEYS = [
  'livebench_global',
  'livebench_coding',
  'livebench_reasoning',
  'livebench_mathematics',
  'livebench_agentic_coding',
] as const;

export function hasLiveBenchPrimary(model: Pick<MergedModel, 'benchmarks'>): boolean {
  return LIVEBENCH_PRIMARY_KEYS.every((key) => model.benchmarks[key] !== null && model.benchmarks[key] !== undefined);
}

/**
 * Independent evidence FAMILIES among the tracked keys.
 *
 * Counting raw keys overstates how much independent confirmation a model has:
 * the LiveBench sub-scores are one evaluation suite run once, not four separate
 * confirmations. That is why the 36 models carrying the LiveBench family
 * dominated the board while 472 others were ranked on one to three numbers.
 * Rank eligibility counts families, not keys.
 */
const BENCHMARK_FAMILY: Record<string, string> = {
  arena_elo: 'arena',
  code_arena: 'code_arena',
  swe_bench: 'swe_bench',
  gpqa_diamond: 'gpqa',
  mmlu_pro: 'mmlu',
  livecodebench: 'livecodebench',
  humaneval: 'humaneval',
  bfcl: 'bfcl',
  ifeval: 'ifeval',
  arc_agi: 'arc_agi',
  // One suite, one vote.
  livebench_global: 'livebench',
  livebench_coding: 'livebench',
  livebench_reasoning: 'livebench',
  livebench_agentic_coding: 'livebench',
  livebench_mathematics: 'livebench',
  livebench_data_analysis: 'livebench',
  livebench_language: 'livebench',
  livebench_if: 'livebench',
  swe_bench_pro: 'swe_bench_pro',
  terminal_bench_4: 'terminal_bench',
  browsecomp: 'browsecomp',
  mcp_atlas: 'mcp_atlas',
  toolathlon: 'toolathlon',
  deepswe: 'deepswe',
  hle: 'hle',
  hle_no_tools: 'hle',
  hle_tools: 'hle_tools',
  aime_2025: 'aime',
  aime_2026: 'aime',
  math_500: 'math_500',
};

function familyFor(key: string): string {
  return BENCHMARK_FAMILY[key] ?? key;
}

// Rank-eligibility statuses. Only `ranked` rows receive an ordinal position,
// tier letter or winner-card placement; the rest are shown without a rank so a
// thinly-measured model is never presented as beating a well-measured one.
export type RankStatus = 'ranked' | 'provisional' | 'insufficient_evidence';

// Calibrated to what the field actually publishes as of 2026-08-15, not to a
// round number. At a 0.50 family bar only 21 of 522 models qualified and every
// current frontier model failed — Claude Fable 5, GPT-5.6 Sol and Kimi K3 each
// carry exactly 4 independent families (0.364) because 8 of their ~12 numbers
// are the single LiveBench suite. A gate that unranks the field's best models
// is not honesty, it is an empty board.
//
// RANK_MIN_FAMILIES = 4 is the load-bearing condition: it is what excludes
// Grok 4.6, whose 8 benchmarks are ALL LiveBench — one evaluation, one family
// (0.091) — while it sat at #9 on the public board.
//
// Raise this bar as upstream coverage improves; it is a product guardrail, not
// a statistical constant.
// RANK_MIN_FAMILIES is the real gate and has never moved: a row needs at least
// four INDEPENDENT evaluations to carry an ordinal. The fraction is only a proxy
// for the same idea, so it has to scale with the denominator — adding the
// Aug-2026 agentic families took the family count from 11 to 20, and leaving the
// fraction at 0.35 silently redefined the bar as "7 independent evaluations",
// which pushed the entire measured frontier (Claude Fable 5, GPT-5.6 Sol,
// Kimi K3) to provisional and emptied the board. 4/20 = 0.20 restores the
// original intent under the wider denominator.
const RANK_MIN_FAMILY_COVERAGE = 0.2;
const RANK_MIN_FAMILIES = 4;
const RANK_MIN_DOMAINS = 3;
const PROVISIONAL_MIN_FAMILY_COVERAGE = 0.1;

// Union of every benchmark key the composite cares about — used for the
// coverage axis denominator.
const TRACKED_SCORE_KEYS = Array.from(
  new Set(Object.values(SCORING_CATEGORIES).flat())
);

interface CellSignal {
  normalized: number; // 0-100 anchored value
  cellWeight: number; // reliability x sourceSupport x freshness
  reliabilitySupport: number; // reliability x sourceSupport (confidence axis)
}

// Loose input the anchored scorer accepts. `source_count`/`release` are
// optional so category pages can score models that only carry `benchmarks`.
interface ScorableModel {
  benchmarks: Record<string, number | null>;
  source_count?: Record<string, number>;
  benchmark_sources?: Record<string, BenchmarkSourceValue[]>;
  release?: string | null;
}

// Per-benchmark cell signal for a model: anchored value + reliability-weighted
// cell weight. Returns null when the benchmark is absent (missing != zero).
function cellSignalFor(
  model: ScorableModel,
  key: string,
  freshness: number
): CellSignal | null {
  const raw = getBenchmarkValue(model, key);
  if (raw === null) return null;

  const { reliability } = anchorFor(key);
  const allObservations = model.benchmark_sources?.[key];
  const observations = allObservations?.some((row) => row.selected)
    ? allObservations.filter((row) => row.selected)
    : allObservations;
  // Publisher identity is evidence of attribution, not an independent run.
  // Never increase confidence just because an aggregator mirrors a number.
  const sourceCap = observations?.length
    ? Math.max(...observations.map((observation) => {
        if (observation.is_fallback || observation.source_id === 'fallback') return 0.25;
        if (['livebench', 'swebench', 'terminalbench', 'bfcl', 'artificialanalysis'].includes(observation.source_id)) return 1;
        if (['lmarena', 'codearena'].includes(observation.source_id)) return 0.35;
        return 0.5; // vendor/aggregator or unclassified evidence
      }))
    : 0.5; // missing provenance cannot earn evaluator-level trust
  const reliabilitySupport = Math.min(reliability, sourceCap) * 0.75;

  return {
    normalized: normalizeAnchored(key, raw),
    cellWeight: reliabilitySupport * freshness,
    reliabilitySupport,
  };
}

// Reliability-weighted, fixed-prior-shrunk score for one category (0-100), or
// null when the model reports none of the category's benchmarks.
//
// Exported so category pages (leaderboard.ts) score with the exact same
// anchored + shrinkage method as the composite. `source_count` is optional
// there; absent counts default to 1 source (-> 0.75 support).
export function scoreCategoryAnchored(
  model: ScorableModel,
  keys: readonly string[]
): number | null {
  return shrunkCategoryScore(model, keys, freshnessFor(model.release));
}

function shrunkCategoryScore(
  model: ScorableModel,
  keys: readonly string[],
  freshness: number
): number | null {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const key of keys) {
    const cell = cellSignalFor(model, key, freshness);
    if (!cell) continue;
    weightedSum += cell.cellWeight * cell.normalized;
    totalWeight += cell.cellWeight;
  }

  if (totalWeight === 0) return null;
  const rawMean = weightedSum / totalWeight;
  return (totalWeight * rawMean + SHRINK_K * SHRINK_PRIOR) / (totalWeight + SHRINK_K);
}

// Coding-tilted composite of category scores (0-100), renormalized over the
// categories the model actually has data for. Returns 0 when no category has
// any present benchmark.
function computeCompositeScore(
  model: Pick<MergedModel, 'benchmarks' | 'source_count' | 'release'>
): number {
  const freshness = freshnessFor(model.release);
  let weightedSum = 0;
  let weightTotal = 0;
  let presentCategories = 0;

  for (const category of Object.keys(SCORING_CATEGORIES) as ScoringCategory[]) {
    const score = shrunkCategoryScore(model, SCORING_CATEGORIES[category], freshness);
    const weight = COMPOSITE_WEIGHTS[category];
    // An ABSENT category must not be free. Dropping its weight (the old
    // `continue`) made total absence cheaper than partial presence, because
    // shrinkage correctly penalizes a thinly-measured category while
    // renormalization erased an unmeasured one entirely. That asymmetry is a
    // monotonicity violation: removing livebench_reasoning — a benchmark Claude
    // Fable 5 LEADS (89.7 vs Gemini 3.1 Pro's 84.0) — raised Fable's composite
    // from 62.0 to 64.2 and moved it from #2 to #1. Carry the full weight at the
    // zero-evidence limit of shrunkCategoryScore (SHRINK_PRIOR) instead, so
    // deleting data can never improve a score.
    if (score === null) {
      weightedSum += weight * SHRINK_PRIOR;
      weightTotal += weight;
      continue;
    }
    presentCategories += 1;
    weightedSum += weight * score;
    weightTotal += weight;
  }

  // No measured category at all: report 0 rather than the prior, so an entirely
  // unmeasured row cannot present as a mid-table model.
  if (presentCategories === 0) return 0;
  if (weightTotal === 0) return 0;
  return Math.round((weightedSum / weightTotal) * 10) / 10;
}

// Confidence must never rise as evidence falls. A raw mean over present cells
// did exactly that: two high-reliability cells outscored thirteen mixed ones
// (Qwen3.8-27B read 0.675 on 2 benchmarks while Kimi K2.5 read 0.589 on 13), so
// the Trust dot rewarded sparsity — a thinly-measured model looked MORE
// trustworthy than a thoroughly-measured one.
// Dividing by the FIXED tracked-key count (not by how many happen to be
// present) makes confidence strictly monotone in evidence: adding any benchmark
// can only raise it, removing any can only lower it. A shrunk mean was nearly
// monotone but could still dip when a below-average cell arrived, which is the
// same class of bug in miniature. Absent cells contribute 0 by construction.
const CONFIDENCE_DENOMINATOR = () => TRACKED_SCORE_KEYS.length;

/** Evidence status groups correlated benchmark keys into families, requires
 * domain breadth and one evaluator-tier observation for "ranked". Vendor-only
 * results remain visible/scored as provisional. This is not statistical proof.
 */
function computeRankStatus(
  model: ScorableModel
): { rank_status: RankStatus; family_coverage: number } {
  const freshness = freshnessFor(model.release);
  const observedFamilies = new Set<string>();
  const observedDomains = new Set<string>();

  for (const category of Object.keys(SCORING_CATEGORIES) as ScoringCategory[]) {
    for (const key of SCORING_CATEGORIES[category]) {
      if (!cellSignalFor(model, key, freshness)) continue;
      observedFamilies.add(familyFor(key));
      observedDomains.add(category);
    }
  }

  const allFamilies = new Set(TRACKED_SCORE_KEYS.map(familyFor));
  const familyCoverage = allFamilies.size === 0 ? 0 : observedFamilies.size / allFamilies.size;
  const hasEvaluatorEvidence = TRACKED_SCORE_KEYS.some((key) =>
    model.benchmark_sources?.[key]?.some((row) => row.selected !== false && observationPriority(row) === 2)
  );

  const rankEligible =
    hasEvaluatorEvidence &&
    familyCoverage >= RANK_MIN_FAMILY_COVERAGE &&
    observedFamilies.size >= RANK_MIN_FAMILIES &&
    observedDomains.size >= RANK_MIN_DOMAINS &&
    observedDomains.has('coding') &&
    observedDomains.has('agentic');

  const rank_status: RankStatus = rankEligible
    ? 'ranked'
    : familyCoverage >= PROVISIONAL_MIN_FAMILY_COVERAGE
      ? 'provisional'
      : 'insufficient_evidence';

  return { rank_status, family_coverage: Math.round(familyCoverage * 1000) / 1000 };
}

// Coverage (0-1): present tracked / total tracked. Deliberately NOT shrunk —
// it is a plain fraction and the chip renders it as its own 5-dot meter.
function computeConfidenceAndCoverage(
  model: Pick<MergedModel, 'benchmarks' | 'source_count' | 'release'>
): { confidence: number; coverage: number } {
  const freshness = freshnessFor(model.release);
  let supportSum = 0;
  let present = 0;

  for (const key of TRACKED_SCORE_KEYS) {
    const cell = cellSignalFor(model, key, freshness);
    if (!cell) continue;
    supportSum += cell.reliabilitySupport;
    present += 1;
  }

  const evidenceConfidence = supportSum / CONFIDENCE_DENOMINATOR();

  return {
    confidence: present === 0 ? 0 : Math.round(evidenceConfidence * 1000) / 1000,
    coverage: Math.round((present / TRACKED_SCORE_KEYS.length) * 1000) / 1000,
  };
}

// Release age is metadata, not evidence that a measured capability changed.
// Data freshness is reported by the service, never subtracted from capability.
function freshnessFor(_release: string | null | undefined): number {
  void _release;
  return 1;
}

// Derive a tier letter from the composite score (NOT Arena ELO).
function assignTierByComposite(composite: number): string {
  if (composite >= 75) return 'S';
  if (composite >= 60) return 'A';
  if (composite >= 45) return 'B';
  if (composite >= 30) return 'C';
  return 'D';
}

// Known provider mapping
const PROVIDER_MAP: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google',
  meta: 'Meta', 'meta-llama': 'Meta', xai: 'xAI',
  mistral: 'Mistral', 'mistral ai': 'Mistral',
  alibaba: 'Qwen', qwen: 'Qwen', deepseek: 'DeepSeek',
  nvidia: 'Nvidia', microsoft: 'Microsoft', cohere: 'Cohere',
  'zhipu ai': 'Zhipu AI', 'z.ai': 'Zhipu AI', zai: 'Zhipu AI',
  minimax: 'MiniMax',
  moonshot: 'Moonshot', 'moonshot ai': 'Moonshot',
  stepfun: 'StepFun', xiaomi: 'Xiaomi', 'ant-group': 'Ant Group',
  'alibaba cloud / qwen team': 'Qwen', ibm: 'IBM',
};

// Vendors appear under both a bare name and an "-ai" suffixed slug across
// sources (Microsoft / Microsoft-ai, Inception / Inception-ai), which split one
// company into two provider chips in the filter row. Collapse the suffix before
// the PROVIDER_MAP lookup so both spellings land on one canonical provider.
function stripProviderAiSuffix(value: string): string {
  return value.replace(/[-_ ]ai$/i, '');
}

function normalizeProvider(p?: string): string {
  if (!p) return 'Unknown';
  const lower = p.toLowerCase();
  // Try the exact spelling first, then the "-ai"-stripped form, so an alias
  // table entry always wins over the generic collapse.
  const stripped = stripProviderAiSuffix(lower);
  return PROVIDER_MAP[lower] || PROVIDER_MAP[stripped] || (stripped ? capitalizeProvider(stripped) : p);
}

// Title-case a collapsed provider slug so "microsoft-ai" and "Microsoft" render
// as one chip rather than two differently-cased ones.
function capitalizeProvider(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Determine if a model is closed-source based on provider/license
function hasDownloadableWeightLicense(license?: string | null): boolean {
  if (!license) return false;
  const normalized = ` ${license.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  // Whole words only. A substring test read the model-named id "qwen3_8_max"
  // as the Qwen license and "commit"/"limited" as MIT.
  return [
    'apache',
    'mit',
    'gemma',
    'llama',
    'qwen',
    'qianwen',
    'deepseek',
    'open model',
    'openmdw',
    'creative commons',
    'cc by',
    'non commercial',
    'research',
    'community',
  ].some((token) => normalized.includes(` ${token} `));
}

function hasExplicitClosedLicense(license?: string | null): boolean {
  if (!license) return false;
  const normalized = license.toLowerCase().trim();
  return normalized === 'proprietary' || normalized === 'closed';
}

function isClosed(provider: string, license?: string | null): boolean {
  // `closed_source` is consumed as "weights unavailable" throughout the UI.
  // An explicit downloadable-weight license therefore has to beat a provider
  // default: OpenAI publishes GPT-OSS and Google publishes Gemma even though
  // most models from both providers are API-only.
  if (hasDownloadableWeightLicense(license)) return false;
  if (hasExplicitClosedLicense(license)) return true;

  const mostlyClosedProviders = ['openai', 'anthropic', 'google', 'xai'];
  return mostlyClosedProviders.includes(provider.toLowerCase());
}

function parseReleaseDate(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getBenchmarkValue(
  model: Pick<MergedModel, 'benchmarks'>,
  key: string
): number | null {
  return model.benchmarks[key] ?? null;
}

interface FallbackModel {
  name: string;
  provider?: string;
  license?: string | null;
  params_b?: number | null;
  context_k?: number | null;
  release?: string | null;
  vision?: boolean;
  closed_source?: boolean;
  [key: string]: unknown;
}

interface FallbackData {
  models?: FallbackModel[];
  _updated?: string;
}

// One source's metadata claims about a model. Kept per source so the merge
// selects an actual observation instead of a median/max blend of live and
// curated values that no source reported.
interface MetadataObservation {
  source_id: string;
  source_url?: string;
  provider?: string;
  license?: string | null;
  params_b?: number | null;
  context_k?: number | null;
  release?: string | null;
  vision?: boolean;
  is_open?: boolean;
}

// The stable-ID catalog is the metadata authority; name-only boards follow and
// curated fallback only fills a field no live source published.
const METADATA_AUTHORITY = ['zeroeval', 'llmstats_recent', 'codearena', 'lmarena', 'artificialanalysis'];

function metadataRank(sourceId: string): number {
  if (sourceId === 'verified') return -1;
  if (sourceId === 'fallback') return Number.MAX_SAFE_INTEGER;
  const index = METADATA_AUTHORITY.indexOf(sourceId);
  return index === -1 ? METADATA_AUTHORITY.length : index;
}

function byMetadataAuthority(observations: MetadataObservation[]): MetadataObservation[] {
  return [...observations].sort((a, b) => metadataRank(a.source_id) - metadataRank(b.source_id) || a.source_id.localeCompare(b.source_id));
}

function firstObserved<T>(observations: MetadataObservation[], read: (observation: MetadataObservation) => T | null | undefined): T | null {
  for (const observation of observations) {
    const value = read(observation);
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

// Primary-source corrections for a live upstream fact that is wrong. Each one
// names the page it was checked against; keep this list short and dated.
const VERIFIED_METADATA: Record<string, Omit<MetadataObservation, 'source_id'>> = {
  // ZeroEval lists "proprietary"; the model card shows License: gemma and the
  // weights download after accepting Google's terms (checked 2026-10-23).
  'gemma-3n-e4b-it': { license: 'Gemma', is_open: true, source_url: 'https://huggingface.co/google/gemma-3n-E4B-it' },
  // Exact stable API IDs, not their earlier experimental/preview releases.
  // Google's dated release notes checked 2026-10-25.
  'gemini-2.5-pro': { release: '2025-06-17', source_url: 'https://ai.google.dev/gemini-api/docs/changelog' },
  'gemini-2.5-flash': { release: '2025-06-17', source_url: 'https://ai.google.dev/gemini-api/docs/changelog' },
  'gemini-2.5-flash-lite': { release: '2025-07-22', source_url: 'https://ai.google.dev/gemini-api/docs/changelog' },
  // Mistral's lifecycle register dates both Base and Instruct to December 2.
  // The upstream 2509 catalog ID is retained for identity, not used as a date.
  // Quantized/Eagle variants are not assigned the base model's date by inference.
  'mistral-large-3-2509': { release: '2025-12-02', source_url: 'https://legal.mistral.ai/ai-governance/models/mistral-large-3/' },
  'mistral-large-3-675b-base-2512': { release: '2025-12-02', source_url: 'https://legal.mistral.ai/ai-governance/models/mistral-large-3/' },
  'mistral-large-latest': { release: '2025-12-02', source_url: 'https://legal.mistral.ai/ai-governance/models/mistral-large-3/' },
  // The April checkpoint predates the separate August refresh (checked 2026-10-25).
  'command-r-plus-04-2024': { release: '2024-04-04', source_url: 'https://cohere.com/blog/command-r-plus-microsoft-azure' },
};

function verifiedObservationsFor(llmStatsModelId: string | null): MetadataObservation[] {
  const record = llmStatsModelId ? VERIFIED_METADATA[llmStatsModelId] : undefined;
  return record ? [{ source_id: 'verified', ...record }] : [];
}

// Display the chosen license claim in its most readable published spelling
// ("apache_2_0" and "Apache 2.0" are the same claim); never switch claims.
function readableLicense(observations: MetadataObservation[], chosen: string | null): string | null {
  if (!chosen) return null;
  const claim = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(licen[cs]e|agreement)\b/g, '').replace(/[^a-z0-9]/g, '');
  const spellings = observations.map((observation) => observation.license).filter((value): value is string => Boolean(value) && claim(value!) === claim(chosen));
  return spellings.find((value) => /[A-Z]/.test(value) || /\s/.test(value)) ?? chosen;
}

function isClosedLicenseClaim(license: string | null | undefined): boolean {
  const normalized = license?.trim().toLowerCase() ?? '';
  return normalized.includes('proprietary') || normalized === 'closed';
}

function metadataSourcesFor(
  observations: MetadataObservation[],
  selected: Record<MetadataField, string | number | boolean | null>
): Partial<Record<MetadataField, MetadataSourceValue[]>> {
  const sources: Partial<Record<MetadataField, MetadataSourceValue[]>> = {};
  for (const field of Object.keys(selected) as MetadataField[]) {
    let marked = false;
    const rows: MetadataSourceValue[] = [];
    for (const observation of observations) {
      const raw = observation[field];
      const value = field === 'params_b' || field === 'context_k' ? raw || null : raw;
      if (value === null || value === undefined || value === '') continue;
      const isSelected: boolean = !marked && value === selected[field];
      marked ||= isSelected;
      rows.push({
        source_id: observation.source_id,
        value,
        selected: isSelected,
        ...(observation.source_id === 'fallback' ? { is_fallback: true } : {}),
        ...(observation.source_url ? { source_url: observation.source_url } : {}),
      });
    }
    if (rows.length) sources[field] = rows;
  }
  return sources;
}

type ModelData = {
  names: string[];
  // Names from roster sources (primary boards and recent scorecards).
  rosterNames: string[];
  // Curated names: URL aliases, and a display name only when no roster source named the model.
  fallbackNames: string[];
  publishedNames: string[];
  fallbackMoeActive: number | null;
  llmStatsModelIds: string[];
  metadata: MetadataObservation[];
  scores: Record<string, number[]>;
  provenance: Record<string, BenchmarkSourceValue[]>;
  pricePairs: PricePair[];
  effortVariants: EffortVariant[];
};

function metadataFrom(sourceId: string, model: SourceModel): MetadataObservation {
  return {
    source_id: sourceId,
    provider: model.provider,
    license: model.license,
    params_b: model.params_b,
    context_k: model.context_k,
    release: model.release,
    vision: model.vision,
    is_open: model.is_open,
  };
}

// Roster sources define which models exist; every other board only enriches.
const PRIMARY_SOURCES = ['lmarena', 'zeroeval'];
const SUPPLEMENTAL_ROSTER_SOURCES = ['llmstats_recent'];

export function mergeAllSources(sourceResults: SourceResult[], fallbackData?: FallbackData): MergedModel[] {
  const modelIndex = new Map<string, ModelData>();
  // Name-only sources may enrich a stable record only when an upstream ID has
  // established one unambiguous alias. A collision makes that alias unusable
  // rather than silently choosing either model.
  const exactAliases = new Map<string, string | null>();
  // Strict key -> every identity publishing it; release markers decide between
  // them (see resolveAlias).
  const strictAliases = new Map<string, Set<string>>();
  const identityMarkers = new Map<string, Set<string>>();

  // Helper to get or create an entry
  function getEntry(norm: string): ModelData {
    if (!modelIndex.has(norm)) {
      modelIndex.set(norm, {
        names: [], rosterNames: [], fallbackNames: [], publishedNames: [], fallbackMoeActive: null, llmStatsModelIds: [], metadata: [],
        scores: {}, provenance: {}, pricePairs: [], effortVariants: [],
      });
    }
    return modelIndex.get(norm)!;
  }

  // Stable IDs register as join targets up front. Name-only primary rows
  // register after the primary pass, so other boards can still find a model
  // that only LMArena lists, without primary rows matching each other loosely.
  function rememberAliases(model: { name: unknown; llm_stats_model_id?: unknown; release?: string | null }, identity: string, options: { nameOnly?: boolean } = {}) {
    if (!identity || (!options.nameOnly && !identity.startsWith('llm-stats:'))) return;
    const id = identity.startsWith('llm-stats:') ? model.llm_stats_model_id : null;
    for (const alias of [exactAlias(model.name), exactAlias(id)]) {
      if (!alias) continue;
      const existing = exactAliases.get(alias);
      exactAliases.set(alias, existing === undefined || existing === identity ? identity : null);
    }
    for (const published of [model.name, id]) {
      const key = strictKey(published);
      if (!key) continue;
      strictAliases.set(key, new Set([...(strictAliases.get(key) ?? []), identity]));
      identityMarkers.set(identity, new Set([...(identityMarkers.get(identity) ?? []), ...releaseMarkers(published)]));
    }
    // The catalog's own release date confirms a dated board name: "o4-mini
    // (2025-04-16)" is o4-mini, released 2025-04-16.
    if (identity.startsWith('llm-stats:') && model.release) {
      identityMarkers.set(identity, new Set([...(identityMarkers.get(identity) ?? []), ...releaseMarkers(model.release)]));
    }
  }

  /**
   * Broad match for a name without an exact alias. Returns the identity,
   * `null` for an ambiguous or conflicting match, `undefined` when unseen.
   * A dated row only joins the release carrying that date, or the single
   * undated catalog row for that product; "GPT-4 (0314)" never joins gpt-4-0613.
   */
  function resolveAlias(name: unknown): string | null | undefined {
    const candidates = [...(strictAliases.get(strictKey(name)) ?? [])];
    if (candidates.length === 0) return undefined;
    const markers = releaseMarkers(name);
    // An undated name with several candidates is ambiguous, even if only one
    // is undated: "Kimi-K2-Thinking" is not the undated "Kimi K2 Instruct".
    if (markers.length === 0) return candidates.length === 1 ? candidates[0] : null;
    const matching = candidates.filter((identity) => markers.some((marker) => [...(identityMarkers.get(identity) ?? [])].some((known) => sameRelease(marker, known))));
    // A dated name never joins a row whose release it cannot confirm:
    // "DeepSeek-V2.5 (1210)" is a later release than undated DeepSeek-V2.5.
    return matching.length === 1 ? matching[0] : null;
  }

  function resolvedIdentity(
    model: { name: unknown; llm_stats_model_id?: unknown },
    options: { retainAmbiguousNameOnlyPrimary?: boolean } = {}
  ): string {
    const identity = modelIdentityKey(model);
    if (!identity || identity.startsWith('llm-stats:')) return identity;
    const exact = exactAliases.get(exactAlias(model.name));
    if (exact) return exact;
    if (exact === null) return options.retainAmbiguousNameOnlyPrimary ? identity : '';
    const alias = resolveAlias(model.name);
    // `null` is an explicit collision marker, distinct from an unseen alias.
    if (alias === null) return options.retainAmbiguousNameOnlyPrimary ? identity : '';
    return alias === undefined ? identity : alias;
  }

  // Helper to add model data to an entry
  function addToEntry(entry: ModelData, m: CollapsedSourceModel, sourceMeta: { source_id: string; source_name: string }) {
    entry.names.push(m.name);
    if ([...PRIMARY_SOURCES, ...SUPPLEMENTAL_ROSTER_SOURCES].includes(sourceMeta.source_id)) entry.rosterNames.push(m.name);
    if (m.llm_stats_model_id && ['zeroeval', 'llmstats_recent'].includes(sourceMeta.source_id)) entry.publishedNames.push(m.name);
    if (m.llm_stats_model_id) entry.llmStatsModelIds.push(m.llm_stats_model_id);
    entry.metadata.push(metadataFrom(sourceMeta.source_id, m));
    if (m.input_price_per_m != null || m.output_price_per_m != null) {
      entry.pricePairs.push({ input: m.input_price_per_m ?? null, output: m.output_price_per_m ?? null });
    }
    if (m.effort_variants?.length) entry.effortVariants.push(...m.effort_variants);

    for (const [key, val] of Object.entries(m.scores)) {
      if (!isValidBenchmarkValue(key, val)) continue;
      if (!entry.scores[key]) entry.scores[key] = [];
      entry.scores[key].push(val);
      if (!entry.provenance[key]) entry.provenance[key] = [];
      entry.provenance[key].push({
        source_id: sourceMeta.source_id,
        source_name: sourceMeta.source_name,
        model_name: m.selected_names?.[key] || m.name,
        ...(m.run_effort ? { effort: m.run_effort } : {}),
        value: val,
        data_date: sourceResults.find((source) => source.source_id === sourceMeta.source_id)?.data_date ?? null,
      });
    }
  }

  // `own`: group by each row's own identity (alias-table construction only).
  // `primary`: resolve every raw row exact-first, keep unmatched rows as their
  // own name-only identity. `enrich`: resolve every raw row, drop unmatched.
  // Rows are resolved one by one BEFORE grouping; grouping a whole board by a
  // lossy name first let one release's value land on another release.
  function collapseSourceModels(models: SourceModel[], mode: 'own' | 'primary' | 'enrich'): CollapsedSourceModel[] {
    const grouped = new Map<string, CollapsedSourceGroup>();

    for (const model of models) {
      const identity = mode === 'own'
        ? modelIdentityKey(model)
        : resolvedIdentity(model, { retainAmbiguousNameOnlyPrimary: mode === 'primary' });
      if (!identity) continue;

      if (!grouped.has(identity)) {
        grouped.set(identity, {
          names: [],
          rows: [],
          llmStatsModelIds: [],
          scores: {},
          pricePairs: [],
          effortVariants: [],
        });
      }

      const entry = grouped.get(identity)!;
      entry.names.push(model.name);
      entry.rows.push(model);
      if (model.llm_stats_model_id) entry.llmStatsModelIds.push(model.llm_stats_model_id);
      if (model.input_price_per_m != null || model.output_price_per_m != null) {
        entry.pricePairs.push({ input: model.input_price_per_m ?? null, output: model.output_price_per_m ?? null });
      }
      if (model.effort_variants?.length) entry.effortVariants.push(...model.effort_variants);

      // Multiple rows from the same source should count as one source. Rows that
      // resolve to one model differ only in effort/thinking settings, and all
      // tracked benchmarks are "higher is better", so keep the best published one.
      for (const [key, value] of Object.entries(model.scores)) {
        if (!isValidBenchmarkValue(key, value)) continue;
        const existing = entry.scores[key];
        if (!existing || value > existing.value) {
          entry.scores[key] = { value, modelName: model.name };
        }
      }
    }

    return [...grouped.entries()].map(([identity, entry]) => ({
      identity,
      name: pickBestName(entry.names),
      ...groupMetadata(entry.rows),
      llm_stats_model_id: mostCommon(entry.llmStatsModelIds) || (identity.startsWith('llm-stats:') ? identity.slice('llm-stats:'.length) : null),
      scores: Object.fromEntries(
        Object.entries(entry.scores).map(([key, selected]) => [key, selected.value])
      ),
      selected_names: Object.fromEntries(
        Object.entries(entry.scores).map(([key, selected]) => [key, selected.modelName])
      ),
      input_price_per_m: pickPublishedPricePair(entry.pricePairs).input,
      output_price_per_m: pickPublishedPricePair(entry.pricePairs).output,
      effort_variants: dedupeEffortVariants(entry.effortVariants),
    }));
  }

  function applyFallbackModel(entry: ModelData, model: FallbackModel) {
    entry.fallbackNames.push(model.name);
    if ('moe_active_b' in model && typeof model.moe_active_b === 'number' && model.moe_active_b > 0) entry.fallbackMoeActive = model.moe_active_b;
    if (typeof model.llm_stats_model_id === 'string') entry.llmStatsModelIds.push(model.llm_stats_model_id);
    // Archived metadata is ranked last: it fills a field only when no live
    // source published one, and is never blended with a live value.
    entry.metadata.push({
      source_id: 'fallback',
      provider: model.provider,
      license: model.license,
      params_b: model.params_b,
      context_k: model.context_k,
      release: model.release,
      vision: model.vision,
      is_open: model.closed_source === undefined ? undefined : !model.closed_source,
    });
    if (
      entry.pricePairs.length === 0 &&
      (typeof model.input_price_per_m === 'number' || typeof model.output_price_per_m === 'number')
    ) {
      entry.pricePairs.push({
        input: typeof model.input_price_per_m === 'number' ? model.input_price_per_m : null,
        output: typeof model.output_price_per_m === 'number' ? model.output_price_per_m : null,
      });
    }
    if (entry.effortVariants.length === 0 && Array.isArray(model.effort_variants)) {
      entry.effortVariants.push(...(model.effort_variants as EffortVariant[]));
    }

  }

  function applyBackfillSourceModel(
    entry: ModelData,
    model: CollapsedSourceModel,
    sourceMeta: { source_id: string; source_name: string }
  ) {
    entry.names.push(model.name);
    if (model.llm_stats_model_id) entry.llmStatsModelIds.push(model.llm_stats_model_id);
    entry.metadata.push(metadataFrom(sourceMeta.source_id, model));
    if (entry.pricePairs.length === 0 && (model.input_price_per_m != null || model.output_price_per_m != null)) {
      entry.pricePairs.push({ input: model.input_price_per_m ?? null, output: model.output_price_per_m ?? null });
    }
    if (entry.effortVariants.length === 0 && model.effort_variants?.length) {
      entry.effortVariants.push(...model.effort_variants);
    }

    for (const [key, value] of Object.entries(model.scores)) {
      if (!isValidBenchmarkValue(key, value)) continue;
      if (entry.scores[key]?.length) continue;

      entry.scores[key] = [value];
      if (!entry.provenance[key]) entry.provenance[key] = [];
      entry.provenance[key].push({
        source_id: sourceMeta.source_id,
        source_name: sourceMeta.source_name,
        model_name: model.selected_names?.[key] || model.name,
        value,
        data_date: sourceResults.find((source) => source.source_id === sourceMeta.source_id)?.data_date ?? null,
      });
    }
  }

  // PHASE 1: Build canonical model list from PRIMARY sources (Arena + ZeroEval)
  // These define which models appear on our leaderboard. First construct the
  // complete stable-ID alias table so grouping cannot depend on source order.
  const primarySources = sourceResults.filter((source) => !source.error && PRIMARY_SOURCES.includes(source.source_id));

  for (const source of primarySources) {
    for (const model of collapseSourceModels(source.models, 'own')) {
      rememberAliases(model, model.identity);
    }
  }

  for (const source of primarySources) {
    for (const m of collapseSourceModels(source.models, 'primary')) {
      const entry = getEntry(m.identity);
      addToEntry(entry, m, { source_id: source.source_id, source_name: source.source_name });
    }
  }

  for (const [identity, entry] of modelIndex) {
    if (!identity.startsWith('name:')) continue;
    for (const name of new Set(entry.names)) rememberAliases({ name }, identity, { nameOnly: true });
  }

  // PHASE 1B: Add recent published scorecard models to the roster so the site
  // can surface frontier releases before every benchmark source has indexed them.
  for (const source of sourceResults) {
    if (source.error || !source.models.length) continue;
    if (!SUPPLEMENTAL_ROSTER_SOURCES.includes(source.source_id)) continue;
    const models = collapseSourceModels(source.models, 'enrich');

    for (const m of models) {
      const identity = m.identity;

      const entry = modelIndex.get(identity);
      if (entry) {
        applyBackfillSourceModel(entry, m, { source_id: source.source_id, source_name: source.source_name });
        continue;
      }

      const supplementalEntry = getEntry(identity);
      addToEntry(supplementalEntry, m, { source_id: source.source_id, source_name: source.source_name });
      rememberAliases(m, identity);
    }
  }

  const hasLivePrimaryModels = sourceResults.some(
    (source) =>
      PRIMARY_SOURCES.includes(source.source_id) &&
      !source.error &&
      source.models.length > 0
  );

  // Curated data is a fallback, not a second roster. When live primary sources are
  // healthy, only use it to enrich models that already exist in the live set.
  // If all primary live sources fail, let the curated file stand in for the roster.
  if (fallbackData?.models) {
    for (const m of fallbackData.models) {
      const identity = resolvedIdentity(m);
      if (!identity) continue;
      const entry = modelIndex.get(identity);

      if (entry) {
        applyFallbackModel(entry, m);
        continue;
      }

      if (!hasLivePrimaryModels) {
        const fallbackEntry = getEntry(identity);
        applyFallbackModel(fallbackEntry, m);
      }
    }
  }

  // PHASE 2: Merge scores from SECONDARY sources into existing models only
  // Secondary sources (LiveBench, OLLB, SWE-bench) don't add new models.
  for (const source of sourceResults) {
    if (source.error || !source.models.length) continue;
    if (source.source_id === 'livebench2' || PRIMARY_SOURCES.includes(source.source_id) || SUPPLEMENTAL_ROSTER_SOURCES.includes(source.source_id)) continue;
    const models = collapseSourceModels(source.models, 'enrich');

    for (const m of models) {
      const entry = modelIndex.get(m.identity);
      if (entry) {
        addToEntry(entry, m, { source_id: source.source_id, source_name: source.source_name });
      }
    }
  }

  // A v2 CSV row is one evaluator-selected run. Never strip effort, dates
  // or product suffixes when joining it. Keep unmatched runs on the board
  // without inventing a catalog ID, license, release date, or hardware fit.
  const v2 = sourceResults.find(s => s.source_id === 'livebench2' && !s.error);
  if (v2) {
    const aliasCounts = new Map<string, number>();
    for (const model of v2.models) {
      const alias = exactAlias(model.name);
      aliasCounts.set(alias, (aliasCounts.get(alias) ?? 0) + 1);
    }
    for (const model of v2.models) {
      const alias = exactAlias(model.name);
      const match = aliasCounts.get(alias) === 1 ? exactAliases.get(alias) : null;
      const identity = match && modelIndex.has(match) ? match : 'livebench2:' + model.name;
      addToEntry(getEntry(identity), { ...model, identity }, v2);
    }
  }

  // Archived benchmark numbers have no cell-level source receipts. Keep the
  // fallback roster/metadata, but never publish those numbers as observations
  // or allow them to affect scores, evidence, tiers, or recommendations.

  const merged: MergedModel[] = [];

  for (const [identity, entry] of modelIndex) {
    // Pick best name (prefer shorter, cleaner names)
    // Display name: upstream-ID catalog, then roster boards, then curated, then
    // enrichment boards. A curated spelling never renames (or re-slugs) a live row.
    const name = pickBestName([entry.publishedNames, entry.rosterNames, entry.fallbackNames, entry.names].find((names) => names.length) ?? []);
    // Each field is one actual observation from the most authoritative source
    // that published it; curated fallback only when no live source did.
    const llmStatsModelId = mostCommon(entry.llmStatsModelIds) || null;
    const observations = byMetadataAuthority([...entry.metadata, ...verifiedObservationsFor(llmStatsModelId)]);
    const live = observations.filter((observation) => observation.source_id !== 'fallback');
    const rawProvider = firstObserved(observations, (observation) => observation.provider);
    const provider = normalizeProvider(rawProvider ?? undefined);
    const license = readableLicense(observations, firstObserved(observations, (observation) => observation.license));
    const params = firstObserved(observations, (observation) => observation.params_b || null);
    const context = firstObserved(observations, (observation) => observation.context_k || null);
    const release = firstObserved(observations, (observation) => observation.release);
    const liveVision = live.filter((observation) => observation.vision !== undefined);
    const vision = (liveVision.length ? liveVision : observations).some((observation) => observation.vision === true);
    // Openness is a FACT, not a popularity vote among source flags.
    //
    // Qwen3.8 Max (2400B, license "Proprietary") was once published as
    // OPEN-WEIGHT because flags outvoted the license, and a tie resolved to
    // open. Claiming a model is downloadable when it is not is the harmful
    // direction: ties resolve CLOSED, and live sources that disagree (one
    // downloadable license, one closed claim) make the status unknown unless a
    // verified primary-source record settles it.
    const hasVerifiedLicense = observations.some((observation) => observation.source_id === 'verified' && observation.license);
    const hasLiveOpenness = live.some((observation) => observation.is_open !== undefined || observation.license);
    const openFlags = (hasLiveOpenness ? live : observations)
      .map((observation) => observation.is_open)
      .filter((value): value is boolean => value !== undefined);
    const openVotes = openFlags.filter((value) => value).length;
    const licenseConflict = !hasVerifiedLicense
      && live.some((observation) => isClosedLicenseClaim(observation.license))
      && live.some((observation) => hasDownloadableWeightLicense(observation.license));
    const downloadable = hasDownloadableWeightLicense(license);
    const isOpen = licenseConflict
      ? false
      : downloadable
        ? true
        : isClosed(provider, license)
          ? false
          : openFlags.length > 0
            ? openVotes * 2 > openFlags.length
            : false;
    const weightStatus = isOpen ? 'open'
      : licenseConflict ? 'unknown'
        : isClosed(provider, license) || openFlags.includes(false) ? 'closed' : 'unknown';
    const metadataSources = metadataSourcesFor(observations, { provider: rawProvider, license, params_b: params, context_k: context, release, vision, is_open: isOpen });

    // Consensus scores
    const benchmarks: Record<string, number | null> = {};
    const sourceCount: Record<string, number> = {};
    const benchmarkSources: Record<string, BenchmarkSourceValue[]> = {};

    for (const key of BENCHMARK_KEYS) {
      const vals = entry.scores[key];
      const provenance = [...(entry.provenance[key] || [])].sort((a, b) => {
        const priority = observationPriority(b) - observationPriority(a);
        if (priority) return priority;
        // A deterministic publisher preference, never "highest wins" across
        // conflicting sources. Alternate reports remain in provenance.
        return a.source_id.localeCompare(b.source_id) || a.model_name.localeCompare(b.model_name);
      });
      if (vals && vals.length > 0) {
        benchmarks[key] = provenance[0].value;
        sourceCount[key] = vals.length;
        benchmarkSources[key] = provenance.map((row, index) => ({ ...row, selected: index === 0 }));
      } else {
        benchmarks[key] = null;
        sourceCount[key] = 0;
        benchmarkSources[key] = [];
      }
    }

    const vram = estimateModelVram(name, params);
    const benchmarkCoverage = Object.values(benchmarks).filter((value) => value !== null).length;

    const scoringInput = { benchmarks, source_count: sourceCount, benchmark_sources: benchmarkSources, release };
    const compositeScore = computeCompositeScore(scoringInput);
    const { confidence, coverage } = computeConfidenceAndCoverage(scoringInput);
    const { rank_status, family_coverage } = computeRankStatus(scoringInput);

    const effortVariants = dedupeEffortVariants(entry.effortVariants);
    const bestVariant = effortVariants.find((variant) => variant.livebench_global !== null) ?? null;
    const pricePair = pickPublishedPricePair(entry.pricePairs);

    merged.push({
      name,
      provider,
      slug: identity.startsWith('livebench2:') ? 'livebench2-' + identity.slice('livebench2:'.length) : stableModelSlug(name, llmStatsModelId),
      slug_aliases: identity.startsWith('livebench2:') ? [] : [...new Set([...entry.names, ...entry.fallbackNames].map(slugify))].filter((alias) => !LEGACY_URL_MODEL_IDS[alias] || LEGACY_URL_MODEL_IDS[alias] === llmStatsModelId),
      llm_stats_model_id: llmStatsModelId,
      params_b: params ? Math.round(params * 10) / 10 : null,
      context_k: context,
      license,
      tier: '',
      vram_int4_gb: vram.q4,
      vram_fp16_gb: vram.fp16,
      vision,
      moe_active_b: entry.fallbackMoeActive, // Published curated metadata only; never guessed from speed.
      release,
      closed_source: !isOpen,
      weight_status: weightStatus,
      benchmarks,
      source_count: sourceCount,
      benchmark_sources: benchmarkSources,
      benchmark_coverage: benchmarkCoverage,
      input_price_per_m: pricePair.input,
      output_price_per_m: pricePair.output,
      effort_variants: effortVariants,
      best_effort: bestVariant?.effort ?? null,
      composite_score: compositeScore,
      confidence,
      coverage,
      rank_status,
      family_coverage,
      metadata_sources: metadataSources,
    });
  }

  // Filter: keep any primary-roster model that has at least one published
  // benchmark, even if coverage is sparse. The UI already marks low-data rows,
  // and dropping 1-score models hides real published benchmarks like
  // Code Arena-only open models.
  const filtered = merged.filter(m => {
    const filled = Object.values(m.benchmarks).filter(v => v !== null).length;
    // During an outage, keep the metadata roster visible without inventing scores.
    return filled >= 1 || !hasLivePrimaryModels;
  });

  // Sort by the new anchored "Local Dev Score" (composite_score). It is stable
  // as the roster changes because anchors and the shrinkage prior are fixed.
  // Arena ELO is demoted to a tertiary tie-breaker only.
  filtered.sort((a, b) => {
    if (b.composite_score !== a.composite_score) return b.composite_score - a.composite_score;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (b.benchmark_coverage !== a.benchmark_coverage) return b.benchmark_coverage - a.benchmark_coverage;

    const releaseDiff = parseReleaseDate(b.release) - parseReleaseDate(a.release);
    if (releaseDiff !== 0) return releaseDiff;

    return (getBenchmarkValue(b, 'arena_elo') || 0) - (getBenchmarkValue(a, 'arena_elo') || 0);
  });

  // Tiers now derive from composite_score, not Arena ELO.
  for (const model of filtered) {
    model.tier = model.benchmark_coverage > 0 ? assignTierByComposite(model.composite_score) : '';
  }

  // Honesty flags carried on the returned array object (the shared contract).
  // When no live primary models exist, the curated file stood in as the roster,
  // so the dataset must be transparently marked as fallback with its data date.
  const result = filtered as MergedModel[] & { usedFallback: boolean; dataDate: string | null };
  result.usedFallback = !hasLivePrimaryModels;
  result.dataDate = result.usedFallback ? (fallbackData?._updated ?? 'unknown') : null;

  return result;
}

function pickBestName(names: string[]): string {
  const uniqueNames = [...new Set(names)];
  return uniqueNames
    .sort((a, b) => {
      const scoreDiff = scoreName(b) - scoreName(a);
      if (scoreDiff !== 0) return scoreDiff;
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    })[0] || names[0];
}

// Collapse duplicate variant rows (same raw source row seen via multiple
// paths) and keep the list sorted best-scoring first.
function dedupeEffortVariants(variants: EffortVariant[]): EffortVariant[] {
  const byName = new Map<string, EffortVariant>();
  for (const variant of variants) {
    if (!byName.has(variant.variant_name)) byName.set(variant.variant_name, variant);
  }
  return [...byName.values()].sort(
    (a, b) => (b.livebench_global ?? -1) - (a.livebench_global ?? -1)
  );
}

function mostCommon(arr: string[]): string | undefined {
  if (arr.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const v of arr) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function scoreName(name: string): number {
  let score = 0;

  if (!name.includes('/')) score += 4;
  if (/[A-Z]/.test(name)) score += 5;
  if (/\s/.test(name)) score += 3;
  if (/[-_]/.test(name) && name === name.toLowerCase()) score -= 5;
  if (/\d{6,8}/.test(name)) score -= 4;
  if (/\b(thinking|preview|reasoning|high|medium|low|xhigh|auto|beta)\b/i.test(name)) score -= 3;
  if (/[()]/.test(name)) score -= 1;

  return score;
}
