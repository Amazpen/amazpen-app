"use client";

import { TourHelpButton } from "./TourHelpButton";
import { expensesSteps } from "@/lib/onboarding/expensesSteps";

/**
 * אייקון מידע (?) לדף ניהול ההוצאות.
 * מפעיל את סיור ההוצאות, ומפעיל אותו אוטומטית בכניסה ראשונה.
 */
export function ExpensesHelpButton() {
  return <TourHelpButton tourName="expenses" steps={expensesSteps} />;
}
