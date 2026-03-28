/**
 * Import: פתרונות לחיות — Bubble → Supabase
 * Step 1: Suppliers + Expense Categories
 * Step 2: Payment Method Types (from תשלומי משנה)
 * Step 3: Goals + Monthly Budget
 * Step 4: Invoices
 * Step 5: Payments
 * Step 6: Payment Splits
 * Step 7: Daily Entries + Breakdowns
 * Step 8: Supplier Budgets
 * Step 9: Prior Commitments
 * Step 10: Historical Data (monthly_summaries)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import Papa from "papaparse";

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://db.amazpenbiz.co.il";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzExNTM2NTMsImV4cCI6MTg5MzQ1NjAwMCwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlzcyI6InN1cGFiYXNlIn0.jO_qu5aNUaOZ0YBdfW5MbzdML-csEU9QkqoTGAx5yzY";
const BUSINESS_ID = "49ce2088-f622-487e-9072-c0b3a1f39e76";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BASE_DIR = "C:/Users/netn1/Downloads/פתרחונות לחיות!/";
const BUDGET_FILE = "C:/Users/netn1/Downloads/export_All-------------modified_2026-03-28_20-30-43.csv";

// ── CSV Helpers ─────────────────────────────────────────────────────────────
const parseCsv = (path) => {
  const content = readFileSync(path, "utf-8").replace(/^\uFEFF/, "");
  return Papa.parse(content, { header: true, skipEmptyLines: true }).data;
};

const parseNum = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(String(v).replace(/[,\s₪%]/g, ""));
  return isNaN(n) ? null : n;
};

const parseDate = (v) => {
  if (!v || v === "(no value)") return null;
  // Bubble format: "Jan 6, 2025 9:09 pm" or "Jan 1, 2025 12:00 am"
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
};

const parseDateOnly = (v) => {
  if (!v || v === "(no value)") return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
};

// ── File map ────────────────────────────────────────────────────────────────
const FILES = {
  suppliers: BASE_DIR + "export_All-----modified_2026-03-28_19-08-04.csv",
  invoices: BASE_DIR + "export_All-------modified---_2026-03-28_19-08-44.csv",
  payments: BASE_DIR + "export_All---------modified_2026-03-28_19-10-50.csv",
  paymentSplits1: BASE_DIR + "export_All------------modified_2026-03-28_19-10-37.csv",
  paymentSplits2: BASE_DIR + "export_All-------------modified_2026-03-28_19-05-43.csv",
  dailyEntries: BASE_DIR + "export_All------------modified_2026-03-28_19-07-16.csv",
  goals: BASE_DIR + "export_----_2026-03-28_19-04-45.csv",
  budget: BUDGET_FILE,
  supplierBudgets: BASE_DIR + "export_All-----------modified_2026-03-28_19-10-19.csv",
  commitments: BASE_DIR + "export_All-------------------modified_2026-03-28_19-06-06.csv",
  commitmentPayments: BASE_DIR + "export_All------------------------modified_2026-03-28_19-06-45.csv",
  historical: BASE_DIR + "export_All-----------copied_2026-03-28_19-07-51.csv",
};

// ── Lookup maps (populated during import) ───────────────────────────────────
const categoryMap = {}; // name → uuid
const supplierMap = {}; // name → uuid
const bubbleToSupplier = {}; // bubble_unique_id → supabase uuid
const bubbleToInvoice = {}; // bubble_unique_id → supabase uuid
const bubbleToPayment = {}; // bubble_unique_id → supabase uuid
const paymentMethodMap = {}; // name → uuid
const incomeSourceMap = {}; // name → uuid

// ══════════════════════════════════════════════════════════════════════════════
// STEP 1: Expense Categories + Suppliers
// ══════════════════════════════════════════════════════════════════════════════
async function step1_suppliers() {
  console.log("\n═══ STEP 1: Expense Categories + Suppliers ═══");
  const rows = parseCsv(FILES.suppliers);
  console.log(`  CSV rows: ${rows.length}`);

  // 1a. Create parent categories
  const parentNames = [...new Set(rows.map((r) => r["קטגורית אב"]?.trim()).filter(Boolean))];
  console.log(`  Parent categories: ${parentNames.length}`);

  for (const name of parentNames) {
    const { data, error } = await supabase
      .from("expense_categories")
      .upsert({ business_id: BUSINESS_ID, name, parent_id: null }, { onConflict: "business_id,name" })
      .select("id")
      .single();

    if (error) {
      // Try insert, if exists fetch
      const { data: existing } = await supabase
        .from("expense_categories")
        .select("id")
        .eq("business_id", BUSINESS_ID)
        .eq("name", name)
        .is("deleted_at", null)
        .maybeSingle();
      if (existing) {
        categoryMap[name] = existing.id;
      } else {
        const { data: inserted, error: err2 } = await supabase
          .from("expense_categories")
          .insert({ business_id: BUSINESS_ID, name, parent_id: null })
          .select("id")
          .single();
        if (err2) console.error(`  ❌ Parent category "${name}": ${err2.message}`);
        else categoryMap[name] = inserted.id;
      }
    } else {
      categoryMap[name] = data.id;
    }
  }
  console.log(`  ✅ Parent categories created: ${Object.keys(categoryMap).length}`);

  // 1b. Create sub-categories
  const subCats = [...new Set(rows.map((r) => {
    const parent = r["קטגורית אב"]?.trim();
    const sub = r["קטגוריה"]?.trim();
    return sub && parent ? `${parent}::${sub}` : null;
  }).filter(Boolean))];

  for (const key of subCats) {
    const [parent, sub] = key.split("::");
    const parentId = categoryMap[parent];
    if (!parentId) continue;

    const { data: existing } = await supabase
      .from("expense_categories")
      .select("id")
      .eq("business_id", BUSINESS_ID)
      .eq("name", sub)
      .eq("parent_id", parentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) {
      categoryMap[key] = existing.id;
    } else {
      const { data: inserted, error } = await supabase
        .from("expense_categories")
        .insert({ business_id: BUSINESS_ID, name: sub, parent_id: parentId })
        .select("id")
        .single();
      if (error) console.error(`  ❌ Sub category "${sub}": ${error.message}`);
      else categoryMap[key] = inserted.id;
    }
  }
  console.log(`  ✅ Sub categories created: ${subCats.length}`);

  // 1c. Create suppliers
  const seen = new Set();
  let created = 0, skipped = 0;

  for (const r of rows) {
    const name = r["שם הספק"]?.trim();
    if (!name || seen.has(name)) { skipped++; continue; }
    seen.add(name);

    const parent = r["קטגורית אב"]?.trim() || "";
    const sub = r["קטגוריה"]?.trim() || "";
    const expenseType = r["סוג הוצאה"]?.trim() || "";
    const requiresVat = r["נדרש מע''מ"]?.trim() === "כן";
    const paymentTerms = parseNum(r["תנאי תשלום"]) || 0;
    const isFixed = r["הוצאה חודשית קבועה"]?.trim() === "כן";
    const fixedAmount = parseNum(r["סכום לכל תשלום קבוע (במידה וידוע)"]);
    const chargeDay = parseNum(r["מתי יורד כל חודש?"]);
    const isActive = r["פעיל/לא פעיל"]?.trim() !== "לא";
    const bubbleId = r["unique id"]?.trim();

    // Map expense type
    let expenseNature = null;
    if (expenseType === "קניות סחורה") expenseNature = "goods";
    else if (expenseType === "הוצאות שוטפות") expenseNature = "operating";

    // Find category IDs
    const parentCategoryId = parent ? categoryMap[parent] || null : null;
    const subKey = sub && parent ? `${parent}::${sub}` : null;
    const expenseCategoryId = subKey ? categoryMap[subKey] || null : null;

    const supplierData = {
      business_id: BUSINESS_ID,
      name,
      expense_type: expenseType === "קניות סחורה" ? "goods" : "operating",
      expense_nature: expenseNature,
      expense_category_id: expenseCategoryId,
      parent_category_id: parentCategoryId,
      requires_vat: requiresVat,
      payment_terms_days: paymentTerms,
      is_fixed_expense: isFixed,
      monthly_expense_amount: fixedAmount,
      charge_day: chargeDay,
      is_active: isActive,
    };

    const { data: existing } = await supabase
      .from("suppliers")
      .select("id")
      .eq("business_id", BUSINESS_ID)
      .eq("name", name)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) {
      supplierMap[name] = existing.id;
      if (bubbleId) bubbleToSupplier[bubbleId] = existing.id;
      skipped++;
    } else {
      const { data: inserted, error } = await supabase
        .from("suppliers")
        .insert(supplierData)
        .select("id")
        .single();
      if (error) {
        console.error(`  ❌ Supplier "${name}": ${error.message}`);
      } else {
        supplierMap[name] = inserted.id;
        if (bubbleId) bubbleToSupplier[bubbleId] = inserted.id;
        created++;
      }
    }
  }
  console.log(`  ✅ Suppliers created: ${created}, skipped (existing/dup): ${skipped}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 2: Payment Method Types (extracted from payment splits)
// ══════════════════════════════════════════════════════════════════════════════
async function step2_paymentMethods() {
  console.log("\n═══ STEP 2: Payment Method Types ═══");
  const rows1 = parseCsv(FILES.paymentSplits1);
  const rows2 = parseCsv(FILES.paymentSplits2);

  const types = new Set();
  for (const r of [...rows1, ...rows2]) {
    const t = r["סוג אמצעי תשלום"]?.trim();
    if (t) types.add(t);
  }
  console.log(`  Unique payment types: ${[...types].join(", ")}`);

  let order = 0;
  for (const name of types) {
    const { data: existing } = await supabase
      .from("payment_method_types")
      .select("id")
      .eq("business_id", BUSINESS_ID)
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      paymentMethodMap[name] = existing.id;
    } else {
      const { data: inserted, error } = await supabase
        .from("payment_method_types")
        .insert({ business_id: BUSINESS_ID, name, display_order: order++ })
        .select("id")
        .single();
      if (error) console.error(`  ❌ Payment type "${name}": ${error.message}`);
      else paymentMethodMap[name] = inserted.id;
    }
  }
  console.log(`  ✅ Payment method types: ${Object.keys(paymentMethodMap).length}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 3: Goals + Monthly Budget
// ══════════════════════════════════════════════════════════════════════════════
async function step3_goals() {
  console.log("\n═══ STEP 3: Goals + Monthly Budget ═══");
  const goalsRows = parseCsv(FILES.goals);
  const budgetRows = parseCsv(FILES.budget);
  console.log(`  Goals rows: ${goalsRows.length}, Budget rows: ${budgetRows.length}`);

  // Build budget lookup by year+month
  const budgetLookup = {};
  for (const r of budgetRows) {
    const year = parseNum(r["שנה"]);
    const month = parseNum(r["חודש (מספר)"]);
    if (year && month) budgetLookup[`${year}-${month}`] = r;
  }

  // Load existing income sources for avg ticket goals
  const { data: incomeSources } = await supabase
    .from("income_sources")
    .select("id, name, display_order")
    .eq("business_id", BUSINESS_ID)
    .is("deleted_at", null)
    .order("display_order");

  if (incomeSources) {
    for (const s of incomeSources) {
      incomeSourceMap[s.display_order] = s.id;
    }
    console.log(`  Income sources: ${incomeSources.map((s) => `${s.display_order}:${s.name}`).join(", ")}`);
  }

  let created = 0;
  for (const r of goalsRows) {
    const year = parseNum(r["שנה"]);
    const month = parseNum(r["ימי עבודה בחודש"]) ? null : null; // month not in goals CSV directly
    const markup = parseNum(r["העמסה"]);
    const vat = parseNum(r["מע\"מ"]);
    const managerSalary = parseNum(r["שכר מנהל חודש "]);
    const expectedWorkDays = parseNum(r["ימי עבודה בחודש"]);
    const bubbleId = r["unique id"]?.trim();

    // Find matching budget row — goals CSV doesn't have month, match by bubble creation order
    // Actually goals has one row per month, let's match by index to budget
    const creationDate = r["Creation Date"]?.trim();

    // Match budget by creation date proximity
    // Since both have same year and are ordered monthly, match by position
  }

  // Better approach: use budget rows directly as they have month+year
  for (const r of budgetRows) {
    const year = parseNum(r["שנה"]);
    const month = parseNum(r["חודש (מספר)"]);
    if (!year || !month) continue;

    // Find matching goals row (same year, same position)
    const goalsKey = `${year}-${month}`;
    const goalRow = goalsRows.find((g) => {
      const gYear = parseNum(g["שנה"]);
      const gCreation = g["Creation Date"]?.trim();
      // Match by unique id relation or by order
      return gYear === year;
    });

    const revenueTarget = parseNum(r["תקציב מכירות ברוטו"]);
    const laborPct = parseNum(r["תקציב עלות עובדים (באחוזים)"]);
    const foodPct = parseNum(r["תקציב עלות מכר (באחוזים)"]);
    const goodsTarget = parseNum(r["תקציב עלוב מכר (בשקל)"]);
    const currentExpensesTarget = parseNum(r["תקציב הוצאות שוטפות (בשקל)"]);

    // From goals CSV (matched by year)
    let markup = null, vatPct = null, expectedWorkDays = null;
    // Find the goals row for this specific month
    const matchedGoal = goalsRows.find((g) => {
      const gBubbleId = g["unique id"]?.trim();
      const gYear = parseNum(g["שנה"]);
      // Goals rows are ordered by creation, budget rows by month
      return gYear === year;
    });

    // Since goals rows don't have month, use the goals file ordered by creation
    // and match to budget by index within same year
    const yearGoals = goalsRows.filter((g) => parseNum(g["שנה"]) === year);
    const yearBudgets = budgetRows.filter((b) => parseNum(b["שנה"]) === year);
    const idx = yearBudgets.indexOf(r);
    const matchGoal = idx >= 0 && idx < yearGoals.length ? yearGoals[idx] : null;

    if (matchGoal) {
      markup = parseNum(matchGoal["העמסה"]);
      vatPct = parseNum(matchGoal["מע\"מ"]);
      expectedWorkDays = parseNum(matchGoal["ימי עבודה בחודש"]);
    }

    const goalData = {
      business_id: BUSINESS_ID,
      year,
      month,
      revenue_target: revenueTarget,
      labor_cost_target_pct: laborPct,
      food_cost_target_pct: foodPct,
      goods_expenses_target: goodsTarget,
      current_expenses_target: currentExpensesTarget,
      markup_percentage: markup,
      vat_percentage: vatPct,
      expected_work_days: expectedWorkDays,
    };

    // Check if exists
    const { data: existing } = await supabase
      .from("goals")
      .select("id")
      .eq("business_id", BUSINESS_ID)
      .eq("year", year)
      .eq("month", month)
      .is("deleted_at", null)
      .maybeSingle();

    let goalId;
    if (existing) {
      // Update
      await supabase.from("goals").update(goalData).eq("id", existing.id);
      goalId = existing.id;
    } else {
      const { data: inserted, error } = await supabase
        .from("goals")
        .insert(goalData)
        .select("id")
        .single();
      if (error) {
        console.error(`  ❌ Goal ${year}/${month}: ${error.message}`);
        continue;
      }
      goalId = inserted.id;
      created++;
    }

    // Income source goals (avg ticket targets)
    const avgTargets = [
      { field: "יעד ממוצע הכנסה 1", order: 0 },
      { field: "יעד ממוצע הכנסה 2", order: 1 },
      { field: "יעד ממוצע הכנסה 3", order: 2 },
      { field: "יעד ממוצע הכנסה 4", order: 3 },
    ];

    for (const { field, order } of avgTargets) {
      const target = parseNum(r[field]);
      const sourceId = incomeSourceMap[order];
      if (!target || !sourceId) continue;

      await supabase
        .from("income_source_goals")
        .upsert(
          { goal_id: goalId, income_source_id: sourceId, avg_ticket_target: target },
          { onConflict: "goal_id,income_source_id" }
        );
    }
  }
  console.log(`  ✅ Goals created: ${created}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 4: Invoices
// ══════════════════════════════════════════════════════════════════════════════
async function step4_invoices() {
  console.log("\n═══ STEP 4: Invoices ═══");
  const rows = parseCsv(FILES.invoices);
  console.log(`  CSV rows: ${rows.length}`);

  // Filter only פתרונות לחיות
  const filtered = rows.filter((r) => r["עסק"]?.trim() === "פתרונות לחיות");
  console.log(`  Filtered for פתרונות לחיות: ${filtered.length}`);

  let created = 0, errors = 0;
  for (const r of filtered) {
    const supplierName = (r["Supplier name"] || r["ספק"])?.trim();
    const supplierId = supplierMap[supplierName];

    if (!supplierId && supplierName) {
      // Create supplier on the fly
      const { data: newSup } = await supabase
        .from("suppliers")
        .insert({ business_id: BUSINESS_ID, name: supplierName, expense_type: "operating" })
        .select("id")
        .maybeSingle();
      if (newSup) supplierMap[supplierName] = newSup.id;
    }

    const bubbleId = r["unique id"]?.trim();
    const invoiceNumber = r["מספר תעודה (מספר חשבונית)"]?.trim() || null;
    const subtotal = parseNum(r["סכום לפני מע\"מ"]);
    const vatAmount = parseNum(r["סכום מע\"מ"]);
    const totalAmount = parseNum(r["סכום אחרי מע''מ"]);
    const invoiceDate = parseDateOnly(r["תאריך חשבונית"]);
    const dueDate = parseDateOnly(r["תאריך לתשלום"]);
    const createdAt = parseDate(r["Creation Date"]);
    const notes = r["הערות למסמך רגיל"]?.trim() || r["הערות לחשבונית בבירור"]?.trim() || null;
    const attachmentUrl = r["תמונת חשבונית 1"]?.trim() || null;

    // Status mapping
    const bubbleStatus = r["טרם/שולם/שולם/זיכוי"]?.trim() || "";
    let status = "pending";
    if (bubbleStatus === "שולם") status = "paid";
    else if (bubbleStatus === "זיכוי") status = "credited";
    else if (bubbleStatus === "חשבונית בבירור" || r["חשבונית בבירור"]?.trim() === "כן") status = "disputed";

    const isCredit = r["זיכוי"]?.trim() === "כן";

    const invoiceData = {
      business_id: BUSINESS_ID,
      supplier_id: supplierMap[supplierName] || null,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      due_date: dueDate,
      subtotal: subtotal,
      vat_amount: vatAmount,
      total_amount: totalAmount,
      status,
      notes,
      attachment_url: attachmentUrl,
      invoice_type: isCredit ? "credit_note" : "invoice",
      created_at: createdAt,
    };

    const { data: inserted, error } = await supabase
      .from("invoices")
      .insert(invoiceData)
      .select("id")
      .maybeSingle();

    if (error) {
      errors++;
      if (errors <= 5) console.error(`  ❌ Invoice "${invoiceNumber}": ${error.message}`);
    } else if (inserted) {
      if (bubbleId) bubbleToInvoice[bubbleId] = inserted.id;
      created++;
    }
  }
  console.log(`  ✅ Invoices created: ${created}, errors: ${errors}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 5: Payments
// ══════════════════════════════════════════════════════════════════════════════
async function step5_payments() {
  console.log("\n═══ STEP 5: Payments ═══");
  const rows = parseCsv(FILES.payments);
  console.log(`  CSV rows: ${rows.length}`);

  const filtered = rows.filter((r) => (r["Business name"] || r["שם העסק"])?.trim() === "פתרונות לחיות");
  console.log(`  Filtered: ${filtered.length}`);

  let created = 0, errors = 0;
  for (const r of filtered) {
    const supplierName = (r["Supplier name"] || r["ספק"])?.trim();
    const supplierId = supplierMap[supplierName];
    const bubbleId = r["unique id"]?.trim();
    const paymentDate = parseDateOnly(r["תאריך התשלום"]);
    const totalAmount = parseNum(r["סכום אחרי מע''מ"]);
    const notes = r["הערות"]?.trim() || null;
    const receiptUrl = r["הוכחת תשלום 1"]?.trim() || null;
    const createdAt = parseDate(r["Creation Date"]);

    // Link to invoice via חשבוניות field (bubble IDs, comma separated)
    const invoiceBubbleIds = (r["חשבוניות"] || "").split(",").map((s) => s.trim()).filter(Boolean);
    const invoiceId = invoiceBubbleIds.length > 0 ? bubbleToInvoice[invoiceBubbleIds[0]] || null : null;

    const paymentData = {
      business_id: BUSINESS_ID,
      supplier_id: supplierId || null,
      payment_date: paymentDate,
      total_amount: totalAmount,
      invoice_id: invoiceId,
      notes,
      receipt_url: receiptUrl,
      created_at: createdAt,
    };

    const { data: inserted, error } = await supabase
      .from("payments")
      .insert(paymentData)
      .select("id")
      .maybeSingle();

    if (error) {
      errors++;
      if (errors <= 5) console.error(`  ❌ Payment: ${error.message}`);
    } else if (inserted) {
      if (bubbleId) bubbleToPayment[bubbleId] = inserted.id;
      created++;
    }
  }
  console.log(`  ✅ Payments created: ${created}, errors: ${errors}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 6: Payment Splits
// ══════════════════════════════════════════════════════════════════════════════
async function step6_paymentSplits() {
  console.log("\n═══ STEP 6: Payment Splits ═══");
  const rows = parseCsv(FILES.paymentSplits1);
  console.log(`  CSV rows (splits1): ${rows.length}`);

  const filtered = rows.filter((r) => r["עסק"]?.trim() === "פתרונות לחיות");
  console.log(`  Filtered: ${filtered.length}`);

  let created = 0, errors = 0;
  for (const r of filtered) {
    const paymentBubbleId = r["תשלום ראשי"]?.trim();
    const paymentId = paymentBubbleId ? bubbleToPayment[paymentBubbleId] : null;

    if (!paymentId) {
      errors++;
      continue;
    }

    const splitData = {
      payment_id: paymentId,
      payment_method: r["סוג אמצעי תשלום"]?.trim() || null,
      amount: parseNum(r["סכום תשלום אחרי מע\"מ"]),
      check_number: r["מספר צ'ק"]?.trim() || null,
      reference_number: r["מספר אסמכתא"]?.trim() || null,
      due_date: parseDateOnly(r["תאריך תשלום"]),
    };

    const { error } = await supabase.from("payment_splits").insert(splitData);
    if (error) {
      errors++;
      if (errors <= 5) console.error(`  ❌ Split: ${error.message}`);
    } else {
      created++;
    }
  }
  console.log(`  ✅ Payment splits created: ${created}, errors/unlinked: ${errors}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 7: Daily Entries + Income Breakdown
// ══════════════════════════════════════════════════════════════════════════════
async function step7_dailyEntries() {
  console.log("\n═══ STEP 7: Daily Entries ═══");
  const rows = parseCsv(FILES.dailyEntries);
  console.log(`  CSV rows: ${rows.length}`);

  const filtered = rows.filter((r) => r["עסק"]?.trim() === "פתרונות לחיות");
  console.log(`  Filtered: ${filtered.length}`);

  // Load income sources
  const { data: sources } = await supabase
    .from("income_sources")
    .select("id, name, display_order")
    .eq("business_id", BUSINESS_ID)
    .is("deleted_at", null)
    .order("display_order");

  const sourceByOrder = {};
  if (sources) {
    for (const s of sources) sourceByOrder[s.display_order] = s.id;
  }

  let created = 0, errors = 0;
  for (const r of filtered) {
    const entryDate = parseDateOnly(r["תאריך"]);
    if (!entryDate) continue;

    const dayFactor = parseNum(r["יום חלקי/יום מלא"]) || 1;
    const laborCost = parseNum(r["ע.עובדים יומית ללא העמסה"]);
    const laborHours = parseNum(r["כמות שעות עובדים"]);
    const discounts = parseNum(r["זיכוי+ביטול+הנחות ב ₪"]);
    const totalRegister = parseNum(r["סה\"כ z יומי"]) || parseNum(r["הכנסות"]);
    const managerDailyCost = parseNum(r["שכר מנהל יומי כולל העמסה"]);
    const createdAt = parseDate(r["Creation Date"]);

    // Check if already exists
    const { data: existing } = await supabase
      .from("daily_entries")
      .select("id")
      .eq("business_id", BUSINESS_ID)
      .eq("entry_date", entryDate)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) continue;

    const entryData = {
      business_id: BUSINESS_ID,
      entry_date: entryDate,
      total_register: totalRegister,
      labor_cost: laborCost,
      labor_hours: laborHours,
      discounts: discounts,
      day_factor: dayFactor,
      manager_daily_cost: managerDailyCost,
      created_at: createdAt,
    };

    const { data: inserted, error } = await supabase
      .from("daily_entries")
      .insert(entryData)
      .select("id")
      .maybeSingle();

    if (error) {
      errors++;
      if (errors <= 5) console.error(`  ❌ Entry ${entryDate}: ${error.message}`);
      continue;
    }

    created++;
    const entryId = inserted.id;

    // Income breakdown (4 sources)
    const incomeFields = [
      { amount: "סה\"כ הכנסות 1", count: "כמות הזמנות 1", order: 0 },
      { amount: "סה\"כ הכנסות 2", count: "כמות הזמנות 2", order: 1 },
      { amount: "סה\"כ הכנסות 3", count: "כמות הזמנות 3", order: 2 },
      { amount: "סה\"כ הכנסות 4", count: "כמות הזמנות 4", order: 3 },
    ];

    for (const { amount, count, order } of incomeFields) {
      const amt = parseNum(r[amount]);
      const cnt = parseNum(r[count]);
      const sourceId = sourceByOrder[order];
      if ((!amt && !cnt) || !sourceId) continue;

      await supabase.from("daily_income_breakdown").insert({
        daily_entry_id: entryId,
        income_source_id: sourceId,
        amount: amt || 0,
        orders_count: cnt ? Math.round(cnt) : null,
      });
    }
  }
  console.log(`  ✅ Daily entries created: ${created}, errors: ${errors}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 8: Supplier Budgets
// ══════════════════════════════════════════════════════════════════════════════
async function step8_supplierBudgets() {
  console.log("\n═══ STEP 8: Supplier Budgets ═══");
  const rows = parseCsv(FILES.supplierBudgets);
  console.log(`  CSV rows: ${rows.length}`);

  const filtered = rows.filter((r) => r["עסק"]?.trim() === "פתרונות לחיות");
  console.log(`  Filtered: ${filtered.length}`);

  let created = 0, skipped = 0, errors = 0;
  for (const r of filtered) {
    const supplierName = r["ספק"]?.trim();
    const supplierId = supplierMap[supplierName];
    const year = parseNum(r["שנה"]);
    const month = parseNum(r["חודש (במספר)"]);
    const budgetAmount = parseNum(r["סכום תקציב חודשי"]);

    if (!supplierId || !year || !month) {
      skipped++;
      continue;
    }

    const { data: existing } = await supabase
      .from("supplier_budgets")
      .select("id")
      .eq("business_id", BUSINESS_ID)
      .eq("supplier_id", supplierId)
      .eq("year", year)
      .eq("month", month)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) { skipped++; continue; }

    const { error } = await supabase.from("supplier_budgets").insert({
      business_id: BUSINESS_ID,
      supplier_id: supplierId,
      year,
      month,
      budget_amount: budgetAmount || 0,
    });

    if (error) {
      errors++;
      if (errors <= 3) console.error(`  ❌ Budget ${supplierName} ${year}/${month}: ${error.message}`);
    } else {
      created++;
    }
  }
  console.log(`  ✅ Supplier budgets created: ${created}, skipped: ${skipped}, errors: ${errors}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 9: Prior Commitments
// ══════════════════════════════════════════════════════════════════════════════
async function step9_commitments() {
  console.log("\n═══ STEP 9: Prior Commitments ═══");
  const rows = parseCsv(FILES.commitments);
  console.log(`  CSV rows: ${rows.length}`);

  const filtered = rows.filter((r) => r["עסק"]?.trim() === "פתרונות לחיות");
  console.log(`  Filtered: ${filtered.length}`);

  let created = 0;
  for (const r of filtered) {
    const name = r["שם הספק"]?.trim();
    const totalAmount = parseNum(r["סכום שנלקח"]);
    const monthlyAmount = parseNum(r["סכום חיוב חודשי כולל ריבית (משוער)"]);
    const totalInstallments = parseNum(r["כמות תשלומים"]);
    const startDate = parseDateOnly(r["תאריך חיוב ראשון"]);
    const endDate = parseDateOnly(r["תאריך סיום התחייבות"]);
    const terms = r["תנאים"]?.trim() || null;
    const createdAt = parseDate(r["Creation Date"]);

    const { data: existing } = await supabase
      .from("prior_commitments")
      .select("id")
      .eq("business_id", BUSINESS_ID)
      .eq("name", name)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabase.from("prior_commitments").insert({
      business_id: BUSINESS_ID,
      name,
      monthly_amount: monthlyAmount,
      total_installments: totalInstallments ? Math.round(totalInstallments) : null,
      start_date: startDate,
      end_date: endDate,
      terms,
      created_at: createdAt,
    });

    if (error) console.error(`  ❌ Commitment "${name}": ${error.message}`);
    else created++;
  }
  console.log(`  ✅ Prior commitments created: ${created}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 10: Historical Data (monthly_summaries)
// ══════════════════════════════════════════════════════════════════════════════
async function step10_historical() {
  console.log("\n═══ STEP 10: Historical Data (monthly_summaries) ═══");
  const rows = parseCsv(FILES.historical);
  console.log(`  CSV rows: ${rows.length}`);

  const filtered = rows.filter((r) => r["עסק"]?.trim() === "פתרונות לחיות");
  console.log(`  Filtered: ${filtered.length}`);

  let created = 0;
  for (const r of filtered) {
    const year = parseNum(r["שנה"]);
    const month = parseNum(r["חודש"]);
    if (!year || !month) continue;

    const { data: existing } = await supabase
      .from("monthly_summaries")
      .select("id")
      .eq("business_id", BUSINESS_ID)
      .eq("year", year)
      .eq("month", month)
      .maybeSingle();

    if (existing) continue;

    const summaryData = {
      business_id: BUSINESS_ID,
      year,
      month,
      total_income: parseNum(r["מכירות ברוטו"]),
      labor_cost_pct: parseNum(r["עלות עבודה באחוזים"]),
      labor_cost_amount: parseNum(r["עלות עבודה בש\"ח"]),
      food_cost_pct: parseNum(r["עלות מכר באחוזים"]),
      food_cost_amount: parseNum(r["עלות מכר בש\"ח"]),
      managed_product_1_pct: parseNum(r["מוצר מנוהל 1 באחוזים"]),
      managed_product_2_pct: parseNum(r["מוצר מנוהל 2 באחוזים"]),
      managed_product_3_pct: parseNum(r["מוצר מנוהל 3 באחוזים"]),
      avg_income_1: parseNum(r["ממוצע הכנסה 1 בש\"ח"]),
      avg_income_2: parseNum(r["ממוצע הכנסה 2 בש\"ח"]),
      avg_income_3: parseNum(r["ממוצע הכנסה 3 בש\"ח"]),
      avg_income_4: parseNum(r["ממוצע הכנסה 4 בש\"ח"]),
      sales_budget_diff_pct: parseNum(r["הפרש מתקציב מכירות באחוז"]),
      labor_budget_diff_pct: parseNum(r["ע. עבודה הפרש מתקציב באחוזים"]),
      food_cost_budget_diff: parseNum(r["עלות מכר הפרש מתקציב"]),
      sales_yoy_change_pct: parseNum(r["שינוי משנה שעברה מכירות באחוזים"]),
    };

    const { error } = await supabase.from("monthly_summaries").insert(summaryData);
    if (error) console.error(`  ❌ Summary ${year}/${month}: ${error.message}`);
    else created++;
  }
  console.log(`  ✅ Monthly summaries created: ${created}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// VERIFICATION
// ══════════════════════════════════════════════════════════════════════════════
async function verify() {
  console.log("\n═══ VERIFICATION ═══");
  const tables = [
    "expense_categories", "suppliers", "payment_method_types", "goals",
    "income_source_goals", "invoices", "payments", "payment_splits",
    "daily_entries", "daily_income_breakdown", "supplier_budgets",
    "prior_commitments", "monthly_summaries",
  ];

  for (const table of tables) {
    const { count } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("business_id", BUSINESS_ID);

    // Some tables don't have business_id directly
    if (count !== null) {
      console.log(`  ${table}: ${count}`);
    }
  }

  // Tables without business_id
  for (const table of ["daily_income_breakdown", "payment_splits", "income_source_goals"]) {
    const { data } = await supabase.rpc("exec_sql", {
      query: `SELECT COUNT(*) as cnt FROM ${table}`,
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  Import: פתרונות לחיות — Bubble → Supabase  ║");
  console.log("╚══════════════════════════════════════════════╝");

  await step1_suppliers();
  await step2_paymentMethods();
  await step3_goals();
  await step4_invoices();
  await step5_payments();
  await step6_paymentSplits();
  await step7_dailyEntries();
  await step8_supplierBudgets();
  await step9_commitments();
  await step10_historical();
  await verify();

  console.log("\n✅ Import complete!");
}

main().catch(console.error);
