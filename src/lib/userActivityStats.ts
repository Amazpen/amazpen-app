import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared user-activity stats computation.
 * Used by GET /api/user-activity (modal data) and POST /api/user-activity/analyze (AI analyst),
 * so both read from a single source of truth.
 */

export interface ActivityLogRow {
  id: string;
  session_id: string;
  page_path: string;
  page_name: string | null;
  entered_at: string;
  left_at: string | null;
  duration_seconds: number | null;
  user_agent: string | null;
  device_type: string | null;
  browser: string | null;
  screen_size: string | null;
}

interface DatedRow {
  id: string;
  created_at: string;
}

export interface UserActivityStats {
  totalSeconds: number;
  totalMinutes: number;
  sessionsCount: number;
  pagesVisited: number;
  uniquePages: number;
  firstSeen: string | null;
  lastSeen: string | null;
  topPages: Array<{ path: string; name: string; visits: number; totalSeconds: number }>;
  engagementScore: number;
  engagementLevel: "high" | "medium" | "low";
  activeDays: number;
  streak: number;
  daysSinceLastSeen: number;
  churnRisk: "low" | "medium" | "high";
  avgSessionDepth: number;
  bounceRate: number;
  mostActiveHour: number;
  avgDailyMinutes: number;
  lastDataActivity: string | null;
  totalActions: number;
  actionsThisWeek: { invoices: number; payments: number; entries: number };
  actionsAll: { invoices: number; payments: number; entries: number };
  deviceSplit: Array<{ device: string; count: number; percentage: number }>;
  dropOffPages: Array<{ path: string; name: string; count: number }>;
  dailyActivity: Array<{ date: string; seconds: number }>;
  heatmap: number[][];
}

export interface UserActivityResult {
  activities: ActivityLogRow[];
  stats: UserActivityStats;
}

export async function computeUserActivityStats(
  admin: SupabaseClient,
  userId: string,
  days: number,
): Promise<{ data?: UserActivityResult; error?: string }> {
  const since = new Date();
  since.setDate(since.getDate() - days);

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

  if (activityRes.error) return { error: activityRes.error.message };

  const activities = (activityRes.data || []) as ActivityLogRow[];
  const invoices = (invoicesRes.data || []) as DatedRow[];
  const payments = (paymentsRes.data || []) as DatedRow[];
  const entries = (entriesRes.data || []) as DatedRow[];

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

  // ==== 1. Active days + streak ====
  const activeDatesSet = new Set<string>();
  for (const a of activities) {
    const d = new Date(a.entered_at);
    activeDatesSet.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }
  const activeDays = activeDatesSet.size;

  let streak = 0;
  const nowDate = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(nowDate);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (activeDatesSet.has(key)) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }

  // ==== 2. Heatmap ====
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
  const lastDataActivity = dataActivityDates.length > 0 ? dataActivityDates.sort().reverse()[0] : null;

  // ==== 4. Session depth ====
  const sessionPages: Record<string, number> = {};
  for (const a of activities) {
    sessionPages[a.session_id] = (sessionPages[a.session_id] || 0) + 1;
  }
  const sessionDepths = Object.values(sessionPages);
  const avgSessionDepth =
    sessionDepths.length > 0 ? sessionDepths.reduce((s, n) => s + n, 0) / sessionDepths.length : 0;

  // ==== 5. Device split ====
  const deviceCounts: Record<string, number> = {};
  for (const a of activities) {
    const dev = a.device_type || "Unknown";
    deviceCounts[dev] = (deviceCounts[dev] || 0) + 1;
  }
  const deviceSplit = Object.entries(deviceCounts)
    .map(([device, count]) => ({ device, count, percentage: Math.round((count / activities.length) * 100) }))
    .sort((a, b) => b.count - a.count);

  // ==== 6. Drop-off pages (<10s) ====
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

  // ==== 9. Bounce rate ====
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

  // ==== 11. Engagement score ====
  const activeDaysScore = Math.min(40, (activeDays / days) * 40);
  const avgDailyMinutes = activeDays > 0 ? totalSeconds / 60 / activeDays : 0;
  const minutesScore = Math.min(30, (avgDailyMinutes / 20) * 30);
  const actionsScore = Math.min(20, (totalActions / 30) * 20);
  const streakScore = Math.min(10, (streak / 7) * 10);
  const engagementScore = Math.round(activeDaysScore + minutesScore + actionsScore + streakScore);
  let engagementLevel: "high" | "medium" | "low" = "low";
  if (engagementScore >= 70) engagementLevel = "high";
  else if (engagementScore >= 40) engagementLevel = "medium";

  // ==== Daily activity ====
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

  return {
    data: {
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
    },
  };
}
