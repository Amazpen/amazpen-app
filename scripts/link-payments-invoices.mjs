/**
 * Link payments to invoices using Bubble's חשבוניות field.
 * Maps Bubble invoice IDs → DB invoice IDs by matching invoice_number + supplier.
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

async function link() {
  const paymentsCsv = parseCsv(BASE + "export_All---------modified_2026-03-28_19-10-50.csv");
  const invoicesCsv = parseCsv(BASE + "export_All-------modified---_2026-03-28_19-08-44.csv");

  // 1. Build Bubble invoice ID → invoice_number + supplier map
  const bubbleInvMap = {}; // bubble_id → { num, supplier, amount }
  for (const inv of invoicesCsv) {
    const bubbleId = inv["unique id"]?.trim();
    if (!bubbleId) continue;
    bubbleInvMap[bubbleId] = {
      num: inv["מספר תעודה (מספר חשבונית)"]?.trim() || null,
      supplier: (inv["Supplier name"] || inv["ספק"] || "").trim(),
      amount: parseNum(inv["סכום אחרי מע''מ"]),
      subtotal: parseNum(inv["סכום לפני מע\"מ"]),
    };
  }

  // 2. Load all DB invoices for this business
  const { data: dbInvoices } = await supabase
    .from("invoices")
    .select("id, invoice_number, supplier_id, total_amount, subtotal")
    .eq("business_id", BIZ)
    .is("deleted_at", null);

  // 3. Load suppliers
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("business_id", BIZ)
    .is("deleted_at", null);
  const supplierNameToId = {};
  const supplierIdToName = {};
  for (const s of suppliers) {
    supplierNameToId[s.name] = s.id;
    supplierIdToName[s.id] = s.name;
  }

  // 4. Build DB invoice lookup: invoice_number + supplier_id → db_id
  // For invoices with same number, use amount to disambiguate
  const dbInvLookup = {}; // "num|supplier_id" → [db_ids]
  for (const inv of dbInvoices) {
    const key = `${inv.invoice_number}|${inv.supplier_id}`;
    if (!dbInvLookup[key]) dbInvLookup[key] = [];
    dbInvLookup[key].push(inv);
  }

  // 5. Map Bubble invoice ID → DB invoice ID
  const bubbleToDb = {}; // bubble_id → db_id
  let mapped = 0, notMapped = 0;

  for (const [bubbleId, info] of Object.entries(bubbleInvMap)) {
    const suppId = supplierNameToId[info.supplier];
    if (!suppId) { notMapped++; continue; }

    const key = `${info.num}|${suppId}`;
    const candidates = dbInvLookup[key] || [];

    if (candidates.length === 1) {
      bubbleToDb[bubbleId] = candidates[0].id;
      mapped++;
    } else if (candidates.length > 1) {
      // Match by amount
      const match = candidates.find(c =>
        Math.abs(parseFloat(c.total_amount) - info.amount) < 1
      );
      if (match) {
        bubbleToDb[bubbleId] = match.id;
        mapped++;
      } else {
        // Take first
        bubbleToDb[bubbleId] = candidates[0].id;
        mapped++;
      }
    } else {
      // Try without invoice_number (match by supplier + amount)
      const bySupplier = dbInvoices.filter(
        (inv) => inv.supplier_id === suppId && Math.abs(parseFloat(inv.total_amount) - info.amount) < 1
      );
      if (bySupplier.length > 0) {
        bubbleToDb[bubbleId] = bySupplier[0].id;
        mapped++;
      } else {
        notMapped++;
      }
    }
  }

  console.log(`Mapped Bubble→DB invoices: ${mapped}, Not mapped: ${notMapped}`);

  // 6. Load DB payments and match to CSV by supplier + date + amount
  const { data: dbPayments } = await supabase
    .from("payments")
    .select("id, supplier_id, payment_date, total_amount, invoice_id")
    .eq("business_id", BIZ)
    .is("deleted_at", null);

  // 7. For each CSV payment with invoice link, find DB payment and update
  let linked = 0, alreadyLinked = 0, payNotFound = 0, invNotFound = 0;

  for (const p of paymentsCsv) {
    const invoiceRefs = (p["חשבוניות"] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (invoiceRefs.length === 0) continue;

    // Find the first invoice ID
    const firstInvBubbleId = invoiceRefs[0];
    const dbInvId = bubbleToDb[firstInvBubbleId];
    if (!dbInvId) { invNotFound++; continue; }

    // Find matching DB payment
    const supplierName = (p["Supplier name"] || p["ספק"] || "").trim();
    const suppId = supplierNameToId[supplierName];
    const payDate = p["תאריך התשלום"]?.trim();
    const payAmount = parseNum(p["סכום אחרי מע''מ"]);

    if (!suppId) { payNotFound++; continue; }

    // Match by supplier + amount (date might be null for split payments)
    let dbPay;
    if (payDate) {
      const utcDate = new Date(payDate).toISOString().split("T")[0];
      dbPay = dbPayments.find(
        (dp) =>
          dp.supplier_id === suppId &&
          dp.payment_date === utcDate &&
          !dp.invoice_id && // not already linked
          Math.abs(parseFloat(dp.total_amount) - payAmount) < 1
      );
    }
    if (!dbPay) {
      // Try without date
      dbPay = dbPayments.find(
        (dp) =>
          dp.supplier_id === suppId &&
          !dp.invoice_id &&
          Math.abs(parseFloat(dp.total_amount) - payAmount) < 1
      );
    }

    if (!dbPay) {
      // Relaxed: any unlinked payment for this supplier
      dbPay = dbPayments.find(
        (dp) => dp.supplier_id === suppId && !dp.invoice_id
      );
    }

    if (!dbPay) { payNotFound++; continue; }

    if (dbPay.invoice_id) {
      alreadyLinked++;
      continue;
    }

    // Update payment with invoice_id
    const { error } = await supabase
      .from("payments")
      .update({ invoice_id: dbInvId })
      .eq("id", dbPay.id);

    if (!error) {
      dbPay.invoice_id = dbInvId; // Mark as linked in memory
      linked++;
    }
  }

  console.log(`Linked: ${linked}, Already linked: ${alreadyLinked}, Pay not found: ${payNotFound}, Inv not found: ${invNotFound}`);

  // 8. Verify: check supplier balances for top suppliers
  console.log("\n=== Supplier Balances ===");
  const topSuppliers = ["ד\"ר יובל סמואל בע\"מ", "מיקס פור פטס  בע\"מ", "אמיתי", "פט אימפורט בעמ", "בית ארז"];

  for (const name of topSuppliers) {
    const suppId = supplierNameToId[name];
    if (!suppId) continue;

    // Total invoices
    const invTotal = dbInvoices
      .filter((i) => i.supplier_id === suppId)
      .reduce((sum, i) => sum + parseFloat(i.total_amount || 0), 0);

    // Total payments
    const payTotal = dbPayments
      .filter((p) => p.supplier_id === suppId)
      .reduce((sum, p) => sum + parseFloat(p.total_amount || 0), 0);

    const balance = invTotal - payTotal;
    console.log(`${name}: invoices=₪${invTotal.toFixed(0)} | payments=₪${payTotal.toFixed(0)} | balance=₪${balance.toFixed(0)}`);
  }
}

link().catch(console.error);
