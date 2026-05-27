# Customer Monthly Billing Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a summary-cards + month-by-month table to the customer detail Sheet in `/customers`, showing how much each customer was supposed to pay, how much they paid, and how much is open — derived live from existing data (no DB changes).

**Architecture:** All logic lives inside the existing client component `src/app/(dashboard)/customers/page.tsx`. A single `useMemo` (`billingSummary`) computes the monthly breakdown from `selectedItem.customer` + `selectedItem.business.vat_percentage` + `payments` state. A new JSX section is inserted into the customer detail Sheet between the existing "ריטיינר" section and "מוצרים ושירותים" section.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4 (RTL), existing Supabase client (no new queries).

**Spec:** [docs/superpowers/specs/2026-05-27-customer-monthly-billing-table-design.md](../specs/2026-05-27-customer-monthly-billing-table-design.md)

---

## File Structure

**Modified files (1):**
- `src/app/(dashboard)/customers/page.tsx`
  - Add a TypeScript type `BillingRow` and `BillingSummary` near other type defs (top of file, near line 80).
  - Add `billingSummary` `useMemo` near other computed values (~line 416, right after `totalIncome`).
  - Insert the new JSX section in the detail Sheet between line 1916 (end of retainer section) and line 1919 (start of services section).

**No new files. No new imports.** All Tailwind utilities and Lucide icons already in use.

**Testing:** Manual smoke test via `npm run dev` against existing customer data. No automated tests added — this is pure presentation logic over already-fetched and already-realtime-synced state.

---

## Task 1: Add types for billing rows

**Files:**
- Modify: `src/app/(dashboard)/customers/page.tsx` (~line 113, after `CustomerDocument` interface, before `BusinessMember`)

- [ ] **Step 1: Add the two new types**

Insert immediately before the `BusinessMember` interface (line 115):

```typescript
// Computed monthly billing row (derived from retainer + payments)
type BillingRowStatus = 'paid' | 'partial' | 'open' | 'overpaid' | 'no-charge';

interface BillingRow {
  key: string;            // "2026-03"
  label: string;          // "מרץ 2026"
  expected: number;       // VAT-inclusive (net if customer.is_foreign)
  paid: number;
  open: number;           // max(0, expected - paid)
  overpaid: number;       // max(0, paid - expected)
  status: BillingRowStatus;
}

interface BillingSummary {
  totalExpected: number;
  totalPaid: number;
  totalOpen: number;
  rows: BillingRow[];     // newest first
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors (the types are not yet referenced).

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/customers/page.tsx
git commit -m "feat(customers): add BillingRow/BillingSummary types for monthly view"
```

---

## Task 2: Add `billingSummary` useMemo

**Files:**
- Modify: `src/app/(dashboard)/customers/page.tsx` (~line 423, right after `totalIncome` and before `// ─── Handlers ───`)

- [ ] **Step 1: Insert the computed memo**

After this existing block (around line 422):
```typescript
const totalIncome = payments.reduce((sum, p) => sum + Number(p.amount), 0);
```

Insert:

