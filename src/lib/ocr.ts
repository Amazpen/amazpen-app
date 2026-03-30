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

// Google Vision API only supports these formats (no AVIF, no HEIC)
const VISION_SUPPORTED_MIMES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/bmp", "image/webp",
  "image/tiff", "image/x-icon", "image/vnd.microsoft.icon",
]);

/**
 * Check if a file's MIME type or extension requires conversion before Vision API.
 * AVIF, HEIC, HEIF are NOT supported by Google Vision — must be converted first.
 */
function needsConversionForVision(mimeType: string, fileName: string): boolean {
  if (VISION_SUPPORTED_MIMES.has(mimeType)) return false;
  // Check by extension as fallback
  const ext = fileName.toLowerCase().replace(/^.*\./, "");
  const visionExts = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif", "ico"]);
  return !visionExts.has(ext);
}

/**
 * Normalize any image to a clean JPEG buffer using Sharp.
 * Handles HEIC, AVIF, corrupt PNGs, wrong MIME types, etc.
 * Returns null if conversion fails.
 */
async function normalizeImageToJpeg(buffer: Buffer): Promise<Buffer | null> {
  try {
    const result = await sharp(buffer)
      .rotate() // auto-rotate based on EXIF
      .jpeg({ quality: 90 })
      .toBuffer();
    console.log(`[OCR] Normalized image: ${buffer.length} bytes → ${result.length} bytes JPEG`);
    return result;
  } catch (err) {
    console.error("[OCR] sharp normalization failed:", err);
    return null;
  }
}

/**
 * OCR an image file using Google Cloud Vision API.
 * For formats Vision doesn't support (AVIF, HEIC), Sharp must convert first.
 * Returns empty string on failure (never throws).
 */
export async function ocrImage(file: File): Promise<string> {
  console.log(`[OCR] ocrImage called: type=${file.type}, size=${file.size}, name=${file.name}`);
  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const requiresConversion = needsConversionForVision(file.type, file.name || "");

  // Step 1: Try Sharp normalization → Google Vision
  if (getVisionApiKey()) {
    const jpegBuffer = await normalizeImageToJpeg(rawBuffer);
    if (jpegBuffer) {
      try {
        const text = await callVisionOCR(jpegBuffer.toString("base64"));
        if (text.length > 0) {
          console.log(`[OCR] Google Vision succeeded (normalized): ${text.length} chars`);
          return text;
        }
      } catch (err) {
        console.warn("[OCR] Google Vision failed on normalized image:", err);
      }
    }

    // Step 2: If format is Vision-compatible, try raw buffer directly
    // (skip this for AVIF/HEIC — Vision doesn't support them at all)
    if (!requiresConversion) {
      try {
        const text = await callVisionOCR(rawBuffer.toString("base64"));
        if (text.length > 0) {
          console.log(`[OCR] Google Vision succeeded (raw buffer): ${text.length} chars`);
          return text;
        }
      } catch (err) {
        console.warn("[OCR] Google Vision failed on raw buffer:", err);
      }
    } else {
      console.log(`[OCR] Format ${file.type} not supported by Vision API, skipping raw buffer attempt`);
    }
  }

  // All attempts failed — return empty, let user fill manually
  console.log("[OCR] All OCR attempts failed, returning empty");
  return "";
}

/**
 * Extract text from a PDF.
 * 1. Try digital text extraction (pdfjs)
 * 2. Try rendering pages with Sharp → Google Vision
 * Returns empty string on failure (never throws).
 */
export async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();

  // Try 1: Digital text extraction (fast, no API calls)
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

  // Try 2: Render PDF pages with Sharp → Google Vision OCR
  if (getVisionApiKey()) {
    try {
      const text = await ocrPdfWithSharpAndVision(arrayBuffer);
      if (text.length > 0) {
        return text;
      }
    } catch (err) {
      console.warn("[OCR] Sharp+Vision PDF processing failed:", err);
    }
  }

  // All attempts failed — return empty, let user fill manually
  console.log("[OCR] All PDF OCR attempts failed, returning empty");
  return "";
}

/** Render PDF pages with Sharp and OCR with Google Vision */
async function ocrPdfWithSharpAndVision(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdfBuffer = Buffer.from(arrayBuffer);
  const allTexts: string[] = [];

  // Detect number of pages via sharp metadata
  let numPages = 1;
  try {
    const meta = await sharp(pdfBuffer, { density: 150 }).metadata();
    numPages = meta.pages || 1;
  } catch {
    // If metadata fails, try single page
  }

  const maxPages = Math.min(numPages, 10);
  console.log(`[OCR] Scanned PDF: ${numPages} pages, processing ${maxPages}`);

  for (let i = 0; i < maxPages; i++) {
    try {
      const jpegBuffer = await sharp(pdfBuffer, { density: 200, page: i })
        .jpeg({ quality: 90 })
        .toBuffer();
      console.log(`[OCR] Page ${i + 1}: rendered to JPEG (${jpegBuffer.length} bytes)`);

      const pageText = await callVisionOCR(jpegBuffer.toString("base64"));
      if (pageText) {
        allTexts.push(pageText);
      }
    } catch (pageErr) {
      console.warn(`[OCR] Failed to process page ${i + 1}:`, pageErr);
    }
  }

  const fullText = allTexts.join("\n\n");
  console.log(`[OCR] Scanned PDF total text: ${fullText.length} chars from ${allTexts.length} pages`);
  return fullText;
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

/** Call Google Vision DOCUMENT_TEXT_DETECTION on a base64-encoded image */
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
