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
  managed_product_1: { metricsCol: "managed_product_1_pct", goalCol: "managed_product_1_target_pct" },
  managed_product_2: { metricsCol: "managed_product_2_pct", goalCol: "managed_product_2_target_pct" },
  managed_product_3: { metricsCol: "managed_product_3_pct", goalCol: "managed_product_3_target_pct" },
  profitability: { metricsCol: "profit_target", goalCol: "profit_target" },
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

  // Average ticket sources need special handling (income_sources + daily_income_breakdown)
  if (plan.data_source.startsWith("avg_ticket_")) {
    return resolveAvgTicketStatus(supabase, plan, year, month);
  }

  // Profitability needs special calculation from P&L data
  if (plan.data_source === "profitability") {
    return resolveProfitabilityStatus(supabase, plan, year, month);
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
 * Resolves average ticket for a specific income source (1st, 2nd, or 3rd by display_order).
 */
async function resolveAvgTicketStatus(
  supabase: SupabaseClient,
  plan: Pick<
    BonusPlan,
    | "business_id"
    | "data_source"
    | "is_lower_better"
    | "tier1_threshold" | "tier1_threshold_max" | "tier1_amount"
    | "tier2_threshold" | "tier2_threshold_max" | "tier2_amount"
    | "tier3_threshold" | "tier3_threshold_max" | "tier3_amount"
  >,
  year: number,
  month: number
): Promise<BonusPlanStatus> {
  const sourceIndex = parseInt(plan.data_source.replace("avg_ticket_", "")) - 1; // 0-based

  // Get income sources ordered by display_order
  const { data: sources } = await supabase
    .from("income_sources")
    .select("id")
    .eq("business_id", plan.business_id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("display_order")
    .range(sourceIndex, sourceIndex);

  if (!sources || sources.length === 0) {
    return { currentValue: null, goalValue: null, qualifiedTier: null, bonusAmount: 0 };
  }

  const sourceId = sources[0].id;
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  // Get daily entries for this month to find their IDs
  const { data: entries } = await supabase
    .from("daily_entries")
    .select("id")
    .eq("business_id", plan.business_id)
    .gte("entry_date", monthStart)
    .lt("entry_date", nextMonth)
    .is("deleted_at", null);

  let currentValue: number | null = null;

  if (entries && entries.length > 0) {
    const entryIds = entries.map((e: { id: string }) => e.id);
    // Get income breakdown for this source across all daily entries
    const { data: breakdowns } = await supabase
      .from("daily_income_breakdown")
      .select("amount, orders_count")
      .eq("income_source_id", sourceId)
      .in("daily_entry_id", entryIds);

    if (breakdowns && breakdowns.length > 0) {
      const totalAmount = breakdowns.reduce((sum: number, r: { amount: number }) => sum + Number(r.amount || 0), 0);
      const totalOrders = breakdowns.reduce((sum: number, r: { orders_count: number }) => sum + Number(r.orders_count || 0), 0);
      currentValue = totalOrders > 0 ? totalAmount / totalOrders : 0;
    }
  }

  // Get goal (avg_ticket_target from income_source_goals)
  const { data: goalData } = await supabase
    .from("income_source_goals")
    .select("avg_ticket_target")
    .eq("income_source_id", sourceId)
    .maybeSingle();

  const goalValue = goalData?.avg_ticket_target != null ? Number(goalData.avg_ticket_target) : null;

  if (currentValue === null) {
    return { currentValue: null, goalValue, qualifiedTier: null, bonusAmount: 0 };
  }

  const qualifiedTier = evaluateTier(plan, currentValue);
  const bonusAmount = qualifiedTier === 3 ? plan.tier3_amount : qualifiedTier === 2 ? plan.tier2_amount : qualifiedTier === 1 ? plan.tier1_amount : 0;
  return { currentValue, goalValue, qualifiedTier, bonusAmount };
}

/**
 * Resolves profitability from P&L calculation:
 * profit = income_before_vat - labor_cost - food_cost - current_expenses
 */
async function resolveProfitabilityStatus(
  supabase: SupabaseClient,
  plan: Pick<
    BonusPlan,
    | "business_id"
    | "data_source"
    | "is_lower_better"
    | "tier1_threshold" | "tier1_threshold_max" | "tier1_amount"
    | "tier2_threshold" | "tier2_threshold_max" | "tier2_amount"
    | "tier3_threshold" | "tier3_threshold_max" | "tier3_amount"
  >,
  year: number,
  month: number
): Promise<BonusPlanStatus> {
  const { data: metrics } = await supabase
    .from("business_monthly_metrics")
    .select("income_before_vat, labor_cost_amount, food_cost_amount, current_expenses_amount")
    .eq("business_id", plan.business_id)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (!metrics || metrics.income_before_vat == null) {
    return { currentValue: null, goalValue: null, qualifiedTier: null, bonusAmount: 0 };
  }

  const profit = Number(metrics.income_before_vat) - Number(metrics.labor_cost_amount || 0) - Number(metrics.food_cost_amount || 0) - Number(metrics.current_expenses_amount || 0);

  // Goal from goals table
  const { data: goal } = await supabase
    .from("goals")
    .select("profit_target")
    .eq("business_id", plan.business_id)
    .eq("year", year)
    .eq("month", month)
    .is("deleted_at", null)
    .maybeSingle();

  const goalValue = goal?.profit_target != null ? Number(goal.profit_target) : null;

  const qualifiedTier = evaluateTier(plan, profit);
  const bonusAmount = qualifiedTier === 3 ? plan.tier3_amount : qualifiedTier === 2 ? plan.tier2_amount : qualifiedTier === 1 ? plan.tier1_amount : 0;
  return { currentValue: profit, goalValue, qualifiedTier, bonusAmount };
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
