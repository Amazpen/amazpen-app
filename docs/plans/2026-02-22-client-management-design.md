# Client Management & Retainer Income — Design Document

**Date:** 2026-02-22
**Status:** Approved
**Scope:** Next.js client-side — upgrade existing customers page + retainer income automation

---

## Problem

The app has a basic customers table and page (`/admin/customers`) but no retainer/subscription management. Service-based businesses (like consulting firms) need to:
- Define recurring income per client (retainer)
- Have that income enter the dashboard automatically each month
- Track retainer status (active, paused, completed)
- Distinguish client income pages visually from expense pages

## Solution

Upgrade the existing customers system with retainer fields. Each retainer creates an `income_source` automatically, so retainer income flows through the existing daily entry → dashboard pipeline without changes to dashboard code.

---

## 1. Database Changes

### 1.1 Alter `customers` — new retainer fields

```sql
ALTER TABLE customers
  ADD COLUMN retainer_amount NUMERIC,
  ADD COLUMN retainer_type TEXT CHECK (retainer_type IN ('monthly', 'one_time', 'fixed_term')),
  ADD COLUMN retainer_months INTEGER,
  ADD COLUMN retainer_start_date DATE,
  ADD COLUMN retainer_end_date DATE,
  ADD COLUMN retainer_day_of_month INTEGER DEFAULT 1,
  ADD COLUMN retainer_status TEXT DEFAULT 'active' CHECK (retainer_status IN ('active', 'paused', 'completed')),
  ADD COLUMN linked_income_source_id UUID REFERENCES income_sources(id);
```

- `retainer_amount` — amount before VAT
- `retainer_type` — monthly (ongoing until stopped), one_time, fixed_term (X months)
- `retainer_months` — only for fixed_term
- `retainer_day_of_month` — which day of month income is recorded (1-28)
- `retainer_status` — active/paused/completed
- `linked_income_source_id` — auto-created income_source for this client

### 1.2 New table: `customer_retainer_entries`

Tracks which months have been processed to prevent duplicates.

```sql
CREATE TABLE customer_retainer_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  entry_month DATE NOT NULL,
  amount NUMERIC NOT NULL,
  daily_income_breakdown_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id, entry_month)
);

CREATE INDEX idx_cre_customer ON customer_retainer_entries(customer_id);
```

### 1.3 RLS Policies

```sql
-- customer_retainer_entries: same pattern as customers
ALTER TABLE customer_retainer_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view retainer entries" ON customer_retainer_entries
  FOR SELECT USING (
    customer_id IN (
      SELECT c.id FROM customers c
      JOIN business_members bm ON bm.business_id = c.business_id
      WHERE bm.user_id = auth.uid() AND bm.deleted_at IS NULL
    )
  );

CREATE POLICY "Admins can manage retainer entries" ON customer_retainer_entries
  FOR ALL USING (
    customer_id IN (
      SELECT c.id FROM customers c
      JOIN business_members bm ON bm.business_id = c.business_id
      WHERE bm.user_id = auth.uid() AND bm.role = 'admin' AND bm.deleted_at IS NULL
    )
  );
```

---

## 2. Logic

### 2.1 Creating a customer with retainer

When a customer is saved with `retainer_amount > 0`:
1. Create `income_source` with name "ריטיינר — {customer.business_name}", `income_type = 'business'`, `input_type = 'single'`
2. Store the income_source ID in `linked_income_source_id`

### 2.2 Monthly retainer processing

API route: `POST /api/retainers/process`
- Auth: API key or cron secret
- Iterates customers where `retainer_status = 'active'` and `retainer_day_of_month = today`
- Checks `customer_retainer_entries` for current month (prevents duplicates)
- Finds or creates `daily_entry` for today
- Inserts into `daily_income_breakdown` with the linked income_source_id
- Amount = `retainer_amount × (1 + business.vat_percentage / 100)`
- Records in `customer_retainer_entries`
- For `fixed_term`: after reaching `retainer_months`, sets `retainer_status = 'completed'`

### 2.3 Pausing / stopping

- User sets `retainer_status = 'paused'` → processing skips this customer
- User sets `retainer_status = 'completed'` → processing skips, shown as finished in UI

---

## 3. UI Changes

### 3.1 Purple theme for customers page

The customers page switches from blue to purple:
- Card backgrounds, buttons, badges, accents use purple tones
- Visually distinguishes income (clients) from expenses (suppliers)

### 3.2 Customer form — new fields

Added to the existing creation/edit form:
- **סכום ריטיינר** — numeric input, shows "₪ X + מע"מ = ₪ Y" in real time
- **סוג תשלום** — dropdown: ריטיינר חודשי / חד פעמי / מתמשך ל-X חודשים
- **כמות חודשים** — shown only when "מתמשך" is selected
- **יום חיוב בחודש** — dropdown 1-28
- **תאריך תחילת ריטיינר** — date picker

### 3.3 Customer card in list

- Shows: name, retainer amount, status badge
- Status badges: פעיל (green), מושהה (orange), הסתיים (gray)

### 3.4 Customer detail popup

Upgraded with:
- Retainer summary: amount, type, status, months remaining (for fixed_term)
- Payment history (existing `customer_payments` table)
- Action buttons: השהה ריטיינר / חדש ריטיינר / עצור

---

## 4. Dashboard Integration

Retainer income enters through the existing pipeline:
- `income_source` → `daily_income_breakdown` → dashboard aggregation
- No changes needed to dashboard code
- Retainer income appears in total income, charts, comparisons automatically

---

## 5. Existing Behavior — No Breaking Changes

- Current customers with no retainer fields: work exactly as before (all new columns are nullable)
- Existing income_sources: unchanged
- Dashboard calculations: unchanged (retainer income is just another income_source)
- Manual daily entries: unchanged
