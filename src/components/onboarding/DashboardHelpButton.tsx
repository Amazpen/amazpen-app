"use client";

import { TourHelpButton } from "./TourHelpButton";
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
 */
export function DashboardHelpButton({ ready = true }: DashboardHelpButtonProps) {
  return (
    <TourHelpButton tourName="dashboard" steps={dashboardSteps} ready={ready} />
  );
}
