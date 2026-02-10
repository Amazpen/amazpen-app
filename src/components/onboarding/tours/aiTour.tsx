import { Tour } from "nextstepjs";

export const aiTour: Tour = {
  tour: "ai",
  steps: [
    {
      icon: <>🤖</>,
      title: "עוזר AI",
      content: (
        <>
          העוזר החכם שלך לניתוח נתונים עסקיים. שאל שאלות בעברית וקבל תובנות
          מותאמות אישית על העסק שלך.
        </>
      ),
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 0,
      pointerRadius: 0,
    },
    {
      icon: <>💡</>,
      title: "שאלות מוצעות",
      content: (
        <>
          לחץ על אחת מהשאלות המוצעות כדי להתחיל שיחה. השאלות מותאמות לנתוני העסק
          שלך.
        </>
      ),
      selector: "#onboarding-ai-suggestions",
      side: "top",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
    {
      icon: <>⌨️</>,
      title: "שדה הקלדה",
      content: (
        <>
          הקלד שאלה חופשית בעברית. לדוגמה: ״מה מגמת ההכנסות החודש?״ או ״איפה
          ההוצאות הכי גבוהות?״
        </>
      ),
      selector: "#onboarding-ai-input",
      side: "top",
      showControls: true,
      showSkip: true,
      pointerPadding: 8,
      pointerRadius: 10,
    },
  ],
};
