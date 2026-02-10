"use client";

import { useState, useRef, useEffect } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";

interface CsvPayment {
  supplier_name: string;
  payment_date: string;
  total_amount: number;
  payment_method: string;
  invoice_number: string;
  reference_number: string;
  check_number: string;
  check_date: string;
  notes: string;
}

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

// Payment method mapping
const paymentMethodAliases: Record<string, string> = {
  "העברה בנקאית": "bank_transfer", "העברה": "bank_transfer", "bank_transfer": "bank_transfer",
  "מזומן": "cash", "cash": "cash",
  "צ'ק": "check", "צק": "check", "check": "check", "שיק": "check",
  "ביט": "bit", "bit": "bit",
  "פייבוקס": "paybox", "paybox": "paybox",
  "כרטיס אשראי": "credit_card", "אשראי": "credit_card", "credit_card": "credit_card", "credit": "credit_card",
  "חברות הקפה": "credit_companies", "הקפה": "credit_companies", "credit_companies": "credit_companies",
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
  "credit_companies": "חברות הקפה",
  "standing_order": "הוראת קבע",
  "other": "אחר",
};

const paymentMethodColors: Record<string, string> = {
  "check": "bg-[#00DD23]/20 text-[#00DD23]",
  "cash": "bg-[#FF0000]/20 text-[#FF0000]",
  "standing_order": "bg-[#3964FF]/20 text-[#3964FF]",
  "credit_companies": "bg-[#FFCF00]/20 text-[#FFCF00]",
  "credit_card": "bg-[#FF3665]/20 text-[#FF3665]",
  "bank_transfer": "bg-[#FF7F00]/20 text-[#FF7F00]",
  "bit": "bg-[#9333ea]/20 text-[#9333ea]",
  "paybox": "bg-[#06b6d4]/20 text-[#06b6d4]",
  "other": "bg-white/10 text-white/60",
};

