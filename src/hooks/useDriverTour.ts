"use client";

import { useCallback, useEffect, useRef } from "react";
import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";

const STORAGE_KEY = "amazpen:completedTours";

// אותו אייקון X (lucide-x) כמו בשאר כפתורי הסגירה במערכת (במקום התו "×" של driver.js)
const CLOSE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>' +
  "</svg>";

// לוגו Amazpen הלבן, מוצג בקטן בראש כרטיס הסיור
const LOGO_URL =
  "https://ae8ccc76b2d94d531551691b1d6411c9.cdn.bubble.io/cdn-cgi/image/w=192,h=88,f=auto,dpr=2,fit=contain/f1740495696315x242439751655884480/logo%20white.png";
const LOGO_HTML =
  '<div class="amazpen-driver-logo">' +
  `<img src="${LOGO_URL}" alt="Amazpen" width="96" height="44" />` +
  "</div>";

function readCompleted(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function markCompleted(tourName: string) {
  if (typeof window === "undefined") return;
  try {
    const current = readCompleted();
    current[tourName] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

interface UseDriverTourOptions {
  /** מזהה ייחודי לסיור, נשמר ב-localStorage כדי לא לחזור על הסיור */
  tourName: string;
  /** שלבי הסיור */
  steps: DriveStep[];
  /**
   * האם להפעיל אוטומטית בכניסה ראשונה (כשהסיור לא הושלם).
   * ברירת מחדל: false. הפעל רק כשתוכן הדף מוכן (ראה `ready`).
   */
  autoStart?: boolean;
  /**
   * נעשה true רק כשתוכן הדף נטען והאלמנטים קיימים ב-DOM.
   * ה-auto-start ימתין לזה לפני הפעלה.
   */
  ready?: boolean;
}

/**
 * Hook להפעלת סיור onboarding מבוסס driver.js.
 * driver.js תומך RTL אוטומטית (קורא את dir של המסמך), בניגוד ל-nextstepjs.
 *
 * מחזיר:
 *  - `start()`: מפעיל את הסיור מיד (להרצה חוזרת דרך אייקון העזרה).
 *  - `hasCompleted()`: האם הסיור כבר הושלם.
 */
export function useDriverTour({
  tourName,
  steps,
  autoStart = false,
  ready = true,
}: UseDriverTourOptions) {
  const driverRef = useRef<Driver | null>(null);
  const autoStartedRef = useRef(false);

  // נקה את ה-driver כשהקומפוננטה יורדת מהמסך כדי לא להשאיר overlay תקוע
  useEffect(() => {
    return () => {
      driverRef.current?.destroy();
      driverRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    // הרוס מופע קודם אם קיים (הרצה חוזרת)
    driverRef.current?.destroy();

    const d = driver({
      showProgress: true,
      progressText: "{{current}} מתוך {{total}}",
      nextBtnText: "הבא",
      prevBtnText: "הקודם",
      doneBtnText: "סיום",
      overlayColor: "#0F1231",
      overlayOpacity: 0.8,
      stagePadding: 8,
      stageRadius: 10,
      popoverClass: "amazpen-driver-popover",
      smoothScroll: true,
      // הצג כפתור X בכל שלב כדי שהמשתמש יוכל לצאת מהסיור מתי שירצה
      showButtons: ["next", "previous", "close"],
      // לחיצה על הרקע סוגרת את הסיור
      allowClose: true,
      steps,
      onPopoverRender: (popover) => {
        // החלף את התו "×" של driver.js ב-SVG הסטנדרטי של המערכת
        if (popover.closeButton) {
          popover.closeButton.innerHTML = CLOSE_ICON_SVG;
        }
        // הוסף את לוגו Amazpen בראש הכרטיס (לפני הכותרת), פעם אחת
        if (popover.wrapper && !popover.wrapper.querySelector(".amazpen-driver-logo")) {
          popover.wrapper.insertAdjacentHTML("afterbegin", LOGO_HTML);
        }
      },
      onDestroyed: () => {
        markCompleted(tourName);
      },
    });

    driverRef.current = d;
    d.drive();
  }, [steps, tourName]);

  // הפעלה אוטומטית בכניסה ראשונה
  useEffect(() => {
    if (!autoStart || !ready) return;
    if (autoStartedRef.current) return;
    if (readCompleted()[tourName]) return;

    autoStartedRef.current = true;
    // השהיה קצרה לאפשר hydration + רינדור מלא של הדף
    const timer = setTimeout(() => {
      // ודא שהאלמנט הראשון עם selector קיים לפני הפעלה
      start();
    }, 1200);

    return () => clearTimeout(timer);
  }, [autoStart, ready, tourName, start]);

  return {
    start,
    hasCompleted: useCallback(() => !!readCompleted()[tourName], [tourName]),
  };
}
