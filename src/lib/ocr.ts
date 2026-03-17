import sharp from "sharp";

// Read API key dynamically (not at module load time) to ensure env vars are available
function getVisionApiKey(): string {
  return process.env.GOOGLE_VISION_API_KEY || "";
}
function getVisionApiUrl(): string {
  return `https://vision.googleapis.com/v1/images:annotate?key=${getVisionApiKey()}`;
}

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp",
  "image/tiff", "image/heic", "image/heif", "image/avif",
  "image/x-icon", "image/vnd.microsoft.icon",
];

/**
 * Normalize any image to a clean JPEG buffer that Google Vision can process.
 * Handles HEIC, AVIF, corrupt PNGs, wrong MIME types, etc.
 */
async function normalizeImageToJpeg(buffer: Buffer): Promise<Buffer> {
  try {
    const result = await sharp(buffer)
      .rotate() // auto-rotate based on EXIF
      .jpeg({ quality: 90 })
      .toBuffer();
    console.log(`[OCR] Normalized image: ${buffer.length} bytes → ${result.length} bytes JPEG`);
    return result;
  } catch (err) {
    console.warn("[OCR] sharp normalization failed, using original buffer:", err);
    return buffer;
  }
}

/** OCR an image file using Google Cloud Vision API */
export async function ocrImage(file: File): Promise<string> {
  if (!getVisionApiKey()) {
    throw new Error("GOOGLE_VISION_API_KEY is not configured");
  }

  console.log(`[OCR] ocrImage called: type=${file.type}, size=${file.size}, name=${file.name}`);
  const rawBuffer = Buffer.from(await file.arrayBuffer());

  // Normalize to JPEG — handles HEIC, AVIF, corrupt PNGs, wrong MIME types
  const jpegBuffer = await normalizeImageToJpeg(rawBuffer);
  const base64 = jpegBuffer.toString("base64");
  console.log(`[OCR] base64 length: ${base64.length}`);

  return callVisionOCR(base64);
}

/**
 * Extract text from a PDF.
 * Binary PDF → digital text extraction (pdfjs-dist) → text sent to OpenAI for structured extraction.
 * Scanned PDF (no digital text) → render to image with sharp/pdfjs, then Google Vision OCR.
 */
export async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();

  // Try digital text extraction first
  try {
    const text = await extractDigitalPdfText(arrayBuffer);
    console.log(`[OCR] Digital PDF text length: ${text.length}`);
    if (text.length >= 20) {
      return text;
    }
    console.log("[OCR] Too little digital text — treating as scanned PDF");
  } catch (err) {
    console.error("[OCR] Digital PDF extraction failed:", err);
  }

  // Fallback: render each PDF page to image, then OCR all pages
  if (!getVisionApiKey()) {
    throw new Error("GOOGLE_VISION_API_KEY is not configured");
  }

  try {
    // Use pdfjs to render each page to canvas → sharp → JPEG → Vision OCR
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "";

    const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
    const maxPages = Math.min(pdf.numPages, 10); // Limit to 10 pages
    console.log(`[OCR] Scanned PDF: ${pdf.numPages} pages, processing ${maxPages}`);

    const allTexts: string[] = [];

    for (let i = 1; i <= maxPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const scale = 2.0; // High res for OCR
        const viewport = page.getViewport({ scale });

        // Create a canvas-like buffer using sharp
        // Render page to raw pixel data
        // pdfjs needs a canvas — use a minimal node-canvas-like approach
        // We'll use the raw PDF page bytes approach instead:
        // Extract page as image by rendering the whole PDF at that page with sharp
        const pdfBuffer = Buffer.from(arrayBuffer);
        const jpegBuffer = await sharp(pdfBuffer, { density: 200, page: i - 1 })
          .jpeg({ quality: 90 })
          .toBuffer();
        console.log(`[OCR] Page ${i}: rendered to JPEG (${jpegBuffer.length} bytes)`);

        const base64 = jpegBuffer.toString("base64");
        const pageText = await callVisionOCR(base64);
        if (pageText) {
          allTexts.push(pageText);
        }
      } catch (pageErr) {
        console.warn(`[OCR] Failed to process page ${i}:`, pageErr);
      }
    }

    await pdf.destroy();

    const fullText = allTexts.join("\n\n");
    console.log(`[OCR] Scanned PDF total text length: ${fullText.length} from ${allTexts.length} pages`);
    return fullText;
  } catch (err) {
    console.warn("[OCR] Multi-page PDF render failed, trying single-page sharp:", err);
    // Fallback: try sharp on first page only
    try {
      const pdfBuffer = Buffer.from(arrayBuffer);
      const jpegBuffer = await sharp(pdfBuffer, { density: 200 })
        .jpeg({ quality: 90 })
        .toBuffer();
      console.log(`[OCR] Single-page fallback: ${jpegBuffer.length} bytes`);
      return callVisionOCR(jpegBuffer.toString("base64"));
    } catch (sharpErr) {
      console.warn("[OCR] sharp PDF render failed completely:", sharpErr);
      throw new Error("לא ניתן לעבד את קובץ ה-PDF");
    }
  }
}

/** Extract embedded text from a digital PDF using pdfjs-dist in Node.js (no worker needed) */
async function extractDigitalPdfText(arrayBuffer: ArrayBuffer): Promise<string> {
  // Use legacy build which works without a worker in Node.js
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // Disable worker — not needed/available in Node.js
  pdfjs.GlobalWorkerOptions.workerSrc = "";

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;

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

  await pdf.destroy();

  let fullText = textParts.join("\n").trim();
  // Strip BOM if present
  if (fullText.charCodeAt(0) === 0xfeff) fullText = fullText.substring(1);
  return fullText;
}

/** Call Google Vision DOCUMENT_TEXT_DETECTION on a base64-encoded file */
async function callVisionOCR(base64: string): Promise<string> {
  if (!getVisionApiKey()) {
    throw new Error("GOOGLE_VISION_API_KEY is not configured");
  }

  const body = {
    requests: [
      {
        image: { content: base64 },
        features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
        imageContext: { languageHints: ["he", "en"] },
      },
    ],
  };

  const res = await fetch(getVisionApiUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[OCR] Vision API error:", res.status, errBody.substring(0, 500));
    throw new Error(`Vision API request failed: ${res.status} — ${errBody.substring(0, 200)}`);
  }

  const data = await res.json();
  const response = data.responses?.[0];
  console.log("[OCR] Vision response keys:", Object.keys(response || {}));
  if (response?.error) {
    console.error("[OCR] Vision API returned error:", JSON.stringify(response.error));
    throw new Error(`Vision API error: ${response.error.message || "Unknown error"}`);
  }
  const annotation = response?.fullTextAnnotation;
  console.log("[OCR] Text length:", annotation?.text?.length ?? 0);
  return annotation?.text?.trim() || "";
}
