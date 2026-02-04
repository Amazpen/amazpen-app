import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Dynamic import for pdf.js to avoid issues with server-side rendering
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function convertPdfToImage(pdfBuffer: Buffer): Promise<any> {
  // Use dynamic import for canvas
  const { createCanvas } = await import("canvas");

  // Use dynamic import for pdfjs-dist
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // Load the PDF document
  const loadingTask = pdfjs.getDocument({ data: pdfBuffer });
  const pdfDocument = await loadingTask.promise;

  // Get the first page
  const page = await pdfDocument.getPage(1);

  // Set scale for good quality (2x for retina-like quality)
  const scale = 2;
  const viewport = page.getViewport({ scale });

  // Create canvas
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext("2d");

  // Render PDF page to canvas
  await page.render({
    canvasContext: context,
    viewport: viewport,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).promise;

  // Convert canvas to PNG buffer
  const pngBuffer = canvas.toBuffer("image/png");

  return pngBuffer;
}

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
    let buffer = Buffer.from(arrayBuffer);
    let contentType = file.type;

    // If the file is a PDF, convert it to PNG
    if (file.type === "application/pdf") {
      try {
        console.log("Converting PDF to PNG...");
        buffer = await convertPdfToImage(buffer);
        contentType = "image/png";
        // Change the file extension in the path from .pdf to .png
        path = path.replace(/\.pdf$/i, ".png");
        console.log("PDF converted to PNG successfully");
      } catch (conversionError) {
        console.error("PDF conversion error:", conversionError);
        return NextResponse.json({ error: "שגיאה בהמרת PDF לתמונה" }, { status: 500 });
      }
    }

    // Upload file using service role (bypasses CORS)
    const { data, error: uploadError } = await adminSupabase.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType: contentType,
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
