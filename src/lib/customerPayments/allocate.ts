/**
 * Pure allocation helper for the customers "pay selected months" panel.
 *
 * The user pays one or more installments (each with its own date and gross
 * amount). Those installments are poured, oldest month first, into the open
 * balances of the selected billing months. The result is one
 * `customer_payments` row per (installment, month) pair, so that:
 *   - `payment_date`  = when the money actually arrived (installment date)
 *   - `billing_month` = which month that slice of money covers
 *
 * Amounts: input is GROSS (what the customer paid, incl. VAT). Output and the
 * month balances are NET (pre-VAT) because `customer_payments.amount` is
 * stored net. No React / Supabase imports here - keep this file testable.
 */

export interface OpenMonth {
  year: number;
  month: number; // 0-11
  openNet: number;
}

export interface InstallmentInput {
  paymentMethod: string;
  date: string; // YYYY-MM-DD, when money actually arrives
  amountGross: number; // what the customer paid, incl. VAT
  installmentsCount: number; // M
  installmentNumber: number; // N of M
}

export interface AllocatedRow {
  year: number;
  month: number; // covered month (0-11)
  billingMonth: string; // `${year}-${MM}-01`
  paymentDate: string; // = installment.date
  amountNet: number; // rounded to 2 decimals
  paymentMethod: string;
  installmentsCount: number;
  installmentNumber: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Non-finite or negative amounts are treated as 0. */
function safeAmount(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function safeRate(vatRate: number): number {
  return Number.isFinite(vatRate) && vatRate > 0 ? vatRate : 0;
}

/** Gross (incl. VAT) -> net, rounded to 2 decimals. vatRate 0 => identity. */
export function grossToNet(gross: number, vatRate: number): number {
  return round2(safeAmount(gross) / (1 + safeRate(vatRate)));
}

/** Net -> gross (incl. VAT), rounded to 2 decimals. */
export function netToGross(net: number, vatRate: number): number {
  return round2(safeAmount(net) * (1 + safeRate(vatRate)));
}

/** First day of the month as an ISO date string. */
export function toBillingMonth(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

export function allocateCustomerPayment(
  months: OpenMonth[],
  installments: InstallmentInput[],
  vatRate: number,
): AllocatedRow[] {
  // Oldest first, regardless of input order; drop months with nothing open.
  const eligible = months
    .map((m) => ({ year: m.year, month: m.month, remaining: round2(safeAmount(m.openNet)) }))
    .filter((m) => m.remaining > 0)
    .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month));

  if (eligible.length === 0) return [];

  const newest = eligible[eligible.length - 1];
  const out: AllocatedRow[] = [];

  for (const inst of installments) {
    const net = grossToNet(inst.amountGross, vatRate);
    if (net <= 0) continue;

    const rows: AllocatedRow[] = [];
    let left = net;

    // Waterfall: fill the oldest open month first, then the next, and so on.
    for (const m of eligible) {
      if (left <= 0) break;
      if (m.remaining <= 0) continue;
      const take = round2(Math.min(left, m.remaining));
      if (take <= 0) continue;
      m.remaining = round2(m.remaining - take);
      left = round2(left - take);
      rows.push({
        year: m.year,
        month: m.month,
        billingMonth: toBillingMonth(m.year, m.month),
        paymentDate: inst.date,
        amountNet: take,
        paymentMethod: inst.paymentMethod,
        installmentsCount: inst.installmentsCount,
        installmentNumber: inst.installmentNumber,
      });
    }

    // Overpayment: whatever is left over goes onto the newest month for this
    // installment (never dropped). Reuse that month's row if it exists.
    if (left > 0) {
      const existing = rows.find((r) => r.year === newest.year && r.month === newest.month);
      if (existing) {
        existing.amountNet = round2(existing.amountNet + left);
      } else {
        rows.push({
          year: newest.year,
          month: newest.month,
          billingMonth: toBillingMonth(newest.year, newest.month),
          paymentDate: inst.date,
          amountNet: left,
          paymentMethod: inst.paymentMethod,
          installmentsCount: inst.installmentsCount,
          installmentNumber: inst.installmentNumber,
        });
      }
      left = 0;
    }

    // The rows of one installment must add up to its net exactly; the last row
    // absorbs any rounding remainder.
    if (rows.length > 0) {
      const sum = round2(rows.reduce((s, r) => s + r.amountNet, 0));
      const diff = round2(net - sum);
      if (diff !== 0) {
        const last = rows[rows.length - 1];
        last.amountNet = round2(last.amountNet + diff);
      }
    }

    out.push(...rows.filter((r) => r.amountNet > 0));
  }

  return out;
}
