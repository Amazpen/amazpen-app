// Universal Bubble → Supabase import script
// Usage: node scripts/import-business.mjs "C:/path/to/csv/folder" "business-uuid"

import { parse } from 'csv-parse/sync';
import fs from 'fs';
import pg from 'pg';

const BASE = process.argv[2];
const BUSINESS_ID = process.argv[3];
const DB_URL = 'postgresql://postgres.amazpen:qjavilccedcd9vd3inkh9wd0uv2xatzu@187.77.79.122:6543/postgres?sslmode=disable';
const SUPABASE_URL = 'https://db.amazpenbiz.co.il';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzExNTM2NTMsImV4cCI6MTg5MzQ1NjAwMCwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlzcyI6InN1cGFiYXNlIn0.jO_qu5aNUaOZ0YBdfW5MbzdML-csEU9QkqoTGAx5yzY';
const BUCKET = 'attachments';

if (!BASE || !BUSINESS_ID) {
  console.error('Usage: node import-business.mjs <csv-folder> <business-id>');
  process.exit(1);
}

const client = new pg.Client({ connectionString: DB_URL, ssl: false });
await client.connect();
console.log(`Connected. Business: ${BUSINESS_ID}`);
console.log(`CSV folder: ${BASE}`);

// Helpers
function p(s) { return parseFloat((s || '0').replace(/,/g, '')) || 0; }
function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}
function loadCSV(name) {
  // Try common naming variations
  const names = [name, name + '.csv'];
  for (const n of names) {
    const path = BASE + '/' + n;
    if (fs.existsSync(path)) {
      return parse(fs.readFileSync(path, 'utf8'), { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true });
    }
  }
  console.log(`  ⚠️ File not found: ${name}`);
  return [];
}
function mapExpenseType(t) {
  return (t && (t.includes('קניות') || t.includes('מוצרים'))) ? 'goods_purchases' : 'current_expenses';
}
function mapStatus(s) {
  if (s === 'שולם') return 'paid';
  if (s === 'זיכוי') return 'credited';
  return 'pending';
}
function mapInvoiceType(t) {
  return (t && (t.includes('קניות') || t.includes('מוצרים'))) ? 'goods' : 'current';
}
function mapMethod(m) {
  if (!m) return 'other';
  if (m.includes('צ')) return 'check';
  if (m.includes('אשראי')) return 'credit_card';
  if (m.includes('העברה')) return 'bank_transfer';
  if (m.includes('מזומן')) return 'cash';
  return 'other';
}

// ============================================
// STEP 1: EXPENSE CATEGORIES
// ============================================
console.log('\n=== Step 1: Categories ===');
const suppRows = loadCSV('ספקים.csv');
const parentCats = new Set();
const childCats = new Map();
for (const r of suppRows) {
  const parent = (r['קטגורית אב'] || '').trim();
  const cat = (r['קטגוריה'] || r['קטגוריה אחר'] || '').trim();
  if (parent) parentCats.add(parent);
  if (cat) childCats.set(cat, parent || null);
}

const catIds = {};
for (const name of parentCats) {
  const res = await client.query(
    `INSERT INTO expense_categories (business_id, name, parent_id) VALUES ($1, $2, NULL) ON CONFLICT DO NOTHING RETURNING id`,
    [BUSINESS_ID, name]
  );
  if (res.rows[0]) catIds[name] = res.rows[0].id;
  else {
    const existing = await client.query(`SELECT id FROM expense_categories WHERE business_id = $1 AND name = $2 AND parent_id IS NULL`, [BUSINESS_ID, name]);
    if (existing.rows[0]) catIds[name] = existing.rows[0].id;
  }
}
for (const [cat, parent] of childCats) {
  if (catIds[cat]) continue; // already a parent
  const parentId = catIds[parent] || null;
  const res = await client.query(
    `INSERT INTO expense_categories (business_id, name, parent_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`,
    [BUSINESS_ID, cat, parentId]
  );
  if (res.rows[0]) catIds[cat] = res.rows[0].id;
  else {
    const existing = await client.query(`SELECT id FROM expense_categories WHERE business_id = $1 AND name = $2`, [BUSINESS_ID, cat]);
    if (existing.rows[0]) catIds[cat] = existing.rows[0].id;
  }
}
console.log(`  Categories: ${Object.keys(catIds).length}`);

