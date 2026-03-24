import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

// Image types that need conversion to JPEG for compatibility
const CONVERT_TO_JPEG_TYPES = new Set([
  "image/avif", "image/heic", "image/heif", "image/tiff", "image/bmp",
  "image/webp", // webp is generally fine, but some storage/CDN setups don't serve it well
]);
const CONVERT_TO_JPEG_EXTENSIONS = /\.(avif|heic|heif|tiff|tif|bmp)$/i;

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
    }

    // Get form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const bucket = formData.get("bucket") as string || "assets";
    let path = formData.get("path") as string;

    if (!file) {
      return NextResponse.json({ error: "חסר קובץ" }, { status: 400 });
    }

    if (!path) {
      return NextResponse.json({ error: "חסר נתיב" }, { status: 400 });
    }

    // Create admin client with service role key to bypass CORS
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

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    let buffer: Buffer<ArrayBuffer> = Buffer.from(arrayBuffer);
    let contentType = file.type || "application/octet-stream";
    const fileName = file.name?.toLowerCase() || "";

    // Convert exotic image formats (AVIF, HEIC, TIFF, BMP) to JPEG for compatibility
    const needsConversion = CONVERT_TO_JPEG_TYPES.has(contentType) ||
      CONVERT_TO_JPEG_EXTENSIONS.test(fileName) ||
      (contentType === "" && /\.(avif|heic|heif)$/i.test(fileName));

    if (needsConversion) {
      try {
        console.log(`[Upload] Converting ${contentType || fileName} to JPEG...`);
        const converted = await sharp(buffer)
          .rotate() // auto-rotate based on EXIF
          .jpeg({ quality: 90 })
          .toBuffer();
        buffer = Buffer.from(converted.buffer, converted.byteOffset, converted.byteLength) as Buffer<ArrayBuffer>;
        contentType = "image/jpeg";
        // Update path extension to .jpeg
        path = path.replace(/\.[^.]+$/, ".jpeg");
        console.log(`[Upload] Converted successfully: ${buffer.length} bytes`);
      } catch (convErr) {
        console.warn("[Upload] Image conversion failed, uploading as-is:", convErr);
        // Fall through to upload original
      }
    }

    // If contentType is still empty, try to detect from extension
    if (!contentType || contentType === "application/octet-stream") {
      if (/\.jpe?g$/i.test(path)) contentType = "image/jpeg";
      else if (/\.png$/i.test(path)) contentType = "image/png";
      else if (/\.pdf$/i.test(path)) contentType = "application/pdf";
      else if (/\.gif$/i.test(path)) contentType = "image/gif";
    }

    // Upload file using service role (bypasses CORS)
    const { data, error: uploadError } = await adminSupabase.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = adminSupabase.storage
      .from(bucket)
      .getPublicUrl(path);

    return NextResponse.json({
      success: true,
      path: data.path,
      publicUrl: urlData.publicUrl,
    });
  } catch (error) {
    console.error("Error in upload:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "שגיאה בשרת" },
      { status: 500 }
    );
  }
}
