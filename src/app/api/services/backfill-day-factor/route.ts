/**
 * /api/services/backfill-day-factor
 *
 * For every business with `business_type='services'`, ensure that each elapsed
 * working day (per `business_schedule` and `business_day_exceptions`) has a
 * `daily_entries` row. Days that already have an entry are skipped — totals
 * are not touched. Days the schedule marks as 0 (closed) are also skipped to
 * avoid noise.
 *
 * Intent: dashboards and P&L need every working day represented (with
 * `day_factor`) so periodFactor math is correct. Customer payments already
 * fill `total_register` via the DB trigger; this just fills the *empty*
 * days so the month-to-date denominator is accurate.
 *
 * Auth: same envelope as /api/retainers/process (x-api-key OR x-cron-secret).
 * Idempotent — safe to run repeatedly. Designed for daily cron.
 *
 * Query / body params (optional):
 *   - businessId: limit to one business
 *   - fromDate:   ISO date (inclusive); default = today - 90 days
 *   - toDate:     ISO date (inclusive); default = today
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createServiceClient(url, key);
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateInput(v: unknown, fallback: Date): Date {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fallback;
  const d = new Date(v + 'T00:00:00');
  return isNaN(d.getTime()) ? fallback : d;
}

async function handle(req: NextRequest, bodyArg?: Record<string, unknown>) {
  // Auth
  const apiKey = req.headers.get('x-api-key');
  const cronSecret = req.headers.get('x-cron-secret');
  const validKey = process.env.INTAKE_API_KEY;
  const validCron = process.env.CRON_SECRET;
  let authorized = false;
  try {
    if (validKey && apiKey) {
      authorized = timingSafeEqual(Buffer.from(apiKey), Buffer.from(validKey));
    }
    if (!authorized && validCron && cronSecret) {
      authorized = timingSafeEqual(Buffer.from(cronSecret), Buffer.from(validCron));
    }
  } catch { /* length mismatch = unauthorized */ }
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const qBusinessId = url.searchParams.get('businessId') ?? bodyArg?.businessId;
  const qFromDate = url.searchParams.get('fromDate') ?? bodyArg?.fromDate;
  const qToDate = url.searchParams.get('toDate') ?? bodyArg?.toDate;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 90);

  const fromDate = parseDateInput(qFromDate, defaultFrom);
  const toDate = parseDateInput(qToDate, today);
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'fromDate must be <= toDate' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Pull services businesses
  let bizQ = supabase
    .from('businesses')
    .select('id, name')
    .eq('business_type', 'services')
    .is('deleted_at', null);
  if (typeof qBusinessId === 'string' && qBusinessId) {
    bizQ = bizQ.eq('id', qBusinessId);
  }
  const { data: businesses, error: bizErr } = await bizQ;
  if (bizErr) return NextResponse.json({ error: bizErr.message }, { status: 500 });
  if (!businesses || businesses.length === 0) {
    return NextResponse.json({ processed: 0, message: 'No services businesses found' });
  }

  const fromStr = fmtDate(fromDate);
  const toStr = fmtDate(toDate);

  type PerBiz = { businessId: string; name: string; created: number; skipped: number };
  const summary: PerBiz[] = [];
  let totalCreated = 0;

  for (const biz of businesses as Array<{ id: string; name: string }>) {
    // Schedule + exceptions for this business
    const [schedRes, excRes, existingRes] = await Promise.all([
      supabase
        .from('business_schedule')
        .select('day_of_week, day_factor')
        .eq('business_id', biz.id),
      supabase
        .from('business_day_exceptions')
        .select('exception_date, day_factor')
        .eq('business_id', biz.id)
        .gte('exception_date', fromStr)
        .lte('exception_date', toStr),
      supabase
        .from('daily_entries')
        .select('entry_date')
        .eq('business_id', biz.id)
        .is('deleted_at', null)
        .gte('entry_date', fromStr)
        .lte('entry_date', toStr),
    ]);

    const scheduleMap = new Map<number, number>();
    for (const row of (schedRes.data || []) as Array<{ day_of_week: number; day_factor: number | string }>) {
      scheduleMap.set(Number(row.day_of_week), Number(row.day_factor) || 0);
    }

    const exceptionMap = new Map<string, number>();
    for (const ex of (excRes.data || []) as Array<{ exception_date: string; day_factor: number | string }>) {
      const dStr = String(ex.exception_date).substring(0, 10);
      exceptionMap.set(dStr, Number(ex.day_factor) || 0);
    }

    const existingDates = new Set<string>();
    for (const de of (existingRes.data || []) as Array<{ entry_date: string }>) {
      existingDates.add(String(de.entry_date).substring(0, 10));
    }

    // Walk every date in [fromDate, toDate]
    const toInsert: Array<{ business_id: string; entry_date: string; total_register: number; day_factor: number; data_source: string; is_fully_approved: boolean }> = [];
    let skipped = 0;

    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      const dateStr = fmtDate(d);
      if (existingDates.has(dateStr)) { skipped++; continue; }

      let factor: number;
      if (exceptionMap.has(dateStr)) {
        factor = exceptionMap.get(dateStr) || 0;
      } else {
        const dow = d.getDay();
        factor = scheduleMap.get(dow) ?? 1;
      }
      // Skip days the schedule marks closed — no entry needed.
      if (factor <= 0) { skipped++; continue; }

      toInsert.push({
        business_id: biz.id,
        entry_date: dateStr,
        total_register: 0,
        day_factor: factor,
        data_source: 'api',
        is_fully_approved: true,
      });
    }

    let created = 0;
    if (toInsert.length > 0) {
      // Chunk to keep individual statements small
      const chunkSize = 200;
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const { error: insErr, count } = await supabase
          .from('daily_entries')
          .insert(chunk, { count: 'exact' });
        if (insErr) {
          return NextResponse.json(
            { error: `Insert failed for business ${biz.name}: ${insErr.message}`, partialSummary: summary },
            { status: 500 },
          );
        }
        created += count ?? chunk.length;
      }
    }

    totalCreated += created;
    summary.push({ businessId: biz.id, name: biz.name, created, skipped });
  }

  return NextResponse.json({
    processed: businesses.length,
    totalCreated,
    fromDate: fromStr,
    toDate: toStr,
    summary,
  });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* body optional */ }
  return handle(req, body);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
