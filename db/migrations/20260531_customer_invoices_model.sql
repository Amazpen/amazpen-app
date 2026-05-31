-- Customer invoices model for services-type businesses (mirror of /suppliers invoices,
-- but inverted: income invoices instead of expense invoices).
--
-- Tables:
--   customer_invoices               — one income invoice per retainer-month (or ad-hoc)
--   customer_payment_invoice_links  — many-to-many between customer_payments and invoices
--
-- Triggers:
--   trg_auto_link_customer_payment_to_invoice — on new customer_payment, find or create
--     the matching invoice and create the link
--   trg_recompute_customer_invoice_balance — keep customer_invoices.amount_paid and
--     status in sync with the sum of linked allocations
--   resolve_services_income_source() — helper used by the bridge trigger to route
--     services payments into the right income_source based on payment_method
--
-- Bridge trigger update (bridge_customer_payment_to_daily_income) now uses
-- resolve_services_income_source() so cashflow shows per-method breakdown
-- (אשראי / ביט / העברה בנקאית / מזומן …) instead of one lumped "כללי".

-- ============================================================================
-- Schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  invoice_number  TEXT,
  issue_date      DATE NOT NULL,
  due_date        DATE,
  subtotal        NUMERIC NOT NULL DEFAULT 0,
  vat_amount      NUMERIC NOT NULL DEFAULT 0,
  total_amount    NUMERIC NOT NULL DEFAULT 0,
  amount_paid     NUMERIC NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','paid','cancelled')),
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto_retainer')),
  attachment_url  TEXT,
  notes           TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customer_invoices_customer
  ON customer_invoices(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customer_invoices_business_issue
  ON customer_invoices(business_id, issue_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS customer_payment_invoice_links (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id        UUID NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
  invoice_id        UUID NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
  amount_allocated  NUMERIC NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_cust_pay_inv_links_payment
  ON customer_payment_invoice_links(payment_id);
CREATE INDEX IF NOT EXISTS idx_cust_pay_inv_links_invoice
  ON customer_payment_invoice_links(invoice_id);

-- ============================================================================
-- RLS — same pattern as supplier invoices: is_business_member() OR is_admin()
-- ============================================================================

ALTER TABLE customer_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_invoices_select ON customer_invoices;
DROP POLICY IF EXISTS customer_invoices_insert ON customer_invoices;
DROP POLICY IF EXISTS customer_invoices_update ON customer_invoices;
DROP POLICY IF EXISTS customer_invoices_delete ON customer_invoices;
CREATE POLICY customer_invoices_select ON customer_invoices
  FOR SELECT USING (is_business_member(business_id) OR is_admin());
CREATE POLICY customer_invoices_insert ON customer_invoices
  FOR INSERT WITH CHECK (is_business_member(business_id) OR is_admin());
CREATE POLICY customer_invoices_update ON customer_invoices
  FOR UPDATE USING (is_business_member(business_id) OR is_admin());
CREATE POLICY customer_invoices_delete ON customer_invoices
  FOR DELETE USING (is_business_member(business_id) OR is_admin());

ALTER TABLE customer_payment_invoice_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cust_pay_inv_links_select ON customer_payment_invoice_links;
DROP POLICY IF EXISTS cust_pay_inv_links_insert ON customer_payment_invoice_links;
DROP POLICY IF EXISTS cust_pay_inv_links_update ON customer_payment_invoice_links;
DROP POLICY IF EXISTS cust_pay_inv_links_delete ON customer_payment_invoice_links;
CREATE POLICY cust_pay_inv_links_select ON customer_payment_invoice_links FOR SELECT
  USING (EXISTS (SELECT 1 FROM customer_invoices ci WHERE ci.id=invoice_id AND (is_business_member(ci.business_id) OR is_admin())));
CREATE POLICY cust_pay_inv_links_insert ON customer_payment_invoice_links FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM customer_invoices ci WHERE ci.id=invoice_id AND (is_business_member(ci.business_id) OR is_admin())));
CREATE POLICY cust_pay_inv_links_update ON customer_payment_invoice_links FOR UPDATE
  USING (EXISTS (SELECT 1 FROM customer_invoices ci WHERE ci.id=invoice_id AND (is_business_member(ci.business_id) OR is_admin())));
CREATE POLICY cust_pay_inv_links_delete ON customer_payment_invoice_links FOR DELETE
  USING (EXISTS (SELECT 1 FROM customer_invoices ci WHERE ci.id=invoice_id AND (is_business_member(ci.business_id) OR is_admin())));

-- ============================================================================
-- resolve_services_income_source() — route by payment_method
-- ============================================================================

CREATE OR REPLACE FUNCTION resolve_services_income_source(
  p_business_id      UUID,
  p_explicit_id      UUID,
  p_payment_method   TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_id    UUID;
  v_label TEXT;
BEGIN
  IF p_explicit_id IS NOT NULL THEN RETURN p_explicit_id; END IF;
  v_label := CASE p_payment_method
    WHEN 'bank_transfer' THEN 'העברה בנקאית'
    WHEN 'credit'        THEN 'אשראי'
    WHEN 'cash'          THEN 'מזומן'
    WHEN 'bit'           THEN 'ביט'
    WHEN 'paybox'        THEN 'פייבוקס'
    WHEN 'check'         THEN 'צ׳ק'
    WHEN 'other'         THEN 'אחר'
    ELSE NULL
  END;
  IF v_label IS NOT NULL THEN
    SELECT id INTO v_id FROM income_sources
    WHERE business_id = p_business_id AND name = v_label AND deleted_at IS NULL
    LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    INSERT INTO income_sources (business_id, name, display_order, is_active)
    VALUES (p_business_id, v_label, 0, true) RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  SELECT id INTO v_id FROM income_sources
  WHERE business_id = p_business_id AND deleted_at IS NULL
  ORDER BY display_order NULLS LAST, created_at LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO income_sources (business_id, name, display_order, is_active)
  VALUES (p_business_id, 'תשלומי לקוחות', 0, true) RETURNING id INTO v_id;
  RETURN v_id;
END;
$func$;

-- ============================================================================
-- Triggers
-- ============================================================================

-- 1. Recompute invoice.amount_paid + status when links change
CREATE OR REPLACE FUNCTION recompute_customer_invoice_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_invoice_id UUID;
  v_total      NUMERIC;
  v_paid       NUMERIC;
BEGIN
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT total_amount INTO v_total FROM customer_invoices WHERE id = v_invoice_id;
  IF v_total IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT COALESCE(SUM(amount_allocated), 0) INTO v_paid
  FROM customer_payment_invoice_links WHERE invoice_id = v_invoice_id;
  UPDATE customer_invoices
  SET amount_paid = v_paid,
      status = CASE
        WHEN v_paid + 0.01 >= v_total THEN 'paid'
        WHEN v_paid > 0               THEN 'partial'
        ELSE 'open'
      END,
      updated_at = now()
  WHERE id = v_invoice_id;
  RETURN COALESCE(NEW, OLD);
END;
$func$;

DROP TRIGGER IF EXISTS trg_recompute_customer_invoice_balance ON customer_payment_invoice_links;
CREATE TRIGGER trg_recompute_customer_invoice_balance
AFTER INSERT OR UPDATE OR DELETE ON customer_payment_invoice_links
FOR EACH ROW EXECUTE FUNCTION recompute_customer_invoice_balance();

-- 2. On new customer_payment, find/create matching invoice and link
CREATE OR REPLACE FUNCTION auto_link_customer_payment_to_invoice()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_business_id   UUID;
  v_business_type TEXT;
  v_vat           NUMERIC;
  v_is_foreign    BOOLEAN;
  v_retainer      NUMERIC;
  v_invoice_id    UUID;
  v_subtotal      NUMERIC;
  v_vat_amount    NUMERIC;
  v_total         NUMERIC;
  v_alloc         NUMERIC;
  v_payment_month DATE;
BEGIN
  SELECT c.business_id, b.business_type, b.vat_percentage, c.is_foreign, c.retainer_amount
    INTO v_business_id, v_business_type, v_vat, v_is_foreign, v_retainer
  FROM customers c JOIN businesses b ON b.id = c.business_id
  WHERE c.id = NEW.customer_id;
  IF v_business_type IS DISTINCT FROM 'services' THEN RETURN NEW; END IF;
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;

  v_payment_month := date_trunc('month', NEW.payment_date::date)::date;

  -- 1. Existing open/partial invoice for same customer + same calendar month
  SELECT id INTO v_invoice_id FROM customer_invoices
  WHERE customer_id = NEW.customer_id
    AND EXTRACT(YEAR  FROM issue_date) = EXTRACT(YEAR  FROM v_payment_month)
    AND EXTRACT(MONTH FROM issue_date) = EXTRACT(MONTH FROM v_payment_month)
    AND status IN ('open','partial')
    AND deleted_at IS NULL
  ORDER BY issue_date LIMIT 1;

  -- 2. Generate from retainer
  IF v_invoice_id IS NULL AND v_retainer IS NOT NULL AND v_retainer > 0 THEN
    v_subtotal   := v_retainer;
    v_vat_amount := CASE WHEN v_is_foreign THEN 0 ELSE v_subtotal * v_vat END;
    v_total      := v_subtotal + v_vat_amount;
    INSERT INTO customer_invoices (business_id, customer_id, invoice_number, issue_date, subtotal, vat_amount, total_amount, source, status)
    VALUES (v_business_id, NEW.customer_id,
            'AUTO-' || to_char(v_payment_month,'YYYY-MM') || '-' || substr(NEW.customer_id::text,1,6),
            v_payment_month, v_subtotal, v_vat_amount, v_total, 'auto_retainer', 'open')
    RETURNING id INTO v_invoice_id;
  END IF;

  -- 3. Ad-hoc invoice as last resort
  IF v_invoice_id IS NULL THEN
    v_subtotal   := NEW.amount;
    v_vat_amount := CASE WHEN v_is_foreign THEN 0 ELSE v_subtotal * v_vat END;
    v_total      := v_subtotal + v_vat_amount;
    INSERT INTO customer_invoices (business_id, customer_id, invoice_number, issue_date, subtotal, vat_amount, total_amount, source, status)
    VALUES (v_business_id, NEW.customer_id,
            'ADHOC-' || to_char(NEW.payment_date::date,'YYYY-MM-DD') || '-' || substr(NEW.id::text,1,6),
            NEW.payment_date::date, v_subtotal, v_vat_amount, v_total, 'manual', 'open')
    RETURNING id INTO v_invoice_id;
  END IF;

  v_alloc := NEW.amount * (CASE WHEN v_is_foreign THEN 1 ELSE 1 + v_vat END);
  INSERT INTO customer_payment_invoice_links (payment_id, invoice_id, amount_allocated)
  VALUES (NEW.id, v_invoice_id, v_alloc)
  ON CONFLICT (payment_id, invoice_id) DO UPDATE SET amount_allocated = EXCLUDED.amount_allocated;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_auto_link_customer_payment_to_invoice ON customer_payments;
CREATE TRIGGER trg_auto_link_customer_payment_to_invoice
AFTER INSERT ON customer_payments
FOR EACH ROW EXECUTE FUNCTION auto_link_customer_payment_to_invoice();

COMMENT ON FUNCTION resolve_services_income_source(UUID, UUID, TEXT) IS
  'Resolves the income_source_id for a services customer_payment: explicit linked_income_source_id > payment_method-named source (auto-created) > first source for business > auto-created "תשלומי לקוחות".';
COMMENT ON FUNCTION auto_link_customer_payment_to_invoice() IS
  'For services-type customer_payments only: finds the matching customer_invoice (same customer + same month, open/partial), generates one from retainer if missing, or creates an ad-hoc invoice. Inserts a customer_payment_invoice_links row.';
COMMENT ON FUNCTION recompute_customer_invoice_balance() IS
  'Keeps customer_invoices.amount_paid and status in sync with sum of allocations.';
