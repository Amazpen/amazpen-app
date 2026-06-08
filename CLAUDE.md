# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Amazpen (המצפן) is a Hebrew RTL business management SaaS application for tracking financial metrics, expenses, goals, suppliers, and AI-powered insights. Built for restaurant/business operations.

**Production URL:** https://app.amazpenbiz.co.il

## Commands

```bash
npm run dev              # Dev server (port 3000, Turbopack)
npm run dev:webpack      # Dev server without Turbopack
npm run build            # Production build
npm start                # Start production server
npm run lint             # ESLint
```

Docker runs on port **3001** (to avoid Dokploy conflict).

## Tech Stack

- **Framework:** Next.js 16 with App Router, React 19, TypeScript 5.9 (strict)
- **Styling:** Tailwind CSS 4, dark theme forced globally, RTL
- **UI:** Radix UI + shadcn/ui (new-york style), Lucide icons, Recharts (lazy-loaded)
- **Database/Auth:** Supabase (PostgreSQL, Auth, Realtime, Storage)
- **AI:** OpenAI GPT-4.1-mini via Vercel AI SDK, streaming responses
- **Deployment:** Docker multi-stage build → Dokploy/Traefik

## Architecture

### Route Groups
- `src/app/(auth)/` — Public auth pages (login, forgot-password)
- `src/app/(dashboard)/` — Protected pages, nested under dashboard layout with business context
- `src/app/api/` — API routes (ai, upload, push notifications, admin, health, daily-push, metrics)

### DashboardContext (Key State Management)
The main app state lives in `src/app/(dashboard)/layout.tsx` — **not** in a separate contexts/ folder. It defines `DashboardContext` inline, providing:
- `selectedBusinesses` — multi-business selection state shared across all dashboard pages
- `isAdmin` — role check derived from user profile
- `refreshProfile()` — re-fetches user/business data

Access via `useDashboard()` hook (exported from the same layout file).

### Supabase Clients
- **Browser:** `src/lib/supabase/client.ts` — singleton via `createBrowserClient()`
- **Server:** `src/lib/supabase/server.ts` — per-request via `createServerClient()` with cookie handling
- **Middleware:** `middleware.ts` — auth check on every request, redirects unauthenticated users to `/login`. API routes are excluded from middleware matching.

### Component Organization
- `src/components/ui/` — shadcn/ui primitives + app-wide UI (toast, install-prompt, update-prompt, push-prompt)
- `src/components/dashboard/` — Dashboard-specific widgets and modals
- `src/components/ai/` — AI chat interface components
- `src/components/ocr/` — Document OCR scanning and queue components

### Types
Core domain types in `src/types/index.ts`: User, Business, BusinessSchedule, UserBusiness, Supplier, Expense, Payment, Goal, etc. Additional type files: `ai.ts`, `ocr.ts`, `price-tracking.ts`.

### AI Chat System (`/api/ai/chat`)
- Rate limited (20 req/min per user)
- Streaming via `UIMessageStreamResponse`
- Tool calls: `getMonthlySummary`, `queryDatabase` (read-only SQL), `getBusinessSchedule`, `getGoals`, `calculate`, `proposeAction`
- Conversations persisted in `ai_chat_sessions` / `ai_chat_messages` tables

### OCR System
- `/api/ai/ocr` — Processes uploaded document images via OpenAI vision
- `src/components/ocr/` — Document queue UI with PDF viewer support (uses `pdfjs-dist`)
- Supports PDF-to-image conversion via `src/lib/pdfToImage.ts`

### Billing / Cardcom (סליקה) — admin-only subscription billing
Admin-only module at `/admin/billing` for charging **standalone customers** (not tied to `businesses`/`users`) on monthly recurring subscriptions via **Cardcom API v11**. Added 2026-06-08.
- **Tables:** `billing_customers` (identity), `billing_subscriptions` (1:1 per customer; `monthly_amount`, `status` pending→active→paused/cancelled/failed, `cardcom_token`, `card_last_four`, `card_expiry`, `next_charge_date`, `day_of_month`, `failed_attempts`), `billing_charges` (per-attempt log). RLS is admin-only (`is_admin()`), separate policy per operation.
- **Flow:** first charge = Cardcom hosted **LowProfile** page (`Operation=ChargeAndCreateToken`) in an iframe → **no card data touches our server (no PCI)**. The webhook re-verifies server-side via `getLpResult` (never trusts the body), is idempotent, and only activates the subscription if a token came back. Recurring charges = daily cron `POST /api/billing/process` (protected by the existing `CRON_SECRET` / `x-cron-secret`, same pattern as `/api/retainers/process`) charging the saved token via `Transactions/Transaction`.
- **Code:** `src/lib/cardcom.ts` (v11 client, env-only creds), `src/lib/billing/dates.ts` (`addOneMonthClamped` with short-month clamp, `isDueOn`), routes under `src/app/api/billing/*`, page `src/app/(dashboard)/admin/billing/page.tsx` + modals in `src/components/dashboard/billing/`. Unit tests via **Vitest** (`npm test`) — the repo's only unit-test runner; added for this module.
- **⚠️ Cardcom field-name caveat:** `GetLpResult` response field names (token / last4 / expiry) and the success code were not fully confirmed from swagger — `normalizeLpResult` extracts defensively. **The card-expiry byte-order is the key risk:** Cardcom's `CardYearMonth` is likely YYMM but the token charge sends `CardExpirationMMYY` — verify against a real first charge (the interactive charge succeeds even if this is wrong; only the recurring charge fails a month later). On a success-without-token the webhook logs the raw response keys via `console.error` and marks the charge failed instead of silently activating.

