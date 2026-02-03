// OCR Document Types

export type DocumentSource = 'telegram' | 'whatsapp' | 'email' | 'upload';

export type DocumentStatus = 'pending' | 'reviewing' | 'approved' | 'rejected';

export type DocumentType = 'invoice' | 'delivery_note' | 'credit_note' | 'payment';

export type ExpenseType = 'goods' | 'current';

export interface OCRLineItem {
  description?: string;
  quantity?: number;
  unit_price?: number;
  total?: number;
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
}

export interface OCRDocument {
  id: string;
  business_id: string;
  source: DocumentSource;
  image_url: string;
  status: DocumentStatus;
  document_type?: DocumentType;
  expense_type?: ExpenseType;
  ocr_data?: OCRExtractedData;
  created_at: string;
  processed_at?: string;
  reviewed_by?: string;
  notes?: string;
}

export interface OCRFormData {
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
}

// Mock data for UI development
export const MOCK_DOCUMENTS: OCRDocument[] = [
  {
    id: '1',
    business_id: 'biz-1',
    source: 'whatsapp',
    image_url: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800',
    status: 'pending',
    document_type: 'invoice',
    expense_type: 'goods',
    ocr_data: {
      supplier_name: 'ספק לדוגמה בע"מ',
      supplier_tax_id: '514567890',
      document_number: 'INV-2024-001',
      document_date: '2024-01-15',
      subtotal: 1000,
      vat_amount: 170,
      total_amount: 1170,
      confidence_score: 0.95,
    },
    created_at: '2024-01-15T10:30:00Z',
  },
  {
    id: '2',
    business_id: 'biz-1',
    source: 'telegram',
    image_url: 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=800',
    status: 'pending',
    document_type: 'delivery_note',
    ocr_data: {
      supplier_name: 'חברת משלוחים',
      document_number: 'DN-2024-055',
      document_date: '2024-01-14',
      subtotal: 500,
      vat_amount: 85,
      total_amount: 585,
      confidence_score: 0.88,
    },
    created_at: '2024-01-14T14:20:00Z',
  },
  {
    id: '3',
    business_id: 'biz-1',
    source: 'email',
    image_url: 'https://images.unsplash.com/photo-1554224155-1696413565d3?w=800',
    status: 'reviewing',
    document_type: 'invoice',
    expense_type: 'current',
    ocr_data: {
      supplier_name: 'חברת חשמל',
      document_number: 'ELEC-2024-789',
      document_date: '2024-01-13',
      subtotal: 850,
      vat_amount: 144.5,
      total_amount: 994.5,
      confidence_score: 0.92,
    },
    created_at: '2024-01-13T09:15:00Z',
  },
  {
    id: '4',
    business_id: 'biz-1',
    source: 'whatsapp',
    image_url: 'https://images.unsplash.com/photo-1586953208448-b95a79798f07?w=800',
    status: 'pending',
    created_at: '2024-01-12T16:45:00Z',
  },
  {
    id: '5',
    business_id: 'biz-1',
    source: 'upload',
    image_url: 'https://images.unsplash.com/photo-1554224154-26032ffc0d07?w=800',
    status: 'approved',
    document_type: 'payment',
    ocr_data: {
      supplier_name: 'ספק מאושר',
      document_number: 'PAY-2024-100',
      document_date: '2024-01-11',
      total_amount: 2500,
      confidence_score: 0.97,
    },
    created_at: '2024-01-11T11:00:00Z',
    processed_at: '2024-01-11T11:30:00Z',
    reviewed_by: 'user-1',
  },
];

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
