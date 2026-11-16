# Local LLM Radar

A Next.js dashboard that collects published LLM benchmark results from public leaderboards, keeps every number attributed to its source, and estimates which models fit your local hardware (GPU VRAM, unified memory or system RAM).
It aggregates other people's evaluations: it does not run text benchmarks or certify vendor claims. The only data it measures itself are local runtime numbers from `npm run measure:local`.

## Run locally

Node.js 20.19+ (20.x), 22.13+ (22.x), or 24+ and npm. These minimums include the locked lint tooling.

```bash
npm ci
npm run dev        # http://localhost:3000
npm test           # Jest, offline (synthetic fixtures only)
npm run lint
npm run build      # production build; works offline
```

Development serving binds to `127.0.0.1`. To explicitly expose it on a trusted network, use `npm run dev -- --hostname 0.0.0.0`; this also exposes Next's unauthenticated development diagnostics/MCP tools to reachable clients.

What you see depends on configuration:

- **Specialist boards** (embeddings, OCR, vision, audio/video understanding, detection, depth, 3D, rerankers) fetch their sources on request and cache them for an hour. Offline, the boards whose source licence allows redistribution show the committed snapshot in `data/specialist-snapshots.json`; the others show "unavailable".
- **Text rankings** need a shared cache so that many server instances don't all hit the upstream sites. Without Redis you get the fallback roster in `data/curated-models.json`: model names, sizes and licences, with no scores. To see live text rankings, create a free [Upstash Redis](https://upstash.com) database and add a `.env.local`:

```dotenv
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token
CRON_SECRET=any-long-random-string
```

Never commit real secrets (`.env*` is ignored).

## Refresh data

- **Text rankings:** `vercel.json` schedules `GET /api/refresh/cron` daily at 09:00 UTC, and any read after the 30-minute cache expires refreshes under a Redis lease. To refresh by hand: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/refresh`.
- **Specialist boards:** refreshed on demand (one-hour cache). `npm run capture:specialists` rewrites the committed fallback, but only for boards whose `snapshotLicence` allows it.
- **Inspect upstreams without touching any cache:** `npm run audit:live` saves a capture under the ignored `output/trust-audit/`, and `npm run audit:replay` re-scores it. Don't commit those captures.
- **Your own hardware numbers:** see [Measure a model on your machine](#measure-a-model-on-your-machine).

## Data sources and licences

Full table with terms URLs and quotes: [`docs/DATA-SOURCES.md`](docs/DATA-SOURCES.md). In short:

| Verdict | Sources | In this repo |
| --- | --- | --- |
| Redistributable (CC0, CC BY, Apache-2.0) | MTEB results, COCO leaderboard, Roboflow SAB (rf-detr README), OmniDocBench README, LMArena HF dataset, llm-stats.com pages, cited model-card facts | MTEB, COCO, SAB and OmniDocBench results are committed as fallback snapshots, with attribution in `docs/DATA-SOURCES.md` |
| Display with attribution, no redistribution | ZeroEval API | Fetched at refresh time only |
| Non-commercial / share-alike | SWE-bench Verified (CC BY-NC 4.0), KITTI (CC BY-NC-SA 3.0) | Fetched at runtime only |
| No licence found for the results | LiveBench 2.0 and v1, BFCL, Terminal-Bench, MMMU-Pro, Agentset, 3D Arena, OCRBench v2, MMAU, Video-MME, Open LLM Leaderboard (retired) | Fetched at runtime only |
| Terms forbid reuse or scraping | Artificial Analysis | Not imported; linked from `/leaderboards/more` |

Code is MIT ([`LICENSE`](LICENSE)). Committed third-party results keep their own licences. Your own measurements in `datasets/local-measurements/` are CC BY 4.0. Benchmark scores fetched at runtime belong to their publishers; check their terms before you republish anything a deployment shows.

## Measure a model on your machine

`scripts/measure-local.ts` measures one model served by [Ollama](https://ollama.com) and writes a JSON record with load time, prompt-processing and generation tokens/s, peak memory, quantisation, context and machine specs.
Each run creates a private, unique directory under `datasets/local-measurements/` (or `--out`) containing `measurement.json`; existing receipts and symlink targets are never overwritten.

```bash
ollama pull qwen3:8b       # any model you already have works
npm run measure:local -- --model qwen3:8b --machine my-gpu-16gb
# options: --runs 3 --ctx 4096 --prompt-tokens 1024 --gen-tokens 256 --think false
```

Run it on the machine being measured, because specs and memory are read locally. `--machine` is the only label recorded (never your hostname). On NVIDIA systems it also samples `nvidia-smi`, so peak VRAM is reported per GPU. On Windows, run it from PowerShell with Node installed. The `ps`-based runner memory is macOS/Linux only. Point at a non-default server with `--host http://127.0.0.1:11434` or `OLLAMA_HOST`. A remote host is refused unless you pass `--remote`, and then machine specs are left empty.

## How it works

`src/lib/live-sources.ts` fetches and parses the text sources → `merge-models.ts` matches model identities and scores → `leaderboard-service.ts` coordinates the cache → API routes → React UI. Specialist boards are defined in `src/lib/model-types.ts` and parsed in `specialist-parsers.ts` / `vision-parsers.ts`. Hardware memory math is in `hardware.ts`.

- [`docs/SCORING.md`](docs/SCORING.md) and `/methodology`: formula, coverage rules and limitations. Category pages rank one named test at a time; the weighted index is optional.
- [`docs/MODEL_TYPES.md`](docs/MODEL_TYPES.md) and [`docs/model-type-coverage.md`](docs/model-type-coverage.md): specialist boards and their editions.
- [`docs/PERSISTENCE.md`](docs/PERSISTENCE.md), [`docs/SECURITY.md`](docs/SECURITY.md): cache, refresh authentication and request budgets.

Routes: `/` (dashboard), `/category/[slug]`, `/models/[slug]`, `/compare`, `/hardware`, `/embeddings`, `/leaderboards/[type]`, `/releases`, `/video`, `/voice`, `/methodology`, `/admin`; JSON under `/api/leaderboard`, `/api/models`, `/api/rankings`, `/api/leaderboards/[type]`, `/api/sources`.

Memory-fit numbers are estimates: exact checkpoint size, KV cache at your context length and runtime support need a measurement, which is what `measure:local` is for.
