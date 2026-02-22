export type ApprovalStatus = 'pending' | 'approved';
export type DataSource = 'manual' | 'ocr' | 'whatsapp' | 'email' | 'api';
export type InvoiceApprovalStatus = 'pending_review' | 'approved';
export type ReminderType = 'missing_daily' | 'pending_approval' | 'missing_invoices';
export type ReminderChannel = 'push' | 'whatsapp' | 'email';

export interface DailyEntryApproval {
  id: string;
  daily_entry_id: string;
  business_id: string;
  field_name: string;
  status: ApprovalStatus;
  source: DataSource;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface DataReminder {
  id: string;
  business_id: string;
  reminder_type: ReminderType;
  reference_date: string;
  sent_at: string;
  sent_to: string;
  channel: ReminderChannel;
}

export const FIELD_LABELS: Record<string, string> = {
  total_register: 'סה"כ קופה',
  labor_cost: 'עלות עובדים',
  labor_hours: 'שעות עובדים',
  discounts: 'הנחות',
  food_cost: 'עלות מכר',
  current_expenses: 'הוצאות שוטפות',
  avg_private: 'ממוצע פרטי',
  avg_business: 'ממוצע עסקי',
};

export const CARD_FIELD_MAP: Record<string, string[]> = {
  totalIncome: ['total_register'],
  laborCost: ['labor_cost', 'labor_hours'],
  foodCost: ['food_cost'],
  currentExpenses: ['current_expenses'],
  avgPrivate: ['avg_private'],
  avgBusiness: ['avg_business'],
};
