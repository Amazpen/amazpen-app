"use client";

import type { DriveStep } from "driver.js";
import { useDriverTour } from "@/hooks/useDriverTour";

interface TourHelpButtonProps {
  /** מזהה ייחודי לסיור (נשמר ב-localStorage) */
  tourName: string;
  /** שלבי הסיור: מערך קבוע או פונקציה שמחושבת ברגע ההפעלה */
  steps: DriveStep[] | (() => DriveStep[]);
  /** הפעלה אוטומטית בכניסה ראשונה (ברירת מחדל: true) */
  autoStart?: boolean;
  /** נעשה true כשתוכן הדף מוכן, כדי לעכב את ה-auto-start עד לרינדור מלא */
  ready?: boolean;
}

/**
 * אייקון מידע (?) גנרי להפעלת סיור onboarding בכל דף.
 * מציג כפתור כתום מרובע (rounded-[7px]) בסטייל המערכת, ומריץ את הסיור
 * בלחיצה. כשהדף נטען לראשונה הסיור מופעל אוטומטית (אם autoStart).
 */
export function TourHelpButton({
  tourName,
  steps,
  autoStart = true,
  ready = true,
}: TourHelpButtonProps) {
  const { start } = useDriverTour({ tourName, steps, autoStart, ready });

  return (
    <button
      type="button"
      aria-label="הצג מדריך"
      title="הצג מדריך"
      onClick={start}
      className="w-[40px] h-[40px] sm:w-[34px] sm:h-[34px] flex-shrink-0 flex items-center justify-center rounded-[7px] bg-[#FFA412] text-white hover:bg-[#e8950c] transition-colors cursor-pointer touch-manipulation shadow-sm"
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        className="sm:w-5 sm:h-5"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
        <path
          d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="17" r="1" fill="currentColor" />
      </svg>
    </button>
  );
}
