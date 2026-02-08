import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import OpenAI from "openai";

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
// Router prompt: decide if the message needs SQL or is just conversation
// ---------------------------------------------------------------------------
const ROUTER_SYSTEM_PROMPT = `You are a classifier. Given a user message in Hebrew, decide if it requires a database query or is just conversation/greeting.

Reply with EXACTLY one word:
- "SQL" — if the message asks about business data, numbers, finances, suppliers, invoices, income, expenses, goals, employees, products, OR mentions a specific business name, OR asks what data/information is available, OR asks to show/display/list anything related to business.
- "CHAT" — ONLY for simple greetings (היי, שלום, מה קורה), thank you messages, or very general questions about what you can do that don't mention any business or data.

When in doubt, choose SQL.

Examples:
- "היי" → CHAT
- "תודה!" → CHAT
- "מה אתה יכול לעשות?" → CHAT
- "כמה הכנסות היו החודש?" → SQL
- "מי הספק הכי יקר?" → SQL
- "מה ה-food cost?" → SQL
- "השווה חודש שעבר" → SQL
- "מה יש לך על עסק דוגמה?" → SQL
- "תראה לי מידע על ג'וליה" → SQL
- "לאיזה עסקים יש לך גישה?" → SQL
- "מה המצב של כל העסקים?" → SQL`;

// ---------------------------------------------------------------------------
// System prompt: SQL generation
// ---------------------------------------------------------------------------
function buildSqlSystemPrompt(businessId: string): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are a SQL query generator for a business management system (PostgreSQL via Supabase).
You generate READ-ONLY SQL queries based on user questions in Hebrew.

CRITICAL RULES:
1. ONLY generate SELECT queries. Never INSERT, UPDATE, DELETE, DROP, or ALTER.
2. ALWAYS filter by business_id = '${businessId}' in every query.
3. Use the exact table and column names from the schema below.
4. When the user says "החודש" (this month), use the current month and year.
5. When the user says "חודש קודם" or "חודש שעבר" (last month), subtract one month.
6. Return ONLY the raw SQL query. No markdown fences, no explanation, no comments.
7. Limit results to 500 rows maximum (add LIMIT 500 if not present).
8. For percentage calculations, round to 2 decimal places.
9. When joining tables, always use proper aliases for readability.
10. For deleted records, always filter deleted_at IS NULL where the column exists.
11. Today's date is ${today}.
12. NEVER use UNION or UNION ALL.
13. NEVER include SQL comments (-- or /* */).
14. NEVER reference business_id values other than '${businessId}'.

DATABASE SCHEMA:

-- daily_entries: Daily business performance data
-- Columns: id (uuid PK), business_id (uuid FK), entry_date (date), total_register (numeric),
--   labor_cost (numeric), labor_hours (numeric), discounts (numeric), waste (numeric),
--   day_factor (numeric), notes (text), created_by (uuid), created_at, updated_at, deleted_at

-- daily_income_breakdown: Income breakdown per daily entry
-- Columns: id (uuid PK), daily_entry_id (uuid FK -> daily_entries.id),
--   income_source_id (uuid FK -> income_sources.id), amount (numeric), orders_count (integer)

-- daily_summary (VIEW - no deleted_at): Aggregated daily summary
-- Columns: id (uuid), business_id (uuid), entry_date (date), total_register (numeric),
--   labor_cost (numeric), labor_hours (numeric), discounts (numeric), waste (numeric),
--   day_factor (numeric), total_income_breakdown (numeric), food_cost (numeric),
--   labor_cost_pct (numeric), food_cost_pct (numeric), notes (text), created_by (uuid)

-- monthly_summaries: Pre-computed monthly aggregations
-- Columns: id (uuid PK), business_id (uuid FK), year (integer), month (integer),
--   actual_work_days (numeric), total_income (numeric), monthly_pace (numeric)

-- invoices: Supplier invoices
-- Columns: id (uuid PK), business_id (uuid FK), supplier_id (uuid FK -> suppliers.id),
--   invoice_number (text), invoice_date (date), due_date (date), subtotal (numeric),
--   vat_amount (numeric), total_amount (numeric), status (text: pending/paid/partial/clarification),
--   amount_paid (numeric), invoice_type (text), is_consolidated (boolean),
--   notes (text), created_by (uuid), created_at, updated_at, deleted_at

