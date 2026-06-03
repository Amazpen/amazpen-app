# Employee-Cost Month-Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a business owner close a month for employee costs — enter the real amounts (salary, pension funds, national insurance, severance) from the accountant's report, turn each into a payable invoice that flows into cash flow, and have the actual figures override the daily estimate in the P&L and dashboard (shown in green once closed).

**Architecture:** A per-business-per-month `labor_month_close` record flips the source-of-truth for labor cost from the daily-entries estimate (`(labor+manager)×markup`) to actual `employee_costs` invoices. A dedicated API route atomically creates the close record plus one `pending` invoice per entered line (multiple suppliers allowed per category). Reopen deletes the generated invoices (blocked if any are already paid) and reverts to the estimate. The P&L (`reports/page.tsx`) and dashboard (`page.tsx`) read the close state and, when closed, drop the daily estimate and sum the actual invoices instead.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript, Supabase (PostgreSQL + RLS), Tailwind 4, Radix Dialog. No unit-test harness exists (only `@playwright/test` for E2E), so verification is `npm run lint` + `npm run build` + DB queries via the Supabase MCP + manual UI checks.

**Important environment notes:**
- This repo has **no `supabase/migrations` folder** — migrations are applied directly through the Supabase MCP tool `mcp__supabase-selfhosted__apply_migration`. Keep a copy of the SQL in `docs/superpowers/migrations/` for the record.
- RLS helper functions `is_business_member(uuid)` and `is_admin()` already exist in the DB.
- The labor calc sums `daily_entries` across **all** `selectedBusinesses` together (no per-business split). V1 treats labor as "closed" only when **every** selected business is closed for the displayed month. This is exact for the dominant single-business view and conservative (keeps the estimate) for partial multi-business selections. Documented in code comments.
- Employee-cost amounts in Israel (salary, pension, NI, severance) carry **no VAT**. Close invoices are stored with `subtotal = total_amount = amount`, `vat_amount = 0`.

---

## File Structure

- `docs/superpowers/migrations/2026-06-02-labor-month-close.sql` — **Create.** Canonical copy of the migration SQL (also applied via MCP).
- `src/types/index.ts` — **Modify.** Add `LaborMonthClose` type; add `system_kind` to `Supplier`; add `labor_close_id` to invoice typing if present.
- `src/app/api/labor-close/route.ts` — **Create.** POST (close) + DELETE (reopen). Owns invoice creation, salary-supplier provisioning, and reopen safety checks.
- `src/components/dashboard/LaborMonthCloseModal.tsx` — **Create.** The close panel UI (pre-filled lines, multiple suppliers, estimate-vs-actual totals).
- `src/app/(dashboard)/reports/page.tsx` — **Modify.** Fetch close state; flip labor source-of-truth; green when closed; wire close/reopen buttons into the labor row.
- `src/app/(dashboard)/page.tsx` — **Modify.** Mirror the labor flip for the dashboard monthly labor figure.

---

## Task 1: Database migration

**Files:**
- Create: `docs/superpowers/migrations/2026-06-02-labor-month-close.sql`

