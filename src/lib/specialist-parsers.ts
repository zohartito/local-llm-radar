import { parseCoco, parseSab, parseKittiDepth } from './vision-parsers';
import { normalizeReleaseDate } from './model-release';
import { z } from 'zod';
import { VERIFIED_EMBEDDING_METADATA } from './embedding-metadata';
import { decodeNextFlightPayload, extractBalancedJson } from './live-sources';
import type { InputModality, SpecialistBoard, SpecialistRow, SpecialistSnapshot } from './model-types';

const finite = z.number().finite();
const score = finite.nullable();
const optionalNumber = finite.nullish();
const optionalString = z.string().nullish();

export function safeSourceUrl(value: unknown, base?: string): string | null {
  if (typeof value !== 'string' || !value || value.startsWith('$')) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function detail(values: Record<string, unknown>): SpecialistRow['details'] {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string | number] =>
    (typeof entry[1] === 'string' && entry[1].length > 0 && !entry[1].startsWith('$')) ||
    (typeof entry[1] === 'number' && Number.isFinite(entry[1]))));
}

function jsonValues(text: string, key: string, bracket: '{' | '['): unknown[] {
  const values: unknown[] = [];
  const marker = `"${key}":`;
  let from = 0;
  while ((from = text.indexOf(marker, from)) !== -1) {
    let start = from + marker.length;
    while (/\s/.test(text[start] ?? 'x')) start++;
    from = start;
    if (text[start] !== bracket) continue;
    const raw = extractBalancedJson(text, start, bracket, bracket === '{' ? '}' : ']');
    if (!raw) throw new Error(`Truncated ${key}`);
    values.push(JSON.parse(raw));
    from = start + raw.length;
  }
  return values;
}

const mtebSchema = z.object({
  benchmarkName: z.string(), tasks: z.array(z.string()),
  aggregations: z.array(z.string()).optional(),
  tasksMeta: z.array(z.object({ name: z.string(), type: z.string() })).optional(),
  rows: z.array(z.object({
    model: z.object({ name: z.string().min(1), url: optionalString, releaseDate: optionalString, modelType: z.string(), openWeights: z.boolean().nullish(), license: optionalString, modalities: z.array(z.string()).nullish() }),
    meanTask: score, embeddingDim: optionalNumber, maxTokens: optionalNumber, totalParamsB: optionalNumber,
    zeroShotPct: optionalNumber, experiments: z.record(z.string(), z.unknown()).nullish(),
    scoresByTask: z.record(z.string(), optionalNumber),
    scoresByTaskType: z.record(z.string(), optionalNumber).optional(),
  })),
});

export function parseMteb(text: string, board: SpecialistBoard): SpecialistRow[] {
  const data = mtebSchema.parse(JSON.parse(text));
  if (data.benchmarkName !== board.benchmark || !data.tasks.length) throw new Error('MTEB suite changed');
  // The API's meanTask field carries the first configured aggregation. MIEB
  // uses the mean of task types, unlike the flat task mean on the text boards.
  const expectedAggregation = board.id === 'image-embeddings' ? 'mean_task_type' : 'mean_task';
  if (data.aggregations && data.aggregations[0] !== expectedAggregation) throw new Error('MTEB primary aggregation changed');
  const taskTypes = new Map((data.tasksMeta ?? []).map(task => [task.name, task.type]));
  const groups = [...new Set(data.tasks.map(task => taskTypes.get(task)).filter((type): type is string => !!type))];
  return data.rows.filter(row => row.model.modelType !== 'cross-encoder').map(row => {
    // Experiment variants are separate observations, never silently merged.
    const experiment = row.experiments && Object.keys(row.experiments).length
      ? JSON.stringify(Object.fromEntries(Object.entries(row.experiments).sort(([a], [b]) => a.localeCompare(b)))) : '';
    const verified = VERIFIED_EMBEDDING_METADATA[row.model.name];
    const completed = data.tasks.filter(task => typeof row.scoresByTask[task] === 'number').length;
    const validMean = row.meanTask !== null && row.meanTask >= -1 && row.meanTask <= 1;
    return {
      id: row.model.name + (experiment ? `::${experiment}` : ''),
      name: row.model.name, provider: row.model.name.includes('/') ? row.model.name.split('/')[0] : '',
      url: safeSourceUrl(row.model.url),
      releaseDate: normalizeReleaseDate(verified && 'releaseDate' in verified ? verified.releaseDate : row.model.releaseDate),
      score: validMean && completed === data.tasks.length ? row.meanTask! * 100 : null,
      benchmarks: Object.fromEntries([
        ...groups.map(type => {
          const tasks = data.tasks.filter(task => taskTypes.get(task) === type);
          const value = row.scoresByTaskType?.[type];
          // A group average is comparable only when all its suite tasks are reported.
          const complete = data.tasks.every(task => taskTypes.has(task)) && tasks.every(task => typeof row.scoresByTask[task] === 'number');
          return [`group:${type}`, complete && typeof value === 'number' ? value * 100 : null];
        }),
        // Sparse task cells keep the multilingual suite below Next's 2 MiB cache limit.
        ...data.tasks.filter(task => typeof row.scoresByTask[task] === 'number').map(task => [`task:${task}`, row.scoresByTask[task]! * 100]),
      ]),
      openWeights: row.model.openWeights ?? null,
      inputModalities: [...new Set((row.model.modalities ?? []).filter((value): value is InputModality => ['text', 'image', 'audio', 'video'].includes(value)))].sort(),
      details: detail({ Type: row.model.modelType, Dimensions: row.embeddingDim, 'Max tokens': row.maxTokens, 'Parameters (B)': verified?.totalParamsB ?? row.totalParamsB, 'Tasks reported': `${completed}/${data.tasks.length}`, 'Zero-shot %': row.zeroShotPct != null && row.zeroShotPct >= 0 && row.zeroShotPct <= 100 ? row.zeroShotPct : undefined, License: verified?.license ?? row.model.license, Experiment: experiment, ...(verified ? {
        ...(verified.totalParamsB !== undefined ? { 'Benchmark-reported parameters (B)': row.totalParamsB } : {}),
        ...('releaseDate' in verified ? { 'Benchmark-reported date': row.model.releaseDate } : {}),
        'Metadata source': verified.source, 'Metadata checked': verified.checkedAt, 'Metadata note': verified.note,
      } : {}) }),
    };
  });
}

