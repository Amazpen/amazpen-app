import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { streamText, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { computeUserActivityStats, type UserActivityStats } from "@/lib/userActivityStats";

/**
 * POST /api/user-activity/analyze   (admin only)
 *   Body: { user_id, days, messages: [{ role: 'user'|'assistant', content }] }
 *   Streams a Hebrew, data-grounded analysis of the given user's tracking stats.
 *   Stats are recomputed server-side (single source of truth) — the model never
 *   sees client-supplied numbers, and is instructed to answer ONLY from them.
 */

const RATE_LIMIT = 20;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function fmtMostActiveHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function buildSystemPrompt(
  name: string,
  businesses: string,
  days: number,
  s: UserActivityStats,
): string {
  const churnHe = s.churnRisk === "high" ? "גבוה" : s.churnRisk === "medium" ? "בינוני" : "נמוך";
  const engHe = s.engagementLevel === "high" ? "גבוהה" : s.engagementLevel === "medium" ? "בינונית" : "נמוכה";
  const topPages = s.topPages.slice(0, 5).map((p) => `${p.name} (${p.visits} כניסות, ${Math.round(p.totalSeconds / 60)} דק')`).join("; ") || "אין";
  const dropOff = s.dropOffPages.map((p) => `${p.name} (${p.count})`).join("; ") || "אין";
  const lastSeenHe = s.lastSeen ? `${s.daysSinceLastSeen} ימים (${new Date(s.lastSeen).toLocaleDateString("he-IL")})` : "לא נכנס מעולם";

  return `אתה אנליסט מוצר שמסייע למנהל לנתח משתמש בודד במערכת "המצפן" (ניהול עסקי) על סמך נתוני שימוש אמיתיים.

## נתוני המשתמש (טווח: ${days} ימים אחרונים)
- שם: ${name}${businesses ? ` · עסקים: ${businesses}` : ""}
- ציון התמכרות: ${s.engagementScore}/100 (${engHe})
- סיכון נטישה: ${churnHe} · פעילות אחרונה: ${lastSeenHe}
- רצף ימים פעילים: ${s.streak} · ימים פעילים בטווח: ${s.activeDays}/${days}
- זמן כולל: ${s.totalMinutes} דקות · ממוצע יומי: ${s.avgDailyMinutes} דק' · שעת שיא: ${fmtMostActiveHour(s.mostActiveHour)}
- סשנים: ${s.sessionsCount} · עומק סשן ממוצע: ${s.avgSessionDepth} דפים · Bounce rate: ${s.bounceRate}%
- דפים מובילים: ${topPages}
- דפים שנוטש מהר (<10ש'): ${dropOff}
- פעולות בטווח: ${s.actionsAll.invoices} חשבוניות, ${s.actionsAll.payments} תשלומים, ${s.actionsAll.entries} מילויים יומיים (מתוכם השבוע: ${s.actionsThisWeek.invoices}/${s.actionsThisWeek.payments}/${s.actionsThisWeek.entries})
- פעולת-מידע אחרונה: ${s.lastDataActivity ? new Date(s.lastDataActivity).toLocaleDateString("he-IL") : "אין"}

## כללים (חובה)
- ענה **בעברית**, תמציתי וברור.
- בסס כל קביעה **אך ורק על הנתונים שלמעלה**. אל תמציא מספרים או עובדות שאינם מופיעים. אם חסר מידע — אמור זאת.
- תן **פעולות קונקרטיות** שהמנהל יכול לבצע (למשל "התקשר אליו בשעה ${fmtMostActiveHour(s.mostActiveHour)}, השעה הפעילה שלו"), לא משימות גנריות כמו "שפר מעורבות".
- אל תמליץ דבר שמזיק לעסק או למשתמש.
- כשרלוונטי, חבר בין נתונים (למשל bounce גבוה + דף נטישה מסוים → בעיית UX באותו דף).
- אל תטען שביצעת פעולה במערכת — אתה רק מנתח וממליץ.`;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });

  if (!checkRateLimit(user.id)) {
    return new Response(JSON.stringify({ error: "יותר מדי בקשות, נסה שוב בעוד דקה" }), { status: 429 });
  }

  const body = await request.json();
  const user_id: string | undefined = body.user_id;
  const days: number = typeof body.days === "number" ? body.days : 30;
  const rawMessages: Array<{ role: string; content: string }> = Array.isArray(body.messages) ? body.messages : [];

  if (!user_id || rawMessages.length === 0) {
    return new Response(JSON.stringify({ error: "Missing user_id or messages" }), { status: 400 });
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const [statsRes, profileRes, membersRes] = await Promise.all([
    computeUserActivityStats(admin, user_id, days),
    admin.from("profiles").select("full_name, email").eq("id", user_id).maybeSingle(),
    admin.from("business_members").select("businesses(name)").eq("user_id", user_id).is("deleted_at", null),
  ]);

  if (statsRes.error || !statsRes.data) {
    return new Response(JSON.stringify({ error: statsRes.error || "Failed to compute stats" }), { status: 500 });
  }

  const target = profileRes.data as { full_name: string | null; email: string | null } | null;
  const name = target?.full_name || target?.email || "המשתמש";
  const memberRows = (membersRes.data || []) as Array<{ businesses: { name: string } | { name: string }[] | null }>;
  const businesses = memberRows
    .map((m) => (Array.isArray(m.businesses) ? m.businesses[0]?.name : m.businesses?.name))
    .filter(Boolean)
    .join(", ");

  const system = buildSystemPrompt(name, businesses, days, statsRes.data.stats);

  const messages: ModelMessage[] = rawMessages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Note: gpt-5.4-mini is a reasoning model (OpenAI Responses API) — it does NOT
  // support `temperature`, so we omit it (passing it only logs a warning).
  const result = streamText({
    model: openai("gpt-5.4-mini"),
    system,
    messages,
  });

  return result.toTextStreamResponse();
}
