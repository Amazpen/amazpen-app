"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { X } from "lucide-react";
import { useDashboard } from "../layout";
import { createClient } from "@/lib/supabase/client";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { useToast } from "@/components/ui/toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { uploadFile } from "@/lib/uploadFile";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useFormDraft } from "@/hooks/useFormDraft";
import SupplierSearchSelect from "@/components/ui/SupplierSearchSelect";

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
interface LinkedInvoice {
  id: string;
  invoiceNumber: string | null;
  date: string;
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  attachmentUrl: string | null;
}

interface RecentPaymentDisplay {
  id: string;
  date: string;
  supplier: string;
  paymentMethod: string;
  installments: string;
  amount: number;
  totalAmount: number;
  subtotal: number;
  vatAmount: number;
  notes: string | null;
  receiptUrl: string | null;
  reference: string | null;
  checkNumber: string | null;
  createdBy: string | null;
  createdAt: string | null;
  linkedInvoice: LinkedInvoice | null;
}

// Open invoice from database
interface OpenInvoice {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  total_amount: number;
  status: string;
}

// Forecast: upcoming payment split with supplier info
interface ForecastSplit {
  id: string;
  due_date: string;
  amount: number;
  payment_method: string;
  installment_number: number | null;
  installments_count: number | null;
  supplier_name: string;
  payment_id: string;
  receipt_url: string | null;
}

// Forecast: month group
interface ForecastMonth {
  key: string; // YYYY-MM
  label: string; // "חודש פברואר, 2026"
  total: number;
  splits: ForecastSplit[];
}

// Commitment: ongoing obligation (multi-installment payment)
interface Commitment {
  payment_id: string;
  supplier_name: string;
  notes: string | null;
  monthly_amount: number;
  last_due_date: string;
  remaining_count: number;
  installments_count: number;
}

// Supplier breakdown per payment method (for popup)
interface MethodSupplierEntry {
  supplierName: string;
  amount: number;
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

// Hebrew day names for forecast dates
const hebrewDayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const hebrewMonthNamesConst = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"
];

