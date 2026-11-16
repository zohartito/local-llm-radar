/**
 * Live data fetchers for LLM benchmark sources.
 * Each fetcher returns a normalized array of model scores.
 * No database — pure fetch + parse. Results are merged by the API route.
 */

import { liveBench2Edition, liveBench2Run, parseLiveBench2 } from './livebench-v2';

export interface SourceModel {
  name: string;
  provider?: string;
  run_effort?: string;
  license?: string;
  llm_stats_model_id?: string | null;
  params_b?: number | null;
  context_k?: number | null;
  is_open?: boolean;
  release?: string | null;
  vision?: boolean;
  scores: Record<string, number | null>;
  // Published API pricing in USD per million tokens (ZeroEval). Display-only —
  // never invented; null/absent when the source does not publish it.
  input_price_per_m?: number | null;
  output_price_per_m?: number | null;
  // Per-effort rows a source publishes for the same base model (LiveBench).
  effort_variants?: EffortVariant[];
}

// One published effort/thinking configuration of a model, with its measured
// scores and (when the source publishes it) the measured cost of running the
// full benchmark suite at that effort. All values are source-reported.
export interface EffortVariant {
  variant_name: string; // raw source row, e.g. "claude-opus-4-7-xhigh-effort"
  effort: string; // minimal | low | medium | high | xhigh | auto | thinking | non-thinking | standard
  livebench_global: number | null;
  livebench_coding: number | null;
  livebench_reasoning: number | null;
  run_cost_usd: number | null; // measured $ for the full LiveBench run at this effort
}

export interface SourceResult {
  source_id: string;
  source_name: string;
  models: SourceModel[];
  fetched_at: string;
  error?: string;
  // Upstream publication OR benchmark-edition date, distinct from fetch time.
  // LiveBench filenames date the task edition, not each model evaluation.
  // Null when no upstream date is available.
  data_date?: string | null;
}

export interface FetchSourceOptions {
  signal?: AbortSignal;
  /** Audit-only receipt of the exact legacy LiveBench inputs used by this fetch. */
  captureLiveBench?: (csv: string, categories: Record<string, string[]>) => void;
}

interface DatasetRowsResponse<T> {
  rows?: Array<{ row: T }>;
  num_rows_total?: number;
}

interface ZeroEvalModelRow {
  model_name?: string;
  name?: string;
  model_id?: string;
  organization?: string;
  organization_name?: string;
  license?: string;
  params?: number | null;
  context?: number | null;
  context_window?: number | null;
  release_date?: string | null;
  multimodal?: boolean | null;
  input_price?: number | null;
  output_price?: number | null;
  gpqa_score?: number | null;
  aime_2025_score?: number | null;
  swe_bench_verified_score?: number | null;
  arc_agi_v2_score?: number | null;
  hle_score?: number | null;
  mmmu_score?: number | null;
  simpleqa_score?: number | null;
  frontiermath_score?: number | null;
  livecodebench_v6_score?: number | null;
  codeforces_score?: number | null;
  coding_arena_score?: number | null;
  // Same values as the bare llm-stats scorecard ids (swe-bench-pro, browsecomp,
  // toolathlon, mcp-atlas), published here for every model rather than only
  // the 120-day scorecard window. Verified against 50 scorecards 2026-10-23.
  swe_bench_pro_score?: number | null;
  browsecomp_score?: number | null;
  toolathlon_score?: number | null;
  mcp_atlas_score?: number | null;
}

interface ArenaRow {
  model_name?: string;
  organization?: string;
  license?: string;
  rating?: number;
  vote_count?: number;
  category?: string;
}

interface OpenLLMRow {
  fullname?: string;
  '#Params (B)'?: number;
  'Hub License'?: string;
  'MMLU-PRO'?: number;
  GPQA?: number;
  IFEval?: number;
  'MATH Lvl 5'?: number;
}

interface SweBenchEntry {
  name?: string;
  resolved?: number;
  tags?: string[];
}

interface SweBenchCategory {
  name?: string;
  results?: SweBenchEntry[];
}

interface LLMStatsLeaderboardRow {
  model_id?: string;
  name?: string;
  organization?: string;
  license?: string;
  params?: number | null;
  context?: number | null;
  release_date?: string | null;
  multimodal?: boolean | null;
  coding_arena_score?: number | null;
}

interface LLMStatsRecentUpdateRow {
  model_id?: string;
  name?: string;
  organization?: string;
  organization_id?: string;
  release_date?: string | null;
  announcement_date?: string | null;
  license_id?: string | null;
  multimodal?: boolean | null;
}

interface LLMStatsModelPageSources {
  api_ref?: string | null;
  playground?: string | null;
  paper?: string | null;
  scorecard_blog?: string | null;
  repo?: string | null;
  weights?: string | null;
}

interface LLMStatsModelPageBenchmarkRow {
  benchmark_id?: string;
  name?: string;
  description?: string | null;
  categories?: string[];
  modality?: string | null;
  max_score?: number | null;
  score?: number | null;
  normalized_score?: number | null;
  verified?: boolean;
  self_reported?: boolean;
  self_reported_source?: string | null;
  analysis_method?: string | null;
}

interface LLMStatsModelPageData {
  model_id?: string;
  name?: string;
  organization?: { name?: string | null } | string | null;
  release_date?: string | null;
  // Raw parameter count (e.g. 2800000000000 for 2.8T) — the only params signal
  // available before ZeroEval indexes a brand-new model.
  param_count?: number | null;
  license?: { id?: string | null; name?: string | null } | string | null;
  sources?: LLMStatsModelPageSources;
  benchmarks?: LLMStatsModelPageBenchmarkRow[];
}

export interface LLMStatsModelPageBenchmark {
  benchmark_id: string;
  name: string;
  description: string | null;
  categories: string[];
  modality: string | null;
  max_score: number | null;
  score: number | null;
  normalized_score: number | null;
  verified: boolean;
  self_reported: boolean;
  source_url: string | null;
  analysis_method: string | null;
}

export interface LLMStatsModelScorecard {
  model_id: string;
  name: string | null;
  organization: string | null;
  release_date: string | null;
  params_b: number | null;
  license: string | null;
  sources: LLMStatsModelPageSources;
  benchmarks: LLMStatsModelPageBenchmark[];
}

const REQUEST_TIMEOUT_MS = 20000;
const MAX_JSON_BYTES = 1_000_000;
const MAX_HTML_BYTES = 2_000_000;
// SWE-bench embeds its entire multi-category leaderboard as inline JSON; the
// page measured 4.19 MB on 2026-08-15 and had outgrown MAX_HTML_BYTES, which
// failed the source outright ("body exceeds 2000000 byte budget"). Give only
// that page a larger budget rather than loosening the cap for every HTML fetch.
const MAX_LARGE_HTML_BYTES = 8_000_000;
const MAX_CSV_BYTES = 5_000_000;
const DATASET_PAGE_SIZE = 100;
const DATASET_PAGE_CONCURRENCY = 4;
const MAX_DATASET_ROWS = 2_000;
// Page ceiling is derived per call from that call's row cap (see maxPages in
// fetchDatasetRows) so a source can request a tighter window than the global one.
const MAX_FETCH_RETRIES = 2;
const LLM_STATS_SCORECARD_CONCURRENCY = 4;
// Widened now that this source actually yields data. It was the ONLY path for a
// brand-new model's numbers, but returned 0 rows for its whole life because
// every new model's benchmarks are vendor-self-reported and were filtered out.
// 120 days / 60 models covers the current generation without a huge fan-out.
const LLM_STATS_RECENT_MODEL_WINDOW_DAYS = 120;
const LLM_STATS_RECENT_MODEL_LIMIT = 60;
// Known-good LiveBench table date — used as the last-resort fallback when
// bundle discovery and date probing both fail. LiveBench publishes irregular
// snapshots as table_YYYY_MM_DD.csv (verified live 2026-07-16).
const LIVEBENCH_KNOWN_GOOD_DATE = '2026_06_25';
// LiveBench 2.0 (2026-10) moved the original v1 tables under /v1/; the site's
// own bundle now fetches `./v1/table_<date>.csv`. The root paths return 404.
const LIVEBENCH_V1_BASE = 'https://livebench.ai/v1';
const LIVEBENCH_PROBE_WEEKS = 6;
// Re-run table-date discovery at most this often per instance; between runs the
// memoized date is reused so every refresh doesn't re-fetch the site bundle.
// One hour keeps a fresh LiveBench release from being missed for long while
// still amortizing the discovery requests across ~2 refreshes.
const LIVEBENCH_DISCOVERY_TTL_MS = 60 * 60 * 1000;
let liveBenchResolvedDate: { date: string; resolvedAt: number } | null = null;

