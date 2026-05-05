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

    // Credit note detection.
    // Only trust the model's explicit `is_credit_note` flag. Earlier we tried
    // to add keyword fallbacks ("זיכוי" anywhere in the text), but regular
    // invoices frequently contain the word in a benign context — e.g. a
    // tear-off receipt printed below the invoice labelled "הודעת זיכוי", or
    // a credit-card chart legend that says "זיכוי" — which caused perfectly
    // normal invoices to be flipped negative. Rely on the model; it reads
    // context, not just keywords.
    const isCreditNote = extracted.is_credit_note === true;
    const neg = (v: number | null | undefined): number | null => {
      if (v === null || v === undefined) return null;
      return v === 0 ? 0 : -Math.abs(v);
    };
    const finalSubtotal = isCreditNote ? neg(extracted.subtotal) : extracted.subtotal;
    const finalVat = isCreditNote ? neg(extracted.vat_amount) : extracted.vat_amount;
    const finalTotal = isCreditNote ? neg(extracted.total_amount) : extracted.total_amount;

    // Sanitize line-item description: drop pure-number SKU/codes that the
    // model sometimes picks instead of the actual product name.
    const isNumericOnlyDescription = (desc: string | null | undefined): boolean => {
      if (!desc) return false;
      const trimmed = desc.trim();
      if (!trimmed) return false;
      return /^[\d\s\-./]+$/.test(trimmed);
    };
    const stripLeadingCode = (desc: string | null | undefined): string | null => {
      if (!desc) return desc ?? null;
      const trimmed = desc.trim();
      const match = trimmed.match(/^[\d\-./]{2,}\s+(.+)$/);
      if (match && /[א-תA-Za-z]/.test(match[1])) {
        return match[1].trim();
      }
      return trimmed;
    };

    // Merge continuation rows (no qty / no total → previous item's SKU or
    // wrapped description). Belt-and-suspenders for the prompt instruction.
    const mergedLineItems = (() => {
      const items = extracted.line_items;
      if (!items || items.length === 0) return items;
      const out: typeof items = [];
      for (const item of items) {
        const hasNumbers = (item.quantity != null && item.quantity !== 0)
          || (item.total != null && item.total !== 0)
          || (item.unit_price != null && item.unit_price !== 0);
        if (!hasNumbers && out.length > 0) {
          const prev = out[out.length - 1];
          const extra = (item.description || "").trim();
          if (extra) {
            prev.description = prev.description
              ? `${prev.description} ${extra}`.trim()
              : extra;
          }
          continue;
        }
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
    console.error("[OCR-Extract] Error:", message, stack);
    return Response.json({ error: "שגיאה בזיהוי נתונים מהמסמך", detail: message }, { status: 500 });
  }
}
