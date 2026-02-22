import { NextRequest, NextResponse } from 'next/server';

const INTAKE_API_KEY = process.env.INTAKE_API_KEY;

export function validateApiKey(request: NextRequest): { valid: boolean; error?: NextResponse } {
  const apiKey = request.headers.get('x-api-key');

  if (!INTAKE_API_KEY) {
    return {
      valid: false,
      error: NextResponse.json({ error: 'Server misconfigured: missing INTAKE_API_KEY' }, { status: 500 }),
    };
  }

  if (!apiKey || apiKey !== INTAKE_API_KEY) {
    return {
      valid: false,
      error: NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 }),
    };
  }

  return { valid: true };
}