const SCORECARD_BENCHMARK_KEY_MAP: Record<string, string> = {
  'aime-2025': 'aime_2025',
  'aime-2026': 'aime_2026',
  'arc-agi-v2': 'arc_agi',
  'chatbot-arena': 'arena_elo',
  'coding-arena': 'code_arena',
  'gpqa': 'gpqa_diamond',
  'humanity\'s-last-exam': 'hle',
  'humanity\'s-last-exam-(no-tools,-text-only)': 'hle_no_tools_text',
  'humanity\'s-last-exam-(with-tools)': 'hle_tools',
  'humanity\'s-last-exam-(with-tools,-text-only)': 'hle_tools_text',
  'hle-verified': 'hle_verified',
  'ifeval': 'ifeval',
  // LiveCodeBench Pro is a separate, much harder problem set; only v6 shares
  // the `livecodebench` key with ZeroEval's livecodebench_v6_score.
  'livecodebench-pro': 'livecodebench_pro',
  'livecodebench-v6': 'livecodebench',
  // Aug-2026 agentic generation. Added from a 159-model census of llm-stats
  // scorecards (2026-08-15): the app tracked the 2024-25 benchmark generation
  // while the frontier moved on, so models reporting only modern evals looked
  // unmeasured. Each key below is published by >= 8 DISTINCT vendors, which is
  // the bar that makes a benchmark usable for ranking at all. Deliberately NOT
  // added: apex-swe and cursorbench-3.2 (1 model, 1 vendor each) — a benchmark
  // only one lab reports cannot compare models, however good it is.
  'swe-bench-pro': 'swe_bench_pro',
  // One key per Terminal-Bench edition: each release is a different task set,
  // and the official board (fetchTerminalBench) now serves only 4.0. Folding
  // 2.x/3.0 into one key put vendor 2.1 scores up to 90.6 beside a 4.0 board
  // whose best is 64.8 (2026-10-23). terminal-bench-4.0-aa is Artificial
  // Analysis running the same 4.0 task set, so it shares the 4.0 key.
  'terminal-bench-2': 'terminal_bench_2',
  'terminal-bench-2.1': 'terminal_bench_2_1',
  'terminal-bench-3.0': 'terminal_bench_3',
  'terminal-bench-4.0': 'terminal_bench_4',
  'terminal-bench-4.0-aa': 'terminal_bench_4',
  'browsecomp': 'browsecomp',
  'mcp-atlas': 'mcp_atlas',
  'toolathlon': 'toolathlon',
  'deepswe-1.1': 'deepswe',
  'lmarena': 'arena_elo',
  'mmlu-pro': 'mmlu_pro',
  'simpleqa': 'simpleqa',
  'swe-bench-verified': 'swe_bench',
};

export function scorecardBenchmarkKey(row: Pick<LLMStatsModelPageBenchmark, 'benchmark_id' | 'analysis_method'>): string | null {
  const baseKey = SCORECARD_BENCHMARK_KEY_MAP[row.benchmark_id] ?? null;
  if (baseKey !== 'hle') return baseKey;

  const method = row.analysis_method?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
  if (/\b(no|without) tools?\b/.test(method)) return 'hle_no_tools';
  if (/\b(with|using) tools?\b/.test(method) || /\btools?\b/.test(method)) return 'hle_tools';
  return 'hle';
}

const FIXED_UPSTREAM_HOSTS = new Set([
  'api.zeroeval.com', 'datasets-server.huggingface.co', 'livebench.ai',
  'llm-stats.com', 'www.swebench.com',
  // Added 2026-08-15 after verifying each serves a static, machine-readable
  // payload over HTTPS with no redirect (redirects stay refused by design).
  // 'www.tbench.ai' is deliberate: the apex 'tbench.ai' 301-redirects to www,
  // and the guard refuses 3xx, so the apex host would fail closed.
  'gorilla.cs.berkeley.edu', 'www.tbench.ai',
]);

/** Fetch only reviewed HTTPS origins. Redirects are deliberately disabled: a
 * compromised upstream must not be able to turn these server fetches into SSRF. */
async function fetchFixedUpstream(url: string, init: RequestInit = {}): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !FIXED_UPSTREAM_HOSTS.has(target.hostname)) {
    throw new Error(`Refusing unreviewed upstream URL: ${target.origin}`);
  }
  const res = await fetch(target, { ...init, redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) throw new Error(`Upstream redirect refused: ${target.hostname}`);
  return res;
}

/** Enforce byte budgets before any full buffering or parser allocation. */
export async function readBoundedBody(res: Response, maxBytes: number, label: string): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`${label}: body exceeds ${maxBytes} byte budget`);
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`${label}: body exceeds ${maxBytes} byte budget`);
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchJSON(url: string, label: string, attempt = 0, signal?: AbortSignal, headers?: HeadersInit): Promise<unknown> {
  const res = await fetchFixedUpstream(url, {
    headers: { 'User-Agent': 'LocalLLMRadar/1.0', Accept: 'application/json', ...headers },
    signal: createRequestSignal(signal),
  });

  if (!res.ok) {
    if (attempt < MAX_FETCH_RETRIES && [429, 500, 502, 503, 504].includes(res.status)) {
      const retryAfter = parseRetryAfterMs(res.headers.get('retry-after'));
      await delay(clampRetryDelay(retryAfter ?? 400 * 2 ** attempt), signal);
      return fetchJSON(url, label, attempt + 1, signal, headers);
    }
    throw new Error(`${label}: HTTP ${res.status}`);
  }

  return JSON.parse(await readBoundedBody(res, MAX_JSON_BYTES, label));
}

async function fetchDatasetRows<T>(
  dataset: string,
  config: string,
  split: string,
  label: string,
  signal?: AbortSignal,
  maxRows: number = MAX_DATASET_ROWS
): Promise<T[]> {
  const rowCap = Math.max(DATASET_PAGE_SIZE, Math.min(maxRows, MAX_DATASET_ROWS));
  const maxPages = Math.ceil(rowCap / DATASET_PAGE_SIZE);
  const makeUrl = (offset: number) =>
    `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=${encodeURIComponent(config)}&split=${encodeURIComponent(split)}&offset=${offset}&length=${DATASET_PAGE_SIZE}`;

  const firstPage = await fetchJSON(makeUrl(0), `${label} offset=0`, 0, signal) as DatasetRowsResponse<T>;
  const rows = (firstPage.rows?.slice(0, rowCap).map((row) => row.row) || []);
  const reportedTotal = firstPage.num_rows_total;
  const totalRows = Number.isSafeInteger(reportedTotal) && reportedTotal! >= 0
    ? Math.min(reportedTotal!, rowCap) : rows.length;

  const offsets: number[] = [];
  for (let offset = DATASET_PAGE_SIZE; offset < totalRows && offsets.length < maxPages - 1; offset += DATASET_PAGE_SIZE) {
    offsets.push(offset);
  }

  for (let i = 0; i < offsets.length; i += DATASET_PAGE_CONCURRENCY) {
    const batch = offsets.slice(i, i + DATASET_PAGE_CONCURRENCY);
    const pages = await Promise.all(
      batch.map((offset) =>
        fetchJSON(makeUrl(offset), `${label} offset=${offset}`, 0, signal) as Promise<DatasetRowsResponse<T>>
      )
    );

    for (const page of pages) {
      if (!page.rows?.length) continue;
      rows.push(...page.rows.slice(0, rowCap - rows.length).map((row) => row.row));
    }
  }

  return rows;
}

// ── 1. ZeroEval (llm-stats.com backend) — richest single source ──

