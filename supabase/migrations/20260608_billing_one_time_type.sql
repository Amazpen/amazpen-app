-- Allow a one-time (no token / no subscription) charge type on billing_charges.
ALTER TABLE public.billing_charges DROP CONSTRAINT billing_charges_type_check;
ALTER TABLE public.billing_charges ADD CONSTRAINT billing_charges_type_check CHECK (type in ('initial','recurring','manual','one_time'));
