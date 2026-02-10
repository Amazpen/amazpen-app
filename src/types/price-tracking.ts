// Supplier Item - a product/item tracked per supplier
export interface SupplierItem {
  id: string;
  business_id: string;
  supplier_id: string;
  item_name: string;
  item_aliases: string[];
  unit?: string;
  current_price?: number;
  last_price_date?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined fields
  supplier_name?: string;
}

// Historical price record for a supplier item
export interface SupplierItemPrice {
  id: string;
  supplier_item_id: string;
  price: number;
  quantity?: number;
  invoice_id?: string;
  ocr_document_id?: string;
  document_date: string;
  notes?: string;
  created_at: string;
}

// Price change alert
export interface PriceAlert {
  id: string;
  business_id: string;
  supplier_item_id: string;
  supplier_id: string;
  ocr_document_id?: string;
  old_price: number;
  new_price: number;
  change_pct: number;
  document_date?: string;
  status: 'unread' | 'read' | 'dismissed';
  created_at: string;
  // Joined fields
  item_name?: string;
  supplier_name?: string;
}

// Price comparison result for OCR form display
export interface PriceComparison {
  item_description: string;
  current_price: number;
  previous_price: number | null;
  change_pct: number | null;
  is_new_item: boolean;
  supplier_item_id: string | null;
  quantity?: number;
  total?: number;
}
