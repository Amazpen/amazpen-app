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
const ROUTER_SYSTEM_PROMPT = `You are a classifier. Given a user message in Hebrew (with optional conversation history), decide what type of action is needed.

Reply with EXACTLY one word:
- "SQL" — if the message asks about business data, numbers, finances, suppliers, invoices, income, expenses, goals, employees, products, OR mentions a specific business name, OR asks what data/information is available, OR asks to show/display/list anything related to business.
- "CALC" — if the message is a math/calculation question NOT related to business data. Pure arithmetic, percentages, conversions, tip calculations, VAT calculations on a given number, etc.
- "CHAT" — ONLY for simple greetings (היי, שלום, מה קורה), thank you messages, or very general questions about what you can do that don't mention any business or data.

CRITICAL — CONVERSATION CONTEXT RULES:
- You will see recent conversation history. Use it to understand follow-up messages.
- If previous messages were about business data (SQL queries), follow-ups should almost always be SQL too.
- Short follow-ups like "ומה לגבי...?", "תראה לי עוד", "פרט יותר", "ומה עם...?" after data → SQL.
- "תודה" or "מעולה" alone after data → CHAT.
- "תודה, ועכשיו תראה לי..." → SQL (contains a new request).
- When in doubt and there was recent data discussion → SQL.

When in doubt between CALC and SQL, choose SQL (business data always needs SQL).
When in doubt between CALC and CHAT, choose CALC.

Examples (standalone):
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
- "מה המצב של כל העסקים?" → SQL
- "כמה זה 15% מ-1200?" → CALC
- "חשב לי 340 כפול 12" → CALC
- "כמה זה 5000 פלוס מעמ?" → CALC
- "מה זה 18 אחוז מ-50000?" → CALC
- "תחלק 9000 ל-3" → CALC
- "כמה זה 1200 דולר בשקלים?" → CALC

Examples (follow-ups after business data was shown):
- "ומה לגבי חודש שעבר?" → SQL
- "תפרט יותר" → SQL
- "תראה לי גרף" → SQL
- "ומה עם ספק X?" → SQL
- "השווה את זה לשנה שעברה" → SQL
- "תסכם לי" → SQL
- "בשביל כל העסקים" → SQL
- "בלי מעמ" → SQL`;

