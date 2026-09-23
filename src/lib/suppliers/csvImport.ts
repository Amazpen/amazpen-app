import Papa from "papaparse";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared supplier-CSV import logic.
 *
 * Used by BOTH the standalone importer (admin/suppliers, "ייבוא ספקים") and the
 * new-business wizard (admin/business/new) so the two cannot drift apart again.
 * The behaviour here is the one admin/suppliers had before it was extracted.
 */

export interface CsvSupplier {
  name: string;
  expense_type: string;
  contact_name: string;
  phone: string;
  email: string;
  tax_id: string;
  address: string;
  payment_terms_days: number;
  notes: string;
  // Extended fields from rich CSV
  requires_vat: boolean;
  vat_type: "full" | "none" | "partial";
  is_fixed_expense: boolean;
  monthly_expense_amount: number | null;
  charge_day: number | null;
  is_active: boolean;
  has_previous_obligations: boolean;
  waiting_for_coordinator: boolean;
  parent_category_name: string;
  category_name: string;
  /** App value for suppliers.default_payment_method ("credit", "check", ...), or null. */
  default_payment_method: string | null;
  /** 4-digit card suffix found in a credit payment-method cell, if any. */
  credit_card_last_four: string | null;
}

// Map of possible Hebrew/English header names to canonical field names
// Note: keys are normalized (NFC, double-quotes → single, no trailing punctuation, trimmed) - see normalizeSupplierCsvHeader below
export const SUPPLIER_CSV_HEADER_ALIASES: Record<string, string> = {
  "שם הספק": "name", "שם": "name", "שם ספק": "name", "name": "name", "supplier_name": "name",
  "סוג הוצאה": "expense_type", "expense_type": "expense_type",
  "נדרש מע'מ": "requires_vat", "נדרש מעמ": "requires_vat", "נדרש מע": "requires_vat",
  "מעמ": "vat", "מע'מ": "vat",
  "מעמ חלקי": "vat_partial",
  "הוצאה חודשית קבועה": "is_fixed",
  "סכום לכל תשלום קבוע (במידה וידוע)": "monthly_amount",
  "סכום לכל תשלום קבוע": "monthly_amount",
  "סכום לכל תשלום קבוע (כולל מעמ)": "monthly_amount",
  "סכום לכל תשלום קבוע (כולל מע'מ)": "monthly_amount",
  "מתי יורד כל חודש": "charge_day",
  // Fallback for Bubble CSVs that only have the first-charge day
  "יום (מספר)": "charge_day_fallback", "יום": "charge_day_fallback",
  "תנאי תשלום": "payment_terms", "payment_terms_days": "payment_terms", "ימי תשלום": "payment_terms",
  "הערות": "notes", "notes": "notes",
  "קטגורית אב": "parent_category",
  "קטגוריית אב": "parent_category",
  "קטגוריית אב (רווח הפסד)": "parent_category",
  "קטגורית אב (רווח הפסד)": "parent_category",
  "קטגוריה": "category",
  "פעיל/לא פעיל (מספר)": "is_active_num", "פעיל/לא פעיל": "is_active_num",
  "פעיל": "is_active_text",
  // Persisted to suppliers.default_payment_method (see mapSupplierCsvPaymentMethod).
  "אמצעי תשלום": "payment_method",
  "איש קשר": "contact", "contact_name": "contact",
  "טלפון": "phone", "phone": "phone",
  "אימייל": "email", "מייל": "email", "email": "email",
  "ח.פ": "tax_id", "מספר עוסק": "tax_id", "עוסק": "tax_id", "tax_id": "tax_id",
  "כתובת": "address", "address": "address",
  "התחייבות": "has_obligations", "התחייבות קודמות": "has_obligations",
};

