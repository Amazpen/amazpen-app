"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart as RechartsBarChart, Bar, XAxis, YAxis } from "recharts";
import { useDashboard } from "../layout";
import { createClient } from "@/lib/supabase/client";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { usePersistedState } from "@/hooks/usePersistedState";
import { Button } from "@/components/ui/button";

// ============================================================================
// LAZY LOADED CHART COMPONENTS
// ============================================================================
const LazyComposedChart = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.ComposedChart })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
const LazyArea = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.Area })),
  { ssr: false }
);
const LazyLine = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.Line })),
  { ssr: false }
);
const LazyXAxis = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.XAxis })),
  { ssr: false }
);
const LazyYAxis = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.YAxis })),
  { ssr: false }
);
const LazyResponsiveContainer = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.ResponsiveContainer })),
  { ssr: false }
);

const ChartSkeleton = () => (
  <div className="w-full h-full flex items-center justify-center bg-white/5 rounded-lg animate-pulse">
    <div className="text-white/30 text-sm">טוען גרף...</div>
  </div>
);

// Safe chart wrapper that prevents -1 width/height errors
const SafeChartContainer = ({ children, height = 280 }: { children: React.ReactNode; height?: number }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height: h } = entry.contentRect;
        if (width > 0 && h > 0) {
          setDimensions({ width, height: h });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full" style={{ height }}>
      {dimensions && dimensions.width > 0 && dimensions.height > 0 ? (
        <LazyResponsiveContainer width={dimensions.width} height={dimensions.height}>
          {children}
        </LazyResponsiveContainer>
      ) : (
        <ChartSkeleton />
      )}
    </div>
  );
};

// ============================================================================
// TYPES
// ============================================================================
type TimeGranularity = "daily" | "weekly" | "monthly";

interface CashFlowRow {
  label: string;
  startDate: string;
  endDate: string;
  inflows: number;
  outflows: number;
  net: number;
  cumulative: number;
}

interface ChartDataPoint {
  label: string;
  inflows: number;
  outflows: number;
  net: number;
  cumulative: number;
}

interface IncomeSourceBreakdown {
  id: string;
  name: string;
  amount: number;
  color: string;
}

interface PaymentMethodBreakdown {
  id: string;
  name: string;
  amount: number;
  color: string;
  colorClass: string;
}

