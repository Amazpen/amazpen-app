"use client";

import { useState, useEffect, useCallback } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { X } from "lucide-react";
import { useDashboard } from "../layout";
import { createClient } from "@/lib/supabase/client";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { useToast } from "@/components/ui/toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { uploadFile } from "@/lib/uploadFile";

// Supplier from database
interface Supplier {
  id: string;
  name: string;
  expense_type: string;
}

// Payment method summary for chart
interface PaymentMethodSummary {
  id: string;
  name: string;
  amount: number;
  percentage: number;
  color: string;
  colorClass: string;
}

// Recent payment display
interface RecentPaymentDisplay {
  id: string;
  date: string;
  supplier: string;
  paymentMethod: string;
  installments: string;
  amount: number;
  totalAmount: number;
}

// Open invoice from database
interface OpenInvoice {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  total_amount: number;
  status: string;
}

// Payment method colors
const paymentMethodColors: Record<string, { color: string; colorClass: string }> = {
  "check": { color: "#00DD23", colorClass: "bg-[#00DD23]" },
  "cash": { color: "#FF0000", colorClass: "bg-[#FF0000]" },
  "standing_order": { color: "#3964FF", colorClass: "bg-[#3964FF]" },
  "credit_companies": { color: "#FFCF00", colorClass: "bg-[#FFCF00]" },
  "credit_card": { color: "#FF3665", colorClass: "bg-[#FF3665]" },
  "bank_transfer": { color: "#FF7F00", colorClass: "bg-[#FF7F00]" },
  "bit": { color: "#9333ea", colorClass: "bg-[#9333ea]" },
  "paybox": { color: "#06b6d4", colorClass: "bg-[#06b6d4]" },
  "other": { color: "#6b7280", colorClass: "bg-[#6b7280]" },
};

// Payment method display names
const paymentMethodNames: Record<string, string> = {
  "bank_transfer": "העברה בנקאית",
  "cash": "מזומן",
  "check": "צ'ק",
  "bit": "ביט",
  "paybox": "פייבוקס",
  "credit_card": "כרטיס אשראי",
  "other": "אחר",
  "credit_companies": "חברות הקפה",
  "standing_order": "הוראת קבע",
};

// Payment method options for form
const paymentMethodOptions = [
  { value: "bank_transfer", label: "העברה בנקאית" },
  { value: "cash", label: "מזומן" },
  { value: "check", label: "צ'ק" },
  { value: "bit", label: "ביט" },
  { value: "paybox", label: "פייבוקס" },
  { value: "credit_card", label: "כרטיס אשראי" },
  { value: "other", label: "אחר" },
  { value: "credit_companies", label: "חברות הקפה" },
  { value: "standing_order", label: "הוראת קבע" },
];