-- payments: Payments to suppliers
-- Columns: id (uuid PK), business_id (uuid FK), supplier_id (uuid FK),
--   payment_date (date), total_amount (numeric), invoice_id (uuid FK),
--   notes (text), receipt_url (text), created_by (uuid), created_at, updated_at, deleted_at

-- payment_splits: Payment method breakdown per payment
-- Columns: id (uuid PK), payment_id (uuid FK -> payments.id), payment_method (text),
--   amount (numeric), credit_card_id (uuid FK), check_number (text),
--   check_date (date), reference_number (text), installments_count (integer),
--   installment_number (integer), due_date (date)

-- suppliers: Supplier information
-- Columns: id (uuid PK), business_id (uuid FK), name (text), expense_type (text: goods/current),
--   expense_category_id (uuid FK), expense_nature (text), contact_name (text),
--   phone (text), email (text), tax_id (text), payment_terms_days (integer),
--   requires_vat (boolean), is_fixed_expense (boolean), monthly_expense_amount (numeric),
--   default_payment_method (text), charge_day (integer), is_active (boolean),
--   vat_type (text), notes (text), created_at, updated_at, deleted_at

-- supplier_balance (VIEW - no deleted_at): Supplier balance summary
-- Columns: supplier_id (uuid), business_id (uuid), supplier_name (text),
--   expense_type (text), total_invoiced (numeric), total_paid (numeric), balance (numeric)

-- supplier_budgets: Monthly budgets per supplier
-- Columns: id (uuid PK), supplier_id (uuid FK), business_id (uuid FK),
--   year (integer), month (integer), budget_amount (numeric), notes (text), deleted_at

-- delivery_notes: Delivery notes from suppliers
-- Columns: id (uuid PK), business_id (uuid FK), supplier_id (uuid FK -> suppliers.id),
--   delivery_note_number (text), delivery_date (date), subtotal (numeric),
--   vat_amount (numeric), total_amount (numeric), invoice_id (uuid FK),
--   is_verified (boolean), notes (text)

-- goals: Business performance goals
-- Columns: id (uuid PK), business_id (uuid FK), year (integer), month (integer),
--   revenue_target (numeric), labor_cost_target_pct (numeric),
--   food_cost_target_pct (numeric), operating_cost_target_pct (numeric),
--   profit_target (numeric), profit_margin_target_pct (numeric),
--   current_expenses_target (numeric), goods_expenses_target (numeric), deleted_at

-- income_sources: Types of income (delivery apps, cash, credit, etc.)
-- Columns: id (uuid PK), business_id (uuid FK), name (text),
--   income_type (text), input_type (text), commission_rate (numeric),
--   display_order (integer), is_active (boolean), deleted_at

-- managed_products: Inventory products
-- Columns: id (uuid PK), business_id (uuid FK), name (text), unit (text),
--   unit_cost (numeric), category (text), current_stock (numeric),
--   target_pct (numeric), is_active (boolean), deleted_at

-- expense_categories: Hierarchical expense categories
-- Columns: id (uuid PK), business_id (uuid FK), parent_id (uuid FK self-ref),
--   name (text), description (text), display_order (integer), is_active (boolean), deleted_at

-- businesses: Business configuration
-- Columns: id (uuid PK), name (text), business_type (text), tax_id (text),
--   vat_percentage (numeric), markup_percentage (numeric),
--   manager_monthly_salary (numeric), currency (text)

-- business_credit_cards: Credit cards for the business
-- Columns: id (uuid PK), business_id (uuid FK), card_name (text),
--   last_four_digits (text), card_type (text), billing_day (integer),
--   credit_limit (numeric), is_active (boolean), deleted_at

