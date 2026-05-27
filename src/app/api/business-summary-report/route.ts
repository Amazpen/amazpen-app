import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Business Summary Report API — mirrors dashboard calculations 1:1.
 *
 * Query params:
 *   - business_id (required)
 *   - year, month (optional — defaults to current)
 *   - start_date, end_date (optional — overrides month/year)
 *
 * Calculations match src/app/(dashboard)/page.tsx detail metrics:
 *   - VAT from goals.vat_percentage (fallback: businesses.vat_percentage), normalized (>1 → fraction)
 *   - Labor cost: (labor + manager_daily_cost × actual_work_days) × markup
 *   - manager_daily_cost = manager_monthly_salary / expected_work_days (from business_schedule + exceptions)
 *   - Food cost: SUM(invoices.subtotal) for ALL invoices in period (not just goods)
 *   - Income before VAT: total_register / (1 + vat)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get("business_id");

    if (!businessId) {
      return Response.json({ error: "Missing business_id" }, { status: 400 });
    }

    const now = new Date();
    const year = parseInt(searchParams.get("year") || "") || now.getFullYear();
    const month = parseInt(searchParams.get("month") || "") || (now.getMonth() + 1);

    // Period: 1st of month through end_date (default: today if current month, else last day of month)
    const monthStartDate = new Date(year, month - 1, 1);
    const lastDayOfMonth = new Date(year, month, 0);
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month - 1;
    const defaultEndDate = isCurrentMonth ? now : lastDayOfMonth;

    const startDateParam = searchParams.get("start_date");
    const endDateParam = searchParams.get("end_date");
    const startDate = startDateParam ? new Date(startDateParam) : monthStartDate;
    const endDate = endDateParam ? new Date(endDateParam) : defaultEndDate;

    const fmtLocal = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const fmtHe = (s: string) => {
      const [y, m, day] = s.split("-");
      return `${day}/${m}/${y.slice(-2)}`;
    };

    const startStr = fmtLocal(startDate);
    const endStr = fmtLocal(endDate);
    // For invoices/daily_entries queries, end is exclusive (lt)
    const endExclusive = new Date(endDate);
    endExclusive.setDate(endExclusive.getDate() + 1);
    const endExclusiveStr = fmtLocal(endExclusive);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch everything in parallel
    const [
      businessRes,
      goalRes,
      entriesRes,
      scheduleRes,
      exceptionsRes,
      incomeSourcesRes,
      incomeSourceGoalsRes,
      invoicesRes,
      membersRes,
      priorCommitmentsRes,
      supplierBudgetsRes,
    ] = await Promise.all([
      supabase
        .from("businesses")
        .select("name, manager_monthly_salary, vat_percentage, markup_percentage")
        .eq("id", businessId)
        .maybeSingle(),
      supabase
        .from("goals")
        .select("*")
        .eq("business_id", businessId)
        .eq("year", year)
        .eq("month", month)
        .maybeSingle(),
      supabase
        .from("daily_entries")
        .select("id, entry_date, total_register, labor_cost, manager_daily_cost, day_factor")
        .eq("business_id", businessId)
        .gte("entry_date", startStr)
        .lte("entry_date", endStr)
        .is("deleted_at", null)
        .order("entry_date"),
      supabase
        .from("business_schedule")
        .select("day_of_week, day_factor")
        .eq("business_id", businessId),
      supabase
        .from("business_day_exceptions")
        .select("exception_date, day_factor")
        .eq("business_id", businessId)
        .gte("exception_date", fmtLocal(monthStartDate))
        .lte("exception_date", fmtLocal(lastDayOfMonth)),
      supabase
        .from("income_sources")
        .select("id, name, display_order")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("display_order"),
      supabase
        .from("income_source_goals")
        .select("income_source_id, avg_ticket_target")
        .eq("goal_id", ""), // placeholder, will fix below
      supabase
        .from("invoices")
        .select("subtotal, invoice_type, reference_date, supplier_id")
        .eq("business_id", businessId)
        .gte("reference_date", startStr)
        .lt("reference_date", endExclusiveStr)
        .neq("status", "cancelled"),
      supabase
        .from("business_members")
        .select("profiles(email)")
        .eq("business_id", businessId)
        .in("role", ["admin", "owner"]),
      supabase
        .from("prior_commitments")
        .select("name, monthly_amount, start_date, end_date")
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .lte("start_date", fmtLocal(lastDayOfMonth))
        .or(`end_date.is.null,end_date.gte.${fmtLocal(monthStartDate)}`),
      supabase
        .from("supplier_budgets")
        .select("budget_amount, supplier_id, supplier:suppliers(name, expense_category_id, expense_type, is_fixed_expense, parent_category_id)")
        .eq("business_id", businessId)
        .eq("year", year)
        .eq("month", month)
        .is("deleted_at", null),
    ]);

    const business = businessRes.data;
    if (!business) {
      return Response.json({ error: "Business not found" }, { status: 404 });
    }
    const goal = goalRes.data;

    // Re-fetch income source goals now that we have goal.id
    let sourceGoals: { income_source_id: string; avg_ticket_target: number }[] = [];
    if (goal?.id) {
      const { data } = await supabase
        .from("income_source_goals")
        .select("income_source_id, avg_ticket_target")
        .eq("goal_id", goal.id);
      sourceGoals = (data || []) as typeof sourceGoals;
    }
    void incomeSourceGoalsRes; // unused initial fetch

    const entries = entriesRes.data || [];
    const schedule = scheduleRes.data || [];
    const exceptions = exceptionsRes.data || [];
    const incomeSources = incomeSourcesRes.data || [];
    const invoices = invoicesRes.data || [];

    // ===== VAT (normalized) =====
    const rawVat = goal?.vat_percentage != null
      ? Number(goal.vat_percentage)
      : Number(business.vat_percentage) || 0;
    const vatFraction = rawVat > 1 ? rawVat - 1 : rawVat;
    const vatDivisor = 1 + vatFraction;

    // ===== Markup (normalized multiplier, e.g. 1.0) =====
    const rawMarkup = goal?.markup_percentage != null
      ? Number(goal.markup_percentage)
      : Number(business.markup_percentage) || 1;
    const markup = rawMarkup > 0 ? rawMarkup : 1;

    // ===== Revenue =====
    const totalIncomeWithVat = entries.reduce((s, e) => s + (Number(e.total_register) || 0), 0);
    const incomeBeforeVat = totalIncomeWithVat / vatDivisor;

    // ===== Expected work days in FULL month (for manager_daily_cost denominator) =====
    const exceptionMap: Record<string, number> = {};
    for (const e of exceptions) {
      exceptionMap[e.exception_date] = Number(e.day_factor) || 0;
    }
    const scheduleByDow: Record<number, number> = {};
    for (const s of schedule) {
      scheduleByDow[s.day_of_week] = Number(s.day_factor) || 0;
    }
    let expectedWorkDays = 0;
    let expectedWorkDaysElapsed = 0;
    const iterDate = new Date(monthStartDate);
    while (iterDate <= lastDayOfMonth) {
      const key = fmtLocal(iterDate);
      const factor =
        exceptionMap[key] !== undefined
          ? exceptionMap[key]
          : scheduleByDow[iterDate.getDay()] || 0;
      expectedWorkDays += factor;
      if (iterDate <= endDate) {
        expectedWorkDaysElapsed += factor;
      }
      iterDate.setDate(iterDate.getDate() + 1);
    }
    const effectiveWorkDays = expectedWorkDays > 0 ? expectedWorkDays : 26;
    const managerDailyCost =
      effectiveWorkDays > 0 ? (Number(business.manager_monthly_salary) || 0) / effectiveWorkDays : 0;

    // Pro-rata factor: ratio of day-factor elapsed (1st → endDate) to full month.
    // Used to scale monthly targets (revenue, current expenses, profit) so the
    // email compares partial-month actuals against partial-month targets — same
    // mental model David asked for: "split the target by the days elapsed".
    const periodFactor =
      expectedWorkDays > 0 ? expectedWorkDaysElapsed / expectedWorkDays : 1;

    // ===== Labor cost =====
    const rawLaborCost = entries.reduce((s, e) => s + (Number(e.labor_cost) || 0), 0);
    const actualWorkDays = entries.reduce((s, e) => s + (Number(e.day_factor) || 0), 0);
    const computedManagerCost = managerDailyCost * actualWorkDays;
    const laborCost = (rawLaborCost + computedManagerCost) * markup;
    const laborCostPct = incomeBeforeVat > 0 ? (laborCost / incomeBeforeVat) * 100 : 0;
    const laborTargetPct = Number(goal?.labor_cost_target_pct) || 0;
    const laborDiffPct = laborCostPct - laborTargetPct;
    const laborDiffNis = (laborDiffPct * incomeBeforeVat) / 100;

    // ===== Food cost / Current expenses split =====
    // The dashboard buckets invoices by the SUPPLIER's `expense_type`, not by
    // `invoices.invoice_type`. A supplier with expense_type='goods_purchases'
    // (or its unlinked delivery notes) contributes to "עלות מכר"; everything
    // else lands in "הוצאות שוטפות". The previous implementation summed every
    // invoice into foodCost AND also into currentExpensesActual when type was
    // 'current' — which double-counted the same shekels in the profit math
    // (food + current both saw them) and inflated cost-of-goods to 78%+.
    // Match the dashboard's supplier filter exactly: active goods suppliers
    // for this business. Inactive ones are intentionally excluded so the
    // email number is identical to what the user sees on the kpi card.
    const goodsSupplierIdsRes = await supabase
      .from("suppliers")
      .select("id")
      .eq("business_id", businessId)
      .eq("expense_type", "goods_purchases")
      .eq("is_active", true)
      .is("deleted_at", null);
    const goodsSupplierIds = new Set(
      ((goodsSupplierIdsRes.data || []) as Array<{ id: string }>).map((s) => s.id)
    );

    // Also include unlinked delivery notes (תעודות משלוח without an invoice)
    // from goods suppliers — same as the dashboard does for "עלות מכר".
    let deliveryNotesGoods = 0;
    if (goodsSupplierIds.size > 0) {
      const { data: dnRows } = await supabase
        .from("delivery_notes")
        .select("subtotal, supplier_id")
        .eq("business_id", businessId)
        .gte("delivery_date", startStr)
        .lt("delivery_date", endExclusiveStr)
        .is("invoice_id", null);
      deliveryNotesGoods = ((dnRows || []) as Array<{ subtotal: number; supplier_id: string }>)
        .filter((dn) => goodsSupplierIds.has(dn.supplier_id))
        .reduce((s, dn) => s + (Number(dn.subtotal) || 0), 0);
    }

    type InvRow = { subtotal: number; invoice_type: string | null; supplier_id: string | null };
    const goodsInvoicesTotal = (invoices as InvRow[])
      .filter((inv) => inv.supplier_id && goodsSupplierIds.has(inv.supplier_id))
      .reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0);
    const foodCost = goodsInvoicesTotal + deliveryNotesGoods;
    const foodCostPct = incomeBeforeVat > 0 ? (foodCost / incomeBeforeVat) * 100 : 0;
    const foodTargetPct = Number(goal?.food_cost_target_pct) || 0;
    const foodDiffPct = foodCostPct - foodTargetPct;
    const foodDiffNis = (foodDiffPct * incomeBeforeVat) / 100;

    // Current expenses = invoices from non-goods suppliers. Falls back to the
    // legacy invoice_type='current' filter for invoices whose supplier was
    // deleted / has no expense_type, so they still get bucketed somewhere.
    // Target is scaled by periodFactor so partial-month actuals are compared
    // against partial-month targets (David's request: split by days elapsed).
    const currentExpensesTargetFull = Number(goal?.current_expenses_target) || 0;
    const currentExpensesTarget = currentExpensesTargetFull * periodFactor;
    const currentExpensesActual = (invoices as InvRow[])
      .filter((inv) => !inv.supplier_id || !goodsSupplierIds.has(inv.supplier_id))
      .reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0);
    const currentExpensesDiffNis = currentExpensesActual - currentExpensesTarget;
    const currentExpensesDiffPct =
      currentExpensesTarget > 0
        ? ((currentExpensesActual - currentExpensesTarget) / currentExpensesTarget) * 100
        : 0;

    // entryIds shared by managed products + income sources breakdown queries
    const entryIds = entries.map((e) => e.id);

    // ===== Managed products (מוצרים מנוהלים) =====
    // Same calc as dashboard: totalCost = unit_cost × SUM(quantity) from daily_product_usage,
    // actualPct = totalCost / incomeBeforeVat × 100, diff vs target_pct.
    const { data: managedProductsData } = await supabase
      .from("managed_products")
      .select("id, name, unit_cost, target_pct, display_order")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("display_order");
    const managedProducts = (managedProductsData || []) as Array<{
      id: string;
      name: string;
      unit_cost: number | null;
      target_pct: number | null;
      display_order: number | null;
    }>;
    let productQuantities: Record<string, number> = {};
    if (entryIds.length > 0 && managedProducts.length > 0) {
      const { data: usageRows } = await supabase
        .from("daily_product_usage")
        .select("product_id, quantity")
        .in("daily_entry_id", entryIds);
      productQuantities = (usageRows || []).reduce<Record<string, number>>((acc, u) => {
        acc[u.product_id] = (acc[u.product_id] || 0) + (Number(u.quantity) || 0);
        return acc;
      }, {});
    }
    const managedProductsReport = managedProducts.map((p) => {
      const unitCost = Number(p.unit_cost) || 0;
      const quantity = productQuantities[p.id] || 0;
      const totalCost = unitCost * quantity;
      const actualPct = incomeBeforeVat > 0 ? (totalCost / incomeBeforeVat) * 100 : 0;
      const targetPct = Number(p.target_pct) || 0;
      const diffPct = actualPct - targetPct;
      const diffNis = (diffPct * incomeBeforeVat) / 100;
      return {
        id: p.id,
        name: p.name,
        targetPct: Math.round(targetPct * 100) / 100,
        actualPct: Math.round(actualPct * 100) / 100,
        actualNis: Math.round(totalCost),
        diffPct: Math.round(diffPct * 100) / 100,
        diffNis: Math.round(diffNis * 100) / 100,
      };
    });

    // ===== Income sources breakdown =====
    let incomeBreakdown: { income_source_id: string; amount: number; orders_count: number }[] = [];
    if (entryIds.length > 0) {
      const { data } = await supabase
        .from("daily_income_breakdown")
        .select("income_source_id, amount, orders_count")
        .in("daily_entry_id", entryIds);
      incomeBreakdown = (data || []).map((r) => ({
        income_source_id: r.income_source_id,
        amount: Number(r.amount) || 0,
        orders_count: Number(r.orders_count) || 0,
      }));
    }
    const incomeBySource: Record<string, { amount: number; orders: number }> = {};
    for (const row of incomeBreakdown) {
      if (!incomeBySource[row.income_source_id]) {
        incomeBySource[row.income_source_id] = { amount: 0, orders: 0 };
      }
      incomeBySource[row.income_source_id].amount += row.amount;
      incomeBySource[row.income_source_id].orders += row.orders_count;
    }

    const incomeSourcesReport = incomeSources.map((src) => {
      const actual = incomeBySource[src.id] || { amount: 0, orders: 0 };
      const goalData = sourceGoals.find((g) => g.income_source_id === src.id);
      const avgTicketTarget = Number(goalData?.avg_ticket_target) || 0;
      const actualAvgTicket = actual.orders > 0 ? actual.amount / actual.orders : 0;
      const diffAvgNis =
        avgTicketTarget > 0 && actual.orders > 0
          ? (actualAvgTicket - avgTicketTarget) * actual.orders
          : 0;
      const diffAvgPct =
        avgTicketTarget > 0
          ? ((actualAvgTicket - avgTicketTarget) / avgTicketTarget) * 100
          : 0;
      return {
        name: src.name,
        ordersCount: actual.orders,
        totalAmount: Math.round(actual.amount),
        avgTicketTarget: Math.round(avgTicketTarget * 100) / 100,
        avgTicketActual: Math.round(actualAvgTicket * 100) / 100,
        diffAvgPct: Math.round(diffAvgPct * 100) / 100,
        diffAvgNis: Math.round(diffAvgNis),
      };
    });

    // ===== Revenue target & diff =====
    // Scale full-month target by periodFactor for fair partial-period comparison.
    const revenueTargetFull = Number(goal?.revenue_target) || 0;
    const revenueTarget = revenueTargetFull * periodFactor;
    const revenueDiffNis = incomeBeforeVat - revenueTarget;
    const revenueDiffPct =
      revenueTarget > 0 ? ((incomeBeforeVat - revenueTarget) / revenueTarget) * 100 : 0;

    // ===== Profit =====
    // Profit target is rebuilt from period-scaled revenue & current-expenses
    // targets so it stays consistent with the partial period.
    const totalExpenses = laborCost + foodCost + currentExpensesActual;
    const profitActual = incomeBeforeVat - totalExpenses;
    const profitTarget =
      revenueTarget -
      ((laborTargetPct / 100) * revenueTarget +
        (foodTargetPct / 100) * revenueTarget +
        currentExpensesTarget);
    const profitDiffNis = profitActual - profitTarget;
    const profitActualPct = incomeBeforeVat > 0 ? (profitActual / incomeBeforeVat) * 100 : 0;
    // profitTargetPct is a ratio (%), so it stays the same whether scaled or not:
    // use revenueTargetFull to keep the displayed % stable across the month.
    const profitTargetPct =
      revenueTargetFull > 0
        ? ((revenueTargetFull -
            ((laborTargetPct / 100) * revenueTargetFull +
              (foodTargetPct / 100) * revenueTargetFull +
              currentExpensesTargetFull)) /
            revenueTargetFull) *
          100
        : 0;
    const profitDiffPct = profitActualPct - profitTargetPct;

    // ===== Prior commitments (loans/installments for this month) =====
    const priorCommitments = (priorCommitmentsRes.data || []) as Array<{
      name: string;
      monthly_amount: number;
      start_date: string;
      end_date: string | null;
    }>;
    const priorCommitmentsTotal = priorCommitments.reduce(
      (s, c) => s + (Number(c.monthly_amount) || 0),
      0
    );

    // ===== Category budget breakdown (from supplier_budgets) =====
    const supplierBudgets = (supplierBudgetsRes.data || []) as unknown as Array<{
      budget_amount: number | null;
      supplier:
        | {
            name: string | null;
            expense_category_id: string | null;
            parent_category_id: string | null;
          }
        | Array<{
            name: string | null;
            expense_category_id: string | null;
            parent_category_id: string | null;
          }>
        | null;
    }>;
    // Fetch all expense categories for this business to map ids → names
    const { data: allCategories } = await supabase
      .from("expense_categories")
      .select("id, name, parent_id")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .is("deleted_at", null);
    const categoryNameById: Record<string, string> = {};
    const categoryParentById: Record<string, string | null> = {};
    for (const c of allCategories || []) {
      categoryNameById[c.id] = c.name;
      categoryParentById[c.id] = c.parent_id || null;
    }

    // Aggregate budgets by top-level category (walk up parent chain)
    const categoryTotals: Record<string, number> = {};
    for (const sb of supplierBudgets) {
      const amount = Number(sb.budget_amount || 0);
      if (amount <= 0 || !sb.supplier) continue;
      const supplierObj = Array.isArray(sb.supplier) ? sb.supplier[0] : sb.supplier;
      if (!supplierObj) continue;
      // Prefer parent_category_id from supplier; fallback to walking expense_category_id parents
      let catId: string | null =
        supplierObj.parent_category_id || supplierObj.expense_category_id || null;
      // Walk up to top-level
      const safetyCap = 6;
      let depth = 0;
      while (catId && categoryParentById[catId] && depth < safetyCap) {
        catId = categoryParentById[catId];
        depth++;
      }
      if (!catId) continue;
      const name = categoryNameById[catId] || "אחר";
      categoryTotals[name] = (categoryTotals[name] || 0) + amount;
    }
    const expenseCategories = Object.entries(categoryTotals)
      .map(([name, amount]) => ({ name, amount: Math.round(amount) }))
      .filter((x) => x.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    // ===== Emails =====
    const emails = (membersRes.data || [])
      .map((m) => (m.profiles as unknown as { email: string })?.email)
      .filter(Boolean)
      .join(", ");

    // ===== Hebrew month name =====
    const hebrewMonths = [
      "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
      "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
    ];
    const monthName = hebrewMonths[month - 1];

    // Period string: 1st of month → end date
    const periodStart = fmtHe(fmtLocal(monthStartDate));
    const periodEnd = fmtHe(endStr);

    return Response.json({
      businessName: business.name,
      emails,
      monthName,
      month,
      year,
      periodStart,
      periodEnd,
      periodLabel: `${periodStart}-${periodEnd}`,

      // Revenue
      revenueTarget: Math.round(revenueTarget),
      revenueActual: Math.round(incomeBeforeVat),
      revenueWithVat: Math.round(totalIncomeWithVat),
      revenueDiffNis: Math.round(revenueDiffNis),
      revenueDiffPct: Math.round(revenueDiffPct * 100) / 100,

      // Labor
      laborTargetPct: Math.round(laborTargetPct * 100) / 100,
      laborActualPct: Math.round(laborCostPct * 100) / 100,
      laborDiffPct: Math.round(laborDiffPct * 100) / 100,
      laborDiffNis: Math.round(laborDiffNis),
      laborActualNis: Math.round(laborCost),

      // Food
      foodTargetPct: Math.round(foodTargetPct * 100) / 100,
      foodActualPct: Math.round(foodCostPct * 100) / 100,
      foodDiffPct: Math.round(foodDiffPct * 100) / 100,
      foodDiffNis: Math.round(foodDiffNis),
      foodActualNis: Math.round(foodCost),

      // Current expenses
      currentExpensesTarget: Math.round(currentExpensesTarget),
      currentExpensesActual: Math.round(currentExpensesActual),
      currentExpensesDiffNis: Math.round(currentExpensesDiffNis),
      currentExpensesDiffPct: Math.round(currentExpensesDiffPct * 100) / 100,

      // Profit
      profitTarget: Math.round(profitTarget),
      profitActual: Math.round(profitActual),
      profitDiffNis: Math.round(profitDiffNis),
      profitTargetPct: Math.round(profitTargetPct * 100) / 100,
      profitActualPct: Math.round(profitActualPct * 100) / 100,
      profitDiffPct: Math.round(profitDiffPct * 100) / 100,

      // Income sources
      incomeSources: incomeSourcesReport,

      // Managed products (מוצרים מנוהלים)
      managedProducts: managedProductsReport,

      // Prior commitments (loans)
      priorCommitmentsTotal: Math.round(priorCommitmentsTotal),
      priorCommitments: priorCommitments.map((c) => ({
        name: c.name,
        monthly_amount: Math.round(Number(c.monthly_amount) || 0),
      })),

      // Expense categories (from budgets)
      expenseCategories,
    });
  } catch (error) {
    console.error("[Business Summary Report] Error:", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
