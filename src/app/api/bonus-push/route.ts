import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveBonusPlanStatus } from "@/lib/bonusPlanResolver";
import type { BonusPlan, BonusPlanStatus } from "@/types/bonus";
import { timingSafeEqual } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpush = require("web-push");

const CRON_SECRET = process.env.CRON_SECRET;

function verifyCronSecret(secret: string | null): boolean {
  if (!CRON_SECRET || !secret) return false;
  try {
    return timingSafeEqual(Buffer.from(secret), Buffer.from(CRON_SECRET));
  } catch { return false; }
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function formatValue(value: number, type: "percentage" | "currency" | "quantity"): string {
  if (type === "percentage") return `${value.toFixed(1)}%`;
  if (type === "quantity") return value.toLocaleString("he-IL");
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCurrency(value: number): string {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}₪${Math.abs(value).toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;
}

function formatPctDiff(value: number): string {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function buildPushMessage(
  plan: Pick<BonusPlan, "area_name" | "measurement_type" | "data_source" | "tips">,
  status: BonusPlanStatus
): string {
  if (plan.data_source === "custom" || status.currentValue === null) {
    const tipSuffix = plan.tips ? `\n💡 טיפ: ${plan.tips.split("\n")[0]}` : "";
    // Plural / neutral phrasing — works for any gender of recipient.
    return `תחום: ${plan.area_name} — אפשר לבדוק את המצב ולפתוח את דדי לעצות${tipSuffix}`;
  }

  const current = formatValue(status.currentValue, plan.measurement_type);
  const goal = status.goalValue !== null ? formatValue(status.goalValue, plan.measurement_type) : null;
  const goalStr = goal ? ` (יעד: ${goal})` : "";

  // Concrete daily nudge in plain Hebrew. Pushes are short by nature, so
  // we give one number per plan with the same structure as the email.
  let dailyNudge = "";
  if (plan.data_source === "revenue" && status.dailyTargetRequired != null && status.dailyTargetRequired > 0) {
    const fmt = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(status.dailyTargetRequired);
    dailyNudge = `\n📅 כדי לעמוד ביעד החודש — היום צריך ${fmt}`;
  } else if (plan.data_source.startsWith("avg_ticket_")) {
    if (status.neededAvgRemaining != null && status.remainingOrders != null && status.bonusTierThreshold != null) {
      const fmt = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(status.neededAvgRemaining);
      dailyNudge = `\n🎯 לבונוס: ב-${status.remainingOrders} ההזמנות שנותרו, ממוצע ${fmt} להזמנה`;
    } else if (status.dailyTargetRequired != null && status.dailyTargetRequired > 0) {
      dailyNudge = `\n📅 קצב מומלץ להיום: ${status.dailyTargetRequired} הזמנות`;
    }
  }

  if (status.qualifiedTier) {
    const bonus = new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: "ILS",
      maximumFractionDigits: 0,
    }).format(status.bonusAmount);
    return `${plan.area_name}: ${current}${goalStr} — מעולה! בדרך לבונוס ${bonus}${dailyNudge}`;
  }

  // Not qualified — include a tip if available. Neutral wording so it
  // reads the same to everyone.
  const tipSuffix = plan.tips ? `\n💡 ${plan.tips.split("\n")[0]}` : " — אפשר לפתוח את דדי לעצות";
  return `${plan.area_name}: ${current}${goalStr} — אפשר לשפר${dailyNudge}${tipSuffix}`;
}

/* ------------------------------------------------------------------ */
/*  Consolidated email builder                                         */
/* ------------------------------------------------------------------ */

interface ResolvedKPI {
  plan: BonusPlan;
  status: BonusPlanStatus;
  displayName: string;
  diffPct: number | null;
  diffAmount: number | null;
}

/**
 * Get the display name for a data source, resolving income source / managed product names
 * from the metrics row when available.
 */
function resolveDisplayName(
  plan: BonusPlan,
  metricsRow: Record<string, unknown> | null,
  incomeSourceNames: Record<string, string>
): string {
  // avg_ticket sources: use income source name
  if (plan.data_source.startsWith("avg_ticket_")) {
    const idx = parseInt(plan.data_source.replace("avg_ticket_", ""));
    const sourceName = incomeSourceNames[plan.data_source];
    return sourceName ? `ממוצע ${sourceName}` : `ממוצע להזמנה — מקור ${idx}`;
  }

  // Managed products: try to get the name from metrics row
  if (plan.data_source.startsWith("managed_product_")) {
    const idx = plan.data_source.replace("managed_product_", "");
    const nameKey = `managed_product_${idx}_name`;
    const mpName = metricsRow?.[nameKey] as string | null;
    return mpName ? `מוצר מנוהל — ${mpName}` : plan.area_name;
  }

  // Otherwise use the plan's area_name
  return plan.area_name;
}

function computeDiffs(
  plan: BonusPlan,
  status: BonusPlanStatus,
  incomeBeforeVat: number | null
): { diffPct: number | null; diffAmount: number | null } {
  if (status.currentValue === null || status.goalValue === null) {
    return { diffPct: null, diffAmount: null };
  }

  const current = status.currentValue;
  const goal = status.goalValue;

  if (plan.measurement_type === "percentage") {
    // For "lower is better" (costs), negative diff means GOOD (below target)
    // For "higher is better", positive diff means GOOD (above target)
    const diffPct = current - goal;
    // Convert percentage diff to ₪ using revenue
    const diffAmount = incomeBeforeVat != null ? (diffPct / 100) * incomeBeforeVat : null;
    return { diffPct, diffAmount };
  }

  if (plan.measurement_type === "currency") {
    const diffAmount = current - goal;
    const diffPct = goal !== 0 ? ((current - goal) / Math.abs(goal)) * 100 : null;
    return { diffPct, diffAmount };
  }

  // quantity
  const diffAmount = current - goal;
  const diffPct = goal !== 0 ? ((current - goal) / Math.abs(goal)) * 100 : null;
  return { diffPct, diffAmount };
}

function isGood(plan: BonusPlan, diff: number): boolean {
  return plan.is_lower_better ? diff <= 0 : diff >= 0;
}

function buildDailyActionsHtml(kpis: ResolvedKPI[]): string {
  // David #10 — concrete actions per plan, deduped across plans.
  const seen = new Set<string>();
  const items: string[] = [];
  for (const k of kpis) {
    const actions = (k.plan as unknown as { daily_actions?: string[] | null }).daily_actions || [];
    for (const action of actions) {
      const trimmed = action.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      items.push(trimmed);
    }
  }
  if (items.length === 0) return "";
  return items
    .map((a) => `<li style="margin: 4px 0; font-size: 14px; color: #FFFFFF; line-height: 1.6;">${a}</li>`)
    .join("");
}

function buildDailyTargetLines(kpis: ResolvedKPI[]): string {
  // David's exact request from the review: every line must read like a
  // sentence an employee could repeat to themselves, with concrete numbers
  // and no "rate of N orders" jargon. The narrative is:
  //   "צופים עוד X הזמנות עד סוף החודש. כדי להגיע ליעד ממוצע ₪Y,
  //    צריך למכור כל הזמנה בממוצע ₪Z."
  // Anything less than that and the employee asks "okay, but what do I
  // actually do?" — which was David's whole complaint.
  const lines: string[] = [];
  const fmtNis = (n: number) =>
    new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(n);

  for (const k of kpis) {
    const s = k.status;
    if (k.plan.data_source === "revenue") {
      if (s.dailyTargetRequired != null && s.dailyTargetRequired > 0) {
        lines.push(
          `📅 <strong>${k.displayName}</strong> — כדי לעמוד ביעד החודש, היום צריך להכניס <strong>${fmtNis(s.dailyTargetRequired)}</strong>.`,
        );
      } else if (s.qualifiedTier != null && s.bonusAmount > 0) {
        lines.push(
          `✅ <strong>${k.displayName}</strong> — היעד כבר הושג. ממשיכים באותו קצב.`,
        );
      }
    } else if (k.plan.data_source.startsWith("avg_ticket_")) {
      if (s.qualifiedTier != null && s.bonusAmount > 0) {
        lines.push(
          `✅ <strong>${k.displayName}</strong> — נעלנו בונוס ${fmtNis(s.bonusAmount)}. שומרים על הקצב הזה עד סוף החודש.`,
        );
      } else if (s.neededAvgRemaining != null && s.remainingOrders != null && s.bonusTierThreshold != null) {
        lines.push(
          `🎯 <strong>${k.displayName}</strong> — צופים עוד <strong>${s.remainingOrders}</strong> הזמנות עד סוף החודש. כדי להגיע ליעד ממוצע ${fmtNis(s.bonusTierThreshold)}, צריך למכור כל הזמנה בממוצע <strong>${fmtNis(s.neededAvgRemaining)}</strong>.`,
        );
      } else if (s.dailyTargetRequired != null && s.dailyTargetRequired > 0) {
        // Fallback when we don't have full bonus tier math (no threshold
        // set yet, or zero remaining orders). Still actionable.
        lines.push(
          `📅 <strong>${k.displayName}</strong> — קצב מומלץ להיום: <strong>${s.dailyTargetRequired}</strong> הזמנות.`,
        );
      }
    }
  }
  return lines.join("<br/><br/>");
}

function buildConsolidatedEmailHtml(
  employeeName: string,
  kpis: ResolvedKPI[],
  totalBonus: number,
  bestTip: string | null,
  businessLabel: string,
): string {
  const LOGO_URL = "https://amazpen.supabase.brainboxai.io/storage/v1/object/public/amazpen//logo%20white.png";
  const GREEN = "#17DB4E";
  const RED = "#FF4D4D";
  const BG = "#0F1535";
  const ROW_BG = "#1A1F4E";
  const HEADER_BG = "#29318A";
  const TEXT = "#FFFFFF";
  const MUTED = "rgba(255,255,255,0.5)";
  const ACCENT = totalBonus > 0 ? GREEN : "#FFA412";

  // Build KPI rows — all in one table.
  // Each row also carries a "mobile-card" class so the @media block at the
  // top of the document can flip rows into stacked cards on small screens.
  let tableRowsHtml = "";
  for (const kpi of kpis) {
    const { plan, status, displayName, diffPct, diffAmount } = kpi;

    const currentStr = status.currentValue !== null ? formatValue(status.currentValue, plan.measurement_type) : "—";
    const goalStr = status.goalValue !== null ? formatValue(status.goalValue, plan.measurement_type) : "—";

    let diffPctStr = "—";
    let diffAmountStr = "—";
    let rowColor = TEXT;

    if (diffPct !== null) {
      const good = isGood(plan, diffPct);
      rowColor = good ? GREEN : RED;
      diffPctStr = formatPctDiff(diffPct);
    }

    if (diffAmount !== null) {
      diffAmountStr = formatCurrency(diffAmount);
    }

    tableRowsHtml += `
      <tr class="kpi-row" style="border-bottom: 1px solid rgba(255,255,255,0.08);">
        <td class="kpi-cell kpi-name" data-label="פרמטר" style="padding: 10px 12px; color: ${TEXT}; font-size: 14px; text-align: right;">${displayName}</td>
        <td class="kpi-cell" data-label="יעד" style="padding: 10px 8px; color: ${MUTED}; font-size: 14px; text-align: center;">${goalStr}</td>
        <td class="kpi-cell" data-label="בפועל" style="padding: 10px 8px; color: ${rowColor}; font-size: 14px; text-align: center; font-weight: bold;">${currentStr}</td>
        <td class="kpi-cell" data-label="הפרש %" style="padding: 10px 8px; color: ${rowColor}; font-size: 14px; text-align: center;">${diffPctStr}</td>
        <td class="kpi-cell" data-label="הפרש ₪" style="padding: 10px 8px; color: ${rowColor}; font-size: 14px; text-align: center;">${diffAmountStr}</td>
      </tr>`;
  }

  const planNames = [...new Set(kpis.map(k => k.plan.area_name))];
  const planNamesHtml = planNames.map(name =>
    `<span style="display: inline-block; background: ${HEADER_BG}; padding: 4px 14px; border-radius: 6px; font-size: 13px; margin: 3px 4px; color: ${TEXT};">${name}</span>`
  ).join("");

  const bonusFormatted = new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(totalBonus);

  const bonusStatusText = totalBonus > 0
    ? `נכון לעכשיו צפי הבונוס הינו <span style="color: ${GREEN}; font-weight: bold; font-size: 20px;">${bonusFormatted}</span>`
    : `נכון לעכשיו אין צפי לבונוס — אפשר לשפר.`;

  const tipHtml = bestTip
    ? `<div style="background: ${ROW_BG}; border-radius: 8px; padding: 14px 18px; margin: 16px 0; border-right: 4px solid #FFA412;">
        <p style="margin: 0; font-size: 14px; color: ${TEXT}; line-height: 1.6;">💡 <strong>עצה לביצוע היום:</strong> ${bestTip}</p>
      </div>`
    : "";

  const dailyTargetText = buildDailyTargetLines(kpis);
  const dailyTargetHtml = dailyTargetText
    ? `<div style="background: ${ROW_BG}; border-radius: 8px; padding: 14px 18px; margin: 16px 0; border-right: 4px solid ${GREEN};">
        <p style="margin: 0 0 6px 0; font-size: 13px; color: ${MUTED};">היעד להיום:</p>
        <p style="margin: 0; font-size: 14px; color: ${TEXT}; line-height: 1.7;">${dailyTargetText}</p>
      </div>`
    : "";

  const dailyActionsItems = buildDailyActionsHtml(kpis);
  const dailyActionsHtml = dailyActionsItems
    ? `<div style="background: ${ROW_BG}; border-radius: 8px; padding: 14px 18px; margin: 16px 0; border-right: 4px solid #4A56D4;">
        <p style="margin: 0 0 8px 0; font-size: 13px; color: ${MUTED};">משימות להיום:</p>
        <ul style="margin: 0; padding-right: 18px;">${dailyActionsItems}</ul>
      </div>`
    : "";

  // David's responsive request: the table breaks badly on phones — narrow
  // viewport collapses every cell into a tower of 2-character columns.
  // The @media block flips rows into stacked cards (label : value pairs
  // using data-label) on screens < 480px. Older email clients just ignore
  // the styles and keep the desktop table layout, so it's a safe upgrade.
  const styleBlock = `
    <style>
      @media (max-width: 480px) {
        .container { padding: 16px !important; }
        .header-title { font-size: 20px !important; }
        .header-business { font-size: 14px !important; }
        .plan-names span { font-size: 12px !important; padding: 3px 10px !important; }
        .kpi-table thead { display: none !important; }
        .kpi-table, .kpi-table tbody, .kpi-row, .kpi-cell { display: block !important; width: 100% !important; }
        .kpi-row { background: ${ROW_BG} !important; border-radius: 8px !important; margin-bottom: 10px !important; padding: 10px 12px !important; border: 1px solid rgba(255,255,255,0.08) !important; }
        .kpi-cell { display: flex !important; justify-content: space-between !important; align-items: center !important; padding: 5px 0 !important; text-align: right !important; border: none !important; }
        .kpi-cell::before { content: attr(data-label); color: ${MUTED}; font-size: 12px; }
        .kpi-cell.kpi-name { font-weight: bold; font-size: 15px !important; padding-bottom: 8px !important; border-bottom: 1px solid rgba(255,255,255,0.08) !important; margin-bottom: 5px !important; }
        .kpi-cell.kpi-name::before { display: none !important; }
        .cta { padding: 14px 20px !important; font-size: 14px !important; }
      }
    </style>
  `;

  const businessHeader = businessLabel
    ? `<p class="header-business" style="margin: 4px 0 0 0; font-size: 15px; color: ${MUTED};">${businessLabel}</p>`
    : "";

  // Greeting in plural so the same copy works for any gender / multiple
  // recipients without a "שלך / שלכם" mismatch.
  const greetingName = employeeName ? `, ${employeeName}` : "";

  return `
    <!DOCTYPE html>
    <html dir="rtl" lang="he">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      ${styleBlock}
    </head>
    <body style="margin: 0; padding: 0; background: ${BG};">
      <div class="container" dir="rtl" style="font-family: Assistant, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: ${BG}; border-radius: 12px; padding: 28px; color: ${TEXT};">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 22px;">
          <h2 class="header-title" style="margin: 0 0 6px 0; font-size: 22px; color: ${ACCENT};">🎯 עדכון בונוס יומי</h2>
          ${businessHeader}
          <p style="margin: 10px 0 0 0; font-size: 16px; color: ${TEXT};">שלום${greetingName},</p>
        </div>

        <!-- Plan names -->
        <div class="plan-names" style="text-align: center; margin-bottom: 20px;">
          ${planNamesHtml}
        </div>

        <!-- KPI Table -->
        <table class="kpi-table" dir="rtl" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; background: ${ROW_BG}; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background: ${HEADER_BG};">
              <th style="padding: 12px; font-size: 13px; color: ${MUTED}; text-align: right; font-weight: 600;">פרמטר שנמדד</th>
              <th style="padding: 12px 8px; font-size: 13px; color: ${MUTED}; text-align: center; font-weight: 600;">יעד</th>
              <th style="padding: 12px 8px; font-size: 13px; color: ${MUTED}; text-align: center; font-weight: 600;">בפועל</th>
              <th style="padding: 12px 8px; font-size: 13px; color: ${MUTED}; text-align: center; font-weight: 600;">הפרש ב%</th>
              <th style="padding: 12px 8px; font-size: 13px; color: ${MUTED}; text-align: center; font-weight: 600;">הפרש ב-₪</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>

        <!-- Bonus Status -->
        <div style="text-align: center; margin: 22px 0; padding: 18px; background: ${ROW_BG}; border-radius: 8px; border: 1px solid ${ACCENT}40;">
          <p style="margin: 0 0 4px 0; font-size: 13px; color: ${MUTED};">סטטוס בונוס</p>
          <p style="margin: 0; font-size: 16px; color: ${TEXT}; line-height: 1.6;">${bonusStatusText}</p>
        </div>

        ${dailyTargetHtml}
        ${dailyActionsHtml}
        ${tipHtml}

        <div style="text-align: center; margin-top: 20px;">
          <a class="cta" href="https://app.amazpenbiz.co.il/ai" style="display: inline-block; background: #2C3595; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 15px; font-weight: bold;">🤖 לפתיחת דדי — היועץ הדיגיטלי לעצות נוספות</a>
        </div>

        <div style="text-align: center; margin-top: 28px;">
          <img src="${LOGO_URL}" alt="Amazpen" style="height: 32px; opacity: 0.7;" />
          <p style="font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 8px;">המצפן — מערכת ניהול עסקית</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/* ------------------------------------------------------------------ */
/*  Main handler                                                       */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  // Auth check (timing-safe, header only)
  if (!verifyCronSecret(request.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // Get current Israel hour
    const israelHour = parseInt(
      new Date().toLocaleString("he-IL", {
        timeZone: "Asia/Jerusalem",
        hour: "numeric",
        hour12: false,
      })
    );

    // Fetch active plans for this hour
    const { data: plans, error: plansError } = await supabaseAdmin
      .from("bonus_plans")
      .select("*")
      .eq("is_active", true)
      .eq("push_enabled", true)
      .eq("push_hour", israelHour)
      .is("deleted_at", null);

    if (plansError) {
      console.error("[BonusPush] Failed to fetch plans:", plansError);
      return NextResponse.json({ error: "Failed to fetch plans" }, { status: 500 });
    }

    if (!plans || plans.length === 0) {
      return NextResponse.json({ processed: 0, message: "No plans for this hour" });
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // Get Israel day-of-week for push_days filter
    const israelDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
    const israelDay = israelDate.getDay(); // 0=Sunday..6=Saturday

    // Filter plans: only send on days included in push_days
    const filteredPlans = (plans as BonusPlan[]).filter((p) => {
      const pushDays = p.push_days || [0, 1, 2, 3, 4, 5, 6]; // default: all days
      return pushDays.includes(israelDay);
    });

    if (filteredPlans.length === 0) {
      return NextResponse.json({ processed: 0, message: `No plans for day ${israelDay}` });
    }

    // Setup webpush
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY!;
    const vapidSubject = process.env.VAPID_SUBJECT || "mailto:hello@amazpen.co.il";

    if (!vapidPublicKey || !vapidPrivateKey) {
      return NextResponse.json({ error: "VAPID config missing" }, { status: 500 });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    let sent = 0;
    let failed = 0;
    let emailsSent = 0;
    let notificationsCreated = 0;

    // ====================================================================
    // Phase 1: Resolve all plan statuses and send per-plan push + in-app
    // ====================================================================

    // Group plans by employee_user_id for consolidated email
    const employeePlansMap = new Map<string, { plan: BonusPlan; status: BonusPlanStatus }[]>();

    for (const plan of filteredPlans) {
      try {
        // Resolve KPI status
        const status = await resolveBonusPlanStatus(supabaseAdmin, plan, year, month);

        // Store for consolidated email
        if (!employeePlansMap.has(plan.employee_user_id)) {
          employeePlansMap.set(plan.employee_user_id, []);
        }
        employeePlansMap.get(plan.employee_user_id)!.push({ plan, status });

        // Build message for push/notification
        const message = buildPushMessage(plan, status);
        const title = `עדכון בונוס — ${plan.area_name}`;

        // Get employee info
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("email, full_name")
          .eq("id", plan.employee_user_id)
          .maybeSingle();

        // === 1. Send web push notification (per plan, as before) ===
        const { data: subscriptions } = await supabaseAdmin
          .from("push_subscriptions")
          .select("endpoint, p256dh, auth")
          .eq("user_id", plan.employee_user_id);

        if (subscriptions && subscriptions.length > 0) {
          const payload = JSON.stringify({ title, message, url: "/ai" });

          for (const sub of subscriptions) {
            try {
              await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload
              );
              sent++;
            } catch (err: unknown) {
              const pushErr = err as { statusCode?: number };
              if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                await supabaseAdmin
                  .from("push_subscriptions")
                  .delete()
                  .eq("endpoint", sub.endpoint);
              }
              failed++;
            }
          }
        }

        // === 2. Create in-app notification (per plan, as before) ===
        const { error: notifError } = await supabaseAdmin
          .from("notifications")
          .insert({
            user_id: plan.employee_user_id,
            business_id: plan.business_id,
            title,
            message,
            type: "bonus",
            is_read: false,
            link: "/ai",
          });

        if (!notifError) notificationsCreated++;

        // === 3. Notify business managers/owners (per plan, as before) ===
        const { data: managers } = await supabaseAdmin
          .from("business_members")
          .select("user_id")
          .eq("business_id", plan.business_id)
          .in("role", ["owner", "manager"])
          .is("deleted_at", null)
          .neq("user_id", plan.employee_user_id);

        if (managers && managers.length > 0) {
          const managerTitle = `עדכון בונוס — ${profile?.full_name || ""} — ${plan.area_name}`;
          for (const mgr of managers) {
            // In-app notification for manager
            await supabaseAdmin.from("notifications").insert({
              user_id: mgr.user_id,
              business_id: plan.business_id,
              title: managerTitle,
              message,
              type: "bonus",
              is_read: false,
              link: "/admin/bonus-plans",
            });

            // Web push for manager
            const { data: mgrSubs } = await supabaseAdmin
              .from("push_subscriptions")
              .select("endpoint, p256dh, auth")
              .eq("user_id", mgr.user_id);

            if (mgrSubs && mgrSubs.length > 0) {
              const mgrPayload = JSON.stringify({ title: managerTitle, message, url: "/admin/bonus-plans" });
              for (const sub of mgrSubs) {
                try {
                  await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    mgrPayload
                  );
                } catch (err: unknown) {
                  const pushErr = err as { statusCode?: number };
                  if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                    await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`[BonusPush] Error processing plan ${plan.id}:`, err);
        failed++;
      }
    }

    // ====================================================================
    // Phase 2: Send ONE consolidated email per employee
    // ====================================================================

    for (const [employeeUserId, planStatuses] of employeePlansMap) {
      try {
        // Get employee profile
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("email, full_name")
          .eq("id", employeeUserId)
          .maybeSingle();

        if (!profile?.email) continue;

        // Collect all unique business IDs for this employee's plans
        const businessIds = [...new Set(planStatuses.map(ps => ps.plan.business_id))];

        // Fetch business names so the email + subject can name them
        // explicitly. David's call: "עדכון בונוס יומי — אושי אושי" beats
        // a generic "עדכון בונוס יומי" because employees and the owner
        // both forward these, and without the business name in the subject
        // it's impossible to tell which branch the numbers belong to.
        const businessNamesMap = new Map<string, string>();
        {
          const { data: bizRows } = await supabaseAdmin
            .from("businesses")
            .select("id, name")
            .in("id", businessIds);
          (bizRows || []).forEach((b: { id: string; name: string }) => {
            businessNamesMap.set(b.id, b.name);
          });
        }

        // Fetch metrics for all businesses (for ₪ conversion and managed product names)
        const metricsMap = new Map<string, Record<string, unknown>>();
        for (const bizId of businessIds) {
          const { data: metrics } = await supabaseAdmin
            .from("business_monthly_metrics")
            .select("*")
            .eq("business_id", bizId)
            .eq("year", year)
            .eq("month", month)
            .maybeSingle();
          if (metrics) metricsMap.set(bizId, metrics as Record<string, unknown>);
        }

        // Fetch income source names for avg_ticket plans
        const incomeSourceNames: Record<string, string> = {};
        const avgTicketPlans = planStatuses.filter(ps => ps.plan.data_source.startsWith("avg_ticket_"));
        if (avgTicketPlans.length > 0) {
          for (const bizId of businessIds) {
            const { data: sources } = await supabaseAdmin
              .from("income_sources")
              .select("id, name")
              .eq("business_id", bizId)
              .eq("is_active", true)
              .is("deleted_at", null)
              .order("display_order");

            if (sources) {
              sources.forEach((s: { id: string; name: string }, idx: number) => {
                incomeSourceNames[`avg_ticket_${idx + 1}`] = s.name;
              });
            }
          }
        }

        // Resolve all KPIs with diffs
        const resolvedKPIs: ResolvedKPI[] = [];
        let totalBonus = 0;
        let bestTip: string | null = null;
        let bestTipImpact = 0;

        for (const { plan, status } of planStatuses) {
          const metricsRow = metricsMap.get(plan.business_id) || null;
          const incomeBeforeVat = metricsRow?.income_before_vat != null
            ? Number(metricsRow.income_before_vat)
            : null;

          const displayName = resolveDisplayName(plan, metricsRow, incomeSourceNames);
          const { diffPct, diffAmount } = computeDiffs(plan, status, incomeBeforeVat);

          resolvedKPIs.push({ plan, status, displayName, diffPct, diffAmount });

          // Accumulate bonus
          totalBonus += status.bonusAmount;

          // Find best tip: from plans NOT meeting target with highest ₪ impact
          if (!status.qualifiedTier && plan.tips && diffAmount !== null) {
            const impact = Math.abs(diffAmount);
            if (impact > bestTipImpact) {
              bestTipImpact = impact;
              bestTip = plan.tips.split("\n")[0];
            }
          }
        }

        // Compose business label for subject + header. When the employee
        // owns plans across several businesses we list them all so the
        // header reflects what's inside; usually it's just one.
        const businessLabel = businessIds
          .map(id => businessNamesMap.get(id))
          .filter((n): n is string => Boolean(n))
          .join(" · ");

        // Build and send consolidated email
        const emailHtml = buildConsolidatedEmailHtml(
          profile.full_name || "",
          resolvedKPIs,
          totalBonus,
          bestTip,
          businessLabel
        );

        const subjectSuffix = businessLabel ? ` — ${businessLabel}` : "";
        const emailSubject = totalBonus > 0
          ? `🎯 עדכון בונוס יומי${subjectSuffix} — צפי ${new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(totalBonus)}`
          : `🎯 עדכון בונוס יומי${subjectSuffix} — אפשר לשפר`;

        // CC the Amazpen owner (David) on every bonus email so he sees what
        // employees receive — explicit request, asked twice in the David
        // review session.
        const OWNER_CC = process.env.BONUS_EMAIL_OWNER_CC || "david@amazpen.co.il";
        const emailRes = await fetch("https://n8n-lv4j.onrender.com/webhook/daily-push-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: profile.email,
            cc: OWNER_CC,
            subject: emailSubject,
            html: emailHtml,
          }),
        });

        if (emailRes.ok) emailsSent++;
        else console.error(`[BonusPush] Email failed for ${profile.email}: ${emailRes.status}`);
      } catch (emailErr) {
        console.error(`[BonusPush] Email error for employee ${employeeUserId}:`, emailErr);
      }
    }

    console.log(`[BonusPush] Processed ${plans.length} plans, push_sent=${sent}, emails=${emailsSent}, notifications=${notificationsCreated}, failed=${failed}`);
    return NextResponse.json({ processed: plans.length, sent, emailsSent, notificationsCreated, failed });
  } catch (err) {
    console.error("[BonusPush] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
