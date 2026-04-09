"use client";

// Customer satisfaction surveys dashboard.
//
// Data source: `public.external_survey_responses` — populated by the n8n
// workflow "סנכרון סקרים - פתרונות לחיות → Supabase" (runs hourly from the
// private Google Sheet). The page is business-scoped via RLS so each user
// only sees their own business's rows.

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
  Legend,
} from "recharts";

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

const SCORE_COLORS: Record<number, string> = {
  5: "#22c55e",
  4: "#84cc16",
  3: "#eab308",
  2: "#f97316",
  1: "#ef4444",
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function StarScore({ value }: { value: number | null }) {
  if (value == null) return <span className="text-white/30 text-[12px]">—</span>;
  return (
    <span
      className="font-semibold ltr-num"
      style={{ color: SCORE_COLORS[value] || "#9ca3af" }}
    >
      {value.toFixed(1)} ★
    </span>
  );
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

  // KPIs
  const kpis = useMemo(() => {
    const n = rows.length;
    if (n === 0) return null;
    const avg = (field: keyof SurveyRow) => {
      const vals = rows.map((r) => r[field]).filter((v): v is number => typeof v === "number");
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };
    const avgOrder = avg("order_satisfaction_score");
    const avgProduct = avg("product_quality_score");
    const avgDelivery = avg("delivery_quality_score");
    const commitmentYes = rows.filter((r) => (r.commitment_kept || "").trim() === "כן").length;
    const commitmentAnswered = rows.filter((r) => r.commitment_kept && r.commitment_kept.trim()).length;
    const handled = rows.filter((r) => r.is_handled).length;
    const unhandled = n - handled;
    const promoters = rows.filter((r) => (r.order_satisfaction_score || 0) >= 4).length;
    const detractors = rows.filter((r) => {
      const s = r.order_satisfaction_score;
      return s != null && s <= 2;
    }).length;
    const withIdea = rows.filter((r) => r.improvement_idea && r.improvement_idea.trim()).length;
    return {
      total: n,
      avgOrder,
      avgProduct,
      avgDelivery,
      commitmentPct: commitmentAnswered ? (commitmentYes / commitmentAnswered) * 100 : 0,
      handled,
      unhandled,
      handledPct: (handled / n) * 100,
      promoters,
      detractors,
      withIdea,
    };
  }, [rows]);

  // Distribution (1..5)
  const distribution = useMemo(() => {
    const bins: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of rows) {
      if (r.order_satisfaction_score) bins[r.order_satisfaction_score] = (bins[r.order_satisfaction_score] || 0) + 1;
    }
    return [5, 4, 3, 2, 1].map((s) => ({ score: s, label: `${s} ★`, count: bins[s] }));
  }, [rows]);

  // Monthly trend
  const trend = useMemo(() => {
    const byMonth = new Map<string, { sum: number; count: number }>();
    for (const r of rows) {
      if (!r.submitted_at || !r.order_satisfaction_score) continue;
      const key = r.submitted_at.substring(0, 7); // YYYY-MM
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

  // Filtered rows for the details table
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
      <div className="flex items-center justify-center h-full text-white/60">
        <span>טוען...</span>
      </div>
    );
  }

  if (!kpis) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/60 px-6 text-center">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <p className="mt-4 text-lg">אין סקרים לעסק זה עדיין</p>
        <p className="mt-1 text-sm text-white/40">ברגע שהנתונים יגיעו הם יוצגו כאן אוטומטית</p>
      </div>
    );
  }

  const filters: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "הכל", count: rows.length },
    { key: "promoter", label: "ממליצים (4-5★)", count: kpis.promoters },
    { key: "neutral", label: "בינוני (3★)", count: rows.filter((r) => r.order_satisfaction_score === 3).length },
    { key: "detractor", label: "לא מרוצים (1-2★)", count: kpis.detractors },
    { key: "unhandled", label: "לא טופלו", count: kpis.unhandled },
    { key: "with_idea", label: "עם רעיון לשיפור", count: kpis.withIdea },
  ];

  return (
    <div className="flex flex-col gap-[15px] p-[20px]" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-[10px]">
        <div>
          <h1 className="text-[24px] font-bold text-white">סקרי לקוחות</h1>
          <p className="text-[13px] text-white/50 mt-[2px]">
            {rows.length.toLocaleString("he-IL")} תגובות ·{" "}
            {kpis.avgOrder.toFixed(2)} ★ ממוצע · מתעדכן אוטומטית
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-[10px]">
        <KpiCard label="סה״כ תגובות" value={kpis.total.toLocaleString("he-IL")} color="#818cf8" />
        <KpiCard
          label="שביעות רצון כללית"
          value={`${kpis.avgOrder.toFixed(2)} ★`}
          color={SCORE_COLORS[Math.round(kpis.avgOrder)] || "#22c55e"}
        />
        <KpiCard
          label="איכות המוצרים"
          value={`${kpis.avgProduct.toFixed(2)} ★`}
          color={SCORE_COLORS[Math.round(kpis.avgProduct)] || "#22c55e"}
        />
        <KpiCard
          label="איכות השליח"
          value={`${kpis.avgDelivery.toFixed(2)} ★`}
          color={SCORE_COLORS[Math.round(kpis.avgDelivery)] || "#22c55e"}
        />
        <KpiCard label="עמידה בהתחייבות" value={`${kpis.commitmentPct.toFixed(0)}%`} color="#38bdf8" />
        <KpiCard
          label="לא טופלו"
          value={kpis.unhandled.toLocaleString("he-IL")}
          color={kpis.unhandled > 0 ? "#ef4444" : "#22c55e"}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[15px]">
        {/* Distribution */}
        <div className="bg-[#0F1535] border border-[#4C526B]/50 rounded-[10px] p-[15px]">
          <h3 className="text-[15px] font-semibold text-white mb-[10px]">פילוח דירוגי שביעות רצון</h3>
          <div style={{ width: "100%", height: 260 }} dir="ltr">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={distribution}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={2}
                >
                  {distribution.map((d) => (
                    <Cell key={d.score} fill={SCORE_COLORS[d.score]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#1a1f3d", border: "1px solid #4C526B", borderRadius: "8px", color: "#fff" }}
                />
                <Legend
                  formatter={(val) => <span style={{ color: "#fff", fontSize: "12px" }}>{val}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Trend */}
        <div className="bg-[#0F1535] border border-[#4C526B]/50 rounded-[10px] p-[15px]">
          <h3 className="text-[15px] font-semibold text-white mb-[10px]">שביעות רצון לאורך זמן</h3>
          <div style={{ width: "100%", height: 260 }} dir="ltr">
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#4C526B" strokeOpacity={0.3} />
                <XAxis dataKey="month" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <YAxis domain={[1, 5]} tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1a1f3d", border: "1px solid #4C526B", borderRadius: "8px", color: "#fff" }}
                />
                <Line
                  type="monotone"
                  dataKey="avg"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={{ fill: "#22c55e", r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Filter chips + responses list */}
      <div className="bg-[#0F1535] border border-[#4C526B]/50 rounded-[10px] p-[15px] flex flex-col gap-[10px]">
        <div className="flex items-center justify-between flex-wrap gap-[10px]">
          <h3 className="text-[15px] font-semibold text-white">תגובות</h3>
          <div className="flex flex-wrap gap-[6px]">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`px-[10px] py-[5px] rounded-[6px] text-[12px] font-medium transition-colors ${
                  filter === f.key
                    ? "bg-[#29318A] text-white"
                    : "bg-[#4C526B]/20 text-white/60 hover:bg-[#4C526B]/40"
                }`}
              >
                {f.label} ({f.count})
              </button>
            ))}
          </div>
        </div>

        {/* Responses list */}
        <div className="flex flex-col gap-[6px] max-h-[600px] overflow-y-auto">
          {filteredRows.slice(0, 200).map((r) => {
            const name = [r.customer_first_name, r.customer_last_name].filter(Boolean).join(" ") || "אנונימי";
            const isExpanded = expandedId === r.id;
            const score = r.order_satisfaction_score;
            const scoreColor = score ? SCORE_COLORS[score] : "#9ca3af";
            const hasDetails =
              r.order_satisfaction_notes ||
              r.product_quality_notes ||
              r.delivery_quality_notes ||
              r.commitment_kept_notes ||
              r.improvement_idea ||
              r.internal_notes;
            return (
              <div
                key={r.id}
                className={`rounded-[8px] border ${
                  !r.is_handled ? "border-[#ef4444]/40 bg-[#ef4444]/5" : "border-[#4C526B]/40 bg-[#1a1f3d]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : r.id)}
                  className="w-full flex items-center justify-between gap-[10px] p-[10px] text-right"
                >
                  <div className="flex items-center gap-[8px] flex-shrink-0">
                    {!r.is_handled && (
                      <span className="text-[10px] font-bold bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/40 rounded-full px-[6px] py-[1px]">
                        לא טופל
                      </span>
                    )}
                    <span style={{ color: scoreColor }} className="text-[14px] font-bold ltr-num">
                      {score ? `${score} ★` : "—"}
                    </span>
                  </div>
                  <div className="flex flex-col items-end flex-1 min-w-0">
                    <span className="text-[13px] text-white font-medium truncate w-full text-right">{name}</span>
                    <span className="text-[11px] text-white/40">
                      {formatDate(r.submitted_at)}
                      {r.customer_phone ? ` · ${r.customer_phone}` : ""}
                    </span>
                  </div>
                  {hasDetails && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      className={`text-white/40 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    >
                      <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>

                {isExpanded && (
                  <div className="border-t border-[#4C526B]/30 p-[12px] flex flex-col gap-[8px]">
                    <DetailRow label="שביעות רצון כללית" score={r.order_satisfaction_score} text={r.order_satisfaction} notes={r.order_satisfaction_notes} />
                    <DetailRow label="איכות המוצרים" score={r.product_quality_score} text={r.product_quality} notes={r.product_quality_notes} />
                    <DetailRow label="איכות השליח" score={r.delivery_quality_score} text={r.delivery_quality} notes={r.delivery_quality_notes} />
                    <DetailRow label="עמדנו בהתחייבות?" text={r.commitment_kept} notes={r.commitment_kept_notes} />
                    {r.improvement_idea && (
                      <div className="bg-[#29318A]/20 border border-[#29318A]/40 rounded-[6px] p-[8px]">
                        <div className="text-[11px] text-[#00D4FF] font-semibold mb-[2px]">רעיון לשיפור</div>
                        <div className="text-[13px] text-white">{r.improvement_idea}</div>
                      </div>
                    )}
                    {r.internal_notes && (
                      <div className="bg-[#FFA500]/10 border border-[#FFA500]/30 rounded-[6px] p-[8px]">
                        <div className="text-[11px] text-[#FFA500] font-semibold mb-[2px]">הערות פנימיות</div>
                        <div className="text-[13px] text-white/80">{r.internal_notes}</div>
                      </div>
                    )}
                    {r.customer_email && (
                      <div className="text-[11px] text-white/40">
                        מייל: <span className="text-white/60 ltr-num" dir="ltr">{r.customer_email}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {filteredRows.length > 200 && (
            <div className="text-center text-[12px] text-white/40 py-[10px]">
              מוצגות 200 תגובות מתוך {filteredRows.length.toLocaleString("he-IL")}. השתמש בפילטרים לצמצום התצוגה.
            </div>
          )}
          {filteredRows.length === 0 && (
            <div className="text-center text-[13px] text-white/40 py-[20px]">אין תגובות שמתאימות לפילטר הנוכחי</div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#0F1535] border border-[#4C526B]/50 rounded-[10px] p-[12px] flex flex-col gap-[4px]">
      <span className="text-[11px] text-white/50">{label}</span>
      <span className="text-[22px] font-bold ltr-num" style={{ color }}>
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
  return (
    <div className="flex flex-col gap-[2px]">
      <div className="flex items-center justify-between gap-[8px]">
        <StarScore value={score ?? null} />
        <span className="text-[12px] text-white/50">{label}</span>
      </div>
      {text && <div className="text-[13px] text-white text-right">{text}</div>}
      {notes && <div className="text-[12px] text-white/60 text-right italic">„{notes}”</div>}
    </div>
  );
}