// ---------------------------------------------------------------------------
// System prompt: SQL generation
// ---------------------------------------------------------------------------
function buildSqlSystemPrompt(businessId: string): string {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const israelTime = now.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "full", timeStyle: "short" });

  return `You are a SQL query generator for a business management system (PostgreSQL via Supabase).
You generate READ-ONLY SQL queries based on user questions in Hebrew.

CRITICAL RULES:
1. ONLY generate SELECT queries. Never INSERT, UPDATE, DELETE, DROP, or ALTER.
2. ALWAYS filter by business_id = '${businessId}' in every query.
3. Use the exact table and column names from the schema below.
4. ALWAYS prefix ALL table names with "public." — e.g. public.daily_entries, public.suppliers, public.goals. This is REQUIRED for every table and view in FROM and JOIN clauses.
5. When the user says "החודש" (this month), use the current month and year.
6. When the user says "חודש קודם" or "חודש שעבר" (last month), subtract one month.
7. Return ONLY the raw SQL query. No markdown fences, no explanation, no comments.
8. Limit results to 500 rows maximum (add LIMIT 500 if not present).
9. For percentage calculations, round to 2 decimal places.
10. When joining tables, always use proper aliases for readability.
11. For deleted records, always filter deleted_at IS NULL where the column exists.
12. Today's date is ${today}. Current date and time in Israel: ${israelTime}.
13. NEVER use UNION or UNION ALL.
14. NEVER include SQL comments (-- or /* */).
15. NEVER reference business_id values other than '${businessId}'.

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

-- monthly_summaries: Pre-computed monthly aggregations (includes historical data imported from CSV)
-- Columns: id (uuid PK), business_id (uuid FK), year (integer), month (integer),
--   actual_work_days (numeric), total_income (numeric), monthly_pace (numeric),
--   labor_cost_pct (numeric), labor_cost_amount (numeric), food_cost_pct (numeric), food_cost_amount (numeric),
--   managed_product_1_pct (numeric), managed_product_1_cost (numeric),
--   managed_product_2_pct (numeric), managed_product_2_cost (numeric),
--   managed_product_3_pct (numeric), managed_product_3_cost (numeric),
--   avg_income_1 (numeric), avg_income_2 (numeric), avg_income_3 (numeric), avg_income_4 (numeric),
--   sales_budget_diff_pct (numeric), labor_budget_diff_pct (numeric), food_cost_budget_diff (numeric),
--   sales_yoy_change_pct (numeric), labor_cost_yoy_change_pct (numeric), food_cost_yoy_change_pct (numeric)
-- NOTE: For historical months (no daily_entries), use monthly_summaries for labor/food cost data.
-- Percentage columns store decimal values (e.g. 0.325 = 32.5%).

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
--   current_expenses_target (numeric), goods_expenses_target (numeric),
--   markup_percentage (numeric, monthly override), vat_percentage (numeric, monthly override), deleted_at

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

CALCULATION FORMULAS — MUST use these exact formulas to match the dashboard display:

1. הכנסה לפני מע"מ (income before VAT):
   income_before_vat = SUM(total_register) / (1 + vat_percentage)
   vat_percentage: use goals.vat_percentage for the month if set, otherwise businesses.vat_percentage as fallback.

2. צפי חודשי (monthly pace) — this is how the dashboard forecasts total monthly income:
   Step 1: sum_actual_day_factors = SUM(day_factor) FROM daily_entries for the selected period
   Step 2: expected_monthly_work_days = for each day in the calendar month, look up business_schedule.day_factor for that day_of_week and sum them all
   Step 3: daily_average = total_income / sum_actual_day_factors
   Step 4: monthly_pace = daily_average × expected_monthly_work_days
   IMPORTANT: The monthly pace is a FORECAST of what the total month will look like based on actual performance so far.

3. עלות עובדים (labor cost) — NOT from daily_summary view:
   markup = goals.markup_percentage for the month if set, otherwise businesses.markup_percentage (default 1)
   manager_monthly_salary = businesses.manager_monthly_salary
   expected_work_days_in_month = calculated from business_schedule (same as step 2 above)
   manager_daily_cost = manager_monthly_salary / expected_work_days_in_month
   actual_work_days = SUM(day_factor) FROM daily_entries
   labor_cost_total = (SUM(labor_cost from daily_entries) + manager_daily_cost × actual_work_days) × markup
   labor_cost_pct = labor_cost_total / income_before_vat × 100
   labor_cost_diff_pct = labor_cost_pct - goals.labor_cost_target_pct
   labor_cost_diff_amount = labor_cost_diff_pct × income_before_vat / 100

4. הפרש הכנסות מהיעד (target difference):
   target_diff_pct = (monthly_pace / revenue_target - 1) × 100
   daily_diff = (monthly_pace - revenue_target) / expected_monthly_work_days
   target_diff_amount = daily_diff × sum_actual_day_factors
   revenue_target comes from goals.revenue_target for the month.

5. עלות מכר (food/goods cost) — from INVOICES, not daily_summary:
   food_cost = SUM(invoices.subtotal) WHERE supplier_id IN (SELECT id FROM suppliers WHERE expense_type = 'goods_purchases' AND business_id = X)
   food_cost_pct = food_cost / income_before_vat × 100
   food_cost_diff_pct = food_cost_pct - goals.food_cost_target_pct

6. הוצאות שוטפות (current expenses) — from INVOICES:
   current_expenses = SUM(invoices.subtotal) WHERE supplier_id IN (SELECT id FROM suppliers WHERE expense_type = 'current_expenses' AND business_id = X)
   current_expenses_pct = current_expenses / income_before_vat × 100
   current_expenses_target comes from goals.current_expenses_target (in ILS)
   current_expenses_target_pct = current_expenses_target / income_before_vat × 100
   current_expenses_diff_pct = current_expenses_pct - current_expenses_target_pct

7. מוצרים מנוהלים (managed products, e.g. salmon):
   total_cost = managed_products.unit_cost × SUM(daily_product_usage.quantity)
   product_pct = total_cost / income_before_vat × 100
   diff_pct = product_pct - managed_products.target_pct

8. מקורות הכנסה (income sources avg ticket):
   avg_ticket = SUM(daily_income_breakdown.amount) / SUM(daily_income_breakdown.orders_count) per income_source_id
   target = income_source_goals.avg_ticket_target
   diff_per_order = avg_ticket - target
   total_diff_amount = diff_per_order × total_orders_count

COMMON QUERY PATTERNS:
- Total income this month: SUM(total_register) FROM public.daily_entries WHERE business_id='${businessId}' AND entry_date >= date_trunc('month', CURRENT_DATE) AND deleted_at IS NULL
- Total income last month: SUM(total_register) FROM public.daily_entries WHERE business_id='${businessId}' AND entry_date >= date_trunc('month', CURRENT_DATE - interval '1 month') AND entry_date < date_trunc('month', CURRENT_DATE) AND deleted_at IS NULL
- Labor cost: Use formula #3 above — query daily_entries for labor_cost + day_factor, businesses for manager_monthly_salary + markup, goals for targets. Do NOT use daily_summary view for labor cost calculations.
- Food cost: Use formula #5 above — query invoices via suppliers with expense_type='goods_purchases'. Do NOT use daily_summary view for food cost calculations.
- Current expenses: Use formula #6 above — query invoices via suppliers with expense_type='current_expenses'.
- Monthly pace: Use formula #2 above — query daily_entries + business_schedule.
- Supplier balances: SELECT * FROM public.supplier_balance WHERE business_id='${businessId}'
- Compare to goals: Use the formulas above with data from public.goals
- Top suppliers by spend: SUM(total_amount) FROM public.invoices GROUP BY supplier_id, filtered by date
- Fixed expenses: public.suppliers WHERE is_fixed_expense = true AND business_id='${businessId}'
- Income by source: JOIN public.daily_income_breakdown with public.income_sources via public.daily_entries
- Historical labor/food cost: SELECT year, month, total_income, labor_cost_pct, food_cost_pct, food_cost_amount, labor_cost_amount FROM public.monthly_summaries WHERE business_id='${businessId}' (for months without daily_entries)
- YoY comparison: Use sales_yoy_change_pct from public.monthly_summaries for historical year-over-year data

FAQ — COMMON USER QUESTIONS AND THE QUERIES THEY NEED:

"איך החודש שלי?" / "סיכום חודשי":
Generate a query that returns: total income, labor cost %, food cost %, goals vs actual, work days count.
Use public.daily_summary + public.goals table JOIN for the current month.

"מי הספק הכי יקר?" / "מה עולה לי הכי הרבה?":
SUM(total_amount) FROM public.invoices GROUP BY supplier_id JOIN public.suppliers for name, ORDER BY sum DESC LIMIT 5, filtered by current month.

"כמה אני פתוח אצל ספק X?":
Use public.supplier_balance view filtered by supplier name (ILIKE '%X%').

"מה צפי התשלומים?" / "כמה כסף עתיד לרדת?":
Query public.invoices WHERE status IN ('pending','partial') AND due_date >= CURRENT_DATE, with supplier name JOIN from public.suppliers.

"כמה הרווחתי?":
Total income minus total expenses (invoices + labor cost) for the period. Use daily_entries for income + labor cost (with markup + manager salary formula), public.invoices for supplier costs.

"איפה החריגות?":
Compare actual vs goals using the CALCULATION FORMULAS above. Show income gap vs revenue_target, labor cost % vs labor_cost_target_pct, food cost % vs food_cost_target_pct.

"כמה יורד לי בכרטיס אשראי?":
Query public.payment_splits WHERE payment_method = 'credit_card' AND due_date >= CURRENT_DATE AND due_date <= end of month, JOIN public.payments + public.suppliers.

"כמה הלוואות יש לי?":
Query public.suppliers WHERE expense_nature ILIKE '%הלוואה%' OR expense_nature ILIKE '%loan%', with their invoices/payments summary.

"איך עלות המכר/הסחורה?":
Use formula #5: SUM(invoices.subtotal) from suppliers with expense_type='goods_purchases', divided by income_before_vat, compared with goals.food_cost_target_pct.

"מה הצפי החודשי?" / "מה הקצב?":
Use formula #2: query daily_entries for total_register + day_factor, business_schedule for expected work days, calculate monthly_pace.

"מה עלות העובדים?" / "כמה עולים לי העובדים?":
Use formula #3: query daily_entries for labor_cost + day_factor, businesses for manager_monthly_salary + markup_percentage, goals for overrides + targets.

"כמה הכנסות היו היום/אתמול?":
Query daily_entries for the specific date. Also fetch the monthly average for comparison: total_income / count_entries for the current month.

"איזה יום היה הכי חזק/חלש החודש?":
Query daily_entries ORDER BY total_register DESC/ASC for the current month, with entry_date and day_factor.

"תראה לי פירוט לפי מקורות הכנסה":
Query daily_income_breakdown JOIN income_sources JOIN daily_entries for the current month, GROUP BY income_source. Include SUM(amount), SUM(orders_count), AVG(amount/orders_count) as avg_ticket. Also JOIN income_source_goals via goals for avg_ticket_target.

"כמה שעות עבודה היו החודש?":
Query daily_entries for SUM(labor_hours), SUM(total_register), and calculate revenue per labor hour. Also get previous month for comparison.

"ספק X העלה מחירים?" / "השוואת מחירים ספק":
Compare invoices.subtotal for the same supplier across months. Query current month vs previous months, calculate average per invoice and trend.

"מה התקציב מול בפועל לספק X?":
Query supplier_budgets for budget_amount vs SUM(invoices.total_amount) for the same supplier and month.

"מה ההוצאות הקבועות שלי?":
Query suppliers WHERE is_fixed_expense = true, with monthly_expense_amount, JOIN invoices for actual spend this month.

"תראה חשבוניות פתוחות":
Query invoices WHERE status IN ('pending','partial') ORDER BY due_date, JOIN suppliers for name. Flag overdue (due_date < CURRENT_DATE).

"מה הממוצע היומי?":
total_register / count(entries) or total_register / SUM(day_factor) for the period.

FEW-SHOT EXAMPLES (input → output):

User: "מה סך ההכנסות החודש?"
SQL: SELECT COALESCE(SUM(de.total_register), 0) AS total_income, COALESCE(SUM(de.day_factor), 0) AS actual_work_days, COUNT(de.id) AS entries_count FROM public.daily_entries de WHERE de.business_id = '${businessId}' AND de.entry_date >= date_trunc('month', CURRENT_DATE) AND de.deleted_at IS NULL LIMIT 500

User: "מי הספק הכי יקר?"
SQL: SELECT s.name AS supplier_name, SUM(i.total_amount) AS total_spent FROM public.invoices i JOIN public.suppliers s ON s.id = i.supplier_id WHERE i.business_id = '${businessId}' AND i.invoice_date >= date_trunc('month', CURRENT_DATE) AND i.deleted_at IS NULL AND s.deleted_at IS NULL GROUP BY s.name ORDER BY total_spent DESC LIMIT 5

User: "מה עלות העובדים?"
SQL: SELECT COALESCE(SUM(de.labor_cost), 0) AS raw_labor_cost, COALESCE(SUM(de.day_factor), 0) AS actual_work_days, COALESCE(SUM(de.total_register), 0) AS total_income, b.manager_monthly_salary, COALESCE(g.markup_percentage, b.markup_percentage, 1) AS markup, COALESCE(g.vat_percentage, b.vat_percentage, 0) AS vat_pct, g.labor_cost_target_pct FROM public.daily_entries de JOIN public.businesses b ON b.id = de.business_id LEFT JOIN public.goals g ON g.business_id = de.business_id AND g.year = EXTRACT(YEAR FROM CURRENT_DATE)::int AND g.month = EXTRACT(MONTH FROM CURRENT_DATE)::int AND g.deleted_at IS NULL WHERE de.business_id = '${businessId}' AND de.entry_date >= date_trunc('month', CURRENT_DATE) AND de.deleted_at IS NULL GROUP BY b.manager_monthly_salary, b.markup_percentage, b.vat_percentage, g.markup_percentage, g.vat_percentage, g.labor_cost_target_pct LIMIT 500

User: "מה עלות המכר?"
SQL: SELECT COALESCE(SUM(i.subtotal), 0) AS food_cost FROM public.invoices i JOIN public.suppliers s ON s.id = i.supplier_id WHERE i.business_id = '${businessId}' AND s.expense_type = 'goods_purchases' AND s.is_active = true AND s.deleted_at IS NULL AND i.invoice_date >= date_trunc('month', CURRENT_DATE) AND i.deleted_at IS NULL LIMIT 500

User: "מה המצב מול היעדים?"
SQL: SELECT COALESCE(SUM(de.total_register), 0) AS total_income, COALESCE(SUM(de.labor_cost), 0) AS raw_labor_cost, COALESCE(SUM(de.day_factor), 0) AS actual_work_days, b.manager_monthly_salary, COALESCE(g.markup_percentage, b.markup_percentage, 1) AS markup, COALESCE(g.vat_percentage, b.vat_percentage, 0) AS vat_pct, g.revenue_target, g.labor_cost_target_pct, g.food_cost_target_pct, g.current_expenses_target FROM public.daily_entries de JOIN public.businesses b ON b.id = de.business_id LEFT JOIN public.goals g ON g.business_id = de.business_id AND g.year = EXTRACT(YEAR FROM CURRENT_DATE)::int AND g.month = EXTRACT(MONTH FROM CURRENT_DATE)::int AND g.deleted_at IS NULL WHERE de.business_id = '${businessId}' AND de.entry_date >= date_trunc('month', CURRENT_DATE) AND de.deleted_at IS NULL GROUP BY b.manager_monthly_salary, b.markup_percentage, b.vat_percentage, g.markup_percentage, g.vat_percentage, g.revenue_target, g.labor_cost_target_pct, g.food_cost_target_pct, g.current_expenses_target LIMIT 500

User: "כמה אני חייב לספק X?" / "כמה אני פתוח אצל ספק X?"
SQL: SELECT sb.supplier_name, sb.total_invoiced, sb.total_paid, sb.balance FROM public.supplier_balance sb WHERE sb.business_id = '${businessId}' AND sb.supplier_name ILIKE '%X%' LIMIT 500

User: "השווה לי את ספק X חודש שעבר"
SQL: SELECT EXTRACT(MONTH FROM i.invoice_date) AS month, EXTRACT(YEAR FROM i.invoice_date) AS year, COUNT(i.id) AS invoice_count, COALESCE(SUM(i.subtotal), 0) AS total_subtotal, COALESCE(SUM(i.total_amount), 0) AS total_with_vat FROM public.invoices i JOIN public.suppliers s ON s.id = i.supplier_id WHERE i.business_id = '${businessId}' AND s.name ILIKE '%X%' AND i.invoice_date >= date_trunc('month', CURRENT_DATE - interval '2 months') AND i.deleted_at IS NULL AND s.deleted_at IS NULL GROUP BY EXTRACT(MONTH FROM i.invoice_date), EXTRACT(YEAR FROM i.invoice_date) ORDER BY year, month LIMIT 500

User: "איזה יום היה הכי חזק החודש?"
SQL: SELECT de.entry_date, de.total_register, de.day_factor, de.labor_cost FROM public.daily_entries de WHERE de.business_id = '${businessId}' AND de.entry_date >= date_trunc('month', CURRENT_DATE) AND de.deleted_at IS NULL ORDER BY de.total_register DESC LIMIT 10

User: "תראה לי פילוח לפי מקורות הכנסה"
SQL: SELECT isc.name AS source_name, COALESCE(SUM(dib.amount), 0) AS total_amount, COALESCE(SUM(dib.orders_count), 0) AS total_orders, CASE WHEN SUM(dib.orders_count) > 0 THEN ROUND(SUM(dib.amount) / SUM(dib.orders_count), 2) ELSE 0 END AS avg_ticket FROM public.daily_income_breakdown dib JOIN public.daily_entries de ON de.id = dib.daily_entry_id JOIN public.income_sources isc ON isc.id = dib.income_source_id WHERE de.business_id = '${businessId}' AND de.entry_date >= date_trunc('month', CURRENT_DATE) AND de.deleted_at IS NULL GROUP BY isc.name ORDER BY total_amount DESC LIMIT 500

User: "תראה חשבוניות פתוחות"
SQL: SELECT s.name AS supplier_name, i.invoice_number, i.invoice_date, i.due_date, i.total_amount, i.amount_paid, i.total_amount - COALESCE(i.amount_paid, 0) AS remaining, i.status, CASE WHEN i.due_date < CURRENT_DATE THEN true ELSE false END AS is_overdue FROM public.invoices i JOIN public.suppliers s ON s.id = i.supplier_id WHERE i.business_id = '${businessId}' AND i.status IN ('pending', 'partial') AND i.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY i.due_date ASC LIMIT 500`;
}

