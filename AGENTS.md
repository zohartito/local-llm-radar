<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## The nightly loop (SCHED) — already exists; do NOT add a second scheduler
The "nightly new-release fetch → scorecard → leaderboard update" loop is **already
built** as the **Vercel cron** `GET /api/refresh/cron` (`vercel.json`, daily 09:00 UTC):
it force-refreshes `getLeaderboardData()` (new models appear automatically from live
Arena/benchmark sources), re-scores with `v7-editioned` (`src/lib/merge-models.ts`), and
writes the daily rank snapshot (`writeDailyRankSnapshot`). It emits a JSON receipt
(`{refreshed, cacheStatus, updated, sourceCount}`) and is `CRON_SECRET`-gated.

**This is the canonical loop — keep it the ONLY scheduler.** An earlier trust-hardening
audit consolidated two competing schedulers into this one; a GitHub Actions
`schedule:` would reintroduce that bug, and `scripts/update-scores.mjs` never writes
the read-only fallback file.
`scripts/validate-workflow-tombstones.cjs` still forbids credentialed AI PR workflows.

Video generation is a separate **fit/throughput log** at `GET /video`
(`data/video-fit.json`). It is not scored by `v7-editioned` and is not part of
the cron. `/category/video` redirects to `/video`; it must never fall through to text rankings.

Conversational speech and coding-agent voice interfaces have a separate manual
evidence catalog at `/voice` (`data/voice-fit.json`, schema `src/lib/voice-fit.ts`).
`/category/voice` redirects there; `/api/voice` serves validated data. It never enters
text scoring or the cron. Assess exact runtime variants and each GPU separately;
voice/persona control and structured tool calls do not establish a persistent coding
harness. Published requirements, download sizes and other-machine peaks are not
local measurements. Local measurements require dated machine/runtime/workload
receipts; schema validation only checks their structure, not the truth of a run.

## Data licences (2026-11-14) — read before adding a source or committing data
`docs/DATA-SOURCES.md` records every source's terms and a verdict (a–e). Only
results under a licence that allows redistribution may be committed: set
`snapshotLicence` on the board in `model-types.ts`, and `capture:specialists` saves
only those boards. Everything else is fetched at request time with attribution and
never committed (no captures, fixtures or audit evidence copied from it). Sources
whose terms forbid scraping or republishing (Artificial Analysis) are links only.
`data/curated-models.json` holds roster metadata; its score fields stay null.
Tests use invented data (`__tests__/fixtures/`).
Credits for every source live in `src/lib/source-credits.ts` (rendered at `/sources`
and in the footer). Public JSON APIs pass through `src/lib/public-api.ts`: scores and
ZeroEval prices from `withheldInApi` sources become null with source name/URL; facts,
memory estimates and ranks stay. The six data pages are ISR server pages
(`force-static`, `revalidate = 300`) that pass `loadSiteLeaderboard()` to a client
`*-view.tsx`; they never read `/api/leaderboard`.

## Benchmark data policy (changed 2026-08-15 — read before touching sources)
Vendor-self-reported benchmark values ARE ingested. A 159-model census found the
`verified` flag is never true (0 of 3,171 rows) while 3,067 are `self_reported`,
so excluding them discarded ~97% of published data and left new releases
invisible. Trust is enforced by WEIGHT + ATTRIBUTION, not exclusion: such values
arrive under the `llmstats_recent` source id so every cell stays attributable in
`benchmark_sources`, and carry reliability 0.35-0.5 against LiveBench's 1.0.

Two rules follow from this and must not be quietly reversed:
- Anchors (`BENCH_ANCHORS`) are MEASURED from observed field min/max, never from
  a benchmark's declared `max_score` (that field is unreliable) and never
  guessed. Four saturated-ceiling bugs came from assumed ceilings.
- A benchmark is only added when several INDEPENDENT vendors publish it. One lab
  scoring its own model cannot rank it against others (apex-swe, cursorbench-3.2
  were rejected on exactly this basis).

Rank eligibility counts independent evidence FAMILIES, not raw keys — the eight
LiveBench sub-scores are one evaluation, not eight confirmations. If you add
families, `RANK_MIN_FAMILY_COVERAGE` must scale with the new denominator or the
board silently empties.

