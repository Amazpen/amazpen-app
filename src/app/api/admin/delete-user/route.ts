import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Columns holding the user's id that have to be cleared.
//
// Entries without `afterAuthDelete` are real foreign keys that are NOT
// ON DELETE CASCADE/SET NULL. They must be cleared before the auth.users row
// can be removed, otherwise Supabase returns "Database error deleting user".
//
// Entries flagged `afterAuthDelete` have no foreign key at all, so they can
// neither block nor be blocked by the auth deletion. They are cleared only
// after the account is definitely gone, which keeps the invariant that nothing
// recoverable is destroyed while the account is still alive.
const USER_REFERENCES: { table: string; column: string; afterAuthDelete?: boolean }[] = [
  // FKs to auth.users(id)
  { table: "prior_commitments", column: "created_by" },
  { table: "billing_customers", column: "created_by" },
  { table: "cashflow_income_overrides", column: "created_by" },
  { table: "client_error_logs", column: "user_id" },
  { table: "daily_entry_approvals", column: "approved_by" },
  { table: "invoices", column: "review_approved_by" },
  { table: "payments", column: "review_approved_by" },
  // FKs to public.profiles(id)
  { table: "invoices", column: "created_by" },
  { table: "payments", column: "created_by" },
  { table: "delivery_notes", column: "created_by" },
  { table: "business_day_exceptions", column: "created_by" },
  // NOTE: bonus_plans.employee_user_id is NOT NULL, so it cannot be nulled out
  // like the columns above. Those rows are hard-deleted in their own step below.

  // ------------------------------------------------------------------------
  // NO FOREIGN KEY: the columns below store the user's uuid but nothing in the
  // database enforces any cleanup, so without this loop they keep pointing at a
  // user that no longer exists. The record itself belongs to the business and is
  // kept - only the "who did it" stamp is cleared. All of these columns are
  // nullable (verified). They run after the auth deletion (`afterAuthDelete`).
  // ------------------------------------------------------------------------
  { table: "customer_invoices", column: "created_by", afterAuthDelete: true },
  { table: "daily_entries", column: "created_by", afterAuthDelete: true },
  { table: "daily_summary", column: "created_by", afterAuthDelete: true },
  { table: "labor_month_close", column: "closed_by", afterAuthDelete: true },
  { table: "ocr_document_crops", column: "created_by", afterAuthDelete: true },
  { table: "ocr_documents", column: "reviewed_by", afterAuthDelete: true },
  { table: "tasks", column: "created_by", afterAuthDelete: true },
  { table: "tasks", column: "assignee_id", afterAuthDelete: true },
];

// Personal data: belongs to the person and not to the business, so it must not
// survive them. These tables have no foreign key either, so nothing removes
// them for us. push_subscriptions is a verified leak - rows left behind keep
// delivering push notifications to the deleted person's phone.
// ai_chat_messages.session_id is ON DELETE CASCADE to ai_chat_sessions, so the
// messages disappear with the sessions and need no delete of their own.
const PERSONAL_DATA_TABLES: { table: string; column: string }[] = [
  { table: "push_subscriptions", column: "user_id" },
  { table: "notifications", column: "user_id" },
  { table: "ai_chat_sessions", column: "user_id" },
];

// DELIBERATELY LEFT ALONE: audit_log.user_id and ocr_audit_log.performed_by are
// the security audit trail. They are intentionally never cleared or deleted
// here - the record of who did what has to stay intact after the user is gone.

// Nulls out one group of references. Returns an error response on the first
// failure so the caller can abort the request, or null when everything cleared.
async function clearUserReferences(
  adminSupabase: SupabaseClient,
  userId: string,
  references: { table: string; column: string }[]
): Promise<NextResponse | null> {
  for (const { table, column } of references) {
    const { error: clearError } = await adminSupabase
      .from(table)
      .update({ [column]: null })
      .eq(column, userId);

    if (clearError) {
      console.error(`Error clearing ${table}.${column} for user:`, userId, clearError);
      return NextResponse.json(
        { error: `שגיאה בניקוי הפניות בטבלה ${table}: ${clearError.message}` },
        { status: 500 }
      );
    }
  }

  return null;
}

// True when the auth deletion failed only because the account is not there any
// more. This matters because a previous attempt may have deleted the auth
// account and then failed partway through the cleanup below: the profiles row
// survives, the user is still listed in the admin screen, and the admin will
// click delete again. That retry has to be able to run past this step and
// finish the job instead of dying on "user not found".
// The error shape differs between GoTrue versions, so it is checked
// defensively: an explicit 404 status, or a "not found" message in any casing.
function isAuthUserNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { status, message } = error as { status?: unknown; message?: unknown };

  if (status === 404) {
    return true;
  }

  return typeof message === "string" && /not.?found/i.test(message.toLowerCase());
}