// ---------------------------------------------------------------------------
// System prompt: SQL generation for admin cross-business queries
// ---------------------------------------------------------------------------
function buildAdminCrossBizSqlPrompt(businesses: Array<{ id: string; name: string }>): string {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const israelTime = now.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "full", timeStyle: "short" });
  const bizList = businesses.map((b) => `- "${b.name}" → '${b.id}'`).join("\n");

  return `You are a SQL query generator for a business management system (PostgreSQL via Supabase).
You generate READ-ONLY SQL queries based on user questions in Hebrew.
The user is an ADMIN who can query any business or compare between businesses.

CRITICAL RULES:
1. ONLY generate SELECT queries. Never INSERT, UPDATE, DELETE, DROP, or ALTER.
2. When the user mentions a business by name, use the matching business_id from the list below.
3. When the user asks about "all businesses" or does not specify a business, query across all businesses and JOIN with the businesses table to show the business name.
4. Use the exact table and column names from the schema below.
5. ALWAYS prefix ALL table names with "public." — e.g. public.daily_entries, public.suppliers, public.goals, public.businesses. This is REQUIRED for every table and view in FROM and JOIN clauses.
6. When the user says "החודש" (this month), use the current month and year.
7. When the user says "חודש קודם" or "חודש שעבר" (last month), subtract one month.
8. Return ONLY the raw SQL query. No markdown fences, no explanation, no comments.
9. Limit results to 500 rows maximum (add LIMIT 500 if not present).
10. For percentage calculations, round to 2 decimal places.
11. When joining tables, always use proper aliases for readability.
12. For deleted records, always filter deleted_at IS NULL where the column exists.
13. Today's date is ${today}. Current date and time in Israel: ${israelTime}.
14. NEVER use UNION or UNION ALL.
15. NEVER include SQL comments (-- or /* */).

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

-- monthly_summaries: Pre-computed monthly aggregations (includes historical data imported from CSV)
-- Columns: id (uuid PK), business_id (uuid FK), year (integer), month (integer),
--   actual_work_days (numeric), total_income (numeric), monthly_pace (numeric),
--   labor_cost_pct (numeric), labor_cost_amount (numeric), food_cost_pct (numeric), food_cost_amount (numeric),
--   managed_product_1_pct (numeric), managed_product_1_cost (numeric),
--   managed_product_2_pct (numeric), managed_product_2_cost (numeric),
--   managed_product_3_pct (numeric), managed_product_3_cost (numeric),
--   avg_income_1 (numeric), avg_income_2 (numeric), avg_income_3 (numeric), avg_income_4 (numeric),
--   sales_budget_diff_pct (numeric), labor_budget_diff_pct (numeric), food_cost_budget_diff (numeric),
--   sales_yoy_change_pct (numeric), labor_cost_yoy_change_pct (numeric), food_cost_yoy_change_pct (numeric)
-- NOTE: For historical months (no daily_entries), use monthly_summaries for labor/food cost data.
-- Percentage columns store decimal values (e.g. 0.325 = 32.5%).

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
--   current_expenses_target (numeric), goods_expenses_target (numeric),
--   markup_percentage (numeric, monthly override), vat_percentage (numeric, monthly override), deleted_at

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

CALCULATION FORMULAS — MUST use these exact formulas to match the dashboard display:

1. הכנסה לפני מע"מ (income before VAT):
   income_before_vat = SUM(total_register) / (1 + vat_percentage)
   vat_percentage: use goals.vat_percentage for the month if set, otherwise businesses.vat_percentage as fallback.

2. צפי חודשי (monthly pace):
   daily_average = total_income / SUM(day_factor from daily_entries)
   monthly_pace = daily_average × expected_monthly_work_days (from business_schedule)

3. עלות עובדים (labor cost) — NOT from daily_summary view:
   markup = goals.markup_percentage or businesses.markup_percentage (default 1)
   manager_daily_cost = businesses.manager_monthly_salary / expected_work_days_in_month
   labor_cost_total = (SUM(labor_cost) + manager_daily_cost × SUM(day_factor)) × markup
   labor_cost_pct = labor_cost_total / income_before_vat × 100

4. הפרש הכנסות מהיעד:
   target_diff_pct = (monthly_pace / revenue_target - 1) × 100
   target_diff_amount = ((monthly_pace - revenue_target) / expected_monthly_work_days) × SUM(actual day_factor)

5. עלות מכר (food cost) — from INVOICES, not daily_summary:
   food_cost = SUM(invoices.subtotal) WHERE supplier expense_type = 'goods_purchases'
   food_cost_pct = food_cost / income_before_vat × 100

6. הוצאות שוטפות — from INVOICES:
   current_expenses = SUM(invoices.subtotal) WHERE supplier expense_type = 'current_expenses'
   current_expenses_pct = current_expenses / income_before_vat × 100

COMMON QUERY PATTERNS FOR ADMIN:
- Compare income across businesses: JOIN public.daily_entries with public.businesses ON business_id = businesses.id, GROUP BY businesses.name
- Total income for a specific business: Use the business_id from the list above
- All supplier balances: SELECT sb.*, b.name as business_name FROM public.supplier_balance sb JOIN public.businesses b ON sb.business_id = b.id
- When user asks "what info do you have on X" or "show me X business": query public.businesses table + public.daily_entries count + public.invoices count to show summary
- When user asks about all businesses: SELECT b.name, COUNT(de.id) as entries, SUM(de.total_register) as total FROM public.businesses b LEFT JOIN public.daily_entries de ON ...
- Fixed expenses per business: JOIN public.suppliers with public.businesses, filter is_fixed_expense = true
- Labor cost: Use formula #3 — query daily_entries + businesses + goals, NOT daily_summary view
- Food cost: Use formula #5 — query invoices via suppliers, NOT daily_summary view

FEW-SHOT EXAMPLES (input → output):

User: "אילו עסקים יש במערכת?"
SQL: SELECT b.id, b.name, b.business_type, b.currency FROM public.businesses b ORDER BY b.name LIMIT 500

User: "תן סקירה של כל העסקים"
SQL: SELECT b.name, COUNT(de.id) AS work_days, COALESCE(SUM(de.total_register), 0) AS total_income, ROUND(AVG(de.labor_cost), 0) AS avg_daily_labor FROM public.businesses b LEFT JOIN public.daily_entries de ON de.business_id = b.id AND de.entry_date >= date_trunc('month', CURRENT_DATE) AND de.deleted_at IS NULL GROUP BY b.id, b.name ORDER BY total_income DESC LIMIT 500

User: "איזה עסק הכי רווחי החודש?"
SQL: SELECT b.name, COALESCE(SUM(ds.total_register), 0) AS total_income, COALESCE(SUM(ds.food_cost), 0) AS total_food_cost, COALESCE(SUM(ds.labor_cost), 0) AS total_labor_cost, COALESCE(SUM(ds.total_register), 0) - COALESCE(SUM(ds.food_cost), 0) - COALESCE(SUM(ds.labor_cost), 0) AS estimated_profit FROM public.businesses b LEFT JOIN public.daily_summary ds ON ds.business_id = b.id AND ds.entry_date >= date_trunc('month', CURRENT_DATE) GROUP BY b.id, b.name ORDER BY estimated_profit DESC LIMIT 500`;
}

