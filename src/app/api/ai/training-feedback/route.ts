import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /api/ai/training-feedback — Save admin feedback on AI response
export async function POST(request: NextRequest) {
  const serverSupabase = await createServerClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();

  if (!user) {
    return jsonResponse({ error: "לא מחובר" }, 401);
  }

  // Verify user is admin
  const { data: membership } = await serverSupabase
    .from("business_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return jsonResponse({ error: "אין הרשאה" }, 403);
  }

  const body = await request.json();
  const { sessionId, businessId, userMessage, assistantMessage, feedbackType, correctionText } = body;

  if (!userMessage || !assistantMessage || !feedbackType) {
    return jsonResponse({ error: "חסרים שדות חובה" }, 400);
  }

  if (feedbackType !== "positive" && feedbackType !== "negative") {
    return jsonResponse({ error: "סוג פידבק לא תקין" }, 400);
  }

  if (feedbackType === "negative" && !correctionText?.trim()) {
    return jsonResponse({ error: "נדרש תיאור התיקון" }, 400);
  }

  const { error } = await serverSupabase.from("ai_training_feedback").insert({
    user_id: user.id,
    business_id: businessId || null,
    session_id: sessionId || null,
    user_message: userMessage,
    assistant_message: assistantMessage,
    feedback_type: feedbackType,
    correction_text: feedbackType === "negative" ? correctionText.trim() : null,
  });

  if (error) {
    console.error("Failed to save training feedback:", error);
    return jsonResponse({ error: "שגיאה בשמירת הפידבק" }, 500);
  }

  return jsonResponse({ success: true });
}
