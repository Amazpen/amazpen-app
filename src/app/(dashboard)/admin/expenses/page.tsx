"use client";

import { useState, useRef, useEffect } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

interface CsvExpense {
  supplier_name: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  subtotal: number;
  vat_amount: number;
  total_amount: number;
  notes: string;
  invoice_type: string;
  expense_type: string;
  payment_status: string;
  payment_method: string;
  is_consolidated: boolean;
  clarification_reason: string;
  parent_category: string;
  child_category: string;
  requires_vat: boolean;
}

interface Business {
  id: string;
  name: string;
}

interface Supplier {
  id: string;
  name: string;
  expense_type: string;
}

export default function AdminExpensesPage() {
  const supabase = createClient();
  const { showToast } = useToast();

  // Business selection
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState<string>("admin-expenses:businessId", "");
  const [isLoadingBusinesses, setIsLoadingBusinesses] = useState(true);

  // Suppliers for selected business
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(false);

  // CSV state
  const [csvExpenses, setCsvExpenses] = useState<CsvExpense[]>([]);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvParsingDone, setCsvParsingDone] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");

  // Unmatched suppliers
  const [unmatchedSuppliers, setUnmatchedSuppliers] = useState<string[]>([]);
  const [autoCreateSuppliers, setAutoCreateSuppliers] = useState(false);
  const [isCreatingSuppliers, setIsCreatingSuppliers] = useState(false);

  // Fetch businesses on mount
  useEffect(() => {
    async function fetchBusinesses() {
      const { data, error } = await supabase
        .from("businesses")
        .select("id, name")
        .order("name");

      if (!error && data) {
        setBusinesses(data);
      }
      setIsLoadingBusinesses(false);
    }
    fetchBusinesses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch suppliers when business changes
  useEffect(() => {
    if (!selectedBusinessId) {
      setSuppliers([]);
      return;
    }

    async function fetchSuppliers() {
      setIsLoadingSuppliers(true);
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, expense_type")
        .eq("business_id", selectedBusinessId)
        .is("deleted_at", null)
        .order("name");

      if (!error && data) {
        setSuppliers(data);
      }
      setIsLoadingSuppliers(false);
    }
    fetchSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId]);

  const findSupplierByName = (name: string): Supplier | undefined => {
    const normalized = name.trim().toLowerCase();
    return suppliers.find(s => s.name.toLowerCase() === normalized);
  };

  // Parse date - support DD/MM/YYYY, DD/MM/YYYY HH:mm, DD-MM-YYYY, YYYY-MM-DD, etc.
  const parseDate = (raw: string): string => {
    if (!raw) return "";
    const trimmed = raw.trim();

    // Strip time portion if present (e.g. "15/12/2025 21:55" -> "15/12/2025")
    const dateOnly = trimmed.replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, "");

    // Try DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    const ddmmyyyy = dateOnly.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (ddmmyyyy) {
      return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
    }

    // Try YYYY-MM-DD or YYYY/MM/DD
    const yyyymmdd = dateOnly.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
    if (yyyymmdd) {
      return `${yyyymmdd[1]}-${yyyymmdd[2].padStart(2, "0")}-${yyyymmdd[3].padStart(2, "0")}`;
    }

    return "";
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvError(null);
    setCsvFileName(file.name);
    setCsvParsingDone(false);
    setUnmatchedSuppliers([]);
    setAutoCreateSuppliers(false);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      encoding: "UTF-8",
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      complete: (results) => {
        try {
          if (results.data.length === 0) {
            setCsvError("הקובץ חייב להכיל לפחות שורת כותרות ושורת נתונים אחת");
            return;
          }

          // Normalize header for matching: replace " with '' and lowercase
          const normalizeHeader = (h: string): string => {
            return h.replace(/"/g, "''").replace(/\u05F3/g, "'").trim();
          };

          // Map of possible Hebrew/English header names to canonical field names
          const headerAliases: Record<string, string> = {
            // Supplier
            "שם ספק": "supplier_name", "שם הספק": "supplier_name", "ספק": "supplier_name",
            "supplier_name": "supplier_name", "supplier": "supplier_name", "name": "supplier_name",
            // Invoice number
            "מספר חשבונית": "invoice_number", "חשבונית": "invoice_number", "מס חשבונית": "invoice_number",
            "invoice_number": "invoice_number", "מספר מסמך": "invoice_number",
            "מספר תעודה (מספר חשבונית)": "invoice_number",
            "(תעודת משלוח)חשבונית": "invoice_number",
            // Invoice date
            "תאריך חשבונית": "invoice_date", "תאריך": "invoice_date",
            "invoice_date": "invoice_date", "date": "invoice_date",
            // Due date
            "תאריך יעד": "due_date", "תאריך פירעון": "due_date", "due_date": "due_date",
            "תאריך לתשלום": "due_date",
            // Subtotal (before VAT) - all quote variants
            "סכום לפני מעמ": "subtotal", "סכום לפני מע''מ": "subtotal", "subtotal": "subtotal",
            "סכום": "subtotal", "סכום ללא מעמ": "subtotal",
            'סכום לפני מע"מ': "subtotal",
            // VAT amount - all quote variants
            "מעמ": "vat_amount", "מע''מ": "vat_amount", "סכום מעמ": "vat_amount",
            "סכום מע''מ": "vat_amount", "vat_amount": "vat_amount", "vat": "vat_amount",
            'סכום מע"מ': "vat_amount",
            // Total amount - all variants
            "סה''כ": "total_amount", "סהכ": "total_amount", "סכום כולל": "total_amount",
            "סכום כולל מעמ": "total_amount", "סכום כולל מע''מ": "total_amount",
            "total_amount": "total_amount", "total": "total_amount",
            "סכום אחרי מע''מ": "total_amount", 'סכום אחרי מע"מ': "total_amount",
            // Notes
            "הערות": "notes", "notes": "notes",
            "הערות למסמך רגיל": "notes", "הערות לחשבונית בבירור": "notes",
            // Expense type
            "סוג הוצאה": "expense_type", "סוג חשבונית": "expense_type",
            "סוג": "expense_type", "invoice_type": "expense_type",
            // Payment status
            "טרם/שולם/שולם/זיכוי": "payment_status",
            "סטטוס תשלום": "payment_status", "סטטוס": "payment_status",
            // Payment method
            "אמצעי התשלום": "payment_method",
            // Consolidated invoice
            "האם יש צורך במרכזת": "is_consolidated",
            "מספר מרכזת": "consolidated_number",
            // Clarification
            "חשבונית בבירור": "is_in_clarification",
            "סיבת בירור": "clarification_reason",
            // VAT required
            "נדרש מעמ": "requires_vat", 'נדרש מע"מ': "requires_vat",
            // Categories
            "קטגורית אב": "parent_category", "קטיגוריה": "child_category",
            "קטגוריה": "child_category",
            // Credit/Refund
            "זיכוי": "is_credit",
            // Year/Month/Day
            "שנה": "year", "חודש (מספר)": "month", "יום (מספר)": "day",
            // Business
            "עסק": "business_name",
          };

          const detectedFields = results.meta.fields || [];
          const fieldMap: Record<string, string> = {};

          for (const header of detectedFields) {
            // Try exact match first
            let canonical = headerAliases[header];
            // If not found, try normalized (quotes replaced)
            if (!canonical) {
              const normalized = normalizeHeader(header);
              canonical = headerAliases[normalized];
            }
            if (canonical && !fieldMap[canonical]) {
              fieldMap[canonical] = header;
            }
          }

          if (!fieldMap["supplier_name"]) {
            setCsvError(`לא נמצאה עמודת "שם ספק" בקובץ. עמודות שנמצאו: ${detectedFields.join(", ")}`);
            return;
          }

          const getField = (row: Record<string, string>, canonical: string): string => {
            const header = fieldMap[canonical];
            return header ? (row[header] ?? "").trim() : "";
          };

          const expenses: CsvExpense[] = [];
          const errors: string[] = [];
          const unmatchedSet = new Set<string>();

          // Collect expense type info per supplier for auto-creation
          const supplierExpenseTypes = new Map<string, { expense_type: string; parent_category: string; child_category: string; requires_vat: boolean }>();

          results.data.forEach((row, rowIdx) => {
            const supplier_name = getField(row, "supplier_name");
            if (!supplier_name) return;

            // Parse invoice date
            const dateRaw = getField(row, "invoice_date");
            let invoice_date = "";

            if (dateRaw) {
              invoice_date = parseDate(dateRaw);
              if (!invoice_date) {
                errors.push(`שורה ${rowIdx + 2}: תאריך לא תקין "${dateRaw}" - דילוג`);
                return;
              }
            } else {
              // Try to reconstruct date from year/month/day columns
              const year = getField(row, "year");
              const month = getField(row, "month");
              const day = getField(row, "day");
              if (year && month && day) {
                invoice_date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
              } else {
                errors.push(`שורה ${rowIdx + 2}: חסר תאריך חשבונית (${supplier_name}) - דילוג`);
                return;
              }
            }

            // Parse due date
            const dueDateRaw = getField(row, "due_date");
            const due_date = parseDate(dueDateRaw);

            // Parse amounts
            const parseAmount = (val: string): number => {
              if (!val || val === "-") return 0;
              const cleaned = val.replace(/[₪$€,\s]/g, "");
              return parseFloat(cleaned) || 0;
            };

            const subtotalRaw = parseAmount(getField(row, "subtotal"));
            const vatRaw = parseAmount(getField(row, "vat_amount"));
            const totalRaw = parseAmount(getField(row, "total_amount"));

            // Calculate missing values
            let subtotal = subtotalRaw;
            let vat_amount = vatRaw;
            let total_amount = totalRaw;

            // If all three are provided, use them as-is
            if (subtotal > 0 && total_amount > 0) {
              // Values already set, recalculate vat if missing
              if (vat_amount === 0) {
                vat_amount = Math.round((total_amount - subtotal) * 100) / 100;
              }
            } else if (total_amount > 0 && subtotal === 0) {
              // Only total provided
              if (vat_amount > 0) {
                subtotal = Math.round((total_amount - vat_amount) * 100) / 100;
              } else {
                // Assume VAT 18%
                subtotal = Math.round((total_amount / 1.18) * 100) / 100;
                vat_amount = Math.round((total_amount - subtotal) * 100) / 100;
              }
            } else if (subtotal > 0 && total_amount === 0) {
              if (vat_amount === 0) {
                vat_amount = Math.round(subtotal * 0.18 * 100) / 100;
              }
              total_amount = Math.round((subtotal + vat_amount) * 100) / 100;
            }

            // Handle rows where amounts are 0 or negative (fixed expenses with 0 value)
            // Allow zero-amount rows for fixed expenses
            const expenseTypeRaw = getField(row, "expense_type");
            const notesRaw = getField(row, "notes");
            const isFixedExpense = notesRaw.includes("הוצאה חודשית קבועה") ||
              getField(row, "is_consolidated") === "כן";

            if (total_amount === 0 && subtotal === 0 && !isFixedExpense) {
              // Skip rows with empty amounts only if not a fixed expense
              if (!notesRaw && !expenseTypeRaw) {
                errors.push(`שורה ${rowIdx + 2}: סכום חסר (${supplier_name}) - דילוג`);
                return;
              }
              // Allow zero amounts for expenses that have other meaningful data
            }

            // Handle negative VAT (e.g. self-invoicing for accountant)
            // Keep as-is, the system should handle it

            // Check supplier exists
            if (!findSupplierByName(supplier_name)) {
              unmatchedSet.add(supplier_name);
            }

            // Parse expense type - maps to supplier expense_type
            let expense_type = "current_expenses";
            // invoice_type for the invoices table: 'current' or 'goods'
            let invoice_type_db = "current";
            if (expenseTypeRaw) {
              if (expenseTypeRaw.includes("קניות סחורה") || expenseTypeRaw.includes("קניות")) {
                expense_type = "goods_purchases";
                invoice_type_db = "goods";
              } else if (expenseTypeRaw.includes("הוצאות שוטפות") || expenseTypeRaw.includes("שוטפות")) {
                expense_type = "current_expenses";
                invoice_type_db = "current";
              } else if (expenseTypeRaw.includes("עובדים") || expenseTypeRaw.includes("שכר")) {
                expense_type = "employee_costs";
                invoice_type_db = "current";
              }
            }

            // Parse payment status - DB allows: 'pending', 'clarification', 'paid'
            const paymentStatusRaw = getField(row, "payment_status");
            let payment_status = "pending";
            if (paymentStatusRaw) {
              if (paymentStatusRaw === "שולם" || paymentStatusRaw.includes("שולם")) {
                payment_status = "paid";
              } else if (paymentStatusRaw === "בבירור") {
                payment_status = "clarification";
              } else if (paymentStatusRaw.includes("ממתין") || paymentStatusRaw.includes("טרם")) {
                payment_status = "pending";
              } else if (paymentStatusRaw === "זיכוי") {
                // No 'credited' in DB - use 'paid' as closest match
                payment_status = "paid";
              }
            }

            // Payment method
            const payment_method = getField(row, "payment_method");

            // Consolidated
            const isConsolidatedRaw = getField(row, "is_consolidated");
            const is_consolidated = isConsolidatedRaw === "כן" || isConsolidatedRaw === "true";

            // Clarification
            const isInClarificationRaw = getField(row, "is_in_clarification");
            const clarification_reason = getField(row, "clarification_reason");
            if (isInClarificationRaw === "כן" && payment_status !== "clarification") {
              payment_status = "clarification";
            }

            // VAT required
            const requiresVatRaw = getField(row, "requires_vat");
            const requires_vat = requiresVatRaw !== "לא";

            // Categories
            const parent_category = getField(row, "parent_category");
            const child_category = getField(row, "child_category");

            // Invoice number - clean up dashes
            let invoice_number = getField(row, "invoice_number");
            if (invoice_number === "-" || invoice_number === "–") {
              invoice_number = "";
            }

            // Use the DB-compatible invoice_type
            const invoice_type = invoice_type_db;

            // Build notes from various fields
            const notesParts: string[] = [];
            if (notesRaw && notesRaw !== "הוצאה חודשית קבועה") notesParts.push(notesRaw);
            const clarificationNotes = getField(row, "notes");
            // Only add if different from main notes
            if (clarificationNotes && clarificationNotes !== notesRaw && clarificationNotes !== "הוצאה חודשית קבועה") {
              notesParts.push(clarificationNotes);
            }
            const notes = notesParts.join(" | ");

            // Store supplier info for auto-creation
            if (!supplierExpenseTypes.has(supplier_name.toLowerCase())) {
              supplierExpenseTypes.set(supplier_name.toLowerCase(), {
                expense_type,
                parent_category,
                child_category,
                requires_vat,
              });
            }

            expenses.push({
              supplier_name,
              invoice_number,
              invoice_date,
              due_date,
              subtotal,
              vat_amount,
              total_amount,
              notes,
              invoice_type,
              expense_type,
              payment_status,
              payment_method,
              is_consolidated,
              clarification_reason,
              parent_category,
              child_category,
              requires_vat,
            });
          });

          if (errors.length > 0 && expenses.length === 0) {
            setCsvError(errors.join("\n"));
            return;
          }

          if (errors.length > 0) {
            setCsvError(`נטענו ${expenses.length} הוצאות מתוך ${expenses.length + errors.length} שורות. ${errors.length} דולגו:\n${errors.join("\n")}`);
          }

          setCsvExpenses(expenses);
          setUnmatchedSuppliers(Array.from(unmatchedSet));
          setCsvParsingDone(true);
        } catch {
          setCsvError("שגיאה בקריאת הקובץ. ודא שהקובץ בפורמט CSV תקין");
        }
      },
      error: (err: Error) => {
        setCsvError(`שגיאה בפענוח הקובץ: ${err.message}`);
      },
    });
  };

  const handleRemoveCsvExpense = (index: number) => {
    const removed = csvExpenses[index];
    const newExpenses = csvExpenses.filter((_, i) => i !== index);
    setCsvExpenses(newExpenses);

    // Recalculate unmatched suppliers
    const remainingNames = new Set(newExpenses.map(e => e.supplier_name));
    if (!remainingNames.has(removed.supplier_name)) {
      setUnmatchedSuppliers(unmatchedSuppliers.filter(n => n !== removed.supplier_name));
    }
  };

  const handleClearCsv = () => {
    setCsvExpenses([]);
    setCsvFileName(null);
    setCsvError(null);
    setCsvParsingDone(false);
    setUnmatchedSuppliers([]);
    setAutoCreateSuppliers(false);
    setImportProgress("");
    if (csvInputRef.current) csvInputRef.current.value = "";
  };

  // Auto-create missing suppliers from CSV data
  const handleCreateMissingSuppliers = async () => {
    if (!selectedBusinessId || unmatchedSuppliers.length === 0) return;

    setIsCreatingSuppliers(true);
    setImportProgress("יוצר ספקים חדשים...");

    try {
      // Gather expense type info from parsed CSV rows for each unmatched supplier
      const supplierInfoMap = new Map<string, { expense_type: string; parent_category: string; child_category: string; requires_vat: boolean }>();
      for (const expense of csvExpenses) {
        const normalized = expense.supplier_name.trim().toLowerCase();
        if (unmatchedSuppliers.some(u => u.trim().toLowerCase() === normalized) && !supplierInfoMap.has(normalized)) {
          supplierInfoMap.set(normalized, {
            expense_type: expense.expense_type,
            parent_category: expense.parent_category,
            child_category: expense.child_category,
            requires_vat: expense.requires_vat,
          });
        }
      }

      const newSuppliers = unmatchedSuppliers.map(name => {
        const info = supplierInfoMap.get(name.trim().toLowerCase());
        return {
          business_id: selectedBusinessId,
          name: name.trim(),
          expense_type: info?.expense_type || "current_expenses",
          requires_vat: info?.requires_vat ?? true,
          vat_type: (info?.requires_vat ?? true) ? "full" : "none",
        };
      });

      // Insert in batches
      const batchSize = 50;
      let created = 0;
      for (let i = 0; i < newSuppliers.length; i += batchSize) {
        const batch = newSuppliers.slice(i, i + batchSize);
        const { error } = await supabase.from("suppliers").insert(batch);
        if (error) {
          showToast(`שגיאה ביצירת ספקים: ${error.message}`, "error");
          setIsCreatingSuppliers(false);
          setImportProgress("");
          return;
        }
        created += batch.length;
      }

      // Reload suppliers list
      const { data: updatedSuppliers } = await supabase
        .from("suppliers")
        .select("id, name, expense_type")
        .eq("business_id", selectedBusinessId)
        .is("deleted_at", null)
        .order("name");

      if (updatedSuppliers) {
        setSuppliers(updatedSuppliers);
      }

      setUnmatchedSuppliers([]);
      setAutoCreateSuppliers(false);
      showToast(`נוצרו ${created} ספקים חדשים בהצלחה`, "success");
    } catch {
      showToast("שגיאה בלתי צפויה ביצירת ספקים", "error");
    } finally {
      setIsCreatingSuppliers(false);
      setImportProgress("");
    }
  };

  const handleImport = async () => {
    if (!selectedBusinessId) {
      showToast("יש לבחור עסק לפני הייבוא", "error");
      return;
    }
    if (csvExpenses.length === 0) {
      showToast("אין הוצאות לייבוא", "error");
      return;
    }

    // Check unmatched suppliers
    if (unmatchedSuppliers.length > 0) {
      showToast(`יש ${unmatchedSuppliers.length} ספקים שלא נמצאו בעסק. צור אותם קודם או ייבא אותם.`, "error");
      return;
    }

    setIsImporting(true);
    setImportProgress("בודק חשבוניות קיימות...");

    try {
      // 1. Check for existing invoices
      const { data: existingInvoices } = await supabase
        .from("invoices")
        .select("invoice_number, supplier_id")
        .eq("business_id", selectedBusinessId)
        .is("deleted_at", null);

      const existingSet = new Set(
        (existingInvoices || [])
          .filter(inv => inv.invoice_number)
          .map(inv => `${inv.supplier_id}|${inv.invoice_number}`)
      );

      // 2. Get current user
      const { data: { user } } = await supabase.auth.getUser();

      // 3. Build invoice records
      setImportProgress("מכין רשומות...");

      const records: {
        business_id: string;
        supplier_id: string;
        invoice_number: string | null;
        invoice_date: string;
        due_date: string | null;
        subtotal: number;
        vat_amount: number;
        total_amount: number;
        status: string;
        notes: string | null;
        created_by: string | null;
        invoice_type: string;
        clarification_reason: string | null;
        is_consolidated: boolean;
      }[] = [];
      let skippedCount = 0;

      for (const expense of csvExpenses) {
        const supplier = findSupplierByName(expense.supplier_name);
        if (!supplier) continue;

        // Skip if invoice number already exists for this supplier
        if (expense.invoice_number) {
          const key = `${supplier.id}|${expense.invoice_number}`;
          if (existingSet.has(key)) {
            skippedCount++;
            continue;
          }
        }

        // Map payment_status to invoice status (DB: pending/clarification/paid)
        let status = "pending";
        if (expense.payment_status === "paid") status = "paid";
        else if (expense.payment_status === "clarification") status = "clarification";

        records.push({
          business_id: selectedBusinessId,
          supplier_id: supplier.id,
          invoice_number: expense.invoice_number || null,
          invoice_date: expense.invoice_date,
          due_date: expense.due_date || null,
          subtotal: expense.subtotal,
          vat_amount: expense.vat_amount,
          total_amount: expense.total_amount,
          status,
          notes: expense.notes || null,
          created_by: user?.id || null,
          invoice_type: expense.invoice_type,
          clarification_reason: expense.clarification_reason || null,
          is_consolidated: expense.is_consolidated,
        });
      }

      if (records.length === 0) {
        showToast(skippedCount > 0
          ? `כל ${skippedCount} ההוצאות כבר קיימות במערכת`
          : "לא נמצאו הוצאות תקינות לייבוא", "info");
        setIsImporting(false);
        setImportProgress("");
        return;
      }

      // 4. Insert in batches
      setImportProgress(`מייבא ${records.length} הוצאות...`);

      const batchSize = 50;
      let inserted = 0;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error } = await supabase.from("invoices").insert(batch);

        if (error) {
          showToast(`שגיאה בייבוא (אחרי ${inserted} הוצאות): ${error.message}`, "error");
          setIsImporting(false);
          setImportProgress("");
          return;
        }
        inserted += batch.length;
        setImportProgress(`מייבא... ${inserted}/${records.length}`);
      }

      const msg = skippedCount > 0
        ? `יובאו ${records.length} הוצאות בהצלחה (${skippedCount} דולגו כי כבר קיימות)`
        : `יובאו ${records.length} הוצאות בהצלחה`;
      showToast(msg, "success");
      handleClearCsv();
    } catch {
      showToast("שגיאה בלתי צפויה בייבוא", "error");
    } finally {
      setIsImporting(false);
      setImportProgress("");
    }
  };

  // Count stats for preview
  const totalSum = csvExpenses.reduce((acc, e) => acc + e.total_amount, 0);
  const vatSum = csvExpenses.reduce((acc, e) => acc + e.vat_amount, 0);
  const subtotalSum = csvExpenses.reduce((acc, e) => acc + e.subtotal, 0);
  const matchedCount = csvExpenses.filter(e => findSupplierByName(e.supplier_name)).length;
  const consolidatedCount = csvExpenses.filter(e => e.is_consolidated).length;
  const paidCount = csvExpenses.filter(e => e.payment_status === "paid").length;
  const pendingCount = csvExpenses.filter(e => e.payment_status === "pending").length;
  const clarificationCount = csvExpenses.filter(e => e.payment_status === "clarification").length;

  // Group expenses by supplier for summary
  const supplierSummary = csvExpenses.reduce((acc, e) => {
    const key = e.supplier_name;
    if (!acc[key]) {
      acc[key] = { count: 0, total: 0, matched: !!findSupplierByName(e.supplier_name) };
    }
    acc[key].count++;
    acc[key].total += e.total_amount;
    return acc;
  }, {} as Record<string, { count: number; total: number; matched: boolean }>);

  return (
    <div className="min-h-screen bg-[#0F1535] p-4 md:p-8" dir="rtl">
      <div className="max-w-[700px] mx-auto flex flex-col gap-[20px]">
        {/* Page Title */}
        <div className="text-center">
          <h1 className="text-[22px] font-bold text-white">ייבוא הוצאות לעסק</h1>
          <p className="text-[14px] text-white/50 mt-1">
            בחר עסק והעלה קובץ CSV עם רשימת הוצאות (חשבוניות)
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
            <Select value={selectedBusinessId || "__none__"} onValueChange={(val) => { setSelectedBusinessId(val === "__none__" ? "" : val); handleClearCsv(); }}>
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

        {/* CSV Upload Area */}
        <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">העלאת קובץ הוצאות</h3>

          {!csvParsingDone ? (
            <>
              <label className="border border-[#4C526B] border-dashed rounded-[10px] min-h-[120px] px-[10px] py-[15px] flex flex-col items-center justify-center gap-[8px] cursor-pointer hover:border-[#4956D4] transition-colors">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-[#979797]">
                  <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 18V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M9 15L12 12L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-[14px] text-[#979797]">לחץ להעלאת קובץ CSV</span>
                <span className="text-[12px] text-[#979797]/60">UTF-8 בלבד - תומך בעברית</span>
                {csvFileName && <span className="text-[12px] text-white/70">{csvFileName}</span>}
                <input
                  ref={csvInputRef}
                  type="file"
                  onChange={handleCsvUpload}
                  className="hidden"
                  accept=".csv,text/csv"
                  disabled={!selectedBusinessId}
                />
              </label>

              {!selectedBusinessId && (
                <p className="text-[12px] text-[#FFA412] text-right mt-[8px]">
                  יש לבחור עסק לפני העלאת קובץ
                </p>
              )}

              {csvError && (
                <div className="bg-[#F64E60]/10 border border-[#F64E60]/30 rounded-[10px] p-[10px] mt-[10px]">
                  <p className="text-[13px] text-[#F64E60] text-right whitespace-pre-line">{csvError}</p>
                </div>
              )}
            </>
          ) : (
            <>
              {/* File info & clear button */}
              <div className="flex items-center justify-between bg-[#0F1535] rounded-[10px] p-[10px] mb-[10px]">
                <div className="flex items-center gap-[8px]">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#3CD856]">
                    <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="text-[14px] text-white">{csvFileName}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClearCsv}
                  className="text-[#F64E60] text-[13px] hover:underline"
                >
                  נקה הכל
                </Button>
              </div>

              {csvError && (
                <div className="bg-[#FFA412]/10 border border-[#FFA412]/30 rounded-[10px] p-[10px] mb-[10px]">
                  <p className="text-[13px] text-[#FFA412] text-right whitespace-pre-line">{csvError}</p>
                </div>
              )}

              {/* Summary Stats */}
              <div className="bg-[#0F1535] rounded-[10px] p-[10px] mb-[10px]">
                <div className="flex items-center justify-between mb-[8px]">
                  <span className="text-[14px] text-white">הוצאות נטענו בהצלחה</span>
                  <span className="text-[16px] font-bold text-[#3CD856]">{csvExpenses.length}</span>
                </div>
                <div className="flex flex-wrap gap-[8px] justify-start">
                  <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#3CD856]/20 text-[#3CD856]">
                    ספקים מותאמים: {matchedCount}/{csvExpenses.length}
                  </span>
                  {unmatchedSuppliers.length > 0 && (
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#F64E60]/20 text-[#F64E60]">
                      ספקים לא נמצאו: {unmatchedSuppliers.length}
                    </span>
                  )}
                  {consolidatedCount > 0 && (
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#4956D4]/20 text-[#8B93FF]">
                      מרכזות: {consolidatedCount}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-[8px] justify-start mt-[6px]">
                  <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#3CD856]/10 text-[#3CD856]/70">
                    שולם: {paidCount}
                  </span>
                  <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#FFA412]/10 text-[#FFA412]/70">
                    ממתין: {pendingCount}
                  </span>
                  {clarificationCount > 0 && (
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#F64E60]/10 text-[#F64E60]/70">
                      בבירור: {clarificationCount}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-[8px] justify-start mt-[6px]">
                  <span className="text-[11px] px-[6px] py-[2px] rounded bg-white/10 text-white/60">
                    {`סה"כ לפני מע"מ: ₪${subtotalSum.toLocaleString()}`}
                  </span>
                  <span className="text-[11px] px-[6px] py-[2px] rounded bg-white/10 text-white/60">
                    {`מע"מ: ₪${vatSum.toLocaleString()}`}
                  </span>
                  <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#FFA412]/20 text-[#FFA412]">
                    {`סה"כ כולל מע"מ: ₪${totalSum.toLocaleString()}`}
                  </span>
                </div>
              </div>

              {/* Supplier Summary */}
              <div className="bg-[#0F1535] rounded-[10px] p-[10px] mb-[10px]">
                <p className="text-[13px] text-white font-bold mb-[8px]">סיכום לפי ספקים ({Object.keys(supplierSummary).length})</p>
                <div className="flex flex-wrap gap-[6px]">
                  {Object.entries(supplierSummary)
                    .sort((a, b) => b[1].total - a[1].total)
                    .map(([name, info]) => (
                    <span
                      key={name}
                      className={`text-[11px] px-[6px] py-[2px] rounded ${
                        info.matched
                          ? "bg-[#3CD856]/10 text-[#3CD856]"
                          : "bg-[#F64E60]/10 text-[#F64E60]"
                      }`}
                    >
                      {name} ({info.count}) - {`₪${info.total.toLocaleString()}`}
                    </span>
                  ))}
                </div>
              </div>

              {/* Unmatched suppliers warning + auto-create option */}
              {unmatchedSuppliers.length > 0 && (
                <div className="bg-[#F64E60]/10 border border-[#F64E60]/30 rounded-[10px] p-[10px] mb-[10px]">
                  <p className="text-[13px] text-[#F64E60] text-right font-bold mb-[6px]">
                    ספקים שלא נמצאו בעסק ({unmatchedSuppliers.length}):
                  </p>
                  <div className="flex flex-wrap gap-[6px]">
                    {unmatchedSuppliers.map((name, i) => (
                      <span key={i} className="text-[11px] px-[6px] py-[2px] rounded bg-[#F64E60]/20 text-[#F64E60]">
                        {name}
                      </span>
                    ))}
                  </div>

                  <div className="mt-[10px] flex flex-col gap-[8px]">
                    <p className="text-[12px] text-white/50 text-right">
                      ניתן ליצור את הספקים האלו אוטומטית עם סוג ההוצאה שזוהה מהקובץ, או לייבא אותם ידנית דרך &quot;ייבוא ספקים&quot;.
                    </p>

                    {!autoCreateSuppliers ? (
                      <Button
                        type="button"
                        variant="default"
                        onClick={() => setAutoCreateSuppliers(true)}
                        className="w-full bg-[#FFA412] hover:bg-[#e6930f] text-[#0F1535] text-[14px] font-bold py-[8px] rounded-[10px] transition-colors"
                      >
                        {`צור ${unmatchedSuppliers.length} ספקים חדשים אוטומטית`}
                      </Button>
                    ) : (
                      <div className="bg-[#FFA412]/10 rounded-[8px] p-[8px]">
                        <p className="text-[12px] text-[#FFA412] text-right mb-[6px]">
                          הספקים הבאים ייווצרו עם סוג ההוצאה שזוהה מהקובץ:
                        </p>
                        <div className="flex flex-col gap-[3px] mb-[8px]">
                          {unmatchedSuppliers.map((name, i) => {
                            const expense = csvExpenses.find(e => e.supplier_name === name);
                            const typeLabel = expense?.expense_type === "goods_purchases" ? "קניות סחורה"
                              : expense?.expense_type === "employee_costs" ? "עלות עובדים"
                              : "הוצאות שוטפות";
                            return (
                              <span key={i} className="text-[11px] text-white/60">
                                {name} - {typeLabel}
                              </span>
                            );
                          })}
                        </div>
                        <div className="flex gap-[8px]">
                          <Button
                            type="button"
                            variant="default"
                            onClick={handleCreateMissingSuppliers}
                            disabled={isCreatingSuppliers}
                            className="flex-1 bg-[#3CD856] hover:bg-[#2db845] disabled:opacity-50 text-[#0F1535] text-[13px] font-bold py-[6px] rounded-[8px] transition-colors flex items-center justify-center gap-[4px]"
                          >
                            {isCreatingSuppliers ? (
                              <>
                                <div className="w-4 h-4 border-2 border-[#0F1535]/30 border-t-[#0F1535] rounded-full animate-spin" />
                                יוצר...
                              </>
                            ) : (
                              "אישור - צור ספקים"
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setAutoCreateSuppliers(false)}
                            className="px-[12px] bg-white/10 hover:bg-white/20 text-white text-[13px] py-[6px] rounded-[8px] transition-colors"
                          >
                            ביטול
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Expenses Preview */}
        {csvExpenses.length > 0 && (
          <div className="bg-[#0F1535] rounded-[15px] p-[15px]">
            <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">הוצאות שנטענו ({csvExpenses.length})</h3>
            <div className="flex flex-col gap-[8px] max-h-[400px] overflow-y-auto">
              {csvExpenses.map((expense, index) => {
                const supplierMatched = !!findSupplierByName(expense.supplier_name);
                return (
                  <div key={index} className={`flex items-center justify-between rounded-[10px] p-[10px] ${
                    !supplierMatched
                      ? "bg-[#F64E60]/5 border border-[#F64E60]/20"
                      : "bg-[#4956D4]/10 border border-[#4956D4]/30"
                  }`}>
                    <div className="flex-1 text-right">
                      <div className="flex items-center gap-[6px] justify-start flex-wrap">
                        {!supplierMatched && (
                          <span className="text-[10px] px-[4px] py-[1px] rounded bg-[#F64E60]/20 text-[#F64E60]">
                            ספק לא נמצא
                          </span>
                        )}
                        {expense.is_consolidated && (
                          <span className="text-[10px] px-[4px] py-[1px] rounded bg-[#4956D4]/20 text-[#8B93FF]">
                            מרכזת
                          </span>
                        )}
                        {expense.payment_status === "paid" && (
                          <span className="text-[10px] px-[4px] py-[1px] rounded bg-[#3CD856]/20 text-[#3CD856]">
                            שולם
                          </span>
                        )}
                        {expense.payment_status === "clarification" && (
                          <span className="text-[10px] px-[4px] py-[1px] rounded bg-[#F64E60]/20 text-[#F64E60]">
                            בבירור
                          </span>
                        )}
                        <span className="text-[14px] text-white font-medium">{expense.supplier_name}</span>
                        {expense.invoice_number && (
                          <span className="text-[11px] text-white/40">#{expense.invoice_number}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-[10px] justify-start mt-[3px] flex-wrap">
                        <span className="text-[10px] text-white/30">
                          {expense.invoice_date}
                        </span>
                        <span className="text-[10px] text-white/30">
                          {`₪${expense.subtotal.toLocaleString()} + מע"מ ₪${expense.vat_amount.toLocaleString()}`}
                        </span>
                        <span className="text-[11px] text-[#FFA412] font-medium">
                          {`₪${expense.total_amount.toLocaleString()}`}
                        </span>
                        {expense.payment_method && (
                          <span className="text-[10px] text-white/20">{expense.payment_method}</span>
                        )}
                        {expense.notes && (
                          <span className="text-[10px] text-white/20 truncate max-w-[120px]">{expense.notes}</span>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRemoveCsvExpense(index)}
                      className="text-[#F64E60] hover:text-[#ff6b7a] flex-shrink-0 ml-[10px]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* No expenses loaded warning */}
        {csvExpenses.length === 0 && csvParsingDone && (
          <div className="bg-[#FFA412]/10 border border-[#FFA412]/30 rounded-[10px] p-[12px]">
            <p className="text-[13px] text-[#FFA412] text-right">
              לא נטענו הוצאות מהקובץ. בדוק את מבנה הקובץ.
            </p>
          </div>
        )}

        {/* CSV Format Guide */}
        <div className="bg-[#0F1535] rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">מבנה הקובץ הנדרש</h3>
          <p className="text-[12px] text-white/50 text-right mb-[10px]">
            שורה ראשונה: כותרות העמודות. שאר השורות: נתוני ההוצאות. ספקים שלא קיימים במערכת יזוהו ותוכל ליצור אותם אוטומטית.
          </p>
          <div className="overflow-x-auto">
            <Table className="w-full text-[12px]">
              <TableHeader>
                <TableRow className="border-b border-white/10">
                  <TableHead className="text-right text-white/60 py-[6px] px-[8px]">עמודה</TableHead>
                  <TableHead className="text-right text-white/60 py-[6px] px-[8px]">חובה</TableHead>
                  <TableHead className="text-right text-white/60 py-[6px] px-[8px]">דוגמה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="text-white/80">
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">ספק</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-[#F64E60]">כן</TableCell>
                  <TableCell className="py-[4px] px-[8px]">קוקה קולה</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">תאריך חשבונית</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-[#F64E60]">כן</TableCell>
                  <TableCell className="py-[4px] px-[8px]">15/01/2025 או 15/01/2025 21:00</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">סכום (אחד לפחות)</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-[#F64E60]">כן</TableCell>
                  <TableCell className="py-[4px] px-[8px]">{`סכום לפני מע"מ / סכום אחרי מע"מ`}</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">מספר חשבונית</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">INV-001</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">תאריך לתשלום</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">15/02/2025</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">סוג הוצאה</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">קניות סחורה / הוצאות שוטפות</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">סטטוס תשלום</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">שולם / ממתין לתשלום / בבירור</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">אמצעי התשלום</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">העברה בנקאית</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">קטגוריות</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">קטגורית אב / קטיגוריה</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="py-[4px] px-[8px]">הערות</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">חשבונית חודשית</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div className="bg-[#4956D4]/10 rounded-[8px] p-[10px] mt-[10px]">
            <p className="text-[11px] text-white/40 text-right">
              {`אם מסופק רק סה"כ כולל - המערכת תחשב אוטומטית מע"מ 18%. אם מסופק רק סכום לפני מע"מ - המערכת תוסיף 18% מע"מ. תאריכים עם שעה (15/01/2025 21:00) מטופלים אוטומטית. ספקים חדשים שלא קיימים ייווצרו אוטומטית עם סוג ההוצאה מהקובץ.`}
            </p>
          </div>
        </div>

        {/* Import Button */}
        {csvExpenses.length > 0 && (
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
            ) : unmatchedSuppliers.length > 0 ? (
              `יש ליצור ${unmatchedSuppliers.length} ספקים חסרים לפני הייבוא`
            ) : (
              `ייבא ${csvExpenses.length} הוצאות`
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
