import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return NextResponse.json({ error: "אין הרשאת אדמין" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const customerId = params.get("customerId");
  const subscriptionId = params.get("subscriptionId");

  let query = supabase
    .from("billing_charges")
    .select("*")
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
