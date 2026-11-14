import { getSpecialistBoard, SPECIALIST_BOARDS } from '../src/lib/model-types';
import { parseMmau, parseOcrBench, parseSpecialistSnapshot, parseVideoMme } from '../src/lib/specialist-parsers';
import { modelFamilyForPath } from '../src/lib/model-navigation';

const board = (id: string) => getSpecialistBoard(id)!;
const english = ['Recognition', 'Referring', 'Spotting', 'Extraction', 'Parsing', 'Calculation', 'Understanding', 'Reasoning'];
const chinese = ['Recognition', 'Extraction', 'Parsing', 'Understanding', 'Reasoning'];
const cells = (values: (string | number)[]) => values.map(v => `<td>${v}</td>`).join('');
function ocrTable(language: string, average: number, missing = false) {
  const metrics = language === 'English' ? english : chinese;
  return `<h4>Performance of LMMs on ${language} tasks</h4><table><thead><tr>${cells(['Rank', 'Method', 'Venue', 'Open-source', 'LLM Size', 'Average', ...metrics])}</tr></thead><tbody><tr>${cells([1, 'Model A🥇', '-', 'Yes', '3B', average, ...metrics.map((_, i) => i === 0 ? missing ? '-' : 0 : 70)])}</tr></tbody></table>`;
}
const ocr = (missing = false) => `<h2>Leaderboard on Private data</h2><div id="leaderboard-2026-09">${ocrTable('English', 71, missing)}${ocrTable('Chinese', 62)}</div><div id="leaderboard-2026-06">${ocrTable('English', 99)}</div>`;

describe('OCR language and period boundaries', () => {
  it('isolates the chosen language and period, retaining zero and unknown release/access', () => {
    const row = parseOcrBench(ocr(), board('ocr'))[0];
    expect(row).toMatchObject({ name: 'Model A', score: 71, releaseDate: null, openWeights: null, benchmarks: { Recognition: 0 } });
    expect(parseOcrBench(ocr(), board('ocr-chinese'))[0].score).toBe(62);
    expect(Object.keys(row.benchmarks!)).toEqual(english);
  });
  it('withholds partial averages and rejects changed headers, periods, public tests and out-of-range values', () => {
    expect(parseOcrBench(ocr(true), board('ocr'))[0].score).toBeNull();
    expect(() => parseOcrBench(ocr().replace('leaderboard-2026-09', 'leaderboard-2026-10'), board('ocr'))).toThrow();
    expect(() => parseOcrBench(ocr().replace('Private data', 'Public data'), board('ocr'))).toThrow();
    expect(() => parseOcrBench(ocr().replace('<td>Recognition</td>', '<td>Different</td>'), board('ocr'))).toThrow('columns');
    expect(() => parseOcrBench(ocr().replace('<td>71</td>', '<td>101</td>'), board('ocr'))).toThrow('percentage');
  });
});

const audio = (name: string, size = '2B', type = 'open_access') => ({
  info: { name, size, type, link: 'https://example.com/paper/2025' },
  Sound: { Test: '0', 'Test-mini': '99' }, Music: { Test: '50', 'Test-mini': '98' },
  Speech: { Test: '70', 'Test-mini': '97' }, Avg: { Test: '40', 'Test-mini': '98' },
});
describe('MMAU source, split and identity boundaries', () => {
  it('never borrows mini results for the full test or community results for the evaluator', () => {
    const payload = JSON.stringify({ leaderboardData: [audio('Model')] });
    expect(parseMmau(payload, board('audio-understanding'))[0]).toMatchObject({ score: 40, benchmarks: { Sound: 0, Music: 50, Speech: 70 }, releaseDate: null, openWeights: null });
    expect(parseMmau(payload, board('audio-understanding-mini'))[0].score).toBe(98);
    expect(() => parseMmau(payload, { ...board('audio-understanding'), dataUrl: 'https://sakshi113.github.io/mmau_homepage/leaderboard_data_v15.json' })).toThrow('edition/split');
    const partial = { ...audio('Missing full'), Avg: { Test: '-', 'Test-mini': '98' } };
    expect(parseMmau(JSON.stringify({ leaderboardData: [partial] }), board('audio-understanding'))[0].score).toBeNull();
  });
  it('preserves same-name sizes, excludes human/random baselines, and rejects conflicting exact variants', () => {
    const payload = JSON.stringify({ leaderboardData: [audio('Gemma 3n'), audio('Gemma 3n', '4B'), audio('Human', '-', 'human_expert'), audio('Random', '-', 'random_guess')] });
    const rows = parseSpecialistSnapshot(payload, board('audio-understanding'), '2026-10-27T00:00:00Z').rows;
    expect(rows.map(r => r.id)).toEqual(['Gemma 3n::2B', 'Gemma 3n::4B']);
    expect(() => parseSpecialistSnapshot(JSON.stringify({ leaderboardData: [audio('Model'), { ...audio('Model'), Avg: { Test: '99' } }] }), board('audio-understanding'), '2026-10-27T00:00:00Z')).toThrow('Conflicting');
  });
});

