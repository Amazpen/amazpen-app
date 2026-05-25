import type { DriveStep } from "driver.js";

/**
 * דמו ויזואלי של טופס הוספת תשלום, מוצג בתוך כרטיס הסיור עצמו
 * כדי שהמשתמש יראה איך נראה הטופס בלי לפתוח אותו.
 * משתמש ב-inline styles כי התוכן מוזרק דינמית ל-popover של driver.js.
 */
const PAYMENT_FORM_DEMO = `
<div style="margin-top:12px;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:12px;background:rgba(0,0,0,0.12);">
  <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-bottom:10px;font-weight:600;">דוגמה לטופס הוספת תשלום</div>

  <div style="margin-bottom:8px;">
    <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">ספק</div>
    <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">תנובה בע"מ</div>
  </div>

  <div style="display:flex;gap:8px;margin-bottom:8px;">
    <div style="flex:1;">
      <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">סכום התשלום</div>
      <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">₪ 1,404</div>
    </div>
    <div style="flex:1;">
      <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">תאריך תשלום</div>
      <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">15/05/2026</div>
    </div>
  </div>

  <div>
    <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">אמצעי תשלום</div>
    <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">העברה בנקאית</div>
  </div>
</div>`;

const ADD_PAYMENT_DESCRIPTION = `<div>בלחיצה כאן נפתח טופס להוספת תשלום ששולם לספק. בוחרים את הספק, מזינים את סכום התשלום, את תאריך התשלום ואת אמצעי התשלום. אפשר לקשר את התשלום לחשבוניות ספציפיות, כך שהמערכת תדע אילו חשבוניות נסגרו ותעדכן את היתרה הפתוחה מול הספק באופן אוטומטי. כך נראה הטופס בפועל:</div>${PAYMENT_FORM_DEMO}`;

/**
 * שלבי הסיור של דף ניהול התשלומים.
 * כל שלב מצביע על אלמנט עם id="onboarding-payments-*" שקיים בדף.
 * ההסברים מורחבים כדי שכל משתמש יבין את המשמעות העסקית של כל אזור.
 * אין שימוש בתו em dash בתוכן.
 */
export const paymentsSteps: DriveStep[] = [
  {
    popover: {
      title: "ניהול התשלומים של העסק",
      description:
        "במסך הזה מנהלים את כל התשלומים שיצאו לספקים: כמה שולם, מתי, באיזה אמצעי תשלום ועל איזו חשבונית. ניהול מסודר של התשלומים מאפשר לך לדעת בדיוק מה כבר שילמת ומה עדיין פתוח, לשמור על תזרים בריא ולמנוע תשלומים כפולים. הסיור הקצר הזה יסביר כל חלק במסך וכיצד הוא עוזר לך לשלוט בתשלומים.",
    },
  },
  {
    element: "#onboarding-payments-import",
    popover: {
      title: "הוספת תשלום",
      description: ADD_PAYMENT_DESCRIPTION,
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "#onboarding-payments-pending",
    popover: {
      title: "דוח ממתינים לתשלום",
      description:
        "כפתור זה פותח את דוח הממתינים לתשלום, שמרכז את כל החשבוניות שעדיין לא שולמו לפי מועד התשלום שלהן. הדוח עוזר לך לראות מה דחוף לשלם, לתעדף לפי תאריך, ולסמן בכוכב חשבוניות חשובות. זהו הכלי המרכזי לתכנון התשלומים הקרובים ולשמירה על תזרים מסודר.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "#onboarding-payments-datepicker",
    popover: {
      title: "בחירת התקופה המוצגת",
      description:
        "כל הנתונים במסך מתייחסים לתקופה שנבחרת כאן. אפשר לבחור חודש, רבעון, שנה או טווח תאריכים מדויק, וכל הסכומים, הגרף ורשימת התשלומים יתעדכנו בהתאם. כך אפשר להשוות תשלומים בין תקופות ולעקוב אחר קצב התשלומים לאורך זמן.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: "#onboarding-payments-chart",
    popover: {
      title: "גרף התשלומים",
      description:
        "גרף העוגה מציג את התפלגות התשלומים שיצאו לפי אמצעי תשלום (מזומן, אשראי, העברה בנקאית, צ'קים ועוד), לצד הסכום הכולל לתקופה שנבחרה. כך אפשר לראות במבט אחד באילו אמצעים אתה משלם הכי הרבה, ולנהל טוב יותר את התזרים והעמלות.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-payments-list",
    popover: {
      title: "רשימת התשלומים",
      description:
        "כאן מופיעים כל התשלומים של התקופה שנבחרה, עם פרטי הספק, הסכום, התאריך ואמצעי התשלום. אפשר לסנן לפי ספק, סכום, תאריך או אמצעי תשלום, ללחוץ על תשלום כדי לראות את החשבוניות שהוא סוגר, ולערוך או למחוק תשלום. זוהי התמונה המפורטת של כל מה ששולם בפועל.",
      side: "top",
      align: "center",
    },
  },
];
