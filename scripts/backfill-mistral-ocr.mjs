#!/usr/bin/env node
/**
 * Backfill Mistral OCR + structured extraction for documents that were
 * processed BEFORE the parallel Mistral pipeline went live in n8n.
 *
 * Reads pending ocr_documents whose ocr_extracted_data row is missing
 * mistral_supplier_name, runs Mistral OCR on the public image_url, runs
 * GPT-4o-mini for structured extraction (mirrors n8n flow), and writes
 * to the mistral_* columns. Does NOT touch Google Vision data.
 *
 * Usage:
 *   node scripts/backfill-mistral-ocr.mjs            # process up to 20 docs
 *   node scripts/backfill-mistral-ocr.mjs --limit=5  # process N docs
 *   node scripts/backfill-mistral-ocr.mjs --doc=UUID # process specific doc
 */

import { readFileSync } from 'node:fs';
try {
  const envFile = readFileSync('.env.local', 'utf-8');
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
} catch (e) { /* env file is optional */ }

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://db.amazpenbiz.co.il';
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!SK || !MISTRAL_KEY || !OPENAI_KEY) {
  console.error('Missing env: SUPABASE_SERVICE_ROLE_KEY, MISTRAL_API_KEY, OPENAI_API_KEY');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    return m ? [m[1], m[2] || true] : [a, true];
  })
);
const LIMIT = Number(args.limit || 20);
const SPECIFIC_DOC = args.doc || null;

const sbHeaders = {
  apikey: SK,
  Authorization: `Bearer ${SK}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function fetchPendingDocs() {
  if (SPECIFIC_DOC) {
    const url = `${SB}/rest/v1/ocr_documents?select=id,image_url,file_type,business_id,ocr_extracted_data(id,mistral_supplier_name,mistral_processed_at)&id=eq.${SPECIFIC_DOC}`;
    const res = await fetch(url, { headers: sbHeaders });
    return res.json();
  }
  const url = `${SB}/rest/v1/ocr_documents?select=id,image_url,file_type,business_id,ocr_extracted_data!inner(id,mistral_supplier_name,mistral_processed_at)&status=eq.pending&order=created_at.desc&limit=${LIMIT * 3}`;
  const res = await fetch(url, { headers: sbHeaders });
  const all = await res.json();
  return all
    .filter(d => {
      const e = Array.isArray(d.ocr_extracted_data) ? d.ocr_extracted_data[0] : d.ocr_extracted_data;
      return !e?.mistral_supplier_name;
    })
    .slice(0, LIMIT);
}

async function fetchSuppliers(businessId) {
  if (!businessId) return [];
  const url = `${SB}/rest/v1/suppliers?select=id,name,tax_id&business_id=eq.${businessId}&is_active=eq.true&deleted_at=is.null&order=name.asc`;
  const res = await fetch(url, { headers: sbHeaders });
  return res.json();
}

async function runMistralOcr(imageUrl, isPdf) {
  const document = isPdf
    ? { type: 'document_url', document_url: imageUrl }
    : { type: 'image_url', image_url: imageUrl };
  const res = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MISTRAL_KEY}` },
    body: JSON.stringify({ model: 'mistral-ocr-latest', document, include_image_base64: false }),
  });
  if (!res.ok) throw new Error(`Mistral OCR ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const pages = data.pages || [];
  return pages
    .map((p, i) => {
      const md = p.markdown || '';
      return pages.length > 1 ? `--- עמוד ${i + 1} ---\n${md}` : md;
    })
    .join('\n\n');
}

async function runGptExtract(markdown, suppliers) {
  let suppliersMd = '| ID | Name | Tax ID |\n|---|---|---|\n';
  for (const s of suppliers) {
    suppliersMd += `| ${s.id} | ${s.name || ''} | ${s.tax_id || ''} |\n`;
  }
  const systemPrompt = `You are an expert extraction algorithm for Israeli invoices and financial documents.
The markdown was produced by Mistral Document AI and PRESERVES TABLE STRUCTURE — lines starting with \`|\` are table rows.

The supplier name/details usually appear at the TOP. The business (customer) details appear below.

Suppliers list for this business (match the issuer/seller to this list):
${suppliersMd}

If the supplier is NOT in the list above, still extract supplier_name and supplier_tax_id — leave supplier_id empty.

IMPORTANT: Write dates in YYYY-MM-DD format. We are in 2026.

For document_type return ONLY one of: invoice, delivery_note, credit_note, payment, summary, daily_entry. Never Hebrew.

Extract ALL line items from the table rows as a structured array. Each item: description, quantity, unit_price, total. Max 50 items. Use the table structure — each \`|\`-row is one item.

amount_before_vat, vat_amount, amount_after_vat must be numeric totals — never 0 unless the document explicitly shows 0.

Return ONLY a JSON object with these keys: document_type, document_number, date (YYYY-MM-DD), supplier_name, supplier_tax_id, supplier_id, amount_before_vat, vat_amount, amount_after_vat, discount_amount, discount_percentage, items.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Document markdown:\n\n${markdown}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`GPT ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = v => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const text = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
const dateOrNull = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null);

