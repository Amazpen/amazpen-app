import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient as createSupabaseServer } from "@/lib/supabase/server";

/**
 * Returns the owners + admins of a single business (name + email + role) so
 * the admin UI can pre-fill the goals-email dialog with the actual recipient
 * the email would go to. Admin-only.
 */
export async function GET(request: NextRequest) {
  try {
    const sb = await createSupabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const adminSb = createSupabaseAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: profile } = await adminSb
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.is_admin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const businessId = new URL(request.url).searchParams.get("business_id");
    if (!businessId) {
      return NextResponse.json({ error: "Missing business_id" }, { status: 400 });
    }

    const { data: members, error } = await adminSb
      .from("business_members")
      .select("role, profiles:user_id(id, email, full_name)")
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .in("role", ["admin", "owner"]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const owners = (members || [])
      .map((m) => {
        const p = m.profiles as unknown as { id?: string; email?: string; full_name?: string } | null;
        if (!p?.email) return null;
        return {
          id: p.id || "",
          email: p.email,
          fullName: p.full_name || "",
          role: m.role as string,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return NextResponse.json({ owners });
  } catch (err) {
    console.error("[business-owners] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
