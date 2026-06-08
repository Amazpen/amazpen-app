import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

async function requireAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "לא מחובר" }, { status: 401 }) };
  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return { error: NextResponse.json({ error: "אין הרשאת אדמין" }, { status: 403 }) };
  return { supabase, user };
}

export async function GET(request: NextRequest) {
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx.error;
  const { supabase } = ctx;

  const params = new URL(request.url).searchParams;
  const customerId = params.get("customerId");
  const subscriptionId = params.get("subscriptionId");

  let query = supabase
    .from("billing_charges")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (customerId) {
    query = query.eq("customer_id", customerId);
  } else if (subscriptionId) {
    query = query.eq("subscription_id", subscriptionId);
  } else {
    return NextResponse.json({ error: "חסר customerId" }, { status: 400 });
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ charges: data });
}

export async function DELETE(request: NextRequest) {
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx.error;
  const { supabase } = ctx;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "חסר מזהה חיוב" }, { status: 400 });

  const { data: charge, error: fetchError } = await supabase
    .from("billing_charges")
    .select("status")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!charge) return NextResponse.json({ error: "החיוב לא נמצא" }, { status: 404 });

  // Paid charges are permanent records (invoice/accounting) — never deletable.
  if (charge.status === "success") {
    return NextResponse.json({ error: "לא ניתן למחוק חיוב ששולם" }, { status: 400 });
  }

  const { error: delError } = await supabase
    .from("billing_charges")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
