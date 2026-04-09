"use client";

// Customer satisfaction surveys dashboard.
//
// Data source: `public.external_survey_responses` — populated by the n8n
// workflow "סנכרון סקרים - פתרונות לחיות → Supabase". Business-scoped via RLS.

import { useEffect, useMemo, useState } from "react";
import { useDashboard } from "../layout";
import { createClient } from "@/lib/supabase/client";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SurveyRow {
  id: string;
  submitted_at: string | null;
  order_satisfaction: string | null;
  order_satisfaction_score: number | null;
  order_satisfaction_notes: string | null;
  product_quality: string | null;
  product_quality_score: number | null;
  product_quality_notes: string | null;
  delivery_quality: string | null;
  delivery_quality_score: number | null;
  delivery_quality_notes: string | null;
  commitment_kept: string | null;
  commitment_kept_notes: string | null;
  improvement_idea: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  is_club_member: string | null;
  is_handled: boolean;
  internal_notes: string | null;
}

type FilterKey = "all" | "promoter" | "neutral" | "detractor" | "unhandled" | "with_idea";

// Project palette — keep calm, avoid inventing new colors.
// Green = good (≥4), Orange = neutral (3), Red = bad (≤2).
function scoreColor(score: number | null): string {
  if (score == null) return "#979797";
  if (score >= 4) return "#17DB4E";
  if (score === 3) return "#FFA412";
  return "#F64E60";
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default function SurveysPage() {
  const { selectedBusinesses } = useDashboard();
  const [rows, setRows] = useState<SurveyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedBusinesses || selectedBusinesses.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("external_survey_responses")
        .select(
          "id, submitted_at, order_satisfaction, order_satisfaction_score, order_satisfaction_notes, product_quality, product_quality_score, product_quality_notes, delivery_quality, delivery_quality_score, delivery_quality_notes, commitment_kept, commitment_kept_notes, improvement_idea, customer_first_name, customer_last_name, customer_phone, customer_email, is_club_member, is_handled, internal_notes"
        )
        .in("business_id", selectedBusinesses)
        .order("submitted_at", { ascending: false })
        .limit(5000);
      if (cancelled) return;
      if (error) {
        console.error("surveys fetch error", error);
        setRows([]);
      } else {
        setRows((data || []) as SurveyRow[]);
      }
      setLoading(false);
    };
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [selectedBusinesses]);

  const stats = useMemo(() => {
    const n = rows.length;
    if (n === 0) return null;
    const avg = (field: keyof SurveyRow) => {
      const vals = rows.map((r) => r[field]).filter((v): v is number => typeof v === "number");
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };
    const commitmentAnswered = rows.filter((r) => r.commitment_kept && r.commitment_kept.trim()).length;
    const commitmentYes = rows.filter((r) => (r.commitment_kept || "").trim() === "כן").length;
    const handled = rows.filter((r) => r.is_handled).length;
    const promoters = rows.filter((r) => (r.order_satisfaction_score || 0) >= 4).length;
    const detractors = rows.filter((r) => r.order_satisfaction_score != null && r.order_satisfaction_score <= 2).length;
    const neutral = rows.filter((r) => r.order_satisfaction_score === 3).length;
    const withIdea = rows.filter((r) => r.improvement_idea && r.improvement_idea.trim()).length;
    return {
      total: n,
      avgOrder: avg("order_satisfaction_score"),
      avgProduct: avg("product_quality_score"),
      avgDelivery: avg("delivery_quality_score"),
      commitmentPct: commitmentAnswered ? (commitmentYes / commitmentAnswered) * 100 : 0,
      handled,
      unhandled: n - handled,
      promoters,
      neutral,
      detractors,
      withIdea,
    };
  }, [rows]);

  const distribution = useMemo(() => {
    const bins: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of rows) {
      if (r.order_satisfaction_score) bins[r.order_satisfaction_score] = (bins[r.order_satisfaction_score] || 0) + 1;
    }
    return [5, 4, 3, 2, 1].map((s) => ({
      score: s,
      label: `${s} ★`,
      count: bins[s],
      color: scoreColor(s),
    }));
  }, [rows]);

  const trend = useMemo(() => {
    const byMonth = new Map<string, { sum: number; count: number }>();
    for (const r of rows) {
      if (!r.submitted_at || !r.order_satisfaction_score) continue;
      const key = r.submitted_at.substring(0, 7);
      const bucket = byMonth.get(key) || { sum: 0, count: 0 };
      bucket.sum += r.order_satisfaction_score;
      bucket.count += 1;
      byMonth.set(key, bucket);
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, b]) => ({
        month,
        avg: +(b.sum / b.count).toFixed(2),
        count: b.count,
      }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    switch (filter) {
      case "promoter":
        return rows.filter((r) => (r.order_satisfaction_score || 0) >= 4);
      case "neutral":
        return rows.filter((r) => r.order_satisfaction_score === 3);
      case "detractor":
        return rows.filter((r) => r.order_satisfaction_score != null && r.order_satisfaction_score <= 2);
      case "unhandled":
        return rows.filter((r) => !r.is_handled);
      case "with_idea":
        return rows.filter((r) => r.improvement_idea && r.improvement_idea.trim());
      case "all":
      default:
        return rows;
    }
  }, [rows, filter]);

  if (loading) {
    return (
      <div className="bg-[#0F1535] rounded-[10px] p-[40px] text-center">
        <span className="text-white/60 text-[14px]">טוען...</span>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="bg-[#0F1535] rounded-[10px] p-[40px] text-center text-white/60">
        <span className="text-[14px]">אין סקרים לעסק זה עדיין</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[10px]" dir="rtl">
      {/* Summary card — follows the reports page "סיכום הכנסות" pattern */}
      <section
        aria-label="סיכום סקרי לקוחות"
        className="bg-[#2C3595] rounded-[10px] p-[7px] min-h-[80px] flex flex-row-reverse items-center justify-between gap-[5px]"
      >
        <SummaryStat label="סה״כ תגובות" value={stats.total.toLocaleString("he-IL")} />
        <SummaryStat
          label="שביעות רצון כללית"
          value={`${stats.avgOrder.toFixed(2)} ★`}
          color={scoreColor(Math.round(stats.avgOrder))}
        />
        <SummaryStat
          label="איכות מוצרים"
          value={`${stats.avgProduct.toFixed(2)} ★`}
          color={scoreColor(Math.round(stats.avgProduct))}
        />
        <SummaryStat
          label="איכות שליח"
          value={`${stats.avgDelivery.toFixed(2)} ★`}
          color={scoreColor(Math.round(stats.avgDelivery))}
        />
        <SummaryStat label="עמידה בהתחייבות" value={`${stats.commitmentPct.toFixed(0)}%`} />
        <SummaryStat
          label="לא טופלו"
          value={stats.unhandled.toLocaleString("he-IL")}
          color={stats.unhandled > 0 ? "#F64E60" : "#17DB4E"}
        />
      </section>

      {/* Monthly trend */}
      {trend.length > 1 && (
        <section
          aria-label="שביעות רצון לאורך זמן"
          className="bg-[#0F1535] rounded-[10px] p-[15px_10px] flex flex-col gap-[10px]"
        >
          <div className="flex items-center justify-between">
            <span className="text-[18px] font-bold leading-[1.4] text-white">שביעות רצון לאורך זמן</span>
            <div className="flex items-center gap-[4px]">
              <div className="w-[10px] h-[10px] rounded-[2px] bg-[#17DB4E]" />
              <span className="text-[11px] text-white/60">ממוצע חודשי</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis
                dataKey="month"
                tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[1, 5]}
                tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={25}
              />
              <Tooltip
                contentStyle={{
                  background: "#1a1f4e",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  direction: "rtl",
                }}
                labelStyle={{ color: "white", fontWeight: "bold", marginBottom: 4 }}
                itemStyle={{ color: "white" }}
              />
              <Line
                type="monotone"
                dataKey="avg"
                stroke="#17DB4E"
                strokeWidth={2}
                dot={{ fill: "#17DB4E", r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Distribution — compact stacked bar with numbers on the side */}
      <section
        aria-label="פילוח דירוגים"
        className="bg-[#0F1535] rounded-[10px] p-[15px_10px] flex flex-col gap-[10px]"
      >
        <span className="text-[18px] font-bold leading-[1.4] text-white">פילוח דירוגים</span>
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-[15px] items-center">
          <div style={{ width: "100%", height: 180 }} dir="ltr">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={distribution}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  innerRadius={40}
                  paddingAngle={1}
                  stroke="none"
                >
                  {distribution.map((d) => (
                    <Cell key={d.score} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "#1a1f4e",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    direction: "rtl",
                  }}
                  labelStyle={{ color: "white" }}
                  itemStyle={{ color: "white" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col gap-[6px]">
            {distribution.map((d) => {
              const pct = stats.total > 0 ? (d.count / stats.total) * 100 : 0;
              return (
                <div key={d.score} className="flex flex-row-reverse items-center gap-[10px]">
                  <span className="text-[14px] font-bold text-white w-[40px] text-right" style={{ color: d.color }}>
                    {d.label}
                  </span>
                  <div className="flex-1 h-[10px] bg-white/10 rounded-full overflow-hidden" dir="ltr">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: d.color }}
                    />
                  </div>
                  <span className="text-[13px] font-bold ltr-num text-white/80 w-[70px] text-left" dir="ltr">
                    {d.count.toLocaleString("he-IL")} · {pct.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Responses — filter tabs + list */}
      <section aria-label="תגובות לקוחות" className="bg-[#0F1535] rounded-[10px] p-[10px] flex flex-col gap-[10px]">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
          <TabsList className="w-full bg-transparent rounded-[7px] p-0 h-[44px] gap-0 border border-[#6B6B6B] flex">
            <TabsTrigger
              value="all"
              className="flex-1 text-[13px] font-semibold py-0 h-full rounded-none rounded-r-[7px] border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent"
            >
              הכל ({rows.length})
            </TabsTrigger>
            <TabsTrigger
              value="promoter"
              className="flex-1 text-[13px] font-semibold py-0 h-full rounded-none border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent"
            >
              ממליצים ({stats.promoters})
            </TabsTrigger>
            <TabsTrigger
              value="neutral"
              className="flex-1 text-[13px] font-semibold py-0 h-full rounded-none border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent"
            >
              בינוני ({stats.neutral})
            </TabsTrigger>
            <TabsTrigger
              value="detractor"
              className="flex-1 text-[13px] font-semibold py-0 h-full rounded-none border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent"
            >
              לא מרוצים ({stats.detractors})
            </TabsTrigger>
            <TabsTrigger
              value="unhandled"
              className="flex-1 text-[13px] font-semibold py-0 h-full rounded-none border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent"
            >
              לא טופלו ({stats.unhandled})
            </TabsTrigger>
            <TabsTrigger
              value="with_idea"
              className="flex-1 text-[13px] font-semibold py-0 h-full rounded-none rounded-l-[7px] border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent"
            >
              עם רעיון ({stats.withIdea})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-col max-h-[600px] overflow-y-auto">
          {filteredRows.length === 0 ? (
            <div className="text-center text-[13px] text-white/40 py-[20px]">אין תגובות שמתאימות לפילטר</div>
          ) : (
            filteredRows.slice(0, 200).map((r) => {
              const name = [r.customer_first_name, r.customer_last_name].filter(Boolean).join(" ") || "אנונימי";
              const isExpanded = expandedId === r.id;
              const score = r.order_satisfaction_score;
              const color = scoreColor(score);
              const hasDetails =
                r.order_satisfaction_notes ||
                r.product_quality_notes ||
                r.delivery_quality_notes ||
                r.commitment_kept_notes ||
                r.improvement_idea ||
                r.internal_notes ||
                r.customer_email;

              return (
                <div key={r.id} className="border-b border-white/10 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    className="w-full flex flex-row-reverse items-center justify-between gap-[10px] p-[10px_5px] text-right hover:bg-[#29318A]/20 transition-colors"
                  >
                    {/* Score */}
                    <span
                      className="text-[14px] font-bold ltr-num leading-[1.4] w-[50px] text-center flex-shrink-0"
                      style={{ color }}
                    >
                      {score ? `${score} ★` : "—"}
                    </span>

                    {/* Name + date */}
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-[14px] font-bold text-white truncate text-right">{name}</span>
                      <span className="text-[11px] text-white/50 text-right">
                        {formatDate(r.submitted_at)}
                        {r.customer_phone ? ` · ${r.customer_phone}` : ""}
                      </span>
                    </div>

                    {/* Handled badge */}
                    {!r.is_handled && (
                      <span className="text-[10px] font-bold text-[#F64E60] border border-[#F64E60]/50 rounded-[4px] px-[6px] py-[2px] flex-shrink-0">
                        לא טופל
                      </span>
                    )}

                    {/* Expand chevron */}
                    {hasDetails && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        className={`text-white/40 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      >
                        <path
                          d="M6 9L12 15L18 9"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>

                  {isExpanded && (
                    <div className="bg-[#141A40] p-[12px_15px] flex flex-col gap-[8px]">
                      <DetailRow label="שביעות רצון כללית" score={r.order_satisfaction_score} text={r.order_satisfaction} notes={r.order_satisfaction_notes} />
                      <DetailRow label="איכות המוצרים" score={r.product_quality_score} text={r.product_quality} notes={r.product_quality_notes} />
                      <DetailRow label="איכות השליח" score={r.delivery_quality_score} text={r.delivery_quality} notes={r.delivery_quality_notes} />
                      <DetailRow label="עמדנו בהתחייבות" text={r.commitment_kept} notes={r.commitment_kept_notes} />
                      {r.improvement_idea && (
                        <div className="flex flex-col gap-[2px] pt-[4px] border-t border-white/10">
                          <span className="text-[11px] text-white/50">רעיון לשיפור</span>
                          <span className="text-[13px] text-white">{r.improvement_idea}</span>
                        </div>
                      )}
                      {r.internal_notes && (
                        <div className="flex flex-col gap-[2px] pt-[4px] border-t border-white/10">
                          <span className="text-[11px] text-[#FFA412]">הערות פנימיות</span>
                          <span className="text-[13px] text-white/80">{r.internal_notes}</span>
                        </div>
                      )}
                      {r.customer_email && (
                        <div className="text-[11px] text-white/50 pt-[4px] border-t border-white/10">
                          מייל: <span className="text-white/70 ltr-num" dir="ltr">{r.customer_email}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
          {filteredRows.length > 200 && (
            <div className="text-center text-[11px] text-white/40 py-[8px] border-t border-white/10">
              מוצגות 200 תגובות מתוך {filteredRows.length.toLocaleString("he-IL")}. צמצם עם הפילטרים.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-center flex-1 min-w-0">
      <span className="text-[12px] sm:text-[14px] font-medium leading-[1.4] whitespace-nowrap text-white">
        {label}
      </span>
      <span
        className="text-[13px] sm:text-[15px] font-bold ltr-num leading-[1.4] whitespace-nowrap"
        style={{ color: color || "#ffffff" }}
      >
        {value}
      </span>
    </div>
  );
}

function DetailRow({
  label,
  score,
  text,
  notes,
}: {
  label: string;
  score?: number | null;
  text?: string | null;
  notes?: string | null;
}) {
  if (!text && !notes) return null;
  const color = score != null ? scoreColor(score) : "#979797";
  return (
    <div className="flex flex-col gap-[2px]">
      <div className="flex flex-row-reverse items-center justify-between gap-[8px]">
        <span className="text-[12px] text-white/50">{label}</span>
        {score != null && (
          <span className="text-[12px] font-bold ltr-num" style={{ color }}>
            {score} ★
          </span>
        )}
      </div>
      {text && <span className="text-[13px] text-white text-right">{text}</span>}
      {notes && <span className="text-[12px] text-white/60 text-right">„{notes}”</span>}
    </div>
  );
}
