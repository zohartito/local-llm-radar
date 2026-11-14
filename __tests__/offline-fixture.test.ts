import { readFileSync } from 'node:fs';
import path from 'node:path';
import fixture from './fixtures/synthetic-sources.json';
import { mergeAllSources } from '../src/lib/merge-models';
import type { SourceResult } from '../src/lib/live-sources';

// The public repo ships no third-party score dumps. This synthetic fixture proves
// the merge/score pipeline runs offline from invented data alone.
describe('offline synthetic fixture', () => {
  const models = mergeAllSources(fixture.sources as SourceResult[]);

  it('merges every synthetic model and scores the evaluator-backed ones', () => {
    expect(models.map(m => m.name).sort()).toEqual(['Example Chat 8B', 'Example Coder 32B', 'Sample Reasoner 70B']);
    for (const model of models) {
      expect(model.rank_status).toBe('ranked');
      expect(model.composite_score).toBeGreaterThan(0);
    }
    const byScore = [...models].sort((a, b) => b.composite_score - a.composite_score).map(m => m.name);
    expect(byScore.at(-1)).toBe('Example Chat 8B');
  });

  it('keeps the committed curated fallback free of benchmark numbers', () => {
    const curated = JSON.parse(readFileSync(path.join(process.cwd(), 'data', 'curated-models.json'), 'utf8')) as { models: Record<string, unknown>[] };
    const scoreKeys = ['mmlu_pro', 'gpqa_diamond', 'ifeval', 'arena_elo', 'swe_bench', 'humaneval', 'livecodebench', 'bfcl', 'codeforces_elo', 'aime_2025', 'math_500', 'mgsm', 'arc_agi', 'simpleqa', 'frontier_math', 'code_arena'];
    for (const model of curated.models) for (const key of scoreKeys) expect(model[key] ?? null).toBeNull();
  });
});
