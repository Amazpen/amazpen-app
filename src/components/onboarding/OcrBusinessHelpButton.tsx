"use client";

import { TourHelpButton } from "./TourHelpButton";
import { ocrBusinessSteps } from "@/lib/onboarding/ocrBusinessSteps";

/**
 * אייקון מידע (?) לדף קליטת המסמכים (OCR).
 * מפעיל את סיור ה-OCR, ומפעיל אותו אוטומטית בכניסה ראשונה.
 */
export function OcrBusinessHelpButton() {
  return <TourHelpButton tourName="ocr-business" steps={ocrBusinessSteps} />;
}
