import type { SupabaseClient } from "@supabase/supabase-js";
import { formatLocalDate } from "./dates";
import type { MetricsDateRange, ProfitLossReport, ProfitLossExpenseRow } from "./types";

// ---------------------------------------------------------------------------
// getProfitLossReport
//
// Faithful port of the P&L (רווח והפסד) computation from the reports page
// (`fetchData` in src/app/(dashboard)/reports/page.tsx). Numbers match the
// monthly report to the cent; line references below point at reports/page.tsx.
//
// Output mirrors the three headline blocks of the report:
//   - totalResult / totalResultPct  -> "סה\"כ תוצאות רווח/הפסד" (operating
//     profit + its % of revenue). reports/page.tsx 1288-1289, 1397-1402.
//   - revenue { target, actual, diffIls, diffPct } -> the income summary card
//     "סה\"כ הכנסות ללא מע\"מ". reports/page.tsx 1521-1561.
//   - expenses[] per category (name / target / actual / diffIls / remaining)
//     -> "פירוט ההוצאות" table parent rows. reports/page.tsx 1021-1253.
//
// Differences from the report page:
//   - Operates on a SINGLE businessId (the page sums an array of
//     selectedBusinesses). We pass a single-element array `[businessId]` so the
//     per-business averaging (avgMarkup, vatDivisor) is preserved unchanged.
//   - Takes a supabase client as a parameter (server or browser).
//   - Sub-categories / per-supplier drill-down are NOT part of the output shape
//     (the report's parent-row totals are what's reported). The supplier-level
//     bucketing is still performed because the goods-cost parent total depends
//     on it (totalGoodsExpenses), exactly as page.tsx does.
//
// VAT convention (page.tsx 848-849): businesses.vat_percentage is stored as a
// decimal (0.18 = 18%). The single-business divisor uses businessData[0] just
// like the report (the report does NOT average VAT across businesses for this
// page — it reads businessData?.[0]).
// ---------------------------------------------------------------------------
export async function getProfitLossReport(
  supabase: SupabaseClient,
  businessId: string,
  dateRange: MetricsDateRange,
  view: "monthly" | "annual"
): Promise<ProfitLossReport> {
  const selectedBusinesses = [businessId];

  const year = dateRange.start.getFullYear();
  const month = dateRange.start.getMonth() + 1; // 1-12 for DB
  const startDate = formatLocalDate(dateRange.start);
  const endDate = formatLocalDate(dateRange.end);

  // ========================================================================
  // BATCH 1 — same queries the report runs (reports/page.tsx 681-737)
  // For annual view, invoices/delivery-notes/daily-entries span the full
  // dateRange; goals/supplier_budgets are still keyed per (year, month). When
  // view==='annual' month is January (start of the range) — see route.ts which
  // builds the Jan-1..Dec-31 range. Goals/budgets are therefore the January
  // targets; this matches "annual = the whole-year actuals against the
  // configured targets" interpretation. (Documented as ambiguous in report.)
  // ========================================================================
  const [
    categoriesResult,
    businessResult,
    goalsResult,
    invoicesResult,
    deliveryNotesResult,
    supplierBudgetsResult,
    dailyEntriesResult,
  ] = await Promise.all([
    supabase
      .from("expense_categories")
      .select("id, name, parent_id")
      .in("business_id", selectedBusinesses)
      .is("deleted_at", null)
      .eq("is_active", true),
    supabase
      .from("businesses")
      .select("vat_percentage, markup_percentage, manager_monthly_salary")
      .in("id", selectedBusinesses),
    supabase
      .from("goals")
      .select("*")
      .in("business_id", selectedBusinesses)
      .eq("year", year)
      .eq("month", month)
      .is("deleted_at", null),
    supabase
      .from("invoices")
      .select(
        "subtotal, supplier_id, status, invoice_number, attachment_url, supplier:suppliers(name, expense_category_id, expense_type, is_fixed_expense)"
      )
      .in("business_id", selectedBusinesses)
      .is("deleted_at", null)
      .in("invoice_type", ["current", "goods", "employees"])
      .gte("reference_date", startDate)
      .lte("reference_date", endDate),
    supabase
      .from("delivery_notes")
      .select(
        "subtotal, supplier_id, supplier:suppliers(name, expense_category_id, expense_type, is_fixed_expense)"
      )
      .in("business_id", selectedBusinesses)
      .is("invoice_id", null)
      .gte("delivery_date", startDate)
      .lte("delivery_date", endDate),
    supabase
      .from("supplier_budgets")
      .select(
        "budget_amount, supplier_id, supplier:suppliers(name, expense_category_id, expense_type, is_fixed_expense)"
      )
      .in("business_id", selectedBusinesses)
      .eq("year", year)
      .eq("month", month)
      .is("deleted_at", null),
    supabase
      .from("daily_entries")
      .select("total_register, labor_cost, manager_daily_cost, day_factor, business_id")
      .in("business_id", selectedBusinesses)
      .is("deleted_at", null)
      .gte("entry_date", startDate)
      .lte("entry_date", endDate),
  ]);

  // Schedule + day exceptions (reports/page.tsx 757-768).
  const [scheduleResult, dayExceptionsResult] = await Promise.all([
    supabase
      .from("business_schedule")
      .select("day_of_week, day_factor")
      .in("business_id", selectedBusinesses),
    supabase
      .from("business_day_exceptions")
      .select("exception_date, day_factor")
      .in("business_id", selectedBusinesses)
      .gte("exception_date", startDate)
      .lte("exception_date", endDate),
  ]);

  // labor_month_close (reports/page.tsx 771-782).
  const laborCloseResult = await supabase
    .from("labor_month_close")
    .select("business_id")
    .in("business_id", selectedBusinesses)
    .eq("period_year", year)
    .eq("period_month", month)
    .eq("status", "closed");

  type SupplierJoin = {
    name: string | null;
    expense_category_id: string | null;
    expense_type: string | null;
    is_fixed_expense: boolean | null;
  };
  type CategoryRow = { id: string; name: string; parent_id: string | null };
  type GoalRow = {
    revenue_target: number | null;
    current_expenses_target: number | null;
    food_cost_target_pct: number | null;
    labor_cost_target_pct: number | null;
    markup_percentage: number | null;
    manager_monthly_salary: number | null;
    expected_work_days: number | null;
  };
  type BusinessRow = {
    vat_percentage: number | null;
    markup_percentage: number | null;
    manager_monthly_salary: number | null;
  };
  type DailyEntryRow = {
    total_register: number | null;
    labor_cost: number | null;
    manager_daily_cost: number | null;
    day_factor: number | null;
  };

  const categoriesData = (categoriesResult.data as CategoryRow[] | null) || [];
  const businessData = (businessResult.data as BusinessRow[] | null) || [];
  const goalsData = (goalsResult.data as GoalRow[] | null) || [];
  const invoicesData =
    (invoicesResult.data as Array<{
      subtotal: number | null;
      supplier_id: string | null;
      status: string | null;
      invoice_number: string | null;
      attachment_url: string | null;
      supplier: unknown;
    }> | null) || [];
  const deliveryNotesData =
    (deliveryNotesResult.data as Array<{
      subtotal: number | null;
      supplier_id: string | null;
      supplier: unknown;
    }> | null) || [];
  const supplierBudgetsData =
    (supplierBudgetsResult.data as Array<{
      budget_amount: number | null;
      supplier_id: string | null;
      supplier: unknown;
    }> | null) || [];
  const dailyEntries = (dailyEntriesResult.data as DailyEntryRow[] | null) || [];
  const scheduleData =
    (scheduleResult.data as Array<{ day_of_week: number; day_factor: number | null }> | null) || [];
  const dayExceptionsData =
    (dayExceptionsResult.data as Array<{ exception_date: string; day_factor: number }> | null) || [];
  const laborCloseData =
    (laborCloseResult.data as Array<{ business_id: string }> | null) || [];

  // labor month close — closed only when EVERY selected business is closed
  // (reports/page.tsx 778-782).
  const closedBusinessIds = new Set(laborCloseData.map((r) => r.business_id));
  const laborMonthClosed =
    selectedBusinesses.length > 0 && selectedBusinesses.every((id) => closedBusinessIds.has(id));

  const goal = goalsData[0];

  // ========================================================================
  // Totals from daily entries (reports/page.tsx 797-799)
  // ========================================================================
  const totalRegister = dailyEntries.reduce((sum, d) => sum + (Number(d.total_register) || 0), 0);
  const rawLaborCost = dailyEntries.reduce((sum, d) => sum + (Number(d.labor_cost) || 0), 0);

  // markup (reports/page.tsx 802-804)
  const avgMarkup =
    goal?.markup_percentage != null
      ? Number(goal.markup_percentage)
      : businessData.reduce((sum, b) => sum + (Number(b.markup_percentage) || 1), 0) /
        Math.max(businessData.length, 1);

  // manager salary (reports/page.tsx 805-807)
  const totalManagerSalary =
    goal?.manager_monthly_salary != null
      ? Number(goal.manager_monthly_salary)
      : businessData.reduce((sum, b) => sum + (Number(b.manager_monthly_salary) || 0), 0);

  // ------------------------------------------------------------------------
  // Expected work days from schedule + exceptions (reports/page.tsx 810-843)
  // For annual view we compute expected/actual work days across the FULL range
  // (loop runs from dateRange.start to dateRange.end), which lines up with the
  // annual daily-entries window.
  // ------------------------------------------------------------------------
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

  const exceptionMap: Record<string, number> = {};
  dayExceptionsData.forEach((e) => {
    const d = new Date(e.exception_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    exceptionMap[key] = Number(e.day_factor);
  });

  let scheduleWorkDays = 0;
  const curDate = new Date(dateRange.start);
  const lastDay = new Date(dateRange.end);
  while (curDate <= lastDay) {
    const dateKey = `${curDate.getFullYear()}-${String(curDate.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(curDate.getDate()).padStart(2, "0")}`;
    if (exceptionMap[dateKey] !== undefined) {
      scheduleWorkDays += exceptionMap[dateKey];
    } else {
      scheduleWorkDays += avgScheduleDayFactors[curDate.getDay()] || 0;
    }
    curDate.setDate(curDate.getDate() + 1);
  }

  // goal.expected_work_days override only meaningful in monthly view
  // (reports/page.tsx 841-843).
  const expectedWorkDays =
    view === "monthly" && goal?.expected_work_days != null && Number(goal.expected_work_days) > 0
      ? Number(goal.expected_work_days)
      : scheduleWorkDays;
  const managerDailyCost = expectedWorkDays > 0 ? totalManagerSalary / expectedWorkDays : 0;
  const actualWorkDays = dailyEntries.reduce((sum, e) => sum + (Number(e.day_factor) || 0), 0);

  // VAT divisor (reports/page.tsx 848-849)
  const vatPercentage = Number(businessData?.[0]?.vat_percentage || 0);
  const vatDivisor = vatPercentage > 0 ? 1 + vatPercentage : 1;

  // Labor cost with markup (reports/page.tsx 854-862)
  const computedManagerCost = managerDailyCost * actualWorkDays;
  const totalLaborCost = (rawLaborCost + computedManagerCost) * avgMarkup;
  const laborOnlyCost = rawLaborCost * avgMarkup;
  const managerOnlyCost = computedManagerCost * avgMarkup;
  void managerOnlyCost; // computed for fidelity; parent total uses totalLaborCost
  const totalRevenue = totalRegister / vatDivisor;

  // ========================================================================
  // Per-category / per-supplier actuals (reports/page.tsx 864-980)
  // ========================================================================
  const categoryActuals = new Map<string, number>();
  const supplierActuals = new Map<string, number>();
  const supplierExpenseTypes = new Map<string, string>();
  const supplierCategoryMap = new Map<string, string>();
  let totalGoodsExpenses = 0;
  let totalCurrentExpenses = 0;
  let laborEmployeeCostsActual = 0;

  for (const inv of invoicesData) {
    const supplier = inv.supplier as SupplierJoin | null;
    const catId = supplier?.expense_category_id;
    const expType = supplier?.expense_type;
    const supplierId = inv.supplier_id;
    const amount = Number(inv.subtotal);
    if (catId) {
      categoryActuals.set(catId, (categoryActuals.get(catId) || 0) + amount);
    }
    if (supplierId) {
      supplierActuals.set(supplierId, (supplierActuals.get(supplierId) || 0) + amount);
      if (catId) supplierCategoryMap.set(supplierId, catId);
      if (expType) supplierExpenseTypes.set(supplierId, expType);
    }
    if (expType === "goods_purchases") totalGoodsExpenses += amount;
    else if (expType === "current_expenses") totalCurrentExpenses += amount;
    else if (expType === "employee_costs") laborEmployeeCostsActual += amount;
  }

  for (const dn of deliveryNotesData) {
    const supplier = dn.supplier as SupplierJoin | null;
    const catId = supplier?.expense_category_id;
    const expType = supplier?.expense_type;
    const supplierId = dn.supplier_id;
    const amount = Number(dn.subtotal);
    if (catId) {
      categoryActuals.set(catId, (categoryActuals.get(catId) || 0) + amount);
    }
    if (supplierId) {
      supplierActuals.set(supplierId, (supplierActuals.get(supplierId) || 0) + amount);
      if (catId) supplierCategoryMap.set(supplierId, catId);
      if (expType) supplierExpenseTypes.set(supplierId, expType);
    }
    if (expType === "goods_purchases") totalGoodsExpenses += amount;
    else if (expType === "current_expenses") totalCurrentExpenses += amount;
  }

  // Supplier budgets per category + per supplier (reports/page.tsx 952-980)
  const categoryBudgets = new Map<string, number>();
  const supplierBudgets = new Map<string, number>();
  for (const sb of supplierBudgetsData) {
    const supplier = sb.supplier as SupplierJoin | null;
    const catId = supplier?.expense_category_id;
    const supplierId = sb.supplier_id;
    const budgetAmount = Number(sb.budget_amount || 0);
    if (catId) {
      categoryBudgets.set(catId, (categoryBudgets.get(catId) || 0) + budgetAmount);
    }
    if (supplierId) {
      supplierBudgets.set(supplierId, budgetAmount);
      if (catId) supplierCategoryMap.set(supplierId, catId);
      if (supplier?.expense_type) supplierExpenseTypes.set(supplierId, supplier.expense_type);
      // Fixed expense supplier with no invoice this month → actual = budget
      if (supplier?.is_fixed_expense && budgetAmount > 0 && !supplierActuals.has(supplierId)) {
        supplierActuals.set(supplierId, budgetAmount);
        if (catId) categoryActuals.set(catId, (categoryActuals.get(catId) || 0) + budgetAmount);
        if (supplier.expense_type === "current_expenses") totalCurrentExpenses += budgetAmount;
        else if (supplier.expense_type === "goods_purchases") totalGoodsExpenses += budgetAmount;
      }
    }
  }

  // ========================================================================
  // Targets (reports/page.tsx 999-1004)
  // ========================================================================
  const expensesTarget = Number(goal?.current_expenses_target || 0) / vatDivisor;
  const foodCostTargetPct = Number(goal?.food_cost_target_pct || 0);
  const revenueTargetBeforeVat = Number(goal?.revenue_target || 0) / vatDivisor;
  const foodCostTarget = (foodCostTargetPct / 100) * revenueTargetBeforeVat;
  const laborCostTargetPct = Number(goal?.labor_cost_target_pct || 0);
  const laborCostTarget = (laborCostTargetPct / 100) * revenueTargetBeforeVat;

  // ========================================================================
  // Build expense category parent rows (reports/page.tsx 1006-1253)
  // ========================================================================
  const laborCostNames = new Set(["עלות עובדים", "עלויות עובדים"]);
  const laborParents = categoriesData.filter((c) => !c.parent_id && laborCostNames.has(c.name));
  const laborParentIds = new Set(laborParents.map((c) => c.id));
  const primaryLaborParent =
    laborParents.find((c) => c.name === "עלות עובדים") || laborParents[0];
  const parentCategoriesRaw = categoriesData.filter(
    (c) => !c.parent_id && !(laborCostNames.has(c.name) && c.id !== primaryLaborParent?.id)
  );
  const parentCategories =
    laborParents.length > 0
      ? parentCategoriesRaw
      : [...parentCategoriesRaw, { id: "__virtual_labor_parent__", name: "עלות עובדים", parent_id: null }];
  const childCategories = categoriesData.filter((c) => c.parent_id);

  const expenses: ProfitLossExpenseRow[] = parentCategories
    .map((parent): ProfitLossExpenseRow => {
      const isGoodsCost = parent.name === "עלות מכר";
      const isLaborCost = laborCostNames.has(parent.name);
      const children = isLaborCost
        ? childCategories.filter((c) => laborParentIds.has(c.parent_id!))
        : childCategories.filter((c) => c.parent_id === parent.id);

      // children actual/budget (reports/page.tsx 1166-1167)
      const childrenActual =
        children.reduce((sum, c) => sum + (categoryActuals.get(c.id) || 0), 0) ||
        categoryActuals.get(parent.id) ||
        0;
      const childrenBudget =
        children.reduce((sum, c) => sum + (categoryBudgets.get(c.id) || 0), 0) ||
        categoryBudgets.get(parent.id) ||
        0;

      const laborInvoiceActual = isLaborCost
        ? children.reduce((sum, c) => sum + (categoryActuals.get(c.id) || 0), 0)
        : 0;

      // parent actual (reports/page.tsx 1233)
      const parentActual = isGoodsCost
        ? Math.max(childrenActual, totalGoodsExpenses)
        : isLaborCost
          ? laborMonthClosed
            ? laborEmployeeCostsActual
            : totalLaborCost + laborInvoiceActual
          : childrenActual;
      // parent target (reports/page.tsx 1234)
      const parentTarget = isGoodsCost
        ? foodCostTarget
        : isLaborCost
          ? laborCostTarget
          : childrenBudget;
      const parentDiff = parentTarget - parentActual;
      const parentRemaining =
        parentTarget > 0 ? ((parentTarget - parentActual) / parentTarget) * 100 : 0;

      return {
        id: parent.id,
        name: parent.name,
        target: parentTarget,
        actual: parentActual,
        diffIls: parentDiff,
        remaining: parentRemaining,
      };
    })
    // Keep rows with activity (reports/page.tsx 1253 — actual>0 OR target>0).
    // Note: page.tsx also keeps rows with subcategories.length>0, but
    // subcategories aren't in this output shape, so we mirror the numeric gate.
    .filter((cat) => cat.actual > 0 || cat.target > 0);

  // Fixed display order (reports/page.tsx 1256-1261)
  const categoryOrder = ["עלות מכר", "עלות עובדים", "הוצאות שיווק ומכירות", "הוצאות תפעול"];
  expenses.sort((a, b) => {
    const aIdx = categoryOrder.indexOf(a.name);
    const bIdx = categoryOrder.indexOf(b.name);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  // ========================================================================
  // Summary totals (reports/page.tsx 1270-1301)
  // ========================================================================
  const allExpensesActual =
    totalGoodsExpenses +
    totalCurrentExpenses +
    (laborMonthClosed ? laborEmployeeCostsActual : totalLaborCost);

  const operatingProfit = totalRevenue - allExpensesActual;
  const operatingProfitPct = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0;

  // Revenue card (reports/page.tsx 1521-1561):
  //   actual = totalRevenue, target = revenueTargetBeforeVat,
  //   diffIls = actual - target,
  //   diffPct = (actual / target) * 100  (the "% of target" the card shows).
  const revenueTarget = revenueTargetBeforeVat;
  const revenueDiffIls = totalRevenue - revenueTarget;
  const revenueDiffPct = revenueTarget > 0 ? (totalRevenue / revenueTarget) * 100 : 0;

  return {
    view,
    totalResult: operatingProfit,
    totalResultPct: operatingProfitPct,
    revenue: {
      target: revenueTarget,
      actual: totalRevenue,
      diffIls: revenueDiffIls,
      diffPct: revenueDiffPct,
    },
    expenses,
  };
}
