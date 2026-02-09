"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { X } from "lucide-react";
import { useDashboard } from "../layout";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { useToast } from "@/components/ui/toast";
import { uploadFile } from "@/lib/uploadFile";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useFormDraft } from "@/hooks/useFormDraft";

// Category type from database
interface ExpenseCategory {
  id: string;
  business_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  display_order: number | null;
  is_active: boolean;
}

// Supplier type from database
interface Supplier {
  id: string;
  business_id: string;
  name: string;
  expense_type: string;
  expense_category_id?: string;
  expense_nature?: string;
  payment_terms_days?: number;
  vat_type?: string;
  is_fixed_expense?: boolean;
  charge_day?: number;
  monthly_expense_amount?: number;
  default_payment_method?: string;
  notes?: string;
  document_url?: string;
  has_previous_obligations?: boolean;
  waiting_for_coordinator?: boolean;
  is_active?: boolean;
  // Obligation fields (for previous obligations / loans)
  obligation_total_amount?: number;
  obligation_monthly_amount?: number;
  obligation_num_payments?: number;
  obligation_first_charge_date?: string;
  obligation_terms?: string;
  obligation_document_url?: string;
}

// Supplier with balance info for display
interface SupplierWithBalance extends Supplier {
  remainingPayment: number;
  revenuePercentage: number;
}

type TabType = "previous" | "current" | "purchases" | "employees";

