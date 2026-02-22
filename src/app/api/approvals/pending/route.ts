import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Verify auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'לא מחובר' }, { status: 401 });
    }

    const businessId = request.nextUrl.searchParams.get('business_id');
    if (!businessId) {
      return NextResponse.json(
        { error: 'Missing required param: business_id' },
        { status: 400 }
      );
    }

    // Fetch pending daily entry field approvals
    const { data: dailyFields, error: dailyError } = await supabase
      .from('daily_entry_approvals')
      .select(`
        id,
        daily_entry_id,
        field_name,
        status,
        source,
        created_at,
        daily_entries!inner (
          entry_date,
          business_id
        )
      `)
      .eq('business_id', businessId)
      .eq('status', 'pending');

    if (dailyError) {
      console.error('Error fetching daily approvals:', dailyError);
    }

    // Fetch pending invoices
    const { data: invoices, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_date,
        total_amount,
        invoice_number,
        data_source,
        approval_status,
        created_at,
        suppliers (
          id,
          name
        )
      `)
      .eq('business_id', businessId)
      .eq('approval_status', 'pending_review')
      .is('deleted_at', null);

    if (invoiceError) {
      console.error('Error fetching pending invoices:', invoiceError);
    }

    // Fetch pending payments
    const { data: payments, error: paymentError } = await supabase
      .from('payments')
      .select(`
        id,
        payment_date,
        total_amount,
        data_source,
        approval_status,
        created_at,
        suppliers (
          id,
          name
        )
      `)
      .eq('business_id', businessId)
      .eq('approval_status', 'pending_review')
      .is('deleted_at', null);

    if (paymentError) {
      console.error('Error fetching pending payments:', paymentError);
    }

    return NextResponse.json({
      daily_fields: dailyFields || [],
      invoices: invoices || [],
      payments: payments || [],
      totals: {
        daily_fields: dailyFields?.length || 0,
        invoices: invoices?.length || 0,
        payments: payments?.length || 0,
      },
    });
  } catch (error) {
    console.error('Error in approvals/pending:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'שגיאה בשרת' },
      { status: 500 }
    );
  }
}
