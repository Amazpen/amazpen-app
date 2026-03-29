/**
 * Fix timezone issue: Bubble dates like "Mar 1, 2026 12:00 am" were parsed
 * by new Date() as local time, shifting to Feb 28 in UTC.
 * This script recalculates correct dates using getUTC* methods.
 *
 * Fixes: invoices.invoice_date, invoices.due_date, payments.payment_date, payment_splits.due_date
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

// CORRECT date parser: use LOCAL time (Bubble dates are in local timezone)
function correctDate(v) {
  if (!v || v === "(no value)") return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// OLD (buggy) date parser that was used during import
function buggyDate(v) {
  if (!v || v === "(no value)") return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0]; // Uses UTC which shifts midnight local dates
}

async function fix() {
  // ═══ FIX INVOICES ═══
  console.log("=== Fixing Invoice Dates ===");
  const invoiceRows = parseCsv(BASE + "export_All-------modified---_2026-03-28_19-08-44.csv");

  // Build map: invoice_number + supplier → correct date
  const invoiceFixes = []; // { invoice_number, old_date, new_date }
  for (const r of invoiceRows) {
    const num = r["מספר תעודה (מספר חשבונית)"]?.trim();
    const rawDate = r["תאריך חשבונית"]?.trim();
    if (!rawDate || !num) continue;

    const correct = correctDate(rawDate);
    const buggy = buggyDate(rawDate);

    if (correct && buggy && correct !== buggy) {
      invoiceFixes.push({ num, oldDate: buggy, newDate: correct, supplier: (r["Supplier name"] || r["ספק"] || "").trim() });
    }
  }

  console.log(`  Invoices needing date fix: ${invoiceFixes.length}`);

  // Apply fixes in batches
  let fixedInvoices = 0;
  for (const fix of invoiceFixes) {
    const { error } = await supabase
      .from("invoices")
      .update({ invoice_date: fix.newDate })
      .eq("business_id", BIZ)
      .eq("invoice_number", fix.num)
      .eq("invoice_date", fix.oldDate);

    if (!error) fixedInvoices++;
  }
  console.log(`  Fixed: ${fixedInvoices}`);

  // Also fix due_date
  let fixedDueDates = 0;
  for (const r of invoiceRows) {
    const num = r["מספר תעודה (מספר חשבונית)"]?.trim();
    const rawDueDate = r["תאריך לתשלום"]?.trim();
    if (!rawDueDate || !num) continue;

    const correct = correctDate(rawDueDate);
    const buggy = buggyDate(rawDueDate);

    if (correct && buggy && correct !== buggy) {
      const { error } = await supabase
        .from("invoices")
        .update({ due_date: correct })
        .eq("business_id", BIZ)
        .eq("invoice_number", num)
        .eq("due_date", buggy);
      if (!error) fixedDueDates++;
    }
  }
  console.log(`  Fixed due_dates: ${fixedDueDates}`);

  // ═══ FIX PAYMENTS ═══
  console.log("\n=== Fixing Payment Dates ===");
  const paymentRows = parseCsv(BASE + "export_All---------modified_2026-03-28_19-10-50.csv");

  let fixedPayments = 0;
  for (const r of paymentRows) {
    const rawDate = r["תאריך התשלום"]?.trim();
    const supplierName = (r["Supplier name"] || r["ספק"] || "").trim();
    const totalAmount = r["סכום אחרי מע''מ"]?.trim();
    if (!rawDate || !supplierName) continue;

    const correct = correctDate(rawDate);
    const buggy = buggyDate(rawDate);

    if (correct && buggy && correct !== buggy && totalAmount) {
      // Match by supplier + old date + amount
      const { data: suppliers } = await supabase
        .from("suppliers")
        .select("id")
        .eq("business_id", BIZ)
        .eq("name", supplierName)
        .is("deleted_at", null)
        .maybeSingle();

      if (suppliers) {
        const { error } = await supabase
          .from("payments")
          .update({ payment_date: correct })
          .eq("business_id", BIZ)
          .eq("supplier_id", suppliers.id)
          .eq("payment_date", buggy);
        if (!error) fixedPayments++;
      }
    }
  }
  console.log(`  Fixed: ${fixedPayments}`);

  // ═══ VERIFY ═══
  console.log("\n=== Verification: March 2026 Goods Invoices ===");
  const { data: marchGoods } = await supabase
    .from("invoices")
    .select("subtotal, suppliers!inner(expense_type)")
    .eq("business_id", BIZ)
    .gte("invoice_date", "2026-03-01")
    .lte("invoice_date", "2026-03-31")
    .is("deleted_at", null)
    .eq("suppliers.expense_type", "goods_purchases");

  // Can't join like that with supabase-js, use raw count
  const { data: marchGoodsCheck } = await supabase.rpc("read_only_query", {
    sql_query: `SELECT SUM(i.subtotal)::numeric(12,2) as total FROM invoices i JOIN suppliers s ON i.supplier_id = s.id WHERE i.business_id = '${BIZ}' AND i.invoice_date >= '2026-03-01' AND i.invoice_date <= '2026-03-31' AND i.deleted_at IS NULL AND s.expense_type = 'goods_purchases'`
  });
  console.log("  Goods subtotal:", marchGoodsCheck);
  console.log("  Expected (from CSV): ₪200,698 (עלות מכר) + ₪25,771 (יבוא) = ₪226,469");
}

fix().catch(console.error);
