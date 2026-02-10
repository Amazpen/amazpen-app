"use client";

import { useState, useRef, useEffect } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";

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
}

interface Business {
  id: string;
  name: string;
}

interface Supplier {
  id: string;
  name: string;
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
        .select("id, name")
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

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvError(null);
    setCsvFileName(file.name);
    setCsvParsingDone(false);
    setUnmatchedSuppliers([]);

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

          // Map of possible Hebrew/English header names to canonical field names
          const headerAliases: Record<string, string> = {
            "שם ספק": "supplier_name", "שם הספק": "supplier_name", "ספק": "supplier_name",
            "supplier_name": "supplier_name", "supplier": "supplier_name", "name": "supplier_name",
            "מספר חשבונית": "invoice_number", "חשבונית": "invoice_number", "מס חשבונית": "invoice_number",
            "invoice_number": "invoice_number", "מספר מסמך": "invoice_number",
            "תאריך חשבונית": "invoice_date", "תאריך": "invoice_date", "invoice_date": "invoice_date", "date": "invoice_date",
            "תאריך יעד": "due_date", "תאריך פירעון": "due_date", "due_date": "due_date",
            "סכום לפני מעמ": "subtotal", "סכום לפני מע''מ": "subtotal", "subtotal": "subtotal",
            "סכום": "subtotal", "סכום ללא מעמ": "subtotal",
            "מעמ": "vat_amount", "מע''מ": "vat_amount", "סכום מעמ": "vat_amount",
            "סכום מע''מ": "vat_amount", "vat_amount": "vat_amount", "vat": "vat_amount",
            "סה''כ": "total_amount", "סהכ": "total_amount", "סכום כולל": "total_amount",
            "סכום כולל מעמ": "total_amount", "סכום כולל מע''מ": "total_amount",
            "total_amount": "total_amount", "total": "total_amount",
            "הערות": "notes", "notes": "notes",
            "סוג חשבונית": "invoice_type", "סוג": "invoice_type", "invoice_type": "invoice_type",
          };

