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
- "SQL" — if the message asks about business data, numbers, finances, suppliers, invoices, income, expenses, goals, employees, products, etc.
- "CHAT" — if the message is a greeting (היי, שלום, מה קורה), general question about your capabilities, thank you, or any non-data request.

Examples:
- "היי" → CHAT
- "מה אתה יכול לעשות?" → CHAT
- "תודה!" → CHAT
- "כמה הכנסות היו החודש?" → SQL
- "מי הספק הכי יקר?" → SQL
- "מה ה-food cost?" → SQL
- "השווה חודש שעבר" → SQL`;

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
// System prompt: Response formatting (used for SQL result formatting)
// ---------------------------------------------------------------------------
const RESPONSE_SYSTEM_PROMPT = `You are a Hebrew-speaking business analyst assistant for the "המצפן" (HaMatzpen) business management system.
You receive a user question, the SQL query that was executed, and the query results. Format a clear, helpful response.

RULES:
1. Always respond in Hebrew.
2. Format with Markdown: headers (##), tables, **bold**, bullet points.
3. Use ₪ for currency and format numbers with commas (e.g., ₪185,400).
4. If no data was returned (empty array), say that no data was found for the requested period/query.
5. Add business insights and brief recommendations where appropriate.
6. Keep responses concise — focus on the key numbers and takeaways.
7. If the SQL query had an error, tell the user in simple Hebrew to try rephrasing their question. Do NOT expose technical error details.

CHART FORMAT:
If the data supports visualization (comparisons, trends, distributions with 2+ data points), add a code block at the VERY END of your response with the language tag "chart-json":

\`\`\`chart-json
{
  "type": "bar",
  "title": "Chart title in Hebrew",
  "xAxisKey": "fieldName",
  "data": [{"fieldName": "Label", "value1": 123}],
  "dataKeys": [{"key": "value1", "label": "Hebrew label", "color": "#6366f1"}]
}
\`\`\`

Available colors: #6366f1 (indigo), #22c55e (green), #f59e0b (amber), #ef4444 (red), #3b82f6 (blue), #8b5cf6 (purple), #94a3b8 (gray).
Only include a chart when it genuinely adds value. Do NOT include a chart for single-number answers.`;

// ---------------------------------------------------------------------------
// System prompt: conversational (non-SQL) chat
// ---------------------------------------------------------------------------
function buildChatSystemPrompt(userName: string, userType: string): string {
  const greeting = userName ? `המשתמש שמדבר איתך הוא ${userName} (${userType}).` : "";
  return `אתה עוזר עסקי חכם בשם "העוזר של המצפן". אתה מדבר בעברית.
${greeting}

אתה עוזר לבעלי עסקים לנתח את הנתונים העסקיים שלהם. אתה יכול:
- לענות על שאלות על הכנסות, הוצאות, ספקים, תשלומים
- להשוות בין תקופות
- להציג מצב מול יעדים
- לנתח עלויות עבודה ו-food cost
- להציג יתרות ספקים
- ועוד...

כשמישהו אומר שלום או מה קורה, ענה בקצרה ובחום, פנה אליו בשמו אם ידוע, והציע לו לשאול שאלה על העסק.
תהיה ידידותי וקצר. אל תשתמש באימוג'ים.`;
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
  const history = Array.isArray(body.history) ? body.history : [];

  if (!message || !businessId) {
    return jsonResponse({ error: "חסרים נתונים" }, 400);
  }
  if (message.length > 2000) {
    return jsonResponse({ error: "ההודעה ארוכה מדי (מקסימום 2000 תווים)" }, 400);
  }
  if (!UUID_REGEX.test(businessId)) {
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

  if (profile?.is_admin) {
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

      for await (const chunk of chatStream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          writer.writeText(delta);
        }
      }
      writer.writeDone();
    });
  }

  // =========================================================================
  // SQL path: generate SQL → execute → stream formatted response
  // =========================================================================
  return createSSEStream(async (writer) => {
    // --- Step A: Generate SQL ---
    const sqlSystemPrompt = buildSqlSystemPrompt(businessId);
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
    if (!sql.includes(businessId)) {
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
        { role: "system", content: RESPONSE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            userName ? `המשתמש: ${userName} (${userRole})` : "",
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
      max_tokens: 2500,
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
    const chartMatch = fullResponse.match(/```chart-json\n([\s\S]*?)\n```/);
    if (chartMatch) {
      try {
        const chartData = JSON.parse(chartMatch[1]);
        writer.writeChart(chartData);
      } catch {
        // Invalid chart JSON, ignore
      }
    }

    writer.writeDone();
  });
}
