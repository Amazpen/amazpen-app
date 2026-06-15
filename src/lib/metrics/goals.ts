import type { SupabaseClient } from "@supabase/supabase-js";
import { formatLocalDate } from "./dates";
import type { GoalsVsActual, GoalsRow, MetricsDateRange } from "./types";

// ---------------------------------------------------------------------------
// getGoalsVsActual
//
// Pure async function that replicates the GOALS computation from the יעדים
// page (`fetchData` in src/app/(dashboard)/goals/page.tsx). It is a faithful
// port — formulas, fallbacks and edge cases mirror page.tsx so the numbers
// match the goals table to the cent. Line references below point at
// goals/page.tsx.
//
// Three views map to the page's three tabs:
//   - 'kpi'       → "יעדי KPI"        (% KPI + ₪ revenue/avg-ticket/expenses rows)
//   - 'operating' → "יעד VS שוטפות"   (per-category current expenses, target vs actual ₪)
//   - 'goods'     → "יעד VS קניות סחורה" (per-supplier goods purchases, target vs actual ₪)
//
// Differences from the page:
//   - Operates on a SINGLE businessId (the page sums an array of
//     selectedBusinesses). We pass a single-element array `[businessId]` so the
//     per-business averaging logic (markup/vat) is preserved unchanged.
//   - Takes a supabase client as a parameter (server or browser).
//   - Does NOT apply the fixed-expense "actual = budget" fallback for the
//     `actual` column? — it DOES, exactly as page.tsx does, so the numbers match.
//
// Status semantics (page.tsx 1308-1318):
//   percentage = target > 0 ? (actual / target) * 100 : 0
//   For every goals/operating/goods row except income KPIs, the row is an
//   EXPENSE: diff (remaining) = target - actual (positive = under budget).
//   For income KPIs (revenue, avg-ticket) it is NOT an expense:
//   diff = actual - target (positive = above goal).
//   status = "under" | "over" | "on_target" derived from getStatusColor:
//     actual === target            → 'on_target' (white)
//     expense & target===0 & a>0   → 'over'  (red)
//     expense & pct <= 100         → 'under' (green)
//     expense & pct  > 100         → 'over'  (red)
//     income  & pct >= 100         → 'under' (green, i.e. met/over goal)
//     income  & pct  < 100         → 'over'  (red, i.e. below goal)
// ---------------------------------------------------------------------------

type SupplierRow = {
  id: string;
  name: string;
  expense_category_id: string | null;
  expense_type: string | null;
  is_fixed_expense: boolean | null;
  vat_type: string | null;
  monthly_expense_amount: number | null;
};
type CategoryRow = { id: string; name: string; parent_id: string | null };
type SupplierBudgetRow = { supplier_id: string; budget_amount: number | null };
type InvoiceRow = {
  supplier_id: string;
  subtotal: number | null;
  invoice_type: string | null;
};
type DailyEntryRow = {
  id: string;
  total_register: number | null;
  labor_cost: number | null;
  day_factor: number | null;
};
type BusinessRow = {
  id: string;
  markup_percentage: number | null;
  manager_monthly_salary: number | null;
  vat_percentage: number | null;
};
type ScheduleRow = { day_of_week: number; day_factor: number | null };
type DayExceptionRow = { exception_date: string; day_factor: number };
type GoalRow = {
  id: string;
  revenue_target: number | null;
  labor_cost_target_pct: number | null;
  food_cost_target_pct: number | null;
  goods_expenses_target: number | null;
  current_expenses_target: number | null;
  markup_percentage: number | null;
  vat_percentage: number | null;
  expected_work_days: number | null;
};
type IncomeSourceRow = { id: string; name: string };
type IncomeSourceGoalRow = {
  income_source_id: string;
  avg_ticket_target: number | null;
};
type BreakdownRow = {
  income_source_id: string;
  amount: number | null;
  orders_count: number | null;
};
type ManagedProductRow = {
  id: string;
  name: string;
  unit: string | null;
  unit_cost: number | null;
  target_pct: number | null;
};
type ProductUsageRow = {
  product_id: string;
  quantity: number | null;
  unit_cost_at_time: number | null;
};

/**
 * Derive the discrete status from the same conditions getStatusColor uses
 * (goals/page.tsx 89-102). `isExpense=true` for cost rows (lower is better).
 */
