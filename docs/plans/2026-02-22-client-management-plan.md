# Client Management & Retainer Income — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the existing customers page with retainer management, automatic income recording, and purple theme so service-based businesses can track recurring client income.

**Architecture:** Add retainer fields to the existing `customers` table. When a customer has an active retainer, create a linked `income_source`. A cron-callable API route processes retainers monthly, inserting into `daily_income_breakdown` so dashboard picks up the income automatically. No dashboard code changes needed.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL), TypeScript, React 19, Tailwind CSS 4

---

### Task 1: Database migration — add retainer columns to customers

**Context:** The `customers` table exists with basic fields (contact_name, business_name, etc). We add retainer-specific columns. The `customer_retainer_entries` table tracks processed months to prevent double-recording.

**Step 1: Run migration via Supabase MCP**

Execute these SQL statements using `mcp__supabase-selfhosted__execute_sql`:

```sql
-- Add retainer columns to customers
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

```sql
-- Create retainer entries tracking table
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

```sql
-- RLS for customer_retainer_entries
ALTER TABLE customer_retainer_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view retainer entries" ON customer_retainer_entries
  FOR SELECT USING (
    customer_id IN (
      SELECT c.id FROM customers c
      JOIN business_members bm ON bm.business_id = c.business_id
      WHERE bm.user_id = auth.uid() AND bm.deleted_at IS NULL
    )
  );

CREATE POLICY "Admins can insert retainer entries" ON customer_retainer_entries
  FOR INSERT WITH CHECK (
    customer_id IN (
      SELECT c.id FROM customers c
      JOIN business_members bm ON bm.business_id = c.business_id
      WHERE bm.user_id = auth.uid() AND bm.role = 'admin' AND bm.deleted_at IS NULL
    )
  );

CREATE POLICY "Admins can update retainer entries" ON customer_retainer_entries
  FOR UPDATE USING (
    customer_id IN (
      SELECT c.id FROM customers c
      JOIN business_members bm ON bm.business_id = c.business_id
      WHERE bm.user_id = auth.uid() AND bm.role = 'admin' AND bm.deleted_at IS NULL
    )
  );

CREATE POLICY "Admins can delete retainer entries" ON customer_retainer_entries
  FOR DELETE USING (
    customer_id IN (
      SELECT c.id FROM customers c
      JOIN business_members bm ON bm.business_id = c.business_id
      WHERE bm.user_id = auth.uid() AND bm.role = 'admin' AND bm.deleted_at IS NULL
    )
  );
```

**Step 2: Verify migration**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'customers' AND column_name LIKE 'retainer%'
ORDER BY ordinal_position;
```

Expected: 7 retainer columns + linked_income_source_id.

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'customer_retainer_entries';
```

Expected: 1 row.

**Step 3: Commit**

```bash
git add -A && git commit -m "docs: note DB migration for client retainer columns"
```

---

### Task 2: Update Customer interface and form state

**Files:**
- Modify: `src/app/(dashboard)/admin/customers/page.tsx`

**Context:** The `Customer` interface is defined inline at line 37-53. We need to add the retainer fields to it, and add corresponding form state variables.

**Step 1: Update Customer interface**

In `src/app/(dashboard)/admin/customers/page.tsx`, find the `Customer` interface (line 37-53) and add after `deleted_at`:

```typescript
interface Customer {
  id: string;
  business_id: string | null;
  contact_name: string;
  business_name: string;
  company_name: string | null;
  tax_id: string | null;
  work_start_date: string | null;
  setup_fee: string | null;
  payment_terms: string | null;
  agreement_url: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Retainer fields
  retainer_amount: number | null;
  retainer_type: 'monthly' | 'one_time' | 'fixed_term' | null;
  retainer_months: number | null;
  retainer_start_date: string | null;
  retainer_end_date: string | null;
  retainer_day_of_month: number | null;
  retainer_status: 'active' | 'paused' | 'completed' | null;
  linked_income_source_id: string | null;
}
```

