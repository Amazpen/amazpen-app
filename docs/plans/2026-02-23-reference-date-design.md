# Reference Date (תאריך אסמכתא) for Expenses

**Date:** 2026-02-23

## Problem

Expenses have an `invoice_date` representing the billing period, but no field for when the actual document (invoice/receipt) was issued. Example: Bezeq invoice for January 2026 (`invoice_date = 31.01.26`) was issued on February 15 (`reference_date = 15.02.26`).

## Design

### Database
- New column `reference_date DATE NULL` on `invoices` table
- No default value, existing rows remain `NULL`

### Add Expense Form
- Optional date picker "תאריך אסמכתא" below "תאריך חשבונית"
- Same date picker component as existing date fields
- Default: empty

### Edit Expense Form
- Same field in edit popup, loaded/saved with other fields

### Expense Filtering
- New filter option "תאריך אסמכתא" for filtering by reference date range

### Display
- Shown in supplier breakdown popup next to invoice date (only when populated)

### API
- Optional `reference_date` field in `/api/intake/expense` POST body

### Out of Scope
- No impact on calculations, reports, or business logic
- No impact on existing expenses (remain `NULL`)
- No change to sort order
