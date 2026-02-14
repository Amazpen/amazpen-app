import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = any;

async function execReadOnlyQuery(sb: AnySupabaseClient, sql: string) {
  return sb.rpc("read_only_query", { sql_query: sql });
}

// ---------------------------------------------------------------------------
// Compute all monthly metrics for a business
// ---------------------------------------------------------------------------
async function computeAndStoreMetrics(
  adminSb: AnySupabaseClient,
  bizId: string,
  year: number,
  month: number
) {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  // ---- 1. Daily entries aggregation ----
  const { data: dailyAgg } = await execReadOnlyQuery(
    adminSb,
    `SELECT
       COALESCE(SUM(total_register), 0) as total_income,
       COALESCE(SUM(labor_cost), 0) as total_labor_cost,
       COALESCE(SUM(labor_hours), 0) as total_labor_hours,
       COALESCE(SUM(discounts), 0) as total_discounts,
       COALESCE(SUM(day_factor), 0) as sum_day_factors,
       COUNT(*) as work_days
     FROM public.daily_entries
     WHERE business_id = '${bizId}'
       AND entry_date >= '${monthStart}'
       AND entry_date < '${nextMonth}'
       AND deleted_at IS NULL`
  );
  const daily =
    Array.isArray(dailyAgg) && dailyAgg[0]
      ? dailyAgg[0]
      : {
          total_income: 0,
          total_labor_cost: 0,
          total_labor_hours: 0,
          total_discounts: 0,
          sum_day_factors: 0,
          work_days: 0,
        };

  // ---- 2. Invoices: food cost + current expenses ----
  const { data: invoiceAgg } = await execReadOnlyQuery(
    adminSb,
    `SELECT
       COALESCE(SUM(CASE WHEN s.expense_type = 'goods_purchases' THEN i.subtotal ELSE 0 END), 0) as food_cost,
       COALESCE(SUM(CASE WHEN s.expense_type = 'current_expenses' THEN i.subtotal ELSE 0 END), 0) as current_expenses
     FROM public.invoices i
     JOIN public.suppliers s ON s.id = i.supplier_id
     WHERE i.business_id = '${bizId}'
       AND i.invoice_date >= '${monthStart}'
       AND i.invoice_date < '${nextMonth}'
       AND i.deleted_at IS NULL`
  );
  const inv =
    Array.isArray(invoiceAgg) && invoiceAgg[0]
      ? invoiceAgg[0]
      : { food_cost: 0, current_expenses: 0 };

  // ---- 3. Goals ----
  const { data: goalsData } = await adminSb
    .from("goals")
    .select("*")
    .eq("business_id", bizId)
    .eq("year", year)
    .eq("month", month)
    .is("deleted_at", null)
    .maybeSingle();

  // ---- 4. Business defaults ----
  const { data: bizData } = await adminSb
    .from("businesses")
    .select(
      "name, vat_percentage, markup_percentage, manager_monthly_salary"
    )
    .eq("id", bizId)
    .single();

  // ---- 5. Schedule ----
  const { data: scheduleData } = await adminSb
    .from("business_schedule")
    .select("day_of_week, day_factor")
    .eq("business_id", bizId)
    .order("day_of_week");

  const scheduleMap = new Map<number, number>();
  if (scheduleData) {
    for (const row of scheduleData) {
      scheduleMap.set(row.day_of_week, Number(row.day_factor) || 0);
    }
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  let expectedWorkDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    expectedWorkDays += scheduleMap.get(dow) ?? 0;
  }

  // ---- 6. Core calculations ----
  const vatPct =
    goalsData?.vat_percentage ?? bizData?.vat_percentage ?? 0.18;
  const markup =
    goalsData?.markup_percentage ?? bizData?.markup_percentage ?? 1;
  const managerSalary = Number(bizData?.manager_monthly_salary) || 0;

  const totalIncome = Number(daily.total_income) || 0;
  const incomeBeforeVat = totalIncome / (1 + vatPct);
  const sumDayFactors = Number(daily.sum_day_factors) || 0;
  const workDays = Number(daily.work_days) || 0;

  const dailyAvg = sumDayFactors > 0 ? incomeBeforeVat / sumDayFactors : 0;
  const monthlyPace = dailyAvg * expectedWorkDays;

  const managerDailyCost =
    expectedWorkDays > 0 ? managerSalary / expectedWorkDays : 0;
  const laborCostTotal =
    (Number(daily.total_labor_cost) + managerDailyCost * workDays) * markup;
  const laborCostPct =
    incomeBeforeVat > 0 ? (laborCostTotal / incomeBeforeVat) * 100 : 0;

  const foodCost = Number(inv.food_cost) || 0;
  const foodCostPct =
    incomeBeforeVat > 0 ? (foodCost / incomeBeforeVat) * 100 : 0;

  const currentExpenses = Number(inv.current_expenses) || 0;
  const currentExpensesPct =
    incomeBeforeVat > 0 ? (currentExpenses / incomeBeforeVat) * 100 : 0;

  // Targets
  const revenueTarget = Number(goalsData?.revenue_target) || 0;
  const targetDiffPct =
    revenueTarget > 0 ? ((monthlyPace / revenueTarget) - 1) * 100 : null;
  const dailyDiff =
    revenueTarget > 0 && expectedWorkDays > 0
      ? (monthlyPace - revenueTarget) / expectedWorkDays
      : 0;
  const targetDiffAmount = dailyDiff * sumDayFactors;

  const laborTargetPct = Number(goalsData?.labor_cost_target_pct) || 0;
  const laborDiffPct = laborTargetPct > 0 ? laborCostPct - laborTargetPct : null;
  const laborDiffAmount =
    laborDiffPct !== null && incomeBeforeVat > 0
      ? (laborDiffPct * incomeBeforeVat) / 100
      : null;

  const foodTargetPct = Number(goalsData?.food_cost_target_pct) || 0;
  const foodDiffPct = foodTargetPct > 0 ? foodCostPct - foodTargetPct : null;
  const foodDiffAmount =
    foodDiffPct !== null && incomeBeforeVat > 0
      ? (foodDiffPct * incomeBeforeVat) / 100
      : null;

  const currentExpensesTargetPct =
    Number(goalsData?.operating_cost_target_pct) || 0;
  const currentExpensesDiffPct =
    currentExpensesTargetPct > 0
      ? currentExpensesPct - currentExpensesTargetPct
      : null;
  const currentExpensesDiffAmount =
    currentExpensesDiffPct !== null && incomeBeforeVat > 0
      ? (currentExpensesDiffPct * incomeBeforeVat) / 100
      : null;

  // ---- 7. Income breakdown (private/business) ----
  const { data: breakdownData } = await execReadOnlyQuery(
    adminSb,
    `SELECT
       dib.income_source_id,
       COALESCE(SUM(dib.amount), 0) as total_amount,
       COALESCE(SUM(dib.orders_count), 0) as orders_count
     FROM public.daily_income_breakdown dib
     JOIN public.daily_entries de ON de.id = dib.daily_entry_id
     WHERE de.business_id = '${bizId}'
       AND de.entry_date >= '${monthStart}'
       AND de.entry_date < '${nextMonth}'
       AND de.deleted_at IS NULL
     GROUP BY dib.income_source_id`
  );

  const { data: incomeSources } = await adminSb
    .from("income_sources")
    .select("id, name, income_type")
    .eq("business_id", bizId)
    .eq("is_active", true)
    .is("deleted_at", null);

  let privateIncome = 0,
    privateCount = 0,
    businessIncome = 0,
    businessCount = 0;

  if (Array.isArray(breakdownData) && Array.isArray(incomeSources)) {
    for (const row of breakdownData) {
      const source = incomeSources.find(
        (s: { id: string }) => s.id === row.income_source_id
      );
      const amount = Number(row.total_amount) || 0;
      const orders = Number(row.orders_count) || 0;
      if (source?.income_type === "business") {
        businessIncome += amount;
        businessCount += orders;
      } else {
        privateIncome += amount;
        privateCount += orders;
      }
    }
  }

  // ---- 8. Managed products ----
  const { data: managedProducts } = await adminSb
    .from("managed_products")
    .select("id, name, unit_cost, target_pct")
    .eq("business_id", bizId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("created_at")
    .limit(3);

  const { data: entryIds } = await execReadOnlyQuery(
    adminSb,
    `SELECT id FROM public.daily_entries
     WHERE business_id = '${bizId}'
       AND entry_date >= '${monthStart}'
       AND entry_date < '${nextMonth}'
       AND deleted_at IS NULL`
  );

  const entryIdList = Array.isArray(entryIds)
    ? entryIds.map((r: { id: string }) => `'${r.id}'`).join(",")
    : "";

  let mpData: Array<{
    name: string;
    cost: number;
    pct: number;
    targetPct: number;
    diffPct: number;
  }> = [];

  if (entryIdList && Array.isArray(managedProducts) && managedProducts.length > 0) {
    const { data: productUsage } = await execReadOnlyQuery(
      adminSb,
      `SELECT product_id, COALESCE(SUM(quantity), 0) as total_qty
       FROM public.daily_product_usage
       WHERE daily_entry_id IN (${entryIdList})
       GROUP BY product_id`
    );

    const usageMap = new Map<string, number>();
    if (Array.isArray(productUsage)) {
      for (const row of productUsage) {
        usageMap.set(row.product_id, Number(row.total_qty) || 0);
      }
    }

    mpData = managedProducts.map(
      (p: { id: string; name: string; unit_cost: number; target_pct: number }) => {
        const qty = usageMap.get(p.id) || 0;
        const cost = qty * (Number(p.unit_cost) || 0);
        const pct = incomeBeforeVat > 0 ? (cost / incomeBeforeVat) * 100 : 0;
        const targetPct = Number(p.target_pct) || 0;
        const diffPct = targetPct > 0 ? pct - targetPct : 0;
        return { name: p.name, cost, pct, targetPct, diffPct };
      }
    );
  }

  // ---- 9. Previous month & year comparisons ----
  const prevMonthDate =
    month === 1
      ? { year: year - 1, month: 12 }
      : { year, month: month - 1 };
  const prevYearDate = { year: year - 1, month };

  const [prevMonthResult, prevYearResult] = await Promise.all([
    execReadOnlyQuery(
      adminSb,
      `SELECT COALESCE(SUM(total_register), 0) as total_income
       FROM public.daily_entries
       WHERE business_id = '${bizId}'
         AND entry_date >= '${prevMonthDate.year}-${String(prevMonthDate.month).padStart(2, "0")}-01'
         AND entry_date < '${prevMonthDate.month === 12 ? prevMonthDate.year + 1 : prevMonthDate.year}-${String(prevMonthDate.month === 12 ? 1 : prevMonthDate.month + 1).padStart(2, "0")}-01'
         AND deleted_at IS NULL`
    ),
    execReadOnlyQuery(
      adminSb,
      `SELECT COALESCE(SUM(total_register), 0) as total_income
       FROM public.daily_entries
       WHERE business_id = '${bizId}'
         AND entry_date >= '${prevYearDate.year}-${String(prevYearDate.month).padStart(2, "0")}-01'
         AND entry_date < '${prevYearDate.month === 12 ? prevYearDate.year + 1 : prevYearDate.year}-${String(prevYearDate.month === 12 ? 1 : prevYearDate.month + 1).padStart(2, "0")}-01'
         AND deleted_at IS NULL`
    ),
  ]);

  const prevMonthIncome =
    Array.isArray(prevMonthResult.data) && prevMonthResult.data[0]
      ? Number(prevMonthResult.data[0].total_income) || 0
      : 0;
  const prevYearIncome =
    Array.isArray(prevYearResult.data) && prevYearResult.data[0]
      ? Number(prevYearResult.data[0].total_income) || 0
      : 0;

  const prevMonthChangePct =
    prevMonthIncome > 0
      ? ((monthlyPace / prevMonthIncome) - 1) * 100
      : 0;
  const prevYearChangePct =
    prevYearIncome > 0
      ? ((monthlyPace / prevYearIncome) - 1) * 100
      : 0;

  // ---- 10. UPSERT into business_monthly_metrics ----
  const row = {
    business_id: bizId,
    year,
    month,
    // Work days
    actual_work_days: r2(workDays),
    actual_day_factors: r2(sumDayFactors),
    expected_work_days: r2(expectedWorkDays),
    // Income
    total_income: r2(totalIncome),
    income_before_vat: r2(incomeBeforeVat),
    monthly_pace: r2(monthlyPace),
    daily_avg: r2(dailyAvg),
    // Revenue targets
    revenue_target: r2(revenueTarget),
    target_diff_pct: r2(targetDiffPct),
    target_diff_amount: r2(targetDiffAmount),
    // Labor
    labor_cost_amount: r2(laborCostTotal),
    labor_cost_pct: r2(laborCostPct),
    labor_target_pct: r2(laborTargetPct),
    labor_diff_pct: r2(laborDiffPct),
    labor_diff_amount: r2(laborDiffAmount),
    // Food
    food_cost_amount: r2(foodCost),
    food_cost_pct: r2(foodCostPct),
    food_target_pct: r2(foodTargetPct),
    food_diff_pct: r2(foodDiffPct),
    food_diff_amount: r2(foodDiffAmount),
    // Current expenses
    current_expenses_amount: r2(currentExpenses),
    current_expenses_pct: r2(currentExpensesPct),
    current_expenses_target_pct: r2(currentExpensesTargetPct),
    current_expenses_diff_pct: r2(currentExpensesDiffPct),
    current_expenses_diff_amount: r2(currentExpensesDiffAmount),
    // Managed products
    managed_product_1_name: mpData[0]?.name || null,
    managed_product_1_cost: r2(mpData[0]?.cost),
    managed_product_1_pct: r2(mpData[0]?.pct),
    managed_product_1_target_pct: r2(mpData[0]?.targetPct),
    managed_product_1_diff_pct: r2(mpData[0]?.diffPct),
    managed_product_2_name: mpData[1]?.name || null,
    managed_product_2_cost: r2(mpData[1]?.cost),
    managed_product_2_pct: r2(mpData[1]?.pct),
    managed_product_2_target_pct: r2(mpData[1]?.targetPct),
    managed_product_2_diff_pct: r2(mpData[1]?.diffPct),
    managed_product_3_name: mpData[2]?.name || null,
    managed_product_3_cost: r2(mpData[2]?.cost),
    managed_product_3_pct: r2(mpData[2]?.pct),
    managed_product_3_target_pct: r2(mpData[2]?.targetPct),
    managed_product_3_diff_pct: r2(mpData[2]?.diffPct),
    // Income breakdown
    private_income: r2(privateIncome),
    private_orders_count: privateCount,
    private_avg_ticket: r2(privateCount > 0 ? privateIncome / privateCount : 0),
    business_income: r2(businessIncome),
    business_orders_count: businessCount,
    business_avg_ticket: r2(
      businessCount > 0 ? businessIncome / businessCount : 0
    ),
    // Comparisons
    prev_month_income: r2(prevMonthIncome),
    prev_month_change_pct: r2(prevMonthChangePct),
    prev_year_income: r2(prevYearIncome),
    prev_year_change_pct: r2(prevYearChangePct),
    // Params
    vat_pct: r2(vatPct),
    markup_pct: r2(markup),
    manager_salary: r2(managerSalary),
    manager_daily_cost: r2(managerDailyCost),
    // Hours
    total_labor_hours: r2(Number(daily.total_labor_hours)),
    total_discounts: r2(Number(daily.total_discounts)),
    // Meta
    computed_at: new Date().toISOString(),
  };

  const { error } = await adminSb
    .from("business_monthly_metrics")
    .upsert(row, { onConflict: "business_id,year,month" });

  if (error) {
    console.error("[metrics/refresh] upsert error:", error);
    throw new Error(error.message);
  }

  return row;
}

/** Round to 2 decimals, handle null */
function r2(val: number | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  return Math.round(val * 100) / 100;
}

// ---------------------------------------------------------------------------
// POST /api/metrics/refresh
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "DB not configured" }, 503);
  }

  // Auth
  const serverSupabase = await createServerClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();
  if (!user) {
    return jsonResponse({ error: "לא מחובר" }, 401);
  }

  // Parse body
  const body = await request.json();
  const { businessId, year, month } = body;
  if (!businessId || !year || !month) {
    return jsonResponse(
      { error: "חסרים שדות: businessId, year, month" },
      400
    );
  }

  // Verify membership
  const { data: membership } = await serverSupabase
    .from("business_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .maybeSingle();

  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!membership && !profile?.is_admin) {
    return jsonResponse({ error: "אין גישה לעסק" }, 403);
  }

  // Compute with admin client (bypasses RLS)
  const adminSb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const result = await computeAndStoreMetrics(
      adminSb,
      businessId,
      year,
      month
    );
    return jsonResponse({ success: true, metrics: result });
  } catch (e) {
    console.error("[metrics/refresh] error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Failed to compute metrics" },
      500
    );
  }
}
