"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

// ===== Types =====

interface Business {
  id: string;
  name: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  supplier_id: string;
  total_amount: number;
}

/** A single split row (from sub-payments CSV or from main CSV rows that ARE splits) */
interface ParsedSplit {
  payment_method: string;
  amount: number;
  installment_number: number;
  installments_count: number;
  reference_number: string;
  check_number: string;
  due_date: string;
  notes: string;
  credit_card_id: string;
}

/** A merged payment ready for import */
interface MergedPayment {
  supplier_name: string;
  payment_date: string;
  total_amount: number;
  expense_type: string;
  notes: string;
  receipt_url: string;
  splits: ParsedSplit[];
}

// ===== Constants =====

const paymentMethodAliases: Record<string, string> = {
  "העברה בנקאית": "bank_transfer", "העברה": "bank_transfer", "bank_transfer": "bank_transfer",
  "מזומן": "cash", "cash": "cash",
  "צ'ק": "check", "צק": "check", "check": "check", "שיק": "check",
  "ביט": "bit", "bit": "bit",
  "פייבוקס": "paybox", "paybox": "paybox",
  "כרטיס אשראי": "credit_card", "אשראי": "credit_card", "credit_card": "credit_card", "credit": "credit_card",
  "חברות הקפה": "credit_company", "הקפה": "credit_company", "credit_companies": "credit_company", "credit_company": "credit_company",
  "הוראת קבע": "standing_order", "הו\"ק": "standing_order", "הוק": "standing_order", "standing_order": "standing_order",
  "אחר": "other", "other": "other",
};

const paymentMethodNames: Record<string, string> = {
  "bank_transfer": "העברה בנקאית",
  "cash": "מזומן",
  "check": "צ'ק",
  "bit": "ביט",
  "paybox": "פייבוקס",
  "credit_card": "כרטיס אשראי",
  "credit_company": "חברות הקפה",
  "standing_order": "הוראת קבע",
  "other": "אחר",
};

const paymentMethodColors: Record<string, string> = {
  "check": "bg-[#00DD23]/20 text-[#00DD23]",
  "cash": "bg-[#FF0000]/20 text-[#FF0000]",
  "standing_order": "bg-[#3964FF]/20 text-[#3964FF]",
  "credit_company": "bg-[#FFCF00]/20 text-[#FFCF00]",
  "credit_card": "bg-[#FF3665]/20 text-[#FF3665]",
  "bank_transfer": "bg-[#FF7F00]/20 text-[#FF7F00]",
  "bit": "bg-[#9333ea]/20 text-[#9333ea]",
  "paybox": "bg-[#06b6d4]/20 text-[#06b6d4]",
  "other": "bg-white/10 text-white/60",
};

// ===== Helpers =====

function parseDate(raw: string): string | null {
  if (!raw) return null;
  // Strip time part like "22:12" or "00:00"
  const dateOnly = raw.replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, "").trim();
  const ddmmyyyy = dateOnly.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  const yyyymmdd = dateOnly.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (ddmmyyyy) {
    return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
  } else if (yyyymmdd) {
    return `${yyyymmdd[1]}-${yyyymmdd[2].padStart(2, "0")}-${yyyymmdd[3].padStart(2, "0")}`;
  }
  return null;
}

function parseAmount(val: string): number {
  if (!val) return 0;
  const cleaned = val.replace(/[₪$€,\s]/g, "");
  return parseFloat(cleaned) || 0;
}

function resolveMethod(raw: string): string {
  if (!raw) return "other";
  return paymentMethodAliases[raw] || paymentMethodAliases[raw.toLowerCase()] || "other";
}

function makeFieldGetter(
  fields: string[],
  aliases: Record<string, string>
): (row: Record<string, string>, canonical: string) => string {
  const fieldMap: Record<string, string> = {};
  for (const header of fields) {
    const canonical = aliases[header];
    if (canonical && !fieldMap[canonical]) {
      fieldMap[canonical] = header;
    }
  }
  return (row, canonical) => {
    const header = fieldMap[canonical];
    return header ? (row[header] ?? "").trim() : "";
  };
}

// ===== Component =====

