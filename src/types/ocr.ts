// OCR Document Types

export type DocumentSource = 'telegram' | 'whatsapp' | 'email' | 'upload';

export type DocumentStatus = 'pending' | 'reviewing' | 'approved' | 'rejected';

export type DocumentType = 'invoice' | 'delivery_note' | 'credit_note' | 'payment' | 'summary';

export type ExpenseType = 'goods' | 'current';

export interface OCRLineItem {
  id?: string;
  description?: string;
  quantity?: number;
  unit_price?: number;
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
  customInstallments: Array<{
    number: number;
    date: string;
    dateForInput: string;
    amount: number;
  }>;
}

export interface OCRFormData {
  business_id: string;
  document_type: DocumentType;
  expense_type: ExpenseType;
  supplier_id: string;
  document_date: string;
  document_number: string;
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
  // Line items for price tracking
  line_items?: OCRLineItem[];
}

// Helper functions
export function getStatusLabel(status: DocumentStatus): string {
  const labels: Record<DocumentStatus, string> = {
    pending: 'ממתין',
    reviewing: 'בבדיקה',
    approved: 'אושר',
    rejected: 'נדחה',
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
  };
  return labels[type];
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
