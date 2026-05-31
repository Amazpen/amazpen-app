"use client";

import { TourHelpButton } from "./TourHelpButton";
import { customersSteps } from "@/lib/onboarding/customersSteps";

/**
 * אייקון מידע (?) לדף ניהול הלקוחות.
 * מפעיל את סיור הלקוחות, ומפעיל אותו אוטומטית בכניסה ראשונה.
 */
export function CustomersHelpButton() {
  return <TourHelpButton tourName="customers" steps={customersSteps} />;
}
