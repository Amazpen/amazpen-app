import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { ocrImage, extractPdfText, MAX_FILE_SIZE, ACCEPTED_IMAGE_TYPES } from "@/lib/ocr";

const lineItemSchema = z.object({
  description: z.string().nullable().describe("שם הפריט"),
  quantity: z.number().nullable().describe("כמות"),
  unit_price: z.number().nullable().describe("מחיר ליחידה"),
  total: z.number().nullable().describe("סה״כ לפריט"),
});

const invoiceSchema = z.object({
  supplier_name: z.string().nullable().describe("שם הספק/העסק שהנפיק את החשבונית"),
  document_number: z.string().nullable().describe("מספר חשבונית או תעודת משלוח"),
  document_date: z.string().nullable().describe("תאריך המסמך בפורמט YYYY-MM-DD"),
  subtotal: z.number().nullable().describe("סכום לפני מע״מ"),
  vat_amount: z.number().nullable().describe("סכום מע״מ"),
  total_amount: z.number().nullable().describe("סכום כולל מע״מ"),
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

  // Google Vision is needed for image OCR; for scanned PDFs we fall back to OpenAI Vision
  if (!process.env.GOOGLE_VISION_API_KEY && !process.env.OPENAI_API_KEY) {
    return Response.json({ error: "שירות OCR לא מוגדר" }, { status: 503 });
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
    return Response.json({ error: "הקובץ גדול מדי (מקסימום 10MB)" }, { status: 400 });
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
- סכום לפני מע״מ (subtotal)
- סכום מע״מ (vat_amount)
- סכום כולל מע״מ (total_amount)
- פריטים (line_items) - אם ישנם פריטים ברשימה עם כמות ומחיר

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
