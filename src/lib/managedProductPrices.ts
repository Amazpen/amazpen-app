import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Managed product monthly prices (מחיר מוצר מנוהל לפי חודש).
 *
 * Resolution rule for product P in month M:
 *   1. Explicit managed_product_monthly_prices row for (P, M).
 *   2. Else the most recent explicit row BEFORE M (walk back).
 *   3. Else the product's current managed_products.unit_cost.
 *
 * Price granularity is MONTHLY - a mid-month change applies to the whole month.
 * Every report/calc site must resolve through here; never multiply historical
 * quantities by the current unit_cost directly.
 */

export interface MonthlyPriceRow {
  product_id: string;
  year: number;
  month: number;
  unit_cost: number;
}

export type PriceResolver = (
  productId: string,
  year: number,
  month: number,
  /** Fallback when the product has no explicit rows at or before (year, month). */
  fallbackUnitCost: number
) => number;

/** Fetch all monthly price rows for the given businesses. */
export async function fetchMonthlyPrices(
  supabase: SupabaseClient,
  businessIds: string[]
): Promise<MonthlyPriceRow[]> {
  if (businessIds.length === 0) return [];
  const { data, error } = await supabase
    .from("managed_product_monthly_prices")
    .select("product_id, year, month, unit_cost")
    .in("business_id", businessIds);
  if (error) {
    console.error("fetchMonthlyPrices failed:", error.message);
    return [];
  }
  return (data || []).map((r) => ({
    product_id: r.product_id as string,
    year: Number(r.year),
    month: Number(r.month),
    unit_cost: Number(r.unit_cost) || 0,
  }));
}

/**
 * Build a resolver from pre-fetched rows. Pure - safe on server and client.
 * Rows are indexed per product and sorted once; each resolve is a binary walk.
 */
export function buildPriceResolver(rows: MonthlyPriceRow[]): PriceResolver {
  const byProduct = new Map<string, MonthlyPriceRow[]>();
  for (const row of rows) {
    const list = byProduct.get(row.product_id);
    if (list) list.push(row);
    else byProduct.set(row.product_id, [row]);
  }
  for (const list of byProduct.values()) {
    list.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  }

  return (productId, year, month, fallbackUnitCost) => {
    const list = byProduct.get(productId);
    if (!list || list.length === 0) return fallbackUnitCost;
    const target = year * 12 + month;
    if (!Number.isFinite(target)) return fallbackUnitCost;
    // Latest row at or before the target month.
    let resolved: number | null = null;
    for (const row of list) {
      const key = row.year * 12 + row.month;
      if (key > target) break;
      resolved = row.unit_cost;
    }
    return resolved !== null ? resolved : fallbackUnitCost;
  };
}

/** Convenience: fetch + build in one call. */
export async function getPriceResolver(
  supabase: SupabaseClient,
  businessIds: string[]
): Promise<PriceResolver> {
  return buildPriceResolver(await fetchMonthlyPrices(supabase, businessIds));
}

/** Extract (year, month) from a YYYY-MM-DD entry_date string without timezone drift. */
export function entryDateToYearMonth(entryDate: string): { year: number; month: number } {
  const [y, m] = entryDate.split("-");
  return { year: Number(y), month: Number(m) };
}
