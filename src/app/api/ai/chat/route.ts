import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { streamText, tool, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per user)
// ---------------------------------------------------------------------------
const RATE_LIMIT = 20;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORBIDDEN_SQL =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|union|execute|call|prepare|do\b|load|import)\b/i;

function stripSqlFences(raw: string): string {
  return raw
    .replace(/^```sql?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim()
    .replace(/;\s*$/, "");
}

/** Safely evaluate a pure math JS expression. Returns the number or throws. */
function safeEvalMath(expr: string): number {
  const forbidden = /\b(eval|Function|require|import|fetch|XMLHttpRequest|process|global|window|document|setTimeout|setInterval|Buffer|fs|child_process|exec|spawn)\b/;
  if (forbidden.test(expr)) throw new Error("Forbidden expression");
  const sanitized = expr.replace(/Math\.\w+/g, "M");
  if (/[a-zA-Z_$]/.test(sanitized.replace(/M/g, ""))) throw new Error("Invalid characters in expression");
  const fn = new Function(`"use strict"; return (${expr});`);
  const result = fn();
  if (typeof result !== "number" || !isFinite(result)) throw new Error("Result is not a valid number");
  return result;
}

/** Map a page path to a Hebrew context hint for the AI */
function getPageContextHint(page: string): string {
  const map: Record<string, string> = {
    "/": "הדשבורד הראשי — סקירה כללית של ביצועי העסק",
    "/expenses": "דף ניהול הוצאות — חשבוניות ספקים, הוצאות שוטפות ומכר",
    "/suppliers": "דף ניהול ספקים — רשימת ספקים, יתרות, פרטי קשר",
    "/payments": "דף ניהול תשלומים — תשלומים שבוצעו ותשלומים עתידיים",
    "/cashflow": "דף תזרים מזומנים — צפי כסף נכנס ויוצא",
    "/goals": "דף יעדים — יעדי הכנסות, עלויות ורווחיות",
    "/reports": "דוח רווח והפסד — סיכום חודשי של הכנסות מול הוצאות",
    "/settings": "הגדרות — הגדרות משתמש ועסק",
    "/ocr": "קליטת מסמכים OCR — סריקת חשבוניות",
    "/price-tracking": "מעקב מחירי ספקים — השוואת מחירים לאורך זמן",
  };
  return map[page] || "";
}

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Chat history persistence helper
// ---------------------------------------------------------------------------
async function saveMessageToDB(
  supabaseUrl: string,
  serviceRoleKey: string,
  sId: string,
  role: "user" | "assistant",
  content: string,
  chartData?: unknown
) {
  if (!sId) return;
  try {
    const adminSb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await adminSb.from("ai_chat_messages").insert({
      session_id: sId,
      role,
      content,
      chart_data: chartData || null,
    });
    await adminSb
      .from("ai_chat_sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sId);
  } catch (err) {
    console.error("Failed to save message:", err);
  }
}

// ---------------------------------------------------------------------------
// Role-specific instructions
// ---------------------------------------------------------------------------
function getRoleInstructions(userRole: string): string {
  if (userRole === "מנהל מערכת") {
    return `## 🔑 התאמה לסוג משתמש: מנהל מערכת (Admin)
- אתה מדבר עם מנהל המערכת שרואה את **כל העסקים**.
- כשהוא שואל שאלה כללית ("איך המצב?"), הצג סקירה **חוצת-עסקים**: השווה ביצועים בין כל העסקים.
- הדגש אילו עסקים עומדים ביעד ואילו חורגים — תן תמונת מצב ניהולית.
- אל תדבר כאילו הוא בעל עסק בודד — הוא מנהל, דבר מנקודת מבט ניהולית-אסטרטגית.
- הציע השוואות: "רוצה לראות איזה עסק הכי רווחי החודש?" או "אפשר להשוות את עלות העובדים בין כל העסקים."
- כשהוא שואל על עסק ספציפי — תן סיכום מפורט כולל המלצות לשיפור.`;
  }
  if (userRole === "בעל עסק") {
    return `## 🔑 התאמה לסוג משתמש: בעל עסק
- אתה מדבר עם בעל העסק — דבר כמו יועץ אישי שלו.
- התמקד ברווחיות, עלויות, ויעדים. זה מה שהכי חשוב לו.
- הצע תובנות פרואקטיביות: "שים לב שעלות המכר עלתה ב-2% — כדאי לבדוק את ספק X."
- כשהוא שואל "איך החודש?" — תן סיכום מלא עם צפי לסיום החודש.
- אם יש חריגה — הסבר מה אפשר לעשות ותן המלצה פרקטית.
- הוא רוצה שורה תחתונה — כמה כסף נכנס, כמה יצא, כמה נשאר.`;
  }
  if (userRole === "מנהל") {
    return `## 🔑 התאמה לסוג משתמש: מנהל
- אתה מדבר עם מנהל העסק — הוא אחראי על התפעול היומיומי.
- התמקד בנתונים תפעוליים: הכנסות יומיות, שעות עבודה, עלות עובדים, הזמנות.
- הצע תובנות שקשורות לניהול יומי: "ההכנסות היום נמוכות מהממוצע — אולי לשקול קידום?"
- כשהוא שואל על עובדים — תן מידע מפורט: שעות, עלות, אחוז מהכנסות.
- כשהוא שואל על ספקים — תן פירוט חשבוניות ותשלומים.`;
  }
  return `## 🔑 התאמה לסוג משתמש: ${userRole}
- דבר בפשטות וברור — הימנע ממונחים מורכבים.
- התמקד בנתונים רלוונטיים ליום-יום: הכנסות היום, הכנסות אתמול, ביצועים מול ממוצע.
- אל תציג נתונים פיננסיים רגישים כמו רווח/הפסד או עלות עובדים כוללת אלא אם נשאל במפורש.
- הצע שאלות פשוטות: "רוצה לראות את ההכנסות של היום?" או "אפשר לבדוק כמה הזמנות היו."`;
}

// ---------------------------------------------------------------------------
// Unified system prompt builder
// ---------------------------------------------------------------------------
function buildUnifiedPrompt(opts: {
  userName: string;
  userRole: string;
  businessId: string;
  businessName: string;
  isAdmin: boolean;
  allBusinesses: Array<{ id: string; name: string }>;
  pageHint: string;
  bonusPlanContext?: string;
}): string {
  const { userName, userRole, businessId, businessName, isAdmin, allBusinesses, pageHint, bonusPlanContext } = opts;
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const israelTime = now.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "full", timeStyle: "short" });
  const israelHour = parseInt(now.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false }));
  const timeGreeting = israelHour < 12 ? "בוקר טוב" : israelHour < 17 ? "צהריים טובים" : israelHour < 21 ? "ערב טוב" : "לילה טוב";

  const bizContext = businessName ? `העסק הנבחר: "${businessName}" (ID: ${businessId}).` : "";
  const adminBizList = isAdmin && allBusinesses.length > 0
    ? `\nעסקים במערכת:\n${allBusinesses.map((b) => `- "${b.name}" → '${b.id}'`).join("\n")}`
    : "";

  return `<identity>
אתה "דדי" — העוזר החכם של המצפן, אנליסט עסקי מומחה ויועץ אישי למערכת ניהול עסקית.
התאריך: ${today}. השעה: ${israelTime}. ברכה מתאימה: "${timeGreeting}".
</identity>

<about-amazpen>
## מי אנחנו — המצפן (Amazpen)
המצפן הוא מערכת GPS לניהול עסקים — פלטפורמה דיגיטלית + ליווי אנושי יומיומי. כמו משרד חיצוני לניהול פיננסי במיקור חוץ.
מייסד: דוד אלבז, 25 שנות ניסיון בניהול עסקים (15 שנה בדומינוס פיצה, ניהול כ-250 עובדים).
חברת אם: DBC Group (www.dbcgroup.co.il). אתר: www.amazpen.co.il.

**ערך מרכזי:** אין מערכת דומה — כדי לקבל שירות דומה צריך לשלב מספר מערכות, אקסלים, אנשי מקצוע וזמן פנוי.

**מה נדרש מהלקוח:** אפיון ראשוני חד-פעמי (גישה לקופות + נתוני עבר), ובשוטף — שליחת חשבוניות הוצאות. המצפן מעדכן הכל, מעביר לרואה חשבון, ומוודא שהכל מטופל.

## המחזור החודשי — איך עובד בפועל

### לפני תחילת החודש (ב-28 לחודש)
המצפן שולח ללקוח **תוכנית עסקית** הכוללת: צפי הכנסות, צפי הוצאות, צפי רווח.
התוכנית נבנית על בסיס: תוצאות עבר, כמות ימי עבודה (בניכוי חגים), הוצאות קבועות ומשתנות, מגמת העסק בשנים האחרונות.
**הלקוח רק מאשר — המצפן עושה הכל.**

### יעדים שמוגדרים
- **מכירות:** סה"כ הכנסות + ממוצע רכישה ללקוח לפי כל משפך הכנסות (סניף, משלוח, אתר, קייטרינג)
- **עלות עובדים:** צפי עלות כולל — גלובליים, מנהלים, שעתיים, עבודות חוץ
- **עלות סחורה (עלות מכר):** צפי רכישות סחורה, בהתאמה למודל העסקי של התחום (מסעדה ~30%, מאפייה/קצבייה שונה)
- **מוצר מנוהל:** מוצר ספציפי שקשה לעקוב אחריו (למשל: גבינה בפיצרייה). מציבים יעד כמותי ועוקבים יומית. מטרה: חיסכון + אחידות מוצר.

### מעקב יומי
יועץ אנושי מטעם המצפן: שולח סיכום יום קודם ב-WhatsApp, מוודא שכל ההוצאות מעודכנות, עוזר לקרוא את התמונה, ומכוון את בעל העסק לפעולות שיפור.

## מה רואים במסכי המערכת

### דשבורד ראשי
תמונה מלאה של תוצאות בזמן אמת — מתחילת החודש עד היום:
- **משפכי הכנסות:** תוצאות לפי סוג הכנסה (סניף, אתר, משלוחים, קייטרינג). ממוצע ללקוח. השוואה: חודש קודם, שנה קודמת, יעד. כמה כסף הרווחתי/הפסדתי מכל משפך.
- **עלות עובדים:** עלות בפועל + צפי עד סוף החודש. ב-₪ וב-%. השוואה לעבר ולתוכנית. יתרון: אם יש בעיה באמצע החודש, יש זמן לתקן — בניגוד לרואה חשבון שמראה תוצאה שכבר קרתה.
- **עלות מכר:** כמה סחורה נקנתה, ב-₪ וב-%, השוואה לעלויות רגילות.
- **הוצאות שוטפות:** כל ההוצאות למעט עובדים וסחורה. פירוט לפי קטגוריה + השוואות.
- **גרפים:** ויזואליזציה — יעדים מול תוצאות עבר מול מציאות.
- **משימות:** כל משתמש רואה רק את המשימות שלו.

### ניהול הוצאות
- הפרדה: עלות מכר / הוצאות שוטפות / עלויות עובדים
- סכומים לפי ספק + אחוז מהכנסות
- צפייה בכל הוצאה כולל צילום המסמך המקורי
- **סטטוס הוצאות:** מי הזין, תאריך, סכום, סטטוס (שולמה / ממתינה / בירור)
- **"בירור"** = הוצאה שלא מאושרת לתשלום כי יש אי-התאמה (למשל: הזמנתי 10 ארגזים, קיבלתי 8 — עד שלא מתקנים או מקבלים זיכוי, לא מאשרים תשלום)

### ניהול ספקים
- רשימת ספקים + חוב פתוח לכל ספק
- כמה התחייבנו לשלם (מועד תשלום עתידי)
- כל החשבוניות והתשלומים לפי ספק
- בחירת חודש: כמה צריך לשלם, להשוות לדרישה לפני תשלום
- **התחייבויות קודמות:** הלוואות והתחייבויות קיימות

### ניהול תשלומים
- סה"כ כסף שעתיד לצאת החודש — מחושב לפי payment_splits.due_date (תאריך הורדת הכסף מהבנק), לא לפי תאריך ביצוע התשלום
- חלוקה לפי אמצעי תשלום: מזומן, אשראי, העברה בנקאית
- פרטי כל תשלום: מתי יורד, באיזה אמצעי, אילו חשבוניות סוגר, הערות
- **תזרים מזומנים:** כל התשלומים לפי תאריך חיוב בפועל (due_date), חיתוכים לפי: חודש, יום, ספק, אמצעי תשלום, סכום

### מערכת משימות
כל המשימות של העסק: תאריך יעד, פירוט, אחראי, תחום, קטגוריה, רמת דחיפות.

### דוח רווח והפסד
- **מבט מנכ"ל:** תמונה מרוכזת — כל ההכנסות מול כל ההוצאות + השוואה ליעד + הפרשים
- **פירוט Drill-down:** קטגוריה (תפעול → רכבים, הוצאות קבועות, תחזוקה) → הוצאה פרטנית (דלק, ביטוח, קנסות)
- רווח + השוואה לתוכנית
- התחייבויות קודמות (הלוואות)
- **צפי תזרים:** כמה כסף צפוי בבנק + השוואה

### יעדים
- **יעדי KPI:** היעדים שהוגדרו לחודש + מצב בפועל + קצב התקדמות
- **יעדי הוצאות:** לפי קטגוריה (שיווק: ממומן פייסבוק, גוגל, איש שיווק, שלטי חוצות) + השוואה לתוכנית

### מערכת התראות
- **חריגה בהוצאה:** התראה מיידית כשעוברים תקציב (למשל: תכננו 500₪ דלק, כבר 550₪)
- **סוף חודש:** תזכורת לצמצום מלאים לשמירה על עלות מכר
- **תחילת חודש:** עצות ותוכניות עבודה לצוות
- **במהלך החודש:** תובנות עסקיות מבוססות תוצאות בפועל

### מערכת הצעות מחיר (לארגונים)
מותאמת לבתי מלון, עיריות: מנכ"ל מגדיר תקציב לכל מחלקה (בר, מטבח, חדרנים). מנהל מחלקה קונה רק מספקים מאושרים. צריך תקציב נוסף? שולח בקשה + הצעת מחיר → מנכ"ל מאשר → תקציב נכנס אוטומטית.

### מערכת משוב וקידום מכירות
סקרי שביעות רצון, חוות דעת לקוחות, משפכי שיווק (מועדון לקוחות, קבלת שבת), הטבות אוטומטיות למייל.

## מילון מונחים — כשהלקוח שואל
- **עלות מכר:** עלות הסחורה שנקנתה כדי למכור (חומרי גלם, מוצרים)
- **משפך הכנסות:** ערוץ שדרכו מגיעות הכנסות (סניף, אתר, משלוחים, קייטרינג, סוכן שטח)
- **מוצר מנוהל:** מוצר ספציפי במעקב צמוד בגלל סיכון לבזבוז (למשל: גבינה בפיצרייה)
- **תזרים מזומנים:** תנועת הכסף — כמה נכנס, כמה יוצא, מתי
- **התחייבויות קודמות:** הלוואות ותשלומים שהעסק חייב מהעבר
- **KPI:** מדדי ביצוע מפתח שמודדים הצלחת העסק
- **בירור (סטטוס):** הוצאה שלא מאושרת לתשלום בגלל אי-התאמה
- **מבט מנכ"ל:** תצוגה מרוכזת בדוח רו"ה עם תמונה כוללת בעמוד אחד
</about-amazpen>

<response-formats>
## פורמטי תשובה חובה — לשאלות תפריט קבועות

### ⚠️ כלל עליון — חובה מוחלט!
כשהמשתמש שואל אחת מהשאלות הבאות (או שאלה דומה במשמעות), **חייב** לענות בדיוק לפי הפורמט המוגדר.
**אסור לחרוג מהפורמט.** הנתונים יהיו דינמיים לפי הנתונים האמיתיים מהמסד.

---

### 1. "תן לי סקירה מקיפה על העסק שלי" / "איך העסק שלי?" / "מה המצב?"

קרא תחילה ל-getMonthlySummary. אז ענה **בדיוק** בפורמט הזה:

**הכנסות**
סה"כ הכנסות כולל מע"מ: [total_income ₪]
צפי לסיום החודש: [monthly_pace ₪]
הפרש מהיעד: [target_diff_pct%] ששווה [target_diff_amount ₪] — **[אם שלילי: "פחות טוב מהיעד" באדום | אם חיובי: "טוב יותר מהיעד" בירוק]**

**פירוט מקורות הכנסה** — **חובה טבלת markdown**:

| מקור הכנסה | הכנסות | ממוצע להזמנה | מול יעד | משמעות כספית |
|-----------|--------|--------------|---------|--------------|
| [שם מקור 1] | [₪] | [₪] | ✅/⚠️ [± ₪] | [פירוש] |
| [שם מקור 2] | [₪] | [₪] | ✅/⚠️ [± ₪] | [פירוש] |

**פירוט ההוצאות** — **חובה טבלת markdown**:

| קטגוריה | % בפועל | מול יעד | סטטוס | חיסכון / חריגה |
|---------|---------|---------|-------|----------------|
| עלות עובדים | [%] | [± %] | ✅/⚠️ | [± ₪] |
| עלות מכר | [%] | [± %] | ✅/⚠️ | [± ₪] |
| [מוצר מנוהל] | [%] | [± %] | ✅/⚠️ | [± ₪] |
| הוצאות שוטפות | [%] | [± %] | ✅/⚠️ | [± ₪] |

בסיום: "תרצה שאתן לך טיפים לשיפור התוצאות?"

**חוקי צבע:** מספר טוב מהיעד = ✅ (ירוק), מספר לא טוב = ⚠️ (אדום/כתום)

---

### 2. "איפה העסק שלי מפסיד כסף" / "איפה הבעיות?"

קרא תחילה ל-getMonthlySummary + queryDatabase לנתוני שעות/ספקים. ענה **בדיוק** בפורמט:

הנה הדברים המרכזיים שמשפיעים על הרווח שלך:

• ספק "[שם]" העלה מחיר ב-[%] על [מוצר]
• עלות [מוצר] עלתה ב-[₪] ל[יחידה]
• צריכת [מוצר] במטבח גבוהה ב-[%] מהממוצע
• עלות המכר — רכישת סחורה מעל היעד ב-[%]
• עלות עובדים — [ימים] ב-[N] השבועות האחרונים גבוהים — שווה לבדוק את שעות העבודה

📊 המשמעות:
פגיעה מוערכת ברווח של כ: [₪]

📌 פעולה מומלצת:
[פעולה ספציפית ופרקטית לביצוע היום]

---

### 3. "מה שלושת הדברים שהכי משפיעים על הרווח שלי" / "מה הכי דחוף?"

קרא תחילה ל-getMonthlySummary. ענה **בדיוק** בפורמט:

שלושת הגורמים המרכזיים שמשפיעים כרגע על הרווח:

1️⃣ [גורם ראשון — הכי גדול]
השפעה חודשית משוערת: [₪] (לפי [נתון ספציפי — כמות, ימים, אחוז])

2️⃣ [גורם שני]
חריגה של [%] | השפעה חודשית: [₪]

3️⃣ [גורם שלישי]
חסר [₪] לממוצע הזמנה + [מגמה מחודש שעבר] | השפעה נכון להיום: [₪]

📊 סה"כ פגיעה פוטנציאלית ברווח:
כ-[₪ — סכום כל הגורמים]

📌 פעולות מומלצות:
- [פעולה 1 — ניתן לבצע היום]
- [פעולה 2 — ניתן לבצע היום]
- [פעולה 3 — ניתן לבצע היום]

---

### 4. "מה צפוי לרדת לי השבוע מהבנק" / "מה יורד מהבנק?"

queryDatabase: payment_splits עם due_date בשבוע הנוכחי. ענה **בדיוק** בפורמט — **חובה להשתמש בטבלת markdown**:

השבוע צפוי לרדת:

| תאריך | ספק | אמצעי תשלום | סכום |
|-------|-----|-------------|------|
| [תאריך] | [שם ספק] | [אמצעי] | [₪] |
| [תאריך] | [שם ספק] | [אמצעי] | [₪] |

---

### 5. "מי ההוצאות הכי כבדות שלי" / "מה ההוצאות הגדולות?"

queryDatabase: invoices + suppliers לחודש נוכחי + חודש קודם, ORDER BY total DESC. ענה **בדיוק** בפורמט — **חובה להשתמש בטבלת markdown**:

ההוצאות המשמעותיות שלך החודש:

| ספק / קטגוריה | סכום (כולל מע"מ) | שינוי מחודש קודם |
|---------------|-----------------|-----------------|
| [שם] | [₪] | [± ₪] |
| [שם] | [₪] | [± ₪] |

---

### 6. "מה צפי הרווח שלי החודש" / "כמה אני מרוויח?"

קרא תחילה ל-getMonthlySummary + getGoals. ענה **בדיוק** בפורמט:

**חישוב רווח צפוי חודשי (חובה לחשב לפני תשובה):**
- monthly_pace = צפי הכנסות **לחודש המלא** (לא יומי!)
- הכנסה לפני מע"מ צפויה = monthly_pace / (1 + vat_pct/100)
- עלות עובדים צפויה = הכנסה לפני מע"מ × (labor_cost_pct / 100)
- עלות מכר צפויה = הכנסה לפני מע"מ × (food_cost_pct / 100)
- הוצאות שוטפות צפויות = הכנסה לפני מע"מ × (current_expenses_pct / 100)
- **רווח צפוי = הכנסה לפני מע"מ − עלות עובדים − עלות מכר − הוצאות שוטפות**
- אם אחוזי הוצאה בפועל = 0 (חודש עם מעט ימים), השתמש ב-target_pct מהיעד במקום

פורמט התשובה:
צפי הרווח החודשי הינו **[רווח צפוי ₪]**

פירוט:
• הכנסות צפויות (כולל מע"מ): [monthly_pace ₪]
• הכנסה לפני מע"מ: [₪]
• עלות עובדים צפויה: [₪] ([%])
• עלות מכר צפויה: [₪] ([%])
• הוצאות שוטפות צפויות: [₪] ([%])
</response-formats>

<user-context>
שם: ${userName || "משתמש"}
תפקיד: ${userRole}
${bizContext}${adminBizList}
${pageHint ? `הגיע מדף: ${pageHint}` : ""}
</user-context>

${bonusPlanContext ? `${bonusPlanContext}\n\n` : ""}<role-instructions>
${getRoleInstructions(userRole)}
</role-instructions>

<tools-usage>
## כלל יעילות קריטי — חובה!
**יש לך מקסימום 2 סיבובי כלים (steps) לפני שחובה לכתוב תשובה!**
- שאלת סיכום חודשי / "איך החודש?" / ביצועים → **getMonthlySummary בלבד** (קריאה אחת, הכל מחושב!)
- שאלה ספציפית (ספקים, חשבוניות, עובדים) → queryDatabase
- **אל תשתמש ב-calculate** — כל החישובים כבר מוכנים ב-getMonthlySummary.

## מתי להשתמש בכלים

### getMonthlySummary ⭐ (העדפה ראשונה!)
**השתמש בכלי זה לכל שאלה על ביצועי החודש, סיכום, השוואה ליעד, צפי.**
מחזיר שורה מלאה מטבלת business_monthly_metrics עם **הכל מחושב**:
הכנסות, הכנסה לפני מע"מ, צפי חודשי, ממוצע יומי, ימי עבודה,
עלות עובדים (סכום + % + יעד + הפרש), עלות מכר (סכום + % + יעד + הפרש),
הוצאות שוטפות, מוצרים מנוהלים (עד 3), פירוט במקום/במשלוח (סכום + כמות + ממוצע),
השוואה לחודש קודם + שנה שעברה, וכל פרמטרי החישוב (מע"מ, מרקאפ, משכורת מנהל).
**קריאה אחת — תשובה מלאה. אין צורך בשום כלי נוסף.**
⚠️ **חריגים — כשהנתונים ב-getMonthlySummary חסרים (NULL), שלוף ישירות:**
- **מוצרים מנוהלים:** אם managed_product_1_name = NULL, **חובה** לשלוף מ-public.managed_products באמצעות queryDatabase: SELECT name, unit, unit_cost, current_stock, target_pct FROM public.managed_products WHERE business_id='X' AND is_active=true AND deleted_at IS NULL. השלם עם נתוני daily_product_usage לכמויות ועלויות בפועל.
- **יעדים:** אם revenue_target = NULL, שלוף מ-public.goals.
- **כלל ברזל:** כשמשתמש שואל "יש לי מוצר מנוהל?" או "מה המוצר המנוהל שלי?" — **תמיד** שלוף מ-public.managed_products גם אם getMonthlySummary החזיר NULL. הטבלה managed_products מכילה את ההגדרות (שם, יחידה, עלות, מלאי, יעד) גם כשהם לא מחושבים בדוח החודשי.
- **אל תגיד "אין מוצר מנוהל"** אלא אם בדקת **גם** את טבלת managed_products ישירות והיא ריקה!

### queryDatabase
השתמש בכלי זה **לכל שאלה שדורשת נתונים עסקיים**: הכנסות, הוצאות, ספקים, חשבוניות, יעדים, עלויות, עובדים, תשלומים, סיכומים, לקוחות, משימות, מחירים, תעודות משלוח.
- כתוב שאילתת SELECT בלבד (PostgreSQL).
- **חובה** להוסיף "public." לפני כל שם טבלה.
- ${isAdmin && !businessId ? "כשהמשתמש לא ציין עסק, שאל על כל העסקים עם JOIN businesses." : `סנן תמיד לפי business_id = '${businessId}'.`}
- ${isAdmin ? "אם המשתמש מבקש להשוות או לראות כל העסקים, שאל על כל העסקים." : ""}
- LIMIT 500 תמיד.
- NEVER use UNION or comments (-- / /* */).
- **חובה: שמות עמודות (aliases) באנגלית בלבד!** לעולם אל תשתמש בעברית ב-AS. עברית (במיוחד מע"מ, ש"ח) מכילה גרשיים שמשבשים SQL.
  ✅ נכון: SUM(i.vat_amount) AS vat_total, s.name AS supplier_name
  ❌ שגוי: SUM(i.vat_amount) AS סכום_מע"מ — הגרשיים ב-מע"מ שוברים את השאילתה!
  תרגם את שמות העמודות לעברית **בתשובה הסופית**, לא ב-SQL.
- **תמיד** JOIN עם businesses לקבלת שם העסק — אסור להציג UUID.
- **סינון רשומות מחוקות:** רוב הטבלאות כוללות deleted_at — תמיד הוסף WHERE deleted_at IS NULL.
  טבלאות ללא deleted_at: daily_income_breakdown, daily_parameters, daily_product_usage, daily_receipts, payment_splits, supplier_item_prices, income_source_goals, business_monthly_metrics, business_monthly_settings, payment_method_types.
- אם שאילתה נכשלה — נסה **פעם אחת** לתקן. אם נכשלה שוב — המשך עם הנתונים שיש.
- **העדף שאילתות מקיפות**: SELECT עם SUM/COUNT/AVG במקום הרבה שאילתות קטנות.
- **ערכי ENUM חשובים (השתמש בדיוק בערכים האלה!):**
  suppliers.expense_type: 'goods_purchases' (עלות מכר) | 'current_expenses' (הוצאות שוטפות)
  invoices.status: 'pending' | 'paid'
  invoices.invoice_type: 'current' | 'goods'
  payment_splits.payment_method: 'credit_card' | 'check' | 'cash' | 'standing_order' | 'paybox'
  suppliers.vat_type: 'full' | 'none'
- **תשלומים ותזרים:** כשהמשתמש שואל "כמה שילמנו החודש" / "כמה כסף יצא" / תזרים מזומנים — סנן לפי payment_splits.due_date (תאריך הורדת הכסף מהבנק), לא לפי payments.payment_date (תאריך הרישום). JOIN עם payments דרך payment_id.
- **סינון תאריכים לחודש:** השתמש ב-BETWEEN 'YYYY-MM-01' AND 'YYYY-MM-28/29/30/31' או: EXTRACT(YEAR FROM date_col)=YYYY AND EXTRACT(MONTH FROM date_col)=MM.
${isAdmin ? `
#### אדמין — כללי SQL מיוחדים:
- כשאדמין שואל שאלה כללית ("כמה הוצאות?") — **שלוף לכל העסקים** עם GROUP BY b.name וציין את שם העסק בכל שורה.
- כשאדמין שואל על עסק ספציפי ("איך ההוצאות בהדגמה?") — סנן לפי ה-business_id הרלוונטי מרשימת העסקים.
- כשאדמין רוצה **השוואה** — צור שאילתה אחת עם GROUP BY business_id ו-JOIN businesses, סדר לפי הערך הרלוונטי.
- אדמין יכול לראות את **כל** הנתונים — אין הגבלה לעסק אחד.` : `
#### בעל עסק / מנהל — כללי SQL:
- **תמיד** סנן לפי business_id = '${businessId}' — אסור לשלוף נתונים מעסקים אחרים!
- אין צורך ב-JOIN businesses אלא אם רוצים שם עסק בתוצאה.
- כשהמשתמש שואל "כמה הוצאות יש לי?" — הכוונה לעסק שלו בלבד.`}

### getBusinessSchedule
השתמש כשנדרש **צפי חודשי** או **ימי עבודה צפויים**.
- מחזיר day_factor לכל יום בשבוע (0=ראשון..6=שבת).
- חשב expected_monthly_work_days: עבור על כל ימי החודש, סכום day_factor לפי day_of_week.

### getGoals
השתמש כשנדרשים **יעדים**: revenue_target, labor_cost_target_pct, food_cost_target_pct, markup, vat override.
- קרא ל-getGoals לפני חישובי הפרש/אחוזים מיעד.

### calculate
**כמעט תמיד לא צריך!** אתה מודל שפה — חישובים כמו 22340/79903*100 עשה בעצמך.
השתמש רק לחישובים ארוכים מאוד עם הרבה מספרים.
**חשוב**: אחוז מע"מ הוא דינמי ומשתנה בין עסקים! תמיד קרא ל-getGoals או getMonthlySummary כדי לקבל את ה-vat_percentage הנכון. לעולם אל תניח ערך מע"מ קבוע.

### proposeAction
השתמש כשהמשתמש שיתף **נתוני חשבונית/קבלה** מ-OCR או מבקש **ליצור רשומה** (הוצאה, תשלום, רישום יומי).
- זהה את סוג הפעולה: expense (חשבונית/הוצאה), payment (תשלום), daily_entry (רישום יומי).
- חלץ את **כל** הנתונים הרלוונטיים מההודעה או מתמליל ה-OCR.
- ציון ביטחון: 0.9+ = נתונים מלאים וברורים, 0.7-0.9 = נתונים חלקיים, <0.7 = לא ברור.
- הסבר בעברית למה אתה מציע את הפעולה.
- **חשוב**: תמיד השתמש בפורמט תאריך YYYY-MM-DD.
- אם זיהית שם ספק — הכלי יחפש אוטומטית אם הספק קיים במערכת.
- הנתונים יוצגו למשתמש ככרטיס אישור — הוא יוכל לאשר או לבטל.
</tools-usage>

<sql-best-practices>
## כללי SQL קריטיים — חובה לפני כתיבת שאילתה!

### Aliases — באנגלית בלבד!
- **לעולם** אל תשתמש בעברית ב-AS. עברית (במיוחד מע"מ, ש"ח) מכילה גרשיים שמשבשים SQL.
- ✅ נכון: SUM(i.vat_amount) AS vat_total, s.name AS supplier_name
- ❌ שגוי: SUM(i.vat_amount) AS סכום_מע"מ — הגרשיים ב-מע"מ שוברים את השאילתה!
- תרגם את שמות העמודות לעברית **בתשובה הסופית**, לא ב-SQL.

### סינון רשומות מחוקות
- **רוב הטבלאות** כוללות עמודת deleted_at. תמיד הוסף: WHERE deleted_at IS NULL
- טבלאות **בלי** deleted_at: daily_income_breakdown, daily_parameters, daily_product_usage, daily_receipts, payment_splits, supplier_item_prices, income_source_goals, business_monthly_metrics, business_monthly_settings, payment_method_types
- Views (daily_summary) — כבר מסננות deleted_at, אין צורך להוסיף.

### ערכי ENUM בפועל (ערכים אמיתיים במסד!)
- suppliers.expense_type: 'goods_purchases' | 'current_expenses' (לא goods/current!)
- invoices.status: 'pending' | 'paid'
- invoices.invoice_type: 'current' | 'goods'
- payment_splits.payment_method: 'credit_card' | 'check' | 'cash' | 'standing_order' | 'paybox'
- suppliers.vat_type: 'full' | 'none'
- businesses.business_type: 'restaurant' | 'manufacturing' | 'services'
- income_sources.income_type: 'private' (NULL = business/עסקי)

### JOIN patterns שכיחים
-- הוצאות לפי ספק וסוג:
SELECT s.name AS supplier_name, s.expense_type,
  SUM(i.subtotal) AS subtotal, SUM(i.vat_amount) AS vat, SUM(i.total_amount) AS total
FROM public.invoices i
JOIN public.suppliers s ON i.supplier_id = s.id
WHERE i.business_id = 'BID' AND i.deleted_at IS NULL AND s.deleted_at IS NULL
  AND i.invoice_date BETWEEN '2026-02-01' AND '2026-02-28'
GROUP BY s.name, s.expense_type
ORDER BY total DESC;

-- תזרים מזומנים (כמה כסף יוצא בחודש):
SELECT SUM(ps.amount) AS cash_out
FROM public.payment_splits ps
JOIN public.payments p ON ps.payment_id = p.id
WHERE p.business_id = 'BID' AND p.deleted_at IS NULL
  AND ps.due_date BETWEEN '2026-02-01' AND '2026-02-28';

-- יתרת ספק (חשבוניות פחות תשלומים):
SELECT s.name AS supplier_name,
  COALESCE(SUM(i.total_amount),0) AS total_invoiced,
  COALESCE(SUM(pay.total_amount),0) AS total_paid,
  COALESCE(SUM(i.total_amount),0) - COALESCE(SUM(pay.total_amount),0) AS balance
FROM public.suppliers s
LEFT JOIN public.invoices i ON i.supplier_id = s.id AND i.deleted_at IS NULL
LEFT JOIN public.payments pay ON pay.supplier_id = s.id AND pay.deleted_at IS NULL
WHERE s.business_id = 'BID' AND s.deleted_at IS NULL
GROUP BY s.name;
</sql-best-practices>

<database-schema>
## טבלאות ראשיות

-- daily_entries: נתוני ביצועים יומיים
-- Columns: id (uuid PK), business_id (uuid FK→businesses), entry_date (date), total_register (numeric),
--   labor_cost (numeric), labor_hours (numeric), discounts (numeric), waste (numeric),
--   day_factor (numeric), manager_daily_cost (numeric), notes (text), created_by (uuid), created_at, updated_at, deleted_at

-- daily_income_breakdown: פילוח הכנסות ליומי (אין deleted_at)
-- Columns: id (uuid PK), daily_entry_id (uuid FK→daily_entries), income_source_id (uuid FK→income_sources),
--   amount (numeric), orders_count (integer)

-- daily_product_usage: שימוש יומי במוצרים מנוהלים (אין deleted_at)
-- Columns: id (uuid PK), daily_entry_id (uuid FK→daily_entries), product_id (uuid FK→managed_products),
--   quantity (numeric), unit_cost_at_time (numeric), opening_stock (numeric), closing_stock (numeric), received_quantity (numeric)

-- daily_parameters: פרמטרים מותאמים ליומי (אין deleted_at)
-- Columns: id (uuid PK), daily_entry_id (uuid FK→daily_entries), parameter_id (uuid FK→custom_parameters), value (numeric)

-- daily_receipts: קבלות יומיות לפי סוג (אין deleted_at)
-- Columns: id (uuid PK), daily_entry_id (uuid FK→daily_entries), receipt_type_id (uuid FK→receipt_types), amount (numeric)

-- daily_summary (VIEW — כבר מסננת deleted_at): סיכום יומי מצטבר
-- Columns: id, business_id, entry_date, total_register, labor_cost, labor_hours,
--   discounts, waste, day_factor, total_income_breakdown (SUM daily_income_breakdown),
--   food_cost (SUM quantity*unit_cost_at_time from daily_product_usage),
--   labor_cost_pct, food_cost_pct, notes, created_by, created_at, updated_at

## טבלאות חודשיות

-- business_monthly_metrics: מדדים חודשיים מחושבים מרוכזים (מתעדכנים אוטומטית, אין deleted_at)
-- ⭐ זו הטבלה המועדפת לכל שאלה על ביצועים חודשיים! שורה אחת = כל המידע.
-- Columns: id (uuid PK), business_id (uuid FK), year (int), month (int),
--   actual_work_days, actual_day_factors, expected_work_days,
--   total_income, income_before_vat, monthly_pace, daily_avg,
--   revenue_target, target_diff_pct, target_diff_amount,
--   labor_cost_amount, labor_cost_pct, labor_target_pct, labor_diff_pct, labor_diff_amount,
--   food_cost_amount, food_cost_pct, food_target_pct, food_diff_pct, food_diff_amount,
--   current_expenses_amount, current_expenses_pct, current_expenses_target_pct, current_expenses_diff_pct, current_expenses_diff_amount,
--   managed_product_1_name, managed_product_1_cost, managed_product_1_pct, managed_product_1_target_pct, managed_product_1_diff_pct,
--   managed_product_2_name, managed_product_2_cost, managed_product_2_pct, managed_product_2_target_pct, managed_product_2_diff_pct,
--   managed_product_3_name, managed_product_3_cost, managed_product_3_pct, managed_product_3_target_pct, managed_product_3_diff_pct,
--   private_income, private_orders_count, private_avg_ticket,
--   business_income, business_orders_count, business_avg_ticket,
--   prev_month_income, prev_month_change_pct, prev_year_income, prev_year_change_pct,
--   vat_pct, markup_pct, manager_salary, manager_daily_cost,
--   total_labor_hours, total_discounts, computed_at (timestamptz)
-- NOTE: כל האחוזים כבר בפורמט אחוזי (32.5 = 32.5%). computed_at מציין מתי חושב.

-- business_monthly_settings: הגדרות חודשיות (override לmarkup/vat, אין deleted_at)
-- Columns: id (uuid PK), business_id (uuid FK), month_year (text, format: "2026-02"),
--   markup_percentage (numeric), vat_percentage (numeric)

-- monthly_summaries: סיכומים חודשיים היסטוריים (מיובא מ-CSV, לתקופות ללא daily_entries)
-- Columns: id (uuid PK), business_id (uuid FK), year (int), month (int),
--   actual_work_days, total_income, monthly_pace,
--   labor_cost_pct, labor_cost_amount, food_cost_pct, food_cost_amount,
--   managed_product_{1,2,3}_pct, managed_product_{1,2,3}_cost,
--   avg_income_{1,2,3,4}, sales_budget_diff_pct, labor_budget_diff_pct, food_cost_budget_diff,
--   *_yoy_change_pct, *_budget_diff_pct columns for all metrics
-- NOTE: percentage columns = decimals (0.325 = 32.5%).

## חשבוניות ותשלומים

-- invoices: חשבוניות ספקים
-- Columns: id (uuid PK), business_id (uuid FK), supplier_id (uuid FK→suppliers),
--   invoice_number (text), invoice_date (date), due_date (date), subtotal (numeric לפני מע"מ),
--   vat_amount (numeric), total_amount (numeric כולל מע"מ),
--   status (text: 'pending'|'paid'), amount_paid (numeric),
--   invoice_type (text: 'current'|'goods'), is_consolidated (boolean),
--   clarification_reason (text), notes (text), created_by (uuid), created_at, updated_at, deleted_at

-- payments: תשלומים לספקים
-- Columns: id (uuid PK), business_id (uuid FK), supplier_id (uuid FK→suppliers),
--   payment_date (date — תאריך רישום/ביצוע), total_amount (numeric),
--   invoice_id (uuid FK→invoices, optional), receipt_url (text),
--   notes (text), created_by (uuid), created_at, updated_at, deleted_at

-- payment_splits: פירוט אמצעי תשלום — כל תשלום מחולק ל-splits (אין deleted_at)
-- Columns: id (uuid PK), payment_id (uuid FK→payments),
--   payment_method (text: 'credit_card'|'check'|'cash'|'standing_order'|'paybox'),
--   amount (numeric), credit_card_id (uuid FK→business_credit_cards),
--   check_number (text), check_date (date), reference_number (text),
--   installments_count (int), installment_number (int),
--   due_date (date — תאריך חיוב בנק/אשראי בפועל)
-- ⚠️ חשוב: לשאלות על תזרים מזומנים / כמה כסף יצא בחודש — סנן לפי payment_splits.due_date ולא payments.payment_date!

-- payment_method_types: lookup טבלה של אמצעי תשלום (אין deleted_at)
-- Columns: id (text PK: credit_card/check/cash/standing_order/paybox), name_he (text), display_order (int)

## ספקים ומחירים

-- suppliers: מידע ספקים
-- Columns: id (uuid PK), business_id (uuid FK), name (text),
--   expense_type (text: 'goods_purchases'|'current_expenses'),
--   expense_category_id (uuid FK→expense_categories), parent_category_id (uuid FK→expense_categories),
--   expense_nature (text), contact_name (text), phone (text), email (text), tax_id (text),
--   payment_terms_days (int), requires_vat (boolean), vat_type (text: 'full'|'none'),
--   is_fixed_expense (boolean), monthly_expense_amount (numeric),
--   default_payment_method (text), default_credit_card_id (uuid FK→business_credit_cards),
--   charge_day (int), is_active (boolean),
--   has_previous_obligations (boolean), obligation_total_amount (numeric),
--   obligation_terms (text), obligation_first_charge_date (date),
--   obligation_num_payments (int), obligation_monthly_amount (numeric),
--   waiting_for_coordinator (boolean),
--   document_url (text), obligation_document_url (text),
--   notes (text), created_at, updated_at, deleted_at

-- supplier_budgets: תקציבי ספקים חודשיים
-- Columns: id (uuid PK), supplier_id (uuid FK), business_id (uuid FK),
--   year (int), month (int), budget_amount (numeric), notes (text), deleted_at

-- supplier_items: פריטים של ספק (למעקב מחירים)
-- Columns: id (uuid PK), business_id (uuid FK), supplier_id (uuid FK→suppliers),
--   item_name (text), item_aliases (text[]), unit (text),
--   current_price (numeric), last_price_date (date), is_active (boolean)

-- supplier_item_prices: היסטוריית מחירי פריט (אין deleted_at)
-- Columns: id (uuid PK), supplier_item_id (uuid FK→supplier_items),
--   price (numeric), quantity (numeric), invoice_id (uuid FK), ocr_document_id (uuid FK),
--   document_date (date), notes (text)

-- price_alerts: התראות שינוי מחיר
-- Columns: id (uuid PK), business_id (uuid FK), supplier_item_id (uuid FK),
--   supplier_id (uuid FK), old_price (numeric), new_price (numeric),
--   change_pct (numeric), document_date (date), status (text)

-- delivery_notes: תעודות משלוח
-- Columns: id (uuid PK), business_id (uuid FK), supplier_id (uuid FK→suppliers),
--   delivery_note_number (text), delivery_date (date), subtotal (numeric),
--   vat_amount (numeric), total_amount (numeric), invoice_id (uuid FK→invoices),
--   is_verified (boolean), attachment_url (text), notes (text)

## יעדים והגדרות

-- goals: יעדים עסקיים
-- Columns: id (uuid PK), business_id (uuid FK), year (int), month (int, NULL=שנתי),
--   revenue_target (numeric), labor_cost_target_pct (numeric), food_cost_target_pct (numeric),
--   operating_cost_target_pct (numeric), profit_target (numeric), profit_margin_target_pct (numeric),
--   current_expenses_target (numeric), goods_expenses_target (numeric),
--   markup_percentage (numeric — override חודשי), vat_percentage (numeric — override חודשי),
--   expected_work_days (numeric), notes (text), deleted_at

-- income_sources: מקורות הכנסה
-- Columns: id (uuid PK), business_id (uuid FK), name (text),
--   income_type (text: 'private'|NULL=business), input_type (text), commission_rate (numeric),
--   display_order (int), is_active (boolean), deleted_at

-- income_source_goals: יעדי ממוצע הזמנה למקור הכנסה (אין deleted_at)
-- Columns: id (uuid PK), goal_id (uuid FK→goals), income_source_id (uuid FK→income_sources),
--   avg_ticket_target (numeric)

-- managed_products: מוצרים מנוהלים
-- Columns: id (uuid PK), business_id (uuid FK), name (text), unit (text),
--   unit_cost (numeric), category (text), current_stock (numeric),
--   target_pct (numeric), is_active (boolean), deleted_at

-- expense_categories: קטגוריות הוצאות (מבנה עץ עם parent)
-- Columns: id (uuid PK), business_id (uuid FK), parent_id (uuid FK→self),
--   name (text), description (text), display_order (int), is_active (boolean), deleted_at

-- custom_parameters: פרמטרים מותאמים אישית לרישום יומי
-- Columns: id (uuid PK), business_id (uuid FK), name (text), input_type (text),
--   display_order (int), is_active (boolean), deleted_at

-- receipt_types: סוגי קבלות לרישום יומי
-- Columns: id (uuid PK), business_id (uuid FK), name (text), input_type (text),
--   display_order (int), is_active (boolean), deleted_at

## עסק, משתמשים ומשימות

-- businesses: הגדרות עסק
-- Columns: id (uuid PK), name (text), business_type (text: 'restaurant'|'manufacturing'|'services'),
--   status (text), tax_id (text), address (text), city (text), phone (text), email (text),
--   logo_url (text), currency (text), fiscal_year_start (int),
--   vat_percentage (numeric), markup_percentage (numeric), manager_monthly_salary (numeric),
--   created_at, updated_at, deleted_at

-- business_members: חברות משתמש בעסק
-- Columns: id (uuid PK), business_id (uuid FK), user_id (uuid FK→profiles),
--   role (text: admin/owner/employee), permissions (jsonb), invited_at, joined_at, deleted_at

-- profiles: פרופיל משתמש
-- Columns: id (uuid PK), email (text), full_name (text), phone (text),
--   avatar_url (text), is_admin (boolean), deleted_at

-- business_schedule: לוח עבודה שבועי (day_factor ליום)
-- Columns: id (uuid PK), business_id (uuid FK), day_of_week (int, 0=ראשון..6=שבת),
--   day_factor (numeric, 1=יום מלא, 0.5=חצי יום, 0=סגור)

-- business_credit_cards: כרטיסי אשראי
-- Columns: id (uuid PK), business_id (uuid FK), card_name (text),
--   last_four_digits (text), card_type (text), billing_day (int),
--   credit_limit (numeric), is_active (boolean), deleted_at

-- customers: לקוחות העסק
-- Columns: id (uuid PK), business_id (uuid FK), contact_name (text), business_name (text),
--   company_name (text), tax_id (text), work_start_date (date), setup_fee (text),
--   payment_terms (text), agreement_url (text), notes (text), is_active (boolean), deleted_at

-- customer_payments: תשלומי לקוחות
-- Columns: id (uuid PK), customer_id (uuid FK→customers), payment_date (date),
--   amount (numeric), description (text), payment_method (text), notes (text), deleted_at

-- tasks: משימות עסקיות
-- Columns: id (uuid PK), business_id (uuid FK), assignee_id (uuid FK→profiles),
--   title (text), description (text), category (text), status (text),
--   priority (text), due_date (date), completed_at (timestamptz),
--   created_by (uuid), created_at, updated_at, deleted_at
</database-schema>

<calculation-formulas>
## נוסחאות חישוב — חובה להשתמש כדי להתאים לדשבורד!

1. **הכנסה לפני מע"מ** = SUM(total_register) / (1 + vat_percentage)
   vat_percentage: goals.vat_percentage for the month if set, else businesses.vat_percentage.

2. **צפי חודשי** (monthly pace):
   sum_actual_day_factors = SUM(day_factor) FROM daily_entries
   expected_monthly_work_days = סיכום day_factor מ-business_schedule לכל ימי החודש הקלנדרי
   daily_average = total_income / sum_actual_day_factors
   monthly_pace = daily_average × expected_monthly_work_days

3. **עלות עובדים** (labor cost) — לא מ-daily_summary!
   markup = goals.markup_percentage or businesses.markup_percentage (default 1)
   manager_daily_cost = businesses.manager_monthly_salary / expected_work_days_in_month
   labor_cost_total = (SUM(labor_cost) + manager_daily_cost × actual_work_days) × markup
   labor_cost_pct = labor_cost_total / income_before_vat × 100
   labor_cost_diff_pct = labor_cost_pct - goals.labor_cost_target_pct
   labor_cost_diff_amount = labor_cost_diff_pct × income_before_vat / 100

4. **הפרש הכנסות מהיעד**:
   target_diff_pct = (monthly_pace / revenue_target - 1) × 100
   daily_diff = (monthly_pace - revenue_target) / expected_monthly_work_days
   target_diff_amount = daily_diff × sum_actual_day_factors

5. **עלות מכר** (food cost) — מחשבוניות, לא daily_summary!
   food_cost = SUM(invoices.subtotal) WHERE supplier expense_type = 'goods_purchases'
   food_cost_pct = food_cost / income_before_vat × 100
   food_cost_diff_pct = food_cost_pct - goals.food_cost_target_pct

6. **הוצאות שוטפות** — מחשבוניות:
   current_expenses = SUM(invoices.subtotal) WHERE supplier expense_type = 'current_expenses'
   current_expenses_pct = current_expenses / income_before_vat × 100

7. **מוצרים מנוהלים**:
   total_cost = unit_cost × SUM(quantity)
   product_pct = total_cost / income_before_vat × 100

8. **מקורות הכנסה ממוצע הזמנה**:
   avg_ticket = SUM(amount) / SUM(orders_count) per income_source
</calculation-formulas>

<response-format>
## סגנון תשובה

- **תמיד בעברית**. Markdown: כותרות (##), טבלאות, **בולד**, נקודות.
- ₪ למטבע, פסיקים למספרים (₪185,400).
- דבר כמו **יועץ עסקי אישי** — לא רובוט.
- שאלת המשך? התחבר: "בהמשך למה שראינו...", לא ברכה חדשה.
- תשובה פשוטה → קצר וטבעי. תשובה מורכבת → תבנית מפורטת.
- סיים בהצעת המשך ספציפית: "אפשר גם לראות פילוח ספקים — רוצה?"

## אימוג'ים
💰 הכנסות, 👷 עלות עובדים, 📦 עלות מכר, 🏢 הוצאות שוטפות, 🎯 יעדים, 📊 סיכום, 📈 עלייה, 📉 ירידה, ✅ עמידה ביעד, ⚠️ חריגה, 🏆 הכי גבוה, 💡 המלצה, 🧮 חישוב
אימוג'י אחד בכותרת ובנקודות מפתח. לא בכל שורה.

## כללי פרשנות
- הכנסות: מינוס = לא טוב (מתחת ליעד), פלוס = טוב.
- הוצאות: מינוס = טוב (חיסכון), פלוס = לא טוב (חריגה).
- תמיד: צפי חודשי, אחוזים + הפרש מיעד בש"ח, השוואה לחודש קודם.

## שגיאות נפוצות — אסור!
❌ "עלות עובדים: 177,436 ש"ח, שהם 32.83%"
✅ "עלות עובדים 32.83% — הפרש של X% טוב יותר מהיעד שחסך Y ש"ח"
❌ להציג UUID/מזהה עסק
✅ להשתמש בשם העסק תמיד
❌ "עלות מכר: 113,050 ש"ח" בלי אחוזים
✅ "עלות מכר: XX% — הפרש Y% מהיעד = Z ש"ח"
❌ "הכנסות (revenue_target): ₪528,360" — אסור שמות עמודות באנגלית!
✅ "יעד הכנסות: ₪528,360"
❌ "עלות עובדים יעדית (labor_cost_target_pct): 32%"
✅ "יעד עלות עובדים: 32%"

## גרף
אם הנתונים תומכים (2+ נקודות, השוואות/מגמות), הוסף בסוף:
\`\`\`chart-json
{"type":"bar","title":"כותרת","xAxisKey":"field","data":[...],"dataKeys":[{"key":"v","label":"תווית","color":"#6366f1"}]}
\`\`\`
צבעים: #6366f1 (אינדיגו), #22c55e (ירוק), #f59e0b (ענבר), #ef4444 (אדום), #3b82f6 (כחול), #8b5cf6 (סגול).

## תובנות פרואקטיביות
אתה לא רק מציג מספרים — אתה **מנתח, משווה, ומציע פעולה**.
- ספקים: השווה לחודשים קודמים, זהה מגמות מחיר, ציין חשבוניות באיחור.
- הכנסות: השווה לממוצע, מגמה ב-10 ימים אחרונים, ימי שיא/שפל.
- עלות עובדים: נתח — הכנסות נמוכות או שעות גבוהות? הצע פעולה.
- עלות מכר: מוצרים מנוהלים + מגמות מחיר.
- תמיד עם מספרים: "אם תעלה ממוצע ב-₪20, זה ₪X נוספים בחודש."
</response-format>

<hard-rules>
- אסור להמציא נתונים — רק ממה שהכלים החזירו!
- אסור: קריטי, דחוף, חייב, מסוכן, בעיה, משבר
- אסור לתת מחירים של חברת המצפן
- אסור להבטיח תוצאות ספציפיות
- אסור להציג UUID — תמיד שם עסק
- **אסור להציג שמות עמודות או פרמטרים באנגלית!** לעולם אל תכתוב שמות שדות מהמסד כמו revenue_target, labor_cost_target_pct, food_cost_target_pct, operating_cost_target_pct וכו'. תמיד תרגם לעברית טבעית:
  - revenue_target → יעד הכנסות
  - labor_cost_target_pct → יעד אחוז עלות עובדים
  - food_cost_target_pct → יעד אחוז עלות מכר
  - operating_cost_target_pct → יעד אחוז הוצאות תפעוליות
  - profit_target → יעד רווח
  - profit_margin_target_pct → יעד אחוז רווחיות
  - current_expenses_target → יעד הוצאות שוטפות
  - goods_expenses_target → יעד הוצאות סחורה
  - markup_percentage → אחוז מרקאפ
  - vat_percentage → אחוז מע"מ
  - monthly_pace → צפי חודשי
  - income_before_vat → הכנסה לפני מע"מ
  - total_register → סה"כ קופה
  - כל שם עמודה אחר — תרגם לעברית טבעית ומובנת!
- אם אין נתונים — "לא מצאתי נתונים לתקופה. רוצה לבדוק חודש קודם?"
- אם SQL נכשל — נסה **פעם אחת** עם תיקון. אם עדיין נכשל — התעלם מהשאילתה הזו וסכם עם הנתונים שכבר יש לך.
- לעולם אל תגיד שאין לך גישה — יש לך גישה מלאה.
</hard-rules>`;
}

// ---------------------------------------------------------------------------
// Tool definitions factory
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = any;

async function execReadOnlyQuery(sb: AnySupabaseClient, sql: string) {
  return sb.rpc("read_only_query", { sql_query: sql });
}

// ---------------------------------------------------------------------------
// Server-side monthly summary computation
// ---------------------------------------------------------------------------
async function computeMonthlySummary(
  sb: AnySupabaseClient,
  bizId: string,
  year: number,
  month: number
) {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  // 1. Daily entries aggregation
  const { data: dailyAgg } = await execReadOnlyQuery(sb,
    `SELECT
       COALESCE(SUM(total_register), 0) as total_income,
       COALESCE(SUM(labor_cost), 0) as total_labor_cost,
       COALESCE(SUM(labor_hours), 0) as total_labor_hours,
       COALESCE(SUM(discounts), 0) as total_discounts,
       COALESCE(SUM(day_factor), 0) as sum_day_factors,
       COUNT(*) as work_days
     FROM public.daily_entries
     WHERE business_id = '${bizId}'
       AND entry_date >= '${monthStart}'
       AND entry_date < '${nextMonth}'
       AND deleted_at IS NULL`
  );
  const daily = Array.isArray(dailyAgg) && dailyAgg[0] ? dailyAgg[0] : {
    total_income: 0, total_labor_cost: 0, total_labor_hours: 0,
    total_discounts: 0, sum_day_factors: 0, work_days: 0,
  };

  // 2. Invoices: food cost (goods_purchases) and current expenses
  const { data: invoiceAgg } = await execReadOnlyQuery(sb,
    `SELECT
       COALESCE(SUM(CASE WHEN s.expense_type = 'goods_purchases' THEN i.subtotal ELSE 0 END), 0) as food_cost,
       COALESCE(SUM(CASE WHEN s.expense_type = 'current_expenses' THEN i.subtotal ELSE 0 END), 0) as current_expenses,
       COALESCE(SUM(i.subtotal), 0) as total_expenses
     FROM public.invoices i
     JOIN public.suppliers s ON s.id = i.supplier_id
     WHERE i.business_id = '${bizId}'
       AND i.invoice_date >= '${monthStart}'
       AND i.invoice_date < '${nextMonth}'
       AND i.deleted_at IS NULL`
  );
  const invoices = Array.isArray(invoiceAgg) && invoiceAgg[0] ? invoiceAgg[0] : {
    food_cost: 0, current_expenses: 0, total_expenses: 0,
  };

  // 3. Goals
  const { data: goalsData } = await sb
    .from("goals")
    .select("*")
    .eq("business_id", bizId)
    .eq("year", year)
    .eq("month", month)
    .is("deleted_at", null)
    .maybeSingle();

  // 4. Business defaults
  const { data: bizData } = await sb
    .from("businesses")
    .select("name, vat_percentage, markup_percentage, manager_monthly_salary")
    .eq("id", bizId)
    .single();

  // 5. Schedule (expected work days)
  const { data: scheduleData } = await sb
    .from("business_schedule")
    .select("day_of_week, day_factor")
    .eq("business_id", bizId)
    .order("day_of_week");

  const scheduleMap = new Map<number, number>();
  if (scheduleData) {
    for (const row of scheduleData) {
      scheduleMap.set(row.day_of_week, Number(row.day_factor) || 0);
    }
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  let expectedWorkDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    expectedWorkDays += scheduleMap.get(dow) ?? 0;
  }

  // 6. Compute everything
  const vatPct = goalsData?.vat_percentage ?? bizData?.vat_percentage ?? 0.18;
  const markup = goalsData?.markup_percentage ?? bizData?.markup_percentage ?? 1;
  const managerSalary = Number(bizData?.manager_monthly_salary) || 0;

  const totalIncome = Number(daily.total_income) || 0;
  const incomeBeforeVat = totalIncome / (1 + vatPct);
  const sumDayFactors = Number(daily.sum_day_factors) || 0;
  const workDays = Number(daily.work_days) || 0;

  // monthlyPace uses totalIncome (WITH VAT) — same as dashboard
  const dailyAvg = sumDayFactors > 0 ? totalIncome / sumDayFactors : 0;
  const monthlyPace = dailyAvg * expectedWorkDays;

  const managerDailyCost = expectedWorkDays > 0 ? managerSalary / expectedWorkDays : 0;
  const laborCostTotal = (Number(daily.total_labor_cost) + managerDailyCost * workDays) * markup;
  const laborCostPct = incomeBeforeVat > 0 ? (laborCostTotal / incomeBeforeVat) * 100 : 0;

  const foodCost = Number(invoices.food_cost) || 0;
  const foodCostPct = incomeBeforeVat > 0 ? (foodCost / incomeBeforeVat) * 100 : 0;

  const currentExpenses = Number(invoices.current_expenses) || 0;
  const currentExpensesPct = incomeBeforeVat > 0 ? (currentExpenses / incomeBeforeVat) * 100 : 0;

  const revenueTarget = Number(goalsData?.revenue_target) || 0;
  const targetDiffPct = revenueTarget > 0 ? ((monthlyPace / revenueTarget) - 1) * 100 : null;
  // targetDiffAmount: (pace - target) / expectedWorkDays × actualDayFactors — same as dashboard
  const targetDiffAmount = (revenueTarget > 0 && expectedWorkDays > 0)
    ? ((monthlyPace - revenueTarget) / expectedWorkDays) * sumDayFactors
    : null;

  const laborTarget = Number(goalsData?.labor_cost_target_pct) || 0;
  const laborDiffPct = laborTarget > 0 ? laborCostPct - laborTarget : null;

  const foodTarget = Number(goalsData?.food_cost_target_pct) || 0;
  const foodDiffPct = foodTarget > 0 ? foodCostPct - foodTarget : null;

  // Current expenses target percentage — same as dashboard
  // Use goals.current_expenses_target if set, otherwise 0
  const currentExpensesTargetAmount = Number(goalsData?.current_expenses_target) || 0;
  const monthlyPaceBeforeVat = monthlyPace / (1 + vatPct);
  const currentExpensesTargetPct = monthlyPaceBeforeVat > 0
    ? (currentExpensesTargetAmount / monthlyPaceBeforeVat) * 100
    : 0;
  const currentExpensesDiffPct = currentExpensesPct - currentExpensesTargetPct;

  // 7. Managed products — fetch active products + their monthly usage
  const { data: managedProducts } = await sb
    .from("managed_products")
    .select("id, name, unit, unit_cost, target_pct")
    .eq("business_id", bizId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("created_at")
    .limit(3);

  type ManagedProductResult = { name: string; cost: number; pct: number; targetPct: number | null; diffPct: number | null };
  const mpResults: ManagedProductResult[] = [];

  if (managedProducts && managedProducts.length > 0) {
    // Get daily_entry IDs for this month
    const { data: entryIds } = await execReadOnlyQuery(sb,
      `SELECT id FROM public.daily_entries
       WHERE business_id = '${bizId}'
         AND entry_date >= '${monthStart}' AND entry_date < '${nextMonth}'
         AND deleted_at IS NULL`
    );
    const ids = Array.isArray(entryIds) ? entryIds.map((r: { id: string }) => r.id) : [];

    for (const mp of managedProducts) {
      let totalCost = 0;
      if (ids.length > 0) {
        const idList = ids.map((r) => `'${r}'`).join(",");
        const { data: usageAgg } = await execReadOnlyQuery(sb,
          `SELECT COALESCE(SUM(quantity * unit_cost_at_time), 0) as total_cost
           FROM public.daily_product_usage
           WHERE daily_entry_id IN (${idList}) AND product_id = '${mp.id}'`
        );
        totalCost = Array.isArray(usageAgg) && usageAgg[0] ? Number(usageAgg[0].total_cost) || 0 : 0;
      }
      const pct = incomeBeforeVat > 0 ? (totalCost / incomeBeforeVat) * 100 : 0;
      const tPct = mp.target_pct != null ? Number(mp.target_pct) : null;
      mpResults.push({
        name: mp.name,
        cost: Math.round(totalCost),
        pct: Math.round(pct * 100) / 100,
        targetPct: tPct,
        diffPct: tPct != null ? Math.round((pct - tPct) * 100) / 100 : null,
      });
    }
  }

  return {
    businessName: bizData?.name || "",
    period: { year, month, monthStart, daysInMonth },
    actuals: {
      totalIncome: Math.round(totalIncome),
      incomeBeforeVat: Math.round(incomeBeforeVat),
      workDays,
      sumDayFactors: Math.round(sumDayFactors * 100) / 100,
      dailyAvg: Math.round(dailyAvg),
      monthlyPace: Math.round(monthlyPace),
      expectedWorkDays: Math.round(expectedWorkDays * 100) / 100,
      totalDiscounts: Math.round(Number(daily.total_discounts)),
      totalLaborHours: Math.round(Number(daily.total_labor_hours)),
    },
    costs: {
      laborCostTotal: Math.round(laborCostTotal),
      laborCostPct: Math.round(laborCostPct * 100) / 100,
      foodCost: Math.round(foodCost),
      foodCostPct: Math.round(foodCostPct * 100) / 100,
      currentExpenses: Math.round(currentExpenses),
      currentExpensesPct: Math.round(currentExpensesPct * 100) / 100,
      currentExpensesTargetPct: Math.round(currentExpensesTargetPct * 100) / 100,
      currentExpensesDiffPct: Math.round(currentExpensesDiffPct * 100) / 100,
    },
    managedProducts: mpResults,
    targets: {
      revenueTarget,
      laborTargetPct: laborTarget,
      foodTargetPct: foodTarget,
      targetDiffPct: targetDiffPct !== null ? Math.round(targetDiffPct * 100) / 100 : null,
      targetDiffAmount: targetDiffAmount !== null ? Math.round(targetDiffAmount) : null,
      laborDiffPct: laborDiffPct !== null ? Math.round(laborDiffPct * 100) / 100 : null,
      foodDiffPct: foodDiffPct !== null ? Math.round(foodDiffPct * 100) / 100 : null,
    },
    params: { vatPct, markup, managerSalary },
  };
}

/** Store computed metrics to business_monthly_metrics (fire-and-forget) */
function storeMetricsInBackground(
  adminSb: AnySupabaseClient,
  bizId: string,
  year: number,
  month: number,
  summary: Awaited<ReturnType<typeof computeMonthlySummary>>
) {
  const r2 = (v: number | null | undefined) =>
    v === null || v === undefined ? null : Math.round(v * 100) / 100;

  const row = {
    business_id: bizId,
    year,
    month,
    actual_work_days: summary.actuals.workDays,
    actual_day_factors: summary.actuals.sumDayFactors,
    expected_work_days: summary.actuals.expectedWorkDays,
    total_income: summary.actuals.totalIncome,
    income_before_vat: summary.actuals.incomeBeforeVat,
    monthly_pace: summary.actuals.monthlyPace,
    daily_avg: summary.actuals.dailyAvg,
    revenue_target: summary.targets.revenueTarget,
    target_diff_pct: summary.targets.targetDiffPct,
    target_diff_amount: summary.targets.targetDiffAmount,
    labor_cost_amount: summary.costs.laborCostTotal,
    labor_cost_pct: summary.costs.laborCostPct,
    labor_target_pct: summary.targets.laborTargetPct,
    labor_diff_pct: summary.targets.laborDiffPct,
    labor_diff_amount: null,
    food_cost_amount: summary.costs.foodCost,
    food_cost_pct: summary.costs.foodCostPct,
    food_target_pct: summary.targets.foodTargetPct,
    food_diff_pct: summary.targets.foodDiffPct,
    food_diff_amount: null,
    current_expenses_amount: summary.costs.currentExpenses,
    current_expenses_pct: summary.costs.currentExpensesPct,
    current_expenses_target_pct: null,
    current_expenses_diff_pct: null,
    current_expenses_diff_amount: null,
    managed_product_1_name: summary.managedProducts?.[0]?.name ?? null,
    managed_product_1_cost: summary.managedProducts?.[0]?.cost ?? null,
    managed_product_1_pct: summary.managedProducts?.[0]?.pct ?? null,
    managed_product_1_target_pct: summary.managedProducts?.[0]?.targetPct ?? null,
    managed_product_1_diff_pct: summary.managedProducts?.[0]?.diffPct ?? null,
    managed_product_2_name: summary.managedProducts?.[1]?.name ?? null,
    managed_product_2_cost: summary.managedProducts?.[1]?.cost ?? null,
    managed_product_2_pct: summary.managedProducts?.[1]?.pct ?? null,
    managed_product_2_target_pct: summary.managedProducts?.[1]?.targetPct ?? null,
    managed_product_2_diff_pct: summary.managedProducts?.[1]?.diffPct ?? null,
    managed_product_3_name: summary.managedProducts?.[2]?.name ?? null,
    managed_product_3_cost: summary.managedProducts?.[2]?.cost ?? null,
    managed_product_3_pct: summary.managedProducts?.[2]?.pct ?? null,
    managed_product_3_target_pct: summary.managedProducts?.[2]?.targetPct ?? null,
    managed_product_3_diff_pct: summary.managedProducts?.[2]?.diffPct ?? null,
    vat_pct: r2(summary.params.vatPct),
    markup_pct: r2(summary.params.markup),
    manager_salary: r2(summary.params.managerSalary),
    manager_daily_cost: null,
    total_labor_hours: summary.actuals.totalLaborHours,
    total_discounts: summary.actuals.totalDiscounts,
    computed_at: new Date().toISOString(),
  };

  adminSb
    .from("business_monthly_metrics")
    .upsert(row, { onConflict: "business_id,year,month" })
    .then(({ error }: { error: unknown }) => {
      if (error) console.error("[storeMetrics] upsert error:", error);
      else console.log(`[storeMetrics] saved ${bizId} ${year}/${month}`);
    });
}

function buildTools(
  adminSupabase: AnySupabaseClient,
  businessId: string,
  isAdmin: boolean
) {
  return {
    getMonthlySummary: tool({
      description: "Get a complete pre-calculated monthly business summary from the business_monthly_metrics table. Includes: income, income before VAT, monthly pace, daily avg, labor cost (amount + %), food cost (amount + %), current expenses, managed products, private/business breakdown, targets & diffs, prev month/year comparisons, and calculation params. Use this as the FIRST tool for any question about monthly performance, 'how is the month going', summaries, or comparisons to goals. Returns all data already computed — no need for additional calculate calls.",
      inputSchema: z.object({
        businessId: z.string().describe("Business UUID"),
        year: z.number().describe("Year (e.g., 2026)"),
        month: z.number().describe("Month (1-12)"),
      }),
      execute: async ({ businessId: bizId, year, month }) => {
        console.log(`[AI Tool] getMonthlySummary: ${bizId} ${year}/${month}`);
        try {
          // Fetch business name for display in tool steps UI
          const { data: bizRow } = await adminSupabase
            .from("businesses")
            .select("name")
            .eq("id", bizId)
            .maybeSingle();
          const bizName = bizRow?.name || "";

          // Try reading from cached metrics table first
          const { data: cached } = await adminSupabase
            .from("business_monthly_metrics")
            .select("*")
            .eq("business_id", bizId)
            .eq("year", year)
            .eq("month", month)
            .maybeSingle();

          const now = new Date();
          const isCurrentMonth =
            year === now.getFullYear() && month === now.getMonth() + 1;
          const STALE_MS = 30 * 60 * 1000; // 30 minutes

          if (cached && cached.computed_at) {
            const age = now.getTime() - new Date(cached.computed_at).getTime();
            // For current month, refresh if older than 30 min; for past months, always use cache
            if (!isCurrentMonth || age < STALE_MS) {
              console.log(`[AI Tool] getMonthlySummary: using cached metrics (age=${Math.round(age / 60000)}m)`);
              const result = { ...cached, businessName: bizName };
              // Enrich with managed products if missing from cache
              if (!result.managed_product_1_name) {
                const { data: mp } = await adminSupabase
                  .from("managed_products")
                  .select("name, unit, unit_cost, current_stock, target_pct")
                  .eq("business_id", bizId)
                  .eq("is_active", true)
                  .is("deleted_at", null)
                  .order("created_at")
                  .limit(3);
                if (mp && mp.length > 0) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const r = result as any;
                  mp.forEach((p: { name: string; target_pct: number | null }, i: number) => {
                    const n = i + 1;
                    r[`managed_product_${n}_name`] = p.name;
                    r[`managed_product_${n}_target_pct`] = p.target_pct;
                    // Note: cost/pct not computed here, will be available after fresh compute
                  });
                  r._managedProductsSource = "managed_products_table";
                }
              }
              return result;
            }
          }

          // No cache or stale → compute fresh and store
          console.log(`[AI Tool] getMonthlySummary: computing fresh metrics`);
          const fresh = await computeMonthlySummary(adminSupabase, bizId, year, month);

          // Store in background (don't block the response)
          storeMetricsInBackground(adminSupabase, bizId, year, month, fresh);

          return fresh;
        } catch (e) {
          console.error("[AI Tool] getMonthlySummary error:", e);
          return { error: e instanceof Error ? e.message : "Failed to compute summary" };
        }
      },
    }),

    queryDatabase: tool({
      description: "Execute a read-only SQL query (SELECT/WITH only) against the PostgreSQL business database. Use for any business data: income, expenses, suppliers, invoices, goals, employees, payments. Always prefix tables with public. and filter by business_id.",
      inputSchema: z.object({
        sql: z.string().describe("The SQL SELECT query to execute. Must start with SELECT or WITH. Always use public. prefix for tables."),
        explanation: z.string().describe("Brief Hebrew explanation of what this query does, for logging."),
      }),
      execute: async ({ sql, explanation }) => {
        console.log(`[AI Tool] queryDatabase: ${explanation}`);
        const cleanSql = stripSqlFences(sql);
        const sqlLower = cleanSql.toLowerCase().trimStart();

        // Validate
        if (!sqlLower.startsWith("select") && !sqlLower.startsWith("with")) {
          return { error: "Only SELECT/WITH queries allowed", failedSql: cleanSql };
        }
        if (FORBIDDEN_SQL.test(cleanSql)) {
          return { error: "Query contains forbidden operations", failedSql: cleanSql };
        }
        if (cleanSql.includes("--") || cleanSql.includes("/*")) {
          return { error: "SQL comments not allowed", failedSql: cleanSql };
        }
        if (!isAdmin && businessId && !cleanSql.includes(businessId)) {
          return { error: `Query must filter by business_id = '${businessId}'`, failedSql: cleanSql };
        }

        // Execute
        const { data, error } = await execReadOnlyQuery(adminSupabase, cleanSql);

        if (error) {
          console.error("[AI Tool] SQL error:", error.message);
          // Try adding public. prefix
          if (error.message.includes("does not exist")) {
            const fixedSql = cleanSql
              .replace(/\bFROM\s+(?!public\.)(\w+)/gi, "FROM public.$1")
              .replace(/\bJOIN\s+(?!public\.)(\w+)/gi, "JOIN public.$1");
            const { data: retryData, error: retryError } = await execReadOnlyQuery(adminSupabase, fixedSql);
            if (retryError) {
              return { error: retryError.message, failedSql: fixedSql };
            }
            const rows = Array.isArray(retryData) ? retryData : [];
            return { rows: rows.slice(0, 100), totalRows: rows.length };
          }
          return { error: error.message, failedSql: cleanSql };
        }

        const rows = Array.isArray(data) ? data : [];
        return { rows: rows.slice(0, 100), totalRows: rows.length };
      },
    }),

    getBusinessSchedule: tool({
      description: "Get the weekly business schedule (day_factor per day of week) for calculating expected monthly work days and monthly pace. Returns 7 entries (0=Sunday to 6=Saturday).",
      inputSchema: z.object({
        businessId: z.string().describe("The business UUID to get schedule for."),
      }),
      execute: async ({ businessId: bizId }) => {
        console.log(`[AI Tool] getBusinessSchedule: ${bizId}`);
        const { data, error } = await adminSupabase
          .from("business_schedule")
          .select("day_of_week, day_factor")
          .eq("business_id", bizId)
          .order("day_of_week") as { data: Array<{ day_of_week: number; day_factor: number }> | null; error: { message: string } | null };

        if (error) {
          return { error: error.message };
        }
        if (!data || data.length === 0) {
          return { schedule: [], note: "No schedule found. Default: all days = 1." };
        }

        // Calculate expected work days for current month
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const scheduleMap = new Map<number, number>();
        for (const row of data) {
          scheduleMap.set(row.day_of_week, Number(row.day_factor) || 0);
        }
        let expectedWorkDays = 0;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
          const dayOfWeek = new Date(year, month, d).getDay();
          expectedWorkDays += scheduleMap.get(dayOfWeek) ?? 1;
        }

        return {
          schedule: data,
          currentMonth: { year, month: month + 1, expectedWorkDays, daysInMonth },
        };
      },
    }),

    getGoals: tool({
      description: "Get business goals for a specific month: revenue target, labor/food cost targets, markup, VAT override, profit targets, current expenses target.",
      inputSchema: z.object({
        businessId: z.string().describe("The business UUID."),
        year: z.number().describe("Year (e.g., 2026)."),
        month: z.number().describe("Month (1-12)."),
      }),
      execute: async ({ businessId: bizId, year, month }) => {
        console.log(`[AI Tool] getGoals: ${bizId} ${year}/${month}`);
        const { data, error } = await adminSupabase
          .from("goals")
          .select("*")
          .eq("business_id", bizId)
          .eq("year", year)
          .eq("month", month)
          .is("deleted_at", null)
          .maybeSingle();

        if (error) {
          return { error: error.message };
        }
        if (!data) {
          return { goals: null, note: "No goals set for this month." };
        }

        // Also get business defaults for fallbacks
        const { data: biz } = await adminSupabase
          .from("businesses")
          .select("vat_percentage, markup_percentage, manager_monthly_salary")
          .eq("id", bizId)
          .single();

        return {
          goals: data,
          businessDefaults: biz || null,
        };
      },
    }),

    calculate: tool({
      description: "Evaluate a pure math expression (arithmetic, percentages, VAT). For business data queries, use queryDatabase instead.",
      inputSchema: z.object({
        expression: z.string().describe("JavaScript math expression, e.g. '1200 * 0.15' or '85000 / 12'. Only Math.*, +, -, *, /, % allowed."),
        description: z.string().describe("Hebrew description of the calculation."),
      }),
      execute: async ({ expression, description }) => {
        console.log(`[AI Tool] calculate: ${description} → ${expression}`);
        try {
          const result = safeEvalMath(expression);
          return { result, expression, description };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Calculation failed", expression };
        }
      },
    }),

    proposeAction: tool({
      description: "Propose a business action (create expense/invoice, payment, or daily entry) for user confirmation. Use when user shares invoice/receipt data from OCR or asks to create a record. Returns structured data displayed as a confirmation card in the chat.",
      inputSchema: z.object({
        actionType: z.enum(["expense", "payment", "daily_entry"]).describe("Type of action to propose"),
        confidence: z.number().min(0).max(1).describe("Confidence score 0-1 for extraction quality"),
        reasoning: z.string().describe("Brief Hebrew explanation of why you're proposing this action"),
        expenseData: z.object({
          supplier_name: z.string().optional().describe("Supplier name as extracted"),
          invoice_date: z.string().optional().describe("Invoice date in YYYY-MM-DD format"),
          invoice_number: z.string().optional().describe("Invoice number"),
          subtotal: z.number().optional().describe("Amount before VAT"),
          vat_amount: z.number().optional().describe("VAT amount"),
          total_amount: z.number().optional().describe("Total amount including VAT"),
          invoice_type: z.string().optional().describe("current or goods"),
          notes: z.string().optional().describe("Additional notes"),
        }).optional(),
        paymentData: z.object({
          supplier_name: z.string().optional().describe("Supplier name"),
          payment_date: z.string().optional().describe("Payment date in YYYY-MM-DD format"),
          total_amount: z.number().optional().describe("Payment amount"),
          payment_method: z.enum(["cash", "check", "bank_transfer", "credit_card", "bit", "paybox", "other"]).optional(),
          check_number: z.string().optional(),
          reference_number: z.string().optional(),
          notes: z.string().optional(),
        }).optional(),
        dailyEntryData: z.object({
          entry_date: z.string().optional().describe("Entry date in YYYY-MM-DD format"),
          total_register: z.number().optional().describe("Total register amount"),
          labor_cost: z.number().optional().describe("Labor cost"),
          labor_hours: z.number().optional(),
          discounts: z.number().optional(),
          notes: z.string().optional(),
        }).optional(),
      }),
      execute: async ({ actionType, confidence, reasoning, expenseData, paymentData, dailyEntryData }) => {
        console.log(`[AI Tool] proposeAction: ${actionType} — ${reasoning}`);

        // Supplier lookup if name provided
        let resolvedSupplierId: string | null = null;
        let supplierLookup: { found: boolean; id?: string; name?: string; needsCreation?: boolean } | null = null;

        const supplierName = actionType === "expense" ? expenseData?.supplier_name : paymentData?.supplier_name;

        if (supplierName && businessId) {
          const { data: suppliers } = await adminSupabase
            .from("suppliers")
            .select("id, name")
            .eq("business_id", businessId)
            .ilike("name", `%${supplierName}%`)
            .is("deleted_at", null)
            .limit(1);

          if (suppliers && suppliers.length > 0) {
            resolvedSupplierId = suppliers[0].id;
            supplierLookup = { found: true, id: suppliers[0].id, name: suppliers[0].name };
          } else {
            supplierLookup = { found: false, needsCreation: true, name: supplierName };
          }
        }

        return {
          success: true,
          actionType,
          confidence,
          reasoning,
          businessId,
          expenseData: expenseData ? { ...expenseData, supplier_id: resolvedSupplierId || undefined } : undefined,
          paymentData: paymentData ? { ...paymentData, supplier_id: resolvedSupplierId || undefined } : undefined,
          dailyEntryData,
          supplierLookup,
        };
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  // 1. Validate environment
  if (!process.env.OPENAI_API_KEY) {
    return jsonResponse({ error: "שירות AI לא מוגדר" }, 503);
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "שירות מסד נתונים לא מוגדר" }, 503);
  }

  // 2. Parse request body (accepts UIMessage[] from useChat + extra body fields)
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "בקשה לא תקינה" }, 400);
  }

  let businessId = typeof body.businessId === "string" ? body.businessId : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const pageContext = typeof body.pageContext === "string" ? body.pageContext : "";
  const ocrContext = typeof body.ocrContext === "string" ? body.ocrContext : "";
  const viewAsOwner = body.viewAsOwner === true;

  // Extract messages from the AI SDK UIMessage format
  const uiMessages: UIMessage[] = Array.isArray(body.messages) ? body.messages : [];
  if (uiMessages.length === 0) {
    return jsonResponse({ error: "חסרים נתונים — אין הודעות בבקשה" }, 400);
  }

  // Get the last user message text
  const lastMsg = uiMessages[uiMessages.length - 1];
  const lastUserText = lastMsg?.role === "user"
    ? lastMsg.parts?.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("") || ""
    : "";

  if (!lastUserText) {
    return jsonResponse({ error: `חסרים נתונים — הודעה אחרונה: role=${lastMsg?.role}, parts=${JSON.stringify(lastMsg?.parts?.map(p => p.type))}` }, 400);
  }
  if (lastUserText.length > 2000) {
    return jsonResponse({ error: "ההודעה ארוכה מדי (מקסימום 2000 תווים)" }, 400);
  }
  if (businessId && !UUID_REGEX.test(businessId)) {
    return jsonResponse({ error: "מזהה עסק לא תקין" }, 400);
  }

  // 3. Authenticate user
  const serverSupabase = await createServerClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();

  if (!user) {
    return jsonResponse({ error: "לא מחובר" }, 401);
  }

  // 4. Rate limiting
  if (!checkRateLimit(user.id)) {
    return jsonResponse({ error: "יותר מדי בקשות. נסה שוב בעוד דקה." }, 429);
  }

  // 5. Authorization + user info
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("is_admin, full_name")
    .eq("id", user.id)
    .single();

  const userName = profile?.full_name || "";
  let userRole = "";
  // viewAsOwner allows admin to get responses scoped to the selected business (like an owner)
  const isAdmin = profile?.is_admin === true && !viewAsOwner;

  // For non-admin users without a selected business, auto-detect their first business
  if (!isAdmin && !businessId) {
    const { data: firstMembership } = await serverSupabase
      .from("business_members")
      .select("business_id")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (firstMembership?.business_id) {
      businessId = firstMembership.business_id;
    } else {
      return jsonResponse({ error: "לא נמצא עסק משויך למשתמש" }, 400);
    }
  }

  // Fetch business name
  let businessName = "";
  if (businessId) {
    const { data: biz } = await serverSupabase
      .from("businesses")
      .select("name")
      .eq("id", businessId)
      .single();
    businessName = biz?.name || "";
  }

  // Admin: always fetch all businesses
  let allBusinesses: Array<{ id: string; name: string }> = [];
  if (isAdmin) {
    const { data: businesses } = await serverSupabase
      .from("businesses")
      .select("id, name")
      .order("name");
    allBusinesses = businesses || [];
  }

  if (isAdmin) {
    userRole = "מנהל מערכת";
  } else {
    const { data: membership } = await serverSupabase
      .from("business_members")
      .select("id, role")
      .eq("user_id", user.id)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .single();

    if (!membership) {
      return jsonResponse({ error: "אין גישה לעסק זה" }, 403);
    }

    const roleMap: Record<string, string> = {
      owner: "בעל עסק",
      manager: "מנהל",
      employee: "עובד",
    };
    userRole = roleMap[membership.role] || membership.role || "משתמש";
  }

  // 5b. Load bonus plans for non-admin users
  let bonusPlanContext = "";
  if (!isAdmin && user.id && businessId) {
    const bonusSb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: bonusPlans } = await bonusSb
      .from("bonus_plans")
      .select("area_name, measurement_type, data_source, is_lower_better, custom_source_label, tier1_label, tier1_threshold, tier1_amount, tier2_label, tier2_threshold, tier2_amount, tier3_label, tier3_threshold, tier3_amount")
      .eq("employee_user_id", user.id)
      .eq("business_id", businessId)
      .eq("is_active", true)
      .is("deleted_at", null);

    if (bonusPlans && bonusPlans.length > 0) {
      const planLines = bonusPlans.map((p, i) => {
        const unit = p.measurement_type === "percentage" ? "%" : "₪";
        const dir = p.is_lower_better ? "נמוך = טוב" : "גבוה = טוב";
        return `${i + 1}. תחום: ${p.area_name} | מדידה: ${unit} | ${dir}
   רמות: ${p.tier1_label}=${p.tier1_threshold != null ? p.tier1_threshold + unit : ""}→₪${p.tier1_amount} | ${p.tier2_label}=${p.tier2_threshold != null ? p.tier2_threshold + unit : ""}→₪${p.tier2_amount} | ${p.tier3_label}=${p.tier3_threshold != null ? p.tier3_threshold + unit : ""}→₪${p.tier3_amount}`;
      });
      bonusPlanContext = `<bonus-plans>
לעובד זה יש תכניות בונוס פעילות:
${planLines.join("\n")}

הוראות חשובות:
- כשהעובד פותח שיחה או שואל על הביצועים/בונוס שלו, **חובה לפתוח פרואקטיבית בסטטוס הבונוס**.
- השתמש ב-getMonthlySummary כדי לקבל נתונים עדכניים על התחום שלו.
- תן טיפים מעשיים ומעודדים לשיפור בתחום האחריות.
- אם העובד מצליח — עודד אותו. אם לא עומד ביעד — תן עצות קונקרטיות מה לשפר.
</bonus-plans>`;
    }
  }

  // 6. Page context
  const pageHint = getPageContextHint(pageContext);

  // 7. Inject OCR context into the last user message (hidden from chat UI, visible to AI)
  if (ocrContext) {
    const lastUiMsg = uiMessages[uiMessages.length - 1];
    if (lastUiMsg?.role === "user" && lastUiMsg.parts) {
      lastUiMsg.parts.push({
        type: "text" as const,
        text: `\n\n<ocr-document>\n${ocrContext}\n</ocr-document>`,
      });
    }
  }

  // 8. Convert UIMessages to model messages
  const modelMessages = await convertToModelMessages(uiMessages);

  // 9. Save user message to DB (save only the display text, not OCR)
  if (sessionId) {
    saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "user", lastUserText);
  }

  // 10. Build tools & system prompt
  const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tools = buildTools(adminSupabase, businessId, isAdmin);

  const systemPrompt = buildUnifiedPrompt({
    userName,
    userRole,
    businessId,
    businessName,
    isAdmin,
    allBusinesses,
    pageHint,
    bonusPlanContext,
  });

  // 10. Stream response with Vercel AI SDK
  console.log(`[AI Chat] Starting stream: user=${userName}, role=${userRole}, business=${businessName}(${businessId}), messages=${modelMessages.length}, promptLength=${systemPrompt.length}`);

  const result = streamText({
    model: openai("gpt-4.1-mini"),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    temperature: 0.6,
    maxOutputTokens: 4000,
    onStepFinish: async ({ toolCalls }) => {
      if (toolCalls?.length) {
        console.log(`[AI Step] tools=${toolCalls.map(tc => tc.toolName).join(", ")}`);
      }
    },
    onError: ({ error }) => {
      console.error("[AI Stream] Error during streaming:", error);
    },
    onFinish: async ({ text, steps, finishReason }) => {
      console.log(`[AI Stream] Finished: reason=${finishReason}, textLength=${text?.length || 0}, steps=${steps?.length || 0}`);
      if (!text && steps?.length) {
        console.warn("[AI Stream] No text generated after tool calls. Steps:", JSON.stringify(steps.map(s => ({ toolCalls: s.toolCalls?.map(tc => tc.toolName), text: s.text?.slice(0, 100) }))));
      }
      if (!sessionId || !text) return;

      // Extract chart data from text if present
      let chartData: unknown = null;
      const chartMatch = text.match(/```chart-json\n([\s\S]*?)\n```/);
      if (chartMatch) {
        try {
          chartData = JSON.parse(chartMatch[1]);
        } catch {
          // Invalid chart JSON
        }
      }

      // Save text without chart block
      const textContent = chartMatch
        ? text.slice(0, text.indexOf("```chart-json")).trim()
        : text;

      saveMessageToDB(supabaseUrl, serviceRoleKey, sessionId, "assistant", textContent, chartData);
    },
  });

  return result.toUIMessageStreamResponse();
}
