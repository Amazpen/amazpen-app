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
  const profitTarget = r.profitTarget || 0;
  const priorCommitmentsTotal = r.priorCommitmentsTotal || 0;
  const laborTargetPct = r.laborTargetPct || 0;
  const foodTargetPct = r.foodTargetPct || 0;
  const currentExpensesTarget = r.currentExpensesTarget || 0;

  const laborTargetNis = Math.round((laborTargetPct / 100) * revenueTarget);
  const foodTargetNis = Math.round((foodTargetPct / 100) * revenueTarget);
  const totalExpensesTarget = laborTargetNis + foodTargetNis + currentExpensesTarget;

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

    // Pull the same payload the cron pulls — guarantees parity between
    // automatic and manual sends.
    const origin = new URL(request.url).origin;
    const summaryUrl = `${origin}/api/business-summary-report?business_id=${encodeURIComponent(businessId)}&year=${year}&month=${month}`;
    const summaryRes = await fetch(summaryUrl, { cache: "no-store" });
    if (!summaryRes.ok) {
      return NextResponse.json({ error: `Summary fetch failed: ${summaryRes.status}` }, { status: 502 });
    }
    const summary = (await summaryRes.json()) as SummaryResponse;

    // Default monthName from the resolver if it didn't fill it (older versions).
    if (!summary.monthName) {
      summary.monthName = `${HEBREW_MONTHS[month - 1]} ${year}`;
    }

    const recipientEmails = overrideTo || summary.emails || "";
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
