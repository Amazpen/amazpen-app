# Customer Monthly Billing Table — Design Spec

**Date:** 2026-05-27
**Status:** Draft → pending user review
**Scope:** `/customers` page — customer detail Sheet (popup that opens on card click)

---

## 1. Goal

When a user clicks a customer card in `/customers`, the detail Sheet should expose, per customer:

1. **Total revenue summary** (since work-start): how much they were supposed to pay, how much they paid, how much is still open.
2. **Customer type + billing day + start date** — already present in the existing "ריטיינר" section, kept as-is.
3. **Monthly breakdown table** — one row per month from the retainer start through today: expected charge, actual paid, open balance, status badge.

The table must let the operator see at a glance which months were fully paid, which are short, and which are unpaid.

## 2. Non-Goals

- No DB schema changes. No new tables, no migrations.
- No manual per-month override of expected amount (defer until users actually ask for it).
- No historical retainer-amount tracking (if `retainer_amount` changes today, historical months reflect the new amount — acceptable for V1; out-of-scope follow-up listed in §10).
- No future-month projection (months past today are not rendered).
- No editing payments/services from the new table (existing handlers in the Sheet remain the only entry points).

## 3. Architecture

### 3.1 Location
A new section inside the existing customer-detail `Sheet` in [src/app/(dashboard)/customers/page.tsx](src/app/(dashboard)/customers/page.tsx), inserted **between** the existing "ריטיינר" section (~line 1794) and the existing "מוצרים ושירותים" section (~line 1920).

The section is rendered only when `selectedItem.customer` exists AND at least one of:
- `customer.retainer_amount > 0`, OR
- `payments.length > 0`

Customer with no retainer and no payments → section is omitted entirely.

