# תשלום חלקי לספקים (Partial Payment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user record a lump-sum supplier payment on the OCR screen that closes the oldest open invoices in full via FIFO and leaves exactly one invoice flagged `partial` (yellow "תשלום חלקי") with its remaining balance visible across the app.

**Architecture:** A pure FIFO allocation function drives both a preview modal (opened from the OCR payment tab) and a shared persistence helper called by both OCR approve handlers. Partial allocation is stored in the existing `payment_invoice_links.amount_allocated` primitive; the leftover invoice gets `status='partial'` and `amount_paid` (used only for display). All screens that list open invoices add `'partial'` to their status filters so the debt never disappears.

**Tech Stack:** Next.js 16 / React 19 / TypeScript (strict), Supabase (`@supabase/supabase-js`), Tailwind 4 (RTL, dark), Radix Dialog (shadcn), Vitest (`npm test`, `src/**/*.test.ts`).

## Global Constraints

- Hebrew RTL app. In flex rows the **first** JSX child renders on the **RIGHT**. Use `text-align: start`, logical spacing (`ms-*`/`me-*`), and `ltr-num`/`dir="ltr"` for numbers/₪.
- No em dash (—) in UI text; use " - ".
- Supabase: `.maybeSingle()` by default; never `Math.random()`/`new Date()` in React render/initial-state; read balances via `payment_invoice_links.amount_allocated` (the report's source of truth), NOT `invoices.amount_paid` (legacy/unreliable).
- Partial-payment allocation is **exact** to the entered amount - do NOT reuse the regular flow's ₪5 tolerance. Float rounding tolerance is `EPS = 0.005`.
- The OCR approve logic is duplicated in `ocr/page.tsx` and `ocr-business/page.tsx` - both must get identical behavior via one shared helper.
- Status label text is exactly **"תשלום חלקי"**, color yellow (`#FFC107` / existing `#FFA500` amber family).
- Currency in ₪, 2 decimals, `toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`.

---

### Task 1: FIFO allocation function (pure, tested)

**Files:**
- Create: `src/lib/payments/allocatePartialPayment.ts`
- Test: `src/lib/payments/allocatePartialPayment.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AllocInvoice = { id: string; balance: number }`
  - `type AllocLine = { invoice_id: string; amount_allocated: number; new_status: 'paid' | 'partial'; remaining_balance: number }`
  - `type AllocResult = { lines: AllocLine[]; fullyPaidIds: string[]; partialId: string | null; totalAllocated: number; overpay: number }`
  - `function allocatePartialPayment(invoicesOldestFirst: AllocInvoice[], paymentAmount: number): AllocResult`
  - `const ALLOC_EPS = 0.005`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/payments/allocatePartialPayment.test.ts
import { describe, it, expect } from "vitest";
import { allocatePartialPayment } from "./allocatePartialPayment";

const inv = (id: string, balance: number) => ({ id, balance });

describe("allocatePartialPayment", () => {
  it("closes oldest in full and leaves one partial", () => {
    // oldest -> newest: 100, 200, 300 ; pay 250
    const r = allocatePartialPayment([inv("a", 100), inv("b", 200), inv("c", 300)], 250);
    expect(r.fullyPaidIds).toEqual(["a"]);
    expect(r.partialId).toBe("b");
    expect(r.lines).toEqual([
      { invoice_id: "a", amount_allocated: 100, new_status: "paid", remaining_balance: 0 },
      { invoice_id: "b", amount_allocated: 150, new_status: "partial", remaining_balance: 50 },
    ]);
    expect(r.totalAllocated).toBe(250);
    expect(r.overpay).toBe(0);
  });

  it("marks all paid when amount equals sum (no partial)", () => {
    const r = allocatePartialPayment([inv("a", 100), inv("b", 200)], 300);
    expect(r.fullyPaidIds).toEqual(["a", "b"]);
    expect(r.partialId).toBeNull();
    expect(r.overpay).toBe(0);
  });

  it("marks only the oldest partial when amount is below the first balance", () => {
    const r = allocatePartialPayment([inv("a", 100), inv("b", 200)], 40);
    expect(r.fullyPaidIds).toEqual([]);
    expect(r.partialId).toBe("a");
    expect(r.lines).toEqual([
      { invoice_id: "a", amount_allocated: 40, new_status: "partial", remaining_balance: 60 },
    ]);
  });

  it("reports overpay and does not allocate beyond balances", () => {
    const r = allocatePartialPayment([inv("a", 100)], 130);
    expect(r.fullyPaidIds).toEqual(["a"]);
    expect(r.partialId).toBeNull();
    expect(r.totalAllocated).toBe(100);
    expect(r.overpay).toBeCloseTo(30, 5);
  });

  it("treats sub-agora rounding as a full close", () => {
    const r = allocatePartialPayment([inv("a", 100)], 99.999);
    expect(r.fullyPaidIds).toEqual(["a"]);
    expect(r.partialId).toBeNull();
    expect(r.lines[0].amount_allocated).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/payments/allocatePartialPayment.test.ts`
Expected: FAIL — "Failed to resolve import ./allocatePartialPayment" / function not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/payments/allocatePartialPayment.ts

// Rounding tolerance (half an agora). NOT the regular flow's ₪5 business
// tolerance — partial allocation is exact to the entered amount, this only
// absorbs float noise so 99.999 closes a ₪100 invoice.
export const ALLOC_EPS = 0.005;

export type AllocInvoice = { id: string; balance: number };

export type AllocLine = {
  invoice_id: string;
  amount_allocated: number;
  new_status: "paid" | "partial";
  remaining_balance: number;
};

export type AllocResult = {
  lines: AllocLine[];
  fullyPaidIds: string[];
  partialId: string | null;
  totalAllocated: number;
  overpay: number;
};

// FIFO: caller passes invoices already sorted oldest -> newest. Each invoice's
// `balance` is its current OPEN amount (total minus prior allocations). We close
// invoices in full while the payment covers them, then the first invoice the
// payment can't fully cover becomes `partial`. Untouched invoices are omitted
// from `lines` (they stay open/pending — the caller does not change them).
export function allocatePartialPayment(
  invoicesOldestFirst: AllocInvoice[],
  paymentAmount: number
): AllocResult {
  const lines: AllocLine[] = [];
  const fullyPaidIds: string[] = [];
  let partialId: string | null = null;
  let remaining = paymentAmount;
  let totalAllocated = 0;

  for (const invItem of invoicesOldestFirst) {
    if (remaining <= ALLOC_EPS) break;
    const balance = invItem.balance;
    if (remaining + ALLOC_EPS >= balance) {
      // Fully covers this invoice.
      lines.push({ invoice_id: invItem.id, amount_allocated: balance, new_status: "paid", remaining_balance: 0 });
      fullyPaidIds.push(invItem.id);
      remaining -= balance;
      totalAllocated += balance;
    } else {
      // Partial close — this is the single leftover invoice.
      const allocated = remaining;
      lines.push({
        invoice_id: invItem.id,
        amount_allocated: allocated,
        new_status: "partial",
        remaining_balance: balance - allocated,
      });
      partialId = invItem.id;
      totalAllocated += allocated;
      remaining = 0;
      break;
    }
  }

  return {
    lines,
    fullyPaidIds,
    partialId,
    totalAllocated,
    overpay: Math.max(0, remaining),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/payments/allocatePartialPayment.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/allocatePartialPayment.ts src/lib/payments/allocatePartialPayment.test.ts
git commit -m "feat(payments): FIFO partial-payment allocation function"
```

---

### Task 2: Shared persistence helper

**Files:**
- Create: `src/lib/payments/applyPartialPaymentAllocation.ts`

**Interfaces:**
- Consumes: `allocatePartialPayment`, `AllocInvoice` from Task 1.
- Produces: `async function applyPartialPaymentAllocation(supabase: SupabaseClient, args: { paymentId: string; invoiceIds: string[]; paymentAmount: number }): Promise<void>`

This helper is I/O (Supabase); the FIFO math it delegates is already unit-tested in Task 1. Verify it in Task 8 (in-app). Do NOT write a DB integration test here.

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/payments/applyPartialPaymentAllocation.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { allocatePartialPayment, type AllocInvoice } from "./allocatePartialPayment";

// Persists a lump-sum partial payment across the selected invoices.
// Balance of each invoice = total_amount minus already-allocated links, so a
// previously-partial invoice is handled correctly. Fully-covered invoices ->
// status 'paid'; the single leftover -> status 'partial' + amount_paid (for
// the OCR remaining display). amount_allocated links are the report's truth.
export async function applyPartialPaymentAllocation(
  supabase: SupabaseClient,
  args: { paymentId: string; invoiceIds: string[]; paymentAmount: number }
): Promise<void> {
  const { paymentId, invoiceIds, paymentAmount } = args;
  if (invoiceIds.length === 0) return;

  // Fetch invoices + prior allocations to compute the current open balance.
  const [{ data: invRows }, { data: priorLinks }] = await Promise.all([
    supabase.from("invoices").select("id, total_amount, invoice_date").in("id", invoiceIds),
    supabase.from("payment_invoice_links").select("invoice_id, amount_allocated").in("invoice_id", invoiceIds),
  ]);

  const priorByInvoice = new Map<string, number>();
  for (const l of priorLinks || []) {
    const id = l.invoice_id as string;
    priorByInvoice.set(id, (priorByInvoice.get(id) || 0) + Number(l.amount_allocated || 0));
  }

  // Oldest -> newest. Balance floored at 0.
  const ordered: (AllocInvoice & { total: number })[] = (invRows || [])
    .map((inv) => {
      const total = Number(inv.total_amount) || 0;
      const prior = priorByInvoice.get(inv.id as string) || 0;
      return { id: inv.id as string, total, balance: Math.max(0, total - prior), date: inv.invoice_date as string };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const result = allocatePartialPayment(ordered, paymentAmount);
  const totalById = new Map(ordered.map((o) => [o.id, o.total]));

  // Insert one link per allocated invoice.
  for (const line of result.lines) {
    await supabase.from("payment_invoice_links").insert({
      payment_id: paymentId,
      invoice_id: line.invoice_id,
      amount_allocated: line.amount_allocated,
    });
  }

  // Fully-paid invoices -> 'paid'.
  if (result.fullyPaidIds.length > 0) {
    await supabase.from("invoices").update({ status: "paid" }).in("id", result.fullyPaidIds);
  }

  // Leftover invoice -> 'partial' + amount_paid = total - remaining (display only).
  if (result.partialId) {
    const partialLine = result.lines.find((l) => l.invoice_id === result.partialId);
    const total = totalById.get(result.partialId) || 0;
    const amountPaid = total - (partialLine?.remaining_balance ?? 0);
    await supabase
      .from("invoices")
      .update({ status: "partial", amount_paid: amountPaid })
      .eq("id", result.partialId);
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors referencing `applyPartialPaymentAllocation.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/payments/applyPartialPaymentAllocation.ts
git commit -m "feat(payments): shared partial-payment persistence helper"
```

---

### Task 3: PartialPaymentModal (the "מסך חישוב")

**Files:**
- Create: `src/components/ocr/PartialPaymentModal.tsx`

**Interfaces:**
- Consumes: `allocatePartialPayment` (Task 1).
- Produces:
  - `type PartialModalInvoice = { id: string; invoice_number: string | null; invoice_date: string; total_amount: number; balance: number }`
  - `function PartialPaymentModal(props: { open: boolean; onClose: () => void; invoices: PartialModalInvoice[]; initialAmount: number; onConfirm: (r: { paymentAmount: number; selectedInvoiceIds: string[] }) => void }): JSX.Element`

- [ ] **Step 1: Write the component**

```tsx
// src/components/ocr/PartialPaymentModal.tsx
"use client";

import { useMemo, useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { allocatePartialPayment, ALLOC_EPS } from "@/lib/payments/allocatePartialPayment";

export type PartialModalInvoice = {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  total_amount: number;
  balance: number;
};

const fmt = (n: number) =>
  n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PartialPaymentModal({
  open,
  onClose,
  invoices,
  initialAmount,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  invoices: PartialModalInvoice[];
  initialAmount: number;
  onConfirm: (r: { paymentAmount: number; selectedInvoiceIds: string[] }) => void;
}) {
  // Oldest -> newest (FIFO order shown to the user).
  const ordered = useMemo(
    () => [...invoices].sort((a, b) => new Date(a.invoice_date).getTime() - new Date(b.invoice_date).getTime()),
    [invoices]
  );

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState<string>("");

  // Seed on open: all checked, amount = initialAmount.
  useEffect(() => {
    if (!open) return;
    setChecked(new Set(ordered.map((i) => i.id)));
    setAmount(initialAmount > 0 ? String(initialAmount) : "");
  }, [open, ordered, initialAmount]);

  const paymentAmount = parseFloat(amount) || 0;
  const checkedOrdered = ordered.filter((i) => checked.has(i.id));
  const selectedSum = checkedOrdered.reduce((s, i) => s + i.balance, 0);
  const remaining = selectedSum - paymentAmount;
  const isOverpay = paymentAmount > selectedSum + ALLOC_EPS;

  const preview = useMemo(
    () => allocatePartialPayment(checkedOrdered.map((i) => ({ id: i.id, balance: i.balance })), paymentAmount),
    [checkedOrdered, paymentAmount]
  );

  const canConfirm = paymentAmount > ALLOC_EPS && checkedOrdered.length > 0 && !isOverpay;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const statusFor = (id: string): "paid" | "partial" | null =>
    preview.lines.find((l) => l.invoice_id === id)?.new_status ?? null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#0f1535] border-[#4C526B] text-white rounded-[20px] p-[20px] sm:max-w-[560px]" dir="rtl">
        <DialogHeader className="border-b border-[#4C526B] pb-[14px]">
          <DialogTitle className="text-right text-[18px] font-bold text-white">תשלום חלקי</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-[14px] max-h-[70vh] overflow-y-auto">
          {/* Amount */}
          <div className="flex flex-col gap-[6px]">
            <label className="text-[13px] text-white/60 text-right">סכום התשלום</label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="bg-[#0f1535] border-[#727BA0] text-white text-center h-[44px] rounded-[10px]"
            />
          </div>

          {/* Three figures */}
          <div className="grid grid-cols-3 gap-[8px] text-center">
            <div className="bg-[#232B6A]/40 rounded-[10px] p-[8px]">
              <p className="text-[11px] text-white/50">סכום החשבוניות שנבחרו</p>
              <p className="text-[15px] font-semibold ltr-num">&#8362;{fmt(selectedSum)}</p>
            </div>
            <div className="bg-[#232B6A]/40 rounded-[10px] p-[8px]">
              <p className="text-[11px] text-white/50">סכום התשלום</p>
              <p className="text-[15px] font-semibold ltr-num">&#8362;{fmt(paymentAmount)}</p>
            </div>
            <div className="bg-[#232B6A]/40 rounded-[10px] p-[8px]">
              <p className="text-[11px] text-white/50">נותר לתשלום</p>
              <p className={`text-[15px] font-semibold ltr-num ${remaining < 0 ? "text-red-400" : "text-white"}`}>
                &#8362;{fmt(Math.max(0, remaining))}
              </p>
            </div>
          </div>

          {isOverpay && (
            <p className="text-[12px] text-red-400 text-right">שילמת יותר מהחוב הפתוח שנבחר. הקטן את הסכום או בחר עוד חשבוניות.</p>
          )}

          {/* Invoice list (oldest -> newest) with checkbox + preview badge */}
          <div className="flex flex-col gap-[6px]">
            {ordered.map((invItem) => {
              const st = checked.has(invItem.id) ? statusFor(invItem.id) : null;
              const partialLine = preview.lines.find((l) => l.invoice_id === invItem.id && l.new_status === "partial");
              return (
                <label
                  key={invItem.id}
                  className="flex items-center gap-[8px] bg-[#0f1535] border border-[#4C526B] rounded-[8px] px-[10px] py-[8px] cursor-pointer"
                >
                  <input type="checkbox" checked={checked.has(invItem.id)} onChange={() => toggle(invItem.id)} />
                  <span className="text-[13px] text-white/80 flex-1 text-right">
                    {invItem.invoice_number || "ללא מספר"} · {invItem.invoice_date}
                  </span>
                  <span className="text-[12px] text-white/60 ltr-num">&#8362;{fmt(invItem.balance)}</span>
                  {st === "paid" && <span className="text-[10px] text-green-400">נסגר</span>}
                  {st === "partial" && (
                    <span className="text-[10px] text-[#FFC107]">תשלום חלקי · נותר &#8362;{fmt(partialLine?.remaining_balance ?? 0)}</span>
                  )}
                </label>
              );
            })}
          </div>

          <div className="flex gap-[10px] pt-[5px]">
            <Button
              onClick={() => onConfirm({ paymentAmount, selectedInvoiceIds: checkedOrdered.map((i) => i.id) })}
              disabled={!canConfirm}
              className="flex-1 bg-[#4956D4] hover:bg-[#5A67E0] text-white text-[14px] font-semibold py-[10px] rounded-[10px] disabled:opacity-40"
            >
              אישור
            </Button>
            <Button variant="ghost" onClick={onClose} className="flex-1 text-white/60 text-[14px] py-[10px] rounded-[10px]">
              ביטול
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors in `PartialPaymentModal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ocr/PartialPaymentModal.tsx
git commit -m "feat(ocr): partial-payment calculation modal"
```

---

### Task 4: OCRForm integration — button, modal, query, remaining display

**Files:**
- Modify: `src/types/ocr.ts` (add `is_partial_payment` to `OCRFormData`, ~:147)
- Modify: `src/components/ocr/OCRForm.tsx` (type ~:614, query ~:678-693, formData ~:2500, UI ~:4599-4608)

**Interfaces:**
- Consumes: `PartialPaymentModal`, `PartialModalInvoice` (Task 3).
- Produces: `formData.is_partial_payment: boolean` and `payment_linked_invoice_ids` (the modal's selected ids) consumed by Task 5.

- [ ] **Step 1: Add the flag to OCRFormData**

In `src/types/ocr.ts`, after `payment_linked_invoice_ids?: string[];` (~:147) add:

```ts
  // Payment tab: when true, the approve handler runs exact FIFO partial-payment
  // allocation (close oldest in full, leave one 'partial') instead of the
  // regular ₪5-tolerance paid-marking.
  is_partial_payment?: boolean;
```

- [ ] **Step 2: Add amount_paid to the open-invoice query + type**

In `OCRForm.tsx`, extend the `PaymentOpenInvoice` type (~:614) to include `amount_paid`:

```ts
  type PaymentOpenInvoice = { id: string; invoice_number: string | null; invoice_date: string; total_amount: number; status: string; clarification_reason: string | null; notes: string | null; amount_paid: number };
```

In the query `.select(...)` (~:678) add `amount_paid` and add `'partial'` to the status filter (~:681):

```ts
        .select('id, invoice_number, invoice_date, total_amount, status, clarification_reason, notes, amount_paid')
        .eq('business_id', selectedBusinessId)
        .eq('supplier_id', paymentTabSupplierId)
        .in('status', ['pending', 'clarification', 'partial'])
```

In the `mapped` builder (~:685-693) add `amount_paid`:

```ts
        amount_paid: Number(inv.amount_paid) || 0,
```

- [ ] **Step 3: Add partial-modal state + import**

Near the top of `OCRForm.tsx` with the other imports, add:

```ts
import { PartialPaymentModal, type PartialModalInvoice } from "./PartialPaymentModal";
```

With the other payment-tab `useState`s (near ~:615-618) add:

```ts
  const [showPartialModal, setShowPartialModal] = useState(false);
  const [isPartialPayment, setIsPartialPayment] = useState(false);
```

- [ ] **Step 4: Reset the partial flag when the supplier or selection changes**

Inside the existing supplier-change effect that resets `paymentSelectedInvoiceIds` (the effect at ~:665-705, in its early-return AND after a successful load), set `setIsPartialPayment(false)`. Add it right after each `setPaymentSelectedInvoiceIds(new Set())` call in that effect (there are two: the early guard ~:668 and after mapping ~:695):

```ts
      setIsPartialPayment(false);
```

- [ ] **Step 5: Add the "תשלום חלקי" button + render the modal**

In the open-invoices header row (~:4599-4608), the current block is:

```tsx
          <div className="flex items-center justify-between">
            <label className="text-[15px] font-medium text-white">
              חשבוניות פתוחות ({paymentOpenInvoices.length})
            </label>
            <span className="text-[13px] text-white/60 ltr-num">
              {paymentSelectedInvoiceIds.size > 0 && (
                <>נבחרו {paymentSelectedInvoiceIds.size} - &#8362;{paymentSelectedInvoicesTotal.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
              )}
            </span>
          </div>
```

Replace it with (adds a button on the LEFT — last in DOM for RTL — that opens the modal; disabled until at least one invoice is selected):

```tsx
          <div className="flex items-center justify-between gap-[8px]">
            <label className="text-[15px] font-medium text-white">
              חשבוניות פתוחות ({paymentOpenInvoices.length})
            </label>
            <div className="flex items-center gap-[10px]">
              <span className="text-[13px] text-white/60 ltr-num">
                {paymentSelectedInvoiceIds.size > 0 && (
                  <>נבחרו {paymentSelectedInvoiceIds.size} - &#8362;{paymentSelectedInvoicesTotal.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
                )}
              </span>
              <button
                type="button"
                disabled={paymentSelectedInvoiceIds.size === 0}
                onClick={() => setShowPartialModal(true)}
                className="text-[12px] px-[10px] py-[5px] rounded-[8px] bg-[#FFC107]/15 text-[#FFC107] border border-[#FFC107]/40 disabled:opacity-40"
              >
                תשלום חלקי
              </button>
            </div>
          </div>

          <PartialPaymentModal
            open={showPartialModal}
            onClose={() => setShowPartialModal(false)}
            initialAmount={paymentSelectedInvoicesTotal}
            invoices={paymentOpenInvoices
              .filter((i) => paymentSelectedInvoiceIds.has(i.id))
              .map<PartialModalInvoice>((i) => ({
                id: i.id,
                invoice_number: i.invoice_number,
                invoice_date: i.invoice_date,
                total_amount: i.total_amount,
                balance: i.total_amount - (i.amount_paid || 0),
              }))}
            onConfirm={({ paymentAmount, selectedInvoiceIds }) => {
              setPaymentSelectedInvoiceIds(new Set(selectedInvoiceIds));
              setIsPartialPayment(true);
              setPaymentMethods((prev) =>
                prev.map((pm, i) => (i === 0 ? { ...pm, amount: paymentAmount.toFixed(2) } : pm))
              );
              setShowPartialModal(false);
            }}
          />
```

- [ ] **Step 6: Send the flag in formData**

In the payment-branch `formData` object (~:2482-2502), add after `payment_linked_invoice_ids`:

```ts
        is_partial_payment: isPartialPayment,
```

- [ ] **Step 7: Show remaining balance for partial invoices in the list**

Find where each open-invoice row renders its `total_amount` inside the month group (the rows under `groupByMonth(paymentOpenInvoices, ...)`, below ~:4618). For any row where `inv.status === 'partial'`, show the remaining next to the total. Locate the row's amount span and add beside it:

```tsx
                          {inv.status === 'partial' && (
                            <span className="text-[10px] text-[#FFC107] me-[4px]">
                              נותר &#8362;{(inv.total_amount - (inv.amount_paid || 0)).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          )}
```

(If the exact row markup differs, place this span in the same flex container as the invoice's total so the yellow "נותר" reads next to it.)

- [ ] **Step 8: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/types/ocr.ts src/components/ocr/OCRForm.tsx
git commit -m "feat(ocr): partial-payment button, modal wiring, remaining display"
```

---

### Task 5: Wire the partial branch into both OCR approve handlers

**Files:**
- Modify: `src/app/(dashboard)/ocr/page.tsx` (~:996-1110, payment branch)
- Modify: `src/app/(dashboard)/ocr-business/page.tsx` (~:812-925, payment branch)

**Interfaces:**
- Consumes: `applyPartialPaymentAllocation` (Task 2), `formData.is_partial_payment` (Task 4).

Both files have an identical payment branch. Apply the SAME two edits to each.

- [ ] **Step 1: Import the helper (both files)**

At the top of each file, add:

```ts
import { applyPartialPaymentAllocation } from "@/lib/payments/applyPartialPaymentAllocation";
```

- [ ] **Step 2: Force `invoice_id: null` for partial payments (both files)**

In the `payments` insert, the line currently reads:

```ts
              invoice_id: selectedInvoicesArr.length === 1 ? selectedInvoicesArr[0] : null,
```

Replace with (a partial payment always relies on links, never the single FK, to avoid double-counting in the pending report):

```ts
              invoice_id: formData.is_partial_payment ? null : (selectedInvoicesArr.length === 1 ? selectedInvoicesArr[0] : null),
```

- [ ] **Step 3: Branch the allocation logic (both files)**

The current allocation + status block is two consecutive `if`s: `if (selectedInvoicesArr.length > 1) { ...links... }` (`ocr/page.tsx` ~:1065-1080) followed by `if (formData.payment_linked_invoice_ids && ...length > 0) { ...₪5 status... }` (~:1082-1109). Wrap BOTH in an else so partial takes a separate path. Replace from the start of the `if (selectedInvoicesArr.length > 1)` line through the end of the ₪5 status block's closing `}` with:

```ts
          if (formData.is_partial_payment && selectedInvoicesArr.length > 0) {
            // Exact FIFO partial allocation: close oldest in full, leave one 'partial'.
            await applyPartialPaymentAllocation(supabase, {
              paymentId: newPayment.id,
              invoiceIds: selectedInvoicesArr,
              paymentAmount: totalAmount,
            });
          } else {
            if (selectedInvoicesArr.length > 1) {
              const { data: invDetails } = await supabase
                .from('invoices')
                .select('id, total_amount')
                .in('id', selectedInvoicesArr);
              let remaining = totalAmount;
              for (const inv of invDetails || []) {
                const allocated = Math.min(Number(inv.total_amount), remaining);
                remaining -= allocated;
                await supabase.from('payment_invoice_links').insert({
                  payment_id: newPayment.id,
                  invoice_id: inv.id,
                  amount_allocated: allocated,
                });
              }
            }

            if (formData.payment_linked_invoice_ids && formData.payment_linked_invoice_ids.length > 0) {
              const { data: selectedInvs } = await supabase
                .from('invoices')
                .select('id, total_amount')
                .in('id', formData.payment_linked_invoice_ids);
              if (selectedInvs) {
                const invoicesTotal = selectedInvs.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
                const diff = Math.abs(invoicesTotal - totalAmount);
                if (diff <= 5) {
                  await supabase
                    .from('invoices')
                    .update({ status: 'paid' })
                    .in('id', formData.payment_linked_invoice_ids);
                } else {
                  const sorted = [...selectedInvs].sort((a, b) => Number(a.total_amount) - Number(b.total_amount));
                  let remaining = totalAmount;
                  const toMarkPaid: string[] = [];
                  for (const inv of sorted) {
                    const invAmount = Number(inv.total_amount);
                    if (invAmount <= remaining + 1) {
                      toMarkPaid.push(inv.id as string);
                      remaining -= invAmount;
                    }
                  }
                  if (toMarkPaid.length > 0) {
                    await supabase.from('invoices').update({ status: 'paid' }).in('id', toMarkPaid);
                  }
                }
              }
            }
          }
```

> Note: `ocr-business/page.tsx` has the same two blocks at ~:881-896 and ~:898-925 — apply the identical wrap there. Keep the inner code byte-for-byte the same as what's already in that file (it is identical to `ocr/page.tsx`).

- [ ] **Step 4: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/ocr/page.tsx" "src/app/(dashboard)/ocr-business/page.tsx"
git commit -m "feat(ocr): run FIFO partial allocation in both approve handlers"
```

---

### Task 6: Surface `partial` status in reports

**Files:**
- Modify: `src/app/(dashboard)/payments/page.tsx` (pending query ~:3781, status badges ~:5524-5526)
- Modify: `src/lib/metrics/suppliers.ts` (open-total ~:325-343)

**Interfaces:** none produced; display only.

- [ ] **Step 1: Include `partial` in the pending-payments open query**

In `payments/page.tsx` ~:3781, change:

```ts
          .in("status", ["pending", "clarification"])
```
to:
```ts
          .in("status", ["pending", "clarification", "partial"])
```

- [ ] **Step 2: Add the yellow "תשלום חלקי" badge**

In `payments/page.tsx`, next to the existing status badges (~:5524-5526):

```tsx
                                          {inv.status === "paid" && <span className="text-[10px] text-green-400 mr-[3px]">(שולם)</span>}
                                          {inv.status === "clarification" && <span className="text-[10px] text-[#FFA500] mr-[3px]">(בבירור)</span>}
```
add, in the same group:
```tsx
                                          {inv.status === "partial" && <span className="text-[10px] text-[#FFC107] mr-[3px]">(תשלום חלקי)</span>}
```

- [ ] **Step 3: Include partial remaining in the supplier open total**

In `src/lib/metrics/suppliers.ts`, the inline invoice type (~:325-331) omits `amount_paid`. Add it:

```ts
  const allInvoices =
    (invoicesData as Array<{
      subtotal: number | null;
      total_amount: number | null;
      status: string;
      amount_paid: number | null;
      invoice_date: string | null;
    }> | null) || [];
```

Then change the open-total (~:340-343) so `partial` invoices count only their remaining (`total_amount - amount_paid`), while `pending`/`clarification` count full:

```ts
  const openInvoicesTotal =
    allInvoices
      .filter((inv) => inv.status === "pending" || inv.status === "clarification" || inv.status === "partial")
      .reduce((sum, inv) => {
        const total = Number(inv.total_amount) || 0;
        const remaining = inv.status === "partial" ? total - (Number(inv.amount_paid) || 0) : total;
        return sum + remaining;
      }, 0) + dnsPurchasesSum;
```

(The `.select(...)` at ~:315 already includes `amount_paid` — no query change needed.)

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/payments/page.tsx" src/lib/metrics/suppliers.ts
git commit -m "feat(payments): show partial status in pending report and supplier open total"
```

---

### Task 7: Verify the partial-payment deletion reverts status

**Files:**
- Inspect: `src/app/(dashboard)/payments/page.tsx` (payment delete/edit path, ~:3102-3200)

The spec flags a risk: deleting a partial payment must revert its invoice from `partial` back to `pending` (and drop the `partial` invoice from the OCR/report list correctly). The existing edit path rebuilds links; deletion needs to reset status.

- [ ] **Step 1: Find the payment delete handler**

Run: `grep -n "from('payments').delete\|deletePayment\|handleDeletePayment\|deleted_at" "src/app/(dashboard)/payments/page.tsx" | head`
Read the surrounding function.

- [ ] **Step 2: Ensure invoices touched by the deleted payment revert**

In the delete handler, before/after removing the payment + its links, collect the affected `invoice_id`s (from `payment_invoice_links` for that payment plus the payment's own `invoice_id`), then for each recompute: if it currently has `status IN ('paid','partial')` and, after this payment's links are removed, its remaining balance `> 0.01`, set `status='pending'` and `amount_paid=0`. If the existing handler already recomputes invoice status on delete, confirm it now handles `'partial'` too (add `'partial'` wherever it checks `=== 'paid'`). Show the minimal patch you applied.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit (only if a change was needed)**

```bash
git add "src/app/(dashboard)/payments/page.tsx"
git commit -m "fix(payments): revert invoice status to pending when a partial payment is deleted"
```

---

### Task 8: End-to-end verification

**Files:** none (manual + build).

- [ ] **Step 1: Full test + build**

Run: `npm test && npm run build`
Expected: all Vitest tests pass; build succeeds.

- [ ] **Step 2: In-app smoke test**

Start dev (`npm run dev`, port 3000). With a supplier that has 3 open invoices (e.g. ₪100, ₪200, ₪300, ascending dates):
1. OCR screen → payment tab → pick the supplier → select all 3 → click "תשלום חלקי".
2. In the modal, enter ₪250. Confirm the three figures read: נבחרו ₪600 / תשלום ₪250 / נותר ₪350, and the preview shows invoice #1 "נסגר", #2 "תשלום חלקי · נותר ₪150", #3 untouched. Enter ₪700 → overpay warning blocks confirm.
3. Confirm at ₪250. Pick a payment method + date, approve.
4. Verify: invoice #1 `paid`, #2 shows yellow "(תשלום חלקי)" with remaining ₪150, #3 `pending`.
5. Check the "ממתינים לתשלום" report shows #2 with balance ₪150 and #3 with ₪300; supplier open total = ₪450.
6. Re-open OCR payment tab for the supplier → #2 appears with "נותר ₪150".
7. Delete the payment → #2 reverts to `pending` with full ₪200 open (Task 7).

- [ ] **Step 3: Report results**

Confirm each expected value above. If any differs, stop and fix before proceeding.

---

## Self-Review

**Spec coverage:**
- Button "תשלום חלקי" → Task 4 (OCR payment tab only). ✓
- Calc screen (selected sum / payment / remaining) → Task 3 modal. ✓
- Close by date (FIFO), leave one partial (yellow) → Task 1 + Task 2 + Task 5. ✓
- Manual override (checkboxes) → Task 3. ✓
- Overpay blocked → Task 1 (`overpay`) + Task 3 (`canConfirm`/warning). ✓
- Exact allocation, no ₪5 tolerance → Task 1 (`ALLOC_EPS`), Task 5 (separate branch). ✓
- `partial` visible everywhere (don't let debt vanish) → Task 4 (OCR query+list), Task 6 (pending report badge + query, supplier open total). ✓
- OCR shows remaining + which invoice → Task 4 Step 7. ✓
- Deletion reverts status → Task 7. ✓

**Placeholder scan:** No TBD/TODO. Task 7 Step 2 is intentionally investigative (existing delete code not yet read) with an explicit rule + patch requirement, not a vague "handle it".

**Type consistency:** `allocatePartialPayment(invoicesOldestFirst, paymentAmount)` returns `{ lines, fullyPaidIds, partialId, totalAllocated, overpay }` — used consistently in Tasks 2 and 3. `AllocInvoice = { id, balance }` used in Task 2's `ordered` map and Task 3's preview. `is_partial_payment` set in Task 4, read in Task 5. `PartialModalInvoice` has `balance` computed as `total_amount - amount_paid` in Task 4, consumed in Task 3.
