# Supplier Karteset Email - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add email field + karteset request toggle to supplier form, and create n8n workflow that sends karteset request emails bi-monthly.

**Architecture:** DB migration adds `request_karteset` column. Frontend adds email + toggle fields to add/edit form, and envelope icon to supplier card. n8n workflow runs on schedule, queries Supabase for opted-in suppliers, sends emails via SMTP.

**Tech Stack:** Supabase (migration), Next.js (supplier page), n8n (workflow automation)

---

### Task 1: DB Migration - Add `request_karteset` column

**Files:**
- Migration via Supabase MCP `apply_migration`

**Step 1: Apply migration**

```sql
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS request_karteset boolean DEFAULT false;
```

Use `mcp__supabase-selfhosted__apply_migration` with name `add_request_karteset_column`.

**Step 2: Verify column exists**

Run via `mcp__supabase-selfhosted__execute_sql`:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'suppliers' AND column_name IN ('email', 'request_karteset');
```

Expected: Both `email` (text) and `request_karteset` (boolean, default false) exist.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): add request_karteset column to suppliers table"
```

---

### Task 2: Add `email` and `request_karteset` to Supplier interface

**Files:**
- Modify: `src/app/(dashboard)/suppliers/page.tsx`

**Step 1: Add fields to Supplier interface (line ~37-64)**

Add after `is_active?: boolean;` (line 56):

```typescript
  email?: string;
  request_karteset?: boolean;
```

**Step 2: Commit**

```bash
git add src/app/(dashboard)/suppliers/page.tsx
git commit -m "feat(suppliers): add email and request_karteset to Supplier interface"
```

---

### Task 3: Add form state variables for email and request_karteset

**Files:**
- Modify: `src/app/(dashboard)/suppliers/page.tsx`

**Step 1: Add state variables after `fixedNote` state (line ~225)**

After `const [fixedNote, setFixedNote] = useState("");`:

```typescript
  const [supplierEmail, setSupplierEmail] = useState("");
  const [requestKarteset, setRequestKarteset] = useState(false);
```

**Step 2: Add to draft save function (line ~231)**

In `saveSupplierDraftData` callback, add `supplierEmail, requestKarteset` to the `saveSupplierDraft({...})` object and to the dependency array.

**Step 3: Add to draft restore (line ~260)**

Add after the existing draft restore lines:
```typescript
if (draft.supplierEmail) setSupplierEmail(draft.supplierEmail as string);
if (draft.requestKarteset !== undefined) setRequestKarteset(draft.requestKarteset as boolean);
```

**Step 4: Add to form reset function `handleCloseAddSupplierModal` (line ~450)**

Add:
```typescript
setSupplierEmail("");
setRequestKarteset(false);
```

**Step 5: Add to edit supplier loader `handleEditSupplier` (line ~493)**

After `setIsSupplierActive(selectedSupplier.is_active !== false);`:
```typescript
setSupplierEmail(selectedSupplier.email || "");
setRequestKarteset(selectedSupplier.request_karteset || false);
```

**Step 6: Commit**

```bash
git add src/app/(dashboard)/suppliers/page.tsx
git commit -m "feat(suppliers): add email and requestKarteset form state"
```

---

### Task 4: Add email and request_karteset to insert/update operations

**Files:**
- Modify: `src/app/(dashboard)/suppliers/page.tsx`

**Step 1: Add to INSERT (line ~767, inside `.insert({...})`)**

After `is_active: true,` add:
```typescript
email: supplierEmail.trim() || null,
request_karteset: supplierEmail.trim() ? requestKarteset : false,
```

**Step 2: Add to UPDATE (line ~600, inside `.update({...})`)**

After `is_active: isSupplierActive,` add:
```typescript
email: supplierEmail.trim() || null,
request_karteset: supplierEmail.trim() ? requestKarteset : false,
```

**Step 3: Commit**

```bash
git add src/app/(dashboard)/suppliers/page.tsx
git commit -m "feat(suppliers): save email and request_karteset to database"
```

---

### Task 5: Add email input and karteset toggle to Add/Edit form UI

**Files:**
- Modify: `src/app/(dashboard)/suppliers/page.tsx`

**Step 1: Add email input field after supplier name field (after line ~1414)**

After the supplier name `</div>` closing tag (end of the name field block), add:

```tsx
{/* Email */}
<div className="flex flex-col gap-[5px]">
  <label className="text-[15px] font-medium text-white text-right">כתובת מייל</label>
  <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
    <Input
      type="email"
      dir="ltr"
      title="כתובת מייל"
      value={supplierEmail}
      onChange={(e) => setSupplierEmail(e.target.value)}
      className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
      placeholder="example@email.com"
    />
  </div>
</div>

{/* Request Karteset Toggle - only show when email exists */}
{supplierEmail.trim() && (
  <div className="flex items-center justify-between px-[5px]">
    <label className="text-[14px] font-medium text-white">שלח בקשת כרטסת כל 2 לחודש</label>
    <button
      type="button"
      onClick={() => setRequestKarteset(!requestKarteset)}
      className={`w-[44px] h-[24px] rounded-full transition-colors duration-200 ${requestKarteset ? "bg-[#0BB783]" : "bg-[#4C526B]"}`}
    >
      <div className={`w-[20px] h-[20px] bg-white rounded-full transition-transform duration-200 ${requestKarteset ? "translate-x-[-20px]" : "translate-x-[-2px]"}`} />
    </button>
  </div>
)}
```

Note: RTL toggle — `translate-x` values are negative for RTL direction (right-to-left, so "on" moves left).