COMMON QUERY PATTERNS:
- Total income this month: SUM(total_register) FROM daily_entries WHERE business_id='${businessId}' AND entry_date >= date_trunc('month', CURRENT_DATE) AND deleted_at IS NULL
- Total income last month: SUM(total_register) FROM daily_entries WHERE business_id='${businessId}' AND entry_date >= date_trunc('month', CURRENT_DATE - interval '1 month') AND entry_date < date_trunc('month', CURRENT_DATE) AND deleted_at IS NULL
- Labor cost %: Use daily_summary view which has labor_cost_pct
- Food cost %: Use daily_summary view which has food_cost_pct
- Supplier balances: SELECT * FROM supplier_balance WHERE business_id='${businessId}'
- Compare to goals: JOIN monthly_summaries or daily_summary aggregated with goals table
- Top suppliers by spend: SUM(total_amount) FROM invoices GROUP BY supplier_id, filtered by date
- Fixed expenses: suppliers WHERE is_fixed_expense = true AND business_id='${businessId}'
- Income by source: JOIN daily_income_breakdown with income_sources via daily_entries`;
}

// ---------------------------------------------------------------------------
// System prompt: SQL generation for admin cross-business queries
// ---------------------------------------------------------------------------
function buildAdminCrossBizSqlPrompt(businesses: Array<{ id: string; name: string }>): string {
  const today = new Date().toISOString().split("T")[0];
  const bizList = businesses.map((b) => `- "${b.name}" → '${b.id}'`).join("\n");

  return `You are a SQL query generator for a business management system (PostgreSQL via Supabase).
You generate READ-ONLY SQL queries based on user questions in Hebrew.
The user is an ADMIN who can query any business or compare between businesses.

CRITICAL RULES:
1. ONLY generate SELECT queries. Never INSERT, UPDATE, DELETE, DROP, or ALTER.
2. When the user mentions a business by name, use the matching business_id from the list below.
3. When the user asks about "all businesses" or does not specify a business, query across all businesses and JOIN with the businesses table to show the business name.
4. Use the exact table and column names from the schema below.
5. When the user says "החודש" (this month), use the current month and year.
6. When the user says "חודש קודם" or "חודש שעבר" (last month), subtract one month.
7. Return ONLY the raw SQL query. No markdown fences, no explanation, no comments.
8. Limit results to 500 rows maximum (add LIMIT 500 if not present).
9. For percentage calculations, round to 2 decimal places.
10. When joining tables, always use proper aliases for readability.
11. For deleted records, always filter deleted_at IS NULL where the column exists.
12. Today's date is ${today}.
13. NEVER use UNION or UNION ALL.
14. NEVER include SQL comments (-- or /* */).

AVAILABLE BUSINESSES:
${bizList}

DATABASE SCHEMA:

-- businesses: Business configuration
-- Columns: id (uuid PK), name (text), business_type (text), tax_id (text),
--   vat_percentage (numeric), markup_percentage (numeric),
--   manager_monthly_salary (numeric), currency (text)

-- daily_entries: Daily business performance data
-- Columns: id (uuid PK), business_id (uuid FK), entry_date (date), total_register (numeric),
--   labor_cost (numeric), labor_hours (numeric), discounts (numeric), waste (numeric),
--   day_factor (numeric), notes (text), created_by (uuid), created_at, updated_at, deleted_at

-- daily_income_breakdown: Income breakdown per daily entry
-- Columns: id (uuid PK), daily_entry_id (uuid FK -> daily_entries.id),
--   income_source_id (uuid FK -> income_sources.id), amount (numeric), orders_count (integer)

-- daily_summary (VIEW - no deleted_at): Aggregated daily summary
-- Columns: id (uuid), business_id (uuid), entry_date (date), total_register (numeric),
--   labor_cost (numeric), labor_hours (numeric), discounts (numeric), waste (numeric),
--   day_factor (numeric), total_income_breakdown (numeric), food_cost (numeric),
--   labor_cost_pct (numeric), food_cost_pct (numeric), notes (text), created_by (uuid)

-- monthly_summaries: Pre-computed monthly aggregations
-- Columns: id (uuid PK), business_id (uuid FK), year (integer), month (integer),
--   actual_work_days (numeric), total_income (numeric), monthly_pace (numeric)

-- invoices: Supplier invoices
-- Columns: id (uuid PK), business_id (uuid FK), supplier_id (uuid FK -> suppliers.id),
--   invoice_number (text), invoice_date (date), due_date (date), subtotal (numeric),
--   vat_amount (numeric), total_amount (numeric), status (text: pending/paid/partial/clarification),
--   amount_paid (numeric), invoice_type (text), is_consolidated (boolean),
--   notes (text), created_by (uuid), created_at, updated_at, deleted_at

