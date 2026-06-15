import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { streamText, tool, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { getIncomeMetrics } from "@/lib/metrics/income";
import { getExpenseMetrics } from "@/lib/metrics/expenses";
import { getSuppliersPayable, getSupplierDetail } from "@/lib/metrics/suppliers";
import {
  getPaymentsSummary,
  getUpcomingPayments,
  getPaymentHistory,
  getRecentPayments,
} from "@/lib/metrics/payments";
import { getCashflowForecast } from "@/lib/metrics/cashflow";
import { getProfitLossReport } from "@/lib/metrics/pnl";
import { getGoalsVsActual } from "@/lib/metrics/goals";
import { getDailyEntry, getDailyEntries } from "@/lib/metrics/dailyEntries";
import { getAnnualMetric } from "@/lib/metrics/annual";

// ---------------------------------------------------------------------------
// NEW, SEPARATE chat backend for the "דדי" agent (/agent page).
// Kept fully independent from the legacy /api/ai/chat route. Reuses the same
// ai_chat_sessions / ai_chat_messages tables so chat history keeps working.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per user) — same pattern as /api/ai/chat
// ---------------------------------------------------------------------------
const RATE_LIMIT = 20;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Month range (first → last day). Defaults to the server's current month;
 *  pass month (1-12) and/or year to target a specific month. */
function monthRange(month?: number, year?: number) {
  const now = new Date();
  const y = year ?? now.getFullYear();
  const m = (month ?? now.getMonth() + 1) - 1; // 0-based
  return {
    start: new Date(y, m, 1),
    end: new Date(y, m + 1, 0),
  };
}

/** Zod shape for an optional month/year on time-bound tools. */
const PERIOD_PARAMS = {
  month: z.number().int().min(1).max(12).optional().describe("חודש 1-12 (ברירת מחדל: החודש הנוכחי)"),
  year: z.number().int().min(2020).max(2100).optional().describe("שנה (ברירת מחדל: השנה הנוכחית)"),
};

// ---------------------------------------------------------------------------
// Chat history persistence helper (same tables/logic as /api/ai/chat)
// ---------------------------------------------------------------------------
async function saveMessageToDB(
  supabaseUrl: string,
  serviceRoleKey: string,
  sId: string,
  role: "user" | "assistant",
  content: string,
  chartData?: unknown
) {
  if (!sId) return;
  try {
    const adminSb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await adminSb.from("ai_chat_messages").insert({
      session_id: sId,
      role,
      content,
      chart_data: chartData || null,
    });
    await adminSb
      .from("ai_chat_sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sId);
  } catch (err) {
    console.error("[Agent Chat] Failed to save message:", err);
  }
}

// ---------------------------------------------------------------------------
// System prompt — דדי, an analyst for ONE business
// ---------------------------------------------------------------------------
function buildSystemPrompt(opts: {
  userName: string;
  businessName: string;
  businessId: string;
}): string {
  const { userName, businessName, businessId } = opts;
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  return `אתה "דדי" — אנליסט עסקי של המצפן, יועץ אישי לעסק אחד בלבד.
התאריך היום: ${today}.
המשתמש: ${userName || "משתמש"}.
העסק: "${businessName}" (ID: ${businessId}).

## כללי יסוד — חובה מוחלט
- **אתה ממוקד אך ורק בניהול העסק** (הכנסות, הוצאות, ספקים, תשלומים, תזרים, רווחיות, יעדים). לשאלה שאינה קשורה לעסק — מתכונים, ידע כללי, מזג אוויר, חדשות, בידור וכו' — **אל תענה עליה לגופה**. סרב בנימוס במשפט קצר והחזר את המשתמש לנושאי העסק (למשל: "אני כאן בשביל העסק שלך - אשמח לעזור עם הכנסות, הוצאות, ספקים, תזרים או רווחיות").
- ענה **תמיד בעברית**, בצורה תמציתית וברורה.
- אתה עונה אך ורק על בסיס **נתונים אמיתיים** שמתקבלים מהכלים. **אסור להמציא מספרים.**
- אם דרוש מספר כלשהו (הכנסות, צפי, יעד, אחוז, השוואה) — **חובה לקרוא לכלי כדי לקבל אותו**. לעולם אל תנחש ואל תשער.
- השתמש **בדיוק** במספרים שהכלי החזיר. אל תעגל באופן שמשנה את המשמעות ואל תשנה ערכים.
- הצג סכומי כסף עם הסימן ₪ (לדוגמה: ₪12,500).
- **"הכנסות" / "מחזור" / "מכירות"** = דווח כברירת מחדל את **הסכום הכולל (totalIncome, כולל מע"מ)** — לא את הסכום ללא מע"מ. השתמש בסכום ללא מע"מ (incomeBeforeVat) רק אם המשתמש ביקש זאת במפורש או בהקשר חישובי אחוזים/רווח-הפסד.
- אם אין נתונים זמינים לשאלה — אמור זאת בכנות במקום להמציא.
- אל תחשוף שמות כלים פנימיים למשתמש — דבר בעברית טבעית.
- **חודש ספציפי:** אם המשתמש שואל על חודש/שנה מסוימים (למשל "מאי", "ינואר 2025") — העבר את הפרמטרים month (1-12) ו-year לכלי. חשב את המספר לפי שם החודש ולפי התאריך של היום. אם לא צוין חודש — הכלי מחזיר את החודש הנוכחי. הקפד שהתשובה תתייחס לחודש שהמשתמש באמת שאל עליו.

## כלים זמינים
- **getIncome** — הכנסות החודש: סך, צפי חודשי, יעד והפרש, שינוי מול חודש/שנה קודמים, פילוח לפי מקור (במקום/במשלוח).
- **getExpenses** — הוצאות החודש: עלות עובדים, עלות מכר, הוצאות שוטפות, מוצרים מנוהלים — סכום, % מהפדיון, יעד והפרש.
- **getSuppliersPayable** — יתרות פתוחות לכל הספקים: סך פתוח לתשלום + רשימת ספקים עם נותר לתשלום ו-% מהכנסות.
- **getSupplierDetail** — פרטי ספק יחיד לפי שם: קניות, תשלומים, יתרה, פילוח חודשי, חשבוניות.
- **getPaymentsSummary** — תשלומים שיצאו החודש לפי אמצעי תשלום.
- **getUpcomingPayments** — צפי תשלומים עתידיים מקובץ לפי חודש ותאריך פירעון.
- **getPaymentHistory** — היסטוריית תשלומים לפי חודש.
- **getRecentPayments** — התשלומים האחרונים ששולמו.
- **getCashflowForecast** — תחזית תזרים מזומנים: יתרת פתיחה, צפי הכנסות/הוצאות, מתי נכנסים למינוס, פירוט יומי.
- **getProfitLossReport** — דוח רווח והפסד (חודשי/שנתי): תוצאה כוללת, הכנסות והוצאות יעד מול בפועל.
- **getGoalsVsActual** — יעד מול בפועל (kpi / operating / goods).
- **getDailyEntries** — רשימת הרישומים היומיים של החודש (יום-יום: קופה, עלות עובדים, שעות) + סך וממוצע. לשאלות "תן לי יום-יום", "היום הכי חזק", "ממוצע יומי".
- **getAnnualMetric** — תצוגה שנתית חודש-חודש של מדד ('נתוני עבר', בפועל): sales / labor / cogs / operating / source:<שם> / product:<שם>. לשאלות "מכירות כל השנה חודש-חודש", "החודש הכי חזק בשנה", "מגמה שנתית".

## הזנת ועריכת נתונים (כתיבה)
- **getDailyEntry** — קורא רישום יומי קיים לתאריך (id + ערכים נוכחיים). קרא לו לפני עדכון יום קיים.
- **proposeAction** — להצעת פעולה. הוא יציג למשתמש **כרטיס אישור**, והשינוי יישמר **רק אחרי שהמשתמש יאשר**. אתה לא כותב ישירות. אחרי שהצעת — בקש מהמשתמש בקצרה לאשר את הכרטיס.
  - ⚠️ **חובה:** אם אתה אומר שהכנת/מכין רישום/הוצאה/תשלום — אתה **חייב לקרוא ל-proposeAction בפועל** באותו תור. **אסור** לכתוב שהכנת טופס/הצעה בלי לקרוא לכלי. בלי קריאה לכלי — לא נוצר שום כרטיס והמשתמש לא יכול לאשר. **אסור לטעון שהפעולה בוצעה/נשמרה/הוזנה** — היא עדיין *לא* נשמרה עד שהמשתמש ילחץ "אישור". נסח כהצעה הממתינה לאישור (למשל "הכנתי הצעה, אנא אשר את הכרטיס כדי לשמור").
  - **רישום יומי - יצירה:** actionType='daily_entry' + dailyEntryData (mode='create'). אם חסר תאריך — היום.
  - **רישום יומי - עריכה:** (1) קרא ל-getDailyEntry לאותו תאריך, (2) proposeAction actionType='daily_entry' עם dailyEntryData.mode='update', ה-entryId, והערכים החדשים — **שמר ערכים קיימים בשדות שלא שונו**.
  - **הוצאה (חשבונית):** actionType='expense' + expenseData (שם ספק, תאריך, subtotal, vat_amount, total_amount). אם ניתן רק סכום כולל מע"מ — פצל לפי 18% (₪117 כולל = ₪100 לפני + ₪17 מע"מ), אלא אם המשתמש ציין פטור/אחוז אחר. הכלי מחפש את הספק לפי שם; **אם הספק לא קיים — הכרטיס יראה אזהרה, אז ציין למשתמש שצריך להוסיף את הספק קודם** (במסך הספקים).
  - **תשלום:** actionType='payment' + paymentData (שם ספק, total_amount, payment_method, payment_date). מַפֵּה את אמצעי התשלום לערך הנכון (מזומן=cash, צ'ק=check, העברה בנקאית=bank_transfer, אשראי=credit_card, ביט=bit, פייבוקס=paybox, אחר=other). **שים לב:** אישור התשלום **מעביר לטופס התשלומים עם מילוי-מראש** (לא נשמר ישירות) — המשתמש משלים ושומר שם. הסבר זאת בקצרה.
- הערה: הזנת/עריכת יום תומכת ב: תאריך, קופה, עלות עובדים, שעות, הנחות, הערות (לא פילוח במקום/משלוח). הזנת הוצאה תומכת בספק קיים + סכומים.

בחר את הכלי המתאים לשאלה. מותר לקרוא לכמה כלים אם צריך. אם אין כלי שמתאים לשאלה — אמור שאין לך את הנתון, אל תמציא.`;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  // 1. Validate environment
  if (!process.env.OPENAI_API_KEY) {
    return jsonResponse({ error: "שירות AI לא מוגדר" }, 503);
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "שירות מסד נתונים לא מוגדר" }, 503);
  }

  // 2. Parse request body (UIMessage[] from useChat + extra body fields)
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "בקשה לא תקינה" }, 400);
  }

  const businessId = typeof body.businessId === "string" ? body.businessId : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const ocrContext = typeof body.ocrContext === "string" ? body.ocrContext : "";

  // KEY DIFFERENCE: דדי works on exactly ONE business.
  if (!businessId) {
    return jsonResponse({ error: "לא נבחר עסק" }, 400);
  }
  if (!UUID_REGEX.test(businessId)) {
    return jsonResponse({ error: "מזהה עסק לא תקין" }, 400);
  }

  // Extract messages from the AI SDK UIMessage format
  const uiMessages: UIMessage[] = Array.isArray(body.messages) ? body.messages : [];
  if (uiMessages.length === 0) {
    return jsonResponse({ error: "חסרים נתונים — אין הודעות בבקשה" }, 400);
  }

  // Get the last user message text
  const lastMsg = uiMessages[uiMessages.length - 1];
  const lastUserText =
    lastMsg?.role === "user"
      ? lastMsg.parts
          ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("") || ""
      : "";

  if (!lastUserText) {
    return jsonResponse({ error: "חסרים נתונים — אין טקסט בהודעה האחרונה" }, 400);
  }
  if (lastUserText.length > 2000) {
    return jsonResponse({ error: "ההודעה ארוכה מדי (מקסימום 2000 תווים)" }, 400);
  }

  // 3. Authenticate user
  const serverSupabase = await createServerClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();

  if (!user) {
    return jsonResponse({ error: "לא מחובר" }, 401);
  }

  // 4. Rate limiting
  if (!checkRateLimit(user.id)) {
    return jsonResponse({ error: "יותר מדי בקשות. נסה שוב בעוד דקה." }, 429);
  }

  // 5. User info + business name
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const userName = profile?.full_name || "";

  const { data: biz } = await serverSupabase
    .from("businesses")
    .select("name")
    .eq("id", businessId)
    .maybeSingle();
  const businessName = biz?.name || "";

  // 6. Inject OCR context into the last user message (hidden from chat UI, visible to AI)
  if (ocrContext) {
    const lastUiMsg = uiMessages[uiMessages.length - 1];
    if (lastUiMsg?.role === "user" && lastUiMsg.parts) {
      lastUiMsg.parts.push({
        type: "text" as const,
        text: `\n\n<ocr-document>\n${ocrContext}\n</ocr-document>`,
      });
    }
  }

  // 7. Load conversation history from DB if frontend sent only the latest message
  if (sessionId && uiMessages.length <= 1) {
    try {
      const historySb = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: dbMessages } = await historySb
        .from("ai_chat_messages")
        .select("role, content, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });

      if (dbMessages && dbMessages.length > 0) {
        const historyUIMessages: UIMessage[] = dbMessages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m, idx) => ({
            id: `db-${idx}`,
            role: m.role as "user" | "assistant",
            parts: [{ type: "text" as const, text: m.content || "" }],
            createdAt: new Date(m.created_at),
          }));

        if (historyUIMessages.length > 0) {
          const currentMessage = uiMessages[uiMessages.length - 1];
          const lastHistoryMsg = historyUIMessages[historyUIMessages.length - 1];
          const currentText =
            currentMessage?.parts
              ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join("") || "";

          if (
            lastHistoryMsg?.role === "user" &&
            lastHistoryMsg.parts?.[0]?.type === "text" &&
            (lastHistoryMsg.parts[0] as { type: "text"; text: string }).text === currentText
          ) {
            uiMessages.splice(0, uiMessages.length, ...historyUIMessages);
          } else {
            uiMessages.splice(0, uiMessages.length, ...historyUIMessages, currentMessage);
          }
          console.log(
            `[Agent Chat] Loaded ${historyUIMessages.length} messages from DB for session ${sessionId}`
          );
        }
      }
    } catch (err) {
      console.error("[Agent Chat] Failed to load conversation history:", err);
      // Continue with the messages we have — don't fail the request
    }
  }

  // Convert UIMessages to model messages
  const modelMessages = await convertToModelMessages(uiMessages);

  // 8. Save user message to DB (display text only, not OCR)
  if (sessionId) {
    saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "user", lastUserText);
  }

  // 9. Build tools — ONE tool for now: getIncome (current month, single business)
  const tools = {
    getIncome: tool({
      description:
        "מחזיר את מדדי ההכנסות של העסק: סך ההכנסות, צפי חודשי (monthlyPace), יעד ההכנסות (revenueTarget) וההפרש ממנו (targetDiffPct / targetDiffIls), שינוי מול חודש קודם (momChangePct) ומול שנה שעברה (yoyChangePct), ופירוט לפי מקור הכנסה (bySource). ברירת מחדל: החודש הנוכחי. לשאלה על חודש אחר — העבר month (1-12) ו-year לפי התאריך של היום.",
      inputSchema: z.object(PERIOD_PARAMS),
      execute: async ({ month, year }) => {
        console.log(`[Agent Tool] getIncome: ${businessId} ${month ?? ""}/${year ?? ""}`);
        try {
          const agentSb = await createServerClient();
          return await getIncomeMetrics(agentSb, businessId, monthRange(month, year));
        } catch (err) {
          console.error("[Agent Tool] getIncome error:", err);
          return { error: err instanceof Error ? err.message : "שגיאה בשליפת נתוני הכנסות" };
        }
      },
    }),

    getExpenses: tool({
      description:
        "מחזיר את מדדי ההוצאות של העסק: עלות עובדים (laborCost), עלות מכר (cogs), הוצאות שוטפות (operating) ומוצרים מנוהלים (managedProducts) — לכל אחד סכום, אחוז מהפדיון, יעד והפרש מהיעד. ברירת מחדל: החודש הנוכחי. לחודש אחר — העבר month/year.",
      inputSchema: z.object(PERIOD_PARAMS),
      execute: async ({ month, year }) => {
        console.log(`[Agent Tool] getExpenses: ${businessId} ${month ?? ""}/${year ?? ""}`);
        try {
          const agentSb = await createServerClient();
          return await getExpenseMetrics(agentSb, businessId, monthRange(month, year));
        } catch (err) {
          console.error("[Agent Tool] getExpenses error:", err);
          return { error: err instanceof Error ? err.message : "שגיאה בשליפת נתוני הוצאות" };
        }
      },
    }),

    getSuppliersPayable: tool({
      description:
        "מחזיר את היתרות הפתוחות לתשלום לכל הספקים: סך הכל פתוח לתשלום (totalOpen), פילוח לפי סוג הוצאה, ורשימת ספקים עם הסכום שנותר לתשלום ו-% מהכנסות. השתמש בו לשאלות כמו 'כמה אני חייב לספקים?', 'מי הספקים הכי גדולים?'.",
      inputSchema: z.object({}),
      execute: async () => {
        console.log(`[Agent Tool] getSuppliersPayable: ${businessId}`);
        try {
          const agentSb = await createServerClient();
          return await getSuppliersPayable(agentSb, businessId);
        } catch (err) {
          console.error("[Agent Tool] getSuppliersPayable error:", err);
          return { error: err instanceof Error ? err.message : "שגיאה בשליפת יתרות ספקים" };
        }
      },
    }),

    getSupplierDetail: tool({
      description:
        "מחזיר פרטים מלאים על ספק יחיד לפי שמו: סוג הוצאה, קטגוריה, סכום חודשי קבוע, סך קניות, סך תשלומים, יתרה לתשלום, פילוח חודשי ורשימת חשבוניות. השתמש בו כששואלים על ספק ספציפי בשם (למשל 'כמה אני חייב לשכירות?').",
      inputSchema: z.object({
        supplierName: z.string().describe("שם הספק לחיפוש"),
      }),
      execute: async ({ supplierName }) => {
        console.log(`[Agent Tool] getSupplierDetail: ${businessId} / ${supplierName}`);
        try {
          const agentSb = await createServerClient();
          const detail = await getSupplierDetail(agentSb, businessId, supplierName);
          return detail ?? { error: `לא נמצא ספק בשם "${supplierName}"` };
        } catch (err) {
          console.error("[Agent Tool] getSupplierDetail error:", err);
          return { error: err instanceof Error ? err.message : "שגיאה בשליפת פרטי ספק" };
        }
      },
    }),

    getPaymentsSummary: tool({
      description:
        "מחזיר סיכום התשלומים שיצאו: סך ששולם (totalPaid) ופילוח לפי אמצעי תשלום (צ'ק / כרטיס אשראי / העברה בנקאית / מזומן) עם סכום ו-% מהפדיון. ברירת מחדל: החודש הנוכחי. לחודש אחר — העבר month/year.",
      inputSchema: z.object(PERIOD_PARAMS),
      execute: async ({ month, year }) => {
        console.log(`[Agent Tool] getPaymentsSummary: ${businessId} ${month ?? ""}/${year ?? ""}`);
        try {
          const agentSb = await createServerClient();
          return await getPaymentsSummary(agentSb, businessId, monthRange(month, year));
        } catch (err) {
          console.error("[Agent Tool] getPaymentsSummary error:", err);
          return { error: err instanceof Error ? err.message : "שגיאה בשליפת סיכום תשלומים" };
        }
      },
    }),

    getUpcomingPayments: tool({
      description:
        "מחזיר תחזית תשלומים עתידיים: סך פתוח לתשלום (totalOpen) מקובץ לפי חודש ולפי תאריך פירעון. לשאלות כמו 'כמה אני צריך לשלם החודש/בקרוב?', 'מה התשלומים הקרובים?'.",
      inputSchema: z.object({}),
      execute: async () => {
        console.log(`[Agent Tool] getUpcomingPayments: ${businessId}`);
        try {
          const agentSb = await createServerClient();
          return await getUpcomingPayments(agentSb, businessId);
        } catch (err) {
          console.error("[Agent Tool] getUpcomingPayments error:", err);
          return { error: err instanceof Error ? err.message : "שגיאה בשליפת צפי תשלומים" };
        }
      },
    }),

    getPaymentHistory: tool({
      description:
        "מחזיר היסטוריית תשלומים שבוצעו, מקובצת לפי חודש (סך ששולם בכל חודש). לשאלות כמו 'כמה שילמתי בחודש X?'.",
      inputSchema: z.object({}),
      execute: async () => {
        console.log(`[Agent Tool] getPaymentHistory: ${businessId}`);
        try {
          const agentSb = await createServerClient();
          return await getPaymentHistory(agentSb, businessId);
        } catch (err) {
          console.error("[Agent Tool] getPaymentHistory error:", err);
          return { error: err instanceof Error ? err.message : "שגיאה בשליפת היסטוריית תשלומים" };
        }
      },
    }),

    getRecentPayments: tool({
      description:
        "מחזיר את התשלומים האחרונים ששולמו: תאריך, ספק, אסמכתא, אמצעי תשלום וסכום. לשאלות כמו 'מה התשלומים האחרונים?'.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional().describe("כמה תשלומים להחזיר (ברירת מחדל 20)"),
      }),
      execute: async ({ limit }) => {
        console.log(`[Agent Tool] getRecentPayments: ${businessId}`);
        try {
          const agentSb = await createServerClient();
          return { payments: await getRecentPayments(agentSb, businessId, limit ?? 20) };
        } catch (err) {
          console.error("[Agent Tool] getRecentPayments error:", err);
          return { error: err instanceof Error ? err.message : "שגיאה בשליפת תשלומים אחרונים" };
        }
      },
    }),

    getCashflowForecast: tool({
      description:
        "מחזיר את תחזית תזרים המזומנים: יתרת פתיחה בבנק, סך הכנסות וסך הוצאות צפויות, הפרש נקי, התאריך הראשון בו היתרה צפויה לרדת מתחת לאפס (firstNegativeDay), ופירוט יומי (כניסה/יציאה/יתרה מתגלגלת). לשאלות כמו 'מה התזרים שלי?', 'מתי אכנס למינוס?'.",
      inputSchema: z.object({}),
      execute: async () => {
        console.log(`[Agent Tool] getCashflowForecast: ${businessId}`);
        try {
          const agentSb = await createServerClient();
          return await getCashflowForecast(agentSb, businessId);
        } catch (err) {
          console.error("[Agent Tool] getCashflowForecast error:", err);
          return { error: err instanceof Error ? err.message : "שגיאה בשליפת תזרים" };
        }
      },
    }),

    getProfitLossReport: tool({
      description:
        "מחזיר את דוח הרווח וההפסד: תוצאה כוללת (totalResult) ואחוז, הכנסות ללא מע\"מ (יעד/בפועל/הפרש), ופירוט הוצאות לפי קטגוריה (יעד/בפועל/הפרש/נותר). תצוגה חודשית או שנתית. לשאלות על רווח, רווחיות, או יעד מול בפועל.",
      inputSchema: z.object({
        view: z.enum(["monthly", "annual"]).optional().describe("חודשי (ברירת מחדל) או שנתי"),
        ...PERIOD_PARAMS,
      }),
      execute: async ({ view, month, year }) => {
        console.log(`[Agent Tool] getProfitLossReport: ${businessId} / ${view ?? "monthly"} ${month ?? ""}/${year ?? ""}`);
        try {
          const agentSb = await createServerClient();
          const v = view ?? "monthly";
          const y = year ?? new Date().getFullYear();
          const range =
            v === "annual"
              ? { start: new Date(y, 0, 1), end: new Date(y, 11, 31) }
              : monthRange(month, year);
          return await getProfitLossReport(agentSb, businessId, range, v);
        } catch (err) {
          console.error("[Agent Tool] getProfitLossReport error:", err);
          return { error: err instanceof Error ? err.message : "שגיאה בשליפת דוח רווח והפסד" };
        }
      },
    }),

    getGoalsVsActual: tool({
      description:
        "מחזיר יעד מול בפועל לחודש הנוכחי לפי תצוגה: kpi (יעדי אחוז - הכנסות/עלות עובדים/עלות מכר), operating (הוצאות שוטפות לפי קטגוריה), goods (קניות סחורה לפי ספק). לכל שורה: קטגוריה, יעד, בפועל, נותר וסטטוס. לשאלות 'איפה אני עומד מול היעדים?', 'כמה נשאר לי בתקציב?'.",
      inputSchema: z.object({
        view: z.enum(["kpi", "operating", "goods"]).optional().describe("kpi / operating (ברירת מחדל) / goods"),
        ...PERIOD_PARAMS,
      }),
      execute: async ({ view, month, year }) => {
        console.log(`[Agent Tool] getGoalsVsActual: ${businessId} / ${view ?? "operating"} ${month ?? ""}/${year ?? ""}`);
        try {
          const agentSb = await createServerClient();
          return await getGoalsVsActual(agentSb, businessId, monthRange(month, year), view ?? "operating");
        } catch (err) {
          console.error("[Agent Tool] getGoalsVsActual error:", err);
          return { error: err instanceof Error ? err.message : "שגיאה בשליפת יעדים" };
        }
      },
    }),

    // READ — fetch an existing daily entry (id + current values) so the agent can
    // propose an EDIT (update) with the unchanged fields preserved.
    getDailyEntry: tool({
      description:
        "מחזיר את הרישום היומי הקיים לתאריך מסוים (id וכל הערכים: קופה, עלות עובדים, שעות, הנחות, הערות), או null אם אין רישום. **חובה לקרוא לו לפני שמציעים עדכון** של יום קיים — כדי לקבל את ה-entryId ואת הערכים הנוכחיים, ולשמר שדות שהמשתמש לא שינה.",
      inputSchema: z.object({
        date: z.string().describe("תאריך בפורמט YYYY-MM-DD"),
      }),
      execute: async ({ date }) => {
        console.log(`[Agent Tool] getDailyEntry: ${businessId} ${date}`);
        try {
          const agentSb = await createServerClient();
          const entry = await getDailyEntry(agentSb, businessId, date);
          return entry ?? { found: false, message: `אין רישום יומי לתאריך ${date}` };
        } catch (err) {
          console.error("[Agent Tool] getDailyEntry error:", err);
          return { error: err instanceof Error ? err.message : "שגיאה בשליפת רישום יומי" };
        }
      },
    }),

    getAnnualMetric: tool({
      description:
        "מחזיר תצוגה שנתית חודש-חודש של מדד ('נתוני עבר'), עם ערכים בפועל: לכל חודש הסכום, הפרש מהיעד ושינוי מחודש קודם. metric אפשרי: 'sales' (סה\"כ מכירות, ברירת מחדל), 'labor' (עלות עובדים), 'cogs' (עלות מכר), 'operating' (הוצאות שוטפות), 'source:<שם>' (מקור הכנסה כמו source:במקום), 'product:<שם>' (מוצר מנוהל כמו product:דג סלומון). לשאלות 'תן לי את המכירות של כל השנה חודש-חודש', 'איזה חודש הכי חזק בשנה', 'מה המגמה'.",
      inputSchema: z.object({
        metric: z.string().optional().describe("sales (ברירת מחדל) / labor / cogs / operating / source:<שם> / product:<שם>"),
        year: z.number().int().min(2020).max(2100).optional().describe("שנה (ברירת מחדל: השנה הנוכחית)"),
      }),
      execute: async ({ metric, year }) => {
        console.log(`[Agent Tool] getAnnualMetric: ${businessId} ${metric ?? "sales"}/${year ?? ""}`);
        try {
          const agentSb = await createServerClient();
          const y = year ?? new Date().getFullYear();
          return await getAnnualMetric(agentSb, businessId, y, metric ?? "sales");
        } catch (err) {
          console.error("[Agent Tool] getAnnualMetric error:", err);
          return { error: err instanceof Error ? err.message : "שגיאה בשליפת נתונים שנתיים" };
        }
      },
    }),

    getDailyEntries: tool({
      description:
        "מחזיר את רשימת הרישומים היומיים של החודש (כל יום: תאריך, סה\"כ קופה, עלות עובדים, שעות, הנחות), וגם סך החודש וממוצע יומי. השתמש בו לשאלות 'תן לי את הנתונים יום-יום', 'איזה יום היה הכי חזק/חלש?', 'מה הממוצע היומי?'. ברירת מחדל: החודש הנוכחי; לחודש אחר העבר month/year.",
      inputSchema: z.object(PERIOD_PARAMS),
      execute: async ({ month, year }) => {
        console.log(`[Agent Tool] getDailyEntries: ${businessId} ${month ?? ""}/${year ?? ""}`);
        try {
          const agentSb = await createServerClient();
          return await getDailyEntries(agentSb, businessId, monthRange(month, year));
        } catch (err) {
          console.error("[Agent Tool] getDailyEntries error:", err);
          return { error: err instanceof Error ? err.message : "שגיאה בשליפת רישומים יומיים" };
        }
      },
    }),

    // WRITE action — proposes a daily entry (create/update) OR an expense (invoice) for the
    // user to CONFIRM (never writes directly). Emits the shared `proposeAction` shape so
    // AiMessageBubble renders the confirmation card and, on confirm, POSTs to /api/ai/actions.
    proposeAction: tool({
      description:
        "מציע פעולה לאישור המשתמש: רישום קופה יומי (יצירה/עדכון) או הוספת הוצאה (חשבונית מספק). **אינך כותב ישירות** — אתה מציע, והמשתמש מאשר בכרטיס. נתח את הערכים שהמשתמש נתן. אם לא צוין תאריך — השתמש בתאריך של היום. confidence נמוך אם משהו לא ברור.\n- **daily_entry יצירה:** העבר dailyEntryData עם הערכים.\n- **daily_entry עדכון:** קודם קרא ל-getDailyEntry, ואז dailyEntryData עם mode='update', ה-entryId, ושמר ערכים קיימים בשדות שלא שונו.\n- **expense (הוצאה):** העבר expenseData עם שם הספק והסכומים. אם ניתן רק סכום כולל מע\"מ — פצל ל-subtotal+vat לפי 18% (אלא אם המשתמש ציין אחרת). הכלי יחפש את הספק לפי שם; אם הספק לא קיים, הכרטיס יראה אזהרה — אמור למשתמש שצריך להוסיף את הספק קודם.",
      inputSchema: z.object({
        actionType: z.enum(["daily_entry", "expense", "payment"]).describe("סוג הפעולה"),
        confidence: z.number().min(0).max(1).describe("רמת ביטחון 0-1 בפענוח הנתונים מהמשתמש"),
        reasoning: z.string().describe("הסבר קצר בעברית מה אתה מציע ולמה"),
        dailyEntryData: z.object({
          mode: z.enum(["create", "update"]).optional().describe("create (ברירת מחדל) ליצירה, update לעריכת יום קיים"),
          entryId: z.string().optional().describe("מזהה הרישום הקיים (חובה ב-update; מתקבל מ-getDailyEntry)"),
          entry_date: z.string().describe("תאריך הרישום בפורמט YYYY-MM-DD"),
          total_register: z.number().describe("סה\"כ קופה ביום ב-₪"),
          labor_cost: z.number().optional().describe("עלות עובדים ליום ב-₪"),
          labor_hours: z.number().optional().describe("שעות עבודה ביום"),
          discounts: z.number().optional().describe("סך הנחות ב-₪"),
          notes: z.string().optional().describe("הערות חופשיות"),
        }).optional().describe("נתוני הרישום היומי (כש-actionType='daily_entry')"),
        expenseData: z.object({
          supplier_name: z.string().describe("שם הספק (לחיפוש במערכת)"),
          invoice_date: z.string().describe("תאריך החשבונית YYYY-MM-DD"),
          subtotal: z.number().describe("סכום לפני מע\"מ ב-₪"),
          vat_amount: z.number().describe("סכום המע\"מ ב-₪ (0 אם פטור)"),
          total_amount: z.number().describe("סכום כולל מע\"מ ב-₪"),
          invoice_number: z.string().optional().describe("מספר חשבונית/אסמכתא"),
          invoice_type: z.string().optional().describe("סוג מסמך (חשבונית/תעודת משלוח)"),
          notes: z.string().optional().describe("הערות"),
        }).optional().describe("נתוני ההוצאה (כש-actionType='expense')"),
        paymentData: z.object({
          supplier_name: z.string().describe("שם הספק לתשלום (לחיפוש במערכת)"),
          total_amount: z.number().describe("סכום התשלום ב-₪"),
          payment_method: z.enum(["cash", "check", "bank_transfer", "credit_card", "bit", "paybox", "other"]).optional().describe("אמצעי תשלום: cash=מזומן, check=צ'ק, bank_transfer=העברה בנקאית, credit_card=אשראי, bit/paybox, other=אחר"),
          payment_date: z.string().optional().describe("תאריך התשלום YYYY-MM-DD (ברירת מחדל: היום)"),
          check_number: z.string().optional().describe("מספר צ'ק (אם רלוונטי)"),
          notes: z.string().optional().describe("הערות"),
        }).optional().describe("נתוני התשלום (כש-actionType='payment')"),
      }),
      execute: async ({ actionType, confidence, reasoning, dailyEntryData, expenseData, paymentData }) => {
        console.log(`[Agent Tool] proposeAction ${actionType}: ${businessId}`);

        if (actionType === "payment" && paymentData) {
          // Look up the supplier by name. The payment card redirects to the
          // pre-filled /payments form (it does NOT write directly).
          let supplierLookup: {
            found: boolean; id?: string; name?: string; needsCreation?: boolean; expenseType?: string;
          } = { found: false, name: paymentData.supplier_name, needsCreation: true };
          try {
            const agentSb = await createServerClient();
            const { data: sups } = await agentSb
              .from("suppliers")
              .select("id, name, expense_type")
              .eq("business_id", businessId)
              .is("deleted_at", null)
              .ilike("name", paymentData.supplier_name)
              .limit(1);
            const sup = sups?.[0];
            if (sup) {
              supplierLookup = { found: true, id: sup.id as string, name: sup.name as string, expenseType: sup.expense_type as string };
            }
          } catch (err) {
            console.error("[Agent Tool] proposeAction (payment) supplier lookup error:", err);
          }
          return {
            success: true,
            actionType: "payment" as const,
            confidence,
            reasoning,
            businessId,
            paymentData: { ...paymentData, supplier_id: supplierLookup.id },
            supplierLookup,
          };
        }

        if (actionType === "expense" && expenseData) {
          // Look up the supplier by name within this business (case-insensitive exact).
          let supplierLookup: {
            found: boolean; id?: string; name?: string; needsCreation?: boolean; expenseType?: string;
          } = { found: false, name: expenseData.supplier_name, needsCreation: true };
          try {
            const agentSb = await createServerClient();
            const { data: sups } = await agentSb
              .from("suppliers")
              .select("id, name, expense_type")
              .eq("business_id", businessId)
              .is("deleted_at", null)
              .ilike("name", expenseData.supplier_name)
              .limit(1);
            const sup = sups?.[0];
            if (sup) {
              supplierLookup = { found: true, id: sup.id as string, name: sup.name as string, expenseType: sup.expense_type as string };
            }
          } catch (err) {
            console.error("[Agent Tool] proposeAction supplier lookup error:", err);
          }
          return {
            success: true,
            actionType: "expense" as const,
            confidence,
            reasoning,
            businessId,
            expenseData: { ...expenseData, supplier_id: supplierLookup.id },
            supplierLookup,
          };
        }

        // daily_entry (default)
        return {
          success: true,
          actionType: "daily_entry" as const,
          confidence,
          reasoning,
          businessId,
          dailyEntryData,
        };
      },
    }),
  };

  // 10. System prompt
  const systemPrompt = buildSystemPrompt({ userName, businessName, businessId });

  console.log(
    `[Agent Chat] Starting stream: user=${userName}, business=${businessName}(${businessId}), messages=${modelMessages.length}`
  );

  // 11. Stream response with Vercel AI SDK (same model/streaming as /api/ai/chat)
  const result = streamText({
    model: openai("gpt-4.1-mini"),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(6),
    temperature: 0.2,
    maxOutputTokens: 4000,
    onError: ({ error }) => {
      console.error("[Agent Stream] Error during streaming:", error);
    },
    onFinish: async ({ text, steps, finishReason }) => {
      console.log(
        `[Agent Stream] Finished: reason=${finishReason}, textLength=${text?.length || 0}, steps=${steps?.length || 0}`
      );
      if (!sessionId || !text) return;
      saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "assistant", text);
    },
  });

  return result.toUIMessageStreamResponse();
}
