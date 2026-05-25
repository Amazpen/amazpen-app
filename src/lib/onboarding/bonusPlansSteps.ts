import type { DriveStep } from "driver.js";

/**
 * שלבי הסיור של דף תכניות הבונוסים.
 * הדף מאפשר למנהל להגדיר תמריצים כספיים לעובדים לפי ביצועים מדידים.
 * הסיור גם מסביר את הרעיון וגם מדריך בפועל איך ליצור תכנית: הוא פותח את
 * הטופס אוטומטית ועובר שדה אחר שדה.
 *
 * הטופס נטען דינמית (React) רק בלחיצה על "תכנית חדשה", ולכן השלבים שמצביעים
 * על שדות הטופס משתמשים בדפוס ה-async-tour הרשמי של driver.js: השלב שלפני
 * הטופס מקבל onNextClick שפותח את הטופס, ממתין לרינדור, ואז קורא ל-moveNext.
 * בנוסף, לכל שלב טופס יש onHighlightStarted כדי שה-hook לא יסנן אותו מראש
 * (לפני שהטופס קיים).
 *
 * אין שימוש בתו em dash בתוכן.
 */

function isFormOpen() {
  return typeof document !== "undefined" && !!document.getElementById("onboarding-bonus-form");
}

/** פותח את טופס "תכנית חדשה" אם אינו פתוח. */
function openForm() {
  if (typeof document === "undefined" || isFormOpen()) return;
  (document.getElementById("onboarding-bonus-new") as HTMLElement | null)?.click();
}

/** סוגר את הטופס. */
function closeForm() {
  if (typeof document === "undefined") return;
  (document.getElementById("onboarding-bonus-form-close") as HTMLElement | null)?.click();
}

/** ממתין עד ששני animation frames עברו, כדי לתת ל-React לרנדר את הטופס. */
function nextFrames(cb: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(cb));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DriverLike = { moveNext: () => void; movePrevious: () => void };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDriver(options: any): DriverLike | undefined {
  return options?.driver;
}

export const bonusPlansSteps: DriveStep[] = [
  {
    popover: {
      title: "תכניות בונוסים ותגמול",
      description:
        "מה אם אפשר היה לגרום לעובדים לדאוג למספרים של העסק כאילו היו שלהם? זו המטרה של המסך הזה. כאן מגדירים תכניות בונוס שמתגמלות עובדים כשהם משפרים מדד מסוים: הורדת עלות העובדים, הגדלת ממוצע ההזמנה, צמצום הוצאות ועוד. נראה לך עכשיו גם את הרעיון וגם איך יוצרים תכנית צעד אחר צעד.",
    },
  },
  {
    element: "#onboarding-bonus-month",
    popover: {
      title: "תכנית לכל חודש",
      description:
        "תכניות הבונוס נקבעות לכל חודש בנפרד. כאן בוחרים את החודש והשנה, וכל התכניות והמעקב אחר הביצוע מתייחסים לתקופה הזו. כך אפשר להתאים את התמריצים מחודש לחודש.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-bonus-new",
    popover: {
      title: "בוא ניצור תכנית יחד",
      description:
        "כדי ליצור תכנית בונוס חדשה לוחצים כאן. לחיצה על 'הבא' תפתח עכשיו את הטופס ונעבור על כל שדה, כדי שתדע בדיוק איך מגדירים בונוס מהתחלה ועד הסוף.",
      side: "bottom",
      align: "start",
      // דפוס async-tour: פותחים את הטופס, ממתינים לרינדור, ואז עוברים לשלב הבא.
      onNextClick: (_el, _step, options) => {
        openForm();
        nextFrames(() => getDriver(options)?.moveNext());
      },
    },
  },
  {
    element: "#onboarding-bonus-field-employee",
    // onHighlightStarted מסמן ל-hook לא לסנן את השלב מראש (הטופס נוצר דינמית)
    onHighlightStarted: () => openForm(),
    popover: {
      title: "שלב 1: בחירת העובד",
      description:
        "קודם בוחרים את העובד שהבונוס מיועד לו. רק עובדים שמוגדרים בעסק יופיעו ברשימה. כל תכנית מתייחסת לעובד אחד ולמדד אחד שלו.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "#onboarding-bonus-field-source",
    onHighlightStarted: () => openForm(),
    popover: {
      title: "שלב 2: מה מודדים?",
      description:
        "כאן בוחרים את המדד שעליו יינתן הבונוס, למשל ממוצע להזמנה, אחוז עלות עובדים או מדד מותאם אישית. בנוסף קובעים אם מודדים באחוזים, בשקלים או בכמות, ואת הכיוון: 'גבוה = טוב' למדד כמו הכנסה, או 'נמוך = טוב' למדד כמו עלות. ההגדרה הזו קובעת מתי העובד נחשב כמשתפר.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "#onboarding-bonus-field-tiers",
    onHighlightStarted: () => openForm(),
    popover: {
      title: "שלב 3: רמות התגמול",
      description:
        "זה הלב של התכנית. מגדירים שלוש רמות עולות, ולכל אחת טווח ערכים וסכום בונוס: למשל 'עמידה ביעד' מזכה ב-1,000 ₪, 'שיפור קטן' ב-1,500 ₪, ו'שיפור משמעותי' ב-2,000 ₪. ככל שהעובד משיג תוצאה טובה יותר, כך הבונוס גדל. מערכת הרמות יוצרת תמריץ מדורג ששואף תמיד לשיפור.",
      side: "top",
      align: "center",
      // לפני המעבר לשלב הרשימה: סוגרים את הטופס, ממתינים לרינדור, ואז עוברים.
      onNextClick: (_el, _step, options) => {
        closeForm();
        nextFrames(() => getDriver(options)?.moveNext());
      },
    },
  },
  {
    element: "#onboarding-bonus-list",
    popover: {
      title: "מעקב אוטומטי וביצוע בפועל",
      description:
        "אחרי השמירה, התכנית מופיעה כאן. המערכת מחשבת אוטומטית את הביצוע בפועל של העובד החודש, מדגישה בירוק את הרמה שהוא עמד בה, ומציגה שורת 'מצב נוכחי' עם התוצאה מול היעד והבונוס שהושג. אפשר גם להגדיר פוש יומי שמעדכן את העובד, ולהפעיל, להשבית, לערוך או למחוק כל תכנית. כך כולם יודעים בכל רגע איפה הם עומדים.",
      side: "top",
      align: "center",
    },
  },
];
