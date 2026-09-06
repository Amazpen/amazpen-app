import type { SupabaseClient } from "@supabase/supabase-js";
import { allocatePartialPayment, type AllocInvoice, type AllocResult } from "./allocatePartialPayment";

// Persists a lump-sum payment across the selected invoices.
// Balance of each invoice = total_amount minus what was ALREADY paid on it, so a
// previously-partial invoice is handled correctly. Fully-covered invoices ->
// status 'paid'; the single leftover -> status 'partial' + amount_paid (for
// the OCR remaining display). amount_allocated links are the report's truth.
// Returns the allocation result so the caller can react to `overpay` (money the
// selected invoices could not absorb).
// `closeTolerance` (default 0 = exact) forgives a leftover of at most that many
// shekels on the last invoice and closes it as 'paid' anyway.
export async function applyPartialPaymentAllocation(
  supabase: SupabaseClient,
  args: { paymentId: string; invoiceIds: string[]; paymentAmount: number; closeTolerance?: number }
): Promise<AllocResult> {
  const { paymentId, invoiceIds, paymentAmount } = args;
  if (invoiceIds.length === 0) {
    return { lines: [], fullyPaidIds: [], partialId: null, totalAllocated: 0, overpay: paymentAmount };
  }

  // Fetch invoices + everything already paid against them, to compute the
  // current open balance. Prior paid = link rows (N:M) PLUS direct-FK payments
  // (payments.invoice_id), which is how the single-invoice OCR flow stores a
  // payment. Ignoring the FK made an already-partially-paid invoice look
  // untouched, so the same remainder kept being offered and paid again.
  const [{ data: invRows }, { data: priorLinks }, { data: priorFkPayments }] = await Promise.all([
    supabase.from("invoices").select("id, total_amount, invoice_date").in("id", invoiceIds),
    supabase.from("payment_invoice_links").select("invoice_id, amount_allocated").in("invoice_id", invoiceIds),
    supabase
      .from("payments")
      .select("id, invoice_id, total_amount")
      .in("invoice_id", invoiceIds)
      .is("deleted_at", null)
      // The payment being applied right now is not "prior" — it is usually
      // already inserted with invoice_id set by the time we get here.
      .neq("id", paymentId),
  ]);

  const priorByInvoice = new Map<string, number>();
  for (const l of priorLinks || []) {
    const id = l.invoice_id as string;
    priorByInvoice.set(id, (priorByInvoice.get(id) || 0) + Number(l.amount_allocated || 0));
  }

  // Dedupe rule copied from computePaid in /expenses: a payment that has link
  // rows is already counted above, so count its FK only when it has none.
  const priorFkIds = (priorFkPayments || []).map((p) => p.id as string);
  const linkedPaymentIds = new Set<string>();
  if (priorFkIds.length > 0) {
    const { data: linksOfFkPayments } = await supabase
      .from("payment_invoice_links")
      .select("payment_id")
      .in("payment_id", priorFkIds);
    for (const l of linksOfFkPayments || []) linkedPaymentIds.add(l.payment_id as string);
  }
  for (const p of priorFkPayments || []) {
    if (linkedPaymentIds.has(p.id as string)) continue;
    const id = p.invoice_id as string;
    priorByInvoice.set(id, (priorByInvoice.get(id) || 0) + (Number(p.total_amount) || 0));
  }

  // Oldest -> newest. Balance floored at 0.
  const ordered: (AllocInvoice & { total: number })[] = (invRows || [])
    .map((inv) => {
      const total = Number(inv.total_amount) || 0;
      const prior = priorByInvoice.get(inv.id as string) || 0;
      return { id: inv.id as string, total, balance: Math.max(0, total - prior), date: inv.invoice_date as string };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const result = allocatePartialPayment(ordered, paymentAmount);
  const totalById = new Map(ordered.map((o) => [o.id, o.total]));

  // Business tolerance: an OCR-read payment is routinely a few shekels off the
  // invoice total (and totals carry cents noise like 5450.9982), so a leftover
  // this small means "settled", not "still open". Close it instead of leaving a
  // junk balance. The link keeps the amount that was ACTUALLY paid - the
  // difference is forgiven, not invented. Callers pass 0 for the explicit
  // "תשלום חלקי" flow, which stays exact by design (see ALLOC_EPS).
  const closeTolerance = args.closeTolerance ?? 0;
  if (closeTolerance > 0 && result.partialId) {
    const partialLine = result.lines.find((l) => l.invoice_id === result.partialId);
    if (partialLine && partialLine.remaining_balance <= closeTolerance) {
      partialLine.new_status = "paid";
      result.fullyPaidIds.push(result.partialId);
      result.partialId = null;
    }
  }

  // Insert one link per allocated invoice.
  for (const line of result.lines) {
    await supabase.from("payment_invoice_links").insert({
      payment_id: paymentId,
      invoice_id: line.invoice_id,
      amount_allocated: line.amount_allocated,
    });
  }

  // Fully-paid invoices -> 'paid'.
  if (result.fullyPaidIds.length > 0) {
    await supabase.from("invoices").update({ status: "paid" }).in("id", result.fullyPaidIds);
  }

  // Leftover invoice -> 'partial' + amount_paid = total - remaining (display only).
  if (result.partialId) {
    const partialLine = result.lines.find((l) => l.invoice_id === result.partialId);
    const total = totalById.get(result.partialId) || 0;
    const amountPaid = total - (partialLine?.remaining_balance ?? 0);
    await supabase
      .from("invoices")
      .update({ status: "partial", amount_paid: amountPaid })
      .eq("id", result.partialId);
  }

  return result;
}