- [ ] **Step 1: Confirm `suppliers` NOT-NULL columns without defaults** (so the salary-supplier insert in Task 3 won't fail)

Run via Supabase MCP `execute_sql` (read_only):

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='suppliers'
  AND is_nullable='NO' AND column_default IS NULL
ORDER BY column_name;
```

Record the result. Any column listed here (besides `id`, `business_id`, `name`, `expense_type`) must be supplied in the Task 3 provisioning insert.

- [ ] **Step 2: Write the migration SQL file**

Create `docs/superpowers/migrations/2026-06-02-labor-month-close.sql`:

```sql
-- Employee-Cost Month-Close: source-of-truth flip for labor cost.

-- 1. Close record (one per business per month)
CREATE TABLE IF NOT EXISTS public.labor_month_close (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period_year     int  NOT NULL,
  period_month    int  NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status          text NOT NULL DEFAULT 'closed' CHECK (status IN ('closed','reopened')),
  estimate_total  numeric,
  actual_total    numeric,
  closed_at       timestamptz DEFAULT now(),
  closed_by       uuid,
  reopened_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT labor_month_close_unique UNIQUE (business_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_labor_month_close_lookup
  ON public.labor_month_close (business_id, period_year, period_month, status);

ALTER TABLE public.labor_month_close ENABLE ROW LEVEL SECURITY;

CREATE POLICY labor_month_close_select ON public.labor_month_close
  FOR SELECT USING (is_business_member(business_id) OR is_admin());
CREATE POLICY labor_month_close_insert ON public.labor_month_close
  FOR INSERT WITH CHECK (is_business_member(business_id) OR is_admin());
CREATE POLICY labor_month_close_update ON public.labor_month_close
  FOR UPDATE USING (is_business_member(business_id) OR is_admin())
  WITH CHECK (is_business_member(business_id) OR is_admin());
CREATE POLICY labor_month_close_delete ON public.labor_month_close
  FOR DELETE USING (is_business_member(business_id) OR is_admin());

-- 2. Link invoices created by a close (for precise reopen + P&L identification)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS labor_close_id uuid REFERENCES public.labor_month_close(id);
CREATE INDEX IF NOT EXISTS idx_invoices_labor_close ON public.invoices (labor_close_id);

-- 3. Identify the auto-provisioned salary supplier
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS system_kind text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_system_kind
  ON public.suppliers (business_id, system_kind) WHERE system_kind IS NOT NULL;
```

- [ ] **Step 3: Apply the migration via MCP**

Use `mcp__supabase-selfhosted__apply_migration` with name `labor_month_close` and the SQL above.

- [ ] **Step 4: Verify the schema**

Run via `execute_sql` (read_only):

```sql
SELECT to_regclass('public.labor_month_close') AS tbl,
       (SELECT count(*) FROM pg_policies WHERE tablename='labor_month_close') AS policies,
       (SELECT count(*) FROM information_schema.columns WHERE table_name='invoices' AND column_name='labor_close_id') AS inv_col,
       (SELECT count(*) FROM information_schema.columns WHERE table_name='suppliers' AND column_name='system_kind') AS sup_col;
```

Expected: `tbl='labor_month_close'`, `policies=4`, `inv_col=1`, `sup_col=1`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/migrations/2026-06-02-labor-month-close.sql
git commit -m "feat(labor-close): DB migration for employee-cost month-close"
```

---

## Task 2: TypeScript types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add the `LaborMonthClose` type and extend `Supplier`**

In `src/types/index.ts`, add:

```typescript
export interface LaborMonthClose {
  id: string;
  business_id: string;
  period_year: number;
  period_month: number;
  status: 'closed' | 'reopened';
  estimate_total: number | null;
  actual_total: number | null;
  closed_at: string | null;
  closed_by: string | null;
  reopened_at: string | null;
  created_at: string;
  updated_at: string;
}
```

Locate the existing `Supplier` interface and add this field (keep alphabetical/grouping consistent with neighbours):

```typescript
  system_kind?: string | null;
```

- [ ] **Step 2: Verify types compile**

Run: `npm run lint`
Expected: no new errors referencing `src/types/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(labor-close): add LaborMonthClose type and supplier.system_kind"
```

---

## Task 3: API route — close a month (POST)

**Files:**
- Create: `src/app/api/labor-close/route.ts`

- [ ] **Step 1: Write the POST handler (close)**

Create `src/app/api/labor-close/route.ts`. This route uses the service-role client (matching `src/app/api/recurring-expenses/generate/route.ts`) but **requires** the caller to be an authenticated member of the business: it reads the user from the SSR cookie client and verifies membership before any write.

```typescript
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface CloseLine {
  supplier_id: string;
  amount: number;
  due_date?: string | null;
}

// Verify the logged-in user is a member (or admin) of the business.
async function assertMember(business_id: string): Promise<string | null> {
  const ssr = await createServerClient();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) return null;
  const { data: membership } = await ssr
    .from("business_members")
    .select("business_id")
    .eq("business_id", business_id)
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: profile } = await ssr
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin";
  if (!membership && !isAdmin) return null;
  return user.id;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { business_id, year, month, lines, estimate_total } = body as {
      business_id: string; year: number; month: number;
      lines: CloseLine[]; estimate_total?: number;
    };

    if (!business_id || !year || !month || !Array.isArray(lines)) {
      return NextResponse.json({ error: "business_id, year, month, lines are required" }, { status: 400 });
    }

    const userId = await assertMember(business_id);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "Missing Supabase configuration" }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const validLines = lines.filter((l) => l.supplier_id && Number(l.amount) > 0);
    if (validLines.length === 0) {
      return NextResponse.json({ error: "No lines with a positive amount" }, { status: 400 });
    }

    const actualTotal = validLines.reduce((s, l) => s + Number(l.amount), 0);

    // 1. Upsert the close record (re-close after reopen reuses the row).
    const { data: closeRow, error: closeErr } = await supabase
      .from("labor_month_close")
      .upsert(
        {
          business_id, period_year: year, period_month: month,
          status: "closed", estimate_total: estimate_total ?? null,
          actual_total: actualTotal, closed_at: new Date().toISOString(),
          closed_by: userId, reopened_at: null, updated_at: new Date().toISOString(),
        },
        { onConflict: "business_id,period_year,period_month" }
      )
      .select("id")
      .single();

    if (closeErr || !closeRow) {
      return NextResponse.json({ error: closeErr?.message || "Failed to create close record" }, { status: 500 });
    }

    // 2. Build the invoices (no VAT on employee costs).
    const lastDay = new Date(year, month, 0).getDate();
    const invoiceDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const monthLabel = `${String(month).padStart(2, "0")}/${year}`;

    const invoicesToCreate = validLines.map((l) => ({
      business_id,
      supplier_id: l.supplier_id,
      invoice_date: invoiceDate,
      reference_date: invoiceDate,
      due_date: l.due_date || invoiceDate,
      subtotal: Number(l.amount),
      vat_amount: 0,
      total_amount: Number(l.amount),
      status: "pending",
      invoice_type: "employees",
      labor_close_id: closeRow.id,
      notes: `סגירת חודש עלות עובדים ${monthLabel}`,
    }));

    const { data: created, error: insErr } = await supabase
      .from("invoices")
      .insert(invoicesToCreate)
      .select("id");

    if (insErr) {
      // Compensate: remove the close row so the month stays open.
      await supabase.from("labor_month_close").delete().eq("id", closeRow.id);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, close_id: closeRow.id, created: created?.length || 0 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
```

> Note: `labor_month_close` has a `UNIQUE (business_id, period_year, period_month)` constraint with **no partial `WHERE` clause**, so `.upsert(onConflict)` works here (unlike the soft-delete partial-unique tables noted in project memory).

- [ ] **Step 2: Verify the salary-supplier provisioning shape**

The modal (Task 4) needs a stable "salary" supplier. Provisioning lives in a small POST helper so the modal can request it. Add this second handler section **inside the same file**, exported as part of the route is not possible (one POST per file), so instead provision lazily from the modal via a query+insert. Implement provisioning as a tiny exported helper used by the modal through a sub-route. Create `src/app/api/labor-close/salary-supplier/route.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Returns (creating if needed) the system "salary" supplier for a business.
export async function POST(request: NextRequest) {
  try {
    const { business_id } = await request.json().catch(() => ({}));
    if (!business_id) return NextResponse.json({ error: "business_id required" }, { status: 400 });

    const ssr = await createServerClient();
    const { data: { user } } = await ssr.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: existing } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("business_id", business_id)
      .eq("system_kind", "labor_salary")
      .maybeSingle();

    if (existing) return NextResponse.json({ supplier: existing });

    const { data: created, error } = await supabase
      .from("suppliers")
      .insert({
        business_id,
        name: "משכורות עובדים",
        expense_type: "employee_costs",
        system_kind: "labor_salary",
        is_active: true,
        is_fixed_expense: false,
        vat_type: "none",
        requires_vat: false,
      })
      .select("id, name")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ supplier: created });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
```

> If Task 1 Step 1 revealed additional NOT-NULL columns on `suppliers` without defaults, add them to this insert.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles; the two new routes appear under `/api/labor-close` and `/api/labor-close/salary-supplier`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/labor-close/route.ts src/app/api/labor-close/salary-supplier/route.ts
git commit -m "feat(labor-close): API route to close a month + salary supplier provisioning"
```

---

## Task 4: API route — reopen a month (DELETE)

**Files:**
- Modify: `src/app/api/labor-close/route.ts`

- [ ] **Step 1: Add the DELETE handler (reopen)**

Append to `src/app/api/labor-close/route.ts`:

```typescript
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const business_id = searchParams.get("business_id");
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));

    if (!business_id || !year || !month) {
      return NextResponse.json({ error: "business_id, year, month are required" }, { status: 400 });
    }

    const userId = await assertMember(business_id);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: closeRow } = await supabase
      .from("labor_month_close")
      .select("id")
      .eq("business_id", business_id)
      .eq("period_year", year)
      .eq("period_month", month)
      .eq("status", "closed")
      .maybeSingle();

    if (!closeRow) return NextResponse.json({ error: "No closed month found" }, { status: 404 });

    // Invoices generated by this close.
    const { data: closeInvoices } = await supabase
      .from("invoices")
      .select("id")
      .eq("labor_close_id", closeRow.id);

    const invoiceIds = (closeInvoices || []).map((i) => i.id);

    // Block reopen if any generated invoice already has a linked payment.
    if (invoiceIds.length > 0) {
      const { data: links } = await supabase
        .from("payment_invoice_links")
        .select("invoice_id")
        .in("invoice_id", invoiceIds)
        .limit(1);
      if (links && links.length > 0) {
        return NextResponse.json(
          { error: "יש תשלום מקושר לאחת מחשבוניות הסגירה. בטל קודם את התשלום ואז פתח מחדש." },
          { status: 409 }
        );
      }
    }

    if (invoiceIds.length > 0) {
      const { error: delErr } = await supabase.from("invoices").delete().in("id", invoiceIds);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    const { error: updErr } = await supabase
      .from("labor_month_close")
      .update({ status: "reopened", reopened_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", closeRow.id);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, deleted: invoiceIds.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/labor-close/route.ts
git commit -m "feat(labor-close): reopen handler (blocks when a generated invoice is paid)"
```

---

## Task 5: The close panel modal

**Files:**
- Create: `src/components/dashboard/LaborMonthCloseModal.tsx`

- [ ] **Step 1: Build the modal component**

Create `src/components/dashboard/LaborMonthCloseModal.tsx`. Props: the business id, displayed year/month, the salary estimate (`rawLabor+manager`, no markup), the markup-delta employer estimate, and existing `employee_costs` suppliers. RTL: first flex child renders on the RIGHT.

```tsx
"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface EmployeeSupplier { id: string; name: string; }

interface CloseLineState {
  key: string;
  supplier_id: string;
  label: string;
  estimate: number;
  amount: string; // user-entered actual
}

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: string;
  year: number;
  month: number;
  salaryEstimate: number;       // rawLabor + manager (no markup)
  employerEstimate: number;     // markup delta (pension/NI/severance proxy)
  employeeSuppliers: EmployeeSupplier[];
  onClosed: () => void;         // refresh callback
}

const monthNames = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

export function LaborMonthCloseModal({
  open, onClose, businessId, year, month,
  salaryEstimate, employerEstimate, employeeSuppliers, onClosed,
}: Props) {
  const [lines, setLines] = useState<CloseLineState[]>([]);
  const [salarySupplierId, setSalarySupplierId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On open: provision the salary supplier and pre-fill lines.
  useEffect(() => {
    if (!open) return;
    setError(null);
    (async () => {
      const res = await fetch("/api/labor-close/salary-supplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId }),
      });
      const json = await res.json();
      const salaryId = json?.supplier?.id || "";
      setSalarySupplierId(salaryId);

      const initial: CloseLineState[] = [
        { key: "salary", supplier_id: salaryId, label: "שכר עובדים", estimate: Math.round(salaryEstimate), amount: String(Math.round(salaryEstimate)) },
        ...employeeSuppliers.map((s, i) => ({
          key: `sup-${s.id}-${i}`, supplier_id: s.id, label: s.name, estimate: 0, amount: "",
        })),
      ];
      setLines(initial);
    })();
  }, [open, businessId, salaryEstimate, employeeSuppliers]);

  const addLine = () => {
    setLines((prev) => [...prev, { key: `extra-${prev.length}`, supplier_id: "", label: "", estimate: 0, amount: "" }]);
  };

  const updateLine = (key: string, patch: Partial<CloseLineState>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const estimateTotal = Math.round(salaryEstimate + employerEstimate);
  const actualTotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const payload = {
      business_id: businessId,
      year, month,
      estimate_total: estimateTotal,
      lines: lines
        .filter((l) => l.supplier_id && Number(l.amount) > 0)
        .map((l) => ({ supplier_id: l.supplier_id, amount: Number(l.amount) })),
    };
    if (payload.lines.length === 0) {
      setError("יש להזין לפחות שורה אחת עם סכום.");
      setSaving(false);
      return;
    }
    const res = await fetch("/api/labor-close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setError(json?.error || "שמירה נכשלה"); return; }
    onClosed();
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content
          dir="rtl"
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[92vw] max-w-[560px] max-h-[88vh] overflow-y-auto rounded-[12px] bg-[#1a1d2e] p-5 text-white shadow-xl"
        >
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-[17px] font-bold">
              סגירת חודש עלות עובדים — {monthNames[month - 1]} {year}
            </Dialog.Title>
            <button onClick={onClose} aria-label="סגור" className="text-white/60 hover:text-white">
              <X size={20} />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-[1fr_120px] gap-2 items-center">
                {l.supplier_id && l.key === "salary" ? (
                  <span className="text-[14px]">{l.label}</span>
                ) : l.supplier_id && l.key.startsWith("sup-") ? (
                  <span className="text-[14px]">{l.label}</span>
                ) : (
                  <select
                    value={l.supplier_id}
                    onChange={(e) => {
                      const sup = employeeSuppliers.find((s) => s.id === e.target.value);
                      updateLine(l.key, { supplier_id: e.target.value, label: sup?.name || "" });
                    }}
                    className="bg-[#252a40] rounded-[7px] px-2 py-1.5 text-[14px]"
                  >
                    <option value="">בחר ספק…</option>
                    {employeeSuppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                )}
                <input
                  type="number"
                  inputMode="decimal"
                  value={l.amount}
                  placeholder={l.estimate ? String(l.estimate) : "0"}
                  onChange={(e) => updateLine(l.key, { amount: e.target.value })}
                  className="bg-[#252a40] rounded-[7px] px-2 py-1.5 text-[14px] text-left ltr-num"
                />
              </div>
            ))}
          </div>

          <button onClick={addLine} className="mt-3 flex items-center gap-1 text-[13px] text-[#7c84d8] hover:text-white">
            <Plus size={15} /> הוסף שורה
          </button>

          <div className="mt-4 border-t border-white/10 pt-3 flex flex-col gap-1 text-[14px]">
            <div className="flex justify-between"><span className="text-white/60">סה"כ הערכה</span><span className="ltr-num">{estimateTotal.toLocaleString("he-IL")} ₪</span></div>
            <div className="flex justify-between"><span className="text-white/60">סה"כ בפועל</span><span className="ltr-num font-bold">{actualTotal.toLocaleString("he-IL")} ₪</span></div>
            <div className="flex justify-between"><span className="text-white/60">הפרש</span><span className="ltr-num">{(actualTotal - estimateTotal).toLocaleString("he-IL")} ₪</span></div>
          </div>

          {error && <p className="mt-3 text-[13px] text-[#F64E60]">{error}</p>}

          <div className="mt-5 flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-[#29318A] hover:bg-[#343da3] rounded-[8px] py-2.5 text-[15px] font-bold disabled:opacity-50"
            >
              {saving ? "סוגר…" : "סגור חודש"}
            </button>
            <button onClick={onClose} className="px-4 rounded-[8px] py-2.5 text-[15px] bg-white/10 hover:bg-white/15">ביטול</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: compiles; no type errors in `LaborMonthCloseModal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/LaborMonthCloseModal.tsx
git commit -m "feat(labor-close): close-month modal with pre-filled lines and multiple suppliers"
```

---

## Task 6: Reports (P&L) — fetch close state + flip + green + buttons

**Files:**
- Modify: `src/app/(dashboard)/reports/page.tsx`

- [ ] **Step 1: Add `business_id` to the daily_entries select**

In `reports/page.tsx` around line 720-726, change the `daily_entries` select to include `business_id`:

```typescript
          supabase
            .from("daily_entries")
            .select("total_register, labor_cost, manager_daily_cost, day_factor, business_id")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .gte("entry_date", startDate)
            .lte("entry_date", endDate),
```

- [ ] **Step 2: Fetch the close state for the displayed month**

Immediately after the `priorCommitmentsData` fetch (around line 730-736), add:

```typescript
        // Employee-cost month-close state for the displayed month.
        const { data: laborCloseData } = await supabase
          .from("labor_month_close")
          .select("business_id")
          .in("business_id", selectedBusinesses)
          .eq("period_year", year)
          .eq("period_month", month)
          .eq("status", "closed");
        const closedBusinessIds = new Set((laborCloseData || []).map((r) => r.business_id));
        // V1: treat labor as closed only when EVERY selected business is closed.
        // Exact for single-business view; conservative (keeps estimate) for partial multi-select.
        const laborMonthClosed =
          selectedBusinesses.length > 0 && selectedBusinesses.every((id) => closedBusinessIds.has(id));
```

- [ ] **Step 3: Compute the effective daily labor (zeroed when closed)**

Right after `const totalLaborCost = (rawLaborCost + computedManagerCost) * avgMarkup;` (line 822), add:

```typescript
        // When the month is closed, the actual employee-cost invoices are the
        // source of truth — drop the daily estimate to avoid double-counting.
        const effectiveLaborDaily = laborMonthClosed ? 0 : totalLaborCost;
```

- [ ] **Step 4: Use the effective value in the parent actual and the totals**

Change line 1164 (the labor branch of `parentActual`) from `totalLaborCost + laborInvoiceActual` to `effectiveLaborDaily + laborInvoiceActual`:

```typescript
          const parentActual = isGoodsCost ? Math.max(childrenActual, totalGoodsExpenses) : isLaborCost ? effectiveLaborDaily + laborInvoiceActual : childrenActual;
```

Change line 1199 from `+ totalLaborCost` to `+ effectiveLaborDaily`:

```typescript
        const allExpensesActual = totalGoodsExpenses + totalCurrentExpenses + effectiveLaborDaily;
```

- [ ] **Step 5: Flag the labor parent row as closed (for green rendering)**

In the labor parent's returned object (around lines 1169-1181), add an `isClosedLabor` field:

```typescript
          return {
            id: parent.id,
            name: parent.name,
            target: formatCurrency(parentTarget),
            actual: formatCurrency(parentActual),
            difference: formatDifference(parentDiff),
            remaining: formatPercentage(parentRemaining),
            remainingRaw: parentRemaining,
            diffRaw: parentDiff,
            actualRaw: parentActual,
            targetRaw: parentTarget,
            subcategories: subcategoriesData,
            isClosedLabor: isLaborCost && laborMonthClosed,
          };
```

Add `isClosedLabor?: boolean;` to the `ExpenseCategoryDisplay` type definition (search for `interface ExpenseCategoryDisplay` / `type ExpenseCategoryDisplay` in the file and add the field).

- [ ] **Step 6: Render the closed labor actual in green**

Find the parent category row render where `category.actual` is displayed (the parent actual value span, near lines 1530-1545). Wrap its className so that when `category.isClosedLabor` is true the actual figure is green:

```tsx
                    <span className={`text-[11px] sm:text-[14px] font-bold flex-1 min-w-0 text-center ltr-num leading-[1.4] ${category.isClosedLabor ? 'text-[#17DB4E]' : (category.diffRaw > 0 ? 'text-[#17DB4E]' : category.diffRaw < 0 ? 'text-[#F64E60]' : 'text-white')}`}>
                      {category.actual}
                    </span>
```

(Apply only to the cell that shows `category.actual` for the parent labor row. Use the existing surrounding markup; only the className expression changes.)

- [ ] **Step 7: Verify build + manual check (open month)**

Run: `npm run build` then `npm run dev`.
Open `/reports` for a business with daily labor and **no** close row. Expected: עלות עובדים shows the usual estimate, white/colored as before (no regression).

- [ ] **Step 8: Commit**

```bash
git add "src/app/(dashboard)/reports/page.tsx"
git commit -m "feat(labor-close): P&L reads close state, flips to actuals, green when closed"
```

---

## Task 7: Reports — wire the close/reopen buttons and modal

**Files:**
- Modify: `src/app/(dashboard)/reports/page.tsx`

- [ ] **Step 1: Add state, estimates, and employee-supplier list**

Near the other `useState` declarations in the component, add:

```typescript
  const [laborCloseOpen, setLaborCloseOpen] = useState(false);
  const [laborMonthClosedState, setLaborMonthClosedState] = useState(false);
  const [salaryEstimateState, setSalaryEstimateState] = useState(0);
  const [employerEstimateState, setEmployerEstimateState] = useState(0);
  const [employeeSuppliersState, setEmployeeSuppliersState] = useState<{ id: string; name: string }[]>([]);
```

Inside the data-fetch effect, after computing `laborMonthClosed`, `rawLaborCost`, `computedManagerCost`, and `avgMarkup`, persist the values the modal needs:

```typescript
        setLaborMonthClosedState(laborMonthClosed);
        setSalaryEstimateState(rawLaborCost + computedManagerCost);                 // base, no markup
        setEmployerEstimateState((rawLaborCost + computedManagerCost) * (avgMarkup - 1)); // markup delta
```

Fetch the business's `employee_costs` suppliers (add to the existing parallel fetch block, scoped to a single business — use `selectedBusinesses[0]`):

```typescript
        const { data: empSuppliers } = await supabase
          .from("suppliers")
          .select("id, name")
          .eq("business_id", selectedBusinesses[0])
          .eq("expense_type", "employee_costs")
          .eq("is_active", true)
          .is("deleted_at", null);
        setEmployeeSuppliersState((empSuppliers || []).filter((s) => s.name !== "משכורות עובדים"));
```

- [ ] **Step 2: Add the button to the labor parent row**

In the labor parent row render (Task 6 Step 6 area), add a small button after the row label. When the month is open show "סגירת חודש"; when closed show "פתח מחדש". Single-business only (David closes per business):

```tsx
                  {category.name === "עלות עובדים" && selectedBusinesses.length === 1 && (
                    laborMonthClosedState ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleReopenMonth(); }}
                        className="text-[11px] text-[#F64E60] hover:underline ms-2"
                      >פתח מחדש</button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setLaborCloseOpen(true); }}
                        className="text-[11px] text-[#7c84d8] hover:underline ms-2"
                      >סגירת חודש</button>
                    )
                  )}
```

- [ ] **Step 3: Add the reopen handler and render the modal**

Add the handler in the component body:

```typescript
  const handleReopenMonth = async () => {
    if (!confirm("פתיחה מחדש תמחק את חשבוניות הסגירה שטרם שולמו ותחזיר את ההערכה. להמשיך?")) return;
    const d = globalDateRange?.start ? new Date(globalDateRange.start) : new Date();
    const res = await fetch(
      `/api/labor-close?business_id=${selectedBusinesses[0]}&year=${d.getFullYear()}&month=${d.getMonth() + 1}`,
      { method: "DELETE" }
    );
    const json = await res.json();
    if (!res.ok) { alert(json?.error || "פתיחה מחדש נכשלה"); return; }
    window.location.reload();
  };
```

> Use whatever the file already uses for the selected month (this plan assumes `globalDateRange`/`year`/`month` from the fetch scope). If the displayed month is stored differently, pass that instead.

Render the modal near the end of the component JSX (single-business guard):

```tsx
      {selectedBusinesses.length === 1 && (
        <LaborMonthCloseModal
          open={laborCloseOpen}
          onClose={() => setLaborCloseOpen(false)}
          businessId={selectedBusinesses[0]}
          year={(globalDateRange?.start ? new Date(globalDateRange.start) : new Date()).getFullYear()}
          month={(globalDateRange?.start ? new Date(globalDateRange.start) : new Date()).getMonth() + 1}
          salaryEstimate={salaryEstimateState}
          employerEstimate={employerEstimateState}
          employeeSuppliers={employeeSuppliersState}
          onClosed={() => window.location.reload()}
        />
      )}
```

Add the import at the top:

```typescript
import { LaborMonthCloseModal } from "@/components/dashboard/LaborMonthCloseModal";
```

- [ ] **Step 4: Verify build + full manual flow**

Run: `npm run build` then `npm run dev`. On `/reports` for a single business:
1. Click "סגירת חודש" → modal opens pre-filled with the salary estimate and the employee suppliers.
2. Enter actual amounts (e.g. salary 100000, add a pension supplier 5000) → "סגור חודש".
3. Expected: עלות עובדים now shows the actual sum **in green**; the button switches to "פתח מחדש".
4. Verify the generated invoices via MCP:

```sql
SELECT i.total_amount, i.status, i.invoice_type, s.name
FROM invoices i JOIN suppliers s ON s.id = i.supplier_id
WHERE i.labor_close_id IS NOT NULL ORDER BY i.created_at DESC LIMIT 10;
```

5. Click "פתח מחדש" → confirm → labor reverts to the estimate; the close invoices are gone.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/reports/page.tsx"
git commit -m "feat(labor-close): wire close/reopen buttons and modal into the P&L labor row"
```

---

## Task 8: Dashboard — mirror the labor flip

**Files:**
- Modify: `src/app/(dashboard)/page.tsx`

- [ ] **Step 1: Locate the monthly labor figure**

In `page.tsx`, the dashboard builds a metrics object where monthly labor cost is stored (consumed later as `s.laborCost` / `laborMTD`, see ~line 886). Find the assignment that computes the month-to-date labor cost using the `(rawLabor + manager) × markup` formula (the monthly analogue of `todayLaborCost` at line 642). Read the surrounding block to identify the exact variable (e.g. `laborCostMTD` or the value assigned into the metrics object's `laborCost`).

- [ ] **Step 2: Fetch the close state**

In the dashboard's main data-fetch effect, add a query for the displayed month (use `selectedBusinesses`, `dateRange.start` for year/month):

```typescript
      const dashYear = dateRange.start.getFullYear();
      const dashMonth = dateRange.start.getMonth() + 1;
      const { data: laborCloseRows } = await supabase
        .from("labor_month_close")
        .select("business_id")
        .in("business_id", selectedBusinesses)
        .eq("period_year", dashYear)
        .eq("period_month", dashMonth)
        .eq("status", "closed");
      const dashClosedIds = new Set((laborCloseRows || []).map((r) => r.business_id));
      const dashLaborClosed =
        selectedBusinesses.length > 0 && selectedBusinesses.every((id) => dashClosedIds.has(id));

      // Actual employee-cost invoices for the month (used when closed).
      const monthStartStr = `${dashYear}-${String(dashMonth).padStart(2, "0")}-01`;
      const monthLastDay = new Date(dashYear, dashMonth, 0).getDate();
      const monthEndStr = `${dashYear}-${String(dashMonth).padStart(2, "0")}-${String(monthLastDay).padStart(2, "0")}`;
      const { data: laborActualInvoices } = dashLaborClosed
        ? await supabase
            .from("invoices")
            .select("total_amount, supplier:suppliers!inner(expense_type)")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .gte("reference_date", monthStartStr)
            .lte("reference_date", monthEndStr)
            .eq("supplier.expense_type", "employee_costs")
        : { data: [] };
      const laborActualTotal = (laborActualInvoices || []).reduce((s, r) => s + Number(r.total_amount || 0), 0);
```

- [ ] **Step 3: Substitute when closed**

At the monthly labor assignment found in Step 1, replace the daily-estimate value with the actuals when closed. For example, if the variable is `laborCostMTD`:

```typescript
      const laborCostMTD = dashLaborClosed ? laborActualTotal : laborCostMTDEstimate;
```

Use the actual variable name discovered in Step 1; rename the existing estimate expression to `…Estimate` and add the closed branch. Ensure every downstream consumer (percentage, diff, charts) uses the substituted value.

- [ ] **Step 4: Green when closed**

Find where the dashboard renders the monthly labor cost figure (the עלות עובדים card/number). Add a green override when `dashLaborClosed` is true, matching the existing color convention:

```tsx
                  className={`… ${dashLaborClosed ? 'text-[#17DB4E]' : /* existing color logic */}`}
```

Store `dashLaborClosed` in component state (like `laborMonthClosedState` in reports) so the render can read it.

- [ ] **Step 5: Verify build + manual check**

Run: `npm run build` then `npm run dev`. Open `/` (dashboard) for the business closed in Task 7. Expected: the monthly עלות עובדים figure equals the actual invoice sum and is green. For an open-month business: unchanged.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/page.tsx"
git commit -m "feat(labor-close): dashboard mirrors the labor source-of-truth flip"
```

---

## Task 9: Estimate breakdown during the open month (optional polish)

**Files:**
- Modify: `src/app/(dashboard)/reports/page.tsx`

David asked to *see* the employer-cost estimate split out during the month. The labor parent already renders virtual sub-rows (`__labor_employees__`, `__labor_manager__`, lines ~1120-1155). Add a third virtual sub-row for the employer estimate so the open month visibly shows שכר vs עלויות מעביד.

- [ ] **Step 1: Add an employer-estimate virtual sub-row**

In the `virtualSubs` block (after the manager sub at ~line 1141-1154), add (only when the month is open and the delta is positive):

```typescript
            const employerEstimate = (rawLaborCost + computedManagerCost) * (avgMarkup - 1);
            if (!laborMonthClosed && employerEstimate > 0) {
              virtualSubs.push({
                id: "__labor_employer__",
                name: "עלויות מעביד (הערכה)",
                target: "—",
                actual: formatCurrency(employerEstimate),
                difference: "—",
                remaining: "—",
                remainingRaw: 0,
                diffRaw: 0,
                actualRaw: employerEstimate,
                targetRaw: 0,
                suppliers: [],
              });
            }
```

> This is display-only; the parent total already includes the markup, so adding this row does not change any sum. When closed, this row is omitted and the real invoice sub-rows show instead.

- [ ] **Step 2: Verify + commit**

Run: `npm run build`. Open `/reports`; confirm an open month shows "עלויות מעביד (הערכה)" under עלות עובדים and the parent total is unchanged.

```bash
git add "src/app/(dashboard)/reports/page.tsx"
git commit -m "feat(labor-close): show employer-cost estimate row during open month"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Source-of-truth flip → Tasks 6, 8. ✓
- `labor_month_close` table + `labor_close_id` + `system_kind` → Task 1. ✓
- Multiple suppliers per category (David's clarification) → Task 5 (`addLine`, supplier dropdown), Task 3 (lines array). ✓
- Green when closed (David's clarification) → Task 6 Step 6, Task 8 Step 4. ✓
- Close panel pre-fill + estimate-vs-actual → Task 5. ✓
- Reopen with paid-invoice block → Task 4. ✓
- Estimate breakdown during month → Task 9. ✓
- All businesses, opt-in-by-action, no business_type gate → no gate added; nothing changes until a close row exists. ✓
- Salary system supplier → Task 3 Step 2. ✓

**Known V1 limitations (documented in code comments):**
- Multi-business partial close keeps the estimate (only all-closed flips). Exact for single-business view.
- No "pay now" inside the panel (payables flow through existing screens).
- Atomicity is compensating-delete, not a DB transaction (matches existing codebase style).

**Type consistency:** `LaborMonthClose`, `system_kind`, `labor_close_id`, `isClosedLabor`, `laborMonthClosed`/`dashLaborClosed`, `salaryEstimate`/`employerEstimate` used consistently across tasks.
