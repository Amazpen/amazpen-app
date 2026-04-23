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
      reference_date,
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

    // Fix dates with year < 2000 (e.g. 1925 from DD/MM/YY parsing where 25 → 1925)
    let fixedInvoiceDate = invoice_date;
    if (fixedInvoiceDate) {
      const parsedYear = new Date(fixedInvoiceDate).getFullYear();
      if (parsedYear > 0 && parsedYear < 2000) {
        const d = new Date(fixedInvoiceDate);
        d.setFullYear(d.getFullYear() + 100);
        fixedInvoiceDate = d.toISOString().split('T')[0];
      }
    }

    // Auto-detect invoice_type from supplier's expense_type so the invoice
    // shows up in the correct tab on the expenses page (which filters by
    // invoice_type in ['current', 'goods', 'employees']). Without this the
    // invoice defaults to something the expenses filter ignores.
    // We also pull vat_type to decide how to split subtotal vs VAT below.
    const { data: sup } = await supabase
      .from('suppliers')
      .select('expense_type, is_fixed_expense, vat_type')
      .eq('id', supplier_id)
      .maybeSingle();
    const invoiceType = sup?.expense_type === 'goods_purchases'
      ? 'goods'
      : sup?.expense_type === 'employee_costs'
      ? 'employees'
      : 'current';

    // Split total_amount into (subtotal, vat_amount) according to the
    // supplier's VAT setting. The intake webhook only gives us a gross
    // total; without this logic, suppliers flagged as פטור-ממעמ still
    // received phantom VAT (seen in the wild: ירקות ופירות שלמה המלך,
    // vat_type='none', delivery notes arrived with VAT=426 on a 2892.7
    // total). vat_type='none' → no VAT at all. Otherwise back-out the
    // business's VAT rate from the total (default 18% if not configured).
    const totalNum = Number(total_amount);
    const { data: biz } = await supabase
      .from('businesses')
      .select('vat_percentage')
      .eq('id', business_id)
      .maybeSingle();
    const vatRate = sup?.vat_type === 'none'
      ? 0
      : (biz?.vat_percentage != null ? Number(biz.vat_percentage) : 0.18);
    const subtotalComputed = vatRate > 0 ? totalNum / (1 + vatRate) : totalNum;
    const vatAmountComputed = totalNum - subtotalComputed;

    // For fixed-expense suppliers: avoid creating a duplicate placeholder for
    // the same month. If an empty placeholder (no invoice_number, no
    // attachment) already exists for the same business+supplier+month, update
    // it instead of inserting a new row. This prevents the same behavior that
    // produced ~55 duplicates during the Bubble import.
    let invoice: { id: string } | null = null;
    let invoiceError: unknown = null;

    if (sup?.is_fixed_expense && fixedInvoiceDate) {
      const monthStart = fixedInvoiceDate.substring(0, 7) + '-01';
      const [year, month] = fixedInvoiceDate.substring(0, 7).split('-').map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      const monthEnd = `${fixedInvoiceDate.substring(0, 7)}-${String(lastDay).padStart(2, '0')}`;

      const { data: existingPlaceholder } = await supabase
        .from('invoices')
        .select('id')
        .eq('business_id', business_id)
        .eq('supplier_id', supplier_id)
        .is('deleted_at', null)
        .is('invoice_number', null)
        .is('attachment_url', null)
        .gte('invoice_date', monthStart)
        .lte('invoice_date', monthEnd)
        .limit(1)
        .maybeSingle();

      if (existingPlaceholder?.id) {
        const { data, error } = await supabase
          .from('invoices')
          .update({
            invoice_date: fixedInvoiceDate,
            reference_date: reference_date || fixedInvoiceDate,
            total_amount: totalNum,
            subtotal: subtotalComputed,
            vat_amount: vatAmountComputed,
            invoice_number: invoice_number || null,
            due_date: due_date || null,
            notes: notes || null,
            invoice_type: invoiceType,
            data_source: data_source,
          })
          .eq('id', existingPlaceholder.id)
          .select('id')
          .single();
        invoice = data;
        invoiceError = error;
      }
    }

    if (!invoice && !invoiceError) {
      const res = await supabase
        .from('invoices')
        .insert({
          business_id,
          supplier_id,
          invoice_date: fixedInvoiceDate,
          total_amount: totalNum,
          subtotal: subtotalComputed,
          vat_amount: vatAmountComputed,
          invoice_number: invoice_number || null,
          due_date: due_date || null,
          reference_date: reference_date || fixedInvoiceDate,
          notes: notes || null,
          status: 'pending',
          invoice_type: invoiceType,
          // approval_status left null — intake goes straight into the system;
          // the "אישור נתונים ממתינים" queue is disabled by product decision.
          data_source: data_source,
          amount_paid: 0,
        })
        .select('id')
        .single();
      invoice = res.data;
      invoiceError = res.error;
    }

    if (invoiceError || !invoice) {
      console.error('Error creating invoice:', invoiceError);
      const errMsg = invoiceError && typeof invoiceError === 'object' && 'message' in invoiceError
        ? String((invoiceError as { message: unknown }).message)
        : 'Failed to create invoice';
      return NextResponse.json(
        { error: errMsg },
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
