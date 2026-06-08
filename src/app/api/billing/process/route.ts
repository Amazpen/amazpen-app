import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { chargeToken } from "@/lib/cardcom";
import { addOneMonthClamped, isDueOn } from "@/lib/billing/dates";
import { computeVat, DEFAULT_VAT_PERCENT } from "@/lib/billing/vat";

const MAX_ATTEMPTS = 3;

interface SubscriptionRow {
  id: string;
  customer_id: string | null;
  monthly_amount: number; // NET (pre-VAT)
  vat_percent: number | null;
  cardcom_token: string | null;
  card_expiry: string | null;
  next_charge_date: string | null;
  day_of_month: number | null;
  failed_attempts: number | null;
}

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get("x-cron-secret");
  const valid = process.env.CRON_SECRET;
  let ok = false;
  try {
    if (valid && cronSecret) ok = timingSafeEqual(Buffer.from(cronSecret), Buffer.from(valid));
  } catch {
    /* length mismatch = unauthorized */
  }
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = service();
  const today = new Date().toISOString().split("T")[0];

  const { data: subs, error } = await db
    .from("billing_subscriptions")
    .select("*")
    .eq("status", "active")
    .not("cardcom_token", "is", null)
    .lte("next_charge_date", today);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!subs || subs.length === 0)
    return NextResponse.json({ processed: 0, message: "אין מנויים לחיוב היום" });

  let processed = 0;
  const errors: string[] = [];

  for (const raw of subs as SubscriptionRow[]) {
    const sub = raw;
    try {
      if (!sub.next_charge_date || !isDueOn(sub.next_charge_date, today)) continue;

      // Safety: chargeToken needs both token and expiry; skip (don't crash) if missing.
      if (!sub.cardcom_token || !sub.card_expiry) {
        errors.push(`${sub.id}: missing token or card expiry`);
        continue;
      }

      // idempotency: skip if a successful charge already exists today
      const { data: existing } = await db
        .from("billing_charges")
        .select("id")
        .eq("subscription_id", sub.id)
        .eq("status", "success")
        .gte("charged_at", `${today}T00:00:00`)
        .maybeSingle();
      if (existing) continue;

      // monthly_amount is NET; recompute gross at the subscription's stored vat_percent.
      const vatPct = sub.vat_percent ?? DEFAULT_VAT_PERCENT;
      const { gross, vatAmount } = computeVat(sub.monthly_amount, vatPct);

      const charge = await db
        .from("billing_charges")
        .insert({
          subscription_id: sub.id,
          customer_id: sub.customer_id,
          amount: gross,
          net_amount: sub.monthly_amount,
          vat_amount: vatAmount,
          vat_percent: vatPct,
          status: "pending",
          type: "recurring",
        })
        .select("*")
        .single();

      if (!charge.data) {
        errors.push(`${sub.id}: failed to create charge row${charge.error ? `: ${charge.error.message}` : ""}`);
        continue;
      }
      const chargeId = charge.data.id;

      const result = await chargeToken({
        amount: gross,
        token: sub.cardcom_token,
        cardExpiryMMYY: sub.card_expiry,
      });

      if (result.success) {
        await db
          .from("billing_charges")
          .update({
            status: "success",
            cardcom_transaction_id: result.transactionId ?? null,
            charged_at: new Date().toISOString(),
            cardcom_response: result.raw,
          })
          .eq("id", chargeId);
        await db
          .from("billing_subscriptions")
          .update({
            next_charge_date: addOneMonthClamped(
              sub.next_charge_date,
              sub.day_of_month ?? Number(today.split("-")[2])
            ),
            failed_attempts: 0,
          })
          .eq("id", sub.id);
        processed++;
      } else {
        const attempts = (sub.failed_attempts ?? 0) + 1;
        await db
          .from("billing_charges")
          .update({
            status: "failed",
            error_message: result.error,
            cardcom_response: result.raw,
          })
          .eq("id", chargeId);
        await db
          .from("billing_subscriptions")
          .update({
            failed_attempts: attempts,
            status: attempts >= MAX_ATTEMPTS ? "failed" : "active",
          })
          .eq("id", sub.id);
        errors.push(`${sub.id}: ${result.error}`);
      }
    } catch (err) {
      errors.push(`${sub.id}: ${String(err)}`);
    }
  }

  return NextResponse.json({
    processed,
    total: subs.length,
    errors: errors.length ? errors : undefined,
  });
}
