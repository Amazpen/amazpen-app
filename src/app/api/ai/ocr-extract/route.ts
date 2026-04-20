import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { ocrImage, extractPdfText, MAX_FILE_SIZE, ACCEPTED_IMAGE_TYPES } from "@/lib/ocr";

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

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "שירות AI לא מוגדר" }, { status: 503 });
  }

  // Google Vision is needed for image OCR and scanned PDFs
  if (!process.env.GOOGLE_VISION_API_KEY) {
    return Response.json({ error: "שירות OCR לא מוגדר (GOOGLE_VISION_API_KEY)" }, { status: 503 });
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

  // Detect file type by MIME type and also by file extension (some devices send wrong MIME)
  const fileName = file.name?.toLowerCase() || "";
  const imageExtensions = /\.(jpg|jpeg|png|webp|heic|heif|avif|gif|bmp|tiff|tif|ico)$/i;
  const isImage = ACCEPTED_IMAGE_TYPES.includes(file.type) ||
    file.type.startsWith("image/") ||
    imageExtensions.test(fileName);
  const isPdf = file.type === "application/pdf" ||
    (file.type === "application/octet-stream" && fileName.endsWith(".pdf")) ||
    fileName.endsWith(".pdf");

  // Accept any image type — sharp will normalize it before sending to Vision
  if (!isImage && !isPdf) {
    return Response.json({ error: `סוג קובץ לא נתמך: ${file.type || "לא ידוע"} (${fileName})` }, { status: 400 });
  }

  console.log(`[OCR-Extract] File: type=${file.type}, size=${file.size}, isImage=${isImage}, isPdf=${isPdf}`);

  try {
    // Step 1: Extract raw text via OCR
    let rawText: string;
    if (isImage) {
      rawText = await ocrImage(file);
    } else {
      rawText = await extractPdfText(file);
    }
    console.log(`[OCR-Extract] Raw text length: ${rawText?.length ?? 0}`);

    if (!rawText || rawText.length < 5) {
      // Return empty result instead of error — let user fill form manually
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

    // Step 2: Extract structured data using AI
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

חשבונית זיכוי (חובה!):
- אם במסמך מופיע במפורש "חשבונית זיכוי", "זיכוי", "credit note", "הודעת זיכוי" — is_credit_note=true
- אם הסכומים במסמך כתובים עם סימן מינוס או בסוגריים (למשל (150) או -150) — is_credit_note=true
- כאשר is_credit_note=true: subtotal, vat_amount, total_amount חייבים להיות מספרים שליליים (למשל -150.00)
- אם במסמך כתוב "150 זיכוי" אבל הסכום חיובי, עדיין החזר שליליים.

חשוב מאוד: הנחות!
- אם יש הנחה על כל המסמך (כגון "הנחה 5%", "הנחה ₪100"), חלץ את discount_amount ו/או discount_percentage
- subtotal ו-total_amount חייבים לשקף את הסכום אחרי ההנחה
- אם יש הנחה ספציפית על פריט, הכנס discount_amount בפריט עצמו. ה-total של הפריט חייב להיות אחרי ההנחה
- אם unit_price * quantity שונה מ-total, כנראה יש הנחה — חשב את ההפרש כ-discount_amount

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
          (s) => s.name.includes(extractedName) || extractedName.includes(s.name)
        );
        if (matched) {
          matchedSupplierId = matched.id;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Credit note: enforce negative sign server-side, regardless of whether the model
    // returned positive or negative numbers. Also auto-detect by keyword if the model
    // didn't flag it (belt-and-suspenders for older prompts / edge cases).
    const textLower = rawText.toLowerCase();
    const keywordCredit = /(חשבונית\s*זיכוי|^|[^א-ת])זיכוי([^א-ת]|$)|credit\s*note/.test(textLower)
      || textLower.includes("הודעת זיכוי");
    const isCreditNote = extracted.is_credit_note === true || keywordCredit;
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
    console.error("[OCR-Extract] Error:", message, stack);
    return Response.json({ error: "שגיאה בזיהוי נתונים מהמסמך", detail: message }, { status: 500 });
  }
}
