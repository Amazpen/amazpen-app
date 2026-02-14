export interface AiChartData {
  type: "bar" | "area";
  title: string;
  data: Array<Record<string, string | number>>;
  dataKeys: AiChartDataKey[];
  xAxisKey: string;
}

export interface AiChartDataKey {
  key: string;
  label: string;
  color: string;
}

export interface AiSuggestedQuestion {
  text: string;
  icon: "revenue" | "expenses" | "comparison" | "targets" | "summary" | "general";
}

// AI Action Types
export type AiActionType = "expense" | "payment" | "daily_entry";

export interface AiExpenseData {
  supplier_name?: string;
  supplier_id?: string;
  invoice_date?: string;
  invoice_number?: string;
  subtotal?: number;
  vat_amount?: number;
  total_amount?: number;
  invoice_type?: string;
  notes?: string;
}

export interface AiPaymentData {
  supplier_name?: string;
  supplier_id?: string;
  payment_date?: string;
  total_amount?: number;
  payment_method?: string;
  check_number?: string;
  reference_number?: string;
  notes?: string;
}

export interface AiDailyEntryData {
  entry_date?: string;
  total_register?: number;
  labor_cost?: number;
  labor_hours?: number;
  discounts?: number;
  notes?: string;
}

export interface AiSupplierLookup {
  found: boolean;
  id?: string;
  name?: string;
  needsCreation?: boolean;
}

export interface AiProposedAction {
  success: boolean;
  actionType: AiActionType;
  confidence: number;
  reasoning: string;
  businessId: string;
  expenseData?: AiExpenseData;
  paymentData?: AiPaymentData;
  dailyEntryData?: AiDailyEntryData;
  supplierLookup?: AiSupplierLookup | null;
}
