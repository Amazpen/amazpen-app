"use client";

import { useState, useEffect, useCallback } from "react";
import { useDashboard } from "../layout";
import { createClient } from "@/lib/supabase/client";

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
const CategoryIcon = ({ category }: { category: InsightCategory }) => {
  switch (category) {
    case "revenue":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      );
    case "expenses":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 4H3M21 4v16l-4-2-4 2-4-2-4 2V4h16z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      );
    case "labor":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      );
    case "suppliers":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="1" y="3" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M16 8h4l3 3v5a1 1 0 01-1 1h-2M1 17h1M5.5 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18.5 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      );
    case "cashflow":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M23 6l-9.5 9.5-5-5L1 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M17 6h6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      );
    case "operations":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="2"/></svg>
      );
    case "goals":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>
      );
  }
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
      <div className="flex flex-row-reverse justify-between items-start gap-[8px]">
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
    <div className="flex flex-row-reverse justify-between items-start">
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

    const currentMonthStart = `${currentYear}-${String(currentMonth).padStart(2, "0")}-01`;
    const currentMonthEnd = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${new Date(currentYear, currentMonth, 0).getDate()}`;
    const prevMonthStart = `${prevMonthYear}-${String(prevMonth).padStart(2, "0")}-01`;
    const prevMonthEnd = `${prevMonthYear}-${String(prevMonth).padStart(2, "0")}-${new Date(prevMonthYear, prevMonth, 0).getDate()}`;

    const businessIds = selectedBusinesses;

    try {
      // ====================================================================
      // 1. Revenue trend: current month vs previous month
      // ====================================================================
      const [{ data: currentRevenue }, { data: prevRevenue }] = await Promise.all([
        supabase
          .from("daily_entries")
          .select("total_register")
          .in("business_id", businessIds)
          .gte("entry_date", currentMonthStart)
          .lte("entry_date", currentMonthEnd)
          .is("deleted_at", null),
        supabase
          .from("daily_entries")
          .select("total_register")
          .in("business_id", businessIds)
          .gte("entry_date", prevMonthStart)
          .lte("entry_date", prevMonthEnd)
          .is("deleted_at", null),
      ]);

      const currentTotal = (currentRevenue || []).reduce((s, r) => s + (Number(r.total_register) || 0), 0);
      const prevTotal = (prevRevenue || []).reduce((s, r) => s + (Number(r.total_register) || 0), 0);

      if (prevTotal > 0 && currentTotal > 0) {
        const changePct = ((currentTotal - prevTotal) / prevTotal) * 100;
        const isUp = changePct > 0;
        results.push({
          id: "revenue-trend",
          title: isUp ? "מגמת הכנסות עולה" : "ירידה בהכנסות",
          description: isUp
            ? `ההכנסות החודש עלו ב-${formatPercent(Math.abs(changePct))} בהשוואה לחודש שעבר. המומנטום חיובי — כדאי לבדוק מה השתנה ולהמשיך את המגמה.`
            : `ההכנסות החודש ירדו ב-${formatPercent(Math.abs(changePct))} בהשוואה לחודש שעבר. מומלץ לבדוק אם מדובר בעונתיות או בבעיה שצריך לטפל בה.`,
          severity: isUp ? "positive" : "negative",
          category: "revenue",
          value: `${formatCurrencyFull(currentTotal)} (חודש נוכחי) מול ${formatCurrencyFull(prevTotal)} (חודש קודם)`,
        });
      }

      // ====================================================================
      // 2. Best and worst days analysis
      // ====================================================================
      const { data: dailyData } = await supabase
        .from("daily_entries")
        .select("entry_date, total_register, day_factor")
        .in("business_id", businessIds)
        .gte("entry_date", currentMonthStart)
        .lte("entry_date", currentMonthEnd)
        .is("deleted_at", null)
        .order("total_register", { ascending: false });

      if (dailyData && dailyData.length >= 3) {
        const best = dailyData[0];
        const worst = dailyData[dailyData.length - 1];
        const bestDate = new Date(best.entry_date);
        const worstDate = new Date(worst.entry_date);
        const dayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

        results.push({
          id: "best-day",
          title: "היום הכי רווחי החודש",
          description: `יום ${dayNames[bestDate.getDay()]} ${bestDate.toLocaleDateString("he-IL")} היה היום עם ההכנסה הגבוהה ביותר החודש. הפער בין היום הטוב לגרוע ביותר הוא ${formatCurrencyFull(Number(best.total_register) - Number(worst.total_register))}.`,
          severity: "info",
          category: "revenue",
          value: formatCurrencyFull(Number(best.total_register)),
        });

        // Average revenue per day
        const avg = currentTotal / dailyData.length;
        const aboveAvg = dailyData.filter((d) => Number(d.total_register) > avg).length;
        const belowAvg = dailyData.length - aboveAvg;

        if (belowAvg > aboveAvg) {
          results.push({
            id: "below-avg-days",
            title: "רוב הימים מתחת לממוצע",
            description: `${belowAvg} מתוך ${dailyData.length} ימים היו מתחת לממוצע היומי של ${formatCurrencyFull(avg)}. כמה ימים חזקים במיוחד מושכים את הממוצע למעלה — שווה לבדוק מה מייחד אותם.`,
            severity: "warning",
            category: "operations",
            value: `ממוצע יומי: ${formatCurrencyFull(avg)}`,
          });
        }
      }

      // ====================================================================
      // 3. Labor cost analysis
      // ====================================================================
      const { data: laborData } = await supabase
        .from("daily_entries")
        .select("total_register, labor_cost, manager_daily_cost")
        .in("business_id", businessIds)
        .gte("entry_date", currentMonthStart)
        .lte("entry_date", currentMonthEnd)
        .is("deleted_at", null);

      if (laborData && laborData.length > 0) {
        const totalRevForLabor = laborData.reduce((s, d) => s + (Number(d.total_register) || 0), 0);
        const totalLabor = laborData.reduce((s, d) => s + (Number(d.labor_cost) || 0) + (Number(d.manager_daily_cost) || 0), 0);

        if (totalRevForLabor > 0) {
          const laborPct = (totalLabor / totalRevForLabor) * 100;

          if (laborPct > 30) {
            results.push({
              id: "labor-high",
              title: "עלות כוח אדם גבוהה",
              description: `עלות כוח האדם עומדת על ${formatPercent(laborPct)} מההכנסות — מעל הסף המומלץ של 30%. מומלץ לבדוק שעות עבודה בימים חלשים ולשקול אופטימיזציה של המשמרות.`,
              severity: "negative",
              category: "labor",
              value: `${formatCurrencyFull(totalLabor)} מתוך ${formatCurrencyFull(totalRevForLabor)}`,
            });
          } else if (laborPct < 20) {
            results.push({
              id: "labor-efficient",
              title: "יעילות כוח אדם מצוינת",
              description: `עלות כוח האדם היא רק ${formatPercent(laborPct)} מההכנסות — הרבה מתחת לממוצע בענף. זה אומר שהצוות עובד ביעילות גבוהה או שאפשר להוסיף עובדים כדי לשפר שירות.`,
              severity: "positive",
              category: "labor",
              value: `${formatPercent(laborPct)} מההכנסות`,
            });
          } else {
            results.push({
              id: "labor-ok",
              title: "עלות כוח אדם בנורמה",
              description: `עלות כוח האדם עומדת על ${formatPercent(laborPct)} מההכנסות — בטווח הנורמלי של 20%-30%. ניתן לנסות לייעל ע״י התאמת משמרות לימים חזקים.`,
              severity: "info",
              category: "labor",
              value: `${formatCurrencyFull(totalLabor)} (${formatPercent(laborPct)})`,
            });
          }
        }
      }

      // ====================================================================
      // 4. Top suppliers by spending
      // ====================================================================
      const { data: invoicesData } = await supabase
        .from("invoices")
        .select("supplier_id, subtotal, suppliers!inner(name, expense_type)")
        .in("business_id", businessIds)
        .gte("invoice_date", currentMonthStart)
        .lte("invoice_date", currentMonthEnd)
        .is("deleted_at", null);

      if (invoicesData && invoicesData.length > 0) {
        const supplierTotals: Record<string, { name: string; total: number; type: string }> = {};
        for (const inv of invoicesData) {
          const sid = inv.supplier_id;
          const supplier = inv.suppliers as unknown as { name: string; expense_type: string };
          if (!supplierTotals[sid]) {
            supplierTotals[sid] = { name: supplier.name, total: 0, type: supplier.expense_type };
          }
          supplierTotals[sid].total += Number(inv.subtotal) || 0;
        }

        const sorted = Object.values(supplierTotals).sort((a, b) => b.total - a.total);
        const totalSpending = sorted.reduce((s, v) => s + v.total, 0);

        if (sorted.length >= 2) {
          const topSupplier = sorted[0];
          const topPct = (topSupplier.total / totalSpending) * 100;

          if (topPct > 40) {
            results.push({
              id: "supplier-concentration",
              title: "תלות גבוהה בספק אחד",
              description: `הספק "${topSupplier.name}" מהווה ${formatPercent(topPct)} מסך ההוצאות על ספקים החודש. תלות כזו בספק יחיד מגבירה סיכון — מומלץ לבדוק חלופות או לנהל מו״מ על מחירים.`,
              severity: "warning",
              category: "suppliers",
              value: `${formatCurrencyFull(topSupplier.total)} מתוך ${formatCurrencyFull(totalSpending)}`,
            });
          }

          // Supplier spending vs previous month
          const { data: prevInvoicesData } = await supabase
            .from("invoices")
            .select("subtotal")
            .in("business_id", businessIds)
            .gte("invoice_date", prevMonthStart)
            .lte("invoice_date", prevMonthEnd)
            .is("deleted_at", null);

          const prevSpending = (prevInvoicesData || []).reduce((s, r) => s + (Number(r.subtotal) || 0), 0);
          if (prevSpending > 0) {
            const spendingChange = ((totalSpending - prevSpending) / prevSpending) * 100;
            if (Math.abs(spendingChange) > 10) {
              results.push({
                id: "supplier-spending-change",
                title: spendingChange > 0 ? "עלייה בהוצאות ספקים" : "ירידה בהוצאות ספקים",
                description: spendingChange > 0
                  ? `הוצאות הספקים עלו ב-${formatPercent(Math.abs(spendingChange))} בהשוואה לחודש שעבר. כדאי לבדוק אם מדובר בעליית מחירים, בהגדלת הזמנות, או בשניהם.`
                  : `הוצאות הספקים ירדו ב-${formatPercent(Math.abs(spendingChange))} בהשוואה לחודש שעבר. אם זה לא בגלל ירידה בפעילות, זו חיסכון מוצלח.`,
                severity: spendingChange > 0 ? "warning" : "positive",
                category: "expenses",
                value: `${formatCurrencyFull(totalSpending)} מול ${formatCurrencyFull(prevSpending)} (חודש קודם)`,
              });
            }
          }
        }
      }

      // ====================================================================
      // 5. Unpaid invoices / overdue payments
      // ====================================================================
      const today = now.toISOString().split("T")[0];
      const { data: overduePayments } = await supabase
        .from("payment_splits")
        .select("amount, due_date, payments!inner(business_id, supplier_id, suppliers!inner(name))")
        .lte("due_date", today)
        .is("payments.deleted_at", null);

      if (overduePayments && overduePayments.length > 0) {
        // Filter by selected businesses
        const relevantOverdue = overduePayments.filter((ps) => {
          const payment = ps.payments as unknown as { business_id: string };
          return businessIds.includes(payment.business_id);
        });

        if (relevantOverdue.length > 0) {
          const totalOverdue = relevantOverdue.reduce((s, ps) => s + (Number(ps.amount) || 0), 0);
          const oldestDate = relevantOverdue.reduce((oldest, ps) => {
            return ps.due_date < oldest ? ps.due_date : oldest;
          }, relevantOverdue[0].due_date);

          const daysOld = Math.floor((now.getTime() - new Date(oldestDate).getTime()) / (1000 * 60 * 60 * 24));

          results.push({
            id: "overdue-payments",
            title: `${relevantOverdue.length} תשלומים שעבר מועד הפירעון`,
            description: `יש ${relevantOverdue.length} תשלומים בסך ${formatCurrencyFull(totalOverdue)} שמועד הפירעון שלהם עבר. התשלום הוותיק ביותר מאוחר ב-${daysOld} ימים. מומלץ לטפל בזה בהקדם כדי לשמור על יחסי ספקים תקינים.`,
            severity: "negative",
            category: "cashflow",
            value: `${formatCurrencyFull(totalOverdue)} (${relevantOverdue.length} תשלומים)`,
          });
        }
      }

      // ====================================================================
      // 6. Upcoming payments in next 7 days
      // ====================================================================
      const next7 = new Date(now);
      next7.setDate(next7.getDate() + 7);
      const next7Str = next7.toISOString().split("T")[0];

      const { data: upcomingPayments } = await supabase
        .from("payment_splits")
        .select("amount, due_date, payments!inner(business_id)")
        .gt("due_date", today)
        .lte("due_date", next7Str)
        .is("payments.deleted_at", null);

      if (upcomingPayments && upcomingPayments.length > 0) {
        const relevant = upcomingPayments.filter((ps) => {
          const payment = ps.payments as unknown as { business_id: string };
          return businessIds.includes(payment.business_id);
        });

        if (relevant.length > 0) {
          const totalUpcoming = relevant.reduce((s, ps) => s + (Number(ps.amount) || 0), 0);
          results.push({
            id: "upcoming-payments",
            title: `${relevant.length} תשלומים ב-7 הימים הקרובים`,
            description: `צפויים ${relevant.length} תשלומים בסך ${formatCurrencyFull(totalUpcoming)} בשבוע הקרוב. יש לוודא שיש מספיק תזרים לכסות אותם.`,
            severity: totalUpcoming > 10000 ? "warning" : "info",
            category: "cashflow",
            value: formatCurrencyFull(totalUpcoming),
          });
        }
      }

      // ====================================================================
      // 7. Goals progress
      // ====================================================================
      const { data: goals } = await supabase
        .from("goals")
        .select("*")
        .in("business_id", businessIds)
        .eq("year", currentYear)
        .eq("month", currentMonth)
        .is("deleted_at", null);

      if (goals && goals.length > 0 && currentTotal > 0) {
        for (const goal of goals) {
          if (goal.revenue_target && Number(goal.revenue_target) > 0) {
            const progressPct = (currentTotal / Number(goal.revenue_target)) * 100;
            const dayOfMonth = now.getDate();
            const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
            const expectedPct = (dayOfMonth / daysInMonth) * 100;

            if (progressPct < expectedPct - 15) {
              results.push({
                id: `goal-behind-${goal.business_id}`,
                title: "פיגור ביעד ההכנסות",
                description: `עמדת על ${formatPercent(progressPct)} מיעד ההכנסות החודשי, בעוד שלפי הקצב הצפוי היית אמור להיות ב-${formatPercent(expectedPct)}. הפער הוא ${formatCurrencyFull(Number(goal.revenue_target) * (expectedPct / 100) - currentTotal)}.`,
                severity: "negative",
                category: "goals",
                value: `${formatCurrencyFull(currentTotal)} מתוך ${formatCurrencyFull(Number(goal.revenue_target))}`,
              });
            } else if (progressPct >= expectedPct + 10) {
              results.push({
                id: `goal-ahead-${goal.business_id}`,
                title: "מקדימים את יעד ההכנסות",
                description: `כבר הגעת ל-${formatPercent(progressPct)} מהיעד החודשי, בעוד שלפי הקצב הצפוי צריך להיות ב-${formatPercent(expectedPct)}. קצב מצוין — אם ממשיכים ככה, תסגרו את החודש מעל היעד.`,
                severity: "positive",
                category: "goals",
                value: `${formatCurrencyFull(currentTotal)} מתוך ${formatCurrencyFull(Number(goal.revenue_target))}`,
              });
            }
          }
        }
      }

      // ====================================================================
      // 8. Discount analysis
      // ====================================================================
      if (dailyData && dailyData.length > 0) {
        const { data: discountData } = await supabase
          .from("daily_entries")
          .select("discounts, total_register")
          .in("business_id", businessIds)
          .gte("entry_date", currentMonthStart)
          .lte("entry_date", currentMonthEnd)
          .is("deleted_at", null);

        if (discountData) {
          const totalDiscounts = discountData.reduce((s, d) => s + (Number(d.discounts) || 0), 0);
          const totalRevForDisc = discountData.reduce((s, d) => s + (Number(d.total_register) || 0), 0);

          if (totalRevForDisc > 0 && totalDiscounts > 0) {
            const discountPct = (totalDiscounts / totalRevForDisc) * 100;
            if (discountPct > 5) {
              results.push({
                id: "high-discounts",
                title: "אחוז הנחות גבוה",
                description: `סך ההנחות החודש הגיע ל-${formatPercent(discountPct)} מההכנסות (${formatCurrencyFull(totalDiscounts)}). שווה לבדוק אם ההנחות מוצדקות — למשל שגיאות, עודף מנות לדוגמה, או הנחות לקוחות שאפשר לצמצם.`,
                severity: "warning",
                category: "operations",
                value: `${formatCurrencyFull(totalDiscounts)} (${formatPercent(discountPct)})`,
              });
            }
          }
        }
      }

      // ====================================================================
      // 9. Day-of-week performance analysis
      // ====================================================================
      if (dailyData && dailyData.length >= 7) {
        const dayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
        const dayTotals: Record<number, { total: number; count: number }> = {};

        for (const entry of dailyData) {
          const dayOfWeek = new Date(entry.entry_date).getDay();
          if (!dayTotals[dayOfWeek]) dayTotals[dayOfWeek] = { total: 0, count: 0 };
          dayTotals[dayOfWeek].total += Number(entry.total_register) || 0;
          dayTotals[dayOfWeek].count += 1;
        }

        const dayAvgs = Object.entries(dayTotals)
          .map(([day, data]) => ({ day: Number(day), avg: data.total / data.count }))
          .sort((a, b) => b.avg - a.avg);

        if (dayAvgs.length >= 3) {
          const best = dayAvgs[0];
          const worst = dayAvgs[dayAvgs.length - 1];
          const ratio = worst.avg > 0 ? best.avg / worst.avg : 0;

          if (ratio > 2) {
            results.push({
              id: "day-performance-gap",
              title: `פער משמעותי בין ימי השבוע`,
              description: `יום ${dayNames[best.day]} מכניס פי ${ratio.toFixed(1)} מיום ${dayNames[worst.day]} בממוצע. שווה לחשוב על אירועים, מבצעים, או שינוי שעות פעילות בימים החלשים כדי למקסם הכנסות.`,
              severity: "info",
              category: "operations",
              value: `${dayNames[best.day]}: ${formatCurrencyFull(best.avg)} מול ${dayNames[worst.day]}: ${formatCurrencyFull(worst.avg)}`,
            });
          }
        }
      }

      // ====================================================================
      // 10. Fixed expenses awareness
      // ====================================================================
      const { data: fixedSuppliers } = await supabase
        .from("suppliers")
        .select("name, monthly_expense_amount")
        .in("business_id", businessIds)
        .eq("is_fixed_expense", true)
        .eq("is_active", true)
        .is("deleted_at", null);

      if (fixedSuppliers && fixedSuppliers.length > 0) {
        const totalFixed = fixedSuppliers.reduce((s, sup) => s + (Number(sup.monthly_expense_amount) || 0), 0);

        if (totalFixed > 0 && currentTotal > 0) {
          const fixedPct = (totalFixed / currentTotal) * 100;
          results.push({
            id: "fixed-expenses",
            title: `${fixedSuppliers.length} הוצאות קבועות פעילות`,
            description: `סך ההוצאות הקבועות החודשיות הוא ${formatCurrencyFull(totalFixed)} (${formatPercent(fixedPct)} מההכנסות). מומלץ לעבור על הרשימה אחת לתקופה ולבדוק אם כולן עדיין הכרחיות.`,
            severity: fixedPct > 15 ? "warning" : "info",
            category: "expenses",
            value: `${formatCurrencyFull(totalFixed)} / חודש`,
          });
        }
      }

      // ====================================================================
      // 11. Waste analysis
      // ====================================================================
      if (laborData && laborData.length > 0) {
        const { data: wasteData } = await supabase
          .from("daily_entries")
          .select("waste, total_register")
          .in("business_id", businessIds)
          .gte("entry_date", currentMonthStart)
          .lte("entry_date", currentMonthEnd)
          .is("deleted_at", null);

        if (wasteData) {
          const totalWaste = wasteData.reduce((s, d) => s + (Number(d.waste) || 0), 0);
          if (totalWaste > 0 && currentTotal > 0) {
            const wastePct = (totalWaste / currentTotal) * 100;
            results.push({
              id: "waste-analysis",
              title: wastePct > 3 ? "אחוז פחת גבוה" : "פחת בגבולות הסביר",
              description: wastePct > 3
                ? `הפחת החודשי עומד על ${formatPercent(wastePct)} מההכנסות (${formatCurrencyFull(totalWaste)}). מעל 3% זה גבוה — מומלץ לבדוק תהליכי אחסון, הכנה, ונהלי מנות כדי לצמצם.`
                : `הפחת החודשי עומד על ${formatPercent(wastePct)} מההכנסות (${formatCurrencyFull(totalWaste)}). זה בטווח הסביר, אבל תמיד שווה לחפש דרכים לצמצם.`,
              severity: wastePct > 3 ? "negative" : "info",
              category: "operations",
              value: `${formatCurrencyFull(totalWaste)} (${formatPercent(wastePct)})`,
            });
          }
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
      <div className="px-2.5 pb-8 lg:px-3 xl:px-4">
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
    <div className="px-2.5 pb-8 lg:px-3 xl:px-4">
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
            {[...Array(6)].map((_, i) => (
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
