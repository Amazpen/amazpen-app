const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const VISION_API_URL = `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`;

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"];

/** OCR an image file using Google Cloud Vision API */
export async function ocrImage(file: File): Promise<string> {
  if (!GOOGLE_VISION_API_KEY) {
    throw new Error("GOOGLE_VISION_API_KEY is not configured");
  }

  console.log(`[OCR] ocrImage called: type=${file.type}, size=${file.size}`);
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  console.log(`[OCR] base64 length: ${base64.length}`);

  return callVisionOCR(base64);
}

/**
 * Extract text from a digital PDF using pdfjs-dist.
 * Note: scanned PDFs are handled client-side (converted to image before upload).
 */
export async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  try {
    const text = await extractDigitalPdfText(arrayBuffer);
    console.log(`[OCR] Digital PDF text length: ${text.length}`);
    return text;
  } catch (err) {
    console.error("[OCR] Digital PDF extraction failed:", err);
    return "";
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
  if (!GOOGLE_VISION_API_KEY) {
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
  const response = data.responses?.[0];
  console.log("[OCR] Vision response keys:", Object.keys(response || {}));
  if (response?.error) {
    console.error("[OCR] Vision API returned error:", JSON.stringify(response.error));
  }
  const annotation = response?.fullTextAnnotation;
  console.log("[OCR] Text length:", annotation?.text?.length ?? 0);
  return annotation?.text?.trim() || "";
}
