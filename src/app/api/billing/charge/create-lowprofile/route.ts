import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createLowProfile } from "@/lib/cardcom";
import { computeVat, DEFAULT_VAT_PERCENT } from "@/lib/billing/vat";

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: NextRequest) {
  // admin gate
  const server = await createServerClient();
  const { data: { user } } = await server.auth.getUser();
  if (!user) return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  const { data: profile } = await server.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return NextResponse.json({ error: "אין הרשאת אדמין" }, { status: 403 });

  const { customerId, monthlyAmount, vatPercent, mode } = await request.json();
  if (!customerId || !monthlyAmount || monthlyAmount <= 0)
    return NextResponse.json({ error: "חסר לקוח או סכום" }, { status: 400 });

  const isOneTime = mode === "one_time";

  // monthlyAmount is the NET (pre-VAT) amount. Cardcom is charged the GROSS.
  const vatPct = Number.isFinite(Number(vatPercent)) ? Number(vatPercent) : DEFAULT_VAT_PERCENT;
  const { gross, vatAmount } = computeVat(monthlyAmount, vatPct);

  const db = service();
  const { data: customer } = await db.from("billing_customers").select("*").eq("id", customerId).maybeSingle();
  if (!customer) return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });

  let sub: Record<string, unknown> | null = null;

  if (!isOneTime) {
    // upsert a pending subscription (one per customer)
    const { data: existingSub } = await db.from("billing_subscriptions").select("*").eq("customer_id", customerId).maybeSingle();
    if (!existingSub) {
      const ins = await db.from("billing_subscriptions")
        .insert({ customer_id: customerId, monthly_amount: monthlyAmount, vat_percent: vatPct, status: "pending" })
        .select("*").single();
      sub = ins.data;
    } else {
      const upd = await db.from("billing_subscriptions")
        .update({ monthly_amount: monthlyAmount, vat_percent: vatPct }).eq("id", existingSub.id).select("*").single();
      sub = upd.data;
    }

    if (!sub) return NextResponse.json({ error: "שגיאה ביצירת מנוי" }, { status: 500 });
  }

  // For one-time: no subscription, type one_time. For subscription: initial charge tied to the sub.
  const charge = await db.from("billing_charges")
    .insert({
      subscription_id: isOneTime ? null : (sub as { id: string }).id,
      customer_id: customerId,
      amount: gross,
      net_amount: monthlyAmount,
      vat_amount: vatAmount,
      vat_percent: vatPct,
      status: "pending",
      type: isOneTime ? "one_time" : "initial",
    })
    .select("*").single();
  if (charge.error || !charge.data)
    return NextResponse.json({ error: "שגיאה ביצירת חיוב" }, { status: 500 });

  const origin = new URL(request.url).origin;
  const lp = await createLowProfile({
    amount: gross,
    chargeId: charge.data.id,
    operation: isOneTime ? "ChargeOnly" : "ChargeAndCreateToken",
    successUrl: `${origin}/pay/result?status=success`,
    failedUrl: `${origin}/pay/result?status=failed`,
    webhookUrl: `${origin}/api/billing/cardcom/webhook`,
    customer: {
      name: customer.name,
      email: customer.email,
      taxId: customer.tax_id,
      phone: customer.phone,
    },
  });

  await db.from("billing_charges")
    .update({ cardcom_low_profile_id: lp.lowProfileId, cardcom_response: lp.raw })
    .eq("id", charge.data.id);

  if (!lp.url) return NextResponse.json({ error: "Cardcom לא החזיר כתובת תשלום", raw: lp.raw }, { status: 502 });
  if (isOneTime) {
    return NextResponse.json({ url: lp.url, chargeId: charge.data.id });
  }
  return NextResponse.json({ url: lp.url, chargeId: charge.data.id, subscriptionId: (sub as { id: string }).id });
}
