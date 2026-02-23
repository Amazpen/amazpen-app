# Cash Flow Forecast Page - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the existing `/cashflow` page with a daily cash flow forecast table that shows when money actually enters/leaves the bank, based on income settlement rules and payment split due dates.

**Architecture:** Extend `income_sources` table with settlement rule columns (type, delay, fees). Create `cashflow_settings` table for opening balance. Create `cashflow_income_overrides` for manual edits. Build a new page component that calculates daily projected bank balance by applying settlement rules to `daily_income_breakdown` data and pulling expenses from `payment_splits` by `due_date`. Expandable drill-down shows monthly → daily → individual items.

**Tech Stack:** Next.js App Router, React 19, Supabase (PostgreSQL), Tailwind CSS 4 (dark theme, RTL), shadcn/ui components, Recharts (lazy-loaded)

---

## Task 1: Database Migration — Extend `income_sources` with Settlement Fields

**Files:**
- Migration via Supabase MCP `apply_migration`

**Step 1: Apply migration to add settlement columns to income_sources**

```sql
-- Add settlement rule columns to income_sources
ALTER TABLE income_sources
  ADD COLUMN IF NOT EXISTS settlement_type text NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS settlement_delay_days integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS settlement_day_of_week integer,
  ADD COLUMN IF NOT EXISTS settlement_day_of_month integer,
  ADD COLUMN IF NOT EXISTS bimonthly_first_cutoff integer,
  ADD COLUMN IF NOT EXISTS bimonthly_first_settlement integer,
  ADD COLUMN IF NOT EXISTS bimonthly_second_settlement integer,
  ADD COLUMN IF NOT EXISTS coupon_settlement_date integer,
  ADD COLUMN IF NOT EXISTS coupon_range_start integer,
  ADD COLUMN IF NOT EXISTS coupon_range_end integer;

-- commission_rate already exists, we'll reuse it as fee_percentage
COMMENT ON COLUMN income_sources.commission_rate IS 'Fee/commission percentage deducted from income (e.g., credit card processing fee)';
COMMENT ON COLUMN income_sources.settlement_type IS 'When income enters bank: daily, weekly, monthly, bimonthly, same_day, custom';
```

**Step 2: Verify migration**

Run: `SELECT column_name FROM information_schema.columns WHERE table_name = 'income_sources' ORDER BY ordinal_position;`
Expected: All new columns present.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): add settlement rule columns to income_sources"
```

---

## Task 2: Database Migration — Create `cashflow_settings` Table

**Files:**
- Migration via Supabase MCP `apply_migration`

**Step 1: Create cashflow_settings table**

```sql
CREATE TABLE IF NOT EXISTS cashflow_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  opening_balance numeric NOT NULL DEFAULT 0,
  opening_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id)
);

