# Model-type coverage

Updated 2026-10-27. Keep the original dashboard design and compact model-type
buttons. A family is navigation, not a composite score across its tasks.

## OCR, audio and video additions

| Family | Board | Comparison boundary |
| --- | --- | --- |
| OCR | `/leaderboards/document-parsing` | Existing OmniDocBench v1.6_full: overall, text edit distance, formula CDM, table TEDS/TEDS-S and reading-order error |
| OCR | `/leaderboards/ocr`, `/leaderboards/ocr-chinese` | OCRBench v2 private test, September 2026 period, English and Chinese separately |
| Audio & speech | `/leaderboards/audio-understanding`, `/leaderboards/audio-understanding-mini` | MMAU-v05.15.25 evaluator-parsed results, full and mini separately; sound, music and speech components |
| Video | `/leaderboards/video-understanding`, `/leaderboards/video-understanding-subtitles` | Original Video-MME, without/with subtitles separately; short, medium and long-video accuracy |

The existing `/voice` hardware/runtime catalog is also reachable from Audio &
speech. It is not a measured quality leaderboard.

All six new boards reuse the existing dense table, ranking cards, filters,
pagination, release-date column and evidence controls. Missing release dates
stay unknown. Video-MME's Date column is a reported result date, not release.
Only source-confirmed downloadable weights get the open-weights designation;
an upstream open-source/open-access label alone is insufficient.

## Source and ingestion contracts

