"use client";

import { useState, useRef, useEffect } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Business {
  id: string;
  name: string;
}

interface IncomeSource {
  id: string;
  name: string;
  display_order: number;
}

interface ReceiptType {
  id: string;
  name: string;
  display_order: number;
}

interface ManagedProduct {
  id: string;
  name: string;
  unit: string;
  unit_cost: number;
}

interface CsvDailyEntry {
  entry_date: string;
  total_register: number;
  labor_cost: number;
  labor_hours: number;
  discounts: number;
  day_factor: number;
  business_name: string;
  income_amounts: number[]; // by display_order index (0-3)
  orders_counts: number[];  // by display_order index (0-3)
  receipt_amounts: number[]; // by display_order index (0-3)
  diner_cards: number;
  product_openings: number[];  // by index (0-2)
  product_closings: number[];  // by index (0-2)
  product_received: number[];  // by index (0-2)
  product_usage: number[];     // by index (0-2)
}

export default function AdminDailyEntriesPage() {
  const supabase = createClient();
  const { showToast } = useToast();

  // Business selection
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState<string>("admin-daily-entries:businessId", "");
  const [isLoadingBusinesses, setIsLoadingBusinesses] = useState(true);

  // Business config
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([]);
  const [receiptTypes, setReceiptTypes] = useState<ReceiptType[]>([]);
  const [managedProducts, setManagedProducts] = useState<ManagedProduct[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  // CSV state
  const [csvEntries, setCsvEntries] = useState<CsvDailyEntry[]>([]);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvParsingDone, setCsvParsingDone] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");

  // Duplicate detection
  const [duplicateDates, setDuplicateDates] = useState<Set<string>>(new Set());
  const [overwriteExisting, setOverwriteExisting] = useState(false);

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

  // Load business config when business changes
  useEffect(() => {
    if (!selectedBusinessId) {
      setIncomeSources([]);
      setReceiptTypes([]);
      setManagedProducts([]);
      return;
    }

    async function loadConfig() {
      setIsLoadingConfig(true);
      const [
        { data: sources },
        { data: receipts },
        { data: products },
      ] = await Promise.all([
        supabase
          .from("income_sources")
          .select("id, name, display_order")
          .eq("business_id", selectedBusinessId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("display_order"),
        supabase
          .from("receipt_types")
          .select("id, name, display_order")
          .eq("business_id", selectedBusinessId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("display_order"),
        supabase
          .from("managed_products")
          .select("id, name, unit, unit_cost")
          .eq("business_id", selectedBusinessId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("name"),
      ]);

      setIncomeSources(sources || []);
      setReceiptTypes(receipts || []);
      setManagedProducts(products || []);
      setIsLoadingConfig(false);
    }
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId]);

  // Parse date - support DD/MM/YYYY HH:mm, DD/MM/YYYY, etc.
  const parseDate = (raw: string): string => {
    if (!raw) return "";
    const trimmed = raw.trim();
    const dateOnly = trimmed.replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, "");
    const ddmmyyyy = dateOnly.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (ddmmyyyy) {
      return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
    }
    const yyyymmdd = dateOnly.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
    if (yyyymmdd) {
      return `${yyyymmdd[1]}-${yyyymmdd[2].padStart(2, "0")}-${yyyymmdd[3].padStart(2, "0")}`;
    }
    return "";
  };

  const parseAmount = (val: string): number => {
    if (!val || val === "-" || val === "–") return 0;
    const cleaned = val.replace(/[₪$€,\s]/g, "");
    return parseFloat(cleaned) || 0;
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvError(null);
    setCsvFileName(file.name);
    setCsvParsingDone(false);
    setDuplicateDates(new Set());
    setOverwriteExisting(false);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      encoding: "UTF-8",
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      complete: async (results) => {
        try {
          if (results.data.length === 0) {
            setCsvError("הקובץ חייב להכיל לפחות שורת כותרות ושורת נתונים אחת");
            return;
          }

          // Normalize header for matching
          const normalizeHeader = (h: string): string => {
            return h.replace(/"/g, '""').replace(/\u05F3/g, "'").trim();
          };

          // Map CSV headers to canonical field names
          const headerAliases: Record<string, string> = {
            // Date
            "תאריך": "entry_date",
            // Main fields - handle the double-quote escaping from CSV
            'סה"כ z יומי': "total_register",
            'סה""כ z יומי': "total_register",
            "ע.עובדים יומית ללא העמסה": "labor_cost",
            "כמות שעות עובדים": "labor_hours",
            "זיכוי+ביטול+הנחות ב ₪": "discounts",
            "יום חלקי/יום מלא": "day_factor",
            "עסק": "business_name",
            // Income sources (1-4)
            'סה"כ הכנסות 1': "income_amount_1",
            'סה""כ הכנסות 1': "income_amount_1",
            'סה"כ הכנסות 2': "income_amount_2",
            'סה""כ הכנסות 2': "income_amount_2",
            'סה"כ הכנסות 3': "income_amount_3",
            'סה""כ הכנסות 3': "income_amount_3",
            'סה"כ הכנסות 4': "income_amount_4",
            'סה""כ הכנסות 4': "income_amount_4",
            // Orders count (1-4)
            "כמות הזמנות 1": "orders_count_1",
            "כמות הזמנות 2": "orders_count_2",
            "כמות הזמנות 3": "orders_count_3",
            "כמות הזמנות 4": "orders_count_4",
            // Receipts (1-4)
            "תקבולים 1": "receipt_amount_1",
            "תקבולים 2": "receipt_amount_2",
            "תקבולים 3": "receipt_amount_3",
            "תקבולים 4": "receipt_amount_4",
            // Diner cards
            "כרטיסי סועד": "diner_cards",
            // Product stock (1-3)
            "מלאי פתיחה מוצר מנוהל 1": "product_opening_1",
            "מלאי פתיחה מוצר מנוהל 2": "product_opening_2",
            "מלאי פתיחה מוצר מנוהל 3": "product_opening_3",
            "מלאי סגירה מוצר מנוהל 1": "product_closing_1",
            "מלאי סגירה מוצר מנוהל 2": "product_closing_2",
            "מלאי סגירה מוצר מנוהל 3": "product_closing_3",
            "כמה יחידות מוצר מנוהל קיבלנו (מוצר 1)": "product_received_1",
            "כמה יחידות מוצר מנוהל קיבלנו (מוצר 2)": "product_received_2",
            "כמה יחידות מוצר מנוהל קיבלנו (מוצר 3)": "product_received_3",
            "שימוש בפועל (מוצר מנוהל 1)": "product_usage_1",
            "שימוש בפועל (מוצר מנוהל 2)": "product_usage_2",
            "שימוש בפועל (מוצר מנוהל 3)": "product_usage_3",
          };

          const detectedFields = results.meta.fields || [];
          const fieldMap: Record<string, string> = {};

          for (const header of detectedFields) {
            let canonical = headerAliases[header];
            if (!canonical) {
              const normalized = normalizeHeader(header);
              canonical = headerAliases[normalized];
            }
            if (canonical && !fieldMap[canonical]) {
              fieldMap[canonical] = header;
            }
          }

          if (!fieldMap["entry_date"]) {
            setCsvError(`לא נמצאה עמודת "תאריך" בקובץ. עמודות שנמצאו: ${detectedFields.join(", ")}`);
            return;
          }

          const getField = (row: Record<string, string>, canonical: string): string => {
            const header = fieldMap[canonical];
            return header ? (row[header] ?? "").trim() : "";
          };

          const entries: CsvDailyEntry[] = [];
          const errors: string[] = [];

          results.data.forEach((row, rowIdx) => {
            const dateRaw = getField(row, "entry_date");
            if (!dateRaw) return;

            const entry_date = parseDate(dateRaw);
            if (!entry_date) {
              errors.push(`שורה ${rowIdx + 2}: תאריך לא תקין "${dateRaw}" - דילוג`);
              return;
            }

            const total_register = parseAmount(getField(row, "total_register"));
            const labor_cost = parseAmount(getField(row, "labor_cost"));
            const labor_hours = parseAmount(getField(row, "labor_hours"));
            const discounts = parseAmount(getField(row, "discounts"));
            const day_factor = parseAmount(getField(row, "day_factor")) || 1;
            const business_name = getField(row, "business_name");

            // Income sources (1-4)
            const income_amounts = [
              parseAmount(getField(row, "income_amount_1")),
              parseAmount(getField(row, "income_amount_2")),
              parseAmount(getField(row, "income_amount_3")),
              parseAmount(getField(row, "income_amount_4")),
            ];
            const orders_counts = [
              parseAmount(getField(row, "orders_count_1")),
              parseAmount(getField(row, "orders_count_2")),
              parseAmount(getField(row, "orders_count_3")),
              parseAmount(getField(row, "orders_count_4")),
            ];

            // Receipts (1-4)
            const receipt_amounts = [
              parseAmount(getField(row, "receipt_amount_1")),
              parseAmount(getField(row, "receipt_amount_2")),
              parseAmount(getField(row, "receipt_amount_3")),
              parseAmount(getField(row, "receipt_amount_4")),
            ];

            const diner_cards = parseAmount(getField(row, "diner_cards"));

            // Product stock (1-3)
            const product_openings = [
              parseAmount(getField(row, "product_opening_1")),
              parseAmount(getField(row, "product_opening_2")),
              parseAmount(getField(row, "product_opening_3")),
            ];
            const product_closings = [
              parseAmount(getField(row, "product_closing_1")),
              parseAmount(getField(row, "product_closing_2")),
              parseAmount(getField(row, "product_closing_3")),
            ];
            const product_received = [
              parseAmount(getField(row, "product_received_1")),
              parseAmount(getField(row, "product_received_2")),
              parseAmount(getField(row, "product_received_3")),
            ];
            const product_usage_vals = [
              parseAmount(getField(row, "product_usage_1")),
              parseAmount(getField(row, "product_usage_2")),
              parseAmount(getField(row, "product_usage_3")),
            ];

            entries.push({
              entry_date,
              total_register,
              labor_cost,
              labor_hours,
              discounts,
              day_factor,
              business_name,
              income_amounts,
              orders_counts,
              receipt_amounts,
              diner_cards,
              product_openings,
              product_closings,
              product_received,
              product_usage: product_usage_vals,
            });
          });

          if (errors.length > 0 && entries.length === 0) {
            setCsvError(errors.join("\n"));
            return;
          }

          if (errors.length > 0) {
            setCsvError(`נטענו ${entries.length} רשומות מתוך ${entries.length + errors.length} שורות. ${errors.length} דולגו:\n${errors.join("\n")}`);
          }

          // Check for duplicates
          if (selectedBusinessId && entries.length > 0) {
            const dates = entries.map(e => e.entry_date);
            const minDate = dates.reduce((a, b) => a < b ? a : b);
            const maxDate = dates.reduce((a, b) => a > b ? a : b);

            const { data: existing } = await supabase
              .from("daily_entries")
              .select("entry_date")
              .eq("business_id", selectedBusinessId)
              .gte("entry_date", minDate)
              .lte("entry_date", maxDate);

            if (existing && existing.length > 0) {
              setDuplicateDates(new Set(existing.map(e => e.entry_date)));
            }
          }

          setCsvEntries(entries);
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

  const handleRemoveEntry = (index: number) => {
    setCsvEntries(csvEntries.filter((_, i) => i !== index));
  };

  const handleClearCsv = () => {
    setCsvEntries([]);
    setCsvFileName(null);
    setCsvError(null);
    setCsvParsingDone(false);
    setDuplicateDates(new Set());
    setOverwriteExisting(false);
    setImportProgress("");
    if (csvInputRef.current) csvInputRef.current.value = "";
  };

  const handleImport = async () => {
    if (!selectedBusinessId) {
      showToast("יש לבחור עסק לפני הייבוא", "error");
      return;
    }
    if (csvEntries.length === 0) {
      showToast("אין רשומות לייבוא", "error");
      return;
    }

    setIsImporting(true);
    setImportProgress("מתחיל ייבוא...");

    try {
      const { data: { user } } = await supabase.auth.getUser();

      let imported = 0;
      let skipped = 0;

      for (let i = 0; i < csvEntries.length; i++) {
        const entry = csvEntries[i];
        const isDuplicate = duplicateDates.has(entry.entry_date);

        if (isDuplicate && !overwriteExisting) {
          skipped++;
          continue;
        }

        setImportProgress(`מייבא ${i + 1}/${csvEntries.length}...`);

        // If overwriting, delete existing entry and related data
        if (isDuplicate && overwriteExisting) {
          const { data: existingEntry } = await supabase
            .from("daily_entries")
            .select("id")
            .eq("business_id", selectedBusinessId)
            .eq("entry_date", entry.entry_date)
            .maybeSingle();

          if (existingEntry) {
            await Promise.all([
              supabase.from("daily_income_breakdown").delete().eq("daily_entry_id", existingEntry.id),
              supabase.from("daily_receipts").delete().eq("daily_entry_id", existingEntry.id),
              supabase.from("daily_parameters").delete().eq("daily_entry_id", existingEntry.id),
              supabase.from("daily_product_usage").delete().eq("daily_entry_id", existingEntry.id),
            ]);
            await supabase.from("daily_entries").delete().eq("id", existingEntry.id);
          }
        }

        // Insert daily entry
        const { data: dailyEntry, error: entryError } = await supabase
          .from("daily_entries")
          .insert({
            business_id: selectedBusinessId,
            entry_date: entry.entry_date,
            total_register: entry.total_register,
            labor_cost: entry.labor_cost,
            labor_hours: entry.labor_hours,
            discounts: entry.discounts,
            day_factor: entry.day_factor,
            created_by: user?.id || null,
          })
          .select("id")
          .single();

        if (entryError) {
          if (entryError.code === "23505") {
            skipped++;
            continue;
          }
          showToast(`שגיאה בשורה ${i + 1} (${entry.entry_date}): ${entryError.message}`, "error");
          continue;
        }

        const entryId = dailyEntry.id;

        // Insert income breakdowns
        const incomeRows = [];
        for (let j = 0; j < incomeSources.length && j < 4; j++) {
          const amount = entry.income_amounts[j] || 0;
          const ordersCount = entry.orders_counts[j] || 0;
          if (amount > 0 || ordersCount > 0) {
            incomeRows.push({
              daily_entry_id: entryId,
              income_source_id: incomeSources[j].id,
              amount,
              orders_count: ordersCount,
            });
          }
        }
        if (incomeRows.length > 0) {
          const { error } = await supabase.from("daily_income_breakdown").insert(incomeRows);
          if (error) console.error("Income insert error:", error);
        }

        // Handle diner cards - match to income source or receipt type named "כרטיסי סועד" / "סועד"
        if (entry.diner_cards > 0) {
          const dinerSource = incomeSources.find(s =>
            s.name.includes("סועד") || s.name.includes("כרטיסי סועד")
          );
          if (dinerSource) {
            // Check if we already inserted for this source
            const alreadyInserted = incomeRows.some(r => r.income_source_id === dinerSource.id);
            if (!alreadyInserted) {
              await supabase.from("daily_income_breakdown").insert({
                daily_entry_id: entryId,
                income_source_id: dinerSource.id,
                amount: entry.diner_cards,
                orders_count: 0,
              });
            }
          } else {
            const dinerReceipt = receiptTypes.find(r =>
              r.name.includes("סועד") || r.name.includes("כרטיסי סועד")
            );
            if (dinerReceipt) {
              await supabase.from("daily_receipts").insert({
                daily_entry_id: entryId,
                receipt_type_id: dinerReceipt.id,
                amount: entry.diner_cards,
              });
            }
          }
        }

        // Insert receipts
        const receiptRows = [];
        for (let j = 0; j < receiptTypes.length && j < 4; j++) {
          const amount = entry.receipt_amounts[j] || 0;
          if (amount > 0) {
            receiptRows.push({
              daily_entry_id: entryId,
              receipt_type_id: receiptTypes[j].id,
              amount,
            });
          }
        }
        if (receiptRows.length > 0) {
          const { error } = await supabase.from("daily_receipts").insert(receiptRows);
          if (error) console.error("Receipt insert error:", error);
        }

        // Insert product usage
        for (let j = 0; j < managedProducts.length && j < 3; j++) {
          const opening = entry.product_openings[j] || 0;
          const received = entry.product_received[j] || 0;
          const closing = entry.product_closings[j] || 0;
          const usage = entry.product_usage[j] || 0;

          if (opening > 0 || received > 0 || closing > 0 || usage > 0) {
            const quantityUsed = usage > 0 ? usage : (opening + received - closing);

            const { error } = await supabase.from("daily_product_usage").insert({
              daily_entry_id: entryId,
              product_id: managedProducts[j].id,
              opening_stock: opening,
              received_quantity: received,
              closing_stock: closing,
              quantity: quantityUsed,
              unit_cost_at_time: managedProducts[j].unit_cost,
            });
            if (error) console.error("Product usage insert error:", error);
          }
        }

        imported++;
      }

      const msg = skipped > 0
        ? `יובאו ${imported} רשומות בהצלחה (${skipped} דולגו - כבר קיימות)`
        : `יובאו ${imported} רשומות בהצלחה`;
      showToast(msg, "success");
      handleClearCsv();
    } catch {
      showToast("שגיאה בלתי צפויה בייבוא", "error");
    } finally {
      setIsImporting(false);
      setImportProgress("");
    }
  };

  // Stats
  const totalRegisterSum = csvEntries.reduce((acc, e) => acc + e.total_register, 0);
  const laborCostSum = csvEntries.reduce((acc, e) => acc + e.labor_cost, 0);
  const newEntries = csvEntries.filter(e => !duplicateDates.has(e.entry_date));
  const duplicateEntries = csvEntries.filter(e => duplicateDates.has(e.entry_date));

  const dateRange = csvEntries.length > 0
    ? {
        min: csvEntries.reduce((a, b) => a.entry_date < b.entry_date ? a : b).entry_date,
        max: csvEntries.reduce((a, b) => a.entry_date > b.entry_date ? a : b).entry_date,
      }
    : null;

  return (
    <div className="min-h-screen bg-[#0F1535] p-4 md:p-8" dir="rtl">
      <div className="max-w-[700px] mx-auto flex flex-col gap-[20px]">
        {/* Page Title */}
        <div className="text-center">
          <h1 className="text-[22px] font-bold text-white">ייבוא מילוי יומי</h1>
          <p className="text-[14px] text-white/50 mt-1">
            בחר עסק והעלה קובץ CSV עם נתוני מילוי יומי
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
              {isLoadingConfig ? (
                <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
              ) : (
                <span className="text-[12px] text-white/40">
                  {incomeSources.length} מקורות הכנסה | {receiptTypes.length} סוגי תקבולים | {managedProducts.length} מוצרים מנוהלים
                </span>
              )}
            </div>
          )}
        </div>

        {/* Mapping Preview */}
        {selectedBusinessId && !isLoadingConfig && (incomeSources.length > 0 || receiptTypes.length > 0 || managedProducts.length > 0) && (
          <div className="bg-[#0F1535] rounded-[15px] p-[15px]">
            <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">מיפוי עמודות</h3>
            <p className="text-[12px] text-white/40 text-right mb-[8px]">
              העמודות הממוספרות ב-CSV יתאימו לפי סדר התצוגה במערכת:
            </p>
            {incomeSources.length > 0 && (
              <div className="mb-[8px]">
                <span className="text-[12px] text-[#8B93FF] font-bold">מקורות הכנסה:</span>
                <div className="flex flex-wrap gap-[4px] mt-[4px]">
                  {incomeSources.map((s, i) => (
                    <span key={s.id} className="text-[11px] px-[6px] py-[2px] rounded bg-[#4956D4]/20 text-[#8B93FF]">
                      {`הכנסות ${i + 1} = ${s.name}`}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {receiptTypes.length > 0 && (
              <div className="mb-[8px]">
                <span className="text-[12px] text-[#FFA412] font-bold">תקבולים:</span>
                <div className="flex flex-wrap gap-[4px] mt-[4px]">
                  {receiptTypes.map((r, i) => (
                    <span key={r.id} className="text-[11px] px-[6px] py-[2px] rounded bg-[#FFA412]/20 text-[#FFA412]">
                      {`תקבולים ${i + 1} = ${r.name}`}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {managedProducts.length > 0 && (
              <div>
                <span className="text-[12px] text-[#3CD856] font-bold">מוצרים מנוהלים:</span>
                <div className="flex flex-wrap gap-[4px] mt-[4px]">
                  {managedProducts.map((p, i) => (
                    <span key={p.id} className="text-[11px] px-[6px] py-[2px] rounded bg-[#3CD856]/20 text-[#3CD856]">
                      {`מוצר ${i + 1} = ${p.name}`}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* CSV Upload Area */}
        <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">העלאת קובץ מילוי יומי</h3>

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
                  <span className="text-[14px] text-white">רשומות נטענו בהצלחה</span>
                  <span className="text-[16px] font-bold text-[#3CD856]">{csvEntries.length}</span>
                </div>
                <div className="flex flex-wrap gap-[8px] justify-start">
                  {dateRange && (
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-white/10 text-white/60">
                      {`${dateRange.min} עד ${dateRange.max}`}
                    </span>
                  )}
                  <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#FFA412]/20 text-[#FFA412]">
                    {`סה"כ קופה: ₪${totalRegisterSum.toLocaleString()}`}
                  </span>
                  <span className="text-[11px] px-[6px] py-[2px] rounded bg-white/10 text-white/60">
                    {`עלות עובדים: ₪${laborCostSum.toLocaleString()}`}
                  </span>
                </div>

                {/* Duplicate info */}
                {duplicateEntries.length > 0 && (
                  <div className="mt-[8px] flex flex-wrap gap-[8px] justify-start">
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#3CD856]/20 text-[#3CD856]">
                      חדשות: {newEntries.length}
                    </span>
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#F64E60]/20 text-[#F64E60]">
                      כפולות (כבר קיימות): {duplicateEntries.length}
                    </span>
                  </div>
                )}
              </div>

              {/* Overwrite option for duplicates */}
              {duplicateEntries.length > 0 && (
                <div className="bg-[#FFA412]/10 border border-[#FFA412]/30 rounded-[10px] p-[10px] mb-[10px]">
                  <p className="text-[13px] text-[#FFA412] text-right font-bold mb-[6px]">
                    נמצאו {duplicateEntries.length} תאריכים שכבר קיימים במערכת
                  </p>
                  <p className="text-[12px] text-white/50 text-right mb-[8px]">
                    ברירת מחדל: דילוג על תאריכים קיימים. ניתן לבחור לדרוס נתונים קיימים.
                  </p>
                  <label className="flex items-center gap-[8px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overwriteExisting}
                      onChange={(e) => setOverwriteExisting(e.target.checked)}
                      className="w-4 h-4 accent-[#FFA412]"
                    />
                    <span className="text-[13px] text-white">דרוס נתונים קיימים</span>
                  </label>
                </div>
              )}
            </>
          )}
        </div>

        {/* Entries Preview */}
        {csvEntries.length > 0 && (
          <div className="bg-[#0F1535] rounded-[15px] p-[15px]">
            <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">רשומות שנטענו ({csvEntries.length})</h3>
            <div className="flex flex-col gap-[8px] max-h-[400px] overflow-y-auto">
              {csvEntries.map((entry, index) => {
                const isDuplicate = duplicateDates.has(entry.entry_date);
                return (
                  <div key={index} className={`flex items-center justify-between rounded-[10px] p-[10px] ${
                    isDuplicate
                      ? "bg-[#FFA412]/5 border border-[#FFA412]/20"
                      : "bg-[#4956D4]/10 border border-[#4956D4]/30"
                  }`}>
                    <div className="flex-1 text-right">
                      <div className="flex items-center gap-[6px] justify-start flex-wrap">
                        {isDuplicate && (
                          <span className="text-[10px] px-[4px] py-[1px] rounded bg-[#FFA412]/20 text-[#FFA412]">
                            {overwriteExisting ? "יידרס" : "ידולג"}
                          </span>
                        )}
                        <span className="text-[14px] text-white font-medium">{entry.entry_date}</span>
                        <span className="text-[11px] text-[#FFA412] font-medium">
                          {`קופה: ₪${entry.total_register.toLocaleString()}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-[10px] justify-start mt-[3px] flex-wrap">
                        <span className="text-[10px] text-white/30">
                          {`עובדים: ₪${entry.labor_cost.toLocaleString()}`}
                        </span>
                        <span className="text-[10px] text-white/30">
                          {`שעות: ${entry.labor_hours}`}
                        </span>
                        {entry.discounts > 0 && (
                          <span className="text-[10px] text-white/30">
                            {`הנחות: ₪${entry.discounts.toLocaleString()}`}
                          </span>
                        )}
                        {entry.day_factor < 1 && (
                          <span className="text-[10px] text-[#FFA412]">
                            {`יום חלקי: ${entry.day_factor}`}
                          </span>
                        )}
                        {entry.income_amounts.some(a => a > 0) && (
                          <span className="text-[10px] text-[#8B93FF]">
                            {`הכנסות: ${entry.income_amounts.filter(a => a > 0).map(a => `₪${a.toLocaleString()}`).join(" | ")}`}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveEntry(index)}
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

        {/* Import Button */}
        {csvEntries.length > 0 && (
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
              overwriteExisting
                ? `ייבא ${csvEntries.length} רשומות (כולל דריסת ${duplicateEntries.length} קיימות)`
                : duplicateEntries.length > 0
                  ? `ייבא ${newEntries.length} רשומות חדשות (${duplicateEntries.length} ידולגו)`
                  : `ייבא ${csvEntries.length} רשומות`
            )}
          </button>
        )}

        {/* Format Guide */}
        <div className="bg-[#0F1535] rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">מבנה הקובץ הנדרש</h3>
          <p className="text-[12px] text-white/50 text-right mb-[10px]">
            הקובץ צריך להיות ייצוא מ-Bubble עם כותרות בעברית. העמודות הממוספרות (הכנסות 1, תקבולים 1, מוצר 1) מותאמות לפי סדר התצוגה של ההגדרות בעסק.
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
                  <td className="py-[4px] px-[8px]">תאריך</td>
                  <td className="py-[4px] px-[8px] text-[#F64E60]">כן</td>
                  <td className="py-[4px] px-[8px]">01/12/2025 00:00</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">{`סה"כ z יומי`}</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">20604</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">ע.עובדים יומית ללא העמסה</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">5637.5</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">כמות שעות עובדים</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">102.5</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">{`סה"כ הכנסות 1/2/3/4`}</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">18020</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">תקבולים 1/2/3/4</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">500</td>
                </tr>
                <tr>
                  <td className="py-[4px] px-[8px]">מלאי פתיחה/סגירה מוצר מנוהל 1/2/3</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">50</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="bg-[#4956D4]/10 rounded-[8px] p-[10px] mt-[10px]">
            <p className="text-[11px] text-white/40 text-right">
              {`תאריכים עם שעה (01/12/2025 00:00) מטופלים אוטומטית. עמודות שלא מותאמות (כמו "הכנסות", "שכר מנהל יומי") מדולגות. תאריכים כפולים מזוהים אוטומטית.`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
