import { categoryComparison, comparisonValue, comparisonCategoryLabel, comparisonTestLabel, defaultCategoryTest, type ComparisonCohort } from './benchmark-comparisons';
import {
  CATEGORY_DEFINITIONS,
  dedupeModelsBySlug,
  type LeaderboardModel,
} from './leaderboard';
import { computeHardwareFit, type HardwareFitResult, type HardwareSpec } from './hardware';

export type HardwareRankedModel = LeaderboardModel & {
  hwFit: HardwareFitResult | null;
};

export function fitHardwareModels(models: LeaderboardModel[], spec: HardwareSpec): HardwareRankedModel[] {
  // Catalog IDs distinguish products and releases (for example Command R/R+).
  // Fit annotations must not regenerate identity from the display name.
  return dedupeModelsBySlug(models.map((model) => ({
    ...model,
    hwFit: computeHardwareFit(model, spec),
  })));
}

export interface HardwareCategoryRecommendation {
  key: (typeof CATEGORY_DEFINITIONS)[number]['key'];
  label: string;
  desc: string;
  benchmarks: readonly string[];
  color: string;
  model: HardwareRankedModel | null;
  score: number;
  coverage: number;
  qualified: boolean;
}

export function isHardwareRunnable(model: HardwareRankedModel): boolean {
  const fit = model.hwFit;
  return !!fit && fit.fit !== 'too-large' && !fit.usesOffload
    && fit.memoryRequiredGb <= fit.availableMemoryGb;
}

export function openWeightModels<T extends Pick<LeaderboardModel, 'closed_source'>>(models: T[]): T[] {
  return models.filter((model) => !model.closed_source);
}

export function buildCategoryHardwareRecommendations(
  models: HardwareRankedModel[],
  scoringPool: LeaderboardModel[] = models
): HardwareCategoryRecommendation[] {
  const runnable = models.filter(isHardwareRunnable);

  return CATEGORY_DEFINITIONS.map((category) => {
    const cohort = categoryComparison(scoringPool, category.key);
    const best = [...runnable]
      .filter((model) => comparisonValue(model, cohort) !== null)
      .sort((a, b) => compareHardwareModelsForCategory(a, b, category.key, category.benchmarks, scoringPool, cohort))[0] ?? null;

    if (best) {
      const coverage = 1;
      return {
        ...category,
        label: comparisonCategoryLabel(category.key),
        desc: comparisonTestLabel(defaultCategoryTest(category.key)),
        benchmarks: [defaultCategoryTest(category.key)],
        model: best,
        score: comparisonValue(best, cohort) ?? -1,
        coverage,
        qualified: true,
      };
    }

    return {
      ...category,
      label: comparisonCategoryLabel(category.key),
      desc: comparisonTestLabel(defaultCategoryTest(category.key)),
      benchmarks: [defaultCategoryTest(category.key)],
      model: null,
      score: -1,
      coverage: 0,
      qualified: false,
    };
  });
}

export function compareHardwareModelsForCategory(
  a: HardwareRankedModel,
  b: HardwareRankedModel,
  categoryKey: string,
  benchmarkKeys: readonly string[],
  scoringPool: LeaderboardModel[],
  cohort: ComparisonCohort | null = categoryComparison(scoringPool, categoryKey),
): number {
  void benchmarkKeys;
  const aScore = comparisonValue(a, cohort);
  const bScore = comparisonValue(b, cohort);
  if (aScore === null && bScore !== null) return 1;
  if (aScore !== null && bScore === null) return -1;
  if (aScore !== null && bScore !== null && aScore !== bScore) return bScore - aScore;

  return a.name.localeCompare(b.name);
}

export function compareHardwareModelsByBenchmark(
  a: HardwareRankedModel,
  b: HardwareRankedModel,
  benchmarkKey: string,
  direction: 'asc' | 'desc' = 'desc',
  cohort?: ComparisonCohort | null,
): number {
  const aValue = cohort ? comparisonValue(a, cohort) : a.benchmarks[benchmarkKey] ?? null;
  const bValue = cohort ? comparisonValue(b, cohort) : b.benchmarks[benchmarkKey] ?? null;
  if (aValue === null && bValue !== null) return 1;
  if (aValue !== null && bValue === null) return -1;
  if (aValue !== null && bValue !== null && aValue !== bValue) {
    return direction === 'desc' ? bValue - aValue : aValue - bValue;
  }

  return a.name.localeCompare(b.name);
}
