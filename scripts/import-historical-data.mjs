/**
 * Import: Historical monthly summaries for נס ציונה
 *   נתוני עבר נס ציונה.csv → monthly_summaries (INSERT 2020-2024, UPDATE 2025+)
 *   פרטים כללים + יעדים → update actual_work_days + labor_cost_amount for 2025-2026
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import Papa from "papaparse";

const SUPABASE_URL = "https://db.amazpenbiz.co.il";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzExNTM2NTMsImV4cCI6MTg5MzQ1NjAwMCwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlzcyI6InN1cGFiYXNlIn0.jO_qu5aNUaOZ0YBdfW5MbzdML-csEU9QkqoTGAx5yzY";
const BUSINESS_ID = "6998ef49-c3db-4c57-96de-2a470ca4c766";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const parseCsv = (path) => {
  const content = readFileSync(path, "utf-8").replace(/^\uFEFF/, "");
  return Papa.parse(content, { header: true, skipEmptyLines: true }).data;
};

const parseNum = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(String(v).replace(/[,\s]/g, ""));
  return isNaN(n) ? null : n;
};

// ── PART 1: Historical data (2020-2024) ───────────────────────────────────────
const histRows = parseCsv("C:/Users/netn1/Downloads/נתוני עבר נס ציונה.csv");
console.log(`Historical rows: ${histRows.length}`);

let inserted = 0, updated = 0, errors = 0;

for (const row of histRows) {
  const year  = parseInt(row["שנה"]);
  const month = parseInt(row["חודש"]);
  if (!year || !month) continue;

  const fields = {
    labor_cost_pct:    parseNum(row["עלות עבודה באחוזים"]),
    labor_cost_amount: parseNum(row['עלות עבודה בש"ח']),
    food_cost_pct:     parseNum(row["עלות מכר באחוזים"]),
    food_cost_amount:  parseNum(row['עלות מכר בש"ח']),
    managed_product_1_pct:  parseNum(row["מוצר מנוהל 1 באחוזים"]),
    managed_product_1_cost: parseNum(row['עלות מוצר מנוהל 1 בש"ח']),
    managed_product_2_pct:  parseNum(row["מוצר מנוהל 2 באחוזים"]),
    managed_product_2_cost: parseNum(row['עלות מוצר מנוהל 2 בש"ח']),
    managed_product_3_pct:  parseNum(row["מוצר מנוהל 3 באחוזים"]),
    managed_product_3_cost: parseNum(row['עלות מוצר מנוהל 3 בש"ח']),
    avg_income_1: parseNum(row['ממוצע הכנסה 1 בש"ח']),
    avg_income_2: parseNum(row['ממוצע הכנסה 2 בש"ח']),
    avg_income_3: parseNum(row['ממוצע הכנסה 3 בש"ח']),
    avg_income_4: parseNum(row['ממוצע הכנסה 4 בש"ח']),
    sales_budget_diff_pct:              parseNum(row["הפרש מתקציב מכירות באחוז"]),
    labor_budget_diff_pct:              parseNum(row["ע. עבודה הפרש מתקציב באחוזים"]),
    food_cost_budget_diff:              parseNum(row["עלות מכר הפרש מתקציב"]),
    managed_product_1_budget_diff_pct:  parseNum(row["הפרש מתקציב מוצר מנוהל 1 באחוזים"]),
    managed_product_2_budget_diff_pct:  parseNum(row["הפרש מתקציב מוצר מנוהל 2 באחוזים"]),
    managed_product_3_budget_diff_pct:  parseNum(row["הפרש מתקציב מוצר מנוהל 3 באחוזים"]),
    managed_product_1_cost_budget_diff_pct: parseNum(row['עלות מוצר מנוהל 1 הפרש מתקציב באחוזים']),
    managed_product_2_cost_budget_diff_pct: parseNum(row['עלות מוצר מנוהל 2 הפרש מתקציב באחוזים']),
    managed_product_3_cost_budget_diff_pct: parseNum(row['עלות מוצר מנוהל 3 הפרש מתקציב באחוזים']),
    avg_income_1_budget_diff: parseNum(row['הפרש מתקציב ממוצע 1 בש"ח']),
    avg_income_2_budget_diff: parseNum(row['הפרש מתקציב ממוצע 2 בש"ח']),
    avg_income_3_budget_diff: parseNum(row['הפרש מתקציב ממוצע 3 בש"ח']),
    avg_income_4_budget_diff: parseNum(row['הפרש מתקציב ממוצע 4 בש"ח']),
    sales_yoy_change_pct:             parseNum(row["שינוי משנה שעברה מכירות באחוזים"]),
    labor_cost_yoy_change_pct:        parseNum(row["עלות עבודה שינוי משנה שעבר באחוזים"]),
    food_cost_yoy_change_pct:         parseNum(row["עלות מכר שינוי משנה שעבר באחוזים"]),
    managed_product_1_yoy_change_pct: parseNum(row["שינוי משנה שעברה מוצר מנוהל 1 באחוזים"]),
    managed_product_2_yoy_change_pct: parseNum(row["שינוי משנה שעברה מוצר מנוהל 2 באחוזים"]),
    managed_product_3_yoy_change_pct: parseNum(row["שינוי משנה שעברה מוצר מנוהל 3 באחוזים"]),
    avg_income_1_yoy_change: parseNum(row['שינוי משנה שעברה ממוצע 1 בש"ח']),
    avg_income_2_yoy_change: parseNum(row['שינוי משנה שעברה ממוצע 2 בש"ח']),
    avg_income_3_yoy_change: parseNum(row['שינוי משנה שעברה ממוצע 3 בש"ח']),
    avg_income_4_yoy_change: parseNum(row['שינוי משנה שעברה ממוצע 4 בש"ח']),
  };

  if (year >= 2025) {
    // Update only non-null fields in existing rows
    const clean = Object.fromEntries(Object.entries(fields).filter(([,v]) => v !== null));
    const { error } = await supabase.from("monthly_summaries")
      .update(clean)
      .eq("business_id", BUSINESS_ID).eq("year", year).eq("month", month);
    if (error) { console.error(`Update ${year}-${month}: ${error.message}`); errors++; }
    else { updated++; console.log(`🔄 updated ${year}-${month}`); }
  } else {
    const { error } = await supabase.from("monthly_summaries").insert({
      business_id: BUSINESS_ID, year, month,
      total_income: parseNum(row["מכירות ברוטו"]),
      ...fields,
    });
    if (error) { console.error(`Insert ${year}-${month}: ${error.message}`); errors++; }
    else { inserted++; console.log(`✅ inserted ${year}-${month}`); }
  }
}

// ── PART 2: actual_work_days for 2025-2026 from פרטים כללים ──────────────────
console.log("\n── actual_work_days update ──");
const details = parseCsv("C:/Users/netn1/Downloads/פרטים כללים עבור כל חודש נס ציונה.csv");
const goalsData = parseCsv("C:/Users/netn1/Downloads/יעדים כללים נס ציונה.csv");

for (let i = 0; i < details.length; i++) {
  const d = details[i];
  const g = goalsData[i] || {};
  const year  = parseInt(g["שנה"]);
  const month = parseInt(g["חודש (מספר)"]);
  if (!year || !month) continue;

  const actual = parseNum(d["ימי עבודה בפועל בחודש"]);
  if (actual === null) continue;

  const { error } = await supabase.from("monthly_summaries")
    .update({ actual_work_days: actual })
    .eq("business_id", BUSINESS_ID).eq("year", year).eq("month", month);
  if (error) console.error(`work_days ${year}-${month}: ${error.message}`);
  else console.log(`🔄 work_days ${year}-${month} = ${actual}`);
}

// ── PART 3: actual labor cost (בפועל עלות עובדים) for 2025-2026 ───────────────
console.log("\n── actual labor cost update ──");
for (const g of goalsData) {
  const year  = parseInt(g["שנה"]);
  const month = parseInt(g["חודש (מספר)"]);
  if (!year || !month) continue;
  const amount = parseNum(g["בפועל עלות עובדים בשקל"]);
  if (amount === null) continue;
  const { error } = await supabase.from("monthly_summaries")
    .update({ labor_cost_amount: amount })
    .eq("business_id", BUSINESS_ID).eq("year", year).eq("month", month);
  if (error) console.error(`labor ${year}-${month}: ${error.message}`);
  else console.log(`🔄 labor_cost_amount ${year}-${month} = ${amount}`);
}

console.log(`\nInserted: ${inserted}, Updated: ${updated}, Errors: ${errors}`);