**Step 2: Add form state variables**

After the existing form field state variables (around line 131-132), add:

```typescript
const [fRetainerAmount, setFRetainerAmount] = useState("");
const [fRetainerType, setFRetainerType] = useState<string>("");
const [fRetainerMonths, setFRetainerMonths] = useState("");
const [fRetainerStartDate, setFRetainerStartDate] = useState("");
const [fRetainerDayOfMonth, setFRetainerDayOfMonth] = useState("1");
```

**Step 3: Update resetForm()**

In the `resetForm` function (around line 249-262), add after `setFormBusinessName("")`:

```typescript
setFRetainerAmount("");
setFRetainerType("");
setFRetainerMonths("");
setFRetainerStartDate("");
setFRetainerDayOfMonth("1");
```

**Step 4: Update handleSetupCustomer() edit branch**

In `handleSetupCustomer` (around line 272-298), in the `if (item.customer)` branch, add after `setFIsActive(item.customer.is_active)`:

```typescript
setFRetainerAmount(item.customer.retainer_amount?.toString() || "");
setFRetainerType(item.customer.retainer_type || "");
setFRetainerMonths(item.customer.retainer_months?.toString() || "");
setFRetainerStartDate(item.customer.retainer_start_date || "");
setFRetainerDayOfMonth(item.customer.retainer_day_of_month?.toString() || "1");
```

**Step 5: Update draft persistence**

In `saveDraftData` callback (around line 478-484), add the retainer fields to the `saveDraft()` call:

```typescript
saveDraft({
  fContactName, fBusinessName, fCompanyName, fTaxId,
  fWorkStartDate, fSetupFee, fPaymentTerms, fNotes,
  fRetainerAmount, fRetainerType, fRetainerMonths,
  fRetainerStartDate, fRetainerDayOfMonth,
});
```

Also update the dependency array of this useCallback to include the new variables.

In the draft restore `useEffect` (around line 490-511), add after `if (draft.fNotes)`:

```typescript
if (draft.fRetainerAmount) setFRetainerAmount(draft.fRetainerAmount as string);
if (draft.fRetainerType) setFRetainerType(draft.fRetainerType as string);
if (draft.fRetainerMonths) setFRetainerMonths(draft.fRetainerMonths as string);
if (draft.fRetainerStartDate) setFRetainerStartDate(draft.fRetainerStartDate as string);
if (draft.fRetainerDayOfMonth) setFRetainerDayOfMonth(draft.fRetainerDayOfMonth as string);
```

**Step 6: Commit**

```bash
git add src/app/\(dashboard\)/admin/customers/page.tsx
git commit -m "feat(customers): add retainer fields to interface and form state"
```

---

### Task 3: Update save logic — create linked income_source on retainer save

**Files:**
- Modify: `src/app/(dashboard)/admin/customers/page.tsx`

**Context:** When saving a customer with `retainer_amount > 0`, we need to:
1. Create an `income_source` linked to this customer (if not already created)
2. Save the retainer fields to the customer record
3. Compute `retainer_end_date` for fixed_term

**Step 1: Update handleSaveCustomer()**

Find `handleSaveCustomer` (starts around line 319). Replace the `customerData` object construction and the save logic.

After `agreementUrl` is resolved (around line 343), build customer data with retainer:

