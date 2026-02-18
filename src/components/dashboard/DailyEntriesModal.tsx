"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useDashboard } from "@/app/(dashboard)/layout";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useFormDraft } from "@/hooks/useFormDraft";

interface DailyEntry {
  id: string;
  entry_date: string;
  total_register: number;
  labor_cost: number;
  labor_hours: number;
  discounts: number;
  waste: number;
  day_factor: number;
  notes: string | null;
}

interface IncomeBreakdown {
  income_source_id: string;
  income_source_name: string;
  amount: number;
  orders_count: number;
}

interface ProductUsage {
  product_id: string;
  product_name: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  opening_stock: number;
  received_quantity: number;
  closing_stock: number;
}

// Types for dynamic edit form data
interface IncomeSource {
  id: string;
  name: string;
}

interface ReceiptType {
  id: string;
  name: string;
}

interface CustomParameter {
  id: string;
  name: string;
}

interface ManagedProduct {
  id: string;
  name: string;
  unit: string;
  unit_cost: number;
}

interface IncomeData {
  amount: string;
  orders_count: string;
}

interface ProductUsageData {
  opening_stock: string;
  received_quantity: string;
  closing_stock: string;
}

// Goals/targets data for Section 2
interface GoalsData {
  revenueTarget: number;
  laborCostTargetPct: number;
  foodCostTargetPct: number;
  currentExpensesTarget: number;
  vatPercentage: number;
  incomeSourceTargets: Record<string, number>; // income_source_id -> avg_ticket_target
  productTargetPcts: Record<string, number>; // product_id -> target_pct
  workDaysInMonth: number; // calculated from business_schedules
  managerDailyCost: number; // manager_monthly_salary / workDaysInMonth
  markupPercentage: number; // markup multiplier (e.g. 1.18)
}

// Monthly cumulative data for Section 3
interface MonthlyCumulativeData {
  totalIncome: number;
  incomeBeforeVat: number;
  laborCost: number;
  laborCostPct: number;
  incomeSourceTotals: Record<string, { amount: number; ordersCount: number; avgTicket: number }>;
  productCosts: Record<string, { totalCost: number; costPct: number }>;
  foodCostPct: number;
  currentExpenses: number;
  currentExpensesPct: number;
  actualWorkDays: number;
}

interface DailyEntriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  businessId: string;
  businessName: string;
  dateRange: { start: Date; end: Date };
}

