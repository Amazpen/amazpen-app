# מודול סליקה לאדמינים (Cardcom) — Design Spec

**תאריך:** 2026-06-08
**סטטוס:** מאושר (brainstorming) — ממתין לתכנית מימוש

## 1. מטרה והקשר

עמוד חדש בתפריט הצד, **גלוי לאדמינים בלבד**, שבו אדמינים מנהלים מנויים חודשיים מתחדשים של לקוחות ה-SaaS וסולקים אותם דרך Cardcom.

החלטות מפתח שאושרו ב-brainstorming:
- **סוג חיוב:** חיוב אמיתי בכרטיס אשראי (לא רישום ידני).
- **ספק סליקה:** Cardcom (API v11).
- **אופן החיוב:** דף תשלום מאוחסן של Cardcom (LowProfile) — פרטי הכרטיס לעולם לא נוגעים בשרת שלנו, **אין חשיפת PCI**.
- **מודל:** מנוי חודשי מתחדש.
- **ישות החיוב:** לקוח עצמאי — רשומה נפרדת (שם/טלפון/ח.פ), **לא** קשורה ל-`businesses`/`users` קיימים.
- **תמחור:** סכום חודשי חופשי שהאדמין מקליד לכל לקוח (ללא טבלת תוכניות).
- **מנגנון חיוב חוזר:** Token + cron יומי משלנו (לא הוראת-קבע מובנית של Cardcom).
- **חשבונית/קבלה:** Cardcom יפיק חשבונית מס/קבלה אוטומטית בכל חיוב (שדה `Document`).
- **נתיב:** `/admin/billing`.

מצב קיים שנבדק: אין שום תשתית חיובים/מנויים. כל טבלאות ה-`payment`/`invoice` הקיימות הן למעקב ההוצאות של העסקים עצמם — לא לחיוב לקוחות אמזפן. זהו greenfield module.

## 2. ארכיטקטורה

```
[Admin UI /admin/billing]
   │  צור לקוח + סכום חודשי
   ▼
[POST /api/billing/charge/create-lowprofile] ── Cardcom LowProfile/Create (ChargeAndCreateToken)
   │  מחזיר URL                                       │
   ▼                                                   │ לקוח ממלא כרטיס בדף Cardcom
[iframe/dialog עם דף Cardcom] ◄──────────────────────┘
   │
   ▼ (Cardcom → WebHookUrl)
[POST /api/billing/cardcom/webhook] ── GetLpResult (אימות server-side)
   │  שומר token + 4 ספרות, מסמן charge=success, מנוי=active, קובע next_charge_date
   ▼
[billing_subscriptions: active]
   │
   ▼ כל יום
[POST /api/billing/process  (cron)] ── Transactions/Transaction (charge by token)
   │  מחייב מנויים due, מתעד ב-billing_charges, מקדם next_charge_date בחודש
```

עקרון: **לעולם לא סומכים על redirect הדפדפן** לסימון "שולם" — האמת נקבעת רק ע"י אימות server-side מול Cardcom (GetLpResult / תוצאת Transaction).

## 3. סכמת DB

שלוש טבלאות חדשות. הפרדה לפי אחריות: זהות לקוח / הסדר חיוב / לוג עסקאות.

### `billing_customers`
| עמודה | טיפוס | הערות |
|------|------|------|
| id | uuid pk | default gen_random_uuid() |
| name | text not null | |
| phone | text | |
| email | text | יעד לחשבונית/קבלה |
| tax_id | text | ח.פ / ת.ז |
| notes | text | |
| created_by | uuid | האדמין שיצר |
| created_at / updated_at | timestamptz | default now() |
| deleted_at | timestamptz | soft-delete |

### `billing_subscriptions` (1:1 עם לקוח)
| עמודה | טיפוס | הערות |
|------|------|------|
| id | uuid pk | |
| customer_id | uuid fk → billing_customers | |
| monthly_amount | numeric not null | סכום חופשי |
| currency | text default 'ILS' | |
| status | text | `pending` → `active` → `paused`/`cancelled`/`failed` |
| cardcom_token | text | נשמר אחרי חיוב ראשון מוצלח |
| card_last_four | text | תצוגה בלבד |
| card_expiry | text | תצוגה בלבד (MM/YY) |
| next_charge_date | date | מתי החיוב הבא |
| day_of_month | int | נגזר מהחיוב הראשון |
| started_at | timestamptz | |
| cancelled_at | timestamptz | |
| created_at / updated_at | timestamptz | |

