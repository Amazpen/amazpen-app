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
    let documentInput: { type: "document_url"; documentUrl: string };
    let fileName = "uploaded-document";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file in form" }, { status: 400 });
      }
      fileName = file.name || fileName;
      const arrayBuffer = await file.arrayBuffer();
      const uploaded = await client.files.upload({
        file: { fileName, content: new Uint8Array(arrayBuffer) },
        purpose: "ocr",
      });
      const signed = await client.files.getSignedUrl({ fileId: uploaded.id });
      documentInput = { type: "document_url", documentUrl: signed.url };
    } else {
      const body = (await req.json()) as { file_url?: string };
      if (!body.file_url) {
        return NextResponse.json({ error: "file_url required" }, { status: 400 });
      }
      documentInput = { type: "document_url", documentUrl: body.file_url };
      fileName = body.file_url.split("/").pop() || fileName;
    }

    const result = (await client.ocr.process({
      model: "mistral-ocr-latest",
      document: documentInput,
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
