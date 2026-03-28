/**
 * Fix daily entries:
 * 1. Delete all existing daily_entries + breakdowns for פתרונות לחיות
 * 2. Re-import with correct date handling (no timezone shift)
 * 3. Merge duplicate dates (sum amounts)
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

// Parse Bubble date to YYYY-MM-DD WITHOUT timezone conversion
function parseBubbleDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  // Bubble dates like "Mar 1, 2026 12:00 am" mean exactly that date
  // Use UTC methods since Bubble stores as midnight UTC
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function fix() {
  // 1. Delete existing breakdowns and entries
  console.log("Step 1: Deleting existing daily data...");

  const { data: existingEntries } = await supabase
    .from("daily_entries")
    .select("id")
    .eq("business_id", BIZ);

  if (existingEntries && existingEntries.length > 0) {
    const ids = existingEntries.map((e) => e.id);
    // Delete breakdowns first (FK constraint)
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      await supabase.from("daily_income_breakdown").delete().in("daily_entry_id", batch);
      await supabase.from("daily_payment_breakdown").delete().in("daily_entry_id", batch);
      await supabase.from("daily_parameters").delete().in("daily_entry_id", batch);
      await supabase.from("daily_product_usage").delete().in("daily_entry_id", batch);
      await supabase.from("daily_entry_approvals").delete().in("daily_entry_id", batch);
    }
    // Delete entries
    for (let i = 0; i < ids.length; i += 50) {
      await supabase.from("daily_entries").delete().in("id", ids.slice(i, i + 50));
    }
    console.log(`  Deleted ${existingEntries.length} entries + breakdowns`);
  }

  // 2. Load CSV
  const rows = parseCsv(BASE + "export_All------------modified_2026-03-28_19-07-16.csv");
  const filtered = rows.filter((r) => r["עסק"]?.trim() === "פתרונות לחיות");
  console.log(`\nStep 2: Processing ${filtered.length} rows...`);

  // 3. Group by date and MERGE duplicates
  const byDate = {};
  for (const r of filtered) {
    const entryDate = parseBubbleDate(r["תאריך"]);
    if (!entryDate) continue;

    if (!byDate[entryDate]) {
      byDate[entryDate] = {
        total_register: 0,
        labor_cost: 0,
        labor_hours: 0,
        discounts: 0,
        day_factor: 0,
        manager_daily_cost: 0,
        income_sources: [
          { amount: 0, orders: 0 },
          { amount: 0, orders: 0 },
          { amount: 0, orders: 0 },
          { amount: 0, orders: 0 },
        ],
        rowCount: 0,
      };
    }

    const entry = byDate[entryDate];
    entry.total_register += parseNum(r['סה"כ z יומי']) || parseNum(r["הכנסות"]) || 0;
    entry.labor_cost += parseNum(r["ע.עובדים יומית ללא העמסה"]) || 0;
    entry.labor_hours += parseNum(r["כמות שעות עובדים"]) || 0;
    entry.discounts += parseNum(r["זיכוי+ביטול+הנחות ב ₪"]) || 0;
    entry.manager_daily_cost += parseNum(r["שכר מנהל יומי כולל העמסה"]) || 0;
    entry.rowCount++;

    // day_factor: take max (if one row is 1 and other is 1, result should be 1)
    const df = parseNum(r["יום חלקי/יום מלא"]) || 1;
    entry.day_factor = Math.max(entry.day_factor, df);

    // Income sources
    const sources = [
      { amount: 'סה"כ הכנסות 1', count: "כמות הזמנות 1" },
      { amount: 'סה"כ הכנסות 2', count: "כמות הזמנות 2" },
      { amount: 'סה"כ הכנסות 3', count: "כמות הזמנות 3" },
      { amount: 'סה"כ הכנסות 4', count: "כמות הזמנות 4" },
    ];
    for (let i = 0; i < 4; i++) {
      entry.income_sources[i].amount += parseNum(r[sources[i].amount]) || 0;
      entry.income_sources[i].orders += parseNum(r[sources[i].count]) || 0;
    }
  }

  const dates = Object.keys(byDate).sort();
  console.log(`  Unique dates: ${dates.length}`);
  const merged = dates.filter((d) => byDate[d].rowCount > 1);
  console.log(`  Merged dates (had duplicates): ${merged.length}`);

  // 4. Load income sources
  const { data: sources } = await supabase
    .from("income_sources")
    .select("id, name, display_order")
    .eq("business_id", BIZ)
    .is("deleted_at", null)
    .order("display_order");

  const sourceByOrder = {};
  if (sources) {
    for (const s of sources) sourceByOrder[s.display_order] = s.id;
    console.log(`  Income sources: ${sources.map((s) => `${s.display_order}:${s.name}`).join(", ")}`);
  }

  // 5. Insert merged entries
  console.log("\nStep 3: Inserting entries...");
  let created = 0, errors = 0, breakdowns = 0;
  let grandTotal = 0;

  for (const entryDate of dates) {
    const entry = byDate[entryDate];
    grandTotal += entry.total_register;

    const { data: inserted, error } = await supabase
      .from("daily_entries")
      .insert({
        business_id: BIZ,
        entry_date: entryDate,
        total_register: entry.total_register,
        labor_cost: entry.labor_cost,
        labor_hours: entry.labor_hours,
        discounts: entry.discounts,
        day_factor: entry.day_factor,
        manager_daily_cost: entry.manager_daily_cost,
      })
      .select("id")
      .maybeSingle();

    if (error || !inserted) {
      errors++;
      if (errors <= 3) console.log(`  ❌ ${entryDate}: ${error?.message}`);
      continue;
    }
    created++;

    // Income breakdowns
    for (let i = 0; i < 4; i++) {
      const src = entry.income_sources[i];
      const sourceId = sourceByOrder[i];
      if ((!src.amount && !src.orders) || !sourceId) continue;

      await supabase.from("daily_income_breakdown").insert({
        daily_entry_id: inserted.id,
        income_source_id: sourceId,
        amount: src.amount,
        orders_count: src.orders ? Math.round(src.orders) : null,
      });
      breakdowns++;
    }
  }

  console.log(`  ✅ Entries created: ${created}, errors: ${errors}`);
  console.log(`  ✅ Income breakdowns: ${breakdowns}`);
  console.log(`  Grand total: ₪${grandTotal.toFixed(2)}`);

  // 6. Verify per month
  console.log("\n=== VERIFICATION ===");
  const { data: dbEntries } = await supabase
    .from("daily_entries")
    .select("entry_date, total_register")
    .eq("business_id", BIZ)
    .is("deleted_at", null)
    .order("entry_date");

  const dbByMonth = {};
  let dbGrandTotal = 0;
  for (const e of dbEntries) {
    const ym = e.entry_date.substring(0, 7);
    if (!dbByMonth[ym]) dbByMonth[ym] = { total: 0, days: 0 };
    dbByMonth[ym].total += parseFloat(e.total_register);
    dbByMonth[ym].days++;
    dbGrandTotal += parseFloat(e.total_register);
  }

  // CSV totals by month
  const csvByMonth = {};
  for (const [date, entry] of Object.entries(byDate)) {
    const ym = date.substring(0, 7);
    if (!csvByMonth[ym]) csvByMonth[ym] = { total: 0, days: 0 };
    csvByMonth[ym].total += entry.total_register;
    csvByMonth[ym].days++;
  }

  console.log("Month    | CSV Days | CSV Total     | DB Days | DB Total      | Diff");
  console.log("---------|----------|---------------|---------|---------------|------");
  for (const ym of Object.keys(csvByMonth).sort()) {
    const csv = csvByMonth[ym];
    const db = dbByMonth[ym] || { total: 0, days: 0 };
    const diff = Math.abs(csv.total - db.total);
    const ok = diff < 1 ? "✅" : "❌";
    console.log(
      `${ym}  | ${String(csv.days).padStart(4)}     | ₪${csv.total.toFixed(0).padStart(10)} | ${String(db.days).padStart(4)}    | ₪${db.total.toFixed(0).padStart(10)} | ${ok} ${diff.toFixed(2)}`
    );
  }
  console.log("");
  console.log(`CSV Grand Total: ₪${grandTotal.toFixed(2)}`);
  console.log(`DB Grand Total:  ₪${dbGrandTotal.toFixed(2)}`);
  console.log(`Difference:      ₪${Math.abs(grandTotal - dbGrandTotal).toFixed(2)}`);
}

fix().catch(console.error);
