import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient as createSupabaseServer } from "@/lib/supabase/server";

/**
 * Manual trigger for the monthly goals email. Mirrors the n8n cron
 * "שליחת יעדים 28 לחודש" but lets an admin push it from the UI for a
 * single business + month. Reuses /api/business-summary-report so the
 * data shape is identical to the scheduled job; reuses the n8n
 * `daily-push-email` webhook for actual delivery so we don't keep two
 * SMTP paths in sync.
 *
 * David's ask: a button on /admin/goals to send the goals email to a
 * chosen business on demand.
 */

const N8N_EMAIL_WEBHOOK = "https://n8n-lv4j.onrender.com/webhook/daily-push-email";

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

function fmtNum(n: unknown): string {
  const v = Number(n) || 0;
  return Math.round(v).toLocaleString("he-IL");
}
function fmtPct(n: unknown): string {
  const v = Number(n) || 0;
  return v.toFixed(0);
}

interface SummaryResponse {
  businessName?: string;
  emails?: string;
  monthName?: string;
  revenueTarget?: number;
  profitTarget?: number;
  priorCommitmentsTotal?: number;
  laborTargetPct?: number;
  foodTargetPct?: number;
  currentExpensesTarget?: number;
  expenseCategories?: { name: string; amount: number }[];
  incomeSources?: { name: string; avgTicketTarget: number }[];
}