### 3.2 Data sources (all already fetched in current code)
- `selectedItem.customer` — for `retainer_amount`, `retainer_type`, `retainer_start_date`, `retainer_end_date`, `retainer_status`, `is_foreign`, `work_start_date`
- `selectedItem.business.vat_percentage` — for VAT multiplier
- `payments` state — array of `customer_payments` rows, already fetched by `fetchPayments` in `handleOpenDetail`
- `services` state — **not used** for V1 (services are tracked separately and don't fit the retainer billing model); listed as a follow-up in §10

### 3.3 Compute path
A single `useMemo` (let's call it `billingSummary`) that takes the inputs above and returns:

```ts
type BillingRow = {
  key: string;          // "2026-03"
  label: string;        // "מרץ 2026"
  expected: number;     // VAT-inclusive (or net if is_foreign)
  paid: number;
  open: number;         // max(0, expected - paid)
  overpaid: number;     // max(0, paid - expected)
  status: 'paid' | 'partial' | 'open' | 'overpaid' | 'no-charge';
};

type BillingSummary = {
  totalExpected: number;
  totalPaid: number;
  totalOpen: number;     // sum of row.open across all months
  rows: BillingRow[];    // newest first
} | null;                // null when section should not render
```

Returns `null` to signal "do not render this section."

## 4. Compute Logic

### 4.1 VAT
```ts
const vatMultiplier = customer.is_foreign
  ? 1
  : 1 + (Number(business.vat_percentage) || 0.18);
const monthlyExpectedNet = Number(customer.retainer_amount) || 0;
const monthlyExpectedGross = monthlyExpectedNet * vatMultiplier;
```
All amounts displayed in the table and summary cards are VAT-inclusive (gross).

### 4.2 Month range
- **Start:** `customer.retainer_start_date` if set, otherwise `customer.work_start_date`, otherwise the earliest payment date.
- **End:** `min(customer.retainer_end_date || today, today)` — never render future months.
- Iterate month-by-month, anchored to the 1st of each month, inclusive of both endpoints.
- Hard cap: if range exceeds 120 months (10 years), truncate to most recent 120 — defensive only; real customers won't hit this.

### 4.3 Expected amount per month
For each month `m`:
- `m < startMonth` → `expected = 0` (out of range, but if a payment exists in that month it still appears as a row with status `overpaid` / no-charge — see §4.6)
- `m > endMonth` → not rendered at all (already cut by range)
- `customer.retainer_status === 'paused'` → `expected = 0` for **all** months *in the paused state*. We can't tell *when* the pause started from current schema, so V1 treats "currently paused" as "no expected charge for any month going forward from now." Past months retain their expected amount.
  - **Implementation:** apply `expected = 0` only for months `>= currentMonth` when status is paused.
- `customer.retainer_status === 'completed'` → `expected = 0` for months after `retainer_end_date` (already filtered by range cap).
- `customer.retainer_type === 'one_time'` → `expected = monthlyExpectedGross` only for `startMonth`; all other months `expected = 0`.
- `customer.retainer_type === 'monthly'` or `'fixed_term'` and status `'active'` → `expected = monthlyExpectedGross` for every month in range.
- `customer.retainer_type` is null/empty → `expected = 0` for all months (treated as "no retainer, only payments").

### 4.4 Paid amount per month
Sum of `customer_payments.amount` where `payment_date` falls in month `m` (local timezone — use `new Date(p.payment_date).getMonth/getFullYear`).

### 4.5 Open / overpaid
```ts
open = Math.max(0, expected - paid);
overpaid = Math.max(0, paid - expected);
```
Open never goes negative — overpayment is tracked separately, not as a credit against next month.

### 4.6 Status derivation
```ts
if (expected === 0 && paid === 0) status = 'no-charge';  // hidden row in V1 — see §4.7
else if (expected === 0 && paid > 0)  status = 'overpaid';
else if (paid >= expected)            status = 'paid';   // exact-match or +tolerance
else if (paid > 0)                    status = 'partial';
else                                  status = 'open';
```
Use `epsilon = 0.01` for paid >= expected comparison (avoid floating-point false positives).

### 4.7 Row inclusion
A month is included in `rows` if:
- `expected > 0`, OR
- `paid > 0`

Months with both = 0 (e.g., paused gap with no payments) are skipped — keeps the table focused on actionable data.

### 4.8 Totals
- `totalExpected = sum(rows[].expected)`
- `totalPaid = sum(rows[].paid)`
- `totalOpen = sum(rows[].open)`

Note `totalOpen` is the sum of clamped per-row opens, so overpayments in one month don't cancel underpayments in another. This matches the operator's intuition ("how much money is still owed to me, considering each month separately").

## 5. UI

### 5.1 Summary cards
Container styled like the existing retainer section: `bg-[#6B21A8]/15 border border-[#7C3AED]/30 rounded-[10px] p-[15px] mb-[15px]`.

Header: `<h3 className="text-[15px] font-bold text-[#C4B5FD] text-right mb-[12px]">סיכום הכנסות</h3>`

3-column grid (RTL — first child renders right):
```jsx
<div className="grid grid-cols-3 gap-[10px] mb-[15px]">
  {/* Right: total expected */}
  <Card label='סה"כ צריך לשלם' value={totalExpected} valueClass="text-white" />
  {/* Center: total paid */}
  <Card label='סה"כ שולם' value={totalPaid} valueClass="text-[#0BB783]" />
  {/* Left: open */}
  <Card label="פתוח לתשלום" value={totalOpen}
        valueClass={totalOpen > 0 ? "text-[#F64E60]" : "text-white/50"} />
</div>
```
Each card: `bg-white/5 rounded-[7px] p-[10px] flex flex-col items-center`
Label: `text-[12px] text-white/60`
Value: `text-[18px] font-bold ltr-num` + `₪` prefix + `toLocaleString("he-IL")`

### 5.2 Monthly table
Below the summary cards, same container. Header: `<h4 className="text-[14px] font-semibold text-white text-right mb-[8px]">פירוט חודשי</h4>`

Follow the **mandatory table pattern from MEMORY.md** (the invoice table in expenses/page.tsx). NOT `<table>`, NOT `sticky thead`, NOT separate grids — one `div` with `grid grid-cols-[...]`, header + rows sharing the exact same grid template.

```jsx
<div className="w-full flex flex-col">
  {/* Header row */}
  <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1.2fr] bg-[#29318A] rounded-t-[7px] p-[10px_5px] pe-[13px] items-center text-[13px] font-semibold text-white">
    <div className="text-center">חודש</div>
    <div className="text-center">צריך</div>
    <div className="text-center">שולם</div>
    <div className="text-center">פתוח</div>
    <div className="text-center">סטטוס</div>
  </div>

  {/* Rows */}
  <div className="max-h-[320px] overflow-y-auto flex flex-col gap-[3px] mt-[3px]">
    {rows.map(row => (
      <div key={row.key}
           className="grid grid-cols-[2fr_1fr_1fr_1fr_1.2fr] w-full p-[8px_5px] bg-white/5 hover:bg-white/10 rounded-[5px] items-center">
        <div className="text-center text-[13px] text-white">{row.label}</div>
        <div className="text-center text-[13px] text-white ltr-num">
          {row.expected > 0 ? `₪${row.expected.toLocaleString("he-IL")}` : "—"}
        </div>
        <div className="text-center text-[13px] text-white ltr-num">
          {row.paid > 0 ? `₪${row.paid.toLocaleString("he-IL")}` : "—"}
        </div>
        <div className={`text-center text-[13px] ltr-num font-medium ${row.open > 0 ? 'text-[#F64E60]' : 'text-white/40'}`}>
          {row.open > 0 ? `₪${row.open.toLocaleString("he-IL")}` : "—"}
        </div>
        <div className="text-center">
          <StatusBadge status={row.status} />
        </div>
      </div>
    ))}
  </div>
</div>
```

Header `pe-[13px]` compensates for the rows' scrollbar (per MEMORY.md table-alignment rule).

### 5.3 Status badge component
Inline JSX (not extracted), follows existing badge styles in the file:

| Status | Background | Text | Label |
|--------|-----------|------|-------|
| `paid` | `bg-[#0BB783]/20` | `text-[#0BB783]` | `✓ שולם` |
| `partial` | `bg-[#F6A609]/20` | `text-[#F6A609]` | `חלקי` |
| `open` | `bg-[#F64E60]/20` | `text-[#F64E60]` | `פתוח` |
| `overpaid` | `bg-[#3F97FF]/20` | `text-[#3F97FF]` | `עודף` |
| `no-charge` | n/a (row hidden) | n/a | n/a |

Badge: `text-[11px] px-[8px] py-[2px] rounded-full font-bold`

### 5.4 Empty state
If `billingSummary === null` → the entire section (cards + table) is not rendered. No empty-state placeholder.

If `billingSummary !== null` but `rows.length === 0` (e.g., retainer set but `retainer_start_date` is in the future) → render the summary cards (all zeroes) and skip the table; the cards alone communicate "nothing to bill yet."

### 5.5 Hebrew month labels
Use `Date.prototype.toLocaleDateString("he-IL", { month: "long", year: "numeric" })` → "מרץ 2026" / "ינואר 2025".

## 6. RTL Considerations

Per CLAUDE.md and [feedback_rtl_dom_order_reversed.md](C:\Users\netn1\.claude\projects\c--Users-netn1-Downloads-amazpen-new\memory\feedback_rtl_dom_order_reversed.md):

- **Summary cards** (right→center→left visually): "סה\"כ צריך לשלם" first in DOM, "סה\"כ שולם" second, "פתוח" third.
- **Table header columns** (right→left visually): "חודש" first in DOM, "סטטוס" last.
- Use `ltr-num` class on currency cells so numerals render left-to-right inside the RTL row.
- Use `pe-[13px]` (logical end padding) not `pr-`/`pl-` — already convention in this codebase.

## 7. Edge Cases

| Case | Behavior |
|------|----------|
| Customer with no retainer, only ad-hoc payments | Render section. Cards: `totalExpected = 0`, `totalPaid = sum`, `totalOpen = 0`. Table shows one row per month-with-payment, all `expected = 0`, status = `overpaid`. |
| Retainer set but `retainer_start_date` in future | `billingSummary` is non-null but `rows.length === 0`. Render summary cards (zeroed), skip table. |
| `retainer_status = 'paused'` mid-history | Past months keep their expected. From current month forward, `expected = 0`. (Limitation acknowledged — full pause history is §10 follow-up.) |
| `retainer_status = 'completed'` | Months after `retainer_end_date` are excluded from range; final billed months reflect actual expected. |
| `is_foreign = true` | All amounts shown without VAT (`vatMultiplier = 1`). |
| Payment dated before `retainer_start_date` | Month is included if `paid > 0`. Status = `overpaid` (since `expected = 0`). |
| Payment dated after `retainer_end_date` | Same as above — out-of-range month with payment shows as `overpaid`. |
| `retainer_type = 'one_time'` with multiple payments across months | Only start month has `expected > 0`. Other months with payments show as `overpaid`. |
| `retainer_amount` is null or 0 but retainer fields populated | Treated as "no retainer" — `expected = 0` everywhere. |
| Floating-point on summed totals | Use `.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })` to avoid 3000.000000001 displays. |
| `retainer_start_date` is invalid date string | Fall back to `work_start_date`; if that's also invalid, fall back to earliest payment date; if no payments, return `null` (section not rendered). |

## 8. Testing Plan

Manual smoke tests in the running app (`npm run dev`):

1. **Active monthly retainer, all paid** — open a customer who pays exactly the retainer every month. Expect all rows green (`✓ שולם`), `totalOpen = 0`.
2. **Active monthly retainer, partial month** — customer who paid ₪1,500 of ₪3,000 this month. Expect `partial` badge, correct `open` amount, `totalOpen` reflects it.
3. **Active monthly retainer, unpaid month** — customer who didn't pay last month. Expect `open` badge, totals correct.
4. **Foreign customer** — confirm no VAT applied (`expected = retainer_amount` exactly).
5. **One-time retainer** — only the start month has expected; subsequent months only show if they have payments.
6. **Paused retainer** — past months unchanged, current/future months `expected = 0`, status `no-charge` (hidden) unless paid.
7. **Completed retainer with `retainer_end_date`** — no rows past end date.
8. **Customer with no retainer, only ad-hoc payments** — section renders, only payment months shown, all `overpaid`.
9. **Customer with no retainer and no payments** — section does not render at all.
10. **RTL check** — verify "חודש" is on the right of the header, "סטטוס" on the left. Verify summary cards: "סה\"כ צריך" rightmost, "פתוח" leftmost.

No automated tests added — this is presentation logic over already-fetched data; existing realtime hooks already refresh payments.

## 9. Out of Scope (V1)

- Editing per-month expected amount (manual override).
- Tracking retainer-amount history (handles retroactive amount changes).
- Future-month projection / forecast.
- Pause/resume history (knowing which specific months were paused).
- Including `customer_services` rows in expected/paid calculations.
- Exporting the table to CSV/PDF.
- Marking individual months as "settled" / "written off."
- Drilling from a table row into the payments that fed it.

## 10. Follow-Up Candidates (NOT in V1)

If the operator hits real friction with §9 items, the most likely first follow-ups:

1. **Per-month override** — small `customer_billing_overrides` table (`customer_id, month, expected_override`) to handle one-off discounts or extra charges. Drives §9.1.
2. **Retainer-amount history** — `customer_retainer_history` table snapshotting `(retainer_amount, effective_from)` on every change. Drives §9.2 and properly handles backdated rate changes.
3. **Click row → show payments for that month** — drill-down popup. Cheap to add once §9.10 (above) is requested.
4. **Include services in totals** — toggle to fold `customer_services` rows into the monthly view; needs a clear UX for "services aren't periodic" first.

## 11. Files Touched

- `src/app/(dashboard)/customers/page.tsx` — single file change. Add the `billingSummary` `useMemo` near the existing `monthlyPayments` computation (~line 416), and inject the new JSX section in the detail Sheet (~line 1916, before "מוצרים ושירותים").

No new files. No new imports beyond what's already in `page.tsx`.
