import type { LLMStatsModelScorecard } from './live-sources';
import { isValidScorecard } from './scorecard-schema';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The scorecard route deliberately returns an envelope so unavailable upstream
 * data remains a successful, cacheable response. Keep the client at this
 * boundary instead of letting it treat that envelope as upstream scorecard
 * data. A malformed success response is unavailable, never renderable data.
 */
export function scorecardFromApiResponse(payload: unknown): LLMStatsModelScorecard | null {
  if (!isRecord(payload)) return null;
  if (payload.available !== true) return null;
  const scorecard = payload.scorecard;
  return isValidScorecard(scorecard) ? scorecard as unknown as LLMStatsModelScorecard : null;
}

/** Third-party scorecard fields are data, not navigation authority. */
export function safeScorecardLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    // These links leave the site in a new tab. HTTPS is the only reviewed web
    // scheme; reject javascript:, data:, file:, protocol-relative, and URLs
    // with embedded credentials rather than attempting to sanitize them.
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
