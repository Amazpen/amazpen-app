import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env_check: {
      GOOGLE_VISION_API_KEY: !!process.env.GOOGLE_VISION_API_KEY,
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    }
  })
}
