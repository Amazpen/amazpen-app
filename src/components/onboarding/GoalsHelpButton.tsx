"use client";

import { TourHelpButton } from "./TourHelpButton";
import { goalsSteps } from "@/lib/onboarding/goalsSteps";

/**
 * אייקון מידע (?) לדף היעדים.
 * מפעיל את סיור היעדים, ומפעיל אותו אוטומטית בכניסה ראשונה.
 */
export function GoalsHelpButton() {
  return <TourHelpButton tourName="goals" steps={goalsSteps} />;
}
