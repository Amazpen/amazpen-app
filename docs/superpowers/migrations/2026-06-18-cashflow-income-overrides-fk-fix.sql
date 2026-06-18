-- Fix: cashflow income override "save" silently failed.
-- The payment_method_id values come from payment_method_types, but the FK
-- pointed at income_sources (a rename leftover named ..._income_source_id_fkey),
-- so every override insert violated the FK (23503) and the dialog stayed open.
-- Re-point the FK to payment_method_types. Applied via Supabase MCP execute_sql.
ALTER TABLE cashflow_income_overrides
  DROP CONSTRAINT IF EXISTS cashflow_income_overrides_income_source_id_fkey;
ALTER TABLE cashflow_income_overrides
  ADD CONSTRAINT cashflow_income_overrides_payment_method_id_fkey
  FOREIGN KEY (payment_method_id) REFERENCES payment_method_types(id) ON DELETE CASCADE;