function formatForecastDate(dateStr: string): string {
  const date = new Date(dateStr);
  const day = hebrewDayNames[date.getDay()];
  const d = date.getDate();
  const month = hebrewMonthNamesConst[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${d} ${month}, ${year}`;
}

function formatForecastDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getFullYear()).slice(2)}`;
}

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
  const [savedDateRange, setSavedDateRange] = usePersistedState<{ start: string; end: string } | null>("payments:dateRange", null);
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date } | null>(null);

  // Initialize date range after hydration to avoid server/client mismatch
  useEffect(() => {
    if (savedDateRange) {
      setDateRange({ start: new Date(savedDateRange.start), end: new Date(savedDateRange.end) });
    } else {
      setDateRange({
        start: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        end: new Date(),
      });
    }
  }, []);

  const handleDateRangeChange = useCallback((range: { start: Date; end: Date }) => {
    setDateRange(range);
    setSavedDateRange({ start: range.start.toISOString(), end: range.end.toISOString() });
  }, [setSavedDateRange]);

  // Draft persistence for add payment form
  const paymentDraftKey = `paymentForm:draft:${selectedBusinesses[0] || "none"}`;
  const { saveDraft: savePaymentDraft, restoreDraft: restorePaymentDraft, clearDraft: clearPaymentDraft } = useFormDraft(paymentDraftKey);
  const paymentDraftRestored = useRef(false);

  const [showAddPaymentPopup, setShowAddPaymentPopup] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Realtime subscription
  const handleRealtimeChange = useCallback(() => {
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
  const [methodSupplierBreakdown, setMethodSupplierBreakdown] = useState<Record<string, MethodSupplierEntry[]>>({});
  const [selectedMethodPopup, setSelectedMethodPopup] = useState<PaymentMethodSummary | null>(null);
  const [recentPaymentsData, setRecentPaymentsData] = useState<RecentPaymentDisplay[]>([]);
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [showLinkedInvoices, setShowLinkedInvoices] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Add payment form state
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [expenseType, setExpenseType] = useState<"expenses" | "purchases" | "employees">("expenses");
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  // Receipt upload state
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);

  // Save payment form draft
  const savePaymentDraftData = useCallback(() => {
    if (!showAddPaymentPopup) return;
    savePaymentDraft({
      paymentDate, expenseType, selectedSupplier,
      reference, notes,
    });
  }, [savePaymentDraft, showAddPaymentPopup,
    paymentDate, expenseType, selectedSupplier,
    reference, notes]);

  useEffect(() => {
    if (paymentDraftRestored.current) {
      savePaymentDraftData();
    }
  }, [savePaymentDraftData]);

  // Restore payment draft when popup opens
  useEffect(() => {
    if (showAddPaymentPopup) {
      paymentDraftRestored.current = false;
      setTimeout(() => {
        const draft = restorePaymentDraft();
        if (draft) {
          if (draft.paymentDate) setPaymentDate(draft.paymentDate as string);
          if (draft.expenseType) setExpenseType(draft.expenseType as "expenses" | "purchases" | "employees");
          if (draft.selectedSupplier) setSelectedSupplier(draft.selectedSupplier as string);
          if (draft.reference) setReference(draft.reference as string);
          if (draft.notes !== undefined) setNotes(draft.notes as string);
        }
        paymentDraftRestored.current = true;
      }, 0);
    }
  }, [showAddPaymentPopup, restorePaymentDraft]);

  // Supplier filtering by expense type
  const expenseTypeMap = { expenses: "current_expenses", purchases: "goods_purchases", employees: "employee_costs" } as const;
  const filteredSuppliers = suppliers.filter(s =>
    s.expense_type === expenseTypeMap[expenseType]
  );

  // Open invoices state
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [showOpenInvoices, setShowOpenInvoices] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());

  // Forecast state
  const [showForecast, setShowForecast] = useState(false);
  const [forecastMonths, setForecastMonths] = useState<ForecastMonth[]>([]);
  const [forecastTotal, setForecastTotal] = useState(0);
  const [isLoadingForecast, setIsLoadingForecast] = useState(false);
  const [expandedForecastMonths, setExpandedForecastMonths] = useState<Set<string>>(new Set());
  const [expandedForecastDates, setExpandedForecastDates] = useState<Set<string>>(new Set());
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [showCommitments, setShowCommitments] = useState(false);

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
            payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number),
            invoice:invoices(id, invoice_number, invoice_date, subtotal, vat_amount, total_amount, attachment_url),
            creator:profiles!payments_created_by_fkey(full_name)
          `)
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .gte("payment_date", startDate)
          .lte("payment_date", endDate)
          .order("payment_date", { ascending: false })
          .limit(50);

        if (paymentsData) {
          // Calculate payment method summary + supplier breakdown per method
          const methodTotals = new Map<string, number>();
          const methodSuppliers = new Map<string, Map<string, number>>();

          for (const payment of paymentsData) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const supplierName = (payment as any).supplier?.name || "לא ידוע";
            if (payment.payment_splits && payment.payment_splits.length > 0) {
              for (const split of payment.payment_splits) {
                const method = split.payment_method || "other";
                const amount = Number(split.amount);
                const current = methodTotals.get(method) || 0;
                methodTotals.set(method, current + amount);
                // Track supplier breakdown
                if (!methodSuppliers.has(method)) methodSuppliers.set(method, new Map());
                const supplierMap = methodSuppliers.get(method)!;
                supplierMap.set(supplierName, (supplierMap.get(supplierName) || 0) + amount);
              }
            } else {
              // Fallback if no splits
              const amount = Number(payment.total_amount);
              const current = methodTotals.get("other") || 0;
              methodTotals.set("other", current + amount);
              if (!methodSuppliers.has("other")) methodSuppliers.set("other", new Map());
              const supplierMap = methodSuppliers.get("other")!;
              supplierMap.set(supplierName, (supplierMap.get(supplierName) || 0) + amount);
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

          // Build supplier breakdown lookup
          const breakdown: Record<string, MethodSupplierEntry[]> = {};
          for (const [method, supplierMap] of methodSuppliers.entries()) {
            breakdown[method] = Array.from(supplierMap.entries())
              .map(([name, amt]) => ({ supplierName: name, amount: amt }))
              .sort((a, b) => b.amount - a.amount);
          }
          setMethodSupplierBreakdown(breakdown);

          // Transform recent payments to display format
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const recentDisplay: RecentPaymentDisplay[] = (paymentsData as any[]).map((p) => {
            const firstSplit = p.payment_splits?.[0];
            const installmentInfo = firstSplit?.installments_count && firstSplit?.installment_number
              ? `${firstSplit.installment_number}/${firstSplit.installments_count}`
              : "1/1";

            // Calculate subtotal/vat from total (assume 18% VAT if not from invoice)
            const total = Number(p.total_amount);
            const inv = p.invoice;
            const subtotal = inv ? Number(inv.subtotal) : Math.round(total / 1.18 * 100) / 100;
            const vatAmount = inv ? Number(inv.vat_amount) : Math.round((total - subtotal) * 100) / 100;

            return {
              id: p.id,
              date: formatDateString(p.payment_date),
              supplier: p.supplier?.name || "לא ידוע",
              paymentMethod: paymentMethodNames[firstSplit?.payment_method || "other"] || "אחר",
              installments: installmentInfo,
              amount: firstSplit ? Number(firstSplit.amount) : total,
              totalAmount: total,
              subtotal,
              vatAmount,
              notes: p.notes || null,
              receiptUrl: p.receipt_url || null,
              reference: firstSplit?.reference_number || null,
              checkNumber: firstSplit?.check_number || null,
              createdBy: p.creator?.full_name || null,
              createdAt: p.created_at ? formatDateString(p.created_at.split("T")[0]) : null,
              linkedInvoice: inv ? {
                id: inv.id,
                invoiceNumber: inv.invoice_number,
                date: formatDateString(inv.invoice_date),
                subtotal: Number(inv.subtotal),
                vatAmount: Number(inv.vat_amount),
                totalAmount: Number(inv.total_amount),
                attachmentUrl: inv.attachment_url,
              } : null,
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

  // Fetch forecast data (upcoming payment splits)
  const fetchForecast = useCallback(async () => {
    if (selectedBusinesses.length === 0) {
      setForecastMonths([]);
      setForecastTotal(0);
      setCommitments([]);
      return;
    }

    setIsLoadingForecast(true);
    const supabase = createClient();
    const today = new Date().toISOString().split("T")[0];

    try {
      const { data, error } = await supabase
        .from("payment_splits")
        .select(`
          id, due_date, amount, payment_method, installment_number, installments_count,
          payment:payments!inner(id, business_id, deleted_at, receipt_url, notes, supplier:suppliers(name))
        `)
        .gte("due_date", today)
        .is("payment.deleted_at", null)
        .in("payment.business_id", selectedBusinesses)
        .order("due_date", { ascending: true })
        .limit(500);

      if (error) {
        showToast("שגיאה בטעינת צפי תשלומים", "error");
        setIsLoadingForecast(false);
        return;
      }

      if (!data || data.length === 0) {
        setForecastMonths([]);
        setForecastTotal(0);
        setCommitments([]);
        setIsLoadingForecast(false);
        return;
      }

      // Group by month for forecast
      const monthMap = new Map<string, ForecastSplit[]>();
      let total = 0;

      // Also build commitments from the same data (installments_count > 3)
      const commitMap = new Map<string, { amount: number; due_dates: string[]; payment: { id: string; notes: string | null; supplier_name: string } }>();

      for (const row of data) {
        const payment = row.payment as unknown as { id: string; receipt_url: string | null; notes: string | null; supplier: { name: string } | null };
        if (!row.due_date) continue;

        const split: ForecastSplit = {
          id: row.id,
          due_date: row.due_date,
          amount: Number(row.amount),
          payment_method: row.payment_method,
          installment_number: row.installment_number,
          installments_count: row.installments_count,
          supplier_name: payment?.supplier?.name || "לא ידוע",
          payment_id: payment?.id || "",
          receipt_url: payment?.receipt_url || null,
        };

        total += split.amount;

        const date = new Date(row.due_date);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        if (!monthMap.has(key)) monthMap.set(key, []);
        monthMap.get(key)!.push(split);

        // Collect commitment data (multi-installment payments)
        if ((row.installments_count || 0) > 3) {
          const commitKey = `${payment?.id}__${row.amount}`;
          if (!commitMap.has(commitKey)) {
            commitMap.set(commitKey, {
              amount: Number(row.amount),
              due_dates: [],
              payment: { id: payment?.id || "", notes: payment?.notes || null, supplier_name: payment?.supplier?.name || "לא ידוע" },
            });
          }
          commitMap.get(commitKey)!.due_dates.push(row.due_date);
        }
      }

      const months: ForecastMonth[] = Array.from(monthMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, splits]) => {
          const [year, month] = key.split("-");
          return {
            key,
            label: `${hebrewMonthNames[parseInt(month) - 1]}, ${year}`,
            total: splits.reduce((sum, s) => sum + s.amount, 0),
            splits,
          };
        });

      setForecastMonths(months);
      setForecastTotal(total);
      // Auto-expand first month
      if (months.length > 0) {
        setExpandedForecastMonths(new Set([months[0].key]));
      }

      // Build commitments list from collected data
      if (commitMap.size > 0) {
        const commitList: Commitment[] = Array.from(commitMap.values()).map(({ amount, due_dates, payment: p }) => {
          const lastDate = due_dates.sort().reverse()[0];
          return {
            payment_id: p.id,
            supplier_name: p.supplier_name,
            notes: p.notes,
            monthly_amount: amount,
            last_due_date: lastDate,
            remaining_count: due_dates.length,
            installments_count: due_dates.length,
          };
        });
        commitList.sort((a, b) => b.monthly_amount - a.monthly_amount);
        setCommitments(commitList);
      } else {
        setCommitments([]);
      }
    } catch (err) {
      console.error("Error fetching forecast:", err);
      showToast("שגיאה בטעינת צפי תשלומים", "error");
    } finally {
      setIsLoadingForecast(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinesses]);

  // Fetch forecast when toggled on
  useEffect(() => {
    if (showForecast) {
      fetchForecast();
    }
  }, [showForecast, refreshTrigger, fetchForecast]);

  const toggleForecastMonth = useCallback((key: string) => {
    setExpandedForecastMonths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) newSet.delete(key);
      else newSet.add(key);
      return newSet;
    });
  }, []);

  const toggleForecastDate = useCallback((key: string) => {
    setExpandedForecastDates(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) newSet.delete(key);
      else newSet.add(key);
      return newSet;
    });
  }, []);

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

    // Validate installments sum matches payment amount
    for (const pm of paymentMethods) {
      if (pm.customInstallments.length > 0) {
        const pmTotal = parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0;
        const installmentsTotal = getInstallmentsTotal(pm.customInstallments);
        if (Math.abs(installmentsTotal - pmTotal) > 0.01) {
          showToast(`סכום התשלומים (${installmentsTotal.toFixed(2)}) לא תואם לסכום לתשלום (${pmTotal.toFixed(2)})`, "warning");
          return;
        }
      }
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
      clearPaymentDraft();
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
      const totalAmount = parseFloat(p.amount.replace(/[^\d.]/g, "")) || 0;
      const updatedInstallments = [...p.customInstallments];
      if (updatedInstallments[installmentIndex]) {
        // Cap the amount to the total so a single installment can't exceed it
        const cappedAmount = Math.min(amount, totalAmount);
        updatedInstallments[installmentIndex] = {
          ...updatedInstallments[installmentIndex],
          amount: cappedAmount,
        };
        // Distribute the remainder equally among the other installments
        const remaining = totalAmount - cappedAmount;
        const otherCount = updatedInstallments.length - 1;
        if (otherCount > 0) {
          const perOther = Math.floor((remaining / otherCount) * 100) / 100;
          let distributed = 0;
          updatedInstallments.forEach((inst, idx) => {
            if (idx !== installmentIndex) {
              if (idx === updatedInstallments.findLastIndex((_, i) => i !== installmentIndex)) {
                // Last "other" installment gets the remainder to avoid rounding issues
                updatedInstallments[idx] = { ...inst, amount: Math.round((remaining - distributed) * 100) / 100 };
              } else {
                updatedInstallments[idx] = { ...inst, amount: perOther };
                distributed += perOther;
              }
            }
          });
        }
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
          id="onboarding-payments-import"
          type="button"
          onClick={() => setShowAddPaymentPopup(true)}
          className="bg-[#29318A] text-white text-[16px] font-semibold px-[20px] py-[10px] rounded-[7px] transition-colors hover:bg-[#3D44A0]"
        >
          הוספת תשלום
        </button>
        {dateRange && <DateRangePicker dateRange={dateRange} onChange={handleDateRangeChange} />}
      </div>

      {/* Chart and Summary Section */}
      <div id="onboarding-payments-chart" className="bg-[#0F1535] rounded-[20px] p-[20px_10px_10px] mt-[10px]">
        {/* Header - Title and Total - hidden when no data */}
        {paymentMethodsData.length > 0 && (
          <div className="flex items-center justify-between px-[10px]">
            <h2 className="text-[24px] font-bold text-center">תשלומים שיצאו</h2>
            <div className="flex flex-col items-center">
              <span className="text-[24px] font-bold ltr-num">
                ₪{totalPayments.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
              <span className="text-[14px] font-bold">כולל מע&quot;מ</span>
            </div>
          </div>
        )}

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

        {/* Payment Methods Summary Table - hidden when no data */}
        {paymentMethodsData.length > 0 && (
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
                onClick={() => setSelectedMethodPopup(method)}
                className={`flex items-center justify-between gap-[10px] p-[5px] min-h-[50px] hover:bg-[#29318A]/30 transition-colors rounded-[7px] cursor-pointer ${
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
        )}

        {/* Payment Method Supplier Breakdown Popup */}
        {selectedMethodPopup && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-[10px]" onClick={() => setSelectedMethodPopup(null)}>
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50" />
            {/* Popup */}
            <div
              dir="rtl"
              className="relative bg-[#0f1535] rounded-[10px] p-[10px] w-full max-w-[350px] min-h-[300px] max-h-[500px] overflow-y-auto z-[2002]"
              style={{ boxShadow: "rgba(0, 0, 0, 0.2) 0px 0px 20px 0px" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <div className="flex justify-start">
                <button
                  type="button"
                  onClick={() => setSelectedMethodPopup(null)}
                  className="opacity-50 hover:opacity-100 transition-opacity mb-[10px]"
                >
                  <X size={24} className="text-white" />
                </button>
              </div>

              {/* Header - method name and total */}
              <div className="flex items-center justify-between mx-[10px] mb-[15px]">
                <span className="text-[25px] font-semibold text-white text-center">{selectedMethodPopup.name}</span>
                <div className="flex flex-col items-center">
                  <span className="text-[25px] font-semibold text-white text-center ltr-num">
                    ₪{selectedMethodPopup.amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[14px] text-white text-center">כולל מע&apos;מ</span>
                </div>
              </div>

              {/* Table header */}
              <div className="flex items-center justify-between min-h-[40px] border-b border-white/20 px-[5px]">
                <span className="text-[16px] font-medium text-white flex-1">שם ספק</span>
                <span className="text-[16px] font-medium text-white w-[120px] text-center">סכום התשלום</span>
              </div>

              {/* Supplier rows */}
              <div className="flex flex-col">
                {(methodSupplierBreakdown[selectedMethodPopup.id] || []).map((entry, idx) => (
                  <div
                    key={entry.supplierName}
                    className={`flex items-center justify-between min-h-[40px] px-[5px] pt-[10px] ${
                      idx > 0 ? "border-t border-white/20" : ""
                    }`}
                  >
                    <span className="text-[14px] font-bold text-white flex-1">{entry.supplierName}</span>
                    <span className="text-[14px] font-bold text-white w-[120px] text-center ltr-num">
                      ₪{entry.amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons - only show when there's data */}
        {paymentMethodsData.length > 0 && (
          <div className="flex items-center justify-center gap-[5px]">
            <button
              type="button"
              onClick={() => setShowForecast(!showForecast)}
              className={`flex-1 text-white text-[18px] font-semibold py-[7px] px-[7px] rounded-tl-[5px] rounded-tr-[5px] rounded-br-[20px] rounded-bl-[5px] min-h-[50px] flex items-center justify-center gap-[8px] transition-colors ${showForecast ? "bg-[#3D44A0]" : "bg-[#29318A] hover:bg-[#3D44A0]"}`}
            >
              <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={`flex-shrink-0 transition-transform ${showForecast ? "rotate-90" : ""}`}>
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

      {/* Forecast Section - צפי תשלומים קדימה */}
      {showForecast && (
        <div className="bg-[#0F1535] rounded-[20px] p-[20px_5px] mt-[10px] flex flex-col gap-[10px]">
          {isLoadingForecast ? (
            <div className="flex items-center justify-center py-[40px]">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </div>
          ) : forecastMonths.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-[30px] gap-[8px]">
              <span className="text-[18px] text-white/50">אין תשלומים עתידיים</span>
              <span className="text-[14px] text-white/30">כל התשלומים שולמו או שאין תשלומים עם תאריך יעד</span>
            </div>
          ) : (
            <>
              {/* Total Header */}
              <h2 className="text-[18px] font-bold text-white text-center px-[10px]">
                {`סה"כ תשלומים פתוחים: ₪${forecastTotal.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </h2>

              {/* Monthly Groups */}
              <div className="border border-white rounded-[7px] mx-[5px] overflow-hidden">
                {forecastMonths.map((month, mi) => {
                  const isExpanded = expandedForecastMonths.has(month.key);

                  // Group splits by due_date within this month
                  const dateGroups = new Map<string, ForecastSplit[]>();
                  for (const split of month.splits) {
                    const key = split.due_date;
                    if (!dateGroups.has(key)) dateGroups.set(key, []);
                    dateGroups.get(key)!.push(split);
                  }
                  const dateGroupsArr = Array.from(dateGroups.entries()).sort((a, b) => a[0].localeCompare(b[0]));

                  return (
                    <div key={month.key} className={`${mi > 0 ? "border-t-[5px] border-transparent" : ""}`}>
                      {/* Month Header - clickable to expand/collapse */}
                      <button
                        type="button"
                        onClick={() => toggleForecastMonth(month.key)}
                        className="w-full flex items-center justify-between px-[10px] py-[8px] hover:bg-white/5 transition-colors"
                      >
                        <div className="flex items-center gap-[5px]">
                          <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className={`text-white transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                            <path d="M20 10L14 16L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <span className="text-[18px] font-bold text-white">{`חודש ${month.label}`}</span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[16px] font-normal text-white">
                            {`₪${month.total.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          </span>
                          <span className="text-[12px] font-bold text-white">{`סה"כ לתשלום`}</span>
                        </div>
                      </button>

                      {/* Expanded Content */}
                      {isExpanded && (
                        <div className="px-[5px] pb-[10px]">
                          {dateGroupsArr.map(([dateKey, splits]) => {
                            const dateExpanded = expandedForecastDates.has(`${month.key}__${dateKey}`);
                            return (
                            <div key={dateKey} className="bg-white/5 border border-white/25 rounded-[7px] p-[3px_0px_3px_5px] mt-[10px]">
                              {/* Date Group Header - clickable */}
                              <button
                                type="button"
                                onClick={() => toggleForecastDate(`${month.key}__${dateKey}`)}
                                className="w-full flex items-center justify-between pb-[3px] hover:bg-white/5 transition-colors rounded-[5px]"
                              >
                                <div className="flex items-center gap-[5px]">
                                  <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className={`text-white transition-transform ${dateExpanded ? "rotate-90" : ""}`}>
                                    <path d="M20 10L14 16L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                  <span className="text-[16px] text-white">{formatForecastDate(dateKey)}</span>
                                </div>
                                <div className="flex flex-col items-end">
                                  <span className="text-[16px] text-white">
                                    {`₪${splits.reduce((s, sp) => s + sp.amount, 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                  </span>
                                  <span className="text-[12px] font-bold text-white">{`סה"כ לתשלום`}</span>
                                </div>
                              </button>

                              {/* Table - hidden until date header is clicked */}
                              {dateExpanded && (
                                <>
                                  {/* Table Header */}
                                  <div className="flex flex-row-reverse items-center rounded-t-[7px] border-b border-white/25 pb-[2px] mb-[5px] mt-[5px]">
                                    <span className="flex-1 text-[14px] font-medium text-white text-center">תאריך התשלום</span>
                                    <span className="flex-1 text-[14px] text-white text-center">ספק</span>
                                    <span className="flex-1 text-[14px] font-medium text-white text-center">סכום לתשלום</span>
                                    <span className="flex-1 text-[14px] font-medium text-white text-center">אמצאי תשלום</span>
                                  </div>

                                  {/* Payment Rows */}
                                  {splits.map((split) => (
                                    <div key={split.id} className="flex flex-row-reverse items-center rounded-[7px] min-h-[45px] py-[3px]">
                                      <span className="flex-1 text-[14px] text-white text-center">{formatForecastDateShort(split.due_date)}</span>
                                      <span className="flex-1 text-[14px] text-white text-center truncate">{split.supplier_name}</span>
                                      <span className="flex-1 text-[14px] text-white text-center">
                                        {`₪${split.amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                      </span>
                                      <span className="flex-1 text-[14px] text-white text-center">
                                        {paymentMethodNames[split.payment_method] || "אחר"}
                                      </span>
                                      {split.receipt_url && /^https?:\/\//.test(split.receipt_url) && (
                                        <a href={split.receipt_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 text-white opacity-70 hover:opacity-100">
                                          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
                                            <rect x="4" y="4" width="24" height="24" rx="4" stroke="currentColor" strokeWidth="2"/>
                                            <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.5"/>
                                            <path d="M4 22L11 17L16 21L22 16L28 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                          </svg>
                                        </a>
                                      )}
                                    </div>
                                  ))}
                                </>
                              )}
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Commitments Section - התחייבויות קודמות */}
              {commitments.length > 0 && (
                <div className="bg-white/5 border border-white/25 rounded-[10px] p-[3px] mx-[5px]">
                  <button
                    type="button"
                    onClick={() => setShowCommitments(!showCommitments)}
                    className="w-full cursor-pointer hover:bg-white/10 transition-colors rounded-[7px]"
                  >
                    <h3 className="text-[20px] font-bold text-white text-center py-[10px]">
                      התחייבויות קודמות
                    </h3>
                  </button>

                  {showCommitments && (
                    <div className="flex flex-col gap-[1px]">
                      {commitments.map((c) => {
                        const endDate = new Date(c.last_due_date);
                        const endDateStr = `${String(endDate.getDate()).padStart(2, "0")}/${String(endDate.getMonth() + 1).padStart(2, "0")}/${endDate.getFullYear()}`;
                        const label = c.notes
                          ? `${c.notes} (מסתיים ${endDateStr})`
                          : `${c.supplier_name} - מסתיים ${endDateStr}`;
                        return (
                          <div
                            key={`${c.payment_id}__${c.monthly_amount}`}
                            className="flex items-center justify-between px-[10px] py-[8px] border-t border-white/10"
                          >
                            <span className="text-[16px] text-white flex-1">{label}</span>
                            <div className="flex flex-col items-end">
                              <span className="text-[16px] text-white">
                                {`₪${c.monthly_amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                              </span>
                              <span className="text-[12px] font-bold text-white">{`סה"כ לתשלום`}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Recent Payments Section - hidden when no data */}
      {recentPaymentsData.length > 0 && (
      <div id="onboarding-payments-list" className="bg-[#0F1535] rounded-[20px] p-[20px_5px] mt-[10px] flex flex-col gap-[23px]">
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
                className={`bg-white/5 rounded-[7px] p-[7px_3px] border transition-colors ${expandedPaymentId === payment.id ? 'border-white' : 'border-transparent'}`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedPaymentId(expandedPaymentId === payment.id ? null : payment.id)}
                  className="flex items-center gap-[5px] w-full p-[5px_3px] min-h-[45px] hover:bg-[#29318A]/30 transition-colors rounded-[7px] cursor-pointer"
                >
                  {/* Date */}
                  <div className="w-[55px] flex-shrink-0 flex items-center justify-start gap-0">
                    <svg width="14" height="14" viewBox="0 0 32 32" fill="none" className={`flex-shrink-0 transition-transform ${expandedPaymentId === payment.id ? 'rotate-90' : ''} text-white/50`}>
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

                {/* Expanded Details */}
                {expandedPaymentId === payment.id && (
                  <div className="flex flex-col gap-[10px] mt-[5px]">
                    {/* Header: פרטים נוספים + action icons */}
                    <div className="flex items-center justify-between border-b border-white/20 pb-[8px] px-[7px]" dir="rtl">
                      <span className="text-[16px] font-medium">פרטים נוספים</span>
                      <div className="flex items-center gap-[5px]">
                        {payment.receiptUrl && (
                          <button
                            type="button"
                            onClick={() => window.open(payment.receiptUrl!, '_blank')}
                            className="w-[20px] h-[20px] text-white opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                            title="צפייה בקבלה"
                          >
                            <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                              <circle cx="8.5" cy="8.5" r="1.5"/>
                              <polyline points="21 15 16 10 5 21"/>
                            </svg>
                          </button>
                        )}
                        {payment.receiptUrl && (
                          <a
                            href={payment.receiptUrl}
                            download
                            className="w-[20px] h-[20px] text-white opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                            title="הורדה"
                          >
                            <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                              <polyline points="7 10 12 15 17 10"/>
                              <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Details row */}
                    <div className="flex items-center justify-between px-[7px] flex-wrap gap-y-[8px]">
                      {payment.createdBy && (
                        <div className="flex flex-col items-center min-w-[60px]">
                          <span className="text-[13px] text-[#979797]">תאריך הזנה</span>
                          <span className="text-[13px] ltr-num">{payment.createdAt || "-"}</span>
                        </div>
                      )}
                      {payment.createdBy && (
                        <div className="flex flex-col items-center min-w-[60px]">
                          <span className="text-[13px] text-[#979797]">הוזן ע&quot;י</span>
                          <span className="text-[13px]">{payment.createdBy}</span>
                        </div>
                      )}
                      <div className="flex flex-col items-center min-w-[60px]">
                        <span className="text-[13px] text-[#979797]">סכום לפני מע&quot;מ</span>
                        <span className="text-[13px] ltr-num">₪{payment.subtotal.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex flex-col items-center min-w-[60px]">
                        <span className="text-[13px] text-[#979797]">סכום כולל מע&quot;מ</span>
                        <span className="text-[13px] ltr-num">₪{payment.totalAmount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>

                    {/* Extra info */}
                    {(payment.reference || payment.checkNumber || payment.notes) && (
                      <div className="flex flex-col gap-[5px] px-[7px]">
                        {payment.reference && (
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] text-[#979797]">אסמכתא</span>
                            <span className="text-[13px] ltr-num">{payment.reference}</span>
                          </div>
                        )}
                        {payment.checkNumber && (
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] text-[#979797]">מספר צ׳ק</span>
                            <span className="text-[13px] ltr-num">{payment.checkNumber}</span>
                          </div>
                        )}
                        {payment.notes && (
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] text-[#979797]">הערות</span>
                            <span className="text-[13px] text-right max-w-[60%]">{payment.notes}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Linked Invoices */}
                    {payment.linkedInvoice && (
                      <div className="flex flex-col gap-[8px] border border-white/30 rounded-[7px] p-[3px] mx-[3px]">
                        <button
                          type="button"
                          onClick={() => setShowLinkedInvoices(showLinkedInvoices === payment.id ? null : payment.id)}
                          className="bg-[#5F6BEA] text-white text-[15px] font-medium py-[5px] px-[14px] rounded-[7px] self-end cursor-pointer hover:bg-[#4E59D9] transition-colors"
                        >
                          הצגת חשבוניות מקושרות
                        </button>

                        {showLinkedInvoices === payment.id && (
                          <div className="flex flex-col gap-[2px]">
                            <span className="text-[13px] font-bold text-right px-[5px]">
                              סה&quot;כ סכום חשבוניות: ₪{payment.linkedInvoice.totalAmount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            {/* Header */}
                            <div className="flex items-center justify-between gap-[3px] border-b border-white/20 min-h-[40px] px-[3px]">
                              <div className="flex items-center gap-[5px] min-w-[45px]">
                                <span className="text-[13px]">פעולות</span>
                              </div>
                              <span className="text-[13px] w-[65px] text-center">סכום אחרי מע&quot;מ</span>
                              <span className="text-[13px] w-[65px] text-center">סכום לפני מע&quot;מ</span>
                              <span className="text-[13px] w-[65px] text-center">אסמכתא</span>
                              <span className="text-[13px] min-w-[50px] text-right">תאריך</span>
                            </div>
                            {/* Invoice row */}
                            <div className="flex items-center justify-between gap-[3px] min-h-[45px] px-[3px] rounded-[7px]">
                              <div className="flex items-center gap-[5px] min-w-[45px]">
                                {payment.linkedInvoice.attachmentUrl && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => window.open(payment.linkedInvoice!.attachmentUrl!, '_blank')}
                                      className="w-[20px] h-[20px] text-white opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                                    >
                                      <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                        <circle cx="8.5" cy="8.5" r="1.5"/>
                                        <polyline points="21 15 16 10 5 21"/>
                                      </svg>
                                    </button>
                                    <a
                                      href={payment.linkedInvoice.attachmentUrl}
                                      download
                                      className="w-[20px] h-[20px] text-white opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                                    >
                                      <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                      </svg>
                                    </a>
                                  </>
                                )}
                              </div>
                              <span className="text-[13px] w-[65px] text-center ltr-num">₪{payment.linkedInvoice.totalAmount.toLocaleString("he-IL")}</span>
                              <span className="text-[13px] w-[65px] text-center ltr-num">₪{payment.linkedInvoice.subtotal.toLocaleString("he-IL")}</span>
                              <span className="text-[13px] w-[65px] text-center ltr-num">{payment.linkedInvoice.invoiceNumber || "-"}</span>
                              <span className="text-[13px] min-w-[50px] text-right ltr-num">{payment.linkedInvoice.date}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

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
            <div className="flex flex-col gap-[5px] px-4 pb-[80px]">
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
                    onClick={() => { setExpenseType("purchases"); setSelectedSupplier(""); }}
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
                    onClick={() => { setExpenseType("expenses"); setSelectedSupplier(""); }}
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
                  <button
                    type="button"
                    onClick={() => { setExpenseType("employees"); setSelectedSupplier(""); }}
                    className="flex flex-row-reverse items-center gap-[3px] cursor-pointer"
                  >
                    <span className={`text-[16px] font-semibold ${expenseType === "employees" ? "text-white" : "text-[#979797]"}`}>
                      עלות עובדים
                    </span>
                    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={expenseType === "employees" ? "text-white" : "text-[#979797]"}>
                      {expenseType === "employees" ? (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                      ) : (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              {/* Supplier */}
              <SupplierSearchSelect
                suppliers={filteredSuppliers}
                value={selectedSupplier}
                onChange={setSelectedSupplier}
              />

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
                            <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תשלום</span>
                            <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תאריך</span>
                            <span className="text-[14px] font-medium text-white/70 flex-1 text-center">סכום</span>
                          </div>
                          <div className="flex flex-col gap-[8px] max-h-[200px] overflow-y-auto">
                            {pm.customInstallments.map((item, index) => (
                              <div key={item.number} className="flex items-center gap-[8px]">
                                <span className="text-[14px] text-white ltr-num flex-1 text-center">{item.number}/{pm.installments}</span>
                                <div className="flex-1 h-[36px] bg-[#29318A]/30 border border-[#4C526B] rounded-[7px] relative flex items-center justify-center">
                                  <span className="absolute inset-0 flex items-center justify-center text-[14px] text-white pointer-events-none ltr-num">
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
                          {(() => {
                            const installmentsTotal = getInstallmentsTotal(pm.customInstallments);
                            const pmTotal = parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0;
                            const isMismatch = Math.abs(installmentsTotal - pmTotal) > 0.01;
                            return (
                              <div className="flex items-center gap-[8px] border-t border-[#4C526B] pt-[8px] mt-[8px]">
                                <span className="text-[14px] font-bold text-white w-[50px] text-center flex-shrink-0">סה&quot;כ</span>
                                <span className="flex-1"></span>
                                <span className={`text-[14px] font-bold ltr-num flex-1 text-center ${isMismatch ? 'text-red-400' : 'text-white'}`}>
                                  ₪{installmentsTotal.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            );
                          })()}
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