## Agent rules (all harnesses)
- Local measurements use unique private run directories and exclusive receipt creation; `measurement-cli.test.ts` verifies repeated runs and existing-output refusal with synthetic responses. Generation failures abort and await the sampler before exit.
- Determinism boundary: anything that must be EXACT (money, geometry, safety limits, scoring, pricing) lives in code; the model only orchestrates and judges.
- Hardware page contract: `hardware.ts` owns memory math; `hardware-ranking.ts` owns fit annotations and shared recommendation/table order. Use `fitHardwareModels` for both the full stack and primary GPU; preserve canonical catalog slugs instead of rebuilding IDs from display names. Keep system RAM separate from VRAM, preserve the 10% multi-GPU split reserve, and test both GPU scopes.
- Keep this file current: when you change how this repo is run, tested, or structured, update AGENTS.md in the same commit. Keep it under ~150 lines.

## Trust audit / verification
- Model navigation: preserve the original dashboard/table at `/` and the existing visual style. `ModelTypeButtons` and `model-navigation.ts` provide family/subtype buttons; do not replace them with task cards. `/leaderboards` and `/text` redirect home; `/leaderboards/more` links integrated and explicitly external boards. `/embeddings` joins exact model/experiment IDs with explicit input filters and selected-suite ranking. Never infer inputs or average cross-suite scores; `embedding-metadata.ts` holds dated corrections.
- Shared dashboard UI: `leaderboard-presentation.tsx` shares text/specialist cards, filters, table styles and score colors. Specialists use source metric leaders, relative column colors, access badges and coverage bars; do not invent cross-modality tiers or imply specialist hardware fit.
- Specialist tables: `specialist-columns.ts` defines the shared dense matrix, source units, and numeric sort directions. Scores and available components stay visible in columns; quality-column clicks rank that metric; spec/price sorting retains the active quality ranks. `SpecialistRow.benchmarks` keeps separate numeric metrics. MTEB group means require complete group coverage; sparse task cells keep each cache payload below 2 MiB. Missing scores stay missing.
- Model-type boards: `/leaderboards/[type]` serves the specialist tables; `/leaderboards/[type]` and `/api/leaderboards/[type]` serve specialist evaluations. `model-types.ts` owns the registry and metric direction; `specialist-parsers.ts` validates exact editions/identities. Keep these separate from the text composite and hardware estimator. Next's existing Data Cache refreshes parsed specialist results on demand (1h); do not add a scheduler. `npm run capture:specialists` manually replaces the dated fallback only after every `snapshotLicence`-eligible source succeeds. Null/partial scores never receive ranks; cross-encoders must not enter embedding boards; arena category/voice tables must not be pooled.
- `npx tsx scripts/audit-specialist-data.ts <capture-directory>` checks raw-source ranks, licence-redacted API fields and MTEB task scaling; `--replay` uses saved inputs. Capture preparation is in `docs/MODEL_TYPES.md`.
- `npx tsx scripts/audit-ranking-claims.ts <capture-directory>` reads the versioned live/replay bundle, checks cell attribution and independently recomputes indices/legacy LiveBench. Optional `production.json` is compared with redacted API expectations; see `docs/SCORING.md`.
- `npm run audit:live` captures public upstream data under ignored `output/trust-audit/`; it never writes Redis or invokes production refresh. `npm run audit:replay` recomputes the saved capture; add `-- --capture path.json.gz --out output/round2/replay` for an archived input and separate output.
- Live/replay audits retain captured timestamps and fallback provenance, and exit 1 after writing receipts if any required source is missing, empty or errored.
- Source transport health, benchmark edition date, publication date, and cache age are distinct. Never label a successful fetch as a new evaluation.
- Bump `SCORING_VERSION` when changing score semantics or benchmark editions; the store rejects incompatible caches/history. `/methodology` reads category recipes and anchors directly from code.
- Identity (`merge-models.ts`): match each source row exact-first. A broad alias may ignore only effort/thinking wording; product tokens (chat/base/preview/alpha/beta/plus/context size) and release markers must agree. Metadata is one authority-ordered observation (curated last), never a blend. Fix a wrong upstream fact only through a dated, URL-cited `VERIFIED_METADATA` entry. Re-run `npm run audit:replay` against a saved capture after any matching change.
- LiveBench 2.0 and legacy v1 have separate source IDs, metric keys and effort settings. Current overall, coding, reasoning and long-agentic comparisons use v2; math uses v1. Do not feed v2 into the experimental capability index.
- Runtime dependencies: Next.js 16.4.6; Node ^20.19.0, ^22.13.0 or >=24. CI covers the two minimum versions and Node 24. `npm run dev` binds to 127.0.0.1; network exposure requires an explicit `--hostname` override. Validation: lint, Jest, production build, workflow tombstones, and browser checks.
- Shared leaderboard cache payloads and timestamps are runtime-validated; refresh writes must still own the Redis lease. CDN TTL may not outlive the snapshot's 30-minute freshness window, and open-tab badges expire locally.
- Historical movement requires a healthy current-method snapshot on both sides. Missing/malformed days are skipped within the bounded history window.
- Scorecard budgets (12/client and 60/global per 60 seconds) are spent only by an upstream-fetch lease owner. Invalid slugs/cache hits do not consume them. Client identity trusts Vercel forwarding only under `VERCEL=1`, or the configured secret proxy; unknown proxies share a conservative bucket. Never persist raw IP addresses in budget keys.

