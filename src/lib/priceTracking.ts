import type { SupabaseClient } from '@supabase/supabase-js';
import type { OCRLineItem } from '@/types/ocr';

export interface SavePriceTrackingParams {
  businessId: string;
  supplierId: string;
  invoiceId: string | null;
  ocrDocumentId?: string | null;
  documentDate: string;
  lineItems: OCRLineItem[];
}

/**
 * Save price tracking data for line items.
 * Finds or creates supplier_items, records price history, and generates alerts on price changes.
 * Called from both OCR approval and manual expense creation.
 * Errors are caught per-item — a single item failure won't break the whole batch.
 */
export async function savePriceTrackingForLineItems(
  supabase: SupabaseClient,
  params: SavePriceTrackingParams
): Promise<void> {
  const { businessId, supplierId, invoiceId, ocrDocumentId, documentDate, lineItems } = params;

  for (const li of lineItems) {
    if (!li.description || li.unit_price == null) continue;
    const itemName = li.description.trim();
    if (!itemName) continue;

    try {
      // Find or create supplier_item
      let supplierItemId = li.matched_supplier_item_id || null;

      if (!supplierItemId) {
        // Try to find existing item by name
        const { data: existing } = await supabase
          .from('supplier_items')
          .select('id, current_price')
          .eq('business_id', businessId)
          .eq('supplier_id', supplierId)
          .eq('item_name', itemName)
          .maybeSingle();

        if (existing) {
          supplierItemId = existing.id;
        } else {
          // Create new supplier_item
          const { data: newItem } = await supabase
            .from('supplier_items')
            .insert({
              business_id: businessId,
              supplier_id: supplierId,
              item_name: itemName,
              current_price: li.unit_price,
              last_price_date: documentDate,
            })
            .select('id')
            .single();
          if (newItem) supplierItemId = newItem.id;
        }
      }

      if (!supplierItemId) continue;

      // Get current price before updating
      const { data: currentItem } = await supabase
        .from('supplier_items')
        .select('current_price')
        .eq('id', supplierItemId)
        .single();

      const oldPrice = currentItem?.current_price;

      // Insert price record
      await supabase.from('supplier_item_prices').insert({
        supplier_item_id: supplierItemId,
        price: li.unit_price,
        quantity: li.quantity || null,
        invoice_id: invoiceId || null,
        ocr_document_id: ocrDocumentId || null,
        document_date: documentDate,
      });

      // Update current price on supplier_item
      await supabase.from('supplier_items').update({
        current_price: li.unit_price,
        last_price_date: documentDate,
        updated_at: new Date().toISOString(),
      }).eq('id', supplierItemId);

      // Create price alert if price changed
      if (oldPrice != null && Math.abs(li.unit_price - oldPrice) > 0.01) {
        const changePct = oldPrice > 0
          ? ((li.unit_price - oldPrice) / oldPrice) * 100
          : 0;
        await supabase.from('price_alerts').insert({
          business_id: businessId,
          supplier_item_id: supplierItemId,
          supplier_id: supplierId,
          ocr_document_id: ocrDocumentId || null,
          old_price: oldPrice,
          new_price: li.unit_price,
          change_pct: Math.round(changePct * 100) / 100,
          document_date: documentDate,
        });
      }
    } catch (priceError) {
      console.error('Error saving price for item:', itemName, priceError);
      // Continue with other items - don't fail the whole approval
    }
  }
}