export default function SuppliersPage() {
  const { selectedBusinesses } = useDashboard();
  const { showToast } = useToast();

  // Draft persistence for add/edit supplier form
  const supplierDraftKey = `supplierForm:draft:${selectedBusinesses[0] || "none"}`;
  const { saveDraft: saveSupplierDraft, restoreDraft: restoreSupplierDraft, clearDraft: clearSupplierDraft } = useFormDraft(supplierDraftKey);
  const supplierDraftRestored = useRef(false);

  const [activeTab, setActiveTab] = usePersistedState<TabType>("suppliers:tab", "current");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Realtime subscription
  const handleRealtimeChange = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  useMultiTableRealtime(
    ["suppliers", "invoices", "payments"],
    handleRealtimeChange,
    selectedBusinesses.length > 0
  );

  // Suppliers data from database
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Categories from database
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [parentCategories, setParentCategories] = useState<ExpenseCategory[]>([]);

  // Supplier detail popup state
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierWithBalance | null>(null);
  const [showSupplierDetailPopup, setShowSupplierDetailPopup] = useState(false);
  const [supplierDetailData, setSupplierDetailData] = useState<{
    totalPurchases: number;
    totalPaid: number;
    remainingBalance: number;
    monthlyData: {
      expectedPaymentDate: string | null;
      monthlyPurchases: number;
      monthlyPaid: number;
      amountToPay: number;
    };
  } | null>(null);
  const [detailDateRange, setDetailDateRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    end: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
  });
  const [detailActiveTab, setDetailActiveTab] = useState<"invoices" | "payments">("invoices");
  const [supplierInvoices, setSupplierInvoices] = useState<Array<{
    id: string;
    date: string;
    reference: string;
    amount: number;
    status: string;
  }>>([]);
  const [supplierPayments, setSupplierPayments] = useState<Array<{
    id: string;
    date: string;
    method: string;
    amount: number;
    reference: string;
  }>>([]);

  // Obligation detail popup state
  const [showObligationDetailPopup, setShowObligationDetailPopup] = useState(false);
  const [obligationPayments, setObligationPayments] = useState<Array<{
    id: string;
    date: string;
    amount: number;
  }>>([]);
  const [isUploadingObligationDoc, setIsUploadingObligationDoc] = useState(false);

  // Edit supplier state
  const [isEditingSupplier, setIsEditingSupplier] = useState(false);
  const [editingSupplierData, setEditingSupplierData] = useState<SupplierWithBalance | null>(null);

  // Add supplier form state
  const [supplierName, setSupplierName] = useState("");
  const [hasPreviousObligations, setHasPreviousObligations] = useState(false);
  const [waitingForCoordinator, setWaitingForCoordinator] = useState(false);

  // Previous obligations fields (shown when hasPreviousObligations is true)
  const [obligationTotalAmount, setObligationTotalAmount] = useState("");
  const [obligationTerms, setObligationTerms] = useState("");
  const [obligationFirstChargeDate, setObligationFirstChargeDate] = useState("");
  const [obligationNumPayments, setObligationNumPayments] = useState("");
  const [obligationMonthlyAmount, setObligationMonthlyAmount] = useState("");
  const [obligationDocument, setObligationDocument] = useState<File | null>(null);
  const [expenseType, setExpenseType] = useState<"current" | "goods" | "employees">("current");
  const [category, setCategory] = useState("");
  const [parentCategory, setParentCategory] = useState("");
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [isAddingParentCategory, setIsAddingParentCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newParentCategoryName, setNewParentCategoryName] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [vatRequired, setVatRequired] = useState<"yes" | "no" | "partial">("yes");
  const [isFixedExpense, setIsFixedExpense] = useState(false);
  const [chargeDay, setChargeDay] = useState("");
  const [monthlyExpenseAmount, setMonthlyExpenseAmount] = useState("");
  const [primaryPaymentMethod, setPrimaryPaymentMethod] = useState("");
  const [fixedNote, setFixedNote] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);

  // Save supplier form draft
  const saveSupplierDraftData = useCallback(() => {
    if (!isAddSupplierModalOpen && !isEditingSupplier) return;
    saveSupplierDraft({
      supplierName, hasPreviousObligations, waitingForCoordinator,
      obligationTotalAmount, obligationTerms, obligationFirstChargeDate,
      obligationNumPayments, obligationMonthlyAmount,
      expenseType, category, parentCategory, paymentTerms,
      vatRequired, isFixedExpense, chargeDay, monthlyExpenseAmount,
      primaryPaymentMethod, fixedNote,
    });
  }, [saveSupplierDraft, isAddSupplierModalOpen, isEditingSupplier,
    supplierName, hasPreviousObligations, waitingForCoordinator,
    obligationTotalAmount, obligationTerms, obligationFirstChargeDate,
    obligationNumPayments, obligationMonthlyAmount,
    expenseType, category, parentCategory, paymentTerms,
    vatRequired, isFixedExpense, chargeDay, monthlyExpenseAmount,
    primaryPaymentMethod, fixedNote]);

  useEffect(() => {
    if (supplierDraftRestored.current) {
      saveSupplierDraftData();
    }
  }, [saveSupplierDraftData]);

  // Restore supplier draft when modal opens (only for new, not edit)
  useEffect(() => {
    if (isAddSupplierModalOpen && !isEditingSupplier) {
      supplierDraftRestored.current = false;
      setTimeout(() => {
        const draft = restoreSupplierDraft();
        if (draft) {
          if (draft.supplierName) setSupplierName(draft.supplierName as string);
          if (draft.hasPreviousObligations !== undefined) setHasPreviousObligations(draft.hasPreviousObligations as boolean);
          if (draft.waitingForCoordinator !== undefined) setWaitingForCoordinator(draft.waitingForCoordinator as boolean);
          if (draft.obligationTotalAmount) setObligationTotalAmount(draft.obligationTotalAmount as string);
          if (draft.obligationTerms) setObligationTerms(draft.obligationTerms as string);
          if (draft.obligationFirstChargeDate) setObligationFirstChargeDate(draft.obligationFirstChargeDate as string);
          if (draft.obligationNumPayments) setObligationNumPayments(draft.obligationNumPayments as string);
          if (draft.obligationMonthlyAmount) setObligationMonthlyAmount(draft.obligationMonthlyAmount as string);
          if (draft.expenseType) setExpenseType(draft.expenseType as "current" | "goods" | "employees");
          if (draft.category) setCategory(draft.category as string);
          if (draft.parentCategory) setParentCategory(draft.parentCategory as string);
          if (draft.paymentTerms) setPaymentTerms(draft.paymentTerms as string);
          if (draft.vatRequired) setVatRequired(draft.vatRequired as "yes" | "no" | "partial");
          if (draft.isFixedExpense !== undefined) setIsFixedExpense(draft.isFixedExpense as boolean);
          if (draft.chargeDay) setChargeDay(draft.chargeDay as string);
          if (draft.monthlyExpenseAmount) setMonthlyExpenseAmount(draft.monthlyExpenseAmount as string);
          if (draft.primaryPaymentMethod) setPrimaryPaymentMethod(draft.primaryPaymentMethod as string);
          if (draft.fixedNote) setFixedNote(draft.fixedNote as string);
        }
        supplierDraftRestored.current = true;
      }, 0);
    } else if (isEditingSupplier) {
      supplierDraftRestored.current = true;
    }
  }, [isAddSupplierModalOpen, isEditingSupplier, restoreSupplierDraft]);

  // Fetch suppliers from database
  useEffect(() => {
    async function fetchSuppliers() {
      if (selectedBusinesses.length === 0) {
        setSuppliers([]);
        setIsLoading(false);
        return;
      }

      const supabase = createClient();

      // Fetch suppliers for selected businesses
      const { data: suppliersData, error } = await supabase
        .from("suppliers")
        .select("*")
        .in("business_id", selectedBusinesses)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("name");

      if (error) {
        console.error("Error fetching suppliers:", error);
        setIsLoading(false);
        return;
      }

      // Fetch balance info from supplier_balance view
      const { data: balanceData } = await supabase
        .from("supplier_balance")
        .select("*")
        .in("business_id", selectedBusinesses);

      // Merge supplier data with balance info
      const suppliersWithBalance: SupplierWithBalance[] = (suppliersData || []).map((supplier) => {
        const balance = balanceData?.find((b) => b.supplier_id === supplier.id);

        // For suppliers with previous obligations (loans), calculate remaining loan balance
        // = total obligation amount - total paid to this supplier
        let remainingPayment = 0;
        if (supplier.has_previous_obligations && supplier.obligation_total_amount) {
          // Remaining loan = total obligation - total paid
          const totalPaid = balance?.total_paid || 0;
          remainingPayment = supplier.obligation_total_amount - totalPaid;
        } else {
          // Regular suppliers: use invoice balance (total_invoiced - total_paid)
          remainingPayment = balance?.balance || 0;
        }

        return {
          ...supplier,
          remainingPayment,
          revenuePercentage: 0, // TODO: Calculate from income data
        };
      });

      setSuppliers(suppliersWithBalance);
      setIsLoading(false);
    }

    fetchSuppliers();
  }, [selectedBusinesses, refreshTrigger]);

  // Fetch categories from database
  useEffect(() => {
    async function fetchCategories() {
      if (selectedBusinesses.length === 0) {
        setCategories([]);
        setParentCategories([]);
        return;
      }

      const supabase = createClient();

      const { data, error } = await supabase
        .from("expense_categories")
        .select("*")
        .in("business_id", selectedBusinesses)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("name", { ascending: true });

      if (error) {
        console.error("Error fetching categories:", error);
        return;
      }

      const allCategories = (data || []) as ExpenseCategory[];

      // Separate parent categories (those without parent_id) and child categories
      const parents = allCategories.filter(cat => !cat.parent_id);
      const children = allCategories.filter(cat => cat.parent_id);

      setParentCategories(parents);
      setCategories(children.length > 0 ? children : allCategories);
    }

    fetchCategories();
  }, [selectedBusinesses]);

  const handleCloseAddSupplierModal = () => {
    setIsAddSupplierModalOpen(false);
    setSupplierName("");
    setHasPreviousObligations(false);
    setWaitingForCoordinator(false);
    // Reset obligation fields
    setObligationTotalAmount("");
    setObligationTerms("");
    setObligationFirstChargeDate("");
    setObligationNumPayments("");
    setObligationMonthlyAmount("");
    setObligationDocument(null);
    // Reset other fields
    setExpenseType("current");
    setCategory("");
    setParentCategory("");
    setPaymentTerms("");
    setVatRequired("yes");
    setIsFixedExpense(false);
    setChargeDay("");
    setMonthlyExpenseAmount("");
    setPrimaryPaymentMethod("");
    setFixedNote("");
    setAttachedFile(null);
    setIsAddingCategory(false);
    setIsAddingParentCategory(false);
    setNewCategoryName("");
    setNewParentCategoryName("");
    // Reset edit mode
    setIsEditingSupplier(false);
    setEditingSupplierData(null);
  };

  // Handle edit supplier - fills form with existing data
  const handleEditSupplier = () => {
    if (!selectedSupplier) return;

    setEditingSupplierData(selectedSupplier);
    setIsEditingSupplier(true);

    // Fill form with existing data
    setSupplierName(selectedSupplier.name);
    setExpenseType(selectedSupplier.expense_type === "current_expenses" ? "current" : selectedSupplier.expense_type === "goods_purchases" ? "goods" : "employees");
    setCategory(selectedSupplier.expense_category_id || "");
    setPaymentTerms(selectedSupplier.payment_terms_days?.toString() || "");
    setVatRequired(
      selectedSupplier.vat_type === "full" ? "yes" :
      selectedSupplier.vat_type === "none" ? "no" : "partial"
    );
    setIsFixedExpense(selectedSupplier.is_fixed_expense || false);
    setChargeDay(selectedSupplier.charge_day?.toString() || "");
    setMonthlyExpenseAmount(selectedSupplier.monthly_expense_amount?.toString() || "");
    setPrimaryPaymentMethod(selectedSupplier.default_payment_method || "");
    setFixedNote(selectedSupplier.notes || "");
    setHasPreviousObligations(selectedSupplier.has_previous_obligations || false);
    setWaitingForCoordinator(selectedSupplier.waiting_for_coordinator || false);

    // Close detail popup and open add/edit modal
    setShowSupplierDetailPopup(false);
    setIsAddSupplierModalOpen(true);
  };

  // Handle update supplier
  const handleUpdateSupplier = async () => {
    if (!editingSupplierData || !supplierName.trim()) {
      showToast("יש להזין שם ספק", "warning");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();

    try {
      // Upload document if provided
      let documentUrl: string | null = editingSupplierData.document_url || null;
      if (attachedFile) {
        const fileExt = attachedFile.name.split(".").pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;
        const filePath = `supplier-documents/${editingSupplierData.business_id}/${fileName}`;

        const result = await uploadFile(attachedFile, filePath, "assets");

        if (result.success) {
          documentUrl = result.publicUrl || null;
        }
      }

      // Map VAT type
      const vatTypeMap: Record<string, string> = {
        yes: "full",
        no: "none",
        partial: "partial",
      };

      // Update supplier record
      const { error: updateError } = await supabase
        .from("suppliers")
        .update({
          name: supplierName.trim(),
          expense_type: expenseType === "current" ? "current_expenses" : expenseType === "goods" ? "goods_purchases" : "employee_costs",
          expense_category_id: category || null,
          parent_category_id: parentCategory || null,
          payment_terms_days: paymentTerms ? parseInt(paymentTerms) : 30,
          vat_type: vatTypeMap[vatRequired],
          requires_vat: vatRequired !== "no",
          is_fixed_expense: isFixedExpense,
          charge_day: chargeDay ? parseInt(chargeDay) : null,
          monthly_expense_amount: monthlyExpenseAmount ? parseFloat(monthlyExpenseAmount) : null,
          default_payment_method: primaryPaymentMethod || null,
          notes: fixedNote || null,
          document_url: documentUrl,
          has_previous_obligations: hasPreviousObligations,
          waiting_for_coordinator: waitingForCoordinator,
        })
        .eq("id", editingSupplierData.id);

      if (updateError) throw updateError;

      showToast("הספק עודכן בהצלחה!", "success");
      handleCloseAddSupplierModal();
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      console.error("Error updating supplier:", error);
      showToast("שגיאה בעדכון הספק", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add new category to database
  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) {
      showToast("יש להזין שם קטגוריה", "warning");
      return;
    }

    if (selectedBusinesses.length === 0) {
      showToast("יש לבחור עסק תחילה", "warning");
      return;
    }

    const supabase = createClient();

    const { data, error } = await supabase
      .from("expense_categories")
      .insert({
        business_id: selectedBusinesses[0],
        name: newCategoryName.trim(),
        parent_id: parentCategory || null, // Link to parent category if selected
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error("Error adding category:", error);
      showToast("שגיאה בהוספת קטגוריה", "error");
      return;
    }

    // Add to categories list and select it
    setCategories((prev) => [...prev, data as ExpenseCategory]);
    setCategory(data.id);
    setNewCategoryName("");
    setIsAddingCategory(false);
  };

  // Add new parent category to database
  const handleAddParentCategory = async () => {
    if (!newParentCategoryName.trim()) {
      showToast("יש להזין שם קטגוריית אב", "warning");
      return;
    }

    if (selectedBusinesses.length === 0) {
      showToast("יש לבחור עסק תחילה", "warning");
      return;
    }

    const supabase = createClient();

    const { data, error } = await supabase
      .from("expense_categories")
      .insert({
        business_id: selectedBusinesses[0],
        name: newParentCategoryName.trim(),
        parent_id: null, // Parent categories have no parent
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error("Error adding parent category:", error);
      showToast("שגיאה בהוספת קטגוריית אב", "error");
      return;
    }

    // Add to parent categories list and select it
    setParentCategories((prev) => [...prev, data as ExpenseCategory]);
    setParentCategory(data.id);
    setNewParentCategoryName("");
    setIsAddingParentCategory(false);
  };

  const handleSaveSupplier = async () => {
    if (!supplierName.trim()) {
      showToast("יש להזין שם ספק", "warning");
      return;
    }

    if (selectedBusinesses.length === 0) {
      showToast("יש לבחור עסק תחילה", "warning");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();

    try {
      // 1. Upload document if provided
      let documentUrl: string | null = null;
      if (attachedFile) {
        const fileExt = attachedFile.name.split(".").pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;
        const filePath = `supplier-documents/${selectedBusinesses[0]}/${fileName}`;

        const result = await uploadFile(attachedFile, filePath, "assets");

        if (!result.success) {
          console.error("Document upload error:", result.error);
        } else {
          documentUrl = result.publicUrl || null;
        }
      }

      // 1b. Upload obligation document if provided
      let obligationDocumentUrl: string | null = null;
      if (obligationDocument) {
        const fileExt = obligationDocument.name.split(".").pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;
        const filePath = `supplier-obligations/${selectedBusinesses[0]}/${fileName}`;

        const result = await uploadFile(obligationDocument, filePath, "assets");

        if (!result.success) {
          console.error("Obligation document upload error:", result.error);
        } else {
          obligationDocumentUrl = result.publicUrl || null;
        }
      }

      // 2. Map VAT type
      const vatTypeMap: Record<string, string> = {
        yes: "full",
        no: "none",
        partial: "partial",
      };

      // 3. Create supplier record
      const { data: newSupplier, error: supplierError } = await supabase
        .from("suppliers")
        .insert({
          business_id: selectedBusinesses[0], // Use first selected business
          name: supplierName.trim(),
          expense_type: expenseType === "current" ? "current_expenses" : expenseType === "goods" ? "goods_purchases" : "employee_costs",
          expense_category_id: category || null,
          parent_category_id: parentCategory || null,
          payment_terms_days: paymentTerms ? parseInt(paymentTerms) : 30,
          vat_type: vatTypeMap[vatRequired],
          requires_vat: vatRequired !== "no",
          is_fixed_expense: isFixedExpense,
          charge_day: chargeDay ? parseInt(chargeDay) : null,
          monthly_expense_amount: monthlyExpenseAmount ? parseFloat(monthlyExpenseAmount) : null,
          default_payment_method: primaryPaymentMethod || null,
          notes: fixedNote || null,
          document_url: documentUrl,
          has_previous_obligations: hasPreviousObligations,
          waiting_for_coordinator: waitingForCoordinator,
          // Previous obligations fields
          obligation_total_amount: hasPreviousObligations && obligationTotalAmount ? parseFloat(obligationTotalAmount) : null,
          obligation_terms: hasPreviousObligations ? obligationTerms || null : null,
          obligation_first_charge_date: hasPreviousObligations && obligationFirstChargeDate ? obligationFirstChargeDate : null,
          obligation_num_payments: hasPreviousObligations && obligationNumPayments ? parseInt(obligationNumPayments) : null,
          obligation_monthly_amount: hasPreviousObligations && obligationMonthlyAmount ? parseFloat(obligationMonthlyAmount) : null,
          obligation_document_url: obligationDocumentUrl,
          is_active: true,
        })
        .select()
        .single();

      if (supplierError) {
        throw new Error(`שגיאה ביצירת ספק: ${supplierError.message}`);
      }

      // 4. Create budget for current month (only for non-previous-obligations suppliers)
      if (!hasPreviousObligations) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1; // JavaScript months are 0-indexed

        const { error: budgetError } = await supabase
          .from("supplier_budgets")
          .insert({
            supplier_id: newSupplier.id,
            business_id: selectedBusinesses[0],
            year: currentYear,
            month: currentMonth,
            budget_amount: isFixedExpense && monthlyExpenseAmount ? parseFloat(monthlyExpenseAmount) : 0,
          });

        if (budgetError) {
          console.error("Error creating supplier budget:", budgetError);
          // Don't throw - supplier was created successfully, budget is secondary
        }
      }

      // 6. Add to local state
      setSuppliers((prev) => [
        ...prev,
        {
          ...newSupplier,
          remainingPayment: 0,
          revenuePercentage: 0,
        },
      ]);

      // 7. Close modal and reset form
      clearSupplierDraft();
      handleCloseAddSupplierModal();
      showToast("הספק נוצר בהצלחה!", "success");
    } catch (error) {
      console.error("Error creating supplier:", error);
      showToast(error instanceof Error ? error.message : "שגיאה ביצירת ספק. נסה שוב.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle opening supplier detail popup
  const handleOpenSupplierDetail = async (supplier: SupplierWithBalance) => {
    setSelectedSupplier(supplier);

    // For obligation suppliers, open the dedicated obligation detail popup
    if (supplier.has_previous_obligations) {
      setShowObligationDetailPopup(true);
      // Fetch payments for this supplier to determine paid installments
      const supabase = createClient();
      try {
        const { data: paymentsList } = await supabase
          .from("payments")
          .select("id, payment_date, total_amount")
          .eq("supplier_id", supplier.id)
          .is("deleted_at", null)
          .order("payment_date", { ascending: true });

        if (paymentsList) {
          setObligationPayments(paymentsList.map(pay => ({
            id: pay.id,
            date: pay.payment_date,
            amount: Number(pay.total_amount),
          })));
        }
      } catch (error) {
        console.error("Error fetching obligation payments:", error);
      }
      return;
    }

    setShowSupplierDetailPopup(true);

    // Fetch supplier financial data
    const supabase = createClient();

    try {
      // Get current month date range
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      // Fetch total purchases (invoices) for this supplier
      const { data: invoicesData } = await supabase
        .from("invoices")
        .select("total_amount")
        .eq("supplier_id", supplier.id)
        .is("deleted_at", null);

      const totalPurchases = invoicesData?.reduce((sum, inv) => sum + Number(inv.total_amount), 0) || 0;

      // Fetch total payments for this supplier
      const { data: paymentsData } = await supabase
        .from("payments")
        .select("total_amount")
        .eq("supplier_id", supplier.id)
        .is("deleted_at", null);

      const totalPaid = paymentsData?.reduce((sum, pay) => sum + Number(pay.total_amount), 0) || 0;

      // Fetch monthly purchases
      const { data: monthlyInvoices } = await supabase
        .from("invoices")
        .select("total_amount")
        .eq("supplier_id", supplier.id)
        .is("deleted_at", null)
        .gte("invoice_date", monthStart.toISOString().split("T")[0])
        .lte("invoice_date", monthEnd.toISOString().split("T")[0]);

      const monthlyPurchases = monthlyInvoices?.reduce((sum, inv) => sum + Number(inv.total_amount), 0) || 0;

      // Fetch monthly payments
      const { data: monthlyPayments } = await supabase
        .from("payments")
        .select("total_amount")
        .eq("supplier_id", supplier.id)
        .is("deleted_at", null)
        .gte("payment_date", monthStart.toISOString().split("T")[0])
        .lte("payment_date", monthEnd.toISOString().split("T")[0]);

      const monthlyPaid = monthlyPayments?.reduce((sum, pay) => sum + Number(pay.total_amount), 0) || 0;

      // Calculate expected payment date based on payment terms
      let expectedPaymentDate: string | null = null;
      if (supplier.payment_terms_days) {
        const expectedDate = new Date(monthEnd);
        expectedDate.setDate(expectedDate.getDate() + supplier.payment_terms_days);
        expectedPaymentDate = expectedDate.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
      }

      // For suppliers with previous obligations (loans), calculate loan balance
      let displayTotalPurchases = totalPurchases;
      let displayRemainingBalance = totalPurchases - totalPaid;

      if (supplier.has_previous_obligations && supplier.obligation_total_amount) {
        // For loans: show obligation total and remaining loan balance
        displayTotalPurchases = supplier.obligation_total_amount;
        displayRemainingBalance = supplier.obligation_total_amount - totalPaid;
      }

      setSupplierDetailData({
        totalPurchases: displayTotalPurchases,
        totalPaid,
        remainingBalance: displayRemainingBalance,
        monthlyData: {
          expectedPaymentDate,
          monthlyPurchases,
          monthlyPaid,
          amountToPay: monthlyPurchases - monthlyPaid,
        },
      });

      // Fetch invoices list for this supplier
      const { data: invoicesList } = await supabase
        .from("invoices")
        .select("id, invoice_date, invoice_number, subtotal, status")
        .eq("supplier_id", supplier.id)
        .is("deleted_at", null)
        .order("invoice_date", { ascending: false })
        .limit(20);

      if (invoicesList) {
        setSupplierInvoices(invoicesList.map(inv => ({
          id: inv.id,
          date: new Date(inv.invoice_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
          reference: inv.invoice_number || "-",
          amount: Number(inv.subtotal),
          status: inv.status === "paid" ? "שולם" : inv.status === "clarification" ? "בבירור" : "ממתין",
        })));
      }

      // Fetch payments list for this supplier
      const { data: paymentsList } = await supabase
        .from("payments")
        .select(`
          id,
          payment_date,
          total_amount,
          payment_splits(payment_method, reference_number)
        `)
        .eq("supplier_id", supplier.id)
        .is("deleted_at", null)
        .order("payment_date", { ascending: false })
        .limit(20);

      if (paymentsList) {
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

        setSupplierPayments(paymentsList.map(pay => {
          const firstSplit = pay.payment_splits?.[0];
          return {
            id: pay.id,
            date: new Date(pay.payment_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
            method: paymentMethodNames[firstSplit?.payment_method || "other"] || "אחר",
            amount: Number(pay.total_amount),
            reference: firstSplit?.reference_number || "-",
          };
        }));
      }
    } catch (error) {
      console.error("Error fetching supplier detail:", error);
    }
  };

  // Handle closing supplier detail popup
  const handleCloseSupplierDetail = () => {
    setShowSupplierDetailPopup(false);
    setSelectedSupplier(null);
    setSupplierDetailData(null);
  };

  // Get category name by ID
  const getCategoryName = (categoryId: string | undefined) => {
    if (!categoryId) return "-";
    const cat = categories.find(c => c.id === categoryId);
    return cat?.name || "-";
  };

  // Get parent category name by ID
  const getParentCategoryName = (supplier: SupplierWithBalance) => {
    // First try to find the category's parent
    if (supplier.expense_category_id) {
      const cat = categories.find(c => c.id === supplier.expense_category_id);
      if (cat?.parent_id) {
        const parent = parentCategories.find(p => p.id === cat.parent_id);
        return parent?.name || "-";
      }
    }
    return "-";
  };

  // Filter suppliers by tab and search
  const filteredByTab = suppliers.filter((supplier) => {
    if (activeTab === "previous") return supplier.has_previous_obligations;
    if (activeTab === "purchases") return supplier.expense_type === "goods_purchases" && !supplier.has_previous_obligations;
    if (activeTab === "employees") return supplier.expense_type === "employee_costs" && !supplier.has_previous_obligations;
    return supplier.expense_type === "current_expenses" && !supplier.has_previous_obligations;
  });

  const filteredSuppliers = filteredByTab.filter((supplier) =>
    supplier.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculate total open payment
  const totalOpenPayment = filteredSuppliers.reduce((sum, item) => sum + item.remainingPayment, 0);
  const suppliersCount = filteredSuppliers.length;

  return (
    <div dir="rtl" className="flex flex-col min-h-[calc(100vh-52px)] text-white px-[5px] py-[5px] pb-[80px] gap-[10px]">
      {/* Header Section with Total and Add Button */}
      <div className="flex flex-col gap-[7px] p-[5px]">
        {/* Total Open Payment - פתוח לתשלום: בימין, הסכום בשמאל */}
        <div className="flex items-center justify-center gap-[3px]">
          <span className="text-[23px] font-bold text-[#F64E60]">פתוח לתשלום:</span>
          <span className="text-[23px] font-bold text-[#F64E60]">
            ₪{totalOpenPayment.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Add Supplier Button */}
        <button
          type="button"
          onClick={() => {
            if (activeTab === "previous") {
              setHasPreviousObligations(true);
            }
            if (activeTab === "purchases") {
              setExpenseType("goods");
            }
            if (activeTab === "employees") {
              setExpenseType("employees");
            }
            setIsAddSupplierModalOpen(true);
          }}
          className="w-full min-h-[50px] bg-[#29318A] text-white text-[16px] font-semibold rounded-[5px] px-[24px] py-[12px] transition-colors duration-200 hover:bg-[#3D44A0] shadow-[0_7px_30px_-10px_rgba(41,49,138,0.1)]"
        >
          הוספת ספק חדש
        </button>
      </div>

      {/* Main Content Container */}
      <div className="flex-1 flex flex-col bg-[#0F1535] rounded-[10px] p-[5px_7px]">
        {/* Tabs */}
        <div className="flex w-full h-[45px] mb-[10px] border border-[#6B6B6B] rounded-[7px] overflow-hidden">
          <button
            type="button"
            onClick={() => setActiveTab("purchases")}
            className={`flex-1 flex items-center justify-center transition-colors duration-200 p-[3px] ${
              activeTab === "purchases"
                ? "bg-[#29318A] text-white"
                : "text-[#979797]"
            }`}
          >
            <span className="text-[13px] font-bold">קניות סחורה</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("current")}
            className={`flex-1 flex items-center justify-center transition-colors duration-200 p-[3px] ${
              activeTab === "current"
                ? "bg-[#29318A] text-white"
                : "text-[#979797]"
            }`}
          >
            <span className="text-[13px] font-bold">הוצאות שוטפות</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("employees")}
            className={`flex-1 flex items-center justify-center transition-colors duration-200 p-[3px] ${
              activeTab === "employees"
                ? "bg-[#29318A] text-white"
                : "text-[#979797]"
            }`}
          >
            <span className="text-[13px] font-bold">עלות עובדים</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("previous")}
            className={`flex-1 flex items-center justify-center transition-colors duration-200 p-[3px] ${
              activeTab === "previous"
                ? "bg-[#29318A] text-white"
                : "text-[#979797]"
            }`}
          >
            <span className="text-[13px] font-bold">התחייבויות קודמות</span>
          </button>
        </div>

        {/* Suppliers Count and Search - לחיצה על חיפוש מחליפה את כמות הספקים בשדה חיפוש */}
        <div className="flex items-center gap-[10px] mb-[10px]">
          <button
            type="button"
            title="חיפוש"
            onClick={() => {
              setIsSearchOpen(!isSearchOpen);
              if (isSearchOpen) setSearchQuery("");
            }}
            className="w-[30px] h-[30px] flex items-center justify-center text-white opacity-45 hover:opacity-100 transition-opacity"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M16 16L20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          {isSearchOpen ? (
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="חיפוש ספק..."
              className="bg-[#29318A]/30 border border-[#6B6B6B] rounded-[7px] px-[12px] py-[6px] text-white text-[14px] placeholder:text-white/50 focus:outline-none focus:border-[#29318A] flex-1 text-right"
              autoFocus
            />
          ) : (
            <span className="text-[18px] font-bold text-white">{activeTab === "previous" ? `${suppliersCount} התחייבויות קודמות` : `${suppliersCount} ספקים`}</span>
          )}
        </div>

        {/* Suppliers Grid */}
        <div className="flex-1 overflow-auto mt-[15px] mx-[7px]">
          {isLoading ? (
            /* Skeleton Loaders for Supplier Cards */
            <div className="grid grid-cols-2 gap-[26px]">
              {[...Array(8)].map((_, i) => (
                <div
                  key={`skeleton-${i}`}
                  className="bg-[#29318A] rounded-[10px] p-[7px] min-h-[170px] flex flex-col items-center justify-center gap-[10px] animate-pulse"
                >
                  {/* Skeleton Supplier Name */}
                  <div className="w-[120px] flex justify-center">
                    <div className="w-[80px] h-[22px] bg-white/20 rounded-[5px]" />
                  </div>

                  {/* Skeleton Payment Info */}
                  <div className="w-[100px] flex flex-col items-center gap-[4px]">
                    <div className="w-[80px] h-[18px] bg-white/15 rounded-[5px]" />
                    <div className="w-[50px] h-[18px] bg-[#F64E60]/25 rounded-[5px]" />
                    <div className="w-[75px] h-[16px] bg-white/15 rounded-[5px]" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredSuppliers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-[50px] gap-[10px]">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-[#979797]">
                <path d="M12 8V12M12 16H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span className="text-[16px] text-[#979797]">
                {selectedBusinesses.length === 0 ? "יש לבחור עסק כדי לראות ספקים" : "לא נמצאו ספקים"}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-[26px]">
              {filteredSuppliers.map((supplier) => (
                <button
                  key={supplier.id}
                  type="button"
                  onClick={() => handleOpenSupplierDetail(supplier)}
                  className="bg-[#29318A] rounded-[10px] p-[7px] min-h-[170px] flex flex-col items-center justify-center gap-[10px] transition-colors duration-200 hover:bg-[#3D44A0] cursor-pointer"
                >
                  {/* Supplier Name */}
                  <div className="w-[120px] text-center">
                    <span className="text-[18px] font-bold text-white leading-[1.4]">
                      {supplier.name}
                    </span>
                  </div>

                  {/* Payment Info */}
                  <div className="w-[100px] flex flex-col items-center">
                    <span className="text-[18px] font-normal text-white text-center leading-[1.4]">
                      נותר לתשלום
                    </span>
                    <span className="text-[18px] font-semibold text-[#F64E60] text-center leading-[1.4]">
                      ₪{supplier.remainingPayment.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-[16px] font-bold text-white text-center leading-[1.4]">
                      {Number(supplier.revenuePercentage.toFixed(2))}% מהכנסות
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Supplier Modal */}
      <Sheet open={isAddSupplierModalOpen} onOpenChange={(open) => !open && handleCloseAddSupplierModal()}>
        <SheetContent
          side="bottom"
          className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
          showCloseButton={false}
        >
          <SheetHeader className="border-b border-[#4C526B] pb-4">
            <div className="flex justify-between items-center" dir="ltr">
              <button
                type="button"
                onClick={handleCloseAddSupplierModal}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </button>
              <SheetTitle className="text-white text-xl font-bold">
                {isEditingSupplier ? "עריכת ספק" : "הוספת ספק חדש"}
              </SheetTitle>
              <div className="w-[24px]" />
            </div>
          </SheetHeader>

            {/* Form */}
            <div className="flex flex-col gap-[10px] px-[5px]">
              {/* Supplier Name */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">{hasPreviousObligations ? "שם התחייבות" : "שם הספק"}</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <input
                    type="text"
                    title={hasPreviousObligations ? "שם התחייבות" : "שם הספק"}
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
                  />
                </div>
              </div>

              {/* Checkboxes - התחייבויות קודמות (only in previous tab), ממתין למרכזת */}
              <div className="flex flex-col gap-[10px] items-start" dir="rtl">
                {activeTab === "previous" && (
                  <button
                    type="button"
                    onClick={() => setHasPreviousObligations(!hasPreviousObligations)}
                    className="flex items-center gap-[3px]"
                  >
                    <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className="text-[#979797]">
                      {hasPreviousObligations ? (
                        <>
                          <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                          <path d="M10 16L14 20L22 12" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </>
                      ) : (
                        <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                    <span className="text-[15px] font-semibold text-[#979797]">התחייבויות קודמות</span>
                  </button>
                )}

                {!hasPreviousObligations && (
                  <button
                    type="button"
                    onClick={() => setWaitingForCoordinator(!waitingForCoordinator)}
                    className="flex items-center gap-[3px]"
                  >
                    <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className="text-[#979797]">
                      {waitingForCoordinator ? (
                        <>
                          <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                          <path d="M10 16L14 20L22 12" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </>
                      ) : (
                        <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                    <span className="text-[15px] font-semibold text-[#979797]">ממתין למרכזת</span>
                  </button>
                )}

                {!hasPreviousObligations && (
                  <button
                    type="button"
                    onClick={() => setIsFixedExpense(!isFixedExpense)}
                    className="flex items-center gap-[3px]"
                  >
                    <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className="text-[#979797]">
                      {isFixedExpense ? (
                        <>
                          <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                          <path d="M10 16L14 20L22 12" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </>
                      ) : (
                        <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                    <span className="text-[15px] font-semibold text-[#979797]">הוצאה קבועה</span>
                  </button>
                )}
              </div>

              {/* Previous Obligations Fields - shown when hasPreviousObligations is true */}
              {hasPreviousObligations && (
                <div className="flex flex-col gap-[10px] p-[10px] bg-[#29318A]/20 rounded-[10px] border border-[#4C526B]">
                  <p className="text-[14px] font-bold text-white text-right">פרטי התחייבות קודמת</p>

                  {/* Total Amount */}
                  <div className="flex flex-col gap-[5px]">
                    <label className="text-[14px] font-medium text-white/80 text-right">סה״כ סכום שנלקח כולל ריבית</label>
                    <div className="border border-[#4C526B] rounded-[10px] h-[45px]">
                      <input
                        title="סכום כולל"
                        type="tel"
                        value={obligationTotalAmount}
                        onChange={(e) => setObligationTotalAmount(e.target.value)}
                        placeholder="₪"
                        className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                      />
                    </div>
                  </div>

                  {/* Terms */}
                  <div className="flex flex-col gap-[5px]">
                    <label className="text-[14px] font-medium text-white/80 text-right">תנאים</label>
                    <div className="border border-[#4C526B] rounded-[10px] min-h-[60px] px-[10px] py-[8px]">
                      <textarea
                        title="תנאים"
                        value={obligationTerms}
                        onChange={(e) => setObligationTerms(e.target.value)}
                        placeholder="פרטי התנאים..."
                        className="w-full h-full min-h-[44px] bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none resize-none placeholder:text-white/30"
                      />
                    </div>
                  </div>

                  {/* First Charge Date */}
                  <div className="flex flex-col gap-[5px]">
                    <label className="text-[14px] font-medium text-white/80 text-right">תאריך חיוב ראשון</label>
                    <div className="border border-[#4C526B] rounded-[10px] h-[45px]">
                      <input
                        title="תאריך חיוב ראשון"
                        type="date"
                        value={obligationFirstChargeDate}
                        onChange={(e) => setObligationFirstChargeDate(e.target.value)}
                        className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
                      />
                    </div>
                  </div>

                  {/* Number of Payments */}
                  <div className="flex flex-col gap-[5px]">
                    <label className="text-[14px] font-medium text-white/80 text-right">כמות תשלומים</label>
                    <div className="border border-[#4C526B] rounded-[10px] h-[45px]">
                      <input
                        title="כמות תשלומים"
                        type="tel"
                        value={obligationNumPayments}
                        onChange={(e) => setObligationNumPayments(e.target.value)}
                        placeholder="לדוגמה: 12"
                        className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                      />
                    </div>
                  </div>

                  {/* Monthly Amount */}
                  <div className="flex flex-col gap-[5px]">
                    <label className="text-[14px] font-medium text-white/80 text-right">סכום חיוב חודשי כולל ריבית (משוער)</label>
                    <div className="border border-[#4C526B] rounded-[10px] h-[45px]">
                      <input
                        title="סכום חיוב חודשי"
                        type="tel"
                        value={obligationMonthlyAmount}
                        onChange={(e) => setObligationMonthlyAmount(e.target.value)}
                        placeholder="₪"
                        className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                      />
                    </div>
                  </div>

                  {/* Document Upload */}
                  <div className="flex flex-col gap-[5px]">
                    <label className="text-[14px] font-medium text-white/80 text-right">תמונה/מסמך מצורף</label>
                    <label className="border border-[#4C526B] border-dashed rounded-[10px] min-h-[60px] px-[10px] py-[10px] flex flex-col items-center justify-center gap-[5px] cursor-pointer hover:border-[#29318A] transition-colors">
                      {obligationDocument ? (
                        <span className="text-[13px] text-white">{obligationDocument.name}</span>
                      ) : (
                        <>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-[#979797]">
                            <path d="M12 16V8M12 8L9 11M12 8L15 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M3 15V16C3 18.2091 4.79086 20 7 20H17C19.2091 20 21 18.2091 21 16V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <span className="text-[12px] text-[#979797]">לחץ להעלאת קובץ</span>
                        </>
                      )}
                      <input
                        title="העלאת קובץ התחייבות"
                        type="file"
                        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                        onChange={(e) => setObligationDocument(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* Expense Type - Radio buttons (hidden for previous obligations) */}
              {!hasPreviousObligations && (
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[15px] font-medium text-white text-right">סוג הוצאה</label>
                  <div className="flex items-center justify-start gap-[20px]" dir="rtl">
                    <button
                      type="button"
                      onClick={() => setExpenseType("current")}
                      className="flex items-center gap-[3px]"
                    >
                      <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={expenseType === "current" ? "text-white" : "text-[#979797]"}>
                        {expenseType === "current" ? (
                          <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                        ) : (
                          <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/>
                        )}
                      </svg>
                      <span className={`text-[15px] font-semibold ${expenseType === "current" ? "text-white" : "text-[#979797]"}`}>
                        הוצאות שוטפות
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpenseType("goods")}
                      className="flex items-center gap-[3px]"
                    >
                      <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={expenseType === "goods" ? "text-white" : "text-[#979797]"}>
                        {expenseType === "goods" ? (
                          <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                        ) : (
                          <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/>
                        )}
                      </svg>
                      <span className={`text-[15px] font-semibold ${expenseType === "goods" ? "text-white" : "text-[#979797]"}`}>
                        קניות סחורה
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpenseType("employees")}
                      className="flex items-center gap-[3px]"
                    >
                      <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={expenseType === "employees" ? "text-white" : "text-[#979797]"}>
                        {expenseType === "employees" ? (
                          <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                        ) : (
                          <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/>
                        )}
                      </svg>
                      <span className={`text-[15px] font-semibold ${expenseType === "employees" ? "text-white" : "text-[#979797]"}`}>
                        עלות עובדים
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Parent Category */}
              <div className="flex flex-col gap-[5px]">
                <div className="flex items-center justify-between">
                  <label className="text-[15px] font-medium text-white">קטגוריית אב</label>
                  <button
                    type="button"
                    onClick={() => setIsAddingParentCategory(!isAddingParentCategory)}
                    className="bg-[#29318A] text-white text-[13px] font-medium px-[10px] py-[3px] rounded-[7px] hover:bg-[#3D44A0] transition-colors"
                  >
                    {isAddingParentCategory ? "ביטול" : "+ חדש"}
                  </button>
                </div>
                {isAddingParentCategory ? (
                  <div className="flex gap-[8px]">
                    <div className="flex-1 border border-[#4C526B] rounded-[10px] h-[50px]">
                      <input
                        type="text"
                        title="שם קטגוריית אב חדשה"
                        value={newParentCategoryName}
                        onChange={(e) => setNewParentCategoryName(e.target.value)}
                        placeholder="הזן שם קטגוריית אב..."
                        className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                        autoFocus
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddParentCategory}
                      disabled={!newParentCategoryName.trim()}
                      className="bg-[#3CD856] text-white text-[14px] font-semibold px-[15px] rounded-[10px] hover:bg-[#2FB847] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      הוסף
                    </button>
                  </div>
                ) : (
                  <div className="border border-[#4C526B] rounded-[10px] h-[50px] px-[10px]">
                    <select
                      title="בחר קטגוריית אב"
                      value={parentCategory}
                      onChange={(e) => setParentCategory(e.target.value)}
                      className="w-full h-full bg-transparent text-white/40 text-[14px] text-center rounded-[10px] border-none outline-none"
                    >
                      <option value="" className="bg-[#0F1535] text-white/40">בחר קטגוריית אב</option>
                      {parentCategories.map((cat) => (
                        <option key={cat.id} value={cat.id} className="bg-[#0F1535] text-white">
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Category */}
              <div className="flex flex-col gap-[5px]">
                <div className="flex items-center justify-between">
                  <label className="text-[15px] font-medium text-white">קטגוריה</label>
                  <button
                    type="button"
                    onClick={() => setIsAddingCategory(!isAddingCategory)}
                    className="bg-[#29318A] text-white text-[13px] font-medium px-[10px] py-[3px] rounded-[7px] hover:bg-[#3D44A0] transition-colors"
                  >
                    {isAddingCategory ? "ביטול" : "+ חדש"}
                  </button>
                </div>
                {isAddingCategory ? (
                  <div className="flex gap-[8px]">
                    <div className="flex-1 border border-[#4C526B] rounded-[10px] h-[50px]">
                      <input
                        type="text"
                        title="שם קטגוריה חדשה"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="הזן שם קטגוריה..."
                        className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                        autoFocus
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddCategory}
                      disabled={!newCategoryName.trim()}
                      className="bg-[#3CD856] text-white text-[14px] font-semibold px-[15px] rounded-[10px] hover:bg-[#2FB847] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      הוסף
                    </button>
                  </div>
                ) : (
                  <div className="border border-[#4C526B] rounded-[10px] h-[50px] px-[10px]">
                    <select
                      title="בחר קטגוריה"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full h-full bg-transparent text-white/40 text-[14px] text-center rounded-[10px] border-none outline-none"
                    >
                      <option value="" className="bg-[#0F1535] text-white/40">בחר קטגוריה</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id} className="bg-[#0F1535] text-white">
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Payment Terms (hidden for previous obligations) */}
              {!hasPreviousObligations && (
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[15px] font-medium text-white text-right">תנאי תשלום (שוטף +)</label>
                  <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                    <input
                      type="tel"
                      title="תנאי תשלום"
                      value={paymentTerms}
                      onChange={(e) => setPaymentTerms(e.target.value)}
                      className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
                    />
                  </div>
                </div>
              )}

              {/* VAT Required - Radio buttons */}
              <div className="flex flex-col gap-[3px]">
                <label className="text-[15px] font-medium text-white text-right">נדרש מע&quot;מ</label>
                <div className="flex items-center justify-start gap-[20px]" dir="rtl">
                  <button
                    type="button"
                    onClick={() => setVatRequired("yes")}
                    className="flex items-center gap-[3px]"
                  >
                    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={vatRequired === "yes" ? "text-white" : "text-[#979797]"}>
                      {vatRequired === "yes" ? (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                      ) : (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                    <span className={`text-[15px] font-semibold ${vatRequired === "yes" ? "text-white" : "text-[#979797]"}`}>
                      כן
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVatRequired("no")}
                    className="flex items-center gap-[3px]"
                  >
                    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={vatRequired === "no" ? "text-white" : "text-[#979797]"}>
                      {vatRequired === "no" ? (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                      ) : (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                    <span className={`text-[15px] font-semibold ${vatRequired === "no" ? "text-white" : "text-[#979797]"}`}>
                      לא
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVatRequired("partial")}
                    className="flex items-center gap-[3px]"
                  >
                    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={vatRequired === "partial" ? "text-white" : "text-[#979797]"}>
                      {vatRequired === "partial" ? (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                      ) : (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                    <span className={`text-[15px] font-semibold ${vatRequired === "partial" ? "text-white" : "text-[#979797]"}`}>
                      מע&quot;מ חלקי
                    </span>
                  </button>
                </div>
              </div>

              {/* Charge Day & Monthly Amount - only when fixed expense */}
              {isFixedExpense && (
                <>
                  <div className="flex flex-col gap-[5px]">
                    <label className="text-[15px] font-medium text-white text-right">מתי יורד החיוב בחודש?</label>
                    <div className="border border-[#4C526B] rounded-[10px] h-[50px] px-[10px]">
                      <input
                        type="tel"
                        title="מתי יורד החיוב בחודש"
                        value={chargeDay}
                        onChange={(e) => setChargeDay(e.target.value)}
                        placeholder="לדוגמה: 1, 15, 28"
                        className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none placeholder:text-white/30"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-[5px]">
                    <label className="text-[15px] font-medium text-white text-right">סכום הוצאה עבור כל חודש</label>
                    <div className="border border-[#4C526B] rounded-[10px] h-[50px] px-[10px]">
                      <input
                        type="tel"
                        title="סכום הוצאה עבור כל חודש"
                        value={monthlyExpenseAmount}
                        onChange={(e) => setMonthlyExpenseAmount(e.target.value)}
                        placeholder="₪"
                        className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none placeholder:text-white/30"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Primary Payment Method */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">אמצעי תשלום ראשי</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px] px-[10px]">
                  <select
                    title="אמצעי תשלום ראשי"
                    value={primaryPaymentMethod}
                    onChange={(e) => setPrimaryPaymentMethod(e.target.value)}
                    className="w-full h-full bg-transparent text-white/40 text-[14px] text-center rounded-[10px] border-none outline-none"
                  >
                    <option value="" className="bg-[#0F1535] text-white/40"></option>
                    <option value="credit" className="bg-[#0F1535] text-white">כרטיס אשראי</option>
                    <option value="bank_transfer" className="bg-[#0F1535] text-white">העברה בנקאית</option>
                    <option value="check" className="bg-[#0F1535] text-white">צ&apos;ק</option>
                    <option value="cash" className="bg-[#0F1535] text-white">מזומן</option>
                    <option value="bit" className="bg-[#0F1535] text-white">ביט</option>
                    <option value="paybox" className="bg-[#0F1535] text-white">פייבוקס</option>
                  </select>
                </div>
              </div>

              {/* Fixed Note */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">הערה קבועה לספק</label>
                <div className="border border-[#4C526B] rounded-[10px] min-h-[80px] px-[10px] py-[10px]">
                  <textarea
                    title="הערה קבועה לספק"
                    value={fixedNote}
                    onChange={(e) => setFixedNote(e.target.value)}
                    className="w-full h-full min-h-[60px] bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none resize-none"
                  />
                </div>
              </div>

              {/* File Upload - Quote/Terms (hidden for previous obligations) */}
              {!hasPreviousObligations && (
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[15px] font-medium text-white text-right">הצעת מחיר/תקנון/תנאים שסוכמו וכדומה</label>
                  <label className="border border-[#4C526B] border-dashed rounded-[10px] min-h-[80px] px-[10px] py-[15px] flex flex-col items-center justify-center gap-[8px] cursor-pointer hover:border-[#29318A] transition-colors">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[#979797]">
                      <path d="M12 16V8M12 8L9 11M12 8L15 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M3 15V16C3 18.2091 4.79086 20 7 20H17C19.2091 20 21 18.2091 21 16V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="text-[14px] text-[#979797]">
                      {attachedFile ? attachedFile.name : "לחץ להעלאת קובץ"}
                    </span>
                    <input
                      type="file"
                      title="העלאת קובץ"
                      onChange={(e) => setAttachedFile(e.target.files?.[0] || null)}
                      className="hidden"
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                    />
                  </label>
                </div>
              )}

              {/* Submit and Cancel Buttons */}
              <div className="flex gap-[10px] mt-[15px] mb-[10px]">
                <button
                  type="button"
                  onClick={isEditingSupplier ? handleUpdateSupplier : handleSaveSupplier}
                  disabled={isSubmitting || !supplierName.trim()}
                  className="flex-1 bg-[#29318A] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-[#3D44A0] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[8px]"
                >
                  {isSubmitting ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {isEditingSupplier ? "מעדכן..." : "שומר..."}
                    </>
                  ) : (
                    isEditingSupplier ? "עדכן ספק" : "שמור ספק"
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleCloseAddSupplierModal}
                  disabled={isSubmitting}
                  className="flex-1 bg-transparent border border-[#4C526B] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  ביטול
                </button>
              </div>
            </div>
        </SheetContent>
      </Sheet>

      {/* Supplier Detail Popup */}
      <Sheet open={showSupplierDetailPopup && !!selectedSupplier} onOpenChange={(open) => !open && handleCloseSupplierDetail()}>
        <SheetContent
          side="bottom"
          className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
          showCloseButton={false}
        >
          <SheetHeader className="border-b border-[#4C526B] pb-4">
            <div className="flex justify-between items-center" dir="ltr">
              <button
                type="button"
                onClick={handleCloseSupplierDetail}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </button>
              <SheetTitle className="text-white text-xl font-bold">פרטי ספק</SheetTitle>
              <button
                type="button"
                title="עריכה"
                onClick={handleEditSupplier}
                className="w-[24px] h-[24px] flex items-center justify-center text-white/70 hover:text-white"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </SheetHeader>
          {selectedSupplier && (
          <div className="p-4">
            {/* Supplier Details Grid */}
            <div className="bg-[#29318A]/30 rounded-[10px] p-[15px] mb-[15px]">
              {/* Row 1 */}
              <div className="grid grid-cols-3 gap-[10px] mb-[15px]">
                <div className="flex flex-col items-center text-center">
                  <span className="text-[12px] text-white/60">שם ספק</span>
                  <span className="text-[14px] text-white font-medium">{selectedSupplier.name}</span>
                </div>
                <div className="flex flex-col items-center text-center">
                  <span className="text-[12px] text-white/60">תנאי תשלום (שוטף+)</span>
                  <span className="text-[14px] text-white font-medium">{selectedSupplier.payment_terms_days || "-"}</span>
                </div>
                <div className="flex flex-col items-center text-center">
                  <span className="text-[12px] text-white/60">נדרש מע&quot;מ</span>
                  <span className="text-[14px] text-white font-medium">
                    {selectedSupplier.vat_type === "full" ? "כן" : selectedSupplier.vat_type === "none" ? "לא" : "חלקי"}
                  </span>
                </div>
              </div>

              {/* Row 2 */}
              <div className="grid grid-cols-3 gap-[10px] mb-[15px]">
                <div className="flex flex-col items-center text-center">
                  <span className="text-[12px] text-white/60">סוג הוצאה</span>
                  <span className="text-[14px] text-white font-medium">
                    {selectedSupplier.expense_type === "current_expenses" ? "הוצאות שוטפות" : selectedSupplier.expense_type === "goods_purchases" ? "קניות סחורה" : "עלות עובדים"}
                  </span>
                </div>
                <div className="flex flex-col items-center text-center">
                  <span className="text-[12px] text-white/60">קטגוריה</span>
                  <span className="text-[14px] text-white font-medium">{getCategoryName(selectedSupplier.expense_category_id)}</span>
                </div>
                <div className="flex flex-col items-center text-center">
                  <span className="text-[12px] text-white/60">קטגוריית אב</span>
                  <span className="text-[14px] text-white font-medium">{getParentCategoryName(selectedSupplier)}</span>
                </div>
              </div>

              {/* Row 3 */}
              <div className="grid grid-cols-3 gap-[10px]">
                <div className="flex flex-col items-center text-center">
                  <span className="text-[12px] text-white/60">מרכזת</span>
                  <span className="text-[14px] text-white font-medium">{selectedSupplier.waiting_for_coordinator ? "כן" : "לא"}</span>
                </div>
                <div className="flex flex-col items-center text-center">
                  <span className="text-[12px] text-white/60">ה. חודשית קבועה</span>
                  <span className="text-[14px] text-white font-medium">{selectedSupplier.is_fixed_expense ? "כן" : "לא"}</span>
                </div>
                <div className="flex flex-col items-center text-center">
                  <span className="text-[12px] text-white/60">הלוואה</span>
                  <span className="text-[14px] text-white font-medium">{selectedSupplier.has_previous_obligations ? "כן" : "לא"}</span>
                </div>
              </div>
            </div>

            {/* Account Status Section */}
            <div className="mb-[15px]">
              <h3 className="text-[16px] font-bold text-white text-center mb-[10px]">מצב חשבון</h3>
              <div className="bg-[#29318A]/30 rounded-[10px] p-[15px] flex flex-col gap-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-white">
                    {selectedSupplier.has_previous_obligations
                      ? "סה\"כ סכום ההתחייבות (כולל ריבית)"
                      : "סה\"כ קניות שבוצעו מהספק (כולל מע\"מ)"}
                  </span>
                  <span className="text-[16px] text-white font-bold ltr-num">
                    ₪{(supplierDetailData?.totalPurchases || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-white">סה&quot;כ תשלום שבוצע לספק</span>
                  <span className="text-[16px] text-white font-bold ltr-num">
                    ₪{(supplierDetailData?.totalPaid || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-white/20 pt-[10px]">
                  <span className="text-[14px] text-[#F64E60] font-medium">
                    {selectedSupplier.has_previous_obligations ? "יתרת הלוואה" : "יתרה לתשלום"}
                  </span>
                  <span className="text-[18px] text-[#F64E60] font-bold ltr-num">
                    ₪{(supplierDetailData?.remainingBalance || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Monthly Details Section */}
            <div className="bg-[#29318A]/30 rounded-[10px] p-[15px]">
              {/* Month selector */}
              <div className="flex items-center justify-center gap-[10px] mb-[15px]">
                <span className="text-[14px] text-white font-medium">
                  חודש {new Date().toLocaleDateString("he-IL", { month: "long", year: "numeric" })}
                </span>
              </div>

              <div className="flex flex-col gap-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-white/80">צפי תאריך התשלום</span>
                  <span className="text-[14px] text-white font-medium ltr-num">
                    {supplierDetailData?.monthlyData.expectedPaymentDate || "-"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-white/80">סך הרכישות מהספק (כולל מע&quot;מ)</span>
                  <span className="text-[14px] text-white font-medium ltr-num">
                    ₪{(supplierDetailData?.monthlyData.monthlyPurchases || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-white/80">שולם בגין החודש הנבחר</span>
                  <span className="text-[14px] text-white font-medium ltr-num">
                    ₪{(supplierDetailData?.monthlyData.monthlyPaid || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-white/20 pt-[10px]">
                  <span className="text-[13px] text-[#3F97FF] font-medium">להוציא תשלום לספק ע&quot;ס</span>
                  <span className="text-[16px] text-[#3F97FF] font-bold ltr-num">
                    ₪{(supplierDetailData?.monthlyData.amountToPay || 0).toLocaleString(undefined, { minimumFractionDigits: 1 })}
                  </span>
                </div>
              </div>

              {/* Payment Button */}
              <button
                type="button"
                className="w-full mt-[15px] bg-[#29318A] text-white text-[16px] font-semibold py-[12px] rounded-[10px] hover:bg-[#3D44A0] transition-colors"
              >
                לתשלום
              </button>
            </div>

            {/* Tabs Section - חשבוניות פתוחות / תשלומים שבוצעו */}
            <div className="mt-[15px] flex flex-col gap-[10px]">
              {/* Tab Buttons */}
              <div className="flex w-full h-[40px] border border-[#6B6B6B] rounded-[7px] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setDetailActiveTab("invoices")}
                  className={`flex-1 flex items-center justify-center transition-colors duration-200 ${
                    detailActiveTab === "invoices"
                      ? "bg-[#29318A] text-white"
                      : "text-[#979797]"
                  }`}
                >
                  <span className="text-[14px] font-bold">חשבוניות פתוחות</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDetailActiveTab("payments")}
                  className={`flex-1 flex items-center justify-center transition-colors duration-200 ${
                    detailActiveTab === "payments"
                      ? "bg-[#29318A] text-white"
                      : "text-[#979797]"
                  }`}
                >
                  <span className="text-[14px] font-bold">תשלומים שבוצעו</span>
                </button>
              </div>

              {/* Invoices Table */}
              {detailActiveTab === "invoices" && (
                <div className="w-full flex flex-col gap-[5px]">
                  {/* Table Header */}
                  <div className="grid grid-cols-[0.8fr_1fr_0.9fr_0.8fr] bg-white/5 rounded-t-[7px] p-[10px_5px] items-center">
                    <span className="text-[13px] font-medium text-center">תאריך</span>
                    <span className="text-[13px] font-medium text-center">אסמכתא</span>
                    <span className="text-[13px] font-medium text-center">סכום</span>
                    <span className="text-[13px] font-medium text-center">סטטוס</span>
                  </div>

                  {/* Table Rows */}
                  <div className="max-h-[200px] overflow-y-auto flex flex-col gap-[5px]">
                    {supplierInvoices.length === 0 ? (
                      <div className="flex items-center justify-center py-[30px]">
                        <span className="text-[14px] text-white/50">אין חשבוניות להצגה</span>
                      </div>
                    ) : (
                      supplierInvoices.map((invoice) => (
                        <div
                          key={invoice.id}
                          className="bg-white/5 rounded-[7px] p-[7px_3px]"
                        >
                          <div className="grid grid-cols-[0.8fr_1fr_0.9fr_0.8fr] w-full p-[5px_5px] items-center">
                            {/* Date */}
                            <span className="text-[12px] text-center ltr-num">{invoice.date}</span>
                            {/* Reference */}
                            <span className="text-[12px] text-center ltr-num truncate px-[2px]">{invoice.reference}</span>
                            {/* Amount */}
                            <span className="text-[12px] text-center ltr-num font-medium">
                              ₪{invoice.amount.toLocaleString()}
                            </span>
                            {/* Status */}
                            <div className="flex justify-center">
                              <span className={`text-[11px] font-bold px-[10px] py-[4px] rounded-full ${
                                invoice.status === "שולם"
                                  ? "bg-[#00E096]"
                                  : invoice.status === "בבירור"
                                  ? "bg-[#FFA500]"
                                  : "bg-[#29318A]"
                              }`}>
                                {invoice.status}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Payments Table */}
              {detailActiveTab === "payments" && (
                <div className="w-full flex flex-col gap-[5px]">
                  {/* Table Header */}
                  <div className="grid grid-cols-[0.8fr_1fr_0.9fr_0.8fr] bg-white/5 rounded-t-[7px] p-[10px_5px] items-center">
                    <span className="text-[13px] font-medium text-center">תאריך</span>
                    <span className="text-[13px] font-medium text-center">אמצעי</span>
                    <span className="text-[13px] font-medium text-center">סכום</span>
                    <span className="text-[13px] font-medium text-center">אסמכתא</span>
                  </div>

                  {/* Table Rows */}
                  <div className="max-h-[200px] overflow-y-auto flex flex-col gap-[5px]">
                    {supplierPayments.length === 0 ? (
                      <div className="flex items-center justify-center py-[30px]">
                        <span className="text-[14px] text-white/50">אין תשלומים להצגה</span>
                      </div>
                    ) : (
                      supplierPayments.map((payment) => (
                        <div
                          key={payment.id}
                          className="bg-white/5 rounded-[7px] p-[7px_3px]"
                        >
                          <div className="grid grid-cols-[0.8fr_1fr_0.9fr_0.8fr] w-full p-[5px_5px] items-center">
                            {/* Date */}
                            <span className="text-[12px] text-center ltr-num">{payment.date}</span>
                            {/* Payment Method */}
                            <span className="text-[12px] text-center leading-tight">{payment.method}</span>
                            {/* Amount */}
                            <span className="text-[12px] text-center ltr-num font-medium">
                              ₪{payment.amount.toLocaleString()}
                            </span>
                            {/* Reference */}
                            <span className="text-[12px] text-center ltr-num truncate px-[2px]">{payment.reference}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          )}
        </SheetContent>
      </Sheet>
      {/* Obligation Detail Popup */}
      <Sheet open={showObligationDetailPopup && !!selectedSupplier} onOpenChange={(open) => {
        if (!open) {
          setShowObligationDetailPopup(false);
          setSelectedSupplier(null);
          setObligationPayments([]);
        }
      }}>
        <SheetContent
          side="bottom"
          className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0F1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
          showCloseButton={false}
        >
          {selectedSupplier && (() => {
            // Generate payment schedule
            const numPayments = selectedSupplier.obligation_num_payments || 0;
            const monthlyAmount = selectedSupplier.obligation_monthly_amount || 0;
            const firstChargeDate = selectedSupplier.obligation_first_charge_date
              ? new Date(selectedSupplier.obligation_first_charge_date)
              : null;

            const schedule = Array.from({ length: numPayments }, (_, i) => {
              let paymentDate: Date | null = null;
              if (firstChargeDate) {
                paymentDate = new Date(firstChargeDate);
                paymentDate.setMonth(paymentDate.getMonth() + i);
              }
              // Check if this installment is paid by matching with actual payments
              const isPaid = paymentDate ? obligationPayments.some(p => {
                const pDate = new Date(p.date);
                return pDate.getFullYear() === paymentDate!.getFullYear() &&
                       pDate.getMonth() === paymentDate!.getMonth();
              }) : false;

              return {
                number: i + 1,
                amount: monthlyAmount,
                date: paymentDate,
                isPaid,
              };
            });

            const paidCount = schedule.filter(s => s.isPaid).length;
            const totalPaid = obligationPayments.reduce((sum, p) => sum + p.amount, 0);
            const remainingAmount = (selectedSupplier.obligation_total_amount || 0) - totalPaid;

            const formatDate = (d: Date | null) => {
              if (!d) return "-";
              return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
            };

            return (
              <div className="flex flex-col gap-[5px] p-[10px]">
                {/* Header Row - Close + Delete */}
                <div className="flex items-center gap-[5px] justify-end">
                  <button
                    type="button"
                    title="סגור"
                    onClick={() => {
                      setShowObligationDetailPopup(false);
                      setSelectedSupplier(null);
                      setObligationPayments([]);
                    }}
                    className="w-[25px] h-[25px] flex items-center justify-center text-white cursor-pointer"
                  >
                    <X size={20} />
                  </button>
                  <button
                    type="button"
                    title="מחיקה"
                    onClick={async () => {
                      if (!confirm("האם למחוק את הספק?")) return;
                      const supabase = createClient();
                      await supabase
                        .from("suppliers")
                        .update({ deleted_at: new Date().toISOString() })
                        .eq("id", selectedSupplier.id);
                      setShowObligationDetailPopup(false);
                      setSelectedSupplier(null);
                      setObligationPayments([]);
                      showToast("הספק נמחק בהצלחה", "success");
                      setRefreshTrigger(prev => prev + 1);
                    }}
                    className="w-[25px] h-[25px] flex items-center justify-center text-white cursor-pointer"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      <line x1="10" y1="11" x2="10" y2="17"/>
                      <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                  </button>
                </div>

                {/* Scrollable content */}
                <div className="flex flex-col gap-[10px] overflow-y-auto flex-1">
                  {/* שם הספק */}
                  <div className="flex flex-col gap-[3px]">
                    <span className="text-[15px] font-medium text-white text-right">שם הספק</span>
                    <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center">
                      <input
                        type="text"
                        title="שם הספק"
                        disabled
                        value={selectedSupplier.name}
                        className="w-full h-full bg-transparent text-white text-[14px] text-center outline-none px-[10px]"
                      />
                    </div>
                  </div>

                  {/* סכום שנלקח */}
                  <div className="flex flex-col gap-[3px]">
                    <span className="text-[15px] font-medium text-white text-right">סכום שנלקח</span>
                    <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center px-[10px]">
                      <input
                        type="text"
                        title="סכום שנלקח"
                        disabled
                        value={selectedSupplier.obligation_total_amount ? `₪${selectedSupplier.obligation_total_amount.toLocaleString()}` : "-"}
                        className="w-full h-full bg-transparent text-white text-[14px] text-center outline-none"
                      />
                    </div>
                  </div>

                  {/* תנאים */}
                  <div className="flex flex-col gap-[3px]">
                    <span className="text-[15px] font-medium text-white text-right">תנאים</span>
                    <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center px-[10px]">
                      <input
                        type="text"
                        title="תנאים"
                        disabled
                        value={selectedSupplier.obligation_terms || "-"}
                        className="w-full h-full bg-transparent text-white text-[14px] text-center outline-none"
                      />
                    </div>
                  </div>

                  {/* כמות תשלומים */}
                  <div className="flex flex-col gap-[3px]">
                    <span className="text-[15px] font-medium text-white text-right">כמות תשלומים</span>
                    <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center">
                      <span className="text-[14px] text-white">{numPayments}</span>
                    </div>
                  </div>

                  {/* סכום חיוב חודשי כולל ריבית (משוער) */}
                  <div className="flex flex-col gap-[3px]">
                    <span className="text-[15px] font-medium text-white text-right">סכום חיוב חודשי כולל ריבית (משוער)</span>
                    <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center px-[10px]">
                      <input
                        type="text"
                        title="סכום חיוב חודשי"
                        disabled
                        value={monthlyAmount ? `₪${monthlyAmount.toLocaleString()}` : "-"}
                        className="w-full h-full bg-transparent text-white text-[14px] text-center outline-none"
                      />
                    </div>
                  </div>

                  {/* תאריך חיוב ראשון */}
                  <div className="flex flex-col gap-[3px]">
                    <span className="text-[15px] font-medium text-white text-right">תאריך חיוב ראשון</span>
                    <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-between px-[10px]">
                      <input
                        type="text"
                        title="תאריך חיוב ראשון"
                        disabled
                        value={firstChargeDate ? formatDate(firstChargeDate) : "-"}
                        className="w-full h-full bg-transparent text-white text-[14px] text-center outline-none font-semibold"
                      />
                      <svg width="24" height="24" viewBox="0 0 32 32" fill="none" className="text-[#979797] flex-shrink-0">
                        <rect x="4" y="6" width="24" height="22" rx="3" stroke="currentColor" strokeWidth="2"/>
                        <line x1="4" y1="12" x2="28" y2="12" stroke="currentColor" strokeWidth="2"/>
                        <line x1="10" y1="3" x2="10" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <line x1="22" y1="3" x2="22" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </div>
                  </div>

                  {/* Payment Schedule */}
                  <div className="flex flex-col gap-[10px]">
                    {schedule.map((payment) => (
                      <div key={payment.number} className="flex flex-col gap-[3px]">
                        <span className="text-[15px] font-medium text-white text-right">תשלום {payment.number}</span>
                        <div className="flex items-center gap-[10px]">
                          {/* Amount */}
                          <div className={`flex-1 border rounded-[10px] h-[50px] flex items-center justify-center ${
                            payment.isPaid ? 'border-[#00E096]' : 'border-[#4C526B]'
                          }`}>
                            <input
                              type="text"
                              title={`סכום תשלום ${payment.number}`}
                              disabled
                              value={payment.amount ? `₪${payment.amount.toLocaleString()}` : "-"}
                              className="w-full h-full bg-transparent text-white text-[14px] text-center outline-none"
                            />
                          </div>
                          {/* Date */}
                          <div className={`flex-1 border rounded-[10px] h-[50px] flex items-center justify-center ${
                            payment.isPaid ? 'border-[#00E096]' : 'border-[#4C526B]'
                          }`}>
                            <input
                              type="text"
                              title={`תאריך תשלום ${payment.number}`}
                              disabled
                              value={formatDate(payment.date)}
                              className="w-full h-full bg-transparent text-white text-[14px] text-center outline-none font-semibold"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Summary - תשלומים שבוצעו + נותר לתשלום */}
                  <div className="bg-[#29318A]/30 rounded-[10px] p-[15px] flex flex-col gap-[10px]">
                    <div className="flex items-center justify-between">
                      <span className="text-[14px] text-white">תשלומים שבוצעו</span>
                      <span className="text-[16px] text-white font-bold ltr-num">{paidCount} / {numPayments}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[14px] text-white">סה&quot;כ שולם</span>
                      <span className="text-[16px] text-white font-bold ltr-num">₪{totalPaid.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-white/20 pt-[10px]">
                      <span className="text-[14px] text-[#F64E60] font-medium">נותר לתשלום</span>
                      <span className="text-[18px] text-[#F64E60] font-bold ltr-num">₪{Math.max(0, remainingAmount).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* תמונה/לוח סילוקין */}
                  <div className="flex flex-col gap-[3px]">
                    <span className="text-[15px] font-medium text-white text-right">תמונה / לוח סילוקין</span>
                    {selectedSupplier.obligation_document_url ? (
                      <div className="flex flex-col gap-[5px]">
                        <a
                          href={selectedSupplier.obligation_document_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="border border-[#4C526B] rounded-[10px] overflow-hidden flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={selectedSupplier.obligation_document_url}
                            alt="לוח סילוקין"
                            className="max-h-[200px] object-contain"
                          />
                        </a>
                        {/* Replace image button */}
                        <label className="flex items-center justify-center gap-[5px] text-[13px] text-white/60 hover:text-white cursor-pointer transition-colors">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                          </svg>
                          החלפת תמונה
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              setIsUploadingObligationDoc(true);
                              try {
                                const fileExt = file.name.split(".").pop();
                                const fileName = `${crypto.randomUUID()}.${fileExt}`;
                                const filePath = `supplier-obligations/${selectedSupplier.business_id}/${fileName}`;
                                const result = await uploadFile(file, filePath, "assets");
                                if (result.success && result.publicUrl) {
                                  const supabase = createClient();
                                  await supabase
                                    .from("suppliers")
                                    .update({ obligation_document_url: result.publicUrl })
                                    .eq("id", selectedSupplier.id);
                                  setSelectedSupplier({ ...selectedSupplier, obligation_document_url: result.publicUrl });
                                  showToast("התמונה עודכנה בהצלחה", "success");
                                } else {
                                  showToast("שגיאה בהעלאת הקובץ", "error");
                                }
                              } catch {
                                showToast("שגיאה בהעלאת הקובץ", "error");
                              } finally {
                                setIsUploadingObligationDoc(false);
                                e.target.value = "";
                              }
                            }}
                          />
                        </label>
                      </div>
                    ) : (
                      <label className={`border border-dashed border-[#4C526B] rounded-[10px] h-[80px] flex flex-col items-center justify-center gap-[5px] cursor-pointer hover:bg-white/5 transition-colors ${isUploadingObligationDoc ? 'opacity-50 pointer-events-none' : ''}`}>
                        {isUploadingObligationDoc ? (
                          <span className="text-[14px] text-white/60">מעלה...</span>
                        ) : (
                          <>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                              <polyline points="17 8 12 3 7 8"/>
                              <line x1="12" y1="3" x2="12" y2="15"/>
                            </svg>
                            <span className="text-[14px] text-white/40">לחץ להעלאת תמונה</span>
                          </>
                        )}
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setIsUploadingObligationDoc(true);
                            try {
                              const fileExt = file.name.split(".").pop();
                              const fileName = `${crypto.randomUUID()}.${fileExt}`;
                              const filePath = `supplier-obligations/${selectedSupplier.business_id}/${fileName}`;
                              const result = await uploadFile(file, filePath, "assets");
                              if (result.success && result.publicUrl) {
                                const supabase = createClient();
                                await supabase
                                  .from("suppliers")
                                  .update({ obligation_document_url: result.publicUrl })
                                  .eq("id", selectedSupplier.id);
                                setSelectedSupplier({ ...selectedSupplier, obligation_document_url: result.publicUrl });
                                showToast("התמונה הועלתה בהצלחה", "success");
                              } else {
                                showToast("שגיאה בהעלאת הקובץ", "error");
                              }
                            } catch {
                              showToast("שגיאה בהעלאת הקובץ", "error");
                            } finally {
                              setIsUploadingObligationDoc(false);
                              e.target.value = "";
                            }
                          }}
                        />
                      </label>
                    )}
                  </div>

                  {/* Exit Button */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowObligationDetailPopup(false);
                      setSelectedSupplier(null);
                      setObligationPayments([]);
                    }}
                    className="w-full bg-[#29318A] text-white text-[18px] font-semibold py-[14px] rounded-[10px] hover:bg-[#3D44A0] transition-colors mt-[5px]"
                  >
                    יציאה
                  </button>
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
