"use client";

import { TourHelpButton } from "./TourHelpButton";
import { bonusPlansSteps } from "@/lib/onboarding/bonusPlansSteps";

/**
 * אייקון מידע (?) לדף תכניות הבונוסים.
 * מפעיל את סיור הבונוסים, ומפעיל אותו אוטומטית בכניסה ראשונה.
 */
export function BonusPlansHelpButton() {
  return <TourHelpButton tourName="bonus-plans" steps={bonusPlansSteps} />;
}
