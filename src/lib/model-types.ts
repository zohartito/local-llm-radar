/** Task-specific leaderboards. Scores never cross benchmark or modality boundaries. */
export interface SpecialistBoard {
  id: string;
  name: string;
  group: 'Search & retrieval' | 'Vision & documents' | 'Image & video' | 'Audio & speech' | 'Spatial';
  description: string;
  source: string;
  sourceUrl: string;
  dataUrl: string;
  parser: 'mteb' | 'rerankers' | '3d' | 'omnidoc' | 'mmmu' | 'ocrbench' | 'mmau' | 'videomme' | 'coco' | 'sab' | 'kitti';
  benchmark: string;
  metric: string;
  direction: 'asc' | 'desc';
  unit: string;
  caveat: string;
  scopeNote?: string;
  metrics?: Record<string, { unit: string; direction: 'asc' | 'desc'; digits?: number }>;
  scope?: { edition?: string; language?: 'English' | 'Chinese'; split?: 'Test' | 'Test-mini'; subtitles?: boolean };
  /**
   * SPDX id of the licence that lets this board's published RESULTS be committed
   * as a fallback snapshot (see docs/DATA-SOURCES.md). Boards without one are
   * fetched at request time only; `capture:specialists` never saves them.
   */
  snapshotLicence?: 'CC0-1.0' | 'CC-BY-4.0' | 'Apache-2.0';
}

function mteb(id: string, name: string, benchmark: string, description: string, group: SpecialistBoard['group'] = 'Search & retrieval'): SpecialistBoard {
  return {
    id, name, group, description, benchmark, parser: 'mteb', source: 'MTEB', snapshotLicence: 'CC0-1.0',
    sourceUrl: `https://leaderboard.mteb.org/benchmark/${encodeURIComponent(benchmark)}`,
    dataUrl: `https://mteb-leaderboard-backend.hf.space/v1/benchmarks/${encodeURIComponent(benchmark)}/scores`,
    metric: id === 'image-embeddings' ? 'Mean (Task Type)' : 'Mean (Task)', direction: 'desc', unit: '/ 100',
    caveat: (id === 'image-embeddings' ? 'Published MIEB mean across task types, not a flat average of individual tasks. ' : 'Published MTEB task mean for this exact suite. ') + 'Incomplete evaluations have no rank. Results can include training overlap; zero-shot coverage and experiment settings are shown where reported. Dense, sparse, hybrid, and late-interaction models are identified separately; cross-encoders belong on the reranker board.',
  };
}

