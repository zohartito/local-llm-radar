import { loadVoiceFitCatalog } from '../src/lib/voice-fit-catalog';
import { parseVoiceFitCatalog, type VoiceFitCatalog } from '../src/lib/voice-fit';
import { voiceFitForMachine, voiceShortlist } from '../src/lib/voice-fit-selection';
import { CATEGORY_DEFINITIONS } from '../src/lib/leaderboard';

function fresh(): VoiceFitCatalog {
  return JSON.parse(JSON.stringify(loadVoiceFitCatalog()));
}

describe('voice evidence trust boundaries', () => {
  test('voice stays outside text category scoring', () => {
    expect(CATEGORY_DEFINITIONS.some(category => String(category.key) === 'voice')).toBe(false);
    const raw = fresh();
    Object.assign(raw.rows[0], { composite_score: 99 });
    expect(() => parseVoiceFitCatalog(raw)).toThrow();
  });

  test('official 80 GB runtime stays over budget on both independent GPUs', () => {
    const catalog = fresh();
    const row = catalog.rows.find(row => row.id === 'voicechat-official')!;
    expect(row.metrics.find(metric => metric.quantity === 'runtime-requirement')?.value).toBe(80);
    expect(voiceFitForMachine(row, 'a6000-48').status).toBe('over-budget');
    expect(voiceFitForMachine(row, '4070ti-super-16').status).toBe('over-budget');
    expect(catalog.machines.map(machine => machine.capacity_gib)).toEqual([48, 16, 64]);
    Object.assign(row.fits, { 'combined-pc-64': row.fits['a6000-48'] });
    expect(() => parseVoiceFitCatalog(catalog)).toThrow();
  });

  test('runtime variants preserve different memory and platform evidence', () => {
    const catalog = fresh();
    const cpp = catalog.rows.find(row => row.id === 'minicpm-omni')!;
    const pytorch = catalog.rows.find(row => row.id === 'minicpm-pytorch')!;
    expect(voiceFitForMachine(cpp, '4070ti-super-16').status).toBe('candidate');
    expect(voiceFitForMachine(pytorch, '4070ti-super-16').status).toBe('over-budget');
    const mlx = catalog.rows.find(row => row.id === 'voicechat-mlx')!;
    expect(voiceFitForMachine(mlx, 'm4-max-64').status).toBe('conditional');
    expect(mlx.metrics.find(metric => metric.quantity === 'download')?.value).toBe(8.56);
    expect(mlx.metrics.filter(metric => metric.quantity === 'peak-memory' && metric.value !== null)
      .every(metric => metric.provenance === 'published' && metric.hardware.includes('M5 Pro'))).toBe(true);
  });

  test('structured tool calls do not count as a persistent coding-harness integration', () => {
    const catalog = fresh();
    for (const machine of catalog.machines) {
      expect(voiceShortlist(catalog, machine.id, 'coding-agents').map(row => row.id)).toEqual(['agent-speech-bridge']);
      expect(voiceShortlist(catalog, machine.id, 'conversation')
        .every(row => ['candidate', 'measured'].includes(voiceFitForMachine(row, machine.id).status))).toBe(true);
    }
  });

  test('a publisher memory measurement cannot masquerade as a local measured fit', () => {
    const raw = fresh();
    raw.rows[0].fits['a6000-48'].status = 'measured';
    raw.rows[0].fits['a6000-48'].provenance = 'local-measurement';
    expect(() => parseVoiceFitCatalog(raw)).toThrow(/receipt/);
  });

  test('a local receipt cannot certify a different hardware scope', () => {
    const raw = fresh();
    raw.rows[0].fits['a6000-48'] = {
      status: 'measured', provenance: 'local-measurement', note: 'Test fixture only', sources: [],
      receipt: { path: 'test-fixture.json', machine: '4070ti-super-16', recorded: '2026-10-23', runtime: 'test runtime', workload: 'test fixture' },
    };
    expect(() => parseVoiceFitCatalog(raw)).toThrow(/different machine/);
  });

  test('unknown memory stays null and does not turn into zero or an invented estimate', () => {
    const raw = fresh();
    raw.rows[0].metrics[0].value = 1;
    expect(() => parseVoiceFitCatalog(raw)).toThrow(/Unknown metrics/);
    raw.rows[0].metrics[0].value = 0;
    expect(() => parseVoiceFitCatalog(raw)).toThrow();
  });

  test('claims require real source references and safe source links', () => {
    const raw = fresh();
    raw.rows[0].persona.sources = ['not-a-catalog-source'];
    expect(() => parseVoiceFitCatalog(raw)).toThrow(/unknown source/);
    raw.rows[0].persona.sources = [];
    expect(() => parseVoiceFitCatalog(raw)).toThrow(/need sources/);
    const malicious = fresh();
    malicious.sources[0].url = 'javascript:alert(1)';
    expect(() => parseVoiceFitCatalog(malicious)).toThrow(/HTTPS/);
  });

  test('memory units, dates, complete scopes and unique identities are validated', () => {
    const wrongUnit = fresh();
    wrongUnit.rows[0].metrics[0].unit = 'ms';
    expect(() => parseVoiceFitCatalog(wrongUnit)).toThrow(/unit disagree/);
    const badDate = fresh();
    badDate.sources[0].checked = '2026-02-31';
    expect(() => parseVoiceFitCatalog(badDate)).toThrow();
    const incomplete = fresh();
    Reflect.deleteProperty(incomplete.rows[0].fits, 'm4-max-64');
    expect(() => parseVoiceFitCatalog(incomplete)).toThrow();
    const duplicate = fresh();
    duplicate.rows.push(duplicate.rows[0]);
    expect(() => parseVoiceFitCatalog(duplicate)).toThrow(/Duplicate runtime/);
  });
});
