import type { DriveStep } from "driver.js";

/**
 * שלבי הסיור של דף הדשבורד הראשי.
 * כל שלב מצביע על אלמנט עם id="onboarding-*" שקיים בדף.
 * השלב הראשון ללא element → driver.js מציג אותו ממורכז על המסך.
 */
export const dashboardSteps: DriveStep[] = [
  {
    popover: {
      title: "ברוכים הבאים למצפן!",
      description:
        "זהו הדשבורד הראשי שלך. כאן תוכל לראות סיכום של כל העסקים, נתונים פיננסיים ומגמות בזמן אמת. בוא נעבור על זה יחד.",
    },
  },
  {
    element: "#onboarding-datepicker",
    popover: {
      title: "בחירת תקופה",
      description:
        "כאן בוחרים את התקופה המוצגת — חודש, טווח תאריכים מותאם או תקופות מוכנות. כל הנתונים בדף מתעדכנים בהתאם לבחירה.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: "#onboarding-business-cards",
    popover: {
      title: "כרטיסי עסקים",
      description:
        "לחץ על כרטיס עסק כדי לבחור אותו. לאחר הבחירה יוצגו נתונים מפורטים כולל הכנסות, הוצאות והפרש מהיעד.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-daily-entry",
    popover: {
      title: "הזנת נתונים יומית",
      description:
        "כאן תזין את הנתונים היומיים של העסק — הכנסות, הזמנות ועוד. לחץ על הכפתור כדי להתחיל.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-data-cards",
    popover: {
      title: "כרטיסי נתונים",
      description:
        "כרטיסים אלו מציגים סיכום מפורט: הכנסות, עלות עובדים, עלות מכר, הוצאות שוטפות והשוואה לתקופות קודמות.",
      side: "top",
      align: "center",
    },
  },
  {
    element: "#onboarding-charts",
    popover: {
      title: "גרפים ומגמות",
      description:
        "עקוב אחרי מגמות הכנסות והוצאות לאורך זמן. הגרפים מתעדכנים אוטומטית בהתאם לתקופה שנבחרה.",
      side: "top",
      align: "center",
    },
  },
];
