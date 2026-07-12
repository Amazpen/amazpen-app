import type { SupabaseClient } from "@supabase/supabase-js";
import { formatLocalDate } from "./dates";
import type {
  MetricsDateRange,
  SupplierDetail,
  SupplierExpenseType,
  SupplierInvoiceRow,
  SupplierMonthlyRow,
  SupplierPayableRow,
  SuppliersPayable,
} from "./types";

// ---------------------------------------------------------------------------
// getSuppliersPayable / getSupplierDetail
//
// Faithful port of the ניהול ספקים page
// (src/app/(dashboard)/suppliers/page.tsx). Numbers match the page to the
// cent. Line references below point at suppliers/page.tsx.
//
// Differences from the page:
//   - Operates on a SINGLE businessId (the page sums an array of
//     selectedBusinesses). We pass a single-element array so the per-supplier
//     and per-business aggregation logic (revenue-target map keyed by
//     business_id) is preserved unchanged.
//   - Takes a supabase client as a parameter (server or browser).
// ---------------------------------------------------------------------------

type SupplierRow = {
  id: string;
  business_id: string;
  name: string;
  expense_type: string | null;
  expense_category_id: string | null;
  requires_vat: boolean | null;
  is_fixed_expense: boolean | null;
  monthly_expense_amount: number | null;
  charge_day: number | null;
  has_previous_obligations: boolean | null;
  obligation_total_amount: number | null;
};

type BalanceRow = {
  supplier_id: string;
  total_paid: number | null;
  pending_balance: number | null;
};

const SUPPLIER_SELECT =
  "id, business_id, name, expense_type, expense_category_id, requires_vat, is_fixed_expense, monthly_expense_amount, charge_day, has_previous_obligations, obligation_total_amount";

