# דדי - מפת מקורות נתונים (Running Map)

נבנה תוך כדי סיור במערכת עם המשתמש (2026-06-15). כל שורה: **אלמנט במסך ← מקור נתונים ← כלי עתידי של דדי**.

עיקרון-על: דדי לא מחשב מתמטיקה בעצמו. כל מדד מחושב בפונקציה דטרמיניסטית **המשותפת עם הדשבורד** (single source of truth), נחשפת כ-tool, ודדי בוחר דינמית לפי השאלה. הכל לפי **העסק הנבחר היחיד** ו**התאריך הנוכחי** (globalMonth/globalYear).

---

## 1. דשבורד - כרטיסי מדדים `#onboarding-data-cards`
מקור: `src/app/(dashboard)/page.tsx` → `fetchDetailedSummary()` (שורה ~1296). הכל מחושב חי, אין טבלה מקובצת מראש.

### הכנסות
| מדד | טבלה | חישוב |
|------|-------|--------|
| סה״כ הכנסות | `daily_entries.total_register` | סכום בטווח |
| צפי חודשי | `daily_entries`+`business_schedule`+`business_day_exceptions` | (הכנסה/ימי-עבודה-בפועל)×ימי-עבודה-צפויים (day_factor) |
| הפרש מהיעד | `goals.revenue_target` | (צפי/יעד−1)×100 |
| במקום/במשלוח | `daily_income_breakdown`+`income_sources` | סכום+orders_count לפי income_type (private/business) |

### הוצאות
| מדד | טבלה | חישוב |
|------|-------|--------|
| עלות עובדים | `daily_entries.labor_cost`+`businesses.manager_*`+`labor_month_close` | חודש סגור→חשבוניות employee_costs; אחרת חי×markup |
| עלות מכר (COGS) | `invoices`+`delivery_notes.subtotal` (ספקי goods_purchases) | סכום subtotal |
| מוצרים מנוהלים | `managed_products`+`daily_product_usage` | unit_cost×כמות |
| הוצאות שוטפות | `invoices.subtotal` (ספקי current_expenses) | מול יעד `supplier_budgets` |

נרמול מע"מ: כל אחוז = `סכום / (הכנסה/(1+vat))`. השוואות: הכנסה מול חודש-קודם-מלא; עלויות מול fair-compare (אותו טווח-ימים).

→ כלים: `getIncome`, `getLaborCost`, `getCOGS`, `getProductCost(name)`, `getOperatingExpenses`, `getFullSnapshot`

---

## 2. ניהול הוצאות - פילוח `#onboarding-expenses-breakdown`  ⚙️ דינמי לפי 3 טאבים
טאבים (role=tablist): **קניות סחורה** / **הוצאות שוטפות** / **עלות עובדים**. הרכיב מתמלא לפי הטאב הפעיל - פילוח **לפי קטגוריית ספק**.

→ כל כלי הוצאות מחזיר גם `breakdown[]` לפי קטגוריית ספק:
```
getOperatingExpenses → { total, pct, breakdown: [{category, amount, pct}, ...] }
```

---

## 3. ניהול הוצאות - חשבוניות אחרונות `#onboarding-expenses-recent`
"חשבוניות אחרונות שהוזנו". עמודות: תאריך, ספק, אסמכתא, סכום, סטטוס, סוג מסמך (חשבונית/ת.משלוח).
מקור: `invoices` (+`delivery_notes`), מסונן לעסק, ממוין תאריך יורד.

→ כלי: `getRecentExpenses(business, limit)` - לשאלות "הוצאות אחרונות".

---

