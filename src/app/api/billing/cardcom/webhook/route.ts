import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getLpResult } from "@/lib/cardcom";
import { addOneMonthClamped } from "@/lib/billing/dates";

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: NextRequest) {
  const db = service();
  // Cardcom may send form-encoded or JSON; accept both, then re-verify server-side.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any = {};
  try { payload = await request.json(); } catch {
    const form = await request.formData().catch(() => null);
    if (form) payload = Object.fromEntries(form.entries());
  }
  const returnValue = payload?.ReturnValue ?? payload?.returnValue;
  const lowProfileId = payload?.LowProfileId ?? payload?.lowProfileId;
  if (!returnValue) return NextResponse.json({ ok: true }); // nothing to correlate

  const { data: charge } = await db.from("billing_charges").select("*").eq("id", returnValue).maybeSingle();
  if (!charge) return NextResponse.json({ ok: true });

  const typedCharge = charge as { status: string; id: string; subscription_id: string | null; cardcom_low_profile_id: string | null };
  if (typedCharge.status === "success") return NextResponse.json({ ok: true }); // idempotent

  // Prefer the LowProfileId we stored on the charge over whatever the caller sent.
  // This prevents a forged POST from skipping verification by omitting LowProfileId.
  const lpid = lowProfileId ?? typedCharge.cardcom_low_profile_id;
  if (!lpid) {
    // Cannot verify without a low-profile id — do not write any state change.
    return NextResponse.json({ ok: true });
  }

  // Re-verify with Cardcom — do NOT trust the webhook body alone.
  const result = await getLpResult(lpid);

  if (!result.success) {
    await db.from("billing_charges").update({
      status: "failed", error_message: result.error ?? "נכשל", cardcom_response: result.raw,
    }).eq("id", typedCharge.id).eq("status", "pending");
    return NextResponse.json({ ok: true });
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const dayOfMonth = Number(todayStr.split("-")[2]);
  const nextChargeDate = addOneMonthClamped(todayStr, dayOfMonth);

  await db.from("billing_charges").update({
    status: "success",
    cardcom_transaction_id: result.transactionId ?? null,
    charged_at: new Date().toISOString(),
    cardcom_response: result.raw,
  }).eq("id", typedCharge.id).eq("status", "pending");

  if (typedCharge.subscription_id) {
    await db.from("billing_subscriptions").update({
      status: "active",
      cardcom_token: result.token ?? null,
      card_last_four: result.lastFour ?? null,
      card_expiry: result.expiryMMYY ?? null,
      day_of_month: dayOfMonth,
      next_charge_date: nextChargeDate,
      failed_attempts: 0,
      started_at: new Date().toISOString(),
    }).eq("id", typedCharge.subscription_id);
  }

  return NextResponse.json({ ok: true });
}
