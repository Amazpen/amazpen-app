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

const DAILY_ENTRY_DESCRIPTION = `<div>כאן מזינים את הנתונים היומיים של העסק שנבחר: ההכנסה של היום, אמצעי התשלום, כמות ההזמנות ועלות העובדים. הזנה יומית עקבית היא הבסיס של כל המערכת, שכן ממנה נבנים כל הסיכומים, הגרפים וההשוואות ליעדים. בעזרת הכפתור 'הצגת ועריכת נתונים' אפשר לחזור אחורה, לבדוק ימים קודמים ולתקן טעויות. כך נראה הטופס בפועל:</div>${DAILY_ENTRY_FORM_DEMO}`;

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
        "המצפן היא מערכת הניהול הפיננסי של העסק שלך. במסך הזה מוצגת תמונת מצב מלאה של כל העסקים: כמה הכנסת, כמה הוצאת, והיכן אתה עומד ביחס ליעדים שהצבת. הסיור הקצר הזה ילווה אותך צעד אחר צעד, ויסביר מה כל חלק במסך עושה וכיצד הוא עוזר לך לקבל החלטות טובות יותר. אפשר לסגור את הסיור בכל רגע בלחיצה על הסגירה שבפינה.",
    },
  },
  {
    element: "#onboarding-datepicker",
    popover: {
      title: "בחירת התקופה המוצגת",
      description:
        "כל המספרים והגרפים במסך מתייחסים לתקופה שנבחרת כאן. ברירת המחדל היא החודש הנוכחי, אך אפשר לבחור חודש אחר, רבעון, שנה שלמה או טווח תאריכים מדויק. שינוי התקופה מעדכן מיד את כל הנתונים בדף, כך שאפשר להשוות בין חודשים, לבחון תקופות עומס ולעקוב אחר מגמות לאורך זמן. מומלץ להגדיר את התקופה הרצויה לפני שבוחנים את שאר הנתונים.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: "#onboarding-business-cards",
    popover: {
      title: "כרטיסי העסקים שלך",
      description:
        "כל כרטיס מייצג עסק אחד, ומציג במבט מהיר את הנתונים המרכזיים שלו לתקופה שנבחרה: סך ההכנסות, אחוז עלות העובדים, אחוז עלות המכר וההפרש מהיעד שהוגדר. צבע ירוק מציין עמידה ביעד וצבע אדום מציין חריגה ממנו, כך שאפשר לזהות תוך שנייה איזה עסק דורש תשומת לב. לחיצה על כרטיס בוחרת את העסק ופותחת מתחתיו את כל הנתונים המפורטים שלו.",
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
        "לאחר בחירת עסק, הכרטיסים האלה מפרקים את התמונה הפיננסית לרכיבים ברורים: ההכנסות בפועל, עלות העובדים, עלות המכר וההוצאות השוטפות. לצד כל נתון מוצגת השוואה ליעד ולתקופה הקודמת, כך שניתן להבין לא רק כמה הוצאת, אלא גם אם זה גבוה או נמוך מהמתוכנן. זהו האזור שעוזר לאתר היכן ניתן להתייעל ולשפר את הרווחיות.",
      side: "top",
      align: "center",
    },
  },
  {
    element: "#onboarding-charts",
    popover: {
      title: "גרפים ומגמות לאורך זמן",
      description:
        "הגרפים מציגים את ההכנסות וההוצאות לאורך התקופה שנבחרה, כך שאפשר לראות את הכיוון שאליו העסק מתקדם ולא רק מספר בודד. מגמה עולה של הכנסות או מגמה יורדת של הוצאות הן סימן חיובי, וקפיצות חריגות בגרף מסמנות נקודות שכדאי לבדוק לעומק. הגרפים מתעדכנים אוטומטית לפי התקופה והעסק שנבחרו, ומאפשרים לזהות עונתיות, לאתר בעיות בזמן ולתכנן קדימה על בסיס נתונים.",
      side: "top",
      align: "center",
    },
  },
];