const rerankerSchema = z.array(z.object({
  name: z.string(), provider: z.string(), score: finite, license: z.string(),
  avgNdcg10: optionalNumber, avgLatencyMs: optionalNumber, costPer1MTokens: optionalNumber,
}));

export function parseRerankers(text: string): SpecialistRow[] {
  const candidates = jsonValues(decodeNextFlightPayload(text), 'entries', '[');
  for (const candidate of candidates) {
    const parsed = rerankerSchema.safeParse(candidate);
    if (!parsed.success || !parsed.data.length) continue;
    return parsed.data.map(row => ({
      id: row.name, name: row.name, provider: row.provider, url: null, score: row.score,
      // A license alone does not prove downloadable weights.
      openWeights: row.license.toLowerCase() === 'proprietary' ? false : null,
      details: detail({ License: row.license, 'nDCG@10': row.avgNdcg10, 'Latency (ms)': row.avgLatencyMs, 'USD / 1M tokens': row.costPer1MTokens }),
    }));
  }
  throw new Error('Reranker table not found');
}

export function parse3d(text: string): SpecialistRow[] {
  const rows = z.array(z.object({ name: z.string(), score: finite, votes: finite, open_source: z.boolean() })).parse(JSON.parse(text));
  return rows.map(row => ({ id: row.name, name: row.name, provider: '', url: null, score: row.score, openWeights: null, details: { Votes: row.votes, 'Source license label': row.open_source ? 'Open source' : 'Closed' } }));
}

function plainCell(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

/** Preserve zero and missing cells; schema drift fails closed, never parseFloat partial text. */
function percentage(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && ['', '-', '—', 'N/A'].includes(value.trim()))) return null;
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text) || Number(text) > 100) throw new Error('Invalid benchmark percentage');
  return Number(text);
}

