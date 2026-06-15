import type { SupabaseClient } from "@supabase/supabase-js";
import { getExpenseMetrics } from "./expenses";
import { getIncomeMetrics } from "./income";
import type { AnnualMetric, AnnualMonthRow, MetricsDateRange } from "./types";

// ---------------------------------------------------------------------------
// getAnnualMetric
//
// Year-at-a-glance month-by-month view ("נתוני עבר" / historical-data modals).
//
// CRITICAL: this view is ACTUAL-based, NOT pace/forecast-based. Per month it
// uses the ACTUAL value (not the monthly forecast/pace) and computes
// actual-based comparisons. It therefore IGNORES getIncomeMetrics's pace-based
// monthlyPace / targetDiffPct / momChangePct, and uses only totalIncome,
// revenueTarget, and bySource[].{amount,ordersCount,avgTicket}. For expense
// metrics the *.amount and pct/diffPct are already actual-based and are reused
// directly.
//
// `metric` keys:
//   "sales"            — getIncomeMetrics.totalIncome (target = revenueTarget)
//   "source:<name>"    — getIncomeMetrics.bySource by name (amount/orders/avg)
//   "labor"            — getExpenseMetrics.laborCost
//   "cogs"             — getExpenseMetrics.cogs
//   "operating"        — getExpenseMetrics.operating
//   "product:<name>"   — getExpenseMetrics.managedProducts by name
// ---------------------------------------------------------------------------

/**
 * Annual metric key. Either a fixed metric, or a dynamic "source:<name>" /
 * "product:<name>" key.
 */
export type AnnualMetricKey =
  | "sales"
  | "labor"
  | "cogs"
  | "operating"
  | string; // also "source:<name>" and "product:<name>"

/** Per-month raw value extracted from the underlying metric functions. */
interface MonthValue {
  amount: number;
  pct: number | null;
  target: number | null;
  /** For cost metrics: actual-based diffPct already computed by the expense fn. */
  expenseDiffPct: number | null;
  ordersCount?: number;
  avgTicket?: number;
}

function pctChange(amount: number, prev: number): number | null {
  return prev !== 0 ? (amount / prev - 1) * 100 : null;
}

export async function getAnnualMetric(
  supabase: SupabaseClient,
  businessId: string,
  year: number,
  metric: AnnualMetricKey
): Promise<AnnualMetric> {
  // Determine which family of metric we're computing.
  const isSales = metric === "sales";
  const isSource = metric.startsWith("source:");
  const sourceName = isSource ? metric.slice("source:".length) : null;
  const isProduct = metric.startsWith("product:");
  const productName = isProduct ? metric.slice("product:".length) : null;
  const isIncomeMetric = isSales || isSource;
  const isExpenseMetric = !isIncomeMetric; // labor / cogs / operating / product

  // Build all 12 calendar-month ranges.
  const ranges: MetricsDateRange[] = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1; // 1-12
    return {
      start: new Date(year, m - 1, 1),
      end: new Date(year, m, 0), // last day of the month
    };
  });

  // Run all 12 months in PARALLEL. Only call the function family we need.
  const monthValues: MonthValue[] = await Promise.all(
    ranges.map(async (range): Promise<MonthValue> => {
      if (isIncomeMetric) {
        const income = await getIncomeMetrics(supabase, businessId, range);
        if (isSales) {
          return {
            amount: income.totalIncome,
            pct: null,
            target: income.revenueTarget,
            expenseDiffPct: null,
          };
        }
        // source:<name>
        const src = income.bySource.find((s) => s.name === sourceName);
        return {
          amount: src ? src.amount : 0,
          pct: null,
          target: null,
          expenseDiffPct: null,
          ordersCount: src ? src.ordersCount : 0,
          avgTicket: src ? src.avgTicket : 0,
        };
      }

      // Expense metrics (labor / cogs / operating / product).
      const exp = await getExpenseMetrics(supabase, businessId, range);
      if (metric === "labor") {
        return {
          amount: exp.laborCost.amount,
          pct: exp.laborCost.pct,
          target: null,
          expenseDiffPct: exp.laborCost.diffPct,
        };
      }
      if (metric === "cogs") {
        return {
          amount: exp.cogs.amount,
          pct: exp.cogs.pct,
          target: null,
          expenseDiffPct: exp.cogs.diffPct,
        };
      }
      if (metric === "operating") {
        return {
          amount: exp.operating.amount,
          pct: exp.operating.pct,
          target: exp.operating.targetAmount,
          expenseDiffPct: exp.operating.diffPct,
        };
      }
      // product:<name>
      const prod = exp.managedProducts.find((p) => p.name === productName);
      return {
        amount: prod ? prod.amount : 0,
        pct: prod ? prod.pct : null,
        target: null,
        expenseDiffPct: null, // managed products expose no diffPct
      };
    })
  );

  // Build the months array with MoM + target comparisons (all actual-based).
  const months: AnnualMonthRow[] = monthValues.map((mv, i) => {
    const prevAmount = i > 0 ? monthValues[i - 1].amount : null;
    const momPct = prevAmount !== null ? pctChange(mv.amount, prevAmount) : null;

    let targetDiffPct: number | null;
    if (isIncomeMetric) {
      // sales / source: actual vs target.
      targetDiffPct =
        mv.target && mv.target !== 0 ? (mv.amount / mv.target - 1) * 100 : null;
    } else {
      // labor / cogs / operating: actual-based diffPct from the expense fn.
      // product: no diffPct available.
      targetDiffPct = mv.expenseDiffPct;
    }

    const row: AnnualMonthRow = {
      month: i + 1,
      amount: mv.amount,
      pct: mv.pct,
      target: mv.target,
      targetDiffPct,
      momPct,
    };
    if (isSource) {
      row.ordersCount = mv.ordersCount ?? 0;
      row.avgTicket = mv.avgTicket ?? 0;
    }
    return row;
  });

  void isExpenseMetric; // documented branch flag; not consumed directly.

  const total = monthValues.reduce((sum, mv) => sum + mv.amount, 0);

  return {
    year,
    metric,
    total,
    months,
  };
}