// ---------------------------------------------------------------------------
// getSuppliersPayable — header pill (`onboarding-suppliers-total`) + cards.
// suppliers/page.tsx fetchSuppliers (lines 472-623), tab filtering (2250-2261)
// and totals (2280-2283).
// ---------------------------------------------------------------------------
export async function getSuppliersPayable(
  supabase: SupabaseClient,
  businessId: string,
  opts?: { year?: number }
): Promise<SuppliersPayable> {
  const selectedBusinesses = [businessId];
  const now = new Date();
  const currentYear = opts?.year ?? now.getFullYear();

  // page.tsx 483-489
  const { data: suppliersData } = await supabase
    .from("suppliers")
    .select(SUPPLIER_SELECT)
    .in("business_id", selectedBusinesses)
    .is("deleted_at", null)
    .order("is_active", { ascending: false, nullsFirst: false })
    .order("name");

  const suppliers = (suppliersData as SupplierRow[] | null) || [];

  // page.tsx 498-501 — supplier_balance view
  const { data: balanceData } = await supabase
    .from("supplier_balance")
    .select("supplier_id, total_paid, pending_balance")
    .in("business_id", selectedBusinesses);
  const balances = (balanceData as BalanceRow[] | null) || [];

  // page.tsx 504-509 — current-month + current-year date windows
  const monthStart = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthEnd = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}-${new Date(
    currentYear,
    now.getMonth() + 1,
    0
  ).getDate()}`;
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;
  const supplierIds = suppliers.map((s) => s.id);

  // page.tsx 513-521 — current-month invoices (for fixed-expense top-up check)
  const monthlyInvoicesResult =
    supplierIds.length > 0
      ? await supabase
          .from("invoices")
          .select("supplier_id, subtotal")
          .in("supplier_id", supplierIds)
          .is("deleted_at", null)
          .gte("reference_date", monthStart)
          .lte("reference_date", monthEnd)
      : { data: [] as Array<{ supplier_id: string; subtotal: number | null }> };

  // page.tsx 524-528
  const supplierMonthlyPurchases = new Map<string, number>();
  for (const inv of (monthlyInvoicesResult.data as Array<{ supplier_id: string; subtotal: number | null }>) || []) {
    const prev = supplierMonthlyPurchases.get(inv.supplier_id) || 0;
    supplierMonthlyPurchases.set(inv.supplier_id, prev + Number(inv.subtotal));
  }

  // page.tsx 531-539 — yearly invoices (subtotal before VAT) for % of revenue
  const yearlyInvoicesResult =
    supplierIds.length > 0
      ? await supabase
          .from("invoices")
          .select("supplier_id, subtotal")
          .in("supplier_id", supplierIds)
          .is("deleted_at", null)
          .gte("reference_date", yearStart)
          .lte("reference_date", yearEnd)
      : { data: [] as Array<{ supplier_id: string; subtotal: number | null }> };

  // page.tsx 542-546
  const supplierYearlyPurchases = new Map<string, number>();
  for (const inv of (yearlyInvoicesResult.data as Array<{ supplier_id: string; subtotal: number | null }>) || []) {
    const prev = supplierYearlyPurchases.get(inv.supplier_id) || 0;
    supplierYearlyPurchases.set(inv.supplier_id, prev + Number(inv.subtotal));
  }

  // page.tsx 549-561 — yearly revenue targets per business
  const { data: goalsData } = await supabase
    .from("goals")
    .select("business_id, revenue_target")
    .in("business_id", selectedBusinesses)
    .eq("year", currentYear)
    .is("deleted_at", null);

  const revenueTargetMap = new Map<string, number>();
  for (const g of (goalsData as Array<{ business_id: string; revenue_target: number | null }> | null) || []) {
    const prev = revenueTargetMap.get(g.business_id) || 0;
    revenueTargetMap.set(g.business_id, prev + (Number(g.revenue_target) || 0));
  }

  // page.tsx 563-616 — merge balance + compute remaining + % of revenue
  const rows: SupplierPayableRow[] = suppliers.map((supplier) => {
    const balance = balances.find((b) => b.supplier_id === supplier.id);

    // page.tsx 567-584
    let remainingPayment = 0;
    if (supplier.has_previous_obligations && supplier.obligation_total_amount) {
      const totalPaid = balance?.total_paid || 0;
      remainingPayment = Number(supplier.obligation_total_amount) - Number(totalPaid);
    } else {
      remainingPayment = Math.max(Number(balance?.pending_balance || 0), 0);
    }

    // page.tsx 595-604 — fixed-expense monthly top-up if no invoice yet this month
    if (
      supplier.is_fixed_expense &&
      supplier.monthly_expense_amount &&
      Number(supplier.monthly_expense_amount) > 0
    ) {
      const hasCurrentMonthInvoice = supplierMonthlyPurchases.has(supplier.id);
      if (!hasCurrentMonthInvoice) {
        remainingPayment += Number(supplier.monthly_expense_amount);
      }
    }

    // page.tsx 606-609 — % of revenue (yearly purchases incl... actually subtotal / yearly revenue target)
    const yearlyPurchases = supplierYearlyPurchases.get(supplier.id) || 0;
    const yearlyRevenueTarget = revenueTargetMap.get(supplier.business_id) || 0;
    const revenuePercentage = yearlyRevenueTarget > 0 ? (yearlyPurchases / yearlyRevenueTarget) * 100 : 0;

    return {
      id: supplier.id,
      name: supplier.name,
      expenseType: supplier.expense_type || "",
      remaining: remainingPayment,
      pctOfRevenue: revenuePercentage,
    };
  });

  // page.tsx 2261 — sort by remaining descending
  rows.sort((a, b) => b.remaining - a.remaining);

  // page.tsx 2280-2282 — total open across suppliers (all expense types).
  // The page's pill sums only the active tab; here we expose both the grand
  // total and the per-tab split so callers can mirror either.
  const byExpenseType: Record<SupplierExpenseType, number> = {
    goods_purchases: 0,
    current_expenses: 0,
    employee_costs: 0,
  };
  let totalOpen = 0;
  for (const r of rows) {
    totalOpen += r.remaining;
    if (
      r.expenseType === "goods_purchases" ||
      r.expenseType === "current_expenses" ||
      r.expenseType === "employee_costs"
    ) {
      byExpenseType[r.expenseType as SupplierExpenseType] += r.remaining;
    }
  }

  return { totalOpen, byExpenseType, suppliers: rows };
}

// ---------------------------------------------------------------------------
// fetchMonthlyData — per-month purchases / paid for a supplier.
// suppliers/page.tsx fetchMonthlyData (lines ~1428-1598).
// ---------------------------------------------------------------------------
async function fetchMonthlyData(
  supabase: SupabaseClient,
  supplier: { id: string; business_id: string },
  monthDate: Date
): Promise<{ monthlyPurchases: number; monthlyPaid: number; paymentsInMonthTotal: number }> {
  // page.tsx 1428-1452 — IL-anchored timestamp bounds
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const startStr = formatLocalDate(monthStart);
  const endStr = formatLocalDate(monthEnd);
  const startIsoIL = `${startStr}T00:00:00+02:00`;
  const endIsoIL = `${endStr}T23:59:59.999+02:00`;

  // page.tsx 1455-1462 — invoices in month by invoice_date
  const { data: monthlyInvoices } = await supabase
    .from("invoices")
    .select("id, total_amount, status")
    .eq("supplier_id", supplier.id)
    .eq("business_id", supplier.business_id)
    .is("deleted_at", null)
    .gte("invoice_date", startIsoIL)
    .lte("invoice_date", endIsoIL);

  // page.tsx 1468-1475 — unlinked delivery notes in month
  const { data: monthlyDNs } = await supabase
    .from("delivery_notes")
    .select("id, total_amount")
    .eq("supplier_id", supplier.id)
    .eq("business_id", supplier.business_id)
    .is("invoice_id", null)
    .gte("delivery_date", startIsoIL)
    .lte("delivery_date", endIsoIL);

  const invoices = (monthlyInvoices as Array<{ id: string; total_amount: number | null; status: string }> | null) || [];
  const dns = (monthlyDNs as Array<{ id: string; total_amount: number | null }> | null) || [];

  // page.tsx 1477-1479
  const invoicesSum = invoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
  const dnsSum = dns.reduce((sum, dn) => sum + Number(dn.total_amount), 0);
  const monthlyPurchases = invoicesSum + dnsSum;

  // page.tsx 1533-1542 — payments whose payment_date is in this month
  const { data: paymentsInMonth } = await supabase
    .from("payments")
    .select("total_amount")
    .eq("supplier_id", supplier.id)
    .eq("business_id", supplier.business_id)
    .is("deleted_at", null)
    .gte("payment_date", startIsoIL)
    .lte("payment_date", endIsoIL);
  const paymentsInMonthTotal = ((paymentsInMonth as Array<{ total_amount: number | null }> | null) || []).reduce(
    (sum, p) => sum + (Number(p.total_amount) || 0),
    0
  );

  // page.tsx 1571-1573 — monthlyPaid = sum of this month's paid-status invoices
  const monthlyPaid = invoices
    .filter((inv) => inv.status === "paid")
    .reduce((sum, inv) => sum + (Number(inv.total_amount) || 0), 0);

  return { monthlyPurchases, monthlyPaid, paymentsInMonthTotal };
}

// ---------------------------------------------------------------------------
// getSupplierDetail — account status + monthly breakdown + invoice list.
// suppliers/page.tsx handleOpenSupplierDetail (lines ~1601-1825).
// `supplierNameOrId` matches by UUID first, else case-insensitive exact name.
// `dateRange` is optional and currently used only to scope nothing extra (the
// page detail always reflects FULL history for the account pills + monthly
// breakdown); it is accepted for signature parity with the income module.
// ---------------------------------------------------------------------------
export async function getSupplierDetail(
  supabase: SupabaseClient,
  businessId: string,
  supplierNameOrId: string,
  _dateRange?: MetricsDateRange
): Promise<SupplierDetail | null> {
  void _dateRange;

  // Resolve the supplier by id or name within the business.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    supplierNameOrId
  );
  let query = supabase
    .from("suppliers")
    .select(SUPPLIER_SELECT)
    .eq("business_id", businessId)
    .is("deleted_at", null);
  query = isUuid ? query.eq("id", supplierNameOrId) : query.ilike("name", supplierNameOrId);

  const { data: supplierRows } = await query.limit(1);
  const supplier = ((supplierRows as SupplierRow[] | null) || [])[0];
  if (!supplier) return null;

  const now = new Date();

  // page.tsx 1656-1671 — total purchases (invoices + unlinked DNs, incl VAT)
  const [{ data: invoicesData }, { data: unlinkedDnData }] = await Promise.all([
    supabase
      .from("invoices")
      .select("subtotal, total_amount, status, amount_paid, invoice_date")
      .eq("supplier_id", supplier.id)
      .is("deleted_at", null),
    supabase
      .from("delivery_notes")
      .select("total_amount, delivery_date")
      .eq("supplier_id", supplier.id)
      .is("invoice_id", null),
  ]);

  const allInvoices =
    (invoicesData as Array<{
      subtotal: number | null;
      total_amount: number | null;
      status: string;
      amount_paid: number | null;
      invoice_date: string | null;
    }> | null) || [];
  const allDns =
    (unlinkedDnData as Array<{ total_amount: number | null; delivery_date: string | null }> | null) || [];

  const invoicesPurchasesSum = allInvoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
  const dnsPurchasesSum = allDns.reduce((sum, dn) => sum + Number(dn.total_amount), 0);
  const totalPurchases = invoicesPurchasesSum + dnsPurchasesSum;

  // page.tsx 1678-1682 — open balance = open invoices (pending/clarification) + unlinked DNs
  const openInvoicesTotal =
    allInvoices
      .filter((inv) => inv.status === "pending" || inv.status === "clarification" || inv.status === "partial")
      .reduce((sum, inv) => {
        const total = Number(inv.total_amount) || 0;
        const remaining = inv.status === "partial" ? total - (Number(inv.amount_paid) || 0) : total;
        return sum + remaining;
      }, 0) + dnsPurchasesSum;

  // page.tsx 1685-1691 — total paid
  const { data: paymentsData } = await supabase
    .from("payments")
    .select("total_amount, payment_date")
    .eq("supplier_id", supplier.id)
    .is("deleted_at", null);
  const allPayments =
    (paymentsData as Array<{ total_amount: number | null; payment_date: string | null }> | null) || [];
  const totalPaid = allPayments.reduce((sum, pay) => sum + Number(pay.total_amount), 0);

  // page.tsx 1710-1759 — monthly breakdown over every month with activity
  const monthKeyOf = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  const monthKeySet = new Set<string>();
  for (const inv of allInvoices) {
    const k = monthKeyOf(inv.invoice_date);
    if (k) monthKeySet.add(k);
  }
  for (const dn of allDns) {
    const k = monthKeyOf(dn.delivery_date);
    if (k) monthKeySet.add(k);
  }
  for (const pay of allPayments) {
    const k = monthKeyOf(pay.payment_date);
    if (k) monthKeySet.add(k);
  }
  monthKeySet.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);

  // newest → oldest (page.tsx 1733)
  const monthKeys = Array.from(monthKeySet).sort((a, b) => b.localeCompare(a));
  const monthDates = monthKeys.map((k) => {
    const [y, m] = k.split("-").map(Number);
    return { key: k, date: new Date(y, m - 1, 1) };
  });

  const monthResults = await Promise.all(
    monthDates.map(async ({ key, date }) => {
      const mData = await fetchMonthlyData(supabase, supplier, date);
      // page.tsx 1746-1755 — keep rows with any activity
      const hasActivity =
        mData.monthlyPurchases !== 0 || mData.monthlyPaid !== 0 || mData.paymentsInMonthTotal !== 0;
      if (!hasActivity) return null;
      return {
        month: key,
        purchases: mData.monthlyPurchases,
        paid: mData.monthlyPaid,
        balance: mData.monthlyPurchases - mData.monthlyPaid,
      } as SupplierMonthlyRow;
    })
  );
  const monthly = monthResults.filter((m): m is SupplierMonthlyRow => m !== null);

  // page.tsx 1761-1771 — account balance (advance-aware, obligation-aware)
  let displayTotalPurchases = totalPurchases;
  const advance = Math.max(0, totalPaid - totalPurchases);
  let displayRemainingBalance = openInvoicesTotal - advance;
  if (supplier.has_previous_obligations && supplier.obligation_total_amount) {
    displayTotalPurchases = Number(supplier.obligation_total_amount);
    displayRemainingBalance = Number(supplier.obligation_total_amount) - totalPaid;
  }

  // Invoice + unlinked-DN line items (page.tsx 1783-1825) — mapped to the
  // SupplierInvoiceRow shape (date/ref/subtotal/total/status).
  const [{ data: invoicesRaw }, { data: deliveryNotesRaw }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, invoice_date, invoice_number, subtotal, total_amount, status")
      .eq("supplier_id", supplier.id)
      .is("deleted_at", null)
      .order("invoice_date", { ascending: false }),
    supabase
      .from("delivery_notes")
      .select("id, delivery_date, delivery_note_number, subtotal, total_amount")
      .eq("supplier_id", supplier.id)
      .is("invoice_id", null)
      .order("delivery_date", { ascending: false }),
  ]);

  const invoiceItems: SupplierInvoiceRow[] = (
    (invoicesRaw as Array<{
      invoice_date: string | null;
      invoice_number: string | null;
      subtotal: number | null;
      total_amount: number | null;
      status: string;
    }> | null) || []
  ).map((inv) => ({
    date: inv.invoice_date,
    ref: inv.invoice_number,
    subtotal: Number(inv.subtotal) || 0,
    total: Number(inv.total_amount) || 0,
    status: inv.status,
  }));

  const dnItems: SupplierInvoiceRow[] = (
    (deliveryNotesRaw as Array<{
      delivery_date: string | null;
      delivery_note_number: string | null;
      subtotal: number | null;
      total_amount: number | null;
    }> | null) || []
  ).map((dn) => ({
    date: dn.delivery_date,
    ref: dn.delivery_note_number,
    subtotal: Number(dn.subtotal) || 0,
    total: Number(dn.total_amount) || 0,
    status: "delivery_note",
  }));

  // page.tsx 1822-1825 — merge and sort by date descending
  const invoices = [...invoiceItems, ...dnItems].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || ""))
  );

  // Resolve category / parent-category names (page.tsx 2240-2246 pattern).
  let category: string | null = null;
  let parentCategory: string | null = null;
  if (supplier.expense_category_id) {
    const { data: catRow } = await supabase
      .from("expense_categories")
      .select("id, name, parent_id")
      .eq("id", supplier.expense_category_id)
      .maybeSingle();
    const cat = catRow as { name: string | null; parent_id: string | null } | null;
    if (cat) {
      category = cat.name ?? null;
      if (cat.parent_id) {
        const { data: parentRow } = await supabase
          .from("expense_categories")
          .select("name")
          .eq("id", cat.parent_id)
          .maybeSingle();
        parentCategory = (parentRow as { name: string | null } | null)?.name ?? null;
      }
    }
  }

  return {
    meta: {
      id: supplier.id,
      name: supplier.name,
      expenseType: supplier.expense_type || "",
      category,
      parentCategory,
      requiresVat: supplier.requires_vat,
      fixedMonthly: supplier.is_fixed_expense ? Number(supplier.monthly_expense_amount) || 0 : null,
      billingDay: supplier.charge_day != null ? Number(supplier.charge_day) : null,
    },
    account: {
      purchases: displayTotalPurchases,
      paid: totalPaid,
      balance: displayRemainingBalance,
    },
    monthly,
    invoices,
  };
}