-- payments: Payments to suppliers
-- Columns: id (uuid PK), business_id (uuid FK), supplier_id (uuid FK),
--   payment_date (date), total_amount (numeric), invoice_id (uuid FK),
--   notes (text), receipt_url (text), created_by (uuid), created_at, updated_at, deleted_at

-- suppliers: Supplier information
-- Columns: id (uuid PK), business_id (uuid FK), name (text), expense_type (text: goods/current),
--   expense_category_id (uuid FK), expense_nature (text), contact_name (text),
--   phone (text), email (text), tax_id (text), payment_terms_days (integer),
--   requires_vat (boolean), is_fixed_expense (boolean), monthly_expense_amount (numeric),
--   default_payment_method (text), charge_day (integer), is_active (boolean),
--   vat_type (text), notes (text), created_at, updated_at, deleted_at

-- supplier_balance (VIEW - no deleted_at): Supplier balance summary
-- Columns: supplier_id (uuid), business_id (uuid), supplier_name (text),
--   expense_type (text), total_invoiced (numeric), total_paid (numeric), balance (numeric)

-- goals: Business performance goals
-- Columns: id (uuid PK), business_id (uuid FK), year (integer), month (integer),
--   revenue_target (numeric), labor_cost_target_pct (numeric),
--   food_cost_target_pct (numeric), operating_cost_target_pct (numeric),
--   profit_target (numeric), profit_margin_target_pct (numeric),
--   current_expenses_target (numeric), goods_expenses_target (numeric), deleted_at

-- income_sources: Types of income (delivery apps, cash, credit, etc.)
-- Columns: id (uuid PK), business_id (uuid FK), name (text),
--   income_type (text), input_type (text), commission_rate (numeric),
--   display_order (integer), is_active (boolean), deleted_at

-- managed_products: Inventory products
-- Columns: id (uuid PK), business_id (uuid FK), name (text), unit (text),
--   unit_cost (numeric), category (text), current_stock (numeric),
--   target_pct (numeric), is_active (boolean), deleted_at

-- expense_categories: Hierarchical expense categories
-- Columns: id (uuid PK), business_id (uuid FK), parent_id (uuid FK self-ref),
--   name (text), description (text), display_order (integer), is_active (boolean), deleted_at

-- business_credit_cards: Credit cards for the business
-- Columns: id (uuid PK), business_id (uuid FK), card_name (text),
--   last_four_digits (text), card_type (text), billing_day (integer),
--   credit_limit (numeric), is_active (boolean), deleted_at

-- payment_splits: Payment method breakdown per payment
-- Columns: id (uuid PK), payment_id (uuid FK -> payments.id), payment_method (text),
--   amount (numeric), credit_card_id (uuid FK), check_number (text),
--   check_date (date), reference_number (text), installments_count (integer),
--   installment_number (integer), due_date (date)

-- supplier_budgets: Monthly budgets per supplier
-- Columns: id (uuid PK), supplier_id (uuid FK), business_id (uuid FK),
--   year (integer), month (integer), budget_amount (numeric), notes (text), deleted_at

-- delivery_notes: Delivery notes from suppliers
-- Columns: id (uuid PK), business_id (uuid FK), supplier_id (uuid FK -> suppliers.id),
--   delivery_note_number (text), delivery_date (date), subtotal (numeric),
--   vat_amount (numeric), total_amount (numeric), invoice_id (uuid FK),
--   is_verified (boolean), notes (text)

