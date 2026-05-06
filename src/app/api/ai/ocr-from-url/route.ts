/**
 * OCR from URL — server-side Mistral wrapper for n8n.
 *
 * The n8n WhatsApp/Telegram/Gmail workflow used to call the Mistral OCR API
 * directly from inside a Code node. That worked, but it bypassed the image
 * preprocessing + retry logic in `/api/ai/ocr-extract-mistral`, so dense
 * Hebrew invoices that need a second pass got stuck with garbled output.
 *
 * This endpoint accepts an image URL (e.g. a public Supabase Storage URL),
 * runs the same preprocess-on-failure pipeline, and returns Mistral's
 * markdown so n8n can drop it straight into ocr_extracted_data.mistral_markdown.
 *
 * Auth: shared CRON_SECRET via `x-internal-secret` header. The n8n instance
 *       already holds this in its env so it's a low-risk shared bearer.
 *
 * Request:  POST { "image_url": "https://...", "is_pdf"?: boolean }
 * Response: { "markdown": string, "ocr_method": "mistral_ocr",
 *             "pages_processed": number, "preprocessed_retry_used": boolean }
 */
import { NextRequest } from "next/server";
import { Mistral } from "@mistralai/mistralai";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 300;

interface MistralPage { index?: number; markdown?: string }
interface MistralOcrResponse { pages?: MistralPage[]; model?: string }

// --- Same heuristics as /api/ai/ocr-extract-mistral ---

function looksLikeOcrFailure(markdown: string, fileSizeBytes: number): { ok: boolean; reason?: string } {
  if (!markdown || markdown.length < 100) {
    return { ok: false, reason: "markdown too short" };
  }

  // Density heuristic: a 100KB+ image of a real invoice produces at least
  // ~2KB of markdown (text per item × items). If we got <1500 chars on a
  // file >80KB, Mistral almost certainly only read the header and gave up.
  if (fileSizeBytes > 80_000 && markdown.length < 1500) {
    return { ok: false, reason: `markdown density too low (${markdown.length} chars on ${fileSizeBytes} bytes)` };
  }

  const lines = markdown.split(/\r?\n/);
  const tableLines = lines.filter(l => /^\s*\|.*\|.*\|/.test(l));
  if (tableLines.length === 0 && fileSizeBytes > 200_000) {
    return { ok: false, reason: "no markdown tables for a non-trivial file" };
  }

  // Repeated-header heuristic: when Mistral can't read the body it sometimes
  // fragments the page into many tiny tables, each with the same header row
  // and no actual data. If the SAME normalised line appears 3+ times in the
  // markdown, the table parsing failed even if individual cells differ.
  const lineCounts = new Map<string, number>();
  for (const line of tableLines) {
    const norm = line.replace(/\s+/g, " ").trim();
    if (norm.length < 8) continue;
    lineCounts.set(norm, (lineCounts.get(norm) || 0) + 1);
  }
  for (const [line, count] of lineCounts) {
    if (count >= 3) {
      return { ok: false, reason: `header repeated ${count}× (${line.slice(0, 60)})` };
    }
  }

  // Numeric-row heuristic: a real invoice items table has rows with multiple
  // numeric cells (qty, price, total). Count rows that have ≥2 separate
  // numeric cells. If we have lots of table lines but none look like data,
  // the columns are noise.
  let numericRows = 0;
  for (const line of tableLines) {
    const cells = line.split("|").map(c => c.trim()).filter(c => c !== "");
    const numericCells = cells.filter(c => /^\d{1,8}([.,]\d+)?$/.test(c.replace(/[\s₪]/g, "")));
    if (numericCells.length >= 2) numericRows += 1;
  }
  if (tableLines.length >= 6 && numericRows === 0) {
    return { ok: false, reason: `${tableLines.length} table lines but no numeric data rows` };
  }

  // Duplicate-description heuristic (original failure mode): Mistral
  // latching onto one item name and copying it down the column.
  const descs: string[] = [];
  for (const line of tableLines) {
    const cells = line.split("|").map(c => c.trim()).filter(c => c !== "");
    if (cells.length < 2) continue;
    const desc = cells
      .filter(c => /[א-תA-Za-z]/.test(c))
      .sort((a, b) => b.length - a.length)[0];
    if (desc && desc.length >= 4) descs.push(desc);
  }
  if (descs.length >= 4) {
    const uniqueRatio = new Set(descs).size / descs.length;
    if (uniqueRatio < 0.4) {
      return { ok: false, reason: `duplicate descriptions (${descs.length} rows, ${new Set(descs).size} unique)` };
    }
  }

  return { ok: true };
}