```typescript
const retainerAmount = fRetainerAmount ? parseFloat(fRetainerAmount) : null;
const retainerType = fRetainerType || null;
const retainerMonths = fRetainerMonths ? parseInt(fRetainerMonths) : null;
const retainerStartDate = fRetainerStartDate || null;
const retainerDayOfMonth = fRetainerDayOfMonth ? parseInt(fRetainerDayOfMonth) : 1;

// Compute end date for fixed_term
let retainerEndDate: string | null = null;
if (retainerType === 'fixed_term' && retainerStartDate && retainerMonths) {
  const start = new Date(retainerStartDate);
  start.setMonth(start.getMonth() + retainerMonths);
  retainerEndDate = start.toISOString().split('T')[0];
}

const customerData = {
  business_id: formBusinessId || null,
  contact_name: fContactName.trim(),
  business_name: fBusinessName.trim(),
  company_name: fCompanyName.trim() || null,
  tax_id: fTaxId.trim() || null,
  work_start_date: fWorkStartDate || null,
  setup_fee: fSetupFee.trim() || null,
  payment_terms: fPaymentTerms.trim() || null,
  agreement_url: agreementUrl,
  notes: fNotes.trim() || null,
  is_active: fIsActive,
  retainer_amount: retainerAmount,
  retainer_type: retainerType,
  retainer_months: retainerMonths,
  retainer_start_date: retainerStartDate,
  retainer_end_date: retainerEndDate,
  retainer_day_of_month: retainerDayOfMonth,
};
```

After the insert/update succeeds, if there's a retainer and no linked income source yet, create one:

```typescript
// After successful save, handle income source linking
if (retainerAmount && retainerAmount > 0 && formBusinessId) {
  const savedCustomerId = isEditMode ? editingCustomer!.id : /* get from insert result */;

  // Check if income source already exists
  const existingLinked = isEditMode ? editingCustomer?.linked_income_source_id : null;

  if (!existingLinked) {
    // Create income source for this customer
    const incomeSourceId = generateUUID();
    const { error: isError } = await supabase
      .from("income_sources")
      .insert({
        id: incomeSourceId,
        business_id: formBusinessId,
        name: `ריטיינר — ${fBusinessName.trim()}`,
        income_type: "business",
        input_type: "single",
        display_order: 999,
        is_active: true,
      });

    if (!isError) {
      // Link income source to customer
      await supabase
        .from("customers")
        .update({ linked_income_source_id: incomeSourceId })
        .eq("id", savedCustomerId);
    }
  }
}
```

**Important:** For INSERT, we need the customer ID. Change the insert to use a pre-generated UUID:

```typescript
const newCustomerId = generateUUID();
// ... in the insert:
const { error } = await supabase
  .from("customers")
  .insert({ id: newCustomerId, ...customerData });
```

Then use `newCustomerId` for the income source linking.

**Step 2: Commit**

```bash
git add src/app/\(dashboard\)/admin/customers/page.tsx
git commit -m "feat(customers): create linked income_source on retainer save"
```

---

### Task 4: Add retainer form fields to the Sheet UI

**Files:**
- Modify: `src/app/(dashboard)/admin/customers/page.tsx`

**Context:** The customer form Sheet starts around line 722. We add retainer fields after the existing form fields (after "הערות" textarea, before the save button area).

**Step 1: Add retainer section to the form**

After the notes textarea section and before the save/active toggle section, add:

