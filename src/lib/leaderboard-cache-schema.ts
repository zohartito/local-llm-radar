import { z } from 'zod';
import type { LeaderboardData } from './leaderboard';

const finite = z.number().finite();
const nullableNumber = finite.nonnegative().nullable();
const numericMap = z.record(z.string(), finite);
const observation = z.object({
  source_id: z.string(), source_name: z.string(), model_name: z.string(), effort: z.string().optional(), value: finite,
  is_fallback: z.boolean().optional(), selected: z.boolean().optional(),
  data_date: z.string().nullable().optional(),
});

// Validate the fields used by rendering and ranking before an external cache
// blob enters either path. Unknown additive fields remain compatible.
const model = z.object({
  name: z.string().min(1), provider: z.string(), slug: z.string().min(1),
  slug_aliases: z.array(z.string()).optional(), llm_stats_model_id: z.string().nullable(),
  params_b: nullableNumber, context_k: nullableNumber, license: z.string().nullable(),
  tier: z.string(), vram_int4_gb: nullableNumber, vram_fp16_gb: nullableNumber,
  vision: z.boolean(), moe_active_b: nullableNumber, release: z.string().nullable(),
  closed_source: z.boolean(), weight_status: z.enum(['open', 'closed', 'unknown']).optional(),
  benchmarks: z.record(z.string(), finite.nullable()),
  source_count: z.record(z.string(), finite.int().nonnegative()),
  benchmark_sources: z.record(z.string(), z.array(observation)),
  benchmark_coverage: finite.int().nonnegative(),
  input_price_per_m: nullableNumber, output_price_per_m: nullableNumber,
  effort_variants: z.array(z.object({ variant_name: z.string(), effort: z.string(),
    livebench_global: nullableNumber, livebench_coding: nullableNumber,
    livebench_reasoning: nullableNumber, run_cost_usd: nullableNumber,
  })),
  best_effort: z.string().nullable(), composite_score: finite.min(0).max(100),
  confidence: finite.min(0).max(1), coverage: finite.min(0).max(1),
  rank_status: z.enum(['ranked', 'provisional', 'insufficient_evidence']),
  family_coverage: finite.min(0).max(1),
  metadata_sources: z.record(z.string(), z.array(z.object({
    source_id: z.string(), value: z.union([z.string(), finite, z.boolean()]),
    selected: z.boolean(), is_fallback: z.boolean().optional(), source_url: z.string().optional(),
  }))).optional(),
});
const payload = z.object({
  models: z.array(model),
  sources: z.array(z.object({
    id: z.string(), name: z.string(), url: z.string(), count: finite.int().nonnegative(),
    duration_ms: finite.nonnegative(), fetched_at: z.string(), error: z.string().optional(),
    status: z.enum(['ok', 'degraded', 'error']).optional(),
  })),
  updated: z.string().refine(value => Number.isFinite(Date.parse(value))),
  scoringVersion: z.string().optional(), usedFallback: z.boolean().optional(),
  stale: z.boolean().optional(), dataDate: z.string().nullable().optional(),
  dataSourceLabel: z.enum(['live', 'partial', 'fallback']).optional(),
  degradedSources: z.array(z.string()).optional(),
});

export function isValidCachedLeaderboard(value: unknown): value is LeaderboardData {
  return payload.safeParse(value).success;
}

export function isValidRankMap(value: unknown): value is Record<string, number> {
  return numericMap.superRefine((map, context) => {
    for (const [slug, rank] of Object.entries(map)) {
      if (!Number.isSafeInteger(rank) || rank < 1) context.addIssue({ code: 'custom', message: 'Invalid rank', path: [slug] });
    }
  }).safeParse(value).success;
}
