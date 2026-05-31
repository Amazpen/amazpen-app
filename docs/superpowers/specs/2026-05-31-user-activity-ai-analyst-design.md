# צ'אט "ניתוח AI" פר-משתמש במסך מעקב המשתמשים

תאריך: 2026-05-31
קבצים: `src/app/(dashboard)/admin/online-users/page.tsx` (UserHistoryModal), `src/app/api/user-activity/`, `src/lib/userActivityStats.ts` (חדש)

## מטרה

להוסיף ל-`UserHistoryModal` סקשן צ'אט AI שמנתח את המשתמש הספציפי על סמך נתוני
ה-tracking האמיתיים שלו (engagement, churn, streak, top pages, drop-off, פעולות
במערכת), ונותן תובנות ופעולות קונקרטיות — לא עצות גנריות.

## כלל מנחה (David Elbaz)

ה-AI חייב: לענות בעברית, **רק על סמך הנתונים שחושבו לאותו משתמש+טווח**, לתת
פעולות קונקרטיות (לא משימות גנריות), לא להמליץ דבר שמזיק לעסק, ולא להמציא נתונים.

## גישה

### 1. Backend — מקור-אמת משותף + endpoint
- **`src/lib/userActivityStats.ts`** (חדש, server-only): חילוץ לוגיקת חישוב ה-stats
  הקיימת מ-`GET /api/user-activity` ל-`computeUserActivityStats(admin, userId, days)`
  שמחזיר `{ activities, stats }`. אותם 11 המדדים בדיוק (אין שינוי התנהגות).
- **`GET /api/user-activity`** — מרופקטר לקרוא ל-helper (זהה בפלט).
- **`POST /api/user-activity/analyze`** (admin-only, חדש):
  - Body: `{ user_id, days, messages: [{role,content}] }`.
  - מחשב stats בשרת דרך ה-helper (לא סומך על הלקוח), + שולף שם/עסקים/last_seen.
  - בונה system prompt עם המספרים האמיתיים + כללי David.
  - מזרים תשובה: `streamText({ model: openai("gpt-4.1-mini"), system, messages }).toTextStreamResponse()`.
  - rate-limit פשוט per-user (כמו `/api/ai/chat`).

### 2. Frontend — סקשן ב-modal
- ב-`UserHistoryModal`, מיד אחרי כרטיסי ה-hero (engagement/churn/streak): סקשן
  **"✨ ניתוח AI"** מתקפל (collapsed by default).
- 4 צ'יפי quick-prompts: "למה בסיכון נטישה?" · "איך מחזירים אותו?" · "סכם את דפוס השימוש" · "מתי כדאי לפנות אליו?".
- שדה טקסט חופשי + שליחה. היסטוריית הודעות מקומית בתוך הסקשן. תשובות עם `AiMarkdownRenderer`.
- State: `aiOpen, aiMessages, aiInput, aiStreaming`. **מתאפס כש-`user.user_id` או `days` משתנים** (הקשר חדש → ניתוח חדש).
- שליחה: `fetch('/api/user-activity/analyze', POST)`, קריאת text-stream דרך `response.body.getReader()`, עדכון הודעת assistant אינקרמנטלית.

## אילוצים / שמירה על קיים
- בלי שינוי schema. משתמש ב-`user_activity_log`/`invoices`/`payments`/`daily_entries` הקיימים.
- הרפקטור של ה-GET חייב לשמר פלט זהה — אותם שדות stats.
- grounded לחלוטין: ה-AI רואה רק נתונים שחושבו בשרת.
- RTL: סקשן ותשובות מיושרים לימין; קלט `text-right`.
- צ'אט קליל ועצמאי (לא `AiChatContainer`/sessions של `/api/ai/chat`).

## בדיקות (ידני)
1. GET `/api/user-activity` עדיין מחזיר אותם נתונים (modal לא נשבר).
2. פתיחת סקשן AI, לחיצה על quick-prompt → תשובה מוזרמת בעברית עם מספרים אמיתיים.
3. החלפת משתמש/טווח → הצ'אט מתאפס.
4. שאלה על נתון שלא קיים → ה-AI לא ממציא.
5. admin-only: non-admin מקבל 403.
