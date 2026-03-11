import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const OUR_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "application/pdf": "pdf",
};

function guessExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").pop() || "";
    const dot = last.lastIndexOf(".");
    if (dot !== -1) return last.slice(dot + 1).toLowerCase().split("?")[0];
  } catch { /* ignore */ }
  return "bin";
}

/**
 * POST /api/upload/transfer-url
 * Body: { url: string, bucket?: string, folder?: string }
 *
 * Downloads an external URL and re-uploads it to our Supabase storage.
 * If the URL already belongs to our Supabase, returns it unchanged.
 * Returns: { success: true, publicUrl: string }
 */
export async function POST(request: NextRequest) {
  // Authenticate
  const serverSupabase = await createServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  let body: { url?: string; bucket?: string; folder?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  let { url, bucket = "attachments", folder = "imported" } = body;

  // Normalize protocol-relative URLs (//cdn...) to https://
  if (url?.startsWith("//")) url = `https:${url}`;

  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    return NextResponse.json({ error: "URL לא תקין" }, { status: 400 });
  }

  // If it's already our Supabase URL — return as-is
  if (OUR_SUPABASE_URL && url.startsWith(OUR_SUPABASE_URL)) {
    return NextResponse.json({ success: true, publicUrl: url, skipped: true });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "חסר הגדרות שרת" }, { status: 500 });
  }

  // Download the file
  let fileBuffer: Buffer;
  let contentType = "application/octet-stream";
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Amazpen-Import/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      // Return original URL as fallback — don't error out
      return NextResponse.json({ success: true, publicUrl: url, skipped: true });
    }
    contentType = response.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream";
    const arrayBuffer = await response.arrayBuffer();
    fileBuffer = Buffer.from(arrayBuffer);
  } catch {
    // Timeout or network error — return original URL as fallback
    return NextResponse.json({ success: true, publicUrl: url, skipped: true });
  }

  // Build storage path
  const ext = EXT_BY_MIME[contentType] || guessExtFromUrl(url);
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const storagePath = `${folder}/${timestamp}-${random}.${ext}`;

  // Upload to Supabase storage
  const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: uploadError } = await adminSupabase.storage
    .from(bucket)
    .upload(storagePath, fileBuffer, {
      contentType,
      cacheControl: "31536000", // 1 year
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: `שגיאה בהעלאה: ${uploadError.message}` }, { status: 500 });
  }

  const { data: urlData } = adminSupabase.storage.from(bucket).getPublicUrl(storagePath);

  return NextResponse.json({ success: true, publicUrl: urlData.publicUrl });
}
