// LiveBench 2.0 publishes its suites and their overall weights with each edition.
// Do not reuse v1 benchmark keys, effort variants, or composite-score anchors.
export const LIVEBENCH2_SUITES = {
  long_agentic: 'Long Agentic', reasoning: 'Reasoning', coding: 'Coding',
  browser: 'Browser', data_analysis: 'Data Analysis', research: 'Research', design: 'Design',
} as const;
export const LIVEBENCH2_METRICS = { overall: 'Overall', ...LIVEBENCH2_SUITES };

export function liveBench2Edition(bundle: string): string {
  // The v2 release selector lists compact dates; the v1 selector uses dashed dates.
  const lists = [...new Set(bundle.match(/\[(?:"20\d{6}"\s*,\s*)*"20\d{6}"\]/g) ?? [])];
  if (lists.length !== 1) throw new Error('Cannot identify LiveBench 2.0 editions');
  const dates = JSON.parse(lists[0]) as string[];
  const newest = dates.at(-1)!;
  const iso = newest.replace(/^(....)(..)(..)$/, '$1-$2-$3');
  if (new Date(iso).toISOString().slice(0, 10) !== iso || newest !== [...dates].sort().at(-1)) {
    throw new Error('Invalid LiveBench 2.0 edition');
  }
  return newest;
}

// Read only literal fields for this exact row from the publisher’s display map.
// Never evaluate bundle code; missing metadata is not evidence of a default effort.
export function liveBench2Run(bundle: string, model: string) {
  const marker = JSON.stringify(model) + ':{displayName:';
  const index = bundle.indexOf(marker);
  if (index < 0 || bundle.indexOf(marker, index + marker.length) !== -1) return {};
  const record = bundle.slice(index + marker.length).split('}', 1)[0];
  return {
    run_effort: /(?:^|,)effort:"([\w -]{1,40})"/.exec(record)?.[1],
    provider: /(?:^|,)organization:"([^"\\]{1,80})"/.exec(record)?.[1],
    // Only a published HF weights reference AND an explicit open flag establish access.
    is_open: /(?:^|,)openweight:!0(?:,|$)/.test(record) && /(?:^|,)huggingface:"https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+"/.test(record) ? true : undefined,
  };
}

export function parseLiveBench2(csv: string, categories: unknown) {
  const keys = Object.keys(LIVEBENCH2_SUITES) as (keyof typeof LIVEBENCH2_SUITES)[];
  const suites = Object.values(LIVEBENCH2_SUITES);
  if (!categories || typeof categories !== 'object' || Array.isArray(categories)) throw new Error('Missing LiveBench 2.0 suites');
  const config = categories as Record<string, unknown>;
  if (Object.keys(config).some(k => k !== '_overall_weights' && !suites.some(s => s === k))) throw new Error('Unknown LiveBench 2.0 suite');
  for (const key of keys) {
    const cols = config[LIVEBENCH2_SUITES[key]];
    if (!Array.isArray(cols) || cols.length !== 1 || cols[0] !== key) throw new Error('Changed LiveBench 2.0 suite');
  }
  const weights = config._overall_weights === undefined ? {} : config._overall_weights;
  if (!weights || typeof weights !== 'object' || Array.isArray(weights) ||
    Object.entries(weights).some(([k, n]) => !suites.some(s => s === k) || typeof n !== 'number' || !Number.isFinite(n) || n <= 0)) throw new Error('Invalid LiveBench 2.0 weights');
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const cols = header.split(',');
  if (cols[0] !== 'model' || cols.length !== keys.length + 1 || !keys.every(k => cols.includes(k)) || !lines.length) throw new Error('Invalid LiveBench 2.0 table');
  const seen = new Set<string>();
  return lines.map(line => {
    const fields = line.split(',').map(s => s.trim()), name = fields[0];
    if (fields.length !== cols.length || !/^[\w.+-]+$/.test(name) || seen.has(name)) throw new Error('Invalid or duplicate LiveBench 2.0 row');
    seen.add(name);
    const scores: Record<string, number | null> = {};
    let sum = 0, weightSum = 0;
    for (const k of keys) {
      const cell = fields[cols.indexOf(k)];
      const v = !cell || /^(?:n\/a|-)$/i.test(cell) ? null : Number(cell);
      if (v !== null && (!/^\d+(?:\.\d+)?$/.test(cell) || !Number.isFinite(v) || v > 100)) throw new Error('Invalid LiveBench 2.0 score');
      scores[`livebench2_${k}`] = v;
      if (v !== null) {
        const weight = (weights as Record<string, number>)[LIVEBENCH2_SUITES[k]] ?? 1;
        sum += v * weight; weightSum += weight;
      }
    }
    // The evaluator averages available suites. Radar only assigns an overall
    // position when the model ran the full suite, so every row shares the test.
    scores.livebench2_overall = keys.every(k => scores[`livebench2_${k}`] !== null) ? Number((sum / weightSum).toFixed(2)) : null;
    return { name, scores };
  });
}
