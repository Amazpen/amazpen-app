import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/apiAuth';

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = validateApiKey(request);
    if (!auth.valid) return auth.error!;

    const body = await request.json();
    const {
      business_id,
      supplier_id,
      invoice_date,
      total_amount,
      invoice_number,
      due_date,
      notes,
      line_items,
      data_source = 'api',
    } = body;

    if (!business_id || !supplier_id || !invoice_date || total_amount == null) {
      return NextResponse.json(
        { error: 'Missing required fields: business_id, supplier_id, invoice_date, total_amount' },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // Create invoice with pending_review status
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        business_id,
        supplier_id,
        invoice_date,
        total_amount,
        invoice_number: invoice_number || null,
        due_date: due_date || null,
        notes: notes || null,
        status: 'pending',
        approval_status: 'pending_review',
        data_source: data_source,
        amount_paid: 0,
      })
      .select('id')
      .single();

    if (invoiceError || !invoice) {
      console.error('Error creating invoice:', invoiceError);
      return NextResponse.json(
        { error: invoiceError?.message || 'Failed to create invoice' },
        { status: 500 }
      );
    }

    // Process line items for price tracking (non-blocking)
    if (line_items && Array.isArray(line_items) && line_items.length > 0) {
      try {
        const { savePriceTrackingForLineItems } = await import('@/lib/priceTracking');
        await savePriceTrackingForLineItems(supabase, {
          businessId: business_id,
          supplierId: supplier_id,
          invoiceId: invoice.id,
          documentDate: invoice_date,
          lineItems: line_items,
        });
      } catch (priceError) {
        console.error('Error saving price tracking (non-blocking):', priceError);
      }
    }

    return NextResponse.json({ id: invoice.id }, { status: 201 });
  } catch (error) {
    console.error('Error in intake/expense:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
