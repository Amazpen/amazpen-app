export interface BonusPlan {
  id: string;
  business_id: string;
  employee_user_id: string;
  area_name: string;
  measurement_type: "percentage" | "currency";
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
  measurementType: "percentage" | "currency";
  isLowerBetter: boolean;
}

export const DATA_SOURCE_OPTIONS: DataSourceOption[] = [
  { value: "labor_cost_pct", label: "עלות עובדים", measurementType: "percentage", isLowerBetter: true },
  { value: "food_cost_pct", label: "עלות מכר", measurementType: "percentage", isLowerBetter: true },
  { value: "revenue", label: "הכנסות (צפי חודשי)", measurementType: "currency", isLowerBetter: false },
  { value: "current_expenses", label: "הוצאות שוטפות", measurementType: "currency", isLowerBetter: true },
  { value: "goods_expenses", label: "רכישות סחורה", measurementType: "currency", isLowerBetter: true },
  { value: "custom", label: "מותאם אישית", measurementType: "percentage", isLowerBetter: true },
];
