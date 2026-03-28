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

const parseDateOnly = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
};

async function fix() {
  // 1. Delete ALL existing splits for this business
  console.log("Step 1: Deleting old splits...");
  const { data: allPay } = await supabase.from("payments").select("id").eq("business_id", BIZ);
  const payIds = allPay.map((p) => p.id);
  for (let i = 0; i < payIds.length; i += 50) {
    await supabase.from("payment_splits").delete().in("payment_id", payIds.slice(i, i + 50));
  }
  console.log("  Deleted all existing splits");

  // 2. Load suppliers
  const { data: suppliers } = await supabase.from("suppliers").select("id, name").eq("business_id", BIZ).is("deleted_at", null);
  const supplierMap = {};
  for (const s of suppliers) supplierMap[s.name] = s.id;
  const supplierIdToName = {};
  for (const s of suppliers) supplierIdToName[s.id] = s.name;

  // 3. Load CSVs
  const mainPayments = parseCsv(BASE + "export_All---------modified_2026-03-28_19-10-50.csv");
  const midPayments = parseCsv(BASE + "export_All-------------modified_2026-03-28_19-05-43.csv");
  const splitRows = parseCsv(BASE + "export_All------------modified_2026-03-28_19-10-37.csv")
    .filter((r) => r["עסק"]?.trim() === "פתרונות לחיות");

  // 4. Build chain maps
  const mainById = {};
  for (const m of mainPayments) mainById[m["unique id"]?.trim()] = m;

  const midToMain = {};
  for (const m of midPayments) {
    midToMain[m["unique id"]?.trim()] = m["תשלום ראשי"]?.trim();
  }

  // Group splits by mid payment
  const splitsByMid = {};
  for (const sp of splitRows) {
    const midRef = sp["אמצעי תשלום"]?.trim();
    if (!splitsByMid[midRef]) splitsByMid[midRef] = [];
    splitsByMid[midRef].push(sp);
  }

  // 5. Load DB payments for matching
  const { data: dbPayments } = await supabase.from("payments").select("id, payment_date, total_amount, supplier_id").eq("business_id", BIZ);
  const dbPayByKey = {};
  for (const p of dbPayments) {
    const name = supplierIdToName[p.supplier_id] || "";
    const key = name + "|" + p.payment_date + "|" + parseFloat(p.total_amount).toFixed(2);
    dbPayByKey[key] = p.id;
  }

  // ── REGULAR PAYMENTS: create 1 split per payment ──
  console.log("\nStep 2: Regular payment splits...");
  let regularSplits = 0;
  for (const r of mainPayments) {
    const date = r["תאריך התשלום"]?.trim();
    if (!date) continue; // skip split payments

    const supplierName = (r["Supplier name"] || r["ספק"])?.trim();
    const amount = parseNum(r["סכום אחרי מע''מ"]);
    const paymentDate = parseDateOnly(date);
    const supplierId = supplierMap[supplierName];
    if (!supplierId || !paymentDate || amount === null) continue;

    const key = supplierName + "|" + paymentDate + "|" + amount.toFixed(2);
    const dbPayId = dbPayByKey[key];
    if (!dbPayId) continue;

    const payMethod = r["סוג אמצעי תשלום"]?.trim() || null;
    const checkNum = r["מס' צ'ק"]?.trim() || null;
    const refNum = r["אסמכתא"]?.trim() || null;

    const { error } = await supabase.from("payment_splits").insert({
      payment_id: dbPayId,
      payment_method: payMethod,
      amount,
      check_number: checkNum,
      reference_number: refNum,
      due_date: paymentDate,
    });
    if (!error) regularSplits++;
  }
  console.log("  Regular splits created:", regularSplits);

  // ── SPLIT PAYMENTS: create payment + multiple splits ──
  console.log("\nStep 3: Split payments...");
  let splitPaymentsCreated = 0, splitSplitsCreated = 0, splitErrors = 0;

  // Track processed main payment bubble IDs to avoid duplicates
  const processedMain = new Set();

  for (const mid of midPayments) {
    const midId = mid["unique id"]?.trim();
    const mainRef = midToMain[midId];
    if (!mainRef || processedMain.has(mainRef)) continue;
    processedMain.add(mainRef);

    const mainRow = mainById[mainRef];
    if (!mainRow) continue;

    const supplierName = (mainRow["Supplier name"] || mainRow["ספק"])?.trim();
    const supplierId = supplierMap[supplierName];
    if (!supplierId) {
      splitErrors++;
      if (splitErrors <= 3) console.log("  No supplier:", supplierName);
      continue;
    }

    const totalAmount = parseNum(mainRow["סכום אחרי מע''מ"]);
    const notes = mainRow["הערות"]?.trim() || null;
    const receiptUrl = mainRow["הוכחת תשלום 1"]?.trim() || null;

    // Collect ALL splits for this main payment (through all mid payments)
    const allMidIds = Object.entries(midToMain)
      .filter(([_, ref]) => ref === mainRef)
      .map(([midId]) => midId);

    const allSplits = [];
    for (const mId of allMidIds) {
      const s = splitsByMid[mId] || [];
      allSplits.push(...s);
    }

    if (allSplits.length === 0) { splitErrors++; continue; }

    // First split date = payment date
    const firstDate = parseDateOnly(allSplits[0]["תאריך תשלום"]);
    if (!firstDate) { splitErrors++; continue; }

    // Create the payment
    const { data: inserted, error } = await supabase.from("payments").insert({
      business_id: BIZ,
      supplier_id: supplierId,
      payment_date: firstDate,
      total_amount: totalAmount,
      notes,
      receipt_url: receiptUrl,
    }).select("id").maybeSingle();

    if (error || !inserted) {
      splitErrors++;
      if (splitErrors <= 5) console.log("  Payment error:", error?.message, "| supplier:", supplierName);
      continue;
    }
    splitPaymentsCreated++;

    // Create splits
    for (const sp of allSplits) {
      const amount = parseNum(sp['סכום תשלום אחרי מע"מ']);
      if (amount === null) continue;

      const { error: spErr } = await supabase.from("payment_splits").insert({
        payment_id: inserted.id,
        payment_method: sp["סוג אמצעי תשלום"]?.trim() || null,
        amount,
        check_number: sp["מספר צ'ק"]?.trim() || null,
        reference_number: sp["מספר אסמכתא"]?.trim() || null,
        due_date: parseDateOnly(sp["תאריך תשלום"]),
      });
      if (!spErr) splitSplitsCreated++;
    }
  }

  console.log("  Split payments created:", splitPaymentsCreated);
  console.log("  Split splits created:", splitSplitsCreated);
  console.log("  Errors:", splitErrors);

  // ── VERIFICATION ──
  console.log("\n=== VERIFICATION ===");
  const { count: finalPayCount } = await supabase.from("payments").select("*", { count: "exact", head: true }).eq("business_id", BIZ);
  console.log("Total payments:", finalPayCount);

  const { data: finalAllPay } = await supabase.from("payments").select("id").eq("business_id", BIZ);
  let finalSplitCount = 0;
  for (let i = 0; i < finalAllPay.length; i += 50) {
    const { count } = await supabase.from("payment_splits").select("*", { count: "exact", head: true }).in("payment_id", finalAllPay.slice(i, i + 50).map((p) => p.id));
    finalSplitCount += count || 0;
  }
  console.log("Total splits:", finalSplitCount);

  // Verify total amounts match
  const csvRegularTotal = mainPayments
    .filter((r) => r["תאריך התשלום"]?.trim())
    .reduce((sum, r) => sum + (parseNum(r["סכום אחרי מע''מ"]) || 0), 0);
  const csvSplitTotal = mainPayments
    .filter((r) => !r["תאריך התשלום"]?.trim())
    .reduce((sum, r) => sum + (parseNum(r["סכום אחרי מע''מ"]) || 0), 0);

  // DB totals
  let dbTotal = 0;
  const { data: dbSums } = await supabase.from("payments").select("total_amount").eq("business_id", BIZ);
  for (const p of dbSums) dbTotal += parseFloat(p.total_amount) || 0;

  console.log("");
  console.log("CSV regular total: ₪" + csvRegularTotal.toFixed(2));
  console.log("CSV split total:   ₪" + csvSplitTotal.toFixed(2));
  console.log("CSV grand total:   ₪" + (csvRegularTotal + csvSplitTotal).toFixed(2));
  console.log("DB total:          ₪" + dbTotal.toFixed(2));
  console.log("Difference:        ₪" + Math.abs(dbTotal - csvRegularTotal - csvSplitTotal).toFixed(2));
}

fix().catch(console.error);
