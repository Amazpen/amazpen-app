import type { SupabaseClient } from "@supabase/supabase-js";
import { formatLocalDate } from "./dates";
import type {
  MetricsDateRange,
  PaymentMethodMetric,
  PaymentsSummary,
  PaymentHistory,
  PaymentHistoryMonth,
  RecentPayment,
  UpcomingDate,
  UpcomingMonth,
  UpcomingPayments,
} from "./types";

// ---------------------------------------------------------------------------
// Payments metrics — faithful port of the ניהול תשלומים page
// (src/app/(dashboard)/payments/page.tsx). The numbers match the page to the
// cent because the queries and reductions mirror it exactly. Line references
// below point at payments/page.tsx.
//
// Differences from the page:
//   - Operates on a SINGLE businessId. Where the page uses
//     `.in("...business_id", selectedBusinesses)` over an array we pass a
//     single-element array `[businessId]` so the same query shape is preserved.
//   - Takes a supabase client as a parameter (server or browser) — does not
//     create one.
//   - The forecast (getUpcomingPayments) and history (getPaymentHistory) are
//     "as of today" exactly like the page — they do NOT take a dateRange.
// ---------------------------------------------------------------------------

// Hebrew display names for payment methods — page.tsx 196-207.
const paymentMethodNames: Record<string, string> = {
  bank_transfer: "העברה בנקאית",
  cash: "מזומן",
  check: "צ'ק",
  bit: "ביט",
  paybox: "פייבוקס",
  credit_card: "כרטיס אשראי",
  other: "אחר",
  credit_company: "אחר",
  credit_companies: "אחר",
  standing_order: "הוראת קבע",
};

// Hebrew month names (0-indexed) — page.tsx 1295-1298 / 211-214.
const hebrewMonthNames = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

// Today's local YYYY-MM-DD — page.tsx 1780 / 1874 / 1923.
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

// DD.MM.YY from a YYYY-MM-DD(THH...) string — matches the page's
// formatDateString used in the recent-payments list. (page.tsx uses a shared
// formatDateString helper; the list's "date" column is DD.MM.YY.)
function formatDateDDMMYY(dateStr: string): string {
  const datePart = dateStr.split("T")[0];
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return dateStr;
  return `${d}.${m}.${y.slice(2)}`;
}