export function DailyEntriesModal({
  isOpen,
  onClose,
  businessId,
  businessName,
  dateRange,
}: DailyEntriesModalProps) {
  const { showToast } = useToast();
  const { isAdmin } = useDashboard();

  // Draft persistence for edit form
  const { saveDraft, restoreDraft, clearDraft } = useFormDraft(`dailyEntriesEdit:draft:${businessId}`);
  const draftRestored = useRef(false);

  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [entryDetails, setEntryDetails] = useState<{
    incomeBreakdown: IncomeBreakdown[];
    productUsage: ProductUsage[];
  } | null>(null);
  const [goalsData, setGoalsData] = useState<GoalsData | null>(null);
  const [monthlyCumulative, setMonthlyCumulative] = useState<MonthlyCumulativeData | null>(null);
  const [openPaymentsTotal, setOpenPaymentsTotal] = useState<number>(0);
  const [openSuppliersTotal, setOpenSuppliersTotal] = useState<number>(0);
  const [openCommitmentsTotal, setOpenCommitmentsTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DailyEntry | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Edit form state - basic fields
  const [editFormData, setEditFormData] = useState({
    entry_date: "",
    total_register: "",
    labor_cost: "",
    labor_hours: "",
    discounts: "",
    day_factor: "1",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isLoadingEditData, setIsLoadingEditData] = useState(false);

  // Dynamic data for edit form
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([]);
  const [receiptTypes, setReceiptTypes] = useState<ReceiptType[]>([]);
  const [customParameters, setCustomParameters] = useState<CustomParameter[]>([]);
  const [managedProducts, setManagedProducts] = useState<ManagedProduct[]>([]);

  // Edit form dynamic state
  const [incomeData, setIncomeData] = useState<Record<string, IncomeData>>({});
  const [receiptData, setReceiptData] = useState<Record<string, string>>({});
  const [parameterData, setParameterData] = useState<Record<string, string>>({});
  const [productUsageForm, setProductUsageForm] = useState<Record<string, ProductUsageData>>({});

  // Admin calculated fields
  const [monthlyMarkup, setMonthlyMarkup] = useState<number>(1);
  const [managerMonthlySalary, setManagerMonthlySalary] = useState<number>(0);
  const [workingDaysUpToDate, setWorkingDaysUpToDate] = useState<number>(0);

  // Save draft on edit form changes
  const saveDraftData = useCallback(() => {
    if (editingEntry) {
      saveDraft({
        editingEntryId: editingEntry.id,
        editFormData, incomeData, receiptData, parameterData, productUsageForm,
      });
    }
  }, [saveDraft, editingEntry, editFormData, incomeData, receiptData, parameterData, productUsageForm]);

  useEffect(() => {
    if (draftRestored.current && editingEntry) {
      saveDraftData();
    }
  }, [saveDraftData, editingEntry]);

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  };

  // Format percentage without trailing zeros (e.g., 1.0% → 1%, 7.00% → 7%, 39.63% → 39.63%)
  const formatPercent = (value: number, decimals = 2) => {
    return `${parseFloat(value.toFixed(decimals))}%`;
  };

  // Format currency
  const formatCurrency = (amount: number) => {
    const abs = Math.abs(amount);
    const formatted = abs.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return amount < 0 ? `-₪${formatted}` : `₪${formatted}`;
  };

  // Get month and year for header
  const getMonthYear = () => {
    const months = [
      "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
      "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"
    ];
    const month = months[dateRange.start.getMonth()];
    const year = dateRange.start.getFullYear();
    return `חודש ${month}, ${year}`;
  };

  // Fetch entries
  useEffect(() => {
    if (!isOpen || !businessId) return;

    const fetchEntries = async () => {
      setIsLoading(true);
      const supabase = createClient();

      const formatLocalDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };

      const { data, error } = await supabase
        .from("daily_entries")
        .select("*")
        .eq("business_id", businessId)
        .gte("entry_date", formatLocalDate(dateRange.start))
        .lte("entry_date", formatLocalDate(dateRange.end))
        .is("deleted_at", null)
        .order("entry_date", { ascending: false });

      if (!error && data) {
        setEntries(data);
      }
      setIsLoading(false);
    };

    fetchEntries();
  }, [isOpen, businessId, dateRange, refreshTrigger]);

  // Load dynamic options for edit form
  const loadEditFormOptions = async () => {
    const supabase = createClient();

    const [
      { data: sources },
      { data: receipts },
      { data: parameters },
      { data: products },
    ] = await Promise.all([
      supabase
        .from("income_sources")
        .select("id, name")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("display_order"),
      supabase
        .from("receipt_types")
        .select("id, name")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("display_order"),
      supabase
        .from("custom_parameters")
        .select("id, name")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("display_order"),
      supabase
        .from("managed_products")
        .select("id, name, unit, unit_cost")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("name"),
    ]);

    setIncomeSources(sources || []);
    setReceiptTypes(receipts || []);
    setCustomParameters(parameters || []);
    setManagedProducts(products || []);

    // Initialize empty form state
    const initialIncome: Record<string, IncomeData> = {};
    (sources || []).forEach((s) => {
      initialIncome[s.id] = { amount: "", orders_count: "" };
    });
    setIncomeData(initialIncome);

    const initialReceipts: Record<string, string> = {};
    (receipts || []).forEach((r) => {
      initialReceipts[r.id] = "";
    });
    setReceiptData(initialReceipts);

    const initialParams: Record<string, string> = {};
    (parameters || []).forEach((p) => {
      initialParams[p.id] = "";
    });
    setParameterData(initialParams);

    const initialProducts: Record<string, ProductUsageData> = {};
    (products || []).forEach((p) => {
      initialProducts[p.id] = {
        opening_stock: "",
        received_quantity: "",
        closing_stock: "",
      };
    });
    setProductUsageForm(initialProducts);
  };

  // Load existing entry data for editing
  const loadExistingEntryData = async (entryId: string) => {
    const supabase = createClient();

    // Load income breakdown
    const { data: incomeBreakdownData } = await supabase
      .from("daily_income_breakdown")
      .select("income_source_id, amount, orders_count")
      .eq("daily_entry_id", entryId);

    if (incomeBreakdownData) {
      const existingIncome: Record<string, IncomeData> = {};
      incomeBreakdownData.forEach((b) => {
        existingIncome[b.income_source_id] = {
          amount: b.amount?.toString() || "",
          orders_count: b.orders_count?.toString() || "",
        };
      });
      setIncomeData((prev) => ({ ...prev, ...existingIncome }));
    }

    // Load receipts
    const { data: receiptsData } = await supabase
      .from("daily_receipts")
      .select("receipt_type_id, amount")
      .eq("daily_entry_id", entryId);

    if (receiptsData) {
      const existingReceipts: Record<string, string> = {};
      receiptsData.forEach((r) => {
        existingReceipts[r.receipt_type_id] = r.amount?.toString() || "";
      });
      setReceiptData((prev) => ({ ...prev, ...existingReceipts }));
    }

    // Load parameters
    const { data: parametersData } = await supabase
      .from("daily_parameters")
      .select("parameter_id, value")
      .eq("daily_entry_id", entryId);

    if (parametersData) {
      const existingParams: Record<string, string> = {};
      parametersData.forEach((p) => {
        existingParams[p.parameter_id] = p.value?.toString() || "";
      });
      setParameterData((prev) => ({ ...prev, ...existingParams }));
    }

    // Load product usage
    const { data: productUsageData } = await supabase
      .from("daily_product_usage")
      .select("product_id, opening_stock, received_quantity, closing_stock")
      .eq("daily_entry_id", entryId);

    if (productUsageData) {
      const existingUsage: Record<string, ProductUsageData> = {};
      productUsageData.forEach((p) => {
        existingUsage[p.product_id] = {
          opening_stock: p.opening_stock?.toString() || "",
          received_quantity: p.received_quantity?.toString() || "",
          closing_stock: p.closing_stock?.toString() || "",
        };
      });
      setProductUsageForm((prev) => ({ ...prev, ...existingUsage }));
    }
  };

  // Handle edit - load entry data into form
  const handleEdit = async (entry: DailyEntry) => {
    setEditingEntry(entry);
    setEditFormData({
      entry_date: entry.entry_date,
      total_register: entry.total_register.toString(),
      labor_cost: entry.labor_cost.toString(),
      labor_hours: entry.labor_hours.toString(),
      discounts: entry.discounts.toString(),
      day_factor: entry.day_factor.toString(),
    });
    setEditError(null);
    setIsLoadingEditData(true);

    try {
      await loadEditFormOptions();
      await loadExistingEntryData(entry.id);

      // Load admin calculated fields
      if (isAdmin) {
        const supabase = createClient();
        const entryDate = new Date(entry.entry_date);
        const year = entryDate.getFullYear();
        const month = entryDate.getMonth() + 1;

        // Load markup from goals or business fallback
        const { data: goalSetting } = await supabase
          .from("goals")
          .select("markup_percentage")
          .eq("business_id", businessId)
          .eq("year", year)
          .eq("month", month)
          .is("deleted_at", null)
          .maybeSingle();

        if (goalSetting?.markup_percentage != null) {
          setMonthlyMarkup(Number(goalSetting.markup_percentage));
        } else {
          const { data: biz } = await supabase.from("businesses").select("markup_percentage").eq("id", businessId).maybeSingle();
          setMonthlyMarkup(biz ? Number(biz.markup_percentage) : 1);
        }

        // Load manager salary
        const { data: biz2 } = await supabase.from("businesses").select("manager_monthly_salary").eq("id", businessId).maybeSingle();
        setManagerMonthlySalary(biz2 ? Number(biz2.manager_monthly_salary) : 0);

        // Count working days up to entry date
        const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
        const { count } = await supabase.from("daily_entries").select("id", { count: "exact", head: true })
          .eq("business_id", businessId).gte("entry_date", firstOfMonth).lte("entry_date", entry.entry_date);
        setWorkingDaysUpToDate(count || 0);
      }

      // Restore draft if exists for this entry
      draftRestored.current = false;
      setTimeout(() => {
        const draft = restoreDraft();
        if (draft && draft.editingEntryId === entry.id) {
          if (draft.editFormData) setEditFormData(draft.editFormData as typeof editFormData);
          if (draft.incomeData) setIncomeData(draft.incomeData as Record<string, IncomeData>);
          if (draft.receiptData) setReceiptData(draft.receiptData as Record<string, string>);
          if (draft.parameterData) setParameterData(draft.parameterData as Record<string, string>);
          if (draft.productUsageForm) setProductUsageForm(draft.productUsageForm as Record<string, ProductUsageData>);
        }
        draftRestored.current = true;
      }, 0);
    } catch (err) {
      console.error("Error loading edit data:", err);
      setEditError("שגיאה בטעינת הנתונים");
    } finally {
      setIsLoadingEditData(false);
    }
  };

  // Cancel edit
  const handleCancelEdit = () => {
    setEditingEntry(null);
    setEditError(null);
  };

  // Save edit
  const handleSaveEdit = async () => {
    if (!editingEntry) return;

    setIsSubmitting(true);
    setEditError(null);

    try {
      const supabase = createClient();
      const dailyEntryId = editingEntry.id;

      // Calculate manager daily cost for saving
      const saveLaborCost = parseFloat(editFormData.labor_cost) || 0;
      const saveEntryDate = editFormData.entry_date ? new Date(editFormData.entry_date) : new Date();
      const saveDaysInMonth = new Date(saveEntryDate.getFullYear(), saveEntryDate.getMonth() + 1, 0).getDate();
      const saveManagerDailyCost = saveDaysInMonth > 0
        ? (managerMonthlySalary / saveDaysInMonth) * workingDaysUpToDate * monthlyMarkup
        : 0;

      // Update main daily entry
      const { error: updateError } = await supabase
        .from("daily_entries")
        .update({
          entry_date: editFormData.entry_date,
          total_register: parseFloat(editFormData.total_register) || 0,
          labor_cost: saveLaborCost,
          labor_hours: parseFloat(editFormData.labor_hours) || 0,
          discounts: parseFloat(editFormData.discounts) || 0,
          day_factor: parseFloat(editFormData.day_factor) || 1,
          manager_daily_cost: saveManagerDailyCost,
          updated_at: new Date().toISOString(),
        })
        .eq("id", dailyEntryId);

      if (updateError) {
        if (updateError.code === "23505") {
          throw new Error("כבר קיים רישום לתאריך זה");
        }
        throw updateError;
      }

      // Delete existing related data before re-inserting
      await Promise.all([
        supabase.from("daily_income_breakdown").delete().eq("daily_entry_id", dailyEntryId),
        supabase.from("daily_receipts").delete().eq("daily_entry_id", dailyEntryId),
        supabase.from("daily_parameters").delete().eq("daily_entry_id", dailyEntryId),
        supabase.from("daily_product_usage").delete().eq("daily_entry_id", dailyEntryId),
      ]);

      // Save income sources (amount + orders_count)
      for (const source of incomeSources) {
        const data = incomeData[source.id];
        const amount = parseFloat(data?.amount) || 0;
        const ordersCount = parseInt(data?.orders_count) || 0;

        if (amount > 0 || ordersCount > 0) {
          const { error } = await supabase.from("daily_income_breakdown").insert({
            daily_entry_id: dailyEntryId,
            income_source_id: source.id,
            amount,
            orders_count: ordersCount,
          });
          if (error) throw error;
        }
      }

      // Save receipts (amount only)
      for (const receipt of receiptTypes) {
        const amount = parseFloat(receiptData[receipt.id]) || 0;

        if (amount > 0) {
          const { error } = await supabase.from("daily_receipts").insert({
            daily_entry_id: dailyEntryId,
            receipt_type_id: receipt.id,
            amount,
          });
          if (error) throw error;
        }
      }

      // Save custom parameters (value only)
      for (const param of customParameters) {
        const value = parseFloat(parameterData[param.id]) || 0;

        if (value > 0) {
          const { error } = await supabase.from("daily_parameters").insert({
            daily_entry_id: dailyEntryId,
            parameter_id: param.id,
            value,
          });
          if (error) throw error;
        }
      }

      // Save managed products usage
      for (const product of managedProducts) {
        const usage = productUsageForm[product.id];
        if (usage) {
          const openingStock = parseFloat(usage.opening_stock) || 0;
          const receivedQty = parseFloat(usage.received_quantity) || 0;
          const closingStock = parseFloat(usage.closing_stock) || 0;

          if (openingStock > 0 || receivedQty > 0 || closingStock > 0) {
            const quantityUsed = openingStock + receivedQty - closingStock;

            const { error: usageError } = await supabase
              .from("daily_product_usage")
              .insert({
                daily_entry_id: dailyEntryId,
                product_id: product.id,
                opening_stock: openingStock,
                received_quantity: receivedQty,
                closing_stock: closingStock,
                quantity: quantityUsed,
                unit_cost_at_time: product.unit_cost,
              });

            if (usageError) throw usageError;

            // Update current_stock
            await supabase
              .from("managed_products")
              .update({ current_stock: closingStock })
              .eq("id", product.id);
          }
        }
      }

      // Success - close form and refresh
      clearDraft();
      setEditingEntry(null);
      setRefreshTrigger((prev) => prev + 1);
      showToast("הנתונים עודכנו בהצלחה", "success");
    } catch (err) {
      console.error("Error updating entry:", err);
      setEditError(err instanceof Error ? err.message : "שגיאה בעדכון הנתונים");
      showToast(err instanceof Error ? err.message : "שגיאה בעדכון הנתונים", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Fetch entry details when expanded - includes goals + monthly cumulative
  const fetchEntryDetails = async (entryId: string) => {
    setIsLoadingDetails(true);
    const supabase = createClient();

    // Find the entry to get its date
    const currentEntry = entries.find(e => e.id === entryId);
    const entryDate = currentEntry ? new Date(currentEntry.entry_date) : dateRange.start;
    const year = entryDate.getFullYear();
    const month = entryDate.getMonth() + 1;
    const monthStr = String(month).padStart(2, "0");
    const firstOfMonth = `${year}-${monthStr}-01`;
    const lastOfMonth = `${year}-${monthStr}-${new Date(year, month, 0).getDate()}`;

    // Parallel fetch: entry details + goals + monthly data
    const [
      { data: breakdownData },
      { data: usageData },
      { data: goalData },
      { data: businessData },
      { data: monthlyEntries },
      { data: _monthlyBreakdowns },
      { data: _monthlyProductUsage },
      { data: incomeSourceGoalsData },
      { data: managedProductsData },
      { data: monthlyInvoices },
      { data: scheduleData },
      { data: currentExpBudgetData },
      { data: openPaymentsData },
      { data: allInvoicesData },
      { data: allPaymentsData },
      { data: allCommitmentSplitsData },
      { data: paidCommitmentSplitsData },
    ] = await Promise.all([
      // 1. Entry income breakdown
      supabase
        .from("daily_income_breakdown")
        .select(`income_source_id, amount, orders_count, income_sources (name)`)
        .eq("daily_entry_id", entryId),
      // 2. Entry product usage
      supabase
        .from("daily_product_usage")
        .select(`product_id, quantity, unit_cost_at_time, opening_stock, received_quantity, closing_stock, managed_products (name, unit)`)
        .eq("daily_entry_id", entryId),
      // 3. Goals for this month
      supabase
        .from("goals")
        .select("id, revenue_target, labor_cost_target_pct, food_cost_target_pct, current_expenses_target, vat_percentage, markup_percentage")
        .eq("business_id", businessId)
        .eq("year", year)
        .eq("month", month)
        .is("deleted_at", null)
        .maybeSingle(),
      // 4. Business fallback for VAT
      supabase
        .from("businesses")
        .select("vat_percentage, markup_percentage, manager_monthly_salary")
        .eq("id", businessId)
        .maybeSingle(),
      // 5. All month entries for cumulative
      supabase
        .from("daily_entries")
        .select("id, total_register, labor_cost, labor_hours, day_factor")
        .eq("business_id", businessId)
        .gte("entry_date", firstOfMonth)
        .lte("entry_date", lastOfMonth)
        .is("deleted_at", null),
      // 6. All month income breakdowns - placeholder, fetched after monthly entries
      Promise.resolve({ data: [] as Record<string, unknown>[] }),
      // 7. All month product usage - placeholder, fetched after monthly entries
      Promise.resolve({ data: [] as Record<string, unknown>[] }),
      // 8. Income source goals - placeholder, fetched after goals
      Promise.resolve({ data: [] as { income_source_id: string; avg_ticket_target: number }[] }),
      // 9. Managed products with target_pct
      supabase
        .from("managed_products")
        .select("id, target_pct")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .is("deleted_at", null),
      // 10. Monthly invoices for food cost / current expenses
      supabase
        .from("invoices")
        .select("subtotal, suppliers!inner(expense_type)")
        .eq("business_id", businessId)
        .gte("invoice_date", firstOfMonth)
        .lte("invoice_date", lastOfMonth)
        .is("deleted_at", null),
      // 11. Business schedule for working days calculation
      supabase
        .from("business_schedule")
        .select("day_of_week, day_factor")
        .eq("business_id", businessId),
      // 12. Current expenses supplier budgets total
      supabase
        .from("supplier_budgets")
        .select("budget_amount, suppliers!inner(expense_type)")
        .eq("business_id", businessId)
        .eq("year", year)
        .eq("month", month)
        .eq("suppliers.expense_type", "current_expenses")
        .is("deleted_at", null),
      // 13. Open payments - payment splits with due_date > entry date
      supabase
        .from("payment_splits")
        .select("amount, payments!inner(business_id, deleted_at)")
        .eq("payments.business_id", businessId)
        .is("payments.deleted_at", null)
        .gt("due_date", currentEntry?.entry_date || ""),
      // 14. All invoices total (for open suppliers calculation)
      supabase
        .from("invoices")
        .select("total_amount")
        .eq("business_id", businessId)
        .is("deleted_at", null),
      // 15. All payments total (for open suppliers calculation)
      supabase
        .from("payments")
        .select("total_amount")
        .eq("business_id", businessId)
        .is("deleted_at", null),
      // 16. All commitment splits (installments_count > 3) - total obligations
      supabase
        .from("payment_splits")
        .select("amount, installments_count, payments!inner(business_id, deleted_at)")
        .eq("payments.business_id", businessId)
        .is("payments.deleted_at", null)
        .gt("installments_count", 3),
      // 17. Paid commitment splits (due_date <= entry date) - already paid
      supabase
        .from("payment_splits")
        .select("amount, installments_count, payments!inner(business_id, deleted_at)")
        .eq("payments.business_id", businessId)
        .is("payments.deleted_at", null)
        .gt("installments_count", 3)
        .lte("due_date", currentEntry?.entry_date || ""),
    ]);

    // Sequential fetches that depend on parallel results
    const allMonthEntryIds = (monthlyEntries || []).map(e => e.id);

    const [
      { data: fetchedMonthlyBreakdowns },
      { data: fetchedMonthlyProductUsage },
    ] = allMonthEntryIds.length > 0 ? await Promise.all([
      supabase
        .from("daily_income_breakdown")
        .select("daily_entry_id, income_source_id, amount, orders_count")
        .in("daily_entry_id", allMonthEntryIds),
      supabase
        .from("daily_product_usage")
        .select("daily_entry_id, product_id, quantity, unit_cost_at_time")
        .in("daily_entry_id", allMonthEntryIds),
    ]) : [{ data: [] }, { data: [] }];

    // Fetch income source goals if we have a goal
    let finalIncomeSourceGoals = incomeSourceGoalsData || [];
    if (goalData?.id) {
      const { data: isg } = await supabase
        .from("income_source_goals")
        .select("income_source_id, avg_ticket_target")
        .eq("goal_id", goalData.id);
      finalIncomeSourceGoals = isg || [];
    }

    // Build entry details (Section 1)
    const incomeBreakdown: IncomeBreakdown[] = (breakdownData || []).map((b: Record<string, unknown>) => ({
      income_source_id: b.income_source_id as string,
      income_source_name: (b.income_sources as { name: string })?.name || "לא ידוע",
      amount: Number(b.amount) || 0,
      orders_count: Number(b.orders_count) || 0,
    }));

    const productUsage: ProductUsage[] = (usageData || []).map((p: Record<string, unknown>) => ({
      product_id: p.product_id as string,
      product_name: (p.managed_products as { name: string; unit: string })?.name || "לא ידוע",
      quantity: Number(p.quantity) || 0,
      unit: (p.managed_products as { name: string; unit: string })?.unit || "",
      unit_cost: Number(p.unit_cost_at_time) || 0,
      opening_stock: Number(p.opening_stock) || 0,
      received_quantity: Number(p.received_quantity) || 0,
      closing_stock: Number(p.closing_stock) || 0,
    }));

    setEntryDetails({ incomeBreakdown, productUsage });

    // Build goals data (Section 2)
    const vatPct = goalData?.vat_percentage != null ? Number(goalData.vat_percentage) : (Number(businessData?.vat_percentage) || 0);

    const incomeSourceTargets: Record<string, number> = {};
    ((finalIncomeSourceGoals || []) as { income_source_id: string; avg_ticket_target: number }[]).forEach(ig => {
      incomeSourceTargets[ig.income_source_id] = Number(ig.avg_ticket_target) || 0;
    });

    const productTargetPcts: Record<string, number> = {};
    (managedProductsData || []).forEach((p: { id: string; target_pct: number | null }) => {
      if (p.target_pct != null) productTargetPcts[p.id] = Number(p.target_pct);
    });

    // Calculate working days in month from business schedule
    const scheduleDayFactors: Record<number, number[]> = {};
    (scheduleData || []).forEach((sc: { day_of_week: number; day_factor: number }) => {
      if (!scheduleDayFactors[sc.day_of_week]) scheduleDayFactors[sc.day_of_week] = [];
      scheduleDayFactors[sc.day_of_week].push(Number(sc.day_factor) || 0);
    });
    const avgScheduleDayFactors: Record<number, number> = {};
    Object.keys(scheduleDayFactors).forEach(dow => {
      const factors = scheduleDayFactors[Number(dow)];
      avgScheduleDayFactors[Number(dow)] = factors.reduce((a, b) => a + b, 0) / factors.length;
    });
    let workDaysInMonth = 0;
    const curDate = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    while (curDate <= lastDay) {
      workDaysInMonth += avgScheduleDayFactors[curDate.getDay()] || 0;
      curDate.setDate(curDate.getDate() + 1);
    }
    // Fallback to 26 if no schedule data
    if (workDaysInMonth === 0) workDaysInMonth = 26;

    const managerSalary = Number(businessData?.manager_monthly_salary) || 0;
    const managerDailyCost = workDaysInMonth > 0 ? managerSalary / workDaysInMonth : 0;
    const markupPct = goalData?.markup_percentage != null ? Number(goalData.markup_percentage) : (Number(businessData?.markup_percentage) || 1);

    // Sum current expenses supplier budgets
    const currentExpensesBudgetTotal = (currentExpBudgetData || []).reduce(
      (sum: number, b: Record<string, unknown>) => sum + (Number(b.budget_amount) || 0), 0
    );

    setGoalsData({
      revenueTarget: Number(goalData?.revenue_target) || 0,
      laborCostTargetPct: Number(goalData?.labor_cost_target_pct) || 0,
      foodCostTargetPct: Number(goalData?.food_cost_target_pct) || 0,
      currentExpensesTarget: currentExpensesBudgetTotal || Number(goalData?.current_expenses_target) || 0,
      vatPercentage: vatPct,
      incomeSourceTargets,
      productTargetPcts,
      workDaysInMonth,
      managerDailyCost,
      markupPercentage: markupPct,
    });

    // Build monthly cumulative (Section 3)
    const allMonthEntries = monthlyEntries || [];
    const monthTotalIncome = allMonthEntries.reduce((sum, e) => sum + (Number(e.total_register) || 0), 0);
    const vatDivisor = vatPct > 0 ? 1 + vatPct : 1;
    const monthIncomeBeforeVat = monthTotalIncome / vatDivisor;
    const monthLaborCost = allMonthEntries.reduce((sum, e) => sum + (Number(e.labor_cost) || 0), 0);
    const monthLaborCostWithMarkup = monthLaborCost * markupPct;
    const monthLaborCostPct = monthIncomeBeforeVat > 0 ? (monthLaborCostWithMarkup / monthIncomeBeforeVat) * 100 : 0;

    // Aggregate income sources for month
    const monthEntryIds = new Set(allMonthEntries.map(e => e.id));
    const incomeSourceTotals: Record<string, { amount: number; ordersCount: number; avgTicket: number }> = {};
    (fetchedMonthlyBreakdowns || []).forEach((b: Record<string, unknown>) => {
      if (!monthEntryIds.has(b.daily_entry_id as string)) return;
      const sid = b.income_source_id as string;
      if (!incomeSourceTotals[sid]) incomeSourceTotals[sid] = { amount: 0, ordersCount: 0, avgTicket: 0 };
      incomeSourceTotals[sid].amount += Number(b.amount) || 0;
      incomeSourceTotals[sid].ordersCount += Number(b.orders_count) || 0;
    });
    Object.values(incomeSourceTotals).forEach(v => {
      v.avgTicket = v.ordersCount > 0 ? v.amount / v.ordersCount : 0;
    });

    // Aggregate product costs for month
    const productCosts: Record<string, { totalCost: number; costPct: number }> = {};
    (fetchedMonthlyProductUsage || []).forEach((p: Record<string, unknown>) => {
      if (!monthEntryIds.has(p.daily_entry_id as string)) return;
      const pid = p.product_id as string;
      if (!productCosts[pid]) productCosts[pid] = { totalCost: 0, costPct: 0 };
      productCosts[pid].totalCost += (Number(p.quantity) || 0) * (Number(p.unit_cost_at_time) || 0);
    });
    Object.entries(productCosts).forEach(([, v]) => {
      v.costPct = monthIncomeBeforeVat > 0 ? (v.totalCost / monthIncomeBeforeVat) * 100 : 0;
    });

    // Food cost from invoices (goods_purchases)
    let monthFoodCost = 0;
    let monthCurrentExpenses = 0;
    (monthlyInvoices || []).forEach((inv: Record<string, unknown>) => {
      const supplier = inv.suppliers as { expense_type: string } | null;
      const subtotal = Number(inv.subtotal) || 0;
      if (supplier?.expense_type === "goods_purchases") monthFoodCost += subtotal;
      else if (supplier?.expense_type === "current_expenses") monthCurrentExpenses += subtotal;
    });
    const foodCostPct = monthIncomeBeforeVat > 0 ? (monthFoodCost / monthIncomeBeforeVat) * 100 : 0;
    const currentExpensesPct = monthIncomeBeforeVat > 0 ? (monthCurrentExpenses / monthIncomeBeforeVat) * 100 : 0;

    const actualWorkDays = allMonthEntries.reduce((sum, e) => sum + (Number(e.day_factor) || 0), 0);

    setMonthlyCumulative({
      totalIncome: monthTotalIncome,
      incomeBeforeVat: monthIncomeBeforeVat,
      laborCost: monthLaborCost,
      laborCostPct: monthLaborCostPct,
      incomeSourceTotals,
      productCosts,
      foodCostPct,
      currentExpenses: monthCurrentExpenses,
      currentExpensesPct,
      actualWorkDays,
    });

    // Calculate open payments total (splits with due_date > entry date)
    const openPayments = (openPaymentsData || []).reduce(
      (sum: number, s: Record<string, unknown>) => sum + (Number(s.amount) || 0), 0
    );
    setOpenPaymentsTotal(openPayments);

    // Calculate open suppliers: total invoices - total payments (no date filter)
    const totalInvoices = (allInvoicesData || []).reduce(
      (sum: number, inv: Record<string, unknown>) => sum + (Number(inv.total_amount) || 0), 0
    );
    const totalPayments = (allPaymentsData || []).reduce(
      (sum: number, pay: Record<string, unknown>) => sum + (Number(pay.total_amount) || 0), 0
    );
    setOpenSuppliersTotal(totalInvoices - totalPayments);

    // Calculate open commitments: all commitment splits - paid commitment splits (due_date <= entry date)
    const totalCommitments = (allCommitmentSplitsData || []).reduce(
      (sum: number, s: Record<string, unknown>) => sum + (Number(s.amount) || 0), 0
    );
    const paidCommitments = (paidCommitmentSplitsData || []).reduce(
      (sum: number, s: Record<string, unknown>) => sum + (Number(s.amount) || 0), 0
    );
    setOpenCommitmentsTotal(totalCommitments - paidCommitments);

    setIsLoadingDetails(false);
  };

  // Toggle entry expansion
  const toggleEntry = (entryId: string) => {
    if (expandedEntryId === entryId) {
      setExpandedEntryId(null);
      setEntryDetails(null);
    } else {
      setExpandedEntryId(entryId);
      fetchEntryDetails(entryId);
    }
  };

  // Handle delete
  const handleDelete = async (entryId: string) => {
    if (!confirm("האם אתה בטוח שברצונך למחוק רשומה זו?")) return;

    const supabase = createClient();
    const { error } = await supabase
      .from("daily_entries")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", entryId);

    if (!error) {
      setEntries(entries.filter((e) => e.id !== entryId));
      if (expandedEntryId === entryId) {
        setExpandedEntryId(null);
        setEntryDetails(null);
      }
      showToast("הרשומה נמחקה בהצלחה", "success");
    } else {
      showToast("שגיאה במחיקת הרשומה", "error");
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
        showCloseButton={false}
      >
        <SheetHeader className="border-b border-[#4C526B] pb-4">
          <div className="flex justify-between items-center" dir="ltr">
            <button
              type="button"
              onClick={onClose}
              className="text-[#7B91B0] hover:text-white transition-colors"
              title="סגור"
              aria-label="סגור"
            >
              <X className="w-6 h-6" />
            </button>
            <SheetTitle className="text-white text-xl font-bold">
              {editingEntry ? `עריכת יום ${formatDate(editingEntry.entry_date)}` : `מילוי יומי - ${businessName}`}
            </SheetTitle>
            <div className="w-[24px]" />
          </div>
          {!editingEntry && (
            <p className="text-white text-[18px] text-center leading-[1.4]">
              {getMonthYear()}
            </p>
          )}
        </SheetHeader>

        {/* Edit Form - shown when editing */}
        {editingEntry ? (
          <div className="flex flex-col gap-4 p-4 mx-[5px]">
            {editError && (
              <div className="bg-red-500/20 border border-red-500 rounded-lg p-3 text-red-400 text-sm text-right">
                {editError}
              </div>
            )}

            {isLoadingEditData ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-[#7B91B0]" />
                <span className="mr-2 text-[#7B91B0]">טוען נתונים...</span>
              </div>
            ) : (
              <>
                {/* תאריך */}
                <div className="flex flex-col gap-[3px]">
                  <Label className="text-white text-[15px] font-medium text-right">תאריך</Label>
                  <Input
                    type="date"
                    value={editFormData.entry_date}
                    onChange={(e) => setEditFormData({ ...editFormData, entry_date: e.target.value })}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px] [color-scheme:dark]"
                  />
                </div>

                {/* סה"כ קופה */}
                <div className="flex flex-col gap-[3px]">
                  <Label className="text-white text-[15px] font-medium text-right">סה&quot;כ קופה</Label>
                  <NumberInput
                    placeholder="0"
                    value={editFormData.total_register}
                    onChange={(v) => setEditFormData({ ...editFormData, total_register: v })}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </div>

                {/* יום חלקי/יום מלא - Admin only */}
                {isAdmin && (
                  <div className="flex flex-col gap-[3px]">
                    <Label className="text-white text-[15px] font-medium text-right">יום חלקי/יום מלא</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder="1"
                      step="0.1"
                      min="0"
                      max="1"
                      value={editFormData.day_factor}
                      onChange={(e) => setEditFormData({ ...editFormData, day_factor: e.target.value })}
                      className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                    />
                  </div>
                )}

                {/* מקורות הכנסה - דינמי */}
                {incomeSources.length > 0 && (
                  <div className="flex flex-col gap-4 mt-2">
                    <div className="text-[#7B91B0] border-b border-[#4C526B] pb-2 text-right">
                      <span className="font-medium">מקורות הכנסה</span>
                    </div>
                    {incomeSources.map((source) => (
                      <div key={source.id} className="flex flex-col gap-3">
                        <div className="flex flex-col gap-[3px]">
                          <Label className="text-white text-[15px] font-medium text-right">סה&quot;כ {source.name}</Label>
                          <NumberInput
                            placeholder="0"
                            value={incomeData[source.id]?.amount || ""}
                            onChange={(v) => setIncomeData((prev) => ({
                              ...prev,
                              [source.id]: { ...prev[source.id], amount: v },
                            }))}
                            className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                          />
                        </div>
                        <div className="flex flex-col gap-[3px]">
                          <Label className="text-white text-[15px] font-medium text-right">כמות הזמנות {source.name}</Label>
                          <Input
                            type="number"
                            inputMode="numeric"
                            placeholder="0"
                            value={incomeData[source.id]?.orders_count || ""}
                            onChange={(e) => setIncomeData((prev) => ({
                              ...prev,
                              [source.id]: { ...prev[source.id], orders_count: e.target.value },
                            }))}
                            className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* תקבולים - דינמי */}
                {receiptTypes.length > 0 && (
                  <div className="flex flex-col gap-4 mt-2">
                    <div className="text-[#7B91B0] border-b border-[#4C526B] pb-2 text-right">
                      <span className="font-medium">תקבולים</span>
                    </div>
                    {receiptTypes.map((receipt) => (
                      <div key={receipt.id} className="flex flex-col gap-[3px]">
                        <Label className="text-white text-[15px] font-medium text-right">{receipt.name}</Label>
                        <NumberInput
                          placeholder="0"
                          value={receiptData[receipt.id] || ""}
                          onChange={(v) => setReceiptData((prev) => ({ ...prev, [receipt.id]: v }))}
                          className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* פרמטרים נוספים - דינמי */}
                {customParameters.length > 0 && (
                  <div className="flex flex-col gap-4 mt-2">
                    <div className="text-[#7B91B0] border-b border-[#4C526B] pb-2 text-right">
                      <span className="font-medium">פרמטרים נוספים</span>
                    </div>
                    {customParameters.map((param) => (
                      <div key={param.id} className="flex flex-col gap-[3px]">
                        <Label className="text-white text-[15px] font-medium text-right">{param.name}</Label>
                        <NumberInput
                          placeholder="0"
                          value={parameterData[param.id] || ""}
                          onChange={(v) => setParameterData((prev) => ({ ...prev, [param.id]: v }))}
                          className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* עלויות עובדים */}
                <div className="flex flex-col gap-[3px]">
                  <Label className="text-white text-[15px] font-medium text-right">סה&quot;כ עלות עובדים יומית</Label>
                  <NumberInput
                    placeholder="0"
                    value={editFormData.labor_cost}
                    onChange={(v) => setEditFormData({ ...editFormData, labor_cost: v })}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </div>

                {/* Admin-only calculated fields */}
                {isAdmin && (() => {
                  const laborCost = parseFloat(editFormData.labor_cost) || 0;
                  const laborWithMarkup = laborCost * monthlyMarkup;

                  const entryDate = editFormData.entry_date ? new Date(editFormData.entry_date) : new Date();
                  const daysInMonth = new Date(entryDate.getFullYear(), entryDate.getMonth() + 1, 0).getDate();
                  const dailyManagerWithMarkup = daysInMonth > 0
                    ? (managerMonthlySalary / daysInMonth) * workingDaysUpToDate * monthlyMarkup
                    : 0;

                  return (
                    <>
                      <div className="bg-transparent rounded-[7px] flex flex-col gap-[3px]">
                        <Label className="text-white text-[15px] font-medium text-right">סה&quot;כ עלות עובדים יומית כולל העמסה</Label>
                        <Input
                          type="text"
                          disabled
                          value={laborWithMarkup > 0 ? laborWithMarkup.toFixed(2) : "—"}
                          className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px] font-semibold disabled:opacity-100"
                        />
                      </div>
                      <div className="bg-transparent rounded-[7px] flex flex-col gap-[3px]">
                        <div className="flex items-center justify-between">
                          <Label className="text-white text-[15px] font-medium text-right">שכר מנהל יומי כולל העמסה</Label>
                          <button
                            type="button"
                            onClick={async () => {
                              const supabase = createClient();
                              const ed = new Date(editFormData.entry_date || new Date());
                              const yr = ed.getFullYear();
                              const mo = ed.getMonth() + 1;
                              const { data: gs } = await supabase.from("goals").select("markup_percentage").eq("business_id", businessId).eq("year", yr).eq("month", mo).is("deleted_at", null).maybeSingle();
                              if (gs?.markup_percentage != null) setMonthlyMarkup(Number(gs.markup_percentage));
                              else {
                                const { data: bz } = await supabase.from("businesses").select("markup_percentage").eq("id", businessId).maybeSingle();
                                setMonthlyMarkup(bz ? Number(bz.markup_percentage) : 1);
                              }
                              const { data: bz2 } = await supabase.from("businesses").select("manager_monthly_salary").eq("id", businessId).maybeSingle();
                              setManagerMonthlySalary(bz2 ? Number(bz2.manager_monthly_salary) : 0);
                              const firstOfMonth = `${yr}-${String(mo).padStart(2, "0")}-01`;
                              const { count } = await supabase.from("daily_entries").select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("entry_date", firstOfMonth).lte("entry_date", editFormData.entry_date);
                              setWorkingDaysUpToDate(count || 0);
                            }}
                            className="opacity-50 hover:opacity-100 transition-opacity"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
                          </button>
                        </div>
                        <Input
                          type="text"
                          disabled
                          value={dailyManagerWithMarkup > 0 ? `₪ ${dailyManagerWithMarkup.toFixed(2)}` : "—"}
                          className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px] font-semibold disabled:opacity-100"
                        />
                      </div>
                    </>
                  );
                })()}

                <div className="flex flex-col gap-[3px]">
                  <Label className="text-white text-[15px] font-medium text-right">כמות שעות עובדים</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={editFormData.labor_hours}
                    onChange={(e) => setEditFormData({ ...editFormData, labor_hours: e.target.value })}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </div>

                <div className="flex flex-col gap-[3px]">
                  <Label className="text-white text-[15px] font-medium text-right">זיכויים+ביטולים+הנחות ב-₪</Label>
                  <NumberInput
                    placeholder="0"
                    value={editFormData.discounts}
                    onChange={(v) => setEditFormData({ ...editFormData, discounts: v })}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </div>

                {/* מוצרים מנוהלים - דינמי */}
                {managedProducts.length > 0 && (
                  <div className="flex flex-col gap-4 mt-2">
                    <div className="text-[#7B91B0] border-b border-[#4C526B] pb-2 text-right">
                      <span className="font-medium">מוצרים מנוהלים</span>
                    </div>
                    {managedProducts.map((product) => (
                      <div
                        key={product.id}
                        className="border border-[#4C526B] rounded-[10px] p-4 flex flex-col gap-3"
                      >
                        <div className="text-white font-medium text-right">
                          <span>{product.name}</span>
                        </div>

                        <div className="flex flex-col gap-[3px]">
                          <Label className="text-white text-[15px] font-medium text-right">מלאי פתיחה ({product.unit})</Label>
                          <Input
                            type="number"
                            inputMode="decimal"
                            placeholder="0"
                            value={productUsageForm[product.id]?.opening_stock || ""}
                            onChange={(e) => setProductUsageForm((prev) => ({
                              ...prev,
                              [product.id]: { ...prev[product.id], opening_stock: e.target.value },
                            }))}
                            className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                          />
                        </div>

                        <div className="flex flex-col gap-[3px]">
                          <Label className="text-white text-[15px] font-medium text-right">כמה {product.unit} {product.name} קיבלנו היום?</Label>
                          <Input
                            type="number"
                            inputMode="decimal"
                            placeholder="0"
                            value={productUsageForm[product.id]?.received_quantity || ""}
                            onChange={(e) => setProductUsageForm((prev) => ({
                              ...prev,
                              [product.id]: { ...prev[product.id], received_quantity: e.target.value },
                            }))}
                            className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                          />
                        </div>

                        <div className="flex flex-col gap-[3px]">
                          <Label className="text-white text-[15px] font-medium text-right">כמה {product.unit} {product.name} נשאר?</Label>
                          <Input
                            type="number"
                            inputMode="decimal"
                            placeholder="0"
                            value={productUsageForm[product.id]?.closing_stock || ""}
                            onChange={(e) => setProductUsageForm((prev) => ({
                              ...prev,
                              [product.id]: { ...prev[product.id], closing_stock: e.target.value },
                            }))}
                            className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                          />
                        </div>

                        {/* שימוש בפועל - admin only */}
                        {isAdmin && (() => {
                          const opening = parseFloat(productUsageForm[product.id]?.opening_stock) || 0;
                          const received = parseFloat(productUsageForm[product.id]?.received_quantity) || 0;
                          const closing = parseFloat(productUsageForm[product.id]?.closing_stock) || 0;
                          const actualUsage = opening + received - closing;
                          return (
                            <div className="bg-transparent rounded-[7px] flex flex-col gap-[3px]">
                              <span className="text-white text-[15px] font-medium text-right">שימוש בפועל</span>
                              <Input
                                type="text"
                                disabled
                                value={actualUsage > 0 ? `${actualUsage.toFixed(2)} ${product.unit}` : "—"}
                                className="bg-transparent border-[#4C526B] text-white text-right h-[40px] rounded-[10px] font-semibold disabled:opacity-100"
                              />
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 mt-4">
                  <Button
                    type="button"
                    onClick={handleSaveEdit}
                    disabled={isSubmitting}
                    className="flex-1 h-[50px] bg-gradient-to-r from-[#3964FF] to-[#6B8AFF] hover:from-[#2850E0] hover:to-[#5A79EE] text-white font-bold text-lg rounded-[10px] transition-all"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin ml-2" />
                        שומר...
                      </>
                    ) : (
                      "עדכן נתונים"
                    )}
                  </Button>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="flex-1 h-[50px] border border-[#4C526B] text-[#7B91B0] hover:text-white hover:border-white font-bold text-lg rounded-[10px] transition-all"
                  >
                    ביטול
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Table Header */}
            <div className="flex items-center justify-between gap-[10px] border-b border-white/35 p-[5px] mx-[5px]" dir="rtl">
              <div className="text-white text-[16px] font-medium text-right w-[85px]">
                תאריך הזנה
              </div>
              <div className="text-white text-[16px] font-medium text-center w-[90px]">
                סה&quot;כ הכנסות
              </div>
              <div className="text-white text-[16px] font-medium text-center w-[85px]">
                אפש&apos;
              </div>
            </div>

            {/* Entries List */}
        <div className="flex flex-col gap-[2px] mx-[5px]">
          {isLoading ? (
            <div className="text-white/70 text-center py-[20px]">טוען...</div>
          ) : entries.length === 0 ? (
            <div className="text-white/70 text-center py-[20px]">
              אין רשומות בתקופה זו
            </div>
          ) : (
            entries.map((entry, index) => (
              <div
                key={entry.id}
                className={`${index > 0 ? "border-t-2 border-white/10" : ""}`}
              >
                {/* Entry Row */}
                <div
                  className="flex items-center justify-between gap-[10px] p-[5px] my-[10px] rounded-[7px] cursor-pointer hover:bg-white/5 transition-colors"
                  dir="rtl"
                  onClick={() => toggleEntry(entry.id)}
                >
                  {/* Date */}
                  <div className="flex items-center justify-start gap-[3px] w-[85px]">
                    <div
                      className={`w-[20px] h-[20px] text-white opacity-50 transition-transform ${
                        expandedEntryId === entry.id ? "-rotate-90" : ""
                      }`}
                    >
                      <svg viewBox="0 0 32 32" className="w-full h-full">
                        <path
                          d="M12 16l6-6v12l-6-6z"
                          fill="currentColor"
                        />
                      </svg>
                    </div>
                    <div className="text-white text-[14px] text-right ltr-num">
                      {formatDate(entry.entry_date)}
                    </div>
                  </div>

                  {/* Total Income */}
                  <div className="text-white text-[14px] text-center w-[90px] ltr-num">
                    {formatCurrency(entry.total_register)}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-center gap-[2px] w-[85px]">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(entry);
                      }}
                      className="w-[20px] h-[20px] text-white opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
                      aria-label="ערוך"
                    >
                      <svg viewBox="0 0 32 32" className="w-full h-full">
                        <path
                          d="M22 6l4 4-14 14H8v-4L22 6z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(entry.id);
                      }}
                      className="w-[20px] h-[20px] text-white opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
                      aria-label="מחק"
                    >
                      <svg viewBox="0 0 32 32" className="w-full h-full">
                        <path
                          d="M9 10h14M12 10V8a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H10a2 2 0 01-2-2V10h16z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedEntryId === entry.id && (
                  <div className="mb-[10px]">
                    {isLoadingDetails ? (
                      <div className="text-white/70 text-center py-[10px]">
                        טוען פרטים...
                      </div>
                    ) : (
                      <>
                        {/* 3 Sections: Daily Summary | Parameter/Target | Monthly Cumulative */}
                        <div className="flex flex-col md:flex-row gap-[10px]">

                          {/* ========== Section 1: הסיכום היומי ========== */}
                          <div className="bg-[#0F1535] rounded-[10px] border-2 border-[#FFCF00] p-[7px] flex-1 min-w-0">
                            <div className="text-[#FFCF00] text-[14px] md:text-[16px] font-bold text-center mb-[10px]">
                              הסיכום היומי ליום {(() => {
                                const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
                                const d = new Date(entry.entry_date);
                                return `${days[d.getDay()]}, ${formatDate(entry.entry_date)}`;
                              })()}
                            </div>

                            <div className="flex gap-[3px] w-full" dir="rtl">
                              {/* Daily Total Column - סה"כ יומי */}
                              <div className="flex flex-col gap-[2px] flex-1 min-w-0">
                                <div className="text-white text-[11px] md:text-[13px] font-bold text-center h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10 whitespace-nowrap">
                                  סה&quot;כ יומי
                                </div>
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  <span className="ltr-num">{formatCurrency(entry.total_register)}</span>
                                </div>
                                {entryDetails?.incomeBreakdown.map((source) => {
                                  const avgPerOrder = source.orders_count > 0 ? source.amount / source.orders_count : 0;
                                  return (
                                    <div
                                      key={source.income_source_id}
                                      className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10"
                                    >
                                      <span className="ltr-num">{formatCurrency(avgPerOrder)}</span>
                                    </div>
                                  );
                                })}
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  <span className="ltr-num">{(() => {
                                    if (!goalsData || entry.total_register <= 0) return "0%";
                                    const vatDivisor = goalsData.vatPercentage > 0 ? 1 + goalsData.vatPercentage : 1;
                                    const revenueBeforeVat = entry.total_register / vatDivisor;
                                    const laborWithMarkup = entry.labor_cost * goalsData.markupPercentage;
                                    const laborPct = revenueBeforeVat > 0 ? (laborWithMarkup / revenueBeforeVat) * 100 : 0;
                                    return formatPercent(laborPct);
                                  })()}</span>
                                </div>
                                {entryDetails?.productUsage.map((product) => {
                                  const usage = product.opening_stock + product.received_quantity - product.closing_stock;
                                  const vatDivisor2 = goalsData?.vatPercentage && goalsData.vatPercentage > 0 ? 1 + goalsData.vatPercentage : 1;
                                  const revenueBeforeVat2 = entry.total_register / vatDivisor2;
                                  const productCostPct = revenueBeforeVat2 > 0 ? ((usage * product.unit_cost) / revenueBeforeVat2) * 100 : 0;
                                  return (
                                  <div
                                    key={product.product_id}
                                    className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10"
                                  >
                                    <span className="ltr-num">{entry.total_register > 0 ? formatPercent(productCostPct) : "0%"}</span>
                                  </div>
                                  );
                                })}
                              </div>

                              {/* Quantity Column - כמות */}
                              <div className="flex flex-col gap-[2px] flex-1 min-w-0">
                                <div className="text-white text-[11px] md:text-[13px] font-bold text-center h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  כמות
                                </div>
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10" />
                                {entryDetails?.incomeBreakdown.map((source) => (
                                  <div
                                    key={source.income_source_id}
                                    className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10"
                                  >
                                    <span className="ltr-num">{source.orders_count}</span>
                                  </div>
                                ))}
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  <span className="ltr-num">{entry.labor_hours || 0}</span>
                                </div>
                              </div>

                              {/* Target Diff Column - הפרש מהיעד */}
                              <div className="flex flex-col gap-[2px] flex-1 min-w-0">
                                <div className="text-white text-[10px] md:text-[12px] font-bold text-center h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10 whitespace-nowrap">
                                  הפרש מהיעד
                                </div>
                                {/* סה"כ קופה - הפרש באחוזים מיעד הכנסות */}
                                <div className={`text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10 ${goalsData && goalsData.revenueTarget > 0 ? (entry.total_register >= goalsData.revenueTarget / goalsData.workDaysInMonth ? "text-green-400" : "text-red-400") : "text-white"}`}>
                                  <span className="ltr-num">{goalsData && goalsData.revenueTarget > 0 ? formatPercent(((entry.total_register / (goalsData.revenueTarget / goalsData.workDaysInMonth)) - 1) * 100) : "-"}</span>
                                </div>
                                {/* מקורות הכנסה - הפרש ממוצע מהיעד */}
                                {entryDetails?.incomeBreakdown.map((source) => {
                                  const target = goalsData?.incomeSourceTargets[source.income_source_id] || 0;
                                  const avg = source.orders_count > 0 ? source.amount / source.orders_count : 0;
                                  const diff = target > 0 ? avg - target : 0;
                                  return (
                                    <div
                                      key={source.income_source_id}
                                      className={`text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10 ${target > 0 ? (diff >= 0 ? "text-green-400" : "text-red-400") : "text-white"}`}
                                    >
                                      <span className="ltr-num">{target > 0 ? `${diff < 0 ? "-" : ""}₪${Math.abs(diff).toFixed(1)}` : "-"}</span>
                                    </div>
                                  );
                                })}
                                {/* ע. עובדים - הפרש מיעד (באחוזים) */}
                                {(() => {
                                  if (!goalsData || entry.total_register <= 0) return (
                                    <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                      <span className="ltr-num">-</span>
                                    </div>
                                  );
                                  const vatDivisor = goalsData.vatPercentage > 0 ? 1 + goalsData.vatPercentage : 1;
                                  const revenueBeforeVat = entry.total_register / vatDivisor;
                                  const laborWithMarkup = entry.labor_cost * goalsData.markupPercentage;
                                  const laborPct = revenueBeforeVat > 0 ? (laborWithMarkup / revenueBeforeVat) * 100 : 0;
                                  const targetPct = goalsData.laborCostTargetPct || 0;
                                  const diff = targetPct > 0 ? laborPct - targetPct : 0;
                                  return (
                                    <div className={`text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10 ${targetPct > 0 ? (diff <= 0 ? "text-green-400" : "text-red-400") : "text-white"}`}>
                                      <span className="ltr-num">{targetPct > 0 ? formatPercent(diff) : "-"}</span>
                                    </div>
                                  );
                                })()}
                                {/* מוצרים - הפרש מיעד */}
                                {entryDetails?.productUsage.map((product) => {
                                  const usage = product.opening_stock + product.received_quantity - product.closing_stock;
                                  const vatDiv = goalsData?.vatPercentage && goalsData.vatPercentage > 0 ? 1 + goalsData.vatPercentage : 1;
                                  const revBeforeVat = entry.total_register / vatDiv;
                                  const actualPct = revBeforeVat > 0 ? ((usage * product.unit_cost) / revBeforeVat) * 100 : 0;
                                  const targetPct = goalsData?.productTargetPcts[product.product_id] || 0;
                                  const diff = targetPct > 0 ? actualPct - targetPct : 0;
                                  return (
                                    <div
                                      key={product.product_id}
                                      className={`text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10 ${targetPct > 0 ? (diff <= 0 ? "text-green-400" : "text-red-400") : "text-white"}`}
                                    >
                                      <span className="ltr-num">{targetPct > 0 ? formatPercent(diff) : "-"}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          {/* ========== Section 2: פרמטר / יעד ========== */}
                          <div className="bg-[#0F1535] rounded-[10px] border-2 border-[#FFCF00] p-[7px] flex-1 min-w-0">
                            <div className="text-[#FFCF00] text-[14px] md:text-[16px] font-bold text-center mb-[10px]">
                              פרמטר / יעד
                            </div>

                            <div className="flex gap-[3px] w-full" dir="rtl">
                              {/* Parameter Name Column - פרמטר */}
                              <div className="flex flex-col gap-[2px] flex-1 min-w-0">
                                <div className="text-white text-[11px] md:text-[13px] font-bold text-center h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  פרמטר
                                </div>
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  סה&quot;כ קופה כולל מע&quot;מ
                                </div>
                                {entryDetails?.incomeBreakdown.map((source) => (
                                  <div
                                    key={source.income_source_id}
                                    className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10 truncate"
                                    title={source.income_source_name}
                                  >
                                    {source.income_source_name}
                                  </div>
                                ))}
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  ע. עובדים (%)
                                </div>
                                {entryDetails?.productUsage.map((product) => (
                                  <div
                                    key={product.product_id}
                                    className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10 truncate"
                                    title={product.product_name}
                                  >
                                    עלות {product.product_name} (%)
                                  </div>
                                ))}
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  עלות מכר
                                </div>
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  הוצאות שוטפות
                                </div>
                              </div>

                              {/* Target Value Column - יעד */}
                              <div className="flex flex-col gap-[2px] flex-1 min-w-0">
                                <div className="text-white text-[11px] md:text-[13px] font-bold text-center h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  יעד
                                </div>
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  <span className="ltr-num">{goalsData ? formatCurrency(goalsData.revenueTarget) : "-"}</span>
                                </div>
                                {entryDetails?.incomeBreakdown.map((source) => (
                                  <div
                                    key={source.income_source_id}
                                    className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10"
                                  >
                                    <span className="ltr-num">{goalsData?.incomeSourceTargets[source.income_source_id] ? `₪${goalsData.incomeSourceTargets[source.income_source_id]}` : "-"}</span>
                                  </div>
                                ))}
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  <span className="ltr-num">{goalsData?.laborCostTargetPct ? `${goalsData.laborCostTargetPct}%` : "-"}</span>
                                </div>
                                {entryDetails?.productUsage.map((product) => (
                                  <div
                                    key={product.product_id}
                                    className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10"
                                  >
                                    <span className="ltr-num">{goalsData?.productTargetPcts[product.product_id] != null ? `${goalsData.productTargetPcts[product.product_id]}%` : "-"}</span>
                                  </div>
                                ))}
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  <span className="ltr-num">{goalsData?.foodCostTargetPct ? `${goalsData.foodCostTargetPct}%` : "-"}</span>
                                </div>
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  <span className="ltr-num">{goalsData?.currentExpensesTarget ? formatCurrency(goalsData.currentExpensesTarget) : "-"}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* ========== Section 3: מצטבר חודש ========== */}
                          <div className="bg-[#0F1535] rounded-[10px] border-2 border-[#FFCF00] p-[7px] flex-1 min-w-0">
                            <div className="text-[#FFCF00] text-[14px] md:text-[16px] font-bold text-center mb-[10px]">
                              מצטבר {getMonthYear()}
                            </div>

                            <div className="flex gap-[3px] w-full" dir="rtl">
                              {/* Cumulative Total Column - סה"כ */}
                              <div className="flex flex-col gap-[2px] flex-1 min-w-0">
                                <div className="text-white text-[11px] md:text-[13px] font-bold text-center h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  סה&quot;כ
                                </div>
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  <span className="ltr-num">{formatCurrency(monthlyCumulative?.totalIncome || 0)}</span>
                                </div>
                                {entryDetails?.incomeBreakdown.map((source) => (
                                  <div
                                    key={source.income_source_id}
                                    className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10"
                                  >
                                    <span className="ltr-num">{formatCurrency(monthlyCumulative?.incomeSourceTotals[source.income_source_id]?.avgTicket || 0)}</span>
                                  </div>
                                ))}
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  <span className="ltr-num">{formatPercent(monthlyCumulative?.laborCostPct || 0)}</span>
                                </div>
                                {entryDetails?.productUsage.map((product) => (
                                  <div
                                    key={product.product_id}
                                    className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10"
                                  >
                                    <span className="ltr-num">{formatPercent(monthlyCumulative?.productCosts[product.product_id]?.costPct || 0)}</span>
                                  </div>
                                ))}
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  <span className="ltr-num">{formatPercent(monthlyCumulative?.foodCostPct || 0)}</span>
                                </div>
                                <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  <span className="ltr-num">{formatCurrency(monthlyCumulative?.currentExpenses || 0)}</span>
                                </div>
                              </div>

                              {/* Difference Column - הפרש */}
                              <div className="flex flex-col gap-[2px] flex-1 min-w-0">
                                <div className="text-white text-[11px] md:text-[13px] font-bold text-center h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                  הפרש
                                </div>
                                {/* סה"כ קופה - הפרש מיעד (צפי חודשי מול יעד) */}
                                {(() => {
                                  const target = goalsData?.revenueTarget || 0;
                                  const actual = monthlyCumulative?.totalIncome || 0;
                                  const actualDays = monthlyCumulative?.actualWorkDays || 0;
                                  const expectedDays = goalsData?.workDaysInMonth || 0;
                                  if (target <= 0 || actualDays <= 0 || expectedDays <= 0) return (
                                    <div className="text-white text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10">
                                      <span className="ltr-num">-</span>
                                    </div>
                                  );
                                  const dailyAvg = actual / actualDays;
                                  const monthlyPace = dailyAvg * expectedDays;
                                  const diffPct = ((monthlyPace / target) - 1) * 100;
                                  return (
                                    <div className={`text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10 ${diffPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                                      <span className="ltr-num">{formatPercent(diffPct)}</span>
                                    </div>
                                  );
                                })()}
                                {entryDetails?.incomeBreakdown.map((source) => {
                                  const target = goalsData?.incomeSourceTargets[source.income_source_id] || 0;
                                  const avg = monthlyCumulative?.incomeSourceTotals[source.income_source_id]?.avgTicket || 0;
                                  const diff = target > 0 ? avg - target : 0;
                                  return (
                                    <div
                                      key={source.income_source_id}
                                      className={`text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10 ${target > 0 ? (diff >= 0 ? "text-green-400" : "text-red-400") : "text-white"}`}
                                    >
                                      <span className="ltr-num">{target > 0 ? `${diff < 0 ? "-" : ""}₪${Math.abs(diff).toFixed(1)}` : "-"}</span>
                                    </div>
                                  );
                                })}
                                {/* ע. עובדים - הפרש */}
                                {(() => {
                                  const actual = monthlyCumulative?.laborCostPct || 0;
                                  const target = goalsData?.laborCostTargetPct || 0;
                                  const diff = target > 0 ? actual - target : 0;
                                  return (
                                    <div className={`text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10 ${target > 0 ? (diff <= 0 ? "text-green-400" : "text-red-400") : "text-white"}`}>
                                      <span className="ltr-num">{target > 0 ? formatPercent(diff) : "-"}</span>
                                    </div>
                                  );
                                })()}
                                {entryDetails?.productUsage.map((product) => {
                                  const actual = monthlyCumulative?.productCosts[product.product_id]?.costPct || 0;
                                  const target = goalsData?.productTargetPcts[product.product_id] || 0;
                                  const diff = target > 0 ? actual - target : 0;
                                  return (
                                    <div
                                      key={product.product_id}
                                      className={`text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10 ${target > 0 ? (diff <= 0 ? "text-green-400" : "text-red-400") : "text-white"}`}
                                    >
                                      <span className="ltr-num">{target > 0 ? formatPercent(diff) : "-"}</span>
                                    </div>
                                  );
                                })}
                                {/* עלות מכר - הפרש */}
                                {(() => {
                                  const actual = monthlyCumulative?.foodCostPct || 0;
                                  const target = goalsData?.foodCostTargetPct || 0;
                                  const diff = target > 0 ? actual - target : 0;
                                  return (
                                    <div className={`text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10 ${target > 0 ? (diff <= 0 ? "text-green-400" : "text-red-400") : "text-white"}`}>
                                      <span className="ltr-num">{target > 0 ? formatPercent(diff) : "-"}</span>
                                    </div>
                                  );
                                })()}
                                {/* הוצאות שוטפות - הפרש */}
                                {(() => {
                                  const actual = monthlyCumulative?.currentExpenses || 0;
                                  const target = goalsData?.currentExpensesTarget || 0;
                                  const diff = target > 0 ? actual - target : 0;
                                  return (
                                    <div className={`text-[12px] md:text-[14px] h-[24px] md:h-[30px] flex items-center justify-center border-b border-white/10 ${target > 0 ? (diff <= 0 ? "text-green-400" : "text-red-400") : "text-white"}`}>
                                      <span className="ltr-num">{target > 0 ? formatCurrency(diff) : "-"}</span>
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>

                        </div>

                        {/* Additional Info */}
                        <div className="flex flex-col gap-[5px] mt-[15px] border-2 border-[#FFCF00] rounded-[10px] p-[10px_15px]" dir="rtl">
                          <div className="flex justify-between items-center w-full">
                            <span className="text-white text-[16px] font-bold">
                              תשלומים פתוחים:
                            </span>
                            <span className="text-white text-[16px] ltr-num font-medium">
                              {formatCurrency(openPaymentsTotal)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center w-full">
                            <span className="text-white text-[16px] font-bold">
                              ספקים פתוחים:
                            </span>
                            <span className="text-white text-[16px] ltr-num font-medium">
                              {formatCurrency(openSuppliersTotal)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center w-full">
                            <span className="text-white text-[16px] font-bold">
                              התחייבויות קודמות:
                            </span>
                            <span className="text-white text-[16px] ltr-num font-medium">
                              {formatCurrency(openCommitmentsTotal)}
                            </span>
                          </div>
                        </div>

                        {/* Monthly Forecast */}
                        <div className="flex flex-col border-2 border-[#FFCF00] rounded-[10px] p-[10px_15px] mt-[15px]" dir="rtl">
                          <div className="flex justify-between items-center w-full">
                            <span className="text-white text-[18px] font-bold leading-[1.4]">
                              צפי הכנסות חודשי כולל מע&quot;מ:
                            </span>
                            <span className="text-white text-[18px] font-medium leading-[1.4] ltr-num">
                              ₪0
                            </span>
                          </div>
                          <div className="flex justify-between items-center w-full mt-[5px]">
                            <span className="text-white text-[18px] font-bold leading-[1.4]">
                              צפי רווח החודש:
                            </span>
                            <span className="text-white text-[18px] font-medium leading-[1.4] ltr-num">
                              ₪0
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        </>
        )}
      </SheetContent>
    </Sheet>
  );
}
