import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const VISION_API_URL = `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export async function POST(request: NextRequest) {
  if (!GOOGLE_VISION_API_KEY) {
    return Response.json({ error: "שירות OCR לא מוגדר" }, { status: 503 });
  }

  // Authenticate user
  const serverSupabase = await createServerClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "לא מחובר" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return Response.json({ error: "חסר קובץ" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: "הקובץ גדול מדי (מקסימום 10MB)" }, { status: 400 });
  }

  const isImage = ACCEPTED_IMAGE_TYPES.includes(file.type);
  const isPdf = file.type === "application/pdf";

  if (!isImage && !isPdf) {
    return Response.json({ error: "סוג קובץ לא נתמך" }, { status: 400 });
  }

  try {
    if (isImage) {
      const text = await ocrImage(file);
      return Response.json({ text });
    }

    // PDF — try text extraction first, fallback to OCR
    const text = await extractPdfText(file);
    return Response.json({ text });
  } catch (err) {
    console.error("[OCR] Error:", err);
    return Response.json({ error: "שגיאה בזיהוי טקסט" }, { status: 500 });
  }
}

/** OCR an image file using Google Cloud Vision API */
async function ocrImage(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  const body = {
    requests: [
      {
        image: { content: base64 },
        features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
        imageContext: { languageHints: ["he", "en"] },
      },
    ],
  };

  const res = await fetch(VISION_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[OCR] Vision API error:", res.status, errBody);
    throw new Error("Vision API request failed");
  }

  const data = await res.json();
  const annotation = data.responses?.[0]?.fullTextAnnotation;
  return annotation?.text?.trim() || "";
}

/** Extract text from a PDF using pdfjs-dist text extraction.
 *  For scanned/image PDFs, returns empty — client should send as image instead. */
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

  const textParts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim();
    textParts.push(pageText);
  }

  // Handle Hebrew UTF-8 BOM if present
  let fullText = textParts.join("\n\n");
  if (fullText.charCodeAt(0) === 0xfeff) {
    fullText = fullText.substring(1);
  }
  return fullText.trim();
}
