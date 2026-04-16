"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface PresenceUser {
  user_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  online_at: string;
  current_page: string;
}

// Check if realtime is disabled via environment variable
const REALTIME_DISABLED = process.env.NEXT_PUBLIC_DISABLE_REALTIME === "true";

// Map pathnames to Hebrew page names (must match online-users/page.tsx)
const PAGE_NAMES: Record<string, string> = {
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

function resolvePageName(pathname: string): string {
  if (PAGE_NAMES[pathname]) return PAGE_NAMES[pathname];
  // Match dynamic routes like /admin/business/{id}/edit
  if (/^\/admin\/business\/[^/]+\/edit$/.test(pathname)) return "עריכת עסק";
  return pathname;
}

function detectDevice(ua: string): string {
  if (/Mobi|Android/i.test(ua)) return "Mobile";
  if (/Tablet|iPad/i.test(ua)) return "Tablet";
  return "Desktop";
}

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  return "Other";
}

/**
 * Hook that tracks the current user's presence AND listens for all online users.
 * Called from dashboard layout for every authenticated user.
 * Returns the list of currently connected users (for admin page consumption via context).
 */
export function usePresence(
  userProfile: { id: string; email: string; full_name: string | null; avatar_url: string | null } | null,
  pathname: string
) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const lastPathRef = useRef<string | null>(null);

  // Generate a stable per-tab session id
  if (sessionIdRef.current === null && typeof window !== "undefined") {
    const existing = sessionStorage.getItem("presence_session_id");
    if (existing) {
      sessionIdRef.current = existing;
    } else {
      const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem("presence_session_id", newId);
      sessionIdRef.current = newId;
    }
  }

  // Helper to log activity transitions (end previous page, start new one)
  const logTransition = async (newPath: string) => {
    if (!sessionIdRef.current) return;
    const prevPath = lastPathRef.current;
    try {
      // End previous page
      if (prevPath && prevPath !== newPath) {
        await fetch("/api/user-activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "end",
            session_id: sessionIdRef.current,
            page_path: prevPath,
          }),
          keepalive: true,
        });
      }
      // Start new page
      if (prevPath !== newPath) {
        const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
        const screenSize = typeof window !== "undefined" ? `${window.screen.width}x${window.screen.height}` : "";
        await fetch("/api/user-activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "start",
            session_id: sessionIdRef.current,
            page_path: newPath,
            page_name: resolvePageName(newPath),
            user_agent: ua,
            device_type: detectDevice(ua),
            browser: detectBrowser(ua),
            screen_size: screenSize,
          }),
        });
        lastPathRef.current = newPath;
      }
    } catch {
      // Ignore network errors; presence should not break UX
    }
  };

  useEffect(() => {
    if (!userProfile || REALTIME_DISABLED) return;

    const supabase = createClient();
    const channel = supabase.channel("online-users", {
      config: { presence: { key: userProfile.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const users: PresenceUser[] = [];
        for (const presences of Object.values(state)) {
          if (presences && presences.length > 0) {
            const p = presences[0] as unknown as PresenceUser;
            if (p.user_id) {
              users.push(p);
            }
          }
        }
        setOnlineUsers(users);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: userProfile.id,
            email: userProfile.email,
            full_name: userProfile.full_name,
            avatar_url: userProfile.avatar_url,
            online_at: new Date().toISOString(),
            current_page: pathname,
          });
          // Start initial activity entry
          logTransition(pathname);
        }
      });

    channelRef.current = channel;

    // Close the open activity row when tab unloads
    const handleUnload = () => {
      if (!sessionIdRef.current || !lastPathRef.current) return;
      const payload = JSON.stringify({
        action: "end",
        session_id: sessionIdRef.current,
        page_path: lastPathRef.current,
      });
      try {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon("/api/user-activity", blob);
      } catch {
        // ignore
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);

    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
      handleUnload();
      channel.untrack();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile?.id]);

  // Update current_page when pathname changes (without recreating channel)
  useEffect(() => {
    if (!channelRef.current || !userProfile) return;
    channelRef.current.track({
      user_id: userProfile.id,
      email: userProfile.email,
      full_name: userProfile.full_name,
      avatar_url: userProfile.avatar_url,
      online_at: new Date().toISOString(),
      current_page: pathname,
    });
    logTransition(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return onlineUsers;
}