export async function fetchZeroEval(opts: FetchSourceOptions = {}): Promise<SourceResult> {
  const id = 'zeroeval';
  try {
    const data = await fetchJSON('https://api.zeroeval.com/leaderboard/models/full', 'ZeroEval', 0, opts.signal) as ZeroEvalModelRow[];
    const models: SourceModel[] = [];
    for (const m of data) {
      const name = m.model_name || m.name || m.model_id || '';
      if (!name) continue;
      models.push({
        name,
        provider: m.organization || m.organization_name,
        llm_stats_model_id: m.model_id || null,
        license: m.license,
        params_b: paramsToBillions(m.params),
        context_k: m.context ? Math.round(m.context / 1000) : m.context_window ? Math.round(m.context_window / 1000) : null,
        release: m.release_date || null,
        vision: m.multimodal || false,
        is_open: openWeightsFromLicense(m.license),
        input_price_per_m: m.input_price ?? null,
        output_price_per_m: m.output_price ?? null,
        scores: {
          code_arena: codeArenaDisplayScore(m.coding_arena_score),
          gpqa_diamond: pct(m.gpqa_score),
          aime_2025: pct(m.aime_2025_score),
          swe_bench: pct(m.swe_bench_verified_score),
          arc_agi: pct(m.arc_agi_v2_score),
          hle: pct(m.hle_score),
          mmmu: pct(m.mmmu_score),
          simpleqa: pct(m.simpleqa_score),
          frontier_math: pct(m.frontiermath_score),
          livecodebench: pct(m.livecodebench_v6_score),
          codeforces_elo: m.codeforces_score ? Math.round(m.codeforces_score) : null,
          swe_bench_pro: pct(m.swe_bench_pro_score),
          browsecomp: pct(m.browsecomp_score),
          toolathlon: pct(m.toolathlon_score),
          mcp_atlas: pct(m.mcp_atlas_score),
        },
      });
    }
    // Renamed columns would otherwise parse as hundreds of score-less rows and
    // report "ok" while every ZeroEval benchmark silently vanished.
    if (models.length > 0 && !models.some((m) => Object.values(m.scores).some((v) => v !== null))) {
      throw new Error('ZeroEval: no recognised benchmark columns in payload (schema drift)');
    }
    return { source_id: id, source_name: 'ZeroEval / llm-stats.com', models, fetched_at: new Date().toISOString() };
  } catch (error) {
    return { source_id: id, source_name: 'ZeroEval', models: [], fetched_at: new Date().toISOString(), error: getErrorMessage(error) };
  }
}

// ── 2. LMArena — Chatbot Arena ELO ──

export async function fetchArenaELO(opts: FetchSourceOptions = {}): Promise<SourceResult> {
  const id = 'lmarena';
  try {
    // Canonical LMArena text leaderboard is the style-controlled variant.
    // Verified live: config=text_style_control / split=latest returns the same
    // columns the parser expects (model_name, rating, vote_count, category, …).
    // The dataset reports 10,262 rows, but the text_style_control board is only
    // ~389 models and every one of them appears in the first 400 rows (measured
    // 2026-08-15: rows 400-2000 contributed zero new models). Walking 2,000 rows
    // meant 20 HTTP round-trips instead of 4 — locally 1.6s, but from Vercel it
    // blew past a 50s timeout and returned 0 rows, silently cutting the roster
    // from ~508 models to ~307. 600 rows keeps 50% headroom over the observed
    // board size at a fifth of the request volume.
    const allRows = await fetchDatasetRows<ArenaRow>('lmarena-ai/leaderboard-dataset', 'text_style_control', 'latest', 'Arena', opts.signal, 600);

    // Deduplicate: keep highest-rated "overall" entry per model
    const seen = new Map<string, ArenaRow>();
    for (const row of allRows) {
      if (row.category !== 'overall') continue;
      const name = row.model_name;
      const rating = row.rating;
      if (!name || typeof rating !== 'number') continue;
      const existing = seen.get(name);
      if (!existing || rating > (existing.rating ?? -Infinity)) {
        seen.set(name, row);
      }
    }

    const models: SourceModel[] = [];
    for (const [name, row] of seen) {
      if ((row.vote_count || 0) < 200) continue;
      models.push({
        name,
        provider: row.organization || undefined,
        license: row.license || undefined,
        is_open: openWeightsFromLicense(row.license),
        scores: { arena_elo: Math.round(row.rating ?? 0) },
      });
    }

    return { source_id: id, source_name: 'LMArena Chatbot Arena', models, fetched_at: new Date().toISOString() };
  } catch (error) {
    return { source_id: id, source_name: 'LMArena', models: [], fetched_at: new Date().toISOString(), error: getErrorMessage(error) };
  }
}

// ── 3. LiveBench — 7 category scores ──

export async function fetchLiveBench2Scores({ signal }: FetchSourceOptions = {}): Promise<SourceResult> {
  const source = { source_id: 'livebench2', source_name: 'LiveBench 2.0' };
  try {
    const home = await fetchHTML('https://livebench.ai/', 'LiveBench home', 0, signal);
    const path = home.match(/src="\.?(\/static\/js\/main\.[a-zA-Z0-9]+\.js)"/)?.[1];
    if (!path) throw new Error('Cannot identify LiveBench 2.0 bundle');
    const read = async (path: string, budget: number) => {
      const r = await fetchFixedUpstream('https://livebench.ai' + path, { signal: createRequestSignal(signal) });
      if (!r.ok) throw new Error(`LiveBench 2.0: HTTP ${r.status}`);
      return readBoundedBody(r, budget, 'LiveBench 2.0');
    };
    const bundle = await read(path, MAX_HTML_BYTES);
    const date = liveBench2Edition(bundle);
    const [csv, config] = await Promise.all([read(`/data/${date}/table.csv`, MAX_CSV_BYTES), read(`/data/${date}/categories.json`, MAX_JSON_BYTES)]);
    return { ...source, models: parseLiveBench2(csv, JSON.parse(config)).map(model => ({ ...model, ...liveBench2Run(bundle, model.name) })), data_date: date.replace(/^(....)(..)(..)$/, '$1-$2-$3'), fetched_at: new Date().toISOString() };
  } catch (error) {
    return { ...source, models: [], error: getErrorMessage(error), fetched_at: new Date().toISOString() };
  }
}

