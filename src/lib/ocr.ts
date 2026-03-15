// Read API key dynamically (not at module load time) to ensure env vars are available
function getVisionApiKey(): string {
  return process.env.GOOGLE_VISION_API_KEY || "";
}
function getVisionApiUrl(): string {
  return `https://vision.googleapis.com/v1/images:annotate?key=${getVisionApiKey()}`;
}

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"];

/** OCR an image file using Google Cloud Vision API */
export async function ocrImage(file: File): Promise<string> {
  if (!getVisionApiKey()) {
    throw new Error("GOOGLE_VISION_API_KEY is not configured");
  }

  console.log(`[OCR] ocrImage called: type=${file.type}, size=${file.size}`);
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  console.log(`[OCR] base64 length: ${base64.length}`);

  return callVisionOCR(base64);
}

/**
 * Extract text from a PDF.
 * Binary PDF → digital text extraction (pdfjs-dist) → text sent to OpenAI for structured extraction.
 * Scanned PDF (no digital text) → Google Vision OCR on the PDF image.
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

  // Fallback: use Google Vision to OCR the scanned PDF
  if (!getVisionApiKey()) {
    throw new Error("GOOGLE_VISION_API_KEY is not configured");
  }

  const base64 = Buffer.from(arrayBuffer).toString("base64");
  console.log(`[OCR] Sending scanned PDF to Google Vision, base64 length: ${base64.length}`);
  return callVisionOCR(base64);
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
  }
  const annotation = response?.fullTextAnnotation;
  console.log("[OCR] Text length:", annotation?.text?.length ?? 0);
  return annotation?.text?.trim() || "";
}
