"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useDashboard } from "../layout";
import { createClient } from "@/lib/supabase/client";
import { ReportsHelpButton } from "@/components/onboarding/ReportsHelpButton";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { usePersistedState } from "@/hooks/usePersistedState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { LaborMonthCloseModal } from "@/components/dashboard/LaborMonthCloseModal";

// Lazy loaded Recharts components
const LazyBarChart = dynamic(() => import("recharts").then((mod) => ({ default: mod.BarChart })), { ssr: false });
const LazyBar = dynamic(() => import("recharts").then((mod) => ({ default: mod.Bar })), { ssr: false });
const LazyXAxis = dynamic(() => import("recharts").then((mod) => ({ default: mod.XAxis })), { ssr: false });
const LazyYAxis = dynamic(() => import("recharts").then((mod) => ({ default: mod.YAxis })), { ssr: false });
const LazyTooltip = dynamic(() => import("recharts").then((mod) => ({ default: mod.Tooltip })), { ssr: false });
const LazyResponsiveContainer = dynamic(() => import("recharts").then((mod) => ({ default: mod.ResponsiveContainer })), { ssr: false });

// Supplier row within a subcategory
interface SupplierDisplay {
  name: string;
  target: string;
  actual: string;
  difference: string;
  remaining: string;
  remainingRaw: number;
  diffRaw: number;
  actualRaw: number;
  targetRaw: number;
  hasUnapproved?: boolean;
}

// Expense category data for display
interface SubcategoryDisplay {
  id: string;
  name: string;
  target: string;
  actual: string;
  difference: string;
  remaining: string;
  remainingRaw: number;
  diffRaw: number;
  actualRaw: number;
  targetRaw: number;
  hasUnapproved?: boolean;
  suppliers: SupplierDisplay[];
}

interface ExpenseCategoryDisplay {
  id: string;
  name: string;
  target: string;
  actual: string;
  difference: string;
  remaining: string;
  remainingRaw: number;
  diffRaw: number;
  actualRaw: number;
  targetRaw: number;
  subcategories: SubcategoryDisplay[];
  isClosedLabor?: boolean;
  isLaborParent?: boolean;
}

// Summary data
interface ReportSummary {
  totalRevenue: number;
  revenueTarget: number;
  totalExpenses: number;
  expensesTarget: number;
  totalCredits: number;
  operatingProfit: number;
  operatingProfitPct: number;
  netProfit: number;
  netProfitPct: number;
}

// Prior commitment item for breakdown display
interface PriorLiabilityItem {
  name: string;
  monthly_amount: number;
  total_installments: number;
  start_date: string;
  end_date: string;
}