### `billing_charges` (לוג כל ניסיון חיוב)
| עמודה | טיפוס | הערות |
|------|------|------|
| id | uuid pk | משמש כ-`ReturnValue` מול Cardcom |
| subscription_id | uuid fk | nullable עד שהמנוי נוצר |
| customer_id | uuid fk | denormalized |
| amount | numeric | |
| status | text | `pending` / `success` / `failed` |
| type | text | `initial` / `recurring` / `manual` |
| cardcom_low_profile_id | text | לחיוב הראשון (LowProfile) |
| cardcom_transaction_id | text | מזהה עסקה |
| cardcom_response | jsonb | תגובה גולמית מלאה |
| error_message | text | |
| charged_at | timestamptz | |
| created_at | timestamptz | |

### RLS
לפי חוקי הפרויקט: policies **נפרדות** ל-SELECT/INSERT/UPDATE/DELETE (לא `FOR ALL`), ובכל אחת `is_admin()` בלבד (לא members). לוודא בזמן המימוש שה-helper `is_admin()` קיים; אם לא — להשתמש בבדיקת `profiles.is_admin` מקבילה. ה-cron וה-webhook ניגשים עם service-role (עוקף RLS) — לכן ה-policies נועדו לחסום משתמשים רגילים בלבד.

## 4. אינטגרציית Cardcom — `src/lib/cardcom.ts`

עוטף קריאות מול `CARDCOM_BASE_URL` (`https://secure.cardcom.solutions/api/v11`). קורא קרדנציאלס מ-env בלבד.

- **`createLowProfile({ amount, chargeId, customer })`** → `POST /LowProfile/Create`
  - `TerminalNumber`, `ApiName` מ-env.
  - `Operation: "ChargeAndCreateToken"` — מחייב ושומר token בו-זמנית.
  - `Amount`, `ReturnValue: chargeId` (id של רשומת billing_charges), `SuccessRedirectUrl`, `FailedRedirectUrl`, `WebHookUrl`.
  - `Document` — פרטי לקוח להפקת חשבונית מס/קבלה אוטומטית.
  - מחזיר `{ url, lowProfileId }`.
- **`getLpResult(lowProfileId)`** → `POST /LowProfile/GetLpResult` — אימות תוצאה server-side; מחזיר סטטוס, token, 4 ספרות, תוקף, מזהה עסקה.
- **`chargeToken({ token, amount, customer })`** → `POST /Transactions/Transaction` — חיוב לפי token (שרת-לשרת) לחיוב החודשי. כולל `Document` לחשבונית.

כל הפונקציות מחזירות תוצאה מנורמלת (`{ success, transactionId, raw, error }`) ולא חושפות את פורמט Cardcom הגולמי החוצה.

## 5. API routes — `/api/billing/`

כל route בודק אדמין באותו דפוס כמו `/api/admin/create-user` (`createServerClient().auth.getUser()` → `profiles.is_admin`), פרט ל-cron שמוגן בסוד.

| Route | תיאור |
|------|------|
| `GET /api/billing/customers` | רשימת לקוחות + סטטוס מנוי + סכום + תאריך חיוב הבא |
| `POST /api/billing/customers` | יצירה/עדכון לקוח |
| `POST /api/billing/charge/create-lowprofile` | יוצר billing_charges(pending) + מנוי(pending) + דף Cardcom; מחזיר URL |
| `POST /api/billing/cardcom/webhook` | ה-`WebHookUrl`. מאמת ב-GetLpResult, שומר token+4 ספרות, charge=success, מנוי=active, next_charge_date |
| `GET /api/billing/charge/result` | landing של SuccessRedirectUrl — polling על סטטוס ה-charge |
| `POST /api/billing/subscriptions/[id]/cancel` | ביטול מנוי |
| `POST /api/billing/subscriptions/[id]/pause` | השהיה |
| `POST /api/billing/subscriptions/[id]/resume` | חידוש |
| `POST /api/billing/subscriptions/[id]/charge-now` | חיוב ידני מיידי (type=manual) |
| `POST /api/billing/process` | **cron יומי** (ראה §6) |

### webhook — חוסן
- מאמת תמיד דרך `GetLpResult` עם הקרדנציאלס שלנו — לא סומך על גוף ה-webhook.
- אידמפוטנטי: אם ה-charge כבר `success` — מתעלם (Cardcom עשוי לשלוח כפול).
- מאתר את ה-charge לפי `ReturnValue` (=billing_charges.id).

## 6. Cron חיוב חודשי — `POST /api/billing/process`

באותו דפוס הגנה כמו `/api/retainers/process` (סוד ב-header/query). מופעל יומית (n8n או scheduler חיצוני).