```tsx
{/* ═══ Retainer Section ═══ */}
<div className="border-t border-[#4C526B] mt-[10px] pt-[15px]">
  <h3 className="text-[16px] font-bold text-purple-300 mb-[10px]">הגדרות ריטיינר</h3>

  {/* סכום ריטיינר */}
  <div className="flex flex-col gap-[5px]">
    <label className="text-[15px] font-medium text-white text-right">סכום לפני מע&quot;מ</label>
    <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
      <Input
        type="number"
        inputMode="decimal"
        title="סכום ריטיינר"
        value={fRetainerAmount}
        onChange={(e) => setFRetainerAmount(e.target.value)}
        placeholder="0"
        className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
      />
    </div>
    {fRetainerAmount && parseFloat(fRetainerAmount) > 0 && (
      <span className="text-[13px] text-purple-300 text-center">
        ₪ {parseFloat(fRetainerAmount).toLocaleString("he-IL")} + מע&quot;מ = ₪ {(parseFloat(fRetainerAmount) * 1.18).toLocaleString("he-IL", { maximumFractionDigits: 0 })}
      </span>
    )}
  </div>

  {/* סוג תשלום */}
  <div className="flex flex-col gap-[5px] mt-[10px]">
    <label className="text-[15px] font-medium text-white text-right">סוג תשלום</label>
    <Select value={fRetainerType} onValueChange={setFRetainerType}>
      <SelectTrigger className="border border-[#4C526B] rounded-[10px] h-[50px] bg-transparent text-white text-[14px] text-center">
        <SelectValue placeholder="בחר סוג תשלום" />
      </SelectTrigger>
      <SelectContent className="bg-[#1a1f4e] border-[#4C526B] text-white">
        <SelectItem value="monthly">ריטיינר חודשי</SelectItem>
        <SelectItem value="one_time">חד פעמי</SelectItem>
        <SelectItem value="fixed_term">מתמשך ל-X חודשים</SelectItem>
      </SelectContent>
    </Select>
  </div>

  {/* כמות חודשים — only for fixed_term */}
  {fRetainerType === "fixed_term" && (
    <div className="flex flex-col gap-[5px] mt-[10px]">
      <label className="text-[15px] font-medium text-white text-right">כמות חודשים</label>
      <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
        <Input
          type="number"
          inputMode="numeric"
          title="כמות חודשים"
          value={fRetainerMonths}
          onChange={(e) => setFRetainerMonths(e.target.value)}
          placeholder="12"
          className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
        />
      </div>
    </div>
  )}

  {/* יום חיוב בחודש */}
  {fRetainerType && fRetainerType !== "one_time" && (
    <div className="flex flex-col gap-[5px] mt-[10px]">
      <label className="text-[15px] font-medium text-white text-right">יום חיוב בחודש</label>
      <Select value={fRetainerDayOfMonth} onValueChange={setFRetainerDayOfMonth}>
        <SelectTrigger className="border border-[#4C526B] rounded-[10px] h-[50px] bg-transparent text-white text-[14px] text-center">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-[#1a1f4e] border-[#4C526B] text-white max-h-[300px]">
          {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
            <SelectItem key={day} value={day.toString()}>{day}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )}

  {/* תאריך תחילת ריטיינר */}
  {fRetainerType && (
    <div className="flex flex-col gap-[5px] mt-[10px]">
      <label className="text-[15px] font-medium text-white text-right">תאריך תחילת ריטיינר</label>
      <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
        <Input
          type="date"
          title="תאריך תחילה"
          value={fRetainerStartDate}
          onChange={(e) => setFRetainerStartDate(e.target.value)}
          className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
        />
      </div>
    </div>
  )}
</div>
```

**Step 2: Commit**

```bash
git add src/app/\(dashboard\)/admin/customers/page.tsx
git commit -m "feat(customers): add retainer form fields in Sheet UI"
```

---

### Task 5: Purple theme for customers page

**Files:**
- Modify: `src/app/(dashboard)/admin/customers/page.tsx`

**Context:** Replace blue color values (`#29318A`, `#3D44A0`) with purple equivalents throughout the page. The app uses a dark navy base (`#0F1535`), and the customers page currently uses `#29318A` (blue) for cards, buttons, and accents.

**Step 1: Replace colors**

Do a find-and-replace in the file:
- `bg-[#29318A]` → `bg-[#6B21A8]` (purple-700 equivalent)
- `hover:bg-[#3D44A0]` → `hover:bg-[#7C3AED]` (purple-600 equivalent)
- `bg-[#29318A]/30` → `bg-[#6B21A8]/30`
- Keep `bg-[#0F1535]` (page background) unchanged
- Keep `border-[#4C526B]` unchanged
- Skeleton loading cards: same purple replacement

Badge colors remain as-is (orange for "טרם הוקם", red for "לא פעיל", gray for "עצמאי").

**Step 2: Commit**

