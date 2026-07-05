# Managed product monthly prices (מחיר מוצר מנוהל לפי חודש)

Date: 2026-07-05. Requested by David. Approved by Netanel.

## Problem

`managed_products.unit_cost` is a single global price. Reports multiply historical monthly quantities by the CURRENT price, so raising עוף from 33.9 to 39 in צ'יקן אין rewrites every past month's cost. 7 calc sites use current price; 6 use the per-day snapshot `daily_product_usage.unit_cost_at_time` - so reports also disagree with each other.

## David's decisions

1. Price change applies from the change date onward; the past keeps the old price.
2. Past months stay at the old price in all reports.
3. Backfilling a missing day in an old month gets THAT month's price.
4. A per-month price table, same UX as the "שכר מנהל, אחוז העמסה ומע"מ לפי חודש" grid in business edit.

## Design

### DB

New table `managed_product_monthly_prices`:
- `id uuid pk`, `business_id uuid`, `product_id uuid -> managed_products`, `year int`, `month int (1-12)`, `unit_cost numeric NOT NULL`, timestamps.
- `UNIQUE (product_id, year, month)`.
- RLS: separate SELECT/INSERT/UPDATE/DELETE policies, each `is_business_member(business_id) OR is_admin()`.

`managed_products.unit_cost` stays and means "current/default price".

### Resolution rule (single shared resolver)

Price for product P in month M:
1. Explicit row for (P, M) if exists.
2. Else most recent explicit row before M (walk back).
3. Else `managed_products.unit_cost`.

Implemented once in `src/lib/managedProductPrices.ts` (pure resolve fn + fetch helper), used by every report/calc site. Price granularity is MONTHLY: a mid-month change applies to the whole current month, including days already entered in it.

### Business edit page

- New per-month grid "מחירי מוצרים מנוהלים לפי חודש": 12 months back, a column per product. Empty = inherits from previous month (shown as placeholder), explicit value always wins, X clears. Same diff-save pattern as managerSalaryByMonth (explicit diffs vs original + clearedKeys, never wipe on state-loss).
- Historical preservation: when a product's main price field changes, write the OLD price into all months from HISTORICAL_START_YEAR (2024) up to the previous month, preserve-if-existing (never overwrite an explicit per-month value). Same as writeHistorical for manager salary.

### Calculations - ALL sites use the resolver (uniformity)

Switch every managed-product cost calc to `quantity × resolvedPrice(product, entryMonth)`:
- src/lib/metrics/expenses.ts, src/lib/metrics/goals.ts
- src/app/api/metrics/refresh/route.ts, business-summary-report, weekly-summary, ai/chat (~2223)
- src/app/(dashboard)/page.tsx (4 sites: today, monthly, months chart, daily chart)
- insights/page.tsx, goals/page.tsx, HistoryModal.tsx, DailyEntriesModal.tsx

The formerly-correct at_time sites also move to the resolver so that editing a past month's price updates EVERY report consistently.

### Save paths - stamp resolved price

All daily_product_usage writers stamp `unit_cost_at_time = resolvedPrice(product, entry_date month)` instead of current price / 0:
- DailyEntryForm.tsx (~937), DailyEntriesModal.tsx (~632), admin/daily-entries (~499 fill-missing, ~644 overwrite import), ocr/page.tsx (~1276), ocr-business/page.tsx (~1089), useOfflineSync.ts (~119, currently stamps 0), api/intake/daily-entry (~178, currently defaults 0).

`unit_cost_at_time` is kept as an audit trail but is no longer a source of truth for reports.

### Out of scope

- No per-day pricing.
- No target_pct per month.

### Verification

צ'יקן אין (33.9 -> 39): April-June stay 33.9 in dashboard/summary/weekly; July shows 39; backfilling a May day stamps 33.9; setting an explicit May override updates May everywhere.
