import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Upcoming Payments API — returns payment splits due in the next 7 days for a business.
 * Used by n8n workflow to send weekly payment forecast emails.
 *
 * Query params: business_id
 * Returns: { business_name, emails, payments: [...] }
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

    // Date range: today → 7 days ahead
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const weekAhead = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekAheadStr = weekAhead.toISOString().split("T")[0];

    // Fetch all data in parallel
    const [businessRes, splitsRes, membersRes] = await Promise.all([
      // Business name
      supabase.from("businesses").select("name").eq("id", businessId).single(),
      // Payment splits due in next 7 days, joined with payment + supplier info
      supabase
        .from("payment_splits")
        .select(`
          id, amount, payment_method, due_date, installment_number, installments_count,
          payments!inner(
            id, business_id, supplier_id, payment_date, total_amount, deleted_at,
            suppliers(name),
            invoices(invoice_type)
          )
        `)
        .gte("due_date", todayStr)
        .lte("due_date", weekAheadStr)
        .eq("payments.business_id", businessId)
        .is("payments.deleted_at", null),
      // Business members emails
      supabase.from("business_members")
        .select("profiles(email)")
        .eq("business_id", businessId)
        .in("role", ["admin", "owner"]),
    ]);

    const businessName = businessRes.data?.name || "";
    const emails = (membersRes.data || [])
      .map((m) => (m.profiles as unknown as { email: string })?.email)
      .filter(Boolean);

    // Payment method labels
    const methodLabels: Record<string, string> = {
      cash: "מזומן",
      check: "צ'ק",
      credit_card: "כרטיס אשראי",
      bank_transfer: "העברה בנקאית",
      bit: "ביט",
    };

    // Invoice type labels
    const typeLabels: Record<string, string> = {
      current: "הוצאות שוטפות",
      goods: "רכישות סחורה",
      employees: "עלות עובדים",
    };

    // Format payments
    const payments = (splitsRes.data || []).map((split) => {
      const payment = split.payments as unknown as {
        supplier_id: string;
        suppliers: { name: string } | null;
        invoices: { invoice_type: string } | null;
      };

      return {
        supplier_name: payment?.suppliers?.name || "לא ידוע",
        category: typeLabels[payment?.invoices?.invoice_type || ""] || "אחר",
        payment_method: methodLabels[split.payment_method] || split.payment_method || "לא ידוע",
        amount: Number(split.amount) || 0,
        due_date: split.due_date,
        installment_info: split.installments_count > 1
          ? `${split.installment_number}/${split.installments_count}`
          : null,
      };
    });

    // Sort by due_date
    payments.sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));

    const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);

    return Response.json({
      business_name: businessName,
      emails,
      payments,
      total_amount: totalAmount,
      payments_count: payments.length,
    });
  } catch (error) {
    console.error("[Upcoming Payments API] Error:", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
