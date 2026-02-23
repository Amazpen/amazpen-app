import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const N8N_WEBHOOK_URL = 'https://n8n-lv4j.onrender.com/webhook/send-karteset-email'

export async function POST(request: NextRequest) {
  const { supplierId, businessId } = await request.json()

  if (!supplierId || !businessId) {
    return NextResponse.json({ error: 'Missing supplierId or businessId' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!serviceRoleKey) {
    return NextResponse.json({ error: 'Server config missing' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Fetch supplier
  const { data: supplier, error: supplierError } = await supabase
    .from('suppliers')
    .select('id, name, email, business_id')
    .eq('id', supplierId)
    .maybeSingle()

  if (supplierError || !supplier || !supplier.email) {
    return NextResponse.json({ error: 'Supplier not found or has no email' }, { status: 404 })
  }

  // Fetch business name
  const { data: business } = await supabase
    .from('businesses')
    .select('id, name')
    .eq('id', businessId)
    .maybeSingle()

  // Fetch business owner email
  const { data: member } = await supabase
    .from('business_members')
    .select('user_id')
    .eq('business_id', businessId)
    .eq('role', 'owner')
    .is('deleted_at', null)
    .maybeSingle()

  let ownerEmail = ''
  if (member?.user_id) {
    const { data: { user } } = await supabase.auth.admin.getUserById(member.user_id)
    ownerEmail = user?.email || ''
  }

  // Calculate Hebrew month name
  const hebrewMonths = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
  const now = new Date()
  const monthName = hebrewMonths[now.getMonth()]
  const year = now.getFullYear()

  // Call n8n webhook
  const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      supplierEmail: supplier.email,
      supplierName: supplier.name,
      businessName: business?.name || 'העסק',
      ownerEmail,
      monthName,
      year,
    }),
  })

  if (!n8nResponse.ok) {
    return NextResponse.json({ error: 'Failed to send email via n8n' }, { status: 502 })
  }

  return NextResponse.json({ success: true })
}
