"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useDashboard } from "./layout";
import { DailyEntryForm } from "@/components/dashboard/DailyEntryForm";
import { DailyEntriesModal } from "@/components/dashboard/DailyEntriesModal";
import { HistoryModal } from "@/components/dashboard/HistoryModal";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { createClient } from "@/lib/supabase/client";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useToast } from "@/components/ui/toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ============================================================================
// LAZY LOADED CHART COMPONENTS - Recharts (~200KB) loaded only when needed
// ============================================================================
const LazyBarChart = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.BarChart })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
const LazyBar = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.Bar })),
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

// Safe chart wrapper that prevents -1 width/height errors
const SafeChartContainer = ({ children }: { children: React.ReactNode }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });

    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full h-[280px]">
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
const LazyAreaChart = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.AreaChart })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
const LazyArea = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.Area })),
  { ssr: false }
);
const LazyComposedChart = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.ComposedChart })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
const LazyLine = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.Line })),
  { ssr: false }
);
const LazyCartesianGrid = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.CartesianGrid })),
  { ssr: false }
);

// Chart skeleton loader
const ChartSkeleton = () => (
  <div className="w-full h-full flex items-center justify-center bg-white/5 rounded-lg animate-pulse">
    <div className="text-white/30 text-sm">טוען גרף...</div>
  </div>
);

// Chart data - כל הגרפים נבנים דינמית מהמסד נתונים

// Business card type from database
interface BusinessCard {
  id: string;
  name: string;
  logo_url: string | null;
  status: "active" | "inactive";
  totalIncome: number;
  fixedExpenses: number;
  fixedExpensesDiff: number;
  variableExpenses: number;
  variableExpensesDiff: number;
  targetDiffPct: number; // הפרש מהיעד באחוזים
  laborCostPct: number; // עלות עובדים באחוזים
  laborCostDiffPct: number; // הפרש עלות עובדים מהיעד באחוזים (לצבע)
  foodCostPct: number; // עלות מכר באחוזים
  foodCostDiffPct: number; // הפרש עלות מכר מהיעד באחוזים (לצבע)
}

// Detailed summary data for expanded section
interface DetailedSummary {
  totalIncome: number;
  incomeBeforeVat: number; // סה"כ קופה לפני מע"מ
  totalExpenses: number;
  fixedExpenses: number;
  variableExpenses: number;
  laborCost: number;
  laborCostPct: number;
  laborCostTargetPct: number; // יעד עלות עובדים באחוזים
  laborCostDiffPct: number; // הפרש מהיעד באחוזים: laborCostPct - laborCostTargetPct
  laborCostDiffAmount: number; // הפרש מהיעד בש"ח: (laborCostDiffPct × incomeBeforeVat) ÷ 100
  laborCostPrevMonthChange: number; // שינוי מחודש קודם באחוזים
  laborCostPrevYearChange: number; // שינוי משנה שעברה באחוזים
  foodCost: number;
  foodCostPct: number;
  foodCostTargetPct: number; // יעד עלות מכר באחוזים
  foodCostDiffPct: number; // הפרש מהיעד באחוזים: foodCostPct - foodCostTargetPct
  foodCostPrevMonthPct: number; // עלות מכר באחוזים חודש קודם
  foodCostPrevMonthChange: number; // שינוי מחודש קודם: foodCostPct - foodCostPrevMonthPct
  foodCostPrevYearPct: number; // עלות מכר באחוזים שנה שעברה
  foodCostPrevYearChange: number; // שינוי משנה שעברה: foodCostPct - foodCostPrevYearPct
  // הוצאות שוטפות (current_expenses)
  currentExpenses: number; // סה"כ הוצאות שוטפות בש"ח
  currentExpensesPct: number; // הוצאות שוטפות באחוזים
  currentExpensesTargetPct: number; // יעד הוצאות שוטפות באחוזים
  currentExpensesDiffPct: number; // הפרש מהיעד באחוזים
  currentExpensesPrevMonthChange: number; // שינוי מחודש קודם
  currentExpensesPrevYearChange: number; // שינוי משנה שעברה
  privateIncome: number;
  privateCount: number;
  privateAvg: number;
  businessIncome: number;
  businessCount: number;
  businessAvg: number;
  profitLoss: number;
  monthlyPace: number;
  revenueTarget: number;
  revenueTargetBeforeVat: number; // יעד הכנסות לפני מע"מ
  targetDiffPct: number;
  targetDiffAmount: number;
  // Comparison data
  prevMonthIncome: number;
  prevMonthChange: number; // current - previous
  prevMonthChangePct: number; // percentage change
  prevYearIncome: number;
  prevYearChange: number; // current - previous year same month
  prevYearChangePct: number; // percentage change
}


// Task display data for UI
interface TaskDisplay {
  id: string;
  number: string;
  assignee: string;
  category: string;
  dueDate: string;
  description: string;
  status: string;
  isOverdue: boolean;
}

// Income source with aggregated data
interface IncomeSourceSummary {
  id: string;
  name: string;
  incomeType: string; // 'private' | 'business'
  totalAmount: number;
  ordersCount: number;
  avgAmount: number;
  avgTicketTarget: number; // יעד ממוצע הזמנה
  avgTicketDiff: number; // הפרש: ממוצע בפועל - יעד
  targetDiffAmount: number; // הפרש מהיעד בש"ח: (ממוצע - יעד) × כמות הזמנות
  prevMonthAvg: number; // ממוצע הזמנה חודש קודם
  prevMonthChange: number; // שינוי מחודש קודם בש"ח: ממוצע נוכחי - ממוצע חודש קודם
  prevYearAvg: number; // ממוצע הזמנה שנה שעברה באותה תקופה
  prevYearChange: number; // שינוי משנה שעברה בש"ח: ממוצע נוכחי - ממוצע שנה שעברה
}

// Managed product with aggregated data
interface ManagedProductSummary {
  id: string;
  name: string;
  unit: string;
  totalQuantity: number;
  totalCost: number;
  unitCost: number;
  targetPct: number | null;
  prevMonthPct: number | null;
  prevYearPct: number | null;
  prevMonthChange: number;
  prevYearChange: number;
}

// ============================================================================
// FORMAT FUNCTIONS - Moved outside component to prevent re-creation on render
// ============================================================================

