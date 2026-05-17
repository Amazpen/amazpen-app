-- 2026-05-17: payment_priority_marks + invoices.payment_verified_at
--
-- BACKGROUND
-- ----------
-- New "דו"ח ממתינים לתשלום" report (payments page) needs two pieces of
-- per-invoice state that don't exist yet:
--
-- 1. A "star" mark — lets the user pin specific suppliers/invoices so they
--    appear first in the queue ("בתור"). The mark should persist across
--    sessions and ideally be reversible without polluting any wide table.
--
-- 2. A "כרטיס נבדקה" timestamp — the user marks an invoice as "card was
--    verified" (i.e. they checked the credit-card statement and confirmed
--    the charge). When NULL we render "לא" in the table; when set we render
--    the verification date.
--
-- DESIGN CHOICES
-- --------------
-- - payment_priority_marks is a separate junction table (not a boolean on
--   suppliers/invoices) because it must support marking either an entire
--   supplier OR a single invoice — and because marks are a transient UI
--   queue, not a property of the supplier itself.
-- - We allow at most one row per (business_id, supplier_id, invoice_id)
--   so re-marking is idempotent. invoice_id NULLs are deduped via a
--   partial unique index so we can keep an "entire supplier" pin alongside
--   per-invoice pins for the same supplier.
-- - payment_verified_at lives directly on `invoices` because there is
--   exactly one verification state per invoice and we need to read it in
--   the same query that loads the unpaid list. A separate table would
--   double the query cost for no benefit.

-- ---------------------------------------------------------------------------
-- 1) payment_priority_marks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_priority_marks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id)  ON DELETE CASCADE,
  invoice_id  uuid REFERENCES invoices(id) ON DELETE CASCADE,  -- NULL => marks the whole supplier
  marked_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  marked_at   timestamptz NOT NULL DEFAULT now()
);

-- Idempotent marking per invoice
CREATE UNIQUE INDEX IF NOT EXISTS payment_priority_marks_invoice_uq
  ON payment_priority_marks (business_id, supplier_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

-- Idempotent marking per supplier (when invoice_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS payment_priority_marks_supplier_uq
  ON payment_priority_marks (business_id, supplier_id)
  WHERE invoice_id IS NULL;

CREATE INDEX IF NOT EXISTS payment_priority_marks_business_idx
  ON payment_priority_marks (business_id);

ALTER TABLE payment_priority_marks ENABLE ROW LEVEL SECURITY;

-- RLS: a user can read/write marks for any business they're a member of.
DROP POLICY IF EXISTS payment_priority_marks_select ON payment_priority_marks;
CREATE POLICY payment_priority_marks_select
  ON payment_priority_marks
  FOR SELECT
  USING (
    business_id IN (
      SELECT business_id FROM business_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS payment_priority_marks_insert ON payment_priority_marks;
CREATE POLICY payment_priority_marks_insert
  ON payment_priority_marks
  FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM business_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS payment_priority_marks_delete ON payment_priority_marks;
CREATE POLICY payment_priority_marks_delete
  ON payment_priority_marks
  FOR DELETE
  USING (
    business_id IN (
      SELECT business_id FROM business_members
      WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 2) invoices.payment_verified_at
-- ---------------------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS payment_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN invoices.payment_verified_at IS
  'Set when the user confirms via the "כרטיס נבדקה" toggle in the ממתינים-לתשלום report that the matching charge appeared on the credit-card statement.';
