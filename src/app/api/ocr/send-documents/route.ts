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
  reviewed_at: string | null
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

    // Frequency dictates the *primary* time window for fresh docs, but we
    // ALWAYS run for every business every day. Reason: when n8n returns 5xx
    // (which it has done in production), a monthly retry-once-per-month means
    // failed docs silently drop out of the window forever. The cron now
    // re-considers every approved-but-not-yet-successfully-emailed doc on
    // every run, regardless of frequency. The frequency just controls when
    // *new* docs are first considered (so weekly customers don't get a daily
    // trickle).

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

    // Look back 90 days for any approved doc — the dedup against
    // ocr_email_send_log below is what actually prevents resending. The
    // 90-day cap is just a safety net to keep the query bounded.
    const lookbackDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    const { data: docs, error: docsErr } = await supabase
      .from('ocr_documents')
      .select('id, business_id, image_url, original_filename, created_invoice_id, created_payment_id, created_delivery_note_id, reviewed_at')
      .eq('business_id', biz.id)
      .eq('status', 'approved')
      .gte('reviewed_at', lookbackDate.toISOString())
      .or(orParts.join(','))

    if (docsErr || !docs || docs.length === 0) {
      results.push({ businessId: biz.id, sent: 0, skipped: 'no-docs' })
      continue
    }

    // Pull every send-log row for these docs (success AND failure). A doc is
    // "done" only if it has at least one successful (error_message IS NULL)
    // log row — failures don't count, so they get retried on subsequent runs.
    const docIds = docs.map(d => d.id)
    const { data: sentLog } = await supabase
      .from('ocr_email_send_log')
      .select('ocr_document_id, error_message')
      .eq('business_id', biz.id)
      .in('ocr_document_id', docIds)

    const successfullySent = new Set(
      (sentLog || [])
        .filter(l => l.error_message === null)
        .map(l => l.ocr_document_id),
    )

    // Frequency only controls when a business gets emailed at all — once a
    // business *is* due to be sent today, every approved doc that hasn't yet
    // been successfully emailed comes along, regardless of when the doc
    // itself was reviewed. Failures are picked up as well: if n8n returned
    // 5xx last run, the doc is still considered "not yet sent".

    // Decide whether this business is due today.
    // - daily: every day
    // - weekly: only on Sunday (dayOfWeek === 0)
    // - monthly: only when 30 days have elapsed since the last successful
    //   send (or never sent — first run). Anchoring on the last send means
    //   "the past 30 days of activity, ending today" — exactly what the user
    //   asked for: e.g. running on 03.05 covers everything from 03.04 to 03.05,
    //   not the calendar month of April.
    let dueToday: boolean
    if (freq === 'weekly') {
      dueToday = dayOfWeek === 0
    } else if (freq === 'monthly') {
      // Find the most recent successful send timestamp for this business
      const { data: lastSuccess } = await supabase
        .from('ocr_email_send_log')
        .select('sent_at')
        .eq('business_id', biz.id)
        .is('error_message', null)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const lastSuccessMs = lastSuccess?.sent_at ? new Date(lastSuccess.sent_at).getTime() : 0
      const daysSinceLast = (now.getTime() - lastSuccessMs) / (24 * 60 * 60 * 1000)
      // First run (no successful send yet) OR ≥ 30 days since the last one
      dueToday = lastSuccessMs === 0 || daysSinceLast >= 30
    } else {
      dueToday = true
    }

    if (!dueToday) {
      results.push({ businessId: biz.id, sent: 0, skipped: 'not-due-today' })
      continue
    }

    const unsent = (docs as OcrDoc[]).filter(d => !successfullySent.has(d.id))

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

    // POST a single batch to n8n. We deliberately do NOT retry inside the
    // same run: when n8n's workflow itself is broken (e.g. it consistently
    // 500s because a Code node references a disallowed module), retries
    // amplify the problem into dozens of identical failed executions per
    // run. The next scheduled cron day still picks the doc up because we
    // dedupe against successful log rows only.
    const postBatch = async (
      batch: typeof docsForN8n,
    ): Promise<{ success: boolean; errorMsg: string | null }> => {
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
        if (resp.ok) return { success: true, errorMsg: null }
        return { success: false, errorMsg: `n8n responded ${resp.status}` }
      } catch (err) {
        return { success: false, errorMsg: err instanceof Error ? err.message : 'unknown error' }
      }
    }

    let sentCount = 0
    for (const batch of batches) {
      const { success, errorMsg } = await postBatch(batch)

      // Log every doc in batch — successes log error_message=null, which the
      // dedup query above uses to know we're done with that doc.
      const logRows = batch.map(d => ({
        business_id: biz.id,
        ocr_document_id: d.id,
        sent_to: biz.documents_email,
        send_mode: sendMode,
        error_message: errorMsg,
      }))
      await supabase.from('ocr_email_send_log').insert(logRows)

      if (success) sentCount += batch.length
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
