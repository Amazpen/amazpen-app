"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useDashboard } from "../layout";
import { createClient } from "@/lib/supabase/client";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { useToast } from "@/components/ui/toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { uploadFile } from "@/lib/uploadFile";
import { convertPdfToImage } from "@/lib/pdfToImage";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useFormDraft } from "@/hooks/useFormDraft";
import SupplierSearchSelect from "@/components/ui/SupplierSearchSelect";

// Supplier from database
interface Supplier {
  id: string;
  name: string;
  expense_category_id: string | null;
  waiting_for_coordinator: boolean;
  is_fixed_expense?: boolean;
}

// Expense category from database (used for type checking)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ExpenseCategory {
  id: string;
  name: string;
}

// Invoice from database
interface Invoice {
  id: string;
  business_id: string;
  supplier_id: string;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  subtotal: number;
  vat_amount: number | null;
  total_amount: number;
  status: string | null;
  amount_paid: number | null;
  attachment_url: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  invoice_type: string | null;
  clarification_reason: string | null;
  // Joined data
  supplier?: Supplier;
  creator_name?: string;
}

// Linked payment from database (used for type checking)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface LinkedPayment {
  id: string;
  payment_id: string;
  payment_method: string;
  amount: number;
  installments_count: number | null;
  check_date: string | null;
}

// Parse attachment_url: supports both single URL string and JSON array of URLs
function parseAttachmentUrls(raw: string | null): string[] {
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try { return JSON.parse(raw).filter((u: unknown) => typeof u === "string" && u); } catch { return []; }
  }
  return [raw];
}

// Invoice display for UI
interface InvoiceDisplay {
  id: string;
  date: string;
  supplier: string;
  reference: string;
  amount: number;
  amountWithVat: number;
  amountBeforeVat: number;
  status: string;
  enteredBy: string;
  entryDate: string;
  notes: string;
  attachmentUrl: string | null;
  attachmentUrls: string[];
  clarificationReason: string | null;
  isFixed: boolean;
  linkedPayments: { id: string; amount: number; method: string; installments: number; date: string }[];
}

// Expense summary for chart (by supplier)
interface ExpenseSummary {
  id: string;
  name: string; // supplier name
  amount: number; // subtotal (before VAT)
  percentage: number;
}

// Expense category summary for table (with suppliers for drill-down)
interface ExpenseCategorySummary {
  id: string;
  category: string;
  amount: number;
  percentage: number;
  suppliers: { id: string; name: string; amount: number; percentage: number; isFixed?: boolean }[];
}

