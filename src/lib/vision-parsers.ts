import { z } from 'zod';
import type { SpecialistBoard, SpecialistRow } from './model-types';

const clean = (text: string) => text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
function numeric(value: unknown, max = Infinity): number | null {
  if (value == null || ['', '-', '—', 'N/A'].includes(String(value).trim())) return null;
  if (!/^\d+(\.\d+)?$/.test(String(value).trim())) throw new Error('Invalid vision metric');
  const n = Number(value);
  if (!Number.isFinite(n) || n > max) throw new Error('Vision metric outside range');
  return n;
}
function link(value: string | undefined, base: string): string | null {
  if (!value) return null;
  try { const url = new URL(value.replace(/&amp;/g, '&'), base); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}

const cocoMetrics = ['AP', 'AP_50', 'AP_75', 'AP_small', 'AP_medium', 'AP_large', 'AR_max_1', 'AR_max_10', 'AR_max_100', 'AR_small', 'AR_medium', 'AR_large'];
const panopticMetrics = ['PQ', 'SQ', 'RQ', 'PQTH', 'SQTH', 'RQTH', 'PQST', 'SQST', 'RQST'];
const metricLabel: Record<string, string> = { AP_50: 'AP50', AP_75: 'AP75', AP_small: 'AP small', AP_medium: 'AP medium', AP_large: 'AP large', AR_max_1: 'AR max 1', AR_max_10: 'AR max 10', AR_max_100: 'AR max 100', AR_small: 'AR small', AR_medium: 'AR medium', AR_large: 'AR large', PQTH: 'PQ things', SQTH: 'SQ things', RQTH: 'RQ things', PQST: 'PQ stuff', SQST: 'SQ stuff', RQST: 'RQ stuff' };

/** COCO's official, historical test-dev exports contain submissions, not release records. */
export function parseCoco(text: string, board: SpecialistBoard): SpecialistRow[] {
  const suite = board.scope?.edition;
  const expected = { 'detection-coco': 'bbox-dev2015', 'segmentation-coco': 'segm-dev2015', 'panoptic-segmentation': 'panoptic-dev' }[board.id];
  if (!expected || suite !== expected || board.benchmark !== `COCO · ${suite} · official archive`) throw new Error('COCO scope changed');
  const rows = z.array(z.object({ leaderboard_name: z.literal(expected), leaderboard_id: z.number().int(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), team: z.object({ id: z.union([z.number().int(), z.string().min(1)]), name: z.string().min(1) }), results: z.string(), description: z.string(), url: z.string() })).parse(JSON.parse(text));
  const keys = suite === 'panoptic-dev' ? panopticMetrics : cocoMetrics;
  return rows.map(row => {
    const raw = z.record(z.string(), z.number().finite().min(0).max(1).nullable()).parse(JSON.parse(row.results));
    if (Object.keys(raw).sort().join('|') !== [...keys].sort().join('|')) throw new Error('COCO metric schema changed');
    const values = Object.fromEntries(keys.map(key => [key, raw[key] === null ? null : Number((raw[key] * 100).toFixed(8))]));
    const primary = keys[0];
    return { id: `${suite}:${row.team.id}:${row.date}`, name: row.team.name, provider: '', identityKind: 'submission', url: link(row.url, board.sourceUrl), openWeights: null, releaseDate: null,
      score: Object.values(values).every(v => v !== null) ? values[primary] : null,
      benchmarks: Object.fromEntries(keys.slice(1).map(key => [metricLabel[key] ?? key, values[key]])),
      details: { 'Submission date': row.date, 'Entry type': 'Team / method submission; not a verified model release', 'Submission description': clean(row.description), Evidence: 'COCO evaluator export; historical test-dev; training data and ensembles vary' },
    };
  });
}

/** Measured rows only: the source explicitly marks paper-only results with a dagger. */
export function parseSab(text: string, board: SpecialistBoard): SpecialistRow[] {
  const task = board.id === 'object-detection' ? 'Detection' : board.id === 'image-segmentation' ? 'Segmentation' : null;
  if (!task || board.scope?.edition !== 'SAB-val2017' || board.benchmark !== `Roboflow SAB · COCO val2017 · ${task}` || !text.includes('full 5,000-image `val2017` split') || !text.includes('All COCO accuracy numbers are measured in-house')) throw new Error('SAB protocol changed');
  const section = text.split(`### ${task}\n`)[1]?.split('\n### ')[0];
  if (!section) throw new Error('Missing SAB task');
  const lines = section.split('\n').filter(line => line.startsWith('|'));
  const cells = (line: string) => line.split('|').slice(1, -1).map(clean);
  const expected = ['Architecture', 'COCO AP50', 'COCO AP50:95', ...(task === 'Detection' ? ['RF100VL AP50', 'RF100VL AP50:95'] : []), 'Latency (ms)', 'Params (M)', 'Resolution', 'License'];
  if (cells(lines[0] ?? '').join('|') !== expected.join('|')) throw new Error('SAB columns changed');
  return lines.slice(2).filter(line => !line.includes('†')).map(line => {
    const c = cells(line);
    if (c.length !== expected.length) throw new Error('SAB row width changed');
    const name = c[0].replace(/\s*△/g, '').trim();
    const offset = task === 'Detection' ? 2 : 0;
    const ap50 = numeric(c[1], 100), score = numeric(c[2], 100);
    const params = numeric(c[4 + offset]), latency = numeric(c[3 + offset]);
    const benchmarks: Record<string, number | null> = { 'COCO AP50': ap50 };
    if (offset) { benchmarks['RF100-VL AP50'] = numeric(c[3], 100); benchmarks['RF100-VL AP50:95'] = numeric(c[4], 100); }
    const provider = name.startsWith('RF-DETR') ? 'Roboflow' : name.startsWith('YOLO') ? 'Ultralytics' : name.startsWith('LW-DETR') ? 'LW-DETR authors' : name.startsWith('D-FINE') ? 'D-FINE authors' : '';
    return { id: name, name, provider, url: board.sourceUrl, releaseDate: null, openWeights: null, score: ap50 === null ? null : score, benchmarks,
      details: { ...(params !== null ? { 'Params (M)': params } : {}), ...(latency !== null ? { 'Latency (ms)': latency } : {}), Resolution: c[5 + offset], License: c[6 + offset], 'Test setup': 'NVIDIA T4 · TensorRT FP16 · batch 1; source resolutions vary', Evidence: 'Roboflow in-house SAB measurements; evaluator also develops RF-DETR', ...(c[0].includes('△') ? { Access: 'PML variant; check license and availability with author' } : {}) },
    };
  });
}

export function parseKittiDepth(text: string, board: SpecialistBoard): SpecialistRow[] {
  if (board.id !== 'depth-estimation' || board.benchmark !== 'KITTI · depth prediction · official test' || !text.includes('Depth Prediction Evaluation')) throw new Error('KITTI task changed');
  const table = text.match(/<table class="results">([\s\S]*?)<\/table>/)?.[1];
  if (!table) throw new Error('Missing KITTI results');
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
  const cells = (row: string) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
  const header = ['', 'Method', 'Setting', 'Code', 'SILog', 'sqErrorRel', 'absErrorRel', 'iRMSE', 'Runtime', 'Environment', ''];
  if (cells(rows[0]).map(clean).join('|') !== header.join('|')) throw new Error('KITTI columns changed');
  return rows.slice(1).filter(row => !row.includes('class="results_sub"')).map(row => {
    const raw = cells(row), c = raw.map(clean);
    if (c.length !== 11) throw new Error('KITTI row width changed');
    const href = raw[1].match(/href="([^"]+)"/)?.[1];
    const url = link(href, board.sourceUrl);
    const id = url && new URL(url).searchParams.get('result');
    if (!id || !href?.includes('benchmark=depth_prediction')) throw new Error('Invalid KITTI result identity');
    const metrics = c.slice(4, 8).map(v => numeric(v));
    return { id, name: c[1], provider: '', url, releaseDate: null, openWeights: null,
      score: metrics.every(v => v !== null) ? metrics[0] : null,
      benchmarks: { sqErrorRel: metrics[1], absErrorRel: metrics[2], iRMSE: metrics[3] },
      details: { 'Training data': raw[2].includes('icon_at') ? 'Additional training data reported; see source' : 'No additional-data flag in source', Runtime: c[8], Environment: c[9], ...(link(raw[3].match(/href="([^"]+)"/)?.[1], board.sourceUrl) ? { 'Code / project': link(raw[3].match(/href="([^"]+)"/)?.[1], board.sourceUrl)! } : {}), Evidence: 'Official KITTI depth prediction test; lower error is better' },
    };
  });
}
