# סטנדרטים ודפוסי קוד - המצפן (Amazpen)

## סקירה כללית

מסמך זה מגדיר את סטנדרטי הקוד, דפוסי העבודה והכללים המחייבים בפרויקט המצפן.
כל מפתח חייב לעקוב אחרי הכללים המתוארים כאן כדי לשמור על עקביות ואיכות.

> ראה גם: [ארכיטקטורת מערכת](./system-architecture.md) | [סכמת מסד נתונים](./database-schema.md)

---

## תוכן עניינים

1. [ארגון קבצים](#ארגון-קבצים)
2. [דפוסי קומפוננטות](#דפוסי-קומפוננטות)
3. [RTL ולוקליזציה](#rtl-ולוקליזציה)
4. [ניהול State](#ניהול-state)
5. [דפוסי Supabase](#דפוסי-supabase)
6. [דפוסי API](#דפוסי-api)
7. [TypeScript](#typescript)
8. [עיצוב ו-UI](#עיצוב-ו-ui)
9. [Git Workflow](#git-workflow)
10. [ביצועים](#ביצועים)
11. [אבטחה](#אבטחה)

---

## ארגון קבצים

### מבנה ספריות

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/             # דפי אימות ציבוריים
│   ├── (dashboard)/        # דפים מוגנים
│   └── api/                # API Routes
├── components/
│   ├── ui/                 # shadcn/ui primitives + רכיבי מערכת
│   ├── dashboard/          # ווידג'טים ומודלים עסקיים
│   ├── ai/                 # ממשק צ'אט AI
│   ├── ocr/                # סריקת מסמכים
│   └── onboarding/         # סיורי הדרכה
├── hooks/                  # Custom React hooks
├── lib/                    # Utilities, Supabase clients
└── types/                  # TypeScript type definitions
```

### Path Alias

`@/*` ממופה ל-`src/*`. תמיד להשתמש ב-alias:

```typescript
// נכון
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'

// לא נכון
import { Button } from '../../../components/ui/button'
```

### כללי מיקום קבצים

| סוג קובץ | מיקום | דוגמה |
|-----------|-------|--------|
| רכיבי UI בסיסיים | `components/ui/` | `button.tsx`, `dialog.tsx` |
| רכיבי Dashboard | `components/dashboard/` | `revenue-chart.tsx` |
| Hooks מותאמים | `hooks/` | `useFormDraft.ts` |
| סוגי TypeScript | `types/` | `index.ts`, `ocr.ts` |
| Supabase clients | `lib/supabase/` | `client.ts`, `server.ts` |
| Utilities | `lib/` | `pdfToImage.ts`, `apiAuth.ts` |

---

## דפוסי קומפוננטות

### Client vs Server Components

**כמעט כל הדפים הם Client Components** בגלל שימוש ב-Realtime ואינטראקטיביות:

```typescript
'use client'  // בראש כל דף dashboard

import { useState, useEffect } from 'react'
import { useDashboard } from '@/app/(dashboard)/layout'
```

**Root Layout הוא Server Component** ומספק:
- HTML structure (`lang="he"`, `dir="rtl"`)
- פונטים (Assistant, Poppins)
- Theme (dark mode forced)

### shadcn/ui

האפליקציה משתמשת ב-shadcn/ui בסגנון **new-york** עם Radix UI primitives.

**כללים:**
- להשתמש ברכיבי shadcn/ui הקיימים לפני יצירת רכיבים חדשים
- לא לשנות את הרכיבים ב-`components/ui/` אלא אם נדרש במפורש
- אייקונים: Lucide Icons בלבד

### כללי שינוי קוד

> **חוק ברזל:** כשמתבקשים להסתיר, להסיר, או לשנות אלמנט UI - לבצע שינויים **רק** באלמנט הספציפי.
> לעולם לא להסיר/להסתיר containers אבות, אלמנטים אחים, או חלקים רחבים יותר.
> אם ההיקף לא ברור - לשאול לפני עריכה.

**עיצוב מספרים:** כשמוסיפים פורמט מספרים, ליישם **גם** על ערכי תצוגה **וגם** על שדות קלט.

---

## RTL ולוקליזציה

### כללי RTL (חובה!)

האפליקציה עובדת בעברית עם `dir="rtl"`. כל שינוי UI חייב להתחשב בכיוון.

#### מיקום אלמנטים

```typescript
// נכון - RTL aware
<div className="flex flex-row-reverse gap-2">
  <Icon />
  <span>טקסט</span>
</div>

// לא נכון
<div className="flex justify-end gap-2">
  <Icon />
  <span>טקסט</span>
</div>
```

#### יישור טקסט

```css
/* נכון */
text-align: start;

/* לא נכון */
text-align: left;
```

#### מטבע ואחוזים

```typescript
// סימן מטבע (₪) חייב להיות ליד המספר
<span>₪{amount.toLocaleString()}</span>

// אחוזים
<span>{percentage}%</span>
```

#### סוגריים בתוכן מעורב

כשיש מספרים בתוך טקסט עברי, סוגריים חייבים להופיע בכיוון הנכון:
```typescript
// שימוש ב-LTR mark כשצריך
<span>הכנסות ({'\u200E'}₪50,000{'\u200E'})</span>
```

#### פונטים

| פונט | שימוש |
|------|-------|
| Assistant | טקסט עברי |
| Poppins | טקסט לטיני ומספרים |

#### גישה לפני קוד

> **חשוב:** לפני כתיבת CSS/layout עבור מיקום RTL, **להציע את הגישה קודם**.
> לא לנסות trial-and-error עם ניסיונות CSS מרובים.

---

## ניהול State

### כללי Hydration (קריטי!)

#### localStorage

```typescript
// לא נכון - יגרום לשגיאת hydration
const [value, setValue] = useState(localStorage.getItem('key'))

// נכון - תמיד ב-useEffect
const [value, setValue] = useState<string | null>(null)
useEffect(() => {
  setValue(localStorage.getItem('key'))
}, [])

// או להשתמש ב-hook מוכן
import { usePersistedState } from '@/hooks/usePersistedState'
const [value, setValue] = usePersistedState('key', defaultValue)
```

#### ערכים אקראיים ותאריכים

```typescript
// לא נכון - hydration mismatch
const [id] = useState(Math.random())
const [now] = useState(new Date())

// נכון - רק ב-useEffect
const [id, setId] = useState('')
useEffect(() => {
  setId(crypto.randomUUID())
}, [])
```

#### גישה ל-window/document

```typescript
// לא נכון
const width = window.innerWidth

// נכון - option 1: useEffect
useEffect(() => {
  const width = window.innerWidth
  // ...
}, [])

// נכון - option 2: guard
if (typeof window !== 'undefined') {
  const width = window.innerWidth
}
```

### שמירת טפסים

להשתמש ב-`useFormDraft` לשמירת טיוטות בטפסים ארוכים:

```typescript
import { useFormDraft } from '@/hooks/useFormDraft'

const { draft, saveDraft, clearDraft } = useFormDraft('expense-form')
```

Hook זה שומר ב-IndexedDB ומאפשר שחזור אחרי רענון דף.

---

## דפוסי Supabase

### שאילתות

```typescript
// ברירת מחדל - maybeSingle (מחזיר null אם אין תוצאה)
const { data } = await supabase
  .from('suppliers')
  .select('*')
  .eq('id', supplierId)
  .maybeSingle()

// רק כשהשורה מובטחת קיימת
const { data } = await supabase
  .from('users')
  .select('*')
  .eq('auth_id', user.id)
  .single()
```

### RLS Policies

```sql
-- נכון: מדיניות נפרדת לכל פעולה
CREATE POLICY "users_select" ON users FOR SELECT
  USING (auth.uid() = auth_id);

CREATE POLICY "users_update" ON users FOR UPDATE
  USING (auth.uid() = auth_id);

-- לא נכון: לעולם לא FOR ALL
CREATE POLICY "users_all" ON users FOR ALL  -- אסור!
  USING (auth.uid() = auth_id);
```

### פונקציות SQL

```sql
-- נכון: schema reference מפורש
CREATE FUNCTION public.my_function()
RETURNS void AS $$
  SELECT * FROM public.my_table;
$$ LANGUAGE sql SECURITY DEFINER
SET search_path = '';  -- immutable search_path

-- לא נכון: search_path mutable
CREATE FUNCTION my_function()
SET search_path = public;  -- אסור!
```

### בדיקת Schema לפני שינויים

> לפני הצעת שינויי DB, תמיד לבדוק את מצב ה-schema הנוכחי באמצעות
> Supabase MCP (`list_tables`, `execute_sql`).

---

## דפוסי API

### API Routes - מבנה בסיסי

```typescript
// src/app/api/example/route.ts
import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createServerClient()

  // בדיקת auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // לוגיקה...
  return NextResponse.json({ success: true })
}
```

### אימות Intake Webhooks

```typescript
// endpoints חיצוניים משתמשים ב-API Key
import { validateApiKey } from '@/lib/apiAuth'

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key')
  if (!validateApiKey(apiKey)) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 403 })
  }
  // ...
}
```

### Rate Limiting

```typescript
// AI endpoints מוגבלים ל-20 בקשות לדקה למשתמש
// המימוש נמצא ב-/api/ai/chat
```

### Streaming

```typescript
// תגובות AI משתמשות ב-UIMessageStreamResponse
import { UIMessageStreamResponse } from 'ai'

return new UIMessageStreamResponse(/* stream */)
```

### פעולות Admin

```typescript
// שימוש ב-Service Role Client (עוקף RLS)
import { createServiceRoleClient } from '@/lib/supabase/server'

const adminClient = createServiceRoleClient()
```

---

## TypeScript

### Strict Mode

הפרויקט רץ עם `strict: true`. חובה:
- טיפוס מפורש לכל props ופרמטרים
- בדיקת null/undefined
- לא להשתמש ב-`any` (להשתמש ב-`unknown` ולבדוק)

### קבצי טיפוסים

| קובץ | תוכן |
|------|-------|
| `types/index.ts` | User, Business, Supplier, Expense, Payment, Goal, UserBusiness, BusinessSchedule |
| `types/ai.ts` | טיפוסי AI Chat |
| `types/ocr.ts` | טיפוסי OCR |
| `types/price-tracking.ts` | טיפוסי מעקב מחירים |

### מוסכמות

```typescript
// טיפוסי Props
interface ExpenseFormProps {
  supplierId: string
  onSave: (expense: Expense) => void
  initialData?: Partial<Expense>
}

// טיפוסי API Response
interface ApiResponse<T> {
  data: T | null
  error: string | null
}
```

---

## עיצוב ו-UI

### Dark Theme

האפליקציה כופה dark theme גלובלית. כל רכיב חייב לתמוך ב-dark mode.

### Tailwind CSS 4

שימוש ב-Tailwind CSS 4 עם utility-first approach:

```typescript
// צבעי רקע
<div className="bg-[#1a1a2e]">        // רקע ראשי
<div className="bg-[#16213e]">        // רקע משני
<div className="bg-[#29318A]">        // header טבלה

// גבולות
<div className="border-white/25">      // גבול רגיל
<div className="border-white">         // גבול פעיל (selected)
```

### דפוס טבלה (חובה!)

> **חוק ברזל:** אסור להשתמש ב-`<table>`, `sticky thead`, `grid` נפרד ל-header ול-rows, או `pe` לפיצוי scrollbar.

```typescript
<div className="w-full flex flex-col">
  {/* Header */}
  <div className="grid grid-cols-[2fr_1fr_1fr_1fr] bg-[#29318A] rounded-t-[7px] p-[10px_5px] pe-[13px] items-center">
    <span>שם</span>
    <span>סכום</span>
    <span>תאריך</span>
    <span>סטטוס</span>
  </div>

  {/* Rows */}
  <div className="max-h-[450px] overflow-y-auto flex flex-col gap-[5px]">
    {rows.map(row => (
      <div key={row.id} className="grid grid-cols-[2fr_1fr_1fr_1fr] w-full p-[5px_5px]">
        <span>{row.name}</span>
        <span>₪{row.amount}</span>
        <span>{row.date}</span>
        <span>{row.status}</span>
      </div>
    ))}
  </div>
</div>
```

**כללים:**
- Header עם `pe-[13px]` לפיצוי scrollbar
- אותו `grid-cols` בדיוק ב-header וב-rows
- יחידות `fr` (לא `px`) לחלוקה פרופורציונלית

### Recharts

גרפים נטענים ב-lazy loading:

```typescript
import dynamic from 'next/dynamic'

const RevenueChart = dynamic(
  () => import('@/components/dashboard/revenue-chart'),
  { ssr: false }
)
```

---

## Git Workflow

### לפני Push

```bash
# תמיד לבדוק שאין קבצים שלא מעוקבים
git status

# קבצים חדשים (hooks, utils, components) חייבים להיות tracked
# אחרת build ב-Docker ייכשל
```

### Conventional Commits

```
feat(scope): תיאור תכונה חדשה
fix(scope): תיאור תיקון באג
docs: עדכון תיעוד
refactor(scope): שיפור קוד ללא שינוי התנהגות
chore: משימות תחזוקה
```

### דוגמאות

```bash
git commit -m "feat(ocr): add manual line item add/remove in OCR form"
git commit -m "fix: prevent day_factor > 1 in daily entries"
git commit -m "feat(expenses): global search across tabs and date ranges"
```

### קבצים רגישים

לעולם לא לעשות commit ל:
- `.env` / `.env.local`
- `credentials.json`
- מפתחות API / Service Role keys

---

## ביצועים

### טעינה עצלה (Lazy Loading)

```typescript
// גרפים - תמיד lazy
const Chart = dynamic(() => import('./chart'), { ssr: false })

// PDF viewer - lazy
const PDFViewer = dynamic(() => import('./pdf-viewer'), { ssr: false })
```

### Supabase Realtime

ניתן לכבות Realtime עם:
```env
NEXT_PUBLIC_DISABLE_REALTIME=true
```

שימושי לפיתוח מקומי או דיבאג.

### Docker Build

```
output: 'standalone'  // ב-next.config.ts
```

מייצר build אופטימלי ל-Docker ללא תלויות מיותרות.

---

## אבטחה

### אימות בקשות

| נתיב | שיטת אימות |
|------|------------|
| דפי Dashboard | Middleware + Supabase Session |
| API Routes | Supabase `getUser()` |
| Intake Webhooks | API Key (`x-api-key` header) |
| Admin Operations | Role check (`isAdmin`) |

### RLS (Row Level Security)

- **תמיד מופעל** על כל הטבלאות
- מדיניויות נפרדות לכל פעולה (SELECT/INSERT/UPDATE/DELETE)
- JWT Token מועבר אוטומטית לכל שאילתה
- Admin operations דרך Service Role Client (עוקף RLS)

### הזרקת SQL

```typescript
// AI tool - queryDatabase - מוגבל לקריאה בלבד
// SELECT queries only, no INSERT/UPDATE/DELETE
```

### CORS ו-Headers

Middleware מגן על כל הנתיבים מלבד:
- `/api/*` (API routes)
- `/_next/*` (Next.js static)
- קבצים סטטיים (favicon, manifest, sw.js)

---

## סיכום כללים קריטיים

| כלל | פירוט |
|-----|--------|
| localStorage | **לעולם** לא ב-useState, תמיד ב-useEffect |
| Hydration | אין Math.random(), new Date(), window ב-body |
| Supabase | `.maybeSingle()` כברירת מחדל |
| RLS | מדיניות נפרדת, לעולם לא FOR ALL |
| RTL | `flex-row-reverse`, `text-align: start` |
| שינויי UI | רק האלמנט הספציפי, לא containers |
| מספרים | פורמט גם בתצוגה וגם בקלט |
| Git | `git status` לפני push |
| טבלאות | Grid pattern, לא `<table>` |
| Schema | לבדוק מצב נוכחי לפני שינויים |
