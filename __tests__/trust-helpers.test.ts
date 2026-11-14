import {
  classifySourceStatus,
  isStale,
  freshnessOf,
  deriveDataSourceLabel,
} from '@/lib/trust';

const DAY = 86_400_000;
// Fixed reference instant so every time-based assertion is deterministic.
const NOW = Date.parse('2026-06-17T00:00:00.000Z');

describe('classifySourceStatus', () => {
  it("returns 'error' when the source was never attempted", () => {
    expect(classifySourceStatus({ attempted: false, ok: true, rowCount: 100 })).toBe('error');
    expect(classifySourceStatus({ attempted: false, ok: false, rowCount: 0 })).toBe('error');
  });

  it("returns 'error' when attempted but not ok, regardless of rowCount", () => {
    expect(classifySourceStatus({ attempted: true, ok: false, rowCount: 100 })).toBe('error');
    expect(classifySourceStatus({ attempted: true, ok: false, rowCount: 0, error: 'boom' })).toBe('error');
  });

  it("returns 'degraded' when attempted and ok but rowCount <= 0", () => {
    expect(classifySourceStatus({ attempted: true, ok: true, rowCount: 0 })).toBe('degraded');
    expect(classifySourceStatus({ attempted: true, ok: true, rowCount: -5 })).toBe('degraded');
  });

  it("returns 'ok' when attempted, ok, and rowCount > 0", () => {
    expect(classifySourceStatus({ attempted: true, ok: true, rowCount: 1 })).toBe('ok');
    expect(classifySourceStatus({ attempted: true, ok: true, rowCount: 305 })).toBe('ok');
  });
});

describe('isStale', () => {
  it('is stale when the timestamp is null', () => {
    expect(isStale(null, 7, NOW)).toBe(true);
  });

  it('is stale when the timestamp is unparseable', () => {
    expect(isStale('not-a-date', 7, NOW)).toBe(true);
    expect(isStale('', 7, NOW)).toBe(true);
  });

  it('is not stale when the data is fresh (age < maxAge)', () => {
    const oneDayAgo = new Date(NOW - 1 * DAY).toISOString();
    expect(isStale(oneDayAgo, 7, NOW)).toBe(false);
  });

  it('is not stale exactly at the boundary (age == maxAge uses strict >)', () => {
    const exactlySevenDays = new Date(NOW - 7 * DAY).toISOString();
    expect(isStale(exactlySevenDays, 7, NOW)).toBe(false);
  });

  it('is stale one millisecond past the boundary', () => {
    const justOver = new Date(NOW - 7 * DAY - 1).toISOString();
    expect(isStale(justOver, 7, NOW)).toBe(true);
  });

  it('is stale when clearly older than maxAge', () => {
    const thirtyDaysAgo = new Date(NOW - 30 * DAY).toISOString();
    expect(isStale(thirtyDaysAgo, 7, NOW)).toBe(true);
  });

  it('treats a future timestamp as fresh (negative age never exceeds maxAge)', () => {
    const future = new Date(NOW + 5 * DAY).toISOString();
    expect(isStale(future, 7, NOW)).toBe(false);
  });
});

describe('freshnessOf', () => {
  it('reports null dataDate / null ageDays / stale=true for a null timestamp', () => {
    expect(freshnessOf(null, 7, NOW)).toEqual({ dataDate: null, ageDays: null, stale: true });
  });

  it('reports the raw string / null ageDays / stale=true for an unparseable timestamp', () => {
    expect(freshnessOf('garbage', 7, NOW)).toEqual({ dataDate: 'garbage', ageDays: null, stale: true });
  });

  it('computes a fractional ageDays for a fresh timestamp', () => {
    const twelveHoursAgo = new Date(NOW - 0.5 * DAY).toISOString();
    const info = freshnessOf(twelveHoursAgo, 7, NOW);
    expect(info.dataDate).toBe(twelveHoursAgo);
    expect(info.ageDays).toBeCloseTo(0.5, 6);
    expect(info.stale).toBe(false);
  });

  it('marks stale=true once the timestamp exceeds maxAge', () => {
    const tenDaysAgo = new Date(NOW - 10 * DAY).toISOString();
    const info = freshnessOf(tenDaysAgo, 7, NOW);
    expect(info.ageDays).toBeCloseTo(10, 6);
    expect(info.stale).toBe(true);
  });
});

describe('deriveDataSourceLabel', () => {
  it("returns 'fallback' whenever usedFallback is true (even with degraded sources)", () => {
    expect(deriveDataSourceLabel({ usedFallback: true, livePrimaryModelCount: 0, degradedCount: 0 })).toBe('fallback');
    expect(deriveDataSourceLabel({ usedFallback: true, livePrimaryModelCount: 200, degradedCount: 3 })).toBe('fallback');
  });

  it("returns 'partial' when not fallback but at least one source is degraded", () => {
    expect(deriveDataSourceLabel({ usedFallback: false, livePrimaryModelCount: 200, degradedCount: 1 })).toBe('partial');
  });

  it("returns 'live' when not fallback and nothing is degraded", () => {
    expect(deriveDataSourceLabel({ usedFallback: false, livePrimaryModelCount: 200, degradedCount: 0 })).toBe('live');
  });
});
