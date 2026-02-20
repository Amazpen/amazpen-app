import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// GET /api/ai/sessions — Load the user's latest session with last 10 messages
// ---------------------------------------------------------------------------
export async function GET() {
  const serverSupabase = await createServerClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();

  if (!user) {
    return jsonResponse({ error: "לא מחובר" }, 401);
  }

  // Get the latest session for this user
  const { data: session } = await serverSupabase
    .from("ai_chat_sessions")
    .select("id, title, business_id, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (!session) {
    return jsonResponse({ session: null, messages: [] });
  }

  // Get last 10 messages for this session
  const { data: messages } = await serverSupabase
    .from("ai_chat_messages")
    .select("id, role, content, chart_data, created_at")
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(10);

  // Reverse to get chronological order
  const orderedMessages = (messages || []).reverse();

  return jsonResponse({
    session: { id: session.id, title: session.title, businessId: session.business_id },
    messages: orderedMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      chartData: m.chart_data,
      timestamp: m.created_at,
    })),
  });
}

// ---------------------------------------------------------------------------
// DELETE /api/ai/sessions — Clear the user's current session
// ---------------------------------------------------------------------------
export async function DELETE() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "שירות מסד נתונים לא מוגדר" }, 503);
  }

  const serverSupabase = await createServerClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();

  if (!user) {
    return jsonResponse({ error: "לא מחובר" }, 401);
  }

  // Use service role to delete all sessions + messages for this user
  const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Get all session IDs for this user
  const { data: sessions } = await adminSupabase
    .from("ai_chat_sessions")
    .select("id")
    .eq("user_id", user.id);

  if (sessions && sessions.length > 0) {
    const sessionIds = sessions.map((s) => s.id);

    // Delete messages first (FK is NO ACTION, not CASCADE)
    await adminSupabase
      .from("ai_chat_messages")
      .delete()
      .in("session_id", sessionIds);

    // Then delete sessions
    await adminSupabase
      .from("ai_chat_sessions")
      .delete()
      .eq("user_id", user.id);
  }

  return jsonResponse({ success: true });
}

// ---------------------------------------------------------------------------
// POST /api/ai/sessions — Create a new session (called when user sends first message)
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "שירות מסד נתונים לא מוגדר" }, 503);
  }

  const serverSupabase = await createServerClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();

  if (!user) {
    return jsonResponse({ error: "לא מחובר" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "בקשה לא תקינה" }, 400);
  }

  const businessId = typeof body.businessId === "string" && body.businessId ? body.businessId : null;
  const title = typeof body.title === "string" ? body.title.slice(0, 100) : null;

  const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: session, error } = await adminSupabase
    .from("ai_chat_sessions")
    .insert({
      user_id: user.id,
      business_id: businessId,
      title,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to create session:", error);
    return jsonResponse({ error: "שגיאה ביצירת סשן" }, 500);
  }

  return jsonResponse({ sessionId: session.id });
}
