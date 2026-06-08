-- Billing VAT (מע"מ) support.
-- The company (המצפן בע"מ) is VAT-registered and charges VAT + issues tax invoices.
--
-- Semantics:
--   billing_subscriptions.monthly_amount = NET (pre-VAT). vat_percent stored so
--     recurring charges recompute gross at the subscription's stored percent.
--   billing_charges.amount = GROSS charged. net_amount/vat_amount/vat_percent =
--     the self-documenting breakdown for that charge.

alter table public.billing_subscriptions
  add column if not exists vat_percent numeric not null default 18;

alter table public.billing_charges
  add column if not exists vat_percent numeric;

alter table public.billing_charges
  add column if not exists net_amount numeric;

alter table public.billing_charges
  add column if not exists vat_amount numeric;
