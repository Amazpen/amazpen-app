"use client";

import { TourHelpButton } from "./TourHelpButton";
import { getReportsSteps } from "@/lib/onboarding/reportsSteps";

/**
 * אייקון מידע (?) לדף דוח רווח והפסד.
 * מעביר את getReportsSteps כפונקציה כדי שהשלבים יחושבו ברגע ההפעלה לפי
 * התצוגה הפעילה (חודשית/שנתית), שמציגות אזורים שונים בדף.
 */
export function ReportsHelpButton() {
  return <TourHelpButton tourName="reports" steps={getReportsSteps} />;
}
