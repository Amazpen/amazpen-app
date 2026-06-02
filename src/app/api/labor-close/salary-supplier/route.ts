import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Returns (creating if needed) the system "salary" supplier for a business.
export async function POST(request: NextRequest) {
  try {
    const { business_id } = await request.json().catch(() => ({}));
    if (!business_id) return NextResponse.json({ error: "business_id required" }, { status: 400 });

    const ssr = await createServerClient();
    const { data: { user } } = await ssr.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

    // Authorize: caller must be a member (or admin) of this business — this route
    // writes via the service-role key, so RLS does not protect it.
    const { data: profile } = await ssr
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    const isAdmin = profile?.is_admin === true;
    const { data: membership } = await ssr
      .from("business_members")
      .select("business_id")
      .eq("business_id", business_id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!membership && !isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: existing } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("business_id", business_id)
      .eq("system_kind", "labor_salary")
      .maybeSingle();

    if (existing) return NextResponse.json({ supplier: existing });

    const { data: created, error } = await supabase
      .from("suppliers")
      .insert({
        business_id,
        name: "משכורות עובדים",
        expense_type: "employee_costs",
        system_kind: "labor_salary",
        is_active: true,
        is_fixed_expense: false,
        vat_type: "none",
        requires_vat: false,
      })
      .select("id, name")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ supplier: created });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