export async function fetchLiveBenchScores(opts: FetchSourceOptions = {}): Promise<SourceResult> {
  const id = 'livebench';
  try {
    // Discover the latest available table date instead of trusting a frozen
    // filename forever. Falls back cleanly to the known-good date.
    const tableDate = await resolveLiveBenchTableDate(opts.signal);
    console.log(`[LiveBench] resolved table date: ${tableDate}`);

    // Fetch score CSV, categories JSON, and the (optional) measured-cost CSV in
    // parallel. Newer snapshots publish cost_<date>.csv with the measured $ per
    // task per model row; older ones don't, so cost failures are non-fatal.
    const [csvRes, catRes, costRes] = await Promise.all([
      fetchFixedUpstream(`${LIVEBENCH_V1_BASE}/table_${tableDate}.csv`, { signal: createRequestSignal(opts.signal) }),
      fetchFixedUpstream(`${LIVEBENCH_V1_BASE}/categories_${tableDate}.json`, { signal: createRequestSignal(opts.signal) }),
      fetchFixedUpstream(`${LIVEBENCH_V1_BASE}/cost_${tableDate}.csv`, { signal: createRequestSignal(opts.signal) }).catch(() => null),
    ]);

    if (!csvRes.ok) throw new Error(`CSV: HTTP ${csvRes.status}`);
    const csvText = await readBoundedBody(csvRes, MAX_CSV_BYTES, 'LiveBench CSV');
    // Every published score is a category average, so the categories file is
    // required: without it each row's global average came out as 0 and was
    // published as a measured zero.
    if (!catRes.ok) throw new Error(`categories: HTTP ${catRes.status}`);
    const categories = JSON.parse(await readBoundedBody(catRes, MAX_JSON_BYTES, 'LiveBench categories')) as Record<string, string[]>;
    if (Object.keys(categories).length === 0) throw new Error('categories: empty category map');
    const costText = costRes?.ok ? await readBoundedBody(costRes, MAX_CSV_BYTES, 'LiveBench cost CSV') : null;

    // Parse CSV
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',');

    // Parse all rows, then deduplicate by base model name (keep highest global score)
    const rawModels: { name: string; scores: Record<string, number | null>; global: number }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',');
      const name = vals[0];
      if (!name) continue;

      const taskScores: Record<string, number> = {};
      for (let j = 1; j < headers.length; j++) {
        const v = parseFloat(vals[j]);
        if (!isNaN(v)) taskScores[headers[j]] = v;
      }

      // Compute category averages
      const scores: Record<string, number | null> = {};
      for (const [cat, tasks] of Object.entries(categories)) {
        const catVals = tasks.map(t => taskScores[t]).filter(v => v !== undefined);
        if (catVals.length > 0) {
          const key = `livebench_${cat.toLowerCase().replace(/\s+/g, '_')}`;
          scores[key] = Math.round((catVals.reduce((a, b) => a + b, 0) / catVals.length) * 100) / 100;
        }
      }

      // Global average = mean of category averages. A row with no task values
      // is unmeasured, not a zero.
      const catAvgs = Object.values(scores).filter((v): v is number => v !== null);
      if (catAvgs.length === 0) continue;
      const global = catAvgs.reduce((a, b) => a + b, 0) / catAvgs.length;
      scores.livebench_global = Math.round(global * 100) / 100;

      rawModels.push({ name, scores, global });
    }

    // Measured per-run cost per raw row from cost_<date>.csv (enrichment —
    // an unparsable/absent cost file just leaves the map empty).
    const costByRow = parseLiveBenchCostCsv(costText, headers);

    // Group effort/thinking variants under their base model. The best-scoring
    // variant still provides the model's headline LiveBench scores (unchanged
    // scoring behavior); every published variant is kept as an EffortVariant so
    // the UI can show score-per-effort and measured cost-per-effort.
    const baseMap = new Map<string, { best: typeof rawModels[0]; variants: EffortVariant[] }>();
    for (const m of rawModels) {
      const base = liveBenchBaseName(m.name);
      const variant: EffortVariant = {
        variant_name: m.name,
        effort: liveBenchEffortLabel(m.name),
        livebench_global: m.scores.livebench_global ?? null,
        livebench_coding: m.scores.livebench_coding ?? null,
        livebench_reasoning: m.scores.livebench_reasoning ?? null,
        run_cost_usd: costByRow.get(m.name) ?? null,
      };
      const entry = baseMap.get(base);
      if (!entry) {
        baseMap.set(base, { best: m, variants: [variant] });
        continue;
      }
      entry.variants.push(variant);
      if (m.global > entry.best.global) entry.best = m;
    }

    const models: SourceModel[] = [];
    for (const [base, entry] of baseMap) {
      entry.variants.sort((a, b) => (b.livebench_global ?? -1) - (a.livebench_global ?? -1));
      // Emit under the BASE name so the merge matches the parent model even
      // when the best row carries an effort suffix ("gpt-5.6-sol-max" would
      // otherwise never match the primary roster's "GPT-5.6 Sol").
      models.push({
        name: base,
        scores: entry.best.scores,
        effort_variants: entry.variants,
      });
    }

    opts.captureLiveBench?.(csvText, categories);
    // The filename identifies the benchmark edition, not model evaluation time.
    return {
      source_id: id,
      source_name: 'LiveBench',
      models,
      fetched_at: new Date().toISOString(),
      data_date: tableDate.replace(/_/g, '-'),
    };
  } catch (error) {
    return { source_id: id, source_name: 'LiveBench', models: [], fetched_at: new Date().toISOString(), error: getErrorMessage(error) };
  }
}

/**
 * Discover the most recent LiveBench table snapshot.
 *
 * Primary: mirror the livebench.ai app itself — its JS bundle ships the array
 * of published "YYYY-MM-DD" table dates and always loads the LAST entry.
 * (Blind weekday-aligned probing can never find those irregular publish dates;
 * that is exactly how production got stuck on a January table.)
 * Secondary: weekly-candidate probing. Last resort: the known-good constant.
 * The resolved date is memoized per instance for LIVEBENCH_DISCOVERY_TTL_MS.
 */
async function resolveLiveBenchTableDate(signal?: AbortSignal): Promise<string> {
  const now = Date.now();
  if (liveBenchResolvedDate && now - liveBenchResolvedDate.resolvedAt < LIVEBENCH_DISCOVERY_TTL_MS) {
    return liveBenchResolvedDate.date;
  }

  const discovered =
    (await discoverLiveBenchDateFromBundle(signal)) ??
    (await probeLiveBenchWeeklyDates(signal));

  if (discovered) {
    liveBenchResolvedDate = { date: discovered, resolvedAt: now };
    return discovered;
  }

  // Transient discovery failure: serve the known-good date but do NOT memoize
  // it, so the next refresh retries discovery instead of pinning the fallback.
  return LIVEBENCH_KNOWN_GOOD_DATE;
}

async function discoverLiveBenchDateFromBundle(signal?: AbortSignal): Promise<string | null> {
  try {
    const home = await fetchHTML('https://livebench.ai/', 'LiveBench home', 0, signal);
    const bundlePath = home.match(/src="\.?(\/static\/js\/main\.[^"]+\.js)"/)?.[1];
    if (!bundlePath) return null;

    const bundleRes = await fetchFixedUpstream(`https://livebench.ai${bundlePath}`, {
      headers: { 'User-Agent': 'LocalLLMRadar/1.0' },
      signal: createRequestSignal(signal),
    });
    if (!bundleRes.ok) return null;
    const bundle = await readBoundedBody(bundleRes, MAX_HTML_BYTES, 'LiveBench bundle');

    // The release list is the longest array of date literals in the bundle.
    const dateArrays = bundle.match(/\[(?:"\d{4}-\d{2}-\d{2}",?)+\]/g) ?? [];
    if (dateArrays.length === 0) return null;
    const longest = dateArrays.reduce((a, b) => (b.length > a.length ? b : a));
    const newestFirst = (longest.match(/\d{4}-\d{2}-\d{2}/g) ?? [])
      .map((d) => d.replace(/-/g, '_'))
      .reverse();

    for (const date of newestFirst.slice(0, 3)) {
      if (await liveBenchTableExists(date, signal)) return date;
    }
    return null;
  } catch {
    return null;
  }
}

async function probeLiveBenchWeeklyDates(signal?: AbortSignal): Promise<string | null> {
  for (const date of liveBenchCandidateDates(LIVEBENCH_PROBE_WEEKS)) {
    if (date === LIVEBENCH_KNOWN_GOOD_DATE) break; // don't probe past the fallback
    if (await liveBenchTableExists(date, signal)) return date;
  }
  return null;
}

async function liveBenchTableExists(date: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetchFixedUpstream(`${LIVEBENCH_V1_BASE}/table_${date}.csv`, {
      method: 'HEAD',
      headers: { 'User-Agent': 'LocalLLMRadar/1.0' },
      signal: createRequestSignal(signal),
    });
    return res.ok;
  } catch {
    // Network/timeout on a probe is non-fatal — the caller keeps trying.
    return false;
  }
}

/** Build YYYY_MM_DD candidate dates for the last `weeks` weeks, most recent first. */
function liveBenchCandidateDates(weeks: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < weeks; i++) {
    const d = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    dates.push(`${yyyy}_${mm}_${dd}`);
  }
  return dates;
}

/**
 * A bare trailing "-max"/"-ultra" (at `suffixOffset`) is an effort level when a
 * version digit precedes it ("gpt-5.6-sol-max"). Qwen is the exception: "Max"
 * is its product tier (Qwen3.8 Max is a separate 2.4T model), so "qwen3.8-max"
 * stays a model name.
 */
function isBareEffortTier(lowerName: string, suffixOffset: number): boolean {
  const stem = lowerName.slice(0, suffixOffset);
  return /\d/.test(stem) && !stem.startsWith('qwen');
}

