import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const N8N_WEBHOOK_URL = "https://n8n-lv4j.onrender.com/webhook/target121";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, supplier_id, invoice_subtotal } = body;

    if (!business_id || !supplier_id || invoice_subtotal == null) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get the reference date (current month/year based on invoice)
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // 1. Check if supplier has a budget for this month
    const { data: budget } = await supabase
      .from("supplier_budgets")
      .select("budget_amount")
      .eq("business_id", business_id)
      .eq("supplier_id", supplier_id)
      .eq("year", year)
      .eq("month", month)
      .maybeSingle();

    if (!budget || !budget.budget_amount || Number(budget.budget_amount) === 0) {
      return Response.json({ sent: false, reason: "no_budget" });
    }

    const budgetAmount = Number(budget.budget_amount);

    // 2. Sum all invoices for this supplier this month (subtotal, excluding VAT)
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    const { data: invoices } = await supabase
      .from("invoices")
      .select("subtotal")
      .eq("business_id", business_id)
      .eq("supplier_id", supplier_id)
      .gte("reference_date", monthStart)
      .lt("reference_date", monthEnd)
      .neq("status", "cancelled");

    const totalSpent = (invoices || []).reduce((sum, inv) => sum + Number(inv.subtotal || 0), 0);

    // 3. Check if over budget
    if (totalSpent <= budgetAmount) {
      return Response.json({ sent: false, reason: "within_budget", totalSpent, budgetAmount });
    }

    const excess = totalSpent - budgetAmount;

    // 4. Get business name, supplier name, and member emails
    const [businessRes, supplierRes, membersRes] = await Promise.all([
      supabase.from("businesses").select("name").eq("id", business_id).single(),
      supabase.from("suppliers").select("name").eq("id", supplier_id).single(),
      supabase
        .from("business_members")
        .select("profiles(email)")
        .eq("business_id", business_id)
        .in("role", ["admin", "owner"]),
    ]);

    const businessName = businessRes.data?.name || "עסק";
    const supplierName = supplierRes.data?.name || "ספק";
    const emails = (membersRes.data || [])
      .map((m) => (m.profiles as unknown as { email: string })?.email)
      .filter(Boolean)
      .join(", ");

    if (!emails) {
      return Response.json({ sent: false, reason: "no_emails" });
    }

    // 5. Send webhook to n8n
    const webhookPayload = {
      "שם העסק": businessName,
      "אימייל": emails,
      "שם הספק": supplierName,
      "סכום יעד": budgetAmount.toFixed(1),
      "סכום חריגה": totalSpent.toFixed(1),
      "הפרש": `-${excess.toFixed(1)}`,
    };

    const webhookRes = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });

    console.log(`[Budget Alert] Sent for ${supplierName} in ${businessName}: spent ${totalSpent} / budget ${budgetAmount} (excess: ${excess}). Webhook status: ${webhookRes.status}`);

    return Response.json({ sent: true, totalSpent, budgetAmount, excess });
  } catch (error) {
    console.error("[Budget Alert] Error:", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
