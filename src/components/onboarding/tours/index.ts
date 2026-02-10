import { dashboardTour } from "./dashboardTour";
import { expensesTour } from "./expensesTour";
import { suppliersTour } from "./suppliersTour";
import { paymentsTour } from "./paymentsTour";
import { goalsTour } from "./goalsTour";
import { reportsTour } from "./reportsTour";
import { ocrTour } from "./ocrTour";
import { aiTour } from "./aiTour";
import { settingsTour } from "./settingsTour";

export const allTours = [
  dashboardTour,
  expensesTour,
  suppliersTour,
  paymentsTour,
  goalsTour,
  reportsTour,
  ocrTour,
  aiTour,
  settingsTour,
];

export const tourNameForPath: Record<string, string> = {
  "/": "dashboard",
  "/expenses": "expenses",
  "/suppliers": "suppliers",
  "/payments": "payments",
  "/goals": "goals",
  "/reports": "reports",
  "/ocr": "ocr",
  "/ai": "ai",
  "/settings": "settings",
};