/** Strip effort/thinking/date suffixes so variant rows group under one base model. */
export function liveBenchBaseName(rawName: string): string {
  return rawName.toLowerCase()
    .replace(/-\d{8}/g, '')
    .replace(/-\d{4}-\d{2}-\d{2}/g, '')
    // "max"/"ultra" with the explicit -effort suffix is always an effort level.
    .replace(/-(max|ultra)-effort/g, '')
    // Bare trailing "-max"/"-ultra" is an effort level too (LiveBench publishes
    // e.g. "gpt-5.6-sol-max") — but only when the name carries a version digit,
    // so plain product names like "qwen-max" stay intact.
    .replace(/-(max|ultra)$/, (match, _level, offset, whole: string) =>
      isBareEffortTier(whole, offset) ? '' : match)
    .replace(/-(high|medium|low|xhigh|auto|minimal)(-effort)?/g, '')
    // Longer alternatives first: plain "thinking" must not eat the tail of
    // "non-thinking" and leave a stray "-non" group behind.
    .replace(/-(non-thinking|nonthinking|nothinking|non-reasoning|thinking|reasoning)(-\d+k)?/g, '')
    .replace(/-beta\d*/g, '')
    .replace(/-(base|instruct|chat|preview)/g, '')
    .replace(/-+$/, '');
}

/**
 * Effort label of a raw LiveBench row, e.g.
 * "claude-sonnet-4-6-thinking-auto-medium-effort" -> "medium",
 * "gpt-5.4-nano-xhigh" -> "xhigh", bare "-thinking" -> "thinking".
 */
export function liveBenchEffortLabel(rawName: string): string {
  const n = rawName.toLowerCase();
  const maxTier = n.match(/(?:^|-)(max|ultra)-effort(?=-|$)/);
  if (maxTier) return maxTier[1];
  // Bare trailing "-max"/"-ultra" with a version digit before it (see
  // liveBenchBaseName): "gpt-5.6-sol-max" -> "max", "qwen-max" -> untouched.
  const bareTier = n.match(/-(max|ultra)$/);
  if (bareTier && isBareEffortTier(n, n.length - bareTier[0].length)) return bareTier[1];
  const levels = [...n.matchAll(/(?:^|-)(minimal|low|medium|high|xhigh)(?:-effort)?(?=-|$)/g)];
  if (levels.length > 0) return levels[levels.length - 1][1];
  if (/(?:^|-)auto(?:-effort)?(?=-|$)/.test(n)) return 'auto';
  if (/non-?thinking|nothinking|non-?reasoning/.test(n)) return 'non-thinking';
  if (/thinking|reasoning|reasoner/.test(n)) return 'thinking';
  return 'standard';
}

/**
 * cost_<date>.csv mirrors the score table's task columns with measured $ spent
 * per task. Total run cost = sum over the columns that also appear in the score
 * table header (extra bookkeeping columns are ignored). Returns raw row name ->
 * total USD, rounded to cents.
 */
function parseLiveBenchCostCsv(costText: string | null, tableHeaders: string[]): Map<string, number> {
  const totals = new Map<string, number>();
  if (!costText) return totals;
  try {
    const lines = costText.trim().split('\n');
    if (lines.length < 2) return totals;
    const costHeaders = lines[0].split(',');
    const taskColumns = new Set(tableHeaders.slice(1));
    const costIdx: number[] = [];
    for (let i = 1; i < costHeaders.length; i++) {
      if (taskColumns.has(costHeaders[i])) costIdx.push(i);
    }
    if (costIdx.length === 0) return totals;

    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',');
      const name = vals[0];
      if (!name) continue;
      let total = 0;
      let seen = 0;
      for (const idx of costIdx) {
        const v = parseFloat(vals[idx]);
        if (!isNaN(v)) {
          total += v;
          seen++;
        }
      }
      if (seen > 0) totals.set(name, Math.round(total * 100) / 100);
    }
  } catch {
    // Cost is optional enrichment — never fail the source over it.
  }
  return totals;
}

// ── 4. LLM Stats Code Arena — public coding arena leaderboard ──

export async function fetchCodeArenaScores(opts: FetchSourceOptions = {}): Promise<SourceResult> {
  const id = 'codearena';
  try {
    const html = await fetchHTML('https://llm-stats.com/leaderboards/llm-leaderboard', 'LLM Stats Code Arena', 0, opts.signal);
    const models = parseLLMStatsCodeArenaModels(html);

    return {
      source_id: id,
      source_name: 'LLM Stats Code Arena',
      models,
      fetched_at: new Date().toISOString(),
    };
  } catch (error) {
    return {
      source_id: id,
      source_name: 'LLM Stats Code Arena',
      models: [],
      fetched_at: new Date().toISOString(),
      error: getErrorMessage(error),
    };
  }
}

export async function fetchLLMStatsModelScorecard(
  modelId: string,
  opts: FetchSourceOptions = {}
): Promise<LLMStatsModelScorecard | null> {
  // Fails safe: returns null on any fetch/parse failure instead of throwing, so
  // the per-model API route can respond 200 {available:false} rather than 502.
  try {
    return parseLLMStatsModelScorecard(await fetchHTML(`https://llm-stats.com/models/${encodeURIComponent(modelId)}`, 'LLM Stats scorecard', 0, opts.signal), modelId);
  } catch {
    return null;
  }
}

export async function fetchLLMStatsRecentScorecards(opts: FetchSourceOptions = {}): Promise<SourceResult> {
  const id = 'llmstats_recent';
  try {
    const updatesHtml = await fetchHTML('https://llm-stats.com/llm-updates', 'LLM Stats updates', 0, opts.signal);
    const recentUpdates = parseLLMStatsRecentUpdates(updatesHtml)
      .filter((entry) => Boolean(entry.model_id && entry.name))
      .filter((entry) => isRecentModelUpdate(entry.release_date || entry.announcement_date || null))
      .sort((a, b) => parseDateMs(b.release_date || b.announcement_date || null) - parseDateMs(a.release_date || a.announcement_date || null))
      .slice(0, LLM_STATS_RECENT_MODEL_LIMIT);

    const models: SourceModel[] = [];
    for (let i = 0; i < recentUpdates.length; i += LLM_STATS_SCORECARD_CONCURRENCY) {
      const batch = recentUpdates.slice(i, i + LLM_STATS_SCORECARD_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (entry) => {
          const scorecard = await fetchLLMStatsModelScorecard(entry.model_id!, opts);
          if (!scorecard) return null;
          return mapLLMStatsScorecardToSourceModel(entry, scorecard);
        })
      );

      for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        models.push(result.value);
      }
    }

    return {
      source_id: id,
      source_name: 'LLM Stats Recent Scorecards',
      models,
      fetched_at: new Date().toISOString(),
    };
  } catch (error) {
    return {
      source_id: id,
      source_name: 'LLM Stats Recent Scorecards',
      models: [],
      fetched_at: new Date().toISOString(),
      error: getErrorMessage(error),
    };
  }
}

// ── 5. Open LLM Leaderboard v2 — MMLU-Pro, GPQA, IFEval, MATH ──
// TODO: ingest Code Arena if the public OLLB dataset exposes it again. The
// current rows only include Average, IFEval, BBH, MATH Lvl 5, GPQA, MUSR, and
// MMLU-PRO, so GLM-5-style "Code Arena" comparisons are not available here.

export async function fetchOpenLLMLeaderboard(opts: FetchSourceOptions = {}): Promise<SourceResult> {
  const id = 'ollb';
  try {
    const allRows = await fetchDatasetRows<OpenLLMRow>('open-llm-leaderboard/contents', 'default', 'train', 'OLLB', opts.signal);

    const models: SourceModel[] = [];
    for (const row of allRows) {
      const name = row.fullname || '';
      if (!name) continue;
      models.push({
        name,
        params_b: row['#Params (B)'] ? Math.round(row['#Params (B)'] * 10) / 10 : null,
        license: row['Hub License'] || undefined,
        is_open: true,
        scores: {
          mmlu_pro: round1(row['MMLU-PRO']),
          gpqa_diamond: round1(row['GPQA']),
          ifeval: round1(row['IFEval']),
          math_500: round1(row['MATH Lvl 5']),
        },
      });
    }

    return { source_id: id, source_name: 'Open LLM Leaderboard v2', models, fetched_at: new Date().toISOString() };
  } catch (error) {
    return { source_id: id, source_name: 'OLLB', models: [], fetched_at: new Date().toISOString(), error: getErrorMessage(error) };
  }
}

