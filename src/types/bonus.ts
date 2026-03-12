export interface BonusPlan {
  id: string;
  business_id: string;
  employee_user_id: string;
  area_name: string;
  measurement_type: "percentage" | "currency" | "quantity";
  data_source: string;
  is_lower_better: boolean;
  custom_source_label: string | null;
  tier1_label: string;
  tier1_threshold: number | null;
  tier1_threshold_max: number | null;
  tier1_amount: number;
  tier2_label: string;
  tier2_threshold: number | null;
  tier2_threshold_max: number | null;
  tier2_amount: number;
  tier3_label: string;
  tier3_threshold: number | null;
  tier3_threshold_max: number | null;
  tier3_amount: number;
  push_enabled: boolean;
  push_hour: number;
  is_active: boolean;
  notes: string | null;
  tips: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface BonusPlanStatus {
  currentValue: number | null;
  goalValue: number | null;
  qualifiedTier: 1 | 2 | 3 | null;
  bonusAmount: number;
}

export interface DataSourceOption {
  value: string;
  label: string;
  measurementType: "percentage" | "currency" | "quantity";
  isLowerBetter: boolean;
}

export const DATA_SOURCE_OPTIONS: DataSourceOption[] = [
  // --- דשבורד: הכנסות ---
  { value: "revenue", label: "סה״כ מכירות (צפי חודשי)", measurementType: "currency", isLowerBetter: false },
  { value: "avg_ticket_1", label: "ממוצע להזמנה — מקור 1", measurementType: "currency", isLowerBetter: false },
  { value: "avg_ticket_2", label: "ממוצע להזמנה — מקור 2", measurementType: "currency", isLowerBetter: false },
  { value: "avg_ticket_3", label: "ממוצע להזמנה — מקור 3", measurementType: "currency", isLowerBetter: false },
  // --- דשבורד: עלויות ---
  { value: "labor_cost_pct", label: "עלות עובדים (%)", measurementType: "percentage", isLowerBetter: true },
  { value: "food_cost_pct", label: "עלות מכר (%)", measurementType: "percentage", isLowerBetter: true },
  { value: "current_expenses", label: "הוצאות שוטפות", measurementType: "currency", isLowerBetter: true },
  { value: "goods_expenses", label: "רכישות סחורה", measurementType: "currency", isLowerBetter: true },
  // --- דשבורד: מוצרים מנוהלים ---
  { value: "managed_product_1", label: "מוצר מנוהל 1", measurementType: "percentage", isLowerBetter: true },
  { value: "managed_product_2", label: "מוצר מנוהל 2", measurementType: "percentage", isLowerBetter: true },
  { value: "managed_product_3", label: "מוצר מנוהל 3", measurementType: "percentage", isLowerBetter: true },
  // --- דוח רווח והפסד ---
  { value: "profitability", label: "רווחיות (מדוח רו״ה)", measurementType: "currency", isLowerBetter: false },
  // --- מותאם אישית ---
  { value: "custom", label: "מותאם אישית", measurementType: "quantity", isLowerBetter: true },
];
