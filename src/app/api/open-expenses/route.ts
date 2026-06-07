import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Open Expenses API — returns, per business, the expenses (invoices) that have
 * NOT been closed yet (status pending / clarification — i.e. not paid),
 * grouped by supplier.
 *
 * Used by the n8n workflow to email David + owners a per-business summary of
 * still-open expenses.
 *
 * Query params: business_id
 * Returns: { business_name, emails, suppliers: [{ name, open_count, open_amount }],
 *            total_open_count, total_open_amount, count }
 */
const OPEN_STATUSES = ["pending", "clarification"];

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
      // Open (un-closed) invoices with their supplier name.
      supabase
        .from("invoices")
        .select("total_amount, supplier_id, suppliers(name)")
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

    // Group by supplier.
    const bySupplier = new Map<string, { name: string; open_count: number; open_amount: number }>();
    for (const inv of invoices) {
      const supplierName =
        (inv.suppliers as unknown as { name: string } | null)?.name || "ללא ספק";
      const key = inv.supplier_id || `__none__:${supplierName}`;
      const amount = Number(inv.total_amount) || 0;
      const entry = bySupplier.get(key) || { name: supplierName, open_count: 0, open_amount: 0 };
      entry.open_count += 1;
      entry.open_amount += amount;
      bySupplier.set(key, entry);
    }

    const suppliers = Array.from(bySupplier.values())
      .map((s) => ({ ...s, open_amount: Math.round(s.open_amount * 100) / 100 }))
      .sort((a, b) => b.open_amount - a.open_amount);

    const totalOpenCount = invoices.length;
    const totalOpenAmount =
      Math.round(suppliers.reduce((s, x) => s + x.open_amount, 0) * 100) / 100;

    return Response.json({
      business_name: businessName,
      emails,
      suppliers,
      total_open_count: totalOpenCount,
      total_open_amount: totalOpenAmount,
      count: suppliers.length,
    });
  } catch (error) {
    console.error("[Open Expenses API] Error:", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
