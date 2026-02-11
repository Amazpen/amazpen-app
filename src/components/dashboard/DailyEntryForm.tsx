"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDashboard } from "@/app/(dashboard)/layout";
import { useToast } from "@/components/ui/toast";

interface EditingEntry {
  id: string;
  entry_date: string;
  total_register: number;
  labor_cost: number;
  labor_hours: number;
  discounts: number;
  day_factor: number;
}

interface DailyEntryFormProps {
  businessId: string;
  businessName?: string;
  onSuccess?: () => void;
  editingEntry?: EditingEntry | null;
  isOpenExternal?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Types for dynamic data
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

// Form data types
interface IncomeData {
  amount: string;
  orders_count: string;
}

interface ProductUsageData {
  opening_stock: string;
  received_quantity: string;
  closing_stock: string;
}

interface BaseFormData {
  entry_date: string;
  total_register: string;
  day_factor: string;
  labor_cost: string;
  labor_hours: string;
  discounts: string;
}

export function DailyEntryForm({ businessId, businessName, onSuccess, editingEntry, isOpenExternal, onOpenChange }: DailyEntryFormProps) {
  const { isAdmin } = useDashboard();
  const isPearla = businessName?.includes("פרלה") || false;
  const { showToast } = useToast();
  const [isOpenInternal, setIsOpenInternal] = useState(false);

  // Use external control if provided, otherwise use internal state
  const isOpen = isOpenExternal !== undefined ? isOpenExternal : isOpenInternal;
  const setIsOpen = (open: boolean) => {
    if (onOpenChange) {
      onOpenChange(open);
    } else {
      setIsOpenInternal(open);
    }
  };

  const isEditMode = !!editingEntry;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dynamic data from database
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([]);
  const [receiptTypes, setReceiptTypes] = useState<ReceiptType[]>([]);
  const [customParameters, setCustomParameters] = useState<CustomParameter[]>([]);
  const [managedProducts, setManagedProducts] = useState<ManagedProduct[]>([]);

  // Monthly settings for admin calculated fields
  const [monthlyMarkup, setMonthlyMarkup] = useState<number>(1);
  const [managerMonthlySalary, setManagerMonthlySalary] = useState<number>(0);
  const [workingDaysUpToDate, setWorkingDaysUpToDate] = useState<number>(0);

  // Form state
  const [incomeData, setIncomeData] = useState<Record<string, IncomeData>>({});
  const [receiptData, setReceiptData] = useState<Record<string, string>>({});
  const [parameterData, setParameterData] = useState<Record<string, string>>({});
  const [productUsage, setProductUsage] = useState<Record<string, ProductUsageData>>({});
  const [dateWarning, setDateWarning] = useState<string | null>(null);

  const getToday = () => new Date().toISOString().split("T")[0];

  const [formData, setFormData] = useState<BaseFormData>({
    entry_date: "",
    total_register: "",
    day_factor: "1",
    labor_cost: "",
    labor_hours: "",
    discounts: "",
  });

  // Set today's date after hydration to avoid server/client mismatch
  useEffect(() => {
    setFormData(prev => prev.entry_date === "" ? { ...prev, entry_date: getToday() } : prev);
  }, []);

  // Pearla-specific form state
  const [pearlaData, setPearlaData] = useState({
    portions_count: "",
    portions_income: "",
    serving_supplement: "",
    serving_income: "",
    extras_income: "",
    total_income: "",
    salaried_labor_cost: "",
    salaried_labor_overhead: "",
    manpower_labor_cost: "",
  });

  const handlePearlaChange = (field: string, value: string) => {
    setPearlaData((prev) => ({ ...prev, [field]: value }));
  };

  // === localStorage draft persistence ===
  const DRAFT_KEY = `dailyEntry:draft:${businessId}`;
  const draftLoaded = useRef(false);
  const draftCleared = useRef(false);

  // Save draft to localStorage whenever form values change
  const saveDraft = useCallback(() => {
    if (!isOpen || isEditMode || draftCleared.current) return;
    try {
      const draft = { formData, incomeData, receiptData, parameterData, productUsage, pearlaData };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch { /* ignore */ }
  }, [DRAFT_KEY, isOpen, isEditMode, formData, incomeData, receiptData, parameterData, productUsage, pearlaData]);

  useEffect(() => {
    if (draftLoaded.current) saveDraft();
  }, [saveDraft]);

  const clearDraft = useCallback(() => {
    draftCleared.current = true;
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }, [DRAFT_KEY]);

  // Restore draft after dynamic data loads (so we have the right keys)
  const restoreDraft = useCallback(() => {
    if (isEditMode) return;
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (!saved) return;
      const draft = JSON.parse(saved);
      if (draft.formData) setFormData(draft.formData);
      if (draft.incomeData) setIncomeData(prev => ({ ...prev, ...draft.incomeData }));
      if (draft.receiptData) setReceiptData(prev => ({ ...prev, ...draft.receiptData }));
      if (draft.parameterData) setParameterData(prev => ({ ...prev, ...draft.parameterData }));
      if (draft.productUsage) setProductUsage(prev => ({ ...prev, ...draft.productUsage }));
      if (draft.pearlaData) setPearlaData(draft.pearlaData);
    } catch { /* ignore */ }
    draftLoaded.current = true;
  }, [DRAFT_KEY, isEditMode]);

  // Load all dynamic data when sheet opens, then load existing entry data if editing
  useEffect(() => {
    if (isOpen && businessId) {
      draftCleared.current = false;
      draftLoaded.current = false;
      loadAllData().then(() => {
        if (editingEntry) {
          setFormData({
            entry_date: editingEntry.entry_date,
            total_register: editingEntry.total_register.toString(),
            day_factor: editingEntry.day_factor.toString(),
            labor_cost: editingEntry.labor_cost.toString(),
            labor_hours: editingEntry.labor_hours.toString(),
            discounts: editingEntry.discounts.toString(),
          });
          loadExistingEntryData(editingEntry.id);
        }
      });
    }
  }, [isOpen, businessId, editingEntry]);

  const loadAllData = async () => {
    setIsLoading(true);
    try {
      const supabase = createClient();

      // Calculate yesterday's date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      // Load all data in parallel
      const [
        { data: sources },
        { data: receipts },
        { data: parameters },
        { data: products },
        { data: lastEntry },
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
          .select("id, name, unit, unit_cost, current_stock")
          .eq("business_id", businessId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("name"),
        // Get the most recent daily entry to fetch closing stock values
        supabase
          .from("daily_entries")
          .select("id, entry_date")
          .eq("business_id", businessId)
          .lte("entry_date", yesterdayStr)
          .order("entry_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      // If we have a previous entry, get the product usage from that day
      const previousClosingStock: Record<string, number> = {};
      if (lastEntry) {
        const { data: previousUsage } = await supabase
          .from("daily_product_usage")
          .select("product_id, closing_stock")
          .eq("daily_entry_id", lastEntry.id);

        if (previousUsage) {
          previousUsage.forEach((usage) => {
            previousClosingStock[usage.product_id] = usage.closing_stock || 0;
          });
        }
      }

      setIncomeSources(sources || []);
      setReceiptTypes(receipts || []);
      setCustomParameters(parameters || []);
      setManagedProducts(products || []);

      // Initialize form state for each type
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

      // Initialize products with previous closing stock as opening stock
      const initialProducts: Record<string, ProductUsageData> = {};
      (products || []).forEach((p) => {
        // Use previous closing stock if available, otherwise use current_stock from product
        const openingStock = previousClosingStock[p.id] ?? p.current_stock ?? 0;
        initialProducts[p.id] = {
          opening_stock: openingStock > 0 ? openingStock.toString() : "",
          received_quantity: "",
          closing_stock: "",
        };
      });
      setProductUsage(initialProducts);

      // Check if today's date already has an entry (only in create mode)
      if (!editingEntry) {
        const today = new Date().toISOString().split("T")[0];
        const { data: todayEntry } = await supabase
          .from("daily_entries")
          .select("id")
          .eq("business_id", businessId)
          .eq("entry_date", today)
          .maybeSingle();
        if (todayEntry) {
          setDateWarning("כבר קיים רישום לתאריך זה");
        }
      }

      // Restore draft after all state is initialized
      setTimeout(() => restoreDraft(), 0);
    } catch (err) {
      console.error("Error loading form data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Load monthly markup & manager salary when date changes (admin + edit mode only)
  useEffect(() => {
    if (!isAdmin || !isEditMode || !formData.entry_date || !businessId) return;

    const loadMonthlySettings = async () => {
      const supabase = createClient();

      // Load monthly markup from goals table for this business+month
      const entryDate = new Date(formData.entry_date);
      const year = entryDate.getFullYear();
      const month = entryDate.getMonth() + 1;

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
        // Fallback to business default
        const { data: business } = await supabase
          .from("businesses")
          .select("markup_percentage")
          .eq("id", businessId)
          .maybeSingle();
        setMonthlyMarkup(business ? Number(business.markup_percentage) : 1);
      }

      // Load manager salary from business
      const { data: biz } = await supabase
        .from("businesses")
        .select("manager_monthly_salary")
        .eq("id", businessId)
        .maybeSingle();
      setManagerMonthlySalary(biz ? Number(biz.manager_monthly_salary) : 0);

      // Count working days in this month up to and including the entry date
      const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
      const entryDateStr = formData.entry_date;
      const { count } = await supabase
        .from("daily_entries")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .gte("entry_date", firstOfMonth)
        .lte("entry_date", entryDateStr);
      setWorkingDaysUpToDate((count || 0) + (isEditMode ? 0 : 1));
    };

    loadMonthlySettings();
  }, [isAdmin, isEditMode, formData.entry_date, businessId]);

  const loadExistingEntryData = async (entryId: string) => {
    try {
      const supabase = createClient();

      // Load income breakdown for this entry
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

      // Load receipts for this entry
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

      // Load parameters for this entry
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

      // Load product usage for this entry
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
        setProductUsage((prev) => ({ ...prev, ...existingUsage }));
      }
    } catch (err) {
      console.error("Error loading existing entry data:", err);
    }
  };

  const handleChange = (field: keyof BaseFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
    // When date changes, check for existing entry and update opening stock
    if (field === "entry_date" && value) {
      checkDateAndUpdateStock(value);
    }
  };

  // Check if an entry exists for the selected date + fetch previous day closing stock
  const checkDateAndUpdateStock = async (date: string) => {
    if (!businessId || !date) return;
    const supabase = createClient();

    // Check if entry already exists for this date (skip in edit mode for same date)
    const { data: existingEntry } = await supabase
      .from("daily_entries")
      .select("id")
      .eq("business_id", businessId)
      .eq("entry_date", date)
      .maybeSingle();

    if (existingEntry && (!editingEntry || editingEntry.id !== existingEntry.id)) {
      setDateWarning("כבר קיים רישום לתאריך זה");
    } else {
      setDateWarning(null);
    }

    // Fetch the closest previous entry's closing stock for managed products
    if (managedProducts.length > 0) {
      const { data: prevEntry } = await supabase
        .from("daily_entries")
        .select("id")
        .eq("business_id", businessId)
        .lt("entry_date", date)
        .order("entry_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prevEntry) {
        const { data: prevUsage } = await supabase
          .from("daily_product_usage")
          .select("product_id, closing_stock")
          .eq("daily_entry_id", prevEntry.id);

        if (prevUsage) {
          setProductUsage(prev => {
            const updated = { ...prev };
            for (const usage of prevUsage) {
              if (updated[usage.product_id]) {
                updated[usage.product_id] = {
                  ...updated[usage.product_id],
                  opening_stock: (usage.closing_stock || 0) > 0 ? (usage.closing_stock || 0).toString() : "",
                };
              }
            }
            return updated;
          });
        }
      }
    }
  };

  const handleIncomeChange = (sourceId: string, field: keyof IncomeData, value: string) => {
    setIncomeData((prev) => ({
      ...prev,
      [sourceId]: { ...prev[sourceId], [field]: value },
    }));
  };

  const handleReceiptChange = (receiptId: string, value: string) => {
    setReceiptData((prev) => ({ ...prev, [receiptId]: value }));
  };

  const handleParameterChange = (paramId: string, value: string) => {
    setParameterData((prev) => ({ ...prev, [paramId]: value }));
  };

  const handleProductUsageChange = (
    productId: string,
    field: keyof ProductUsageData,
    value: string
  ) => {
    setProductUsage((prev) => ({
      ...prev,
      [productId]: { ...prev[productId], [field]: value },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const supabase = createClient();

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("יש להתחבר למערכת");
      }

      // Calculate manager daily cost with markup for saving
      const saveLaborCost = parseFloat(formData.labor_cost) || 0;
      const saveEntryDate = formData.entry_date ? new Date(formData.entry_date) : new Date();
      const saveDaysInMonth = new Date(saveEntryDate.getFullYear(), saveEntryDate.getMonth() + 1, 0).getDate();
      const saveManagerDailyCost = saveDaysInMonth > 0
        ? (managerMonthlySalary / saveDaysInMonth) * workingDaysUpToDate * monthlyMarkup
        : 0;

      let dailyEntryId: string;

      if (isEditMode && editingEntry) {
        // Update existing entry
        const { error: updateError } = await supabase
          .from("daily_entries")
          .update({
            entry_date: formData.entry_date,
            total_register: parseFloat(formData.total_register) || 0,
            labor_cost: saveLaborCost,
            labor_hours: parseFloat(formData.labor_hours) || 0,
            discounts: parseFloat(formData.discounts) || 0,
            day_factor: parseFloat(formData.day_factor) || 1,
            manager_daily_cost: saveManagerDailyCost,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingEntry.id);

        if (updateError) {
          if (updateError.code === "23505") {
            throw new Error("כבר קיים רישום לתאריך זה");
          }
          throw updateError;
        }

        dailyEntryId = editingEntry.id;

        // Delete existing related data before re-inserting
        await Promise.all([
          supabase.from("daily_income_breakdown").delete().eq("daily_entry_id", dailyEntryId),
          supabase.from("daily_receipts").delete().eq("daily_entry_id", dailyEntryId),
          supabase.from("daily_parameters").delete().eq("daily_entry_id", dailyEntryId),
          supabase.from("daily_product_usage").delete().eq("daily_entry_id", dailyEntryId),
        ]);
      } else {
        // Create new daily entry
        const { data: dailyEntry, error: entryError } = await supabase
          .from("daily_entries")
          .insert({
            business_id: businessId,
            entry_date: formData.entry_date,
            total_register: parseFloat(formData.total_register) || 0,
            labor_cost: saveLaborCost,
            labor_hours: parseFloat(formData.labor_hours) || 0,
            discounts: parseFloat(formData.discounts) || 0,
            day_factor: parseFloat(formData.day_factor) || 1,
            manager_daily_cost: saveManagerDailyCost,
            created_by: user.id,
          })
          .select()
          .single();

        if (entryError) {
          if (entryError.code === "23505") {
            showToast("כבר קיים רישום לתאריך זה", "warning");
            setIsSubmitting(false);
            return;
          }
          throw entryError;
        }

        dailyEntryId = dailyEntry.id;
      }

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
        const usage = productUsage[product.id];
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

      // Reset all form data and clear draft
      clearDraft();
      resetForm();
      setIsOpen(false);
      onSuccess?.();
    } catch (err) {
      console.error("Error saving daily entry:", err);
      setError(err instanceof Error ? err.message : "שגיאה בשמירת הנתונים");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      entry_date: getToday(),
      total_register: "",
      day_factor: "1",
      labor_cost: "",
      labor_hours: "",
      discounts: "",
    });

    const resetIncome: Record<string, IncomeData> = {};
    incomeSources.forEach((s) => {
      resetIncome[s.id] = { amount: "", orders_count: "" };
    });
    setIncomeData(resetIncome);

    const resetReceipts: Record<string, string> = {};
    receiptTypes.forEach((r) => {
      resetReceipts[r.id] = "";
    });
    setReceiptData(resetReceipts);

    const resetParams: Record<string, string> = {};
    customParameters.forEach((p) => {
      resetParams[p.id] = "";
    });
    setParameterData(resetParams);

    const resetProducts: Record<string, ProductUsageData> = {};
    managedProducts.forEach((p) => {
      resetProducts[p.id] = {
        opening_stock: "",
        received_quantity: "",
        closing_stock: "",
      };
    });
    setProductUsage(resetProducts);

    // Reset Pearla-specific data
    setPearlaData({
      portions_count: "",
      portions_income: "",
      serving_supplement: "",
      serving_income: "",
      extras_income: "",
      total_income: "",
      salaried_labor_cost: "",
      salaried_labor_overhead: "",
      manpower_labor_cost: "",
    });
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="action-btn-primary text-white text-center font-bold text-sm leading-none rounded-[7px] py-[7px] px-[10px] min-h-[40px] cursor-pointer"
        >
          הזנת נתונים
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto"
        showCloseButton={false}
      >
        <SheetHeader className="border-b border-[#4C526B] pb-4">
          <div className="flex justify-between items-center" dir="ltr">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-[#7B91B0] hover:text-white transition-colors"
              title="סגור"
              aria-label="סגור"
            >
              <X className="w-6 h-6" />
            </button>
            <SheetTitle className="text-white text-xl font-bold">
              {isPearla ? (
                <>
                  <div className="text-[22px] font-bold text-center">פרלה וג&apos;וזף קייטרינג בע&quot;מ</div>
                  <div className="text-[18px] font-semibold text-center">{isEditMode ? "עריכת נתונים יומיים" : "הזנת נתונים יומיים"}</div>
                </>
              ) : (
                isEditMode ? "עריכת נתונים יומיים" : "הזנת נתונים יומית"
              )}
            </SheetTitle>
            <div className="w-[24px]" />
          </div>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-[#7B91B0]" />
            <span className="mr-2 text-[#7B91B0]">טוען נתונים...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4 pb-8">
            {error && (
              <div className="bg-red-500/20 border border-red-500 rounded-lg p-3 text-red-400 text-sm text-right">
                {error}
              </div>
            )}

            {isPearla ? (
              <>
                {/* Pearla-specific form fields */}
                <FormField label="תאריך האירוע">
                  <Input
                    type="date"
                    value={formData.entry_date}
                    onChange={(e) => handleChange("entry_date", e.target.value)}
                    className={`bg-transparent text-white text-right h-[50px] rounded-[10px] [color-scheme:dark] ${dateWarning ? 'border-[#FFA500]' : 'border-[#4C526B]'}`}
                  />
                  {dateWarning && (
                    <span className="text-[12px] text-[#FFA500] text-right mt-[3px]">{dateWarning}</span>
                  )}
                </FormField>

                {isAdmin && <FormField label="יום חלקי/יום מלא">
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder=""
                    step="0.1"
                    min="0"
                    max="1"
                    value={formData.day_factor}
                    onChange={(e) => handleChange("day_factor", e.target.value)}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </FormField>}

                <FormField label="כמות מנות">
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder=""
                    value={pearlaData.portions_count}
                    onChange={(e) => handlePearlaChange("portions_count", e.target.value)}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </FormField>

                <FormField label='סה"כ הכנסות מנות'>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder=""
                    disabled
                    value={pearlaData.portions_income}
                    className="bg-transparent border-[#4C526B] text-white/50 text-right h-[50px] rounded-[10px]"
                  />
                </FormField>

                <FormField label='תוספת הגשה בש"ח'>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    placeholder=""
                    value={pearlaData.serving_supplement}
                    onChange={(e) => handlePearlaChange("serving_supplement", e.target.value)}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </FormField>

                <FormField label='סה"כ הכנסות הגשה'>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder=""
                    disabled
                    value={pearlaData.serving_income}
                    className="bg-transparent border-[#4C526B] text-white/50 text-right h-[50px] rounded-[10px]"
                  />
                </FormField>

                <FormField label='סה"כ הכנסות אקסטרות'>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder=""
                    value={pearlaData.extras_income}
                    onChange={(e) => handlePearlaChange("extras_income", e.target.value)}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </FormField>

                <FormField label='סה"כ הכנסות'>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder=""
                    disabled
                    value={pearlaData.total_income}
                    className="bg-transparent border-[#4C526B] text-white/50 text-right h-[50px] rounded-[10px]"
                  />
                </FormField>

                <FormField label='סה"כ עלות עובדים שכירים'>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder=""
                    value={pearlaData.salaried_labor_cost}
                    onChange={(e) => handlePearlaChange("salaried_labor_cost", e.target.value)}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </FormField>

                <FormField label="עלות עובדים שכירים + העמסה">
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder=""
                    disabled
                    value={pearlaData.salaried_labor_overhead}
                    className="bg-transparent border-[#4C526B] text-white/50 text-right h-[50px] rounded-[10px]"
                  />
                </FormField>

                <FormField label='סה"כ עלות עובדי כ"א'>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder=""
                    value={pearlaData.manpower_labor_cost}
                    onChange={(e) => handlePearlaChange("manpower_labor_cost", e.target.value)}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </FormField>
              </>
            ) : (
              <>
                {/* Original form fields for all other businesses */}
                <FormField label="תאריך">
                  <Input
                    type="date"
                    value={formData.entry_date}
                    onChange={(e) => handleChange("entry_date", e.target.value)}
                    className={`bg-transparent text-white text-right h-[50px] rounded-[10px] [color-scheme:dark] ${dateWarning ? 'border-[#FFA500]' : 'border-[#4C526B]'}`}
                  />
                  {dateWarning && (
                    <span className="text-[12px] text-[#FFA500] text-right mt-[3px]">{dateWarning}</span>
                  )}
                </FormField>

                <FormField label='סה"כ קופה'>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={formData.total_register}
                    onChange={(e) => handleChange("total_register", e.target.value)}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </FormField>

                {/* יום חלקי/יום מלא - רק לאדמין */}
                {isAdmin && (
                  <FormField label="יום חלקי/יום מלא">
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder="1"
                      step="0.1"
                      min="0"
                      max="1"
                      value={formData.day_factor}
                      onChange={(e) => handleChange("day_factor", e.target.value)}
                      className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                    />
                  </FormField>
                )}

                {/* מקורות הכנסה - דינמי */}
                {incomeSources.length > 0 && (
                  <div className="flex flex-col gap-4 mt-2">
                    <SectionHeader title="מקורות הכנסה" />
                    {incomeSources.map((source) => (
                      <div key={source.id} className="flex flex-col gap-3">
                        <FormField label={`סה"כ ${source.name}`}>
                          <Input
                            type="number"
                            inputMode="decimal"
                            placeholder="0"
                            value={incomeData[source.id]?.amount || ""}
                            onChange={(e) => handleIncomeChange(source.id, "amount", e.target.value)}
                            className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                          />
                        </FormField>
                        <FormField label={`כמות הזמנות ${source.name}`}>
                          <Input
                            type="number"
                            inputMode="numeric"
                            placeholder="0"
                            value={incomeData[source.id]?.orders_count || ""}
                            onChange={(e) => handleIncomeChange(source.id, "orders_count", e.target.value)}
                            className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                          />
                        </FormField>
                      </div>
                    ))}
                  </div>
                )}

                {/* תקבולים - דינמי */}
                {receiptTypes.length > 0 && (
                  <div className="flex flex-col gap-4 mt-2">
                    <SectionHeader title="תקבולים" />
                    {receiptTypes.map((receipt) => (
                      <FormField key={receipt.id} label={receipt.name}>
                        <Input
                          type="number"
                          inputMode="decimal"
                          placeholder="0"
                          value={receiptData[receipt.id] || ""}
                          onChange={(e) => handleReceiptChange(receipt.id, e.target.value)}
                          className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                        />
                      </FormField>
                    ))}
                  </div>
                )}

                {/* פרמטרים נוספים - דינמי */}
                {customParameters.length > 0 && (
                  <div className="flex flex-col gap-4 mt-2">
                    <SectionHeader title="פרמטרים נוספים" />
                    {customParameters.map((param) => (
                      <FormField key={param.id} label={param.name}>
                        <Input
                          type="number"
                          inputMode="decimal"
                          placeholder="0"
                          value={parameterData[param.id] || ""}
                          onChange={(e) => handleParameterChange(param.id, e.target.value)}
                          className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                        />
                      </FormField>
                    ))}
                  </div>
                )}

                {/* עלויות עובדים */}
                <FormField label='סה"כ עלות עובדים יומית'>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={formData.labor_cost}
                    onChange={(e) => handleChange("labor_cost", e.target.value)}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </FormField>

                {/* Admin-only calculated fields - edit mode only */}
                {isAdmin && isEditMode && (() => {
                  // עלות עובדים יומית כולל העמסה = עלות יומית * העמסה
                  const laborCost = parseFloat(formData.labor_cost) || 0;
                  const laborWithMarkup = laborCost * monthlyMarkup;

                  // שכר מנהל כולל העמסה = (שכר חודשי / ימים בחודש) * ימי עבודה עד התאריך * העמסה
                  const entryDate = formData.entry_date ? new Date(formData.entry_date) : new Date();
                  const daysInMonth = new Date(entryDate.getFullYear(), entryDate.getMonth() + 1, 0).getDate();
                  const dailyManagerWithMarkup = daysInMonth > 0
                    ? (managerMonthlySalary / daysInMonth) * workingDaysUpToDate * monthlyMarkup
                    : 0;

                  return (
                    <>
                      <FormField label='סה"כ עלות עובדים יומית כולל העמסה'>
                        <Input
                          type="text"
                          disabled
                          value={laborWithMarkup > 0 ? `₪ ${laborWithMarkup.toFixed(2)}` : "—"}
                          className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px] font-semibold"
                        />
                      </FormField>
                      <div className="flex flex-col gap-[3px]">
                        <div className="flex items-center justify-between flex-row-reverse">
                          <Label className="text-white text-[15px] font-medium text-right">שכר מנהל יומי כולל העמסה</Label>
                          <button
                            type="button"
                            onClick={() => {
                              // Re-fetch markup, manager salary & working days
                              const loadSettings = async () => {
                                const supabase = createClient();
                                const ed = new Date(formData.entry_date || new Date());
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
                                const { count } = await supabase.from("daily_entries").select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("entry_date", firstOfMonth).lte("entry_date", formData.entry_date);
                                setWorkingDaysUpToDate((count || 0) + (isEditMode ? 0 : 1));
                              };
                              loadSettings();
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
                          className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px] font-semibold"
                        />
                      </div>
                    </>
                  );
                })()}

                <FormField label="כמות שעות עובדים">
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={formData.labor_hours}
                    onChange={(e) => handleChange("labor_hours", e.target.value)}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </FormField>

                <FormField label="זיכויים+ביטולים+הנחות ב-₪">
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={formData.discounts}
                    onChange={(e) => handleChange("discounts", e.target.value)}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </FormField>

                {/* מוצרים מנוהלים - דינמי */}
                {managedProducts.length > 0 && (
                  <div className="flex flex-col gap-4 mt-2">
                    <SectionHeader title="מוצרים מנוהלים" />
                    {managedProducts.map((product) => (
                      <div
                        key={product.id}
                        className="border border-[#4C526B] rounded-[10px] p-4 flex flex-col gap-3"
                      >
                        <div className="text-white font-medium text-right">
                          <span>{product.name}</span>
                        </div>

                        <FormField label={`מלאי פתיחה (${product.unit})`}>
                          <Input
                            type="number"
                            inputMode="decimal"
                            placeholder="0"
                            value={productUsage[product.id]?.opening_stock || ""}
                            onChange={(e) =>
                              handleProductUsageChange(product.id, "opening_stock", e.target.value)
                            }
                            className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                          />
                        </FormField>

                        <FormField label={`כמה ${product.unit} ${product.name} קיבלנו היום?`}>
                          <Input
                            type="number"
                            inputMode="decimal"
                            placeholder="0"
                            value={productUsage[product.id]?.received_quantity || ""}
                            onChange={(e) =>
                              handleProductUsageChange(product.id, "received_quantity", e.target.value)
                            }
                            className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                          />
                        </FormField>

                        <FormField label={`כמה ${product.unit} ${product.name} נשאר?`}>
                          <Input
                            type="number"
                            inputMode="decimal"
                            placeholder="0"
                            value={productUsage[product.id]?.closing_stock || ""}
                            onChange={(e) =>
                              handleProductUsageChange(product.id, "closing_stock", e.target.value)
                            }
                            className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                          />
                        </FormField>

                        {/* שימוש בפועל - admin + edit mode only */}
                        {isAdmin && isEditMode && (() => {
                          const opening = parseFloat(productUsage[product.id]?.opening_stock) || 0;
                          const received = parseFloat(productUsage[product.id]?.received_quantity) || 0;
                          const closing = parseFloat(productUsage[product.id]?.closing_stock) || 0;
                          const actualUsage = opening + received - closing;
                          return (
                            <div className="bg-transparent rounded-[7px] flex flex-col gap-[3px]">
                              <span className="text-white text-[15px] font-medium text-right">שימוש בפועל</span>
                              <Input
                                type="text"
                                disabled
                                value={actualUsage > 0 ? `${actualUsage.toFixed(2)} ${product.unit}` : "—"}
                                className="bg-transparent border-[#4C526B] text-white text-right h-[40px] rounded-[10px] font-semibold"
                              />
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 mt-4">
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 h-[50px] bg-[#29318A] hover:bg-[#3D44A0] text-white font-bold text-lg rounded-[10px] transition-colors"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin ml-2" />
                    שומר...
                  </>
                ) : isEditMode ? (
                  "עדכן נתונים"
                ) : (
                  "שמור נתונים"
                )}
              </Button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex-1 h-[50px] border border-[#4C526B] text-[#7B91B0] hover:text-white hover:border-white font-bold text-lg rounded-[10px] transition-all"
              >
                ביטול
              </button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[3px]">
      <Label className="text-white text-[15px] font-medium text-right">
        {label}
      </Label>
      {children}
    </div>
  );
}

function SectionHeader({
  title,
}: {
  title: string;
}) {
  return (
    <div className="text-[#7B91B0] border-b border-[#4C526B] pb-2 text-right">
      <span className="font-medium">{title}</span>
    </div>
  );
}
