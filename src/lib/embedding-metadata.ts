/** Dated, primary-source metadata corrections; never benchmark score overrides. */
export const VERIFIED_EMBEDDING_METADATA: Record<string, {
  totalParamsB?: number; license?: string; releaseDate?: string | null;
  source: string; checkedAt: string; note?: string;
}> = {
  // MTEB currently reports the text module (~0.271B) as total parameters and
  // the older Gemma license. Google documents 0.740B total and Apache 2.0.
  'google/embeddinggemma-2': {
    totalParamsB: 0.74, license: 'Apache-2.0', releaseDate: '2026-10-06', checkedAt: '2026-10-25',
    source: 'https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2',
    note: "Google's model card publishes different values for some suites. Scores here retain the selected MTEB feed's results; other suites are not interchangeable.",
  },
  // The upstream implementation explicitly labels 2019-11-01 as the paper's
  // date, not these checkpoints' release dates. Do not invent a replacement.
  ...Object.fromEntries([
    'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
    'sentence-transformers/paraphrase-multilingual-mpnet-base-v2',
    'sentence-transformers/LaBSE',
  ].map(id => [id, {
    releaseDate: null, checkedAt: '2026-10-25',
    source: 'https://github.com/embeddings-benchmark/mteb/blob/main/mteb/models/model_implementations/sentence_transformers_models.py',
    note: 'MTEB labels its 2019-11-01 date as a paper date. The release date of this exact checkpoint is unverified.',
  }])),
};
