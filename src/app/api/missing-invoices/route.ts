import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Missing Invoices API — returns fixed-expense suppliers that have OPEN
 * (un-invoiced) months, scanning from the start of the current year up to
 * the current month — backwards from today, never forward.
 *
 * For each fixed-expense supplier we scan every month from
 *   max(January-of-current-year, the supplier's creation month)
 * through the current month, and report the months that have no invoice.
 *
 * Used by n8n workflow to send monthly reminder emails.
 *
 * Query params: business_id
 * Returns: { business_name, emails, missing_suppliers: [...], month_name,
 *            range, total_amount, total_entries, count }
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get("business_id");

    if (!businessId) {
      return Response.json({ error: "Missing business_id" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const now = new Date();
    const year = now.getFullYear();
    const curMonth = now.getMonth() + 1; // 1-12
    const yearStart = `${year}-01-01`;
    const lastDay = new Date(year, curMonth, 0).getDate();
    const monthEnd = `${year}-${String(curMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const hebrewMonths = [
      "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
      "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
    ];

    // Fetch in parallel
    const [businessRes, suppliersRes, membersRes] = await Promise.all([
      supabase.from("businesses").select("name").eq("id", businessId).single(),
      // Fixed-expense suppliers with monthly amounts (incl. created_at for the floor)
      supabase
        .from("suppliers")
        .select("id, name, monthly_expense_amount, expense_type, created_at")
        .eq("business_id", businessId)
        .eq("is_fixed_expense", true)
        .eq("is_active", true)
        .is("deleted_at", null),
      // Business members emails
      supabase.from("business_members")
        .select("profiles(email)")
        .eq("business_id", businessId)
        .in("role", ["admin", "owner"]),
    ]);

    const businessName = businessRes.data?.name || "";
    const fixedSuppliers = (suppliersRes.data || []).filter(
      (s) => s.monthly_expense_amount && parseFloat(s.monthly_expense_amount) > 0
    );
    const emails = (membersRes.data || [])
      .map((m) => (m.profiles as unknown as { email: string })?.email)
      .filter(Boolean);

    const emptyResponse = {
      business_name: businessName,
      emails,
      missing_suppliers: [],
      month_name: hebrewMonths[curMonth - 1],
      range: { from: hebrewMonths[0], to: hebrewMonths[curMonth - 1], year },
      total_amount: 0,
      total_entries: 0,
      count: 0,
    };

    if (fixedSuppliers.length === 0) {
      return Response.json(emptyResponse);
    }

    // All invoices for these suppliers from start-of-year through current month.
    const { data: existingInvoices } = await supabase
      .from("invoices")
      .select("supplier_id, invoice_date")
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .gte("invoice_date", yearStart)
      .lte("invoice_date", monthEnd)
      .in("supplier_id", fixedSuppliers.map((s) => s.id));

    // Set of "supplierId|YYYY-MM" that already have an invoice.
    const invoicedKeys = new Set<string>();
    for (const inv of existingInvoices || []) {
      if (!inv.invoice_date) continue;
      const ym = String(inv.invoice_date).slice(0, 7); // YYYY-MM
      invoicedKeys.add(`${inv.supplier_id}|${ym}`);
    }

    // Expense type labels
    const typeLabels: Record<string, string> = {
      current_expenses: "הוצאות שוטפות",
      goods_purchases: "רכישות סחורה",
      employee_costs: "עלות עובדים",
    };

    let totalAmount = 0;
    let totalEntries = 0;

    const missing = fixedSuppliers
      .map((s) => {
        const amount = Number(s.monthly_expense_amount) || 0;

        // Floor: don't count months before the supplier was created.
        let startMonth = 1;
        if (s.created_at) {
          const created = new Date(s.created_at);
          if (created.getFullYear() === year) {
            startMonth = created.getMonth() + 1;
          } else if (created.getFullYear() > year) {
            startMonth = curMonth + 1; // created in the future → nothing to scan
          }
        }

        const missingMonthNums: number[] = [];
        for (let m = startMonth; m <= curMonth; m++) {
          const ym = `${year}-${String(m).padStart(2, "0")}`;
          if (!invoicedKeys.has(`${s.id}|${ym}`)) {
            missingMonthNums.push(m);
          }
        }

        if (missingMonthNums.length === 0) return null;

        const monthsCount = missingMonthNums.length;
        const subtotal = amount * monthsCount;
        totalAmount += subtotal;
        totalEntries += monthsCount;

        return {
          name: s.name,
          category: typeLabels[s.expense_type] || "אחר",
          amount, // monthly amount
          missing_months: missingMonthNums.map((m) => hebrewMonths[m - 1]),
          months_count: monthsCount,
          subtotal,
        };
      })
      .filter(Boolean);

    return Response.json({
      business_name: businessName,
      emails,
      missing_suppliers: missing,
      month_name: hebrewMonths[curMonth - 1],
      range: { from: hebrewMonths[0], to: hebrewMonths[curMonth - 1], year },
      total_amount: totalAmount,
      total_entries: totalEntries,
      count: missing.length,
    });
  } catch (error) {
    console.error("[Missing Invoices API] Error:", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
