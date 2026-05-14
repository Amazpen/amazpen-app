-- 2026-05-14: supplier_balance view — count unlinked delivery notes as debt.
--
-- BEFORE: total_invoiced summed only `invoices.total_amount` (minus cancelled),
-- so suppliers whose monthly activity comes in as תעודות משלוח without an
-- invoice yet showed `balance = 0` even though goods were received and
-- nothing has been paid. This made the supplier-list "פתוח לתשלום" card
-- read ₪0.01 for נ.נ אריה-ספק (פרגו נס ציונה) while May 2026 had ₪7,739.57
-- of open DNs.
--
-- AFTER: total_invoiced = invoices (non-cancelled) + unlinked delivery notes
--        (invoice_id IS NULL). Once a DN gets consolidated into an invoice it
--        stops counting on the DN side and the invoice amount takes over, so
--        this can't double-count an obligation.
--
-- pending_balance is intentionally unchanged — it should keep meaning "open
-- invoices only" so the AI chat tool and other consumers that distinguish
-- "in-invoice debt" from "raw goods received" still have that signal.
--
-- Applied directly via supabase MCP on 2026-05-14 (no migrations table in
-- this DB). File kept for traceability + future repro.

CREATE OR REPLACE VIEW supplier_balance AS
SELECT s.id AS supplier_id,
    s.business_id,
    s.name AS supplier_name,
    s.expense_type,
    COALESCE(inv.total_invoiced, 0::numeric) + COALESCE(dn.total_unlinked_dns, 0::numeric) AS total_invoiced,
    COALESCE(pay.total_paid, 0::numeric) AS total_paid,
    (COALESCE(inv.total_invoiced, 0::numeric) + COALESCE(dn.total_unlinked_dns, 0::numeric)) - COALESCE(pay.total_paid, 0::numeric) AS balance,
    COALESCE(pending.pending_total, 0::numeric) AS pending_balance
   FROM suppliers s
     LEFT JOIN ( SELECT invoices.supplier_id,
            sum(invoices.total_amount) AS total_invoiced
           FROM invoices
          WHERE invoices.deleted_at IS NULL AND invoices.status <> 'cancelled'::text
          GROUP BY invoices.supplier_id) inv ON s.id = inv.supplier_id
     LEFT JOIN ( SELECT delivery_notes.supplier_id,
            sum(delivery_notes.total_amount) AS total_unlinked_dns
           FROM delivery_notes
          WHERE delivery_notes.invoice_id IS NULL
          GROUP BY delivery_notes.supplier_id) dn ON s.id = dn.supplier_id
     LEFT JOIN ( SELECT payments.supplier_id,
            sum(payments.total_amount) AS total_paid
           FROM payments
          WHERE payments.deleted_at IS NULL
          GROUP BY payments.supplier_id) pay ON s.id = pay.supplier_id
     LEFT JOIN ( SELECT invoices.supplier_id,
            sum(invoices.total_amount - COALESCE(invoices.amount_paid, 0::numeric)) AS pending_total
           FROM invoices
          WHERE invoices.deleted_at IS NULL AND (invoices.status <> ALL (ARRAY['paid'::text, 'cancelled'::text, 'credited'::text]))
          GROUP BY invoices.supplier_id) pending ON s.id = pending.supplier_id
  WHERE s.deleted_at IS NULL;
