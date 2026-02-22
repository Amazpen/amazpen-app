# Client Additions — Design Document

**Date:** 2026-02-22
**Status:** Approved
**Scope:** Three additions to the client management system

---

## 1. Extra Products/Services per Client

### Problem
Clients may purchase additional services beyond their retainer (e.g., product tree for Perla, survey system for Fargo NC). Currently there's no way to record these one-off sales.

### Solution

**New table: `customer_services`**
```sql
CREATE TABLE customer_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  service_date DATE NOT NULL,
  notes TEXT,
  linked_income_source_id UUID REFERENCES income_sources(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
```

Each service sale creates an `income_source` and a `daily_income_breakdown` entry (like retainers), so it appears on the dashboard automatically.

### UI
In the customer detail popup, new section "מוצרים ושירותים":
- List of past sales with name, amount, date
- "הוסף מוצר/שירות" button → form with: name, amount (before VAT with auto-calc), date, notes
- Total summary at bottom

---

## 2. Labor Cost per Client

### Problem
Service businesses need to track employee cost per client. Some pay global salary (divided by work days), others pay hourly.

### Solution

**New columns on `customers`:**
```sql
ALTER TABLE customers
  ADD COLUMN labor_type TEXT CHECK (labor_type IN ('global', 'hourly')),
  ADD COLUMN labor_monthly_salary NUMERIC,
  ADD COLUMN labor_hourly_rate NUMERIC;
```

- `global`: monthly salary ÷ work days = daily cost
- `hourly`: rate × hours = daily cost (hours entered per day)

### UI
In customer setup form:
- Select: גלובלי / שעתי
- If global: monthly salary field
- If hourly: hourly rate field

Labor data stored on customer record. Display in customer detail popup.

---

## 3. Exit Survey for Churned Clients

### Problem
When a retainer ends, the business owner doesn't know why the client left. Need a short survey to gather feedback.

### Solution

**New tables:**
```sql
CREATE TABLE customer_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE customer_survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES customer_surveys(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  answer_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Fixed questions:**
1. `service_rating` — איך היה השירות? (1-5 stars)
2. `leave_reason` — למה החלטת לא להמשיך? (multi-select: price, service, no_need, other)
3. `nps_score` — האם תמליץ עלינו? (1-10)
4. `free_text` — הערות חופשיות

**Future:** Business owner can add custom questions via admin UI.

### Flow
1. Retainer status changes to `completed`
2. In customer detail, "שלח סקר" button appears
3. Click creates a `customer_surveys` row with unique token
4. Displays link: `/survey/{token}`
5. Public page (no auth) shows questions → client fills in → saved to `customer_survey_responses`
6. Results displayed in customer detail popup

### Public survey page
- Route: `src/app/survey/[token]/page.tsx`
- No auth required
- Hebrew RTL, clean design
- Submits once, shows "תודה" on completion