export default function AdminPaymentsPage() {
  const supabase = createClient();
  const { showToast } = useToast();

  // Business selection
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState<string>("admin-payments:businessId", "");
  const [isLoadingBusinesses, setIsLoadingBusinesses] = useState(true);

  // Suppliers for selected business
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(false);

  // Invoices for selected business (for matching)
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  // CSV state
  const [csvPayments, setCsvPayments] = useState<CsvPayment[]>([]);
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

  // Fetch suppliers & invoices when business changes
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

  const findSupplierByName = (name: string): Supplier | undefined => {
    const normalized = name.trim().toLowerCase();
    return suppliers.find(s => s.name.toLowerCase() === normalized);
  };

  const findInvoice = (supplierName: string, invoiceNumber: string): Invoice | undefined => {
    if (!invoiceNumber) return undefined;
    const supplier = findSupplierByName(supplierName);
    if (!supplier) return undefined;
    return invoices.find(
      inv => inv.supplier_id === supplier.id && inv.invoice_number === invoiceNumber
    );
  };

  const parseDate = (raw: string): string | null => {
    if (!raw) return null;
    const ddmmyyyy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    const yyyymmdd = raw.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
    if (ddmmyyyy) {
      return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
    } else if (yyyymmdd) {
      return `${yyyymmdd[1]}-${yyyymmdd[2].padStart(2, "0")}-${yyyymmdd[3].padStart(2, "0")}`;
    }
    return null;
  };

  const parseAmount = (val: string): number => {
    if (!val) return 0;
    const cleaned = val.replace(/[₪$€,\s]/g, "");
    return parseFloat(cleaned) || 0;
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

          const headerAliases: Record<string, string> = {
            "שם ספק": "supplier_name", "שם הספק": "supplier_name", "ספק": "supplier_name",
            "supplier_name": "supplier_name", "supplier": "supplier_name", "name": "supplier_name",
            "תאריך תשלום": "payment_date", "תאריך": "payment_date", "payment_date": "payment_date", "date": "payment_date",
            "סכום": "total_amount", "סכום תשלום": "total_amount", "סה''כ": "total_amount", "סהכ": "total_amount",
            "total_amount": "total_amount", "amount": "total_amount", "total": "total_amount",
            "אמצעי תשלום": "payment_method", "שיטת תשלום": "payment_method", "סוג תשלום": "payment_method",
            "payment_method": "payment_method", "method": "payment_method",
            "מספר חשבונית": "invoice_number", "חשבונית": "invoice_number", "invoice_number": "invoice_number",
            "מספר מסמך": "invoice_number",
            "מספר אסמכתא": "reference_number", "אסמכתא": "reference_number", "reference_number": "reference_number",
            "reference": "reference_number",
            "מספר צ'ק": "check_number", "מספר צק": "check_number", "צ'ק": "check_number",
            "check_number": "check_number",
            "תאריך צ'ק": "check_date", "תאריך צק": "check_date", "check_date": "check_date",
            "הערות": "notes", "notes": "notes",
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

          const payments: CsvPayment[] = [];
          const errors: string[] = [];
          const unmatchedSet = new Set<string>();

          results.data.forEach((row, rowIdx) => {
            const supplier_name = getField(row, "supplier_name");
            if (!supplier_name) return;

            // Parse payment date
            const dateRaw = getField(row, "payment_date");
            const payment_date = parseDate(dateRaw);
            if (!payment_date) {
              errors.push(`שורה ${rowIdx + 2}: תאריך תשלום לא תקין "${dateRaw}" - דילוג`);
              return;
            }

            // Parse amount
            const total_amount = parseAmount(getField(row, "total_amount"));
            if (total_amount <= 0) {
              errors.push(`שורה ${rowIdx + 2}: סכום חסר או לא תקין - דילוג`);
              return;
            }

            // Payment method
            const methodRaw = getField(row, "payment_method");
            const payment_method = paymentMethodAliases[methodRaw.toLowerCase()] || paymentMethodAliases[methodRaw] || "other";

            // Check number & date (for check payments)
            const check_number = getField(row, "check_number");
            const checkDateRaw = getField(row, "check_date");
            const check_date = parseDate(checkDateRaw) || "";

            // Reference number
            const reference_number = getField(row, "reference_number");

            // Invoice number
            const invoice_number = getField(row, "invoice_number");

            // Notes
            const notes = getField(row, "notes");

            // Check supplier exists
            if (!findSupplierByName(supplier_name)) {
              unmatchedSet.add(supplier_name);
            }

            payments.push({
              supplier_name,
              payment_date,
              total_amount,
              payment_method,
              invoice_number,
              reference_number,
              check_number,
              check_date,
              notes,
            });
          });

          if (errors.length > 0 && payments.length === 0) {
            setCsvError(errors.join("\n"));
            return;
          }

          if (errors.length > 0) {
            setCsvError(`נטענו ${payments.length} תשלומים. אזהרות:\n${errors.join("\n")}`);
          }

          setCsvPayments(payments);
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

  const handleRemoveCsvPayment = (index: number) => {
    setCsvPayments(csvPayments.filter((_, i) => i !== index));
  };

  const handleClearCsv = () => {
    setCsvPayments([]);
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
    if (csvPayments.length === 0) {
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
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();

      // Build payment records with splits
      setImportProgress(`מייבא ${csvPayments.length} תשלומים...`);

      let inserted = 0;
      let skippedCount = 0;

      for (const payment of csvPayments) {
        const supplier = findSupplierByName(payment.supplier_name);
        if (!supplier) {
          skippedCount++;
          continue;
        }

        // Try to match invoice
        const matchedInvoice = findInvoice(payment.supplier_name, payment.invoice_number);

        // Insert payment
        const { data: paymentData, error: paymentError } = await supabase
          .from("payments")
          .insert({
            business_id: selectedBusinessId,
            supplier_id: supplier.id,
            payment_date: payment.payment_date,
            total_amount: payment.total_amount,
            invoice_id: matchedInvoice?.id || null,
            notes: payment.notes || null,
            created_by: user?.id || null,
          })
          .select("id")
          .single();

        if (paymentError) {
          showToast(`שגיאה בייבוא תשלום לספק "${payment.supplier_name}": ${paymentError.message}`, "error");
          setIsImporting(false);
          setImportProgress("");
          return;
        }

        // Insert payment split
        const splitRecord: Record<string, unknown> = {
          payment_id: paymentData.id,
          payment_method: payment.payment_method,
          amount: payment.total_amount,
        };

        if (payment.reference_number) {
          splitRecord.reference_number = payment.reference_number;
        }
        if (payment.check_number) {
          splitRecord.check_number = payment.check_number;
        }
        if (payment.check_date) {
          splitRecord.check_date = payment.check_date;
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

        // Update invoice status if matched
        if (matchedInvoice) {
          // Get total paid for this invoice
          const { data: paymentsForInvoice } = await supabase
            .from("payments")
            .select("total_amount")
            .eq("invoice_id", matchedInvoice.id)
            .is("deleted_at", null);

          const totalPaid = (paymentsForInvoice || []).reduce(
            (sum, p) => sum + Number(p.total_amount), 0
          );

          const newStatus = totalPaid >= Number(matchedInvoice.total_amount) ? "paid" : "partial";

          await supabase
            .from("invoices")
            .update({
              amount_paid: totalPaid,
              status: newStatus,
              updated_at: new Date().toISOString(),
            })
            .eq("id", matchedInvoice.id);
        }

        inserted++;
        setImportProgress(`מייבא... ${inserted}/${csvPayments.length}`);
      }

      const msg = skippedCount > 0
        ? `יובאו ${inserted} תשלומים בהצלחה (${skippedCount} דולגו)`
        : `יובאו ${inserted} תשלומים בהצלחה`;
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
  const totalSum = csvPayments.reduce((acc, p) => acc + p.total_amount, 0);
  const matchedCount = csvPayments.filter(p => findSupplierByName(p.supplier_name)).length;
  const invoiceMatchedCount = csvPayments.filter(p => findInvoice(p.supplier_name, p.invoice_number)).length;

  // Method breakdown
  const methodCounts = new Map<string, { count: number; sum: number }>();
  for (const p of csvPayments) {
    const existing = methodCounts.get(p.payment_method) || { count: 0, sum: 0 };
    methodCounts.set(p.payment_method, { count: existing.count + 1, sum: existing.sum + p.total_amount });
  }

  return (
    <div className="min-h-screen bg-[#0F1535] p-4 md:p-8" dir="rtl">
      <div className="max-w-[700px] mx-auto flex flex-col gap-[20px]">
        {/* Page Title */}
        <div className="text-center">
          <h1 className="text-[22px] font-bold text-white">ייבוא תשלומים לעסק</h1>
          <p className="text-[14px] text-white/50 mt-1">
            בחר עסק והעלה קובץ CSV עם רשימת תשלומים
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
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">העלאת קובץ תשלומים</h3>

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
                  <span className="text-[14px] text-white">תשלומים נטענו בהצלחה</span>
                  <span className="text-[16px] font-bold text-[#3CD856]">{csvPayments.length}</span>
                </div>
                <div className="flex flex-wrap gap-[8px] justify-start">
                  <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#3CD856]/20 text-[#3CD856]">
                    ספקים מותאמים: {matchedCount}/{csvPayments.length}
                  </span>
                  {unmatchedSuppliers.length > 0 && (
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#F64E60]/20 text-[#F64E60]">
                      ספקים לא נמצאו: {unmatchedSuppliers.length}
                    </span>
                  )}
                  {invoiceMatchedCount > 0 && (
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#4956D4]/20 text-[#8B93FF]">
                      חשבוניות מותאמות: {invoiceMatchedCount}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-[8px] justify-start mt-[6px]">
                  <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#FFA412]/20 text-[#FFA412]">
                    {`סה"כ תשלומים: ₪${totalSum.toLocaleString()}`}
                  </span>
                </div>
                {/* Method breakdown */}
                {methodCounts.size > 0 && (
                  <div className="flex flex-wrap gap-[8px] justify-start mt-[6px]">
                    {Array.from(methodCounts.entries()).map(([method, { count, sum }]) => (
                      <span key={method} className={`text-[11px] px-[6px] py-[2px] rounded ${paymentMethodColors[method] || paymentMethodColors.other}`}>
                        {paymentMethodNames[method] || method}: {count} (₪{sum.toLocaleString()})
                      </span>
                    ))}
                  </div>
                )}
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
                    {`יש לייבא את הספקים האלו דרך "ייבוא ספקים" לפני ייבוא התשלומים`}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Payments Preview */}
        {csvPayments.length > 0 && (
          <div className="bg-[#0F1535] rounded-[15px] p-[15px]">
            <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">תשלומים שנטענו ({csvPayments.length})</h3>
            <div className="flex flex-col gap-[8px] max-h-[400px] overflow-y-auto">
              {csvPayments.map((payment, index) => {
                const supplierMatched = !!findSupplierByName(payment.supplier_name);
                const invoiceMatched = !!findInvoice(payment.supplier_name, payment.invoice_number);
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
                        {invoiceMatched && (
                          <span className="text-[10px] px-[4px] py-[1px] rounded bg-[#4956D4]/20 text-[#8B93FF]">
                            חשבונית מותאמת
                          </span>
                        )}
                        <span className={`text-[10px] px-[4px] py-[1px] rounded ${paymentMethodColors[payment.payment_method] || paymentMethodColors.other}`}>
                          {paymentMethodNames[payment.payment_method] || "אחר"}
                        </span>
                        <span className="text-[14px] text-white font-medium">{payment.supplier_name}</span>
                      </div>
                      <div className="flex items-center gap-[10px] justify-start mt-[3px] flex-wrap">
                        <span className="text-[10px] text-white/30">
                          {payment.payment_date}
                        </span>
                        <span className="text-[11px] text-[#FFA412] font-medium">
                          {`₪${payment.total_amount.toLocaleString()}`}
                        </span>
                        {payment.invoice_number && (
                          <span className="text-[10px] text-white/30">חשבונית #{payment.invoice_number}</span>
                        )}
                        {payment.check_number && (
                          <span className="text-[10px] text-white/30">{`צ'ק #${payment.check_number}`}</span>
                        )}
                        {payment.reference_number && (
                          <span className="text-[10px] text-white/30">אסמכתא: {payment.reference_number}</span>
                        )}
                        {payment.notes && (
                          <span className="text-[10px] text-white/20 truncate max-w-[120px]">{payment.notes}</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveCsvPayment(index)}
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

        {/* No payments loaded warning */}
        {csvPayments.length === 0 && csvParsingDone && (
          <div className="bg-[#FFA412]/10 border border-[#FFA412]/30 rounded-[10px] p-[12px]">
            <p className="text-[13px] text-[#FFA412] text-right">
              לא נטענו תשלומים מהקובץ. בדוק את מבנה הקובץ.
            </p>
          </div>
        )}

        {/* CSV Format Guide */}
        <div className="bg-[#0F1535] rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">מבנה הקובץ הנדרש</h3>
          <p className="text-[12px] text-white/50 text-right mb-[10px]">
            שורה ראשונה: כותרות העמודות. שאר השורות: נתוני התשלומים. שם הספק חייב להתאים לספק קיים בעסק.
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
                  <td className="py-[4px] px-[8px]">תאריך תשלום</td>
                  <td className="py-[4px] px-[8px] text-[#F64E60]">כן</td>
                  <td className="py-[4px] px-[8px]">15/01/2025 או 2025-01-15</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">סכום</td>
                  <td className="py-[4px] px-[8px] text-[#F64E60]">כן</td>
                  <td className="py-[4px] px-[8px]">1,180</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">אמצעי תשלום</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">{`העברה / מזומן / צ'ק / ביט / אשראי`}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">מספר חשבונית</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">INV-001</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">מספר אסמכתא</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">REF-12345</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">{`מספר צ'ק`}</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">5001</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">{`תאריך צ'ק`}</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">15/02/2025</td>
                </tr>
                <tr>
                  <td className="py-[4px] px-[8px]">הערות</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">תשלום חלקי</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="bg-[#4956D4]/10 rounded-[8px] p-[10px] mt-[10px]">
            <p className="text-[11px] text-white/40 text-right">
              {`אם מסופק מספר חשבונית - המערכת תנסה להתאים לחשבונית קיימת ולעדכן את הסטטוס שלה אוטומטית.`}
            </p>
            <p className="text-[11px] text-white/40 text-right mt-[4px]">
              {`אמצעי תשלום נתמכים: העברה בנקאית, מזומן, צ'ק, ביט, פייבוקס, כרטיס אשראי, חברות הקפה, הוראת קבע, אחר.`}
            </p>
          </div>
        </div>

        {/* Import Button */}
        {csvPayments.length > 0 && (
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
              `ייבא ${csvPayments.length} תשלומים`
            )}
          </button>
        )}
      </div>
    </div>
  );
}
