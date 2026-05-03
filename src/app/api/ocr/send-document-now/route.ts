import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

/**
 * Immediate OCR Document Email Sender.
 *
 * Called from the OCR submit flow right after a document is approved
 * and saved. Only sends if the owning business is configured for daily
 * frequency — weekly/monthly customers are still handled by the cron in
 * /api/ocr/send-documents which batches their docs into a single ZIP.
 *
 * Auth: regular user session (must be a member of the business). The
 * cron endpoint uses x-cron-secret; this endpoint is invoked by the
 * end user from the OCR UI, so it relies on Supabase RLS via the user
 * session.
 *
 * Idempotency: dedup against ocr_email_send_log — if a successful row
 * already exists for this doc, return ok without resending.
 */

const N8N_WEBHOOK_URL = 'https://n8n-lv4j.onrender.com/webhook/send-ocr-documents'

interface SendNowBody {
  ocrDocumentId: string
}

export async function POST(request: NextRequest) {
  let body: SendNowBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.ocrDocumentId) {
    return NextResponse.json({ error: 'ocrDocumentId is required' }, { status: 400 })
  }

  // Auth — must be signed in. RLS on the read below also enforces business
  // membership, but we need the user up front to attribute the action.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Read the OCR document via the user's session so RLS gates access. If
  // the user isn't a member of the doc's business this returns null.
  const { data: doc, error: docErr } = await supabase
    .from('ocr_documents')
    .select('id, business_id, image_url, original_filename, created_invoice_id, created_payment_id, created_delivery_note_id, status')
    .eq('id', body.ocrDocumentId)
    .maybeSingle()

  if (docErr || !doc) {
    return NextResponse.json({ error: 'Document not found or no access' }, { status: 404 })
  }

  if (doc.status !== 'approved') {
    return NextResponse.json({ ok: true, skipped: 'not-approved' })
  }
  if (!doc.image_url) {
    return NextResponse.json({ ok: true, skipped: 'no-image-url' })
  }

  // Switch to service role for the rest — we need to look at the business's
  // email config and write to the send log without further RLS gating.
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Critical: the OCR document's `business_id` reflects where the operator
  // *uploaded* the file (e.g. they were viewing "אושי אושי דימונה" when
  // the file came in), but the entity that got created (invoice / payment /
  // delivery note) carries the business the user actually picked in the
  // form. That's the customer the email belongs to. Resolve the business
  // from the created entity, falling back to the OCR doc's business only
  // when no entity was created.
  let resolvedBusinessId: string | null = null
  if (doc.created_invoice_id) {
    const { data } = await admin
      .from('invoices')
      .select('business_id')
      .eq('id', doc.created_invoice_id)
      .maybeSingle()
    resolvedBusinessId = data?.business_id ?? null
  } else if (doc.created_payment_id) {
    const { data } = await admin
      .from('payments')
      .select('business_id')
      .eq('id', doc.created_payment_id)
      .maybeSingle()
    resolvedBusinessId = data?.business_id ?? null
  } else if (doc.created_delivery_note_id) {
    const { data } = await admin
      .from('delivery_notes')
      .select('business_id')
      .eq('id', doc.created_delivery_note_id)
      .maybeSingle()
    resolvedBusinessId = data?.business_id ?? null
  }
  resolvedBusinessId = resolvedBusinessId || doc.business_id

  const { data: biz } = await admin
    .from('businesses')
    .select('id, name, documents_email, documents_send_frequency, documents_send_types, status, deleted_at')
    .eq('id', resolvedBusinessId)
    .maybeSingle()

  if (!biz || biz.deleted_at || biz.status !== 'active') {
    return NextResponse.json({ ok: true, skipped: 'business-inactive' })
  }
  if (!biz.documents_email || biz.documents_email.trim() === '') {
    return NextResponse.json({ ok: true, skipped: 'no-email-configured' })
  }
  // Only the *daily* path runs immediately — weekly/monthly stay batched
  // through the cron so the customer gets one ZIP at the right cadence.
  if (biz.documents_send_frequency !== 'daily') {
    return NextResponse.json({ ok: true, skipped: 'not-daily-frequency' })
  }

  // Honor the per-business types filter. If the doc didn't produce an
  // entity of an enabled type, skip it.
  const enabledTypes = (biz.documents_send_types && biz.documents_send_types.length > 0)
    ? biz.documents_send_types
    : ['invoice', 'payment', 'delivery_note']
  const hasMatchingType =
    (enabledTypes.includes('invoice') && !!doc.created_invoice_id) ||
    (enabledTypes.includes('payment') && !!doc.created_payment_id) ||
    (enabledTypes.includes('delivery_note') && !!doc.created_delivery_note_id)
  if (!hasMatchingType) {
    return NextResponse.json({ ok: true, skipped: 'type-not-enabled' })
  }

  // Dedup — if we already have a successful send for this doc, no-op.
  const { data: existingSuccess } = await admin
    .from('ocr_email_send_log')
    .select('id')
    .eq('ocr_document_id', doc.id)
    .is('error_message', null)
    .limit(1)
    .maybeSingle()
  if (existingSuccess) {
    return NextResponse.json({ ok: true, skipped: 'already-sent' })
  }

  // Resolve the human-readable reference number for the email subject.
  let invoiceNumber = ''
  if (doc.created_invoice_id) {
    const { data } = await admin
      .from('invoices')
      .select('invoice_number')
      .eq('id', doc.created_invoice_id)
      .maybeSingle()
    invoiceNumber = data?.invoice_number || ''
  } else if (doc.created_delivery_note_id) {
    const { data } = await admin
      .from('delivery_notes')
      .select('delivery_note_number')
      .eq('id', doc.created_delivery_note_id)
      .maybeSingle()
    invoiceNumber = data?.delivery_note_number || ''
  }

  const payload = {
    mode: 'individual' as const,
    to: biz.documents_email,
    businessName: biz.name,
    documents: [{
      id: doc.id,
      invoiceNumber,
      imageUrl: doc.image_url,
      originalFilename: doc.original_filename || `document-${doc.id}.pdf`,
    }],
    period: 'daily' as const,
  }

  let success = false
  let errorMsg: string | null = null
  try {
    const resp = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    success = resp.ok
    if (!success) errorMsg = `n8n responded ${resp.status}`
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : 'unknown error'
  }

  // Log the attempt either way. Failures aren't fatal — the cron will
  // pick the doc up again tomorrow because it dedupes against successful
  // log rows only.
  await admin.from('ocr_email_send_log').insert({
    business_id: biz.id,
    ocr_document_id: doc.id,
    sent_to: biz.documents_email,
    send_mode: 'individual',
    error_message: errorMsg,
  })

  if (success) {
    await admin
      .from('businesses')
      .update({ documents_last_sent_at: new Date().toISOString() })
      .eq('id', biz.id)
  }

  return NextResponse.json({ ok: success, errorMsg })
}