async function preprocessImageForOcr(input: Buffer): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const longestEdge = Math.max(meta.width || 0, meta.height || 0);
  const targetLongest = 2400;
  const scale = longestEdge > 0 && longestEdge < targetLongest
    ? targetLongest / longestEdge
    : 1;
  let pipeline = sharp(input).rotate();
  if (scale > 1.05) {
    const newWidth = Math.round((meta.width || 0) * scale);
    if (newWidth > 0) pipeline = pipeline.resize({ width: newWidth, kernel: "lanczos3" });
  }
  return await pipeline
    .linear(1.15, -8)
    .sharpen({ sigma: 0.8 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function runMistralOcr(
  client: Mistral,
  doc:
    | { type: "image_url"; imageUrl: string }
    | { type: "document_url"; documentUrl: string },
): Promise<{ markdown: string; pages: number }> {
  const result = (await client.ocr.process({
    model: "mistral-ocr-latest",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document: doc as any,
    includeImageBase64: false,
  })) as MistralOcrResponse;
  const pages = result.pages || [];
  const markdown = pages
    .map((p, i) => {
      const md = p.markdown || "";
      return pages.length > 1 ? `--- עמוד ${i + 1} ---\n${md}` : md;
    })
    .join("\n\n");
  return { markdown, pages: pages.length };
}

export async function POST(request: NextRequest) {
  if (!process.env.MISTRAL_API_KEY) {
    return Response.json({ error: "MISTRAL_API_KEY not configured" }, { status: 503 });
  }

  // Shared-secret auth — n8n knows the CRON_SECRET via env.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = request.headers.get("x-internal-secret") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (provided !== secret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let body: { image_url?: string; is_pdf?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const imageUrl = body.image_url;
  if (!imageUrl || typeof imageUrl !== "string") {
    return Response.json({ error: "image_url required" }, { status: 400 });
  }

  const isPdf = body.is_pdf === true || /\.pdf(\?|$)/i.test(imageUrl);
  const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

  try {
    let markdown = "";
    let pages = 0;
    let preprocessedRetryUsed = false;

    if (isPdf) {
      // PDFs: send URL straight through. We don't preprocess PDFs (Mistral
      // handles them natively and sharp can't easily rewrite them).
      const r = await runMistralOcr(client, { type: "document_url", documentUrl: imageUrl });
      markdown = r.markdown;
      pages = r.pages;
    } else {
      // First pass: original URL.
      const first = await runMistralOcr(client, { type: "image_url", imageUrl });
      markdown = first.markdown;
      pages = first.pages;

      // Estimate file size for the failure heuristic. Use a HEAD when we
      // don't have the bytes yet — falls back to 0 which is fine.
      let fileSize = 0;
      try {
        const head = await fetch(imageUrl, { method: "HEAD" });
        const cl = head.headers.get("content-length");
        if (cl) fileSize = parseInt(cl, 10) || 0;
      } catch { /* ignore */ }

      const check = looksLikeOcrFailure(markdown, fileSize);
      if (!check.ok) {
        console.log(`[OCR-from-URL] First pass flagged: ${check.reason}. Preprocessing + retry...`);
        try {
          const imgRes = await fetch(imageUrl);
          if (!imgRes.ok) throw new Error(`fetch image failed: ${imgRes.status}`);
          const arr = await imgRes.arrayBuffer();
          const enhanced = await preprocessImageForOcr(Buffer.from(arr));
          const dataUrl = `data:image/png;base64,${enhanced.toString("base64")}`;
          const second = await runMistralOcr(client, { type: "image_url", imageUrl: dataUrl });
          const retryCheck = looksLikeOcrFailure(second.markdown, enhanced.length);
          // Pick the better of the two passes.
          if ((retryCheck.ok && !check.ok) || second.markdown.length > markdown.length * 1.2) {
            markdown = second.markdown;
            pages = second.pages;
            preprocessedRetryUsed = true;
          }
        } catch (preErr) {
          console.warn(`[OCR-from-URL] Preprocess/retry failed:`, preErr);
        }
      }
    }

    return Response.json({
      markdown,
      ocr_method: "mistral_ocr",
      pages_processed: pages,
      preprocessed_retry_used: preprocessedRetryUsed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[OCR-from-URL] Error:", message);
    return Response.json({ error: "OCR failed", detail: message }, { status: 500 });
  }
}
