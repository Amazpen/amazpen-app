import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * OCR Document Email Sender — Cron endpoint.
 *
 * Iterates over businesses with `documents_email` configured, and for each:
 *  - daily: posts each unsent reviewed OCR document individually to n8n
 *  - weekly: only on Sunday — sends week's docs (zip or individual)
 *  - monthly: only on day 1 — sends previous month's docs (zip or individual)
 *
 * Logs every send into ocr_email_send_log to prevent duplicates.
 *
 * n8n webhook receives:
 *  - mode: "individual" | "zip"
 *  - to: documents_email
 *  - businessName: string
 *  - documents: [{ id, invoiceNumber, imageUrl, originalFilename }]  (individual: 1 item, zip: many)
 *  - period: "daily" | "weekly" | "monthly"
 */

const N8N_WEBHOOK_URL = 'https://n8n-lv4j.onrender.com/webhook/send-ocr-documents'

interface OcrDoc {
  id: string
  business_id: string
  image_url: string | null
  original_filename: string | null
  created_invoice_id: string | null
  created_payment_id: string | null
  created_delivery_note_id: string | null
}

interface BusinessRow {
  id: string
  name: string
  documents_email: string
  documents_send_frequency: 'daily' | 'weekly' | 'monthly'
  documents_send_mode: 'individual' | 'zip'
  documents_send_types: Array<'invoice' | 'payment' | 'delivery_note'> | null
}

