import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CRON_SECRET = process.env.CRON_SECRET;
const REMINDERS_ENABLED = process.env.REMINDERS_ENABLED === 'true';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret') || request.nextUrl.searchParams.get('secret');
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const { data: businesses } = await supabaseAdmin
      .from('businesses')
      .select('id, name')
      .eq('is_active', true);

    if (!businesses) return NextResponse.json({ missing: [], enabled: REMINDERS_ENABLED });

    const missing: Array<{ business_id: string; business_name: string; type: string; details: string }> = [];

    for (const biz of businesses) {
      // Check missing daily entry for yesterday
      const { data: entry } = await supabaseAdmin
        .from('daily_entries')
        .select('id')
        .eq('business_id', biz.id)
        .eq('entry_date', yesterdayStr)
        .is('deleted_at', null)
        .maybeSingle();

      if (!entry) {
        missing.push({
          business_id: biz.id,
          business_name: biz.name,
          type: 'missing_daily',
          details: `חסר דיווח יומי לתאריך ${yesterdayStr}`,
        });
      }

      // Check pending approvals > 24h
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from('daily_entry_approvals')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', biz.id)
        .eq('status', 'pending')
        .lt('created_at', twentyFourHoursAgo);

      if (count && count > 0) {
        missing.push({
          business_id: biz.id,
          business_name: biz.name,
          type: 'pending_approval',
          details: `${count} שדות ממתינים לאישור יותר מ-24 שעות`,
        });
      }
    }

    return NextResponse.json({
      missing,
      total: missing.length,
      enabled: REMINDERS_ENABLED,
      checked_date: yesterdayStr,
    });
  } catch (err) {
    console.error('Check missing error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
