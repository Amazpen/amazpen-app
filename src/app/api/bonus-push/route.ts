import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveBonusPlanStatus } from "@/lib/bonusPlanResolver";
import type { BonusPlan, BonusPlanStatus } from "@/types/bonus";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpush = require("web-push");

const CRON_SECRET = process.env.CRON_SECRET;

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function formatValue(value: number, type: "percentage" | "currency"): string {
  if (type === "percentage") return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

function buildPushMessage(
  plan: Pick<BonusPlan, "area_name" | "measurement_type" | "data_source">,
  status: BonusPlanStatus
): string {
  if (plan.data_source === "custom" || status.currentValue === null) {
    return `תחום: ${plan.area_name} — בדוק את המצב שלך ופתח את דדי לעצות`;
  }

  const current = formatValue(status.currentValue, plan.measurement_type);
  const goal = status.goalValue !== null ? formatValue(status.goalValue, plan.measurement_type) : null;
  const goalStr = goal ? ` (יעד: ${goal})` : "";

  if (status.qualifiedTier) {
    const bonus = new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: "ILS",
      maximumFractionDigits: 0,
    }).format(status.bonusAmount);
    return `${plan.area_name}: ${current}${goalStr} — מעולה! בדרך לבונוס ${bonus}`;
  }

  return `${plan.area_name}: ${current}${goalStr} — עוד מאמץ קטן! פתח את דדי לעצות`;
}

export async function POST(request: NextRequest) {
  // Auth check
  const secret =
    request.headers.get("x-cron-secret") ||
    request.nextUrl.searchParams.get("secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
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

    for (const plan of plans as BonusPlan[]) {
      try {
        // Resolve KPI status
        const status = await resolveBonusPlanStatus(supabaseAdmin, plan, year, month);

        // Build message
        const message = buildPushMessage(plan, status);

        // Fetch subscriptions for this employee
        const { data: subscriptions } = await supabaseAdmin
          .from("push_subscriptions")
          .select("endpoint, p256dh, auth")
          .eq("user_id", plan.employee_user_id);

        if (!subscriptions || subscriptions.length === 0) continue;

        const payload = JSON.stringify({
          title: `עדכון בונוס — ${plan.area_name}`,
          message,
          url: "/ai",
        });

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
      } catch (err) {
        console.error(`[BonusPush] Error processing plan ${plan.id}:`, err);
        failed++;
      }
    }

    console.log(`[BonusPush] Processed ${plans.length} plans, sent=${sent}, failed=${failed}`);
    return NextResponse.json({ processed: plans.length, sent, failed });
  } catch (err) {
    console.error("[BonusPush] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
