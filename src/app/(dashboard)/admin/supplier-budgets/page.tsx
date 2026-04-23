"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

// ============================================================================
// TYPES
// ============================================================================

interface Business { id: string; name: string; }
interface Supplier { id: string; name: string; }

interface ParsedBudgetRow {
  supplierName: string;
  supplierId: string | null; // null = unmatched
  year: number;
  month: number;
  budget_amount: number;
}

// ============================================================================
// HELPERS
// ============================================================================

function parseNum(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(String(v).replace(/[,\s]/g, ""));
  return isNaN(n) ? null : n;
}

const MONTH_NAMES = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

// ============================================================================
// COMPONENT
// ============================================================================

export default function SupplierBudgetsImportPage() {
  const supabase = createClient();
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState<string>("admin:supplier-budgets:businessId", "");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [rows, setRows] = useState<ParsedBudgetRow[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");

  // ── Fetch businesses ───────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from("businesses").select("id, name").order("name").then(({ data }) => {
      if (data) {
        setBusinesses(data);
        if (!selectedBusinessId && data.length > 0) setSelectedBusinessId(data[0].id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch suppliers when business changes ──────────────────────────────────
  const fetchSuppliersForBiz = useCallback(() => {
    if (!selectedBusinessId) { setSuppliers([]); return; }
    supabase.from("suppliers").select("id, name").eq("business_id", selectedBusinessId).then(({ data }) => {
      setSuppliers(data || []);
    });
  }, [selectedBusinessId, supabase]);
  useEffect(() => { fetchSuppliersForBiz(); }, [fetchSuppliersForBiz]);
  // Realtime — pick up suppliers added by others while the budgets CSV is
  // being prepared, so the name-match doesn't fail on a legit new supplier.
  useMultiTableRealtime(
    ["suppliers"],
    fetchSuppliersForBiz,
    !!selectedBusinessId,
  );

  // ── Parse CSV ──────────────────────────────────────────────────────────────
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (suppliers.length === 0) {
      showToast("יש לבחור עסק תחילה", "error");
      return;
    }

    Papa.parse(file, {
      header: true, skipEmptyLines: true, encoding: "UTF-8",
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
      complete: ({ data }) => {
        const csvRows = data as Record<string, string>[];

        // Build supplier map: name.toLowerCase() → id
        const supplierMap = new Map(suppliers.map(s => [s.name.trim().toLowerCase(), s.id]));

        // Aggregate: same (supplier, year, month) → SUM budget_amount
        const aggregated = new Map<string, ParsedBudgetRow>();
        const unmatchedSet = new Set<string>();

        for (const row of csvRows) {
          const supplierName = (row["ספק"] || "").trim();
          if (!supplierName) continue;

          const year  = parseInt(row["שנה"]);
          const month = parseInt(row["חודש (במספר)"]);
          if (!year || !month) continue;

          const supplierId = supplierMap.get(supplierName.toLowerCase()) ?? null;
          if (!supplierId) { unmatchedSet.add(supplierName); }

          const key = `${supplierName}:${year}:${month}`;
          const prev = aggregated.get(key);
          if (prev) {
            prev.budget_amount += parseNum(row["סכום תקציב חודשי"]) ?? 0;
          } else {
            aggregated.set(key, {
              supplierName,
              supplierId,
              year,
              month,
              budget_amount: parseNum(row["סכום תקציב חודשי"]) ?? 0,
            });
          }
        }

        setRows([...aggregated.values()]);
        setUnmatched([...unmatchedSet].sort());
        showToast(`נטענו ${csvRows.length} שורות CSV → ${aggregated.size} רשומות`, "info");
      },
      error: () => showToast("שגיאה בקריאת הקובץ", "error"),
    });
  };

  // ── Import ─────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!selectedBusinessId) { showToast("יש לבחור עסק", "error"); return; }
    const matched = rows.filter(r => r.supplierId !== null);
    if (matched.length === 0) { showToast("אין רשומות תואמות לייבוא", "error"); return; }

    setIsImporting(true);
    setImportProgress("מוחק רשומות קיימות...");

    // Delete existing
    const { error: delErr } = await supabase.from("supplier_budgets")
      .delete().eq("business_id", selectedBusinessId);
    if (delErr) {
      showToast(`שגיאה במחיקה: ${delErr.message}`, "error");
      setIsImporting(false);
      setImportProgress("");
      return;
    }

    // Batch insert
    const BATCH = 100;
    let inserted = 0, errors = 0;

    for (let i = 0; i < matched.length; i += BATCH) {
      const batch = matched.slice(i, i + BATCH).map(r => ({
        business_id:   selectedBusinessId,
        supplier_id:   r.supplierId!,
        year:          r.year,
        month:         r.month,
        budget_amount: r.budget_amount,
      }));
      setImportProgress(`${Math.min(i + BATCH, matched.length)}/${matched.length}`);
      const { error } = await supabase.from("supplier_budgets").insert(batch);
      if (error) { errors += batch.length; }
      else { inserted += batch.length; }
    }

    setIsImporting(false);
    setImportProgress("");

    if (errors === 0) {
      showToast(`יובאו ${inserted} תקציבי ספקים בהצלחה`, "success");
      setRows([]); setUnmatched([]);
      if (fileRef.current) fileRef.current.value = "";
    } else {
      showToast(`יובאו ${inserted}, נכשלו ${errors}`, "error");
    }
  };

  const matched = rows.filter(r => r.supplierId !== null);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0F1535] p-4 md:p-8" dir="rtl">
      <div className="max-w-[900px] mx-auto flex flex-col gap-[20px]">

        {/* Title */}
        <div className="text-center">
          <h1 className="text-[22px] font-bold text-white">ייבוא תקציבי ספקים</h1>
          <p className="text-[14px] text-white/50 mt-1">ייבוא מקובץ Bubble: תקציבי ספקים</p>
        </div>

        {/* Business Selector */}
        <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white mb-[10px]">בחר עסק</h3>
          <Select
            value={selectedBusinessId || "__none__"}
            onValueChange={(v) => {
              setSelectedBusinessId(v === "__none__" ? "" : v);
              setRows([]); setUnmatched([]);
              if (fileRef.current) fileRef.current.value = "";
            }}
          >
            <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
              <SelectValue placeholder="-- בחר עסק --" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">-- בחר עסק --</SelectItem>
              {businesses.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {selectedBusinessId && suppliers.length > 0 && (
            <p className="text-[12px] text-white/40 mt-[8px]">נטענו {suppliers.length} ספקים מהעסק</p>
          )}
        </div>

        {/* File upload */}
        {selectedBusinessId && (
          <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
            <h3 className="text-[16px] font-bold text-white mb-[10px]">קובץ CSV</h3>
            <p className="text-[13px] text-white/60 mb-[8px]">
              <span className="text-[#8B93FF] font-bold">קובץ תקציבי ספקים</span>
              <br/>
              <span className="text-white/40 text-[12px]">עמודות: ספק, שנה, חודש (במספר), סכום תקציב חודשי — שורות כפולות לאותו ספק/חודש מצטברות אוטומטית</span>
            </p>
            <label className="flex border border-dashed border-[#4C526B] rounded-[10px] h-[48px] items-center justify-center cursor-pointer hover:border-[#4956D4] transition-colors">
              <span className="text-[14px] text-white/60">
                {rows.length > 0 ? `✅ ${rows.length} רשומות (${matched.length} תואמות)` : "לחץ לבחירת קובץ CSV"}
              </span>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
            </label>
          </div>
        )}

        {/* Unmatched suppliers warning */}
        {unmatched.length > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-[15px] p-[15px]">
            <h3 className="text-[14px] font-bold text-yellow-400 mb-[8px]">⚠️ ספקים שלא נמצאו ({unmatched.length})</h3>
            <p className="text-[12px] text-white/50 mb-[8px]">הספקים הבאים לא קיימים בעסק — השורות שלהם לא יייובאו:</p>
            <div className="flex flex-wrap gap-[6px]">
              {unmatched.map(s => (
                <span key={s} className="bg-yellow-500/20 text-yellow-300 text-[12px] px-[8px] py-[3px] rounded-full">{s}</span>
              ))}
            </div>
          </div>
        )}

        {/* Preview */}
        {rows.length > 0 && (
          <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
            <div className="flex items-center justify-between mb-[15px]">
              <h3 className="text-[16px] font-bold text-white">תצוגה מקדימה</h3>
              <div className="flex items-center gap-[12px]">
                <span className="text-[13px] text-[#3CD856] font-bold">{matched.length} תואמות</span>
                {unmatched.length > 0 && (
                  <span className="text-[13px] text-yellow-400 font-bold">{rows.length - matched.length} לא תואמות</span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="w-full flex flex-col">
                {/* Header */}
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr] bg-[#29318A] rounded-t-[7px] p-[10px_5px] pe-[13px] items-center">
                  <span className="text-[12px] text-white/60 font-bold px-[4px]">ספק</span>
                  <span className="text-[12px] text-white/60 font-bold">חודש</span>
                  <span className="text-[12px] text-white/60 font-bold">שנה</span>
                  <span className="text-[12px] text-white/60 font-bold">תקציב חודשי</span>
                </div>
                {/* Rows */}
                <div className="max-h-[400px] overflow-y-auto flex flex-col gap-[3px] bg-[#1a2040] rounded-b-[7px]">
                  {rows.map((r, i) => (
                    <div
                      key={i}
                      className={`grid grid-cols-[2fr_1fr_1fr_1fr] w-full p-[8px_5px] text-[12px] border-b border-white/5 ${r.supplierId ? "text-white/80" : "text-yellow-400/60"}`}
                    >
                      <span className="px-[4px] truncate">
                        {r.supplierId ? "" : "⚠️ "}{r.supplierName}
                      </span>
                      <span>{MONTH_NAMES[r.month - 1]}</span>
                      <span>{r.year}</span>
                      <span>₪{r.budget_amount.toLocaleString("he-IL")}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <Button
              onClick={handleImport}
              disabled={isImporting || matched.length === 0}
              className="w-full mt-[15px] h-[50px] bg-[#3CD856] hover:bg-[#34c04c] text-[#0F1535] text-[16px] font-bold rounded-[10px] disabled:opacity-50"
            >
              {isImporting ? `מייבא ${importProgress}...` : `ייבא ${matched.length} תקציבי ספקים`}
            </Button>
          </div>
        )}

      </div>
    </div>
  );
}
