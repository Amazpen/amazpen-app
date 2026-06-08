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

export async function GET() {
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx.error;
  const { supabase } = ctx;

  const { data: customers, error } = await supabase
    .from("billing_customers")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (customers ?? []).map((c) => c.id);
  const subsResult = ids.length
    ? await supabase.from("billing_subscriptions").select("*").in("customer_id", ids)
    : { data: [] as Record<string, unknown>[] };

  const subs = subsResult.data ?? [];
  const byCustomer = new Map(subs.map((s) => [s.customer_id as string, s]));
  const rows = (customers ?? []).map((c) => ({ ...c, subscription: byCustomer.get(c.id) ?? null }));
  return NextResponse.json({ customers: rows });
}

export async function POST(request: NextRequest) {
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx.error;
  const { supabase, user } = ctx;

  const body = await request.json();
  const { id, name, phone, email, tax_id, notes } = body;
  if (!name) return NextResponse.json({ error: "חסר שם" }, { status: 400 });

  if (id) {
    const { data, error } = await supabase
      .from("billing_customers")
      .update({ name, phone, email, tax_id, notes })
      .eq("id", id).select("*").maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ customer: data });
  }

  const { data, error } = await supabase
    .from("billing_customers")
    .insert({ name, phone, email, tax_id, notes, created_by: user.id })
    .select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ customer: data });
}