export function parseOcrBench(text: string, board: SpecialistBoard): SpecialistRow[] {
  const { edition, language } = board.scope ?? {};
  if (edition !== '2026.09' || !['English', 'Chinese'].includes(language ?? '') || board.benchmark !== `OCRBench v2 · private · ${language} · ${edition}` || !text.includes('Leaderboard on Private data')) throw new Error('OCRBench scope changed');
  const period = text.match(/<div[^>]+id="leaderboard-2026-09"[^>]*>([\s\S]*?)(?=<div[^>]+id="leaderboard-20|$)/)?.[1];
  const table = period?.match(new RegExp(`<h4[^>]*>Performance of LMMs on ${language} tasks</h4>\\s*<table[^>]*>([\\s\\S]*?)</table>`))?.[1];
  if (!table) throw new Error('OCRBench edition/language table changed');
  const metrics = language === 'English' ? ['Recognition', 'Referring', 'Spotting', 'Extraction', 'Parsing', 'Calculation', 'Understanding', 'Reasoning'] : ['Recognition', 'Extraction', 'Parsing', 'Understanding', 'Reasoning'];
  const headers = [...(table.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? '').matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(cell => plainCell(cell[1]));
  if (headers.join('|') !== ['Rank', 'Method', 'Venue', 'Open-source', 'LLM Size', 'Average', ...metrics].join('|')) throw new Error('OCRBench columns changed');
  const body = table.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(match => {
    const raw = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1]);
    if (raw.length !== headers.length) throw new Error('OCRBench row width changed');
    const cells = raw.map(plainCell);
    const name = cells[1].replace(/[🥇🥈🥉\uFE0F]/gu, '').trim();
    if (!name) throw new Error('Missing OCR model identity');
    const benchmarks = Object.fromEntries(metrics.map((metric, i) => [metric, percentage(cells[i + 6])]));
    return { id: name, name, provider: '', url: safeSourceUrl(raw[1].match(/href="([^"]+)"/)?.[1], board.sourceUrl),
      score: Object.values(benchmarks).every(value => value !== null) ? percentage(cells[5]) : null, releaseDate: null, openWeights: cells[3] === 'No' ? false : null,
      benchmarks,
      details: { Size: cells[4], 'Source license label': cells[3] === 'Yes' ? 'Open source (source label)' : cells[3], 'Evaluation period': edition, Language: language!, Evidence: 'Benchmark-maintained private test' },
    };
  });
}

export function parseMmau(text: string, board: SpecialistBoard): SpecialistRow[] {
  const { edition, split } = board.scope ?? {};
  if (edition !== 'v05.15.25' || !['Test', 'Test-mini'].includes(split ?? '') || board.dataUrl !== 'https://sakshi113.github.io/mmau_homepage/leaderboard_data_v15_parsed.json' || board.benchmark !== `MMAU-v05.15.25 · evaluator-parsed · ${split}`) throw new Error('MMAU edition/split changed');
  const result = z.object({ Test: z.union([z.string(), finite]).nullish(), 'Test-mini': z.union([z.string(), finite]).nullish() });
  const data = z.object({ leaderboardData: z.array(z.object({
    info: z.object({ name: z.string().min(1), type: z.string(), size: optionalString, link: optionalString }),
    Sound: result, Music: result, Speech: result, Avg: result,
  })) }).parse(JSON.parse(text));
  return data.leaderboardData.filter(row => !['human_expert', 'random_guess'].includes(row.info.type)).map(row => {
    const benchmarks = { Sound: percentage(row.Sound[split!]), Music: percentage(row.Music[split!]), Speech: percentage(row.Speech[split!]) };
    return { id: `${row.info.name}::${row.info.size ?? ''}`, name: row.info.name, provider: '', url: safeSourceUrl(row.info.link), releaseDate: null,
      score: Object.values(benchmarks).every(value => value !== null) ? percentage(row.Avg[split!]) : null,
      benchmarks, openWeights: ['closed', 'proprietary'].includes(row.info.type) ? false : null,
      details: detail({ Size: row.info.size, 'Source license label': row.info.type, Split: split, Evidence: 'Evaluator-parsed results; excludes unverified community feed' }),
    };
  });
}

export function parseVideoMme(text: string, board: SpecialistBoard): SpecialistRow[] {
  const { edition, subtitles } = board.scope ?? {};
  if (edition !== 'original' || typeof subtitles !== 'boolean' || board.benchmark !== `Video-MME · original · ${subtitles ? 'with' : 'without'} subtitles`) throw new Error('Video-MME scope changed');
  const table = text.match(/<table[^>]+id="results"[^>]*>([\s\S]*?)<\/table>/)?.[1];
  const headers = [...(table?.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? '').matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(cell => plainCell(cell[1]));
  const expected = ['#', 'Model', 'LLM Params', 'Frames', 'Date', 'Overall (%)', 'Short Video (%)', 'Medium Video (%)', 'Long Video (%)', ...Array.from({ length: 4 }, () => ['w/o subs', 'w subs']).flat()];
  if (!table || JSON.stringify(headers) !== JSON.stringify(expected)) throw new Error('Video-MME columns changed');
  const body = table.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(match => {
    const raw = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1]);
    if (raw.length !== 13) throw new Error('Video-MME row width changed');
    const cells = raw.map(plainCell);
    // Keep a superscript footnote separate: 768 with note 3 is not 7,683 frames.
    cells[3] = plainCell(raw[3].replace(/<sup[^>]*>([\s\S]*?)<\/sup>/g, (_, note: string) => ` [${plainCell(note)}]`));
    const name = plainCell(raw[1].replace(/<p[\s\S]*?<\/p>/g, ''));
    if (!name) throw new Error('Missing video model identity');
    const offset = subtitles ? 1 : 0;
    const benchmarks = Object.fromEntries(['Short video', 'Medium video', 'Long video'].map((metric, i) => [metric, percentage(cells[7 + i * 2 + offset])]));
    return { id: `${name}::${cells[2]}::${cells[3]}::${cells[4]}`, name, provider: plainCell(raw[1].match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''),
      url: safeSourceUrl(raw[1].match(/href="([^"]+)"/)?.[1]), releaseDate: null, openWeights: null,
      score: Object.values(benchmarks).every(value => value !== null) ? percentage(cells[5 + offset]) : null, benchmarks,
      details: { Size: cells[2], Frames: cells[3], 'Reported date': cells[4], Subtitles: subtitles ? 'With subtitles' : 'Without subtitles', Evidence: 'Published original Video-MME result; frame/audio settings vary' },
    };
  });
}

