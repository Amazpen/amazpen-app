import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import JSZip from 'jszip'

/**
 * OCR Document Email Sender — Cron endpoint (weekly + monthly batches).
 *
 * Daily-frequency businesses are NOT sent from here — they fire from the
 * OCR submit flow via /api/ocr/send-document-now the moment a document is
 * approved, so the customer doesn't wait until tomorrow's cron.
 *
 * For weekly (every Sunday) and monthly (rolling 30-day window since the
 * last successful send), this endpoint:
 *   1. Fetches every approved doc that hasn't been successfully emailed.
 *   2. Builds a ZIP in-memory (n8n's Code node can't require jszip/zlib
 *      on Render, so we do this server-side).
 *   3. Uploads the ZIP to Supabase Storage with a short-lived signed URL.
 *   4. Calls n8n with mode='zip-url' and the signed URL — n8n just
 *      downloads the ZIP and attaches it to the email.
 *
 * Daily as a safety net: if a doc somehow missed its immediate send
 * (network blip, n8n outage), tomorrow's cron picks it up because dedup
 * is against successful log rows only.
 */

const N8N_WEBHOOK_URL = 'https://n8n-lv4j.onrender.com/webhook/send-ocr-documents'

// Storage bucket where we drop the per-business ZIPs that n8n will pull
// down and attach to the email. Kept short-lived (signed URL, see below).
const ZIP_BUCKET = 'attachments'

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

    // This endpoint only handles weekly + monthly. Daily was already
    // routed away above; we leave the daily handler as a no-op so that
    // *if* it ever runs (e.g. the cron is reused on an unconfigured
    // schedule), it still cleanly skips every business.
    //
    // Build a single ZIP for all unsent docs of this business. We need to
    // do this in our own runtime because n8n's task runner blocks both
    // 'jszip' and 'zlib' on this Render instance, so a Code node can't
    // build the archive itself.
    const zip = new JSZip()
    const usedNames = new Set<string>()
    const sanitize = (s: string) =>
      s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120)

    let zipBuildErr: string | null = null
    for (const d of docsForN8n) {
      try {
        const r = await fetch(d.imageUrl)
        if (!r.ok) {
          zipBuildErr = `download failed for ${d.id}: HTTP ${r.status}`
          continue
        }
        const buf = Buffer.from(await r.arrayBuffer())
        // Pull a real extension from the URL when possible; fall back to .pdf
        // because that's what most attachment URLs end with on this app.
        const extMatch = d.imageUrl.split('?')[0].match(/\.(pdf|jpe?g|png|gif|webp|tiff?|heic|bmp)$/i)
        const ext = extMatch ? extMatch[1].toLowerCase() : 'pdf'
        const baseName = d.originalFilename.replace(/\.[^.]+$/, '') || `document-${d.id}`
        const supplier = sanitize(`${d.invoiceNumber || baseName}`)
        let candidate = `${supplier}.${ext}`
        let n = 2
        while (usedNames.has(candidate)) {
          candidate = `${sanitize(supplier)}_(${n}).${ext}`
          n++
        }
        usedNames.add(candidate)
        zip.file(candidate, buf)
      } catch (err) {
        zipBuildErr = err instanceof Error ? err.message : 'unknown error'
      }
    }

    // If every download failed, mark everything as a failed send and move
    // on — there's nothing to attach.
    if (usedNames.size === 0) {
      const logRows = docsForN8n.map(d => ({
        business_id: biz.id,
        ocr_document_id: d.id,
        sent_to: biz.documents_email,
        send_mode: 'zip-url',
        error_message: zipBuildErr || 'no files downloaded',
      }))
      await supabase.from('ocr_email_send_log').insert(logRows)
      results.push({ businessId: biz.id, sent: 0, skipped: 'zip-empty' })
      continue
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

    // Upload to Supabase Storage. Path includes a timestamp so each run
    // gets its own object — n8n only needs read access for a few minutes.
    const objectPath = `ocr-zips/${biz.id}/${now.toISOString().replace(/[:.]/g, '-')}.zip`
    const { error: uploadErr } = await supabase
      .storage
      .from(ZIP_BUCKET)
      .upload(objectPath, zipBuffer, {
        contentType: 'application/zip',
        upsert: true,
      })

    if (uploadErr) {
      const logRows = docsForN8n.map(d => ({
        business_id: biz.id,
        ocr_document_id: d.id,
        sent_to: biz.documents_email,
        send_mode: 'zip-url',
        error_message: `storage upload failed: ${uploadErr.message}`,
      }))
      await supabase.from('ocr_email_send_log').insert(logRows)
      results.push({ businessId: biz.id, sent: 0, skipped: 'upload-failed' })
      continue
    }

    // Signed URL good for an hour — long enough for n8n to download even
    // if it cold-starts.
    const { data: signed } = await supabase
      .storage
      .from(ZIP_BUCKET)
      .createSignedUrl(objectPath, 60 * 60)

    const zipUrl = signed?.signedUrl
    if (!zipUrl) {
      const logRows = docsForN8n.map(d => ({
        business_id: biz.id,
        ocr_document_id: d.id,
        sent_to: biz.documents_email,
        send_mode: 'zip-url',
        error_message: 'failed to sign URL',
      }))
      await supabase.from('ocr_email_send_log').insert(logRows)
      results.push({ businessId: biz.id, sent: 0, skipped: 'sign-failed' })
      continue
    }

    // Hand the URL to n8n. The webhook-side workflow now downloads the
    // ZIP from this URL and attaches it directly — no Code node, no
    // disallowed modules.
    let success = false
    let errorMsg: string | null = null
    try {
      const resp = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'zip-url',
          to: biz.documents_email,
          businessName: biz.name,
          zipUrl,
          zipFilename: `documents-${biz.name}-${now.toISOString().split('T')[0]}.zip`,
          period: freq,
          documentCount: usedNames.size,
        }),
      })
      success = resp.ok
      if (!success) errorMsg = `n8n responded ${resp.status}`
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'unknown error'
    }

    const sentCount = success ? docsForN8n.length : 0

    // Log every doc — successes log error_message=null, which the dedup
    // query above uses to know we're done with that doc.
    {
      const logRows = docsForN8n.map(d => ({
        business_id: biz.id,
        ocr_document_id: d.id,
        sent_to: biz.documents_email,
        send_mode: 'zip-url',
        error_message: errorMsg,
      }))
      await supabase.from('ocr_email_send_log').insert(logRows)
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