async function processDoc(doc) {
  const docId = doc.id;
  const imageUrl = doc.image_url;
  const isPdf = doc.file_type === 'pdf' || /\.pdf(\?|$)/i.test(imageUrl);
  console.log(`\n--- ${docId} (${isPdf ? 'PDF' : 'IMAGE'}) ---`);
  console.log(`URL: ${imageUrl}`);

  let markdown = '';
  try {
    markdown = await runMistralOcr(imageUrl, isPdf);
    console.log(`✓ Mistral OCR: ${markdown.length} chars`);
  } catch (err) {
    console.error(`✗ Mistral OCR failed: ${err.message}`);
    await fetch(`${SB}/rest/v1/ocr_extracted_data?document_id=eq.${docId}`, {
      method: 'PATCH',
      headers: sbHeaders,
      body: JSON.stringify({
        mistral_error: err.message.slice(0, 500),
        mistral_processed_at: new Date().toISOString(),
      }),
    });
    return;
  }

  const suppliers = await fetchSuppliers(doc.business_id);
  let ai = {};
  try {
    ai = await runGptExtract(markdown, suppliers);
    console.log(`✓ GPT extract: supplier=${ai.supplier_name}, total=${ai.amount_after_vat}, items=${(ai.items || []).length}`);
  } catch (err) {
    console.error(`✗ GPT failed: ${err.message}`);
    await fetch(`${SB}/rest/v1/ocr_extracted_data?document_id=eq.${docId}`, {
      method: 'PATCH',
      headers: sbHeaders,
      body: JSON.stringify({
        mistral_markdown: markdown,
        mistral_error: `GPT: ${err.message.slice(0, 480)}`,
        mistral_processed_at: new Date().toISOString(),
      }),
    });
    return;
  }

  let items = Array.isArray(ai.items) ? ai.items.filter(i => i?.description) : [];
  if (items.length > 100) items = items.slice(0, 100);
  const allowedTypes = ['invoice', 'delivery_note', 'credit_note', 'payment', 'summary', 'daily_entry'];
  const docType = allowedTypes.includes((ai.document_type || '').toLowerCase()) ? ai.document_type.toLowerCase() : 'invoice';
  let supplierId = (ai.supplier_id || '').trim();
  if (supplierId && !uuidRegex.test(supplierId)) supplierId = '';
  if (!supplierId && suppliers.length && ai.supplier_name) {
    const name = ai.supplier_name.trim();
    const taxId = (ai.supplier_tax_id || '').trim();
    const match = suppliers.find(s =>
      (taxId && s.tax_id === taxId) ||
      (name && s.name && (s.name.includes(name) || name.includes(s.name)))
    );
    if (match) supplierId = match.id;
  }

  const patchRes = await fetch(`${SB}/rest/v1/ocr_extracted_data?document_id=eq.${docId}`, {
    method: 'PATCH',
    headers: sbHeaders,
    body: JSON.stringify({
      mistral_markdown: markdown,
      mistral_supplier_name: text(ai.supplier_name),
      mistral_supplier_tax_id: text(ai.supplier_tax_id),
      mistral_document_number: text(ai.document_number),
      mistral_document_date: dateOrNull(ai.date),
      mistral_subtotal: num(ai.amount_before_vat),
      mistral_vat_amount: num(ai.vat_amount),
      mistral_total_amount: num(ai.amount_after_vat),
      mistral_discount_amount: num(ai.discount_amount),
      mistral_discount_percentage: num(ai.discount_percentage),
      mistral_matched_supplier_id: supplierId || null,
      mistral_document_type: docType,
      mistral_line_items: items,
      mistral_processed_at: new Date().toISOString(),
      mistral_error: null,
    }),
  });
  if (!patchRes.ok) {
    console.error(`✗ DB patch failed: ${patchRes.status} ${await patchRes.text()}`);
  } else {
    console.log(`✓ Saved to DB`);
  }
}

(async () => {
  const docs = await fetchPendingDocs();
  console.log(`Processing ${docs.length} document(s)...`);
  for (const doc of docs) {
    try {
      await processDoc(doc);
    } catch (err) {
      console.error(`✗ Unhandled error on ${doc.id}: ${err.message}`);
    }
  }
  console.log('\nDone.');
})();
