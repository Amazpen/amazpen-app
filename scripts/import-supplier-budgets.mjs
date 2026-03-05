/**
 * Import: Supplier Budgets for נס ציונה
 *   תקציבי ספקים נס ציונה.csv → supplier_budgets
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import Papa from "papaparse";

const SUPABASE_URL = "https://db.amazpenbiz.co.il";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzExNTM2NTMsImV4cCI6MTg5MzQ1NjAwMCwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlzcyI6InN1cGFiYXNlIn0.jO_qu5aNUaOZ0YBdfW5MbzdML-csEU9QkqoTGAx5yzY";
const BUSINESS_ID = "6998ef49-c3db-4c57-96de-2a470ca4c766";
const CSV_PATH = "C:/Users/netn1/Downloads/תקציבי ספקים נס ציונה.csv";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const parseNum = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(String(v).replace(/[,\s]/g, ""));
  return isNaN(n) ? null : n;
};

// Load suppliers
const { data: suppliers } = await supabase.from("suppliers").select("id, name").eq("business_id", BUSINESS_ID);
const supplierMap = new Map((suppliers || []).map(s => [s.name.trim().toLowerCase(), s.id]));
console.log(`Loaded ${suppliers?.length} suppliers`);

// Clear existing
const { error: delErr } = await supabase.from("supplier_budgets").delete().eq("business_id", BUSINESS_ID);
if (delErr) { console.error("Delete failed:", delErr.message); process.exit(1); }
console.log("✅ Cleared existing supplier budgets");

// Parse CSV
const content = readFileSync(CSV_PATH, "utf-8").replace(/^\uFEFF/, "");
const rows = Papa.parse(content, { header: true, skipEmptyLines: true }).data;
console.log(`CSV rows: ${rows.length}`);

let inserted = 0, skipped = 0, errors = 0;
const unmatched = new Set();
const toInsert = [];

// Aggregate: same supplier may appear multiple times per month (different categories) → SUM
const aggregated = new Map(); // key: "supplierId:year:month" → total amount

for (const row of rows) {
  const supplierName = (row["ספק"] || "").trim();
  if (!supplierName) { skipped++; continue; }

  const supplierId = supplierMap.get(supplierName.toLowerCase());
  if (!supplierId) { unmatched.add(supplierName); skipped++; continue; }

  const year  = parseInt(row["שנה"]);
  const month = parseInt(row["חודש (במספר)"]);
  if (!year || !month) { skipped++; continue; }

  const key = `${supplierId}:${year}:${month}`;
  const prev = aggregated.get(key) || { business_id: BUSINESS_ID, supplier_id: supplierId, year, month, budget_amount: 0 };
  prev.budget_amount += parseNum(row["סכום תקציב חודשי"]) ?? 0;
  aggregated.set(key, prev);
}

for (const item of aggregated.values()) {
  toInsert.push(item);
}

// Batch insert
const BATCH = 100;
for (let i = 0; i < toInsert.length; i += BATCH) {
  const batch = toInsert.slice(i, i + BATCH);
  const { error } = await supabase.from("supplier_budgets").insert(batch);
  if (error) { console.error(`Batch ${i}: ${error.message}`); errors += batch.length; }
  else { inserted += batch.length; console.log(`✅ rows ${i+1}-${Math.min(i+BATCH, toInsert.length)}`); }
}

if (unmatched.size > 0) {
  console.log(`\n⚠️  Unmatched suppliers (${unmatched.size}):`);
  [...unmatched].sort().forEach(s => console.log(`  - ${s}`));
}

console.log(`\nInserted: ${inserted}, Skipped: ${skipped}, Errors: ${errors}`);
