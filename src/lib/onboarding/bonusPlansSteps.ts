import type { DriveStep } from "driver.js";

/**
 * דמו ויזואלי של מבנה רמות התגמול, מוצג בתוך כרטיס הסיור.
 * מסביר את הרעיון של 3 רמות בונוס בלי לפתוח את הטופס.
 */
const TIERS_DEMO = `
<div style="margin-top:12px;border:1px solid rgba(255,255,255,0.14);border-radius:10px;overflow:hidden;">
  <div style="display:grid;grid-template-columns:1fr 1fr;background:rgba(41,49,138,0.4);font-size:11px;color:rgba(255,255,255,0.6);">
    <div style="padding:6px;text-align:center;border-left:1px solid rgba(255,255,255,0.1);">רמת הישג</div>
    <div style="padding:6px;text-align:center;">בונוס</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;font-size:12px;color:#fff;border-top:1px solid rgba(255,255,255,0.1);">
    <div style="padding:6px;text-align:center;border-left:1px solid rgba(255,255,255,0.1);">עמידה ביעד</div>
    <div style="padding:6px;text-align:center;">₪ 300</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;font-size:12px;color:#fff;border-top:1px solid rgba(255,255,255,0.1);">
    <div style="padding:6px;text-align:center;border-left:1px solid rgba(255,255,255,0.1);">שיפור קטן</div>
    <div style="padding:6px;text-align:center;">₪ 500</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;font-size:12px;color:#fff;border-top:1px solid rgba(255,255,255,0.1);">
    <div style="padding:6px;text-align:center;border-left:1px solid rgba(255,255,255,0.1);">שיפור משמעותי</div>
    <div style="padding:6px;text-align:center;">₪ 800</div>
  </div>
</div>`;

const NEW_PLAN_DESCRIPTION = `<div>בלחיצה כאן נפתח טופס ליצירת תכנית בונוס חדשה. בוחרים עובד, מגדירים מה מודדים (למשל אחוז עלות עובדים או מספר אפסיילים), ומגדירים שלוש רמות תגמול עולות: ככל שהעובד משיג תוצאה טובה יותר, כך הבונוס גדל. כך יוצרים תמריץ ברור ומדורג. למשל:</div>${TIERS_DEMO}`;

/**
 * שלבי הסיור של דף תכניות הבונוסים.
 * הדף מאפשר למנהל להגדיר תמריצים כספיים לעובדים לפי ביצועים מדידים.
 * הסיור מסביר את הרעיון ואת אופן העבודה, לא רק היכן כל כפתור.
 * אין שימוש בתו em dash בתוכן.
 */
export const bonusPlansSteps: DriveStep[] = [
  {
    popover: {
      title: "תכניות בונוסים ותגמול",
      description:
        "מה אם אפשר היה לגרום לעובדים לדאוג למספרים של העסק כאילו היו שלהם? זו בדיוק המטרה של המסך הזה. כאן מגדירים תכניות בונוס שמתגמלות עובדים כשהם משפרים מדד מסוים: הורדת עלות העובדים, הגדלת ממוצע ההזמנה, צמצום הוצאות ועוד. כשהעובד יודע שיש לו מה להרוויח מזה, הוא פועל אחרת. נעבור על איך זה עובד.",
    },
  },
  {
    element: "#onboarding-bonus-month",
    popover: {
      title: "תכנית לכל חודש",
      description:
        "תכניות הבונוס נקבעות לכל חודש בנפרד. כאן בוחרים את החודש והשנה, וכל התכניות והמעקב אחר הביצוע מתייחסים לתקופה הזו. כך אפשר להתאים את התמריצים מחודש לחודש, ולראות בדיעבד אילו בונוסים הושגו בכל חודש.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-bonus-new",
    popover: {
      title: "יצירת תכנית בונוס",
      description: NEW_PLAN_DESCRIPTION,
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "#onboarding-bonus-list",
    popover: {
      title: "מעקב אחר הבונוסים",
      description:
        "כל כרטיס הוא תכנית בונוס של עובד. הכרטיס מציג את העובד, מה נמדד, ושלוש רמות התגמול עם הסכומים. הכי חשוב: המערכת מחשבת אוטומטית את הביצוע בפועל של העובד החודש ומדגישה את הרמה שהוא עמד בה, כך שרואים מיד מי זכאי לאיזה בונוס. אפשר להפעיל או להשבית תכנית, לערוך אותה או למחוק, בכל עת.",
      side: "top",
      align: "center",
    },
  },
];