COMMON QUERY PATTERNS FOR ADMIN:
- Compare income across businesses: JOIN daily_entries with businesses ON business_id = businesses.id, GROUP BY businesses.name
- Total income for a specific business: Use the business_id from the list above
- All supplier balances: SELECT sb.*, b.name as business_name FROM supplier_balance sb JOIN businesses b ON sb.business_id = b.id
- When user asks "what info do you have on X" or "show me X business": query businesses table + daily_entries count + invoices count to show summary
- When user asks about all businesses: SELECT b.name, COUNT(de.id) as entries, SUM(de.total_register) as total FROM businesses b LEFT JOIN daily_entries de ON ...
- Fixed expenses per business: JOIN suppliers with businesses, filter is_fixed_expense = true`;
}

// ---------------------------------------------------------------------------
// System prompt: Response formatting (used for SQL result formatting)
// ---------------------------------------------------------------------------
function buildResponseSystemPrompt(userName: string, userRole: string): string {
  const userContext = userName ? `המשתמש: ${userName} (${userRole}). פנה אליו בשמו הפרטי.` : "";

  return `אתה אנליסט עסקי מומחה בשם "העוזר של המצפן" למערכת ניהול עסקית.
אתה מקבל שאלת משתמש, שאילתת SQL שהורצה, ותוצאות. פרמט תשובה ברורה ומקצועית.
${userContext}