## 4. ניהול ספקים - פתוח לתשלום `#onboarding-suppliers-total`  ⚙️ דינמי לפי טאבים
"פתוח לתשלום: ₪10,513,812.71" - סך היתרה הכוללת שחייבים לכל הספקים.
בנוסף: כרטיס לכל ספק (87 ספקים) עם **נותר לתשלום** (אדום) + **% מהכנסות**. דינמי לפי 4 טאבים: קניות סחורה / הוצאות שוטפות / עלות עובדים / התחייבויות קודמות.
מקור: יתרת ספק = חשבוניות שטרם שולמו פחות תשלומים (`invoices` pending + `payments`/`payment_splits`). ⚠️ לאמת מול `src/app/(dashboard)/suppliers/page.tsx`.

→ כלים: `getSuppliersPayable()` → { totalOpen, perSupplier: [{name, remaining, pctOfRevenue}], byTab }, ו-`getSupplierBalance(name)` לשאלה על ספק ספציפי.

### 4א. כרטיס ספק ברשימה `#onboarding-suppliers-list > button`
שם ספק + נותר לתשלום + % מהכנסות. (אגרת שילוט ₪10,002,662 / 337.41%).

### 4ב. פרטי ספק מלא (מודאל - לחיצה על כרטיס)
שדות: שם, תנאי תשלום (שוטף+), נדרש מע"מ, סוג הוצאה, קטגוריה, קטגוריית אב, מרכזת, ה.חודשית קבועה, **סכום חודשי קבוע**, יום חיוב בחודש, הלוואה.
**מצב חשבון:** סה"כ קניות מהספק (כולל מע"מ), סה"כ תשלום שבוצע, **יתרה לתשלום**.
**סיכום לפי חודשים:** חודש / רכישות כולל מע"מ / שולם / יתרה.
מקור: `suppliers` (מטא) + `invoices`+`delivery_notes` (קניות) + `payments`/`payment_splits` (תשלומים), מקובץ לפי חודש.

→ כלי: `getSupplierDetail(name)` → { meta, account:{purchases,paid,balance}, monthly:[...] } - לשאלה על ספק ספציפי.

### 4ג. שורות פרטניות בכרטיס ספק - תתי-טאבים: חשבוניות / תשלומים / מסמכים
פילטר "הצג רק לא שולמו". טבלת חשבוניות: תאריך, אסמכתא, לפני מע"מ (subtotal), כולל מע"מ (total), סטטוס (ממתין/שולם).
מקור: `invoices` (per supplier) / `payments`+`payment_splits` (per supplier) / מסמכים מצורפים.

→ להרחיב `getSupplierDetail` עם: `invoices:[{date,ref,subtotal,total,status}]`, `payments:[...]`, ופילטר `onlyUnpaid`. שאלות: "אילו חשבוניות פתוחות יש לי מ-X?".

---

