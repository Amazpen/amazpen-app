import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

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

  const since = new Date();
  since.setDate(since.getDate() - days);

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: rows, error } = await admin
    .from("user_activity_log")
    .select("id, session_id, page_path, page_name, entered_at, left_at, duration_seconds, user_agent, device_type, browser, screen_size")
    .eq("user_id", userId)
    .gte("entered_at", since.toISOString())
    .order("entered_at", { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const activities = rows || [];

  // Aggregate stats
  const totalSeconds = activities.reduce((s, a) => s + (a.duration_seconds || 0), 0);
  const pageCounts: Record<string, { count: number; seconds: number; name: string }> = {};
  for (const a of activities) {
    const key = a.page_path;
    if (!pageCounts[key]) pageCounts[key] = { count: 0, seconds: 0, name: a.page_name || a.page_path };
    pageCounts[key].count += 1;
    pageCounts[key].seconds += a.duration_seconds || 0;
  }
  const pageStats = Object.entries(pageCounts)
    .map(([path, v]) => ({ path, name: v.name, visits: v.count, totalSeconds: v.seconds }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);

  const sessions = new Set(activities.map(a => a.session_id)).size;

  const dates = activities.map(a => a.entered_at);
  const firstSeen = dates.length > 0 ? dates[dates.length - 1] : null;
  const lastSeen = dates.length > 0 ? dates[0] : null;

  return NextResponse.json({
    activities,
    stats: {
      totalSeconds,
      totalMinutes: Math.round(totalSeconds / 60),
      sessionsCount: sessions,
      pagesVisited: activities.length,
      uniquePages: pageStats.length,
      firstSeen,
      lastSeen,
      topPages: pageStats.slice(0, 10),
    },
  });
}
