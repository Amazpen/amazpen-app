import type { DriveStep } from "driver.js";

/**
 * דמו ויזואלי של טופס הוספת ספק, מוצג בתוך כרטיס הסיור עצמו
 * כדי שהמשתמש יראה איך נראה הטופס בלי לפתוח אותו.
 * משתמש ב-inline styles כי התוכן מוזרק דינמית ל-popover של driver.js.
 */
const SUPPLIER_FORM_DEMO = `
<div style="margin-top:12px;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:12px;background:rgba(0,0,0,0.12);">
  <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-bottom:10px;font-weight:600;">דוגמה לטופס הוספת ספק</div>

  <div style="margin-bottom:8px;">
    <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">שם הספק</div>
    <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">תנובה בע"מ</div>
  </div>

  <div style="margin-bottom:8px;">
    <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">כתובת מייל</div>
    <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">orders@tnuva.co.il</div>
  </div>

  <div style="display:flex;gap:8px;margin-bottom:8px;">
    <div style="flex:1;">
      <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">קטגוריה</div>
      <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">מוצרי חלב</div>
    </div>
    <div style="flex:1;">
      <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">תנאי תשלום</div>
      <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">שוטף + 30</div>
    </div>
  </div>
</div>`;

const ADD_SUPPLIER_DESCRIPTION = `<div>בלחיצה כאן נפתח טופס להוספת ספק חדש לקטגוריה שנבחרה. מזינים את שם הספק, כתובת המייל שלו, הקטגוריה ותנאי התשלום. הגדרת תנאי התשלום חשובה במיוחד, כי לפיה המערכת מחשבת מתי כל חשבונית הופכת לתשלום שצריך לבצע. אפשר גם להגדיר התחייבויות קודמות וצירוף מסמכים. כך נראה הטופס בפועל:</div>${SUPPLIER_FORM_DEMO}`;

/**
 * שלבי הסיור של דף ניהול הספקים.
 * כל שלב מצביע על אלמנט עם id="onboarding-suppliers-*" שקיים בדף.
 * ההסברים מורחבים כדי שכל משתמש יבין את המשמעות העסקית של כל אזור.
 * אין שימוש בתו em dash בתוכן.
 */
export const suppliersSteps: DriveStep[] = [
  {
    popover: {
      title: "ניהול הספקים של העסק",
      description:
        "במסך הזה מנהלים את כל הספקים והקשר הכספי איתם: כמה אתה חייב לכל ספק, מה כבר שולם ומה עדיין פתוח לתשלום. ניהול מסודר של הספקים עוזר לך לשמור על יחסים טובים, לעמוד בתנאי התשלום ולתכנן את התזרים נכון. הסיור הקצר הזה יסביר כל חלק במסך וכיצד הוא עוזר לך לשלוט בהתחייבויות מול הספקים.",
    },
  },
  {
    element: "#onboarding-suppliers-total",
    popover: {
      title: "סך הכל פתוח לתשלום",
      description:
        "המספר הזה מציג את סך כל הסכום שעדיין פתוח לתשלום מול כל הספקים יחד. זהו מדד מהיר למצב ההתחייבויות של העסק ברגע נתון. סכום באדום מציין חוב פתוח לספקים, וסכום בירוק מציין יתרת זכות לטובתך. כך אפשר לדעת תוך שנייה כמה כסף מחויב לצאת לספקים.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-suppliers-add",
    popover: {
      title: "הוספת ספק חדש",
      description: ADD_SUPPLIER_DESCRIPTION,
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-suppliers-tabs",
    popover: {
      title: "סוגי הספקים וההתחייבויות",
      description:
        "הספקים מחולקים לפי סוג ההוצאה: 'קניות סחורה' לספקי חומרי גלם ומלאי, 'הוצאות שוטפות' לספקי תפעול כמו שכירות וחשמל, 'עלות עובדים' לכוח אדם, ו'התחייבויות קודמות' להלוואות ולתשלומים פרוסים. כל לשונית מציגה את הספקים והיתרות הרלוונטיים לאותו סוג, כדי שתוכל לנהל כל תחום בנפרד.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-suppliers-search",
    popover: {
      title: "ספירה וחיפוש ספקים",
      description:
        "כאן מוצגת כמות הספקים בלשונית הנוכחית, ובלחיצה על סמל החיפוש אפשר לאתר ספק לפי שם במהירות. זה שימושי במיוחד כשיש רשימה ארוכה של ספקים ואתה צריך להגיע לספק מסוים מבלי לגלול.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-suppliers-list",
    popover: {
      title: "רשימת הספקים",
      description:
        "כל כרטיס ברשימה מייצג ספק, ומציג את שמו, היתרה הפתוחה מולו והקטגוריה שלו. לחיצה על ספק פותחת את כל הפרטים: היסטוריית החשבוניות, התשלומים שבוצעו והיתרה לתשלום. זהו המקום לעקוב אחר כל ספק בנפרד, לעדכן פרטים ולנהל את ההתחשבנות מולו.",
      side: "top",
      align: "center",
    },
  },
];
