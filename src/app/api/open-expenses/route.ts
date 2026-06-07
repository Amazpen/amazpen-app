import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Open Expenses API — returns, per business, the expenses (invoices) that have
 * NOT been closed yet (status pending / clarification — i.e. not paid),
 * grouped BY MONTH. Each month holds the list of its open invoices.
 *
 * Used by the n8n workflow to email David + owners a per-business, per-month
 * list of still-open invoices.
 *
 * Query params: business_id
 * Returns: {
 *   business_name, emails,
 *   months: [{ ym, label, count, amount, invoices: [{supplier, invoice_number, date, amount}] }],
 *   total_open_count, total_open_amount, count
 * }
 */
const OPEN_STATUSES = ["pending", "clarification"];

const TYPE_LABELS: Record<string, string> = {
  goods: "רכישות סחורה",
  current: "הוצאות שוטפות",
  employees: "עלות עובדים",
};

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

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

    const [businessRes, invoicesRes, membersRes] = await Promise.all([
      supabase.from("businesses").select("name").eq("id", businessId).single(),
      supabase
        .from("invoices")
        .select("invoice_number, invoice_date, total_amount, invoice_type, supplier_id, suppliers(name)")
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .in("status", OPEN_STATUSES)
        .limit(10000),
      supabase.from("business_members")
        .select("profiles(email)")
        .eq("business_id", businessId)
        .in("role", ["admin", "owner"]),
    ]);

    const businessName = businessRes.data?.name || "";
    const emails = (membersRes.data || [])
      .map((m) => (m.profiles as unknown as { email: string })?.email)
      .filter(Boolean);

    const invoices = invoicesRes.data || [];

    // Group by month (YYYY-MM of invoice_date). No date -> "ללא תאריך" bucket.
    type Inv = { supplier: string; expense_type: string; invoice_number: string; date: string; amount: number };
    const byMonth = new Map<string, { ym: string; label: string; amount: number; invoices: Inv[] }>();

    for (const inv of invoices) {
      const dateStr = inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : "";
      const ym = dateStr ? dateStr.slice(0, 7) : "0000-00";
      let label: string;
      if (dateStr) {
        const m = parseInt(dateStr.slice(5, 7), 10);
        label = `${HEBREW_MONTHS[m - 1]} ${dateStr.slice(0, 4)}`;
      } else {
        label = "ללא תאריך";
      }
      const amount = Number(inv.total_amount) || 0;
      const supplier =
        (inv.suppliers as unknown as { name: string } | null)?.name || "ללא ספק";

      const entry = byMonth.get(ym) || { ym, label, amount: 0, invoices: [] };
      entry.amount += amount;
      entry.invoices.push({
        supplier,
        expense_type: TYPE_LABELS[inv.invoice_type as string] || "אחר",
        invoice_number: inv.invoice_number || "—",
        date: formatDate(dateStr || null),
        amount: Math.round(amount * 100) / 100,
      });
      byMonth.set(ym, entry);
    }

    // Newest month first; within a month, biggest amount first.
    const months = Array.from(byMonth.values())
      .sort((a, b) => (a.ym < b.ym ? 1 : a.ym > b.ym ? -1 : 0))
      .map((mo) => ({
        ym: mo.ym,
        label: mo.label,
        count: mo.invoices.length,
        amount: Math.round(mo.amount * 100) / 100,
        invoices: mo.invoices.sort((a, b) => b.amount - a.amount),
      }));

    const totalOpenCount = invoices.length;
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
