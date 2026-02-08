"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useDashboard } from "../layout";
import { createClient } from "@/lib/supabase/client";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";

// Types
type TabType = "vs-goods" | "vs-current" | "kpi";

interface GoalItem {
  id: string;
  name: string;
  target: number;
  actual: number;
  unit?: string; // ₪ or %
  editable?: boolean;
}

// Hebrew months
const hebrewMonths = [
  { value: "01", label: "ינואר" },
  { value: "02", label: "פברואר" },
  { value: "03", label: "מרץ" },
  { value: "04", label: "אפריל" },
  { value: "05", label: "מאי" },
  { value: "06", label: "יוני" },
  { value: "07", label: "יולי" },
  { value: "08", label: "אוגוסט" },
  { value: "09", label: "ספטמבר" },
  { value: "10", label: "אוקטובר" },
  { value: "11", label: "נובמבר" },
  { value: "12", label: "דצמבר" },
];

// Computed inside component via useMemo to avoid hydration mismatch
// (moved from module level)

// Progress bar component
function ProgressBar({ percentage, reverse = false }: { percentage: number; reverse?: boolean }) {
  const clampedPercentage = Math.min(100, Math.max(0, percentage));

  // Map percentage to Tailwind width classes
  const getWidthClass = (pct: number): string => {
    if (pct <= 0) return "w-0";
    if (pct <= 5) return "w-[5%]";
    if (pct <= 10) return "w-[10%]";
    if (pct <= 15) return "w-[15%]";
    if (pct <= 20) return "w-[20%]";
    if (pct <= 25) return "w-1/4";
    if (pct <= 30) return "w-[30%]";
    if (pct <= 33) return "w-1/3";
    if (pct <= 40) return "w-[40%]";
    if (pct <= 50) return "w-1/2";
    if (pct <= 60) return "w-[60%]";
    if (pct <= 66) return "w-2/3";
    if (pct <= 70) return "w-[70%]";
    if (pct <= 75) return "w-3/4";
    if (pct <= 80) return "w-[80%]";
    if (pct <= 85) return "w-[85%]";
    if (pct <= 90) return "w-[90%]";
    if (pct <= 95) return "w-[95%]";
    return "w-full";
  };

  return (
    <div
      className={`w-[85px] h-[13px] bg-white/50 rounded-full border border-[#211A66] overflow-hidden ${reverse ? "rotate-180" : ""}`}
    >
      <div
        className={`h-full bg-[#29318A] transition-all duration-300 ${getWidthClass(clampedPercentage)}`}
      />
    </div>
  );
}

// Status indicator based on percentage
function getStatusColor(percentage: number, isExpense: boolean = true): string {
  if (isExpense) {
    // For expenses: under budget is good (green), over is bad (red)
    if (percentage <= 100) return "text-[#17DB4E]";
    return "text-[#F64E60]";
  } else {
    // For revenue/KPI: meeting target is good
    if (percentage >= 100) return "text-[#17DB4E]";
    if (percentage >= 80) return "text-[#FFCF00]";
    return "text-[#F64E60]";
  }
}

// Format currency - show full number with comma separators
function formatCurrency(amount: number): string {
  return `₪${Math.round(amount).toLocaleString("en-US")}`;
}

// Format percentage - show whole number if no decimal, otherwise show up to 2 decimals
function formatPercent(value: number): string {
  if (Number.isInteger(value) || value % 1 === 0) {
    return `${Math.round(value)}%`;
  }
  const formatted = value.toFixed(2);
  return `${parseFloat(formatted)}%`;
}

// Format difference
function formatDiff(diff: number, unit: string = "₪"): string {
  const sign = diff >= 0 ? "+" : "";
  if (unit === "%") {
    if (Number.isInteger(diff) || diff % 1 === 0) {
      return `${sign}${Math.round(diff)}%`;
    }
    return `${sign}${parseFloat(diff.toFixed(2))}%`;
  }
  return `${sign}${formatCurrency(diff)}`;
}

