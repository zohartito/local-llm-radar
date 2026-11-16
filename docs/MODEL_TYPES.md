# Model discovery and source contract

## Finding a model

The homepage retains the existing dashboard, navigation, benchmark table, and
visual style. `ModelTypeButtons` adds a compact shared row for Text / LLMs,
Embeddings, Rerankers, OCR, Vision, Detection, Segmentation, Depth, Video,
Audio & speech, 3D, and More. Related boards are one smaller button row away. `model-navigation.ts`
owns these links; it does not calculate scores.

`/leaderboards` and `/text` redirect to `/`. Old task-card URLs redirect to the
relevant board. The task-card directory and chooser pages were removed at the
user's request. All 23 integrated specialist boards have URLs and JSON APIs;
external boards are available under `/leaderboards/more`.

`/embeddings` brings all seven embedding suites into one explorer. The “Multimodal / mixed input” view joins identical model/experiment IDs across suites, shows accepted
inputs from explicit MTEB model metadata, and requires every checked input.
It starts with all four input types selected. Conflicting reported capabilities
are intersected; absent metadata stays unknown. A multi-input model may accept
several file types without supporting all combinations within one request.

Choose the suite for the overall score and default ranking. Each benchmark
column can also supply its own ranking; missing or incomplete results for that
metric stay unranked. Other suite scores remain available
in separate table columns. The normal task views keep the chosen suite's population. Clicking
a benchmark or ranking card ranks that metric; search preserves its ranks.
Provider/access/architecture filters rerank the subset.
No cross-test average or universal multimodal winner is calculated.

All specialist boards use a dense benchmark matrix with model specs, the primary
score, and source component metrics in separate sortable columns. MTEB group
scores and the other embedding suites are visible together; “Individual tests”
adds the selected suite's task columns. Rerankers show Elo, nDCG@10, latency,
and price; audio understanding shows sound, music and speech accuracy; document parsing
shows text, formula, table (TEDS and TEDS-S), and reading-order results. MMMU-Pro
Vision and Standard stay separate from original MMMU validation/test. 3D Arena shows render-preference Elo, confidence intervals and votes. Artificial Analysis media arenas and ASR are external links, not integrated tables.

`specialist-columns.ts` owns column labels, units, ordering, and sorting. Missing
values stay last in either direction, including lower-is-better metrics.
`specialist-presentation.ts` calculates competition ranks for the selected quality
metric without overwriting the primary score. Spec/price sorting retains the
active quality ranks. Search preserves ranks; provider/access/model filters rerank.
The model column stays visible while scrolling. Provenance and experiment
settings remain under Details. All seven embedding source dates are available
because every embedding view now shows cross-suite columns.