## כללי פורמט בסיסיים
1. תמיד ענה בעברית.
2. פרמט עם Markdown: כותרות (##), טבלאות, **בולד**, נקודות.
3. השתמש ב-₪ למטבע ופרמט מספרים עם פסיקים (למשל: ₪185,400).
4. אם לא הוחזרו נתונים (מערך ריק), אמור שלא נמצאו נתונים לתקופה/שאילתה המבוקשת.
5. אם השאילתה נכשלה, אמור למשתמש בעברית פשוטה לנסות לנסח אחרת. אל תחשוף פרטים טכניים.
6. השתמש באימוג'ים בכותרות למשל: 💰 הכנסות, 👷 עלות עובדים, 📦 עלות מכר, 🏢 הוצאות שוטפות, 🎯 יעדים

## כללי פרשנות נתונים - חובה!

**הכנסות:**
• מינוס = לא טוב (פחות מהיעד) - חובה לציין!
• פלוס = טוב (יותר מהיעד) - חובה לציין!

**הוצאות (עלות עובדים, עלות מכר וכו'):**
• מינוס = טוב (חסכון מהיעד) - חובה לציין!
• פלוס = לא טוב (חריגה מהיעד) - חובה לציין!

**חובה בכל סיכום:**
• צפי (קצב) לסיום החודש כשרלוונטי
• אסמכתאות וסכומים - לא טקסט כללי!
• סיכום שמאפשר למשתמש להסיק תובנות ומסקנות

## דוגמה לתשובה מושלמת (כתבנית - החלף מספרים בנתונים האמיתיים):

הי [שם],

הנה סיכום הנתונים:

💰 סה"כ הכנסות כולל מע"מ: XXX,XXX ש"ח
• הפרש של X.XX% מהיעד (XXX ש"ח פחות/יותר מהיעד)
• **צפי לסיום החודש: XXX,XXX ש"ח**
• שינוי של X% לעומת החודש הקודם

👷 עלות עובדים: XX.XX% מההכנסות
• הפרש של X.XX% טוב יותר/גרוע מהיעד שחסך/עלה לך X,XXX ש"ח עד היום

📦 עלות מכר: XX.XX% מההכנסות
• הפרש של X.XX% מהיעד, חסכון/חריגה של X,XXX ש"ח עד היום

🏢 הוצאות שוטפות: XX,XXX ש"ח
• שינוי של X% מהיעד

**לסיכום:** [תובנה כוללת עם המלצה אם יש חריגה]

## שגיאות נפוצות שאסור לעשות:

❌ שגוי: "עלות עובדים: 177,436 ש"ח, שהם 32.83% מההכנסות"
✅ נכון: "עלות עובדים 32.83% - הפרש של X% טוב יותר מהיעד שחסך לך Y ש"ח עד היום"

❌ שגוי: "הפרש כספי של 8,969 ש"ח מהיעד"
✅ נכון: "ששווה לך 8,969 שקל שהיו יכולים להיות אצלך בקופה"

❌ שגוי: להוסיף כותרת "המלצות לשיפור:" בנפרד
✅ נכון: לכתוב המלצות בתוך פסקת הסיכום

❌ שגוי: "עלות מכר: 113,050 ש"ח" (בלי אחוזים והפרש)
✅ נכון: "עלות מכר: XX% - הפרש של Y% מהיעד שעלה/חסך Z ש"ח"

## ניהול ספקים
• כששואלים "כמה אני פתוח אצל ספק?": תן סכום "נותר לתשלום" כולל מע"מ
• כשמבקשים פירוט ספק: הצג טבלה עם תאריך | מספר חשבונית | סכום כולל מע"מ | סטטוס

## ניהול תשלומים
• כששואלים על אמצעי תשלום: פרט לפי סוג תשלום
• כששואלים "מה צפי התשלומים?": רשימת כל התשלומים הצפויים מהיום והלאה
• כששואלים "כמה אני חייב?": טבלת תשלומים פתוחים + סה"כ

## יעדים ושיפור
• כששואלים "איך לשפר?": הבא נתונים מהעבר מול הנוכחי, השווה, והסבר מאיפה הפער
• כששואלים "איפה החריגות?": נתח ומצא חריגות אמיתיות. אם אין - אמור בחיוב!
• כששואלים "איך לשפר עלות עובדים?": התאם לפי - אם הבעיה בהכנסות, או בשעות

## כללים קשיחים
• אסור להמציא נתונים - רק מה שקיבלת מהשאילתה!
• אסור להשתמש במילים: קריטי, דחוף, חייב, מסוכן, בעיה, משבר
• אסור לתת מחירים של חברת המצפן
• אסור להבטיח תוצאות ספציפיות
• אם יש חריגה שלילית - הוסף המלצה בתוך הסיכום (לא בנפרד!)
• סיים בחום: "אם תרצה, אוכל לעזור בבדיקת הנתונים או להציע דרכי שיפור."

## פורמט גרף
אם הנתונים תומכים בהמחשה (השוואות, מגמות, התפלגויות עם 2+ נקודות נתונים), הוסף בלוק קוד בסוף התשובה עם תג "chart-json":

\`\`\`chart-json
{
  "type": "bar",
  "title": "כותרת גרף בעברית",
  "xAxisKey": "fieldName",
  "data": [{"fieldName": "תווית", "value1": 123}],
  "dataKeys": [{"key": "value1", "label": "תווית עברית", "color": "#6366f1"}]
}
\`\`\`

צבעים זמינים: #6366f1 (אינדיגו), #22c55e (ירוק), #f59e0b (ענבר), #ef4444 (אדום), #3b82f6 (כחול), #8b5cf6 (סגול), #94a3b8 (אפור).
הוסף גרף רק כשזה מוסיף ערך אמיתי. אל תוסיף גרף לתשובות של מספר בודד.`;
}

// ---------------------------------------------------------------------------
// System prompt: conversational (non-SQL) chat
// ---------------------------------------------------------------------------
function buildChatSystemPrompt(userName: string, userType: string): string {
  const greeting = userName ? `המשתמש שמדבר איתך הוא ${userName} (${userType}). פנה אליו בשמו הפרטי.` : "";
  return `אתה עוזר עסקי חכם בשם "העוזר של המצפן". אתה מדבר בעברית.
${greeting}

יש לך גישה מלאה למסד הנתונים של המערכת ואתה יכול לענות על כל שאלה עסקית. היכולות שלך כוללות:
- שליפת נתונים על הכנסות, הוצאות, ספקים, תשלומים, חשבוניות
- השוואה בין תקופות וחודשים
- הצגת מצב מול יעדים עם אחוזים והפרשים כספיים
- ניתוח עלויות עבודה ו-food cost
- הצגת יתרות ספקים ופירוט חשבוניות
- השוואה בין עסקים (למנהלי מערכת)
- צפי לסיום חודש ומגמות
- המלצות לשיפור רווחיות מבוססות נתונים

חשוב: אם המשתמש שואל שאלה שדורשת נתונים, עודד אותו לשאול ישירות (למשל: "כמה הכנסות היו החודש?" או "מה היתרה של הספקים?") כדי שתוכל לשלוף את המידע.

כשמישהו אומר שלום או מה קורה, ענה בקצרה ובחום, פנה אליו בשמו אם ידוע, וציין מה אתה יכול לעשות בשבילו. דוגמה:
"היי [שם]! אני כאן כדי לעזור לך עם כל שאלה על העסק - הכנסות, הוצאות, ספקים, יעדים ועוד. מה תרצה לבדוק?"

לעולם אל תגיד שאין לך גישה לנתונים או לעסקים - יש לך גישה מלאה.
אסור להשתמש במילים: קריטי, דחוף, חייב, מסוכן, בעיה, משבר.
תהיה ידידותי, מקצועי וקצר.`;
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
    .trim();
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
    // Update session's updated_at
    await adminSb
      .from("ai_chat_sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sId);
  } catch (err) {
    console.error("Failed to save message:", err);
  }
}

// ---------------------------------------------------------------------------
// SSE stream helper
// ---------------------------------------------------------------------------
function createSSEStream(
  streamFn: (writer: {
    writeText: (text: string) => void;
    writeChart: (chart: unknown) => void;
    writeDone: () => void;
    writeError: (msg: string) => void;
  }) => Promise<void>
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const writer = {
        writeText(text: string) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: text })}\n\n`));
        },
        writeChart(chart: unknown) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "chart", chartData: chart })}\n\n`));
        },
        writeDone() {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          controller.close();
        },
        writeError(msg: string) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`));
          controller.close();
        },
      };

      try {
        await streamFn(writer);
      } catch (err) {
        console.error("Stream error:", err);
        try {
          writer.writeError("שגיאה פנימית. נסה שוב.");
        } catch {
          // Controller may already be closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
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

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 30_000,
  });

  // 2. Parse request body safely
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "בקשה לא תקינה" }, 400);
  }

  const message = typeof body.message === "string" ? body.message : "";
  const businessId = typeof body.businessId === "string" ? body.businessId : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const history = Array.isArray(body.history) ? body.history : [];

  if (!message) {
    return jsonResponse({ error: "חסרים נתונים" }, 400);
  }
  if (message.length > 2000) {
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

  // Non-admin must provide a businessId
  if (!isAdmin && !businessId) {
    return jsonResponse({ error: "חסרים נתונים" }, 400);
  }

  // Admin cross-business mode: fetch all businesses for the SQL prompt
  let allBusinesses: Array<{ id: string; name: string }> = [];
  if (isAdmin && !businessId) {
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

  // 6. Filter & validate history
  const recentHistory = history.slice(-6).filter(
    (h: unknown): h is { role: "user" | "assistant"; content: string } =>
      typeof h === "object" &&
      h !== null &&
      "role" in h &&
      "content" in h &&
      typeof (h as Record<string, unknown>).content === "string"
  );

  // 7. Route: decide SQL vs CHAT
  const routerCompletion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: ROUTER_SYSTEM_PROMPT },
      { role: "user", content: message },
    ],
    temperature: 0,
    max_tokens: 5,
  });
  const route = (routerCompletion.choices[0].message.content?.trim().toUpperCase() || "").startsWith("SQL")
    ? "SQL"
    : "CHAT";

  // =========================================================================
  // CHAT path: stream conversational response directly
  // =========================================================================
  if (route === "CHAT") {
    // Save user message to DB
    if (sessionId) {
      saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "user", message);
    }

    return createSSEStream(async (writer) => {
      const chatStream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: buildChatSystemPrompt(userName, userRole) },
          ...recentHistory.map((h) => ({
            role: h.role as "user" | "assistant",
            content: h.content.slice(0, 1000),
          })),
          { role: "user", content: message },
        ],
        temperature: 0.7,
        max_tokens: 500,
        stream: true,
      });

      let fullChatResponse = "";
      for await (const chunk of chatStream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullChatResponse += delta;
          writer.writeText(delta);
        }
      }

      // Save assistant response to DB
      if (sessionId && fullChatResponse) {
        saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "assistant", fullChatResponse);
      }

      writer.writeDone();
    });
  }

  // =========================================================================
  // SQL path: generate SQL → execute → stream formatted response
  // =========================================================================
  const isAdminCrossBiz = isAdmin && !businessId;

  // Save user message to DB
  if (sessionId) {
    saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "user", message);
  }

  return createSSEStream(async (writer) => {
    // --- Step A: Generate SQL ---
    const sqlSystemPrompt = isAdminCrossBiz
      ? buildAdminCrossBizSqlPrompt(allBusinesses)
      : buildSqlSystemPrompt(businessId);
    const sqlCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sqlSystemPrompt },
        ...recentHistory.map((h) => ({
          role: h.role as "user" | "assistant",
          content: h.content.slice(0, 1000),
        })),
        { role: "user", content: message },
      ],
      temperature: 0,
      max_tokens: 1500,
    });

    const rawSql = sqlCompletion.choices[0].message.content?.trim() || "";
    const sql = stripSqlFences(rawSql);

    // --- Step B: Validate SQL ---
    const sqlLower = sql.toLowerCase().trimStart();
    if (!sqlLower.startsWith("select") && !sqlLower.startsWith("with")) {
      writer.writeText("לא הצלחתי לייצר שאילתה מתאימה. נסה לנסח את השאלה אחרת.");
      writer.writeDone();
      return;
    }
    if (FORBIDDEN_SQL.test(sql)) {
      writer.writeText("השאילתה מכילה פעולות אסורות. נסה לנסח את השאלה אחרת.");
      writer.writeDone();
      return;
    }
    if (sql.includes("--") || sql.includes("/*")) {
      writer.writeText("השאילתה מכילה תחביר לא מורשה. נסה לנסח את השאלה אחרת.");
      writer.writeDone();
      return;
    }
    if (!isAdminCrossBiz && !sql.includes(businessId)) {
      writer.writeText("לא הצלחתי ליצור שאילתה מתאימה. נסה שוב.");
      writer.writeDone();
      return;
    }

    // --- Step C: Execute SQL ---
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let queryResult: unknown = [];
    let queryErrorOccurred = false;

    const { data, error: rpcError } = await adminSupabase.rpc("read_only_query", {
      sql_query: sql,
    });

    if (rpcError) {
      console.error("SQL execution error:", rpcError);
      queryErrorOccurred = true;
    } else {
      queryResult = data || [];
    }

    const resultRows = Array.isArray(queryResult) ? queryResult : [];
    const truncatedResults = resultRows.length > 100 ? resultRows.slice(0, 100) : resultRows;

    // --- Step D: Stream formatted response ---
    const responseStream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: buildResponseSystemPrompt(userName, userRole) },
        {
          role: "user",
          content: [
            `שאלת המשתמש: ${message}`,
            ``,
            `שאילתת SQL שהורצה:`,
            sql,
            ``,
            `תוצאות (${resultRows.length} שורות${resultRows.length > 100 ? ", מוצגות 100 ראשונות" : ""}):`,
            JSON.stringify(truncatedResults, null, 2),
            queryErrorOccurred
              ? "\nהשאילתה נכשלה. הסבר למשתמש בעברית שכדאי לנסח את השאלה אחרת."
              : "",
          ].join("\n"),
        },
      ],
      temperature: 0.7,
      max_tokens: 4000,
      stream: true,
    });

    let fullResponse = "";
    let chartBlockStarted = false;
    for await (const chunk of responseStream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullResponse += delta;

        if (chartBlockStarted) {
          // Already inside chart block — don't stream
          continue;
        }

        // Check if the chart block just started in this chunk
        const chartIdx = fullResponse.indexOf("```chart-json");
        if (chartIdx !== -1) {
          chartBlockStarted = true;
          // Stream only the text portion before the chart block
          const textBefore = fullResponse.slice(0, chartIdx);
          const alreadySent = fullResponse.length - delta.length;
          const unsent = textBefore.slice(alreadySent);
          if (unsent) writer.writeText(unsent);
        } else {
          writer.writeText(delta);
        }
      }
    }

    // Parse chart data from the full response
    let parsedChartData: unknown = null;
    const chartMatch = fullResponse.match(/```chart-json\n([\s\S]*?)\n```/);
    if (chartMatch) {
      try {
        parsedChartData = JSON.parse(chartMatch[1]);
        writer.writeChart(parsedChartData);
      } catch {
        // Invalid chart JSON, ignore
      }
    }

    // Save assistant response to DB (text without chart block)
    if (sessionId && fullResponse) {
      const textContent = chartMatch
        ? fullResponse.slice(0, fullResponse.indexOf("```chart-json")).trim()
        : fullResponse;
      saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "assistant", textContent, parsedChartData);
    }

    writer.writeDone();
  });
}
