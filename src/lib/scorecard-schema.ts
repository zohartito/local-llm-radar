type ScorecardRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ScorecardRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: ScorecardRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function hasOnlyAllowedKeys(value: ScorecardRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isNonNegativeFiniteNumberOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

const SCORECARD_FIELDS = ['model_id', 'name', 'organization', 'release_date', 'params_b', 'license', 'sources', 'benchmarks'] as const;
const SCORECARD_SOURCE_FIELDS = ['api_ref', 'playground', 'paper', 'scorecard_blog', 'repo', 'weights'] as const;
const SCORECARD_BENCHMARK_FIELDS = ['benchmark_id', 'name', 'description', 'categories', 'modality', 'max_score', 'score', 'normalized_score', 'verified', 'self_reported', 'source_url', 'analysis_method'] as const;

/**
 * Shared scorecard trust boundary for both Redis cache reads and browser
 * rendering. Any incomplete or malformed nested value is unavailable data.
 */
export function isValidScorecard(value: unknown): value is ScorecardRecord {
  if (!isRecord(value) || !hasExactKeys(value, SCORECARD_FIELDS)) return false;
  if (typeof value.model_id !== 'string' || value.model_id.length === 0) return false;
  if (!isNullableString(value.name) || !isNullableString(value.organization) || !isNullableString(value.release_date) || !isNullableString(value.license)) return false;
  if (!isNonNegativeFiniteNumberOrNull(value.params_b)) return false;
  if (!isRecord(value.sources) || !hasOnlyAllowedKeys(value.sources, SCORECARD_SOURCE_FIELDS)) return false;
  if (!Object.values(value.sources).every(isNullableString)) return false;
  if (!Array.isArray(value.benchmarks)) return false;
  return value.benchmarks.every((benchmark) => {
    if (!isRecord(benchmark) || !hasExactKeys(benchmark, SCORECARD_BENCHMARK_FIELDS)) return false;
    if (typeof benchmark.benchmark_id !== 'string' || typeof benchmark.name !== 'string') return false;
    if (!isNullableString(benchmark.description) || !isNullableString(benchmark.modality) || !isNullableString(benchmark.source_url) || !isNullableString(benchmark.analysis_method)) return false;
    if (!Array.isArray(benchmark.categories) || !benchmark.categories.every((category) => typeof category === 'string')) return false;
    if (!isNonNegativeFiniteNumberOrNull(benchmark.max_score) || !isNonNegativeFiniteNumberOrNull(benchmark.score) || !isNonNegativeFiniteNumberOrNull(benchmark.normalized_score)) return false;
    return typeof benchmark.verified === 'boolean' && typeof benchmark.self_reported === 'boolean';
  });
}
