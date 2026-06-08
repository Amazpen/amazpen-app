# Admin Billing (Cardcom) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only `/admin/billing` module to manage standalone customers' monthly recurring subscriptions and charge them via Cardcom (LowProfile first charge → saved token → daily cron recharges).

**Architecture:** Greenfield billing module. 3 new tables (`billing_customers`, `billing_subscriptions`, `billing_charges`, admin-only RLS). First charge uses Cardcom hosted LowProfile page (`Operation=ChargeAndCreateToken`) shown in an iframe — no card data touches our server (no PCI exposure). A webhook verifies the result server-side via `GetLpResult` and saves the token. A daily cron (`/api/billing/process`, protected by the existing `CRON_SECRET`) charges due subscriptions by token via `Transactions/Transaction`. The whole admin nav group is already gated by `isAdmin`, so the new link is admin-only automatically.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (strict), Supabase (service-role for cron/webhook, `is_admin()` RLS for UI), Cardcom API v11, Vitest for pure-logic unit tests.

**Spec:** `docs/superpowers/specs/2026-06-08-admin-billing-cardcom-design.md`

---

## Testing strategy (read first)

This repo has **no unit-test runner** today (only `@playwright/test` for E2E). We add **Vitest** (dev-only) to TDD the genuinely error-prone *pure* logic:
- date advancement with short-month clamping,
- Cardcom request-payload building,
- Cardcom response normalization,
- the "subscription is due" predicate.

API routes / webhook / cron glue and the React page are **integration-heavy** (Supabase + Cardcom + Next request objects). Mocking them has low value, so they are verified by `npm run build`, `npm run lint`, and manual testing against the Cardcom sandbox. Each such task lists explicit manual verification steps instead of fake unit tests.

**Cardcom field-name caveat:** The `Transactions/Transaction` token fields are confirmed: `TerminalNumber`, `ApiName`, `Amount`, `Token`, `CardExpirationMMYY`. The exact `LowProfileResult` field names for the saved token / last-4 / expiry / transaction id are **not** fully confirmed from swagger. Implementation MUST: store the entire raw response in `cardcom_response` (jsonb), log it on first sandbox run, and confirm the extraction paths against the real payload. Swagger: `https://secure.cardcom.solutions/swagger/index.html?url=/swagger/v11/swagger.json`.

---

## File structure

**Create:**
- `vitest.config.ts` — Vitest config (node env).
- `supabase/migrations/<ts>_billing_module.sql` — reference copy of the migration (applied via Supabase MCP `apply_migration`).
- `src/types/billing.ts` — domain types + shared enums.
- `src/lib/billing/dates.ts` — pure date math (`addOneMonthClamped`, `isDueOn`).
- `src/lib/billing/dates.test.ts` — Vitest.
- `src/lib/cardcom.ts` — Cardcom API client (payload builders + fetch wrappers + response normalizers).
- `src/lib/cardcom.test.ts` — Vitest (pure builders/normalizers only).
- `src/app/api/billing/customers/route.ts` — GET (list) + POST (create/update customer).
- `src/app/api/billing/charge/create-lowprofile/route.ts` — create first-charge LowProfile page.
- `src/app/api/billing/charge/result/route.ts` — GET polling endpoint for a charge's status.
- `src/app/api/billing/cardcom/webhook/route.ts` — Cardcom WebHookUrl callback.
- `src/app/api/billing/subscriptions/[id]/[action]/route.ts` — cancel / pause / resume / charge-now.
- `src/app/api/billing/process/route.ts` — daily recurring-charge cron.
- `src/app/(dashboard)/admin/billing/page.tsx` — the admin UI page.
- `src/components/dashboard/billing/AddBillingCustomerModal.tsx` — create-customer + Cardcom iframe modal.
- `src/components/dashboard/billing/ChargeHistoryModal.tsx` — per-subscription charge log.

**Modify:**
- `src/app/(dashboard)/layout.tsx` — add nav item (group "עסקים ומשתמשים"), flat-list is derived automatically, add `pageTitles` entry.
- `package.json` — add `vitest` devDependency + `"test": "vitest run"` script.
- `.env.example` (create if missing) — document new env vars.

---

## Task 1: Add Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install Vitest (dev-only)**

Run (Git Bash, per CLAUDE.md npm path rule):
```bash
/c/Program\ Files/nodejs/npm.cmd install -D vitest
```
Expected: `vitest` added under devDependencies.

- [ ] **Step 2: Add test script**

In `package.json` `scripts`, add after `"lint": "eslint"`:
```json
    "lint": "eslint",
    "test": "vitest run"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Verify the runner works (no tests yet = passes)**

Run: `/c/Program\ Files/nodejs/npm.cmd test`
Expected: exits 0 with "No test files found" or similar (non-error). If it errors on "no tests", that's fine — the next task adds one.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(billing): add vitest for unit tests"
```

---

## Task 2: Database migration (3 tables + RLS + indexes)

**Files:**
- Create: `supabase/migrations/20260608_billing_module.sql` (reference copy)
- Apply via Supabase MCP `apply_migration` (name: `billing_module`)

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260608_billing_module.sql` with exactly:

```sql
-- billing_customers: standalone customers billed by admins (not tied to businesses/users)
create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  tax_id text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- billing_subscriptions: one monthly subscription per customer
create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.billing_customers(id) on delete cascade,
  monthly_amount numeric not null check (monthly_amount > 0),
  currency text not null default 'ILS',
  status text not null default 'pending'
    check (status in ('pending','active','paused','cancelled','failed')),
  cardcom_token text,
  card_last_four text,
  card_expiry text,
  next_charge_date date,
  day_of_month int check (day_of_month between 1 and 31),
  failed_attempts int not null default 0,
  started_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- billing_charges: log of every charge attempt