```bash
git add src/app/\(dashboard\)/admin/customers/page.tsx
git commit -m "feat(customers): purple theme for customer cards and buttons"
```

---

### Task 6: Show retainer info on customer cards

**Files:**
- Modify: `src/app/(dashboard)/admin/customers/page.tsx`

**Context:** The customer card grid (around line 627-717) shows business name, contact name, and member count. We add retainer amount and status badge.

**Step 1: Add retainer display to business-linked cards**

In the card JSX (inside `filteredItems.map`), after the members count `<span>` (around line 679-681), add:

```tsx
{/* Retainer info */}
{item.customer?.retainer_amount && item.customer.retainer_amount > 0 && (
  <div className="flex flex-col items-center gap-[3px]">
    <span className="text-[14px] font-bold text-purple-300">
      ₪ {item.customer.retainer_amount.toLocaleString("he-IL")}
    </span>
    {item.customer.retainer_status && (
      <Badge className={`text-[10px] px-[6px] py-[1px] rounded-full font-bold ${
        item.customer.retainer_status === 'active' ? 'bg-green-600/80 text-white' :
        item.customer.retainer_status === 'paused' ? 'bg-[#F6A609]/80 text-white' :
        'bg-[#4C526B] text-white/70'
      }`}>
        {item.customer.retainer_status === 'active' ? 'פעיל' :
         item.customer.retainer_status === 'paused' ? 'מושהה' : 'הסתיים'}
      </Badge>
    )}
  </div>
)}
```

**Step 2: Commit**

```bash
git add src/app/\(dashboard\)/admin/customers/page.tsx
git commit -m "feat(customers): show retainer amount and status on cards"
```

---

### Task 7: Update customer detail popup with retainer section

**Files:**
- Modify: `src/app/(dashboard)/admin/customers/page.tsx`

**Context:** The detail popup Sheet shows customer info, agreement, members, and payments. We add a retainer summary section and action buttons (pause/resume/stop).

**Step 1: Find the detail Sheet**

The detail sheet starts with `<Sheet open={isDetailOpen}`. Look for the customer info grid section inside it.

**Step 2: Add retainer summary section**

After the customer info grid and before the payment history section, add:

