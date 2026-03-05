import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = "https://db.amazpenbiz.co.il";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzExNTM2NTMsImV4cCI6MTg5MzQ1NjAwMCwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlzcyI6InN1cGFiYXNlIn0.jO_qu5aNUaOZ0YBdfW5MbzdML-csEU9QkqoTGAx5yzY";
const BUSINESS_ID = "6998ef49-c3db-4c57-96de-2a470ca4c766";
const MAIN_CSV = "C:/Users/netn1/Downloads/תשלומים נס ציונה.csv";
const SUBS_CSV = "C:/Users/netn1/Downloads/תשלומי משנה נס ציונה.csv";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SUPPLIERS = {
  "אגרת שילוט": "de53092b-5157-400b-bb82-4a5b9ea20441",
  "אחר": "565fb6bf-5e04-4d1c-9f58-ad0b81ad4b65",
  "איזי": "79b65d28-c44e-41ce-8ed0-4892977abe10",
  "אמייזינג": "7b4d7182-c0b6-4b07-8d65-8407e56eab64",
  "ארנונה": "dfe7e2a5-2c84-4125-b951-4eb87d21784e",
  "בזק": "d72ce302-aea5-4b09-9ed6-be9dba9a6302",
  "ביטוחים - קבועות לפי X רכבים": "0f6f07e6-5a26-4970-8046-8a8f309df5fc",
  "ביטוח עסק": "6af065f6-47a1-46dd-b68d-d9cf07407832",
  'ביטוח קטנועים חובה + ג': "a20cb74c-e0db-4de5-a3cb-4b6b927da703",
  "ביטוח רכב חובה +מקיף (פרטי)": "8571b01b-0229-4996-87c4-273941ea56db",
  "ביצים": "4494d793-ebcd-48b8-b70b-0ba51d24503a",
  'בן&גריס': "f00a1daf-da60-425a-a0b9-83d6865df0d3",
  "גבינות מושבה": "542d142b-898b-4846-90a0-a465863fa71b",
  "גד": "a7e8299c-0c15-4a53-b442-d59f40ced7bd",
  "גודי": "a5fed925-274f-4dff-89b8-8974e495633e",
  "גז": "e53c22f1-0744-42d7-aa26-eacb490ac55a",
  "דיב אנד אר(משלוחה)": "914ab5d0-de3d-4f16-8663-88f4750f85f4",
  "דלק רכבים": "12d78fc9-d551-4f5c-9d94-3ffa24a86498",
  "דלק רכב פרטי": "36b66b65-27b7-4b70-ac59-af783eacc918",
  "דמי זיכיון": "f0a568c6-0496-4758-9393-67da3898f3d8",
  "הדברה": "89ea6679-e7f7-483c-b218-779751f9ae42",
  "הוט מובייל": "171cab09-bebd-46cf-9ca0-2b224bc69795",
  "החזר הלוואה": "b8c85fbc-553e-4879-a625-3af428da74b1",
  "המפיץ": "94623100-e515-4148-8200-9c2ced8af4c3",
  "המפיץ ללא מעמ": "7469e44c-ae5c-4841-8f83-76e39af426ed",
  "הנהלת חשבונות": "829d1963-aa5d-48b4-8c68-177061560e2c",
  "הקפה ניקי": "1c01d26a-3351-4bdc-9749-53de128d4af0",
  "וולט - לב המושבה": "ac8e74b7-babf-4141-9db6-9b6f1847704d",
  "וולט- פרגו": "6f70327b-fc36-4dde-9399-96f956265126",
  "זאפ גרופ": "a16c3a75-0c54-4b1b-87a2-68948bba5fa0",
  "זעפרני": "d510110e-6413-4c7b-a69f-08438d36c92e",
  "חברת משלוחים": "0f122c4c-7c68-46cd-9213-ac9309bc6216",
  "חד פעמי": "8120cabc-26a6-4040-9970-13944b8e106a",
  "חומרי ניקוי": "c88cea7b-07d2-4230-840a-42fc9565ebd0",
  'חצי חצי שיווק פירות וירקות בע"מ': "9d55e968-056d-4966-80f8-f677cc98249c",
  "חשמל": "5c1a4eda-a183-484e-bdb1-3ab4e8c26e79",
  "טיקטוק": "bd0a1f79-1c72-4a59-93dd-951d0a8e2077",
  "טיקטוק ממומן- עצמאי": "92529987-b387-4169-bce1-c8f84fd99220",
  "טיקטוק- פרגו-לא פעיל": "a6fa594f-1218-4c2f-b1f6-0aac5c1472d9",
  "יואב שיווק  לב המושבה": "8ce64527-337d-44e9-a50c-9ad37adb6b93",
  "ייעוץ DBC": "4af7b53b-cb44-4692-ab85-7b0304479af9",
  "ירקות": "bb27b2dd-f585-44d1-9446-9534266a5bc7",
  "כיבוד": "579b67ba-28e6-4e91-b841-fc6ae16e5bd0",
  "מאפייה": "8e08c299-5c69-4a22-a398-0042abf16f89",
  "מחשבים- קופות אביב": "d0c9abcf-73cf-464f-bd01-ea2bba50bed5",
  "מים": "976d1f7f-9c91-4e52-a90e-f4e7ce5b41be",
  "מכבי תא-לא פעיל": "d304268d-6f93-4d23-b65d-f336223becfb",
  "מכבי תא- פרגו-לא פעיל": "1758642f-9b76-4b6e-9e01-5023f01c7de0",
  "ממומן גוגל- עצמאי": "675e6a76-0319-4170-be8c-b83f175dc278",
  "ממומן פייסבוק- עצמאי": "40d546c1-46aa-4834-9274-967e9c2753b3",
  "מפיץ שרם רמי גלידות": "553c52b6-5401-4247-a995-e691ac74d99e",
  "משפטיות": "a517858f-38bf-422c-b64c-abf5f5832c31",
  "משרדיות": "7baa9d9d-cd1f-41c0-9c7f-ea248aa97bef",
  "נ.נ אריה-ספק": "df2599c0-88e0-4b25-98a1-460cbbb4c7d4",
  "נ.נ. אריה- פרסום-לא פעיל": "94dc81bd-2d2a-4d0e-bf9b-92d951f597d3",
  "נ.נ אריה- פרסום+קופה אוטוספוט": "4dac2762-4933-434c-804b-87e16ef83045",
  "סודקסו": "de167f38-e134-40c5-b794-c20974a51401",
  "סופרמרקט": "8e0d8b1e-9c7c-4295-8720-4cf4bd9344c6",
  "סייבר סיטי- יואב בלום": "e1a837bc-fde0-48fa-9fd0-54c529a8cd2b",
  "עמלה אשראי": "19e5fb4a-76c6-4602-a27f-755db1ebcfbf",
  "עמלה אשראי1": "deae8210-c888-470c-9409-047dd815b45e",
  "פלאיירים": "49c254e6-27db-4e85-88d9-39fcfad71ce4",
  "פלאיירים- עצמאי": "0cf0b767-f92a-4ae4-bcf8-a70212c10229",
  "פלאקארד": "534ab723-08b9-471c-9ef6-a99e5cb5d349",
  "פנגו- חנייה": "99607375-32e8-4753-9ce9-6875e6ec0285",
  "פנסיה בעלים": "11d00a60-6e9f-480a-9f30-79e0e7a6e734",
  "פנסיה + קרן השתלמות": "80dc3356-5dfd-436e-b46c-2f4436c4e581",
  "פרסום בגוגל": "037b9699-d7db-4611-ad6e-cbde46bdb9ad",
  "פרסום חד פעמי": "79010a6b-df69-421f-9648-25b500aaff54",
  "פרסום מזדמן": "8e0d4a86-6e70-4482-992b-11e3900feb90",
  "פרסום רשת פרגו- מרכזת": "2fe451dd-791f-43b5-912f-f6364bb96c27",
  "ציוד": "c0e9d36a-fcc0-4f4e-a1a7-b02e80aedeb4",
  "קוקה קולה": "069bcd7c-c277-46bf-ab23-526722d86fd0",
  "קטנועים - דלק": "99b28197-a1ea-47a4-8847-4cfe171bdb41",
  "קטנועים - חלפים": "91d0f264-7400-4bca-a6d1-7f41e9e09230",
  "קידום ממומן": "e06a6d28-b04e-419a-b9f3-0ad80b862ada",
  "קינוחים": "e60b6478-c7d8-4bad-a91c-ff21553897bb",
  "קליפ": "eb94c012-bc3a-4c7d-b10c-2401461c1ca6",
  "קליפ- עצמאי": "96d9e7c6-174d-4f91-b115-0d340efcd339",
  "רבנות": "b698ada0-eb51-4ad3-83b4-949ea41beec9",
  "שונות פרסום": "87e2608a-cf40-4cc2-a1f1-9e857ab2e9db",
  "שימורי איכות": "a240f791-8bee-4701-b7c9-50b91aa8906d",
  "שכירות": "32b50f61-6e23-4dc4-a0e1-4c080a40e37b",
  "שלטי חוצות": "1e005722-3494-410c-90c1-0a12e5cfa03d",
  "שלטי חוצות- עצמאי": "d58d6500-5a4b-4e71-99e7-3f83ddfd37df",
  "תחזוקה שונות": "e40909d7-8796-47af-84fd-81ad50569d85",
  "תמי 4": "159bf3ef-9cb6-49e7-bb71-26f77f486a6a",
  "תן ביס": "5dde8b15-6a34-4a58-90d3-5dbf1e91f26b",
  "תשלום חד פעמי": "d7baa06c-bfe7-49d1-bd55-9828b6f14c33",
};