export function parseOmniDoc(text: string): SpecialistRow[] {
  const table = text.match(/<table[^>]*>\s*<caption>Comprehensive evaluation of document parsing on OmniDocBench \(v1\.6_full\)<\/caption>[\s\S]*?<\/table>/)?.[0];
  if (!table) throw new Error('OmniDocBench edition changed');
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].flatMap(match => {
    const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => plainCell(cell[1]));
    if (cells.length !== 9 || !/^\d+(\.\d+)?$/.test(cells[3])) return [];
    return [{ id: cells[0], name: cells[0], provider: '', url: null, score: Number(cells[3]), openWeights: null,
      benchmarks: Object.fromEntries([['Text edit distance', cells[4]], ['Formula CDM', cells[5]], ['Table TEDS', cells[6]], ['Table TEDS-S', cells[7]], ['Reading-order edit distance', cells[8]]].map(([key, value]) => [key, /^\d+(\.\d+)?$/.test(value) ? Number(value) : null])),
      details: { Type: cells[1], Size: cells[2] },
    }];
  });
}

export function parseMmmu(text: string): SpecialistRow[] {
  const data = z.object({ leaderboardData: z.array(z.object({
    info: z.object({ name: z.string(), type: z.string(), size: optionalString, date: optionalString, link: optionalString }),
    pro: z.object({ overall: z.union([z.string(), finite]).nullish(), vision: z.union([z.string(), finite]).nullish(), original: z.union([z.string(), finite]).nullish(), source: optionalString }).optional(),
  })) }).parse(JSON.parse(text));
  return data.leaderboardData.filter(row => row.pro && ['open_source', 'proprietary'].includes(row.info.type)).map(row => {
    const value = row.pro?.overall;
    const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;
    return {
      id: `${row.info.name}::${row.info.date ?? ''}`, name: row.info.name, provider: '',
      url: safeSourceUrl(row.info.link), score: numeric !== null && numeric >= 0 && numeric <= 100 ? numeric : null,
      benchmarks: Object.fromEntries([['MMMU-Pro Vision', row.pro?.vision], ['MMMU-Pro Standard', row.pro?.original]].map(([key, value]) => {
        const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;
        return [key, numeric !== null && numeric >= 0 && numeric <= 100 ? numeric : null];
      })),
      openWeights: row.info.type === 'proprietary' ? false : null,
      details: detail({ Size: row.info.size, 'Reported date': row.info.date, Evidence: row.pro?.source === 'author' ? 'Author submitted' : 'Benchmark-maintained result', 'Source license label': row.info.type === 'open_source' ? 'Open source' : 'Proprietary' }),
    };
  });
}

export function parseSpecialistSnapshot(text: string, board: SpecialistBoard, checkedAt: string): SpecialistSnapshot {
  const parsers = { mteb: parseMteb, rerankers: parseRerankers, '3d': parse3d, omnidoc: parseOmniDoc, mmmu: parseMmmu, ocrbench: parseOcrBench, mmau: parseMmau, videomme: parseVideoMme, coco: parseCoco, sab: parseSab, kitti: parseKittiDepth };
  const rows = parsers[board.parser](text, board);
  const unique = new Map<string, SpecialistRow>();
  for (const row of rows) {
    const existing = unique.get(row.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(row)) throw new Error('Conflicting source identities');
    unique.set(row.id, row);
  }
  if (unique.size < 2 || ![...unique.values()].some(row => row.score !== null)) throw new Error('No comparable source results');
  const dateMatch = board.parser === 'rerankers' ? plainCell(text).match(/Last updated:\s*([A-Za-z]+ \d{1,2}, \d{4})/)?.[1] : null;
  return {
    boardId: board.id, benchmark: board.benchmark, checkedAt,
    sourceUpdatedAt: dateMatch && Number.isFinite(Date.parse(dateMatch + ' UTC')) ? new Date(dateMatch + ' UTC').toISOString().slice(0, 10) : null,
    rows: [...unique.values()],
  };
}
