/**
 * Fix month mapping: 8 daily entries have entry_date in one month but
 * Bubble assigns them to the next month. We need to:
 * 1. For entries WITHOUT conflict (target date doesn't exist): just update entry_date
 * 2. For entries WITH conflict (target date exists): merge into existing entry (sum amounts)
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

// The 8 dates that need remapping
const REMAPS = [
  { from: "2024-12-31", to: "2025-01-01" },
  { from: "2025-03-31", to: "2025-04-01" },
  { from: "2025-05-31", to: "2025-06-01" },
  { from: "2025-07-31", to: "2025-08-01" },
  { from: "2025-08-31", to: "2025-09-01" },
  { from: "2025-12-31", to: "2026-01-01" },
  { from: "2026-01-31", to: "2026-02-01" },
  { from: "2026-02-28", to: "2026-03-01" },
];

async function fix() {
  for (const { from, to } of REMAPS) {
    console.log(`\n--- ${from} → ${to} ---`);

    // Get the "from" entry
    const { data: fromEntry } = await supabase
      .from("daily_entries")
      .select("*")
      .eq("business_id", BIZ)
      .eq("entry_date", from)
      .is("deleted_at", null)
      .maybeSingle();

    if (!fromEntry) {
      console.log("  No entry found for", from, "— skipping");
      continue;
    }

    // Check if "to" entry exists
    const { data: toEntry } = await supabase
      .from("daily_entries")
      .select("*")
      .eq("business_id", BIZ)
      .eq("entry_date", to)
      .is("deleted_at", null)
      .maybeSingle();

    if (!toEntry) {
      // Simple case: just move the date
      const { error } = await supabase
        .from("daily_entries")
        .update({ entry_date: to })
        .eq("id", fromEntry.id);
      if (error) console.log("  ❌ Update error:", error.message);
      else console.log("  ✅ Moved", from, "→", to, "(no conflict)");
    } else {
      // Conflict: need to merge "from" INTO "to"
      console.log("  Conflict! Merging into existing entry on", to);

      // 1. Move income breakdowns from "from" to "to"
      const { data: fromBreakdowns } = await supabase
        .from("daily_income_breakdown")
        .select("*")
        .eq("daily_entry_id", fromEntry.id);

      const { data: toBreakdowns } = await supabase
        .from("daily_income_breakdown")
        .select("*")
        .eq("daily_entry_id", toEntry.id);

      // For each "from" breakdown, add to matching "to" breakdown
      for (const fb of fromBreakdowns || []) {
        const match = (toBreakdowns || []).find(
          (tb) => tb.income_source_id === fb.income_source_id
        );
        if (match) {
          // Add amounts
          await supabase
            .from("daily_income_breakdown")
            .update({
              amount: parseFloat(match.amount) + parseFloat(fb.amount),
              orders_count: (match.orders_count || 0) + (fb.orders_count || 0),
            })
            .eq("id", match.id);
        } else {
          // Move breakdown to "to" entry
          await supabase
            .from("daily_income_breakdown")
            .update({ daily_entry_id: toEntry.id })
            .eq("id", fb.id);
        }
      }

      // 2. Update "to" entry totals (sum from both)
      await supabase
        .from("daily_entries")
        .update({
          total_register:
            parseFloat(toEntry.total_register) +
            parseFloat(fromEntry.total_register),
          labor_cost:
            parseFloat(toEntry.labor_cost || 0) +
            parseFloat(fromEntry.labor_cost || 0),
          labor_hours:
            parseFloat(toEntry.labor_hours || 0) +
            parseFloat(fromEntry.labor_hours || 0),
          discounts:
            parseFloat(toEntry.discounts || 0) +
            parseFloat(fromEntry.discounts || 0),
          manager_daily_cost:
            parseFloat(toEntry.manager_daily_cost || 0) +
            parseFloat(fromEntry.manager_daily_cost || 0),
        })
        .eq("id", toEntry.id);

      // 3. Delete remaining breakdowns of "from" entry
      await supabase
        .from("daily_income_breakdown")
        .delete()
        .eq("daily_entry_id", fromEntry.id);

      // 4. Delete other related records
      await supabase.from("daily_payment_breakdown").delete().eq("daily_entry_id", fromEntry.id);
      await supabase.from("daily_parameters").delete().eq("daily_entry_id", fromEntry.id);
      await supabase.from("daily_product_usage").delete().eq("daily_entry_id", fromEntry.id);
      await supabase.from("daily_entry_approvals").delete().eq("daily_entry_id", fromEntry.id);

      // 5. Delete "from" entry
      await supabase.from("daily_entries").delete().eq("id", fromEntry.id);

      console.log("  ✅ Merged and deleted", from);
    }
  }

  // Verify
  console.log("\n=== VERIFICATION ===");
  const { data: entries } = await supabase
    .from("daily_entries")
    .select("entry_date, total_register")
    .eq("business_id", BIZ)
    .is("deleted_at", null)
    .order("entry_date");

  const byMonth = {};
  let grandTotal = 0;
  for (const e of entries) {
    const ym = e.entry_date.substring(0, 7);
    if (!byMonth[ym]) byMonth[ym] = { total: 0, days: 0 };
    byMonth[ym].total += parseFloat(e.total_register);
    byMonth[ym].days++;
    grandTotal += parseFloat(e.total_register);
  }

  // Compare with Bubble totals per month (from CSV, grouped by חודש מספר)
  const csvRows = parseCsv(BASE + "export_All------------modified_2026-03-28_19-07-16.csv");
  const csvByMonth = {};
  for (const r of csvRows) {
    const m = parseInt(r["חודש (מספר)"]);
    const y = parseInt(r["שנה"]);
    if (!m || !y) continue;
    const ym = y + "-" + String(m).padStart(2, "0");
    if (!csvByMonth[ym]) csvByMonth[ym] = { total: 0, days: 0 };
    csvByMonth[ym].total += parseNum(r['סה"כ z יומי']) || 0;
    csvByMonth[ym].days++;
  }

  console.log("Month    | Bubble Total   | DB Total       | Diff");
  console.log("---------|----------------|----------------|------");
  for (const ym of Object.keys(csvByMonth).sort()) {
    const csv = csvByMonth[ym];
    const db = byMonth[ym] || { total: 0, days: 0 };
    const diff = Math.abs(csv.total - db.total);
    const ok = diff < 1 ? "✅" : "❌ " + diff.toFixed(2);
    console.log(
      `${ym}  | ₪${csv.total.toFixed(0).padStart(10)} | ₪${db.total.toFixed(0).padStart(10)} | ${ok}`
    );
  }
  console.log("");
  console.log("Grand total CSV:", csvRows.reduce((s, r) => s + (parseNum(r['סה"כ z יומי']) || 0), 0).toFixed(2));
  console.log("Grand total DB: ", grandTotal.toFixed(2));
  console.log("Total entries:  ", entries.length);
}

fix().catch(console.error);
