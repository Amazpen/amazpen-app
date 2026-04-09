// OCR Document Types

export type DocumentSource = 'telegram' | 'whatsapp' | 'email' | 'upload';

export type DocumentStatus = 'pending' | 'reviewing' | 'approved' | 'rejected' | 'archived';

export type DocumentType = 'invoice' | 'delivery_note' | 'credit_note' | 'payment' | 'summary' | 'daily_entry' | 'disputed_invoice' | 'partially_paid';

export type ExpenseType = 'goods' | 'current' | 'employee_costs';

export interface OCRLineItem {
  id?: string;
  description?: string;
  quantity?: number;
  unit_price?: number;
  discount_amount?: number;
  discount_type?: 'amount' | 'percent';
  total?: number;
  // Price tracking fields (populated client-side)
  matched_supplier_item_id?: string;
  previous_price?: number | null;
  price_change_pct?: number | null;
  is_new_item?: boolean;
}

export interface OCRExtractedData {
  supplier_name?: string;
  supplier_tax_id?: string;
  document_number?: string;
  document_date?: string;
  discount_amount?: number;
  discount_percentage?: number;
  subtotal?: number;
  vat_amount?: number;
  total_amount?: number;
  line_items?: OCRLineItem[];
  confidence_score?: number;
  raw_text?: string;
  matched_supplier_id?: string;
}

export interface OCRDocument {
  id: string;
  business_id: string;
  source: DocumentSource;
  source_sender_name?: string;
  source_sender_phone?: string;
  image_url: string;
  original_filename?: string;
  file_type?: string;
  status: DocumentStatus;
  document_type?: DocumentType;
  expense_type?: ExpenseType;
  ocr_data?: OCRExtractedData;
  created_at: string;
  processed_at?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  notes?: string;
  rejection_reason?: string;
  created_invoice_id?: string;
  created_payment_id?: string;
  created_delivery_note_id?: string;
}

export interface OCRDeliveryNoteEntry {
  delivery_note_number: string;
  delivery_date: string;
  total_amount: string;
  notes: string;
}

export interface OCRPaymentMethodEntry {
  id: number;
  method: string;
  amount: string;
  installments: string;
  checkNumber: string;
  creditCardId: string;
  customInstallments: Array<{
    number: number;
    date: string;
    dateForInput: string;
    amount: number;
    checkNumber?: string;
  }>;
}

export interface OCRFormData {
  business_id: string;
  document_type: DocumentType;
  expense_type: ExpenseType;
  supplier_id: string;
  document_date: string;
  document_number: string;
  discount_amount?: string;
  discount_percentage?: string;
  amount_before_vat: string;
  vat_amount: string;
  total_amount: string;
  notes: string;
  is_paid: boolean;
  payment_method?: string;
  payment_date?: string;
  payment_installments?: number;
  payment_reference?: string;
  payment_notes?: string;
  // Payment methods array (for payment tab and inline payment)
  payment_methods?: OCRPaymentMethodEntry[];
  // Summary (מרכזת) specific fields
  summary_delivery_notes?: OCRDeliveryNoteEntry[];
  summary_is_closed?: string;
  summary_existing_delivery_note_ids?: string[];
  // Dispute reason (for disputed_invoice)
  dispute_reason?: string;
  // Fixed expense: when supplier is_fixed_expense, link to existing pending invoice
  // (null/undefined = create new invoice; string = update existing invoice id)
  link_to_fixed_invoice_id?: string | null;
  // Payment tab: link this payment to one or more open invoices.
  // Empty array = unlinked payment (legacy behaviour).
  payment_linked_invoice_ids?: string[];
  // Line items for price tracking
  line_items?: OCRLineItem[];
  // Daily entry (רישום יומי) fields
  daily_entry_date?: string;
  daily_total_register?: string;
  daily_day_factor?: string;
  daily_labor_cost?: string;
  daily_labor_hours?: string;
  daily_discounts?: string;
  daily_income_data?: Record<string, { amount: string; orders_count: string }>;
  daily_receipt_data?: Record<string, string>;
  daily_parameter_data?: Record<string, string>;
  daily_product_usage?: Record<string, { opening_stock: string; received_quantity: string; closing_stock: string }>;
  daily_managed_products?: Array<{ id: string; unit_cost: number }>;
  // Pearla-specific daily entry fields
  daily_pearla_data?: {
    portions_count: string;
    serving_supplement: string;
    extras_income: string;
    salaried_labor_cost: string;
    manpower_labor_cost: string;
  };
}

// Helper functions
export function getStatusLabel(status: DocumentStatus): string {
  const labels: Record<DocumentStatus, string> = {
    pending: 'ממתין',
    reviewing: 'בבדיקה',
    approved: 'אושר',
    rejected: 'נדחה',
    archived: 'ארכיון',
  };
  return labels[status];
}

export function getDocumentTypeLabel(type: DocumentType): string {
  const labels: Record<DocumentType, string> = {
    invoice: 'חשבונית',
    delivery_note: 'תעודת משלוח',
    credit_note: 'זיכוי',
    payment: 'תשלום',
    summary: 'מרכזת',
    daily_entry: 'רישום יומי',
    disputed_invoice: 'חשבונית בבירור',
    partially_paid: 'תעודה שלא שולמה במלואה',
  };
  return labels[type];
}

export function getDocumentTypeColor(type: DocumentType): string {
  const colors: Record<DocumentType, string> = {
    invoice: '#3B82F6',           // כחול
    delivery_note: '#9CA3AF',     // אפור
    credit_note: '#EF4444',       // אדום
    payment: '#22C55E',           // ירוק
    summary: '#A855F7',           // סגול
    daily_entry: '#F59E0B',       // כתום
    disputed_invoice: '#F97316',  // כתום-אדום
    partially_paid: '#EAB308',    // צהוב
  };
  return colors[type] || '#9CA3AF';
}

export function getSourceIcon(source: DocumentSource): string {
  const icons: Record<DocumentSource, string> = {
    telegram: '✈️',
    whatsapp: '💬',
    email: '📧',
    upload: '📤',
  };
  return icons[source];
}

export function getSourceLabel(source: DocumentSource): string {
  const labels: Record<DocumentSource, string> = {
    telegram: 'טלגרם',
    whatsapp: 'וואטסאפ',
    email: 'מייל',
    upload: 'העלאה',
  };
  return labels[source];
}
