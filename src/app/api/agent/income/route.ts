import { createClient } from "@/lib/supabase/server";
import { getIncomeMetrics } from "@/lib/metrics/income";
import { NextRequest } from "next/server";

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// GET /api/agent/income — income metrics for one business and month.
// Query params:
//   businessId (required)
//   month (1-12, optional — defaults to current month)
//   year  (optional — defaults to current year)
// Builds a full-calendar-month date range and returns getIncomeMetrics().
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

  try {
    const metrics = await getIncomeMetrics(supabase, businessId, { start, end });
    return jsonResponse({ businessId, month, year, metrics });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return jsonResponse({ error: message }, 500);
  }
}
