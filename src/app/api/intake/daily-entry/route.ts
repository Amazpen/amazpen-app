import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/apiAuth';

const BASE_FIELDS = [
  'total_register',
  'labor_cost',
  'labor_hours',
  'discounts',
  'food_cost',
  'current_expenses',
  'avg_private',
  'avg_business',
];

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
      entry_date,
      total_register = 0,
      labor_cost = 0,
      labor_hours = 0,
      discounts = 0,
      food_cost = 0,
      current_expenses = 0,
      avg_private = 0,
      avg_business = 0,
      day_factor = 1,
      income_data,
      receipts,
      product_usage,
      data_source = 'api',
      created_by,
    } = body;

    if (!business_id || !entry_date) {
      return NextResponse.json(
        { error: 'Missing required fields: business_id, entry_date' },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // Check for duplicate (same business_id + entry_date, not deleted)
    const { data: existing } = await supabase
      .from('daily_entries')
      .select('id')
      .eq('business_id', business_id)
      .eq('entry_date', entry_date)
      .is('deleted_at', null)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: 'Entry already exists for this date', existing_id: existing.id },
        { status: 409 }
      );
    }

    // Create daily entry
    const { data: entry, error: entryError } = await supabase
      .from('daily_entries')
      .insert({
        business_id,
        entry_date,
        total_register,
        labor_cost,
        labor_hours,
        discounts,
        day_factor,
        data_source,
        is_fully_approved: false,
        created_by: created_by || null,
      })
      .select('id')
      .single();

    if (entryError || !entry) {
      console.error('Error creating daily entry:', entryError);
      return NextResponse.json(
        { error: entryError?.message || 'Failed to create entry' },
        { status: 500 }
      );
    }

    // Build approval rows for base fields
    const approvalRows: Array<{
      daily_entry_id: string;
      business_id: string;
      field_name: string;
      status: string;
      source: string;
    }> = BASE_FIELDS.map((field) => ({
      daily_entry_id: entry.id,
      business_id,
      field_name: field,
      status: 'pending',
      source: data_source,
    }));

    // Insert income breakdown if provided
    if (income_data && Array.isArray(income_data) && income_data.length > 0) {
      const incomeRows = income_data.map((item: { income_source_id: string; amount: number; orders_count?: number }) => ({
        daily_entry_id: entry.id,
        income_source_id: item.income_source_id,
        amount: item.amount || 0,
        orders_count: item.orders_count || 0,
      }));

      const { error: incomeError } = await supabase
        .from('daily_income_breakdown')
        .insert(incomeRows);

      if (incomeError) {
        console.error('Error inserting income breakdown:', incomeError);
      }

      // Add approval rows for each income source
      for (const item of income_data) {
        approvalRows.push({
          daily_entry_id: entry.id,
          business_id,
          field_name: `income_source_${item.income_source_id}`,
          status: 'pending',
          source: data_source,
        });
      }
    }

    // Insert receipts if provided
    if (receipts && Array.isArray(receipts) && receipts.length > 0) {
      const receiptRows = receipts.map((item: { receipt_type_id: string; amount: number }) => ({
        daily_entry_id: entry.id,
        receipt_type_id: item.receipt_type_id,
        amount: item.amount || 0,
      }));

      const { error: receiptError } = await supabase
        .from('daily_receipts')
        .insert(receiptRows);

      if (receiptError) {
        console.error('Error inserting receipts:', receiptError);
      }
    }

    // Insert product usage if provided
    if (product_usage && Array.isArray(product_usage) && product_usage.length > 0) {
      const usageRows = product_usage.map((item: {
        product_id: string;
        opening_stock?: number;
        received_quantity?: number;
        closing_stock?: number;
        quantity?: number;
        unit_cost_at_time?: number;
      }) => ({
        daily_entry_id: entry.id,
        product_id: item.product_id,
        opening_stock: item.opening_stock || 0,
        received_quantity: item.received_quantity || 0,
        closing_stock: item.closing_stock || 0,
        quantity: item.quantity || 0,
        unit_cost_at_time: item.unit_cost_at_time || 0,
      }));

      const { error: usageError } = await supabase
        .from('daily_product_usage')
        .insert(usageRows);

      if (usageError) {
        console.error('Error inserting product usage:', usageError);
      }

      // Add approval rows for each managed product
      for (const item of product_usage) {
        approvalRows.push({
          daily_entry_id: entry.id,
          business_id,
          field_name: `managed_product_${item.product_id}`,
          status: 'pending',
          source: data_source,
        });
      }
    }

    // Insert all approval rows
    const { error: approvalError } = await supabase
      .from('daily_entry_approvals')
      .insert(approvalRows);

    if (approvalError) {
      console.error('Error creating approval rows:', approvalError);
    }

    return NextResponse.json(
      { id: entry.id, fields_count: approvalRows.length },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in intake/daily-entry:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
