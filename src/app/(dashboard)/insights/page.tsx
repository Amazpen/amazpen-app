"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "../layout";
import { createClient } from "@/lib/supabase/client";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { ChartLineUpIcon as ChartLineUp, ReceiptIcon as Receipt, UsersThreeIcon as UsersThree, PackageIcon as Package, ArrowsLeftRightIcon as ArrowsLeftRight, GearSixIcon as GearSix, TrophyIcon as Trophy } from "@phosphor-icons/react";

// ============================================================================
// TYPES
// ============================================================================
type InsightSeverity = "positive" | "negative" | "warning" | "info";
type InsightCategory = "revenue" | "expenses" | "labor" | "suppliers" | "cashflow" | "operations" | "goals";

interface Insight {
  id: string;
  title: string;
  description: string;
  severity: InsightSeverity;
  category: InsightCategory;
  value?: string;
}

// ============================================================================
// HELPERS
// ============================================================================
const formatCurrencyFull = (amount: number) => {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const sign = isNegative ? "-" : "";
  const formatted = Math.round(absAmount).toLocaleString("he-IL");
  return `${sign}₪${formatted}`;
};

const formatPercent = (value: number) => `${value.toFixed(1)}%`;
const formatNumber = (value: number) => Math.round(value).toLocaleString("he-IL");

const categoryLabels: Record<InsightCategory, string> = {
  revenue: "הכנסות",
  expenses: "הוצאות",
  labor: "עובדים",
  suppliers: "ספקים",
  cashflow: "תזרים",
  operations: "תפעול",
  goals: "יעדים",
};

const categoryIcons: Record<InsightCategory, string> = {
  revenue: "icon-bg-green",
  expenses: "icon-bg-pink",
  labor: "icon-bg-purple",
  suppliers: "icon-bg-orange",
  cashflow: "icon-bg-blue",
  operations: "icon-bg-peach",
  goals: "icon-bg-green",
};

const severityStyles: Record<InsightSeverity, { border: string; badge: string; badgeText: string }> = {
  positive: { border: "border-emerald-500/30", badge: "bg-emerald-500/20", badgeText: "text-emerald-400" },
  negative: { border: "border-red-500/30", badge: "bg-red-500/20", badgeText: "text-red-400" },
  warning: { border: "border-amber-500/30", badge: "bg-amber-500/20", badgeText: "text-amber-400" },
  info: { border: "border-blue-500/30", badge: "bg-blue-500/20", badgeText: "text-blue-400" },
};

const severityLabels: Record<InsightSeverity, string> = {
  positive: "חיובי",
  negative: "דורש תשומת לב",
  warning: "אזהרה",
  info: "מידע",
};

// ============================================================================
// CATEGORY ICONS (SVG)
// ============================================================================
const categoryPhosphorIcons: Record<InsightCategory, React.ElementType> = {
  revenue: ChartLineUp,
  expenses: Receipt,
  labor: UsersThree,
  suppliers: Package,
  cashflow: ArrowsLeftRight,
  operations: GearSix,
  goals: Trophy,
};

const CategoryIcon = ({ category }: { category: InsightCategory }) => {
  const Icon = categoryPhosphorIcons[category];
  return <Icon size={18} color="currentColor" weight="duotone" />;
};

