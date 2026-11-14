# Same-test category comparisons

The public category views use `src/lib/benchmark-comparisons.ts`, comparison version
`same-test-v2`. They no longer rank a model higher because it reports more unrelated
benchmarks. The underlying experimental index formula is unchanged and is
available only as explicit analysis; it does not assign comparable-test positions
in the dashboard.

## Public defaults

| Category | Named comparison |
|---|---|
| Overall | LiveBench 2.0 Overall |
| Coding | LiveBench 2.0 Coding |
| Agentic & Tools | LiveBench 2.0 Long Agentic |
| Reasoning | LiveBench 2.0 Reasoning |
| Math | LiveBench Mathematics, legacy v1 |
| Chat & instructions | LMArena style-controlled text preference rating |

These defaults are benchmark-specific, not universal task winners. Other supported
evaluator tests are selectable; all attributed vendor reports remain inspectable.
Generic or ambiguous metrics such as Toolathlon cannot substitute for a specified
evaluator edition. No benchmark values, anchors, vendor weights, or ingestion
sources were changed to make a particular model win.

## Ranking contract

- Compare one benchmark key, evaluator source, source-described edition and dataset
  date. The newest explicit edition is the default for the whole catalog; do not
  silently fall back to an older edition for an individual model or an open-only
  hardware pool.
- Require an attributed finite evaluator observation. Missing, conflicting,
  fallback, vendor-only and differently dated observations have no position in
  that cohort. Zero remains a valid measured result.
- Preserve exact raw scores and shared competition positions for ties (1, 1, 3).
  Display the selected test score prominently; unrelated evidence and composite
  values cannot break ties or change that score.
- Reasoning effort and agent harnesses can vary within the evaluator's board.
  Show the source/edition and this limitation, and preserve run settings/evidence.
  A shared task set does not establish identical inference budgets or universal
  superiority. Arena is a preference metric, not test accuracy.
- Dashboard, category routes, Compare, Hardware recommendations, and the default
  `/api/rankings` response share the rule. Memory-fit math and the 10% multi-GPU
  split reserve are unchanged.
- `/api/rankings?category=math` returns `mode=benchmark`, comparison metadata,
  raw scores, null scores/positions for unmeasured rows, and no historical delta.
  An optional `benchmark` selects an allowed category test; `cohort` selects its
  exact JSON-encoded cohort ID. Invalid selectors return 400.
- Legacy index clients must request `mode=index`. The existing nightly scheduler
  and historical index snapshots are unchanged; those ranks are never reused as
  same-test trends.

## Verification of the original v1 default (October 2026)

263 tests pass (one pre-existing TODO), including all six defaults, the GPT-5.2 /
Opus math inversion, the Kimi / Opus agentic inversion, source and edition
separation, missing/zero/conflicting values, ties, API contracts, and primary-GPU /
full-stack hardware eligibility. Build and TypeScript pass; lint has no errors and
one existing warning in archived evidence. Browser checks cover the six buttons,
six category URLs, Compare, Hardware, optional index mode, persistent ranks during
search, and a 390px viewport. All 19 specialist APIs preserve their exact benchmark
suite, metric and score direction.
