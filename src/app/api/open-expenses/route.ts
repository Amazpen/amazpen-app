import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Open (un-closed) Expenses API — returns, per business, the FIXED-EXPENSE
 * invoices that have NOT been fully "closed" yet, i.e. they are missing an
 * invoice number and/or an attached image. To close such a record the user
 * must add both the invoice number and the document image.
 *
 * Scope: only suppliers flagged is_fixed_expense.
 * Not-closed = (no invoice_number) OR (no attached image).
 * Grouped BY MONTH (newest first — looking backwards, never forward).
 *
 * Query params: business_id
 * Returns: {
 *   business_name, emails,
 *   months: [{ ym, label, count, amount,
 *              invoices: [{supplier, expense_type, invoice_number, has_number, has_image, date, amount}] }],
 *   total_open_count, total_open_amount, count
 * }
 */
const TYPE_LABELS: Record<string, string> = {
  goods: "רכישות סחורה",
  current: "הוצאות שוטפות",
  employees: "עלות עובדים",
};

// suppliers.expense_type uses a different vocabulary than invoices.invoice_type
const SUPPLIER_TYPE_LABELS: Record<string, string> = {
  current_expenses: "הוצאות שוטפות",
  goods_purchases: "רכישות סחורה",
  employee_costs: "עלות עובדים",
};

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

function isBlank(v: string | null | undefined): boolean {
  return !v || String(v).trim() === "";
}

function formatDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  if (!y || !m || !day) return String(d);
  return `${day}/${m}/${y}`;
}

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

    const [businessRes, fixedSuppliersRes, membersRes] = await Promise.all([
      supabase.from("businesses").select("name").eq("id", businessId).single(),
      // Fixed-expense suppliers only.
      supabase
        .from("suppliers")
        .select("id, name, monthly_expense_amount, expense_type, created_at")
        .eq("business_id", businessId)
        .eq("is_fixed_expense", true)
        .eq("is_active", true)
        .is("deleted_at", null),
      supabase.from("business_members")
        .select("profiles(email)")
        .eq("business_id", businessId)
        .in("role", ["admin", "owner"]),
    ]);

    const businessName = businessRes.data?.name || "";
    const emails = (membersRes.data || [])
      .map((m) => (m.profiles as unknown as { email: string })?.email)
      .filter(Boolean);

    const fixedSuppliers = fixedSuppliersRes.data || [];
    const supplierName = new Map<string, string>(
      fixedSuppliers.map((s) => [s.id, s.name])
    );

    const empty = {
      business_name: businessName,
      emails,
      months: [] as unknown[],
      total_open_count: 0,
      total_open_amount: 0,
      count: 0,
    };

    if (fixedSuppliers.length === 0) {
      return Response.json(empty);
    }

    // All invoices of those fixed-expense suppliers.
    const { data: invoiceRows } = await supabase
      .from("invoices")
      .select("invoice_number, invoice_date, total_amount, invoice_type, attachment_url, consolidated_attachment_url, supplier_id")
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .in("supplier_id", fixedSuppliers.map((s) => s.id))
      .limit(10000);

    // Keep only the ones that are NOT closed: missing number OR missing image.
    const incomplete = (invoiceRows || []).filter((inv) => {
      const noNumber = isBlank(inv.invoice_number);
      const noImage = isBlank(inv.attachment_url) && isBlank(inv.consolidated_attachment_url);
      return noNumber || noImage;
    });

    type Inv = {
      supplier: string; expense_type: string; invoice_number: string;
      has_number: boolean; has_image: boolean; date: string; amount: number;
    };
    const byMonth = new Map<string, { ym: string; label: string; amount: number; invoices: Inv[] }>();

    for (const inv of incomplete) {
      const dateStr = inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : "";
      const ym = dateStr ? dateStr.slice(0, 7) : "0000-00";
      const label = dateStr
        ? `${HEBREW_MONTHS[parseInt(dateStr.slice(5, 7), 10) - 1]} ${dateStr.slice(0, 4)}`
        : "ללא תאריך";
      const amount = Number(inv.total_amount) || 0;
      const hasNumber = !isBlank(inv.invoice_number);
      const hasImage = !(isBlank(inv.attachment_url) && isBlank(inv.consolidated_attachment_url));

      const entry = byMonth.get(ym) || { ym, label, amount: 0, invoices: [] };
      entry.amount += amount;
      entry.invoices.push({
        supplier: supplierName.get(inv.supplier_id as string) || "ללא ספק",
        expense_type: TYPE_LABELS[inv.invoice_type as string] || "אחר",
        invoice_number: hasNumber ? String(inv.invoice_number) : "",
        has_number: hasNumber,
        has_image: hasImage,
        date: formatDate(dateStr || null),
        amount: Math.round(amount * 100) / 100,
      });
      byMonth.set(ym, entry);
    }

    // Current month: fixed-expense suppliers that have NO invoice yet are also
    // "not closed" (the monthly expense hasn't been entered at all). Add them
    // under the current month with the expected monthly amount.
    const now = new Date();
    const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const curLabel = `${HEBREW_MONTHS[now.getMonth()]} ${now.getFullYear()}`;
    const suppliersWithCurMonthInvoice = new Set(
      (invoiceRows || [])
        .filter((inv) => inv.invoice_date && String(inv.invoice_date).slice(0, 7) === curYm)
        .map((inv) => inv.supplier_id as string)
    );
    for (const s of fixedSuppliers) {
      const monthly = Number(s.monthly_expense_amount) || 0;
      if (monthly <= 0) continue;
      if (s.created_at) {
        const c = new Date(s.created_at);
        if (
          c.getFullYear() > now.getFullYear() ||
          (c.getFullYear() === now.getFullYear() && c.getMonth() > now.getMonth())
        ) {
          continue; // supplier created after the current month
        }
      }
      if (suppliersWithCurMonthInvoice.has(s.id)) continue; // already has a record this month
      const entry = byMonth.get(curYm) || { ym: curYm, label: curLabel, amount: 0, invoices: [] };
      entry.amount += monthly;
      entry.invoices.push({
        supplier: s.name,
        expense_type: SUPPLIER_TYPE_LABELS[s.expense_type as string] || "אחר",
        invoice_number: "",
        has_number: false,
        has_image: false,
        date: "",
        amount: Math.round(monthly * 100) / 100,
      });
      byMonth.set(curYm, entry);
    }

    const months = Array.from(byMonth.values())
      .sort((a, b) => (a.ym < b.ym ? 1 : a.ym > b.ym ? -1 : 0))
      .map((mo) => ({
        ym: mo.ym,
        label: mo.label,
        count: mo.invoices.length,
        amount: Math.round(mo.amount * 100) / 100,
        invoices: mo.invoices.sort((a, b) => b.amount - a.amount),
      }));

    const totalOpenCount = months.reduce((s, m) => s + m.count, 0);
    const totalOpenAmount =
      Math.round(months.reduce((s, m) => s + m.amount, 0) * 100) / 100;

    return Response.json({
      business_name: businessName,
      emails,
      months,
      total_open_count: totalOpenCount,
      total_open_amount: totalOpenAmount,
      count: months.length,
    });
  } catch (error) {
    console.error("[Open Expenses API] Error:", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