export default function GoalsPage() {
  const { selectedBusinesses } = useDashboard();
  const [activeTab, setActiveTab] = useState<TabType>("vs-current");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isMounted, setIsMounted] = useState(false);

  // Year options for the dropdown (computed client-side after mount)
  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [String(y), String(y + 1)];
  }, []);

  // Initialize date values on client only
  useEffect(() => {
    if (!isMounted) {
      setSelectedMonth(String(new Date().getMonth() + 1).padStart(2, "0"));
      setSelectedYear(String(new Date().getFullYear()));
      setIsMounted(true);
    }
  }, [isMounted]);

  // Realtime subscription
  const handleRealtimeChange = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  useMultiTableRealtime(
    ["goals", "supplier_budgets", "invoices", "daily_entries", "expense_categories", "suppliers"],
    handleRealtimeChange,
    selectedBusinesses.length > 0
  );

  // Data from Supabase
  const [currentExpensesData, setCurrentExpensesData] = useState<GoalItem[]>([]);
  const [goodsPurchaseData, setGoodsPurchaseData] = useState<GoalItem[]>([]);
  const [kpiData, setKpiData] = useState<GoalItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch data from Supabase
  useEffect(() => {
    const fetchData = async () => {
      const year = parseInt(selectedYear);
      const month = parseInt(selectedMonth);

      if (selectedBusinesses.length === 0 || isNaN(year) || isNaN(month)) {
        setCurrentExpensesData([]);
        setGoodsPurchaseData([]);
        setKpiData([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const supabase = createClient();

      // Date range for the month
      const startDate = `${year}-${selectedMonth}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${selectedMonth}-${String(lastDay).padStart(2, "0")}`;

      try {
        // ============================================
        // 1. Fetch goals for the selected year/month
        // ============================================
        const { data: goalsData } = await supabase
          .from("goals")
          .select("*")
          .in("business_id", selectedBusinesses)
          .eq("year", year)
          .eq("month", month)
          .is("deleted_at", null);

        const goal = goalsData?.[0];

        // ============================================
        // 2. Fetch expense categories for "יעד VS שוטפות"
        // ============================================
        const { data: categoriesData } = await supabase
          .from("expense_categories")
          .select("id, name, business_id, parent_id")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .eq("is_active", true)
          .order("display_order");

        // ============================================
        // 3. Fetch supplier budgets for target amounts
        // ============================================
        const { data: supplierBudgetsData } = await supabase
          .from("supplier_budgets")
          .select("supplier_id, budget_amount")
          .in("business_id", selectedBusinesses)
          .eq("year", year)
          .eq("month", month)
          .is("deleted_at", null);

        // ============================================
        // 4. Fetch suppliers with their expense_category_id
        // ============================================
        const { data: suppliersData } = await supabase
          .from("suppliers")
          .select("id, name, expense_category_id, expense_type")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .eq("is_active", true);

        // Build supplier -> category mapping and supplier -> budget mapping
        const supplierCategoryMap = new Map<string, string>();
        const supplierExpenseTypeMap = new Map<string, string>();
        (suppliersData || []).forEach(s => {
          if (s.expense_category_id) {
            supplierCategoryMap.set(s.id, s.expense_category_id);
          }
          if (s.expense_type) {
            supplierExpenseTypeMap.set(s.id, s.expense_type);
          }
        });

        const supplierBudgetMap = new Map<string, number>();
        (supplierBudgetsData || []).forEach(b => {
          supplierBudgetMap.set(b.supplier_id, Number(b.budget_amount) || 0);
        });

        // ============================================
        // 5. Fetch invoices for actual amounts
        // ============================================
        const { data: invoicesData } = await supabase
          .from("invoices")
          .select("supplier_id, subtotal, invoice_type")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .gte("invoice_date", startDate)
          .lte("invoice_date", endDate);

        // Aggregate invoices by category for current expenses
        const categoryActuals = new Map<string, number>();
        const categoryTargets = new Map<string, number>();

        // Initialize with 0 for all categories
        (categoriesData || []).forEach(cat => {
          categoryActuals.set(cat.id, 0);
          categoryTargets.set(cat.id, 0);
        });

        // Sum up invoices by category (only 'current' type)
        (invoicesData || []).filter(inv => inv.invoice_type === "current").forEach(inv => {
          const catId = supplierCategoryMap.get(inv.supplier_id);
          if (catId) {
            const current = categoryActuals.get(catId) || 0;
            categoryActuals.set(catId, current + Number(inv.subtotal));
          }
        });

        // Sum up budgets by category
        (suppliersData || []).forEach(supplier => {
          const catId = supplier.expense_category_id;
          const budget = supplierBudgetMap.get(supplier.id) || 0;
          if (catId && budget > 0) {
            const current = categoryTargets.get(catId) || 0;
            categoryTargets.set(catId, current + budget);
          }
        });

        // Build current expenses data (only parent categories, or all if no hierarchy)
        const currentData: GoalItem[] = (categoriesData || [])
          .filter(cat => !cat.parent_id) // Only top-level categories
          .map((cat) => {
            // Sum children if any
            const childCats = (categoriesData || []).filter(c => c.parent_id === cat.id);
            let totalActual = categoryActuals.get(cat.id) || 0;
            let totalTarget = categoryTargets.get(cat.id) || 0;

            childCats.forEach(child => {
              totalActual += categoryActuals.get(child.id) || 0;
              totalTarget += categoryTargets.get(child.id) || 0;
            });

            return {
              id: cat.id,
              name: cat.name,
              target: totalTarget,
              actual: totalActual,
              unit: "₪",
            };
          });
        setCurrentExpensesData(currentData);

        // ============================================
        // 6. Build goods purchase data
        // ============================================
        // Sum up invoices for goods
        const goodsActuals = new Map<string, number>();
        const goodsNames = new Map<string, string>();

        (invoicesData || []).filter(inv => inv.invoice_type === "goods").forEach(inv => {
          const current = goodsActuals.get(inv.supplier_id) || 0;
          goodsActuals.set(inv.supplier_id, current + Number(inv.subtotal));
          const supplier = (suppliersData || []).find(s => s.id === inv.supplier_id);
          if (supplier) {
            goodsNames.set(inv.supplier_id, supplier.name);
          }
        });

        // Get all goods suppliers with their budgets
        const goodsSuppliers = (suppliersData || []).filter(s => s.expense_type === "goods");

        const goodsData: GoalItem[] = goodsSuppliers.map(supplier => ({
          id: supplier.id,
          name: supplier.name,
          target: supplierBudgetMap.get(supplier.id) || 0,
          actual: goodsActuals.get(supplier.id) || 0,
          unit: "₪",
        }));

        // Add total row if there are multiple suppliers
        if (goodsData.length > 1) {
          const totalTarget = goodsData.reduce((sum, g) => sum + g.target, 0);
          const totalActual = goodsData.reduce((sum, g) => sum + g.actual, 0);
          goodsData.unshift({
            id: "goods-total",
            name: 'סה"כ קניות סחורה',
            target: Number(goal?.goods_expenses_target) || totalTarget,
            actual: totalActual,
            unit: "₪",
          });
        } else if (goodsData.length === 0) {
          // Show total even if no specific suppliers
          const totalActual = (invoicesData || [])
            .filter(inv => inv.invoice_type === "goods")
            .reduce((sum, inv) => sum + Number(inv.subtotal), 0);
          goodsData.push({
            id: "goods-total",
            name: 'סה"כ קניות סחורה',
            target: Number(goal?.goods_expenses_target) || 0,
            actual: totalActual,
            unit: "₪",
          });
        }

        setGoodsPurchaseData(goodsData);

        // ============================================
        // 7. Build KPI data from goals + daily_entries
        // ============================================
        const { data: dailyEntries } = await supabase
          .from("daily_entries")
          .select("total_register, labor_cost")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .gte("entry_date", startDate)
          .lte("entry_date", endDate);

        // Calculate totals from daily entries
        const totalRevenue = (dailyEntries || []).reduce((sum, d) => sum + Number(d.total_register || 0), 0);
        const totalLaborCost = (dailyEntries || []).reduce((sum, d) => sum + Number(d.labor_cost || 0), 0);

        // Calculate food cost from goods invoices
        const totalGoodsCost = (invoicesData || [])
          .filter(inv => inv.invoice_type === "goods")
          .reduce((sum, inv) => sum + Number(inv.subtotal), 0);

        // Calculate current expenses total
        const totalCurrentExpenses = (invoicesData || [])
          .filter(inv => inv.invoice_type === "current")
          .reduce((sum, inv) => sum + Number(inv.subtotal), 0);

        // Calculate percentages
        const laborPct = totalRevenue > 0 ? (totalLaborCost / totalRevenue) * 100 : 0;
        const foodPct = totalRevenue > 0 ? (totalGoodsCost / totalRevenue) * 100 : 0;

        const kpiItems: GoalItem[] = [
          {
            id: "revenue",
            name: "הכנסות ברוטו",
            target: Number(goal?.revenue_target) || 0,
            actual: totalRevenue,
            unit: "₪",
            editable: true,
          },
          {
            id: "labor-pct",
            name: "עלות עובדים",
            target: Number(goal?.labor_cost_target_pct) || 0,
            actual: laborPct,
            unit: "%",
            editable: true,
          },
          {
            id: "food-pct",
            name: "עלות מכר",
            target: Number(goal?.food_cost_target_pct) || 0,
            actual: foodPct,
            unit: "%",
            editable: true,
          },
          {
            id: "current-expenses",
            name: "הוצאות שוטפות",
            target: Number(goal?.current_expenses_target) || 0,
            actual: totalCurrentExpenses,
            unit: "₪",
            editable: false,
          },
          {
            id: "goods-expenses",
            name: "קניות סחורה",
            target: Number(goal?.goods_expenses_target) || 0,
            actual: totalGoodsCost,
            unit: "₪",
            editable: false,
          },
        ];
        setKpiData(kpiItems);

      } catch (error) {
        console.error("Error fetching goals data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [selectedBusinesses, selectedMonth, selectedYear, refreshTrigger]);

  // Get data based on active tab
  const getData = (): GoalItem[] => {
    switch (activeTab) {
      case "vs-goods":
        return goodsPurchaseData;
      case "vs-current":
        return currentExpensesData;
      case "kpi":
        return kpiData;
      default:
        return currentExpensesData;
    }
  };

  const data = getData();

  // Handle KPI target change
  const handleTargetChange = (id: string, newTarget: string) => {
    const numValue = parseFloat(newTarget) || 0;
    setKpiData(prev => prev.map(item =>
      item.id === id ? { ...item, target: numValue } : item
    ));
  };

  // Show message if no business selected
  if (selectedBusinesses.length === 0) {
    return (
      <div className="text-white p-[10px] pb-[80px]" dir="rtl">
        <div className="bg-[#0F1535] rounded-[20px] p-[40px] text-center">
          <p className="text-[20px] text-white/70">יש לבחור עסק כדי לצפות ביעדים</p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-white p-[10px] pb-[80px]" dir="rtl">
      {/* Main Container */}
      <div className="bg-[#0F1535] rounded-[10px] p-[5px]">

        {/* Tab Navigation */}
        <div className="flex flex-row-reverse h-[55px] mb-[10px]">
          {/* Tab 1: יעד VS קניות סחורה (leftmost in RTL = rightmost visually) */}
          <button
            type="button"
            onClick={() => setActiveTab("vs-goods")}
            className={`flex-1 flex items-center justify-center transition-colors duration-200 rounded-l-[7px] ${
              activeTab === "vs-goods"
                ? "bg-[#29318A] text-white border-[#29318A]"
                : "text-[#6B6B6B] hover:bg-[#29318A]/20 border-[#6B6B6B]"
            } ${activeTab !== "vs-goods" ? "border-y border-l" : ""}`}
          >
            <span className="text-[16px] font-semibold">יעד VS קניות סחורה</span>
          </button>

          {/* Tab 2: יעד VS שוטפות (middle) */}
          <button
            type="button"
            onClick={() => setActiveTab("vs-current")}
            className={`flex-1 flex items-center justify-center transition-colors duration-200 ${
              activeTab === "vs-current"
                ? "bg-[#29318A] text-white"
                : "text-[#6B6B6B] hover:bg-[#29318A]/20 border-y border-[#6B6B6B]"
            }`}
          >
            <span className="text-[16px] font-semibold">יעד VS שוטפות</span>
          </button>

          {/* Tab 3: יעדי KPI (rightmost in RTL = leftmost visually) */}
          <button
            type="button"
            onClick={() => setActiveTab("kpi")}
            className={`flex-1 flex items-center justify-center transition-colors duration-200 rounded-r-[7px] ${
              activeTab === "kpi"
                ? "bg-[#29318A] text-white border-[#29318A]"
                : "text-[#6B6B6B] hover:bg-[#29318A]/20 border-[#6B6B6B]"
            } ${activeTab !== "kpi" ? "border-y border-r" : ""}`}
          >
            <span className="text-[16px] font-semibold">יעדי KPI</span>
          </button>
        </div>

        {/* Month & Year Selectors */}
        <div className="flex flex-row-reverse justify-start gap-[10px] mt-[10px]">
          {/* Month Selector */}
          <div className="flex-1 flex flex-col gap-[3px]">
            <label className="text-[14px] text-white text-right">בחר/י חודש:</label>
            <div className="border border-[#4C526B] rounded-[7px] p-[5px]">
              <select
                title="בחר חודש"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full bg-transparent text-white text-[14px] font-semibold text-center border-none outline-none cursor-pointer"
              >
                {hebrewMonths.map((month) => (
                  <option key={month.value} value={month.value} className="bg-[#0F1535] text-white">
                    {month.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Year Selector */}
          <div className="flex-1 flex flex-col gap-[3px]">
            <label className="text-[14px] text-white text-right">בחר/י שנה:</label>
            <div className="border border-[#4C526B] rounded-[7px] p-[5px]">
              <select
                title="בחר שנה"
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="w-full bg-transparent text-white text-[14px] font-semibold text-center border-none outline-none cursor-pointer"
              >
                {years.map((year) => (
                  <option key={year} value={year} className="bg-[#0F1535] text-white">
                    {year}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Goals List */}
        <div className="mt-[15px]" dir="ltr">
          {/* Table Header */}
          <div className="flex flex-row items-center justify-between gap-[5px] border-b border-white/15 p-[7px_7px_5px]">
            <div className="flex flex-row items-center gap-[7px]">
              <span className="w-[85px] text-[14px] font-light text-white text-center">מצב</span>
              <span className="w-[80px] text-[14px] font-light text-white text-center">בפועל</span>
              <span className="w-[80px] text-[14px] font-light text-white text-center">יעד</span>
            </div>
            <div className="flex-1 text-[14px] font-light text-white text-right">
              {activeTab === "kpi" ? "שם היעד" : "קטגוריה"}
            </div>
          </div>

          {/* Loading State */}
          {isLoading ? (
            <div className="flex items-center justify-center py-[40px]">
              <div className="text-white/70">טוען נתונים...</div>
            </div>
          ) : (
            /* Goal Items */
            <div className="flex flex-col">
              {data.length === 0 ? (
                <div className="flex items-center justify-center py-[40px]">
                  <span className="text-[16px] text-white/50">אין נתונים להצגה</span>
                </div>
              ) : data.map((item) => {
                const percentage = item.target > 0 ? (item.actual / item.target) * 100 : 0;
                const diff = item.target - item.actual; // Positive means under budget (good for expenses)
                const isKpi = activeTab === "kpi";
                const isRevenueType = item.name.includes("הכנסות");
                const statusColor = getStatusColor(percentage, !isRevenueType);

                return (
                  <div key={item.id} className="flex flex-col">
                    {/* Main Row */}
                    <div className="flex flex-row items-center justify-between gap-[5px] border-b border-white/10 p-[7px] min-h-[50px]">
                      {/* Progress/Status - left side */}
                      <div className="flex flex-col items-center gap-[3px]">
                        <span className={`text-[12px] font-medium ltr-num ${statusColor}`}>
                          {formatDiff(diff, item.unit)}
                        </span>
                        <ProgressBar percentage={percentage} reverse />
                      </div>

                      {/* Actual */}
                      <span className="w-[80px] text-[14px] font-bold text-white text-center ltr-num">
                        {item.unit === "%" ? formatPercent(item.actual) : formatCurrency(item.actual)}
                      </span>

                      {/* Target - editable for KPI (plain number, no symbol) */}
                      {isKpi && item.editable ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          title={`יעד עבור ${item.name}`}
                          value={item.unit === "%" ? item.target : item.target.toLocaleString("en-US")}
                          onChange={(e) => handleTargetChange(item.id, e.target.value.replace(/,/g, ""))}
                          className="w-[80px] text-[14px] font-bold text-white text-center bg-transparent border-none outline-none ltr-num"
                          placeholder="0"
                        />
                      ) : (
                        <span className="w-[80px] text-[14px] font-bold text-white text-center ltr-num">
                          {item.unit === "%" ? formatPercent(item.target) : formatCurrency(item.target)}
                        </span>
                      )}

                      {/* Category/Goal Name - right side */}
                      <div className="flex-1 text-[14px] font-bold text-white text-right">
                        {item.name}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