create table if not exists public.billing_charges (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.billing_subscriptions(id) on delete set null,
  customer_id uuid references public.billing_customers(id) on delete set null,
  amount numeric not null,
  status text not null default 'pending'
    check (status in ('pending','success','failed')),
  type text not null check (type in ('initial','recurring','manual')),
  cardcom_low_profile_id text,
  cardcom_transaction_id text,
  cardcom_response jsonb,
  error_message text,
  charged_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_sub_customer on public.billing_subscriptions(customer_id);
create index if not exists idx_billing_sub_due on public.billing_subscriptions(status, next_charge_date);
create index if not exists idx_billing_charges_sub on public.billing_charges(subscription_id);
create index if not exists idx_billing_charges_customer on public.billing_charges(customer_id);

-- updated_at triggers (reuse existing helper if present; else inline)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_billing_customers_updated on public.billing_customers;
create trigger trg_billing_customers_updated before update on public.billing_customers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_subscriptions_updated on public.billing_subscriptions;
create trigger trg_billing_subscriptions_updated before update on public.billing_subscriptions
  for each row execute function public.set_updated_at();

-- RLS: admin-only, separate policy per operation (per project rules; never FOR ALL)
alter table public.billing_customers enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_charges enable row level security;

-- billing_customers
create policy billing_customers_select on public.billing_customers for select using (public.is_admin());
create policy billing_customers_insert on public.billing_customers for insert with check (public.is_admin());
create policy billing_customers_update on public.billing_customers for update using (public.is_admin()) with check (public.is_admin());
create policy billing_customers_delete on public.billing_customers for delete using (public.is_admin());

-- billing_subscriptions
create policy billing_subscriptions_select on public.billing_subscriptions for select using (public.is_admin());
create policy billing_subscriptions_insert on public.billing_subscriptions for insert with check (public.is_admin());
create policy billing_subscriptions_update on public.billing_subscriptions for update using (public.is_admin()) with check (public.is_admin());
create policy billing_subscriptions_delete on public.billing_subscriptions for delete using (public.is_admin());

-- billing_charges
create policy billing_charges_select on public.billing_charges for select using (public.is_admin());
create policy billing_charges_insert on public.billing_charges for insert with check (public.is_admin());
create policy billing_charges_update on public.billing_charges for update using (public.is_admin()) with check (public.is_admin());
create policy billing_charges_delete on public.billing_charges for delete using (public.is_admin());
```

> Note: the cron and webhook use the **service-role** client which bypasses RLS, so these policies only need to gate end-users (admins) — that is correct and intended.

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `apply_migration` MCP tool with name `billing_module` and the SQL above.
Expected: success, no error.

- [ ] **Step 3: Verify the tables exist**

Use `execute_sql` (read_only):
```sql
select table_name from information_schema.tables
where table_schema='public' and table_name like 'billing_%' order by table_name;
```
Expected: `billing_charges`, `billing_customers`, `billing_subscriptions`.

- [ ] **Step 4: Verify `set_updated_at` did not already exist with a different definition**

If Step 2 failed because `set_updated_at` already exists with a different body, remove the `create or replace function public.set_updated_at()` block and both trigger blocks' dependence on it is fine (the existing function is reused). Re-apply. (Skip if Step 2 succeeded.)

- [ ] **Step 5: Commit the reference SQL**

```bash
git add supabase/migrations/20260608_billing_module.sql
git commit -m "feat(billing): add billing tables + admin-only RLS migration"
```

---

## Task 3: Domain types

**Files:**
- Create: `src/types/billing.ts`

- [ ] **Step 1: Write the types**

```ts
export type SubscriptionStatus =
  | "pending"
  | "active"
  | "paused"
  | "cancelled"
  | "failed";

export type ChargeStatus = "pending" | "success" | "failed";
export type ChargeType = "initial" | "recurring" | "manual";

export interface BillingCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface BillingSubscription {
  id: string;
  customer_id: string;
  monthly_amount: number;
  currency: string;
  status: SubscriptionStatus;
  cardcom_token: string | null;
  card_last_four: string | null;
  card_expiry: string | null;
  next_charge_date: string | null;
  day_of_month: number | null;
  failed_attempts: number;
  started_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillingCharge {
  id: string;
  subscription_id: string | null;
  customer_id: string | null;
  amount: number;
  status: ChargeStatus;
  type: ChargeType;
  cardcom_low_profile_id: string | null;
  cardcom_transaction_id: string | null;
  cardcom_response: unknown;
  error_message: string | null;
  charged_at: string | null;
  created_at: string;
}

/** Row shape returned by GET /api/billing/customers */
export interface BillingCustomerWithSubscription extends BillingCustomer {
  subscription: BillingSubscription | null;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `/c/Program\ Files/nodejs/npx.cmd tsc --noEmit`
Expected: no errors referencing `src/types/billing.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/types/billing.ts
git commit -m "feat(billing): add billing domain types"
```

---

## Task 4: Pure date logic (TDD)

**Files:**
- Create: `src/lib/billing/dates.ts`
- Test: `src/lib/billing/dates.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/billing/dates.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { addOneMonthClamped, isDueOn } from "./dates";

describe("addOneMonthClamped", () => {
  it("advances a normal mid-month date by one month", () => {
    expect(addOneMonthClamped("2026-01-15", 15)).toBe("2026-02-15");
  });
  it("clamps day 31 to the last day of a short month", () => {
    expect(addOneMonthClamped("2026-01-31", 31)).toBe("2026-02-28");
  });
  it("clamps day 31 to 30 for a 30-day month", () => {
    expect(addOneMonthClamped("2026-03-31", 31)).toBe("2026-04-30");
  });
  it("restores the original day_of_month after a clamp", () => {
    // Jan31 -> Feb28 -> Mar31 (not Mar28)
    expect(addOneMonthClamped("2026-02-28", 31)).toBe("2026-03-31");
  });
  it("rolls over the year in December", () => {
    expect(addOneMonthClamped("2026-12-10", 10)).toBe("2027-01-10");
  });
});

describe("isDueOn", () => {
  it("is due when next_charge_date is on or before today", () => {
    expect(isDueOn("2026-06-08", "2026-06-08")).toBe(true);
    expect(isDueOn("2026-06-07", "2026-06-08")).toBe(true);
  });
  it("is not due when next_charge_date is in the future", () => {
    expect(isDueOn("2026-06-09", "2026-06-08")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `/c/Program\ Files/nodejs/npm.cmd test`
Expected: FAIL — `./dates` not found / functions undefined.

- [ ] **Step 3: Implement**

`src/lib/billing/dates.ts`:
```ts
/** Days in a given month (month is 1-12). */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate(); // month index 'month' = next month, day 0 = last day of 'month'
}

/**
 * Advance an ISO date (YYYY-MM-DD) by one calendar month, anchoring to
 * `dayOfMonth` and clamping to the target month's last day when needed.
 * Works purely on integers — no timezone drift.
 */
export function addOneMonthClamped(isoDate: string, dayOfMonth: number): string {
  const [y, m] = isoDate.split("-").map(Number); // m is 1-12
  let year = y;
  let month = m + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  const lastDay = daysInMonth(year, month);
  const day = Math.min(dayOfMonth, lastDay);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** True if `nextChargeDate` (YYYY-MM-DD) is on or before `today` (YYYY-MM-DD). */
export function isDueOn(nextChargeDate: string, today: string): boolean {
  return nextChargeDate <= today; // ISO date strings compare lexicographically
}
```

- [ ] **Step 4: Run to verify pass**

Run: `/c/Program\ Files/nodejs/npm.cmd test`
Expected: PASS (7 assertions across 2 suites).

- [ ] **Step 5: Commit**

```bash
git add src/lib/billing/dates.ts src/lib/billing/dates.test.ts
git commit -m "feat(billing): add clamped month-advance + due-date helpers (TDD)"
```

---

## Task 5: Cardcom client library

**Files:**
- Create: `src/lib/cardcom.ts`
- Test: `src/lib/cardcom.test.ts`

The client reads credentials from env (never hard-coded). It exposes pure builders (unit-tested) and thin fetch wrappers (verified by manual sandbox test in later tasks).

- [ ] **Step 1: Write the failing tests for the pure builders/normalizers**

`src/lib/cardcom.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildLowProfilePayload, buildTokenChargePayload, normalizeLpResult } from "./cardcom";

beforeEach(() => {
  process.env.CARDCOM_TERMINAL = "191080";
  process.env.CARDCOM_API_NAME = "test-api-name";
  process.env.CARDCOM_BASE_URL = "https://secure.cardcom.solutions/api/v11";
});

describe("buildLowProfilePayload", () => {
  it("includes terminal, api name, amount, ChargeAndCreateToken op, and ReturnValue", () => {
    const p = buildLowProfilePayload({
      amount: 199,
      chargeId: "charge-123",
      successUrl: "https://app/x/success",
      failedUrl: "https://app/x/failed",
      webhookUrl: "https://app/x/webhook",
      customer: { name: "דני", email: "d@x.co", taxId: "123", phone: "050" },
    });
    expect(p.TerminalNumber).toBe(191080);
    expect(p.ApiName).toBe("test-api-name");
    expect(p.Amount).toBe(199);
    expect(p.Operation).toBe("ChargeAndCreateToken");
    expect(p.ReturnValue).toBe("charge-123");
    expect(p.WebHookUrl).toBe("https://app/x/webhook");
    expect(p.SuccessRedirectUrl).toBe("https://app/x/success");
    expect(p.FailedRedirectUrl).toBe("https://app/x/failed");
    // invoice/document requested for the customer
    expect(p.Document?.Name).toBe("דני");
  });
});

describe("buildTokenChargePayload", () => {
  it("uses confirmed token fields", () => {
    const p = buildTokenChargePayload({ amount: 199, token: "tok-1", cardExpiryMMYY: "1230" });
    expect(p.TerminalNumber).toBe(191080);
    expect(p.ApiName).toBe("test-api-name");
    expect(p.Amount).toBe(199);
    expect(p.Token).toBe("tok-1");
    expect(p.CardExpirationMMYY).toBe("1230");
  });
});

describe("normalizeLpResult", () => {
  it("maps a successful raw result (ResponseCode 0) to success", () => {
    const raw = {
      ResponseCode: 0,
      TranzactionId: 555,
      TokenInfo: { Token: "tok-xyz", CardLast4Digits: "4242", CardYearMonth: "1230" },
    };
    const n = normalizeLpResult(raw);
    expect(n.success).toBe(true);
    expect(n.token).toBe("tok-xyz");
    expect(n.lastFour).toBe("4242");
    expect(n.expiryMMYY).toBe("1230");
    expect(n.transactionId).toBe("555");
  });
  it("maps a non-zero ResponseCode to failure with the description", () => {
    const n = normalizeLpResult({ ResponseCode: 57, Description: "declined" });
    expect(n.success).toBe(false);
    expect(n.error).toBe("declined");
  });
});
```

> The `normalizeLpResult` field paths (`TranzactionId`, `TokenInfo.Token`, `CardLast4Digits`, `CardYearMonth`) are **best-guess** Cardcom v11 names. Step 3 implements them defensively (multiple fallbacks). During Task 8/12 sandbox testing, confirm against the logged raw payload and adjust both the impl and these tests together.

- [ ] **Step 2: Run to verify failure**

Run: `/c/Program\ Files/nodejs/npm.cmd test`
Expected: FAIL — `./cardcom` exports not found.

- [ ] **Step 3: Implement the client**

`src/lib/cardcom.ts`:
```ts
// Cardcom API v11 client. Credentials come from env ONLY.
// Swagger: https://secure.cardcom.solutions/swagger/index.html?url=/swagger/v11/swagger.json

function cfg() {
  const terminal = Number(process.env.CARDCOM_TERMINAL);
  const apiName = process.env.CARDCOM_API_NAME;
  const baseUrl = process.env.CARDCOM_BASE_URL || "https://secure.cardcom.solutions/api/v11";
  if (!terminal || !apiName) throw new Error("Missing Cardcom env vars");
  return { terminal, apiName, baseUrl };
}

export interface CardcomCustomer {
  name: string;
  email?: string | null;
  taxId?: string | null;
  phone?: string | null;
}

export interface LowProfilePayload {
  TerminalNumber: number;
  ApiName: string;
  Amount: number;
  Operation: "ChargeAndCreateToken";
  ReturnValue: string;
  SuccessRedirectUrl: string;
  FailedRedirectUrl: string;
  WebHookUrl: string;
  Document?: { Name: string; Email?: string; TaxId?: string; Mobile?: string };
}

export function buildLowProfilePayload(args: {
  amount: number;
  chargeId: string;
  successUrl: string;
  failedUrl: string;
  webhookUrl: string;
  customer: CardcomCustomer;
}): LowProfilePayload {
  const { terminal, apiName } = cfg();
  return {
    TerminalNumber: terminal,
    ApiName: apiName,
    Amount: args.amount,
    Operation: "ChargeAndCreateToken",
    ReturnValue: args.chargeId,
    SuccessRedirectUrl: args.successUrl,
    FailedRedirectUrl: args.failedUrl,
    WebHookUrl: args.webhookUrl,
    Document: {
      Name: args.customer.name,
      Email: args.customer.email ?? undefined,
      TaxId: args.customer.taxId ?? undefined,
      Mobile: args.customer.phone ?? undefined,
    },
  };
}

export interface TokenChargePayload {
  TerminalNumber: number;
  ApiName: string;
  Amount: number;
  Token: string;
  CardExpirationMMYY: string;
}

export function buildTokenChargePayload(args: {
  amount: number;
  token: string;
  cardExpiryMMYY: string;
}): TokenChargePayload {
  const { terminal, apiName } = cfg();
  return {
    TerminalNumber: terminal,
    ApiName: apiName,
    Amount: args.amount,
    Token: args.token,
    CardExpirationMMYY: args.cardExpiryMMYY,
  };
}

export interface NormalizedResult {
  success: boolean;
  token?: string;
  lastFour?: string;
  expiryMMYY?: string;
  transactionId?: string;
  error?: string;
  raw: unknown;
}

/** Defensive extraction — Cardcom field names vary; check several. */
export function normalizeLpResult(raw: any): NormalizedResult {
  const code = raw?.ResponseCode ?? raw?.responseCode;
  const success = code === 0;
  const tokenInfo = raw?.TokenInfo ?? raw?.tokenInfo ?? {};
  const tranId =
    raw?.TranzactionId ?? raw?.TransactionId ?? raw?.tranzactionId ?? raw?.InternalDealNumber;
  return {
    success,
    token: tokenInfo.Token ?? tokenInfo.token ?? raw?.Token,
    lastFour:
      tokenInfo.CardLast4Digits ?? tokenInfo.Last4Digits ?? raw?.CardNumLast4 ?? raw?.Last4,
    expiryMMYY: tokenInfo.CardYearMonth ?? tokenInfo.CardValidityYearMonth ?? raw?.CardExpiry,
    transactionId: tranId != null ? String(tranId) : undefined,
    error: success ? undefined : raw?.Description ?? raw?.description ?? `ResponseCode ${code}`,
    raw,
  };
}

async function postJson(path: string, body: unknown): Promise<any> {
  const { baseUrl } = cfg();
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** Create a hosted LowProfile page. Returns the page URL + LowProfile id. */
export async function createLowProfile(args: Parameters<typeof buildLowProfilePayload>[0]) {
  const raw = await postJson("/LowProfile/Create", buildLowProfilePayload(args));
  return {
    url: raw?.Url ?? raw?.url,
    lowProfileId: raw?.LowProfileId ?? raw?.lowProfileId,
    raw,
  };
}

/** Verify a LowProfile transaction result server-side. */
export async function getLpResult(lowProfileId: string): Promise<NormalizedResult> {
  const { terminal, apiName } = cfg();
  const raw = await postJson("/LowProfile/GetLpResult", {
    TerminalNumber: terminal,
    ApiName: apiName,
    LowProfileId: lowProfileId,
  });
  return normalizeLpResult(raw);
}

/** Charge a saved token (server-to-server, no PAN). */
export async function chargeToken(args: {
  amount: number;
  token: string;
  cardExpiryMMYY: string;
}): Promise<NormalizedResult> {
  const raw = await postJson("/Transactions/Transaction", buildTokenChargePayload(args));
  return normalizeLpResult(raw);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `/c/Program\ Files/nodejs/npm.cmd test`
Expected: PASS (all cardcom + dates suites).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cardcom.ts src/lib/cardcom.test.ts
git commit -m "feat(billing): add Cardcom v11 client (builders TDD'd, fetch wrappers)"
```

---

## Task 6: `GET/POST /api/billing/customers`

**Files:**
- Create: `src/app/api/billing/customers/route.ts`

Auth pattern copied from `src/app/api/admin/create-user/route.ts` (`createServerClient` → `auth.getUser()` → `profiles.is_admin`). Uses the **server (cookie) client** so RLS applies as the admin.

- [ ] **Step 1: Implement**

```ts
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

async function requireAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "לא מחובר" }, { status: 401 }) };
  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return { error: NextResponse.json({ error: "אין הרשאת אדמין" }, { status: 403 }) };
  return { supabase, user };
}

