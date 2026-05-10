"use client";

import { useDashboard } from "../../layout";
import type { PresenceUser } from "@/hooks/usePresence";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  Activity,
  AlertTriangle,
  Clock,
  FileText,
  Flame,
  Info,
  Layers,
  LogIn,
  MousePointerClick,
  Smartphone,
  Sparkles,
  Sunrise,
  TrendingDown,
  Wallet,
} from "lucide-react";

interface ActivityRow {
  id: string;
  session_id: string;
  page_path: string;
  page_name: string | null;
  entered_at: string;
  left_at: string | null;
  duration_seconds: number | null;
  device_type: string | null;
  browser: string | null;
  screen_size: string | null;
  user_agent: string | null;
}

interface ActivityStats {
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

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds < 1) return "—";
  if (seconds < 60) return `${seconds} שניות`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return secs > 0 ? `${mins}:${String(secs).padStart(2, "0")} דק'` : `${mins} דקות`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}:${String(remMins).padStart(2, "0")} שעות`;
}

function formatFullDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function UserHistoryModal({ user, onClose }: { user: PresenceUser; onClose: () => void }) {
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/user-activity?user_id=${user.user_id}&days=${days}`);
        if (res.ok) {
          const data = await res.json();
          setActivities(data.activities || []);
          setStats(data.stats || null);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user.user_id, days]);

  // close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-[#0F1535] border border-white/10 rounded-2xl max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — gradient with avatar */}
        <div className="relative bg-gradient-to-l from-[#29318A]/80 via-[#1a1c5e]/60 to-[#0F1535] border-b border-white/10 px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[#29318A] border-2 border-white/20 flex items-center justify-center text-white text-xl font-bold shrink-0">
              {getInitials(user.full_name, user.email)}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-white text-xl font-bold truncate">{user.full_name || user.email}</h2>
              <p className="text-white/60 text-xs truncate">{user.email}</p>
            </div>
            <button
              onClick={onClose}
              className="text-white/50 hover:text-white hover:bg-white/10 rounded-lg w-9 h-9 flex items-center justify-center text-2xl leading-none transition shrink-0"
              aria-label="סגור"
            >
              ×
            </button>
          </div>
        </div>

        {/* Filter — segmented control */}
        <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-white/10 bg-[#0a0e2c]">
          <span className="text-white/50 text-[12px]">טווח זמן:</span>
          <div className="inline-flex items-center bg-[#0F1535] rounded-lg p-1 border border-white/10">
            {([["יום", 1], ["שבוע", 7], ["חודש", 30], ["3 חודשים", 90]] as const).map(([label, d]) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition ${
                  days === d
                    ? "bg-[#29318A] text-white shadow-sm"
                    : "text-white/50 hover:text-white/80"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <LoadingSkeleton />
          ) : !stats ? (
            <p className="text-white/50 text-center py-10">לא נטען מידע</p>
          ) : (
            <>
              {/* Hero — Engagement + Churn + Streak */}
              <section>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <EngagementCard score={stats.engagementScore} level={stats.engagementLevel} />
                  <ChurnCard risk={stats.churnRisk} daysSinceLastSeen={stats.daysSinceLastSeen} />
                  <StreakCard streak={stats.streak} activeDays={stats.activeDays} totalDays={days} />
                </div>
              </section>

              {/* Section: usage stats */}
              <Section
                title="זמן ושימוש"
                icon={<Clock className="w-4 h-4" />}
                hint="כל הנתונים מתייחסים לטווח שבחרת למעלה"
              >
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatTile
                    icon={<Clock className="w-4 h-4" />}
                    label="סה״כ זמן"
                    value={formatDuration(stats.totalSeconds)}
                    hint="הזמן הכולל ששהה במערכת בטווח"
                  />
                  <StatTile
                    icon={<Activity className="w-4 h-4" />}
                    label="ממוצע יומי"
                    value={`${stats.avgDailyMinutes} דק'`}
                    hint="ממוצע דקות ביום שבו היה פעיל"
                  />
                  <StatTile
                    icon={<Sunrise className="w-4 h-4" />}
                    label="שעת שיא"
                    value={`${String(stats.mostActiveHour).padStart(2, "0")}:00`}
                    hint="השעה שבה הוא הכי פעיל בדרך כלל"
                  />
                  <StatTile
                    icon={<Layers className="w-4 h-4" />}
                    label="עומק סשן"
                    value={`${stats.avgSessionDepth} דפים`}
                    hint="ממוצע דפים שהוא צופה בהם בכל סשן"
                  />
                  <StatTile
                    icon={<LogIn className="w-4 h-4" />}
                    label="מספר סשנים"
                    value={String(stats.sessionsCount)}
                    hint="כמה פעמים הוא נכנס למערכת"
                  />
                  <StatTile
                    icon={<MousePointerClick className="w-4 h-4" />}
                    label="דפים שנצפו"
                    value={String(stats.pagesVisited)}
                    hint="סך הדפים שנצפו (כולל חזרות)"
                  />
                  <StatTile
                    icon={<TrendingDown className="w-4 h-4" />}
                    label="Bounce Rate"
                    value={`${stats.bounceRate}%`}
                    hint="אחוז הסשנים שבהם נכנס לדף אחד בלבד"
                    accent={stats.bounceRate > 50 ? "warn" : undefined}
                  />
                  <StatTile
                    icon={<FileText className="w-4 h-4" />}
                    label="דפים ייחודיים"
                    value={String(stats.uniquePages)}
                    hint="כמה דפים שונים הוא ביקר בהם"
                  />
                </div>
              </Section>

              {/* Section: actions */}
              <Section
                title="פעולות שביצע במערכת"
                icon={<Sparkles className="w-4 h-4" />}
                hint="פעולות השבוע מסך הכל הפעולות בטווח"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <ActionCard
                    icon={<FileText className="w-5 h-5" />}
                    label="חשבוניות"
                    week={stats.actionsThisWeek.invoices}
                    total={stats.actionsAll.invoices}
                  />
                  <ActionCard
                    icon={<Wallet className="w-5 h-5" />}
                    label="תשלומים"
                    week={stats.actionsThisWeek.payments}
                    total={stats.actionsAll.payments}
                  />
                  <ActionCard
                    icon={<Activity className="w-5 h-5" />}
                    label="מילוי יומי"
                    week={stats.actionsThisWeek.entries}
                    total={stats.actionsAll.entries}
                  />
                </div>
                {stats.lastDataActivity && (
                  <p className="text-white/50 text-[12px] mt-3 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    פעולה אחרונה: {formatFullDate(stats.lastDataActivity)}
                  </p>
                )}
              </Section>

              {/* Section: heatmap */}
              <Section
                title="מתי הוא נכנס — מפת חום"
                icon={<Sunrise className="w-4 h-4" />}
                hint="כל ריבוע = יום בשבוע × שעה. כהה יותר = יותר פעיל באותה שעה"
              >
                <HeatmapGrid heatmap={stats.heatmap} />
              </Section>

              {/* Section: daily activity */}
              {stats.dailyActivity.length > 0 && (
                <Section
                  title="פעילות יומית"
                  icon={<Activity className="w-4 h-4" />}
                  hint="כמה דקות שהה במערכת בכל יום בטווח"
                >
                  <DailyActivityChart data={stats.dailyActivity} />
                </Section>
              )}

              {/* Section: device split */}
              {stats.deviceSplit.length > 0 && (
                <Section
                  title="מאיזה מכשיר נכנס"
                  icon={<Smartphone className="w-4 h-4" />}
                  hint="פילוח הכניסות לפי סוג מכשיר"
                >
                  <div className="bg-[#111056]/60 border border-white/10 rounded-xl p-4 space-y-2">
                    {stats.deviceSplit.map((d) => (
                      <div key={d.device} className="flex items-center gap-3">
                        <div className="text-white text-[13px] w-24 shrink-0 flex items-center gap-1.5">
                          <Smartphone className="w-3.5 h-3.5 text-white/40" />
                          {d.device}
                        </div>
                        <div className="flex-1 h-2.5 bg-[#0F1535] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-l from-[#8328f8] to-[#5b16c4] rounded-full transition-all duration-700"
                            style={{ width: `${d.percentage}%` }}
                          />
                        </div>
                        <div className="text-white/70 text-xs w-20 shrink-0 text-right tabular-nums">
                          {d.percentage}% · {d.count}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Section: drop-off pages */}
              {stats.dropOffPages.length > 0 && (
                <Section
                  title="דפים שהוא ברח מהם"
                  icon={<AlertTriangle className="w-4 h-4 text-[#F64E60]" />}
                  hint="דפים שיצא מהם תוך פחות מ-10 שניות — מועמדים לבדיקת UX"
                >
                  <div className="bg-[#111056]/60 border border-[#F64E60]/30 rounded-xl overflow-hidden">
                    {stats.dropOffPages.map((p, i) => (
                      <div
                        key={p.path}
                        className={`flex justify-between items-center px-4 py-2.5 text-[13px] ${
                          i > 0 ? "border-t border-white/5" : ""
                        }`}
                      >
                        <div className="text-white truncate flex items-center gap-2">
                          <span className="text-white/30 text-[11px] w-5 shrink-0">{i + 1}.</span>
                          {p.name}
                        </div>
                        <div className="shrink-0 ms-3 inline-flex items-center gap-1.5 bg-[#F64E60]/10 text-[#F64E60] px-2 py-0.5 rounded-full text-[12px] font-semibold">
                          <AlertTriangle className="w-3 h-3" />
                          {p.count} נטישות
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Section: top pages */}
              {stats.topPages.length > 0 && (
                <Section
                  title="הדפים האהובים עליו"
                  icon={<FileText className="w-4 h-4" />}
                  hint="מסודר לפי סך הזמן ששהה בכל דף"
                >
                  <TopPagesList topPages={stats.topPages} />
                </Section>
              )}

              {/* Section: timeline */}
              <Section
                title="היסטוריה מלאה"
                icon={<Clock className="w-4 h-4" />}
                hint={`${activities.length} ביקורים בטווח`}
              >
                {activities.length === 0 ? (
                  <p className="text-white/50 text-center py-6">אין פעילות בתקופה זו</p>
                ) : (
                  <ActivityTimeline activities={activities} />
                )}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============ Reusable layout pieces ============ */

function Section({
  title,
  icon,
  hint,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="text-white/70">{icon}</span>}
        <h3 className="text-white font-semibold text-[14px]">{title}</h3>
        {hint && (
          <span
            title={hint}
            className="text-white/30 hover:text-white/60 cursor-help inline-flex"
            aria-label={hint}
          >
            <Info className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function StatTile({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: "warn" | "good";
}) {
  const accentBorder =
    accent === "warn"
      ? "border-[#FFA412]/30"
      : accent === "good"
      ? "border-[#3CD856]/30"
      : "border-white/10";
  return (
    <div
      className={`bg-[#111056]/60 border ${accentBorder} rounded-xl p-3 hover:border-white/30 transition group cursor-default`}
      title={hint}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon && <span className="text-white/40 group-hover:text-white/70 transition">{icon}</span>}
        <div className="text-white/50 text-[11px]">{label}</div>
      </div>
      <div className="text-white font-bold text-[16px] tabular-nums">{value}</div>
    </div>
  );
}

function ActionCard({
  icon,
  label,
  week,
  total,
}: {
  icon: React.ReactNode;
  label: string;
  week: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((week / Math.max(total, 1)) * 100)) : 0;
  return (
    <div className="bg-[#111056]/60 border border-white/10 rounded-xl p-4 hover:border-white/30 transition">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-white/70">
          <span className="text-[#8328f8]">{icon}</span>
          <span className="text-[13px]">{label}</span>
        </div>
        <span className="text-white/40 text-[11px]">השבוע / סה״כ</span>
      </div>
      <div className="flex items-baseline gap-1.5 mb-2 tabular-nums">
        <span className="text-white text-2xl font-bold">{week}</span>
        <span className="text-white/40 text-sm">/ {total}</span>
      </div>
      <div className="h-1.5 bg-[#0F1535] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-l from-[#8328f8] to-[#5b16c4] rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-[#111056]/40 border border-white/5 rounded-xl h-28" />
        ))}
      </div>
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="bg-[#111056]/40 border border-white/5 rounded-xl h-20" />
        ))}
      </div>
      <div className="bg-[#111056]/40 border border-white/5 rounded-xl h-48" />
      <div className="bg-[#111056]/40 border border-white/5 rounded-xl h-32" />
    </div>
  );
}

/* ============ Hero cards ============ */

function EngagementCard({ score, level }: { score: number; level: "high" | "medium" | "low" }) {
  const color = level === "high" ? "#3CD856" : level === "medium" ? "#FFA412" : "#F64E60";
  const label = level === "high" ? "התמכרות גבוהה" : level === "medium" ? "התמכרות בינונית" : "התמכרות נמוכה";
  const description =
    level === "high"
      ? "המשתמש משתמש במערכת באופן מתמיד — שמור עליו"
      : level === "medium"
      ? "שימוש סביר אבל יש מקום לשיפור"
      : "שימוש דליל — צריך onboarding או פולואפ";

  // Circular progress (SVG) with conic gradient feel via stroke-dasharray
  const circumference = 2 * Math.PI * 36;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div
      className="relative bg-gradient-to-br from-[#111056]/80 to-[#0F1535] border border-white/10 rounded-xl p-4 hover:border-white/30 transition"
      title={description}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-white/50 text-[11px] flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          ציון התמכרות
        </div>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: `${color}1a`, color }}
        >
          {label.split(" ")[1]}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative w-20 h-20 shrink-0">
          <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
            <circle cx="40" cy="40" r="36" stroke="rgba(255,255,255,0.08)" strokeWidth="6" fill="none" />
            <circle
              cx="40"
              cy="40"
              r="36"
              stroke={color}
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 800ms ease-out" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-white font-bold text-2xl tabular-nums" style={{ color }}>
              {score}
            </span>
            <span className="text-white/40 text-[9px] -mt-1">/100</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white text-[13px] font-semibold leading-tight mb-1">{label}</div>
          <p className="text-white/50 text-[11px] leading-snug">{description}</p>
        </div>
      </div>
    </div>
  );
}

function ChurnCard({ risk, daysSinceLastSeen }: { risk: "low" | "medium" | "high"; daysSinceLastSeen: number }) {
  const color = risk === "low" ? "#3CD856" : risk === "medium" ? "#FFA412" : "#F64E60";
  const label = risk === "low" ? "סיכון נמוך" : risk === "medium" ? "סיכון בינוני" : "סיכון גבוה";
  const Icon = risk === "low" ? Activity : risk === "medium" ? Clock : AlertTriangle;
  const description =
    risk === "low"
      ? "פעיל לאחרונה — המשתמש שלך"
      : risk === "medium"
      ? "התחיל להירדם — שווה לשלוח התראה"
      : "מסכן לעזוב — צריך פולואפ אישי";
  const lastSeenText =
    daysSinceLastSeen === 0
      ? "היה היום"
      : daysSinceLastSeen === 1
      ? "אתמול"
      : `לפני ${daysSinceLastSeen} ימים`;

  return (
    <div
      className="relative bg-gradient-to-br from-[#111056]/80 to-[#0F1535] border border-white/10 rounded-xl p-4 hover:border-white/30 transition"
      title={description}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-white/50 text-[11px] flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          סיכון נטישה
        </div>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: `${color}1a`, color }}
        >
          {risk === "low" ? "שמור" : risk === "medium" ? "שים לב" : "דחוף"}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center shrink-0"
          style={{ background: `${color}15`, border: `2px solid ${color}40` }}
        >
          <Icon className="w-8 h-8" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white text-[13px] font-semibold leading-tight mb-0.5" style={{ color }}>
            {label}
          </div>
          <div className="text-white/50 text-[11px] mb-1">פעילות אחרונה: {lastSeenText}</div>
          <p className="text-white/50 text-[11px] leading-snug">{description}</p>
        </div>
      </div>
    </div>
  );
}

function StreakCard({ streak, activeDays, totalDays }: { streak: number; activeDays: number; totalDays: number }) {
  const consistencyPct = totalDays > 0 ? Math.round((activeDays / totalDays) * 100) : 0;
  const description =
    streak >= 5
      ? "רצף יפה — המשתמש בנה הרגל"
      : streak > 0
      ? "התחיל רצף — לעודד שימשיך"
      : "רצף נשבר — שווה תזכורת";

  return (
    <div
      className="relative bg-gradient-to-br from-[#111056]/80 to-[#0F1535] border border-white/10 rounded-xl p-4 hover:border-white/30 transition"
      title={description}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-white/50 text-[11px] flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5" />
          רצף ימים פעילים
        </div>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FFA412]/15 text-[#FFA412]"
        >
          {consistencyPct}% עקביות
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center shrink-0"
          style={{ background: streak > 0 ? "#FFA41215" : "rgba(255,255,255,0.04)", border: `2px solid ${streak > 0 ? "#FFA41240" : "rgba(255,255,255,0.1)"}` }}
        >
          <div className="flex flex-col items-center">
            <Flame className={`w-5 h-5 ${streak > 0 ? "text-[#FFA412]" : "text-white/20"}`} />
            <span className={`text-2xl font-bold tabular-nums ${streak > 0 ? "text-[#FFA412]" : "text-white/40"}`}>
              {streak}
            </span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white text-[13px] font-semibold leading-tight mb-0.5">
            {streak > 0 ? `${streak} ימים ברצף` : "אין רצף פעיל"}
          </div>
          <div className="text-white/50 text-[11px] mb-1">
            {activeDays}/{totalDays} ימים בטווח
          </div>
          <p className="text-white/50 text-[11px] leading-snug">{description}</p>
        </div>
      </div>
    </div>
  );
}

/* ============ Heatmap ============ */

function HeatmapGrid({ heatmap }: { heatmap: number[][] }) {
  const dayLabels = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];
  const dayLabelsLong = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const max = Math.max(1, ...heatmap.flat());

  // Determine if there's any data
  const hasData = heatmap.some((row) => row.some((v) => v > 0));

  return (
    <div className="bg-[#111056]/60 border border-white/10 rounded-xl p-4">
      {!hasData && (
        <p className="text-white/40 text-center text-[12px] py-4">אין פעילות מתועדת בטווח הזה</p>
      )}
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          {/* Hour labels */}
          <div className="flex mb-1">
            <div className="w-10 shrink-0" />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="flex-1 text-[9px] text-white/40 text-center tabular-nums">
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </div>
            ))}
          </div>
          {heatmap.map((row, dow) => {
            const dayTotal = row.reduce((s, v) => s + v, 0);
            return (
              <div key={dow} className="flex items-center mt-0.5 group/row">
                <div
                  className="w-10 shrink-0 text-[11px] text-white/60 group-hover/row:text-white transition"
                  title={`${dayLabelsLong[dow]} — סה״כ ${Math.round(dayTotal / 60)} דקות`}
                >
                  {dayLabels[dow]}
                </div>
                {row.map((val, h) => {
                  const intensity = val / max;
                  const bg =
                    val === 0
                      ? "rgba(255,255,255,0.04)"
                      : `rgba(131, 40, 248, ${0.25 + intensity * 0.75})`;
                  return (
                    <div
                      key={h}
                      className="flex-1 aspect-square border border-[#0F1535] rounded-sm hover:scale-150 hover:z-10 hover:border-white/40 transition cursor-pointer relative"
                      style={{ background: bg }}
                      title={
                        val > 0
                          ? `${dayLabelsLong[dow]} ${String(h).padStart(2, "0")}:00 — ${Math.round(val / 60)} דקות`
                          : `${dayLabelsLong[dow]} ${String(h).padStart(2, "0")}:00 — לא היה פעיל`
                      }
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {/* Legend */}
      <div className="flex items-center justify-end gap-2 mt-3 text-[10px] text-white/40">
        <span>פחות</span>
        <div className="flex gap-0.5">
          {[0.04, 0.25, 0.45, 0.65, 0.85, 1].map((alpha, i) => (
            <div
              key={i}
              className="w-3.5 h-3.5 rounded-sm border border-[#0F1535]"
              style={{
                background: i === 0 ? "rgba(255,255,255,0.04)" : `rgba(131, 40, 248, ${alpha})`,
              }}
            />
          ))}
        </div>
        <span>יותר</span>
      </div>
    </div>
  );
}

/* ============ Daily activity ============ */

function DailyActivityChart({ data }: { data: Array<{ date: string; seconds: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.seconds));
  const totalMinutes = Math.round(data.reduce((s, d) => s + d.seconds, 0) / 60);
  const peakDay = useMemo(() => {
    let best: { date: string; seconds: number } | null = null;
    for (const d of data) if (!best || d.seconds > best.seconds) best = d;
    return best && best.seconds > 0 ? best : null;
  }, [data]);

  return (
    <div className="bg-[#111056]/60 border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between text-[11px] text-white/50 mb-2">
        <span>סה״כ {totalMinutes} דקות בטווח</span>
        {peakDay && (
          <span className="text-white/70">
            יום שיא: {peakDay.date} · {Math.round(peakDay.seconds / 60)} דק'
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <div
          className="flex items-end gap-1 h-[120px]"
          style={{ minWidth: Math.max(480, data.length * 16) }}
        >
          {data.map((d) => {
            const isMax = peakDay && d.date === peakDay.date && d.seconds > 0;
            const height = d.seconds > 0 ? Math.max(4, (d.seconds / max) * 100) : 0;
            return (
              <div
                key={d.date}
                className={`flex-1 rounded-t-sm relative group cursor-pointer transition-all duration-300 ${
                  isMax
                    ? "bg-gradient-to-t from-[#FFA412] to-[#FFD580]"
                    : "bg-gradient-to-t from-[#5b16c4] to-[#8328f8] hover:from-[#8328f8] hover:to-[#a855f7]"
                }`}
                style={{
                  height: `${height}%`,
                  minHeight: d.seconds > 0 ? "2px" : "0",
                  minWidth: "8px",
                }}
                title={`${d.date} — ${Math.round(d.seconds / 60)} דקות`}
              >
                {/* Tooltip on hover */}
                <div className="absolute -top-9 left-1/2 -translate-x-1/2 bg-[#0F1535] border border-white/20 rounded px-2 py-1 text-[10px] text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none z-10">
                  {d.date}: {Math.round(d.seconds / 60)} דק'
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-1 mt-2 overflow-hidden" style={{ minWidth: Math.max(480, data.length * 16) }}>
          {data.map((d, i) => (
            <div
              key={d.date}
              className="flex-1 text-[9px] text-white/40 text-center tabular-nums"
              style={{ minWidth: "8px" }}
            >
              {i % 5 === 0 || i === data.length - 1 ? d.date : ""}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============ Top pages list ============ */

function TopPagesList({
  topPages,
}: {
  topPages: Array<{ path: string; name: string; visits: number; totalSeconds: number }>;
}) {
  const max = Math.max(1, ...topPages.map((p) => p.totalSeconds));
  return (
    <div className="bg-[#111056]/60 border border-white/10 rounded-xl overflow-hidden">
      {topPages.map((p, i) => {
        const pct = (p.totalSeconds / max) * 100;
        return (
          <div
            key={p.path}
            className={`relative px-4 py-2.5 ${i > 0 ? "border-t border-white/5" : ""}`}
          >
            {/* Background bar */}
            <div
              className="absolute inset-y-0 right-0 bg-[#8328f8]/10"
              style={{ width: `${pct}%`, transition: "width 700ms ease-out" }}
            />
            <div className="relative flex justify-between items-center text-[13px]">
              <div className="text-white truncate flex items-center gap-2">
                <span className="text-white/30 text-[11px] w-5 shrink-0 tabular-nums">{i + 1}.</span>
                <span className="truncate">{p.name}</span>
              </div>
              <div className="text-white/60 shrink-0 ms-3 tabular-nums text-[12px]">
                <span className="text-white/80 font-semibold">{p.visits}</span>
                <span className="text-white/40"> כניסות · </span>
                {formatDuration(p.totalSeconds)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============ Activity timeline (grouped by date) ============ */

function ActivityTimeline({ activities }: { activities: ActivityRow[] }) {
  // Group by local date (yyyy-mm-dd)
  const groups = useMemo(() => {
    const map = new Map<string, ActivityRow[]>();
    for (const a of activities) {
      const d = new Date(a.entered_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return Array.from(map.entries());
  }, [activities]);

  return (
    <div className="space-y-4">
      {groups.map(([dateKey, items]) => {
        const totalSec = items.reduce((s, a) => s + (a.duration_seconds || 0), 0);
        const d = new Date(items[0].entered_at);
        const dayName = d.toLocaleDateString("he-IL", { weekday: "long" });
        const dateLabel = d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
        return (
          <div key={dateKey}>
            <div className="flex items-center gap-2 mb-2 sticky top-0 bg-[#0F1535] py-1 z-[1]">
              <div className="text-white/80 text-[12px] font-semibold">{dayName}</div>
              <div className="text-white/40 text-[11px]">· {dateLabel}</div>
              <div className="flex-1 h-px bg-white/5" />
              <div className="text-white/50 text-[11px]">
                {items.length} ביקורים · {formatDuration(totalSec)}
              </div>
            </div>
            <div className="space-y-1.5 relative pe-4">
              {/* Vertical line */}
              <div className="absolute top-0 bottom-0 right-1.5 w-px bg-white/10" />
              {items.map((a) => {
                const time = new Date(a.entered_at).toLocaleTimeString("he-IL", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <div
                    key={a.id}
                    className="relative bg-[#111056]/60 border border-white/10 rounded-xl p-3 text-[13px] hover:border-white/30 transition"
                  >
                    {/* Dot */}
                    <div className="absolute right-[-10px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[#8328f8] ring-2 ring-[#0F1535]" />
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-medium truncate">{a.page_name || a.page_path}</div>
                        <div className="text-white/40 text-xs mt-0.5 tabular-nums">
                          {time} · {a.page_path}
                        </div>
                      </div>
                      <div className="text-white/80 text-xs shrink-0 bg-white/5 rounded px-2 py-0.5 tabular-nums">
                        {formatDuration(a.duration_seconds)}
                      </div>
                    </div>
                    {(a.device_type || a.browser || a.screen_size) && (
                      <div className="flex flex-wrap gap-2 mt-2 text-white/40 text-[11px]">
                        {a.device_type && (
                          <span className="inline-flex items-center gap-1 bg-white/5 rounded px-1.5 py-0.5">
                            <Smartphone className="w-3 h-3" /> {a.device_type}
                          </span>
                        )}
                        {a.browser && (
                          <span className="inline-flex items-center gap-1 bg-white/5 rounded px-1.5 py-0.5">
                            🌐 {a.browser}
                          </span>
                        )}
                        {a.screen_size && (
                          <span className="inline-flex items-center gap-1 bg-white/5 rounded px-1.5 py-0.5 tabular-nums">
                            🖥 {a.screen_size}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Map pathnames to Hebrew page names
const pageNames: Record<string, string> = {
  "/": "דשבורד ראשי",
  "/customers": "ניהול לקוחות ונותני שירות",
  "/expenses": "ניהול הוצאות",
  "/suppliers": "ניהול ספקים",
  "/payments": "ניהול תשלומים",
  "/cashflow": "תזרים מזומנים",
  "/ocr": "קליטת מסמכים OCR",
  "/reports": "דוח רווח הפסד",
  "/goals": "יעדים",
  "/insights": "תובנות",
  "/settings": "הגדרות",
  "/ai": "עוזר AI",
  "/admin/business/new": "יצירת עסק חדש",
  "/admin/business/edit": "עריכת עסק",
  "/admin/users": "ניהול משתמשים",
  "/admin/goals": "ניהול יעדים ותקציבים",
  "/admin/online-users": "משתמשים מחוברים",
  "/admin/suppliers": "ייבוא ספקים",
  "/admin/expenses": "ייבוא הוצאות",
  "/admin/payments": "ייבוא תשלומים",
  "/admin/daily-entries": "ייבוא מילוי יומי",
  "/admin/historical-data": "ייבוא נתוני עבר",
  "/price-tracking": "מעקב מחירי ספקים",
};

function formatTimeAgo(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return "הרגע";
  if (diffMins < 60) return `לפני ${diffMins} דקות`;
  if (diffHours < 24) return `לפני ${diffHours} שעות`;
  return date.toLocaleDateString("he-IL");
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.split(" ").filter(Boolean);
    if (parts.length >= 2) return parts[0][0] + parts[1][0];
    return parts[0]?.[0] || email[0];
  }
  return email[0].toUpperCase();
}

function UserCard({ user, onClick }: { user: PresenceUser; onClick: () => void }) {
  const [timeAgo, setTimeAgo] = useState(() => formatTimeAgo(user.online_at));

  // Update time display every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeAgo(formatTimeAgo(user.online_at));
    }, 60000);
    return () => clearInterval(interval);
  }, [user.online_at]);

  const pageName = pageNames[user.current_page] || user.current_page;

  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-[#111056]/60 border border-white/10 rounded-xl p-4 flex items-center gap-4 transition-all duration-300 text-right w-full hover:border-white/30 hover:bg-[#111056]/80 cursor-pointer"
    >
      {/* Avatar with online dot */}
      <div className="relative flex-shrink-0">
        {user.avatar_url ? (
          <Image
            src={user.avatar_url}
            alt={user.full_name || user.email}
            width={48}
            height={48}
            className="rounded-full object-cover"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-[#29318A] flex items-center justify-center text-white text-lg font-bold">
            {getInitials(user.full_name, user.email)}
          </div>
        )}
        {/* Green online dot */}
        <div className="absolute -bottom-0.5 -left-0.5 w-3.5 h-3.5 bg-[#3CD856] rounded-full border-2 border-[#0F1535]" />
      </div>

      {/* User info */}
      <div className="flex-1 min-w-0">
        <div className="text-white font-semibold text-sm truncate">
          {user.full_name || user.email}
        </div>
        <div className="text-white/50 text-xs truncate">{user.email}</div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-white/40 text-xs">{pageName}</span>
          <span className="text-white/20">·</span>
          <span className="text-[#3CD856] text-xs">{timeAgo}</span>
        </div>
      </div>
    </button>
  );
}

interface AllUserRow {
  user_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  created_at: string;
  last_seen_at: string | null;
  last_page_path: string | null;
  last_page_name: string | null;
  businesses: { id: string; name: string }[];
}

function formatLastSeen(iso: string | null): { label: string; color: string } {
  if (!iso) return { label: "לא נכנס מעולם", color: "text-white/40" };
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 5) return { label: "מחובר עכשיו", color: "text-[#3CD856]" };
  if (diffMins < 60) return { label: `לפני ${diffMins} דקות`, color: "text-[#3CD856]" };
  if (diffHours < 24) return { label: `לפני ${diffHours} שעות`, color: "text-[#FFA412]" };
  if (diffDays < 7) return { label: `לפני ${diffDays} ימים`, color: "text-[#FFA412]" };
  if (diffDays < 30) return { label: `לפני ${diffDays} ימים`, color: "text-[#F64E60]" };
  return { label: date.toLocaleDateString("he-IL"), color: "text-[#F64E60]" };
}

function AllUserCard({ user, onClick }: { user: AllUserRow; onClick: () => void }) {
  const seen = formatLastSeen(user.last_seen_at);
  const pageName = user.last_page_path ? (pageNames[user.last_page_path] || user.last_page_name || user.last_page_path) : null;
  const bizNames = user.businesses.map(b => b.name).join(" · ");

  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-[#111056]/60 border border-white/10 rounded-xl p-4 flex items-center gap-4 transition-all duration-300 text-right w-full hover:border-white/30 hover:bg-[#111056]/80 cursor-pointer"
    >
      <div className="relative flex-shrink-0">
        {user.avatar_url ? (
          <Image src={user.avatar_url} alt={user.full_name || user.email} width={48} height={48} className="rounded-full object-cover" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-[#29318A] flex items-center justify-center text-white text-lg font-bold">
            {getInitials(user.full_name, user.email)}
          </div>
        )}
        {user.last_seen_at && (Date.now() - new Date(user.last_seen_at).getTime() < 5 * 60_000) && (
          <div className="absolute -bottom-0.5 -left-0.5 w-3.5 h-3.5 bg-[#3CD856] rounded-full border-2 border-[#0F1535]" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-semibold text-sm truncate">{user.full_name || user.email}</span>
          {user.is_admin && <span className="text-[10px] text-[#FFA412] bg-[#FFA412]/10 px-1.5 py-0.5 rounded">Admin</span>}
        </div>
        <div className="text-white/50 text-xs truncate">{user.email}</div>
        {bizNames && <div className="text-white/40 text-[11px] truncate mt-0.5">{bizNames}</div>}
        <div className="flex items-center gap-2 mt-1">
          {pageName && <span className="text-white/40 text-xs truncate">{pageName}</span>}
          {pageName && <span className="text-white/20">·</span>}
          <span className={`text-xs ${seen.color}`}>{seen.label}</span>
        </div>
      </div>
    </button>
  );
}

export default function OnlineUsersPage() {
  const { isAdmin, onlineUsers } = useDashboard();
  const router = useRouter();
  const [selectedUser, setSelectedUser] = useState<PresenceUser | null>(null);
  const [activeTab, setActiveTab] = useState<"online" | "all">("online");
  const [allUsers, setAllUsers] = useState<AllUserRow[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);
  const [search, setSearch] = useState("");

  // Redirect non-admin users
  useEffect(() => {
    if (!isAdmin) {
      router.replace("/");
    }
  }, [isAdmin, router]);

  // Load the "all users" list when the tab is switched to it.
  useEffect(() => {
    if (activeTab !== "all") return;
    let cancelled = false;
    setLoadingAll(true);
    fetch("/api/all-users-activity")
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const list: AllUserRow[] = data.users || [];
        // Sort: users who have been seen before, newest first; never-seen at the end.
        list.sort((a, b) => {
          if (!a.last_seen_at && !b.last_seen_at) return 0;
          if (!a.last_seen_at) return 1;
          if (!b.last_seen_at) return -1;
          return b.last_seen_at.localeCompare(a.last_seen_at);
        });
        setAllUsers(list);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingAll(false); });
    return () => { cancelled = true; };
  }, [activeTab]);

  if (!isAdmin) return null;

  const filteredAll = search.trim()
    ? allUsers.filter(u => {
        const q = search.trim().toLowerCase();
        return (u.full_name || "").toLowerCase().includes(q)
          || u.email.toLowerCase().includes(q)
          || u.businesses.some(b => b.name.toLowerCase().includes(q));
      })
    : allUsers;

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-white text-xl lg:text-2xl font-bold">משתמשים</h1>
        <div className="bg-[#3CD856] text-white text-sm font-bold p-1.5 rounded-full min-w-[28px] text-center leading-none">
          {onlineUsers.length}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setActiveTab("online")}
          className={`px-4 py-2 rounded-lg text-[14px] transition ${activeTab === "online" ? "bg-[#29318A] text-white border border-white" : "bg-transparent text-white/60 border border-[#4C526B] hover:border-white/50"}`}
        >
          מחוברים עכשיו ({onlineUsers.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("all")}
          className={`px-4 py-2 rounded-lg text-[14px] transition ${activeTab === "all" ? "bg-[#29318A] text-white border border-white" : "bg-transparent text-white/60 border border-[#4C526B] hover:border-white/50"}`}
        >
          כל המשתמשים
        </button>
      </div>

      {activeTab === "online" ? (
        onlineUsers.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-white/30 text-6xl mb-4">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" className="mx-auto text-white/20">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-white/40 text-lg">אין משתמשים מחוברים כרגע</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {onlineUsers.map((user) => (
              <UserCard key={user.user_id} user={user} onClick={() => setSelectedUser(user)} />
            ))}
          </div>
        )
      ) : (
        <>
          <div className="mb-4">
            <input
              type="text"
              placeholder="חיפוש לפי שם, אימייל, או שם עסק…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#111056]/60 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder:text-white/30 focus:border-white/30 outline-none"
            />
          </div>
          {loadingAll ? (
            <div className="text-white/50 text-center py-10">טוען…</div>
          ) : filteredAll.length === 0 ? (
            <p className="text-white/40 text-center py-10">לא נמצאו משתמשים</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredAll.map((u) => (
                <AllUserCard
                  key={u.user_id}
                  user={u}
                  onClick={() => setSelectedUser({
                    user_id: u.user_id,
                    email: u.email,
                    full_name: u.full_name,
                    avatar_url: u.avatar_url,
                    online_at: u.last_seen_at || new Date(0).toISOString(),
                    current_page: u.last_page_path || "",
                  } as PresenceUser)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {selectedUser && (
        <UserHistoryModal user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  );
}
