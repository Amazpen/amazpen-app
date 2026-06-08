import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return NextResponse.json({ error: "אין הרשאת אדמין" }, { status: 403 });

  const chargeId = new URL(request.url).searchParams.get("chargeId");
  if (!chargeId) return NextResponse.json({ error: "חסר chargeId" }, { status: 400 });

  const { data } = await supabase.from("billing_charges").select("id,status,error_message").eq("id", chargeId).maybeSingle();
  return NextResponse.json({ charge: data });
}
