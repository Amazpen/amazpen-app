"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useDashboard } from "../layout";
import { createClient } from "@/lib/supabase/client";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { usePersistedState } from "@/hooks/usePersistedState";

// Types
type TabType = "vs-goods" | "vs-current" | "kpi";

interface GoalItem {
  id: string;
  name: string;
  target: number;
  actual: number;
  unit?: string; // ₪ or %
  editable?: boolean;
  children?: GoalItem[];
  supplierIds?: string[]; // supplier IDs mapped to this category (for budget editing)
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
  const [activeTab, setActiveTab] = usePersistedState<TabType>("goals:activeTab", "vs-current");
  const [selectedMonth, setSelectedMonth] = usePersistedState("goals:selectedMonth", "");
  const [selectedYear, setSelectedYear] = usePersistedState("goals:selectedYear", "");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isMounted, setIsMounted] = useState(false);

  // Year options for the dropdown (computed client-side after mount)
  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [String(y), String(y + 1)];
  }, []);

  // Initialize date values on client only (only if no saved value)
  useEffect(() => {
    if (!isMounted) {
      if (!selectedMonth) setSelectedMonth(String(new Date().getMonth() + 1).padStart(2, "0"));
      if (!selectedYear) setSelectedYear(String(new Date().getFullYear()));
      setIsMounted(true);
    }
  }, [isMounted]);

  // Realtime subscription
  const handleRealtimeChange = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  useMultiTableRealtime(
    ["goals", "supplier_budgets", "invoices", "daily_entries", "expense_categories", "suppliers", "income_source_goals", "daily_income_breakdown", "daily_product_usage", "businesses", "business_schedule"],
    handleRealtimeChange,
    selectedBusinesses.length > 0
  );

  // Drill-down state
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const [expandedChildId, setExpandedChildId] = useState<string | null>(null);

  // Data from Supabase
  const [currentExpensesData, setCurrentExpensesData] = useState<GoalItem[]>([]);
  const [goodsPurchaseData, setGoodsPurchaseData] = useState<GoalItem[]>([]);
  const [kpiData, setKpiData] = useState<GoalItem[]>([]);
  const [supplierNamesMap, setSupplierNamesMap] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [goalId, setGoalId] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focusedInputId, setFocusedInputId] = useState<string | null>(null);

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
        setGoalId(goal?.id || null);

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
        const namesMap = new Map<string, string>();
        (suppliersData || []).forEach(s => {
          namesMap.set(s.id, s.name);
          if (s.expense_category_id) {
            supplierCategoryMap.set(s.id, s.expense_category_id);
          }
          if (s.expense_type) {
            supplierExpenseTypeMap.set(s.id, s.expense_type);
          }
        });
        setSupplierNamesMap(namesMap);

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

        // Build current expenses data (only parent categories, with children for drill-down)
        const currentData: GoalItem[] = (categoriesData || [])
          .filter(cat => !cat.parent_id) // Only top-level categories
          .map((cat) => {
            const childCats = (categoriesData || []).filter(c => c.parent_id === cat.id);
            let totalActual = categoryActuals.get(cat.id) || 0;
            let totalTarget = categoryTargets.get(cat.id) || 0;

            // Find suppliers for this parent category directly
            const parentSupplierIds = (suppliersData || [])
              .filter(s => s.expense_category_id === cat.id && s.expense_type === "current_expenses")
              .map(s => s.id);

            const children: GoalItem[] = childCats.map(child => {
              const childActual = categoryActuals.get(child.id) || 0;
              const childTarget = categoryTargets.get(child.id) || 0;
              totalActual += childActual;
              totalTarget += childTarget;
              // Find suppliers for this child category
              const childSupplierIds = (suppliersData || [])
                .filter(s => s.expense_category_id === child.id && s.expense_type === "current_expenses")
                .map(s => s.id);
              return {
                id: child.id,
                name: child.name,
                target: childTarget,
                actual: childActual,
                unit: "₪",
                editable: true,
                supplierIds: childSupplierIds,
              };
            });

            return {
              id: cat.id,
              name: cat.name,
              target: totalTarget,
              actual: totalActual,
              unit: "₪",
              editable: children.length === 0, // editable only if no children (leaf category)
              supplierIds: parentSupplierIds,
              children: children.length > 0 ? children : undefined,
            };
          });
        setCurrentExpensesData(currentData);

        // ============================================
        // 6. Build goods purchase data (grouped by category)
        // ============================================
        // Sum up invoices for goods by category
        const goodsCategoryActuals = new Map<string, number>();
        const goodsCategoryTargets = new Map<string, number>();

        // Initialize categories with 0
        (categoriesData || []).forEach(cat => {
          goodsCategoryActuals.set(cat.id, 0);
          goodsCategoryTargets.set(cat.id, 0);
        });

        // Aggregate goods invoices by category
        (invoicesData || []).filter(inv => inv.invoice_type === "goods").forEach(inv => {
          const catId = supplierCategoryMap.get(inv.supplier_id);
          if (catId) {
            const current = goodsCategoryActuals.get(catId) || 0;
            goodsCategoryActuals.set(catId, current + Number(inv.subtotal));
          }
        });

        // Aggregate goods budgets by category
        const goodsSuppliers = (suppliersData || []).filter(s => s.expense_type === "goods");
        goodsSuppliers.forEach(supplier => {
          const catId = supplier.expense_category_id;
          const budget = supplierBudgetMap.get(supplier.id) || 0;
          if (catId && budget > 0) {
            const current = goodsCategoryTargets.get(catId) || 0;
            goodsCategoryTargets.set(catId, current + budget);
          }
        });

        // Build hierarchical goods data by category
        const goodsData: GoalItem[] = (categoriesData || [])
          .filter(cat => !cat.parent_id)
          .map((cat) => {
            const childCats = (categoriesData || []).filter(c => c.parent_id === cat.id);
            let totalActual = goodsCategoryActuals.get(cat.id) || 0;
            let totalTarget = goodsCategoryTargets.get(cat.id) || 0;

            const parentSupplierIds = goodsSuppliers
              .filter(s => s.expense_category_id === cat.id)
              .map(s => s.id);

            const children: GoalItem[] = childCats.map(child => {
              const childActual = goodsCategoryActuals.get(child.id) || 0;
              const childTarget = goodsCategoryTargets.get(child.id) || 0;
              totalActual += childActual;
              totalTarget += childTarget;
              const childSupplierIds = goodsSuppliers
                .filter(s => s.expense_category_id === child.id)
                .map(s => s.id);
              return {
                id: child.id,
                name: child.name,
                target: childTarget,
                actual: childActual,
                unit: "₪",
                supplierIds: childSupplierIds,
              };
            });

            return {
              id: cat.id,
              name: cat.name,
              target: totalTarget,
              actual: totalActual,
              unit: "₪",
              supplierIds: parentSupplierIds,
              children: children.length > 0 ? children : undefined,
            };
          })
          // Only include categories that have goods suppliers (directly or via children)
          .filter(cat => {
            const hasDirectSuppliers = cat.supplierIds && cat.supplierIds.length > 0;
            const hasChildSuppliers = cat.children?.some(c => c.supplierIds && c.supplierIds.length > 0);
            const hasActual = cat.actual > 0;
            const hasTarget = cat.target > 0;
            return hasDirectSuppliers || hasChildSuppliers || hasActual || hasTarget;
          });

        // Add total row
        const goodsTotalActual = goodsData.reduce((sum, g) => sum + g.actual, 0);
        const goodsTotalTarget = goodsData.reduce((sum, g) => sum + g.target, 0);
        if (goodsData.length > 0) {
          goodsData.unshift({
            id: "goods-total",
            name: 'סה"כ קניות סחורה',
            target: Number(goal?.goods_expenses_target) || goodsTotalTarget,
            actual: goodsTotalActual,
            unit: "₪",
          });
        } else {
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
        const [
          { data: dailyEntries },
          { data: businessData },
          { data: scheduleData },
        ] = await Promise.all([
          supabase
            .from("daily_entries")
            .select("id, total_register, labor_cost, day_factor")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .gte("entry_date", startDate)
            .lte("entry_date", endDate),
          supabase
            .from("businesses")
            .select("id, markup_percentage, manager_monthly_salary, vat_percentage")
            .in("id", selectedBusinesses),
          supabase
            .from("business_schedule")
            .select("business_id, day_of_week, day_factor")
            .in("business_id", selectedBusinesses),
        ]);

        // Calculate totals from daily entries
        const totalRevenue = (dailyEntries || []).reduce((sum, d) => sum + Number(d.total_register || 0), 0);
        const rawLaborCost = (dailyEntries || []).reduce((sum, d) => sum + Number(d.labor_cost || 0), 0);

        // Calculate labor cost with markup and manager salary
        // Formula: (labor_cost + manager_daily_cost × actual_days) × markup
        // Use monthly goal values with business defaults as fallback
        const avgMarkup = goal?.markup_percentage != null
          ? Number(goal.markup_percentage)
          : (businessData || []).reduce((sum, b) => sum + (Number(b.markup_percentage) || 1), 0) / Math.max((businessData || []).length, 1);
        const totalManagerSalary = (businessData || []).reduce((sum, b) => sum + (Number(b.manager_monthly_salary) || 0), 0);

        // Calculate expected work days from schedule
        const scheduleDayFactors: Record<number, number[]> = {};
        (scheduleData || []).forEach(s => {
          if (!scheduleDayFactors[s.day_of_week]) {
            scheduleDayFactors[s.day_of_week] = [];
          }
          scheduleDayFactors[s.day_of_week].push(Number(s.day_factor) || 0);
        });
        const avgScheduleDayFactors: Record<number, number> = {};
        Object.keys(scheduleDayFactors).forEach(dow => {
          const factors = scheduleDayFactors[Number(dow)];
          avgScheduleDayFactors[Number(dow)] = factors.reduce((a, b) => a + b, 0) / factors.length;
        });
        const firstDay = new Date(year, month - 1, 1);
        const lastDay = new Date(year, month, 0);
        let expectedWorkDays = 0;
        const curDate = new Date(firstDay);
        while (curDate <= lastDay) {
          expectedWorkDays += avgScheduleDayFactors[curDate.getDay()] || 0;
          curDate.setDate(curDate.getDate() + 1);
        }

        const managerDailyCost = expectedWorkDays > 0 ? totalManagerSalary / expectedWorkDays : 0;
        const actualWorkDays = (dailyEntries || []).reduce((sum, e) => sum + (Number(e.day_factor) || 0), 0);
        const totalLaborCost = (rawLaborCost + (managerDailyCost * actualWorkDays)) * avgMarkup;

        // Calculate VAT divisor - use monthly goal values with business defaults as fallback
        const avgVatPercentage = goal?.vat_percentage != null
          ? Number(goal.vat_percentage)
          : (businessData || []).reduce((sum, b) => sum + (Number(b.vat_percentage) || 0), 0) / Math.max((businessData || []).length, 1);
        const vatDivisor = avgVatPercentage > 0 ? 1 + avgVatPercentage : 1;
        const incomeBeforeVat = totalRevenue / vatDivisor;

        // Calculate food cost from goods invoices
        const totalGoodsCost = (invoicesData || [])
          .filter(inv => inv.invoice_type === "goods")
          .reduce((sum, inv) => sum + Number(inv.subtotal), 0);

        // Calculate current expenses total
        const totalCurrentExpenses = (invoicesData || [])
          .filter(inv => inv.invoice_type === "current")
          .reduce((sum, inv) => sum + Number(inv.subtotal), 0);

        // Calculate percentages against income before VAT
        const laborPct = incomeBeforeVat > 0 ? (totalLaborCost / incomeBeforeVat) * 100 : 0;
        const foodPct = incomeBeforeVat > 0 ? (totalGoodsCost / incomeBeforeVat) * 100 : 0;

        // ============================================
        // 8. Fetch income sources, goals & breakdown for avg ticket
        // ============================================
        const entryIds = (dailyEntries || []).map(d => d.id);

        const [
          { data: incomeSourcesData },
          { data: incomeSourceGoalsData },
          breakdownResult,
          { data: managedProductsData },
          productUsageResult,
        ] = await Promise.all([
          supabase
            .from("income_sources")
            .select("id, name")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .eq("is_active", true)
            .order("name"),
          goal ? supabase
            .from("income_source_goals")
            .select("income_source_id, avg_ticket_target")
            .eq("goal_id", goal.id)
          : Promise.resolve({ data: [] as { income_source_id: string; avg_ticket_target: number }[] }),
          entryIds.length > 0 ? supabase
            .from("daily_income_breakdown")
            .select("income_source_id, amount, orders_count")
            .in("daily_entry_id", entryIds)
          : Promise.resolve({ data: [] as { income_source_id: string; amount: number; orders_count: number }[] }),
          supabase
            .from("managed_products")
            .select("id, name, unit, unit_cost, target_pct")
            .in("business_id", selectedBusinesses)
            .eq("is_active", true)
            .is("deleted_at", null)
            .order("name"),
          entryIds.length > 0 ? supabase
            .from("daily_product_usage")
            .select("product_id, quantity, unit_cost_at_time")
            .in("daily_entry_id", entryIds)
          : Promise.resolve({ data: [] as { product_id: string; quantity: number; unit_cost_at_time: number }[] }),
        ]);

        const { data: breakdownData } = breakdownResult;
        const { data: productUsageData } = productUsageResult;

        // Aggregate income breakdown by source: total amount and orders
        const incomeAgg: Record<string, { totalAmount: number; totalOrders: number }> = {};
        (breakdownData || []).forEach(b => {
          if (!incomeAgg[b.income_source_id]) {
            incomeAgg[b.income_source_id] = { totalAmount: 0, totalOrders: 0 };
          }
          incomeAgg[b.income_source_id].totalAmount += Number(b.amount) || 0;
          incomeAgg[b.income_source_id].totalOrders += Number(b.orders_count) || 0;
        });

        // Build income source goal map
        const incomeGoalMap = new Map<string, number>();
        ((incomeSourceGoalsData || []) as { income_source_id: string; avg_ticket_target: number }[]).forEach(ig => {
          incomeGoalMap.set(ig.income_source_id, Number(ig.avg_ticket_target) || 0);
        });

        // Build avg ticket KPI items
        const avgTicketItems: GoalItem[] = (incomeSourcesData || []).map(source => {
          const agg = incomeAgg[source.id];
          const actualAvg = agg && agg.totalOrders > 0 ? agg.totalAmount / agg.totalOrders : 0;
          const targetAvg = incomeGoalMap.get(source.id) || 0;
          return {
            id: `avg-ticket-${source.id}`,
            name: `ממוצע ${source.name} (₪)`,
            target: targetAvg,
            actual: Math.round(actualAvg),
            unit: "₪",
            editable: true,
          };
        });

        // ============================================
        // 9. Build managed product KPI items (target %)
        // ============================================
        // Aggregate product usage: total cost per product
        const productCostAgg: Record<string, number> = {};
        (productUsageData || []).forEach(pu => {
          if (!productCostAgg[pu.product_id]) {
            productCostAgg[pu.product_id] = 0;
          }
          productCostAgg[pu.product_id] += (Number(pu.quantity) || 0) * (Number(pu.unit_cost_at_time) || 0);
        });

        const managedProductItems: GoalItem[] = (managedProductsData || [])
          .filter(p => p.target_pct !== null)
          .map(product => {
            const actualCost = productCostAgg[product.id] || 0;
            const actualPct = totalRevenue > 0 ? (actualCost / totalRevenue) * 100 : 0;
            return {
              id: `product-${product.id}`,
              name: `יעד ${product.name} (%)`,
              target: Number(product.target_pct) || 0,
              actual: actualPct,
              unit: "%",
              editable: true,
            };
          });

        const kpiItems: GoalItem[] = [
          {
            id: "revenue",
            name: "הכנסות ברוטו (₪)",
            target: Number(goal?.revenue_target) || 0,
            actual: totalRevenue,
            unit: "₪",
            editable: true,
          },
          ...avgTicketItems,
          {
            id: "labor-pct",
            name: "עלות עובדים (%)",
            target: Number(goal?.labor_cost_target_pct) || 0,
            actual: laborPct,
            unit: "%",
            editable: true,
          },
          {
            id: "food-pct",
            name: "עלות מכר (%)",
            target: Number(goal?.food_cost_target_pct) || 0,
            actual: foodPct,
            unit: "%",
            editable: true,
          },
          ...managedProductItems,
          {
            id: "current-expenses",
            name: "הוצאות שוטפות (₪)",
            target: Number(goal?.current_expenses_target) || 0,
            actual: totalCurrentExpenses,
            unit: "₪",
            editable: true,
          },
          {
            id: "goods-expenses",
            name: "הוצאות קניות סחורה (₪)",
            target: Number(goal?.goods_expenses_target) || 0,
            actual: totalGoodsCost,
            unit: "₪",
            editable: true,
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

  // Save KPI target to DB
  const saveTargetToDB = useCallback(async (id: string, value: number) => {
    const supabase = createClient();
    const year = parseInt(selectedYear);
    const month = parseInt(selectedMonth);

    try {
      if (id === "revenue") {
        await supabase.from("goals").update({ revenue_target: value, updated_at: new Date().toISOString() })
          .in("business_id", selectedBusinesses).eq("year", year).eq("month", month);
      } else if (id === "labor-pct") {
        await supabase.from("goals").update({ labor_cost_target_pct: value, updated_at: new Date().toISOString() })
          .in("business_id", selectedBusinesses).eq("year", year).eq("month", month);
      } else if (id === "food-pct") {
        await supabase.from("goals").update({ food_cost_target_pct: value, updated_at: new Date().toISOString() })
          .in("business_id", selectedBusinesses).eq("year", year).eq("month", month);
      } else if (id.startsWith("avg-ticket-") && goalId) {
        const incomeSourceId = id.replace("avg-ticket-", "");
        // Check if record exists
        const { data: existing } = await supabase.from("income_source_goals")
          .select("id").eq("goal_id", goalId).eq("income_source_id", incomeSourceId).maybeSingle();
        if (existing) {
          await supabase.from("income_source_goals")
            .update({ avg_ticket_target: value, updated_at: new Date().toISOString() })
            .eq("id", existing.id);
        } else {
          await supabase.from("income_source_goals").insert({
            goal_id: goalId,
            income_source_id: incomeSourceId,
            avg_ticket_target: value,
          });
        }
      } else if (id.startsWith("product-")) {
        const productId = id.replace("product-", "");
        await supabase.from("managed_products")
          .update({ target_pct: value, updated_at: new Date().toISOString() })
          .eq("id", productId);
      } else if (id === "current-expenses") {
        await supabase.from("goals").update({ current_expenses_target: value, updated_at: new Date().toISOString() })
          .in("business_id", selectedBusinesses).eq("year", year).eq("month", month);
      } else if (id === "goods-expenses") {
        await supabase.from("goals").update({ goods_expenses_target: value, updated_at: new Date().toISOString() })
          .in("business_id", selectedBusinesses).eq("year", year).eq("month", month);
      }
    } catch (error) {
      console.error("Error saving KPI target:", error);
    }
  }, [selectedBusinesses, selectedYear, selectedMonth, goalId]);

  // Handle KPI target change with debounced save
  const handleTargetChange = (id: string, newTarget: string) => {
    const numValue = parseFloat(newTarget) || 0;
    setKpiData(prev => prev.map(item =>
      item.id === id ? { ...item, target: numValue } : item
    ));

    // Debounce save to DB
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTargetToDB(id, numValue);
    }, 800);
  };

  // Save current expenses category target to DB (supplier_budgets)
  const saveCategoryTargetToDB = useCallback(async (supplierIds: string[], value: number) => {
    const supabase = createClient();
    const year = parseInt(selectedYear);
    const month = parseInt(selectedMonth);

    try {
      if (supplierIds.length === 1) {
        // Single supplier: set budget directly
        const { data: existing } = await supabase.from("supplier_budgets")
          .select("id").eq("supplier_id", supplierIds[0])
          .in("business_id", selectedBusinesses).eq("year", year).eq("month", month)
          .maybeSingle();
        if (existing) {
          await supabase.from("supplier_budgets")
            .update({ budget_amount: value, updated_at: new Date().toISOString() })
            .eq("id", existing.id);
        } else {
          await supabase.from("supplier_budgets").insert({
            supplier_id: supplierIds[0],
            business_id: selectedBusinesses[0],
            year, month,
            budget_amount: value,
          });
        }
      } else if (supplierIds.length > 1) {
        // Multiple suppliers: get current budgets and distribute proportionally
        const { data: currentBudgets } = await supabase.from("supplier_budgets")
          .select("id, supplier_id, budget_amount")
          .in("supplier_id", supplierIds)
          .in("business_id", selectedBusinesses)
          .eq("year", year).eq("month", month);

        const currentTotal = (currentBudgets || []).reduce((sum, b) => sum + Number(b.budget_amount), 0);

        for (const supplierId of supplierIds) {
          const existing = (currentBudgets || []).find(b => b.supplier_id === supplierId);
          const oldAmount = existing ? Number(existing.budget_amount) : 0;
          const ratio = currentTotal > 0 ? oldAmount / currentTotal : 1 / supplierIds.length;
          const newAmount = Math.round(value * ratio);

          if (existing) {
            await supabase.from("supplier_budgets")
              .update({ budget_amount: newAmount, updated_at: new Date().toISOString() })
              .eq("id", existing.id);
          } else {
            await supabase.from("supplier_budgets").insert({
              supplier_id: supplierId,
              business_id: selectedBusinesses[0],
              year, month,
              budget_amount: newAmount,
            });
          }
        }
      }
    } catch (error) {
      console.error("Error saving category target:", error);
    }
  }, [selectedBusinesses, selectedYear, selectedMonth]);

  // Handle current expenses target change (for vs-current tab)
  const handleCurrentExpenseTargetChange = (item: GoalItem, newTarget: string, isChild: boolean, parentId?: string) => {
    const numValue = parseFloat(newTarget) || 0;

    if (isChild && parentId) {
      // Update child target and recalculate parent total
      setCurrentExpensesData(prev => prev.map(parent => {
        if (parent.id !== parentId || !parent.children) return parent;
        const updatedChildren = parent.children.map(child =>
          child.id === item.id ? { ...child, target: numValue } : child
        );
        // Parent target = sum of children targets (parent's own suppliers are already in children or direct)
        const newParentTarget = updatedChildren.reduce((sum, c) => sum + c.target, 0);
        return { ...parent, children: updatedChildren, target: newParentTarget };
      }));
    } else {
      // Update parent without children directly
      setCurrentExpensesData(prev => prev.map(i =>
        i.id === item.id ? { ...i, target: numValue } : i
      ));
    }

    // Debounce save to DB
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (item.supplierIds && item.supplierIds.length > 0) {
        saveCategoryTargetToDB(item.supplierIds, numValue);
      }
    }, 800);
  };

  // Show message if no business selected
  if (selectedBusinesses.length === 0) {
    return (
      <div className="text-white px-[3px] pt-[10px] pb-[80px]" dir="rtl">
        <div className="bg-[#0F1535] rounded-[20px] p-[40px] text-center">
          <p className="text-[20px] text-white/70">יש לבחור עסק כדי לצפות ביעדים</p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-white px-[3px] pt-[10px] pb-[80px]" dir="rtl">
      {/* Main Container */}
      <div className="bg-[#0F1535] rounded-[10px] p-[5px]">

        {/* Tab Navigation */}
        <div id="onboarding-goals-tabs" className="flex flex-row-reverse h-[55px] mb-[10px]">
          {/* Tab 1: יעד VS קניות סחורה (leftmost in RTL = rightmost visually) */}
          <button
            type="button"
            onClick={() => setActiveTab("vs-goods")}
            className={`flex-1 flex items-center justify-center py-[10px] px-[4px] transition-colors duration-200 rounded-l-[7px] ${
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
            className={`flex-1 flex items-center justify-center py-[10px] px-[4px] transition-colors duration-200 ${
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
            className={`flex-1 flex items-center justify-center py-[10px] px-[4px] transition-colors duration-200 rounded-r-[7px] ${
              activeTab === "kpi"
                ? "bg-[#29318A] text-white border-[#29318A]"
                : "text-[#6B6B6B] hover:bg-[#29318A]/20 border-[#6B6B6B]"
            } ${activeTab !== "kpi" ? "border-y border-r" : ""}`}
          >
            <span className="text-[16px] font-semibold">יעדי KPI</span>
          </button>
        </div>

        {/* Month & Year Selectors */}
        <div id="onboarding-goals-month" className="flex flex-row-reverse justify-start gap-[10px] mt-[10px]">
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
        <div id="onboarding-goals-table" className="mt-[15px]" dir="ltr">
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

          {/* Goal Items */}
          <div className="flex flex-col">
            {isLoading && data.length === 0 ? (
              <div className="flex items-center justify-center py-[40px]">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
              </div>
            ) : data.length === 0 ? (
              <div className="flex items-center justify-center py-[40px]">
                <span className="text-[16px] text-white/50">אין נתונים להצגה</span>
              </div>
            ) : data.map((item) => {
                const percentage = item.target > 0 ? (item.actual / item.target) * 100 : 0;
                const diff = item.target - item.actual; // Positive means under budget (good for expenses)
                const isKpi = activeTab === "kpi";
                const isCurrent = activeTab === "vs-current";
                const isRevenueType = item.name.includes("הכנסות");
                const statusColor = getStatusColor(percentage, !isRevenueType);
                const hasChildren = item.children && item.children.length > 0;
                const hasSuppliers = item.supplierIds && item.supplierIds.length > 0;
                const isGoods = activeTab === "vs-goods";
                const isExpandable = (isCurrent || isGoods) && (hasChildren || hasSuppliers);
                const isExpanded = expandedGoalId === item.id;

                return (
                  <div key={item.id} className="flex flex-col">
                    {/* Parent Row */}
                    <div
                      className={`flex flex-row items-center justify-between gap-[5px] border-b border-white/10 p-[7px] min-h-[50px] ${isExpandable ? 'cursor-pointer' : ''}`}
                      onClick={isExpandable ? () => { setExpandedGoalId(isExpanded ? null : item.id); setExpandedChildId(null); } : undefined}
                    >
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

                      {/* Target - editable for KPI and vs-current */}
                      {((isKpi || isCurrent) && item.editable && !hasChildren) ? (
                        <div className="w-[80px] flex items-center justify-center gap-0" onClick={(e) => e.stopPropagation()}>
                          {item.unit === "₪" && focusedInputId !== item.id && <span className="text-[14px] font-bold text-white ltr-num">₪</span>}
                          <input
                            type="text"
                            inputMode="decimal"
                            title={`יעד עבור ${item.name}`}
                            value={item.unit === "%" ? item.target : item.target.toLocaleString("en-US")}
                            onChange={(e) => {
                              const val = e.target.value.replace(/,/g, "");
                              if (isKpi) {
                                handleTargetChange(item.id, val);
                              } else {
                                handleCurrentExpenseTargetChange(item, val, false);
                              }
                            }}
                            onFocus={() => setFocusedInputId(item.id)}
                            onBlur={() => setFocusedInputId(null)}
                            style={{ width: focusedInputId === item.id ? '80px' : `${Math.max(1, String(item.unit === "%" ? item.target : item.target.toLocaleString("en-US")).length)}ch` }}
                            className="text-[14px] font-bold text-white text-center bg-transparent border-none outline-none ltr-num"
                            placeholder="0"
                          />
                          {item.unit === "%" && focusedInputId !== item.id && <span className="text-[14px] font-bold text-white ltr-num">%</span>}
                        </div>
                      ) : (
                        <span className="w-[80px] text-[14px] font-bold text-white text-center ltr-num">
                          {item.unit === "%" ? formatPercent(item.target) : formatCurrency(item.target)}
                        </span>
                      )}

                      {/* Category/Goal Name - right side */}
                      <div className="flex-1 flex flex-row items-center justify-end gap-[3px]">
                        <span className="text-[14px] font-bold text-white text-right" dir="rtl">
                          {item.name}
                        </span>
                        {isExpandable && (
                          <svg
                            width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
                            className={`flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                          >
                            <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && isExpandable && (
                      <div className="bg-white/5 rounded-[7px] mx-[7px] mb-[3px]">
                        {/* If has sub-categories, show them with expandable suppliers */}
                        {hasChildren ? (
                          item.children!.map((child, childIdx) => {
                            const childPct = child.target > 0 ? (child.actual / child.target) * 100 : 0;
                            const childDiff = child.target - child.actual;
                            const childStatusColor = getStatusColor(childPct, true);
                            const childHasSuppliers = child.supplierIds && child.supplierIds.length > 0;
                            const isChildExpanded = expandedChildId === child.id;

                            return (
                              <div key={child.id} className="flex flex-col">
                                <div
                                  className={`flex flex-row items-center justify-between gap-[5px] p-[7px] min-h-[50px] ${childHasSuppliers ? 'cursor-pointer' : ''} ${childIdx < item.children!.length - 1 && !isChildExpanded ? 'border-b border-white/5' : ''}`}
                                  onClick={childHasSuppliers ? () => setExpandedChildId(isChildExpanded ? null : child.id) : undefined}
                                >
                                  {/* Progress/Status */}
                                  <div className="flex flex-col items-center gap-[3px]">
                                    <span className={`text-[12px] font-medium ltr-num ${childStatusColor}`}>
                                      {formatDiff(childDiff, child.unit)}
                                    </span>
                                    <ProgressBar percentage={childPct} reverse />
                                  </div>

                                  {/* Actual */}
                                  <span className="w-[80px] text-[14px] font-normal text-white text-center ltr-num">
                                    {formatCurrency(child.actual)}
                                  </span>

                                  {/* Target - editable for vs-current children */}
                                  {isCurrent && child.editable ? (
                                    <div className="w-[80px] flex items-center justify-center gap-0" onClick={(e) => e.stopPropagation()}>
                                      {focusedInputId !== child.id && <span className="text-[14px] font-normal text-white ltr-num">₪</span>}
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        title={`יעד עבור ${child.name}`}
                                        value={child.target.toLocaleString("en-US")}
                                        onChange={(e) => handleCurrentExpenseTargetChange(child, e.target.value.replace(/,/g, ""), true, item.id)}
                                        onFocus={() => setFocusedInputId(child.id)}
                                        onBlur={() => setFocusedInputId(null)}
                                        style={{ width: focusedInputId === child.id ? '80px' : `${Math.max(1, String(child.target.toLocaleString("en-US")).length)}ch` }}
                                        className="text-[14px] font-normal text-white text-center bg-transparent border-none outline-none ltr-num"
                                        placeholder="0"
                                      />
                                    </div>
                                  ) : (
                                    <span className="w-[80px] text-[14px] font-normal text-white text-center ltr-num">
                                      {formatCurrency(child.target)}
                                    </span>
                                  )}

                                  {/* Child Name with expand arrow */}
                                  <div className="flex-1 flex flex-row-reverse items-center justify-start gap-[3px]">
                                    {childHasSuppliers && (
                                      <svg
                                        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
                                        className={`flex-shrink-0 transition-transform duration-200 ${isChildExpanded ? 'rotate-180' : ''}`}
                                      >
                                        <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    )}
                                    <span className="text-[14px] font-normal text-white text-right">
                                      {child.name}
                                    </span>
                                  </div>
                                </div>

                                {/* Suppliers under this child category */}
                                {isChildExpanded && childHasSuppliers && (
                                  <div className="bg-white/3 mx-[10px] mb-[5px] rounded-[5px] border-b border-white/5">
                                    {child.supplierIds!.map((sId, sIdx) => (
                                      <div
                                        key={sId}
                                        className={`flex items-center justify-end p-[6px_10px] ${sIdx < child.supplierIds!.length - 1 ? 'border-b border-white/5' : ''}`}
                                      >
                                        <span className="text-[13px] text-white/70 text-right">
                                          {supplierNamesMap.get(sId) || sId}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          /* Leaf category - show suppliers directly */
                          hasSuppliers && item.supplierIds!.map((sId, sIdx) => (
                            <div
                              key={sId}
                              className={`flex items-center justify-end p-[8px_10px] ${sIdx < item.supplierIds!.length - 1 ? 'border-b border-white/5' : ''}`}
                            >
                              <span className="text-[13px] text-white/70 text-right">
                                {supplierNamesMap.get(sId) || sId}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
        </div>

      </div>
    </div>
  );
}
