import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  // Relays any {to, subject, html} to the mail webhook, so admins only
  // (the "שליחת פוש יומי" button is admin-only).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (profile?.is_admin !== true) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json()

    // Always CC the Amazpen owner (David) — explicit request from review
    // session: "every email that goes out, I must be CC'd". Skip only if
    // the caller already set a CC.
    const OWNER_CC = process.env.BONUS_EMAIL_OWNER_CC || 'david@amazpen.co.il'
    const bodyWithCc = body && typeof body === 'object' && !body.cc
      ? { ...body, cc: OWNER_CC }
      : body

    const response = await fetch('https://n8n-lv4j.onrender.com/webhook/daily-push-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyWithCc),
    })

    if (!response.ok) {
      const text = await response.text()
      return NextResponse.json({ success: false, error: text }, { status: response.status })
    }

    const data = await response.json().catch(() => ({}))
    return NextResponse.json({ success: true, ...data })
  } catch {
    return NextResponse.json({ success: false, error: 'Failed to send' }, { status: 500 })
  }
}
