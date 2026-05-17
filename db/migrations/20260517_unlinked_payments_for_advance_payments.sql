-- 2026-05-17: unlinked payments flow for advance / rent-style payments
--
-- BACKGROUND
-- ----------
-- The "הוספת תשלום" form currently requires an existing invoice to attach
-- the payment to. That breaks the real-world flow for advance payments like
-- rent: the landlord gets 4 post-dated checks today but the invoice for each
-- month only arrives later. Users were forced to either skip recording the
-- payments (cashflow forecast goes blind) or fabricate placeholder invoices.
--
-- This migration lets payments live without an invoice for a while, then
-- get retroactively linked when the invoice actually arrives (via OCR or
-- manual entry on /expenses).
--
-- TWO USER INTENTS
-- ----------------
-- When the user records a future payment without an invoice they need to
-- tag what they expect to happen:
--   1. "אני מצפה לקבל חשבונית על התשלום הספציפי הזה"
--      → one invoice per payment (e.g. monthly rent: each check gets its
--      own monthly invoice). Stored as payment_kind='expects_dedicated'.
--   2. "תשלום מחולק שעשיתי על אותה חשבונית"
--      → multiple payments will eventually be reconciled against a single
--      invoice (e.g. 4 checks all on one big purchase). Stored as
--      payment_kind='shared_pool' and grouped by shared_invoice_group_id
--      so the OCR/expenses flow can offer "סגור את כל הקבוצה" in one click.
--
-- The actual invoice→payment binding still happens via the existing
-- payment_invoice_links junction table — payment_kind/shared_invoice_group_id
-- are *hints* about the user's intent, not the source of truth for what got
-- linked. We don't fabricate placeholder invoice rows.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_kind text
    NOT NULL DEFAULT 'invoice_linked'
    CHECK (payment_kind IN ('invoice_linked', 'expects_dedicated', 'shared_pool')),
  ADD COLUMN IF NOT EXISTS shared_invoice_group_id uuid;

-- 'invoice_linked' is the historical behavior — the payment was created
-- against a known invoice (invoice_id or payment_invoice_links row exists).
-- 'expects_dedicated' and 'shared_pool' both imply invoice_id IS NULL and
-- no payment_invoice_links rows yet; once the invoice arrives and the user
-- links them, the kind can stay as-is (it's a record of original intent)
-- or be flipped to invoice_linked at the call-site's discretion.

COMMENT ON COLUMN payments.payment_kind IS
  'How the payment is meant to be reconciled. invoice_linked = bound to an invoice at creation time; expects_dedicated = one invoice per payment expected; shared_pool = multiple payments will be reconciled against one invoice.';

COMMENT ON COLUMN payments.shared_invoice_group_id IS
  'Groups payments that the user intends to reconcile against the same future invoice (e.g. 4 checks on one purchase). NULL unless payment_kind = shared_pool.';

CREATE INDEX IF NOT EXISTS payments_shared_invoice_group_idx
  ON payments (shared_invoice_group_id)
  WHERE shared_invoice_group_id IS NOT NULL;

-- Convenience index for the OCR / expenses flow that fetches
-- "open payments awaiting an invoice" for a given supplier.
CREATE INDEX IF NOT EXISTS payments_open_supplier_idx
  ON payments (business_id, supplier_id)
  WHERE invoice_id IS NULL AND deleted_at IS NULL AND payment_kind <> 'invoice_linked';
