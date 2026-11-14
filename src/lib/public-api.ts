/**
 * Public JSON API licence filter (docs/DATA-SOURCES.md, decision 2026-11-14).
 *
 * Site pages show every source with credit. The machine-readable APIs return
 * raw values only from sources whose terms allow redistribution; for the rest
 * (ZeroEval API and the sources with no licence for their results) a value is
 * null and the response names the source and links to it. Only benchmark
 * scores (including effort-variant scores) and ZeroEval prices are withheld.
 * Model facts (parameters, context, release date), our own memory estimates,
 * ranks, composite scores and coverage counts stay.
 */
import type { MergedModel } from './merge-models';
import type { SpecialistBoard, SpecialistRow } from './model-types';
import { SOURCE_CREDITS, creditForBoardSource, creditForSourceId, isWithheldBoardSource, isWithheldSourceId } from './source-credits';

export const WITHHELD_REASON = 'Withheld from the public API: no licence to redistribute this source\'s results. Shown with credit on the site.';

export interface WithheldSource { id: string; name: string; url: string; terms: string }

function withheldSource(sourceId: string): WithheldSource {
  const credit = creditForSourceId(sourceId);
  return { id: sourceId, name: credit?.name ?? sourceId, url: credit?.url ?? '', terms: credit?.termsUrl ?? '' };
}

type PublicModel = MergedModel & { score?: number | null };

/**
 * Redact one model row for the public API. `scoreSourceId` names the source of
 * a row-level `score` (benchmark-mode rankings); index scores are derived and kept.
 */
export function redactModelForPublicApi<T extends PublicModel>(model: T, scoreSourceId?: string | null): T & { withheld_sources: WithheldSource[] } {
  const withheld = new Set<string>();
  const benchmarks: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(model.benchmarks ?? {})) {
    const selected = model.benchmark_sources?.[key]?.find(row => row.selected);
    const hide = value !== null && (!selected || isWithheldSourceId(selected.source_id));
    if (hide) withheld.add(selected?.source_id ?? 'unknown');
    benchmarks[key] = hide ? null : value;
  }
  const benchmarkSources = Object.fromEntries(Object.entries(model.benchmark_sources ?? {}).map(([key, rows]) => [key, rows.map(row => {
    if (!isWithheldSourceId(row.source_id)) return row;
    withheld.add(row.source_id);
    return { ...row, value: null, source_url: withheldSource(row.source_id).url, withheld: true };
  })]));

  // Prices come only from the ZeroEval API; effort variants only from LiveBench v1.
  // Variant scores are withheld; the variant name, effort label and run cost stay.
  const hasPrice = model.input_price_per_m != null || model.output_price_per_m != null;
  if (hasPrice) withheld.add('zeroeval');
  if (model.effort_variants?.length) withheld.add('livebench');
  const effortVariants = (model.effort_variants ?? []).map(variant => ({
    ...variant, livebench_global: null, livebench_coding: null, livebench_reasoning: null,
  }));

  let score = model.score;
  if (scoreSourceId && isWithheldSourceId(scoreSourceId) && score != null) {
    withheld.add(scoreSourceId);
    score = null;
  }

  return {
    ...model,
    ...('score' in model ? { score } : {}),
    benchmarks,
    benchmark_sources: benchmarkSources,
    input_price_per_m: null,
    output_price_per_m: null,
    effort_variants: effortVariants,
    withheld_sources: [...withheld].sort().map(withheldSource),
  };
}

/** Specialist boards without a redistribution licence keep ranks and identities, never values. */
export function redactSpecialistRowsForPublicApi<T extends SpecialistRow>(board: SpecialistBoard, rows: T[]): T[] {
  if (!isWithheldBoardSource(board.source)) return rows;
  return rows.map(row => ({
    ...row,
    score: null,
    benchmarks: row.benchmarks ? Object.fromEntries(Object.keys(row.benchmarks).map(key => [key, null])) : undefined,
    details: {},
    interval: undefined,
  }));
}

export function specialistApiTerms(board: SpecialistBoard) {
  const credit = creditForBoardSource(board.source);
  return {
    source: board.source,
    sourceUrl: board.sourceUrl,
    licence: credit?.licence ?? 'Unreviewed source',
    termsUrl: credit?.termsUrl ?? board.sourceUrl,
    note: credit?.note ?? null,
    valuesWithheld: isWithheldBoardSource(board.source),
    reason: isWithheldBoardSource(board.source) ? WITHHELD_REASON : null,
    credits: '/sources',
  };
}

/** Top-level notice attached to every redacted text API response. */
export function publicApiNotice() {
  return {
    note: WITHHELD_REASON,
    credits: '/sources',
    withheldSources: SOURCE_CREDITS.filter(credit => credit.withheldInApi && credit.sourceIds?.length)
      .flatMap(credit => credit.sourceIds!.map(id => ({ id, name: credit.name, url: credit.url, terms: credit.termsUrl }))),
    attribution: 'Data by LLM Stats (https://llm-stats.com). SWE-bench Verified results are CC BY-NC 4.0 (non-commercial).',
  };
}
