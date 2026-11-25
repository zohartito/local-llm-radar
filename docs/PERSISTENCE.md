# Persistence layer — required distributed cache, leases, and rank history

Designed via a `fusion opus4.8-gpt5.5` panel (Opus 4.8 + GPT-5.5, independent → judged).
Provenance: `~/.claude/fusion-runs/2026-06-17_140159_opus4.8-gpt5.5.md`.

## What it does
One free **Upstash Redis** database, three coordinated uses:

1. **Shared hot cache + single-flight refresh lock** — fixes the cross-instance /
   cold-start duplication where every serverless instance independently re-fetched all
   ~7 sources and tripped HuggingFace **HTTP 429s**. Now only the lock winner re-fetches;
   every other instance reads the shared blob. **Soft-TTL:** the Redis key lives ~7 days
   but logical freshness is gated by `freshUntil` inside the value, so during a 429 storm
   instances serve the last-good shared data instead of all collapsing to a live re-fetch.
2. **Daily rank snapshots** — a compact per-day time-series (`slug → rank`, overall + per
   category) used only by `/api/rankings?mode=index` for historical deltas. The active
   dashboard has no Trend column; the unused `ModelTable` component is not mounted.
   Same-test rankings never reuse index history. Fallback, stale and partial days are
   never snapshotted.
3. **Per-model scorecard cache, lease, and budget** — positive results are cached for
   15 minutes, unavailable results for 60 seconds, and a per-model lease ensures only one
   serverless instance fetches an upstream scorecard at a time.

`data/curated-models.json` remains the last-resort total-outage fallback. It is
a legacy read-only artifact, not a database: it has no independently verifiable
value-level provenance, so no workflow or script may regenerate it until such
provenance can be supplied. The application has no relational database or
durable model store; Redis is the required distributed coordination/cache layer
for deployed live paths.

## Required production configuration
Both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are required in
every deployed runtime. Missing, partial, or unavailable Redis is an explicit
failure state, never an in-memory substitute:

- Live refresh does not fetch upstreams without the distributed lock and does
  not overwrite last-good cache data with fallback/empty output.
- Scorecard cache, coalescing lease, and public rate budget are all Redis-backed;
  a scorecard request is denied when that backend is unavailable.
- Cron reports `refreshed:false` and does not snapshot ranks when live refresh
  did not complete.

For deployment and local integration testing:

1. Vercel dashboard → **Storage → Upstash (Redis) → Create + Connect to Project**. This
   auto-injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` into the project env.
   (Pull the same two vars into `.env.local` for local testing.)
2. Set `CRON_SECRET` in every environment as well, then redeploy. The shared
   cache and scorecard coordination become available. Index API history requires
   healthy daily snapshots; connecting Redis does not add a dashboard Trend column.

(`@upstash/redis` is already a dependency. "Vercel KV" is deprecated → Upstash is the path.)

## Keys (prefix `llmr:v2`, tracks `SCORING_VERSION`)
```
llmr:v2:leaderboard:<SCORING_VERSION>:current   { data, freshUntil, staleUntil, scoringVersion }   EX 7d
llmr:v2:refresh:<SCORING_VERSION>:lock          random token,  SET NX EX 120  (compare-and-delete release)
llmr:v2:scorecard:<model>     {value}  EX 15m (or 60s negative cache)
llmr:v2:scorecard-lease:<model> random token, SET NX EX 30 (compare-and-delete release)
llmr:v2:scorecard-rate:<key>  atomic INCR + EX 60 (12 requests per key/window)
llmr:v2:snapshots:dates       ZSET  (member=YYYY-MM-DD, score=UTC epoch-day)
llmr:v2:snapshot:YYYY-MM-DD   { date, updated, scoringVersion, quality, ranks:{overall,categories} }  EX ~400d
```

## Flow
- **Read** (`getLeaderboardData`): L1 in-process cache → **L2 shared Redis** (the 429 fix) →
  single-flight `refreshWithLock()` (winner fetches + warms shared cache; loser serves the
  shared blob) → curated fallback.
- **Scorecard**: Redis cache hit → per-model Redis lease winner fetches/persists → lease
  losers poll Redis only; they never duplicate an upstream scorecard request. A fetch that
  reaches its 12-second deadline retains its 30-second lease until expiry, protecting against
  abort-ignoring upstream clients. Local cache expiration is capped to the remaining shared
  TTL. CDN response TTL is no greater than the 15-minute shared positive-cache TTL.
- **Cron** (`/api/refresh/cron`, daily): force-refresh only on a lock-winning proven-live
  result, then `writeDailyRankSnapshot()`; fallback/stale/error results are never snapshotted.
- **Index history** (`/api/rankings?mode=index`): joins current index ranks against the newest valid snapshot 7–10 days old
  (searching backward only, skipping missing or malformed days) and fills `rank_change` /
  `previous_rank`, with response-level `trendSnapshotDate`. Requires a healthy current-method
  snapshot on both sides and the all-model population (`local=true` has no delta).
  Null without compatible history; default benchmark mode never reports index movement.

## Cost / footprint
History size depends on ranked population, slug length and successful snapshot days. A local JSON sizing check of the `store.ts` snapshot shape (overall plus five category maps, identical ranked population in each, slugs `invented-model-0001` onward) gives:

| Ranked models per list | JSON bytes/day | 365 daily snapshots | 400 daily snapshots |
| --- | ---: | ---: | ---: |
| 100 | 15,151 | 5.27 MiB | 5.78 MiB |
| 382 | 59,143 | 20.59 MiB | 22.56 MiB |

These are serialized JSON estimates, not measured Redis usage: multiply `Buffer.byteLength(JSON.stringify(snapshot))` by the number of retained days. Snapshot keys expire after 400 days; failed/unhealthy days write no snapshot. The dates index has no TTL, and Redis overhead, hot-cache blobs, scorecards and command usage are additional. Compare the total with the provider's current quotas; there is no fixed <2 MB/year bound.