// ============================================
// STEP 2: SUPPLIERS
// ============================================
console.log('\n=== Step 2: Suppliers ===');
const supplierMap = {}; // name → id
let suppOk = 0;
for (const r of suppRows) {
  const name = (r['שם הספק'] || '').trim();
  if (!name) continue;
  const type = mapExpenseType((r['סוג הוצאה'] || '').trim());
  const cat = (r['קטגוריה'] || r['קטגוריה אחר'] || '').trim();
  const parent = (r['קטגורית אב'] || '').trim();
  const isFixed = (r['הוצאה חודשית קבועה'] || '').trim() === 'כן';
  const terms = parseInt(r['תנאי תשלום']) || 0;
  const vat = (r["נדרש מע''מ"] || '').includes('כן');

  try {
    const res = await client.query(
      `INSERT INTO suppliers (business_id, name, expense_type, expense_category_id, parent_category_id, payment_terms_days, requires_vat, is_fixed_expense, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       ON CONFLICT DO NOTHING RETURNING id`,
      [BUSINESS_ID, name, type, catIds[cat] || null, catIds[parent] || null, terms, vat, isFixed]
    );
    if (res.rows[0]) {
      supplierMap[name] = res.rows[0].id;
      suppOk++;
    } else {
      const existing = await client.query(`SELECT id FROM suppliers WHERE business_id = $1 AND name = $2`, [BUSINESS_ID, name]);
      if (existing.rows[0]) supplierMap[name] = existing.rows[0].id;
    }
  } catch (e) {
    // supplier might already exist
    const existing = await client.query(`SELECT id FROM suppliers WHERE business_id = $1 AND name = $2`, [BUSINESS_ID, name]);
    if (existing.rows[0]) supplierMap[name] = existing.rows[0].id;
  }
}
console.log(`  Suppliers: ${suppOk} new, ${Object.keys(supplierMap).length} total`);

// ============================================
// STEP 3: INVOICES
// ============================================
console.log('\n=== Step 3: Invoices ===');
const invRows = loadCSV('קניות.csv').length > 0 ? loadCSV('קניות.csv') : loadCSV('חשבוניות.csv');
let invOk = 0, invErr = 0;
const invoiceLookup = {}; // bubble_id → { supplier, amount, date }

for (const r of invRows) {
  const supplier = (r['ספק'] || r['Supplier name'] || '').trim();
  const supplierId = supplierMap[supplier];
  if (!supplierId) { invErr++; continue; }

  const amount = p(r["סכום אחרי מע''מ"]);
  const subtotal = p(r['סכום לפני מע"מ']);
  const vat = p(r['סכום מע"מ']);
  const status = mapStatus((r['טרם/שולם/שולם/זיכוי'] || '').trim());
  const invType = mapInvoiceType((r['סוג הוצאה'] || '').trim());
  const invNum = (r['מספר תעודה (מספר חשבונית)'] || '').trim() || null;
  const invDate = parseDate(r['תאריך חשבונית']);
  const dueDate = parseDate(r['תאריך לתשלום']);
  const notes = (r['הערות למסמך רגיל'] || '').trim() || null;
  const monthNum = (r['חודש (מספר)'] || '').trim();
  const year = (r['שנה'] || '').trim();
  const bubbleId = (r['unique id'] || '').trim();
  const imageUrl = (r['תמונת חשבונית 1'] || '').trim() || null;

  let refDate = null;
  if (monthNum && year) refDate = `${year}-${monthNum.padStart(2, '0')}-01`;

  // Fix image URL
  let attachUrl = imageUrl;
  if (attachUrl && attachUrl.startsWith('//')) attachUrl = 'https:' + attachUrl;

  try {
    await client.query(
      `INSERT INTO invoices (business_id, supplier_id, invoice_number, invoice_date, due_date, subtotal, vat_amount, total_amount, status, amount_paid, invoice_type, notes, data_source, reference_date, attachment_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual',$13,$14)`,
      [BUSINESS_ID, supplierId, invNum, invDate, dueDate, subtotal, vat, amount, status, status === 'paid' ? amount : 0, invType, notes, refDate, attachUrl]
    );
    invOk++;
    if (bubbleId) invoiceLookup[bubbleId] = { supplier, amount, date: invDate };
  } catch (e) {
    invErr++;
    if (invErr <= 3) console.error(`  Error: ${e.message.substring(0, 80)}`);
  }
}
console.log(`  Invoices: ${invOk} ok, ${invErr} errors`);

