// Rounding tolerance (half an agora). NOT the regular flow's ₪5 business
// tolerance — partial allocation is exact to the entered amount, this only
// absorbs float noise so 99.999 closes a ₪100 invoice.
export const ALLOC_EPS = 0.005;

export type AllocInvoice = { id: string; balance: number };

export type AllocLine = {
  invoice_id: string;
  amount_allocated: number;
  new_status: "paid" | "partial";
  remaining_balance: number;
};

export type AllocResult = {
  lines: AllocLine[];
  fullyPaidIds: string[];
  partialId: string | null;
  totalAllocated: number;
  overpay: number;
};

// FIFO: caller passes invoices already sorted oldest -> newest. Each invoice's
// `balance` is its current OPEN amount (total minus prior allocations). We close
// invoices in full while the payment covers them, then the first invoice the
// payment can't fully cover becomes `partial`. Untouched invoices are omitted
// from `lines` (they stay open/pending — the caller does not change them).
export function allocatePartialPayment(
  invoicesOldestFirst: AllocInvoice[],
  paymentAmount: number
): AllocResult {
  const lines: AllocLine[] = [];
  const fullyPaidIds: string[] = [];
  let partialId: string | null = null;
  let remaining = paymentAmount;
  let totalAllocated = 0;

  for (const invItem of invoicesOldestFirst) {
    if (remaining <= ALLOC_EPS) break;
    const balance = invItem.balance;
    if (remaining + ALLOC_EPS >= balance) {
      // Fully covers this invoice.
      lines.push({ invoice_id: invItem.id, amount_allocated: balance, new_status: "paid", remaining_balance: 0 });
      fullyPaidIds.push(invItem.id);
      remaining -= balance;
      totalAllocated += balance;
    } else {
      // Partial close — this is the single leftover invoice.
      const allocated = remaining;
      lines.push({
        invoice_id: invItem.id,
        amount_allocated: allocated,
        new_status: "partial",
        remaining_balance: balance - allocated,
      });
      partialId = invItem.id;
      totalAllocated += allocated;
      remaining = 0;
      break;
    }
  }

  return {
    lines,
    fullyPaidIds,
    partialId,
    totalAllocated,
    overpay: Math.max(0, remaining),
  };
}
