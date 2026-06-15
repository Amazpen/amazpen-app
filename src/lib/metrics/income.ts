import type { SupabaseClient } from "@supabase/supabase-js";
import { formatLocalDate } from "./dates";
import type {
  ChannelIncomeMetric,
  IncomeMetrics,
  IncomeSourceMetric,
  MetricsDateRange,
} from "./types";

// ---------------------------------------------------------------------------
// getIncomeMetrics
//
// Pure async function that replicates the INCOME computation from the dashboard
// (`fetchDetailedSummary` in src/app/(dashboard)/page.tsx). It is intentionally
// a faithful port — formulas, fallbacks and edge cases mirror page.tsx so the
// numbers match to the cent. Line references below point at page.tsx.
//
// Differences from the dashboard:
//   - Operates on a SINGLE businessId (the dashboard sums an array of
//     selectedBusinesses). Where page.tsx uses `.in("business_id", arr)` we use
//     a single-element array `[businessId]` so the per-business averaging logic
//     (e.g. avgVatPercentage, totalMarkup) is preserved unchanged.
//   - Takes a supabase client as a parameter (server or browser) — does not
//     create one.
// ---------------------------------------------------------------------------
export async function getIncomeMetrics(
  supabase: SupabaseClient,
  businessId: string,
  dateRange: MetricsDateRange
): Promise<IncomeMetrics> {
  const selectedBusinesses = [businessId];

  // page.tsx 1311-1314
  const startDateStr = formatLocalDate(dateRange.start);
  const endDateStr = formatLocalDate(dateRange.end);
  const targetMonth = dateRange.start.getMonth() + 1; // 1-12 for database
  const targetYear = dateRange.start.getFullYear();

  // ========================================================================
  // BATCH 1 — independent queries (income-relevant subset of page.tsx 1319-1403)
  // ========================================================================
  const [
    entriesResult,
    scheduleResult,
    businessDataResult,
    goalsResult,
    incomeSourcesResult,
    dayExceptionsDetailResult,
  ] = await Promise.all([
    // daily entries for the range
    supabase
      .from("daily_entries")
      .select("*")
      .in("business_id", selectedBusinesses)
      .gte("entry_date", startDateStr)
      .lte("entry_date", endDateStr)
      .is("deleted_at", null),

    // business schedule for monthly pace
    supabase
      .from("business_schedule")
      .select("business_id, day_of_week, day_factor")
      .in("business_id", selectedBusinesses),

    // business data for VAT / markup
    supabase
      .from("businesses")
      .select("id, markup_percentage, manager_monthly_salary, vat_percentage, business_model")
      .in("id", selectedBusinesses),

    // goals for the month
    supabase
      .from("goals")
      .select(
        "id, business_id, revenue_target, labor_cost_target_pct, food_cost_target_pct, current_expenses_target, markup_percentage, vat_percentage"
      )
      .in("business_id", selectedBusinesses)
      .eq("year", targetYear)
      .eq("month", targetMonth)
      .is("deleted_at", null),

    // active income sources
    supabase
      .from("income_sources")
      .select("id, name, income_type")
      .in("business_id", selectedBusinesses)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("display_order"),

    // day exceptions for the month (override weekly schedule)
    supabase
      .from("business_day_exceptions")
      .select("exception_date, day_factor")
      .in("business_id", selectedBusinesses)
      .gte(
        "exception_date",
        formatLocalDate(new Date(dateRange.start.getFullYear(), dateRange.start.getMonth(), 1))
      )
      .lte(
        "exception_date",
        formatLocalDate(new Date(dateRange.start.getFullYear(), dateRange.start.getMonth() + 1, 0))
      ),
  ]);

  type DailyEntry = {
    id: string;
    entry_date: string;
    total_register: number | null;
    day_factor: number | null;
  };
  type ScheduleRow = { day_of_week: number; day_factor: number | null };
  type BusinessRow = {
    id: string;
    markup_percentage: number | null;
    vat_percentage: number | null;
  };
  type GoalRow = {
    id: string;
    business_id: string;
    revenue_target: number | null;
    markup_percentage: number | null;
    vat_percentage: number | null;
  };
  type IncomeSourceRow = { id: string; name: string; income_type: string };
  type DayExceptionRow = { exception_date: string; day_factor: number };

  const entries = (entriesResult.data as DailyEntry[] | null) || [];
  const scheduleData = (scheduleResult.data as ScheduleRow[] | null) || [];
  const businessData = (businessDataResult.data as BusinessRow[] | null) || [];
  const goalsData = (goalsResult.data as GoalRow[] | null) || [];
  const allIncomeSources = (incomeSourcesResult.data as IncomeSourceRow[] | null) || [];
  const dayExceptionsDetail = (dayExceptionsDetailResult.data as DayExceptionRow[] | null) || [];

  // ========================================================================
  // BATCH 2 — income source goals (avg_ticket_target), page.tsx 1432-1438
  // ========================================================================
  const goalIds = goalsData.map((g) => g.id);
  const incomeSourceGoalsResult =
    goalIds.length > 0
      ? await supabase
          .from("income_source_goals")
          .select("income_source_id, avg_ticket_target")
          .in("goal_id", goalIds)
      : { data: [] as Array<{ income_source_id: string; avg_ticket_target: number | null }> };

  const avgTicketTargetMap: Record<string, number> = {};
  ((incomeSourceGoalsResult.data as Array<{ income_source_id: string; avg_ticket_target: number | null }>) || []).forEach(
    (g) => {
      avgTicketTargetMap[g.income_source_id] = Number(g.avg_ticket_target) || 0;
    }
  );

  // ========================================================================
  // totalIncome + VAT divisor (page.tsx 1525, 1619-1629)
  // ========================================================================
  const totalIncome = entries.reduce((sum, e) => sum + (Number(e.total_register) || 0), 0);

  // page.tsx 1530-1533: per-business markup average (goal overrides business default, fallback 1)
  const totalMarkup =
    businessData.reduce((sum, b) => {
      const bGoal = goalsData.find((g) => g.business_id === b.id);
      return (
        sum +
        (bGoal?.markup_percentage != null
          ? Number(bGoal.markup_percentage)
          : Number(b.markup_percentage) || 1)
      );
    }, 0) / Math.max(businessData.length, 1);
  // totalMarkup is computed for fidelity with page.tsx (used by labor cost there);
  // income metrics don't consume it. Reference to silence unused-var lint.
  void totalMarkup;

  // page.tsx 1621-1629: average VAT (goal overrides business default), normalize multiplier->fraction
  const rawAvgVatPct =
    businessData.reduce((sum, b) => {
      const bGoal = goalsData.find((g) => g.business_id === b.id);
      return (
        sum +
        (bGoal?.vat_percentage != null
          ? Number(bGoal.vat_percentage)
          : Number(b.vat_percentage) || 0)
      );
    }, 0) / Math.max(businessData.length, 1);
  const avgVatPercentage = rawAvgVatPct > 1 ? rawAvgVatPct - 1 : rawAvgVatPct;
  const vatDivisor = avgVatPercentage > 0 ? 1 + avgVatPercentage : 1;
  const incomeBeforeVat = totalIncome / vatDivisor;

  // ========================================================================
  // Expected work days for the month from schedule + exceptions
  // (page.tsx 1537-1577, also reused for monthly pace 1916-1951)
  // ========================================================================
  const schedTargetMonth = dateRange.start.getMonth();
  const schedTargetYear = dateRange.start.getFullYear();
  const firstDayOfMonth = new Date(schedTargetYear, schedTargetMonth, 1);
  const lastDayOfMonth = new Date(schedTargetYear, schedTargetMonth + 1, 0);

  // day_of_week -> [factors], then averaged (page.tsx 1543-1556)
  const scheduleDayFactors: Record<number, number[]> = {};
  scheduleData.forEach((s) => {
    if (!scheduleDayFactors[s.day_of_week]) scheduleDayFactors[s.day_of_week] = [];
    scheduleDayFactors[s.day_of_week].push(Number(s.day_factor) || 0);
  });
  const avgScheduleDayFactors: Record<number, number> = {};
  Object.keys(scheduleDayFactors).forEach((dow) => {
    const factors = scheduleDayFactors[Number(dow)];
    avgScheduleDayFactors[Number(dow)] = factors.reduce((a, b) => a + b, 0) / factors.length;
  });

  // exception map (page.tsx 1558-1564)
  const detailExceptionMap: Record<string, number> = {};
  dayExceptionsDetail.forEach((e) => {
    const d = new Date(e.exception_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    detailExceptionMap[key] = Number(e.day_factor);
  });

  // count expected work days (page.tsx 1567-1577)
  let expectedWorkDaysInMonth = 0;
  const cursor = new Date(firstDayOfMonth);
  while (cursor <= lastDayOfMonth) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(
      cursor.getDate()
    ).padStart(2, "0")}`;
    if (detailExceptionMap[key] !== undefined) {
      expectedWorkDaysInMonth += detailExceptionMap[key];
    } else {
      expectedWorkDaysInMonth += avgScheduleDayFactors[cursor.getDay()] || 0;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // actual work days = sum of day_factor (page.tsx 1583)
  const actualWorkDays = entries.reduce((sum, e) => sum + (Number(e.day_factor) || 0), 0);

  // ========================================================================
  // Monthly pace (page.tsx 1905-1956)
  // Only computed when there is actual activity AND a schedule.
  // expectedMonthlyWorkDays is recomputed exactly as page.tsx does (it does NOT
  // reuse expectedWorkDaysInMonth here), reusing detailExceptionMap.
  // ========================================================================
  const sumActualDayFactors = entries.reduce((sum, e) => sum + (Number(e.day_factor) || 0), 0);
  let monthlyPace = 0;
  let expectedMonthlyWorkDays = 0;

  if (sumActualDayFactors > 0 && scheduleData.length > 0) {
    const paceTargetMonth = dateRange.start.getMonth();
    const paceTargetYear = dateRange.start.getFullYear();
    const paceFirstDay = new Date(paceTargetYear, paceTargetMonth, 1);
    const paceLastDay = new Date(paceTargetYear, paceTargetMonth + 1, 0);

    const dayFactorsByDow: Record<number, number[]> = {};
    scheduleData.forEach((s) => {
      if (!dayFactorsByDow[s.day_of_week]) dayFactorsByDow[s.day_of_week] = [];
      dayFactorsByDow[s.day_of_week].push(Number(s.day_factor) || 0);
    });
    const avgDayFactorsByDow: Record<number, number> = {};
    Object.keys(dayFactorsByDow).forEach((dow) => {
      const factors = dayFactorsByDow[Number(dow)];
      avgDayFactorsByDow[Number(dow)] = factors.reduce((a, b) => a + b, 0) / factors.length;
    });

    const paceCursor = new Date(paceFirstDay);
    while (paceCursor <= paceLastDay) {
      const key = `${paceCursor.getFullYear()}-${String(paceCursor.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(paceCursor.getDate()).padStart(2, "0")}`;
      if (detailExceptionMap[key] !== undefined) {
        expectedMonthlyWorkDays += detailExceptionMap[key];
      } else {
        expectedMonthlyWorkDays += avgDayFactorsByDow[paceCursor.getDay()] || 0;
      }
      paceCursor.setDate(paceCursor.getDate() + 1);
    }

    const dailyAverage = totalIncome / sumActualDayFactors;
    monthlyPace = dailyAverage * expectedMonthlyWorkDays;
  }

  // ========================================================================
  // Revenue target + diff (page.tsx 1968-1980)
  // ========================================================================
  const revenueTarget = goalsData.reduce((sum, g) => sum + (Number(g.revenue_target) || 0), 0);

  let targetDiffPct = 0;
  let targetDiffIls = 0;
  if (revenueTarget > 0 && expectedMonthlyWorkDays > 0) {
    targetDiffPct = (monthlyPace / revenueTarget - 1) * 100;
    const dailyDiff = (monthlyPace - revenueTarget) / expectedMonthlyWorkDays;
    targetDiffIls = dailyDiff * sumActualDayFactors;
  }

  // ========================================================================
  // In-place vs delivery split + per-source breakdown
  // (page.tsx 1644-1851; current-period breakdown only — historical avgs for the
  // income-source list aren't part of the IncomeMetrics output shape)
  // ========================================================================
  const entryIds = entries.map((e) => e.id);
  const breakdownResult =
    entryIds.length > 0
      ? await supabase
          .from("daily_income_breakdown")
          .select("daily_entry_id, income_source_id, amount, orders_count")
          .in("daily_entry_id", entryIds)
      : {
          data: [] as Array<{
            daily_entry_id: string;
            income_source_id: string;
            amount: number | null;
            orders_count: number | null;
          }>,
        };

  const breakdownData =
    (breakdownResult.data as Array<{
      income_source_id: string;
      amount: number | null;
      orders_count: number | null;
    }> | null) || [];

  // private (in-place) vs business (delivery) — page.tsx 1756-1785
  let privateIncome = 0;
  let privateCount = 0;
  let businessIncome = 0;
  let businessCount = 0;

  const incomeSourceAggregates: Record<
    string,
    { totalAmount: number; ordersCount: number; entriesCount: number }
  > = {};

  breakdownData.forEach((b) => {
    const source = allIncomeSources.find((s) => s.id === b.income_source_id);
    const amount = Number(b.amount) || 0;
    const orders = Number(b.orders_count) || 0;

    if (source?.income_type === "business") {
      businessIncome += amount;
      businessCount += orders;
    } else {
      privateIncome += amount;
      privateCount += orders;
    }

    if (!incomeSourceAggregates[b.income_source_id]) {
      incomeSourceAggregates[b.income_source_id] = {
        totalAmount: 0,
        ordersCount: 0,
        entriesCount: 0,
      };
    }
    incomeSourceAggregates[b.income_source_id].totalAmount += amount;
    incomeSourceAggregates[b.income_source_id].ordersCount += orders;
    incomeSourceAggregates[b.income_source_id].entriesCount += 1;
  });

  // per-source list across ALL sources (page.tsx 1788-1849) — avgTicket only
  const bySource: IncomeSourceMetric[] = allIncomeSources.map((source) => {
    const aggregate = incomeSourceAggregates[source.id] || {
      totalAmount: 0,
      ordersCount: 0,
      entriesCount: 0,
    };
    const avgTicket =
      aggregate.ordersCount > 0
        ? aggregate.totalAmount / aggregate.ordersCount
        : aggregate.entriesCount > 0
          ? aggregate.totalAmount / aggregate.entriesCount
          : 0;
    return {
      id: source.id,
      name: source.name,
      incomeType: source.income_type,
      amount: aggregate.totalAmount,
      ordersCount: aggregate.ordersCount,
      avgTicket,
    };
  });
  // avgTicketTargetMap kept for fidelity with page.tsx; not in output shape.
  void avgTicketTargetMap;

  // page.tsx 1874-1875
  const privateAvg = privateCount > 0 ? privateIncome / privateCount : 0;
  const businessAvg = businessCount > 0 ? businessIncome / businessCount : 0;

  const inPlace: ChannelIncomeMetric = {
    amount: privateIncome,
    ordersCount: privateCount,
    avgTicket: privateAvg,
  };
  const delivery: ChannelIncomeMetric = {
    amount: businessIncome,
    ordersCount: businessCount,
    avgTicket: businessAvg,
  };

  // ========================================================================
  // Month-over-month + year-over-year income change
  // (page.tsx 1987-2158 — the income card lines: monthlyPace vs FULL prev month
  //  and FULL prev year)
  // ========================================================================
  // prev month full calendar range (page.tsx 1987-1991)
  const prevMonthStart = new Date(dateRange.start);
  prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
  const prevMonthEnd = new Date(dateRange.start);
  prevMonthEnd.setDate(0); // last day of previous month
  const prevMonthStartStr = formatLocalDate(prevMonthStart);

  // prev year full calendar month (page.tsx 2009-2014)
  const prevYearStart = new Date(dateRange.start);
  prevYearStart.setFullYear(prevYearStart.getFullYear() - 1);
  const prevYearEnd = new Date(prevYearStart.getFullYear(), prevYearStart.getMonth() + 1, 0);
  const prevYearStartStr = formatLocalDate(prevYearStart);
  const prevYearEndStr = formatLocalDate(prevYearEnd);
  const prevYearMonth = prevYearStart.getMonth() + 1;
  const prevYearYear = prevYearStart.getFullYear();

  const [prevYearEntriesResult, prevYearMonthlySummaryResult, prevMonthFullIncomeResult] =
    await Promise.all([
      // prev year entries (page.tsx 2041-2047) — income subset
      supabase
        .from("daily_entries")
        .select("total_register")
        .in("business_id", selectedBusinesses)
        .gte("entry_date", prevYearStartStr)
        .lte("entry_date", prevYearEndStr)
        .is("deleted_at", null),

      // prev year monthly summaries fallback (page.tsx 2050-2055) — total_income only
      supabase
        .from("monthly_summaries")
        .select("total_income")
        .in("business_id", selectedBusinesses)
        .eq("year", prevYearYear)
        .eq("month", prevYearMonth),

      // prev month FULL income (page.tsx 2107-2113)
      supabase
        .from("daily_entries")
        .select("total_register")
        .in("business_id", selectedBusinesses)
        .gte("entry_date", prevMonthStartStr)
        .lte("entry_date", formatLocalDate(prevMonthEnd))
        .is("deleted_at", null),
    ]);

  const prevYearEntries =
    (prevYearEntriesResult.data as Array<{ total_register: number | null }> | null) || [];
  const prevYearMonthlySummaries =
    (prevYearMonthlySummaryResult.data as Array<{ total_income: number | null }> | null) || [];

  // MoM: monthlyPace vs FULL prev month (page.tsx 2136-2139)
  const prevMonthIncomeFull =
    ((prevMonthFullIncomeResult.data as Array<{ total_register: number | null }>) || []).reduce(
      (sum, e) => sum + (Number(e.total_register) || 0),
      0
    );
  const momChangePct = prevMonthIncomeFull > 0 ? (monthlyPace / prevMonthIncomeFull - 1) * 100 : 0;

  // YoY: monthlyPace vs FULL prev year, with monthly_summaries fallback
  // (page.tsx 2153-2158)
  let prevYearIncome = prevYearEntries.reduce((sum, e) => sum + (Number(e.total_register) || 0), 0);
  if (prevYearIncome === 0 && prevYearMonthlySummaries.length > 0) {
    prevYearIncome = prevYearMonthlySummaries.reduce(
      (sum, s) => sum + (Number(s.total_income) || 0),
      0
    );
  }
  const yoyChangePct = prevYearIncome > 0 ? (monthlyPace / prevYearIncome - 1) * 100 : 0;

  return {
    totalIncome,
    incomeBeforeVat,
    monthlyPace,
    revenueTarget,
    targetDiffPct,
    targetDiffIls,
    momChangePct,
    yoyChangePct,
    expectedWorkDays: expectedWorkDaysInMonth,
    actualWorkDays,
    bySource,
    inPlace,
    delivery,
  };
}
