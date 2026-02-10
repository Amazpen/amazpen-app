import { Tour } from "nextstepjs";

export const settingsTour: Tour = {
  tour: "settings",
  steps: [
    {
      icon: <>⚙️</>,
      title: "הגדרות",
      content: (
        <>
          כאן תוכל לעדכן את פרטי הפרופיל שלך, להחליף תמונה ולצפות בעסקים שאתה
          משויך אליהם.
        </>
      ),
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 0,
      pointerRadius: 0,
    },
    {
      icon: <>👤</>,
      title: "פרטי פרופיל",
      content: (
        <>
          עדכן את השם המלא ומספר הטלפון שלך. לחץ על תמונת הפרופיל כדי להעלות
          תמונה חדשה.
        </>
      ),
      selector: "#onboarding-settings-profile",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
    {
      icon: <>🏢</>,
      title: "העסקים שלך",
      content: (
        <>
          כאן מוצגים כל העסקים שאתה משויך אליהם והתפקיד שלך בכל עסק.
        </>
      ),
      selector: "#onboarding-settings-businesses",
      side: "top",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
  ],
};