// ============================================
// STEP 4: PAYMENTS
// ============================================
console.log('\n=== Step 4: Payments ===');
const payRows = loadCSV('תשלומים.csv');
const midRows = loadCSV('אמצעי תשלום.csv');
const splitRows = loadCSV('תשלום משנה.csv').length > 0 ? loadCSV('תשלום משנה.csv') : loadCSV('תשלומי משנה.csv');

// Build lookups
const midLookup = {};
for (const m of midRows) { const bid = (m['unique id'] || '').trim(); if (bid) midLookup[bid] = m; }
const splitLookup = {};
for (const s of splitRows) { const bid = (s['unique id'] || '').trim(); if (bid) splitLookup[bid] = s; }
const subSplitsByMid = {};
for (const m of midRows) {
  const bid = (m['unique id'] || '').trim();
  const refs = (m['רשימת תשלומי משנה'] || '').trim();
  if (bid && refs) subSplitsByMid[bid] = refs.split(',').map(s => s.trim()).filter(Boolean);
}

let payOk = 0, payErr = 0, splitCount = 0;
for (const pay of payRows) {
  const supplier = (pay['ספק'] || pay['Supplier name'] || '').trim();
  const supplierId = supplierMap[supplier];
  if (!supplierId) { payErr++; continue; }

  const amount = p(pay["סכום אחרי מע''מ"]);
  const notes = (pay['הערות'] || '').trim() || null;
  const isComplex = !!(pay['אמצעי תשלום'] || '').trim();
  const invoicesRef = (pay['חשבוניות'] || '').trim();

  let paymentDate = parseDate(pay['תאריך קבלה']) || parseDate(pay['תאריך התשלום']);
  if (!paymentDate) {
    const m = (pay['חודש תאריך תשלום'] || pay['חודש (מספר)'] || '').trim();
    const y = (pay['שנה תאריך תשלום'] || pay['שנה'] || '').trim();
    const d = (pay['יום תאריך תשלום'] || pay['יום'] || '').trim();
    if (m && y) paymentDate = `${y}-${m.padStart(2, '0')}-${(d || '1').padStart(2, '0')}`;
  }

  // Invoice link
  let invoiceId = null;
  if (invoicesRef) {
    for (const refId of invoicesRef.split(',').map(s => s.trim()).filter(Boolean)) {
      const inv = invoiceLookup[refId];
      if (inv) {
        const res = await client.query(
          `SELECT i.id FROM invoices i JOIN suppliers s ON s.id = i.supplier_id
           WHERE s.name = $1 AND i.business_id = $2 AND i.deleted_at IS NULL
           AND abs(i.total_amount - $3) < 0.01 ${inv.date ? "AND i.invoice_date::date = $4::date" : ''} LIMIT 1`,
          inv.date ? [inv.supplier, BUSINESS_ID, inv.amount, inv.date] : [inv.supplier, BUSINESS_ID, inv.amount]
        );
        if (res.rows[0]) { invoiceId = res.rows[0].id; break; }
      }
    }
  }

  try {
    const payRes = await client.query(
      `INSERT INTO payments (business_id, supplier_id, payment_date, total_amount, invoice_id, notes, data_source)
       VALUES ($1,$2,$3,$4,$5,$6,'manual') RETURNING id`,
      [BUSINESS_ID, supplierId, paymentDate, amount, invoiceId, notes]
    );
    const paymentId = payRes.rows[0].id;

    // Build splits
    const splits = [];
    if (isComplex) {
      for (const mRef of (pay['אמצעי תשלום'] || '').split(',').map(s => s.trim()).filter(Boolean)) {
        const mid = midLookup[mRef];
        if (!mid) continue;
        const subRefs = subSplitsByMid[mRef] || [];
        if (subRefs.length > 0) {
          for (const sRef of subRefs) {
            const sp = splitLookup[sRef];
            if (sp) splits.push({ amount: p(sp['סכום תשלום אחרי מע"מ']), method: mapMethod(sp['סוג אמצעי תשלום'] || mid['סוג אמצעי תשלום']), checkNum: (sp["מספר צ'ק"] || '').trim() || null, ref: (sp['מספר אסמכתא'] || '').trim() || null, date: parseDate(sp['תאריך תשלום']), num: parseInt(sp['מספר תשלום']) || null });
          }
        } else {
          splits.push({ amount: p(mid['סכום אחרי מעמ']), method: mapMethod(mid['סוג אמצעי תשלום']), checkNum: (mid["מספר צ'ק"] || '').trim() || null, ref: (mid['מספר אסמכתא'] || '').trim() || null, date: parseDate(mid['תאריך תשלום']), num: parseInt(mid['מספר תשלום']) || null });
        }
      }
    }
    if (splits.length === 0) {
      splits.push({ amount, method: mapMethod(pay['סוג אמצעי תשלום']), checkNum: (pay["מס' צ'ק"] || '').trim() || null, ref: (pay['אסמכתא'] || '').trim() || null, date: paymentDate, num: parseInt(pay['מספר תשלום']) || null });
    }

    for (const sp of splits) {
      await client.query(
        `INSERT INTO payment_splits (payment_id, payment_method, amount, check_number, reference_number, due_date, installment_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [paymentId, sp.method, sp.amount, sp.checkNum, sp.ref, sp.date, sp.num]
      );
      splitCount++;
    }
    payOk++;
  } catch (e) {
    payErr++;
    if (payErr <= 3) console.error(`  Error: ${e.message.substring(0, 80)}`);
  }
}
console.log(`  Payments: ${payOk} ok, ${payErr} errors, ${splitCount} splits`);

// ============================================
// STEP 5: DAILY ENTRIES
// ============================================
console.log('\n=== Step 5: Daily entries ===');
const dailyRows = loadCSV('מילוי יומי.csv');
const dailyByDate = {};
for (const r of dailyRows) {
  const month = (r['חודש (מספר)'] || '').trim();
  const year = (r['שנה'] || '').trim();
  const day = (parseInt(r['יום (מספר)'] || r['מספר יום בחודש (תאריך)']) || 1).toString();
  if (!month || !year) continue;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (!dailyByDate[date]) dailyByDate[date] = { revenue: 0, laborCost: 0, laborHours: 0, managerCost: 0, discounts: 0, zDaily: 0, factor: 0 };
  const e = dailyByDate[date];
  e.revenue += p(r['הכנסות']);
  e.laborCost += p(r['ע.עובדים יומית ללא העמסה']);
  e.laborHours += p(r['כמות שעות עובדים']);
  e.managerCost = p(r['שכר מנהל יומי כולל העמסה']);
  e.discounts += p(r['זיכוי+ביטול+הנחות ב ₪']);
  e.zDaily += p(r['סה"כ z יומי']);
  e.factor++;
}

let dailyOk = 0;
for (const [date, e] of Object.entries(dailyByDate)) {
  try {
    await client.query(
      `INSERT INTO daily_entries (business_id, entry_date, total_register, labor_cost, labor_hours, manager_daily_cost, discounts, day_factor, data_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual')`,
      [BUSINESS_ID, date, e.zDaily || e.revenue, e.laborCost, e.laborHours, e.managerCost, e.discounts, e.factor]
    );
    dailyOk++;
  } catch (e2) {}
}
console.log(`  Daily: ${dailyOk} (from ${dailyRows.length} rows)`);

// Daily income breakdowns
const { rows: incomeSources } = await client.query(
  'SELECT id, name, display_order FROM income_sources WHERE business_id = $1 ORDER BY display_order', [BUSINESS_ID]
);
if (incomeSources.length > 0) {
  const { rows: dateEntries } = await client.query(
    "SELECT id, to_char(entry_date, 'YYYY-MM-DD') as date_str FROM daily_entries WHERE business_id = $1", [BUSINESS_ID]
  );
  const entryByDate = {};
  for (const e of dateEntries) entryByDate[e.date_str] = e.id;

  const acc = {};
  for (const r of dailyRows) {
    const month = (r['חודש (מספר)'] || '').trim();
    const year = (r['שנה'] || '').trim();
    const day = (parseInt(r['יום (מספר)'] || r['מספר יום בחודש (תאריך)']) || 1).toString();
    if (!month || !year) continue;
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    if (!acc[date]) acc[date] = {};
    for (let i = 0; i < incomeSources.length; i++) {
      const amount = p(r[`סה"כ הכנסות ${i + 1}`]);
      const orders = p(r[`כמות הזמנות ${i + 1}`]);
      if (!acc[date][i]) acc[date][i] = { amount: 0, orders: 0 };
      acc[date][i].amount += amount;
      acc[date][i].orders += orders;
    }
  }

  let brkOk = 0;
  for (const [date, sourceData] of Object.entries(acc)) {
    const entryId = entryByDate[date];
    if (!entryId) continue;
    for (const [idx, data] of Object.entries(sourceData)) {
      if (!data.amount && !data.orders) continue;
      const source = incomeSources[parseInt(idx)];
      if (!source) continue;
      try {
        await client.query('INSERT INTO daily_income_breakdown (daily_entry_id, income_source_id, amount, orders_count) VALUES ($1,$2,$3,$4)',
          [entryId, source.id, data.amount, data.orders]);
        brkOk++;
      } catch (e) {}
    }
  }
  console.log(`  Breakdowns: ${brkOk}`);
}

// ============================================
// STEP 6: GOALS
// ============================================
console.log('\n=== Step 6: Goals ===');
const goalRows = loadCSV('יעדים.csv');
const budgetRows = loadCSV('תקציבים.csv');
let goalsOk = 0;
for (const r of goalRows) {
  const month = parseInt(r['חודש (מספר)']) || null;
  const year = parseInt(r['שנה']) || null;
  if (!month || !year) continue;
  const vat = p(r['העמסה']);
  const b = budgetRows.find(b => parseInt(b['חודש (מספר)']) === month && parseInt(b['שנה']) === year);
  const revenueTarget = b ? p(b['תקציב מכירות ברוטו']) : 0;
  try {
    const foodPct = b ? p(b['תקציב עלות מכר (באחוזים)']) : null;
    const laborPct = b ? p(b['תקציב עלות עובדים (באחוזים)']) : null;
    const currentTarget = b ? p(b['תקציב הוצאות שוטפות (בשקל)']) : null;
    await client.query(
      `INSERT INTO goals (business_id, month, year, revenue_target, vat_percentage, food_cost_target_pct, labor_cost_target_pct, current_expenses_target) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [BUSINESS_ID, month, year, revenueTarget, vat > 1 ? vat - 1 : vat, foodPct || null, laborPct || null, currentTarget || null]
    );
    goalsOk++;
  } catch (e) {}
}
console.log(`  Goals: ${goalsOk}`);

// ============================================
// STEP 7: SUPPLIER BUDGETS
// ============================================
console.log('\n=== Step 7: Supplier budgets ===');
const sbRows = loadCSV('תקציבי ספק.csv').length > 0 ? loadCSV('תקציבי ספק.csv') : loadCSV('תקציבי ספקים.csv');
let sbOk = 0;
for (const r of sbRows) {
  const name = (r['ספק'] || '').trim();
  const sid = supplierMap[name];
  if (!sid) continue;
  const month = parseInt(r['חודש (במספר)']) || null;
  const year = parseInt(r['שנה']) || null;
  const amount = p(r['סכום תקציב חודשי']);
  if (!month || !year || !amount) continue;
  try {
    await client.query(`INSERT INTO supplier_budgets (business_id, supplier_id, month, year, budget_amount) VALUES ($1,$2,$3,$4,$5)`, [BUSINESS_ID, sid, month, year, amount]);
    sbOk++;
  } catch (e) {}
}
console.log(`  Supplier budgets: ${sbOk}`);

// ============================================
// STEP 8: PRIOR COMMITMENTS
// ============================================
console.log('\n=== Step 8: Prior commitments ===');
const commitRows = loadCSV('התחייבויות קודמות.csv');
const commitGroups = {};
for (const r of commitRows) {
  const name = (r['שם התחייבות'] || '').trim();
  if (!name) continue;
  if (!commitGroups[name]) commitGroups[name] = [];
  commitGroups[name].push({ amount: p(r['סכום']), num: parseInt(r['מספר תשלום']) || 0, month: (r['חודש'] || '').trim(), year: (r['שנה'] || '').trim(), day: (r['יום'] || '').trim() });
}
let commitOk = 0;
for (const [name, payments] of Object.entries(commitGroups)) {
  payments.sort((a, b) => a.num - b.num);
  const first = payments[0], last = payments[payments.length - 1];
  const startDate = first?.year && first?.month ? `${first.year}-${first.month.padStart(2, '0')}-${(first.day || '1').padStart(2, '0')}` : null;
  const endDate = last?.year && last?.month ? `${last.year}-${last.month.padStart(2, '0')}-${(last.day || '28').padStart(2, '0')}` : null;
  try {
    await client.query(`INSERT INTO prior_commitments (business_id, name, monthly_amount, total_installments, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6)`,
      [BUSINESS_ID, name, first?.amount || 0, Math.max(...payments.map(p => p.num), payments.length), startDate, endDate]);
    commitOk++;
  } catch (e) {}
}
console.log(`  Commitments: ${commitOk}`);

// ============================================
// STEP 9: MONTHLY SUMMARIES (נתוני עבר)
// ============================================
console.log('\n=== Step 9: Historical summaries ===');
const histRows = loadCSV('נתוני עבר.csv');
let histOk = 0;
for (const r of histRows) {
  const month = parseInt(r['חודש']) || null;
  const year = parseInt(r['שנה']) || null;
  if (!month || !year) continue;
  try {
    await client.query(`INSERT INTO monthly_summaries (business_id, year, month, total_income, food_cost_pct, food_cost_amount, food_cost_budget_diff, labor_cost_pct, labor_cost_amount, labor_budget_diff_pct, avg_income_1, avg_income_2, avg_income_3, avg_income_4, sales_budget_diff_pct, sales_yoy_change_pct) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [BUSINESS_ID, year, month, p(r['מכירות ברוטו']), p(r['עלות מכר באחוזים']), p(r['עלות מכר בש"ח']), p(r['עלות מכר הפרש מתקציב']), p(r['עלות עבודה באחוזים']), p(r['עלות עבודה בש"ח']), p(r['ע. עבודה הפרש מתקציב באחוזים']), p(r['ממוצע הכנסה 1 בש"ח']), p(r['ממוצע הכנסה 2 בש"ח']), p(r['ממוצע הכנסה 3 בש"ח']), p(r['ממוצע הכנסה 4 בש"ח']), p(r['הפרש מתקציב מכירות באחוז']), p(r['שינוי משנה שעברה מכירות באחוזים'])]);
    histOk++;
  } catch (e) {}
}
console.log(`  History: ${histOk}`);

// ============================================
// STEP 10: IMAGES (Bubble CDN only)
// ============================================
console.log('\n=== Step 10: Images ===');
let imgOk = 0, imgSkip = 0;
for (const r of invRows) {
  const url = (r['תמונת חשבונית 1'] || '').trim();
  if (!url || url.includes('drive.google.com')) continue;
  let fixed = url.startsWith('//') ? 'https:' + url : url;

  const supplier = (r['ספק'] || '').trim();
  const amount = p(r["סכום אחרי מע''מ"]);
  const date = parseDate(r['תאריך חשבונית']);
  const bubbleId = (r['unique id'] || '').trim();

  try {
    const resp = await fetch(fixed, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) { imgSkip++; continue; }
    const buffer = Buffer.from(await resp.arrayBuffer());
    const ext = resp.headers.get('content-type')?.includes('pdf') ? 'pdf' : 'jpg';
    const filePath = `invoices/${BUSINESS_ID}/${bubbleId}.${ext}`;

    const upResp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filePath}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': resp.headers.get('content-type') || 'image/jpeg', 'x-upsert': 'true' },
      body: buffer
    });
    if (upResp.ok) {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filePath}`;
      await client.query(
        `UPDATE invoices SET attachment_url = $1 WHERE id = (SELECT i.id FROM invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE s.name = $2 AND i.business_id = $3 AND i.deleted_at IS NULL AND abs(i.total_amount - $4) < 0.01 ${date ? "AND i.invoice_date::date = $5::date" : ''} AND (i.attachment_url IS NULL OR i.attachment_url LIKE '%bubble%' OR i.attachment_url LIKE '//%') LIMIT 1)`,
        date ? [publicUrl, supplier, BUSINESS_ID, amount, date] : [publicUrl, supplier, BUSINESS_ID, amount]
      );
      imgOk++;
    }
  } catch (e) { imgSkip++; }
  if ((imgOk + imgSkip) % 50 === 0 && (imgOk + imgSkip) > 0) console.log(`  Progress: ${imgOk} ok, ${imgSkip} skip`);
}
console.log(`  Images: ${imgOk} uploaded, ${imgSkip} skipped`);

// ============================================
// FINAL SUMMARY
// ============================================
console.log('\n=== FINAL SUMMARY ===');
const counts = await client.query(`
  SELECT 'suppliers' as t, count(*) FROM suppliers WHERE business_id = $1
  UNION ALL SELECT 'invoices', count(*) FROM invoices WHERE business_id = $1 AND deleted_at IS NULL
  UNION ALL SELECT 'payments', count(*) FROM payments WHERE business_id = $1 AND deleted_at IS NULL
  UNION ALL SELECT 'payment_splits', count(*) FROM payment_splits WHERE payment_id IN (SELECT id FROM payments WHERE business_id = $1)
  UNION ALL SELECT 'daily_entries', count(*) FROM daily_entries WHERE business_id = $1
  UNION ALL SELECT 'goals', count(*) FROM goals WHERE business_id = $1
  UNION ALL SELECT 'supplier_budgets', count(*) FROM supplier_budgets WHERE business_id = $1
  UNION ALL SELECT 'prior_commitments', count(*) FROM prior_commitments WHERE business_id = $1
  UNION ALL SELECT 'monthly_summaries', count(*) FROM monthly_summaries WHERE business_id = $1
`, [BUSINESS_ID]);
for (const r of counts.rows) console.log(`  ${r.t}: ${r.count}`);

await client.end();
console.log('\n✅ Import complete!');