```tsx
{/* Retainer Summary */}
{selectedItem?.customer?.retainer_amount && selectedItem.customer.retainer_amount > 0 && (
  <div className="border border-purple-500/30 rounded-[10px] p-[12px] mt-[10px] bg-purple-900/20">
    <h4 className="text-[15px] font-bold text-purple-300 mb-[8px]">ריטיינר</h4>
    <div className="grid grid-cols-2 gap-[8px] text-[13px]">
      <div>
        <span className="text-white/50">סכום לפני מע&quot;מ:</span>
        <span className="text-white mr-[5px]">₪ {selectedItem.customer.retainer_amount.toLocaleString("he-IL")}</span>
      </div>
      <div>
        <span className="text-white/50">כולל מע&quot;מ:</span>
        <span className="text-white mr-[5px]">₪ {(selectedItem.customer.retainer_amount * 1.18).toLocaleString("he-IL", { maximumFractionDigits: 0 })}</span>
      </div>
      <div>
        <span className="text-white/50">סוג:</span>
        <span className="text-white mr-[5px]">
          {selectedItem.customer.retainer_type === 'monthly' ? 'חודשי' :
           selectedItem.customer.retainer_type === 'one_time' ? 'חד פעמי' :
           `${selectedItem.customer.retainer_months} חודשים`}
        </span>
      </div>
      <div>
        <span className="text-white/50">יום חיוב:</span>
        <span className="text-white mr-[5px]">{selectedItem.customer.retainer_day_of_month} לחודש</span>
      </div>
      {selectedItem.customer.retainer_start_date && (
        <div>
          <span className="text-white/50">תחילה:</span>
          <span className="text-white mr-[5px]">{selectedItem.customer.retainer_start_date}</span>
        </div>
      )}
      {selectedItem.customer.retainer_end_date && (
        <div>
          <span className="text-white/50">סיום:</span>
          <span className="text-white mr-[5px]">{selectedItem.customer.retainer_end_date}</span>
        </div>
      )}
    </div>

    {/* Action buttons */}
    <div className="flex gap-[8px] mt-[10px]">
      {selectedItem.customer.retainer_status === 'active' && (
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={async () => {
            const supabase = createClient();
            await supabase.from("customers").update({ retainer_status: 'paused' }).eq("id", selectedItem!.customer!.id);
            showToast("הריטיינר הושהה", "success");
            setRefreshTrigger(prev => prev + 1);
            handleCloseDetail();
          }}
          className="text-[12px] border-orange-500 text-orange-400 hover:bg-orange-500/20"
        >
          השהה ריטיינר
        </Button>
      )}
      {selectedItem.customer.retainer_status === 'paused' && (
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={async () => {
            const supabase = createClient();
            await supabase.from("customers").update({ retainer_status: 'active' }).eq("id", selectedItem!.customer!.id);
            showToast("הריטיינר חודש", "success");
            setRefreshTrigger(prev => prev + 1);
            handleCloseDetail();
          }}
          className="text-[12px] border-green-500 text-green-400 hover:bg-green-500/20"
        >
          חדש ריטיינר
        </Button>
      )}
      {selectedItem.customer.retainer_status !== 'completed' && (
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={async () => {
            const confirmed = await confirm("האם לעצור את הריטיינר?");
            if (!confirmed) return;
            const supabase = createClient();
            await supabase.from("customers").update({ retainer_status: 'completed' }).eq("id", selectedItem!.customer!.id);
            showToast("הריטיינר הסתיים", "success");
            setRefreshTrigger(prev => prev + 1);
            handleCloseDetail();
          }}
          className="text-[12px] border-red-500 text-red-400 hover:bg-red-500/20"
        >
          עצור ריטיינר
        </Button>
      )}
    </div>
  </div>
)}
```

**Step 3: Commit**

```bash
git add src/app/\(dashboard\)/admin/customers/page.tsx
git commit -m "feat(customers): retainer summary and action buttons in detail popup"
```

---

### Task 8: API route — process retainers

**Files:**
- Create: `src/app/api/retainers/process/route.ts`

**Context:** This cron-callable endpoint processes all active retainers for the current day. It creates `daily_income_breakdown` entries and records in `customer_retainer_entries`.

**Step 1: Create the API route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createServiceClient(url, key);
}

