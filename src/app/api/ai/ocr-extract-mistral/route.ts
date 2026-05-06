/**
 * OCR Extract — Mistral pipeline
 *
 * Drop-in replacement for /api/ai/ocr-extract that swaps Google Vision for
 * Mistral Document AI in step 1. Step 2 (GPT-4.1-mini structured extraction)
 * is identical so the response contract matches `/api/ai/ocr-extract` exactly
 * — `/ocr` and `/ocr-business` both consume the same JSON shape.
 *
 * Pipeline:
 *   1. Mistral OCR → markdown (preserves table structure)
 *   2. GPT-4.1-mini → structured invoice schema
 *   3. Supplier matching against the business's supplier list
 */
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { Mistral } from "@mistralai/mistralai";
import sharp from "sharp";
import { MAX_FILE_SIZE, ACCEPTED_IMAGE_TYPES } from "@/lib/ocr";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Enhance an image for Mistral OCR. Applies in order:
 *  - EXIF auto-rotate (so phones holding the doc upside-down don't trip OCR).
 *  - Upscale to ≥2000px on the long edge (Mistral handles small images poorly
 *    on dense Hebrew tables).
 *  - Light contrast/brightness lift via linear() — pulls faint photocopies out
 *    of the gray haze without overexposing the page.
 *  - Sharpen with conservative sigma so edges of small Hebrew letters don't
 *    bleed into each other.
 *  - Encode as PNG so we don't lose detail to JPEG quantisation.
 */
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
    .linear(1.15, -8)            // contrast multiplier + tiny brightness offset
    .sharpen({ sigma: 0.8 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Heuristic: did Mistral actually read the items table?
 * Returns { ok: boolean; reason?: string } so the caller can decide whether
 * to retry with preprocessed image. We flag "ok=false" when the markdown
 * either has too few rows or shows the model repeating the same description
 * across many rows (a known failure mode on dense Hebrew invoices — Mistral
 * latches onto one item name and copies it down the entire table).
 */
function looksLikeOcrFailure(markdown: string, fileSizeBytes: number): { ok: boolean; reason?: string } {
  if (!markdown || markdown.length < 100) {
    return { ok: false, reason: "markdown too short" };
  }
  if (fileSizeBytes > 80_000 && markdown.length < 1500) {
    return { ok: false, reason: `markdown density too low (${markdown.length} chars on ${fileSizeBytes} bytes)` };
  }

  const lines = markdown.split(/\r?\n/);
  const tableLines = lines.filter(l => /^\s*\|.*\|.*\|/.test(l));
  if (tableLines.length === 0 && fileSizeBytes > 200_000) {
    return { ok: false, reason: "no markdown tables for a non-trivial file" };
  }

  // Repeated-header heuristic: same line appearing 3+ times = fragmented
  // tables with no data, classic Mistral failure on dense Hebrew layouts.
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

  // Numeric-row heuristic: invoice rows have qty/price/total cells. If the
  // table has many lines but none of them look numeric, columns are noise.
  let numericRows = 0;
  for (const line of tableLines) {
    const cells = line.split("|").map(c => c.trim()).filter(c => c !== "");
    const numericCells = cells.filter(c => /^\d{1,8}([.,]\d+)?$/.test(c.replace(/[\s₪]/g, "")));
    if (numericCells.length >= 2) numericRows += 1;
  }
  if (tableLines.length >= 6 && numericRows === 0) {
    return { ok: false, reason: `${tableLines.length} table lines but no numeric data rows` };
  }

  // Duplicate-description heuristic.
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

const lineItemSchema = z.object({
  description: z.string().nullable().describe("שם הפריט"),
  quantity: z.number().nullable().describe("כמות"),
  unit_price: z.number().nullable().describe("מחיר ליחידה לפני הנחה"),
  discount_amount: z.number().nullable().describe("סכום הנחה על הפריט"),
  total: z.number().nullable().describe("סה״כ לפריט אחרי הנחה"),
});

const invoiceSchema = z.object({
  supplier_name: z.string().nullable().describe("שם הספק/העסק שהנפיק את החשבונית"),
  document_number: z.string().nullable().describe("מספר חשבונית או תעודת משלוח"),
  document_date: z.string().nullable().describe("תאריך המסמך בפורמט YYYY-MM-DD"),
  discount_amount: z.number().nullable().describe("סכום הנחה כולל על המסמך בש״ח (לא אחוז). אם מופיע רק אחוז במסמך, חשב את הסכום בש״ח."),
  discount_percentage: z.number().nullable().describe("אחוז הנחה כולל על המסמך"),
  subtotal: z.number().nullable().describe("סכום לפני מע״מ ולפני הנחה כללית. אם זו חשבונית זיכוי, החזר ערך שלילי."),
  vat_amount: z.number().nullable().describe("סכום מע״מ הסופי במסמך. אם זו חשבונית זיכוי, החזר ערך שלילי."),
  total_amount: z.number().nullable().describe("סכום סופי כולל מע״מ אחרי הנחה. אם זו חשבונית זיכוי, החזר ערך שלילי."),
  is_credit_note: z.boolean().nullable().describe("true אם המסמך הוא חשבונית זיכוי / credit note / זיכוי — כלומר מסמך המחזיר כסף לקונה"),
  line_items: z.array(lineItemSchema).nullable().describe("פריטים בחשבונית"),
});

interface SupplierInfo {
  id: string;
  name: string;
}

interface MistralPage {
  index?: number;
  markdown?: string;
}
interface MistralOcrResponse {
  pages?: MistralPage[];
  model?: string;
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

/**
 * Run Mistral OCR on a File, returning concatenated markdown across all pages.
 * Mirrors the working pattern from `/api/ai/ocr-demo` — images go inline as
 * base64 data URLs (avoids the SDK's failing /v1/files JPEG roundtrip), PDFs
 * upload via direct REST calls then OCR by signed URL.
 *
 * `overrideImageBytes` lets the caller pass a preprocessed buffer (e.g. from
 * `preprocessImageForOcr`) instead of re-reading the File — used by the retry
 * pass when the first OCR returned a likely-failed extraction.
 */
async function mistralOcrFile(
  file: File,
  mistralKey: string,
  overrideImageBytes?: { bytes: Uint8Array; mime: string },
): Promise<string> {
  const client = new Mistral({ apiKey: mistralKey });
  const arrayBuffer = overrideImageBytes ? overrideImageBytes.bytes.buffer : await file.arrayBuffer();
  const bytes = overrideImageBytes ? overrideImageBytes.bytes : new Uint8Array(arrayBuffer);
  const fileName = file.name || "uploaded-document";
  const mime = overrideImageBytes ? overrideImageBytes.mime : (file.type || guessMimeFromName(fileName));
  const isImage = mime.startsWith("image/");

  let documentForOcr:
    | { type: "document_url"; documentUrl: string }
    | { type: "image_url"; imageUrl: string };

  if (isImage) {
    const base64 = Buffer.from(bytes).toString("base64");
    documentForOcr = {
      type: "image_url",
      imageUrl: `data:${mime};base64,${base64}`,
    };
  } else {
    const fd = new FormData();
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: mime || "application/pdf",
    });
    fd.append("purpose", "ocr");
    fd.append("file", blob, fileName);

    const uploadRes = await fetch("https://api.mistral.ai/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${mistralKey}` },
      body: fd,
    });
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Mistral file upload failed: ${uploadRes.status} ${errText}`);
    }
    const uploadJson = (await uploadRes.json()) as { id?: string };
    if (!uploadJson.id) throw new Error("Mistral upload returned no file id");

    const signedRes = await fetch(
      `https://api.mistral.ai/v1/files/${uploadJson.id}/url?expiry=24`,
      { headers: { Authorization: `Bearer ${mistralKey}` } },
    );
    if (!signedRes.ok) {
      const errText = await signedRes.text();
      throw new Error(`Mistral signed URL failed: ${signedRes.status} ${errText}`);
    }
    const signedJson = (await signedRes.json()) as { url?: string };
    if (!signedJson.url) throw new Error("Mistral signed URL response missing url");

    documentForOcr = { type: "document_url", documentUrl: signedJson.url };
  }

  const result = (await client.ocr.process({
    model: "mistral-ocr-latest",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document: documentForOcr as any,
    includeImageBase64: false,
  })) as MistralOcrResponse;

  const pages = result.pages || [];
  return pages
    .map((p, i) => {
      const md = p.markdown || "";
      return pages.length > 1 ? `--- עמוד ${i + 1} ---\n${md}` : md;
    })
    .join("\n\n");
}

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "שירות AI לא מוגדר" }, { status: 503 });
  }
  if (!process.env.MISTRAL_API_KEY) {
    return Response.json({ error: "שירות Mistral לא מוגדר (MISTRAL_API_KEY)" }, { status: 503 });
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
  const suppliersJson = formData.get("suppliers") as string | null;

  if (!file) {
    return Response.json({ error: "חסר קובץ" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: "הקובץ גדול מדי (מקסימום 50MB)" }, { status: 400 });
  }

  const fileName = file.name?.toLowerCase() || "";
  const imageExtensions = /\.(jpg|jpeg|png|webp|heic|heif|avif|gif|bmp|tiff|tif|ico)$/i;
  const isImage = ACCEPTED_IMAGE_TYPES.includes(file.type) ||
    file.type.startsWith("image/") ||
    imageExtensions.test(fileName);
  const isPdf = file.type === "application/pdf" ||
    (file.type === "application/octet-stream" && fileName.endsWith(".pdf")) ||
    fileName.endsWith(".pdf");

  if (!isImage && !isPdf) {
    return Response.json(
      { error: `סוג קובץ לא נתמך: ${file.type || "לא ידוע"} (${fileName})` },
      { status: 400 },
    );
  }

  console.log(`[OCR-Extract-Mistral] File: type=${file.type}, size=${file.size}, isImage=${isImage}, isPdf=${isPdf}`);

  try {
    // Step 1: Mistral OCR → markdown.
    // First pass uses the original file as-is. If validation flags the result
    // as a likely failure (too few rows, duplicate descriptions, etc.), we
    // run a second pass with an upscaled + contrast-enhanced version of the
    // image. Whichever pass yields more line-item-looking content wins.
    let rawText = await mistralOcrFile(file, process.env.MISTRAL_API_KEY);
    console.log(`[OCR-Extract-Mistral] First pass markdown length: ${rawText?.length ?? 0}`);

    const firstPassCheck = looksLikeOcrFailure(rawText || "", file.size);
    if (!firstPassCheck.ok && isImage) {
      console.log(`[OCR-Extract-Mistral] First pass flagged: ${firstPassCheck.reason}. Retrying with preprocessed image...`);
      try {
        const arr = await file.arrayBuffer();
        const enhanced = await preprocessImageForOcr(Buffer.from(arr));
        const retryText = await mistralOcrFile(
          file,
          process.env.MISTRAL_API_KEY,
          { bytes: new Uint8Array(enhanced), mime: "image/png" },
        );
        console.log(`[OCR-Extract-Mistral] Retry markdown length: ${retryText?.length ?? 0}`);
        const retryCheck = looksLikeOcrFailure(retryText || "", file.size);
        // Pick the better of the two passes — prefer the one that PASSED
        // validation; if both passed/failed, prefer the longer markdown
        // (more content extracted).
        if (retryCheck.ok && !firstPassCheck.ok) {
          rawText = retryText;
        } else if (retryText && retryText.length > (rawText?.length ?? 0) * 1.2) {
          rawText = retryText;
        }
      } catch (preErr) {
        console.warn(`[OCR-Extract-Mistral] Preprocess/retry failed:`, preErr);
        // Keep the first pass result.
      }
    }

    if (!rawText || rawText.length < 5) {
      return Response.json({
        supplier_name: null,
        document_number: null,
        document_date: null,
        discount_amount: null,
        discount_percentage: null,
        subtotal: null,
        vat_amount: null,
        total_amount: null,
        line_items: null,
        matched_supplier_id: undefined,
        raw_text: rawText || "",
        ocr_failed: true,
      });
    }

    // Step 2: Structured extraction (identical prompt to /api/ai/ocr-extract)
    const { object: extracted } = await generateObject({
      model: openai("gpt-4.1-mini"),
      schema: invoiceSchema,
      prompt: `אתה מערכת חילוץ נתונים מחשבוניות ותעודות משלוח בעברית.
חלץ את הנתונים הבאים מהטקסט של המסמך:
- שם הספק (supplier_name)
- מספר חשבונית/תעודה (document_number)
- תאריך המסמך (document_date) בפורמט YYYY-MM-DD
- הנחה על המסמך (discount_amount) - סכום ההנחה הכולל בש״ח אם מופיע. **חובה לחפש** הנחות במסמך — זה שדה קריטי.
- אחוז הנחה (discount_percentage) - אם מופיע אחוז הנחה
- סכום לפני מע״מ (subtotal) - הסכום **לפני** הנחה כללית, לפני מע״מ. אם המסמך מציג רק "סה״כ אחרי הנחה", חשב: subtotal = (סה״כ אחרי הנחה לפני מע״מ) + discount_amount
- סכום מע״מ (vat_amount) - הסכום הסופי של המע״מ במסמך
- סכום כולל מע״מ (total_amount) - הסכום הסופי שהלקוח משלם, אחרי הנחה ואחרי מע״מ
- חשבונית זיכוי (is_credit_note) - האם המסמך הוא חשבונית זיכוי / זיכוי / credit note / הודעת זיכוי
- פריטים (line_items) - אם ישנם פריטים ברשימה עם כמות ומחיר

חשבונית זיכוי (זהירות — זהה רק חשבוניות שהן *באמת* זיכוי):
- is_credit_note=true רק אם הכותרת הראשית של המסמך היא "חשבונית זיכוי" / "הודעת זיכוי" / "credit note" / "זיכוי".
- חשוב: חשבוניות רבות מכילות את המילה "זיכוי" בהקשרים אחרים (למשל: "שובר הודעת זיכוי" שמודפס בתחתית חשבון, תרשים עם מקרא "זיכוי/חיוב", וכד'). במקרים כאלה is_credit_note=false.
- סימן נוסף לזיכוי: הסכום הכולל מוצג כשלילי (-150) או בסוגריים ((150)) בגוף החשבונית. אם גם הסכום חיובי וגם אין כותרת "חשבונית זיכוי" — זו חשבונית רגילה.
- כאשר is_credit_note=true: subtotal, vat_amount, total_amount חייבים להיות מספרים שליליים.
- כאשר is_credit_note=false: החזר את הסכומים כפי שהם חיוביים במסמך, גם אם המילה "זיכוי" מופיעה איפשהו.

חשוב מאוד: הנחות!
מילים שמסמנות הנחה כללית על המסמך: "הנחה", "הנחה כללית", "הנחה מסחרית", "הנחה למזומן", "הנחת לקוח", "ניכוי", "הנחה %", "Discount", "סה״כ הנחה".
- אם יש הנחה על כל המסמך (גם בש״ח וגם באחוזים), חלץ את discount_amount בש״ח. אם מופיע רק אחוז (למשל "הנחה 5%"), חשב את הסכום: subtotal_לפני_הנחה * אחוז / 100.
- אם מופיע גם אחוז וגם סכום, מלא את שניהם (discount_amount בש״ח, discount_percentage באחוזים).
- subtotal הוא הסכום **לפני** ההנחה הכללית — כלומר סך כל הפריטים. total_amount הוא הסכום **הסופי** במסמך אחרי הנחה ואחרי מע״מ.
- אם החשבונית מציגה רק "סך אחרי הנחה" ולא "סך לפני הנחה", חשב: subtotal = total_after_discount + discount_amount.
- אם יש הנחה ספציפית על פריט (בעמודות הפריטים), הכנס discount_amount בפריט עצמו. ה-total של הפריט חייב להיות אחרי ההנחה. זה לא משפיע על discount_amount הכללי של המסמך.
- אם unit_price * quantity שונה מ-total של אותה שורה, כנראה יש הנחה על הפריט — חשב את ההפרש כ-discount_amount של הפריט.
- אם המסמך **לא** מציג הנחה כללית באף מקום, השאר את discount_amount ו-discount_percentage ריקים (null).

חשוב מאוד: הקצאת quantity ו-unit_price (טקסט מ-PDF עברי לפעמים מבולגן)!
טקסט שחולץ מ-PDF בעברית מגיע לפעמים בסדר עמודות לא צפוי, במיוחד כששמות הפריטים גולשים לשורה חדשה. לכל שורה שיש בה qty, price ו-total:
- ודא ש-quantity * unit_price ≈ total (עד הפרש קטן בגלל הנחה). אם המכפלה לא מסתדרת, חילופים בין quantity ו-unit_price הם הסבר סביר — בחר את ההקצאה שמתאימה ל-total.
- במקרה של ספק: quantity הוא לרוב מספר שלם או חצי-שלם (1, 2, 5, 10, 20, 100, 120 וכד'), בעוד unit_price כולל בדרך כלל אגורות (1.20, 2.20, 64.10, 145.29). אם אחד הערכים נראה כמו "כמות עגולה" והשני כמו "מחיר עם אגורות" — הקצה בהתאם.
- שורות הוצאות מזון/סיטונאות עם פריטי קמעונאות זולים: כמות גדולה (100-200) ומחיר נמוך (1-3 ש"ח) זה תקין. כמות 1.2 עם מחיר 120 זו טעות.
- חשבוניות עם עמודות הנחה כפולות ("הנחה %" + "סה\"כ הנחה" בש"ח) שכיחות במסמכי וטרינריה/חנויות. במקרה זה: unit_price הוא המחיר ה*מקורי* לפני הנחה, discount_amount הוא הסכום בש"ח (לא האחוז), ו-total הוא אחרי ההנחה. דוגמה: כמות=1, מחיר=252, הנחה 24% (60.48 ש"ח), סה"כ=191.52 → quantity=1, unit_price=252, discount_amount=60.48, total=191.52.

חשוב מאוד: שורות גולשות (פריט אחד שתופס יותר משורה אחת)!
- פריט אחד יכול לגלוש לשתי שורות או יותר — לדוגמה: שם הפריט בשורה אחת ("נטורה דיאט חתול בוגר סטרילייז עוף 8 ק"ג מופחת דגנים"), והמק"ט/ברקוד בשורה הבאה ("8436596671300").
- שורת המשך מזוהה לפי כך שהיא חסרה את השדות המספריים העיקריים: אין בה כמות + מחיר + סה"כ. לרוב יש בה רק טקסט, או רק מק"ט/ברקוד.
- במקרה כזה: **אחד את השורות לפריט אחד**. הוסף את הטקסט/מק"ט מהשורה הגולשת ל-description של הפריט, ואל תיצור פריט נפרד עם quantity=null או total=null.
- אם פריט נראה ריק (אין quantity, אין unit_price, אין total — רק טקסט/מק"ט) — זה כמעט תמיד שורת המשך של הפריט הקודם, לא פריט עצמאי. **אל תכלול אותו ברשימת line_items.**
- ברקוד/מק"ט שמופיע בשורה נפרדת מתחת לתיאור — צרף אותו לתיאור הפריט שמעליו (למשל: "נטורה דיאט חתול בוגר סטרילייז עוף 8 ק"ג 8436596671300").

חשוב מאוד: בחירת ה-description (שם הפריט) — קריטי!
לחשבונית יש בדרך כלל **כמה עמודות מזהה** עבור כל פריט: בר-קוד, מק"ט/קוד פנימי, ושם פריט. החזר ב-description אך ורק את **התיאור המילולי** של הפריט — לא קוד.

- description חייב להיות טקסט מילולי שמתאר את הפריט בעברית או אנגלית (למשל "גבי לבנה 9% (2ק)", "ירקות מעורב", "סולת קמח רגיל").
- description לעולם לא יהיה רק מספר/קוד (למשל "557763505", "517014478", "5904316130121", "393", "112", "274"). אם השדה היחיד הזמין הוא מספר — השאר את description ריק (null).
- עמודות שיכולות להכיל תיאור (לפי הסדר העדפה): "תיאור פריט" / "שם פריט" / "פירוט" / "Description" / "Item Name". בחר תמיד את העמודה עם הטקסט המילולי.
- עמודות לדלג עליהן (אלה לא תיאור): "מס פריט" / "מס' פריט" / "קוד פריט" / "מק"ט" / "בר קוד" / "Barcode" / "SKU" / "מספר" / "#".
- אם יש כמה עמודות עם טקסט מילולי, בחר את הארוכה ביותר (היא לרוב התיאור המלא; הקצרה היא לרוב קטגוריה).
- במסמכים שבהם יש שורה אחת בה מופיעים גם קוד וגם תיאור (למשל "393 גבי לבנה 9% (2ק)"), חלץ רק את הטקסט המילולי ל-description, לא את הקוד.

בדיקה לפני החזרה: ודא שאף description **אינו מספר בלבד**. אם יש כזה — תקן או השאר null.

הטקסט מגיע ממנוע OCR שמשמר טבלאות במבנה Markdown — שורות שמתחילות ב-| הן שורות טבלה. השתמש בזה כדי לזהות פריטים נכון. שורת טבלה ללא ערכים מספריים (רק טקסט/מק"ט) היא בדרך כלל המשך של השורה הקודמת.

אם שדה לא מופיע במסמך, השמט אותו.
עבור תאריכים בעברית (למשל 17/02/2026) המר לפורמט YYYY-MM-DD.
עבור סכומים, החזר מספרים בלבד (ללא סימן ₪ או פסיקים).

טקסט המסמך:
${rawText}`,
    });

    // Step 3: Supplier matching
    let matchedSupplierId: string | undefined;
    if (extracted.supplier_name && suppliersJson) {
      try {
        const suppliers: SupplierInfo[] = JSON.parse(suppliersJson);
        const extractedName = extracted.supplier_name.trim();
        const matched = suppliers.find(
          (s) => s.name.includes(extractedName) || extractedName.includes(s.name),
        );
        if (matched) {
          matchedSupplierId = matched.id;
        }
      } catch {
        // Ignore parse errors
      }
    }

    const isCreditNote = extracted.is_credit_note === true;
    const neg = (v: number | null | undefined): number | null => {
      if (v === null || v === undefined) return null;
      return v === 0 ? 0 : -Math.abs(v);
    };
    const finalSubtotal = isCreditNote ? neg(extracted.subtotal) : extracted.subtotal;
    const finalVat = isCreditNote ? neg(extracted.vat_amount) : extracted.vat_amount;
    const finalTotal = isCreditNote ? neg(extracted.total_amount) : extracted.total_amount;

    // Sanitize line-item description: when the model picked a column that
    // contains only an item code/barcode/SKU instead of the actual product
    // name, the description ends up either as a bare number string ("393",
    // "5904316130121") or a short prefix + number ("ש"ד 90361", "מק"ט
    // 12041", "SKU 200554"). In both cases the actual product name is
    // missing — null is better than misleading text.
    const SHORT_CODE_PREFIXES = [
      "ש\"ד", "ש'ד", "שד",
      "מק\"ט", "מקט", "מק'ט",
      "מס", "מס'", 'מס׳',
      "ק.פ", "ק.פ.",
      "פריט",
      "SKU", "ID", "REF", "Ref", "ref",
      "Item", "item",
      "No", "no", "No.", "no.", "Nr", "nr",
      "#",
    ];
    const isNumericOnlyDescription = (desc: string | null | undefined): boolean => {
      if (!desc) return false;
      const trimmed = desc.trim();
      if (!trimmed) return false;
      // Pure digits + separators — SKUs, barcodes, row numbers.
      if (/^[\d\s\-./]+$/.test(trimmed)) return true;
      // Short-code prefix + number — "ש"ד 90361", "מק"ט 12041", "SKU 200554",
      // "Item No 42". Strip any matched prefix and check what's left.
      let remainder = trimmed;
      for (const prefix of SHORT_CODE_PREFIXES) {
        if (remainder.startsWith(prefix)) {
          remainder = remainder.slice(prefix.length).trim();
          break;
        }
      }
      // After stripping the prefix, if what remains is only digits/separators
      // → this row had no real description, just an identifier.
      if (remainder !== trimmed && /^[\d\s\-./]+$/.test(remainder)) return true;
      return false;
    };
    const stripLeadingCode = (desc: string | null | undefined): string | null => {
      if (!desc) return desc ?? null;
      // "393 גבי לבנה 9%" → "גבי לבנה 9%". Only strips a code at the very
      // start (followed by whitespace) to avoid mangling product names that
      // contain numbers (e.g. "9%", "2ק").
      const trimmed = desc.trim();
      const match = trimmed.match(/^[\d\-./]{2,}\s+(.+)$/);
      if (match && /[א-תA-Za-z]/.test(match[1])) {
        return match[1].trim();
      }
      return trimmed;
    };

    // Merge line continuation rows into the previous item. Some PDFs put the
    // SKU/barcode (and sometimes long descriptions) on a separate row right
    // below the main item row, so OCR sees them as two rows. The model is
    // instructed to merge them, but we belt-and-suspender here by collapsing
    // any row that has no quantity AND no total into the description of the
    // previous one — those rows are almost always continuation lines.
    const mergedLineItems = (() => {
      const items = extracted.line_items;
      if (!items || items.length === 0) return items;
      const out: typeof items = [];
      for (const item of items) {
        const hasNumbers = (item.quantity != null && item.quantity !== 0)
          || (item.total != null && item.total !== 0)
          || (item.unit_price != null && item.unit_price !== 0);
        if (!hasNumbers && out.length > 0) {
          // Continuation row — append its description/sku to the previous item.
          const prev = out[out.length - 1];
          const extra = (item.description || "").trim();
          if (extra) {
            prev.description = prev.description
              ? `${prev.description} ${extra}`.trim()
              : extra;
          }
          continue;
        }
        // Sanitize description: drop pure-number descriptions, strip leading codes
        if (isNumericOnlyDescription(item.description)) {
          item.description = null;
        } else {
          item.description = stripLeadingCode(item.description);
        }
        out.push(item);
      }
      return out;
    })();

    return Response.json({
      supplier_name: extracted.supplier_name,
      document_number: extracted.document_number,
      document_date: extracted.document_date,
      discount_amount: extracted.discount_amount,
      discount_percentage: extracted.discount_percentage,
      subtotal: finalSubtotal,
      vat_amount: finalVat,
      total_amount: finalTotal,
      is_credit_note: isCreditNote,
      line_items: mergedLineItems,
      matched_supplier_id: matchedSupplierId,
      raw_text: rawText,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[OCR-Extract-Mistral] Error:", message, stack);
    return Response.json(
      { error: "שגיאה בזיהוי נתונים מהמסמך", detail: message },
      { status: 500 },
    );
  }
}
