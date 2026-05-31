import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { computeUserActivityStats } from "@/lib/userActivityStats";

/**
 * POST /api/user-activity
 *   Body: { action: "start", session_id, page_path, page_name, user_agent, device_type, browser, screen_size }
 *   Body: { action: "end", session_id, page_path } — closes the latest open row for this session+path
 *
 * GET /api/user-activity?user_id=<uuid>&days=30
 *   Returns activity history for a user (admin only).
 */

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { action } = body;

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  if (action === "start") {
    const { session_id, page_path, page_name, user_agent, device_type, browser, screen_size } = body;
    if (!session_id || !page_path) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    const { error } = await admin.from("user_activity_log").insert({
      user_id: user.id,
      session_id,
      page_path,
      page_name: page_name || null,
      user_agent: user_agent || null,
      device_type: device_type || null,
      browser: browser || null,
      screen_size: screen_size || null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "end") {
    const { session_id, page_path } = body;
    if (!session_id) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }
    // Close the most recent open row for this session (+ optional path filter)
    let query = admin
      .from("user_activity_log")
      .select("id, entered_at")
      .eq("user_id", user.id)
      .eq("session_id", session_id)
      .is("left_at", null)
      .order("entered_at", { ascending: false })
      .limit(1);
    if (page_path) query = query.eq("page_path", page_path);
    const { data: openRow } = await query.maybeSingle();
    if (openRow) {
      const enteredAt = new Date(openRow.entered_at);
      const now = new Date();
      const duration = Math.max(0, Math.round((now.getTime() - enteredAt.getTime()) / 1000));
      await admin
        .from("user_activity_log")
        .update({ left_at: now.toISOString(), duration_seconds: duration })
        .eq("id", openRow.id);
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Admin check
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");
  const days = parseInt(searchParams.get("days") || "30");

  if (!userId) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const result = await computeUserActivityStats(admin, userId, days);
  if (result.error || !result.data) {
    return NextResponse.json({ error: result.error || "Failed to compute stats" }, { status: 500 });
  }
  return NextResponse.json(result.data);
}
