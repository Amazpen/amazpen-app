/**
 * Import: Goals + Business Monthly Settings for נס ציונה
 *   יעדים כללים נס ציונה.csv  → goals
 *   פרטים כללים עבור כל חודש נס ציונה.csv → business_monthly_settings + goals.expected_work_days/vat
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

const goals   = parseCsv("C:/Users/netn1/Downloads/יעדים כללים נס ציונה.csv");
const details = parseCsv("C:/Users/netn1/Downloads/פרטים כללים עבור כל חודש נס ציונה.csv");

console.log(`Goals: ${goals.length} rows, Details: ${details.length} rows`);

let goalsOk = 0, settingsOk = 0, errors = 0;

for (let i = 0; i < goals.length; i++) {
  const g = goals[i];
  const d = details[i] || {};

  const year  = parseInt(g["שנה"]);
  const month = parseInt(g["חודש (מספר)"]);
  if (!year || !month) { console.warn(`Row ${i+1}: missing year/month`); errors++; continue; }

  const monthYear = `${year}-${String(month).padStart(2, "0")}`;

  // goals
  const { error: gErr } = await supabase.from("goals").insert({
    business_id:             BUSINESS_ID,
    year, month,
    revenue_target:          parseNum(g["תקציב מכירות ברוטו"]),
    labor_cost_target_pct:   parseNum(g["תקציב עלות עובדים (באחוזים)"]),
    food_cost_target_pct:    parseNum(g["תקציב עלות מכר (באחוזים)"]),
    current_expenses_target: parseNum(g["תקציב הוצאות שוטפות (בשקל)"]),
    goods_expenses_target:   parseNum(g["תקציב עלוב מכר (בשקל)"]) ?? 0,
    markup_percentage:       parseNum(g["מחיר מוצר מנוהל (%)"]),
    expected_work_days:      parseNum(d["ימי עבודה בחודש"]),
    vat_percentage:          parseNum(d['מע"מ']),
  });
  if (gErr) { console.error(`Goal ${monthYear}: ${gErr.message}`); errors++; }
  else { goalsOk++; console.log(`✅ goal ${monthYear}`); }

  // business_monthly_settings
  const { error: sErr } = await supabase.from("business_monthly_settings").insert({
    business_id:       BUSINESS_ID,
    month_year:        monthYear,
    markup_percentage: parseNum(d["העמסה"]),
    vat_percentage:    parseNum(d['מע"מ']),
  });
  if (sErr) { console.error(`Settings ${monthYear}: ${sErr.message}`); errors++; }
  else settingsOk++;
}

console.log(`\nGoals: ${goalsOk}, Settings: ${settingsOk}, Errors: ${errors}`);
