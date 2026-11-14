import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

/** Only trust an address established by the deployment, never an arbitrary header.
 * Vercel overwrites its forwarding headers to prevent spoofing:
 * https://vercel.com/docs/headers/request-headers (checked 2026-10-22).
 * Redis stores a keyed digest for at most the budget window, not the address. */
export function scorecardClientKey(request: Request): string {
  const proxySecret = process.env.TRUSTED_PROXY_SECRET;
  let address: string | undefined;
  if (proxySecret && request.headers.get('x-radar-proxy-secret') === proxySecret) {
    address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  } else if (process.env.VERCEL === '1') {
    address = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  }
  const key = proxySecret || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!address || !isIP(address) || !key) return 'public-unattributed';
  return `client:${createHmac('sha256', key).update(address).digest('hex')}`;
}
