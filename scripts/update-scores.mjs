#!/usr/bin/env node
/**
 * Local LLM Radar — Live Score Updater
 *
 * Pulls model data directly from public leaderboards:
 *   1. LMArena (Chatbot Arena) — ELO ratings for ALL models (open + closed)
 *   2. LLM Stats Code Arena — coding arena score from public human votes
 *   3. Open LLM Leaderboard v2 — MMLU-Pro, GPQA, IFEval, MATH for open models
 *   4. SWE-bench Verified — software engineering scores
 *
 * The leaderboard data IS the source of truth. Models appear automatically
 * when they show up on Arena. The curated file is now only a fallback/backfill
 * for metadata and benchmarks not covered by live APIs.
 *
 * Run: node scripts/update-scores.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '..', 'data', 'curated-models.json');
const MAX_JSON_BYTES = 1_000_000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_ROWS = 2_000;
const APPROVED_HOSTS = new Set(['datasets-server.huggingface.co', 'llm-stats.com', 'www.swebench.com']);

async function fetchFixed(url, init = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !APPROVED_HOSTS.has(target.hostname)) throw new Error(`unapproved upstream: ${target.origin}`);
  const response = await fetch(target, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) throw new Error(`redirect refused: ${target.hostname}`);
  return response;
}

async function readBounded(response, maxBytes, label) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`${label}: body too large`);
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`${label}: body too large`);
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// ── Fetch helpers ──

async function fetchJSON(url, label) {
  try {
    const res = await fetchFixed(url, {
      headers: { 'User-Agent': 'LocalLLMRadar/1.0' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return JSON.parse(await readBounded(res, MAX_JSON_BYTES, label));
  } catch (e) {
    console.warn(`  [WARN] ${label}: ${e.message}`);
    return null;
  }
}

async function fetchHTML(url, label) {
  try {
    const res = await fetchFixed(url, {
      headers: { 'User-Agent': 'LocalLLMRadar/1.0', Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await readBounded(res, MAX_HTML_BYTES, label);
  } catch (e) {
    console.warn(`  [WARN] ${label}: ${e.message}`);
    return null;
  }
}

async function fetchAllPages(baseUrl, label) {
  const rows = [];
  let offset = 0;
  const pageSize = 100;
  while (true) {
    const url = `${baseUrl}&offset=${offset}&length=${pageSize}`;
    const data = await fetchJSON(url, `${label} offset=${offset}`);
    if (!data?.rows?.length) break;
    rows.push(...data.rows.slice(0, MAX_ROWS - rows.length).map(r => r.row));
    if (rows.length >= Math.min(Number.isSafeInteger(data.num_rows_total) ? data.num_rows_total : rows.length, MAX_ROWS)) break;
    offset += pageSize;
    // Safety: cap at 10000 rows
    if (offset >= MAX_ROWS) break;
  }
  return rows;
}

// ── 1. LMArena — Arena ELO for all models ──

const ARENA_BASE =
  'https://datasets-server.huggingface.co/rows?dataset=lmarena-ai%2Fleaderboard-dataset&config=text&split=latest';

async function fetchArenaModels() {
  console.log('[Arena] Fetching ELO ratings...');
  const rows = await fetchAllPages(ARENA_BASE, 'Arena');
  if (!rows.length) return [];

  // Filter to "overall" category entries only, deduplicate by model_name
  const seen = new Map();
  for (const row of rows) {
    if (row.category !== 'overall') continue;
    const name = row.model_name;
    if (!name) continue;
    // Keep highest-rated version if duplicates
    if (!seen.has(name) || row.rating > seen.get(name).rating) {
      seen.set(name, row);
    }
  }

  const models = [];
  for (const [name, row] of seen) {
    models.push({
      arena_key: name,
      display_name: prettifyModelName(name),
      organization: row.organization || '',
      license: row.license || '',
      arena_elo: Math.round(row.rating),
      vote_count: row.vote_count || 0,
      rank: row.rank,
    });
  }

  console.log(`[Arena] Got ${models.length} models with overall ELO`);
  return models;
}

// ── 2. LLM Stats Code Arena ──

async function fetchCodeArenaScores() {
  console.log('[Code Arena] Fetching LLM Stats coding arena scores...');
  const html = await fetchHTML('https://llm-stats.com/leaderboards/llm-leaderboard', 'Code Arena');
  if (!html) return {};

  try {
    const payloads = [...html.matchAll(/self\.__next_f\.push\(\[(\d+),"([\s\S]*?)"\]\)<\/script>/g)];
    const encodedPayload = payloads.find((match) => match[2].includes('coding_arena_score'))?.[2];
    if (!encodedPayload) throw new Error('missing coding_arena_score payload');

    const decodedPayload = JSON.parse(`"${encodedPayload}"`);
    const initialDataJson = extractJsonArrayAfterMarker(decodedPayload, '"initialData":');
    if (!initialDataJson) throw new Error('missing initialData array');

    const rows = JSON.parse(initialDataJson);
    const results = {};

    for (const row of rows) {
      const name = row.name || row.model_id || '';
      const score = toCodeArenaDisplayScore(row.coding_arena_score);
      if (!name || score === null) continue;
      results[normalizeForMatch(name)] = { name, score };
    }

    console.log(`[Code Arena] Got ${Object.keys(results).length} scored models`);
    return results;
  } catch (e) {
    console.warn(`  [Code Arena] Failed: ${e.message}`);
    return {};
  }
}

// ── 3. Open LLM Leaderboard v2 — benchmark scores ──

const OLLB_BASE =
  'https://datasets-server.huggingface.co/rows?dataset=open-llm-leaderboard%2Fcontents&config=default&split=train';

async function fetchOpenLLMScores() {
  console.log('[OLLB] Fetching Open LLM Leaderboard...');
  const rows = await fetchAllPages(OLLB_BASE, 'OLLB');
  if (!rows.length) return {};

  const results = {};
  for (const row of rows) {
    const name = row.fullname || '';
    if (!name) continue;
    const normalizedName = normalizeForMatch(name);
    const scoreRow = {
      name,
      mmlu_pro: roundScore(row['MMLU-PRO']),
      gpqa_diamond: roundScore(row['GPQA']),
      ifeval: roundScore(row['IFEval']),
      math_500: roundScore(row['MATH Lvl 5']),
      params_b: row['#Params (B)'] ? Math.round(row['#Params (B)'] * 10) / 10 : null,
      license: row['Hub License'] || null,
      is_moe: row['MoE'] || false,
      architecture: row['Architecture'] || '',
    };
    const existing = results[normalizedName];
    if (!existing || countFilledScores(scoreRow) > countFilledScores(existing)) {
      results[normalizedName] = scoreRow;
    }
  }

  console.log(`[OLLB] Got ${Object.keys(results).length} model scores`);
  return results;
}

// ── 4. SWE-bench Verified ──

async function fetchSWEBench() {
  console.log('[SWE] Fetching SWE-bench Verified...');
  try {
    const html = await fetchHTML('https://www.swebench.com', 'SWE-bench');
    if (!html) return {};

    // Extract JSON data from script tag
    const match = html.match(/\[(\{"name":\s*"bash-only".*?)\](?=\s*<\/script>)/s);
    if (!match) {
      console.warn('  [SWE] Could not find data in HTML');
      return {};
    }

    const categories = JSON.parse('[' + match[1] + ']');
    const verified = categories.find(c => c.name === 'Verified');
    if (!verified?.results) return {};

    const results = {};
    for (const entry of verified.results) {
      const name = entry.name || '';
      const score = entry.resolved;
      if (name && score != null) {
        // Extract model name from tags if available
        const modelTag = (entry.tags || []).find(t => t.startsWith('Model:'));
        const modelName = modelTag ? modelTag.replace('Model: ', '') : name;
        results[normalizeForMatch(modelName)] = roundScore(score);
        results[normalizeForMatch(name)] = roundScore(score);
      }
    }

    console.log(`[SWE] Got ${Object.keys(results).length} entries`);
    return results;
  } catch (e) {
    console.warn(`  [SWE] Failed: ${e.message}`);
    return {};
  }
}

// ── Name processing ──

// Convert arena model keys like "claude-opus-4-6-thinking" to display names
function prettifyModelName(key) {
  const KNOWN_NAMES = {
    'claude-opus-4-6-thinking': 'Claude Opus 4.6',
    'claude-opus-4-6': 'Claude Opus 4.6',
    'claude-sonnet-4-6': 'Claude Sonnet 4.6',
    'claude-sonnet-4-6-thinking': 'Claude Sonnet 4.6',
    'claude-opus-4-thinking': 'Claude Opus 4',
    'claude-opus-4': 'Claude Opus 4',
    'claude-sonnet-4-thinking': 'Claude Sonnet 4',
    'claude-sonnet-4': 'Claude Sonnet 4',
    'claude-3.5-haiku': 'Claude 3.5 Haiku',
    'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku',
    'gpt-4o-2024-11-20': 'GPT-4o',
    'gpt-4o': 'GPT-4o',
    'gpt-4.1': 'GPT-4.1',
    'gpt-4.1-mini': 'GPT-4.1 mini',
    'gpt-4.1-nano': 'GPT-4.1 nano',
    'o3': 'o3',
    'o4-mini': 'o4-mini',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'grok-3': 'Grok 3',
    'grok-3-mini': 'Grok 3 mini',
  };
  if (KNOWN_NAMES[key]) return KNOWN_NAMES[key];

  // Auto-prettify: replace hyphens, capitalize
  return key
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/(\d) (\d)/g, '$1.$2') // "4 1" → "4.1"
    .replace(/\bGpt\b/g, 'GPT')
    .replace(/\bLlama\b/g, 'Llama')
    .replace(/\bQwen\b/g, 'Qwen')
    .replace(/\bGemma\b/g, 'Gemma')
    .replace(/\bGemini\b/g, 'Gemini')
    .replace(/\bClaude\b/g, 'Claude')
    .replace(/\bDeepseek\b/g, 'DeepSeek')
    .replace(/\bMistral\b/g, 'Mistral');
}

const MATCH_VARIANT_TOKENS = new Set([
  'thinking', 'reasoning', 'reasoner', 'nothinking', 'nonthinking',
  'preview', 'latest', 'high', 'medium', 'low', 'xhigh', 'auto',
  'effort', 'beta', 'alpha', 'experimental', 'base', 'chat', 'instruct',
]);

function normalizeForMatch(name) {
  const normalized = (name.split('/').pop() || name)
    .toLowerCase()
    .replace(/20\d{2}[-_.]?\d{2}[-_.]?\d{2}/g, ' ')
    .replace(/\(([^)]*)\)/g, ' $1 ')
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
    .filter((token) => !/^\d+k$/.test(token));

  const textTokens = [];
  const versionTokens = [];

  for (const token of tokens) {
    if (/^\d+(?:\.\d+)*$/.test(token)) {
      versionTokens.push(...token.split('.'));
    } else {
      textTokens.push(token);
    }
  }

  return `${textTokens.sort().join(':')}::${versionTokens.join('.')}`;
}

function roundScore(val) {
  if (val === null || val === undefined || isNaN(val)) return null;
  return Math.round(val * 10) / 10;
}

function toCodeArenaDisplayScore(val) {
  if (val === null || val === undefined || isNaN(val)) return null;
  const n = Number(val);
  const scaled = n > 100 ? Math.round(n) : Math.round(n * 100);
  // llm-stats mixes real ELOs with small normalized ratings in one payload;
  // x100 of the latter yields junk (46, -45). Outside the ELO band -> null.
  return scaled >= 600 && scaled <= 2600 ? scaled : null;
}

function countFilledScores(obj) {
  return Object.values(obj).filter(v => v !== null && v !== undefined).length;
}

// ── Placeholder / copy-paste guard ──
//
// Name-normalization (normalizeForMatch) intentionally collapses model
// variants — e.g. it strips "mini", "nano", "high", "chat", and dates — so
// "GPT-5", "GPT-5 mini", and "GPT-5.4 nano" can all normalize to the same key.
// When a single source value is matched through that shared key it gets written
// IDENTICALLY to every colliding model, fabricating a copy-paste cluster (this
// is how 18 OpenAI models all ended up with swe_bench=75.6 and 12 Llama/Qwen
// models with swe_bench=40.6).
//
// This guard prevents that: for a given benchmark field, if a single numeric
// value would be broadcast to MORE THAN this many distinct models in one run,
// we refuse to write it for all of them and leave the field null (honest
// "unknown" instead of an invented constant). A real measurement is per-model;
// a value landing on a whole cluster of distinct models is the placeholder bug.
const BROADCAST_LIMIT = 6;

// Given proposed writes [{ model, value }] for one benchmark field, drop any
// value that would land on more than BROADCAST_LIMIT distinct models. Returns
// the filtered writes plus the rejected (value -> count) clusters for logging.
function rejectBroadcastClusters(field, proposedWrites) {
  const counts = new Map();
  for (const { model, value } of proposedWrites) {
    if (value === null || value === undefined) continue;
    if (!counts.has(value)) counts.set(value, new Set());
    counts.get(value).add(model.name);
  }

  const rejectedValues = new Set();
  const rejected = [];
  for (const [value, names] of counts) {
    if (names.size > BROADCAST_LIMIT) {
      rejectedValues.add(value);
      rejected.push({ value, count: names.size });
    }
  }

  const accepted = proposedWrites.filter(w => !rejectedValues.has(w.value));
  for (const r of rejected) {
    console.warn(`  [GUARD] ${field}=${r.value} would broadcast to ${r.count} distinct models — refusing (left null to avoid copy-paste placeholder)`);
  }
  return { accepted, rejected };
}

function extractJsonArrayAfterMarker(payload, marker) {
  const markerIndex = payload.indexOf(marker);
  if (markerIndex === -1) return null;

  const arrayStart = payload.indexOf('[', markerIndex + marker.length);
  if (arrayStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = arrayStart; i < payload.length; i++) {
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

    if (char === '[') {
      depth++;
      continue;
    }

    if (char === ']') {
      depth--;
      if (depth === 0) return payload.slice(arrayStart, i + 1);
    }
  }

  return null;
}

// ── Merge logic ──

function mergeArenaIntoModels(models, arenaModels, recordAcceptedValue) {
  let updated = 0;
  let added = 0;
  const existingNorms = new Map();
  for (const m of models) {
    existingNorms.set(normalizeForMatch(m.name), m);
  }

  // Minimum votes to include a model (filter out noise)
  const MIN_VOTES = 500;

  for (const arena of arenaModels) {
    if (arena.vote_count < MIN_VOTES) continue;

    const norm = normalizeForMatch(arena.display_name);
    const existing = existingNorms.get(norm);

    if (existing) {
      // Update ELO if changed
      if (existing.arena_elo !== arena.arena_elo) {
        console.log(`  [Update] ${existing.name} ELO: ${existing.arena_elo} → ${arena.arena_elo}`);
        existing.arena_elo = arena.arena_elo;
        updated++;
      }
      recordAcceptedValue(existing, 'arena_elo', 'lmarena', arena.arena_elo);
    } else {
      // New model from Arena — add it
      const isClosed = (arena.license || '').toLowerCase().includes('proprietary') ||
                       ['openai', 'anthropic', 'google', 'xai'].includes(arena.organization.toLowerCase());

      const newModel = {
        name: arena.display_name,
        provider: capitalizeProvider(arena.organization),
        params_b: null,
        context_k: null,
        license: arena.license || (isClosed ? 'Proprietary' : null),
        tier: '',
        vram_int4_gb: null,
        vram_fp16_gb: null,
        mmlu_pro: null,
        gpqa_diamond: null,
        ifeval: null,
        arena_elo: arena.arena_elo,
        code_arena: null,
        swe_bench: null,
        humaneval: null,
        livecodebench: null,
        bfcl: null,
        codeforces_elo: null,
        aime_2025: null,
        math_500: null,
        mgsm: null,
        arc_agi: null,
        simpleqa: null,
        frontier_math: null,
        vision: false,
        moe_active_b: null,
        release: null,
        closed_source: isClosed,
      };

      models.push(newModel);
      recordAcceptedValue(newModel, 'arena_elo', 'lmarena', arena.arena_elo);
      existingNorms.set(norm, newModel);
      added++;
      console.log(`  [New] ${arena.display_name} (${arena.organization}) ELO=${arena.arena_elo} ${isClosed ? '[closed]' : '[open]'}`);
    }
  }

  return { updated, added };
}

function capitalizeProvider(org) {
  if (!org) return 'Unknown';
  const MAP = {
    'openai': 'OpenAI', 'anthropic': 'Anthropic', 'google': 'Google',
    'meta': 'Meta', 'xai': 'xAI', 'mistral': 'Mistral',
    'alibaba': 'Qwen', 'qwen': 'Qwen', 'deepseek': 'DeepSeek',
    'nvidia': 'Nvidia', 'microsoft': 'Microsoft', 'cohere': 'Cohere',
    'zhipu': 'Zhipu AI', 'minimax': 'MiniMax', 'moonshot': 'Moonshot',
    'stepfun': 'Stepfun', 'tencent': 'Tencent',
  };
  return MAP[org.toLowerCase()] || org.charAt(0).toUpperCase() + org.slice(1);
}

function isConcreteBenchmarkValue(key, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (key === 'codeforces_elo') return value >= 0 && value <= 4000;
  if (key === 'arena_elo' || key === 'code_arena') return value >= 600 && value <= 2600;
  return value >= 0 && value <= 100;
}

function isPersistedBenchmarkValue(key, value) {
  return value === null || isConcreteBenchmarkValue(key, value);
}

// Retired OLLB data is deliberately not a fallback provenance authority.
const FALLBACK_SOURCE_ALLOWLIST = new Set(['lmarena', 'codearena', 'swebench']);
const MODEL_METADATA_FIELDS = new Set(['name', 'provider', 'params_b', 'context_k', 'license', 'tier', 'vram_int4_gb', 'vram_fp16_gb', 'vision', 'moe_active_b', 'release', 'closed_source']);
const CURATED_BENCHMARK_FIELDS = new Set(['aime_2025', 'arc_agi', 'arena_elo', 'bfcl', 'code_arena', 'codeforces_elo', 'frontier_math', 'gpqa_diamond', 'humaneval', 'ifeval', 'livecodebench', 'math_500', 'mgsm', 'mmlu_pro', 'simpleqa', 'swe_bench']);
const CURATED_MODEL_FIELDS = new Set([...MODEL_METADATA_FIELDS, ...CURATED_BENCHMARK_FIELDS]);

function nullableFinite(value, min = 0, max = 10_000_000) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
}

function hasAllowedText(value, max = 200) {
  return value === null || (typeof value === 'string' && value.length <= max);
}

function validateModelMetadata(model) {
  if (typeof model.name !== 'string' || model.name.trim().length === 0 || model.name.length > 200) return false;
  if (!hasAllowedText(model.provider) || !hasAllowedText(model.license) || !hasAllowedText(model.tier, 32)) return false;
  if (!nullableFinite(model.params_b) || !nullableFinite(model.context_k) || !nullableFinite(model.vram_int4_gb) || !nullableFinite(model.vram_fp16_gb) || !nullableFinite(model.moe_active_b)) return false;
  if (model.release !== null && (typeof model.release !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(model.release) || Number.isNaN(Date.parse(model.release)))) return false;
  return typeof model.vision === 'boolean' && typeof model.closed_source === 'boolean';
}

function validateFallbackForPersistence(data) {
  if (!data || !Array.isArray(data.models) || data.models.length === 0) throw new Error('refusing fallback write: invalid or empty model schema');
  const provenance = data._provenance;
  if (!provenance || provenance.schema_version !== 2 || !Array.isArray(provenance.accepted_values)) {
    throw new Error('refusing fallback write: missing provenance schema');
  }
  const modelsByName = new Map(data.models.map((model) => [model?.name, model]));
  const contributingSources = new Set();
  for (const contribution of provenance.accepted_values) {
    if (!contribution || !FALLBACK_SOURCE_ALLOWLIST.has(contribution.source) || typeof contribution.model !== 'string' || !CURATED_BENCHMARK_FIELDS.has(contribution.field) || !isConcreteBenchmarkValue(contribution.field, contribution.value)) {
      throw new Error('refusing fallback write: malformed accepted-value provenance');
    }
    const model = modelsByName.get(contribution.model);
    if (!model || model[contribution.field] !== contribution.value) throw new Error('refusing fallback write: provenance does not match persisted value');
    contributingSources.add(contribution.source);
  }
  if (contributingSources.size < 2) throw new Error('refusing fallback write: fewer than two independent sources contributed accepted persisted values');
  for (const model of data.models) {
    if (!model || Object.getPrototypeOf(model) !== Object.prototype || !validateModelMetadata(model)) throw new Error('refusing fallback write: invalid model metadata');
    const fields = Object.keys(model);
    if (fields.length !== CURATED_MODEL_FIELDS.size || fields.some((field) => !CURATED_MODEL_FIELDS.has(field)) || [...CURATED_MODEL_FIELDS].some((field) => !Object.hasOwn(model, field))) {
      throw new Error(`refusing fallback write: incomplete model schema for ${model.name}`);
    }
    for (const [key, value] of Object.entries(model)) {
      if (CURATED_BENCHMARK_FIELDS.has(key) && !isPersistedBenchmarkValue(key, value)) throw new Error(`refusing fallback write: invalid ${key} for ${model.name}`);
    }
  }
}

// ── Main ──

async function main() {
  console.error('Fallback persistence is permanently disabled: the checked-in legacy data has no independently verifiable value-level provenance. This script is read-only and will not fetch or write data.');
  process.exitCode = 1;
  return;

  // Load current data (with manual overrides preserved)
  let data;
  try {
    data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  } catch {
    data = { _comment: 'Auto-generated by update-scores.mjs', models: [] };
  }

  const models = data.models;
  // Canonicalize older fallback rows before validation. A missing benchmark is
  // explicitly unknown (`null`), never an omitted schema field.
  for (const model of models) {
    if (!model || typeof model !== 'object') continue;
    for (const field of CURATED_BENCHMARK_FIELDS) {
      if (!Object.hasOwn(model, field)) model[field] = null;
    }
  }
  const acceptedValues = [];
  const recordAcceptedValue = (model, field, source, value) => {
    if (FALLBACK_SOURCE_ALLOWLIST.has(source) && isConcreteBenchmarkValue(field, value)) {
      acceptedValues.push({ model: model.name, field, source, value });
    }
  };
  console.log(`Loaded ${models.length} existing models\n`);

  // Fetch all sources in parallel
  const [arenaModels, codeArenaScores, ollbScores, sweBench] = await Promise.all([
    fetchArenaModels(),
    fetchCodeArenaScores(),
    fetchOpenLLMScores(),
    fetchSWEBench(),
  ]);

  // 1. Merge Arena data (adds new models + updates ELO)
  console.log('\n--- Merging Arena data ---');
  const arenaStats = mergeArenaIntoModels(models, arenaModels, recordAcceptedValue);
  console.log(`Arena: ${arenaStats.updated} updated, ${arenaStats.added} new models\n`);

  // 2. Merge Code Arena scores
  console.log('--- Merging Code Arena ---');
  let codeArenaUpdates = 0;
  if (Object.keys(codeArenaScores).length > 0) {
    const proposed = [];
    for (const model of models) {
      const norm = normalizeForMatch(model.name);
      const match = codeArenaScores[norm];
      if (!match) continue;
      if (model.code_arena === match.score) recordAcceptedValue(model, 'code_arena', 'codearena', match.score);
      else proposed.push({ model, value: match.score });
    }
    const { accepted } = rejectBroadcastClusters('code_arena', proposed);
    for (const { model, value } of accepted) {
      console.log(`  [Code Arena] ${model.name} = ${value}`);
      model.code_arena = value;
      recordAcceptedValue(model, 'code_arena', 'codearena', value);
      codeArenaUpdates++;
    }
  }
  console.log(`Code Arena: ${codeArenaUpdates} scores filled\n`);

  // 3. Merge Open LLM Leaderboard scores
  console.log('--- Merging OLLB scores ---');
  let ollbUpdates = 0;
  if (Object.keys(ollbScores).length > 0) {
    // Guard each benchmark field independently: a value that lands on more than
    // BROADCAST_LIMIT distinct models is a normalization collision, not a real
    // per-model measurement, so we drop it rather than fabricate a cluster.
    for (const field of ['mmlu_pro', 'gpqa_diamond', 'ifeval', 'math_500']) {
      const proposed = [];
      for (const model of models) {
        const norm = normalizeForMatch(model.name);
        const match = ollbScores[norm];
        if (!match) continue;
        if (match[field] !== null && model[field] === match[field]) recordAcceptedValue(model, field, 'ollb', match[field]);
        else if (match[field] !== null && model[field] === null) {
          proposed.push({ model, value: match[field] });
        }
      }
      const { accepted } = rejectBroadcastClusters(field, proposed);
      for (const { model, value } of accepted) {
        console.log(`  [OLLB] ${model.name}.${field} = ${value}`);
        model[field] = value;
        recordAcceptedValue(model, field, 'ollb', value);
        ollbUpdates++;
      }
    }
  }
  console.log(`OLLB: ${ollbUpdates} scores filled\n`);

  // 4. Merge SWE-bench scores
  console.log('--- Merging SWE-bench ---');
  let sweUpdates = 0;
  if (Object.keys(sweBench).length > 0) {
    const proposed = [];
    for (const model of models) {
      if (model.swe_bench !== null) continue;
      const norm = normalizeForMatch(model.name);
      const score = sweBench[norm];
      if (score !== undefined) proposed.push({ model, value: score });
    }
    // Without this guard, the shared normalized key broadcasts one SWE-bench
    // value across every colliding variant (the 75.6 / 40.6 cluster bug).
    const { accepted } = rejectBroadcastClusters('swe_bench', proposed);
    for (const { model, value } of accepted) {
      console.log(`  [SWE] ${model.name} = ${value}%`);
      model.swe_bench = value;
      recordAcceptedValue(model, 'swe_bench', 'swebench', value);
      sweUpdates++;
    }
  }
  console.log(`SWE-bench: ${sweUpdates} scores filled\n`);

  // Sanitize: values retained from previous runs may predate the ELO
  // plausibility band in toCodeArenaDisplayScore — never persist junk-scale
  // Code Arena values (see that function's comment).
  let sanitized = 0;
  for (const model of models) {
    if (typeof model.code_arena === 'number' && (model.code_arena < 600 || model.code_arena > 2600)) {
      model.code_arena = null;
      sanitized++;
    }
  }
  if (sanitized > 0) console.log(`Sanitized ${sanitized} out-of-band code_arena values to null`);

  // Dedupe rows that are the same model under different spellings (e.g.
  // "Gemma 4 31B" vs "Gemma 4.31b"): keep the richest row, backfill its gaps
  // from the duplicate, and drop the rest.
  const rowsByMatchKey = new Map();
  for (const model of models) {
    const key = normalizeForMatch(model.name);
    const existing = rowsByMatchKey.get(key);
    if (!existing) {
      rowsByMatchKey.set(key, model);
      continue;
    }
    const keep = countFilledScores(existing) >= countFilledScores(model) ? existing : model;
    const drop = keep === existing ? model : existing;
    for (const [field, value] of Object.entries(drop)) {
      if (keep[field] === null || keep[field] === undefined) keep[field] = value;
    }
    rowsByMatchKey.set(key, keep);
  }
  if (rowsByMatchKey.size !== models.length) {
    console.log(`Deduped ${models.length - rowsByMatchKey.size} duplicate-name rows`);
    models.length = 0;
    models.push(...rowsByMatchKey.values());
  }

  // Sort: closed-source at end, then by Code Arena / Arena descending
  models.sort((a, b) => {
    if (a.closed_source !== b.closed_source) return a.closed_source ? 1 : -1;
    return (b.code_arena || b.arena_elo || 0) - (a.code_arena || a.arena_elo || 0);
  });

  // Write back
  data._updated = new Date().toISOString().split('T')[0];
  const persistedNames = new Set(models.map((model) => model.name));
  data._provenance = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    accepted_values: acceptedValues.filter((entry) => persistedNames.has(entry.model) && models.find((model) => model.name === entry.model)?.[entry.field] === entry.value),
  };
  validateFallbackForPersistence(data);
  console.log('Read-only mode: no fallback file was written.');
}

export { CURATED_BENCHMARK_FIELDS, CURATED_MODEL_FIELDS, isConcreteBenchmarkValue, validateFallbackForPersistence };

// Keep the validator importable for offline adversarial tests without turning an
// import into a live scheduled update.
if (process.argv[1]?.endsWith('/update-scores.mjs') || process.argv[1] === 'scripts/update-scores.mjs') {
  main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}
