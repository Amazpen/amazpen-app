/**
 * Revert timezone fix for invoices and payments.
 * Bubble stores dates in UTC, our dashboard filters by date.
 * Both should use UTC dates to match.
 * Daily entries stay fixed (they use חודש field, not date).
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

// UTC date (original import method)
function utcDate(v) {
  if (!v || v === "(no value)") return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

// Local date (the "fix" we need to revert)
function localDate(v) {
  if (!v || v === "(no value)") return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

async function revert() {
  // ═══ REVERT INVOICES ═══
  console.log("=== Reverting Invoice Dates to UTC ===");
  const invoiceRows = parseCsv(BASE + "export_All-------modified---_2026-03-28_19-08-44.csv");

  let reverted = 0;
  for (const r of invoiceRows) {
    const num = r["מספר תעודה (מספר חשבונית)"]?.trim();
    const rawDate = r["תאריך חשבונית"]?.trim();
    if (!rawDate || !num) continue;

    const utc = utcDate(rawDate);
    const local = localDate(rawDate);

    if (utc && local && utc !== local) {
      // Currently stored as local (after fix), revert to UTC
      const { data, error } = await supabase
        .from("invoices")
        .update({ invoice_date: utc })
        .eq("business_id", BIZ)
        .eq("invoice_number", num)
        .eq("invoice_date", local);
      if (!error) reverted++;
    }
  }
  console.log(`  Reverted invoice_date: ${reverted}`);

  // Also revert due_date
  let revertedDue = 0;
  for (const r of invoiceRows) {
    const num = r["מספר תעודה (מספר חשבונית)"]?.trim();
    const rawDue = r["תאריך לתשלום"]?.trim();
    if (!rawDue || !num) continue;

    const utc = utcDate(rawDue);
    const local = localDate(rawDue);

    if (utc && local && utc !== local) {
      await supabase
        .from("invoices")
        .update({ due_date: utc })
        .eq("business_id", BIZ)
        .eq("invoice_number", num)
        .eq("due_date", local);
      revertedDue++;
    }
  }
  console.log(`  Reverted due_date: ${revertedDue}`);

  // ═══ REVERT PAYMENTS ═══
  console.log("\n=== Reverting Payment Dates to UTC ===");
  const paymentRows = parseCsv(BASE + "export_All---------modified_2026-03-28_19-10-50.csv");

  const { data: suppliers } = await supabase.from("suppliers").select("id, name").eq("business_id", BIZ).is("deleted_at", null);
  const supplierMap = {};
  for (const s of suppliers) supplierMap[s.name] = s.id;

  let revertedPay = 0;
  for (const r of paymentRows) {
    const rawDate = r["תאריך התשלום"]?.trim();
    const supplierName = (r["Supplier name"] || r["ספק"] || "").trim();
    if (!rawDate || !supplierName) continue;

    const utc = utcDate(rawDate);
    const local = localDate(rawDate);
    const suppId = supplierMap[supplierName];

    if (utc && local && utc !== local && suppId) {
      await supabase
        .from("payments")
        .update({ payment_date: utc })
        .eq("business_id", BIZ)
        .eq("supplier_id", suppId)
        .eq("payment_date", local);
      revertedPay++;
    }
  }
  console.log(`  Reverted: ${revertedPay}`);

  console.log("\n✅ Done. Invoices and payments back to UTC dates.");
}

revert().catch(console.error);