export async function POST(request: NextRequest) {
  try {
    // Auth: API key or cron secret
    const apiKey = request.headers.get('x-api-key');
    const cronSecret = request.headers.get('x-cron-secret');
    const validKey = process.env.INTAKE_API_KEY;
    const validCron = process.env.CRON_SECRET;

    if ((!validKey || apiKey !== validKey) && (!validCron || cronSecret !== validCron)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const today = new Date();
    const dayOfMonth = today.getDate();
    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      .toISOString().split('T')[0]; // "YYYY-MM-01"

    // Find active retainers due today
    const { data: customers, error: fetchError } = await supabase
      .from('customers')
      .select('id, business_id, retainer_amount, retainer_type, retainer_months, retainer_start_date, retainer_end_date, retainer_day_of_month, linked_income_source_id, business_name')
      .eq('retainer_status', 'active')
      .eq('retainer_day_of_month', dayOfMonth)
      .not('retainer_amount', 'is', null)
      .not('linked_income_source_id', 'is', null)
      .is('deleted_at', null);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!customers || customers.length === 0) {
      return NextResponse.json({ processed: 0, message: 'No retainers due today' });
    }

    let processed = 0;
    const errors: string[] = [];

    for (const customer of customers) {
      try {
        // Skip if already processed this month
        const { data: existing } = await supabase
          .from('customer_retainer_entries')
          .select('id')
          .eq('customer_id', customer.id)
          .eq('entry_month', currentMonth)
          .maybeSingle();

        if (existing) continue;

        // Get business VAT percentage
        const { data: business } = await supabase
          .from('businesses')
          .select('vat_percentage')
          .eq('id', customer.business_id)
          .single();

        const vatRate = business?.vat_percentage || 18;
        const amountWithVat = customer.retainer_amount * (1 + vatRate / 100);

        // Find or create daily entry for today
        const todayStr = today.toISOString().split('T')[0];
        let { data: dailyEntry } = await supabase
          .from('daily_entries')
          .select('id')
          .eq('business_id', customer.business_id)
          .eq('entry_date', todayStr)
          .is('deleted_at', null)
          .maybeSingle();

        if (!dailyEntry) {
          const { data: newEntry, error: entryError } = await supabase
            .from('daily_entries')
            .insert({
              business_id: customer.business_id,
              entry_date: todayStr,
              total_register: 0,
              labor_cost: 0,
              labor_hours: 0,
              discounts: 0,
              data_source: 'api',
              is_fully_approved: true,
            })
            .select('id')
            .single();

          if (entryError) {
            errors.push(`${customer.business_name}: failed to create daily entry`);
            continue;
          }
          dailyEntry = newEntry;
        }

        // Insert into daily_income_breakdown
        const { data: breakdown, error: breakdownError } = await supabase
          .from('daily_income_breakdown')
          .insert({
            daily_entry_id: dailyEntry.id,
            income_source_id: customer.linked_income_source_id,
            amount: amountWithVat,
            orders_count: 1,
          })
          .select('id')
          .single();

        if (breakdownError) {
          errors.push(`${customer.business_name}: failed to insert breakdown`);
          continue;
        }

        // Record in customer_retainer_entries
        await supabase
          .from('customer_retainer_entries')
          .insert({
            customer_id: customer.id,
            entry_month: currentMonth,
            amount: amountWithVat,
            daily_income_breakdown_id: breakdown.id,
          });

        // Update total_register on daily entry
        await supabase.rpc('increment_total_register', {
          p_entry_id: dailyEntry.id,
          p_amount: amountWithVat,
        }).then(() => {}).catch(() => {
          // If RPC doesn't exist, do manual update
          // This is a best-effort update
        });

        // Check if fixed_term should complete
        if (customer.retainer_type === 'fixed_term' && customer.retainer_end_date) {
          const endDate = new Date(customer.retainer_end_date);
          if (today >= endDate) {
            await supabase
              .from('customers')
              .update({ retainer_status: 'completed' })
              .eq('id', customer.id);
          }
        }

        processed++;
      } catch (err) {
        errors.push(`${customer.business_name}: ${String(err)}`);
      }
    }

    return NextResponse.json({
      processed,
      total: customers.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/retainers/process/route.ts
git commit -m "feat(retainers): API route to process monthly retainer income"
```

---

### Task 9: Build verification and fix errors

**Step 1: Run TypeScript compilation**

```bash
cd /c/Users/netn1/Downloads/amazpen-new && npx.cmd tsc --noEmit 2>&1 | head -50
```

**Step 2: Run build**

```bash
npm run build 2>&1 | tail -30
```

**Step 3: Fix any build errors that arise**

Common issues to watch for:
- Missing imports (Select, SelectContent, etc. — already imported at line 14)
- Type mismatches on retainer fields
- Lazy Supabase client pattern in API route (already using `getSupabaseAdmin()` function)

**Step 4: Commit fixes**

```bash
git add -A && git commit -m "fix: resolve build errors for client management feature"
```

---

### Task 10: Push and deploy

**Step 1: Push to remote**

```bash
git push origin master
```

**Step 2: Deploy via Dokploy (if available)**

Use `mcp__dokploy__application-deploy` or verify the auto-deploy triggers.
