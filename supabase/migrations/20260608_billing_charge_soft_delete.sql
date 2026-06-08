-- Soft-delete support for billing charges/links.
-- Paid (status='success') charges are kept for invoice/accounting records;
-- only non-success charges may be soft-deleted by an admin.
alter table public.billing_charges add column if not exists deleted_at timestamptz;
