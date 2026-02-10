"use client";

import { useState, useRef, useEffect } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";

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
  // Extended fields from rich CSV
  requires_vat: boolean;
  vat_type: "full" | "none" | "partial";
  is_fixed_expense: boolean;
  monthly_expense_amount: number | null;
  charge_day: number | null;
  is_active: boolean;
  has_previous_obligations: boolean;
  parent_category_name: string;
  category_name: string;
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
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState<string>("admin-suppliers:businessId", "");
  const [isLoadingBusinesses, setIsLoadingBusinesses] = useState(true);

  // CSV state
  const [csvSuppliers, setCsvSuppliers] = useState<CsvSupplier[]>([]);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvParsingDone, setCsvParsingDone] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");

  // Category stats for preview
  const [categoryStats, setCategoryStats] = useState<{ parents: number; children: number }>({ parents: 0, children: 0 });

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

    // Use PapaParse for robust RFC 4180 CSV parsing with Hebrew support
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
            "שם הספק": "name", "שם": "name", "שם ספק": "name", "name": "name", "supplier_name": "name",
            "סוג הוצאה": "expense_type", "expense_type": "expense_type",
            "נדרש מע''מ": "requires_vat", "נדרש מעמ": "requires_vat",
            "מעמ": "vat", "מע''מ": "vat",
            "מעמ חלקי": "vat_partial",
            "הוצאה חודשית קבועה": "is_fixed",
            "סכום לכל תשלום קבוע (במידה וידוע)": "monthly_amount", "סכום לכל תשלום קבוע": "monthly_amount",
            "מתי יורד כל חודש?": "charge_day", "מתי יורד כל חודש": "charge_day",
            "תנאי תשלום": "payment_terms", "payment_terms_days": "payment_terms", "ימי תשלום": "payment_terms",
            "הערות": "notes", "notes": "notes",
            "קטגורית אב": "parent_category",
            "קטגוריה": "category",
            "פעיל/לא פעיל (מספר)": "is_active_num", "פעיל/לא פעיל": "is_active_num",
            "איש קשר": "contact", "contact_name": "contact",
            "טלפון": "phone", "phone": "phone",
            "אימייל": "email", "מייל": "email", "email": "email",
            "ח.פ": "tax_id", "מספר עוסק": "tax_id", "עוסק": "tax_id", "tax_id": "tax_id",
            "כתובת": "address", "address": "address",
            "התחייבות": "has_obligations", "התחייבות קודמות": "has_obligations",
          };

          // Detect which headers from the CSV file match our known aliases
          const detectedFields = results.meta.fields || [];
          const fieldMap: Record<string, string> = {}; // canonical -> actual CSV header
          for (const header of detectedFields) {
            const canonical = headerAliases[header];
            if (canonical && !fieldMap[canonical]) {
              fieldMap[canonical] = header;
            }
          }

          if (!fieldMap["name"]) {
            setCsvError(`לא נמצאה עמודת "שם הספק" בקובץ. עמודות שנמצאו: ${detectedFields.join(", ")}`);
            return;
          }

          const getField = (row: Record<string, string>, canonical: string): string => {
            const header = fieldMap[canonical];
            return header ? (row[header] ?? "").trim() : "";
          };

          const suppliers: CsvSupplier[] = [];
          const errors: string[] = [];
          const parentCats = new Set<string>();
          const childCats = new Set<string>();

          results.data.forEach((row, rowIdx) => {
            const name = getField(row, "name");
            const expenseTypeRaw = getField(row, "expense_type");

            // Skip rows with no name or no expense type
            if (!name) return;
            if (!expenseTypeRaw) return;

            // Map expense_type
            let expense_type = "current_expenses";
            if (expenseTypeRaw === "קניות סחורה" || expenseTypeRaw === "goods_purchases" || expenseTypeRaw === "רכש סחורה" || expenseTypeRaw === "סחורה") {
              expense_type = "goods_purchases";
            } else if (expenseTypeRaw === "עלות עובדים" || expenseTypeRaw === "employee_costs") {
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

            // Map charge_day
            const chargeDayRaw = getField(row, "charge_day");
            let charge_day: number | null = chargeDayRaw ? parseInt(chargeDayRaw) || null : null;
            if (charge_day !== null && (charge_day < 1 || charge_day > 31)) {
              charge_day = null;
            }

            // Map payment_terms_days
            const paymentTermsRaw = getField(row, "payment_terms");
            const payment_terms_days = paymentTermsRaw ? (parseInt(paymentTermsRaw) || 0) : 0;

            // Notes - filter out placeholder text
            let notes = getField(row, "notes");
            if (notes === "אין הערות לספק זה") notes = "";

            // Categories
            const parent_category_name = getField(row, "parent_category");
            const category_name = getField(row, "category");
            if (parent_category_name) parentCats.add(parent_category_name);
            if (category_name) childCats.add(`${parent_category_name}|${category_name}`);

            // is_active: "1" means inactive
            const isActiveRaw = getField(row, "is_active_num");
            const is_active = isActiveRaw !== "1";

            // Map has_previous_obligations
            const obligationsRaw = getField(row, "has_obligations");
            const has_previous_obligations = obligationsRaw === "כן" || obligationsRaw === "yes";

            // Check for duplicate names within CSV
            if (suppliers.some(s => s.name === name)) {
              errors.push(`שורה ${rowIdx + 2}: ספק "${name}" כבר קיים בקובץ - דילוג`);
              return;
            }

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
              parent_category_name,
              category_name,
            });
          });

          if (errors.length > 0 && suppliers.length === 0) {
            setCsvError(errors.join("\n"));
            return;
          }

          if (errors.length > 0) {
            setCsvError(`נטענו ${suppliers.length} ספקים. אזהרות:\n${errors.join("\n")}`);
          }

          setCsvSuppliers(suppliers);
          setCategoryStats({ parents: parentCats.size, children: childCats.size });
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

  const handleRemoveCsvSupplier = (index: number) => {
    setCsvSuppliers(csvSuppliers.filter((_, i) => i !== index));
  };

  const handleClearCsv = () => {
    setCsvSuppliers([]);
    setCsvFileName(null);
    setCsvError(null);
    setCsvParsingDone(false);
    setCategoryStats({ parents: 0, children: 0 });
    setImportProgress("");
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
    setImportProgress("בודק ספקים קיימים...");

    try {
      // 1. Check for existing suppliers in this business
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
        setImportProgress("");
        return;
      }

      // 2. Create categories
      setImportProgress("יוצר קטגוריות...");

      // Collect unique parent categories
      const parentCategoryNames = new Set<string>();
      const childCategoryPairs = new Set<string>(); // "parent|child"
      for (const s of newSuppliers) {
        if (s.parent_category_name) {
          parentCategoryNames.add(s.parent_category_name);
        }
        if (s.category_name && s.parent_category_name) {
          childCategoryPairs.add(`${s.parent_category_name}|${s.category_name}`);
        }
      }

      // Fetch existing categories for this business
      const { data: existingCategories } = await supabase
        .from("expense_categories")
        .select("id, name, parent_id")
        .eq("business_id", selectedBusinessId);

      const existingCatMap = new Map<string, string>(); // name -> id
      const existingChildMap = new Map<string, string>(); // "parentId|childName" -> id
      for (const cat of existingCategories || []) {
        if (!cat.parent_id) {
          existingCatMap.set(cat.name, cat.id);
        } else {
          existingChildMap.set(`${cat.parent_id}|${cat.name}`, cat.id);
        }
      }

      // Create parent categories that don't exist
      const parentCatIdMap = new Map<string, string>(); // name -> uuid
      for (const parentName of parentCategoryNames) {
        if (existingCatMap.has(parentName)) {
          parentCatIdMap.set(parentName, existingCatMap.get(parentName)!);
        } else {
          const { data, error } = await supabase
            .from("expense_categories")
            .insert({
              business_id: selectedBusinessId,
              name: parentName,
              parent_id: null,
            })
            .select("id")
            .single();

          if (error) {
            showToast(`שגיאה ביצירת קטגוריה "${parentName}": ${error.message}`, "error");
            setIsImporting(false);
            setImportProgress("");
            return;
          }
          parentCatIdMap.set(parentName, data.id);
        }
      }

      // Create child categories that don't exist
      const childCatIdMap = new Map<string, string>(); // "parent|child" -> uuid
      for (const pair of childCategoryPairs) {
        const [parentName, childName] = pair.split("|");
        const parentId = parentCatIdMap.get(parentName);
        if (!parentId) continue;

        const existingKey = `${parentId}|${childName}`;
        if (existingChildMap.has(existingKey)) {
          childCatIdMap.set(pair, existingChildMap.get(existingKey)!);
        } else {
          const { data, error } = await supabase
            .from("expense_categories")
            .insert({
              business_id: selectedBusinessId,
              name: childName,
              parent_id: parentId,
            })
            .select("id")
            .single();

          if (error) {
            showToast(`שגיאה ביצירת קטגוריה "${childName}": ${error.message}`, "error");
            setIsImporting(false);
            setImportProgress("");
            return;
          }
          childCatIdMap.set(pair, data.id);
        }
      }

      // 3. Build supplier records
      setImportProgress(`מייבא ${newSuppliers.length} ספקים...`);

      const records = newSuppliers.map(s => {
        const parentCatId = s.parent_category_name ? parentCatIdMap.get(s.parent_category_name) || null : null;
        const childCatKey = s.parent_category_name && s.category_name ? `${s.parent_category_name}|${s.category_name}` : null;
        const childCatId = childCatKey ? childCatIdMap.get(childCatKey) || null : null;

        return {
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
          requires_vat: s.requires_vat,
          vat_type: s.vat_type,
          is_fixed_expense: s.is_fixed_expense,
          monthly_expense_amount: s.monthly_expense_amount,
          charge_day: s.charge_day,
          is_active: s.is_active,
          has_previous_obligations: s.has_previous_obligations,
          parent_category_id: parentCatId,
          expense_category_id: childCatId,
        };
      });

      // Insert in batches of 50 to avoid payload limits
      const batchSize = 50;
      let inserted = 0;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error } = await supabase.from("suppliers").insert(batch);

        if (error) {
          showToast(`שגיאה בייבוא (אחרי ${inserted} ספקים): ${error.message}`, "error");
          setIsImporting(false);
          setImportProgress("");
          return;
        }
        inserted += batch.length;
        setImportProgress(`מייבא... ${inserted}/${records.length}`);
      }

      // Create supplier_budgets for the current month (same logic as manual supplier creation)
      setImportProgress("יוצר תקציבים לחודש הנוכחי...");
      const supplierNames = records.map(r => r.name);
      const { data: insertedSuppliers } = await supabase
        .from("suppliers")
        .select("id, is_fixed_expense, monthly_expense_amount, has_previous_obligations")
        .eq("business_id", selectedBusinessId)
        .in("name", supplierNames)
        .is("deleted_at", null);

      if (insertedSuppliers && insertedSuppliers.length > 0) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        const budgetRecords = insertedSuppliers
          .filter(s => !s.has_previous_obligations)
          .map(s => ({
            supplier_id: s.id,
            business_id: selectedBusinessId,
            year: currentYear,
            month: currentMonth,
            budget_amount: s.is_fixed_expense && s.monthly_expense_amount
              ? s.monthly_expense_amount : 0,
          }));

        if (budgetRecords.length > 0) {
          const { error: budgetError } = await supabase.from("supplier_budgets").insert(budgetRecords);
          if (budgetError) {
            console.error("Error creating supplier budgets:", budgetError);
          }
        }
      }

      const msg = skippedCount > 0
        ? `יובאו ${newSuppliers.length} ספקים בהצלחה (${skippedCount} דולגו כי כבר קיימים)`
        : `יובאו ${newSuppliers.length} ספקים בהצלחה`;
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
  const activeCount = csvSuppliers.filter(s => s.is_active).length;
  const inactiveCount = csvSuppliers.length - activeCount;
  const fixedCount = csvSuppliers.filter(s => s.is_fixed_expense).length;
  const goodsCount = csvSuppliers.filter(s => s.expense_type === "goods_purchases").length;
  const currentCount = csvSuppliers.filter(s => s.expense_type === "current_expenses").length;
  const employeesCount = csvSuppliers.filter(s => s.expense_type === "employee_costs").length;
  const obligationsCount = csvSuppliers.filter(s => s.has_previous_obligations).length;

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
                  <span className="text-[14px] text-white">ספקים נטענו בהצלחה</span>
                  <span className="text-[16px] font-bold text-[#3CD856]">{csvSuppliers.length}</span>
                </div>
                <div className="flex flex-wrap gap-[8px] justify-start">
                  {goodsCount > 0 && (
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#FFA412]/20 text-[#FFA412]">
                      קניות סחורה: {goodsCount}
                    </span>
                  )}
                  {currentCount > 0 && (
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#3CD856]/20 text-[#3CD856]">
                      הוצאות שוטפות: {currentCount}
                    </span>
                  )}
                  {fixedCount > 0 && (
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#4956D4]/20 text-[#8B93FF]">
                      הוצאות קבועות: {fixedCount}
                    </span>
                  )}
                  {employeesCount > 0 && (
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#00BCD4]/20 text-[#00BCD4]">
                      עלות עובדים: {employeesCount}
                    </span>
                  )}
                  {obligationsCount > 0 && (
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#E040FB]/20 text-[#E040FB]">
                      התחייבות קודמות: {obligationsCount}
                    </span>
                  )}
                  {inactiveCount > 0 && (
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#F64E60]/20 text-[#F64E60]">
                      לא פעילים: {inactiveCount}
                    </span>
                  )}
                  {categoryStats.parents > 0 && (
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-white/10 text-white/60">
                      {categoryStats.parents} קטגוריות אב / {categoryStats.children} קטגוריות משנה
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Suppliers Preview */}
        {csvSuppliers.length > 0 && (
          <div className="bg-[#0F1535] rounded-[15px] p-[15px]">
            <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">ספקים שנטענו ({csvSuppliers.length})</h3>
            <div className="flex flex-col gap-[8px] max-h-[400px] overflow-y-auto">
              {csvSuppliers.map((supplier, index) => (
                <div key={index} className={`flex items-center justify-between rounded-[10px] p-[10px] ${
                  !supplier.is_active
                    ? "bg-[#F64E60]/5 border border-[#F64E60]/20"
                    : "bg-[#4956D4]/10 border border-[#4956D4]/30"
                }`}>
                  <div className="flex-1 text-right">
                    <div className="flex items-center gap-[6px] justify-start flex-wrap">
                      {!supplier.is_active && (
                        <span className="text-[10px] px-[4px] py-[1px] rounded bg-[#F64E60]/20 text-[#F64E60]">
                          לא פעיל
                        </span>
                      )}
                      {supplier.has_previous_obligations && (
                        <span className="text-[10px] px-[4px] py-[1px] rounded bg-[#E040FB]/20 text-[#E040FB]">
                          התחייבות קודמות
                        </span>
                      )}
                      {supplier.is_fixed_expense && (
                        <span className="text-[10px] px-[4px] py-[1px] rounded bg-[#4956D4]/20 text-[#8B93FF]">
                          קבוע{supplier.monthly_expense_amount ? ` ₪${supplier.monthly_expense_amount.toLocaleString()}` : ""}
                        </span>
                      )}
                      <span className={`text-[10px] px-[4px] py-[1px] rounded ${
                        supplier.expense_type === "goods_purchases"
                          ? "bg-[#FFA412]/20 text-[#FFA412]"
                          : supplier.expense_type === "employee_costs"
                          ? "bg-[#00BCD4]/20 text-[#00BCD4]"
                          : "bg-[#3CD856]/20 text-[#3CD856]"
                      }`}>
                        {supplier.expense_type === "goods_purchases" ? "קניות סחורה" : supplier.expense_type === "employee_costs" ? "עלות עובדים" : "הוצאות שוטפות"}
                      </span>
                      <span className="text-[14px] text-white font-medium">{supplier.name}</span>
                    </div>
                    <div className="flex items-center gap-[10px] justify-start mt-[3px] flex-wrap">
                      {supplier.parent_category_name && (
                        <span className="text-[10px] text-white/30">
                          {supplier.parent_category_name}
                          {supplier.category_name ? ` / ${supplier.category_name}` : ""}
                        </span>
                      )}
                      {supplier.requires_vat && (
                        <span className="text-[10px] text-white/30">
                          {`מע"מ ${supplier.vat_type === "full" ? "מלא" : supplier.vat_type === "partial" ? "חלקי" : "ללא"}`}
                        </span>
                      )}
                      {supplier.charge_day && (
                        <span className="text-[10px] text-white/30">יום {supplier.charge_day}</span>
                      )}
                      {supplier.payment_terms_days > 0 && (
                        <span className="text-[10px] text-white/30">שוטף + {supplier.payment_terms_days}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveCsvSupplier(index)}
                    className="text-[#F64E60] hover:text-[#ff6b7a] flex-shrink-0 ml-[10px]"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </button>
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
                  <td className="py-[4px] px-[8px]">שם הספק</td>
                  <td className="py-[4px] px-[8px] text-[#F64E60]">כן</td>
                  <td className="py-[4px] px-[8px]">חברת הניקיון</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">סוג הוצאה</td>
                  <td className="py-[4px] px-[8px] text-[#F64E60]">כן</td>
                  <td className="py-[4px] px-[8px]">קניות סחורה / הוצאות שוטפות</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">קטגורית אב</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">הוצאות תפעול / עלות מכר</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">קטגוריה</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">מחשבים ותוכנות / רכבים כללי</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">{`נדרש מע"מ`}</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">כן / לא</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">מעמ</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">1.18 (מלא) / 1 (ללא)</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">התחייבות</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">כן / לא</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">הוצאה חודשית קבועה</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">כן / לא</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">סכום לכל תשלום קבוע</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">3000</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">מתי יורד כל חודש?</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">10 (יום בחודש)</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">תנאי תשלום</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">0 / 30 / 60</td>
                </tr>
                <tr>
                  <td className="py-[4px] px-[8px]">הערות</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">ספק ראשי</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

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
                {importProgress || "מייבא..."}
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
