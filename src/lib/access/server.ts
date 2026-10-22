import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_PAGE_KEY } from "./pages";

/**
 * Server-side checks against `user_access_settings`.
 *
 * Every lookup fails OPEN (treated as "allowed" / "receives") when the query
 * errors, so a missing table or a transient DB error never locks users out of
 * a page or silently stops every automated email. The error is logged.
 */

/**
 * True when `pageKey` is blocked for this user. Admins are never blocked.
 * `supabase` may be the per-request user client (RLS lets a user read their
 * own row and own profile) or a service-role client.
 */
export async function isPageBlockedForUser(
  supabase: SupabaseClient,
  userId: string,
  pageKey: string
): Promise<boolean> {
  const [profileRes, settingsRes] = await Promise.all([
    supabase.from("profiles").select("is_admin").eq("id", userId).maybeSingle(),
    supabase.from("user_access_settings").select("blocked_pages").eq("user_id", userId).maybeSingle(),
  ]);

  if (profileRes.error) {
    console.error("[access] profiles lookup failed:", profileRes.error.message);
    return false;
  }
  if (profileRes.data?.is_admin === true) return false;

  if (settingsRes.error) {
    console.error("[access] user_access_settings lookup failed:", settingsRes.error.message);
    return false;
  }

  const blocked = (settingsRes.data?.blocked_pages as string[] | null) || [];
  return blocked.includes(pageKey);
}

/** True when the AI assistant is blocked for this user (used by /api/ai/* chat routes). */
export function isAiBlockedForUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
  return isPageBlockedForUser(supabase, userId, AI_PAGE_KEY);
}

/**
 * Ids (out of `userIds`) of users who switched off automated emails
 * (`receives_auto_emails = false`). A user without a row receives emails.
 * Call with the service-role client: email routes run without a user session.
 */
export async function getAutoEmailOptOutIds(
  supabase: SupabaseClient,
  userIds: readonly string[]
): Promise<Set<string>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Set();

  const { data, error } = await supabase
    .from("user_access_settings")
    .select("user_id")
    .in("user_id", ids)
    .eq("receives_auto_emails", false);

  if (error) {
    console.error("[access] receives_auto_emails lookup failed:", error.message);
    return new Set();
  }

  return new Set((data || []).map((row) => row.user_id as string));
}

/**
 * Drops membership rows whose `user_id` opted out of automated emails.
 * Rows keep their original shape so callers can keep mapping `profiles.email`.
 */
export async function filterAutoEmailRecipients<T extends { user_id?: string | null }>(
  supabase: SupabaseClient,
  rows: readonly T[] | null | undefined
): Promise<T[]> {
  const list = rows ? [...rows] : [];
  const optedOut = await getAutoEmailOptOutIds(
    supabase,
    list.map((row) => row.user_id || "")
  );
  if (optedOut.size === 0) return list;
  return list.filter((row) => !row.user_id || !optedOut.has(row.user_id));
}
