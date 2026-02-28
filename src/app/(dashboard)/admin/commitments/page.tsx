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

interface CsvRow {
  group_id: string;
  name: string;
  amount: number;
  installment_number: number;
  date: string;
  business_name: string;
}

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
  const cleaned = raw.trim().split(" ")[0]; // strip time
  // DD/MM/YYYY
  const parts = cleaned.split("/");
  if (parts.length === 3 && parts[0].length <= 2) {
    return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  // YYYY-MM-DD
  if (cleaned.match(/^\d{4}-\d{2}-\d{2}$/)) return cleaned;
  return "";
}

function parseAmount(raw: string | number | undefined): number {
  if (raw === undefined || raw === null || raw === "") return 0;
  if (typeof raw === "number") return raw;
  const cleaned = raw.replace(/[₪$€,\s]/g, "").trim();
  if (cleaned === "-" || cleaned === "–" || cleaned === "") return 0;
  return parseFloat(cleaned) || 0;
}

function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function CommitmentsImportPage() {
  const supabase = createClient();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Business selection
  const [businesses, setBusinesses] = useState<{ id: string; name: string }[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState<string>("admin:commitments:businessId", "");

  // CSV data
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [parsedCommitments, setParsedCommitments] = useState<ParsedCommitment[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");

  // Header aliases for CSV columns
  const headerAliases: Record<string, string> = {
    "שם התחייבות": "name",
    "סכום": "amount",
    "מספר תשלום": "installment_number",
    "תאריך": "date",
    "התחייבות": "group_id",
    "עסק": "business_name",
  };

  // ============================================================================
  // FETCH BUSINESSES
  // ============================================================================

  useEffect(() => {
    (async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user) return;

      const { data: memberships } = await supabase
        .from("business_members")
        .select("business_id, businesses(id, name)")
        .eq("user_id", user.user.id);

      if (memberships) {
        const biz = memberships
          .map((m) => {
            const b = m.businesses as unknown as { id: string; name: string };
            return b ? { id: b.id, name: b.name } : null;
          })
          .filter(Boolean) as { id: string; name: string }[];
        setBusinesses(biz);
        if (!selectedBusinessId && biz.length > 0) setSelectedBusinessId(biz[0].id);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================================
  // CSV PARSING
  // ============================================================================

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: "UTF-8",
      complete: (result) => {
        const raw = result.data as Record<string, string>[];
        if (raw.length === 0) {
          showToast("הקובץ ריק", "error");
          return;
        }

        // Map headers
        const getField = (row: Record<string, string>, alias: string): string => {
          // Direct match
          if (row[alias] !== undefined) return row[alias];
          // Reverse alias lookup
          for (const [csvHeader, mapped] of Object.entries(headerAliases)) {
            if (mapped === alias && row[csvHeader] !== undefined) return row[csvHeader];
          }
          return "";
        };

        const rows: CsvRow[] = raw.map((row) => ({
          group_id: getField(row, "group_id"),
          name: getField(row, "name"),
          amount: parseAmount(getField(row, "amount")),
          installment_number: parseInt(getField(row, "installment_number")) || 0,
          date: parseDate(getField(row, "date")),
          business_name: getField(row, "business_name"),
        })).filter(r => r.group_id && r.name && r.amount > 0 && r.date);

        setCsvRows(rows);

        // Group by commitment ID
        const groups = new Map<string, CsvRow[]>();
        for (const row of rows) {
          if (!groups.has(row.group_id)) groups.set(row.group_id, []);
          groups.get(row.group_id)!.push(row);
        }

        const commitments: ParsedCommitment[] = Array.from(groups.values()).map((group) => {
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
      error: () => {
        showToast("שגיאה בקריאת הקובץ", "error");
      },
    });
  };

  // ============================================================================
  // IMPORT
  // ============================================================================

  const handleImport = async () => {
    if (!selectedBusinessId) {
      showToast("יש לבחור עסק", "error");
      return;
    }
    if (parsedCommitments.length === 0) {
      showToast("אין התחייבויות לייבוא", "error");
      return;
    }

    setIsImporting(true);
    setImportProgress("מייבא...");

    try {
      const { data: user } = await supabase.auth.getUser();

      const records = parsedCommitments.map((c) => ({
        business_id: selectedBusinessId,
        name: c.name,
        monthly_amount: c.monthly_amount,
        total_installments: c.total_installments,
        start_date: c.start_date,
        end_date: c.end_date,
        created_by: user?.user?.id || null,
      }));

      const { error } = await supabase.from("prior_commitments").insert(records);

      if (error) {
        showToast(`שגיאה בייבוא: ${error.message}`, "error");
        return;
      }

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
    setCsvRows([]);
    setParsedCommitments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-[#0F1535] p-4 md:p-8" dir="rtl">
      <div className="max-w-[700px] mx-auto flex flex-col gap-[20px]">
        {/* Page Title */}
        <div className="text-center">
          <h1 className="text-[22px] font-bold text-white">ייבוא התחייבויות קודמות</h1>
          <p className="text-[14px] text-white/50 mt-1">
            בחר עסק והעלה קובץ CSV עם נתוני התחייבויות קודמות
          </p>
        </div>

        {/* Business Selector */}
        <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">בחר עסק</h3>
          <Select value={selectedBusinessId || "__none__"} onValueChange={(val) => { setSelectedBusinessId(val === "__none__" ? "" : val); handleClear(); }}>
            <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
              <SelectValue placeholder="-- בחר עסק --" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">-- בחר עסק --</SelectItem>
              {businesses.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* CSV Upload */}
        {selectedBusinessId && (
          <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
            <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">העלאת קובץ CSV</h3>
            <p className="text-[12px] text-white/40 text-right mb-[10px]">
              כל שורה בקובץ = תשלום בודד. שורות עם אותו ID התחייבות יקובצו יחד.
            </p>

            {/* Column Mapping Info */}
            <div className="mb-[12px]">
              <span className="text-[12px] text-[#8B93FF] font-bold">עמודות נדרשות:</span>
              <div className="flex flex-wrap gap-[4px] mt-[4px]">
                {Object.entries(headerAliases).map(([heb]) => (
                  <span key={heb} className="text-[11px] px-[6px] py-[2px] rounded bg-[#4956D4]/20 text-[#8B93FF]">
                    {heb}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-[10px]">
              <label className="flex-1 border border-dashed border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center cursor-pointer hover:border-[#4956D4] transition-colors">
                <span className="text-[14px] text-white/60">
                  {csvRows.length > 0 ? `${csvRows.length} שורות נטענו` : "לחץ לבחירת קובץ CSV"}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
              {csvRows.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  className="h-[50px] px-[20px] border-[#4C526B] text-white hover:bg-white/10"
                >
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
              <h3 className="text-[16px] font-bold text-white">
                תצוגה מקדימה
              </h3>
              <span className="text-[13px] text-[#8B93FF] font-bold">
                {parsedCommitments.length} התחייבויות | {csvRows.length} תשלומים
              </span>
            </div>

            <div className="flex flex-col gap-[8px]">
              {parsedCommitments.map((c, i) => (
                <div
                  key={i}
                  className="bg-[#0F1535] rounded-[10px] p-[12px] flex flex-col gap-[6px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-bold text-white">{c.name}</span>
                    <span dir="ltr" className="text-[15px] font-bold text-[#FFA412]">
                      ₪{c.monthly_amount.toLocaleString("he-IL")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[12px] text-white/50">
                    <span>{c.total_installments} תשלומים</span>
                    <span>{formatDateDisplay(c.start_date)} → {formatDateDisplay(c.end_date)}</span>
                  </div>
                  <div className="text-[12px] text-white/30">
                    סה״כ: ₪{(c.monthly_amount * c.total_installments).toLocaleString("he-IL")}
                  </div>
                </div>
              ))}
            </div>

            {/* Import Button */}
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
