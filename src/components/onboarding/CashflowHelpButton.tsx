"use client";

import { TourHelpButton } from "./TourHelpButton";
import { cashflowSteps } from "@/lib/onboarding/cashflowSteps";

/**
 * אייקון מידע (?) לדף תזרים המזומנים.
 * מפעיל את סיור התזרים, ומפעיל אותו אוטומטית בכניסה ראשונה.
 */
export function CashflowHelpButton() {
  return <TourHelpButton tourName="cashflow" steps={cashflowSteps} />;
}
