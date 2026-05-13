"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "../../layout";
import { createClient } from "@/lib/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";

/**
 * Admin-only OCR usage tracker. Built to answer "how do we price Mistral
 * OCR?" — we pay Mistral roughly per processed document, so the basic unit
 * is documents-with-ocr_processed_at-set, bucketed by business and month.
 *
 * Two numbers per cell:
 *   - total: every OCR-processed doc (matches the Mistral bill)
 *   - approved: how many made it through review (signals "useful" volume,
 *     i.e. cost vs. user-visible value)
 *
 * Reads from ocr_documents directly. No new tables/columns needed.
 */

const HEBREW_MONTHS_SHORT = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

type RawRow = {
  business_id: string | null;
  ocr_processed_at: string | null;
  created_at: string;
  status: string | null;
};

type BusinessRow = {
  businessId: string | null;
  name: string;
  monthlyTotal: number[];
  monthlyApproved: number[];
  yearTotal: number;
  yearApproved: number;
};

export default function OcrUsageAdminPage() {
  const { isAdmin, isProfileLoading } = useDashboard();
  const router = useRouter();

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [isLoading, setIsLoading] = useState(true);
  const [rows, setRows] = useState<BusinessRow[]>([]);
  const [monthTotals, setMonthTotals] = useState<number[]>(Array(12).fill(0));
  const [monthApproved, setMonthApproved] = useState<number[]>(Array(12).fill(0));
  const [businessNamesLoading, setBusinessNamesLoading] = useState(true);
  // Bumped by the realtime subscription to force the fetch effect to re-run
  // whenever ocr_documents rows are inserted/updated/deleted. Cheaper than
  // a per-event delta-merge because the dataset is small (a few thousand
  // rows/year) and the fetch already debounces UI rendering itself.
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Redirect non-admins. Mirror of /admin/online-users guard.
  useEffect(() => {
    if (!isProfileLoading && !isAdmin) {
      router.replace("/");
    }
  }, [isAdmin, isProfileLoading, router]);

  // Live updates — re-fetch whenever ocr_documents changes (new scan arrives,
  // status flips to approved, doc deleted). Subscription is enabled only for
  // admins so non-admins never even open the channel. ocr_documents is already
  // in the supabase_realtime publication (verified via the publication list).
  const handleRealtimeChange = useCallback(() => {
    setRefreshTrigger((n) => n + 1);
  }, []);
  useRealtimeSubscription({
    subscriptions: [{ table: "ocr_documents" }],
    onDataChange: handleRealtimeChange,
    enabled: !!isAdmin,
  });

  // Pull every ocr_documents row for the chosen year, plus the business name
  // lookup. Two parallel queries. Bucket by month + business in-memory because
  // there are at most a few thousand rows/year and pivoting in SQL would need
  // a generated-columns query that's harder to maintain.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    const fetchUsage = async () => {
      setIsLoading(true);
      setBusinessNamesLoading(true);
      const supabase = createClient();
      const yearStart = `${selectedYear}-01-01`;
      const yearEnd = `${selectedYear + 1}-01-01`;

      const [{ data: docs, error: docsErr }, { data: businesses, error: bizErr }] = await Promise.all([
        supabase
          .from("ocr_documents")
          .select("business_id, ocr_processed_at, created_at, status")
          .gte("created_at", yearStart)
          .lt("created_at", yearEnd),
        supabase
          .from("businesses")
          .select("id, name")
          .is("deleted_at", null)
          .order("name"),
      ]);

      if (cancelled) return;

      if (docsErr || bizErr) {
        console.error("[OCR Usage] fetch failed:", docsErr || bizErr);
        setRows([]);
        setMonthTotals(Array(12).fill(0));
        setMonthApproved(Array(12).fill(0));
        setIsLoading(false);
        setBusinessNamesLoading(false);
        return;
      }

      const businessNameMap = new Map<string, string>();
      for (const b of businesses || []) {
        businessNameMap.set(b.id, b.name);
      }
      setBusinessNamesLoading(false);

      const byBusiness = new Map<string, BusinessRow>();
      const totals = Array(12).fill(0);
      const approvedTotals = Array(12).fill(0);

      for (const d of (docs || []) as RawRow[]) {
        // Only count documents that actually went through Mistral. Pending /
        // failed extractions don't bill us — they show up in the totals only
        // once OCR completes (sets ocr_processed_at).
        if (!d.ocr_processed_at) continue;

        const date = new Date(d.ocr_processed_at);
        if (date.getFullYear() !== selectedYear) continue;
        const monthIdx = date.getMonth();

        const key = d.business_id || "__unassigned__";
        let row = byBusiness.get(key);
        if (!row) {
          row = {
            businessId: d.business_id,
            name: d.business_id ? businessNameMap.get(d.business_id) || "(עסק שנמחק)" : "(לא משויך)",
            monthlyTotal: Array(12).fill(0),
            monthlyApproved: Array(12).fill(0),
            yearTotal: 0,
            yearApproved: 0,
          };
          byBusiness.set(key, row);
        }

        row.monthlyTotal[monthIdx] += 1;
        row.yearTotal += 1;
        totals[monthIdx] += 1;
        if (d.status === "approved") {
          row.monthlyApproved[monthIdx] += 1;
          row.yearApproved += 1;
          approvedTotals[monthIdx] += 1;
        }
      }

      // Sort by yearly volume desc — heaviest billers at the top so a quick
      // glance shows where the cost is concentrated.
      const rowsArr = Array.from(byBusiness.values()).sort((a, b) => b.yearTotal - a.yearTotal);
      setRows(rowsArr);
      setMonthTotals(totals);
      setMonthApproved(approvedTotals);
      setIsLoading(false);
    };

    fetchUsage();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, selectedYear, refreshTrigger]);

  // KPI metrics — based on the current selected year. "currentMonth" is the
  // current calendar month if we're viewing this year, otherwise December of
  // the chosen year (most-recent month available).
  const kpis = useMemo(() => {
    const isCurrentYear = selectedYear === currentYear;
    const referenceMonth = isCurrentYear ? new Date().getMonth() : 11;
    const thisMonthTotal = monthTotals[referenceMonth] || 0;
    const thisMonthApproved = monthApproved[referenceMonth] || 0;
    const yearTotal = monthTotals.reduce((s, n) => s + n, 0);
    const yearApproved = monthApproved.reduce((s, n) => s + n, 0);
    // Average over months that actually had activity — averaging across all 12
    // when half are zero would understate the per-month load mid-year.
    const monthsWithActivity = monthTotals.filter((n) => n > 0).length;
    const monthlyAvg = monthsWithActivity > 0 ? Math.round(yearTotal / monthsWithActivity) : 0;
    return {
      thisMonthTotal,
      thisMonthApproved,
      yearTotal,
      yearApproved,
      monthlyAvg,
      referenceMonthLabel: HEBREW_MONTHS_SHORT[referenceMonth],
    };
  }, [monthTotals, monthApproved, selectedYear, currentYear]);

  if (isProfileLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin w-8 h-8 border-4 border-[#4956D4] border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!isAdmin) return null;

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <article
      aria-label="מעקב שימוש ב-OCR"
      className="text-white pt-0 px-[7px] pb-[80px] flex flex-col gap-[10px]"
      dir="rtl"
    >
      {/* Title row */}
      <section className="bg-[#0F1535] rounded-[10px] p-[12px] flex items-center justify-between gap-[10px]">
        <h1 className="text-[20px] font-bold">מעקב שימוש ב-OCR</h1>
        <div className="flex items-center gap-[8px]">
          <span className="text-[13px] text-white/60">שנה</span>
          <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(parseInt(v, 10))}>
            <SelectTrigger className="w-[110px] h-[36px] bg-transparent border border-[#4C526B] rounded-[7px] text-[14px] text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* KPI cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-[10px]">
        <KpiCard
          label={`מסמכים החודש (${kpis.referenceMonthLabel})`}
          value={kpis.thisMonthTotal}
          sub={`${kpis.thisMonthApproved} אושרו`}
          accent="#17DB4E"
        />
        <KpiCard
          label="סה״כ מסמכים בשנה"
          value={kpis.yearTotal}
          sub={`${kpis.yearApproved} אושרו`}
          accent="#0075FF"
        />
        <KpiCard
          label="ממוצע חודשי"
          value={kpis.monthlyAvg}
          sub="לפי חודשים פעילים בלבד"
          accent="#C084FC"
        />
        <KpiCard
          label="עסקים פעילים"
          value={rows.length}
          sub={selectedYear === currentYear ? "השנה" : `בשנת ${selectedYear}`}
          accent="#F59E0B"
        />
      </section>

      {/* Table */}
      <section className="bg-[#0F1535] rounded-[10px] p-[10px] flex flex-col gap-[10px]">
        <div className="flex items-center justify-between gap-[10px]">
          <span className="text-[17px] font-bold">פירוט לפי עסק וחודש — {selectedYear}</span>
          <span className="text-[12px] text-white/50">
            תא: סה״כ <span className="text-white/30">·</span> אושרו בסוגריים
          </span>
        </div>

        {isLoading || businessNamesLoading ? (
          <div className="flex items-center justify-center py-[40px]">
            <div className="animate-spin w-8 h-8 border-4 border-[#4956D4] border-t-transparent rounded-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-[40px] text-white/50 text-[14px]">אין נתונים לשנת {selectedYear}</div>
        ) : (
          /* CSS-grid layout for header / rows / footer with identical
             gridTemplateColumns — matches the /reports yearly table so RTL
             alignment is rock-solid even when numbers vary in digit count. */
          <div className="overflow-x-auto" dir="rtl">
            <div className="min-w-[1200px] flex flex-col gap-[2px]">
              {(() => {
                const gridTemplate = "200px repeat(12, minmax(80px, 1fr)) 110px";
                return (
                  <>
                    {/* Header */}
                    <div
                      className="grid items-center bg-[#1a1f4e] rounded-[7px] px-[8px] py-[10px]"
                      style={{ gridTemplateColumns: gridTemplate }}
                    >
                      <div className="text-right text-[13px] font-semibold pr-[5px] text-white">עסק</div>
                      {HEBREW_MONTHS_SHORT.map((m, i) => (
                        <div key={i} className="text-center text-[12px] font-semibold text-white/70">
                          {m}
                        </div>
                      ))}
                      <div className="text-center text-[13px] font-semibold text-[#17DB4E]">סה״כ</div>
                    </div>

                    {/* Rows */}
                    {rows.map((row) => {
                      const isCurrentMonth = (i: number) =>
                        selectedYear === currentYear && i === new Date().getMonth();
                      return (
                        <div
                          key={row.businessId || "__unassigned__"}
                          className="grid items-center rounded-[5px] px-[8px] py-[8px] bg-white/[0.02] hover:bg-white/[0.06] transition-colors"
                          style={{ gridTemplateColumns: gridTemplate }}
                        >
                          <div
                            className={`text-right text-[13px] font-medium pr-[5px] truncate ${
                              row.businessId ? "text-white/90" : "text-white/50 italic"
                            }`}
                            title={row.name}
                          >
                            {row.name}
                          </div>
                          {row.monthlyTotal.map((total, i) => {
                            const approved = row.monthlyApproved[i];
                            const isCur = isCurrentMonth(i);
                            return (
                              <div
                                key={i}
                                className={`text-center text-[12px] ltr-num px-[2px] ${
                                  total > 0 ? "text-white" : "text-white/20"
                                } ${isCur ? "bg-[#29318A]/20 rounded-[4px]" : ""}`}
                              >
                                {total > 0 ? (
                                  <>
                                    {total}
                                    {approved > 0 && approved !== total && (
                                      <span className="text-white/40"> ({approved})</span>
                                    )}
                                  </>
                                ) : (
                                  "—"
                                )}
                              </div>
                            );
                          })}
                          <div className="text-center text-[13px] font-semibold text-[#17DB4E] ltr-num">
                            {row.yearTotal}
                            {row.yearApproved > 0 && row.yearApproved !== row.yearTotal && (
                              <span className="text-white/50 text-[11px]"> ({row.yearApproved})</span>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Footer */}
                    <div
                      className="grid items-center bg-[#1a1f4e] rounded-[7px] px-[8px] py-[10px] mt-[3px]"
                      style={{ gridTemplateColumns: gridTemplate }}
                    >
                      <div className="text-right text-[13px] font-bold pr-[5px] text-white">סה״כ</div>
                      {monthTotals.map((total, i) => {
                        const approved = monthApproved[i];
                        return (
                          <div
                            key={i}
                            className="text-center text-[12px] font-semibold ltr-num px-[2px] text-white"
                          >
                            {total > 0 ? (
                              <>
                                {total}
                                {approved > 0 && approved !== total && (
                                  <span className="text-white/50"> ({approved})</span>
                                )}
                              </>
                            ) : (
                              "—"
                            )}
                          </div>
                        );
                      })}
                      <div className="text-center text-[13px] font-bold text-[#17DB4E] ltr-num">
                        {monthTotals.reduce((s, n) => s + n, 0)}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </section>
    </article>
  );
}

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number;
  sub: string;
  accent: string;
}) {
  return (
    <div className="bg-[#0F1535] rounded-[10px] p-[14px] flex flex-col gap-[4px]">
      <span className="text-[12px] text-white/60 leading-[1.2]">{label}</span>
      <span className="text-[28px] font-bold ltr-num" style={{ color: accent }}>
        {value.toLocaleString("he-IL")}
      </span>
      <span className="text-[11px] text-white/40">{sub}</span>
    </div>
  );
}
