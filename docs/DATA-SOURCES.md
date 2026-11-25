# Data sources and licences

Checked 2026-11-14 against the code on `main` (LiveBench 2.0 overall, 23 specialist
boards here, 31 in the private original). This records what each source's own terms
say. It is not legal advice. Re-check a source's terms before adding it or before
committing any of its data.

## Verdicts

| Verdict | Meaning | What this repo does |
| --- | --- | --- |
| **a** | Licence allows redistribution (CC0, CC BY, Apache-2.0, or explicit permission) | May be committed as a fallback snapshot, with the attribution below |
| **b** | Display with attribution only; no licence to redistribute a bulk copy | Fetched at refresh/request time, credited, never committed |
| **c** | Non-commercial and/or share-alike licence | Fetched at request time, credited with the licence, never committed |
| **d** | Unclear: no licence found for the leaderboard results | Treated as **b** |
| **e** | Terms forbid copying, republishing or scraping | Not imported. Linked from `/leaderboards/more` |

Summary for the 22 third-party sources below: **a** 7, **b** 1, **c** 2, **d** 11, **e** 1.

"How" means: **refresh** = fetched by the text refresh (Vercel cron daily at 09:00 UTC,
or an expired 30-minute cache) and stored in Redis; **request** = specialist board
fetched on demand and held in Next's data cache for one hour; **snapshot** = committed
in `data/specialist-snapshots.json` as the offline fallback.

## Text rankings

| # | Source | What is taken | How | Terms (URL) | Deciding text | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ZeroEval API (`api.zeroeval.com/leaderboard/models/full`, LLM Stats backend) | Roster, provider, licence, parameters, context, release date, prices, 15 benchmark columns | refresh | https://llm-stats.com/developer | API access "is not a redistribution license"; free plan requires a visible "Data by LLM Stats" credit | **b** |
| 2 | LMArena text leaderboard via Hugging Face dataset `lmarena-ai/leaderboard-dataset` (`text_style_control`) | Model name, organisation, licence, style-controlled Elo, vote count | refresh | https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset (card `license: cc-by-4.0`) | CC BY 4.0. Note: arena.ai's own site terms forbid scraping it, so only the HF dataset is used | **a** (attribution) |
| 3 | llm-stats.com pages: Code Arena leaderboard, `/llm-updates` release feed, `/models/<id>` scorecards | Code Arena ratings; recent releases; per-model published benchmark rows (vendor self-reported, downweighted) | refresh | https://llm-stats.com/legal/terms-of-service | "You may view, copy, modify, share, and republish the content", with visible credit and link | **a** (attribution) |
| 4 | **LiveBench 2.0** (`livebench.ai`: home bundle, `/data/<date>/table.csv`, `categories.json`) | Edition date, 7 suite scores and published suite weights, run effort, organisation and open-weight flags from the bundle's display map | refresh | Code: https://github.com/LiveBench/LiveBench (LICENSE = FastChat Apache-2.0 + LiveCodeBench MIT, GitHub reports NOASSERTION). HF dataset cards under https://huggingface.co/livebench have no `license:` field. Site repo `LiveBench/livebench.github.io` has no licence | No licence covers the leaderboard table or categories. The code licence covers the evaluation software only | **d** |
| 5 | LiveBench v1 legacy (`livebench.ai/v1`: `table_<date>.csv`, categories, cost CSV) | Per-task scores, effort variants, suite cost | refresh | Same as #4; the v1 tables sit in the unlicensed `livebench.github.io` repo | No data licence | **d** |
| 6 | BFCL (`gorilla.cs.berkeley.edu/data_overall.csv`) | Overall function-calling accuracy | refresh | Code https://github.com/ShishirPatil/gorilla (Apache-2.0); dataset card `gorilla-llm/Berkeley-Function-Calling-Leaderboard` (apache-2.0) | Nothing on the leaderboard CSV itself | **d** (leans a) |
| 7 | Terminal-Bench 4.0 (`www.tbench.ai` page) | Agent/model accuracy rows from the server-rendered page | refresh | Code https://github.com/laude-institute/terminal-bench (Apache-2.0); `tbench.ai/terms` returns 404 | No licence for the page or results | **d** |
| 8 | SWE-bench Verified (`www.swebench.com`) | Resolved % per system | refresh | https://github.com/SWE-bench/swe-bench.github.io (serves the site, holds `data/leaderboards.json`): LICENSE is CC BY-NC 4.0 | "Attribution-NonCommercial 4.0 International" | **c** (CC BY-NC 4.0) |
| 9 | Artificial Analysis: free API (`/api/v2/data/llms/models`) and media leaderboard pages | (original only) indexes, prices; 8 media boards scraped from page data | original: refresh/request + snapshot. Here: **removed** | https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf, Data Platform Terms https://artificialanalysiscdn.com/legal/ProDataPlatformTerms.pdf | ToU s.2.2(d): no part "may be copied, reproduced, distributed, republished"; s.3 bars scraping; DPT bars structured or tabular reproduction | **e** |
| 10 | Open LLM Leaderboard (`open-llm-leaderboard/contents`, retired) | Nothing at runtime; only the manual `scripts/update-scores.mjs` reads it and writes nothing | none | Dataset card has no licence; the Space code is Apache-2.0 | No data licence | **d** |

