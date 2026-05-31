/**
 * /api/services/backfill-day-factor
 *
 * For every business with `business_type='services'`, ensure that each working
 * day in the target window has a `daily_entries` row with the correct
 * `day_factor` (per `business_schedule` and `business_day_exceptions`) AND
 * `manager_daily_cost` (per `businesses.manager_monthly_salary`, prorated to
 * this day's factor / month-total factor).
 *
 * Behavior:
 * - Missing entries: insert with day_factor + manager_daily_cost.
 * - Existing entries: update only `day_factor` and `manager_daily_cost` to
 *   the computed values. `total_register`, `labor_cost`, breakdowns, etc are
 *   left alone.
 * - Closed days (day_factor=0): skipped — no entry created.
 *
 * Manager daily cost formula:
 *   manager_daily_cost = manager_monthly_salary
 *                        × this_day_factor
 *                        ÷ sum_of_day_factors_in_target_month
 *
 * Auth: x-api-key OR x-cron-secret (same envelope as /api/retainers/process).
 * Idempotent. Designed for daily cron.
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

  // Pull services businesses (with manager salary for labor cost prorating)
  let bizQ = supabase
    .from('businesses')
    .select('id, name, manager_monthly_salary')
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

  type PerBiz = { businessId: string; name: string; created: number; updated: number; skipped: number };
  const summary: PerBiz[] = [];
  let totalCreated = 0;
  let totalUpdated = 0;

  for (const biz of businesses as Array<{ id: string; name: string; manager_monthly_salary: number | string | null }>) {
    const managerSalary = Number(biz.manager_monthly_salary) || 0;

    const [schedRes, excRes, existingRes] = await Promise.all([
      supabase
        .from('business_schedule')
        .select('day_of_week, day_factor')
        .eq('business_id', biz.id),
      supabase
        .from('business_day_exceptions')
        .select('exception_date, day_factor')
        .eq('business_id', biz.id),
      supabase
        .from('daily_entries')
        .select('id, entry_date, day_factor, manager_daily_cost')
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

    const existingByDate = new Map<string, { id: string; day_factor: number; manager_daily_cost: number }>();
    for (const de of (existingRes.data || []) as Array<{ id: string; entry_date: string; day_factor: number | string; manager_daily_cost: number | string | null }>) {
      const k = String(de.entry_date).substring(0, 10);
      existingByDate.set(k, {
        id: de.id,
        day_factor: Number(de.day_factor) || 0,
        manager_daily_cost: Number(de.manager_daily_cost) || 0,
      });
    }

    // Compute the per-month total day_factor over every month the window touches.
    // Use schedule + exception overrides.
    const monthTotalFactor = new Map<string, number>(); // "YYYY-MM" → total
    const factorForDate = (dateStr: string, dow: number): number => {
      if (exceptionMap.has(dateStr)) return exceptionMap.get(dateStr) || 0;
      return scheduleMap.get(dow) ?? 1;
    };

    // Walk months in [fromDate, toDate]
    const firstMonth = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    const lastMonth = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
    for (let m = new Date(firstMonth); m <= lastMonth; m.setMonth(m.getMonth() + 1)) {
      const yr = m.getFullYear();
      const mo = m.getMonth();
      const daysInMonth = new Date(yr, mo + 1, 0).getDate();
      let monthSum = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(yr, mo, d);
        const ds = fmtDate(dateObj);
        const f = factorForDate(ds, dateObj.getDay());
        if (f > 0) monthSum += f;
      }
      // Guard against empty schedule
      if (monthSum <= 0) monthSum = 22;
      monthTotalFactor.set(`${yr}-${String(mo + 1).padStart(2, '0')}`, monthSum);
    }

    type InsertRow = { business_id: string; entry_date: string; total_register: number; day_factor: number; manager_daily_cost: number; data_source: string; is_fully_approved: boolean };
    type UpdateRow = { id: string; day_factor: number; manager_daily_cost: number };
    const toInsert: InsertRow[] = [];
    const toUpdate: UpdateRow[] = [];
    let skipped = 0;

    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      const dateStr = fmtDate(d);
      const dow = d.getDay();
      const factor = factorForDate(dateStr, dow);
      if (factor <= 0) { skipped++; continue; }

      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const totalF = monthTotalFactor.get(monthKey) || 22;
      const mgrDaily = managerSalary * factor / totalF;
      const mgrRounded = Math.round(mgrDaily * 100) / 100;

      const existing = existingByDate.get(dateStr);
      if (existing) {
        // Only update if values differ enough to matter (avoid pointless writes)
        const sameFactor = Math.abs(existing.day_factor - factor) < 0.0001;
        const sameMgr = Math.abs(existing.manager_daily_cost - mgrRounded) < 0.01;
        if (sameFactor && sameMgr) { skipped++; continue; }
        toUpdate.push({ id: existing.id, day_factor: factor, manager_daily_cost: mgrRounded });
      } else {
        toInsert.push({
          business_id: biz.id,
          entry_date: dateStr,
          total_register: 0,
          day_factor: factor,
          manager_daily_cost: mgrRounded,
          data_source: 'api',
          is_fully_approved: true,
        });
      }
    }

    let created = 0;
    let updated = 0;

    if (toInsert.length > 0) {
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

    // Updates one by one — small number per run after first backfill
    for (const up of toUpdate) {
      const { error: upErr } = await supabase
        .from('daily_entries')
        .update({ day_factor: up.day_factor, manager_daily_cost: up.manager_daily_cost })
        .eq('id', up.id);
      if (upErr) {
        return NextResponse.json(
          { error: `Update failed for entry ${up.id} (${biz.name}): ${upErr.message}`, partialSummary: summary },
          { status: 500 },
        );
      }
      updated++;
    }

    totalCreated += created;
    totalUpdated += updated;
    summary.push({ businessId: biz.id, name: biz.name, created, updated, skipped });
  }

  return NextResponse.json({
    processed: businesses.length,
    totalCreated,
    totalUpdated,
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
