# המצפן (Amazpen) — סיכום קוד מקור ומלאי קבצים

## תוכן עניינים

1. [מבנה תיקיות כללי](#מבנה-תיקיות-כללי)
2. [דפי אפליקציה — App Router](#דפי-אפליקציה--app-router)
3. [נקודות קצה — API Routes](#נקודות-קצה--api-routes)
4. [רכיבי UI — Components](#רכיבי-ui--components)
5. [Hooks מותאמים אישית](#hooks-מותאמים-אישית)
6. [ספריות ועזרים — Lib](#ספריות-ועזרים--lib)
7. [טיפוסי נתונים — Types](#טיפוסי-נתונים--types)
8. [קבצי שורש ותצורה](#קבצי-שורש-ותצורה)
9. [קבצים ציבוריים — Public](#קבצים-ציבוריים--public)
10. [סקריפטים](#סקריפטים)
11. [תלויות — Dependencies](#תלויות--dependencies)
12. [תלויות פיתוח — Dev Dependencies](#תלויות-פיתוח--dev-dependencies)
13. [הפניות למסמכים נוספים](#הפניות-למסמכים-נוספים)

---

## מבנה תיקיות כללי

```
amazpen-new/
├── docs/                          # תיעוד פרויקט
│   ├── database-schema.md
│   ├── dadi-agent-instructions.md
│   ├── project-overview-pdr.md
│   ├── codebase-summary.md
│   └── plans/
├── public/                        # קבצים ציבוריים (PWA, אייקונים)
│   ├── sw.js                      # Service Worker
│   ├── manifest.json              # PWA manifest
│   └── icons/                     # אייקוני PWA
├── scripts/                       # סקריפטי עזר
│   ├── migrate-attachments.mjs
│   └── restore-google-drive-links.mjs
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── (auth)/                # דפים ציבוריים — אימות
│   │   ├── (dashboard)/           # דפים מוגנים — עסקיים
│   │   └── api/                   # נקודות קצה API
│   ├── components/                # רכיבי React
│   │   ├── ui/                    # רכיבי shadcn/Radix
│   │   ├── ai/                    # רכיבי צ'אט AI
│   │   ├── dashboard/             # רכיבי דשבורד
│   │   ├── ocr/                   # רכיבי סריקת מסמכים
│   │   └── onboarding/            # סיורים מודרכים
│   ├── hooks/                     # hooks מותאמים
│   ├── lib/                       # ספריות ועזרים
│   └── types/                     # הגדרות טיפוסים
├── middleware.ts                   # Middleware — אימות בכל בקשה
├── next.config.ts                 # תצורת Next.js
├── package.json                   # תלויות וסקריפטים
├── tsconfig.json                  # תצורת TypeScript
├── tailwind.config.ts             # תצורת Tailwind CSS
├── postcss.config.mjs             # תצורת PostCSS
├── Dockerfile                     # בנייה multi-stage
├── docker-compose.yml             # הרצה ב-Docker
└── CLAUDE.md                      # הנחיות ל-Claude Code
```

---

## דפי אפליקציה — App Router

### קבוצת אימות — `src/app/(auth)/`

דפים ציבוריים שאינם דורשים אימות:

| קובץ | תיאור |
|-------|--------|
| `login/page.tsx` | דף כניסה — email/password + Google OAuth |
| `forgot-password/page.tsx` | שחזור סיסמה |
| `logout/page.tsx` | יציאה מהמערכת |

### קבוצת דשבורד — `src/app/(dashboard)/`

דפים מוגנים — דורשים אימות. כל הדפים עטופים ב-`DashboardContext`.

| נתיב | קובץ | תיאור |
|-------|-------|--------|
| `/` | `page.tsx` | דשבורד ראשי — סיכום פיננסי, גרפים, KPIs |
| — | `layout.tsx` | Layout ראשי — מגדיר `DashboardContext`, sidebar, nav |
| `/expenses` | `expenses/page.tsx` | ניהול הוצאות וחשבוניות — טבלאות, סינון, חיפוש |
| `/payments` | `payments/page.tsx` | ניהול תשלומים לספקים |
| `/suppliers` | `suppliers/page.tsx` | ניהול ספקים — פרטים, יתרות, היסטוריה |
| `/goals` | `goals/page.tsx` | יעדים — הגדרה ומעקב התקדמות |
| `/cashflow` | `cashflow/page.tsx` | תזרים מזומנים — תחזיות, הוצאות חוזרות |
| `/price-tracking` | `price-tracking/page.tsx` | מעקב מחירים — השוואת ספקים |
| `/customers` | `customers/page.tsx` | ניהול לקוחות |
| `/ai` | `ai/page.tsx` | צ'אט AI — שיחה חכמה עם נתוני עסק |
| `/ocr` | `ocr/page.tsx` | סריקת מסמכים — תור מסמכים, OCR |
| `/reports` | `reports/page.tsx` | דוחות — ניתוח וייצוא |
| `/insights` | `insights/page.tsx` | תובנות — ניתוח חכם |
| `/settings` | `settings/page.tsx` | הגדרות — פרופיל עסק, לוח זמנים |

### דפי ניהול — `src/app/(dashboard)/admin/`

דפים מוגנים לאדמינים בלבד (15 תתי-דפים):

| נתיב | תיאור |
|-------|--------|
| `accounting-review/` | סקירת הנהלת חשבונות |
| `bonus-plans/` | תוכניות בונוס |
| `business/` | ניהול עסקים |
| `commitments/` | התחייבויות |
| `daily-entries/` | מילויים יומיים |
| `day-exceptions/` | חריגי ימים |
| `expenses/` | ניהול הוצאות (admin) |
| `goals/` | ניהול יעדים |
| `goals-import/` | ייבוא יעדים |
| `historical-data/` | ייבוא נתונים היסטוריים |
| `online-users/` | משתמשים מחוברים |
| `payments/` | ניהול תשלומים (admin) |
| `supplier-budgets/` | תקציבי ספקים |
| `suppliers/` | ניהול ספקים (admin) |
| `users/` | ניהול משתמשים |

---

## נקודות קצה — API Routes

`src/app/api/` — 19 תיקיות עם נקודות קצה:

| נתיב | תיאור | שיטות |
|-------|--------|--------|
| `admin/` | פעולות ניהול — CRUD לכל הישויות | GET, POST, PUT, DELETE |
| `ai/chat/` | צ'אט AI — streaming, tool calling | POST |
| `ai/ocr/` | עיבוד OCR — OpenAI Vision | POST |
| `approvals/` | תהליך אישורים | GET, POST, PUT |
| `bonus-push/` | התראות Push לבונוסים | POST |
| `budget-alert/` | התראות חריגת תקציב | POST |
| `daily-push/` | התראות יומיות | POST |
| `health/` | בדיקת בריאות שרת | GET |
| `intake/` | ערוצי קליטה | GET, POST |
| `metrics/` | מדדים ונתונים סטטיסטיים | GET |
| `missing-invoices/` | זיהוי חשבוניות חסרות | GET |
| `push/` | ניהול מנויי Push | POST, DELETE |
| `recurring-expenses/` | הוצאות חוזרות | GET, POST |
| `reminders/` | תזכורות | POST |
| `retainers/` | ריטיינרים / מקדמות | GET, POST |
| `suppliers/` | API ספקים | GET |
| `surveys/` | סקרים | GET, POST |
| `upcoming-payments/` | תשלומים קרובים | GET |
| `upload/` | העלאת קבצים — Supabase Storage | POST |
| `weekly-summary/` | סיכום שבועי | GET |

---

## רכיבי UI — Components

### רכיבי shadcn/Radix — `src/components/ui/` (31 רכיבים)

רכיבי בסיס מ-shadcn/ui בהתאמה ל-RTL ו-dark theme:

| רכיב | קובץ | תיאור |
|-------|-------|--------|
| AlertDialog | `alert-dialog.tsx` | דיאלוג אזהרה עם אישור/ביטול |
| Badge | `badge.tsx` | תגית צבעונית |
| BarVisualizer | `bar-visualizer.tsx` | ויזואליזציית בר |
| Button | `button.tsx` | כפתור עם וריאנטים (default, outline, ghost, etc.) |
| Calendar | `calendar.tsx` | לוח שנה — בחירת תאריכים |
| Checkbox | `checkbox.tsx` | תיבת סימון |
| ConfirmDialog | `confirm-dialog.tsx` | דיאלוג אישור מותאם |
| DatePickerField | `date-picker-field.tsx` | שדה בחירת תאריך |
| DateRangePicker | `date-range-picker.tsx` | בחירת טווח תאריכים |
| Dialog | `dialog.tsx` | דיאלוג/מודאל |
| DropdownMenu | `dropdown-menu.tsx` | תפריט נפתח |
| Input | `input.tsx` | שדה קלט טקסט |
| InstallPrompt | `install-prompt.tsx` | הנחיית התקנת PWA |
| Label | `label.tsx` | תווית לשדה טופס |
| NumberInput | `number-input.tsx` | שדה קלט מספרי |
| OfflineIndicator | `offline-indicator.tsx` | חיווי מצב אופליין |
| Popover | `popover.tsx` | חלון צף |
| PushPrompt | `push-prompt.tsx` | הנחיית הפעלת Push |
| Select | `select.tsx` | שדה בחירה מרשימה |
| Separator | `separator.tsx` | קו מפריד |
| Sheet | `sheet.tsx` | פאנל צדדי (side sheet) |
| Sidebar | `sidebar.tsx` | סרגל ניווט צדדי |
| Skeleton | `skeleton.tsx` | שלד טעינה (loading skeleton) |
| SortableList | `sortable-list.tsx` | רשימה ניתנת לגרירה (@dnd-kit) |
| SupplierSearchSelect | `SupplierSearchSelect.tsx` | בחירת ספק עם חיפוש |
| Table | `table.tsx` | רכיב טבלה |
| Tabs | `tabs.tsx` | טאבים |
| Textarea | `textarea.tsx` | שדה קלט טקסט רב-שורתי |
| Toast | `toast.tsx` | הודעת toast (snackbar) |
| Tooltip | `tooltip.tsx` | תיאור קופץ (tooltip) |
| UpdatePrompt | `update-prompt.tsx` | הנחיית עדכון גרסה |

### רכיבי AI — `src/components/ai/` (10 רכיבים)

| רכיב | קובץ | תיאור |
|-------|-------|--------|
| AiActionCard | `AiActionCard.tsx` | כרטיס פעולה מוצעת — אישור/דחייה |
| AiChatContainer | `AiChatContainer.tsx` | מכולת צ'אט ראשית |
| AiChatInput | `AiChatInput.tsx` | שדה קלט הודעות עם כפתור שליחה |
| AiDataTable | `AiDataTable.tsx` | טבלת נתונים מוצגת בתוך הצ'אט |
| AiMarkdownRenderer | `AiMarkdownRenderer.tsx` | מעבד Markdown — react-markdown + remark-gfm |
| AiMessageBubble | `AiMessageBubble.tsx` | בועת הודעה — משתמש/AI |
| AiMessageList | `AiMessageList.tsx` | רשימת הודעות עם גלילה אוטומטית |
| AiToolSteps | `AiToolSteps.tsx` | הצגת צעדי ביצוע כלי AI |
| AiWelcomeScreen | `AiWelcomeScreen.tsx` | מסך פתיחה עם הצעות שיחה |
| useAiChat | `useAiChat.ts` | Hook לניהול מצב צ'אט — שליחה, streaming, היסטוריה |

### רכיבי דשבורד — `src/components/dashboard/` (6 רכיבים)

| רכיב | קובץ | תיאור |
|-------|-------|--------|
| ApprovalModal | `ApprovalModal.tsx` | מודאל אישור פעולה |
| ConsolidatedInvoiceModal | `ConsolidatedInvoiceModal.tsx` | מודאל חשבונית מאוחדת |
| DailyEntriesModal | `DailyEntriesModal.tsx` | מודאל הזנת מילויים יומיים |
| DailyEntryForm | `DailyEntryForm.tsx` | טופס מילוי יומי |
| HistoryModal | `HistoryModal.tsx` | מודאל היסטוריה |
| IncomeSourceSettlementEditor | `IncomeSourceSettlementEditor.tsx` | עורך התנחלויות מקורות הכנסה |
| PaymentMethodSettlementEditor | `PaymentMethodSettlementEditor.tsx` | עורך התנחלויות אמצעי תשלום |

### רכיבי OCR — `src/components/ocr/` (3 רכיבים)

| רכיב | קובץ | תיאור |
|-------|-------|--------|
| DocumentQueue | `DocumentQueue.tsx` | תור מסמכים — ממתין, מעובד, מאושר, נדחה |
| DocumentViewer | `DocumentViewer.tsx` | צפייה במסמך — תמונה ו-PDF |
| OCRForm | `OCRForm.tsx` | טופס עריכת נתוני OCR — פריטים, הנחות, ספק |

### רכיבי Onboarding — `src/components/onboarding/` (3+ רכיבים)

| רכיב | קובץ | תיאור |
|-------|-------|--------|
| HelpButton | `HelpButton.tsx` | כפתור עזרה |
| OnboardingCard | `OnboardingCard.tsx` | כרטיס הדרכה |
| OnboardingProvider | `OnboardingProvider.tsx` | ספק הקשר לסיורים מודרכים |
| tours/ | `tours/` | הגדרות סיורים מודרכים (nextstepjs) |

---

## Hooks מותאמים אישית

`src/hooks/` — 10 hooks מותאמים:

| Hook | קובץ | תיאור |
|------|-------|--------|
| useApprovals | `useApprovals.ts` | ניהול תהליך אישורים — קבלה, דחייה, סטטוס |
| useFormDraft | `useFormDraft.ts` | שמירת טיוטת טופס אוטומטית ב-localStorage |
| useIsMobile | `use-mobile.ts` | זיהוי מכשיר נייד — responsive breakpoint |
| useOfflineSync | `useOfflineSync.ts` | סנכרון נתונים אופליין — IndexedDB ↔ Supabase |
| useOnboarding | `useOnboarding.ts` | ניהול סיורים מודרכים — התקדמות, הפעלה |
| usePersistedState | `usePersistedState.ts` | state מתמיד ב-localStorage — עוטף useState |
| usePresence | `usePresence.ts` | נוכחות בזמן אמת — Supabase Realtime presence |
| usePushSubscription | `usePushSubscription.ts` | ניהול מנוי להתראות Push — הרשמה, ביטול |
| useRealtimeSubscription | `useRealtimeSubscription.ts` | מנוי ל-Supabase Realtime — שינויים בטבלאות |
| useWakeLock | `useWakeLock.ts` | שמירה על מסך דלוק — Screen Wake Lock API |

---

## ספריות ועזרים — Lib

`src/lib/` — ספריות עזר ותשתית:

| קובץ/תיקייה | תיאור |
|-------------|--------|
| `supabase/client.ts` | לקוח Supabase לדפדפן — singleton, `createBrowserClient()` |
| `supabase/server.ts` | לקוח Supabase לשרת — per-request, `createServerClient()` עם cookies |
| `apiAuth.ts` | אימות API routes — בדיקת session ותפקיד |
| `bonusPlanResolver.ts` | חישוב ופתרון תוכניות בונוס |
| `cashflow/` | ספריית תזרים מזומנים — תחזיות, חישובים |
| `metric-icons.tsx` | אייקונים למדדים עסקיים |
| `ocr.ts` | לוגיקת OCR — עיבוד תוצאות Vision API |
| `offlineStore.ts` | ניהול אחסון אופליין — IndexedDB (idb-keyval) |
| `pdfToImage.ts` | המרת PDF לתמונות — pdfjs-dist |
| `priceTracking.ts` | לוגיקת מעקב מחירים — השוואות, מגמות |
| `uploadFile.ts` | העלאת קבצים ל-Supabase Storage |
| `utils.ts` | עזרים כלליים — cn(), פורמטים, חישובים |

---

## טיפוסי נתונים — Types

`src/types/` — הגדרות TypeScript (strict mode):

| קובץ | תיאור | טיפוסים מרכזיים |
|-------|--------|----------------|
| `index.ts` | טיפוסים ראשיים | `User`, `Business`, `BusinessSchedule`, `UserBusiness`, `Supplier`, `Expense`, `Payment`, `Goal`, `UserRole` (admin/owner/employee) |
| `ai.ts` | טיפוסי מערכת AI | הגדרות tool calls, הודעות, sessions |
| `ocr.ts` | טיפוסי מערכת OCR | מסמכים, פריטים, סטטוסים |
| `bonus.ts` | טיפוסי תוכניות בונוס | תוכנית, כללים, חישובים |
| `approvals.ts` | טיפוסי אישורים | בקשה, סטטוס, תגובה |
| `price-tracking.ts` | טיפוסי מעקב מחירים | מוצר, מחיר, השוואה |
| `pdfjs.d.ts` | הצהרת טיפוסים ל-pdfjs-dist | |

---

## קבצי שורש ותצורה

| קובץ | תיאור |
|-------|--------|
| `middleware.ts` | Middleware — בדיקת אימות בכל בקשה, ניתוב ל-`/login`, החרגת API routes |
| `next.config.ts` | תצורת Next.js — `output: 'standalone'`, הזרקת build timestamp ל-SW |
| `package.json` | תלויות, סקריפטים, metadata |
| `tsconfig.json` | תצורת TypeScript — strict, path alias `@/*` → `src/*` |
| `tailwind.config.ts` | תצורת Tailwind CSS 4 — צבעים, גופנים, RTL |
| `postcss.config.mjs` | תצורת PostCSS — Tailwind plugin |
| `Dockerfile` | בנייה multi-stage — deps → builder → runner (node:20-alpine) |
| `docker-compose.yml` | הרצת Docker — פורט 3001 |
| `eslint.config.mjs` | תצורת ESLint |
| `.env.local` | משתני סביבה מקומיים (לא ב-Git) |
| `CLAUDE.md` | הנחיות ל-Claude Code — דפוסים, כללים, MCP servers |

---

## קבצים ציבוריים — Public

`public/` — קבצים סטטיים:

| קובץ/תיקייה | תיאור |
|-------------|--------|
| `sw.js` | Service Worker — ניהול cache, push notifications, build timestamp |
| `manifest.json` | PWA manifest — שם, אייקונים, צבעים, display mode |
| `icons/` | אייקוני PWA בגדלים שונים |
| `favicon.ico` | אייקון האתר |

---

## סקריפטים

`scripts/` — סקריפטי עזר חד-פעמיים:

| קובץ | תיאור |
|-------|--------|
| `migrate-attachments.mjs` | מיגרציית קבצים מצורפים (Bubble → Supabase) |
| `restore-google-drive-links.mjs` | שחזור קישורי Google Drive |

---

## תלויות — Dependencies

### ליבה — Framework & Runtime

| חבילה | גרסה | תיאור |
|--------|--------|--------|
| `next` | 16.1.6 | Next.js — App Router, Server Components, Turbopack |
| `react` | 19.2.3 | React — ספריית UI |
| `react-dom` | 19.2.3 | React DOM — rendering לדפדפן |

### מסד נתונים ואימות — Supabase

| חבילה | גרסה | תיאור |
|--------|--------|--------|
| `@supabase/supabase-js` | ^2.93.3 | לקוח Supabase — DB, Auth, Realtime, Storage |
| `@supabase/ssr` | ^0.8.0 | SSR adapter — cookies, per-request clients |

### בינה מלאכותית — AI

| חבילה | גרסה | תיאור |
|--------|--------|--------|
| `ai` | ^6.0.86 | Vercel AI SDK — streaming, tool calling, UIMessage |
| `@ai-sdk/openai` | ^3.0.29 | OpenAI provider — GPT-4.1-mini |
| `@ai-sdk/react` | ^3.0.88 | React hooks — useChat |
| `openai` | ^6.18.0 | OpenAI SDK — Vision API ל-OCR |

### UI רכיבים — Radix / shadcn

| חבילה | גרסה | תיאור |
|--------|--------|--------|
| `radix-ui` | ^1.4.3 | Radix UI — רכיבי בסיס נגישים |
| `@radix-ui/react-dialog` | ^1.1.15 | דיאלוג/מודאל |
| `@radix-ui/react-dropdown-menu` | ^2.1.16 | תפריט נפתח |
| `@radix-ui/react-label` | ^2.1.8 | תווית טופס |
| `@radix-ui/react-separator` | ^1.1.8 | קו מפריד |
| `@radix-ui/react-slot` | ^1.2.4 | Slot — composition pattern |
| `@radix-ui/react-tooltip` | ^1.2.8 | Tooltip |
| `class-variance-authority` | ^0.7.1 | CVA — ניהול variants של רכיבים |
| `clsx` | ^2.1.1 | שרשור className מותנה |
| `tailwind-merge` | ^3.4.0 | מיזוג classes של Tailwind |
| `lucide-react` | ^0.563.0 | אייקונים — SVG icons |
| `@phosphor-icons/react` | ^2.1.10 | Phosphor icons — אייקונים נוספים |

### גרפים וויזואליזציה

| חבילה | גרסה | תיאור |
|--------|--------|--------|
| `recharts` | ^3.7.0 | גרפים — Line, Bar, Pie, Area (lazy loaded) |

### עיבוד מסמכים

| חבילה | גרסה | תיאור |
|--------|--------|--------|
| `sharp` | ^0.34.5 | עיבוד תמונות — resize, convert, optimize |
| `pdfjs-dist` | ^5.4.624 | עיבוד PDF — המרה לתמונות, צפייה |
| `papaparse` | ^5.5.3 | ניתוח CSV — ייבוא נתונים |
| `jszip` | ^3.10.1 | יצירת/קריאת קבצי ZIP |

### תאריכים וזמנים

| חבילה | גרסה | תיאור |
|--------|--------|--------|
| `date-fns` | ^4.1.0 | עזרי תאריכים — פורמטים, חישובים, locale |
| `react-day-picker` | ^9.14.0 | בוחר תאריכים — לוח שנה אינטראקטיבי |

### אנימציות ו-Drag & Drop

| חבילה | גרסה | תיאור |
|--------|--------|--------|
| `motion` | ^12.34.0 | אנימציות — Framer Motion (motion) |
| `@dnd-kit/core` | ^6.3.1 | Drag & Drop — ליבה |
| `@dnd-kit/sortable` | ^10.0.0 | Drag & Drop — מיון |
| `@dnd-kit/utilities` | ^3.2.2 | Drag & Drop — עזרים |

### PWA ואופליין

| חבילה | גרסה | תיאור |
|--------|--------|--------|
| `web-push` | ^3.6.7 | התראות Push — VAPID, שליחה מהשרת |
| `idb-keyval` | ^6.2.2 | IndexedDB — אחסון key-value מקומי |

### Markdown

| חבילה | גרסה | תיאור |
|--------|--------|--------|
| `react-markdown` | ^10.1.0 | עיבוד Markdown ב-React |
| `remark-gfm` | ^4.1.0 | GitHub Flavored Markdown — טבלאות, משימות |

### ולידציה וטבלאות

| חבילה | גרסה | תיאור |
|--------|--------|--------|
| `zod` | ^4.3.6 | ולידציית סכמות — type-safe |
| `@tanstack/react-table` | ^8.21.3 | ניהול טבלאות — מיון, סינון, עמודים |

### Onboarding

| חבילה | גרסה | תיאור |
|--------|--------|--------|
| `nextstepjs` | ^2.2.0 | סיורים מודרכים — product tours |

---

## תלויות פיתוח — Dev Dependencies

| חבילה | גרסה | תיאור |
|--------|--------|--------|
| `typescript` | 5.9.3 | TypeScript compiler — strict mode |
| `@tailwindcss/postcss` | ^4 | Tailwind CSS PostCSS plugin |
| `tailwindcss` | ^4 | Tailwind CSS — framework |
| `tw-animate-css` | ^1.4.0 | אנימציות CSS ל-Tailwind |
| `eslint` | ^9 | בדיקת קוד סטטית |
| `eslint-config-next` | 16.1.6 | כללי ESLint ל-Next.js |
| `@types/node` | ^20 | TypeScript types ל-Node.js |
| `@types/react` | ^19 | TypeScript types ל-React |
| `@types/react-dom` | ^19 | TypeScript types ל-React DOM |
| `@types/papaparse` | ^5.5.2 | TypeScript types ל-PapaParse |
| `csv-parse` | ^6.2.1 | ניתוח CSV (בצד שרת) |
| `pg` | ^8.20.0 | לקוח PostgreSQL ישיר (סקריפטים) |

---

## הפניות למסמכים נוספים

- [סקירת פרויקט ודרישות מוצר](project-overview-pdr.md) — חזון, תכונות, ארכיטקטורה
- [סכמת מסד נתונים](database-schema.md) — טבלאות, עמודות, קשרים