// ── 6. SWE-bench Verified (HTML scrape) ──

/**
 * BFCL — Berkeley Function-Calling Leaderboard.
 *
 * `bfcl` was already a tracked scoring key but carried only 11 of 508 models,
 * which looked like a name-join failure. It was not: nothing ever fetched BFCL.
 * The public leaderboard page is a 16KB JS shell that client-fetches a static
 * CSV; we fetch that CSV directly (33KB, one request, verified 2026-08-15) and
 * skip the shell entirely. Tool/function-calling accuracy is a capability axis
 * no other source in this pipeline covers.
 */
export async function fetchBFCL(opts: FetchSourceOptions = {}): Promise<SourceResult> {
  const id = 'bfcl';
  try {
    const res = await fetchFixedUpstream('https://gorilla.cs.berkeley.edu/data_overall.csv', {
      headers: { 'User-Agent': 'LocalLLMRadar/1.0', Accept: 'text/csv,text/plain' },
      signal: createRequestSignal(opts.signal),
    });
    if (!res.ok) throw new Error(`BFCL: HTTP ${res.status}`);
    const csv = await readBoundedBody(res, MAX_CSV_BYTES, 'BFCL CSV');

    const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) throw new Error('BFCL: empty CSV');
    const header = splitCsvLine(lines[0]);
    const modelIdx = header.findIndex((h) => h.trim().toLowerCase() === 'model');
    const accIdx = header.findIndex((h) => h.trim().toLowerCase().startsWith('overall acc'));
    const orgIdx = header.findIndex((h) => h.trim().toLowerCase() === 'organization');
    if (modelIdx === -1 || accIdx === -1) throw new Error('BFCL: expected Model and Overall Acc columns');

    const best = new Map<string, { value: number; provider?: string }>();
    for (const line of lines.slice(1)) {
      const cells = splitCsvLine(line);
      const rawName = (cells[modelIdx] ?? '').trim();
      if (!rawName) continue;
      // Rows are (model + calling-mode) submissions: "GPT-5 (FC)",
      // "GPT-5 (Prompt)", "GPT-5 (FC thinking)". Collapse to the model and keep
      // its best published mode — the same one-model-many-harnesses collapse
      // SWE-bench needs.
      const name = rawName.replace(/\s*\((?:FC|Prompt)[^)]*\)\s*$/i, '').trim();
      if (!name) continue;
      const value = parseFloat((cells[accIdx] ?? '').replace('%', '').trim());
      if (!Number.isFinite(value) || value < 0 || value > 100) continue;
      const previous = best.get(name);
      if (!previous || value > previous.value) {
        best.set(name, { value, provider: orgIdx === -1 ? undefined : (cells[orgIdx] ?? '').trim() || undefined });
      }
    }

    const models: SourceModel[] = [...best].map(([name, entry]) => ({
      name,
      provider: entry.provider,
      scores: { bfcl: Math.round(entry.value * 10) / 10 },
    }));

    return { source_id: id, source_name: 'BFCL (Berkeley Function-Calling Leaderboard)', models, fetched_at: new Date().toISOString() };
  } catch (error) {
    return { source_id: id, source_name: 'BFCL (Berkeley Function-Calling Leaderboard)', models: [], fetched_at: new Date().toISOString(), error: getErrorMessage(error) };
  }
}

/**
 * Terminal-Bench — agentic terminal-task success.
 *
 * Published by 16 distinct vendors per the 2026-08-15 census, making it one of
 * the most comparable of the current agentic benchmarks. The page is fully
 * server-rendered into the Next.js flight payload, so it reuses the same
 * decoder as the llm-stats scorecards rather than needing a browser.
 *
 * Rows are (model + scaffold + effort) submissions like the SWE-bench board, so
 * the best published result per model is taken.
 *
 * Each Terminal-Bench edition is a different task set, so the score key is
 * derived from the board's own title and an edition we have not reviewed is
 * an error rather than a silent merge into an existing key.
 */
const TERMINAL_BENCH_EDITION_KEYS: Record<string, string> = { '4': 'terminal_bench_4' };

// Board labels drop the vendor's family name ("Opus 5.5"); without it no roster
// model matches and every Anthropic row was discarded (7 of 23 on 2026-10-23).
const TERMINAL_BENCH_FAMILY_BY_ORG: Record<string, string> = { anthropic: 'Claude' };

interface TerminalBenchRow {
  metadata?: {
    date?: string;
    model_org?: { label?: string };
    model_display?: { label?: string };
  };
  metrics?: { accuracy?: number };
}

export async function fetchTerminalBench(opts: FetchSourceOptions = {}): Promise<SourceResult> {
  const id = 'terminalbench';
  let name = 'Terminal-Bench';
  try {
    // Since 2026-10 every /leaderboard/... path 308-redirects to the root, which
    // server-renders the current board (Terminal-Bench 4.0). Redirects stay refused.
    const html = await fetchHTML('https://www.tbench.ai/', name, 0, opts.signal);
    const payload = decodeNextFlightPayload(html);

    const title = payload.match(/"title"\s*:\s*"(Terminal-Bench (\d+)(?:\.\d+)*)"/);
    if (!title) throw new Error('Terminal-Bench: board edition not found in payload');
    const scoreKey = TERMINAL_BENCH_EDITION_KEYS[title[2]];
    if (!scoreKey) throw new Error(`Terminal-Bench: unrecognized edition "${title[1]}"`);
    name = title[1];

    const best = new Map<string, { accuracy: number; provider?: string }>();
    let newestDate: string | null = null;
    for (const row of parseTerminalBenchRows(payload)) {
      const label = row.metadata?.model_display?.label?.trim();
      const accuracy = row.metrics?.accuracy;
      if (!label || typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) continue;
      const provider = row.metadata?.model_org?.label?.trim() || undefined;
      const family = provider ? TERMINAL_BENCH_FAMILY_BY_ORG[provider.toLowerCase()] : undefined;
      const modelName = family && !label.toLowerCase().includes(family.toLowerCase()) ? `${family} ${label}` : label;
      const previous = best.get(modelName);
      if (!previous || accuracy > previous.accuracy) best.set(modelName, { accuracy, provider });
      const date = row.metadata?.date;
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && (!newestDate || date > newestDate)) newestDate = date;
    }
    if (best.size === 0) throw new Error('Terminal-Bench: no board rows in payload');

    const models: SourceModel[] = [...best].map(([modelName, entry]) => ({
      name: modelName,
      provider: entry.provider,
      scores: { [scoreKey]: Math.round(entry.accuracy * 10) / 10 },
    }));

    // data_date is the newest submission on the board, so a board that stops
    // accepting results cannot pass as current just because the fetch succeeded.
    return { source_id: id, source_name: name, models, fetched_at: new Date().toISOString(), data_date: newestDate };
  } catch (error) {
    return { source_id: id, source_name: name, models: [], fetched_at: new Date().toISOString(), error: getErrorMessage(error) };
  }
}

/** Every `"rows":[…]` array in the payload whose entries look like board rows. */
function parseTerminalBenchRows(payload: string): TerminalBenchRow[] {
  const rows: TerminalBenchRow[] = [];
  let searchFrom = 0;
  while (true) {
    const markerIndex = payload.indexOf('"rows":', searchFrom);
    if (markerIndex === -1) break;
    searchFrom = markerIndex + 7;
    let cursor = searchFrom;
    while (cursor < payload.length && /\s/.test(payload[cursor])) cursor++;
    if (payload[cursor] !== '[') continue;
    const json = extractBalancedJson(payload, cursor, '[', ']');
    if (!json) continue;
    try {
      const parsed = JSON.parse(json) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed) {
        if (entry && typeof entry === 'object' && (entry as TerminalBenchRow).metadata?.model_display) rows.push(entry as TerminalBenchRow);
      }
    } catch {
      // Not a JSON array we can read; other "rows" keys in the payload are skipped.
    }
  }
  return rows;
}

/**
 * The leaderboard data lives in `<script type="application/json" id="leaderboard-data">`
 * (an array of categories: Multilingual, Test, Verified, Lite, Multimodal). The
 * older layout inlined an array that began with a "bash-only" category; it is
 * kept as a fallback.
 */
