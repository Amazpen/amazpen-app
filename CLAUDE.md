# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Amazpen (המצפן) is a Hebrew RTL business management SaaS application for tracking financial metrics, expenses, goals, suppliers, and AI-powered insights. Built for restaurant/business operations.

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
- `src/app/api/` — API routes (ai, upload, push notifications, admin, health)

### Supabase Clients
- **Browser:** `src/lib/supabase/client.ts` — singleton via `createBrowserClient()`
- **Server:** `src/lib/supabase/server.ts` — per-request via `createServerClient()` with cookie handling
- **Middleware:** `middleware.ts` — auth check on every request, redirects unauthenticated users to `/login`

### AI Chat System (`/api/ai/chat`)
- Rate limited (20 req/min per user)
- Streaming via `UIMessageStreamResponse`
- Tool calls: `getMonthlySummary`, `queryDatabase` (read-only SQL), `getBusinessSchedule`, `getGoals`, `calculate`, `proposeAction`
- Conversations persisted in `ai_chat_sessions` / `ai_chat_messages` tables

### Role-Based Access
Roles stored in `business_members` table: admin, owner, manager, employee. Admin pages under `(dashboard)/admin/`.

### Real-time
Supabase Realtime via `useRealtimeSubscription` hook. Can be disabled with `NEXT_PUBLIC_DISABLE_REALTIME=true`.

## RTL & Hebrew Requirements

This is a Hebrew RTL application (`<html lang="he" dir="rtl">`):
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
