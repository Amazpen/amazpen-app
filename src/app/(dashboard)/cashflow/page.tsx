"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "../layout";
import { createClient } from "@/lib/supabase/client";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { usePersistedState } from "@/hooks/usePersistedState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { calculateSettledIncome, type SettledIncome } from "@/lib/cashflow/settlement";
import type { PaymentMethodType, CashflowSettings } from "@/types";

// ============================================================================
// TYPES
// ============================================================================
interface DayData {
  date: string; // YYYY-MM-DD
  incomeItems: SettledIncome[];
  expenseItems: ExpenseItem[];
  totalIncome: number;
  totalExpenses: number;
  dailyDiff: number;
  cumulative: number;
}

interface ExpenseItem {
  id: string;
  supplier_name: string;
  amount: number;
  payment_method: string;
  due_date: string;
}

interface MonthGroup {
  key: string; // YYYY-MM
  label: string;
  days: DayData[];
  totalIncome: number;
  totalExpenses: number;
  totalDiff: number;
  endCumulative: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================
const hebrewMonths = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

const paymentMethodNames: Record<string, string> = {
  bank_transfer: "העברה בנקאית",
  cash: "מזומן",
  check: "צ׳ק",
  bit: "ביט",
  paybox: "פייבוקס",
  credit_card: "כרטיס אשראי",
  other: "אחר",
  credit_companies: "חברות הקפה",
  standing_order: "הוראת קבע",
};

// ============================================================================
// FORMAT FUNCTIONS
// ============================================================================
const formatCurrencyFull = (amount: number) => {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const formatted = `₪${Math.round(absAmount).toLocaleString("he-IL")}`;
  return isNegative ? `\u200E-${formatted}` : formatted;
};

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDisplayDate = (dateStr: string) => {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const formatDayLabel = (dateStr: string) => {
  const d = new Date(dateStr + "T00:00:00");
  const dayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  return `${dayNames[d.getDay()]} ${d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })}`;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function CashFlowPage() {
  const { selectedBusinesses, isAdmin } = useDashboard();
  const router = useRouter();
  const supabase = createClient();

  // Gate: cashflow is admin-only for now (non-admin sees "בקרוב" in the sidebar
  // and lands back on the dashboard if they try to reach this URL directly).
  // The 500ms delay matches the pattern used on /ocr so we don't redirect
  // before the profile has had a chance to load from Supabase.
  const [isCheckingAdminAccess, setIsCheckingAdminAccess] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setIsCheckingAdminAccess(false), 500);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!isCheckingAdminAccess && !isAdmin) router.replace('/');
  }, [isAdmin, isCheckingAdminAccess, router]);

  // Persisted state
  const [savedEndDate, setSavedEndDate] = usePersistedState<string | null>("cashflow:endDate", null);

  // Data
  const [settings, setSettings] = useState<CashflowSettings | null>(null);
  const [monthGroups, setMonthGroups] = useState<MonthGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Opening balance edit
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState("");
  const [balanceDateInput, setBalanceDateInput] = useState("");

  // Override modal
  const [overrideItem, setOverrideItem] = useState<{ date: string; item: SettledIncome } | null>(null);
  const [overrideAmount, setOverrideAmount] = useState("");
  const [overrideNote, setOverrideNote] = useState("");

  // Drill-down state
  const [expandedMonths, setExpandedMonths] = useState<string[]>([]);
  const [expandedDays, setExpandedDays] = useState<string[]>([]);

  // Date range
  const [endDate, setEndDate] = useState<Date>(() => {
    // Default: 3 months from now
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d;
  });

  // Initialize from persisted — but ignore stale saved end-dates that fall
  // before today + 1 month (David: "the cashflow is stuck on March even
  // though we're at the end of April"). The persisted value silently froze
  // the view to the date the user had saved months earlier.
  useEffect(() => {
    if (savedEndDate) {
      const saved = new Date(savedEndDate);
      const minAcceptable = new Date();
      minAcceptable.setMonth(minAcceptable.getMonth() + 1);
      if (saved.getTime() >= minAcceptable.getTime()) {
        setEndDate(saved);
      } else {
        // Stale → reset to today + 3 months and overwrite the persisted value
        const fresh = new Date();
        fresh.setMonth(fresh.getMonth() + 3);
        setEndDate(fresh);
        setSavedEndDate(fresh.toISOString());
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime
  const handleRealtimeChange = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  useMultiTableRealtime(
    ["daily_entries", "daily_payment_breakdown", "payment_splits", "payments", "cashflow_settings", "cashflow_income_overrides", "payment_method_types"],
    handleRealtimeChange,
    selectedBusinesses.length > 0
  );

  // ============================================================================
  // DATA FETCHING
  // ============================================================================
  useEffect(() => {
    if (selectedBusinesses.length === 0) {
      setIsLoading(false);
      setMonthGroups([]);
      return;
    }

    const fetchData = async () => {
      setIsLoading(true);
      const businessId = selectedBusinesses[0];

      try {
        // 1. Fetch settings
        const { data: settingsData } = await supabase
          .from("cashflow_settings")
          .select("*")
          .eq("business_id", businessId)
          .maybeSingle();

        setSettings(settingsData);

        const openingBalance = settingsData?.opening_balance ? Number(settingsData.opening_balance) : 0;
        // Default opening date: first of month 3 months ago (to show historical data)
        const defaultOpeningDate = (() => {
          const d = new Date();
          d.setMonth(d.getMonth() - 3);
          d.setDate(1);
          return formatLocalDate(d);
        })();
        const openingDate = settingsData?.opening_date ? String(settingsData.opening_date).substring(0, 10) : defaultOpeningDate;
        const endDateStr = formatLocalDate(endDate);

        // We need to fetch income entries from BEFORE the opening date too,
        // because settlement rules may push their settlement date into our range.
        // Fetch entries from 2 months before opening date to cover bimonthly settlements.
        const lookbackDate = new Date(openingDate + "T00:00:00");
        lookbackDate.setMonth(lookbackDate.getMonth() - 2);
        const lookbackStr = formatLocalDate(lookbackDate);

        // 2. Parallel queries
        const [pmResult, paymentBreakdownResult, splitsResult, overridesResult, retainersResult, dailyEntriesResult] = await Promise.all([
          supabase
            .from("payment_method_types")
            .select("*")
            .eq("business_id", businessId)
            .eq("is_active", true)
            .order("display_order"),
          supabase
            .from("daily_payment_breakdown")
            .select("amount, payment_method_id, daily_entries!inner(entry_date, business_id)")
            .eq("daily_entries.business_id", businessId)
            .gte("daily_entries.entry_date", lookbackStr)
            .lte("daily_entries.entry_date", endDateStr),
          supabase
            .from("payment_splits")
            .select("id, amount, payment_method, due_date, payments!inner(business_id, supplier_id, deleted_at, suppliers(name))")
            .eq("payments.business_id", businessId)
            .is("payments.deleted_at", null)
            .gte("due_date", openingDate)
            .lte("due_date", endDateStr),
          supabase
            .from("cashflow_income_overrides")
            .select("*")
            .eq("business_id", businessId)
            .gte("settlement_date", openingDate)
            .lte("settlement_date", endDateStr),
          // Fetch active retainers for income forecast (#36)
          supabase
            .from("customers")
            .select("id, business_name, retainer_amount, retainer_day_of_month, retainer_type, retainer_start_date, retainer_end_date, retainer_status, is_foreign")
            .eq("business_id", businessId)
            .eq("retainer_status", "active")
            .is("deleted_at", null),
          // Fetch daily entries as fallback when no payment breakdown exists
          supabase
            .from("daily_entries")
            .select("entry_date, total_register")
            .eq("business_id", businessId)
            .is("deleted_at", null)
            .gte("entry_date", lookbackStr)
            .lte("entry_date", endDateStr),
        ]);

        const paymentMethods = (pmResult.data || []) as PaymentMethodType[];
        const pmNameMap: Record<string, string> = {};
        paymentMethods.forEach((t) => { pmNameMap[t.id] = t.name; });

        // Build retainer forecast map (#36)
        const retainers = retainersResult.data || [];
        // Fetch business VAT rate for retainer calculation
        const { data: bizData } = await supabase.from("businesses").select("vat_percentage").eq("id", businessId).maybeSingle();
        const bizVatRate = Number(bizData?.vat_percentage) || 0.18;
        const retainerByDate = new Map<string, Array<{ name: string; amount: number }>>();
        for (const ret of retainers as Array<Record<string, unknown>>) {
          const dayOfMonth = Number(ret.retainer_day_of_month) || 1;
          const amount = Number(ret.retainer_amount) || 0;
          if (amount <= 0) continue;
          const isForeign = ret.is_foreign as boolean;
          const netAmount = isForeign ? amount : amount * (1 + bizVatRate);
          const startDate = ret.retainer_start_date ? String(ret.retainer_start_date).substring(0, 10) : null;
          const endRetDate = ret.retainer_end_date ? String(ret.retainer_end_date).substring(0, 10) : null;
          const name = `ריטיינר — ${ret.business_name || "לקוח"}`;

          // Generate entries for each month in range
          const rangeStart = new Date(openingDate + "T00:00:00");
          const rangeEnd = new Date(endDateStr + "T00:00:00");
          for (let m = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1); m <= rangeEnd; m.setMonth(m.getMonth() + 1)) {
            const day = Math.min(dayOfMonth, new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate());
            const dateStr = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            if (dateStr < openingDate || dateStr > endDateStr) continue;
            if (startDate && dateStr < startDate) continue;
            if (endRetDate && dateStr > endRetDate) continue;
            const existing = retainerByDate.get(dateStr) || [];
            existing.push({ name, amount: netAmount });
            retainerByDate.set(dateStr, existing);
          }
        }

        const paymentEntries = (paymentBreakdownResult.data || []).map((row: Record<string, unknown>) => {
          const dailyEntry = row.daily_entries as Record<string, unknown>;
          return {
            entry_date: dailyEntry.entry_date as string,
            payment_method_id: row.payment_method_id as string,
            amount: Number(row.amount) || 0,
          };
        });

        // 3. Calculate settled income
        const settledMap = calculateSettledIncome(paymentEntries, paymentMethods, pmNameMap);

        // 3b. Fallback: if no payment breakdown exists for a date, use total_register directly
        const datesWithBreakdown = new Set(paymentEntries.map((e) => e.entry_date));
        const dailyEntries = (dailyEntriesResult.data || []) as Array<{ entry_date: string; total_register: string | number | null }>;
        for (const de of dailyEntries) {
          const entryDate = String(de.entry_date).substring(0, 10);
          const totalRegister = Number(de.total_register) || 0;
          if (totalRegister <= 0 || datesWithBreakdown.has(entryDate)) continue;
          // No breakdown for this date — add total_register as same-day income
          const fallbackItem: SettledIncome = {
            settlement_date: entryDate,
            payment_method_id: "total_register",
            payment_method_name: "הכנסה יומית (קופה)",
            original_entry_date: entryDate,
            gross_amount: totalRegister,
            fee_amount: 0,
            net_amount: totalRegister,
          };
          const existing = settledMap.get(entryDate) || [];
          existing.push(fallbackItem);
          settledMap.set(entryDate, existing);
        }

        // 4. Apply overrides
        const overrides = overridesResult.data || [];
        const overrideMap = new Map<string, number>(); // key: "date|payment_method_id" → override_amount
        for (const ov of overrides) {
          overrideMap.set(`${ov.settlement_date}|${ov.payment_method_id}`, Number(ov.override_amount));
        }

        // 5. Build expense map by due_date
        const expensesByDate = new Map<string, ExpenseItem[]>();
        for (const split of (splitsResult.data || []) as Record<string, unknown>[]) {
          const dueDate = split.due_date as string;
          if (!dueDate) continue;
          const payment = split.payments as unknown as Record<string, unknown>;
          const supplier = payment?.suppliers as unknown as Record<string, unknown>;
          const item: ExpenseItem = {
            id: split.id as string,
            supplier_name: (supplier?.name as string) || "לא ידוע",
            amount: Number(split.amount) || 0,
            payment_method: (split.payment_method as string) || "other",
            due_date: dueDate,
          };
          const existing = expensesByDate.get(dueDate) || [];
          existing.push(item);
          expensesByDate.set(dueDate, existing);
        }

        // 6. Build daily data for the range
        const startD = new Date(openingDate + "T00:00:00");
        const endD = new Date(endDateStr + "T00:00:00");
        const days: DayData[] = [];
        let cumulative = openingBalance;

        for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
          const dateStr = formatLocalDate(d);

          // Income: get settled items for this date, apply overrides
          let incomeItems = settledMap.get(dateStr) || [];
          incomeItems = incomeItems.map((item) => {
            const overrideKey = `${dateStr}|${item.payment_method_id}`;
            if (overrideMap.has(overrideKey)) {
              const overrideAmt = overrideMap.get(overrideKey)!;
              return { ...item, net_amount: overrideAmt, fee_amount: item.gross_amount - overrideAmt };
            }
            return item;
          });

          // Add retainer forecast income (#36)
          const retainerItems = retainerByDate.get(dateStr) || [];
          for (const ri of retainerItems) {
            incomeItems = [...incomeItems, {
              settlement_date: dateStr,
              payment_method_id: "retainer",
              payment_method_name: ri.name,
              original_entry_date: dateStr,
              gross_amount: ri.amount,
              fee_amount: 0,
              net_amount: ri.amount,
            }];
          }

          // Expenses
          const expenseItems = expensesByDate.get(dateStr) || [];

          const totalIncome = incomeItems.reduce((sum, i) => sum + i.net_amount, 0);
          const totalExpenses = expenseItems.reduce((sum, e) => sum + e.amount, 0);
          const dailyDiff = totalIncome - totalExpenses;
          cumulative += dailyDiff;

          days.push({
            date: dateStr,
            incomeItems,
            expenseItems,
            totalIncome,
            totalExpenses,
            dailyDiff,
            cumulative,
          });
        }

        // 7. Group by month
        const monthMap = new Map<string, DayData[]>();
        for (const day of days) {
          const monthKey = day.date.substring(0, 7);
          const existing = monthMap.get(monthKey) || [];
          existing.push(day);
          monthMap.set(monthKey, existing);
        }

        const groups: MonthGroup[] = [];
        for (const [key, monthDays] of Array.from(monthMap.entries()).sort(([a], [b]) => a.localeCompare(b))) {
          const [y, m] = key.split("-");
          const totalIncome = monthDays.reduce((sum, d) => sum + d.totalIncome, 0);
          const totalExpenses = monthDays.reduce((sum, d) => sum + d.totalExpenses, 0);
          groups.push({
            key,
            label: `${hebrewMonths[parseInt(m, 10) - 1]} ${y}`,
            days: monthDays,
            totalIncome,
            totalExpenses,
            totalDiff: totalIncome - totalExpenses,
            endCumulative: monthDays[monthDays.length - 1].cumulative,
          });
        }

        setMonthGroups(groups);
      } catch (err) {
        console.error("Error fetching cash flow data:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [selectedBusinesses, endDate, refreshTrigger, supabase]);

  // ============================================================================
  // HANDLERS
  // ============================================================================
  const saveOpeningBalance = async () => {
    if (selectedBusinesses.length === 0) return;
    const balance = parseFloat(balanceInput.replace(/,/g, "")) || 0;
    const date = balanceDateInput || formatLocalDate(new Date());

    const { error } = await supabase.from("cashflow_settings").upsert({
      business_id: selectedBusinesses[0],
      opening_balance: balance,
      opening_date: date,
      updated_at: new Date().toISOString(),
    }, { onConflict: "business_id" });

    if (error) { console.error("saveOpeningBalance error:", error); return; }

    setEditingBalance(false);
    setRefreshTrigger((prev) => prev + 1);
  };

  const saveOverride = async () => {
    if (!overrideItem || selectedBusinesses.length === 0) return;
    const amount = parseFloat(overrideAmount.replace(/,/g, "")) || 0;

    const { error } = await supabase.from("cashflow_income_overrides").upsert({
      business_id: selectedBusinesses[0],
      settlement_date: overrideItem.date,
      payment_method_id: overrideItem.item.payment_method_id,
      original_amount: overrideItem.item.gross_amount,
      override_amount: amount,
      note: overrideNote || null,
    }, { onConflict: "business_id,settlement_date,payment_method_id" });

    if (error) { console.error("saveOverride error:", error); return; }

    setOverrideItem(null);
    setOverrideAmount("");
    setOverrideNote("");
    setRefreshTrigger((prev) => prev + 1);
  };

  const toggleMonth = (key: string) => {
    setExpandedMonths((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };

  const toggleDay = (dateStr: string) => {
    setExpandedDays((prev) => prev.includes(dateStr) ? prev.filter((k) => k !== dateStr) : [...prev, dateStr]);
  };

  const handleEndDateChange = (range: { start: Date; end: Date }) => {
    setEndDate(range.end);
    setSavedEndDate(range.end.toISOString());
  };

  // ============================================================================
  // COMPUTED
  // ============================================================================
  const totalIncome = monthGroups.reduce((sum, g) => sum + g.totalIncome, 0);
  const totalExpenses = monthGroups.reduce((sum, g) => sum + g.totalExpenses, 0);
  const netFlow = totalIncome - totalExpenses;
  const finalBalance = monthGroups.length > 0 ? monthGroups[monthGroups.length - 1].endCumulative : (settings?.opening_balance ? Number(settings.opening_balance) : 0);

  // ============================================================================
  // RENDER
  // ============================================================================
  if (selectedBusinesses.length === 0) {
    return (
      <article className="text-white p-[7px] pb-[80px]">
        <div className="bg-[#0F1535] rounded-[20px] p-[40px] text-center">
          <p className="text-[20px] text-white/70">יש לבחור עסק כדי לצפות בתזרים מזומנים</p>
        </div>
      </article>
    );
  }

  return (
    <article aria-label="תזרים מזומנים" className="text-white p-[7px] pb-[80px] flex flex-col gap-[10px]">

      {/* ============= HEADER ============= */}
      <section className="bg-[#0F1535] rounded-[10px] p-[10px] flex flex-col gap-[10px]">
        <div className="flex items-center justify-between flex-wrap gap-[10px]">
          {/* Opening balance */}
          <div className="flex items-center gap-[10px]">
            <div className="flex flex-col items-center">
              <span className="text-[12px] text-white/50">מצב בבנק תחילת פעילות</span>
              <button
                type="button"
                onClick={() => {
                  setBalanceInput(settings?.opening_balance?.toString() || "0");
                  setBalanceDateInput(settings?.opening_date ? String(settings.opening_date).substring(0, 10) : formatLocalDate(new Date()));
                  setEditingBalance(true);
                }}
                className="text-[20px] font-bold text-white hover:text-[#0095FF] transition-colors"
              >
                {formatCurrencyFull(settings?.opening_balance ? Number(settings.opening_balance) : 0)}
              </button>
              {settings?.opening_date && (
                <span className="text-[11px] text-white/40">{formatDisplayDate(settings.opening_date)}</span>
              )}
            </div>
          </div>

          {/* Date range picker */}
          <div className="flex items-center gap-[8px]">
            <span className="text-[13px] text-white/50 font-medium hidden sm:inline">צפי עד:</span>
            <DateRangePicker
              dateRange={{ start: new Date(settings?.opening_date || formatLocalDate(new Date())), end: endDate }}
              onChange={handleEndDateChange}
              variant="compact"
            />
          </div>
        </div>
      </section>

      {/* ============= SUMMARY CARDS ============= */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-[10px]">
        <div className="bg-[#0F1535] rounded-[10px] p-[15px] flex flex-col items-center gap-[5px]">
          <span className="text-[13px] text-white/60">סה&quot;כ הכנסות</span>
          {isLoading ? (
            <div className="h-[28px] w-[80px] bg-white/10 rounded animate-pulse" />
          ) : (
            <span className="text-[22px] font-bold text-[#17DB4E]">{formatCurrencyFull(totalIncome)}</span>
          )}
        </div>
        <div className="bg-[#0F1535] rounded-[10px] p-[15px] flex flex-col items-center gap-[5px]">
          <span className="text-[13px] text-white/60">סה&quot;כ הוצאות</span>
          {isLoading ? (
            <div className="h-[28px] w-[80px] bg-white/10 rounded animate-pulse" />
          ) : (
            <span className="text-[22px] font-bold text-[#F64E60]">{formatCurrencyFull(totalExpenses)}</span>
          )}
        </div>
        <div className="bg-[#0F1535] rounded-[10px] p-[15px] flex flex-col items-center gap-[5px]">
          <span className="text-[13px] text-white/60">הפרש נקי</span>
          {isLoading ? (
            <div className="h-[28px] w-[80px] bg-white/10 rounded animate-pulse" />
          ) : (
            <span className={`text-[22px] font-bold ${netFlow >= 0 ? "text-[#17DB4E]" : "text-[#F64E60]"}`}>
              {formatCurrencyFull(netFlow)}
            </span>
          )}
        </div>
        <div className="bg-[#0F1535] rounded-[10px] p-[15px] flex flex-col items-center gap-[5px]">
          <span className="text-[13px] text-white/60">צפי תזרים סופי</span>
          {isLoading ? (
            <div className="h-[28px] w-[80px] bg-white/10 rounded animate-pulse" />
          ) : (
            <span className={`text-[22px] font-bold ${finalBalance >= 0 ? "text-[#17DB4E]" : "text-[#F64E60]"}`}>
              {formatCurrencyFull(finalBalance)}
            </span>
          )}
        </div>
      </section>

      {/* ============= MAIN TABLE ============= */}
      <section className="bg-[#0F1535] rounded-[10px] p-[7px]">
        {/* Table Header */}
        <div className="flex items-center gap-[5px] bg-[#29318A] rounded-t-[7px] p-[5px_3px] pe-[13px] mb-[10px]">
          <div className="w-[70px] sm:w-[90px] flex-shrink-0 text-center">
            <span className="text-[13px] sm:text-[14px]">תאריך</span>
          </div>
          <span className="text-[13px] sm:text-[14px] flex-1 text-center min-w-0">הכנסות</span>
          <span className="text-[13px] sm:text-[14px] flex-1 text-center min-w-0">הוצאות</span>
          <span className="text-[13px] sm:text-[14px] w-[60px] sm:w-[75px] flex-shrink-0 text-center">
            <span className="sm:hidden">הפרש</span>
            <span className="hidden sm:inline">הפרש יומי</span>
          </span>
          <span className="text-[13px] sm:text-[14px] w-[60px] sm:w-[75px] flex-shrink-0 text-center">
            <span className="sm:hidden">תזרים</span>
            <span className="hidden sm:inline">צפי תזרים</span>
          </span>
        </div>

        {/* Loading */}
        {isLoading ? (
          <div className="flex flex-col gap-[5px] p-[10px]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-[45px] bg-white/5 rounded animate-pulse" />
            ))}
          </div>
        ) : monthGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-[40px] gap-[10px]">
            <span className="text-[16px] text-white/50">אין נתונים להצגה</span>
            {!settings && (
              <Button
                onClick={() => {
                  setBalanceInput("0");
                  setBalanceDateInput(formatLocalDate(new Date()));
                  setEditingBalance(true);
                }}
                className="bg-[#4956D4] text-white text-[14px] px-[20px] py-[10px] rounded-[8px]"
              >
                הגדר יתרת פתיחה
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col">
            {/* Month Groups */}
            {monthGroups.map((month) => (
              <div key={month.key}>
                {/* Level 1: Month Header */}
                <Button
                  type="button"
                  onClick={() => toggleMonth(month.key)}
                  className={`flex items-center w-full min-h-[50px] p-[8px] pe-[13px] gap-[5px] border-b-2 border-white/15 hover:bg-[#29318A]/30 transition-all cursor-pointer ${
                    expandedMonths.includes(month.key) ? "rounded-t-[10px]" : ""
                  }`}
                >
                  <div className="flex items-center gap-[5px] w-[70px] sm:w-[90px] flex-shrink-0">
                    <svg
                      width="16" height="16" viewBox="0 0 32 32" fill="none"
                      className={`flex-shrink-0 transition-transform ${expandedMonths.includes(month.key) ? "rotate-180" : ""}`}
                    >
                      <path d="M8 12L16 20L24 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="text-[13px] sm:text-[14px] font-bold text-right">{month.label}</span>
                  </div>
                  <span className="text-[13px] font-bold flex-1 text-center min-w-0 text-[#17DB4E]">
                    {formatCurrencyFull(month.totalIncome)}
                  </span>
                  <span className="text-[13px] font-bold flex-1 text-center min-w-0 text-[#F64E60]">
                    {formatCurrencyFull(month.totalExpenses)}
                  </span>
                  <span className={`text-[13px] font-bold w-[60px] sm:w-[75px] flex-shrink-0 text-center ${month.totalDiff >= 0 ? "text-[#17DB4E]" : "text-[#F64E60]"}`}>
                    {formatCurrencyFull(month.totalDiff)}
                  </span>
                  <span className={`text-[13px] font-bold w-[60px] sm:w-[75px] flex-shrink-0 text-center ${month.endCumulative >= 0 ? "text-[#17DB4E]" : "text-[#F64E60]"}`}>
                    {formatCurrencyFull(month.endCumulative)}
                  </span>
                </Button>

                {/* Level 2: Daily Rows (expanded month) */}
                {expandedMonths.includes(month.key) && (
                  <div className="bg-[#232B6A] rounded-b-[10px] mb-[5px]">
                    {month.days.map((day, dayIndex) => (
                      <div key={day.date}>
                        <Button
                          type="button"
                          onClick={() => toggleDay(day.date)}
                          className={`flex items-center w-full min-h-[42px] p-[8px] pe-[13px] gap-[5px] hover:bg-white/5 transition-all cursor-pointer ${
                            dayIndex < month.days.length - 1 && !expandedDays.includes(day.date) ? "border-b border-white/10" : ""
                          }`}
                        >
                          <div className="flex items-center gap-[5px] w-[70px] sm:w-[90px] flex-shrink-0">
                            <svg
                              width="12" height="12" viewBox="0 0 32 32" fill="none"
                              className={`flex-shrink-0 transition-transform text-white/40 ${expandedDays.includes(day.date) ? "rotate-180" : ""}`}
                            >
                              <path d="M8 12L16 20L24 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <span className="text-[12px] font-medium text-right text-white/80">{formatDayLabel(day.date)}</span>
                          </div>
                          <span className={`text-[12px] font-medium flex-1 text-center min-w-0 ${day.totalIncome > 0 ? "text-[#17DB4E]" : "text-white/30"}`}>
                            {day.totalIncome > 0 ? formatCurrencyFull(day.totalIncome) : "-"}
                          </span>
                          <span className={`text-[12px] font-medium flex-1 text-center min-w-0 ${day.totalExpenses > 0 ? "text-[#F64E60]" : "text-white/30"}`}>
                            {day.totalExpenses > 0 ? formatCurrencyFull(day.totalExpenses) : "-"}
                          </span>
                          <span className={`text-[12px] font-medium w-[60px] sm:w-[75px] flex-shrink-0 text-center ${day.dailyDiff > 0 ? "text-[#17DB4E]" : day.dailyDiff < 0 ? "text-[#F64E60]" : "text-white/30"}`}>
                            {day.dailyDiff !== 0 ? formatCurrencyFull(day.dailyDiff) : "-"}
                          </span>
                          <span className={`text-[12px] font-bold w-[60px] sm:w-[75px] flex-shrink-0 text-center ${day.cumulative >= 0 ? "text-[#17DB4E]" : "text-[#F64E60]"}`}>
                            {formatCurrencyFull(day.cumulative)}
                          </span>
                        </Button>

                        {/* Level 3: Individual Items (expanded day) */}
                        {expandedDays.includes(day.date) && (
                          <div className="bg-[#141A40] border-b border-white/10">
                            {/* Income items */}
                            {day.incomeItems.length > 0 && (
                              <div className="p-[8px]">
                                <span className="text-[11px] text-[#17DB4E]/70 font-semibold">הכנסות</span>
                                {day.incomeItems.map((item, idx) => (
                                  <button
                                    key={`inc-${idx}`}
                                    type="button"
                                    onClick={() => {
                                      setOverrideItem({ date: day.date, item });
                                      setOverrideAmount(String(Math.round(item.net_amount)));
                                      setOverrideNote("");
                                    }}
                                    className="flex items-center justify-between w-full py-[4px] hover:bg-white/5 rounded px-[4px] transition-colors"
                                  >
                                    <div className="flex items-center gap-[6px]">
                                      <span className="text-[12px] text-white/80">{item.payment_method_name}</span>
                                      {item.fee_amount > 0 && (
                                        <span className="text-[10px] text-white/30">(-{formatCurrencyFull(item.fee_amount)} עמלה)</span>
                                      )}
                                    </div>
                                    <span className="text-[12px] font-bold text-[#17DB4E]">{formatCurrencyFull(item.net_amount)}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {/* Expense items */}
                            {day.expenseItems.length > 0 && (
                              <div className="p-[8px] border-t border-white/5">
                                <span className="text-[11px] text-[#F64E60]/70 font-semibold">הוצאות</span>
                                {day.expenseItems.map((item) => (
                                  <div
                                    key={item.id}
                                    className="flex items-center justify-between py-[4px] px-[4px]"
                                  >
                                    <div className="flex items-center gap-[6px]">
                                      <span className="text-[12px] text-white/80">{item.supplier_name}</span>
                                      <span className="text-[10px] text-white/30">{paymentMethodNames[item.payment_method] || item.payment_method}</span>
                                    </div>
                                    <span className="text-[12px] font-bold text-[#F64E60]">{formatCurrencyFull(item.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* Empty day */}
                            {day.incomeItems.length === 0 && day.expenseItems.length === 0 && (
                              <div className="p-[8px] text-center">
                                <span className="text-[12px] text-white/30">אין תנועות</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Totals Row */}
            <div className="flex items-center min-h-[50px] p-[8px] pe-[13px] gap-[5px] border-t-2 border-white/20 bg-white/5 rounded-b-[8px]">
              <span className="text-[14px] font-bold w-[70px] sm:w-[90px] flex-shrink-0 text-center">סה&quot;כ</span>
              <span className="text-[14px] font-bold flex-1 text-center min-w-0 text-[#17DB4E]">
                {formatCurrencyFull(totalIncome)}
              </span>
              <span className="text-[14px] font-bold flex-1 text-center min-w-0 text-[#F64E60]">
                {formatCurrencyFull(totalExpenses)}
              </span>
              <span className={`text-[14px] font-bold w-[60px] sm:w-[75px] flex-shrink-0 text-center ${netFlow >= 0 ? "text-[#17DB4E]" : "text-[#F64E60]"}`}>
                {formatCurrencyFull(netFlow)}
              </span>
              <span className={`text-[14px] font-bold w-[60px] sm:w-[75px] flex-shrink-0 text-center ${finalBalance >= 0 ? "text-[#17DB4E]" : "text-[#F64E60]"}`}>
                {formatCurrencyFull(finalBalance)}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ============= OPENING BALANCE DIALOG ============= */}
      <Dialog open={editingBalance} onOpenChange={setEditingBalance}>
        <DialogContent className="bg-[#0F1535] border-white/10 text-white sm:max-w-[380px]" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right text-[18px]">מצב בבנק תחילת פעילות</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-[14px] mt-[10px]">
            <div className="flex flex-col gap-[6px]">
              <label className="text-[13px] text-white/60 text-right">יתרה (₪)</label>
              <Input
                type="text"
                value={balanceInput}
                onChange={(e) => setBalanceInput(e.target.value)}
                placeholder="0"
                className="bg-[#232B6A] border-white/10 text-white text-center h-[40px] text-[18px] font-bold"
              />
            </div>
            <div className="flex flex-col gap-[6px]">
              <label className="text-[13px] text-white/60 text-right">תאריך</label>
              <DatePickerField
                value={balanceDateInput}
                onChange={(val) => setBalanceDateInput(val)}
                className="h-[40px] text-[14px]"
              />
            </div>
            <div className="flex gap-[10px] mt-[6px]">
              <Button
                onClick={saveOpeningBalance}
                className="flex-1 bg-[#4956D4] text-white text-[14px] font-semibold py-[10px] rounded-[8px]"
              >
                שמור
              </Button>
              <Button
                variant="ghost"
                onClick={() => setEditingBalance(false)}
                className="flex-1 text-white/60 text-[14px] py-[10px] rounded-[8px]"
              >
                ביטול
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============= INCOME OVERRIDE DIALOG ============= */}
      <Dialog open={!!overrideItem} onOpenChange={(v) => !v && setOverrideItem(null)}>
        <DialogContent className="bg-[#0F1535] border-white/10 text-white sm:max-w-[380px]" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right text-[18px]">עריכת הכנסה</DialogTitle>
          </DialogHeader>
          {overrideItem && (
            <div className="flex flex-col gap-[14px] mt-[10px]">
              <div className="flex flex-col gap-[4px]">
                <span className="text-[13px] text-white/60">אמצעי תשלום: {overrideItem.item.payment_method_name}</span>
                <span className="text-[13px] text-white/60">תאריך מקורי: {formatDisplayDate(overrideItem.item.original_entry_date)}</span>
                <span className="text-[13px] text-white/60">סכום מחושב: {formatCurrencyFull(overrideItem.item.gross_amount)}</span>
              </div>
              <div className="flex flex-col gap-[6px]">
                <label className="text-[13px] text-white/60 text-right">סכום בפועל (₪)</label>
                <Input
                  type="text"
                  value={overrideAmount}
                  onChange={(e) => setOverrideAmount(e.target.value)}
                  className="bg-[#232B6A] border-white/10 text-white text-center h-[40px] text-[18px] font-bold"
                />
              </div>
              <div className="flex flex-col gap-[6px]">
                <label className="text-[13px] text-white/60 text-right">הערה (אופציונלי)</label>
                <Input
                  type="text"
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                  placeholder="למשל: מבצע 5% על חלק מהעסקאות"
                  className="bg-[#232B6A] border-white/10 text-white text-right h-[40px]"
                />
              </div>
              <div className="flex gap-[10px] mt-[6px]">
                <Button
                  onClick={saveOverride}
                  className="flex-1 bg-[#4956D4] text-white text-[14px] font-semibold py-[10px] rounded-[8px]"
                >
                  שמור
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setOverrideItem(null)}
                  className="flex-1 text-white/60 text-[14px] py-[10px] rounded-[8px]"
                >
                  ביטול
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </article>
  );
}
