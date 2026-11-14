import {
  buildHardwareRecommendations,
  computeHardwareFit,
  getQuantMemoryTargets,
  primaryGpuOnlySpec,
  summarizeHardwareSpec,
  type HardwareSpec,
} from '../src/lib/hardware';

describe('hardware helpers', () => {
  test('models multi-GPU VRAM with small tensor-splitting overhead', () => {
    const spec: HardwareSpec = {
      platform: 'pc',
      systemRamGb: 128,
      unifiedMemoryGb: 0,
      cpuCores: 16,
      gpus: [
        { label: 'RTX 4090', vramGb: 24 },
        { label: 'RTX 4090', vramGb: 24 },
      ],
    };

    const fit = computeHardwareFit(
      { name: 'Big Model', params_b: 70, vram_int4_gb: 40, vram_fp16_gb: 142 },
      spec
    );

    expect(fit).toEqual(
      expect.objectContaining({
        fit: 'borderline',
        bestQuant: 'Q4',
        availableMemoryGb: 43.2,
      })
    );
    expect(summarizeHardwareSpec(spec)).toContain('43.2GB usable VRAM');
  });

  test('4070 Ti SUPER plus A6000 unlocks a clean 70B Q4 fit', () => {
    const dualSpec: HardwareSpec = {
      platform: 'pc',
      systemRamGb: 128,
      unifiedMemoryGb: 0,
      cpuCores: 8,
      gpus: [
        { label: 'RTX 4070 Ti SUPER (16GB)', vramGb: 16 },
        { label: 'A6000 (48GB)', vramGb: 48 },
      ],
    };
    const singleSpec = primaryGpuOnlySpec(dualSpec);
    const model = { name: '70B Model', params_b: 70, vram_int4_gb: 40, vram_fp16_gb: 142 };

    expect(singleSpec).not.toBeNull();
    expect(computeHardwareFit(model, singleSpec!)).toEqual(
      expect.objectContaining({ fit: 'borderline', bestQuant: 'Q4 + offload', availableMemoryGb: 16 })
    );
    expect(computeHardwareFit(model, dualSpec)).toEqual(
      expect.objectContaining({ fit: 'fits-well', bestQuant: 'Q4', availableMemoryGb: 57.6 })
    );
    expect(summarizeHardwareSpec(dualSpec)).toContain('16 + 48GB = 64GB installed');
    expect(summarizeHardwareSpec(dualSpec)).toContain('system RAM is offload only');
  });

  test('uses an architecture-aware footprint for Qwen3.8 Flash Next', () => {
    const model = {
      name: 'Qwen3.8-Flash-Next',
      params_b: 125,
      vram_int4_gb: 71,
      vram_fp16_gb: 252,
    };
    const spec: HardwareSpec = {
      platform: 'pc',
      systemRamGb: 128,
      unifiedMemoryGb: 0,
      gpus: [
        { label: 'RTX 4070 Ti SUPER', vramGb: 16 },
        { label: 'A6000', vramGb: 48 },
      ],
    };

    expect(getQuantMemoryTargets(model)).toEqual(expect.objectContaining({ q4: 101 }));
    expect(computeHardwareFit(model, spec)).toEqual(expect.objectContaining({
      fit: 'too-large',
      bestQuant: '—',
      memoryRequiredGb: 101,
    }));
  });

  test('flags CPU-only runs as borderline when RAM is enough but acceleration is missing', () => {
    const fit = computeHardwareFit(
      { name: 'Mid Model', params_b: 14, vram_int4_gb: 10, vram_fp16_gb: 30 },
      {
        platform: 'cpu',
        systemRamGb: 32,
        unifiedMemoryGb: 0,
        cpuCores: 12,
        gpus: [],
      }
    );

    expect(fit).toEqual(
      expect.objectContaining({
        fit: 'borderline',
        bestQuant: 'Q8',
        memoryType: 'RAM',
      })
    );
  });

  test('builds practical minimum, comfortable, and full-quality setup targets', () => {
    const recommendations = buildHardwareRecommendations({
      name: 'Gemma 4 31B',
      params_b: 30.7,
      vram_int4_gb: 19,
      vram_fp16_gb: 63,
    });

    expect(recommendations.map((entry) => entry.key)).toEqual([
      'minimum',
      'comfortable',
      'full-quality',
    ]);
    expect(recommendations[0]).toEqual(
      expect.objectContaining({
        quant: 'Q4',
        gpuPlan: '1x 24GB GPU',
      })
    );
    expect(recommendations[1].unifiedMemoryGb).toBeGreaterThanOrEqual(48);
  });
});
