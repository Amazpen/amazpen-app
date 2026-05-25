"use client";

import { TourHelpButton } from "./TourHelpButton";
import { paymentsSteps } from "@/lib/onboarding/paymentsSteps";

/**
 * אייקון מידע (?) לדף ניהול התשלומים.
 * מפעיל את סיור התשלומים, ומפעיל אותו אוטומטית בכניסה ראשונה.
 */
export function PaymentsHelpButton() {
  return <TourHelpButton tourName="payments" steps={paymentsSteps} />;
}
