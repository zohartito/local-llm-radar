# Scoring methodology — v7-editioned

This is a heuristic index of published results, not a calibrated measurement of intelligence, accuracy, independence, or deployment readiness. `/methodology` renders the live recipe and anchor constants from `merge-models.ts`; it is the user-facing reference. This document explains the behavior and limits.

The v7 snapshot includes current LiveBench 2.0 as separate comparison metrics; it does not change the experimental index formula or its inputs.

## Data and aggregation

Primary sources establish the model catalog. Enrichment sources add matched observations; curated data can fill roster and metadata gaps with explicit fallback provenance. Its uncited benchmark numbers are excluded from public cells and all scoring. Values outside their measurement domains are rejected. Missing values remain null. Per-source variant collapse can retain each benchmark's best published configuration, so a model row can combine results from different efforts/scaffolds; it is not necessarily one reproducible run. Cross-source cells select a published observation: direct evaluator first, then aggregator/vendor. Equal-priority feeds use a stable publisher ID/name order, not the highest value. All contributing live reports remain in provenance with a selected marker. Missing scores remain missing even when the archived file contains a number. No synthetic midpoint is presented as a measured result.

**Identity (v5).** Each board row is matched on its own, before rows are grouped: first an exact published name or ID, then a strict alias that ignores only effort/thinking settings and instruct/it wording. Product words (chat, base, preview, latest, alpha, beta, experimental, `+`/plus, context sizes such as 128K) must agree. Release markers (full dates, or valid MMDD codes compared against the catalog's IDs, names and release date) must not conflict. An undated name that fits several releases joins none of them. Unmatched LMArena rows become their own name-only rows; they never collapse into a sibling release. Because of this, one board value can no longer land on another release (for example the 2024-10 Claude 3.5 Sonnet rating on the 2024-06 row) or another product (GPT-5.2 Chat on GPT-5.2). The cost is that a few same-product spellings now appear as separate rows.

**Metadata (v5).** Provider, license, parameters, context and release date each come from one observation, in source-authority order (ZeroEval, LLM Stats scorecards, Code Arena, LMArena, Artificial Analysis, other boards), with curated data last. Values are never medians or maxima across sources. A license is shown in the most readable spelling of the same claim. When live sources disagree on openness (a downloadable license against a proprietary claim), the status is unknown, unless a dated primary-source record in `VERIFIED_METADATA` settles it. `metadata_sources` lists every claim with the selected one marked.

`benchmark_sources` records the source, original model name, raw value, fallback flag, and dataset date where available. Different reporting websites do not by themselves establish independent evaluations. Vendor reports remain ingested, as required by project policy; they are not promoted to independent measurements.

Edition/tool-use keys must stay separate. HLE with tools, without tools, and unspecified conditions are distinct; only explicitly no-tools HLE is eligible for reasoning scoring. AIME test years remain separate. Terminal-Bench 2.0, 2.1, 3.0, and 4.0 are distinct; only 4.0 enters the current composite (observed 11.2–64.9, high anchor 70). LiveCodeBench v6 and Pro are separate; Pro is display-only. Unknown conditions must not be silently inferred from an ambiguous title.

## Arithmetic

For each eligible cell:

```
normalized = clamp(100 * (raw - low) / (high - low), 0, 100)
weight = min(benchmark_reliability, source_cap) * 0.75
category = (sum(weight * normalized) + 0.5 * 35) / (sum(weight) + 0.5)
```

No cells in a category yields null. The composite gives an absent category its fixed prior of 35 at full category weight; it does not renormalize around missing categories. No observed categories at all yields 0. Final composite is rounded to one decimal.

Source caps: direct evaluator feeds can use benchmark reliability up to 1; preference arenas cap at 0.35; vendor/aggregator/unclassified reports cap at 0.5. A cell uses the selected observation’s source cap. This still does not resolve incompatible harnesses; inspect raw source values. The constant 0.75 support multiplier does not increase with mirror count. The public `source_count` is a count of reporting records, not independent experiments.

Weights: coding 40%, agentic 22%, reasoning 18%, mathematics 10%, general/overall signals 10%. Only explicit index mode uses this composite. The default Overall table and hardware comparison use a single LiveBench 2.0 edition. Individual category scores use that category's input list; chat uses Arena, LiveBench Global, and IFEval. Hardware never changes capability scores.

Anchors are fixed across the current population. Adding unrelated models cannot change a score. Anchor revisions need a new scoring version and an observed-data rationale. The 2026-10-22 census found saturated bands for Codeforces (max2727), LiveBench agentic (77.3), MATH-500 (98), ARC (95), FrontierMath (89), and SimpleQA (97.1). Those bands were expanded with headroom, constrained to the observed percentage domain. This does not certify benchmark-edition comparability.

Release date no longer decays measured capability. Data-age warnings belong to provenance/freshness, not an invented decline in a model's ability.

The complete ZeroEval feed also supplies SWE-Pro, BrowseComp, Toolathlon and MCP-Atlas for older models, avoiding expiry of those fields when a model leaves recent discovery. Other scorecard-only fields still need a durable archive.

## Evidence, sort positions, and tiers

Coverage is the fraction of tracked score keys present. The `confidence` API field is reliability-weighted coverage over the fixed tracked-key denominator; the UI calls it evidence. It is NOT a probability or confidence interval.

`rank_status` is an evidence annotation: the ranked status requires at least four benchmark families across at least three domains, including coding and agentic, a denominator-scaled family-coverage threshold, and at least one selected evaluator-tier observation. Vendor-only breadth remains provisional, with its values still ingested and scored. LiveBench sub-scores are one family; benchmark family is not synonymous with independent experiment or independent vendor. All scored rows remain sortable. Insufficient-evidence rows have no composite/category ordinal or trend; provisional positions remain visibly labeled and can sort high. Sorting one raw benchmark shows the observational order of its reported values. Hardware excludes insufficient-evidence rows from winner cards and places them after rankable rows in its default table sort. Provisional rows can still win with a warning. Overall qualification uses the ranked family gate; individual categories additionally require 50% coverage. Coverage remains visible separately.

Tiers are fixed score bands: S≥75, A≥60, B≥45, C≥30, D<30. They establish neither local speed nor readiness for production.

Scores are sensitive to which tests are published. Prior shrinkage rewards additional high results: a model with more reported tests can outrank another with a better shared-test result. Category navigation therefore makes no winner claim and displays the category index used for sorting. Removing weak evidence can improve a weighted average; no general missing-data monotonicity claim is made. Compare shared tests and raw values before treating a small score difference as significant. Weights, priors, and bands are product choices and can change relative results.

## Freshness and history

A normal cache window is 30 minutes; failures may serve older data. “Sources fetched” means retrieval succeeded at the snapshot time. It does not mean all cells are new or independently verified. Dataset-edition date, upstream publication date, fetch time, and snapshot time are different fields. The ingested LiveBench v1 table is a legacy edition; its filename date does not date each model evaluation. Raw summary cards require a selected LiveBench observation, show ties and the imported participant count, and describe the top imported value. Each model’s imported run maximizes global average, so a subtest card is not the maximum across every published effort run.

Cached responses recompute staleness at response time without changing the saved timestamp. Stale/error paths warn in the JSON body as well as cache headers. Failed refreshes do not overwrite last-good data. Daily snapshots skip fallback, stale, and partial results. Old scoring-version snapshots cannot create current trend values. Local-only trends are withheld because stored historical positions use the all-model population.

The only scheduler is the existing Vercel cron at 09:00 UTC. A configured schedule is not proof of successful execution. No new scheduler is introduced.

## Hardware and video

Memory budgets and model footprints are planning estimates. Total MoE weights count toward memory; active parameters are not the storage size. KV cache, context length, precise binary/decimal units, backend support, quantization availability, and measured throughput are not established by the generic formula.

Above-budget memory is not a non-offloaded fit. Offload candidates remain visible in the full catalog but do not displace accelerator-resident candidates in the default recommendation. CPU-only profiles are labeled as CPU estimates. No per-model tok/s values are displayed without measurements.

`/video` remains a separate manual fit/throughput log with measurement, vendor-claim, prediction, and unmeasured provenance. It is excluded from text scoring and the nightly refresh.

## Reproducible audit

- `npm run audit:live`: read-only public upstream capture under ignored `output/trust-audit/`; no Redis or production writes.
- `npm run audit:replay`: recompute that saved capture against the current scorer.
- Lint, Jest, build, workflow tombstones, and browser interaction checks validate implementation. They do not independently validate every upstream benchmark claim.

- `npm run audit:live -- --out output/trust-audit` writes a versioned `manifest.json` (`local-llm-radar/ranking-audit@1`), `sources.json`, `leaderboard.json` and `summary.json`. A successful legacy LiveBench fetch also saves the exact `livebench.csv` and `categories.json` used by the adapter. Missing, empty or failed required sources cause exit 1 after receipts are written. Receipts retain fallback/captured dates; replay never makes an old capture fresh.
- `npx tsx scripts/audit-ranking-claims.ts output/trust-audit` consumes that bundle offline, independently recomputes index arithmetic, matches selected cells to source records and the saved unredacted leaderboard, and reconstructs imported legacy LiveBench cells from the saved CSV/category map. It reports `livebenchChecked:false` if there are no selected legacy LiveBench cells; selected cells require the raw files. LiveBench 2.0 is checked against captured source records, not independently reconstructed from raw tasks by this script.
- Optional deployment comparison: save `curl --fail http://127.0.0.1:3000/api/leaderboard -o output/trust-audit/production.json` before running the ranking audit. The audit compares this public snapshot with licence-redacted expectations; unlicensed null scores are expected, but changed licensed values or roster drift fail. The local capture alone does not verify a deployment. Investigate drift rather than accepting unexplained differences.
- Older captures can be upgraded with `audit:replay`. For `--capture path.json.gz --out output/round2/replay`, the manifest references the original archive and its sibling raw LiveBench files; keep them together. An archive without those raw files cannot independently verify selected legacy LiveBench cells. Never commit capture bundles.
