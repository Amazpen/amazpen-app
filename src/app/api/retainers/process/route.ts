import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createServiceClient(url, key);
}

export async function POST(request: NextRequest) {
  try {
    // Auth: API key or cron secret
    const apiKey = request.headers.get('x-api-key');
    const cronSecret = request.headers.get('x-cron-secret');
    const validKey = process.env.INTAKE_API_KEY;
    const validCron = process.env.CRON_SECRET;

    if ((!validKey || apiKey !== validKey) && (!validCron || cronSecret !== validCron)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const today = new Date();
    const dayOfMonth = today.getDate();
    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      .toISOString().split('T')[0];

    // Find active retainers due today
    const { data: customers, error: fetchError } = await supabase
      .from('customers')
      .select('id, business_id, retainer_amount, retainer_type, retainer_months, retainer_start_date, retainer_end_date, retainer_day_of_month, linked_income_source_id, business_name')
      .eq('retainer_status', 'active')
      .eq('retainer_day_of_month', dayOfMonth)
      .not('retainer_amount', 'is', null)
      .not('linked_income_source_id', 'is', null)
      .is('deleted_at', null);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!customers || customers.length === 0) {
      return NextResponse.json({ processed: 0, message: 'No retainers due today' });
    }

    let processed = 0;
    const errors: string[] = [];

    for (const customer of customers) {
      try {
        // Skip if already processed this month
        const { data: existing } = await supabase
          .from('customer_retainer_entries')
          .select('id')
          .eq('customer_id', customer.id)
          .eq('entry_month', currentMonth)
          .maybeSingle();

        if (existing) continue;

        // Get business VAT percentage
        const { data: business } = await supabase
          .from('businesses')
          .select('vat_percentage')
          .eq('id', customer.business_id)
          .single();

        const vatRate = business?.vat_percentage || 18;
        const amountWithVat = customer.retainer_amount * (1 + vatRate / 100);

        // Find or create daily entry for today
        const todayStr = today.toISOString().split('T')[0];
        let dailyEntry: { id: string } | null = null;

        const { data: existingEntry } = await supabase
          .from('daily_entries')
          .select('id')
          .eq('business_id', customer.business_id)
          .eq('entry_date', todayStr)
          .is('deleted_at', null)
          .maybeSingle();

        if (existingEntry) {
          dailyEntry = existingEntry;
        } else {
          const { data: newEntry, error: entryError } = await supabase
            .from('daily_entries')
            .insert({
              business_id: customer.business_id,
              entry_date: todayStr,
              total_register: 0,
              labor_cost: 0,
              labor_hours: 0,
              discounts: 0,
              data_source: 'api',
              is_fully_approved: true,
            })
            .select('id')
            .single();

          if (entryError || !newEntry) {
            errors.push(`${customer.business_name}: failed to create daily entry`);
            continue;
          }
          dailyEntry = newEntry;
        }

        // Insert into daily_income_breakdown
        const { data: breakdown, error: breakdownError } = await supabase
          .from('daily_income_breakdown')
          .insert({
            daily_entry_id: dailyEntry.id,
            income_source_id: customer.linked_income_source_id,
            amount: amountWithVat,
            orders_count: 1,
          })
          .select('id')
          .single();

        if (breakdownError || !breakdown) {
          errors.push(`${customer.business_name}: failed to insert income breakdown`);
          continue;
        }

        // Record in customer_retainer_entries
        await supabase
          .from('customer_retainer_entries')
          .insert({
            customer_id: customer.id,
            entry_month: currentMonth,
            amount: amountWithVat,
            daily_income_breakdown_id: breakdown.id,
          });

        // Check if fixed_term should complete
        if (customer.retainer_type === 'fixed_term' && customer.retainer_end_date) {
          const endDate = new Date(customer.retainer_end_date);
          if (today >= endDate) {
            await supabase
              .from('customers')
              .update({ retainer_status: 'completed' })
              .eq('id', customer.id);
          }
        }

        processed++;
      } catch (err) {
        errors.push(`${customer.business_name}: ${String(err)}`);
      }
    }

    return NextResponse.json({
      processed,
      total: customers.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
