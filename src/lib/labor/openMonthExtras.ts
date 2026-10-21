import type { SupabaseClient } from "@supabase/supabase-js";

// While a labor month is open, labor cost is an estimate from daily entries.
// Some employee costs never appear in daily entries (e.g. an outside staffing
// company). Those are entered as invoices of an employee_costs supplier whose
// category is a subcategory of the labor parent, and they are added on top of
// the estimate. Employee-cost suppliers outside a labor subcategory (pension,
// national insurance) are not added: the estimate's markup already covers them.
// Once the month is closed, all employee_costs invoices are the labor cost.

export const LABOR_PARENT_NAMES = new Set(["עלות עובדים", "עלויות עובדים"]);

type CategoryRow = { id: string; name: string; parent_id: string | null };

type InvoiceRow = { subtotal: number | string | null; labor_close_id?: string | null; supplier?: unknown };
type SupplierJoin = { expense_type?: string | null; expense_category_id?: string | null } | null | undefined;

// Invoices created by a month close (labor_close_id set) are never extras: they
// are the actual labor cost of a closed month.

// Ids of the subcategories under any top-level labor parent.
export function laborSubcategoryIds(categories: CategoryRow[]): Set<string> {
  const parentIds = new Set(
    categories.filter((c) => !c.parent_id && LABOR_PARENT_NAMES.has(c.name)).map((c) => c.id)
  );
  return new Set(categories.filter((c) => c.parent_id && parentIds.has(c.parent_id)).map((c) => c.id));
}

export function sumOpenMonthLaborExtras(invoices: InvoiceRow[], subcategoryIds: Set<string>): number {
  return invoices.reduce((sum, inv) => {
    if (inv.labor_close_id) return sum;
    const supplier = inv.supplier as SupplierJoin;
    if (supplier?.expense_type !== "employee_costs") return sum;
    if (!supplier?.expense_category_id || !subcategoryIds.has(supplier.expense_category_id)) return sum;
    return sum + Number(inv.subtotal || 0);
  }, 0);
}

// Fetches and sums the open-month labor extras for the given businesses and
// date range (by reference_date, same as the P&L).
export async function fetchOpenMonthLaborExtras(
  supabase: SupabaseClient,
  businessIds: string[],
  startDate: string,
  endDate: string
): Promise<number> {
  if (businessIds.length === 0) return 0;
  const { data: categories, error: categoriesError } = await supabase
    .from("expense_categories")
    .select("id, name, parent_id")
    .in("business_id", businessIds)
    .is("deleted_at", null)
    .eq("is_active", true);
  if (categoriesError) console.error("[openMonthExtras] categories query failed", categoriesError);
  const subcategoryIds = laborSubcategoryIds((categories as CategoryRow[] | null) || []);
  if (subcategoryIds.size === 0) return 0;

  const { data: invoices, error: invoicesError } = await supabase
    .from("invoices")
    .select("subtotal, labor_close_id, supplier:suppliers!inner(expense_type, expense_category_id)")
    .in("business_id", businessIds)
    .is("deleted_at", null)
    .is("labor_close_id", null)
    .in("invoice_type", ["current", "goods", "employees"])
    .gte("reference_date", startDate)
    .lte("reference_date", endDate)
    .eq("supplier.expense_type", "employee_costs")
    .in("supplier.expense_category_id", Array.from(subcategoryIds));
  if (invoicesError) console.error("[openMonthExtras] invoices query failed", invoicesError);
  return sumOpenMonthLaborExtras((invoices as unknown as InvoiceRow[] | null) || [], subcategoryIds);
}
