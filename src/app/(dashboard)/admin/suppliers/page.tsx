"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  type CsvSupplier,
  parseSupplierCsvFile,
  ensureSupplierCategories,
  buildSupplierInsertRecord,
  buildCreditCardLastFourMap,
} from "@/lib/suppliers/csvImport";


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
  // Blocking file problems (duplicate names, conflicting categories) - import is refused while non-empty
  const [csvBlockingErrors, setCsvBlockingErrors] = useState<string[]>([]);
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
    setCsvBlockingErrors([]);
    setCsvFileName(file.name);
    setCsvParsingDone(false);

    // PapaParse-based parsing shared with the new-business wizard
    parseSupplierCsvFile(file).then((result) => {
      if (!result.ok) {
        setCsvError(result.error);
        return;
      }
      const { suppliers, errors, warnings } = result;

      if (warnings.length > 0 && suppliers.length === 0) {
        setCsvError(warnings.join("\n"));
        return;
      }

      if (warnings.length > 0) {
        setCsvError(`נטענו ${suppliers.length} ספקים. אזהרות:\n${warnings.join("\n")}`);
      }

      setCsvBlockingErrors(errors);
      setCsvSuppliers(suppliers);
      setCategoryStats({ parents: result.parentCategoryCount, children: result.childCategoryCount });
      setCsvParsingDone(true);
    });
  };

  const handleRemoveCsvSupplier = (index: number) => {
    setCsvSuppliers(csvSuppliers.filter((_, i) => i !== index));
  };

  const handleClearCsv = () => {
    setCsvSuppliers([]);
    setCsvFileName(null);
    setCsvError(null);
    setCsvBlockingErrors([]);
    setCsvParsingDone(false);
    setCategoryStats({ parents: 0, children: 0 });
    setImportProgress("");
    if (csvInputRef.current) csvInputRef.current.value = "";
  };

  const importingRef = useRef(false);
  const handleImport = async () => {
    if (!selectedBusinessId) {
      showToast("יש לבחור עסק לפני הייבוא", "error");
      return;
    }
    if (csvSuppliers.length === 0) {
      showToast("אין ספקים לייבוא", "error");
      return;
    }
    if (csvBlockingErrors.length > 0) {
      showToast("לא ניתן לייבא - יש לתקן את השגיאות בקובץ ולהעלות אותו מחדש", "error");
      return;
    }
    if (importingRef.current) return;
    importingRef.current = true;

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
        importingRef.current = false;
        setIsImporting(false);
        setImportProgress("");
        return;
      }

      // 2. Create categories
      setImportProgress("יוצר קטגוריות...");

      const categoryResult = await ensureSupplierCategories(supabase, selectedBusinessId, newSuppliers);
      if ("error" in categoryResult) {
        showToast(categoryResult.error, "error");
        importingRef.current = false;
        setIsImporting(false);
        setImportProgress("");
        return;
      }

      // 3. Build supplier records
      setImportProgress(`מייבא ${newSuppliers.length} ספקים...`);

      // Credit suppliers are linked to the business card whose last 4 digits appear in the file
      const { data: creditCards } = await supabase
        .from("business_credit_cards")
        .select("id, last_four_digits")
        .eq("business_id", selectedBusinessId)
        .eq("is_active", true);
      const creditCardIdByLastFour = buildCreditCardLastFourMap(creditCards || []);

      const records = newSuppliers.map(s => buildSupplierInsertRecord(s, selectedBusinessId, categoryResult, creditCardIdByLastFour));

      // Insert in batches of 50 to avoid payload limits
      const batchSize = 50;
      let inserted = 0;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error } = await supabase.from("suppliers").insert(batch);

        if (error) {
          showToast(`שגיאה בייבוא (אחרי ${inserted} ספקים): ${error.message}`, "error");
          importingRef.current = false;
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

      // Generate recurring expense invoices for imported fixed-expense suppliers
      const hasFixedExpense = insertedSuppliers?.some(s => s.is_fixed_expense && !s.has_previous_obligations);
      if (hasFixedExpense) {
        setImportProgress("יוצר חשבוניות הוצאות קבועות...");
        const now = new Date();
        await fetch("/api/recurring-expenses/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            business_id: selectedBusinessId,
            year: now.getFullYear(),
            month: now.getMonth() + 1,
          }),
        }).catch(() => {/* non-critical */});
      }

      const msg = skippedCount > 0
        ? `יובאו ${newSuppliers.length} ספקים בהצלחה (${skippedCount} דולגו כי כבר קיימים)`
        : `יובאו ${newSuppliers.length} ספקים בהצלחה`;
      showToast(msg, "success");
      handleClearCsv();
    } catch {
      showToast("שגיאה בלתי צפויה בייבוא", "error");
    } finally {
      importingRef.current = false;
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
            <Select value={selectedBusinessId || "__none__"} onValueChange={(val) => setSelectedBusinessId(val === "__none__" ? "" : val)}>
              <SelectTrigger className="w-full bg-[#0F1535] border border-[#727BA0] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
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
        </div>

        {/* CSV Upload Area */}
        <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">העלאת קובץ ספקים</h3>

          {!csvParsingDone ? (
            <>
              <label className="border border-[#727BA0] border-dashed rounded-[10px] min-h-[120px] px-[10px] py-[15px] flex flex-col items-center justify-center gap-[8px] cursor-pointer hover:border-[#4956D4] transition-colors">
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
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClearCsv}
                  className="text-[#F64E60] text-[13px] hover:underline"
                >
                  נקה הכל
                </Button>
              </div>

              {csvBlockingErrors.length > 0 && (
                <div className="bg-[#F64E60]/10 border border-[#F64E60]/30 rounded-[10px] p-[10px] mb-[10px]">
                  <p className="text-[13px] font-bold text-[#F64E60] text-right mb-[6px]">
                    לא ניתן לייבא את הקובץ. יש לתקן את הבעיות הבאות ולהעלות אותו מחדש:
                  </p>
                  <ul className="list-disc ps-[18px] flex flex-col gap-[4px]">
                    {csvBlockingErrors.map((err) => (
                      <li key={err} className="text-[13px] text-[#F64E60] text-right">{err}</li>
                    ))}
                  </ul>
                </div>
              )}

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
                <div key={`supplier-${supplier.name}`} className={`flex items-center justify-between rounded-[10px] p-[10px] ${
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRemoveCsvSupplier(index)}
                    className="text-[#F64E60] hover:text-[#ff6b7a] flex-shrink-0 ml-[10px]"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </Button>
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
                  <TableCell className="py-[4px] px-[8px]">שם הספק</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-[#F64E60]">כן</TableCell>
                  <TableCell className="py-[4px] px-[8px]">חברת הניקיון</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">סוג הוצאה</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-[#F64E60]">כן</TableCell>
                  <TableCell className="py-[4px] px-[8px]">קניות סחורה / הוצאות שוטפות</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">קטגורית אב</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">הוצאות תפעול / עלות מכר</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">קטגוריה</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">מחשבים ותוכנות / רכבים כללי</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">{`נדרש מע"מ`}</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">כן / לא</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">מעמ</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">1.18 (מלא) / 1 (ללא)</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">התחייבות</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">כן / לא</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">הוצאה חודשית קבועה</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">כן / לא</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">סכום לכל תשלום קבוע</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">3000</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">מתי יורד כל חודש?</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">10 (יום בחודש)</TableCell>
                </TableRow>
                <TableRow className="border-b border-white/5">
                  <TableCell className="py-[4px] px-[8px]">תנאי תשלום</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">0 / 30 / 60</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="py-[4px] px-[8px]">הערות</TableCell>
                  <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                  <TableCell className="py-[4px] px-[8px]">ספק ראשי</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Import Button */}
        {csvSuppliers.length > 0 && (
          <Button
            type="button"
            variant="default"
            onClick={handleImport}
            disabled={isImporting || !selectedBusinessId || csvBlockingErrors.length > 0}
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
          </Button>
        )}
      </div>
    </div>
  );
}