function buildEmailHtml(r: SummaryResponse): string {
  const bizName = r.businessName || "";
  const monthName = r.monthName || "";
  const revenueTarget = r.revenueTarget || 0;
  const priorCommitmentsTotal = r.priorCommitmentsTotal || 0;
  const laborTargetPct = r.laborTargetPct || 0;
  const foodTargetPct = r.foodTargetPct || 0;
  const currentExpensesTarget = r.currentExpensesTarget || 0;

  const laborTargetNis = Math.round((laborTargetPct / 100) * revenueTarget);
  const foodTargetNis = Math.round((foodTargetPct / 100) * revenueTarget);
  // The current_expenses target on goals isn't always populated. If we have
  // the per-category breakdown, prefer summing those — guarantees the
  // "סה"כ הוצאות" matches the "פירוט הוצאות" rows.
  const currentExpensesFromCategories = (r.expenseCategories || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const effectiveCurrentExpenses = currentExpensesFromCategories > 0 ? currentExpensesFromCategories : currentExpensesTarget;
  const totalExpensesTarget = laborTargetNis + foodTargetNis + effectiveCurrentExpenses;
  // Profit target stored on goals tends to be NULL — derive it instead so
  // the email never shows "₪0" when the user clearly has revenue and
  // expense targets configured. Falls back to the stored value only if the
  // derived one is also zero (no targets at all).
  const derivedProfit = revenueTarget - totalExpensesTarget;
  const profitTarget = derivedProfit !== 0 ? derivedProfit : (r.profitTarget || 0);

  const categoryRows = r.expenseCategories && r.expenseCategories.length > 0
    ? r.expenseCategories
    : [
        { name: "עלות עובדים", amount: laborTargetNis },
        { name: "עלות מכר", amount: foodTargetNis },
        { name: "הוצאות שוטפות", amount: currentExpensesTarget },
      ].filter((x) => x.amount > 0);

  const expenseRowsHtml = categoryRows
    .map((x) => `<tr><td>${x.name}</td><td>₪${fmtNum(x.amount)}</td></tr>`)
    .join("");

  const incomeSources = r.incomeSources || [];
  const kpiHeaders = incomeSources.map((s) => `<th>ממוצע ${s.name}</th>`).join("");
  const kpiValues = incomeSources.map((s) => `<td>₪${fmtNum(s.avgTicketTarget)}</td>`).join("");

  const priorCommitmentsHtml = priorCommitmentsTotal > 0
    ? `<p class="highlight">ואלה ההתחייבויות הקודמות (הלוואות שיורדות החודש) על סך: <span class="highlight">₪${fmtNum(priorCommitmentsTotal)}</span></p>`
    : "";

  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><title>דו"ח תוכנית חודשית</title><meta name="viewport" content="width=device-width,initial-scale=1.0"><style>body{margin:0!important;padding:0!important;font-family:'Segoe UI',Tahoma,sans-serif!important;background:#f5f7fa!important;color:#333!important;direction:rtl!important;text-align:right!important;font-size:16px!important;}.container{max-width:700px;margin:40px auto;background:#fff!important;border-radius:16px!important;box-shadow:0 4px 12px rgba(0,0,0,0.1)!important;overflow:hidden;}.header{background:#f3e8ff!important;padding:24px!important;text-align:center!important;color:#8328f8!important;}.header img{max-width:140px!important;margin-bottom:12px!important;}.header h2{margin:0;font-size:22px!important;}.content{padding:24px!important;background:#f8f5ff!important;line-height:1.8!important;}.content p{margin:12px 0!important;}.highlight{font-weight:bold!important;color:#d33bd8!important;}.table-responsive{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;margin-top:16px;}table{width:100%!important;min-width:500px;border-collapse:collapse!important;}th,td{border:1px solid #ddd!important;padding:12px!important;font-size:14px!important;text-align:right!important;}th{background:#f3e8ff!important;color:#8328f8!important;}tr:nth-child(even){background:#f9f7fc!important;}.button{display:inline-block!important;padding:12px 24px!important;background:#8328f8!important;color:#fff!important;text-decoration:none!important;border-radius:6px!important;font-weight:bold!important;margin-top:24px!important;font-size:16px!important;}.footer{padding:16px!important;text-align:center!important;font-size:12px!important;background:#f3e8ff!important;color:#888!important;}</style></head><body dir="rtl"><div class="container"><div class="header"><h2>דו"ח חודשי עסקי</h2></div><div class="content"><p>שלום, ${bizName}</p><p>להלן התוכנית העסקית לחודש <span class="highlight">${monthName}</span></p><p>צפי הרווח לחודש <span class="highlight">${monthName}</span> הינו: <span class="highlight">₪${fmtNum(profitTarget)}</span></p>${priorCommitmentsHtml}<p class="highlight">להלן התחזית הפיננסית:</p><div class="table-responsive"><table><tr><th>צפי הכנסות ללא מע"מ</th><th>צפי הוצאות ללא מע"מ</th><th>סה"כ רווח</th></tr><tr><td class="highlight">₪${fmtNum(revenueTarget)}</td><td class="highlight">₪${fmtNum(totalExpensesTarget)}</td><td class="highlight">₪${fmtNum(profitTarget)}</td></tr></table></div><p class="highlight">להלן פירוט ההוצאות:</p><div class="table-responsive"><table><tr><th>קטגוריה</th><th>סכום צפי הוצאה ללא מע"מ</th></tr>${expenseRowsHtml}</table></div><p class="highlight">בכדי להגיע ליעדים, אלו מדדי ה-KPI לחודש <span class="highlight">${monthName}</span>:</p><div class="table-responsive"><table><tr><th>סה"כ מכירות ללא מע"מ</th>${kpiHeaders}<th>עלות עובדים</th><th>עלות מכר</th></tr><tr><td class="highlight">₪${fmtNum(revenueTarget)}</td>${kpiValues}<td class="highlight">${fmtPct(laborTargetPct)}%</td><td class="highlight">${fmtPct(foodTargetPct)}%</td></tr></table></div><p>אנחנו נהיה כאן בשבילך במהלך החודש, נעקוב ונעדכן אותך מדי יום על התוצאות בפועל וקצב ההתקדמות של העסק בהשוואה ליעדים ולתוצאות עבר.<br>לצפייה בפירוט המלא ניתן להכנס לאפליקציה לעמוד "יעדים".<br>במידה ויש צורך בשינוי יש לפנות לשירות הלקוחות: 054-5554106.<br>אנחנו זמינים לכל שאלה ומאחלים לך המון בהצלחה בהשגת היעדים החודש.</p><div style="text-align:center;"><a class="button" href="https://app.amazpenbiz.co.il" target="_blank">כניסה לאפליקציה</a></div><p style="margin:24px 0 8px 0;text-align:right;">בברכה,<br>צוות המצפן</p></div><div class="footer">© ${new Date().getFullYear()} המצפן - כל הזכויות שמורות</div></div></body></html>`;
}

export async function POST(request: NextRequest) {
  try {
    // Auth: only admins (matches the rest of the /api/admin namespace).
    const sb = await createSupabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const adminSb = createSupabaseAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    // The profiles table uses an `is_admin` boolean — not a `role` column
    // (the previous check `profile?.role !== "admin"` was always falsy →
    // every request returned 403, which is what David hit).
    const { data: profile } = await adminSb
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.is_admin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const businessId = String(body.business_id || "");
    if (!businessId) {
      return NextResponse.json({ error: "Missing business_id" }, { status: 400 });
    }

    const now = new Date();
    const year = Number(body.year) || now.getFullYear();
    const month = Number(body.month) || now.getMonth() + 1;
    // Override "to" lets the admin redirect a test send. Empty → use the
    // owners' emails resolved by /api/business-summary-report.
    const overrideTo = typeof body.to === "string" && body.to.trim() ? body.to.trim() : "";

    // Pull the data we need DIRECTLY from supabase — no internal fetch.
    // The previous approach (fetch /api/business-summary-report) failed in
    // the docker container on Dokploy because new URL(request.url).origin
    // resolves to a loopback that the network policy blocks → 500 with no
    // log surface. Reading from supabase here is: faster, no network hop,
    // and survives any server URL config.
    const [bizRes, goalRes, sourcesRes, sourceGoalsRes, priorRes, budgetsRes, categoriesRes] = await Promise.all([
      adminSb
        .from("businesses")
        .select("name")
        .eq("id", businessId)
        .maybeSingle(),
      adminSb
        .from("goals")
        .select("revenue_target, profit_target, labor_cost_target_pct, food_cost_target_pct, current_expenses_target")
        .eq("business_id", businessId)
        .eq("year", year)
        .eq("month", month)
        .is("deleted_at", null)
        .maybeSingle(),
      adminSb
        .from("income_sources")
        .select("id, name, display_order")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("display_order"),
      adminSb
        .from("goals")
        .select("id, income_source_goals(income_source_id, avg_ticket_target)")
        .eq("business_id", businessId)
        .eq("year", year)
        .eq("month", month)
        .is("deleted_at", null)
        .maybeSingle(),
      adminSb
        .from("prior_commitments")
        .select("monthly_amount, start_date, end_date")
        .eq("business_id", businessId)
        .is("deleted_at", null),
      // Supplier budgets joined with the supplier so we can group by category
      // — this is what produces the per-category expense breakdown that the
      // legacy n8n cron showed (15 rows: ביטוח רכבים, פרסום, חברת משלוחים…).
      adminSb
        .from("supplier_budgets")
        .select("budget_amount, supplier:suppliers(expense_category_id, expense_type)")
        .eq("business_id", businessId)
        .eq("year", year)
        .eq("month", month)
        .is("deleted_at", null),
      adminSb
        .from("expense_categories")
        .select("id, name, parent_id")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .is("deleted_at", null),
    ]);

    if (!bizRes.data) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    const goal = goalRes.data || {};
    const sources = (sourcesRes.data || []) as Array<{ id: string; name: string }>;
    const sourceGoalsRaw = (sourceGoalsRes.data?.income_source_goals as Array<{ income_source_id: string; avg_ticket_target: number }> | undefined) || [];
    const sourceGoalMap = new Map(sourceGoalsRaw.map((g) => [g.income_source_id, Number(g.avg_ticket_target) || 0]));

    // Build per-category expense breakdown for current_expenses suppliers.
    // Use the SUPPLIER'S OWN category — not the root parent. The legacy
    // cron showed 15 specific rows (פרסום מזדמן, ביטוח רכבים, חברת משלוחים)
    // because suppliers are categorized at leaf level. Walking up to root
    // collapsed everything into 2 mega-groups ("הוצאות תפעול" / "הוצאות
    // שיווק") — that's what produced the wrong email David flagged.
    type Category = { id: string; name: string; parent_id: string | null };
    const cats = (categoriesRes.data || []) as Category[];
    const catById = new Map<string, Category>(cats.map((c) => [c.id, c]));
    const resolveCategoryName = (categoryId: string | null): string => {
      if (!categoryId) return "אחר";
      return catById.get(categoryId)?.name || "אחר";
    };

    type BudgetRow = {
      budget_amount: number;
      supplier: { expense_category_id: string | null; expense_type: string | null } | null;
    };
    const budgets = (budgetsRes.data || []) as unknown as BudgetRow[];
    const expenseByCategory = new Map<string, number>();
    for (const b of budgets) {
      const sup = b.supplier;
      if (!sup) continue;
      // Email shows current_expenses category breakdown — labor and goods
      // already get their dedicated rows from labor% × revenue and food% ×
      // revenue. Don't double-count them here.
      if (sup.expense_type !== "current_expenses") continue;
      const name = resolveCategoryName(sup.expense_category_id);
      const amount = Number(b.budget_amount) || 0;
      if (amount === 0) continue;
      expenseByCategory.set(name, (expenseByCategory.get(name) || 0) + amount);
    }
    const expenseCategories = Array.from(expenseByCategory.entries())
      .map(([name, amount]) => ({ name, amount: Math.round(amount) }))
      .sort((a, b) => a.name.localeCompare(b.name, "he"));

    // Prior commitments active in the requested month
    const monthStartIso = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDayOfMonth = new Date(year, month, 0);
    const monthEndIso = `${year}-${String(month).padStart(2, "0")}-${String(lastDayOfMonth.getDate()).padStart(2, "0")}`;
    const priorCommitmentsTotal = ((priorRes.data || []) as Array<{ monthly_amount: number; start_date: string | null; end_date: string | null }>)
      .filter((p) => {
        const startsByEnd = !p.start_date || p.start_date <= monthEndIso;
        const endsAfterStart = !p.end_date || p.end_date >= monthStartIso;
        return startsByEnd && endsAfterStart;
      })
      .reduce((s, p) => s + (Number(p.monthly_amount) || 0), 0);

    const summary: SummaryResponse = {
      businessName: bizRes.data.name,
      monthName: `${HEBREW_MONTHS[month - 1]} ${year}`,
      revenueTarget: Number((goal as { revenue_target?: number }).revenue_target) || 0,
      profitTarget: Number((goal as { profit_target?: number }).profit_target) || 0,
      priorCommitmentsTotal,
      laborTargetPct: Number((goal as { labor_cost_target_pct?: number }).labor_cost_target_pct) || 0,
      foodTargetPct: Number((goal as { food_cost_target_pct?: number }).food_cost_target_pct) || 0,
      currentExpensesTarget: Number((goal as { current_expenses_target?: number }).current_expenses_target) || 0,
      incomeSources: sources.map((s) => ({
        name: s.name,
        avgTicketTarget: sourceGoalMap.get(s.id) || 0,
      })),
      expenseCategories,
    };

    // Default monthName from the resolver if it didn't fill it (older versions).
    if (!summary.monthName) {
      summary.monthName = `${HEBREW_MONTHS[month - 1]} ${year}`;
    }

    // Recipient is always provided by the client — the dialog now picks owners
    // and sends them as a comma-separated `to`. Fall back to resolving owners
    // here only if the client didn't send any (legacy callers).
    let recipientEmails = overrideTo;
    if (!recipientEmails) {
      const { data: members } = await adminSb
        .from("business_members")
        .select("profiles:user_id(email)")
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .in("role", ["admin", "owner"]);
      recipientEmails = ((members || []) as Array<{ profiles: { email?: string } | null }>)
        .map((m) => m.profiles?.email)
        .filter((e): e is string => !!e)
        .join(", ");
    }
    if (!recipientEmails) {
      return NextResponse.json({
        error: "No recipient email — set a recipient on the business or pick one of its owners.",
      }, { status: 400 });
    }

    const ownerCc = process.env.BONUS_EMAIL_OWNER_CC || "david@amazpen.co.il";
    const subject = `צפי רווח ויעדי KPI לחודש ${summary.monthName}`;
    const html = buildEmailHtml(summary);

    const sendRes = await fetch(N8N_EMAIL_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: recipientEmails,
        cc: ownerCc,
        subject,
        html,
      }),
    });
    if (!sendRes.ok) {
      const errText = await sendRes.text().catch(() => "");
      return NextResponse.json({ error: `Email send failed: ${sendRes.status} ${errText}` }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      sentTo: recipientEmails,
      cc: ownerCc,
      subject,
      monthName: summary.monthName,
    });
  } catch (err) {
    console.error("[send-goals-email] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
