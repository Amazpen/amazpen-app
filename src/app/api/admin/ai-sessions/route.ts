import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// GET /api/admin/ai-sessions — List AI chat sessions for admin viewing
// Query params: businessId, userId
export async function GET(request: NextRequest) {
  const serverSupabase = await createServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) {
    return NextResponse.json({ error: "אין הרשאת אדמין" }, { status: 403 });
  }

  // Use admin client to bypass RLS (auth already verified above)
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { searchParams } = request.nextUrl;
  const businessId = searchParams.get("businessId");
  const userId = searchParams.get("userId");

  // If no filters, return businesses list
  if (!businessId) {
    const { data: businesses } = await admin
      .from("businesses")
      .select("id, name")
      .is("deleted_at", null)
      .order("name");

    return NextResponse.json({ businesses: businesses || [] });
  }

  // If businessId but no userId, return users for that business
  if (!userId) {
    const { data: members } = await admin
      .from("business_members")
      .select("user_id, role, profiles!inner(full_name, email)")
      .eq("business_id", businessId);

    const users = (members || []).map((m) => ({
      id: m.user_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      name: (m.profiles as any)?.full_name || (m.profiles as any)?.email || "ללא שם",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      email: (m.profiles as any)?.email,
      role: m.role,
    }));

    return NextResponse.json({ users });
  }

  // If both, return sessions for that user+business
  const { data: sessions } = await admin
    .from("ai_chat_sessions")
    .select("id, title, created_at, updated_at")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .order("updated_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ sessions: sessions || [] });
}
