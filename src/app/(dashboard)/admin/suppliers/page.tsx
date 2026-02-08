"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

interface CsvSupplier {
  name: string;
  expense_type: string;
  contact_name: string;
  phone: string;
  email: string;
  tax_id: string;
  address: string;
  payment_terms_days: number;
  notes: string;
}

interface Business {
  id: string;
  name: string;
}

export default function AdminSuppliersPage() {
  const supabase = createClient();
  const { showToast } = useToast();

  // Business selection
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>("");
  const [isLoadingBusinesses, setIsLoadingBusinesses] = useState(true);

  // CSV state
  const [csvSuppliers, setCsvSuppliers] = useState<CsvSupplier[]>([]);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvParsingDone, setCsvParsingDone] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Import state
  const [isImporting, setIsImporting] = useState(false);

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

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvError(null);
    setCsvFileName(file.name);
    setCsvParsingDone(false);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");

        if (lines.length < 2) {
          setCsvError("הקובץ חייב להכיל לפחות שורת כותרות ושורת נתונים אחת");
          return;
        }

        // Parse header - support both comma and tab delimiters
        const delimiter = lines[0].includes("\t") ? "\t" : ",";
        const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, "").replace(/^\uFEFF/, ""));

        // Map Hebrew/English header names to field names
        const headerMap: Record<string, keyof CsvSupplier> = {
          "name": "name",
          "שם": "name",
          "שם ספק": "name",
          "supplier_name": "name",
          "supplier name": "name",
          "expense_type": "expense_type",
          "סוג הוצאה": "expense_type",
          "סוג": "expense_type",
          "type": "expense_type",
          "contact_name": "contact_name",
          "איש קשר": "contact_name",
          "contact": "contact_name",
          "phone": "phone",
          "טלפון": "phone",
          "email": "email",
          "אימייל": "email",
          "מייל": "email",
          "tax_id": "tax_id",
          "ח.פ": "tax_id",
          "עוסק": "tax_id",
          "מספר עוסק": "tax_id",
          "address": "address",
          "כתובת": "address",
          "payment_terms_days": "payment_terms_days",
          "ימי תשלום": "payment_terms_days",
          "תנאי תשלום": "payment_terms_days",
          "payment_terms": "payment_terms_days",
          "notes": "notes",
          "הערות": "notes",
        };

        const columnMapping: (keyof CsvSupplier | null)[] = headers.map(h => {
          const lower = h.toLowerCase();
          return headerMap[lower] || headerMap[h] || null;
        });

        // Check that "name" column exists
        if (!columnMapping.includes("name")) {
          setCsvError(`לא נמצאה עמודת "שם ספק" בקובץ. עמודות שנמצאו: ${headers.join(", ")}`);
          return;
        }

        const suppliers: CsvSupplier[] = [];
        const errors: string[] = [];

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, ""));

          const supplier: CsvSupplier = {
            name: "",
            expense_type: "current_expenses",
            contact_name: "",
            phone: "",
            email: "",
            tax_id: "",
            address: "",
            payment_terms_days: 30,
            notes: "",
          };

          columnMapping.forEach((field, idx) => {
            if (field && values[idx] !== undefined) {
              const val = values[idx];
              if (field === "payment_terms_days") {
                supplier[field] = parseInt(val) || 30;
              } else if (field === "expense_type") {
                const lower = val.toLowerCase();
                if (lower === "goods_purchases" || lower === "רכש סחורה" || lower === "סחורה") {
                  supplier.expense_type = "goods_purchases";
                } else {
                  supplier.expense_type = "current_expenses";
                }
              } else {
                supplier[field] = val;
              }
            }
          });

          if (!supplier.name.trim()) {
            errors.push(`שורה ${i + 1}: חסר שם ספק`);
            continue;
          }

          // Check for duplicate names within CSV
          if (suppliers.some(s => s.name === supplier.name)) {
            errors.push(`שורה ${i + 1}: ספק "${supplier.name}" כבר קיים בקובץ`);
            continue;
          }

          suppliers.push(supplier);
        }

        if (errors.length > 0 && suppliers.length === 0) {
          setCsvError(errors.join("\n"));
          return;
        }

        if (errors.length > 0) {
          setCsvError(`נטענו ${suppliers.length} ספקים. אזהרות:\n${errors.join("\n")}`);
        }

        setCsvSuppliers(suppliers);
        setCsvParsingDone(true);
      } catch {
        setCsvError("שגיאה בקריאת הקובץ. ודא שהקובץ בפורמט CSV תקין");
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  const handleRemoveCsvSupplier = (index: number) => {
    setCsvSuppliers(csvSuppliers.filter((_, i) => i !== index));
  };

  const handleClearCsv = () => {
    setCsvSuppliers([]);
    setCsvFileName(null);
    setCsvError(null);
    setCsvParsingDone(false);
    if (csvInputRef.current) csvInputRef.current.value = "";
  };

  const handleImport = async () => {
    if (!selectedBusinessId) {
      showToast("יש לבחור עסק לפני הייבוא", "error");
      return;
    }
    if (csvSuppliers.length === 0) {
      showToast("אין ספקים לייבוא", "error");
      return;
    }

    setIsImporting(true);

    try {
      // Check for existing suppliers in this business
      const { data: existingSuppliers } = await supabase
        .from("suppliers")
        .select("name")
        .eq("business_id", selectedBusinessId)
        .is("deleted_at", null);

      const existingNames = new Set(
        (existingSuppliers || []).map(s => s.name.toLowerCase())
      );

      // Filter out duplicates
      const newSuppliers = csvSuppliers.filter(
        s => !existingNames.has(s.name.toLowerCase())
      );
      const skippedCount = csvSuppliers.length - newSuppliers.length;

      if (newSuppliers.length === 0) {
        showToast("כל הספקים כבר קיימים בעסק", "error");
        setIsImporting(false);
        return;
      }

      // Build insert records
      const records = newSuppliers.map(s => ({
        business_id: selectedBusinessId,
        name: s.name,
        expense_type: s.expense_type,
        contact_name: s.contact_name || null,
        phone: s.phone || null,
        email: s.email || null,
        tax_id: s.tax_id || null,
        address: s.address || null,
        payment_terms_days: s.payment_terms_days,
        notes: s.notes || null,
      }));

      const { error } = await supabase.from("suppliers").insert(records);

      if (error) {
        showToast(`שגיאה בייבוא: ${error.message}`, "error");
      } else {
        const msg = skippedCount > 0
          ? `יובאו ${newSuppliers.length} ספקים בהצלחה (${skippedCount} דולגו כי כבר קיימים)`
          : `יובאו ${newSuppliers.length} ספקים בהצלחה`;
        showToast(msg, "success");
        handleClearCsv();
      }
    } catch {
      showToast("שגיאה בלתי צפויה בייבוא", "error");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F1535] p-4 md:p-8" dir="rtl">
      <div className="max-w-[700px] mx-auto flex flex-col gap-[20px]">
        {/* Page Title */}
        <div className="text-center">
          <h1 className="text-[22px] font-bold text-white">ייבוא ספקים לעסק</h1>
          <p className="text-[14px] text-white/50 mt-1">
            בחר עסק והעלה קובץ CSV עם רשימת ספקים
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
              onChange={(e) => setSelectedBusinessId(e.target.value)}
              className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] px-[12px] py-[10px] text-[14px] text-white outline-none focus:border-[#4956D4] transition-colors"
            >
              <option value="">-- בחר עסק --</option>
              {businesses.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* CSV Upload Area */}
        <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">העלאת קובץ ספקים</h3>

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
                />
              </label>

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
                <button
                  type="button"
                  onClick={handleClearCsv}
                  className="text-[#F64E60] text-[13px] hover:underline"
                >
                  נקה הכל
                </button>
                <div className="flex items-center gap-[8px]">
                  <span className="text-[14px] text-white">{csvFileName}</span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#3CD856]">
                    <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>

              {csvError && (
                <div className="bg-[#FFA412]/10 border border-[#FFA412]/30 rounded-[10px] p-[10px] mb-[10px]">
                  <p className="text-[13px] text-[#FFA412] text-right whitespace-pre-line">{csvError}</p>
                </div>
              )}

              {/* Summary */}
              <div className="bg-[#0F1535] rounded-[10px] p-[10px] mb-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-[16px] font-bold text-[#3CD856]">{csvSuppliers.length}</span>
                  <span className="text-[14px] text-white">ספקים נטענו בהצלחה</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* CSV Format Guide */}
        <div className="bg-[#0F1535] rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">מבנה הקובץ הנדרש</h3>
          <p className="text-[12px] text-white/50 text-right mb-[10px]">
            שורה ראשונה: כותרות העמודות. שאר השורות: נתוני הספקים.
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
                  <td className="py-[4px] px-[8px]">שם ספק / name</td>
                  <td className="py-[4px] px-[8px] text-[#F64E60]">כן</td>
                  <td className="py-[4px] px-[8px]">חברת הניקיון</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">סוג הוצאה / expense_type</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">current_expenses / סחורה</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">איש קשר / contact_name</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">יוסי כהן</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">טלפון / phone</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">050-1234567</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">אימייל / email</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">supplier@email.com</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">ח.פ / tax_id</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">515678901</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">כתובת / address</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">רחוב הרצל 10</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">ימי תשלום / payment_terms_days</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">30</td>
                </tr>
                <tr>
                  <td className="py-[4px] px-[8px]">הערות / notes</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">ספק ראשי</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Suppliers Preview */}
        {csvSuppliers.length > 0 && (
          <div className="bg-[#0F1535] rounded-[15px] p-[15px]">
            <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">ספקים שנטענו ({csvSuppliers.length})</h3>
            <div className="flex flex-col gap-[8px]">
              {csvSuppliers.map((supplier, index) => (
                <div key={index} className="flex items-center justify-between bg-[#4956D4]/10 border border-[#4956D4]/30 rounded-[10px] p-[10px]">
                  <button
                    type="button"
                    onClick={() => handleRemoveCsvSupplier(index)}
                    className="text-[#F64E60] hover:text-[#ff6b7a] flex-shrink-0"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </button>
                  <div className="flex-1 text-right mr-[10px]">
                    <div className="flex items-center gap-[8px] justify-end flex-wrap">
                      <span className={`text-[11px] px-[6px] py-[2px] rounded ${
                        supplier.expense_type === "goods_purchases"
                          ? "bg-[#FFA412]/20 text-[#FFA412]"
                          : "bg-[#3CD856]/20 text-[#3CD856]"
                      }`}>
                        {supplier.expense_type === "goods_purchases" ? "רכש סחורה" : "הוצאות שוטפות"}
                      </span>
                      <span className="text-[14px] text-white font-medium">{supplier.name}</span>
                    </div>
                    <div className="flex items-center gap-[12px] justify-end mt-[4px] flex-wrap">
                      {supplier.contact_name && (
                        <span className="text-[11px] text-white/40">{supplier.contact_name}</span>
                      )}
                      {supplier.phone && (
                        <span className="text-[11px] text-white/40">{supplier.phone}</span>
                      )}
                      {supplier.payment_terms_days !== 30 && (
                        <span className="text-[11px] text-white/40">שוטף + {supplier.payment_terms_days}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No suppliers loaded warning */}
        {csvSuppliers.length === 0 && csvParsingDone && (
          <div className="bg-[#FFA412]/10 border border-[#FFA412]/30 rounded-[10px] p-[12px]">
            <p className="text-[13px] text-[#FFA412] text-right">
              לא נטענו ספקים מהקובץ. בדוק את מבנה הקובץ.
            </p>
          </div>
        )}

        {/* Import Button */}
        {csvSuppliers.length > 0 && (
          <button
            type="button"
            onClick={handleImport}
            disabled={isImporting || !selectedBusinessId}
            className="w-full bg-[#4956D4] hover:bg-[#3a45b5] disabled:opacity-50 disabled:cursor-not-allowed text-white text-[16px] font-bold py-[12px] rounded-[12px] transition-colors flex items-center justify-center gap-2"
          >
            {isImporting ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                מייבא...
              </>
            ) : (
              `ייבא ${csvSuppliers.length} ספקים`
            )}
          </button>
        )}
      </div>
    </div>
  );
}
