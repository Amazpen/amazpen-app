import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

/**
 * GET /api/all-users-activity
 *   Admin-only. Returns every non-deleted profile with:
 *   - basic profile fields (id, email, full_name, avatar_url)
 *   - last_seen_at: MAX(entered_at) from user_activity_log (null if never tracked)
 *   - businesses: array of business names the user is a member of
 *   Used by the "משתמשים מחוברים" admin page to show the full roster (not just currently-online).
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Fetch profiles, latest activity per user, and business memberships in parallel.
  const [profilesRes, activityRes, membersRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id, email, full_name, avatar_url, is_admin, created_at")
      .is("deleted_at", null)
      .order("full_name", { ascending: true, nullsFirst: false }),
    admin
      .from("user_activity_log")
      .select("user_id, entered_at, page_path, page_name")
      .order("entered_at", { ascending: false })
      .limit(50000),
    admin
      .from("business_members")
      .select("user_id, business:businesses(id, name)")
      .is("deleted_at", null),
  ]);

  if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });

  const profiles = profilesRes.data || [];
  const activityRows = activityRes.data || [];
  const memberRows = membersRes.data || [];

  // Pick the most recent activity row per user_id (the array is already desc-ordered).
  const lastSeenByUser = new Map<string, { entered_at: string; page_path: string; page_name: string | null }>();
  for (const row of activityRows) {
    const uid = row.user_id as string;
    if (!uid) continue;
    if (!lastSeenByUser.has(uid)) {
      lastSeenByUser.set(uid, {
        entered_at: row.entered_at as string,
        page_path: (row.page_path as string) || "",
        page_name: (row.page_name as string | null) ?? null,
      });
    }
  }

  // Group businesses per user.
  const businessesByUser = new Map<string, { id: string; name: string }[]>();
  for (const row of memberRows) {
    const uid = row.user_id as string;
    const biz = row.business as unknown as { id: string; name: string } | null;
    if (!uid || !biz) continue;
    const list = businessesByUser.get(uid) || [];
    list.push({ id: biz.id, name: biz.name });
    businessesByUser.set(uid, list);
  }

  const users = profiles.map((p) => {
    const seen = lastSeenByUser.get(p.id as string);
    return {
      user_id: p.id,
      email: p.email,
      full_name: p.full_name,
      avatar_url: p.avatar_url,
      is_admin: !!p.is_admin,
      created_at: p.created_at,
      last_seen_at: seen?.entered_at ?? null,
      last_page_path: seen?.page_path ?? null,
      last_page_name: seen?.page_name ?? null,
      businesses: businessesByUser.get(p.id as string) || [],
    };
  });

  return NextResponse.json({ users });
}