export default function AdminPaymentsPage() {
  const supabase = createClient();
  const { showToast } = useToast();

  // Business selection
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState<string>("admin-payments:businessId", "");
  const [isLoadingBusinesses, setIsLoadingBusinesses] = useState(true);

  // Suppliers & invoices
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  // CSV files state
  const [mainFileName, setMainFileName] = useState<string | null>(null);
  const [subsFileName, setSubsFileName] = useState<string | null>(null);
  const mainInputRef = useRef<HTMLInputElement>(null);
  const subsInputRef = useRef<HTMLInputElement>(null);

  // Parsed raw data from CSVs
  const [mainRows, setMainRows] = useState<Record<string, string>[]>([]);
  const [subsRows, setSubsRows] = useState<Record<string, string>[]>([]);
  const [mainFields, setMainFields] = useState<string[]>([]);
  const [subsFields, setSubsFields] = useState<string[]>([]);

  // Merged payments ready for import
  const [mergedPayments, setMergedPayments] = useState<MergedPayment[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parsingDone, setParsingDone] = useState(false);

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");

  // Unmatched suppliers
  const [unmatchedSuppliers, setUnmatchedSuppliers] = useState<string[]>([]);

  // ===== Data fetching =====

  useEffect(() => {
    async function fetchBusinesses() {
      const { data, error } = await supabase
        .from("businesses")
        .select("id, name")
        .order("name");
      if (!error && data) setBusinesses(data);
      setIsLoadingBusinesses(false);
    }
    fetchBusinesses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedBusinessId) {
      setSuppliers([]);
      setInvoices([]);
      return;
    }
    async function fetchData() {
      setIsLoadingSuppliers(true);
      const [suppliersRes, invoicesRes] = await Promise.all([
        supabase
          .from("suppliers")
          .select("id, name")
          .eq("business_id", selectedBusinessId)
          .is("deleted_at", null)
          .order("name"),
        supabase
          .from("invoices")
          .select("id, invoice_number, supplier_id, total_amount")
          .eq("business_id", selectedBusinessId)
          .is("deleted_at", null)
          .not("invoice_number", "is", null),
      ]);
      if (suppliersRes.data) setSuppliers(suppliersRes.data);
      if (invoicesRes.data) setInvoices(invoicesRes.data);
      setIsLoadingSuppliers(false);
    }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId]);

  const findSupplierByName = useCallback((name: string): Supplier | undefined => {
    const normalized = name.trim().toLowerCase();
    return suppliers.find(s => s.name.toLowerCase() === normalized);
  }, [suppliers]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const findInvoice = useCallback((supplierName: string, invoiceNumber: string): Invoice | undefined => {
    if (!invoiceNumber) return undefined;
    const supplier = findSupplierByName(supplierName);
    if (!supplier) return undefined;
    return invoices.find(
      inv => inv.supplier_id === supplier.id && inv.invoice_number === invoiceNumber
    );
  }, [findSupplierByName, invoices]);

  // ===== Header aliases for main CSV =====
  const mainHeaderAliases: Record<string, string> = {
    "Supplier name": "supplier_name", "שם ספק": "supplier_name", "ספק": "supplier_name",
    "שם העסק": "business_name", "Business name": "business_name", "עסק": "business_name",
    "unique id": "unique_id",
    "תאריך התשלום": "payment_date", "תאריך תשלום": "payment_date",
    "תאריך קבלה": "received_date",
    "סוג הוצאה": "expense_type", "סוג הוצאות": "expense_type",
    "סוג אמצעי תשלום": "payment_method",
    "סכום לכל תשלום אחרי מע\"מ)": "split_amount", "סכום לכל תשלום אחרי מע\"מ": "split_amount",
    "כמות תשלומים": "installments_count",
    "מספר תשלום": "installment_number",
    "מס' צ'ק": "check_number", "מספר צק": "check_number",
    "אסמכתא": "reference_number", "מספר אסמכתא": "reference_number",
    "הערות": "notes",
    "כל התמונות": "images",
    "שולם": "is_paid",
  };

  // ===== Header aliases for sub-payments CSV =====
  const subsHeaderAliases: Record<string, string> = {
    "ספק": "supplier_name", "Supplier name": "supplier_name",
    "עסק": "business_name", "Business name": "business_name",
    "תשלום ראשי": "parent_id",
    "תאריך תשלום": "payment_date",
    "סוג אמצעי תשלום": "payment_method",
    "סכום תשלום אחרי מע\"מ": "amount", "סכום תשלום אחרי מע\"מ)": "amount",
    "מספר תשלום": "installment_number",
    "מספר אסמכתא": "reference_number",
    "מספר צ'ק": "check_number", "מספר צק": "check_number",
    "כרטיס אשראי (אם יש)": "credit_card_id",
    "בנק": "bank",
    "הערות": "notes",
  };

  // ===== CSV upload handlers =====

  const handleMainUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMainFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      encoding: "UTF-8",
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
      complete: (results) => {
        setMainRows(results.data);
        setMainFields(results.meta.fields || []);
      },
      error: () => showToast("שגיאה בקריאת קובץ תשלומים ראשיים", "error"),
    });
  };

  const handleSubsUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubsFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      encoding: "UTF-8",
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
      complete: (results) => {
        setSubsRows(results.data);
        setSubsFields(results.meta.fields || []);
      },
      error: () => showToast("שגיאה בקריאת קובץ תשלומי משנה", "error"),
    });
  };

  // ===== Merge & process =====

  const handleProcess = useCallback(() => {
    const errors: string[] = [];
    const unmatchedSet = new Set<string>();

    const getMain = makeFieldGetter(mainFields, mainHeaderAliases);
    const getSubs = makeFieldGetter(subsFields, subsHeaderAliases);

    // Step 1: Parse main CSV rows, group by unique_id
    // Some rows in main have split info (installments), some don't
    // We need to figure out which unique_ids have sub-payments in the subs CSV

    // Build a set of unique_ids that have sub-payments
    const subsParentIds = new Set<string>();
    for (const row of subsRows) {
      const parentId = getSubs(row, "parent_id");
      if (parentId) subsParentIds.add(parentId);
    }

    // Group main rows by unique_id
    // Some unique_ids appear multiple times (they are installment rows in the main table)
    const mainByUniqueId = new Map<string, Record<string, string>[]>();
    for (const row of mainRows) {
      const uid = getMain(row, "unique_id");
      if (!uid) continue;
      const existing = mainByUniqueId.get(uid) || [];
      existing.push(row);
      mainByUniqueId.set(uid, existing);
    }

    // Deduplicate: group main rows that share the same image+supplier+expense_type
    // These are installment rows from the main CSV that belong to the same "logical payment"
    // We detect this by: same supplier + same images URL + same reference_number + has installments_count
    const mainGrouped = new Map<string, { rows: Record<string, string>[]; uniqueIds: string[] }>();

    for (const [uid, rows] of mainByUniqueId) {
      const firstRow = rows[0];
      const supplierName = getMain(firstRow, "supplier_name");
      const images = getMain(firstRow, "images");
      const refNum = getMain(firstRow, "reference_number");
      const installmentsCount = getMain(firstRow, "installments_count");

      // If this uid has sub-payments in subs CSV, it's a standalone parent
      if (subsParentIds.has(uid)) {
        mainGrouped.set(uid, { rows, uniqueIds: [uid] });
        continue;
      }

      // If it has installments and images, try to group with siblings
      if (installmentsCount && parseInt(installmentsCount) > 1 && images) {
        const groupKey = `${supplierName}||${images}||${refNum}`;
        const existing = mainGrouped.get(groupKey);
        if (existing) {
          existing.rows.push(...rows);
          existing.uniqueIds.push(uid);
        } else {
          mainGrouped.set(groupKey, { rows: [...rows], uniqueIds: [uid] });
        }
      } else {
        mainGrouped.set(uid, { rows, uniqueIds: [uid] });
      }
    }

    const payments: MergedPayment[] = [];

    // Step 2: Process each group from main CSV
    for (const [, group] of mainGrouped) {
      const firstRow = group.rows[0];
      const supplierName = getMain(firstRow, "supplier_name");
      if (!supplierName) continue;

      const receivedDate = getMain(firstRow, "received_date");
      const paymentDateRaw = getMain(firstRow, "payment_date") || receivedDate;
      const expenseType = getMain(firstRow, "expense_type");
      const notes = getMain(firstRow, "notes");
      const images = getMain(firstRow, "images");

      // Check if any of this group's unique_ids have sub-payments
      const hasSubPayments = group.uniqueIds.some(uid => subsParentIds.has(uid));

      if (hasSubPayments) {
        // This payment's splits come from the subs CSV
        const parentUid = group.uniqueIds.find(uid => subsParentIds.has(uid))!;
        const subRows = subsRows.filter(r => getSubs(r, "parent_id") === parentUid);

        const splits: ParsedSplit[] = [];
        for (const subRow of subRows) {
          const method = resolveMethod(getSubs(subRow, "payment_method"));
          const amount = parseAmount(getSubs(subRow, "amount"));
          const dueDate = parseDate(getSubs(subRow, "payment_date"));
          const installmentNumber = parseInt(getSubs(subRow, "installment_number")) || 1;

          if (amount <= 0) continue;

          splits.push({
            payment_method: method,
            amount,
            installment_number: installmentNumber,
            installments_count: subRows.length,
            reference_number: getSubs(subRow, "reference_number"),
            check_number: getSubs(subRow, "check_number"),
            due_date: dueDate || "",
            notes: getSubs(subRow, "notes"),
            credit_card_id: getSubs(subRow, "credit_card_id"),
          });
        }

        if (splits.length === 0) continue;

        const totalAmount = splits.reduce((sum, s) => sum + s.amount, 0);
        // Use earliest due_date as payment_date
        const earliestDate = splits
          .map(s => s.due_date)
          .filter(Boolean)
          .sort()[0] || parseDate(paymentDateRaw) || "";

        if (!earliestDate) {
          errors.push(`ספק "${supplierName}": תאריך תשלום חסר - דילוג`);
          continue;
        }

        if (!findSupplierByName(supplierName)) unmatchedSet.add(supplierName);

        payments.push({
          supplier_name: supplierName,
          payment_date: earliestDate,
          total_amount: totalAmount,
          expense_type: expenseType,
          notes,
          receipt_url: images,
          splits,
        });
      } else {
        // No sub-payments - splits come from main rows themselves
        const hasInstallments = group.rows.length > 1 || (getMain(firstRow, "installments_count") && parseInt(getMain(firstRow, "installments_count")) > 1);

        if (hasInstallments && group.rows.length > 1) {
          // Multiple installment rows in main CSV = one payment with multiple splits
          const splits: ParsedSplit[] = [];
          for (const row of group.rows) {
            const method = resolveMethod(getMain(row, "payment_method"));
            const amount = parseAmount(getMain(row, "split_amount"));
            const dueDate = parseDate(getMain(row, "payment_date"));
            const installmentNumber = parseInt(getMain(row, "installment_number")) || 1;
            const installmentsCount = parseInt(getMain(row, "installments_count")) || group.rows.length;

            if (amount <= 0) continue;

            splits.push({
              payment_method: method,
              amount,
              installment_number: installmentNumber,
              installments_count: installmentsCount,
              reference_number: getMain(row, "reference_number"),
              check_number: getMain(row, "check_number"),
              due_date: dueDate || "",
              notes: getMain(row, "notes"),
              credit_card_id: "",
            });
          }

          if (splits.length === 0) continue;

          const totalAmount = splits.reduce((sum, s) => sum + s.amount, 0);
          const earliestDate = splits.map(s => s.due_date).filter(Boolean).sort()[0] || "";

          if (!earliestDate) {
            errors.push(`ספק "${supplierName}": תאריך תשלום חסר - דילוג`);
            continue;
          }

          if (!findSupplierByName(supplierName)) unmatchedSet.add(supplierName);

          payments.push({
            supplier_name: supplierName,
            payment_date: earliestDate,
            total_amount: totalAmount,
            expense_type: expenseType,
            notes,
            receipt_url: images,
            splits,
          });
        } else {
          // Single payment row - check if it has sub-payments from subs CSV (standalone subs)
          // Or it's just a simple payment
          const uid = group.uniqueIds[0];

          // Check for standalone sub-payment rows (no parent_id) matching this
          // For rows without sub-payments, create a single split

          const method = resolveMethod(getMain(firstRow, "payment_method"));
          const splitAmount = parseAmount(getMain(firstRow, "split_amount"));

          // Standalone subs for this supplier (no parent) are handled in Step 3 below.
          const payDate = parseDate(paymentDateRaw);
          if (!payDate) {
            errors.push(`ספק "${supplierName}" (${uid}): תאריך תשלום חסר - דילוג`);
            continue;
          }

          if (!findSupplierByName(supplierName)) unmatchedSet.add(supplierName);

          if (splitAmount > 0 && method !== "other") {
            // Main row has split info
            payments.push({
              supplier_name: supplierName,
              payment_date: payDate,
              total_amount: splitAmount,
              expense_type: expenseType,
              notes,
              receipt_url: images,
              splits: [{
                payment_method: method,
                amount: splitAmount,
                installment_number: parseInt(getMain(firstRow, "installment_number")) || 1,
                installments_count: parseInt(getMain(firstRow, "installments_count")) || 1,
                reference_number: getMain(firstRow, "reference_number"),
                check_number: getMain(firstRow, "check_number"),
                due_date: payDate,
                notes: "",
                credit_card_id: "",
              }],
            });
          } else {
            // Main row without split info - will get splits from subs CSV or be a bare payment
            payments.push({
              supplier_name: supplierName,
              payment_date: payDate,
              total_amount: 0, // will be calculated from subs or set below
              expense_type: expenseType,
              notes,
              receipt_url: images,
              splits: [],
            });
          }
        }
      }
    }

    // Step 3: Process sub-payment rows WITHOUT a parent_id (standalone sub-payments)
    // Group them by supplier + payment_date to create payments
    const standaloneSubRows = subsRows.filter(r => !getSubs(r, "parent_id"));

    // Also check which standalone subs are already covered by main rows
    // We'll group standalone subs by supplier_name
    const standaloneBySup = new Map<string, Record<string, string>[]>();
    for (const row of standaloneSubRows) {
      const sup = getSubs(row, "supplier_name");
      if (!sup) continue;
      const existing = standaloneBySup.get(sup) || [];
      existing.push(row);
      standaloneBySup.set(sup, existing);
    }

    // For each supplier with standalone subs, check if there's a matching "bare" payment
    // (payment with no splits yet). If yes, attach. If no, create new.
    for (const [supName, rows] of standaloneBySup) {
      // Find bare payments for this supplier (total_amount = 0, no splits)
      const barePaymentIdx = payments.findIndex(
        p => p.supplier_name === supName && p.splits.length === 0 && p.total_amount === 0
      );

      // Group these sub rows - each row is potentially a separate split
      // But some might be installments of the same payment method
      // Group by: supplier + same set of rows = one payment with multiple splits
      const splits: ParsedSplit[] = [];
      for (const row of rows) {
        const method = resolveMethod(getSubs(row, "payment_method"));
        const amount = parseAmount(getSubs(row, "amount"));
        const dueDate = parseDate(getSubs(row, "payment_date"));
        const installmentNumber = parseInt(getSubs(row, "installment_number")) || 1;

        if (amount <= 0) continue;

        splits.push({
          payment_method: method,
          amount,
          installment_number: installmentNumber,
          installments_count: rows.length,
          reference_number: getSubs(row, "reference_number"),
          check_number: getSubs(row, "check_number"),
          due_date: dueDate || "",
          notes: getSubs(row, "notes"),
          credit_card_id: getSubs(row, "credit_card_id"),
        });
      }

      if (splits.length === 0) continue;

      const totalAmount = splits.reduce((sum, s) => sum + s.amount, 0);
      const earliestDate = splits.map(s => s.due_date).filter(Boolean).sort()[0] || "";

      if (barePaymentIdx >= 0) {
        // Attach splits to existing bare payment
        payments[barePaymentIdx].splits = splits;
        payments[barePaymentIdx].total_amount = totalAmount;
        if (!payments[barePaymentIdx].payment_date && earliestDate) {
          payments[barePaymentIdx].payment_date = earliestDate;
        }
      } else {
        // Create new payment
        if (!findSupplierByName(supName)) unmatchedSet.add(supName);

        if (!earliestDate) {
          errors.push(`ספק "${supName}" (תשלום משנה): תאריך תשלום חסר - דילוג`);
          continue;
        }

        payments.push({
          supplier_name: supName,
          payment_date: earliestDate,
          total_amount: totalAmount,
          expense_type: "",
          notes: "",
          receipt_url: "",
          splits,
        });
      }
    }

    // Step 4: Remove bare payments that still have no splits and no amount
    const finalPayments = payments.filter(p => p.splits.length > 0 || p.total_amount > 0);

    // For payments with splits but total_amount still 0, calculate it
    for (const p of finalPayments) {
      if (p.total_amount <= 0 && p.splits.length > 0) {
        p.total_amount = p.splits.reduce((sum, s) => sum + s.amount, 0);
      }
      // For payments with total_amount but no splits, create a default split
      if (p.splits.length === 0 && p.total_amount > 0) {
        p.splits.push({
          payment_method: "other",
          amount: p.total_amount,
          installment_number: 1,
          installments_count: 1,
          reference_number: "",
          check_number: "",
          due_date: p.payment_date,
          notes: "",
          credit_card_id: "",
        });
      }
    }

    setMergedPayments(finalPayments);
    setParseErrors(errors);
    setUnmatchedSuppliers(Array.from(unmatchedSet));
    setParsingDone(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainRows, subsRows, mainFields, subsFields, findSupplierByName]);

  // ===== Clear =====

  const handleClear = () => {
    setMainFileName(null);
    setSubsFileName(null);
    setMainRows([]);
    setSubsRows([]);
    setMainFields([]);
    setSubsFields([]);
    setMergedPayments([]);
    setParseErrors([]);
    setParsingDone(false);
    setUnmatchedSuppliers([]);
    setImportProgress("");
    if (mainInputRef.current) mainInputRef.current.value = "";
    if (subsInputRef.current) subsInputRef.current.value = "";
  };

  // ===== Remove single payment =====

  const handleRemovePayment = (index: number) => {
    setMergedPayments(mergedPayments.filter((_, i) => i !== index));
  };

  // ===== Import =====

  const handleImport = async () => {
    if (!selectedBusinessId) {
      showToast("יש לבחור עסק לפני הייבוא", "error");
      return;
    }
    if (mergedPayments.length === 0) {
      showToast("אין תשלומים לייבוא", "error");
      return;
    }
    if (unmatchedSuppliers.length > 0) {
      showToast(`יש ${unmatchedSuppliers.length} ספקים שלא נמצאו בעסק. יש לייבא ספקים קודם.`, "error");
      return;
    }

    setIsImporting(true);
    setImportProgress("מכין רשומות...");

    try {
      const { data: { user } } = await supabase.auth.getUser();

      let inserted = 0;
      let skipped = 0;

      for (const payment of mergedPayments) {
        const supplier = findSupplierByName(payment.supplier_name);
        if (!supplier) {
          skipped++;
          continue;
        }

        setImportProgress(`מייבא... ${inserted + 1}/${mergedPayments.length} - ${payment.supplier_name}`);

        // Insert payment
        const { data: paymentData, error: paymentError } = await supabase
          .from("payments")
          .insert({
            business_id: selectedBusinessId,
            supplier_id: supplier.id,
            payment_date: payment.payment_date,
            total_amount: payment.total_amount,
            notes: payment.notes || null,
            created_by: user?.id || null,
            receipt_url: payment.receipt_url || null,
          })
          .select("id")
          .single();

        if (paymentError) {
          showToast(`שגיאה בייבוא תשלום לספק "${payment.supplier_name}": ${paymentError.message}`, "error");
          setIsImporting(false);
          setImportProgress("");
          return;
        }

        // Insert splits
        for (const split of payment.splits) {
          const splitRecord: Record<string, unknown> = {
            payment_id: paymentData.id,
            payment_method: split.payment_method,
            amount: split.amount,
            installments_count: split.installments_count,
            installment_number: split.installment_number,
          };

          if (split.due_date) splitRecord.due_date = split.due_date;
          if (split.reference_number) splitRecord.reference_number = split.reference_number;
          if (split.check_number) splitRecord.check_number = split.check_number;
          // credit_card_id must be a valid UUID (FK to business_credit_cards)
          if (split.credit_card_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(split.credit_card_id)) {
            splitRecord.credit_card_id = split.credit_card_id;
          }

          const { error: splitError } = await supabase
            .from("payment_splits")
            .insert(splitRecord);

          if (splitError) {
            showToast(`שגיאה ביצירת פיצול תשלום: ${splitError.message}`, "error");
            setIsImporting(false);
            setImportProgress("");
            return;
          }
        }

        inserted++;
      }

      const msg = skipped > 0
        ? `יובאו ${inserted} תשלומים בהצלחה (${skipped} דולגו)`
        : `יובאו ${inserted} תשלומים בהצלחה`;
      showToast(msg, "success");
      handleClear();
    } catch {
      showToast("שגיאה בלתי צפויה בייבוא", "error");
    } finally {
      setIsImporting(false);
      setImportProgress("");
    }
  };

  // ===== Stats =====

  const totalSum = mergedPayments.reduce((acc, p) => acc + p.total_amount, 0);
  const matchedCount = mergedPayments.filter(p => findSupplierByName(p.supplier_name)).length;
  const totalSplits = mergedPayments.reduce((acc, p) => acc + p.splits.length, 0);

  // Method breakdown
  const methodCounts = new Map<string, { count: number; sum: number }>();
  for (const p of mergedPayments) {
    for (const s of p.splits) {
      const existing = methodCounts.get(s.payment_method) || { count: 0, sum: 0 };
      methodCounts.set(s.payment_method, { count: existing.count + 1, sum: existing.sum + s.amount });
    }
  }

  // ===== File upload icon SVG =====
  const fileIcon = (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-[#979797]">
      <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 18V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M9 15L12 12L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  const checkIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#3CD856]">
      <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  return (
    <div className="min-h-screen bg-[#0F1535] p-4 md:p-8" dir="rtl">
      <div className="max-w-[700px] mx-auto flex flex-col gap-[20px]">
        {/* Page Title */}
        <div className="text-center">
          <h1 className="text-[22px] font-bold text-white">ייבוא תשלומים מתקדם</h1>
          <p className="text-[14px] text-white/50 mt-1">
            העלה 2 קבצי CSV - תשלומים ראשיים + תשלומי משנה
          </p>
        </div>

        {/* Business Selector */}
        <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">בחר עסק</h3>
          {isLoadingBusinesses ? (
            <div className="flex items-center justify-center py-4">
              <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </div>
          ) : (
            <Select value={selectedBusinessId || "__none__"} onValueChange={(val) => { setSelectedBusinessId(val === "__none__" ? "" : val); handleClear(); }}>
              <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                <SelectValue placeholder="-- בחר עסק --" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">-- בחר עסק --</SelectItem>
                {businesses.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedBusinessId && (
            <div className="mt-[8px] flex items-center gap-[6px]">
              {isLoadingSuppliers ? (
                <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
              ) : (
                <span className="text-[12px] text-white/40">
                  {suppliers.length} ספקים רשומים בעסק
                </span>
              )}
            </div>
          )}
        </div>

        {/* Dual CSV Upload */}
        {!parsingDone ? (
          <div className="flex flex-col gap-[15px]">
            {/* Main Payments CSV */}
            <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
              <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">
                1. קובץ תשלומים ראשיים
              </h3>
              {mainFileName ? (
                <div className="flex items-center justify-between bg-[#0F1535] rounded-[10px] p-[10px]">
                  <div className="flex items-center gap-[8px]">
                    {checkIcon}
                    <span className="text-[14px] text-white">{mainFileName}</span>
                    <span className="text-[12px] text-white/40">({mainRows.length} שורות)</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setMainFileName(null);
                      setMainRows([]);
                      setMainFields([]);
                      if (mainInputRef.current) mainInputRef.current.value = "";
                    }}
                    className="text-[#F64E60] text-[13px] hover:underline"
                  >
                    הסר
                  </Button>
                </div>
              ) : (
                <label className="border border-[#4C526B] border-dashed rounded-[10px] min-h-[100px] px-[10px] py-[15px] flex flex-col items-center justify-center gap-[6px] cursor-pointer hover:border-[#4956D4] transition-colors">
                  {fileIcon}
                  <span className="text-[14px] text-[#979797]">העלה קובץ תשלומים ראשיים</span>
                  <span className="text-[11px] text-[#979797]/60">
                    עמודות: ספק, unique id, תאריך, סכום, סוג הוצאה, אמצעי תשלום...
                  </span>
                  <input
                    ref={mainInputRef}
                    type="file"
                    onChange={handleMainUpload}
                    className="hidden"
                    accept=".csv,text/csv"
                    disabled={!selectedBusinessId}
                  />
                </label>
              )}
            </div>

            {/* Sub Payments CSV */}
            <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
              <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">
                2. קובץ תשלומי משנה
              </h3>
              {subsFileName ? (
                <div className="flex items-center justify-between bg-[#0F1535] rounded-[10px] p-[10px]">
                  <div className="flex items-center gap-[8px]">
                    {checkIcon}
                    <span className="text-[14px] text-white">{subsFileName}</span>
                    <span className="text-[12px] text-white/40">({subsRows.length} שורות)</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSubsFileName(null);
                      setSubsRows([]);
                      setSubsFields([]);
                      if (subsInputRef.current) subsInputRef.current.value = "";
                    }}
                    className="text-[#F64E60] text-[13px] hover:underline"
                  >
                    הסר
                  </Button>
                </div>
              ) : (
                <label className="border border-[#4C526B] border-dashed rounded-[10px] min-h-[100px] px-[10px] py-[15px] flex flex-col items-center justify-center gap-[6px] cursor-pointer hover:border-[#4956D4] transition-colors">
                  {fileIcon}
                  <span className="text-[14px] text-[#979797]">העלה קובץ תשלומי משנה</span>
                  <span className="text-[11px] text-[#979797]/60">
                    {`עמודות: ספק, תשלום ראשי, תאריך, סכום, אמצעי תשלום, מספר תשלום...`}
                  </span>
                  <input
                    ref={subsInputRef}
                    type="file"
                    onChange={handleSubsUpload}
                    className="hidden"
                    accept=".csv,text/csv"
                    disabled={!selectedBusinessId}
                  />
                </label>
              )}
            </div>

            {!selectedBusinessId && (
              <p className="text-[12px] text-[#FFA412] text-right">
                יש לבחור עסק לפני העלאת קבצים
              </p>
            )}

            {/* Process Button */}
            {mainRows.length > 0 && (
              <Button
                type="button"
                variant="default"
                onClick={handleProcess}
                className="w-full bg-[#3CD856] hover:bg-[#2fb848] text-[#0F1535] text-[16px] font-bold py-[12px] rounded-[12px] transition-colors"
              >
                {`עבד ומזג ${mainRows.length} תשלומים`}
                {subsRows.length > 0 && ` + ${subsRows.length} תשלומי משנה`}
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Files summary & clear */}
            <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
              <div className="flex items-center justify-between mb-[10px]">
                <h3 className="text-[16px] font-bold text-white">קבצים שנטענו</h3>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClear}
                  className="text-[#F64E60] text-[13px] hover:underline"
                >
                  נקה הכל
                </Button>
              </div>
              <div className="flex flex-col gap-[6px]">
                {mainFileName && (
                  <div className="flex items-center gap-[8px]">
                    {checkIcon}
                    <span className="text-[13px] text-white">{mainFileName}</span>
                    <span className="text-[11px] text-white/40">({mainRows.length} שורות)</span>
                  </div>
                )}
                {subsFileName && (
                  <div className="flex items-center gap-[8px]">
                    {checkIcon}
                    <span className="text-[13px] text-white">{subsFileName}</span>
                    <span className="text-[11px] text-white/40">({subsRows.length} שורות)</span>
                  </div>
                )}
              </div>
            </div>

            {/* Parse Errors */}
            {parseErrors.length > 0 && (
              <div className="bg-[#FFA412]/10 border border-[#FFA412]/30 rounded-[10px] p-[10px]">
                <p className="text-[13px] text-[#FFA412] text-right whitespace-pre-line">
                  {parseErrors.join("\n")}
                </p>
              </div>
            )}

            {/* Summary Stats */}
            <div className="bg-[#0F1535] rounded-[15px] p-[15px]">
              <div className="flex items-center justify-between mb-[8px]">
                <span className="text-[14px] text-white">תשלומים מוכנים לייבוא</span>
                <span className="text-[16px] font-bold text-[#3CD856]">{mergedPayments.length}</span>
              </div>
              <div className="flex flex-wrap gap-[8px] justify-start">
                <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#3CD856]/20 text-[#3CD856]">
                  ספקים מותאמים: {matchedCount}/{mergedPayments.length}
                </span>
                {unmatchedSuppliers.length > 0 && (
                  <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#F64E60]/20 text-[#F64E60]">
                    ספקים לא נמצאו: {unmatchedSuppliers.length}
                  </span>
                )}
                <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#8B93FF]/20 text-[#8B93FF]">
                  {`סה"כ פיצולים: ${totalSplits}`}
                </span>
              </div>
              <div className="flex flex-wrap gap-[8px] justify-start mt-[6px]">
                <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#FFA412]/20 text-[#FFA412]">
                  {`סה"כ תשלומים: ₪${totalSum.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
                </span>
              </div>
              {/* Method breakdown */}
              {methodCounts.size > 0 && (
                <div className="flex flex-wrap gap-[8px] justify-start mt-[6px]">
                  {Array.from(methodCounts.entries()).map(([method, { count, sum }]) => (
                    <span key={method} className={`text-[11px] px-[6px] py-[2px] rounded ${paymentMethodColors[method] || paymentMethodColors.other}`}>
                      {paymentMethodNames[method] || method}: {count} ({`₪${sum.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`})
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Unmatched suppliers warning */}
            {unmatchedSuppliers.length > 0 && (
              <div className="bg-[#F64E60]/10 border border-[#F64E60]/30 rounded-[10px] p-[10px]">
                <p className="text-[13px] text-[#F64E60] text-right font-bold mb-[6px]">
                  ספקים שלא נמצאו בעסק ({unmatchedSuppliers.length}):
                </p>
                <div className="flex flex-wrap gap-[6px]">
                  {unmatchedSuppliers.map((name) => (
                    <span key={`unmatched-${name}`} className="text-[11px] px-[6px] py-[2px] rounded bg-[#F64E60]/20 text-[#F64E60]">
                      {name}
                    </span>
                  ))}
                </div>
                <p className="text-[12px] text-white/40 text-right mt-[6px]">
                  {`יש לייבא את הספקים האלו דרך "ייבוא ספקים" לפני ייבוא התשלומים`}
                </p>
              </div>
            )}

            {/* Payments Preview */}
            {mergedPayments.length > 0 && (
              <div className="bg-[#0F1535] rounded-[15px] p-[15px]">
                <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">
                  תשלומים ({mergedPayments.length})
                </h3>
                <div className="flex flex-col gap-[8px] max-h-[500px] overflow-y-auto">
                  {mergedPayments.map((payment, index) => {
                    const supplierMatched = !!findSupplierByName(payment.supplier_name);
                    const uniqueMethods = [...new Set(payment.splits.map(s => s.payment_method))];
                    return (
                      <div key={`payment-${payment.supplier_name}-${payment.payment_date}-${index}`} className={`rounded-[10px] p-[10px] ${
                        !supplierMatched
                          ? "bg-[#F64E60]/5 border border-[#F64E60]/20"
                          : "bg-[#4956D4]/10 border border-[#4956D4]/30"
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex-1 text-right">
                            <div className="flex items-center gap-[6px] justify-start flex-wrap">
                              {!supplierMatched && (
                                <span className="text-[10px] px-[4px] py-[1px] rounded bg-[#F64E60]/20 text-[#F64E60]">
                                  ספק לא נמצא
                                </span>
                              )}
                              {uniqueMethods.map(m => (
                                <span key={m} className={`text-[10px] px-[4px] py-[1px] rounded ${paymentMethodColors[m] || paymentMethodColors.other}`}>
                                  {paymentMethodNames[m] || "אחר"}
                                </span>
                              ))}
                              <span className="text-[14px] text-white font-medium">{payment.supplier_name}</span>
                            </div>
                            <div className="flex items-center gap-[10px] justify-start mt-[3px] flex-wrap">
                              <span className="text-[10px] text-white/30">{payment.payment_date}</span>
                              <span className="text-[11px] text-[#FFA412] font-medium">
                                {`₪${payment.total_amount.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
                              </span>
                              <span className="text-[10px] text-white/30">
                                {payment.splits.length} {payment.splits.length === 1 ? "תשלום" : "תשלומים"}
                              </span>
                              {payment.expense_type && (
                                <span className="text-[10px] text-white/20">{payment.expense_type}</span>
                              )}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleRemovePayment(index)}
                            className="text-[#F64E60] hover:text-[#ff6b7a] flex-shrink-0 mr-[10px]"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                          </Button>
                        </div>
                        {/* Show splits if more than 1 */}
                        {payment.splits.length > 1 && (
                          <div className="mt-[6px] mr-[10px] flex flex-col gap-[3px]">
                            {payment.splits
                              .sort((a, b) => a.installment_number - b.installment_number)
                              .map((split, si) => (
                              <div key={si} className="flex items-center gap-[8px] justify-start text-[10px] text-white/40">
                                <span>#{split.installment_number}</span>
                                <span className={`px-[3px] py-[0.5px] rounded ${paymentMethodColors[split.payment_method] || paymentMethodColors.other}`}>
                                  {paymentMethodNames[split.payment_method] || "אחר"}
                                </span>
                                <span>{`₪${split.amount.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}</span>
                                {split.due_date && <span>{split.due_date}</span>}
                                {split.check_number && <span>{`צ'ק #${split.check_number}`}</span>}
                                {split.reference_number && <span>אסמכתא: {split.reference_number}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* No payments */}
            {mergedPayments.length === 0 && (
              <div className="bg-[#FFA412]/10 border border-[#FFA412]/30 rounded-[10px] p-[12px]">
                <p className="text-[13px] text-[#FFA412] text-right">
                  לא נמצאו תשלומים לייבוא. בדוק את מבנה הקבצים.
                </p>
              </div>
            )}

            {/* Import Button */}
            {mergedPayments.length > 0 && (
              <Button
                type="button"
                variant="default"
                onClick={handleImport}
                disabled={isImporting || !selectedBusinessId || unmatchedSuppliers.length > 0}
                className="w-full bg-[#4956D4] hover:bg-[#3a45b5] disabled:opacity-50 disabled:cursor-not-allowed text-white text-[16px] font-bold py-[12px] rounded-[12px] transition-colors flex items-center justify-center gap-2"
              >
                {isImporting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {importProgress || "מייבא..."}
                  </>
                ) : (
                  `ייבא ${mergedPayments.length} תשלומים (${totalSplits} פיצולים)`
                )}
              </Button>
            )}
          </>
        )}

        {/* Format Guide */}
        <div className="bg-[#0F1535] rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">מבנה הקבצים הנדרש</h3>

          <div className="mb-[15px]">
            <h4 className="text-[14px] font-bold text-[#8B93FF] text-right mb-[6px]">קובץ תשלומים ראשיים</h4>
            <p className="text-[12px] text-white/50 text-right mb-[6px]">
              כל שורה = תשלום ראשי או תשלום חלקי (installment). שורות עם אותה תמונה+ספק מקובצות אוטומטית.
            </p>
            <div className="overflow-x-auto">
              <Table className="w-full text-[11px]">
                <TableHeader>
                  <TableRow className="border-b border-white/10">
                    <TableHead className="text-right text-white/60 py-[4px] px-[6px]">עמודה</TableHead>
                    <TableHead className="text-right text-white/60 py-[4px] px-[6px]">חובה</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-white/80">
                  {[
                    ["Supplier name / ספק", true],
                    ["unique id", true],
                    ["תאריך התשלום / תאריך קבלה", true],
                    ["סוג הוצאה", false],
                    ["סוג אמצעי תשלום", false],
                    [`סכום לכל תשלום אחרי מע"מ`, false],
                    ["כמות תשלומים", false],
                    ["מספר תשלום", false],
                    ["אסמכתא", false],
                    [`מס' צ'ק`, false],
                    ["הערות", false],
                    ["כל התמונות", false],
                  ].map(([col, required]) => (
                    <TableRow key={`col-split-${col}`} className="border-b border-white/5">
                      <TableCell className="py-[3px] px-[6px]">{col as string}</TableCell>
                      <TableCell className={`py-[3px] px-[6px] ${required ? "text-[#F64E60]" : "text-white/40"}`}>
                        {required ? "כן" : "לא"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div>
            <h4 className="text-[14px] font-bold text-[#8B93FF] text-right mb-[6px]">קובץ תשלומי משנה</h4>
            <p className="text-[12px] text-white/50 text-right mb-[6px]">
              {`כל שורה = פיצול תשלום. עמודת "תשלום ראשי" מקשרת ל-unique id מהקובץ הראשון.`}
            </p>
            <div className="overflow-x-auto">
              <Table className="w-full text-[11px]">
                <TableHeader>
                  <TableRow className="border-b border-white/10">
                    <TableHead className="text-right text-white/60 py-[4px] px-[6px]">עמודה</TableHead>
                    <TableHead className="text-right text-white/60 py-[4px] px-[6px]">חובה</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-white/80">
                  {[
                    ["ספק", true],
                    ["תשלום ראשי (unique id)", false],
                    ["תאריך תשלום", true],
                    [`סכום תשלום אחרי מע"מ`, true],
                    ["סוג אמצעי תשלום", true],
                    ["מספר תשלום", false],
                    ["מספר אסמכתא", false],
                    [`מספר צ'ק`, false],
                    ["כרטיס אשראי (אם יש)", false],
                    ["בנק", false],
                    ["הערות", false],
                  ].map(([col, required]) => (
                    <TableRow key={`col-single-${col}`} className="border-b border-white/5">
                      <TableCell className="py-[3px] px-[6px]">{col as string}</TableCell>
                      <TableCell className={`py-[3px] px-[6px] ${required ? "text-[#F64E60]" : "text-white/40"}`}>
                        {required ? "כן" : "לא"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="bg-[#4956D4]/10 rounded-[8px] p-[10px] mt-[10px]">
            <p className="text-[11px] text-white/40 text-right">
              {`תשלומי משנה עם עמודת "תשלום ראשי" מלאה יקושרו לתשלום הראשי. תשלומי משנה ללא קישור יקובצו לפי ספק.`}
            </p>
            <p className="text-[11px] text-white/40 text-right mt-[4px]">
              {`אמצעי תשלום: העברה בנקאית, מזומן, צ'ק, ביט, פייבוקס, כרטיס אשראי, חברות הקפה, הוראת קבע, אחר.`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
