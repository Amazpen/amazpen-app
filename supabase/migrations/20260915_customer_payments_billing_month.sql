-- Customer payments: separate "which month this payment covers" from
-- "when the money actually arrived", and carry the same payment details the
-- supplier payments form has (reference, receipt file, installments).
--
-- billing_month      first day of the month the payment settles. NULL on
--                    legacy rows -> readers fall back to payment_date's month.
-- reference_number   free-text אסמכתא.
-- receipt_url        uploaded receipt (attachments bucket).
-- installments_count / installment_number
--                    N of M for a payment split into installments.
-- payment_group_id   groups every row written by one "אשר תשלום" click.

ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS billing_month date,
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS installments_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS installment_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS payment_group_id uuid;

CREATE INDEX IF NOT EXISTS customer_payments_billing_month_idx
  ON public.customer_payments (customer_id, billing_month)
  WHERE deleted_at IS NULL;

-- The auto-link trigger used to pick the invoice by payment_date's month.
-- With billing_month present it must link to the month the payment covers,
-- otherwise a September-dated payment for January would open a new
-- September invoice and leave January unpaid.
CREATE OR REPLACE FUNCTION public.auto_link_customer_payment_to_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_cust          UUID;
BEGIN
  v_cust := COALESCE(NEW.customer_id, OLD.customer_id);
  SELECT c.business_id, b.business_type, b.vat_percentage, c.is_foreign, c.retainer_amount
    INTO v_business_id, v_business_type, v_vat, v_is_foreign, v_retainer
  FROM customers c JOIN businesses b ON b.id = c.business_id
  WHERE c.id = v_cust;
  IF v_business_type IS DISTINCT FROM 'services' THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    DELETE FROM customer_payment_invoice_links WHERE payment_id = OLD.id;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM customer_payment_invoice_links WHERE payment_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Month the payment covers: explicit billing_month wins, legacy rows fall
  -- back to the payment date's month.
  v_payment_month := COALESCE(
    date_trunc('month', NEW.billing_month)::date,
    date_trunc('month', NEW.payment_date::date)::date
  );

  SELECT id INTO v_invoice_id FROM customer_invoices
  WHERE customer_id = NEW.customer_id
    AND date_trunc('month', issue_date)::date = v_payment_month
    AND status IN ('open','partial')
    AND deleted_at IS NULL
  ORDER BY issue_date LIMIT 1;

  IF v_invoice_id IS NULL AND v_retainer IS NOT NULL AND v_retainer > 0 THEN
    v_subtotal := v_retainer;
    v_vat_amount := CASE WHEN v_is_foreign THEN 0 ELSE v_subtotal * v_vat END;
    v_total := v_subtotal + v_vat_amount;
    INSERT INTO customer_invoices (business_id, customer_id, invoice_number, issue_date, subtotal, vat_amount, total_amount, source, status)
    VALUES (v_business_id, NEW.customer_id, 'AUTO-' || to_char(v_payment_month,'YYYY-MM') || '-' || substr(NEW.customer_id::text,1,6),
            v_payment_month, v_subtotal, v_vat_amount, v_total, 'auto_retainer', 'open')
    RETURNING id INTO v_invoice_id;
  END IF;

  IF v_invoice_id IS NULL THEN
    v_subtotal := NEW.amount;
    v_vat_amount := CASE WHEN v_is_foreign THEN 0 ELSE v_subtotal * v_vat END;
    v_total := v_subtotal + v_vat_amount;
    INSERT INTO customer_invoices (business_id, customer_id, invoice_number, issue_date, subtotal, vat_amount, total_amount, source, status)
    VALUES (v_business_id, NEW.customer_id, 'ADHOC-' || to_char(COALESCE(NEW.billing_month, NEW.payment_date::date),'YYYY-MM-DD') || '-' || substr(NEW.id::text,1,6),
            COALESCE(NEW.billing_month, NEW.payment_date::date), v_subtotal, v_vat_amount, v_total, 'manual', 'open')
    RETURNING id INTO v_invoice_id;
  END IF;

  v_alloc := NEW.amount * (CASE WHEN v_is_foreign THEN 1 ELSE 1 + v_vat END);

  INSERT INTO customer_payment_invoice_links (payment_id, invoice_id, amount_allocated)
  VALUES (NEW.id, v_invoice_id, v_alloc)
  ON CONFLICT (payment_id, invoice_id) DO UPDATE SET amount_allocated = EXCLUDED.amount_allocated;

  RETURN NEW;
END;
$function$;
