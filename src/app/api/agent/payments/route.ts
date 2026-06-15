import { createClient } from "@/lib/supabase/server";
import {
  getPaymentsSummary,
  getUpcomingPayments,
  getPaymentHistory,
  getRecentPayments,
} from "@/lib/metrics/payments";
import { NextRequest } from "next/server";

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// GET /api/agent/payments — payments metrics for one business.
// Query params:
//   businessId (required)
//   view  (summary | upcoming | history | recent — optional, default summary)
//   month (1-12, optional — defaults to current month; used by summary only)
//   year  (optional — defaults to current year; used by summary only)
//
// - summary  -> getPaymentsSummary over the full calendar month (filtered by
//               split due_date). "תשלומים שיצאו" + breakdown by method.
// - upcoming -> getUpcomingPayments (as of today). "צפי תשלומים קדימה".
// - history  -> getPaymentHistory (as of today). "תשלומי עבר".
// - recent   -> getRecentPayments (first page). "תשלומים אחרונים ששולמו".
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonResponse({ error: "לא מחובר" }, 401);
  }

  const { searchParams } = request.nextUrl;
  const businessId = searchParams.get("businessId");
  if (!businessId) {
    return jsonResponse({ error: "businessId is required" }, 400);
  }

  const view = (searchParams.get("view") || "summary").toLowerCase();

  try {
    switch (view) {
      case "upcoming": {
        const metrics = await getUpcomingPayments(supabase, businessId);
        return jsonResponse({ businessId, view, metrics });
      }
      case "history": {
        const metrics = await getPaymentHistory(supabase, businessId);
        return jsonResponse({ businessId, view, metrics });
      }
      case "recent": {
        const limitParam = parseInt(searchParams.get("limit") || "", 10);
        const limit =
          Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;
        const metrics = await getRecentPayments(supabase, businessId, limit);
        return jsonResponse({ businessId, view, metrics });
      }
      case "summary":
      default: {
        const now = new Date();
        const monthParam = parseInt(searchParams.get("month") || "", 10);
        const yearParam = parseInt(searchParams.get("year") || "", 10);
        const month =
          Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12
            ? monthParam
            : now.getMonth() + 1; // 1-12
        const year = Number.isFinite(yearParam) ? yearParam : now.getFullYear();

        // Full calendar month range (month is 1-12; JS Date month is 0-11).
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0); // last day of the month

        const metrics = await getPaymentsSummary(supabase, businessId, { start, end });
        return jsonResponse({ businessId, view: "summary", month, year, metrics });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return jsonResponse({ error: message }, 500);
  }
}
