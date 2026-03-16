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
  subtotal: z.number().nullable().describe("סכום לפני מע״מ (אחרי הנחה)"),
  vat_amount: z.number().nullable().describe("סכום מע״מ"),
  total_amount: z.number().nullable().describe("סכום כולל מע״מ (אחרי הנחה)"),
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

  const isImage = ACCEPTED_IMAGE_TYPES.includes(file.type);
  const isPdf = file.type === "application/pdf";

  if (!isImage && !isPdf) {
    return Response.json({ error: "סוג קובץ לא נתמך" }, { status: 400 });
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
      return Response.json({ error: "לא זוהה טקסט במסמך" }, { status: 422 });
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
- פריטים (line_items) - אם ישנם פריטים ברשימה עם כמות ומחיר

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

    return Response.json({
      supplier_name: extracted.supplier_name,
      document_number: extracted.document_number,
      document_date: extracted.document_date,
      discount_amount: extracted.discount_amount,
      discount_percentage: extracted.discount_percentage,
      subtotal: extracted.subtotal,
      vat_amount: extracted.vat_amount,
      total_amount: extracted.total_amount,
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