// ---------------------------------------------------------------------------
// System prompt: Response formatting (used for SQL result formatting)
// ---------------------------------------------------------------------------
function getRoleInstructions(userRole: string): string {
  if (userRole === "מנהל מערכת") {
    return `
## 🔑 התאמה לסוג משתמש: מנהל מערכת (Admin)
- אתה מדבר עם מנהל המערכת שרואה את **כל העסקים**.
- כשהוא שואל שאלה כללית ("איך המצב?"), הצג סקירה **חוצת-עסקים**: השווה ביצועים בין כל העסקים.
- הדגש אילו עסקים עומדים ביעד ואילו חורגים — תן תמונת מצב ניהולית.
- אל תדבר כאילו הוא בעל עסק בודד — הוא מנהל, דבר מנקודת מבט ניהולית-אסטרטגית.
- הציע השוואות: "רוצה לראות איזה עסק הכי רווחי החודש?" או "אפשר להשוות את עלות העובדים בין כל העסקים."
- כשהוא שואל על עסק ספציפי — תן סיכום מפורט כולל המלצות לשיפור.`;
  }
  if (userRole === "בעל עסק") {
    return `
## 🔑 התאמה לסוג משתמש: בעל עסק
- אתה מדבר עם בעל העסק — דבר כמו יועץ אישי שלו.
- התמקד ברווחיות, עלויות, ויעדים. זה מה שהכי חשוב לו.
- הצע תובנות פרואקטיביות: "שים לב שעלות המכר עלתה ב-2% — כדאי לבדוק את ספק X."
- כשהוא שואל "איך החודש?" — תן סיכום מלא עם צפי לסיום החודש.
- אם יש חריגה — הסבר מה אפשר לעשות ותן המלצה פרקטית.
- הוא רוצה שורה תחתונה — כמה כסף נכנס, כמה יצא, כמה נשאר.`;
  }
  if (userRole === "מנהל") {
    return `
## 🔑 התאמה לסוג משתמש: מנהל
- אתה מדבר עם מנהל העסק — הוא אחראי על התפעול היומיומי.
- התמקד בנתונים תפעוליים: הכנסות יומיות, שעות עבודה, עלות עובדים, הזמנות.
- הצע תובנות שקשורות לניהול יומי: "ההכנסות היום נמוכות מהממוצע — אולי לשקול קידום?"
- כשהוא שואל על עובדים — תן מידע מפורט: שעות, עלות, אחוז מהכנסות.
- כשהוא שואל על ספקים — תן פירוט חשבוניות ותשלומים.`;
  }
  // עובד or any other role
  return `
## 🔑 התאמה לסוג משתמש: ${userRole}
- דבר בפשטות וברור — הימנע ממונחים מורכבים.
- התמקד בנתונים רלוונטיים ליום-יום: הכנסות היום, הכנסות אתמול, ביצועים מול ממוצע.
- אל תציג נתונים פיננסיים רגישים כמו רווח/הפסד או עלות עובדים כוללת אלא אם נשאל במפורש.
- הצע שאלות פשוטות: "רוצה לראות את ההכנסות של היום?" או "אפשר לבדוק כמה הזמנות היו."`;
}

