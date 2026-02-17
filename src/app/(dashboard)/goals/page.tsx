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
  isExpense?: boolean; // true = lower is better (costs), false = higher is better (revenue/avg ticket)
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
function getStatusColor(percentage: number, isExpense: boolean = true, actual: number = 0, target: number = 0): string {
  // If diff is 0 (actual equals target, or both are 0) → white
  if (actual === target) return "text-white";
  if (isExpense) {
    // For expenses: under budget is good (green), over is bad (red)
    if (target === 0 && actual > 0) return "text-[#F64E60]";
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
  const sign = diff > 0 ? "+" : "";
  if (unit === "%") {
    if (Number.isInteger(diff) || diff % 1 === 0) {
      return `${sign}${Math.round(diff)}%`;
    }
    return `${sign}${parseFloat(diff.toFixed(2))}%`;
  }
  return `${sign}${formatCurrency(diff)}`;
}

export default function GoalsPage() {
  const { selectedBusinesses, isAdmin } = useDashboard();
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedMonth/selectedYear are persisted initial values; setSelectedMonth/setSelectedYear are stable setters. Adding them would cause unnecessary re-runs.
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
  const [_expandedChildId, setExpandedChildId] = useState<string | null>(null);

  // Data from Supabase
  const [currentExpensesData, setCurrentExpensesData] = useState<GoalItem[]>([]);
  const [goodsPurchaseData, setGoodsPurchaseData] = useState<GoalItem[]>([]);
  const [kpiData, setKpiData] = useState<GoalItem[]>([]);
  const [supplierNamesMap, setSupplierNamesMap] = useState<Map<string, string>>(new Map());
  const [supplierBudgetState, setSupplierBudgetState] = useState<Map<string, number>>(new Map());
  const [supplierActualCurrentState, setSupplierActualCurrentState] = useState<Map<string, number>>(new Map());
  const [supplierActualGoodsState, setSupplierActualGoodsState] = useState<Map<string, number>>(new Map());
  const [supplierFixedInfoMap, setSupplierFixedInfoMap] = useState<Map<string, { isFixed: boolean; vatType: string }>>(new Map());
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
        // 1-5. Fetch all base data in parallel
        // ============================================
        const [
          { data: goalsData, error: goalsError },
          { data: categoriesData, error: categoriesError },
          { data: supplierBudgetsData, error: budgetsError },
          { data: suppliersData, error: suppliersError },
          { data: invoicesData, error: invoicesError },
        ] = await Promise.all([
          // 1. Goals for the selected year/month
          supabase
            .from("goals")
            .select("*")
            .in("business_id", selectedBusinesses)
            .eq("year", year)
            .eq("month", month)
            .is("deleted_at", null),
          // 2. Expense categories
          supabase
            .from("expense_categories")
            .select("id, name, business_id, parent_id")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .eq("is_active", true)
            .order("display_order"),
          // 3. Supplier budgets (targets)
          supabase
            .from("supplier_budgets")
            .select("supplier_id, budget_amount")
            .in("business_id", selectedBusinesses)
            .eq("year", year)
            .eq("month", month)
            .is("deleted_at", null),
          // 4. Suppliers with category mapping
          supabase
            .from("suppliers")
            .select("id, name, expense_category_id, expense_type, is_fixed_expense, vat_type")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .eq("is_active", true),
          // 5. Invoices for actual amounts
          supabase
            .from("invoices")
            .select("supplier_id, subtotal, invoice_type")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .gte("invoice_date", startDate)
            .lte("invoice_date", endDate),
        ]);

        // Log any query errors
        if (goalsError) console.error("Goals query error:", goalsError);
        if (categoriesError) console.error("Categories query error:", categoriesError);
        if (budgetsError) console.error("Budgets query error:", budgetsError);
        if (suppliersError) console.error("Suppliers query error:", suppliersError);
        if (invoicesError) console.error("Invoices query error:", invoicesError);

        const goal = goalsData?.[0];
        setGoalId(goal?.id || null);

        // Build supplier -> category mapping and supplier -> budget mapping
        const supplierCategoryMap = new Map<string, string>();
        const supplierExpenseTypeMap = new Map<string, string>();
        const namesMap = new Map<string, string>();
        const fixedInfoMap = new Map<string, { isFixed: boolean; vatType: string }>();
        (suppliersData || []).forEach(s => {
          namesMap.set(s.id, s.name);
          if (s.expense_category_id) {
            supplierCategoryMap.set(s.id, s.expense_category_id);
          }
          if (s.expense_type) {
            supplierExpenseTypeMap.set(s.id, s.expense_type);
          }
          fixedInfoMap.set(s.id, { isFixed: !!s.is_fixed_expense, vatType: s.vat_type || "none" });
        });
        setSupplierNamesMap(namesMap);
        setSupplierFixedInfoMap(fixedInfoMap);

        const supplierBudgetMap = new Map<string, number>();
        (supplierBudgetsData || []).forEach(b => {
          supplierBudgetMap.set(b.supplier_id, Number(b.budget_amount) || 0);
        });

        // Build per-supplier actual amounts split by invoice type
        const perSupplierCurrentActuals = new Map<string, number>();
        const perSupplierGoodsActuals = new Map<string, number>();
        (invoicesData || []).forEach(inv => {
          if (inv.invoice_type === "current") {
            const current = perSupplierCurrentActuals.get(inv.supplier_id) || 0;
            perSupplierCurrentActuals.set(inv.supplier_id, current + Number(inv.subtotal));
          } else if (inv.invoice_type === "goods") {
            const current = perSupplierGoodsActuals.get(inv.supplier_id) || 0;
            perSupplierGoodsActuals.set(inv.supplier_id, current + Number(inv.subtotal));
          }
        });
        setSupplierBudgetState(supplierBudgetMap);
        setSupplierActualCurrentState(perSupplierCurrentActuals);
        setSupplierActualGoodsState(perSupplierGoodsActuals);

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

        // Sum up budgets by category (only current_expenses suppliers)
        (suppliersData || []).filter(s => s.expense_type === "current_expenses").forEach(supplier => {
          const catId = supplier.expense_category_id;
          const budget = supplierBudgetMap.get(supplier.id) || 0;
          if (catId && budget > 0) {
            const current = categoryTargets.get(catId) || 0;
            categoryTargets.set(catId, current + budget);
          }
        });

        // Build current expenses data - flat list of all categories (each with its own suppliers)
        const currentData: GoalItem[] = (categoriesData || [])
          .map((cat) => {
            const catSupplierIds = (suppliersData || [])
              .filter(s => s.expense_category_id === cat.id && s.expense_type === "current_expenses")
              .map(s => s.id);

            // Skip categories that have no suppliers and no data
            const catActual = categoryActuals.get(cat.id) || 0;
            const catTarget = categoryTargets.get(cat.id) || 0;
            if (catSupplierIds.length === 0 && catActual === 0 && catTarget === 0) return null;

            return {
              id: cat.id,
              name: cat.name,
              target: catTarget,
              actual: catActual,
              unit: "₪",
              editable: true,
              supplierIds: catSupplierIds,
            };
          })
          .filter(Boolean) as GoalItem[];
        currentData.sort((a, b) => a.name.localeCompare(b.name, "he"));
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
        const goodsSuppliers = (suppliersData || []).filter(s => s.expense_type === "goods_purchases");
        goodsSuppliers.forEach(supplier => {
          const catId = supplier.expense_category_id;
          const budget = supplierBudgetMap.get(supplier.id) || 0;
          if (catId && budget > 0) {
            const current = goodsCategoryTargets.get(catId) || 0;
            goodsCategoryTargets.set(catId, current + budget);
          }
        });

        // Build flat goods data - one row per supplier (by name)
        const goodsData: GoalItem[] = goodsSuppliers
          .map((supplier) => {
            const sActual = perSupplierGoodsActuals.get(supplier.id) || 0;
            const sTarget = supplierBudgetMap.get(supplier.id) || 0;

            // Skip suppliers with no data
            if (sActual === 0 && sTarget === 0) return null;

            return {
              id: `goods-supplier-${supplier.id}`,
              name: namesMap.get(supplier.id) || supplier.name,
              target: sTarget,
              actual: sActual,
              unit: "₪",
              editable: true,
              supplierIds: [supplier.id],
            };
          })
          .filter(Boolean) as GoalItem[];
        goodsData.sort((a, b) => a.name.localeCompare(b.name, "he"));

        // No total row - show only suppliers

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
            isExpense: false,
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
            const actualPct = incomeBeforeVat > 0 ? (actualCost / incomeBeforeVat) * 100 : 0;
            return {
              id: `product-${product.id}`,
              name: `יעד ${product.name} (%)`,
              target: Number(product.target_pct) || 0,
              actual: actualPct,
              unit: "%",
              editable: true,
              isExpense: true,
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
            isExpense: false,
          },
          ...avgTicketItems,
          {
            id: "labor-pct",
            name: "עלות עובדים (%)",
            target: Number(goal?.labor_cost_target_pct) || 0,
            actual: laborPct,
            unit: "%",
            editable: true,
            isExpense: true,
          },
          {
            id: "food-pct",
            name: "עלות מכר (%)",
            target: Number(goal?.food_cost_target_pct) || 0,
            actual: foodPct,
            unit: "%",
            editable: true,
            isExpense: true,
          },
          ...managedProductItems,
          {
            id: "current-expenses",
            name: "הוצאות שוטפות (₪)",
            target: Number(goal?.current_expenses_target) ||
              // Fallback: sum supplier budgets for current_expenses type
              (suppliersData || [])
                .filter(s => s.expense_type === "current_expenses")
                .reduce((sum, s) => sum + (supplierBudgetMap.get(s.id) || 0), 0),
            actual: totalCurrentExpenses,
            unit: "₪",
            editable: true,
            isExpense: true,
          },
          {
            id: "goods-expenses",
            name: "הוצאות קניות סחורה (₪)",
            target: Number(goal?.goods_expenses_target) ||
              // Fallback: sum supplier budgets for goods_purchases type
              (suppliersData || [])
                .filter(s => s.expense_type === "goods_purchases")
                .reduce((sum, s) => sum + (supplierBudgetMap.get(s.id) || 0), 0),
            actual: totalGoodsCost,
            unit: "₪",
            editable: true,
            isExpense: true,
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

  // Ensure a goals row exists for the current business/year/month, return goal id
  const ensureGoalRow = useCallback(async (supabase: ReturnType<typeof createClient>, businessId: string, year: number, month: number) => {
    const { data: existing } = await supabase.from("goals")
      .select("id")
      .eq("business_id", businessId)
      .eq("year", year)
      .eq("month", month)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) return existing.id;

    // Check if business is active before creating new goal
    const { data: biz } = await supabase.from("businesses").select("status").eq("id", businessId).single();
    if (biz?.status !== "active") return null;

    const { data: created } = await supabase.from("goals")
      .insert({ business_id: businessId, year, month })
      .select("id")
      .single();

    return created?.id || null;
  }, []);

  // Save KPI target to DB
  const saveTargetToDB = useCallback(async (id: string, value: number) => {
    const supabase = createClient();
    const year = parseInt(selectedYear);
    const month = parseInt(selectedMonth);

    try {
      // Map goal field names
      const goalFieldMap: Record<string, string> = {
        "revenue": "revenue_target",
        "labor-pct": "labor_cost_target_pct",
        "food-pct": "food_cost_target_pct",
        "current-expenses": "current_expenses_target",
        "goods-expenses": "goods_expenses_target",
      };

      if (goalFieldMap[id]) {
        // Ensure goal row exists for each selected business
        for (const businessId of selectedBusinesses) {
          const gId = await ensureGoalRow(supabase, businessId, year, month);
          if (gId) {
            await supabase.from("goals")
              .update({ [goalFieldMap[id]]: value, updated_at: new Date().toISOString() })
              .eq("id", gId);
          }
        }
        // Update goalId state if it was null
        if (!goalId && selectedBusinesses.length > 0) {
          const { data: newGoal } = await supabase.from("goals")
            .select("id")
            .eq("business_id", selectedBusinesses[0])
            .eq("year", year)
            .eq("month", month)
            .is("deleted_at", null)
            .maybeSingle();
          if (newGoal) setGoalId(newGoal.id);
        }
      } else if (id.startsWith("avg-ticket-")) {
        // Ensure goal row exists first
        let currentGoalId = goalId;
        if (!currentGoalId && selectedBusinesses.length > 0) {
          currentGoalId = await ensureGoalRow(supabase, selectedBusinesses[0], year, month);
          if (currentGoalId) setGoalId(currentGoalId);
        }
        if (currentGoalId) {
          const incomeSourceId = id.replace("avg-ticket-", "");
          const { data: existing } = await supabase.from("income_source_goals")
            .select("id").eq("goal_id", currentGoalId).eq("income_source_id", incomeSourceId).maybeSingle();
          if (existing) {
            await supabase.from("income_source_goals")
              .update({ avg_ticket_target: value, updated_at: new Date().toISOString() })
              .eq("id", existing.id);
          } else {
            await supabase.from("income_source_goals").insert({
              goal_id: currentGoalId,
              income_source_id: incomeSourceId,
              avg_ticket_target: value,
            });
          }
        }
      } else if (id.startsWith("product-")) {
        const productId = id.replace("product-", "");
        await supabase.from("managed_products")
          .update({ target_pct: value, updated_at: new Date().toISOString() })
          .eq("id", productId);
      }
    } catch (error) {
      console.error("Error saving KPI target:", error);
    }
  }, [selectedBusinesses, selectedYear, selectedMonth, goalId, ensureGoalRow]);

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

  // Sync fixed expense invoice amounts when budget changes
  const syncFixedExpenseInvoice = useCallback(async (
    supabase: ReturnType<typeof createClient>,
    supplierId: string,
    newSubtotal: number,
    startDate: string,
    endDate: string
  ) => {
    const info = supplierFixedInfoMap.get(supplierId);
    if (!info?.isFixed) return;

    const vatAmount = info.vatType === "full" ? newSubtotal * 0.18 : 0;
    const totalAmount = newSubtotal + vatAmount;

    // Find existing invoices for this supplier in the month
    const { data: existingInvoices } = await supabase
      .from("invoices")
      .select("id")
      .eq("supplier_id", supplierId)
      .in("business_id", selectedBusinesses)
      .is("deleted_at", null)
      .gte("invoice_date", startDate)
      .lte("invoice_date", endDate);

    if (existingInvoices && existingInvoices.length > 0) {
      for (const inv of existingInvoices) {
        await supabase.from("invoices")
          .update({ subtotal: newSubtotal, vat_amount: vatAmount, total_amount: totalAmount })
          .eq("id", inv.id);
      }
    }
  }, [selectedBusinesses, supplierFixedInfoMap]);

  // Save current expenses category target to DB (supplier_budgets)
  const saveCategoryTargetToDB = useCallback(async (supplierIds: string[], value: number) => {
    const supabase = createClient();
    const year = parseInt(selectedYear);
    const month = parseInt(selectedMonth);
    const startDate = `${year}-${selectedMonth}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${selectedMonth}-${String(lastDay).padStart(2, "0")}`;

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
        // Sync fixed expense invoice with new amount
        await syncFixedExpenseInvoice(supabase, supplierIds[0], value, startDate, endDate);
        // Update local actual state for immediate UI feedback
        const info = supplierFixedInfoMap.get(supplierIds[0]);
        if (info?.isFixed) {
          setSupplierActualCurrentState(prev => {
            const updated = new Map(prev);
            updated.set(supplierIds[0], value);
            return updated;
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
          // Sync fixed expense invoice with new proportional amount
          await syncFixedExpenseInvoice(supabase, supplierId, newAmount, startDate, endDate);
          // Update local actual state for immediate UI feedback
          const info = supplierFixedInfoMap.get(supplierId);
          if (info?.isFixed) {
            setSupplierActualCurrentState(prev => {
              const updated = new Map(prev);
              updated.set(supplierId, newAmount);
              return updated;
            });
          }
        }
      }
    } catch (error) {
      console.error("Error saving category target:", error);
    }
  }, [selectedBusinesses, selectedYear, selectedMonth, syncFixedExpenseInvoice, supplierFixedInfoMap]);

  // Calculate new category actual after changing target for fixed expense suppliers
  const calcNewCategoryActual = useCallback((item: GoalItem, newTarget: number, actualState: Map<string, number>, budgetState: Map<string, number>) => {
    if (!item.supplierIds || item.supplierIds.length === 0) return item.actual;

    // For single supplier - if fixed, actual = new target
    if (item.supplierIds.length === 1) {
      const info = supplierFixedInfoMap.get(item.supplierIds[0]);
      return info?.isFixed ? newTarget : item.actual;
    }

    // For multiple suppliers - recalculate: fixed suppliers get proportional new amounts, non-fixed keep current actual
    const currentTotal = item.supplierIds.reduce((sum, sId) => sum + (budgetState.get(sId) || 0), 0);
    let newActual = 0;
    for (const sId of item.supplierIds) {
      const info = supplierFixedInfoMap.get(sId);
      if (info?.isFixed) {
        const oldBudget = budgetState.get(sId) || 0;
        const ratio = currentTotal > 0 ? oldBudget / currentTotal : 1 / item.supplierIds.length;
        newActual += Math.round(newTarget * ratio);
      } else {
        newActual += actualState.get(sId) || 0;
      }
    }
    return newActual;
  }, [supplierFixedInfoMap]);

  // Handle current expenses target change (for vs-current tab)
  const handleCurrentExpenseTargetChange = (item: GoalItem, newTarget: string, _isChild: boolean = false, _parentId?: string) => {
    const numValue = parseFloat(newTarget) || 0;

    // Check if any supplier in this category is a fixed expense
    const hasFixedSupplier = item.supplierIds?.some(sId => supplierFixedInfoMap.get(sId)?.isFixed);
    const newActual = hasFixedSupplier
      ? calcNewCategoryActual(item, numValue, supplierActualCurrentState, supplierBudgetState)
      : item.actual;

    // Update the category target (and actual for fixed expenses)
    setCurrentExpensesData(prev => prev.map(i =>
      i.id === item.id ? { ...i, target: numValue, actual: hasFixedSupplier ? newActual : i.actual } : i
    ));

    // Debounce save to DB
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (item.supplierIds && item.supplierIds.length > 0) {
        saveCategoryTargetToDB(item.supplierIds, numValue);
      }
    }, 800);
  };

  // Handle goods purchase target change (for vs-goods tab)
  const handleGoodsTargetChange = (item: GoalItem, newTarget: string) => {
    const numValue = parseFloat(newTarget) || 0;

    // Check if this supplier is a fixed expense
    const hasFixedSupplier = item.supplierIds?.some(sId => supplierFixedInfoMap.get(sId)?.isFixed);
    const newActual = hasFixedSupplier
      ? calcNewCategoryActual(item, numValue, supplierActualGoodsState, supplierBudgetState)
      : item.actual;

    setGoodsPurchaseData(prev => prev.map(i =>
      i.id === item.id ? { ...i, target: numValue, actual: hasFixedSupplier ? newActual : i.actual } : i
    ));

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (item.supplierIds && item.supplierIds.length > 0) {
        saveCategoryTargetToDB(item.supplierIds, numValue);
      }
    }, 800);
  };

  // Handle individual supplier budget change (admin only)
  const handleSupplierBudgetChange = (supplierId: string, newBudget: string, categoryId: string, isGoods: boolean) => {
    const numValue = parseFloat(newBudget) || 0;
    const info = supplierFixedInfoMap.get(supplierId);

    // Update local supplier budget state
    setSupplierBudgetState(prev => {
      const updated = new Map(prev);
      updated.set(supplierId, numValue);
      return updated;
    });

    // For fixed expense suppliers, also update local actual state
    if (info?.isFixed) {
      const setActualState = isGoods ? setSupplierActualGoodsState : setSupplierActualCurrentState;
      setActualState(prev => {
        const updated = new Map(prev);
        updated.set(supplierId, numValue);
        return updated;
      });
    }

    // Recalculate the category total from all its suppliers
    const dataToUpdate = isGoods ? goodsPurchaseData : currentExpensesData;
    const setData = isGoods ? setGoodsPurchaseData : setCurrentExpensesData;
    const categoryItem = dataToUpdate.find(i => i.id === categoryId);
    if (categoryItem?.supplierIds) {
      const newCategoryTotal = categoryItem.supplierIds.reduce((sum, sId) => {
        if (sId === supplierId) return sum + numValue;
        return sum + (supplierBudgetState.get(sId) || 0);
      }, 0);
      // Also recalculate actual if any fixed suppliers
      const actualState = isGoods ? supplierActualGoodsState : supplierActualCurrentState;
      const newCategoryActual = categoryItem.supplierIds.reduce((sum, sId) => {
        if (sId === supplierId && info?.isFixed) return sum + numValue;
        const sInfo = supplierFixedInfoMap.get(sId);
        if (sId === supplierId) return sum + (actualState.get(sId) || 0);
        if (sInfo?.isFixed) return sum + (supplierBudgetState.get(sId) || 0);
        return sum + (actualState.get(sId) || 0);
      }, 0);
      const hasAnyFixed = categoryItem.supplierIds.some(sId => supplierFixedInfoMap.get(sId)?.isFixed);
      setData(prev => prev.map(i => i.id === categoryId ? { ...i, target: newCategoryTotal, ...(hasAnyFixed ? { actual: newCategoryActual } : {}) } : i));
    }

    // Debounce save to DB
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveCategoryTargetToDB([supplierId], numValue);
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
                const isKpi = activeTab === "kpi";
                const isCurrent = activeTab === "vs-current";
                const isGoods = activeTab === "vs-goods";
                // For vs-current and vs-goods tabs, everything is an expense
                // For KPI tab, use the item's isExpense flag
                const isExpense = (isCurrent || isGoods) ? true : (item.isExpense !== false);
                // Always: actual - target
                const diff = item.actual - item.target;
                const statusColor = getStatusColor(percentage, isExpense, item.actual, item.target);
                const hasChildren = item.children && item.children.length > 0;
                const hasSuppliers = item.supplierIds && item.supplierIds.length > 0;
                const isExpandable = isCurrent && (hasChildren || hasSuppliers);
                // For vs-current and vs-goods, categories are flat, so editable
                const isFlatEditable = (isCurrent || isGoods) && item.editable;
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
                      {((isKpi && item.editable && !hasChildren) || isFlatEditable) ? (
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
                              } else if (isGoods) {
                                handleGoodsTargetChange(item, val);
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

                    {/* Expanded Content - show suppliers with target, actual, status */}
                    {isExpanded && isExpandable && hasSuppliers && (
                      <div className="bg-white/5 rounded-[7px] mx-[7px] mb-[3px]">
                        {item.supplierIds!.map((sId, sIdx) => {
                          const sTarget = supplierBudgetState.get(sId) || 0;
                          const sActual = (isGoods ? supplierActualGoodsState : supplierActualCurrentState).get(sId) || 0;
                          const sPct = sTarget > 0 ? (sActual / sTarget) * 100 : 0;
                          const sDiff = sActual - sTarget;
                          const sColor = getStatusColor(sPct, true, sActual, sTarget);

                          return (
                            <div
                              key={sId}
                              className={`flex flex-row items-center justify-between gap-[5px] p-[7px] min-h-[42px] ${sIdx < item.supplierIds!.length - 1 ? 'border-b border-white/5' : ''}`}
                            >
                              {/* Status */}
                              <div className="flex flex-col items-center gap-[2px]">
                                <span className={`text-[11px] font-medium ltr-num ${sColor}`}>
                                  {formatDiff(sDiff, "₪")}
                                </span>
                                <ProgressBar percentage={sPct} reverse />
                              </div>

                              {/* Actual */}
                              <span className="w-[70px] text-[13px] font-normal text-white text-center ltr-num">
                                {formatCurrency(sActual)}
                              </span>

                              {/* Target - editable for admin */}
                              {isAdmin ? (
                                <div className="w-[70px] flex items-center justify-center gap-0" onClick={(e) => e.stopPropagation()}>
                                  {focusedInputId !== `supplier-${sId}` && <span className="text-[13px] font-normal text-white ltr-num">₪</span>}
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    title={`יעד עבור ${supplierNamesMap.get(sId) || sId}`}
                                    value={sTarget.toLocaleString("en-US")}
                                    onChange={(e) => {
                                      const val = e.target.value.replace(/,/g, "");
                                      handleSupplierBudgetChange(sId, val, item.id, isGoods);
                                    }}
                                    onFocus={() => setFocusedInputId(`supplier-${sId}`)}
                                    onBlur={() => setFocusedInputId(null)}
                                    style={{ width: focusedInputId === `supplier-${sId}` ? '70px' : `${Math.max(1, String(sTarget.toLocaleString("en-US")).length)}ch` }}
                                    className="text-[13px] font-normal text-white text-center bg-transparent border-none outline-none ltr-num"
                                    placeholder="0"
                                  />
                                </div>
                              ) : (
                                <span className="w-[70px] text-[13px] font-normal text-white text-center ltr-num">
                                  {formatCurrency(sTarget)}
                                </span>
                              )}

                              {/* Supplier Name */}
                              <span className="flex-1 text-[13px] text-white/70 text-right" dir="rtl">
                                {supplierNamesMap.get(sId) || sId}
                              </span>
                            </div>
                          );
                        })}
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
