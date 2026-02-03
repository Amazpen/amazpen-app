"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useDashboard } from "../layout";
import { createClient } from "@/lib/supabase/client";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { useToast } from "@/components/ui/toast";

// Supplier from database
interface Supplier {
  id: string;
  name: string;
  expense_category_id: string | null;
}

// Expense category from database
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

// Linked payment from database
interface LinkedPayment {
  id: string;
  payment_id: string;
  payment_method: string;
  amount: number;
  installments_count: number | null;
  check_date: string | null;
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
  suppliers: { id: string; name: string; amount: number; percentage: number }[];
}

export default function ExpensesPage() {
  const router = useRouter();
  const { selectedBusinesses } = useDashboard();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<"expenses" | "purchases">("expenses");
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    end: new Date(),
  });
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
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null); // For drill-down

  // Form state for new expense
  const [expenseDate, setExpenseDate] = useState("");
  const [expenseType, setExpenseType] = useState<"current" | "goods">("current");
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

  // File upload state for edit
  const [editAttachmentFile, setEditAttachmentFile] = useState<File | null>(null);
  const [editAttachmentPreview, setEditAttachmentPreview] = useState<string | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

  // Status change state
  const [showStatusMenu, setShowStatusMenu] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);

  // Payment popup for existing invoice (when changing status to "paid")
  const [showPaymentPopup, setShowPaymentPopup] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<InvoiceDisplay | null>(null);

  // Payment methods with installments - supports multiple payment methods (like payments page)
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
  const [popupPaymentMethods, setPopupPaymentMethods] = useState<PaymentMethodEntry[]>([
    { id: 1, method: "", amount: "", installments: "1", customInstallments: [] }
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
      { id: newId, method: "", amount: "", installments: "1", customInstallments: [] }
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

  // Calculate total for a payment method's installments in popup
  const getPopupInstallmentsTotal = (customInstallments: PaymentMethodEntry["customInstallments"]) => {
    return customInstallments.reduce((sum, item) => sum + item.amount, 0);
  };

  // Format date for display
  const formatDate = (date: Date) => {
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
          .select("id, name, expense_category_id")
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
            supplier:suppliers(id, name, expense_category_id),
            creator:profiles!invoices_created_by_fkey(full_name)
          `)
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .gte("invoice_date", startDate)
          .lte("invoice_date", endDate)
          .eq("invoice_type", activeTab === "expenses" ? "current" : "goods")
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
          const categoryTotals = new Map<string, { name: string; total: number; suppliers: Map<string, { name: string; total: number }> }>();

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
                  category.suppliers.set(supplierId, { name: supplierName, total: subtotal });
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
                  uncategorized.suppliers.set(supplierId, { name: supplierName, total: subtotal });
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

  // Close status menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showStatusMenu) {
        const target = e.target as HTMLElement;
        if (!target.closest('[data-status-menu]')) {
          setShowStatusMenu(null);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showStatusMenu]);

  // Calculate VAT and total
  const calculatedVat = partialVat ? parseFloat(vatAmount) || 0 : (parseFloat(amountBeforeVat) || 0) * 0.18;
  const totalWithVat = (parseFloat(amountBeforeVat) || 0) + calculatedVat;

  const totalExpenses = expensesData.reduce((sum: number, item: ExpenseSummary) => sum + item.amount, 0);
  const totalPercentage = expensesData.reduce((sum: number, item: ExpenseSummary) => sum + item.percentage, 0);

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

      // Create the invoice
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

      // If paid in full, create payment record
      if (isPaidInFull && newInvoice) {
        const { error: paymentError } = await supabase
          .from("payments")
          .insert({
            business_id: selectedBusinesses[0],
            supplier_id: selectedSupplier,
            payment_date: paymentDate || expenseDate,
            total_amount: totalWithVat,
            invoice_id: newInvoice.id,
            notes: paymentNotes || null,
            created_by: user?.id || null,
          })
          .select()
          .single();

        if (paymentError) throw paymentError;

        // Create payment split for the payment method
        const { data: paymentData } = await supabase
          .from("payments")
          .select("id")
          .eq("invoice_id", newInvoice.id)
          .single();

        if (paymentData) {
          await supabase
            .from("payment_splits")
            .insert({
              payment_id: paymentData.id,
              payment_method: paymentMethod || "other",
              amount: totalWithVat,
              installments_count: paymentInstallments,
              reference_number: paymentReference || null,
            });
        }
      }

      // Refresh data
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
    setExpenseDate("");
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
    // Set existing attachment preview
    setEditAttachmentPreview(invoice.attachmentUrl);
    setEditAttachmentFile(null);
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

      let attachmentUrl = editingInvoice.attachmentUrl;

      // Upload new attachment if selected
      if (editAttachmentFile) {
        setIsUploadingAttachment(true);
        const fileExt = editAttachmentFile.name.split('.').pop();
        const fileName = `${editingInvoice.id}-${Date.now()}.${fileExt}`;
        const filePath = `invoices/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('attachments')
          .upload(filePath, editAttachmentFile);

        if (uploadError) {
          console.error("Upload error:", uploadError);
          showToast("שגיאה בהעלאת הקובץ", "error");
        } else {
          const { data: urlData } = supabase.storage
            .from('attachments')
            .getPublicUrl(filePath);
          attachmentUrl = urlData.publicUrl;
        }
        setIsUploadingAttachment(false);
      } else if (editAttachmentPreview === null && editingInvoice.attachmentUrl) {
        // Attachment was removed
        attachmentUrl = null;
      }

      const { error } = await supabase
        .from("invoices")
        .update({
          supplier_id: selectedSupplier,
          invoice_number: invoiceNumber || null,
          invoice_date: expenseDate,
          subtotal: parseFloat(amountBeforeVat),
          vat_amount: calculatedVatEdit,
          total_amount: totalWithVatEdit,
          notes: notes || null,
          invoice_type: expenseType,
          attachment_url: attachmentUrl,
        })
        .eq("id", editingInvoice.id);

      if (error) throw error;

      showToast("ההוצאה עודכנה בהצלחה", "success");
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
    setExpenseDate("");
    setExpenseType("current");
    setSelectedSupplier("");
    setInvoiceNumber("");
    setAmountBeforeVat("");
    setPartialVat(false);
    setVatAmount("");
    setNotes("");
    // Reset attachment
    setEditAttachmentFile(null);
    setEditAttachmentPreview(null);
  };

  // Handle file selection for edit
  const handleEditFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setEditAttachmentFile(file);
      // Create preview URL
      const previewUrl = URL.createObjectURL(file);
      setEditAttachmentPreview(previewUrl);
    }
  };

  // Handle removing attachment in edit
  const handleRemoveEditAttachment = () => {
    setEditAttachmentFile(null);
    setEditAttachmentPreview(null);
  };

  // Handle status change
  const handleStatusChange = async (invoiceId: string, newStatus: string) => {
    // If changing to "paid", open payment popup instead of directly updating
    if (newStatus === 'paid') {
      const invoice = recentInvoices.find(inv => inv.id === invoiceId);
      if (invoice) {
        setPaymentInvoice(invoice);
        // Pre-fill payment form with invoice data
        const today = new Date().toISOString().split('T')[0];
        setPaymentDate(today);
        setPaymentReference("");
        setPaymentNotes("");
        // Initialize with single payment method entry with the invoice amount
        setPopupPaymentMethods([{
          id: 1,
          method: "",
          amount: invoice.amountWithVat.toString(),
          installments: "1",
          customInstallments: []
        }]);
        setShowPaymentPopup(true);
        setShowStatusMenu(null);
      }
      return;
    }

    setIsUpdatingStatus(true);
    const supabase = createClient();

    try {
      const { error } = await supabase
        .from("invoices")
        .update({ status: newStatus })
        .eq("id", invoiceId);

      if (error) throw error;

      const statusLabels: Record<string, string> = {
        pending: "ממתין",
        clarification: "בבירור",
        paid: "שולם"
      };

      showToast(`הסטטוס עודכן ל"${statusLabels[newStatus]}"`, "success");
      setShowStatusMenu(null);
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      console.error("Error updating status:", error);
      showToast("שגיאה בעדכון הסטטוס", "error");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Handle saving payment for existing invoice
  const handleSavePayment = async () => {
    if (!paymentInvoice || popupPaymentMethods.every(pm => !pm.amount || !pm.method)) {
      showToast("נא למלא את כל השדות הנדרשים", "warning");
      return;
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
    setPopupPaymentMethods([{ id: 1, method: "", amount: "", installments: "1", customInstallments: [] }]);
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
      {/* Tabs - RTL: קניות סחורה בימין, הוצאות שוטפות בשמאל */}
      <div className="flex w-full h-[50px] mb-[34px] border border-[#6B6B6B] rounded-[7px] overflow-hidden">
        <button
          type="button"
          onClick={() => setActiveTab("purchases")}
          className={`flex-1 flex items-center justify-center transition-colors duration-200 ${
            activeTab === "purchases"
              ? "bg-[#29318A] text-white"
              : "text-[#979797]"
          }`}
        >
          <span className="text-[20px] font-semibold">קניות סחורה</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("expenses")}
          className={`flex-1 flex items-center justify-center transition-colors duration-200 ${
            activeTab === "expenses"
              ? "bg-[#29318A] text-white"
              : "text-[#979797]"
          }`}
        >
          <span className="text-[20px] font-semibold">הוצאות שוטפות</span>
        </button>
      </div>

      {/* Date Range and Add Button */}
      <div className="flex items-center justify-between mb-[10px]">
        <button
          type="button"
          onClick={() => setShowAddExpensePopup(true)}
          className="bg-[#29318A] text-white text-[16px] font-semibold px-[20px] py-[10px] rounded-[7px] transition-colors hover:bg-[#3D44A0]"
        >
          הזנת הוצאה
        </button>
        <DateRangePicker dateRange={dateRange} onChange={setDateRange} />
      </div>

      {/* Chart and Summary Section */}
      <div className="bg-[#0F1535] rounded-[20px] pb-[10px] mt-[10px]">
        {/* Donut Chart Area */}
        <div className="relative h-[350px] flex items-center justify-center mt-[17px]">
          {expensesData.length === 0 ? (
            /* Empty State - No Data */
            <div className="flex flex-col items-center justify-center gap-[15px]">
              <svg width="80" height="80" viewBox="0 0 100 100" className="text-white/20">
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
                {/* Dynamic segments based on expensesData */}
                {(() => {
                  let offset = 0;
                  return expensesData.map((expense, index) => {
                    const segment = (
                      <circle
                        key={expense.id}
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke={chartColors[index % chartColors.length]}
                        strokeWidth="15"
                        strokeDasharray={`${expense.percentage} ${100 - expense.percentage}`}
                        strokeDashoffset={-offset}
                        transform="rotate(-90 50 50)"
                      />
                    );
                    offset += expense.percentage;
                    return segment;
                  });
                })()}
              </svg>
              {/* Center text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[18px] font-bold">סה''כ הוצאות</span>
                <span className="text-[35px] font-bold ltr-num">₪{totalExpenses.toLocaleString()}</span>
                <span className="text-[18px] font-bold ltr-num">{totalPercentage.toFixed(2)}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Expenses Detail Table */}
        <div className="max-w-[400px] mx-auto">
          <h2 className="text-[24px] font-bold text-center mb-[20px]">פירוט הוצאות</h2>

          {/* Table Header */}
          <div className="flex items-center border-b border-white/20 p-[5px]">
            <span className="text-[16px] flex-1 text-center">
              {activeTab === "expenses" ? "קטגוריית ספק" : "שם ספק"}
            </span>
            <span className="text-[16px] flex-1 text-center">סכום לפני מע"מ</span>
            <span className="text-[16px] flex-1 text-center">(%) מפדיון</span>
          </div>

          {/* Table Rows */}
          <div className="flex flex-col">
            {activeTab === "expenses" ? (
              /* הוצאות שוטפות - לפי קטגוריה עם drill-down */
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
                      onClick={() => setExpandedCategoryId(expandedCategoryId === cat.id ? null : cat.id)}
                      className={`flex items-center p-[5px] min-h-[50px] hover:bg-[#29318A]/30 transition-colors rounded-[7px] w-full ${
                        index > 0 ? 'border-t border-white/10' : ''
                      }`}
                    >
                      <div className="flex items-center justify-center gap-[5px] flex-1">
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 32 32"
                          fill="none"
                          className={`flex-shrink-0 transition-transform ${expandedCategoryId === cat.id ? '-rotate-90' : ''}`}
                        >
                          <path d="M20 10L14 16L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span className="text-[16px] text-center">{cat.category}</span>
                      </div>
                      <span className="text-[16px] flex-1 text-center ltr-num">₪{cat.amount.toLocaleString()}</span>
                      <span className="text-[16px] flex-1 text-center ltr-num">{cat.percentage.toFixed(1)}%</span>
                    </button>

                    {/* Drill-down: Suppliers in this category */}
                    {expandedCategoryId === cat.id && cat.suppliers.length > 0 && (
                      <div className="bg-white/5 rounded-[7px] mx-[10px] mb-[5px]">
                        {cat.suppliers.map((supplier, supIndex) => (
                          <div
                            key={supplier.id}
                            className={`flex items-center p-[4px_5px] ${
                              supIndex > 0 ? 'border-t border-white/10' : ''
                            }`}
                          >
                            <span className="text-[14px] text-white/80 flex-1 text-center">{supplier.name}</span>
                            <span className="text-[14px] text-white/80 flex-1 text-center ltr-num">₪{supplier.amount.toLocaleString()}</span>
                            <span className="text-[14px] text-white/80 flex-1 text-center ltr-num">{supplier.percentage.toFixed(1)}%</span>
                          </div>
                        ))}
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
                  <div
                    key={supplier.id}
                    className={`flex items-center p-[5px] min-h-[50px] ${
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
                  </div>
                ))
              )
            )}
          </div>
        </div>

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

      {/* Recent Invoices Section - חשבוניות אחרונות שהוזנו */}
      <div className="bg-[#0F1535] rounded-[20px] p-[15px_0px] mt-[10px] flex flex-col gap-[15px] w-full">
        {/* Header Row - RTL: פילטר בימין, כותרת באמצע, הורדה בשמאל */}
        <div className="flex items-center justify-between">
          {/* Filter Dropdown - Right side */}
          <div className="relative opacity-50">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white">
              <path d="M8.07136 12.6325C4.96261 10.3075 2.74511 7.75 1.53386 6.3125C1.15886 5.8675 1.03636 5.54125 0.962611 4.9675C0.710111 3.0025 0.583861 2.02 1.16011 1.385C1.73636 0.75 2.75511 0.75 4.79261 0.75H19.2076C21.2451 0.75 22.2639 0.75 22.8401 1.38375C23.4164 2.01875 23.2901 3.00125 23.0376 4.96625C22.9626 5.54 22.8401 5.86625 22.4664 6.31125C21.2539 7.75125 19.0326 10.3137 15.9164 12.6425C15.7723 12.7546 15.6531 12.8956 15.5666 13.0564C15.4801 13.2172 15.4281 13.3942 15.4139 13.5762C15.1051 16.99 14.8201 18.86 14.6426 19.805C14.3564 21.3325 12.1926 22.2513 11.0326 23.07C10.3426 23.5575 9.50511 22.9775 9.41636 22.2225C9.08445 19.3456 8.80357 16.4631 8.57386 13.5762C8.56102 13.3925 8.50964 13.2135 8.42307 13.0509C8.33649 12.8883 8.21666 12.7457 8.07136 12.6325Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <select
              title="סינון לפי"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            >
              <option value="">בחר...</option>
              <option value="date">תאריך חשבונית</option>
              <option value="supplier">ספק</option>
              <option value="reference">מספר תעודה</option>
              <option value="amount">סכום לפני מע"מ</option>
              <option value="notes">הערות</option>
              <option value="fixed">הוצאות קבועות</option>
            </select>
          </div>

          {/* Title - Center */}
          <h2 className="text-[18px] font-bold text-center">חשבוניות אחרונות שהוזנו</h2>

          {/* Download Button - Left side */}
          <button
            type="button"
            className="flex flex-col items-center gap-[5px] cursor-pointer"
          >
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none" className="text-white">
              <path d="M16 4V22M16 22L10 16M16 22L22 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6 28H26" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="text-[12px] text-white text-center">הורדת חשבוניות</span>
          </button>
        </div>

        {/* Table */}
        <div className="w-full flex flex-col gap-[5px]">
          {/* Table Header */}
          <div className="grid grid-cols-[0.8fr_1.2fr_1.2fr_0.9fr_0.9fr] bg-white/5 rounded-t-[7px] p-[10px_5px] items-center">
            <span className="text-[13px] font-medium text-center">תאריך</span>
            <span className="text-[13px] font-medium text-center">ספק</span>
            <span className="text-[13px] font-medium text-center">אסמכתא</span>
            <span className="text-[13px] font-medium text-center">סכום</span>
            <span className="text-[13px] font-medium text-center">סטטוס</span>
          </div>

          {/* Table Rows */}
          <div className="max-h-[450px] overflow-y-auto flex flex-col gap-[5px]">
            {recentInvoices.length === 0 ? (
              <div className="flex items-center justify-center py-[40px]">
                <span className="text-[16px] text-white/50">אין חשבוניות להצגה</span>
              </div>
            ) : recentInvoices.map((invoice) => (
              <div
                key={invoice.id}
                className={`bg-white/5 rounded-[7px] p-[7px_3px] border transition-colors ${
                  expandedInvoiceId === invoice.id ? 'border-white' : 'border-transparent'
                }`}
              >
                {/* Main Row */}
                <div className="grid grid-cols-[0.8fr_1.2fr_1.2fr_0.9fr_0.9fr] w-full p-[5px_5px] hover:bg-[#29318A]/30 transition-colors rounded-[7px] items-center">
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
                      className={`text-white/50 flex-shrink-0 transition-transform ${expandedInvoiceId === invoice.id ? 'rotate-90' : ''}`}
                    >
                      <path d="M20 10L14 16L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="text-[12px] ltr-num">{invoice.date}</span>
                  </button>
                  {/* Supplier - Clickable */}
                  <button
                    type="button"
                    onClick={() => setExpandedInvoiceId(expandedInvoiceId === invoice.id ? null : invoice.id)}
                    className="text-[12px] text-center leading-tight cursor-pointer truncate px-[2px]"
                  >
                    {invoice.supplier}
                  </button>
                  {/* Reference - Clickable */}
                  <button
                    type="button"
                    onClick={() => setExpandedInvoiceId(expandedInvoiceId === invoice.id ? null : invoice.id)}
                    className="text-[12px] text-center ltr-num cursor-pointer truncate px-[2px]"
                  >
                    {invoice.reference}
                  </button>
                  {/* Amount - Clickable */}
                  <button
                    type="button"
                    onClick={() => setExpandedInvoiceId(expandedInvoiceId === invoice.id ? null : invoice.id)}
                    className="text-[12px] text-center ltr-num font-medium cursor-pointer"
                  >
                    ₪{invoice.amountBeforeVat.toLocaleString()}
                  </button>
                  {/* Status - Clickable with dropdown */}
                  <div className="flex justify-center" data-status-menu>
                    <button
                      type="button"
                      onClick={(e) => {
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
                      className={`text-[12px] font-bold px-[12px] py-[6px] rounded-full cursor-pointer hover:opacity-80 transition-opacity ${
                        invoice.status === 'שולם' ? 'bg-[#00E096]' :
                        invoice.status === 'בבירור' ? 'bg-[#FFA500]' : 'bg-[#29318A]'
                      }`}
                    >
                      {invoice.status}
                    </button>
                  </div>
                </div>

                {/* Expanded Content */}
                {expandedInvoiceId === invoice.id && (
                  <div className="flex flex-col gap-[20px] p-[5px] mt-[10px]">
                    {/* Notes Section */}
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

                    {/* Additional Details Section */}
                    <div className="border border-white/50 rounded-[7px] p-[3px] flex flex-col gap-[15px]">
                      {/* Header with title and action icons */}
                      <div className="flex items-center justify-between border-b border-white/35 pb-[10px]">
                        <span className="text-[16px] font-medium text-white ml-[7px]">פרטים נוספים</span>
                        <div className="flex items-center gap-[6px]">
                          {/* Image/View Icon - only show if has attachment */}
                          {invoice.attachmentUrl && (
                            <button
                              type="button"
                              title="צפייה בתמונה"
                              onClick={() => window.open(invoice.attachmentUrl!, '_blank')}
                              className="w-[18px] h-[18px] text-white/70 hover:text-white transition-colors"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <circle cx="8.5" cy="8.5" r="1.5"/>
                                <polyline points="21 15 16 10 5 21"/>
                              </svg>
                            </button>
                          )}
                          {/* Download Icon - only show if has attachment */}
                          {invoice.attachmentUrl && (
                            <a
                              href={invoice.attachmentUrl}
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

                      {/* Details Grid */}
                      <div className="flex flex-row-reverse items-center justify-between px-[7px]">
                        <div className="flex flex-col items-center">
                          <span className="text-[14px] text-[#979797]">סכום כולל מע"מ</span>
                          <span className="text-[14px] text-white ltr-num">₪{invoice.amountWithVat.toLocaleString()}</span>
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="text-[14px] text-[#979797]">סכום לפני מע"מ</span>
                          <span className="text-[14px] text-white ltr-num">₪{invoice.amountBeforeVat.toLocaleString()}</span>
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="text-[14px] text-[#979797]">הוזן ע"י</span>
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
            ))}
          </div>
        </div>
      </div>

      {/* Add Expense Popup */}
      {showAddExpensePopup && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/50 z-[2001]"
            onClick={handleClosePopup}
          />

          {/* Popup */}
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-20px)] max-w-[400px] max-h-[90vh] overflow-y-auto bg-[#0F1535] rounded-[10px] p-[25px_5px_5px] z-[2002]">
            {/* Header */}
            <div className="flex items-center justify-between mb-[20px] px-[10px]">
              <button
                type="button"
                title="סגור"
                onClick={handleClosePopup}
                className="w-[30px] h-[30px] flex items-center justify-center text-white"
              >
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                  <path d="M24 8L8 24M8 8l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
              <h2 className="text-[22px] font-bold text-white text-center flex-1">הוספת הוצאה חדשה</h2>
            </div>

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
                </div>
              </div>

              {/* Supplier Select */}
              <div className="flex flex-col gap-[3px]">
                <label className="text-[15px] font-medium text-white text-right">שם ספק</label>
                <div className="border border-[#4C526B] rounded-[10px]">
                  <select
                    title="בחר ספק"
                    value={selectedSupplier}
                    onChange={(e) => setSelectedSupplier(e.target.value)}
                    className="w-full h-[48px] bg-[#0F1535] text-white/40 text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
                  >
                    <option value="" className="bg-[#0F1535] text-white/40">בחר/י ספק...</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id} className="bg-[#0F1535] text-white">
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

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
                <label className="text-[15px] font-medium text-white text-right">סכום לפני מע''מ</label>
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
                  <label className="text-[15px] font-medium text-white text-right">מע"מ</label>
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
                  <span className="text-[15px] font-medium text-white">הזנת סכום מע"מ חלקי</span>
                </div>
              </div>

              {/* Total with VAT */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">סכום כולל מע"מ</label>
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

              {/* Image Upload */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[16px] font-medium text-white text-right">הוספת תמונה</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center px-[10px]">
                  <span className="text-[14px] text-white/40">הוסף תמונה/מסמך</span>
                </div>
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
                  onClick={() => setIsPaidInFull(!isPaidInFull)}
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
                    <h3 className="text-[18px] font-semibold text-white text-center mb-[40px]">הוספת הוצאה - קליטת תשלום</h3>

                    <div className="flex flex-col gap-[15px]">
                      {/* Payment Method */}
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[15px] font-medium text-white text-right">אמצעי תשלום</label>
                        <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                          <select
                            title="אמצעי תשלום"
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value)}
                            className="w-full h-full bg-transparent text-white/40 text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
                          >
                            <option value="" className="bg-[#0F1535] text-white/40"></option>
                            <option value="bank_transfer" className="bg-[#0F1535] text-white">העברה בנקאית</option>
                            <option value="cash" className="bg-[#0F1535] text-white">מזומן</option>
                            <option value="check" className="bg-[#0F1535] text-white">צ'ק</option>
                            <option value="bit" className="bg-[#0F1535] text-white">ביט</option>
                            <option value="paybox" className="bg-[#0F1535] text-white">פייבוקס</option>
                            <option value="credit_card" className="bg-[#0F1535] text-white">כרטיס אשראי</option>
                            <option value="other" className="bg-[#0F1535] text-white">אחר</option>
                            <option value="credit_companies" className="bg-[#0F1535] text-white">חברות הקפה</option>
                            <option value="standing_order" className="bg-[#0F1535] text-white">הוראת קבע</option>
                          </select>
                        </div>
                      </div>

                      {/* Payment Date */}
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[15px] font-medium text-white text-right">מתי יורד התשלום?</label>
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
                            onChange={(e) => setPaymentDate(e.target.value)}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                          />
                        </div>
                      </div>

                      {/* Number of Installments */}
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[15px] font-medium text-white text-right">כמות תשלומים שווים</label>
                        <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center gap-[30px] px-[10px]">
                          <button
                            type="button"
                            title="הוסף תשלום"
                            onClick={() => setPaymentInstallments(prev => prev + 1)}
                            className="text-white"
                          >
                            <svg width="27" height="27" viewBox="0 0 32 32" fill="none">
                              <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2"/>
                              <path d="M16 10V22M10 16H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                          </button>
                          <span className="text-[20px] text-white">{paymentInstallments}</span>
                          <button
                            type="button"
                            title="הפחת תשלום"
                            onClick={() => setPaymentInstallments(prev => Math.max(1, prev - 1))}
                            className="text-white"
                          >
                            <svg width="27" height="27" viewBox="0 0 32 32" fill="none">
                              <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2"/>
                              <path d="M10 16H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Payment Amount per Installment */}
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[15px] font-medium text-white text-right">סכום לתשלום</label>
                        <div className="flex gap-[5px]">
                          <div className="flex-1 border border-[#4C526B] rounded-[10px] h-[50px]">
                            <input
                              type="text"
                              title="סכום לתשלום"
                              disabled
                              value={paymentInstallments > 0 ? (totalWithVat / paymentInstallments).toFixed(2) : '0.00'}
                              className="w-full h-full bg-transparent text-white text-[14px] font-bold text-center rounded-[10px] border-none outline-none"
                            />
                          </div>
                          <div className="flex-1 border border-[#4C526B] rounded-[10px] h-[50px]">
                            <input
                              type="text"
                              title="סכום כולל"
                              disabled
                              value={totalWithVat.toFixed(2)}
                              className="w-full h-full bg-transparent text-white text-[14px] font-bold text-center rounded-[10px] border-none outline-none"
                            />
                          </div>
                        </div>
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
          </div>
        </>
      )}

      {/* Edit Expense Popup */}
      {showEditPopup && editingInvoice && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/50 z-[2001]"
            onClick={handleCloseEditPopup}
          />

          {/* Popup */}
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-20px)] max-w-[400px] max-h-[90vh] overflow-y-auto bg-[#0F1535] rounded-[10px] p-[25px_5px_5px] z-[2002]">
            {/* Header */}
            <div className="flex items-center justify-between mb-[20px] px-[10px]">
              <button
                type="button"
                title="סגור"
                onClick={handleCloseEditPopup}
                className="w-[30px] h-[30px] flex items-center justify-center text-white"
              >
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                  <path d="M24 8L8 24M8 8l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
              <h2 className="text-[22px] font-bold text-white text-center flex-1">עריכת הוצאה</h2>
            </div>

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
              <div className="flex flex-col gap-[3px]">
                <label className="text-[15px] font-medium text-white text-right">שם ספק</label>
                <div className="border border-[#4C526B] rounded-[10px]">
                  <select
                    title="בחר ספק"
                    value={selectedSupplier}
                    onChange={(e) => setSelectedSupplier(e.target.value)}
                    className="w-full h-[48px] bg-[#0F1535] text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
                  >
                    <option value="" className="bg-[#0F1535] text-white/40">בחר/י ספק...</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id} className="bg-[#0F1535] text-white">
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

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
                <label className="text-[15px] font-medium text-white text-right">סכום לפני מע''מ</label>
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

              {/* Image Upload */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[16px] font-medium text-white text-right">תמונה/מסמך</label>
                {editAttachmentPreview ? (
                  <div className="border border-[#4C526B] rounded-[10px] p-[10px] flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleRemoveEditAttachment}
                      className="text-[#F64E60] text-[14px] hover:underline"
                    >
                      הסר
                    </button>
                    <div className="flex items-center gap-[10px]">
                      <span className="text-[14px] text-white/70 truncate max-w-[150px]">
                        {editAttachmentFile?.name || "קובץ קיים"}
                      </span>
                      <button
                        type="button"
                        title="צפייה בקובץ"
                        onClick={() => window.open(editAttachmentPreview, '_blank')}
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
                      onChange={handleEditFileChange}
                      className="hidden"
                    />
                  </label>
                )}
                {isUploadingAttachment && (
                  <span className="text-[12px] text-white/50 text-center">מעלה קובץ...</span>
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
          </div>
        </>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/50 z-[2001]"
            onClick={handleCancelDelete}
          />

          {/* Modal */}
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-40px)] max-w-[350px] bg-[#0F1535] rounded-[15px] p-[25px] z-[2002]">
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
            <div className="flex gap-[10px]">
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
        </>
      )}

      {/* Payment Popup for existing invoice */}
      {showPaymentPopup && paymentInvoice && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/50 z-[2001]"
            onClick={handleClosePaymentPopup}
          />

          {/* Popup */}
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-20px)] max-w-[400px] max-h-[90vh] overflow-y-auto bg-[#0F1535] rounded-[10px] p-[25px_5px_5px] z-[2002]">
            {/* Header */}
            <div className="flex items-center justify-between mb-[20px] px-[10px]">
              <button
                type="button"
                title="סגור"
                onClick={handleClosePaymentPopup}
                className="w-[30px] h-[30px] flex items-center justify-center text-white"
              >
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                  <path d="M24 8L8 24M8 8l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
              <h2 className="text-[22px] font-bold text-white text-center flex-1">קליטת תשלום</h2>
            </div>

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
                                <span className="text-[14px] text-white ltr-num w-[50px] text-center flex-shrink-0">{item.number}/{pm.installments}</span>
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
                          <div className="flex items-center border-t border-[#4C526B] pt-[8px] mt-[8px]">
                            <span className="text-[14px] font-bold text-white w-[50px] text-center flex-shrink-0">סה"כ</span>
                            <span className="flex-1"></span>
                            <span className="text-[14px] font-bold text-white ltr-num flex-1 text-center">
                              ₪{getPopupInstallmentsTotal(pm.customInstallments).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
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
                  disabled={isSaving}
                  className="flex-1 bg-[#00E096] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-[#00C080] disabled:opacity-50"
                >
                  {isSaving ? "שומר..." : "אשר תשלום"}
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
          </div>
        </>
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