export async function POST(request: NextRequest) {
  try {
    // Verify the requesting user is an admin
    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
    }

    // Check if requesting user is admin
    const { data: profile } = await serverSupabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!profile?.is_admin) {
      return NextResponse.json({ error: "אין הרשאת אדמין" }, { status: 403 });
    }

    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: "חסר מזהה משתמש" }, { status: 400 });
    }

    // Prevent self-deletion
    if (userId === user.id) {
      return NextResponse.json({ error: "לא ניתן למחוק את עצמך" }, { status: 400 });
    }

    // Create admin client with service role key
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: "חסר הגדרות שרת" }, { status: 500 });
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Step 1: clear every blocking reference to the user.
    // A failure here (for example a NOT NULL column) aborts the whole request,
    // so nothing is destroyed while the account stays alive.
    const blockingError = await clearUserReferences(
      adminSupabase,
      userId,
      USER_REFERENCES.filter((reference) => !reference.afterAuthDelete)
    );

    if (blockingError) {
      return blockingError;
    }

    // Step 2: bonus_plans.employee_user_id is NOT NULL, so the loop above cannot
    // clear it. A bonus plan belongs to one specific employee and is meaningless
    // once that employee is gone, so the rows are removed outright. A soft-delete
    // (bonus_plans.deleted_at) would leave the row - and its foreign key - in
    // place, which would still block the auth deletion below.
    const { error: bonusError } = await adminSupabase
      .from("bonus_plans")
      .delete()
      .eq("employee_user_id", userId);

    if (bonusError) {
      console.error("Error deleting bonus plans for user:", userId, bonusError);
      return NextResponse.json(
        { error: `שגיאה במחיקת תוכניות הבונוס בטבלה bonus_plans: ${bonusError.message}` },
        { status: 500 }
      );
    }

    // No explicit session revocation here on purpose: auth.sessions.user_id has
    // ON DELETE CASCADE to auth.users, so admin.deleteUser() below removes every
    // session and refresh token by itself and the account can no longer log in.
    // Caveat: an access token that was already issued stays valid until it
    // expires (the project's JWT expiry, typically one hour), so a device that is
    // mid-session keeps working for that short residual window.

    // Step 3: delete the auth account. This is the step that can still fail, so
    // it runs before the deletes that destroy recoverable data.
    const { error: authError } = await adminSupabase.auth.admin.deleteUser(userId);

    if (authError) {
      // Already gone = the goal of this step is met, so the retry keeps going
      // and cleans up the rows a previous attempt left behind.
      if (isAuthUserNotFoundError(authError)) {
        console.warn("Auth user already deleted, continuing cleanup:", userId);
      } else {
        console.error("Error deleting auth user:", authError);
        return NextResponse.json(
          { error: `שגיאה במחיקת חשבון המשתמש: ${authError.message}` },
          { status: 500 }
        );
      }
    }

    // Step 4: the account is definitely gone - now delete the personal data that
    // no foreign key would have cleaned up on its own.
    for (const { table, column } of PERSONAL_DATA_TABLES) {
      const { error: personalDataError } = await adminSupabase
        .from(table)
        .delete()
        .eq(column, userId);

      if (personalDataError) {
        console.error(`Error deleting ${table} for user:`, userId, personalDataError);
        return NextResponse.json(
          { error: `שגיאה במחיקת הנתונים האישיים בטבלה ${table}: ${personalDataError.message}` },
          { status: 500 }
        );
      }
    }

    // Step 5: clear the "who did it" stamps that have no foreign key. The
    // business records themselves are kept.
    const unenforcedError = await clearUserReferences(
      adminSupabase,
      userId,
      USER_REFERENCES.filter((reference) => reference.afterAuthDelete)
    );

    if (unenforcedError) {
      return unenforcedError;
    }

    // Step 6: only now remove the public data.
    const { error: membersError } = await adminSupabase
      .from("business_members")
      .delete()
      .eq("user_id", userId);

    if (membersError) {
      console.error("Error deleting business members:", membersError);
      return NextResponse.json(
        { error: `שגיאה במחיקת השיוך לעסקים בטבלה business_members: ${membersError.message}` },
        { status: 500 }
      );
    }

    const { error: profileError } = await adminSupabase
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (profileError) {
      console.error("Error deleting profile:", profileError);
      return NextResponse.json(
        { error: `שגיאה במחיקת הפרופיל בטבלה profiles: ${profileError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in delete-user:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "שגיאה בשרת" },
      { status: 500 }
    );
  }
}