          const detectedFields = results.meta.fields || [];
          const fieldMap: Record<string, string> = {};
          for (const header of detectedFields) {
            const canonical = headerAliases[header];
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

          results.data.forEach((row, rowIdx) => {
            const supplier_name = getField(row, "supplier_name");
            if (!supplier_name) return;

            // Parse date - support multiple formats
            const dateRaw = getField(row, "invoice_date");
            let invoice_date = "";
            if (dateRaw) {
              // Try DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
              const ddmmyyyy = dateRaw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
              const yyyymmdd = dateRaw.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
              if (ddmmyyyy) {
                invoice_date = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
              } else if (yyyymmdd) {
                invoice_date = `${yyyymmdd[1]}-${yyyymmdd[2].padStart(2, "0")}-${yyyymmdd[3].padStart(2, "0")}`;
              } else {
                errors.push(`שורה ${rowIdx + 2}: תאריך לא תקין "${dateRaw}" - דילוג`);
                return;
              }
            } else {
              errors.push(`שורה ${rowIdx + 2}: חסר תאריך חשבונית - דילוג`);
              return;
            }

            // Parse due date
            const dueDateRaw = getField(row, "due_date");
            let due_date = "";
            if (dueDateRaw) {
              const ddmmyyyy = dueDateRaw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
              const yyyymmdd = dueDateRaw.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
              if (ddmmyyyy) {
                due_date = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
              } else if (yyyymmdd) {
                due_date = `${yyyymmdd[1]}-${yyyymmdd[2].padStart(2, "0")}-${yyyymmdd[3].padStart(2, "0")}`;
              }
            }

            // Parse amounts
            const parseAmount = (val: string): number => {
              if (!val) return 0;
              // Remove currency symbols, commas, spaces
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

            if (total_amount > 0 && subtotal === 0 && vat_amount === 0) {
              // Only total provided - assume VAT 18%
              subtotal = Math.round((total_amount / 1.18) * 100) / 100;
              vat_amount = Math.round((total_amount - subtotal) * 100) / 100;
            } else if (subtotal > 0 && total_amount === 0) {
              if (vat_amount === 0) {
                vat_amount = Math.round(subtotal * 0.18 * 100) / 100;
              }
              total_amount = Math.round((subtotal + vat_amount) * 100) / 100;
            } else if (subtotal > 0 && vat_amount > 0 && total_amount === 0) {
              total_amount = Math.round((subtotal + vat_amount) * 100) / 100;
            }

            if (total_amount <= 0 && subtotal <= 0) {
              errors.push(`שורה ${rowIdx + 2}: סכום חסר או לא תקין - דילוג`);
              return;
            }

            // Check supplier exists
            if (!findSupplierByName(supplier_name)) {
              unmatchedSet.add(supplier_name);
            }

            // Map invoice type
            const invoiceTypeRaw = getField(row, "invoice_type").toLowerCase();
            let invoice_type = "current";
            if (invoiceTypeRaw === "חשבונית מרכזת" || invoiceTypeRaw === "consolidated" || invoiceTypeRaw === "מרכזת") {
              invoice_type = "consolidated";
            }

            const notes = getField(row, "notes");

            expenses.push({
              supplier_name,
              invoice_number: getField(row, "invoice_number"),
              invoice_date,
              due_date,
              subtotal,
              vat_amount,
              total_amount,
              notes,
              invoice_type,
            });
          });

          if (errors.length > 0 && expenses.length === 0) {
            setCsvError(errors.join("\n"));
            return;
          }

          if (errors.length > 0) {
            setCsvError(`נטענו ${expenses.length} הוצאות. אזהרות:\n${errors.join("\n")}`);
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
    setCsvExpenses(csvExpenses.filter((_, i) => i !== index));
  };

  const handleClearCsv = () => {
    setCsvExpenses([]);
    setCsvFileName(null);
    setCsvError(null);
    setCsvParsingDone(false);
    setUnmatchedSuppliers([]);
    setImportProgress("");
    if (csvInputRef.current) csvInputRef.current.value = "";
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
      showToast(`יש ${unmatchedSuppliers.length} ספקים שלא נמצאו בעסק. יש לייבא ספקים קודם.`, "error");
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

        records.push({
          business_id: selectedBusinessId,
          supplier_id: supplier.id,
          invoice_number: expense.invoice_number || null,
          invoice_date: expense.invoice_date,
          due_date: expense.due_date || null,
          subtotal: expense.subtotal,
          vat_amount: expense.vat_amount,
          total_amount: expense.total_amount,
          status: "pending",
          notes: expense.notes || null,
          created_by: user?.id || null,
          invoice_type: expense.invoice_type,
        });
      }

      if (records.length === 0) {
        showToast("כל ההוצאות כבר קיימות במערכת", "info");
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
  const consolidatedCount = csvExpenses.filter(e => e.invoice_type === "consolidated").length;

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
            <select
              value={selectedBusinessId}
              onChange={(e) => {
                setSelectedBusinessId(e.target.value);
                handleClearCsv();
              }}
              className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] px-[12px] py-[10px] text-[14px] text-white outline-none focus:border-[#4956D4] transition-colors"
            >
              <option value="">-- בחר עסק --</option>
              {businesses.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
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
                <button
                  type="button"
                  onClick={handleClearCsv}
                  className="text-[#F64E60] text-[13px] hover:underline"
                >
                  נקה הכל
                </button>
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

              {/* Unmatched suppliers warning */}
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
                  <p className="text-[12px] text-white/40 text-right mt-[6px]">
                    יש לייבא את הספקים האלו דרך &quot;ייבוא ספקים&quot; לפני ייבוא ההוצאות
                  </p>
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
                        {expense.invoice_type === "consolidated" && (
                          <span className="text-[10px] px-[4px] py-[1px] rounded bg-[#4956D4]/20 text-[#8B93FF]">
                            מרכזת
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
                        {expense.notes && (
                          <span className="text-[10px] text-white/20 truncate max-w-[120px]">{expense.notes}</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveCsvExpense(index)}
                      className="text-[#F64E60] hover:text-[#ff6b7a] flex-shrink-0 ml-[10px]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </button>
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
            שורה ראשונה: כותרות העמודות. שאר השורות: נתוני ההוצאות. שם הספק חייב להתאים לספק קיים בעסק.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-right text-white/60 py-[6px] px-[8px]">עמודה</th>
                  <th className="text-right text-white/60 py-[6px] px-[8px]">חובה</th>
                  <th className="text-right text-white/60 py-[6px] px-[8px]">דוגמה</th>
                </tr>
              </thead>
              <tbody className="text-white/80">
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">שם ספק</td>
                  <td className="py-[4px] px-[8px] text-[#F64E60]">כן</td>
                  <td className="py-[4px] px-[8px]">חברת הניקיון</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">תאריך חשבונית</td>
                  <td className="py-[4px] px-[8px] text-[#F64E60]">כן</td>
                  <td className="py-[4px] px-[8px]">15/01/2025 או 2025-01-15</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">סכום (אחד לפחות)</td>
                  <td className="py-[4px] px-[8px] text-[#F64E60]">כן</td>
                  <td className="py-[4px] px-[8px]">{`סכום לפני מע"מ / סה"כ כולל`}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">מספר חשבונית</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">INV-001</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">תאריך יעד</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">15/02/2025</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">{`סכום לפני מע"מ`}</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">1,000</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">{`מע"מ`}</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">180</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">{`סה"כ`}</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">1,180</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">סוג חשבונית</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">רגילה / מרכזת</td>
                </tr>
                <tr>
                  <td className="py-[4px] px-[8px]">הערות</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">חשבונית חודשית</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="bg-[#4956D4]/10 rounded-[8px] p-[10px] mt-[10px]">
            <p className="text-[11px] text-white/40 text-right">
              {`אם מסופק רק סה"כ כולל - המערכת תחשב אוטומטית מע"מ 18%. אם מסופק רק סכום לפני מע"מ - המערכת תוסיף 18% מע"מ.`}
            </p>
          </div>
        </div>

        {/* Import Button */}
        {csvExpenses.length > 0 && (
          <button
            type="button"
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
              `ייבא ${csvExpenses.length} הוצאות`
            )}
          </button>
        )}
      </div>
    </div>
  );
}
