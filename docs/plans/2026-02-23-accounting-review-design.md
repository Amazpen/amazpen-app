# Accounting Review Page Design

## Overview

Admin-only page for reviewing and registering invoices in the accounting system (הנה"ח).
Allows admin to select a business, browse invoices by date range, view attached documents,
mark invoices as registered, and download documents or export to CSV.

## Route

`/admin/accounting-review`

## Layout

Two-panel layout (like the Bubble reference):

- **Right sidebar (250px)**: Business list for single-business selection
- **Main area (left)**: Date filters + invoice table + action bar

**Important**: Since our app is proper RTL (`dir="rtl"`), the Bubble reference used `row-reverse`
to simulate RTL. We use standard RTL flow — no `row-reverse` hacks needed.

## Components

### 1. Business Sidebar (Right)

- Title: "בחירת עסק"
- Scrollable list of all businesses from `businesses` table
- Selected business highlighted with `bg-primary` style
- Persist selection via `usePersistedState`

### 2. Date Range Filter (Top)

- Two date inputs: "תאריך התחלה" and "תאריך סיום"
- Filters `invoice_date` range
- Default: current month (1st to today)

### 3. Invoice Table

Columns (RTL order, right to left):

| Column | Field | Notes |
|--------|-------|-------|
| Checkbox | — | Multi-select |
| תאריך | `invoice_date` | Sortable, DD/MM/YY format |
| ספק | `suppliers.name` | JOIN |
| אסמכתא | `invoice_number` | — |
| סכום לפני מע"מ | `subtotal` | ₪ formatted |
| סכום אחרי מע"מ | `total_amount` | ₪ formatted |
| נרשם בהנה"ח | `approval_status` | Dropdown: כן/לא |

- Header row with "select all" checkbox
- Date column sortable (ascending/descending toggle)
- Row click opens detail panel (excluding checkbox/dropdown clicks)

### 4. Invoice Detail Panel

Opens as a slide-over or expanded row showing:

- Full invoice details (all fields)
- Notes (`notes` field)
- `clarification_reason` if present
- Attached document viewer using existing `DocumentViewer` component
- Shows `attachment_url` content (PDF or image)

### 5. Action Bar (Bottom/Floating)

Visible when 1+ invoices selected:

- **"הורד מסמכים"** — Downloads `attachment_url` files for selected invoices
  - Single file: direct download
  - Multiple files: ZIP download (client-side via JSZip)
- **"ייצא ל-CSV"** — Exports selected invoice data to CSV file
  - Columns: תאריך, ספק, אסמכתא, סכום לפני מע"מ, סכום אחרי מע"מ, נרשם בהנה"ח, הערות

## Data Flow

### Query

```sql
SELECT i.*, s.name as supplier_name
FROM invoices i
JOIN suppliers s ON i.supplier_id = s.id
WHERE i.business_id = :businessId
  AND i.deleted_at IS NULL
  AND i.invoice_date >= :startDate
  AND i.invoice_date <= :endDate
ORDER BY i.invoice_date DESC
```

### Update (marking as registered)

```sql
UPDATE invoices
SET approval_status = 'accounting_approved',
    review_approved_by = :userId,
    review_approved_at = NOW()
WHERE id = :invoiceId
```

Unmark:

```sql
UPDATE invoices
SET approval_status = NULL,
    review_approved_by = NULL,
    review_approved_at = NULL
WHERE id = :invoiceId
```

## Styling

- Matches existing dark theme (forced globally)
- Uses shadcn/ui components: Table, Button, Select, Checkbox
- Date inputs match existing app pattern
- Border color: `rgba(255, 255, 255, 0.1)`
- Font: Assistant (Hebrew), 16px body, bold headers
- Business list item hover/selected states consistent with app

## Access Control

- Admin-only: page checks `isAdmin` from `DashboardContext`
- Redirects non-admin users
- Uses existing admin menu integration in dashboard layout

## File Structure

```
src/app/(dashboard)/admin/accounting-review/page.tsx  — Main page component
```

Single file, consistent with other admin pages (admin/expenses, admin/payments).
