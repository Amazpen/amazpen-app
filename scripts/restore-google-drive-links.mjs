/**
 * Restore Google Drive links from CSV to invoices.
 * Matches by supplier_name + invoice_number + total_amount (within ±1).
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const SUPABASE_URL = "https://db.amazpenbiz.co.il";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzExNTM2NTMsImV4cCI6MTg5MzQ1NjAwMCwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlzcyI6InN1cGFiYXNlIn0.jO_qu5aNUaOZ0YBdfW5MbzdML-csEU9QkqoTGAx5yzY";

const CSV_PATH = "C:/Users/netn1/Downloads/פתרחונות לחיות!/חשבוניות.csv";

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) { fields.push(current); current = ''; }
    else current += ch;
  }
  fields.push(current);
  return fields;
}

function extractGoogleDriveUrls(text) {
  if (!text) return [];
  const regex = /https?:\/\/drive\.google\.com\/[^\s,"\]]+/g;
  const urls = [];
  let m;
  while ((m = regex.exec(text)) !== null) urls.push(m[0]);
  return urls;
}

// Fix bubble protocol-relative URLs
function fixUrl(url) {
  if (!url) return null;
  url = url.trim();
  if (url.startsWith('//')) return 'https:' + url;
  return url;
}

async function supabaseQuery(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Query failed: ${res.status}`);
  return res.json();
}

async function supabaseUpdate(table, id, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json", "Prefer": "return=minimal",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status} ${await res.text()}`);
}

async function main() {
  console.log("📖 Reading CSV...");

  const lines = [];
  const rl = createInterface({ input: createReadStream(CSV_PATH, 'utf-8'), crlfDelay: Infinity });
  for await (const line of rl) lines.push(line);

  // Column indexes (from analysis)
  const COL = {
    invoiceNumber: 26,  // מספר תעודה (מספר חשבונית)
    totalAmount: 37,    // סכום אחרי מע''מ
    supplier: 40,       // ספק
    business: 41,       // עסק
    invoiceDate: 48,    // תאריך חשבונית
    img1: 52,           // תמונת חשבונית 1
    img2: 53,           // תמונת חשבונית 2
    img3: 54,           // תמונת חשבונית 3
    allImg: 20,         // כל התמונות
    payImg: 51,         // תמונת הוכחת תשלום
  };

  // Collect CSV rows with Google Drive URLs
  const csvRows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].includes('drive.google')) continue;
    const fields = parseCSVLine(lines[i]);

    // Collect all Google Drive URLs from all image columns
    const urls = new Set();
    for (const idx of [COL.img1, COL.img2, COL.img3, COL.allImg]) {
      for (const u of extractGoogleDriveUrls(fields[idx] || '')) urls.add(u);
    }
    // Also collect bubble URLs as additional image sources
    const allImgField = fields[COL.allImg] || '';
    const bubbleUrls = [];
    const bubbleRegex = /\/\/ae8ccc76b2d94d531551691b1d6411c9\.cdn\.bubble\.io\/[^\s,"\]]+/g;
    let bm;
    while ((bm = bubbleRegex.exec(allImgField)) !== null) bubbleUrls.push(fixUrl(bm[0]));

    if (urls.size === 0) continue;

    const invoiceNumber = (fields[COL.invoiceNumber] || '').trim();
    const totalAmount = parseFloat((fields[COL.totalAmount] || '0').replace(/[^\d.-]/g, '')) || 0;
    const supplier = (fields[COL.supplier] || '').trim();
    const business = (fields[COL.business] || '').trim();

    csvRows.push({
      invoiceNumber,
      totalAmount,
      supplier,
      business,
      googleUrls: [...urls],
    });
  }

  console.log(`Found ${csvRows.length} CSV rows with Google Drive URLs\n`);

  // Fetch all invoices with NULL attachment_url
  console.log("📊 Fetching invoices with NULL attachment_url...");
  const nullInvoices = await supabaseQuery(
    'invoices?select=id,invoice_number,total_amount,supplier:suppliers(name),business:businesses(name)&attachment_url=is.null&limit=5000'
  );
  console.log(`Found ${nullInvoices.length} invoices with no attachment\n`);

  // Build lookup: key = supplier|invoiceNumber|amount (rounded)
  const invoiceMap = new Map();
  for (const inv of nullInvoices) {
    const supplierName = inv.supplier?.name || '';
    const bizName = inv.business?.name || '';
    const num = (inv.invoice_number || '').trim();
    const amount = parseFloat(inv.total_amount) || 0;

    // Primary key: supplier + invoice number + amount
    if (num) {
      const key = `${supplierName}|${num}|${Math.round(amount)}`;
      if (!invoiceMap.has(key)) invoiceMap.set(key, inv.id);
    }
    // Secondary key with business
    if (num && bizName) {
      const key2 = `${supplierName}|${bizName}|${num}`;
      if (!invoiceMap.has(key2)) invoiceMap.set(key2, inv.id);
    }
  }

  let restored = 0;
  let notFound = 0;
  const notFoundList = [];

  for (const row of csvRows) {
    // Try matching
    const key1 = `${row.supplier}|${row.invoiceNumber}|${Math.round(row.totalAmount)}`;
    const key2 = `${row.supplier}|${row.business}|${row.invoiceNumber}`;
    const invoiceId = invoiceMap.get(key1) || invoiceMap.get(key2);

    if (!invoiceId) {
      notFound++;
      if (notFound <= 5) notFoundList.push(`  ${row.supplier} | ${row.invoiceNumber} | ${row.totalAmount}`);
      continue;
    }

    const urlValue = row.googleUrls.length === 1 ? row.googleUrls[0] : JSON.stringify(row.googleUrls);

    try {
      await supabaseUpdate('invoices', invoiceId, { attachment_url: urlValue });
      restored++;
      if (restored <= 10 || restored % 50 === 0) {
        console.log(`  ✅ ${restored}: ${row.supplier} #${row.invoiceNumber} → ${row.googleUrls[0].substring(0, 60)}...`);
      }
    } catch (err) {
      console.error(`  ❌ ${invoiceId}: ${err.message}`);
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`DONE: ${restored} restored, ${notFound} not matched`);
  if (notFoundList.length > 0) {
    console.log(`\nSample unmatched:`);
    notFoundList.forEach(l => console.log(l));
  }
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