### Role-Based Access
Roles defined in `src/types/index.ts` as `UserRole`: admin, owner, employee. Stored in `business_members` table. Admin pages under `(dashboard)/admin/`.

### Real-time
Supabase Realtime via `useRealtimeSubscription` and `useMultiTableRealtime` hooks. Can be disabled with `NEXT_PUBLIC_DISABLE_REALTIME=true`.

### PWA / Service Worker
The app is a Progressive Web App with:
- `public/sw.js` — Service worker with cache busting (build timestamp injected by `next.config.ts`)
- Push notifications via `web-push` library and `/api/push/` endpoints
- Install prompt (`InstallPrompt`) and update prompt (`UpdatePrompt`) components
- `public/manifest.json` — PWA manifest

### Docker / Deployment
- `next.config.ts` uses `output: 'standalone'` for Docker builds
- Multi-stage Dockerfile: deps → builder → runner (node:20-alpine)
- Docker exposes port **3001** (to avoid Dokploy conflict)

## RTL & Hebrew Requirements

This is a Hebrew RTL application (`<html lang="he" dir="rtl">`).

### ⚠️ DOM order is REVERSED visually — first child in flex = RIGHT, last child = LEFT

In an RTL flex row: **the first JSX sibling appears on the RIGHT side of the screen.**
This is the opposite of LTR. I (Claude) keep getting this wrong. Internalize it:

- "Put X on the **RIGHT** of Y" → write `<X /><Y />` (X first in JSX)
- "Put X on the **LEFT** of Y" → write `<Y /><X />` (X last in JSX)

Example — to render `[A] [B]` visually with A on the right:
```jsx
<div className="flex gap-2">
  <A />  {/* this appears on the RIGHT */}
  <B />  {/* this appears on the LEFT */}
</div>
```

Before writing positional code, ask yourself: "RIGHT means FIRST in DOM. Did I write it first?"
If you can't visualize it, write the JSX, then mentally label first=right, last=left, and check against the user's request.

### Other RTL rules:
- Use `flex-row-reverse` instead of `justify-end` for icon placement
- Use `text-align: start` not `text-align: left`
- Currency symbol (₪) and percentage (%) must render correctly next to numbers
- Parentheses in mixed RTL/LTR content must render in correct direction
- Fonts: Assistant (Hebrew), Poppins (Latin)

## Key Patterns

- **localStorage:** Never read in `useState()` initial value — always defer to `useEffect`
- **Hydration safety:** No `Math.random()`, `new Date()`, or `window`/`document` in component body or initial state
- **Supabase queries:** Use `.maybeSingle()` by default, only `.single()` when row is guaranteed to exist
- **RLS policies:** Always split into separate SELECT/INSERT/UPDATE/DELETE — never `FOR ALL`
- **Path alias:** `@/*` maps to `src/*`
- **Custom hooks:** `src/hooks/` — `useFormDraft` (form persistence), `usePersistedState` (localStorage wrapper), `usePushSubscription`, `use-mobile` (responsive breakpoint)

## Environment Variables

```env
# Build-time (NEXT_PUBLIC_*)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_DISABLE_REALTIME=false
NEXT_PUBLIC_VAPID_PUBLIC_KEY=

# Runtime only
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=

# Billing / Cardcom (admin סליקה module) — runtime only, never NEXT_PUBLIC
CARDCOM_TERMINAL=
CARDCOM_API_NAME=
CARDCOM_API_PASSWORD=          # currently unused by code (v11 LowProfile/token auth uses TerminalNumber+ApiName)
CARDCOM_BASE_URL=https://secure.cardcom.solutions/api/v11
CRON_SECRET=                   # also protects POST /api/billing/process (shared with retainers cron)
```

