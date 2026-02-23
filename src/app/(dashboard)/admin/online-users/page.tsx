"use client";

import { useDashboard } from "../../layout";
import type { PresenceUser } from "@/hooks/usePresence";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";

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

function UserCard({ user }: { user: PresenceUser }) {
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
    <div className="bg-[#111056]/60 border border-white/10 rounded-xl p-4 flex items-center gap-4 transition-all duration-300">
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
    </div>
  );
}

export default function OnlineUsersPage() {
  const { isAdmin, onlineUsers } = useDashboard();
  const router = useRouter();

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
            <UserCard key={user.user_id} user={user} />
          ))}
        </div>
      )}
    </div>
  );
}