- Model release dates: use `model-release.ts`/`ReleaseDate.tsx` everywhere. Specialist `releaseDate` comes only from explicit model metadata (MTEB); never replace missing dates with report/evaluation/check dates. Unknown dates sort last. Known paper dates are withheld through cited overrides in `embedding-metadata.ts`; keep the original value and reason in row evidence. Parser cache: `specialist-boards-v9-vision-releases`.
- OCR/audio/video understanding: part of 23 specialist boards. OCRBench pins private-test period and language; MMAU pins evaluator-parsed endpoint and full/mini split; original Video-MME pins subtitle condition and retains size/frame/date variants. No per-row fallback between scopes. Reject column drift/conflicting identities, preserve zero/missing components, and withhold partial averages. `scopeNote` exposes limitations above tables. See `docs/model-type-coverage.md`.
- Accuracy boundary: uncited benchmark numbers in `curated-models.json` are archived only; never backfill published cells or scores from them. Vendor/aggregator results remain attributed and downweighted. Category navigation is an index, never a universal winner claim; display the selected category score and scope raw leaders to imported evaluator observations, with ties.

## Same-test category comparisons (2026-10-26)
`benchmark-comparisons.ts` owns public category defaults and ranks: one named test,
evaluator and dataset edition; no per-model fallback across cohorts. Exact ties
share positions, and missing/conflicting results stay unranked. Dashboard, category
routes, Compare, Hardware recommendations and `/api/rankings` use this contract.
Weighted indices remain explicit optional analysis (`mode=index` in the API);
their existing cron snapshots must never become same-test rank trends. Vendor
reports stay visible/ingested, but cannot substitute for a missing evaluator run.
Hardware memory math and primary/full-stack fit eligibility are unchanged.

## Vision boards and release evidence (2026-10-27)
- `vision-parsers.ts`: measured SAB COCO val2017 boxes/masks exclude dagger paper-only rows; vendor evaluator attribution, runtime and resolutions remain visible. COCO test-dev exports are separate historical submission archives ending 2020; dates are submission dates, not releases. KITTI depth prediction uses four lower-is-better error metrics; never mix completion/Eigen results.
- `/releases` shows dated saved specialist inventory plus current cached text roster; counts are board entries, not unique models. `data/model-release-evidence.json` and `release-evidence.ts` enrich exact board/name identities after cache reads, preserving upstream conflicts and timestamps. No fuzzy family/date joins.
- `npm run audit:releases` rechecks primary availability excerpts and writes ignored `output/release-audit/{report,inventory}.json`, including missing-date research links. It is read-only and exits nonzero on missing/changed evidence or unavailable text inventory. A valid proof does not auto-publish new candidates. Paper/repository/evaluation/check dates never substitute for model releases. No extra scheduler.
