"use client";

import { TourHelpButton } from "./TourHelpButton";
import { suppliersSteps } from "@/lib/onboarding/suppliersSteps";

/**
 * אייקון מידע (?) לדף ניהול הספקים.
 * מפעיל את סיור הספקים, ומפעיל אותו אוטומטית בכניסה ראשונה.
 */
export function SuppliersHelpButton() {
  return <TourHelpButton tourName="suppliers" steps={suppliersSteps} />;
}
