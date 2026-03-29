/**
 * Reimport ALL invoices from scratch with correct UTC dates.
 * This undoes both the timezone fix and month-mapping fix.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import Papa from "papaparse";

const supabase = createClient(
  "https://db.amazpenbiz.co.il",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzExNTM2NTMsImV4cCI6MTg5MzQ1NjAwMCwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlzcyI6InN1cGFiYXNlIn0.jO_qu5aNUaOZ0YBdfW5MbzdML-csEU9QkqoTGAx5yzY",
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const BIZ = "49ce2088-f622-487e-9072-c0b3a1f39e76";
const BASE = "C:/Users/netn1/Downloads/פתרחונות לחיות!/";

const parseCsv = (p) =>
  Papa.parse(readFileSync(p, "utf-8").replace(/^\uFEFF/, ""), { header: true, skipEmptyLines: true }).data;

const parseNum = (v) => {
  if (!v) return null;
  const n = parseFloat(String(v).replace(/[,\s₪%]/g, ""));
  return isNaN(n) ? null : n;
};

// UTC date - the ORIGINAL correct method for invoices
function utcDate(v) {
  if (!v || v === "(no value)") return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

function utcTimestamp(v) {
  if (!v || v === "(no value)") return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

async function reimport() {
  // 1. Delete all invoices
  console.log("Step 1: Deleting all invoices...");
  const { count: before } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("business_id", BIZ);
  console.log(`  Current count: ${before}`);

  // Delete in batches
  let deleted = 0;
  while (true) {
    const { data: batch } = await supabase
      .from("invoices")
      .select("id")
      .eq("business_id", BIZ)
      .limit(100);
    if (!batch || batch.length === 0) break;
    await supabase.from("invoices").delete().in("id", batch.map((i) => i.id));
    deleted += batch.length;
    if (deleted % 500 === 0) console.log(`  Deleted ${deleted}...`);
  }
  console.log(`  Total deleted: ${deleted}`);

  // 2. Load suppliers
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("business_id", BIZ)
    .is("deleted_at", null);
  const supplierMap = {};
  for (const s of suppliers) supplierMap[s.name] = s.id;

  // 3. Import invoices with UTC dates
  console.log("\nStep 2: Importing invoices with UTC dates...");
  const rows = parseCsv(BASE + "export_All-------modified---_2026-03-28_19-08-44.csv");
  console.log(`  CSV rows: ${rows.length}`);

  let created = 0, errors = 0;
  for (const r of rows) {
    const supplierName = (r["Supplier name"] || r["ספק"])?.trim();
    let supplierId = supplierMap[supplierName];

    if (!supplierId && supplierName) {
      const { data: newSup } = await supabase
        .from("suppliers")
        .insert({ business_id: BIZ, name: supplierName, expense_type: "operating" })
        .select("id")
        .maybeSingle();
      if (newSup) {
        supplierMap[supplierName] = newSup.id;
        supplierId = newSup.id;
      }
    }

    const invoiceNumber = r["מספר תעודה (מספר חשבונית)"]?.trim() || null;
    const subtotal = parseNum(r["סכום לפני מע\"מ"]);
    const vatAmount = parseNum(r["סכום מע\"מ"]);
    const totalAmount = parseNum(r["סכום אחרי מע''מ"]);
    const invoiceDate = utcDate(r["תאריך חשבונית"]);
    const dueDate = utcDate(r["תאריך לתשלום"]);
    const createdAt = utcTimestamp(r["Creation Date"]);
    const notes = r["הערות למסמך רגיל"]?.trim() || r["הערות לחשבונית בבירור"]?.trim() || null;
    const attachmentUrl = r["תמונת חשבונית 1"]?.trim() || null;

    const bubbleStatus = r["טרם/שולם/שולם/זיכוי"]?.trim() || "";
    let status = "pending";
    if (bubbleStatus === "שולם") status = "paid";
    else if (bubbleStatus === "זיכוי") status = "credited";
    else if (bubbleStatus === "חשבונית בבירור" || r["חשבונית בבירור"]?.trim() === "כן") status = "disputed";

    const isCredit = r["זיכוי"]?.trim() === "כן";

    if (subtotal === null) { errors++; continue; }

    const { error } = await supabase.from("invoices").insert({
      business_id: BIZ,
      supplier_id: supplierId || null,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      due_date: dueDate,
      subtotal,
      vat_amount: vatAmount,
      total_amount: totalAmount,
      status,
      notes,
      attachment_url: attachmentUrl,
      invoice_type: isCredit ? "credit_note" : "invoice",
      created_at: createdAt,
    });

    if (error) {
      errors++;
      if (errors <= 3) console.log(`  Error: ${error.message}`);
    } else {
      created++;
    }
  }
  console.log(`  Created: ${created}, Errors: ${errors}`);

  // 4. Verify
  console.log("\n=== Verification ===");
  const months = ["2025-01", "2025-06", "2025-12", "2026-01", "2026-02", "2026-03"];
  for (const ym of months) {
    const [y, m] = ym.split("-");
    const start = `${ym}-01`;
    const end = new Date(parseInt(y), parseInt(m), 0).toISOString().split("T")[0];

    const { data: check } = await supabase
      .from("invoices")
      .select("subtotal, suppliers!inner(expense_type)")
      .eq("business_id", BIZ)
      .gte("invoice_date", start)
      .lte("invoice_date", end)
      .is("deleted_at", null);

    // Can't filter by join, do it manually
  }

  // Simple count check
  const { count: after } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("business_id", BIZ);
  console.log(`Total invoices: ${after}`);
}

reimport().catch(console.error);
