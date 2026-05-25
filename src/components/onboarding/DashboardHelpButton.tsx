"use client";

import { useNextStep } from "nextstepjs";
import { useOnboarding } from "@/hooks/useOnboarding";

/**
 * אייקון מידע (?) לדף הדשבורד.
 * מאפס את הסיור "dashboard" ומפעיל אותו מחדש בלחיצה.
 * עוצב להתאים בדיוק לסטייל כפתור החיפוש שלצד הכותרת "לקוחות".
 */
export function DashboardHelpButton() {
  const { startNextStep } = useNextStep();
  const { resetTour } = useOnboarding();

  const handleClick = () => {
    resetTour("dashboard");
    startNextStep("dashboard");
  };

  return (
    <button
      type="button"
      aria-label="הצג מדריך"
      title="הצג מדריך"
      onClick={handleClick}
      className="w-[40px] h-[40px] sm:w-[30px] sm:h-[30px] flex-shrink-0 flex items-center justify-center text-[#4C526B] hover:text-[#7B91B0] transition-colors cursor-pointer touch-manipulation"
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
