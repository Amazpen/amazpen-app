"use client";

import { useState, useRef, useEffect } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";

interface Business {
  id: string;
  name: string;
}

interface CsvHistoricalEntry {
  month: number;
  year: number;
  business_name: string;
  total_income: number;
}

export default function AdminHistoricalDataPage() {
  const supabase = createClient();
  const { showToast } = useToast();

  // Business selection
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState<string>("admin-historical-data:businessId", "");
  const [isLoadingBusinesses, setIsLoadingBusinesses] = useState(true);

  // CSV state
  const [csvEntries, setCsvEntries] = useState<CsvHistoricalEntry[]>([]);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvParsingDone, setCsvParsingDone] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");

  // Duplicate detection
  const [duplicateKeys, setDuplicateKeys] = useState<Set<string>>(new Set());
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
    setDuplicateKeys(new Set());
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

          const detectedFields = results.meta.fields || [];
          const fieldMap: Record<string, string> = {};

          // Map CSV headers to canonical field names
          const headerAliases: Record<string, string> = {
            "חודש": "month",
            "שנה": "year",
            "עסק": "business_name",
            "מכירות ברוטו": "total_income",
          };

          for (const header of detectedFields) {
            const canonical = headerAliases[header];
            if (canonical && !fieldMap[canonical]) {
              fieldMap[canonical] = header;
            }
          }

          if (!fieldMap["month"] || !fieldMap["year"]) {
            setCsvError(`לא נמצאו עמודות "חודש" ו"שנה" בקובץ. עמודות שנמצאו: ${detectedFields.join(", ")}`);
            return;
          }
          if (!fieldMap["total_income"]) {
            setCsvError(`לא נמצאה עמודת "מכירות ברוטו" בקובץ. עמודות שנמצאו: ${detectedFields.join(", ")}`);
            return;
          }

          const getField = (row: Record<string, string>, canonical: string): string => {
            const header = fieldMap[canonical];
            return header ? (row[header] ?? "").trim() : "";
          };

          const entries: CsvHistoricalEntry[] = [];
          const errors: string[] = [];

          results.data.forEach((row, rowIdx) => {
            const monthRaw = getField(row, "month");
            const yearRaw = getField(row, "year");
            const totalIncomeRaw = getField(row, "total_income");
            const business_name = getField(row, "business_name");

            if (!monthRaw || !yearRaw) {
              errors.push(`שורה ${rowIdx + 2}: חסר חודש או שנה - דילוג`);
              return;
            }

            const month = parseInt(monthRaw);
            const year = parseInt(yearRaw);

            if (isNaN(month) || month < 1 || month > 12) {
              errors.push(`שורה ${rowIdx + 2}: חודש לא תקין "${monthRaw}" - דילוג`);
              return;
            }
            if (isNaN(year) || year < 2000 || year > 2100) {
              errors.push(`שורה ${rowIdx + 2}: שנה לא תקינה "${yearRaw}" - דילוג`);
              return;
            }

            const total_income = parseAmount(totalIncomeRaw);

            entries.push({
              month,
              year,
              business_name,
              total_income,
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
            const years = [...new Set(entries.map(e => e.year))];
            const { data: existing } = await supabase
              .from("monthly_summaries")
              .select("year, month")
              .eq("business_id", selectedBusinessId)
              .in("year", years);

            if (existing && existing.length > 0) {
              setDuplicateKeys(new Set(existing.map(e => `${e.year}-${e.month}`)));
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
    setDuplicateKeys(new Set());
    setOverwriteExisting(false);
    setImportProgress("");
    if (csvInputRef.current) csvInputRef.current.value = "";
  };

  const monthNames = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

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
      let imported = 0;
      let skipped = 0;

      for (let i = 0; i < csvEntries.length; i++) {
        const entry = csvEntries[i];
        const key = `${entry.year}-${entry.month}`;
        const isDuplicate = duplicateKeys.has(key);

        if (isDuplicate && !overwriteExisting) {
          skipped++;
          continue;
        }

        setImportProgress(`מייבא ${i + 1}/${csvEntries.length}...`);

        if (isDuplicate && overwriteExisting) {
          // Delete existing record
          await supabase
            .from("monthly_summaries")
            .delete()
            .eq("business_id", selectedBusinessId)
            .eq("year", entry.year)
            .eq("month", entry.month);
        }

        const { error } = await supabase
          .from("monthly_summaries")
          .insert({
            business_id: selectedBusinessId,
            year: entry.year,
            month: entry.month,
            total_income: entry.total_income,
            actual_work_days: 0,
            monthly_pace: 0,
          });

        if (error) {
          if (error.code === "23505") {
            skipped++;
            continue;
          }
          showToast(`שגיאה בשורה ${i + 1} (${entry.month}/${entry.year}): ${error.message}`, "error");
          continue;
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
  const totalIncomeSum = csvEntries.reduce((acc, e) => acc + e.total_income, 0);
  const newEntries = csvEntries.filter(e => !duplicateKeys.has(`${e.year}-${e.month}`));
  const duplicateEntries = csvEntries.filter(e => duplicateKeys.has(`${e.year}-${e.month}`));
  const years = [...new Set(csvEntries.map(e => e.year))].sort();

  // Sort entries by year then month
  const sortedEntries = [...csvEntries].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

  return (
    <div className="min-h-screen bg-[#0F1535] p-4 md:p-8" dir="rtl">
      <div className="max-w-[700px] mx-auto flex flex-col gap-[20px]">
        {/* Page Title */}
        <div className="text-center">
          <h1 className="text-[22px] font-bold text-white">ייבוא נתוני עבר</h1>
          <p className="text-[14px] text-white/50 mt-1">
            בחר עסק והעלה קובץ CSV עם נתוני מכירות חודשיים היסטוריים
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
        </div>

        {/* CSV Upload Area */}
        <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">העלאת קובץ נתוני עבר</h3>

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
                  <span className="text-[14px] text-white">רשומות חודשיות נטענו</span>
                  <span className="text-[16px] font-bold text-[#3CD856]">{csvEntries.length}</span>
                </div>
                <div className="flex flex-wrap gap-[8px] justify-start">
                  {years.length > 0 && (
                    <span className="text-[11px] px-[6px] py-[2px] rounded bg-white/10 text-white/60">
                      {years.length === 1 ? `שנה: ${years[0]}` : `שנים: ${years[0]}-${years[years.length - 1]}`}
                    </span>
                  )}
                  <span className="text-[11px] px-[6px] py-[2px] rounded bg-[#FFA412]/20 text-[#FFA412]">
                    {`סה"כ מכירות: ₪${totalIncomeSum.toLocaleString()}`}
                  </span>
                </div>

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
                    נמצאו {duplicateEntries.length} חודשים שכבר קיימים במערכת
                  </p>
                  <p className="text-[12px] text-white/50 text-right mb-[8px]">
                    ברירת מחדל: דילוג על חודשים קיימים. ניתן לבחור לדרוס נתונים קיימים.
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
            <div className="flex flex-col gap-[6px] max-h-[400px] overflow-y-auto">
              {sortedEntries.map((entry, index) => {
                const key = `${entry.year}-${entry.month}`;
                const isDuplicate = duplicateKeys.has(key);
                const originalIndex = csvEntries.indexOf(entry);
                return (
                  <div key={index} className={`flex items-center justify-between rounded-[10px] p-[10px] ${
                    isDuplicate
                      ? "bg-[#FFA412]/5 border border-[#FFA412]/20"
                      : "bg-[#4956D4]/10 border border-[#4956D4]/30"
                  }`}>
                    <div className="flex-1 text-right">
                      <div className="flex items-center gap-[8px] justify-start flex-wrap">
                        {isDuplicate && (
                          <span className="text-[10px] px-[4px] py-[1px] rounded bg-[#FFA412]/20 text-[#FFA412]">
                            {overwriteExisting ? "יידרס" : "ידולג"}
                          </span>
                        )}
                        <span className="text-[14px] text-white font-medium">
                          {`${monthNames[entry.month - 1]} ${entry.year}`}
                        </span>
                        <span className="text-[13px] text-[#FFA412] font-medium">
                          {`₪${entry.total_income.toLocaleString()}`}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveEntry(originalIndex)}
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
            הקובץ צריך להיות ייצוא מ-Bubble עם כותרות בעברית. עמודות ריקות מדולגות אוטומטית.
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
                  <td className="py-[4px] px-[8px]">חודש</td>
                  <td className="py-[4px] px-[8px] text-[#F64E60]">כן</td>
                  <td className="py-[4px] px-[8px]">1-12</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">שנה</td>
                  <td className="py-[4px] px-[8px] text-[#F64E60]">כן</td>
                  <td className="py-[4px] px-[8px]">2024</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-[4px] px-[8px]">מכירות ברוטו</td>
                  <td className="py-[4px] px-[8px] text-[#F64E60]">כן</td>
                  <td className="py-[4px] px-[8px]">508530</td>
                </tr>
                <tr>
                  <td className="py-[4px] px-[8px]">עסק</td>
                  <td className="py-[4px] px-[8px] text-white/40">לא</td>
                  <td className="py-[4px] px-[8px]">הדגמה</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="bg-[#4956D4]/10 rounded-[8px] p-[10px] mt-[10px]">
            <p className="text-[11px] text-white/40 text-right">
              {`הנתונים נשמרים בטבלת סיכומים חודשיים ומשמשים את העוזר החכם להשוואות ומגמות. חודשים כפולים מזוהים אוטומטית.`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