לוגיקה:
1. שלוף מנויים `status='active'` עם `next_charge_date <= today` ו-`cardcom_token` קיים.
2. לכל מנוי: `chargeToken()` → צור `billing_charges` (type=`recurring`).
3. בהצלחה: `charged_at=now`, `next_charge_date += 1 month` (שמירה על `day_of_month`; טיפול בחודשים קצרים — clamp ליום האחרון בחודש).
4. בכשל: `billing_charges.status='failed'` + `error_message`; מדיניות retry — N ניסיונות לפני `subscription.status='failed'` (ברירת מחדל: 3 ימים רצופים). לתעד כל ניסיון.
5. אידמפוטנטי: לא לחייב פעמיים את אותו מנוי באותו יום (לבדוק אם קיים charge מוצלח להיום).

## 7. עמוד הפרונט — `src/app/(dashboard)/admin/billing/page.tsx`

`"use client"`, כותרת "סליקה". מבנה:
- **טבלת לקוחות** בדפוס ה-RTL המחייב של טבלת החשבוניות ב-`expenses/page.tsx`: `<div>` עם header `grid-cols-[...]` רקע `bg-[#29318A]` `rounded-t-[7px]` `pe-[13px]` (פיצוי scrollbar), ושורות עם אותו `grid-cols` בדיוק (`fr` units). עמודות: שם, טלפון, סכום חודשי, סטטוס (תג צבעוני), תאריך חיוב הבא, 4 ספרות אחרונות, פעולות.
- **כפתור "+ לקוח חדש"** → מודל: שם, טלפון, מייל, ח.פ, סכום חודשי. שמירה → יוצר לקוח+מנוי `pending` → קורא `create-lowprofile` → פותח דף Cardcom ב-iframe בתוך דיאלוג.
- בהצלחת חיוב ראשון (polling על `charge/result` או הודעת postMessage): סוגר דיאלוג, מרענן טבלה, סטטוס→`active`.
- **פעולות שורה:** חייב עכשיו, השהה/חדש, בטל, היסטוריית חיובים (מודל עם רשומות `billing_charges`).
- תגי סטטוס: `pending`=אפור, `active`=ירוק, `paused`=כתום, `failed`=אדום, `cancelled`=אפור כהה.

RTL: לפי כללי הפרויקט — first child בשורת flex = ימין. סמל ₪ ליד מספרים. `text-align: start`.

## 8. תפריט צד — `src/app/(dashboard)/layout.tsx`

- הוסף ל-`adminMenuItems` (הקבוצה הראשונה, ליד "ניהול משתמשים"): `{ id: <new>, label: "סליקה", href: "/admin/billing", key: "admin-billing" }`.
- הוסף ל-flat list של `isAdminPage`.
- הוסף למפת כותרות העמודים: `"/admin/billing": "סליקה"`.
- כל תפריט האדמין כבר עטוף ב-`{isAdmin && ...}` → גלוי לאדמינים בלבד אוטומטית.

## 9. משתני סביבה (ב-Dokploy/`.env` — לעולם לא ב-git)

```
CARDCOM_TERMINAL=
CARDCOM_API_NAME=
CARDCOM_API_PASSWORD=
CARDCOM_BASE_URL=https://secure.cardcom.solutions/api/v11
BILLING_CRON_SECRET=        # או שימוש חוזר בסוד ה-cron הקיים
```

הקרדנציאלס האמיתיים (terminal/API name/password) נמסרו ע"י המשתמש ויוזנו ב-Dokploy ידנית — **לא** מתועדים כאן ולא נכנסים לאף קובץ ב-repo (GitHub secret-scanning יחסום, וגם זו חשיפת אבטחה).

## 10. בדיקות

- **`cardcom.ts`** — unit עם mock fetch: בניית payload נכונה ל-Create/GetLpResult/chargeToken, נרמול תגובות הצלחה/כשל.
- **cron logic** — בחירת מנויים due, קידום `next_charge_date` (כולל clamp לחודש קצר), אידמפוטנטיות, מדיניות retry.
- **webhook** — אימות מול GetLpResult, אידמפוטנטיות (webhook כפול), מעבר סטטוס pending→active.
- **flow מלא** מול סביבת test/sandbox של Cardcom לפני production.

## 11. מחוץ לטווח (YAGNI)

- חיוב per-business/per-user מקושר (נבחר מפורשות: לקוח עצמאי).
- טבלת תוכניות תמחור (נבחר: סכום חופשי).
- הוראת-קבע מובנית של Cardcom (נבחר: token+cron).
- self-service ללקוח (זה כלי אדמין בלבד).
