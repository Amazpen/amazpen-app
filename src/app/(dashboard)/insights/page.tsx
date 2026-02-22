"use client";

import { useState, useEffect, useCallback } from "react";
import { useDashboard } from "../layout";
import { createClient } from "@/lib/supabase/client";
import { ChartLineUp, Receipt, UsersThree, Package, ArrowsLeftRight, GearSix, Trophy } from "@phosphor-icons/react";

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
        <div className={`px-[8px] py-[2px] rounded-full ${styles.badge} flex-shrink-0`}>
          <span className={`text-[10px] font-medium ${styles.badgeText}`}>{severityLabels[insight.severity]}</span>
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
  const { selectedBusinesses } = useDashboard();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<InsightCategory | "all">("all");

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
          .gte("invoice_date", currentMonthStart)
          .lte("invoice_date", currentMonthEnd)
          .is("deleted_at", null),
        // Previous month invoices
        supabase
          .from("invoices")
          .select("subtotal, suppliers!inner(expense_type)")
          .in("business_id", businessIds)
          .gte("invoice_date", prevMonthStart)
          .lte("invoice_date", prevMonthEnd)
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
          .select("id, name, unit, unit_cost, target_pct")
          .in("business_id", businessIds)
          .is("deleted_at", null),
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
      const totalAllExpenses = totalGoods + totalCurrentExp;

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
      // 1. REVENUE: Monthly trend
      // ====================================================================
      if (prevTotal > 0 && currentTotal > 0) {
        const changePct = ((currentTotal - prevTotal) / prevTotal) * 100;
        const isUp = changePct > 0;
        results.push({
          id: "revenue-trend",
          title: isUp ? "מגמת הכנסות עולה" : "ירידה בהכנסות לעומת חודש קודם",
          description: isUp
            ? `ההכנסות החודש עלו ב-${formatPercent(Math.abs(changePct))} בהשוואה לחודש שעבר. המומנטום חיובי — כדאי לבדוק מה השתנה ולהמשיך את המגמה.`
            : `ההכנסות החודש ירדו ב-${formatPercent(Math.abs(changePct))} לעומת חודש קודם. מומלץ לבדוק אם מדובר בעונתיות או בבעיה שצריך לטפל בה.`,
          severity: isUp ? "positive" : "negative",
          category: "revenue",
          value: `${formatCurrencyFull(currentTotal)} (חודש נוכחי) מול ${formatCurrencyFull(prevTotal)} (חודש קודם)`,
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
        const dayTotals: Record<number, { total: number; count: number; labor: number; hours: number }> = {};
        for (const entry of entries) {
          const dow = new Date(entry.entry_date).getDay();
          if (!dayTotals[dow]) dayTotals[dow] = { total: 0, count: 0, labor: 0, hours: 0 };
          dayTotals[dow].total += Number(entry.total_register) || 0;
          dayTotals[dow].count += 1;
          dayTotals[dow].labor += Number(entry.labor_cost) || 0;
          dayTotals[dow].hours += Number(entry.labor_hours) || 0;
        }

        const dayAvgs = Object.entries(dayTotals)
          .map(([day, data]) => ({ day: Number(day), avg: data.total / data.count, laborPct: data.total > 0 ? (data.labor / data.total * 100) : 0, avgHours: data.hours / data.count }))
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

        // Food cost change vs prev month
        if (prevGoods > 0) {
          const foodChange = ((totalGoods - prevGoods) / prevGoods) * 100;
          if (Math.abs(foodChange) > 10) {
            results.push({
              id: "food-cost-trend",
              title: foodChange > 0 ? "עלייה בעלויות סחורה" : "ירידה בעלויות סחורה",
              description: foodChange > 0
                ? `עלויות הסחורה (קניות) עלו ב-${formatPercent(Math.abs(foodChange))} לעומת חודש קודם. כדאי לבדוק: עליית מחירי ספקים? הזמנות גדולות יותר? פחת שעלה?`
                : `עלויות הסחורה ירדו ב-${formatPercent(Math.abs(foodChange))} לעומת חודש קודם. אם לא ירדה הפעילות — זו חיסכון אמיתי.`,
              severity: foodChange > 15 ? "negative" : foodChange > 0 ? "warning" : "positive",
              category: "suppliers",
              value: `${formatCurrencyFull(totalGoods)} (חודש נוכחי) מול ${formatCurrencyFull(prevGoods)} (חודש קודם)`,
            });
          }
        }
      }

      // ====================================================================
      // 9. EXPENSES: Current expenses analysis
      // ====================================================================
      if (incomeBeforeVat > 0 && totalCurrentExp > 0) {
        const expPct = (totalCurrentExp / incomeBeforeVat) * 100;
        const expTarget = goal ? Number(goal.current_expenses_target) || 0 : 0;

        if (expTarget > 0) {
          const diff = totalCurrentExp - expTarget;
          results.push({
            id: "current-exp-target",
            title: diff > 0 ? "חריגה ביעד הוצאות שוטפות" : "הוצאות שוטפות מתחת ליעד",
            description: diff > 0
              ? `ההוצאות השוטפות הגיעו ל-${formatCurrencyFull(totalCurrentExp)} — חריגה של ${formatCurrencyFull(Math.abs(diff))} מיעד ${formatCurrencyFull(expTarget)}.`
              : `ההוצאות השוטפות הן ${formatCurrencyFull(totalCurrentExp)} — מתחת ליעד של ${formatCurrencyFull(expTarget)} ב-${formatCurrencyFull(Math.abs(diff))}.`,
            severity: diff > 0 ? "negative" : "positive",
            category: "expenses",
            value: `${formatCurrencyFull(totalCurrentExp)} (${formatPercent(expPct)} מפדיון) | יעד: ${formatCurrencyFull(expTarget)}`,
          });
        }

        // Current expenses change vs prev month
        if (prevCurrentExp > 0) {
          const expChange = ((totalCurrentExp - prevCurrentExp) / prevCurrentExp) * 100;
          if (Math.abs(expChange) > 10) {
            results.push({
              id: "current-exp-trend",
              title: expChange > 0 ? "עלייה בהוצאות שוטפות" : "ירידה בהוצאות שוטפות",
              description: expChange > 0
                ? `ההוצאות השוטפות עלו ב-${formatPercent(Math.abs(expChange))} לעומת חודש קודם (${formatCurrencyFull(totalCurrentExp)} מול ${formatCurrencyFull(prevCurrentExp)}). כדאי לבדוק אילו ספקים גדלו.`
                : `ההוצאות השוטפות ירדו ב-${formatPercent(Math.abs(expChange))} לעומת חודש קודם. חיסכון של ${formatCurrencyFull(Math.abs(totalCurrentExp - prevCurrentExp))}.`,
              severity: expChange > 0 ? "warning" : "positive",
              category: "expenses",
            });
          }
        }
      }

      // ====================================================================
      // 10. PROFIT: Operating profit calculation
      // ====================================================================
      if (incomeBeforeVat > 0) {
        const allExpenses = laborCostWithManager + totalGoods + totalCurrentExp;
        const operatingProfit = incomeBeforeVat - allExpenses;
        const profitPct = (operatingProfit / incomeBeforeVat) * 100;

        results.push({
          id: "operating-profit",
          title: operatingProfit >= 0 ? `רווח תפעולי: ${formatPercent(profitPct)}` : `הפסד תפעולי: ${formatPercent(Math.abs(profitPct))}`,
          description: operatingProfit >= 0
            ? `אחרי כל ההוצאות (כ״א: ${formatCurrencyFull(laborCostWithManager)}, סחורה: ${formatCurrencyFull(totalGoods)}, שוטפות: ${formatCurrencyFull(totalCurrentExp)}), נותר רווח תפעולי של ${formatCurrencyFull(operatingProfit)} (${formatPercent(profitPct)} מהפדיון).`
            : `סך ההוצאות (${formatCurrencyFull(allExpenses)}) עולה על הפדיון (${formatCurrencyFull(incomeBeforeVat)}). הפסד תפעולי של ${formatCurrencyFull(Math.abs(operatingProfit))}. נדרשת בדיקה דחופה.`,
          severity: profitPct > 10 ? "positive" : profitPct > 0 ? "info" : "negative",
          category: "revenue",
          value: `פדיון: ${formatCurrencyFull(incomeBeforeVat)} | הוצאות: ${formatCurrencyFull(allExpenses)} | רווח: ${formatCurrencyFull(operatingProfit)}`,
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
      // 12. FIXED EXPENSES: Review
      // ====================================================================
      if (fixedSuppliers && fixedSuppliers.length > 0) {
        const totalFixed = fixedSuppliers.reduce((s, sup) => s + (Number(sup.monthly_expense_amount) || 0), 0);
        if (totalFixed > 0 && incomeBeforeVat > 0) {
          const fixedPct = (totalFixed / incomeBeforeVat) * 100;
          const topFixed = [...fixedSuppliers].sort((a, b) => (Number(b.monthly_expense_amount) || 0) - (Number(a.monthly_expense_amount) || 0)).slice(0, 3);

          results.push({
            id: "fixed-expenses",
            title: `${fixedSuppliers.length} הוצאות קבועות — ${formatCurrencyFull(totalFixed)}/חודש`,
            description: `הוצאות קבועות מהוות ${formatPercent(fixedPct)} מהפדיון. הגדולות: ${topFixed.map((s) => `${s.name} (${formatCurrencyFull(Number(s.monthly_expense_amount) || 0)})`).join(", ")}. ${fixedPct > 20 ? "מומלץ לעבור על הרשימה ולבדוק אם כולן הכרחיות." : "הרמה סבירה."}`,
            severity: fixedPct > 25 ? "warning" : "info",
            category: "expenses",
            value: `${formatCurrencyFull(totalFixed)} / חודש (${formatPercent(fixedPct)} מפדיון)`,
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
      // 16. CASHFLOW: Overdue payments
      // ====================================================================
      const overduePayments = bizPaymentSplits.filter((ps) => ps.due_date <= today);
      if (overduePayments.length > 0) {
        const totalOverdue = overduePayments.reduce((s, ps) => s + (Number(ps.amount) || 0), 0);
        const oldest = overduePayments.reduce((o, ps) => ps.due_date < o ? ps.due_date : o, overduePayments[0].due_date);
        const daysOld = Math.floor((now.getTime() - new Date(oldest).getTime()) / (1000 * 60 * 60 * 24));

        results.push({
          id: "overdue-payments",
          title: `${overduePayments.length} תשלומים שעבר מועד פירעון`,
          description: `יש ${overduePayments.length} תשלומים בסך ${formatCurrencyFull(totalOverdue)} שעבר מועד פירעונם. הוותיק מאוחר ב-${daysOld} ימים. מומלץ לטפל בהקדם כדי לשמור על יחסי ספקים תקינים ולהימנע מריביות.`,
          severity: "negative",
          category: "cashflow",
          value: `${formatCurrencyFull(totalOverdue)} (${overduePayments.length} תשלומים, הוותיק: ${daysOld} ימים)`,
        });
      }

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
      // 18. CASHFLOW: Total future commitments
      // ====================================================================
      const futurePayments = bizPaymentSplits.filter((ps) => ps.due_date > today);
      if (futurePayments.length > 0) {
        const totalFuture = futurePayments.reduce((s, ps) => s + (Number(ps.amount) || 0), 0);
        const lastDue = futurePayments.reduce((l, ps) => ps.due_date > l ? ps.due_date : l, futurePayments[0].due_date);
        const monthsAhead = Math.ceil((new Date(lastDue).getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30));

        // Group by month
        const monthlyTotals: Record<string, number> = {};
        for (const ps of futurePayments) {
          const month = ps.due_date.substring(0, 7);
          monthlyTotals[month] = (monthlyTotals[month] || 0) + (Number(ps.amount) || 0);
        }
        const peakMonth = Object.entries(monthlyTotals).sort((a, b) => b[1] - a[1])[0];

        results.push({
          id: "future-commitments",
          title: `${formatCurrencyFull(totalFuture)} התחייבויות עתידיות`,
          description: `יש ${futurePayments.length} תשלומים עתידיים לתקופה של ${monthsAhead} חודשים. החודש עם ההוצאה הגבוהה ביותר: ${peakMonth[0]} (${formatCurrencyFull(peakMonth[1])}). חשוב לוודא תזרים מספיק בחודשים הבאים.`,
          severity: totalFuture > incomeBeforeVat ? "warning" : "info",
          category: "cashflow",
          value: `${futurePayments.length} תשלומים | שיא: ${peakMonth[0]} (${formatCurrencyFull(peakMonth[1])})`,
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
      // 22. OPERATIONS: Data completeness
      // ====================================================================
      const expectedDays = dayOfMonth;
      const missingDays = expectedDays - entries.length;
      if (missingDays > 2) {
        results.push({
          id: "missing-entries",
          title: `${missingDays} ימים חסרים במילוי יומי`,
          description: `מתוך ${expectedDays} ימים שעברו החודש, רק ${entries.length} ימים מולאו. חסרים ${missingDays} ימים. נתונים חסרים פוגעים בדיוק התובנות ובמעקב. מומלץ להשלים בהקדם.`,
          severity: missingDays > 5 ? "negative" : "warning",
          category: "operations",
          value: `${entries.length} / ${expectedDays} ימים מולאו`,
        });
      }

      // ====================================================================
      // 23. NET CASHFLOW: Income vs all payments this month
      // ====================================================================
      if (currentTotal > 0) {
        const monthPayments = bizPaymentSplits.filter((ps) =>
          ps.due_date >= currentMonthStart && ps.due_date <= currentMonthEnd
        );
        const totalMonthPayments = monthPayments.reduce((s, ps) => s + (Number(ps.amount) || 0), 0);
        const netCashflow = currentTotal - totalMonthPayments - totalAllExpenses;

        if (totalMonthPayments > 0 || totalAllExpenses > 0) {
          results.push({
            id: "net-cashflow",
            title: netCashflow >= 0 ? "תזרים חודשי חיובי" : "תזרים חודשי שלילי",
            description: `הכנסות: ${formatCurrencyFull(currentTotal)}, תשלומים לספקים: ${formatCurrencyFull(totalMonthPayments)}, חשבוניות שוטפות: ${formatCurrencyFull(totalAllExpenses)}. ${netCashflow >= 0 ? `נשאר עודף של ${formatCurrencyFull(netCashflow)}.` : `חסרים ${formatCurrencyFull(Math.abs(netCashflow))}.`}`,
            severity: netCashflow >= 0 ? "positive" : "negative",
            category: "cashflow",
            value: `נטו: ${formatCurrencyFull(netCashflow)}`,
          });
        }
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
