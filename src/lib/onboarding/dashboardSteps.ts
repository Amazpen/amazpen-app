import type { DriveStep } from "driver.js";

/**
 * דמו ויזואלי של טופס ההזנה היומית, מוצג בתוך כרטיס הסיור עצמו
 * כדי שהמשתמש יראה איך נראה הטופס בלי צורך לפתוח אותו.
 * משתמש ב-inline styles כי התוכן מוזרק דינמית ל-popover של driver.js.
 */
const DAILY_ENTRY_FORM_DEMO = `
<div style="margin-top:12px;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:12px;background:rgba(255,255,255,0.04);">
  <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-bottom:10px;font-weight:600;">דוגמה לטופס הזנה יומית</div>

  <div style="margin-bottom:8px;">
    <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:3px;">תאריך האירוע</div>
    <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.15);">15/05/2026</div>
  </div>

  <div style="margin-bottom:8px;">
    <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:3px;">סה"כ הכנסות</div>
    <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.15);">₪ 8,450</div>
  </div>

  <div style="display:flex;gap:8px;margin-bottom:8px;">
    <div style="flex:1;">
      <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:3px;">מזומן</div>
      <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.15);">₪ 3,200</div>
    </div>
    <div style="flex:1;">
      <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:3px;">אשראי</div>
      <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.15);">₪ 5,250</div>
    </div>
  </div>

  <div>
    <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:3px;">כמות הזמנות</div>
    <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.15);">128</div>
  </div>
</div>`;

const DAILY_ENTRY_DESCRIPTION = `<div>כאן מזינים את הנתונים היומיים של העסק שנבחר: ההכנסה של היום, אמצעי התשלום, כמות ההזמנות ועלות העובדים. הזנה יומית עקבית היא הבסיס לכל המערכת, כי ממנה נבנים כל הסיכומים, הגרפים וההשוואות ליעדים. בכפתור 'הצגת ועריכת נתונים' אפשר לחזור אחורה, לבדוק ימים קודמים ולתקן טעויות. כך נראה הטופס בפועל:</div>${DAILY_ENTRY_FORM_DEMO}`;

/**
 * שלבי הסיור של דף הדשבורד הראשי.
 * כל שלב מצביע על אלמנט עם id="onboarding-*" שקיים בדף.
 * השלב הראשון ללא element, ולכן driver.js מציג אותו ממורכז על המסך.
 *
 * ההסברים מורחבים בכוונה כדי שכל משתמש יבין את המשמעות העסקית של כל אזור,
 * לא רק היכן הוא נמצא. אין שימוש בתו em dash בתוכן.
 */
export const dashboardSteps: DriveStep[] = [
  {
    popover: {
      title: "ברוכים הבאים למצפן!",
      description:
        "המצפן הוא מערכת הניהול הפיננסי של העסק שלך. במסך הזה תראה תמונת מצב מלאה של כל העסקים שלך: כמה הכנסת, כמה הוצאת, ואיפה אתה עומד ביחס ליעדים שהצבת. הסיור הקצר הזה ילווה אותך צעד אחר צעד ויראה לך מה כל חלק במסך עושה ואיך הוא עוזר לך לקבל החלטות טובות יותר. אפשר לדלג בכל רגע בלחיצה על הסגירה בפינה.",
    },
  },
  {
    element: "#onboarding-datepicker",
    popover: {
      title: "בחירת התקופה המוצגת",
      description:
        "כל המספרים והגרפים במסך מתייחסים לתקופה שנבחרה כאן. ברירת המחדל היא החודש הנוכחי, אבל אפשר לבחור חודש אחר, רבעון, שנה שלמה או טווח תאריכים מדויק שתגדיר בעצמך. שינוי התקופה מעדכן מיד את כל הנתונים בדף, כך שתוכל להשוות בין חודשים, לבדוק תקופות עומס, או לראות מגמה לאורך זמן. זה הכלי הראשון שכדאי להגדיר לפני שמסתכלים על שאר הנתונים.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: "#onboarding-business-cards",
    popover: {
      title: "כרטיסי העסקים שלך",
      description:
        "כל כרטיס מייצג עסק אחד שלך, ומציג במבט מהיר את הנתונים המרכזיים שלו לתקופה שנבחרה: סך ההכנסות, אחוז עלות העובדים, אחוז עלות המכר וההפרש מהיעד שהוגדר. צבע אדום מסמן חריגה מהיעד וצבע ירוק מסמן עמידה בו, כך שתזהה תוך שנייה איזה עסק דורש את תשומת הלב שלך. לחיצה על כרטיס בוחרת את העסק ופותחת מתחתיו את כל הנתונים המפורטים שלו.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-daily-entry",
    popover: {
      title: "הזנת והצגת נתונים יומיים",
      description: DAILY_ENTRY_DESCRIPTION,
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-data-cards",
    popover: {
      title: "כרטיסי הנתונים המפורטים",
      description:
        "אחרי שבחרת עסק, הכרטיסים האלה מפרקים את התמונה הפיננסית לרכיבים שאפשר לפעול לפיהם: ההכנסות בפועל, עלות העובדים, עלות המכר וההוצאות השוטפות. לצד כל מספר מוצגת השוואה ליעד ולתקופה הקודמת, כדי שתבין לא רק כמה הוצאת אלא גם אם זה גבוה או נמוך ממה שתכננת. זה האזור שעוזר לך לאתר היכן הכסף נשפך ואיפה כדאי להתייעל.",
      side: "top",
      align: "center",
    },
  },
  {
    element: "#onboarding-charts",
    popover: {
      title: "גרפים ומגמות לאורך זמן",
      description:
        "הגרפים מציגים את ההכנסות וההוצאות שלך לאורך התקופה שנבחרה, כך שתוכל לראות את הכיוון שאליו העסק הולך ולא רק מספר בודד. מגמה עולה של הכנסות או מגמה יורדת של הוצאות הן סימן טוב, וקפיצות חריגות בגרף הן נקודות שכדאי לבדוק לעומק. הגרפים מתעדכנים אוטומטית לפי התקופה והעסק שבחרת, ומאפשרים לך לזהות עונתיות, לזהות בעיות מוקדם ולתכנן קדימה בצורה מבוססת נתונים.",
      side: "top",
      align: "center",
    },
  },
];