## Specialist boards

| # | Source (boards) | What is taken | How (original → here) | Terms (URL) | Deciding text | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | MTEB backend `mteb-leaderboard-backend.hf.space` (7: text multilingual/English, code, MIEB image, ViDoRe v3, MAEB audio, MVEB video) | Task means, per-task scores, model metadata | request + snapshot → request + snapshot | https://github.com/embeddings-benchmark/results (CC0-1.0); HF `mteb/results` (cc0-1.0) | CC0 public-domain dedication | **a** |
| 12 | MMMU-Pro (`mmmu-benchmark.github.io/leaderboard_data.json`) | Overall, vision, standard scores; size; reported date | request + snapshot → request | Datasets `MMMU/MMMU`, `MMMU/MMMU_Pro` (apache-2.0); site repo has no licence | The site's CC BY-SA line credits its page template, not the scores | **d** (leans a) |
| 13 | Agentset rerankers (`agentset.ai/rerankers`) | Elo, nDCG@10, latency, price | request + snapshot → request | https://agentset.ai/terms s.7 | All content is owned by AgentSet or its licensors; no licence granted | **d** (in practice b) |
| 14 | 3D Arena (`3d-arena-3d-arena.hf.space` API) | Render-view Elo, votes, open-source flag | request + snapshot → request | HF Space metadata `license: mit` | Likely covers the Space code only | **d** (leans a) |
| 15 | OmniDocBench README (`raw.githubusercontent.com/opendatalab/OmniDocBench`) | v1.6_full results table | request + snapshot → request + snapshot | https://github.com/opendatalab/OmniDocBench (Apache-2.0) | Results table is part of the Apache-2.0 repo. The PDFs themselves are "for research purposes only" | **a** (Apache notice) |
| 16 | OCRBench v2 (`99franklin.github.io/ocrbench_v2/`, 2: English, Chinese) | Private-test averages and components | request + snapshot → request | Code https://github.com/Yuliang-Liu/MultimodalOCR (MIT); site repo has no licence | Dataset is research-only, non-commercial; results unlicensed | **d** |
| 17 | MMAU (`sakshi113.github.io/mmau_homepage/leaderboard_data_v15_parsed.json`, 2: full, mini) | Parsed-results accuracy by split | request + snapshot → request | Code https://github.com/Sakshi113/MMAU (Apache-2.0); homepage repo has no licence | No data licence | **d** |
| 18 | Video-MME (`video-mme.github.io`, 2: with/without subtitles) | Overall and short/medium/long accuracy, frames, size, date | request + snapshot → request | https://github.com/MME-Benchmarks/Video-MME README "License" | Dataset: "only used for academic research". The CC BY-SA line is in an HTML comment crediting a template | **d** (results); dataset **c** |
| 19 | Roboflow SAB in the rf-detr README (2: detection, segmentation) | COCO val2017 AP, RF100-VL, latency, parameters | request + snapshot → request + snapshot | https://github.com/roboflow/rf-detr (Apache-2.0) | README tables are inside the Apache-2.0 repo | **a** (Apache notice) |
| 20 | COCO leaderboard exports (`cocodataset.org/leaderboard/*.json`, 3 archives) | Test-dev aggregate metrics, team, date | request + snapshot → request + snapshot | https://cocodataset.org/#termsofuse | Annotations "along with this website" are licensed CC BY 4.0 | **a** (attribution) |
| 21 | KITTI depth prediction (`cvlibs.net`) | SILog and three error metrics, runtime, method | request + snapshot → request | https://www.cvlibs.net/datasets/kitti/ (copyright section) | Datasets and benchmarks are "published under the Creative Commons Attribution-NonCommercial-ShareAlike 3.0 License" | **c** (CC BY-NC-SA 3.0) |

