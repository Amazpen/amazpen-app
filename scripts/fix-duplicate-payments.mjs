/**
 * Remove 107 duplicate split payments.
 * These are undated main payments from Bubble that were imported with
 * first-split date. They duplicate the mid payment amounts.
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
  const mainPay = parseCsv(BASE + "export_All---------modified_2026-03-28_19-10-50.csv");

  // Find undated main payments (split/grouped)
  const undated = mainPay.filter((r) => !r["תאריך התשלום"]?.trim());
  console.log(`Undated split payments to remove: ${undated.length}`);

  // Load suppliers
  const { data: suppliers } = await supabase
    .from("suppliers").select("id, name").eq("business_id", BIZ).is("deleted_at", null);
  const supplierMap = {};
  for (const s of suppliers) supplierMap[s.name] = s.id;

  // Load all DB payments
  const { data: dbPayments } = await supabase
    .from("payments")
    .select("id, supplier_id, total_amount, payment_date")
    .eq("business_id", BIZ)
    .is("deleted_at", null);

  let deleted = 0, notFound = 0;
  const usedDbIds = new Set();

  for (const r of undated) {
    const supplierName = (r["Supplier name"] || r["ספק"] || "").trim();
    const suppId = supplierMap[supplierName];
    const amount = parseNum(r["סכום אחרי מע''מ"]);

    if (!suppId || !amount) { notFound++; continue; }

    // Find matching DB payment (by supplier + amount, not yet deleted)
    const match = dbPayments.find(
      (p) =>
        p.supplier_id === suppId &&
        Math.abs(parseFloat(p.total_amount) - amount) < 1 &&
        !usedDbIds.has(p.id)
    );

    if (!match) { notFound++; continue; }

    usedDbIds.add(match.id);

    // Delete splits first
    await supabase.from("payment_splits").delete().eq("payment_id", match.id);
    // Delete payment
    await supabase.from("payments").delete().eq("id", match.id);
    deleted++;
  }

  console.log(`Deleted: ${deleted}, Not found: ${notFound}`);

  // Verify
  const { count: payCount } = await supabase
    .from("payments")
    .select("*", { count: "exact", head: true })
    .eq("business_id", BIZ)
    .is("deleted_at", null);

  const { data: paySum } = await supabase
    .from("payments")
    .select("total_amount")
    .eq("business_id", BIZ)
    .is("deleted_at", null);

  const totalPay = paySum.reduce((s, p) => s + parseFloat(p.total_amount), 0);

  console.log(`\nRemaining payments: ${payCount} | Total: ₪${totalPay.toFixed(0)}`);

  // Check goods balance
  const { data: goodsSuppliers } = await supabase
    .from("suppliers")
    .select("id")
    .eq("business_id", BIZ)
    .eq("expense_type", "goods_purchases");

  const goodsIds = goodsSuppliers.map((s) => s.id);

  const { data: goodsInv } = await supabase
    .from("invoices")
    .select("total_amount")
    .eq("business_id", BIZ)
    .in("supplier_id", goodsIds)
    .is("deleted_at", null);

  const { data: goodsPay } = await supabase
    .from("payments")
    .select("total_amount")
    .eq("business_id", BIZ)
    .in("supplier_id", goodsIds)
    .is("deleted_at", null);

  const invTotal = goodsInv.reduce((s, i) => s + parseFloat(i.total_amount), 0);
  const payTotal = goodsPay.reduce((s, p) => s + parseFloat(p.total_amount), 0);

  console.log(`\nGoods balance: invoices=₪${invTotal.toFixed(0)} - payments=₪${payTotal.toFixed(0)} = ₪${(invTotal - payTotal).toFixed(0)}`);
  console.log(`Bubble: ₪478,655`);
}

fix().catch(console.error);