// Normalize header for matching: trim, collapse whitespace, remove trailing punctuation,
// unify quote characters (Hebrew CSVs often have ", '', `, etc. for the geresh/gershayim)
export const normalizeSupplierCsvHeader = (h: string): string => {
  return h
    .trim()
    .replace(/\s+/g, " ")
    .replace(/["׳״`]/g, "'") // unify all quote variants to single '
    .replace(/'+/g, "'")     // collapse multiple ' to one
    .replace(/[?:!.,;]+$/, "") // strip trailing punctuation
    .trim();
};

// Hebrew payment-method prefixes -> suppliers.default_payment_method values.
// The app's values are the ones offered in the supplier form
// (src/app/(dashboard)/suppliers/page.tsx): bank_transfer, cash, check, bit,
// paybox, credit, other, credit_companies, standing_order.
const PAYMENT_METHOD_PREFIXES: [string, string][] = [
  ["כ.אשראי", "credit"],
  ["כ. אשראי", "credit"],
  ["כרטיס אשראי", "credit"],
  ["אשראי", "credit"],
  ["צק", "check"],
  ["צ'ק", "check"],
  ["שק", "check"],
  ["המחאה", "check"],
  ["העברה בנקאית", "bank_transfer"],
  ["העברה", "bank_transfer"],
  ["הוראת קבע", "standing_order"],
  ["מזומן", "cash"],
];

// Exact (whole-value) matches for the remaining app values.
const PAYMENT_METHOD_EXACT: Record<string, string> = {
  "ביט": "bit",
  "פייבוקס": "paybox",
  "פיי בוקס": "paybox",
  "חברות הקפה": "credit_companies",
  "חברת הקפה": "credit_companies",
  "אחר": "other",
  // Already-canonical values
  "credit": "credit",
  "check": "check",
  "bank_transfer": "bank_transfer",
  "standing_order": "standing_order",
  "cash": "cash",
  "bit": "bit",
  "paybox": "paybox",
  "credit_companies": "credit_companies",
  "other": "other",
};

/**
 * Map a Hebrew "אמצעי תשלום" cell to an app payment-method value.
 * Returns `method: null` for an empty cell; `unknown: true` when the cell is
 * non-empty but not recognised (method is then null too).
 * For credit, `lastFour` is the first standalone 4-digit number in the cell.
 */
export function mapSupplierCsvPaymentMethod(raw: string): {
  method: string | null;
  lastFour: string | null;
  unknown: boolean;
} {
  const value = raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/["׳״`’]/g, "'")
    .replace(/'+/g, "'");
  if (!value) return { method: null, lastFour: null, unknown: false };

  let method: string | null = PAYMENT_METHOD_EXACT[value] || PAYMENT_METHOD_EXACT[value.toLowerCase()] || null;
  if (!method) {
    const match = PAYMENT_METHOD_PREFIXES.find(([prefix]) => value.startsWith(prefix));
    method = match ? match[1] : null;
  }
  if (!method) return { method: null, lastFour: null, unknown: true };

  let lastFour: string | null = null;
  if (method === "credit") {
    const digits = value.match(/(?:^|\D)(\d{4})(?!\d)/);
    lastFour = digits ? digits[1] : null;
  }
  return { method, lastFour, unknown: false };
}

/**
 * Build a last-four-digits -> card id map from business_credit_cards rows.
 * A suffix shared by more than one card is left out (ambiguous).
 */
export function buildCreditCardLastFourMap(
  cards: { id: string; last_four_digits: string | null }[],
): Map<string, string> {
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const card of cards) {
    const lastFour = (card.last_four_digits || "").trim();
    if (!lastFour) continue;
    if (map.has(lastFour)) ambiguous.add(lastFour);
    else map.set(lastFour, card.id);
  }
  for (const lastFour of ambiguous) map.delete(lastFour);
  return map;
}

/**
 * Category-name conflicts inside one file. The DB unique index is
 * (business_id, name) WHERE deleted_at IS NULL, regardless of parent, so a
 * name can exist only once per business:
 *  - the same child name under two or more different parents is a conflict;
 *  - a name used both as a parent and as a child is a conflict.
 * Returns user-facing Hebrew messages (empty when the file is consistent).
 */
export function findFileCategoryConflicts(
  suppliers: Pick<CsvSupplier, "parent_category_name" | "category_name">[],
): string[] {
  const parentNames = new Set<string>();
  const childParents = new Map<string, string[]>(); // child -> parents, in file order
  for (const s of suppliers) {
    if (s.parent_category_name) parentNames.add(s.parent_category_name);
    if (s.parent_category_name && s.category_name) {
      const parents = childParents.get(s.category_name) || [];
      if (!parents.includes(s.parent_category_name)) parents.push(s.parent_category_name);
      childParents.set(s.category_name, parents);
    }
  }

  const errors: string[] = [];
  for (const [child, parents] of childParents) {
    if (parents.length > 1) {
      errors.push(`הקטגוריה "${child}" מופיעה תחת כמה קטגוריות אב (${parents.join(", ")}). כל קטגוריה צריכה שם ייחודי, למשל "${child}-1"`);
    }
  }
  for (const [child, parents] of childParents) {
    if (parentNames.has(child)) {
      errors.push(`השם "${child}" מופיע בקובץ גם כקטגורית אב וגם כקטגוריה (תחת ${parents.join(", ")}). כל קטגוריה צריכה שם ייחודי, למשל "${child}-1"`);
    }
  }
  return errors;
}

export interface ParseSupplierCsvOptions {
  /**
   * Extra header aliases (normalized key -> canonical field) tried after the
   * shared ones. Lets a caller keep legacy aliases without changing the other
   * importer's behaviour.
   */
  extraAliases?: Record<string, string>;
  /** Also try a lower-cased header when looking up aliases (e.g. "Name"). */
  caseInsensitiveHeaders?: boolean;
  /** payment_terms_days when the payment-terms cell is empty. Default 0. */
  defaultPaymentTermsDays?: number;
}

export type ParseSupplierCsvResult =
  | { ok: false; error: string }
  | {
      ok: true;
      suppliers: CsvSupplier[];
      /**
       * Blocking errors (duplicate supplier names, conflicting category
       * names). While non-empty the file must not be imported.
       */
      errors: string[];
      /** Non-blocking warnings (e.g. unrecognised payment methods). */
      warnings: string[];
      /** 1-based file line numbers (header = line 1) of rows skipped for having no name. */
      emptyNameRows: number[];
      parentCategoryCount: number;
      childCategoryCount: number;
    };

/**
 * Parse already-split CSV rows (PapaParse `header: true` output) into suppliers.
 * Pure — no I/O.
 */
export function parseSupplierCsvRows(
  rows: Record<string, string>[],
  detectedFields: string[],
  options: ParseSupplierCsvOptions = {},
): ParseSupplierCsvResult {
  if (rows.length === 0) {
    return { ok: false, error: "הקובץ חייב להכיל לפחות שורת כותרות ושורת נתונים אחת" };
  }

  const extra = options.extraAliases || {};
  const lookup = (header: string): string | undefined => {
    const normalized = normalizeSupplierCsvHeader(header);
    const found = SUPPLIER_CSV_HEADER_ALIASES[normalized] || SUPPLIER_CSV_HEADER_ALIASES[header];
    if (found) return found;
    if (extra[normalized] || extra[header]) return extra[normalized] || extra[header];
    if (options.caseInsensitiveHeaders) {
      const lower = normalized.toLowerCase();
      return SUPPLIER_CSV_HEADER_ALIASES[lower] || extra[lower];
    }
    return undefined;
  };

  // Detect which headers from the CSV file match our known aliases
  const fieldMap: Record<string, string> = {}; // canonical -> actual CSV header
  for (const header of detectedFields) {
    const canonical = lookup(header);
    if (canonical && !fieldMap[canonical]) {
      fieldMap[canonical] = header;
    }
  }

  if (!fieldMap["name"]) {
    return { ok: false, error: `לא נמצאה עמודת "שם הספק" בקובץ. עמודות שנמצאו: ${detectedFields.join(", ")}` };
  }

  const getField = (row: Record<string, string>, canonical: string): string => {
    const header = fieldMap[canonical];
    return header ? (row[header] ?? "").trim() : "";
  };

  const suppliers: CsvSupplier[] = [];
  const emptyNameRows: number[] = [];
  const parentCats = new Set<string>();
  const childCats = new Set<string>();
  const nameRows = new Map<string, number[]>(); // supplier name -> file line numbers
  const categoryRows: Pick<CsvSupplier, "parent_category_name" | "category_name">[] = [];
  const unknownPaymentMethods: string[] = [];
  const defaultPaymentTermsDays = options.defaultPaymentTermsDays ?? 0;

  rows.forEach((row, rowIdx) => {
    const name = getField(row, "name");
    const expenseTypeRaw = getField(row, "expense_type");

    // Skip rows with no name
    if (!name) {
      emptyNameRows.push(rowIdx + 2);
      return;
    }

    // Map expense_type (default to current_expenses if empty)
    let expense_type = "current_expenses";
    if (expenseTypeRaw === "קניות סחורה" || expenseTypeRaw === "goods_purchases" || expenseTypeRaw === "רכש סחורה" || expenseTypeRaw === "סחורה") {
      expense_type = "goods_purchases";
    } else if (expenseTypeRaw === "עלות עובדים" || expenseTypeRaw === "עלויות עובדים" || expenseTypeRaw === "employee_costs") {
      expense_type = "employee_costs";
    }

    // Map requires_vat
    const requiresVatRaw = getField(row, "requires_vat");
    const requires_vat = requiresVatRaw === "כן" || requiresVatRaw === "yes";

    // Map vat_type
    let vat_type: "full" | "none" | "partial" = "none";
    const vatRaw = getField(row, "vat");
    const vatPartialRaw = getField(row, "vat_partial");
    if (vatRaw === "1.18" || vatRaw === "1.17") {
      vat_type = "full";
    } else if (vatPartialRaw && parseFloat(vatPartialRaw) > 0) {
      vat_type = "partial";
    } else if (vatRaw === "1" || vatRaw === "" || vatRaw === "0") {
      vat_type = requires_vat ? "full" : "none";
    }

    // Map is_fixed_expense
    const isFixedRaw = getField(row, "is_fixed").toLowerCase();
    const is_fixed_expense = isFixedRaw === "כן" || isFixedRaw === "yes";

    // Map monthly_expense_amount
    const monthlyRaw = getField(row, "monthly_amount");
    const monthly_expense_amount = monthlyRaw ? parseFloat(monthlyRaw) || null : null;

    // Map charge_day — prefer 'מתי יורד כל חודש?'; fall back to
    // 'יום (מספר)' (Bubble sometimes splits first-charge day into
    // separate month/day columns instead of a single charge-day field).
    const chargeDayRaw = getField(row, "charge_day") || getField(row, "charge_day_fallback");
    let charge_day: number | null = chargeDayRaw ? parseInt(chargeDayRaw) || null : null;
    if (charge_day !== null && (charge_day < 1 || charge_day > 31)) {
      charge_day = null;
    }

    // Map payment_terms_days
    const paymentTermsRaw = getField(row, "payment_terms");
    const payment_terms_days = paymentTermsRaw ? (parseInt(paymentTermsRaw) || 0) : defaultPaymentTermsDays;

    // Map payment method (unknown non-empty values -> null + warning)
    const paymentMethodRaw = getField(row, "payment_method");
    const paymentMethod = mapSupplierCsvPaymentMethod(paymentMethodRaw);
    if (paymentMethod.unknown && !unknownPaymentMethods.includes(paymentMethodRaw)) {
      unknownPaymentMethods.push(paymentMethodRaw);
    }

    // Notes - filter out placeholder text
    let notes = getField(row, "notes");
    if (notes === "אין הערות לספק זה") notes = "";

    // Categories
    const parent_category_name = getField(row, "parent_category");
    const category_name = getField(row, "category");
    if (parent_category_name) parentCats.add(parent_category_name);
    if (category_name) childCats.add(`${parent_category_name}|${category_name}`);
    categoryRows.push({ parent_category_name, category_name });

    // is_active: support both legacy "1=inactive" CSVs and "כן/לא" CSVs
    // Default: active (true) when no column present at all
    const isActiveNumRaw = getField(row, "is_active_num");
    const isActiveTextRaw = getField(row, "is_active_text").toLowerCase();
    let is_active = true;
    if (fieldMap["is_active_num"]) {
      is_active = isActiveNumRaw !== "1";
    } else if (fieldMap["is_active_text"]) {
      is_active = isActiveTextRaw === "כן" || isActiveTextRaw === "yes" || isActiveTextRaw === "true" || isActiveTextRaw === "1";
    }

    // Map has_previous_obligations
    const obligationsRaw = getField(row, "has_obligations");
    const has_previous_obligations = obligationsRaw === "כן" || obligationsRaw === "yes";

    // Map waiting_for_coordinator
    const coordinatorRaw = getField(row, "waiting_for_coordinator");
    const waiting_for_coordinator = coordinatorRaw === "כן" || coordinatorRaw === "yes" || coordinatorRaw === "true" || coordinatorRaw === "1";

    // Duplicate names within the CSV are a blocking error (reported below);
    // keep only the first occurrence in the preview list.
    const seenRows = nameRows.get(name);
    if (seenRows) {
      seenRows.push(rowIdx + 2);
      return;
    }
    nameRows.set(name, [rowIdx + 2]);

    suppliers.push({
      name,
      expense_type,
      contact_name: getField(row, "contact"),
      phone: getField(row, "phone"),
      email: getField(row, "email"),
      tax_id: getField(row, "tax_id"),
      address: getField(row, "address"),
      payment_terms_days,
      notes,
      requires_vat,
      vat_type,
      is_fixed_expense,
      monthly_expense_amount,
      charge_day,
      is_active,
      has_previous_obligations,
      waiting_for_coordinator,
      parent_category_name,
      category_name,
      default_payment_method: paymentMethod.method,
      credit_card_last_four: paymentMethod.lastFour,
    });
  });

  const errors: string[] = [];
  for (const [name, lines] of nameRows) {
    if (lines.length > 1) {
      errors.push(`הספק "${name}" מופיע בקובץ יותר מפעם אחת (שורות ${lines.join(", ")}). כל ספק צריך שם ייחודי`);
    }
  }
  errors.push(...findFileCategoryConflicts(categoryRows));

  const warnings: string[] = [];
  if (unknownPaymentMethods.length > 0) {
    warnings.push(`אמצעי תשלום לא מזוהים - הספקים יישמרו ללא אמצעי תשלום: ${unknownPaymentMethods.map(v => `"${v}"`).join(", ")}`);
  }

  return {
    ok: true,
    suppliers,
    errors,
    warnings,
    emptyNameRows,
    parentCategoryCount: parentCats.size,
    childCategoryCount: childCats.size,
  };
}

/**
 * Parse a supplier CSV file with PapaParse (RFC 4180: quoted fields, escaped
 * quotes, commas inside quotes, auto-detected delimiter, UTF-8 BOM stripped).
 */
export function parseSupplierCsvFile(
  file: File,
  options: ParseSupplierCsvOptions = {},
): Promise<ParseSupplierCsvResult> {
  return new Promise((resolve) => {
    // Use PapaParse for robust RFC 4180 CSV parsing with Hebrew support
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      encoding: "UTF-8",
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      complete: (results) => {
        try {
          resolve(parseSupplierCsvRows(results.data, results.meta.fields || [], options));
        } catch {
          resolve({ ok: false, error: "שגיאה בקריאת הקובץ. ודא שהקובץ בפורמט CSV תקין" });
        }
      },
      error: (err: Error) => {
        resolve({ ok: false, error: `שגיאה בפענוח הקובץ: ${err.message}` });
      },
    });
  });
}

export interface SupplierCategoryMaps {
  parentCatIdMap: Map<string, string>; // parent name -> uuid
  childCatIdMap: Map<string, string>; // "parent|child" -> uuid
}

interface ExistingCategory {
  id: string;
  name: string;
  parent_id: string | null;
}

/**
 * Conflicts between the file's categories and the business's existing
 * (non-deleted) categories. Because a name can exist only once per business,
 * reusing an existing category is safe only when it sits at the same place in
 * the tree: a root for a file parent, a child of the same parent for a file
 * child. Anything else would file suppliers under the wrong parent.
 * Returns one Hebrew description per conflicting category name.
 */
export function findExistingCategoryConflicts(
  suppliers: Pick<CsvSupplier, "parent_category_name" | "category_name">[],
  existingCategories: ExistingCategory[],
): string[] {
  const byName = new Map<string, ExistingCategory>();
  const nameById = new Map<string, string>();
  for (const cat of existingCategories) {
    // Prefer the root record if there are multiples (unlikely due to index).
    if (!byName.has(cat.name) || !cat.parent_id) byName.set(cat.name, cat);
    nameById.set(cat.id, cat.name);
  }
  const parentLabel = (cat: ExistingCategory) => nameById.get(cat.parent_id || "") || "קטגורית אב אחרת";

  const conflicts: string[] = [];
  const seen = new Set<string>();
  const add = (key: string, message: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    conflicts.push(message);
  };

  for (const s of suppliers) {
    const parentName = s.parent_category_name;
    if (!parentName) continue;
    const existingParent = byName.get(parentName);
    if (existingParent?.parent_id) {
      add(`parent|${parentName}`, `"${parentName}" קיימת בעסק כקטגוריה תחת "${parentLabel(existingParent)}", ובקובץ היא קטגורית אב`);
    }

    const childName = s.category_name;
    if (!childName) continue;
    const existingChild = byName.get(childName);
    if (!existingChild) continue;
    if (!existingChild.parent_id) {
      add(`child|${childName}`, `"${childName}" קיימת בעסק כקטגורית אב, ובקובץ היא קטגוריה תחת "${parentName}"`);
    } else if (!existingParent || existingChild.parent_id !== existingParent.id) {
      add(`child|${childName}`, `"${childName}" קיימת בעסק תחת "${parentLabel(existingChild)}", ובקובץ היא תחת "${parentName}"`);
    }
  }
  return conflicts;
}

/**
 * Create (or reuse) the parent and child expense_categories the given
 * suppliers reference, for one business. Must be called after the business row
 * exists.
 *
 * Before inserting anything it refuses (returns `{ error }`) when a file
 * category name conflicts with another file category or with an existing
 * category of the business under a different parent. An existing category is
 * reused only when it has the same parent (or is a root, for a file parent).
 *
 * Returns `{ error }` with a user-facing Hebrew message on the first failure.
 */
export async function ensureSupplierCategories(
  supabase: SupabaseClient,
  businessId: string,
  suppliers: Pick<CsvSupplier, "parent_category_name" | "category_name">[],
): Promise<SupplierCategoryMaps | { error: string }> {
  // Collect unique parent categories
  const parentCategoryNames = new Set<string>();
  const childCategoryPairs = new Set<string>(); // "parent|child"
  for (const s of suppliers) {
    if (s.parent_category_name) {
      parentCategoryNames.add(s.parent_category_name);
    }
    if (s.category_name && s.parent_category_name) {
      childCategoryPairs.add(`${s.parent_category_name}|${s.category_name}`);
    }
  }

  const parentCatIdMap = new Map<string, string>();
  const childCatIdMap = new Map<string, string>();
  if (parentCategoryNames.size === 0) {
    return { parentCatIdMap, childCatIdMap };
  }

  // Same checks as at parse time, in case the caller skipped them.
  const fileConflicts = findFileCategoryConflicts(suppliers);
  if (fileConflicts.length > 0) {
    return { error: `לא ניתן לייבא - ${fileConflicts.join("; ")}` };
  }

  // Fetch existing (non-deleted) categories for this business
  const { data: existingCategories, error: fetchError } = await supabase
    .from("expense_categories")
    .select("id, name, parent_id")
    .eq("business_id", businessId)
    .is("deleted_at", null);
  if (fetchError) {
    return { error: `שגיאה בטעינת הקטגוריות הקיימות של העסק: ${fetchError.message}` };
  }
  const existing = (existingCategories || []) as ExistingCategory[];

  // The unique index is (business_id, name) WHERE deleted_at IS NULL — it
  // does not look at parent_id. Refuse the whole import (nothing inserted yet)
  // rather than silently reusing a same-name category under another parent.
  const existingConflicts = findExistingCategoryConflicts(suppliers, existing);
  if (existingConflicts.length > 0) {
    return {
      error: `לא ניתן לייבא - שמות קטגוריות בקובץ כבר קיימים בעסק תחת קטגורית אב אחרת: ${existingConflicts.join("; ")}. שם קטגוריה יכול להופיע בעסק פעם אחת בלבד - יש לשנות את השם בקובץ (למשל להוסיף "-1" בסוף השם) ולהעלות אותו מחדש`,
    };
  }

  const existingRootMap = new Map<string, string>(); // root name -> id
  const existingChildMap = new Map<string, string>(); // "parentId|childName" -> id
  for (const cat of existing) {
    if (cat.parent_id) {
      existingChildMap.set(`${cat.parent_id}|${cat.name}`, cat.id);
    } else {
      existingRootMap.set(cat.name, cat.id);
    }
  }

  // Create parent categories that don't exist
  for (const parentName of parentCategoryNames) {
    if (existingRootMap.has(parentName)) {
      parentCatIdMap.set(parentName, existingRootMap.get(parentName)!);
      continue;
    }

    const { data, error } = await supabase
      .from("expense_categories")
      .insert({
        business_id: businessId,
        name: parentName,
        parent_id: null,
      })
      .select("id")
      .single();

    if (error) {
      // Duplicate-key race: category was created between our fetch and
      // our insert (either by a parallel import run or by a previous
      // attempt that partially succeeded). Reuse it only if it is a root.
      if (error.code === "23505") {
        const { data: existingRow } = await supabase
          .from("expense_categories")
          .select("id, parent_id")
          .eq("business_id", businessId)
          .eq("name", parentName)
          .is("deleted_at", null)
          .maybeSingle();
        if (existingRow?.id && !existingRow.parent_id) {
          parentCatIdMap.set(parentName, existingRow.id);
          continue;
        }
      }
      return { error: `שגיאה ביצירת קטגוריה "${parentName}": ${error.message}` };
    }
    parentCatIdMap.set(parentName, data.id);
  }

  // Create child categories that don't exist
  for (const pair of childCategoryPairs) {
    const [parentName, childName] = pair.split("|");
    const parentId = parentCatIdMap.get(parentName);
    if (!parentId) continue;

    const existingKey = `${parentId}|${childName}`;
    if (existingChildMap.has(existingKey)) {
      childCatIdMap.set(pair, existingChildMap.get(existingKey)!);
      continue;
    }

    const { data, error } = await supabase
      .from("expense_categories")
      .insert({
        business_id: businessId,
        name: childName,
        parent_id: parentId,
      })
      .select("id")
      .single();

    if (error) {
      // Duplicate-key race: reuse only if the row sits under the same parent.
      if (error.code === "23505") {
        const { data: existingRow } = await supabase
          .from("expense_categories")
          .select("id, parent_id")
          .eq("business_id", businessId)
          .eq("name", childName)
          .is("deleted_at", null)
          .maybeSingle();
        if (existingRow?.id && existingRow.parent_id === parentId) {
          childCatIdMap.set(pair, existingRow.id);
          continue;
        }
      }
      return { error: `שגיאה ביצירת קטגוריה "${childName}": ${error.message}` };
    }
    childCatIdMap.set(pair, data.id);
  }

  return { parentCatIdMap, childCatIdMap };
}

/**
 * Build the `suppliers` insert payload for one parsed CSV supplier.
 * `creditCardIdByLastFour` (see buildCreditCardLastFourMap) links a credit
 * supplier to the business card whose last four digits appear in the file.
 */
export function buildSupplierInsertRecord(
  s: CsvSupplier,
  businessId: string,
  maps: SupplierCategoryMaps,
  creditCardIdByLastFour?: Map<string, string>,
) {
  const parentCatId = s.parent_category_name ? maps.parentCatIdMap.get(s.parent_category_name) || null : null;
  const childCatKey = s.parent_category_name && s.category_name ? `${s.parent_category_name}|${s.category_name}` : null;
  const childCatId = childCatKey ? maps.childCatIdMap.get(childCatKey) || null : null;
  const creditCardId = s.default_payment_method === "credit" && s.credit_card_last_four
    ? creditCardIdByLastFour?.get(s.credit_card_last_four) || null
    : null;

  return {
    business_id: businessId,
    name: s.name,
    expense_type: s.expense_type,
    contact_name: s.contact_name || null,
    phone: s.phone || null,
    email: s.email || null,
    tax_id: s.tax_id || null,
    address: s.address || null,
    payment_terms_days: s.payment_terms_days,
    notes: s.notes || null,
    requires_vat: s.requires_vat,
    vat_type: s.vat_type,
    is_fixed_expense: s.is_fixed_expense,
    monthly_expense_amount: s.monthly_expense_amount,
    charge_day: s.charge_day,
    is_active: s.is_active,
    has_previous_obligations: s.has_previous_obligations,
    waiting_for_coordinator: s.waiting_for_coordinator,
    parent_category_id: parentCatId,
    expense_category_id: childCatId,
    default_payment_method: s.default_payment_method,
    default_credit_card_id: creditCardId,
  };
}
