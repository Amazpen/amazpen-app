"use client";

import { useState, useEffect } from "react";
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

export function DailyEntryForm({ businessId, onSuccess, editingEntry, isOpenExternal, onOpenChange }: DailyEntryFormProps) {
  const { isAdmin } = useDashboard();
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

  // Form state
  const [incomeData, setIncomeData] = useState<Record<string, IncomeData>>({});
  const [receiptData, setReceiptData] = useState<Record<string, string>>({});
  const [parameterData, setParameterData] = useState<Record<string, string>>({});
  const [productUsage, setProductUsage] = useState<Record<string, ProductUsageData>>({});

  const today = new Date().toISOString().split("T")[0];

  const [formData, setFormData] = useState<BaseFormData>({
    entry_date: today,
    total_register: "",
    day_factor: "1",
    labor_cost: "",
    labor_hours: "",
    discounts: "",
  });

  // Load all dynamic data when sheet opens
  useEffect(() => {
    if (isOpen && businessId) {
      loadAllData();
    }
  }, [isOpen, businessId]);

  // Load existing data when editing
  useEffect(() => {
    if (isOpen && editingEntry) {
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
  }, [isOpen, editingEntry]);

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
          .single(),
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
    } catch (err) {
      console.error("Error loading form data:", err);
    } finally {
      setIsLoading(false);
    }
  };

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

      let dailyEntryId: string;

      if (isEditMode && editingEntry) {
        // Update existing entry
        const { error: updateError } = await supabase
          .from("daily_entries")
          .update({
            entry_date: formData.entry_date,
            total_register: parseFloat(formData.total_register) || 0,
            labor_cost: parseFloat(formData.labor_cost) || 0,
            labor_hours: parseFloat(formData.labor_hours) || 0,
            discounts: parseFloat(formData.discounts) || 0,
            day_factor: parseFloat(formData.day_factor) || 1,
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
            labor_cost: parseFloat(formData.labor_cost) || 0,
            labor_hours: parseFloat(formData.labor_hours) || 0,
            discounts: parseFloat(formData.discounts) || 0,
            day_factor: parseFloat(formData.day_factor) || 1,
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

      // Reset all form data
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
      entry_date: today,
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
        className="h-[85vh] h-[85dvh] max-h-[85dvh] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto"
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
              {isEditMode ? "עריכת נתונים יומיים" : "הזנת נתונים יומית"}
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

            {/* שדות בסיס */}
            <FormField label="תאריך">
              <Input
                type="date"
                value={formData.entry_date}
                onChange={(e) => handleChange("entry_date", e.target.value)}
                className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px] [color-scheme:dark]"
              />
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
                  </div>
                ))}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 mt-4">
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 h-[50px] bg-gradient-to-r from-[#3964FF] to-[#6B8AFF] hover:from-[#2850E0] hover:to-[#5A79EE] text-white font-bold text-lg rounded-[10px] transition-all"
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
