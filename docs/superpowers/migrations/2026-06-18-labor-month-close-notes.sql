-- Employee-cost month-close: free-text notes/reminders per closed month.
-- Applied to the self-hosted DB via Supabase MCP execute_sql (apply_migration
-- is unreliable on self-hosted — see project memory).
ALTER TABLE labor_month_close ADD COLUMN IF NOT EXISTS notes text;
