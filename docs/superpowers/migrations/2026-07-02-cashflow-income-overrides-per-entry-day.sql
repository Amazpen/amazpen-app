-- Fix: editing one income item in the cashflow changed ALL sibling items of
-- the same payment method settling on the same bank day (e.g. 15 Wolt entry
-- days all paying out on the 1st shared one override row).
-- The override key gains original_entry_date so each entry day is overridden
-- independently. Applied via Supabase MCP execute_sql on 2026-07-02.

ALTER TABLE cashflow_income_overrides ADD COLUMN IF NOT EXISTS original_entry_date DATE;

-- Backfill the 3 legacy rows (matched against daily_payment_breakdown amounts
-- + each method's settlement_periods rules):
--   סושי קונה / וולט   settlement 2026-07-01, original 1629.60 → entry 2026-06-17
--   סושי קונה / אשראי  settlement 2026-06-21, original 1989.95 → entry 2026-06-07
--   הדגמה    / מזומן   settlement 2026-03-01 (daily+1)         → entry 2026-02-28
UPDATE cashflow_income_overrides o
SET original_entry_date = DATE '2026-06-17'
FROM payment_method_types pmt
WHERE pmt.id = o.payment_method_id AND pmt.name = 'וולט'
  AND o.settlement_date = DATE '2026-07-01' AND o.original_entry_date IS NULL;

UPDATE cashflow_income_overrides o
SET original_entry_date = DATE '2026-06-07'
FROM payment_method_types pmt
WHERE pmt.id = o.payment_method_id AND pmt.name = 'אשראי'
  AND o.settlement_date = DATE '2026-06-21' AND o.original_entry_date IS NULL;

UPDATE cashflow_income_overrides o
SET original_entry_date = DATE '2026-02-28'
FROM payment_method_types pmt, businesses b
WHERE pmt.id = o.payment_method_id AND b.id = o.business_id
  AND b.name = 'הדגמה' AND pmt.name = 'מזומן'
  AND o.settlement_date = DATE '2026-03-01' AND o.original_entry_date IS NULL;

-- Safety net for any other legacy row (expected: none)
UPDATE cashflow_income_overrides SET original_entry_date = settlement_date WHERE original_entry_date IS NULL;

ALTER TABLE cashflow_income_overrides ALTER COLUMN original_entry_date SET NOT NULL;

-- Re-key uniqueness per original entry day: several entry days of one method
-- can settle on the same bank day and each needs its own override row.
ALTER TABLE cashflow_income_overrides DROP CONSTRAINT cashflow_income_overrides_biz_date_pm_key;
ALTER TABLE cashflow_income_overrides
  ADD CONSTRAINT cashflow_income_overrides_biz_date_pm_orig_key
  UNIQUE (business_id, settlement_date, payment_method_id, original_entry_date);