function deriveStatus(
  actual: number,
  target: number,
  isExpense: boolean
): GoalsRow["status"] {
  if (actual === target) return "on_target";
  const percentage = target > 0 ? (actual / target) * 100 : 0;
  if (isExpense) {
    if (target === 0 && actual > 0) return "over";
    return percentage <= 100 ? "under" : "over";
  }
  return percentage >= 100 ? "under" : "over";
}

export async function getGoalsVsActual(
  supabase: SupabaseClient,
  businessId: string,
  dateRange: MetricsDateRange,
  view: "kpi" | "operating" | "goods"
): Promise<GoalsVsActual> {
  const selectedBusinesses = [businessId];

  // page.tsx 186-203: month/year + date strings
  const month = dateRange.start.getMonth() + 1; // 1-12
  const year = dateRange.start.getFullYear();
  const startDate = formatLocalDate(dateRange.start);
  const endDate = formatLocalDate(dateRange.end);

  // ========================================================================
  // BATCH 1 — base data (page.tsx 209-255)
  // ========================================================================
  const [
    goalsResult,
    categoriesResult,
    supplierBudgetsResult,
    suppliersResult,
    invoicesResult,
  ] = await Promise.all([
    supabase
      .from("goals")
      .select("*")
      .in("business_id", selectedBusinesses)
      .eq("year", year)
      .eq("month", month)
      .is("deleted_at", null),
    supabase
      .from("expense_categories")
      .select("id, name, business_id, parent_id")
      .in("business_id", selectedBusinesses)
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("display_order"),
    supabase
      .from("supplier_budgets")
      .select("supplier_id, budget_amount")
      .in("business_id", selectedBusinesses)
      .eq("year", year)
      .eq("month", month)
      .is("deleted_at", null),
    supabase
      .from("suppliers")
      .select(
        "id, name, expense_category_id, expense_type, is_fixed_expense, vat_type, monthly_expense_amount"
      )
      .in("business_id", selectedBusinesses)
      .is("deleted_at", null)
      .eq("is_active", true),
    supabase
      .from("invoices")
      .select("supplier_id, subtotal, invoice_type")
      .in("business_id", selectedBusinesses)
      .is("deleted_at", null)
      .gte("reference_date", startDate)
      .lte("reference_date", endDate),
  ]);

  const goalsData = (goalsResult.data as GoalRow[] | null) || [];
  const categoriesData = (categoriesResult.data as CategoryRow[] | null) || [];
  const supplierBudgetsData =
    (supplierBudgetsResult.data as SupplierBudgetRow[] | null) || [];
  const suppliersData = (suppliersResult.data as SupplierRow[] | null) || [];
  const invoicesData = (invoicesResult.data as InvoiceRow[] | null) || [];

  const goal = goalsData[0];

  // page.tsx 266-293: supplier → category / expense_type / name maps + budgets
  const supplierCategoryMap = new Map<string, string>();
  const supplierExpenseTypeMap = new Map<string, string>();
  const namesMap = new Map<string, string>();
  const fixedInfoMap = new Map<string, { isFixed: boolean; vatType: string }>();
  suppliersData.forEach((s) => {
    namesMap.set(s.id, s.name);
    if (s.expense_category_id) supplierCategoryMap.set(s.id, s.expense_category_id);
    if (s.expense_type) supplierExpenseTypeMap.set(s.id, s.expense_type);
    fixedInfoMap.set(s.id, {
      isFixed: !!s.is_fixed_expense,
      vatType: s.vat_type || "none",
    });
  });

  const supplierBudgetMap = new Map<string, number>();
  supplierBudgetsData.forEach((b) => {
    supplierBudgetMap.set(b.supplier_id, Number(b.budget_amount) || 0);
  });
  // page.tsx 289-293: fixed-expense suppliers with no budget → monthly_expense_amount
  suppliersData.forEach((s) => {
    if (
      s.is_fixed_expense &&
      !supplierBudgetMap.has(s.id) &&
      Number(s.monthly_expense_amount) > 0
    ) {
      supplierBudgetMap.set(s.id, Number(s.monthly_expense_amount));
    }
  });

  // page.tsx 299-324: per-supplier actuals split by expense type + fixed fallback
  const perSupplierCurrentActuals = new Map<string, number>();
  const perSupplierGoodsActuals = new Map<string, number>();
  invoicesData.forEach((inv) => {
    const expType = supplierExpenseTypeMap.get(inv.supplier_id);
    if (expType === "current_expenses") {
      const cur = perSupplierCurrentActuals.get(inv.supplier_id) || 0;
      perSupplierCurrentActuals.set(inv.supplier_id, cur + Number(inv.subtotal));
    } else if (expType === "goods_purchases") {
      const cur = perSupplierGoodsActuals.get(inv.supplier_id) || 0;
      perSupplierGoodsActuals.set(inv.supplier_id, cur + Number(inv.subtotal));
    }
  });
  // page.tsx 316-324: fixed current_expenses suppliers with no invoice → actual = budget
  suppliersData.forEach((s) => {
    if (s.is_fixed_expense && s.expense_type === "current_expenses") {
      const hasInvoice = perSupplierCurrentActuals.has(s.id);
      const budget = supplierBudgetMap.get(s.id) || 0;
      if (!hasInvoice && budget > 0) {
        perSupplierCurrentActuals.set(s.id, budget);
      }
    }
  });

  // ========================================================================
  // VIEW: operating ("יעד VS שוטפות") — per-category current expenses
  // (page.tsx 331-384)
  // ========================================================================
  if (view === "operating") {
    const categoryActuals = new Map<string, number>();
    const categoryTargets = new Map<string, number>();
    categoriesData.forEach((cat) => {
      categoryActuals.set(cat.id, 0);
      categoryTargets.set(cat.id, 0);
    });

    // actuals by category (only current_expenses suppliers with a category)
    suppliersData
      .filter((s) => s.expense_type === "current_expenses" && s.expense_category_id)
      .forEach((s) => {
        const actual = perSupplierCurrentActuals.get(s.id) || 0;
        if (actual > 0) {
          const cur = categoryActuals.get(s.expense_category_id as string) || 0;
          categoryActuals.set(s.expense_category_id as string, cur + actual);
        }
      });

    // budgets (targets) by category (only current_expenses suppliers)
    suppliersData
      .filter((s) => s.expense_type === "current_expenses")
      .forEach((s) => {
        const catId = s.expense_category_id;
        const budget = supplierBudgetMap.get(s.id) || 0;
        if (catId && budget > 0) {
          const cur = categoryTargets.get(catId) || 0;
          categoryTargets.set(catId, cur + budget);
        }
      });

    const rows: GoalsRow[] = categoriesData
      .map((cat): GoalsRow | null => {
        const catSupplierIds = suppliersData
          .filter(
            (s) =>
              s.expense_category_id === cat.id &&
              s.expense_type === "current_expenses"
          )
          .map((s) => s.id);
        const target = categoryTargets.get(cat.id) || 0;
        const actual = categoryActuals.get(cat.id) || 0;
        // page.tsx 370: skip empty categories
        if (catSupplierIds.length === 0 && actual === 0 && target === 0) return null;
        return {
          category: cat.name,
          target,
          actual,
          remaining: target - actual,
          status: deriveStatus(actual, target, true),
        };
      })
      .filter((r): r is GoalsRow => r !== null);
    // page.tsx 383: sort by name (Hebrew)
    rows.sort((a, b) => a.category.localeCompare(b.category, "he"));

    return { view, period: { month, year }, rows };
  }

  // ========================================================================
  // VIEW: goods ("יעד VS קניות סחורה") — per-supplier goods purchases
  // (page.tsx 409-443)
  // ========================================================================
  if (view === "goods") {
    const goodsSuppliers = suppliersData.filter(
      (s) => s.expense_type === "goods_purchases"
    );
    const rows: GoalsRow[] = goodsSuppliers
      .map((supplier): GoalsRow | null => {
        const actual = perSupplierGoodsActuals.get(supplier.id) || 0;
        const target = supplierBudgetMap.get(supplier.id) || 0;
        // page.tsx 426: skip suppliers with no data
        if (actual === 0 && target === 0) return null;
        return {
          category: namesMap.get(supplier.id) || supplier.name,
          target,
          actual,
          remaining: target - actual,
          status: deriveStatus(actual, target, true),
        };
      })
      .filter((r): r is GoalsRow => r !== null);
    rows.sort((a, b) => a.category.localeCompare(b.category, "he"));

    return { view, period: { month, year }, rows };
  }

  // ========================================================================
  // VIEW: kpi ("יעדי KPI") — % + ₪ KPI rows
  // (page.tsx 448-731)
  // ========================================================================
  // Reference maps used by category-actual aggregation below to silence lint
  void supplierCategoryMap;

  // BATCH 2 — daily entries, business, schedule, exceptions (page.tsx 448-477)
  const [dailyEntriesResult, businessResult, scheduleResult, dayExceptionsResult] =
    await Promise.all([
      supabase
        .from("daily_entries")
        .select("id, total_register, labor_cost, day_factor")
        .in("business_id", selectedBusinesses)
        .is("deleted_at", null)
        .gte("entry_date", startDate)
        .lte("entry_date", endDate),
      supabase
        .from("businesses")
        .select("id, markup_percentage, manager_monthly_salary, vat_percentage")
        .in("id", selectedBusinesses),
      supabase
        .from("business_schedule")
        .select("business_id, day_of_week, day_factor")
        .in("business_id", selectedBusinesses),
      supabase
        .from("business_day_exceptions")
        .select("exception_date, day_factor")
        .in("business_id", selectedBusinesses)
        .gte("exception_date", startDate)
        .lte("exception_date", endDate),
    ]);

  const dailyEntries = (dailyEntriesResult.data as DailyEntryRow[] | null) || [];
  const businessData = (businessResult.data as BusinessRow[] | null) || [];
  const scheduleData = (scheduleResult.data as ScheduleRow[] | null) || [];
  const dayExceptionsData =
    (dayExceptionsResult.data as DayExceptionRow[] | null) || [];

  // page.tsx 480-489: totals + labor markup/manager
  const totalRevenue = dailyEntries.reduce(
    (sum, d) => sum + Number(d.total_register || 0),
    0
  );
  const rawLaborCost = dailyEntries.reduce(
    (sum, d) => sum + Number(d.labor_cost || 0),
    0
  );
  const avgMarkup =
    goal?.markup_percentage != null
      ? Number(goal.markup_percentage)
      : businessData.reduce((sum, b) => sum + (Number(b.markup_percentage) || 1), 0) /
        Math.max(businessData.length, 1);
  const totalManagerSalary = businessData.reduce(
    (sum, b) => sum + (Number(b.manager_monthly_salary) || 0),
    0
  );

  // page.tsx 494-529: expected work days from schedule + exceptions
  const scheduleDayFactors: Record<number, number[]> = {};
  scheduleData.forEach((s) => {
    if (!scheduleDayFactors[s.day_of_week]) scheduleDayFactors[s.day_of_week] = [];
    scheduleDayFactors[s.day_of_week].push(Number(s.day_factor) || 0);
  });
  const avgScheduleDayFactors: Record<number, number> = {};
  Object.keys(scheduleDayFactors).forEach((dow) => {
    const factors = scheduleDayFactors[Number(dow)];
    avgScheduleDayFactors[Number(dow)] =
      factors.reduce((a, b) => a + b, 0) / factors.length;
  });

  const exceptionMap: Record<string, number> = {};
  dayExceptionsData.forEach((e) => {
    const d = new Date(e.exception_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    exceptionMap[key] = Number(e.day_factor);
  });

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  let scheduleWorkDays = 0;
  const curDate = new Date(firstDay);
  while (curDate <= lastDay) {
    const dateKey = `${curDate.getFullYear()}-${String(
      curDate.getMonth() + 1
    ).padStart(2, "0")}-${String(curDate.getDate()).padStart(2, "0")}`;
    if (exceptionMap[dateKey] !== undefined) {
      scheduleWorkDays += exceptionMap[dateKey];
    } else {
      scheduleWorkDays += avgScheduleDayFactors[curDate.getDay()] || 0;
    }
    curDate.setDate(curDate.getDate() + 1);
  }

  // page.tsx 534-541: expected work days (goal override) + labor cost
  const expectedWorkDays =
    goal?.expected_work_days != null && Number(goal.expected_work_days) > 0
      ? Number(goal.expected_work_days)
      : scheduleWorkDays;
  const managerDailyCost =
    expectedWorkDays > 0 ? totalManagerSalary / expectedWorkDays : 0;
  const actualWorkDays = dailyEntries.reduce(
    (sum, e) => sum + (Number(e.day_factor) || 0),
    0
  );
  const totalLaborCost =
    (rawLaborCost + managerDailyCost * actualWorkDays) * avgMarkup;

  // page.tsx 544-548: VAT divisor + income before VAT
  const avgVatPercentage =
    goal?.vat_percentage != null
      ? Number(goal.vat_percentage)
      : businessData.reduce((sum, b) => sum + (Number(b.vat_percentage) || 0), 0) /
        Math.max(businessData.length, 1);
  const vatDivisor = avgVatPercentage > 0 ? 1 + avgVatPercentage : 1;
  const incomeBeforeVat = totalRevenue / vatDivisor;

  // page.tsx 551-562: goods + current expense totals + percentages
  const totalGoodsCost = invoicesData
    .filter((inv) => supplierExpenseTypeMap.get(inv.supplier_id) === "goods_purchases")
    .reduce((sum, inv) => sum + Number(inv.subtotal), 0);
  const totalCurrentExpenses = invoicesData
    .filter((inv) => supplierExpenseTypeMap.get(inv.supplier_id) === "current_expenses")
    .reduce((sum, inv) => sum + Number(inv.subtotal), 0);
  const laborPct = incomeBeforeVat > 0 ? (totalLaborCost / incomeBeforeVat) * 100 : 0;
  const foodPct = incomeBeforeVat > 0 ? (totalGoodsCost / incomeBeforeVat) * 100 : 0;

  // BATCH 3 — income sources, source goals, breakdown, managed products, usage
  // (page.tsx 567-606)
  const entryIds = dailyEntries.map((d) => d.id);
  const [
    incomeSourcesResult,
    incomeSourceGoalsResult,
    breakdownResult,
    managedProductsResult,
    productUsageResult,
  ] = await Promise.all([
    supabase
      .from("income_sources")
      .select("id, name")
      .in("business_id", selectedBusinesses)
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
    goal
      ? supabase
          .from("income_source_goals")
          .select("income_source_id, avg_ticket_target")
          .eq("goal_id", goal.id)
      : Promise.resolve({ data: [] as IncomeSourceGoalRow[] }),
    entryIds.length > 0
      ? supabase
          .from("daily_income_breakdown")
          .select("income_source_id, amount, orders_count")
          .in("daily_entry_id", entryIds)
      : Promise.resolve({ data: [] as BreakdownRow[] }),
    supabase
      .from("managed_products")
      .select("id, name, unit, unit_cost, target_pct, display_order")
      .in("business_id", selectedBusinesses)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("display_order")
      .order("name"),
    entryIds.length > 0
      ? supabase
          .from("daily_product_usage")
          .select("product_id, quantity, unit_cost_at_time")
          .in("daily_entry_id", entryIds)
      : Promise.resolve({ data: [] as ProductUsageRow[] }),
  ]);

  const incomeSourcesData =
    (incomeSourcesResult.data as IncomeSourceRow[] | null) || [];
  const incomeSourceGoalsData =
    (incomeSourceGoalsResult.data as IncomeSourceGoalRow[] | null) || [];
  const breakdownData = (breakdownResult.data as BreakdownRow[] | null) || [];
  const managedProductsData =
    (managedProductsResult.data as ManagedProductRow[] | null) || [];
  const productUsageData =
    (productUsageResult.data as ProductUsageRow[] | null) || [];

  // page.tsx 612-625: aggregate income breakdown + goal map
  const incomeAgg: Record<string, { totalAmount: number; totalOrders: number }> = {};
  breakdownData.forEach((b) => {
    if (!incomeAgg[b.income_source_id]) {
      incomeAgg[b.income_source_id] = { totalAmount: 0, totalOrders: 0 };
    }
    incomeAgg[b.income_source_id].totalAmount += Number(b.amount) || 0;
    incomeAgg[b.income_source_id].totalOrders += Number(b.orders_count) || 0;
  });
  const incomeGoalMap = new Map<string, number>();
  incomeSourceGoalsData.forEach((ig) => {
    incomeGoalMap.set(ig.income_source_id, Number(ig.avg_ticket_target) || 0);
  });

  // page.tsx 628-645: avg-ticket KPI rows (income, isExpense=false)
  const rows: GoalsRow[] = [];

  // page.tsx 674-683: revenue (gross income, ₪, income)
  rows.push({
    category: "הכנסות ברוטו (₪)",
    target: Number(goal?.revenue_target) || 0,
    actual: totalRevenue,
    remaining: totalRevenue - (Number(goal?.revenue_target) || 0),
    status: deriveStatus(totalRevenue, Number(goal?.revenue_target) || 0, false),
    unit: "₪",
    isExpense: false,
  });

  incomeSourcesData.forEach((source) => {
    const agg = incomeAgg[source.id];
    const hasOrders = agg && agg.totalOrders > 0;
    const actualAvg = hasOrders ? agg.totalAmount / agg.totalOrders : 0;
    const totalAmount = agg ? agg.totalAmount : 0;
    const targetAvg = incomeGoalMap.get(source.id) || 0;
    const isSumType = totalAmount > 0 && !hasOrders;
    const actual = isSumType ? totalAmount : Math.round(actualAvg * 10) / 10;
    rows.push({
      category: isSumType ? `${source.name} (₪)` : `ממוצע ${source.name} (₪)`,
      target: targetAvg,
      actual,
      remaining: actual - targetAvg, // income: actual - target
      status: deriveStatus(actual, targetAvg, false),
      unit: "₪",
      isExpense: false,
    });
  });

  // page.tsx 686-702: labor % + food % (expense)
  const laborTarget = Number(goal?.labor_cost_target_pct) || 0;
  rows.push({
    category: "עלות עובדים (%)",
    target: laborTarget,
    actual: laborPct,
    remaining: laborTarget - laborPct,
    status: deriveStatus(laborPct, laborTarget, true),
    unit: "%",
    isExpense: true,
  });
  const foodTarget = Number(goal?.food_cost_target_pct) || 0;
  rows.push({
    category: "עלות מכר (%)",
    target: foodTarget,
    actual: foodPct,
    remaining: foodTarget - foodPct,
    status: deriveStatus(foodPct, foodTarget, true),
    unit: "%",
    isExpense: true,
  });

  // page.tsx 651-672, 703: managed product target % rows (expense)
  const productCostAgg: Record<string, number> = {};
  productUsageData.forEach((pu) => {
    if (!productCostAgg[pu.product_id]) productCostAgg[pu.product_id] = 0;
    productCostAgg[pu.product_id] +=
      (Number(pu.quantity) || 0) * (Number(pu.unit_cost_at_time) || 0);
  });
  managedProductsData.forEach((product) => {
    const actualCost = productCostAgg[product.id] || 0;
    const actualPct = incomeBeforeVat > 0 ? (actualCost / incomeBeforeVat) * 100 : 0;
    const target = Number(product.target_pct) || 0;
    rows.push({
      category: `יעד ${product.name} (%)`,
      target,
      actual: actualPct,
      remaining: target - actualPct,
      status: deriveStatus(actualPct, target, true),
      unit: "%",
      isExpense: true,
    });
  });

  // page.tsx 704-716: current expenses (₪, expense) — target = sum supplier budgets
  const currentExpTarget = suppliersData
    .filter((s) => s.expense_type === "current_expenses")
    .reduce((sum, s) => sum + (supplierBudgetMap.get(s.id) || 0), 0);
  rows.push({
    category: "הוצאות שוטפות (₪)",
    target: currentExpTarget,
    actual: totalCurrentExpenses,
    remaining: currentExpTarget - totalCurrentExpenses,
    status: deriveStatus(totalCurrentExpenses, currentExpTarget, true),
    unit: "₪",
    isExpense: true,
  });

  // page.tsx 717-729: goods expenses (₪, expense) — goal target or sum budgets
  const goodsExpTarget =
    Number(goal?.goods_expenses_target) ||
    suppliersData
      .filter((s) => s.expense_type === "goods_purchases")
      .reduce((sum, s) => sum + (supplierBudgetMap.get(s.id) || 0), 0);
  rows.push({
    category: "הוצאות קניות סחורה (₪)",
    target: goodsExpTarget,
    actual: totalGoodsCost,
    remaining: goodsExpTarget - totalGoodsCost,
    status: deriveStatus(totalGoodsCost, goodsExpTarget, true),
    unit: "₪",
    isExpense: true,
  });

  return { view, period: { month, year }, rows };
}
