# דדי - תוכנית מימוש (Implementation Plan)

מבוסס על [מפת מקורות הנתונים](2026-06-15-dedi-agent-data-sources-map.md). מטרה: דדי עונה במספרים **זהים לדשבורד**, לעסק יחיד, לפי התאריך הנוכחי.

## ארכיטקטורה
```
src/lib/metrics/            ← מודול שרת טהור, מקור-אמת לחישוב (חדש)
  income.ts                 ← סלייס 1
  expenses.ts               ← סלייס 2 (labor/COGS/managed/operating)
  suppliers.ts, payments.ts, cashflow.ts, pnl.ts, goals.ts  ← סלייסים הבאים
  types.ts
/api/agent/[metric]/route.ts  ← endpoint לכל קבוצה (server supabase client)
chat route tools            ← כל tool קורא ל-endpoint/מודול, מחזיר JSON מחושב לדדי
```

**עיקרון:** דדי לא מחשב מתמטיקה. הפונקציות מחשבות (זהה לדשבורד), נחשפות כ-tools, דדי בוחר דינמית.

## גישת בנייה (מאושר)
מודול שרת **חדש** + **אימות parity מול הדשבורד** (עסק הדגמה). לא נוגעים בדשבורד הקיים בשלב זה. התכנסות (דשבורד→מודול) בהמשך, אופציונלי.

## ✅ הושלם 2026-06-15 - כל 7 הסלייסים + parity מלא + 11 כלים מחוברים
backend נפרד `/api/agent/chat` (gpt-4.1-mini, עסק יחיד) עם 11 כלים שקוראים למודולים ב-`src/lib/metrics/`. כל מודול אומת מול הדשבורד/המסכים לעסק הדגמה (יוני 2026) - parity מלא לאגורה. מבחן רב-כלי עבר (דדי קרא ל-2 כלים בשאלה אחת). `/ai` הישן לא נגעו.

| סלייס | מודול | endpoint | tools | parity |
|-------|-------|----------|-------|--------|
| הכנסות | income.ts | /api/agent/income | getIncome | ✅ |
| הוצאות | expenses.ts | /api/agent/expenses | getExpenses | ✅ |
| ספקים | suppliers.ts | /api/agent/suppliers | getSuppliersPayable, getSupplierDetail | ✅ |
| תשלומים | payments.ts | /api/agent/payments | getPaymentsSummary, getUpcomingPayments, getPaymentHistory, getRecentPayments | ✅ |
| תזרים | cashflow.ts | /api/agent/cashflow | getCashflowForecast | ✅ |
| רווח-הפסד | pnl.ts | /api/agent/pnl | getProfitLossReport | ✅ |
| יעדים | goals.ts | /api/agent/goals | getGoalsVsActual | ✅ |

הערה: בהכנסות להשתמש ב-`bySource` (לפי שם) לפילוח במקום/במשלוח, לא ב-`inPlace`/`delivery` (private/business).

### סלייסים מקוריים (לעיון)
1. **הכנסות** ✅
2. הוצאות (labor / COGS / managed products / operating) + breakdown לקטגוריה
3. ספקים (payable + supplier detail)
4. תשלומים (summary / upcoming / history / recent)
5. תזרים (forecast)
6. רווח-הפסד
7. יעדים (vs actual)

## אימות parity (קריטי - הגדרת "בוצע" לכל סלייס)
לכל סלייס: לקרוא ל-endpoint עבור עסק הדגמה (`f7749667-4f09-456c-81f5-0b3e7533a48b`), חודש נוכחי, ולהשוות **כל מספר** מול הדשבורד החי בדפדפן QA. חייב להיות זהה (הפרש < ₪0.01). אם לא - לתקן עד התאמה.

## תלות לדדי-מדבר (לא חוסם את שכבת הנתונים)
`OPENAI_API_KEY` ב-`.env.local` (כרגע חסר → 503). שכבת הנתונים (modules+endpoints) נבנית ונבדקת בלי זה; חיבור ה-LLM אחרי.

## סלייס 1 - הכנסות (מקור: `page.tsx` fetchDetailedSummary, ~1296-1640, 1765-1830, 1940-2160)
פלט `getIncome(supabase, businessId, dateRange)`:
```
{ totalIncome, monthlyPace, revenueTarget, targetDiffPct, targetDiffIls,
  momChangePct, yoyChangePct,
  bySources: [{ name, incomeType, amount, ordersCount, avgTicket, avgTicketTarget, momChange, yoyChange }] }
```
לוגיקה קריטית: pace = (totalIncome/actualWorkDays)×expectedWorkDays (day_factor מ-schedule+exceptions); target מ-`goals.revenue_target`; in-place=income_type 'private', delivery='business'.
