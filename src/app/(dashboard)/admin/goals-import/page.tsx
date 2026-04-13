"use client";

import { useState, useRef, useEffect } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

// ============================================================================
// TYPES
// ============================================================================

interface Business { id: string; name: string; }

interface ParsedGoalRow {
  year: number;
  month: number;
  revenue_target: number | null;
  labor_cost_target_pct: number | null;
  food_cost_target_pct: number | null;
  current_expenses_target: number | null;
  goods_expenses_target: number | null;
  markup_percentage: number | null;
  // from פרטים CSV (merged)
  expected_work_days: number | null;
  actual_work_days: number | null;
  vat_percentage: number | null;
  markup_loading: number | null; // העמסה
}

// ============================================================================
// HELPERS
// ============================================================================

function parseNum(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(String(v).replace(/[,\s]/g, ""));
  return isNaN(n) ? null : n;
}

function parseDate(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  const cleaned = trimmed.replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*(am|pm))?$/i, "").trim();
  const ddmm = cleaned.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2, "0")}-${ddmm[1].padStart(2, "0")}`;
  if (cleaned.match(/^\d{4}-\d{2}-\d{2}$/)) return cleaned;
  const MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const b = trimmed.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/);
  if (b) {
    const m = MONTHS[b[1].toLowerCase()];
    if (m) return `${b[3]}-${m}-${b[2].padStart(2, "0")}`;
  }
  return "";
}

// Determine month from creation date (month after creation)
function monthFromCreationDate(creationDate: string): { year: number; month: number } | null {
  const parsed = parseDate(creationDate);
  if (!parsed) return null;
  const d = new Date(parsed);
  // The settings are created the month before they apply
  d.setMonth(d.getMonth() + 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function GoalsImportPage() {
  const supabase = createClient();
  const { showToast } = useToast();
  const goalsFileRef = useRef<HTMLInputElement>(null);
  const detailsFileRef = useRef<HTMLInputElement>(null);

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState<string>("admin:goals-import:businessId", "");

  // CSV state
  const [goalsRows, setGoalsRows] = useState<Record<string, string>[]>([]);
  const [detailsRows, setDetailsRows] = useState<Record<string, string>[]>([]);
  const [merged, setMerged] = useState<ParsedGoalRow[]>([]);
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

  // ── Parse goals CSV ────────────────────────────────────────────────────────
  const handleGoalsFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true, skipEmptyLines: true, encoding: "UTF-8",
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
      complete: ({ data }) => {
        setGoalsRows(data as Record<string, string>[]);
        showToast(`נטענו ${(data as unknown[]).length} שורות יעדים`, "info");
      },
      error: () => showToast("שגיאה בקריאת קובץ יעדים", "error"),
    });
  };

  // ── Parse details CSV ──────────────────────────────────────────────────────
  const handleDetailsFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true, skipEmptyLines: true, encoding: "UTF-8",
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
      complete: ({ data }) => {
        setDetailsRows(data as Record<string, string>[]);
        showToast(`נטענו ${(data as unknown[]).length} שורות פרטים`, "info");
      },
      error: () => showToast("שגיאה בקריאת קובץ פרטים", "error"),
    });
  };

  // ── Merge both CSVs by index ───────────────────────────────────────────────
  useEffect(() => {
    if (goalsRows.length === 0) { setMerged([]); return; }
    const rows: ParsedGoalRow[] = [];
    for (let i = 0; i < goalsRows.length; i++) {
      const g = goalsRows[i];
      const d = detailsRows[i] || {};
      const year  = parseInt(g["שנה"]);
      const month = parseInt(g["חודש (מספר)"]);
      if (!year || !month) continue;
      rows.push({
        year, month,
        revenue_target:          parseNum(g["תקציב מכירות ברוטו"]),
        labor_cost_target_pct:   parseNum(g["תקציב עלות עובדים (באחוזים)"]),
        food_cost_target_pct:    parseNum(g["תקציב עלות מכר (באחוזים)"]),
        current_expenses_target: parseNum(g["תקציב הוצאות שוטפות (בשקל)"]),
        goods_expenses_target:   parseNum(g["תקציב עלוב מכר (בשקל)"]),
        markup_percentage:       parseNum(g["מחיר מוצר מנוהל (%)"]),
        expected_work_days:      parseNum(d["ימי עבודה בחודש"]),
        actual_work_days:        parseNum(d["ימי עבודה בפועל בחודש"]),
        vat_percentage:          parseNum(d['מע"מ']),
        markup_loading:          parseNum(d["העמסה"]),
      });
    }
    setMerged(rows);
  }, [goalsRows, detailsRows]);

  // ── Import ─────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!selectedBusinessId) { showToast("יש לבחור עסק", "error"); return; }
    if (merged.length === 0) { showToast("אין נתונים לייבוא", "error"); return; }

    setIsImporting(true);
    let ok = 0, errors = 0;

    for (let i = 0; i < merged.length; i++) {
      const r = merged[i];
      setImportProgress(`${i + 1}/${merged.length}`);

      // Delete existing goal for this month
      await supabase.from("goals").delete()
        .eq("business_id", selectedBusinessId).eq("year", r.year).eq("month", r.month);

      // Insert goal
      const { error: gErr } = await supabase.from("goals").insert({
        business_id:             selectedBusinessId,
        year:                    r.year,
        month:                   r.month,
        revenue_target:          r.revenue_target,
        labor_cost_target_pct:   r.labor_cost_target_pct,
        food_cost_target_pct:    r.food_cost_target_pct,
        current_expenses_target: r.current_expenses_target,
        goods_expenses_target:   r.goods_expenses_target ?? 0,
        markup_percentage:       r.markup_percentage,
        expected_work_days:      r.expected_work_days,
        vat_percentage:          r.vat_percentage,
      });
      if (gErr) { errors++; continue; }

      // Upsert business_monthly_settings (if פרטים CSV was uploaded)
      if (detailsRows.length > 0) {
        const monthYear = `${r.year}-${String(r.month).padStart(2, "0")}`;
        await supabase.from("business_monthly_settings")
          .delete().eq("business_id", selectedBusinessId).eq("month_year", monthYear);
        await supabase.from("business_monthly_settings").insert({
          business_id:       selectedBusinessId,
          month_year:        monthYear,
          markup_percentage: r.markup_loading,
          vat_percentage:    r.vat_percentage,
        });

        // Update monthly_summaries.actual_work_days
        if (r.actual_work_days !== null) {
          await supabase.from("monthly_summaries")
            .update({ actual_work_days: r.actual_work_days })
            .eq("business_id", selectedBusinessId).eq("year", r.year).eq("month", r.month);
        }
      }

      ok++;
    }

    setIsImporting(false);
    setImportProgress("");
    if (errors === 0) {
      showToast(`יובאו ${ok} חודשים בהצלחה`, "success");
      setMerged([]); setGoalsRows([]); setDetailsRows([]);
      if (goalsFileRef.current) goalsFileRef.current.value = "";
      if (detailsFileRef.current) detailsFileRef.current.value = "";
    } else {
      showToast(`יובאו ${ok}, נכשלו ${errors}`, "error");
    }
  };

  const monthNames = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0F1535] p-4 md:p-8" dir="rtl">
      <div className="max-w-[800px] mx-auto flex flex-col gap-[20px]">

        {/* Title */}
        <div className="text-center">
          <h1 className="text-[22px] font-bold text-white">ייבוא יעדים וכוונות חודשיות</h1>
          <p className="text-[14px] text-white/50 mt-1">ייבוא מקובצי Bubble: יעדים כללים + פרטים כללים</p>
        </div>

        {/* Business Selector */}
        <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white mb-[10px]">בחר עסק</h3>
          <Select
            value={selectedBusinessId || "__none__"}
            onValueChange={(v) => setSelectedBusinessId(v === "__none__" ? "" : v)}
          >
            <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
              <SelectValue placeholder="-- בחר עסק --" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">-- בחר עסק --</SelectItem>
              {businesses.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* File uploads */}
        {selectedBusinessId && (
          <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px] flex flex-col gap-[15px]">
            <h3 className="text-[16px] font-bold text-white">קבצי CSV</h3>

            {/* Goals CSV */}
            <div>
              <p className="text-[13px] text-white/60 mb-[8px]">
                <span className="text-[#8B93FF] font-bold">קובץ יעדים כללים</span> — חובה
                <br/>
                <span className="text-white/40 text-[12px]">עמודות: שנה, חודש (מספר), תקציב מכירות ברוטו, תקציב עלות עובדים (באחוזים), תקציב עלות מכר (באחוזים), תקציב הוצאות שוטפות (בשקל)</span>
              </p>
              <label className="flex border border-dashed border-[#4C526B] rounded-[10px] h-[48px] items-center justify-center cursor-pointer hover:border-[#4956D4] transition-colors">
                <span className="text-[14px] text-white/60">
                  {goalsRows.length > 0 ? `✅ ${goalsRows.length} שורות נטענו` : "לחץ לבחירת קובץ יעדים CSV"}
                </span>
                <input ref={goalsFileRef} type="file" accept=".csv" onChange={handleGoalsFile} className="hidden" />
              </label>
            </div>

            {/* Details CSV */}
            <div>
              <p className="text-[13px] text-white/60 mb-[8px]">
                <span className="text-[#8B93FF] font-bold">קובץ פרטים כללים לכל חודש</span> — אופציונלי
                <br/>
                <span className="text-white/40 text-[12px]">עמודות: העמסה, ימי עבודה בחודש, ימי עבודה בפועל בחודש, מע&quot;מ — <strong>באותו סדר שורות</strong> כקובץ היעדים</span>
              </p>
              <label className="flex border border-dashed border-[#4C526B] rounded-[10px] h-[48px] items-center justify-center cursor-pointer hover:border-[#4956D4] transition-colors">
                <span className="text-[14px] text-white/60">
                  {detailsRows.length > 0 ? `✅ ${detailsRows.length} שורות נטענו` : "לחץ לבחירת קובץ פרטים CSV (אופציונלי)"}
                </span>
                <input ref={detailsFileRef} type="file" accept=".csv" onChange={handleDetailsFile} className="hidden" />
              </label>
            </div>
          </div>
        )}

        {/* Preview */}
        {merged.length > 0 && (
          <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
            <div className="flex items-center justify-between mb-[15px]">
              <h3 className="text-[16px] font-bold text-white">תצוגה מקדימה</h3>
              <span className="text-[13px] text-[#8B93FF] font-bold">{merged.length} חודשים</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[12px] text-white/80">
                <thead>
                  <tr className="text-white/50 border-b border-white/10">
                    <th className="text-right pb-[8px] pr-[4px]">חודש</th>
                    <th className="text-right pb-[8px]">תקציב מכירות</th>
                    <th className="text-right pb-[8px]">עלות עובדים %</th>
                    <th className="text-right pb-[8px]">עלות מכר %</th>
                    <th className="text-right pb-[8px]">הוצ׳ שוטפות</th>
                    {detailsRows.length > 0 && <th className="text-right pb-[8px]">ימי עבודה</th>}
                  </tr>
                </thead>
                <tbody>
                  {merged.map((r, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-[6px] pr-[4px] font-bold">{monthNames[r.month - 1]} {r.year}</td>
                      <td className="py-[6px]">₪{r.revenue_target?.toLocaleString("he-IL") ?? "-"}</td>
                      <td className="py-[6px]">{r.labor_cost_target_pct ?? "-"}%</td>
                      <td className="py-[6px]">{r.food_cost_target_pct ?? "-"}%</td>
                      <td className="py-[6px]">₪{r.current_expenses_target?.toLocaleString("he-IL") ?? "-"}</td>
                      {detailsRows.length > 0 && <td className="py-[6px]">{r.expected_work_days ?? "-"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button
              onClick={handleImport}
              disabled={isImporting}
              className="w-full mt-[15px] h-[50px] bg-[#3CD856] hover:bg-[#34c04c] text-[#0F1535] text-[16px] font-bold rounded-[10px] disabled:opacity-50"
            >
              {isImporting ? `מייבא ${importProgress}...` : `ייבא ${merged.length} חודשים`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
