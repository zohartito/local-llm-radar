/** Scheduler and manual refresh authentication intentionally fail closed. */
export function isAuthorizedRefresh(headers: Headers): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return headers.get('authorization') === `Bearer ${secret}` || headers.get('x-cron-secret') === secret;
}
