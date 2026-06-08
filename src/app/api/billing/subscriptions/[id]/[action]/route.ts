import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { chargeToken } from "@/lib/cardcom";
import { addOneMonthClamped } from "@/lib/billing/dates";

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

interface SubscriptionRow {
  id: string;
  status: string;
  customer_id: string;
  monthly_amount: number;
  cardcom_token: string | null;
  card_expiry: string | null;
  day_of_month: number | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  const server = await createServerClient();
  const { data: { user } } = await server.auth.getUser();
  if (!user) return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  const { data: profile } = await server.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return NextResponse.json({ error: "אין הרשאת אדמין" }, { status: 403 });

  const { id, action } = await params;
  const db = service();
  const { data: subRow } = await db.from("billing_subscriptions").select("*").eq("id", id).maybeSingle();
  if (!subRow) return NextResponse.json({ error: "מנוי לא נמצא" }, { status: 404 });
  const sub = subRow as SubscriptionRow;

  if (action === "cancel") {
    await db.from("billing_subscriptions").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ ok: true });
  }
  if (action === "pause") {
    await db.from("billing_subscriptions").update({ status: "paused" }).eq("id", id);
    return NextResponse.json({ ok: true });
  }
  if (action === "resume") {
    if (sub.status !== "paused") return NextResponse.json({ error: "ניתן לחדש רק מנוי מושהה" }, { status: 400 });
    await db.from("billing_subscriptions").update({ status: "active" }).eq("id", id);
    return NextResponse.json({ ok: true });
  }
  if (action === "charge-now") {
    if (!sub.cardcom_token || !sub.card_expiry)
      return NextResponse.json({ error: "אין token שמור לחיוב" }, { status: 400 });
    const charge = await db.from("billing_charges")
      .insert({ subscription_id: sub.id, customer_id: sub.customer_id, amount: sub.monthly_amount, status: "pending", type: "manual" })
      .select("*").single();
    if (charge.error || !charge.data)
      return NextResponse.json({ error: "שגיאה ביצירת חיוב" }, { status: 500 });
    const chargeId = (charge.data as { id: string }).id;
    const result = await chargeToken({ amount: sub.monthly_amount, token: sub.cardcom_token, cardExpiryMMYY: sub.card_expiry });
    await db.from("billing_charges").update({
      status: result.success ? "success" : "failed",
      cardcom_transaction_id: result.transactionId ?? null,
      error_message: result.success ? null : result.error,
      charged_at: result.success ? new Date().toISOString() : null,
      cardcom_response: result.raw,
    }).eq("id", chargeId);
    if (result.success) {
      const today = new Date().toISOString().split("T")[0];
      await db.from("billing_subscriptions").update({
        next_charge_date: addOneMonthClamped(today, sub.day_of_month ?? Number(today.split("-")[2])),
        failed_attempts: 0,
      }).eq("id", id);
    }
    return NextResponse.json({ ok: result.success, error: result.success ? undefined : result.error });
  }

  return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
}
