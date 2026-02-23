# Online Users (Admin) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an admin-only page that shows real-time count and list of currently connected users using Supabase Presence API.

**Architecture:** All authenticated users track their presence via a shared Supabase Presence channel in the dashboard layout. An admin page at `/admin/online-users` listens to the same channel and displays the current state. No database tables needed.

**Tech Stack:** Supabase Realtime Presence, React hooks, Next.js App Router, Tailwind CSS, shadcn/ui

---

### Task 1: Create `usePresence` Hook

**Files:**
- Create: `src/hooks/usePresence.ts`

**Step 1: Create the hook file**

```typescript
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface PresenceUser {
  user_id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  online_at: string;
  current_page: string;
}

// Check if realtime is disabled via environment variable
const REALTIME_DISABLED = process.env.NEXT_PUBLIC_DISABLE_REALTIME === "true";

/**
 * Hook that tracks the current user's presence in the "online-users" channel.
 * Called from dashboard layout for every authenticated user.
 */
export function usePresenceTrack(userProfile: { id: string; email: string; full_name: string; avatar_url: string | null } | null, pathname: string) {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!userProfile || REALTIME_DISABLED) return;

    const supabase = createClient();
    const channel = supabase.channel("online-users", {
      config: { presence: { key: userProfile.id } },
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          user_id: userProfile.id,
          email: userProfile.email,
          full_name: userProfile.full_name,
          avatar_url: userProfile.avatar_url,
          online_at: new Date().toISOString(),
          current_page: pathname,
        });
      }
    });

    channelRef.current = channel;

    return () => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
}

/**
 * Hook that listens to the "online-users" presence channel and returns
 * the list of currently connected users. Used on the admin page.
 */
export function usePresenceListener() {
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (REALTIME_DISABLED) return;

    const supabase = createClient();
    const channel = supabase.channel("online-users-listener", {
      config: { presence: { key: "_admin_listener_" + Date.now() } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const users: PresenceUser[] = [];
        for (const presences of Object.values(state)) {
          if (presences && presences.length > 0) {
            const p = presences[0] as unknown as PresenceUser;
            // Skip the admin listener key itself
            if (p.user_id) {
              users.push(p);
            }
          }
        }
        setOnlineUsers(users);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, []);

  return onlineUsers;
}
```

**Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit src/hooks/usePresence.ts` (or rely on IDE)
Expected: No errors

**Step 3: Commit**

```bash
git add src/hooks/usePresence.ts
git commit -m "feat(presence): add usePresence hooks for tracking and listening"
```

---

### Task 2: Integrate Presence Tracking in Dashboard Layout

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`

**Step 1: Add import for usePresenceTrack**

At the top imports (around line 12-16), add:

```typescript
import { usePresenceTrack } from "@/hooks/usePresence";
```

**Step 2: Call the hook inside DashboardLayout**

After the `useWakeLock()` call (around line 190), add:

```typescript
// Track user presence for online-users feature
usePresenceTrack(userProfile, pathname);
```

**Step 3: Add `/admin/online-users` to existingPages array**

In the `existingPages` array (line 41), add `"/admin/online-users"` at the end.

**Step 4: Add admin menu item**

In the `adminMenuItems` array (around line 59-72), add a new entry:

```typescript
{ id: 112, label: "משתמשים מחוברים", href: "/admin/online-users", key: "admin-online-users" },
```

**Step 5: Add page title**

In the `pageTitles` object (around line 75-98), add:

```typescript
"/admin/online-users": "משתמשים מחוברים",
```

**Step 6: Verify dev server runs without errors**

Run: `npm run dev`
Expected: No compile errors, sidebar shows new admin menu item

**Step 7: Commit**

```bash
git add src/app/(dashboard)/layout.tsx
git commit -m "feat(layout): integrate presence tracking and admin menu item"
```

---

### Task 3: Create Admin Online Users Page

**Files:**
- Create: `src/app/(dashboard)/admin/online-users/page.tsx`

**Step 1: Create the page**

Reference `pageTitles` from layout.tsx (lines 75-98) for translating pathnames to Hebrew.

```typescript
"use client";

import { useDashboard } from "../../layout";
import { usePresenceListener, type PresenceUser } from "@/hooks/usePresence";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";

// Map pathnames to Hebrew page names (subset of pageTitles from layout)
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
  const { isAdmin } = useDashboard();
  const router = useRouter();
  const onlineUsers = usePresenceListener();

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
        <div className="bg-[#3CD856] text-white text-sm font-bold px-2.5 py-0.5 rounded-full min-w-[28px] text-center">
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
```

**Step 2: Verify page loads correctly**

Run: `npm run dev`, navigate to `/admin/online-users`
Expected: Page loads with header, shows at least current user as online

**Step 3: Commit**

```bash
git add src/app/(dashboard)/admin/online-users/page.tsx
git commit -m "feat(admin): add online users page with real-time presence"
```

---

### Task 4: Test & Verify End-to-End

**Step 1: Test with dev server**

Run: `npm run dev`
- Open two different browsers (or incognito) logged in as different users
- Navigate to `/admin/online-users` as admin
- Verify both users appear in real-time
- Close one browser tab → verify user disappears from the list
- Navigate to different pages → verify "current page" updates

**Step 2: Build check**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address any issues found during testing"
```
