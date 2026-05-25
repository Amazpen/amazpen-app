"use client";

import { TourHelpButton } from "./TourHelpButton";
import { reportsSteps } from "@/lib/onboarding/reportsSteps";

/**
 * אייקון מידע (?) לדף דוח רווח והפסד.
 * מפעיל את סיור הדוח, ומפעיל אותו אוטומטית בכניסה ראשונה.
 */
export function ReportsHelpButton() {
  return <TourHelpButton tourName="reports" steps={reportsSteps} />;
}
