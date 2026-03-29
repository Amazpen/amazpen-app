/**
 * Update invoice status and amount_paid from Bubble CSV.
 * Bubble field: 'טרם/שולם/שולם/זיכוי' and 'שולם עד כה'
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
  const n = parseFloat(String(v).replace(/[,\s]/g, ""));
  return isNaN(n) ? null : n;
};

async function fix() {
  const csvRows = parseCsv(BASE + "export_All-------modified---_2026-03-28_19-08-44.csv");

  // Load suppliers
  const { data: suppliers } = await supabase.from("suppliers").select("id, name").eq("business_id", BIZ).is("deleted_at", null);
  const supplierNameToId = {};
  for (const s of suppliers) supplierNameToId[s.name] = s.id;

  // Load all DB invoices
  const { data: dbInvoices } = await supabase
    .from("invoices")
    .select("id, invoice_number, supplier_id, total_amount, status, amount_paid")
    .eq("business_id", BIZ)
    .is("deleted_at", null);

  // Build lookup
  const dbInvLookup = {};
  for (const inv of dbInvoices) {
    const key = `${inv.invoice_number}|${inv.supplier_id}`;
    if (!dbInvLookup[key]) dbInvLookup[key] = [];
    dbInvLookup[key].push(inv);
  }

  let updated = 0, notFound = 0;
  for (const r of csvRows) {
    const bubbleStatus = r["טרם/שולם/שולם/זיכוי"]?.trim() || "";
    const supplierName = (r["Supplier name"] || r["ספק"] || "").trim();
    const invoiceNum = r["מספר תעודה (מספר חשבונית)"]?.trim();
    const totalAmount = parseNum(r["סכום אחרי מע''מ"]);
    const suppId = supplierNameToId[supplierName];

    if (!suppId || !invoiceNum) continue;

    // Map status
    let status = "pending";
    let amountPaid = 0;
    if (bubbleStatus === "שולם") {
      status = "paid";
      amountPaid = totalAmount || 0;
    } else if (bubbleStatus === "זיכוי") {
      status = "credited";
    } else if (bubbleStatus === "ממתין לתשלום" || bubbleStatus === "טרם") {
      status = "pending";
    }

    // Find DB invoice
    const key = `${invoiceNum}|${suppId}`;
    const candidates = dbInvLookup[key] || [];
    let dbInv = candidates.length === 1 ? candidates[0] : candidates.find(c => Math.abs(parseFloat(c.total_amount) - totalAmount) < 1);

    if (!dbInv) { notFound++; continue; }

    // Update
    const { error } = await supabase
      .from("invoices")
      .update({ status, amount_paid: amountPaid })
      .eq("id", dbInv.id);

    if (!error) updated++;
  }

  console.log(`Updated: ${updated}, Not found: ${notFound}`);

  // Verify: check status distribution
  const { data: statusCheck } = await supabase
    .from("invoices")
    .select("status")
    .eq("business_id", BIZ)
    .is("deleted_at", null);

  const statusCounts = {};
  for (const inv of statusCheck) {
    statusCounts[inv.status] = (statusCounts[inv.status] || 0) + 1;
  }
  console.log("Status distribution:", statusCounts);

  // Check supplier balances
  console.log("\n=== Supplier Balances (unpaid invoices) ===");
  const names = ["ד\"ר יובל סמואל בע\"מ", "מיקס פור פטס  בע\"מ", "אמיתי", "פט אימפורט בעמ", "בית ארז"];
  for (const name of names) {
    const suppId = supplierNameToId[name];
    if (!suppId) continue;

    const unpaid = dbInvoices.filter(i => i.supplier_id === suppId && i.status !== "paid");
    // Reload to get updated status
    const { data: fresh } = await supabase
      .from("invoices")
      .select("total_amount, status")
      .eq("supplier_id", suppId)
      .eq("business_id", BIZ)
      .is("deleted_at", null)
      .neq("status", "paid");

    const unpaidTotal = (fresh || []).reduce((s, i) => s + parseFloat(i.total_amount || 0), 0);
    console.log(`${name}: unpaid=₪${unpaidTotal.toFixed(0)}`);
  }
}

fix().catch(console.error);
