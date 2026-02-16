import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const response = await fetch('https://n8n-lv4j.onrender.com/webhook/daily', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