export default function ExpensesPage() {
  const router = useRouter();
  const { selectedBusinesses } = useDashboard();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = usePersistedState<"expenses" | "purchases" | "employees">("expenses:tab", "expenses");
  const [savedDateRange, setSavedDateRange] = usePersistedState<{ start: string; end: string } | null>("expenses:dateRange", null);
  const [dateRange, setDateRange] = useState({
    start: savedDateRange ? new Date(savedDateRange.start) : new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    end: savedDateRange ? new Date(savedDateRange.end) : new Date(),
  });
  // Sync dateRange to localStorage
  const handleDateRangeChange = useCallback((range: { start: Date; end: Date }) => {
    setDateRange(range);
    setSavedDateRange({ start: range.start.toISOString(), end: range.end.toISOString() });
  }, [setSavedDateRange]);

  // Draft persistence for add expense form
  const expenseDraftKey = `expenseForm:draft:${selectedBusinesses[0] || "none"}`;
  const { saveDraft: saveExpenseDraft, restoreDraft: restoreExpenseDraft, clearDraft: clearExpenseDraft } = useFormDraft(expenseDraftKey);
  const expenseDraftRestored = useRef(false);

  const [showAddExpensePopup, setShowAddExpensePopup] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Realtime subscription
  const handleRealtimeChange = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  useMultiTableRealtime(
    ["invoices", "suppliers", "expense_categories", "payments"],
    handleRealtimeChange,
    selectedBusinesses.length > 0
  );

  // Data from Supabase
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [expensesData, setExpensesData] = useState<ExpenseSummary[]>([]); // For chart and purchases tab - by supplier
  const [categoryData, setCategoryData] = useState<ExpenseCategorySummary[]>([]); // For expenses tab - by category with drill-down
  const [recentInvoices, setRecentInvoices] = useState<InvoiceDisplay[]>([]);
  const [_isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(new Set()); // For drill-down (supports multiple)

  // Form state for new expense
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [expenseType, setExpenseType] = useState<"current" | "goods" | "employees">("current");
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amountBeforeVat, setAmountBeforeVat] = useState("");
  const [partialVat, setPartialVat] = useState(false);
  const [vatAmount, setVatAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [isPaidInFull, setIsPaidInFull] = useState(false);
  const [needsClarification, setNeedsClarification] = useState(false);
  const [clarificationReason, setClarificationReason] = useState("");
  const [showClarificationMenu, setShowClarificationMenu] = useState(false);

  // Payment details state (shown when isPaidInFull is true)
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentInstallments, setPaymentInstallments] = useState(1);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentReceiptFile, setPaymentReceiptFile] = useState<File | null>(null);
  const [paymentReceiptPreview, setPaymentReceiptPreview] = useState<string | null>(null);
  const [isUploadingPaymentReceipt, setIsUploadingPaymentReceipt] = useState(false);

  // Expanded invoice row state
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [showLinkedPayments, setShowLinkedPayments] = useState<string | null>(null);

  // Edit expense state
  const [editingInvoice, setEditingInvoice] = useState<InvoiceDisplay | null>(null);
  const [showEditPopup, setShowEditPopup] = useState(false);

  // Delete confirmation state
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // File upload state for new expense (supports multiple files)
  const [newAttachmentFiles, setNewAttachmentFiles] = useState<File[]>([]);
  const [newAttachmentPreviews, setNewAttachmentPreviews] = useState<string[]>([]);

  // File upload state for edit (supports multiple files)
  const [editAttachmentFiles, setEditAttachmentFiles] = useState<File[]>([]);
  const [editAttachmentPreviews, setEditAttachmentPreviews] = useState<string[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

  // Invoice filter & sort state
  const [filterBy, setFilterBy] = useState<string>("");
  const [filterValue, setFilterValue] = useState<string>("");
  const [dateSortOrder, setDateSortOrder] = useState<"asc" | "desc" | null>(null);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);

  // Supplier detail popup state (from expenses breakdown)
  const [showSupplierBreakdownPopup, setShowSupplierBreakdownPopup] = useState(false);
  const [breakdownSupplierName, setBreakdownSupplierName] = useState("");
  const [breakdownSupplierCategory, setBreakdownSupplierCategory] = useState("");
  const [breakdownSupplierTotalWithVat, setBreakdownSupplierTotalWithVat] = useState(0);
  const [breakdownSupplierInvoices, setBreakdownSupplierInvoices] = useState<InvoiceDisplay[]>([]);
  const [isLoadingBreakdown, setIsLoadingBreakdown] = useState(false);

  // Status change state
  const [showStatusMenu, setShowStatusMenu] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const [statusConfirm, setStatusConfirm] = useState<{ invoiceId: string; newStatus: string; label: string } | null>(null);

  // Clarification popup state (when changing status to "בבירור")
  const [showClarificationPopup, setShowClarificationPopup] = useState(false);
  const [clarificationInvoiceId, setClarificationInvoiceId] = useState<string | null>(null);
  const [statusClarificationReason, setStatusClarificationReason] = useState("");
  const [showStatusClarificationMenu, setShowStatusClarificationMenu] = useState(true);
  const [statusClarificationFile, setStatusClarificationFile] = useState<File | null>(null);
  const [statusClarificationFilePreview, setStatusClarificationFilePreview] = useState<string | null>(null);
  const [isSavingClarification, setIsSavingClarification] = useState(false);

  // Payment popup for existing invoice (when changing status to "paid")
  const [showPaymentPopup, setShowPaymentPopup] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<InvoiceDisplay | null>(null);

  // Payment methods with installments - supports multiple payment methods (like payments page)
  interface PaymentMethodEntry {
    id: number;
    method: string;
    amount: string;
    installments: string;
    checkNumber: string;
    customInstallments: Array<{
      number: number;
      date: string;
      dateForInput: string;
      amount: number;
    }>;
  }
  const [popupPaymentMethods, setPopupPaymentMethods] = useState<PaymentMethodEntry[]>([
    { id: 1, method: "", amount: "", installments: "1", checkNumber: "", customInstallments: [] }
  ]);

  // Payment method options for popup form
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

  // Generate initial installments breakdown for payment popup
  const generatePopupInstallments = (numInstallments: number, totalAmount: number, startDateStr: string) => {
    if (numInstallments <= 1 || totalAmount === 0) {
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

  // Add new payment method entry to popup
  const addPopupPaymentMethodEntry = () => {
    const newId = Math.max(...popupPaymentMethods.map(p => p.id)) + 1;
    setPopupPaymentMethods(prev => [
      ...prev,
      { id: newId, method: "", amount: "", installments: "1", checkNumber: "", customInstallments: [] }
    ]);
  };

  // Remove payment method entry from popup
  const removePopupPaymentMethodEntry = (id: number) => {
    if (popupPaymentMethods.length > 1) {
      setPopupPaymentMethods(prev => prev.filter(p => p.id !== id));
    }
  };

  // Update payment method field in popup
  const updatePopupPaymentMethodField = (id: number, field: keyof PaymentMethodEntry, value: string) => {
    setPopupPaymentMethods(prev => prev.map(p => {
      if (p.id !== id) return p;

      const updated = { ...p, [field]: value };

      // Regenerate installments when amount or installments count changes
      if (field === "amount" || field === "installments") {
        const numInstallments = parseInt(field === "installments" ? value : p.installments) || 1;
        const totalAmount = parseFloat((field === "amount" ? value : p.amount).replace(/[^\d.]/g, "")) || 0;
        updated.customInstallments = generatePopupInstallments(numInstallments, totalAmount, paymentDate);
      }

      return updated;
    }));
  };

  // Handle installment date change for popup
  const handlePopupInstallmentDateChange = (paymentMethodId: number, installmentIndex: number, newDate: string) => {
    setPopupPaymentMethods(prev => prev.map(p => {
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

  // Handle installment amount change for popup
  const handlePopupInstallmentAmountChange = (paymentMethodId: number, installmentIndex: number, newAmount: string) => {
    const amount = parseFloat(newAmount.replace(/[^\d.]/g, "")) || 0;
    setPopupPaymentMethods(prev => prev.map(p => {
      if (p.id !== paymentMethodId) return p;
      const totalAmount = parseFloat(p.amount.replace(/[^\d.]/g, "")) || 0;
      const updatedInstallments = [...p.customInstallments];
      if (updatedInstallments[installmentIndex]) {
        const cappedAmount = Math.min(amount, totalAmount);
        updatedInstallments[installmentIndex] = {
          ...updatedInstallments[installmentIndex],
          amount: cappedAmount,
        };
        const remaining = totalAmount - cappedAmount;
        const otherCount = updatedInstallments.length - 1;
        if (otherCount > 0) {
          const perOther = Math.floor((remaining / otherCount) * 100) / 100;
          let distributed = 0;
          updatedInstallments.forEach((inst, idx) => {
            if (idx !== installmentIndex) {
              if (idx === updatedInstallments.findLastIndex((_, i) => i !== installmentIndex)) {
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

  // Calculate total for a payment method's installments in popup
  const getPopupInstallmentsTotal = (customInstallments: PaymentMethodEntry["customInstallments"]) => {
    return customInstallments.reduce((sum, item) => sum + item.amount, 0);
  };

  // Format date for display (kept for potential future use)
  const _formatDate = (date: Date) => {
    return date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  // Format date string from database
  const formatDateString = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  // Fetch data from Supabase
  useEffect(() => {
    const fetchData = async () => {
      if (selectedBusinesses.length === 0) {
        setExpensesData([]);
        setRecentInvoices([]);
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
          .select("id, name, expense_category_id, waiting_for_coordinator")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .eq("is_active", true)
          .order("name");

        if (suppliersData) {
          setSuppliers(suppliersData);
        }

        // Fetch invoices for the date range (use local date format to avoid timezone issues)
        const formatLocalDate = (date: Date) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };
        const startDate = formatLocalDate(dateRange.start);
        const endDate = formatLocalDate(dateRange.end);

        const { data: invoicesData } = await supabase
          .from("invoices")
          .select(`
            *,
            supplier:suppliers(id, name, expense_category_id, is_fixed_expense),
            creator:profiles!invoices_created_by_fkey(full_name)
          `)
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .gte("invoice_date", startDate)
          .lte("invoice_date", endDate)
          .eq("invoice_type", activeTab === "expenses" ? "current" : activeTab === "employees" ? "employees" : "goods")
          .order("invoice_date", { ascending: false })
          .limit(50);

        if (invoicesData) {
          // Transform to display format
          const displayInvoices: InvoiceDisplay[] = invoicesData.map((inv: Invoice & { supplier: Supplier | null; creator: { full_name: string } | null }) => ({
            id: inv.id,
            date: formatDateString(inv.invoice_date),
            supplier: inv.supplier?.name || "לא ידוע",
            reference: inv.invoice_number || "",
            amount: Number(inv.total_amount),
            amountWithVat: Number(inv.total_amount),
            amountBeforeVat: Number(inv.subtotal),
            status: inv.status === "paid" ? "שולם" : inv.status === "clarification" ? "בבירור" : "ממתין",
            enteredBy: inv.creator?.full_name || "מערכת",
            entryDate: formatDateString(inv.created_at),
            notes: inv.notes || "",
            attachmentUrl: inv.attachment_url || null,
            attachmentUrls: parseAttachmentUrls(inv.attachment_url),
            clarificationReason: inv.clarification_reason || null,
            isFixed: inv.supplier?.is_fixed_expense || false,
            linkedPayments: [], // Will be fetched separately if needed
          }));
          setRecentInvoices(displayInvoices);
        }

        // Fetch expense categories for table summary
        const { data: categoriesData } = await supabase
          .from("expense_categories")
          .select("id, name")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .eq("is_active", true);

        // Calculate totals per supplier (for chart/purchases) and per category with suppliers (for expenses drill-down)
        if (invoicesData) {
          const supplierTotals = new Map<string, { name: string; total: number; categoryId: string | null }>();
          const categoryTotals = new Map<string, { name: string; total: number; suppliers: Map<string, { name: string; total: number; isFixed: boolean }> }>();

          // Initialize category totals with suppliers map
          if (categoriesData) {
            for (const cat of categoriesData) {
              categoryTotals.set(cat.id, { name: cat.name, total: 0, suppliers: new Map() });
            }
          }

          // Add "uncategorized" for suppliers without category
          const uncategorizedId = "__uncategorized__";

          // Sum invoice amounts by supplier and category
          for (const inv of invoicesData) {
            if (inv.supplier) {
              const supplierId = inv.supplier.id;
              const supplierName = inv.supplier.name;
              const subtotal = Number(inv.subtotal);
              const categoryId = inv.supplier.expense_category_id;
              const isFixed = inv.supplier.is_fixed_expense || false;

              // Add to supplier totals (for chart/purchases tab)
              if (supplierTotals.has(supplierId)) {
                const current = supplierTotals.get(supplierId)!;
                current.total += subtotal;
              } else {
                supplierTotals.set(supplierId, { name: supplierName, total: subtotal, categoryId });
              }

              // Add to category totals with supplier breakdown (for expenses tab drill-down)
              if (categoryId && categoryTotals.has(categoryId)) {
                const category = categoryTotals.get(categoryId)!;
                category.total += subtotal;

                // Add supplier to category's suppliers map
                if (category.suppliers.has(supplierId)) {
                  const supplier = category.suppliers.get(supplierId)!;
                  supplier.total += subtotal;
                } else {
                  category.suppliers.set(supplierId, { name: supplierName, total: subtotal, isFixed });
                }
              } else {
                // Supplier has no category - add to uncategorized
                if (!categoryTotals.has(uncategorizedId)) {
                  categoryTotals.set(uncategorizedId, { name: "ללא קטגוריה", total: 0, suppliers: new Map() });
                }
                const uncategorized = categoryTotals.get(uncategorizedId)!;
                uncategorized.total += subtotal;

                if (uncategorized.suppliers.has(supplierId)) {
                  const supplier = uncategorized.suppliers.get(supplierId)!;
                  supplier.total += subtotal;
                } else {
                  uncategorized.suppliers.set(supplierId, { name: supplierName, total: subtotal, isFixed });
                }
              }
            }
          }

          // Calculate total for percentage
          const grandTotal = Array.from(supplierTotals.values()).reduce((sum, sup) => sum + sup.total, 0);

          // Transform supplier data for chart/purchases tab
          const expensesSummary: ExpenseSummary[] = Array.from(supplierTotals.entries())
            .filter(([, data]) => data.total > 0)
            .map(([id, data]) => ({
              id,
              name: data.name,
              amount: data.total,
              percentage: grandTotal > 0 ? (data.total / grandTotal) * 100 : 0,
            }))
            .sort((a, b) => b.amount - a.amount);

          setExpensesData(expensesSummary);

          // Transform category data for expenses tab with suppliers for drill-down
          const categorySummary: ExpenseCategorySummary[] = Array.from(categoryTotals.entries())
            .filter(([, data]) => data.total > 0)
            .map(([id, data]) => ({
              id,
              category: data.name,
              amount: data.total,
              percentage: grandTotal > 0 ? (data.total / grandTotal) * 100 : 0,
              suppliers: Array.from(data.suppliers.entries())
                .map(([supId, supData]) => ({
                  id: supId,
                  name: supData.name,
                  amount: supData.total,
                  percentage: data.total > 0 ? (supData.total / data.total) * 100 : 0,
                  isFixed: supData.isFixed,
                }))
                .sort((a, b) => b.amount - a.amount),
            }))
            .sort((a, b) => b.amount - a.amount);

          setCategoryData(categorySummary);
        }
      } catch (error) {
        console.error("Error fetching expenses data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [selectedBusinesses, dateRange, activeTab, refreshTrigger]);

  // Close status menu and filter menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showStatusMenu) {
        const target = e.target as HTMLElement;
        if (!target.closest('[data-status-menu]')) {
          setShowStatusMenu(null);
        }
      }
      if (showFilterMenu && filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setShowFilterMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showStatusMenu, showFilterMenu]);

  // Calculate VAT and total
  // Save expense form draft
  const saveExpenseDraftData = useCallback(() => {
    if (!showAddExpensePopup) return;
    saveExpenseDraft({
      expenseDate, expenseType, selectedSupplier, invoiceNumber,
      amountBeforeVat, partialVat, vatAmount, notes,
      isPaidInFull, needsClarification, clarificationReason,
      paymentMethod, paymentDate, paymentInstallments, paymentReference, paymentNotes,
      popupPaymentMethods,
    });
  }, [saveExpenseDraft, showAddExpensePopup,
    expenseDate, expenseType, selectedSupplier, invoiceNumber,
    amountBeforeVat, partialVat, vatAmount, notes,
    isPaidInFull, needsClarification, clarificationReason,
    paymentMethod, paymentDate, paymentInstallments, paymentReference, paymentNotes,
    popupPaymentMethods]);

  useEffect(() => {
    if (expenseDraftRestored.current) {
      saveExpenseDraftData();
    }
  }, [saveExpenseDraftData]);

  // Restore expense draft when popup opens
  useEffect(() => {
    if (showAddExpensePopup && !editingInvoice) {
      expenseDraftRestored.current = false;
      setTimeout(() => {
        const draft = restoreExpenseDraft();
        if (draft) {
          if (draft.expenseDate) setExpenseDate(draft.expenseDate as string);
          if (draft.expenseType) setExpenseType(draft.expenseType as "current" | "goods" | "employees");
          if (draft.selectedSupplier) setSelectedSupplier(draft.selectedSupplier as string);
          if (draft.invoiceNumber) setInvoiceNumber(draft.invoiceNumber as string);
          if (draft.amountBeforeVat) setAmountBeforeVat(draft.amountBeforeVat as string);
          if (draft.partialVat !== undefined) setPartialVat(draft.partialVat as boolean);
          if (draft.vatAmount) setVatAmount(draft.vatAmount as string);
          if (draft.notes !== undefined) setNotes(draft.notes as string);
          if (draft.isPaidInFull !== undefined) setIsPaidInFull(draft.isPaidInFull as boolean);
          if (draft.needsClarification !== undefined) setNeedsClarification(draft.needsClarification as boolean);
          if (draft.clarificationReason) setClarificationReason(draft.clarificationReason as string);
          if (draft.paymentMethod) setPaymentMethod(draft.paymentMethod as string);
          if (draft.paymentDate) setPaymentDate(draft.paymentDate as string);
          if (draft.paymentInstallments) setPaymentInstallments(draft.paymentInstallments as number);
          if (draft.paymentReference) setPaymentReference(draft.paymentReference as string);
          if (draft.paymentNotes) setPaymentNotes(draft.paymentNotes as string);
          if (draft.popupPaymentMethods) setPopupPaymentMethods(draft.popupPaymentMethods as typeof popupPaymentMethods);
        }
        expenseDraftRestored.current = true;
      }, 0);
    }
  }, [showAddExpensePopup, editingInvoice, restoreExpenseDraft]);

  const calculatedVat = partialVat ? parseFloat(vatAmount) || 0 : (parseFloat(amountBeforeVat) || 0) * 0.18;
  const totalWithVat = (parseFloat(amountBeforeVat) || 0) + calculatedVat;

  // Chart data source: categories for expenses/employees tabs, suppliers for purchases tab
  // When categories are expanded, replace them with their suppliers in the chart
  // Always sorted by amount descending for clear chart readability
  const chartDataSource = useMemo(() => {
    if (activeTab === "purchases") return [...expensesData].sort((a, b) => b.amount - a.amount);
    if (expandedCategoryIds.size === 0) return [...categoryData].sort((a, b) => b.amount - a.amount);

    // Build mixed chart: non-expanded categories + suppliers from expanded categories
    const result: { id: string; amount: number; percentage: number; name?: string; category?: string }[] = [];
    for (const cat of categoryData) {
      if (expandedCategoryIds.has(cat.id) && cat.suppliers.length > 0) {
        // Replace this category with its individual suppliers
        for (const sup of cat.suppliers) {
          result.push({ id: sup.id, amount: sup.amount, percentage: 0, name: sup.name });
        }
      } else {
        result.push({ ...cat, percentage: 0 });
      }
    }
    // Recalculate percentages relative to global total
    const total = result.reduce((sum, item) => sum + item.amount, 0);
    for (const item of result) {
      item.percentage = total > 0 ? (item.amount / total) * 100 : 0;
    }
    // Sort by amount descending for clear chart readability
    result.sort((a, b) => b.amount - a.amount);
    return result;
  }, [activeTab, expensesData, categoryData, expandedCategoryIds]);

  const totalExpenses = chartDataSource.reduce((sum, item) => sum + item.amount, 0);
  const totalPercentage = chartDataSource.reduce((sum, item) => sum + item.percentage, 0);

  // Chart colors - used in both chart and table
  const chartColors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F"];

  // Handle saving new expense
  const handleSaveExpense = async () => {
    if (!selectedSupplier || !expenseDate || !amountBeforeVat) {
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

      // Check if supplier is a coordinator (מרכזת) - save as delivery note instead
      const supplierInfo = suppliers.find(s => s.id === selectedSupplier);
      const isCoordinatorSupplier = supplierInfo?.waiting_for_coordinator === true;

      if (isCoordinatorSupplier) {
        // For coordinator suppliers, save ONLY as delivery note (תעודת משלוח)
        // No invoice is created - will be created later when closing the coordinator
        const { error: deliveryNoteError } = await supabase
          .from("delivery_notes")
          .insert({
            business_id: selectedBusinesses[0],
            supplier_id: selectedSupplier,
            delivery_note_number: invoiceNumber || null,
            delivery_date: expenseDate,
            subtotal: parseFloat(amountBeforeVat),
            vat_amount: calculatedVat,
            total_amount: totalWithVat,
            notes: notes || null,
            is_verified: false,
          });

        if (deliveryNoteError) throw deliveryNoteError;

        showToast("תעודת המשלוח נשמרה בהצלחה", "success");
      } else {
        // Regular supplier - create invoice as usual
        const { data: newInvoice, error: invoiceError } = await supabase
          .from("invoices")
          .insert({
            business_id: selectedBusinesses[0], // Use first selected business
            supplier_id: selectedSupplier,
            invoice_number: invoiceNumber || null,
            invoice_date: expenseDate,
            subtotal: parseFloat(amountBeforeVat),
            vat_amount: calculatedVat,
            total_amount: totalWithVat,
            status: isPaidInFull ? "paid" : needsClarification ? "clarification" : "pending",
            notes: notes || null,
            created_by: user?.id || null,
            invoice_type: expenseType,
            clarification_reason: needsClarification ? clarificationReason : null,
          })
          .select()
          .single();

        if (invoiceError) throw invoiceError;

        // Upload attachments if any
        if (newInvoice && newAttachmentFiles.length > 0) {
          setIsUploadingAttachment(true);
          const uploadedUrls: string[] = [];
          for (const file of newAttachmentFiles) {
            const fileExt = file.name.split('.').pop();
            const fileName = `${newInvoice.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${fileExt}`;
            const filePath = `invoices/${fileName}`;
            const result = await uploadFile(file, filePath, "attachments");
            if (result.success && result.publicUrl) {
              uploadedUrls.push(result.publicUrl);
            }
          }
          setIsUploadingAttachment(false);
          if (uploadedUrls.length > 0) {
            const attachmentValue = uploadedUrls.length === 1 ? uploadedUrls[0] : JSON.stringify(uploadedUrls);
            await supabase.from("invoices").update({ attachment_url: attachmentValue }).eq("id", newInvoice.id);
          }
        }

        // If paid in full, create payment record with all payment methods
        if (isPaidInFull && newInvoice) {
          const paymentTotal = popupPaymentMethods.reduce((sum, pm) => {
            return sum + (parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0);
          }, 0);

          // Upload receipt if selected
          let newExpReceiptUrl: string | null = null;
          if (paymentReceiptFile) {
            setIsUploadingPaymentReceipt(true);
            const fileExt = paymentReceiptFile.name.split('.').pop();
            const fileName = `receipt-${Date.now()}.${fileExt}`;
            const filePath = `payments/${fileName}`;
            const result = await uploadFile(paymentReceiptFile, filePath, "attachments");
            if (result.success) {
              newExpReceiptUrl = result.publicUrl || null;
            }
            setIsUploadingPaymentReceipt(false);
          }

          const { data: newPayment, error: paymentError } = await supabase
            .from("payments")
            .insert({
              business_id: selectedBusinesses[0],
              supplier_id: selectedSupplier,
              payment_date: paymentDate || expenseDate,
              total_amount: paymentTotal || totalWithVat,
              invoice_id: newInvoice.id,
              notes: paymentNotes || null,
              created_by: user?.id || null,
              receipt_url: newExpReceiptUrl,
            })
            .select()
            .single();

          if (paymentError) throw paymentError;

          if (newPayment) {
            for (const pm of popupPaymentMethods) {
              const amount = parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0;
              if (amount > 0 && pm.method) {
                const installmentsCount = parseInt(pm.installments) || 1;

                if (pm.customInstallments.length > 0) {
                  for (const inst of pm.customInstallments) {
                    await supabase
                      .from("payment_splits")
                      .insert({
                        payment_id: newPayment.id,
                        payment_method: pm.method,
                        amount: inst.amount,
                        installments_count: installmentsCount,
                        installment_number: inst.number,
                        reference_number: paymentReference || null,
                        check_number: pm.method === "check" ? (pm.checkNumber || null) : null,
                        due_date: inst.dateForInput || null,
                      });
                  }
                } else {
                  await supabase
                    .from("payment_splits")
                    .insert({
                      payment_id: newPayment.id,
                      payment_method: pm.method,
                      amount: amount,
                      installments_count: 1,
                      installment_number: 1,
                      reference_number: paymentReference || null,
                      check_number: pm.method === "check" ? (pm.checkNumber || null) : null,
                      due_date: paymentDate || expenseDate || null,
                    });
                }
              }
            }
          }
        }

        showToast("ההוצאה נשמרה בהצלחה", "success");
      }

      // Refresh data
      clearExpenseDraft();
      handleClosePopup();
      // Trigger re-fetch by updating dateRange slightly
      setDateRange({ ...dateRange });
    } catch (error) {
      console.error("Error saving expense:", error);
      showToast("שגיאה בשמירת ההוצאה", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClosePopup = () => {
    setShowAddExpensePopup(false);
    // Reset form
    setExpenseDate(new Date().toISOString().split("T")[0]);
    setExpenseType("current");
    setSelectedSupplier("");
    setInvoiceNumber("");
    setAmountBeforeVat("");
    setPartialVat(false);
    setVatAmount("");
    setNotes("");
    setIsPaidInFull(false);
    setNeedsClarification(false);
    setClarificationReason("");
    setPaymentMethod("");
    setPaymentDate("");
    setPaymentInstallments(1);
    setPaymentReference("");
    setPaymentNotes("");
    setPaymentReceiptFile(null);
    setPaymentReceiptPreview(null);
    setNewAttachmentFiles([]);
    setNewAttachmentPreviews([]);
    setPopupPaymentMethods([{ id: 1, method: "", amount: "", installments: "1", checkNumber: "", customInstallments: [] }]);
    setShowClarificationMenu(false);
  };

  // Handle opening edit popup
  const handleEditInvoice = (invoice: InvoiceDisplay) => {
    setEditingInvoice(invoice);
    // Pre-fill form with invoice data
    // Convert date from display format (DD.MM.YY) to input format (YYYY-MM-DD)
    const dateParts = invoice.date.split('.');
    if (dateParts.length === 3) {
      const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];
      setExpenseDate(`${year}-${dateParts[1]}-${dateParts[0]}`);
    }
    setExpenseType(activeTab === "expenses" ? "current" : "goods");
    // Find supplier ID by name
    const supplier = suppliers.find(s => s.name === invoice.supplier);
    setSelectedSupplier(supplier?.id || "");
    setInvoiceNumber(invoice.reference);
    setAmountBeforeVat(invoice.amountBeforeVat.toString());
    setNotes(invoice.notes);
    // Set existing attachment previews
    setEditAttachmentPreviews(invoice.attachmentUrls);
    setEditAttachmentFiles([]);
    setShowEditPopup(true);
  };

  // Handle saving edited expense
  const handleSaveEditedExpense = async () => {
    if (!editingInvoice || !selectedSupplier || !expenseDate || !amountBeforeVat) {
      showToast("נא למלא את כל השדות הנדרשים", "warning");
      return;
    }

    setIsSaving(true);
    const supabase = createClient();

    try {
      const calculatedVatEdit = partialVat ? parseFloat(vatAmount) || 0 : (parseFloat(amountBeforeVat) || 0) * 0.18;
      const totalWithVatEdit = (parseFloat(amountBeforeVat) || 0) + calculatedVatEdit;

      // Build final attachment URLs list from existing previews + new uploads
      const finalUrls: string[] = [...editAttachmentPreviews.filter(u => u.startsWith("http"))];

      // Upload new files
      if (editAttachmentFiles.length > 0) {
        setIsUploadingAttachment(true);
        for (const file of editAttachmentFiles) {
          const fileExt = file.name.split('.').pop();
          const fileName = `${editingInvoice.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${fileExt}`;
          const filePath = `invoices/${fileName}`;
          const result = await uploadFile(file, filePath, "attachments");
          if (!result.success) {
            console.error("Upload error:", result.error);
            showToast("שגיאה בהעלאת קובץ", "error");
          } else if (result.publicUrl) {
            finalUrls.push(result.publicUrl);
          }
        }
        setIsUploadingAttachment(false);
      }

      const attachmentUrl = finalUrls.length === 0 ? null : finalUrls.length === 1 ? finalUrls[0] : JSON.stringify(finalUrls);

      // Auto-set status to "pending" for fixed expenses when both attachment and invoice number exist
      const updateData: Record<string, unknown> = {
        supplier_id: selectedSupplier,
        invoice_number: invoiceNumber || null,
        invoice_date: expenseDate,
        subtotal: parseFloat(amountBeforeVat),
        vat_amount: calculatedVatEdit,
        total_amount: totalWithVatEdit,
        notes: notes || null,
        invoice_type: expenseType,
        attachment_url: attachmentUrl,
      };

      if (editingInvoice.isFixed && attachmentUrl && invoiceNumber) {
        updateData.status = "pending";
      }

      const { error } = await supabase
        .from("invoices")
        .update(updateData)
        .eq("id", editingInvoice.id);

      if (error) throw error;

      const autoStatusMsg = editingInvoice.isFixed && attachmentUrl && invoiceNumber
        ? ' – הסטטוס עודכן אוטומטית ל"ממתין"'
        : "";
      showToast(`ההוצאה עודכנה בהצלחה${autoStatusMsg}`, "success");
      handleCloseEditPopup();
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      console.error("Error updating expense:", error);
      showToast("שגיאה בעדכון ההוצאה", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Handle closing edit popup
  const handleCloseEditPopup = () => {
    setShowEditPopup(false);
    setEditingInvoice(null);
    // Reset form
    setExpenseDate(new Date().toISOString().split("T")[0]);
    setExpenseType("current");
    setSelectedSupplier("");
    setInvoiceNumber("");
    setAmountBeforeVat("");
    setPartialVat(false);
    setVatAmount("");
    setNotes("");
    // Reset attachments
    setEditAttachmentFiles([]);
    setEditAttachmentPreviews([]);
  };

  // Handle file selection for edit
  const handleEditFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const newFiles = Array.from(files);
      setEditAttachmentFiles(prev => [...prev, ...newFiles]);
      const newPreviews = await Promise.all(newFiles.map(async (f) => {
        if (f.type === "application/pdf") {
          try {
            const imgFile = await convertPdfToImage(f);
            return URL.createObjectURL(imgFile);
          } catch {
            return URL.createObjectURL(f);
          }
        }
        return URL.createObjectURL(f);
      }));
      setEditAttachmentPreviews(prev => [...prev, ...newPreviews]);
    }
    // Reset input so same file can be selected again
    e.target.value = "";
  };

  // Handle removing a specific attachment by index
  const handleRemoveEditAttachment = (index: number) => {
    setEditAttachmentPreviews(prev => prev.filter((_, i) => i !== index));
    // Only remove from files if it's a new file (blob URL), not an existing server URL
    const preview = editAttachmentPreviews[index];
    if (preview?.startsWith("blob:")) {
      const blobIndex = editAttachmentPreviews.slice(0, index + 1).filter(p => p.startsWith("blob:")).length - 1;
      setEditAttachmentFiles(prev => prev.filter((_, i) => i !== blobIndex));
    }
  };

  // Status labels map
  const statusLabels: Record<string, string> = {
    pending: "ממתין",
    clarification: "בבירור",
    paid: "שולם"
  };

  // Handle status change - show confirmation popup first
  const handleStatusChange = (invoiceId: string, newStatus: string) => {
    // Block status change for recurring fixed expenses
    const invoice = recentInvoices.find(inv => inv.id === invoiceId);
    if (invoice?.isFixed) {
      showToast("לא ניתן לשנות סטטוס להוצאה חודשית קבועה – הסטטוס מתעדכן אוטומטית", "warning");
      setShowStatusMenu(null);
      return;
    }

    // If changing to "paid", open payment popup directly (it has its own confirmation)
    if (newStatus === 'paid') {
      if (invoice) {
        setPaymentInvoice(invoice);
        const today = new Date().toISOString().split('T')[0];
        setPaymentDate(today);
        setPaymentReference("");
        setPaymentNotes("");
        setPopupPaymentMethods([{
          id: 1,
          method: "",
          amount: invoice.amountWithVat.toString(),
          installments: "1",
          checkNumber: "",
          customInstallments: []
        }]);
        setShowPaymentPopup(true);
        setShowStatusMenu(null);
      }
      return;
    }

    // If changing to "clarification", open clarification popup
    if (newStatus === 'clarification') {
      setClarificationInvoiceId(invoiceId);
      setStatusClarificationReason("");
      setShowStatusClarificationMenu(true);
      setStatusClarificationFile(null);
      setStatusClarificationFilePreview(null);
      setShowClarificationPopup(true);
      setShowStatusMenu(null);
      return;
    }

    // Show confirmation popup for pending
    setStatusConfirm({ invoiceId, newStatus, label: statusLabels[newStatus] || newStatus });
    setShowStatusMenu(null);
  };

  // Confirm and execute the status change (for pending only)
  const confirmStatusChange = async () => {
    if (!statusConfirm) return;
    setIsUpdatingStatus(true);
    const supabase = createClient();

    try {
      const updateData: Record<string, unknown> = { status: statusConfirm.newStatus };
      // Clear clarification data when moving away from clarification
      if (statusConfirm.newStatus === 'pending') {
        updateData.clarification_reason = null;
      }

      const { error } = await supabase
        .from("invoices")
        .update(updateData)
        .eq("id", statusConfirm.invoiceId);

      if (error) throw error;

      showToast(`הסטטוס עודכן ל"${statusConfirm.label}"`, "success");
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      console.error("Error updating status:", error);
      showToast("שגיאה בעדכון הסטטוס", "error");
    } finally {
      setIsUpdatingStatus(false);
      setStatusConfirm(null);
    }
  };

  // Save clarification status with reason and optional document
  const handleSaveClarification = async () => {
    if (!clarificationInvoiceId) return;
    if (!statusClarificationReason.trim()) {
      showToast("נא לבחור או להזין סיבת בירור", "warning");
      return;
    }

    setIsSavingClarification(true);
    const supabase = createClient();

    try {
      const updateData: Record<string, unknown> = {
        status: "clarification",
        clarification_reason: statusClarificationReason,
      };

      // Upload document if provided
      if (statusClarificationFile) {
        const timestamp = Date.now();
        const ext = statusClarificationFile.name.split('.').pop();
        const filePath = `invoices/clarification_${clarificationInvoiceId}_${timestamp}.${ext}`;
        const result = await uploadFile(statusClarificationFile, filePath);
        if (result.success && result.publicUrl) {
          // Get current attachment_url and append
          const { data: currentInv } = await supabase
            .from("invoices")
            .select("attachment_url")
            .eq("id", clarificationInvoiceId)
            .maybeSingle();

          const existingUrls = parseAttachmentUrls(currentInv?.attachment_url || null);
          existingUrls.push(result.publicUrl);
          updateData.attachment_url = JSON.stringify(existingUrls);
        }
      }

      const { error } = await supabase
        .from("invoices")
        .update(updateData)
        .eq("id", clarificationInvoiceId);

      if (error) throw error;

      showToast('הסטטוס עודכן ל"בבירור"', "success");
      setRefreshTrigger(prev => prev + 1);
      setShowClarificationPopup(false);
      setClarificationInvoiceId(null);
    } catch (error) {
      console.error("Error updating clarification status:", error);
      showToast("שגיאה בעדכון הסטטוס", "error");
    } finally {
      setIsSavingClarification(false);
    }
  };

  // Handle saving payment for existing invoice
  const handleSavePayment = async () => {
    if (!paymentInvoice || popupPaymentMethods.every(pm => !pm.amount || !pm.method)) {
      showToast("נא למלא את כל השדות הנדרשים", "warning");
      return;
    }

    // Validate installments sum matches payment amount
    for (const pm of popupPaymentMethods) {
      if (pm.customInstallments.length > 0) {
        const pmTotal = parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0;
        const installmentsTotal = getPopupInstallmentsTotal(pm.customInstallments);
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

      // Find the supplier ID from the invoice
      const supplier = suppliers.find(s => s.name === paymentInvoice.supplier);

      // Calculate total amount from all payment methods
      const totalAmount = popupPaymentMethods.reduce((sum, pm) => {
        return sum + (parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0);
      }, 0);

      // Upload receipt if selected
      let receiptUrl: string | null = null;
      if (paymentReceiptFile) {
        setIsUploadingPaymentReceipt(true);
        const fileExt = paymentReceiptFile.name.split('.').pop();
        const fileName = `receipt-${Date.now()}.${fileExt}`;
        const filePath = `payments/${fileName}`;
        const result = await uploadFile(paymentReceiptFile, filePath, "attachments");
        if (result.success) {
          receiptUrl = result.publicUrl || null;
        }
        setIsUploadingPaymentReceipt(false);
      }

      // Create the main payment record
      const { data: newPayment, error: paymentError } = await supabase
        .from("payments")
        .insert({
          business_id: selectedBusinesses[0],
          supplier_id: supplier?.id || null,
          payment_date: paymentDate,
          total_amount: totalAmount,
          invoice_id: paymentInvoice.id,
          notes: paymentNotes || null,
          created_by: user?.id || null,
          receipt_url: receiptUrl,
        })
        .select()
        .single();

      if (paymentError) throw paymentError;

      // Create payment splits for each payment method
      if (newPayment) {
        for (const pm of popupPaymentMethods) {
          const amount = parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0;
          if (amount > 0 && pm.method) {
            const installmentsCount = parseInt(pm.installments) || 1;

            if (installmentsCount > 1 && pm.customInstallments.length > 0) {
              // Create split for each installment
              for (const inst of pm.customInstallments) {
                await supabase
                  .from("payment_splits")
                  .insert({
                    payment_id: newPayment.id,
                    payment_method: pm.method,
                    amount: inst.amount,
                    installments_count: installmentsCount,
                    installment_number: inst.number,
                    reference_number: paymentReference || null,
                    check_number: pm.method === "check" ? (pm.checkNumber || null) : null,
                    due_date: inst.dateForInput || null,
                  });
              }
            } else {
              // Single payment
              await supabase
                .from("payment_splits")
                .insert({
                  payment_id: newPayment.id,
                  payment_method: pm.method,
                  amount: amount,
                  installments_count: 1,
                  installment_number: 1,
                  reference_number: paymentReference || null,
                  check_number: pm.method === "check" ? (pm.checkNumber || null) : null,
                  due_date: paymentDate || null,
                });
            }
          }
        }
      }

      // Update invoice status to paid
      const { error: updateError } = await supabase
        .from("invoices")
        .update({ status: 'paid' })
        .eq("id", paymentInvoice.id);

      if (updateError) throw updateError;

      const totalSplits = popupPaymentMethods.reduce((sum, pm) => {
        const count = parseInt(pm.installments) || 1;
        return sum + (count > 1 ? pm.customInstallments.length : 1);
      }, 0);
      showToast(`${totalSplits} תשלומים נקלטו בהצלחה`, "success");
      handleClosePaymentPopup();
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      console.error("Error saving payment:", error);
      showToast("שגיאה בשמירת התשלום", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Handle closing payment popup
  const handleClosePaymentPopup = () => {
    setShowPaymentPopup(false);
    setPaymentInvoice(null);
    setPaymentDate("");
    setPaymentReference("");
    setPaymentNotes("");
    setPaymentReceiptFile(null);
    setPaymentReceiptPreview(null);
    setPopupPaymentMethods([{ id: 1, method: "", amount: "", installments: "1", checkNumber: "", customInstallments: [] }]);
  };

  // Handle opening supplier breakdown popup (from expenses detail table)
  const handleOpenSupplierBreakdown = async (supplierId: string, supplierName: string, categoryName: string) => {
    setBreakdownSupplierName(supplierName);
    setBreakdownSupplierCategory(categoryName);
    setShowSupplierBreakdownPopup(true);
    setIsLoadingBreakdown(true);

    const supabase = createClient();
    try {
      const formatLocalDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const startDate = formatLocalDate(dateRange.start);
      const endDate = formatLocalDate(dateRange.end);

      const { data: invoicesData } = await supabase
        .from("invoices")
        .select(`
          *,
          supplier:suppliers(id, name, expense_category_id, is_fixed_expense),
          creator:profiles!invoices_created_by_fkey(full_name)
        `)
        .in("business_id", selectedBusinesses)
        .eq("supplier_id", supplierId)
        .is("deleted_at", null)
        .gte("invoice_date", startDate)
        .lte("invoice_date", endDate)
        .order("invoice_date", { ascending: false });

      if (invoicesData) {
        const displayInvoices: InvoiceDisplay[] = invoicesData.map((inv: Invoice & { supplier: Supplier | null; creator: { full_name: string } | null }) => ({
          id: inv.id,
          date: formatDateString(inv.invoice_date),
          supplier: inv.supplier?.name || "לא ידוע",
          reference: inv.invoice_number || "",
          amount: Number(inv.total_amount),
          amountWithVat: Number(inv.total_amount),
          amountBeforeVat: Number(inv.subtotal),
          status: inv.status === "paid" ? "שולם" : inv.status === "clarification" ? "בבירור" : "ממתין",
          enteredBy: inv.creator?.full_name || "מערכת",
          entryDate: formatDateString(inv.created_at),
          notes: inv.notes || "",
          attachmentUrl: inv.attachment_url || null,
          attachmentUrls: parseAttachmentUrls(inv.attachment_url),
          clarificationReason: inv.clarification_reason || null,
          isFixed: inv.supplier?.is_fixed_expense || false,
          linkedPayments: [],
        }));
        setBreakdownSupplierInvoices(displayInvoices);
        const totalWithVat = displayInvoices.reduce((sum, inv) => sum + inv.amountWithVat, 0);
        setBreakdownSupplierTotalWithVat(totalWithVat);
      }
    } catch (error) {
      console.error("Error fetching supplier invoices:", error);
    } finally {
      setIsLoadingBreakdown(false);
    }
  };

  const handleCloseSupplierBreakdown = () => {
    setShowSupplierBreakdownPopup(false);
    setBreakdownSupplierInvoices([]);
    setBreakdownSupplierName("");
    setBreakdownSupplierCategory("");
    setBreakdownSupplierTotalWithVat(0);
  };

  // Handle delete confirmation
  const handleDeleteClick = (invoiceId: string) => {
    setDeletingInvoiceId(invoiceId);
    setShowDeleteConfirm(true);
  };

  // Handle actual deletion
  const handleConfirmDelete = async () => {
    if (!deletingInvoiceId) return;

    setIsDeleting(true);
    const supabase = createClient();

    try {
      // Soft delete - set deleted_at
      const { error } = await supabase
        .from("invoices")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", deletingInvoiceId);

      if (error) throw error;

      showToast("ההוצאה נמחקה בהצלחה", "success");
      setShowDeleteConfirm(false);
      setDeletingInvoiceId(null);
      setExpandedInvoiceId(null);
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      console.error("Error deleting expense:", error);
      showToast("שגיאה במחיקת ההוצאה", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle cancel delete
  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
    setDeletingInvoiceId(null);
  };

  // Show message if no business selected
  if (selectedBusinesses.length === 0) {
    return (
      <div className="text-white p-[10px] pb-[80px]">
        <div className="bg-[#0F1535] rounded-[20px] p-[40px] text-center">
          <p className="text-[20px] text-white/70">יש לבחור עסק כדי לצפות בהוצאות</p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-white p-[10px] pb-[80px] w-full">
      {/* Tabs */}
      <div className="flex w-full h-[50px] mb-[34px] border border-[#6B6B6B] rounded-[7px] overflow-hidden">
        <button
          type="button"
          onClick={() => { setActiveTab("purchases"); setFilterBy(""); setFilterValue(""); }}
          className={`flex-1 flex items-center justify-center transition-colors duration-200 ${
            activeTab === "purchases"
              ? "bg-[#29318A] text-white"
              : "text-[#979797]"
          }`}
        >
          <span className="text-[17px] font-semibold">קניות סחורה</span>
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab("expenses"); setFilterBy(""); setFilterValue(""); }}
          className={`flex-1 flex items-center justify-center transition-colors duration-200 ${
            activeTab === "expenses"
              ? "bg-[#29318A] text-white"
              : "text-[#979797]"
          }`}
        >
          <span className="text-[17px] font-semibold">הוצאות שוטפות</span>
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab("employees"); setFilterBy(""); setFilterValue(""); }}
          className={`flex-1 flex items-center justify-center transition-colors duration-200 ${
            activeTab === "employees"
              ? "bg-[#29318A] text-white"
              : "text-[#979797]"
          }`}
        >
          <span className="text-[17px] font-semibold">עלות עובדים</span>
        </button>
      </div>

      {/* Date Range and Add Button */}
      <div className="flex items-center justify-between mb-[10px]">
        <button
          id="onboarding-expenses-add"
          type="button"
          onClick={() => {
            if (activeTab === "employees") setExpenseType("employees");
            else if (activeTab === "purchases") setExpenseType("goods");
            else setExpenseType("current");
            setShowAddExpensePopup(true);
          }}
          className="bg-[#29318A] text-white text-[16px] font-semibold px-[20px] py-[10px] rounded-[7px] transition-colors hover:bg-[#3D44A0]"
        >
          הזנת הוצאה
        </button>
        <DateRangePicker dateRange={dateRange} onChange={handleDateRangeChange} />
      </div>

      {/* Chart and Summary Section */}
      <div className="bg-[#0F1535] rounded-[20px] pb-[10px] mt-[10px]">
        {/* Donut Chart Area */}
        <div className="relative h-[350px] flex items-center justify-center mt-[17px]">
          {chartDataSource.length === 0 ? (
            /* Empty State - No Data */
            <div className="flex flex-col items-center justify-center gap-[15px]">
              <svg width="280" height="280" viewBox="0 0 100 100" className="text-white/20">
                <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="15"/>
              </svg>
              <span className="text-[18px] text-white/50">אין נתוני הוצאות</span>
            </div>
          ) : (
            /* Dynamic Donut Chart */
            <div className="relative w-[280px] h-[280px]">
              {/* Outer ring */}
              <svg className="w-full h-full" viewBox="0 0 100 100">
                {/* Background circle */}
                <circle cx="50" cy="50" r="40" fill="none" stroke="#29318A" strokeWidth="15"/>
                {/* Dynamic segments with percentage labels */}
                {(() => {
                  let offset = 0;
                  const elements: React.ReactNode[] = [];
                  chartDataSource.forEach((item, index) => {
                    // Draw segment
                    elements.push(
                      <circle
                        key={item.id}
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke={chartColors[index % chartColors.length]}
                        strokeWidth="15"
                        strokeDasharray={`${item.percentage} ${100 - item.percentage}`}
                        strokeDashoffset={-offset}
                        transform="rotate(-90 50 50)"
                      />
                    );
                    // Add percentage label for segments >= 5%
                    if (item.percentage >= 5) {
                      const midAngle = ((offset + item.percentage / 2) / 100) * 2 * Math.PI - Math.PI / 2;
                      const labelX = 50 + 40 * Math.cos(midAngle);
                      const labelY = 50 + 40 * Math.sin(midAngle);
                      elements.push(
                        <text
                          key={`label-${item.id}`}
                          x={labelX}
                          y={labelY}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#fff"
                          fontSize="4"
                          fontWeight="bold"
                          style={{ textShadow: "0 0 2px rgba(0,0,0,0.8)" }}
                        >
                          {item.percentage.toFixed(0)}%
                        </text>
                      );
                    }
                    offset += item.percentage;
                  });
                  return elements;
                })()}
              </svg>
              {/* Center text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[18px] font-bold">סה&apos;&apos;כ הוצאות</span>
                <span className="text-[35px] font-bold ltr-num">₪{totalExpenses.toLocaleString()}</span>
                <span className="text-[18px] font-bold ltr-num">{totalPercentage.toFixed(2)}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Expenses Detail Table - hidden when no data */}
        {(activeTab === "expenses" ? categoryData.length > 0 : expensesData.length > 0) && (
        <div className="max-w-[400px] mx-auto">
          <h2 className="text-[24px] font-bold text-center mb-[20px]">פירוט הוצאות</h2>

          {/* Table Header */}
          <div className="flex items-center border-b border-white/20 p-[5px]">
            <span className="text-[16px] flex-1 text-right">
              {activeTab === "purchases" ? "שם ספק" : "קטגוריית ספק"}
            </span>
            <span className="text-[16px] flex-1 text-center">סכום לפני מע&quot;מ</span>
            <span className="text-[16px] flex-1 text-center">(%) מפדיון</span>
          </div>

          {/* Table Rows */}
          <div className="flex flex-col">
            {activeTab !== "purchases" ? (
              /* הוצאות שוטפות / עלות עובדים - לפי קטגוריה עם drill-down */
              categoryData.length === 0 ? (
                <div className="flex items-center justify-center py-[30px]">
                  <span className="text-[16px] text-white/50">אין נתונים להצגה</span>
                </div>
              ) : (
                categoryData.map((cat, index) => (
                  <div key={cat.id}>
                    {/* Category Row */}
                    <button
                      type="button"
                      onClick={() => setExpandedCategoryIds(prev => {
                        const next = new Set(prev);
                        if (next.has(cat.id)) { next.delete(cat.id); } else { next.add(cat.id); }
                        return next;
                      })}
                      className={`flex items-center p-[5px] min-h-[50px] hover:bg-[#29318A]/30 transition-colors rounded-[7px] w-full ${
                        index > 0 ? 'border-t border-white/10' : ''
                      }`}
                    >
                      <div className="flex items-center gap-[5px] flex-1">
                        <span
                          className="w-[12px] h-[12px] rounded-full flex-shrink-0"
                          style={{ backgroundColor: chartColors[index % chartColors.length] }}
                        />
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 32 32"
                          fill="none"
                          className={`flex-shrink-0 transition-transform ${expandedCategoryIds.has(cat.id) ? '-rotate-90' : ''}`}
                        >
                          <path d="M20 10L14 16L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span className="text-[16px] text-right flex-1">{cat.category}</span>
                      </div>
                      <span className="text-[16px] flex-1 text-center ltr-num">₪{cat.amount.toLocaleString()}</span>
                      <span className="text-[16px] flex-1 text-center ltr-num">{cat.percentage.toFixed(1)}%</span>
                    </button>

                    {/* Drill-down: Suppliers in this category */}
                    {expandedCategoryIds.has(cat.id) && cat.suppliers.length > 0 && (
                      <div className="bg-white/5 rounded-[7px] mx-[10px] mb-[5px]">
                        {cat.suppliers.map((supplier, supIndex) => {
                          // Find supplier's color from chartDataSource
                          const chartIdx = chartDataSource.findIndex(d => d.id === supplier.id);
                          return (
                          <button
                            type="button"
                            key={supplier.id}
                            onClick={() => handleOpenSupplierBreakdown(supplier.id, supplier.name, cat.category)}
                            className={`flex items-center p-[4px_5px] w-full hover:bg-white/10 transition-colors cursor-pointer ${
                              supIndex > 0 ? 'border-t border-white/10' : ''
                            }`}
                          >
                            <div className="flex items-center gap-[5px] flex-1">
                              {chartIdx >= 0 && (
                                <span
                                  className="w-[10px] h-[10px] rounded-full flex-shrink-0"
                                  style={{ backgroundColor: chartColors[chartIdx % chartColors.length] }}
                                />
                              )}
                              <span className={`text-[14px] flex-1 text-center ${supplier.isFixed ? 'text-[#bc76ff]' : 'text-white/80'}`}>{supplier.name}</span>
                            </div>
                            <span className={`text-[14px] flex-1 text-center ltr-num ${supplier.isFixed ? 'text-[#bc76ff]' : 'text-white/80'}`}>₪{supplier.amount.toLocaleString()}</span>
                            <span className={`text-[14px] flex-1 text-center ltr-num ${supplier.isFixed ? 'text-[#bc76ff]' : 'text-white/80'}`}>{supplier.percentage.toFixed(1)}%</span>
                          </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))
              )
            ) : (
              /* קניות סחורה - לפי שם ספק */
              expensesData.length === 0 ? (
                <div className="flex items-center justify-center py-[30px]">
                  <span className="text-[16px] text-white/50">אין נתונים להצגה</span>
                </div>
              ) : (
                expensesData.map((supplier, index) => (
                  <button
                    type="button"
                    key={supplier.id}
                    onClick={() => handleOpenSupplierBreakdown(supplier.id, supplier.name, "קניות סחורה")}
                    className={`flex items-center p-[5px] min-h-[50px] w-full hover:bg-[#29318A]/30 transition-colors cursor-pointer rounded-[7px] ${
                      index > 0 ? 'border-t border-white/10' : ''
                    }`}
                  >
                    <span
                      className={`w-[12px] h-[12px] rounded-full flex-shrink-0 mr-[8px] ${
                        index % 8 === 0 ? 'bg-[#FF6B6B]' :
                        index % 8 === 1 ? 'bg-[#4ECDC4]' :
                        index % 8 === 2 ? 'bg-[#45B7D1]' :
                        index % 8 === 3 ? 'bg-[#96CEB4]' :
                        index % 8 === 4 ? 'bg-[#FFEAA7]' :
                        index % 8 === 5 ? 'bg-[#DDA0DD]' :
                        index % 8 === 6 ? 'bg-[#98D8C8]' : 'bg-[#F7DC6F]'
                      }`}
                    />
                    <span className="text-[16px] flex-1 text-center">{supplier.name}</span>
                    <span className="text-[16px] flex-1 text-center ltr-num">₪{supplier.amount.toLocaleString()}</span>
                    <span className="text-[16px] flex-1 text-center ltr-num">{supplier.percentage.toFixed(1)}%</span>
                  </button>
                ))
              )
            )}
          </div>
        </div>
        )}

        {/* Full Details Button - only show when there's data */}
        {(activeTab === "expenses" ? categoryData.length > 0 : expensesData.length > 0) && (
          <div className="flex justify-center mt-0">
            <button
              type="button"
              onClick={() => router.push("/suppliers")}
              className="w-full bg-[#29318A] text-white text-[20px] font-semibold py-[14px] rounded-t-[5px] rounded-b-[20px] flex items-center justify-center gap-[8px] transition-colors hover:bg-[#3D44A0]"
            >
              <span>לפירוט המלא</span>
              <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className="flex-shrink-0">
                <path d="M20 10L14 16L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Recent Invoices Section - חשבוניות אחרונות שהוזנו (hidden when no invoices) */}
      {recentInvoices.length > 0 && (
      <div id="onboarding-expenses-filters" className="bg-[#0F1535] rounded-[20px] p-[15px_0px] mt-[10px] flex flex-col gap-[15px] w-full">
        {/* Header Row - RTL: פילטר בימין, כותרת באמצע, הורדה בשמאל */}
        <div className="flex items-center justify-between">
          {/* Filter Dropdown - Right side */}
          <div className="relative" ref={filterMenuRef}>
            <button
              type="button"
              title="סינון לפי"
              onClick={() => setShowFilterMenu(!showFilterMenu)}
              className={`${filterBy ? 'opacity-100' : 'opacity-50'} cursor-pointer`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className={filterBy ? 'text-[#bc76ff]' : 'text-white'}>
                <path d="M8.07136 12.6325C4.96261 10.3075 2.74511 7.75 1.53386 6.3125C1.15886 5.8675 1.03636 5.54125 0.962611 4.9675C0.710111 3.0025 0.583861 2.02 1.16011 1.385C1.73636 0.75 2.75511 0.75 4.79261 0.75H19.2076C21.2451 0.75 22.2639 0.75 22.8401 1.38375C23.4164 2.01875 23.2901 3.00125 23.0376 4.96625C22.9626 5.54 22.8401 5.86625 22.4664 6.31125C21.2539 7.75125 19.0326 10.3137 15.9164 12.6425C15.7723 12.7546 15.6531 12.8956 15.5666 13.0564C15.4801 13.2172 15.4281 13.3942 15.4139 13.5762C15.1051 16.99 14.8201 18.86 14.6426 19.805C14.3564 21.3325 12.1926 22.2513 11.0326 23.07C10.3426 23.5575 9.50511 22.9775 9.41636 22.2225C9.08445 19.3456 8.80357 16.4631 8.57386 13.5762C8.56102 13.3925 8.50964 13.2135 8.42307 13.0509C8.33649 12.8883 8.21666 12.7457 8.07136 12.6325Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {showFilterMenu && (
              <div className="absolute top-[30px] right-0 bg-[#1A2150] border border-white/20 rounded-[10px] py-[5px] min-w-[160px] z-50 shadow-lg shadow-black/40">
                {[
                  { value: "", label: "ללא סינון" },
                  { value: "date", label: "תאריך חשבונית" },
                  { value: "supplier", label: "ספק" },
                  { value: "reference", label: "מספר תעודה" },
                  { value: "amount", label: "סכום לפני מע\"מ" },
                  { value: "notes", label: "הערות" },
                  { value: "fixed", label: "הוצאות קבועות" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setFilterBy(option.value);
                      setFilterValue("");
                      setShowFilterMenu(false);
                    }}
                    className={`w-full text-right px-[12px] py-[8px] text-[13px] transition-colors ${
                      filterBy === option.value
                        ? 'text-[#bc76ff] bg-white/10'
                        : 'text-white hover:bg-white/5'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Title - Center */}
          <h2 className="text-[18px] font-bold text-center">חשבוניות אחרונות שהוזנו</h2>

          {/* Download Button - Left side */}
          <button
            type="button"
            className="flex flex-col items-center gap-[5px] cursor-pointer"
            onClick={() => {
              const searchVal = filterValue.trim().toLowerCase();
              let filtered = recentInvoices.filter((inv) => {
                if (!filterBy) return true;
                if (filterBy === "fixed") return inv.isFixed;
                if (!searchVal) return true;
                switch (filterBy) {
                  case "date": return inv.date.includes(searchVal);
                  case "supplier": return inv.supplier.toLowerCase().includes(searchVal);
                  case "reference": return inv.reference.toLowerCase().includes(searchVal);
                  case "amount": return inv.amountBeforeVat.toLocaleString().includes(searchVal) || inv.amountBeforeVat.toString().includes(searchVal);
                  case "notes": return inv.notes.toLowerCase().includes(searchVal);
                  default: return true;
                }
              });
              if (dateSortOrder) {
                filtered = [...filtered].sort((a, b) => {
                  const [dA, mA, yA] = a.date.split(".").map(Number);
                  const [dB, mB, yB] = b.date.split(".").map(Number);
                  const dateA = (yA + 2000) * 10000 + mA * 100 + dA;
                  const dateB = (yB + 2000) * 10000 + mB * 100 + dB;
                  return dateSortOrder === "asc" ? dateA - dateB : dateB - dateA;
                });
              }
              const headers = ["תאריך", "ספק", "אסמכתא", "סכום לפני מע״מ", "סכום כולל מע״מ", "סטטוס", "הערות"];
              const rows = filtered.map((inv) => {
                const status = inv.isFixed && (inv.attachmentUrls.length === 0 || !inv.reference) ? "ה.קבועה" : inv.status;
                return [
                  inv.date,
                  `"${inv.supplier.replace(/"/g, '""')}"`,
                  inv.reference || "-",
                  inv.amountBeforeVat,
                  inv.amountWithVat,
                  status,
                  `"${(inv.notes || "").replace(/"/g, '""')}"`,
                ];
              });
              const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
              const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = `expenses_${new Date().toISOString().split("T")[0]}.csv`;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none" className="text-white">
              <path d="M16 4V22M16 22L10 16M16 22L22 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6 28H26" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="text-[12px] text-white text-center">הורדת חשבוניות</span>
          </button>
        </div>

        {/* Filter Input Bar */}
        {filterBy && filterBy !== "fixed" && (
          <div className="flex items-center gap-[10px] px-[10px]">
            <span className="text-[13px] text-white/60 whitespace-nowrap">
              {filterBy === "date" ? "תאריך:" : filterBy === "supplier" ? "ספק:" : filterBy === "reference" ? "אסמכתא:" : filterBy === "amount" ? "סכום:" : "הערות:"}
            </span>
            <input
              type="text"
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
              placeholder={
                filterBy === "date" ? "לדוגמה: 01.02" :
                filterBy === "supplier" ? "הקלד שם ספק..." :
                filterBy === "reference" ? "הקלד מספר תעודה..." :
                filterBy === "amount" ? "הקלד סכום..." :
                "הקלד טקסט..."
              }
              className="flex-1 bg-white/10 text-white text-[13px] rounded-[7px] px-[10px] py-[6px] outline-none placeholder:text-white/30"
            />
            <button
              type="button"
              title="ניקוי סינון"
              onClick={() => { setFilterBy(""); setFilterValue(""); }}
              className="text-white/50 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {filterBy === "fixed" && (
          <div className="flex items-center gap-[10px] px-[10px]">
            <span className="text-[13px] text-[#bc76ff]">מציג הוצאות קבועות בלבד</span>
            <button
              type="button"
              title="ניקוי סינון"
              onClick={() => { setFilterBy(""); setFilterValue(""); }}
              className="text-white/50 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Table */}
        <div id="onboarding-expenses-list" className="w-full flex flex-col gap-[5px]">
          {/* Table Header */}
          <div className="grid grid-cols-[0.7fr_1.4fr_1fr_0.8fr_0.9fr] bg-[#29318A] rounded-t-[7px] p-[10px_5px] items-center">
            <button
              type="button"
              onClick={() => setDateSortOrder(prev => prev === "asc" ? "desc" : prev === "desc" ? null : "asc")}
              className="text-[13px] font-medium text-center cursor-pointer hover:text-white/80 transition-colors flex items-center justify-center gap-[3px]"
            >
              תאריך
              {dateSortOrder && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
                  <path d={dateSortOrder === "asc" ? "M12 19V5M12 5L5 12M12 5L19 12" : "M12 5V19M12 19L5 12M12 19L19 12"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
            <span className="text-[13px] font-medium text-center">ספק</span>
            <span className="text-[13px] font-medium text-center">אסמכתא</span>
            <span className="text-[13px] font-medium text-center">סכום</span>
            <span className="text-[13px] font-medium text-center">סטטוס</span>
          </div>

          {/* Table Rows */}
          <div className="max-h-[450px] overflow-y-auto flex flex-col gap-[5px]">
            {(() => {
              const searchVal = filterValue.trim().toLowerCase();
              let filtered = recentInvoices.filter((inv) => {
                if (!filterBy) return true;
                if (filterBy === "fixed") return inv.isFixed;
                if (!searchVal) return true;
                switch (filterBy) {
                  case "date": return inv.date.includes(searchVal);
                  case "supplier": return inv.supplier.toLowerCase().includes(searchVal);
                  case "reference": return inv.reference.toLowerCase().includes(searchVal);
                  case "amount": return inv.amountBeforeVat.toLocaleString().includes(searchVal) || inv.amountBeforeVat.toString().includes(searchVal);
                  case "notes": return inv.notes.toLowerCase().includes(searchVal);
                  default: return true;
                }
              });
              if (dateSortOrder) {
                filtered = [...filtered].sort((a, b) => {
                  const [dA, mA, yA] = a.date.split(".").map(Number);
                  const [dB, mB, yB] = b.date.split(".").map(Number);
                  const dateA = (yA + 2000) * 10000 + mA * 100 + dA;
                  const dateB = (yB + 2000) * 10000 + mB * 100 + dB;
                  return dateSortOrder === "asc" ? dateA - dateB : dateB - dateA;
                });
              }
              return filtered.length === 0 ? (
              <div className="flex items-center justify-center py-[40px]">
                <span className="text-[16px] text-white/50">{filterBy ? 'לא נמצאו תוצאות' : 'אין חשבוניות להצגה'}</span>
              </div>
            ) : filtered.map((invoice) => {
              // Fixed expense that still needs attachment or reference - show purple
              const isFixedPending = invoice.isFixed && (invoice.attachmentUrls.length === 0 || !invoice.reference);
              return (
              <div
                key={invoice.id}
                className={`bg-[#29318A]/30 rounded-[7px] p-[7px_3px] border transition-colors ${
                  expandedInvoiceId === invoice.id ? 'border-white' : 'border-transparent'
                }`}
              >
                {/* Main Row */}
                <div className="grid grid-cols-[0.7fr_1.4fr_1fr_0.8fr_0.9fr] w-full p-[5px_5px] hover:bg-[#29318A]/30 transition-colors rounded-[7px] items-center">
                  {/* Date - Clickable */}
                  <button
                    type="button"
                    onClick={() => setExpandedInvoiceId(expandedInvoiceId === invoice.id ? null : invoice.id)}
                    className="flex items-center justify-center gap-[2px] cursor-pointer"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 32 32"
                      fill="none"
                      className={`flex-shrink-0 transition-transform ${isFixedPending ? 'text-[#bc76ff]' : 'text-white/50'} ${expandedInvoiceId === invoice.id ? 'rotate-90' : ''}`}
                    >
                      <path d="M20 10L14 16L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className={`text-[12px] ltr-num ${isFixedPending ? 'text-[#bc76ff]' : ''}`}>{invoice.date}</span>
                  </button>
                  {/* Supplier - Clickable */}
                  <button
                    type="button"
                    onClick={() => setExpandedInvoiceId(expandedInvoiceId === invoice.id ? null : invoice.id)}
                    className={`text-[12px] text-center leading-tight cursor-pointer break-words px-[2px] ${isFixedPending ? 'text-[#bc76ff]' : ''}`}
                  >
                    {invoice.supplier}
                  </button>
                  {/* Reference - Clickable */}
                  <button
                    type="button"
                    onClick={() => setExpandedInvoiceId(expandedInvoiceId === invoice.id ? null : invoice.id)}
                    className={`text-[12px] text-center ltr-num cursor-pointer truncate px-[2px] ${isFixedPending ? 'text-[#bc76ff]' : ''}`}
                  >
                    {invoice.reference || "-"}
                  </button>
                  {/* Amount - Clickable */}
                  <button
                    type="button"
                    onClick={() => setExpandedInvoiceId(expandedInvoiceId === invoice.id ? null : invoice.id)}
                    className={`text-[12px] text-center ltr-num font-medium cursor-pointer ${isFixedPending ? 'text-[#bc76ff]' : ''}`}
                  >
                    ₪{invoice.amountBeforeVat.toLocaleString()}
                  </button>
                  {/* Status - Clickable with dropdown */}
                  <div className="flex justify-center min-w-0" data-status-menu>
                    <button
                      type="button"
                      onClick={(e) => {
                        if (invoice.isFixed) {
                          showToast("לא ניתן לשנות סטטוס להוצאה חודשית קבועה – הסטטוס מתעדכן אוטומטית", "warning");
                          return;
                        }
                        if (showStatusMenu === invoice.id) {
                          setShowStatusMenu(null);
                        } else {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setShowStatusMenu(invoice.id);
                          // Update menu position after render
                          setTimeout(() => {
                            if (statusMenuRef.current) {
                              statusMenuRef.current.style.setProperty('--menu-top', `${rect.bottom + 5}px`);
                              statusMenuRef.current.style.setProperty('--menu-left', `${rect.left + rect.width / 2}px`);
                            }
                          }, 0);
                        }
                      }}
                      className={`text-[12px] font-bold px-[8px] py-[5px] rounded-full cursor-pointer hover:opacity-80 transition-opacity whitespace-nowrap ${
                        isFixedPending ? 'bg-[#bc76ff]' :
                        invoice.status === 'שולם' ? 'bg-[#00E096]' :
                        invoice.status === 'בבירור' ? 'bg-[#FFA500]' : 'bg-[#29318A]'
                      }`}
                    >
                      {isFixedPending ? 'ה.קבועה' : invoice.status}
                    </button>
                  </div>
                </div>

                {/* Expanded Content */}
                {expandedInvoiceId === invoice.id && (
                  <div className="flex flex-col gap-[20px] p-[5px] mt-[10px]">
                    {/* Notes Section - only show if has notes */}
                    {invoice.notes && invoice.notes.trim() !== "" && (
                      <div className="border border-white/50 rounded-[7px] p-[3px] flex flex-col gap-[3px]">
                        <span className="text-[14px] text-[#979797] text-right">הערות</span>
                        <textarea
                          title="הערות להוצאה"
                          disabled
                          rows={2}
                          value={invoice.notes}
                          className="w-full bg-transparent text-white text-[14px] font-bold text-right resize-none outline-none min-h-[70px]"
                        />
                      </div>
                    )}

                    {/* Clarification Reason - only show for "בבירור" status */}
                    {invoice.status === "בבירור" && invoice.clarificationReason && (
                      <div className="border border-[#FFA500]/50 rounded-[7px] p-[3px] flex flex-col gap-[3px]">
                        <span className="text-[14px] text-[#FFA500] text-right">סיבת בירור</span>
                        <span className="text-[14px] text-white font-bold text-right px-[3px]">{invoice.clarificationReason}</span>
                      </div>
                    )}

                    {/* Additional Details Section */}
                    <div className="border border-white/50 rounded-[7px] p-[3px] flex flex-col gap-[15px]">
                      {/* Header with title and action icons */}
                      <div className="flex items-center justify-between border-b border-white/35 pb-[10px]">
                        <span className="text-[16px] font-medium text-white ml-[7px]">פרטים נוספים</span>
                        <div className="flex items-center gap-[6px]">
                          {/* Image/View Icon - only show if has attachments */}
                          {invoice.attachmentUrls.length > 0 && (
                            <button
                              type="button"
                              title="צפייה בתמונה"
                              onClick={() => window.open(invoice.attachmentUrls[0], '_blank')}
                              className="w-[18px] h-[18px] text-white/70 hover:text-white transition-colors"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <circle cx="8.5" cy="8.5" r="1.5"/>
                                <polyline points="21 15 16 10 5 21"/>
                              </svg>
                            </button>
                          )}
                          {/* Download Icon - only show if has attachments */}
                          {invoice.attachmentUrls.length > 0 && (
                            <a
                              href={invoice.attachmentUrls[0]}
                              download
                              title="הורדה"
                              className="w-[18px] h-[18px] text-white/70 hover:text-white transition-colors"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                              </svg>
                            </a>
                          )}
                          {/* Edit Icon */}
                          <button
                            type="button"
                            title="עריכה"
                            onClick={() => handleEditInvoice(invoice)}
                            className="w-[18px] h-[18px] text-white/70 hover:text-white transition-colors"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                          {/* Delete Icon */}
                          <button
                            type="button"
                            title="מחיקה"
                            onClick={() => handleDeleteClick(invoice.id)}
                            className="w-[18px] h-[18px] text-white/70 hover:text-[#F64E60] transition-colors"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              <line x1="10" y1="11" x2="10" y2="17"/>
                              <line x1="14" y1="11" x2="14" y2="17"/>
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Attachment Thumbnails */}
                      {invoice.attachmentUrls.length > 0 && (
                        <div className="flex flex-wrap gap-[8px] px-[7px]">
                          {invoice.attachmentUrls.map((url, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => window.open(url, '_blank')}
                              className="border border-white/20 rounded-[8px] overflow-hidden w-[70px] h-[70px] hover:border-white/50 transition-colors"
                            >
                              {url.endsWith(".pdf") ? (
                                <div className="w-full h-full flex items-center justify-center bg-white/5">
                                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/50">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                    <polyline points="14 2 14 8 20 8"/>
                                    <line x1="16" y1="13" x2="8" y2="13"/>
                                    <line x1="16" y1="17" x2="8" y2="17"/>
                                  </svg>
                                </div>
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={url} alt={`חשבונית ${idx + 1}`} className="w-full h-full object-cover" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Details Grid */}
                      <div className="flex flex-row-reverse items-center justify-between px-[7px]">
                        <div className="flex flex-col items-center">
                          <span className="text-[14px] text-[#979797]">סכום כולל מע&quot;מ</span>
                          <span className="text-[14px] text-white ltr-num">₪{invoice.amountWithVat.toLocaleString()}</span>
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="text-[14px] text-[#979797]">סכום לפני מע&quot;מ</span>
                          <span className="text-[14px] text-white ltr-num">₪{invoice.amountBeforeVat.toLocaleString()}</span>
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="text-[14px] text-[#979797]">הוזן ע&quot;י</span>
                          <span className="text-[14px] text-white">{invoice.enteredBy}</span>
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="text-[14px] text-[#979797]">תאריך הזנה</span>
                          <span className="text-[14px] text-white ltr-num">{invoice.entryDate}</span>
                        </div>
                      </div>
                    </div>

                    {/* Linked Payments Section - only show if has payments */}
                    {invoice.linkedPayments.length > 0 && (
                      <div className="border border-white/20 rounded-[7px] p-[7px] flex flex-col gap-[10px]">
                        <button
                          type="button"
                          onClick={() => setShowLinkedPayments(showLinkedPayments === invoice.id ? null : invoice.id)}
                          className="bg-[#29318A] text-white text-[16px] font-medium py-[5px] px-[14px] rounded-[7px] self-start"
                        >
                          הצגת תשלומים מקושרים ({invoice.linkedPayments.length})
                        </button>

                        {/* Linked Payments List */}
                        {showLinkedPayments === invoice.id && (
                          <div className="flex flex-col gap-[5px]">
                            {invoice.linkedPayments.map((payment) => (
                              <div
                                key={payment.id}
                                className="flex items-center justify-between p-[5px] rounded-[10px] min-h-[50px]"
                              >
                                <div className="flex items-center gap-[5px] opacity-50">
                                  <button type="button" title="עריכה" className="w-[20px] h-[20px]">
                                    <svg viewBox="0 0 32 32" fill="currentColor" className="w-full h-full text-white"/>
                                  </button>
                                  <button type="button" title="מחיקה" className="w-[20px] h-[20px]">
                                    <svg viewBox="0 0 32 32" fill="currentColor" className="w-full h-full text-white"/>
                                  </button>
                                </div>
                                <span className="text-[14px] text-white text-center ltr-num w-[65px]">₪{payment.amount.toLocaleString()}</span>
                                <span className="text-[14px] text-white text-center flex-1">{payment.method}</span>
                                <span className="text-[14px] text-white text-center flex-1">{payment.installments}</span>
                                <div className="w-[65px] text-center">
                                  <span className="text-[14px] text-white ltr-num">{payment.date || '-'}</span>
                                </div>
                                <div className="flex items-center justify-end gap-0 w-[60px]">
                                  <svg width="15" height="15" viewBox="0 0 32 32" fill="none" className="text-white/50">
                                    <path d="M12 10L18 16L12 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            });
            })()}
          </div>
        </div>
      </div>
      )}

      {/* Add Expense Popup */}
      <Sheet open={showAddExpensePopup} onOpenChange={(open) => !open && handleClosePopup()}>
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
              <SheetTitle className="text-white text-xl font-bold">הוספת הוצאה חדשה</SheetTitle>
              <div className="w-[24px]" />
            </div>
          </SheetHeader>

            {/* Form */}
            <div className="flex flex-col gap-[15px] px-[5px]">
              {/* Date Field */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">תאריך</label>
                <div className="relative border border-[#4C526B] rounded-[10px] h-[50px] px-[10px] flex items-center justify-center">
                  <span className={`text-[16px] font-semibold pointer-events-none ${expenseDate ? 'text-white' : 'text-white/40'}`}>
                    {expenseDate
                      ? new Date(expenseDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
                      : 'יום/חודש/שנה'}
                  </span>
                  <input
                    type="date"
                    title="תאריך הוצאה"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                </div>
              </div>

              {/* Expense Type */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">סוג הוצאה</label>
                <div className="flex items-center justify-start gap-[20px]">
                  <button
                    type="button"
                    onClick={() => setExpenseType("goods")}
                    className="flex items-center gap-[3px]"
                  >
                    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={expenseType === "goods" ? "text-white" : "text-white/50"}>
                      {expenseType === "goods" ? (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                      ) : (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                    <span className={`text-[15px] font-semibold ${expenseType === "goods" ? "text-white" : "text-white/50"}`}>
                      קניות סחורה
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpenseType("current")}
                    className="flex items-center gap-[3px]"
                  >
                    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={expenseType === "current" ? "text-white" : "text-white/50"}>
                      {expenseType === "current" ? (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                      ) : (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                    <span className={`text-[15px] font-semibold ${expenseType === "current" ? "text-white" : "text-white/50"}`}>
                      הוצאות שוטפות
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpenseType("employees")}
                    className="flex items-center gap-[3px]"
                  >
                    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={expenseType === "employees" ? "text-white" : "text-white/50"}>
                      {expenseType === "employees" ? (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                      ) : (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                    <span className={`text-[15px] font-semibold ${expenseType === "employees" ? "text-white" : "text-white/50"}`}>
                      עלות עובדים
                    </span>
                  </button>
                </div>
              </div>

              {/* Supplier Select */}
              <SupplierSearchSelect
                suppliers={suppliers}
                value={selectedSupplier}
                onChange={setSelectedSupplier}
              />

              {/* Invoice Number */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-normal text-white text-right">מספר חשבונית / תעודת משלוח</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="מספר חשבונית..."
                    className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
                  />
                </div>
              </div>

              {/* Amount Before VAT */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">סכום לפני מע&apos;&apos;מ</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <input
                    type="text"
                    inputMode="decimal"
                    title="סכום לפני מע״מ"
                    value={amountBeforeVat}
                    onChange={(e) => setAmountBeforeVat(e.target.value)}
                    placeholder="0.00"
                    className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
                  />
                </div>
              </div>

              {/* Partial VAT Checkbox and VAT Amount */}
              <div className="flex items-center justify-between gap-[15px]">
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[15px] font-medium text-white text-right">מע&quot;מ</label>
                  <div className="border border-[#4C526B] rounded-[10px] h-[50px] w-[148px]">
                    <input
                      type="text"
                      inputMode="decimal"
                      title="סכום מע״מ"
                      placeholder="0.00"
                      value={partialVat ? vatAmount : calculatedVat.toFixed(2)}
                      onChange={(e) => setVatAmount(e.target.value)}
                      disabled={!partialVat}
                      className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px] disabled:text-white/50"
                    />
                  </div>
                </div>
                <div className="flex flex-col items-center gap-[5px]">
                  <button
                    type="button"
                    title="הזנת סכום מע״מ חלקי"
                    onClick={() => setPartialVat(!partialVat)}
                    className="text-[#979797]"
                  >
                    <svg width="21" height="21" viewBox="0 0 32 32" fill="none">
                      {partialVat ? (
                        <>
                          <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                          <path d="M10 16L14 20L22 12" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </>
                      ) : (
                        <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                  </button>
                  <span className="text-[15px] font-medium text-white">הזנת סכום מע&quot;מ חלקי</span>
                </div>
              </div>

              {/* Total with VAT */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">סכום כולל מע&quot;מ</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <input
                    type="text"
                    title="סכום כולל מע״מ"
                    placeholder="0.00"
                    value={totalWithVat.toFixed(2)}
                    disabled
                    className="w-full h-full bg-transparent text-white/50 text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
                  />
                </div>
              </div>

              {/* Image Upload - Multiple */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[16px] font-medium text-white text-right">תמונות/מסמכים</label>
                {newAttachmentPreviews.length > 0 && (
                  <div className="flex flex-wrap gap-[8px] mb-[5px]">
                    {newAttachmentPreviews.map((preview, idx) => {
                      return (
                      <div key={idx} className="relative group border border-[#4C526B] rounded-[8px] overflow-hidden w-[80px] h-[80px]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={preview} alt={`תמונה ${idx + 1}`} className="w-full h-full object-cover cursor-pointer" onClick={() => window.open(preview, '_blank')} />
                        <button
                          type="button"
                          onClick={() => {
                            setNewAttachmentFiles(prev => prev.filter((_, i) => i !== idx));
                            setNewAttachmentPreviews(prev => prev.filter((_, i) => i !== idx));
                          }}
                          className="absolute top-[2px] left-[2px] bg-[#F64E60] text-white rounded-full w-[18px] h-[18px] flex items-center justify-center text-[12px] opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      </div>
                      );
                    })}
                  </div>
                )}
                <label className="border border-[#4C526B] border-dashed rounded-[10px] h-[50px] flex items-center justify-center px-[10px] cursor-pointer hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-[10px]">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/50">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <span className="text-[14px] text-white/50">{newAttachmentPreviews.length > 0 ? "הוסף תמונה/מסמך נוסף" : "לחץ להעלאת תמונה/מסמך"}</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    multiple
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (files && files.length > 0) {
                        const arr = Array.from(files);
                        setNewAttachmentFiles(prev => [...prev, ...arr]);
                        // Generate previews - for PDFs render first page as image
                        const previews = await Promise.all(arr.map(async (f) => {
                          if (f.type === "application/pdf") {
                            try {
                              const imgFile = await convertPdfToImage(f);
                              return URL.createObjectURL(imgFile);
                            } catch {
                              return URL.createObjectURL(f);
                            }
                          }
                          return URL.createObjectURL(f);
                        }));
                        setNewAttachmentPreviews(prev => [...prev, ...previews]);
                      }
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                </label>
                {isUploadingAttachment && (
                  <span className="text-[12px] text-white/50 text-center">מעלה קבצים...</span>
                )}
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">הערות למסמך</label>
                <div className="border border-[#4C526B] rounded-[10px] min-h-[100px]">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="הערות למסמך..."
                    className="w-full h-full min-h-[100px] bg-transparent text-white text-[16px] text-right rounded-[10px] border-none outline-none p-[10px] resize-none"
                  />
                </div>
              </div>

              {/* Document Status Checkboxes */}
              <div className="flex flex-col gap-[3px]" dir="rtl">
                {/* Paid in Full Checkbox */}
                <button
                  type="button"
                  onClick={() => {
                    const newVal = !isPaidInFull;
                    setIsPaidInFull(newVal);
                    if (newVal) {
                      const today = new Date().toISOString().split('T')[0];
                      setPaymentDate(today);
                      const amount = totalWithVat > 0 ? totalWithVat.toString() : "";
                      setPopupPaymentMethods([{
                        id: 1,
                        method: "",
                        amount,
                        installments: "1",
                        checkNumber: "",
                        customInstallments: amount ? generatePopupInstallments(1, totalWithVat, today) : [],
                      }]);
                    }
                  }}
                  className="flex items-center gap-[3px] min-h-[35px]"
                >
                  <svg width="21" height="21" viewBox="0 0 32 32" fill="none" className="text-[#979797]">
                    {isPaidInFull ? (
                      <>
                        <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                        <path d="M10 16L14 20L22 12" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </>
                    ) : (
                      <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2"/>
                    )}
                  </svg>
                  <span className="text-[15px] font-medium text-white">התעודה שולמה במלואה</span>
                </button>

                {/* Payment Details Section - shown when isPaidInFull is true */}
                {isPaidInFull && (
                  <div className="bg-[#0F1535] rounded-[10px] p-[25px_5px_5px] mt-[15px]">
                    <h3 className="text-[18px] font-semibold text-white text-center mb-[20px]">הוספת הוצאה - קליטת תשלום</h3>

                    <div className="flex flex-col gap-[15px]">
                      {/* Payment Date */}
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[15px] font-medium text-white text-right">תאריך תשלום</label>
                        <div className="relative border border-[#4C526B] rounded-[10px] h-[50px] px-[10px] flex items-center justify-center">
                          <span className={`text-[16px] font-semibold pointer-events-none ${paymentDate ? 'text-white' : 'text-white/40'}`}>
                            {paymentDate
                              ? new Date(paymentDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
                              : 'יום/חודש/שנה'}
                          </span>
                          <input
                            type="date"
                            title="תאריך תשלום"
                            value={paymentDate}
                            onChange={(e) => {
                              setPaymentDate(e.target.value);
                              setPopupPaymentMethods(prev => prev.map(p => {
                                const numInstallments = parseInt(p.installments) || 1;
                                const totalAmount = parseFloat(p.amount.replace(/[^\d.]/g, "")) || 0;
                                if (numInstallments >= 1 && totalAmount > 0) {
                                  return { ...p, customInstallments: generatePopupInstallments(numInstallments, totalAmount, e.target.value) };
                                }
                                return { ...p, customInstallments: [] };
                              }));
                            }}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                          />
                        </div>
                      </div>

                      {/* Payment Methods Section */}
                      <div className="flex flex-col gap-[15px]">
                        <div className="flex items-center justify-between">
                          <span className="text-[15px] font-medium text-white">אמצעי תשלום</span>
                          <button
                            type="button"
                            onClick={addPopupPaymentMethodEntry}
                            className="bg-[#29318A] text-white text-[14px] font-medium px-[12px] py-[6px] rounded-[7px] hover:bg-[#3D44A0] transition-colors"
                          >
                            + הוסף אמצעי תשלום
                          </button>
                        </div>

                        {popupPaymentMethods.map((pm, pmIndex) => (
                          <div key={pm.id} className="border border-[#4C526B] rounded-[10px] p-[10px] flex flex-col gap-[10px]">
                            {popupPaymentMethods.length > 1 && (
                              <div className="flex items-center justify-between mb-[5px]">
                                <span className="text-[14px] text-white/70">אמצעי תשלום {pmIndex + 1}</span>
                                <button
                                  type="button"
                                  onClick={() => removePopupPaymentMethodEntry(pm.id)}
                                  className="text-[14px] text-red-400 hover:text-red-300 transition-colors"
                                >
                                  הסר
                                </button>
                              </div>
                            )}

                            <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
                              <select
                                title="בחירת אמצעי תשלום"
                                value={pm.method}
                                onChange={(e) => updatePopupPaymentMethodField(pm.id, "method", e.target.value)}
                                className="w-full h-[50px] bg-[#0F1535] text-[18px] text-white text-center focus:outline-none rounded-[10px] cursor-pointer select-dark"
                              >
                                <option value="" disabled>בחר אמצעי תשלום...</option>
                                {paymentMethodOptions.map((method) => (
                                  <option key={method.value} value={method.value}>{method.label}</option>
                                ))}
                              </select>
                            </div>

                            {/* Check Number - only show when method is check */}
                            {pm.method === "check" && (
                              <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  title="מספר צ'ק"
                                  value={pm.checkNumber}
                                  onChange={(e) => updatePopupPaymentMethodField(pm.id, "checkNumber", e.target.value)}
                                  placeholder="מספר צ'ק..."
                                  className="w-full h-[50px] bg-transparent text-[18px] text-white text-center focus:outline-none px-[10px] rounded-[10px]"
                                />
                              </div>
                            )}

                            <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={pm.amount ? `₪${parseFloat(pm.amount.replace(/[^\d.]/g, "") || "0").toLocaleString("he-IL")}` : ""}
                                onChange={(e) => {
                                  const rawValue = e.target.value.replace(/[^\d.]/g, "");
                                  updatePopupPaymentMethodField(pm.id, "amount", rawValue);
                                }}
                                placeholder="₪0.00 סכום"
                                className="w-full h-[50px] bg-transparent text-[18px] text-white text-right focus:outline-none px-[10px] rounded-[10px]"
                              />
                            </div>

                            <div className="flex flex-col gap-[3px]">
                              <span className="text-[14px] text-white/70">כמות תשלומים</span>
                              <div className="border border-[#4C526B] rounded-[10px] min-h-[50px] flex items-center">
                                <button
                                  type="button"
                                  title="הפחת תשלום"
                                  onClick={() => updatePopupPaymentMethodField(pm.id, "installments", String(Math.max(1, parseInt(pm.installments) - 1)))}
                                  className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
                                >
                                  -
                                </button>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  title="כמות תשלומים"
                                  value={pm.installments}
                                  onChange={(e) => updatePopupPaymentMethodField(pm.id, "installments", e.target.value.replace(/\D/g, "") || "1")}
                                  className="flex-1 h-[50px] bg-transparent text-[18px] text-white text-center focus:outline-none"
                                />
                                <button
                                  type="button"
                                  title="הוסף תשלום"
                                  onClick={() => updatePopupPaymentMethodField(pm.id, "installments", String(parseInt(pm.installments) + 1))}
                                  className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
                                >
                                  +
                                </button>
                              </div>

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
                                            onChange={(e) => handlePopupInstallmentDateChange(pm.id, index, e.target.value)}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                          />
                                        </div>
                                        <div className="flex-1 relative">
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            title={`סכום תשלום ${item.number}`}
                                            value={item.amount.toFixed(2)}
                                            onChange={(e) => handlePopupInstallmentAmountChange(pm.id, index, e.target.value)}
                                            className="w-full h-[36px] bg-[#29318A]/30 border border-[#4C526B] rounded-[7px] text-[14px] text-white text-center focus:outline-none focus:border-white/50 px-[5px] ltr-num"
                                          />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  {(() => {
                                    const installmentsTotal = getPopupInstallmentsTotal(pm.customInstallments);
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

                      {/* Payment Reference */}
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[15px] font-medium text-white text-right">אסמכתא</label>
                        <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
                          <input
                            type="text"
                            placeholder="מספר אסמכתא..."
                            value={paymentReference}
                            onChange={(e) => setPaymentReference(e.target.value)}
                            className="w-full h-[50px] bg-transparent text-[18px] text-white text-right focus:outline-none px-[10px] rounded-[10px]"
                          />
                        </div>
                      </div>

                      {/* Receipt Upload */}
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[15px] font-medium text-white text-right">קבלת תשלום</label>
                        {paymentReceiptPreview ? (
                          <div className="border border-[#4C526B] rounded-[10px] p-[10px] flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => { setPaymentReceiptFile(null); setPaymentReceiptPreview(null); }}
                              className="text-[#F64E60] text-[14px] hover:underline"
                            >
                              הסר
                            </button>
                            <div className="flex items-center gap-[10px]">
                              <span className="text-[14px] text-white/70 truncate max-w-[150px]">
                                {paymentReceiptFile?.name || "קובץ"}
                              </span>
                              <button
                                type="button"
                                title="צפייה בקובץ"
                                onClick={() => window.open(paymentReceiptPreview, '_blank')}
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
                                  setPaymentReceiptFile(file);
                                  setPaymentReceiptPreview(URL.createObjectURL(file));
                                }
                              }}
                              className="hidden"
                            />
                          </label>
                        )}
                        {isUploadingPaymentReceipt && (
                          <span className="text-[12px] text-white/50 text-center">מעלה קובץ...</span>
                        )}
                      </div>

                      {/* Payment Notes */}
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[15px] font-medium text-white text-right">הערות</label>
                        <div className="border border-[#4C526B] rounded-[10px] min-h-[100px]">
                          <textarea
                            value={paymentNotes}
                            onChange={(e) => setPaymentNotes(e.target.value)}
                            placeholder="הערות..."
                            className="w-full h-[100px] bg-transparent text-[18px] text-white text-right focus:outline-none px-[10px] py-[10px] rounded-[10px] resize-none"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Document Clarification - hidden when isPaidInFull */}
                {!isPaidInFull && (
                  <div className="flex flex-col gap-[10px]">
                    <button
                      type="button"
                      onClick={() => {
                        if (needsClarification) {
                          setNeedsClarification(false);
                          setShowClarificationMenu(false);
                          setClarificationReason("");
                        } else {
                          setNeedsClarification(true);
                          setShowClarificationMenu(true);
                        }
                      }}
                      className="flex items-center gap-[3px]"
                    >
                      <svg width="21" height="21" viewBox="0 0 32 32" fill="none" className="text-[#979797]">
                        {needsClarification ? (
                          <>
                            <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                            <path d="M10 16L14 20L22 12" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </>
                        ) : (
                          <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2"/>
                        )}
                      </svg>
                      <span className="text-[15px] font-medium text-white">מסמך בבירור</span>
                    </button>

                    {/* Clarification Menu */}
                    {showClarificationMenu && (
                      <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-[10px] flex flex-col gap-[8px]">
                        {["הזמנה לא סופקה במלואה", "טעות במחיר", "תעודת משלוח", "אחר (פרט/י)"].map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              setClarificationReason(option === "אחר (פרט/י)" ? "" : option);
                              setShowClarificationMenu(false);
                            }}
                            className="text-[15px] text-white text-right py-[8px] px-[10px] hover:bg-[#29318A]/30 rounded-[7px] transition-colors"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Clarification Reason Textarea - shown after selection */}
                    {needsClarification && !showClarificationMenu && (
                      <div className="border border-[#4C526B] rounded-[10px] min-h-[75px]">
                        <textarea
                          title="סיבת בירור"
                          value={clarificationReason}
                          onChange={(e) => setClarificationReason(e.target.value)}
                          placeholder={clarificationReason ? "" : "פרט/י את הסיבה..."}
                          className="w-full h-full min-h-[75px] bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none p-[10px] resize-none"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Submit and Cancel Buttons */}
              <div className="flex gap-[10px] mt-[10px] mb-[10px]">
                <button
                  type="button"
                  onClick={handleSaveExpense}
                  disabled={isSaving}
                  className="flex-1 bg-[#29318A] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-[#3D44A0] disabled:opacity-50"
                >
                  {isSaving ? "שומר..." : "הוספת הוצאה"}
                </button>
                <button
                  type="button"
                  onClick={handleClosePopup}
                  className="flex-1 bg-transparent border border-[#4C526B] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-white/10"
                >
                  ביטול
                </button>
              </div>
            </div>
        </SheetContent>
      </Sheet>

      {/* Edit Expense Popup */}
      <Sheet open={showEditPopup && !!editingInvoice} onOpenChange={(open) => !open && handleCloseEditPopup()}>
        <SheetContent
          side="bottom"
          className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
          showCloseButton={false}
        >
          <SheetHeader className="border-b border-[#4C526B] pb-4">
            <div className="flex justify-between items-center" dir="ltr">
              <button
                type="button"
                onClick={handleCloseEditPopup}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </button>
              <SheetTitle className="text-white text-xl font-bold">עריכת הוצאה</SheetTitle>
              <div className="w-[24px]" />
            </div>
          </SheetHeader>

            {/* Form */}
            <div className="flex flex-col gap-[15px] px-[5px]">
              {/* Date Field */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">תאריך</label>
                <div className="relative border border-[#4C526B] rounded-[10px] h-[50px] px-[10px] flex items-center justify-center">
                  <span className={`text-[16px] font-semibold pointer-events-none ${expenseDate ? 'text-white' : 'text-white/40'}`}>
                    {expenseDate
                      ? new Date(expenseDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
                      : 'יום/חודש/שנה'}
                  </span>
                  <input
                    type="date"
                    title="תאריך הוצאה"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                </div>
              </div>

              {/* Supplier Select */}
              <SupplierSearchSelect
                suppliers={suppliers}
                value={selectedSupplier}
                onChange={setSelectedSupplier}
              />

              {/* Invoice Number */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-normal text-white text-right">מספר חשבונית / תעודת משלוח</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="מספר חשבונית..."
                    className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
                  />
                </div>
              </div>

              {/* Amount Before VAT */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">סכום לפני מע&apos;&apos;מ</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <input
                    type="text"
                    inputMode="decimal"
                    title="סכום לפני מע״מ"
                    value={amountBeforeVat}
                    onChange={(e) => setAmountBeforeVat(e.target.value)}
                    placeholder="0.00"
                    className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
                  />
                </div>
              </div>

              {/* Image Upload - Multiple */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[16px] font-medium text-white text-right">תמונות/מסמכים</label>
                {/* Existing + new attachment previews */}
                {editAttachmentPreviews.length > 0 && (
                  <div className="flex flex-wrap gap-[8px] mb-[5px]">
                    {editAttachmentPreviews.map((preview, idx) => (
                      <div key={idx} className="relative group border border-[#4C526B] rounded-[8px] overflow-hidden w-[80px] h-[80px]">
                        {preview.endsWith(".pdf") ? (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-white/5 cursor-pointer" onClick={() => window.open(preview, '_blank')}>
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E53E3E" strokeWidth="1.5" className="mb-[2px]">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                              <polyline points="14 2 14 8 20 8"/>
                            </svg>
                            <span className="text-[9px] font-bold text-[#E53E3E]">PDF</span>
                          </div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={preview} alt={`תמונה ${idx + 1}`} className="w-full h-full object-cover cursor-pointer" onClick={() => window.open(preview, '_blank')} />
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemoveEditAttachment(idx)}
                          className="absolute top-[2px] left-[2px] bg-[#F64E60] text-white rounded-full w-[18px] h-[18px] flex items-center justify-center text-[12px] opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Add more button */}
                <label className="border border-[#4C526B] border-dashed rounded-[10px] h-[50px] flex items-center justify-center px-[10px] cursor-pointer hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-[10px]">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/50">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <span className="text-[14px] text-white/50">{editAttachmentPreviews.length > 0 ? "הוסף תמונה/מסמך נוסף" : "לחץ להעלאת תמונה/מסמך"}</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    multiple
                    onChange={handleEditFileChange}
                    className="hidden"
                  />
                </label>
                {isUploadingAttachment && (
                  <span className="text-[12px] text-white/50 text-center">מעלה קבצים...</span>
                )}
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">הערות למסמך</label>
                <div className="border border-[#4C526B] rounded-[10px] min-h-[100px]">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="הערות למסמך..."
                    className="w-full h-full min-h-[100px] bg-transparent text-white text-[16px] text-right rounded-[10px] border-none outline-none p-[10px] resize-none"
                  />
                </div>
              </div>

              {/* Submit and Cancel Buttons */}
              <div className="flex gap-[10px] mt-[10px] mb-[10px]">
                <button
                  type="button"
                  onClick={handleSaveEditedExpense}
                  disabled={isSaving || isUploadingAttachment}
                  className="flex-1 bg-[#29318A] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-[#3D44A0] disabled:opacity-50"
                >
                  {isSaving ? "שומר..." : isUploadingAttachment ? "מעלה קובץ..." : "שמור שינויים"}
                </button>
                <button
                  type="button"
                  onClick={handleCloseEditPopup}
                  className="flex-1 bg-transparent border border-[#4C526B] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-white/10"
                >
                  ביטול
                </button>
              </div>
            </div>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Modal */}
      <Sheet open={showDeleteConfirm} onOpenChange={(open) => !open && handleCancelDelete()}>
        <SheetContent
          side="bottom"
          className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>מחיקת הוצאה</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col items-center p-4">
            {/* Icon */}
            <div className="flex justify-center mb-[20px]">
              <div className="w-[60px] h-[60px] rounded-full bg-[#F64E60]/20 flex items-center justify-center">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#F64E60" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  <line x1="10" y1="11" x2="10" y2="17"/>
                  <line x1="14" y1="11" x2="14" y2="17"/>
                </svg>
              </div>
            </div>

            {/* Title */}
            <h3 className="text-[20px] font-bold text-white text-center mb-[10px]">מחיקת הוצאה</h3>

            {/* Message */}
            <p className="text-[16px] text-white/70 text-center mb-[25px]">
              האם אתה בטוח שברצונך למחוק את ההוצאה?
              <br />
              פעולה זו לא ניתנת לביטול.
            </p>

            {/* Buttons */}
            <div className="flex gap-[10px] w-full">
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 bg-[#F64E60] text-white text-[16px] font-semibold py-[12px] rounded-[10px] transition-colors hover:bg-[#D9414F] disabled:opacity-50"
              >
                {isDeleting ? "מוחק..." : "מחק"}
              </button>
              <button
                type="button"
                onClick={handleCancelDelete}
                className="flex-1 bg-transparent border border-[#4C526B] text-white text-[16px] font-semibold py-[12px] rounded-[10px] transition-colors hover:bg-white/10"
              >
                ביטול
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Payment Popup for existing invoice */}
      <Sheet open={showPaymentPopup && !!paymentInvoice} onOpenChange={(open) => !open && handleClosePaymentPopup()}>
        <SheetContent
          side="bottom"
          className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
          showCloseButton={false}
        >
          <SheetHeader className="border-b border-[#4C526B] pb-4">
            <div className="flex justify-between items-center" dir="ltr">
              <button
                type="button"
                onClick={handleClosePaymentPopup}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </button>
              <SheetTitle className="text-white text-xl font-bold">קליטת תשלום</SheetTitle>
              <div className="w-[24px]" />
            </div>
          </SheetHeader>

          {paymentInvoice && (
          <>
            {/* Invoice Info */}
            <div className="bg-white/5 rounded-[10px] p-[15px] mx-[5px] mb-[20px]">
              <div className="flex justify-between items-center mb-[10px]">
                <span className="text-[14px] text-white/70">ספק:</span>
                <span className="text-[14px] text-white font-medium">{paymentInvoice.supplier}</span>
              </div>
              <div className="flex justify-between items-center mb-[10px]">
                <span className="text-[14px] text-white/70">אסמכתא:</span>
                <span className="text-[14px] text-white font-medium ltr-num">{paymentInvoice.reference}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[14px] text-white/70">סכום לתשלום:</span>
                <span className="text-[16px] text-white font-bold ltr-num">₪{paymentInvoice.amountWithVat.toLocaleString()}</span>
              </div>
            </div>

            {/* Form */}
            <div className="flex flex-col gap-[15px] px-[5px]">
              {/* Payment Date */}
              <div className="flex flex-col gap-[3px]">
                <label className="text-[15px] font-medium text-white text-right">תאריך תשלום</label>
                <div className="relative border border-[#4C526B] rounded-[10px] h-[50px] px-[10px] flex items-center justify-center">
                  <span className={`text-[16px] font-semibold pointer-events-none ${paymentDate ? 'text-white' : 'text-white/40'}`}>
                    {paymentDate
                      ? new Date(paymentDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
                      : 'יום/חודש/שנה'}
                  </span>
                  <input
                    type="date"
                    title="תאריך תשלום"
                    value={paymentDate}
                    onChange={(e) => {
                      setPaymentDate(e.target.value);
                      // Recalculate all installment dates based on new date
                      setPopupPaymentMethods(prev => prev.map(p => {
                        const numInstallments = parseInt(p.installments) || 1;
                        const totalAmount = parseFloat(p.amount.replace(/[^\d.]/g, "")) || 0;
                        if (numInstallments > 1 && totalAmount > 0) {
                          return { ...p, customInstallments: generatePopupInstallments(numInstallments, totalAmount, e.target.value) };
                        }
                        return { ...p, customInstallments: [] };
                      }));
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                </div>
              </div>

              {/* Payment Methods Section */}
              <div className="flex flex-col gap-[15px]">
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-medium text-white">אמצעי תשלום</span>
                  <button
                    type="button"
                    onClick={addPopupPaymentMethodEntry}
                    className="bg-[#29318A] text-white text-[14px] font-medium px-[12px] py-[6px] rounded-[7px] hover:bg-[#3D44A0] transition-colors"
                  >
                    + הוסף אמצעי תשלום
                  </button>
                </div>

                {popupPaymentMethods.map((pm, pmIndex) => (
                  <div key={pm.id} className="border border-[#4C526B] rounded-[10px] p-[10px] flex flex-col gap-[10px]">
                    {/* Header with remove button */}
                    {popupPaymentMethods.length > 1 && (
                      <div className="flex items-center justify-between mb-[5px]">
                        <span className="text-[14px] text-white/70">אמצעי תשלום {pmIndex + 1}</span>
                        <button
                          type="button"
                          onClick={() => removePopupPaymentMethodEntry(pm.id)}
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
                        onChange={(e) => updatePopupPaymentMethodField(pm.id, "method", e.target.value)}
                        className="w-full h-[50px] bg-[#0F1535] text-[18px] text-white text-center focus:outline-none rounded-[10px] cursor-pointer select-dark"
                      >
                        <option value="" disabled>בחר אמצעי תשלום...</option>
                        {paymentMethodOptions.map((method) => (
                          <option key={method.value} value={method.value}>{method.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Check Number - only show when method is check */}
                    {pm.method === "check" && (
                      <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
                        <input
                          type="text"
                          inputMode="numeric"
                          title="מספר צ'ק"
                          value={pm.checkNumber}
                          onChange={(e) => updatePopupPaymentMethodField(pm.id, "checkNumber", e.target.value)}
                          placeholder="מספר צ'ק..."
                          className="w-full h-[50px] bg-transparent text-[18px] text-white text-center focus:outline-none px-[10px] rounded-[10px]"
                        />
                      </div>
                    )}

                    {/* Payment Amount */}
                    <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={pm.amount ? `₪${parseFloat(pm.amount.replace(/[^\d.]/g, "") || "0").toLocaleString("he-IL")}` : ""}
                        onChange={(e) => {
                          // Remove formatting and keep only numbers
                          const rawValue = e.target.value.replace(/[^\d.]/g, "");
                          updatePopupPaymentMethodField(pm.id, "amount", rawValue);
                        }}
                        placeholder="₪0 סכום"
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
                          onClick={() => updatePopupPaymentMethodField(pm.id, "installments", String(Math.max(1, parseInt(pm.installments) - 1)))}
                          className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
                        >
                          -
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          title="כמות תשלומים"
                          value={pm.installments}
                          onChange={(e) => updatePopupPaymentMethodField(pm.id, "installments", e.target.value.replace(/\D/g, "") || "1")}
                          className="flex-1 h-[50px] bg-transparent text-[18px] text-white text-center focus:outline-none"
                        />
                        <button
                          type="button"
                          title="הוסף תשלום"
                          onClick={() => updatePopupPaymentMethodField(pm.id, "installments", String(parseInt(pm.installments) + 1))}
                          className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
                        >
                          +
                        </button>
                      </div>

                      {/* Installments Breakdown */}
                      {pm.customInstallments.length > 0 && (
                        <div className="mt-[10px] border border-[#4C526B] rounded-[10px] p-[10px]">
                          <div className="flex items-center border-b border-[#4C526B] pb-[8px] mb-[8px]">
                            <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תשלום</span>
                            <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תאריך</span>
                            <span className="text-[14px] font-medium text-white/70 flex-1 text-center">סכום</span>
                          </div>
                          <div className="flex flex-col gap-[8px] max-h-[200px] overflow-y-auto">
                            {pm.customInstallments.map((item, index) => (
                              <div key={item.number} className="flex items-center gap-[8px]">
                                <span className="text-[14px] text-white ltr-num flex-1 text-center">{item.number}/{pm.installments}</span>
                                <input
                                  type="date"
                                  title={`תאריך תשלום ${item.number}`}
                                  value={item.dateForInput}
                                  onChange={(e) => handlePopupInstallmentDateChange(pm.id, index, e.target.value)}
                                  className="flex-1 h-[36px] bg-[#29318A]/30 border border-[#4C526B] rounded-[7px] text-[14px] text-white text-center focus:outline-none focus:border-white/50 px-[5px]"
                                />
                                <div className="flex-1 relative">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    title={`סכום תשלום ${item.number}`}
                                    value={item.amount.toFixed(2)}
                                    onChange={(e) => handlePopupInstallmentAmountChange(pm.id, index, e.target.value)}
                                    className="w-full h-[36px] bg-[#29318A]/30 border border-[#4C526B] rounded-[7px] text-[14px] text-white text-center focus:outline-none focus:border-white/50 px-[5px] ltr-num"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                          {(() => {
                            const installmentsTotal = getPopupInstallmentsTotal(pm.customInstallments);
                            const pmTotal = parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0;
                            const isMismatch = Math.abs(installmentsTotal - pmTotal) > 0.01;
                            return (
                              <div className="flex items-center border-t border-[#4C526B] pt-[8px] mt-[8px]">
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

              {/* Payment Reference */}
              <div className="flex flex-col gap-[3px]">
                <label className="text-[15px] font-medium text-white text-right">מספר אסמכתא</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <input
                    type="text"
                    title="מספר אסמכתא"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
                  />
                </div>
              </div>

              {/* Receipt Upload */}
              <div className="flex flex-col gap-[3px]">
                <label className="text-[15px] font-medium text-white text-right">קבלת תשלום</label>
                {paymentReceiptPreview ? (
                  <div className="border border-[#4C526B] rounded-[10px] p-[10px] flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => { setPaymentReceiptFile(null); setPaymentReceiptPreview(null); }}
                      className="text-[#F64E60] text-[14px] hover:underline"
                    >
                      הסר
                    </button>
                    <div className="flex items-center gap-[10px]">
                      <span className="text-[14px] text-white/70 truncate max-w-[150px]">
                        {paymentReceiptFile?.name || "קובץ"}
                      </span>
                      <button
                        type="button"
                        title="צפייה בקובץ"
                        onClick={() => window.open(paymentReceiptPreview, '_blank')}
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
                          setPaymentReceiptFile(file);
                          setPaymentReceiptPreview(URL.createObjectURL(file));
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                )}
                {isUploadingPaymentReceipt && (
                  <span className="text-[12px] text-white/50 text-center">מעלה קובץ...</span>
                )}
              </div>

              {/* Payment Notes */}
              <div className="flex flex-col gap-[3px]">
                <label className="text-[15px] font-medium text-white text-right">הערות לתשלום</label>
                <div className="border border-[#4C526B] rounded-[10px] min-h-[75px]">
                  <textarea
                    title="הערות לתשלום"
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    className="w-full h-full min-h-[75px] bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none p-[10px] resize-none"
                  />
                </div>
              </div>

              {/* Submit and Cancel Buttons */}
              <div className="flex gap-[10px] mt-[10px] mb-[10px]">
                <button
                  type="button"
                  onClick={handleSavePayment}
                  disabled={isSaving || isUploadingPaymentReceipt}
                  className="flex-1 bg-[#00E096] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-[#00C080] disabled:opacity-50"
                >
                  {isSaving ? "שומר..." : isUploadingPaymentReceipt ? "מעלה קובץ..." : "אשר תשלום"}
                </button>
                <button
                  type="button"
                  onClick={handleClosePaymentPopup}
                  className="flex-1 bg-transparent border border-[#4C526B] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-white/10"
                >
                  ביטול
                </button>
              </div>
            </div>
          </>
          )}
        </SheetContent>
      </Sheet>

      {/* Supplier Breakdown Popup */}
      <Sheet open={showSupplierBreakdownPopup} onOpenChange={(open) => !open && handleCloseSupplierBreakdown()}>
        <SheetContent
          side="bottom"
          className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[10px]"
          showCloseButton={false}
        >
          <SheetTitle className="sr-only">{breakdownSupplierName || "פירוט ספק"}</SheetTitle>
          <div className="flex flex-col gap-[15px] p-[10px_7px]">
            {/* Close Button */}
            <button
              type="button"
              onClick={handleCloseSupplierBreakdown}
              className="self-start text-white/50 hover:text-white transition-colors"
              title="סגור"
              aria-label="סגור"
            >
              <X className="w-[30px] h-[30px]" />
            </button>

            {/* Supplier Title */}
            <h2 className="text-[25px] font-semibold text-white text-center">{breakdownSupplierName}</h2>

            {/* Summary Row */}
            <div className="flex items-center justify-between mx-[10px] mb-[15px]">
              <div className="flex flex-col items-center">
                <span className="text-[20px] font-bold text-white">{breakdownSupplierCategory}</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[20px] font-bold text-white ltr-num">₪{breakdownSupplierTotalWithVat.toLocaleString()}</span>
                <span className="text-[14px] text-white/70">כולל מע&quot;מ</span>
              </div>
            </div>

            {/* Invoices Table */}
            <div className="flex flex-col">
              {/* Table Header */}
              <div className="flex items-center justify-between border-b border-white/25 pb-[8px] px-[5px]">
                <span className="text-[14px] font-medium text-white text-right" style={{ width: 81, maxWidth: 81 }}>תאריך</span>
                <span className="text-[14px] font-medium text-white text-center" style={{ width: 66, maxWidth: 66 }}>מספר חשבונית</span>
                <span className="text-[14px] font-medium text-white text-center" style={{ width: 65, maxWidth: 65 }}>סכום כולל מע&quot;מ</span>
                <span className="text-[14px] font-medium text-white text-center" style={{ width: 60, maxWidth: 60 }}>סטטוס</span>
                <span className="text-[14px] font-medium text-white text-center" style={{ width: 76, maxWidth: 76 }}>אפשרויות</span>
              </div>

              {/* Table Rows */}
              {isLoadingBreakdown ? (
                <div className="flex items-center justify-center py-[30px]">
                  <span className="text-[14px] text-white/50">טוען...</span>
                </div>
              ) : breakdownSupplierInvoices.length === 0 ? (
                <div className="flex items-center justify-center py-[30px]">
                  <span className="text-[14px] text-white/50">אין חשבוניות בתקופה הנבחרת</span>
                </div>
              ) : (
                breakdownSupplierInvoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between px-[5px] py-[10px] border-b border-white/5">
                    <span className="text-[14px] text-white text-right ltr-num" style={{ width: 81, maxWidth: 81 }}>{inv.date}</span>
                    <span className="text-[14px] text-white text-center ltr-num" style={{ width: 66, maxWidth: 66 }}>{inv.reference || "-"}</span>
                    <span className="text-[14px] text-white text-center ltr-num" style={{ width: 65, maxWidth: 65 }}>₪{inv.amountWithVat.toLocaleString()}</span>
                    <span className="text-[12px] text-center ltr-num" style={{ width: 60, maxWidth: 60 }}>
                      <span className={`px-[7px] py-[3px] rounded-full ${
                        inv.status === "שולם" ? "bg-[#00E096]/20 text-[#00E096]" :
                        inv.status === "בבירור" ? "bg-[#FFA500]/20 text-[#FFA500]" :
                        "bg-[#29318A] text-white"
                      }`}>
                        {inv.status}
                      </span>
                    </span>
                    <div className="flex items-center justify-center gap-[4px]" style={{ width: 76, maxWidth: 76 }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Delete invoice
                          handleDeleteClick(inv.id);
                        }}
                        className="w-[25px] h-[25px] flex items-center justify-center text-white/50 hover:text-white transition-colors"
                        title="מחק"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      {inv.attachmentUrls.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(inv.attachmentUrls[0], "_blank");
                          }}
                          className="w-[25px] h-[25px] flex items-center justify-center text-white/50 hover:text-white transition-colors"
                          title="צפה בקובץ"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                            <path d="M21 15L16 10L5 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Show All Invoices Button */}
            <button
              type="button"
              onClick={() => {
                handleCloseSupplierBreakdown();
                router.push("/suppliers");
              }}
              className="self-center bg-[#29318A] text-white text-[15px] font-semibold py-[12px] px-[20px] rounded-[5px] flex items-center justify-center gap-[8px] hover:bg-[#3D44A0] transition-colors mt-[20px]"
            >
              <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className="flex-shrink-0">
                <path d="M16 4V22M16 22L10 16M16 22L22 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M6 28H26" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span>הצגת כל החשבוניות</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Clarification Popup - when changing status to "בבירור" */}
      {showClarificationPopup && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50" onClick={() => setShowClarificationPopup(false)}>
          <div dir="rtl" className="bg-[#1A1F4E] rounded-[14px] border border-white/20 shadow-2xl p-[20px] w-[340px] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[16px] font-bold text-white text-center mb-[15px]">מסמך בבירור</h3>

            {/* Reason Selection */}
            {showStatusClarificationMenu ? (
              <div className="flex flex-col gap-[6px] mb-[15px]">
                <span className="text-[13px] text-white/60 text-right">בחר סיבת בירור:</span>
                {["הזמנה לא סופקה במלואה", "טעות במחיר", "תעודת משלוח", "אחר (פרט/י)"].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setStatusClarificationReason(option === "אחר (פרט/י)" ? "" : option);
                      setShowStatusClarificationMenu(false);
                    }}
                    className="text-[14px] text-white text-right py-[10px] px-[10px] hover:bg-[#29318A]/30 rounded-[7px] transition-colors border border-white/10"
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-[10px] mb-[15px]">
                {/* Reason textarea */}
                <div>
                  <div className="flex items-center justify-between mb-[5px]">
                    <span className="text-[13px] text-white/60">סיבת בירור:</span>
                    <button
                      type="button"
                      onClick={() => setShowStatusClarificationMenu(true)}
                      className="text-[12px] text-[#3F97FF] hover:underline"
                    >
                      שנה בחירה
                    </button>
                  </div>
                  <textarea
                    title="סיבת בירור"
                    value={statusClarificationReason}
                    onChange={(e) => setStatusClarificationReason(e.target.value)}
                    placeholder="פרט/י את הסיבה..."
                    rows={3}
                    className="w-full bg-[#0F1535] text-white text-[14px] text-right rounded-[8px] border border-[#4C526B] outline-none p-[10px] resize-none"
                  />
                </div>

                {/* Document Upload */}
                <div>
                  <span className="text-[13px] text-white/60 block mb-[5px]">צירוף מסמך (אופציונלי):</span>
                  {statusClarificationFilePreview ? (
                    <div className="flex items-center gap-[8px] bg-[#0F1535] border border-[#4C526B] rounded-[8px] p-[8px]">
                      {statusClarificationFile?.type.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={statusClarificationFilePreview} alt="תצוגה מקדימה" className="w-[50px] h-[50px] object-cover rounded-[6px]" />
                      ) : (
                        <div className="w-[50px] h-[50px] flex items-center justify-center bg-white/5 rounded-[6px]">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/50">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                          </svg>
                        </div>
                      )}
                      <span className="text-[12px] text-white/70 flex-1 truncate">{statusClarificationFile?.name}</span>
                      <button
                        type="button"
                        onClick={() => { setStatusClarificationFile(null); setStatusClarificationFilePreview(null); }}
                        className="text-[#F64E60] text-[18px] hover:text-[#ff7585]"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-[6px] bg-[#0F1535] border border-dashed border-[#4C526B] rounded-[8px] p-[12px] cursor-pointer hover:border-white/40 transition-colors">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/50">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                      <span className="text-[13px] text-white/50">העלאת תמונה/מסמך</span>
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setStatusClarificationFile(file);
                            if (file.type.startsWith("image/")) {
                              const reader = new FileReader();
                              reader.onloadend = () => setStatusClarificationFilePreview(reader.result as string);
                              reader.readAsDataURL(file);
                            } else {
                              setStatusClarificationFilePreview("pdf");
                            }
                          }
                        }}
                      />
                    </label>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-[10px] mt-[5px]">
                  <button
                    type="button"
                    onClick={handleSaveClarification}
                    disabled={isSavingClarification}
                    className="flex-1 bg-[#FFA500] hover:bg-[#e69500] disabled:opacity-50 text-[#0F1535] text-[14px] font-bold py-[10px] rounded-[8px] transition-colors flex items-center justify-center gap-[4px]"
                  >
                    {isSavingClarification ? (
                      <div className="w-4 h-4 border-2 border-[#0F1535]/30 border-t-[#0F1535] rounded-full animate-spin" />
                    ) : "העבר לבבירור"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowClarificationPopup(false)}
                    className="flex-1 bg-white/10 hover:bg-white/20 text-white text-[14px] py-[10px] rounded-[8px] transition-colors"
                  >
                    ביטול
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Status Change Confirmation Popup */}
      {statusConfirm && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50" onClick={() => setStatusConfirm(null)}>
          <div dir="rtl" className="bg-[#1A1F4E] rounded-[14px] border border-white/20 shadow-2xl p-[20px] w-[320px]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[16px] font-bold text-white text-center mb-[12px]">שינוי סטטוס</h3>
            <p className="text-[14px] text-white/80 text-center mb-[20px]">
              האם לשנות את הסטטוס ל<span className="font-bold text-white">&quot;{statusConfirm.label}&quot;</span>?
            </p>
            <div className="flex gap-[10px]">
              <button
                type="button"
                onClick={confirmStatusChange}
                disabled={isUpdatingStatus}
                className="flex-1 bg-[#3CD856] hover:bg-[#2db845] disabled:opacity-50 text-[#0F1535] text-[14px] font-bold py-[10px] rounded-[8px] transition-colors flex items-center justify-center gap-[4px]"
              >
                {isUpdatingStatus ? (
                  <div className="w-4 h-4 border-2 border-[#0F1535]/30 border-t-[#0F1535] rounded-full animate-spin" />
                ) : "אישור"}
              </button>
              <button
                type="button"
                onClick={() => setStatusConfirm(null)}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white text-[14px] py-[10px] rounded-[8px] transition-colors"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Status Menu Portal */}
      {showStatusMenu && typeof window !== 'undefined' && createPortal(
        <div
          ref={statusMenuRef}
          data-status-menu
          className="status-menu-portal bg-[#1A1F4E] border border-white/20 rounded-[8px] shadow-lg min-w-[120px] overflow-hidden"
        >
          <button
            type="button"
            onClick={() => handleStatusChange(showStatusMenu, 'pending')}
            disabled={isUpdatingStatus}
            className="w-full px-[12px] py-[8px] text-[13px] text-right hover:bg-white/10 transition-colors flex items-center gap-[8px] text-white"
          >
            <span className="w-[10px] h-[10px] rounded-full bg-[#29318A]"></span>
            <span>ממתין</span>
          </button>
          <button
            type="button"
            onClick={() => handleStatusChange(showStatusMenu, 'clarification')}
            disabled={isUpdatingStatus}
            className="w-full px-[12px] py-[8px] text-[13px] text-right hover:bg-white/10 transition-colors flex items-center gap-[8px] text-white"
          >
            <span className="w-[10px] h-[10px] rounded-full bg-[#FFA500]"></span>
            <span>בבירור</span>
          </button>
          <button
            type="button"
            onClick={() => handleStatusChange(showStatusMenu, 'paid')}
            disabled={isUpdatingStatus}
            className="w-full px-[12px] py-[8px] text-[13px] text-right hover:bg-white/10 transition-colors flex items-center gap-[8px] text-white"
          >
            <span className="w-[10px] h-[10px] rounded-full bg-[#00E096]"></span>
            <span>שולם</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