// Format number for display
function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `₪${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return `₪${value.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDifference(value: number): string {
  const sign = value >= 0 ? "" : "";
  if (Math.abs(value) >= 1000) {
    return `₪${sign}${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return `₪${sign}${value.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatPercentage(value: number): string {
  const sign = value >= 0 ? "" : "";
  return `${sign}${value.toFixed(2)}%`;
}

const hebrewMonthsShort = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

// Progress bar color based on utilization (100 - remainingRaw)
function getProgressBarColor(remainingRaw: number): string {
  const used = 100 - remainingRaw;
  if (used > 80) return "bg-[#F64E60]"; // Red - over/near budget
  if (used > 50) return "bg-[#FFA412]"; // Orange - warning
  return "bg-[#17DB4E]"; // Green - safe
}

// Tooltip text for progress bar
function getProgressTooltip(actualRaw: number, targetRaw: number): string {
  const fmtNum = (n: number) => `₪${Math.round(n).toLocaleString("he-IL")}`;
  return `נוצל ${fmtNum(actualRaw)} מתוך ${fmtNum(targetRaw)}`;
}

export default function ReportsPage() {
  const router = useRouter();
  const { selectedBusinesses, globalMonth: selectedMonth, setGlobalMonth: setSelectedMonth, globalYear: selectedYear, setGlobalYear: setSelectedYear } = useDashboard();
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [expandedSubcategories, setExpandedSubcategories] = useState<string[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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
    totalCredits: 0,
    operatingProfit: 0,
    operatingProfitPct: 0,
    netProfit: 0,
    netProfitPct: 0,
  });
  const [priorLiabilities, setPriorLiabilities] = useState(0);
  const [priorLiabilitiesItems, setPriorLiabilitiesItems] = useState<PriorLiabilityItem[]>([]);
  const [showPriorLiabilitiesBreakdown, setShowPriorLiabilitiesBreakdown] = useState(false);
  const [cashFlowForecast, setCashFlowForecast] = useState({ target: 0, actual: 0 });

  // Employee-cost month-close UI state
  const [laborCloseOpen, setLaborCloseOpen] = useState(false);
  const [laborMonthClosedState, setLaborMonthClosedState] = useState(false);
  const [salaryEstimateState, setSalaryEstimateState] = useState(0);
  const [employerEstimateState, setEmployerEstimateState] = useState(0);
  const [employeeSuppliersState, setEmployeeSuppliersState] = useState<{ id: string; name: string; amount?: number }[]>([]);

  // 6-month trends chart data
  const [trendsData, setTrendsData] = useState<{ month: string; income: number; expenses: number }[]>([]);

  // Monthly (default) vs Yearly view. Persisted so the user's last choice
  // sticks across refreshes — matches how the rest of the dashboard treats
  // sticky UI state.
  const [viewMode, setViewMode] = usePersistedState<"monthly" | "yearly">("reports:viewMode", "monthly");

  // Yearly per-supplier × per-month actual-spend matrix. Each supplier row
  // holds the 12 monthly totals plus a yearly total. Same data sources as the
  // monthly view (invoices + unlinked delivery notes), just bucketed by month
  // across the whole selected year so users can see how each supplier's spend
  // trended without flipping months one by one.
  const [yearlySupplierRows, setYearlySupplierRows] = useState<Array<{
    supplierId: string;
    name: string;
    expenseType: string | null;
    isFixed: boolean;
    monthly: number[]; // length 12, index 0 = Jan
    // For fixed-expense suppliers — true when the invoice for that month is
    // still a placeholder (no attachment AND no real invoice_number). Used to
    // tint the cell purple, matching the supplier-card semantics elsewhere.
    monthlyUnapproved: boolean[];
    // Per-cell payment status, used to colour the amount: 'paid' (green),
    // 'pending' (white), 'clarification' (orange — wins if ANY invoice in the
    // bucket is in clarification), 'unapproved' (purple — placeholder).
    monthlyStatus: Array<'paid' | 'pending' | 'clarification' | 'unapproved' | null>;
    total: number;
  }>>([]);
  const [yearlyMonthTotals, setYearlyMonthTotals] = useState<number[]>(Array(12).fill(0));
  const [yearlyGrandTotal, setYearlyGrandTotal] = useState(0);
  // Revenue (before VAT) for the selected year. Shown at the top of the
  // yearly view alongside the expense total so the user can scan profit at a
  // glance without flipping to monthly view.
  const [yearlyRevenueTotal, setYearlyRevenueTotal] = useState(0);
  // Per-month revenue (before VAT) — populates the dedicated "הכנסות" row at
  // the top of the yearly matrix so the user can scan revenue against
  // expenses month-by-month without flipping the view.
  const [yearlyMonthlyRevenue, setYearlyMonthlyRevenue] = useState<number[]>(Array(12).fill(0));
  const [yearlySupplierSearch, setYearlySupplierSearch] = useState("");
  const [isLoadingYearly, setIsLoadingYearly] = useState(false);
  // Single "report data is in flight" flag — gates the dynamic numbers
  // (revenue/expenses/profit/totals/categories/prior-commitments/cashflow)
  // so they show skeleton placeholders instead of stale or zero values.
  const [isLoadingReport, setIsLoadingReport] = useState(true);

  // Fetch 6-month trends for chart
  useEffect(() => {
    const fetchTrends = async () => {
      if (selectedBusinesses.length === 0 || !selectedYear || !selectedMonth) {
        setTrendsData([]);
        return;
      }

      const year = parseInt(selectedYear);
      const month = parseInt(selectedMonth);
      if (isNaN(year) || isNaN(month)) return;

      const supabase = createClient();
      const monthNames = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

      // Build 6-month range ending at selected month
      const months: { year: number; month: number; label: string }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(year, month - 1 - i, 1);
        months.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: monthNames[d.getMonth()] });
      }

      const firstStart = `${months[0].year}-${String(months[0].month).padStart(2, "0")}-01`;
      const lastEnd = new Date(months[5].year, months[5].month, 0).toISOString().split("T")[0];

      const [{ data: dailyData }, { data: invoicesData }, { data: trendDeliveryNotes }, { data: bizVatData }, { data: goalsVatData }, { data: scheduleData }] = await Promise.all([
        supabase
          .from("daily_entries")
          .select("business_id, entry_date, total_register, labor_cost, manager_daily_cost, day_factor")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .gte("entry_date", firstStart)
          .lte("entry_date", lastEnd),
        supabase
          .from("invoices")
          .select("invoice_date, reference_date, subtotal")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .in("invoice_type", ["current", "goods"])
          .gte("reference_date", firstStart)
          .lte("reference_date", lastEnd),
        // Unlinked delivery notes also count as expenses in the trends chart.
        supabase
          .from("delivery_notes")
          .select("delivery_date, subtotal")
          .in("business_id", selectedBusinesses)
          .is("invoice_id", null)
          .gte("delivery_date", firstStart)
          .lte("delivery_date", lastEnd),
        supabase
          .from("businesses")
          .select("id, vat_percentage, markup_percentage, manager_monthly_salary")
          .in("id", selectedBusinesses),
        supabase
          .from("goals")
          .select("business_id, vat_percentage, markup_percentage")
          .in("business_id", selectedBusinesses),
        supabase
          .from("business_schedule")
          .select("business_id, day_of_week, day_factor")
          .in("business_id", selectedBusinesses),
      ]);

      // Calculate VAT divisor and markup (matching the report)
      const avgVat = (bizVatData || []).reduce((sum, b) => {
        const bGoal = (goalsVatData || []).find(g => g.business_id === b.id);
        return sum + (bGoal?.vat_percentage != null ? Number(bGoal.vat_percentage) : (Number(b.vat_percentage) || 0));
      }, 0) / Math.max((bizVatData || []).length, 1);
      const vatDivisor = avgVat > 0 ? 1 + avgVat : 1;

      const avgMarkup = (bizVatData || []).reduce((sum, b) => {
        const bGoal = (goalsVatData || []).find(g => g.business_id === b.id);
        return sum + (bGoal?.markup_percentage != null ? Number(bGoal.markup_percentage) : (Number(b.markup_percentage) || 1));
      }, 0) / Math.max((bizVatData || []).length, 1);
      const markupMultiplier = avgMarkup > 0 ? avgMarkup : 1;

      const incomeByMonth = new Map<string, number>();
      const expensesByMonth = new Map<string, number>();

      for (const m of months) {
        const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
        incomeByMonth.set(key, 0);
        expensesByMonth.set(key, 0);
      }

      // Compute avg day factors per day_of_week for manager cost fallback
      const dayFactorsByDow: Record<number, number[]> = {};
      (scheduleData || []).forEach(s => {
        const dow = Number(s.day_of_week);
        if (!dayFactorsByDow[dow]) dayFactorsByDow[dow] = [];
        dayFactorsByDow[dow].push(Number(s.day_factor) || 0);
      });
      const avgDayFactorsByDow: Record<number, number> = {};
      for (let dow = 0; dow < 7; dow++) {
        const arr = dayFactorsByDow[dow] || [];
        avgDayFactorsByDow[dow] = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      }
      const managerMonthlySalaryAvg = (bizVatData || []).reduce((sum, b) => sum + (Number(b.manager_monthly_salary) || 0), 0) / Math.max((bizVatData || []).length, 1);

      // Precompute expected work days per month
      const expectedWorkDaysByMonth = new Map<string, number>();
      for (const m of months) {
        const firstDay = new Date(m.year, m.month - 1, 1);
        const lastDay = new Date(m.year, m.month, 0);
        let wd = 0;
        const cur = new Date(firstDay);
        while (cur <= lastDay) {
          wd += avgDayFactorsByDow[cur.getDay()] || 0;
          cur.setDate(cur.getDate() + 1);
        }
        expectedWorkDaysByMonth.set(`${m.year}-${String(m.month).padStart(2, "0")}`, wd);
      }

      // Income from daily entries (before VAT) + labor costs with markup
      for (const entry of dailyData || []) {
        const key = entry.entry_date?.substring(0, 7);
        if (key && incomeByMonth.has(key)) {
          incomeByMonth.set(key, (incomeByMonth.get(key) || 0) + Number(entry.total_register || 0) / vatDivisor);
          const entryLabor = Number(entry.labor_cost) || 0;
          let entryManager = Number(entry.manager_daily_cost) || 0;
          if (entryManager === 0 && managerMonthlySalaryAvg > 0) {
            const expectedWd = expectedWorkDaysByMonth.get(key) || 0;
            const dayFactor = Number(entry.day_factor) || 0;
            if (expectedWd > 0) entryManager = (managerMonthlySalaryAvg / expectedWd) * dayFactor;
          }
          const entryLaborCost = entryLabor * markupMultiplier + entryManager;
          if (entryLaborCost > 0) {
            expensesByMonth.set(key, (expensesByMonth.get(key) || 0) + entryLaborCost);
          }
        }
      }

      // Invoice expenses (goods + current, NOT employees — those come from daily_entries above).
      // Credit notes (negative subtotals) reduce the monthly total — they represent refunds.
      for (const inv of invoicesData || []) {
        const amount = Number(inv.subtotal || 0);
        const key = (inv.reference_date || inv.invoice_date)?.substring(0, 7);
        if (key && expensesByMonth.has(key)) {
          expensesByMonth.set(key, (expensesByMonth.get(key) || 0) + amount);
        }
      }

      // Unlinked delivery notes (drop out once linked to their invoice).
      for (const dn of trendDeliveryNotes || []) {
        const amount = Number(dn.subtotal || 0);
        const key = dn.delivery_date?.substring(0, 7);
        if (key && expensesByMonth.has(key)) {
          expensesByMonth.set(key, (expensesByMonth.get(key) || 0) + amount);
        }
      }

      setTrendsData(months.map(m => {
        const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
        return {
          month: m.label,
          income: Math.round(incomeByMonth.get(key) || 0),
          expenses: Math.round(expensesByMonth.get(key) || 0),
        };
      }));
    };

    fetchTrends();
  }, [selectedBusinesses, selectedYear, selectedMonth]);

  // Yearly view fetch — pulls every invoice (current + goods + employees) and
  // every unlinked delivery note in the selected year, then buckets the
  // subtotals into a supplier × month matrix. Runs only while the yearly toggle
  // is on so we don't pay the network cost when the user is in monthly view.
  useEffect(() => {
    if (viewMode !== "yearly") return;
    if (selectedBusinesses.length === 0 || !selectedYear) {
      setYearlySupplierRows([]);
      setYearlyMonthTotals(Array(12).fill(0));
      setYearlyGrandTotal(0);
      setYearlyRevenueTotal(0);
      setYearlyMonthlyRevenue(Array(12).fill(0));
      return;
    }
    const year = parseInt(selectedYear);
    if (isNaN(year)) return;

    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    let cancelled = false;

    const fetchYearly = async () => {
      setIsLoadingYearly(true);
      const supabase = createClient();
      const [{ data: invs }, { data: dns }, { data: dailyEntries }, { data: bizVatData }, { data: goalsVatData }] = await Promise.all([
        supabase
          .from("invoices")
          // attachment_url + invoice_number drive the per-cell "open fixed
          // expense" purple shading (matches the supplier-card / category
          // row semantics: row counts as unapproved when ALL its invoices
          // lack both an attachment AND a real invoice_number).
          .select("subtotal, reference_date, invoice_date, supplier_id, attachment_url, invoice_number, status, supplier:suppliers(name, expense_type, is_fixed_expense)")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .in("invoice_type", ["current", "goods", "employees"])
          .gte("reference_date", yearStart)
          .lte("reference_date", yearEnd),
        // Unlinked delivery notes count as actual expense until their invoice
        // arrives — bucket them by their own date, matching the monthly view.
        supabase
          .from("delivery_notes")
          .select("subtotal, delivery_date, supplier_id, supplier:suppliers(name, expense_type, is_fixed_expense)")
          .in("business_id", selectedBusinesses)
          .is("invoice_id", null)
          .gte("delivery_date", yearStart)
          .lte("delivery_date", yearEnd),
        // Daily entries for revenue — `total_register` is gross (incl. VAT),
        // divided by the business VAT divisor to match the monthly view's
        // "totalRevenue = totalRegister / vatDivisor" formula.
        supabase
          .from("daily_entries")
          .select("total_register, entry_date, business_id")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .gte("entry_date", yearStart)
          .lte("entry_date", yearEnd),
        supabase
          .from("businesses")
          .select("id, vat_percentage")
          .in("id", selectedBusinesses),
        // Goal-level VAT override (year-scoped goal first; monthly fallback below).
        supabase
          .from("goals")
          .select("business_id, vat_percentage, month")
          .in("business_id", selectedBusinesses)
          .eq("year", year),
      ]);
      if (cancelled) return;

      // Per-business VAT divisor — prefer the most recent goal row that has a
      // vat_percentage set, fall back to the business default.
      const vatDivisorByBiz = new Map<string, number>();
      for (const b of (bizVatData || [])) {
        const goalRows = (goalsVatData || []).filter(g => g.business_id === b.id && g.vat_percentage != null);
        // Latest month wins so a mid-year VAT change still applies.
        goalRows.sort((a, b2) => (b2.month || 0) - (a.month || 0));
        const vatPct = goalRows[0]?.vat_percentage != null
          ? Number(goalRows[0].vat_percentage)
          : Number(b.vat_percentage) || 0;
        vatDivisorByBiz.set(b.id, vatPct > 0 ? 1 + vatPct : 1);
      }

      let revenueTotal = 0;
      const monthlyRevenue = Array(12).fill(0);
      for (const entry of (dailyEntries || [])) {
        const dateStr = (entry as { entry_date: string | null }).entry_date;
        if (!dateStr) continue;
        const d = new Date(dateStr);
        if (isNaN(d.getTime()) || d.getFullYear() !== year) continue;
        const bizId = (entry as { business_id: string }).business_id;
        const divisor = vatDivisorByBiz.get(bizId) || 1;
        const beforeVat = (Number((entry as { total_register: number | null }).total_register) || 0) / divisor;
        revenueTotal += beforeVat;
        monthlyRevenue[d.getMonth()] += beforeVat;
      }
      setYearlyRevenueTotal(revenueTotal);
      setYearlyMonthlyRevenue(monthlyRevenue);

      type CellStatus = 'paid' | 'pending' | 'clarification' | 'unapproved' | null;
      type SupplierRow = {
        supplierId: string;
        name: string;
        expenseType: string | null;
        isFixed: boolean;
        monthly: number[];
        monthlyUnapproved: boolean[];
        // Tracks per (supplier, month) whether ANY invoice in that bucket is
        // approved (has attachment OR real invoice_number). Used to flip the
        // unapproved flag back off as soon as one real invoice lands.
        monthlyApproved: boolean[];
        // Per-cell counters used to derive `monthlyStatus` once all invoices
        // for the year are scanned. We can't decide the colour mid-loop
        // because a single clarification overrides paid+pending and a single
        // unpaid demotes a would-be green to white.
        monthlyClarification: boolean[];
        monthlyHasUnpaid: boolean[];
        monthlyHasPaid: boolean[];
        monthlyStatus: CellStatus[];
        total: number;
      };
      const rows = new Map<string, SupplierRow>();

      const ensureRow = (
        supplierId: string,
        supplier: { name: string | null; expense_type: string | null; is_fixed_expense: boolean | null } | null,
      ): SupplierRow => {
        let row = rows.get(supplierId);
        if (!row) {
          row = {
            supplierId,
            name: supplier?.name || "(ללא שם)",
            expenseType: supplier?.expense_type ?? null,
            isFixed: !!supplier?.is_fixed_expense,
            monthly: Array(12).fill(0),
            monthlyUnapproved: Array(12).fill(false),
            monthlyApproved: Array(12).fill(false),
            monthlyClarification: Array(12).fill(false),
            monthlyHasUnpaid: Array(12).fill(false),
            monthlyHasPaid: Array(12).fill(false),
            monthlyStatus: Array(12).fill(null),
            total: 0,
          };
          rows.set(supplierId, row);
        }
        return row;
      };

      const addAmount = (
        supplierId: string | null | undefined,
        supplier: { name: string | null; expense_type: string | null; is_fixed_expense: boolean | null } | null,
        dateStr: string | null | undefined,
        rawSubtotal: unknown,
      ): { row: SupplierRow; monthIdx: number } | null => {
        if (!supplierId || !dateStr) return null;
        const d = new Date(dateStr);
        if (isNaN(d.getTime()) || d.getFullYear() !== year) return null;
        const monthIdx = d.getMonth();
        const amount = Number(rawSubtotal) || 0;
        if (amount === 0) return null;
        const row = ensureRow(supplierId, supplier);
        row.monthly[monthIdx] += amount;
        row.total += amount;
        return { row, monthIdx };
      };

      for (const inv of invs || []) {
        const supplier = inv.supplier as unknown as { name: string | null; expense_type: string | null; is_fixed_expense: boolean | null } | null;
        const sid = (inv as unknown as { supplier_id: string | null }).supplier_id;
        const dateStr = (inv as unknown as { reference_date: string | null; invoice_date: string | null }).reference_date
          || (inv as unknown as { reference_date: string | null; invoice_date: string | null }).invoice_date;
        const added = addAmount(sid, supplier, dateStr, inv.subtotal);
        // For fixed-expense suppliers, decide if THIS month's bucket is still
        // an open placeholder. Mirror the supplier-card rule (#22): the cell
        // is unapproved only when EVERY invoice in that bucket lacks both an
        // attachment AND a real invoice_number. The moment a real invoice
        // lands, the cell flips out of purple and stays out.
        if (added && supplier?.is_fixed_expense) {
          const invRaw = inv as unknown as { attachment_url: string | null; invoice_number: string | null };
          const hasAttachment = invRaw.attachment_url && String(invRaw.attachment_url).trim() !== "";
          const hasReference = invRaw.invoice_number && String(invRaw.invoice_number).trim() !== "" && invRaw.invoice_number !== "-";
          const isApproved = !!(hasAttachment || hasReference);
          if (isApproved) {
            added.row.monthlyApproved[added.monthIdx] = true;
            // An approved invoice overrides any earlier placeholder in the same month
            added.row.monthlyUnapproved[added.monthIdx] = false;
          } else if (!added.row.monthlyApproved[added.monthIdx]) {
            added.row.monthlyUnapproved[added.monthIdx] = true;
          }
        }
        // Track per-cell invoice statuses so we can colour the amount:
        //   any 'clarification' wins → orange
        //   all 'paid' (no unpaid) → green
        //   any other (pending) → white
        if (added) {
          const status = (inv as unknown as { status: string | null }).status;
          if (status === 'clarification') {
            added.row.monthlyClarification[added.monthIdx] = true;
          } else if (status === 'paid') {
            added.row.monthlyHasPaid[added.monthIdx] = true;
          } else {
            // pending / null / anything else counts as "still owed"
            added.row.monthlyHasUnpaid[added.monthIdx] = true;
          }
        }
      }
      for (const dn of dns || []) {
        const supplier = dn.supplier as unknown as { name: string | null; expense_type: string | null; is_fixed_expense: boolean | null } | null;
        const sid = (dn as unknown as { supplier_id: string | null }).supplier_id;
        const dateStr = (dn as unknown as { delivery_date: string | null }).delivery_date;
        const added = addAmount(sid, supplier, dateStr, dn.subtotal);
        // Unlinked delivery notes are owed by definition — they bump the cell
        // into "pending" territory regardless of the invoice statuses already
        // bucketed there.
        if (added) {
          added.row.monthlyHasUnpaid[added.monthIdx] = true;
        }
      }

      const rowsArr = Array.from(rows.values()).sort((a, b) => b.total - a.total);
      // Resolve per-cell status now that every invoice/DN has been bucketed.
      // Priority: clarification > unapproved-placeholder > paid > pending.
      // "Unapproved" wins over paid because a placeholder row hasn't really
      // been settled even if a phantom payment was attached (matches the
      // supplier-card semantics — purple still means "no real document yet").
      for (const r of rowsArr) {
        for (let i = 0; i < 12; i++) {
          if (r.monthly[i] <= 0) {
            r.monthlyStatus[i] = null;
            continue;
          }
          if (r.monthlyClarification[i]) {
            r.monthlyStatus[i] = 'clarification';
          } else if (r.isFixed && r.monthlyUnapproved[i]) {
            r.monthlyStatus[i] = 'unapproved';
          } else if (r.monthlyHasPaid[i] && !r.monthlyHasUnpaid[i]) {
            r.monthlyStatus[i] = 'paid';
          } else {
            r.monthlyStatus[i] = 'pending';
          }
        }
      }
      const monthTotals = Array(12).fill(0);
      let grand = 0;
      for (const r of rowsArr) {
        for (let i = 0; i < 12; i++) monthTotals[i] += r.monthly[i];
        grand += r.total;
      }
      setYearlySupplierRows(rowsArr);
      setYearlyMonthTotals(monthTotals);
      setYearlyGrandTotal(grand);
      setIsLoadingYearly(false);
    };

    fetchYearly();
    return () => { cancelled = true; };
  }, [viewMode, selectedBusinesses, selectedYear, refreshTrigger]);

  // Patch current month in chart with actual summary values so they always match
  useEffect(() => {
    if (trendsData.length === 0 || (summary.totalRevenue === 0 && summary.totalExpenses === 0)) return;
    const monthNames = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
    const month = parseInt(selectedMonth);
    if (isNaN(month)) return;
    const currentMonthLabel = monthNames[month - 1];
    const lastEntry = trendsData[trendsData.length - 1];
    if (lastEntry?.month !== currentMonthLabel) return;
    const patchedIncome = Math.round(summary.totalRevenue);
    const patchedExpenses = Math.round(summary.totalExpenses);
    if (lastEntry.income === patchedIncome && lastEntry.expenses === patchedExpenses) return;
    setTrendsData(prev => prev.map((d, i) =>
      i === prev.length - 1 ? { ...d, income: patchedIncome, expenses: patchedExpenses } : d
    ));
  }, [summary, trendsData, selectedMonth]);

  // Fetch data from Supabase
  useEffect(() => {
    const fetchData = async () => {
      const year = parseInt(selectedYear);
      const month = parseInt(selectedMonth);

      if (selectedBusinesses.length === 0 || isNaN(year) || isNaN(month)) {
        setExpenseCategories([]);
        setIsLoadingReport(false);
        return;
      }

      const supabase = createClient();
      setIsLoadingReport(true);

      try {
        const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
        const lastDay = new Date(year, month, 0);
        const endDate = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;

        const [
          { data: categoriesData },
          { data: businessData },
          { data: goalsData },
          { data: invoicesData },
          { data: deliveryNotesData },
          { data: supplierBudgetsData },
          { data: dailyEntries },
        ] = await Promise.all([
          supabase
            .from("expense_categories")
            .select("id, name, parent_id")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .eq("is_active", true),
          supabase
            .from("businesses")
            .select("vat_percentage, markup_percentage, manager_monthly_salary")
            .in("id", selectedBusinesses),
          supabase
            .from("goals")
            .select("*")
            .in("business_id", selectedBusinesses)
            .eq("year", year)
            .eq("month", month)
            .is("deleted_at", null),
          supabase
            .from("invoices")
            .select("subtotal, supplier_id, status, invoice_number, attachment_url, supplier:suppliers(name, expense_category_id, expense_type, is_fixed_expense)")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .in("invoice_type", ["current", "goods", "employees"])
            .gte("reference_date", startDate)
            .lte("reference_date", endDate),
          // Unlinked delivery notes — count as actual expenses until their invoice arrives.
          supabase
            .from("delivery_notes")
            .select("subtotal, supplier_id, supplier:suppliers(name, expense_category_id, expense_type, is_fixed_expense)")
            .in("business_id", selectedBusinesses)
            .is("invoice_id", null)
            .gte("delivery_date", startDate)
            .lte("delivery_date", endDate),
          supabase
            .from("supplier_budgets")
            .select("budget_amount, supplier_id, supplier:suppliers(name, expense_category_id, expense_type, is_fixed_expense)")
            .in("business_id", selectedBusinesses)
            .eq("year", year)
            .eq("month", month)
            .is("deleted_at", null),
          supabase
            .from("daily_entries")
            .select("total_register, labor_cost, manager_daily_cost, day_factor, business_id")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .gte("entry_date", startDate)
            .lte("entry_date", endDate),
        ]);

        // Fetch prior commitments that are active during this month
        const { data: priorCommitmentsData } = await supabase
          .from("prior_commitments")
          .select("name, monthly_amount, total_installments, start_date, end_date")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .lte("start_date", endDate)
          .gte("end_date", startDate);

        const activeCommitments = (priorCommitmentsData || []) as PriorLiabilityItem[];
        const totalPriorLiabilities = activeCommitments.reduce((sum, c) => sum + Number(c.monthly_amount || 0), 0);
        setPriorLiabilities(totalPriorLiabilities);
        setPriorLiabilitiesItems(activeCommitments.sort((a, b) => Number(b.monthly_amount) - Number(a.monthly_amount)));

        // Fetch all payment splits due this month (cash flow forecast actual)
        // payment_splits query removed — cash flow actual is now calculated from operatingProfit

        // Fetch schedule for expected work days calculation
        const [{ data: scheduleData }, { data: dayExceptionsData }] = await Promise.all([
          supabase
            .from("business_schedule")
            .select("day_of_week, day_factor")
            .in("business_id", selectedBusinesses),
          supabase
            .from("business_day_exceptions")
            .select("exception_date, day_factor")
            .in("business_id", selectedBusinesses)
            .gte("exception_date", startDate)
            .lte("exception_date", endDate),
        ]);

        // Employee-cost month-close state for the displayed month.
        const { data: laborCloseData } = await supabase
          .from("labor_month_close")
          .select("business_id")
          .in("business_id", selectedBusinesses)
          .eq("period_year", year)
          .eq("period_month", month)
          .eq("status", "closed");
        const closedBusinessIds = new Set((laborCloseData || []).map((r) => r.business_id));
        // V1: treat labor as closed only when EVERY selected business is closed.
        // Exact for single-business view; conservative (keeps estimate) for partial multi-select.
        const laborMonthClosed =
          selectedBusinesses.length > 0 && selectedBusinesses.every((id) => closedBusinessIds.has(id));

        // Employee-cost suppliers for the single selected business (for the close modal).
        const { data: empSuppliers } = await supabase
          .from("suppliers")
          .select("id, name")
          .eq("business_id", selectedBusinesses[0])
          .eq("expense_type", "employee_costs")
          .eq("is_active", true)
          .is("deleted_at", null);

        // Goal for this month
        const goal = goalsData?.[0];

        // Calculate totals
        const totalRegister = (dailyEntries || []).reduce((sum, d) => sum + Number(d.total_register || 0), 0);
        const rawLaborCost = (dailyEntries || []).reduce((sum, d) => sum + Number(d.labor_cost || 0), 0);
        const rawManagerCost = (dailyEntries || []).reduce((sum, d) => sum + Number(d.manager_daily_cost || 0), 0);

        // Calculate labor cost with markup (same formula as goals page)
        const avgMarkup = goal?.markup_percentage != null
          ? Number(goal.markup_percentage)
          : (businessData || []).reduce((sum, b) => sum + (Number(b.markup_percentage) || 1), 0) / Math.max((businessData || []).length, 1);
        const totalManagerSalary = (goal as { manager_monthly_salary?: number | null } | undefined)?.manager_monthly_salary != null
          ? Number((goal as { manager_monthly_salary: number }).manager_monthly_salary)
          : (businessData || []).reduce((sum, b) => sum + (Number(b.manager_monthly_salary) || 0), 0);

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
        // Build exception map
        const exceptionMap: Record<string, number> = {};
        (dayExceptionsData || []).forEach((e: { exception_date: string; day_factor: number }) => {
          const d = new Date(e.exception_date);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          exceptionMap[key] = Number(e.day_factor);
        });
        const firstDay = new Date(year, month - 1, 1);
        let scheduleWorkDays = 0;
        const curDate = new Date(firstDay);
        while (curDate <= lastDay) {
          const dateKey = `${curDate.getFullYear()}-${String(curDate.getMonth() + 1).padStart(2, '0')}-${String(curDate.getDate()).padStart(2, '0')}`;
          if (exceptionMap[dateKey] !== undefined) {
            scheduleWorkDays += exceptionMap[dateKey];
          } else {
            scheduleWorkDays += avgScheduleDayFactors[curDate.getDay()] || 0;
          }
          curDate.setDate(curDate.getDate() + 1);
        }
        const expectedWorkDays = (goal?.expected_work_days != null && Number(goal.expected_work_days) > 0)
          ? Number(goal.expected_work_days)
          : scheduleWorkDays;
        const managerDailyCost = expectedWorkDays > 0 ? totalManagerSalary / expectedWorkDays : 0;
        const actualWorkDays = (dailyEntries || []).reduce((sum, e) => sum + (Number(e.day_factor) || 0), 0);

        // VAT divisor from business (vat_percentage stored as decimal, e.g. 0.18 for 18%)
        const vatPercentage = Number(businessData?.[0]?.vat_percentage || 0);
        const vatDivisor = vatPercentage > 0 ? 1 + vatPercentage : 1;

        // Labor: (labor + manager) × markup — matches dashboard exactly.
        // Manager cost is ALWAYS computed from monthly_salary, not from DB column
        // (DB column is unreliable — empty for most days).
        const computedManagerCost = managerDailyCost * actualWorkDays;
        const totalLaborCost = (rawLaborCost + computedManagerCost) * avgMarkup;
        setLaborMonthClosedState(laborMonthClosed);
        setSalaryEstimateState(rawLaborCost + computedManagerCost);
        setEmployerEstimateState((rawLaborCost + computedManagerCost) * (avgMarkup - 1));
        const laborOnlyCost = rawLaborCost * avgMarkup;
        const managerOnlyCost = computedManagerCost * avgMarkup;
        void rawManagerCost;
        const totalRevenue = totalRegister / vatDivisor;

        // Calculate actual totals by category + separate goods/current totals + per-supplier tracking
        const categoryActuals = new Map<string, number>();
        const supplierActuals = new Map<string, number>();
        const supplierNames = new Map<string, string>();
        const supplierExpenseTypes = new Map<string, string>();
        // Track suppliers with open fixed expenses (#22 - show in purple)
        const suppliersWithUnapproved = new Set<string>();
        // Track suppliers that have at least one approved invoice — overrides purple
        const suppliersApproved = new Set<string>();
        // Track which category each supplier belongs to (for 3-level drill-down)
        const supplierCategoryMap = new Map<string, string>();
        let totalGoodsExpenses = 0;
        let totalCurrentExpenses = 0;
        // Sum of actual employee-cost invoices this month. When the labor month is
        // closed this is the source of truth for the labor line — robust to supplier
        // categorization (e.g. the system salary supplier has no expense_category_id).
        let laborEmployeeCostsActual = 0;
        let totalCredits = 0; // Track credits/cancellations (#30)
        if (invoicesData) {
          for (const inv of invoicesData) {
            const supplier = inv.supplier as unknown as { name: string | null; expense_category_id: string | null; expense_type: string | null; is_fixed_expense: boolean | null } | null;
            const catId = supplier?.expense_category_id;
            const expType = supplier?.expense_type;
            const supplierId = (inv as unknown as { supplier_id: string | null }).supplier_id;
            const amount = Number(inv.subtotal);
            // Track credits for reporting, but STILL include them in expense totals so
            // they reduce the corresponding category/supplier/global totals — a credit
            // note means the supplier refunded money, so it must lower the net expense.
            if (amount < 0) totalCredits += amount;
            if (catId) {
              const current = categoryActuals.get(catId) || 0;
              categoryActuals.set(catId, current + amount);
            }
            if (supplierId) {
              supplierActuals.set(supplierId, (supplierActuals.get(supplierId) || 0) + amount);
              if (supplier?.name) supplierNames.set(supplierId, supplier.name);
              if (catId) supplierCategoryMap.set(supplierId, catId);
              if (expType) supplierExpenseTypes.set(supplierId, expType);
              // Track open fixed expenses (#22): purple only when ALL invoices lack both attachment AND reference
              const invRaw = inv as unknown as { invoice_number: string | null; attachment_url: string | null };
              const hasAttachment = invRaw.attachment_url && String(invRaw.attachment_url).trim() !== "";
              const hasReference = invRaw.invoice_number && String(invRaw.invoice_number).trim() !== "" && invRaw.invoice_number !== "-";
              const isApproved = hasAttachment || hasReference;
              if (supplier?.is_fixed_expense) {
                if (isApproved) {
                  // Any approved invoice removes purple status
                  suppliersWithUnapproved.delete(supplierId);
                  suppliersApproved.add(supplierId);
                } else if (!suppliersApproved.has(supplierId)) {
                  suppliersWithUnapproved.add(supplierId);
                }
              }
            }
            if (expType === "goods_purchases") {
              totalGoodsExpenses += amount;
            } else if (expType === "current_expenses") {
              totalCurrentExpenses += amount;
            } else if (expType === "employee_costs") {
              laborEmployeeCostsActual += amount;
            }
          }
        }

        // Also include unlinked delivery notes in the per-supplier / per-category actuals.
        // When a delivery note gets linked to an invoice, it drops out of this query (invoice_id not null).
        if (deliveryNotesData) {
          for (const dn of deliveryNotesData) {
            const supplier = dn.supplier as unknown as { name: string | null; expense_category_id: string | null; expense_type: string | null; is_fixed_expense: boolean | null } | null;
            const catId = supplier?.expense_category_id;
            const expType = supplier?.expense_type;
            const supplierId = (dn as unknown as { supplier_id: string | null }).supplier_id;
            const amount = Number(dn.subtotal);
            // Negative DN subtotals (rare — returns) reduce the totals, matching daily-modal/dashboard semantics.
            if (catId) {
              categoryActuals.set(catId, (categoryActuals.get(catId) || 0) + amount);
            }
            if (supplierId) {
              supplierActuals.set(supplierId, (supplierActuals.get(supplierId) || 0) + amount);
              if (supplier?.name) supplierNames.set(supplierId, supplier.name);
              if (catId) supplierCategoryMap.set(supplierId, catId);
              if (expType) supplierExpenseTypes.set(supplierId, expType);
            }
            if (expType === "goods_purchases") totalGoodsExpenses += amount;
            else if (expType === "current_expenses") totalCurrentExpenses += amount;
          }
        }

        // Build supplier budget targets by category + per-supplier budgets
        const categoryBudgets = new Map<string, number>();
        const supplierBudgets = new Map<string, number>();
        if (supplierBudgetsData) {
          for (const sb of supplierBudgetsData) {
            const supplier = sb.supplier as unknown as { name: string | null; expense_category_id: string | null; expense_type: string | null; is_fixed_expense: boolean | null } | null;
            const catId = supplier?.expense_category_id;
            const supplierId = (sb as unknown as { supplier_id: string | null }).supplier_id;
            const budgetAmount = Number(sb.budget_amount || 0);
            if (catId) {
              const current = categoryBudgets.get(catId) || 0;
              categoryBudgets.set(catId, current + budgetAmount);
            }
            if (supplierId) {
              supplierBudgets.set(supplierId, budgetAmount);
              if (supplier?.name) supplierNames.set(supplierId, supplier.name);
              if (catId) supplierCategoryMap.set(supplierId, catId);
              if (supplier?.expense_type) supplierExpenseTypes.set(supplierId, supplier.expense_type);
              // Fixed expense supplier with no invoice this month → actual = budget
              if (supplier?.is_fixed_expense && budgetAmount > 0 && !supplierActuals.has(supplierId)) {
                supplierActuals.set(supplierId, budgetAmount);
                if (catId) categoryActuals.set(catId, (categoryActuals.get(catId) || 0) + budgetAmount);
                if (supplier.expense_type === "current_expenses") totalCurrentExpenses += budgetAmount;
                else if (supplier.expense_type === "goods_purchases") totalGoodsExpenses += budgetAmount;
                // No invoice at all → still open fixed expense → purple (unless already approved elsewhere)
                if (!suppliersApproved.has(supplierId)) suppliersWithUnapproved.add(supplierId);
              }
            }
          }
        }

        // Employee-cost suppliers for the close modal, each pre-filled with the
        // amount already recorded for it this month (so the user just corrects;
        // 0 when nothing was recorded yet).
        setEmployeeSuppliersState(
          (empSuppliers || [])
            .filter((s) => s.name !== "משכורות עובדים")
            .map((s) => ({ id: s.id, name: s.name, amount: supplierActuals.get(s.id) || 0 }))
        );

        // Build expense categories display.
        // goals.current_expenses_target is stored INCLUDING VAT (same convention
        // as revenue_target — see line 631 below). The whole report is ex-VAT,
        // so divide here too. Without this, the legacy fallback below
        // (Math.max(sum-of-supplier-budgets, this value)) inflates the total
        // by the VAT rate when the user hasn't broken down the budget into
        // per-supplier rows yet — that's how נס ציונה ended up showing
        // ₪140.9K when the math says ₪132.1K.
        const expensesTarget = Number(goal?.current_expenses_target || 0) / vatDivisor;

        // Calculate food cost (עלות מכר) target: (food_cost_target_pct / 100) * (revenue_target / vatDivisor)
        const foodCostTargetPct = Number(goal?.food_cost_target_pct || 0);
        const revenueTargetBeforeVat = Number(goal?.revenue_target || 0) / vatDivisor;
        const foodCostTarget = (foodCostTargetPct / 100) * revenueTargetBeforeVat;

        // Group categories by parent
        // Merge "עלויות עובדים" into "עלות עובדים" to avoid duplicates
        const laborCostNames = new Set(["עלות עובדים", "עלויות עובדים"]);
        const laborParents = (categoriesData || []).filter(c => !c.parent_id && laborCostNames.has(c.name));
        const laborParentIds = new Set(laborParents.map(c => c.id));
        const primaryLaborParent = laborParents.find(c => c.name === "עלות עובדים") || laborParents[0];
        const parentCategoriesRaw = (categoriesData || []).filter(c => !c.parent_id && !(laborCostNames.has(c.name) && c.id !== primaryLaborParent?.id));
        // Ensure "עלות עובדים" parent always exists in the report — labor data
        // comes from daily_entries, not invoices, so the row should render even
        // when the business has no expense_categories row for it.
        const parentCategories = laborParents.length > 0
          ? parentCategoriesRaw
          : [...parentCategoriesRaw, { id: "__virtual_labor_parent__", name: "עלות עובדים", parent_id: null }];
        const childCategories = (categoriesData || []).filter(c => c.parent_id);

        const displayCategories: ExpenseCategoryDisplay[] = parentCategories.map(parent => {
          const isGoodsCost = parent.name === "עלות מכר";
          // For labor cost parent: merge children from all labor parent categories
          const children = laborCostNames.has(parent.name)
            ? childCategories.filter(c => laborParentIds.has(c.parent_id!))
            : childCategories.filter(c => c.parent_id === parent.id);

          // For "עלות מכר": show individual goods_purchases suppliers instead of subcategories
          let subcategoriesData: ExpenseCategoryDisplay["subcategories"];
          if (isGoodsCost) {
            // Build supplier list from goods_purchases suppliers only
            const goodsSupplierIds = new Set<string>();
            supplierBudgets.forEach((_, id) => {
              if (supplierExpenseTypes.get(id) === "goods_purchases") goodsSupplierIds.add(id);
            });
            supplierActuals.forEach((_, id) => {
              if (supplierExpenseTypes.get(id) === "goods_purchases") goodsSupplierIds.add(id);
            });

            subcategoriesData = Array.from(goodsSupplierIds).map(supplierId => {
              const actual = supplierActuals.get(supplierId) || 0;
              const target = supplierBudgets.get(supplierId) || 0;
              const diff = target - actual;
              const remaining = target > 0 ? ((target - actual) / target) * 100 : 0;
              return {
                id: supplierId,
                name: supplierNames.get(supplierId) || "ספק לא ידוע",
                target: formatCurrency(target),
                actual: formatCurrency(actual),
                difference: formatDifference(diff),
                remaining: formatPercentage(remaining),
                remainingRaw: remaining,
                diffRaw: diff,
                actualRaw: actual,
                targetRaw: target,
                hasUnapproved: suppliersWithUnapproved.has(supplierId),
                suppliers: [],
              };
            }).filter(s => parseFloat(s.actual.replace(/[₪K,]/g, "")) > 0 || parseFloat(s.target.replace(/[₪K,]/g, "")) > 0)
              .sort((a, b) => parseFloat(b.actual.replace(/[₪K,]/g, "")) - parseFloat(a.actual.replace(/[₪K,]/g, "")));
          } else {
            const isLaborCostCategory = laborCostNames.has(parent.name);
            // Collect suppliers assigned directly to the parent (not to any child)
            const childIds = new Set(children.map(c => c.id));
            const parentOnlySupplierIds: string[] = [];
            supplierCategoryMap.forEach((catId, supplierId) => {
              if ((catId === parent.id || (isLaborCostCategory && laborParentIds.has(catId))) && !childIds.has(catId)) {
                parentOnlySupplierIds.push(supplierId);
              }
            });
            const parentSuppliersAssigned = new Set<string>();

            // For labor cost: always inject totalLaborCost into the "עלות עובדים" subcategory
            // because labor cost comes from daily_entries, not invoices
            let laborCostAssigned = false;

            subcategoriesData = children.map((child, childIndex) => {
              let actual = categoryActuals.get(child.id) || 0;
              let target = categoryBudgets.get(child.id) || 0;

              // Skip injecting totalLaborCost into children — virtual subcategories handle this
              if (isLaborCostCategory && !laborCostAssigned) {
                laborCostAssigned = true; // Mark as handled — virtual subs will be added after
              }

              // Build suppliers list for this subcategory
              const childSuppliers: SupplierDisplay[] = [];
              supplierCategoryMap.forEach((catId, supplierId) => {
                if (catId === child.id) {
                  const sActual = supplierActuals.get(supplierId) || 0;
                  const sTarget = supplierBudgets.get(supplierId) || 0;
                  const sDiff = sTarget - sActual;
                  const sRemaining = sTarget > 0 ? ((sTarget - sActual) / sTarget) * 100 : 0;
                  if (sActual > 0 || sTarget > 0) {
                    childSuppliers.push({
                      name: supplierNames.get(supplierId) || "ספק לא ידוע",
                      target: formatCurrency(sTarget),
                      actual: formatCurrency(sActual),
                      difference: formatDifference(sDiff),
                      remaining: formatPercentage(sRemaining),
                      remainingRaw: sRemaining,
                      diffRaw: sDiff,
                      actualRaw: sActual,
                      targetRaw: sTarget,
                      hasUnapproved: suppliersWithUnapproved.has(supplierId),
                    });
                  }
                }
              });

              // Assign parent-level suppliers to matching child by name, or last child as fallback
              for (const supplierId of parentOnlySupplierIds) {
                if (parentSuppliersAssigned.has(supplierId)) continue;
                const sName = (supplierNames.get(supplierId) || "").trim().toLowerCase();
                const cName = child.name.trim().toLowerCase();
                const isMatch = sName.includes(cName) || cName.includes(sName);
                const isLastChild = childIndex === children.length - 1;
                if (isMatch || isLastChild) {
                  parentSuppliersAssigned.add(supplierId);
                  const sActual = supplierActuals.get(supplierId) || 0;
                  const sTarget = supplierBudgets.get(supplierId) || 0;
                  if (sActual > 0 || sTarget > 0) {
                    const sDiff = sTarget - sActual;
                    const sRemaining = sTarget > 0 ? ((sTarget - sActual) / sTarget) * 100 : 0;
                    childSuppliers.push({
                      name: supplierNames.get(supplierId) || "ספק לא ידוע",
                      target: formatCurrency(sTarget),
                      actual: formatCurrency(sActual),
                      difference: formatDifference(sDiff),
                      remaining: formatPercentage(sRemaining),
                      remainingRaw: sRemaining,
                      diffRaw: sDiff,
                      actualRaw: sActual,
                      targetRaw: sTarget,
                      hasUnapproved: suppliersWithUnapproved.has(supplierId),
                    });
                    actual += sActual;
                    target += sTarget;
                  }
                }
              }

              childSuppliers.sort((a, b) => parseFloat(b.actual.replace(/[₪K,]/g, "")) - parseFloat(a.actual.replace(/[₪K,]/g, "")));

              const diff = target - actual;
              const remaining = target > 0 ? ((target - actual) / target) * 100 : 0;

              return {
                id: child.id,
                name: child.name,
                target: formatCurrency(target),
                actual: formatCurrency(actual),
                difference: formatDifference(diff),
                remaining: formatPercentage(remaining),
                remainingRaw: remaining,
                diffRaw: diff,
                actualRaw: actual,
                targetRaw: target,
                suppliers: childSuppliers,
              };
            }).filter(sub => sub.actualRaw > 0 || sub.targetRaw > 0);
          }

          // Sum up for parent
          const isLaborCost = laborCostNames.has(parent.name);
          const childrenActual = children.reduce((sum, c) => sum + (categoryActuals.get(c.id) || 0), 0) || categoryActuals.get(parent.id) || 0;
          const childrenBudget = children.reduce((sum, c) => sum + (categoryBudgets.get(c.id) || 0), 0) || categoryBudgets.get(parent.id) || 0;
          // For labor cost: actual from daily entries with markup, target from labor_cost_target_pct
          const laborCostTargetPct = Number(goal?.labor_cost_target_pct || 0);
          const laborCostTarget = (laborCostTargetPct / 100) * revenueTargetBeforeVat;

          // Inject virtual subcategories for labor cost: "עלות עובדים" and "שכר מנהל"
          if (isLaborCost && (laborOnlyCost > 0 || managerOnlyCost > 0)) {
            const laborDiff = laborCostTarget - laborOnlyCost;
            const laborRemaining = laborCostTarget > 0 ? ((laborCostTarget - laborOnlyCost) / laborCostTarget) * 100 : 0;
            const virtualSubs: SubcategoryDisplay[] = [];
            if (laborOnlyCost > 0 || laborCostTarget > 0) {
              virtualSubs.push({
                id: "__labor_employees__",
                name: "עלות עובדים",
                target: formatCurrency(laborCostTarget),
                actual: formatCurrency(laborOnlyCost),
                difference: formatDifference(laborDiff),
                remaining: formatPercentage(laborRemaining),
                remainingRaw: laborRemaining,
                diffRaw: laborDiff,
                actualRaw: laborOnlyCost,
                targetRaw: laborCostTarget,
                suppliers: [],
              });
            }
            if (managerOnlyCost > 0) {
              virtualSubs.push({
                id: "__labor_manager__",
                name: "שכר מנהל כולל העמסה",
                target: "—",
                actual: formatCurrency(managerOnlyCost),
                difference: "—",
                remaining: "—",
                remainingRaw: 0,
                diffRaw: 0,
                actualRaw: managerOnlyCost,
                targetRaw: 0,
                suppliers: [],
              });
            }
            const employerEstimate = (rawLaborCost + computedManagerCost) * (avgMarkup - 1);
            if (!laborMonthClosed && employerEstimate > 0) {
              virtualSubs.push({
                id: "__labor_employer__",
                name: "עלויות מעביד (הערכה)",
                target: "—",
                actual: formatCurrency(employerEstimate),
                difference: "—",
                remaining: "—",
                remainingRaw: 0,
                diffRaw: 0,
                actualRaw: employerEstimate,
                targetRaw: 0,
                suppliers: [],
              });
            }
            // Keep non-labor subcategories (e.g. employee-type suppliers) and add virtual ones
            subcategoriesData = [
              ...virtualSubs,
              ...subcategoriesData.filter(s => s.id !== "__labor_employees__" && s.id !== "__labor_manager__"),
            ];
          }
          // For labor: totalLaborCost (daily labor+manager with markup) + invoice-based subcategories (pension, extra costs, etc.)
          const laborInvoiceActual = isLaborCost ? children.reduce((sum, c) => sum + (categoryActuals.get(c.id) || 0), 0) : 0;
          // Labor: when the month is closed, use the actual employee-cost invoices
          // directly (source of truth); otherwise the daily estimate + any invoice subs.
          const parentActual = isGoodsCost ? Math.max(childrenActual, totalGoodsExpenses) : isLaborCost ? (laborMonthClosed ? laborEmployeeCostsActual : totalLaborCost + laborInvoiceActual) : childrenActual;
          const parentTarget = isGoodsCost ? foodCostTarget : isLaborCost ? laborCostTarget : childrenBudget;
          const parentDiff = parentTarget - parentActual;
          const parentRemaining = parentTarget > 0 ? ((parentTarget - parentActual) / parentTarget) * 100 : 0;

          return {
            id: parent.id,
            name: parent.name,
            target: formatCurrency(parentTarget),
            actual: formatCurrency(parentActual),
            difference: formatDifference(parentDiff),
            remaining: formatPercentage(parentRemaining),
            remainingRaw: parentRemaining,
            diffRaw: parentDiff,
            actualRaw: parentActual,
            targetRaw: parentTarget,
            subcategories: subcategoriesData,
            isClosedLabor: isLaborCost && laborMonthClosed,
            isLaborParent: isLaborCost,
          };
        }).filter(cat => parseFloat(cat.actual.replace(/[₪K,]/g, "")) > 0 || parseFloat(cat.target.replace(/[₪K,]/g, "")) > 0 || cat.subcategories.length > 0);

        // Fixed display order
        const categoryOrder = ["עלות מכר", "עלות עובדים", "הוצאות שיווק ומכירות", "הוצאות תפעול"];
        displayCategories.sort((a, b) => {
          const aIdx = categoryOrder.indexOf(a.name);
          const bIdx = categoryOrder.indexOf(b.name);
          return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
        });

        setExpenseCategories(displayCategories);

        // Calculate summary
        // Total expenses = goods + current invoices + labor cost (from daily entries with markup)
        // Total expenses: goods + current + labor. Note: invoice-based labor subcategories
        // (pension, delivery co, etc.) are already counted in totalCurrentExpenses because
        // their suppliers have expense_type="current_expenses" — they are NOT double-counted.
        const allExpensesActual = totalGoodsExpenses + totalCurrentExpenses + (laborMonthClosed ? laborEmployeeCostsActual : totalLaborCost);
        // Total expenses target = sum of all displayed category targets. Previously
        // only goal.current_expenses_target (a single aggregate field) was used for
        // the non-food/non-labor bucket, which was often NULL — leaving the
        // supplier_budgets of categories like 'שיווק ופרסום'/'עמלות'/'רשויות'
        // unaccounted for even though the same targets WERE shown in the category
        // breakdown. Now: sum the per-category targetRaw values from what we
        // already display, so 'סה"כ הוצאות' matches the sum of the category rows.
        const currentExpensesTargetFromBudgets = displayCategories
          .filter(cat => cat.name !== "עלות מכר" && !laborCostNames.has(cat.name))
          .reduce((sum, cat) => sum + (cat.targetRaw || 0), 0);
        const laborCostTargetPctSummary = Number(goal?.labor_cost_target_pct || 0);
        // Prefer the larger of: sum-of-budgets or the legacy single expensesTarget
        // field (in case a business only uses the single aggregate and no per-
        // supplier budgets).
        const currentExpensesTarget = Math.max(currentExpensesTargetFromBudgets, expensesTarget);
        const allExpensesTarget = foodCostTarget + currentExpensesTarget + (laborCostTargetPctSummary / 100) * revenueTargetBeforeVat;
        // Operating profit = revenue - all expenses
        const operatingProfit = totalRevenue - allExpensesActual;
        const operatingProfitPct = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0;

        setSummary({
          totalRevenue,
          revenueTarget: Number(goal?.revenue_target || 0) / vatDivisor,
          totalExpenses: allExpensesActual,
          expensesTarget: allExpensesTarget,
          totalCredits,
          operatingProfit,
          operatingProfitPct,
          netProfit: operatingProfit,
          netProfitPct: operatingProfitPct,
        });

        // Cash flow forecast: target = revenue (before VAT) - ALL expenses target (labor + food + current) - prior commitments
        const forecastTarget = revenueTargetBeforeVat - allExpensesTarget - totalPriorLiabilities;
        // Actual cash flow: operating profit (revenue - actual expenses) - prior commitments
        const forecastActual = operatingProfit - totalPriorLiabilities;
        setCashFlowForecast({ target: forecastTarget, actual: forecastActual });

      } catch (error) {
        console.error("Error fetching reports data:", error);
      } finally {
        setIsLoadingReport(false);
      }
    };

    fetchData();
  }, [selectedBusinesses, selectedMonth, selectedYear, refreshTrigger]);

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) =>
      prev.includes(id) ? prev.filter((catId) => catId !== id) : [...prev, id]
    );
  };

  const toggleSubcategory = (id: string) => {
    setExpandedSubcategories((prev) =>
      prev.includes(id) ? prev.filter((catId) => catId !== id) : [...prev, id]
    );
  };

  const handleReopenMonth = async () => {
    if (!confirm("פתיחה מחדש תמחק את חשבוניות הסגירה שטרם שולמו ותחזיר את ההערכה. להמשיך?")) return;
    const res = await fetch(
      `/api/labor-close?business_id=${selectedBusinesses[0]}&year=${parseInt(selectedYear)}&month=${parseInt(selectedMonth)}`,
      { method: "DELETE" }
    );
    const json = await res.json();
    if (!res.ok) { alert(json?.error || "פתיחה מחדש נכשלה"); return; }
    window.location.reload();
  };

  const months = [
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

  // Show message if no business selected
  if (selectedBusinesses.length === 0) {
    return (
      <article className="text-white p-[7px] pb-[80px]">
        <div className="bg-[#0F1535] rounded-[20px] p-[40px] text-center">
          <p className="text-[20px] text-white/70">יש לבחור עסק כדי לצפות בדוחות</p>
        </div>
      </article>
    );
  }

  return (
    <article aria-label="דוח רווח והפסד" className="text-white pt-0 px-[7px] pb-[80px] flex flex-col gap-[10px]">
      {/* Header Section - Title with Pig Icon */}
      <section aria-labelledby="report-title" className="bg-[#0F1535] rounded-[10px] py-[7px] min-h-[70px] flex items-center justify-start gap-[10px]">
        <div className="flex flex-row-reverse items-center gap-[3px]">
          <h1 id="report-title" className="text-[22px] font-bold text-center leading-[1.4]">סיכום תוצאות רווח והפסד</h1>
          {/* Pig Icon */}
          <svg width="22" height="22" viewBox="0 0 15 15" fill="none" className="flex-shrink-0" aria-hidden="true">
            <path fillRule="evenodd" clipRule="evenodd" d="M5.23877 4.32331C5.42468 3.69863 6.0038 3.24414 6.6875 3.24414C7.20053 3.24414 7.65408 3.49922 7.9282 3.89221C8.11919 4.16603 8.496 4.23317 8.76982 4.04218C9.04364 3.85118 9.11079 3.47438 8.91979 3.20056C8.42926 2.49731 7.6124 2.03516 6.6875 2.03516C5.45434 2.03516 4.4143 2.85523 4.08002 3.97844C3.98478 4.29843 4.16698 4.63502 4.48696 4.73025C4.80694 4.82548 5.14354 4.64329 5.23877 4.32331ZM3.09359 4.35159C3.37136 4.16639 3.44641 3.79108 3.26122 3.5133C3.07602 3.23553 2.70071 3.16048 2.42293 3.34567C1.74591 3.79705 1.4463 4.65416 1.58159 5.41523C1.68156 5.97761 2.01248 6.48027 2.56216 6.78484C2.30199 7.25893 2.15378 7.80355 2.15378 8.38232C2.15378 9.67506 2.89132 10.7943 3.96725 11.3443V12.3115C3.96725 12.6454 4.23789 12.916 4.57175 12.916H6.68747C7.02132 12.916 7.29196 12.6454 7.29196 12.3115V11.707H7.5942V12.3115C7.5942 12.6454 7.86484 12.916 8.19869 12.916H10.3144C10.6483 12.916 10.9189 12.6454 10.9189 12.3115V11.4802C11.5559 11.2315 12.0966 10.7925 12.4719 10.2335C13.1203 10.2115 13.6391 9.67898 13.6391 9.02525V7.73938C13.6391 7.08566 13.1203 6.55312 12.4719 6.5311C12.2221 6.15898 11.8991 5.84026 11.5234 5.59537V4.15088C11.5234 3.81702 11.2528 3.54638 10.9189 3.54638C9.80149 3.54638 9.07149 4.24163 8.48602 5.05761H5.47848C4.67542 5.05761 3.93815 5.34294 3.36377 5.81676C2.9648 5.69913 2.81421 5.44158 2.77191 5.20363C2.71022 4.85658 2.86394 4.5047 3.09359 4.35159ZM9.30615 5.99742C9.67682 5.44142 9.99047 5.09456 10.3144 4.91303V5.94486C10.3144 6.17436 10.4444 6.38406 10.6499 6.48619C11.0533 6.68667 11.3842 7.01261 11.5909 7.41248C11.6947 7.61327 11.9019 7.73938 12.1279 7.73938H12.4301L12.4301 9.02525H12.1279C11.9019 9.02525 11.6947 9.15136 11.5909 9.35215C11.3081 9.89916 10.794 10.3064 10.1806 10.4456C9.90533 10.5081 9.70992 10.7528 9.70992 11.0351V11.707H8.80319V11.4048C8.80319 10.904 8.39723 10.498 7.89645 10.498H6.98971C6.48894 10.498 6.08297 10.904 6.08297 11.4048V11.707H5.17624V10.9477C5.17624 10.6915 5.01474 10.4632 4.77319 10.3778C3.95063 10.0871 3.36276 9.30257 3.36276 8.38232C3.36276 7.80137 3.59611 7.27611 3.9756 6.89315C4.35968 6.50556 4.89061 6.2666 5.47848 6.2666H8.80319C9.0053 6.2666 9.19404 6.16558 9.30615 5.99742ZM10.0121 8.08007C10.3459 8.08007 10.6166 7.80943 10.6166 7.47558C10.6166 7.14173 10.3459 6.87109 10.0121 6.87109C9.67823 6.87109 9.40759 7.14173 9.40759 7.47558C9.40759 7.80943 9.67823 8.08007 10.0121 8.08007Z" fill="white"/>
          </svg>
        </div>
        <div className="ms-auto pe-[7px]">
          <ReportsHelpButton />
        </div>
      </section>

      {/* Summary Card - Total Result + Filters */}
      <section id="onboarding-reports-summary-top" aria-label="סיכום תוצאות" className="bg-[#0F1535] rounded-[10px] py-[7px] min-h-[70px] flex flex-col gap-[15px]">
        {/* Total Result Row — only the numbers stream in async, so the
            label stays put and the values get a skeleton during fetch. */}
        <div className="flex flex-row-reverse items-center justify-between w-full min-h-[40px] gap-[3px]">
          <div className="flex flex-row-reverse items-center gap-[10px] flex-1">
            {isLoadingReport ? (
              <>
                <Skeleton className="h-[22px] w-[110px] bg-white/10" />
                <Skeleton className="h-[20px] w-[70px] bg-white/10" />
              </>
            ) : (
              <>
                <span className="text-[18px] font-bold ltr-num">₪{summary.operatingProfit.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <div className="flex flex-row-reverse items-center gap-[2px] flex-1">
                  <svg width="15" height="15" viewBox="0 0 32 32" fill="none" className={summary.operatingProfitPct > 0 ? "text-[#17DB4E]" : summary.operatingProfitPct < 0 ? "text-[#F64E60]" : "text-white"} aria-hidden="true">
                    <path d={summary.operatingProfitPct >= 0 ? "M16 26V6M16 6L6 16M16 6L26 16" : "M16 6V26M16 26L6 16M16 26L26 16"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className={`text-[16px] font-bold ltr-num ${summary.operatingProfitPct > 0 ? "text-[#17DB4E]" : summary.operatingProfitPct < 0 ? "text-[#F64E60]" : "text-white"}`}>{summary.operatingProfitPct.toFixed(2)}%</span>
                </div>
              </>
            )}
          </div>
          <span className="text-[20px] font-bold leading-[1.4]">סה&quot;כ תוצאות רווח/הפסד</span>
        </div>

        {/* View-mode toggle — sticks in the same card as the filters so it
            reads as part of the "what am I looking at" controls. Monthly is
            the default (and what the rest of the report was built around);
            yearly swaps the report body for a 12-month supplier breakdown. */}
        <div id="onboarding-reports-viewtoggle" className="flex flex-row-reverse items-center w-full gap-[5px] p-[3px] bg-[#1a1f4e] rounded-[7px] border border-[#727BA0]">
          <button
            type="button"
            onClick={() => setViewMode("monthly")}
            className={`flex-1 h-[40px] rounded-[5px] text-[15px] font-semibold transition-colors ${
              viewMode === "monthly" ? "bg-[#29318A] text-white" : "bg-transparent text-white/60 hover:text-white"
            }`}
          >
            תצוגה חודשית
          </button>
          <button
            type="button"
            onClick={() => setViewMode("yearly")}
            className={`flex-1 h-[40px] rounded-[5px] text-[15px] font-semibold transition-colors ${
              viewMode === "yearly" ? "bg-[#29318A] text-white" : "bg-transparent text-white/60 hover:text-white"
            }`}
          >
            תצוגה שנתית
          </button>
        </div>

        {/* Date Filters Row — month selector is hidden in yearly view because
            the whole point of yearly is to show all 12 months side-by-side. */}
        <div id="onboarding-reports-filters" className="flex flex-row-reverse items-center justify-between w-full min-h-[40px] gap-[10px]">
          {viewMode === "monthly" && (
          <div className="flex-1">
            <Select value={selectedMonth || "__none__"} onValueChange={(val) => setSelectedMonth(val === "__none__" ? "" : val)}>
              <SelectTrigger className="w-full bg-transparent border border-[#727BA0] rounded-[7px] h-[50px] px-[12px] text-[18px] text-white font-bold text-right">
                <SelectValue placeholder="בחר/י חודש" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" disabled>בחר/י חודש</SelectItem>
                {months.map((month) => (
                  <SelectItem key={month.value} value={month.value}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}
          <div className="flex-1">
            <Select value={selectedYear || "__none__"} onValueChange={(val) => setSelectedYear(val === "__none__" ? "" : val)}>
              <SelectTrigger className="w-full bg-transparent border border-[#727BA0] rounded-[7px] h-[50px] px-[12px] text-[18px] text-white font-bold text-right">
                <SelectValue placeholder="בחר/י שנה" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" disabled>בחר/י שנה</SelectItem>
                <SelectItem value="2025">2025</SelectItem>
                <SelectItem value="2026">2026</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {viewMode === "monthly" ? (<>

      {/* 6-Month Income vs Expenses Chart — section header + legend are
          static so they render immediately; the chart body shows a
          skeleton until trendsData lands. */}
      {(isLoadingReport || (trendsData.length > 0 && trendsData.some(d => d.income > 0 || d.expenses > 0))) && (
        <section id="onboarding-reports-trends" aria-label="מגמות הכנסות מול הוצאות" className="bg-[#0F1535] rounded-[10px] p-[15px_10px] flex flex-col gap-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-[18px] font-bold leading-[1.4]">הכנסות מול הוצאות (ללא מע&quot;מ) — 6 חודשים</span>
            <div className="flex items-center gap-[12px]">
              <div className="flex items-center gap-[4px]">
                <div className="w-[10px] h-[10px] rounded-[2px] bg-[#17DB4E]" />
                <span className="text-[11px] text-white/60">הכנסות</span>
              </div>
              <div className="flex items-center gap-[4px]">
                <div className="w-[10px] h-[10px] rounded-[2px] bg-[#F64E60]" />
                <span className="text-[11px] text-white/60">הוצאות</span>
              </div>
            </div>
          </div>
          {isLoadingReport ? (
            <Skeleton className="h-[220px] w-full bg-white/10 rounded-[8px]" />
          ) : (
            // min-w-0 on the wrapping div is what Recharts asks for in
            // the "width(-1) and height(-1)" warning — without it the
            // ResponsiveContainer can briefly measure the parent at -1
            // during the lazy-load → mount transition.
            <div className="w-full" style={{ minWidth: 0 }}>
              <LazyResponsiveContainer width="100%" height={220} minWidth={0}>
                <LazyBarChart data={trendsData} barGap={2} barCategoryGap="20%">
                  <LazyXAxis dataKey="month" tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <LazyYAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} width={40} />
                  <LazyTooltip
                    contentStyle={{ background: "#1a1f4e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, direction: "rtl" }}
                    labelStyle={{ color: "white", fontWeight: "bold", marginBottom: 4 }}
                    itemStyle={{ color: "white" }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={((value: number) => `₪${value.toLocaleString("he-IL")}`) as any}
                  />
                  <LazyBar dataKey="income" name="הכנסות ללא מע״מ" fill="#17DB4E" radius={[4, 4, 0, 0]} />
                  <LazyBar dataKey="expenses" name="הוצאות" fill="#F64E60" radius={[4, 4, 0, 0]} />
                </LazyBarChart>
              </LazyResponsiveContainer>
            </div>
          )}
        </section>
      )}

      {/* Income Summary Card — labels (יעד / בפועל / הפרש ב-₪ /
          הפרש ב-%) and the row title stay put; only the values get a
          skeleton while the report data is fetching. */}
      <section id="onboarding-reports-income" aria-label="סיכום הכנסות" className="bg-[#2C3595] rounded-[10px] p-[7px] min-h-[80px] flex flex-row-reverse items-center justify-between gap-[5px]">
        <div className="flex flex-row-reverse items-center gap-[5px] flex-1 min-w-0">
          <div className="flex flex-col items-center flex-1 min-w-0">
            <span className="text-[12px] sm:text-[14px] font-medium leading-[1.4] whitespace-nowrap">הפרש ב-%</span>
            {isLoadingReport ? (
              <Skeleton className="h-[16px] w-[60px] bg-white/10 mt-[2px]" />
            ) : (
              <span className={`text-[13px] sm:text-[15px] font-bold ltr-num leading-[1.4] whitespace-nowrap ${summary.totalRevenue - summary.revenueTarget > 0 ? "text-[#17DB4E]" : summary.totalRevenue - summary.revenueTarget < 0 ? "text-[#F64E60]" : "text-white"}`}>
                {summary.revenueTarget > 0 ? ((summary.totalRevenue / summary.revenueTarget) * 100).toFixed(2) : "0.00"}%
              </span>
            )}
          </div>
          <div className="flex flex-col items-center flex-1 min-w-0">
            <span className="text-[12px] sm:text-[14px] font-medium leading-[1.4] whitespace-nowrap">הפרש ב-₪</span>
            {isLoadingReport ? (
              <Skeleton className="h-[16px] w-[60px] bg-white/10 mt-[2px]" />
            ) : (
              <span className={`text-[13px] sm:text-[15px] font-bold ltr-num leading-[1.4] whitespace-nowrap ${summary.totalRevenue - summary.revenueTarget > 0 ? "text-[#17DB4E]" : summary.totalRevenue - summary.revenueTarget < 0 ? "text-[#F64E60]" : "text-white"}`}>
                {formatCurrency(summary.totalRevenue - summary.revenueTarget)}
              </span>
            )}
          </div>
          <div className="flex flex-col items-center flex-1 min-w-0">
            <span className="text-[12px] sm:text-[14px] font-medium leading-[1.4]">בפועל</span>
            {isLoadingReport ? (
              <Skeleton className="h-[16px] w-[60px] bg-white/10 mt-[2px]" />
            ) : (
              <span className="text-[13px] sm:text-[15px] font-bold ltr-num leading-[1.4] whitespace-nowrap">{formatCurrency(summary.totalRevenue)}</span>
            )}
          </div>
          <div className="flex flex-col items-center flex-1 min-w-0">
            <span className="text-[12px] sm:text-[14px] font-medium leading-[1.4]">יעד</span>
            {isLoadingReport ? (
              <Skeleton className="h-[16px] w-[60px] bg-white/10 mt-[2px]" />
            ) : (
              <span className="text-[13px] sm:text-[15px] font-bold ltr-num leading-[1.4] whitespace-nowrap">{formatCurrency(summary.revenueTarget)}</span>
            )}
          </div>
        </div>
        <span className="text-[14px] sm:text-[16px] font-bold text-right leading-[1.4] shrink-0 w-[90px] sm:w-[140px]">סה&quot;כ הכנסות ללא מע&quot;מ</span>
      </section>

      {/* Expenses Section */}
      <section id="onboarding-reports-categories" aria-label="פירוט הוצאות" className="bg-[#0F1535] rounded-[10px] p-[7px_0_0_0] min-h-[40px] flex flex-col">
        {/* Header Row */}
        <div className="min-h-[40px] mb-[15px] text-right">
          <span className="text-[20px] font-bold leading-[1.4]">פירוט ההוצאות</span>
        </div>

        {/* Table Header */}
        <div id="onboarding-reports-columns" className="flex flex-row-reverse items-center justify-between min-h-[50px] border-b-2 border-white/15 p-[5px] gap-[5px]">
          <div className="flex flex-row-reverse items-center gap-[3px] sm:gap-[5px] flex-1 min-w-0">
            <span className="text-[11px] sm:text-[14px] font-semibold flex-1 min-w-0 text-center leading-[1.4]">נותר לניצול</span>
            <span className="text-[11px] sm:text-[14px] font-medium flex-1 min-w-0 text-center leading-[1.4]">הפרש ב-₪</span>
            <span className="text-[11px] sm:text-[14px] font-medium flex-1 min-w-0 text-center leading-[1.4]">בפועל</span>
            <span className="text-[11px] sm:text-[14px] font-medium flex-1 min-w-0 text-center leading-[1.4]">יעד</span>
          </div>
          <div className="flex items-center justify-center shrink-0 w-[90px] sm:w-[140px]">
            <span className="text-[11px] sm:text-[14px] font-medium text-center leading-[1.4]">שם ההוצאה</span>
          </div>
        </div>

        {/* Expense Categories — render skeleton rows while data is in
            flight so the user sees the table shape immediately. */}
        <div className="flex flex-col mt-[5px]">
          {isLoadingReport ? (
            <>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex flex-row-reverse items-center justify-between w-full min-h-[60px] p-[5px] gap-[5px] border-b-2 border-white/15">
                  <div className="flex flex-row-reverse items-center gap-[3px] sm:gap-[5px] flex-1 min-w-0">
                    <div className="flex-1 min-w-0 flex justify-center"><Skeleton className="h-[16px] w-[50px] bg-white/10" /></div>
                    <div className="flex-1 min-w-0 flex justify-center"><Skeleton className="h-[16px] w-[50px] bg-white/10" /></div>
                    <div className="flex-1 min-w-0 flex justify-center"><Skeleton className="h-[16px] w-[50px] bg-white/10" /></div>
                    <div className="flex-1 min-w-0 flex justify-center"><Skeleton className="h-[16px] w-[50px] bg-white/10" /></div>
                  </div>
                  <div className="shrink-0 w-[90px] sm:w-[140px] flex justify-end">
                    <Skeleton className="h-[18px] w-[80px] bg-white/10" />
                  </div>
                </div>
              ))}
            </>
          ) : expenseCategories.length === 0 ? (
            <div className="flex items-center justify-center py-[40px]">
              <span className="text-[16px] text-white/50">אין נתוני הוצאות להצגה</span>
            </div>
          ) : expenseCategories.map((category) => (
            <div key={category.id} className="rounded-[10px]">
              {/* Category Row */}
              <Button
                type="button"
                onClick={() => toggleCategory(category.id)}
                className={`flex flex-row-reverse items-center justify-between w-full min-h-[60px] p-[5px] gap-[5px] border-b-2 border-white/15 hover:bg-[#29318A]/30 transition-all cursor-pointer ${
                  expandedCategories.includes(category.id) ? 'rounded-t-[10px]' : ''
                }`}
              >
                <div className="flex flex-row-reverse items-center gap-[3px] sm:gap-[5px] flex-1 min-w-0">
                  <div className="flex flex-col items-center flex-1 min-w-0 gap-[2px]">
                    <span className={`text-[11px] sm:text-[14px] font-bold ltr-num leading-[1.4] ${category.diffRaw > 0 ? 'text-[#17DB4E]' : category.diffRaw < 0 ? 'text-[#F64E60]' : 'text-white'}`}>
                      {category.remaining}
                    </span>
                    <div className="w-[60px] sm:w-[75px] h-[8px] sm:h-[10px] bg-white/50 rounded-full border border-[#211A66] overflow-hidden rotate-180" title={getProgressTooltip(category.actualRaw, category.targetRaw)}>
                      <div className={`h-full transition-all duration-300 ${getProgressBarColor(category.remainingRaw)} ${category.remainingRaw <= 0 ? 'animate-pulse-red' : ''}`} style={{ width: `${Math.min(100, Math.max(0, 100 - category.remainingRaw))}%` }} />
                    </div>
                  </div>
                  <span className={`text-[11px] sm:text-[14px] font-bold flex-1 min-w-0 text-center ltr-num leading-[1.4] ${category.diffRaw > 0 ? 'text-[#17DB4E]' : category.diffRaw < 0 ? 'text-[#F64E60]' : 'text-white'}`}>
                    {category.difference}
                  </span>
                  <span className={`text-[11px] sm:text-[14px] font-bold flex-1 min-w-0 text-center ltr-num leading-[1.4] ${category.isClosedLabor ? 'text-[#17DB4E]' : ''}`}>
                    {category.actual}
                  </span>
                  <span className="text-[11px] sm:text-[14px] font-bold flex-1 min-w-0 text-center ltr-num leading-[1.4]">
                    {category.target}
                  </span>
                </div>
                <div className="flex flex-row-reverse items-center justify-end gap-[5px] shrink-0 w-[90px] sm:w-[140px]">
                  <div className="flex flex-col items-end gap-[4px] min-w-0">
                    <span className="text-[12px] sm:text-[14px] font-bold text-right leading-[1.4] break-words">{category.name}</span>
                    {category.isLaborParent && selectedBusinesses.length === 1 && (
                      laborMonthClosedState ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); handleReopenMonth(); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); handleReopenMonth(); } }}
                          className="flex items-center gap-[3px] text-[10px] sm:text-[11px] font-bold bg-[#17DB4E]/15 text-[#17DB4E] border border-[#17DB4E]/40 rounded-full px-[8px] py-[3px] hover:bg-[#17DB4E]/25 transition-colors cursor-pointer whitespace-nowrap"
                        >פתח מחדש</span>
                      ) : (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); setLaborCloseOpen(true); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setLaborCloseOpen(true); } }}
                          className="flex items-center gap-[3px] text-[10px] sm:text-[11px] font-bold bg-[#29318A] text-white border border-[#5a63c4] rounded-full px-[8px] py-[3px] hover:bg-[#343da3] transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
                          </svg>
                          סגור חודש
                        </span>
                      )
                    )}
                  </div>
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
              </Button>

              {/* Subcategories */}
              {expandedCategories.includes(category.id) && (
                <div className="bg-[#232B6A] rounded-b-[10px] mb-[5px]">
                  {category.subcategories.map((sub, index) => (
                    <div key={sub.id}>
                      {sub.suppliers.length > 0 ? (
                        <Button
                          type="button"
                          onClick={() => toggleSubcategory(sub.id)}
                          className={`flex flex-row-reverse items-center justify-between w-full min-h-[50px] p-[5px] gap-[5px] hover:bg-white/5 transition-all cursor-pointer ${
                            index < category.subcategories.length - 1 && !expandedSubcategories.includes(sub.id) ? 'border-b border-white/10' : ''
                          }`}
                        >
                          <div className="flex flex-row-reverse items-center gap-[3px] sm:gap-[5px] flex-1 min-w-0">
                            <div className="flex flex-col items-center flex-1 min-w-0 gap-[2px]">
                              <span className={`text-[10px] sm:text-[13px] font-medium ltr-num leading-[1.4] ${sub.diffRaw > 0 ? 'text-[#17DB4E]' : sub.diffRaw < 0 ? 'text-[#F64E60]' : 'text-white'}`}>
                                {sub.remaining}
                              </span>
                              <div className="w-[50px] sm:w-[65px] h-[6px] sm:h-[8px] bg-white/50 rounded-full border border-[#211A66] overflow-hidden rotate-180" title={getProgressTooltip(sub.actualRaw, sub.targetRaw)}>
                                <div className={`h-full transition-all duration-300 ${getProgressBarColor(sub.remainingRaw)} ${sub.remainingRaw <= 0 ? 'animate-pulse-red' : ''}`} style={{ width: `${Math.min(100, Math.max(0, 100 - sub.remainingRaw))}%` }} />
                              </div>
                            </div>
                            <span className={`text-[10px] sm:text-[13px] font-medium flex-1 min-w-0 text-center ltr-num leading-[1.4] ${sub.diffRaw > 0 ? 'text-[#17DB4E]' : sub.diffRaw < 0 ? 'text-[#F64E60]' : 'text-white'}`}>
                              {sub.difference}
                            </span>
                            <span className="text-[10px] sm:text-[13px] font-medium flex-1 min-w-0 text-center ltr-num leading-[1.4]">
                              {sub.actual}
                            </span>
                            <span className="text-[10px] sm:text-[13px] font-medium flex-1 min-w-0 text-center ltr-num leading-[1.4]">
                              {sub.target}
                            </span>
                          </div>
                          <div className="flex flex-row-reverse items-center justify-end gap-[3px] shrink-0 w-[90px] sm:w-[140px]">
                            <span className={`text-[11px] sm:text-[13px] font-medium text-right leading-[1.4] break-words ${sub.hasUnapproved ? 'text-purple-400' : 'text-white/80'}`}>{sub.name}</span>
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 32 32"
                              fill="none"
                              aria-hidden="true"
                              className={`flex-shrink-0 transition-transform text-white/50 ${expandedSubcategories.includes(sub.id) ? 'rotate-180' : ''}`}
                            >
                              <path d="M8 12L16 20L24 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                        </Button>
                      ) : (
                        <div
                          className={`flex flex-row-reverse items-center justify-between min-h-[50px] p-[5px] gap-[5px] ${
                            index < category.subcategories.length - 1 ? 'border-b border-white/10' : ''
                          }`}
                        >
                          <div className="flex flex-row-reverse items-center gap-[3px] sm:gap-[5px] flex-1 min-w-0">
                            <div className="flex flex-col items-center flex-1 min-w-0 gap-[2px]">
                              <span className={`text-[10px] sm:text-[13px] font-medium ltr-num leading-[1.4] ${sub.diffRaw > 0 ? 'text-[#17DB4E]' : sub.diffRaw < 0 ? 'text-[#F64E60]' : 'text-white'}`}>
                                {sub.remaining}
                              </span>
                              <div className="w-[50px] sm:w-[65px] h-[6px] sm:h-[8px] bg-white/50 rounded-full border border-[#211A66] overflow-hidden rotate-180" title={getProgressTooltip(sub.actualRaw, sub.targetRaw)}>
                                <div className={`h-full transition-all duration-300 ${getProgressBarColor(sub.remainingRaw)} ${sub.remainingRaw <= 0 ? 'animate-pulse-red' : ''}`} style={{ width: `${Math.min(100, Math.max(0, 100 - sub.remainingRaw))}%` }} />
                              </div>
                            </div>
                            <span className={`text-[10px] sm:text-[13px] font-medium flex-1 min-w-0 text-center ltr-num leading-[1.4] ${sub.diffRaw > 0 ? 'text-[#17DB4E]' : sub.diffRaw < 0 ? 'text-[#F64E60]' : 'text-white'}`}>
                              {sub.difference}
                            </span>
                            <span className="text-[10px] sm:text-[13px] font-medium flex-1 min-w-0 text-center ltr-num leading-[1.4]">
                              {sub.actual}
                            </span>
                            <span className="text-[10px] sm:text-[13px] font-medium flex-1 min-w-0 text-center ltr-num leading-[1.4]">
                              {sub.target}
                            </span>
                          </div>
                          <div className="flex flex-row-reverse items-center justify-end gap-[3px] shrink-0 w-[90px] sm:w-[140px]">
                            <span className={`text-[11px] sm:text-[13px] font-medium text-right leading-[1.4] break-words ${sub.hasUnapproved ? 'text-purple-400' : 'text-white/80'}`}>{sub.name}</span>
                            <div className="w-[12px] h-[12px] flex-shrink-0" />
                          </div>
                        </div>
                      )}
                      {/* Suppliers (3rd level) */}
                      {expandedSubcategories.includes(sub.id) && sub.suppliers.length > 0 && (
                        <div className="bg-[#141A40] mx-[5px] mb-[2px] rounded-[6px]">
                          {sub.suppliers.map((supplier, sIndex) => (
                            <div
                              key={sIndex}
                              className={`flex flex-row-reverse items-center justify-between min-h-[42px] pr-[8px] pl-[4px] py-[4px] gap-[5px] ${
                                sIndex < sub.suppliers.length - 1 ? 'border-b border-white/5' : ''
                              }`}
                            >
                              <div className="flex flex-row-reverse items-center gap-[3px] sm:gap-[5px] flex-1 min-w-0">
                                <div className="flex flex-col items-center flex-1 min-w-0 gap-[1px]">
                                  <span className={`text-[9px] sm:text-[12px] font-normal ltr-num leading-[1.4] ${supplier.diffRaw > 0 ? 'text-[#17DB4E]' : supplier.diffRaw < 0 ? 'text-[#F64E60]' : 'text-white'}`}>
                                    {supplier.remaining}
                                  </span>
                                  <div className="w-[40px] sm:w-[55px] h-[5px] sm:h-[6px] bg-white/50 rounded-full border border-[#211A66] overflow-hidden rotate-180" title={getProgressTooltip(supplier.actualRaw, supplier.targetRaw)}>
                                    <div className={`h-full transition-all duration-300 ${getProgressBarColor(supplier.remainingRaw)} ${supplier.remainingRaw <= 0 ? 'animate-pulse-red' : ''}`} style={{ width: `${Math.min(100, Math.max(0, 100 - supplier.remainingRaw))}%` }} />
                                  </div>
                                </div>
                                <span className={`text-[9px] sm:text-[12px] font-normal flex-1 min-w-0 text-center ltr-num leading-[1.4] ${supplier.diffRaw > 0 ? 'text-[#17DB4E]' : supplier.diffRaw < 0 ? 'text-[#F64E60]' : 'text-white'}`}>
                                  {supplier.difference}
                                </span>
                                <span className="text-[9px] sm:text-[12px] font-normal flex-1 min-w-0 text-center ltr-num leading-[1.4] text-white">
                                  {supplier.actual}
                                </span>
                                <span className="text-[9px] sm:text-[12px] font-normal flex-1 min-w-0 text-center ltr-num leading-[1.4] text-white">
                                  {supplier.target}
                                </span>
                              </div>
                              <div className="flex flex-col items-start shrink-0 w-[90px] sm:w-[140px] gap-[1px]">
                                <span className={`text-[10px] sm:text-[12px] font-normal text-right leading-[1.4] break-words ${supplier.hasUnapproved ? 'text-purple-400' : 'text-white'}`}>{supplier.name}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {category.isLaborParent && selectedBusinesses.length === 1 && (
                    laborMonthClosedState ? (
                      <div className="m-[5px] p-[10px] rounded-[8px] bg-[#17DB4E]/10 border border-[#17DB4E]/30 flex flex-row-reverse items-center justify-between gap-[8px]">
                        <div className="flex flex-col gap-[2px] text-right min-w-0">
                          <span className="text-[12px] sm:text-[13px] font-bold text-[#17DB4E]">החודש סגור — מוצגת עלות בפועל</span>
                          <span className="text-[10px] sm:text-[11px] text-white/60 leading-[1.4]">החשבוניות נכנסו לתזרים. אפשר לפתוח מחדש כדי לתקן.</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleReopenMonth()}
                          className="shrink-0 bg-transparent border border-[#F64E60]/50 text-[#F64E60] hover:bg-[#F64E60]/10 text-[12px] sm:text-[13px] font-bold rounded-[7px] px-[14px] py-[8px] whitespace-nowrap transition-colors cursor-pointer"
                        >פתח מחדש</button>
                      </div>
                    ) : (
                      <div className="m-[5px] p-[10px] rounded-[8px] bg-[#29318A]/40 border border-[#5a63c4]/40 flex flex-row-reverse items-center justify-between gap-[8px]">
                        <div className="flex flex-col gap-[2px] text-right min-w-0">
                          <span className="text-[12px] sm:text-[13px] font-bold">סגירת חודש עלות עובדים</span>
                          <span className="text-[10px] sm:text-[11px] text-white/60 leading-[1.4]">הזן את הסכומים שיצאו בפועל מהנהלת החשבונות (שכר, פנסיה, ביטוח לאומי, פיצויים).</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setLaborCloseOpen(true)}
                          className="shrink-0 bg-[#29318A] hover:bg-[#343da3] text-white text-[12px] sm:text-[13px] font-bold rounded-[7px] px-[14px] py-[8px] whitespace-nowrap transition-colors cursor-pointer"
                        >סגור חודש</button>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Total Expenses Row — label stays put, values get skeleton */}
        <div className="flex flex-row-reverse items-center justify-between bg-[#2C3595] rounded-[10px] p-[7px] mt-[10px] min-h-[60px] gap-[5px]">
          <div className="flex flex-row-reverse items-center gap-[3px] sm:gap-[5px] flex-1 min-w-0">
            {isLoadingReport ? (
              <>
                <div className="flex-1 min-w-0 flex justify-center"><Skeleton className="h-[18px] w-[55px] bg-white/10" /></div>
                <div className="flex-1 min-w-0 flex justify-center"><Skeleton className="h-[18px] w-[55px] bg-white/10" /></div>
                <div className="flex-1 min-w-0 flex justify-center"><Skeleton className="h-[18px] w-[55px] bg-white/10" /></div>
                <div className="flex-1 min-w-0 flex justify-center"><Skeleton className="h-[18px] w-[55px] bg-white/10" /></div>
              </>
            ) : (
              <>
                <div className="flex flex-col items-center flex-1 min-w-0 gap-[2px]">
                  <span className={`text-[11px] sm:text-[15px] font-bold ltr-num leading-[1.4] ${summary.expensesTarget - summary.totalExpenses > 0 ? "text-[#17DB4E]" : summary.expensesTarget - summary.totalExpenses < 0 ? "text-[#F64E60]" : "text-white"}`}>
                    {summary.expensesTarget > 0 ? (((summary.expensesTarget - summary.totalExpenses) / summary.expensesTarget) * 100).toFixed(2) : "0.00"}%
                  </span>
                </div>
                <span className={`text-[11px] sm:text-[15px] font-bold flex-1 min-w-0 text-center ltr-num leading-[1.4] ${summary.expensesTarget - summary.totalExpenses > 0 ? "text-[#17DB4E]" : summary.expensesTarget - summary.totalExpenses < 0 ? "text-[#F64E60]" : "text-white"}`}>
                  {formatDifference(summary.expensesTarget - summary.totalExpenses)}
                </span>
                <span className="text-[11px] sm:text-[15px] font-bold flex-1 min-w-0 text-center ltr-num leading-[1.4]">{formatCurrency(summary.totalExpenses)}</span>
                <span className="text-[11px] sm:text-[15px] font-bold flex-1 min-w-0 text-center ltr-num leading-[1.4]">{formatCurrency(summary.expensesTarget)}</span>
              </>
            )}
          </div>
          <span className="text-[14px] sm:text-[18px] font-bold text-right leading-[1.4] shrink-0 w-[90px] sm:w-[140px]">סה&quot;כ הוצאות</span>
        </div>
      </section>

      {/* Total Profit/Loss Summary — label stays put, values get skeleton */}
      <section id="onboarding-reports-bottom" aria-label="סיכום רווח והפסד" className="bg-[#2C3595] rounded-[10px] p-[7px] min-h-[70px] flex flex-row-reverse items-center justify-between gap-[5px]">
        <div className="flex flex-row-reverse items-center gap-[3px] sm:gap-[5px] flex-1 min-w-0">
          {isLoadingReport ? (
            <>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex flex-col items-center flex-1 min-w-0 gap-[2px]">
                  <Skeleton className="h-[16px] w-[55px] bg-white/10" />
                  <Skeleton className="h-[12px] w-[35px] bg-white/10" />
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="flex flex-col items-center flex-1 min-w-0">
                <span className={`text-[11px] sm:text-[14px] font-bold ltr-num leading-[1.4] whitespace-nowrap ${summary.operatingProfit - (summary.revenueTarget - summary.expensesTarget) > 0 ? "text-[#17DB4E]" : summary.operatingProfit - (summary.revenueTarget - summary.expensesTarget) < 0 ? "text-[#F64E60]" : "text-white"}`}>
                  {(summary.revenueTarget - summary.expensesTarget) !== 0
                    ? (((summary.operatingProfit - (summary.revenueTarget - summary.expensesTarget)) / Math.abs(summary.revenueTarget - summary.expensesTarget)) * 100).toFixed(2)
                    : "0.00"}%
                </span>
              </div>
              <div className="flex flex-col items-center flex-1 min-w-0">
                <span className={`text-[11px] sm:text-[14px] font-bold ltr-num leading-[1.4] whitespace-nowrap ${summary.operatingProfit - (summary.revenueTarget - summary.expensesTarget) > 0 ? "text-[#17DB4E]" : summary.operatingProfit - (summary.revenueTarget - summary.expensesTarget) < 0 ? "text-[#F64E60]" : "text-white"}`}>
                  {formatCurrency(summary.operatingProfit - (summary.revenueTarget - summary.expensesTarget))}
                </span>
              </div>
              <div className="flex flex-col items-center flex-1 min-w-0">
                <span className="text-[11px] sm:text-[14px] font-bold ltr-num leading-[1.4] whitespace-nowrap">{formatCurrency(summary.operatingProfit)}</span>
                <span className={`text-[11px] sm:text-[14px] font-semibold ltr-num leading-[1.4] ${summary.operatingProfitPct > 0 ? "text-[#17DB4E]" : summary.operatingProfitPct < 0 ? "text-[#F64E60]" : "text-white"}`}>
                  {summary.operatingProfitPct.toFixed(1)}%
                </span>
              </div>
              <div className="flex flex-col items-center flex-1 min-w-0">
                <span className="text-[11px] sm:text-[14px] font-bold ltr-num leading-[1.4] whitespace-nowrap">{formatCurrency(summary.revenueTarget - summary.expensesTarget)}</span>
                <span className={`text-[11px] sm:text-[14px] font-semibold ltr-num leading-[1.4] ${summary.revenueTarget > 0 ? "text-[#17DB4E]" : "text-white"}`}>
                  {summary.revenueTarget > 0 ? (((summary.revenueTarget - summary.expensesTarget) / summary.revenueTarget) * 100).toFixed(1) : "0.0"}%
                </span>
              </div>
            </>
          )}
        </div>
        <span className="text-[14px] sm:text-[18px] font-bold text-right leading-[1.4] shrink-0 w-[90px] sm:w-[140px]">סה&quot;כ רווח / הפסד</span>
      </section>

      {/* Prior Liabilities */}
      <section aria-label="התחייבויות קודמות" className="bg-[#3A1A2E] rounded-[10px] overflow-hidden border border-[#F64E60]/30">
        <button
          type="button"
          onClick={() => setShowPriorLiabilitiesBreakdown(prev => !prev)}
          className="w-full p-[7px] min-h-[70px] flex flex-row-reverse items-center justify-between gap-[5px] cursor-pointer hover:bg-white/5 transition-colors"
        >
          <div className="flex flex-row-reverse items-center gap-[3px] sm:gap-[5px] flex-1 min-w-0">
            {/* Spacers to match 4-column layout of other cards */}
            <span className="flex-1 min-w-0" />
            <span className="flex-1 min-w-0" />
            <div className="flex flex-col items-center flex-1 min-w-0">
              <span className="text-[10px] sm:text-[12px] text-white/50 leading-[1.3]">בפועל</span>
              {isLoadingReport ? (
                <Skeleton className="h-[16px] w-[55px] bg-white/10 mt-[2px]" />
              ) : (
                <span className={`text-[11px] sm:text-[15px] font-bold ltr-num leading-[1.4] ${priorLiabilities > 0 ? "text-[#F64E60]" : "text-white"}`}>
                  {formatCurrency(priorLiabilities)}
                </span>
              )}
            </div>
            <div className="flex flex-col items-center flex-1 min-w-0">
              <span className="text-[10px] sm:text-[12px] text-white/50 leading-[1.3]">יעד</span>
              {isLoadingReport ? (
                <Skeleton className="h-[16px] w-[55px] bg-white/10 mt-[2px]" />
              ) : (
                <span className={`text-[11px] sm:text-[15px] font-bold ltr-num leading-[1.4] ${priorLiabilities > 0 ? "text-[#F64E60]" : "text-white"}`}>
                  {formatCurrency(priorLiabilities)}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-row-reverse items-center gap-[4px] shrink-0 w-[90px] sm:w-[140px]">
            <span className="text-[14px] sm:text-[18px] font-bold text-right leading-[1.4] text-[#F64E60]">התחייבויות קודמות</span>
            <ChevronDown className={`w-4 h-4 transition-transform text-[#F64E60] ${showPriorLiabilitiesBreakdown ? "rotate-180" : ""}`} />
          </div>
        </button>

        {showPriorLiabilitiesBreakdown && priorLiabilitiesItems.length > 0 && (
          <div className="border-t border-[#F64E60]/20 px-[10px] pb-[10px]">
            {/* Header */}
            <div className="flex flex-row-reverse justify-between items-center py-[6px] text-[11px] sm:text-[13px] text-white/50 font-medium border-b border-white/10">
              <span className="w-[90px] sm:w-[120px] text-center">סכום חודשי</span>
              <span className="flex-1 text-right">שם התחייבות</span>
            </div>
            {priorLiabilitiesItems.map((item, idx) => (
              <div
                key={`commitment-${idx}`}
                className="flex flex-row-reverse justify-between items-center py-[7px] text-[11px] sm:text-[13px] border-b border-white/5 last:border-b-0"
              >
                <span className="w-[90px] sm:w-[120px] text-center ltr-num font-bold text-[#F64E60]">
                  {formatCurrency(item.monthly_amount)}
                </span>
                <span className="flex-1 text-right text-white/85 pr-[4px]">{item.name}</span>
              </div>
            ))}
            {/* Total row */}
            <div className="flex flex-row-reverse justify-between items-center pt-[8px] mt-[4px] border-t border-[#F64E60]/30 text-[11px] sm:text-[13px]">
              <span className="w-[90px] sm:w-[120px] text-center ltr-num font-bold text-[#F64E60]">
                {formatCurrency(priorLiabilities)}
              </span>
              <span className="flex-1 text-right text-white/60 font-medium">סה&quot;כ</span>
            </div>
          </div>
        )}
        {showPriorLiabilitiesBreakdown && priorLiabilitiesItems.length === 0 && priorLiabilities === 0 && (
          <div className="border-t border-[#F64E60]/20 px-[10px] py-[12px] text-center text-[12px] text-white/50">
            אין התחייבויות לחודש זה
          </div>
        )}
      </section>

      {/* Cash Flow Forecast — labels + title stay put, values get skeleton */}
      <section aria-label="צפי תזרים" className="bg-[#2C3595] rounded-[10px] p-[7px] min-h-[70px] flex flex-row-reverse items-center justify-between gap-[5px] mb-[25px]">
        <div className="flex flex-row-reverse items-center gap-[3px] sm:gap-[5px] flex-1 min-w-0">
          <span className="flex-1 min-w-0" />
          <div className="flex flex-col items-center flex-1 min-w-0">
            <span className="text-[11px] sm:text-[14px] font-medium leading-[1.4] text-center whitespace-nowrap">הפרש ב-₪</span>
            {isLoadingReport ? (
              <Skeleton className="h-[16px] w-[55px] bg-white/10 mt-[2px]" />
            ) : (
              <span className={`text-[11px] sm:text-[15px] font-bold ltr-num leading-[1.4] text-center whitespace-nowrap ${cashFlowForecast.actual - cashFlowForecast.target > 0 ? "text-[#17DB4E]" : cashFlowForecast.actual - cashFlowForecast.target < 0 ? "text-[#F64E60]" : "text-white"}`}>
                {formatCurrency(cashFlowForecast.actual - cashFlowForecast.target)}
              </span>
            )}
          </div>
          <div className="flex flex-col items-center flex-1 min-w-0">
            <span className="text-[11px] sm:text-[14px] font-medium leading-[1.4] text-center">בפועל</span>
            {isLoadingReport ? (
              <Skeleton className="h-[16px] w-[55px] bg-white/10 mt-[2px]" />
            ) : (
              <span className={`text-[11px] sm:text-[15px] font-bold ltr-num leading-[1.4] text-center whitespace-nowrap ${cashFlowForecast.actual > 0 ? "text-[#17DB4E]" : cashFlowForecast.actual < 0 ? "text-[#F64E60]" : "text-white"}`}>
                {formatCurrency(cashFlowForecast.actual)}
              </span>
            )}
          </div>
          <div className="flex flex-col items-center flex-1 min-w-0">
            <span className="text-[11px] sm:text-[14px] font-medium leading-[1.4] text-center">יעד</span>
            {isLoadingReport ? (
              <Skeleton className="h-[16px] w-[55px] bg-white/10 mt-[2px]" />
            ) : (
              <span className={`text-[11px] sm:text-[15px] font-bold ltr-num leading-[1.4] text-center whitespace-nowrap ${cashFlowForecast.target > 0 ? "text-[#17DB4E]" : cashFlowForecast.target < 0 ? "text-[#F64E60]" : "text-white"}`}>
                {formatCurrency(cashFlowForecast.target)}
              </span>
            )}
          </div>
        </div>
        <span className="text-[14px] sm:text-[18px] font-bold text-right leading-[1.4] shrink-0 w-[90px] sm:w-[140px]">צפי תזרים</span>
      </section>

      </>) : (
      /* Yearly view — supplier × 12 months actual-spend matrix, modeled on
         "ניהול יעדים ותקציבים > תקציב הוצאות שוטפות". No targets, no fixed/
         variable budgets, just the raw spent-per-month so the user can scan
         each supplier across the whole year. */
      <>
      {/* Yearly revenue summary card — same visual shell as the monthly
          "סיכום הכנסות" pill (rounded blue strip with right-aligned title
          label), but each cell is one calendar month's actual revenue plus a
          final סה"כ. No target / diff columns — just actuals across the year. */}
      {/* dir="rtl" turns the row into a true RTL flex: children in source
          order map to right→left visually. Sequence is intentionally:
          [סה"כ, ינואר…דצמבר] so סה"כ pins to the right edge (next to the
          label "סה"כ הכנסות ללא מע"מ" which sits at the far right of the
          card) and the months read ינואר→דצמבר from right to left like the
          rest of the report. */}
      {/* Outer wrapper scrolls horizontally on narrow screens — without this the
          12-month strip + סה"כ + right-pinned label all tried to squeeze into
          ~360px on mobile and the month names overlapped into garbage. Mirrors
          the supplier matrix below: outer overflow-x-auto, inner min-w sets the
          horizontal budget. The right-pinned label stays inside the scrolling
          row (sticky was an option but added complexity without much gain). */}
      <section id="onboarding-reports-yearly-income" aria-label="סיכום הכנסות שנתי" className="bg-[#2C3595] rounded-[10px] overflow-x-auto">
        <div dir="rtl" className="min-w-[900px] p-[7px] min-h-[80px] flex items-center justify-between gap-[5px]">
          <span className="text-[14px] sm:text-[16px] font-bold text-right leading-[1.4] shrink-0 w-[90px] sm:w-[140px]">סה&quot;כ הכנסות ללא מע&quot;מ</span>
          <div className="flex items-center gap-[5px] flex-1 min-w-0">
            <div className="flex flex-col items-center flex-1 min-w-0">
              <span className="text-[11px] sm:text-[13px] font-semibold leading-[1.4] whitespace-nowrap text-[#17DB4E]">סה&quot;כ</span>
              <span className="text-[12px] sm:text-[14px] font-bold ltr-num leading-[1.4] whitespace-nowrap text-[#17DB4E]">
                {formatCurrency(yearlyRevenueTotal)}
              </span>
            </div>
            {yearlyMonthlyRevenue.map((amount, i) => (
              <div key={i} className="flex flex-col items-center flex-1 min-w-0">
                <span className="text-[11px] sm:text-[13px] font-medium leading-[1.4] whitespace-nowrap">{hebrewMonthsShort[i]}</span>
                <span className="text-[12px] sm:text-[14px] font-bold ltr-num leading-[1.4] whitespace-nowrap">
                  {amount > 0 ? formatCurrency(amount) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="onboarding-reports-yearly-breakdown" aria-label="פירוט שנתי לפי ספק" className="bg-[#0F1535] rounded-[10px] p-[10px] flex flex-col gap-[10px]">
        {/* Title row — title on the right (RTL natural), grand total on the
            left. flex-row-reverse + justify-between would push them apart in
            visual-LTR, which read as the title floating away from its number.
            Plain flex with the title declared first puts both at natural RTL
            edges. */}
        <div className="flex items-center justify-between gap-[10px] flex-wrap">
          <span className="text-[18px] font-bold leading-[1.4] text-right">פירוט הוצאות שנתי לפי ספק — {selectedYear}</span>
          <div className="flex items-center gap-[16px] shrink-0">
            <span className="text-[14px] text-white/60 ltr-num">
              סה&quot;כ הוצאות: <span className="text-white font-semibold">₪{Math.round(yearlyGrandTotal).toLocaleString("he-IL")}</span>
            </span>
          </div>
        </div>

        {/* Legend — colour key for the amount cells below. Mirrors the
            invoice-status semantics: orange clarification overrides paid
            because even one disputed invoice in a month is enough to flag
            the whole bucket. */}
        <div className="flex items-center gap-[14px] flex-wrap text-[12px] text-white/70" dir="rtl">
          <span className="font-semibold text-white/60">מקרא:</span>
          <span className="flex items-center gap-[5px]">
            <span className="inline-block w-[10px] h-[10px] rounded-[2px] bg-[#C084FC]"></span>
            הערכה
          </span>
          <span className="flex items-center gap-[5px]">
            <span className="inline-block w-[10px] h-[10px] rounded-[2px] bg-white"></span>
            ממתין לתשלום
          </span>
          <span className="flex items-center gap-[5px]">
            <span className="inline-block w-[10px] h-[10px] rounded-[2px] bg-[#17DB4E]"></span>
            שולם
          </span>
          <span className="flex items-center gap-[5px]">
            <span className="inline-block w-[10px] h-[10px] rounded-[2px] bg-[#FFA500]"></span>
            בבירור
          </span>
        </div>

        <Input
          type="text"
          placeholder="חיפוש ספק..."
          value={yearlySupplierSearch}
          onChange={(e) => setYearlySupplierSearch(e.target.value)}
          className="w-full bg-[#1a1f4e] border border-[#29318A] rounded-[7px] px-[12px] h-[40px] text-white text-right placeholder:text-white/30 focus:outline-none focus:border-[#4956D4]"
        />

        {isLoadingYearly ? (
          <div className="flex items-center justify-center py-[40px]">
            <div className="animate-spin w-8 h-8 border-4 border-[#4956D4] border-t-transparent rounded-full"></div>
          </div>
        ) : yearlySupplierRows.length === 0 ? (
          <div className="text-center py-[40px] text-white/50 text-[15px]">
            אין הוצאות לשנת {selectedYear}
          </div>
        ) : (
          /* CSS grid for the table — every row (header / data / footer) uses
             the exact same template-columns so header labels, numbers, and
             footer totals stay aligned regardless of digit count. Outer
             overflow-x-auto kicks in on narrow screens; the min-w on the
             inner div sets the desktop width budget. */
          <div className="overflow-x-auto" dir="rtl">
            <div className="min-w-[1320px] flex flex-col gap-[2px]">
              {(() => {
                // First column = supplier name (180px), then 12 monthly columns
                // (90px each, room for ₪50,000+ without truncation), then total.
                const gridTemplate = "180px repeat(12, minmax(90px, 1fr)) 110px";

                return (
                  <>
                    {/* Header */}
                    <div className="grid items-center bg-[#1a1f4e] rounded-[7px] px-[8px] py-[10px]" style={{ gridTemplateColumns: gridTemplate }}>
                      <div className="text-right text-[13px] font-semibold text-white pr-[5px]">שם ספק</div>
                      {hebrewMonthsShort.map((m, i) => (
                        <div key={i} className="text-center text-[12px] font-semibold text-white/70">
                          {m}
                        </div>
                      ))}
                      <div className="text-center text-[13px] font-semibold text-[#17DB4E]">סה״כ</div>
                    </div>

                    {/* Data rows */}
                    {yearlySupplierRows
                      .filter(r => !yearlySupplierSearch || r.name.toLowerCase().includes(yearlySupplierSearch.toLowerCase()))
                      .map((row) => (
                        (() => {
                          // Row helpers: is THIS row a fixed-expense supplier
                          // and does it have at least one open-placeholder
                          // month? When yes, we tint the supplier name purple
                          // so the user can scan suppliers AND we tint each
                          // unapproved cell purple so they know which months
                          // are missing real documents. Real-invoice months
                          // stay white.
                          const hasAnyUnapproved = row.isFixed && row.monthlyUnapproved.some(Boolean);
                          return (
                            <div
                              key={row.supplierId}
                              className="grid items-center rounded-[5px] px-[8px] py-[8px] bg-white/[0.02] hover:bg-white/[0.06] transition-colors"
                              style={{ gridTemplateColumns: gridTemplate }}
                            >
                              <div
                                className={`text-right text-[13px] font-medium pr-[5px] truncate ${hasAnyUnapproved ? "text-[#C084FC]" : "text-white/90"}`}
                                title={row.name}
                              >
                                {row.name}
                              </div>
                              {row.monthly.map((amount, i) => {
                                if (amount > 0) {
                                  // Deep-link into /expenses with the supplier+month preselected,
                                  // opening the same breakdown popup the suppliers page uses.
                                  const monthParam = `${selectedYear}-${String(i + 1).padStart(2, '0')}`;
                                  const cellStatus = row.monthlyStatus[i];
                                  // Status → colour. Falls back to white so a
                                  // missing/unknown status still reads as
                                  // "ממתין" rather than disappearing.
                                  const colorClass =
                                    cellStatus === 'clarification' ? "text-[#FFA500] font-medium"
                                    : cellStatus === 'unapproved' ? "text-[#C084FC] font-medium"
                                    : cellStatus === 'paid' ? "text-[#17DB4E] font-medium"
                                    : "text-white";
                                  const titleText =
                                    cellStatus === 'clarification' ? "יש חשבונית בבירור · לחץ לפירוט"
                                    : cellStatus === 'unapproved' ? "הוצאה קבועה — טרם התקבל מסמך · לחץ לפירוט"
                                    : cellStatus === 'paid' ? "כל החשבוניות שולמו · לחץ לפירוט"
                                    : "לחץ לפירוט חשבוניות לחודש";
                                  return (
                                    <button
                                      key={i}
                                      type="button"
                                      onClick={() => router.push(`/expenses?supplierId=${row.supplierId}&month=${monthParam}`)}
                                      className={`text-center text-[12px] ltr-num px-[2px] hover:underline hover:bg-white/[0.06] rounded-[3px] py-[2px] transition-colors cursor-pointer ${colorClass}`}
                                      title={titleText}
                                    >
                                      ₪{Math.round(amount).toLocaleString("he-IL")}
                                    </button>
                                  );
                                }
                                return (
                                  <div key={i} className="text-center text-[12px] ltr-num px-[2px] text-white/20">
                                    —
                                  </div>
                                );
                              })}
                              <div className="text-center text-[13px] font-semibold text-[#17DB4E] ltr-num">
                                ₪{Math.round(row.total).toLocaleString("he-IL")}
                              </div>
                            </div>
                          );
                        })()
                      ))}

                    {/* Footer (totals row) */}
                    <div className="grid items-center bg-[#1a1f4e] rounded-[7px] px-[8px] py-[10px] mt-[3px]" style={{ gridTemplateColumns: gridTemplate }}>
                      <div className="text-right text-[13px] font-bold text-white pr-[5px]">סה״כ</div>
                      {yearlyMonthTotals.map((t, i) => (
                        <div key={i} className="text-center text-[12px] font-semibold text-white ltr-num px-[2px]">
                          {t > 0 ? `₪${Math.round(t).toLocaleString("he-IL")}` : "—"}
                        </div>
                      ))}
                      <div className="text-center text-[13px] font-bold text-[#17DB4E] ltr-num">
                        ₪{Math.round(yearlyGrandTotal).toLocaleString("he-IL")}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </section>
      </>
      )}

      {selectedBusinesses.length === 1 && (
        <LaborMonthCloseModal
          open={laborCloseOpen}
          onClose={() => setLaborCloseOpen(false)}
          businessId={selectedBusinesses[0]}
          year={parseInt(selectedYear)}
          month={parseInt(selectedMonth)}
          salaryEstimate={salaryEstimateState}
          employerEstimate={employerEstimateState}
          employeeSuppliers={employeeSuppliersState}
          onClosed={() => window.location.reload()}
        />
      )}
    </article>
  );
}
