import type { SupabaseClient } from "@supabase/supabase-js";
import type { BonusPlan, BonusPlanStatus } from "@/types/bonus";

/**
 * Compute remaining factor-weighted work days from today (inclusive) to end
 * of month, using business_schedule (day_factor per day-of-week) and any
 * exceptions (holidays, special closures) for the period.
 * David #9: "כמה צריך למכור היום" — needs an honest "remaining days".
 */
async function getRemainingWorkDays(
  supabase: SupabaseClient,
  businessId: string,
  year: number,
  month: number
): Promise<number> {
  const today = new Date();
  const isCurrentMonth =
    year === today.getFullYear() && month === today.getMonth() + 1;
  if (!isCurrentMonth) return 0;

  const daysInMonth = new Date(year, month, 0).getDate();
  const dayOfMonthToday = today.getDate();

  // Schedule (default day-factor by day-of-week 0-6)
  const { data: schedule } = await supabase
    .from("business_schedule")
    .select("day_of_week, day_factor")
    .eq("business_id", businessId);
  const scheduleMap = new Map<number, number>();
  for (const row of (schedule || []) as Array<{ day_of_week: number; day_factor: number }>) {
    scheduleMap.set(row.day_of_week, Number(row.day_factor) || 0);
  }

  // Exceptions for the rest of the month
  const fromStr = `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonthToday).padStart(2, "0")}`;
  const toStr = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
  const { data: exceptions } = await supabase
    .from("business_day_exceptions")
    .select("exception_date, day_factor")
    .eq("business_id", businessId)
    .gte("exception_date", fromStr)
    .lte("exception_date", toStr);
  const exceptionMap = new Map<string, number>();
  for (const ex of (exceptions || []) as Array<{ exception_date: string; day_factor: number }>) {
    const dateStr = String(ex.exception_date).substring(0, 10);
    exceptionMap.set(dateStr, Number(ex.day_factor) ?? 0);
  }

  let remaining = 0;
  for (let d = dayOfMonthToday; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (exceptionMap.has(dateStr)) {
      remaining += exceptionMap.get(dateStr)!;
    } else {
      const dow = new Date(year, month - 1, d).getDay();
      remaining += scheduleMap.get(dow) ?? 0;
    }
  }
  return remaining;
}

/**
 * Project end-of-month total orders by averaging the same-day-of-week count
 * from the trailing 2 months, then summing across the days remaining in the
 * current month. David #9 spec: "ממוצע ימי שבוע ב-2 חודשים אחורה".
 */