```typescript
// Per-customer monthly billing breakdown. Returns null when the section
// should not render (no retainer + no payments). All amounts are
// VAT-inclusive unless customer.is_foreign === true.
const billingSummary = useMemo<BillingSummary | null>(() => {
  const customer = selectedItem?.customer;
  if (!customer) return null;

  const retainerAmount = Number(customer.retainer_amount) || 0;
  const hasRetainer = retainerAmount > 0;
  const hasPayments = payments.length > 0;
  if (!hasRetainer && !hasPayments) return null;

  // VAT
  const vatRate = Number(selectedItem?.business?.vat_percentage) || 0.18;
  const vatMultiplier = customer.is_foreign ? 1 : 1 + vatRate;
  const monthlyExpectedGross = retainerAmount * vatMultiplier;

  // Build month range — anchored to the 1st of each month.
  // Start: retainer_start_date → work_start_date → earliest payment date.
  // End: min(retainer_end_date || today, today). Never show future months.
  const parseDate = (s: string | null | undefined): Date | null => {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  let startDate =
    parseDate(customer.retainer_start_date) ||
    parseDate(customer.work_start_date);
  if (!startDate && hasPayments) {
    const earliest = payments
      .map(p => parseDate(p.payment_date))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (earliest) startDate = earliest;
  }
  if (!startDate) return null;

  const today = new Date();
  const endCap = parseDate(customer.retainer_end_date);
  const endDate = endCap && endCap < today ? endCap : today;

  // Anchor both to 1st of month for clean iteration
  const startAnchor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endAnchor = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  if (startAnchor > endAnchor) {
    // Start is in the future — return empty rows, summary cards still render with zeros.
    return { totalExpected: 0, totalPaid: 0, totalOpen: 0, rows: [] };
  }

  // Build list of {year, month} from start to end inclusive
  const monthsAsc: { year: number; month: number }[] = [];
  const cursor = new Date(startAnchor);
  let safety = 0;
  while (cursor <= endAnchor && safety < 120) {
    monthsAsc.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
    cursor.setMonth(cursor.getMonth() + 1);
    safety++;
  }

  // Pre-bucket payments by "YYYY-M" for O(1) lookup
  const paidByMonth = new Map<string, number>();
  for (const p of payments) {
    const d = parseDate(p.payment_date);
    if (!d) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    paidByMonth.set(key, (paidByMonth.get(key) || 0) + Number(p.amount));
  }

  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const startKey = `${startAnchor.getFullYear()}-${startAnchor.getMonth()}`;

  const rows: BillingRow[] = [];
  for (const m of monthsAsc) {
    const key = `${m.year}-${m.month}`;
    const isStartMonth = key === startKey;
    const isCurrentOrFuture =
      m.year > currentYear ||
      (m.year === currentYear && m.month >= currentMonth);

    // Expected
    let expected = 0;
    if (hasRetainer) {
      if (customer.retainer_status === 'paused') {
        // Past months keep their expected, current/future months go to 0.
        // We can't infer when the pause started from current schema —
        // this is the documented V1 limitation (spec §10).
        expected = isCurrentOrFuture ? 0 : monthlyExpectedGross;
      } else if (customer.retainer_type === 'one_time') {
        expected = isStartMonth ? monthlyExpectedGross : 0;
      } else if (
        customer.retainer_type === 'monthly' ||
        customer.retainer_type === 'fixed_term'
      ) {
        expected = monthlyExpectedGross;
      }
    }

    const paid = paidByMonth.get(key) || 0;

    // Skip months with neither expected nor paid (keeps the table focused)
    if (expected === 0 && paid === 0) continue;

    const open = Math.max(0, expected - paid);
    const overpaid = Math.max(0, paid - expected);

    let status: BillingRowStatus;
    if (expected === 0 && paid > 0) status = 'overpaid';
    else if (paid + 0.01 >= expected) status = 'paid';
    else if (paid > 0) status = 'partial';
    else status = 'open';

    const label = new Date(m.year, m.month, 1).toLocaleDateString('he-IL', {
      month: 'long',
      year: 'numeric',
    });

    rows.push({ key, label, expected, paid, open, overpaid, status });
  }

  // Newest first
  rows.reverse();

  const totalExpected = rows.reduce((s, r) => s + r.expected, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  const totalOpen = rows.reduce((s, r) => s + r.open, 0);

  return { totalExpected, totalPaid, totalOpen, rows };
}, [selectedItem, payments]);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors. (`billingSummary` is declared but unused — that's fine, JSX comes next.)

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/customers/page.tsx
git commit -m "feat(customers): compute monthly billing breakdown per customer"
```

---

## Task 3: Render summary cards + monthly table in detail Sheet

**Files:**
- Modify: `src/app/(dashboard)/customers/page.tsx` (insert at line 1917 — between end of retainer section `</div> )}` and `{/* ── Services Section ──────────────── */}`)

- [ ] **Step 1: Insert the new section**

Find this existing block (around line 1915-1919):

```jsx
                  )}
                </div>
              )}


              {/* ── Services Section ──────────────── */}
```

Replace with:

