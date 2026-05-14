/**
 * Fire-and-forget budget-overage alert. Posts to /api/budget-alert which
 * (server-side) checks if the supplier's monthly spend exceeds its budget
 * and, if so, sends an email via the n8n webhook. The API route deduplicates
 * per (business, supplier, month), so repeated calls within the same month
 * are safe.
 *
 * Call this after EVERY invoice insert from any intake path (manual expense
 * form, OCR review, OCR business view, markezet/summary) so goods-purchases
 * and current-expenses suppliers both get alerted. Skipping any intake leaves
 * suppliers on that path silently over-budget until the next external cron.
 */
export function fireBudgetAlert(params: {
  businessId: string | null | undefined;
  supplierId: string | null | undefined;
  invoiceSubtotal: number | string | null | undefined;
}): void {
  const { businessId, supplierId, invoiceSubtotal } = params;
  if (!businessId || !supplierId) return;
  const subtotalNum = typeof invoiceSubtotal === "string" ? parseFloat(invoiceSubtotal) : Number(invoiceSubtotal);
  if (!Number.isFinite(subtotalNum) || subtotalNum <= 0) return;

  fetch("/api/budget-alert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      business_id: businessId,
      supplier_id: supplierId,
      invoice_subtotal: subtotalNum,
    }),
  }).catch((err) => console.warn("[Budget Alert] Failed:", err));
}