// Format currency for display - show K for thousands, M for millions
const formatCurrency = (amount: number) => {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const sign = isNegative ? '-' : '';

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

// Format currency with + sign for positive values (for diff display)
const formatCurrencyWithSign = (amount: number) => {
  const isNegative = amount < 0;
  const isPositive = amount > 0;
  const absAmount = Math.abs(amount);
  const sign = isNegative ? '-' : isPositive ? '+' : '';

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

// Format currency as full number with comma separators (e.g., ₪8,500 instead of ₪8.5K)
const formatCurrencyFull = (amount: number) => {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const sign = isNegative ? '-' : '';
  const formatted = Math.round(absAmount).toLocaleString("he-IL");
  return `${sign}₪${formatted}`;
};

// Format currency as full number with sign (e.g., +₪8,500 or -₪8,500.50)
const formatCurrencyFullWithSign = (amount: number) => {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const sign = isNegative ? '-' : '';
  const formatted = Math.round(absAmount).toLocaleString("he-IL");
  return `${sign}₪${formatted}`;
};

// Format percentage - show 2 decimals only if not a whole number
const formatPercent = (value: number) => {
  if (value % 1 === 0) {
    return `${Math.round(value)}%`;
  }
  return `${value.toFixed(2)}%`;
};

// Format percentage with sign (+ for positive, - for negative)
const formatPercentWithSign = (value: number) => {
  if (value % 1 === 0) {
    return `${Math.round(value)}%`;
  }
  return `${value.toFixed(2)}%`;
};

// Format local date to YYYY-MM-DD string (avoids timezone issues)
const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// ============================================================================

export default function DashboardPage() {
  const { selectedBusinesses, toggleBusiness, setSelectedBusinesses } = useDashboard();
  const { showToast } = useToast();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [realBusinessId, setRealBusinessId] = useState<string | null>(null);
  const [businessCards, setBusinessCards] = useState<BusinessCard[]>([]);
  const [detailedSummary, setDetailedSummary] = useState<DetailedSummary | null>(null);
  const [tasks, setTasks] = useState<TaskDisplay[]>([]);
  const [_isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false); // For detailed summary loading
  const [isInitialLoad, setIsInitialLoad] = useState(false); // For skeleton - only when user clicks on business
  const [incomeSourcesSummary, setIncomeSourcesSummary] = useState<IncomeSourceSummary[]>([]);
  const [managedProductsSummary, setManagedProductsSummary] = useState<ManagedProductSummary[]>([]);
  // נתונים היסטוריים לגרף ממוצע הזמנה - 6 חודשים אחרונים
  const [orderAvgChartData, setOrderAvgChartData] = useState<{ month: string; [key: string]: number | string }[]>([]);
  // נתונים היסטוריים לגרף ניהול עלות מכר - 6 חודשים אחרונים
  const [foodCostChartData, setFoodCostChartData] = useState<{ month: string; actual: number; target: number }[]>([]);
  // נתונים היסטוריים לגרף עלות עבודה - 6 חודשים אחרונים
  const [laborCostChartData, setLaborCostChartData] = useState<{ month: string; actual: number; target: number }[]>([]);
  // נתונים היסטוריים לגרף מוצר מנוהל - 6 חודשים אחרונים
  const [managedProductChartData, setManagedProductChartData] = useState<{ month: string; actual: number; target: number }[]>([]);
  // נתונים היסטוריים לגרף מגמות - 6 חודשים אחרונים
  const [trendsChartData, setTrendsChartData] = useState<{ month: string; salesActual: number; salesTarget: number; laborCostPct: number; foodCostPct: number }[]>([]);
  const [savedDateRange, setSavedDateRange] = usePersistedState<{ start: string; end: string } | null>("dashboard:dateRange", null);
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date } | null>(null);

  // Initialize date range on client only to avoid hydration mismatch
  useEffect(() => {
    if (!dateRange) {
      if (savedDateRange) {
         
        setDateRange({ start: new Date(savedDateRange.start), end: new Date(savedDateRange.end) });
      } else {
         
        setDateRange({
          start: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          end: new Date(),
        });
      }
    }
  }, [dateRange, savedDateRange]);

  const handleDateRangeChange = useCallback((range: { start: Date; end: Date }) => {
    setDateRange(range);
    setSavedDateRange({ start: range.start.toISOString(), end: range.end.toISOString() });
  }, [setSavedDateRange]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isDailyEntriesModalOpen, setIsDailyEntriesModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyCardType, setHistoryCardType] = useState('');
  const [historyCardTitle, setHistoryCardTitle] = useState('');
  const [historySourceId, setHistorySourceId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSingleBusiness, setIsSingleBusiness] = useState(false); // Non-admin with only one business
  const [isSendingPush, setIsSendingPush] = useState(false);
  const [showAllBusinessCards, setShowAllBusinessCards] = useState(false); // Show all business cards or limit to 6
  const [inactiveBusinessCards, setInactiveBusinessCards] = useState<{ id: string; name: string; logo_url: string | null }[]>([]);
  const [showInactiveBusinesses, setShowInactiveBusinesses] = useState(false);

  const openHistoryModal = useCallback((cardType: string, title: string, sourceId?: string) => {
    setHistoryCardType(cardType);
    setHistoryCardTitle(title);
    setHistorySourceId(sourceId || null);
    setHistoryModalOpen(true);
  }, []);

  // Send daily push email via n8n webhook
  const handleDailyPush = useCallback(async () => {
    if (!detailedSummary || !dateRange) {
      showToast("אין נתונים לשליחה", "warning");
      return;
    }
    setIsSendingPush(true);
    try {
      const supabase = createClient();
      const today = new Date();
      const dayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
      const monthNames = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
      const dayName = dayNames[today.getDay()];
      const dateStr = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getFullYear()).slice(-2)}`;
      const monthName = monthNames[dateRange.start.getMonth()];
      const year = dateRange.start.getFullYear();

      const s = detailedSummary;

      // ================================================================
      // FETCH TODAY'S DATA for the daily table
      // ================================================================
      const todayStr = formatLocalDate(today);

      // Fetch today's entries, goods suppliers, current expenses suppliers in parallel
      const [todayEntriesResult, goodsSuppliersResult, currentExpensesSuppliersResult, businessDataResult, goalsResult] = await Promise.all([
        supabase
          .from("daily_entries")
          .select("*")
          .in("business_id", selectedBusinesses)
          .eq("entry_date", todayStr)
          .is("deleted_at", null),
        supabase
          .from("suppliers")
          .select("id")
          .in("business_id", selectedBusinesses)
          .eq("expense_type", "goods_purchases")
          .eq("is_active", true)
          .is("deleted_at", null),
        supabase
          .from("suppliers")
          .select("id")
          .in("business_id", selectedBusinesses)
          .eq("expense_type", "current_expenses")
          .eq("is_active", true)
          .is("deleted_at", null),
        supabase
          .from("businesses")
          .select("id, markup_percentage, manager_monthly_salary, vat_percentage")
          .in("id", selectedBusinesses),
        supabase
          .from("goals")
          .select("id, business_id, revenue_target, labor_cost_target_pct, food_cost_target_pct, current_expenses_target, markup_percentage, vat_percentage")
          .in("business_id", selectedBusinesses)
          .eq("year", dateRange.start.getFullYear())
          .eq("month", dateRange.start.getMonth() + 1)
          .is("deleted_at", null),
      ]);

      const todayEntries = todayEntriesResult.data || [];
      const goodsSupplierIds = (goodsSuppliersResult.data || []).map(s => s.id);
      const currentExpensesSupplierIds = (currentExpensesSuppliersResult.data || []).map(s => s.id);
      const businessData = businessDataResult.data || [];
      const goalsData = goalsResult.data || [];
      const todayEntryIds = todayEntries.map(e => e.id);

      // Fetch today's breakdowns, goods invoices, current expenses invoices, managed products in parallel
      const [todayBreakdownResult, todayGoodsInvoicesResult, todayCurrentExpensesInvoicesResult, todayProductUsageResult, incomeSourcesResult, incomeSourceGoalsResult, managedProductsResult, scheduleResult] = await Promise.all([
        todayEntryIds.length > 0
          ? supabase.from("daily_income_breakdown").select("income_source_id, amount, orders_count").in("daily_entry_id", todayEntryIds)
          : Promise.resolve({ data: [] }),
        goodsSupplierIds.length > 0
          ? supabase.from("invoices").select("subtotal").in("supplier_id", goodsSupplierIds).in("business_id", selectedBusinesses).eq("invoice_date", todayStr).is("deleted_at", null)
          : Promise.resolve({ data: [] }),
        currentExpensesSupplierIds.length > 0
          ? supabase.from("invoices").select("subtotal").in("supplier_id", currentExpensesSupplierIds).in("business_id", selectedBusinesses).eq("invoice_date", todayStr).is("deleted_at", null)
          : Promise.resolve({ data: [] }),
        todayEntryIds.length > 0
          ? supabase.from("daily_product_usage").select("product_id, quantity, unit_cost_at_time").in("daily_entry_id", todayEntryIds)
          : Promise.resolve({ data: [] }),
        supabase.from("income_sources").select("id, name, income_type").in("business_id", selectedBusinesses).eq("is_active", true).is("deleted_at", null).order("display_order"),
        goalsData.length > 0
          ? supabase.from("income_source_goals").select("income_source_id, avg_ticket_target").in("goal_id", goalsData.map(g => g.id))
          : Promise.resolve({ data: [] }),
        supabase.from("managed_products").select("id, name, unit, unit_cost, target_pct").in("business_id", selectedBusinesses).eq("is_active", true).is("deleted_at", null),
        supabase.from("business_schedule").select("business_id, day_of_week, day_factor").in("business_id", selectedBusinesses),
      ]);

      // Fetch additional info: open payments, open suppliers, open commitments
      const businessId = selectedBusinesses[0];
      const [openPaymentSplitsResult, allInvoicesTotalResult, allPaymentsTotalResult, allCommitmentSplitsResult, paidCommitmentSplitsResult] = await Promise.all([
        // Open payments - payment splits with due_date > today
        supabase
          .from("payment_splits")
          .select("amount, payments!inner(business_id, deleted_at)")
          .eq("payments.business_id", businessId)
          .is("payments.deleted_at", null)
          .gt("due_date", todayStr),
        // All invoices total
        supabase
          .from("invoices")
          .select("total_amount")
          .eq("business_id", businessId)
          .is("deleted_at", null),
        // All payments total
        supabase
          .from("payments")
          .select("total_amount")
          .eq("business_id", businessId)
          .is("deleted_at", null),
        // All commitment splits (installments_count > 3)
        supabase
          .from("payment_splits")
          .select("amount, installments_count, payments!inner(business_id, deleted_at)")
          .eq("payments.business_id", businessId)
          .is("payments.deleted_at", null)
          .gt("installments_count", 3),
        // Paid commitment splits (due_date <= today)
        supabase
          .from("payment_splits")
          .select("amount, installments_count, payments!inner(business_id, deleted_at)")
          .eq("payments.business_id", businessId)
          .is("payments.deleted_at", null)
          .gt("installments_count", 3)
          .lte("due_date", todayStr),
      ]);

      const openPaymentsTotal = (openPaymentSplitsResult.data || []).reduce(
        (sum: number, s: Record<string, unknown>) => sum + (Number(s.amount) || 0), 0
      );
      const totalInvoicesAmount = (allInvoicesTotalResult.data || []).reduce(
        (sum: number, inv: Record<string, unknown>) => sum + (Number(inv.total_amount) || 0), 0
      );
      const totalPaymentsAmount = (allPaymentsTotalResult.data || []).reduce(
        (sum: number, pay: Record<string, unknown>) => sum + (Number(pay.total_amount) || 0), 0
      );
      const openSuppliersTotal = totalInvoicesAmount - totalPaymentsAmount;
      const totalCommitments = (allCommitmentSplitsResult.data || []).reduce(
        (sum: number, s: Record<string, unknown>) => sum + (Number(s.amount) || 0), 0
      );
      const paidCommitments = (paidCommitmentSplitsResult.data || []).reduce(
        (sum: number, s: Record<string, unknown>) => sum + (Number(s.amount) || 0), 0
      );
      const openCommitmentsTotal = totalCommitments - paidCommitments;

      const todayBreakdowns = todayBreakdownResult.data || [];
      const allIncomeSources = incomeSourcesResult.data || [];
      const allManagedProducts = managedProductsResult.data || [];

      // Build avg ticket target map
      const avgTicketTargetMap: Record<string, number> = {};
      (incomeSourceGoalsResult.data || []).forEach((g: { income_source_id: string; avg_ticket_target: number }) => {
        avgTicketTargetMap[g.income_source_id] = Number(g.avg_ticket_target) || 0;
      });

      // Calculate today's income
      const todayTotalIncome = todayEntries.reduce((sum: number, e: Record<string, unknown>) => sum + (Number(e.total_register) || 0), 0);

      // Calculate today's labor cost (same formula as dashboard)
      const todayRawLaborCost = todayEntries.reduce((sum: number, e: Record<string, unknown>) => sum + (Number(e.labor_cost) || 0), 0);
      const totalMarkup = businessData.reduce((sum, b) => {
        const bGoal = goalsData.find((g: Record<string, unknown>) => g.business_id === b.id);
        return sum + (bGoal?.markup_percentage != null ? Number(bGoal.markup_percentage) : (Number(b.markup_percentage) || 1));
      }, 0) / Math.max(businessData.length, 1);
      const totalManagerSalary = businessData.reduce((sum, b) => sum + (Number(b.manager_monthly_salary) || 0), 0);

      // Expected work days from schedule (for manager daily cost)
      const scheduleData = scheduleResult.data || [];
      const scheduleDayFactors: Record<number, number[]> = {};
      scheduleData.forEach((sc: { day_of_week: number; day_factor: number }) => {
        if (!scheduleDayFactors[sc.day_of_week]) scheduleDayFactors[sc.day_of_week] = [];
        scheduleDayFactors[sc.day_of_week].push(Number(sc.day_factor) || 0);
      });
      const avgScheduleDayFactors: Record<number, number> = {};
      Object.keys(scheduleDayFactors).forEach(dow => {
        const factors = scheduleDayFactors[Number(dow)];
        avgScheduleDayFactors[Number(dow)] = factors.reduce((a, b) => a + b, 0) / factors.length;
      });
      const targetMonthForSchedule = dateRange.start.getMonth();
      const targetYearForSchedule = dateRange.start.getFullYear();
      const firstDayOfMonthSchedule = new Date(targetYearForSchedule, targetMonthForSchedule, 1);
      const lastDayOfMonthSchedule = new Date(targetYearForSchedule, targetMonthForSchedule + 1, 0);
      let expectedWorkDaysInMonth = 0;
      const curDateSch = new Date(firstDayOfMonthSchedule);
      while (curDateSch <= lastDayOfMonthSchedule) {
        expectedWorkDaysInMonth += avgScheduleDayFactors[curDateSch.getDay()] || 0;
        curDateSch.setDate(curDateSch.getDate() + 1);
      }

      const managerDailyCost = expectedWorkDaysInMonth > 0 ? totalManagerSalary / expectedWorkDaysInMonth : 0;
      const todayActualWorkDays = todayEntries.reduce((sum: number, e: Record<string, unknown>) => sum + (Number(e.day_factor) || 0), 0);
      const todayLaborCost = (todayRawLaborCost + (managerDailyCost * todayActualWorkDays)) * totalMarkup;

      // VAT calculation
      const avgVatPercentage = businessData.reduce((sum, b) => {
        const bGoal = goalsData.find((g: Record<string, unknown>) => g.business_id === b.id);
        return sum + (bGoal?.vat_percentage != null ? Number(bGoal.vat_percentage) : (Number(b.vat_percentage) || 0));
      }, 0) / Math.max(businessData.length, 1);
      const vatDivisor = avgVatPercentage > 0 ? 1 + avgVatPercentage : 1;
      const todayIncomeBeforeVat = todayTotalIncome / vatDivisor;

      // Today's labor cost percentage
      const todayLaborCostPct = todayIncomeBeforeVat > 0 ? (todayLaborCost / todayIncomeBeforeVat) * 100 : 0;
      const laborCostTargetPct = goalsData.reduce((sum, g) => sum + (Number(g.labor_cost_target_pct) || 0), 0) / Math.max(goalsData.length, 1);
      const todayLaborCostDiffPct = todayLaborCostPct - laborCostTargetPct;

      // Today's food cost
      const todayFoodCost = (todayGoodsInvoicesResult.data || []).reduce((sum: number, inv: { subtotal: number }) => sum + (Number(inv.subtotal) || 0), 0);
      const todayFoodCostPct = todayIncomeBeforeVat > 0 ? (todayFoodCost / todayIncomeBeforeVat) * 100 : 0;
      const foodCostTargetPct = goalsData.reduce((sum, g) => sum + (Number(g.food_cost_target_pct) || 0), 0) / Math.max(goalsData.length, 1);
      const todayFoodCostDiffPct = todayFoodCostPct - foodCostTargetPct;

      // Today's current expenses
      const todayCurrentExpenses = (todayCurrentExpensesInvoicesResult.data || []).reduce((sum: number, inv: { subtotal: number }) => sum + (Number(inv.subtotal) || 0), 0);

      // Today's income breakdown by source type
      let todayPrivateIncome = 0, todayPrivateCount = 0, todayBusinessIncome = 0, todayBusinessCount = 0;
      todayBreakdowns.forEach((b: { income_source_id: string; amount: number; orders_count: number }) => {
        const source = allIncomeSources.find((src: { id: string; income_type: string }) => src.id === b.income_source_id);
        const amount = Number(b.amount) || 0;
        const orders = Number(b.orders_count) || 0;
        if (source?.income_type === "business") {
          todayBusinessIncome += amount;
          todayBusinessCount += orders;
        } else {
          todayPrivateIncome += amount;
          todayPrivateCount += orders;
        }
      });

      const todayTotalOrders = todayPrivateCount + todayBusinessCount;
      const todayPrivateAvg = todayPrivateCount > 0 ? todayPrivateIncome / todayPrivateCount : 0;
      const todayBusinessAvg = todayBusinessCount > 0 ? todayBusinessIncome / todayBusinessCount : 0;

      // Today's managed products
      const todayProductQuantities: Record<string, number> = {};
      (todayProductUsageResult.data || []).forEach((p: { product_id: string; quantity: number }) => {
        todayProductQuantities[p.product_id] = (todayProductQuantities[p.product_id] || 0) + (Number(p.quantity) || 0);
      });

      // ================================================================
      // INCOME SOURCE TARGETS
      // ================================================================
      const privateSource = allIncomeSources.find((src: { income_type: string }) => src.income_type === 'private');
      const businessSource = allIncomeSources.find((src: { income_type: string }) => src.income_type === 'business');
      const privateAvgTarget = privateSource ? (avgTicketTargetMap[privateSource.id] || 0) : 0;
      const businessAvgTarget = businessSource ? (avgTicketTargetMap[businessSource.id] || 0) : 0;
      const todayPrivateDiff = privateAvgTarget ? todayPrivateAvg - privateAvgTarget : 0;
      const todayBusinessDiff = businessAvgTarget ? todayBusinessAvg - businessAvgTarget : 0;

      // Monthly cumulative data (from detailedSummary - already computed for the date range)
      const cumPrivateSource = incomeSourcesSummary.find(src => src.incomeType === 'private');
      const cumBusinessSource = incomeSourcesSummary.find(src => src.incomeType === 'business');
      const cumPrivateAvg = cumPrivateSource?.avgAmount || 0;
      const cumBusinessAvg = cumBusinessSource?.avgAmount || 0;
      const cumPrivateDiff = privateAvgTarget ? cumPrivateAvg - privateAvgTarget : 0;
      const cumBusinessDiff = businessAvgTarget ? cumBusinessAvg - businessAvgTarget : 0;
      const revTargetDiffPct = s.targetDiffPct || 0;

      // Inline styles for email compatibility (Gmail strips CSS classes)
      const cellStyle = 'color:#fff;font-size:12px;height:24px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.1);padding:2px 4px;direction:ltr;';
      const headerCellStyle = 'color:#fff;font-size:11px;font-weight:bold;text-align:center;height:24px;border-bottom:1px solid rgba(255,255,255,0.1);padding:2px 4px;white-space:nowrap;';
      const labelCellStyle = 'color:#fff;font-size:12px;height:24px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.1);padding:2px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      const redColor = '#f87171';
      const greenColor = '#4ade80';
      const diffColor = (val: number, invert = false) => {
        if (val === 0) return '#fff';
        if (invert) return val > 0 ? redColor : greenColor;
        return val < 0 ? redColor : val > 0 ? greenColor : '#fff';
      };

      // Helper to build a table section
      const buildTable = (title: string, headers: string[], rows: string[][]) => {
        const headerRow = headers.map(h => `<th style="${headerCellStyle}">${h}</th>`).join('');
        const bodyRows = rows.map(row => {
          const cells = row.map((cell, i) => {
            const st = i === 0 ? labelCellStyle : cellStyle;
            return `<td style="${st}">${cell}</td>`;
          }).join('');
          return `<tr>${cells}</tr>`;
        }).join('');
        return `<div style="background:#0F1535;border-radius:10px;border:2px solid #FFCF00;padding:7px;margin-bottom:10px;">
          <div style="color:#FFCF00;font-size:16px;font-weight:bold;text-align:center;margin-bottom:10px;">${title}</div>
          <table style="width:100%;border-collapse:collapse;direction:rtl;" dir="rtl">
            <tr>${headerRow}</tr>
            ${bodyRows}
          </table>
        </div>`;
      };

      // Today's managed products data
      const todayMpData = (allManagedProducts || []).map((p: { id: string; name: string; unit_cost: number; target_pct: number | null }) => {
        const qty = todayProductQuantities[p.id] || 0;
        const cost = qty * (Number(p.unit_cost) || 0);
        const pct = todayIncomeBeforeVat > 0 && cost > 0 ? (cost / todayIncomeBeforeVat) * 100 : 0;
        const diff = p.target_pct ? pct - p.target_pct : 0;
        return { name: p.name, pct, qty: Math.round(qty), targetPct: p.target_pct, diff };
      });

      // Monthly cumulative managed products data
      const cumMpData = managedProductsSummary.map(p => {
        const pct = s.incomeBeforeVat && p.totalCost > 0 ? (p.totalCost / s.incomeBeforeVat) * 100 : 0;
        const diff = p.targetPct ? pct - p.targetPct : 0;
        return { name: p.name, pct, qty: Math.round(p.totalQuantity), targetPct: p.targetPct, diff };
      });

      // === Daily Summary Table (TODAY's data only) ===
      const dailyRows: string[][] = [
        ['סה"כ קופה כולל מע"מ', `₪${Math.round(todayTotalIncome).toLocaleString('he-IL')}`, '', `<span style="color:${diffColor(revTargetDiffPct)}">${revTargetDiffPct.toFixed(1)}%</span>`],
        ['במקום', `₪${Math.round(todayPrivateIncome).toLocaleString('he-IL')}`, `${todayPrivateCount}`, `<span style="color:${diffColor(todayPrivateDiff)}">${todayPrivateDiff < 0 ? '-' : ''}₪${Math.abs(todayPrivateDiff).toFixed(1)}</span>`],
        ['במשלוח', `₪${Math.round(todayBusinessIncome).toLocaleString('he-IL')}`, `${todayBusinessCount}`, `<span style="color:${diffColor(todayBusinessDiff)}">${todayBusinessDiff < 0 ? '-' : ''}₪${Math.abs(todayBusinessDiff).toFixed(1)}</span>`],
        ['ע. עובדים (%)', `${todayLaborCostPct.toFixed(2)}%`, `${todayTotalOrders}`, `<span style="color:${diffColor(todayLaborCostDiffPct, true)}">${todayLaborCostDiffPct > 0 ? '' : '-'}${Math.abs(todayLaborCostDiffPct).toFixed(2)}%</span>`],
        ...todayMpData.map(p => [
          `${p.name} (%)`, `${p.pct.toFixed(2)}%`, `${p.qty}`,
          `<span style="color:${diffColor(p.diff, true)}">${p.diff !== 0 ? p.diff.toFixed(2) + '%' : '-'}</span>`
        ]),
        ['עלות מכר', `${todayFoodCostPct.toFixed(2)}%`, '', `<span style="color:${diffColor(todayFoodCostDiffPct, true)}">${todayFoodCostDiffPct !== 0 ? (todayFoodCostDiffPct > 0 ? '' : '-') + Math.abs(todayFoodCostDiffPct).toFixed(2) + '%' : '-'}</span>`],
        ['הוצאות שוטפות', `₪${Math.round(todayCurrentExpenses).toLocaleString('he-IL')}`, '', '-'],
      ];
      const dailyHtml = buildTable(`הסיכום היומי ליום ${dayName}, ${dateStr}`, ['', 'סה"כ יומי', 'כמות', 'הפרש מהיעד'], dailyRows);

      // === Goals/Targets Table ===
      const goalsRows: string[][] = [
        ['סה"כ קופה כולל מע"מ', `₪${Math.round(s.revenueTarget).toLocaleString('he-IL')}`],
        ['במקום', `₪${Math.round(privateAvgTarget).toLocaleString('he-IL')}`],
        ['במשלוח', `₪${Math.round(businessAvgTarget).toLocaleString('he-IL')}`],
        ['ע. עובדים (%)', `${Math.round(s.laborCostTargetPct)}%`],
        ...cumMpData.map(p => [`עלות ${p.name} (%)`, p.targetPct ? `${p.targetPct}%` : '-']),
        ['עלות מכר', `${Math.round(s.foodCostTargetPct)}%`],
        ['הוצאות שוטפות', '-'],
      ];
      const goalsHtml = buildTable('פרמטר / יעד', ['פרמטר', 'יעד'], goalsRows);

      // === Monthly Cumulative Table (from detailedSummary - full date range) ===
      const cumulativeRows: string[][] = [
        ['סה"כ קופה', `₪${Math.round(s.totalIncome).toLocaleString('he-IL')}`, `<span style="color:${diffColor(revTargetDiffPct)}">${revTargetDiffPct.toFixed(1)}%</span>`],
        ['במקום', `₪${cumPrivateAvg.toFixed(2)}`, `<span style="color:${diffColor(cumPrivateDiff)}">${cumPrivateDiff < 0 ? '-' : ''}₪${Math.abs(cumPrivateDiff).toFixed(1)}</span>`],
        ['במשלוח', `₪${cumBusinessAvg.toFixed(2)}`, `<span style="color:${diffColor(cumBusinessDiff)}">${cumBusinessDiff < 0 ? '-' : ''}₪${Math.abs(cumBusinessDiff).toFixed(1)}</span>`],
        ['ע. עובדים', `${s.laborCostPct.toFixed(2)}%`, `<span style="color:${diffColor(s.laborCostDiffPct, true)}">${s.laborCostDiffPct > 0 ? '' : '-'}${Math.abs(s.laborCostDiffPct).toFixed(1)}%</span>`],
        ...cumMpData.map(p => [
          p.name, `${p.pct.toFixed(2)}%`,
          `<span style="color:${diffColor(p.diff, true)}">${p.diff !== 0 ? p.diff.toFixed(2) + '%' : '-'}</span>`
        ]),
        ['עלות מכר', `${s.foodCostPct.toFixed(2)}%`, `<span style="color:${diffColor(s.foodCostDiffPct, true)}">${s.foodCostDiffPct !== 0 ? (s.foodCostDiffPct > 0 ? '' : '-') + Math.abs(s.foodCostDiffPct).toFixed(2) + '%' : '-'}</span>`],
        ['הוצאות שוטפות', `₪${Math.round(s.currentExpenses).toLocaleString('he-IL')}`, `<span style="color:${diffColor(s.currentExpensesDiffPct, true)}">${s.currentExpensesDiffPct !== 0 ? (s.currentExpensesDiffPct > 0 ? '' : '-') + Math.abs(s.currentExpensesDiffPct).toFixed(2) + '%' : '-'}</span>`],
      ];
      const cumulativeHtml = buildTable(`מצטבר חודש ${monthName}, ${year}`, ['', 'סה"כ', 'הפרש'], cumulativeRows);

      // === Additional Info Section (open payments, suppliers, commitments) ===
      const infoLabelStyle = 'color:#fff;font-size:16px;font-weight:bold;';
      const infoValueStyle = 'color:#fff;font-size:16px;font-weight:500;direction:ltr;';
      const additionalInfoHtml = `<div style="background:#0F1535;margin-top:15px;border:2px solid #FFCF00;border-radius:10px;padding:10px 15px;direction:rtl;">
        <table style="width:100%;border-collapse:collapse;direction:rtl;" dir="rtl">
          <tr><td style="${infoLabelStyle}padding:4px 0;">תשלומים פתוחים:</td><td style="${infoValueStyle}text-align:left;padding:4px 0;">₪${Math.round(openPaymentsTotal).toLocaleString('he-IL')}</td></tr>
          <tr><td style="${infoLabelStyle}padding:4px 0;">ספקים פתוחים:</td><td style="${infoValueStyle}text-align:left;padding:4px 0;">₪${Math.round(openSuppliersTotal).toLocaleString('he-IL')}</td></tr>
          <tr><td style="${infoLabelStyle}padding:4px 0;">התחייבויות קודמות:</td><td style="${infoValueStyle}text-align:left;padding:4px 0;">₪${Math.round(openCommitmentsTotal).toLocaleString('he-IL')}</td></tr>
        </table>
      </div>`;

      // === Monthly Forecast Section (צפי הכנסות חודשי, צפי רווח החודש) ===
      const monthlyPace = s.monthlyPace || 0;
      const totalCostsPct = (s.laborCostPct || 0) + (s.foodCostPct || 0) + (s.currentExpensesPct || 0);
      const monthlyProfit = monthlyPace > 0 ? monthlyPace * (1 - totalCostsPct / 100) : 0;
      const forecastLabelStyle = 'color:#fff;font-size:18px;font-weight:bold;line-height:1.4;';
      const forecastValueStyle = 'color:#fff;font-size:18px;font-weight:500;line-height:1.4;direction:ltr;';
      const monthlyForecastHtml = `<div style="background:#0F1535;border:2px solid #FFCF00;border-radius:10px;padding:10px 15px;margin-top:15px;direction:rtl;">
        <table style="width:100%;border-collapse:collapse;direction:rtl;" dir="rtl">
          <tr><td style="${forecastLabelStyle}padding:4px 0;">צפי הכנסות חודשי כולל מע"מ:</td><td style="${forecastValueStyle}text-align:left;padding:4px 0;">₪${Math.round(monthlyPace).toLocaleString('he-IL')}</td></tr>
          <tr><td style="${forecastLabelStyle}padding:4px 0;">צפי רווח החודש:</td><td style="${forecastValueStyle}text-align:left;padding:4px 0;">₪${Math.round(monthlyProfit).toLocaleString('he-IL')}</td></tr>
        </table>
      </div>`;

      const fullHtml = `<div style="direction:rtl;font-family:Arial,sans-serif;">${dailyHtml}${goalsHtml}${cumulativeHtml}${additionalInfoHtml}${monthlyForecastHtml}</div>`;

      const businessName = selectedBusinesses.length === 1
        ? businessCards.find(b => b.id === selectedBusinesses[0])?.name || ''
        : '';
      const subject = `סיכום יומי ליום ${dayName} ${dateStr}${businessName ? ' | ' + businessName : ''} - המצפן`;

      const response = await fetch('/api/daily-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'netn114@gmail.com', subject, html: fullHtml }),
      });

      if (response.ok) {
        showToast("הפוש נשלח בהצלחה!", "success");

        // Insert notification for all business users
        try {
          const supabase = createClient();
          const businessId = selectedBusinesses[0];
          if (businessId) {
            const { data: members } = await supabase
              .from("business_members")
              .select("user_id")
              .eq("business_id", businessId)
              .is("deleted_at", null);

            if (members && members.length > 0) {
              const notifications = members.map(m => ({
                user_id: m.user_id,
                business_id: businessId,
                title: `סיכום יומי נשלח - ${dayName} ${dateStr}`,
                message: businessName ? `הפוש היומי נשלח בהצלחה עבור ${businessName}` : 'הפוש היומי נשלח בהצלחה',
                type: 'success',
                is_read: false,
              }));
              await supabase.from("notifications").insert(notifications);

              // Send web push notifications
              const memberUserIds = members.map(m => m.user_id);
              await fetch('/api/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  userIds: memberUserIds,
                  title: `סיכום יומי נשלח - ${dayName} ${dateStr}`,
                  message: businessName ? `הפוש היומי נשלח בהצלחה עבור ${businessName}` : 'הפוש היומי נשלח בהצלחה',
                  url: '/',
                }),
              }).catch(() => {});
            }
          }
        } catch {
          // Notification insert failed silently - email was already sent
        }
      } else {
        showToast("שגיאה בשליחת הפוש", "error");
      }
    } catch {
      showToast("שגיאה בשליחת הפוש", "error");
    } finally {
      setIsSendingPush(false);
    }
  }, [detailedSummary, dateRange, managedProductsSummary, incomeSourcesSummary, selectedBusinesses, businessCards, showToast]);

  // Realtime subscription - refresh data when changes occur
  const handleRealtimeChange = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  // Subscribe to realtime changes on relevant tables
  useMultiTableRealtime(
    ["businesses", "daily_entries", "tasks", "invoices", "payments"],
    handleRealtimeChange,
    true
  );

  // ============================================================================
  // UNIFIED DATA FETCHING - Single optimized fetch for all dashboard data
  // ============================================================================

  // Ref to track if initial auth/business setup is done
  const isInitialSetupDone = useRef(false);
  const lastFetchedBusinessIds = useRef<string[]>([]);

  // Fetch businesses (cards) - runs on mount and when dateRange changes
  useEffect(() => {
    if (!dateRange) return; // Wait for dateRange to be initialized
    const fetchBusinesses = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setIsLoading(false);
        if (selectedBusinesses.length > 0) {
          setSelectedBusinesses([]);
        }
        return;
      }

      // Check if user is admin
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .single();

      const isAdminUser = profile?.is_admin === true;
      setIsAdmin(isAdminUser);

      let businessIds: string[] = [];

      if (isAdminUser) {
        // Fetch all businesses (active + inactive) for admin
        const { data: allBusinesses, error: businessError } = await supabase
          .from("businesses")
          .select("id, name, logo_url, status")
          .is("deleted_at", null);

        if (businessError || !allBusinesses || allBusinesses.length === 0) {
          setIsLoading(false);
          return;
        }

        // Separate active/inactive
        const activeBiz = allBusinesses.filter((b) => b.status === "active");
        const inactiveBiz = allBusinesses.filter((b) => b.status !== "active");
        setInactiveBusinessCards(inactiveBiz.map((b) => ({ id: b.id, name: b.name, logo_url: b.logo_url })));

        // Only load data for active businesses
        businessIds = activeBiz.map((b) => b.id);

        if (businessIds.length === 0) {
          setIsLoading(false);
          return;
        }
      } else {
        const { data: memberships, error: membershipError } = await supabase
          .from("business_members")
          .select("business_id")
          .eq("user_id", user.id)
          .is("deleted_at", null);

        if (membershipError || !memberships || memberships.length === 0) {
          setIsLoading(false);
          return;
        }
        businessIds = memberships.map((m) => m.business_id);

        // Non-admin with single business - auto-select
        if (memberships.length === 1) {
          setIsSingleBusiness(true);
          if (!selectedBusinesses.includes(businessIds[0]) && !isInitialSetupDone.current) {
            isInitialSetupDone.current = true;
            setIsInitialLoad(true); // Show loading skeleton for auto-selected business
            setSelectedBusinesses([businessIds[0]]);
            // Don't return - continue to load the data
          }
        }
      }

      lastFetchedBusinessIds.current = businessIds;
      // Only set realBusinessId here if no business is selected yet
      if (selectedBusinesses.length === 0) {
        setRealBusinessId(businessIds[0]);
      }

      const startDateStr = formatLocalDate(dateRange.start);
      const endDateStr = formatLocalDate(dateRange.end);
      const targetMonth = dateRange.start.getMonth() + 1;
      const targetYear = dateRange.start.getFullYear();

      // PARALLEL QUERIES - All independent queries at once
      const [
        businessesResult,
        entriesResult,
        scheduleResult,
        goalsResult,
        suppliersResult
      ] = await Promise.all([
        supabase
          .from("businesses")
          .select("id, name, logo_url, status, vat_percentage, markup_percentage, manager_monthly_salary")
          .in("id", businessIds)
          .is("deleted_at", null)
          .eq("status", "active"),
        supabase
          .from("daily_entries")
          .select("*")
          .in("business_id", businessIds)
          .gte("entry_date", startDateStr)
          .lte("entry_date", endDateStr)
          .is("deleted_at", null),
        supabase
          .from("business_schedule")
          .select("business_id, day_of_week, day_factor")
          .in("business_id", businessIds),
        supabase
          .from("goals")
          .select("business_id, revenue_target, labor_cost_target_pct, food_cost_target_pct, markup_percentage, vat_percentage")
          .in("business_id", businessIds)
          .eq("year", targetYear)
          .eq("month", targetMonth)
          .is("deleted_at", null),
        supabase
          .from("suppliers")
          .select("id, business_id")
          .in("business_id", businessIds)
          .eq("expense_type", "goods_purchases")
          .eq("is_active", true)
          .is("deleted_at", null)
      ]);

      const { data: businesses, error: businessError } = businessesResult;
      const { data: entries } = entriesResult;
      const { data: scheduleData } = scheduleResult;
      const { data: goalsData } = goalsResult;
      const { data: goodsSuppliersForCards } = suppliersResult;

      if (businessError || !businesses) {
        setIsLoading(false);
        return;
      }

      // Validate selectedBusinesses
      const validBusinessIds = businesses.map(b => b.id);
      const validSelectedBusinesses = selectedBusinesses.filter(id => validBusinessIds.includes(id));
      if (validSelectedBusinesses.length !== selectedBusinesses.length && selectedBusinesses.length > 0) {
        setSelectedBusinesses(validSelectedBusinesses);
      }

      // DEPENDENT QUERY - Invoices
      const goodsSupplierIdsForCards = (goodsSuppliersForCards || []).map(s => s.id);
      const { data: goodsInvoicesForCards } = goodsSupplierIdsForCards.length > 0
        ? await supabase
            .from("invoices")
            .select("supplier_id, business_id, subtotal")
            .in("supplier_id", goodsSupplierIdsForCards)
            .gte("invoice_date", startDateStr)
            .lte("invoice_date", endDateStr)
            .is("deleted_at", null)
        : { data: [] };

      // Calculate business cards data
      const businessCardsData: BusinessCard[] = businesses.map((business) => {
        const businessEntries = entries?.filter((e) => e.business_id === business.id) || [];
        const totalIncome = businessEntries.reduce((sum, e) => sum + (Number(e.total_register) || 0), 0);
        const rawLaborCost = businessEntries.reduce((sum, e) => sum + (Number(e.labor_cost) || 0), 0);

        const businessGoal = goalsData?.find((g: Record<string, unknown>) => g.business_id === business.id);
        const vatPercentage = businessGoal?.vat_percentage != null ? Number(businessGoal.vat_percentage) : (Number(business.vat_percentage) || 0);
        const markupPercentage = businessGoal?.markup_percentage != null ? Number(businessGoal.markup_percentage) : (Number(business.markup_percentage) || 1);
        const managerSalary = Number(business.manager_monthly_salary) || 0;
        const markupMultiplier = markupPercentage;

        const businessSchedule = (scheduleData || []).filter(s => s.business_id === business.id);
        const dayFactorsByDow: Record<number, number> = {};
        businessSchedule.forEach(s => {
          dayFactorsByDow[s.day_of_week] = Number(s.day_factor) || 0;
        });

        const firstDayOfMonth = new Date(targetYear, targetMonth - 1, 1);
        const lastDayOfMonth = new Date(targetYear, targetMonth, 0);
        let expectedWorkDaysInMonth = 0;
        const currentDateCalc = new Date(firstDayOfMonth);
        while (currentDateCalc <= lastDayOfMonth) {
          const dayOfWeek = currentDateCalc.getDay();
          expectedWorkDaysInMonth += dayFactorsByDow[dayOfWeek] || 0;
          currentDateCalc.setDate(currentDateCalc.getDate() + 1);
        }

        const actualWorkDays = businessEntries.reduce((sum, e) => sum + (Number(e.day_factor) || 0), 0);
        const managerDailyCost = expectedWorkDaysInMonth > 0 ? managerSalary / expectedWorkDaysInMonth : 0;
        const managerCostForPeriod = managerDailyCost * actualWorkDays;
        const laborCost = (rawLaborCost + managerCostForPeriod) * markupMultiplier;

        const vatDivisor = vatPercentage > 0 ? 1 + vatPercentage : 1;
        const incomeBeforeVat = totalIncome / vatDivisor;

        const fixedExpenses = laborCost;
        const variableExpenses = 0;
        const daysCount = businessEntries.length || 1;
        const fixedExpensesDiff = fixedExpenses / daysCount;
        const variableExpensesDiff = variableExpenses / daysCount;

        const laborCostPct = incomeBeforeVat > 0 ? (laborCost / incomeBeforeVat) * 100 : 0;

        const businessGoodsInvoices = (goodsInvoicesForCards || []).filter(inv => inv.business_id === business.id);
        const businessFoodCost = businessGoodsInvoices.reduce((sum, inv) => sum + (Number(inv.subtotal) || 0), 0);
        const foodCostPct = incomeBeforeVat > 0 ? (businessFoodCost / incomeBeforeVat) * 100 : 0;

        let targetDiffPct = 0;
        const sumActualDayFactors = actualWorkDays;

        if (sumActualDayFactors > 0 && businessSchedule.length > 0 && businessGoal?.revenue_target) {
          const dailyAverage = totalIncome / sumActualDayFactors;
          const monthlyPace = dailyAverage * expectedWorkDaysInMonth;
          targetDiffPct = ((monthlyPace / businessGoal.revenue_target) - 1) * 100;
        }

        const laborCostTargetPct = Number(businessGoal?.labor_cost_target_pct) || 0;
        const laborCostDiffPct = laborCostPct - laborCostTargetPct;

        const foodCostTargetPct = Number(businessGoal?.food_cost_target_pct) || 0;
        const foodCostDiffPct = foodCostPct - foodCostTargetPct;

        return {
          id: business.id,
          name: business.name,
          logo_url: business.logo_url,
          status: (business.status === "inactive" ? "inactive" : "active") as "active" | "inactive",
          totalIncome,
          fixedExpenses,
          fixedExpensesDiff,
          variableExpenses,
          variableExpensesDiff,
          targetDiffPct,
          laborCostPct,
          laborCostDiffPct,
          foodCostPct,
          foodCostDiffPct,
        };
      });

      // Sort businesses alphabetically by name
      const sortedBusinessCardsData = businessCardsData.sort((a, b) =>
        a.name.localeCompare(b.name, 'he')
      );

      setBusinessCards(sortedBusinessCardsData);
      setIsLoading(false);
    };

    fetchBusinesses();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedBusinesses is intentionally excluded: this effect loads ALL businesses and sets selectedBusinesses inside it; including it would cause an infinite loop. setSelectedBusinesses is stable.
  }, [dateRange, refreshTrigger]);

  // Update realBusinessId when selectedBusinesses changes
  useEffect(() => {
    if (selectedBusinesses.length > 0) {
       
      setRealBusinessId(selectedBusinesses[0]);
    }
  }, [selectedBusinesses]);

  // Fetch detailed summary when businesses are selected
  useEffect(() => {
    if (!dateRange) return; // Wait for dateRange to be initialized
    const fetchDetailedSummary = async () => {
      if (selectedBusinesses.length === 0) {
        setDetailedSummary(null);
        setIncomeSourcesSummary([]);
        setManagedProductsSummary([]);
        setIsLoadingSummary(false);
        return;
      }

      setIsLoadingSummary(true);
      const supabase = createClient();
      const startDateStr = formatLocalDate(dateRange.start);
      const endDateStr = formatLocalDate(dateRange.end);
      const targetMonth = dateRange.start.getMonth() + 1; // 1-12 for database
      const targetYear = dateRange.start.getFullYear();

      // ========================================================================
      // PARALLEL QUERIES BATCH 1 - All independent queries
      // ========================================================================
      const [
        entriesResult,
        scheduleResult,
        businessDataResult,
        goalsResult,
        incomeSourcesResult,
        managedProductsResult,
        goodsSuppliersResult,
        currentExpensesSuppliersResult
      ] = await Promise.all([
        // 1. Fetch daily entries for selected businesses
        supabase
          .from("daily_entries")
          .select("*")
          .in("business_id", selectedBusinesses)
          .gte("entry_date", startDateStr)
          .lte("entry_date", endDateStr)
          .is("deleted_at", null),

        // 2. Fetch business schedule for monthly pace calculation
        supabase
          .from("business_schedule")
          .select("business_id, day_of_week, day_factor")
          .in("business_id", selectedBusinesses),

        // 3. Fetch business data for labor cost calculation
        supabase
          .from("businesses")
          .select("id, markup_percentage, manager_monthly_salary, vat_percentage")
          .in("id", selectedBusinesses),

        // 4. Fetch goals data
        supabase
          .from("goals")
          .select("id, business_id, revenue_target, labor_cost_target_pct, food_cost_target_pct, current_expenses_target, markup_percentage, vat_percentage")
          .in("business_id", selectedBusinesses)
          .eq("year", targetYear)
          .eq("month", targetMonth)
          .is("deleted_at", null),

        // 5. Get ALL income sources for selected businesses
        supabase
          .from("income_sources")
          .select("id, name, income_type")
          .in("business_id", selectedBusinesses)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("display_order"),

        // 6. Get ALL managed products for selected businesses
        supabase
          .from("managed_products")
          .select("id, name, unit, unit_cost, target_pct")
          .in("business_id", selectedBusinesses)
          .eq("is_active", true)
          .is("deleted_at", null),

        // 7. Get suppliers with expense_type = 'goods_purchases'
        supabase
          .from("suppliers")
          .select("id")
          .in("business_id", selectedBusinesses)
          .eq("expense_type", "goods_purchases")
          .eq("is_active", true)
          .is("deleted_at", null),

        // 8. Get suppliers with expense_type = 'current_expenses'
        supabase
          .from("suppliers")
          .select("id")
          .in("business_id", selectedBusinesses)
          .eq("expense_type", "current_expenses")
          .eq("is_active", true)
          .is("deleted_at", null)
      ]);

      // Extract data from results
      const { data: entries } = entriesResult;
      const { data: scheduleData } = scheduleResult;
      const { data: businessData } = businessDataResult;
      const { data: goalsData } = goalsResult;
      const { data: allIncomeSources } = incomeSourcesResult;
      const { data: allManagedProducts } = managedProductsResult;
      const { data: goodsSuppliers } = goodsSuppliersResult;
      const { data: currentExpensesSuppliers } = currentExpensesSuppliersResult;

      // Prepare IDs for dependent queries
      const goalIds = (goalsData || []).map(g => g.id);
      const goodsSupplierIds = (goodsSuppliers || []).map(s => s.id);
      const currentExpensesSupplierIds = (currentExpensesSuppliers || []).map(s => s.id);

      // ========================================================================
      // PARALLEL QUERIES BATCH 2 - Dependent on batch 1 results
      // ========================================================================
      const [
        incomeSourceGoalsResult,
        goodsInvoicesResult,
        currentExpensesInvoicesResult
      ] = await Promise.all([
        // 1. Fetch income source goals (depends on goalIds)
        goalIds.length > 0
          ? supabase
              .from("income_source_goals")
              .select("income_source_id, avg_ticket_target")
              .in("goal_id", goalIds)
          : Promise.resolve({ data: [] }),

        // 2. Get invoices from goods_purchases suppliers (depends on goodsSupplierIds)
        goodsSupplierIds.length > 0
          ? supabase
              .from("invoices")
              .select("subtotal")
              .in("supplier_id", goodsSupplierIds)
              .in("business_id", selectedBusinesses)
              .gte("invoice_date", startDateStr)
              .lte("invoice_date", endDateStr)
              .is("deleted_at", null)
          : Promise.resolve({ data: [] }),

        // 3. Get invoices from current_expenses suppliers (depends on currentExpensesSupplierIds)
        currentExpensesSupplierIds.length > 0
          ? supabase
              .from("invoices")
              .select("subtotal")
              .in("supplier_id", currentExpensesSupplierIds)
              .in("business_id", selectedBusinesses)
              .gte("invoice_date", startDateStr)
              .lte("invoice_date", endDateStr)
              .is("deleted_at", null)
          : Promise.resolve({ data: [] })
      ]);

      const { data: incomeSourceGoalsData } = incomeSourceGoalsResult;
      const { data: goodsInvoices } = goodsInvoicesResult;
      const { data: currentExpensesInvoices } = currentExpensesInvoicesResult;

      // Build a map of income_source_id -> avg_ticket_target
      const avgTicketTargetMap: Record<string, number> = {};
      (incomeSourceGoalsData || []).forEach(g => {
        avgTicketTargetMap[g.income_source_id] = Number(g.avg_ticket_target) || 0;
      });

      // Calculate total goods purchases (food cost)
      const totalGoodsPurchases = (goodsInvoices || []).reduce((sum, inv) => sum + (Number(inv.subtotal) || 0), 0);

      // Calculate total current expenses
      const totalCurrentExpenses = (currentExpensesInvoices || []).reduce((sum, inv) => sum + (Number(inv.subtotal) || 0), 0);

      // Calculate totals from entries (if any)
      const totalIncome = (entries || []).reduce((sum, e) => sum + (Number(e.total_register) || 0), 0);
      const rawLaborCost = (entries || []).reduce((sum, e) => sum + (Number(e.labor_cost) || 0), 0);

      // Calculate labor cost with markup and manager salary
      // Formula: (labor_cost + manager_daily_cost × actual_days) × markup
      // Use monthly goal values with business defaults as fallback
      const totalMarkup = (businessData || []).reduce((sum, b) => {
        const bGoal = (goalsData || []).find((g: Record<string, unknown>) => g.business_id === b.id);
        return sum + (bGoal?.markup_percentage != null ? Number(bGoal.markup_percentage) : (Number(b.markup_percentage) || 1));
      }, 0) / Math.max((businessData || []).length, 1);
      const totalManagerSalary = (businessData || []).reduce((sum, b) => sum + (Number(b.manager_monthly_salary) || 0), 0);

      // Calculate expected work days in the month from schedule
      const targetMonthForSchedule = dateRange.start.getMonth();
      const targetYearForSchedule = dateRange.start.getFullYear();
      const firstDayOfMonthSchedule = new Date(targetYearForSchedule, targetMonthForSchedule, 1);
      const lastDayOfMonthSchedule = new Date(targetYearForSchedule, targetMonthForSchedule + 1, 0);

      // Build day factor map from schedule
      const scheduleDayFactors: Record<number, number[]> = {};
      (scheduleData || []).forEach(s => {
        if (!scheduleDayFactors[s.day_of_week]) {
          scheduleDayFactors[s.day_of_week] = [];
        }
        scheduleDayFactors[s.day_of_week].push(Number(s.day_factor) || 0);
      });

      // Average day factors
      const avgScheduleDayFactors: Record<number, number> = {};
      Object.keys(scheduleDayFactors).forEach(dow => {
        const factors = scheduleDayFactors[Number(dow)];
        avgScheduleDayFactors[Number(dow)] = factors.reduce((a, b) => a + b, 0) / factors.length;
      });

      // Count expected work days
      let expectedWorkDaysInMonth = 0;
      const currentDateSchedule = new Date(firstDayOfMonthSchedule);
      while (currentDateSchedule <= lastDayOfMonthSchedule) {
        const dayOfWeek = currentDateSchedule.getDay();
        expectedWorkDaysInMonth += avgScheduleDayFactors[dayOfWeek] || 0;
        currentDateSchedule.setDate(currentDateSchedule.getDate() + 1);
      }

      // Calculate final labor cost
      const managerDailyCost = expectedWorkDaysInMonth > 0 ? totalManagerSalary / expectedWorkDaysInMonth : 0;
      const actualWorkDays = (entries || []).reduce((sum, e) => sum + (Number(e.day_factor) || 0), 0);

      // Labor cost in ILS: (labor_cost + manager_daily_cost × actual_days) × markup
      const laborCost = (rawLaborCost + (managerDailyCost * actualWorkDays)) * totalMarkup;

      // Get average VAT percentage - use monthly goal values with business defaults as fallback
      const avgVatPercentage = (businessData || []).reduce((sum, b) => {
        const bGoal = (goalsData || []).find((g: Record<string, unknown>) => g.business_id === b.id);
        return sum + (bGoal?.vat_percentage != null ? Number(bGoal.vat_percentage) : (Number(b.vat_percentage) || 0));
      }, 0) / Math.max((businessData || []).length, 1);
      // VAT divisor: 1 + vat, e.g., 1.18 for 18% VAT
      const vatDivisor = avgVatPercentage > 0 ? 1 + avgVatPercentage : 1;
      // Income before VAT
      const incomeBeforeVat = totalIncome / vatDivisor;

      // Labor cost percentage: laborCost ÷ (total_register ÷ vat)
      const laborCostPct = incomeBeforeVat > 0 ? (laborCost / incomeBeforeVat) * 100 : 0;

      // Labor cost target percentage from goals
      const laborCostTargetPct = (goalsData || []).reduce((sum, g) => sum + (Number(g.labor_cost_target_pct) || 0), 0) / Math.max((goalsData || []).length, 1);
      // Labor cost diff: actual - target (positive = over budget, negative = under budget)
      const laborCostDiffPct = laborCostPct - laborCostTargetPct;
      // Labor cost diff in ILS: (laborCostDiffPct × incomeBeforeVat) ÷ 100
      const laborCostDiffAmount = (laborCostDiffPct * incomeBeforeVat) / 100;

      // ========================================================================
      // PARALLEL QUERIES BATCH 3 - Historical data (current, prev month, prev year)
      // ========================================================================
      const entryIds = (entries || []).map(e => e.id);

      // Calculate date ranges for historical comparisons
      const incPrevMonthStart = new Date(dateRange.start);
      incPrevMonthStart.setMonth(incPrevMonthStart.getMonth() - 1);
      const incPrevMonthEnd = new Date(dateRange.end);
      incPrevMonthEnd.setMonth(incPrevMonthEnd.getMonth() - 1);
      const incPrevMonthStartStr = formatLocalDate(incPrevMonthStart);
      const incPrevMonthEndStr = formatLocalDate(incPrevMonthEnd);

      const incPrevYearStart = new Date(dateRange.start);
      incPrevYearStart.setFullYear(incPrevYearStart.getFullYear() - 1);
      const incPrevYearEnd = new Date(dateRange.end);
      incPrevYearEnd.setFullYear(incPrevYearEnd.getFullYear() - 1);
      const incPrevYearStartStr = formatLocalDate(incPrevYearStart);
      const incPrevYearEndStr = formatLocalDate(incPrevYearEnd);

      // Run all three period queries in parallel
      const [
        breakdownResult,
        incPrevMonthEntriesResult,
        incPrevYearEntriesResult
      ] = await Promise.all([
        // Current period breakdown
        entryIds.length > 0
          ? supabase
              .from("daily_income_breakdown")
              .select("daily_entry_id, income_source_id, amount, orders_count")
              .in("daily_entry_id", entryIds)
          : Promise.resolve({ data: [] }),

        // Previous month entries
        supabase
          .from("daily_entries")
          .select("id")
          .in("business_id", selectedBusinesses)
          .gte("entry_date", incPrevMonthStartStr)
          .lte("entry_date", incPrevMonthEndStr)
          .is("deleted_at", null),

        // Previous year entries
        supabase
          .from("daily_entries")
          .select("id")
          .in("business_id", selectedBusinesses)
          .gte("entry_date", incPrevYearStartStr)
          .lte("entry_date", incPrevYearEndStr)
          .is("deleted_at", null)
      ]);

      const { data: breakdownData } = breakdownResult;
      const { data: incPrevMonthEntries } = incPrevMonthEntriesResult;
      const { data: incPrevYearEntries } = incPrevYearEntriesResult;

      const incPrevMonthEntryIds = (incPrevMonthEntries || []).map(e => e.id);
      const incPrevYearEntryIds = (incPrevYearEntries || []).map(e => e.id);

      // Run breakdown queries for historical periods in parallel
      const [
        incPrevMonthBreakdownResult,
        incPrevYearBreakdownResult
      ] = await Promise.all([
        incPrevMonthEntryIds.length > 0
          ? supabase
              .from("daily_income_breakdown")
              .select("income_source_id, amount, orders_count")
              .in("daily_entry_id", incPrevMonthEntryIds)
          : Promise.resolve({ data: [] }),

        incPrevYearEntryIds.length > 0
          ? supabase
              .from("daily_income_breakdown")
              .select("income_source_id, amount, orders_count")
              .in("daily_entry_id", incPrevYearEntryIds)
          : Promise.resolve({ data: [] })
      ]);

      const { data: incPrevMonthBreakdown } = incPrevMonthBreakdownResult;
      const { data: incPrevYearBreakdown } = incPrevYearBreakdownResult;

      // Aggregate previous month data by income source
      const incPrevMonthAggregates: Record<string, { totalAmount: number; ordersCount: number }> = {};
      (incPrevMonthBreakdown || []).forEach(b => {
        if (!incPrevMonthAggregates[b.income_source_id]) {
          incPrevMonthAggregates[b.income_source_id] = { totalAmount: 0, ordersCount: 0 };
        }
        incPrevMonthAggregates[b.income_source_id].totalAmount += Number(b.amount) || 0;
        incPrevMonthAggregates[b.income_source_id].ordersCount += Number(b.orders_count) || 0;
      });

      // Aggregate previous year data by income source
      const incPrevYearAggregates: Record<string, { totalAmount: number; ordersCount: number }> = {};
      (incPrevYearBreakdown || []).forEach(b => {
        if (!incPrevYearAggregates[b.income_source_id]) {
          incPrevYearAggregates[b.income_source_id] = { totalAmount: 0, ordersCount: 0 };
        }
        incPrevYearAggregates[b.income_source_id].totalAmount += Number(b.amount) || 0;
        incPrevYearAggregates[b.income_source_id].ordersCount += Number(b.orders_count) || 0;
      });

      // Calculate private vs business income + build income sources summary
      let privateIncome = 0;
      let privateCount = 0;
      let businessIncome = 0;
      let businessCount = 0;

      // Aggregate by income source
      const incomeSourceAggregates: Record<string, { totalAmount: number; ordersCount: number }> = {};

      (breakdownData || []).forEach(b => {
        const source = (allIncomeSources || []).find(s => s.id === b.income_source_id);
        const amount = Number(b.amount) || 0;
        const orders = Number(b.orders_count) || 0;

        if (source?.income_type === "business") {
          businessIncome += amount;
          businessCount += orders;
        } else {
          privateIncome += amount;
          privateCount += orders;
        }

        // Aggregate by source
        if (!incomeSourceAggregates[b.income_source_id]) {
          incomeSourceAggregates[b.income_source_id] = { totalAmount: 0, ordersCount: 0 };
        }
        incomeSourceAggregates[b.income_source_id].totalAmount += amount;
        incomeSourceAggregates[b.income_source_id].ordersCount += orders;
      });

      // Build income sources summary from ALL sources (not just those with data)
      const incomeSourcesList: IncomeSourceSummary[] = (allIncomeSources || []).map(source => {
        const aggregate = incomeSourceAggregates[source.id] || { totalAmount: 0, ordersCount: 0 };
        const avgAmount = aggregate.ordersCount > 0 ? aggregate.totalAmount / aggregate.ordersCount : 0;
        const avgTicketTarget = avgTicketTargetMap[source.id] || 0;
        const avgTicketDiff = avgAmount - avgTicketTarget; // הפרש: ממוצע בפועל - יעד

        // Previous month average for this income source
        const prevAggregate = incPrevMonthAggregates[source.id] || { totalAmount: 0, ordersCount: 0 };
        const prevMonthAvg = prevAggregate.ordersCount > 0 ? prevAggregate.totalAmount / prevAggregate.ordersCount : 0;
        // אם אין נתונים מחודש קודם, הפרש = 0
        const prevMonthChange = prevAggregate.ordersCount > 0 ? avgAmount - prevMonthAvg : 0;

        // Previous year average for this income source
        const prevYearAggregate = incPrevYearAggregates[source.id] || { totalAmount: 0, ordersCount: 0 };
        const prevYearAvg = prevYearAggregate.ordersCount > 0 ? prevYearAggregate.totalAmount / prevYearAggregate.ordersCount : 0;
        // אם אין נתונים משנה שעברה, הפרש = 0
        const prevYearChange = prevYearAggregate.ordersCount > 0 ? avgAmount - prevYearAvg : 0;

        return {
          id: source.id,
          name: source.name,
          incomeType: source.income_type,
          totalAmount: aggregate.totalAmount,
          ordersCount: aggregate.ordersCount,
          avgAmount,
          avgTicketTarget,
          avgTicketDiff,
          targetDiffAmount: avgTicketDiff * aggregate.ordersCount, // הפרש מהיעד בש"ח: (ממוצע - יעד) × כמות הזמנות
          prevMonthAvg,
          prevMonthChange,
          prevYearAvg,
          prevYearChange,
        };
      });

      setIncomeSourcesSummary(incomeSourcesList);

      // Fetch managed products usage (only if we have entries)
      const { data: productUsageData } = entryIds.length > 0
        ? await supabase
            .from("daily_product_usage")
            .select("product_id, quantity, unit_cost_at_time")
            .in("daily_entry_id", entryIds)
        : { data: [] };

      // Aggregate quantity by product (we'll calculate cost using current unit_cost from managed_products)
      const productQuantities: Record<string, number> = {};

      (productUsageData || []).forEach(p => {
        const quantity = Number(p.quantity) || 0;
        if (!productQuantities[p.product_id]) {
          productQuantities[p.product_id] = 0;
        }
        productQuantities[p.product_id] += quantity;
      });

      // Build managed products summary will be done later after fetching prev month/year data

      const privateAvg = privateCount > 0 ? privateIncome / privateCount : 0;
      const businessAvg = businessCount > 0 ? businessIncome / businessCount : 0;

      // Calculate food cost from invoices of suppliers with expense_type = 'goods_purchases'
      const foodCost = totalGoodsPurchases;
      // Food cost percentage calculated against income before VAT (same as labor cost)
      const avgVatPercentageForFood = (businessData || []).reduce((sum, b) => {
        const bGoal = (goalsData || []).find((g: Record<string, unknown>) => g.business_id === b.id);
        return sum + (bGoal?.vat_percentage != null ? Number(bGoal.vat_percentage) : (Number(b.vat_percentage) || 0));
      }, 0) / Math.max((businessData || []).length, 1);
      const vatDivisorForFood = avgVatPercentageForFood > 0 ? 1 + avgVatPercentageForFood : 1;
      const incomeBeforeVatForFood = totalIncome / vatDivisorForFood;
      const foodCostPct = incomeBeforeVatForFood > 0 ? (foodCost / incomeBeforeVatForFood) * 100 : 0;

      // Food cost target percentage from goals
      const foodCostTargetPct = (goalsData || []).reduce((sum, g) => sum + (Number(g.food_cost_target_pct) || 0), 0) / Math.max((goalsData || []).length, 1);
      // Food cost diff: actual - target (positive = over budget, negative = under budget)
      const foodCostDiffPct = foodCostPct - foodCostTargetPct;

      // Calculate current expenses percentage (same formula as food cost)
      const currentExpenses = totalCurrentExpenses;
      const currentExpensesPct = incomeBeforeVatForFood > 0 ? (currentExpenses / incomeBeforeVatForFood) * 100 : 0;
      // Current expenses target - using current_expenses_target from goals (it's in ILS, need to convert to %)
      const currentExpensesTargetAmount = (goalsData || []).reduce((sum, g) => sum + (Number(g.current_expenses_target) || 0), 0);
      const currentExpensesTargetPct = incomeBeforeVatForFood > 0 ? (currentExpensesTargetAmount / incomeBeforeVatForFood) * 100 : 0;
      // Current expenses diff: actual - target
      const currentExpensesDiffPct = currentExpensesPct - currentExpensesTargetPct;

      // For now, set fixed/variable from labor
      const fixedExpenses = laborCost;
      const variableExpenses = foodCost;
      const totalExpenses = fixedExpenses + variableExpenses;
      const profitLoss = totalIncome - totalExpenses;

      // Calculate monthly pace (קצב חודשי)
      // Formula: (סה"כ קופה / סה"כ day_factor בפועל) × ימי עבודה צפויים בחודש
      let monthlyPace = 0;
      let expectedMonthlyWorkDays = 0;

      // Sum of day_factor from actual entries (actual work days in range)
      const sumActualDayFactors = (entries || []).reduce((sum, e) => sum + (Number(e.day_factor) || 0), 0);

      if (sumActualDayFactors > 0 && scheduleData && scheduleData.length > 0) {
        // Calculate expected work days for the current month based on business_schedule
        // Get the month from the date range (use start date's month)
        const targetMonth = dateRange.start.getMonth();
        const targetYear = dateRange.start.getFullYear();

        // Get first and last day of the month
        const firstDayOfMonth = new Date(targetYear, targetMonth, 1);
        const lastDayOfMonth = new Date(targetYear, targetMonth + 1, 0);

        // Build a map of day_of_week -> day_factor for each business
        // For multiple businesses, we'll average the day factors
        const dayFactorsByDow: Record<number, number[]> = {};
        scheduleData.forEach(s => {
          if (!dayFactorsByDow[s.day_of_week]) {
            dayFactorsByDow[s.day_of_week] = [];
          }
          dayFactorsByDow[s.day_of_week].push(Number(s.day_factor) || 0);
        });

        // Average day factors by day of week
        const avgDayFactorsByDow: Record<number, number> = {};
        Object.keys(dayFactorsByDow).forEach(dow => {
          const factors = dayFactorsByDow[Number(dow)];
          avgDayFactorsByDow[Number(dow)] = factors.reduce((a, b) => a + b, 0) / factors.length;
        });

        // Count expected work days in the month by summing day_factors
        const currentDate = new Date(firstDayOfMonth);
        while (currentDate <= lastDayOfMonth) {
          const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 6 = Saturday
          expectedMonthlyWorkDays += avgDayFactorsByDow[dayOfWeek] || 0;
          currentDate.setDate(currentDate.getDate() + 1);
        }

        // Calculate pace: (total income / actual work days) * expected monthly work days
        const dailyAverage = totalIncome / sumActualDayFactors;
        monthlyPace = dailyAverage * expectedMonthlyWorkDays;
      }

      // Calculate target difference (הפרש מהיעד)
      // Formula: ((צפי חודשי / יעד הכנסות) - 1) × 100
      // Sum revenue targets from all selected businesses for the month
      const revenueTarget = (goalsData || []).reduce((sum, g) => sum + (Number(g.revenue_target) || 0), 0);
      // Revenue target before VAT (using same vatDivisor calculated above)
      const revenueTargetBeforeVat = vatDivisor > 0 ? revenueTarget / vatDivisor : 0;

      // Calculate percentage difference
      let targetDiffPct = 0;
      let targetDiffAmount = 0;
      if (revenueTarget > 0 && expectedMonthlyWorkDays > 0) {
        targetDiffPct = ((monthlyPace / revenueTarget) - 1) * 100;
        // Formula: (קצב - תקציב) / ימי_עבודה_בחודש × ימי_עבודה_בפועל
        const dailyDiff = (monthlyPace - revenueTarget) / expectedMonthlyWorkDays;
        targetDiffAmount = dailyDiff * sumActualDayFactors;
      }

      // ========================================================================
      // PARALLEL QUERIES BATCH 4 - Historical comparison data (entries + invoices)
      // ========================================================================

      // Calculate date ranges
      const prevMonthStart = new Date(dateRange.start);
      prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
      const prevMonthEnd = new Date(dateRange.start);
      prevMonthEnd.setDate(0); // Last day of previous month
      const prevMonthStartStr = formatLocalDate(prevMonthStart);
      const prevMonthEndStr = formatLocalDate(prevMonthEnd);

      const prevYearStart = new Date(dateRange.start);
      prevYearStart.setFullYear(prevYearStart.getFullYear() - 1);
      const prevYearEnd = new Date(dateRange.end);
      prevYearEnd.setFullYear(prevYearEnd.getFullYear() - 1);
      const prevYearStartStr = formatLocalDate(prevYearStart);
      const prevYearEndStr = formatLocalDate(prevYearEnd);

      // Run all historical queries in parallel
      const prevYearMonth = prevYearStart.getMonth() + 1; // 1-12
      const prevYearYear = prevYearStart.getFullYear();

      const [
        prevMonthEntriesResult,
        prevYearEntriesResult,
        prevYearMonthlySummaryResult,
        prevMonthGoodsInvoicesResult,
        prevYearGoodsInvoicesResult,
        prevMonthCurrentExpensesInvoicesResult,
        prevYearCurrentExpensesInvoicesResult
      ] = await Promise.all([
        // Previous month entries
        supabase
          .from("daily_entries")
          .select("id, total_register, labor_cost, day_factor")
          .in("business_id", selectedBusinesses)
          .gte("entry_date", prevMonthStartStr)
          .lte("entry_date", prevMonthEndStr)
          .is("deleted_at", null),

        // Previous year entries
        supabase
          .from("daily_entries")
          .select("id, total_register, labor_cost, day_factor")
          .in("business_id", selectedBusinesses)
          .gte("entry_date", prevYearStartStr)
          .lte("entry_date", prevYearEndStr)
          .is("deleted_at", null),

        // Previous year monthly summaries (fallback for historical data)
        supabase
          .from("monthly_summaries")
          .select("total_income")
          .in("business_id", selectedBusinesses)
          .eq("year", prevYearYear)
          .eq("month", prevYearMonth),

        // Previous month goods invoices
        goodsSupplierIds.length > 0
          ? supabase
              .from("invoices")
              .select("subtotal")
              .in("supplier_id", goodsSupplierIds)
              .in("business_id", selectedBusinesses)
              .gte("invoice_date", prevMonthStartStr)
              .lte("invoice_date", prevMonthEndStr)
              .is("deleted_at", null)
          : Promise.resolve({ data: [] }),

        // Previous year goods invoices
        goodsSupplierIds.length > 0
          ? supabase
              .from("invoices")
              .select("subtotal")
              .in("supplier_id", goodsSupplierIds)
              .in("business_id", selectedBusinesses)
              .gte("invoice_date", prevYearStartStr)
              .lte("invoice_date", prevYearEndStr)
              .is("deleted_at", null)
          : Promise.resolve({ data: [] }),

        // Previous month current expenses invoices
        currentExpensesSupplierIds.length > 0
          ? supabase
              .from("invoices")
              .select("subtotal")
              .in("supplier_id", currentExpensesSupplierIds)
              .in("business_id", selectedBusinesses)
              .gte("invoice_date", prevMonthStartStr)
              .lte("invoice_date", prevMonthEndStr)
              .is("deleted_at", null)
          : Promise.resolve({ data: [] }),

        // Previous year current expenses invoices
        currentExpensesSupplierIds.length > 0
          ? supabase
              .from("invoices")
              .select("subtotal")
              .in("supplier_id", currentExpensesSupplierIds)
              .in("business_id", selectedBusinesses)
              .gte("invoice_date", prevYearStartStr)
              .lte("invoice_date", prevYearEndStr)
              .is("deleted_at", null)
          : Promise.resolve({ data: [] })
      ]);

      const { data: prevMonthEntries } = prevMonthEntriesResult;
      const { data: prevYearEntries } = prevYearEntriesResult;
      const { data: prevYearMonthlySummaries } = prevYearMonthlySummaryResult;
      const { data: prevMonthGoodsInvoices } = prevMonthGoodsInvoicesResult;
      const { data: prevYearGoodsInvoices } = prevYearGoodsInvoicesResult;
      const { data: prevMonthCurrentExpensesInvoices } = prevMonthCurrentExpensesInvoicesResult;
      const { data: prevYearCurrentExpensesInvoices } = prevYearCurrentExpensesInvoicesResult;

      // Calculate previous month metrics
      // Use monthlyPace (forecast) instead of raw totalIncome for fair comparison
      const prevMonthIncome = (prevMonthEntries || []).reduce((sum, e) => sum + (Number(e.total_register) || 0), 0);
      const prevMonthChange = prevMonthIncome > 0 ? monthlyPace - prevMonthIncome : 0;
      const prevMonthChangePct = prevMonthIncome > 0 ? ((monthlyPace / prevMonthIncome) - 1) * 100 : 0;

      const prevMonthRawLaborCost = (prevMonthEntries || []).reduce((sum, e) => sum + (Number(e.labor_cost) || 0), 0);
      const prevMonthActualWorkDays = (prevMonthEntries || []).reduce((sum, e) => sum + (Number(e.day_factor) || 0), 0);
      const prevMonthLaborCost = (prevMonthRawLaborCost + (managerDailyCost * prevMonthActualWorkDays)) * totalMarkup;
      const prevMonthIncomeBeforeVat = prevMonthIncome / vatDivisor;
      const prevMonthLaborCostPct = prevMonthIncomeBeforeVat > 0 ? (prevMonthLaborCost / prevMonthIncomeBeforeVat) * 100 : 0;
      const laborCostPrevMonthChange = prevMonthLaborCostPct > 0 ? laborCostPct - prevMonthLaborCostPct : 0;

      // Calculate previous year metrics
      // Use daily_entries first; fall back to monthly_summaries (historical data) if no entries exist
      let prevYearIncome = (prevYearEntries || []).reduce((sum, e) => sum + (Number(e.total_register) || 0), 0);
      if (prevYearIncome === 0 && (prevYearMonthlySummaries || []).length > 0) {
        prevYearIncome = (prevYearMonthlySummaries || []).reduce((sum, s) => sum + (Number(s.total_income) || 0), 0);
      }
      const prevYearChange = prevYearIncome > 0 ? totalIncome - prevYearIncome : 0;
      const prevYearChangePct = prevYearIncome > 0 ? ((totalIncome / prevYearIncome) - 1) * 100 : 0;

      const prevYearRawLaborCost = (prevYearEntries || []).reduce((sum, e) => sum + (Number(e.labor_cost) || 0), 0);
      const prevYearActualWorkDays = (prevYearEntries || []).reduce((sum, e) => sum + (Number(e.day_factor) || 0), 0);
      const prevYearLaborCost = (prevYearRawLaborCost + (managerDailyCost * prevYearActualWorkDays)) * totalMarkup;
      const prevYearIncomeBeforeVat = prevYearIncome / vatDivisor;
      const prevYearLaborCostPct = prevYearIncomeBeforeVat > 0 ? (prevYearLaborCost / prevYearIncomeBeforeVat) * 100 : 0;
      const laborCostPrevYearChange = prevYearLaborCostPct > 0 ? laborCostPct - prevYearLaborCostPct : 0;

      // Calculate food cost changes
      const prevMonthFoodCost = (prevMonthGoodsInvoices || []).reduce((sum, inv) => sum + (Number(inv.subtotal) || 0), 0);
      const prevMonthFoodCostPct = prevMonthIncomeBeforeVat > 0 ? (prevMonthFoodCost / prevMonthIncomeBeforeVat) * 100 : 0;
      const hasPrevMonthData = prevMonthIncomeBeforeVat > 0 && (prevMonthGoodsInvoices || []).length > 0;
      const foodCostPrevMonthChange = hasPrevMonthData ? foodCostPct - prevMonthFoodCostPct : 0;

      const prevYearFoodCost = (prevYearGoodsInvoices || []).reduce((sum, inv) => sum + (Number(inv.subtotal) || 0), 0);
      const prevYearFoodCostPct = prevYearIncomeBeforeVat > 0 ? (prevYearFoodCost / prevYearIncomeBeforeVat) * 100 : 0;
      const hasPrevYearData = prevYearIncomeBeforeVat > 0 && (prevYearGoodsInvoices || []).length > 0;
      const foodCostPrevYearChange = hasPrevYearData ? foodCostPct - prevYearFoodCostPct : 0;

      // Calculate current expenses changes
      const prevMonthCurrentExpenses = (prevMonthCurrentExpensesInvoices || []).reduce((sum, inv) => sum + (Number(inv.subtotal) || 0), 0);
      const prevMonthCurrentExpensesPct = prevMonthIncomeBeforeVat > 0 ? (prevMonthCurrentExpenses / prevMonthIncomeBeforeVat) * 100 : 0;
      const hasPrevMonthCurrentExpensesData = prevMonthIncomeBeforeVat > 0 && (prevMonthCurrentExpensesInvoices || []).length > 0;
      const currentExpensesPrevMonthChange = hasPrevMonthCurrentExpensesData ? currentExpensesPct - prevMonthCurrentExpensesPct : 0;

      const prevYearCurrentExpenses = (prevYearCurrentExpensesInvoices || []).reduce((sum, inv) => sum + (Number(inv.subtotal) || 0), 0);
      const prevYearCurrentExpensesPct = prevYearIncomeBeforeVat > 0 ? (prevYearCurrentExpenses / prevYearIncomeBeforeVat) * 100 : 0;
      const hasPrevYearCurrentExpensesData = prevYearIncomeBeforeVat > 0 && (prevYearCurrentExpensesInvoices || []).length > 0;
      const currentExpensesPrevYearChange = hasPrevYearCurrentExpensesData ? currentExpensesPct - prevYearCurrentExpensesPct : 0;

      // ========================================================================
      // PARALLEL QUERIES BATCH 5 - Product usage historical data
      // ========================================================================
      const prevMonthEntryIds = (prevMonthEntries || []).map(e => e.id);
      const prevYearEntryIds = (prevYearEntries || []).map(e => e.id);

      const [
        prevMonthProductUsageResult,
        prevYearProductUsageResult
      ] = await Promise.all([
        prevMonthEntryIds.length > 0
          ? supabase
              .from("daily_product_usage")
              .select("product_id, quantity")
              .in("daily_entry_id", prevMonthEntryIds)
          : Promise.resolve({ data: [] }),

        prevYearEntryIds.length > 0
          ? supabase
              .from("daily_product_usage")
              .select("product_id, quantity")
              .in("daily_entry_id", prevYearEntryIds)
          : Promise.resolve({ data: [] })
      ]);

      const { data: prevMonthProductUsage } = prevMonthProductUsageResult;
      const { data: prevYearProductUsage } = prevYearProductUsageResult;

      // Aggregate previous month product quantities
      const prevMonthProductQuantities: Record<string, number> = {};
      (prevMonthProductUsage || []).forEach(p => {
        const quantity = Number(p.quantity) || 0;
        if (!prevMonthProductQuantities[p.product_id]) {
          prevMonthProductQuantities[p.product_id] = 0;
        }
        prevMonthProductQuantities[p.product_id] += quantity;
      });

      // Aggregate previous year product quantities
      const prevYearProductQuantities: Record<string, number> = {};
      (prevYearProductUsage || []).forEach(p => {
        const quantity = Number(p.quantity) || 0;
        if (!prevYearProductQuantities[p.product_id]) {
          prevYearProductQuantities[p.product_id] = 0;
        }
        prevYearProductQuantities[p.product_id] += quantity;
      });

      // Update managed products summary with prev month/year data
      const updatedProductsList: ManagedProductSummary[] = (allManagedProducts || []).map(product => {
        const unitCost = Number(product.unit_cost) || 0;

        // Current period
        const totalQuantity = productQuantities[product.id] || 0;
        const totalCost = unitCost * totalQuantity;
        const currentPct = incomeBeforeVat > 0 ? (totalCost / incomeBeforeVat) * 100 : 0;

        // Previous month
        const prevMonthQuantity = prevMonthProductQuantities[product.id] || 0;
        const prevMonthCost = unitCost * prevMonthQuantity;
        const prevMonthPct = prevMonthIncomeBeforeVat > 0 && prevMonthQuantity > 0 ? (prevMonthCost / prevMonthIncomeBeforeVat) * 100 : null;
        const prevMonthChange = prevMonthPct !== null ? currentPct - prevMonthPct : 0;

        // Previous year
        const prevYearQuantity = prevYearProductQuantities[product.id] || 0;
        const prevYearCost = unitCost * prevYearQuantity;
        const prevYearPct = prevYearIncomeBeforeVat > 0 && prevYearQuantity > 0 ? (prevYearCost / prevYearIncomeBeforeVat) * 100 : null;
        const prevYearChange = prevYearPct !== null ? currentPct - prevYearPct : 0;

        return {
          id: product.id,
          name: product.name,
          unit: product.unit,
          totalQuantity,
          totalCost,
          unitCost,
          targetPct: product.target_pct !== null && product.target_pct !== undefined ? Number(product.target_pct) : null,
          prevMonthPct,
          prevYearPct,
          prevMonthChange,
          prevYearChange,
        };
      });

      setManagedProductsSummary(updatedProductsList);

      // ========================================================================
      // OPTIMIZED HISTORICAL DATA FETCH - Single query for all 6 months
      // Instead of 6 sequential loops, we fetch all data at once
      // ========================================================================
      const monthNames = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

      // Calculate date range for last 6 months
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      const historicalStartDate = new Date(sixMonthsAgo.getFullYear(), sixMonthsAgo.getMonth(), 1);
      const historicalEndDate = new Date(); // Today
      const historicalStartStr = formatLocalDate(historicalStartDate);
      const historicalEndStr = formatLocalDate(historicalEndDate);

      // Fetch ALL historical data in parallel (single batch for 6 months)
      const [
        historicalEntriesResult,
        historicalGoalsResult,
        historicalGoodsInvoicesResult,
        historicalBreakdownResult,
        historicalProductUsageResult
      ] = await Promise.all([
        // All entries for last 6 months
        supabase
          .from("daily_entries")
          .select("id, business_id, entry_date, total_register, labor_cost, day_factor")
          .in("business_id", selectedBusinesses)
          .gte("entry_date", historicalStartStr)
          .lte("entry_date", historicalEndStr)
          .is("deleted_at", null),

        // All goals for last 6 months (multiple months)
        supabase
          .from("goals")
          .select("business_id, year, month, revenue_target, labor_cost_target_pct, food_cost_target_pct, markup_percentage, vat_percentage")
          .in("business_id", selectedBusinesses)
          .gte("year", historicalStartDate.getFullYear())
          .is("deleted_at", null),

        // All goods invoices for last 6 months
        goodsSupplierIds.length > 0
          ? supabase
              .from("invoices")
              .select("supplier_id, business_id, invoice_date, subtotal")
              .in("supplier_id", goodsSupplierIds)
              .in("business_id", selectedBusinesses)
              .gte("invoice_date", historicalStartStr)
              .lte("invoice_date", historicalEndStr)
              .is("deleted_at", null)
          : Promise.resolve({ data: [] }),

        // All income breakdowns (we'll filter by entry IDs after)
        supabase
          .from("daily_income_breakdown")
          .select("daily_entry_id, income_source_id, amount, orders_count"),

        // All product usage for first product (if exists)
        (allManagedProducts || [])[0]
          ? supabase
              .from("daily_product_usage")
              .select("daily_entry_id, product_id, quantity")
              .eq("product_id", (allManagedProducts || [])[0].id)
          : Promise.resolve({ data: [] })
      ]);

      const historicalEntries = historicalEntriesResult.data || [];
      const historicalGoals = historicalGoalsResult.data || [];
      const historicalGoodsInvoices = historicalGoodsInvoicesResult.data || [];
      const allBreakdownData = historicalBreakdownResult.data || [];
      const allProductUsageData = historicalProductUsageResult.data || [];

      // Create entry ID set for filtering breakdowns
      const historicalEntryIds = new Set(historicalEntries.map(e => e.id));
      const relevantBreakdowns = allBreakdownData.filter(b => historicalEntryIds.has(b.daily_entry_id));
      const relevantProductUsage = allProductUsageData.filter(p => historicalEntryIds.has(p.daily_entry_id));

      // Calculate VAT and markup defaults from business data (used as fallback for historical months)
      const defaultVatPct = (businessData || []).reduce((sum, b) => sum + (Number(b.vat_percentage) || 0), 0) / Math.max((businessData || []).length, 1);
      const defaultMarkupHist = (businessData || []).reduce((sum, b) => sum + (Number(b.markup_percentage) || 1), 0) / Math.max((businessData || []).length, 1);
      const totalManagerSalaryHist = (businessData || []).reduce((sum, b) => sum + (Number(b.manager_monthly_salary) || 0), 0);

      // Helper function to get month key (YYYY-MM)
      const getMonthKey = (dateStr: string) => dateStr.substring(0, 7);

      // Group entries by month
      const entriesByMonth: Record<string, typeof historicalEntries> = {};
      historicalEntries.forEach(entry => {
        const monthKey = getMonthKey(entry.entry_date);
        if (!entriesByMonth[monthKey]) entriesByMonth[monthKey] = [];
        entriesByMonth[monthKey].push(entry);
      });

      // Group invoices by month
      const invoicesByMonth: Record<string, typeof historicalGoodsInvoices> = {};
      historicalGoodsInvoices.forEach(inv => {
        const monthKey = getMonthKey(inv.invoice_date);
        if (!invoicesByMonth[monthKey]) invoicesByMonth[monthKey] = [];
        invoicesByMonth[monthKey].push(inv);
      });

      // Group goals by year-month
      const goalsByMonth: Record<string, typeof historicalGoals> = {};
      historicalGoals.forEach(goal => {
        const monthKey = `${goal.year}-${String(goal.month).padStart(2, '0')}`;
        if (!goalsByMonth[monthKey]) goalsByMonth[monthKey] = [];
        goalsByMonth[monthKey].push(goal);
      });

      // Group breakdowns by entry ID for quick lookup
      const breakdownsByEntryId: Record<string, typeof relevantBreakdowns> = {};
      relevantBreakdowns.forEach(b => {
        if (!breakdownsByEntryId[b.daily_entry_id]) breakdownsByEntryId[b.daily_entry_id] = [];
        breakdownsByEntryId[b.daily_entry_id].push(b);
      });

      // Group product usage by entry ID
      const productUsageByEntryId: Record<string, typeof relevantProductUsage> = {};
      relevantProductUsage.forEach(p => {
        if (!productUsageByEntryId[p.daily_entry_id]) productUsageByEntryId[p.daily_entry_id] = [];
        productUsageByEntryId[p.daily_entry_id].push(p);
      });

      // Build chart data for each month
      const chartData: { month: string; [key: string]: number | string }[] = [];
      const foodCostChartDataArr: { month: string; actual: number; target: number }[] = [];
      const laborCostChartDataArr: { month: string; actual: number; target: number }[] = [];
      const managedProductChartDataArr: { month: string; actual: number; target: number }[] = [];
      const trendsChartDataArr: { month: string; salesActual: number; salesTarget: number; laborCostPct: number; foodCostPct: number }[] = [];

      const firstProduct = (allManagedProducts || [])[0];

      // Process each of the last 6 months
      for (let i = 5; i >= 0; i--) {
        const monthDate = new Date();
        monthDate.setMonth(monthDate.getMonth() - i);
        const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
        const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

        // Get data for this month from pre-fetched data
        const monthEntries = entriesByMonth[monthKey] || [];
        const monthInvoices = invoicesByMonth[monthKey] || [];
        const monthGoals = goalsByMonth[monthKey] || [];

        // Calculate per-month VAT and markup from goals (with business defaults as fallback)
        const monthVatPct = monthGoals.length > 0
          ? monthGoals.reduce((sum, g) => sum + (g.vat_percentage != null ? Number(g.vat_percentage) : defaultVatPct), 0) / monthGoals.length
          : defaultVatPct;
        const monthMarkup = monthGoals.length > 0
          ? monthGoals.reduce((sum, g) => sum + (g.markup_percentage != null ? Number(g.markup_percentage) : defaultMarkupHist), 0) / monthGoals.length
          : defaultMarkupHist;
        const monthVatDivisor = monthVatPct > 0 ? 1 + monthVatPct : 1;

        // Calculate metrics
        const monthTotalIncome = monthEntries.reduce((sum, e) => sum + (Number(e.total_register) || 0), 0);
        const monthIncomeBeforeVat = monthTotalIncome / monthVatDivisor;
        const monthRawLaborCost = monthEntries.reduce((sum, e) => sum + (Number(e.labor_cost) || 0), 0);
        const monthActualDayFactors = monthEntries.reduce((sum, e) => sum + (Number(e.day_factor) || 0), 0);

        // Calculate expected work days
        let expectedWorkDaysMonth = 0;
        const currentDateLoop = new Date(monthStart);
        while (currentDateLoop <= monthEnd) {
          const dow = currentDateLoop.getDay();
          const dayFactor = (scheduleData || []).find(s => s.day_of_week === dow)?.day_factor || 0;
          if (dayFactor > 0) expectedWorkDaysMonth += dayFactor;
          currentDateLoop.setDate(currentDateLoop.getDate() + 1);
        }
        if (expectedWorkDaysMonth === 0) expectedWorkDaysMonth = 22;

        const managerDailyCostMonth = totalManagerSalaryHist / expectedWorkDaysMonth;
        const monthLaborCost = (monthRawLaborCost + (managerDailyCostMonth * monthActualDayFactors)) * monthMarkup;
        const monthLaborCostPct = monthIncomeBeforeVat > 0 ? (monthLaborCost / monthIncomeBeforeVat) * 100 : 0;

        const monthFoodCost = monthInvoices.reduce((sum, inv) => sum + (Number(inv.subtotal) || 0), 0);
        const monthFoodCostPct = monthIncomeBeforeVat > 0 ? (monthFoodCost / monthIncomeBeforeVat) * 100 : 0;

        // Goals for this month
        const avgLaborTargetPct = monthGoals.length > 0
          ? monthGoals.reduce((sum, g) => sum + (Number(g.labor_cost_target_pct) || 0), 0) / monthGoals.length
          : 0;
        const avgFoodTargetPct = monthGoals.length > 0
          ? monthGoals.reduce((sum, g) => sum + (Number(g.food_cost_target_pct) || 0), 0) / monthGoals.length
          : 0;
        const totalRevenueTarget = monthGoals.reduce((sum, g) => sum + (Number(g.revenue_target) || 0), 0);

        // Food cost target in ILS
        const monthFoodTargetILS = (avgFoodTargetPct / 100) * monthIncomeBeforeVat;

        // 1. Order average chart data
        const dataPoint: { month: string; [key: string]: number | string } = {
          month: monthNames[monthDate.getMonth()],
        };

        // Aggregate breakdowns by income source for this month's entries
        const monthEntryIds = new Set(monthEntries.map(e => e.id));
        const monthBreakdowns = relevantBreakdowns.filter(b => monthEntryIds.has(b.daily_entry_id));
        const monthAggregates: Record<string, { totalAmount: number; ordersCount: number }> = {};
        monthBreakdowns.forEach(b => {
          if (!monthAggregates[b.income_source_id]) {
            monthAggregates[b.income_source_id] = { totalAmount: 0, ordersCount: 0 };
          }
          monthAggregates[b.income_source_id].totalAmount += Number(b.amount) || 0;
          monthAggregates[b.income_source_id].ordersCount += Number(b.orders_count) || 0;
        });

        (allIncomeSources || []).forEach(source => {
          const agg = monthAggregates[source.id];
          const avg = agg && agg.ordersCount > 0 ? agg.totalAmount / agg.ordersCount : 0;
          dataPoint[source.name] = Math.round(avg * 100) / 100;
        });
        chartData.push(dataPoint);

        // 2. Food cost chart
        foodCostChartDataArr.push({
          month: monthNames[monthDate.getMonth()],
          actual: Math.round(monthFoodCost),
          target: Math.round(monthFoodTargetILS),
        });

        // 3. Labor cost chart
        laborCostChartDataArr.push({
          month: monthNames[monthDate.getMonth()],
          actual: Math.round(monthLaborCostPct * 10) / 10,
          target: Math.round(avgLaborTargetPct * 10) / 10,
        });

        // 4. Managed product chart
        if (firstProduct) {
          const monthProductUsage = relevantProductUsage.filter(p => monthEntryIds.has(p.daily_entry_id));
          const monthQuantity = monthProductUsage.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);
          const unitCost = Number(firstProduct.unit_cost) || 0;
          const monthActualCost = unitCost * monthQuantity;
          const targetPct = Number(firstProduct.target_pct) || 0;
          const monthTargetCost = (targetPct / 100) * monthIncomeBeforeVat;

          managedProductChartDataArr.push({
            month: monthNames[monthDate.getMonth()],
            actual: Math.round(monthActualCost),
            target: Math.round(monthTargetCost),
          });
        }

        // 5. Trends chart
        trendsChartDataArr.push({
          month: monthNames[monthDate.getMonth()],
          salesActual: Math.round(monthTotalIncome),
          salesTarget: Math.round(totalRevenueTarget),
          laborCostPct: Math.round(monthLaborCostPct * 10) / 10,
          foodCostPct: Math.round(monthFoodCostPct * 10) / 10,
        });
      }

      // Set all chart data at once
      setOrderAvgChartData(chartData);
      setFoodCostChartData(foodCostChartDataArr);
      setLaborCostChartData(laborCostChartDataArr);
      setManagedProductChartData(managedProductChartDataArr);
      setTrendsChartData(trendsChartDataArr);

      setDetailedSummary({
        totalIncome,
        incomeBeforeVat,
        totalExpenses,
        fixedExpenses,
        variableExpenses,
        laborCost,
        laborCostPct,
        laborCostTargetPct,
        laborCostDiffPct,
        laborCostDiffAmount,
        laborCostPrevMonthChange,
        laborCostPrevYearChange,
        foodCost,
        foodCostPct,
        foodCostTargetPct,
        foodCostDiffPct,
        foodCostPrevMonthPct: prevMonthFoodCostPct,
        foodCostPrevMonthChange,
        foodCostPrevYearPct: prevYearFoodCostPct,
        foodCostPrevYearChange,
        currentExpenses,
        currentExpensesPct,
        currentExpensesTargetPct,
        currentExpensesDiffPct,
        currentExpensesPrevMonthChange,
        currentExpensesPrevYearChange,
        privateIncome,
        privateCount,
        privateAvg,
        businessIncome,
        businessCount,
        businessAvg,
        profitLoss,
        monthlyPace,
        revenueTarget,
        revenueTargetBeforeVat,
        targetDiffPct,
        targetDiffAmount,
        prevMonthIncome,
        prevMonthChange,
        prevMonthChangePct,
        prevYearIncome,
        prevYearChange,
        prevYearChangePct,
      });

      // Turn off loading states after data is loaded
      setIsInitialLoad(false);
      setIsLoadingSummary(false);
    };

    fetchDetailedSummary();
  }, [selectedBusinesses, dateRange, refreshTrigger]);

  // Fetch tasks when businesses are selected
  useEffect(() => {
    const fetchTasks = async () => {
      if (selectedBusinesses.length === 0) {
        setTasks([]);
        return;
      }

      setIsLoadingTasks(true);
      const supabase = createClient();

      // Fetch tasks for selected businesses
      const { data: tasksData, error } = await supabase
        .from("tasks")
        .select(`
          id,
          business_id,
          assignee_id,
          title,
          description,
          category,
          status,
          priority,
          due_date,
          completed_at,
          created_by,
          created_at
        `)
        .in("business_id", selectedBusinesses)
        .is("deleted_at", null)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(10);

      if (error) {
        console.error("Error fetching tasks:", error);
        setIsLoadingTasks(false);
        return;
      }

      // Fetch assignee names
      const assigneeIds = [...new Set((tasksData || []).map(t => t.assignee_id).filter(Boolean))];
      const assigneeNames: Record<string, string> = {};

      if (assigneeIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", assigneeIds);

        (profiles || []).forEach(p => {
          assigneeNames[p.id] = p.full_name || p.email?.split("@")[0] || "לא ידוע";
        });
      }

      // Convert to display format
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const taskDisplays: TaskDisplay[] = (tasksData || []).map((task, index) => {
        const dueDate = task.due_date ? new Date(task.due_date) : null;
        const isOverdue = dueDate ? dueDate < today && task.status !== "completed" : false;

        // Map status to Hebrew
        const statusMap: Record<string, string> = {
          pending: "לביצוע",
          in_progress: "בתהליך",
          completed: "בוצע",
          cancelled: "בוטל",
        };

        return {
          id: task.id,
          number: String(index + 1).padStart(2, "0"),
          assignee: task.assignee_id ? (assigneeNames[task.assignee_id] || "לא ידוע") : "לא שויך",
          category: task.category || "כללי",
          dueDate: dueDate
            ? dueDate.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" })
            : "--",
          description: task.description || task.title,
          status: statusMap[task.status] || "לביצוע",
          isOverdue,
        };
      });

      setTasks(taskDisplays);
      setIsLoadingTasks(false);
    };

    fetchTasks();
  }, [selectedBusinesses, refreshTrigger]);

  // Check if any valid business is selected (for showing expanded section)
  // Only show expanded section if selectedBusinesses exist AND match actual loaded businesses
  const hasSelectedBusinesses = selectedBusinesses.length > 0 &&
    businessCards.length > 0 &&
    selectedBusinesses.some(id => businessCards.some(card => card.id === id));

  const toggleCard = (id: string) => {
    // Set initial load to show skeleton when selecting a new business
    setIsInitialLoad(true);
    toggleBusiness(id);
  };

  return (
    <div className="px-2.5 pt-4 pb-8 lg:px-3 xl:px-4">
      {/* לקוחות Section - Hidden for non-admin users with single business */}
      {!isSingleBusiness && (
      <div className="clients-section rounded-[20px] py-1 lg:p-2 xl:p-3">
        {/* Section Header */}
        <div className="flex justify-between items-center mb-4">
          {/* Right side - Search Icon and Title together */}
          <div className="flex items-center gap-[5px]">
            {isSearchOpen ? (
              /* Search Input - Responsive */
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Button
                  type="button"
                  aria-label="סגור חיפוש"
                  title="סגור חיפוש"
                  onClick={() => { setIsSearchOpen(false); setSearchQuery(""); }}
                  className="w-[40px] h-[40px] sm:w-[30px] sm:h-[30px] flex-shrink-0 flex items-center justify-center text-[#4C526B] hover:text-[#7B91B0] transition-colors cursor-pointer touch-manipulation"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="sm:w-5 sm:h-5">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </Button>
                <Input
                  type="text"
                  placeholder="חיפוש עסק, שם לקוח..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border border-[#4C526B] rounded-[7px] px-3 py-2 sm:py-1 text-white text-[15px] sm:text-[14px] placeholder:text-[#7B91B0] focus:outline-none focus:border-[#7B91B0] flex-1 min-w-0 max-w-[200px] min-h-[44px] sm:min-h-0"
                  autoFocus
                />
              </div>
            ) : (
              /* Search Icon and Title */
              <>
                <Button
                  type="button"
                  aria-label="חיפוש"
                  title="חיפוש"
                  onClick={() => setIsSearchOpen(true)}
                  className="w-[40px] h-[40px] sm:w-[30px] sm:h-[30px] flex-shrink-0 flex items-center justify-center text-[#4C526B] hover:text-[#7B91B0] transition-colors cursor-pointer touch-manipulation"
                >
                  <svg width="26" height="26" viewBox="0 0 32 32" fill="none" className="sm:w-6 sm:h-6">
                    <circle cx="14" cy="14" r="8" stroke="currentColor" strokeWidth="2"/>
                    <path d="M20 20L26 26" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </Button>
                <h2 className="text-[18px] sm:text-lg font-semibold text-white">לקוחות</h2>
              </>
            )}
          </div>
          {/* Left side - Date picker - hide when search is open */}
          {!isSearchOpen && dateRange && <DateRangePicker dateRange={dateRange} onChange={handleDateRangeChange} />}
        </div>

        {/* Cards Grid - Responsive: 2 cols mobile, 3 tablet, 4-6 desktop */}
        <div id="onboarding-business-cards" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-[15px]">
          {isLoading ? (
            // Skeleton loaders - 6 cards with static structure, only data placeholders animate
            <>
              {[...Array(6)].map((_, i) => (
                <div
                  key={`skeleton-${i}`}
                  className="business-card rounded-[10px] p-[7px] flex flex-col items-center justify-center gap-[5px] min-h-[210px] max-h-[210px]"
                >
                  {/* Static Image placeholder */}
                  <div className="w-[50px] h-[50px] rounded-[10px] overflow-hidden flex-shrink-0 flex items-center justify-center bg-white/10">
                    <div className="w-[30px] h-[30px] rounded-[6px] bg-white/20 animate-pulse" />
                  </div>

                  {/* Skeleton Name - only the text animates */}
                  <div className="h-[28px] w-[80%] rounded-[6px] bg-white/10 animate-pulse" />

                  {/* Skeleton Total - only the number animates */}
                  <div className="h-[32px] w-[70%] rounded-[6px] bg-white/10 animate-pulse" />

                  {/* Static label with skeleton value */}
                  <div className="flex items-center justify-center gap-[5px] w-full" dir="rtl">
                    <span className="text-white/50 text-[14px] font-bold">הפרש מהיעד:</span>
                    <div className="h-[16px] w-[50px] rounded-[4px] bg-white/10 animate-pulse" />
                  </div>

                  {/* Static label with skeleton value */}
                  <div className="flex items-center justify-center gap-[5px] w-full" dir="rtl">
                    <span className="text-white/50 text-[12px] font-bold">עלות עובדים</span>
                    <div className="h-[14px] w-[40px] rounded-[4px] bg-white/10 animate-pulse" />
                  </div>

                  {/* Static label with skeleton value */}
                  <div className="flex items-center justify-center gap-[5px] w-full" dir="rtl">
                    <span className="text-white/50 text-[12px] font-bold">עלות מכר</span>
                    <div className="h-[14px] w-[40px] rounded-[4px] bg-white/10 animate-pulse" />
                  </div>
                </div>
              ))}
            </>
          ) : businessCards.length === 0 ? (
            <div className="col-span-full text-center py-10">
              <p className="text-white/70 text-[16px]">לא נמצאו עסקים</p>
              <p className="text-white/50 text-[14px] mt-2">צור עסק חדש דרך התפריט</p>
            </div>
          ) : (
            businessCards
              .filter(card => {
                if (!searchQuery.trim()) return true;
                const query = searchQuery.toLowerCase();
                return card.name.toLowerCase().includes(query);
              })
              .slice(0, showAllBusinessCards ? businessCards.length : 12)
              .map((card) => (
              <Button
                key={card.id}
                type="button"
                onClick={() => toggleCard(card.id)}
                className={`business-card rounded-[10px] p-[7px] flex flex-col items-center justify-center gap-[5px] min-h-[210px] max-h-[210px] transition-all cursor-pointer overflow-hidden ${
                  selectedBusinesses.includes(card.id) ? "business-card-expanded" : ""
                }`}
              >
                {/* Business Image */}
                <div className="w-[50px] h-[50px] rounded-[10px] overflow-hidden flex-shrink-0 flex items-center justify-center bg-white/10">
                  {card.logo_url ? (
                    <Image
                      src={card.logo_url}
                      alt={card.name}
                      className="w-full h-full object-cover"
                      width={50}
                      height={50}
                      unoptimized
                    />
                  ) : (
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
                      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round"/>
                      <polyline points="9,22 9,12 15,12 15,22" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>

                {/* Business Name */}
                <p className="text-white text-[20px] font-bold leading-[1.4] text-center">
                  {card.name}
                </p>

                {/* Show data only if there's income */}
                {card.totalIncome > 0 && (
                  <>
                    {/* Total Income */}
                    <p className="text-white text-[24px] font-bold leading-[1.4] text-center ltr-num">
                      {formatCurrency(card.totalIncome)}
                    </p>

                    {/* הפרש מהיעד Row */}
                    <div className="flex items-center justify-center gap-[5px] w-full" dir="rtl">
                      <span className={`text-[14px] font-bold ${card.targetDiffPct === 0 ? 'text-white' : card.targetDiffPct < 0 ? 'text-red-500' : 'text-green-500'}`}>
                        הפרש מהיעד:
                      </span>
                      <span className={`text-[14px] font-bold ltr-num ${card.targetDiffPct === 0 ? 'text-white' : card.targetDiffPct < 0 ? 'text-red-500' : 'text-green-500'}`}>
                        {formatPercent(card.targetDiffPct)}
                      </span>
                    </div>

                    {/* עלות עובדים Row - color based on laborCostDiffPct like detailedSummary */}
                    <div className="flex items-center justify-center gap-[5px] w-full" dir="rtl">
                      <span className="text-white text-[12px] font-bold">
                        עלות עובדים
                      </span>
                      <span className={`text-[12px] font-bold ltr-num ${card.laborCostDiffPct === 0 ? 'text-white' : card.laborCostDiffPct > 0 ? 'text-red-500' : 'text-green-500'}`}>
                        {formatPercent(card.laborCostPct)}
                      </span>
                    </div>

                    {/* עלות מכר Row */}
                    <div className="flex items-center justify-center gap-[5px] w-full" dir="rtl">
                      <span className="text-white text-[12px] font-bold">
                        עלות מכר
                      </span>
                      <span className={`text-[12px] font-bold ltr-num ${card.foodCostDiffPct > 0 ? 'text-red-500' : card.foodCostDiffPct < 0 ? 'text-green-500' : 'text-white'}`}>
                        {formatPercent(card.foodCostPct)}
                      </span>
                    </div>
                  </>
                )}
              </Button>
            ))
          )}
        </div>

        {/* More button - only show if there are more than 6 businesses and not showing all */}
        {businessCards.length > 12 && !showAllBusinessCards && (
          <div className="w-full flex justify-center mt-6">
            <Button
              type="button"
              onClick={() => setShowAllBusinessCards(true)}
              className="text-white text-xl font-semibold hover:text-white/80 transition-colors"
            >
              עוד...
            </Button>
          </div>
        )}

        {/* Inactive Businesses - Collapsed Section (Admin only) */}
        {isAdmin && inactiveBusinessCards.length > 0 && (
          <div className="mt-6">
            <Button
              type="button"
              onClick={() => setShowInactiveBusinesses(!showInactiveBusinesses)}
              className="flex items-center gap-[8px] text-[#F64E60]/70 hover:text-[#F64E60] transition-colors w-full"
            >
              <div className="flex-1 h-[1px] bg-[#F64E60]/20" />
              <span className="text-[13px] font-bold whitespace-nowrap flex items-center gap-[5px]">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  className={`transition-transform duration-200 ${showInactiveBusinesses ? "rotate-180" : ""}`}
                >
                  <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                לקוחות לא פעילים ({inactiveBusinessCards.length})
              </span>
              <div className="flex-1 h-[1px] bg-[#F64E60]/20" />
            </Button>

            {showInactiveBusinesses && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-[15px] mt-4">
                {inactiveBusinessCards.map((business) => (
                  <div
                    key={business.id}
                    className="business-card rounded-[10px] p-[7px] flex flex-col items-center justify-center gap-[5px] min-h-[120px] max-h-[120px] opacity-50 cursor-default"
                  >
                    <div className="w-[40px] h-[40px] rounded-[8px] overflow-hidden flex-shrink-0 flex items-center justify-center bg-white/10">
                      {business.logo_url ? (
                        <Image
                          src={business.logo_url}
                          alt={business.name}
                          width={40}
                          height={40}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white/30">
                          <path d="M19 21V5C19 3.89543 18.1046 3 17 3H7C5.89543 3 5 3.89543 5 5V21M19 21H5M19 21H21M5 21H3M9 7H10M9 11H10M14 7H15M14 11H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <h3 className="text-[14px] font-bold text-white/60 text-center truncate w-full">{business.name}</h3>
                    <span className="text-[11px] px-[8px] py-[2px] rounded-full bg-[#F64E60]/20 text-[#F64E60]">לא פעיל</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Expanded Section - Available for all users with selected business */}
      {hasSelectedBusinesses && (
        <div className="expanded-section mt-2 space-y-1">
          {/* Action Buttons */}
            <div id="onboarding-daily-entry" className="flex flex-row justify-between items-center gap-[5px] lg:gap-[15px]">
              <div className="flex flex-row items-center gap-[5px]">
                {realBusinessId ? (
                  <DailyEntryForm
                    businessId={realBusinessId}
                    businessName={businessCards.find(b => b.id === realBusinessId)?.name || ""}
                    onSuccess={() => {
                      setRefreshTrigger(prev => prev + 1);
                    }}
                  />
                ) : (
                  <Button
                    type="button"
                    className="action-btn-primary text-white text-center font-bold text-sm leading-none rounded-[7px] py-[7px] px-[10px] min-h-[40px] cursor-pointer opacity-50"
                    disabled
                  >
                    הזנת נתונים
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={() => setIsDailyEntriesModalOpen(true)}
                  className="action-btn-primary text-white text-center font-bold text-sm leading-none rounded-[7px] py-[7px] px-[10px] min-h-[40px] cursor-pointer"
                >
                  הצגת/עריכת נתונים
                </Button>
                {isAdmin && (
                  <Button
                    type="button"
                    onClick={handleDailyPush}
                    disabled={isSendingPush}
                    className={`action-btn-primary text-white text-center font-bold text-sm leading-none rounded-[7px] py-[7px] px-[10px] min-h-[40px] cursor-pointer ${isSendingPush ? 'opacity-50' : ''}`}
                  >
                    {isSendingPush ? 'שולח...' : 'שליחת פוש יומי'}
                  </Button>
                )}
              </div>
              {/* Date picker for single business users */}
              {isSingleBusiness && dateRange && (
                <DateRangePicker dateRange={dateRange} onChange={handleDateRangeChange} />
              )}
            </div>

            {/* Data Cards - New Design - Grid on desktop */}
            <div id="onboarding-data-cards" className="flex flex-col lg:grid lg:grid-cols-2 xl:grid-cols-3 gap-[15px] w-full mt-[15px]">
              {(isInitialLoad || isLoadingSummary) && selectedBusinesses.length > 0 ? (
                // Skeleton loaders for data cards - shown during loading
                <>
                  {[...Array(7)].map((_, i) => (
                    <div
                      key={`data-skeleton-${i}`}
                      className="data-card-new flex flex-col justify-center gap-[10px] rounded-[10px] p-0 min-h-[155px] w-full"
                    >
                      <div className="flex flex-row-reverse justify-between items-center w-full">
                        <div className="h-[28px] w-[100px] rounded-[6px] bg-white/10 animate-pulse ml-[9px]" />
                        <div className="flex flex-row-reverse items-center gap-[6px] mr-[9px]">
                          <div className="h-[28px] w-[120px] rounded-[6px] bg-white/10 animate-pulse" />
                          <div className="w-[31px] h-[31px] rounded-full bg-white/10 animate-pulse" />
                        </div>
                      </div>
                      <div className="flex flex-row-reverse justify-center items-center gap-[10px]">
                        <div className="h-[28px] w-[80px] rounded-[6px] bg-white/10 animate-pulse" />
                        <div className="h-[28px] w-[100px] rounded-[6px] bg-white/10 animate-pulse" />
                      </div>
                      <div className="flex flex-row-reverse justify-between items-start gap-[10px] mt-[5px]">
                        <div className="flex flex-col gap-[5px] ml-[10px]">
                          <div className="flex flex-row-reverse items-center gap-[5px]">
                            <div className="h-[16px] w-[50px] rounded-[4px] bg-white/10 animate-pulse" />
                            <span className="text-[14px] font-medium text-white/50">הפרש מהיעד</span>
                          </div>
                          <div className="flex flex-row-reverse items-center gap-[5px]">
                            <div className="h-[16px] w-[60px] rounded-[4px] bg-white/10 animate-pulse" />
                            <span className="text-[14px] font-medium text-white/50">הפרש מהיעד</span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-[5px] mr-[10px]">
                          <div className="flex flex-row-reverse items-center gap-[5px]">
                            <div className="h-[16px] w-[50px] rounded-[4px] bg-white/10 animate-pulse" />
                            <span className="text-[14px] font-medium text-white/50">שינוי מחודש קודם</span>
                          </div>
                          <div className="flex flex-row-reverse items-center gap-[5px]">
                            <div className="h-[16px] w-[40px] rounded-[4px] bg-white/10 animate-pulse" />
                            <span className="text-[14px] font-medium text-white/50">שינוי משנה שעברה</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <>
              {/* סה"כ הכנסות Card */}
              <div className="data-card-new flex flex-col justify-center gap-[10px] rounded-[10px] p-0 min-h-[155px] w-full cursor-pointer hover:brightness-110 transition-all" onClick={() => openHistoryModal('totalIncome', 'סה"כ מכירות')}>
                <div className="flex flex-row-reverse justify-between items-center w-full">
                  <span className={`text-[20px] font-bold leading-[1.4] ltr-num ml-[9px] ${(detailedSummary?.totalIncome || 0) === 0 ? 'text-white' : (detailedSummary?.targetDiffPct || 0) < 0 ? 'text-red-500' : (detailedSummary?.targetDiffPct || 0) > 0 ? 'text-green-500' : 'text-white'}`}>
                    {formatCurrencyFull(detailedSummary?.totalIncome || 0)}
                  </span>
                  <div className="flex flex-row-reverse items-center gap-[6px] mr-[9px]">
                    <span className="text-[20px] font-bold text-white leading-[1.4]">סה״כ הכנסות</span>
                    <div className="icon-bg-pink w-[31px] h-[31px] rounded-full flex items-center justify-center p-[3px]">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M18 9l-5 5-4-4-3 3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                </div>
                {(() => {
                  const currentBusinessName = businessCards.find(b => b.id === realBusinessId)?.name || "";
                  const isPearla = currentBusinessName.includes("פרלה");
                  if (isPearla) {
                    return (
                      <>
                        <div className="flex flex-row-reverse justify-center items-center gap-[10px] ml-[25px] invisible">
                          <span className={`text-[20px] font-bold leading-[1.4] ltr-num text-white`}>
                            {formatCurrencyFull(Math.round(detailedSummary?.monthlyPace || 0))}
                          </span>
                          <span className="text-[20px] font-bold text-white leading-[1.4]">צפי חודשי</span>
                        </div>
                        <div className="flex flex-row-reverse justify-between items-start gap-[10px] mt-[5px]">
                          <div className="flex flex-col ml-[10px]">
                            <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                              <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">{(detailedSummary?.privateCount || 0) + (detailedSummary?.businessCount || 0)}</span>
                              <span className="text-[14px] font-medium text-white leading-[1.4]">כמות אירועים</span>
                            </div>
                            <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                              <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">{formatCurrencyFull(((detailedSummary?.privateCount || 0) + (detailedSummary?.businessCount || 0)) > 0 ? (detailedSummary?.totalIncome || 0) / ((detailedSummary?.privateCount || 0) + (detailedSummary?.businessCount || 0)) : 0)}</span>
                              <span className="text-[14px] font-medium text-white leading-[1.4]">ממוצע לאירוע</span>
                            </div>
                          </div>
                          <div className="flex flex-col mr-[10px] invisible">
                            <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                              <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">{formatPercent(detailedSummary?.prevMonthChangePct || 0)}</span>
                              <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי מחודש קודם</span>
                            </div>
                            <div className="flex flex-row-reverse justify-end items-center gap-[5px]">
                              <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">{formatPercent(detailedSummary?.prevYearChangePct || 0)}</span>
                              <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי משנה שעברה</span>
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  }
                  return (
                    <>
                      <div className="flex flex-row-reverse justify-center items-center gap-[10px] ml-[25px]">
                        <span className={`text-[20px] font-bold leading-[1.4] ltr-num ${(detailedSummary?.monthlyPace || 0) === 0 ? 'text-white' : (detailedSummary?.targetDiffPct || 0) < 0 ? 'text-red-500' : (detailedSummary?.targetDiffPct || 0) > 0 ? 'text-green-500' : 'text-white'}`}>
                          {formatCurrencyFull(Math.round(detailedSummary?.monthlyPace || 0))}
                        </span>
                        <span className="text-[20px] font-bold text-white leading-[1.4]">צפי חודשי</span>
                      </div>
                      <div className="flex flex-row-reverse justify-between items-start gap-[10px] mt-[5px]">
                        <div className="flex flex-col ml-[10px]">
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${(detailedSummary?.totalIncome || 0) === 0 ? 'text-white' : (detailedSummary?.targetDiffPct || 0) < 0 ? 'text-red-500' : (detailedSummary?.targetDiffPct || 0) > 0 ? 'text-green-500' : 'text-white'}`}>{formatPercent((detailedSummary?.totalIncome || 0) === 0 ? 0 : (detailedSummary?.targetDiffPct || 0))}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מהיעד</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${(detailedSummary?.totalIncome || 0) === 0 ? 'text-white' : (detailedSummary?.targetDiffAmount || 0) < 0 ? 'text-red-500' : (detailedSummary?.targetDiffAmount || 0) > 0 ? 'text-green-500' : 'text-white'}`}>{formatCurrencyFull((detailedSummary?.totalIncome || 0) === 0 ? 0 : (detailedSummary?.targetDiffAmount || 0))}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מהיעד</span>
                          </div>
                        </div>
                        <div className="flex flex-col mr-[10px]">
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${(detailedSummary?.totalIncome || 0) === 0 ? 'text-white' : (detailedSummary?.prevMonthChangePct || 0) < 0 ? 'text-red-500' : (detailedSummary?.prevMonthChangePct || 0) > 0 ? 'text-green-500' : 'text-white'}`}>{formatPercent((detailedSummary?.totalIncome || 0) === 0 ? 0 : (detailedSummary?.prevMonthChangePct || 0))}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי מחודש קודם</span>
                          </div>
                          <div className="flex flex-row-reverse justify-end items-center gap-[5px]">
                            <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${(detailedSummary?.totalIncome || 0) === 0 ? 'text-white' : (detailedSummary?.prevYearChangePct || 0) < 0 ? 'text-red-500' : (detailedSummary?.prevYearChangePct || 0) > 0 ? 'text-green-500' : 'text-white'}`}>{formatPercent((detailedSummary?.totalIncome || 0) === 0 ? 0 : (detailedSummary?.prevYearChangePct || 0))}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי משנה שעברה</span>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Dynamic Income Sources Cards */}
              {incomeSourcesSummary.map((source, index) => {
                // Alternate colors for icons
                const iconBgColors = ["icon-bg-peach", "icon-bg-green", "icon-bg-blue", "icon-bg-cyan"];
                const iconBgClass = iconBgColors[index % iconBgColors.length];
                const currentBusinessName = businessCards.find(b => b.id === realBusinessId)?.name || "";
                const isPearla = currentBusinessName.includes("פרלה");

                // Pearla business: Income source 1 (מנות) - same layout, hide avgAmount/diff, show only totalAmount + quantity
                if (isPearla && index === 0) {
                  return (
                    <div key={source.id} className="data-card-new flex flex-col justify-center gap-[10px] rounded-[10px] p-0 min-h-[155px] w-full cursor-pointer hover:brightness-110 transition-all" onClick={() => openHistoryModal('incomeSource', source.name, source.id)}>
                      <div className="flex flex-row-reverse justify-between items-center w-full">
                        <div className="flex flex-row-reverse items-center gap-[10px] ml-[9px]">
                          <div className="flex flex-col min-h-[50px] max-h-[50px] hidden">
                            <span className="text-[20px] font-bold leading-[1.4] ltr-num text-white">
                              {formatCurrencyFull(source.avgAmount)}
                            </span>
                            <span className="text-[16px] font-normal text-center leading-[1.4] ltr-num text-white">({formatCurrencyWithSign(source.avgTicketDiff)})</span>
                          </div>
                          <div className="flex flex-col min-h-[50px] max-h-[50px]">
                            <span className="text-[20px] font-bold leading-[1.4] ltr-num text-white">
                              {formatCurrencyFull(source.totalAmount)}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-row-reverse items-start gap-[6px] min-h-[50px] mr-[9px]">
                          <span className="text-[20px] font-bold text-white leading-[1.4]">נתונים {source.name}</span>
                          <div className={`${iconBgClass} w-[31px] h-[31px] rounded-full flex items-center justify-center p-[3px]`}>
                            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" stroke="white" strokeWidth="2">
                              <path d="M4 28V12" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M12 28V4" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M20 28V16" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M28 28V8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-row-reverse justify-between items-start gap-[10px] mt-[5px]">
                        <div className="flex flex-col ml-[10px]">
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold text-white leading-[1.4] ltr-num">{source.ordersCount}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">כמות {source.name}</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px] invisible">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">{formatCurrencyFull(source.targetDiffAmount)}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מהיעד</span>
                          </div>
                        </div>
                        <div className="flex flex-col mr-[10px] invisible">
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">{formatCurrencyFull(source.prevMonthChange)}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי מחודש קודם</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">{formatCurrencyFull(source.prevYearChange)}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי משנה שעברה</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Pearla business: Income source 2 (הגשה) - custom labels
                if (isPearla && index === 1) {
                  return (
                    <div key={source.id} className="data-card-new flex flex-col justify-center gap-[10px] rounded-[10px] p-0 min-h-[155px] w-full cursor-pointer hover:brightness-110 transition-all" onClick={() => openHistoryModal('incomeSource', source.name, source.id)}>
                      <div className="flex flex-row-reverse justify-between items-center w-full">
                        <div className="flex flex-row-reverse items-center gap-[10px] ml-[9px]">
                          <div className="flex flex-col min-h-[50px] max-h-[50px] hidden">
                            <span className="text-[20px] font-bold leading-[1.4] ltr-num text-white">
                              {formatCurrencyFull(source.avgAmount)}
                            </span>
                            <span className="text-[16px] font-normal text-center leading-[1.4] ltr-num text-white">({formatCurrencyWithSign(source.avgTicketDiff)})</span>
                          </div>
                          <div className="flex flex-col min-h-[50px] max-h-[50px]">
                            <span className="text-[20px] font-bold leading-[1.4] ltr-num text-white">
                              {formatCurrencyFull(source.totalAmount)}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-row-reverse items-start gap-[6px] min-h-[50px] mr-[9px]">
                          <span className="text-[20px] font-bold text-white leading-[1.4]">נתונים {source.name}</span>
                          <div className={`${iconBgClass} w-[31px] h-[31px] rounded-full flex items-center justify-center p-[3px]`}>
                            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" stroke="white" strokeWidth="2">
                              <path d="M4 28V12" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M12 28V4" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M20 28V16" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M28 28V8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-row-reverse justify-between items-start gap-[10px] mt-[5px]">
                        <div className="flex flex-col ml-[10px]">
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold text-white leading-[1.4] ltr-num">{source.ordersCount}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">כמות הגשה</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">{formatCurrencyFull(source.ordersCount > 0 ? source.totalAmount / source.ordersCount : 0)}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">ממוצע לאורח</span>
                          </div>
                        </div>
                        <div className="flex flex-col mr-[10px]">
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">0</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">כמות אורחים</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">{formatCurrencyFull(source.avgAmount)}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">ממוצע הגשה</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Pearla business: Income source 3 (אקסטרות) - custom labels
                if (isPearla && index === 2) {
                  return (
                    <div key={source.id} className="data-card-new flex flex-col justify-center gap-[10px] rounded-[10px] p-0 min-h-[155px] w-full cursor-pointer hover:brightness-110 transition-all" onClick={() => openHistoryModal('incomeSource', source.name, source.id)}>
                      <div className="flex flex-row-reverse justify-between items-center w-full">
                        <div className="flex flex-row-reverse items-center gap-[10px] ml-[9px]">
                          <div className="flex flex-col min-h-[50px] max-h-[50px] hidden">
                            <span className="text-[20px] font-bold leading-[1.4] ltr-num text-white">
                              {formatCurrencyFull(source.avgAmount)}
                            </span>
                            <span className="text-[16px] font-normal text-center leading-[1.4] ltr-num text-white">({formatCurrencyWithSign(source.avgTicketDiff)})</span>
                          </div>
                          <div className="flex flex-col min-h-[50px] max-h-[50px]">
                            <span className="text-[20px] font-bold leading-[1.4] ltr-num text-white">
                              {formatCurrencyFull(source.totalAmount)}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-row-reverse items-start gap-[6px] min-h-[50px] mr-[9px]">
                          <span className="text-[20px] font-bold text-white leading-[1.4]">נתונים {source.name}</span>
                          <div className={`${iconBgClass} w-[31px] h-[31px] rounded-full flex items-center justify-center p-[3px]`}>
                            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" stroke="white" strokeWidth="2">
                              <path d="M4 28V12" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M12 28V4" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M20 28V16" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M28 28V8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-row-reverse justify-between items-start gap-[10px] mt-[5px]">
                        <div className="flex flex-col ml-[10px]">
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold text-white leading-[1.4] ltr-num">{source.ordersCount}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">כמות {source.name}</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">{formatCurrencyFull(source.ordersCount > 0 ? source.totalAmount / source.ordersCount : 0)}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">ממוצע לאורח</span>
                          </div>
                        </div>
                        <div className="flex flex-col mr-[10px]">
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">0</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">כמות האורחים</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${source.avgAmount === 0 ? 'text-white' : source.avgTicketDiff < 0 ? 'text-red-500' : source.avgTicketDiff > 0 ? 'text-green-500' : 'text-white'}`}>{formatCurrencyFull(source.avgAmount)}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">ממוצע {source.name}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Default layout for all other businesses/sources
                return (
                  <div key={source.id} className="data-card-new flex flex-col justify-center gap-[10px] rounded-[10px] p-0 min-h-[155px] w-full cursor-pointer hover:brightness-110 transition-all" onClick={() => openHistoryModal('incomeSource', source.name, source.id)}>
                    <div className="flex flex-row-reverse justify-between items-center w-full">
                      <div className="flex flex-row-reverse items-start gap-[10px] ml-[9px]">
                        <div className="flex flex-col items-center">
                          <span className={`text-[20px] font-bold leading-[1.4] ltr-num ${source.ordersCount === 0 ? 'text-white' : source.avgTicketDiff < 0 ? 'text-red-500' : source.avgTicketDiff > 0 ? 'text-green-500' : 'text-white'}`}>
                            {formatCurrencyFull(source.avgAmount)}
                          </span>
                          <span className={`text-[14px] font-normal text-center leading-[1.4] ltr-num ${source.ordersCount === 0 ? 'text-white' : source.avgTicketDiff < 0 ? 'text-red-500' : source.avgTicketDiff > 0 ? 'text-green-500' : 'text-white'}`}>({formatCurrencyWithSign(source.ordersCount === 0 ? 0 : source.avgTicketDiff)})</span>
                        </div>
                        <span className={`text-[20px] font-bold leading-[1.4] ltr-num ${source.ordersCount === 0 ? 'text-white' : source.avgTicketDiff < 0 ? 'text-red-500' : source.avgTicketDiff > 0 ? 'text-green-500' : 'text-white'}`}>
                          {formatCurrencyFull(source.totalAmount)}
                        </span>
                      </div>
                      <div className="flex flex-row-reverse items-start gap-[6px] min-h-[50px] mr-[9px]">
                        <span className="text-[20px] font-bold text-white leading-[1.4]">נתונים {source.name}</span>
                        <div className={`${iconBgClass} w-[31px] h-[31px] rounded-full flex items-center justify-center p-[3px]`}>
                          <svg width="20" height="20" viewBox="0 0 32 32" fill="none" stroke="white" strokeWidth="2">
                            <path d="M4 28V12" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M12 28V4" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M20 28V16" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M28 28V8" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-row-reverse justify-between items-start gap-[10px] mt-[5px]">
                      <div className="flex flex-col ml-[10px]">
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className="text-[16px] font-semibold text-white leading-[1.4] ltr-num">{source.ordersCount}</span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">כמות הזמנות</span>
                        </div>
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${source.ordersCount === 0 ? 'text-white' : source.targetDiffAmount < 0 ? 'text-red-500' : source.targetDiffAmount > 0 ? 'text-green-500' : 'text-white'}`}>{formatCurrencyFull(source.ordersCount === 0 ? 0 : source.targetDiffAmount)}</span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מהיעד</span>
                        </div>
                      </div>
                      <div className="flex flex-col mr-[10px]">
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${source.ordersCount === 0 ? 'text-white' : source.prevMonthChange < 0 ? 'text-red-500' : source.prevMonthChange > 0 ? 'text-green-500' : 'text-white'}`}>{formatCurrencyFull(source.ordersCount === 0 ? 0 : source.prevMonthChange)}</span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי מחודש קודם</span>
                        </div>
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${source.ordersCount === 0 ? 'text-white' : source.prevYearChange < 0 ? 'text-red-500' : source.prevYearChange > 0 ? 'text-green-500' : 'text-white'}`}>{formatCurrencyFull(source.ordersCount === 0 ? 0 : source.prevYearChange)}</span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי משנה שעברה</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* עלות עובדים Card */}
              {(() => {
                const currentBusinessName = businessCards.find(b => b.id === realBusinessId)?.name || "";
                const isPearla = currentBusinessName.includes("פרלה");
                const noIncome = (detailedSummary?.totalIncome || 0) === 0;
                const noLaborData = noIncome || (detailedSummary?.laborCost || 0) === 0;
                const laborDiffColor = noLaborData ? 'text-white' : (detailedSummary?.laborCostDiffPct || 0) > 0 ? 'text-red-500' : (detailedSummary?.laborCostDiffPct || 0) < 0 ? 'text-green-500' : 'text-white';
                const laborPrevMonthColor = noLaborData ? 'text-white' : (detailedSummary?.laborCostPrevMonthChange || 0) > 0 ? 'text-red-500' : (detailedSummary?.laborCostPrevMonthChange || 0) < 0 ? 'text-green-500' : 'text-white';
                const laborPrevYearColor = noLaborData ? 'text-white' : (detailedSummary?.laborCostPrevYearChange || 0) > 0 ? 'text-red-500' : (detailedSummary?.laborCostPrevYearChange || 0) < 0 ? 'text-green-500' : 'text-white';
                const totalEvents = (detailedSummary?.privateCount || 0) + (detailedSummary?.businessCount || 0);
                const avgLaborPerEvent = totalEvents > 0 ? (detailedSummary?.laborCost || 0) / totalEvents : 0;

                if (isPearla) {
                  return (
                    <div className="data-card-new flex flex-col justify-center gap-[10px] rounded-[10px] p-0 min-h-[155px] w-full cursor-pointer hover:brightness-110 transition-all" onClick={() => openHistoryModal('laborCost', 'עלות עובדים')}>
                      <div className="flex flex-row-reverse justify-between items-center w-full gap-[15px]">
                        <div className="flex flex-row items-center gap-[10px] ml-[9px]">
                          <span className={`text-[20px] font-bold leading-[1.4] ltr-num ${laborDiffColor}`}>
                            {formatPercent(detailedSummary?.laborCostPct || 0)}
                          </span>
                          <span className={`text-[20px] font-bold text-center leading-[1.4] ltr-num ${laborDiffColor}`}>
                            {formatCurrencyFull(detailedSummary?.laborCost || 0)}
                          </span>
                        </div>
                        <div className="flex flex-row-reverse items-center gap-[6px] mr-[9px]">
                          <span className="text-[20px] font-bold text-white leading-[1.4]">עלות עובדים</span>
                          <div className="icon-bg-purple w-[31px] h-[31px] rounded-full flex items-center justify-center p-[3px]">
                            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" stroke="white" strokeWidth="2">
                              <circle cx="16" cy="8" r="4" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M6 28v-2a6 6 0 016-6h8a6 6 0 016 6v2" strokeLinecap="round" strokeLinejoin="round"/>
                              <circle cx="26" cy="10" r="3" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M26 28v-1.5a4.5 4.5 0 00-2-3.74" strokeLinecap="round" strokeLinejoin="round"/>
                              <circle cx="6" cy="10" r="3" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M6 28v-1.5a4.5 4.5 0 012-3.74" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                        </div>
                      </div>
                      {/* Middle section - שכירים / כוח אדם with border */}
                      <div className="flex flex-row-reverse justify-between items-start w-full border-b border-white/50 pb-[5px] mt-[5px]">
                        <div className="flex flex-col ml-[10px]">
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">₪0</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">כוח אדם</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">0%</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">כוח אדם (%)</span>
                          </div>
                        </div>
                        <div className="flex flex-col mr-[10px]">
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">₪0</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">שכירים</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">0%</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">שכירים (%)</span>
                          </div>
                        </div>
                      </div>
                      {/* Bottom section - הפרשים + ממוצעים */}
                      <div className="flex flex-row-reverse justify-between items-start gap-[10px]">
                        <div className="flex flex-col ml-[10px]">
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${laborDiffColor}`}>{formatPercent(noLaborData ? 0 : (detailedSummary?.laborCostDiffPct || 0))}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מיעד</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${laborDiffColor}`}>{formatCurrencyFull(noLaborData ? 0 : (detailedSummary?.laborCostDiffAmount || 0))}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מהיעד</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">₪0</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">ממוצע עובדים לאורח</span>
                          </div>
                        </div>
                        <div className="flex flex-col mr-[10px]">
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${laborPrevMonthColor}`}>{formatPercent(noLaborData ? 0 : (detailedSummary?.laborCostPrevMonthChange || 0))}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי מחודש קודם</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${laborPrevYearColor}`}>{formatPercent(noLaborData ? 0 : (detailedSummary?.laborCostPrevYearChange || 0))}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי משנה שעברה</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">{formatCurrencyFull(avgLaborPerEvent)}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">ממוצע עובדים לאירוע</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="data-card-new flex flex-col justify-center gap-[10px] rounded-[10px] p-0 min-h-[155px] w-full cursor-pointer hover:brightness-110 transition-all" onClick={() => openHistoryModal('laborCost', 'עלות עובדים')}>
                    <div className="flex flex-row-reverse justify-between items-center w-full">
                      <div className="flex flex-row-reverse items-center gap-[10px] ml-[9px]">
                        <span className={`text-[20px] font-bold leading-[1.4] ltr-num ${laborDiffColor}`}>
                          {formatPercent(detailedSummary?.laborCostPct || 0)}
                        </span>
                        <span className={`text-[20px] font-bold text-center leading-[1.4] ltr-num ${laborDiffColor}`}>
                          {formatCurrencyFull(detailedSummary?.laborCost || 0)}
                        </span>
                      </div>
                      <div className="flex flex-row-reverse items-center gap-[6px] mr-[9px]">
                        <span className="text-[20px] font-bold text-white leading-[1.4]">עלות עובדים</span>
                        <div className="icon-bg-purple w-[31px] h-[31px] rounded-full flex items-center justify-center p-[3px]">
                          <svg width="20" height="20" viewBox="0 0 32 32" fill="none" stroke="white" strokeWidth="2">
                            <circle cx="16" cy="8" r="4" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M6 28v-2a6 6 0 016-6h8a6 6 0 016 6v2" strokeLinecap="round" strokeLinejoin="round"/>
                            <circle cx="26" cy="10" r="3" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M26 28v-1.5a4.5 4.5 0 00-2-3.74" strokeLinecap="round" strokeLinejoin="round"/>
                            <circle cx="6" cy="10" r="3" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M6 28v-1.5a4.5 4.5 0 012-3.74" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-row-reverse justify-between items-start gap-[10px] mt-[5px]">
                      <div className="flex flex-col ml-[10px]">
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${laborDiffColor}`}>{formatPercent(noLaborData ? 0 : (detailedSummary?.laborCostDiffPct || 0))}</span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מהיעד</span>
                        </div>
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${noLaborData ? 'text-white' : (detailedSummary?.laborCostDiffAmount || 0) > 0 ? 'text-red-500' : (detailedSummary?.laborCostDiffAmount || 0) < 0 ? 'text-green-500' : 'text-white'}`}>{formatCurrencyFull(noLaborData ? 0 : (detailedSummary?.laborCostDiffAmount || 0))}</span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מהיעד</span>
                        </div>
                      </div>
                      <div className="flex flex-col mr-[10px]">
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${laborPrevMonthColor}`}>{formatPercent(noLaborData ? 0 : (detailedSummary?.laborCostPrevMonthChange || 0))}</span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי מחודש קודם</span>
                        </div>
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${laborPrevYearColor}`}>{formatPercent(noLaborData ? 0 : (detailedSummary?.laborCostPrevYearChange || 0))}</span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי משנה שעברה</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* עלות מכר Card */}
              {(() => {
                const currentBusinessName = businessCards.find(b => b.id === realBusinessId)?.name || "";
                const isPearla = currentBusinessName.includes("פרלה");
                const noIncome = (detailedSummary?.totalIncome || 0) === 0;
                const noFoodCost = (detailedSummary?.foodCost || 0) === 0;
                const noFoodData = noIncome || noFoodCost;
                const foodDiffColor = noFoodData ? 'text-white' : (detailedSummary?.foodCostDiffPct || 0) > 0 ? 'text-red-500' : (detailedSummary?.foodCostDiffPct || 0) < 0 ? 'text-green-500' : 'text-white';
                const foodPrevMonthColor = noFoodData ? 'text-white' : (detailedSummary?.foodCostPrevMonthChange || 0) > 0 ? 'text-red-500' : (detailedSummary?.foodCostPrevMonthChange || 0) < 0 ? 'text-green-500' : 'text-white';
                const foodPrevYearColor = noFoodData ? 'text-white' : (detailedSummary?.foodCostPrevYearChange || 0) > 0 ? 'text-red-500' : (detailedSummary?.foodCostPrevYearChange || 0) < 0 ? 'text-green-500' : 'text-white';
                const totalEvents = (detailedSummary?.privateCount || 0) + (detailedSummary?.businessCount || 0);
                const avgFoodPerEvent = totalEvents > 0 ? (detailedSummary?.foodCost || 0) / totalEvents : 0;

                if (isPearla) {
                  return (
                    <div className="data-card-new flex flex-col justify-center gap-[10px] rounded-[10px] p-0 min-h-[155px] w-full cursor-pointer hover:brightness-110 transition-all" onClick={() => openHistoryModal('foodCost', 'עלות מכר')}>
                      <div className="flex flex-row-reverse justify-between items-center w-full">
                        <div className="flex flex-row-reverse items-center gap-[10px] ml-[9px]">
                          <span className={`text-[20px] font-bold leading-[1.4] ltr-num ${foodDiffColor}`}>
                            {formatPercent(detailedSummary?.foodCostPct || 0)}
                          </span>
                          <span className={`text-[20px] font-bold text-center leading-[1.4] ltr-num ${foodDiffColor}`}>
                            {formatCurrencyFull(detailedSummary?.foodCost || 0)}
                          </span>
                        </div>
                        <div className="flex flex-row-reverse items-center gap-[6px] mr-[9px]">
                          <span className="text-[20px] font-bold text-white leading-[1.4]">עלות מכר</span>
                          <div className="icon-bg-orange w-[31px] h-[31px] rounded-full flex items-center justify-center p-[3px]">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                              <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M18 9l-5 5-4-4-3 3" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-row-reverse justify-between items-start gap-[10px] mt-[5px]">
                        <div className="flex flex-col ml-[10px]">
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${foodDiffColor}`}>{formatPercentWithSign(noFoodData ? 0 : (detailedSummary?.foodCostDiffPct || 0))}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מיעד</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${foodDiffColor}`}>{formatCurrencyFullWithSign(noFoodData ? 0 : ((detailedSummary?.foodCostDiffPct || 0) / 100) * (detailedSummary?.revenueTargetBeforeVat || 0))}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מהיעד</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">₪0</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">ממוצע סחורה לאורח</span>
                          </div>
                        </div>
                        <div className="flex flex-col mr-[10px]">
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${foodPrevMonthColor}`}>{formatPercentWithSign(noFoodData ? 0 : (detailedSummary?.foodCostPrevMonthChange || 0))}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי מחודש קודם</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${foodPrevYearColor}`}>{formatPercentWithSign(noFoodData ? 0 : (detailedSummary?.foodCostPrevYearChange || 0))}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי משנה שעברה</span>
                          </div>
                          <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                            <span className="text-[16px] font-semibold leading-[1.4] ltr-num text-white">{formatCurrencyFull(avgFoodPerEvent)}</span>
                            <span className="text-[14px] font-medium text-white leading-[1.4]">ממוצע סחורה לאירוע</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="data-card-new flex flex-col justify-center gap-[10px] rounded-[10px] p-0 min-h-[155px] w-full cursor-pointer hover:brightness-110 transition-all" onClick={() => openHistoryModal('foodCost', 'עלות מכר')}>
                    <div className="flex flex-row-reverse justify-between items-center w-full">
                      <div className="flex flex-row-reverse items-center gap-[10px] ml-[9px]">
                        <span className={`text-[20px] font-bold leading-[1.4] ltr-num ${foodDiffColor}`}>
                          {formatPercent(detailedSummary?.foodCostPct || 0)}
                        </span>
                        <span className={`text-[20px] font-bold text-center leading-[1.4] ltr-num ${foodDiffColor}`}>
                          {formatCurrencyFull(detailedSummary?.foodCost || 0)}
                        </span>
                      </div>
                      <div className="flex flex-row-reverse items-center gap-[6px] mr-[9px]">
                        <span className="text-[20px] font-bold text-white leading-[1.4]">עלות מכר</span>
                        <div className="icon-bg-orange w-[31px] h-[31px] rounded-full flex items-center justify-center p-[3px]">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                            <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M18 9l-5 5-4-4-3 3" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-row-reverse justify-between items-start gap-[10px] mt-[5px]">
                      <div className="flex flex-col ml-[10px]">
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${foodDiffColor}`}>{formatPercentWithSign(noFoodData ? 0 : (detailedSummary?.foodCostDiffPct || 0))}</span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מהיעד</span>
                        </div>
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${foodDiffColor}`}>{formatCurrencyFullWithSign(noFoodData ? 0 : ((detailedSummary?.foodCostDiffPct || 0) / 100) * (detailedSummary?.revenueTargetBeforeVat || 0))}</span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מהיעד</span>
                        </div>
                      </div>
                      <div className="flex flex-col mr-[10px]">
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${foodPrevMonthColor}`}>{formatPercentWithSign(noFoodData ? 0 : (detailedSummary?.foodCostPrevMonthChange || 0))}</span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי מחודש קודם</span>
                        </div>
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${foodPrevYearColor}`}>{formatPercentWithSign(noFoodData ? 0 : (detailedSummary?.foodCostPrevYearChange || 0))}</span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי משנה שעברה</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Dynamic Managed Products Cards */}
              {managedProductsSummary.map((product, index) => {
                // Alternate colors for icons
                const iconBgColors = ["icon-bg-orange", "icon-bg-purple", "icon-bg-pink", "icon-bg-cyan"];
                const iconBgClass = iconBgColors[index % iconBgColors.length];

                // Calculate actual percentage
                const actualPct = detailedSummary?.incomeBeforeVat && product.totalCost > 0
                  ? (product.totalCost / detailedSummary.incomeBeforeVat) * 100
                  : 0;

                // Calculate diff from target
                const targetPct = product.targetPct ?? 0;
                const noProdData = (detailedSummary?.totalIncome || 0) === 0 || product.totalCost === 0;
                const diffPct = noProdData ? 0 : actualPct - targetPct;

                // Calculate diff in ILS
                const diffILS = noProdData ? 0 : (diffPct / 100) * (detailedSummary?.revenueTargetBeforeVat || 0);

                // Determine color based on diff
                const diffColor = noProdData ? 'text-white' : diffPct > 0 ? 'text-red-500' : diffPct < 0 ? 'text-green-500' : 'text-white';

                return (
                  <div key={product.id} className="data-card-new flex flex-col justify-center gap-[10px] rounded-[10px] p-0 min-h-[155px] w-full cursor-pointer hover:brightness-110 transition-all" onClick={() => openHistoryModal('managedProduct', product.name, product.id)}>
                    <div className="flex flex-row-reverse justify-between items-center w-full">
                      <div className="flex flex-row-reverse items-center gap-[10px] ml-[9px]">
                        <span className={`text-[20px] font-bold leading-[1.4] ltr-num ${diffColor}`}>
                          {formatPercent(actualPct)}
                        </span>
                        <span className={`text-[20px] font-bold text-center leading-[1.4] ltr-num ${diffColor}`}>
                          {formatCurrencyFull(product.totalCost)}
                        </span>
                      </div>
                      <div className="flex flex-row-reverse items-center gap-[6px] mr-[9px]">
                        <span className="text-[20px] font-bold text-white leading-[1.4]">עלות {product.name}</span>
                        <div className={`${iconBgClass} w-[31px] h-[31px] rounded-full flex items-center justify-center p-[3px]`}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                            <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" strokeLinecap="round" strokeLinejoin="round"/>
                            <line x1="3" y1="6" x2="21" y2="6" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M16 10a4 4 0 01-8 0" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-row-reverse justify-between items-start gap-[10px] mt-[5px]">
                      <div className="flex flex-col ml-[10px]">
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${diffColor}`}>
                            {formatPercentWithSign(diffPct)}
                          </span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מהיעד</span>
                        </div>
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${diffColor}`}>
                            {formatCurrencyFullWithSign(diffILS)}
                          </span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מהיעד</span>
                        </div>
                      </div>
                      <div className="flex flex-col mr-[10px]">
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${noProdData ? 'text-white' : product.prevMonthChange > 0 ? 'text-red-500' : product.prevMonthChange < 0 ? 'text-green-500' : 'text-white'}`}>
                            {formatPercentWithSign(noProdData ? 0 : product.prevMonthChange)}
                          </span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי מחודש קודם</span>
                        </div>
                        <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                          <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${noProdData ? 'text-white' : product.prevYearChange > 0 ? 'text-red-500' : product.prevYearChange < 0 ? 'text-green-500' : 'text-white'}`}>
                            {formatPercentWithSign(noProdData ? 0 : product.prevYearChange)}
                          </span>
                          <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי משנה שעברה</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* עלות הוצאות שוטפות Card */}
              {(() => {
                const noExpData = (detailedSummary?.totalIncome || 0) === 0 || (detailedSummary?.currentExpenses || 0) === 0;
                const expDiffColor = noExpData ? 'text-white' : (detailedSummary?.currentExpensesDiffPct || 0) > 0 ? 'text-red-500' : (detailedSummary?.currentExpensesDiffPct || 0) < 0 ? 'text-green-500' : 'text-white';
                const expPrevMonthColor = noExpData ? 'text-white' : (detailedSummary?.currentExpensesPrevMonthChange || 0) > 0 ? 'text-red-500' : (detailedSummary?.currentExpensesPrevMonthChange || 0) < 0 ? 'text-green-500' : 'text-white';
                const expPrevYearColor = noExpData ? 'text-white' : (detailedSummary?.currentExpensesPrevYearChange || 0) > 0 ? 'text-red-500' : (detailedSummary?.currentExpensesPrevYearChange || 0) < 0 ? 'text-green-500' : 'text-white';
                return (
              <div className="data-card-new flex flex-col justify-center gap-[10px] rounded-[10px] p-0 min-h-[155px] w-full cursor-pointer hover:brightness-110 transition-all" onClick={() => openHistoryModal('currentExpenses', 'הוצאות שוטפות')}>
                <div className="flex flex-row-reverse justify-between items-center w-full">
                  <div className="flex flex-row-reverse items-center gap-[10px] ml-[9px]">
                    <span className={`text-[20px] font-bold leading-[1.4] ltr-num ${expDiffColor}`}>
                      {formatPercent(detailedSummary?.currentExpensesPct || 0)}
                    </span>
                    <span className={`text-[20px] font-bold text-center leading-[1.4] ltr-num ${expDiffColor}`}>
                      {formatCurrencyFull(detailedSummary?.currentExpenses || 0)}
                    </span>
                  </div>
                  <div className="flex flex-row-reverse items-center gap-[6px] mr-[9px]">
                    <span className="text-[20px] font-bold text-white leading-[1.4]">הוצאות שוטפות</span>
                    <div className="icon-bg-peach w-[31px] h-[31px] rounded-full flex items-center justify-center p-[3px]">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M18 9l-5 5-4-4-3 3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                </div>
                <div className="flex flex-row-reverse justify-between items-start gap-[10px] mt-[5px]">
                  <div className="flex flex-col ml-[10px]">
                    <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                      <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${expDiffColor}`}>
                        {formatPercentWithSign(noExpData ? 0 : (detailedSummary?.currentExpensesDiffPct || 0))}
                      </span>
                      <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מהיעד</span>
                    </div>
                    <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                      <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${expDiffColor}`}>
                        {formatCurrencyFullWithSign(noExpData ? 0 : ((detailedSummary?.currentExpensesDiffPct || 0) / 100) * (detailedSummary?.revenueTargetBeforeVat || 0))}
                      </span>
                      <span className="text-[14px] font-medium text-white leading-[1.4]">הפרש מהיעד</span>
                    </div>
                  </div>
                  <div className="flex flex-col mr-[10px]">
                    <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                      <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${expPrevMonthColor}`}>
                        {formatPercentWithSign(noExpData ? 0 : (detailedSummary?.currentExpensesPrevMonthChange || 0))}
                      </span>
                      <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי מחודש קודם</span>
                    </div>
                    <div className="flex flex-row-reverse justify-between items-center gap-[5px]">
                      <span className={`text-[16px] font-semibold leading-[1.4] ltr-num ${expPrevYearColor}`}>
                        {formatPercentWithSign(noExpData ? 0 : (detailedSummary?.currentExpensesPrevYearChange || 0))}
                      </span>
                      <span className="text-[14px] font-medium text-white leading-[1.4]">שינוי משנה שעברה</span>
                    </div>
                  </div>
                </div>
              </div>
                );
              })()}
                </>
              )}
            </div>

            {/* Charts Section - מוצג כשיש נתונים או בזמן טעינה */}
            {(isInitialLoad || trendsChartData.length > 0 || incomeSourcesSummary.length > 0 || laborCostChartData.length > 0 || managedProductChartData.length > 0) && (
            <div id="onboarding-charts" className="flex flex-col lg:grid lg:grid-cols-2 gap-[15px] mt-[15px]">
              {/* 1. מגמות Chart (Trends) - דינמי */}
              {isInitialLoad && trendsChartData.length === 0 ? (
              <div className="data-card-new rounded-[10px] p-[7px]">
                <div className="flex justify-between items-center mb-4">
                  <div className="h-[22px] w-[80px] rounded-[6px] bg-white/10 animate-pulse" />
                  <div className="h-[28px] w-[70px] rounded-[5px] bg-white/10 animate-pulse" />
                </div>
                <div className="h-[280px] w-full flex items-end justify-around gap-2 px-4 pb-8">
                  {/* Skeleton bars */}
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-white/10 animate-pulse skeleton-bar-h-65" />
                    <div className="w-[16px] rounded-t-[4px] bg-white/10 animate-pulse skeleton-bar-h-52" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-white/10 animate-pulse skeleton-bar-h-45" />
                    <div className="w-[16px] rounded-t-[4px] bg-white/10 animate-pulse skeleton-bar-h-36" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-white/10 animate-pulse skeleton-bar-h-80" />
                    <div className="w-[16px] rounded-t-[4px] bg-white/10 animate-pulse skeleton-bar-h-63" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-white/10 animate-pulse skeleton-bar-h-55" />
                    <div className="w-[16px] rounded-t-[4px] bg-white/10 animate-pulse skeleton-bar-h-44" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-white/10 animate-pulse skeleton-bar-h-70" />
                    <div className="w-[16px] rounded-t-[4px] bg-white/10 animate-pulse skeleton-bar-h-56" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-white/10 animate-pulse skeleton-bar-h-90" />
                    <div className="w-[16px] rounded-t-[4px] bg-white/10 animate-pulse skeleton-bar-h-72" />
                  </div>
                </div>
                {/* Skeleton legend */}
                <div className="flex flex-row-reverse justify-center flex-wrap gap-4 mt-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={`legend-skeleton-${i}`} className="flex flex-row-reverse items-center gap-2">
                      <div className="h-[12px] w-[60px] rounded-[4px] bg-white/10 animate-pulse" />
                      <div className="w-[10px] h-[10px] bg-white/10 rounded-[2px] animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
              ) : trendsChartData.length > 0 && (
              <div className="data-card-new rounded-[10px] p-[7px]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-white font-bold text-[18px]">מגמות</h3>
                  <Select defaultValue="year">
                    <SelectTrigger className="bg-transparent border border-[#4C526B] rounded-[5px] text-[#7B91B0] text-[12px] px-3 py-1 h-auto w-auto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="year">השנה</SelectItem>
                      <SelectItem value="month">החודש</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="h-[280px] w-full bg-[#0f1535]/40 rounded-[8px]" dir="ltr">
                  <SafeChartContainer>
                    <LazyComposedChart data={trendsChartData} barGap={4} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                      <defs>
                        <linearGradient id="colorSalesActual" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00E096" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#00E096" stopOpacity={0.3}/>
                        </linearGradient>
                        <linearGradient id="colorSalesTarget" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0095FF" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#0095FF" stopOpacity={0.3}/>
                        </linearGradient>
                      </defs>
                      <LazyCartesianGrid strokeDasharray="3 3" stroke="#7B91B0" strokeOpacity={0.15} />
                      <LazyXAxis
                        dataKey="month"
                        tick={{ fill: '#ffffff', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <LazyYAxis
                        yAxisId="left"
                        orientation="right"
                        width={40}
                        tick={{ fill: '#ffffff', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => `${value/1000}k`}
                      />
                      <LazyYAxis
                        yAxisId="right"
                        orientation="left"
                        width={35}
                        tick={{ fill: '#ffffff', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        domain={[0, 100]}
                        tickFormatter={(value) => `${value}%`}
                      />
                      {/* Bars - מכירות */}
                      <LazyBar yAxisId="left" dataKey="salesActual" fill="url(#colorSalesActual)" radius={[4, 4, 0, 0]} barSize={20} name="מכירות בפועל" />
                      <LazyBar yAxisId="left" dataKey="salesTarget" fill="url(#colorSalesTarget)" radius={[4, 4, 0, 0]} barSize={20} name="יעד מכירות" />
                      {/* Lines - אחוזי עלות */}
                      <LazyLine
                        yAxisId="right"
                        type="monotone"
                        dataKey="laborCostPct"
                        stroke="#FACC15"
                        strokeWidth={3}
                        dot={{ fill: '#FACC15', strokeWidth: 2, r: 4 }}
                        name="עלות עובדים %"
                      />
                      <LazyLine
                        yAxisId="right"
                        type="monotone"
                        dataKey="foodCostPct"
                        stroke="#EF4444"
                        strokeWidth={3}
                        dot={{ fill: '#EF4444', strokeWidth: 2, r: 4 }}
                        name="עלות מכר %"
                      />
                    </LazyComposedChart>
                  </SafeChartContainer>
                </div>
                {/* Legend */}
                <div className="flex flex-row-reverse justify-center flex-wrap gap-4 mt-3">
                  <div className="flex flex-row-reverse items-center gap-2">
                    <span className="text-white text-[10px]">מכירות בפועל</span>
                    <div className="w-[10px] h-[10px] bg-[#00E096] rounded-[2px]"></div>
                  </div>
                  <div className="flex flex-row-reverse items-center gap-2">
                    <span className="text-white text-[10px]">יעד מכירות</span>
                    <div className="w-[10px] h-[10px] bg-[#0095FF] rounded-[2px]"></div>
                  </div>
                  <div className="flex flex-row-reverse items-center gap-2">
                    <span className="text-white text-[10px]">עלות עובדים %</span>
                    <div className="w-[10px] h-[10px] bg-[#FACC15] rounded-full"></div>
                  </div>
                  <div className="flex flex-row-reverse items-center gap-2">
                    <span className="text-white text-[10px]">עלות מכר %</span>
                    <div className="w-[10px] h-[10px] bg-[#EF4444] rounded-full"></div>
                  </div>
                </div>
              </div>
              )}

              {/* 2. ממוצע הכנסה Chart - היסטורי לפי חודשים */}
              {isInitialLoad && orderAvgChartData.length === 0 ? (
              <div className="data-card-new rounded-[10px] p-[7px]">
                <div className="flex justify-between items-center mb-4">
                  <div className="h-[22px] w-[100px] rounded-[6px] bg-white/10 animate-pulse" />
                  <div className="h-[28px] w-[70px] rounded-[5px] bg-white/10 animate-pulse" />
                </div>
                <div className="h-[280px] w-full flex items-end justify-around gap-3 px-4 pb-8">
                  {/* Skeleton bars - 2 per group for income sources */}
                  <div className="flex gap-[2px]">
                    <div className="w-[12px] rounded-t-[4px] bg-[#FFA800]/20 animate-pulse skeleton-bar-h-70" />
                    <div className="w-[12px] rounded-t-[4px] bg-[#C618CA]/20 animate-pulse skeleton-bar-h-59" />
                  </div>
                  <div className="flex gap-[2px]">
                    <div className="w-[12px] rounded-t-[4px] bg-[#FFA800]/20 animate-pulse skeleton-bar-h-55" />
                    <div className="w-[12px] rounded-t-[4px] bg-[#C618CA]/20 animate-pulse skeleton-bar-h-47" />
                  </div>
                  <div className="flex gap-[2px]">
                    <div className="w-[12px] rounded-t-[4px] bg-[#FFA800]/20 animate-pulse skeleton-bar-h-80" />
                    <div className="w-[12px] rounded-t-[4px] bg-[#C618CA]/20 animate-pulse skeleton-bar-h-68" />
                  </div>
                  <div className="flex gap-[2px]">
                    <div className="w-[12px] rounded-t-[4px] bg-[#FFA800]/20 animate-pulse skeleton-bar-h-60" />
                    <div className="w-[12px] rounded-t-[4px] bg-[#C618CA]/20 animate-pulse skeleton-bar-h-50" />
                  </div>
                  <div className="flex gap-[2px]">
                    <div className="w-[12px] rounded-t-[4px] bg-[#FFA800]/20 animate-pulse skeleton-bar-h-75" />
                    <div className="w-[12px] rounded-t-[4px] bg-[#C618CA]/20 animate-pulse skeleton-bar-h-63" />
                  </div>
                  <div className="flex gap-[2px]">
                    <div className="w-[12px] rounded-t-[4px] bg-[#FFA800]/20 animate-pulse skeleton-bar-h-85" />
                    <div className="w-[12px] rounded-t-[4px] bg-[#C618CA]/20 animate-pulse skeleton-bar-h-72" />
                  </div>
                </div>
                {/* Skeleton legend */}
                <div className="flex flex-row-reverse justify-center flex-wrap gap-4 mt-3">
                  {[1, 2].map((i) => (
                    <div key={`income-legend-skeleton-${i}`} className="flex flex-row-reverse items-center gap-2">
                      <div className="flex flex-col items-end gap-1">
                        <div className="h-[12px] w-[50px] rounded-[4px] bg-white/10 animate-pulse" />
                        <div className="h-[16px] w-[40px] rounded-[4px] bg-white/10 animate-pulse" />
                      </div>
                      <div className="w-[10px] h-[10px] bg-white/10 rounded-full animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
              ) : orderAvgChartData.length > 0 && incomeSourcesSummary.length > 0 ? (
              <div className="data-card-new rounded-[10px] p-[7px]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-white font-bold text-[18px]">ממוצע הכנסה</h3>
                  <Select defaultValue="year">
                    <SelectTrigger className="bg-transparent border border-[#4C526B] rounded-[5px] text-[#7B91B0] text-[12px] px-3 py-1 h-auto w-auto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="year">השנה</SelectItem>
                      <SelectItem value="month">החודש</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="h-[280px] w-full bg-[#0f1535]/40 rounded-[8px]" dir="ltr">
                  <SafeChartContainer>
                    <LazyBarChart data={orderAvgChartData} barGap={2} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                      <LazyCartesianGrid strokeDasharray="3 3" stroke="#7B91B0" strokeOpacity={0.15} />
                      <LazyXAxis
                        dataKey="month"
                        tick={{ fill: '#ffffff', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <LazyYAxis
                        orientation="right"
                        width={40}
                        tick={{ fill: '#ffffff', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => `₪${value}`}
                      />
                      {incomeSourcesSummary.map((source, index) => {
                        const colors = ['#FFA800', '#C618CA', '#BBF417'];
                        return (
                          <LazyBar
                            key={source.id}
                            dataKey={source.name}
                            fill={colors[index % colors.length]}
                            radius={[4, 4, 0, 0]}
                            barSize={16}
                          />
                        );
                      })}
                    </LazyBarChart>
                  </SafeChartContainer>
                </div>
                <div className="flex flex-row-reverse justify-center flex-wrap gap-4 mt-3">
                  {incomeSourcesSummary.map((source, index) => {
                    const colorClasses = ['text-[#FFA800]', 'text-[#C618CA]', 'text-[#BBF417]'];
                    const bgClasses = ['bg-[#FFA800]', 'bg-[#C618CA]', 'bg-[#BBF417]'];
                    return (
                      <div key={source.id} className="flex flex-row-reverse items-center gap-2">
                        <div className="flex flex-col items-end">
                          <span className="text-white text-[11px]">{source.name}</span>
                          <span className={`font-bold text-[14px] ltr-num ${colorClasses[index % colorClasses.length]}`}>₪{Math.round(source.avgAmount)}</span>
                        </div>
                        <div className={`w-[10px] h-[10px] rounded-full ${bgClasses[index % bgClasses.length]}`}></div>
                      </div>
                    );
                  })}
                </div>
              </div>
              ) : null}

              {/* 2.5 ניהול עלות מכר Chart */}
              {isInitialLoad && foodCostChartData.length === 0 ? (
              <div className="data-card-new rounded-[10px] p-[7px]">
                <div className="flex justify-between items-center mb-4">
                  <div className="h-[22px] w-[120px] rounded-[6px] bg-white/10 animate-pulse" />
                  <div className="h-[28px] w-[70px] rounded-[5px] bg-white/10 animate-pulse" />
                </div>
                <div className="h-[280px] w-full flex items-end justify-around gap-4 px-4 pb-8">
                  {/* Skeleton bars - 2 per group */}
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-[#0095FF]/20 animate-pulse skeleton-bar-h-60" />
                    <div className="w-[16px] rounded-t-[4px] bg-[#00E096]/20 animate-pulse skeleton-bar-h-54" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-[#0095FF]/20 animate-pulse skeleton-bar-h-50" />
                    <div className="w-[16px] rounded-t-[4px] bg-[#00E096]/20 animate-pulse skeleton-bar-h-45" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-[#0095FF]/20 animate-pulse skeleton-bar-h-70" />
                    <div className="w-[16px] rounded-t-[4px] bg-[#00E096]/20 animate-pulse skeleton-bar-h-63" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-[#0095FF]/20 animate-pulse skeleton-bar-h-55" />
                    <div className="w-[16px] rounded-t-[4px] bg-[#00E096]/20 animate-pulse skeleton-bar-h-50" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-[#0095FF]/20 animate-pulse skeleton-bar-h-65" />
                    <div className="w-[16px] rounded-t-[4px] bg-[#00E096]/20 animate-pulse skeleton-bar-h-59" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-[#0095FF]/20 animate-pulse skeleton-bar-h-75" />
                    <div className="w-[16px] rounded-t-[4px] bg-[#00E096]/20 animate-pulse skeleton-bar-h-68" />
                  </div>
                </div>
                {/* Skeleton legend */}
                <div className="flex flex-row-reverse justify-center gap-6 mt-3">
                  {[1, 2].map((i) => (
                    <div key={`food-legend-skeleton-${i}`} className="flex flex-row-reverse items-center gap-2">
                      <div className="h-[12px] w-[40px] rounded-[4px] bg-white/10 animate-pulse" />
                      <div className="w-[10px] h-[10px] bg-white/10 rounded-[2px] animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
              ) : foodCostChartData.length > 0 ? (
              <div className="data-card-new rounded-[10px] p-[7px]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-white font-bold text-[18px]">ניהול עלות מכר</h3>
                  <Select defaultValue="year">
                    <SelectTrigger className="bg-transparent border border-[#4C526B] rounded-[5px] text-[#7B91B0] text-[12px] px-3 py-1 h-auto w-auto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="year">השנה</SelectItem>
                      <SelectItem value="month">החודש</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="h-[280px] w-full bg-[#0f1535]/40 rounded-[8px]" dir="ltr">
                  <SafeChartContainer>
                    <LazyBarChart data={foodCostChartData} barGap={4} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                      <LazyCartesianGrid strokeDasharray="3 3" stroke="#7B91B0" strokeOpacity={0.15} />
                      <LazyXAxis
                        dataKey="month"
                        tick={{ fill: '#ffffff', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <LazyYAxis
                        orientation="right"
                        width={45}
                        tick={{ fill: '#ffffff', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => value >= 1000 ? `₪${(value/1000).toFixed(0)}k` : `₪${value}`}
                      />
                      <LazyBar dataKey="target" fill="#0095FF" radius={[4, 4, 0, 0]} barSize={20} name="יעד" />
                      <LazyBar dataKey="actual" fill="#00E096" radius={[4, 4, 0, 0]} barSize={20} name="בפועל" />
                    </LazyBarChart>
                  </SafeChartContainer>
                </div>
                <div className="flex flex-row-reverse justify-center gap-6 mt-3">
                  <div className="flex flex-row-reverse items-center gap-2">
                    <span className="text-white text-[11px]">יעד</span>
                    <div className="w-[10px] h-[10px] bg-[#0095FF] rounded-[2px]"></div>
                  </div>
                  <div className="flex flex-row-reverse items-center gap-2">
                    <span className="text-white text-[11px]">בפועל</span>
                    <div className="w-[10px] h-[10px] bg-[#00E096] rounded-[2px]"></div>
                  </div>
                </div>
              </div>
              ) : null}

              {/* 3. עלות עבודה Chart - Area Chart */}
              {isInitialLoad && laborCostChartData.length === 0 ? (
              <div className="data-card-new rounded-[10px] p-[7px]">
                <div className="flex justify-between items-center mb-4">
                  <div className="h-[22px] w-[90px] rounded-[6px] bg-white/10 animate-pulse" />
                  <div className="h-[28px] w-[70px] rounded-[5px] bg-white/10 animate-pulse" />
                </div>
                <div className="h-[280px] w-full relative px-4 pb-8">
                  {/* Skeleton area chart waves */}
                  <div className="absolute inset-0 flex items-end">
                    <svg className="w-full h-[180px]" viewBox="0 0 300 180" preserveAspectRatio="none">
                      <path d="M0,180 L0,120 Q50,100 100,110 T200,90 T300,100 L300,180 Z" fill="rgba(255,255,255,0.05)" className="animate-pulse" />
                      <path d="M0,180 L0,140 Q50,120 100,130 T200,110 T300,120 L300,180 Z" fill="rgba(255,255,255,0.03)" className="animate-pulse" />
                    </svg>
                  </div>
                </div>
                {/* Skeleton legend */}
                <div className="flex flex-row-reverse justify-center gap-8 mt-3">
                  {[1, 2].map((i) => (
                    <div key={`labor-legend-skeleton-${i}`} className="flex flex-row-reverse items-center gap-2">
                      <div className="flex flex-col items-end gap-1">
                        <div className="h-[12px] w-[80px] rounded-[4px] bg-white/10 animate-pulse" />
                        <div className="h-[14px] w-[60px] rounded-[4px] bg-white/10 animate-pulse" />
                      </div>
                      <div className="w-[10px] h-[10px] bg-white/10 rounded-full animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
              ) : laborCostChartData.length > 0 ? (
              <div className="data-card-new rounded-[10px] p-[7px]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-white font-bold text-[18px]">עלות עבודה</h3>
                  <Select defaultValue="year">
                    <SelectTrigger className="bg-transparent border border-[#4C526B] rounded-[5px] text-[#7B91B0] text-[12px] px-3 py-1 h-auto w-auto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="year">השנה</SelectItem>
                      <SelectItem value="month">החודש</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="h-[280px] w-full bg-[#0f1535]/40 rounded-[8px]" dir="ltr">
                  <SafeChartContainer>
                    <LazyAreaChart data={laborCostChartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                      <defs>
                        <linearGradient id="colorLaborActual" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00E096" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#00E096" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorLaborTarget" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0095FF" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#0095FF" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <LazyCartesianGrid strokeDasharray="3 3" stroke="#7B91B0" strokeOpacity={0.15} />
                      <LazyXAxis
                        dataKey="month"
                        tick={{ fill: '#ffffff', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <LazyYAxis
                        orientation="right"
                        width={35}
                        tick={{ fill: '#ffffff', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        domain={[0, 100]}
                        tickFormatter={(value) => `${value}%`}
                      />
                      <LazyArea
                        type="monotone"
                        dataKey="actual"
                        stroke="#00E096"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorLaborActual)"
                        dot={{ fill: '#00E096', strokeWidth: 2, r: 4 }}
                      />
                      <LazyArea
                        type="monotone"
                        dataKey="target"
                        stroke="#0095FF"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorLaborTarget)"
                        dot={{ fill: '#0095FF', strokeWidth: 2, r: 4 }}
                      />
                    </LazyAreaChart>
                  </SafeChartContainer>
                </div>
                <div className="flex flex-row-reverse justify-center gap-8 mt-3">
                  <div className="flex flex-row-reverse items-center gap-2">
                    <div className="flex flex-col items-end">
                      <span className="text-white text-[11px]">יעד עלות עובדים</span>
                      <span className="text-[#0095FF] font-bold text-[12px] ltr-num">
                        ₪{detailedSummary ? Math.round((detailedSummary.laborCostTargetPct / 100) * detailedSummary.incomeBeforeVat).toLocaleString('he-IL') : 0} {detailedSummary ? Math.round(detailedSummary.laborCostTargetPct) : 0}%
                      </span>
                    </div>
                    <div className="w-[10px] h-[10px] bg-[#0095FF] rounded-full"></div>
                  </div>
                  <div className="flex flex-row-reverse items-center gap-2">
                    <div className="flex flex-col items-end">
                      <span className="text-white text-[11px]">עלות עובדים בפועל</span>
                      <span className="text-[#00E096] font-bold text-[12px] ltr-num">
                        ₪{detailedSummary ? detailedSummary.laborCost.toLocaleString('he-IL', { maximumFractionDigits: 0 }) : 0} {detailedSummary ? Math.round(detailedSummary.laborCostPct) : 0}%
                      </span>
                    </div>
                    <div className="w-[10px] h-[10px] bg-[#00E096] rounded-full"></div>
                  </div>
                </div>
              </div>
              ) : null}

              {/* 4. מוצר מנוהל Chart */}
              {isInitialLoad && managedProductChartData.length === 0 ? (
              <div className="data-card-new rounded-[10px] p-[7px]">
                <div className="flex justify-between items-center mb-4">
                  <div className="h-[22px] w-[80px] rounded-[6px] bg-white/10 animate-pulse" />
                  <div className="h-[28px] w-[70px] rounded-[5px] bg-white/10 animate-pulse" />
                </div>
                <div className="h-[280px] w-full flex items-end justify-around gap-4 px-4 pb-8">
                  {/* Skeleton bars - 2 per group */}
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-[#0095FF]/20 animate-pulse skeleton-bar-h-55" />
                    <div className="w-[16px] rounded-t-[4px] bg-[#00E096]/20 animate-pulse skeleton-bar-h-47" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-[#0095FF]/20 animate-pulse skeleton-bar-h-70" />
                    <div className="w-[16px] rounded-t-[4px] bg-[#00E096]/20 animate-pulse skeleton-bar-h-59" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-[#0095FF]/20 animate-pulse skeleton-bar-h-60" />
                    <div className="w-[16px] rounded-t-[4px] bg-[#00E096]/20 animate-pulse skeleton-bar-h-50" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-[#0095FF]/20 animate-pulse skeleton-bar-h-75" />
                    <div className="w-[16px] rounded-t-[4px] bg-[#00E096]/20 animate-pulse skeleton-bar-h-63" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-[#0095FF]/20 animate-pulse skeleton-bar-h-50" />
                    <div className="w-[16px] rounded-t-[4px] bg-[#00E096]/20 animate-pulse skeleton-bar-h-42" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-[16px] rounded-t-[4px] bg-[#0095FF]/20 animate-pulse skeleton-bar-h-80" />
                    <div className="w-[16px] rounded-t-[4px] bg-[#00E096]/20 animate-pulse skeleton-bar-h-68" />
                  </div>
                </div>
                {/* Skeleton legend */}
                <div className="flex flex-row-reverse justify-center gap-6 mt-3">
                  <div className="flex flex-row-reverse items-center gap-2">
                    <div className="h-[12px] w-[40px] rounded-[4px] bg-white/10 animate-pulse" />
                    <div className="w-[10px] h-[10px] bg-white/10 rounded-[2px] animate-pulse" />
                  </div>
                  <div className="flex flex-row-reverse items-center gap-2">
                    <div className="h-[12px] w-[40px] rounded-[4px] bg-white/10 animate-pulse" />
                    <div className="w-[10px] h-[10px] bg-white/10 rounded-[2px] animate-pulse" />
                  </div>
                </div>
              </div>
              ) : managedProductChartData.length > 0 && managedProductsSummary.length > 0 ? (
              <div className="data-card-new rounded-[10px] p-[7px]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-white font-bold text-[18px]">{managedProductsSummary[0]?.name || 'מוצר מנוהל'}</h3>
                  <Select defaultValue="year">
                    <SelectTrigger className="bg-transparent border border-[#4C526B] rounded-[5px] text-[#7B91B0] text-[12px] px-3 py-1 h-auto w-auto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="year">השנה</SelectItem>
                      <SelectItem value="month">החודש</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="h-[280px] w-full bg-[#0f1535]/40 rounded-[8px]" dir="ltr">
                  <SafeChartContainer>
                    <LazyBarChart data={managedProductChartData} barGap={4} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                      <LazyCartesianGrid strokeDasharray="3 3" stroke="#7B91B0" strokeOpacity={0.15} />
                      <LazyXAxis
                        dataKey="month"
                        tick={{ fill: '#ffffff', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <LazyYAxis
                        orientation="right"
                        width={45}
                        tick={{ fill: '#ffffff', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => value >= 1000 ? `₪${(value/1000).toFixed(0)}k` : `₪${value}`}
                      />
                      <LazyBar dataKey="target" fill="#0095FF" radius={[4, 4, 0, 0]} barSize={20} name="יעד" />
                      <LazyBar dataKey="actual" fill="#00E096" radius={[4, 4, 0, 0]} barSize={20} name="בפועל" />
                    </LazyBarChart>
                  </SafeChartContainer>
                </div>
                <div className="flex flex-row-reverse justify-center gap-6 mt-3">
                  <div className="flex flex-row-reverse items-center gap-2">
                    <span className="text-white text-[11px]">יעד</span>
                    <div className="w-[10px] h-[10px] bg-[#0095FF] rounded-[2px]"></div>
                  </div>
                  <div className="flex flex-row-reverse items-center gap-2">
                    <span className="text-white text-[11px]">בפועל</span>
                    <div className="w-[10px] h-[10px] bg-[#00E096] rounded-[2px]"></div>
                  </div>
                </div>
              </div>
              ) : null}
            </div>
            )}

            {/* המשימות שלי - Tasks Section - מוצג רק כשיש משימות */}
            {tasks.length > 0 && (
            <div className="bg-[#0f1535] rounded-[10px] p-[10px] mt-[15px]">
              {/* Header */}
              <div className="flex items-center justify-center mb-4">
                <h3 className="text-white text-[22px] font-semibold">המשימות שלי</h3>
              </div>

              {/* Table */}
              <div className="max-h-[300px] overflow-y-auto">
                {/* Table Header - RTL order: # | אחראי משימה | קטגוריה | תאריך לביצוע */}
                <div className="flex items-center justify-between gap-[3px] border-b border-[#7B91B0] pb-2 mb-2">
                  <div className="flex items-center gap-[10px]">
                    <span className="text-white text-[14px] w-[17px] text-center">#</span>
                    <span className="text-white text-[14px] w-[83px] text-right">אחראי משימה</span>
                  </div>
                  <span className="text-white text-[14px] w-[71px] text-center">קטגוריה</span>
                  <span className="text-white text-[14px] w-[80px] text-center">תאריך לביצוע</span>
                </div>

                {/* Task Rows */}
                <div className="flex flex-col gap-[2px]">
                  {tasks.map((task, index) => (
                    <div
                      key={task.id}
                      className={`flex flex-col py-[10px] ${index > 0 ? 'border-t-2 border-white/30' : ''}`}
                    >
                      {/* Row 1 - Main info - RTL order */}
                      <div className="flex items-center justify-between gap-[10px]">
                        <div className="flex items-center gap-[10px]">
                          <span className="text-[#7B91B0] text-[14px] font-semibold w-[17px] text-right ltr-num">
                            {task.number}
                          </span>
                          <span className={`text-[14px] font-semibold w-[75px] text-right ${task.isOverdue ? 'text-[#F64E60]' : 'text-white'}`}>
                            {task.assignee}
                          </span>
                        </div>
                        <span className={`text-[14px] flex-1 text-center ${task.isOverdue ? 'text-[#F64E60]' : 'text-white'}`}>
                          {task.category}
                        </span>
                        <span className={`text-[14px] font-semibold w-[80px] text-center ltr-num ${task.isOverdue ? 'text-[#F64E60]' : 'text-white'}`}>
                          {task.dueDate}
                        </span>
                      </div>

                      {/* Row 2 - Description and Status - RTL order */}
                      <div className="flex items-end justify-between mt-2 pl-[20px]">
                        <div className="flex-1 text-right">
                          <span className={`text-[14px] ${task.isOverdue ? 'text-[#F64E60]' : 'text-white'}`}>
                            <strong><u>תיאור משימה:</u></strong> {task.description}
                          </span>
                        </div>
                        <span
                          className={`text-[14px] font-semibold px-[7px] py-[3px] rounded-[7px] border ${task.status === 'בוצע' ? 'status-done' : 'status-todo'}`}
                        >
                          {task.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            )}

        </div>
      )}

      {/* Daily Entries Modal */}
      {realBusinessId && dateRange && (
        <DailyEntriesModal
          isOpen={isDailyEntriesModalOpen}
          onClose={() => setIsDailyEntriesModalOpen(false)}
          businessId={realBusinessId}
          businessName={businessCards.find(b => b.id === realBusinessId)?.name || ""}
          dateRange={dateRange}
        />
      )}

      {/* History Modal */}
      <HistoryModal
        isOpen={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        cardType={historyCardType}
        cardTitle={historyCardTitle}
        businessIds={selectedBusinesses}
        sourceId={historySourceId}
      />
    </div>
  );
}