```jsx
                  )}
                </div>
              )}

              {/* ── Monthly Billing Summary + Table ──────────────── */}
              {billingSummary && (
                <div className="bg-[#6B21A8]/15 border border-[#7C3AED]/30 rounded-[10px] p-[15px] mb-[15px]">
                  <h3 className="text-[15px] font-bold text-[#C4B5FD] text-right mb-[12px]">
                    סיכום הכנסות
                  </h3>

                  {/* Summary cards — RTL: first child renders right */}
                  <div className="grid grid-cols-3 gap-[10px] mb-[15px]">
                    {/* Right: total expected */}
                    <div className="bg-white/5 rounded-[7px] p-[10px] flex flex-col items-center">
                      <span className="text-[12px] text-white/60 text-center">סה&quot;כ צריך לשלם</span>
                      <span dir="ltr" className="text-[18px] font-bold text-white">
                        ₪{billingSummary.totalExpected.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    {/* Center: total paid */}
                    <div className="bg-white/5 rounded-[7px] p-[10px] flex flex-col items-center">
                      <span className="text-[12px] text-white/60 text-center">סה&quot;כ שולם</span>
                      <span dir="ltr" className="text-[18px] font-bold text-[#0BB783]">
                        ₪{billingSummary.totalPaid.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    {/* Left: open */}
                    <div className="bg-white/5 rounded-[7px] p-[10px] flex flex-col items-center">
                      <span className="text-[12px] text-white/60 text-center">פתוח לתשלום</span>
                      <span dir="ltr" className={`text-[18px] font-bold ${billingSummary.totalOpen > 0 ? "text-[#F64E60]" : "text-white/50"}`}>
                        ₪{billingSummary.totalOpen.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {/* Monthly table — only if there are rows */}
                  {billingSummary.rows.length > 0 && (
                    <>
                      <h4 className="text-[14px] font-semibold text-white text-right mb-[8px]">
                        פירוט חודשי
                      </h4>
                      <div className="w-full flex flex-col">
                        {/* Header — RTL: first child renders right (חודש on right, סטטוס on left) */}
                        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1.2fr] bg-[#29318A] rounded-t-[7px] p-[10px_5px] pe-[13px] items-center text-[13px] font-semibold text-white">
                          <div className="text-center">חודש</div>
                          <div className="text-center">צריך</div>
                          <div className="text-center">שולם</div>
                          <div className="text-center">פתוח</div>
                          <div className="text-center">סטטוס</div>
                        </div>

                        {/* Rows */}
                        <div className="max-h-[320px] overflow-y-auto flex flex-col gap-[3px] mt-[3px]">
                          {billingSummary.rows.map((row) => {
                            const badgeClasses =
                              row.status === "paid"
                                ? "bg-[#0BB783]/20 text-[#0BB783]"
                                : row.status === "partial"
                                ? "bg-[#F6A609]/20 text-[#F6A609]"
                                : row.status === "open"
                                ? "bg-[#F64E60]/20 text-[#F64E60]"
                                : row.status === "overpaid"
                                ? "bg-[#3F97FF]/20 text-[#3F97FF]"
                                : "bg-white/10 text-white/50";
                            const badgeLabel =
                              row.status === "paid"
                                ? "✓ שולם"
                                : row.status === "partial"
                                ? "חלקי"
                                : row.status === "open"
                                ? "פתוח"
                                : row.status === "overpaid"
                                ? "עודף"
                                : "—";
                            return (
                              <div
                                key={row.key}
                                className="grid grid-cols-[2fr_1fr_1fr_1fr_1.2fr] w-full p-[8px_5px] bg-white/5 hover:bg-white/10 rounded-[5px] items-center"
                              >
                                <div className="text-center text-[13px] text-white">{row.label}</div>
                                <div dir="ltr" className="text-center text-[13px] text-white">
                                  {row.expected > 0
                                    ? `₪${row.expected.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
                                    : "—"}
                                </div>
                                <div dir="ltr" className="text-center text-[13px] text-white">
                                  {row.paid > 0
                                    ? `₪${row.paid.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
                                    : "—"}
                                </div>
                                <div dir="ltr" className={`text-center text-[13px] font-medium ${row.open > 0 ? "text-[#F64E60]" : "text-white/40"}`}>
                                  {row.open > 0
                                    ? `₪${row.open.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
                                    : "—"}
                                </div>
                                <div className="text-center">
                                  <span className={`text-[11px] px-[8px] py-[2px] rounded-full font-bold ${badgeClasses}`}>
                                    {badgeLabel}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}


              {/* ── Services Section ──────────────── */}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors. (If it takes too long, `npx next lint --dir src/app/(dashboard)/customers` is an acceptable fallback.)

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/customers/page.tsx
git commit -m "feat(customers): add monthly billing summary cards + breakdown table"
```

---

## Task 4: Manual smoke test in dev server

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Server starts on port 3000.

- [ ] **Step 2: Navigate to customers page**

Open `http://localhost:3000/customers` in a browser. Log in if needed.

- [ ] **Step 3: Test active retainer customer**

