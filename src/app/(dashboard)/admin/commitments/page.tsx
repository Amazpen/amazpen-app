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

interface ParsedCommitment {
  name: string;
  monthly_amount: number;
  total_installments: number;
  start_date: string;
  end_date: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function parseDate(raw: string): string {
  if (!raw) return "";
  // Strip time part
  const cleaned = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*(am|pm))?$/i, "").trim();
  // DD/MM/YYYY
  const ddmm = cleaned.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2, "0")}-${ddmm[1].padStart(2, "0")}`;
  // YYYY-MM-DD
  if (cleaned.match(/^\d{4}-\d{2}-\d{2}$/)) return cleaned;
  // "Dec 29, 2025" or "Jan 29, 2026"
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const mdy = cleaned.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
  if (mdy) {
    const m = months[mdy[1].toLowerCase()];
    if (m) return `${mdy[3]}-${m}-${mdy[2].padStart(2, "0")}`;
  }
  return "";
}

function parseAmount(raw: string | number | undefined): number {
  if (raw === undefined || raw === null || raw === "") return 0;
  if (typeof raw === "number") return raw;
  const cleaned = raw.replace(/[₪$€,\s]/g, "").trim();
  return parseFloat(cleaned) || 0;
}

function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return "-";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function CommitmentsImportPage() {
  const supabase = createClient();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [businesses, setBusinesses] = useState<{ id: string; name: string }[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState<string>("admin:commitments:businessId", "");

  const [parsedCommitments, setParsedCommitments] = useState<ParsedCommitment[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");

  // ============================================================================
  // FETCH BUSINESSES
  // ============================================================================

  useEffect(() => {
    async function fetchBusinesses() {
      const { data, error } = await supabase
        .from("businesses")
        .select("id, name")
        .order("name");
      if (!error && data) {
        setBusinesses(data);
        if (!selectedBusinessId && data.length > 0) setSelectedBusinessId(data[0].id);
      }
    }
    fetchBusinesses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================================
  // CSV PARSING — תומך בשני פורמטים:
  // 1. פורמט Bubble: שורה אחת להתחייבות עם כל השדות
  // 2. פורמט ישן: שורה לכל תשלום, מקובצות לפי ID
  // ============================================================================

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: "UTF-8",
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
      complete: (result) => {
        const raw = result.data as Record<string, string>[];
        if (raw.length === 0) { showToast("הקובץ ריק", "error"); return; }

        const fields = result.meta.fields || [];

        // ── פורמט Bubble: יש עמודת "שם הספק" ו"כמות תשלומים" ─────────────────
        const isBubbleFormat =
          fields.some(f => f === "שם הספק") &&
          fields.some(f => f === "כמות תשלומים");

        if (isBubbleFormat) {
          const commitments: ParsedCommitment[] = [];
          for (const row of raw) {
            const name = (row["שם הספק"] || "").trim();
            const monthly = parseAmount(row["סכום חיוב חודשי כולל ריבית (משוער)"] || row["סכום חיוב חודשי"]);
            const totalInst = parseInt(row["כמות תשלומים"]) || 0;
            const startDate = parseDate(row["תאריך חיוב ראשון"] || "");
            const endDate = parseDate(row["תאריך סיום התחייבות"] || "");

            if (!name || totalInst === 0 || !startDate) continue;

            // אם אין תאריך סיום — מחשב לפי מספר תשלומים
            let finalEndDate = endDate;
            if (!finalEndDate && startDate) {
              const d = new Date(startDate);
              d.setMonth(d.getMonth() + totalInst - 1);
              finalEndDate = d.toISOString().split("T")[0];
            }

            commitments.push({ name, monthly_amount: monthly, total_installments: totalInst, start_date: startDate, end_date: finalEndDate });
          }
          setParsedCommitments(commitments);
          showToast(`נמצאו ${commitments.length} התחייבויות`, "info");
          return;
        }

        // ── פורמט ישן: שורה לכל תשלום ────────────────────────────────────────
        // Aliases
        const aliases: Record<string, string> = {
          "שם התחייבות": "name", "שם הספק": "name",
          "סכום": "amount", "סכום תשלום": "amount",
          "מספר תשלום": "installment_number",
          "תאריך": "date", "תאריך תשלום": "date",
          "התחייבות": "group_id", "unique id": "group_id",
          "עסק": "business_name",
        };
        const fieldMap: Record<string, string> = {};
        for (const f of fields) {
          const mapped = aliases[f];
          if (mapped && !fieldMap[mapped]) fieldMap[mapped] = f;
        }
        const get = (row: Record<string, string>, key: string) =>
          fieldMap[key] ? (row[fieldMap[key]] ?? "").trim() : "";

        type OldRow = { group_id: string; name: string; amount: number; date: string };
        const rows: OldRow[] = raw.map(row => ({
          group_id: get(row, "group_id"),
          name: get(row, "name"),
          amount: parseAmount(get(row, "amount")),
          date: parseDate(get(row, "date")),
        })).filter(r => r.group_id && r.name && r.amount > 0 && r.date);

        const groups = new Map<string, OldRow[]>();
        for (const row of rows) {
          if (!groups.has(row.group_id)) groups.set(row.group_id, []);
          groups.get(row.group_id)!.push(row);
        }

        const commitments: ParsedCommitment[] = Array.from(groups.values()).map(group => {
          const sorted = group.sort((a, b) => a.date.localeCompare(b.date));
          return {
            name: group[0].name,
            monthly_amount: group[0].amount,
            total_installments: group.length,
            start_date: sorted[0].date,
            end_date: sorted[sorted.length - 1].date,
          };
        });

        setParsedCommitments(commitments);
        showToast(`נמצאו ${commitments.length} התחייבויות (${rows.length} שורות)`, "info");
      },
      error: () => showToast("שגיאה בקריאת הקובץ", "error"),
    });
  };

  // ============================================================================
  // IMPORT
  // ============================================================================

  const handleImport = async () => {
    if (!selectedBusinessId) { showToast("יש לבחור עסק", "error"); return; }
    if (parsedCommitments.length === 0) { showToast("אין התחייבויות לייבוא", "error"); return; }

    setIsImporting(true);
    setImportProgress("מייבא...");

    try {
      const { data: user } = await supabase.auth.getUser();
      const records = parsedCommitments.map(c => ({
        business_id: selectedBusinessId,
        name: c.name,
        monthly_amount: c.monthly_amount,
        total_installments: c.total_installments,
        start_date: c.start_date,
        end_date: c.end_date,
        created_by: user?.user?.id || null,
      }));

      const { error } = await supabase.from("prior_commitments").insert(records);
      if (error) { showToast(`שגיאה בייבוא: ${error.message}`, "error"); return; }

      showToast(`יובאו ${records.length} התחייבויות בהצלחה`, "success");
      handleClear();
    } catch {
      showToast("שגיאה בלתי צפויה", "error");
    } finally {
      setIsImporting(false);
      setImportProgress("");
    }
  };

  const handleClear = () => {
    setParsedCommitments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-[#0F1535] p-4 md:p-8" dir="rtl">
      <div className="max-w-[700px] mx-auto flex flex-col gap-[20px]">

        {/* Title */}
        <div className="text-center">
          <h1 className="text-[22px] font-bold text-white">ייבוא התחייבויות קודמות</h1>
          <p className="text-[14px] text-white/50 mt-1">בחר עסק והעלה קובץ CSV עם נתוני התחייבויות קודמות</p>
        </div>

        {/* Business Selector */}
        <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">בחר עסק</h3>
          <Select
            value={selectedBusinessId || "__none__"}
            onValueChange={(val) => { setSelectedBusinessId(val === "__none__" ? "" : val); handleClear(); }}
          >
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
        </div>

        {/* Upload */}
        {selectedBusinessId && (
          <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
            <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">העלאת קובץ CSV</h3>
            <p className="text-[12px] text-white/40 text-right mb-[12px]">
              תומך בייצוא מ-Bubble — כל שורה = התחייבות אחת עם עמודות: <span className="text-[#8B93FF]">שם הספק</span>, <span className="text-[#8B93FF]">כמות תשלומים</span>, <span className="text-[#8B93FF]">סכום חיוב חודשי כולל ריבית (משוער)</span>, <span className="text-[#8B93FF]">תאריך חיוב ראשון</span>, <span className="text-[#8B93FF]">תאריך סיום התחייבות</span>
            </p>
            <div className="flex items-center gap-[10px]">
              <label className="flex-1 border border-dashed border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center cursor-pointer hover:border-[#4956D4] transition-colors">
                <span className="text-[14px] text-white/60">
                  {parsedCommitments.length > 0 ? `${parsedCommitments.length} התחייבויות נטענו` : "לחץ לבחירת קובץ CSV"}
                </span>
                <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              </label>
              {parsedCommitments.length > 0 && (
                <Button variant="outline" size="sm" onClick={handleClear} className="h-[50px] px-[20px] border-[#4C526B] text-white hover:bg-white/10">
                  נקה
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Preview */}
        {parsedCommitments.length > 0 && (
          <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
            <div className="flex items-center justify-between mb-[15px]">
              <h3 className="text-[16px] font-bold text-white">תצוגה מקדימה</h3>
              <span className="text-[13px] text-[#8B93FF] font-bold">{parsedCommitments.length} התחייבויות</span>
            </div>

            <div className="flex flex-col gap-[8px]">
              {parsedCommitments.map((c, i) => (
                <div key={i} className="bg-[#0F1535] rounded-[10px] p-[12px] flex flex-col gap-[6px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-bold text-white">{c.name}</span>
                    <span dir="ltr" className="text-[15px] font-bold text-[#FFA412]">
                      ₪{c.monthly_amount.toLocaleString("he-IL", { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[12px] text-white/50">
                    <span>{c.total_installments} תשלומים</span>
                    <span>{formatDateDisplay(c.start_date)} ← {formatDateDisplay(c.end_date)}</span>
                  </div>
                  <div className="text-[12px] text-white/30">
                    סה״כ: ₪{(c.monthly_amount * c.total_installments).toLocaleString("he-IL", { maximumFractionDigits: 2 })}
                  </div>
                </div>
              ))}
            </div>

            <Button
              onClick={handleImport}
              disabled={isImporting}
              className="w-full mt-[15px] h-[50px] bg-[#3CD856] hover:bg-[#34c04c] text-[#0F1535] text-[16px] font-bold rounded-[10px] transition-colors disabled:opacity-50"
            >
              {isImporting ? importProgress : `ייבא ${parsedCommitments.length} התחייבויות`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