-- RLS
ALTER TABLE cashflow_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cashflow_settings_select" ON cashflow_settings
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM business_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "cashflow_settings_insert" ON cashflow_settings
  FOR INSERT WITH CHECK (
    business_id IN (
      SELECT business_id FROM business_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "cashflow_settings_update" ON cashflow_settings
  FOR UPDATE USING (
    business_id IN (
      SELECT business_id FROM business_members WHERE user_id = auth.uid()
    )
  );
```

**Step 2: Verify**

Run: `SELECT * FROM cashflow_settings LIMIT 1;`
Expected: Empty table, no errors.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): create cashflow_settings table with RLS"
```

---

## Task 3: Database Migration — Create `cashflow_income_overrides` Table

**Files:**
- Migration via Supabase MCP `apply_migration`

**Step 1: Create cashflow_income_overrides table**

```sql
CREATE TABLE IF NOT EXISTS cashflow_income_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  settlement_date date NOT NULL,
  income_source_id uuid NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
  original_amount numeric NOT NULL DEFAULT 0,
  override_amount numeric NOT NULL DEFAULT 0,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, settlement_date, income_source_id)
);

-- RLS
ALTER TABLE cashflow_income_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cashflow_income_overrides_select" ON cashflow_income_overrides
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM business_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "cashflow_income_overrides_insert" ON cashflow_income_overrides
  FOR INSERT WITH CHECK (
    business_id IN (
      SELECT business_id FROM business_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "cashflow_income_overrides_update" ON cashflow_income_overrides
  FOR UPDATE USING (
    business_id IN (
      SELECT business_id FROM business_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "cashflow_income_overrides_delete" ON cashflow_income_overrides
  FOR DELETE USING (
    business_id IN (
      SELECT business_id FROM business_members WHERE user_id = auth.uid()
    )
  );
```

**Step 2: Verify**

Run: `SELECT * FROM cashflow_income_overrides LIMIT 1;`
Expected: Empty table, no errors.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): create cashflow_income_overrides table with RLS"
```

---

## Task 4: Update TypeScript Types

**Files:**
- Modify: `src/types/index.ts` (lines 68-80, IncomeSource interface)

**Step 1: Extend IncomeSource interface with settlement fields**

Add these fields to the existing `IncomeSource` interface at `src/types/index.ts:69-80`:

```typescript
export type SettlementType = "daily" | "weekly" | "monthly" | "bimonthly" | "same_day" | "custom";

export interface IncomeSource {
  id: string;
  business_id: string;
  name: string;
  income_type: "private" | "business";
  input_type: InputType;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  // Settlement rules
  settlement_type: SettlementType;
  settlement_delay_days: number;
  settlement_day_of_week?: number;
  settlement_day_of_month?: number;
  bimonthly_first_cutoff?: number;
  bimonthly_first_settlement?: number;
  bimonthly_second_settlement?: number;
  commission_rate: number; // fee percentage
  coupon_settlement_date?: number;
  coupon_range_start?: number;
  coupon_range_end?: number;
}
```

**Step 2: Add CashflowSettings and CashflowIncomeOverride types**

Add after IncomeSource:

```typescript
export interface CashflowSettings {
  id: string;
  business_id: string;
  opening_balance: number;
  opening_date: string;
  created_at: string;
  updated_at: string;
}

export interface CashflowIncomeOverride {
  id: string;
  business_id: string;
  settlement_date: string;
  income_source_id: string;
  original_amount: number;
  override_amount: number;
  note?: string;
  created_by?: string;
  created_at: string;
}
```

**Step 3: Commit**

```bash
git add src/types/index.ts && git commit -m "feat(types): add settlement rules to IncomeSource, add CashflowSettings and CashflowIncomeOverride types"
```

---

## Task 5: Settlement Calculation Utility

**Files:**
- Create: `src/lib/cashflow/settlement.ts`

This is the core logic — given daily income breakdown entries + income source settlement rules, calculate on which date each income amount actually arrives in the bank.

**Step 1: Create the settlement calculation module**

Create `src/lib/cashflow/settlement.ts`:

```typescript
import { IncomeSource, SettlementType } from "@/types";

interface DailyIncomeEntry {
  entry_date: string; // YYYY-MM-DD
  income_source_id: string;
  amount: number;
}

interface SettledIncome {
  settlement_date: string; // YYYY-MM-DD — when money enters bank
  income_source_id: string;
  income_source_name: string;
  original_entry_date: string;
  gross_amount: number;
  fee_amount: number;
  net_amount: number; // gross - fee
}

/**
 * Calculate the bank settlement date for an income entry based on its source's rules.
 */
function calculateSettlementDate(
  entryDate: string,
  source: IncomeSource
): string {
  const d = new Date(entryDate + "T00:00:00");
  const type = source.settlement_type || "daily";

  switch (type) {
    case "same_day":
      return entryDate;

    case "daily": {
      const delay = source.settlement_delay_days ?? 1;
      d.setDate(d.getDate() + delay);
      return formatDate(d);
    }

    case "weekly": {
      // Find next occurrence of settlement_day_of_week
      const targetDay = source.settlement_day_of_week ?? 0; // 0=Sunday
      let daysUntil = targetDay - d.getDay();
      if (daysUntil <= 0) daysUntil += 7;
      d.setDate(d.getDate() + daysUntil);
      return formatDate(d);
    }

    case "monthly": {
      // Settles on settlement_day_of_month of the NEXT month
      const settleDay = source.settlement_day_of_month ?? 1;
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, settleDay);
      return formatDate(nextMonth);
    }

    case "bimonthly": {
      // Two settlement periods per month
      const cutoff = source.bimonthly_first_cutoff ?? 14;
      const firstSettle = source.bimonthly_first_settlement ?? 2;
      const secondSettle = source.bimonthly_second_settlement ?? 8;
      const dayOfMonth = d.getDate();

      if (dayOfMonth <= cutoff) {
        // First half → settles on firstSettle of next month
        const settleDate = new Date(d.getFullYear(), d.getMonth() + 1, firstSettle);
        return formatDate(settleDate);
      } else {
        // Second half → settles on secondSettle of next month
        const settleDate = new Date(d.getFullYear(), d.getMonth() + 1, secondSettle);
        return formatDate(settleDate);
      }
    }

    case "custom": {
      // Coupons: all entries between range_start and range_end settle on coupon_settlement_date
      const settleDay = source.coupon_settlement_date ?? 1;
      // Settle in the same month or next month depending on range
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, settleDay);
      return formatDate(nextMonth);
    }

    default:
      return entryDate;
  }
}

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Process all daily income entries through settlement rules to get
 * a map of settlement_date → SettledIncome[]
 */
