"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { ChevronDown, ArrowRight } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";

const monthNames = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

// Format currency as full number with comma separators
const formatCurrencyFull = (amount: number) => {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const sign = isNegative ? '-' : '';
  const formatted = Math.round(absAmount).toLocaleString("he-IL");
  return `${sign}₪${formatted}`;
};

// Format percentage with sign
const formatPercentWithSign = (value: number) => {
  const sign = value > 0 ? '+' : '';
  if (value % 1 === 0) {
    return `${sign}${Math.round(value)}%`;
  }
  return `${sign}${value.toFixed(2)}%`;
};

// Format percentage without sign
const formatPercent = (value: number) => {
  if (value % 1 === 0) {
    return `${Math.round(value)}%`;
  }
  return `${value.toFixed(2)}%`;
};

interface MonthData {
  month: number;
  monthName: string;
  value: number; // Main value (₪ or %)
  valuePct: number | null; // Percentage value (for cost cards)
  targetDiffPct: number;
  yoyChangePct: number;
}

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  cardType: string;
  cardTitle: string;
  businessIds: string[];
  sourceId?: string | null;
}

export function HistoryModal({
  isOpen,
  onClose,
  cardType,
  cardTitle,
  businessIds,
  sourceId,
}: HistoryModalProps) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [yearDropdownOpen, setYearDropdownOpen] = useState(false);
  const [monthlyData, setMonthlyData] = useState<MonthData[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Generate available years (current year down to 2020)
  const currentYear = new Date().getFullYear();
  const availableYears = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i);

  const fetchData = useCallback(async () => {
    if (!isOpen || businessIds.length === 0) return;

    setIsLoading(true);
    const supabase = createClient();

    try {
      const results: MonthData[] = [];

      // Date range for the entire year
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;

      // Previous year for YoY
      const prevYear = year - 1;
      const prevYearStart = `${prevYear}-01-01`;
      const prevYearEnd = `${prevYear}-12-31`;

      if (cardType === 'totalIncome') {
        // Fetch daily entries for the selected year and previous year
        const [entriesResult, prevEntriesResult, goalsResult, monthlySummariesResult, prevMonthlySummariesResult] = await Promise.all([
          supabase
            .from("daily_entries")
            .select("entry_date, total_register")
            .in("business_id", businessIds)
            .gte("entry_date", yearStart)
            .lte("entry_date", yearEnd)
            .is("deleted_at", null),
          supabase
            .from("daily_entries")
            .select("entry_date, total_register")
            .in("business_id", businessIds)
            .gte("entry_date", prevYearStart)
            .lte("entry_date", prevYearEnd)
            .is("deleted_at", null),
          supabase
            .from("goals")
            .select("year, month, revenue_target")
            .in("business_id", businessIds)
            .eq("year", year)
            .is("deleted_at", null),
          supabase
            .from("monthly_summaries")
            .select("month, total_income, sales_budget_diff_pct, sales_yoy_change_pct")
            .in("business_id", businessIds)
            .eq("year", year),
          supabase
            .from("monthly_summaries")
            .select("month, total_income")
            .in("business_id", businessIds)
            .eq("year", prevYear),
        ]);

        const entries = entriesResult.data || [];
        const prevEntries = prevEntriesResult.data || [];
        const goals = goalsResult.data || [];
        const monthlySummaries = monthlySummariesResult.data || [];
        const prevMonthlySummaries = prevMonthlySummariesResult.data || [];

        // Group by month
        const byMonth: Record<number, number> = {};
        entries.forEach(e => {
          const m = parseInt(e.entry_date.substring(5, 7));
          byMonth[m] = (byMonth[m] || 0) + (Number(e.total_register) || 0);
        });

        const prevByMonth: Record<number, number> = {};
        prevEntries.forEach(e => {
          const m = parseInt(e.entry_date.substring(5, 7));
          prevByMonth[m] = (prevByMonth[m] || 0) + (Number(e.total_register) || 0);
        });

        // Fallback from monthly_summaries for prev year
        const prevSummaryByMonth: Record<number, number> = {};
        prevMonthlySummaries.forEach(s => {
          prevSummaryByMonth[s.month] = (prevSummaryByMonth[s.month] || 0) + (Number(s.total_income) || 0);
        });

        // Summary by month (for months without daily entries)
        const summaryByMonth: Record<number, { total_income: number; budget_diff_pct: number; yoy_pct: number }> = {};
        monthlySummaries.forEach(s => {
          if (!summaryByMonth[s.month]) {
            summaryByMonth[s.month] = { total_income: 0, budget_diff_pct: 0, yoy_pct: 0 };
          }
          summaryByMonth[s.month].total_income += Number(s.total_income) || 0;
          summaryByMonth[s.month].budget_diff_pct = Number(s.sales_budget_diff_pct) || 0;
          summaryByMonth[s.month].yoy_pct = Number(s.sales_yoy_change_pct) || 0;
        });

        // Goals by month
        const goalsByMonth: Record<number, number> = {};
        goals.forEach(g => {
          goalsByMonth[g.month] = (goalsByMonth[g.month] || 0) + (Number(g.revenue_target) || 0);
        });

        for (let m = 1; m <= 12; m++) {
          let value = byMonth[m] || 0;
          let targetDiffPct = 0;
          let yoyChangePct = 0;

          // Use monthly_summaries as fallback
          if (value === 0 && summaryByMonth[m]) {
            value = summaryByMonth[m].total_income;
            targetDiffPct = summaryByMonth[m].budget_diff_pct;
            yoyChangePct = summaryByMonth[m].yoy_pct;
          } else if (value > 0) {
            // Calculate target diff from goals
            const target = goalsByMonth[m] || 0;
            targetDiffPct = target > 0 ? ((value / target) - 1) * 100 : 0;

            // Calculate YoY change
            const prevValue = prevByMonth[m] || prevSummaryByMonth[m] || 0;
            yoyChangePct = prevValue > 0 ? ((value / prevValue) - 1) * 100 : 0;
          }

          results.push({
            month: m,
            monthName: monthNames[m - 1],
            value,
            valuePct: null,
            targetDiffPct,
            yoyChangePct,
          });
        }
      } else if (cardType === 'incomeSource' && sourceId) {
        // Fetch income breakdown for a specific source
        const [entriesResult, prevEntriesResult] = await Promise.all([
          supabase
            .from("daily_entries")
            .select("id, entry_date")
            .in("business_id", businessIds)
            .gte("entry_date", yearStart)
            .lte("entry_date", yearEnd)
            .is("deleted_at", null),
          supabase
            .from("daily_entries")
            .select("id, entry_date")
            .in("business_id", businessIds)
            .gte("entry_date", prevYearStart)
            .lte("entry_date", prevYearEnd)
            .is("deleted_at", null),
        ]);

        const entries = entriesResult.data || [];
        const prevEntries = prevEntriesResult.data || [];
        const entryIds = entries.map(e => e.id);
        const prevEntryIds = prevEntries.map(e => e.id);

        // Fetch breakdowns
        const [breakdownResult, prevBreakdownResult, goalsResult, incomeSourceGoalsResult] = await Promise.all([
          entryIds.length > 0
            ? supabase
                .from("daily_income_breakdown")
                .select("daily_entry_id, income_source_id, amount, orders_count")
                .in("daily_entry_id", entryIds)
                .eq("income_source_id", sourceId)
            : Promise.resolve({ data: [] }),
          prevEntryIds.length > 0
            ? supabase
                .from("daily_income_breakdown")
                .select("daily_entry_id, income_source_id, amount, orders_count")
                .in("daily_entry_id", prevEntryIds)
                .eq("income_source_id", sourceId)
            : Promise.resolve({ data: [] }),
          supabase
            .from("goals")
            .select("id, year, month")
            .in("business_id", businessIds)
            .eq("year", year)
            .is("deleted_at", null),
          // Will need to fetch after getting goal IDs
          Promise.resolve({ data: [] }),
        ]);

        const breakdowns = breakdownResult.data || [];
        const prevBreakdowns = prevBreakdownResult.data || [];
        const goals = goalsResult.data || [];

        // Fetch income source goals
        const goalIds = goals.map(g => g.id);
        let avgTicketTarget = 0;
        if (goalIds.length > 0) {
          const { data: isgData } = await supabase
            .from("income_source_goals")
            .select("income_source_id, avg_ticket_target")
            .in("goal_id", goalIds)
            .eq("income_source_id", sourceId);
          if (isgData && isgData.length > 0) {
            avgTicketTarget = isgData.reduce((sum, g) => sum + (Number(g.avg_ticket_target) || 0), 0) / isgData.length;
          }
        }

        // Map entry ID to month
        const entryMonthMap: Record<string, number> = {};
        entries.forEach(e => {
          entryMonthMap[e.id] = parseInt(e.entry_date.substring(5, 7));
        });
        const prevEntryMonthMap: Record<string, number> = {};
        prevEntries.forEach(e => {
          prevEntryMonthMap[e.id] = parseInt(e.entry_date.substring(5, 7));
        });

        // Group breakdowns by month
        const byMonth: Record<number, { total: number; orders: number }> = {};
        breakdowns.forEach(b => {
          const m = entryMonthMap[b.daily_entry_id];
          if (!m) return;
          if (!byMonth[m]) byMonth[m] = { total: 0, orders: 0 };
          byMonth[m].total += Number(b.amount) || 0;
          byMonth[m].orders += Number(b.orders_count) || 0;
        });

        const prevByMonth: Record<number, { total: number; orders: number }> = {};
        prevBreakdowns.forEach(b => {
          const m = prevEntryMonthMap[b.daily_entry_id];
          if (!m) return;
          if (!prevByMonth[m]) prevByMonth[m] = { total: 0, orders: 0 };
          prevByMonth[m].total += Number(b.amount) || 0;
          prevByMonth[m].orders += Number(b.orders_count) || 0;
        });

        for (let m = 1; m <= 12; m++) {
          const data = byMonth[m] || { total: 0, orders: 0 };
          const prevData = prevByMonth[m] || { total: 0, orders: 0 };
          const avg = data.orders > 0 ? data.total / data.orders : 0;
          const prevAvg = prevData.orders > 0 ? prevData.total / prevData.orders : 0;

          // Target diff: (avg - target) / target
          const targetDiffPct = avgTicketTarget > 0 && avg > 0 ? ((avg / avgTicketTarget) - 1) * 100 : 0;
          // YoY change
          const yoyChangePct = prevAvg > 0 && avg > 0 ? ((avg / prevAvg) - 1) * 100 : 0;

          results.push({
            month: m,
            monthName: monthNames[m - 1],
            value: data.total,
            valuePct: null,
            targetDiffPct,
            yoyChangePct,
          });
        }
      } else if (cardType === 'laborCost') {
        // Fetch labor cost data
        const [entriesResult, prevEntriesResult, businessDataResult, goalsResult, scheduleResult] = await Promise.all([
          supabase
            .from("daily_entries")
            .select("entry_date, total_register, labor_cost, day_factor")
            .in("business_id", businessIds)
            .gte("entry_date", yearStart)
            .lte("entry_date", yearEnd)
            .is("deleted_at", null),
          supabase
            .from("daily_entries")
            .select("entry_date, total_register, labor_cost, day_factor")
            .in("business_id", businessIds)
            .gte("entry_date", prevYearStart)
            .lte("entry_date", prevYearEnd)
            .is("deleted_at", null),
          supabase
            .from("businesses")
            .select("id, vat_percentage, markup_percentage, manager_monthly_salary")
            .in("id", businessIds),
          supabase
            .from("goals")
            .select("year, month, labor_cost_target_pct, vat_percentage, markup_percentage")
            .in("business_id", businessIds)
            .eq("year", year)
            .is("deleted_at", null),
          supabase
            .from("business_schedule")
            .select("day_of_week, day_factor")
            .in("business_id", businessIds),
        ]);

        const entries = entriesResult.data || [];
        const prevEntries = prevEntriesResult.data || [];
        const businessData = businessDataResult.data || [];
        const goals = goalsResult.data || [];
        const scheduleData = scheduleResult.data || [];

        const defaultVatPct = businessData.reduce((sum, b) => sum + (Number(b.vat_percentage) || 0), 0) / Math.max(businessData.length, 1);
        const defaultMarkup = businessData.reduce((sum, b) => sum + (Number(b.markup_percentage) || 1), 0) / Math.max(businessData.length, 1);
        const totalManagerSalary = businessData.reduce((sum, b) => sum + (Number(b.manager_monthly_salary) || 0), 0);

        // Goals by month
        const goalsByMonth: Record<number, { targetPct: number; vatPct: number; markup: number }> = {};
        goals.forEach(g => {
          goalsByMonth[g.month] = {
            targetPct: Number(g.labor_cost_target_pct) || 0,
            vatPct: g.vat_percentage != null ? Number(g.vat_percentage) : defaultVatPct,
            markup: g.markup_percentage != null ? Number(g.markup_percentage) : defaultMarkup,
          };
        });

        // Calculate expected work days per month
        const calcExpectedWorkDays = (monthIdx: number, yr: number) => {
          const monthStart = new Date(yr, monthIdx, 1);
          const monthEnd = new Date(yr, monthIdx + 1, 0);
          let total = 0;
          const d = new Date(monthStart);
          while (d <= monthEnd) {
            const dow = d.getDay();
            const dayFactor = scheduleData.find(s => s.day_of_week === dow)?.day_factor || 0;
            if (dayFactor > 0) total += dayFactor;
            d.setDate(d.getDate() + 1);
          }
          return total || 22;
        };

        // Group entries by month
        const byMonth: Record<number, { income: number; laborCost: number; dayFactors: number }> = {};
        entries.forEach(e => {
          const m = parseInt(e.entry_date.substring(5, 7));
          if (!byMonth[m]) byMonth[m] = { income: 0, laborCost: 0, dayFactors: 0 };
          byMonth[m].income += Number(e.total_register) || 0;
          byMonth[m].laborCost += Number(e.labor_cost) || 0;
          byMonth[m].dayFactors += Number(e.day_factor) || 0;
        });

        const prevByMonth: Record<number, { income: number; laborCost: number; dayFactors: number }> = {};
        prevEntries.forEach(e => {
          const m = parseInt(e.entry_date.substring(5, 7));
          if (!prevByMonth[m]) prevByMonth[m] = { income: 0, laborCost: 0, dayFactors: 0 };
          prevByMonth[m].income += Number(e.total_register) || 0;
          prevByMonth[m].laborCost += Number(e.labor_cost) || 0;
          prevByMonth[m].dayFactors += Number(e.day_factor) || 0;
        });

        for (let m = 1; m <= 12; m++) {
          const data = byMonth[m] || { income: 0, laborCost: 0, dayFactors: 0 };
          const prevData = prevByMonth[m] || { income: 0, laborCost: 0, dayFactors: 0 };
          const goal = goalsByMonth[m] || { targetPct: 0, vatPct: defaultVatPct, markup: defaultMarkup };
          const vatDivisor = goal.vatPct > 0 ? 1 + goal.vatPct : 1;

          const expectedWorkDays = calcExpectedWorkDays(m - 1, year);
          const managerDailyCost = totalManagerSalary / expectedWorkDays;
          const totalLaborCost = (data.laborCost + (managerDailyCost * data.dayFactors)) * goal.markup;
          const incomeBeforeVat = data.income / vatDivisor;
          const laborPct = incomeBeforeVat > 0 ? (totalLaborCost / incomeBeforeVat) * 100 : 0;

          // Previous year
          const prevExpectedWorkDays = calcExpectedWorkDays(m - 1, prevYear);
          const prevManagerDailyCost = totalManagerSalary / prevExpectedWorkDays;
          const prevTotalLaborCost = (prevData.laborCost + (prevManagerDailyCost * prevData.dayFactors)) * goal.markup;
          const prevIncomeBeforeVat = prevData.income / vatDivisor;
          const prevLaborPct = prevIncomeBeforeVat > 0 ? (prevTotalLaborCost / prevIncomeBeforeVat) * 100 : 0;

          const targetDiffPct = data.income > 0 ? laborPct - goal.targetPct : 0;
          const yoyChangePct = prevLaborPct > 0 && laborPct > 0 ? laborPct - prevLaborPct : 0;

          results.push({
            month: m,
            monthName: monthNames[m - 1],
            value: totalLaborCost,
            valuePct: laborPct,
            targetDiffPct,
            yoyChangePct,
          });
        }
      } else if (cardType === 'foodCost' || cardType === 'currentExpenses') {
        // Fetch cost data (food cost or current expenses)
        const expenseType = cardType === 'foodCost' ? 'goods_purchases' : 'current_expenses';
        const targetField = cardType === 'foodCost' ? 'food_cost_target_pct' : 'current_expenses_target_pct';

        const [suppliersResult, entriesResult, prevEntriesResult, goalsResult, businessDataResult] = await Promise.all([
          supabase
            .from("suppliers")
            .select("id")
            .in("business_id", businessIds)
            .eq("expense_type", expenseType)
            .eq("is_active", true)
            .is("deleted_at", null),
          supabase
            .from("daily_entries")
            .select("entry_date, total_register")
            .in("business_id", businessIds)
            .gte("entry_date", yearStart)
            .lte("entry_date", yearEnd)
            .is("deleted_at", null),
          supabase
            .from("daily_entries")
            .select("entry_date, total_register")
            .in("business_id", businessIds)
            .gte("entry_date", prevYearStart)
            .lte("entry_date", prevYearEnd)
            .is("deleted_at", null),
          supabase
            .from("goals")
            .select(`year, month, ${targetField}, vat_percentage`)
            .in("business_id", businessIds)
            .eq("year", year)
            .is("deleted_at", null),
          supabase
            .from("businesses")
            .select("id, vat_percentage")
            .in("id", businessIds),
        ]);

        const supplierIds = (suppliersResult.data || []).map(s => s.id);
        const entries = entriesResult.data || [];
        const prevEntries = prevEntriesResult.data || [];
        const goals = goalsResult.data || [];
        const businessData = businessDataResult.data || [];
        const defaultVatPct = businessData.reduce((sum, b) => sum + (Number(b.vat_percentage) || 0), 0) / Math.max(businessData.length, 1);

        // Fetch invoices
        const [invoicesResult, prevInvoicesResult] = await Promise.all([
          supplierIds.length > 0
            ? supabase
                .from("invoices")
                .select("invoice_date, subtotal")
                .in("supplier_id", supplierIds)
                .in("business_id", businessIds)
                .gte("invoice_date", yearStart)
                .lte("invoice_date", yearEnd)
                .is("deleted_at", null)
            : Promise.resolve({ data: [] }),
          supplierIds.length > 0
            ? supabase
                .from("invoices")
                .select("invoice_date, subtotal")
                .in("supplier_id", supplierIds)
                .in("business_id", businessIds)
                .gte("invoice_date", prevYearStart)
                .lte("invoice_date", prevYearEnd)
                .is("deleted_at", null)
            : Promise.resolve({ data: [] }),
        ]);

        const invoices = invoicesResult.data || [];
        const prevInvoices = prevInvoicesResult.data || [];

        // Group invoices by month
        const invByMonth: Record<number, number> = {};
        invoices.forEach(inv => {
          const m = parseInt(inv.invoice_date.substring(5, 7));
          invByMonth[m] = (invByMonth[m] || 0) + (Number(inv.subtotal) || 0);
        });

        const prevInvByMonth: Record<number, number> = {};
        prevInvoices.forEach(inv => {
          const m = parseInt(inv.invoice_date.substring(5, 7));
          prevInvByMonth[m] = (prevInvByMonth[m] || 0) + (Number(inv.subtotal) || 0);
        });

        // Group income by month
        const incomeByMonth: Record<number, number> = {};
        entries.forEach(e => {
          const m = parseInt(e.entry_date.substring(5, 7));
          incomeByMonth[m] = (incomeByMonth[m] || 0) + (Number(e.total_register) || 0);
        });

        const prevIncomeByMonth: Record<number, number> = {};
        prevEntries.forEach(e => {
          const m = parseInt(e.entry_date.substring(5, 7));
          prevIncomeByMonth[m] = (prevIncomeByMonth[m] || 0) + (Number(e.total_register) || 0);
        });

        // Goals by month
        const goalsByMonth: Record<number, { targetPct: number; vatPct: number }> = {};
        goals.forEach(g => {
          const targetPctVal = Number((g as Record<string, unknown>)[targetField]) || 0;
          goalsByMonth[g.month] = {
            targetPct: targetPctVal,
            vatPct: g.vat_percentage != null ? Number(g.vat_percentage) : defaultVatPct,
          };
        });

        for (let m = 1; m <= 12; m++) {
          const cost = invByMonth[m] || 0;
          const income = incomeByMonth[m] || 0;
          const prevCost = prevInvByMonth[m] || 0;
          const prevIncome = prevIncomeByMonth[m] || 0;
          const goal = goalsByMonth[m] || { targetPct: 0, vatPct: defaultVatPct };
          const vatDivisor = goal.vatPct > 0 ? 1 + goal.vatPct : 1;
          const incomeBeforeVat = income / vatDivisor;
          const prevIncomeBeforeVat = prevIncome / vatDivisor;

          const costPct = incomeBeforeVat > 0 ? (cost / incomeBeforeVat) * 100 : 0;
          const prevCostPct = prevIncomeBeforeVat > 0 ? (prevCost / prevIncomeBeforeVat) * 100 : 0;

          const targetDiffPct = income > 0 ? costPct - goal.targetPct : 0;
          const yoyChangePct = prevCostPct > 0 && costPct > 0 ? costPct - prevCostPct : 0;

          results.push({
            month: m,
            monthName: monthNames[m - 1],
            value: cost,
            valuePct: costPct,
            targetDiffPct,
            yoyChangePct,
          });
        }
      } else if (cardType === 'managedProduct' && sourceId) {
        // Fetch managed product data
        const [productResult, entriesResult, prevEntriesResult, businessDataResult] = await Promise.all([
          supabase
            .from("managed_products")
            .select("id, unit_cost, target_pct")
            .eq("id", sourceId)
            .maybeSingle(),
          supabase
            .from("daily_entries")
            .select("id, entry_date, total_register")
            .in("business_id", businessIds)
            .gte("entry_date", yearStart)
            .lte("entry_date", yearEnd)
            .is("deleted_at", null),
          supabase
            .from("daily_entries")
            .select("id, entry_date, total_register")
            .in("business_id", businessIds)
            .gte("entry_date", prevYearStart)
            .lte("entry_date", prevYearEnd)
            .is("deleted_at", null),
          supabase
            .from("businesses")
            .select("id, vat_percentage")
            .in("id", businessIds),
        ]);

        const product = productResult.data;
        const entries = entriesResult.data || [];
        const prevEntries = prevEntriesResult.data || [];
        const businessData = businessDataResult.data || [];
        const defaultVatPct = businessData.reduce((sum, b) => sum + (Number(b.vat_percentage) || 0), 0) / Math.max(businessData.length, 1);
        const vatDivisor = defaultVatPct > 0 ? 1 + defaultVatPct : 1;
        const unitCost = Number(product?.unit_cost) || 0;
        const targetPct = Number(product?.target_pct) || 0;

        const entryIds = entries.map(e => e.id);
        const prevEntryIds = prevEntries.map(e => e.id);

        // Fetch product usage
        const [usageResult, prevUsageResult] = await Promise.all([
          entryIds.length > 0
            ? supabase
                .from("daily_product_usage")
                .select("daily_entry_id, quantity")
                .in("daily_entry_id", entryIds)
                .eq("product_id", sourceId)
            : Promise.resolve({ data: [] }),
          prevEntryIds.length > 0
            ? supabase
                .from("daily_product_usage")
                .select("daily_entry_id, quantity")
                .in("daily_entry_id", prevEntryIds)
                .eq("product_id", sourceId)
            : Promise.resolve({ data: [] }),
        ]);

        const usage = usageResult.data || [];
        const prevUsage = prevUsageResult.data || [];

        // Map entry ID to month
        const entryMonthMap: Record<string, number> = {};
        entries.forEach(e => { entryMonthMap[e.id] = parseInt(e.entry_date.substring(5, 7)); });
        const prevEntryMonthMap: Record<string, number> = {};
        prevEntries.forEach(e => { prevEntryMonthMap[e.id] = parseInt(e.entry_date.substring(5, 7)); });

        // Group by month
        const usageByMonth: Record<number, number> = {};
        usage.forEach(u => {
          const m = entryMonthMap[u.daily_entry_id];
          if (m) usageByMonth[m] = (usageByMonth[m] || 0) + (Number(u.quantity) || 0);
        });

        const prevUsageByMonth: Record<number, number> = {};
        prevUsage.forEach(u => {
          const m = prevEntryMonthMap[u.daily_entry_id];
          if (m) prevUsageByMonth[m] = (prevUsageByMonth[m] || 0) + (Number(u.quantity) || 0);
        });

        // Group income by month
        const incomeByMonth: Record<number, number> = {};
        entries.forEach(e => {
          const m = parseInt(e.entry_date.substring(5, 7));
          incomeByMonth[m] = (incomeByMonth[m] || 0) + (Number(e.total_register) || 0);
        });

        const prevIncomeByMonth: Record<number, number> = {};
        prevEntries.forEach(e => {
          const m = parseInt(e.entry_date.substring(5, 7));
          prevIncomeByMonth[m] = (prevIncomeByMonth[m] || 0) + (Number(e.total_register) || 0);
        });

        for (let m = 1; m <= 12; m++) {
          const quantity = usageByMonth[m] || 0;
          const cost = quantity * unitCost;
          const income = incomeByMonth[m] || 0;
          const incomeBeforeVat = income / vatDivisor;
          const costPct = incomeBeforeVat > 0 ? (cost / incomeBeforeVat) * 100 : 0;

          const prevQuantity = prevUsageByMonth[m] || 0;
          const prevCost = prevQuantity * unitCost;
          const prevIncome = prevIncomeByMonth[m] || 0;
          const prevIncomeBeforeVat = prevIncome / vatDivisor;
          const prevCostPct = prevIncomeBeforeVat > 0 ? (prevCost / prevIncomeBeforeVat) * 100 : 0;

          const targetDiffPct = income > 0 ? costPct - targetPct : 0;
          const yoyChangePct = prevCostPct > 0 && costPct > 0 ? costPct - prevCostPct : 0;

          results.push({
            month: m,
            monthName: monthNames[m - 1],
            value: cost,
            valuePct: costPct,
            targetDiffPct,
            yoyChangePct,
          });
        }
      }

      setMonthlyData(results);
    } catch (err) {
      console.error("Error fetching history data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [isOpen, businessIds, cardType, sourceId, year]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Determine column headers based on card type
  const isCostCard = ['laborCost', 'foodCost', 'managedProduct', 'currentExpenses'].includes(cardType);
  const valueHeader = isCostCard ? `${cardTitle}\n(%)` : `${cardTitle}\n(₪)`;
  const valueAmountHeader = isCostCard ? `${cardTitle}\n(₪)` : null;

  const getValueColor = (row: MonthData) => {
    if (row.value === 0 && (row.valuePct === null || row.valuePct === 0)) return 'text-white';
    if (isCostCard) {
      return row.targetDiffPct > 0 ? 'text-red-500' : row.targetDiffPct < 0 ? 'text-green-500' : 'text-white';
    }
    return row.targetDiffPct > 0 ? 'text-green-500' : row.targetDiffPct < 0 ? 'text-red-500' : 'text-white';
  };

  const getDiffColor = (value: number) => {
    if (value === 0) return 'text-white';
    if (isCostCard) {
      return value > 0 ? 'text-red-500' : 'text-green-500';
    }
    return value > 0 ? 'text-green-500' : value < 0 ? 'text-red-500' : 'text-white';
  };

  const getYoyColor = (value: number) => {
    if (value === 0) return 'text-white';
    if (isCostCard) {
      return value > 0 ? 'text-red-500' : 'text-green-500';
    }
    return value > 0 ? 'text-green-500' : value < 0 ? 'text-red-500' : 'text-white';
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
        showCloseButton={false}
      >
        {/* Header */}
        <div className="flex flex-row-reverse justify-between items-center w-full px-[15px] pt-[15px] pb-[10px]">
          <button
            type="button"
            onClick={onClose}
            className="text-white text-center font-bold text-sm leading-none rounded-[7px] py-[7px] px-[10px] cursor-pointer"
            style={{ backgroundColor: 'rgb(41, 49, 138)', boxShadow: '0px 7px 30px -10px rgba(99, 102, 241, 0.1)' }}
          >
            <div className="flex items-center gap-[5px]">
              <ArrowRight className="w-4 h-4" />
              <span>חזרה</span>
            </div>
          </button>

          {/* Year selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setYearDropdownOpen(!yearDropdownOpen)}
              className="flex items-center gap-[8px] text-white text-[18px] font-normal leading-none rounded-[7px] py-[7px] px-[12px] cursor-pointer border border-[#4C526B]"
            >
              <ChevronDown className="w-[11px] h-[11px] text-white" />
              <span className="ltr-num">{year}</span>
            </button>
            {yearDropdownOpen && (
              <div className="absolute top-full mt-1 left-0 z-50 bg-[rgb(41,49,138)] rounded-[7px] border border-[#4C526B] shadow-lg max-h-[200px] overflow-y-auto min-w-[80px]">
                {availableYears.map(y => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => { setYear(y); setYearDropdownOpen(false); }}
                    className={`block w-full text-center text-white text-[16px] py-[6px] px-[12px] cursor-pointer hover:bg-white/10 ltr-num ${y === year ? 'bg-white/20 font-bold' : ''}`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Title */}
        <div className="flex flex-col items-center gap-[5px] px-[10px] pb-[15px]">
          <h2 className="text-white text-[28px] font-bold leading-[1.4] text-center">
            {cardTitle}
          </h2>
          <span className="text-white text-[18px] font-normal leading-[1.4] text-center">
            תוצאות בפועל <span className="ltr-num">{year}</span>
          </span>
        </div>

        {/* Table */}
        <div className="px-[10px] pb-[25px]">
          <div className="rounded-[20px] p-[10px_10px_25px] overflow-hidden" style={{ backgroundColor: 'rgb(41, 49, 138)' }}>
            {isLoading ? (
              <div className="flex items-center justify-center py-[60px]">
                <div className="text-white/50 text-[16px] animate-pulse">טוען נתונים...</div>
              </div>
            ) : (
              <div className="flex flex-row-reverse gap-[3px] w-full">
                {/* Column: שינוי משנה שעברה % */}
                <div className="flex-1 flex flex-col gap-[5px]">
                  <div className="text-white text-[14px] lg:text-[18px] font-semibold text-center leading-[1.4] pb-[5px] min-h-[50px] flex items-end justify-center">
                    שינוי משנה שעברה<br/>%
                  </div>
                  <div className="border border-white rounded-[10px] p-[5px] flex flex-col gap-[10px]">
                    {monthlyData.map(row => (
                      <div key={`yoy-${row.month}`} className="flex items-center justify-center min-h-[21px]">
                        <span className={`text-[13px] lg:text-[15px] font-normal text-center leading-[1.4] ltr-num ${getYoyColor(row.yoyChangePct)}`}>
                          {row.value === 0 && (row.valuePct === null || row.valuePct === 0) ? '0%' : formatPercentWithSign(row.yoyChangePct)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Column: הפרש מהיעד % */}
                <div className="flex-1 flex flex-col gap-[5px]">
                  <div className="text-white text-[14px] lg:text-[18px] font-semibold text-center leading-[1.4] pb-[5px] min-h-[50px] flex items-end justify-center">
                    הפרש מהיעד<br/>%
                  </div>
                  <div className="border border-white rounded-[10px] p-[5px] flex flex-col gap-[10px]">
                    {monthlyData.map(row => (
                      <div key={`diff-${row.month}`} className="flex items-center justify-center min-h-[21px]">
                        <span className={`text-[13px] lg:text-[15px] font-normal text-center leading-[1.4] ltr-num ${getDiffColor(row.targetDiffPct)}`}>
                          {row.value === 0 && (row.valuePct === null || row.valuePct === 0) ? '0%' : formatPercentWithSign(row.targetDiffPct)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Column: Value % (for cost cards) */}
                {isCostCard && (
                  <div className="flex-1 flex flex-col gap-[5px]">
                    <div className="text-white text-[14px] lg:text-[18px] font-semibold text-center leading-[1.4] pb-[5px] min-h-[50px] flex items-end justify-center whitespace-pre-line">
                      {cardTitle}{"\n"}(%)
                    </div>
                    <div className="border border-white rounded-[10px] p-[5px] flex flex-col gap-[10px]">
                      {monthlyData.map(row => (
                        <div key={`pct-${row.month}`} className="flex items-center justify-center min-h-[21px]">
                          <span className={`text-[13px] lg:text-[15px] font-normal text-center leading-[1.4] ltr-num ${getValueColor(row)}`}>
                            {row.valuePct !== null ? formatPercent(row.valuePct) : '0%'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Column: Value ₪ */}
                <div className="flex-1 flex flex-col gap-[5px]">
                  <div className="text-white text-[14px] lg:text-[18px] font-semibold text-center leading-[1.4] pb-[5px] min-h-[50px] flex items-end justify-center whitespace-pre-line">
                    {cardTitle}{"\n"}(₪)
                  </div>
                  <div className="border border-white rounded-[10px] p-[5px] flex flex-col gap-[10px]">
                    {monthlyData.map(row => (
                      <div key={`val-${row.month}`} className="flex items-center justify-center min-h-[21px]">
                        <span className={`text-[13px] lg:text-[15px] font-normal text-center leading-[1.4] ltr-num ${getValueColor(row)}`}>
                          {formatCurrencyFull(row.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Column: חודש */}
                <div className="flex flex-col gap-[5px]" style={{ minWidth: '55px' }}>
                  <div className="text-white text-[14px] lg:text-[18px] font-semibold text-center leading-[1.4] pb-[5px] min-h-[50px] flex items-end justify-center">
                    חודש
                  </div>
                  <div className="border border-white rounded-[10px] p-[5px] flex flex-col gap-[10px]">
                    {monthlyData.map(row => (
                      <div key={`month-${row.month}`} className="flex items-center justify-center min-h-[21px]">
                        <span className="text-white text-[13px] lg:text-[15px] font-normal text-center leading-[1.4]">
                          {row.monthName}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