// ============================================================================
// INSIGHT CARD COMPONENT
// ============================================================================
const InsightCard = ({ insight }: { insight: Insight }) => {
  const styles = severityStyles[insight.severity];
  const iconClass = categoryIcons[insight.category];

  return (
    <div className={`data-card-new flex flex-col gap-[12px] rounded-[10px] p-[16px] min-h-[160px] w-full border-r-[3px] ${styles.border} transition-all duration-200 hover:scale-[1.01]`}>
      {/* Header */}
      <div className="flex justify-between items-start gap-[8px]">
        <div className="flex items-center gap-[8px]">
          <div className={`w-[31px] h-[31px] rounded-full ${iconClass} flex items-center justify-center text-white flex-shrink-0`}>
            <CategoryIcon category={insight.category} />
          </div>
          <span className="text-white/50 text-[11px] font-medium">{categoryLabels[insight.category]}</span>
        </div>
        <div className={`px-2.5 py-1 rounded-full ${styles.badge} flex-shrink-0 flex items-center justify-center`}>
          <span className={`text-[10px] font-medium leading-none ${styles.badgeText}`}>{severityLabels[insight.severity]}</span>
        </div>
      </div>

      {/* Title */}
      <h3 className="text-white text-[15px] font-bold leading-tight">{insight.title}</h3>

      {/* Description */}
      <p className="text-white/70 text-[13px] leading-relaxed flex-1">{insight.description}</p>

      {/* Value highlight */}
      {insight.value && (
        <div className="mt-auto pt-[8px] border-t border-white/10">
          <span className="text-white/90 text-[13px] font-semibold ltr-num">{insight.value}</span>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// SKELETON CARD
// ============================================================================
const SkeletonCard = () => (
  <div className="data-card-new flex flex-col gap-[12px] rounded-[10px] p-[16px] min-h-[160px] w-full animate-pulse">
    <div className="flex justify-between items-start">
      <div className="flex items-center gap-[8px]">
        <div className="w-[31px] h-[31px] rounded-full bg-white/10" />
        <div className="w-[40px] h-[12px] rounded bg-white/10" />
      </div>
      <div className="w-[60px] h-[18px] rounded-full bg-white/10" />
    </div>
    <div className="w-[70%] h-[16px] rounded bg-white/10" />
    <div className="space-y-[6px] flex-1">
      <div className="w-full h-[12px] rounded bg-white/10" />
      <div className="w-[85%] h-[12px] rounded bg-white/10" />
    </div>
    <div className="mt-auto pt-[8px] border-t border-white/10">
      <div className="w-[100px] h-[14px] rounded bg-white/10" />
    </div>
  </div>
);

// ============================================================================
// FILTER TABS
// ============================================================================
const filterOptions: { key: InsightCategory | "all"; label: string }[] = [
  { key: "all", label: "הכל" },
  { key: "revenue", label: "הכנסות" },
  { key: "expenses", label: "הוצאות" },
  { key: "labor", label: "עובדים" },
  { key: "suppliers", label: "ספקים" },
  { key: "cashflow", label: "תזרים" },
  { key: "operations", label: "תפעול" },
  { key: "goals", label: "יעדים" },
];

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// ============================================================================
// MAIN PAGE
// ============================================================================
export default function InsightsPage() {
  const { selectedBusinesses, isAdmin } = useDashboard();
  const router = useRouter();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<InsightCategory | "all">("all");

  // Gate: insights is admin-only for now. Non-admin sees "בקרוב" in the sidebar;
  // if they bypass the sidebar we redirect them back to the dashboard.
  const [isCheckingAdminAccess, setIsCheckingAdminAccess] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setIsCheckingAdminAccess(false), 500);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!isCheckingAdminAccess && !isAdmin) router.replace('/');
  }, [isAdmin, isCheckingAdminAccess, router]);

  const fetchInsights = useCallback(async () => {
    if (!selectedBusinesses || selectedBusinesses.length === 0) {
      setInsights([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const results: Insight[] = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const dayOfMonth = now.getDate();

    const currentMonthStart = `${currentYear}-${String(currentMonth).padStart(2, "0")}-01`;
    const currentMonthEnd = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${daysInMonth}`;
    const prevMonthStart = `${prevMonthYear}-${String(prevMonth).padStart(2, "0")}-01`;
    const prevMonthEnd = `${prevMonthYear}-${String(prevMonth).padStart(2, "0")}-${new Date(prevMonthYear, prevMonth, 0).getDate()}`;
    const today = now.toISOString().split("T")[0];

    const businessIds = selectedBusinesses;

    try {
      // ====================================================================
      // BATCH FETCH: Get all data in parallel for performance
      // ====================================================================
      const [
        { data: currentDailyEntries },
        { data: prevDailyEntries },
        { data: currentInvoices },
        { data: prevInvoices },
        { data: goals },
        { data: businesses },
        { data: fixedSuppliers },
        { data: incomeBreakdown },
        { data: incomeSources },
        { data: incomeSourceGoals },
        { data: allPaymentSplits },
        { data: receiptData },
        { data: productUsage },
        { data: managedProducts },
        { data: priorCommitmentsData },
        { data: businessSchedules },
        { data: dayExceptions },
      ] = await Promise.all([
        // Current month daily entries
        supabase
          .from("daily_entries")
          .select("id, entry_date, total_register, labor_cost, labor_hours, discounts, waste, day_factor, manager_daily_cost")
          .in("business_id", businessIds)
          .gte("entry_date", currentMonthStart)
          .lte("entry_date", currentMonthEnd)
          .is("deleted_at", null)
          .order("entry_date"),
        // Previous month daily entries
        supabase
          .from("daily_entries")
          .select("id, entry_date, total_register, labor_cost, labor_hours, discounts, waste, day_factor, manager_daily_cost")
          .in("business_id", businessIds)
          .gte("entry_date", prevMonthStart)
          .lte("entry_date", prevMonthEnd)
          .is("deleted_at", null),
        // Current month invoices with supplier details
        supabase
          .from("invoices")
          .select("supplier_id, subtotal, total_amount, invoice_type, invoice_date, suppliers!inner(name, expense_type, expense_category_id, is_fixed_expense)")
          .in("business_id", businessIds)
          .gte("reference_date", currentMonthStart)
          .lte("reference_date", currentMonthEnd)
          .is("deleted_at", null),
        // Previous month invoices
        supabase
          .from("invoices")
          .select("subtotal, suppliers!inner(expense_type)")
          .in("business_id", businessIds)
          .gte("reference_date", prevMonthStart)
          .lte("reference_date", prevMonthEnd)
          .is("deleted_at", null),
        // Goals
        supabase
          .from("goals")
          .select("*")
          .in("business_id", businessIds)
          .eq("year", currentYear)
          .eq("month", currentMonth)
          .is("deleted_at", null),
        // Business config
        supabase
          .from("businesses")
          .select("id, name, vat_percentage, markup_percentage, manager_monthly_salary")
          .in("id", businessIds)
          .is("deleted_at", null),
        // Fixed expense suppliers
        supabase
          .from("suppliers")
          .select("name, monthly_expense_amount, expense_category_id")
          .in("business_id", businessIds)
          .eq("is_fixed_expense", true)
          .eq("is_active", true)
          .is("deleted_at", null),
        // Income breakdown for current month
        supabase
          .from("daily_income_breakdown")
          .select("daily_entry_id, income_source_id, amount, orders_count")
          .in("daily_entry_id", []), // Will be filled after we get entry IDs
        // Income sources
        supabase
          .from("income_sources")
          .select("id, name, income_type, input_type")
          .in("business_id", businessIds)
          .eq("is_active", true)
          .is("deleted_at", null),
        // Income source goals
        supabase
          .from("income_source_goals")
          .select("income_source_id, avg_ticket_target, goal_id, goals!inner(business_id, year, month)")
          .eq("goals.year", currentYear)
          .eq("goals.month", currentMonth),
        // All payment splits with due dates
        supabase
          .from("payment_splits")
          .select("amount, due_date, payment_method, installments_count, installment_number, payments!inner(business_id, supplier_id, deleted_at, suppliers!inner(name, expense_type))")
          .is("payments.deleted_at", null),
        // Receipt data
        supabase
          .from("daily_receipts")
          .select("daily_entry_id, amount, receipt_types!inner(name)")
          .order("amount", { ascending: false }),
        // Product usage
        supabase
          .from("daily_product_usage")
          .select("daily_entry_id, product_id, quantity, unit_cost_at_time"),
        // Managed products
        supabase
          .from("managed_products")
          .select("id, name, unit, unit_cost, target_pct, display_order")
          .in("business_id", businessIds)
          .is("deleted_at", null)
          .order("display_order"),
        // Prior commitments
        supabase
          .from("prior_commitments")
          .select("name, monthly_amount, total_installments, start_date, end_date")
          .in("business_id", businessIds)
          .is("deleted_at", null),
        // Weekly schedule (closed days have day_factor=0) — David #13
        supabase
          .from("business_schedule")
          .select("business_id, day_of_week, day_factor")
          .in("business_id", businessIds),
        // Day-by-day exceptions (holidays, special closures) — David #13
        supabase
          .from("business_day_exceptions")
          .select("business_id, exception_date, day_factor")
          .in("business_id", businessIds)
          .gte("exception_date", currentMonthStart)
          .lte("exception_date", currentMonthEnd),
      ]);

      const entries = currentDailyEntries || [];
      const prevEntries = prevDailyEntries || [];
      const entryIds = entries.map((e) => e.id);

      // Fetch income breakdown with actual entry IDs
      const { data: actualIncomeBreakdown } = entryIds.length > 0
        ? await supabase
            .from("daily_income_breakdown")
            .select("daily_entry_id, income_source_id, amount, orders_count")
            .in("daily_entry_id", entryIds)
        : { data: [] };

      const incomeData = actualIncomeBreakdown || incomeBreakdown || [];

      // ====================================================================
      // COMPUTED VALUES
      // ====================================================================
      const biz = (businesses || [])[0];
      const vatPct = biz ? Number(biz.vat_percentage) || 0.18 : 0.18;
      const markupPct = biz ? Number(biz.markup_percentage) || 1.18 : 1.18;
      const managerSalary = biz ? Number(biz.manager_monthly_salary) || 0 : 0;

      const currentTotal = entries.reduce((s, r) => s + (Number(r.total_register) || 0), 0);
      const prevTotal = prevEntries.reduce((s, r) => s + (Number(r.total_register) || 0), 0);
      const incomeBeforeVat = currentTotal / (1 + vatPct);

      const totalLabor = entries.reduce((s, d) => s + (Number(d.labor_cost) || 0) + (Number(d.manager_daily_cost) || 0), 0);
      const totalLaborHours = entries.reduce((s, d) => s + (Number(d.labor_hours) || 0), 0);
      const totalDiscounts = entries.reduce((s, d) => s + (Number(d.discounts) || 0), 0);
      const totalWaste = entries.reduce((s, d) => s + (Number(d.waste) || 0), 0);
      const actualWorkDays = entries.reduce((s, d) => s + (Number(d.day_factor) || 0), 0);

      // Add manager salary to labor cost using the same formula as dashboard
      const laborCostWithManager = managerSalary > 0 && actualWorkDays > 0
        ? (totalLabor + (managerSalary / daysInMonth) * actualWorkDays) * markupPct
        : totalLabor * markupPct;

      const invoices = currentInvoices || [];
      const prevInvoiceList = prevInvoices || [];

      const goodsInvoices = invoices.filter((i) => (i.suppliers as unknown as { expense_type: string }).expense_type === "goods_purchases");
      const currentExpInvoices = invoices.filter((i) => (i.suppliers as unknown as { expense_type: string }).expense_type === "current_expenses");

      const totalGoods = goodsInvoices.reduce((s, i) => s + (Number(i.subtotal) || 0), 0);
      const totalCurrentExp = currentExpInvoices.reduce((s, i) => s + (Number(i.subtotal) || 0), 0);
      const _totalAllExpenses = totalGoods + totalCurrentExp;

      const prevGoods = prevInvoiceList.filter((i) => (i.suppliers as unknown as { expense_type: string }).expense_type === "goods_purchases").reduce((s, i) => s + (Number(i.subtotal) || 0), 0);
      const prevCurrentExp = prevInvoiceList.filter((i) => (i.suppliers as unknown as { expense_type: string }).expense_type === "current_expenses").reduce((s, i) => s + (Number(i.subtotal) || 0), 0);

      const goal = (goals || [])[0];

      // Filter payment splits by business
      const bizPaymentSplits = (allPaymentSplits || []).filter((ps) => {
        const payment = ps.payments as unknown as { business_id: string };
        return businessIds.includes(payment.business_id);
      });

      // Filter receipt data and product usage by entry IDs
      const bizReceipts = (receiptData || []).filter((r) => entryIds.includes(r.daily_entry_id));
      const bizProducts = (productUsage || []).filter((p) => entryIds.includes(p.daily_entry_id));

      // ====================================================================
      // PACE PROJECTIONS — every insight that compares actuals to a
      // monthly figure (fixed-expense budget, monthly target, etc.) MUST
      // use these projections instead of partial-month actuals. Otherwise
      // ratios on day 7 of a 31-day month look catastrophic just because
      // the denominator is 1/4 of what it'll be by month-end.
      // ====================================================================
      const dailyAvgRevenue = actualWorkDays > 0 ? currentTotal / actualWorkDays : 0;
      const monthlyPaceRevenue = dailyAvgRevenue * daysInMonth;
      const monthlyPaceIncomeBeforeVat = monthlyPaceRevenue / (1 + vatPct);

      // For partial-month invoice/labor totals, we project to a full-month
      // figure ONLY when at least 3 work-days have been logged. With fewer
      // entries the projection is too noisy to trust.
      const haveEnoughData = entries.length >= 3 && actualWorkDays > 0;
      const paceMultiplier = haveEnoughData ? daysInMonth / actualWorkDays : 1;
      const projectedGoods = totalGoods * paceMultiplier;
      const projectedCurrentExp = totalCurrentExp * paceMultiplier;
      const projectedLaborWithManager = laborCostWithManager * paceMultiplier;

      // ====================================================================
      // 1. REVENUE: Monthly trend — pace vs previous full month
      // We compare the projected pace against the previous full month so
      // mid-month entries don't fake a giant drop. (Old behaviour: 7-day
      // partial vs 30-day full → "ירידה 66%" even when actually trending
      // up.) If we don't have enough data for a stable pace yet, skip the
      // insight rather than generating a misleading one.
      // ====================================================================
      if (prevTotal > 0 && currentTotal > 0 && haveEnoughData && monthlyPaceRevenue > 0) {
        const changePct = ((monthlyPaceRevenue - prevTotal) / prevTotal) * 100;
        const isUp = changePct > 0;
        results.push({
          id: "revenue-trend",
          title: isUp ? "צפי עלייה בהכנסות לעומת חודש קודם" : "צפי ירידה בהכנסות לעומת חודש קודם",
          description: isUp
            ? `לפי הקצב הנוכחי, ההכנסות לסוף החודש צפויות להגיע ל-${formatCurrencyFull(monthlyPaceRevenue)} — עלייה של ${formatPercent(Math.abs(changePct))} לעומת ${formatCurrencyFull(prevTotal)} בחודש שעבר.`
            : `לפי הקצב הנוכחי, ההכנסות לסוף החודש צפויות להגיע ל-${formatCurrencyFull(monthlyPaceRevenue)} — ירידה של ${formatPercent(Math.abs(changePct))} לעומת ${formatCurrencyFull(prevTotal)} בחודש שעבר.`,
          severity: isUp ? "positive" : "negative",
          category: "revenue",
          value: `קצב צפוי: ${formatCurrencyFull(monthlyPaceRevenue)} | חודש קודם: ${formatCurrencyFull(prevTotal)}`,
        });
      }

      // ====================================================================
      // 2. REVENUE: Monthly pace projection
      // ====================================================================
      if (entries.length >= 3 && actualWorkDays > 0) {
        const dailyAvg = currentTotal / actualWorkDays;
        const monthlyPace = dailyAvg * daysInMonth;
        const revenueTarget = goal ? Number(goal.revenue_target) || 0 : 0;

        results.push({
          id: "monthly-pace",
          title: "קצב הכנסות חודשי צפוי",
          description: `לפי ממוצע יומי של ${formatCurrencyFull(dailyAvg)}, הקצב החודשי צפוי להגיע ל-${formatCurrencyFull(monthlyPace)}${revenueTarget > 0 ? `. היעד החודשי הוא ${formatCurrencyFull(revenueTarget)} — ${monthlyPace >= revenueTarget ? "את/ה בדרך לעמוד ביעד" : `חסרים ${formatCurrencyFull(revenueTarget - monthlyPace)}`}.` : "."}`,
          severity: revenueTarget > 0 ? (monthlyPace >= revenueTarget ? "positive" : "warning") : "info",
          category: "revenue",
          value: `קצב צפוי: ${formatCurrencyFull(monthlyPace)}${revenueTarget > 0 ? ` | יעד: ${formatCurrencyFull(revenueTarget)}` : ""}`,
        });

        // ==================================================================
        // 2a. OPERATIONAL: Purchase budget remaining (David #12)
        // "מותר לקנות עד סוף החודש מקסימום ₪X" — exactly the sentence he
        // gave in the review. Uses the goal's food_cost_target_pct (or
        // operating_cost_target_pct as fallback when there's no food goal)
        // applied to the projected monthly revenue, minus what's already
        // been spent on goods this month.
        // ==================================================================
        const foodTargetPct = goal ? Number(goal.food_cost_target_pct) || 0 : 0;
        if (foodTargetPct > 0 && monthlyPace > 0) {
          // Goal pct is stored as percentage (e.g. 30 = 30%). Convert to ratio.
          const ratio = foodTargetPct / 100;
          const allowedTotal = monthlyPace * ratio;
          const remaining = allowedTotal - totalGoods;
          const overBudget = remaining < 0;
          const fmtPace = formatCurrencyFull(monthlyPace);
          const fmtAllowed = formatCurrencyFull(allowedTotal);
          const fmtRemaining = formatCurrencyFull(Math.abs(remaining));
          const fmtSpent = formatCurrencyFull(totalGoods);
          results.push({
            id: "purchase-budget-remaining",
            title: overBudget
              ? "חרגת מתקציב הרכישות לחודש"
              : "תקציב רכישות פנוי עד סוף החודש",
            description: overBudget
              ? `לפי צפי הכנסות חודשי של ${fmtPace} ויעד עלות מזון של ${formatPercent(foodTargetPct)}, התקציב המקסימלי לרכישות החודש הוא ${fmtAllowed}. עד עכשיו נרכש ב-${fmtSpent} — חריגה של ${fmtRemaining}.`
              : `לפי צפי הכנסות חודשי של ${fmtPace} ויעד עלות מזון של ${formatPercent(foodTargetPct)}, מותר לקנות החודש עד ${fmtAllowed}. עד עכשיו נרכש ב-${fmtSpent}, אז נשאר תקציב של ${fmtRemaining} עד סוף החודש.`,
            severity: overBudget ? "negative" : "info",
            category: "expenses",
            value: overBudget
              ? `חריגה: ${fmtRemaining}`
              : `נשאר לרכוש: ${fmtRemaining}`,
          });
        }

        // ==================================================================
        // 2b. OPERATIONAL: Daily labor hours budget (David #12)
        // "יש תקציב 46 שעות עובדים ביום" — the second sentence from the
        // review. Translates the labor-cost-target into actual hours the
        // employer can buy at the current avg hourly wage, given today's
        // revenue target (= dailyAvg projected from current pace).
        // ==================================================================
        const laborTargetPct = goal ? Number(goal.labor_cost_target_pct) || 0 : 0;
        if (laborTargetPct > 0 && totalLaborHours > 0 && totalLabor > 0 && dailyAvg > 0) {
          const ratio = laborTargetPct / 100;
          // Avg hourly wage actually paid this month (incl. employee+manager
          // proportional). Use raw labor cost (without markup) so the hours
          // figure matches the manager's intuition of payroll spend.
          const avgHourlyWage = totalLabor / totalLaborHours;
          if (avgHourlyWage > 0) {
            const dailyTargetRevenue = dailyAvg; // best estimate of "what tomorrow needs to make"
            const dailyAllowedLabor = dailyTargetRevenue * ratio;
            const dailyAllowedHours = dailyAllowedLabor / avgHourlyWage;
            const fmtDaily = formatCurrencyFull(dailyTargetRevenue);
            const fmtWage = formatCurrencyFull(avgHourlyWage);
            results.push({
              id: "daily-labor-hours-budget",
              title: "תקציב שעות עובדים יומי",
              description: `לפי יעד יומי של ${fmtDaily} ויעד עלות עבודה ${formatPercent(laborTargetPct)}, יש תקציב של עד ${formatNumber(dailyAllowedHours)} שעות עובדים ביום (לפי שכר ממוצע ${fmtWage} לשעה).`,
              severity: "info",
              category: "labor",
              value: `${formatNumber(dailyAllowedHours)} שעות / יום`,
            });
          }
        }
      }

      // ====================================================================
      // 3. REVENUE: Best/worst days + gap
      // ====================================================================
      if (entries.length >= 3) {
        const sorted = [...entries].sort((a, b) => Number(b.total_register) - Number(a.total_register));
        const best = sorted[0];
        const worst = sorted[sorted.length - 1];
        const bestDate = new Date(best.entry_date);
        const worstDate = new Date(worst.entry_date);
        const gap = Number(best.total_register) - Number(worst.total_register);

        results.push({
          id: "best-worst-day",
          title: "פער בין היום החזק לחלש",
          description: `היום הכי חזק היה ${DAY_NAMES[bestDate.getDay()]} ${bestDate.toLocaleDateString("he-IL")} (${formatCurrencyFull(Number(best.total_register))}). היום הכי חלש היה ${DAY_NAMES[worstDate.getDay()]} ${worstDate.toLocaleDateString("he-IL")} (${formatCurrencyFull(Number(worst.total_register))}). הפער הוא ${formatCurrencyFull(gap)} — כלומר הפוטנציאל של כל יום חלש להתקרב ליום חזק הוא משמעותי.`,
          severity: "info",
          category: "revenue",
          value: `${formatCurrencyFull(Number(best.total_register))} (שיא) → ${formatCurrencyFull(Number(worst.total_register))} (שפל)`,
        });
      }

      // ====================================================================
      // 4. REVENUE: Day-of-week pattern analysis
      // ====================================================================
      if (entries.length >= 7) {
        // Weight every aggregate by `day_factor` so closed days (factor=0)
        // and half-days (factor=0.5) don't pull a day-of-week's average down.
        // Without this, פרגו (closed Saturday) shows ₪3,422 שבת average from
        // 0.5-factor entries — making Saturday look like a real workday with
        // half the revenue, which is misleading.
        const dayTotals: Record<number, { total: number; weight: number; labor: number; hours: number }> = {};
        for (const entry of entries) {
          const dow = new Date(entry.entry_date).getDay();
          const factor = Number(entry.day_factor) || 0;
          if (factor <= 0) continue;
          if (!dayTotals[dow]) dayTotals[dow] = { total: 0, weight: 0, labor: 0, hours: 0 };
          dayTotals[dow].total += Number(entry.total_register) || 0;
          dayTotals[dow].weight += factor;
          dayTotals[dow].labor += Number(entry.labor_cost) || 0;
          dayTotals[dow].hours += Number(entry.labor_hours) || 0;
        }

        const dayAvgs = Object.entries(dayTotals)
          .filter(([, data]) => data.weight > 0)
          .map(([day, data]) => ({
            day: Number(day),
            avg: data.total / data.weight,
            laborPct: data.total > 0 ? (data.labor / data.total * 100) : 0,
            avgHours: data.hours / data.weight,
          }))
          .sort((a, b) => b.avg - a.avg);

        if (dayAvgs.length >= 3) {
          const bestDay = dayAvgs[0];
          const worstDay = dayAvgs[dayAvgs.length - 1];
          const ratio = worstDay.avg > 0 ? bestDay.avg / worstDay.avg : 0;

          results.push({
            id: "day-pattern",
            title: `${DAY_NAMES[bestDay.day]} הוא היום החזק ביותר`,
            description: `ממוצע יומי ב${DAY_NAMES[bestDay.day]}: ${formatCurrencyFull(bestDay.avg)} לעומת ${formatCurrencyFull(worstDay.avg)} ב${DAY_NAMES[worstDay.day]} (פי ${ratio.toFixed(1)}). ${ratio > 1.5 ? "שווה לשקול פעילויות שיווקיות או אירועים בימים החלשים כדי למקסם הכנסות." : "הפיזור בין הימים סביר."}`,
            severity: ratio > 1.5 ? "warning" : "info",
            category: "operations",
            value: `${DAY_NAMES[bestDay.day]}: ${formatCurrencyFull(bestDay.avg)} | ${DAY_NAMES[worstDay.day]}: ${formatCurrencyFull(worstDay.avg)}`,
          });

          // Find the day with worst labor efficiency
          const worstLaborDay = dayAvgs.reduce((worst, d) => d.laborPct > worst.laborPct ? d : worst, dayAvgs[0]);
          const bestLaborDay = dayAvgs.reduce((best, d) => d.laborPct > 0 && d.laborPct < best.laborPct ? d : best, dayAvgs[0]);

          if (worstLaborDay.laborPct - bestLaborDay.laborPct > 5) {
            results.push({
              id: "labor-day-efficiency",
              title: `יום ${DAY_NAMES[worstLaborDay.day]} הכי יקר בעלות כ״א`,
              description: `ביום ${DAY_NAMES[worstLaborDay.day]} עלות כוח האדם מגיעה ל-${formatPercent(worstLaborDay.laborPct)} מההכנסות (ממוצע ${formatNumber(worstLaborDay.avgHours)} שעות), לעומת ${formatPercent(bestLaborDay.laborPct)} ביום ${DAY_NAMES[bestLaborDay.day]}. כדאי לבדוק אם אפשר לצמצם שעות ב${DAY_NAMES[worstLaborDay.day]} או להגדיל הכנסות.`,
              severity: "warning",
              category: "labor",
              value: `${DAY_NAMES[worstLaborDay.day]}: ${formatPercent(worstLaborDay.laborPct)} | ${DAY_NAMES[bestLaborDay.day]}: ${formatPercent(bestLaborDay.laborPct)}`,
            });
          }
        }
      }

      // ====================================================================
      // 5. REVENUE: Below average days alert
      // ====================================================================
      if (entries.length >= 5) {
        const avg = currentTotal / entries.length;
        const belowAvg = entries.filter((d) => Number(d.total_register) < avg);
        if (belowAvg.length > entries.length / 2) {
          results.push({
            id: "below-avg-days",
            title: "רוב הימים מתחת לממוצע",
            description: `${belowAvg.length} מתוך ${entries.length} ימים היו מתחת לממוצע היומי של ${formatCurrencyFull(avg)}. כמה ימים חזקים מושכים את הממוצע למעלה — שווה לבדוק מה מייחד אותם ולנסות לשכפל את ההצלחה.`,
            severity: "warning",
            category: "operations",
            value: `ממוצע יומי: ${formatCurrencyFull(avg)} | ${belowAvg.length}/${entries.length} ימים מתחתיו`,
          });
        }
      }

      // ====================================================================
      // 6. LABOR: Cost analysis vs target
      // ====================================================================
      if (incomeBeforeVat > 0 && laborCostWithManager > 0) {
        const laborPct = (laborCostWithManager / incomeBeforeVat) * 100;
        const laborTarget = goal ? Number(goal.labor_cost_target_pct) || 0 : 0;

        if (laborTarget > 0) {
          const diff = laborPct - laborTarget;
          const diffAmount = (diff / 100) * incomeBeforeVat;
          results.push({
            id: "labor-vs-target",
            title: diff > 0 ? "חריגה ביעד עלות כוח אדם" : "עלות כוח אדם מתחת ליעד",
            description: diff > 0
              ? `עלות כ״א עומדת על ${formatPercent(laborPct)} מהפדיון לפני מע״מ — חריגה של ${formatPercent(Math.abs(diff))} מהיעד (${formatPercent(laborTarget)}). המשמעות: ${formatCurrencyFull(Math.abs(diffAmount))} עודף בהוצאות עובדים החודש.`
              : `עלות כ״א עומדת על ${formatPercent(laborPct)} — מתחת ליעד של ${formatPercent(laborTarget)} ב-${formatPercent(Math.abs(diff))}. חיסכון של ${formatCurrencyFull(Math.abs(diffAmount))} בהוצאות עובדים.`,
            severity: diff > 3 ? "negative" : diff > 0 ? "warning" : "positive",
            category: "labor",
            value: `בפועל: ${formatPercent(laborPct)} (${formatCurrencyFull(laborCostWithManager)}) | יעד: ${formatPercent(laborTarget)}`,
          });
        } else {
          results.push({
            id: "labor-pct",
            title: `עלות כוח אדם: ${formatPercent(laborPct)}`,
            description: laborPct > 30
              ? `עלות כ״א היא ${formatPercent(laborPct)} מהפדיון — מעל הסף המומלץ של 30%. מומלץ לבדוק שעות עבודה בימים חלשים ולשקול אופטימיזציה.`
              : laborPct < 20
              ? `עלות כ״א היא רק ${formatPercent(laborPct)} מהפדיון — מתחת לממוצע בענף (20%-30%). יעילות מצוינת, אבל כדאי לוודא שזה לא על חשבון איכות השירות.`
              : `עלות כ״א היא ${formatPercent(laborPct)} מהפדיון — בטווח הנורמלי של 20%-30%.`,
            severity: laborPct > 30 ? "negative" : laborPct < 20 ? "positive" : "info",
            category: "labor",
            value: `${formatCurrencyFull(laborCostWithManager)} (${formatPercent(laborPct)} מפדיון)`,
          });
        }
      }

      // ====================================================================
      // 7. LABOR: Hours efficiency
      // ====================================================================
      if (totalLaborHours > 0 && currentTotal > 0) {
        const revenuePerHour = currentTotal / totalLaborHours;
        const costPerHour = totalLabor / totalLaborHours;
        const avgHoursPerDay = totalLaborHours / entries.length;

        results.push({
          id: "labor-hours-efficiency",
          title: `${formatCurrencyFull(revenuePerHour)} הכנסה לשעת עבודה`,
          description: `ממוצע ${formatNumber(avgHoursPerDay)} שעות עבודה ליום, עם הכנסה של ${formatCurrencyFull(revenuePerHour)} לכל שעת עבודה. עלות שעת עבודה ממוצעת: ${formatCurrencyFull(costPerHour)}. כלומר כל שעת עבודה מניבה פי ${(revenuePerHour / costPerHour).toFixed(1)} מעלותה.`,
          severity: revenuePerHour > costPerHour * 3 ? "positive" : revenuePerHour > costPerHour * 2 ? "info" : "warning",
          category: "labor",
          value: `${formatNumber(totalLaborHours)} שעות | ${formatCurrencyFull(revenuePerHour)}/שעה | עלות: ${formatCurrencyFull(costPerHour)}/שעה`,
        });
      }

      // ====================================================================
      // 8. FOOD COST: vs target
      // ====================================================================
      if (incomeBeforeVat > 0 && totalGoods > 0) {
        const foodPct = (totalGoods / incomeBeforeVat) * 100;
        const foodTarget = goal ? Number(goal.food_cost_target_pct) || 0 : 0;

        if (foodTarget > 0) {
          const diff = foodPct - foodTarget;
          const diffAmount = (diff / 100) * incomeBeforeVat;
          results.push({
            id: "food-cost-target",
            title: diff > 0 ? "חריגה ביעד עלות סחורה" : "עלות סחורה מתחת ליעד",
            description: diff > 0
              ? `עלות הסחורה (קניות) עומדת על ${formatPercent(foodPct)} — חריגה של ${formatPercent(Math.abs(diff))} מיעד ${formatPercent(foodTarget)}. זה אומר ${formatCurrencyFull(Math.abs(diffAmount))} עודף בקניות. כדאי לבדוק מחירי ספקים, פחת, וגודל מנות.`
              : `עלות הסחורה היא ${formatPercent(foodPct)} — מתחת ליעד של ${formatPercent(foodTarget)}. חיסכון של ${formatCurrencyFull(Math.abs(diffAmount))}.`,
            severity: diff > 3 ? "negative" : diff > 0 ? "warning" : "positive",
            category: "expenses",
            value: `בפועל: ${formatPercent(foodPct)} (${formatCurrencyFull(totalGoods)}) | יעד: ${formatPercent(foodTarget)}`,
          });
        }

        // Food cost change vs prev month — projected to month-end
        if (prevGoods > 0 && haveEnoughData) {
          const foodChange = ((projectedGoods - prevGoods) / prevGoods) * 100;
          if (Math.abs(foodChange) > 10) {
            results.push({
              id: "food-cost-trend",
              title: foodChange > 0 ? "צפי עלייה בעלויות סחורה" : "צפי ירידה בעלויות סחורה",
              description: foodChange > 0
                ? `לפי הקצב הנוכחי, עלויות הסחורה לסוף החודש צפויות להגיע ל-${formatCurrencyFull(projectedGoods)} — עלייה של ${formatPercent(Math.abs(foodChange))} לעומת ${formatCurrencyFull(prevGoods)} בחודש שעבר. כדאי לבדוק: עליית מחירי ספקים? הזמנות גדולות יותר? פחת שעלה?`
                : `לפי הקצב הנוכחי, עלויות הסחורה לסוף החודש צפויות להיות ${formatCurrencyFull(projectedGoods)} — ירידה של ${formatPercent(Math.abs(foodChange))} לעומת ${formatCurrencyFull(prevGoods)} בחודש שעבר.`,
              severity: foodChange > 15 ? "negative" : foodChange > 0 ? "warning" : "positive",
              category: "suppliers",
              value: `קצב צפוי: ${formatCurrencyFull(projectedGoods)} | חודש קודם: ${formatCurrencyFull(prevGoods)}`,
            });
          }
        }
      }

      // ====================================================================
      // 9. EXPENSES: Current expenses analysis — projected to full month
      // current_expenses_target is a full-month target, so compare it to
      // the projected month-end actuals (otherwise day-7 numbers always
      // look "way under target").
      // ====================================================================
      if (incomeBeforeVat > 0 && totalCurrentExp > 0) {
        const expPct = monthlyPaceIncomeBeforeVat > 0
          ? (projectedCurrentExp / monthlyPaceIncomeBeforeVat) * 100
          : (totalCurrentExp / incomeBeforeVat) * 100;
        const expTarget = goal ? Number(goal.current_expenses_target) || 0 : 0;

        if (expTarget > 0 && haveEnoughData) {
          const diff = projectedCurrentExp - expTarget;
          results.push({
            id: "current-exp-target",
            title: diff > 0 ? "צפי חריגה ביעד הוצאות שוטפות" : "הוצאות שוטפות צפויות מתחת ליעד",
            description: diff > 0
              ? `לפי הקצב הנוכחי, ההוצאות השוטפות לסוף החודש צפויות להגיע ל-${formatCurrencyFull(projectedCurrentExp)} (כרגע ${formatCurrencyFull(totalCurrentExp)} ב-${entries.length} ימים) — חריגה של ${formatCurrencyFull(Math.abs(diff))} מיעד ${formatCurrencyFull(expTarget)}.`
              : `לפי הקצב הנוכחי, ההוצאות השוטפות לסוף החודש צפויות להיות ${formatCurrencyFull(projectedCurrentExp)} (כרגע ${formatCurrencyFull(totalCurrentExp)} ב-${entries.length} ימים) — ${formatCurrencyFull(Math.abs(diff))} מתחת ליעד ${formatCurrencyFull(expTarget)}.`,
            severity: diff > 0 ? "negative" : "positive",
            category: "expenses",
            value: `קצב צפוי: ${formatCurrencyFull(projectedCurrentExp)} (${formatPercent(expPct)} מקצב פדיון) | יעד: ${formatCurrencyFull(expTarget)}`,
          });
        }

        // Current expenses change vs prev month — projected to month-end
        if (prevCurrentExp > 0 && haveEnoughData) {
          const expChange = ((projectedCurrentExp - prevCurrentExp) / prevCurrentExp) * 100;
          if (Math.abs(expChange) > 10) {
            results.push({
              id: "current-exp-trend",
              title: expChange > 0 ? "צפי עלייה בהוצאות שוטפות" : "צפי ירידה בהוצאות שוטפות",
              description: expChange > 0
                ? `לפי הקצב הנוכחי, ההוצאות השוטפות לסוף החודש צפויות לעלות ב-${formatPercent(Math.abs(expChange))} לעומת חודש קודם (${formatCurrencyFull(projectedCurrentExp)} מול ${formatCurrencyFull(prevCurrentExp)}). כדאי לבדוק אילו ספקים גדלו.`
                : `לפי הקצב הנוכחי, ההוצאות השוטפות לסוף החודש צפויות לרדת ב-${formatPercent(Math.abs(expChange))} לעומת חודש קודם. חיסכון של ${formatCurrencyFull(Math.abs(projectedCurrentExp - prevCurrentExp))}.`,
              severity: expChange > 0 ? "warning" : "positive",
              category: "expenses",
            });
          }
        }
      }

      // ====================================================================
      // 10. PROFIT: Operating profit — projected to month-end
      // Was comparing partial actuals (₪40k income from 7 days) against a
      // mix of partial+full expenses and screaming "27.6% loss". Now we
      // project everything to a full-month basis so day-of-month doesn't
      // distort the picture.
      // ====================================================================
      if (haveEnoughData && monthlyPaceIncomeBeforeVat > 0) {
        const projectedExpenses = projectedLaborWithManager + projectedGoods + projectedCurrentExp;
        const projectedProfit = monthlyPaceIncomeBeforeVat - projectedExpenses;
        const profitPct = (projectedProfit / monthlyPaceIncomeBeforeVat) * 100;

        results.push({
          id: "operating-profit",
          title: projectedProfit >= 0
            ? `רווח תפעולי צפוי: ${formatPercent(profitPct)}`
            : `הפסד תפעולי צפוי: ${formatPercent(Math.abs(profitPct))}`,
          description: projectedProfit >= 0
            ? `לפי הקצב הנוכחי (${formatCurrencyFull(monthlyPaceIncomeBeforeVat)} פדיון לפני מע״מ לסוף החודש), הוצאות צפויות: כ״א ${formatCurrencyFull(projectedLaborWithManager)}, סחורה ${formatCurrencyFull(projectedGoods)}, שוטפות ${formatCurrencyFull(projectedCurrentExp)}. רווח צפוי: ${formatCurrencyFull(projectedProfit)}.`
            : `לפי הקצב הנוכחי (${formatCurrencyFull(monthlyPaceIncomeBeforeVat)} פדיון לפני מע״מ צפוי), סך ההוצאות הצפויות (${formatCurrencyFull(projectedExpenses)}) יעלה על הפדיון. הפסד צפוי של ${formatCurrencyFull(Math.abs(projectedProfit))}. כדאי לבדוק דחוף.`,
          severity: profitPct > 10 ? "positive" : profitPct > 0 ? "info" : "negative",
          category: "revenue",
          value: `קצב פדיון: ${formatCurrencyFull(monthlyPaceIncomeBeforeVat)} | קצב הוצאות: ${formatCurrencyFull(projectedExpenses)} | רווח: ${formatCurrencyFull(projectedProfit)}`,
        });
      }

      // ====================================================================
      // 11. SUPPLIERS: Top supplier concentration
      // ====================================================================
      if (invoices.length > 0) {
        const supplierTotals: Record<string, { name: string; total: number; type: string }> = {};
        for (const inv of invoices) {
          const sid = inv.supplier_id;
          const supplier = inv.suppliers as unknown as { name: string; expense_type: string };
          if (!supplierTotals[sid]) supplierTotals[sid] = { name: supplier.name, total: 0, type: supplier.expense_type };
          supplierTotals[sid].total += Number(inv.subtotal) || 0;
        }

        const sorted = Object.values(supplierTotals).sort((a, b) => b.total - a.total);
        const totalSpending = sorted.reduce((s, v) => s + v.total, 0);

        if (sorted.length >= 2) {
          const top3 = sorted.slice(0, 3);
          const top3Total = top3.reduce((s, v) => s + v.total, 0);
          const top3Pct = (top3Total / totalSpending) * 100;

          results.push({
            id: "top-suppliers",
            title: `3 ספקים מובילים = ${formatPercent(top3Pct)} מההוצאות`,
            description: `הספקים הגדולים ביותר: ${top3.map((s) => `${s.name} (${formatCurrencyFull(s.total)})`).join(", ")}. ${top3Pct > 60 ? "ריכוז גבוה בספקים בודדים מגביר סיכון ויכולת מיקוח — שווה לבדוק חלופות." : "הפיזור בין הספקים סביר."}`,
            severity: top3Pct > 70 ? "warning" : "info",
            category: "suppliers",
            value: `סה״כ הוצאות ספקים: ${formatCurrencyFull(totalSpending)}`,
          });
        }
      }

      // ====================================================================
      // 12. FIXED EXPENSES: Review — compared to monthly pace
      // The denominator MUST be the projected monthly revenue (full-month
      // figure) because monthly_expense_amount is itself a full-month
      // budget. Comparing it to partial-month revenue made it look like
      // fixed expenses were 79% of income on day 7 — they're really ~13%.
      // ====================================================================
      if (fixedSuppliers && fixedSuppliers.length > 0) {
        const totalFixed = fixedSuppliers.reduce((s, sup) => s + (Number(sup.monthly_expense_amount) || 0), 0);
        const denomIncomeBeforeVat = monthlyPaceIncomeBeforeVat > 0 ? monthlyPaceIncomeBeforeVat : incomeBeforeVat;
        if (totalFixed > 0 && denomIncomeBeforeVat > 0) {
          const fixedPct = (totalFixed / denomIncomeBeforeVat) * 100;
          const topFixed = [...fixedSuppliers].sort((a, b) => (Number(b.monthly_expense_amount) || 0) - (Number(a.monthly_expense_amount) || 0)).slice(0, 3);

          results.push({
            id: "fixed-expenses",
            title: `${fixedSuppliers.length} הוצאות קבועות — ${formatCurrencyFull(totalFixed)}/חודש`,
            description: `הוצאות קבועות מהוות ${formatPercent(fixedPct)} מהקצב החודשי הצפוי (${formatCurrencyFull(denomIncomeBeforeVat)} לפני מע״מ). הגדולות: ${topFixed.map((s) => `${s.name} (${formatCurrencyFull(Number(s.monthly_expense_amount) || 0)})`).join(", ")}. ${fixedPct > 20 ? "מומלץ לעבור על הרשימה ולבדוק אם כולן הכרחיות." : "הרמה סבירה."}`,
            severity: fixedPct > 25 ? "warning" : "info",
            category: "expenses",
            value: `${formatCurrencyFull(totalFixed)} / חודש (${formatPercent(fixedPct)} מקצב פדיון)`,
          });
        }
      }

      // ====================================================================
      // 13. INCOME SOURCES: Ticket average analysis
      // ====================================================================
      if (incomeData.length > 0 && (incomeSources || []).length > 0) {
        const sourceMap = new Map((incomeSources || []).map((s) => [s.id, s]));
        const goalMap = new Map((incomeSourceGoals || []).map((g) => [g.income_source_id, g]));

        const sourceAgg: Record<string, { name: string; total: number; orders: number }> = {};
        for (const ib of incomeData) {
          const source = sourceMap.get(ib.income_source_id);
          if (!source) continue;
          if (!sourceAgg[ib.income_source_id]) sourceAgg[ib.income_source_id] = { name: source.name, total: 0, orders: 0 };
          sourceAgg[ib.income_source_id].total += Number(ib.amount) || 0;
          sourceAgg[ib.income_source_id].orders += Number(ib.orders_count) || 0;
        }

        for (const [sourceId, agg] of Object.entries(sourceAgg)) {
          if (agg.orders === 0) continue;
          const avgTicket = agg.total / agg.orders;
          const goalData = goalMap.get(sourceId);
          const ticketTarget = goalData ? Number(goalData.avg_ticket_target) || 0 : 0;

          if (ticketTarget > 0) {
            const diff = avgTicket - ticketTarget;
            const totalImpact = diff * agg.orders;
            results.push({
              id: `ticket-${sourceId}`,
              title: diff >= 0 ? `תיק ממוצע "${agg.name}" מעל היעד` : `תיק ממוצע "${agg.name}" מתחת ליעד`,
              description: diff >= 0
                ? `התיק הממוצע ב"${agg.name}" הוא ${formatCurrencyFull(avgTicket)} — מעל יעד ${formatCurrencyFull(ticketTarget)} ב-${formatCurrencyFull(Math.abs(diff))}. ב-${formatNumber(agg.orders)} הזמנות, זה הוסיף ${formatCurrencyFull(Math.abs(totalImpact))} להכנסות.`
                : `התיק הממוצע ב"${agg.name}" הוא ${formatCurrencyFull(avgTicket)} — מתחת ליעד ${formatCurrencyFull(ticketTarget)} ב-${formatCurrencyFull(Math.abs(diff))}. ב-${formatNumber(agg.orders)} הזמנות, הפער עלה ${formatCurrencyFull(Math.abs(totalImpact))}. כדאי לבדוק אם ניתן לשפר ע״י מכירה נלווית (upsell).`,
              severity: diff >= 0 ? "positive" : "warning",
              category: "revenue",
              value: `ממוצע: ${formatCurrencyFull(avgTicket)} | יעד: ${formatCurrencyFull(ticketTarget)} | ${formatNumber(agg.orders)} הזמנות`,
            });
          } else if (agg.orders > 10) {
            // No target but has data — show insight anyway
            results.push({
              id: `ticket-info-${sourceId}`,
              title: `תיק ממוצע "${agg.name}": ${formatCurrencyFull(avgTicket)}`,
              description: `${formatNumber(agg.orders)} הזמנות ב"${agg.name}" עם תיק ממוצע של ${formatCurrencyFull(avgTicket)}. סה״כ ${formatCurrencyFull(agg.total)} (${formatPercent((agg.total / currentTotal) * 100)} מההכנסות).`,
              severity: "info",
              category: "revenue",
            });
          }
        }
      }

      // ====================================================================
      // 14. RECEIPTS: Payment method breakdown
      // ====================================================================
      if (bizReceipts.length > 0) {
        const receiptTotals: Record<string, number> = {};
        for (const r of bizReceipts) {
          const name = (r.receipt_types as unknown as { name: string }).name;
          receiptTotals[name] = (receiptTotals[name] || 0) + (Number(r.amount) || 0);
        }

        const totalReceipts = Object.values(receiptTotals).reduce((s, v) => s + v, 0);
        if (totalReceipts > 0) {
          const sorted = Object.entries(receiptTotals).sort((a, b) => b[1] - a[1]);
          const cashEntry = sorted.find(([name]) => name.includes("מזומן"));
          if (cashEntry) {
            const cashPct = (cashEntry[1] / totalReceipts) * 100;
            if (cashPct > 30) {
              results.push({
                id: "cash-ratio",
                title: `${formatPercent(cashPct)} מהתקבולים במזומן`,
                description: `אחוז המזומן גבוה (${formatCurrencyFull(cashEntry[1])} מתוך ${formatCurrencyFull(totalReceipts)}). ${cashPct > 50 ? "כדאי לשקול תמריצים לתשלום באשראי כדי לשפר תזרים ומעקב." : ""}`,
                severity: cashPct > 50 ? "warning" : "info",
                category: "cashflow",
                value: sorted.map(([name, total]) => `${name}: ${formatCurrencyFull(total)} (${formatPercent((total / totalReceipts) * 100)})`).join(" | "),
              });
            }
          }
        }
      }

      // ====================================================================
      // 15. PRODUCTS: Managed product cost tracking
      // ====================================================================
      if (bizProducts.length > 0 && (managedProducts || []).length > 0 && incomeBeforeVat > 0) {
        const prodMap = new Map((managedProducts || []).map((p) => [p.id, p]));

        const prodAgg: Record<string, { name: string; totalCost: number; totalQty: number; unit: string; targetPct: number }> = {};
        for (const pu of bizProducts) {
          const prod = prodMap.get(pu.product_id);
          if (!prod) continue;
          if (!prodAgg[pu.product_id]) prodAgg[pu.product_id] = { name: prod.name, totalCost: 0, totalQty: 0, unit: prod.unit || "", targetPct: Number(prod.target_pct) || 0 };
          const qty = Number(pu.quantity) || 0;
          const cost = Number(pu.unit_cost_at_time) || Number(prod.unit_cost) || 0;
          prodAgg[pu.product_id].totalCost += qty * cost;
          prodAgg[pu.product_id].totalQty += qty;
        }

        for (const agg of Object.values(prodAgg)) {
          if (agg.totalCost === 0) continue;
          const pct = (agg.totalCost / incomeBeforeVat) * 100;

          if (agg.targetPct > 0) {
            const diff = pct - agg.targetPct;
            results.push({
              id: `product-${agg.name}`,
              title: diff > 0 ? `"${agg.name}" חורג מהיעד` : `"${agg.name}" מתחת ליעד`,
              description: diff > 0
                ? `עלות "${agg.name}" (${formatNumber(agg.totalQty)} ${agg.unit}) מגיעה ל-${formatPercent(pct)} מהפדיון — מעל יעד ${formatPercent(agg.targetPct)} ב-${formatPercent(Math.abs(diff))}. חריגה של ${formatCurrencyFull((Math.abs(diff) / 100) * incomeBeforeVat)}.`
                : `עלות "${agg.name}" היא ${formatPercent(pct)} — מתחת ליעד ${formatPercent(agg.targetPct)}.`,
              severity: diff > 1 ? "warning" : diff > 0 ? "info" : "positive",
              category: "expenses",
              value: `${formatCurrencyFull(agg.totalCost)} (${formatNumber(agg.totalQty)} ${agg.unit}) | ${formatPercent(pct)} מפדיון`,
            });
          }
        }
      }

      // ====================================================================
      // 16. CASHFLOW: Overdue payments — DISABLED
      // payment_splits represents the installment schedule of an *executed*
      // payment record (every split has a payment_id, and the payment itself
      // is "actually paid"). Filtering by `due_date <= today` therefore
      // catches every historical paid installment and produced absurd
      // numbers like "785 overdue payments / ₪1,209,293" for a small business.
      // We need a real "scheduled but not paid" status before reviving this.
      // ====================================================================

      // ====================================================================
      // 17. CASHFLOW: Upcoming 7 days
      // ====================================================================
      const next7 = new Date(now);
      next7.setDate(next7.getDate() + 7);
      const next7Str = next7.toISOString().split("T")[0];
      const upcomingPayments = bizPaymentSplits.filter((ps) => ps.due_date > today && ps.due_date <= next7Str);

      if (upcomingPayments.length > 0) {
        const totalUpcoming = upcomingPayments.reduce((s, ps) => s + (Number(ps.amount) || 0), 0);
        results.push({
          id: "upcoming-payments",
          title: `${upcomingPayments.length} תשלומים ב-7 ימים הקרובים`,
          description: `צפויים ${upcomingPayments.length} תשלומים בסך ${formatCurrencyFull(totalUpcoming)} בשבוע הקרוב. יש לוודא תזרים מספיק.`,
          severity: totalUpcoming > 10000 ? "warning" : "info",
          category: "cashflow",
          value: formatCurrencyFull(totalUpcoming),
        });
      }

      // ====================================================================
      // 18. CASHFLOW: Total future commitments (payment splits + prior commitments)
      // ====================================================================
      const futurePayments = bizPaymentSplits.filter((ps) => ps.due_date > today);
      const futurePriorCommitments = (priorCommitmentsData || []).filter(
        (c: Record<string, unknown>) => String(c.end_date || "") > today
      );
      const priorCommitmentsTotal = futurePriorCommitments.reduce(
        (sum: number, c: Record<string, unknown>) => {
          const monthlyAmount = Number(c.monthly_amount) || 0;
          const totalInstallments = Number(c.total_installments) || 0;
          const startDate = new Date(String(c.start_date || ""));
          const monthsElapsed = Math.max(0, (now.getFullYear() - startDate.getFullYear()) * 12 + (now.getMonth() - startDate.getMonth()));
          const remaining = Math.max(0, totalInstallments - monthsElapsed);
          return sum + (monthlyAmount * remaining);
        }, 0
      );
      const futurePaymentsTotal = futurePayments.reduce((s, ps) => s + (Number(ps.amount) || 0), 0);
      const totalFuture = futurePaymentsTotal + priorCommitmentsTotal;

      if (totalFuture > 0) {
        const parts: string[] = [];
        if (futurePayments.length > 0) parts.push(`${futurePayments.length} תשלומים עתידיים`);
        if (futurePriorCommitments.length > 0) parts.push(`${futurePriorCommitments.length} התחייבויות קודמות`);

        results.push({
          id: "future-commitments",
          title: `${formatCurrencyFull(totalFuture)} התחייבויות עתידיות`,
          description: `${parts.join(" + ")}. חשוב לוודא תזרים מספיק בחודשים הבאים.`,
          severity: totalFuture > incomeBeforeVat ? "warning" : "info",
          category: "cashflow",
          value: parts.join(" | "),
        });
      }

      // ====================================================================
      // 19. GOALS: Revenue target progress
      // ====================================================================
      if (goal && currentTotal > 0) {
        const revenueTarget = Number(goal.revenue_target) || 0;
        if (revenueTarget > 0) {
          const progressPct = (currentTotal / revenueTarget) * 100;
          const expectedPct = (dayOfMonth / daysInMonth) * 100;
          const gapPct = progressPct - expectedPct;
          const dailyNeeded = (revenueTarget - currentTotal) / (daysInMonth - dayOfMonth);

          results.push({
            id: "goal-progress",
            title: gapPct >= 0 ? "מקדימים את יעד ההכנסות" : "פיגור ביעד ההכנסות",
            description: gapPct >= 0
              ? `הגעת ל-${formatPercent(progressPct)} מהיעד (צריך ${formatPercent(expectedPct)} לפי הקצב). ב-${daysInMonth - dayOfMonth} הימים שנותרו צריך ממוצע של ${formatCurrencyFull(dailyNeeded)} ליום כדי לעמוד ביעד — קצב נמוך מהממוצע הנוכחי, מה שאומר שאתם בדרך הנכונה.`
              : `הגעת ל-${formatPercent(progressPct)} מהיעד (${formatPercent(expectedPct)} צפוי). חסרים ${formatCurrencyFull(revenueTarget - currentTotal)} ב-${daysInMonth - dayOfMonth} ימים — צריך ממוצע של ${formatCurrencyFull(dailyNeeded)} ליום, ${dailyNeeded > currentTotal / entries.length ? "מעל הממוצע הנוכחי" : "קרוב לממוצע הנוכחי"}.`,
            severity: gapPct >= 5 ? "positive" : gapPct >= -5 ? "info" : "negative",
            category: "goals",
            value: `${formatCurrencyFull(currentTotal)} / ${formatCurrencyFull(revenueTarget)} (${formatPercent(progressPct)})`,
          });
        }
      }

      // ====================================================================
      // 20. OPERATIONS: Discounts analysis
      // ====================================================================
      if (totalDiscounts > 0 && currentTotal > 0) {
        const discountPct = (totalDiscounts / currentTotal) * 100;
        const avgDailyDiscount = totalDiscounts / entries.length;
        results.push({
          id: "discounts",
          title: discountPct > 3 ? "אחוז הנחות גבוה" : `סה״כ הנחות: ${formatPercent(discountPct)}`,
          description: `סך ההנחות הגיע ל-${formatCurrencyFull(totalDiscounts)} (${formatPercent(discountPct)} מההכנסות), ממוצע ${formatCurrencyFull(avgDailyDiscount)} ליום. ${discountPct > 3 ? "שווה לבדוק: מנות לדוגמה? ביטולים? הנחות ללקוחות שאפשר לצמצם?" : "הרמה סבירה."}`,
          severity: discountPct > 5 ? "negative" : discountPct > 3 ? "warning" : "info",
          category: "operations",
          value: `${formatCurrencyFull(totalDiscounts)} (${formatPercent(discountPct)} מהכנסות)`,
        });
      }

      // ====================================================================
      // 21. OPERATIONS: Waste analysis
      // ====================================================================
      if (totalWaste > 0 && currentTotal > 0) {
        const wastePct = (totalWaste / currentTotal) * 100;
        results.push({
          id: "waste",
          title: wastePct > 3 ? "אחוז פחת גבוה" : "פחת בגבולות הסביר",
          description: wastePct > 3
            ? `הפחת עומד על ${formatPercent(wastePct)} מההכנסות (${formatCurrencyFull(totalWaste)}). מעל 3% נחשב גבוה. מומלץ לבדוק: אחסון לקוי? הכנה מוקדמת מדי? גודל מנות?`
            : `הפחת עומד על ${formatPercent(wastePct)} (${formatCurrencyFull(totalWaste)}). בטווח הסביר.`,
          severity: wastePct > 3 ? "negative" : "info",
          category: "operations",
          value: `${formatCurrencyFull(totalWaste)} (${formatPercent(wastePct)})`,
        });
      }

      // ====================================================================
      // 22. OPERATIONS: Data completeness — David #13
      // Only count "expected" days where the business is actually OPEN:
      // skip days closed in business_schedule (factor=0), skip exception
      // closures (holidays), and skip TODAY (the user may not have entered
      // it yet — flagging it before evening creates a false alarm).
      // Previously this counted dayOfMonth raw, so a 5-day-a-week business
      // looked "3 days behind" every Sunday morning.
      // ====================================================================
      const scheduleByBiz = new Map<string, Map<number, number>>();
      for (const row of (businessSchedules || []) as Array<{ business_id: string; day_of_week: number; day_factor: number }>) {
        if (!scheduleByBiz.has(row.business_id)) scheduleByBiz.set(row.business_id, new Map());
        scheduleByBiz.get(row.business_id)!.set(row.day_of_week, Number(row.day_factor) || 0);
      }
      const exceptionByBizDate = new Map<string, number>();
      for (const ex of (dayExceptions || []) as Array<{ business_id: string; exception_date: string; day_factor: number }>) {
        const dateStr = String(ex.exception_date).substring(0, 10);
        exceptionByBizDate.set(`${ex.business_id}|${dateStr}`, Number(ex.day_factor) ?? 0);
      }

      // Sum expected open-days across all selected businesses up to (but not
      // including) today. We compare against the count of daily_entries
      // already in the same window.
      let expectedOpenDays = 0;
      const todayStr = new Date().toISOString().slice(0, 10);
      for (const bizId of businessIds) {
        const sched = scheduleByBiz.get(bizId);
        if (!sched || sched.size === 0) {
          // No schedule configured — fall back to "all weekdays count" but
          // still skip today and weekends so we don't generate noise.
          for (let d = 1; d < dayOfMonth; d++) {
            const dateStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const dow = new Date(dateStr + "T00:00:00").getDay();
            if (dow >= 1 && dow <= 5) expectedOpenDays += 1;
          }
          continue;
        }
        for (let d = 1; d < dayOfMonth; d++) {
          const dateStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          if (dateStr >= todayStr) continue;
          const exceptionFactor = exceptionByBizDate.get(`${bizId}|${dateStr}`);
          if (exceptionFactor !== undefined) {
            if (exceptionFactor > 0) expectedOpenDays += 1;
          } else {
            const dow = new Date(dateStr + "T00:00:00").getDay();
            const factor = sched.get(dow) ?? 0;
            if (factor > 0) expectedOpenDays += 1;
          }
        }
      }

      const missingDays = Math.max(0, expectedOpenDays - entries.length);
      if (missingDays > 2) {
        results.push({
          id: "missing-entries",
          title: `${missingDays} ימים חסרים במילוי יומי`,
          description: `מתוך ${expectedOpenDays} ימי עבודה שעברו החודש (לפי לוח השבועי וחריגי החגים), רק ${entries.length} ימים מולאו. חסרים ${missingDays} ימים. נתונים חסרים פוגעים בדיוק התובנות ובמעקב. מומלץ להשלים בהקדם.`,
          severity: missingDays > 5 ? "negative" : "warning",
          category: "operations",
          value: `${entries.length} / ${expectedOpenDays} ימים מולאו`,
        });
      }

      // ====================================================================
      // 23. NET CASHFLOW: Income vs expenses — projected to month-end
      // Same reasoning as operating-profit: comparing partial-month income
      // to partial-month expenses can give misleading results when
      // expenses include fixed-cycle invoices that hit early in the month
      // (rent on the 1st, etc). Project both sides to month-end.
      // ====================================================================
      if (haveEnoughData && monthlyPaceIncomeBeforeVat > 0 && (projectedGoods + projectedCurrentExp) > 0) {
        const projectedExpenses = projectedGoods + projectedCurrentExp;
        const netCashflow = monthlyPaceIncomeBeforeVat - projectedExpenses;
        results.push({
          id: "net-cashflow",
          title: netCashflow >= 0 ? "תזרים חודשי צפוי חיובי" : "תזרים חודשי צפוי שלילי",
          description: `לפי הקצב הנוכחי לסוף החודש: הכנסות לפני מע״מ ${formatCurrencyFull(monthlyPaceIncomeBeforeVat)}, סחורה ${formatCurrencyFull(projectedGoods)}, הוצאות שוטפות ${formatCurrencyFull(projectedCurrentExp)}. ${netCashflow >= 0 ? `צפוי עודף של ${formatCurrencyFull(netCashflow)}.` : `צפוי חוסר של ${formatCurrencyFull(Math.abs(netCashflow))}.`}`,
          severity: netCashflow >= 0 ? "positive" : "negative",
          category: "cashflow",
          value: `נטו צפוי: ${formatCurrencyFull(netCashflow)}`,
        });
      }

      // Sort: negative first, then warning, then positive, then info
      const severityOrder: Record<InsightSeverity, number> = { negative: 0, warning: 1, positive: 2, info: 3 };
      results.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

      setInsights(results);
    } catch (err) {
      console.error("Error fetching insights:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedBusinesses]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  // Realtime — recompute insights when any underlying financial data changes
  // in the selected businesses. Handles live edits across tabs/users.
  useMultiTableRealtime(
    [
      "daily_entries", "invoices", "payments", "payment_splits",
      "goals", "suppliers", "daily_income_breakdown", "income_sources",
      "income_source_goals", "daily_receipts", "daily_product_usage",
      "managed_products", "prior_commitments",
    ],
    fetchInsights,
    selectedBusinesses.length > 0,
  );

  const filteredInsights = activeFilter === "all" ? insights : insights.filter((i) => i.category === activeFilter);

  const severityCounts = insights.reduce(
    (acc, i) => {
      acc[i.severity] = (acc[i.severity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  if (!selectedBusinesses || selectedBusinesses.length === 0) {
    return (
      <div className="px-[7px] pb-8 lg:px-3 xl:px-4">
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" className="text-white/20">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <p className="text-white/40 text-[16px]">יש לבחור עסק כדי לראות תובנות</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-[7px] pb-8 lg:px-3 xl:px-4">
      {/* Summary badges */}
      {!loading && insights.length > 0 && (
        <div className="flex flex-wrap gap-[8px] mb-[16px]">
          {severityCounts.negative && (
            <div className="flex items-center gap-[6px] bg-red-500/10 border border-red-500/20 rounded-full px-[12px] py-[4px]">
              <div className="w-[8px] h-[8px] rounded-full bg-red-500" />
              <span className="text-red-400 text-[12px] font-medium">{severityCounts.negative} דורשים תשומת לב</span>
            </div>
          )}
          {severityCounts.warning && (
            <div className="flex items-center gap-[6px] bg-amber-500/10 border border-amber-500/20 rounded-full px-[12px] py-[4px]">
              <div className="w-[8px] h-[8px] rounded-full bg-amber-500" />
              <span className="text-amber-400 text-[12px] font-medium">{severityCounts.warning} אזהרות</span>
            </div>
          )}
          {severityCounts.positive && (
            <div className="flex items-center gap-[6px] bg-emerald-500/10 border border-emerald-500/20 rounded-full px-[12px] py-[4px]">
              <div className="w-[8px] h-[8px] rounded-full bg-emerald-500" />
              <span className="text-emerald-400 text-[12px] font-medium">{severityCounts.positive} חיוביים</span>
            </div>
          )}
          {severityCounts.info && (
            <div className="flex items-center gap-[6px] bg-blue-500/10 border border-blue-500/20 rounded-full px-[12px] py-[4px]">
              <div className="w-[8px] h-[8px] rounded-full bg-blue-500" />
              <span className="text-blue-400 text-[12px] font-medium">{severityCounts.info} מידע</span>
            </div>
          )}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-[6px] mb-[20px] overflow-x-auto pb-1">
        {filterOptions.map((opt) => {
          const count = opt.key === "all" ? insights.length : insights.filter((i) => i.category === opt.key).length;
          return (
            <button
              key={opt.key}
              onClick={() => setActiveFilter(opt.key)}
              className={`px-[14px] py-[6px] rounded-full text-[13px] font-medium transition-all duration-200 whitespace-nowrap cursor-pointer ${
                activeFilter === opt.key
                  ? "bg-[#29318A] text-white"
                  : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70"
              }`}
            >
              {opt.label} {!loading && count > 0 && `(${count})`}
            </button>
          );
        })}
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-[15px]">
        {loading ? (
          <>
            {[...Array(9)].map((_, i) => (
              <SkeletonCard key={`skeleton-${i}`} />
            ))}
          </>
        ) : filteredInsights.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center min-h-[200px] gap-3">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-white/15">
              <path d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="text-white/30 text-[14px]">
              {activeFilter === "all" ? "אין מספיק נתונים להצגת תובנות" : "אין תובנות בקטגוריה זו"}
            </p>
          </div>
        ) : (
          filteredInsights.map((insight) => <InsightCard key={insight.id} insight={insight} />)
        )}
      </div>
    </div>
  );
}
