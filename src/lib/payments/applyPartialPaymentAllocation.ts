import type { SupabaseClient } from "@supabase/supabase-js";
import { allocatePartialPayment, type AllocInvoice } from "./allocatePartialPayment";

// Persists a lump-sum partial payment across the selected invoices.
// Balance of each invoice = total_amount minus already-allocated links, so a
// previously-partial invoice is handled correctly. Fully-covered invoices ->
// status 'paid'; the single leftover -> status 'partial' + amount_paid (for
// the OCR remaining display). amount_allocated links are the report's truth.
export async function applyPartialPaymentAllocation(
  supabase: SupabaseClient,
  args: { paymentId: string; invoiceIds: string[]; paymentAmount: number }
): Promise<void> {
  const { paymentId, invoiceIds, paymentAmount } = args;
  if (invoiceIds.length === 0) return;

  // Fetch invoices + prior allocations to compute the current open balance.
  const [{ data: invRows }, { data: priorLinks }] = await Promise.all([
    supabase.from("invoices").select("id, total_amount, invoice_date").in("id", invoiceIds),
    supabase.from("payment_invoice_links").select("invoice_id, amount_allocated").in("invoice_id", invoiceIds),
  ]);

  const priorByInvoice = new Map<string, number>();
  for (const l of priorLinks || []) {
    const id = l.invoice_id as string;
    priorByInvoice.set(id, (priorByInvoice.get(id) || 0) + Number(l.amount_allocated || 0));
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
}
