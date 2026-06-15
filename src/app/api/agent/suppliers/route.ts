import { createClient } from "@/lib/supabase/server";
import { getSuppliersPayable, getSupplierDetail } from "@/lib/metrics/suppliers";
import { NextRequest } from "next/server";

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// GET /api/agent/suppliers — suppliers payable for one business.
// Query params:
//   businessId   (required)
//   supplierName | supplierId (optional — also returns getSupplierDetail)
//   month (1-12, optional) / year (optional) — month/year scope the detail
//     date range (defaults to current month) and the year scopes the payable
//     % of revenue computation.
// Returns getSuppliersPayable by default; when a supplier name/id is passed it
// additionally returns getSupplierDetail (null if not found).
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

  const supplierName = searchParams.get("supplierName");
  const supplierId = searchParams.get("supplierId");
  const supplierKey = supplierId || supplierName;

  try {
    const payable = await getSuppliersPayable(supabase, businessId, { year });

    if (supplierKey) {
      // Full calendar month range (month is 1-12; JS Date month is 0-11).
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0); // last day of the month
      const detail = await getSupplierDetail(supabase, businessId, supplierKey, { start, end });
      return jsonResponse({ businessId, month, year, payable, detail });
    }

    return jsonResponse({ businessId, year, payable });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return jsonResponse({ error: message }, 500);
  }
}
