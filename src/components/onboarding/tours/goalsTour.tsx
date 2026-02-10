import { Tour } from "nextstepjs";

export const goalsTour: Tour = {
  tour: "goals",
  steps: [
    {
      icon: <>🎯</>,
      title: "יעדים ותקציבים",
      content: (
        <>
          כאן תוכל להגדיר יעדים לעסק ולעקוב אחרי ההתקדמות. השווה בין יעדים
          לביצוע בפועל בכל חודש.
        </>
      ),
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 0,
      pointerRadius: 0,
    },
    {
      icon: <>📅</>,
      title: "בחירת חודש",
      content: (
        <>
          בחר חודש ושנה כדי לצפות ביעדים ובביצוע של התקופה הרצויה.
        </>
      ),
      selector: "#onboarding-goals-month",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 8,
      pointerRadius: 10,
    },
    {
      icon: <>📑</>,
      title: "לשוניות יעדים",
      content: (
        <>
          עבור בין הלשוניות: יעד מול עלות מכר, יעד מול הוצאות שוטפות ומדדי KPI.
        </>
      ),
      selector: "#onboarding-goals-tabs",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 8,
      pointerRadius: 10,
    },
    {
      icon: <>📊</>,
      title: "יעד מול ביצוע",
      content: (
        <>
          כל שורה מציגה את היעד, הביצוע בפועל, ההפרש והיתרה. צבע ירוק — עומד
          ביעד, אדום — חריגה מהתקציב.
        </>
      ),
      selector: "#onboarding-goals-table",
      side: "top",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
  ],
};