function video(frames = '64', missing = false) {
  return `<table id="results"><thead><tr>${cells(['#', 'Model', 'LLM Params', 'Frames', 'Date', 'Overall (%)', 'Short Video (%)', 'Medium Video (%)', 'Long Video (%)'])}</tr><tr>${['', '', '', ''].map(() => '<th>w/o subs</th> <th>w subs</th>').join(' ')}</tr></thead><tbody><tr>${cells(['', '<a href="https://example.com/model">Video A</a><p>Lab</p>', '7B', frames, '2025-05-01', 60, 80, missing ? '-' : 0, 91, 70, 81, 80, 68])}</tr></tbody></table>`;
}
describe('Video-MME subtitle and setup boundaries', () => {
  it('selects one subtitle condition and never presents the reported date as model release', () => {
    const row = parseVideoMme(video(), board('video-understanding'))[0];
    expect(row).toMatchObject({ name: 'Video A', provider: 'Lab', score: 60, releaseDate: null, benchmarks: { 'Short video': 0, 'Medium video': 70, 'Long video': 80 }, details: { 'Reported date': '2025-05-01' } });
    expect(parseVideoMme(video(), board('video-understanding-subtitles'))[0]).toMatchObject({ score: 80, benchmarks: { 'Short video': 91 } });
    expect(parseVideoMme(video('128'), board('video-understanding'))[0].id).not.toBe(row.id);
    expect(parseVideoMme(video('768<sup>3*</sup>'), board('video-understanding'))[0].details.Frames).toBe('768 [3*]');
  });
  it('withholds partial results without borrowing the other subtitle condition and rejects column drift', () => {
    expect(parseVideoMme(video('64', true), board('video-understanding'))[0].score).toBeNull();
    expect(parseVideoMme(video('64', true), board('video-understanding-subtitles'))[0].score).toBe(80);
    expect(() => parseVideoMme(video().replace('w/o subs', 'w audio'), board('video-understanding'))).toThrow('columns');
    expect(() => parseVideoMme(video().replace('Short Video (%)', 'TEMP').replace('Medium Video (%)', 'Short Video (%)').replace('TEMP', 'Medium Video (%)'), board('video-understanding'))).toThrow('columns');
    expect(() => parseVideoMme(video(), { ...board('video-understanding'), scope: { edition: 'v2', subtitles: false } })).toThrow('scope');
  });
});

it('makes OCR first-level and gives every specialist board a model-type selection', () => {
  expect(modelFamilyForPath('/leaderboards/document-parsing')?.id).toBe('ocr');
  expect(modelFamilyForPath('/leaderboards/ocr')?.id).toBe('ocr');
  expect(modelFamilyForPath('/voice')?.id).toBe('speech');
  expect(modelFamilyForPath('/category/voice')?.id).toBe('speech');
  for (const b of SPECIALIST_BOARDS) expect(modelFamilyForPath(`/leaderboards/${b.id}`)).toBeDefined();
});
