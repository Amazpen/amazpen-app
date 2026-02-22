# Data Approval System — Design Document

**Date:** 2026-02-22
**Status:** Approved
**Scope:** Next.js client-side only (n8n pipeline exists separately)

---

## Problem

Daily business data (Z-report, labor costs, managed products) enters the system and goes live immediately. There is no approval workflow — no "gray/pending" state, no per-field approval, no reminders for missing data. Invoices and payments from external sources (WhatsApp, email) also lack a review step before appearing in dashboards.

## Solution Overview

Build a per-field approval system for daily entries, invoices, and payments. Data entering from automated sources (n8n via WhatsApp/email) starts in "pending" status (displayed as gray). Admins (שני/דוד) can approve individual fields. An AI agent ("דדי") sends reminders for missing or unapproved data.

---

## 1. Database Schema Changes

### 1.1 New Table: `daily_entry_approvals`

Tracks per-field approval status for each daily entry.

```sql
CREATE TABLE daily_entry_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_entry_id UUID NOT NULL REFERENCES daily_entries(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ocr', 'whatsapp', 'email', 'api')),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(daily_entry_id, field_name)
);

CREATE INDEX idx_dea_daily_entry ON daily_entry_approvals(daily_entry_id);
CREATE INDEX idx_dea_business_pending ON daily_entry_approvals(business_id, status) WHERE status = 'pending';
```

**field_name values:**
- `total_register` — סה"כ קופה
- `labor_cost` — עלות עובדים
- `labor_hours` — שעות עובדים
- `discounts` — הנחות
- `food_cost` — עלות מכר (computed)
- `current_expenses` — הוצאות שוטפות (computed)
- `avg_private` — ממוצע פרטי (computed)
- `avg_business` — ממוצע עסקי (computed)
- `managed_product_{id}` — מוצר מנוהל ספציפי
- `income_source_{id}` — מקור הכנסה ספציפי

### 1.2 Alter `daily_entries`

```sql
ALTER TABLE daily_entries
  ADD COLUMN data_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (data_source IN ('manual', 'ocr', 'whatsapp', 'email', 'api')),
  ADD COLUMN is_fully_approved BOOLEAN NOT NULL DEFAULT true;
```

- `data_source = 'manual'` → `is_fully_approved = true` (manual entries are auto-approved)
- `data_source IN ('whatsapp', 'email', 'api', 'ocr')` → `is_fully_approved = false` until all fields approved

### 1.3 Alter `invoices`

```sql
ALTER TABLE invoices
  ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending_review', 'approved')),
  ADD COLUMN data_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (data_source IN ('manual', 'ocr', 'whatsapp', 'email', 'api')),
  ADD COLUMN review_approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN review_approved_at TIMESTAMPTZ;
```

### 1.4 Alter `payments`

```sql
ALTER TABLE payments
  ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending_review', 'approved')),
  ADD COLUMN data_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (data_source IN ('manual', 'ocr', 'whatsapp', 'email', 'api')),
  ADD COLUMN review_approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN review_approved_at TIMESTAMPTZ;
```

### 1.5 New Table: `data_reminders`

Tracks sent reminders to avoid duplicates.

```sql
CREATE TABLE data_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('missing_daily', 'pending_approval', 'missing_invoices')),
  reference_date DATE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_to TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('push', 'whatsapp', 'email')),
  UNIQUE(business_id, reminder_type, reference_date, sent_to)
);
```

---

## 2. API Endpoints

### 2.1 Intake Endpoints (for n8n)

**`POST /api/intake/daily-entry`**
- Auth: API key header (`X-API-Key`)
- Body: `{ business_id, entry_date, total_register, labor_cost, labor_hours, discounts, source, income_data?, receipt_data?, product_usage? }`
- Creates `daily_entries` row with `data_source` and `is_fully_approved = false`
- Creates `daily_entry_approvals` rows for each field with `status = 'pending'`
- Returns: `{ id, fields_count }`

**`POST /api/intake/expense`**
- Auth: API key header
- Body: `{ business_id, supplier_id, invoice_number, invoice_date, total_amount, vat_amount, source, attachment_url?, line_items? }`
- Creates `invoices` row with `approval_status = 'pending_review'`
- Triggers price tracking for line items
- Returns: `{ id }`

**`POST /api/intake/payment`**
- Auth: API key header
- Body: `{ business_id, supplier_id, amount, payment_method, reference_number, source }`
- Creates `payments` + `payment_splits` with `approval_status = 'pending_review'`
- Returns: `{ id }`

### 2.2 Approval Endpoints

**`POST /api/approvals/daily-entry`**
- Auth: Supabase JWT (admin only)
- Body: `{ daily_entry_id, fields: [{ field_name, approve: boolean }] }`
- Updates `daily_entry_approvals` for specified fields
- If all fields approved → sets `daily_entries.is_fully_approved = true`

**`POST /api/approvals/invoice`**
- Auth: Supabase JWT (admin only)
- Body: `{ invoice_id }`
- Sets `invoices.approval_status = 'approved'`, `review_approved_by`, `review_approved_at`

