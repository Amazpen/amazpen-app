import type { DriveStep } from "driver.js";

/**
 * דמו ויזואלי של טופס הזנת ההוצאה, מוצג בתוך כרטיס הסיור עצמו
 * כדי שהמשתמש יראה איך נראה הטופס בלי לפתוח אותו.
 * משתמש ב-inline styles כי התוכן מוזרק דינמית ל-popover של driver.js.
 */
const EXPENSE_FORM_DEMO = `
<div style="margin-top:12px;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:12px;background:rgba(0,0,0,0.12);">
  <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-bottom:10px;font-weight:600;">דוגמה לטופס הזנת הוצאה</div>

  <div style="margin-bottom:8px;">
    <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">ספק</div>
    <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">תנובה בע"מ</div>
  </div>

  <div style="margin-bottom:8px;">
    <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">מספר חשבונית</div>
    <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">2026-0457</div>
  </div>

  <div style="display:flex;gap:8px;margin-bottom:8px;">
    <div style="flex:1;">
      <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">סכום לפני מע"מ</div>
      <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">₪ 1,200</div>
    </div>
    <div style="flex:1;">
      <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">סכום כולל מע"מ</div>
      <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">₪ 1,404</div>
    </div>
  </div>

  <div style="margin-bottom:8px;">
    <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">תאריך חשבונית</div>
    <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">12/05/2026</div>
  </div>

  <div>
    <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">אמצעי תשלום</div>
    <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">אשראי</div>
  </div>
</div>`;

const ADD_EXPENSE_DESCRIPTION = `<div>בלחיצה כאן נפתח טופס להזנת הוצאה חדשה לקטגוריה שנבחרה. מזינים את הספק, מספר החשבונית, הסכום (לפני ואחרי מע"מ), התאריך ואמצעי התשלום. כל הוצאה שמוזנת מצטרפת מיד לסיכומים, לגרף ולרשימה, ומשפיעה על חישוב הרווחיות ועל המעקב מול הספקים. כך נראה הטופס בפועל:</div>${EXPENSE_FORM_DEMO}`;

/**
 * שלבי הסיור של דף ניהול ההוצאות.
 * כל שלב מצביע על אלמנט עם id="onboarding-expenses-*" שקיים בדף.
 * ההסברים מורחבים כדי שכל משתמש יבין את המשמעות העסקית של כל אזור.
 * אין שימוש בתו em dash בתוכן.
 */
export const expensesSteps: DriveStep[] = [
  {
    popover: {
      title: "ניהול ההוצאות של העסק",
      description:
        "במסך הזה מרכזים את כל ההוצאות של העסק במקום אחד: חשבוניות ספקים, קניות סחורה, הוצאות שוטפות ועלות עובדים. ניהול מסודר של ההוצאות הוא הבסיס לשליטה ברווחיות, כי כאן רואים בדיוק לאן הכסף יוצא ומול מי. הסיור הקצר הזה יסביר כל חלק במסך וכיצד הוא עוזר לך לעקוב אחר ההוצאות ולקבל החלטות נכונות.",
    },
  },
  {
    element: "#onboarding-expenses-tabs",
    popover: {
      title: "סוגי ההוצאות",
      description:
        "ההוצאות מחולקות לשלוש קטגוריות: 'קניות סחורה' לחומרי גלם ומלאי, 'הוצאות שוטפות' להוצאות התפעול הקבועות כמו שכירות וחשמל, ו'עלות עובדים' לשכר ולעלויות כוח אדם. כל לשונית מציגה את הנתונים, הגרף והרשימה הרלוונטיים לאותו סוג הוצאה בלבד, כדי שתוכל לנתח כל תחום בנפרד.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-expenses-add",
    popover: {
      title: "הזנת הוצאה חדשה",
      description: ADD_EXPENSE_DESCRIPTION,
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "#onboarding-expenses-datepicker",
    popover: {
      title: "בחירת התקופה המוצגת",
      description:
        "כל הנתונים במסך מתייחסים לתקופה שנבחרת כאן. אפשר לבחור חודש, רבעון, שנה או טווח תאריכים מדויק, וכל הסכומים, הגרף והרשימה יתעדכנו בהתאם. כך אפשר להשוות הוצאות בין תקופות ולזהות חודשים חריגים.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: "#onboarding-expenses-filters",
    popover: {
      title: "גרף, סיכום וסינון",
      description:
        "האזור הזה מציג את ההוצאות בצורה ויזואלית: גרף שמפרק את ההוצאות לפי קטגוריות וסכום כולל לתקופה. בעזרת כפתור הסינון אפשר לצמצם את התצוגה לפי תאריך, ספק או קטגוריה, וכך להתמקד בדיוק במה שמעניין אותך. זה הכלי שעוזר לזהות במהירות אילו קטגוריות צורכות את החלק הגדול ביותר מההוצאות.",
      side: "top",
      align: "center",
    },
  },
  {
    element: "#onboarding-expenses-list",
    popover: {
      title: "רשימת ההוצאות",
      description:
        "כאן מופיעות כל ההוצאות של התקופה והקטגוריה שנבחרו, שורה אחר שורה, עם פרטי הספק, הסכום, התאריך וסטטוס התשלום. אפשר למיין לפי כל עמודה, ללחוץ על שורה כדי לראות את הפרטים המלאים, לערוך או למחוק הוצאה. זוהי התמונה המפורטת שמאחורי המספרים והגרף, והמקום לעדכן ולתחזק את הנתונים.",
      side: "top",
      align: "center",
    },
  },
];
