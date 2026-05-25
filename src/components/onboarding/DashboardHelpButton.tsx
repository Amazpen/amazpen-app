"use client";

import { useDriverTour } from "@/hooks/useDriverTour";
import { dashboardSteps } from "@/lib/onboarding/dashboardSteps";

interface DashboardHelpButtonProps {
  /**
   * נעשה true כשתוכן הדשבורד נטען (עסקים + נתונים) כדי שה-auto-start
   * יחכה לרינדור מלא לפני שמפעיל את הסיור בכניסה ראשונה.
   */
  ready?: boolean;
}

/**
 * אייקון מידע (?) לדף הדשבורד + הפעלה אוטומטית של הסיור בכניסה ראשונה.
 * משתמש ב-driver.js (תומך RTL אוטומטית) ובמופע יחיד של הסיור. לחיצה על
 * האייקון והפעלה אוטומטית חולקים את אותו hook.
 * עוצב להתאים בדיוק לסטייל כפתור החיפוש שלצד הכותרת "לקוחות".
 */
export function DashboardHelpButton({ ready = true }: DashboardHelpButtonProps) {
  const { start } = useDriverTour({
    tourName: "dashboard",
    steps: dashboardSteps,
    autoStart: true,
    ready,
  });

  return (
    <button
      type="button"
      aria-label="הצג מדריך"
      title="הצג מדריך"
      onClick={start}
      className="w-[40px] h-[40px] sm:w-[34px] sm:h-[34px] flex-shrink-0 flex items-center justify-center rounded-full bg-[#FFA412] text-white hover:bg-[#e8950c] transition-colors cursor-pointer touch-manipulation shadow-sm"
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
