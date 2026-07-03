import { NextResponse } from 'next/server'

export async function GET() {
  // Intentionally minimal — do not leak which secrets/integrations are
  // configured (previously returned booleans for OPENAI/GOOGLE_VISION/
  // SERVICE_ROLE keys, useful recon for an attacker).
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
}