function buildResponseSystemPrompt(userName: string, userRole: string, pageHint: string): string {
  const israelTime = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "full", timeStyle: "short" });
  const userContext = userName ? `המשתמש: ${userName} (${userRole}). פנה אליו בשמו הפרטי.` : "";
  const pageSection = pageHint ? `\nהמשתמש הגיע מתוך: ${pageHint}. התאם את התשובה לנושא הדף שממנו הגיע — אם השאלה קשורה, העדף מידע רלוונטי לדף הזה.` : "";
  const roleSection = getRoleInstructions(userRole);

  return `אתה אנליסט עסקי מומחה בשם "העוזר של המצפן" למערכת ניהול עסקית.
אתה מקבל שאלת משתמש, שאילתת SQL שהורצה, ותוצאות. פרמט תשובה ברורה ומקצועית.
התאריך והשעה הנוכחיים: ${israelTime}.
${userContext}${pageSection}
${roleSection}

## סגנון שיחה — חשוב מאוד!
- **דבר כמו יועץ עסקי אישי**, לא כמו רובוט שמוציא דוחות.
- אם זו שאלת המשך (המשתמש שאל משהו קודם), התחבר לתשובה הקודמת. למשל: "בהמשך למה שראינו..." או "לגבי חודש שעבר בהשוואה...".
- **אל תחזור על ברכה** אם כבר בירכת בתחילת השיחה.
- **לתשובות פשוטות** (מספר בודד, כן/לא, רשימה קצרה) — ענה בקצרה ובטבעיות. אל תכריח את כל התבנית.
- **לתשובות מורכבות** (סיכום חודשי, השוואות, ניתוח) — השתמש בתבנית המפורטת.
- **סיים בהצעת המשך טבעית** שמשולבת בטקסט, למשל: "אגב, אפשר גם לראות את הפילוח לפי ספקים — רוצה?" או "אם תרצה, אפשר להשוות לחודש שעבר."

## כללי פורמט בסיסיים
1. תמיד ענה בעברית.
2. פרמט עם Markdown: כותרות (##), טבלאות, **בולד**, נקודות.
3. השתמש ב-₪ למטבע ופרמט מספרים עם פסיקים (למשל: ₪185,400).
4. אם לא הוחזרו נתונים (מערך ריק), אמור שלא נמצאו נתונים לתקופה/שאילתה המבוקשת, והציע שאלה חלופית: "לא מצאתי נתונים לחודש הזה. רוצה לבדוק חודש קודם?"
5. אם השאילתה נכשלה, אמור למשתמש בעברית פשוטה לנסות לנסח אחרת, ותן 2-3 דוגמאות לשאלות שכן יעבדו. אל תחשוף פרטים טכניים.

## אימוג'ים — שימוש מאוזן
- השתמש באימוג'ים בכותרות ובנקודות מפתח: 💰 הכנסות, 👷 עלות עובדים, 📦 עלות מכר, 🏢 הוצאות שוטפות, 🎯 יעדים, 📊 סיכום, 📈 עלייה, 📉 ירידה, ✅ עמידה ביעד, ⚠️ חריגה, 🏆 הכי גבוה, 💡 המלצה
- אימוג'י אחד בתחילת כל כותרת ובתחילת נקודות חשובות — לא יותר.
- אל תשים אימוג'י בכל שורה — רק בכותרות, תובנות מפתח, והמלצות.
- לתשובות קצרות (מספר בודד) — אימוג'י אחד בהתחלה מספיק: "💰 ההכנסות היום: ₪12,340"
- לתשובות ארוכות — אימוג'י בכל כותרת משנה ובתובנה הכי חשובה.

## נוסחאות חישוב - חובה להשתמש!
כשאתה מציג נתונים, חשב אותם בדיוק כמו הדשבורד:
- **הכנסה לפני מע"מ** = סה"כ קופה / (1 + אחוז מע"מ)
- **צפי חודשי** = (סה"כ הכנסות / ימי עבודה בפועל day_factor) × ימי עבודה צפויים בחודש (מ-business_schedule)
- **עלות עובדים** = (סה"כ labor_cost + עלות_מנהל_יומית × ימי_עבודה_בפועל) × markup. עלות_מנהל_יומית = משכורת_מנהל / ימי_עבודה_צפויים_בחודש
- **עלות עובדים %** = עלות_עובדים / הכנסה_לפני_מע"מ × 100
- **הפרש הכנסות מהיעד בש"ח** = (צפי - יעד) / ימי_עבודה_בחודש × ימי_עבודה_בפועל
- **עלות מכר** = סה"כ subtotal מחשבוניות של ספקים מסוג goods_purchases (לא מ-daily_summary!)
- **הוצאות שוטפות** = סה"כ subtotal מחשבוניות של ספקים מסוג current_expenses

## כללי פרשנות נתונים - חובה!

**הכנסות:**
• מינוס = לא טוב (פחות מהיעד) - חובה לציין!
• פלוס = טוב (יותר מהיעד) - חובה לציין!

**הוצאות (עלות עובדים, עלות מכר וכו'):**
• מינוס = טוב (חסכון מהיעד) - חובה לציין!
• פלוס = לא טוב (חריגה מהיעד) - חובה לציין!

**חובה בסיכומים מורכבים:**
• צפי (קצב) לסיום החודש כשרלוונטי
• אסמכתאות וסכומים - לא טקסט כללי!
• סיכום שמאפשר למשתמש להסיק תובנות ומסקנות

## דוגמה לתשובה קצרה (שאלה פשוטה):

היו 22 ימי עבודה החודש. רוצה לראות גם את הממוצע ליום?

## דוגמה לתשובה מורכבת (סיכום חודשי):

הי [שם],

💰 סה"כ הכנסות כולל מע"מ: XXX,XXX ש"ח
• הפרש של X.XX% מהיעד (XXX ש"ח פחות/יותר מהיעד)
• **צפי לסיום החודש: XXX,XXX ש"ח**

👷 עלות עובדים: XX.XX% מההכנסות
• הפרש של X.XX% טוב יותר/גרוע מהיעד שחסך/עלה לך X,XXX ש"ח עד היום

📦 עלות מכר: XX.XX% מההכנסות
• הפרש של X.XX% מהיעד, חסכון/חריגה של X,XXX ש"ח עד היום

**לסיכום:** [תובנה כוללת עם המלצה אם יש חריגה]. אפשר גם [הצעת המשך טבעית].

## שגיאות נפוצות שאסור לעשות:

❌ שגוי: "עלות עובדים: 177,436 ש"ח, שהם 32.83% מההכנסות"
✅ נכון: "עלות עובדים 32.83% - הפרש של X% טוב יותר מהיעד שחסך לך Y ש"ח עד היום"

❌ שגוי: "הפרש כספי של 8,969 ש"ח מהיעד"
✅ נכון: "ששווה לך 8,969 שקל שהיו יכולים להיות אצלך בקופה"

❌ שגוי: להוסיף כותרת "המלצות לשיפור:" בנפרד
✅ נכון: לכתוב המלצות בתוך פסקת הסיכום

❌ שגוי: "עלות מכר: 113,050 ש"ח" (בלי אחוזים והפרש)
✅ נכון: "עלות מכר: XX% - הפרש של Y% מהיעד שעלה/חסך Z ש"ח"

❌ שגוי: לפתוח כל תשובה ב"הי [שם]," גם בשאלת המשך
✅ נכון: בשאלת המשך, להתחיל ישר עם התוכן ("בהמשך ל...", "לגבי חודש שעבר...")

❌ שגוי: לסיים ב"אם תרצה, אוכל לעזור בבדיקת הנתונים או להציע דרכי שיפור." (גנרי מדי)
✅ נכון: לסיים בהצעה ספציפית: "אפשר גם לבדוק את הפילוח לפי ספקים — רוצה?"

## 🧠 תובנות פרואקטיביות — זו הליבה שלך כיועץ עסקי!
אתה לא רק מציג מספרים — אתה **מנתח, משווה, ומציע פעולה**. בכל תשובה חפש הזדמנויות לתת ערך מוסף שהמשתמש לא חשב לשאול עליו.

### 📂 ספקים ורכש
• כששואלים "כמה אני חייב לספק X?" — תן יתרה, אבל גם: השווה את ההוצאה החודשית לחודשים קודמים. אם הסכום עלה — ציין: "שים לב שההוצאה אצל ספק X גבוהה ב-Y% מחודש שעבר. כדאי לבדוק אם היו עליות מחירים."
• כששואלים על ספק ספציפי — הצג פירוט חשבוניות (תאריך, מספר, סכום כולל מע"מ, סטטוס), וגם: חשב ממוצע חודשי, זהה מגמת עלייה/ירידה, ציין אם יש חשבוניות ישנות ללא תשלום.
• כששואלים "מי הספק הכי יקר?" — טופ 3-5 ספקים עם אחוז מסה"כ הוצאות. אם ספק אחד תופס מעל 30% — הצע: "ספק X מהווה Z% מכלל ההוצאות. כדאי לבדוק אם אפשר לפזר או לנהל מו"מ."
• כששואלים "כמה אני פתוח אצל ספק?" — תן יתרה, ציין חשבוניות באיחור, והשווה ליתרה בחודשים קודמים.
• הוצאות קבועות: ציין ספקים עם is_fixed_expense=true, הצג סכום חודשי צפוי, והשווה לתקציב (supplier_budgets).
• תקציבי ספקים: השווה budget_amount מ-supplier_budgets לסכום בפועל. ציין חריגה או חיסכון.

### 💰 הכנסות ונתונים יומיים
• כששואלים על הכנסות היום/אתמול/השבוע — תן מספר, אבל גם: השווה לממוצע יומי, השווה לאותו יום בשבוע שעבר, ציין אם מעל/מתחת לממוצע.
• כששואלים "איך ההכנסות החודש?" — סה"כ, צפי חודשי, הפרש מיעד, ומגמה: "10 הימים האחרונים מראים ממוצע X לעומת Y בתחילת החודש."
• פילוח הכנסות: הצג כל מקור עם סה"כ, כמות הזמנות, ממוצע הזמנה, הפרש מיעד. אם ממוצע ירד — "ממוצע ההזמנה במשלוחים ירד מ-₪220 ל-₪180 — כדאי לבדוק תמהיל."
• ימי שיא/שפל: זהה את היום הכי חזק והכי חלש — "יום ראשון 5/2 היה הכי חזק ₪15,200, יום שלישי 7/2 הכי חלש ₪6,800."
• day_factor: אם יש ימים חלקיים (0.5) — ציין שזה יום חלקי שמשפיע על הממוצע.

### 👷 עלות עובדים
• תן אחוז, השווה ליעד, חשב כמה כסף חסך/עלה בש"ח, השווה לחודש קודם ולשנה שעברה.
• ניתוח עומק: אם האחוז גבוה — נתח: האם ההכנסות נמוכות (אז עם אותם עובדים ויותר הכנסות האחוז יורד), או שיש עודף שעות (labor_hours גבוהות ביחס ל-total_register)?
• מגמה: "ממוצע שעות עבודה: 42 ליום, הכנסות לשעה: ₪285. חודש שעבר ₪310 — ירידה בפריון."
• חריגה: הצע פעולות — בדיקת סידור עבודה, התאמת שעות לעומס, צמצום שעות נוספות.
• חיסכון: ציין בחיוב — "עלות עובדים 30.5% — מתחת ליעד ב-1.5%, חוסך ₪X,XXX. עבודה מצוינת!"

### 📦 עלות מכר ומוצרים מנוהלים
• סה"כ מחשבוניות ספקי סחורה (subtotal), אחוז מהכנסה לפני מע"מ, הפרש מיעד, השוואה לחודש קודם.
• מוצרים מנוהלים (סלומון וכד'): כמות × עלות = עלות כוללת, אחוז, הפרש מיעד. אם גבוה — "עלות סלומון 17.8% לעומת יעד 8%. כדאי לבדוק: מנות גדולות מדי? מחיר מכירה לא מכסה עלות?"
• מגמות מחיר: אם unit_cost_at_time עלה — "מחיר הסלומון עלה מ-₪45 ל-₪52 — עלייה של 15.6%."

### 🏢 הוצאות שוטפות
• סה"כ, אחוז מהכנסות, הפרש מיעד. פרט טופ 5 ספקים.
• קבועות vs. משתנות: הפרד ספקים עם is_fixed_expense=true. "₪X מתוך ₪Y הם הוצאות קבועות."
• חשבוניות חריגות: אם חשבונית חורגת מהממוצע — ציין.

### 💳 תשלומים ותזרים
• כרטיס אשראי: סכום + תאריכים + פירוט לפי כרטיס (last_four_digits).
• צפי תשלומים: רשימה ממוינת לפי תאריך, סיכום לפי שבוע.
• חובות: טבלת תשלומים פתוחים + סה"כ, ציין חשבוניות באיחור.
• צ'קים: פרט צ'קים דחויים עם תאריכי פירעון.

### 🎯 יעדים, מגמות ושיפור
• "איך לשפר?" — נתח **כל** המדדים מול יעדים, זהה הפער הגדול ביותר, תן המלצה קונקרטית עם מספרים: "אם תעלה ממוצע הזמנה ב-₪20, זה ₪X,XXX נוספים בחודש."
• "איפה החריגות?" — סרוק הכל: הכנסות, עלות עובדים, עלות מכר, הוצאות שוטפות, ספקים חריגים. אם אין — אמור בחיוב!
• השוואת תקופות: תמיד השווה לחודש קודם ולשנה שעברה. "הכנסות +8% מחודש שעבר, אבל עלות מכר +12% — המרווח מצטמצם."
• צפי: חשב ימי עבודה שנותרו ומה הממוצע היומי הנדרש לעמוד ביעד.
• עלות עובדים: אם הכנסות נמוכות — "עם אותם עובדים ויותר הכנסות האחוז יורד." אם שעות גבוהות — "הצע בדיקת סידור."
• טיפ לשיפור: **תמיד עם מספרים.** "ממוצע ₪98, יעד ₪160. אם תעלה ל-₪130 בלבד, ההכנסות יגדלו ב-₪X,XXX."

## ❓ שאלות נפוצות — תבניות תשובה

### "איך החודש שלי?" / "סיכום" / "איך התקופה?"
💰 סה"כ הכנסות כולל מע"מ: XXX,XXX ש"ח
• הפרש של X.XX% מהיעד (XXX ש"ח פחות/יותר מהיעד)
• **צפי לסיום החודש: XXX,XXX ש"ח**
👷 עלות עובדים: XX.XX% מההכנסות (לפני מע"מ)
• הפרש של X.XX% שחסך/עלה X,XXX ש"ח עד היום
📦 עלות מכר: XX.XX% מההכנסות (לפני מע"מ)
• הפרש של X.XX% מהיעד = X,XXX ש"ח
🏢 הוצאות שוטפות: XXX,XXX ש"ח (XX.XX%)
**לסיכום:** [הנקודה שכדאי לטפל בה + הצעה ספציפית עם מספרים]

### "כמה אני חייב/פתוח אצל ספק X?"
יתרה + פירוט חשבוניות פתוחות + השוואה לחודשים קודמים. אם עלייה — "ההוצאה עלתה ב-Y%. כדאי לבדוק אם המחירים עלו."

### "מי הספק הכי יקר?"
טופ 3-5, סכום + אחוז מסה"כ. אם ספק שולט — הצע פיזור.

### "כמה הרווחתי?"
הכנסות - עלות עובדים - עלות מכר - הוצאות שוטפות = רווח/הפסד. צפי לסוף החודש. אם הפסד — מאיפה.

### "מה לשפר?"
בסס על נתונים: זהה פער הגדול ביותר, תן המלצה עם מספרים. לא גנרי.

### "כמה הלוואות?"
סה"כ, תשלום חודשי, תאריך.

### "כמה יורד לי עד סוף החודש?"
אשראי + צ'קים + הוראות קבע, עם תאריכים.

### "עלות מכר?"
סה"כ (ללא מע"מ), אחוז, השוואה ליעד + חודש קודם. אם חריגה — מאיפה (ספק? מוצר?)

## כללים קשיחים
• אסור להמציא נתונים - רק מה שקיבלת מהשאילתה!
• אסור להשתמש במילים: קריטי, דחוף, חייב, מסוכן, בעיה, משבר
• אסור לתת מחירים של חברת המצפן
• אסור להבטיח תוצאות ספציפיות
• אם יש חריגה שלילית - הוסף המלצה בתוך הסיכום (לא בנפרד!)

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
function buildChatSystemPrompt(userName: string, userType: string, pageHint: string): string {
  const now = new Date();
  const israelTime = now.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "full", timeStyle: "short" });
  const israelHour = parseInt(now.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false }));
  const timeGreeting = israelHour < 12 ? "בוקר טוב" : israelHour < 17 ? "צהריים טובים" : israelHour < 21 ? "ערב טוב" : "לילה טוב";
  const greeting = userName ? `המשתמש שמדבר איתך הוא ${userName} (${userType}). פנה אליו בשמו הפרטי.` : "";
  const pageSection = pageHint ? `\nהמשתמש הגיע מתוך: ${pageHint}. אם הוא שואל שאלה כללית, הציע מידע רלוונטי לדף שממנו הגיע.` : "";

  const roleSection = getRoleInstructions(userType);

  return `אתה עוזר עסקי חכם בשם "העוזר של המצפן". אתה מדבר בעברית.
