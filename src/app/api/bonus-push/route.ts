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

function formatValue(value: number, type: "percentage" | "currency" | "quantity"): string {
  if (type === "percentage") return `${value.toFixed(1)}%`;
  if (type === "quantity") return value.toLocaleString("he-IL");
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

function buildPushMessage(
  plan: Pick<BonusPlan, "area_name" | "measurement_type" | "data_source" | "tips">,
  status: BonusPlanStatus
): string {
  if (plan.data_source === "custom" || status.currentValue === null) {
    const tipSuffix = plan.tips ? `\n💡 טיפ: ${plan.tips.split("\n")[0]}` : "";
    return `תחום: ${plan.area_name} — בדוק את המצב שלך ופתח את דדי לעצות${tipSuffix}`;
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

  // Not qualified — include a tip if available
  const tipSuffix = plan.tips ? `\n💡 ${plan.tips.split("\n")[0]}` : " פתח את דדי לעצות";
  return `${plan.area_name}: ${current}${goalStr} — עוד מאמץ קטן!${tipSuffix}`;
}

function buildEmailHtml(
  plan: Pick<BonusPlan, "area_name" | "measurement_type" | "data_source" | "tips">,
  status: BonusPlanStatus,
  employeeName: string
): string {
  const message = buildPushMessage(plan, status);
  const isQualified = !!status.qualifiedTier;
  const accentColor = isQualified ? "#17DB4E" : "#FFA412";

  return `
    <div dir="rtl" style="font-family: Assistant, Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #0F1535; border-radius: 12px; padding: 24px; color: white;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="margin: 0; font-size: 20px; color: ${accentColor};">🎯 עדכון בונוס — ${plan.area_name}</h2>
      </div>
      <p style="font-size: 16px; line-height: 1.6; margin: 16px 0;">שלום ${employeeName},</p>
      <div style="background: #1A1F4E; border-radius: 8px; padding: 16px; margin: 16px 0; border-right: 4px solid ${accentColor};">
        <p style="font-size: 16px; margin: 0; line-height: 1.6;">${message}</p>
      </div>
      ${status.currentValue !== null && status.goalValue !== null ? `
      <div style="display: flex; justify-content: space-around; text-align: center; margin: 20px 0;">
        <div>
          <div style="font-size: 12px; color: rgba(255,255,255,0.6);">בפועל</div>
          <div style="font-size: 22px; font-weight: bold; color: ${accentColor};">${formatValue(status.currentValue, plan.measurement_type)}</div>
        </div>
        <div>
          <div style="font-size: 12px; color: rgba(255,255,255,0.6);">יעד</div>
          <div style="font-size: 22px; font-weight: bold;">${formatValue(status.goalValue, plan.measurement_type)}</div>
        </div>
      </div>` : ""}
      <div style="text-align: center; margin-top: 24px;">
        <a href="https://app.amazpenbiz.co.il/ai" style="display: inline-block; background: #2C3595; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 16px; font-weight: bold;">💬 פתח את דדי לעצות</a>
      </div>
      <p style="font-size: 11px; color: rgba(255,255,255,0.4); text-align: center; margin-top: 24px;">המצפן — מערכת ניהול עסקית</p>
    </div>
  `;
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

    // Get Israel day-of-week for push_days filter
    const israelDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
    const israelDay = israelDate.getDay(); // 0=Sunday..6=Saturday

    // Filter plans: only send on days included in push_days
    const filteredPlans = plans.filter((p: BonusPlan) => {
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

    for (const plan of filteredPlans as BonusPlan[]) {
      try {
        // Resolve KPI status
        const status = await resolveBonusPlanStatus(supabaseAdmin, plan, year, month);

        // Build message
        const message = buildPushMessage(plan, status);
        const title = `עדכון בונוס — ${plan.area_name}`;

        // Get employee info for email
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("email, full_name")
          .eq("id", plan.employee_user_id)
          .maybeSingle();

        // === 1. Send web push notification ===
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

        // === 2. Create in-app notification ===
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

        // === 3. Notify business managers/owners ===
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

        // === 4. Send email via n8n ===
        if (profile?.email) {
          try {
            const emailHtml = buildEmailHtml(plan, status, profile.full_name || "");
            const emailRes = await fetch("https://n8n-lv4j.onrender.com/webhook/daily-push-email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                to: profile.email,
                subject: title,
                html: emailHtml,
              }),
            });
            if (emailRes.ok) emailsSent++;
            else console.error(`[BonusPush] Email failed for ${profile.email}: ${emailRes.status}`);
          } catch (emailErr) {
            console.error(`[BonusPush] Email error for ${profile.email}:`, emailErr);
          }
        }
      } catch (err) {
        console.error(`[BonusPush] Error processing plan ${plan.id}:`, err);
        failed++;
      }
    }

    console.log(`[BonusPush] Processed ${plans.length} plans, push_sent=${sent}, emails=${emailsSent}, notifications=${notificationsCreated}, failed=${failed}`);
    return NextResponse.json({ processed: plans.length, sent, emailsSent, notificationsCreated, failed });
  } catch (err) {
    console.error("[BonusPush] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
