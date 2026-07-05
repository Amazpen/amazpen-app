-- Managed product monthly prices (מחיר מוצר מנוהל לפי חודש)
-- Price for product P in month M resolves: explicit (P,M) row -> latest earlier row -> managed_products.unit_cost.
-- Applied live via execute_sql on 2026-07-05.

CREATE TABLE IF NOT EXISTS public.managed_product_monthly_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.managed_products(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  unit_cost numeric NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (product_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_mpmp_business ON public.managed_product_monthly_prices(business_id, year, month);

ALTER TABLE public.managed_product_monthly_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mpmp_select" ON public.managed_product_monthly_prices
  FOR SELECT USING (public.is_business_member(business_id) OR public.is_admin());
CREATE POLICY "mpmp_insert" ON public.managed_product_monthly_prices
  FOR INSERT WITH CHECK (public.is_business_member(business_id) OR public.is_admin());
CREATE POLICY "mpmp_update" ON public.managed_product_monthly_prices
  FOR UPDATE USING (public.is_business_member(business_id) OR public.is_admin())
  WITH CHECK (public.is_business_member(business_id) OR public.is_admin());
CREATE POLICY "mpmp_delete" ON public.managed_product_monthly_prices
  FOR DELETE USING (public.is_business_member(business_id) OR public.is_admin());
