# תשלום חלקי לספקים (Partial Payment) — Design Spec

**Date:** 2026-07-12
**Status:** Approved design, pending implementation plan
**Side:** Supplier invoices (expenses) only — the business pays. NOT customer invoices.

## Problem

Suppliers ("customers who make a mess") pay in irregular lump sums that don't match
any single invoice. A payment of ₪X should close the oldest open invoices in full and
leave exactly one invoice with a leftover balance, clearly flagged, so the user can see
"how much is still open, and on which invoice" — including on the OCR screen.

## Existing infrastructure (reuse, do not rebuild)

- `invoices.status` DB enum already includes `'partial'` — **unused for supplier invoices today**
  (code uses `'pending'`, `'paid'`, `'clarification'`).
- `payment_invoice_links.amount_allocated` already allows allocating **less** than an
  invoice's total. This is the partial-allocation primitive.
- The "ממתינים לתשלום" report (`payments/page.tsx` `fetchPendingPayments`, ~:2014-2161)
  already computes `balance = total − Σ amount_allocated` and shows the leftover.
- `invoices.amount_paid` column exists but is "unreliable / rarely written" — we will
  start writing it **only for partial invoices** (for display robustness), while links
  stay the source of truth for the report.

## Chosen approach: A — links as source of truth

One `payment` row for the lump sum + FIFO allocation via `payment_invoice_links`.
Fully-covered invoices → `status='paid'`; the one leftover invoice → `status='partial'`
+ `amount_paid` = amount allocated to it. Minimal new code; builds on what exists.

Rejected: **B** (amount_paid-only, no links — requires rewriting the report) and
**C** (separate partial_payments table — competing source of truth).

## Architecture

### Shared component: `PartialPaymentModal`
A single calculation modal, opened from **two** entry points:
1. **Payment screen, by supplier** — pick a supplier → see all their open invoices.
2. **"ממתינים לתשלום" report** — select invoices via existing multi-select → "תשלום חלקי" button.

Both feed the same open-invoice list and the same save logic.

### Modal contents
- Open invoices of the supplier, sorted **oldest → newest**, each with a checkbox
  (default: all checked). Unchecking = the manual-override the user asked for.
- Three figures: **סכום החשבוניות שנבחרו** | **סכום התשלום** (input) | **נותר לתשלום**
  (= selected − paid).
- Live preview: which invoices close in full, and which single invoice becomes
  "תשלום חלקי" (yellow) with its remaining balance.
- Payment method + date fields (required — cashflow reads `payment_splits.due_date`).

## Allocation logic (on save)

Given `paymentAmount` and the checked invoices sorted oldest → newest:
1. Iterate oldest-first. While `remaining ≥ invoice.balance`: close in full
   (`amount_allocated = balance`, `status='paid'`), subtract from `remaining`.
2. First invoice where `remaining < balance`: `amount_allocated = remaining`,
   `status='partial'`, `amount_paid += remaining`. Remaining invoices stay `pending`.
3. Persist: one `payment` + `payment_splits` (method + date) + `payment_invoice_links`
   for every invoice that received an allocation.

**No ₪5 tolerance** here (unlike the regular pay flow) — allocation is exact to the
entered amount.

### Edge cases
- `paid == selected sum` → all `paid`, no partial invoice.
- `paid > selected sum` → **block save** with message ("שילמת יותר מהחוב הפתוח") —
  overpayment/credit is a separate concern, not solved here.
- `paid < balance of oldest invoice` → only the oldest becomes `partial`, rest stay open.
- `paid == 0` or no invoices checked → save disabled.

## `partial` status — every screen that must change

Screens that list open invoices filter `status IN ('pending','clarification')`. Without
adding `'partial'`, a partial invoice **disappears** and its debt vanishes. Must include
`'partial'` in:
- Open-invoice query in `OCRForm.tsx` (~:681).
- Supplier open-total in `src/lib/metrics/suppliers.ts` (`getSupplierDetail` ~:342,
  and check `getSupplierMonthly` ~:271).
- Any expenses/payments list status filter that excludes non-pending.

Display changes:
- **OCR screen** — for a `partial` invoice show the **remaining** (`total − amount_paid`),
  not the full total, so "how much is still open, on which invoice" is visible.
- **Status badge** — new yellow badge labeled **"תשלום חלקי"** in the status columns
  (payments, pending-payments, expenses). Follow the existing customer-invoice partial
  pattern (`customers/page.tsx`) for reference styling.

## Out of scope (YAGNI)

- Overpayment / supplier credit balance handling.
- Editing/undoing a partial payment beyond the existing payment edit/delete flow
  (existing edit path already rebuilds links; verify it doesn't strand a `partial` status
  when a payment is deleted — a partial invoice whose payment is removed must revert to
  `pending`).
- Customer-side partial payments (already implemented separately).

## Testing / verification

- Unit: allocation function — full match, leftover-on-last, paid-below-first, overpay-block,
  unchecked-invoice exclusion, oldest-first ordering.
- In-app: create a supplier with 3 open invoices, pay a lump sum between invoice #1 and #2
  totals → #1 `paid`, #2 `partial` (yellow, correct remaining), #3 `pending`; verify the
  pending report, supplier open-total, and OCR screen all show the correct remaining.
- Verify deleting the partial payment reverts statuses.
