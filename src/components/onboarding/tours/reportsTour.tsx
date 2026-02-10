import { Tour } from "nextstepjs";

export const reportsTour: Tour = {
  tour: "reports",
  steps: [
    {
      icon: <>📑</>,
      title: "דוח רווח והפסד",
      content: (
        <>
          כאן תצפה בדוח רווח והפסד מפורט של העסק. הדוח כולל פירוט הכנסות, הוצאות
          לפי קטגוריה ורווח תפעולי.
        </>
      ),
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 0,
      pointerRadius: 0,
    },
    {
      icon: <>💰</>,
      title: "סיכום כללי",
      content: (
        <>
          הכרטיסים העליונים מציגים סיכום מהיר: סה״כ הכנסות, סה״כ הוצאות, רווח
          תפעולי ורווח נקי.
        </>
      ),
      selector: "#onboarding-reports-summary",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
    {
      icon: <>📂</>,
      title: "פירוט לפי קטגוריה",
      content: (
        <>
          הטבלה מציגה פירוט הוצאות לפי קטגוריה עם יעד, ביצוע, הפרש ויתרה. לחץ
          על קטגוריה כדי לצפות בתת-קטגוריות.
        </>
      ),
      selector: "#onboarding-reports-categories",
      side: "top",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
  ],
};