DigUp uses EmbeddingGemma 2 ([project](https://github.com/ARahim3/DigUp)). Its
text, image, audio, and video inputs are verified by the [Google model card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).
`embedding-metadata.ts` corrects MTEB's 0.271B text-module size and older license
label to the documented 0.740B full model and Apache 2.0, dated 2026-10-25. The
raw benchmark-reported size remains visible; no benchmark scores are overridden.

## Shared dashboard presentation

The specialist pages follow the text dashboard's full layout: secondary type tabs,
heading with source status, gradient callout, score legend, ranking cards, compact
provider buttons/search/access toggle, and the dense table with evidence bars and
pagination. `leaderboard-presentation.tsx` shares card, filter, table, and score-color
styles with `BenchmarkTable`. The text page's calculations and visual appearance
stay intact. The specialist callout jumps to the ranking cards; it does not imply
that the text-only hardware estimator supports specialist models.

Cards use actual published metrics, never invented use cases. Scores are colored
relative to the values within each column, reversing for lower-is-better metrics.
Specialist badges denote confirmed open weights, closed weights, unknown access,
and mixed inputs. They do not reuse text index tiers as universal model grades.
Evidence bars reflect source task/metric coverage, not independent confirmation.
Provider buttons prioritize providers of leading models and expose the rest via
More providers. Names omit a redundant provider prefix only for display; source
identity, links and full-name tooltips are preserved.

## Coverage

The navigation separates model purposes from architectures and deployment settings.
Coding, math, reasoning, chat, and tool use remain task views of text models.
Open weights, mixture-of-experts, quantization, and reasoning effort are not new
modalities. A model can belong to several tasks; it does not get a universal score.

| Family | Board / source | Comparison boundary |
| --- | --- | --- |
| Text generation | Six same-test category rankings | One named evaluator test and edition per comparison |
| Text embeddings | MTEB multilingual v2 and English v2 | Separate task suites; complete mean only |
| Code embeddings | MTEB Code v1 | Code retrieval, not code generation |
| Image/text embeddings | MIEB Multilingual | Joint image/text representation |
| Visual document retrieval | ViDoRe v3 | Document page retrieval, not OCR |
| Audio embeddings | MAEB v1 | Audio/text representations |
| Video embeddings | MVEB text/video v1 | Video/text representations |
| Reranking | Agentset | Its judged RAG pipeline, not MTEB reranking subtasks |
| Vision-language understanding | Official MMMU-Pro leaderboard | Author submissions labeled; original MMMU and non-model baselines excluded |
| OCR/document parsing | OmniDocBench v1.6_full | Full-page parsing; separate from earlier editions |
| 3D generation | 3D Arena render view | Render preference, not mesh/fabrication quality |

## Data and failure handling

- `src/lib/model-types.ts` contains all fixed endpoints, source links, edition
  names, units, caveats, and rank directions. External source text is untrusted.
- `specialist-fetch.ts` permits only known HTTPS hosts, refuses redirects, caps
  decompressed responses at 12 MiB, and aborts requests after 15 seconds.
- MTEB uses its public `/v1/benchmarks/{name}/scores` API. Source task means use
  0–1 units, displayed as 0–100. An incomplete/null mean remains visible without
  an ordinal. Experiment settings are part of identity. Cross-encoders are
  excluded from embedding boards. Group means are shown only when every selected
  suite task in the group has a result and task metadata covers the full suite.
  Individual task scores remain visible even when the suite is incomplete.
  `benchmarks` stores numeric values; absent task keys mean missing, not zero.
  Sparse task storage keeps each escaped cache payload under Next's 2 MiB limit
  (covered by the fallback invariant test). Negative zero-shot sentinel values
  are omitted. Task counts and valid zero-shot coverage are shown.
- Image, video, speech and music generation arenas (Artificial Analysis) are
  linked from `/leaderboards/more`, not imported: its terms forbid copying,
  republishing or scraping (see `docs/DATA-SOURCES.md`).
- Unknown weights access stays unknown. A license or provider name does not
  establish downloadability. 3D Arena's `open_source` is displayed as its own
  label rather than silently converted into confirmed open weights.
- Competing observations under the same source ID fail the refresh. Ties get
  competition ranks. Search keeps ranks; model-type/access filters rerank.
- `specialist-service.ts` caches compact parsed snapshots for one hour with
  `unstable_cache` (this app has not enabled Cache Components). Cache entries are
  keyed by the full board configuration; bump the explicit cache version when
  parser semantics change. Incompatible cached editions are rejected. Failures are
  caught outside the cached function and serve an edition-matched entry from `data/specialist-snapshots.json` when licensed; boards without a saved fallback return unavailable.
  Successful-check time is stored with the observation, never regenerated for a
  cache hit or fallback. Publication/evaluation dates remain separate and unknown
  unless actually supplied by the source. Old cache entries are labeled in UI.
- The public JSON API is `/api/leaderboards/{type}`; unknown IDs return 404 and
  no results return 503. It returns source, status, timestamps, units and ranks.
  Vision uses the benchmark's own JSON feed because the text merge does not
  retain MMMU observations; its API and fallback follow the same contract.
- `npm run capture:specialists` selects only boards with `snapshotLicence` and replaces the fallback file only if every selected board succeeds. This is a manual maintenance tool, not a second scheduler. Specialist
  sources update when requested; the existing daily text cron is untouched.

## Further specialist domains

The More page links out to the evaluator-owned VoiceBench (voice assistants,
omni and full-duplex), GIFT-Eval (forecasting), and AllenAI VLA evaluation harness (robotics) leaderboards. These are explicitly
external; their scores are not imported into Radar. MMAU full/mini, detection, segmentation and depth are integrated with separate test scopes (see `model-type-coverage.md`). Sound generation, ASR, speech enhancement, image restoration and scientific models remain gaps. These domains
require additional evaluator adapters before Radar can claim integrated coverage.
Do not substitute a nearby modality or show invented rankings for them. General
boards above are not proxies for those capabilities. Add an edition-pinned source
and parser, a methodology note, comparable multi-vendor rows, and a dated fallback only where redistribution is permitted
before advertising another integrated board.

## Validation

For source/API reconciliation, first capture each public API response into
`<board-id>.json` in an ignored directory. For example, with the local server running:

```bash
AUDIT_SITE=http://127.0.0.1:3000 npx tsx -e '
import { mkdirSync, writeFileSync } from "node:fs";
import { SPECIALIST_BOARDS } from "./src/lib/model-types";
async function capture() {
  mkdirSync("output/live-audit", { recursive: true });
  for (const board of SPECIALIST_BOARDS) {
    const response = await fetch(`${process.env.AUDIT_SITE}/api/leaderboards/${board.id}`);
    if (!response.ok) throw new Error(`${board.id}: HTTP ${response.status}`);
    writeFileSync(`output/live-audit/${board.id}.json`, await response.text());
  }
}
void capture().catch(error => { console.error(error); process.exitCode = 1; });'
npx tsx scripts/audit-specialist-data.ts output/live-audit
npx tsx scripts/audit-specialist-data.ts output/live-audit --replay
```

The first audit fetches each registry `dataUrl` into `<board-id>.raw`; replay reads
those saved inputs without network access. Ranks are checked against raw source
values, while public fields are compared with licence-redacted expectations.
Missing inputs, source drift and field/rank differences fail the audit; preserve
the receipts and investigate before recapturing. Never commit these captures.

`__tests__/specialist-presentation.test.ts` verifies selected-metric ranking, unchanged primary scores, ties/nulls/zero, reversed error-metric colors, and source coverage.

`__tests__/specialist-columns.test.ts` verifies numeric sorting, null/zero handling, preserved ranks, metric directions, and optional task columns.

`__tests__/embedding-catalog.test.ts` verifies capability filters, exact-identity joins, score isolation, unknown inputs, experiment variants, and EmbeddingGemma 2 discovery.

`__tests__/specialist-boards.test.ts` covers rank direction/ties/nulls, partial MTEB
coverage, experiment IDs, exact benchmark editions, OCR table scope, access uncertainty, source URL validation, and
coverage/identity invariants for all saved snapshots. Run lint, Jest, production
build, workflow tombstones, then desktop/mobile interaction and API checks.


## Model release dates

Every model table and detail/compare view displays a release date. Text views use
existing canonical `release` metadata. Specialist rows ingest `releaseDate` from
MTEB model metadata. Dates are
source-reported, not independently verified release announcements. Unknown stays
explicit; never substitute a benchmark/report date, fetch time, repository creation
or a guessed date from a model name. Month/year precision is preserved and calendar
dates render in UTC. Released sorts newest/oldest with unknown dates last; it does
not become a quality metric. Video fit records support optional model `release`
metadata separately from measurement/build dates.

The specialist parser cache is `specialist-boards-v9-vision-releases`. The historical 2026-10-26 UTC capture had 1,755 dated observations out of 1,911 (models can occur in multiple
suites). Tests cover calendar validation, date precision, timezone stability,
missing-last sorting and preservation of source model dates.
