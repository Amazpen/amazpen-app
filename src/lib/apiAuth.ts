import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

const INTAKE_API_KEY = process.env.INTAKE_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

/** Constant-time string compare that never throws on length mismatch. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/**
 * Server-to-server auth for cron / automation endpoints (n8n).
 *
 * These routes use the SUPABASE_SERVICE_ROLE_KEY (RLS bypass) and take a
 * business_id from the query string, so without a gate any anonymous caller
 * could enumerate every tenant's financial data. They are NOT called from the
 * browser (no user session exists) — the only callers are n8n scheduled
 * workflows — so we require a shared secret rather than a logged-in user.
 *
 * Accepts either the shared CRON_SECRET (x-cron-secret) or the intake API key
 * (x-api-key). Timing-safe. Mirrors /api/retainers/process.
 */
export function verifyCronAuth(request: NextRequest): { valid: boolean; error?: NextResponse } {
  const cronSecret = request.headers.get('x-cron-secret');
  const apiKey = request.headers.get('x-api-key');

  let authorized = false;
  if (CRON_SECRET && cronSecret) authorized = timingSafeEqualStr(cronSecret, CRON_SECRET);
  if (!authorized && INTAKE_API_KEY && apiKey) authorized = timingSafeEqualStr(apiKey, INTAKE_API_KEY);

  if (!authorized) {
    return {
      valid: false,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { valid: true };
}

export function validateApiKey(request: NextRequest): { valid: boolean; error?: NextResponse } {
  const apiKey = request.headers.get('x-api-key');

  if (!INTAKE_API_KEY) {
    return {
      valid: false,
      error: NextResponse.json({ error: 'Server misconfigured: missing INTAKE_API_KEY' }, { status: 500 }),
    };
  }

  if (!apiKey) {
    return {
      valid: false,
      error: NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 }),
    };
  }

  try {
    if (!timingSafeEqual(Buffer.from(apiKey), Buffer.from(INTAKE_API_KEY))) {
      return {
        valid: false,
        error: NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 }),
      };
    }
  } catch {
    return {
      valid: false,
      error: NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 }),
    };
  }

  return { valid: true };
}
