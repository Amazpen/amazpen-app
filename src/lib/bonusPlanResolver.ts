import type { SupabaseClient } from "@supabase/supabase-js";
import type { BonusPlan, BonusPlanStatus } from "@/types/bonus";

/**
 * Maps data_source values to the column names in business_monthly_metrics
 * and the corresponding goal column in goals table.
 */
const DATA_SOURCE_MAP: Record<
  string,
  { metricsCol: string; goalCol: string }
> = {
  labor_cost_pct: { metricsCol: "labor_cost_pct", goalCol: "labor_cost_target_pct" },
  food_cost_pct: { metricsCol: "food_cost_pct", goalCol: "food_cost_target_pct" },
  revenue: { metricsCol: "monthly_pace", goalCol: "revenue_target" },
  current_expenses: { metricsCol: "current_expenses_amount", goalCol: "current_expenses_target" },
  goods_expenses: { metricsCol: "food_cost_amount", goalCol: "goods_expenses_target" },
};

/**
 * Resolves the current bonus plan status for a given plan, year, and month.
 * Returns the current KPI value, goal value, qualified tier, and bonus amount.
 */
export async function resolveBonusPlanStatus(
  supabase: SupabaseClient,
  plan: Pick<
    BonusPlan,
    | "business_id"
    | "data_source"
    | "is_lower_better"
    | "tier1_threshold"
    | "tier1_threshold_max"
    | "tier1_amount"
    | "tier2_threshold"
    | "tier2_threshold_max"
    | "tier2_amount"
    | "tier3_threshold"
    | "tier3_threshold_max"
    | "tier3_amount"
  >,
  year: number,
  month: number
): Promise<BonusPlanStatus> {
  // Custom data sources can't be auto-resolved
  if (plan.data_source === "custom") {
    return { currentValue: null, goalValue: null, qualifiedTier: null, bonusAmount: 0 };
  }

  const mapping = DATA_SOURCE_MAP[plan.data_source];
  if (!mapping) {
    return { currentValue: null, goalValue: null, qualifiedTier: null, bonusAmount: 0 };
  }

  // Fetch current value from business_monthly_metrics
  const { data: metrics } = await supabase
    .from("business_monthly_metrics")
    .select(mapping.metricsCol)
    .eq("business_id", plan.business_id)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  // Fetch goal value
  const { data: goal } = await supabase
    .from("goals")
    .select(mapping.goalCol)
    .eq("business_id", plan.business_id)
    .eq("year", year)
    .eq("month", month)
    .is("deleted_at", null)
    .maybeSingle();

  const metricsRecord = metrics as Record<string, unknown> | null;
  const goalRecord = goal as Record<string, unknown> | null;

  const currentValue: number | null =
    metricsRecord?.[mapping.metricsCol] != null
      ? Number(metricsRecord[mapping.metricsCol])
      : null;

  const goalValue: number | null =
    goalRecord?.[mapping.goalCol] != null ? Number(goalRecord[mapping.goalCol]) : null;

  if (currentValue === null) {
    return { currentValue: null, goalValue, qualifiedTier: null, bonusAmount: 0 };
  }

  // Determine qualified tier
  const qualifiedTier = evaluateTier(plan, currentValue);
  const bonusAmount =
    qualifiedTier === 3
      ? plan.tier3_amount
      : qualifiedTier === 2
        ? plan.tier2_amount
        : qualifiedTier === 1
          ? plan.tier1_amount
          : 0;

  return { currentValue, goalValue, qualifiedTier, bonusAmount };
}

/**
 * Evaluates which tier the current value qualifies for.
 * Supports both single threshold and range (min-max) modes (#37).
 * Checks tier3 first (highest bonus), then tier2, then tier1.
 */
function evaluateTier(
  plan: Pick<
    BonusPlan,
    | "is_lower_better"
    | "tier1_threshold"
    | "tier1_threshold_max"
    | "tier2_threshold"
    | "tier2_threshold_max"
    | "tier3_threshold"
    | "tier3_threshold_max"
  >,
  value: number
): 1 | 2 | 3 | null {
  // Helper: check if value falls within a range, handling swapped min/max
  function inRange(val: number, a: number, b: number): boolean {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return val >= lo && val <= hi;
  }

  // Check if any tier uses range mode
  const hasRanges = plan.tier1_threshold_max != null || plan.tier2_threshold_max != null || plan.tier3_threshold_max != null;

  if (hasRanges) {
    // Range mode: value must fall within [threshold, threshold_max] (auto-normalizes swapped values)
    if (plan.tier3_threshold != null && plan.tier3_threshold_max != null && inRange(value, plan.tier3_threshold, plan.tier3_threshold_max)) return 3;
    if (plan.tier2_threshold != null && plan.tier2_threshold_max != null && inRange(value, plan.tier2_threshold, plan.tier2_threshold_max)) return 2;
    if (plan.tier1_threshold != null && plan.tier1_threshold_max != null && inRange(value, plan.tier1_threshold, plan.tier1_threshold_max)) return 1;
    // Fallback: if only min is set (no max), use single-threshold logic
    if (plan.is_lower_better) {
      if (plan.tier3_threshold != null && plan.tier3_threshold_max == null && value <= plan.tier3_threshold) return 3;
      if (plan.tier2_threshold != null && plan.tier2_threshold_max == null && value <= plan.tier2_threshold) return 2;
      if (plan.tier1_threshold != null && plan.tier1_threshold_max == null && value <= plan.tier1_threshold) return 1;
    } else {
      if (plan.tier3_threshold != null && plan.tier3_threshold_max == null && value >= plan.tier3_threshold) return 3;
      if (plan.tier2_threshold != null && plan.tier2_threshold_max == null && value >= plan.tier2_threshold) return 2;
      if (plan.tier1_threshold != null && plan.tier1_threshold_max == null && value >= plan.tier1_threshold) return 1;
    }
  } else {
    // Original single-threshold mode
    if (plan.is_lower_better) {
      if (plan.tier3_threshold != null && value <= plan.tier3_threshold) return 3;
      if (plan.tier2_threshold != null && value <= plan.tier2_threshold) return 2;
      if (plan.tier1_threshold != null && value <= plan.tier1_threshold) return 1;
    } else {
      if (plan.tier3_threshold != null && value >= plan.tier3_threshold) return 3;
      if (plan.tier2_threshold != null && value >= plan.tier2_threshold) return 2;
      if (plan.tier1_threshold != null && value >= plan.tier1_threshold) return 1;
    }
  }
  return null;
}
