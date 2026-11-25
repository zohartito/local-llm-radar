/** Read-only upstream capture. Never touches Redis, cron, or production writes. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import * as sources from '../src/lib/live-sources';
import { mergeAllSources, SCORING_VERSION } from '../src/lib/merge-models';
import { computeHardwareFit, DEFAULT_HARDWARE_PROFILES } from '../src/lib/hardware';
import { buildCategoryHardwareRecommendations, openWeightModels } from '../src/lib/hardware-ranking';
import { snapshotExpired } from '../src/lib/trust';

const REQUIRED_SOURCES = ['zeroeval', 'lmarena', 'codearena', 'llmstats_recent', 'livebench2', 'livebench', 'bfcl', 'terminalbench', 'swebench'];

async function main() {
  const argument = (flag: string): string | undefined => {
    const index = process.argv.indexOf(flag);
    if (index < 0) return undefined;
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`);
    return value;
  };
  const directory = path.resolve(argument('--out') ?? 'output/trust-audit');
  mkdirSync(directory, { recursive: true });
  const explicitCapture = argument('--capture');
  const capturePath = explicitCapture ? path.resolve(explicitCapture) : path.join(directory, 'sources.json');
  const replay = process.argv.includes('--replay');
  if (explicitCapture && !replay) throw new Error('--capture requires --replay; source archives are read-only inputs');
  const readCapture = () => {
    const bytes = readFileSync(capturePath);
    return JSON.parse((capturePath.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')).sources as sources.SourceResult[];
  };
  const results: sources.SourceResult[] = replay
    ? readCapture()
    : await Promise.all([
      sources.fetchZeroEval, sources.fetchArenaELO, sources.fetchCodeArenaScores,
      sources.fetchLLMStatsRecentScorecards, sources.fetchLiveBench2Scores, sources.fetchLiveBenchScores,
      sources.fetchBFCL, sources.fetchTerminalBench, sources.fetchSWEBench,
    ].map((fetcher) => fetcher({
      signal: AbortSignal.timeout(55000),
      captureLiveBench: (csv, categories) => {
        writeFileSync(path.join(directory, 'livebench.csv'), csv);
        writeFileSync(path.join(directory, 'categories.json'), JSON.stringify(categories));
      },
    })));
  if (!replay) writeFileSync(capturePath, JSON.stringify({ capturedAt: new Date().toISOString(), sources: results }, null, 2));
  const fallback = JSON.parse(readFileSync('data/curated-models.json', 'utf8'));
  const models = mergeAllSources(results, fallback);
  const usedFallback = Boolean((models as typeof models & { usedFallback: boolean }).usedFallback);
  const degradedSources = REQUIRED_SOURCES.filter(id => !results.some(source => source.source_id === id && !source.error && source.models.length > 0));
  const successfulDates = results.filter(source => !source.error && source.models.length > 0)
    .map(source => source.fetched_at).filter(date => Number.isFinite(Date.parse(date))).sort();
  const dataDate = usedFallback ? fallback._updated ?? null : successfulDates[0] ?? null;
  const provenance = {
    usedFallback, dataDate, updated: dataDate,
    stale: usedFallback || snapshotExpired(dataDate),
    dataSourceLabel: usedFallback ? 'fallback' : degradedSources.length ? 'partial' : 'live',
    degradedSources,
  };
  const summary = {
    scoringVersion: SCORING_VERSION,
    ...provenance,
    sources: results.map(({ source_id, models, error, data_date, fetched_at }) => ({ id: source_id, rows: models.length, error, data_date, fetched_at })),
    models: models.length,
    openWeights: models.filter((model) => !model.closed_source).length,
    fallbackCells: models.reduce((n, model) => n + Object.values(model.benchmark_sources).filter((rows) => rows.some((row) => row.is_fallback)).length, 0),
    profiles: DEFAULT_HARDWARE_PROFILES.map(({ name, spec }) => ({
      name,
      recommendations: buildCategoryHardwareRecommendations(openWeightModels(models).map((model) => ({ ...model, hwFit: computeHardwareFit(model, spec) })))
        .map(({ key, model, score, qualified }) => ({ category: key, model: model?.name ?? null, score, qualified, fit: model?.hwFit })),
    })),
    qwen: models.filter((model) => /qwen3\.[58]-(27b|35b-a3b)$/i.test(model.llm_stats_model_id ?? model.name)),
  };
  writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(path.join(directory, 'leaderboard.json'), JSON.stringify({ models, sources: results.map((source) => ({ id: source.source_id, name: source.source_name, url: '', count: source.models.length, error: source.error, fetched_at: source.fetched_at, data_date: source.data_date, date_kind: ['livebench2', 'livebench'].includes(source.source_id) ? 'benchmark_edition' : 'publication', historical: source.source_id === 'livebench', duration_ms: 0, status: source.error ? 'error' : source.models.length ? 'ok' : 'degraded' })), scoringVersion: SCORING_VERSION, fallbackCellCount: summary.fallbackCells, ...provenance }));
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
    schema: 'local-llm-radar/ranking-audit@1', scoringVersion: SCORING_VERSION,
    files: {
      sources: path.relative(directory, capturePath), leaderboard: 'leaderboard.json',
      livebench: path.relative(directory, path.join(path.dirname(capturePath), 'livebench.csv')),
      categories: path.relative(directory, path.join(path.dirname(capturePath), 'categories.json')),
    },
  }, null, 2));
  console.log(JSON.stringify({ ...summary, qwen: summary.qwen.map((m) => ({ name: m.name, score: m.composite_score, evidence: m.rank_status })) }, null, 2));
  if (degradedSources.length) process.exitCode = 1;
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
