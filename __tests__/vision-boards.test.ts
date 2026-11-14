import { parseCoco, parseKittiDepth, parseSab } from '../src/lib/vision-parsers';
import { parseSpecialistSnapshot } from '../src/lib/specialist-parsers';
import { getSpecialistBoard } from '../src/lib/model-types';
import { specialistColumns } from '../src/lib/specialist-columns';
import { rankSpecialistByColumn } from '../src/lib/specialist-presentation';

const board = (id: string) => getSpecialistBoard(id)!;
const metrics = { AP: 0.6, AP_50: 0, AP_75: 0.5, AP_small: 0.2, AP_medium: 0.4, AP_large: 0.5, AR_max_1: 0.6, AR_max_10: 0.7, AR_max_100: 0.8, AR_small: 0.3, AR_medium: 0.5, AR_large: 0.6 };
const coco = (overrides = {}) => ({ leaderboard_name: 'bbox-dev2015', leaderboard_id: 1, date: '2020-01-01', team: { id: 'legacy-id', name: 'Team A' }, description: '<b>Ensemble</b>', url: 'javascript:alert(1)', results: JSON.stringify(metrics), ...overrides });
it('keeps historical COCO identity/split, scales every cell once, and never treats submission dates as releases', () => {
  const row = parseCoco(JSON.stringify([coco()]), board('detection-coco'))[0];
  expect(row).toMatchObject({ id: 'bbox-dev2015:legacy-id:2020-01-01', identityKind: 'submission', score: 60, releaseDate: null, url: null, benchmarks: { AP50: 0, AP75: 50, 'AR max 100': 80 }, details: { 'Submission date': '2020-01-01', 'Submission description': 'Ensemble' } });
  expect(() => parseCoco(JSON.stringify([coco()]), board('segmentation-coco'))).toThrow();
  expect(() => parseCoco(JSON.stringify([coco({ results: JSON.stringify({ ...metrics, AP: 60 }) })]), board('detection-coco'))).toThrow();
  expect(() => parseCoco(JSON.stringify([coco({ results: JSON.stringify({ ...metrics, changed: 0.5 }) })]), board('detection-coco'))).toThrow('schema');
  expect(parseCoco(JSON.stringify([coco({ results: JSON.stringify({ ...metrics, AP_50: null }) })]), board('detection-coco'))[0].score).toBeNull();
  expect(() => parseSpecialistSnapshot(JSON.stringify([coco(), coco({ results: JSON.stringify({ ...metrics, AP: 0.9 }) })]), board('detection-coco'), '2026-10-27T00:00:00Z')).toThrow('Conflicting');
});
it('preserves panoptic things/stuff metrics separately from box and instance AP', () => {
  const payload = coco({ leaderboard_name: 'panoptic-dev', results: JSON.stringify({ PQ: 0.4, SQ: 0.8, RQ: 0.5, PQTH: 0.45, SQTH: 0.81, RQTH: 0.56, PQST: 0.3, SQST: 0.78, RQST: 0.39 }) });
  expect(parseCoco(JSON.stringify([payload]), board('panoptic-segmentation'))[0]).toMatchObject({ score: 40, benchmarks: { 'PQ things': 45, 'PQ stuff': 30 } });
});

const sab = `All COCO accuracy numbers are measured in-house; full 5,000-image \`val2017\` split.
### Detection
| Architecture | COCO AP<sub>50</sub> | COCO AP<sub>50:95</sub> | RF100VL AP<sub>50</sub> | RF100VL AP<sub>50:95</sub> | Latency (ms) | Params (M) | Resolution | License |
|---|---|---|---|---|---|---|---|---|
| RF-DETR-N | 60 | 40 | 70 | 50 | 2.5 | 10 | 640x640 | Apache 2.0 |
| RF-DETR-P △ | 65 | 42 | - | - | 1.2 | 8 | 560x560 | PML |
### Segmentation
| Architecture | COCO AP<sub>50</sub> | COCO AP<sub>50:95</sub> | Latency (ms) | Params (M) | Resolution | License |
|---|---|---|---|---|---|---|
| RF-DETR-Seg-N | 59 | 39 | 3.5 | 12 | 432x432 | Apache 2.0 |
| Paper only † | 99 | 98 | - | 10 | 1000x1000 | Custom |
`;
it('isolates measured SAB detection and mask scores, excludes paper-only rows, and retains latency/specs', () => {
  const rows = parseSab(sab, board('object-detection'));
  expect(rows[0]).toMatchObject({ score: 40, benchmarks: { 'COCO AP50': 60, 'RF100-VL AP50': 70, 'RF100-VL AP50:95': 50 }, details: { 'Latency (ms)': 2.5, 'Params (M)': 10 }, releaseDate: null });
  expect(rows[1]).toMatchObject({ name: 'RF-DETR-P', score: 42, openWeights: null, benchmarks: { 'RF100-VL AP50': null } });
  const masks = parseSab(sab, board('image-segmentation'));
  expect(masks).toHaveLength(1);
  expect(masks[0]).toMatchObject({ score: 39, benchmarks: { 'COCO AP50': 59 }, details: { 'Latency (ms)': 3.5 } });
  expect(() => parseSab(sab.replace('full 5,000-image `val2017` split', 'test-dev'), board('object-detection'))).toThrow('protocol');
  expect(() => parseSab(sab.replace('RF100VL AP<sub>50</sub>', 'Changed'), board('object-detection'))).toThrow('columns');
  expect(parseSab(sab.replace('| 60 | 40 |', '| - | 40 |'), board('object-detection'))[0].score).toBeNull();
});

const cells = (v: (string | number)[]) => v.map(x => `<td>${x}</td>`).join('');
const kitti = `Depth Prediction Evaluation<table class="results"><tr>${cells(['', 'Method', 'Setting', 'Code', 'SILog', 'sqErrorRel', 'absErrorRel', 'iRMSE', 'Runtime', 'Environment', ''])}</tr><tr>${cells(['1', '<a href="eval_depth_detail.php?benchmark=depth_prediction&amp;result=a">A</a>', '<img src="icon_at.png">', '', 7.28, 101, 3.5, 7.4, '0.1 s', 'GPU', ''])}</tr><tr>${cells(['2', '<a href="eval_depth_detail.php?benchmark=depth_prediction&amp;result=b">B</a>', '', '', 8, 2, 0, 9, '0.2 s', 'GPU', ''])}</tr><tr><td class="results_sub">Paper reference only</td></tr></table>`;
it('ranks KITTI errors lower-first with correct units, without clipping errors at 100', () => {
  const rows = parseKittiDepth(kitti, board('depth-estimation'));
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ id: 'a', score: 7.28, releaseDate: null, benchmarks: { sqErrorRel: 101, absErrorRel: 3.5, iRMSE: 7.4 } });
  const columns = specialistColumns(rows, 'SILog', 'asc', 'log(m) × 100', 'depth-estimation');
  for (const col of columns.filter(c => c.quality)) expect(col.direction).toBe('asc');
  const abs = columns.find(c => c.id === 'absErrorRel')!;
  expect(abs.unit).toBe('%');
  expect(rankSpecialistByColumn(rows, abs)[0]).toMatchObject({ id: 'b', rank: 1 });
  expect(columns.find(c => c.id === 'iRMSE')!.unit).toBe('1/km');
  expect(() => parseKittiDepth(kitti.replaceAll('depth_prediction', 'depth_completion'), board('depth-estimation'))).toThrow('identity');
  expect(() => parseKittiDepth(kitti.replace('sqErrorRel', 'New metric'), board('depth-estimation'))).toThrow('columns');
});
