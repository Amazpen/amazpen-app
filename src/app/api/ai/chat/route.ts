import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { streamText, tool, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per user)
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
const FORBIDDEN_SQL =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|union|execute|call|prepare|do\b|load|import)\b/i;

function stripSqlFences(raw: string): string {
  return raw
    .replace(/^```sql?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim()
    .replace(/;\s*$/, "");
}

/** Safely evaluate a pure math JS expression. Returns the number or throws. */
function safeEvalMath(expr: string): number {
  const forbidden = /\b(eval|Function|require|import|fetch|XMLHttpRequest|process|global|window|document|setTimeout|setInterval|Buffer|fs|child_process|exec|spawn)\b/;
  if (forbidden.test(expr)) throw new Error("Forbidden expression");
  const sanitized = expr.replace(/Math\.\w+/g, "M");
  if (/[a-zA-Z_$]/.test(sanitized.replace(/M/g, ""))) throw new Error("Invalid characters in expression");
  const fn = new Function(`"use strict"; return (${expr});`);
  const result = fn();
  if (typeof result !== "number" || !isFinite(result)) throw new Error("Result is not a valid number");
  return result;
}

/** Map a page path to a Hebrew context hint for the AI */
function getPageContextHint(page: string): string {
  const map: Record<string, string> = {
    "/": "הדשבורד הראשי — סקירה כללית של ביצועי העסק",
    "/expenses": "דף ניהול הוצאות — חשבוניות ספקים, הוצאות שוטפות ומכר",
    "/suppliers": "דף ניהול ספקים — רשימת ספקים, יתרות, פרטי קשר",
    "/payments": "דף ניהול תשלומים — תשלומים שבוצעו ותשלומים עתידיים",
    "/cashflow": "דף תזרים מזומנים — צפי כסף נכנס ויוצא",
    "/goals": "דף יעדים — יעדי הכנסות, עלויות ורווחיות",
    "/reports": "דוח רווח והפסד — סיכום חודשי של הכנסות מול הוצאות",
    "/settings": "הגדרות — הגדרות משתמש ועסק",
    "/ocr": "קליטת מסמכים OCR — סריקת חשבוניות",
    "/price-tracking": "מעקב מחירי ספקים — השוואת מחירים לאורך זמן",
  };
  return map[page] || "";
}

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Chat history persistence helper
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
    console.error("Failed to save message:", err);
  }
}

// ---------------------------------------------------------------------------
// Role-specific instructions
// ---------------------------------------------------------------------------
function getRoleInstructions(userRole: string): string {
  if (userRole === "מנהל מערכת") {
    return `## 🔑 התאמה לסוג משתמש: מנהל מערכת (Admin)
- אתה מדבר עם מנהל המערכת שרואה את **כל העסקים**.
- כשהוא שואל שאלה כללית ("איך המצב?"), הצג סקירה **חוצת-עסקים**: השווה ביצועים בין כל העסקים.
- הדגש אילו עסקים עומדים ביעד ואילו חורגים — תן תמונת מצב ניהולית.
- אל תדבר כאילו הוא בעל עסק בודד — הוא מנהל, דבר מנקודת מבט ניהולית-אסטרטגית.
- הציע השוואות: "רוצה לראות איזה עסק הכי רווחי החודש?" או "אפשר להשוות את עלות העובדים בין כל העסקים."
- כשהוא שואל על עסק ספציפי — תן סיכום מפורט כולל המלצות לשיפור.`;
  }
  if (userRole === "בעל עסק") {
    return `## 🔑 התאמה לסוג משתמש: בעל עסק
- אתה מדבר עם בעל העסק — דבר כמו יועץ אישי שלו.
- התמקד ברווחיות, עלויות, ויעדים. זה מה שהכי חשוב לו.
- הצע תובנות פרואקטיביות: "שים לב שעלות המכר עלתה ב-2% — כדאי לבדוק את ספק X."
- כשהוא שואל "איך החודש?" — תן סיכום מלא עם צפי לסיום החודש.
- אם יש חריגה — הסבר מה אפשר לעשות ותן המלצה פרקטית.
- הוא רוצה שורה תחתונה — כמה כסף נכנס, כמה יצא, כמה נשאר.`;
  }
  if (userRole === "מנהל") {
    return `## 🔑 התאמה לסוג משתמש: מנהל
- אתה מדבר עם מנהל העסק — הוא אחראי על התפעול היומיומי.
- התמקד בנתונים תפעוליים: הכנסות יומיות, שעות עבודה, עלות עובדים, הזמנות.
- הצע תובנות שקשורות לניהול יומי: "ההכנסות היום נמוכות מהממוצע — אולי לשקול קידום?"
- כשהוא שואל על עובדים — תן מידע מפורט: שעות, עלות, אחוז מהכנסות.
- כשהוא שואל על ספקים — תן פירוט חשבוניות ותשלומים.`;
  }
  return `## 🔑 התאמה לסוג משתמש: ${userRole}
- דבר בפשטות וברור — הימנע ממונחים מורכבים.
- התמקד בנתונים רלוונטיים ליום-יום: הכנסות היום, הכנסות אתמול, ביצועים מול ממוצע.
- אל תציג נתונים פיננסיים רגישים כמו רווח/הפסד או עלות עובדים כוללת אלא אם נשאל במפורש.
- הצע שאלות פשוטות: "רוצה לראות את ההכנסות של היום?" או "אפשר לבדוק כמה הזמנות היו."`;
}

// ---------------------------------------------------------------------------
// Unified system prompt builder
// ---------------------------------------------------------------------------
function buildUnifiedPrompt(opts: {
  userName: string;
  userRole: string;
  businessId: string;
  businessName: string;
  isAdmin: boolean;
  allBusinesses: Array<{ id: string; name: string }>;
  pageHint: string;
}): string {
  const { userName, userRole, businessId, businessName, isAdmin, allBusinesses, pageHint } = opts;
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const israelTime = now.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "full", timeStyle: "short" });
  const israelHour = parseInt(now.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false }));
  const timeGreeting = israelHour < 12 ? "בוקר טוב" : israelHour < 17 ? "צהריים טובים" : israelHour < 21 ? "ערב טוב" : "לילה טוב";

  const bizContext = businessName ? `העסק הנבחר: "${businessName}" (ID: ${businessId}).` : "";
  const adminBizList = isAdmin && allBusinesses.length > 0
    ? `\nעסקים במערכת:\n${allBusinesses.map((b) => `- "${b.name}" → '${b.id}'`).join("\n")}`
    : "";

  return `<identity>
אתה "דדי" — העוזר החכם של המצפן, אנליסט עסקי מומחה ויועץ אישי למערכת ניהול עסקית.
התאריך: ${today}. השעה: ${israelTime}. ברכה מתאימה: "${timeGreeting}".
</identity>

<user-context>
שם: ${userName || "משתמש"}
תפקיד: ${userRole}
${bizContext}${adminBizList}
${pageHint ? `הגיע מדף: ${pageHint}` : ""}
</user-context>

<role-instructions>
${getRoleInstructions(userRole)}
</role-instructions>

<tools-usage>
## כלל יעילות קריטי — חובה!
**יש לך מקסימום 2 סיבובי כלים (steps) לפני שחובה לכתוב תשובה!**
- שאלת סיכום חודשי / "איך החודש?" / ביצועים → **getMonthlySummary בלבד** (קריאה אחת, הכל מחושב!)
- שאלה ספציפית (ספקים, חשבוניות, עובדים) → queryDatabase
- **אל תשתמש ב-calculate** — כל החישובים כבר מוכנים ב-getMonthlySummary.

## מתי להשתמש בכלים

### getMonthlySummary ⭐ (העדפה ראשונה!)
**השתמש בכלי זה לכל שאלה על ביצועי החודש, סיכום, השוואה ליעד, צפי.**
מחזיר הכל מחושב: הכנסות, הכנסה לפני מע"מ, צפי חודשי, עלות עובדים (סכום + אחוז), עלות מכר (סכום + אחוז), הוצאות שוטפות, הפרשים מיעדים.
**קריאה אחת — תשובה מלאה. אין צורך בשום כלי נוסף.**

### queryDatabase
השתמש בכלי זה **לכל שאלה שדורשת נתונים עסקיים**: הכנסות, הוצאות, ספקים, חשבוניות, יעדים, עלויות, עובדים, תשלומים, סיכומים.
- כתוב שאילתת SELECT בלבד (PostgreSQL).
- **חובה** להוסיף "public." לפני כל שם טבלה.
- ${isAdmin && !businessId ? "כשהמשתמש לא ציין עסק, שאל על כל העסקים עם JOIN businesses." : `סנן תמיד לפי business_id = '${businessId}'.`}
- ${isAdmin ? "אם המשתמש מבקש להשוות או לראות כל העסקים, שאל על כל העסקים." : ""}
- LIMIT 500 תמיד.
- NEVER use UNION or comments (-- / /* */).
- **תמיד** JOIN עם businesses לקבלת שם העסק — אסור להציג UUID.
- אם שאילתה נכשלה — נסה **פעם אחת** לתקן. אם נכשלה שוב — המשך עם הנתונים שיש.
- **העדף שאילתות מקיפות**: SELECT עם SUM/COUNT/AVG במקום הרבה שאילתות קטנות.

### getBusinessSchedule
השתמש כשנדרש **צפי חודשי** או **ימי עבודה צפויים**.
- מחזיר day_factor לכל יום בשבוע (0=ראשון..6=שבת).
- חשב expected_monthly_work_days: עבור על כל ימי החודש, סכום day_factor לפי day_of_week.

### getGoals
השתמש כשנדרשים **יעדים**: revenue_target, labor_cost_target_pct, food_cost_target_pct, markup, vat override.
- קרא ל-getGoals לפני חישובי הפרש/אחוזים מיעד.

### calculate
**כמעט תמיד לא צריך!** אתה מודל שפה — חישובים כמו 94286/1.18 או 22340/79903*100 עשה בעצמך.
השתמש רק לחישובים ארוכים מאוד עם הרבה מספרים.

### proposeAction
השתמש כשהמשתמש שיתף **נתוני חשבונית/קבלה** מ-OCR או מבקש **ליצור רשומה** (הוצאה, תשלום, רישום יומי).
- זהה את סוג הפעולה: expense (חשבונית/הוצאה), payment (תשלום), daily_entry (רישום יומי).
- חלץ את **כל** הנתונים הרלוונטיים מההודעה או מתמליל ה-OCR.
- ציון ביטחון: 0.9+ = נתונים מלאים וברורים, 0.7-0.9 = נתונים חלקיים, <0.7 = לא ברור.
- הסבר בעברית למה אתה מציע את הפעולה.
- **חשוב**: תמיד השתמש בפורמט תאריך YYYY-MM-DD.
- אם זיהית שם ספק — הכלי יחפש אוטומטית אם הספק קיים במערכת.
- הנתונים יוצגו למשתמש ככרטיס אישור — הוא יוכל לאשר או לבטל.
</tools-usage>

<database-schema>
-- daily_entries: נתוני ביצועים יומיים
-- Columns: id (uuid PK), business_id (uuid FK), entry_date (date), total_register (numeric),
--   labor_cost (numeric), labor_hours (numeric), discounts (numeric), waste (numeric),
--   day_factor (numeric), notes (text), created_by (uuid), created_at, updated_at, deleted_at

-- daily_income_breakdown: פילוח הכנסות ליומי
-- Columns: id (uuid PK), daily_entry_id (uuid FK → daily_entries.id),
--   income_source_id (uuid FK → income_sources.id), amount (numeric), orders_count (integer)

-- daily_summary (VIEW - no deleted_at): סיכום יומי מצטבר
-- Columns: id, business_id, entry_date, total_register, labor_cost, labor_hours,
--   discounts, waste, day_factor, total_income_breakdown, food_cost,
--   labor_cost_pct, food_cost_pct, notes, created_by

-- monthly_summaries: סיכומים חודשיים מחושבים (כולל היסטוריה)
-- Columns: id (uuid PK), business_id (uuid FK), year (int), month (int),
--   actual_work_days, total_income, monthly_pace,
--   labor_cost_pct, labor_cost_amount, food_cost_pct, food_cost_amount,
--   managed_product_1_pct, managed_product_1_cost, managed_product_2_pct, managed_product_2_cost,
--   managed_product_3_pct, managed_product_3_cost,
--   avg_income_1, avg_income_2, avg_income_3, avg_income_4,
--   sales_budget_diff_pct, labor_budget_diff_pct, food_cost_budget_diff,
--   sales_yoy_change_pct, labor_cost_yoy_change_pct, food_cost_yoy_change_pct
-- NOTE: percentage columns = decimals (0.325 = 32.5%). Use for historical months without daily_entries.

-- invoices: חשבוניות ספקים
-- Columns: id (uuid PK), business_id (uuid FK), supplier_id (uuid FK),
--   invoice_number (text), invoice_date (date), due_date (date), subtotal (numeric),
--   vat_amount (numeric), total_amount (numeric), status (text: pending/paid/partial/clarification),
--   amount_paid (numeric), invoice_type (text), is_consolidated (boolean),
--   notes (text), created_by (uuid), created_at, updated_at, deleted_at

-- payments: תשלומים לספקים
-- Columns: id (uuid PK), business_id (uuid FK), supplier_id (uuid FK),
--   payment_date (date), total_amount (numeric), invoice_id (uuid FK),
--   notes (text), receipt_url (text), created_by (uuid), created_at, updated_at, deleted_at

-- payment_splits: פירוט אמצעי תשלום
-- Columns: id (uuid PK), payment_id (uuid FK), payment_method (text),
--   amount (numeric), credit_card_id (uuid FK), check_number (text),
--   check_date (date), reference_number (text), installments_count (int),
--   installment_number (int), due_date (date)

-- suppliers: מידע ספקים
-- Columns: id (uuid PK), business_id (uuid FK), name (text), expense_type (text: goods/current),
--   expense_category_id (uuid FK), expense_nature (text), contact_name (text),
--   phone (text), email (text), tax_id (text), payment_terms_days (int),
--   requires_vat (boolean), is_fixed_expense (boolean), monthly_expense_amount (numeric),
--   default_payment_method (text), charge_day (int), is_active (boolean),
--   vat_type (text), notes (text), created_at, updated_at, deleted_at

-- supplier_balance (VIEW - no deleted_at): יתרות ספקים
-- Columns: supplier_id, business_id, supplier_name, expense_type,
--   total_invoiced, total_paid, balance

-- supplier_budgets: תקציבי ספקים חודשיים
-- Columns: id (uuid PK), supplier_id (uuid FK), business_id (uuid FK),
--   year (int), month (int), budget_amount (numeric), notes (text), deleted_at

-- delivery_notes: תעודות משלוח
-- Columns: id (uuid PK), business_id (uuid FK), supplier_id (uuid FK),
--   delivery_note_number (text), delivery_date (date), subtotal (numeric),
--   vat_amount (numeric), total_amount (numeric), invoice_id (uuid FK),
--   is_verified (boolean), notes (text)

-- goals: יעדים עסקיים
-- Columns: id (uuid PK), business_id (uuid FK), year (int), month (int),
--   revenue_target (numeric), labor_cost_target_pct (numeric),
--   food_cost_target_pct (numeric), operating_cost_target_pct (numeric),
--   profit_target (numeric), profit_margin_target_pct (numeric),
--   current_expenses_target (numeric), goods_expenses_target (numeric),
--   markup_percentage (numeric, monthly override), vat_percentage (numeric, monthly override), deleted_at

-- income_sources: מקורות הכנסה
-- Columns: id (uuid PK), business_id (uuid FK), name (text),
--   income_type (text), input_type (text), commission_rate (numeric),
--   display_order (int), is_active (boolean), deleted_at

-- managed_products: מוצרים מנוהלים
-- Columns: id (uuid PK), business_id (uuid FK), name (text), unit (text),
--   unit_cost (numeric), category (text), current_stock (numeric),
--   target_pct (numeric), is_active (boolean), deleted_at

-- expense_categories: קטגוריות הוצאות
-- Columns: id (uuid PK), business_id (uuid FK), parent_id (uuid FK),
--   name (text), description (text), display_order (int), is_active (boolean), deleted_at

-- businesses: הגדרות עסק
-- Columns: id (uuid PK), name (text), business_type (text), tax_id (text),
--   vat_percentage (numeric), markup_percentage (numeric),
--   manager_monthly_salary (numeric), currency (text)

-- business_schedule: לוח עבודה שבועי (day_factor ליום)
-- Columns: id (uuid PK), business_id (uuid FK), day_of_week (int, 0=ראשון..6=שבת),
--   day_factor (numeric, 1=יום מלא, 0.5=חצי יום, 0=סגור)

-- business_credit_cards: כרטיסי אשראי
-- Columns: id (uuid PK), business_id (uuid FK), card_name (text),
--   last_four_digits (text), card_type (text), billing_day (int),
--   credit_limit (numeric), is_active (boolean), deleted_at
</database-schema>

<calculation-formulas>
## נוסחאות חישוב — חובה להשתמש כדי להתאים לדשבורד!

1. **הכנסה לפני מע"מ** = SUM(total_register) / (1 + vat_percentage)
   vat_percentage: goals.vat_percentage for the month if set, else businesses.vat_percentage.

2. **צפי חודשי** (monthly pace):
   sum_actual_day_factors = SUM(day_factor) FROM daily_entries
   expected_monthly_work_days = סיכום day_factor מ-business_schedule לכל ימי החודש הקלנדרי
   daily_average = total_income / sum_actual_day_factors
   monthly_pace = daily_average × expected_monthly_work_days

3. **עלות עובדים** (labor cost) — לא מ-daily_summary!
   markup = goals.markup_percentage or businesses.markup_percentage (default 1)
   manager_daily_cost = businesses.manager_monthly_salary / expected_work_days_in_month
   labor_cost_total = (SUM(labor_cost) + manager_daily_cost × actual_work_days) × markup
   labor_cost_pct = labor_cost_total / income_before_vat × 100
   labor_cost_diff_pct = labor_cost_pct - goals.labor_cost_target_pct
   labor_cost_diff_amount = labor_cost_diff_pct × income_before_vat / 100

4. **הפרש הכנסות מהיעד**:
   target_diff_pct = (monthly_pace / revenue_target - 1) × 100
   daily_diff = (monthly_pace - revenue_target) / expected_monthly_work_days
   target_diff_amount = daily_diff × sum_actual_day_factors

5. **עלות מכר** (food cost) — מחשבוניות, לא daily_summary!
   food_cost = SUM(invoices.subtotal) WHERE supplier expense_type = 'goods_purchases'
   food_cost_pct = food_cost / income_before_vat × 100
   food_cost_diff_pct = food_cost_pct - goals.food_cost_target_pct

6. **הוצאות שוטפות** — מחשבוניות:
   current_expenses = SUM(invoices.subtotal) WHERE supplier expense_type = 'current_expenses'
   current_expenses_pct = current_expenses / income_before_vat × 100

7. **מוצרים מנוהלים**:
   total_cost = unit_cost × SUM(quantity)
   product_pct = total_cost / income_before_vat × 100

8. **מקורות הכנסה ממוצע הזמנה**:
   avg_ticket = SUM(amount) / SUM(orders_count) per income_source
</calculation-formulas>

<response-format>
## סגנון תשובה

- **תמיד בעברית**. Markdown: כותרות (##), טבלאות, **בולד**, נקודות.
- ₪ למטבע, פסיקים למספרים (₪185,400).
- דבר כמו **יועץ עסקי אישי** — לא רובוט.
- שאלת המשך? התחבר: "בהמשך למה שראינו...", לא ברכה חדשה.
- תשובה פשוטה → קצר וטבעי. תשובה מורכבת → תבנית מפורטת.
- סיים בהצעת המשך ספציפית: "אפשר גם לראות פילוח ספקים — רוצה?"

## אימוג'ים
💰 הכנסות, 👷 עלות עובדים, 📦 עלות מכר, 🏢 הוצאות שוטפות, 🎯 יעדים, 📊 סיכום, 📈 עלייה, 📉 ירידה, ✅ עמידה ביעד, ⚠️ חריגה, 🏆 הכי גבוה, 💡 המלצה, 🧮 חישוב
אימוג'י אחד בכותרת ובנקודות מפתח. לא בכל שורה.

## כללי פרשנות
- הכנסות: מינוס = לא טוב (מתחת ליעד), פלוס = טוב.
- הוצאות: מינוס = טוב (חיסכון), פלוס = לא טוב (חריגה).
- תמיד: צפי חודשי, אחוזים + הפרש מיעד בש"ח, השוואה לחודש קודם.

## שגיאות נפוצות — אסור!
❌ "עלות עובדים: 177,436 ש"ח, שהם 32.83%"
✅ "עלות עובדים 32.83% — הפרש של X% טוב יותר מהיעד שחסך Y ש"ח"
❌ להציג UUID/מזהה עסק
✅ להשתמש בשם העסק תמיד
❌ "עלות מכר: 113,050 ש"ח" בלי אחוזים
✅ "עלות מכר: XX% — הפרש Y% מהיעד = Z ש"ח"

## גרף
אם הנתונים תומכים (2+ נקודות, השוואות/מגמות), הוסף בסוף:
\`\`\`chart-json
{"type":"bar","title":"כותרת","xAxisKey":"field","data":[...],"dataKeys":[{"key":"v","label":"תווית","color":"#6366f1"}]}
\`\`\`
צבעים: #6366f1 (אינדיגו), #22c55e (ירוק), #f59e0b (ענבר), #ef4444 (אדום), #3b82f6 (כחול), #8b5cf6 (סגול).

## תובנות פרואקטיביות
אתה לא רק מציג מספרים — אתה **מנתח, משווה, ומציע פעולה**.
- ספקים: השווה לחודשים קודמים, זהה מגמות מחיר, ציין חשבוניות באיחור.
- הכנסות: השווה לממוצע, מגמה ב-10 ימים אחרונים, ימי שיא/שפל.
- עלות עובדים: נתח — הכנסות נמוכות או שעות גבוהות? הצע פעולה.
- עלות מכר: מוצרים מנוהלים + מגמות מחיר.
- תמיד עם מספרים: "אם תעלה ממוצע ב-₪20, זה ₪X נוספים בחודש."
</response-format>

<hard-rules>
- אסור להמציא נתונים — רק ממה שהכלים החזירו!
- אסור: קריטי, דחוף, חייב, מסוכן, בעיה, משבר
- אסור לתת מחירים של חברת המצפן
- אסור להבטיח תוצאות ספציפיות
- אסור להציג UUID — תמיד שם עסק
- אם אין נתונים — "לא מצאתי נתונים לתקופה. רוצה לבדוק חודש קודם?"
- אם SQL נכשל — נסה **פעם אחת** עם תיקון. אם עדיין נכשל — התעלם מהשאילתה הזו וסכם עם הנתונים שכבר יש לך.
- לעולם אל תגיד שאין לך גישה — יש לך גישה מלאה.
</hard-rules>`;
}

// ---------------------------------------------------------------------------
// Tool definitions factory
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = any;

async function execReadOnlyQuery(sb: AnySupabaseClient, sql: string) {
  return sb.rpc("read_only_query", { sql_query: sql });
}

// ---------------------------------------------------------------------------
// Server-side monthly summary computation
// ---------------------------------------------------------------------------
async function computeMonthlySummary(
  sb: AnySupabaseClient,
  bizId: string,
  year: number,
  month: number
) {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  // 1. Daily entries aggregation
  const { data: dailyAgg } = await execReadOnlyQuery(sb,
    `SELECT
       COALESCE(SUM(total_register), 0) as total_income,
       COALESCE(SUM(labor_cost), 0) as total_labor_cost,
       COALESCE(SUM(labor_hours), 0) as total_labor_hours,
       COALESCE(SUM(discounts), 0) as total_discounts,
       COALESCE(SUM(day_factor), 0) as sum_day_factors,
       COUNT(*) as work_days
     FROM public.daily_entries
     WHERE business_id = '${bizId}'
       AND entry_date >= '${monthStart}'
       AND entry_date < '${nextMonth}'
       AND deleted_at IS NULL`
  );
  const daily = Array.isArray(dailyAgg) && dailyAgg[0] ? dailyAgg[0] : {
    total_income: 0, total_labor_cost: 0, total_labor_hours: 0,
    total_discounts: 0, sum_day_factors: 0, work_days: 0,
  };

  // 2. Invoices: food cost (goods_purchases) and current expenses
  const { data: invoiceAgg } = await execReadOnlyQuery(sb,
    `SELECT
       COALESCE(SUM(CASE WHEN s.expense_type = 'goods_purchases' THEN i.subtotal ELSE 0 END), 0) as food_cost,
       COALESCE(SUM(CASE WHEN s.expense_type = 'current_expenses' THEN i.subtotal ELSE 0 END), 0) as current_expenses,
       COALESCE(SUM(i.subtotal), 0) as total_expenses
     FROM public.invoices i
     JOIN public.suppliers s ON s.id = i.supplier_id
     WHERE i.business_id = '${bizId}'
       AND i.invoice_date >= '${monthStart}'
       AND i.invoice_date < '${nextMonth}'
       AND i.deleted_at IS NULL`
  );
  const invoices = Array.isArray(invoiceAgg) && invoiceAgg[0] ? invoiceAgg[0] : {
    food_cost: 0, current_expenses: 0, total_expenses: 0,
  };

  // 3. Goals
  const { data: goalsData } = await sb
    .from("goals")
    .select("*")
    .eq("business_id", bizId)
    .eq("year", year)
    .eq("month", month)
    .is("deleted_at", null)
    .maybeSingle();

  // 4. Business defaults
  const { data: bizData } = await sb
    .from("businesses")
    .select("name, vat_percentage, markup_percentage, manager_monthly_salary")
    .eq("id", bizId)
    .single();

  // 5. Schedule (expected work days)
  const { data: scheduleData } = await sb
    .from("business_schedule")
    .select("day_of_week, day_factor")
    .eq("business_id", bizId)
    .order("day_of_week");

  const scheduleMap = new Map<number, number>();
  if (scheduleData) {
    for (const row of scheduleData) {
      scheduleMap.set(row.day_of_week, Number(row.day_factor) || 0);
    }
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  let expectedWorkDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    expectedWorkDays += scheduleMap.get(dow) ?? 1;
  }

  // 6. Compute everything
  const vatPct = goalsData?.vat_percentage ?? bizData?.vat_percentage ?? 0.18;
  const markup = goalsData?.markup_percentage ?? bizData?.markup_percentage ?? 1;
  const managerSalary = Number(bizData?.manager_monthly_salary) || 0;

  const totalIncome = Number(daily.total_income) || 0;
  const incomeBeforeVat = totalIncome / (1 + vatPct);
  const sumDayFactors = Number(daily.sum_day_factors) || 0;
  const workDays = Number(daily.work_days) || 0;

  const dailyAvg = sumDayFactors > 0 ? incomeBeforeVat / sumDayFactors : 0;
  const monthlyPace = dailyAvg * expectedWorkDays;

  const managerDailyCost = expectedWorkDays > 0 ? managerSalary / expectedWorkDays : 0;
  const laborCostTotal = (Number(daily.total_labor_cost) + managerDailyCost * workDays) * markup;
  const laborCostPct = incomeBeforeVat > 0 ? (laborCostTotal / incomeBeforeVat) * 100 : 0;

  const foodCost = Number(invoices.food_cost) || 0;
  const foodCostPct = incomeBeforeVat > 0 ? (foodCost / incomeBeforeVat) * 100 : 0;

  const currentExpenses = Number(invoices.current_expenses) || 0;
  const currentExpensesPct = incomeBeforeVat > 0 ? (currentExpenses / incomeBeforeVat) * 100 : 0;

  const revenueTarget = Number(goalsData?.revenue_target) || 0;
  const targetDiffPct = revenueTarget > 0 ? ((monthlyPace / revenueTarget) - 1) * 100 : null;

  const laborTarget = Number(goalsData?.labor_cost_target_pct) || 0;
  const laborDiffPct = laborTarget > 0 ? laborCostPct - laborTarget : null;

  const foodTarget = Number(goalsData?.food_cost_target_pct) || 0;
  const foodDiffPct = foodTarget > 0 ? foodCostPct - foodTarget : null;

  return {
    businessName: bizData?.name || "",
    period: { year, month, monthStart, daysInMonth },
    actuals: {
      totalIncome: Math.round(totalIncome),
      incomeBeforeVat: Math.round(incomeBeforeVat),
      workDays,
      sumDayFactors: Math.round(sumDayFactors * 100) / 100,
      dailyAvgBeforeVat: Math.round(dailyAvg),
      monthlyPace: Math.round(monthlyPace),
      expectedWorkDays: Math.round(expectedWorkDays * 100) / 100,
      totalDiscounts: Math.round(Number(daily.total_discounts)),
      totalLaborHours: Math.round(Number(daily.total_labor_hours)),
    },
    costs: {
      laborCostTotal: Math.round(laborCostTotal),
      laborCostPct: Math.round(laborCostPct * 100) / 100,
      foodCost: Math.round(foodCost),
      foodCostPct: Math.round(foodCostPct * 100) / 100,
      currentExpenses: Math.round(currentExpenses),
      currentExpensesPct: Math.round(currentExpensesPct * 100) / 100,
    },
    targets: {
      revenueTarget,
      laborTargetPct: laborTarget,
      foodTargetPct: foodTarget,
      targetDiffPct: targetDiffPct !== null ? Math.round(targetDiffPct * 100) / 100 : null,
      laborDiffPct: laborDiffPct !== null ? Math.round(laborDiffPct * 100) / 100 : null,
      foodDiffPct: foodDiffPct !== null ? Math.round(foodDiffPct * 100) / 100 : null,
    },
    params: { vatPct, markup, managerSalary },
  };
}

function buildTools(
  adminSupabase: AnySupabaseClient,
  businessId: string,
  isAdmin: boolean
) {
  return {
    getMonthlySummary: tool({
      description: "Get a complete pre-calculated monthly business summary including income, labor cost, food cost, current expenses, monthly pace, targets, and variances. Use this as the FIRST tool for any question about monthly performance, 'how is the month going', summaries, or comparisons to goals. Returns all data already computed — no need for additional calculate calls.",
      inputSchema: z.object({
        businessId: z.string().describe("Business UUID"),
        year: z.number().describe("Year (e.g., 2026)"),
        month: z.number().describe("Month (1-12)"),
      }),
      execute: async ({ businessId: bizId, year, month }) => {
        console.log(`[AI Tool] getMonthlySummary: ${bizId} ${year}/${month}`);
        try {
          return await computeMonthlySummary(adminSupabase, bizId, year, month);
        } catch (e) {
          console.error("[AI Tool] getMonthlySummary error:", e);
          return { error: e instanceof Error ? e.message : "Failed to compute summary" };
        }
      },
    }),

    queryDatabase: tool({
      description: "Execute a read-only SQL query (SELECT/WITH only) against the PostgreSQL business database. Use for any business data: income, expenses, suppliers, invoices, goals, employees, payments. Always prefix tables with public. and filter by business_id.",
      inputSchema: z.object({
        sql: z.string().describe("The SQL SELECT query to execute. Must start with SELECT or WITH. Always use public. prefix for tables."),
        explanation: z.string().describe("Brief Hebrew explanation of what this query does, for logging."),
      }),
      execute: async ({ sql, explanation }) => {
        console.log(`[AI Tool] queryDatabase: ${explanation}`);
        const cleanSql = stripSqlFences(sql);
        const sqlLower = cleanSql.toLowerCase().trimStart();

        // Validate
        if (!sqlLower.startsWith("select") && !sqlLower.startsWith("with")) {
          return { error: "Only SELECT/WITH queries allowed", failedSql: cleanSql };
        }
        if (FORBIDDEN_SQL.test(cleanSql)) {
          return { error: "Query contains forbidden operations", failedSql: cleanSql };
        }
        if (cleanSql.includes("--") || cleanSql.includes("/*")) {
          return { error: "SQL comments not allowed", failedSql: cleanSql };
        }
        if (!isAdmin && businessId && !cleanSql.includes(businessId)) {
          return { error: `Query must filter by business_id = '${businessId}'`, failedSql: cleanSql };
        }

        // Execute
        const { data, error } = await execReadOnlyQuery(adminSupabase, cleanSql);

        if (error) {
          console.error("[AI Tool] SQL error:", error.message);
          // Try adding public. prefix
          if (error.message.includes("does not exist")) {
            const fixedSql = cleanSql
              .replace(/\bFROM\s+(?!public\.)(\w+)/gi, "FROM public.$1")
              .replace(/\bJOIN\s+(?!public\.)(\w+)/gi, "JOIN public.$1");
            const { data: retryData, error: retryError } = await execReadOnlyQuery(adminSupabase, fixedSql);
            if (retryError) {
              return { error: retryError.message, failedSql: fixedSql };
            }
            const rows = Array.isArray(retryData) ? retryData : [];
            return { rows: rows.slice(0, 100), totalRows: rows.length };
          }
          return { error: error.message, failedSql: cleanSql };
        }

        const rows = Array.isArray(data) ? data : [];
        return { rows: rows.slice(0, 100), totalRows: rows.length };
      },
    }),

    getBusinessSchedule: tool({
      description: "Get the weekly business schedule (day_factor per day of week) for calculating expected monthly work days and monthly pace. Returns 7 entries (0=Sunday to 6=Saturday).",
      inputSchema: z.object({
        businessId: z.string().describe("The business UUID to get schedule for."),
      }),
      execute: async ({ businessId: bizId }) => {
        console.log(`[AI Tool] getBusinessSchedule: ${bizId}`);
        const { data, error } = await adminSupabase
          .from("business_schedule")
          .select("day_of_week, day_factor")
          .eq("business_id", bizId)
          .order("day_of_week") as { data: Array<{ day_of_week: number; day_factor: number }> | null; error: { message: string } | null };

        if (error) {
          return { error: error.message };
        }
        if (!data || data.length === 0) {
          return { schedule: [], note: "No schedule found. Default: all days = 1." };
        }

        // Calculate expected work days for current month
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const scheduleMap = new Map<number, number>();
        for (const row of data) {
          scheduleMap.set(row.day_of_week, Number(row.day_factor) || 0);
        }
        let expectedWorkDays = 0;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
          const dayOfWeek = new Date(year, month, d).getDay();
          expectedWorkDays += scheduleMap.get(dayOfWeek) ?? 1;
        }

        return {
          schedule: data,
          currentMonth: { year, month: month + 1, expectedWorkDays, daysInMonth },
        };
      },
    }),

    getGoals: tool({
      description: "Get business goals for a specific month: revenue target, labor/food cost targets, markup, VAT override, profit targets, current expenses target.",
      inputSchema: z.object({
        businessId: z.string().describe("The business UUID."),
        year: z.number().describe("Year (e.g., 2026)."),
        month: z.number().describe("Month (1-12)."),
      }),
      execute: async ({ businessId: bizId, year, month }) => {
        console.log(`[AI Tool] getGoals: ${bizId} ${year}/${month}`);
        const { data, error } = await adminSupabase
          .from("goals")
          .select("*")
          .eq("business_id", bizId)
          .eq("year", year)
          .eq("month", month)
          .is("deleted_at", null)
          .maybeSingle();

        if (error) {
          return { error: error.message };
        }
        if (!data) {
          return { goals: null, note: "No goals set for this month." };
        }

        // Also get business defaults for fallbacks
        const { data: biz } = await adminSupabase
          .from("businesses")
          .select("vat_percentage, markup_percentage, manager_monthly_salary")
          .eq("id", bizId)
          .single();

        return {
          goals: data,
          businessDefaults: biz || null,
        };
      },
    }),

    calculate: tool({
      description: "Evaluate a pure math expression (arithmetic, percentages, VAT). For business data queries, use queryDatabase instead.",
      inputSchema: z.object({
        expression: z.string().describe("JavaScript math expression, e.g. '1200 * 0.15' or '5000 * 1.18'. Only Math.*, +, -, *, /, % allowed."),
        description: z.string().describe("Hebrew description of the calculation."),
      }),
      execute: async ({ expression, description }) => {
        console.log(`[AI Tool] calculate: ${description} → ${expression}`);
        try {
          const result = safeEvalMath(expression);
          return { result, expression, description };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Calculation failed", expression };
        }
      },
    }),

    proposeAction: tool({
      description: "Propose a business action (create expense/invoice, payment, or daily entry) for user confirmation. Use when user shares invoice/receipt data from OCR or asks to create a record. Returns structured data displayed as a confirmation card in the chat.",
      inputSchema: z.object({
        actionType: z.enum(["expense", "payment", "daily_entry"]).describe("Type of action to propose"),
        confidence: z.number().min(0).max(1).describe("Confidence score 0-1 for extraction quality"),
        reasoning: z.string().describe("Brief Hebrew explanation of why you're proposing this action"),
        expenseData: z.object({
          supplier_name: z.string().optional().describe("Supplier name as extracted"),
          invoice_date: z.string().optional().describe("Invoice date in YYYY-MM-DD format"),
          invoice_number: z.string().optional().describe("Invoice number"),
          subtotal: z.number().optional().describe("Amount before VAT"),
          vat_amount: z.number().optional().describe("VAT amount"),
          total_amount: z.number().optional().describe("Total amount including VAT"),
          invoice_type: z.string().optional().describe("current or goods"),
          notes: z.string().optional().describe("Additional notes"),
        }).optional(),
        paymentData: z.object({
          supplier_name: z.string().optional().describe("Supplier name"),
          payment_date: z.string().optional().describe("Payment date in YYYY-MM-DD format"),
          total_amount: z.number().optional().describe("Payment amount"),
          payment_method: z.enum(["cash", "check", "bank_transfer", "credit_card", "bit", "paybox", "other"]).optional(),
          check_number: z.string().optional(),
          reference_number: z.string().optional(),
          notes: z.string().optional(),
        }).optional(),
        dailyEntryData: z.object({
          entry_date: z.string().optional().describe("Entry date in YYYY-MM-DD format"),
          total_register: z.number().optional().describe("Total register amount"),
          labor_cost: z.number().optional().describe("Labor cost"),
          labor_hours: z.number().optional(),
          discounts: z.number().optional(),
          notes: z.string().optional(),
        }).optional(),
      }),
      execute: async ({ actionType, confidence, reasoning, expenseData, paymentData, dailyEntryData }) => {
        console.log(`[AI Tool] proposeAction: ${actionType} — ${reasoning}`);

        // Supplier lookup if name provided
        let resolvedSupplierId: string | null = null;
        let supplierLookup: { found: boolean; id?: string; name?: string; needsCreation?: boolean } | null = null;

        const supplierName = actionType === "expense" ? expenseData?.supplier_name : paymentData?.supplier_name;

        if (supplierName && businessId) {
          const { data: suppliers } = await adminSupabase
            .from("suppliers")
            .select("id, name")
            .eq("business_id", businessId)
            .ilike("name", `%${supplierName}%`)
            .is("deleted_at", null)
            .limit(1);

          if (suppliers && suppliers.length > 0) {
            resolvedSupplierId = suppliers[0].id;
            supplierLookup = { found: true, id: suppliers[0].id, name: suppliers[0].name };
          } else {
            supplierLookup = { found: false, needsCreation: true, name: supplierName };
          }
        }

        return {
          success: true,
          actionType,
          confidence,
          reasoning,
          businessId,
          expenseData: expenseData ? { ...expenseData, supplier_id: resolvedSupplierId || undefined } : undefined,
          paymentData: paymentData ? { ...paymentData, supplier_id: resolvedSupplierId || undefined } : undefined,
          dailyEntryData,
          supplierLookup,
        };
      },
    }),
  };
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

  // 2. Parse request body (accepts UIMessage[] from useChat + extra body fields)
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "בקשה לא תקינה" }, 400);
  }

  let businessId = typeof body.businessId === "string" ? body.businessId : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const pageContext = typeof body.pageContext === "string" ? body.pageContext : "";
  const ocrContext = typeof body.ocrContext === "string" ? body.ocrContext : "";

  // Extract messages from the AI SDK UIMessage format
  const uiMessages: UIMessage[] = Array.isArray(body.messages) ? body.messages : [];
  if (uiMessages.length === 0) {
    return jsonResponse({ error: "חסרים נתונים — אין הודעות בבקשה" }, 400);
  }

  // Get the last user message text
  const lastMsg = uiMessages[uiMessages.length - 1];
  const lastUserText = lastMsg?.role === "user"
    ? lastMsg.parts?.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("") || ""
    : "";

  if (!lastUserText) {
    return jsonResponse({ error: `חסרים נתונים — הודעה אחרונה: role=${lastMsg?.role}, parts=${JSON.stringify(lastMsg?.parts?.map(p => p.type))}` }, 400);
  }
  if (lastUserText.length > 2000) {
    return jsonResponse({ error: "ההודעה ארוכה מדי (מקסימום 2000 תווים)" }, 400);
  }
  if (businessId && !UUID_REGEX.test(businessId)) {
    return jsonResponse({ error: "מזהה עסק לא תקין" }, 400);
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

  // 5. Authorization + user info
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("is_admin, full_name")
    .eq("id", user.id)
    .single();

  const userName = profile?.full_name || "";
  let userRole = "";
  const isAdmin = profile?.is_admin === true;

  // For non-admin users without a selected business, auto-detect their first business
  if (!isAdmin && !businessId) {
    const { data: firstMembership } = await serverSupabase
      .from("business_members")
      .select("business_id")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (firstMembership?.business_id) {
      businessId = firstMembership.business_id;
    } else {
      return jsonResponse({ error: "לא נמצא עסק משויך למשתמש" }, 400);
    }
  }

  // Fetch business name
  let businessName = "";
  if (businessId) {
    const { data: biz } = await serverSupabase
      .from("businesses")
      .select("name")
      .eq("id", businessId)
      .single();
    businessName = biz?.name || "";
  }

  // Admin: always fetch all businesses
  let allBusinesses: Array<{ id: string; name: string }> = [];
  if (isAdmin) {
    const { data: businesses } = await serverSupabase
      .from("businesses")
      .select("id, name")
      .order("name");
    allBusinesses = businesses || [];
  }

  if (isAdmin) {
    userRole = "מנהל מערכת";
  } else {
    const { data: membership } = await serverSupabase
      .from("business_members")
      .select("id, role")
      .eq("user_id", user.id)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .single();

    if (!membership) {
      return jsonResponse({ error: "אין גישה לעסק זה" }, 403);
    }

    const roleMap: Record<string, string> = {
      owner: "בעל עסק",
      manager: "מנהל",
      employee: "עובד",
    };
    userRole = roleMap[membership.role] || membership.role || "משתמש";
  }

  // 6. Page context
  const pageHint = getPageContextHint(pageContext);

  // 7. Inject OCR context into the last user message (hidden from chat UI, visible to AI)
  if (ocrContext) {
    const lastUiMsg = uiMessages[uiMessages.length - 1];
    if (lastUiMsg?.role === "user" && lastUiMsg.parts) {
      lastUiMsg.parts.push({
        type: "text" as const,
        text: `\n\n<ocr-document>\n${ocrContext}\n</ocr-document>`,
      });
    }
  }

  // 8. Convert UIMessages to model messages
  const modelMessages = await convertToModelMessages(uiMessages);

  // 9. Save user message to DB (save only the display text, not OCR)
  if (sessionId) {
    saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "user", lastUserText);
  }

  // 10. Build tools & system prompt
  const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tools = buildTools(adminSupabase, businessId, isAdmin);

  const systemPrompt = buildUnifiedPrompt({
    userName,
    userRole,
    businessId,
    businessName,
    isAdmin,
    allBusinesses,
    pageHint,
  });

  // 10. Stream response with Vercel AI SDK
  console.log(`[AI Chat] Starting stream: user=${userName}, role=${userRole}, business=${businessName}(${businessId}), messages=${modelMessages.length}, promptLength=${systemPrompt.length}`);

  const result = streamText({
    model: openai("gpt-4.1-mini"),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    temperature: 0.6,
    maxOutputTokens: 4000,
    onStepFinish: async ({ toolCalls }) => {
      if (toolCalls?.length) {
        console.log(`[AI Step] tools=${toolCalls.map(tc => tc.toolName).join(", ")}`);
      }
    },
    onError: ({ error }) => {
      console.error("[AI Stream] Error during streaming:", error);
    },
    onFinish: async ({ text, steps, finishReason }) => {
      console.log(`[AI Stream] Finished: reason=${finishReason}, textLength=${text?.length || 0}, steps=${steps?.length || 0}`);
      if (!text && steps?.length) {
        console.warn("[AI Stream] No text generated after tool calls. Steps:", JSON.stringify(steps.map(s => ({ toolCalls: s.toolCalls?.map(tc => tc.toolName), text: s.text?.slice(0, 100) }))));
      }
      if (!sessionId || !text) return;

      // Extract chart data from text if present
      let chartData: unknown = null;
      const chartMatch = text.match(/```chart-json\n([\s\S]*?)\n```/);
      if (chartMatch) {
        try {
          chartData = JSON.parse(chartMatch[1]);
        } catch {
          // Invalid chart JSON
        }
      }

      // Save text without chart block
      const textContent = chartMatch
        ? text.slice(0, text.indexOf("```chart-json")).trim()
        : text;

      saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "assistant", textContent, chartData);
    },
  });

  return result.toUIMessageStreamResponse();
}