- [OCRBench](https://99franklin.github.io/ocrbench_v2/): pin the private-data
  section, `leaderboard-2026-09` period, language caption and ordered headers.
  Do not include the older periods still present in the HTML.
- [MMAU](https://sakshi113.github.io/mmau_homepage/#leaderboard-v15-parsed): use
  `leaderboard_data_v15_parsed.json` only. The separate community JSON is
  explicitly unverified by its authors. Preserve same-name size variants
  (e.g. Gemma 3n 2B/4B), exclude humans/random baselines, and select just one
  split. Version identity comes from the versioned endpoint and source page;
  the JSON itself does not carry a version field.
- [Video-MME](https://video-mme.github.io/home_page.html#leaderboard): select the
  original results table and exact subtitle columns. Identity retains name,
  size, frame budget and reported date. This is not a uniform-compute test;
  frame/audio settings differ, and the source does not cover all recent models.
- [OmniDocBench](https://github.com/opendatalab/OmniDocBench): existing pinned
  v1.6_full parser remains unchanged, apart from whitespace normalization.

Numeric parsing rejects malformed/out-of-range values. Missing components
cannot receive an average rank; no other language/split/subtitle condition
fills a gap. Exact identities with conflicting results reject the snapshot.
All source metrics remain visible, and sorting one ranks only that metric.

Only the six new fallback snapshots were added in this change, after all six
live fetches succeeded. Existing fallback snapshot objects were preserved
unchanged. The normal full manual capture remains all-or-nothing. No scheduler
was added; parsed results use the existing one-hour Next Data Cache with the
`specialist-boards-v8-ocr-audio-video` key and the full board scope in its key.

## Other important model types (before vision integration)

The earlier OCR change linked `/leaderboards/more` to official COCO object detection, COCO panoptic
segmentation, and KITTI depth-prediction boards. These links have since been
replaced by the integrated tables documented below. Existing forecasting (GIFT-Eval),
robotics/action (AllenAI VLA), and voice evaluation (VoiceBench) links remain.
The same-task, training-data and dataset boundaries on those sites still apply.

Image restoration/upscaling, sound generation, speech enhancement, and
scientific models remain unintegrated. This coverage list is not a claim that
every model family has one valid universal leaderboard.

## Verification

`specialist-task-scopes.test.ts` covers period/language separation, zero and
missing values, full/mini and subtitle isolation, metadata identity, header
drift, duplicate conflicts and family navigation. The existing tests require
an edition-matched, bounded fallback for every registered board. Live source
captures and independent per-cell replay are saved under ignored
`output/board-sources/`; browser evidence is under `output/playwright/`.

The October 27 acceptance run reconciled 209 result rows and 1,009 numeric
cells against the raw source HTML/JSON using a separate Python HTML parser,
including competition ranks and unknown release dates. All 19 existing
snapshot objects were unchanged. The suite passed 279 tests (one existing
TODO); production build and TypeScript passed. Lint had no errors and one
pre-existing warning in the October 22 audit artifact. Desktop navigation,
OCR component sorting, and all six new tables at 390px width passed; horizontal
scrolling is contained inside the benchmark table.

## Detection, segmentation, depth and release evidence (October 27)

23 integrated specialist boards (31 before the Artificial Analysis media boards became external links). Detection and Segmentation now open measured
Roboflow SAB comparisons on COCO's full 5,000-image val2017 split. All rows in
these views use that evaluator; paper-only dagger rows are excluded. The source
also develops RF-DETR, so vendor-run attribution is visible. RF100-VL columns
are a separate test. T4 TensorRT FP16 batch-1 latency and differing resolutions
are visible; these are not local hardware measurements.

- `/leaderboards/object-detection`: 29 measured models, box AP50:95, AP50,
  RF100-VL metrics, latency, parameters and resolution.
- `/leaderboards/image-segmentation`: 21 measured models, mask AP50:95 and
  AP50, latency, parameters and resolution.
- `/leaderboards/detection-coco`, `/leaderboards/segmentation-coco`, and
  `/leaderboards/panoptic-segmentation`: 229 / 79 / 29 official historical
  test-dev submissions. Source exports end in 2020. These are explicitly
  archives, not current downloadable-model recommendations. Their submission
  dates are shown separately; model release is N/A.
- `/leaderboards/depth-estimation`: 58 official KITTI depth-prediction test
  entries with SILog, squared/absolute relative error and inverse RMSE. All
  four rank lower-first. Depth completion and Eigen-split results are excluded.
  Additional-data flags, runtime and hardware stay visible. This is a driving
  scene benchmark, not evidence of architectural measurement accuracy.

The six new fallback snapshots were appended without changing the existing 25.
`vision-parsers.ts` pins scopes/headers and rejects drift. Its parsers use the
existing hourly on-demand cache (`specialist-boards-v9-vision-releases`). No
text scoring or scheduler changed.

`/releases` inventories model-date coverage with source links. Counts are board
entries, not unique models; a model can appear in multiple tests. Specialist
inventory uses dated saved snapshots; the text inventory uses the same cached
roster as the dashboard. Date-source coverage is separate from benchmark-source
freshness. Primary-reviewed, source-reported, unknown and historical submission
statuses are distinct. Known dates sort newest first, unknown last.

`data/model-release-evidence.json` holds reviewed exact-name/board mappings,
primary URLs, availability-event notes, check dates and bounded source excerpts.
14 release records cover 53 specialist entries: 48 newly filled dates and five
existing EmbeddingGemma 2 dates now linked to Google's dated launch announcement. Family launch dates are labeled
as such; later variants do not inherit them by fuzzy matching. Enrichment occurs
after cache reads for both live and saved specialist data, without changing
scores or source timestamps. Existing text primary-source corrections expose
their links through the shared ReleaseDate component.

Run `npm run audit:releases` (optional `-- --out output/my-release-audit`). It
re-fetches each reviewed public source with bounded time/size, checks the exact
dated availability excerpt, reads the public text roster, and emits report.json
plus inventory.json. Missing entries include research links and source URLs.
The report records source hashes and failures. Exit 1 means a source or claim
needs review or text inventory was unavailable. A successful check only confirms
that the reviewed evidence is still present; it is not a new release date.
The tool never publishes guesses or writes the registry, production cache or
cron. Add newly researched dates to the reviewed registry, rerun the audit and
release tests, then deploy. Do not substitute repository creation, paper,
benchmark or check dates.

Vision acceptance: 445 rows / 4,347 score cells independently reconciled to
raw official feeds using a separate Python JSON/HTML reader; all previous 25
fallback snapshot objects unchanged. All 14 reviewed release-source checks
passed. 288 tests passed (one pre-existing TODO), TypeScript/build/tombstones
passed. Desktop/mobile browser acceptance checks cover sorting and sources.
