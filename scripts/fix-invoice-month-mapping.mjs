/**
 * Fix invoice month mapping: 129 invoices have invoice_date at end of month
 * but Bubble assigns them to the next month (via חודש מספר field).
 * Move invoice_date to 1st of the Bubble month.
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

async function fix() {
  const rows = parseCsv(BASE + "export_All-------modified---_2026-03-28_19-08-44.csv");

  let fixed = 0, notFound = 0;
  for (const r of rows) {
    const d = r["תאריך חשבונית"]?.trim();
    if (!d) continue;
    const date = new Date(d);
    if (isNaN(date.getTime())) continue;

    const dbDate = date.toISOString().split("T")[0]; // UTC date as stored in DB
    const dbMonth = date.getUTCMonth() + 1;
    const dbYear = date.getUTCFullYear();

    const bubbleMonth = parseInt(r["חודש (מספר)"] || "0");
    const bubbleYear = parseInt(r["שנה"] || "0");

    if (!bubbleMonth || !bubbleYear) continue;
    if (dbMonth === bubbleMonth && dbYear === bubbleYear) continue;

    // Need to fix: move to 1st of Bubble's month
    const newDate = `${bubbleYear}-${String(bubbleMonth).padStart(2, "0")}-01`;
    const invoiceNum = r["מספר תעודה (מספר חשבונית)"]?.trim();

    if (!invoiceNum) {
      // Match by supplier + date + subtotal
      const supplier = (r["Supplier name"] || r["ספק"] || "").trim();
      const subtotal = r["סכום לפני מע\"מ"]?.trim();

      const { data: suppliers } = await supabase
        .from("suppliers").select("id").eq("business_id", BIZ).eq("name", supplier).is("deleted_at", null).maybeSingle();

      if (suppliers && subtotal) {
        const { error } = await supabase
          .from("invoices")
          .update({ invoice_date: newDate })
          .eq("business_id", BIZ)
          .eq("supplier_id", suppliers.id)
          .eq("invoice_date", dbDate)
          .eq("subtotal", parseFloat(subtotal));
        if (!error) fixed++;
        else notFound++;
      } else {
        notFound++;
      }
      continue;
    }

    const { error, count } = await supabase
      .from("invoices")
      .update({ invoice_date: newDate })
      .eq("business_id", BIZ)
      .eq("invoice_number", invoiceNum)
      .eq("invoice_date", dbDate);

    if (!error) fixed++;
    else notFound++;
  }

  console.log(`Fixed: ${fixed}, Not found: ${notFound}`);

  // Verify
  console.log("\n=== Verification: March 2026 ===");
  const { data: marchCheck } = await supabase.rpc("read_only_query", {
    sql_query: `
      SELECT s.expense_type, COUNT(*) as cnt, SUM(i.subtotal)::numeric(12,2) as subtotal
      FROM invoices i JOIN suppliers s ON i.supplier_id = s.id
      WHERE i.business_id = '${BIZ}'
      AND i.invoice_date >= '2026-03-01' AND i.invoice_date <= '2026-03-31'
      AND i.deleted_at IS NULL
      GROUP BY s.expense_type
    `
  });
  console.log(marchCheck);
  console.log("\nExpected: goods=₪220,371 | expenses=₪79,635");
}

fix().catch(console.error);
