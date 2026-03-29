/**
 * Sync invoice status from Bubble API (live) to Supabase.
 * Fetches current status of ALL invoices and updates amount_paid accordingly.
 */
import { createClient } from "@supabase/supabase-js";
import https from "https";

const supabase = createClient(
  "https://db.amazpenbiz.co.il",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzExNTM2NTMsImV4cCI6MTg5MzQ1NjAwMCwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlzcyI6InN1cGFiYXNlIn0.jO_qu5aNUaOZ0YBdfW5MbzdML-csEU9QkqoTGAx5yzY",
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const BIZ_BUBBLE = "1736101460245x305520831136274500";
const BIZ_DB = "49ce2088-f622-487e-9072-c0b3a1f39e76";
const TOKEN = "f450da9bad95645d5c7f25794e1a1f2c";

function fetchBubble(cursor = 0) {
  return new Promise((resolve, reject) => {
    const constraints = JSON.stringify([
      { key: "___2_custom____", constraint_type: "equals", value: BIZ_BUBBLE },
    ]);
    const url = `https://amazpenbiz.co.il/api/1.1/obj/%D7%A7%D7%A0%D7%99%D7%95%D7%AA?constraints=${encodeURIComponent(constraints)}&limit=100&cursor=${cursor}`;

    https.get(url, { headers: { Authorization: `Bearer ${TOKEN}` } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

async function sync() {
  // 1. Fetch ALL invoices from Bubble
  console.log("Fetching from Bubble API...");
  let allBubble = [];
  let cursor = 0;

  while (true) {
    const data = await fetchBubble(cursor);
    const results = data?.response?.results || [];
    const remaining = data?.response?.remaining || 0;
    allBubble.push(...results);
    cursor += results.length;
    if (results.length === 0 || remaining === 0) break;
    process.stdout.write(`  ${allBubble.length} fetched (${remaining} remaining)...\r`);
  }
  console.log(`\nTotal from Bubble: ${allBubble.length}`);

  // 2. Map Bubble fields
  // Status field: ____________________option____________________1
  // Invoice number: ___________text
  // Amount (total): ___________2_number or ______________number
  // Supplier ref: ___4_custom____1

  const statusField = "____________________option____________________1";
  const invoiceNumField = "___________text";
  const amountField = "______________number"; // סכום אחרי מעמ
  const subtotalField = "___________2_number";

  // Count statuses
  const statusCounts = {};
  for (const r of allBubble) {
    const st = r[statusField] || "empty";
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  }
  console.log("Bubble statuses:", statusCounts);

  // 3. Load DB invoices
  const { data: dbInvoices } = await supabase
    .from("invoices")
    .select("id, invoice_number, supplier_id, total_amount, status, amount_paid")
    .eq("business_id", BIZ_DB)
    .is("deleted_at", null);

  console.log(`DB invoices: ${dbInvoices.length}`);

  // 4. Match Bubble → DB by invoice_number + amount
  let updated = 0, notFound = 0, unchanged = 0;

  for (const b of allBubble) {
    const bubbleStatus = b[statusField] || "";
    const invoiceNum = b[invoiceNumField] || "";
    const totalAmount = b[amountField] || 0;

    if (!invoiceNum) { notFound++; continue; }

    // Map status
    let dbStatus = "pending";
    let amountPaid = 0;
    if (bubbleStatus === "שולם") {
      dbStatus = "paid";
      amountPaid = totalAmount;
    } else if (bubbleStatus === "זיכוי") {
      dbStatus = "credited";
    } else if (bubbleStatus === "בבירור" || bubbleStatus === "חשבונית בבירור") {
      dbStatus = "disputed";
    }

    // Find matching DB invoice
    const match = dbInvoices.find(
      (inv) => inv.invoice_number === invoiceNum && Math.abs(parseFloat(inv.total_amount) - totalAmount) < 1
    );

    if (!match) {
      // Try just by invoice_number
      const match2 = dbInvoices.find((inv) => inv.invoice_number === invoiceNum);
      if (!match2) { notFound++; continue; }

      if (match2.status === dbStatus) { unchanged++; continue; }

      await supabase
        .from("invoices")
        .update({ status: dbStatus, amount_paid: amountPaid })
        .eq("id", match2.id);
      updated++;
      continue;
    }

    if (match.status === dbStatus) { unchanged++; continue; }

    await supabase
      .from("invoices")
      .update({ status: dbStatus, amount_paid: amountPaid })
      .eq("id", match.id);
    updated++;
  }

  console.log(`\nUpdated: ${updated}, Unchanged: ${unchanged}, Not found: ${notFound}`);

  // 5. Verify
  console.log("\n=== Verification ===");

  // Goods open balance
  const { data: goodsCheck } = await supabase
    .from("invoices")
    .select("total_amount, amount_paid, status")
    .eq("business_id", BIZ_DB)
    .is("deleted_at", null)
    .in("supplier_id", (await supabase.from("suppliers").select("id").eq("business_id", BIZ_DB).eq("expense_type", "goods_purchases")).data.map(s => s.id));

  const goodsTotal = goodsCheck.reduce((s, i) => s + parseFloat(i.total_amount), 0);
  const goodsPaid = goodsCheck.reduce((s, i) => s + parseFloat(i.amount_paid || 0), 0);
  const goodsPending = goodsCheck.filter(i => i.status === "pending").reduce((s, i) => s + parseFloat(i.total_amount), 0);

  console.log(`Goods: total=₪${goodsTotal.toFixed(0)} | paid=₪${goodsPaid.toFixed(0)} | open(total-paid)=₪${(goodsTotal - goodsPaid).toFixed(0)} | pending=₪${goodsPending.toFixed(0)}`);
  console.log(`Bubble shows: ₪478,655`);

  // Per top supplier
  const { data: topSuppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("business_id", BIZ_DB)
    .eq("expense_type", "goods_purchases")
    .is("deleted_at", null);

  for (const s of topSuppliers.slice(0, 10)) {
    const supInv = goodsCheck.filter(i => {
      // Can't filter by supplier here since we didn't fetch supplier_id
      return false;
    });
  }
}

sync().catch(console.error);