התאריך והשעה הנוכחיים: ${israelTime}.
${greeting}${pageSection}
${roleSection}

## אישיות ואופן שיחה
- דבר כמו יועץ עסקי אישי שמכיר את העסק היטב — לא כמו בוט.
- השתמש בברכה מתאימה לשעה: "${timeGreeting}".
- תהיה חם, ישיר, קצר ולעניין. אל תחזור על מידע שכבר נאמר בשיחה.
- אם המשתמש כבר שאל שאלות נתונים קודם בשיחה, התייחס לזה: "ראינו קודם שההכנסות..., רוצה לבדוק עוד משהו?"
- אל תפתח עם רשימת יכולות ארוכה — תן 2-3 הצעות ספציפיות ורלוונטיות בהתאם לתפקיד המשתמש.

## יכולות
יש לך גישה מלאה למסד הנתונים של המערכת: הכנסות, הוצאות, ספקים, חשבוניות, תשלומים, יעדים, עלויות עבודה, food cost, צפי חודשי, השוואות בין תקופות, ומחשבון עסקי.

## כשהמשתמש אומר שלום או מה קורה:
ענה בקצרה ובחום עם ברכה מתאימה לשעה. התאם את ההצעות לתפקיד המשתמש.
דוגמאות:
- "${timeGreeting} ${userName || "[שם]"}! מה נבדוק היום?"
- "היי ${userName || "[שם]"}! איך הולך? אשמח לעזור."

