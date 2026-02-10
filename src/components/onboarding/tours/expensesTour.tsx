import { Tour } from "nextstepjs";

export const expensesTour: Tour = {
  tour: "expenses",
  steps: [
    {
      icon: <>🧾</>,
      title: "ניהול הוצאות",
      content: (
        <>
          כאן תנהל את כל החשבוניות וההוצאות של העסק. ניתן להוסיף חשבוניות, לסנן
          לפי תאריך ולצפות בסטטוס תשלום.
        </>
      ),
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 0,
      pointerRadius: 0,
    },
    {
      icon: <>🔍</>,
      title: "סינון וחיפוש",
      content: (
        <>
          השתמש במסנני התאריך, סטטוס וספק כדי למצוא חשבוניות ספציפיות במהירות.
        </>
      ),
      selector: "#onboarding-expenses-filters",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 8,
      pointerRadius: 10,
    },
    {
      icon: <>📋</>,
      title: "רשימת חשבוניות",
      content: (
        <>
          לחץ על חשבונית כדי לצפות בפרטים מלאים, לערוך או לשנות סטטוס. ניתן גם
          לצרף קבצים ולהוסיף הערות.
        </>
      ),
      selector: "#onboarding-expenses-list",
      side: "top",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
    {
      icon: <>➕</>,
      title: "הוספת חשבונית",
      content: (
        <>
          לחץ כאן כדי להוסיף חשבונית חדשה. מלא את פרטי הספק, סכום, מע״מ ותאריך.
        </>
      ),
      selector: "#onboarding-expenses-add",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 8,
      pointerRadius: 10,
    },
  ],
};
