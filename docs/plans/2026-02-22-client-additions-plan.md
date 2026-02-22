# Client Additions — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add extra services per client, labor cost tracking, and exit survey for churned clients.

**Architecture:** New DB tables for services/surveys, new columns on customers for labor. Extra services create income_source entries like retainers. Survey is a public page with no auth.

**Tech Stack:** Next.js 16 App Router, Supabase, TypeScript, React 19, Tailwind CSS 4

---

### Task 1: DB migration — customer_services, labor columns, survey tables

Run via Supabase MCP `execute_sql`:

```sql
-- 1. Customer services table
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
CREATE INDEX idx_cs_customer ON customer_services(customer_id);
```

```sql
-- 2. Labor columns on customers
ALTER TABLE customers
  ADD COLUMN labor_type TEXT CHECK (labor_type IN ('global', 'hourly')),
  ADD COLUMN labor_monthly_salary NUMERIC,
  ADD COLUMN labor_hourly_rate NUMERIC;
```

```sql
-- 3. Survey tables
CREATE TABLE customer_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_csurv_customer ON customer_surveys(customer_id);
CREATE INDEX idx_csurv_token ON customer_surveys(token);

CREATE TABLE customer_survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES customer_surveys(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  answer_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_csresp_survey ON customer_survey_responses(survey_id);
```

```sql
-- 4. RLS for all new tables
ALTER TABLE customer_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view services" ON customer_services FOR SELECT USING (
  customer_id IN (SELECT c.id FROM customers c JOIN business_members bm ON bm.business_id = c.business_id WHERE bm.user_id = auth.uid() AND bm.deleted_at IS NULL)
);
CREATE POLICY "Admins can manage services" ON customer_services FOR INSERT WITH CHECK (
  customer_id IN (SELECT c.id FROM customers c JOIN business_members bm ON bm.business_id = c.business_id WHERE bm.user_id = auth.uid() AND bm.role = 'admin' AND bm.deleted_at IS NULL)
);
CREATE POLICY "Admins can update services" ON customer_services FOR UPDATE USING (
  customer_id IN (SELECT c.id FROM customers c JOIN business_members bm ON bm.business_id = c.business_id WHERE bm.user_id = auth.uid() AND bm.role = 'admin' AND bm.deleted_at IS NULL)
);
CREATE POLICY "Admins can delete services" ON customer_services FOR DELETE USING (
  customer_id IN (SELECT c.id FROM customers c JOIN business_members bm ON bm.business_id = c.business_id WHERE bm.user_id = auth.uid() AND bm.role = 'admin' AND bm.deleted_at IS NULL)
);

ALTER TABLE customer_surveys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view surveys" ON customer_surveys FOR SELECT USING (
  customer_id IN (SELECT c.id FROM customers c JOIN business_members bm ON bm.business_id = c.business_id WHERE bm.user_id = auth.uid() AND bm.deleted_at IS NULL)
);
CREATE POLICY "Admins can manage surveys" ON customer_surveys FOR INSERT WITH CHECK (
  customer_id IN (SELECT c.id FROM customers c JOIN business_members bm ON bm.business_id = c.business_id WHERE bm.user_id = auth.uid() AND bm.role = 'admin' AND bm.deleted_at IS NULL)
);
-- Survey responses: public insert (no auth needed for survey fill), members can read
ALTER TABLE customer_survey_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert responses" ON customer_survey_responses FOR INSERT WITH CHECK (true);
CREATE POLICY "Members can view responses" ON customer_survey_responses FOR SELECT USING (
  survey_id IN (SELECT s.id FROM customer_surveys s JOIN customers c ON c.id = s.customer_id JOIN business_members bm ON bm.business_id = c.business_id WHERE bm.user_id = auth.uid() AND bm.deleted_at IS NULL)
);
```

---

### Task 2: Extra services UI in customer detail popup

Modify: `src/app/(dashboard)/admin/customers/page.tsx`

In the customer detail popup, add a "מוצרים ושירותים" section:
- Fetch `customer_services` on detail open
- List: name, amount (₪), date, notes
- "הוסף מוצר/שירות" button → inline form
- On save: create `customer_services` row + create `income_source` + create `daily_income_breakdown` entry
- Delete button per service (soft delete)
- Total summary

---

### Task 3: Labor cost fields in customer form

Modify: `src/app/(dashboard)/admin/customers/page.tsx`

1. Add to Customer interface: `labor_type`, `labor_monthly_salary`, `labor_hourly_rate`
2. Add form state: `fLaborType`, `fLaborMonthlySalary`, `fLaborHourlyRate`
3. Add to resetForm, handleSetupCustomer edit branch, saveDraft/restoreDraft
4. Add to customerData in handleSaveCustomer
5. Add UI in form Sheet: select global/hourly, conditional salary/rate field
6. Show in detail popup summary

---

### Task 4: Survey API route

Create: `src/app/api/surveys/create/route.ts`
- Auth: Supabase JWT (admin only)
- Body: `{ customer_id }`
- Creates `customer_surveys` row with random token
- Returns `{ survey_id, token, url }`

Create: `src/app/api/surveys/[token]/route.ts`
- GET: Returns survey questions (no auth)
- POST: Saves responses (no auth), marks survey completed

---

### Task 5: Public survey page

Create: `src/app/survey/[token]/page.tsx`
- Public page, no auth
- Fetches survey by token via API
- Shows 4 fixed questions:
  1. Service rating (1-5 stars)
  2. Leave reason (multi-select checkboxes)
  3. NPS score (1-10 slider)
  4. Free text
- Submit → save responses → show "תודה"
- Already completed → show "הסקר כבר מולא"

---

### Task 6: Survey button + results in customer detail

Modify: `src/app/(dashboard)/admin/customers/page.tsx`

When `retainer_status === 'completed'`:
- Show "שלח סקר" button
- On click: call `/api/surveys/create` → copy link to clipboard + show toast
- If survey exists and completed: show results inline (stars, reasons, NPS, text)

---

### Task 7: Build verification and push

- Run `npx tsc --noEmit`
- Fix any errors
- Push to remote
