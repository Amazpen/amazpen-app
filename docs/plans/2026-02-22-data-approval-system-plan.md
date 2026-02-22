# Data Approval System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a per-field approval system where automated data (from n8n) enters as "pending" (gray), admins approve individual fields, and a reminder system detects missing data.

**Architecture:** New `daily_entry_approvals` table for per-field tracking. New columns on `daily_entries`, `invoices`, `payments` for `approval_status` and `data_source`. API endpoints for intake (n8n → Supabase) and approval (admin actions). Dashboard UI shows gray cards for pending fields with an approval modal. Reminders system (disabled by default) detects missing data.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL + RLS + Realtime), TypeScript, Tailwind CSS, existing shadcn/ui components.

**Note on reminders:** The reminders system is built but DISABLED — no emails/push sent until explicitly enabled by the user.

---

## Task 1: Database Migration — New Tables and Columns

**Files:**
- Create: `src/app/api/migrations/approval-system/route.ts` (temporary migration runner)

**Step 1: Run the migration via Supabase MCP**

Execute the following SQL migration using `mcp__supabase-selfhosted__apply_migration`:

```sql
-- 1. New table: daily_entry_approvals
CREATE TABLE IF NOT EXISTS public.daily_entry_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_entry_id UUID NOT NULL REFERENCES public.daily_entries(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ocr', 'whatsapp', 'email', 'api')),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(daily_entry_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_dea_daily_entry ON public.daily_entry_approvals(daily_entry_id);
CREATE INDEX IF NOT EXISTS idx_dea_business_pending ON public.daily_entry_approvals(business_id, status) WHERE status = 'pending';

-- 2. Alter daily_entries
ALTER TABLE public.daily_entries
  ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS is_fully_approved BOOLEAN DEFAULT true;

-- Add constraints separately (safe for existing data)
DO $$ BEGIN
  ALTER TABLE public.daily_entries ADD CONSTRAINT daily_entries_data_source_check
    CHECK (data_source IN ('manual', 'ocr', 'whatsapp', 'email', 'api'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Alter invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS review_approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS review_approved_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE public.invoices ADD CONSTRAINT invoices_approval_status_check
    CHECK (approval_status IN ('pending_review', 'approved'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.invoices ADD CONSTRAINT invoices_data_source_check
    CHECK (data_source IN ('manual', 'ocr', 'whatsapp', 'email', 'api'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Alter payments
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS review_approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS review_approved_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE public.payments ADD CONSTRAINT payments_approval_status_check
    CHECK (approval_status IN ('pending_review', 'approved'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.payments ADD CONSTRAINT payments_data_source_check
    CHECK (data_source IN ('manual', 'ocr', 'whatsapp', 'email', 'api'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. New table: data_reminders
CREATE TABLE IF NOT EXISTS public.data_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('missing_daily', 'pending_approval', 'missing_invoices')),
  reference_date DATE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_to TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('push', 'whatsapp', 'email')),
  UNIQUE(business_id, reminder_type, reference_date, sent_to)
);
```

**Step 2: Add RLS policies**

```sql
-- Enable RLS
ALTER TABLE public.daily_entry_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_reminders ENABLE ROW LEVEL SECURITY;

-- daily_entry_approvals: members can read, admins can write
CREATE POLICY dea_select ON public.daily_entry_approvals FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = daily_entry_approvals.business_id AND public.is_business_member(b.id)
  ) OR public.is_admin());

CREATE POLICY dea_insert ON public.daily_entry_approvals FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY dea_update ON public.daily_entry_approvals FOR UPDATE
  USING (public.is_admin());

CREATE POLICY dea_delete ON public.daily_entry_approvals FOR DELETE
  USING (public.is_admin());

-- data_reminders: admins only
CREATE POLICY dr_select ON public.data_reminders FOR SELECT
  USING (public.is_admin());

CREATE POLICY dr_insert ON public.data_reminders FOR INSERT
  WITH CHECK (public.is_admin());
```

**Step 3: Verify migration**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('daily_entry_approvals', 'data_reminders');

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'daily_entries' AND column_name IN ('data_source', 'is_fully_approved');
```

**Step 4: Commit**

```bash
git add -A && git commit -m "chore(db): add approval system migration docs"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `src/types/index.ts` (add after DailyEntry interface, ~line 136)
- Create: `src/types/approvals.ts`

**Step 1: Create approval types file**

Create `src/types/approvals.ts`:

```typescript
export type ApprovalStatus = 'pending' | 'approved';
export type DataSource = 'manual' | 'ocr' | 'whatsapp' | 'email' | 'api';
export type InvoiceApprovalStatus = 'pending_review' | 'approved';
export type ReminderType = 'missing_daily' | 'pending_approval' | 'missing_invoices';
export type ReminderChannel = 'push' | 'whatsapp' | 'email';

export interface DailyEntryApproval {
  id: string;
  daily_entry_id: string;
  business_id: string;
  field_name: string;
  status: ApprovalStatus;
  source: DataSource;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface DataReminder {
  id: string;
  business_id: string;
  reminder_type: ReminderType;
  reference_date: string;
  sent_at: string;
  sent_to: string;
  channel: ReminderChannel;
}

// Maps field_name to Hebrew label for display
export const FIELD_LABELS: Record<string, string> = {
  total_register: 'סה"כ קופה',
  labor_cost: 'עלות עובדים',
  labor_hours: 'שעות עובדים',
  discounts: 'הנחות',
  food_cost: 'עלות מכר',
  current_expenses: 'הוצאות שוטפות',
  avg_private: 'ממוצע פרטי',
  avg_business: 'ממוצע עסקי',
};

// Maps metric card to its approval field_names
export const CARD_FIELD_MAP: Record<string, string[]> = {
  totalIncome: ['total_register'],
  laborCost: ['labor_cost', 'labor_hours'],
  foodCost: ['food_cost'],
  currentExpenses: ['current_expenses'],
  avgPrivate: ['avg_private'],
  avgBusiness: ['avg_business'],
};
```

