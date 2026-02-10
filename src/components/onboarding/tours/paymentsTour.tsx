import { Tour } from "nextstepjs";

export const paymentsTour: Tour = {
  tour: "payments",
  steps: [
    {
      icon: <>💳</>,
      title: "ניהול תשלומים",
      content: (
        <>
          כאן תנהל את כל התשלומים של העסק. צפה בהתפלגות אמצעי תשלום, ייבא קבצי
          CSV וצור תשלומים חדשים.
        </>
      ),
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 0,
      pointerRadius: 0,
    },
    {
      icon: <>🥧</>,
      title: "התפלגות תשלומים",
      content: (
        <>
          גרף העוגה מציג את ההתפלגות של אמצעי התשלום השונים — מזומן, אשראי,
          העברות בנקאיות ועוד.
        </>
      ),
      selector: "#onboarding-payments-chart",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
    {
      icon: <>📋</>,
      title: "רשימת תשלומים",
      content: (
        <>
          צפה בכל התשלומים האחרונים. לחץ על תשלום לצפייה בפרטים או לעריכה.
        </>
      ),
      selector: "#onboarding-payments-list",
      side: "top",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
    {
      icon: <>📥</>,
      title: "ייבוא מ-CSV",
      content: (
        <>
          ייבא תשלומים ממערכות חיצוניות באמצעות קובץ CSV. המערכת תזהה אוטומטית
          את השדות הרלוונטיים.
        </>
      ),
      selector: "#onboarding-payments-import",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 8,
      pointerRadius: 10,
    },
  ],
};