Click a customer card with an active monthly retainer (look for purple amount + "פעיל" badge).
Expected:
- New "סיכום הכנסות" section appears between "ריטיינר" and "מוצרים ושירותים"
- 3 cards visible (right to left): "סה\"כ צריך לשלם" / "סה\"כ שולם" / "פתוח לתשלום"
- "פירוט חודשי" table below shows one row per month from retainer start to current month
- Months where `paid >= expected` show green "✓ שולם" badge
- Months where `paid > 0` but `< expected` show orange "חלקי" badge
- Months with `paid = 0` show red "פתוח" badge
- "חודש" header is on the RIGHT side of the table, "סטטוס" on the LEFT
- All currency values render LTR (numerals left-to-right inside RTL cells)

- [ ] **Step 4: Test customer with no retainer but with payments**

Find or pick a customer with `retainer_amount = 0/null` but who has ad-hoc payments.
Expected:
- Section renders
- "סה\"כ צריך לשלם" = ₪0, "סה\"כ שולם" = sum, "פתוח" = ₪0
- Table only shows months that had payments
- All rows show "עודף" badge (since expected = 0)

- [ ] **Step 5: Test customer with no retainer and no payments**

Click a customer with no retainer and no payment history.
Expected: The "סיכום הכנסות" section does NOT render. (Other sections render normally.)

- [ ] **Step 6: Test foreign customer**

Find a customer with `is_foreign = true`.
Expected:
- Expected amounts equal `retainer_amount` exactly (no VAT multiplier applied)
- Foreign badge still shows in the existing customer-info section

- [ ] **Step 7: Test paused retainer**

Find or pause a customer's retainer (use the "השהה ריטיינר" button if available).
Expected:
- Past months retain their expected amount
- Current month and forward show `expected = 0` (rows skipped if also `paid = 0`)
- The "מושהה" badge in the retainer section continues to display

- [ ] **Step 8: Test completed retainer**

Find a customer with `retainer_status = 'completed'` and a `retainer_end_date`.
Expected:
- No rows past `retainer_end_date`
- Last billed month is the month of `retainer_end_date`

- [ ] **Step 9: Stop dev server**

Press `Ctrl+C` in the terminal where `npm run dev` is running.

- [ ] **Step 10: Mark all steps complete**

If all smoke tests passed, this task is complete. If any failed, return to the relevant earlier task and fix.

---

## Task 5: Push to git remote

**Files:** none (git push only)

- [ ] **Step 1: Verify all commits look right**

Run: `git log --oneline master ^origin/master`
Expected: 3 new local commits (types, useMemo, JSX) plus the existing spec commit from earlier.

- [ ] **Step 2: Verify nothing untracked or uncommitted**

Run: `git status`
Expected: "nothing to commit, working tree clean" (or only known untracked files like `.agent-ready/`, `CODEMAP.md`, `.aiignore`).

- [ ] **Step 3: Push to amazpen-app remote**

Run:
```bash
git push https://<PAT>@github.com/Amazpen/amazpen-app.git master
```

(PAT from MEMORY.md — no username, PAT only in the URL. See `Git Push — Amazpen` entry.)

Expected: "Writing objects: ..." progress, ending with branch updated successfully.

- [ ] **Step 4: Verify remote is up to date**

Run: `git status`
Expected: "Your branch is up to date with 'origin/master'." (or equivalent — branch may not track origin, that's fine as long as the push succeeded).

---

## Self-Review Notes

- **Spec coverage:** All sections of the spec map to tasks:
  - Spec §3 Architecture → Task 1 (types) + Task 2 (useMemo location)
  - Spec §4 Compute logic → Task 2 (all sub-rules implemented in the memo)
  - Spec §5 UI → Task 3 (cards + table JSX)
  - Spec §6 RTL → Task 3 (DOM order: "סה\"כ צריך" first, "חודש" first; ltr-num via `dir="ltr"` on currency cells)
  - Spec §7 Edge cases → Task 2 handles all 10 listed cases (foreign, paused, completed, no retainer, future start, etc.)
  - Spec §8 Testing → Task 4 (steps 3-8 cover smoke tests 1-7; test 9 = empty state in step 5; test 10 = RTL check in step 3)
- **No placeholders:** Every code block is complete and ready to paste. No "TBD" or "similar to" references.
- **Type consistency:** `BillingRow`, `BillingSummary`, `BillingRowStatus` defined once in Task 1, referenced identically in Tasks 2 and 3.
- **Frequent commits:** 3 commits during implementation (types → logic → UI), then 1 push at the end.