**Step 2: Update DailyEntry interface in `src/types/index.ts`**

Add after the existing `updated_at` field (~line 135):

```typescript
  // Approval system fields
  data_source?: string;
  is_fully_approved?: boolean;
```

**Step 3: Commit**

```bash
git add src/types/approvals.ts src/types/index.ts
git commit -m "feat(types): add approval system types and field mappings"
```

---

## Task 3: API Key Authentication Helper

**Files:**
- Create: `src/lib/apiAuth.ts`

**Step 1: Create the helper**

```typescript
import { NextRequest, NextResponse } from 'next/server';

const INTAKE_API_KEY = process.env.INTAKE_API_KEY;

export function validateApiKey(request: NextRequest): { valid: boolean; error?: NextResponse } {
  const apiKey = request.headers.get('x-api-key');

  if (!INTAKE_API_KEY) {
    return {
      valid: false,
      error: NextResponse.json({ error: 'Server misconfigured: missing INTAKE_API_KEY' }, { status: 500 }),
    };
  }

  if (!apiKey || apiKey !== INTAKE_API_KEY) {
    return {
      valid: false,
      error: NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 }),
    };
  }

  return { valid: true };
}
```

**Step 2: Commit**

```bash
git add src/lib/apiAuth.ts
git commit -m "feat(auth): add API key validation helper for intake endpoints"
```

---

## Task 4: Intake API — Daily Entry

**Files:**
- Create: `src/app/api/intake/daily-entry/route.ts`

