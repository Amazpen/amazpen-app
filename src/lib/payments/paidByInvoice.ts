import type { SupabaseClient } from "@supabase/supabase-js";

// Ids per `.in()` filter: keeps the request URL short for suppliers with many
// open invoices.
const ID_CHUNK_SIZE = 100;
// PostgREST returns at most 1000 rows per request; page through anything larger.
const PAGE_SIZE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

// Runs `buildPage(chunk, from, to)` for every id chunk and every page until a
// page comes back short. Throws on the first query error, so a failed query is
// never mistaken for "no payments".
async function fetchAllChunked<T>(
  ids: string[],
  buildPage: (chunk: string[], from: number, to: number) => PageResult<T>
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + ID_CHUNK_SIZE);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await buildPage(chunk, from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const page = data || [];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

// Real paid amount per invoice, batched for a list of invoices.
// invoices.amount_paid is unreliable (only the partial-payment flow writes it),
// so "paid" is computed from the two payment sources:
//   1. payment_invoice_links.amount_allocated of non-deleted payments (N:M);
//   2. payments linked by the direct payments.invoice_id FK. Same dedupe rule
//      as applyPartialPaymentAllocation / computePaid in /expenses: a payment
//      that has link rows is already counted through them, so its FK counts
//      only when it has none.
// `excludePaymentId` drops one payment entirely (the payment being edited must
// not count as "already paid" against its own invoices).
//
// The returned map holds an entry ONLY for invoices that have at least one
// link / FK payment (the excluded payment included, as 0). Callers fall back
// to invoices.amount_paid for invoices without an entry.
// Throws if any query fails: callers must surface that, not silently treat
// every invoice as unpaid.
export async function fetchPaidByInvoice(
  supabase: SupabaseClient,
  invoiceIds: string[],
  opts: { excludePaymentId?: string | null } = {}
): Promise<Map<string, number>> {
  const paidByInvoice = new Map<string, number>();
  if (invoiceIds.length === 0) return paidByInvoice;
  const excludeId = opts.excludePaymentId || null;

  const [links, direct] = await Promise.all([
    fetchAllChunked<{ invoice_id: string; amount_allocated: number | string | null; payment_id: string | null }>(
      invoiceIds,
      (chunk, from, to) =>
        supabase
          .from("payment_invoice_links")
          .select("invoice_id, amount_allocated, payment_id, payment:payments!inner(deleted_at)")
          .in("invoice_id", chunk)
          .is("payment.deleted_at", null)
          .order("payment_id")
          .order("invoice_id")
          .range(from, to)
    ),
    fetchAllChunked<{ id: string; invoice_id: string | null; total_amount: number | string | null }>(
      invoiceIds,
      (chunk, from, to) =>
        supabase
          .from("payments")
          .select("id, invoice_id, total_amount")
          .in("invoice_id", chunk)
          .is("deleted_at", null)
          .order("id")
          .range(from, to)
    ),
  ]);

  const markSeen = (invoiceId: string) => {
    if (!paidByInvoice.has(invoiceId)) paidByInvoice.set(invoiceId, 0);
  };

  for (const l of links) {
    const invoiceId = l.invoice_id;
    if (excludeId && l.payment_id === excludeId) {
      markSeen(invoiceId);
      continue;
    }
    const amt = Number(l.amount_allocated) || 0;
    if (amt === 0) continue;
    paidByInvoice.set(invoiceId, (paidByInvoice.get(invoiceId) || 0) + amt);
  }

  const fkPayments = direct.filter((p) => p.invoice_id);
  const fkIds = Array.from(new Set(fkPayments.map((p) => p.id).filter((id) => id !== excludeId)));
  const paymentsWithLinks = new Set<string>();
  if (fkIds.length > 0) {
    const linksOfFkPayments = await fetchAllChunked<{ payment_id: string }>(fkIds, (chunk, from, to) =>
      supabase
        .from("payment_invoice_links")
        .select("payment_id")
        .in("payment_id", chunk)
        .order("payment_id")
        .order("invoice_id")
        .range(from, to)
    );
    for (const l of linksOfFkPayments) paymentsWithLinks.add(l.payment_id);
  }
  for (const p of fkPayments) {
    const invoiceId = p.invoice_id as string;
    if (excludeId && p.id === excludeId) {
      markSeen(invoiceId);
      continue;
    }
    if (paymentsWithLinks.has(p.id)) continue; // counted via its links
    paidByInvoice.set(invoiceId, (paidByInvoice.get(invoiceId) || 0) + (Number(p.total_amount) || 0));
  }

  return paidByInvoice;
}

// Open balance of one invoice = total - paid, rounded to agorot. A regular
// invoice never goes below 0; a credit note (negative total) stays negative
// while open and never goes above 0.
export function openBalanceOf(totalAmount: number, paid: number): number {
  const total = Number(totalAmount) || 0;
  const raw = Math.round((total - (Number(paid) || 0)) * 100) / 100;
  return total < 0 ? Math.min(0, raw) : Math.max(0, raw);
}
