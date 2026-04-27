import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Budget Alert — Cron Scan
 *
 * Walks all businesses × suppliers × current month, finds budget excesses,
 * and sends webhook alerts to n8n for suppliers that have not been reported
 * yet this month (using budget_alert_log for dedup).
 *
 * Protection: x-cron-secret header.
 */

const N8N_WEBHOOK_URL = "https://n8n-lv4j.onrender.com/webhook/target121";

export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get("x-cron-secret");
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const year = parseInt(searchParams.get("year") || "") || now.getFullYear();
  const month = parseInt(searchParams.get("month") || "") || (now.getMonth() + 1);
  // דוד ונתנאל תמיד ב-CC כדי שיראו התראות על חריגות אצל כל הלקוחות.
  const CC_EMAIL = "david@amazpen.co.il, netn114@gmail.com";

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  // 1. Get all supplier budgets for this month with budget > 0
  const { data: budgets, error: budgetsErr } = await supabase
    .from("supplier_budgets")
    .select("business_id, supplier_id, budget_amount")
    .eq("year", year)
    .eq("month", month)
    .is("deleted_at", null)
    .gt("budget_amount", 0);

  if (budgetsErr) {
    return NextResponse.json({ error: budgetsErr.message }, { status: 500 });
  }

  if (!budgets || budgets.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, sent: 0, skipped: 0 });
  }

  // 2. Sum actual spending per (business, supplier) this month
  const keys = budgets.map((b) => `${b.business_id}|${b.supplier_id}`);
  const { data: invoices } = await supabase
    .from("invoices")
    .select("business_id, supplier_id, subtotal")
    .gte("reference_date", monthStart)
    .lt("reference_date", monthEnd)
    .neq("status", "cancelled");

  const spentMap = new Map<string, number>();
  for (const inv of invoices || []) {
    const k = `${inv.business_id}|${inv.supplier_id}`;
    spentMap.set(k, (spentMap.get(k) || 0) + Number(inv.subtotal || 0));
  }

  // 3. Find excesses
  const excesses: Array<{
    business_id: string;
    supplier_id: string;
    budget_amount: number;
    total_spent: number;
    excess: number;
  }> = [];
  for (const b of budgets) {
    const k = `${b.business_id}|${b.supplier_id}`;
    const spent = spentMap.get(k) || 0;
    const budgetAmount = Number(b.budget_amount);
    if (spent > budgetAmount) {
      excesses.push({
        business_id: b.business_id,
        supplier_id: b.supplier_id,
        budget_amount: budgetAmount,
        total_spent: spent,
        excess: spent - budgetAmount,
      });
    }
  }

  if (excesses.length === 0) {
    return NextResponse.json({
      ok: true,
      scanned: budgets.length,
      excesses: 0,
      sent: 0,
      skipped: 0,
    });
  }

  // 4. Filter out already-alerted (dedup via budget_alert_log)
  const { data: alreadyAlerted } = await supabase
    .from("budget_alert_log")
    .select("business_id, supplier_id")
    .eq("year", year)
    .eq("month", month)
    .in(
      "business_id",
      Array.from(new Set(excesses.map((e) => e.business_id)))
    );

  const alertedSet = new Set(
    (alreadyAlerted || []).map((a) => `${a.business_id}|${a.supplier_id}`)
  );
  const newAlerts = excesses.filter(
    (e) => !alertedSet.has(`${e.business_id}|${e.supplier_id}`)
  );

  if (newAlerts.length === 0) {
    return NextResponse.json({
      ok: true,
      scanned: budgets.length,
      excesses: excesses.length,
      sent: 0,
      skipped: excesses.length,
      note: "all-already-alerted",
    });
  }

  // 5. Enrich with business name, supplier name, member emails
  const businessIds = Array.from(new Set(newAlerts.map((e) => e.business_id)));
  const supplierIds = Array.from(new Set(newAlerts.map((e) => e.supplier_id)));

  const [businessesRes, suppliersRes, membersRes] = await Promise.all([
    supabase.from("businesses").select("id, name").in("id", businessIds),
    supabase.from("suppliers").select("id, name").in("id", supplierIds),
    // Owners of each business — they're the recipients of the budget alert.
    // Excludes 'admin' because that's the platform-level admin role (that's
    // what david is), not a business owner.
    supabase
      .from("business_members")
      .select("business_id, profiles(email)")
      .in("business_id", businessIds)
      .eq("role", "owner")
      .is("deleted_at", null),
  ]);

  const businessMap = new Map<string, string>();
  for (const b of businessesRes.data || []) businessMap.set(b.id, b.name);

  const supplierMap = new Map<string, string>();
  for (const s of suppliersRes.data || []) supplierMap.set(s.id, s.name);

  const emailsByBusiness = new Map<string, string[]>();
  for (const m of membersRes.data || []) {
    const email = (m.profiles as unknown as { email?: string } | null)?.email;
    if (!email) continue;
    const list = emailsByBusiness.get(m.business_id) || [];
    if (!list.includes(email)) list.push(email);
    emailsByBusiness.set(m.business_id, list);
  }

  // 6. Send webhook for each new alert + log
  let sent = 0;
  const logRows: Array<{
    business_id: string;
    supplier_id: string;
    year: number;
    month: number;
    budget_amount: number;
    total_spent: number;
    excess: number;
    sent_to: string;
  }> = [];

  for (const alert of newAlerts) {
    const businessName = businessMap.get(alert.business_id) || "עסק";
    const supplierName = supplierMap.get(alert.supplier_id) || "ספק";
    // Primary recipients: all owners of this specific business.
    // CC: david, so he sees every alert across the platform.
    const ownerEmails = emailsByBusiness.get(alert.business_id) || [];
    const toField = ownerEmails.join(", ");

    // Skip if this business has no owner to notify — david alone shouldn't
    // trigger a mail with empty To. Fall back to david-as-primary in that
    // edge case so the alert isn't silently dropped.
    const effectiveTo = toField || CC_EMAIL;
    const effectiveCc = toField ? CC_EMAIL : "";

    const payload = {
      "שם העסק": businessName,
      "אימייל": effectiveTo,
      "cc": effectiveCc,
      "שם הספק": supplierName,
      "סכום יעד": alert.budget_amount.toFixed(1),
      "סכום חריגה": alert.total_spent.toFixed(1),
      "הפרש": `-${alert.excess.toFixed(1)}`,
    };

    try {
      const resp = await fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        sent++;
        logRows.push({
          business_id: alert.business_id,
          supplier_id: alert.supplier_id,
          year,
          month,
          budget_amount: alert.budget_amount,
          total_spent: alert.total_spent,
          excess: alert.excess,
          sent_to: [effectiveTo, effectiveCc].filter(Boolean).join(" | "),
        });
      }
    } catch (err) {
      console.error("[Budget Alert Cron] webhook error:", err);
    }
  }

  // 7. Insert logs to prevent duplicates next run
  if (logRows.length > 0) {
    await supabase.from("budget_alert_log").insert(logRows);
  }

  return NextResponse.json({
    ok: true,
    scanned: budgets.length,
    excesses: excesses.length,
    sent,
    skipped: excesses.length - newAlerts.length,
  });
}
