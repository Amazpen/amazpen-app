import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import OpenAI from "openai";

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "שירות AI לא מוגדר" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Authenticate user
  const serverSupabase = await createServerClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "לא מחובר" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse multipart form data
  const formData = await request.formData();
  const audioFile = formData.get("audio") as File | null;

  if (!audioFile) {
    return new Response(JSON.stringify({ error: "חסר קובץ שמע" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Limit file size to 10MB
  if (audioFile.size > 10 * 1024 * 1024) {
    return new Response(
      JSON.stringify({ error: "הקובץ גדול מדי (מקסימום 10MB)" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30_000,
    });

    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: audioFile,
      language: "he",
    });

    return new Response(
      JSON.stringify({ text: transcription.text }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[AI Transcribe] Error:", err);
    return new Response(
      JSON.stringify({ error: "שגיאה בתמלול ההודעה הקולית" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