interface ExpenseTypeBreakdown {
  type: string;
  label: string;
  amount: number;
  color: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================
const paymentMethodColors: Record<string, { color: string; colorClass: string }> = {
  check: { color: "#00DD23", colorClass: "bg-[#00DD23]" },
  cash: { color: "#FF0000", colorClass: "bg-[#FF0000]" },
  standing_order: { color: "#3964FF", colorClass: "bg-[#3964FF]" },
  credit_companies: { color: "#FFCF00", colorClass: "bg-[#FFCF00]" },
  credit_card: { color: "#FF3665", colorClass: "bg-[#FF3665]" },
  bank_transfer: { color: "#FF7F00", colorClass: "bg-[#FF7F00]" },
  bit: { color: "#9333ea", colorClass: "bg-[#9333ea]" },
  paybox: { color: "#06b6d4", colorClass: "bg-[#06b6d4]" },
  other: { color: "#6b7280", colorClass: "bg-[#6b7280]" },
};

const paymentMethodNames: Record<string, string> = {
  bank_transfer: "העברה בנקאית",
  cash: "מזומן",
  check: "צ'ק",
  bit: "ביט",
  paybox: "פייבוקס",
  credit_card: "כרטיס אשראי",
  other: "אחר",
  credit_companies: "חברות הקפה",
  standing_order: "הוראת קבע",
};

const expenseTypeLabels: Record<string, string> = {
  goods_purchases: "קניות סחורה",
  current_expenses: "הוצאות שוטפות",
  employee_costs: "עלות עובדים",
};

const expenseTypeColors: Record<string, string> = {
  goods_purchases: "#0095FF",
  current_expenses: "#FF3665",
  employee_costs: "#FACC15",
};

const incomeSourcePalette = ["#17DB4E", "#0095FF", "#FACC15", "#FF3665", "#9333ea", "#06b6d4", "#FF7F00", "#00DD23"];

const hebrewMonths = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

// ============================================================================
// FORMAT FUNCTIONS
// ============================================================================
const formatCurrency = (amount: number) => {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const sign = isNegative ? "-" : "";
  if (absAmount >= 1000000) {
    const millions = absAmount / 1000000;
    return `${sign}₪${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  if (absAmount >= 1000) {
    const thousands = absAmount / 1000;
    return `${sign}₪${thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}K`;
  }
  return `${sign}₪${absAmount.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const formatCurrencyFull = (amount: number) => {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const sign = isNegative ? "-" : "";
  return `${sign}₪${Math.round(absAmount).toLocaleString("he-IL")}`;
};

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// ============================================================================
// DATE BUCKET HELPERS
// ============================================================================
function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day);
  return formatLocalDate(d);
}

function getMonthKey(dateStr: string): string {
  return dateStr.substring(0, 7); // YYYY-MM
}

function getBucketKey(dateStr: string, granularity: TimeGranularity): string {
  if (granularity === "daily") return dateStr;
  if (granularity === "weekly") return getWeekStart(dateStr);
  return getMonthKey(dateStr);
}

function formatBucketLabel(key: string, granularity: TimeGranularity): string {
  if (granularity === "daily") {
    const d = new Date(key + "T00:00:00");
    return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
  }
  if (granularity === "weekly") {
    const start = new Date(key + "T00:00:00");
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return `${start.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })} - ${end.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })}`;
  }
  // monthly
  const [y, m] = key.split("-");
  return `${hebrewMonths[parseInt(m, 10) - 1]} ${y}`;
}

function getBucketDateRange(key: string, granularity: TimeGranularity): { start: string; end: string } {
  if (granularity === "daily") return { start: key, end: key };
  if (granularity === "weekly") {
    const start = new Date(key + "T00:00:00");
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: key, end: formatLocalDate(end) };
  }
  // monthly
  const [y, m] = key.split("-");
  const start = `${y}-${m}-01`;
  const lastDay = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();
  const end = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function CashFlowPage() {
  const { selectedBusinesses } = useDashboard();
  const supabase = createClient();

  // Persisted state
  const [savedDateRange, setSavedDateRange] = usePersistedState<{ start: string; end: string } | null>("cashflow:dateRange", null);
  const [savedGranularity, setSavedGranularity] = usePersistedState<TimeGranularity>("cashflow:granularity", "daily");

  // Client state
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date } | null>(null);
  const [granularity, setGranularity] = useState<TimeGranularity>("daily");

  // Drill-down
  const [drillDownRange, setDrillDownRange] = useState<{ start: Date; end: Date } | null>(null);
  const [drillDownGranularity, setDrillDownGranularity] = useState<TimeGranularity | null>(null);

  // Data
  const [cashFlowRows, setCashFlowRows] = useState<CashFlowRow[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [incomeBreakdown, setIncomeBreakdown] = useState<IncomeSourceBreakdown[]>([]);
  const [paymentMethodData, setPaymentMethodData] = useState<PaymentMethodBreakdown[]>([]);
  const [expenseTypeData, setExpenseTypeData] = useState<ExpenseTypeBreakdown[]>([]);
  const [totalInflows, setTotalInflows] = useState(0);
  const [totalOutflows, setTotalOutflows] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Active range/granularity (drill-down or main)
  const activeRange = drillDownRange || dateRange;
  const activeGranularity = drillDownGranularity || granularity;

  // Initialize date range after hydration
  useEffect(() => {
    if (savedDateRange) {
      setDateRange({ start: new Date(savedDateRange.start), end: new Date(savedDateRange.end) });
    } else {
      setDateRange({
        start: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        end: new Date(),
      });
    }
    setGranularity(savedGranularity);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs once on mount to hydrate from persisted values. Adding savedDateRange/savedGranularity would re-trigger on every save.
  }, []);

  const handleDateRangeChange = useCallback(
    (range: { start: Date; end: Date }) => {
      setDateRange(range);
      setSavedDateRange({ start: range.start.toISOString(), end: range.end.toISOString() });
      // Clear drill-down when date range changes
      setDrillDownRange(null);
      setDrillDownGranularity(null);
    },
    [setSavedDateRange]
  );

  const handleGranularityChange = useCallback(
    (g: TimeGranularity) => {
      setGranularity(g);
      setSavedGranularity(g);
      setDrillDownRange(null);
      setDrillDownGranularity(null);
    },
    [setSavedGranularity]
  );

  // Realtime
  const handleRealtimeChange = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  useMultiTableRealtime(["daily_entries", "payments", "payment_splits"], handleRealtimeChange, selectedBusinesses.length > 0);

  // ============================================================================
  // DATA FETCHING
  // ============================================================================
  useEffect(() => {
    if (!activeRange || selectedBusinesses.length === 0) {
      setIsLoading(false);
      setCashFlowRows([]);
      setChartData([]);
      setIncomeBreakdown([]);
      setPaymentMethodData([]);
      setExpenseTypeData([]);
      setTotalInflows(0);
      setTotalOutflows(0);
      return;
    }

    const fetchData = async () => {
      setIsLoading(true);
      const startDate = formatLocalDate(activeRange.start);
      const endDate = formatLocalDate(activeRange.end);

      try {
        // Parallel queries
        const [entriesResult, sourcesResult, paymentsResult] = await Promise.all([
          supabase
            .from("daily_entries")
            .select("id, entry_date, total_register")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .gte("entry_date", startDate)
            .lte("entry_date", endDate)
            .order("entry_date", { ascending: true }),
          supabase
            .from("income_sources")
            .select("id, name")
            .in("business_id", selectedBusinesses)
            .eq("is_active", true),
          supabase
            .from("payments")
            .select(`
              id, payment_date, total_amount,
              supplier:suppliers(id, name, expense_type),
              payment_splits(id, payment_method, amount)
            `)
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .gte("payment_date", startDate)
            .lte("payment_date", endDate)
            .order("payment_date", { ascending: true }),
        ]);

        const dailyEntries = entriesResult.data || [];
        const incomeSources = sourcesResult.data || [];
        const payments = paymentsResult.data || [];

        // Fetch income breakdown (depends on entries)
        const entryIds = dailyEntries.map((e: Record<string, unknown>) => e.id);
        let incomeBreakdownData: Record<string, unknown>[] = [];
        if (entryIds.length > 0) {
          const { data } = await supabase
            .from("daily_income_breakdown")
            .select("daily_entry_id, income_source_id, amount")
            .in("daily_entry_id", entryIds);
          incomeBreakdownData = data || [];
        }

        // ---- Process data ----

        // 1. Build buckets for cash flow rows
        const bucketMap = new Map<string, { inflows: number; outflows: number }>();

        for (const entry of dailyEntries) {
          const key = getBucketKey(entry.entry_date, activeGranularity);
          const bucket = bucketMap.get(key) || { inflows: 0, outflows: 0 };
          bucket.inflows += entry.total_register || 0;
          bucketMap.set(key, bucket);
        }

        for (const payment of payments) {
          const key = getBucketKey(payment.payment_date, activeGranularity);
          const bucket = bucketMap.get(key) || { inflows: 0, outflows: 0 };
          bucket.outflows += payment.total_amount || 0;
          bucketMap.set(key, bucket);
        }

        // Sort buckets by key
        const sortedKeys = Array.from(bucketMap.keys()).sort();
        let cumulative = 0;
        const rows: CashFlowRow[] = [];
        const chartPoints: ChartDataPoint[] = [];

        for (const key of sortedKeys) {
          const bucket = bucketMap.get(key)!;
          const net = bucket.inflows - bucket.outflows;
          cumulative += net;
          const range = getBucketDateRange(key, activeGranularity);
          const label = formatBucketLabel(key, activeGranularity);

          rows.push({
            label,
            startDate: range.start,
            endDate: range.end,
            inflows: bucket.inflows,
            outflows: bucket.outflows,
            net,
            cumulative,
          });

          chartPoints.push({ label, inflows: bucket.inflows, outflows: bucket.outflows, net, cumulative });
        }

        setCashFlowRows(rows);
        setChartData(chartPoints);

        const totIn = rows.reduce((sum, r) => sum + r.inflows, 0);
        const totOut = rows.reduce((sum, r) => sum + r.outflows, 0);
        setTotalInflows(totIn);
        setTotalOutflows(totOut);

        // 2. Income source breakdown
        const sourceAmounts = new Map<string, number>();
        for (const item of incomeBreakdownData) {
          const prev = sourceAmounts.get(item.income_source_id as string) || 0;
          sourceAmounts.set(item.income_source_id as string, prev + (Number(item.amount) || 0));
        }
        const sourceNameMap = new Map(incomeSources.map((s: Record<string, unknown>) => [s.id as string, s.name as string]));
        const incBreakdown: IncomeSourceBreakdown[] = [];
        let colorIdx = 0;
        for (const [sourceId, amount] of sourceAmounts.entries()) {
          if (amount > 0) {
            incBreakdown.push({
              id: sourceId,
              name: sourceNameMap.get(sourceId) || "אחר",
              amount,
              color: incomeSourcePalette[colorIdx % incomeSourcePalette.length],
            });
            colorIdx++;
          }
        }
        incBreakdown.sort((a, b) => b.amount - a.amount);
        setIncomeBreakdown(incBreakdown);

        // 3. Payment method breakdown
        const methodAmounts = new Map<string, number>();
        for (const payment of payments) {
          const splits = (payment as Record<string, unknown>).payment_splits as Record<string, unknown>[] || [];
          if (splits.length > 0) {
            for (const split of splits) {
              const method = (split.payment_method as string) || "other";
              const prev = methodAmounts.get(method) || 0;
              methodAmounts.set(method, prev + (Number(split.amount) || 0));
            }
          } else {
            const prev = methodAmounts.get("other") || 0;
            methodAmounts.set("other", prev + (payment.total_amount || 0));
          }
        }
        const pmBreakdown: PaymentMethodBreakdown[] = [];
        for (const [method, amount] of methodAmounts.entries()) {
          if (amount > 0) {
            const colors = paymentMethodColors[method] || paymentMethodColors.other;
            pmBreakdown.push({
              id: method,
              name: paymentMethodNames[method] || method,
              amount,
              color: colors.color,
              colorClass: colors.colorClass,
            });
          }
        }
        pmBreakdown.sort((a, b) => b.amount - a.amount);
        setPaymentMethodData(pmBreakdown);

        // 4. Expense type breakdown
        const typeAmounts = new Map<string, number>();
        for (const payment of payments) {
          const expType = ((payment as Record<string, unknown>).supplier as Record<string, unknown>)?.expense_type as string || "current_expenses";
          const prev = typeAmounts.get(expType) || 0;
          typeAmounts.set(expType, prev + (payment.total_amount || 0));
        }
        const etBreakdown: ExpenseTypeBreakdown[] = [];
        for (const [type, amount] of typeAmounts.entries()) {
          if (amount > 0) {
            etBreakdown.push({
              type,
              label: expenseTypeLabels[type] || type,
              amount,
              color: expenseTypeColors[type] || "#6b7280",
            });
          }
        }
        etBreakdown.sort((a, b) => b.amount - a.amount);
        setExpenseTypeData(etBreakdown);
      } catch (err) {
        console.error("Error fetching cash flow data:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [activeRange, activeGranularity, selectedBusinesses, refreshTrigger, supabase]);

  // ============================================================================
  // DRILL-DOWN
  // ============================================================================
  const handleRowClick = (row: CashFlowRow) => {
    if (activeGranularity === "monthly") {
      setDrillDownRange({ start: new Date(row.startDate + "T00:00:00"), end: new Date(row.endDate + "T00:00:00") });
      setDrillDownGranularity("weekly");
    } else if (activeGranularity === "weekly") {
      setDrillDownRange({ start: new Date(row.startDate + "T00:00:00"), end: new Date(row.endDate + "T00:00:00") });
      setDrillDownGranularity("daily");
    }
  };

  const exitDrillDown = () => {
    setDrillDownRange(null);
    setDrillDownGranularity(null);
  };

  // ============================================================================
  // COMPUTED
  // ============================================================================
  const netCashFlow = totalInflows - totalOutflows;
  const cumulativeBalance = cashFlowRows.length > 0 ? cashFlowRows[cashFlowRows.length - 1].cumulative : 0;
  const canDrillDown = activeGranularity !== "daily";

  // ============================================================================
  // RENDER
  // ============================================================================

  // No business selected
  if (selectedBusinesses.length === 0) {
    return (
      <article className="text-white p-[10px] pb-[80px]">
        <div className="bg-[#0F1535] rounded-[20px] p-[40px] text-center">
          <p className="text-[20px] text-white/70">יש לבחור עסק כדי לצפות בתזרים מזומנים</p>
        </div>
      </article>
    );
  }

  return (
    <article aria-label="תזרים מזומנים" className="text-white p-[10px] pb-[80px] flex flex-col gap-[10px]">
      {/* ============= HEADER + CONTROLS ============= */}
      <section className="bg-[#0F1535] rounded-[10px] flex flex-col gap-[10px]">
        {/* Controls Row */}
        <div className="flex items-center justify-between gap-[10px] flex-wrap">
          {/* Granularity Toggle - right side in RTL */}
          <div className="flex items-center border border-[#4C526B] rounded-[7px] overflow-hidden">
            {(["daily", "weekly", "monthly"] as const).map((g) => (
              <Button
                key={g}
                type="button"
                onClick={() => handleGranularityChange(g)}
                className={`px-[12px] py-[8px] text-[14px] font-bold transition-colors ${
                  granularity === g && !drillDownGranularity
                    ? "bg-[#29318A] text-white"
                    : "text-white/70 hover:text-white hover:bg-white/5"
                }`}
              >
                {g === "daily" ? "יומי" : g === "weekly" ? "שבועי" : "חודשי"}
              </Button>
            ))}
          </div>

          {/* Date picker - left side in RTL */}
          {dateRange && (
            <DateRangePicker
              dateRange={activeRange || dateRange}
              onChange={handleDateRangeChange}
              variant="compact"
            />
          )}
        </div>

        {/* Drill-down breadcrumb */}
        {drillDownRange && (
          <Button
            type="button"
            onClick={exitDrillDown}
            className="text-[14px] text-[#0095FF] hover:underline flex flex-row-reverse items-center gap-[5px] self-start"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            חזרה ל{granularity === "monthly" ? "תצוגה חודשית" : "תצוגה שבועית"}
          </Button>
        )}
      </section>

      {/* ============= SUMMARY CARDS ============= */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-[10px]">
        {/* Total Inflows */}
        <div className="bg-[#0F1535] rounded-[10px] p-[15px] flex flex-col items-center gap-[5px]">
          <span className="text-[13px] text-white/60">סה&quot;כ הכנסות</span>
          {isLoading ? (
            <div className="h-[28px] w-[80px] bg-white/10 rounded animate-pulse" />
          ) : (
            <span className="text-[22px] font-bold text-[#17DB4E]">{formatCurrencyFull(totalInflows)}</span>
          )}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#17DB4E]">
            <path d="M12 19V5m0 0l-5 5m5-5l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {/* Total Outflows */}
        <div className="bg-[#0F1535] rounded-[10px] p-[15px] flex flex-col items-center gap-[5px]">
          <span className="text-[13px] text-white/60">סה&quot;כ יציאות</span>
          {isLoading ? (
            <div className="h-[28px] w-[80px] bg-white/10 rounded animate-pulse" />
          ) : (
            <span className="text-[22px] font-bold text-[#F64E60]">{formatCurrencyFull(totalOutflows)}</span>
          )}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#F64E60]">
            <path d="M12 5v14m0 0l5-5m-5 5l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {/* Net Cash Flow */}
        <div className="bg-[#0F1535] rounded-[10px] p-[15px] flex flex-col items-center gap-[5px]">
          <span className="text-[13px] text-white/60">תזרים נקי</span>
          {isLoading ? (
            <div className="h-[28px] w-[80px] bg-white/10 rounded animate-pulse" />
          ) : (
            <span className={`text-[22px] font-bold ${netCashFlow >= 0 ? "text-[#17DB4E]" : "text-[#F64E60]"}`}>
              {formatCurrencyFull(netCashFlow)}
            </span>
          )}
        </div>

        {/* Cumulative Balance */}
        <div className="bg-[#0F1535] rounded-[10px] p-[15px] flex flex-col items-center gap-[5px]">
          <span className="text-[13px] text-white/60">יתרה מצטברת</span>
          {isLoading ? (
            <div className="h-[28px] w-[80px] bg-white/10 rounded animate-pulse" />
          ) : (
            <span className={`text-[22px] font-bold ${cumulativeBalance >= 0 ? "text-[#17DB4E]" : "text-[#F64E60]"}`}>
              {formatCurrencyFull(cumulativeBalance)}
            </span>
          )}
        </div>
      </section>

      {/* ============= MAIN TRENDS CHART ============= */}
      {!isLoading && chartData.length > 0 && (
        <section className="bg-[#0F1535] rounded-[10px] p-[8px]">
          <h2 className="text-[18px] font-bold mb-[10px] text-right">מגמות תזרים</h2>
          <div className="w-full" dir="ltr">
            <SafeChartContainer height={280}>
              <LazyComposedChart data={chartData}>
                <defs>
                  <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#17DB4E" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#17DB4E" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="outflowGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F64E60" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#F64E60" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <LazyXAxis dataKey="label" tick={{ fill: "#7B91B0", fontSize: 9 }} axisLine={false} tickLine={false} />
                <LazyYAxis yAxisId="left" orientation="right" tick={{ fill: "#7B91B0", fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v / 1000}k`} />
                <LazyYAxis yAxisId="right" orientation="left" tick={{ fill: "#7B91B0", fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v / 1000}k`} />
                <LazyArea yAxisId="left" type="monotone" dataKey="inflows" stroke="#17DB4E" strokeWidth={2} fill="url(#inflowGrad)" name="הכנסות" />
                <LazyArea yAxisId="left" type="monotone" dataKey="outflows" stroke="#F64E60" strokeWidth={2} fill="url(#outflowGrad)" name="יציאות" />
                <LazyLine yAxisId="right" type="monotone" dataKey="cumulative" stroke="#0095FF" strokeWidth={3} dot={{ fill: "#0095FF", r: 3 }} name="מצטבר" />
              </LazyComposedChart>
            </SafeChartContainer>
          </div>

          {/* Legend */}
          <div className="flex flex-row-reverse justify-center flex-wrap gap-4 mt-3">
            <div className="flex flex-row-reverse items-center gap-2">
              <span className="text-[#7B91B0] text-[10px]">הכנסות</span>
              <div className="w-[10px] h-[10px] bg-[#17DB4E] rounded-[2px]" />
            </div>
            <div className="flex flex-row-reverse items-center gap-2">
              <span className="text-[#7B91B0] text-[10px]">יציאות</span>
              <div className="w-[10px] h-[10px] bg-[#F64E60] rounded-[2px]" />
            </div>
            <div className="flex flex-row-reverse items-center gap-2">
              <span className="text-[#7B91B0] text-[10px]">מצטבר</span>
              <div className="w-[10px] h-[10px] bg-[#0095FF] rounded-full" />
            </div>
          </div>
        </section>
      )}

      {/* ============= BREAKDOWN CHARTS ============= */}
      {!isLoading && (incomeBreakdown.length > 0 || paymentMethodData.length > 0 || expenseTypeData.length > 0) && (
        <section className="flex flex-col lg:grid lg:grid-cols-3 gap-[10px]">
          {/* Income by Source */}
          <div className="bg-[#0F1535] rounded-[10px] p-[15px]">
            <h3 className="text-[16px] font-bold text-center mb-[10px]">הכנסות לפי מקור</h3>
            {incomeBreakdown.length > 0 ? (
              <>
                <div className="h-[220px] min-w-[1px] min-h-[1px]">
                  <ResponsiveContainer width="100%" height={220} minWidth={1} minHeight={1}>
                    <PieChart>
                      <Pie data={incomeBreakdown} cx="50%" cy="50%" outerRadius={90} dataKey="amount" stroke="none">
                        {incomeBreakdown.map((entry) => (
                          <Cell key={entry.id} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-[2px] mt-[5px]">
                  {incomeBreakdown.map((src) => (
                    <div key={src.id} className="flex items-center justify-between py-[4px] border-t border-white/10">
                      <div className="flex items-center gap-[5px]">
                        <span className="w-[12px] h-[12px] rounded-full flex-shrink-0" style={{ backgroundColor: src.color }} />
                        <span className="text-[13px]">{src.name}</span>
                      </div>
                      <span className="text-[13px] font-bold">{formatCurrencyFull(src.amount)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[220px] flex items-center justify-center">
                <span className="text-[14px] text-white/40">אין נתונים</span>
              </div>
            )}
          </div>

          {/* Outflows by Payment Method */}
          <div className="bg-[#0F1535] rounded-[10px] p-[15px]">
            <h3 className="text-[16px] font-bold text-center mb-[10px]">יציאות לפי אמצעי תשלום</h3>
            {paymentMethodData.length > 0 ? (
              <>
                <div className="h-[220px] min-w-[1px] min-h-[1px]">
                  <ResponsiveContainer width="100%" height={220} minWidth={1} minHeight={1}>
                    <PieChart>
                      <Pie data={paymentMethodData} cx="50%" cy="50%" outerRadius={90} dataKey="amount" stroke="none">
                        {paymentMethodData.map((entry) => (
                          <Cell key={entry.id} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-[2px] mt-[5px]">
                  {paymentMethodData.map((pm) => (
                    <div key={pm.id} className="flex items-center justify-between py-[4px] border-t border-white/10">
                      <div className="flex items-center gap-[5px]">
                        <span className={`w-[12px] h-[12px] rounded-full flex-shrink-0 ${pm.colorClass}`} />
                        <span className="text-[13px]">{pm.name}</span>
                      </div>
                      <span className="text-[13px] font-bold">{formatCurrencyFull(pm.amount)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[220px] flex items-center justify-center">
                <span className="text-[14px] text-white/40">אין נתונים</span>
              </div>
            )}
          </div>

          {/* Outflows by Expense Type */}
          <div className="bg-[#0F1535] rounded-[10px] p-[15px]">
            <h3 className="text-[16px] font-bold text-center mb-[10px]">יציאות לפי סוג הוצאה</h3>
            {expenseTypeData.length > 0 ? (
              <div className="h-[220px] min-w-[1px] min-h-[1px]" dir="ltr">
                <ResponsiveContainer width="100%" height={220} minWidth={1} minHeight={1}>
                  <RechartsBarChart data={expenseTypeData} layout="vertical" margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <XAxis type="number" tick={{ fill: "#7B91B0", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v / 1000}k`} />
                    <YAxis type="category" dataKey="label" tick={{ fill: "#7B91B0", fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
                    <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={30}>
                      {expenseTypeData.map((entry) => (
                        <Cell key={entry.type} fill={entry.color} />
                      ))}
                    </Bar>
                  </RechartsBarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[220px] flex items-center justify-center">
                <span className="text-[14px] text-white/40">אין נתונים</span>
              </div>
            )}
            {/* Legend for expense type */}
            {expenseTypeData.length > 0 && (
              <div className="flex flex-col gap-[2px] mt-[5px]">
                {expenseTypeData.map((et) => (
                  <div key={et.type} className="flex items-center justify-between py-[4px] border-t border-white/10">
                    <div className="flex items-center gap-[5px]">
                      <span className="w-[12px] h-[12px] rounded-full flex-shrink-0" style={{ backgroundColor: et.color }} />
                      <span className="text-[13px]">{et.label}</span>
                    </div>
                    <span className="text-[13px] font-bold">{formatCurrencyFull(et.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ============= DETAILED TABLE ============= */}
      <section className="bg-[#0F1535] rounded-[10px] p-[7px]">
        <h2 className="text-[18px] font-bold mb-[10px] px-[5px] text-right">פירוט תזרים</h2>

        {/* Table Header */}
        <div className="flex flex-row-reverse items-center justify-between min-h-[45px] border-b-2 border-white/15 p-[5px] gap-[5px]">
          <span className="text-[13px] font-semibold w-[90px] text-right">תקופה</span>
          <span className="text-[13px] font-medium w-[75px] text-center">הכנסות</span>
          <span className="text-[13px] font-medium w-[75px] text-center">יציאות</span>
          <span className="text-[13px] font-medium w-[75px] text-center hidden sm:block">תזרים נקי</span>
          <span className="text-[13px] font-medium w-[75px] text-center">מצטבר</span>
        </div>

        {/* Loading */}
        {isLoading ? (
          <div className="flex flex-col gap-[5px] p-[10px]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-[45px] bg-white/5 rounded animate-pulse" />
            ))}
          </div>
        ) : cashFlowRows.length === 0 ? (
          <div className="flex items-center justify-center py-[40px]">
            <span className="text-[16px] text-white/50">אין נתונים להצגה</span>
          </div>
        ) : (
          <div className="flex flex-col">
            {cashFlowRows.map((row, index) => (
              <Button
                key={row.startDate}
                type="button"
                onClick={() => canDrillDown && handleRowClick(row)}
                className={`flex flex-row-reverse items-center justify-between w-full min-h-[45px] p-[5px] gap-[5px] border-b border-white/10 transition-colors ${
                  canDrillDown ? "hover:bg-[#29318A]/30 cursor-pointer" : "cursor-default"
                } ${index % 2 === 0 ? "bg-white/[0.02]" : ""}`}
              >
                <div className="flex flex-row-reverse items-center gap-[5px] w-[90px]">
                  <span className="text-[13px] font-bold text-right">{row.label}</span>
                  {canDrillDown && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-white/30 flex-shrink-0">
                      <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className="text-[13px] font-bold w-[75px] text-center text-[#17DB4E]">
                  {formatCurrency(row.inflows)}
                </span>
                <span className="text-[13px] font-bold w-[75px] text-center text-[#F64E60]">
                  {formatCurrency(row.outflows)}
                </span>
                <span className={`text-[13px] font-bold w-[75px] text-center hidden sm:block ${row.net >= 0 ? "text-[#17DB4E]" : "text-[#F64E60]"}`}>
                  {formatCurrency(row.net)}
                </span>
                <span className={`text-[13px] font-bold w-[75px] text-center ${row.cumulative >= 0 ? "text-[#17DB4E]" : "text-[#F64E60]"}`}>
                  {formatCurrency(row.cumulative)}
                </span>
              </Button>
            ))}

            {/* Totals Row */}
            <div className="flex flex-row-reverse items-center justify-between min-h-[50px] p-[5px] gap-[5px] border-t-2 border-white/20 bg-white/5">
              <span className="text-[14px] font-bold w-[90px] text-right">סה&quot;כ</span>
              <span className="text-[14px] font-bold w-[75px] text-center text-[#17DB4E]">
                {formatCurrency(totalInflows)}
              </span>
              <span className="text-[14px] font-bold w-[75px] text-center text-[#F64E60]">
                {formatCurrency(totalOutflows)}
              </span>
              <span className={`text-[14px] font-bold w-[75px] text-center hidden sm:block ${netCashFlow >= 0 ? "text-[#17DB4E]" : "text-[#F64E60]"}`}>
                {formatCurrency(netCashFlow)}
              </span>
              <span className={`text-[14px] font-bold w-[75px] text-center ${cumulativeBalance >= 0 ? "text-[#17DB4E]" : "text-[#F64E60]"}`}>
                {formatCurrency(cumulativeBalance)}
              </span>
            </div>
          </div>
        )}
      </section>
    </article>
  );
}