export function parseSweBenchCategories(html: string): SweBenchCategory[] {
  const tagged = html.match(/<script[^>]*id="leaderboard-data"[^>]*>([\s\S]*?)<\/script>/);
  if (tagged) return JSON.parse(tagged[1]) as SweBenchCategory[];
  const legacy = html.replace(/\n/g, ' ').match(/\[(\{"name":\s*"bash-only".*?)\](?=\s*<\/script>)/);
  if (!legacy) throw new Error('Could not find data in HTML');
  return JSON.parse('[' + legacy[1] + ']') as SweBenchCategory[];
}

export async function fetchSWEBench(opts: FetchSourceOptions = {}): Promise<SourceResult> {
  const id = 'swebench';
  try {
    const html = await fetchHTML('https://www.swebench.com', 'SWE-bench', 0, opts.signal, MAX_LARGE_HTML_BYTES);

    const categories = parseSweBenchCategories(html);
    const verified = categories.find((category) => category.name === 'Verified');
    if (!verified?.results) throw new Error('No Verified category');

    // A SWE-bench Verified row is a (scaffold + model) submission, not a model:
    // "live-SWE-agent + Claude 4.5 Opus medium" and "mini-SWE-agent + Claude 4.5
    // Opus (high)" are separate rows. Two consequences we handle explicitly:
    //   1. Rows with no "Model:" tag identify only an agent system (e.g. "ACoder").
    //      Emitting those would invent models that do not exist, so they are skipped.
    //   2. One model has many scaffold rows (claude-3-5-sonnet-20241022 had 20 on
    //      2026-08-15). We report the best published scaffold result for the model,
    //      which is what the leaderboard headline for that model means.
    const bestByModel = new Map<string, number>();
    for (const entry of verified.results) {
      const score = entry.resolved;
      if (score == null) continue;
      const modelTag = (entry.tags || []).find((t: string) => t.startsWith('Model:'));
      if (!modelTag) continue;
      const modelName = modelTag.replace('Model: ', '').trim();
      if (!modelName) continue;
      const rounded = Math.round(score * 10) / 10;
      const previous = bestByModel.get(modelName);
      if (previous === undefined || rounded > previous) bestByModel.set(modelName, rounded);
    }

    const models: SourceModel[] = [...bestByModel].map(([name, swe_bench]) => ({
      name,
      scores: { swe_bench },
    }));

    return { source_id: id, source_name: 'SWE-bench Verified', models, fetched_at: new Date().toISOString() };
  } catch (error) {
    return { source_id: id, source_name: 'SWE-bench', models: [], fetched_at: new Date().toISOString(), error: getErrorMessage(error) };
  }
}

// ── Helpers ──

/**
 * Minimal RFC4180-ish CSV line splitter: honours double-quoted fields and ""
 * escapes. The LiveBench parsers use a naive split(',') because their columns
 * are numeric and unquoted; the BFCL export quotes fields (percentages, model
 * links, org names), so a naive split silently mis-columns those rows.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
      } else cell += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { cells.push(cell); cell = ''; continue; }
    cell += ch;
  }
  cells.push(cell);
  return cells;
}

/** Convert 0-1 proportion to percentage, or return null */
function pct(v: unknown): number | null {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  // If already in percentage range (>1), return rounded
  if (n < 0 || n > 100) return null;
  if (n > 1) return Math.round(n * 10) / 10;
  // Convert 0-1 to percentage
  return Math.round(n * 1000) / 10;
}

function round1(v: unknown): number | null {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  const numeric = Number(v);
  return numeric >= 0 && numeric <= 100 ? Math.round(numeric * 10) / 10 : null;
}

function codeArenaDisplayScore(v: unknown): number | null {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  const scaled = n > 100 ? Math.round(n) : Math.round(n * 100);
  // llm-stats mixes two scales in one payload: real ELOs (1000-2200) alongside
  // small normalized ratings that x100 turns into junk like 46 or -45. A value
  // outside the plausible ELO band is the other scale — publish null, not junk.
  return scaled >= 600 && scaled <= 2600 ? scaled : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown fetch error';
}

function paramsToBillions(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  const paramsInBillions = numeric >= 1000000 ? numeric / 1_000_000_000 : numeric;
  return Math.round(paramsInBillions * 10) / 10;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Request deadline exceeded', 'AbortError'));
  const requestSignal = signal;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      requestSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      requestSignal?.removeEventListener('abort', onAbort);
      reject(requestSignal?.reason ?? new DOMException('Request deadline exceeded', 'AbortError'));
    };
    requestSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - Date.now());
}

function clampRetryDelay(delayMs: number): number {
  // A capped backoff is still interruptible through delay(..., signal), so a
  // Retry-After can never keep a source alive beyond its total caller deadline.
  return Math.max(0, Math.min(delayMs, 2_000));
}

function createRequestSignal(signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

export function parseLLMStatsCodeArenaModels(html: string): SourceModel[] {
  // LLM Stats currently ships the Code Arena leaderboard inside the Next.js
  // flight payload rather than a stable public JSON endpoint.
  const decodedPayload = decodeNextFlightPayload(html);
  const initialDataJson = extractJsonArrayAfterMarker(decodedPayload, '"initialData":');
  if (!initialDataJson) {
    throw new Error('Could not extract initialData from LLM Stats payload');
  }

  const rows = JSON.parse(initialDataJson) as LLMStatsLeaderboardRow[];
  const models: SourceModel[] = [];

  for (const row of rows) {
    const name = row.name || row.model_id || '';
    const score = codeArenaDisplayScore(row.coding_arena_score);
    if (!name || score === null) continue;

    models.push({
      name,
      provider: row.organization,
      llm_stats_model_id: row.model_id || null,
      license: row.license,
      params_b: paramsToBillions(row.params),
      context_k: row.context ? Math.round(row.context / 1000) : null,
      release: row.release_date || null,
      vision: row.multimodal || false,
      is_open: openWeightsFromLicense(row.license),
      scores: {
        code_arena: score,
      },
    });
  }

  return models;
}

export function parseLLMStatsRecentUpdates(html: string): LLMStatsRecentUpdateRow[] {
  const decodedPayload = decodeNextFlightPayload(html);
  const recentUpdatesJson = extractJsonArrayAfterMarker(decodedPayload, '"recentUpdates":');
  if (!recentUpdatesJson) {
    throw new Error('Could not extract recentUpdates from LLM Stats updates payload');
  }
  return JSON.parse(recentUpdatesJson) as LLMStatsRecentUpdateRow[];
}

export function parseLLMStatsModelScorecard(html: string, modelId: string): LLMStatsModelScorecard {
  const decodedPayload = decodeNextFlightPayload(html);
  // Older pages inline the object at "initialModelData":{…}; current pages
  // reference it ("initialModelData":"$30:props:modelData") and inline the
  // actual object as "modelData":{…} on the referenced RSC row instead. The
  // extractor only accepts occurrences followed by "{", so refs are skipped.
  const modelDataJson =
    extractJsonObjectAfterMarker(decodedPayload, '"initialModelData":') ??
    extractJsonObjectAfterMarker(decodedPayload, '"modelData":');

  if (!modelDataJson) {
    throw new Error('Could not extract initialModelData from LLM Stats payload');
  }

  const modelData = JSON.parse(modelDataJson) as LLMStatsModelPageData;
  const benchmarks = (modelData.benchmarks || [])
    .filter((row) => Boolean(row.benchmark_id || row.name))
    .filter((row) => row.score !== null || row.normalized_score !== null)
    .map((row) => ({
      benchmark_id: row.benchmark_id || row.name || 'unknown-benchmark',
      name: row.name || row.benchmark_id || 'Unknown benchmark',
      description: row.description || null,
      categories: row.categories || [],
      modality: row.modality || null,
      max_score: row.max_score ?? null,
      score: row.score ?? null,
      normalized_score: row.normalized_score ?? null,
      verified: Boolean(row.verified),
      self_reported: Boolean(row.self_reported),
      source_url: row.self_reported_source || null,
      analysis_method: row.analysis_method || null,
    }))
    .sort((a, b) => {
      const aScore = a.normalized_score ?? a.score ?? -Infinity;
      const bScore = b.normalized_score ?? b.score ?? -Infinity;
      if (bScore !== aScore) return bScore - aScore;
      return a.name.localeCompare(b.name);
    });

  return {
    model_id: modelData.model_id || modelId,
    name: modelData.name || null,
    organization: typeof modelData.organization === 'string'
      ? modelData.organization
      : modelData.organization?.name || null,
    release_date: modelData.release_date || null,
    params_b: paramsToBillions(modelData.param_count ?? null),
    license: typeof modelData.license === 'string'
      ? modelData.license
      : modelData.license?.name || null,
    sources: modelData.sources || {},
    benchmarks,
  };
}

/**
 * Next.js streams the RSC flight payload as MANY self.__next_f.push([N,"…"])
 * script chunks, and a JSON object can be split MID-STRING across chunk
 * boundaries. Searching a single chunk therefore truncates large objects —
 * exactly the failure that silently zeroed the scorecard parsers when
 * llm-stats pages grew. Decode every chunk and join them so marker extraction
 * always sees the complete payload.
 */
export function decodeNextFlightPayload(html: string): string {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[\d+,"([\s\S]*?)"\]\)<\/script>/g)];
  if (chunks.length === 0) {
    throw new Error('Could not find any Next.js flight payload in HTML');
  }
  return chunks
    .map((match) => {
      try {
        return JSON.parse(`"${match[1]}"`) as string;
      } catch {
        // Tolerate a single undecodable chunk; markers just won't match in it.
        return '';
      }
    })
    .join('');
}