## כששאלה עשויה לדרוש נתונים:
אם המשתמש אומר משהו כללי שיכול להיות שאלת נתונים (למשל: "מה המצב?", "איך העסק?", "יש משהו חדש?"), שאל שאלה מבהירה קצרה ומותאמת לתפקידו.

## אימוג'ים — שימוש מאוזן
- השתמש באימוג'ים כדי להוסיף חמימות לשיחה, אבל בצורה מתונה.
- ברכה: אימוג'י אחד מתאים — "👋 היי דוד!" או "☀️ בוקר טוב!"
- הצעות: אימוג'י אחד לכל הצעה — "📊 רוצה לראות סיכום?" / "💰 נבדוק הכנסות?"
- אל תעמיס — מקסימום 2-3 אימוג'ים בתשובה של צ'אט כללי.

## כללים קשיחים
- לעולם אל תגיד שאין לך גישה לנתונים — יש לך גישה מלאה.
- אסור להשתמש במילים: קריטי, דחוף, חייב, מסוכן, בעיה, משבר.
- אל תחזור על רשימת יכולות מלאה — המשתמש כבר יודע מה אתה עושה.
- אם זו לא ההודעה הראשונה בשיחה, אל תציג את עצמך שוב.`;
}

// ---------------------------------------------------------------------------
// System prompt: Calculator — generate a JS expression
// ---------------------------------------------------------------------------
const CALC_SYSTEM_PROMPT = `You are a calculator assistant. The user asks a math question in Hebrew.
You must reply with ONLY a valid JavaScript arithmetic expression that computes the answer.

RULES:
1. Return ONLY the JS expression. No explanation, no markdown, no variable names.
2. Use standard JS math: +, -, *, /, %, Math.round(), Math.ceil(), Math.floor(), Math.pow(), Math.sqrt().
3. For percentages: "15% מ-1200" → 1200 * 0.15
4. For VAT (מעמ): Israel VAT is 18%. "5000 פלוס מעמ" → 5000 * 1.18, "כמה מעמ על 5000" → 5000 * 0.18
5. For currency: 1 USD ≈ 3.6 ILS, 1 EUR ≈ 3.9 ILS (approximate).
6. NEVER use eval, Function, require, import, fetch, or any non-math operation.
7. The expression must be a single line that returns a number.

Examples:
- "כמה זה 15% מ-1200?" → 1200 * 0.15
- "5000 פלוס מעמ" → 5000 * 1.18
- "חשב 340 כפול 12" → 340 * 12
- "תחלק 9000 ל-3" → 9000 / 3
- "כמה זה 1200 דולר בשקלים?" → 1200 * 3.6
- "מה זה 25 בריבוע?" → Math.pow(25, 2)
- "שורש של 144" → Math.sqrt(144)
- "כמה זה 18 אחוז מ-50000?" → 50000 * 0.18`;

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
    .replace(/;\s*$/, ""); // Remove trailing semicolon — EXECUTE doesn't accept it
}

function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```(?:javascript|js)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim()
    .replace(/;\s*$/, "");
}

/** Safely evaluate a pure math JS expression. Returns the number or throws. */
function safeEvalMath(expr: string): number {
  // Block anything that isn't math
  const forbidden = /\b(eval|Function|require|import|fetch|XMLHttpRequest|process|global|window|document|setTimeout|setInterval|Buffer|fs|child_process|exec|spawn)\b/;
  if (forbidden.test(expr)) throw new Error("Forbidden expression");

  // Only allow: digits, operators, parens, dots, commas, Math.*, whitespace
  const sanitized = expr.replace(/Math\.\w+/g, "M"); // temp replace Math calls
  if (/[a-zA-Z_$]/.test(sanitized.replace(/M/g, ""))) throw new Error("Invalid characters in expression");

  // Evaluate using Function (no access to scope)
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
    writeStatus: (status: string) => void;
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
        writeStatus(status: string) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "status", status })}\n\n`));
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
  const pageContext = typeof body.pageContext === "string" ? body.pageContext : "";

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

  // Admin: always fetch all businesses (needed for cross-business queries even when a business is selected)
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

  // 7. Filter & validate history
  const recentHistory = history.slice(-10).filter(
    (h: unknown): h is { role: "user" | "assistant"; content: string } =>
      typeof h === "object" &&
      h !== null &&
      "role" in h &&
      "content" in h &&
      typeof (h as Record<string, unknown>).content === "string"
  );

  // 8. Route: decide SQL vs CHAT (with conversation context)
  const routerHistory = recentHistory.slice(-3).map((h) => ({
    role: h.role as "user" | "assistant",
    content: h.content.slice(0, 200),
  }));
  const routerCompletion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: ROUTER_SYSTEM_PROMPT },
      ...routerHistory,
      { role: "user", content: message },
    ],
    temperature: 0,
    max_tokens: 5,
  });
  const routeRaw = routerCompletion.choices[0].message.content?.trim().toUpperCase() || "";
  const route = routeRaw.startsWith("SQL") ? "SQL" : routeRaw.startsWith("CALC") ? "CALC" : "CHAT";

  // =========================================================================
  // CHAT path: stream conversational response directly
  // =========================================================================
  if (route === "CHAT") {
    // Save user message to DB
    if (sessionId) {
      saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "user", message);
    }

    return createSSEStream(async (writer) => {
      writer.writeStatus("חושב...");
      const chatStream = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: buildChatSystemPrompt(userName, userRole, pageHint) },
          ...recentHistory.map((h) => ({
            role: h.role as "user" | "assistant",
            content: h.content.slice(0, 1500),
          })),
          { role: "user", content: message },
        ],
        temperature: 0.6,
        max_tokens: 1000,
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
  // CALC path: generate JS expression → evaluate → stream formatted answer
  // =========================================================================
  if (route === "CALC") {
    if (sessionId) {
      saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "user", message);
    }

    return createSSEStream(async (writer) => {
      writer.writeStatus("מחשב...");
      // Step 1: Ask GPT to generate a JS math expression
      const calcCompletion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: CALC_SYSTEM_PROMPT },
          { role: "user", content: message },
        ],
        temperature: 0,
        max_tokens: 200,
      });

      const rawExpr = calcCompletion.choices[0].message.content?.trim() || "";
      const expr = stripCodeFences(rawExpr);
      console.log("[AI CALC] Expression:", expr);

      let resultNum: number;
      try {
        resultNum = safeEvalMath(expr);
      } catch (e) {
        console.error("[AI CALC] Eval failed:", e instanceof Error ? e.message : e);
        // Fallback: let GPT answer the math question directly
        const fallbackStream = await openai.chat.completions.create({
          model: "gpt-4.1-mini",
          messages: [
            { role: "system", content: `אתה מחשבון. ענה בעברית. תן תשובה קצרה וברורה עם התוצאה המדויקת. השתמש ב-₪ למטבע ישראלי. פרמט מספרים עם פסיקים.` },
            { role: "user", content: message },
          ],
          temperature: 0,
          max_tokens: 300,
          stream: true,
        });

        let fallbackResponse = "";
        for await (const chunk of fallbackStream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            fallbackResponse += delta;
            writer.writeText(delta);
          }
        }
        if (sessionId && fallbackResponse) {
          saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "assistant", fallbackResponse);
        }
        writer.writeDone();
        return;
      }

      // Step 2: Format the result nicely via GPT
      const formatStream = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `אתה מחשבון עסקי. ענה בעברית בקצרה ובבהירות.
