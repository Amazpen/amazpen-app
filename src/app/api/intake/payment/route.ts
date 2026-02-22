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
      payment_date,
      total_amount,
      invoice_id,
      reference_number,
      notes,
      payment_methods,
      data_source = 'api',
    } = body;

    if (!business_id || !supplier_id || !payment_date || total_amount == null) {
      return NextResponse.json(
        { error: 'Missing required fields: business_id, supplier_id, payment_date, total_amount' },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // Create payment
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        business_id,
        supplier_id,
        payment_date,
        total_amount,
        notes: notes || null,
        approval_status: 'pending_review',
        data_source: data_source,
      })
      .select('id')
      .single();

    if (paymentError || !payment) {
      console.error('Error creating payment:', paymentError);
      return NextResponse.json(
        { error: paymentError?.message || 'Failed to create payment' },
        { status: 500 }
      );
    }

    // Create payment splits
    if (payment_methods && Array.isArray(payment_methods) && payment_methods.length > 0) {
      const splitRows = payment_methods.map((method: {
        payment_method: string;
        amount: number;
        reference_number?: string;
        payment_date?: string;
      }) => ({
        payment_id: payment.id,
        payment_method: method.payment_method,
        amount: method.amount,
        reference_number: method.reference_number || reference_number || null,
        payment_date: method.payment_date || payment_date,
      }));

      const { error: splitError } = await supabase
        .from('payment_splits')
        .insert(splitRows);

      if (splitError) {
        console.error('Error creating payment splits:', splitError);
      }
    } else {
      // Default single bank_transfer split
      const { error: splitError } = await supabase
        .from('payment_splits')
        .insert({
          payment_id: payment.id,
          payment_method: 'bank_transfer',
          amount: total_amount,
          reference_number: reference_number || null,
          payment_date: payment_date,
        });

      if (splitError) {
        console.error('Error creating default payment split:', splitError);
      }
    }

    // If invoice_id provided, update invoice amount_paid and status
    if (invoice_id) {
      const { data: invoice } = await supabase
        .from('invoices')
        .select('total_amount, amount_paid')
        .eq('id', invoice_id)
        .maybeSingle();

      if (invoice) {
        const newAmountPaid = (invoice.amount_paid || 0) + total_amount;
        const newStatus = newAmountPaid >= invoice.total_amount ? 'paid' : 'partial';

        const { error: updateError } = await supabase
          .from('invoices')
          .update({
            amount_paid: newAmountPaid,
            status: newStatus,
          })
          .eq('id', invoice_id);

        if (updateError) {
          console.error('Error updating invoice:', updateError);
        }
      }
    }

    return NextResponse.json({ id: payment.id }, { status: 201 });
  } catch (error) {
    console.error('Error in intake/payment:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
