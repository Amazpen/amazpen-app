"use client";

import { useState, useEffect, useCallback } from "react";
import { useDashboard } from "../layout";
import { createClient } from "@/lib/supabase/client";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { usePersistedState } from "@/hooks/usePersistedState";

// Expense category data for display
interface ExpenseCategoryDisplay {
  id: string;
  name: string;
  target: string;
  actual: string;
  difference: string;
  remaining: string;
  diffRaw: number;
  subcategories: {
    name: string;
    target: string;
    actual: string;
    difference: string;
    remaining: string;
    diffRaw: number;
  }[];
}

// Summary data
interface ReportSummary {
  totalRevenue: number;
  revenueTarget: number;
  totalExpenses: number;
  expensesTarget: number;
  operatingProfit: number;
  operatingProfitPct: number;
  netProfit: number;
  netProfitPct: number;
}

// Format number for display
function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `₪${(value / 1000).toFixed(1)}K`;
  }
  return `₪${value.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDifference(value: number): string {
  const sign = value >= 0 ? "" : "";
  if (Math.abs(value) >= 1000) {
    return `₪${sign}${(value / 1000).toFixed(1)}K`;
  }
  return `₪${sign}${value.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatPercentage(value: number): string {
  const sign = value >= 0 ? "" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export default function ReportsPage() {
  const { selectedBusinesses } = useDashboard();
  const [selectedMonth, setSelectedMonth] = usePersistedState("reports:month", "");
  const [selectedYear, setSelectedYear] = usePersistedState("reports:year", "");
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isMounted, setIsMounted] = useState(false);

  // Initialize date values on client only (only if no saved value)
  useEffect(() => {
    if (!isMounted) {
      if (!selectedMonth) setSelectedMonth(String(new Date().getMonth() + 1).padStart(2, "0") + "_");
      if (!selectedYear) setSelectedYear(String(new Date().getFullYear()));
      setIsMounted(true);
    }
  }, [isMounted]);

  // Realtime subscription
  const handleRealtimeChange = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  useMultiTableRealtime(
    ["invoices", "expense_categories", "goals", "daily_entries", "supplier_budgets"],
    handleRealtimeChange,
    selectedBusinesses.length > 0
  );

  // Data from Supabase
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategoryDisplay[]>([]);
  const [summary, setSummary] = useState<ReportSummary>({
    totalRevenue: 0,
    revenueTarget: 0,
    totalExpenses: 0,
    expensesTarget: 0,
    operatingProfit: 0,
    operatingProfitPct: 0,
    netProfit: 0,
    netProfitPct: 0,
  });
  const [priorLiabilities, setPriorLiabilities] = useState(0);
  const [showPriorLiabilities, setShowPriorLiabilities] = useState(false);
  const [cashFlowForecast, setCashFlowForecast] = useState({ target: 0, actual: 0 });

  // Fetch data from Supabase
  useEffect(() => {
    const fetchData = async () => {
      const year = parseInt(selectedYear);
      const month = parseInt(selectedMonth.replace("_", ""));

      if (selectedBusinesses.length === 0 || isNaN(year) || isNaN(month)) {
        setExpenseCategories([]);
        return;
      }

      const supabase = createClient();

      try {
        // Fetch expense categories
        const { data: categoriesData } = await supabase
          .from("expense_categories")
          .select("id, name, parent_id")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .eq("is_active", true);

        // Fetch goals for targets
        const { data: goalsData } = await supabase
          .from("goals")
          .select("*")
          .in("business_id", selectedBusinesses)
          .eq("year", year)
          .eq("month", month)
          .is("deleted_at", null);

        // Fetch invoices for the month
        const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
        const endDate = new Date(year, month, 0).toISOString().split("T")[0];

        const { data: invoicesData } = await supabase
          .from("invoices")
          .select("subtotal, supplier:suppliers(expense_category_id)")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .eq("invoice_type", "current")
          .gte("invoice_date", startDate)
          .lte("invoice_date", endDate);

        // Fetch daily entries for revenue
        const { data: dailyEntries } = await supabase
          .from("daily_entries")
          .select("total_register")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .gte("entry_date", startDate)
          .lte("entry_date", endDate);

        // Fetch prior liabilities (payment splits due this month from payments created before this month)
        const { data: priorSplits } = await supabase
          .from("payment_splits")
          .select(`
            amount,
            payment:payments!inner(id, business_id, deleted_at, created_at)
          `)
          .gte("due_date", startDate)
          .lte("due_date", endDate)
          .is("payment.deleted_at", null)
          .in("payment.business_id", selectedBusinesses)
          .lt("payment.created_at", startDate);

        const totalPriorLiabilities = (priorSplits || []).reduce((sum, s) => sum + Number(s.amount || 0), 0);
        setPriorLiabilities(totalPriorLiabilities);

        // Fetch all payment splits due this month (cash flow forecast actual)
        const { data: allSplits } = await supabase
          .from("payment_splits")
          .select(`
            amount,
            payment:payments!inner(id, business_id, deleted_at)
          `)
          .gte("due_date", startDate)
          .lte("due_date", endDate)
          .is("payment.deleted_at", null)
          .in("payment.business_id", selectedBusinesses);

        const totalForecastActual = (allSplits || []).reduce((sum, s) => sum + Number(s.amount || 0), 0);

        // Calculate totals
        const totalRevenue = (dailyEntries || []).reduce((sum, d) => sum + Number(d.total_register || 0), 0);

        // Calculate actual totals by category
        const categoryActuals = new Map<string, number>();
        if (invoicesData) {
          for (const inv of invoicesData) {
            const supplier = inv.supplier as unknown as { expense_category_id: string | null } | null;
            const catId = supplier?.expense_category_id;
            if (catId) {
              const current = categoryActuals.get(catId) || 0;
              categoryActuals.set(catId, current + Number(inv.subtotal));
            }
          }
        }

        // Build expense categories display
        const goal = goalsData?.[0];
        const totalExpenses = Array.from(categoryActuals.values()).reduce((sum, val) => sum + val, 0);
        const expensesTarget = Number(goal?.current_expenses_target || 0);

        // Group categories by parent
        const parentCategories = (categoriesData || []).filter(c => !c.parent_id);
        const childCategories = (categoriesData || []).filter(c => c.parent_id);

        const displayCategories: ExpenseCategoryDisplay[] = parentCategories.map(parent => {
          const children = childCategories.filter(c => c.parent_id === parent.id);
          const childrenWithData = children.map(child => {
            const actual = categoryActuals.get(child.id) || 0;
            const target = 0; // Would need per-category budgets
            const diff = target - actual;
            const remaining = target > 0 ? ((target - actual) / target) * 100 : 0;

            return {
              name: child.name,
              target: formatCurrency(target),
              actual: formatCurrency(actual),
              difference: formatDifference(diff),
              remaining: formatPercentage(remaining),
              diffRaw: diff,
            };
          });

          // Sum up children for parent
          const parentActual = children.reduce((sum, c) => sum + (categoryActuals.get(c.id) || 0), 0) || categoryActuals.get(parent.id) || 0;
          const parentTarget = 0;
          const parentDiff = parentTarget - parentActual;
          const parentRemaining = parentTarget > 0 ? ((parentTarget - parentActual) / parentTarget) * 100 : 0;

          return {
            id: parent.id,
            name: parent.name,
            target: formatCurrency(parentTarget),
            actual: formatCurrency(parentActual),
            difference: formatDifference(parentDiff),
            remaining: formatPercentage(parentRemaining),
            diffRaw: parentDiff,
            subcategories: childrenWithData,
          };
        }).filter(cat => parseFloat(cat.actual.replace(/[₪K,]/g, "")) > 0 || cat.subcategories.length > 0);

        setExpenseCategories(displayCategories);

        // Calculate summary
        const operatingProfit = totalRevenue - totalExpenses;
        const operatingProfitPct = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0;

        setSummary({
          totalRevenue,
          revenueTarget: Number(goal?.revenue_target || 0),
          totalExpenses,
          expensesTarget,
          operatingProfit,
          operatingProfitPct,
          netProfit: operatingProfit,
          netProfitPct: operatingProfitPct,
        });

        // Cash flow forecast: target = revenue target - expenses target, actual = total splits due this month
        const forecastTarget = Number(goal?.revenue_target || 0) - expensesTarget;
        setCashFlowForecast({ target: forecastTarget, actual: totalForecastActual });

      } catch (error) {
        console.error("Error fetching reports data:", error);
      } finally {
      }
    };

    fetchData();
  }, [selectedBusinesses, selectedMonth, selectedYear, refreshTrigger]);

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) =>
      prev.includes(id) ? prev.filter((catId) => catId !== id) : [...prev, id]
    );
  };

  const months = [
    { value: "01_", label: "ינואר" },
    { value: "02_", label: "פברואר" },
    { value: "03_", label: "מרץ" },
    { value: "04_", label: "אפריל" },
    { value: "05_", label: "מאי" },
    { value: "06_", label: "יוני" },
    { value: "07_", label: "יולי" },
    { value: "08_", label: "אוגוסט" },
    { value: "09_", label: "ספטמבר" },
    { value: "10_", label: "אוקטובר" },
    { value: "11_", label: "נובמבר" },
    { value: "12_", label: "דצמבר" },
  ];

  // Show message if no business selected
  if (selectedBusinesses.length === 0) {
    return (
      <article className="text-white p-[10px] pb-[80px]">
        <div className="bg-[#0F1535] rounded-[20px] p-[40px] text-center">
          <p className="text-[20px] text-white/70">יש לבחור עסק כדי לצפות בדוחות</p>
        </div>
      </article>
    );
  }

  return (
    <article aria-label="דוח רווח והפסד" className="text-white p-[10px] pb-[80px] flex flex-col gap-[10px]">
      {/* Header Section - Title with Pig Icon */}
      <section aria-labelledby="report-title" className="bg-[#0F1535] rounded-[10px] p-[7px] min-h-[70px] flex items-center justify-start gap-[10px]">
        <div className="flex flex-row-reverse items-center gap-[3px]">
          <h1 id="report-title" className="text-[22px] font-bold text-center leading-[1.4]">סיכום תוצאות רווח והפסד</h1>
          {/* Pig Icon */}
          <svg width="22" height="22" viewBox="0 0 15 15" fill="none" className="flex-shrink-0" aria-hidden="true">
            <path fillRule="evenodd" clipRule="evenodd" d="M5.23877 4.32331C5.42468 3.69863 6.0038 3.24414 6.6875 3.24414C7.20053 3.24414 7.65408 3.49922 7.9282 3.89221C8.11919 4.16603 8.496 4.23317 8.76982 4.04218C9.04364 3.85118 9.11079 3.47438 8.91979 3.20056C8.42926 2.49731 7.6124 2.03516 6.6875 2.03516C5.45434 2.03516 4.4143 2.85523 4.08002 3.97844C3.98478 4.29843 4.16698 4.63502 4.48696 4.73025C4.80694 4.82548 5.14354 4.64329 5.23877 4.32331ZM3.09359 4.35159C3.37136 4.16639 3.44641 3.79108 3.26122 3.5133C3.07602 3.23553 2.70071 3.16048 2.42293 3.34567C1.74591 3.79705 1.4463 4.65416 1.58159 5.41523C1.68156 5.97761 2.01248 6.48027 2.56216 6.78484C2.30199 7.25893 2.15378 7.80355 2.15378 8.38232C2.15378 9.67506 2.89132 10.7943 3.96725 11.3443V12.3115C3.96725 12.6454 4.23789 12.916 4.57175 12.916H6.68747C7.02132 12.916 7.29196 12.6454 7.29196 12.3115V11.707H7.5942V12.3115C7.5942 12.6454 7.86484 12.916 8.19869 12.916H10.3144C10.6483 12.916 10.9189 12.6454 10.9189 12.3115V11.4802C11.5559 11.2315 12.0966 10.7925 12.4719 10.2335C13.1203 10.2115 13.6391 9.67898 13.6391 9.02525V7.73938C13.6391 7.08566 13.1203 6.55312 12.4719 6.5311C12.2221 6.15898 11.8991 5.84026 11.5234 5.59537V4.15088C11.5234 3.81702 11.2528 3.54638 10.9189 3.54638C9.80149 3.54638 9.07149 4.24163 8.48602 5.05761H5.47848C4.67542 5.05761 3.93815 5.34294 3.36377 5.81676C2.9648 5.69913 2.81421 5.44158 2.77191 5.20363C2.71022 4.85658 2.86394 4.5047 3.09359 4.35159ZM9.30615 5.99742C9.67682 5.44142 9.99047 5.09456 10.3144 4.91303V5.94486C10.3144 6.17436 10.4444 6.38406 10.6499 6.48619C11.0533 6.68667 11.3842 7.01261 11.5909 7.41248C11.6947 7.61327 11.9019 7.73938 12.1279 7.73938H12.4301L12.4301 9.02525H12.1279C11.9019 9.02525 11.6947 9.15136 11.5909 9.35215C11.3081 9.89916 10.794 10.3064 10.1806 10.4456C9.90533 10.5081 9.70992 10.7528 9.70992 11.0351V11.707H8.80319V11.4048C8.80319 10.904 8.39723 10.498 7.89645 10.498H6.98971C6.48894 10.498 6.08297 10.904 6.08297 11.4048V11.707H5.17624V10.9477C5.17624 10.6915 5.01474 10.4632 4.77319 10.3778C3.95063 10.0871 3.36276 9.30257 3.36276 8.38232C3.36276 7.80137 3.59611 7.27611 3.9756 6.89315C4.35968 6.50556 4.89061 6.2666 5.47848 6.2666H8.80319C9.0053 6.2666 9.19404 6.16558 9.30615 5.99742ZM10.0121 8.08007C10.3459 8.08007 10.6166 7.80943 10.6166 7.47558C10.6166 7.14173 10.3459 6.87109 10.0121 6.87109C9.67823 6.87109 9.40759 7.14173 9.40759 7.47558C9.40759 7.80943 9.67823 8.08007 10.0121 8.08007Z" fill="white"/>
          </svg>
        </div>
      </section>

      {/* Summary Card - Total Result + Filters */}
      <section aria-label="סיכום תוצאות" className="bg-[#0F1535] rounded-[10px] p-[7px] min-h-[70px] flex flex-col gap-[15px]">
        {/* Total Result Row */}
        <div className="flex flex-row-reverse items-center justify-between w-full min-h-[40px] gap-[3px]">
          <div className="flex flex-row-reverse items-center gap-[10px] flex-1">
            <span className="text-[18px] font-bold ltr-num">₪{summary.operatingProfit.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <div className="flex flex-row-reverse items-center gap-[2px] flex-1">
              <svg width="15" height="15" viewBox="0 0 32 32" fill="none" className={summary.operatingProfitPct > 0 ? "text-[#17DB4E]" : summary.operatingProfitPct < 0 ? "text-[#F64E60]" : "text-white"} aria-hidden="true">
                <path d={summary.operatingProfitPct >= 0 ? "M16 26V6M16 6L6 16M16 6L26 16" : "M16 6V26M16 26L6 16M16 26L26 16"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className={`text-[16px] font-bold ltr-num ${summary.operatingProfitPct > 0 ? "text-[#17DB4E]" : summary.operatingProfitPct < 0 ? "text-[#F64E60]" : "text-white"}`}>{summary.operatingProfitPct.toFixed(2)}%</span>
            </div>
          </div>
          <span className="text-[20px] font-bold leading-[1.4]">סה&quot;כ תוצאות רווח/הפסד</span>
        </div>

        {/* Date Filters Row */}
        <div className="flex flex-row-reverse items-center justify-between w-full min-h-[40px] gap-[10px]">
          <div className="flex-1 border border-[#4C526B] rounded-[7px] p-[5px] min-h-[50px] flex items-center justify-center">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              title="בחירת חודש"
              className="w-full bg-transparent text-[18px] font-bold text-center focus:outline-none cursor-pointer select-dark"
            >
              <option value="" disabled>בחר/י חודש</option>
              {months.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 border border-[#4C526B] rounded-[7px] p-[5px] min-h-[50px] flex items-center justify-center">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              title="בחירת שנה"
              className="w-full bg-transparent text-[18px] font-bold text-center focus:outline-none cursor-pointer select-dark"
            >
              <option value="" disabled>בחר/י שנה</option>
              <option value="2025">2025</option>
              <option value="2026">2026</option>
            </select>
          </div>
        </div>
      </section>

      {/* Income Summary Card */}
      <section aria-label="סיכום הכנסות" className="bg-[#2C3595] rounded-[10px] p-[7px] min-h-[80px] flex flex-row-reverse items-center justify-between">
        <div className="flex flex-row-reverse items-center gap-[5px]">
          <div className="flex flex-col items-center w-[62px]">
            <span className="text-[14px] font-medium leading-[1.4]">הפרש ב-%</span>
            <span className={`text-[15px] font-bold ltr-num leading-[1.4] ${summary.totalRevenue - summary.revenueTarget > 0 ? "text-[#17DB4E]" : summary.totalRevenue - summary.revenueTarget < 0 ? "text-[#F64E60]" : "text-white"}`}>
              {summary.revenueTarget > 0 ? ((summary.totalRevenue / summary.revenueTarget) * 100).toFixed(2) : "0.00"}%
            </span>
          </div>
          <div className="flex flex-col items-center w-[65px]">
            <span className="text-[14px] font-medium leading-[1.4]">הפרש ב-₪</span>
            <span className={`text-[15px] font-bold ltr-num leading-[1.4] ${summary.totalRevenue - summary.revenueTarget > 0 ? "text-[#17DB4E]" : summary.totalRevenue - summary.revenueTarget < 0 ? "text-[#F64E60]" : "text-white"}`}>
              {formatCurrency(summary.totalRevenue - summary.revenueTarget)}
            </span>
          </div>
          <div className="flex flex-col items-center w-[62px]">
            <span className="text-[14px] font-medium leading-[1.4]">בפועל</span>
            <span className="text-[15px] font-bold ltr-num leading-[1.4]">{formatCurrency(summary.totalRevenue)}</span>
          </div>
          <div className="flex flex-col items-center w-[62px]">
            <span className="text-[14px] font-medium leading-[1.4]">יעד</span>
            <span className="text-[15px] font-bold ltr-num leading-[1.4]">{formatCurrency(summary.revenueTarget)}</span>
          </div>
        </div>
        <span className="text-[16px] font-bold text-right leading-[1.4] w-[77px]">סה&quot;כ הכנסות ללא מע&quot;מ</span>
      </section>

      {/* Expenses Section */}
      <section id="onboarding-reports-categories" aria-label="פירוט הוצאות" className="bg-[#0F1535] rounded-[10px] p-[7px_0_7px_0] min-h-[40px] flex flex-col">
        {/* Header Row */}
        <div className="flex items-center justify-end min-h-[40px] gap-[10px] px-[7px] mb-[15px]">
          <span className="text-[20px] font-bold leading-[1.4]">פירוט ההוצאות</span>
        </div>

        {/* Table Header */}
        <div className="flex flex-row-reverse items-center justify-between min-h-[50px] border-b-2 border-white/15 p-[5px] gap-[5px]">
          <div className="flex flex-row-reverse items-center gap-[5px]">
            <span className="text-[14px] font-semibold w-[60px] text-center leading-[1.4]">נותר לניצול</span>
            <span className="text-[14px] font-medium w-[62px] text-center leading-[1.4]">הפרש ב-₪</span>
            <span className="text-[14px] font-medium w-[62px] text-center leading-[1.4]">בפועל</span>
            <span className="text-[14px] font-medium w-[62px] text-center leading-[1.4]">יעד</span>
          </div>
          <div className="flex items-center justify-end w-[76px]">
            <span className="text-[14px] font-medium text-right leading-[1.4] mr-[14px]">שם ההוצאה</span>
          </div>
        </div>

        {/* Expense Categories */}
        <div className="flex flex-col mt-[5px]">
          {expenseCategories.length === 0 ? (
            <div className="flex items-center justify-center py-[40px]">
              <span className="text-[16px] text-white/50">אין נתוני הוצאות להצגה</span>
            </div>
          ) : expenseCategories.map((category) => (
            <div key={category.id} className="rounded-[10px]">
              {/* Category Row */}
              <button
                type="button"
                onClick={() => toggleCategory(category.id)}
                className={`flex flex-row-reverse items-center justify-between w-full min-h-[60px] p-[5px] gap-[5px] border-b-2 border-white/15 hover:bg-[#29318A]/30 transition-all cursor-pointer ${
                  expandedCategories.includes(category.id) ? 'rounded-t-[10px]' : ''
                }`}
              >
                <div className="flex flex-row-reverse items-center gap-[5px]">
                  <span className={`text-[14px] font-bold w-[60px] text-center ltr-num leading-[1.4] ${category.diffRaw > 0 ? 'text-[#17DB4E]' : category.diffRaw < 0 ? 'text-[#F64E60]' : 'text-white'}`}>
                    {category.remaining}
                  </span>
                  <span className={`text-[14px] font-bold w-[62px] text-center ltr-num leading-[1.4] ${category.diffRaw > 0 ? 'text-[#17DB4E]' : category.diffRaw < 0 ? 'text-[#F64E60]' : 'text-white'}`}>
                    {category.difference}
                  </span>
                  <span className="text-[14px] font-bold w-[62px] text-center ltr-num leading-[1.4]">
                    {category.actual}
                  </span>
                  <span className="text-[14px] font-bold w-[62px] text-center ltr-num leading-[1.4]">
                    {category.target}
                  </span>
                </div>
                <div className="flex flex-row-reverse items-center justify-end gap-[5px] w-[95px]">
                  <span className="text-[14px] font-bold text-right leading-[1.4]">{category.name}</span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 32 32"
                    fill="none"
                    aria-hidden="true"
                    className={`flex-shrink-0 transition-transform ${expandedCategories.includes(category.id) ? 'rotate-180' : ''}`}
                  >
                    <path d="M8 12L16 20L24 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </button>

              {/* Subcategories */}
              {expandedCategories.includes(category.id) && (
                <div className="bg-[#1A2150] rounded-b-[10px] mx-[5px] mb-[5px]">
                  {category.subcategories.map((sub, index) => (
                    <div
                      key={index}
                      className={`flex flex-row-reverse items-center justify-between min-h-[50px] p-[5px] gap-[5px] ${
                        index < category.subcategories.length - 1 ? 'border-b border-white/10' : ''
                      }`}
                    >
                      <div className="flex flex-row-reverse items-center gap-[5px]">
                        <span className={`text-[13px] font-medium w-[60px] text-center ltr-num leading-[1.4] ${sub.diffRaw > 0 ? 'text-[#17DB4E]' : sub.diffRaw < 0 ? 'text-[#F64E60]' : 'text-white'}`}>
                          {sub.remaining}
                        </span>
                        <span className={`text-[13px] font-medium w-[62px] text-center ltr-num leading-[1.4] ${sub.diffRaw > 0 ? 'text-[#17DB4E]' : sub.diffRaw < 0 ? 'text-[#F64E60]' : 'text-white'}`}>
                          {sub.difference}
                        </span>
                        <span className="text-[13px] font-medium w-[62px] text-center ltr-num leading-[1.4]">
                          {sub.actual}
                        </span>
                        <span className="text-[13px] font-medium w-[62px] text-center ltr-num leading-[1.4]">
                          {sub.target}
                        </span>
                      </div>
                      <span className="text-[13px] font-medium text-right text-white/80 leading-[1.4]">{sub.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Total Expenses Row */}
        <div className="flex flex-row-reverse items-center justify-between bg-[#2C3595] rounded-[10px] p-[7px] mt-[10px] min-h-[60px]">
          <div className="flex flex-row-reverse items-center gap-[5px]">
            <span className={`text-[15px] font-bold w-[60px] text-center ltr-num leading-[1.4] ${summary.expensesTarget - summary.totalExpenses > 0 ? "text-[#17DB4E]" : summary.expensesTarget - summary.totalExpenses < 0 ? "text-[#F64E60]" : "text-white"}`}>
              {summary.expensesTarget > 0 ? (((summary.expensesTarget - summary.totalExpenses) / summary.expensesTarget) * 100).toFixed(2) : "0.00"}%
            </span>
            <span className={`text-[15px] font-bold w-[62px] text-center ltr-num leading-[1.4] ${summary.expensesTarget - summary.totalExpenses > 0 ? "text-[#17DB4E]" : summary.expensesTarget - summary.totalExpenses < 0 ? "text-[#F64E60]" : "text-white"}`}>
              {formatDifference(summary.expensesTarget - summary.totalExpenses)}
            </span>
            <span className="text-[15px] font-bold w-[62px] text-center ltr-num leading-[1.4]">{formatCurrency(summary.totalExpenses)}</span>
            <span className="text-[15px] font-bold w-[62px] text-center ltr-num leading-[1.4]">{formatCurrency(summary.expensesTarget)}</span>
          </div>
          <span className="text-[18px] font-bold text-right leading-[1.4]">סה&quot;כ הוצאות</span>
        </div>
      </section>

      {/* Total Profit/Loss Summary */}
      <section aria-label="סיכום רווח והפסד" className="bg-[#2C3595] rounded-[10px] p-[7px] min-h-[70px] flex flex-row-reverse items-center justify-between gap-[5px]">
        <div className="flex flex-row-reverse items-center gap-[5px]">
          <div className="flex flex-col items-center w-[62px]">
            <span className={`text-[14px] font-bold ltr-num leading-[1.4] ${summary.operatingProfit - (summary.revenueTarget - summary.expensesTarget) > 0 ? "text-[#17DB4E]" : summary.operatingProfit - (summary.revenueTarget - summary.expensesTarget) < 0 ? "text-[#F64E60]" : "text-white"}`}>
              {(summary.revenueTarget - summary.expensesTarget) !== 0
                ? (((summary.operatingProfit - (summary.revenueTarget - summary.expensesTarget)) / Math.abs(summary.revenueTarget - summary.expensesTarget)) * 100).toFixed(2)
                : "0.00"}%
            </span>
          </div>
          <div className="flex flex-col items-center w-[62px]">
            <span className={`text-[14px] font-bold ltr-num leading-[1.4] ${summary.operatingProfit - (summary.revenueTarget - summary.expensesTarget) > 0 ? "text-[#17DB4E]" : summary.operatingProfit - (summary.revenueTarget - summary.expensesTarget) < 0 ? "text-[#F64E60]" : "text-white"}`}>
              {formatCurrency(summary.operatingProfit - (summary.revenueTarget - summary.expensesTarget))}
            </span>
          </div>
          <div className="flex flex-col items-center w-[57px]">
            <span className="text-[14px] font-bold ltr-num leading-[1.4]">{formatCurrency(summary.operatingProfit)}</span>
            <span className={`text-[14px] font-semibold ltr-num leading-[1.4] ${summary.operatingProfitPct > 0 ? "text-[#17DB4E]" : summary.operatingProfitPct < 0 ? "text-[#F64E60]" : "text-white"}`}>
              {summary.operatingProfitPct.toFixed(1)}%
            </span>
          </div>
          <div className="flex flex-col items-center w-[57px]">
            <span className="text-[14px] font-bold ltr-num leading-[1.4]">{formatCurrency(summary.revenueTarget - summary.expensesTarget)}</span>
            <span className={`text-[14px] font-semibold ltr-num leading-[1.4] ${summary.revenueTarget > 0 ? "text-[#17DB4E]" : "text-white"}`}>
              {summary.revenueTarget > 0 ? (((summary.revenueTarget - summary.expensesTarget) / summary.revenueTarget) * 100).toFixed(1) : "0.0"}%
            </span>
          </div>
        </div>
        <span className="text-[18px] font-bold text-right leading-[1.4] w-[77px]">סה&quot;כ רווח / הפסד</span>
      </section>

      {/* Prior Liabilities */}
      <section aria-label="התחייבויות קודמות" className="bg-[#2C3595] rounded-[10px] p-[7px] min-h-[70px] flex flex-row-reverse items-center justify-between gap-[5px]">
        <div className="flex flex-row-reverse items-center gap-[5px]">
          <span className="text-[15px] font-bold ltr-num leading-[1.4] w-[60px] text-center invisible">
            {formatCurrency(priorLiabilities)}
          </span>
          <span className="text-[15px] font-bold ltr-num leading-[1.4] w-[62px] text-center invisible">
            {formatCurrency(priorLiabilities)}
          </span>
          <span className={`text-[15px] font-bold ltr-num leading-[1.4] w-[62px] text-center ${priorLiabilities > 0 ? "text-[#F64E60]" : "text-white"}`}>
            {formatCurrency(priorLiabilities)}
          </span>
          <span className={`text-[15px] font-bold ltr-num leading-[1.4] w-[62px] text-center ${priorLiabilities > 0 ? "text-[#F64E60]" : "text-white"}`}>
            {formatCurrency(priorLiabilities)}
          </span>
        </div>
        <span className="text-[18px] font-bold text-right leading-[1.4]">התחייבויות קודמות</span>
      </section>

      {/* Cash Flow Forecast */}
      <section aria-label="צפי תזרים" className="bg-[#2C3595] rounded-[10px] p-[7px] min-h-[70px] flex flex-row-reverse items-center justify-between gap-[5px] mb-[25px]">
        <div className="flex flex-row-reverse items-center gap-[5px]">
          <span className="w-[60px]" />
          <div className="flex flex-col items-center w-[62px]">
            <span className="text-[14px] font-medium leading-[1.4] text-center">הפרש ב-₪</span>
            <span className={`text-[15px] font-bold ltr-num leading-[1.4] text-center ${cashFlowForecast.actual - cashFlowForecast.target > 0 ? "text-[#17DB4E]" : cashFlowForecast.actual - cashFlowForecast.target < 0 ? "text-[#F64E60]" : "text-white"}`}>
              {formatCurrency(cashFlowForecast.actual - cashFlowForecast.target)}
            </span>
          </div>
          <div className="flex flex-col items-center w-[62px]">
            <span className="text-[14px] font-medium leading-[1.4] text-center">בפועל</span>
            <span className={`text-[15px] font-bold ltr-num leading-[1.4] text-center ${cashFlowForecast.actual > 0 ? "text-[#17DB4E]" : cashFlowForecast.actual < 0 ? "text-[#F64E60]" : "text-white"}`}>
              {formatCurrency(cashFlowForecast.actual)}
            </span>
          </div>
          <div className="flex flex-col items-center w-[62px]">
            <span className="text-[14px] font-medium leading-[1.4] text-center">יעד</span>
            <span className={`text-[15px] font-bold ltr-num leading-[1.4] text-center ${cashFlowForecast.target > 0 ? "text-[#17DB4E]" : cashFlowForecast.target < 0 ? "text-[#F64E60]" : "text-white"}`}>
              {formatCurrency(cashFlowForecast.target)}
            </span>
          </div>
        </div>
        <span className="text-[18px] font-bold text-right leading-[1.4]">צפי תזרים</span>
      </section>
    </article>
  );
}