export default function PaymentsPage() {
  const { selectedBusinesses } = useDashboard();
  const { showToast } = useToast();
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date } | null>(null);

  // Initialize date range after hydration to avoid server/client mismatch
  useEffect(() => {
    setDateRange({
      start: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      end: new Date(),
    });
  }, []);
  const [showAddPaymentPopup, setShowAddPaymentPopup] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Realtime subscription
  const handleRealtimeChange = useCallback(() => {
    console.log("[Payments] Realtime update received, refreshing data...");
    setRefreshTrigger(prev => prev + 1);
  }, []);

  useMultiTableRealtime(
    ["payments", "payment_splits", "suppliers"],
    handleRealtimeChange,
    selectedBusinesses.length > 0
  );

  // Data from Supabase
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [paymentMethodsData, setPaymentMethodsData] = useState<PaymentMethodSummary[]>([]);
  const [recentPaymentsData, setRecentPaymentsData] = useState<RecentPaymentDisplay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Add payment form state
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [expenseType, setExpenseType] = useState<"expenses" | "purchases">("expenses");
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  // Receipt upload state
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);

  // Supplier search helpers
  const expenseTypeMap = { expenses: "current_expenses", purchases: "goods_purchases" } as const;
  const filteredSuppliers = suppliers.filter(s =>
    s.expense_type === expenseTypeMap[expenseType] &&
    s.name.toLowerCase().includes(supplierSearch.toLowerCase())
  );
  const selectedSupplierName = suppliers.find(s => s.id === selectedSupplier)?.name || "";

  // Open invoices state
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [showOpenInvoices, setShowOpenInvoices] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());

  // Format date for display
  const formatDate = (date: Date) => {
    return date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  // Format date string from database
  const formatDateString = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  // Hebrew month names for invoice grouping
  const hebrewMonthNames = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"
  ];

  const getMonthYearKey = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  };

  const getMonthYearLabel = (key: string) => {
    const [year, month] = key.split("-");
    return `${hebrewMonthNames[parseInt(month) - 1]}, ${year}`;
  };

  const groupInvoicesByMonth = (invoices: OpenInvoice[]) => {
    const groups = new Map<string, OpenInvoice[]>();
    for (const inv of invoices) {
      const key = getMonthYearKey(inv.invoice_date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(inv);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  };

  const toggleInvoiceSelection = (invoiceId: string) => {
    setSelectedInvoiceIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(invoiceId)) newSet.delete(invoiceId);
      else newSet.add(invoiceId);

      // Update the first payment method amount to match selected invoices total
      const selectedTotal = openInvoices
        .filter(inv => newSet.has(inv.id))
        .reduce((sum, inv) => sum + Number(inv.total_amount), 0);

      if (newSet.size > 0) {
        setPaymentMethods(prev => {
          const updated = [...prev];
          const amountStr = selectedTotal.toFixed(2).replace(/\.?0+$/, "") || "0";
          updated[0] = { ...updated[0], amount: amountStr, customInstallments: generateInstallments(parseInt(updated[0].installments) || 1, selectedTotal, paymentDate) };
          return updated;
        });
      }

      return newSet;
    });
  };

  const toggleMonthExpanded = (monthKey: string) => {
    setExpandedMonths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(monthKey)) newSet.delete(monthKey);
      else newSet.add(monthKey);
      return newSet;
    });
  };

  // Fetch data from Supabase
  useEffect(() => {
    const fetchData = async () => {
      if (selectedBusinesses.length === 0 || !dateRange) {
        setPaymentMethodsData([]);
        setRecentPaymentsData([]);
        setSuppliers([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const supabase = createClient();

      try {
        // Fetch suppliers for the selected businesses
        const { data: suppliersData } = await supabase
          .from("suppliers")
          .select("id, name, expense_type")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .eq("is_active", true)
          .order("name");

        if (suppliersData) {
          setSuppliers(suppliersData);
        }

        // Fetch payments for the date range
        const startDate = dateRange.start.toISOString().split("T")[0];
        const endDate = dateRange.end.toISOString().split("T")[0];

        const { data: paymentsData } = await supabase
          .from("payments")
          .select(`
            *,
            supplier:suppliers(id, name),
            payment_splits(id, payment_method, amount, installments_count, installment_number, due_date)
          `)
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .gte("payment_date", startDate)
          .lte("payment_date", endDate)
          .order("payment_date", { ascending: false })
          .limit(50);

        if (paymentsData) {
          // Calculate payment method summary
          const methodTotals = new Map<string, number>();

          for (const payment of paymentsData) {
            if (payment.payment_splits && payment.payment_splits.length > 0) {
              for (const split of payment.payment_splits) {
                const method = split.payment_method || "other";
                const current = methodTotals.get(method) || 0;
                methodTotals.set(method, current + Number(split.amount));
              }
            } else {
              // Fallback if no splits
              const current = methodTotals.get("other") || 0;
              methodTotals.set("other", current + Number(payment.total_amount));
            }
          }

          // Calculate total for percentages
          const grandTotal = Array.from(methodTotals.values()).reduce((sum, val) => sum + val, 0);

          // Transform to display format
          const methodsSummary: PaymentMethodSummary[] = Array.from(methodTotals.entries())
            .map(([method, amount]) => ({
              id: method,
              name: paymentMethodNames[method] || method,
              amount,
              percentage: grandTotal > 0 ? (amount / grandTotal) * 100 : 0,
              color: paymentMethodColors[method]?.color || "#6b7280",
              colorClass: paymentMethodColors[method]?.colorClass || "bg-[#6b7280]",
            }))
            .sort((a, b) => b.amount - a.amount);

          setPaymentMethodsData(methodsSummary);

          // Transform recent payments to display format
          interface PaymentFromDB {
            id: string;
            payment_date: string;
            total_amount: number;
            supplier: { id: string; name: string } | null;
            payment_splits: Array<{
              id: string;
              payment_method: string;
              amount: number;
              installments_count: number | null;
              installment_number: number | null;
              due_date: string | null;
            }>;
          }

          const recentDisplay: RecentPaymentDisplay[] = (paymentsData as PaymentFromDB[]).map((p) => {
            const firstSplit = p.payment_splits?.[0];
            const installmentInfo = firstSplit?.installments_count && firstSplit?.installment_number
              ? `${firstSplit.installment_number}/${firstSplit.installments_count}`
              : "1/1";

            return {
              id: p.id,
              date: formatDateString(p.payment_date),
              supplier: p.supplier?.name || "לא ידוע",
              paymentMethod: paymentMethodNames[firstSplit?.payment_method || "other"] || "אחר",
              installments: installmentInfo,
              amount: firstSplit ? Number(firstSplit.amount) : Number(p.total_amount),
              totalAmount: Number(p.total_amount),
            };
          });

          setRecentPaymentsData(recentDisplay);
        }
      } catch (error) {
        console.error("Error fetching payments data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [selectedBusinesses, dateRange, refreshTrigger]);

  // Handle saving new payment
  const handleSavePayment = async () => {
    if (!selectedSupplier || !paymentDate || paymentMethods.every(pm => !pm.amount)) {
      showToast("נא למלא את כל השדות הנדרשים", "warning");
      return;
    }

    if (selectedBusinesses.length === 0) {
      showToast("נא לבחור עסק", "warning");
      return;
    }

    setIsSaving(true);
    const supabase = createClient();

    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Calculate total amount
      const totalAmount = paymentMethods.reduce((sum, pm) => {
        return sum + (parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0);
      }, 0);

      // Upload receipt if selected
      let receiptUrl: string | null = null;
      if (receiptFile) {
        setIsUploadingReceipt(true);
        const fileExt = receiptFile.name.split('.').pop();
        const fileName = `receipt-${Date.now()}.${fileExt}`;
        const filePath = `payments/${fileName}`;
        const result = await uploadFile(receiptFile, filePath, "attachments");
        if (result.success) {
          receiptUrl = result.publicUrl || null;
        } else {
          console.error("Receipt upload error:", result.error);
        }
        setIsUploadingReceipt(false);
      }

      // Create the payment
      const { data: newPayment, error: paymentError } = await supabase
        .from("payments")
        .insert({
          business_id: selectedBusinesses[0],
          supplier_id: selectedSupplier,
          payment_date: paymentDate,
          total_amount: totalAmount,
          invoice_id: selectedInvoiceIds.size > 0 ? Array.from(selectedInvoiceIds)[0] : null,
          notes: notes || null,
          created_by: user?.id || null,
          receipt_url: receiptUrl,
        })
        .select()
        .single();

      if (paymentError) throw paymentError;

      // Create payment splits for each payment method
      if (newPayment) {
        for (const pm of paymentMethods) {
          const amount = parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0;
          if (amount > 0) {
            const installmentsCount = parseInt(pm.installments) || 1;

            if (pm.customInstallments.length > 0) {
              // Create split for each installment
              for (const inst of pm.customInstallments) {
                await supabase
                  .from("payment_splits")
                  .insert({
                    payment_id: newPayment.id,
                    payment_method: pm.method || "other",
                    amount: inst.amount,
                    installments_count: installmentsCount,
                    installment_number: inst.number,
                    reference_number: reference || null,
                    due_date: inst.dateForInput || null,
                  });
              }
            } else {
              // Fallback - single payment without customInstallments
              await supabase
                .from("payment_splits")
                .insert({
                  payment_id: newPayment.id,
                  payment_method: pm.method || "other",
                  amount: amount,
                  installments_count: 1,
                  installment_number: 1,
                  reference_number: reference || null,
                  due_date: paymentDate || null,
                });
            }
          }
        }
      }

      // Update selected invoices - mark as paid only those that fit within the paid amount
      if (selectedInvoiceIds.size > 0) {
        const selectedInvoices = openInvoices
          .filter(inv => selectedInvoiceIds.has(inv.id))
          .sort((a, b) => Number(a.total_amount) - Number(b.total_amount));

        let remainingAmount = totalAmount;
        const paidInvoiceIds: string[] = [];

        for (const inv of selectedInvoices) {
          const invAmount = Number(inv.total_amount);
          if (invAmount <= remainingAmount) {
            paidInvoiceIds.push(inv.id);
            remainingAmount -= invAmount;
          }
        }

        // Mark fully covered invoices as paid
        if (paidInvoiceIds.length > 0) {
          const { error: invoiceUpdateError } = await supabase
            .from("invoices")
            .update({ status: "paid" })
            .in("id", paidInvoiceIds);

          if (invoiceUpdateError) {
            console.error("Error updating invoice statuses:", invoiceUpdateError);
          }
        }
      }

      // Refresh data
      handleClosePopup();
      setDateRange(prev => prev ? { ...prev } : prev);
    } catch (error) {
      console.error("Error saving payment:", error);
      showToast("שגיאה בשמירת התשלום", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Payment methods with installments - supports multiple payment methods
  interface PaymentMethodEntry {
    id: number;
    method: string;
    amount: string;
    installments: string;
    customInstallments: Array<{
      number: number;
      date: string;
      dateForInput: string;
      amount: number;
    }>;
  }

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodEntry[]>([
    { id: 1, method: "", amount: "", installments: "1", customInstallments: [] }
  ]);

  // Calculate totals
  const totalPayments = paymentMethodsData.reduce((sum, item) => sum + item.amount, 0);

  // Generate initial installments breakdown
  const generateInstallments = (numInstallments: number, totalAmount: number, startDateStr: string) => {
    if (numInstallments < 1 || totalAmount === 0) {
      return [];
    }

    const installmentAmount = totalAmount / numInstallments;
    const startDate = startDateStr ? new Date(startDateStr) : new Date();

    const result = [];
    for (let i = 0; i < numInstallments; i++) {
      const date = new Date(startDate);
      date.setMonth(date.getMonth() + i);

      result.push({
        number: i + 1,
        date: date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
        dateForInput: date.toISOString().split("T")[0],
        amount: installmentAmount,
      });
    }

    return result;
  };

  // Add new payment method entry
  const addPaymentMethodEntry = () => {
    const newId = Math.max(...paymentMethods.map(p => p.id)) + 1;
    setPaymentMethods(prev => [
      ...prev,
      { id: newId, method: "", amount: "", installments: "1", customInstallments: [] }
    ]);
  };

  // Remove payment method entry
  const removePaymentMethodEntry = (id: number) => {
    if (paymentMethods.length > 1) {
      setPaymentMethods(prev => prev.filter(p => p.id !== id));
    }
  };

  // Update payment method field
  const updatePaymentMethodField = (id: number, field: keyof PaymentMethodEntry, value: string) => {
    setPaymentMethods(prev => prev.map(p => {
      if (p.id !== id) return p;

      const updated = { ...p, [field]: value };

      // Regenerate installments when amount or installments count changes
      if (field === "amount" || field === "installments") {
        const numInstallments = parseInt(field === "installments" ? value : p.installments) || 1;
        const totalAmount = parseFloat((field === "amount" ? value : p.amount).replace(/[^\d.]/g, "")) || 0;
        updated.customInstallments = generateInstallments(numInstallments, totalAmount, paymentDate);
      }

      return updated;
    }));
  };

  // Handle installment date change for a specific payment method
  const handleInstallmentDateChange = (paymentMethodId: number, installmentIndex: number, newDate: string) => {
    setPaymentMethods(prev => prev.map(p => {
      if (p.id !== paymentMethodId) return p;
      const updatedInstallments = [...p.customInstallments];
      if (updatedInstallments[installmentIndex]) {
        const date = new Date(newDate);
        updatedInstallments[installmentIndex] = {
          ...updatedInstallments[installmentIndex],
          dateForInput: newDate,
          date: date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
        };
      }
      return { ...p, customInstallments: updatedInstallments };
    }));
  };

  // Handle installment amount change for a specific payment method
  const handleInstallmentAmountChange = (paymentMethodId: number, installmentIndex: number, newAmount: string) => {
    const amount = parseFloat(newAmount.replace(/[^\d.]/g, "")) || 0;
    setPaymentMethods(prev => prev.map(p => {
      if (p.id !== paymentMethodId) return p;
      const updatedInstallments = [...p.customInstallments];
      if (updatedInstallments[installmentIndex]) {
        updatedInstallments[installmentIndex] = {
          ...updatedInstallments[installmentIndex],
          amount: amount,
        };
      }
      return { ...p, customInstallments: updatedInstallments };
    }));
  };

  // Calculate total for a payment method's installments
  const getInstallmentsTotal = (customInstallments: PaymentMethodEntry["customInstallments"]) => {
    return customInstallments.reduce((sum, item) => sum + item.amount, 0);
  };

  // Update installments when payment date changes
  useEffect(() => {
    setPaymentMethods(prev => prev.map(p => {
      const numInstallments = parseInt(p.installments) || 1;
      const totalAmount = parseFloat(p.amount.replace(/[^\d.]/g, "")) || 0;
      if (numInstallments >= 1 && totalAmount > 0) {
        return { ...p, customInstallments: generateInstallments(numInstallments, totalAmount, paymentDate) };
      }
      return { ...p, customInstallments: [] };
    }));
  }, [paymentDate]);

  // Fetch open invoices when supplier changes
  useEffect(() => {
    const fetchOpenInvoices = async () => {
      if (!selectedSupplier) {
        setOpenInvoices([]);
        setShowOpenInvoices(false);
        setSelectedInvoiceIds(new Set());
        setExpandedMonths(new Set());
        return;
      }

      setIsLoadingInvoices(true);
      const supabase = createClient();

      try {
        const { data, error } = await supabase
          .from("invoices")
          .select("id, invoice_number, invoice_date, total_amount, status")
          .eq("supplier_id", selectedSupplier)
          .in("business_id", selectedBusinesses)
          .in("status", ["pending", "clarification"])
          .is("deleted_at", null)
          .order("invoice_date", { ascending: false });

        if (error) {
          console.error("Error fetching open invoices:", error);
          setOpenInvoices([]);
        } else {
          setOpenInvoices(data || []);
          if (data && data.length > 0) {
            const firstKey = getMonthYearKey(data[0].invoice_date);
            setExpandedMonths(new Set([firstKey]));
          }
        }
      } catch (error) {
        console.error("Error fetching open invoices:", error);
        setOpenInvoices([]);
      } finally {
        setIsLoadingInvoices(false);
      }
    };

    fetchOpenInvoices();
    setSelectedInvoiceIds(new Set());
    setShowOpenInvoices(false);
  }, [selectedSupplier, selectedBusinesses]);

  const handleClosePopup = () => {
    setShowAddPaymentPopup(false);
    // Reset form
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setExpenseType("purchases");
    setSelectedSupplier("");
    setSupplierSearch("");
    setShowSupplierDropdown(false);
    setPaymentMethods([{ id: 1, method: "", amount: "", installments: "1", customInstallments: [] }]);
    setReference("");
    setNotes("");
    setReceiptFile(null);
    setReceiptPreview(null);
    // Reset open invoices state
    setOpenInvoices([]);
    setShowOpenInvoices(false);
    setSelectedInvoiceIds(new Set());
    setExpandedMonths(new Set());
  };

  // Show message if no business selected
  if (selectedBusinesses.length === 0) {
    return (
      <div className="text-white p-[10px] pb-[80px]">
        <div className="bg-[#0F1535] rounded-[20px] p-[40px] text-center">
          <p className="text-[20px] text-white/70">יש לבחור עסק כדי לצפות בתשלומים</p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-white p-[10px] pb-[80px]">
      {/* Date Range and Add Button */}
      <div className="flex items-center justify-between mb-[10px]">
        <button
          type="button"
          onClick={() => setShowAddPaymentPopup(true)}
          className="bg-[#29318A] text-white text-[16px] font-semibold px-[20px] py-[10px] rounded-[7px] transition-colors hover:bg-[#3D44A0]"
        >
          הוספת תשלום
        </button>
        {dateRange && <DateRangePicker dateRange={dateRange} onChange={setDateRange} />}
      </div>

      {/* Chart and Summary Section */}
      <div className="bg-[#0F1535] rounded-[20px] p-[20px_10px_10px] mt-[10px]">
        {/* Header - Title and Total */}
        <div className="flex items-center justify-between px-[10px]">
          <h2 className="text-[24px] font-bold text-center">תשלומים שיצאו</h2>
          <div className="flex flex-col items-center">
            <span className="text-[24px] font-bold ltr-num">
              ₪{totalPayments.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
            <span className="text-[14px] font-bold">כולל מע&quot;מ</span>
          </div>
        </div>

        {/* Pie Chart Area */}
        <div className="relative h-[350px] min-w-[1px] min-h-[1px] flex items-center justify-center mt-[35px]">
          {paymentMethodsData.length === 0 ? (
            /* Empty State - No Data */
            <div className="flex flex-col items-center justify-center gap-[15px]">
              <svg width="280" height="280" viewBox="0 0 100 100" className="text-white/20">
                <circle cx="50" cy="50" r="47" fill="currentColor"/>
              </svg>
              <span className="text-[18px] text-white/50">אין נתוני תשלומים</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={350} minWidth={1} minHeight={1}>
              <PieChart>
                <Pie
                  data={paymentMethodsData}
                  cx="50%"
                  cy="50%"
                  outerRadius={140}
                  dataKey="amount"
                  stroke="none"
                >
                  {paymentMethodsData.map((entry) => (
                    <Cell key={entry.id} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Payment Methods Summary Table */}
        <div className="max-w-[350px] mx-auto">
          <h2 className="text-[24px] font-bold text-center mb-[20px]">סיכום לפי אמצעי תשלום</h2>

          {/* Table Header */}
          <div className="flex items-center justify-between gap-[20px] border-b border-white/20 p-[5px]">
            <span className="text-[16px] w-[110px] text-right">אמצעי תשלום</span>
            <span className="text-[16px] w-[110px] text-center">סכום לתשלום</span>
            <span className="text-[16px] w-[65px] text-center">(%) מפדיון</span>
          </div>

          {/* Table Rows */}
          <div className="flex flex-col">
            {paymentMethodsData.length === 0 ? (
              <div className="flex items-center justify-center py-[30px]">
                <span className="text-[16px] text-white/50">אין נתונים להצגה</span>
              </div>
            ) : paymentMethodsData.map((method, index) => (
              <button
                key={method.id}
                type="button"
                className={`flex items-center justify-between gap-[10px] p-[5px] min-h-[50px] hover:bg-[#29318A]/30 transition-colors rounded-[7px] ${
                  index > 0 ? "border-t border-white/10" : ""
                }`}
              >
                <div className="flex items-center gap-[5px] w-[110px]">
                  <span className={`w-[16px] h-[16px] rounded-full flex-shrink-0 ${method.colorClass}`} />
                  <span className="text-[16px] text-right">{method.name}</span>
                </div>
                <span className="text-[16px] w-[110px] text-center ltr-num">
                  ₪{method.amount.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
                <span className="text-[16px] w-[65px] text-center ltr-num">{method.percentage.toFixed(2)}%</span>
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons - only show when there's data */}
        {paymentMethodsData.length > 0 && (
          <div className="flex items-center justify-center gap-[5px]">
            <button
              type="button"
              className="flex-1 bg-[#29318A] text-white text-[18px] font-semibold py-[7px] px-[7px] rounded-tl-[5px] rounded-tr-[5px] rounded-br-[20px] rounded-bl-[5px] min-h-[50px] flex items-center justify-center gap-[8px] transition-colors hover:bg-[#3D44A0]"
            >
              <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className="flex-shrink-0">
                <path d="M12 10L18 16L12 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>צפי תשלומים קדימה</span>
            </button>
            <button
              type="button"
              className="bg-[#29318A] text-white text-[18px] font-semibold py-[7px] px-[7px] rounded-tl-[5px] rounded-tr-[5px] rounded-br-[5px] rounded-bl-[20px] min-h-[50px] flex items-center justify-center transition-colors hover:bg-[#3D44A0]"
            >
              הצגת תשלומי עבר
            </button>
          </div>
        )}
      </div>

      {/* Recent Payments Section */}
      <div className="bg-[#0F1535] rounded-[20px] p-[20px_5px] mt-[10px] flex flex-col gap-[23px]">
        {/* Header Row */}
        <div className="flex items-center justify-between px-[5px]">
          {/* Filter Dropdown */}
          <div className="relative opacity-50">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white">
              <path d="M8.07136 12.6325C4.96261 10.3075 2.74511 7.75 1.53386 6.3125C1.15886 5.8675 1.03636 5.54125 0.962611 4.9675C0.710111 3.0025 0.583861 2.02 1.16011 1.385C1.73636 0.75 2.75511 0.75 4.79261 0.75H19.2076C21.2451 0.75 22.2639 0.75 22.8401 1.38375C23.4164 2.01875 23.2901 3.00125 23.0376 4.96625C22.9626 5.54 22.8401 5.86625 22.4664 6.31125C21.2539 7.75125 19.0326 10.3137 15.9164 12.6425C15.7723 12.7546 15.6531 12.8956 15.5666 13.0564C15.4801 13.2172 15.4281 13.3942 15.4139 13.5762C15.1051 16.99 14.8201 18.86 14.6426 19.805C14.3564 21.3325 12.1926 22.2513 11.0326 23.07C10.3426 23.5575 9.50511 22.9775 9.41636 22.2225C9.08445 19.3456 8.80357 16.4631 8.57386 13.5762C8.56102 13.3925 8.50964 13.2135 8.42307 13.0509C8.33649 12.8883 8.21666 12.7457 8.07136 12.6325Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <select
              title="סינון לפי"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            >
              <option value="">בחר/י סינון</option>
              <option value="date">תאריך התשלום</option>
              <option value="supplier">ספק</option>
              <option value="paymentNumber">מספר תשלום</option>
              <option value="reference">מספר אסמכתא</option>
              <option value="installments">כמות תשלומים</option>
              <option value="amount">סכום התשלום</option>
              <option value="totalPaid">סך התשלום שבוצע</option>
              <option value="notes">הערות</option>
            </select>
          </div>

          {/* Title */}
          <h2 className="text-[24px] font-bold text-center">תשלומים אחרונים ששולמו</h2>

          {/* Empty div for spacing */}
          <div className="w-[20px]" />
        </div>

        {/* Table */}
        <div className="w-full flex flex-col">
          {/* Table Header */}
          <div className="flex items-center gap-[5px] bg-white/5 rounded-t-[7px] p-[5px_3px] mb-[10px]">
            <div className="w-[55px] flex-shrink-0 text-center">
              <span className="text-[14px]">תאריך</span>
            </div>
            <span className="text-[14px] flex-1 text-center">ספק</span>
            <span className="text-[14px] w-[45px] flex-shrink-0 text-center">תשלומים</span>
            <span className="text-[14px] w-[55px] flex-shrink-0 text-center">אמצעי</span>
            <span className="text-[14px] w-[70px] flex-shrink-0 text-center">סכום</span>
          </div>

          {/* Table Rows */}
          <div className="flex flex-col gap-[10px]">
            {recentPaymentsData.length === 0 ? (
              <div className="flex items-center justify-center py-[40px]">
                <span className="text-[16px] text-white/50">אין תשלומים להצגה</span>
              </div>
            ) : recentPaymentsData.map((payment) => (
              <div
                key={payment.id}
                className="bg-white/5 rounded-[7px] p-[7px_3px]"
              >
                <button
                  type="button"
                  className="flex items-center gap-[5px] w-full p-[5px_3px] min-h-[45px] hover:bg-[#29318A]/30 transition-colors rounded-[7px] cursor-pointer"
                >
                  {/* Date */}
                  <div className="w-[55px] flex-shrink-0 flex items-center justify-start gap-0">
                    <svg width="14" height="14" viewBox="0 0 32 32" fill="none" className="text-white/50 flex-shrink-0">
                      <path d="M20 10L14 16L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="text-[13px] font-medium ltr-num">{payment.date}</span>
                  </div>

                  {/* Supplier */}
                  <span className="text-[13px] font-medium flex-1 text-center leading-tight">{payment.supplier}</span>

                  {/* Installments */}
                  <span className="text-[13px] font-medium w-[45px] flex-shrink-0 text-center ltr-num">{payment.installments}</span>

                  {/* Payment Method */}
                  <span className="text-[13px] font-medium w-[55px] flex-shrink-0 text-center leading-tight">{payment.paymentMethod}</span>

                  {/* Amount */}
                  <div className="w-[70px] flex-shrink-0 flex flex-col items-center">
                    <span className="text-[13px] font-medium ltr-num">
                      ₪{payment.amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-[11px] font-medium ltr-num text-white/70">
                      (₪{payment.totalAmount.toLocaleString("he-IL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })})
                    </span>
                  </div>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Add Payment Popup */}
      <Sheet open={showAddPaymentPopup} onOpenChange={(open) => !open && handleClosePopup()}>
        <SheetContent
          side="bottom"
          className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
          showCloseButton={false}
        >
          <SheetHeader className="border-b border-[#4C526B] pb-4">
            <div className="flex justify-between items-center" dir="ltr">
              <button
                type="button"
                onClick={handleClosePopup}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </button>
              <SheetTitle className="text-white text-xl font-bold">הוספת תשלום חדש</SheetTitle>
              <div className="w-[24px]" />
            </div>
          </SheetHeader>

            {/* Form */}
            <div className="flex flex-col gap-[5px] px-4">
              {/* Date Field */}
              <div className="flex flex-col gap-[5px]">
                <div className="flex items-start">
                  <span className="text-[16px] font-medium text-white">תאריך קבלה</span>
                </div>
                <div className="relative border border-[#4C526B] rounded-[10px] h-[50px] px-[10px] flex items-center justify-center">
                  <span className={`text-[16px] font-semibold pointer-events-none ${paymentDate ? 'text-white' : 'text-white/40'}`}>
                    {paymentDate
                      ? new Date(paymentDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
                      : 'יום/חודש/שנה'}
                  </span>
                  <input
                    type="date"
                    title="תאריך קבלה"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                </div>
              </div>

              {/* Expense Type */}
              <div className="flex flex-col gap-[3px]">
                <div className="flex items-start">
                  <span className="text-[16px] font-medium text-white">סוג הוצאה</span>
                </div>
                <div dir="rtl" className="flex items-start gap-[20px]">
                  <button
                    type="button"
                    onClick={() => { setExpenseType("purchases"); setSelectedSupplier(""); setSupplierSearch(""); }}
                    className="flex flex-row-reverse items-center gap-[3px] cursor-pointer"
                  >
                    <span className={`text-[16px] font-semibold ${expenseType === "purchases" ? "text-white" : "text-[#979797]"}`}>
                      קניות סחורה
                    </span>
                    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={expenseType === "purchases" ? "text-white" : "text-[#979797]"}>
                      {expenseType === "purchases" ? (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                      ) : (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setExpenseType("expenses"); setSelectedSupplier(""); setSupplierSearch(""); }}
                    className="flex flex-row-reverse items-center gap-[3px] cursor-pointer"
                  >
                    <span className={`text-[16px] font-semibold ${expenseType === "expenses" ? "text-white" : "text-[#979797]"}`}>
                      הוצאות שוטפות
                    </span>
                    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={expenseType === "expenses" ? "text-white" : "text-[#979797]"}>
                      {expenseType === "expenses" ? (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                      ) : (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              {/* Supplier */}
              <div className="flex flex-col gap-[3px]">
                <div className="flex items-start">
                  <span className="text-[16px] font-medium text-white">שם ספק</span>
                </div>
                <div className="relative">
                  <div className="border border-[#4C526B] rounded-[10px] min-h-[50px] flex items-center">
                    <input
                      type="text"
                      placeholder="חפש ספק..."
                      value={showSupplierDropdown ? supplierSearch : selectedSupplierName}
                      onFocus={() => {
                        setShowSupplierDropdown(true);
                        setSupplierSearch("");
                      }}
                      onChange={(e) => setSupplierSearch(e.target.value)}
                      className="w-full h-[50px] bg-transparent text-[18px] text-white text-center focus:outline-none px-[10px] rounded-[10px]"
                    />
                    {selectedSupplier && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSupplier("");
                          setSupplierSearch("");
                          setShowSupplierDropdown(false);
                        }}
                        className="absolute left-[10px] top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {showSupplierDropdown && (
                    <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowSupplierDropdown(false)} />
                    <div className="absolute z-20 w-full mt-[2px] bg-[#0F1535] border border-[#4C526B] rounded-[10px] max-h-[200px] overflow-y-auto">
                      {filteredSuppliers.length === 0 ? (
                        <div className="p-[12px] text-center text-white/50 text-[16px]">לא נמצאו ספקים</div>
                      ) : (
                        filteredSuppliers.map((supplier) => (
                          <button
                            key={supplier.id}
                            type="button"
                            onClick={() => {
                              setSelectedSupplier(supplier.id);
                              setSupplierSearch("");
                              setShowSupplierDropdown(false);
                            }}
                            className={`w-full text-center text-[16px] py-[12px] px-[10px] transition-colors hover:bg-[#29318A]/30 ${
                              selectedSupplier === supplier.id ? "text-white bg-[#29318A]/20" : "text-white/80"
                            }`}
                          >
                            {supplier.name}
                          </button>
                        ))
                      )}
                    </div>
                    </>
                  )}
                </div>
              </div>

              {/* Open Invoices Section */}
              {openInvoices.length > 0 && (
                <div className="flex flex-col gap-[10px]">
                  <button
                    type="button"
                    onClick={() => setShowOpenInvoices(!showOpenInvoices)}
                    className="bg-[#29318A] text-white text-[18px] font-bold py-[12px] px-[24px] rounded-[5px] transition-colors hover:bg-[#3D44A0] flex items-center justify-center gap-[8px]"
                  >
                    <span>חשבוניות פתוחות ({openInvoices.length})</span>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 32 32"
                      fill="none"
                      className={`transition-transform ${showOpenInvoices ? "rotate-180" : ""}`}
                    >
                      <path d="M10 14L16 20L22 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>

                  {showOpenInvoices && (
                    <div dir="rtl" className="border border-[#4C526B] rounded-[10px] p-[10px] flex flex-col gap-[10px]">
                      {isLoadingInvoices ? (
                        <div className="text-center text-white/70 py-[20px]">טוען חשבוניות...</div>
                      ) : (
                        groupInvoicesByMonth(openInvoices).map(([monthKey, monthInvoices]) => (
                          <div key={monthKey} className="flex flex-col">
                            {/* Month Header */}
                            <button
                              type="button"
                              onClick={() => toggleMonthExpanded(monthKey)}
                              className="flex items-center gap-[5px] py-[10px] hover:bg-white/5 rounded-[7px] px-[10px] transition-colors"
                            >
                              <span className="text-[16px] font-bold text-white">{getMonthYearLabel(monthKey)}</span>
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 32 32"
                                fill="none"
                                className={`transition-transform ${expandedMonths.has(monthKey) ? "rotate-180" : ""}`}
                              >
                                <path d="M10 14L16 20L22 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>

                            {/* Month Invoices */}
                            {expandedMonths.has(monthKey) && (
                              <div className="flex flex-col">
                                {/* Column Headers */}
                                <div className="flex items-center gap-[3px] px-[7px] py-[3px] border-b border-white/20">
                                  <div className="w-[24px] flex-shrink-0" />
                                  <span className="text-[14px] text-white/70 flex-1 text-center">תאריך חשבונית</span>
                                  <span className="text-[14px] text-white/70 flex-1 text-center">אסמכתא</span>
                                  <span className="text-[14px] text-white/70 flex-1 text-center">סכום כולל מע&quot;מ</span>
                                </div>

                                {/* Invoice Rows */}
                                {monthInvoices.map((inv) => (
                                  <button
                                    key={inv.id}
                                    type="button"
                                    onClick={() => toggleInvoiceSelection(inv.id)}
                                    className={`flex items-center gap-[3px] px-[3px] py-[8px] rounded-[10px] transition-colors hover:bg-white/5 ${
                                      selectedInvoiceIds.has(inv.id) ? "bg-[#29318A]/30" : ""
                                    }`}
                                  >
                                    <div className="w-[24px] flex-shrink-0 flex items-center justify-center">
                                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                        {selectedInvoiceIds.has(inv.id) ? (
                                          <>
                                            <rect x="3" y="3" width="18" height="18" rx="3" fill="#29318A" stroke="white" strokeWidth="1.5"/>
                                            <path d="M8 12L11 15L16 9" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                          </>
                                        ) : (
                                          <rect x="3" y="3" width="18" height="18" rx="3" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" fill="none"/>
                                        )}
                                      </svg>
                                    </div>
                                    <span className="text-[14px] text-white flex-1 text-center ltr-num">
                                      {new Date(inv.invoice_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                                    </span>
                                    <span className="text-[14px] text-white flex-1 text-center ltr-num">
                                      {inv.invoice_number || "-"}
                                    </span>
                                    <span className="text-[14px] text-white flex-1 text-center ltr-num">
                                      ₪{Number(inv.total_amount).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      )}

                      {/* Selected Summary */}
                      {selectedInvoiceIds.size > 0 && (
                        <div className="flex items-center justify-between bg-[#29318A]/20 rounded-[7px] p-[10px] border border-[#29318A]">
                          <span className="text-[14px] text-white">
                            נבחרו {selectedInvoiceIds.size} חשבוניות
                          </span>
                          <span className="text-[16px] text-white font-bold ltr-num">
                            ₪{openInvoices
                              .filter(inv => selectedInvoiceIds.has(inv.id))
                              .reduce((sum, inv) => sum + Number(inv.total_amount), 0)
                              .toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Payment Methods Section */}
              <div className="flex flex-col gap-[15px]">
                <div className="flex items-center justify-between">
                  <span className="text-[16px] font-medium text-white">אמצעי תשלום</span>
                  <button
                    type="button"
                    onClick={addPaymentMethodEntry}
                    className="bg-[#29318A] text-white text-[14px] font-medium px-[12px] py-[6px] rounded-[7px] hover:bg-[#3D44A0] transition-colors"
                  >
                    + הוסף אמצעי תשלום
                  </button>
                </div>

                {paymentMethods.map((pm, pmIndex) => (
                  <div key={pm.id} className="border border-[#4C526B] rounded-[10px] p-[10px] flex flex-col gap-[10px]">
                    {/* Header with remove button */}
                    {paymentMethods.length > 1 && (
                      <div className="flex items-center justify-between mb-[5px]">
                        <span className="text-[14px] text-white/70">אמצעי תשלום {pmIndex + 1}</span>
                        <button
                          type="button"
                          onClick={() => removePaymentMethodEntry(pm.id)}
                          className="text-[14px] text-red-400 hover:text-red-300 transition-colors"
                        >
                          הסר
                        </button>
                      </div>
                    )}

                    {/* Payment Method Select */}
                    <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
                      <select
                        title="בחירת אמצעי תשלום"
                        value={pm.method}
                        onChange={(e) => updatePaymentMethodField(pm.id, "method", e.target.value)}
                        className="w-full h-[50px] bg-[#0F1535] text-[18px] text-white text-center focus:outline-none rounded-[10px] cursor-pointer select-dark"
                      >
                        <option value="" disabled>בחר אמצעי תשלום...</option>
                        {paymentMethodOptions.map((method) => (
                          <option key={method.value} value={method.value}>{method.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Payment Amount */}
                    <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={pm.amount}
                        onChange={(e) => updatePaymentMethodField(pm.id, "amount", e.target.value)}
                        placeholder="₪0.00 סכום"
                        className="w-full h-[50px] bg-transparent text-[18px] text-white text-right focus:outline-none px-[10px] rounded-[10px]"
                      />
                    </div>

                    {/* Installments */}
                    <div className="flex flex-col gap-[3px]">
                      <span className="text-[14px] text-white/70">כמות תשלומים</span>
                      <div className="border border-[#4C526B] rounded-[10px] min-h-[50px] flex items-center">
                        <button
                          type="button"
                          title="הפחת תשלום"
                          onClick={() => updatePaymentMethodField(pm.id, "installments", String(Math.max(1, parseInt(pm.installments) - 1)))}
                          className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
                        >
                          -
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          title="כמות תשלומים"
                          value={pm.installments}
                          onChange={(e) => updatePaymentMethodField(pm.id, "installments", e.target.value.replace(/\D/g, "") || "1")}
                          className="flex-1 h-[50px] bg-transparent text-[18px] text-white text-center focus:outline-none"
                        />
                        <button
                          type="button"
                          title="הוסף תשלום"
                          onClick={() => updatePaymentMethodField(pm.id, "installments", String(parseInt(pm.installments) + 1))}
                          className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
                        >
                          +
                        </button>
                      </div>

                      {/* Installments Breakdown */}
                      {pm.customInstallments.length > 0 && (
                        <div className="mt-[10px] border border-[#4C526B] rounded-[10px] p-[10px]">
                          <div className="flex items-center gap-[8px] border-b border-[#4C526B] pb-[8px] mb-[8px]">
                            <span className="text-[14px] font-medium text-white/70 w-[50px] text-center flex-shrink-0">תשלום</span>
                            <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תאריך</span>
                            <span className="text-[14px] font-medium text-white/70 flex-1 text-center">סכום</span>
                          </div>
                          <div className="flex flex-col gap-[8px] max-h-[200px] overflow-y-auto">
                            {pm.customInstallments.map((item, index) => (
                              <div key={item.number} className="flex items-center gap-[8px]">
                                <span className="text-[14px] text-white ltr-num w-[50px] text-center flex-shrink-0">{item.number}/{pm.installments}</span>
                                <div className="flex-1 h-[36px] bg-[#29318A]/30 border border-[#4C526B] rounded-[7px] relative flex items-center justify-center">
                                  <span className="text-[14px] text-white pointer-events-none ltr-num">
                                    {item.dateForInput ? new Date(item.dateForInput).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''}
                                  </span>
                                  <input
                                    type="date"
                                    title={`תאריך תשלום ${item.number}`}
                                    value={item.dateForInput}
                                    onChange={(e) => handleInstallmentDateChange(pm.id, index, e.target.value)}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                  />
                                </div>
                                <div className="flex-1 relative">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    title={`סכום תשלום ${item.number}`}
                                    value={item.amount.toFixed(2)}
                                    onChange={(e) => handleInstallmentAmountChange(pm.id, index, e.target.value)}
                                    className="w-full h-[36px] bg-[#29318A]/30 border border-[#4C526B] rounded-[7px] text-[14px] text-white text-center focus:outline-none focus:border-white/50 px-[5px] ltr-num"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-[8px] border-t border-[#4C526B] pt-[8px] mt-[8px]">
                            <span className="text-[14px] font-bold text-white w-[50px] text-center flex-shrink-0">סה&quot;כ</span>
                            <span className="flex-1"></span>
                            <span className="text-[14px] font-bold text-white ltr-num flex-1 text-center">
                              ₪{getInstallmentsTotal(pm.customInstallments).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Reference */}
              <div className="flex flex-col gap-[3px]">
                <div className="flex items-start">
                  <span className="text-[16px] font-medium text-white">אסמכתא</span>
                </div>
                <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="מספר אסמכתא..."
                    className="w-full h-[50px] bg-transparent text-[18px] text-white text-right focus:outline-none px-[10px] rounded-[10px]"
                  />
                </div>
              </div>

              {/* Receipt Upload */}
              <div className="flex flex-col gap-[3px]">
                <div className="flex items-start">
                  <span className="text-[16px] font-medium text-white">קבלת תשלום</span>
                </div>
                {receiptPreview ? (
                  <div className="border border-[#4C526B] rounded-[10px] p-[10px] flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => { setReceiptFile(null); setReceiptPreview(null); }}
                      className="text-[#F64E60] text-[14px] hover:underline"
                    >
                      הסר
                    </button>
                    <div className="flex items-center gap-[10px]">
                      <span className="text-[14px] text-white/70 truncate max-w-[150px]">
                        {receiptFile?.name || "קובץ"}
                      </span>
                      <button
                        type="button"
                        title="צפייה בקובץ"
                        onClick={() => window.open(receiptPreview, '_blank')}
                        className="text-white/70 hover:text-white"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                          <circle cx="8.5" cy="8.5" r="1.5"/>
                          <polyline points="21 15 16 10 5 21"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="border border-[#4C526B] border-dashed rounded-[10px] h-[60px] flex items-center justify-center px-[10px] cursor-pointer hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-[10px]">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/50">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                      <span className="text-[14px] text-white/50">לחץ להעלאת תמונה/מסמך</span>
                    </div>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setReceiptFile(file);
                          setReceiptPreview(URL.createObjectURL(file));
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                )}
                {isUploadingReceipt && (
                  <span className="text-[12px] text-white/50 text-center">מעלה קובץ...</span>
                )}
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-[3px]">
                <div className="flex items-start">
                  <span className="text-[16px] font-medium text-white">הערות</span>
                </div>
                <div className="border border-[#4C526B] rounded-[10px] min-h-[100px]">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="הערות..."
                    className="w-full h-[100px] bg-transparent text-[18px] text-white text-right focus:outline-none px-[10px] py-[10px] rounded-[10px] resize-none"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="button"
                onClick={handleSavePayment}
                disabled={isSaving || isUploadingReceipt}
                className="w-full bg-[#29318A] text-white text-[18px] font-semibold py-[14px] rounded-[10px] mt-[20px] transition-colors hover:bg-[#3D44A0] disabled:opacity-50"
              >
                {isSaving ? "שומר..." : isUploadingReceipt ? "מעלה קובץ..." : "הוספת תשלום"}
              </button>
            </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