**Step 2: Commit**

```bash
git add src/app/(dashboard)/suppliers/page.tsx
git commit -m "feat(suppliers): add email input and karteset toggle to form UI"
```

---

### Task 6: Add envelope icon to supplier card in grid

**Files:**
- Modify: `src/app/(dashboard)/suppliers/page.tsx`

**Step 1: Import Mail icon from lucide-react (line ~7)**

Add `Mail` to the existing lucide-react import:
```typescript
import { ChevronLeft, ChevronRight, X, Mail } from "lucide-react";
```

**Step 2: Add envelope badge to supplier card (line ~1348, inside the card Button)**

After the inactive badge block and before `{/* Supplier Name */}`, add:

```tsx
{/* Karteset Email Badge */}
{supplier.request_karteset && supplier.email && (
  <div className="absolute top-[6px] right-[6px]">
    <Mail className="w-[14px] h-[14px] text-[#0BB783]" />
  </div>
)}
```

**Step 3: Commit**

```bash
git add src/app/(dashboard)/suppliers/page.tsx
git commit -m "feat(suppliers): show envelope icon on karteset-enabled supplier cards"
```

---

### Task 7: Add email display to supplier detail popup

**Files:**
- Modify: `src/app/(dashboard)/suppliers/page.tsx`

**Step 1: Find the supplier detail info section (around line ~2038)**

After the supplier name display field, add email display:

```tsx
{selectedSupplier.email && (
  <div className="flex flex-col items-center text-center">
    <span className="text-[12px] text-white/60">מייל</span>
    <span className="text-[14px] text-white font-medium" dir="ltr">{selectedSupplier.email}</span>
  </div>
)}
```

**Step 2: Add email field to the edit form view in detail popup (around line ~2860)**

After the supplier name disabled input in the edit section of the detail popup, add:

```tsx
{/* Email */}
{selectedSupplier.email && (
  <div className="flex flex-col gap-[3px]">
    <span className="text-[15px] font-medium text-white text-right">כתובת מייל</span>
    <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center">
      <Input
        type="email"
        dir="ltr"
        title="כתובת מייל"
        disabled
        value={selectedSupplier.email}
        className="w-full h-full bg-transparent text-white text-[14px] text-center outline-none px-[10px]"
      />
    </div>
  </div>
)}
```

**Step 3: Commit**

```bash
git add src/app/(dashboard)/suppliers/page.tsx
git commit -m "feat(suppliers): show email in supplier detail popup"
```

---

### Task 8: Create n8n workflow for bi-monthly karteset email

**Files:**
- n8n workflow via MCP

**Pre-requisite:** Invoke `n8n-workflow-patterns` skill before this task.

**Step 1: Check existing workflows and SMTP credentials**

Use `mcp__n8n-mcp__n8n_list_workflows` to see existing workflows.
Find an existing workflow that sends emails to identify the correct SMTP credential ID.

**Step 2: Create the workflow**

Use `mcp__n8n-mcp__n8n_create_workflow` with this structure:

- **Node 1: Schedule Trigger** — Runs on the 1st and 15th of every month at 09:00
- **Node 2: Supabase (HTTP Request)** — Query suppliers with `request_karteset=true AND email IS NOT NULL AND is_active=true`, joined with business info (business name, owner email)
  - Uses Supabase REST API: `GET /rest/v1/suppliers?request_karteset=eq.true&email=not.is.null&is_active=eq.true&select=id,name,email,business_id,businesses(name)`
  - Headers: apikey + Authorization with service role key
- **Node 3: Split In Batches** — Process one supplier at a time
- **Node 4: Supabase (HTTP Request)** — For each supplier, get the business owner's email from `business_members` where `role=owner`
  - Query: `GET /rest/v1/business_members?business_id=eq.{{business_id}}&role=eq.owner&select=user_id,users(email)`
- **Node 5: Send Email (SMTP)** — Send karteset request email
  - To: supplier email
  - CC: business owner email
  - From: noreply@brainboxai.io
  - Subject: `בקשת כרטסת - {{business_name}}`
  - Body: HTML email with karteset request text

**Step 3: Validate the workflow**

Use `mcp__n8n-mcp__n8n_validate_workflow` to verify structure.

**Step 4: Test the workflow**

Use `mcp__n8n-mcp__n8n_test_workflow` with a test run to verify it works.

**Step 5: Commit note** — No git commit needed since this is an n8n workflow, not code.

---

### Task 9: Verify end-to-end manually

**Step 1:** Open dev server (`npm run dev`)
**Step 2:** Navigate to suppliers page
**Step 3:** Edit a supplier — verify email field and karteset toggle appear
**Step 4:** Enter email, enable karteset, save
**Step 5:** Verify envelope icon shows on supplier card
**Step 6:** Check DB to verify `email` and `request_karteset` fields are saved
**Step 7:** Verify n8n workflow is active and scheduled

---

### Summary of all changes

| Area | Change |
|------|--------|
| DB | New column `request_karteset` (boolean) |
| Interface type | Add `email`, `request_karteset` to `Supplier` |
| Form state | New `supplierEmail`, `requestKarteset` states |
| Draft save/restore | Include email + karteset in draft persistence |
| Form reset | Clear email + karteset on close |
| Edit loader | Load email + karteset from existing supplier |
| INSERT query | Save email + request_karteset |
| UPDATE query | Save email + request_karteset |
| Form UI | Email input + karteset toggle (conditional) |
| Card grid | Envelope icon for karteset-enabled suppliers |
| Detail popup | Show email in info section |
| n8n | Bi-monthly schedule workflow sending emails |