**`POST /api/approvals/payment`**
- Auth: Supabase JWT (admin only)
- Body: `{ payment_id }`
- Sets `payments.approval_status = 'approved'`, `review_approved_by`, `review_approved_at`

**`GET /api/approvals/pending?business_id=X`**
- Returns all pending approvals: daily entry fields, invoices, payments

### 2.3 Reminder Endpoints

**`GET /api/reminders/check-missing`**
- Auth: API key or cron secret
- Checks for each active business:
  1. Missing daily_entry for yesterday
  2. Fields pending > 24 hours
  3. End of month: missing supplier invoices
- Returns list of missing items per business

**`POST /api/reminders/send`**
- Auth: API key or cron secret
- Sends push notifications for missing data
- Records in `data_reminders` to prevent duplicates

---

## 3. UI Changes

### 3.1 Dashboard Metric Cards — Gray State

**CSS addition in globals.css:**
```css
.data-card-pending {
  background-color: rgb(60, 65, 80) !important;
  opacity: 0.85;
}
.data-card-pending .value-text {
  color: rgba(255, 255, 255, 0.5) !important;
}
```

**Logic per card:**
- Fetch `daily_entry_approvals` for current month entries
- For each metric card, check if its field_name has any `status = 'pending'` records
- If pending → add `data-card-pending` class + "ממתין לאישור" badge
- Cards: סה"כ הכנסות, עלות עובדים, עלות מכר, הוצאות שוטפות, ממוצע פרטי/עסקי, מוצר מנוהל

### 3.2 Business Cards — Pending Indicator

- Orange dot next to business name if ANY fields are pending for current month
- Tooltip: "X שדות ממתינים לאישור"

### 3.3 Approval Modal (Admin Only)

New component: `ApprovalModal.tsx`

**Trigger:** Admin clicks a gray metric card
**Content:**
- Date range selector (defaults to entries with pending fields)
- List of daily entries with pending fields
- Each entry shows: date, all field values
- Per-field toggle: ✓ approve / keep pending
- "Approve All" button at top
- "Approve Selected" button at bottom
- Real-time update via Supabase subscription

### 3.4 Expenses Page — Gray State

- Invoices with `approval_status = 'pending_review'` display with:
  - Gray background row (instead of normal)
  - Badge: "ממתין לבדיקה" in gray
  - Admin can click → approve button appears

### 3.5 Payments — Gray State

- Similar to invoices: gray rows for `approval_status = 'pending_review'`
- Approve button for admins

### 3.6 Notification Badge

- In the dashboard header/sidebar: bell icon with count of total pending items
- Clicking opens a summary panel: X daily fields + Y invoices + Z payments pending

---

## 4. Reminders System ("דדי")

### 4.1 Missing Data Detection

For each active business, daily at configurable time:
1. **Missing daily entry** — no `daily_entries` row for yesterday → push to business owner
2. **Pending approval > 24h** — fields in `daily_entry_approvals` with `status = 'pending'` and `created_at < now() - 24h` → push to admins
3. **End of month missing invoices** — check which regular suppliers have no invoice this month → push to business owner

### 4.2 Notification Channels

- **Push notification** (existing infrastructure via `web-push`)
- **Future: WhatsApp** (via n8n webhook, not built now)
- **Future: Email** (via n8n webhook, not built now)

### 4.3 Deduplication

`data_reminders` table prevents sending the same reminder twice for the same business + date + type.

---

## 5. Security

- Intake API endpoints authenticated via `X-API-Key` header (stored in env: `INTAKE_API_KEY`)
- Approval endpoints require Supabase JWT + admin role check
- RLS policies on new tables: admins can read/write, business owners can read only
- Reminder endpoints authenticated via `CRON_SECRET` header

---

## 6. Data Flow Summary

```
[n8n: WhatsApp/Email/Form]
    ↓ POST /api/intake/daily-entry
    ↓ POST /api/intake/expense
    ↓ POST /api/intake/payment
    ↓
[Supabase: data stored with status=pending]
    ↓
[Dashboard: gray cards, gray invoice/payment rows]
    ↓
[Admin clicks gray card → Approval Modal]
    ↓ POST /api/approvals/daily-entry (per-field)
    ↓ POST /api/approvals/invoice
    ↓ POST /api/approvals/payment
    ↓
[Cards return to normal colors]

[Cron/n8n: daily check]
    ↓ GET /api/reminders/check-missing
    ↓ POST /api/reminders/send
    ↓
[Push notification to business owner / admin]
```

---

## 7. Existing Behavior — No Breaking Changes

- **Manual entries** (`data_source = 'manual'`): auto-approved, no gray state, behaves exactly as today
- **OCR entries**: continue through existing OCR queue. After OCR approval, if `data_source = 'ocr'` they get `is_fully_approved = false` and go through the new approval flow
- **Existing invoices/payments**: default `approval_status = 'approved'`, no change
- **Dashboard calculations**: use ALL data (pending + approved) for calculations, but display pending fields as gray
