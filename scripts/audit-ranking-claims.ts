/** Offline verification of a public audit:live capture; never contacts Redis. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { BENCH_ANCHORS, COMPOSITE_WEIGHTS, SCORING_CATEGORIES, SCORING_VERSION, mergeAllSources, type MergedModel } from '../src/lib/merge-models';
import { buildCategoryRankings, CATEGORY_DEFINITIONS, computeLeaderboardCategoryScore } from '../src/lib/leaderboard';
import type { SourceResult } from '../src/lib/live-sources';
import { redactModelForPublicApi } from '../src/lib/public-api';

const directory = path.resolve(process.argv[2] ?? 'output/trust-audit');
const read = (name: string) => {
  const bytes = readFileSync(path.resolve(directory, name));
  return JSON.parse((name.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8'));
};
const manifest = read('manifest.json');
assert.equal(manifest.schema, 'local-llm-radar/ranking-audit@1', 'Unsupported capture schema; run audit:live or audit:replay');
assert.equal(manifest.scoringVersion, SCORING_VERSION, 'Capture uses another scoring version; run audit:replay');
const sources = read(manifest.files.sources).sources as SourceResult[];
const before = read(manifest.files.leaderboard).models as MergedModel[];
const models = mergeAllSources(sources, JSON.parse(readFileSync('data/curated-models.json', 'utf8')));
const oldBySlug = new Map(before.map(model => [model.slug, model]));
const publicSnapshot = existsSync(path.join(directory, 'production.json')) ? read('production.json').models as MergedModel[] : null;
if (publicSnapshot) {
  const publicBySlug = new Map(publicSnapshot.map(model => [model.slug, model]));
  assert.equal(publicBySlug.size, models.length, 'Public API roster differs from capture');
  for (const model of models) {
    assert.deepEqual(publicBySlug.get(model.slug)?.benchmarks, redactModelForPublicApi(model).benchmarks, `${model.slug}: public API values differ`);
  }
}

// Recalculate from documented arithmetic without calling the production scorer.
function category(model: MergedModel, keys: readonly string[]) {
  let numerator = 17.5;
  let denominator = 0.5;
  let count = 0;
  for (const key of keys) {
    const value = model.benchmarks[key];
    if (value == null) continue;
    const band = BENCH_ANCHORS[key];
    assert(band, `Missing band: ${key}`);
    const selected = model.benchmark_sources[key].find(row => row.selected);
    assert(selected, `${model.slug}/${key}: missing selected observation`);
    const cap = selected.is_fallback ? 0.25
      : ['livebench', 'swebench', 'terminalbench', 'bfcl', 'artificialanalysis'].includes(selected.source_id) ? 1
      : ['lmarena', 'codearena'].includes(selected.source_id) ? 0.35 : 0.5;
    const weight = Math.min(band.reliability, cap) * 0.75;
    numerator += Math.max(0, Math.min(100, 100 * (value - band.lo) / (band.hi - band.lo))) * weight;
    denominator += weight;
    count++;
  }
  return count ? numerator / denominator : null;
}

let retainedCells = 0;
let removedArchivedCells = 0;
let categoryChecks = 0;
let tracedReleaseDates = 0;
for (const model of models) {
  if (model.release) {
    assert(model.metadata_sources?.release?.some(row => row.selected && row.value === model.release), `${model.slug}: release has no selected metadata observation`);
    tracedReleaseDates++;
  }
  const old = oldBySlug.get(model.slug);
  for (const [key, value] of Object.entries(model.benchmarks)) {
    if (value == null) {
      if (old?.benchmark_sources[key]?.some(row => row.selected && row.is_fallback)) removedArchivedCells++;
      continue;
    }
    const selected = model.benchmark_sources[key].filter(row => row.selected);
    assert.equal(selected.length, 1);
    const observation = selected[0];
    assert(!observation.is_fallback && observation.source_id !== 'fallback');
    assert.equal(observation.value, value);
    const source = sources.find(row => row.source_id === observation.source_id);
    assert(source?.models.some(row => row.name === observation.model_name && row.scores[key] === value), `${model.slug}/${key}: no captured source record`);
    // A before/after difference must be explained; this capture has no live-value changes.
    assert.equal(value, old?.benchmarks[key], `${model.slug}/${key}: live value changed between captures`);
    retainedCells++;
  }
  let composite = 0;
  let measured = false;
  for (const [key, keys] of Object.entries(SCORING_CATEGORIES)) {
    const score = category(model, keys);
    if (score != null) measured = true;
    composite += (score ?? 35) * COMPOSITE_WEIGHTS[key as keyof typeof COMPOSITE_WEIGHTS];
  }
  assert.equal(measured ? Math.round(composite * 10) / 10 : 0, model.composite_score, model.slug);
  for (const definition of CATEGORY_DEFINITIONS.filter(row => row.key !== 'overall')) {
    const expected = category(model, definition.benchmarks);
    const actual = computeLeaderboardCategoryScore(model, definition.key);
    assert(expected == null ? actual == null : actual != null && Math.abs(expected - actual) < 1e-10);
    categoryChecks++;
  }
}

// Independently reconstruct imported LiveBench cells from the evaluator's raw
// CSV and category map, rather than trusting our source adapter's calculations.
const hasLiveBench = models.some(model => model.benchmark_sources.livebench_global?.some(row => row.selected && row.source_id === 'livebench'));
let livebenchCells = 0;
if (hasLiveBench) {
  const lines = readFileSync(path.resolve(directory, manifest.files.livebench), 'utf8').trim().split(/\r?\n/);
  const headers = lines.shift()!.split(',');
  const rawRows = new Map(lines.map(line => {
    const cells = line.split(',');
    return [cells[0], Object.fromEntries(headers.slice(1).map((key, index) => [key, Number.parseFloat(cells[index + 1])]))];
  }));
  const categories = read(manifest.files.categories) as Record<string, string[]>;
  for (const model of models) {
    if (!model.benchmark_sources.livebench_global?.some(row => row.selected && row.source_id === 'livebench')) continue;
    const raw = rawRows.get(model.effort_variants[0]?.variant_name);
    assert(raw, `${model.slug}: selected raw LiveBench run absent`);
    const scores = Object.fromEntries(Object.entries(categories).map(([key, tasks]) => {
      const values = tasks.map(task => raw[task]).filter(Number.isFinite);
      assert(values.length);
      return [`livebench_${key.toLowerCase().replace(/\s+/g, '_')}`, Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100];
    }));
    const values = Object.values(scores);
    scores.livebench_global = Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100;
    for (const [key, value] of Object.entries(scores)) {
      assert.equal(model.benchmarks[key], value, `${model.slug}/${key}`);
      livebenchCells++;
    }
  }
}

const highlight = (model: MergedModel) => ({ name: model.name, score: model.composite_score, math: category(model, SCORING_CATEGORIES.math), agentic: category(model, SCORING_CATEGORIES.agentic) });
const names = ['Claude Opus 4.6', 'Claude Opus 5.5', 'Kimi K3'];
const receipt = {
  checkedAt: new Date().toISOString(), models: models.length, retainedCells, removedArchivedCells, categoryChecks, livebenchCells, tracedReleaseDates,
  publicSnapshotChecked: publicSnapshot !== null, livebenchChecked: hasLiveBench,
  before: before.filter(model => names.includes(model.name)).map(highlight),
  after: models.filter(model => names.includes(model.name)).map(highlight),
  indices: Object.fromEntries(CATEGORY_DEFINITIONS.map(category => [category.key, buildCategoryRankings(models, category.key).slice(0, 5).map(row => ({ name: row.name, index: row.score, evidence: row.rank_status }))])),
  boundary: 'Confirms source transcription and arithmetic, not the truth of every publisher claim, equivalent evaluation conditions, or task superiority.',
};
writeFileSync(path.join(directory, 'claims-verification.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ models: models.length, retainedCells, removedArchivedCells, categoryChecks, livebenchCells, before: receipt.before, after: receipt.after }, null, 2));
