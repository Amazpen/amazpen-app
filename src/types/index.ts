// User roles
export type UserRole = "admin" | "owner" | "employee";

// User
export interface User {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  avatar_url?: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Business
export interface Business {
  id: string;
  name: string;
  business_type: string;
  status: "active" | "inactive";
  tax_id?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  logo_url?: string;
  currency: string;
  fiscal_year_start: number;
  markup_percentage: number;
  vat_percentage: number;
  manager_monthly_salary: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

// Business Schedule (לוח עבודה שבועי)
export interface BusinessSchedule {
  id: string;
  business_id: string;
  day_of_week: number; // 0=Sunday, 6=Saturday
  day_factor: number; // 0-1 (0=סגור, 1=יום מלא, 0.5=חצי יום)
  created_at: string;
  updated_at: string;
}

// User-Business relationship
export interface UserBusiness {
  id: string;
  user_id: string;
  business_id: string;
  role: "owner" | "employee";
  created_at: string;
}

// Navigation items
export interface NavItem {
  title: string;
  href: string;
  icon: string;
}

// Input type for dynamic fields
export type InputType = "single" | "with_count";

// Settlement type for income sources
export type SettlementType = "daily" | "weekly" | "monthly" | "bimonthly" | "same_day" | "custom";

// Income Sources (מקורות הכנסה)
export interface IncomeSource {
  id: string;
  business_id: string;
  name: string;
  income_type: "private" | "business";
  input_type: InputType; // single=סכום בלבד, with_count=סכום+כמות
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  // Settlement rules (כללי תקבול)
  settlement_type: SettlementType;
  settlement_delay_days: number;
  settlement_day_of_week?: number;
  settlement_day_of_month?: number;
  bimonthly_first_cutoff?: number;
  bimonthly_first_settlement?: number;
  bimonthly_second_settlement?: number;
  commission_rate: number; // fee percentage (עמלת סליקה)
  coupon_settlement_date?: number;
  coupon_range_start?: number;
  coupon_range_end?: number;
}

// Cashflow Settings (הגדרות תזרים)
export interface CashflowSettings {
  id: string;
  business_id: string;
  opening_balance: number;
  opening_date: string;
  created_at: string;
  updated_at: string;
}

// Cashflow Income Override (עריכת הכנסה ידנית)
export interface CashflowIncomeOverride {
  id: string;
  business_id: string;
  settlement_date: string;
  income_source_id: string;
  original_amount: number;
  override_amount: number;
  note?: string;
  created_by?: string;
  created_at: string;
}

// Receipt Types (תקבולים)
export interface ReceiptType {
  id: string;
  business_id: string;
  name: string;
  input_type: InputType; // single=סכום בלבד, with_count=סכום+כמות
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

// Custom Parameters (פרמטרים נוספים)
export interface CustomParameter {
  id: string;
  business_id: string;
  name: string;
  input_type: InputType; // single=ערך בלבד, with_count=ערך+כמות
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

// Managed Products (מוצרים מנוהלים)
export interface ManagedProduct {
  id: string;
  business_id: string;
  name: string;
  unit: string;
  unit_cost: number;
  category?: string;
  current_stock: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

// Daily Entry (רישום יומי)
export interface DailyEntry {
  id: string;
  business_id: string;
  entry_date: string;
  total_register: number;
  labor_cost: number;
  labor_hours: number;
  discounts: number;
  day_factor: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  data_source?: string;
  is_fully_approved?: boolean;
}

// Daily Income Breakdown (פירוט הכנסות יומי)
export interface DailyIncomeBreakdown {
  id: string;
  daily_entry_id: string;
  income_source_id: string;
  amount: number;
  orders_count: number;
  created_at: string;
  updated_at: string;
}

// Daily Receipts (תקבולים יומיים)
export interface DailyReceipt {
  id: string;
  daily_entry_id: string;
  receipt_type_id: string;
  amount: number;
  created_at: string;
  updated_at: string;
}

// Daily Parameters (פרמטרים יומיים)
export interface DailyParameter {
  id: string;
  daily_entry_id: string;
  parameter_id: string;
  value: number;
  created_at: string;
  updated_at: string;
}

// Daily Product Usage (שימוש במוצרים יומי)
export interface DailyProductUsage {
  id: string;
  daily_entry_id: string;
  product_id: string;
  opening_stock: number;
  received_quantity: number;
  closing_stock: number;
  quantity: number;
  unit_cost_at_time: number;
  created_at: string;
  updated_at: string;
}