export function calculateSettledIncome(
  dailyIncomeEntries: DailyIncomeEntry[],
  incomeSources: IncomeSource[]
): Map<string, SettledIncome[]> {
  const sourceMap = new Map(incomeSources.map((s) => [s.id, s]));
  const result = new Map<string, SettledIncome[]>();

  for (const entry of dailyIncomeEntries) {
    const source = sourceMap.get(entry.income_source_id);
    if (!source) continue;

    const settlementDate = calculateSettlementDate(entry.entry_date, source);
    const feeRate = (source.commission_rate || 0) / 100;
    const feeAmount = entry.amount * feeRate;
    const netAmount = entry.amount - feeAmount;

    const settled: SettledIncome = {
      settlement_date: settlementDate,
      income_source_id: entry.income_source_id,
      income_source_name: source.name,
      original_entry_date: entry.entry_date,
      gross_amount: entry.amount,
      fee_amount: feeAmount,
      net_amount: netAmount,
    };

    const existing = result.get(settlementDate) || [];
    existing.push(settled);
    result.set(settlementDate, existing);
  }

  return result;
}

export type { SettledIncome, DailyIncomeEntry };
```

**Step 2: Commit**

```bash
git add src/lib/cashflow/settlement.ts && git commit -m "feat(cashflow): add settlement date calculation utility"
```

---

## Task 6: Income Source Settings UI — Settlement Rules Configuration

**Files:**
- Modify: `src/app/(dashboard)/admin/business/[id]/edit/page.tsx` (lines ~1200-1248, income sources section)
- Create: `src/components/dashboard/IncomeSourceSettlementEditor.tsx`

**Step 1: Create IncomeSourceSettlementEditor component**

Create `src/components/dashboard/IncomeSourceSettlementEditor.tsx`:

This is a modal/drawer component that opens when clicking an income source. It shows settlement rule fields based on the selected `settlement_type`:

- **settlement_type** dropdown: יומי / שבועי / חודשי / דו-חודשי / באותו יום / מותאם
- Conditional fields based on type:
  - `daily` → `settlement_delay_days` (number input, default 1)
  - `weekly` → `settlement_day_of_week` (day picker) + `commission_rate`
  - `monthly` → `settlement_day_of_month` (1-31)
  - `bimonthly` → `bimonthly_first_cutoff`, `bimonthly_first_settlement`, `bimonthly_second_settlement` + `commission_rate`
  - `same_day` → `settlement_delay_days` (0 or 1 toggle)
  - `custom` → `coupon_settlement_date`, `coupon_range_start`, `coupon_range_end`
- `commission_rate` — percentage input (shown for all types that support fees)

**UI pattern:** Use Dialog from shadcn/ui (already used elsewhere). Hebrew labels, dark theme, RTL.

```typescript
// Key structure:
interface IncomeSourceSettlementEditorProps {
  source: IncomeSource;
  open: boolean;
  onClose: () => void;
  onSave: (updated: Partial<IncomeSource>) => void;
}
```

Settlement type labels:
```typescript
const settlementTypeLabels: Record<string, string> = {
  same_day: "באותו יום",
  daily: "יומי (עם עיכוב)",
  weekly: "שבועי",
  monthly: "חודשי",
  bimonthly: "דו-חודשי",
  custom: "מותאם (קופונים)",
};
```

Day of week labels:
```typescript
const dayOfWeekLabels = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
```

**Step 2: Integrate into business edit page**

In `src/app/(dashboard)/admin/business/[id]/edit/page.tsx`, modify the income sources section (lines ~1200-1248):
- Change income source badges from simple remove-only chips to **clickable cards**
- Each card shows: name + settlement type label + fee % (if set)
- Click opens `IncomeSourceSettlementEditor` dialog
- On save, update income_sources row in Supabase with the new settlement fields

**Step 3: Commit**

```bash
git add src/components/dashboard/IncomeSourceSettlementEditor.tsx src/app/(dashboard)/admin/business/*/edit/page.tsx && git commit -m "feat(settings): add settlement rules editor for income sources"
```

---

## Task 7: Replace Cashflow Page — Core Data Fetching & Calculation

**Files:**
- Modify: `src/app/(dashboard)/cashflow/page.tsx` (complete rewrite)

**Step 1: Remove old cashflow page content and build new data layer**

The new page fetches:
1. `cashflow_settings` — opening balance & date for selected business
2. `income_sources` — with settlement rules for selected business
3. `daily_income_breakdown` joined with `daily_entries` — income per source per day
4. `payment_splits` joined with `payments` and `suppliers` — expenses by due_date
5. `cashflow_income_overrides` — manual adjustments

Calculation flow:
1. Get date range (opening_date → user-selected end date)
2. For each day in range:
   - **Income**: Use `calculateSettledIncome()` to map income entries to settlement dates. Apply overrides.
   - **Expenses**: Sum `payment_splits.amount` where `due_date = day`
   - **Net**: income - expenses
   - **Cumulative**: previous day's cumulative + net (starting from opening_balance)

**Key data query pattern** (following existing codebase pattern):

```typescript
const [settingsResult, sourcesResult, incomeResult, splitsResult, overridesResult] = await Promise.all([
  supabase.from("cashflow_settings").select("*").eq("business_id", businessId).maybeSingle(),
  supabase.from("income_sources").select("*").in("business_id", selectedBusinesses).is("deleted_at", null),
  supabase.from("daily_income_breakdown").select("*, daily_entries!inner(entry_date, business_id)").in("daily_entries.business_id", selectedBusinesses).gte("daily_entries.entry_date", startDate).lte("daily_entries.entry_date", endDate),
  supabase.from("payment_splits").select("*, payments!inner(business_id, supplier_id, suppliers(name))").in("payments.business_id", selectedBusinesses).gte("due_date", startDate).lte("due_date", endDate).is("payments.deleted_at", null),
  supabase.from("cashflow_income_overrides").select("*").in("business_id", selectedBusinesses).gte("settlement_date", startDate).lte("settlement_date", endDate),
]);
```

**Step 2: Commit**

```bash
git add src/app/(dashboard)/cashflow/page.tsx && git commit -m "feat(cashflow): new data fetching layer with settlement calculation"
```

---

## Task 8: Replace Cashflow Page — UI: Header & Opening Balance

**Files:**
- Modify: `src/app/(dashboard)/cashflow/page.tsx`

**Step 1: Build header section**

Header contains:
- Title: "תזרים מזומנים"
- **Opening balance card**: Editable field showing `₪XX,XXX` with date. Click to edit. Saves to `cashflow_settings` via upsert.
- **Date range picker**: Uses existing `DateRangePicker` component. Start defaults to `opening_date`, end is user-selectable.
- Loading state with skeleton

**Opening balance save logic:**

```typescript
const saveOpeningBalance = async (balance: number, date: string) => {
  await supabase.from("cashflow_settings").upsert({
    business_id: selectedBusinesses[0],
    opening_balance: balance,
    opening_date: date,
  }, { onConflict: "business_id" });
};
```

**Step 2: Commit**

```bash
git add src/app/(dashboard)/cashflow/page.tsx && git commit -m "feat(cashflow): header with editable opening balance and date picker"
```

---

## Task 9: Replace Cashflow Page — UI: Main Table

**Files:**
- Modify: `src/app/(dashboard)/cashflow/page.tsx`

**Step 1: Build the main daily table**

Table columns (RTL, right-to-left):
| תאריך | הכנסות | הוצאות | הפרש יומי | צפי תזרים |

- Each row is one day
- **הפרש יומי** colored: green if positive, red if negative
- **צפי תזרים** (cumulative) colored: green if positive, red if negative
- Days with no income or expenses still show a row (income=0, expense=0, net=0, cumulative unchanged)
- Table header row has yellow/highlighted background (matching the image)
- Currency formatted with `₪` and thousands separators

**Styling** (matches existing dark theme from reports page):
```
bg-[#0F1535]        // card background
bg-[#232B6A]        // table header
text-white          // text
border-white/10     // dividers
```

**Step 2: Commit**

```bash
git add src/app/(dashboard)/cashflow/page.tsx && git commit -m "feat(cashflow): daily cash flow table with cumulative balance"
```

---

## Task 10: Replace Cashflow Page — UI: Expandable Drill-Down

**Files:**
- Modify: `src/app/(dashboard)/cashflow/page.tsx`

**Step 1: Add 3-level expandable drill-down**

Follow the reports page pattern (lines 896-1056 in reports/page.tsx):

**Level 1: Month grouping**
- Rows grouped by month
- Click month header to expand/collapse
- Shows monthly totals for income, expenses, net, cumulative (end of month value)
- Chevron icon with rotate-180 animation

**Level 2: Daily rows (inside expanded month)**
- Each day row with: date, income, expenses, net, cumulative
- Click day to expand details
- Background: `bg-[#232B6A]`

**Level 3: Individual items (inside expanded day)**
- Income items: source name, amount (net after fee), original entry date
- Expense items: supplier name, amount, payment method
- If invoice attachment exists, show small thumbnail image
- Background: `bg-[#141A40]`

**State management:**
```typescript
const [expandedMonths, setExpandedMonths] = useState<string[]>([]);
const [expandedDays, setExpandedDays] = useState<string[]>([]);
```

**Step 2: Commit**

```bash
git add src/app/(dashboard)/cashflow/page.tsx && git commit -m "feat(cashflow): 3-level expandable drill-down (month > day > items)"
```

---

## Task 11: Income Override — Edit Modal

**Files:**
- Create: `src/components/dashboard/CashflowIncomeOverrideModal.tsx`
- Modify: `src/app/(dashboard)/cashflow/page.tsx`

**Step 1: Create override modal component**

When user clicks an income item in the drill-down (Level 3), open a dialog that shows:
- Source name (read-only)
- Original calculated amount (read-only)
- Editable override amount (number input)
- Note field (optional text)
- Save / Cancel buttons

On save, upsert to `cashflow_income_overrides`:

```typescript
await supabase.from("cashflow_income_overrides").upsert({
  business_id,
  settlement_date: date,
  income_source_id: sourceId,
  original_amount: originalAmount,
  override_amount: newAmount,
  note,
  created_by: userId,
}, { onConflict: "business_id,settlement_date,income_source_id" });
```

**Step 2: Integrate modal into cashflow page**

Add click handler on income items in Level 3 drill-down to open the modal. After save, re-fetch data.

**Step 3: Commit**

```bash
git add src/components/dashboard/CashflowIncomeOverrideModal.tsx src/app/(dashboard)/cashflow/page.tsx && git commit -m "feat(cashflow): income override editing modal"
```

---

## Task 12: Real-time Subscriptions

**Files:**
- Modify: `src/app/(dashboard)/cashflow/page.tsx`

**Step 1: Add realtime subscriptions**

Use existing `useMultiTableRealtime` hook:

```typescript
useMultiTableRealtime(
  ["daily_entries", "daily_income_breakdown", "payment_splits", "payments", "cashflow_settings", "cashflow_income_overrides"],
  handleRealtimeChange,
  selectedBusinesses.length > 0
);
```

On any change, re-fetch all data (same pattern as existing cashflow page).

**Step 2: Commit**

```bash
git add src/app/(dashboard)/cashflow/page.tsx && git commit -m "feat(cashflow): add realtime subscriptions for live updates"
```

---

## Task 13: Final Polish & Testing

**Files:**
- Modify: `src/app/(dashboard)/cashflow/page.tsx`

**Step 1: Verify RTL layout**

- Table headers right-aligned
- Currency symbol (₪) renders correctly
- Numbers in LTR direction inside RTL container
- Drill-down chevrons on correct side (right for RTL)

**Step 2: Verify edge cases**

- No daily entries → table shows all zeros, cumulative stays at opening balance
- No cashflow_settings → prompt user to set opening balance
- No payment_splits with due_date → expenses column all zeros
- Income source with no settlement_type set → defaults to 'daily' with 1 day delay

**Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(cashflow): final polish, RTL fixes, edge case handling"
```

---

## Summary of All Files

### New Files:
1. `src/lib/cashflow/settlement.ts` — Settlement date calculation logic
2. `src/components/dashboard/IncomeSourceSettlementEditor.tsx` — Settlement rules editor dialog
3. `src/components/dashboard/CashflowIncomeOverrideModal.tsx` — Income override editor dialog

### Modified Files:
1. `src/types/index.ts` — Extended IncomeSource, new CashflowSettings & CashflowIncomeOverride types
2. `src/app/(dashboard)/cashflow/page.tsx` — Complete rewrite of cashflow page
3. `src/app/(dashboard)/admin/business/[id]/edit/page.tsx` — Income source cards with settlement config

### Database Changes:
1. `income_sources` table — 10 new columns for settlement rules
2. `cashflow_settings` table — New table (opening balance per business)
3. `cashflow_income_overrides` table — New table (manual income adjustments)
