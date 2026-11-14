/**
 * Credits and redistribution terms for every data source (docs/DATA-SOURCES.md).
 * The /sources page and the footer render this list; the public JSON APIs use
 * `withheldInApi` to decide which raw values they may serve.
 *
 * withheldInApi = true: the source has no licence that allows redistributing its
 * results (verdict b or d), so the site shows them with credit but the public
 * APIs return null values plus the source name and URL.
 */
export interface SourceCredit {
  name: string;
  url: string;
  /** What the site takes from it. */
  use: string;
  /** Licence or terms, as stated by the source. */
  licence: string;
  termsUrl: string;
  /** Extra condition shown with the credit (non-commercial, share-alike, credit wording). */
  note?: string;
  withheldInApi: boolean;
  /** Text-ranking source IDs (leaderboard-service) covered by this credit. */
  sourceIds?: string[];
  /** Specialist board `source` names (model-types) covered by this credit. */
  boardSources?: string[];
  linkOnly?: boolean;
}

export const SOURCE_CREDITS: SourceCredit[] = [
  {
    name: 'LLM Stats (ZeroEval API)', url: 'https://llm-stats.com', use: 'Text roster, model metadata, prices and published benchmark results',
    licence: 'API terms: access is not a redistribution licence', termsUrl: 'https://llm-stats.com/developer',
    note: 'Data by LLM Stats. The free plan requires this credit.', withheldInApi: true, sourceIds: ['zeroeval'],
  },
  {
    name: 'LLM Stats pages (Code Arena, release feed, model scorecards)', url: 'https://llm-stats.com', use: 'Code Arena ratings, recent releases, per-model scorecards',
    licence: 'Republishing allowed with visible credit and link', termsUrl: 'https://llm-stats.com/legal/terms-of-service',
    note: 'Data by LLM Stats.', withheldInApi: false, sourceIds: ['codearena', 'llmstats_recent'],
  },
  {
    name: 'LMArena text leaderboard', url: 'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset', use: 'Style-controlled text Elo and vote counts',
    licence: 'CC BY 4.0', termsUrl: 'https://creativecommons.org/licenses/by/4.0/', withheldInApi: false, sourceIds: ['lmarena'],
  },
  {
    name: 'LiveBench 2.0 and v1', url: 'https://livebench.ai', use: 'Suite scores, effort variants and run cost',
    licence: 'No licence stated for leaderboard results', termsUrl: 'https://github.com/LiveBench/LiveBench', withheldInApi: true, sourceIds: ['livebench2', 'livebench'],
  },
  {
    name: 'BFCL (Berkeley Function-Calling Leaderboard)', url: 'https://gorilla.cs.berkeley.edu/leaderboard.html', use: 'Overall function-calling accuracy',
    licence: 'No licence stated for leaderboard results', termsUrl: 'https://github.com/ShishirPatil/gorilla', withheldInApi: true, sourceIds: ['bfcl'],
  },
  {
    name: 'Terminal-Bench', url: 'https://www.tbench.ai', use: 'Agentic terminal task accuracy',
    licence: 'No licence stated for leaderboard results', termsUrl: 'https://github.com/laude-institute/terminal-bench', withheldInApi: true, sourceIds: ['terminalbench'],
  },
  {
    name: 'SWE-bench Verified', url: 'https://www.swebench.com', use: 'Resolved % per system',
    licence: 'CC BY-NC 4.0', termsUrl: 'https://github.com/SWE-bench/swe-bench.github.io/blob/main/LICENSE',
    note: 'Non-commercial use only. Local LLM Radar is free, with no ads and nothing sold.', withheldInApi: false, sourceIds: ['swebench'],
  },
  {
    name: 'Open LLM Leaderboard (retired)', url: 'https://huggingface.co/datasets/open-llm-leaderboard/contents', use: 'Historical inspection only; not displayed',
    licence: 'No licence stated for leaderboard results', termsUrl: 'https://huggingface.co/datasets/open-llm-leaderboard/contents', withheldInApi: true, sourceIds: ['openllm'],
  },
  {
    name: 'MTEB results', url: 'https://github.com/embeddings-benchmark/results', use: 'Embedding, retrieval and multimodal embedding boards',
    licence: 'CC0 1.0', termsUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', withheldInApi: false, boardSources: ['MTEB'],
  },
  {
    name: 'MMMU-Pro', url: 'https://mmmu-benchmark.github.io', use: 'Vision-language understanding scores',
    licence: 'No licence stated for leaderboard results', termsUrl: 'https://mmmu-benchmark.github.io', withheldInApi: true, boardSources: ['MMMU'],
  },
  {
    name: 'Agentset rerankers', url: 'https://agentset.ai/rerankers', use: 'Reranker Elo, nDCG@10, latency, price',
    licence: 'All rights reserved by Agentset or its licensors', termsUrl: 'https://agentset.ai/terms', withheldInApi: true, boardSources: ['Agentset'],
  },
  {
    name: '3D Arena', url: 'https://huggingface.co/spaces/3d-arena/3d-arena', use: 'Image-to-3D render-view Elo and votes',
    licence: 'No licence stated for leaderboard results', termsUrl: 'https://huggingface.co/spaces/3d-arena/3d-arena', withheldInApi: true, boardSources: ['3D Arena'],
  },
  {
    name: 'OmniDocBench', url: 'https://github.com/opendatalab/OmniDocBench', use: 'Document parsing results table',
    licence: 'Apache-2.0', termsUrl: 'https://github.com/opendatalab/OmniDocBench/blob/main/LICENSE', note: '© OpenDataLab.', withheldInApi: false, boardSources: ['OmniDocBench'],
  },
  {
    name: 'OCRBench v2', url: 'https://99franklin.github.io/ocrbench_v2/', use: 'OCR private-test averages (English, Chinese)',
    licence: 'No licence stated for leaderboard results', termsUrl: 'https://github.com/Yuliang-Liu/MultimodalOCR', withheldInApi: true, boardSources: ['OCRBench'],
  },
  {
    name: 'MMAU', url: 'https://sakshi113.github.io/mmau_homepage/', use: 'Audio understanding accuracy (full, mini)',
    licence: 'No licence stated for leaderboard results', termsUrl: 'https://github.com/Sakshi113/MMAU', withheldInApi: true, boardSources: ['MMAU'],
  },
  {
    name: 'Video-MME', url: 'https://video-mme.github.io', use: 'Video understanding accuracy (with and without subtitles)',
    licence: 'No licence stated for leaderboard results', termsUrl: 'https://github.com/MME-Benchmarks/Video-MME', withheldInApi: true, boardSources: ['Video-MME'],
  },
  {
    name: 'Roboflow SAB (RF-DETR README)', url: 'https://github.com/roboflow/rf-detr', use: 'COCO val2017 detection and segmentation results',
    licence: 'Apache-2.0', termsUrl: 'https://github.com/roboflow/rf-detr/blob/develop/LICENSE', note: '© Roboflow.', withheldInApi: false, boardSources: ['Roboflow SAB'],
  },
  {
    name: 'COCO leaderboard', url: 'https://cocodataset.org', use: 'Historical test-dev submissions',
    licence: 'CC BY 4.0', termsUrl: 'https://cocodataset.org/#termsofuse', note: '© COCO Consortium. Values rescaled to 0–100.', withheldInApi: false, boardSources: ['COCO'],
  },
  {
    name: 'KITTI depth prediction', url: 'https://www.cvlibs.net/datasets/kitti/', use: 'SILog and error metrics, runtime, method',
    licence: 'CC BY-NC-SA 3.0', termsUrl: 'https://creativecommons.org/licenses/by-nc-sa/3.0/',
    note: '© KITTI (Geiger, Lenz, Urtasun). Non-commercial use only; the depth table and its API are shared under the same licence.', withheldInApi: false, boardSources: ['KITTI'],
  },
  {
    name: 'Hugging Face model cards and vendor docs', url: 'https://huggingface.co', use: 'Single cited facts: parameter count, licence, release date',
    licence: 'Facts cited with a link; card text is not copied', termsUrl: 'https://huggingface.co/terms-of-service', withheldInApi: false, sourceIds: ['verified'],
  },
  {
    name: 'Local LLM Radar curated roster', url: '/methodology', use: 'Fallback roster and metadata; its score fields are null',
    licence: 'Own data', termsUrl: '/methodology', withheldInApi: false, sourceIds: ['fallback'],
  },
  {
    name: 'Artificial Analysis', url: 'https://artificialanalysis.ai', use: 'Image, video, speech and music arenas: linked from More, not imported',
    licence: 'Terms forbid copying, republishing and scraping', termsUrl: 'https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf', withheldInApi: true, linkOnly: true,
  },
];

const BY_SOURCE_ID = new Map(SOURCE_CREDITS.flatMap(credit => (credit.sourceIds ?? []).map(id => [id, credit] as const)));
const BY_BOARD_SOURCE = new Map(SOURCE_CREDITS.flatMap(credit => (credit.boardSources ?? []).map(name => [name, credit] as const)));

export function creditForSourceId(sourceId: string): SourceCredit | undefined {
  return BY_SOURCE_ID.get(sourceId);
}

export function creditForBoardSource(source: string): SourceCredit | undefined {
  return BY_BOARD_SOURCE.get(source);
}

/** Unknown sources are withheld: a new source must be reviewed before its values are served. */
export function isWithheldSourceId(sourceId: string): boolean {
  return creditForSourceId(sourceId)?.withheldInApi ?? true;
}

export function isWithheldBoardSource(source: string): boolean {
  return creditForBoardSource(source)?.withheldInApi ?? true;
}
