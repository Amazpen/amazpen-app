"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

type PostgresChangeEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

interface SubscriptionConfig {
  table: string;
  schema?: string;
  event?: PostgresChangeEvent;
  filter?: string;
}

interface UseRealtimeOptions {
  subscriptions: SubscriptionConfig[];
  onDataChange: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
  enabled?: boolean;
}

// Check if realtime is disabled via environment variable
const REALTIME_DISABLED = process.env.NEXT_PUBLIC_DISABLE_REALTIME === "true";

/**
 * Hook for subscribing to Supabase Realtime changes
 * Automatically manages channel lifecycle and cleanup
 * Only subscribes when user is authenticated
 * Gracefully handles self-hosted instances without Realtime configured
 * Can be disabled by setting NEXT_PUBLIC_DISABLE_REALTIME=true
 */
export function useRealtimeSubscription({
  subscriptions,
  onDataChange,
  enabled = true,
}: UseRealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const callbackRef = useRef(onDataChange);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [realtimeAvailable, setRealtimeAvailable] = useState(!REALTIME_DISABLED);

  // Keep callback ref updated
  useEffect(() => {
    callbackRef.current = onDataChange;
  }, [onDataChange]);

  // Track authentication status and token refreshes
  useEffect(() => {
    const supabase = createClient();
    // Initial check
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });
    // Listen for auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const wasAuthenticated = isAuthenticated;
      setIsAuthenticated(!!session);
      // When token refreshes, reconnect Realtime with the new token
      if (event === "TOKEN_REFRESHED" && session) {
        supabase.realtime.setAuth(session.access_token);
      }
      // If user signed out, stop retrying
      if (event === "SIGNED_OUT") {
        retryCountRef.current = 0;
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      }
      // If user just signed in, reset retries and reconnect
      if (event === "SIGNED_IN" && !wasAuthenticated) {
        retryCountRef.current = 0;
        setRealtimeAvailable(true);
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Don't subscribe if not enabled, no subscriptions, not authenticated, or realtime unavailable
    if (!enabled || subscriptions.length === 0 || !isAuthenticated || !realtimeAvailable) {
      return;
    }

    const supabase = createClient();
    const channelName = `realtime-${subscriptions.map(s => s.table).join("-")}-${Date.now()}`;

    // Create channel
    let channel = supabase.channel(channelName);

    // Add subscriptions for each table
    for (const config of subscriptions) {
      const { table, schema = "public", event = "*", filter } = config;

      const subscriptionConfig: {
        event: PostgresChangeEvent;
        schema: string;
        table: string;
        filter?: string;
      } = {
        event,
        schema,
        table,
      };

      if (filter) {
        subscriptionConfig.filter = filter;
      }

      channel = channel.on(
        "postgres_changes",
        subscriptionConfig,
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          callbackRef.current(payload);
        }
      );
    }

    // Ensure we have a fresh token before subscribing
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        supabase.realtime.setAuth(session.access_token);
      }
    });

    // Subscribe with exponential backoff retry (keeps trying indefinitely)
    try {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (retryCountRef.current > 0) {
            console.info(`[Realtime] Reconnected after ${retryCountRef.current} retries`);
          }
          retryCountRef.current = 0;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          retryCountRef.current++;
          const delay = Math.min(5000 * Math.pow(2, retryCountRef.current - 1), 60000);
          // Only log first 3 retries to avoid console spam
          if (retryCountRef.current <= 3) {
            console.warn(`[Realtime] Channel ${status}, retry ${retryCountRef.current} in ${delay / 1000}s...`);
          }
          retryTimerRef.current = setTimeout(() => {
            if (channelRef.current) {
              supabase.removeChannel(channelRef.current);
              channelRef.current = null;
            }
            setRealtimeAvailable(false);
            setTimeout(() => setRealtimeAvailable(true), 100);
          }, delay);
        }
      });
    } catch {
      // WebSocket failed — retry after 10s
      console.warn("[Realtime] WebSocket connection failed, retrying in 10s...");
      retryTimerRef.current = setTimeout(() => {
        setRealtimeAvailable(false);
        setTimeout(() => setRealtimeAvailable(true), 100);
      }, 10000);
    }

    channelRef.current = channel;

    // Cleanup on unmount
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isAuthenticated, realtimeAvailable, JSON.stringify(subscriptions)]);

  return channelRef.current;
}

/**
 * Simple hook for subscribing to a single table
 */
export function useTableRealtime(
  table: string,
  onDataChange: () => void,
  options?: {
    enabled?: boolean;
    filter?: string;
    event?: PostgresChangeEvent;
  }
) {
  const { enabled = true, filter, event = "*" } = options || {};

  return useRealtimeSubscription({
    subscriptions: [{ table, filter, event }],
    onDataChange: useCallback(() => onDataChange(), [onDataChange]),
    enabled,
  });
}

/**
 * Hook for subscribing to multiple tables with a single refresh callback
 */
export function useMultiTableRealtime(
  tables: string[],
  onDataChange: () => void,
  enabled: boolean = true
) {
  return useRealtimeSubscription({
    subscriptions: tables.map(table => ({ table })),
    onDataChange: useCallback(() => onDataChange(), [onDataChange]),
    enabled,
  });
}