## Hardware, model size and release data

| # | Source | What is taken | How | Terms | Verdict |
| --- | --- | --- | --- | --- | --- |
| 22 | Hugging Face model cards and vendor docs cited in code (`hardware.ts`, `VERIFIED_METADATA` in `merge-models.ts`, `embedding-metadata.ts`, `data/model-release-evidence.json`) | Single facts (parameter count, licence, release date) with a URL and a short anchor excerpt | committed as cited facts | https://huggingface.co/terms-of-service; facts are not copied prose | **a** (cite, don't copy card text) |
| own | `hardware.ts` presets and memory math | GPU/unified-memory capacities, quantisation memory formula | code | This repo (MIT) | own |
| own | `data/curated-models.json` | Fallback roster and metadata: provider, parameters, context, licence, release month, memory estimates. All score fields are null | committed | This repo (MIT). The private original still holds archived third-party scores (never displayed) | own |
| own | `data/video-fit.json`, `data/voice-fit.json` | Manual fit logs and reviewed links | committed | This repo (MIT) | own |
| own | `datasets/local-measurements/` | Ollama measurements made with `scripts/measure-local.ts` | committed | CC BY 4.0 | own |

Model parameter counts and context windows also arrive from ZeroEval (#1) at refresh
time; those values are not committed.

## Public JSON APIs

`/api/leaderboard`, `/api/models`, `/api/rankings` and `/api/leaderboards/[type]`
serve raw values only from sources whose terms allow redistribution (verdicts **a**
and **c**, with the licence attached). For the ZeroEval API (**b**) and every **d**
source, values are null and the response carries `withheld: true`, the source
name and its URL (`withheld_sources`, `dataLicence`). Ranks, composite scores and
coverage counts are derived across sources and stay. Only scores are withheld
(including LiveBench effort-variant scores), plus ZeroEval prices. Model facts
(parameter counts, context windows, release dates) and our own memory and
hardware-fit estimates stay in the responses.
Specialist `details` preserves an explicit allowlist of model facts and scope metadata (size, dimensions/context, licence labels, reported dates, language/split and frame/subtitle settings). Score, price, latency, vote and unknown detail keys remain withheld.
Site pages still show every source with credit (`/sources`, the footer, and a
credit line on each specialist board); they read the snapshot server-side
(`src/lib/site-leaderboard.ts`, ISR every 5 minutes), not through the API. The list lives in `src/lib/source-credits.ts`.

## Attribution notices for committed data

- **MTEB results** (CC0-1.0): Massive Text Embedding Benchmark contributors, https://github.com/embeddings-benchmark/results. No attribution required; given as a courtesy.
- **COCO leaderboard** (CC BY 4.0): © COCO Consortium, https://cocodataset.org. Values rescaled from fractions to 0–100.
- **Roboflow SAB / RF-DETR README** (Apache-2.0): © Roboflow, https://github.com/roboflow/rf-detr. Results extracted from README tables.
- **OmniDocBench README** (Apache-2.0): © OpenDataLab, https://github.com/opendatalab/OmniDocBench. Results extracted from README tables.

Everything fetched at runtime keeps its source name, link and edition on the page
that shows it.

## LiveBench 2.0 in detail

Three licences exist and none covers the leaderboard results:
1. The LiveBench code repo LICENSE combines FastChat's Apache-2.0 and LiveCodeBench's MIT. It covers the evaluation software.
2. `livebench/liveswebench-patches` on Hugging Face is MIT. It is not the leaderboard.
3. The LiveSWEBench repo is MIT, code only.

The question/answer/judgment datasets on Hugging Face (`livebench/coding`, `reasoning`,
`math`, `data_analysis`, `language`, `instruction_following`, `model_answer`,
`model_judgment`, `liveswebench`) have no `license:` field (re-checked through the
Hugging Face API on 2026-11-14). The site repo that serves the v1 tables has no
LICENSE, and there is no 2.0-specific repo, data card or terms page. Write-ups that
call LiveBench data "Apache 2.0" are quoting the code licence.

Verdict **d**, handled as **b**: fetched at refresh time, credited with a link to
livebench.ai, never committed. Asking the LiveBench maintainers for a data licence
would settle it.
