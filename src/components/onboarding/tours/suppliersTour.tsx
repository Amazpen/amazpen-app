import { Tour } from "nextstepjs";

export const suppliersTour: Tour = {
  tour: "suppliers",
  steps: [
    {
      icon: <>🤝</>,
      title: "ניהול ספקים",
      content: (
        <>
          כאן תנהל את מאגר הספקים של העסק. ספקים מחולקים לקטגוריות ומאפשרים מעקב
          שוטף אחרי הוצאות ותשלומים.
        </>
      ),
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 0,
      pointerRadius: 0,
    },
    {
      icon: <>📑</>,
      title: "לשוניות ספקים",
      content: (
        <>
          עבור בין הלשוניות כדי לצפות בספקים לפי סוג: הוצאות קבועות, הוצאות
          משתנות, עלות מכר ועלות עובדים.
        </>
      ),
      selector: "#onboarding-suppliers-tabs",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 8,
      pointerRadius: 10,
    },
    {
      icon: <>📇</>,
      title: "פרטי ספק",
      content: (
        <>
          לחץ על ספק כדי לצפות בפרטים מלאים, לערוך תנאי תשלום ולראות היסטוריית
          חשבוניות.
        </>
      ),
      selector: "#onboarding-suppliers-list",
      side: "top",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
    {
      icon: <>➕</>,
      title: "הוספת ספק",
      content: (
        <>
          לחץ כאן כדי להוסיף ספק חדש למאגר. הגדר קטגוריה, תנאי תשלום ופרטים
          נוספים.
        </>
      ),
      selector: "#onboarding-suppliers-add",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 8,
      pointerRadius: 10,
    },
  ],
};
