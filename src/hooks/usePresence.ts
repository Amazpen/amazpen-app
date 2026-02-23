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

  return onlineUsers;
}
