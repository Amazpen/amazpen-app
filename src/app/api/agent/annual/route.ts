import { createClient } from "@/lib/supabase/server";
import { getAnnualMetric } from "@/lib/metrics/annual";
import { NextRequest } from "next/server";

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// GET /api/agent/annual — annual (year-at-a-glance) metric for one business.
// Powers the "נתוני עבר" historical-data modals (ACTUAL-based, month by month).
// Query params:
//   businessId (required)
//   metric (optional — defaults to "sales"; also "labor" | "cogs" |
//           "operating" | "source:<name>" | "product:<name>")
//   year   (optional — defaults to current year)
// Returns getAnnualMetric(): { year, metric, total, months[1..12] }.
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

  const metric = searchParams.get("metric") || "sales";

  const now = new Date();
  const yearParam = parseInt(searchParams.get("year") || "", 10);
  const year = Number.isFinite(yearParam) ? yearParam : now.getFullYear();

  try {
    const annual = await getAnnualMetric(supabase, businessId, year, metric);
    return jsonResponse({ businessId, metric, year, annual });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return jsonResponse({ error: message }, 500);
  }
}
