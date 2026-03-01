import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Singleton instance - reuse the same client across the app
let supabaseInstance: SupabaseClient | null = null;

export function createClient() {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // During build/prerender env vars may be missing - return a dummy client
    // that will be replaced on the actual client-side render
    return null as unknown as SupabaseClient;
  }

  supabaseInstance = createBrowserClient(
    url,
    key,
    {
      realtime: {
        params: {
          eventsPerSecond: 100, // Increased for better scalability
        },
      },
    }
  );

  return supabaseInstance;
}
