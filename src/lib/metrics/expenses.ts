import type { SupabaseClient } from "@supabase/supabase-js";
import { formatLocalDate } from "./dates";
import type {
  CogsMetric,
  ExpenseMetrics,
  LaborCostMetric,
  ManagedProductMetric,
  MetricsDateRange,
  OperatingExpensesMetric,
} from "./types";

// ---------------------------------------------------------------------------
// getExpenseMetrics
//
// Pure async function that replicates the EXPENSE computation from the dashboard
// (`fetchDetailedSummary` in src/app/(dashboard)/page.tsx). It is a faithful
// port — formulas, fallbacks and edge cases mirror page.tsx so the numbers match
// to the cent. Line references below point at page.tsx.
//
// Differences from the dashboard:
//   - Operates on a SINGLE businessId. Where page.tsx uses `.in("business_id",
//     arr)` over an array of selectedBusinesses we use a single-element array
//     `[businessId]` so the per-business averaging logic (avgVatPercentage,
//     totalMarkup, manager salary) is preserved unchanged.
//   - Takes a supabase client as a parameter (server or browser) — does not
//     create one.
//   - Computes only the current-period expense figures used by ExpenseMetrics;
//     the dashboard's historical prev-month/prev-year comparison columns for the
//     expense cards are not part of the output shape and are omitted.
// ---------------------------------------------------------------------------
export async function getExpenseMetrics(
  supabase: SupabaseClient,
  businessId: string,
  dateRange: MetricsDateRange
): Promise<ExpenseMetrics> {
  const selectedBusinesses = [businessId];

  // page.tsx 1311-1314
  const startDateStr = formatLocalDate(dateRange.start);
  const endDateStr = formatLocalDate(dateRange.end);
  const targetMonth = dateRange.start.getMonth() + 1; // 1-12 for database
  const targetYear = dateRange.start.getFullYear();

  // ========================================================================
  // BATCH 1 — independent queries (expense-relevant subset of page.tsx 1319-1403)
  // ========================================================================
  const [
    entriesResult,
    scheduleResult,
    businessDataResult,
    goalsResult,
    managedProductsResult,
    goodsSuppliersResult,
    currentExpensesSuppliersResult,
    dayExceptionsDetailResult,
  ] = await Promise.all([
    // 1. daily entries for the range
    supabase
      .from("daily_entries")
      .select("*")
      .in("business_id", selectedBusinesses)
      .gte("entry_date", startDateStr)
      .lte("entry_date", endDateStr)
      .is("deleted_at", null),

    // 2. business schedule for expected work days
    supabase
      .from("business_schedule")
      .select("business_id, day_of_week, day_factor")
      .in("business_id", selectedBusinesses),

    // 3. business data for labor cost / VAT / markup
    supabase
      .from("businesses")
      .select("id, markup_percentage, manager_monthly_salary, vat_percentage, business_model")
      .in("id", selectedBusinesses),

    // 4. goals for the month
    supabase
      .from("goals")
      .select(
        "id, business_id, revenue_target, labor_cost_target_pct, food_cost_target_pct, current_expenses_target, markup_percentage, vat_percentage"
      )
      .in("business_id", selectedBusinesses)
      .eq("year", targetYear)
      .eq("month", targetMonth)
      .is("deleted_at", null),

    // 5. active managed products (page.tsx 1369-1376)
    supabase
      .from("managed_products")
      .select("id, name, unit, unit_cost, target_pct, display_order")
      .in("business_id", selectedBusinesses)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("display_order"),

    // 6. suppliers with expense_type = 'goods_purchases' (page.tsx 1378-1385)
    supabase
      .from("suppliers")
      .select("id")
      .in("business_id", selectedBusinesses)
      .eq("expense_type", "goods_purchases")
      .eq("is_active", true)
      .is("deleted_at", null),

    // 7. suppliers with expense_type = 'current_expenses' (page.tsx 1387-1394)
    supabase
      .from("suppliers")
      .select("id, is_fixed_expense")
      .in("business_id", selectedBusinesses)
      .eq("expense_type", "current_expenses")
      .eq("is_active", true)
      .is("deleted_at", null),

    // 8. day exceptions for the month (override weekly schedule)
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
    labor_cost: number | null;
    manager_daily_cost: number | null;
    day_factor: number | null;
  };
  type ScheduleRow = { day_of_week: number; day_factor: number | null };
  type BusinessRow = {
    id: string;
    markup_percentage: number | null;
    manager_monthly_salary: number | null;
    vat_percentage: number | null;
  };
  type GoalRow = {
    id: string;
    business_id: string;
    labor_cost_target_pct: number | null;
    food_cost_target_pct: number | null;
    markup_percentage: number | null;
    vat_percentage: number | null;
  };
  type ManagedProductRow = {
    id: string;
    name: string;
    unit: string;
    unit_cost: number | null;
    target_pct: number | null;
    display_order: number | null;
  };
  type SupplierIdRow = { id: string };
  type DayExceptionRow = { exception_date: string; day_factor: number };

  const entries = (entriesResult.data as DailyEntry[] | null) || [];
  const scheduleData = (scheduleResult.data as ScheduleRow[] | null) || [];
  const businessData = (businessDataResult.data as BusinessRow[] | null) || [];
  const goalsData = (goalsResult.data as GoalRow[] | null) || [];
  const allManagedProducts = (managedProductsResult.data as ManagedProductRow[] | null) || [];
  const goodsSuppliers = (goodsSuppliersResult.data as SupplierIdRow[] | null) || [];
  const currentExpensesSuppliers =
    (currentExpensesSuppliersResult.data as SupplierIdRow[] | null) || [];
  const dayExceptionsDetail = (dayExceptionsDetailResult.data as DayExceptionRow[] | null) || [];

  // Prepare IDs for dependent queries (page.tsx 1417-1420)
  const goodsSupplierIds = goodsSuppliers.map((s) => s.id);
  const currentExpensesSupplierIds = currentExpensesSuppliers.map((s) => s.id);
  // Include ALL current_expenses suppliers (not only is_fixed_expense) — matches Bubble target calc
  const fixedExpenseSupplierIds = currentExpensesSuppliers.map((s) => s.id);

  // ========================================================================
  // BATCH 2 — dependent queries (page.tsx 1425-1482)
  // Queries filter on business_id only (not the full supplier_id IN list) and
  // are post-filtered in memory — matching page.tsx's workaround for large IN
  // lists.
  // ========================================================================
  const [
    goodsInvoicesResult,
    goodsDeliveryNotesResult,
    currentExpensesInvoicesResult,
    currentExpensesBudgetsResult,
  ] = await Promise.all([
    goodsSupplierIds.length > 0
      ? supabase
          .from("invoices")
          .select("subtotal, invoice_date, supplier_id")
          .in("business_id", selectedBusinesses)
          .gte("reference_date", startDateStr)
          .lte("reference_date", endDateStr)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] }),

    goodsSupplierIds.length > 0
      ? supabase
          .from("delivery_notes")
          .select("subtotal, delivery_date, supplier_id")
          .in("business_id", selectedBusinesses)
          .gte("delivery_date", startDateStr)
          .lte("delivery_date", endDateStr)
          .is("invoice_id", null)
      : Promise.resolve({ data: [] }),

    currentExpensesSupplierIds.length > 0
      ? supabase
          .from("invoices")
          .select("subtotal, supplier_id")
          .in("business_id", selectedBusinesses)
          .gte("reference_date", startDateStr)
          .lte("reference_date", endDateStr)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] }),

    fixedExpenseSupplierIds.length > 0
      ? supabase
          .from("supplier_budgets")
          .select("budget_amount, supplier_id")
          .in("business_id", selectedBusinesses)
          .eq("year", dateRange.start.getFullYear())
          .eq("month", dateRange.start.getMonth() + 1)
      : Promise.resolve({ data: [] }),
  ]);

  // Post-filter to the right supplier sets in memory (page.tsx 1487-1510)
  const goodsSupplierIdSetForFilter = new Set(goodsSupplierIds);
  const currentExpensesSupplierIdSetForFilter = new Set(currentExpensesSupplierIds);
  const fixedExpenseSupplierIdSetForFilter = new Set(fixedExpenseSupplierIds);

  const goodsInvoicesRaw =
    (goodsInvoicesResult.data as Array<{
      subtotal: number;
      invoice_date: string;
      supplier_id: string;
    }> | null) || [];
  const goodsDeliveryNotesRaw =
    (goodsDeliveryNotesResult.data as Array<{
      subtotal: number;
      delivery_date: string;
      supplier_id: string;
    }> | null) || [];

  // Merge unlinked delivery notes with invoices — both count toward "עלות מכר".
  const goodsInvoices: Array<{ subtotal: number; invoice_date: string }> = [
    ...goodsInvoicesRaw
      .filter((row) => goodsSupplierIdSetForFilter.has(row.supplier_id))
      .map((row) => ({ subtotal: row.subtotal, invoice_date: row.invoice_date })),
    ...goodsDeliveryNotesRaw
      .filter((row) => goodsSupplierIdSetForFilter.has(row.supplier_id))
      .map((dn) => ({ subtotal: dn.subtotal, invoice_date: dn.delivery_date })),
  ];

  const currentExpensesInvoices = (
    (currentExpensesInvoicesResult.data as Array<{ subtotal: number; supplier_id: string }> | null) ||
    []
  ).filter((row) => currentExpensesSupplierIdSetForFilter.has(row.supplier_id));

  const currentExpensesBudgets = (
    (currentExpensesBudgetsResult.data as Array<{
      budget_amount: number;
      supplier_id: string;
    }> | null) || []
  ).filter((row) => fixedExpenseSupplierIdSetForFilter.has(row.supplier_id));

  // Totals (page.tsx 1519-1527)
  const totalGoodsPurchases = goodsInvoices.reduce(
    (sum, inv) => sum + (Number(inv.subtotal) || 0),
    0
  );
  const totalCurrentExpenses = currentExpensesInvoices.reduce(
    (sum, inv) => sum + (Number(inv.subtotal) || 0),
    0
  );

  const totalIncome = entries.reduce((sum, e) => sum + (Number(e.total_register) || 0), 0);
  const rawLaborCost = entries.reduce((sum, e) => sum + (Number(e.labor_cost) || 0), 0);

  // page.tsx 1530-1534: per-business markup average + total manager salary
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
  const totalManagerSalary = businessData.reduce(
    (sum, b) => sum + (Number(b.manager_monthly_salary) || 0),
    0
  );

  // ========================================================================
  // Expected work days for the month from schedule + exceptions
  // (page.tsx 1537-1577)
  // ========================================================================
  const targetMonthForSchedule = dateRange.start.getMonth();
  const targetYearForSchedule = dateRange.start.getFullYear();
  const firstDayOfMonthSchedule = new Date(targetYearForSchedule, targetMonthForSchedule, 1);
  const lastDayOfMonthSchedule = new Date(targetYearForSchedule, targetMonthForSchedule + 1, 0);

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

  const detailExceptionMap: Record<string, number> = {};
  dayExceptionsDetail.forEach((e) => {
    const d = new Date(e.exception_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    detailExceptionMap[key] = Number(e.day_factor);
  });

  let expectedWorkDaysInMonth = 0;
  const currentDateSchedule = new Date(firstDayOfMonthSchedule);
  while (currentDateSchedule <= lastDayOfMonthSchedule) {
    const detailDateKey = `${currentDateSchedule.getFullYear()}-${String(
      currentDateSchedule.getMonth() + 1
    ).padStart(2, "0")}-${String(currentDateSchedule.getDate()).padStart(2, "0")}`;
    if (detailExceptionMap[detailDateKey] !== undefined) {
      expectedWorkDaysInMonth += detailExceptionMap[detailDateKey];
    } else {
      expectedWorkDaysInMonth += avgScheduleDayFactors[currentDateSchedule.getDay()] || 0;
    }
    currentDateSchedule.setDate(currentDateSchedule.getDate() + 1);
  }

  // ========================================================================
  // Labor cost (page.tsx 1579-1639)
  // ========================================================================
  // Use schedule-based work days (not calendar days) for accurate manager daily cost
  const effectiveWorkDays = expectedWorkDaysInMonth > 0 ? expectedWorkDaysInMonth : 26; // Fallback to 26
  const managerDailyCost = effectiveWorkDays > 0 ? totalManagerSalary / effectiveWorkDays : 0;
  const actualWorkDays = entries.reduce((sum, e) => sum + (Number(e.day_factor) || 0), 0);
  const computedManagerCost = managerDailyCost * actualWorkDays;

  // Employee-cost month-close: when closed, labor comes from actual invoices.
  const { data: lmcRows } = await supabase
    .from("labor_month_close")
    .select("business_id")
    .in("business_id", selectedBusinesses)
    .eq("period_year", targetYear)
    .eq("period_month", targetMonth)
    .eq("status", "closed");
  const lmcClosedIds = new Set(((lmcRows as Array<{ business_id: string }> | null) || []).map((r) => r.business_id));
  const laborMonthClosed =
    selectedBusinesses.length > 0 && selectedBusinesses.every((id) => lmcClosedIds.has(id));

  let laborActualFromInvoices = 0;
  if (laborMonthClosed) {
    const lmcLastDay = new Date(targetYear, targetMonth, 0).getDate();
    const lmcMonthStart = `${targetYear}-${String(targetMonth).padStart(2, "0")}-01`;
    const lmcMonthEnd = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(
      lmcLastDay
    ).padStart(2, "0")}`;
    const { data: lmcInvoices } = await supabase
      .from("invoices")
      .select("subtotal, supplier:suppliers!inner(expense_type)")
      .in("business_id", selectedBusinesses)
      .is("deleted_at", null)
      .gte("reference_date", lmcMonthStart)
      .lte("reference_date", lmcMonthEnd)
      .eq("supplier.expense_type", "employee_costs");
    laborActualFromInvoices = ((lmcInvoices as Array<{ subtotal: number | null }> | null) || []).reduce(
      (s, r) => s + Number(r.subtotal || 0),
      0
    );
  }

  const laborCostEstimate = (rawLaborCost + computedManagerCost) * totalMarkup;
  const laborCost = laborMonthClosed ? laborActualFromInvoices : laborCostEstimate;

  // ========================================================================
  // VAT divisor + incomeBeforeVat (page.tsx 1619-1629)
  // ========================================================================
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

  // Labor cost percentage + target + diff (page.tsx 1631-1639)
  const laborCostPct = incomeBeforeVat > 0 ? (laborCost / incomeBeforeVat) * 100 : 0;
  const laborCostTargetPct =
    goalsData.reduce((sum, g) => sum + (Number(g.labor_cost_target_pct) || 0), 0) /
    Math.max(goalsData.length, 1);
  const laborCostDiffPct = laborCostPct - laborCostTargetPct;
  const laborCostDiffAmount = (laborCostDiffPct * incomeBeforeVat) / 100;

  const laborCostMetric: LaborCostMetric = {
    amount: laborCost,
    pct: laborCostPct,
    targetPct: laborCostTargetPct,
    diffPct: laborCostDiffPct,
    diffIls: laborCostDiffAmount,
    monthClosed: laborMonthClosed,
  };

  // ========================================================================
  // COGS / עלות מכר (page.tsx 1877-1891)
  // page.tsx recomputes incomeBeforeVatForFood with an identical divisor — it
  // equals incomeBeforeVat above, so we reuse it directly.
  // ========================================================================
  const foodCost = totalGoodsPurchases;
  const foodCostPct = incomeBeforeVat > 0 ? (foodCost / incomeBeforeVat) * 100 : 0;
  const foodCostTargetPct =
    goalsData.reduce((sum, g) => sum + (Number(g.food_cost_target_pct) || 0), 0) /
    Math.max(goalsData.length, 1);
  const foodCostDiffPct = foodCostPct - foodCostTargetPct;

  const cogsMetric: CogsMetric = {
    amount: foodCost,
    pct: foodCostPct,
    targetPct: foodCostTargetPct,
    diffPct: foodCostDiffPct,
  };

  // ========================================================================
  // Operating expenses / הוצאות שוטפות (page.tsx 1893-1963)
  // ========================================================================
  const currentExpenses = totalCurrentExpenses;
  const currentExpensesPct = incomeBeforeVat > 0 ? (currentExpenses / incomeBeforeVat) * 100 : 0;
  const currentExpensesTargetAmount = currentExpensesBudgets.reduce(
    (sum, b) => sum + (Number(b.budget_amount) || 0),
    0
  );
  const currentExpensesTargetPct =
    incomeBeforeVat > 0 ? (currentExpensesTargetAmount / incomeBeforeVat) * 100 : 0;
  const currentExpensesDiffPct = currentExpensesPct - currentExpensesTargetPct;

  const operatingMetric: OperatingExpensesMetric = {
    amount: currentExpenses,
    pct: currentExpensesPct,
    targetAmount: currentExpensesTargetAmount,
    targetPct: currentExpensesTargetPct,
    diffPct: currentExpensesDiffPct,
  };

  // ========================================================================
  // Managed products (page.tsx 1853-1870, 2249-2293 — current period only)
  // ========================================================================
  const entryIds = entries.map((e) => e.id);
  const productUsageResult =
    entryIds.length > 0
      ? await supabase
          .from("daily_product_usage")
          .select("daily_entry_id, product_id, quantity, unit_cost_at_time")
          .in("daily_entry_id", entryIds)
      : {
          data: [] as Array<{ product_id: string; quantity: number | null }>,
        };

  const productUsageData =
    (productUsageResult.data as Array<{ product_id: string; quantity: number | null }> | null) ||
    [];

  const productQuantities: Record<string, number> = {};
  productUsageData.forEach((p) => {
    const quantity = Number(p.quantity) || 0;
    if (!productQuantities[p.product_id]) productQuantities[p.product_id] = 0;
    productQuantities[p.product_id] += quantity;
  });

  const managedProducts: ManagedProductMetric[] = allManagedProducts.map((product) => {
    const unitCost = Number(product.unit_cost) || 0;
    const totalQuantity = productQuantities[product.id] || 0;
    const totalCost = unitCost * totalQuantity;
    const currentPct = incomeBeforeVat > 0 ? (totalCost / incomeBeforeVat) * 100 : 0;
    return {
      id: product.id,
      name: product.name,
      unit: product.unit,
      quantity: totalQuantity,
      unitCost,
      amount: totalCost,
      pct: currentPct,
      targetPct:
        product.target_pct !== null && product.target_pct !== undefined
          ? Number(product.target_pct)
          : null,
    };
  });

  return {
    incomeBeforeVat,
    laborCost: laborCostMetric,
    cogs: cogsMetric,
    operating: operatingMetric,
    managedProducts,
  };
}