// ===========================================================================
// getPaymentsSummary — "תשלומים שיצאו" (page.tsx 1453-1524)
//
// Sums payment_splits.amount (incl VAT) over the range, FILTERED BY due_date
// (the actual bank-debit date), per payment_method, plus % of revenue where
// revenue = sum of daily_entries.total_register (incl VAT) over the same range.
// ===========================================================================
export async function getPaymentsSummary(
  supabase: SupabaseClient,
  businessId: string,
  dateRange: MetricsDateRange
): Promise<PaymentsSummary> {
  const selectedBusinesses = [businessId];

  // page.tsx 1455-1456
  const startDate = formatLocalDate(dateRange.start);
  const endDate = formatLocalDate(dateRange.end);

  // page.tsx 1458-1479 — splits filtered by due_date, joined to non-deleted
  // payments of the selected business; plus daily_entries for the revenue base.
  const [splitsResult, dailyEntriesResult] = await Promise.all([
    supabase
      .from("payment_splits")
      .select(
        `
        id, due_date, amount, payment_method,
        payment:payments!inner(id, business_id, deleted_at, total_amount,
          supplier:suppliers(id, name))
      `
      )
      .gte("due_date", startDate)
      .lte("due_date", endDate)
      .is("payment.deleted_at", null)
      .in("payment.business_id", selectedBusinesses)
      .order("due_date", { ascending: false })
      .limit(500),
    supabase
      .from("daily_entries")
      .select("total_register")
      .in("business_id", selectedBusinesses)
      .gte("entry_date", startDate)
      .lte("entry_date", endDate)
      .is("deleted_at", null),
  ]);

  type SplitRow = { amount: number | null; payment_method: string | null };
  const splitsData = (splitsResult.data as SplitRow[] | null) || [];
  const dailyEntries =
    (dailyEntriesResult.data as Array<{ total_register: number | null }> | null) || [];

  // page.tsx 1482-1484 — revenue base (incl VAT).
  const totalRevenueWithVat = dailyEntries.reduce(
    (sum, e) => sum + (Number(e.total_register) || 0),
    0
  );

  // page.tsx 1488-1501 — sum per method.
  const methodTotals = new Map<string, number>();
  let totalPaid = 0;
  for (const split of splitsData) {
    const method = split.payment_method || "other";
    const amount = Number(split.amount) || 0;
    methodTotals.set(method, (methodTotals.get(method) || 0) + amount);
    totalPaid += amount;
  }

  // page.tsx 1504-1513 — transform + sort by amount desc.
  const byMethod: PaymentMethodMetric[] = Array.from(methodTotals.entries())
    .map(([method, amount]) => ({
      method,
      methodName: paymentMethodNames[method] || "אחר",
      amount,
      pctOfRevenue: totalRevenueWithVat > 0 ? (amount / totalRevenueWithVat) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return { totalPaid, totalRevenue: totalRevenueWithVat, byMethod };
}

// ===========================================================================
// getUpcomingPayments — "צפי תשלומים קדימה" (page.tsx 1769-1851)
//
// All payment_splits with due_date >= today (across all calendar months),
// grouped by month → by specific due date. totalOpen = "סה\"כ תשלומים פתוחים".
// ===========================================================================
export async function getUpcomingPayments(
  supabase: SupabaseClient,
  businessId: string
): Promise<UpcomingPayments> {
  const selectedBusinesses = [businessId];
  const today = localToday();

  // page.tsx 1783-1793
  const { data } = await supabase
    .from("payment_splits")
    .select(
      `
      id, due_date, amount, payment_method, installment_number, installments_count,
      payment:payments!inner(id, business_id, deleted_at, receipt_url, notes, supplier:suppliers(name))
    `
    )
    .gte("due_date", today)
    .is("payment.deleted_at", null)
    .in("payment.business_id", selectedBusinesses)
    .order("due_date", { ascending: true })
    .limit(500);

  type Row = { due_date: string | null; amount: number | null };
  const rows = (data as Row[] | null) || [];

  // page.tsx 1809-1848 — group by "YYYY-MM" then within month by due_date.
  type MonthAcc = { total: number; dates: Map<string, number> };
  const monthMap = new Map<string, MonthAcc>();
  let totalOpen = 0;

  for (const row of rows) {
    if (!row.due_date) continue;
    const amount = Number(row.amount) || 0;
    totalOpen += amount;

    // page.tsx 1832-1833 — local parse to avoid UTC shift.
    const [dY, dM] = row.due_date.split("T")[0].split("-");
    const monthKey = `${dY}-${dM}`;
    if (!monthMap.has(monthKey)) monthMap.set(monthKey, { total: 0, dates: new Map() });
    const acc = monthMap.get(monthKey)!;
    acc.total += amount;

    // page.tsx 4179-4185 — within-month grouping is by the raw due_date string.
    const dateKey = row.due_date;
    acc.dates.set(dateKey, (acc.dates.get(dateKey) || 0) + amount);
  }

  const byMonth: UpcomingMonth[] = Array.from(monthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([monthKey, acc]) => {
      const [year, month] = monthKey.split("-");
      const byDate: UpcomingDate[] = Array.from(acc.dates.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, amount]) => ({ date, amount }));
      return {
        month: monthKey,
        label: `${hebrewMonthNames[parseInt(month, 10) - 1]}, ${year}`,
        total: acc.total,
        byDate,
      };
    });

  return { totalOpen, byMonth };
}

// ===========================================================================
// getPaymentHistory — "תשלומי עבר" (page.tsx 1913-1993)
//
// All payment_splits with due_date <= today, grouped by month (desc).
// totalPaid = "סה\"כ תשלומים שבוצעו".
// ===========================================================================
export async function getPaymentHistory(
  supabase: SupabaseClient,
  businessId: string
): Promise<PaymentHistory> {
  const selectedBusinesses = [businessId];
  const today = localToday();

  // page.tsx 1926-1936
  const { data } = await supabase
    .from("payment_splits")
    .select(
      `
      id, due_date, amount, payment_method, installment_number, installments_count,
      payment:payments!inner(id, business_id, deleted_at, receipt_url, notes, supplier:suppliers(name))
    `
    )
    .lte("due_date", today)
    .is("payment.deleted_at", null)
    .in("payment.business_id", selectedBusinesses)
    .order("due_date", { ascending: false })
    .limit(500);

  type Row = { due_date: string | null; amount: number | null };
  const rows = (data as Row[] | null) || [];

  // page.tsx 1951-1977 — group by "YYYY-MM".
  const monthMap = new Map<string, number>();
  let totalPaid = 0;

  for (const row of rows) {
    if (!row.due_date) continue;
    const amount = Number(row.amount) || 0;
    totalPaid += amount;
    const [dY, dM] = row.due_date.split("T")[0].split("-");
    const key = `${dY}-${dM}`;
    monthMap.set(key, (monthMap.get(key) || 0) + amount);
  }

  // page.tsx 1980-1990 — sort descending (newest first).
  const byMonth: PaymentHistoryMonth[] = Array.from(monthMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, total]) => {
      const [year, month] = key.split("-");
      return {
        month: key,
        label: `${hebrewMonthNames[parseInt(month, 10) - 1]}, ${year}`,
        totalPaid: total,
      };
    });

  return { totalPaid, byMonth };
}

