import { createClient } from "@/lib/supabase/server";
import { getProfitLossReport } from "@/lib/metrics/pnl";
import { NextRequest } from "next/server";

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// GET /api/agent/pnl — profit & loss (רווח והפסד) report for one business.
// Query params:
//   businessId (required)
//   view  (monthly | annual, optional — defaults to monthly)
//   month (1-12, optional — defaults to current month; ignored for annual)
//   year  (optional — defaults to current year)
//
// For view=monthly: a full-calendar-month date range.
// For view=annual:  a full-calendar-year date range (Jan 1 .. Dec 31). The
//   per-month targets (goals / supplier_budgets) are still keyed to the start
//   of the range (January) inside getProfitLossReport.
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

  const view = searchParams.get("view") === "annual" ? "annual" : "monthly";

  const now = new Date();
  const monthParam = parseInt(searchParams.get("month") || "", 10);
  const yearParam = parseInt(searchParams.get("year") || "", 10);
  const month =
    Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12
      ? monthParam
      : now.getMonth() + 1; // 1-12
  const year = Number.isFinite(yearParam) ? yearParam : now.getFullYear();

  // Build the date range. Annual = full year; monthly = full calendar month.
  const start = view === "annual" ? new Date(year, 0, 1) : new Date(year, month - 1, 1);
  const end = view === "annual" ? new Date(year, 11, 31) : new Date(year, month, 0);

  try {
    const report = await getProfitLossReport(supabase, businessId, { start, end }, view);
    return jsonResponse({ businessId, view, month, year, report });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return jsonResponse({ error: message }, 500);
  }
}
