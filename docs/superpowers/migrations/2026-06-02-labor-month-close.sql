-- Employee-Cost Month-Close: source-of-truth flip for labor cost.

-- 1. Close record (one per business per month)
CREATE TABLE IF NOT EXISTS public.labor_month_close (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period_year     int  NOT NULL,
  period_month    int  NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status          text NOT NULL DEFAULT 'closed' CHECK (status IN ('closed','reopened')),
  estimate_total  numeric,
  actual_total    numeric,
  closed_at       timestamptz DEFAULT now(),
  closed_by       uuid,
  reopened_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT labor_month_close_unique UNIQUE (business_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_labor_month_close_lookup
  ON public.labor_month_close (business_id, period_year, period_month, status);

ALTER TABLE public.labor_month_close ENABLE ROW LEVEL SECURITY;

CREATE POLICY labor_month_close_select ON public.labor_month_close
  FOR SELECT USING (is_business_member(business_id) OR is_admin());
CREATE POLICY labor_month_close_insert ON public.labor_month_close
  FOR INSERT WITH CHECK (is_business_member(business_id) OR is_admin());
CREATE POLICY labor_month_close_update ON public.labor_month_close
  FOR UPDATE USING (is_business_member(business_id) OR is_admin())
  WITH CHECK (is_business_member(business_id) OR is_admin());
CREATE POLICY labor_month_close_delete ON public.labor_month_close
  FOR DELETE USING (is_business_member(business_id) OR is_admin());

-- 2. Link invoices created by a close (for precise reopen + P&L identification)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS labor_close_id uuid REFERENCES public.labor_month_close(id);
CREATE INDEX IF NOT EXISTS idx_invoices_labor_close ON public.invoices (labor_close_id);

-- 3. Identify the auto-provisioned salary supplier
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS system_kind text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_system_kind
  ON public.suppliers (business_id, system_kind) WHERE system_kind IS NOT NULL;
