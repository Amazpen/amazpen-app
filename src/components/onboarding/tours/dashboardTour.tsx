import { Tour } from "nextstepjs";

export const dashboardTour: Tour = {
  tour: "dashboard",
  steps: [
    {
      icon: <>👋</>,
      title: "ברוכים הבאים למצפן!",
      content: (
        <>
          זהו הדשבורד הראשי שלך. כאן תוכל לראות סיכום של כל העסקים, נתונים
          פיננסיים ומגמות בזמן אמת.
        </>
      ),
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 0,
      pointerRadius: 0,
    },
    {
      icon: <>🏢</>,
      title: "כרטיסי עסקים",
      content: (
        <>
          לחץ על כרטיס עסק כדי לבחור אותו. לאחר הבחירה יוצגו נתונים מפורטים
          כולל הכנסות, הוצאות והפרש מהיעד.
        </>
      ),
      selector: "#onboarding-business-cards",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
    {
      icon: <>📝</>,
      title: "הזנת נתונים יומית",
      content: (
        <>
          כאן תזין את הנתונים היומיים של העסק — הכנסות, הזמנות ועוד. לחץ על
          הכפתור כדי להתחיל.
        </>
      ),
      selector: "#onboarding-daily-entry",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 8,
      pointerRadius: 10,
    },
    {
      icon: <>📊</>,
      title: "כרטיסי נתונים",
      content: (
        <>
          כרטיסים אלו מציגים סיכום מפורט: הכנסות, עלות עובדים, עלות מכר, הוצאות
          שוטפות והשוואה לתקופות קודמות.
        </>
      ),
      selector: "#onboarding-data-cards",
      side: "top",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
    {
      icon: <>📈</>,
      title: "גרפים ומגמות",
      content: (
        <>
          עקוב אחרי מגמות הכנסות והוצאות לאורך זמן. הגרפים מתעדכנים אוטומטית
          בהתאם לתקופה שנבחרה.
        </>
      ),
      selector: "#onboarding-charts",
      side: "top",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
  ],
};
