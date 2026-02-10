import { Tour } from "nextstepjs";

export const ocrTour: Tour = {
  tour: "ocr",
  steps: [
    {
      icon: <>📸</>,
      title: "קליטת מסמכים OCR",
      content: (
        <>
          כאן תוכל לסרוק חשבוניות ומסמכים אוטומטית. המערכת מזהה את הטקסט ומחלצת
          את הנתונים בצורה חכמה.
        </>
      ),
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 0,
      pointerRadius: 0,
    },
    {
      icon: <>📤</>,
      title: "העלאת מסמך",
      content: (
        <>
          גרור קובץ או לחץ כדי להעלות חשבונית. המערכת תומכת בתמונות (JPG, PNG)
          וקבצי PDF.
        </>
      ),
      selector: "#onboarding-ocr-upload",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
    {
      icon: <>📋</>,
      title: "תור מסמכים",
      content: (
        <>
          כאן מוצגים כל המסמכים שהועלו. סנן לפי סטטוס: ממתין, מאושר או דורש
          תיקון.
        </>
      ),
      selector: "#onboarding-ocr-queue",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
    {
      icon: <>✅</>,
      title: "נתונים שחולצו",
      content: (
        <>
          לאחר סריקה, המערכת מציגה את הנתונים שחולצו. בדוק את הנתונים, תקן במידת
          הצורך ואשר ליצירת חשבונית.
        </>
      ),
      selector: "#onboarding-ocr-form",
      side: "bottom",
      showControls: true,
      showSkip: true,
      pointerPadding: 10,
      pointerRadius: 12,
    },
  ],
};
