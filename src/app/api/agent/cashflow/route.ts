import { createClient } from "@/lib/supabase/server";
import { getCashflowForecast } from "@/lib/metrics/cashflow";
import { NextRequest } from "next/server";

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// GET /api/agent/cashflow — cashflow forecast for one business.
// Query params:
//   businessId (required)
// Returns getCashflowForecast(): starting balance + date, forecast range,
// total income/expenses, net diff, first negative day, and the daily table.
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

  try {
    const metrics = await getCashflowForecast(supabase, businessId);
    return jsonResponse({ businessId, metrics });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return jsonResponse({ error: message }, 500);
  }
}
