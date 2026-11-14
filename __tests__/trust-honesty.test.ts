import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mergeAllSources } from '@/lib/merge-models';
// deriveDataSourceLabel's canonical home is @/lib/trust (the contract module).
// leaderboard-service is expected to re-export it; importing from trust keeps
// this file type-compiling today regardless of when the service re-export lands.
import { deriveDataSourceLabel } from '@/lib/trust';
import type { SourceResult } from '@/lib/live-sources';

/**
 * HONESTY tripwire.
 *
 * When every live PRIMARY source is empty/failed, the pipeline must NOT silently
 * present curated data as if it were live. The merge/service must flag the
 * dataset as fallback (`usedFallback === true`) and surface the date the curated
 * data was last updated (`dataDate`).
 *
 * These honesty fields do NOT exist yet — sibling B agents add them. Forward-
 * referenced fields are read via `(x as any)` so this file still TYPE-COMPILES
 * before the fields land. The assertions below are therefore intentionally RED
 * until the honesty mechanism is implemented.
 */

interface CuratedFile {
  _updated?: string;
  models?: Array<Record<string, unknown>>;
}

function loadCuratedFallback(): CuratedFile {
  const filePath = path.join(process.cwd(), 'data', 'curated-models.json');
  return JSON.parse(readFileSync(filePath, 'utf8')) as CuratedFile;
}

// No live sources at all: the curated file must stand in as the roster, and the
// result must be honestly flagged as fallback.
const EMPTY_LIVE_SOURCES: SourceResult[] = [];

describe('fallback honesty', () => {
  it('still produces a roster from curated data when all live primary sources are empty', () => {
    const fallback = loadCuratedFallback();
    const merged = mergeAllSources(EMPTY_LIVE_SOURCES, { models: fallback.models as never });

    // With no live primary models, the curated file backfills the roster, so the
    // merge must not return an empty leaderboard.
    expect(Array.isArray(merged)).toBe(true);
    expect(merged.length).toBeGreaterThan(0);
    for (const model of merged) {
      expect(Object.values(model.benchmarks).every(value => value === null)).toBe(true);
      expect(model.composite_score).toBe(0);
      expect(model.confidence).toBe(0);
      expect(model.rank_status).toBe('insufficient_evidence');
      expect(model.tier).toBe('');
    }
  });

  it('flags the merged result as usedFallback when there are no live primary sources', () => {
    const fallback = loadCuratedFallback();
    const merged = mergeAllSources(EMPTY_LIVE_SOURCES, { models: fallback.models as never });

    // Forward-referenced honesty flag — accessed via `as any` so this compiles
    // before sibling B adds the field. RED until the flag is implemented.
    expect((merged as unknown as { usedFallback?: boolean }).usedFallback).toBe(true);
  });

  it('exposes the curated dataDate when falling back', () => {
    const fallback = loadCuratedFallback();
    const merged = mergeAllSources(EMPTY_LIVE_SOURCES, { models: fallback.models as never });

    // Forward-referenced freshness field. RED until sibling B surfaces it.
    const dataDate = (merged as unknown as { dataDate?: string }).dataDate;
    expect(typeof dataDate).toBe('string');
    expect(dataDate).toBeTruthy();
  });

  it('labels a no-live, fallback dataset as "fallback"', () => {
    // deriveDataSourceLabel is the green half of the honesty contract: given the
    // honesty signals the pipeline is expected to compute, the user-facing label
    // must read "fallback".
    expect(
      deriveDataSourceLabel({ usedFallback: true, livePrimaryModelCount: 0, degradedCount: 0 })
    ).toBe('fallback');
  });

  /**
   * RUNTIME HONESTY EXPECTATION (verified by the orchestrator end-to-end):
   *
   * When the leaderboard service runs with all live primary sources failing,
   * `getLeaderboardData()` must return a `LeaderboardData` whose honesty surface
   * reports the dataset as fallback — i.e. `deriveDataSourceLabel(...)` over the
   * service's own signals yields 'fallback', the response carries the curated
   * `dataDate` (curated-models.json `_updated`), and the UI shows a clear
   * "showing cached/fallback data" notice rather than presenting stale curated
   * numbers as live. This cannot be invoked deterministically offline here
   * because the service fetches the network; the orchestrator verifies it live.
   */
  it.todo('getLeaderboardData() surfaces a fallback label + dataDate when all live sources fail (orchestrator-verified)');
});