// ===========================================================================
// getRecentPayments — "תשלומים אחרונים ששולמו" (id onboarding-payments-list)
// (page.tsx 1527-1545 query; transformPaymentsData 1560-1723 for fields)
//
// First page of non-deleted payments for the business, newest payment_date
// first. Each row: date, supplier, ref, splits count, method, amount.
// ===========================================================================
export async function getRecentPayments(
  supabase: SupabaseClient,
  businessId: string,
  limit = 20 // page.tsx 1030: PAYMENTS_PAGE_SIZE = 20
): Promise<RecentPayment[]> {
  const selectedBusinesses = [businessId];

  // page.tsx 1527-1540 — first page, no date filter, newest first.
  const { data } = await supabase
    .from("payments")
    .select(
      `
      id, payment_date, total_amount, supplier_id,
      supplier:suppliers(id, name),
      payment_splits(id, payment_method, amount, check_number, reference_number)
    `
    )
    .in("business_id", selectedBusinesses)
    .is("deleted_at", null)
    .order("payment_date", { ascending: false })
    .range(0, limit - 1);

  type SplitRow = {
    payment_method: string | null;
    check_number: string | null;
    reference_number: string | null;
  };
  type PaymentRow = {
    id: string;
    payment_date: string | null;
    total_amount: number | null;
    supplier: { id: string; name: string } | null;
    payment_splits: SplitRow[] | null;
  };

  const rows = (data as PaymentRow[] | null) || [];

  return rows.map((p) => {
    const splits = p.payment_splits || [];
    const first = splits[0];
    const methodKey = first?.payment_method || "other";
    // page.tsx 1673-1675 — cheque uses check_number as reference, else reference_number.
    const ref =
      first?.payment_method === "check" && first?.check_number
        ? String(first.check_number)
        : first?.reference_number
          ? String(first.reference_number)
          : null;
    const rawDate = p.payment_date || "";
    return {
      id: p.id,
      date: rawDate ? formatDateDDMMYY(rawDate) : "",
      rawDate: rawDate ? rawDate.split("T")[0] : "",
      supplier: p.supplier?.name || "לא ידוע",
      ref,
      splits: splits.length,
      method: splits.length > 0 ? paymentMethodNames[methodKey] || "אחר" : "אחר",
      amount: Number(p.total_amount) || 0,
    };
  });
}