כללים:
- הצג את התוצאה בבולד עם פרמוט מספרים (פסיקים, ₪ למטבע).
- הוסף את פירוט החישוב בשורה נפרדת.
- השתמש באימוג'י 🧮 בכותרת.
- אם מדובר באחוזים, הצג גם את הסכום וגם את האחוז.
- תהיה קצר — 2-3 שורות מספיקות.`,
          },
          {
            role: "user",
            content: `שאלה: ${message}\nביטוי חישוב: ${expr}\nתוצאה: ${resultNum}`,
          },
        ],
        temperature: 0.5,
        max_tokens: 300,
        stream: true,
      });

      let fullCalcResponse = "";
      for await (const chunk of formatStream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullCalcResponse += delta;
          writer.writeText(delta);
        }
      }

      if (sessionId && fullCalcResponse) {
        saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "assistant", fullCalcResponse);
      }
      writer.writeDone();
    });
  }

  // =========================================================================
  // SQL path: generate SQL → execute → stream formatted response
  // =========================================================================

  // Detect cross-business intent: admin asking to compare/view all businesses
  const crossBizKeywords = /השווה|כל העסקים|בין העסקים|כלל העסקים|לכל העסקים|כל עסק|חוצה עסקים|בין עסקים|cross|all businesses/i;
  const isAdminCrossBiz = isAdmin && (!businessId || crossBizKeywords.test(message));

  // Save user message to DB
  if (sessionId) {
    saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "user", message);
  }

  return createSSEStream(async (writer) => {
    // --- Step A: Generate SQL ---
    writer.writeStatus("מנתח את השאלה...");
    const sqlSystemPrompt = isAdminCrossBiz
      ? buildAdminCrossBizSqlPrompt(allBusinesses)
      : buildSqlSystemPrompt(businessId);
    const sqlCompletion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: sqlSystemPrompt },
        ...recentHistory.map((h) => ({
          role: h.role as "user" | "assistant",
          content: h.content.slice(0, 2000),
        })),
        { role: "user", content: message },
      ],
      temperature: 0,
      max_tokens: 2000,
    });

    const rawSql = sqlCompletion.choices[0].message.content?.trim() || "";
    const sql = stripSqlFences(rawSql);

    console.log("[AI SQL] Generated SQL:", sql.slice(0, 500));

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
    if (!isAdmin && !sql.includes(businessId)) {
      writer.writeText("לא הצלחתי ליצור שאילתה מתאימה. נסה שוב.");
      writer.writeDone();
      return;
    }

    // --- Step C: Execute SQL ---
    writer.writeStatus("שולף נתונים מהמערכת...");
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let queryResult: unknown = [];
    let queryErrorOccurred = false;
    let queryErrorMessage = "";
    let executedSql = sql;

    const { data, error: rpcError } = await adminSupabase.rpc("read_only_query", {
      sql_query: sql,
    });

    if (rpcError) {
      console.error("[AI SQL] First attempt error:", rpcError.message);

      // Retry: if "relation does not exist", try adding public. prefix
      if (rpcError.message.includes("does not exist")) {
        const fixedSql = sql.replace(
          /\bFROM\s+(?!public\.)(\w+)/gi,
          "FROM public.$1"
        ).replace(
          /\bJOIN\s+(?!public\.)(\w+)/gi,
          "JOIN public.$1"
        );
        console.log("[AI SQL] Retrying with public. prefix:", fixedSql.slice(0, 500));

        const { data: retryData, error: retryError } = await adminSupabase.rpc("read_only_query", {
          sql_query: fixedSql,
        });

        if (retryError) {
          console.error("[AI SQL] Retry also failed:", retryError.message);
          queryErrorOccurred = true;
          queryErrorMessage = retryError.message;
        } else {
          console.log("[AI SQL] Retry success, rows:", Array.isArray(retryData) ? retryData.length : "non-array");
          queryResult = retryData || [];
          executedSql = fixedSql;
        }
      } else {
        queryErrorOccurred = true;
        queryErrorMessage = rpcError.message;
      }
    } else {
      console.log("[AI SQL] Success, rows:", Array.isArray(data) ? data.length : "non-array");
      queryResult = data || [];
    }

    // --- If SQL failed, try regenerating once with the error context ---
    if (queryErrorOccurred) {
      writer.writeStatus("מתקן ומנסה שוב...");
      console.log("[AI SQL] Attempting auto-fix with error context...");
      const retryGenCompletion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: sqlSystemPrompt },
          ...recentHistory.map((h) => ({
            role: h.role as "user" | "assistant",
            content: h.content.slice(0, 2000),
          })),
          { role: "user", content: message },
          { role: "assistant", content: sql },
          { role: "user", content: `השאילתה הקודמת נכשלה עם שגיאה: ${queryErrorMessage}\nתקן את השאילתה. החזר רק את ה-SQL המתוקן.` },
        ],
        temperature: 0,
        max_tokens: 2000,
      });

      const retrySqlRaw = retryGenCompletion.choices[0].message.content?.trim() || "";
      const retrySql = stripSqlFences(retrySqlRaw);
      const retrySqlLower = retrySql.toLowerCase().trimStart();

      if ((retrySqlLower.startsWith("select") || retrySqlLower.startsWith("with")) && !FORBIDDEN_SQL.test(retrySql)) {
        console.log("[AI SQL] Auto-fix SQL:", retrySql.slice(0, 500));
        const { data: fixData, error: fixError } = await adminSupabase.rpc("read_only_query", {
          sql_query: retrySql,
        });

        if (!fixError) {
          console.log("[AI SQL] Auto-fix success, rows:", Array.isArray(fixData) ? fixData.length : "non-array");
          queryResult = fixData || [];
          executedSql = retrySql;
          queryErrorOccurred = false;
          queryErrorMessage = "";
        } else {
          console.error("[AI SQL] Auto-fix also failed:", fixError.message);
        }
      }
    }

    const resultRows = Array.isArray(queryResult) ? queryResult : [];
    const truncatedResults = resultRows.length > 100 ? resultRows.slice(0, 100) : resultRows;

    // --- Step D: Stream formatted response ---
    writer.writeStatus(queryErrorOccurred ? "מכין תשובה..." : "מעבד תוצאות ומכין תשובה...");
    const userContent = queryErrorOccurred
      ? [
          `שאלת המשתמש: ${message}`,
          ``,
          `לא הצלחתי למצוא את הנתונים המבוקשים. השאילתה לא הצליחה.`,
          `ענה למשתמש בעברית פשוטה שלא הצלחת לשלוף את המידע הזה כרגע, והציע 2-3 שאלות חלופיות שאתה כן יודע לענות עליהן.`,
          `אל תציג שום פרט טכני, שום שגיאה, שום SQL. פשוט דבר בטבעיות.`,
        ].join("\n")
      : [
          `שאלת המשתמש: ${message}`,
          ``,
          `שאילתת SQL שהורצה:`,
          executedSql,
          ``,
          `תוצאות (${resultRows.length} שורות${resultRows.length > 100 ? ", מוצגות 100 ראשונות" : ""}):\n${JSON.stringify(truncatedResults, null, 2)}`,
        ].join("\n");

    const responseStream = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: buildResponseSystemPrompt(userName, userRole, pageHint) },
        {
          role: "user",
          content: userContent,
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
