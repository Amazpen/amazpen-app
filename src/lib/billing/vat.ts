// Shared VAT (מע"מ) math for the admin billing / Cardcom module.
//
// The company (המצפן בע"מ) is VAT-registered. Admins enter a NET amount
// (לפני מע"מ) plus a VAT percent; the system charges the GROSS = net*(1+vat).
//
// Conventions (also encoded in the DB):
//   billing_subscriptions.monthly_amount = NET (pre-VAT)
//   billing_charges.amount               = GROSS charged
//   billing_charges.net_amount/vat_amount/vat_percent = the breakdown
// The amount sent to Cardcom (Amount) is always the GROSS.

export const DEFAULT_VAT_PERCENT = 18;

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Given net + vat percent, return {net, vatPercent, vatAmount, gross}. */
export function computeVat(
  net: number,
  vatPercent: number
): { net: number; vatPercent: number; vatAmount: number; gross: number } {
  const n = round2(net);
  const gross = round2(n * (1 + vatPercent / 100));
  return { net: n, vatPercent, vatAmount: round2(gross - n), gross };
}
