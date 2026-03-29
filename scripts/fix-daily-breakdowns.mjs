// Fix daily_income_breakdown for all businesses
// Each row in מילוי יומי.csv creates breakdowns per income source
// Multiple rows per date = different locations, each adds to the SAME daily_entry

import { parse } from 'csv-parse/sync';
import fs from 'fs';
import pg from 'pg';

const DB_URL = 'postgresql://postgres.amazpen:qjavilccedcd9vd3inkh9wd0uv2xatzu@187.77.79.122:6543/postgres?sslmode=disable';
const client = new pg.Client({ connectionString: DB_URL, ssl: false });
await client.connect();

const businessId = process.argv[2];
const csvPath = process.argv[3];

if (!businessId || !csvPath) {
  console.error('Usage: node fix-daily-breakdowns.mjs <business-id> <csv-path>');
  process.exit(1);
}

function p(s) { return parseFloat((s || '0').replace(/,/g, '')) || 0; }

// Get income sources for this business
const { rows: sources } = await client.query(
  'SELECT id, name, display_order FROM income_sources WHERE business_id = $1 ORDER BY display_order',
  [businessId]
);
console.log(`Income sources: ${sources.length}`);
sources.forEach(s => console.log(`  ${s.display_order}: ${s.name}`));

if (sources.length === 0) {
  console.log('No income sources found. Exiting.');
  process.exit(0);
}

// Delete existing breakdowns
const { rowCount: deleted } = await client.query(
  'DELETE FROM daily_income_breakdown WHERE daily_entry_id IN (SELECT id FROM daily_entries WHERE business_id = $1)',
  [businessId]
);
console.log(`Deleted ${deleted} existing breakdowns`);

// Load CSV
const rows = parse(fs.readFileSync(csvPath, 'utf8'), { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true });
console.log(`CSV rows: ${rows.length}`);

// Get all daily entries for this business
const { rows: entries } = await client.query(
  'SELECT id, entry_date FROM daily_entries WHERE business_id = $1',
  [businessId]
);
// Use SQL to get dates as local date strings (avoiding timezone issues)
const { rows: dateEntries } = await client.query(
  "SELECT id, to_char(entry_date, 'YYYY-MM-DD') as date_str FROM daily_entries WHERE business_id = $1",
  [businessId]
);
const entryByDate = {};
for (const e of dateEntries) {
  entryByDate[e.date_str] = e.id;
}
console.log(`Daily entries in DB: ${entries.length}`);

// For each CSV row, add to the breakdown
// Each row has: סה"כ הכנסות 1/2/3/4 and כמות הזמנות 1/2/3/4
// These correspond to income_sources by display_order (0-based)
let inserted = 0;
const accumulator = {}; // date → source_index → { amount, orders }

for (const r of rows) {
  const month = (r['חודש (מספר)'] || '').trim();
  const year = (r['שנה'] || '').trim();
  const day = (parseInt(r['יום (מספר)'] || r['מספר יום בחודש (תאריך)']) || 1).toString();
  if (!month || !year) continue;

  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (!accumulator[date]) accumulator[date] = {};

  for (let i = 0; i < sources.length; i++) {
    const amount = p(r[`סה"כ הכנסות ${i + 1}`]);
    const orders = p(r[`כמות הזמנות ${i + 1}`]);

    if (!accumulator[date][i]) accumulator[date][i] = { amount: 0, orders: 0 };
    accumulator[date][i].amount += amount;
    accumulator[date][i].orders += orders;
  }
}

// Insert accumulated breakdowns
for (const [date, sourceData] of Object.entries(accumulator)) {
  const entryId = entryByDate[date];
  if (!entryId) continue;

  for (const [idx, data] of Object.entries(sourceData)) {
    if (!data.amount && !data.orders) continue;
    const source = sources[parseInt(idx)];
    if (!source) continue;

    try {
      await client.query(
        'INSERT INTO daily_income_breakdown (daily_entry_id, income_source_id, amount, orders_count) VALUES ($1, $2, $3, $4)',
        [entryId, source.id, data.amount, data.orders]
      );
      inserted++;
    } catch (e) {
      // Might be duplicate, skip
    }
  }
}

console.log(`\n✅ Inserted ${inserted} breakdowns`);

// Verify March 2026
const { rows: marchCheck } = await client.query(`
  SELECT is2.name, sum(dib.amount)::numeric(12,0) as total, sum(dib.orders_count)::int as orders
  FROM daily_income_breakdown dib
  JOIN daily_entries de ON de.id = dib.daily_entry_id
  JOIN income_sources is2 ON is2.id = dib.income_source_id
  WHERE de.business_id = $1 AND de.entry_date >= '2026-03-01' AND de.entry_date <= '2026-03-31'
  GROUP BY is2.name, is2.display_order
  ORDER BY is2.display_order
`, [businessId]);
console.log('\nMarch 2026 verification:');
marchCheck.forEach(r => console.log(`  ${r.name}: ₪${r.total} | ${r.orders} orders`));

await client.end();
