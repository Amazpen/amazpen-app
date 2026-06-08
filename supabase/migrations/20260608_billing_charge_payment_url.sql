-- Store the raw Cardcom hosted payment URL on each charge so the branded
-- public page (/pay/c/[chargeId]) can embed it in an iframe. The shareable
-- link the admin sends is the branded one; this column holds the underlying
-- Cardcom URL that the branded page loads.
alter table public.billing_charges
  add column if not exists cardcom_payment_url text;
