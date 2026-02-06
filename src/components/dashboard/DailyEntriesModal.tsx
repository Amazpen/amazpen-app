"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useDashboard } from "@/app/(dashboard)/layout";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

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
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [entryDetails, setEntryDetails] = useState<{
    incomeBreakdown: IncomeBreakdown[];
    productUsage: ProductUsage[];
  } | null>(null);
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

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  };

  // Format currency
  const formatCurrency = (amount: number) => {
    return `₪${amount.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
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

      // Update main daily entry
      const { error: updateError } = await supabase
        .from("daily_entries")
        .update({
          entry_date: editFormData.entry_date,
          total_register: parseFloat(editFormData.total_register) || 0,
          labor_cost: parseFloat(editFormData.labor_cost) || 0,
          labor_hours: parseFloat(editFormData.labor_hours) || 0,
          discounts: parseFloat(editFormData.discounts) || 0,
          day_factor: parseFloat(editFormData.day_factor) || 1,
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

  // Fetch entry details when expanded
  const fetchEntryDetails = async (entryId: string) => {
    setIsLoadingDetails(true);
    const supabase = createClient();

    // Fetch income breakdown
    const { data: breakdownData } = await supabase
      .from("daily_income_breakdown")
      .select(`
        income_source_id,
        amount,
        orders_count,
        income_sources (name)
      `)
      .eq("daily_entry_id", entryId);

    // Fetch product usage
    const { data: usageData } = await supabase
      .from("daily_product_usage")
      .select(`
        product_id,
        quantity,
        unit_cost_at_time,
        managed_products (name, unit)
      `)
      .eq("daily_entry_id", entryId);

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
    }));

    setEntryDetails({ incomeBreakdown, productUsage });
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
        className="h-[90vh] h-[90dvh] max-h-[90dvh] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
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
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={editFormData.total_register}
                    onChange={(e) => setEditFormData({ ...editFormData, total_register: e.target.value })}
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
                          <Input
                            type="number"
                            inputMode="decimal"
                            placeholder="0"
                            value={incomeData[source.id]?.amount || ""}
                            onChange={(e) => setIncomeData((prev) => ({
                              ...prev,
                              [source.id]: { ...prev[source.id], amount: e.target.value },
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
                        <Input
                          type="number"
                          inputMode="decimal"
                          placeholder="0"
                          value={receiptData[receipt.id] || ""}
                          onChange={(e) => setReceiptData((prev) => ({ ...prev, [receipt.id]: e.target.value }))}
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
                        <Input
                          type="number"
                          inputMode="decimal"
                          placeholder="0"
                          value={parameterData[param.id] || ""}
                          onChange={(e) => setParameterData((prev) => ({ ...prev, [param.id]: e.target.value }))}
                          className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* עלויות עובדים */}
                <div className="flex flex-col gap-[3px]">
                  <Label className="text-white text-[15px] font-medium text-right">סה&quot;כ עלות עובדים יומית</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={editFormData.labor_cost}
                    onChange={(e) => setEditFormData({ ...editFormData, labor_cost: e.target.value })}
                    className="bg-transparent border-[#4C526B] text-white text-right h-[50px] rounded-[10px]"
                  />
                </div>

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
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={editFormData.discounts}
                    onChange={(e) => setEditFormData({ ...editFormData, discounts: e.target.value })}
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
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedEntryId === entry.id && (
                  <div className="bg-[#0F1535] rounded-[10px] border-2 border-[#FFCF00] p-[7px] mb-[10px]">
                    {isLoadingDetails ? (
                      <div className="text-white/70 text-center py-[10px]">
                        טוען פרטים...
                      </div>
                    ) : (
                      <>
                        {/* Summary Title */}
                        <div className="text-[#FFCF00] text-[18px] font-bold text-center mb-[10px]">
                          הסיכום היומי ליום {formatDate(entry.entry_date)}
                        </div>

                        {/* Summary Table */}
                        <div className="flex gap-[3px] w-full" dir="rtl">
                          {/* Labels Column */}
                          <div className="flex flex-col gap-[2px] min-w-[70px] max-w-[85px] flex-shrink-0">
                            <div className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10 font-bold">

                            </div>
                            <div className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10">
                              סה&quot;כ קופה
                            </div>
                            {entryDetails?.incomeBreakdown.map((source) => (
                              <div
                                key={source.income_source_id}
                                className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10 truncate"
                                title={source.income_source_name}
                              >
                                {source.income_source_name}
                              </div>
                            ))}
                            <div className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10">
                              ע. עובדים
                            </div>
                            {entryDetails?.productUsage.map((product) => (
                              <div
                                key={product.product_id}
                                className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10 truncate"
                                title={product.product_name}
                              >
                                {product.product_name}
                              </div>
                            ))}
                          </div>

                          {/* Daily Total Column */}
                          <div className="flex flex-col gap-[2px] flex-1 min-w-0">
                            <div className="text-white text-[11px] font-bold text-center h-[24px] flex items-center justify-center border-b border-white/10 whitespace-nowrap">
                              סה&quot;כ יומי
                            </div>
                            <div className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10">
                              <span className="ltr-num">{formatCurrency(entry.total_register)}</span>
                            </div>
                            {entryDetails?.incomeBreakdown.map((source) => (
                              <div
                                key={source.income_source_id}
                                className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10"
                              >
                                <span className="ltr-num">{formatCurrency(source.amount)}</span>
                              </div>
                            ))}
                            <div className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10">
                              <span className="ltr-num">{entry.total_register > 0 ? ((entry.labor_cost / entry.total_register) * 100).toFixed(entry.labor_cost / entry.total_register * 100 % 1 === 0 ? 0 : 2) : 0}%</span>
                            </div>
                            {entryDetails?.productUsage.map((product) => (
                              <div
                                key={product.product_id}
                                className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10"
                              >
                                <span className="ltr-num">{formatCurrency(product.quantity * product.unit_cost)}</span>
                              </div>
                            ))}
                          </div>

                          {/* Quantity Column */}
                          <div className="flex flex-col gap-[2px] flex-1 min-w-0">
                            <div className="text-white text-[11px] font-bold text-center h-[24px] flex items-center justify-center border-b border-white/10">
                              כמות
                            </div>
                            <div className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10">

                            </div>
                            {entryDetails?.incomeBreakdown.map((source) => (
                              <div
                                key={source.income_source_id}
                                className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10"
                              >
                                <span className="ltr-num">{source.orders_count}</span>
                              </div>
                            ))}
                            <div className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10">
                              <span className="ltr-num">{entry.labor_hours || 0}</span>
                            </div>
                            {entryDetails?.productUsage.map((product) => (
                              <div
                                key={product.product_id}
                                className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10"
                              >
                                <span className="ltr-num">{product.quantity}</span>
                              </div>
                            ))}
                          </div>

                          {/* Target Diff Column */}
                          <div className="flex flex-col gap-[2px] flex-1 min-w-0">
                            <div className="text-white text-[10px] font-bold text-center h-[24px] flex items-center justify-center border-b border-white/10 whitespace-nowrap">
                              הפרש מיעד
                            </div>
                            <div className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10">
                              <span className="ltr-num">0%</span>
                            </div>
                            {entryDetails?.incomeBreakdown.map((source) => (
                              <div
                                key={source.income_source_id}
                                className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10"
                              >
                                <span className="ltr-num">₪0</span>
                              </div>
                            ))}
                            <div className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10">
                              <span className="ltr-num">0%</span>
                            </div>
                            {entryDetails?.productUsage.map((product) => (
                              <div
                                key={product.product_id}
                                className="text-white text-[12px] h-[24px] flex items-center justify-center border-b border-white/10"
                              >
                                <span className="ltr-num">₪0</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Additional Info */}
                        <div className="flex flex-col gap-[5px] mt-[15px] border-t-2 border-[#FFCF00] pt-[10px]" dir="rtl">
                          <div className="flex justify-between items-center">
                            <span className="text-white text-[16px] font-bold">
                              תשלומים פתוחים:
                            </span>
                            <span className="text-white text-[16px] ltr-num">
                              ₪0
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-white text-[16px] font-bold">
                              ספקים פתוחים:
                            </span>
                            <span className="text-white text-[16px] ltr-num">
                              ₪0
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-white text-[16px] font-bold">
                              התחייבויות קודמות:
                            </span>
                            <span className="text-white text-[16px] ltr-num">
                              ₪0
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
