"use client";

import { useCallback, useEffect, useRef } from "react";
import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";

const STORAGE_KEY = "amazpen:completedTours";

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
  /** מזהה ייחודי לסיור — נשמר ב-localStorage כדי לא לחזור על הסיור */
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
 *  - `start()` — מפעיל את הסיור מיד (להרצה חוזרת דרך אייקון העזרה).
 *  - `hasCompleted()` — האם הסיור כבר הושלם.
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
      steps,
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
