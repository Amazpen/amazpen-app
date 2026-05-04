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
import { MAX_FILE_SIZE, ACCEPTED_IMAGE_TYPES } from "@/lib/ocr";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  discount_amount: z.number().nullable().describe("סכום הנחה כולל על המסמך"),
  discount_percentage: z.number().nullable().describe("אחוז הנחה כולל על המסמך"),
  subtotal: z.number().nullable().describe("סכום לפני מע״מ (אחרי הנחה). אם זו חשבונית זיכוי, החזר ערך שלילי."),
  vat_amount: z.number().nullable().describe("סכום מע״מ. אם זו חשבונית זיכוי, החזר ערך שלילי."),
  total_amount: z.number().nullable().describe("סכום כולל מע״מ (אחרי הנחה). אם זו חשבונית זיכוי, החזר ערך שלילי."),
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
 */
async function mistralOcrFile(file: File, mistralKey: string): Promise<string> {
  const client = new Mistral({ apiKey: mistralKey });
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const fileName = file.name || "uploaded-document";
  const mime = file.type || guessMimeFromName(fileName);
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
    // Step 1: Mistral OCR → markdown
    const rawText = await mistralOcrFile(file, process.env.MISTRAL_API_KEY);
    console.log(`[OCR-Extract-Mistral] Raw markdown length: ${rawText?.length ?? 0}`);

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
- הנחה על המסמך (discount_amount) - סכום ההנחה הכולל אם מופיע
- אחוז הנחה (discount_percentage) - אם מופיע אחוז הנחה
- סכום לפני מע״מ (subtotal) - הסכום אחרי הנחה, לפני מע״מ
- סכום מע״מ (vat_amount)
- סכום כולל מע״מ (total_amount) - הסכום הסופי אחרי הנחה ומע״מ
- חשבונית זיכוי (is_credit_note) - האם המסמך הוא חשבונית זיכוי / זיכוי / credit note / הודעת זיכוי
- פריטים (line_items) - אם ישנם פריטים ברשימה עם כמות ומחיר

חשבונית זיכוי (זהירות — זהה רק חשבוניות שהן *באמת* זיכוי):
- is_credit_note=true רק אם הכותרת הראשית של המסמך היא "חשבונית זיכוי" / "הודעת זיכוי" / "credit note" / "זיכוי".
- חשוב: חשבוניות רבות מכילות את המילה "זיכוי" בהקשרים אחרים (למשל: "שובר הודעת זיכוי" שמודפס בתחתית חשבון, תרשים עם מקרא "זיכוי/חיוב", וכד'). במקרים כאלה is_credit_note=false.
- סימן נוסף לזיכוי: הסכום הכולל מוצג כשלילי (-150) או בסוגריים ((150)) בגוף החשבונית. אם גם הסכום חיובי וגם אין כותרת "חשבונית זיכוי" — זו חשבונית רגילה.
- כאשר is_credit_note=true: subtotal, vat_amount, total_amount חייבים להיות מספרים שליליים.
- כאשר is_credit_note=false: החזר את הסכומים כפי שהם חיוביים במסמך, גם אם המילה "זיכוי" מופיעה איפשהו.

חשוב מאוד: הנחות!
- אם יש הנחה על כל המסמך (כגון "הנחה 5%", "הנחה ₪100"), חלץ את discount_amount ו/או discount_percentage
- subtotal ו-total_amount חייבים לשקף את הסכום אחרי ההנחה
- אם יש הנחה ספציפית על פריט, הכנס discount_amount בפריט עצמו. ה-total של הפריט חייב להיות אחרי ההנחה
- אם unit_price * quantity שונה מ-total, כנראה יש הנחה — חשב את ההפרש כ-discount_amount

חשוב מאוד: הקצאת quantity ו-unit_price (טקסט מ-PDF עברי לפעמים מבולגן)!
טקסט שחולץ מ-PDF בעברית מגיע לפעמים בסדר עמודות לא צפוי, במיוחד כששמות הפריטים גולשים לשורה חדשה. לכל שורה שיש בה qty, price ו-total:
- ודא ש-quantity * unit_price ≈ total (עד הפרש קטן בגלל הנחה). אם המכפלה לא מסתדרת, חילופים בין quantity ו-unit_price הם הסבר סביר — בחר את ההקצאה שמתאימה ל-total.
- במקרה של ספק: quantity הוא לרוב מספר שלם או חצי-שלם (1, 2, 5, 10, 20, 100, 120 וכד'), בעוד unit_price כולל בדרך כלל אגורות (1.20, 2.20, 64.10, 145.29). אם אחד הערכים נראה כמו "כמות עגולה" והשני כמו "מחיר עם אגורות" — הקצה בהתאם.
- שורות הוצאות מזון/סיטונאות עם פריטי קמעונאות זולים: כמות גדולה (100-200) ומחיר נמוך (1-3 ש"ח) זה תקין. כמות 1.2 עם מחיר 120 זו טעות.
- חשבוניות עם עמודות הנחה כפולות ("הנחה %" + "סה\"כ הנחה" בש"ח) שכיחות במסמכי וטרינריה/חנויות. במקרה זה: unit_price הוא המחיר ה*מקורי* לפני הנחה, discount_amount הוא הסכום בש"ח (לא האחוז), ו-total הוא אחרי ההנחה. דוגמה: כמות=1, מחיר=252, הנחה 24% (60.48 ש"ח), סה"כ=191.52 → quantity=1, unit_price=252, discount_amount=60.48, total=191.52.

הטקסט מגיע ממנוע OCR שמשמר טבלאות במבנה Markdown — שורות שמתחילות ב-| הן שורות טבלה. השתמש בזה כדי לזהות פריטים נכון.

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
      line_items: extracted.line_items,
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