export async function POST(request: NextRequest) {
  // Cron secret protection
  const cronSecret = request.headers.get('x-cron-secret')
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const now = new Date()
  const dayOfWeek = now.getDay() // 0=Sun
  const dayOfMonth = now.getDate()

  // Fetch businesses with documents_email
  const { data: businesses, error: bizErr } = await supabase
    .from('businesses')
    .select('id, name, documents_email, documents_send_frequency, documents_send_mode, documents_send_types')
    .not('documents_email', 'is', null)
    .neq('documents_email', '')
    .is('deleted_at', null)
    .eq('status', 'active')

  if (bizErr) {
    return NextResponse.json({ error: bizErr.message }, { status: 500 })
  }

  const results: Array<{ businessId: string; sent: number; skipped: string | null }> = []

  for (const biz of (businesses || []) as BusinessRow[]) {
    const freq = biz.documents_send_frequency || 'daily'

    // Skip if today isn't the right day for this frequency
    if (freq === 'weekly' && dayOfWeek !== 0) {
      results.push({ businessId: biz.id, sent: 0, skipped: 'not-sunday' })
      continue
    }
    if (freq === 'monthly' && dayOfMonth !== 1) {
      results.push({ businessId: biz.id, sent: 0, skipped: 'not-first-of-month' })
      continue
    }

    // Time window for fetching unsent documents
    let sinceDate: Date
    if (freq === 'daily') {
      sinceDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    } else if (freq === 'weekly') {
      sinceDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    } else {
      sinceDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    }

    // Determine which entity types are enabled (default: all)
    const enabledTypes = (biz.documents_send_types && biz.documents_send_types.length > 0)
      ? biz.documents_send_types
      : ['invoice', 'payment', 'delivery_note']
    const orParts: string[] = []
    if (enabledTypes.includes('invoice')) orParts.push('created_invoice_id.not.is.null')
    if (enabledTypes.includes('payment')) orParts.push('created_payment_id.not.is.null')
    if (enabledTypes.includes('delivery_note')) orParts.push('created_delivery_note_id.not.is.null')

    if (orParts.length === 0) {
      results.push({ businessId: biz.id, sent: 0, skipped: 'no-enabled-types' })
      continue
    }

    // Fetch approved OCR docs for this business that resulted in a saved entity of an enabled type
    const { data: docs, error: docsErr } = await supabase
      .from('ocr_documents')
      .select('id, business_id, image_url, original_filename, created_invoice_id, created_payment_id, created_delivery_note_id')
      .eq('business_id', biz.id)
      .eq('status', 'approved')
      .gte('reviewed_at', sinceDate.toISOString())
      .or(orParts.join(','))

    if (docsErr || !docs || docs.length === 0) {
      results.push({ businessId: biz.id, sent: 0, skipped: 'no-docs' })
      continue
    }

    // Filter out docs already sent
    const docIds = docs.map(d => d.id)
    const { data: sentLog } = await supabase
      .from('ocr_email_send_log')
      .select('ocr_document_id')
      .eq('business_id', biz.id)
      .in('ocr_document_id', docIds)
      .is('error_message', null)

    const alreadySent = new Set((sentLog || []).map(l => l.ocr_document_id))
    const unsent = (docs as OcrDoc[]).filter(d => !alreadySent.has(d.id))

    if (unsent.length === 0) {
      results.push({ businessId: biz.id, sent: 0, skipped: 'all-already-sent' })
      continue
    }

    // Resolve invoice numbers in batch
    const invoiceIds = unsent.map(d => d.created_invoice_id).filter((x): x is string => !!x)
    const dnIds = unsent.map(d => d.created_delivery_note_id).filter((x): x is string => !!x)

    const numberMap = new Map<string, string>()
    if (invoiceIds.length > 0) {
      const { data } = await supabase.from('invoices').select('id, invoice_number').in('id', invoiceIds)
      for (const row of data || []) numberMap.set(`inv:${row.id}`, row.invoice_number || '')
    }
    if (dnIds.length > 0) {
      const { data } = await supabase.from('delivery_notes').select('id, delivery_note_number').in('id', dnIds)
      for (const row of data || []) numberMap.set(`dn:${row.id}`, row.delivery_note_number || '')
    }

    const docsForN8n = unsent
      .filter(d => d.image_url)
      .map(d => {
        const num = d.created_invoice_id
          ? numberMap.get(`inv:${d.created_invoice_id}`) || ''
          : d.created_delivery_note_id
            ? numberMap.get(`dn:${d.created_delivery_note_id}`) || ''
            : ''
        return {
          id: d.id,
          invoiceNumber: num,
          imageUrl: d.image_url!,
          originalFilename: d.original_filename || `document-${d.id}.pdf`,
        }
      })

    if (docsForN8n.length === 0) {
      results.push({ businessId: biz.id, sent: 0, skipped: 'no-image-urls' })
      continue
    }

    const sendMode = freq === 'daily' ? 'individual' : (biz.documents_send_mode || 'individual')

    // Build batches: individual = one webhook call per doc; zip = one webhook call with all
    const batches = sendMode === 'individual'
      ? docsForN8n.map(d => [d])
      : [docsForN8n]

    let sentCount = 0
    for (const batch of batches) {
      try {
        const resp = await fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: sendMode,
            to: biz.documents_email,
            businessName: biz.name,
            documents: batch,
            period: freq,
          }),
        })

        const success = resp.ok
        const errorMsg = success ? null : `n8n responded ${resp.status}`

        // Log every doc in batch
        const logRows = batch.map(d => ({
          business_id: biz.id,
          ocr_document_id: d.id,
          sent_to: biz.documents_email,
          send_mode: sendMode,
          error_message: errorMsg,
        }))
        await supabase.from('ocr_email_send_log').insert(logRows)

        if (success) sentCount += batch.length
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'unknown error'
        const logRows = batch.map(d => ({
          business_id: biz.id,
          ocr_document_id: d.id,
          sent_to: biz.documents_email,
          send_mode: sendMode,
          error_message: errorMsg,
        }))
        await supabase.from('ocr_email_send_log').insert(logRows)
      }
    }

    if (sentCount > 0) {
      await supabase
        .from('businesses')
        .update({ documents_last_sent_at: now.toISOString() })
        .eq('id', biz.id)
    }

    results.push({ businessId: biz.id, sent: sentCount, skipped: null })
  }

  return NextResponse.json({ ok: true, results })
}