export const SPECIALIST_BOARDS: SpecialistBoard[] = [
  mteb('embeddings', 'Text embeddings', 'MTEB(Multilingual, v2)', 'Find models for semantic search, RAG, clustering, and similarity across languages.'),
  mteb('embeddings-english', 'English embeddings', 'MTEB(eng, v2)', 'Compare embedding models on the same English evaluation suite.'),
  mteb('code-embeddings', 'Code embeddings', 'MTEB(Code, v1)', 'Retrieve code by meaning, match code to text, and search repositories.'),
  mteb('image-embeddings', 'Image & text embeddings', 'MIEB(Multilingual)', 'Compare joint image-text representations for multimodal search.'),
  mteb('document-retrieval', 'Visual document retrieval', 'ViDoRe(v3)', 'Retrieve document pages that mix text, charts, tables, and images.', 'Vision & documents'),
  {
    id: 'vision', name: 'Vision-language models', group: 'Vision & documents', description: 'Understand images and answer visual questions using MMMU-Pro evaluations.',
    source: 'MMMU', sourceUrl: 'https://mmmu-benchmark.github.io/#leaderboard', dataUrl: 'https://mmmu-benchmark.github.io/leaderboard_data.json',
    parser: 'mmmu', benchmark: 'MMMU-Pro', metric: 'Overall accuracy', direction: 'desc', unit: '%',
    caveat: 'MMMU-Pro results from the benchmark-maintained leaderboard. Author-submitted results are identified per row. Original MMMU validation/test scores, human experts, and random baselines are excluded. Tool and reasoning settings remain in model names; reported dates vary.',
  },
  mteb('audio-embeddings', 'Audio embeddings', 'MAEB(v1)', 'Compare audio-text representations, separately from speech generation.', 'Audio & speech'),
  mteb('video-embeddings', 'Video embeddings', 'MVEB(text, video, v1)', 'Search video using text and compare video-text representations.', 'Image & video'),
  {
    id: 'rerankers', name: 'Rerankers', group: 'Search & retrieval',
    description: 'Reorder retrieved documents after the first embedding search.',
    source: 'Agentset', sourceUrl: 'https://agentset.ai/rerankers', dataUrl: 'https://agentset.ai/rerankers',
    parser: 'rerankers', benchmark: 'Agentset reranker evaluation', metric: 'Elo', direction: 'desc', unit: '',
    caveat: 'Agentset compares ranked lists with a GPT-5 judge on FiQA, SciFact, and PG. Elo and labeled nDCG@10 measure different things. This is a single evaluator’s RAG pipeline, not MTEB’s embedding reranking subtask. Latency is specific to its test setup.',
  },
  {
    id: '3d-generation', name: '3D generation', group: 'Spatial', description: 'Compare image-to-3D outputs using rendered-view preference votes.',
    source: '3D Arena', sourceUrl: 'https://huggingface.co/spaces/3d-arena/3d-arena', dataUrl: 'https://3d-arena-3d-arena.hf.space/api/leaderboard?vote_type=render',
    parser: '3d', benchmark: '3D Arena · render', metric: 'Elo', direction: 'desc', unit: '',
    caveat: 'Render-view community preferences do not establish mesh topology, watertightness, dimensional accuracy, or fabrication readiness. The source’s open-source flag is retained as a source label, not treated as a verified weights download.',
  },
  {
    id: 'document-parsing', name: 'OCR & document parsing', group: 'Vision & documents', description: 'Extract text, formulas, tables, and reading order from document pages.',
    source: 'OmniDocBench', sourceUrl: 'https://github.com/opendatalab/OmniDocBench', dataUrl: 'https://raw.githubusercontent.com/opendatalab/OmniDocBench/main/README.md',
    parser: 'omnidoc', snapshotLicence: 'Apache-2.0', benchmark: 'OmniDocBench v1.6_full', metric: 'Overall', direction: 'desc', unit: '/ 100',
    caveat: 'The evaluator’s overall score averages text edit accuracy, formula CDM, and table TEDS. General vision-language models, specialized OCR models, and document pipelines are labeled by type. Do not mix this edition with v1.5 or block-level OCR results.',
    scopeNote: 'Full-page extraction · OmniDocBench v1.6_full. Text and reading-order errors: lower is better. Formula and table scores: higher is better.',
  },
  ...(['English', 'Chinese'] as const).map((language): SpecialistBoard => ({
    id: language === 'English' ? 'ocr' : 'ocr-chinese', name: `OCR understanding · ${language}`, group: 'Vision & documents',
    description: 'Read text in images and answer questions about it, including extraction, parsing, and reasoning.',
    source: 'OCRBench', sourceUrl: 'https://99franklin.github.io/ocrbench_v2/', dataUrl: 'https://99franklin.github.io/ocrbench_v2/',
    parser: 'ocrbench', scope: { edition: '2026.09', language }, benchmark: `OCRBench v2 · private · ${language} · 2026.09`,
    metric: 'Average', direction: 'desc', unit: '/ 100',
    scopeNote: `${language} private test · September 2026 leaderboard. This measures reading and understanding text in images, separately from full-page PDF extraction.`,
    caveat: 'Only the named language and leaderboard period are ranked. Component scores remain separate; older periods and other languages cannot fill missing results. Open-source labels and evaluation periods are not proof of downloadable weights or model release dates.',
  })),
  ...(['Test', 'Test-mini'] as const).map((split): SpecialistBoard => ({
    id: split === 'Test' ? 'audio-understanding' : 'audio-understanding-mini', name: `Audio understanding · ${split === 'Test' ? 'full test' : 'mini test'}`, group: 'Audio & speech',
    description: 'Understand speech, environmental sounds, and music, beyond transcribing the words.',
    source: 'MMAU', sourceUrl: 'https://sakshi113.github.io/mmau_homepage/#leaderboard-v15-parsed', dataUrl: 'https://sakshi113.github.io/mmau_homepage/leaderboard_data_v15_parsed.json',
    parser: 'mmau', scope: { edition: 'v05.15.25', split }, benchmark: `MMAU-v05.15.25 · evaluator-parsed · ${split}`,
    metric: 'Average accuracy', direction: 'desc', unit: '%',
    scopeNote: `MMAU-v05.15.25 · ${split} split · evaluator-parsed results. Full and mini tests are ranked separately; this is audio understanding, not transcription or voice latency.`,
    caveat: 'Uses only the MMAU team’s parsed-results feed, not its separate unverified community table or old benchmark. Missing split results remain unranked. The source’s access labels do not verify weights or licenses. No model release date is inferred from the benchmark version or linked paper.',
  })),
  ...([false, true] as const).map((subtitles): SpecialistBoard => ({
    id: subtitles ? 'video-understanding-subtitles' : 'video-understanding', name: `Video understanding · ${subtitles ? 'with' : 'without'} subtitles`, group: 'Image & video',
    description: 'Answer questions about short clips and longer videos, with separate duration scores.',
    source: 'Video-MME', sourceUrl: 'https://video-mme.github.io/home_page.html#leaderboard', dataUrl: 'https://video-mme.github.io/home_page.html',
    parser: 'videomme', scope: { edition: 'original', subtitles }, benchmark: `Video-MME · original · ${subtitles ? 'with' : 'without'} subtitles`,
    metric: 'Overall accuracy', direction: 'desc', unit: '%',
    scopeNote: `Original Video-MME · ${subtitles ? 'with' : 'without'} subtitles. Frame budgets and evaluation dates vary and are shown; this source does not cover every recent model.`,
    caveat: 'Original 900-video / 2,700-question evaluation, not Video-MME v2. Only the selected subtitle condition is ranked. Frame sampling and additional audio differ by model; consult source footnotes. Reported dates are evaluation/result metadata, not verified model releases. Short, medium, and long results are kept separate.',
  })),
  ...(['Detection', 'Segmentation'] as const).map((task): SpecialistBoard => ({
    id: task === 'Detection' ? 'object-detection' : 'image-segmentation', name: task === 'Detection' ? 'Object detection' : 'Instance segmentation', group: 'Vision & documents',
    description: task === 'Detection' ? 'Locate objects with bounding boxes. Compare accuracy, model size, and inference speed.' : 'Outline individual objects pixel by pixel. Compare mask accuracy and inference speed.',
    source: 'Roboflow SAB', sourceUrl: 'https://github.com/roboflow/rf-detr#benchmarks', dataUrl: 'https://raw.githubusercontent.com/roboflow/rf-detr/develop/README.md',
    parser: 'sab', snapshotLicence: 'Apache-2.0', scope: { edition: 'SAB-val2017' }, benchmark: `Roboflow SAB · COCO val2017 · ${task}`, metric: task === 'Detection' ? 'Box AP50:95' : 'Mask AP50:95', direction: 'desc', unit: '/ 100',
    scopeNote: 'COCO val2017 · 5,000 images · measured by Roboflow in SAB. Vendor-run evaluation, including its own models. T4 / TensorRT FP16 / batch 1 timings; resolutions vary.',
    caveat: 'Paper-only dagger rows are excluded. COCO and RF100-VL are separate tests, never averaged; RF100-VL is shown where reported. Latency is specific to the source hardware, not your device. This is a selection of real-time models, not all detectors or segmenters.',
  })),
  ...([
    ['detection-coco', 'Object detection · COCO archive', 'bbox-dev2015', 'bbox_dev2015.json'],
    ['segmentation-coco', 'Instance segmentation · COCO archive', 'segm-dev2015', 'segm_dev2015.json'],
    ['panoptic-segmentation', 'Panoptic segmentation · COCO archive', 'panoptic-dev', 'panoptic_dev.json'],
  ]).map(([id, name, edition, file]): SpecialistBoard => ({
    id, name, group: 'Vision & documents', description: 'Explore the official historical COCO test-dev submissions with all aggregate precision, recall or panoptic-quality scores.',
    source: 'COCO', sourceUrl: `https://cocodataset.org/#${id === 'panoptic-segmentation' ? 'panoptic' : 'detection'}-leaderboard`, dataUrl: `https://cocodataset.org/leaderboard/${file}`,
    parser: 'coco', snapshotLicence: 'CC-BY-4.0', scope: { edition }, benchmark: `COCO · ${edition} · official archive`, metric: id === 'panoptic-segmentation' ? 'PQ' : 'AP50:95', direction: 'desc', unit: '/ 100',
    scopeNote: 'Historical archive · source submissions end in 2020. These are team/method entries, not a current model ranking. Submission dates are separate from model release dates.',
    caveat: 'Official test-dev export only; challenge and standard test sets are not mixed. Training data, ensembles and settings vary by submission. All published aggregate metrics are scaled from fractions to 0–100. Per-category results remain available at the source. A team submission is not a verified downloadable model.',
  })),
  {
    id: 'depth-estimation', name: 'Depth estimation', group: 'Vision & documents', description: 'Estimate distance from a single image. Compare errors on KITTI driving scenes.',
    source: 'KITTI', sourceUrl: 'https://www.cvlibs.net/datasets/kitti/eval_depth.php?benchmark=depth_prediction', dataUrl: 'https://www.cvlibs.net/datasets/kitti/eval_depth.php?benchmark=depth_prediction',
    parser: 'kitti', benchmark: 'KITTI · depth prediction · official test', metric: 'SILog', direction: 'asc', unit: 'log(m) × 100',
    metrics: { sqErrorRel: { unit: '%', direction: 'asc' }, absErrorRel: { unit: '%', direction: 'asc' }, iRMSE: { unit: '1/km', direction: 'asc' } },
    scopeNote: 'KITTI single-image depth prediction · official held-out test. All four error metrics: lower is better. This does not measure indoor or architectural surveying accuracy.',
    caveat: 'Depth completion and Eigen-split results are excluded. Extra training data, runtime hardware, and settings vary and remain visible. Source recovery on September 7, 2026 restored its August 7 backup; affected submissions require resubmission. Research/publication dates are not release dates.',
  },
];

