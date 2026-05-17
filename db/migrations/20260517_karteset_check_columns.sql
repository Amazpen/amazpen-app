-- 2026-05-17: karteset_checked timestamps on invoices and payments
--
-- BACKGROUND
-- ----------
-- New "בדיקת כרטסת" tab in the OCR intake form (/ocr) lets users
-- reconcile our records against a statement (כרטסת) the supplier sent.
-- For each invoice/payment in the chosen date range the user ticks a
-- checkbox confirming "yes, this line appears on the supplier's
-- statement too." That status needs to persist so the user can come
-- back later, see what they already verified, and only touch new
-- rows next time.
--
-- DESIGN
-- ------
-- Stored directly on invoices/payments (no separate junction table):
--   - karteset_checked_at: null = not checked; timestamp = last
--     verification time
--   - karteset_checked_by: who flipped it on
-- A separate table would buy us full audit history but the user only
-- cares about "is this currently confirmed?" — one-row-per-doc keeps
-- the karteset query simple.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS karteset_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS karteset_checked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS karteset_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS karteset_checked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN invoices.karteset_checked_at IS
  'Set when the user confirms in /ocr בדיקת כרטסת that this invoice appears on the supplier statement they received.';

COMMENT ON COLUMN payments.karteset_checked_at IS
  'Set when the user confirms in /ocr בדיקת כרטסת that this payment appears on the supplier statement they received.';
