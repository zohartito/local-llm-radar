import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCategoryKey } from '../src/lib/leaderboard';
import {
  loadVideoFitCatalog,
  parseVideoFitCatalog,
  VIDEO_FIT_ROUTE,
  type VideoFitCatalog,
} from '../src/lib/video-fit';

const INT_MM_ERROR =
  "NotImplementedError: The operator 'aten::_int_mm' is not currently implemented\nfor the MPS device.";

describe('video fit catalog', () => {
  const catalog = loadVideoFitCatalog();

  test('lives on /video, not the category catch-all', () => {
    expect(VIDEO_FIT_ROUTE).toBe('/video');
    expect(resolveCategoryKey('video')).toBe('overall');
  });

  test('seeds two weight builds and never invents a quality score', () => {
    expect(catalog.rows.map((row) => row.id)).toEqual([
      'ltx-2.5-int8-convrot',
      'minimax-h3-int8-convrot',
    ]);
    for (const row of catalog.rows) {
      expect(row).not.toHaveProperty('composite_score');
      expect(row).not.toHaveProperty('tier');
      expect(row).not.toHaveProperty('quality_score');
    }
  });

  test('LTX-2.5 int8-convrot on M4 Max MPS is a measured no with the verbatim kernel error', () => {
    const ltx = catalog.rows[0];
    expect(ltx.model).toBe('LTX-2.5');
    expect(ltx.weight_build).toBe('int8-convrot');
    expect(ltx.total_download_gb).toEqual(
      expect.objectContaining({ value: 47, provenance: 'measurement' })
    );
    const mps = ltx.runs['mps-64gb'];
    expect(mps.status).toBe('no');
    expect(mps.provenance).toBe('measurement');
    expect(mps.failure?.error_verbatim).toBe(INT_MM_ERROR);
    expect(mps.failure?.diffusion_steps_executed).toBe(0);
    expect(mps.failure?.wall_clock_s).toBe(242.59);
    expect(ltx.vram.measured_peak).toEqual(
      expect.objectContaining({
        value_gb: 33.9,
        of_gb: 34.8,
        what: 'swap',
        provenance: 'measurement',
      })
    );
  });

  test('LTX vendor throughput names two GB200s in the same cell', () => {
    const claim = catalog.rows[0].throughput.find((cell) => cell.provenance === 'vendor_claim');
    expect(claim).toEqual(
      expect.objectContaining({
        hardware: 'two NVIDIA GB200s',
        compute_seconds: 6.8,
        output_seconds: 10,
        compute_seconds_per_output_second: 0.68,
      })
    );
  });

  test('MiniMax-H3 is license-gated for a US operator and was not run', () => {
    const h3 = catalog.rows[1];
    expect(h3.model).toBe('MiniMax-H3');
    expect(h3.license.status).toBe('us-excluded');
    expect(h3.license.separate_authorization_required).toBe(true);
    expect(h3.runs['cuda-16gb'].status).toBe('unmeasured');
    expect(h3.runs['cuda-16gb'].provenance).toBe('unmeasured');
    expect(h3.runs['mps-64gb'].status).toBe('no');
    expect(h3.runs['mps-64gb'].provenance).toBe('prediction');
    expect(h3.throughput.every((cell) => cell.compute_seconds_per_output_second == null)).toBe(true);
  });

  test('rejects a vendor throughput cell that omits the hardware', () => {
    const raw = JSON.parse(
      readFileSync(path.join(process.cwd(), 'data', 'video-fit.json'), 'utf8')
    ) as VideoFitCatalog;
    raw.rows[0].throughput[0].hardware = '';
    expect(() => parseVideoFitCatalog(raw)).toThrow(/missing hardware/);
  });
});