const METHOD_MAP = {
  "כרטיס אשראי": "credit_card", "אשראי": "credit_card",
  "העברה בנקאית": "bank_transfer", "העברה": "bank_transfer",
  "מזומן": "cash",
  "צ'ק": "check", "צק": "check", "שיק": "check",
  "ביט": "bit",
  "פייבוקס": "paybox",
  "חברות הקפה": "credit_company", "הקפה": "credit_company",
  'הוראת קבע': "standing_order", 'הו"ק': "standing_order", "הוק": "standing_order",
  "אחר": "other",
};

function parseCSV(path) {
  const raw = readFileSync(path, "utf-8");
  const lines = raw.split("\n").map(l => l.replace(/\r$/, "")).filter(l => l.trim());
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (cols[i] || "").trim(); });
    return row;
  }).filter(r => Object.values(r).some(v => v));
}

function parseCSVLine(line) {
  const result = [];
  let inQuotes = false, current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current); current = "";
    } else { current += ch; }
  }
  result.push(current);
  return result;
}

function parseDate(str) {
  if (!str) return null;
  const s = str.trim().split(" ")[0];
  const parts = s.split("/");
  if (parts.length === 3 && parts[0].length <= 2)
    return `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
  if (s.match(/^\d{4}-\d{2}-\d{2}$/)) return s;
  return null;
}

function parseAmount(str) {
  if (!str) return 0;
  return parseFloat(str.replace(/[₪$€,\s]/g, "")) || 0;
}

function normalizeUrl(u) {
  if (!u) return null;
  u = u.trim();
  if (u.startsWith("//")) u = "https:" + u;
  if (!u.startsWith("http")) return null;
  return u;
}

function resolveMethod(raw) {
  if (!raw) return "other";
  return METHOD_MAP[raw] || METHOD_MAP[raw.trim()] || "other";
}

// ─── Parse main payments CSV ──────────────────────────────────────────────────
const mainRows = parseCSV(MAIN_CSV);
console.log(`Main CSV: ${mainRows.length} rows`);

// Group by חשבוניות (invoice Bubble ID). If empty, use unique id as own group.
const groups = new Map();
for (const row of mainRows) {
  const invoiceId = row["חשבוניות"] || "";
  const key = invoiceId || ("uid:" + row["unique id"]);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}
console.log(`Grouped into ${groups.size} payments`);

// ─── Parse sub-payments CSV ───────────────────────────────────────────────────
const subsRows = parseCSV(SUBS_CSV);
console.log(`Sub-payments CSV: ${subsRows.length} rows`);

// ─── Import main payments ─────────────────────────────────────────────────────
// bubbleIdToPaymentId: maps bubble IDs → our payment UUID (for sub-payment linking)
const bubbleIdToPaymentId = new Map();
const unmatchedSuppliers = new Set();

let inserted = 0, errors = 0;

for (const [key, rows] of groups) {
  const first = rows[0];
  const supplierName = (first["ספק"] || first["Supplier name"] || "").trim();
  const supplierId = SUPPLIERS[supplierName];

  if (!supplierId) {
    unmatchedSuppliers.add(supplierName);
    errors++;
    continue;
  }

  // Payment date: use first installment's due date, or entry date as fallback
  const paymentDate = parseDate(first["תאריך התשלום"]) || parseDate(first["תאריך הזנה"]);
  if (!paymentDate) { errors++; continue; }

  const totalAmount = parseAmount(first["סכום אחרי מע''מ"]) || parseAmount(first['סכום אחרי מע\'\'מ']);
  const notes = first["הערות"] || null;

  // Receipt URL from כל התמונות or הוכחת תשלום 1
  const allImgs = first["כל התמונות"] || "";
  const img1 = first["הוכחת תשלום 1"] || "";
  let receiptUrl = null;
  if (allImgs) {
    const urls = allImgs.split(/\s*,\s*/).map(normalizeUrl).filter(Boolean);
    if (urls.length === 1) receiptUrl = urls[0];
    else if (urls.length > 1) receiptUrl = JSON.stringify(urls);
  } else if (img1) {
    receiptUrl = normalizeUrl(img1);
  }

  // data_source: store bubble IDs for later sub-payment linking
  const bubbleInvoiceId = first["חשבוניות"] || "";
  const dataSource = bubbleInvoiceId ? `bubble:${bubbleInvoiceId}` : null;

  // Insert payment
  const { data: paymentData, error: paymentError } = await supabase
    .from("payments")
    .insert({
      business_id: BUSINESS_ID,
      supplier_id: supplierId,
      payment_date: paymentDate,
      total_amount: totalAmount || 0,
      notes,
      receipt_url: receiptUrl,
    })
    .select("id")
    .single();

  if (paymentError || !paymentData) {
    console.error(`Payment insert error for ${supplierName}:`, paymentError?.message);
    errors++;
    continue;
  }

  const paymentId = paymentData.id;
  inserted++;

  // Store ALL bubble IDs related to this payment for sub-payment matching
  if (bubbleInvoiceId) bubbleIdToPaymentId.set(bubbleInvoiceId, paymentId);
  for (const row of rows) {
    if (row["unique id"]) bubbleIdToPaymentId.set(row["unique id"], paymentId);
  }

  // Insert splits (one per row)
  const splits = rows.map(row => ({
    payment_id: paymentId,
    payment_method: resolveMethod(row["סוג אמצעי תשלום"]),
    amount: parseAmount(row['סכום לכל תשלום אחרי מע""מ)']) ||
            parseAmount(row["סכום לכל תשלום אחרי מע'מ)"]) ||
            totalAmount || 0,
    installment_number: parseInt(row["מספר תשלום"]) || 1,
    installments_count: parseInt(row["כמות תשלומים"]) || 1,
    due_date: parseDate(row["תאריך התשלום"]) || paymentDate,
    check_number: row["מס' צ'ק"] || null,
    reference_number: row["אסמכתא"] || null,
  }));

  const { error: splitsError } = await supabase.from("payment_splits").insert(splits);
  if (splitsError) {
    console.error(`Splits insert error for ${supplierName}:`, splitsError.message);
  }

  process.stdout.write(`\rInserted ${inserted}/${groups.size} payments...`);
}

console.log(`\nMain payments: inserted=${inserted}, errors=${errors}`);
if (unmatchedSuppliers.size > 0)
  console.log("Unmatched suppliers:", [...unmatchedSuppliers]);

// ─── Import sub-payments ──────────────────────────────────────────────────────
console.log("\nProcessing sub-payments...");
let subInserted = 0, subErrors = 0;

// Group sub-payments by תשלום ראשי (parent) or create standalone
const subGroups = new Map();
for (const row of subsRows) {
  const parentId = row["תשלום ראשי"] || "";
  const key = parentId || ("sub:" + row["unique id"]);
  if (!subGroups.has(key)) subGroups.set(key, []);
  subGroups.get(key).push(row);
}

for (const [key, rows] of subGroups) {
  const first = rows[0];
  const parentBubbleId = first["תשלום ראשי"] || "";
  const existingPaymentId = parentBubbleId ? bubbleIdToPaymentId.get(parentBubbleId) : null;

  if (existingPaymentId) {
    // Add splits to existing payment
    const splits = rows.map(row => ({
      payment_id: existingPaymentId,
      payment_method: resolveMethod(row["סוג אמצעי תשלום"]),
      amount: parseAmount(row['סכום תשלום אחרי מע""מ)'] || row['סכום תשלום אחרי מע""מ']) || 0,
      installment_number: parseInt(row["מספר תשלום"]) || 1,
      installments_count: 1,
      due_date: parseDate(row["תאריך תשלום"]) || null,
      check_number: row["מספר צ'ק"] || null,
      reference_number: row["מספר אסמכתא"] || null,
    }));
    const { error } = await supabase.from("payment_splits").insert(splits);
    if (error) { console.error("Sub-split error:", error.message); subErrors++; }
    else subInserted += splits.length;
  } else {
    // Create standalone payment
    const supplierName = (first["ספק"] || "").trim();
    const supplierId = SUPPLIERS[supplierName];
    if (!supplierId) { unmatchedSuppliers.add(supplierName); subErrors++; continue; }

    const paymentDate = parseDate(first["תאריך תשלום"]);
    if (!paymentDate) { subErrors++; continue; }

    const amount = parseAmount(first['סכום תשלום אחרי מע""מ)'] || first['סכום תשלום אחרי מע""מ']) || 0;

    const { data: pd, error: pe } = await supabase
      .from("payments")
      .insert({ business_id: BUSINESS_ID, supplier_id: supplierId, payment_date: paymentDate, total_amount: amount })
      .select("id").single();

    if (pe || !pd) { subErrors++; continue; }

    const splits = rows.map(row => ({
      payment_id: pd.id,
      payment_method: resolveMethod(row["סוג אמצעי תשלום"]),
      amount: parseAmount(row['סכום תשלום אחרי מע""מ)'] || row['סכום תשלום אחרי מע""מ']) || 0,
      installment_number: parseInt(row["מספר תשלום"]) || 1,
      installments_count: rows.length,
      due_date: parseDate(row["תאריך תשלום"]) || paymentDate,
      check_number: row["מספר צ'ק"] || null,
      reference_number: row["מספר אסמכתא"] || null,
    }));

    await supabase.from("payment_splits").insert(splits);
    subInserted++;
  }
}

console.log(`Sub-payments: inserted=${subInserted}, errors=${subErrors}`);

// ─── Final count ──────────────────────────────────────────────────────────────
const { count } = await supabase
  .from("payments")
  .select("*", { count: "exact", head: true })
  .eq("business_id", BUSINESS_ID);

const { count: splitsCount } = await supabase
  .from("payment_splits")
  .select("*", { count: "exact", head: true })
  .in("payment_id", (await supabase.from("payments").select("id").eq("business_id", BUSINESS_ID)).data?.map(p => p.id) || []);

console.log(`\nTotal payments in DB: ${count}`);
console.log(`Total splits in DB: ${splitsCount}`);
