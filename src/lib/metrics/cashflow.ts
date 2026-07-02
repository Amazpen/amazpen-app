import type { SupabaseClient } from "@supabase/supabase-js";
import { formatLocalDate } from "./dates";
import { calculateSettledIncome, type SettledIncome } from "@/lib/cashflow/settlement";
import type { PaymentMethodType } from "@/types";
import type { CashflowDay, CashflowForecast } from "./types";

// ---------------------------------------------------------------------------
// getCashflowForecast
//
// Pure async function that replicates the CASHFLOW FORECAST from the dashboard
// (`fetchData` in src/app/(dashboard)/cashflow/page.tsx). It is a faithful port
// so the header summary + daily table numbers match. Line references below point
// at cashflow/page.tsx.
//
// Differences from the page:
//   - Operates on a SINGLE businessId (the page reads selectedBusinesses[0]).
//   - Takes a supabase client as a parameter (server or browser).
//   - Range = opening_date (or 1st of current month) → today + 3 months, which
//     mirrors the page's default view (endDate default = now + 3 months,
//     page.tsx 141-146; displayStart default = opening date / 1st of current
//     month, page.tsx 218-232). It does NOT replicate the user-driven
//     date-range picker (viewStart/savedEndDate) — those are UI state.
//   - Income overrides (cashflow_income_overrides) ARE applied, same as the page.
//   - Per-payment-method grouping / drill-down is a UI concern and is omitted;
//     only the per-day totals (which the grouping sums to) are returned.
// ---------------------------------------------------------------------------
export async function getCashflowForecast(
  supabase: SupabaseClient,
  businessId: string
): Promise<CashflowForecast> {
  // 1. Settings (opening balance + date) — page.tsx 204-223
  const { data: settingsData } = await supabase
    .from("cashflow_settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  const openingBalance = settingsData?.opening_balance ? Number(settingsData.opening_balance) : 0;

  // Default opening date = first of the CURRENT month (page.tsx 218-222).
  const defaultOpeningDate = (() => {
    const d = new Date();
    d.setDate(1);
    return formatLocalDate(d);
  })();
  const openingDate = settingsData?.opening_date
    ? String(settingsData.opening_date).substring(0, 10)
    : defaultOpeningDate;

  // End of forecast = today + 3 months (page.tsx default endDate, 141-146).
  const endDateObj = new Date();
  endDateObj.setMonth(endDateObj.getMonth() + 3);
  const endDateStr = formatLocalDate(endDateObj);

  // Display start = opening date, clamped so it never falls after the end
  // (page.tsx 232-233).
  let displayStartStr = openingDate;
  if (displayStartStr > endDateStr) displayStartStr = endDateStr;

  // Lookback for settlement that pushes prior-month income into our range
  // (page.tsx 238-240): 2 months before display start.
  const lookbackDate = new Date(displayStartStr + "T00:00:00");
  lookbackDate.setMonth(lookbackDate.getMonth() - 2);
  const lookbackStr = formatLocalDate(lookbackDate);

  // 2. Parallel queries — page.tsx 243-284
  const [
    pmResult,
    paymentBreakdownResult,
    splitsResult,
    overridesResult,
    retainersResult,
    dailyEntriesResult,
  ] = await Promise.all([
    supabase
      .from("payment_method_types")
      .select("*")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("display_order"),
    supabase
      .from("daily_payment_breakdown")
      .select("amount, payment_method_id, daily_entries!inner(entry_date, business_id)")
      .eq("daily_entries.business_id", businessId)
      .gte("daily_entries.entry_date", lookbackStr)
      .lte("daily_entries.entry_date", endDateStr),
    supabase
      .from("payment_splits")
      .select(
        "id, amount, payment_method, due_date, payments!inner(business_id, supplier_id, deleted_at, suppliers(name))"
      )
      .eq("payments.business_id", businessId)
      .is("payments.deleted_at", null)
      .gte("due_date", displayStartStr)
      .lte("due_date", endDateStr),
    supabase
      .from("cashflow_income_overrides")
      .select("*")
      .eq("business_id", businessId)
      .gte("settlement_date", displayStartStr)
      .lte("settlement_date", endDateStr),
    supabase
      .from("customers")
      .select(
        "id, contact_name, business_name, retainer_amount, retainer_day_of_month, retainer_type, retainer_start_date, retainer_end_date, retainer_status, is_foreign"
      )
      .eq("business_id", businessId)
      .eq("retainer_status", "active")
      .is("deleted_at", null),
    supabase
      .from("daily_entries")
      .select("entry_date, total_register")
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .gte("entry_date", lookbackStr)
      .lte("entry_date", endDateStr),
  ]);

  const paymentMethods = (pmResult.data || []) as PaymentMethodType[];
  const pmNameMap: Record<string, string> = {};
  paymentMethods.forEach((t) => {
    pmNameMap[t.id] = t.name;
  });

  // Business VAT + type for retainer/customer-payment gross-up (page.tsx 292-296)
  const { data: bizData } = await supabase
    .from("businesses")
    .select("vat_percentage, business_type")
    .eq("id", businessId)
    .maybeSingle();
  const bizVatRate = Number(bizData?.vat_percentage) || 0.18;
  const isServicesBiz = bizData?.business_type === "services";

  // Customer-payment dedup + per-customer display (page.tsx 306-343)
  const retainers = retainersResult.data || [];
  const paidRetainerMonths = new Set<string>(); // `${customer_id}|YYYY-MM`
  const customerPaymentsByDate = new Map<string, Array<{ name: string; amount: number }>>();
  const paidGrossByDate = new Map<string, number>();
  {
    const { data: paidData } = await supabase
      .from("customer_payments")
      .select(
        "customer_id, payment_date, amount, customers!inner(business_id, contact_name, business_name, is_foreign)"
      )
      .eq("customers.business_id", businessId)
      .is("deleted_at", null);
    for (const p of (paidData || []) as Array<Record<string, unknown>>) {
      const localDate = formatLocalDate(new Date(String(p.payment_date)));
      const ym = localDate.substring(0, 7);
      paidRetainerMonths.add(`${p.customer_id as string}|${ym}`);
      if (!isServicesBiz) continue;
      const cust = p.customers as Record<string, unknown>;
      const isForeign = cust?.is_foreign as boolean;
      const gross = (Number(p.amount) || 0) * (isForeign ? 1 : 1 + bizVatRate);
      if (gross <= 0) continue;
      const dateStr = localDate;
      const contactName = (cust?.contact_name as string) || "";
      const businessName = (cust?.business_name as string) || "";
      const customerLabel = contactName
        ? businessName && businessName !== contactName
          ? `${contactName} / ${businessName}`
          : contactName
        : businessName || "לקוח";
      const vatNote = isForeign ? "" : ' (כולל מע"מ)';
      const existing = customerPaymentsByDate.get(dateStr) || [];
      existing.push({ name: `תקבול - ${customerLabel}${vatNote}`, amount: gross });
      customerPaymentsByDate.set(dateStr, existing);
      paidGrossByDate.set(dateStr, (paidGrossByDate.get(dateStr) || 0) + gross);
    }
  }

  // Retainer forecast map (page.tsx 345-396)
  const retainerByDate = new Map<string, Array<{ name: string; amount: number }>>();
  for (const ret of retainers as Array<Record<string, unknown>>) {
    const dayOfMonth = Number(ret.retainer_day_of_month) || 1;
    const amount = Number(ret.retainer_amount) || 0;
    if (amount <= 0) continue;
    const isForeign = ret.is_foreign as boolean;
    const netAmount = isForeign ? amount : amount * (1 + bizVatRate);
    const startDate = ret.retainer_start_date
      ? String(ret.retainer_start_date).substring(0, 10)
      : null;
    const endRetDate = ret.retainer_end_date
      ? String(ret.retainer_end_date).substring(0, 10)
      : null;
    const contactName = (ret.contact_name as string) || "";
    const businessName = (ret.business_name as string) || "";
    const customerLabel = contactName
      ? businessName && businessName !== contactName
        ? `${contactName} / ${businessName}`
        : contactName
      : businessName || "לקוח";
    const vatNote = isForeign ? "" : ' (כולל מע"מ)';
    const name = `ריטיינר - ${customerLabel}${vatNote}`;

    const rangeStart = new Date(displayStartStr + "T00:00:00");
    const rangeEnd = new Date(endDateStr + "T00:00:00");
    for (
      let m = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
      m <= rangeEnd;
      m.setMonth(m.getMonth() + 1)
    ) {
      const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      const day = Math.min(dayOfMonth, daysInMonth);
      const monthKey = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
      const dateStr = `${monthKey}-${String(day).padStart(2, "0")}`;
      if (paidRetainerMonths.has(`${ret.id as string}|${monthKey}`)) continue;
      if (dateStr < displayStartStr || dateStr > endDateStr) continue;
      if (startDate && dateStr < startDate) continue;
      if (endRetDate && dateStr > endRetDate) continue;

      // Last-month proration (page.tsx 380-390)
      let amountForMonth = netAmount;
      if (endRetDate) {
        const endD = new Date(endRetDate + "T00:00:00");
        const sameMonth =
          endD.getFullYear() === m.getFullYear() && endD.getMonth() === m.getMonth();
        if (sameMonth && endD.getDate() < daysInMonth) {
          const daysCovered = Math.max(0, endD.getDate() - day + 1);
          amountForMonth = netAmount * (daysCovered / daysInMonth);
        }
      }

      const existing = retainerByDate.get(dateStr) || [];
      existing.push({ name, amount: amountForMonth });
      retainerByDate.set(dateStr, existing);
    }
  }

  // Settlement of card/cash income (page.tsx 398-408)
  const paymentEntries = (
    (paymentBreakdownResult.data || []) as Array<Record<string, unknown>>
  ).map((row) => {
    const dailyEntry = row.daily_entries as Record<string, unknown>;
    return {
      entry_date: dailyEntry.entry_date as string,
      payment_method_id: row.payment_method_id as string,
      amount: Number(row.amount) || 0,
    };
  });

  const settledMap = calculateSettledIncome(paymentEntries, paymentMethods, pmNameMap);

  // Fallback: total_register where no breakdown exists (page.tsx 410-434)
  const datesWithBreakdown = new Set(paymentEntries.map((e) => e.entry_date));
  const dailyEntries = (dailyEntriesResult.data || []) as Array<{
    entry_date: string;
    total_register: string | number | null;
  }>;
  for (const de of dailyEntries) {
    const entryDate = String(de.entry_date).substring(0, 10);
    let totalRegister = Number(de.total_register) || 0;
    if (isServicesBiz) totalRegister -= paidGrossByDate.get(entryDate) || 0;
    if (totalRegister <= 0.01 || datesWithBreakdown.has(entryDate)) continue;
    const fallbackItem: SettledIncome = {
      settlement_date: entryDate,
      payment_method_id: "total_register",
      payment_method_name: "הכנסה יומית (קופה)",
      original_entry_date: entryDate,
      gross_amount: totalRegister,
      fee_amount: 0,
      net_amount: totalRegister,
    };
    const existing = settledMap.get(entryDate) || [];
    existing.push(fallbackItem);
    settledMap.set(entryDate, existing);
  }

  // Overrides (page.tsx 436-441)
  const overrides = overridesResult.data || [];
  const overrideMap = new Map<string, number>(); // "date|payment_method_id" → override_amount
  for (const ov of overrides as Array<Record<string, unknown>>) {
    overrideMap.set(
      `${ov.settlement_date as string}|${ov.payment_method_id as string}`,
      Number(ov.override_amount)
    );
  }

  // Expense map by due_date (page.tsx 443-460)
  const expensesByDate = new Map<string, number>();
  for (const split of (splitsResult.data || []) as Array<Record<string, unknown>>) {
    const dueDate = split.due_date as string;
    if (!dueDate) continue;
    // Skip "חברות הקפה" (credit/settlement companies, e.g. Wolt) expenses — their
    // fee is already netted out of the income side, so counting it as an outflow
    // double-counts it. Both code variants exist: credit_company / credit_companies.
    const splitPm = (split.payment_method as string) || "";
    if (splitPm === "credit_company" || splitPm === "credit_companies") continue;
    const amount = Number(split.amount) || 0;
    expensesByDate.set(dueDate, (expensesByDate.get(dueDate) || 0) + amount);
  }

  // Build daily data + running cumulative (page.tsx 462-528)
  const startD = new Date(displayStartStr + "T00:00:00");
  const endD = new Date(endDateStr + "T00:00:00");
  const daily: CashflowDay[] = [];
  let cumulative = openingBalance;
  let totalIncome = 0;
  let totalExpenses = 0;
  let firstNegativeDay: string | null = null;

  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    const dateStr = formatLocalDate(d);

    // Income: settled items + overrides
    let incomeItems = settledMap.get(dateStr) || [];
    incomeItems = incomeItems.map((item) => {
      const overrideKey = `${dateStr}|${item.payment_method_id}`;
      if (overrideMap.has(overrideKey)) {
        const overrideAmt = overrideMap.get(overrideKey)!;
        return { ...item, net_amount: overrideAmt, fee_amount: item.gross_amount - overrideAmt };
      }
      return item;
    });

    // Retainer forecast income
    const retainerItems = retainerByDate.get(dateStr) || [];
    for (const ri of retainerItems) {
      incomeItems = [
        ...incomeItems,
        {
          settlement_date: dateStr,
          payment_method_id: "retainer",
          payment_method_name: ri.name,
          original_entry_date: dateStr,
          gross_amount: ri.amount,
          fee_amount: 0,
          net_amount: ri.amount,
        },
      ];
    }

    // Actual customer payments by customer name (services)
    const customerPayItems = customerPaymentsByDate.get(dateStr) || [];
    for (const cp of customerPayItems) {
      incomeItems = [
        ...incomeItems,
        {
          settlement_date: dateStr,
          payment_method_id: "customer_payment",
          payment_method_name: cp.name,
          original_entry_date: dateStr,
          gross_amount: cp.amount,
          fee_amount: 0,
          net_amount: cp.amount,
        },
      ];
    }

    const dayIncome = incomeItems.reduce((sum, i) => sum + i.net_amount, 0);
    const dayExpenses = expensesByDate.get(dateStr) || 0;
    const dailyDiff = dayIncome - dayExpenses;
    cumulative += dailyDiff;

    totalIncome += dayIncome;
    totalExpenses += dayExpenses;
    if (firstNegativeDay === null && cumulative < 0) {
      firstNegativeDay = dateStr;
    }

    daily.push({
      date: dateStr,
      in: dayIncome,
      out: dayExpenses,
      balance: cumulative,
    });
  }

  return {
    startingBalance: openingBalance,
    startDate: displayStartStr,
    endDate: endDateStr,
    totalIncome,
    totalExpenses,
    netDiff: totalIncome - totalExpenses,
    firstNegativeDay,
    daily,
  };
}
