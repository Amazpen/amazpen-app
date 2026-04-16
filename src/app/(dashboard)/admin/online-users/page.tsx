"use client";

import { useDashboard } from "../../layout";
import type { PresenceUser } from "@/hooks/usePresence";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-[#0F1535] border border-white/10 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <h2 className="text-white text-lg font-bold">{user.full_name || user.email}</h2>
            <p className="text-white/50 text-xs">{user.email}</p>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Filter */}
        <div className="flex gap-2 p-4 border-b border-white/10">
          {([["יום", 1], ["שבוע", 7], ["חודש", 30], ["3 חודשים", 90]] as const).map(([label, d]) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg text-[13px] transition ${days === d ? "bg-[#29318A] text-white border border-white" : "bg-transparent text-white/60 border border-[#4C526B] hover:border-white/50"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-white/50 text-center py-10">טוען...</div>
          ) : (
            <>
              {/* Stats grid */}
              {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <StatCard label="סה״כ זמן" value={formatDuration(stats.totalSeconds)} />
                  <StatCard label="מספר סשנים" value={String(stats.sessionsCount)} />
                  <StatCard label="דפים שנצפו" value={String(stats.pagesVisited)} />
                  <StatCard label="דפים ייחודיים" value={String(stats.uniquePages)} />
                  {stats.firstSeen && (
                    <StatCard label="כניסה ראשונה" value={formatFullDate(stats.firstSeen)} />
                  )}
                  {stats.lastSeen && (
                    <StatCard label="כניסה אחרונה" value={formatFullDate(stats.lastSeen)} />
                  )}
                </div>
              )}

              {/* Top pages */}
              {stats && stats.topPages.length > 0 && (
                <div className="mb-5">
                  <h3 className="text-white font-semibold text-sm mb-2">דפים מובילים</h3>
                  <div className="bg-[#111056]/60 border border-white/10 rounded-xl overflow-hidden">
                    {stats.topPages.map((p, i) => (
                      <div key={p.path} className={`flex justify-between px-4 py-2 text-[13px] ${i > 0 ? "border-t border-white/5" : ""}`}>
                        <div className="text-white truncate">{p.name}</div>
                        <div className="text-white/60 shrink-0 ms-3">
                          {p.visits} כניסות · {formatDuration(p.totalSeconds)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Activity timeline */}
              <h3 className="text-white font-semibold text-sm mb-2">היסטוריה מלאה</h3>
              {activities.length === 0 ? (
                <p className="text-white/50 text-center py-6">אין פעילות בתקופה זו</p>
              ) : (
                <div className="space-y-2">
                  {activities.map((a) => (
                    <div key={a.id} className="bg-[#111056]/60 border border-white/10 rounded-xl p-3 text-[13px]">
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-white font-medium">{a.page_name || a.page_path}</div>
                          <div className="text-white/40 text-xs mt-0.5">{formatFullDate(a.entered_at)}</div>
                        </div>
                        <div className="text-white/70 text-xs shrink-0">
                          {formatDuration(a.duration_seconds)}
                        </div>
                      </div>
                      {(a.device_type || a.browser || a.screen_size) && (
                        <div className="flex gap-3 mt-2 text-white/40 text-[11px]">
                          {a.device_type && <span>📱 {a.device_type}</span>}
                          {a.browser && <span>🌐 {a.browser}</span>}
                          {a.screen_size && <span>🖥 {a.screen_size}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#111056]/60 border border-white/10 rounded-xl p-3">
      <div className="text-white/40 text-[11px] mb-1">{label}</div>
      <div className="text-white font-bold text-[15px]">{value}</div>
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

export default function OnlineUsersPage() {
  const { isAdmin, onlineUsers } = useDashboard();
  const router = useRouter();
  const [selectedUser, setSelectedUser] = useState<PresenceUser | null>(null);

  // Redirect non-admin users
  useEffect(() => {
    if (!isAdmin) {
      router.replace("/");
    }
  }, [isAdmin, router]);

  if (!isAdmin) return null;

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-white text-xl lg:text-2xl font-bold">משתמשים מחוברים</h1>
        <div className="bg-[#3CD856] text-white text-sm font-bold p-1.5 rounded-full min-w-[28px] text-center leading-none">
          {onlineUsers.length}
        </div>
      </div>

      {/* Users grid or empty state */}
      {onlineUsers.length === 0 ? (
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
      )}

      {selectedUser && (
        <UserHistoryModal user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  );
}
