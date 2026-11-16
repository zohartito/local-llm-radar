/**
 * Measure one Ollama model on the machine running this script.
 *
 *   npx tsx scripts/measure-local.ts --model qwen3-vl:8b --machine m4-max-64gb
 *
 * Records load time, prompt-processing and generation tokens/s, peak memory,
 * quantisation and context, plus this machine's specs, and writes one JSON file
 * to datasets/local-measurements/ (CC BY 4.0). Run it ON the machine being
 * measured: specs and process memory are read locally. Hostnames are never
 * recorded; `--machine` is the only label.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCHEMA = 'local-llm-radar/local-measurement@1';

interface Options {
  model: string;
  machine: string;
  host: string;
  runs: number;
  ctx: number;
  promptTokens: number;
  genTokens: number;
  think: boolean | null;
  outDir: string;
  remote: boolean;
}

interface GenerateResponse {
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  error?: string;
}

interface PsModel { name: string; model: string; size: number; size_vram: number; context_length?: number }

function parseArgs(argv: string[]): Options {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument ${key}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args.set(key.slice(2), 'true');
    else { args.set(key.slice(2), next); i++; }
  }
  const model = args.get('model');
  if (!model) throw new Error('--model is required (see `ollama list`)');
  const host = (args.get('host') ?? process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  const int = (name: string, fallback: number) => {
    const value = Number(args.get(name) ?? fallback);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer`);
    return value;
  };
  const machine = args.get('machine') ?? 'unnamed';
  if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(machine)) throw new Error('--machine must be a short lowercase label, e.g. rtx-a6000-48gb');
  return {
    model, machine, host: /^https?:\/\//.test(host) ? host : `http://${host}`,
    runs: int('runs', 3), ctx: int('ctx', 4096), promptTokens: int('prompt-tokens', 1024), genTokens: int('gen-tokens', 256),
    think: args.has('think') ? args.get('think') !== 'false' : null,
    outDir: args.get('out') ?? path.join('datasets', 'local-measurements'),
    remote: args.get('remote') === 'true',
  };
}

async function api<T>(host: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${host}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15 * 60_000),
  });
  const json = await response.json() as T & { error?: string };
  if (!response.ok || json.error) throw new Error(`Ollama ${route}: ${json.error ?? response.status}`);
  return json;
}

function run(command: string, args: string[]): string | null {
  try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim(); } catch { return null; }
}

function nvidiaGpus() {
  const out = run('nvidia-smi', ['--query-gpu=index,name,memory.total,memory.used,driver_version', '--format=csv,noheader,nounits']);
  if (!out) return null;
  return out.split(/\r?\n/).map(line => {
    const [index, name, total, used, driver] = line.split(',').map(s => s.trim());
    return { index: Number(index), name, memoryTotalMiB: Number(total), memoryUsedMiB: Number(used), driver };
  });
}

function machineSpecs() {
  const gpus = nvidiaGpus();
  const appleChip = process.platform === 'darwin' ? run('sysctl', ['-n', 'machdep.cpu.brand_string']) : null;
  return {
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpu: appleChip ?? os.cpus()[0]?.model ?? null,
    cpuThreads: os.cpus().length,
    memoryGiB: Math.round(os.totalmem() / 2 ** 30),
    unifiedMemory: process.platform === 'darwin' && os.arch() === 'arm64',
    gpus: gpus?.map(({ index, name, memoryTotalMiB, driver }) => ({ index, name, memoryTotalMiB, driver })) ?? [],
  };
}

/** Resident memory of the runner process serving this model's blob (macOS/Linux), in MiB. */
function runnerRssMiB(blobDigest: string | null): number | null {
  if (process.platform === 'win32' || !blobDigest) return null;
  const out = run('ps', ['-axww', '-o', 'rss=,args=']);
  if (!out) return null;
  let kib = 0;
  for (const line of out.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (match && match[2].includes(blobDigest)) kib += Number(match[1]);
  }
  return kib ? Math.round(kib / 1024) : null;
}

