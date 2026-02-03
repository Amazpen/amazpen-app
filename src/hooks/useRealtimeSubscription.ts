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

// Flag to track if we've already warned about realtime being unavailable
let realtimeWarningShown = false;

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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [realtimeAvailable, setRealtimeAvailable] = useState(!REALTIME_DISABLED);

  // Keep callback ref updated
  useEffect(() => {
    callbackRef.current = onDataChange;
  }, [onDataChange]);

  // Check authentication status
  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setIsAuthenticated(!!user);
    };
    checkAuth();
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

    // Subscribe to the channel with error handling
    try {
      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          // Successfully connected to realtime
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // Realtime not available
          setRealtimeAvailable(false);
          realtimeWarningShown = true;
        }
      });
    } catch (error) {
      // WebSocket connection failed - disable realtime
      setRealtimeAvailable(false);
    }

    channelRef.current = channel;

    // Cleanup on unmount
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
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
