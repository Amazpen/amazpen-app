import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Weekly Summary API — returns all metrics for a business in a given month.
 * Used by n8n workflow to generate and send the weekly summary email.
 *
 * Query params: business_id, month (1-12), year (e.g. 2026)
 * Returns the same field structure the n8n "Process & Format Data" code node expects.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get("business_id");
    const month = parseInt(searchParams.get("month") || "");
    const year = parseInt(searchParams.get("year") || "");

    if (!businessId || !month || !year) {
      return Response.json({ error: "Missing business_id, month, or year" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const monthStr = String(month).padStart(2, "0");
    const monthStart = `${year}-${monthStr}-01`;
    const monthEnd = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    // Fetch all data in parallel
    const [
      businessRes,
      goalsRes,
      entriesRes,
      incomeSourcesRes,
      managedProductsRes,
      invoicesRes,
      membersRes,
    ] = await Promise.all([
      // Business name
      supabase.from("businesses").select("name").eq("id", businessId).single(),
      // Goals for this month
      supabase.from("goals")
        .select("*, income_source_goals(income_source_id, avg_ticket_target)")
        .eq("business_id", businessId).eq("year", year).eq("month", month)
        .maybeSingle(),
      // Daily entries for this month
      supabase.from("daily_entries")
        .select("id, entry_date, total_register, labor_cost, manager_daily_cost, day_factor")
        .eq("business_id", businessId)
        .gte("entry_date", monthStart).lt("entry_date", monthEnd)
        .is("deleted_at", null)
        .order("entry_date"),
      // Income sources
      supabase.from("income_sources")
        .select("id, name, display_order")
        .eq("business_id", businessId).eq("is_active", true).is("deleted_at", null)
        .order("display_order"),
      // Managed products
      supabase.from("managed_products")
        .select("id, name, unit_cost, target_pct, display_order")
        .eq("business_id", businessId).eq("is_active", true).is("deleted_at", null)
        .order("display_order"),
      // Invoices (expenses) for this month
      supabase.from("invoices")
        .select("subtotal, invoice_type, supplier_id")
        .eq("business_id", businessId)
        .gte("reference_date", monthStart).lt("reference_date", monthEnd)
        .neq("status", "cancelled"),
      // Business members (owners/admins) for email
      supabase.from("business_members")
        .select("profiles(email)")
        .eq("business_id", businessId)
        .in("role", ["admin", "owner"]),
    ]);

    const businessName = businessRes.data?.name || "";
    const goals = goalsRes.data;
    const entries = entriesRes.data || [];
    const incomeSources = incomeSourcesRes.data || [];
    const managedProducts = managedProductsRes.data || [];
    const invoices = invoicesRes.data || [];

    // Emails
    const emails = (membersRes.data || [])
      .map((m) => (m.profiles as unknown as { email: string })?.email)
      .filter(Boolean)
      .join(", ");

    // === Revenue calculations ===
    const vatPct = Number(goals?.vat_percentage) || 17;
    const revenueTarget = Number(goals?.revenue_target) || 0; // target is without VAT
    const totalRegister = entries.reduce((s, e) => s + (Number(e.total_register) || 0), 0); // with VAT
    const totalRevenueNoVat = totalRegister / (1 + vatPct / 100);

    // Date range
    const entryDates = entries.map(e => e.entry_date).sort();
    const firstDate = entryDates[0] || monthStart;
    const lastDate = entryDates[entryDates.length - 1] || monthStart;
    const formatDateHe = (d: string) => {
      const [y, m, day] = d.split("-");
      return `${day}/${m}/${y.slice(-2)}`;
    };

    // === Income breakdown per source ===
    const entryIds = entries.map(e => e.id);
    let incomeBreakdown: { income_source_id: string; amount: number; orders_count: number }[] = [];
    if (entryIds.length > 0) {
      const { data: breakdownData } = await supabase
        .from("daily_income_breakdown")
        .select("income_source_id, amount, orders_count")
        .in("daily_entry_id", entryIds);
      incomeBreakdown = (breakdownData || []).map(r => ({
        income_source_id: r.income_source_id,
        amount: Number(r.amount) || 0,
        orders_count: Number(r.orders_count) || 0,
      }));
    }

    // Aggregate per income source
    const incomeBySource: Record<string, { amount: number; orders: number }> = {};
    for (const row of incomeBreakdown) {
      if (!incomeBySource[row.income_source_id]) {
        incomeBySource[row.income_source_id] = { amount: 0, orders: 0 };
      }
      incomeBySource[row.income_source_id].amount += row.amount;
      incomeBySource[row.income_source_id].orders += row.orders_count;
    }

    // Income source goals
    const isGoals = (goals?.income_source_goals || []) as { income_source_id: string; avg_ticket_target: number }[];

    // Build income source fields (up to 4)
    const response: Record<string, unknown> = {};

    for (let i = 0; i < Math.min(incomeSources.length, 4); i++) {
      const src = incomeSources[i];
      const num = i + 1;
      const actualData = incomeBySource[src.id] || { amount: 0, orders: 0 };
      const goalData = isGoals.find(g => g.income_source_id === src.id);
      const avgTicketTarget = Number(goalData?.avg_ticket_target) || 0;
      const actualAvgTicket = actualData.orders > 0 ? actualData.amount / actualData.orders : 0;
      const diffAvg = avgTicketTarget > 0 ? actualAvgTicket - avgTicketTarget : 0;
      // NIS diff from target: (actual avg - target avg) * actual orders
      const diffNisFromTarget = avgTicketTarget > 0 && actualData.orders > 0
        ? (actualAvgTicket - avgTicketTarget) * actualData.orders
        : 0;

      response[`הכנסה${num} שם`] = src.name;
      response[`הכנסה${num} יעד`] = avgTicketTarget;
      response[`הכנסה${num} בפועל`] = Math.round(actualAvgTicket);
      response[`הכנסה ${num} הפרש ממוצע בשקל`] = Math.round(diffAvg * 100) / 100;
      response[`הכנסה${num} הפרש שח`] = Math.round(diffAvg * 100) / 100;
      response[`הכנסה ${num} הפרש מהיעד בש''ח`] = Math.round(diffNisFromTarget);
    }

    // === Labor cost ===
    const laborCostTargetPct = Number(goals?.labor_cost_target_pct) || 0;
    const totalLaborCost = entries.reduce((s, e) =>
      s + (Number(e.labor_cost) || 0) + (Number(e.manager_daily_cost) || 0), 0);
    const laborCostActualPct = totalRevenueNoVat > 0 ? (totalLaborCost / totalRevenueNoVat) * 100 : 0;
    const laborDiffPct = laborCostActualPct - laborCostTargetPct;
    const laborDiffNis = totalRevenueNoVat > 0 ? (laborDiffPct / 100) * totalRevenueNoVat : 0;

    // === Food cost (cost of goods / עלות מכר) ===
    const foodCostTargetPct = Number(goals?.food_cost_target_pct) || 0;
    // Food cost = goods invoices + product usage cost
    const goodsInvoicesTotal = invoices
      .filter(inv => inv.invoice_type === "goods")
      .reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0);

    let productUsageCost = 0;
    if (entryIds.length > 0) {
      const { data: usageData } = await supabase
        .from("daily_product_usage")
        .select("quantity, unit_cost_at_time")
        .in("daily_entry_id", entryIds);
      productUsageCost = (usageData || []).reduce((s, u) =>
        s + (Number(u.quantity) || 0) * (Number(u.unit_cost_at_time) || 0), 0);
    }

    const totalFoodCost = goodsInvoicesTotal + productUsageCost;
    const foodCostActualPct = totalRevenueNoVat > 0 ? (totalFoodCost / totalRevenueNoVat) * 100 : 0;
    const foodDiffPct = foodCostActualPct - foodCostTargetPct;
    const foodDiffNis = totalRevenueNoVat > 0 ? (foodDiffPct / 100) * totalRevenueNoVat : 0;

    // === Managed product 1 (main managed product) ===
    if (managedProducts.length > 0) {
      const mp = managedProducts[0];
      const targetPct = Number(mp.target_pct) || 0;
      // Product cost from usage
      let mpCost = 0;
      if (entryIds.length > 0) {
        const { data: mpUsage } = await supabase
          .from("daily_product_usage")
          .select("quantity, unit_cost_at_time")
          .in("daily_entry_id", entryIds)
          .eq("product_id", mp.id);
        mpCost = (mpUsage || []).reduce((s, u) =>
          s + (Number(u.quantity) || 0) * (Number(u.unit_cost_at_time) || 0), 0);
      }
      const mpActualPct = totalRevenueNoVat > 0 ? (mpCost / totalRevenueNoVat) * 100 : 0;
      const mpDiffPct = mpActualPct - targetPct;
      const mpDiffNis = (mpDiffPct / 100) * totalRevenueNoVat;

      response["שם מוצר מנוהל 1"] = mp.name;
      response["עלות מוצר מנוהל 1 יעד"] = targetPct;
      response["עלות מוצר מנוהל 1 בפועל באחוזים"] = mpActualPct;
      response["עלות מוצר מנוהל 1 בפועל"] = mpActualPct;
      response["עלות מוצר מנוהל 1 הפרש"] = mpDiffPct;
      response["מוצר מנוהל 1 הפרש מהיעד בשקל"] = mpDiffNis;
      response["עלות מוצר מנוהל 1 הפרש שח"] = mpDiffNis;
    }

    // === Current expenses (הוצאות שוטפות) ===
    const currentExpensesTarget = Number(goals?.current_expenses_target) || 0;
    const currentExpensesActual = invoices
      .filter(inv => inv.invoice_type === "current")
      .reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0);
    const currentExpensesDiffNis = currentExpensesActual - currentExpensesTarget;
    const currentExpensesDiffPct = currentExpensesTarget > 0
      ? ((currentExpensesActual - currentExpensesTarget) / currentExpensesTarget) * 100 : 0;

    // === Profit ===
    const totalExpenses = totalLaborCost + totalFoodCost + currentExpensesActual;
    const profitActual = totalRevenueNoVat - totalExpenses;
    const profitTarget = revenueTarget - (
      (laborCostTargetPct / 100) * revenueTarget +
      (foodCostTargetPct / 100) * revenueTarget +
      currentExpensesTarget
    );
    const profitActualPct = totalRevenueNoVat > 0 ? (profitActual / totalRevenueNoVat) * 100 : 0;
    const profitTargetPct = revenueTarget > 0 ? (profitTarget / revenueTarget) * 100 : 0;

    // Build full response
    Object.assign(response, {
      "שם העסק": businessName,
      "אימייל": emails,
      "תחילת חודש": formatDateHe(firstDate),
      "תאריך אחרון": formatDateHe(lastDate),

      // Revenue
      "סה\"כ הכנסות כולל מעמ": Math.round(totalRegister),
      "סהכ מכירות בפועל ללא מעמ": Math.round(totalRevenueNoVat),
      "מכירות ללא מעמ הפרש": Math.round(revenueTarget),

      // Labor
      "עלות עובדים יעד": laborCostTargetPct,
      "עלות עובדים בפועל": laborCostActualPct,
      "עלות עובדים הפרש": laborDiffPct,
      "עלות עובדים הפרש שח": Math.round(laborDiffNis),

      // Food cost
      "עלות מכר יעד": foodCostTargetPct,
      "עלות מכר בפועל": foodCostActualPct,
      "עלות מכר הפרש": foodDiffPct,
      "עלות מכר הפרש שח": Math.round(foodDiffNis),

      // Current expenses
      "הוצאות שוטפות יעד שח": Math.round(currentExpensesTarget),
      "הוצאות שוטפות בפועל שח": Math.round(currentExpensesActual),
      "הוצאות שוטפות הפרש שח": Math.round(currentExpensesDiffNis),
      " הוצאות שוטפות הפרש שח": Math.round(currentExpensesDiffNis), // with space prefix (old n8n field)
      "הוצאות שוטפות הפרש באחוזים": currentExpensesDiffPct,

      // Profit
      "רווח שח יעד": Math.round(profitTarget),
      "רווח שח בפועל": Math.round(profitActual),
      "רווח שח הפרש": Math.round(profitActual - profitTarget),
      "רווח אחוז יעד": profitTargetPct,
      "רווח אחוז בפועל": profitActualPct,
    });

    return Response.json({ response });
  } catch (error) {
    console.error("[Weekly Summary API] Error:", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