async function projectExpectedOrders(
  supabase: SupabaseClient,
  businessId: string,
  incomeSourceId: string,
  year: number,
  month: number,
  ordersToDate: number
): Promise<number> {
  const today = new Date();
  const isCurrentMonth =
    year === today.getFullYear() && month === today.getMonth() + 1;
  if (!isCurrentMonth) return ordersToDate;

  // Look back 2 months from the start of the current month
  const lookbackStart = new Date(year, month - 1 - 2, 1);
  const lookbackEnd = new Date(year, month - 1, 0); // last day of previous month
  const fromStr = `${lookbackStart.getFullYear()}-${String(lookbackStart.getMonth() + 1).padStart(2, "0")}-01`;
  const toStr = `${lookbackEnd.getFullYear()}-${String(lookbackEnd.getMonth() + 1).padStart(2, "0")}-${String(lookbackEnd.getDate()).padStart(2, "0")}`;

  // Two-step query to avoid Supabase generic depth blowup on filtered joins.
  const { data: dailyEntries } = await supabase
    .from("daily_entries")
    .select("id, entry_date")
    .eq("business_id", businessId)
    .gte("entry_date", fromStr)
    .lte("entry_date", toStr)
    .is("deleted_at", null);
  const entryIds = (dailyEntries || []).map((e: { id: string }) => e.id);
  const idToDate = new Map<string, string>();
  for (const e of (dailyEntries || []) as Array<{ id: string; entry_date: string }>) {
    idToDate.set(e.id, String(e.entry_date).substring(0, 10));
  }

  let breakdowns: Array<{ daily_entry_id: string; orders_count: number }> = [];
  if (entryIds.length > 0) {
    const { data } = await supabase
      .from("daily_income_breakdown")
      .select("daily_entry_id, orders_count")
      .eq("income_source_id", incomeSourceId)
      .in("daily_entry_id", entryIds);
    breakdowns = (data || []) as Array<{ daily_entry_id: string; orders_count: number }>;
  }

  // Sum orders by day-of-week and count days observed
  const dowSum = new Array(7).fill(0);
  const dowCount = new Array(7).fill(0);
  const ordersByEntry = new Map<string, number>();
  for (const b of breakdowns) {
    ordersByEntry.set(b.daily_entry_id, (ordersByEntry.get(b.daily_entry_id) || 0) + (Number(b.orders_count) || 0));
  }
  for (const [entryId, dateStr] of idToDate) {
    const dow = new Date(dateStr + "T00:00:00").getDay();
    const orders = ordersByEntry.get(entryId) || 0;
    dowSum[dow] += orders;
    dowCount[dow] += 1;
  }
  const dowAvg = dowSum.map((sum, i) => (dowCount[i] > 0 ? sum / dowCount[i] : 0));

  // Project remaining days
  const daysInMonth = new Date(year, month, 0).getDate();
  let projectedRemaining = 0;
  for (let d = today.getDate() + 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    projectedRemaining += dowAvg[dow];
  }

  return Math.round(ordersToDate + projectedRemaining);
}

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

  // David #9 — daily target only meaningful for "higher is better" currency
  // KPIs (revenue). For costs / percentages it doesn't apply.
  let dailyTargetRequired: number | null = null;
  let remainingWorkDays: number | null = null;
  if (
    plan.data_source === "revenue" &&
    goalValue !== null &&
    goalValue > 0 &&
    !plan.is_lower_better
  ) {
    remainingWorkDays = await getRemainingWorkDays(supabase, plan.business_id, year, month);
    // currentValue for "revenue" is monthly_pace. We need to know how much
    // of the goal is already booked vs. what's left. Pull the actual
    // income_to_date (income_before_vat) instead of the pace projection.
    const { data: rawMetrics } = await supabase
      .from("business_monthly_metrics")
      .select("income_before_vat")
      .eq("business_id", plan.business_id)
      .eq("year", year)
      .eq("month", month)
      .maybeSingle();
    const incomeToDate = Number(rawMetrics?.income_before_vat) || 0;
    const remainingGoal = Math.max(0, goalValue - incomeToDate);
    dailyTargetRequired = remainingWorkDays > 0
      ? Math.round(remainingGoal / remainingWorkDays)
      : null;
  }

  return { currentValue, goalValue, qualifiedTier, bonusAmount, dailyTargetRequired, remainingWorkDays };
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
  let totalOrdersToDate = 0;
  let totalAmountToDate = 0;

  if (entries && entries.length > 0) {
    const entryIds = entries.map((e: { id: string }) => e.id);
    // Get income breakdown for this source across all daily entries
    const { data: breakdowns } = await supabase
      .from("daily_income_breakdown")
      .select("amount, orders_count")
      .eq("income_source_id", sourceId)
      .in("daily_entry_id", entryIds);

    if (breakdowns && breakdowns.length > 0) {
      totalAmountToDate = breakdowns.reduce((sum: number, r: { amount: number }) => sum + Number(r.amount || 0), 0);
      totalOrdersToDate = breakdowns.reduce((sum: number, r: { orders_count: number }) => sum + Number(r.orders_count || 0), 0);
      currentValue = totalOrdersToDate > 0 ? totalAmountToDate / totalOrdersToDate : 0;
    }
  }

  // Get goal (avg_ticket_target from income_source_goals, filtered by month's goal)
  const { data: monthGoal } = await supabase
    .from("goals")
    .select("id")
    .eq("business_id", plan.business_id)
    .eq("year", year)
    .eq("month", month)
    .is("deleted_at", null)
    .maybeSingle();

  const { data: goalData } = monthGoal
    ? await supabase
        .from("income_source_goals")
        .select("avg_ticket_target")
        .eq("income_source_id", sourceId)
        .eq("goal_id", monthGoal.id)
        .maybeSingle()
    : { data: null };

  const goalValue = goalData?.avg_ticket_target != null ? Number(goalData.avg_ticket_target) : null;

  if (currentValue === null) {
    return { currentValue: null, goalValue, qualifiedTier: null, bonusAmount: 0 };
  }

  const qualifiedTier = evaluateTier(plan, currentValue);
  const bonusAmount = qualifiedTier === 3 ? plan.tier3_amount : qualifiedTier === 2 ? plan.tier2_amount : qualifiedTier === 1 ? plan.tier1_amount : 0;

  // David #9 — for avg-ticket plans, project end-of-month total orders so the
  // employee sees: "ב-X הזמנות צפויות, אם תעמוד בממוצע ₪Y → +₪Z." This is
  // the missing link between the bonus and a daily action.
  const expectedOrders = await projectExpectedOrders(
    supabase,
    plan.business_id,
    sourceId,
    year,
    month,
    totalOrdersToDate
  );
  const remainingWorkDays = await getRemainingWorkDays(supabase, plan.business_id, year, month);
  // dailyTargetRequired here = orders needed today to reach end-of-month
  // expected count; gives the employee a concrete daily bar to clear.
  const dailyTargetRequired = remainingWorkDays > 0 && expectedOrders > totalOrdersToDate
    ? Math.round((expectedOrders - totalOrdersToDate) / remainingWorkDays)
    : null;

  // David's call: turn the abstract bonus into a concrete "what does the
  // average per-order need to be on the remaining orders so I hit the
  // bonus tier?". For "higher is better" plans (avg ticket), pick the
  // LOWEST tier threshold the user hasn't hit yet — that's the closest
  // bonus they can still earn this month.
  // Math: finalAvg = (amountToDate + remaining × avgInRemaining) / expectedOrders
  //       avgInRemaining = (threshold × expectedOrders − amountToDate) / remaining
  const remainingOrders = Math.max(0, expectedOrders - totalOrdersToDate);
  let bonusTierThreshold: number | null = null;
  let neededAvgRemaining: number | null = null;
  if (!plan.is_lower_better && remainingOrders > 0 && expectedOrders > 0) {
    // Tiers ordered low→high. Pick the lowest threshold whose target
    // currentValue hasn't yet reached. If they've already cleared the
    // top tier, leave bonusTierThreshold null (already maxed).
    const tiersAsc = [
      { threshold: plan.tier1_threshold },
      { threshold: plan.tier2_threshold },
      { threshold: plan.tier3_threshold },
    ].filter((t): t is { threshold: number } => t.threshold != null);

    const next = tiersAsc.find((t) => (currentValue ?? 0) < t.threshold);
    if (next) {
      bonusTierThreshold = next.threshold;
      const needed = (next.threshold * expectedOrders - totalAmountToDate) / remainingOrders;
      // If the math is already lost (would need a negative or absurd avg
      // — say > 5× the threshold), don't display a misleading number.
      if (needed > 0 && needed < next.threshold * 5) {
        neededAvgRemaining = Math.round(needed);
      }
    }
  }

  return {
    currentValue,
    goalValue,
    qualifiedTier,
    bonusAmount,
    expectedOrders,
    dailyTargetRequired,
    remainingWorkDays,
    remainingOrders,
    amountToDate: totalAmountToDate,
    neededAvgRemaining,
    bonusTierThreshold,
  };
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
