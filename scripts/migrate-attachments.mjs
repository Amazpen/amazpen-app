/**
 * Migrate external attachment URLs (Bubble CDN, Google Drive) to Supabase Storage.
 *
 * Usage:
 *   node scripts/migrate-attachments.mjs --dry-run     # Preview what will be migrated
 *   node scripts/migrate-attachments.mjs --test 2      # Test with 2 files
 *   node scripts/migrate-attachments.mjs               # Migrate ALL files
 *
 * Safe: only UPDATEs the URL column after successful upload. No deletes.
 */

const SUPABASE_URL = "https://db.amazpenbiz.co.il";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzExNTM2NTMsImV4cCI6MTg5MzQ1NjAwMCwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlzcyI6InN1cGFiYXNlIn0.jO_qu5aNUaOZ0YBdfW5MbzdML-csEU9QkqoTGAx5yzY";
const BUCKET = "attachments";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const TEST_LIMIT = args.includes("--test") ? parseInt(args[args.indexOf("--test") + 1]) || 2 : 0;

// Helper: fetch with timeout
async function fetchWithTimeout(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// Supabase REST helper
async function supabaseQuery(table, query = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
  });
  if (!res.ok) throw new Error(`Query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Supabase update helper
async function supabaseUpdate(table, id, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status} ${await res.text()}`);
}

// Upload buffer to Supabase Storage
async function uploadToStorage(buffer, path, contentType) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload failed: ${res.status} ${err}`);
  }
  // Return public URL
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

// Detect content type from response headers or URL
function detectContentType(res, url) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("image/")) return ct.split(";")[0];
  if (ct.includes("application/pdf")) return "application/pdf";
  // Fallback from URL extension
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  const map = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", pdf: "application/pdf", webp: "image/webp" };
  return map[ext] || "image/jpeg";
}

// Get file extension from content type
function getExtension(contentType) {
  const map = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp", "application/pdf": ".pdf" };
  return map[contentType] || ".jpg";
}

// Check if URL is external (needs migration)
function isExternalUrl(url) {
  if (!url) return false;
  return url.includes("bubble.io") || url.includes("drive.google.com") || url.includes("cdn.bubble.io");
}

// Parse attachment_url which can be a single URL or JSON array
function parseUrls(raw) {
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try { return JSON.parse(raw).filter(u => typeof u === "string" && u); } catch { return []; }
  }
  return [raw];
}

// Migrate a single URL: download → upload → return new URL
async function migrateUrl(url, table, id, index) {
  const prefix = `migrated/${table}/${id}`;

  // Fix protocol-relative URLs
  let fetchUrl = url;
  if (url.startsWith("//")) fetchUrl = "https:" + url;

  console.log(`  📥 Downloading: ${fetchUrl.substring(0, 80)}...`);

  const res = await fetchWithTimeout(fetchUrl);
  if (!res.ok) {
    console.log(`  ❌ Download failed: ${res.status}`);
    return null;
  }

  const contentType = detectContentType(res, fetchUrl);
  const ext = getExtension(contentType);
  const buffer = Buffer.from(await res.arrayBuffer());
  const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);

  console.log(`  📦 Downloaded: ${sizeMB}MB (${contentType})`);

  if (buffer.length < 100) {
    console.log(`  ❌ File too small (${buffer.length} bytes), skipping`);
    return null;
  }

  const storagePath = `${prefix}/${index}${ext}`;
  console.log(`  📤 Uploading to: ${BUCKET}/${storagePath}`);

  const newUrl = await uploadToStorage(buffer, storagePath, contentType);
  console.log(`  ✅ New URL: ${newUrl}`);

  return newUrl;
}

// Process a batch of records from a table
async function processTable(table, urlColumn, limit) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Processing table: ${table} (column: ${urlColumn})`);
  console.log(`${"=".repeat(60)}`);

  // Fetch records with external URLs
  const limitParam = limit > 0 ? `&limit=${limit}` : "";
  const records = await supabaseQuery(table, `or=(${urlColumn}.like.*bubble.io*,${urlColumn}.like.*drive.google*)&select=id,${urlColumn}&order=created_at.desc${limitParam}`);

  console.log(`Found ${records.length} records with external URLs`);

  if (DRY_RUN) {
    for (const r of records) {
      const urls = parseUrls(r[urlColumn]);
      const external = urls.filter(isExternalUrl);
      console.log(`  [${r.id}] ${external.length} external URL(s): ${external[0]?.substring(0, 60)}...`);
    }
    return { total: records.length, migrated: 0, failed: 0 };
  }

  let migrated = 0;
  let failed = 0;

  for (const record of records) {
    const rawUrl = record[urlColumn];
    const urls = parseUrls(rawUrl);

    console.log(`\n🔄 Record ${record.id}:`);

    try {
      // If it's a JSON array, migrate each URL
      if (rawUrl.startsWith("[")) {
        const newUrls = [];
        let changed = false;
        for (let i = 0; i < urls.length; i++) {
          if (isExternalUrl(urls[i])) {
            const newUrl = await migrateUrl(urls[i], table, record.id, i);
            newUrls.push(newUrl || urls[i]); // keep old URL if migration fails
            if (newUrl) changed = true;
          } else {
            newUrls.push(urls[i]);
          }
        }
        if (changed) {
          const newValue = newUrls.length === 1 ? newUrls[0] : JSON.stringify(newUrls);
          await supabaseUpdate(table, record.id, { [urlColumn]: newValue });
          migrated++;
          console.log(`  ✅ Updated record with ${newUrls.length} URL(s)`);
        }
      } else {
        // Single URL
        if (isExternalUrl(rawUrl)) {
          const newUrl = await migrateUrl(rawUrl, table, record.id, 0);
          if (newUrl) {
            await supabaseUpdate(table, record.id, { [urlColumn]: newUrl });
            migrated++;
            console.log(`  ✅ Updated record`);
          } else {
            failed++;
          }
        }
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  return { total: records.length, migrated, failed };
}

// Main
async function main() {
  console.log("🔄 Attachment Migration Script");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no changes)" : TEST_LIMIT > 0 ? `TEST (${TEST_LIMIT} per table)` : "FULL MIGRATION"}`);
  console.log(`Target: ${SUPABASE_URL} / bucket: ${BUCKET}`);

  const limit = TEST_LIMIT || 0;

  const results = [];

  // Process each table
  results.push({ table: "invoices", ...await processTable("invoices", "attachment_url", limit) });
  results.push({ table: "payments", ...await processTable("payments", "receipt_url", limit) });

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("SUMMARY");
  console.log(`${"=".repeat(60)}`);
  for (const r of results) {
    console.log(`${r.table}: ${r.total} found, ${r.migrated} migrated, ${r.failed} failed`);
  }

  const totalMigrated = results.reduce((s, r) => s + r.migrated, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  console.log(`\nTotal: ${totalMigrated} migrated, ${totalFailed} failed`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
