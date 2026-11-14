import { LIVEBENCH2_METRICS } from './livebench-v2';

export interface BenchmarkColumn {
  key: string;
  label: string;
  tooltip: string;
  isElo?: boolean;
  primary?: boolean;
}

/**
 * One shared inventory for every sortable benchmark column in the product.
 *
 * Keeping the dashboard and Hardware page on separate hand-written lists hid
 * 18 collected benchmarks from one or both views. A benchmark that informs a
 * score must also be inspectable and independently sortable by the user.
 */
export const BENCHMARK_COLUMNS: BenchmarkColumn[] = [
  ...Object.entries(LIVEBENCH2_METRICS).map(([key, suite]) => ({
    key: 'livebench2_' + key, label: 'LB2 ' + suite, tooltip: 'LiveBench 2.0 · ' + suite + (key === 'overall' ? ' · weighted by this edition’s published suite weights, complete runs only.' : ' · evaluator-reported suite score.'),
  })),
  { key: 'livebench_global', label: 'LB Global', tooltip: 'LiveBench Global Average — a common-harness aggregate across the published LiveBench tasks.', primary: true },
  { key: 'livebench_coding', label: 'LB Code', tooltip: 'LiveBench Coding Average — code generation and completion tasks.', primary: true },
  { key: 'livebench_reasoning', label: 'LB Reason', tooltip: 'LiveBench Reasoning Average — logic, spatial reasoning, and related tasks.', primary: true },
  { key: 'livebench_mathematics', label: 'LB Math', tooltip: 'LiveBench Mathematics Average — competition math, integrals, and olympiad-style tasks.', primary: true },
  { key: 'livebench_agentic_coding', label: 'LB Agent', tooltip: 'LiveBench Agentic Coding — real-world JS, TS, and Python tasks.', primary: true },
  { key: 'livebench_data_analysis', label: 'LB Data', tooltip: 'LiveBench Data Analysis — data interpretation and analysis tasks.' },
  { key: 'livebench_language', label: 'LB Lang', tooltip: 'LiveBench Language — language understanding and generation tasks.' },
  { key: 'livebench_if', label: 'LB IF', tooltip: 'LiveBench Instruction Following — constraint and instruction adherence tasks.' },

  { key: 'swe_bench', label: 'SWE-bench', tooltip: 'SWE-bench Verified — real GitHub issue resolution. Results are scaffold-dependent.' },
  { key: 'swe_bench_pro', label: 'SWE-Pro', tooltip: 'SWE-bench Pro — a harder software-engineering benchmark. Results are scaffold-dependent.' },
  { key: 'deepswe', label: 'DeepSWE', tooltip: 'DeepSWE — software-engineering issue resolution under its published harness.' },
  { key: 'terminal_bench_4', label: 'Terminal 4.0', tooltip: 'Terminal-Bench 4.0. Only this edition enters the agentic index; harnesses still vary.' },
  { key: 'terminal_bench_3', label: 'Terminal 3.0', tooltip: 'Terminal-Bench 3.0, display-only. Different editions are not comparable.' },
  { key: 'terminal_bench_2_1', label: 'Terminal 2.1', tooltip: 'Terminal-Bench 2.1, display-only. Different editions are not comparable.' },
  { key: 'terminal_bench_2', label: 'Terminal 2.0', tooltip: 'Terminal-Bench 2.0, display-only. Different editions are not comparable.' },
  { key: 'terminal_bench', label: 'Terminal unspecified', tooltip: 'Legacy result without an established edition. Display-only.' },
  { key: 'mcp_atlas', label: 'MCP Atlas', tooltip: 'MCP Atlas — tool-use tasks involving Model Context Protocol servers.' },
  { key: 'toolathlon', label: 'Toolathlon', tooltip: 'Toolathlon — multi-tool agent benchmark.' },
  { key: 'browsecomp', label: 'BrowseComp', tooltip: 'BrowseComp — difficult information-seeking and browsing tasks.' },
  { key: 'bfcl', label: 'BFCL', tooltip: 'Berkeley Function-Calling Leaderboard — function selection and argument generation.' },
  { key: 'ifeval', label: 'IFEval', tooltip: 'Instruction Following Eval — adherence to verifiable prompt constraints.' },

  { key: 'gpqa_diamond', label: 'GPQA', tooltip: 'GPQA Diamond — graduate-level science questions. Often vendor-reported under different prompting conditions.' },
  { key: 'hle_no_tools', label: 'HLE No Tools', tooltip: 'Humanity’s Last Exam without tools. This is the HLE variant used in the reasoning composite.' },
  { key: 'hle_tools', label: 'HLE + Tools', tooltip: 'Humanity’s Last Exam with tools. This measures a model-plus-tool system and is not merged with no-tools HLE.' },
  { key: 'hle_no_tools_text', label: 'HLE Text No Tools', tooltip: 'Text-only subset of HLE without tools; display-only, separate from full HLE.' },
  { key: 'hle_tools_text', label: 'HLE Text + Tools', tooltip: 'Text-only subset of HLE with tools; display-only.' },
  { key: 'hle_verified', label: 'HLE Verified', tooltip: 'HLE Verified; display-only, separate from the original task set.' },
  { key: 'hle', label: 'HLE Unspecified', tooltip: 'Humanity’s Last Exam where the source does not identify tool use. Visible for transparency, excluded from the composite.' },
  { key: 'mmlu_pro', label: 'MMLU-Pro', tooltip: 'MMLU-Pro — advanced knowledge questions in a harder ten-option format.' },
  { key: 'arc_agi', label: 'ARC-AGI', tooltip: 'ARC-AGI — abstract reasoning tasks.' },
  { key: 'simpleqa', label: 'SimpleQA', tooltip: 'SimpleQA — display-only. Tool/search conditions are not consistently established; these values are not a comparable closed-book ranking.' },
  { key: 'frontier_math', label: 'FrontierMath', tooltip: 'FrontierMath — display-only. Tier and task-set editions are not consistently established; inspect the original scorecard before comparing.' },

  { key: 'aime_2026', label: 'AIME 2026', tooltip: 'AIME 2026. Kept separate from AIME 2025 so different test years are never presented as one leaderboard.' },
  { key: 'aime_2025', label: 'AIME 2025', tooltip: 'AIME 2025. Kept separate from AIME 2026 so different test years are never presented as one leaderboard.' },
  { key: 'math_500', label: 'MATH-500', tooltip: 'MATH-500 — 500 competition-style math problems.' },
  { key: 'mgsm', label: 'MGSM', tooltip: 'MGSM — multilingual grade-school mathematics.' },

  { key: 'livecodebench', label: 'LiveCode v6', tooltip: 'LiveCodeBench v6 — competitive-programming problems. Kept separate from LiveCodeBench Pro.' },
  { key: 'livecodebench_pro', label: 'LiveCode Pro', tooltip: 'LiveCodeBench Pro, display-only. Not interchangeable with LiveCodeBench v6.' },
  { key: 'humaneval', label: 'HumanEval', tooltip: 'HumanEval — a small, older code-generation benchmark that is saturated for many modern models.' },
  { key: 'codeforces_elo', label: 'Codeforces', tooltip: 'Codeforces-style competitive-programming rating.', isElo: true },
  { key: 'code_arena', label: 'Code Arena', tooltip: 'LLM Stats coding arena — human preference votes on generated coding artifacts.', isElo: true },
  { key: 'arena_elo', label: 'Arena Chat', tooltip: 'LMArena blind human chat-preference rating. It measures preference, not local runtime efficiency.', isElo: true },
];

export function benchmarkColumnFor(key: string): BenchmarkColumn | undefined {
  return BENCHMARK_COLUMNS.find((column) => column.key === key);
}

export function benchmarkSourceKind(sourceId?: string): string {
  if (sourceId === 'fallback') return 'uncited archive';
  if (['livebench2', 'livebench', 'swebench', 'terminalbench', 'bfcl', 'artificialanalysis'].includes(sourceId ?? '')) return 'evaluator-reported';
  if (['lmarena', 'codearena'].includes(sourceId ?? '')) return 'preference rating';
  return 'vendor / aggregator report';
}

/** Attribution summary, never presented as independent verification. */
export function benchmarkProvenanceLabel(model: { benchmark_sources?: Record<string, Array<{ source_id?: string; source_name: string; value: number; is_fallback?: boolean; selected?: boolean; data_date?: string | null }>> }, key: string): string {
  const rows = model.benchmark_sources?.[key] ?? [];
  return rows.length ? rows.map((row) => `${row.source_name}: ${row.value}${row.selected ? " (selected)" : ""}; ${benchmarkSourceKind(row.source_id)}${row.data_date ? `; dataset date ${row.data_date}` : '; evaluation date unknown'}`).join(' | ') : 'No source attribution available';
}