export async function GET() {
  const ctx = await requireAdmin();
  if (ctx.error) return ctx.error;
  const { supabase } = ctx;

  const { data: customers, error } = await supabase
    .from("billing_customers")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (customers ?? []).map((c) => c.id);
  const { data: subs } = ids.length
    ? await supabase.from("billing_subscriptions").select("*").in("customer_id", ids)
    : { data: [] as any[] };

  const byCustomer = new Map((subs ?? []).map((s) => [s.customer_id, s]));
  const rows = (customers ?? []).map((c) => ({ ...c, subscription: byCustomer.get(c.id) ?? null }));
  return NextResponse.json({ customers: rows });
}

export async function POST(request: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx.error) return ctx.error;
  const { supabase, user } = ctx;

  const body = await request.json();
  const { id, name, phone, email, tax_id, notes } = body;
  if (!name) return NextResponse.json({ error: "חסר שם" }, { status: 400 });

  if (id) {
    const { data, error } = await supabase
      .from("billing_customers")
      .update({ name, phone, email, tax_id, notes })
      .eq("id", id).select("*").maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ customer: data });
  }

  const { data, error } = await supabase
    .from("billing_customers")
    .insert({ name, phone, email, tax_id, notes, created_by: user.id })
    .select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ customer: data });
}
```

- [ ] **Step 2: Verify build**

Run: `/c/Program\ Files/nodejs/npx.cmd tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification (after page exists, Task 12) — note for later**

