/**
 * OCR Demo Endpoint - Pure Mistral Document AI test
 *
 * Standalone endpoint for evaluating Mistral OCR quality vs the production
 * pipeline. Does NOT touch any production tables, queues, or workflows.
 *
 * Accepts: multipart upload OR { file_url } JSON
 * Returns: { pages, totalChars, totalTables, processingMs, raw }
 */
import { NextRequest, NextResponse } from "next/server";
import { Mistral } from "@mistralai/mistralai";

export const runtime = "nodejs";
export const maxDuration = 300;

const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

interface MistralPage {
  index?: number;
  markdown?: string;
  images?: unknown[];
  dimensions?: { width?: number; height?: number };
}

interface MistralOcrResponse {
  pages?: MistralPage[];
  model?: string;
  usageInfo?: { pagesProcessed?: number; docSizeBytes?: number };
}

function guessMimeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
    heic: "image/heic",
  };
  return map[ext] || "application/octet-stream";
}

export async function POST(req: NextRequest) {
  if (!MISTRAL_KEY) {
    return NextResponse.json(
      { error: "MISTRAL_API_KEY not configured on server" },
      { status: 500 },
    );
  }

  const t0 = Date.now();
  const client = new Mistral({ apiKey: MISTRAL_KEY });

  try {
    const contentType = req.headers.get("content-type") || "";
    let fileName = "uploaded-document";

    let documentForOcr:
      | { type: "document_url"; documentUrl: string }
      | { type: "image_url"; imageUrl: string };

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file in form" }, { status: 400 });
      }
      fileName = file.name || fileName;
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const mime = file.type || guessMimeFromName(fileName);
      const isImage = mime.startsWith("image/");

      if (isImage) {
        // Inline image as base64 data URL — Mistral OCR accepts this directly
        // and avoids the file-upload roundtrip that was failing on JPEGs.
        const base64 = Buffer.from(bytes).toString("base64");
        documentForOcr = {
          type: "image_url",
          imageUrl: `data:${mime};base64,${base64}`,
        };
      } else {
        // PDFs / other docs go through the upload + signed-url flow.
        // SDK requires a real Blob for `file`, not a plain object.
        const blob = new Blob([bytes as unknown as BlobPart], { type: mime || "application/pdf" });
        const uploaded = await client.files.upload({
          file: new File([blob], fileName, { type: mime || "application/pdf" }),
          purpose: "ocr",
        });
        const signed = await client.files.getSignedUrl({ fileId: uploaded.id });
        documentForOcr = { type: "document_url", documentUrl: signed.url };
      }
    } else {
      const body = (await req.json()) as { file_url?: string };
      if (!body.file_url) {
        return NextResponse.json({ error: "file_url required" }, { status: 400 });
      }
      const url = body.file_url.trim();
      const isImageUrl = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(url);
      documentForOcr = isImageUrl
        ? { type: "image_url", imageUrl: url }
        : { type: "document_url", documentUrl: url };
      fileName = url.split("/").pop() || fileName;
    }

    const result = (await client.ocr.process({
      model: "mistral-ocr-latest",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      document: documentForOcr as any,
      includeImageBase64: false,
    })) as MistralOcrResponse;

    const pages = result.pages || [];
    const summary = pages.map((p, i) => {
      const md = p.markdown || "";
      const tableRows = (md.match(/^\s*\|.*\|.*\|\s*$/gm) || []).length;
      return {
        page: i + 1,
        chars: md.length,
        tableRows,
        markdown: md,
      };
    });

    return NextResponse.json({
      ok: true,
      fileName,
      processingMs: Date.now() - t0,
      pageCount: pages.length,
      totalChars: summary.reduce((s, p) => s + p.chars, 0),
      totalTableRows: summary.reduce((s, p) => s + p.tableRows, 0),
      pages: summary,
      model: result.model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: message, processingMs: Date.now() - t0 },
      { status: 500 },
    );
  }
}
