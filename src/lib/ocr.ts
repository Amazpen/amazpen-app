const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const VISION_API_URL = `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`;

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/** OCR an image file using Google Cloud Vision API */
export async function ocrImage(file: File): Promise<string> {
  if (!GOOGLE_VISION_API_KEY) {
    throw new Error("GOOGLE_VISION_API_KEY is not configured");
  }

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

/** Extract text from a PDF using Google Cloud Vision API (supports both digital and scanned PDFs). */
export async function extractPdfText(file: File): Promise<string> {
  if (!GOOGLE_VISION_API_KEY) {
    throw new Error("GOOGLE_VISION_API_KEY is not configured");
  }

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
    console.error("[OCR] Vision API error (PDF):", res.status, errBody);
    throw new Error("Vision API request failed");
  }

  const data = await res.json();
  const annotation = data.responses?.[0]?.fullTextAnnotation;
  return annotation?.text?.trim() || "";
}