When the UI is up: create a customer, confirm it appears in `GET`. Non-admin user hitting the endpoint gets 403. (Recorded here; perform during Task 12 verification.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/billing/customers/route.ts
git commit -m "feat(billing): customers list + create/update API"
```

---

## Task 7: `POST /api/billing/charge/create-lowprofile`

**Files:**
- Create: `src/app/api/billing/charge/create-lowprofile/route.ts`

Creates (or reuses) a `pending` subscription for the customer, creates a `pending` `billing_charges` row of type `initial`, then asks Cardcom for a hosted page whose `ReturnValue` is the charge id. Uses the **service-role** client for writes so we control state regardless of RLS, but still requires an admin caller.

- [ ] **Step 1: Implement**

```ts
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createLowProfile } from "@/lib/cardcom";

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: NextRequest) {
  // admin gate
  const server = await createServerClient();
  const { data: { user } } = await server.auth.getUser();
  if (!user) return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  const { data: profile } = await server.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return NextResponse.json({ error: "אין הרשאת אדמין" }, { status: 403 });

  const { customerId, monthlyAmount } = await request.json();
  if (!customerId || !monthlyAmount || monthlyAmount <= 0)
    return NextResponse.json({ error: "חסר לקוח או סכום" }, { status: 400 });

  const db = service();
  const { data: customer } = await db.from("billing_customers").select("*").eq("id", customerId).maybeSingle();
  if (!customer) return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });

  // upsert a pending subscription (one per customer)
  let { data: sub } = await db.from("billing_subscriptions").select("*").eq("customer_id", customerId).maybeSingle();
  if (!sub) {
    const ins = await db.from("billing_subscriptions")
      .insert({ customer_id: customerId, monthly_amount: monthlyAmount, status: "pending" })
      .select("*").single();
    sub = ins.data!;
  } else {
    const upd = await db.from("billing_subscriptions")
      .update({ monthly_amount: monthlyAmount }).eq("id", sub.id).select("*").single();
    sub = upd.data!;
  }

  const charge = await db.from("billing_charges")
    .insert({ subscription_id: sub.id, customer_id: customerId, amount: monthlyAmount, status: "pending", type: "initial" })
    .select("*").single();
  if (charge.error || !charge.data)
    return NextResponse.json({ error: "שגיאה ביצירת חיוב" }, { status: 500 });

  const origin = new URL(request.url).origin;
  const lp = await createLowProfile({
    amount: monthlyAmount,
    chargeId: charge.data.id,
    successUrl: `${origin}/admin/billing?charge=${charge.data.id}&status=success`,
    failedUrl: `${origin}/admin/billing?charge=${charge.data.id}&status=failed`,
    webhookUrl: `${origin}/api/billing/cardcom/webhook`,
    customer: { name: customer.name, email: customer.email, taxId: customer.tax_id, phone: customer.phone },
  });

  await db.from("billing_charges").update({ cardcom_low_profile_id: lp.lowProfileId, cardcom_response: lp.raw }).eq("id", charge.data.id);

  if (!lp.url) return NextResponse.json({ error: "Cardcom לא החזיר כתובת תשלום", raw: lp.raw }, { status: 502 });
  return NextResponse.json({ url: lp.url, chargeId: charge.data.id, subscriptionId: sub.id });
}
```

- [ ] **Step 2: Verify build**

Run: `/c/Program\ Files/nodejs/npx.cmd tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/billing/charge/create-lowprofile/route.ts
git commit -m "feat(billing): create Cardcom LowProfile for first charge"
```

---

## Task 8: `POST /api/billing/cardcom/webhook` + `GET /api/billing/charge/result`

**Files:**
- Create: `src/app/api/billing/cardcom/webhook/route.ts`
- Create: `src/app/api/billing/charge/result/route.ts`

Webhook is called by Cardcom's servers (no user session). It re-verifies via `getLpResult`, is idempotent, and on success activates the subscription. `charge/result` lets the UI poll the charge status while the iframe is open.

- [ ] **Step 1: Implement the webhook**

`src/app/api/billing/cardcom/webhook/route.ts`:
```ts
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getLpResult } from "@/lib/cardcom";
import { addOneMonthClamped } from "@/lib/billing/dates";

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: NextRequest) {
  const db = service();
  // Cardcom may send form-encoded or JSON; accept both, then re-verify server-side.
  let payload: any = {};
  try { payload = await request.json(); } catch {
    const form = await request.formData().catch(() => null);
    if (form) payload = Object.fromEntries(form.entries());
  }
  const returnValue = payload?.ReturnValue ?? payload?.returnValue;
  const lowProfileId = payload?.LowProfileId ?? payload?.lowProfileId;
  if (!returnValue) return NextResponse.json({ ok: true }); // nothing to correlate

  const { data: charge } = await db.from("billing_charges").select("*").eq("id", returnValue).maybeSingle();
  if (!charge) return NextResponse.json({ ok: true });
  if (charge.status === "success") return NextResponse.json({ ok: true }); // idempotent

  // Re-verify with Cardcom — do NOT trust the webhook body alone.
  const result = lowProfileId ? await getLpResult(lowProfileId) : { success: false, raw: payload, error: "no LowProfileId" } as any;

  if (!result.success) {
    await db.from("billing_charges").update({
      status: "failed", error_message: result.error ?? "נכשל", cardcom_response: result.raw,
    }).eq("id", charge.id);
    return NextResponse.json({ ok: true });
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const dayOfMonth = Number(todayStr.split("-")[2]);
  const nextChargeDate = addOneMonthClamped(todayStr, dayOfMonth);

  await db.from("billing_charges").update({
    status: "success",
    cardcom_transaction_id: result.transactionId ?? null,
    charged_at: new Date().toISOString(),
    cardcom_response: result.raw,
  }).eq("id", charge.id);

  if (charge.subscription_id) {
    await db.from("billing_subscriptions").update({
      status: "active",
      cardcom_token: result.token ?? null,
      card_last_four: result.lastFour ?? null,
      card_expiry: result.expiryMMYY ?? null,
      day_of_month: dayOfMonth,
      next_charge_date: nextChargeDate,
      failed_attempts: 0,
      started_at: new Date().toISOString(),
    }).eq("id", charge.subscription_id);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Implement the poll endpoint**

`src/app/api/billing/charge/result/route.ts`:
```ts
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return NextResponse.json({ error: "אין הרשאת אדמין" }, { status: 403 });

  const chargeId = new URL(request.url).searchParams.get("chargeId");
  if (!chargeId) return NextResponse.json({ error: "חסר chargeId" }, { status: 400 });

  const { data } = await supabase.from("billing_charges").select("id,status,error_message").eq("id", chargeId).maybeSingle();
  return NextResponse.json({ charge: data });
}
```

- [ ] **Step 3: Verify build**

Run: `/c/Program\ Files/nodejs/npx.cmd tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Sandbox verification note**

On first sandbox charge: log `result.raw` from the webhook (temporarily `console.log`), confirm `normalizeLpResult` extracted `token`, `lastFour`, `expiryMMYY`, `transactionId` correctly. If any are missing, fix the field paths in `src/lib/cardcom.ts` `normalizeLpResult` AND its test in Task 5, re-run `npm test`, then remove the temporary log.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/billing/cardcom/webhook/route.ts src/app/api/billing/charge/result/route.ts
git commit -m "feat(billing): Cardcom webhook (verified, idempotent) + charge poll endpoint"
```

---

## Task 9: Subscription management — `POST /api/billing/subscriptions/[id]/[action]`

**Files:**
- Create: `src/app/api/billing/subscriptions/[id]/[action]/route.ts`

Handles `cancel`, `pause`, `resume`, `charge-now`. Admin-gated.

- [ ] **Step 1: Implement**

```ts
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { chargeToken } from "@/lib/cardcom";
import { addOneMonthClamped } from "@/lib/billing/dates";

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  const server = await createServerClient();
  const { data: { user } } = await server.auth.getUser();
  if (!user) return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  const { data: profile } = await server.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return NextResponse.json({ error: "אין הרשאת אדמין" }, { status: 403 });

  const { id, action } = await params;
  const db = service();
  const { data: sub } = await db.from("billing_subscriptions").select("*").eq("id", id).maybeSingle();
  if (!sub) return NextResponse.json({ error: "מנוי לא נמצא" }, { status: 404 });

  if (action === "cancel") {
    await db.from("billing_subscriptions").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ ok: true });
  }
  if (action === "pause") {
    await db.from("billing_subscriptions").update({ status: "paused" }).eq("id", id);
    return NextResponse.json({ ok: true });
  }
  if (action === "resume") {
    if (sub.status !== "paused") return NextResponse.json({ error: "ניתן לחדש רק מנוי מושהה" }, { status: 400 });
    await db.from("billing_subscriptions").update({ status: "active" }).eq("id", id);
    return NextResponse.json({ ok: true });
  }
  if (action === "charge-now") {
    if (!sub.cardcom_token || !sub.card_expiry)
      return NextResponse.json({ error: "אין token שמור לחיוב" }, { status: 400 });
    const charge = await db.from("billing_charges")
      .insert({ subscription_id: sub.id, customer_id: sub.customer_id, amount: sub.monthly_amount, status: "pending", type: "manual" })
      .select("*").single();
    const result = await chargeToken({ amount: sub.monthly_amount, token: sub.cardcom_token, cardExpiryMMYY: sub.card_expiry });
    await db.from("billing_charges").update({
      status: result.success ? "success" : "failed",
      cardcom_transaction_id: result.transactionId ?? null,
      error_message: result.success ? null : result.error,
      charged_at: result.success ? new Date().toISOString() : null,
      cardcom_response: result.raw,
    }).eq("id", charge.data!.id);
    if (result.success) {
      const today = new Date().toISOString().split("T")[0];
      await db.from("billing_subscriptions").update({
        next_charge_date: addOneMonthClamped(today, sub.day_of_month ?? Number(today.split("-")[2])),
        failed_attempts: 0,
      }).eq("id", id);
    }
    return NextResponse.json({ ok: result.success, error: result.success ? undefined : result.error });
  }

  return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
}
```

- [ ] **Step 2: Verify build**

Run: `/c/Program\ Files/nodejs/npx.cmd tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/billing/subscriptions/[id]/[action]/route.ts"
git commit -m "feat(billing): subscription cancel/pause/resume/charge-now API"
```

---

## Task 10: Daily recurring cron — `POST /api/billing/process`

**Files:**
- Create: `src/app/api/billing/process/route.ts`

Same auth as `/api/retainers/process` (`x-cron-secret` vs `CRON_SECRET`, timing-safe). Charges all due subscriptions; idempotent per day; bumps `failed_attempts`, marking `failed` after 3.

- [ ] **Step 1: Implement**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { chargeToken } from "@/lib/cardcom";
import { addOneMonthClamped, isDueOn } from "@/lib/billing/dates";

const MAX_ATTEMPTS = 3;

function service() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get("x-cron-secret");
  const valid = process.env.CRON_SECRET;
  let ok = false;
  try { if (valid && cronSecret) ok = timingSafeEqual(Buffer.from(cronSecret), Buffer.from(valid)); } catch {}
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = service();
  const today = new Date().toISOString().split("T")[0];

  const { data: subs, error } = await db.from("billing_subscriptions")
    .select("*").eq("status", "active").not("cardcom_token", "is", null).lte("next_charge_date", today);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!subs || subs.length === 0) return NextResponse.json({ processed: 0, message: "אין מנויים לחיוב היום" });

  let processed = 0;
  const errors: string[] = [];

  for (const sub of subs) {
    try {
      if (!sub.next_charge_date || !isDueOn(sub.next_charge_date, today)) continue;
      // idempotency: skip if a successful charge already exists today
      const { data: existing } = await db.from("billing_charges")
        .select("id").eq("subscription_id", sub.id).eq("status", "success")
        .gte("charged_at", `${today}T00:00:00`).maybeSingle();
      if (existing) continue;

      const charge = await db.from("billing_charges")
        .insert({ subscription_id: sub.id, customer_id: sub.customer_id, amount: sub.monthly_amount, status: "pending", type: "recurring" })
        .select("*").single();

      const result = await chargeToken({ amount: sub.monthly_amount, token: sub.cardcom_token, cardExpiryMMYY: sub.card_expiry });

      if (result.success) {
        await db.from("billing_charges").update({
          status: "success", cardcom_transaction_id: result.transactionId ?? null,
          charged_at: new Date().toISOString(), cardcom_response: result.raw,
        }).eq("id", charge.data!.id);
        await db.from("billing_subscriptions").update({
          next_charge_date: addOneMonthClamped(sub.next_charge_date, sub.day_of_month ?? Number(today.split("-")[2])),
          failed_attempts: 0,
        }).eq("id", sub.id);
        processed++;
      } else {
        const attempts = (sub.failed_attempts ?? 0) + 1;
        await db.from("billing_charges").update({
          status: "failed", error_message: result.error, cardcom_response: result.raw,
        }).eq("id", charge.data!.id);
        await db.from("billing_subscriptions").update({
          failed_attempts: attempts,
          status: attempts >= MAX_ATTEMPTS ? "failed" : "active",
        }).eq("id", sub.id);
        errors.push(`${sub.id}: ${result.error}`);
      }
    } catch (err) {
      errors.push(`${sub.id}: ${String(err)}`);
    }
  }

  return NextResponse.json({ processed, total: subs.length, errors: errors.length ? errors : undefined });
}
```

- [ ] **Step 2: Verify build**

Run: `/c/Program\ Files/nodejs/npx.cmd tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/billing/process/route.ts
git commit -m "feat(billing): daily recurring-charge cron (token, idempotent, retry cap)"
```

---

## Task 11: Admin page UI — `/admin/billing`

**Files:**
- Create: `src/app/(dashboard)/admin/billing/page.tsx`
- Create: `src/components/dashboard/billing/AddBillingCustomerModal.tsx`
- Create: `src/components/dashboard/billing/ChargeHistoryModal.tsx`

**Reference patterns (read before coding):**
- RTL table layout: the invoice table in `src/app/(dashboard)/admin/expenses/page.tsx` / `src/app/(dashboard)/...expenses` — header `grid grid-cols-[...] bg-[#29318A] rounded-t-[7px] p-[10px_5px] pe-[13px] items-center`, rows in `max-h-[450px] overflow-y-auto flex flex-col gap-[5px]` with the **same `grid-cols`** and `fr` units (see project memory "Table Alignment Pattern" — mandatory).
- Admin page shell + `useDashboard()` usage: `src/app/(dashboard)/admin/online-users/page.tsx`.
- Dialog primitive: `@/components/ui/dialog` (Radix) as used elsewhere in `src/components/dashboard/`.

**RTL reminder (project rule):** in a flex row the FIRST child renders on the RIGHT. Currency ₪ sits next to the number; use `text-align: start`.

- [ ] **Step 1: Build the page**

Create `src/app/(dashboard)/admin/billing/page.tsx` (`"use client"`). Requirements:
- On mount, `fetch("/api/billing/customers")` → render the customers table.
- Columns (RTL, first = rightmost): שם · טלפון · סכום חודשי (₪) · סטטוס (colored badge) · תאריך חיוב הבא · 4 ספרות · פעולות.
- Status badge colors: `pending`→gray, `active`→green, `paused`→orange, `failed`→red, `cancelled`→dark-gray. Hebrew labels: ממתין/פעיל/מושהה/נכשל/בוטל.
- A "+ לקוח חדש" button (top) opens `AddBillingCustomerModal`.
- Per-row actions (only when a subscription exists): "חייב עכשיו" (`charge-now`), "השהה"/"חדש" (`pause`/`resume` by status), "בטל" (`cancel`), "היסטוריה" (opens `ChargeHistoryModal`). Each action POSTs to the matching endpoint then re-fetches.
- On query param `?charge=<id>&status=success|failed` (the Cardcom redirect landing), show a toast and clear the param, then re-fetch.

Use the exact table classes from the referenced expenses pattern. Keep the file focused; extract the two modals into their own files (below).

- [ ] **Step 2: Build `AddBillingCustomerModal.tsx`**

Behavior:
- Form fields: שם (required), טלפון, מייל, ח.פ/ת.ז, סכום חודשי (₪, required, > 0).
- On submit: `POST /api/billing/customers` to create the customer → then `POST /api/billing/charge/create-lowprofile` with `{ customerId, monthlyAmount }`.
- On `{ url, chargeId }`: render the Cardcom page in an `<iframe src={url} className="w-full h-[600px]" />` inside the dialog.
- While the iframe is open, poll `GET /api/billing/charge/result?chargeId=...` every 3s. When `status==="success"`: close, toast "החיוב בוצע, המנוי הופעל", call the parent's `onDone()`. When `"failed"`: show error, allow retry.
- Number formatting on the amount input AND display per project rule.

- [ ] **Step 3: Build `ChargeHistoryModal.tsx`**

- Prop: `subscriptionId`. On open, `fetch` charges for that subscription. The `customers` route doesn't expose charges; add a small `GET` branch: extend `src/app/api/billing/customers/route.ts`? No — instead read directly: create `GET /api/billing/subscriptions/[id]/[action]` is POST-only. Simplest: query via a new `GET /api/billing/charges?subscriptionId=` OR reuse the page's already-loaded data. **Decision:** add a `GET` handler at `src/app/api/billing/charges/route.ts` (admin-gated) returning charges for a `subscriptionId` query param, ordered by `created_at desc`. Implement it the same way as the customers GET (admin gate + select). Display: date, type (ראשוני/חוזר/ידני), amount ₪, status badge, error if any.

> This adds one more file: `src/app/api/billing/charges/route.ts`. Implement the admin gate exactly like Task 6 and `select("*").eq("subscription_id", id).order("created_at",{ascending:false})`.

- [ ] **Step 4: Verify build + lint**

Run: `/c/Program\ Files/nodejs/npm.cmd run build`
Expected: build succeeds, `/admin/billing` route compiled.
Run: `/c/Program\ Files/nodejs/npm.cmd run lint`
Expected: no errors in new files.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/admin/billing/page.tsx" "src/components/dashboard/billing/" "src/app/api/billing/charges/route.ts"
git commit -m "feat(billing): admin billing page + add-customer/iframe modal + charge history"
```

---

## Task 12: Sidebar nav wiring

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Add the nav item to the first admin group**

In `adminMenuGroups`, group `"עסקים ומשתמשים"` (around line 117), add after the `admin-ocr-usage` item:
```ts
      { id: 121, label: "שימוש ב-OCR", href: "/admin/ocr-usage", key: "admin-ocr-usage" },
      { id: 122, label: "סליקה", href: "/admin/billing", key: "admin-billing" },
```
(`adminMenuItems` is derived from `adminMenuGroups.flatMap(...)`, so `isAdminPage` updates automatically.)

- [ ] **Step 2: Add the page title**

In `pageTitles` (around line 190), add:
```ts
  "/admin/ocr-usage": "מעקב שימוש ב-OCR",
  "/admin/billing": "סליקה",
```

- [ ] **Step 3: Verify build + manual check**

Run: `/c/Program\ Files/nodejs/npm.cmd run build`
Expected: success.
Manual: log in as admin → "סליקה" appears in the admin menu group; log in as non-admin → it does not appear (whole admin block is `{isAdmin && ...}`).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/layout.tsx"
git commit -m "feat(billing): add admin-only 'סליקה' sidebar link"
```

---

## Task 13: Env vars + final verification

**Files:**
- Create/Modify: `.env.example`

- [ ] **Step 1: Document env vars (names only — no real secrets in git)**

Append to `.env.example`:
```env
# Cardcom (billing/סליקה) — set real values in Dokploy, NEVER commit real values
CARDCOM_TERMINAL=
CARDCOM_API_NAME=
CARDCOM_API_PASSWORD=
CARDCOM_BASE_URL=https://secure.cardcom.solutions/api/v11
# CRON_SECRET is reused from the existing cron auth for /api/billing/process
```

- [ ] **Step 2: Set real values in Dokploy (manual, by user)**

The real terminal number, API name, API password (provided separately by the user) are entered in Dokploy env for the app. Confirm `CRON_SECRET` already exists (used by `/api/retainers/process`). Do NOT put real values in any repo file.

- [ ] **Step 3: Full test + build**

Run: `/c/Program\ Files/nodejs/npm.cmd test`
Expected: PASS (dates + cardcom suites).
Run: `/c/Program\ Files/nodejs/npm.cmd run build`
Expected: success.
Run: `git status` — confirm no new untracked files are missing from commits (per CLAUDE.md: untracked new files break Docker build).

- [ ] **Step 4: End-to-end sandbox test (manual)**

1. Set Cardcom credentials (sandbox/test terminal if available).
2. As admin → /admin/billing → "+ לקוח חדש" → fill + amount → Cardcom iframe loads.
3. Pay with a test card → webhook fires → subscription becomes `active`, shows next charge date + last 4.
4. Confirm `normalizeLpResult` extracted token/last4/expiry/txid (check `billing_charges.cardcom_response` if anything is null) — fix field paths in `cardcom.ts` + test if needed.
5. Trigger the cron manually:
   ```bash
   curl -X POST "$APP_URL/api/billing/process" -H "x-cron-secret: $CRON_SECRET"
   ```
   With `next_charge_date` set to today (temporarily, via SQL) to confirm a recurring charge succeeds and the date advances by one month.
6. Test "חייב עכשיו", "השהה"/"חדש", "בטל", "היסטוריה".

- [ ] **Step 5: Schedule the cron**

Add a daily schedule hitting `POST /api/billing/process` with header `x-cron-secret: <CRON_SECRET>` (same mechanism as the existing retainers cron — e.g. the project's n8n scheduler). Document the schedule wherever the existing crons are documented.

- [ ] **Step 6: Commit**

```bash
git add .env.example
git commit -m "docs(billing): document Cardcom env vars"
```

---

## Self-review notes (addressed)

- **Spec coverage:** customers/subscriptions/charges tables (Task 2) ✓; Cardcom client w/ LowProfile+token+result (Task 5) ✓; create-lowprofile (7), webhook (8), management (9), cron (10), page+modals (11), sidebar (12), env (13) ✓; invoice via `Document` field (Task 5 builder) ✓; admin-only RLS + nav gating ✓.
- **Field-name risk:** `normalizeLpResult` + LowProfileResult paths flagged as unconfirmed; verified against raw payload in Task 8/13 with paired test updates. This is the one place that may need a fix during sandbox testing.
- **Type consistency:** `addOneMonthClamped(iso, dayOfMonth)` and `isDueOn(next, today)` signatures used identically in webhook/management/cron. `normalizeLpResult` return shape (`success/token/lastFour/expiryMMYY/transactionId/error/raw`) consumed consistently.
- **No PCI:** card data only ever in the Cardcom iframe; we store token + last4 + expiry only.