/** Sample memory until stopped; returns peaks. */
function startSampler(opts: Options, blobDigest: string | null) {
  const peak = { ollamaReportedMiB: 0, ollamaReportedVramMiB: 0, processRssMiB: null as number | null, gpuUsedMiB: null as number[] | null, contextLength: null as number | null };
  const baseline = opts.remote ? null : nvidiaGpus()?.map(g => g.memoryUsedMiB) ?? null;
  let stopped = false;
  const tick = async () => {
    while (!stopped) {
      try {
        const ps = await api<{ models: PsModel[] }>(opts.host, '/api/ps');
        const loaded = ps.models.find(m => m.name === opts.model || m.model === opts.model);
        if (loaded) {
          peak.ollamaReportedMiB = Math.max(peak.ollamaReportedMiB, Math.round(loaded.size / 2 ** 20));
          peak.ollamaReportedVramMiB = Math.max(peak.ollamaReportedVramMiB, Math.round(loaded.size_vram / 2 ** 20));
          if (loaded.context_length) peak.contextLength = loaded.context_length;
        }
      } catch { /* sampling is best effort */ }
      if (!opts.remote) {
        const rss = runnerRssMiB(blobDigest);
        if (rss !== null) peak.processRssMiB = Math.max(peak.processRssMiB ?? 0, rss);
        const used = nvidiaGpus()?.map(g => g.memoryUsedMiB);
        if (used) peak.gpuUsedMiB = used.map((value, i) => Math.max(peak.gpuUsedMiB?.[i] ?? 0, value));
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  };
  const loop = tick();
  return async () => {
    stopped = true;
    await loop;
    return {
      ...peak,
      gpuUsedAboveBaselineMiB: peak.gpuUsedMiB && baseline ? peak.gpuUsedMiB.map((value, i) => value - (baseline[i] ?? 0)) : null,
    };
  };
}

/** Deterministic filler text; a per-run nonce at the start defeats prompt caching. */
function prompt(runIndex: number, approxTokens: number): string {
  const sentence = 'The survey team measured each beam, column and slab, then logged the span, depth and load in the site notebook. ';
  const words = sentence.split(' ').length;
  const repeats = Math.max(1, Math.round((approxTokens * 0.75) / words));
  return `Run ${runIndex} ${Date.now()}.\n${sentence.repeat(repeats)}\nSummarise the notes above in a long, detailed paragraph.`;
}

const tokensPerSecond = (count?: number, ns?: number) => (count && ns ? Number((count / (ns / 1e9)).toFixed(2)) : null);
const ms = (ns?: number) => (ns === undefined ? null : Math.round(ns / 1e6));
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(opts.host);
  if (!local && !opts.remote) {
    throw new Error('Host is not local. Run this script on the machine being measured, or pass --remote to record Ollama-reported numbers without machine specs.');
  }
  const version = await api<{ version: string }>(opts.host, '/api/version');
  const show = await api<{ details?: Record<string, unknown>; model_info?: Record<string, unknown>; modelfile?: string }>(opts.host, '/api/show', { model: opts.model });
  // The runner process is started with the model blob path; match it to find its memory.
  const blobDigest = show.modelfile?.match(/^FROM\s+.*?(sha256-[0-9a-f]{64})\s*$/m)?.[1] ?? null;
  const architecture = String(show.model_info?.['general.architecture'] ?? '');
  const maxContext = show.model_info?.[`${architecture}.context_length`];

  // Unload first so run 1 includes a cold load.
  await api(opts.host, '/api/generate', { model: opts.model, keep_alive: 0 });
  await new Promise(resolve => setTimeout(resolve, 1000));

  const stop = startSampler(opts, blobDigest);
  const runs = [];
  for (let i = 1; i <= opts.runs; i++) {
    const result = await api<GenerateResponse>(opts.host, '/api/generate', {
      model: opts.model, prompt: prompt(i, opts.promptTokens), stream: false, keep_alive: '5m',
      ...(opts.think === null ? {} : { think: opts.think }),
      options: { num_ctx: opts.ctx, num_predict: opts.genTokens, temperature: 0, seed: 42 },
    });
    const row = {
      run: i,
      loadMs: ms(result.load_duration),
      totalMs: ms(result.total_duration),
      promptTokens: result.prompt_eval_count ?? null,
      promptTokensPerSecond: tokensPerSecond(result.prompt_eval_count, result.prompt_eval_duration),
      generatedTokens: result.eval_count ?? null,
      generationTokensPerSecond: tokensPerSecond(result.eval_count, result.eval_duration),
    };
    console.log(JSON.stringify(row));
    runs.push(row);
  }
  const peaks = await stop();
  await api(opts.host, '/api/generate', { model: opts.model, keep_alive: 0 });

  const warm = runs.slice(1);
  const measuredAt = new Date().toISOString();
  const record = {
    schema: SCHEMA,
    licence: 'CC-BY-4.0',
    measuredAt,
    machine: { label: opts.machine, specs: local ? machineSpecs() : null },
    runtime: { name: 'ollama', version: version.version, remote: !local },
    model: {
      name: opts.model,
      family: show.details?.family ?? null,
      parameterSize: show.details?.parameter_size ?? null,
      quantization: show.details?.quantization_level ?? null,
      format: show.details?.format ?? null,
      maxContext: typeof maxContext === 'number' ? maxContext : null,
    },
    workload: {
      requestedContext: opts.ctx, loadedContext: peaks.contextLength,
      approxPromptTokens: opts.promptTokens, maxGeneratedTokens: opts.genTokens,
      temperature: 0, seed: 42, think: opts.think, runs: opts.runs,
      note: 'Run 1 starts with the model unloaded from Ollama (the OS file cache may still hold the weights). Prompts differ per run so prompt processing is not served from cache. Medians use runs 2+.',
    },
    summary: {
      coldLoadMs: runs[0]?.loadMs ?? null,
      promptTokensPerSecondMedian: median((warm.length ? warm : runs).map(r => r.promptTokensPerSecond).filter((v): v is number => v !== null)),
      generationTokensPerSecondMedian: median((warm.length ? warm : runs).map(r => r.generationTokensPerSecond).filter((v): v is number => v !== null)),
      peakMemory: {
        ollamaReportedMiB: peaks.ollamaReportedMiB || null,
        ollamaReportedVramMiB: peaks.ollamaReportedVramMiB || null,
        runnerProcessRssMiB: peaks.processRssMiB,
        gpuUsedAboveBaselineMiB: peaks.gpuUsedAboveBaselineMiB,
        method: 'Sampled every 250 ms: Ollama /api/ps size and size_vram; ps RSS of the runner process serving this model blob (macOS/Linux); nvidia-smi memory.used minus the pre-run baseline (NVIDIA). Peaks between samples can be missed.',
      },
    },
    runs,
  };
  mkdirSync(opts.outDir, { recursive: true });
  const slug = opts.model.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
  const runDirectory = mkdtempSync(path.join(opts.outDir, `${measuredAt.replace(/[:.]/g, '-')}_${opts.machine}_${slug}_`));
  const file = path.join(runDirectory, 'measurement.json');
  // Exclusive creation refuses existing files and symlinks, including dangling ones.
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Wrote ${file}`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