**Step 1: Create the endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateApiKey } from '@/lib/apiAuth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const auth = validateApiKey(request);
  if (!auth.valid) return auth.error!;

  try {
    const body = await request.json();
    const {
      business_id,
      entry_date,
      total_register = 0,
      labor_cost = 0,
      labor_hours = 0,
      discounts = 0,
      day_factor = 1,
      source = 'api',
      income_data,
      receipt_data,
      product_usage,
    } = body;

    if (!business_id || !entry_date) {
      return NextResponse.json({ error: 'business_id and entry_date are required' }, { status: 400 });
    }

    // Check for duplicate entry
    const { data: existing } = await supabaseAdmin
      .from('daily_entries')
      .select('id')
      .eq('business_id', business_id)
      .eq('entry_date', entry_date)
      .is('deleted_at', null)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'Daily entry already exists for this date', existing_id: existing.id }, { status: 409 });
    }

    // Insert daily entry
    const { data: entry, error: entryError } = await supabaseAdmin
      .from('daily_entries')
      .insert({
        business_id,
        entry_date,
        total_register,
        labor_cost,
        labor_hours,
        discounts,
        day_factor,
        data_source: source,
        is_fully_approved: false,
        manager_daily_cost: 0,
      })
      .select('id')
      .single();

    if (entryError) {
      return NextResponse.json({ error: entryError.message }, { status: 500 });
    }

    // Build approval fields list
    const fields: string[] = ['total_register', 'labor_cost', 'labor_hours', 'discounts'];

    // Add computed fields
    fields.push('food_cost', 'current_expenses', 'avg_private', 'avg_business');

    // Add income source fields
    if (income_data && Array.isArray(income_data)) {
      for (const inc of income_data) {
        if (inc.income_source_id) {
          fields.push(`income_source_${inc.income_source_id}`);

          await supabaseAdmin.from('daily_income_breakdown').insert({
            daily_entry_id: entry.id,
            income_source_id: inc.income_source_id,
            amount: inc.amount || 0,
            orders_count: inc.orders_count || 0,
          });
        }
      }
    }

    // Add receipt data
    if (receipt_data && Array.isArray(receipt_data)) {
      for (const rec of receipt_data) {
        if (rec.receipt_type_id) {
          await supabaseAdmin.from('daily_receipts').insert({
            daily_entry_id: entry.id,
            receipt_type_id: rec.receipt_type_id,
            amount: rec.amount || 0,
          });
        }
      }
    }

    // Add product usage fields
    if (product_usage && Array.isArray(product_usage)) {
      for (const prod of product_usage) {
        if (prod.product_id) {
          fields.push(`managed_product_${prod.product_id}`);

          await supabaseAdmin.from('daily_product_usage').insert({
            daily_entry_id: entry.id,
            product_id: prod.product_id,
            opening_stock: prod.opening_stock || 0,
            received_quantity: prod.received_quantity || 0,
            closing_stock: prod.closing_stock || 0,
            quantity: (prod.opening_stock || 0) + (prod.received_quantity || 0) - (prod.closing_stock || 0),
            unit_cost_at_time: prod.unit_cost_at_time || 0,
          });
        }
      }
    }

    // Create approval records for all fields
    const approvalRows = fields.map((field_name) => ({
      daily_entry_id: entry.id,
      business_id,
      field_name,
      status: 'pending',
      source,
    }));

    const { error: approvalError } = await supabaseAdmin
      .from('daily_entry_approvals')
      .insert(approvalRows);

    if (approvalError) {
      console.error('Failed to create approval records:', approvalError);
    }

    return NextResponse.json({ id: entry.id, fields_count: fields.length }, { status: 201 });
  } catch (err) {
    console.error('Intake daily-entry error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/intake/daily-entry/route.ts
git commit -m "feat(api): add daily entry intake endpoint for n8n"
```

---

## Task 5: Intake API — Expense (Invoice)

**Files:**
- Create: `src/app/api/intake/expense/route.ts`

**Step 1: Create the endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateApiKey } from '@/lib/apiAuth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const auth = validateApiKey(request);
  if (!auth.valid) return auth.error!;

  try {
    const body = await request.json();
    const {
      business_id,
      supplier_id,
      invoice_number,
      invoice_date,
      due_date,
      subtotal,
      vat_amount = 0,
      total_amount,
      invoice_type = 'current',
      source = 'api',
      attachment_url,
      notes,
      line_items,
    } = body;

    if (!business_id || !supplier_id || !invoice_date || !total_amount) {
      return NextResponse.json(
        { error: 'business_id, supplier_id, invoice_date, and total_amount are required' },
        { status: 400 }
      );
    }

    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .insert({
        business_id,
        supplier_id,
        invoice_number,
        invoice_date,
        due_date,
        subtotal: subtotal || total_amount - vat_amount,
        vat_amount,
        total_amount,
        invoice_type,
        status: 'pending',
        approval_status: 'pending_review',
        data_source: source,
        attachment_url,
        notes,
      })
      .select('id')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Save line items for price tracking if provided
    if (line_items && Array.isArray(line_items) && line_items.length > 0) {
      try {
        const { savePriceTrackingForLineItems } = await import('@/lib/priceTracking');
        await savePriceTrackingForLineItems(supabaseAdmin, {
          supplier_id,
          business_id,
          invoice_id: invoice.id,
          document_date: invoice_date,
          line_items: line_items.map((item: { name: string; quantity: number; unit_price: number; total: number }) => ({
            name: item.name,
            quantity: item.quantity || 1,
            unit_price: item.unit_price || item.total,
            total: item.total,
          })),
        });
      } catch (priceErr) {
        console.error('Price tracking failed (non-blocking):', priceErr);
      }
    }

    return NextResponse.json({ id: invoice.id }, { status: 201 });
  } catch (err) {
    console.error('Intake expense error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/intake/expense/route.ts
git commit -m "feat(api): add expense intake endpoint for n8n"
```

---

## Task 6: Intake API — Payment

**Files:**
- Create: `src/app/api/intake/payment/route.ts`

**Step 1: Create the endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateApiKey } from '@/lib/apiAuth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const auth = validateApiKey(request);
  if (!auth.valid) return auth.error!;

  try {
    const body = await request.json();
    const {
      business_id,
      supplier_id,
      payment_date,
      total_amount,
      invoice_id,
      source = 'api',
      notes,
      receipt_url,
      payment_methods,
    } = body;

    if (!business_id || !supplier_id || !payment_date || !total_amount) {
      return NextResponse.json(
        { error: 'business_id, supplier_id, payment_date, and total_amount are required' },
        { status: 400 }
      );
    }

    // Create payment
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert({
        business_id,
        supplier_id,
        payment_date,
        total_amount,
        invoice_id,
        approval_status: 'pending_review',
        data_source: source,
        notes,
        receipt_url,
      })
      .select('id')
      .single();

    if (paymentError) {
      return NextResponse.json({ error: paymentError.message }, { status: 500 });
    }

    // Create payment splits
    if (payment_methods && Array.isArray(payment_methods)) {
      for (const method of payment_methods) {
        await supabaseAdmin.from('payment_splits').insert({
          payment_id: payment.id,
          payment_method: method.method || 'bank_transfer',
          amount: method.amount || total_amount,
          reference_number: method.reference_number,
          check_number: method.check_number,
          check_date: method.check_date,
        });
      }
    } else {
      // Default: single bank_transfer split
      await supabaseAdmin.from('payment_splits').insert({
        payment_id: payment.id,
        payment_method: 'bank_transfer',
        amount: total_amount,
      });
    }

    // Update invoice status if linked
    if (invoice_id) {
      const { data: invoice } = await supabaseAdmin
        .from('invoices')
        .select('total_amount, amount_paid')
        .eq('id', invoice_id)
        .maybeSingle();

      if (invoice) {
        const newAmountPaid = (Number(invoice.amount_paid) || 0) + Number(total_amount);
        const newStatus = newAmountPaid >= Number(invoice.total_amount) ? 'paid' : 'pending';

        await supabaseAdmin
          .from('invoices')
          .update({ amount_paid: newAmountPaid, status: newStatus })
          .eq('id', invoice_id);
      }
    }

    return NextResponse.json({ id: payment.id }, { status: 201 });
  } catch (err) {
    console.error('Intake payment error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/intake/payment/route.ts
git commit -m "feat(api): add payment intake endpoint for n8n"
```

---

## Task 7: Approval API Endpoints

**Files:**
- Create: `src/app/api/approvals/daily-entry/route.ts`
- Create: `src/app/api/approvals/invoice/route.ts`
- Create: `src/app/api/approvals/payment/route.ts`
- Create: `src/app/api/approvals/pending/route.ts`

**Step 1: Daily entry approval endpoint**

Create `src/app/api/approvals/daily-entry/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Check admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { daily_entry_id, fields } = body;

    if (!daily_entry_id || !fields || !Array.isArray(fields)) {
      return NextResponse.json({ error: 'daily_entry_id and fields array required' }, { status: 400 });
    }

    const now = new Date().toISOString();
    let approvedCount = 0;

    for (const field of fields) {
      if (field.approve) {
        const { error } = await supabase
          .from('daily_entry_approvals')
          .update({
            status: 'approved',
            approved_by: user.id,
            approved_at: now,
          })
          .eq('daily_entry_id', daily_entry_id)
          .eq('field_name', field.field_name);

        if (!error) approvedCount++;
      }
    }

    // Check if all fields are now approved
    const { data: pendingFields } = await supabase
      .from('daily_entry_approvals')
      .select('id')
      .eq('daily_entry_id', daily_entry_id)
      .eq('status', 'pending');

    if (!pendingFields || pendingFields.length === 0) {
      await supabase
        .from('daily_entries')
        .update({ is_fully_approved: true })
        .eq('id', daily_entry_id);
    }

    return NextResponse.json({ approved_count: approvedCount, fully_approved: !pendingFields?.length });
  } catch (err) {
    console.error('Approval error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 2: Invoice approval endpoint**

Create `src/app/api/approvals/invoice/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { invoice_id } = await request.json();
    if (!invoice_id) return NextResponse.json({ error: 'invoice_id required' }, { status: 400 });

    const { error } = await supabase
      .from('invoices')
      .update({
        approval_status: 'approved',
        review_approved_by: user.id,
        review_approved_at: new Date().toISOString(),
      })
      .eq('id', invoice_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Invoice approval error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 3: Payment approval endpoint**

Create `src/app/api/approvals/payment/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { payment_id } = await request.json();
    if (!payment_id) return NextResponse.json({ error: 'payment_id required' }, { status: 400 });

    const { error } = await supabase
      .from('payments')
      .update({
        approval_status: 'approved',
        review_approved_by: user.id,
        review_approved_at: new Date().toISOString(),
      })
      .eq('id', payment_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Payment approval error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 4: Pending approvals query endpoint**

Create `src/app/api/approvals/pending/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const businessId = request.nextUrl.searchParams.get('business_id');
    if (!businessId) return NextResponse.json({ error: 'business_id required' }, { status: 400 });

    // Fetch pending daily entry approvals
    const { data: dailyApprovals } = await supabase
      .from('daily_entry_approvals')
      .select('*, daily_entries!inner(entry_date, total_register, labor_cost, labor_hours, discounts)')
      .eq('business_id', businessId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    // Fetch pending invoices
    const { data: pendingInvoices } = await supabase
      .from('invoices')
      .select('id, supplier_id, invoice_number, invoice_date, total_amount, invoice_type, data_source, suppliers!inner(name)')
      .eq('business_id', businessId)
      .eq('approval_status', 'pending_review')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    // Fetch pending payments
    const { data: pendingPayments } = await supabase
      .from('payments')
      .select('id, supplier_id, payment_date, total_amount, data_source, suppliers!inner(name)')
      .eq('business_id', businessId)
      .eq('approval_status', 'pending_review')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      daily_fields: dailyApprovals || [],
      invoices: pendingInvoices || [],
      payments: pendingPayments || [],
      totals: {
        daily_fields: dailyApprovals?.length || 0,
        invoices: pendingInvoices?.length || 0,
        payments: pendingPayments?.length || 0,
      },
    });
  } catch (err) {
    console.error('Pending approvals error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 5: Commit**

```bash
git add src/app/api/approvals/
git commit -m "feat(api): add approval endpoints for daily entries, invoices, payments"
```

---

## Task 8: Approval Hook — `useApprovals`

**Files:**
- Create: `src/hooks/useApprovals.ts`

**Step 1: Create the hook**

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';
import type { DailyEntryApproval } from '@/types/approvals';

interface PendingCounts {
  daily_fields: number;
  invoices: number;
  payments: number;
  total: number;
}

interface FieldPendingMap {
  [fieldName: string]: boolean;
}

export function useApprovals(businessIds: string[]) {
  const [pendingApprovals, setPendingApprovals] = useState<DailyEntryApproval[]>([]);
  const [pendingCounts, setPendingCounts] = useState<PendingCounts>({ daily_fields: 0, invoices: 0, payments: 0, total: 0 });
  const [fieldPendingMap, setFieldPendingMap] = useState<FieldPendingMap>({});
  const [loading, setLoading] = useState(false);

  const fetchPending = useCallback(async () => {
    if (!businessIds.length) {
      setPendingApprovals([]);
      setPendingCounts({ daily_fields: 0, invoices: 0, payments: 0, total: 0 });
      setFieldPendingMap({});
      return;
    }

    setLoading(true);
    try {
      const supabase = createBrowserClient();

      // Fetch pending daily entry approvals for all selected businesses
      const { data: approvals } = await supabase
        .from('daily_entry_approvals')
        .select('*')
        .in('business_id', businessIds)
        .eq('status', 'pending');

      // Fetch pending invoices count
      const { count: invoiceCount } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .in('business_id', businessIds)
        .eq('approval_status', 'pending_review')
        .is('deleted_at', null);

      // Fetch pending payments count
      const { count: paymentCount } = await supabase
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .in('business_id', businessIds)
        .eq('approval_status', 'pending_review')
        .is('deleted_at', null);

      const dailyCount = approvals?.length || 0;
      const invCount = invoiceCount || 0;
      const payCount = paymentCount || 0;

      setPendingApprovals(approvals || []);
      setPendingCounts({
        daily_fields: dailyCount,
        invoices: invCount,
        payments: payCount,
        total: dailyCount + invCount + payCount,
      });

      // Build field → pending map
      const map: FieldPendingMap = {};
      if (approvals) {
        for (const a of approvals) {
          map[a.field_name] = true;
        }
      }
      setFieldPendingMap(map);
    } catch (err) {
      console.error('Failed to fetch approvals:', err);
    } finally {
      setLoading(false);
    }
  }, [businessIds]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  // Real-time subscription
  useEffect(() => {
    if (!businessIds.length) return;

    const supabase = createBrowserClient();
    const channel = supabase
      .channel('approvals-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_entry_approvals' }, () => {
        fetchPending();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        fetchPending();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        fetchPending();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessIds, fetchPending]);

  const isFieldPending = useCallback((fieldName: string): boolean => {
    return !!fieldPendingMap[fieldName];
  }, [fieldPendingMap]);

  const isCardPending = useCallback((cardFieldNames: string[]): boolean => {
    return cardFieldNames.some((f) => fieldPendingMap[f]);
  }, [fieldPendingMap]);

  const approveFields = useCallback(async (dailyEntryId: string, fields: { field_name: string; approve: boolean }[]) => {
    try {
      const response = await fetch('/api/approvals/daily-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daily_entry_id: dailyEntryId, fields }),
      });
      const result = await response.json();
      if (response.ok) {
        await fetchPending();
      }
      return result;
    } catch (err) {
      console.error('Approve fields error:', err);
      throw err;
    }
  }, [fetchPending]);

  const approveInvoice = useCallback(async (invoiceId: string) => {
    try {
      const response = await fetch('/api/approvals/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      if (response.ok) await fetchPending();
      return response.json();
    } catch (err) {
      console.error('Approve invoice error:', err);
      throw err;
    }
  }, [fetchPending]);

  const approvePayment = useCallback(async (paymentId: string) => {
    try {
      const response = await fetch('/api/approvals/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id: paymentId }),
      });
      if (response.ok) await fetchPending();
      return response.json();
    } catch (err) {
      console.error('Approve payment error:', err);
      throw err;
    }
  }, [fetchPending]);

  return {
    pendingApprovals,
    pendingCounts,
    fieldPendingMap,
    loading,
    isFieldPending,
    isCardPending,
    approveFields,
    approveInvoice,
    approvePayment,
    refresh: fetchPending,
  };
}
```

**Step 2: Commit**

```bash
git add src/hooks/useApprovals.ts
git commit -m "feat(hooks): add useApprovals hook with real-time subscription"
```

---

## Task 9: Approval Modal Component

**Files:**
- Create: `src/components/dashboard/ApprovalModal.tsx`

**Step 1: Create the component**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { X, Check, CheckCheck, Clock } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/client';
import { FIELD_LABELS } from '@/types/approvals';
import type { DailyEntryApproval } from '@/types/approvals';

interface ApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  businessId: string;
  cardFieldNames?: string[];
  cardTitle?: string;
  onApproved: () => void;
}

interface GroupedEntry {
  daily_entry_id: string;
  entry_date: string;
  fields: DailyEntryApproval[];
  entryData: Record<string, number>;
}

export default function ApprovalModal({
  isOpen,
  onClose,
  businessId,
  cardFieldNames,
  cardTitle,
  onApproved,
}: ApprovalModalProps) {
  const [grouped, setGrouped] = useState<GroupedEntry[]>([]);
  const [selectedFields, setSelectedFields] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    if (!isOpen || !businessId) return;
    fetchPendingFields();
  }, [isOpen, businessId]);

  const fetchPendingFields = async () => {
    setLoading(true);
    try {
      const supabase = createBrowserClient();

      let query = supabase
        .from('daily_entry_approvals')
        .select('*, daily_entries!inner(entry_date, total_register, labor_cost, labor_hours, discounts)')
        .eq('business_id', businessId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (cardFieldNames && cardFieldNames.length > 0) {
        query = query.in('field_name', cardFieldNames);
      }

      const { data } = await query;

      // Group by daily_entry_id
      const groups: Record<string, GroupedEntry> = {};
      for (const approval of data || []) {
        const entryId = approval.daily_entry_id;
        if (!groups[entryId]) {
          const entry = approval.daily_entries as Record<string, unknown>;
          groups[entryId] = {
            daily_entry_id: entryId,
            entry_date: entry?.entry_date as string || '',
            fields: [],
            entryData: {
              total_register: Number(entry?.total_register) || 0,
              labor_cost: Number(entry?.labor_cost) || 0,
              labor_hours: Number(entry?.labor_hours) || 0,
              discounts: Number(entry?.discounts) || 0,
            },
          };
        }
        groups[entryId].fields.push(approval);
      }

      setGrouped(Object.values(groups).sort((a, b) => b.entry_date.localeCompare(a.entry_date)));

      // Default: select all
      const sel: Record<string, boolean> = {};
      for (const a of data || []) {
        sel[`${a.daily_entry_id}:${a.field_name}`] = true;
      }
      setSelectedFields(sel);
    } catch (err) {
      console.error('Failed to fetch pending fields:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleField = (entryId: string, fieldName: string) => {
    const key = `${entryId}:${fieldName}`;
    setSelectedFields((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAll = (selectAll: boolean) => {
    const sel: Record<string, boolean> = {};
    for (const group of grouped) {
      for (const field of group.fields) {
        sel[`${group.daily_entry_id}:${field.field_name}`] = selectAll;
      }
    }
    setSelectedFields(sel);
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      // Group selected fields by entry
      const byEntry: Record<string, { field_name: string; approve: boolean }[]> = {};
      for (const [key, selected] of Object.entries(selectedFields)) {
        if (!selected) continue;
        const [entryId, fieldName] = key.split(':');
        if (!byEntry[entryId]) byEntry[entryId] = [];
        byEntry[entryId].push({ field_name: fieldName, approve: true });
      }

      for (const [dailyEntryId, fields] of Object.entries(byEntry)) {
        await fetch('/api/approvals/daily-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ daily_entry_id: dailyEntryId, fields }),
        });
      }

      onApproved();
      onClose();
    } catch (err) {
      console.error('Approval failed:', err);
    } finally {
      setApproving(false);
    }
  };

  if (!isOpen) return null;

  const selectedCount = Object.values(selectedFields).filter(Boolean).length;
  const totalCount = grouped.reduce((sum, g) => sum + g.fields.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#1a1f4e] rounded-[12px] w-[95vw] max-w-[600px] max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-[16px] border-b border-white/10">
          <div className="flex items-center gap-[8px]">
            <Clock className="w-[20px] h-[20px] text-orange-400" />
            <h2 className="text-[18px] font-bold text-white">
              {cardTitle ? `אישור: ${cardTitle}` : 'אישור נתונים'}
            </h2>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white">
            <X className="w-[20px] h-[20px]" />
          </button>
        </div>

        {/* Select all / none */}
        <div className="flex items-center justify-between px-[16px] py-[8px] bg-white/5">
          <span className="text-[13px] text-white/60">
            {selectedCount} מתוך {totalCount} נבחרו
          </span>
          <div className="flex gap-[8px]">
            <button
              onClick={() => toggleAll(true)}
              className="text-[12px] text-blue-400 hover:text-blue-300"
            >
              בחר הכל
            </button>
            <button
              onClick={() => toggleAll(false)}
              className="text-[12px] text-white/40 hover:text-white/60"
            >
              נקה הכל
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-[16px] space-y-[12px]">
          {loading ? (
            <div className="text-center text-white/50 py-[40px]">טוען...</div>
          ) : grouped.length === 0 ? (
            <div className="text-center text-white/50 py-[40px]">אין שדות ממתינים לאישור</div>
          ) : (
            grouped.map((group) => (
              <div key={group.daily_entry_id} className="bg-white/5 rounded-[8px] p-[12px]">
                <div className="text-[14px] font-bold text-white mb-[8px]">
                  {new Date(group.entry_date).toLocaleDateString('he-IL')}
                </div>
                <div className="space-y-[6px]">
                  {group.fields.map((field) => {
                    const key = `${group.daily_entry_id}:${field.field_name}`;
                    const isSelected = selectedFields[key];
                    const label = field.field_name.startsWith('managed_product_')
                      ? `מוצר מנוהל`
                      : field.field_name.startsWith('income_source_')
                        ? `מקור הכנסה`
                        : FIELD_LABELS[field.field_name] || field.field_name;
                    const value = group.entryData[field.field_name];

                    return (
                      <div
                        key={key}
                        onClick={() => toggleField(group.daily_entry_id, field.field_name)}
                        className={`flex items-center justify-between px-[10px] py-[8px] rounded-[6px] cursor-pointer transition-colors ${
                          isSelected ? 'bg-green-500/20 border border-green-500/30' : 'bg-white/5 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-[8px]">
                          <div className={`w-[20px] h-[20px] rounded-[4px] flex items-center justify-center ${
                            isSelected ? 'bg-green-500' : 'bg-white/10'
                          }`}>
                            {isSelected && <Check className="w-[14px] h-[14px] text-white" />}
                          </div>
                          <span className="text-[13px] text-white">{label}</span>
                        </div>
                        {value !== undefined && (
                          <span className="text-[13px] text-white/60 ltr-num">
                            {typeof value === 'number' ? value.toLocaleString('he-IL') : value}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-[8px] p-[16px] border-t border-white/10">
          <button
            onClick={handleApprove}
            disabled={approving || selectedCount === 0}
            className="flex-1 flex items-center justify-center gap-[6px] bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-bold py-[10px] rounded-[8px] transition-colors"
          >
            <CheckCheck className="w-[18px] h-[18px]" />
            {approving ? 'מאשר...' : selectedCount === totalCount ? 'אשר הכל' : `אשר ${selectedCount} נבחרים`}
          </button>
          <button
            onClick={onClose}
            className="px-[20px] py-[10px] bg-white/10 hover:bg-white/20 text-white rounded-[8px] transition-colors"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/dashboard/ApprovalModal.tsx
git commit -m "feat(ui): add ApprovalModal component for per-field approval"
```

---

## Task 10: CSS — Gray Pending State

**Files:**
- Modify: `src/app/globals.css` (~after line 265, after `.data-card-new span`)

**Step 1: Add pending card styles**

Add after the `.data-card-new span` block (~line 265):

```css
/* Pending approval state — gray card */
.data-card-pending {
  background-color: rgb(60, 65, 80) !important;
}

.data-card-pending span {
  color: rgba(255, 255, 255, 0.5) !important;
}

.data-card-pending .approval-badge {
  color: rgb(255, 164, 18) !important;
  opacity: 1 !important;
}

/* Business card pending indicator */
.business-card-has-pending::after {
  content: '';
  position: absolute;
  top: 8px;
  left: 8px;
  width: 10px;
  height: 10px;
  background-color: rgb(255, 164, 18);
  border-radius: 50%;
  animation: pulse-dot 2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

**Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(css): add gray pending state for data cards and business cards"
```

---

## Task 11: Dashboard Page — Integrate Approval System

**Files:**
- Modify: `src/app/(dashboard)/page.tsx`

This is the largest task. We need to:
1. Import and use the `useApprovals` hook
2. Add pending state to metric cards
3. Add pending indicator to business cards
4. Add the ApprovalModal
5. Add notification badge

**Step 1: Add imports** (at top of file, with other imports)

Add these imports:

```typescript
import { useApprovals } from '@/hooks/useApprovals';
import ApprovalModal from '@/components/dashboard/ApprovalModal';
import { CARD_FIELD_MAP } from '@/types/approvals';
```

**Step 2: Add hook and state** (inside the main component, near other state declarations)

Add after existing state declarations:

```typescript
const { pendingCounts, isCardPending, fieldPendingMap, refresh: refreshApprovals } = useApprovals(selectedBusinesses);
const [approvalModal, setApprovalModal] = useState<{ open: boolean; fieldNames?: string[]; title?: string }>({ open: false });
```

**Step 3: Modify metric card rendering**

For each `data-card-new` div, wrap the className to conditionally add `data-card-pending`. The pattern for every metric card:

**Before** (example — total income card at ~line 2661):
```tsx
<div className="data-card-new flex flex-col justify-center gap-[10px] rounded-[10px] p-0 min-h-[155px] w-full cursor-pointer hover:brightness-110 transition-all"
     onClick={() => openHistoryModal('totalIncome', 'סה"כ מכירות')}>
```

**After:**
```tsx
<div className={`${isCardPending(CARD_FIELD_MAP.totalIncome || []) ? 'data-card-pending' : 'data-card-new'} flex flex-col justify-center gap-[10px] rounded-[10px] p-0 min-h-[155px] w-full cursor-pointer hover:brightness-110 transition-all relative`}
     onClick={() => {
       if (isCardPending(CARD_FIELD_MAP.totalIncome || [])) {
         setApprovalModal({ open: true, fieldNames: CARD_FIELD_MAP.totalIncome, title: 'סה"כ מכירות' });
       } else {
         openHistoryModal('totalIncome', 'סה"כ מכירות');
       }
     }}>
  {isCardPending(CARD_FIELD_MAP.totalIncome || []) && (
    <span className="approval-badge absolute top-[6px] left-[6px] text-[10px] px-[6px] py-[2px] rounded-full bg-orange-500/20">
      ממתין לאישור
    </span>
  )}
```

Apply the same pattern to these cards:
- **Total income** (~line 2661): `CARD_FIELD_MAP.totalIncome`
- **Labor cost** (~line 2991): `CARD_FIELD_MAP.laborCost`
- **Food cost** (~line 3139): `CARD_FIELD_MAP.foodCost`
- **Current expenses** (~line 3325): `CARD_FIELD_MAP.currentExpenses`
- **Managed products** (~line 3263): use `[`managed_product_${product.id}`]`
- **Income sources** (~line 2759): use `[`income_source_${source.id}`]`

**Step 4: Business cards — add pending indicator**

For each business card (~line 2412), add `relative` to className and the pending dot:

After the business card `<Button>` opening tag, add conditionally:

```tsx
{pendingCounts.total > 0 && selectedBusinesses.includes(card.id) && (
  <div className="absolute top-[6px] left-[6px] w-[10px] h-[10px] bg-orange-400 rounded-full animate-pulse" title={`${pendingCounts.total} פריטים ממתינים לאישור`} />
)}
```

**Step 5: Add ApprovalModal at end of JSX** (before closing `</div>` of main component)

```tsx
<ApprovalModal
  isOpen={approvalModal.open}
  onClose={() => setApprovalModal({ open: false })}
  businessId={selectedBusinesses[0] || ''}
  cardFieldNames={approvalModal.fieldNames}
  cardTitle={approvalModal.title}
  onApproved={() => {
    refreshApprovals();
    // Refresh dashboard data too
    if (selectedBusinesses.length > 0) {
      fetchDetailedSummary(selectedBusinesses);
    }
  }}
/>
```

**Step 6: Add notification badge to header area**

Find the header area (near the top of the JSX, look for the greeting/date section). Add a pending notification indicator:

```tsx
{pendingCounts.total > 0 && (
  <div className="flex items-center gap-[6px] bg-orange-500/20 px-[10px] py-[4px] rounded-full cursor-pointer"
       onClick={() => setApprovalModal({ open: true })}>
    <Clock className="w-[14px] h-[14px] text-orange-400" />
    <span className="text-[12px] text-orange-400 font-bold">{pendingCounts.total}</span>
  </div>
)}
```

**Step 7: Commit**

```bash
git add src/app/(dashboard)/page.tsx
git commit -m "feat(dashboard): integrate approval system with gray cards and approval modal"
```

---

## Task 12: Expenses Page — Gray State for Pending Invoices

**Files:**
- Modify: `src/app/(dashboard)/expenses/page.tsx`

**Step 1: Add approval state and import**

Add import:
```typescript
import { useApprovals } from '@/hooks/useApprovals';
```

Add hook usage (inside component, near other state):
```typescript
const { approveInvoice } = useApprovals(selectedBusinesses);
```

**Step 2: Modify invoice row rendering** (~line 2630)

Add `approval_status` to the row className logic. The invoice row div currently has:

```tsx
className={`rounded-[7px] p-[7px_3px] border transition-colors ${
  expandedInvoiceId === invoice.id ? 'bg-white/5 border-white'
  : invoice.status === 'בבירור' ? 'border-[#FFA500]'
  : 'border-transparent'
}`}
```

Change to:

```tsx
className={`rounded-[7px] p-[7px_3px] border transition-colors ${
  invoice.approval_status === 'pending_review' ? 'bg-white/5 border-white/20 opacity-60'
  : expandedInvoiceId === invoice.id ? 'bg-white/5 border-white'
  : invoice.status === 'בבירור' ? 'border-[#FFA500]'
  : 'border-transparent'
}`}
```

**Step 3: Add "ממתין לבדיקה" badge**

In the status badge area (~line 2700), add before the existing badge logic:

```tsx
{invoice.approval_status === 'pending_review' ? (
  <Button
    className="text-[12px] font-bold px-[14px] py-[5px] rounded-full bg-white/20 text-white/60 hover:bg-green-500 hover:text-white transition-colors"
    onClick={(e) => {
      e.stopPropagation();
      approveInvoice(invoice.id);
    }}
  >
    ממתין לבדיקה ✓
  </Button>
) : (
  /* existing status badge JSX */
)}
```

**Step 4: Add `approval_status` to the Supabase query**

Find where invoices are fetched (look for `.from('invoices').select(`) and add `approval_status` to the select string.

**Step 5: Commit**

```bash
git add src/app/(dashboard)/expenses/page.tsx
git commit -m "feat(expenses): add gray state and approve button for pending invoices"
```

---

## Task 13: Reminders API (Disabled by Default)

**Files:**
- Create: `src/app/api/reminders/check-missing/route.ts`

**Step 1: Create the check-missing endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CRON_SECRET = process.env.CRON_SECRET;
const REMINDERS_ENABLED = process.env.REMINDERS_ENABLED === 'true'; // DISABLED by default

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  // Auth check
  const secret = request.headers.get('x-cron-secret') || request.nextUrl.searchParams.get('secret');
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Get all active businesses
    const { data: businesses } = await supabaseAdmin
      .from('businesses')
      .select('id, name')
      .eq('is_active', true);

    if (!businesses) return NextResponse.json({ missing: [], enabled: REMINDERS_ENABLED });

    const missing: Array<{ business_id: string; business_name: string; type: string; details: string }> = [];

    for (const biz of businesses) {
      // Check missing daily entry for yesterday
      const { data: entry } = await supabaseAdmin
        .from('daily_entries')
        .select('id')
        .eq('business_id', biz.id)
        .eq('entry_date', yesterdayStr)
        .is('deleted_at', null)
        .maybeSingle();

      if (!entry) {
        missing.push({
          business_id: biz.id,
          business_name: biz.name,
          type: 'missing_daily',
          details: `חסר דיווח יומי לתאריך ${yesterdayStr}`,
        });
      }

      // Check pending approvals > 24h
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: staleApprovals, count } = await supabaseAdmin
        .from('daily_entry_approvals')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', biz.id)
        .eq('status', 'pending')
        .lt('created_at', twentyFourHoursAgo);

      if (count && count > 0) {
        missing.push({
          business_id: biz.id,
          business_name: biz.name,
          type: 'pending_approval',
          details: `${count} שדות ממתינים לאישור יותר מ-24 שעות`,
        });
      }
    }

    return NextResponse.json({
      missing,
      total: missing.length,
      enabled: REMINDERS_ENABLED,
      checked_date: yesterdayStr,
    });
  } catch (err) {
    console.error('Check missing error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/reminders/
git commit -m "feat(api): add reminders check-missing endpoint (disabled by default)"
```

---

## Task 14: Environment Variables

**Files:**
- Modify: `.env.local` (if exists) or document in README

**Step 1: Add required env vars**

Add to `.env.local`:

```env
# Intake API key for n8n → Next.js communication
INTAKE_API_KEY=generate-a-secure-random-key-here

# Cron secret for reminder endpoints
CRON_SECRET=generate-another-secure-key

# Reminders system (disabled by default)
REMINDERS_ENABLED=false
```

**Step 2: Commit** (do NOT commit .env.local — only document)

Create or update `.env.example`:

```env
# Intake API (for n8n integration)
INTAKE_API_KEY=
CRON_SECRET=

# Reminders (set to 'true' to enable)
REMINDERS_ENABLED=false
```

```bash
git add .env.example
git commit -m "docs: add env vars for approval system"
```

---

## Task 15: Build Verification

**Step 1: Run build**

```bash
npm run build
```

Expected: Build succeeds with no TypeScript errors.

**Step 2: Fix any issues**

If build fails, fix TypeScript errors. Common issues:
- Missing `approval_status` on existing invoice type — add it as optional
- Missing import paths
- Type mismatches on Supabase query results

**Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix: resolve build errors in approval system"
```

---

## Task 16: Integration Test (Manual)

**Step 1: Test intake API**

```bash
curl -X POST http://localhost:3000/api/intake/daily-entry \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_INTAKE_API_KEY" \
  -d '{
    "business_id": "REAL_BUSINESS_UUID",
    "entry_date": "2026-02-21",
    "total_register": 15000,
    "labor_cost": 3000,
    "labor_hours": 45,
    "discounts": 200,
    "source": "api"
  }'
```

Expected: 201 response with `{ id: "...", fields_count: 8 }`

**Step 2: Verify gray state**

Open dashboard in browser. The business with the test entry should show:
- Gray metric cards for the tested fields
- "ממתין לאישור" badge on gray cards
- Orange dot on business card

**Step 3: Test approval**

Click a gray card → approval modal opens → select fields → approve. Card should return to normal color.

**Step 4: Test expense intake**

```bash
curl -X POST http://localhost:3000/api/intake/expense \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_INTAKE_API_KEY" \
  -d '{
    "business_id": "REAL_BUSINESS_UUID",
    "supplier_id": "REAL_SUPPLIER_UUID",
    "invoice_date": "2026-02-21",
    "total_amount": 5000,
    "vat_amount": 850,
    "source": "whatsapp"
  }'
```

Expected: Invoice appears in expenses page with gray row and "ממתין לבדיקה" badge.

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete data approval system with gray state, per-field approval, and intake API"
```
