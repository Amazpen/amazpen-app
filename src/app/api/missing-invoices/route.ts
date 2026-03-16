import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Missing Invoices API — returns fixed-expense suppliers that don't have
 * an invoice for the current month yet.
 * Used by n8n workflow to send monthly reminder emails.
 *
 * Query params: business_id
 * Returns: { business_name, emails, missing_suppliers: [...], month_name }
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
    const month = now.getMonth() + 1;
    const monthStr = String(month).padStart(2, "0");
    const monthStart = `${year}-${monthStr}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${year}-${monthStr}-${String(lastDay).padStart(2, "0")}`;

    const hebrewMonths = [
      "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
      "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
    ];

    // Fetch in parallel
    const [businessRes, suppliersRes, membersRes] = await Promise.all([
      supabase.from("businesses").select("name").eq("id", businessId).single(),
      // Fixed-expense suppliers with monthly amounts
      supabase
        .from("suppliers")
        .select("id, name, monthly_expense_amount, expense_type")
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

    if (fixedSuppliers.length === 0) {
      return Response.json({
        business_name: businessName,
        emails,
        missing_suppliers: [],
        month_name: hebrewMonths[month - 1],
        count: 0,
      });
    }

    // Check which suppliers already have invoices this month
    const { data: existingInvoices } = await supabase
      .from("invoices")
      .select("supplier_id")
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .gte("invoice_date", monthStart)
      .lte("invoice_date", monthEnd)
      .in("supplier_id", fixedSuppliers.map((s) => s.id));

    const existingIds = new Set((existingInvoices || []).map((inv) => inv.supplier_id));

    // Expense type labels
    const typeLabels: Record<string, string> = {
      current_expenses: "הוצאות שוטפות",
      goods_purchases: "רכישות סחורה",
      employee_costs: "עלות עובדים",
    };

    const missing = fixedSuppliers
      .filter((s) => !existingIds.has(s.id))
      .map((s) => ({
        name: s.name,
        amount: Number(s.monthly_expense_amount) || 0,
        category: typeLabels[s.expense_type] || "אחר",
      }));

    return Response.json({
      business_name: businessName,
      emails,
      missing_suppliers: missing,
      month_name: hebrewMonths[month - 1],
      count: missing.length,
    });
  } catch (error) {
    console.error("[Missing Invoices API] Error:", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
