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

  const [activityRes, invoicesRes, paymentsRes, entriesRes] = await Promise.all([
    admin
      .from("user_activity_log")
      .select("id, session_id, page_path, page_name, entered_at, left_at, duration_seconds, user_agent, device_type, browser, screen_size")
      .eq("user_id", userId)
      .gte("entered_at", since.toISOString())
      .order("entered_at", { ascending: false })
      .limit(1000),
    admin
      .from("invoices")
      .select("id, created_at")
      .eq("created_by", userId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("payments")
      .select("id, created_at")
      .eq("created_by", userId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("daily_entries")
      .select("id, created_at")
      .eq("created_by", userId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (activityRes.error) return NextResponse.json({ error: activityRes.error.message }, { status: 500 });

  const activities = activityRes.data || [];
  const invoices = invoicesRes.data || [];
  const payments = paymentsRes.data || [];
  const entries = entriesRes.data || [];

  // ==== Basic aggregates ====
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

  const sessions = new Set(activities.map((a) => a.session_id)).size;
  const dates = activities.map((a) => a.entered_at);
  const firstSeen = dates.length > 0 ? dates[dates.length - 1] : null;
  const lastSeen = dates.length > 0 ? dates[0] : null;

  // ==== 1. Active days in last 30 days + streak ====
  const activeDatesSet = new Set<string>();
  for (const a of activities) {
    const d = new Date(a.entered_at);
    activeDatesSet.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }
  const activeDays = activeDatesSet.size;

  // Streak: consecutive days including today (or most recent day)
  let streak = 0;
  const nowDate = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(nowDate);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (activeDatesSet.has(key)) {
      streak++;
    } else if (i > 0) {
      // Allow breaking only when not today (today might not have activity yet)
      break;
    }
  }

  // ==== 2. Heatmap: day-of-week × hour ====
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const a of activities) {
    const d = new Date(a.entered_at);
    heatmap[d.getDay()][d.getHours()] += a.duration_seconds || 60;
  }

  // ==== 3. Last data activity ====
  const dataActivityDates = [
    ...invoices.map((i) => i.created_at),
    ...payments.map((p) => p.created_at),
    ...entries.map((e) => e.created_at),
  ].filter(Boolean);
  const lastDataActivity = dataActivityDates.length > 0
    ? dataActivityDates.sort().reverse()[0]
    : null;

  // ==== 4. Session depth (avg pages per session) ====
  const sessionPages: Record<string, number> = {};
  for (const a of activities) {
    sessionPages[a.session_id] = (sessionPages[a.session_id] || 0) + 1;
  }
  const sessionDepths = Object.values(sessionPages);
  const avgSessionDepth =
    sessionDepths.length > 0
      ? sessionDepths.reduce((s, n) => s + n, 0) / sessionDepths.length
      : 0;

  // ==== 5. Device split ====
  const deviceCounts: Record<string, number> = {};
  for (const a of activities) {
    const dev = a.device_type || "Unknown";
    deviceCounts[dev] = (deviceCounts[dev] || 0) + 1;
  }
  const deviceSplit = Object.entries(deviceCounts)
    .map(([device, count]) => ({ device, count, percentage: Math.round((count / activities.length) * 100) }))
    .sort((a, b) => b.count - a.count);

  // ==== 6. Drop-off pages (<10 seconds) ====
  const dropOffCounts: Record<string, { count: number; name: string }> = {};
  for (const a of activities) {
    if ((a.duration_seconds || 0) > 0 && (a.duration_seconds || 0) < 10) {
      if (!dropOffCounts[a.page_path]) {
        dropOffCounts[a.page_path] = { count: 0, name: a.page_name || a.page_path };
      }
      dropOffCounts[a.page_path].count += 1;
    }
  }
  const dropOffPages = Object.entries(dropOffCounts)
    .map(([path, v]) => ({ path, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // ==== 7. Actions this week ====
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoIso = weekAgo.toISOString();
  const actionsThisWeek = {
    invoices: invoices.filter((i) => i.created_at >= weekAgoIso).length,
    payments: payments.filter((p) => p.created_at >= weekAgoIso).length,
    entries: entries.filter((e) => e.created_at >= weekAgoIso).length,
  };
  const totalActions = invoices.length + payments.length + entries.length;

  // ==== 8. Most active hour ====
  const hourCounts: number[] = Array(24).fill(0);
  for (const a of activities) {
    const d = new Date(a.entered_at);
    hourCounts[d.getHours()] += a.duration_seconds || 60;
  }
  let mostActiveHour = 0;
  let mostActiveHourValue = 0;
  for (let h = 0; h < 24; h++) {
    if (hourCounts[h] > mostActiveHourValue) {
      mostActiveHourValue = hourCounts[h];
      mostActiveHour = h;
    }
  }

  // ==== 9. Bounce rate (single-page sessions) ====
  const bouncingSessions = sessionDepths.filter((n) => n === 1).length;
  const bounceRate =
    sessionDepths.length > 0 ? Math.round((bouncingSessions / sessionDepths.length) * 100) : 0;

  // ==== 10. Churn risk ====
  let churnRisk: "low" | "medium" | "high" = "low";
  let daysSinceLastSeen = 0;
  if (lastSeen) {
    const diffMs = Date.now() - new Date(lastSeen).getTime();
    daysSinceLastSeen = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (daysSinceLastSeen >= 7) churnRisk = "high";
    else if (daysSinceLastSeen >= 3) churnRisk = "medium";
  } else {
    churnRisk = "high";
    daysSinceLastSeen = days;
  }

  // ==== 11. Engagement score (0-100) ====
  // Components: active days ratio (40), avg daily minutes (30), actions (20), streak (10)
  const activeDaysScore = Math.min(40, (activeDays / days) * 40);
  const avgDailyMinutes = activeDays > 0 ? totalSeconds / 60 / activeDays : 0;
  const minutesScore = Math.min(30, (avgDailyMinutes / 20) * 30); // 20 min/day = full
  const actionsScore = Math.min(20, (totalActions / 30) * 20); // 30 actions/period = full
  const streakScore = Math.min(10, (streak / 7) * 10); // 7-day streak = full
  const engagementScore = Math.round(
    activeDaysScore + minutesScore + actionsScore + streakScore
  );
  let engagementLevel: "high" | "medium" | "low" = "low";
  if (engagementScore >= 70) engagementLevel = "high";
  else if (engagementScore >= 40) engagementLevel = "medium";

  // ==== Daily activity for chart ====
  const dailyActivity: Array<{ date: string; seconds: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(nowDate);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const dayActivities = activities.filter((a) => {
      const ad = new Date(a.entered_at);
      return `${ad.getFullYear()}-${ad.getMonth()}-${ad.getDate()}` === key;
    });
    const dayTotal = dayActivities.reduce((s, a) => s + (a.duration_seconds || 0), 0);
    dailyActivity.push({
      date: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
      seconds: dayTotal,
    });
  }

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
      // New insights
      engagementScore,
      engagementLevel,
      activeDays,
      streak,
      daysSinceLastSeen,
      churnRisk,
      avgSessionDepth: Math.round(avgSessionDepth * 10) / 10,
      bounceRate,
      mostActiveHour,
      avgDailyMinutes: Math.round(avgDailyMinutes * 10) / 10,
      lastDataActivity,
      totalActions,
      actionsThisWeek,
      actionsAll: {
        invoices: invoices.length,
        payments: payments.length,
        entries: entries.length,
      },
      deviceSplit,
      dropOffPages,
      dailyActivity,
      heatmap,
    },
  });
}
