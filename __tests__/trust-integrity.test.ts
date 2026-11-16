import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BENCHMARK_KEYS } from '@/lib/merge-models';

/**
 * The committed roster contains metadata only. Its null-score invariant is
 * checked explicitly below. Legacy numeric heuristics use nonempty invented
 * data; passing them is not a claim about real publishers' benchmark accuracy.
 */

interface CuratedModel {
  name: string;
  benchmarks?: Record<string, number | null>;
  [key: string]: unknown;
}

const CURATED_PATH = path.join(process.cwd(), 'data', 'curated-models.json');

function loadModels(): CuratedModel[] {
  const raw = JSON.parse(readFileSync(CURATED_PATH, 'utf8')) as { models?: CuratedModel[] };
  return raw.models ?? [];
}

function benchmarkValue(model: CuratedModel, key: string): number | null {
  const nested = model.benchmarks?.[key];
  if (typeof nested === 'number') return nested;
  const top = model[key];
  if (typeof top === 'number') return top;
  return null;
}

// ELO-style fields per the contract: arena_elo, code_arena, any *_elo, codeforces_elo.
function isEloStyle(key: string): boolean {
  return key === 'arena_elo' || key === 'code_arena' || /_elo$/.test(key) || key === 'codeforces_elo';
}

const MAX_SHARED_MODELS = 6;
const PCT_MIN = 0;
const PCT_MAX = 100;
const ELO_MIN = 600;
// Code Arena's frontier crossed 2000 in mid-2026 (top models sit at 2100+ on
// llm-stats itself); 2600 still catches scale-mixing junk and typos.
const ELO_MAX = 2600;
// Codeforces ratings span a much wider band than chat-preference ELO (real
// ratings run ~0 to ~3800), so they get their own range to avoid nulling real data.
const CODEFORCES_MIN = 0;
const CODEFORCES_MAX = 4000;
// A top-quartile model should not report a sub-floor percentage benchmark.
const CONTRADICTION_FLOOR = 20;
const TOP_QUARTILE = 0.75;

const curated = loadModels();
// Invented observations exercise top-level and nested cells, valid limits and
// repeated values without depending on scores in the metadata-only roster.
const models: CuratedModel[] = Array.from({ length: 8 }, (_, index) => ({
  name: `Invented model ${index + 1}`,
  arena_elo: index === 7 ? 2600 : 600 + index * 200,
  codeforces_elo: index === 7 ? 4000 : index * 400,
  benchmarks: { swe_bench: index === 0 ? 0 : index === 7 ? 100 : 40 },
}));

describe('RAD-14: roster invariant and synthetic numeric integrity checks', () => {
  it('loads a non-empty curated dataset', () => {
    expect(curated.length).toBeGreaterThan(0);
  });

  it('keeps all committed benchmark cells null or absent', () => {
    expect(curated.length).toBeGreaterThan(0);
    for (const model of curated) {
      for (const key of BENCHMARK_KEYS) {
        expect(model[key] ?? null).toBeNull();
        expect(model.benchmarks?.[key] ?? null).toBeNull();
      }
    }
  });

  it('synthetic data does not share any single benchmark value across more than 6 distinct models', () => {
    // RAD-14: a passing numeric check must actually inspect numbers.
    expect(models.some(model => BENCHMARK_KEYS.some(key => benchmarkValue(model, key) !== null))).toBe(true);
    const violations: Array<{ benchmark: string; value: number; count: number }> = [];

    for (const key of BENCHMARK_KEYS) {
      const modelsByValue = new Map<number, Set<string>>();
      for (const model of models) {
        const value = benchmarkValue(model, key);
        if (value === null) continue;
        if (!modelsByValue.has(value)) modelsByValue.set(value, new Set());
        modelsByValue.get(value)!.add(model.name);
      }

      let maxSharedCount = 0;
      for (const [value, namesSet] of modelsByValue) {
        if (namesSet.size > maxSharedCount) maxSharedCount = namesSet.size;
        if (namesSet.size > MAX_SHARED_MODELS) {
          violations.push({ benchmark: key, value, count: namesSet.size });
        }
      }
      // Per-key invariant: the most-shared value must not exceed the threshold.
      // Report the precise duplicate cluster on failure.
      expect(maxSharedCount).toBeLessThanOrEqual(MAX_SHARED_MODELS);
    }

    if (violations.length > 0) {
      const lines = violations
        .sort((a, b) => b.count - a.count)
        .map((v) => `  ${v.benchmark} = ${v.value}  shared by ${v.count} models`);
      console.error(`Copy-paste benchmark clusters (>${MAX_SHARED_MODELS} models share one value):\n${lines.join('\n')}`);
    }
    expect(violations).toEqual([]);
  });

  it('synthetic data keeps percentage benchmarks in [0,100] and ELO benchmarks in range (Arena 600-2600, Codeforces 0-4000)', () => {
    expect(models.some(model => BENCHMARK_KEYS.some(key => benchmarkValue(model, key) !== null))).toBe(true);
    const violations: string[] = [];

    for (const model of models) {
      for (const key of BENCHMARK_KEYS) {
        const value = benchmarkValue(model, key);
        if (value === null) continue;

        if (key === 'codeforces_elo') {
          if (value < CODEFORCES_MIN || value > CODEFORCES_MAX) {
            violations.push(`${model.name} ${key}=${value} (expected ${CODEFORCES_MIN}-${CODEFORCES_MAX})`);
          }
        } else if (isEloStyle(key)) {
          if (value < ELO_MIN || value > ELO_MAX) {
            violations.push(`${model.name} ${key}=${value} (expected ${ELO_MIN}-${ELO_MAX})`);
          }
        } else if (value < PCT_MIN || value > PCT_MAX) {
          violations.push(`${model.name} ${key}=${value} (expected ${PCT_MIN}-${PCT_MAX})`);
        }
      }
    }

    if (violations.length > 0) {
      console.error(`Out-of-range benchmark values:\n${violations.map((v) => `  ${v}`).join('\n')}`);
    }
    expect(violations).toEqual([]);
  });

  it('synthetic data has no contradiction rows: a top-quartile model with a sub-floor percentage benchmark', () => {
    const eloValues = models
      .map((model) => benchmarkValue(model, 'arena_elo'))
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);

    expect(eloValues.length).toBeGreaterThan(0);
    const quartileThreshold = eloValues[Math.floor(eloValues.length * TOP_QUARTILE)];
    const violations: string[] = [];

    for (const model of models) {
      const elo = benchmarkValue(model, 'arena_elo');
      if (elo === null || elo < quartileThreshold) continue;

      for (const key of BENCHMARK_KEYS) {
        if (isEloStyle(key)) continue;
        const value = benchmarkValue(model, key);
        if (value === null) continue;
        if (value < CONTRADICTION_FLOOR) {
          violations.push(`${model.name} (arena_elo=${elo}) ${key}=${value} < ${CONTRADICTION_FLOOR}`);
        }
      }
    }

    if (violations.length > 0) {
      console.error(
        `Contradiction rows (top-quartile arena_elo >= ${quartileThreshold} with a sub-${CONTRADICTION_FLOOR} percentage benchmark):\n` +
          violations.map((v) => `  ${v}`).join('\n')
      );
    }
    expect(violations).toEqual([]);
  });
});