## MCP Servers (כלים חיצוניים מחוברים)

לפרויקט זה מחוברים 3 MCP servers + Context7 לדוקומנטציה:

### Context7 — דוקומנטציה עדכנית (חובה!)
**חובה להשתמש ב-Context7 בכל פעם שכותבים או בודקים קוד** כדי לוודא שימוש נכון ב-APIs ודפוסים עדכניים.

```
mcp__plugin_context7_context7__resolve-library-id  → מצא library ID (למשל: "next.js", "supabase-js")
mcp__plugin_context7_context7__query-docs          → שאל שאלה על הספרייה
```

**תהליך עבודה:**
1. לפני כתיבת קוד שמשתמש בספרייה — בדוק את הדוקומנטציה דרך Context7
2. קודם `resolve-library-id` כדי למצוא את ה-ID הנכון
3. אחר כך `query-docs` עם השאלה הספציפית
4. במיוחד חשוב עבור: Supabase, Next.js, React, Tailwind, Radix UI, Recharts, Vercel AI SDK

### Supabase MCP — מסד נתונים ישיר
גישה ישירה ל-Supabase של הפרויקט (PostgreSQL, Auth, Storage):

```
mcp__supabase-selfhosted__list_tables           → רשימת טבלאות
mcp__supabase-selfhosted__execute_sql           → הרצת SQL queries
mcp__supabase-selfhosted__list_auth_users       → רשימת משתמשים
mcp__supabase-selfhosted__apply_migration       → הרצת migration
mcp__supabase-selfhosted__get_project_url       → URL הפרויקט
mcp__supabase-selfhosted__list_extensions       → רשימת extensions
mcp__supabase-selfhosted__generate_typescript_types → יצירת TypeScript types מה-DB
```

**כללי שימוש:**
- לפני שינויי DB — בדוק את המצב הנוכחי עם `list_tables` או `execute_sql`
- השתמש ב-`apply_migration` לשינויי סכמה (לא `execute_sql` ישיר)
- לדיבאג שגיאות Supabase — בדוק את ה-schema בפועל לפני תיקון קוד

### n8n MCP — ניהול workflows
גישה ישירה ל-n8n לניהול אוטומציות:

```
mcp__n8n-mcp__n8n_list_workflows        → רשימת workflows
mcp__n8n-mcp__n8n_get_workflow          → קבלת workflow ספציפי
mcp__n8n-mcp__n8n_create_workflow       → יצירת workflow חדש
mcp__n8n-mcp__n8n_update_full_workflow  → עדכון workflow מלא
mcp__n8n-mcp__n8n_test_workflow         → הרצת workflow
mcp__n8n-mcp__n8n_validate_workflow     → וואלידציה
mcp__n8n-mcp__search_nodes              → חיפוש nodes זמינים
mcp__n8n-mcp__get_node                  → פרטי node ספציפי
```

**כללי שימוש:**
- **חובה** להפעיל את skill `n8n-workflow-patterns` לפני כל עבודה עם n8n
- לא ליצור credentials חדשים — להעתיק מ-nodes קיימים
- להריץ `n8n_validate_workflow` אחרי כל שינוי

### Dokploy MCP — ניהול deployment
גישה ישירה ל-Dokploy לניהול שרתים ו-deployments:

```
mcp__dokploy__project-all               → רשימת פרויקטים
mcp__dokploy__project-one               → פרטי פרויקט
mcp__dokploy__application-one           → פרטי אפליקציה
mcp__dokploy__application-deploy        → deploy אפליקציה
mcp__dokploy__application-redeploy      → redeploy
mcp__dokploy__application-start/stop    → הפעלה/עצירה
mcp__dokploy__application-readAppMonitoring → מוניטורינג
mcp__dokploy__application-saveEnvironment   → עדכון env vars
mcp__dokploy__domain-create/update      → ניהול domains
mcp__dokploy__postgres-*                → ניהול PostgreSQL instances
```

**כללי שימוש:**
- לבדוק סטטוס אפליקציה לפני deploy
- להשתמש ב-`application-readAppMonitoring` לדיבאג בעיות production
- לא לעשות deploy בלי אישור המשתמש

## Code Change Rules

- When asked to hide/remove/change a UI element, apply changes **only** to the specific element — never parent containers or siblings
- Number formatting must be applied to both display values and input fields
- Do not change styles, templates, or unrelated code unless explicitly requested
- After making changes, run `git status` to ensure new files are tracked before pushing
