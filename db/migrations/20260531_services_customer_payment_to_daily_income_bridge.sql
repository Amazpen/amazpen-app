-- Bridge: customer_payments -> daily_income_breakdown + daily_entries.total_register
-- Services businesses only (business_type='services'). No-op for restaurant/manufacturing.
--
-- Convention:
--   customer_payments.amount         = pre-VAT (net) as user enters in services UI
--   daily_income_breakdown.amount    = gross (VAT-inclusive)
--   daily_entries.total_register     = gross (VAT-inclusive)
--
-- Idempotent under UPDATE (reverses OLD then applies NEW).
-- Soft-delete (deleted_at NOT NULL) treated as DELETE.
--
-- Income source resolution order:
--   1. customer.linked_income_source_id
--   2. First active income_source for the business
--   3. Auto-create "תשלומי לקוחות" income_source

CREATE OR REPLACE FUNCTION bridge_customer_payment_to_daily_income()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_target_customer UUID;
  v_business_id     UUID;
  v_business_type   TEXT;
  v_vat             NUMERIC;
  v_is_foreign      BOOLEAN;
  v_source_id       UUID;
  v_daily_entry_id  UUID;
  v_gross           NUMERIC;
  v_old_gross       NUMERIC;
  v_dow             INT;
  v_schedule_factor NUMERIC;
  v_exception_factor NUMERIC;
  v_factor          NUMERIC;
  v_target_date     DATE;
  v_breakdown_id    UUID;
  v_was_active_old  BOOLEAN;
  v_was_active_new  BOOLEAN;
BEGIN
  v_target_customer := COALESCE(NEW.customer_id, OLD.customer_id);

  SELECT c.business_id, b.business_type, b.vat_percentage, c.is_foreign, c.linked_income_source_id
    INTO v_business_id, v_business_type, v_vat, v_is_foreign, v_source_id
  FROM customers c
  JOIN businesses b ON b.id = c.business_id
  WHERE c.id = v_target_customer;

  IF v_business_type IS DISTINCT FROM 'services' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_source_id IS NULL THEN
    SELECT id INTO v_source_id
    FROM income_sources
    WHERE business_id = v_business_id AND deleted_at IS NULL
    ORDER BY display_order NULLS LAST, created_at
    LIMIT 1;

    IF v_source_id IS NULL THEN
      INSERT INTO income_sources (business_id, name, display_order, is_active)
      VALUES (v_business_id, 'תשלומי לקוחות', 0, true)
      RETURNING id INTO v_source_id;
    END IF;
  END IF;

  v_was_active_old := (TG_OP IN ('UPDATE','DELETE')) AND OLD.deleted_at IS NULL;
  v_was_active_new := (TG_OP IN ('INSERT','UPDATE')) AND NEW.deleted_at IS NULL;

  IF v_was_active_old THEN
    v_old_gross := OLD.amount * (CASE WHEN v_is_foreign THEN 1 ELSE 1 + v_vat END);
    v_target_date := OLD.payment_date::date;

    SELECT id INTO v_daily_entry_id
    FROM daily_entries
    WHERE business_id = v_business_id
      AND entry_date  = v_target_date
      AND deleted_at IS NULL
    LIMIT 1;

    IF v_daily_entry_id IS NOT NULL THEN
      UPDATE daily_income_breakdown
      SET amount       = GREATEST(COALESCE(amount,0) - v_old_gross, 0),
          orders_count = GREATEST(COALESCE(orders_count,0) - 1, 0)
      WHERE daily_entry_id = v_daily_entry_id
        AND income_source_id = v_source_id;

      UPDATE daily_entries
      SET total_register = GREATEST(COALESCE(total_register,0) - v_old_gross, 0)
      WHERE id = v_daily_entry_id;
    END IF;
  END IF;

  IF v_was_active_new THEN
    v_gross := NEW.amount * (CASE WHEN v_is_foreign THEN 1 ELSE 1 + v_vat END);
    v_target_date := NEW.payment_date::date;

    SELECT id INTO v_daily_entry_id
    FROM daily_entries
    WHERE business_id = v_business_id
      AND entry_date  = v_target_date
      AND deleted_at IS NULL
    LIMIT 1;

    IF v_daily_entry_id IS NULL THEN
      v_dow := EXTRACT(DOW FROM v_target_date)::int;

      SELECT day_factor INTO v_exception_factor
      FROM business_day_exceptions
      WHERE business_id = v_business_id
        AND exception_date = v_target_date
      LIMIT 1;

      IF v_exception_factor IS NOT NULL THEN
        v_factor := v_exception_factor;
      ELSE
        SELECT day_factor INTO v_schedule_factor
        FROM business_schedule
        WHERE business_id = v_business_id
          AND day_of_week = v_dow
        LIMIT 1;
        v_factor := COALESCE(v_schedule_factor, 1);
      END IF;

      INSERT INTO daily_entries
        (business_id, entry_date, total_register, day_factor, data_source, is_fully_approved)
      VALUES
        (v_business_id, v_target_date, 0, v_factor, 'api', true)
      RETURNING id INTO v_daily_entry_id;
    END IF;

    SELECT id INTO v_breakdown_id
    FROM daily_income_breakdown
    WHERE daily_entry_id   = v_daily_entry_id
      AND income_source_id = v_source_id
    LIMIT 1;

    IF v_breakdown_id IS NULL THEN
      INSERT INTO daily_income_breakdown
        (daily_entry_id, income_source_id, amount, orders_count)
      VALUES
        (v_daily_entry_id, v_source_id, v_gross, 1);
    ELSE
      UPDATE daily_income_breakdown
      SET amount       = COALESCE(amount,0) + v_gross,
          orders_count = COALESCE(orders_count,0) + 1
      WHERE id = v_breakdown_id;
    END IF;

    UPDATE daily_entries
    SET total_register = COALESCE(total_register,0) + v_gross
    WHERE id = v_daily_entry_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$func$;

DROP TRIGGER IF EXISTS trg_bridge_customer_payment ON customer_payments;
CREATE TRIGGER trg_bridge_customer_payment
AFTER INSERT OR UPDATE OR DELETE ON customer_payments
FOR EACH ROW EXECUTE FUNCTION bridge_customer_payment_to_daily_income();

COMMENT ON FUNCTION bridge_customer_payment_to_daily_income() IS
  'Mirrors customer_payments into daily_income_breakdown + daily_entries.total_register for services-type businesses only. Multiplies amount by (1+vat_percentage) unless customer.is_foreign.';