// RSC payloads can repeat a prop key as a lazy reference ("key":"$L2f") before
// the inlined value appears. Only occurrences where the marker is immediately
// followed by the expected bracket carry the actual data.
function extractJsonAfterMarker(
  payload: string,
  marker: string,
  openChar: '{' | '[',
  closeChar: '}' | ']'
): string | null {
  let searchFrom = 0;
  while (searchFrom < payload.length) {
    const markerIndex = payload.indexOf(marker, searchFrom);
    if (markerIndex === -1) return null;

    let cursor = markerIndex + marker.length;
    while (cursor < payload.length && /\s/.test(payload[cursor])) cursor++;

    if (payload[cursor] === openChar) {
      const extracted = extractBalancedJson(payload, cursor, openChar, closeChar);
      if (extracted !== null) return extracted;
    }

    searchFrom = markerIndex + marker.length;
  }
  return null;
}

function extractJsonArrayAfterMarker(payload: string, marker: string): string | null {
  return extractJsonAfterMarker(payload, marker, '[', ']');
}

function extractJsonObjectAfterMarker(payload: string, marker: string): string | null {
  return extractJsonAfterMarker(payload, marker, '{', '}');
}

export function extractBalancedJson(
  payload: string,
  startIndex: number,
  openChar: '{' | '[',
  closeChar: '}' | ']'
): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < payload.length; i++) {
    const char = payload[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openChar) {
      depth += 1;
      continue;
    }

    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return payload.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

async function fetchHTML(
  url: string,
  label: string,
  attempt = 0,
  signal?: AbortSignal,
  maxBytes: number = MAX_HTML_BYTES,
): Promise<string> {
  const res = await fetchFixedUpstream(url, {
    headers: {
      'User-Agent': 'LocalLLMRadar/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: createRequestSignal(signal),
  });

  if (!res.ok) {
    if (attempt < MAX_FETCH_RETRIES && [429, 500, 502, 503, 504].includes(res.status)) {
      const retryAfter = parseRetryAfterMs(res.headers.get('retry-after'));
      await delay(clampRetryDelay(retryAfter ?? 400 * 2 ** attempt), signal);
      return fetchHTML(url, label, attempt + 1, signal, maxBytes);
    }
    throw new Error(`${label}: HTTP ${res.status}`);
  }

  return readBoundedBody(res, maxBytes, label);
}

function mapLLMStatsScorecardToSourceModel(
  update: LLMStatsRecentUpdateRow,
  scorecard: LLMStatsModelScorecard
): SourceModel | null {
  const scores: Record<string, number | null> = {};

  for (const row of scorecard.benchmarks) {
    if (!isConsensusEligibleScorecardBenchmark(row)) continue;
    const key = scorecardBenchmarkKey(row);
    if (!key) continue;

    const mapped = mapScorecardBenchmarkValue(key, row);
    if (mapped === null) continue;

    const existing = scores[key];
    if (existing === null || existing === undefined || mapped > existing) {
      scores[key] = mapped;
    }
  }

  if (Object.keys(scores).length === 0) return null;

  // Prefer the scorecard's license name unless it's the "Unknown" placeholder.
  const scorecardLicense =
    scorecard.license && scorecard.license.toLowerCase() !== 'unknown' ? scorecard.license : null;

  return {
    name: scorecard.name || update.name || update.model_id || 'Unknown model',
    provider: scorecard.organization || update.organization,
    llm_stats_model_id: scorecard.model_id || update.model_id || null,
    // Params make brand-new models fit-checkable on the hardware page before
    // ZeroEval has indexed them.
    params_b: scorecard.params_b,
    license: scorecardLicense ?? normalizeLicenseId(update.license_id),
    release: scorecard.release_date || update.release_date || update.announcement_date || null,
    vision: Boolean(update.multimodal),
    is_open: openWeightsFromLicense(scorecardLicense ?? normalizeLicenseId(update.license_id)),
    scores,
  };
}

/** Keep source-labelled self reports visible on model scorecards, but never
 * promote them into the cross-source leaderboard consensus. */
export function isConsensusEligibleScorecardBenchmark(row: Pick<LLMStatsModelPageBenchmark, 'self_reported'>): boolean {
  // Vendor-published values are now INGESTED rather than discarded, but they
  // arrive under the `llmstats_recent` source id, so every cell they produce is
  // attributable in `benchmark_sources` and the UI can mark it.
  //
  // Why this changed: a 159-model census on 2026-08-15 found `verified` is
  // NEVER true — 0 of 3,171 rows — while 3,067 are self_reported. Excluding
  // self-reported therefore discarded ~97% of all published benchmark data, and
  // any gate keyed on `verified` would have zeroed the field entirely. The
  // visible damage: Grok 4.6 published 10 benchmarks and the app kept 0; GPT-5.6
  // Sol published 44 and the app kept 1; Qwen3.8-27B published 26 and kept 0;
  // and six of the top fifteen models had NO SWE-bench because vendors report it
  // on their own pages instead of submitting to the official leaderboard.
  //
  // The honesty guarantee is preserved by weight, not by exclusion: these keys
  // carry reliability 0.35-0.5 (vs LiveBench 1.0), so a vendor's own number
  // informs a ranking it cannot dominate.
  void row;
  return true;
}

function mapScorecardBenchmarkValue(key: string, row: LLMStatsModelPageBenchmark): number | null {
  const score = row.score ?? row.normalized_score ?? null;
  const normalized = row.normalized_score ?? row.score ?? null;

  if (score === null && normalized === null) return null;

  if (key === 'arena_elo') {
    const numeric = score ?? normalized;
    return numeric === null ? null : Math.round(numeric);
  }

  if (key === 'code_arena') {
    return codeArenaDisplayScore(score ?? normalized);
  }

  return pct(normalized ?? score);
}

/**
 * Openness as a source states it: false for an explicit proprietary/closed
 * license, true for any other named license, undefined when the source gives
 * none or says "unknown" — unknown must not read as downloadable.
 */
function openWeightsFromLicense(license: string | null | undefined): boolean | undefined {
  const normalized = license?.trim().toLowerCase();
  if (!normalized || normalized === 'unknown') return undefined;
  if (normalized.includes('proprietary') || normalized === 'closed') return false;
  return true;
}

function normalizeLicenseId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value === 'proprietary') return 'Proprietary';
  return value.replace(/_/g, ' ');
}

function isRecentModelUpdate(value: string | null): boolean {
  if (!value) return false;
  const timestamp = parseDateMs(value);
  if (!timestamp) return false;
  const ageMs = Date.now() - timestamp;
  return ageMs >= 0 && ageMs <= LLM_STATS_RECENT_MODEL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function parseDateMs(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