## 5. ניהול תשלומים - סיכום `/payments`
"תשלומים שיצאו: ₪41,085" (כולל מע"מ) + פילוח לפי אמצעי תשלום (צ'ק / כרטיס אשראי / העברה בנקאית / מזומן) עם סכום ו-% מפדיון.
מקור: `payments`+`payment_splits` (method+amount per split), מסונן לעסק+טווח, מקובץ לפי אמצעי תשלום.
בנוסף בדף: כפתורי "הצגת תשלומי עבר" + "צפי תשלומים קדימה" (תחזית תשלומים עתידיים).

→ כלים: `getPaymentsSummary()` → { totalPaid, byMethod:[{method,amount,pctOfRevenue}] }; `getUpcomingPayments()` (צפי קדימה - רלוונטי לתזרים).

### 5א. צפי תשלומים קדימה (כפתור מרחיב)
"סה"כ תשלומים פתוחים: ₪66,133.20". מקובץ לפי חודש → לפי תאריך-פירעון ספציפי (17 יוני ₪20,000, 24 יוני ₪3,988...).
מקור: חשבוניות פתוחות (pending) עם תאריך-פירעון מחושב לפי תנאי תשלום (`payment_terms_days`/`billing_day`), מקובץ חודש→תאריך. ⚠️ לאמת מול `payments/page.tsx`.

→ `getUpcomingPayments()` → { totalOpen, byMonth:[{month, total, byDate:[{date,amount}]}] }. שאלות: "כמה אני צריך לשלם החודש/בקרוב?".

### 5ב. תשלומי עבר (כפתור מרחיב)
היסטוריית תשלומים שבוצעו, מקובצת לפי חודש (סה"כ ששולם): אפריל 2026 ₪112,578, מרץ ₪364,060... + סקשנים "התחייבויות שבוצעו" ו"תשלומים אחרונים ששולמו".
מקור: `payments`+`payment_splits` (executed), מקובץ לפי חודש, יורד.

→ `getPaymentHistory()` → { byMonth:[{month, totalPaid}], recent:[...] }. שאלות: "כמה שילמתי בחודש X?".

### 5ג. תשלומים אחרונים ששולמו `#onboarding-payments-list`
טבלה: תאריך, ספק, אסמכתא, תשלומים (מספר splits, 1/1), אמצעי, סכום. (10.06.26 / פרסום בגוגל / כרטיס אשראי / ₪12,300).
מקור: `payments`+`payment_splits` + `suppliers`, ממוין תאריך יורד.

→ `getRecentPayments(limit)` → [{date, supplier, ref, splits, method, amount}]. שאלות: "מה התשלומים האחרונים ששילמתי?".

---

## 6. תזרים מזומנים `/cashflow` (תחזית)
כותרת סיכום: מצב בבנק תחילת פעילות (₪1,500 ב-01.03.2026) · צפי עד (טווח 01/03–15/09) · סה"כ הכנסות (₪440,122) · סה"כ הוצאות (₪635,291) · הפרש נקי (-₪195,169).
טבלה יומית: לכל יום - כניסה (ירוק) / יציאה (אדום) / נטו / **יתרה מצטברת** (מתגלגלת).
מקור: יתרת-פתיחה (הגדרת עסק) + תחזית הכנסות (דפוסי הכנסה יומיים) + תחזית הוצאות (תשלומים מתוזמנים/`getUpcomingPayments`). ⚠️ לוגיקת תחזית - לאמת מול `cashflow/page.tsx`.

→ `getCashflowForecast()` → { startingBalance, range, totalIncome, totalExpenses, netDiff, daily:[{date,in,out,balance}], firstNegativeDay }. שאלות: "מה התזרים?", "מתי אכנס למינוס?".

---

## 7. דוח רווח והפסד `/reports`  ⚙️ דינמי: תצוגה חודשית / שנתית
סיכום: "סה"כ תוצאות רווח/הפסד" (₪38,937.16, +13.55%). גרף הכנסות מול הוצאות (ללא מע"מ, 6 חודשים).
**הכנסות ללא מע"מ:** יעד / בפועל / הפרש ב-₪ / הפרש ב-% (יעד ₪539.4K, בפועל ₪287.3K, -53.27%).
**פירוט ההוצאות (טבלה):** שם הוצאה / יעד / בפועל / הפרש ב-₪ / נותר לניצול - לכל קטגוריית הוצאה (עלות מכר, עובדים, שוטפות, מוצרים מנוהלים).
מקור: הכנסות (`daily_entries`, ללא מע"מ) + הוצאות (`invoices` לפי קטגוריה) + יעדים (`goals`+`supplier_budgets`). אותה לוגיקה כמו הדשבורד אבל בתצוגת דוח. ⚠️ תלוי ב-`expense_categories` כעוגן תצוגה (ראה memory).

→ `getProfitLossReport(view: 'monthly'|'annual')` → { total, totalPct, revenue:{target,actual,diff,diffPct}, expenses:[{name,target,actual,diff,remaining}] }. שאלות: "מה הרווח שלי?", "איפה אני חורג מהיעד?".

---

## 8. יעדים `/goals`  ⚙️ דינמי: 3 טאבים (KPI / יעד VS שוטפות / יעד VS קניות סחורה)
בורר שנה/חודש. טבלה: קטגוריה / **יעד** / **בפועל** / **מצב** (יתרה מהתקציב, ירוק=מתחת ליעד).
דוגמאות: ביטוח רכבים יעד ₪450/בפועל ₪450; הוצאות קבועות יעד ₪51,450/בפועל ₪51,050 (+₪400); עמלות חברות הקפה יעד ₪11,600/בפועל ₪0.
מקור: יעדים `goals`+`supplier_budgets` מול בפועל `invoices`/`daily_entries`, לפי קטגוריה. טאב KPI = יעדי % (revenue/labor/food).

→ `getGoalsVsActual(view: 'kpi'|'operating'|'goods')` → { period, byCategory:[{category, target, actual, status}] }. שאלות: "איפה אני עומד מול היעדים?", "כמה נשאר לי בתקציב X?".

---

## 9. נתוני עבר - סה"כ מכירות (שנתי) `#radix dialog "נתוני עבר - סה"כ מכירות"` ⏳ לבנות
תצוגה שנתית חודש-חודש (בורר שנה). טבלה: חודש / סה"כ מכירות ₪ / הפרש מהיעד % / שינוי מחודש קודם % / שינוי משנה שעברה %. + גרף מגמה חודשית.
דוגמה 2026: ינואר ₪572,392, פברואר ₪538,912 (+2.00%/-5.85%), מרץ ₪640,084, מאי ₪658,943, יוני ₪347,030 (-45.48%). יולי-דצמבר ₪0.
מקור: `daily_entries.total_register` מסוכם לכל חודש + יעד מ-`goals.revenue_target` + MoM/YoY. ⚠️ לאמת מול קומפוננטת "נתוני עבר"/dashboard.
→ כלי עתידי: `getAnnualSales(year)` → { year, months:[{month, totalSales, targetDiffPct, momPct, yoyPct}] }. שאלות: "מכירות כל השנה חודש-חודש", "החודש הכי חזק בשנה", "מגמה".

### 9א. נתוני עבר פר-מקור-הכנסה (שנתי) - "במקום", "במשלוח" וכו'
אותו מבנה כמו 9 אבל לכל מקור הכנסה בנפרד. למשל "נתוני עבר - במקום": חודש / במקום ₪ / הפרש מהיעד % / מחודש קודם % / **ממוצע להזמנה**. ינואר ₪354,652 (+31.08%, ממוצע ~₪14...).
מקור: `daily_income_breakdown` לפי `income_source` מסוכם לחודש + `income_source_goals.avg_ticket_target`.
→ להרחיב `getAnnualSales` עם פילוח פר-מקור, או כלי `getAnnualBySource(year, sourceName)`.

### 9ב. נתוני עבר - דפוס כללי (תצוגה שנתית לכל מדד)
סקשן "נתוני עבר" נותן תצוגה שנתית חודש-חודש **לכל מדד**, כל אחד עם יעד/הפרש/MoM/YoY:
- סה"כ מכירות (9), במקום/במשלוח פר-מקור (9א), **עלות עובדים** (₪ + % + הפרש מהיעד + MoM + YoY), ועוד צפויים (עלות מכר, הוצאות שוטפות, מוצרים מנוהלים).
מקור: `daily_entries`/`invoices`/`daily_product_usage` מסוכמים לחודש + יעדים מ-`goals`/`supplier_budgets`, לאורך השנה. fallback היסטורי מ-`monthly_summaries`.
→ כלי גנרי מוצע: `getAnnualMetric(year, metric)` עם metric ∈ {sales, labor, cogs, operating, source:<name>, product:<name>}. או כמה כלים שנתיים. **לבנות אחרי שהמשתמש מסיים להראות את כל הווריאנטים.**

(המשתמש ציין: יש עוד - להמתין לפני בנייה.)

## TODO (להמשך הסיור)
- [ ] יעדים, ספקים, תזרים, רווח-הפסד, לקוחות (עסקי שירות)
- [ ] להחליט: מודול משותף `lib/metrics/` + אימות parity מול הדשבורד