export function getSpecialistBoard(id: string): SpecialistBoard | undefined {
  return SPECIALIST_BOARDS.find(board => board.id === id);
}

export interface SpecialistRow {
  id: string;
  name: string;
  provider: string;
  url: string | null;
  score: number | null;
  openWeights: boolean | null;
  /** Source-reported model release; distinct from benchmark/report/check dates. */
  releaseDate?: string | null;
  releaseEvidence?: import('./model-release').ReleaseEvidence;
  identityKind?: 'model' | 'submission';
  /** Source-reported accepted inputs, never inferred from the test suite. */
  inputModalities?: InputModality[];
  /** Separate source metrics; never averaged into a cross-test score. */
  benchmarks?: Record<string, number | null>;
  details: Record<string, string | number>;
  interval?: [number, number];
}

export type InputModality = 'text' | 'image' | 'audio' | 'video';
export const INPUT_LABELS: Record<InputModality, string> = { text: 'Text', image: 'Images', audio: 'Audio', video: 'Video' };

/** Let people type "EmbeddingGemma 2" without knowing repository punctuation. */
export function matchesSpecialistSearch(row: SpecialistRow, query: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const name = normalize(`${row.name} ${row.provider}`);
  return query.trim().split(/\s+/).every(term => name.includes(normalize(term)));
}

export interface SpecialistSnapshot {
  boardId: string;
  benchmark: string;
  checkedAt: string;
  sourceUpdatedAt: string | null;
  rows: SpecialistRow[];
}

/** Competition ranks preserve ties. Missing scores never become zeroes. */
export function rankSpecialistRows(rows: SpecialistRow[], direction: SpecialistBoard['direction']) {
  const sorted = [...rows].sort((a, b) => {
    if (a.score === null) return b.score === null ? a.id.localeCompare(b.id) : 1;
    if (b.score === null) return -1;
    const delta = direction === 'asc' ? a.score - b.score : b.score - a.score;
    return delta || a.id.localeCompare(b.id);
  });
  let rank: number | null = null;
  return sorted.map((row, index) => {
    if (row.score === null) return { ...row, rank: null };
    if (index === 0 || row.score !== sorted[index - 1].score) rank = index + 1;
    return { ...row, rank };
  });
}
