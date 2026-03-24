"use client";

import { createPortal } from "react-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { ChevronLeft, ChevronRight, X, Send } from "lucide-react";
import { useDashboard } from "../layout";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { useToast } from "@/components/ui/toast";
import { uploadFile } from "@/lib/uploadFile";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useFormDraft } from "@/hooks/useFormDraft";
import { generateUUID } from "@/lib/utils";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DatePickerField } from "@/components/ui/date-picker-field";

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
  parent_category_id?: string;
  expense_nature?: string;
  payment_terms_days?: number;
  vat_type?: string;
  is_fixed_expense?: boolean;
  charge_day?: number;
  monthly_expense_amount?: number;
  default_payment_method?: string;
  default_credit_card_id?: string;
  notes?: string;
  document_url?: string;
  has_previous_obligations?: boolean;
  waiting_for_coordinator?: boolean;
  is_active?: boolean;
  email?: string;
  request_karteset?: boolean;
  // Obligation fields (for previous obligations / loans)
  obligation_total_amount?: number;
  obligation_monthly_amount?: number;
  obligation_num_payments?: number;
  obligation_first_charge_date?: string;
  obligation_terms?: string;
  obligation_document_url?: string;
}

// Supplier document type from database
interface SupplierDocument {
  id: string;
  supplier_id: string;
  business_id: string;
  description: string;
  document_url: string;
  created_at: string;
}

// Supplier with balance info for display
interface SupplierWithBalance extends Supplier {
  remainingPayment: number;
  revenuePercentage: number;
}

// Prior commitment from DB table
interface PriorCommitmentRow {
  id: string;
  name: string;
  monthly_amount: number;
  total_installments: number;
  start_date: string;
  end_date: string;
}

type TabType = "previous" | "current" | "purchases" | "employees";

// Parse attachment_url: supports both single URL string and JSON array of URLs
function parseAttachmentUrls(raw: string | null): string[] {
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try { return JSON.parse(raw).filter((u: unknown) => typeof u === "string" && u); } catch { return []; }
  }
  return [raw];
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|$)/i.test(url);
}

export default function SuppliersPage() {
  const { selectedBusinesses } = useDashboard();
  const { showToast } = useToast();
  const router = useRouter();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Draft persistence for add/edit supplier form
  const supplierDraftKey = `supplierForm:draft:${selectedBusinesses[0] || "none"}`;
  const { saveDraft: saveSupplierDraft, restoreDraft: restoreSupplierDraft, clearDraft: clearSupplierDraft, resetCleared: resetSupplierDraftCleared } = useFormDraft(supplierDraftKey);
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

  // Prior commitments data (for "previous" tab)
  const [priorCommitments, setPriorCommitments] = useState<PriorCommitmentRow[]>([]);
  const [isAddCommitmentOpen, setIsAddCommitmentOpen] = useState(false);
  const [selectedCommitment, setSelectedCommitment] = useState<PriorCommitmentRow | null>(null);
  const [showCommitmentDetail, setShowCommitmentDetail] = useState(false);
  // Add commitment form fields
  const [commitmentName, setCommitmentName] = useState("");
  const [commitmentMonthlyAmount, setCommitmentMonthlyAmount] = useState("");
  const [commitmentTotalInstallments, setCommitmentTotalInstallments] = useState("");
  const [commitmentStartDate, setCommitmentStartDate] = useState("");
  const [commitmentEndDate, setCommitmentEndDate] = useState("");
  const [commitmentTerms, setCommitmentTerms] = useState("");
  const [isSubmittingCommitment, setIsSubmittingCommitment] = useState(false);

  // Categories from database
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [parentCategories, setParentCategories] = useState<ExpenseCategory[]>([]);

  // Credit cards from database
  const [businessCreditCards, setBusinessCreditCards] = useState<{ id: string; card_name: string; last_four_digits: string | null }[]>([]);

  // Supplier detail popup state
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierWithBalance | null>(null);
  const [showSupplierDetailPopup, setShowSupplierDetailPopup] = useState(false);
  const [viewerDocUrl, setViewerDocUrl] = useState<string | null>(null);
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
  const [detailMonth, setDetailMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [monthlyBreakdown, setMonthlyBreakdown] = useState<Array<{
    month: string;
    purchases: number;
    paid: number;
    amountToPay: number;
  }>>([]);
  const [detailActiveTab, setDetailActiveTab] = useState<"invoices" | "payments" | "documents">("invoices");
  const [supplierInvoices, setSupplierInvoices] = useState<Array<{
    id: string;
    date: string;
    reference: string;
    amount: number;
    amountWithVat: number;
    amountBeforeVat: number;
    status: string;
    notes: string;
    clarificationReason: string | null;
    attachmentUrls: string[];
    enteredBy: string;
    entryDate: string;
    linkedPayments: { id: string; amount: number; method: string; installments: string; date: string; receiptUrl: string | null; notes: string | null }[];
  }>>([]);
  const [expandedSupplierInvoiceId, setExpandedSupplierInvoiceId] = useState<string | null>(null);
  const [expandedSupplierPaymentId, setExpandedSupplierPaymentId] = useState<string | null>(null);
  const [showLinkedPayments, setShowLinkedPayments] = useState<string | null>(null);
  const [supplierPayments, setSupplierPayments] = useState<Array<{
    id: string;
    date: string;
    method: string;
    amount: number;
    totalAmount: number;
    subtotal: number;
    reference: string;
    notes: string | null;
    receiptUrl: string | null;
    linkedInvoice: { id: string; invoiceNumber: string | null; date: string; totalAmount: number; attachmentUrl: string | null } | null;
    rawSplits: Array<{ id: string; payment_method: string; amount: number; installments_count: number | null; installment_number: number | null; due_date: string | null; check_number: string | null; reference_number: string | null }>;
  }>>([]);

  // Obligation detail popup state
  const [showObligationDetailPopup, setShowObligationDetailPopup] = useState(false);
  const [obligationPayments, setObligationPayments] = useState<Array<{
    id: string;
    date: string;
    amount: number;
  }>>([]);
  const [isUploadingObligationDoc, setIsUploadingObligationDoc] = useState(false);

  // Supplier documents state
  const [supplierDocuments, setSupplierDocuments] = useState<SupplierDocument[]>([]);
  const [newDocDescription, setNewDocDescription] = useState("");
  const [newDocFile, setNewDocFile] = useState<File | null>(null);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [viewDocumentUrl, setViewDocumentUrl] = useState<string | null>(null);

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
  const [isSupplierActive, setIsSupplierActive] = useState(true);
  const [chargeDay, setChargeDay] = useState("");
  const [monthlyExpenseAmount, setMonthlyExpenseAmount] = useState("");
  const [primaryPaymentMethod, setPrimaryPaymentMethod] = useState("");
  const [selectedCreditCardId, setSelectedCreditCardId] = useState("");
  const [fixedNote, setFixedNote] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [requestKarteset, setRequestKarteset] = useState(false);
  const [isSendingKarteset, setIsSendingKarteset] = useState(false);
  const [showKartesetPeriodPicker, setShowKartesetPeriodPicker] = useState(false);
  const [kartesetPeriodMonth, setKartesetPeriodMonth] = useState(() => new Date().getMonth());
  const [kartesetPeriodYear, setKartesetPeriodYear] = useState(() => new Date().getFullYear());
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
      primaryPaymentMethod, selectedCreditCardId, fixedNote,
      supplierEmail, requestKarteset,
    });
  }, [saveSupplierDraft, isAddSupplierModalOpen, isEditingSupplier,
    supplierName, hasPreviousObligations, waitingForCoordinator,
    obligationTotalAmount, obligationTerms, obligationFirstChargeDate,
    obligationNumPayments, obligationMonthlyAmount,
    expenseType, category, parentCategory, paymentTerms,
    vatRequired, isFixedExpense, chargeDay, monthlyExpenseAmount,
    primaryPaymentMethod, selectedCreditCardId, fixedNote,
    supplierEmail, requestKarteset]);

  useEffect(() => {
    if (supplierDraftRestored.current) {
      saveSupplierDraftData();
    }
  }, [saveSupplierDraftData]);

  // Restore supplier draft when modal opens (only for new, not edit)
  useEffect(() => {
    if (isAddSupplierModalOpen && !isEditingSupplier) {
      resetSupplierDraftCleared();
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
          if (draft.selectedCreditCardId) setSelectedCreditCardId(draft.selectedCreditCardId as string);
          if (draft.fixedNote) setFixedNote(draft.fixedNote as string);
          if (draft.supplierEmail) setSupplierEmail(draft.supplierEmail as string);
          if (draft.requestKarteset !== undefined) setRequestKarteset(draft.requestKarteset as boolean);
        }
        supplierDraftRestored.current = true;
      }, 0);
    } else if (isEditingSupplier) {
      supplierDraftRestored.current = true;
    }
  }, [isAddSupplierModalOpen, isEditingSupplier, restoreSupplierDraft, resetSupplierDraftCleared]);

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
        .order("is_active", { ascending: false, nullsFirst: false })
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

      // Fetch current month invoices per supplier (for monthly_expense_amount check)
      const now = new Date();
      const currentYear = now.getFullYear();
      const monthStart = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const monthEnd = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}-${new Date(currentYear, now.getMonth() + 1, 0).getDate()}`;
      const yearStart = `${currentYear}-01-01`;
      const yearEnd = `${currentYear}-12-31`;
      const supplierIds = (suppliersData || []).map((s: Record<string, unknown>) => s.id);

      // Fetch current month invoices (for monthly_expense_amount check)
      const { data: monthlyInvoicesData } = supplierIds.length > 0
        ? await supabase
            .from("invoices")
            .select("supplier_id, total_amount")
            .in("supplier_id", supplierIds)
            .is("deleted_at", null)
            .gte("invoice_date", monthStart)
            .lte("invoice_date", monthEnd)
        : { data: [] };

      // Sum current month invoices per supplier (for monthly_expense check)
      const supplierMonthlyPurchases = new Map<string, number>();
      for (const inv of monthlyInvoicesData || []) {
        const prev = supplierMonthlyPurchases.get(inv.supplier_id) || 0;
        supplierMonthlyPurchases.set(inv.supplier_id, prev + Number(inv.total_amount));
      }

      // Fetch yearly invoices per supplier (total_amount = with VAT) for revenue percentage
      const { data: yearlyInvoicesData } = supplierIds.length > 0
        ? await supabase
            .from("invoices")
            .select("supplier_id, total_amount")
            .in("supplier_id", supplierIds)
            .is("deleted_at", null)
            .gte("invoice_date", yearStart)
            .lte("invoice_date", yearEnd)
        : { data: [] };

      // Sum yearly invoices per supplier
      const supplierYearlyPurchases = new Map<string, number>();
      for (const inv of yearlyInvoicesData || []) {
        const prev = supplierYearlyPurchases.get(inv.supplier_id) || 0;
        supplierYearlyPurchases.set(inv.supplier_id, prev + Number(inv.total_amount));
      }

      // Fetch all revenue targets for current year per business (all months)
      const { data: goalsData } = await supabase
        .from("goals")
        .select("business_id, revenue_target")
        .in("business_id", selectedBusinesses)
        .eq("year", currentYear)
        .is("deleted_at", null);

      // Sum yearly revenue targets per business
      const revenueTargetMap = new Map<string, number>();
      for (const g of goalsData || []) {
        const prev = revenueTargetMap.get(g.business_id) || 0;
        revenueTargetMap.set(g.business_id, prev + (Number(g.revenue_target) || 0));
      }

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
          // Negative = overpaid (show as green), Positive = owes (show as red)
          remainingPayment = balance?.balance || 0;
        }

        // For suppliers with monthly_expense_amount, add current month expected expense
        // if no invoice exists yet for the current month
        if (supplier.monthly_expense_amount && Number(supplier.monthly_expense_amount) > 0) {
          const hasCurrentMonthInvoice = supplierMonthlyPurchases.has(supplier.id);
          if (!hasCurrentMonthInvoice) {
            remainingPayment += Number(supplier.monthly_expense_amount);
          }
        }

        // Calculate revenue percentage: (yearly purchases with VAT / yearly revenue target with VAT) * 100
        const yearlyPurchases = supplierYearlyPurchases.get(supplier.id) || 0;
        const yearlyRevenueTarget = revenueTargetMap.get(supplier.business_id) || 0;
        const revenuePercentage = yearlyRevenueTarget > 0 ? (yearlyPurchases / yearlyRevenueTarget) * 100 : 0;

        return {
          ...supplier,
          remainingPayment,
          revenuePercentage,
        };
      });

      setSuppliers(suppliersWithBalance);
      setIsLoading(false);
    }

    fetchSuppliers();
  }, [selectedBusinesses, refreshTrigger]);

  // Fetch prior commitments from database
  useEffect(() => {
    async function fetchPriorCommitments() {
      if (selectedBusinesses.length === 0) {
        setPriorCommitments([]);
        return;
      }
      const supabase = createClient();
      const { data, error } = await supabase
        .from("prior_commitments")
        .select("id, name, monthly_amount, total_installments, start_date, end_date")
        .in("business_id", selectedBusinesses)
        .is("deleted_at", null)
        .order("end_date", { ascending: true });

      if (error) {
        console.error("Error fetching prior commitments:", error);
        return;
      }
      setPriorCommitments(data || []);
    }
    fetchPriorCommitments();
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

  // Fetch credit cards from database
  useEffect(() => {
    async function fetchCreditCards() {
      if (selectedBusinesses.length === 0) {
        setBusinessCreditCards([]);
        return;
      }
      const supabase = createClient();
      const { data } = await supabase
        .from("business_credit_cards")
        .select("id, card_name, last_four_digits")
        .in("business_id", selectedBusinesses)
        .eq("is_active", true)
        .order("card_name");
      if (data) setBusinessCreditCards(data);
    }
    fetchCreditCards();
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
    setSelectedCreditCardId("");
    setFixedNote("");
    setAttachedFile(null);
    setSupplierEmail("");
    setRequestKarteset(false);
    setIsAddingCategory(false);
    setIsAddingParentCategory(false);
    setNewCategoryName("");
    setNewParentCategoryName("");
    // Reset edit mode
    setIsEditingSupplier(false);
    setEditingSupplierData(null);
    setIsSupplierActive(true);
  };

  // Handle edit supplier - fills form with existing data
  const handleEditSupplier = () => {
    if (!selectedSupplier) return;

    setEditingSupplierData(selectedSupplier);
    setIsEditingSupplier(true);

    // Fill form with existing data
    setSupplierName(selectedSupplier.name);
    setExpenseType(selectedSupplier.expense_type === "current_expenses" ? "current" : selectedSupplier.expense_type === "goods_purchases" ? "goods" : "employees");
    setParentCategory(selectedSupplier.parent_category_id || "");
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
    setSelectedCreditCardId(selectedSupplier.default_credit_card_id || "");
    setFixedNote(selectedSupplier.notes || "");
    setHasPreviousObligations(selectedSupplier.has_previous_obligations || false);
    setWaitingForCoordinator(selectedSupplier.waiting_for_coordinator || false);
    setIsSupplierActive(selectedSupplier.is_active !== false);
    setSupplierEmail(selectedSupplier.email || "");
    setRequestKarteset(selectedSupplier.request_karteset || false);

    // Close detail popup and open add/edit modal
    setShowSupplierDetailPopup(false);
    setIsAddSupplierModalOpen(true);
  };

  // Handle open karteset period picker
  const handleOpenKartesetPicker = () => {
    const now = new Date();
    setKartesetPeriodMonth(now.getMonth());
    setKartesetPeriodYear(now.getFullYear());
    setShowKartesetPeriodPicker(true);
  };

  // Handle send karteset email on-demand
  const handleSendKartesetEmail = async () => {
    if (!selectedSupplier || !selectedSupplier.email) return;
    setIsSendingKarteset(true);
    setShowKartesetPeriodPicker(false);
    try {
      const res = await fetch("/api/suppliers/send-karteset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: selectedSupplier.id,
          businessId: selectedSupplier.business_id,
          month: kartesetPeriodMonth,
          year: kartesetPeriodYear,
        }),
      });
      if (!res.ok) throw new Error("Failed to send");
      showToast("מייל בקשת כרטסת נשלח בהצלחה", "success");
    } catch {
      showToast("שגיאה בשליחת המייל", "warning");
    } finally {
      setIsSendingKarteset(false);
    }
  };

  // Handle invoice status change from supplier detail
  const handleInvoiceStatusChange = async (invoiceId: string, currentStatus: string) => {
    // Cycle: ממתין → שולם → בבירור → ממתין
    const statusMap: Record<string, string> = {
      "ממתין": "paid",
      "שולם": "clarification",
      "בבירור": "pending",
    };
    const displayMap: Record<string, string> = {
      "paid": "שולם",
      "clarification": "בבירור",
      "pending": "ממתין",
    };
    const newDbStatus = statusMap[currentStatus] || "pending";
    const newDisplayStatus = displayMap[newDbStatus] || "ממתין";

    const supabase = createClient();
    const { error } = await supabase
      .from("invoices")
      .update({ status: newDbStatus })
      .eq("id", invoiceId);

    if (error) {
      showToast("שגיאה בעדכון סטטוס", "error");
      return;
    }

    // Update local state
    setSupplierInvoices(prev => prev.map(inv =>
      inv.id === invoiceId ? { ...inv, status: newDisplayStatus } : inv
    ));
    showToast(`סטטוס עודכן ל-${newDisplayStatus}`, "success");
  };

  // Handle delete supplier (soft delete) - only if no invoices or payments exist
  const handleDeleteSupplier = async () => {
    if (!selectedSupplier) return;

    // Check if supplier has any invoices or payments
    if (supplierInvoices.length > 0 || supplierPayments.length > 0) {
      showToast("לא ניתן למחוק ספק עם חשבוניות או תשלומים", "warning");
      return;
    }

    confirm("האם למחוק את הספק?", async () => {
      const supabase = createClient();
      try {
        const { error } = await supabase
          .from("suppliers")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", selectedSupplier.id);

        if (error) throw error;

        showToast("הספק נמחק בהצלחה", "success");
        setShowSupplierDetailPopup(false);
        setSelectedSupplier(null);
        setRefreshTrigger(prev => prev + 1);
      } catch (error) {
        console.error("Error deleting supplier:", error);
        showToast("שגיאה במחיקת הספק", "error");
      }
    });
  };

  // Handle update supplier
  const handleUpdateSupplier = async () => {
    if (!editingSupplierData || !supplierName.trim()) {
      showToast("יש להזין שם ספק", "warning");
      return;
    }

    if (supplierEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplierEmail.trim())) {
      showToast("כתובת מייל לא תקינה", "warning");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();

    try {
      // Check if trying to deactivate supplier with open invoices
      if (editingSupplierData.is_active !== false && !isSupplierActive) {
        const { data: openInvoices } = await supabase
          .from("invoices")
          .select("id")
          .eq("supplier_id", editingSupplierData.id)
          .in("status", ["pending", "clarification"])
          .is("deleted_at", null)
          .limit(1);

        if (openInvoices && openInvoices.length > 0) {
          showToast("לא ניתן לעדכן סטטוס לספק עם יתרה פתוחה", "warning");
          setIsSubmitting(false);
          return;
        }
      }

      // Upload document if provided
      let documentUrl: string | null = editingSupplierData.document_url || null;
      if (attachedFile) {
        const fileExt = attachedFile.name.split(".").pop();
        const fileName = `${generateUUID()}.${fileExt}`;
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

      // Auto-assign parent category if not manually selected
      let resolvedParentCategoryUpdate = parentCategory || null;
      if (!resolvedParentCategoryUpdate && parentCategories.length > 0) {
        const bizId = selectedBusinesses[0];
        const bizParents = parentCategories.filter(p => p.business_id === bizId);
        if (expenseType === "goods") {
          resolvedParentCategoryUpdate = bizParents.find(p => p.name === "עלות מכר")?.id || null;
        } else if (expenseType === "employees") {
          resolvedParentCategoryUpdate = bizParents.find(p => p.name === "עלויות עובדים" || p.name === "עלות עובדים")?.id || null;
        }
      }

      // Update supplier record
      const { error: updateError } = await supabase
        .from("suppliers")
        .update({
          name: supplierName.trim(),
          expense_type: expenseType === "current" ? "current_expenses" : expenseType === "goods" ? "goods_purchases" : "employee_costs",
          expense_category_id: category || null,
          parent_category_id: resolvedParentCategoryUpdate,
          payment_terms_days: paymentTerms ? parseInt(paymentTerms) : 30,
          vat_type: vatTypeMap[vatRequired],
          requires_vat: vatRequired !== "no",
          is_fixed_expense: isFixedExpense,
          charge_day: chargeDay ? parseInt(chargeDay) : null,
          monthly_expense_amount: monthlyExpenseAmount ? parseFloat(monthlyExpenseAmount) : null,
          default_payment_method: primaryPaymentMethod || null,
          default_credit_card_id: primaryPaymentMethod === "credit" && selectedCreditCardId ? selectedCreditCardId : null,
          notes: fixedNote || null,
          document_url: documentUrl,
          has_previous_obligations: hasPreviousObligations,
          waiting_for_coordinator: waitingForCoordinator,
          is_active: isSupplierActive,
          email: supplierEmail.trim() || null,
          request_karteset: supplierEmail.trim() ? requestKarteset : false,
        })
        .eq("id", editingSupplierData.id);

      if (updateError) throw updateError;

      showToast("הספק עודכן בהצלחה!", "success");
      handleCloseAddSupplierModal();
      // Close supplier detail sheet so it reopens with fresh data
      setShowSupplierDetailPopup(false);
      setSelectedSupplier(null);
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

    if (supplierEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplierEmail.trim())) {
      showToast("כתובת מייל לא תקינה", "warning");
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
        const fileName = `${generateUUID()}.${fileExt}`;
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
        const fileName = `${generateUUID()}.${fileExt}`;
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

      // 3. Auto-assign parent category if not manually selected
      let resolvedParentCategory = parentCategory || null;
      if (!resolvedParentCategory && parentCategories.length > 0) {
        const bizId = selectedBusinesses[0];
        const bizParents = parentCategories.filter(p => p.business_id === bizId);
        if (expenseType === "goods") {
          resolvedParentCategory = bizParents.find(p => p.name === "עלות מכר")?.id || null;
        } else if (expenseType === "employees") {
          resolvedParentCategory = bizParents.find(p => p.name === "עלויות עובדים" || p.name === "עלות עובדים")?.id || null;
        }
      }

      // 3. Create supplier record
      const { data: newSupplier, error: supplierError } = await supabase
        .from("suppliers")
        .insert({
          business_id: selectedBusinesses[0], // Use first selected business
          name: supplierName.trim(),
          expense_type: expenseType === "current" ? "current_expenses" : expenseType === "goods" ? "goods_purchases" : "employee_costs",
          expense_category_id: category || null,
          parent_category_id: resolvedParentCategory,
          payment_terms_days: paymentTerms ? parseInt(paymentTerms) : 30,
          vat_type: vatTypeMap[vatRequired],
          requires_vat: vatRequired !== "no",
          is_fixed_expense: isFixedExpense,
          charge_day: chargeDay ? parseInt(chargeDay) : null,
          monthly_expense_amount: monthlyExpenseAmount ? parseFloat(monthlyExpenseAmount) : null,
          default_payment_method: primaryPaymentMethod || null,
          default_credit_card_id: primaryPaymentMethod === "credit" && selectedCreditCardId ? selectedCreditCardId : null,
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
          email: supplierEmail.trim() || null,
          request_karteset: supplierEmail.trim() ? requestKarteset : false,
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

      // 5. Create recurring expense invoice for current month (for fixed expense suppliers)
      if (isFixedExpense && monthlyExpenseAmount && !hasPreviousObligations) {
        try {
          const now = new Date();
          const subtotal = parseFloat(monthlyExpenseAmount);
          const vatTypeMap2: Record<string, string> = { yes: "full", no: "none", partial: "partial" };
          const supplierVatType = vatTypeMap2[vatRequired] || "none";
          const vatAmount = supplierVatType === "full" ? subtotal * 0.18 : 0;
          const totalAmount = subtotal + vatAmount;
          const day = chargeDay ? Math.min(parseInt(chargeDay), new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()) : 1;
          const invoiceDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const invoiceTypeMap: Record<string, string> = {
            current: "current",
            goods: "goods",
            employees: "employees",
          };

          await supabase.from("invoices").insert({
            business_id: selectedBusinesses[0],
            supplier_id: newSupplier.id,
            invoice_date: invoiceDate,
            subtotal,
            vat_amount: vatAmount,
            total_amount: totalAmount,
            status: "pending",
            invoice_type: invoiceTypeMap[expenseType] || "current",
            notes: "הוצאה קבועה - נוצרה אוטומטית",
          });
        } catch (invoiceError) {
          console.error("Error creating fixed expense invoice:", invoiceError);
          // Don't throw - supplier was created successfully
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

  // Fetch monthly data for a specific month for the selected supplier
  const fetchMonthlyData = useCallback(async (supplier: SupplierWithBalance, monthDate: Date) => {
    const supabase = createClient();
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

    const { data: monthlyInvoices } = await supabase
      .from("invoices")
      .select("total_amount")
      .eq("supplier_id", supplier.id)
      .is("deleted_at", null)
      .gte("invoice_date", monthStart.toISOString().split("T")[0])
      .lte("invoice_date", monthEnd.toISOString().split("T")[0]);

    const monthlyPurchases = monthlyInvoices?.reduce((sum, inv) => sum + Number(inv.total_amount), 0) || 0;

    // Get payments linked to invoices in this month (by invoice_date, not payment_date)
    // First get invoice IDs for this month
    const { data: monthlyInvoiceIds } = await supabase
      .from("invoices")
      .select("id")
      .eq("supplier_id", supplier.id)
      .is("deleted_at", null)
      .gte("invoice_date", monthStart.toISOString().split("T")[0])
      .lte("invoice_date", monthEnd.toISOString().split("T")[0]);

    let monthlyPaid = 0;
    if (monthlyInvoiceIds && monthlyInvoiceIds.length > 0) {
      const invoiceIds = monthlyInvoiceIds.map(inv => inv.id);
      const { data: linkedPayments } = await supabase
        .from("payments")
        .select("total_amount")
        .in("invoice_id", invoiceIds)
        .is("deleted_at", null);
      monthlyPaid = linkedPayments?.reduce((sum, pay) => sum + Number(pay.total_amount), 0) || 0;
    }

    let expectedPaymentDate: string | null = null;
    if (supplier.payment_terms_days) {
      const expectedDate = new Date(monthEnd);
      expectedDate.setDate(expectedDate.getDate() + supplier.payment_terms_days);
      expectedPaymentDate = expectedDate.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
    }

    return { expectedPaymentDate, monthlyPurchases, monthlyPaid, amountToPay: monthlyPurchases - monthlyPaid };
  }, []);

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

    // Reset to current month
    const now = new Date();
    setDetailMonth(new Date(now.getFullYear(), now.getMonth(), 1));

    // Fetch supplier documents
    fetchSupplierDocuments(supplier.id);

    // Fetch supplier financial data
    const supabase = createClient();

    try {
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

      // Fetch monthly data for current month
      const monthlyData = await fetchMonthlyData(supplier, new Date(now.getFullYear(), now.getMonth(), 1));

      // Fetch last 6 months breakdown
      const breakdownMonths: Array<{ month: string; purchases: number; paid: number; amountToPay: number }> = [];
      for (let i = 0; i < 6; i++) {
        const mDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mData = await fetchMonthlyData(supplier, mDate);
        if (mData.monthlyPurchases > 0 || mData.monthlyPaid > 0) {
          breakdownMonths.push({
            month: mDate.toLocaleDateString("he-IL", { month: "short", year: "numeric" }),
            purchases: mData.monthlyPurchases,
            paid: mData.monthlyPaid,
            amountToPay: mData.amountToPay,
          });
        }
      }
      setMonthlyBreakdown(breakdownMonths);

      // For suppliers with previous obligations (loans), calculate loan balance
      let displayTotalPurchases = totalPurchases;
      let displayRemainingBalance = totalPurchases - totalPaid;

      if (supplier.has_previous_obligations && supplier.obligation_total_amount) {
        displayTotalPurchases = supplier.obligation_total_amount;
        displayRemainingBalance = supplier.obligation_total_amount - totalPaid;
      }

      setSupplierDetailData({
        totalPurchases: displayTotalPurchases,
        totalPaid,
        remainingBalance: displayRemainingBalance,
        monthlyData,
      });

      // Fetch invoices list for this supplier
      const { data: invoicesList } = await supabase
        .from("invoices")
        .select("id, invoice_date, invoice_number, subtotal, total_amount, vat_amount, status, notes, clarification_reason, attachment_url, created_by, created_at, creator:profiles!invoices_created_by_fkey(full_name)")
        .eq("supplier_id", supplier.id)
        .is("deleted_at", null)
        .order("invoice_date", { ascending: false })
        .limit(20);

      if (invoicesList) {
        // Fetch linked payments for all invoices
        const invoiceIds = invoicesList.map((inv: Record<string, unknown>) => inv.id as string);
        const { data: linkedPaymentsList } = await supabase
          .from("payments")
          .select(`
            id,
            invoice_id,
            payment_date,
            total_amount,
            notes,
            receipt_url,
            payment_splits(payment_method, amount, installments_count, installment_number)
          `)
          .in("invoice_id", invoiceIds)
          .is("deleted_at", null);

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

        // Group payments by invoice_id
        const paymentsByInvoice: Record<string, Array<{ id: string; amount: number; method: string; installments: string; date: string; receiptUrl: string | null; notes: string | null }>> = {};
        if (linkedPaymentsList) {
          for (const pay of linkedPaymentsList) {
            const invoiceId = pay.invoice_id as string;
            if (!paymentsByInvoice[invoiceId]) paymentsByInvoice[invoiceId] = [];
            const firstSplit = pay.payment_splits?.[0];
            const installCount = firstSplit?.installments_count || 1;
            const installNum = firstSplit?.installment_number || 1;
            paymentsByInvoice[invoiceId].push({
              id: pay.id,
              amount: Number(pay.total_amount),
              method: paymentMethodNames[firstSplit?.payment_method || "other"] || "אחר",
              installments: installCount > 1 ? `${installNum}/${installCount}` : "1/1",
              date: new Date(pay.payment_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
              receiptUrl: pay.receipt_url || null,
              notes: pay.notes || null,
            });
          }
        }

        setSupplierInvoices(invoicesList.map((inv: Record<string, unknown>) => ({
          id: inv.id as string,
          date: new Date(inv.invoice_date as string).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
          reference: (inv.invoice_number as string) || "-",
          amount: Number(inv.subtotal),
          amountWithVat: Number(inv.total_amount || inv.subtotal),
          amountBeforeVat: Number(inv.subtotal),
          status: inv.status === "paid" ? "שולם" : inv.status === "clarification" ? "בבירור" : "ממתין",
          notes: (inv.notes as string) || "",
          clarificationReason: (inv.clarification_reason as string) || null,
          attachmentUrls: parseAttachmentUrls(inv.attachment_url as string | null),
          enteredBy: (inv.creator as { full_name: string } | null)?.full_name || "מערכת",
          entryDate: new Date(inv.created_at as string).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
          linkedPayments: paymentsByInvoice[inv.id as string] || [],
        })));
      }

      // Fetch payments list for this supplier (with full details for expanded view)
      const { data: paymentsList } = await supabase
        .from("payments")
        .select(`
          id,
          payment_date,
          total_amount,
          subtotal,
          notes,
          receipt_url,
          invoice_id,
          invoice:invoices(id, invoice_number, invoice_date, subtotal, total_amount, attachment_url),
          payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number)
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const inv = pay.invoice as any;
          const total = Number(pay.total_amount);
          const subtotal = inv?.subtotal ? Number(inv.subtotal) : Math.round(total / 1.17 * 100) / 100;
          return {
            id: pay.id,
            date: new Date(pay.payment_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
            method: paymentMethodNames[firstSplit?.payment_method || "other"] || "אחר",
            amount: Number(pay.total_amount),
            totalAmount: total,
            subtotal,
            reference: firstSplit?.reference_number || "-",
            notes: pay.notes || null,
            receiptUrl: pay.receipt_url || null,
            linkedInvoice: inv ? {
              id: inv.id,
              invoiceNumber: inv.invoice_number,
              date: new Date(inv.invoice_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
              totalAmount: Number(inv.total_amount),
              attachmentUrl: inv.attachment_url,
            } : null,
            rawSplits: (pay.payment_splits || []).map((s: { id: string; payment_method: string; amount: number; installments_count: number | null; installment_number: number | null; due_date: string | null; check_number: string | null; reference_number: string | null }) => ({
              id: s.id,
              payment_method: s.payment_method,
              amount: Number(s.amount),
              installments_count: s.installments_count,
              installment_number: s.installment_number,
              due_date: s.due_date,
              check_number: s.check_number,
              reference_number: s.reference_number,
            })),
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
    setExpandedSupplierInvoiceId(null);
    setShowLinkedPayments(null);
    setSupplierDocuments([]);
  };

  // Fetch supplier documents
  const fetchSupplierDocuments = useCallback(async (supplierId: string) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("supplier_documents")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: false });
    if (!error && data) {
      setSupplierDocuments(data);
    }
  }, []);

  // Add document to supplier
  const handleAddDocument = async () => {
    if (!selectedSupplier || !newDocFile || !newDocDescription.trim()) return;
    setIsUploadingDoc(true);
    try {
      const ext = newDocFile.name.split(".").pop() || "pdf";
      const fileName = `${generateUUID()}.${ext}`;
      const filePath = `supplier-documents/${selectedSupplier.business_id}/${fileName}`;
      const result = await uploadFile(newDocFile, filePath, "assets");
      if (!result.success || !result.publicUrl) {
        showToast("שגיאה בהעלאת המסמך", "error");
        return;
      }
      const supabase = createClient();
      const { error } = await supabase.from("supplier_documents").insert({
        supplier_id: selectedSupplier.id,
        business_id: selectedSupplier.business_id,
        description: newDocDescription.trim(),
        document_url: result.publicUrl,
      });
      if (error) {
        showToast("שגיאה בשמירת המסמך", "error");
        return;
      }
      showToast("המסמך נוסף בהצלחה", "success");
      setNewDocDescription("");
      setNewDocFile(null);
      fetchSupplierDocuments(selectedSupplier.id);
    } catch {
      showToast("שגיאה בהעלאת המסמך", "error");
    } finally {
      setIsUploadingDoc(false);
    }
  };

  // Delete document
  const handleDeleteDocument = (docId: string) => {
    confirm("האם למחוק את המסמך?", async () => {
      const supabase = createClient();
      const { error } = await supabase.from("supplier_documents").delete().eq("id", docId);
      if (error) {
        showToast("שגיאה במחיקת המסמך", "error");
        return;
      }
      showToast("המסמך נמחק", "success");
      if (selectedSupplier) fetchSupplierDocuments(selectedSupplier.id);
    });
  };

  // Get category name by ID
  const getCategoryName = (categoryId: string | undefined) => {
    if (!categoryId) return "-";
    const cat = categories.find(c => c.id === categoryId);
    return cat?.name || "-";
  };

  // Get parent category name by ID
  const getParentCategoryName = (supplier: SupplierWithBalance) => {
    // First try from supplier's direct parent_category_id
    if (supplier.parent_category_id) {
      const parent = parentCategories.find(p => p.id === supplier.parent_category_id);
      if (parent) return parent.name;
    }
    // Fallback: try to find the category's parent
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
    if (activeTab === "previous") return false; // previous tab uses prior_commitments, not suppliers
    if (activeTab === "purchases") return supplier.expense_type === "goods_purchases";
    if (activeTab === "employees") return supplier.expense_type === "employee_costs";
    return supplier.expense_type === "current_expenses";
  });

  const filteredSuppliers = filteredByTab
    .filter((supplier) =>
      supplier.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => b.remainingPayment - a.remainingPayment);

  // Filter commitments by search
  const filteredCommitments = priorCommitments.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculate total open payment (for suppliers tabs) or commitment total (for previous tab)
  const todayDate = new Date();
  const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
  const commitmentsTotalRemaining = filteredCommitments.reduce((sum, c) => {
    if (c.end_date <= today) return sum;
    const startDate = new Date(c.start_date);
    const now = new Date();
    const monthsElapsed = Math.max(0, (now.getFullYear() - startDate.getFullYear()) * 12 + (now.getMonth() - startDate.getMonth()));
    const remaining = Math.max(0, c.total_installments - monthsElapsed);
    return sum + (c.monthly_amount * remaining);
  }, 0);

  const totalOpenPayment = activeTab === "previous"
    ? commitmentsTotalRemaining
    : filteredSuppliers.reduce((sum, item) => sum + item.remainingPayment, 0);
  const suppliersCount = activeTab === "previous" ? filteredCommitments.length : filteredSuppliers.length;

  return (
    <div dir="rtl" className="flex flex-col min-h-[calc(100vh-52px)] text-white px-[5px] py-[5px] pb-[80px] gap-[10px]">
      <ConfirmDialog />
      {/* Header Section with Total and Add Button */}
      <div className="flex flex-col gap-[7px]">
        {/* Total Open Payment - פתוח לתשלום: בימין, הסכום בשמאל */}
        <div className="flex items-center justify-center gap-[3px]">
          <span className={`text-[23px] font-bold ${totalOpenPayment < 0 ? "text-[#0BB783]" : totalOpenPayment > 0 ? "text-[#F64E60]" : "text-white"}`}>פתוח לתשלום:</span>
          <span dir="ltr" className={`text-[23px] font-bold ${totalOpenPayment < 0 ? "text-[#0BB783]" : totalOpenPayment > 0 ? "text-[#F64E60]" : "text-white"}`}>
            ₪{totalOpenPayment < 0 ? "-" : ""}{Math.abs(totalOpenPayment).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Add Supplier Button */}
        <Button
          id="onboarding-suppliers-add"
          type="button"
          onClick={() => {
            if (activeTab === "previous") {
              setCommitmentName("");
              setCommitmentMonthlyAmount("");
              setCommitmentTotalInstallments("");
              setCommitmentStartDate("");
              setCommitmentEndDate("");
              setCommitmentTerms("");
              setIsAddCommitmentOpen(true);
              return;
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
          {activeTab === "previous" ? "הוספת התחייבות קודמת" : "הוספת ספק חדש"}
        </Button>
      </div>

      {/* Main Content Container */}
      <div className="flex-1 flex flex-col bg-[#0F1535] rounded-[10px]">
        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as TabType)} dir="rtl">
          <TabsList id="onboarding-suppliers-tabs" className="w-full bg-transparent rounded-[7px] p-0 h-[50px] sm:h-[60px] mb-[10px] gap-0 border border-[#6B6B6B]">
            <TabsTrigger value="purchases" className="flex-1 text-[14px] sm:text-[20px] font-semibold py-0 h-full rounded-none rounded-r-[7px] border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent px-[4px] sm:px-[8px]">קניות סחורה</TabsTrigger>
            <TabsTrigger value="current" className="flex-1 text-[14px] sm:text-[20px] font-semibold py-0 h-full rounded-none border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent px-[4px] sm:px-[8px]">הוצאות שוטפות</TabsTrigger>
            <TabsTrigger value="employees" className="flex-1 text-[14px] sm:text-[20px] font-semibold py-0 h-full rounded-none border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent px-[4px] sm:px-[8px]">עלות עובדים</TabsTrigger>
            <TabsTrigger value="previous" className="flex-1 text-[14px] sm:text-[20px] font-semibold py-0 h-full rounded-none rounded-l-[7px] border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent px-[4px] sm:px-[8px]">התחייבויות קודמות</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Suppliers Count and Search - לחיצה על חיפוש מחליפה את כמות הספקים בשדה חיפוש */}
        <div className="flex items-center gap-[10px] mb-[10px]">
          <Button
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
          </Button>
          {isSearchOpen ? (
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="חיפוש ספק..."
              className="bg-[#29318A]/30 border border-[#6B6B6B] rounded-[7px] px-[12px] py-[6px] text-white text-[14px] placeholder:text-white/50 focus:outline-none focus:border-[#29318A] flex-1 text-right"
              autoFocus
            />
          ) : (
            <span className="text-[18px] font-bold text-white flex items-center gap-[6px]">{activeTab === "previous" ? `${suppliersCount} התחייבויות קודמות` : `${suppliersCount} ספקים`}</span>
          )}
        </div>

        {/* Suppliers / Commitments Grid */}
        <div id="onboarding-suppliers-list" className="flex-1 overflow-auto mt-[15px] mx-0">
          {activeTab === "previous" ? (
            /* Prior Commitments Grid */
            filteredCommitments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-[50px] gap-[10px]">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-[#979797]">
                  <path d="M12 8V12M12 16H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <span className="text-[16px] text-[#979797]">
                  {selectedBusinesses.length === 0 ? "יש לבחור עסק" : "אין התחייבויות קודמות"}
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-[26px]">
                {filteredCommitments.map((c) => {
                  const endDate = new Date(c.end_date);
                  const endDateStr = `${String(endDate.getDate()).padStart(2, "0")}/${String(endDate.getMonth() + 1).padStart(2, "0")}/${endDate.getFullYear()}`;
                  const isFinished = c.end_date <= today;
                  return (
                    <Button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedCommitment(c);
                        setShowCommitmentDetail(true);
                      }}
                      className={`bg-[#29318A] rounded-[10px] p-[7px] min-h-[170px] flex flex-col items-center justify-center gap-[10px] transition-colors duration-200 hover:bg-[#3D44A0] cursor-pointer relative ${isFinished ? "opacity-40" : ""}`}
                    >
                      {isFinished && (
                        <Badge className="absolute top-[6px] left-[6px] text-[10px] bg-[#0BB783]/80 text-white px-[6px] py-[2px] rounded-full font-bold">הסתיים</Badge>
                      )}
                      <div className="w-[120px] text-center">
                        <span className="text-[18px] font-bold text-white leading-[1.4]">
                          {c.name}
                        </span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span dir="ltr" className="text-[18px] font-semibold text-[#F64E60] text-center leading-[1.4]">
                          ₪{c.monthly_amount.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </span>
                        <span className="text-[14px] text-white/70 text-center leading-[1.4]">
                          {c.total_installments} תשלומים
                        </span>
                        <span className="text-[14px] text-white/70 text-center leading-[1.4]">
                          עד {endDateStr}
                        </span>
                      </div>
                    </Button>
                  );
                })}
              </div>
            )
          ) : isLoading ? (
            /* Skeleton Loaders for Supplier Cards */
            <div className="grid grid-cols-2 gap-[26px]">
              {[...Array(8)].map((_, i) => (
                <div
                  key={`skeleton-${i}`}
                  className="bg-[#29318A] rounded-[10px] p-[7px] min-h-[170px] flex flex-col items-center justify-center gap-[10px] animate-pulse"
                >
                  <div className="w-[120px] flex justify-center">
                    <div className="w-[80px] h-[22px] bg-white/20 rounded-[5px]" />
                  </div>
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
                <Button
                  key={supplier.id}
                  type="button"
                  onClick={() => handleOpenSupplierDetail(supplier)}
                  className={`bg-[#29318A] rounded-[10px] p-[7px] min-h-[170px] flex flex-col items-center justify-center gap-[10px] transition-colors duration-200 hover:bg-[#3D44A0] cursor-pointer relative ${supplier.is_active === false ? "opacity-40" : ""}`}
                >
                  {supplier.is_active === false && (
                    <Badge className="absolute top-[6px] left-[6px] text-[10px] bg-[#F64E60]/80 text-white px-[6px] py-[2px] rounded-full font-bold">לא פעיל</Badge>
                  )}
                  <div className="w-[120px] text-center">
                    <span className="text-[18px] font-bold text-white leading-[1.4]">
                      {supplier.name}
                    </span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[18px] font-normal text-white text-center leading-[1.4]">
                      נותר לתשלום
                    </span>
                    <span dir="ltr" className={`text-[18px] font-semibold text-center leading-[1.4] ${supplier.remainingPayment < 0 ? "text-[#0BB783]" : supplier.remainingPayment > 0 ? "text-[#F64E60]" : "text-white"}`}>
                      ₪{supplier.remainingPayment < 0 ? "-" : ""}{Math.abs(supplier.remainingPayment).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </span>
                    <div className="flex items-center gap-[4px]">
                      <span dir="ltr" className="text-[16px] font-bold text-white leading-[1.4]">
                        {Number(supplier.revenuePercentage.toFixed(2))}%
                      </span>
                      <span className="text-[16px] font-bold text-white leading-[1.4]">
                        מהכנסות
                      </span>
                    </div>
                  </div>
                </Button>
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
            <div className="flex justify-between items-center flex-row-reverse">
              <Button
                type="button"
                onClick={handleCloseAddSupplierModal}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </Button>
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
                  <Input
                    type="text"
                    title={hasPreviousObligations ? "שם התחייבות" : "שם הספק"}
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    readOnly={isEditingSupplier}
                    className={`w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] ${isEditingSupplier ? "opacity-60 cursor-not-allowed" : ""}`}
                  />
                </div>
              </div>

              {/* Email */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">כתובת מייל</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <Input
                    type="email"
                    dir="ltr"
                    title="כתובת מייל"
                    value={supplierEmail}
                    onChange={(e) => setSupplierEmail(e.target.value)}
                    className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
                    placeholder="example@email.com"
                  />
                </div>
              </div>

              {/* Request Karteset Toggle - only show when email exists */}
              {supplierEmail.trim() && (
                <div className="flex items-center justify-between px-[5px]">
                  <label className="text-[14px] font-medium text-white">שלח בקשת כרטסת כל 2 לחודש</label>
                  <button
                    type="button"
                    onClick={() => setRequestKarteset(!requestKarteset)}
                    className={`w-[44px] h-[24px] rounded-full transition-colors duration-200 flex items-center ${requestKarteset ? "bg-[#0BB783]" : "bg-[#4C526B]"}`}
                  >
                    <div className={`w-[20px] h-[20px] bg-white rounded-full transition-transform duration-200 mx-[2px] ${requestKarteset ? "mr-auto" : "ml-auto"}`} />
                  </button>
                </div>
              )}

              {/* Checkboxes - התחייבויות קודמות (only in previous tab), ממתין למרכזת */}
              <div className="flex flex-col gap-[10px] items-start" dir="rtl">
                {activeTab === "previous" && (
                  <Button
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
                  </Button>
                )}

                {!hasPreviousObligations && (
                  <Button
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
                  </Button>
                )}

                {!hasPreviousObligations && (
                  <Button
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
                  </Button>
                )}

                {/* Active/Inactive toggle - only in edit mode */}
                {isEditingSupplier && (
                  <Button
                    type="button"
                    onClick={() => setIsSupplierActive(!isSupplierActive)}
                    className="flex items-center gap-[3px]"
                  >
                    <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className={isSupplierActive ? "text-[#0BB783]" : "text-[#F64E60]"}>
                      {isSupplierActive ? (
                        <>
                          <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                          <path d="M10 16L14 20L22 12" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </>
                      ) : (
                        <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                    <span className={`text-[15px] font-semibold ${isSupplierActive ? "text-[#0BB783]" : "text-[#F64E60]"}`}>
                      {isSupplierActive ? "ספק פעיל" : "ספק לא פעיל"}
                    </span>
                  </Button>
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
                      <Input
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
                      <Textarea
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
                    <DatePickerField
                      value={obligationFirstChargeDate}
                      onChange={(val) => setObligationFirstChargeDate(val)}
                      className="h-[45px]"
                    />
                  </div>

                  {/* Number of Payments */}
                  <div className="flex flex-col gap-[5px]">
                    <label className="text-[14px] font-medium text-white/80 text-right">כמות תשלומים</label>
                    <div className="border border-[#4C526B] rounded-[10px] h-[45px]">
                      <Input
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
                      <Input
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
                    <Button
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
                    </Button>
                    <Button
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
                    </Button>
                    <Button
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
                    </Button>
                  </div>
                </div>
              )}

              {/* Parent Category */}
              <div className="flex flex-col gap-[5px]">
                <div className="flex items-center justify-between">
                  <label className="text-[15px] font-medium text-white">קטגוריית אב</label>
                  <Button
                    type="button"
                    onClick={() => setIsAddingParentCategory(!isAddingParentCategory)}
                    className="bg-[#29318A] text-white text-[13px] font-medium px-[10px] py-[3px] rounded-[7px] hover:bg-[#3D44A0] transition-colors"
                  >
                    {isAddingParentCategory ? "ביטול" : "+ חדש"}
                  </Button>
                </div>
                {isAddingParentCategory ? (
                  <div className="flex gap-[8px]">
                    <div className="flex-1 border border-[#4C526B] rounded-[10px] h-[50px]">
                      <Input
                        type="text"
                        title="שם קטגוריית אב חדשה"
                        value={newParentCategoryName}
                        onChange={(e) => setNewParentCategoryName(e.target.value)}
                        placeholder="הזן שם קטגוריית אב..."
                        className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                        autoFocus
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={handleAddParentCategory}
                      disabled={!newParentCategoryName.trim()}
                      className="bg-[#3CD856] text-white text-[14px] font-semibold px-[15px] rounded-[10px] hover:bg-[#2FB847] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      הוסף
                    </Button>
                  </div>
                ) : (
                  <Select value={parentCategory || "__none__"} onValueChange={(val) => setParentCategory(val === "__none__" ? "" : val)}>
                    <SelectTrigger className="w-full bg-transparent border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                      <SelectValue placeholder="בחר קטגוריית אב" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">בחר קטגוריית אב</SelectItem>
                      {parentCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Category */}
              <div className="flex flex-col gap-[5px]">
                <div className="flex items-center justify-between">
                  <label className="text-[15px] font-medium text-white">קטגוריה</label>
                  <Button
                    type="button"
                    onClick={() => setIsAddingCategory(!isAddingCategory)}
                    className="bg-[#29318A] text-white text-[13px] font-medium px-[10px] py-[3px] rounded-[7px] hover:bg-[#3D44A0] transition-colors"
                  >
                    {isAddingCategory ? "ביטול" : "+ חדש"}
                  </Button>
                </div>
                {isAddingCategory ? (
                  <div className="flex gap-[8px]">
                    <div className="flex-1 border border-[#4C526B] rounded-[10px] h-[50px]">
                      <Input
                        type="text"
                        title="שם קטגוריה חדשה"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="הזן שם קטגוריה..."
                        className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                        autoFocus
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={handleAddCategory}
                      disabled={!newCategoryName.trim()}
                      className="bg-[#3CD856] text-white text-[14px] font-semibold px-[15px] rounded-[10px] hover:bg-[#2FB847] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      הוסף
                    </Button>
                  </div>
                ) : (
                  <Select value={category || "__none__"} onValueChange={(val) => setCategory(val === "__none__" ? "" : val)}>
                    <SelectTrigger className="w-full bg-transparent border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                      <SelectValue placeholder="בחר קטגוריה" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">בחר קטגוריה</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Payment Terms (hidden for previous obligations) */}
              {!hasPreviousObligations && (
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[15px] font-medium text-white text-right">תנאי תשלום (שוטף +)</label>
                  <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                    <Input
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
                  <Button
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
                  </Button>
                  <Button
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
                  </Button>
                  <Button
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
                  </Button>
                </div>
              </div>

              {/* Charge Day & Monthly Amount - only when fixed expense */}
              {isFixedExpense && (
                <>
                  <div className="flex flex-col gap-[5px]">
                    <label className="text-[15px] font-medium text-white text-right">מתי יורד החיוב בחודש?</label>
                    <div className="border border-[#4C526B] rounded-[10px] h-[50px] px-[10px]">
                      <Input
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
                      <Input
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
                <Select value={primaryPaymentMethod || "__none__"} onValueChange={(val) => { const v = val === "__none__" ? "" : val; setPrimaryPaymentMethod(v); if (v !== "credit") setSelectedCreditCardId(""); }}>
                  <SelectTrigger className="w-full bg-transparent border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                    <SelectValue placeholder="אמצעי תשלום ראשי" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__"></SelectItem>
                    <SelectItem value="credit">כרטיס אשראי</SelectItem>
                    <SelectItem value="bank_transfer">העברה בנקאית</SelectItem>
                    <SelectItem value="check">צ&apos;ק</SelectItem>
                    <SelectItem value="cash">מזומן</SelectItem>
                    <SelectItem value="bit">ביט</SelectItem>
                    <SelectItem value="paybox">פייבוקס</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Credit Card Selection - shown when payment method is credit */}
              {primaryPaymentMethod === "credit" && businessCreditCards.length > 0 && (
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[15px] font-medium text-white text-right">בחירת כרטיס אשראי</label>
                  <Select value={selectedCreditCardId || "__none__"} onValueChange={(val) => setSelectedCreditCardId(val === "__none__" ? "" : val)}>
                    <SelectTrigger className="w-full bg-transparent border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                      <SelectValue placeholder="בחר כרטיס" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">בחר כרטיס</SelectItem>
                      {businessCreditCards.map((card) => (
                        <SelectItem key={card.id} value={card.id}>
                          {card.card_name}{card.last_four_digits ? ` (${card.last_four_digits})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Fixed Note */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">הערה קבועה לספק</label>
                <div className="border border-[#4C526B] rounded-[10px] min-h-[80px] px-[10px] py-[10px]">
                  <Textarea
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
                <Button
                  type="button"
                  onClick={isEditingSupplier ? handleUpdateSupplier : handleSaveSupplier}
                  disabled={isSubmitting || !supplierName.trim()}
                  className="flex-1 bg-[#29318A] text-white text-[18px] font-semibold h-[50px] rounded-[10px] transition-colors hover:bg-[#3D44A0] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[8px]"
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
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    if (isEditingSupplier && editingSupplierData) {
                      // Return to supplier detail card instead of closing everything
                      handleCloseAddSupplierModal();
                      setSelectedSupplier(editingSupplierData);
                      setShowSupplierDetailPopup(true);
                    } else {
                      handleCloseAddSupplierModal();
                    }
                  }}
                  disabled={isSubmitting}
                  className="flex-1 bg-transparent border border-[#4C526B] text-white text-[18px] font-semibold h-[50px] rounded-[10px] transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  {isEditingSupplier ? "חזרה" : "ביטול"}
                </Button>
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
            <div className="flex justify-between items-center flex-row-reverse">
              <Button
                type="button"
                onClick={handleCloseSupplierDetail}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </Button>
              <SheetTitle className="text-white text-xl font-bold">פרטי ספק</SheetTitle>
              <div className="flex items-center gap-[8px]">
                {/* Delete button - only show if supplier has no invoices/payments */}
                {supplierInvoices.length === 0 && supplierPayments.length === 0 && (
                  <Button
                    type="button"
                    title="מחיקת ספק"
                    onClick={handleDeleteSupplier}
                    className="w-[24px] h-[24px] flex items-center justify-center text-[#F64E60]/70 hover:text-[#F64E60] transition-colors"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      <line x1="10" y1="11" x2="10" y2="17"/>
                      <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                  </Button>
                )}
                {/* Send karteset email button — always available when supplier has email (#16) */}
                {selectedSupplier?.email && (
                  <Button
                    type="button"
                    title="שלח בקשת כרטסת"
                    onClick={handleOpenKartesetPicker}
                    disabled={isSendingKarteset}
                    className="w-[24px] h-[24px] flex items-center justify-center text-white/70 hover:text-white transition-colors disabled:opacity-40"
                  >
                    <Send className={`w-[18px] h-[18px] ${isSendingKarteset ? "animate-pulse" : ""}`} />
                  </Button>
                )}
                {/* Pay button — navigate to payments page with supplier pre-selected (#17) */}
                <Button
                  type="button"
                  title="לתשלום"
                  onClick={() => {
                    if (selectedSupplier) {
                      router.push(`/payments?supplier=${selectedSupplier.id}`);
                    }
                  }}
                  className="w-[24px] h-[24px] flex items-center justify-center text-white/70 hover:text-white"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                    <line x1="1" y1="10" x2="23" y2="10"/>
                  </svg>
                </Button>
                {/* Edit button */}
                <Button
                  type="button"
                  title="עריכה"
                  onClick={handleEditSupplier}
                  className="w-[24px] h-[24px] flex items-center justify-center text-white/70 hover:text-white"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </Button>
              </div>
            </div>
          </SheetHeader>

          {/* Karteset Period Picker */}
          {showKartesetPeriodPicker && (
            <div className="mx-4 mt-3 mb-1 bg-[#29318A]/50 rounded-[10px] p-[12px]">
              <div className="flex flex-col gap-[10px]">
                <span className="text-[14px] text-white font-medium text-center">בחר תקופה לבקשת כרטסת</span>
                <div className="flex items-center justify-center gap-[10px]">
                  <select
                    value={kartesetPeriodYear}
                    onChange={(e) => setKartesetPeriodYear(Number(e.target.value))}
                    className="bg-[#1B2559] text-white text-[14px] text-center rounded-[8px] border border-[#4C526B] px-[10px] h-[36px] outline-none"
                  >
                    {[2024, 2025, 2026, 2027].map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <select
                    value={kartesetPeriodMonth}
                    onChange={(e) => setKartesetPeriodMonth(Number(e.target.value))}
                    className="bg-[#1B2559] text-white text-[14px] text-center rounded-[8px] border border-[#4C526B] px-[10px] h-[36px] outline-none"
                  >
                    {["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"].map((m, i) => (
                      <option key={i} value={i}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-center gap-[8px]">
                  <Button
                    type="button"
                    onClick={() => setShowKartesetPeriodPicker(false)}
                    className="px-[16px] h-[34px] rounded-[8px] bg-[#4C526B]/50 text-white/70 text-[13px] font-medium hover:bg-[#4C526B] transition-colors"
                  >
                    ביטול
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSendKartesetEmail}
                    disabled={isSendingKarteset}
                    className="px-[16px] h-[34px] rounded-[8px] bg-[#29318A] text-white text-[13px] font-medium hover:bg-[#3D44A0] transition-colors disabled:opacity-40"
                  >
                    {isSendingKarteset ? "שולח..." : "שלח בקשת כרטסת"}
                  </Button>
                </div>
              </div>
            </div>
          )}

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
                {selectedSupplier.email && (
                  <div className="flex flex-col items-center text-center">
                    <span className="text-[12px] text-white/60">מייל ספק</span>
                    <span className="text-[14px] text-white font-medium" dir="ltr">{selectedSupplier.email}</span>
                  </div>
                )}
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

              {/* Notes - only show if exists */}
              {selectedSupplier.notes && (
                <div className="mt-[10px] bg-[#29318A]/20 rounded-[10px] p-[10px] border border-[#4C526B]">
                  <span className="text-[12px] text-white/60">הערות</span>
                  <p className="text-[14px] text-white mt-[4px] text-right whitespace-pre-wrap">{selectedSupplier.notes}</p>
                </div>
              )}
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

            {/* Monthly Breakdown Summary */}
            {monthlyBreakdown.length > 0 && (
              <div className="bg-[#29318A]/30 rounded-[10px] p-[15px] mb-[10px]">
                <span className="text-[14px] font-medium text-white mb-[10px] block">סיכום לפי חודשים</span>
                <div className="flex flex-col gap-[3px]">
                  {/* Header */}
                  <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] p-[5px] text-[11px] text-white/60 font-medium">
                    <span className="text-right">חודש</span>
                    <span className="text-center">רכישות</span>
                    <span className="text-center">שולם</span>
                    <span className="text-center">יתרה</span>
                  </div>
                  {/* Rows */}
                  {monthlyBreakdown.map((m) => (
                    <div key={m.month} className="grid grid-cols-[1.2fr_1fr_1fr_1fr] p-[5px] bg-white/5 rounded-[5px] text-[12px]">
                      <span className="text-right font-medium">{m.month}</span>
                      <span className="text-center ltr-num">₪{m.purchases.toLocaleString()}</span>
                      <span className="text-center ltr-num">₪{m.paid.toLocaleString()}</span>
                      <span className={`text-center ltr-num font-medium ${m.amountToPay > 0 ? "text-[#F64E60]" : m.amountToPay < 0 ? "text-[#0BB783]" : ""}`}>
                        ₪{m.amountToPay.toLocaleString()}
                      </span>
                    </div>
                  ))}
                  {/* Total row */}
                  <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] p-[5px] border-t border-white/20 mt-[3px] text-[12px] font-bold">
                    <span className="text-right">סה&quot;כ</span>
                    <span className="text-center ltr-num">₪{monthlyBreakdown.reduce((s, m) => s + m.purchases, 0).toLocaleString()}</span>
                    <span className="text-center ltr-num">₪{monthlyBreakdown.reduce((s, m) => s + m.paid, 0).toLocaleString()}</span>
                    <span className={`text-center ltr-num ${monthlyBreakdown.reduce((s, m) => s + m.amountToPay, 0) > 0 ? "text-[#F64E60]" : "text-[#0BB783]"}`}>
                      ₪{monthlyBreakdown.reduce((s, m) => s + m.amountToPay, 0).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Monthly Details Section */}
            <div className="bg-[#29318A]/30 rounded-[10px] p-[15px]">
              {/* Month selector */}
              <div className="flex items-center justify-center gap-[10px] mb-[15px]">
                <Button
                  type="button"
                  onClick={async () => {
                    const next = new Date(detailMonth.getFullYear(), detailMonth.getMonth() + 1, 1);
                    setDetailMonth(next);
                    if (selectedSupplier) {
                      const monthlyData = await fetchMonthlyData(selectedSupplier, next);
                      setSupplierDetailData(prev => prev ? { ...prev, monthlyData } : prev);
                    }
                  }}
                  className="text-white/60 hover:text-white transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <span className="text-[14px] text-white font-medium min-w-[120px] text-center">
                  חודש {detailMonth.toLocaleDateString("he-IL", { month: "long", year: "numeric" })}
                </span>
                <Button
                  type="button"
                  onClick={async () => {
                    const prev = new Date(detailMonth.getFullYear(), detailMonth.getMonth() - 1, 1);
                    setDetailMonth(prev);
                    if (selectedSupplier) {
                      const monthlyData = await fetchMonthlyData(selectedSupplier, prev);
                      setSupplierDetailData(p => p ? { ...p, monthlyData } : p);
                    }
                  }}
                  className="text-white/60 hover:text-white transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
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
              <Button
                type="button"
                onClick={() => {
                  setShowSupplierDetailPopup(false);
                  const params = new URLSearchParams();
                  if (selectedSupplier) params.set("supplierId", selectedSupplier.id);
                  const amount = supplierDetailData?.monthlyData.amountToPay || 0;
                  if (amount > 0) params.set("amount", amount.toString());
                  const expectedDate = supplierDetailData?.monthlyData.expectedPaymentDate;
                  if (expectedDate) {
                    // Convert DD.MM.YY to YYYY-MM-DD
                    const parts = expectedDate.split(".");
                    if (parts.length === 3) {
                      const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
                      params.set("paymentDate", `${year}-${parts[1]}-${parts[0]}`);
                    }
                  }
                  router.push(`/payments?${params.toString()}`);
                }}
                className="w-full mt-[15px] bg-[#29318A] text-white text-[16px] font-semibold py-[12px] rounded-[10px] hover:bg-[#3D44A0] transition-colors"
              >
                לתשלום
              </Button>
            </div>

            {/* Tabs Section - חשבוניות פתוחות / תשלומים שבוצעו / מסמכים */}
            <div className="mt-[15px] flex flex-col gap-[10px]">
              {/* Tab Buttons */}
              <div className="flex w-full h-[40px] border border-[#6B6B6B] rounded-[7px] overflow-hidden">
                <Button
                  type="button"
                  onClick={() => setDetailActiveTab("invoices")}
                  className={`flex-1 flex items-center justify-center transition-colors duration-200 ${
                    detailActiveTab === "invoices"
                      ? "bg-[#29318A] text-white"
                      : "text-[#979797]"
                  }`}
                >
                  <span className="text-[13px] font-bold">חשבוניות</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => setDetailActiveTab("payments")}
                  className={`flex-1 flex items-center justify-center transition-colors duration-200 ${
                    detailActiveTab === "payments"
                      ? "bg-[#29318A] text-white"
                      : "text-[#979797]"
                  }`}
                >
                  <span className="text-[13px] font-bold">תשלומים</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => setDetailActiveTab("documents")}
                  className={`flex-1 flex items-center justify-center transition-colors duration-200 ${
                    detailActiveTab === "documents"
                      ? "bg-[#29318A] text-white"
                      : "text-[#979797]"
                  }`}
                >
                  <span className="text-[13px] font-bold">מסמכים</span>
                </Button>
              </div>

              {/* Invoices Table */}
              {detailActiveTab === "invoices" && (
                <div className="w-full flex flex-col gap-[5px]">
                  {/* Table Header */}
                  <div className="grid grid-cols-[0.7fr_0.9fr_0.7fr_0.7fr_0.7fr] bg-white/5 rounded-t-[7px] p-[10px_5px] items-center">
                    <span className="text-[12px] font-medium text-center">תאריך</span>
                    <span className="text-[12px] font-medium text-center">אסמכתא</span>
                    <span className="text-[12px] font-medium text-center">לפני מע&quot;מ</span>
                    <span className="text-[12px] font-medium text-center">כולל מע&quot;מ</span>
                    <span className="text-[12px] font-medium text-center">סטטוס</span>
                  </div>

                  {/* Table Rows */}
                  <div className="flex flex-col gap-[5px]">
                    {supplierInvoices.length === 0 ? (
                      <div className="flex items-center justify-center py-[30px]">
                        <span className="text-[14px] text-white/50">אין חשבוניות להצגה</span>
                      </div>
                    ) : (
                      supplierInvoices.map((invoice) => (
                        <div
                          key={invoice.id}
                          className={`rounded-[7px] p-[7px_3px] transition-colors ${
                            expandedSupplierInvoiceId === invoice.id ? "bg-white/10 border border-white/20" : "bg-white/5"
                          }`}
                        >
                          {/* Row - Clickable to expand */}
                          <Button
                            type="button"
                            onClick={() => setExpandedSupplierInvoiceId(expandedSupplierInvoiceId === invoice.id ? null : invoice.id)}
                            className="grid grid-cols-[0.7fr_0.9fr_0.7fr_0.7fr_0.7fr] w-full p-[5px_5px] items-center cursor-pointer"
                          >
                            {/* Date with expand arrow */}
                            <div className="flex items-center justify-center gap-[4px]">
                              <svg
                                width="12" height="12" viewBox="0 0 32 32"
                                fill="none"
                                className={`flex-shrink-0 transition-transform text-white/50 ${expandedSupplierInvoiceId === invoice.id ? 'rotate-90' : ''}`}
                              >
                                <path d="M20 10L14 16L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                              <span className="text-[11px] ltr-num">{invoice.date}</span>
                            </div>
                            {/* Reference */}
                            <span className="text-[11px] text-center ltr-num truncate px-[2px]">{invoice.reference}</span>
                            {/* Amount Before VAT */}
                            <span className="text-[11px] text-center ltr-num font-medium">
                              ₪{invoice.amountBeforeVat.toLocaleString()}
                            </span>
                            {/* Amount With VAT */}
                            <span className="text-[11px] text-center ltr-num font-medium">
                              ₪{invoice.amountWithVat.toLocaleString()}
                            </span>
                            {/* Status — clickable to change */}
                            <div className="flex justify-center" onClick={(e) => { e.stopPropagation(); handleInvoiceStatusChange(invoice.id, invoice.status); }}>
                              <span className={`text-[11px] font-bold px-[10px] py-[4px] rounded-full cursor-pointer hover:opacity-80 transition-opacity ${
                                invoice.status === "שולם"
                                  ? "bg-[#00E096]"
                                  : invoice.status === "בבירור"
                                  ? "bg-[#FFA500]"
                                  : "bg-[#29318A]"
                              }`} title="לחץ לשנות סטטוס">
                                {invoice.status}
                              </span>
                            </div>
                          </Button>

                          {/* Expanded Content */}
                          {expandedSupplierInvoiceId === invoice.id && (
                            <div className="flex flex-col gap-[15px] p-[5px] mt-[10px]">
                              {/* Notes Section - only show if has notes */}
                              {invoice.notes && invoice.notes.trim() !== "" && (
                                <div className="border border-white/50 rounded-[7px] p-[3px] flex flex-col gap-[3px]">
                                  <span className="text-[14px] text-[#979797] text-right">הערות</span>
                                  <Textarea
                                    title="הערות לחשבונית"
                                    disabled
                                    rows={2}
                                    value={invoice.notes}
                                    className="w-full bg-transparent text-white text-[14px] font-bold text-right resize-none outline-none min-h-[50px]"
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

                              {/* Details Section */}
                              <div className="border border-white/50 rounded-[7px] p-[3px] flex flex-col gap-[15px]">
                                {/* Header with title and action icons */}
                                <div className="flex items-center justify-between border-b border-white/35 pb-[10px]">
                                  <span className="text-[16px] font-medium text-white ml-[7px]">פרטים נוספים</span>
                                  <div className="flex items-center gap-[6px]">
                                    {/* Image/View Icon - only show if has attachments (rightmost in RTL) */}
                                    {invoice.attachmentUrls.length > 0 && (
                                      <Button
                                        type="button"
                                        title="צפייה בתמונה"
                                        onClick={() => setViewerDocUrl(invoice.attachmentUrls[0])}
                                        className="w-[18px] h-[18px] text-white/70 hover:text-white transition-colors cursor-pointer"
                                      >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                          <circle cx="8.5" cy="8.5" r="1.5"/>
                                          <polyline points="21 15 16 10 5 21"/>
                                        </svg>
                                      </Button>
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
                                    {/* Edit Icon (leftmost in RTL) */}
                                    <Button
                                      type="button"
                                      title="עריכת הוצאה"
                                      onClick={() => router.push(`/expenses?edit=${invoice.id}&returnTo=suppliers`)}
                                      className="w-[18px] h-[18px] text-white/70 hover:text-white transition-colors cursor-pointer"
                                    >
                                      <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                      </svg>
                                    </Button>
                                  </div>
                                </div>

                                {/* Attachment Thumbnails */}
                                {invoice.attachmentUrls.length > 0 && (
                                  <div className="flex flex-wrap gap-[8px] px-[7px]">
                                    {invoice.attachmentUrls.map((url, idx) => (
                                      <Button
                                        key={`attachment-${url}`}
                                        type="button"
                                        onClick={() => setViewerDocUrl(url)}
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
                                          <Image src={url} alt={`חשבונית ${idx + 1}`} className="w-full h-full object-cover" width={70} height={70} unoptimized />
                                        )}
                                      </Button>
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

                              {/* Linked Payments Section */}
                              {invoice.linkedPayments.length > 0 && (
                                <div className="border border-white/20 rounded-[7px] p-[7px] flex flex-col gap-[10px]">
                                  <Button
                                    type="button"
                                    onClick={() => setShowLinkedPayments(showLinkedPayments === invoice.id ? null : invoice.id)}
                                    className="bg-[#29318A] text-white text-[14px] font-medium py-[5px] px-[14px] rounded-[7px] self-start"
                                  >
                                    הצגת תשלומים מקושרים ({invoice.linkedPayments.length})
                                  </Button>

                                  {showLinkedPayments === invoice.id && (
                                    <div className="flex flex-col gap-[5px]">
                                      {invoice.linkedPayments.map((payment) => (
                                        <div
                                          key={payment.id}
                                          className="flex flex-col gap-[8px] p-[8px] bg-white/5 rounded-[7px] cursor-pointer hover:bg-white/10 transition-colors"
                                          onClick={() => router.push(`/payments?paymentId=${payment.id}`)}
                                        >
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-[6px]">
                                              {/* View receipt */}
                                              {payment.receiptUrl && (
                                                <Button
                                                  type="button"
                                                  title="צפייה בקבלה"
                                                  onClick={(e) => { e.stopPropagation(); window.open(payment.receiptUrl!, '_blank'); }}
                                                  className="w-[18px] h-[18px] text-white/70 hover:text-white transition-colors"
                                                >
                                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                                    <circle cx="8.5" cy="8.5" r="1.5"/>
                                                    <polyline points="21 15 16 10 5 21"/>
                                                  </svg>
                                                </Button>
                                              )}
                                              {/* Download receipt */}
                                              {payment.receiptUrl && (
                                                <a
                                                  href={payment.receiptUrl}
                                                  download
                                                  title="הורדת קבלה"
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="w-[18px] h-[18px] text-white/70 hover:text-white transition-colors"
                                                >
                                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                                    <polyline points="7 10 12 15 17 10"/>
                                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                                  </svg>
                                                </a>
                                              )}
                                            </div>
                                            <div className="flex items-center gap-[12px]">
                                              <span className="text-[13px] text-white ltr-num">₪{payment.amount.toLocaleString()}</span>
                                              <span className="text-[13px] text-white">{payment.method}</span>
                                              <span className="text-[13px] text-white/70 ltr-num">{payment.installments}</span>
                                              <span className="text-[13px] text-white/70 ltr-num">{payment.date}</span>
                                            </div>
                                          </div>
                                          {payment.notes && (
                                            <div className="text-[12px] text-white/50 text-right pr-[4px]">{payment.notes}</div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
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
                          className={`rounded-[7px] p-[7px_3px] transition-colors ${
                            expandedSupplierPaymentId === payment.id ? "bg-white/10 border border-white/20" : "bg-white/5"
                          }`}
                        >
                          {/* Row - Clickable to expand */}
                          <Button
                            type="button"
                            onClick={() => setExpandedSupplierPaymentId(expandedSupplierPaymentId === payment.id ? null : payment.id)}
                            className="grid grid-cols-[0.8fr_1fr_0.9fr_0.8fr] w-full p-[5px_5px] items-center cursor-pointer"
                          >
                            {/* Date with expand arrow */}
                            <div className="flex items-center justify-center gap-[4px]">
                              <svg
                                width="12" height="12" viewBox="0 0 32 32"
                                fill="none"
                                className={`flex-shrink-0 transition-transform text-white/50 ${expandedSupplierPaymentId === payment.id ? 'rotate-90' : ''}`}
                              >
                                <path d="M20 10L14 16L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                              <span className="text-[12px] ltr-num">{payment.date}</span>
                            </div>
                            {/* Payment Method */}
                            <span className="text-[12px] text-center leading-tight">{payment.method}</span>
                            {/* Amount */}
                            <span className="text-[12px] text-center ltr-num font-medium">
                              ₪{payment.amount.toLocaleString()}
                            </span>
                            {/* Reference */}
                            <span className="text-[12px] text-center ltr-num truncate px-[2px]">{payment.reference}</span>
                          </Button>

                          {/* Expanded Content */}
                          {expandedSupplierPaymentId === payment.id && (
                            <div className="flex flex-col gap-[10px] p-[5px] mt-[10px]">
                              <div className="border border-white/50 rounded-[7px] p-[3px] flex flex-col gap-[15px]">
                                {/* Header with title and action icons */}
                                <div className="flex items-center justify-between border-b border-white/35 pb-[10px]">
                                  <span className="text-[16px] font-medium text-white ml-[7px]">פרטים נוספים</span>
                                  <div className="flex items-center gap-[6px]">
                                    {/* Edit Icon */}
                                    <Button
                                      type="button"
                                      title="עריכת תשלום"
                                      onClick={() => router.push(`/payments?edit=${payment.id}`)}
                                      className="w-[18px] h-[18px] text-white/70 hover:text-white transition-colors cursor-pointer"
                                    >
                                      <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                      </svg>
                                    </Button>
                                    {/* Receipt image */}
                                    {payment.receiptUrl && (
                                      <Button
                                        type="button"
                                        title="צפייה בקבלה"
                                        onClick={() => setViewerDocUrl(payment.receiptUrl!)}
                                        className="w-[18px] h-[18px] text-white/70 hover:text-white transition-colors cursor-pointer"
                                      >
                                        <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2">
                                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                          <circle cx="8.5" cy="8.5" r="1.5"/>
                                          <polyline points="21 15 16 10 5 21"/>
                                        </svg>
                                      </Button>
                                    )}
                                    {/* Download receipt */}
                                    {payment.receiptUrl && (
                                      <a
                                        href={payment.receiptUrl}
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
                                  </div>
                                </div>

                                {/* Amounts row */}
                                <div className="flex items-center justify-between px-[7px] flex-wrap gap-y-[8px]">
                                  <div className="flex flex-col items-center min-w-[60px]">
                                    <span className="text-[13px] text-[#979797]">סכום לפני מע&quot;מ</span>
                                    <span className="text-[13px] text-white ltr-num">₪{payment.subtotal.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                  </div>
                                  <div className="flex flex-col items-center min-w-[60px]">
                                    <span className="text-[13px] text-[#979797]">סכום כולל מע&quot;מ</span>
                                    <span className="text-[13px] text-white ltr-num">₪{payment.totalAmount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                  </div>
                                </div>

                                {/* Payment Methods Breakdown */}
                                {payment.rawSplits.length > 0 && (
                                  <div className="flex flex-col gap-[5px] px-[7px]" dir="rtl">
                                    <span className="text-[13px] text-[#979797] font-medium">אמצעי תשלום</span>
                                    {(() => {
                                      const paymentMethodNamesMap: Record<string, string> = {
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
                                      // Group splits by payment method
                                      const methodGroups = new Map<string, { method: string; splits: typeof payment.rawSplits }>();
                                      for (const split of payment.rawSplits) {
                                        const key = split.payment_method;
                                        if (!methodGroups.has(key)) {
                                          methodGroups.set(key, { method: key, splits: [] });
                                        }
                                        methodGroups.get(key)!.splits.push(split);
                                      }
                                      return Array.from(methodGroups.values()).map((group, idx) => (
                                        <div key={idx} className="flex flex-col gap-[3px]">
                                          <div className="flex items-center justify-between bg-white/5 rounded-[5px] px-[8px] py-[5px]">
                                            <div className="flex items-center gap-[8px]">
                                              <span className="text-[13px] font-medium">{paymentMethodNamesMap[group.method] || "אחר"}</span>
                                              {group.splits.length > 1 && (
                                                <span className="text-[11px] text-white/50">({group.splits.length} תשלומים)</span>
                                              )}
                                            </div>
                                            <span className="text-[13px] font-medium ltr-num">₪{group.splits[0].amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                          </div>
                                          {/* Show individual installments when there are multiple */}
                                          {group.splits.length > 1 && (
                                            <div className="flex flex-col gap-[2px] pr-[16px]">
                                              {group.splits.map((split, sIdx) => (
                                                <div key={split.id || sIdx} className="flex items-center justify-between px-[8px] py-[2px] text-[11px] text-white/60">
                                                  <span>
                                                    תשלום {split.installment_number || sIdx + 1}
                                                    {split.due_date && ` — ${new Date(split.due_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" })}`}
                                                    {split.check_number && ` — צ׳ק ${split.check_number}`}
                                                  </span>
                                                  <span className="ltr-num">₪{split.amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          {/* Show check number for single splits */}
                                          {group.splits.length === 1 && group.splits[0]?.check_number && (
                                            <span className="text-[11px] text-white/50 px-[8px]">צ׳ק {group.splits[0].check_number}</span>
                                          )}
                                        </div>
                                      ));
                                    })()}
                                  </div>
                                )}

                                {/* Reference & Notes */}
                                {(payment.reference !== "-" || payment.notes) && (
                                  <div className="flex flex-col gap-[5px] px-[7px]">
                                    {payment.reference && payment.reference !== "-" && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-[#979797]">אסמכתא</span>
                                        <span className="text-[13px] ltr-num">{payment.reference}</span>
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

                                {/* Linked Invoice */}
                                {payment.linkedInvoice && (
                                  <div className="flex flex-col gap-[5px] px-[7px] pb-[5px]">
                                    <Button
                                      type="button"
                                      onClick={() => {
                                        // Switch to invoices tab and expand the linked invoice
                                        setDetailActiveTab("invoices");
                                        setExpandedSupplierInvoiceId(payment.linkedInvoice!.id);
                                      }}
                                      className="bg-[#29318A] text-white text-[13px] font-medium py-[5px] px-[14px] rounded-[7px] self-start cursor-pointer hover:bg-[#3D44A0] transition-colors"
                                    >
                                      חשבונית מקושרת: {payment.linkedInvoice.invoiceNumber || payment.linkedInvoice.date} — ₪{payment.linkedInvoice.totalAmount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Documents Tab */}
              {detailActiveTab === "documents" && (
                <div className="w-full flex flex-col gap-[10px]">
                  {/* Documents List */}
                  <div className="flex flex-col gap-[5px]">
                    {supplierDocuments.length === 0 ? (
                      <div className="flex items-center justify-center py-[30px]">
                        <span className="text-[14px] text-white/50">אין מסמכים להצגה</span>
                      </div>
                    ) : (
                      supplierDocuments.map((doc) => (
                        <div
                          key={doc.id}
                          className="bg-white/5 rounded-[7px] p-[10px] flex items-center justify-between gap-[10px]"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] text-white font-medium truncate">{doc.description}</p>
                            <p className="text-[11px] text-white/40 ltr-num mt-[2px]">
                              {new Date(doc.created_at).toLocaleDateString("he-IL")}
                            </p>
                          </div>
                          <div className="flex items-center gap-[8px] flex-shrink-0">
                            {/* View document */}
                            <Button
                              type="button"
                              title="צפייה במסמך"
                              onClick={() => setViewDocumentUrl(doc.document_url)}
                              className="w-[28px] h-[28px] flex items-center justify-center bg-[#29318A] rounded-[6px] text-white/70 hover:text-white transition-colors"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                              </svg>
                            </Button>
                            {/* Download */}
                            <a
                              href={doc.document_url}
                              download
                              target="_blank"
                              rel="noopener noreferrer"
                              title="הורדה"
                              className="w-[28px] h-[28px] flex items-center justify-center bg-[#29318A] rounded-[6px] text-white/70 hover:text-white transition-colors"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                              </svg>
                            </a>
                            {/* Delete */}
                            <Button
                              type="button"
                              title="מחיקה"
                              onClick={() => handleDeleteDocument(doc.id)}
                              className="w-[28px] h-[28px] flex items-center justify-center bg-[#F64E60]/20 rounded-[6px] text-[#F64E60]/70 hover:text-[#F64E60] transition-colors"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              </svg>
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add Document Form */}
                  <div className="bg-white/5 rounded-[7px] p-[12px] flex flex-col gap-[10px]">
                    <span className="text-[14px] font-medium text-white/80 text-right">הוספת מסמך חדש</span>
                    <Input
                      type="text"
                      placeholder="תיאור המסמך (למשל: חוזה, הסכם...)"
                      value={newDocDescription}
                      onChange={(e) => setNewDocDescription(e.target.value)}
                      className="bg-white/10 border-white/20 text-white text-[14px] text-right placeholder:text-white/30"
                    />
                    <input
                      type="file"
                      accept="*/*"
                      onChange={(e) => setNewDocFile(e.target.files?.[0] || null)}
                      className="text-[13px] text-white/60 file:ml-[10px] file:bg-[#29318A] file:text-white file:border-0 file:rounded-[6px] file:px-[12px] file:py-[6px] file:text-[13px] file:cursor-pointer"
                    />
                    <Button
                      type="button"
                      onClick={handleAddDocument}
                      disabled={isUploadingDoc || !newDocFile || !newDocDescription.trim()}
                      className="w-full bg-[#29318A] text-white text-[14px] font-semibold py-[10px] rounded-[8px] hover:bg-[#3D44A0] transition-colors disabled:opacity-40"
                    >
                      {isUploadingDoc ? "מעלה..." : "הוסף מסמך"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Document Viewer Popup */}
      <Sheet open={!!viewDocumentUrl} onOpenChange={(open) => { if (!open) setViewDocumentUrl(null); }}>
        <SheetContent
          side="bottom"
          className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0f1535] border-t border-[#4C526B] overflow-hidden rounded-t-[20px]"
          showCloseButton={false}
        >
          <SheetHeader className="border-b border-[#4C526B] pb-4">
            <div className="flex justify-between items-center flex-row-reverse">
              <Button
                type="button"
                onClick={() => setViewDocumentUrl(null)}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
              >
                <X className="w-6 h-6" />
              </Button>
              <SheetTitle className="text-white text-xl font-bold">צפייה במסמך</SheetTitle>
              <a
                href={viewDocumentUrl || ""}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="הורדה"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </a>
            </div>
          </SheetHeader>
          <div className="flex-1 w-full h-[calc(100%-60px)] overflow-auto">
            {viewDocumentUrl && (
              /\.(jpg|jpeg|png|webp|gif)$/i.test(viewDocumentUrl) ? (
                <img
                  src={viewDocumentUrl}
                  alt="מסמך"
                  className="w-full h-auto object-contain"
                />
              ) : (
                <iframe
                  src={viewDocumentUrl}
                  className="w-full h-full border-0"
                  title="מסמך"
                />
              )
            )}
          </div>
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
                  <Button
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
                  </Button>
                  <Button
                    type="button"
                    title="מחיקה"
                    onClick={() => {
                      confirm("האם למחוק את הספק?", async () => {
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
                      });
                    }}
                    className="w-[25px] h-[25px] flex items-center justify-center text-white cursor-pointer"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      <line x1="10" y1="11" x2="10" y2="17"/>
                      <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                  </Button>
                </div>

                {/* Scrollable content */}
                <div className="flex flex-col gap-[10px] overflow-y-auto flex-1">
                  {/* שם הספק */}
                  <div className="flex flex-col gap-[3px]">
                    <span className="text-[15px] font-medium text-white text-right">שם הספק</span>
                    <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center">
                      <Input
                        type="text"
                        title="שם הספק"
                        disabled
                        value={selectedSupplier.name}
                        className="w-full h-full bg-transparent text-white text-[14px] text-center outline-none px-[10px]"
                      />
                    </div>
                  </div>

                  {/* Email */}
                  {selectedSupplier.email && (
                    <div className="flex flex-col gap-[3px]">
                      <span className="text-[15px] font-medium text-white text-right">כתובת מייל</span>
                      <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center">
                        <Input
                          type="email"
                          dir="ltr"
                          title="כתובת מייל"
                          disabled
                          value={selectedSupplier.email}
                          className="w-full h-full bg-transparent text-white text-[14px] text-center outline-none px-[10px]"
                        />
                      </div>
                    </div>
                  )}

                  {/* סכום שנלקח */}
                  <div className="flex flex-col gap-[3px]">
                    <span className="text-[15px] font-medium text-white text-right">סכום שנלקח</span>
                    <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center px-[10px]">
                      <Input
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
                      <Input
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
                      <Input
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
                      <Input
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
                            <Input
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
                            <Input
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
                          <Image
                            src={selectedSupplier.obligation_document_url}
                            alt="לוח סילוקין"
                            className="max-h-[200px] object-contain"
                            width={400}
                            height={200}
                            unoptimized
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
                                const fileName = `${generateUUID()}.${fileExt}`;
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
                              const fileName = `${generateUUID()}.${fileExt}`;
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
                  <Button
                    type="button"
                    onClick={() => {
                      setShowObligationDetailPopup(false);
                      setSelectedSupplier(null);
                      setObligationPayments([]);
                    }}
                    className="w-full bg-[#29318A] text-white text-[18px] font-semibold py-[14px] rounded-[10px] hover:bg-[#3D44A0] transition-colors mt-[5px]"
                  >
                    יציאה
                  </Button>
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* Add Commitment Modal */}
      <Sheet open={isAddCommitmentOpen} onOpenChange={(open) => !open && setIsAddCommitmentOpen(false)}>
        <SheetContent
          side="bottom"
          className="h-auto max-h-[80vh] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
          showCloseButton={false}
        >
          <SheetHeader className="border-b border-[#4C526B] pb-4">
            <div className="flex justify-between items-center" dir="ltr">
              <Button type="button" onClick={() => setIsAddCommitmentOpen(false)} className="text-[#7B91B0] hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </Button>
              <SheetTitle className="text-white text-xl font-bold">הוספת התחייבות קודמת</SheetTitle>
              <div className="w-[24px]" />
            </div>
          </SheetHeader>

          <div className="flex flex-col gap-[15px] p-[15px]" dir="rtl">
            <div className="flex flex-col gap-[5px]">
              <label className="text-[14px] font-medium text-white/80 text-right">שם ההתחייבות</label>
              <div className="border border-[#4C526B] rounded-[10px] h-[45px]">
                <Input
                  title="שם ההתחייבות"
                  value={commitmentName}
                  onChange={(e) => setCommitmentName(e.target.value)}
                  placeholder="לדוגמה: הלוואה לרכב"
                  className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                />
              </div>
            </div>

            <div className="flex flex-col gap-[5px]">
              <label className="text-[14px] font-medium text-white/80 text-right">סכום חודשי</label>
              <div className="border border-[#4C526B] rounded-[10px] h-[45px]">
                <Input
                  title="סכום חודשי"
                  type="tel"
                  value={commitmentMonthlyAmount}
                  onChange={(e) => setCommitmentMonthlyAmount(e.target.value)}
                  placeholder="₪"
                  className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                />
              </div>
            </div>

            <div className="flex flex-col gap-[5px]">
              <label className="text-[14px] font-medium text-white/80 text-right">מספר תשלומים</label>
              <div className="border border-[#4C526B] rounded-[10px] h-[45px]">
                <Input
                  title="מספר תשלומים"
                  type="tel"
                  value={commitmentTotalInstallments}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCommitmentTotalInstallments(val);
                    // Auto-calculate end date
                    const installments = parseInt(val);
                    if (installments > 0 && commitmentStartDate) {
                      const start = new Date(commitmentStartDate);
                      start.setMonth(start.getMonth() + installments);
                      const y = start.getFullYear();
                      const m = String(start.getMonth() + 1).padStart(2, "0");
                      const d = String(start.getDate()).padStart(2, "0");
                      setCommitmentEndDate(`${y}-${m}-${d}`);
                    }
                  }}
                  placeholder="לדוגמה: 12"
                  className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                />
              </div>
            </div>

            <div className="flex flex-col gap-[5px]">
              <label className="text-[14px] font-medium text-white/80 text-right">תאריך התחלה</label>
              <DatePickerField
                value={commitmentStartDate}
                onChange={(val) => {
                  setCommitmentStartDate(val);
                  // Auto-calculate end date
                  const installments = parseInt(commitmentTotalInstallments);
                  if (installments > 0 && val) {
                    const start = new Date(val);
                    start.setMonth(start.getMonth() + installments);
                    const y = start.getFullYear();
                    const m = String(start.getMonth() + 1).padStart(2, "0");
                    const d = String(start.getDate()).padStart(2, "0");
                    setCommitmentEndDate(`${y}-${m}-${d}`);
                  }
                }}
                className="h-[45px]"
              />
            </div>

            <div className="flex flex-col gap-[5px]">
              <label className="text-[14px] font-medium text-white/80 text-right">תאריך סיום</label>
              <DatePickerField
                value={commitmentEndDate}
                onChange={(val) => setCommitmentEndDate(val)}
                className="h-[45px]"
              />
            </div>

            <div className="flex flex-col gap-[5px]">
              <label className="text-[14px] font-medium text-white/80 text-right">תנאי הלוואה</label>
              <div className="border border-[#4C526B] rounded-[10px] min-h-[70px]">
                <textarea
                  title="תנאי הלוואה"
                  value={commitmentTerms}
                  onChange={(e) => setCommitmentTerms(e.target.value)}
                  placeholder="ריבית, בנק, מס' הלוואה, תנאים מיוחדים..."
                  className="w-full h-full min-h-[70px] bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[10px] py-[8px] placeholder:text-white/30 resize-none"
                />
              </div>
            </div>

            <Button
              type="button"
              disabled={isSubmittingCommitment || !commitmentName || !commitmentMonthlyAmount || !commitmentStartDate || !commitmentEndDate}
              onClick={async () => {
                if (!selectedBusinesses[0]) {
                  showToast("יש לבחור עסק", "error");
                  return;
                }
                setIsSubmittingCommitment(true);
                const supabase = createClient();
                const { data: user } = await supabase.auth.getUser();
                const { error } = await supabase.from("prior_commitments").insert({
                  business_id: selectedBusinesses[0],
                  name: commitmentName,
                  monthly_amount: parseFloat(commitmentMonthlyAmount) || 0,
                  total_installments: parseInt(commitmentTotalInstallments) || 1,
                  start_date: commitmentStartDate,
                  end_date: commitmentEndDate,
                  terms: commitmentTerms || null,
                  created_by: user?.user?.id || null,
                });
                setIsSubmittingCommitment(false);
                if (error) {
                  showToast(`שגיאה: ${error.message}`, "error");
                  return;
                }
                showToast("התחייבות נוספה בהצלחה", "success");
                setIsAddCommitmentOpen(false);
                setRefreshTrigger((prev) => prev + 1);
              }}
              className="w-full bg-[#29318A] text-white text-[16px] font-semibold py-[12px] rounded-[10px] hover:bg-[#3D44A0] transition-colors"
            >
              {isSubmittingCommitment ? "שומר..." : "שמור התחייבות"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Commitment Detail Modal */}
      <Sheet open={showCommitmentDetail} onOpenChange={(open) => { if (!open) { setShowCommitmentDetail(false); setSelectedCommitment(null); } }}>
        <SheetContent
          side="bottom"
          className="h-auto max-h-[80vh] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
          showCloseButton={false}
        >
          {selectedCommitment && (() => {
            const c = selectedCommitment;
            const startDate = new Date(c.start_date);
            const endDate = new Date(c.end_date);
            const startStr = `${String(startDate.getDate()).padStart(2, "0")}/${String(startDate.getMonth() + 1).padStart(2, "0")}/${startDate.getFullYear()}`;
            const endStr = `${String(endDate.getDate()).padStart(2, "0")}/${String(endDate.getMonth() + 1).padStart(2, "0")}/${endDate.getFullYear()}`;
            const isFinished = c.end_date <= today;
            const nowD = new Date();
            const monthsElapsed = Math.max(0, (nowD.getFullYear() - startDate.getFullYear()) * 12 + (nowD.getMonth() - startDate.getMonth()));
            const remaining = Math.max(0, c.total_installments - monthsElapsed);
            const totalAmount = c.monthly_amount * c.total_installments;
            const remainingAmount = c.monthly_amount * remaining;

            return (
              <div className="flex flex-col gap-[15px] p-[15px]" dir="rtl">
                <SheetHeader className="border-b border-[#4C526B] pb-4">
                  <div className="flex justify-between items-center" dir="ltr">
                    <Button type="button" onClick={() => { setShowCommitmentDetail(false); setSelectedCommitment(null); }} className="text-[#7B91B0] hover:text-white transition-colors">
                      <X className="w-6 h-6" />
                    </Button>
                    <SheetTitle className="text-white text-xl font-bold">{c.name}</SheetTitle>
                    <div className="w-[24px]" />
                  </div>
                </SheetHeader>

                <div className="flex flex-col gap-[10px] bg-[#29318A]/20 rounded-[10px] p-[15px] border border-[#4C526B]">
                  <div className="flex justify-between items-center">
                    <span className="text-[14px] text-white/70">סכום חודשי:</span>
                    <span dir="ltr" className="text-[16px] font-bold text-white">₪{c.monthly_amount.toLocaleString("he-IL")}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[14px] text-white/70">סה״כ תשלומים:</span>
                    <span className="text-[16px] font-bold text-white">{c.total_installments}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[14px] text-white/70">תשלומים שנותרו:</span>
                    <span className={`text-[16px] font-bold ${isFinished ? "text-[#0BB783]" : "text-[#F64E60]"}`}>{remaining}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[14px] text-white/70">סה״כ סכום:</span>
                    <span dir="ltr" className="text-[16px] font-bold text-white">₪{totalAmount.toLocaleString("he-IL")}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[14px] text-white/70">נותר לתשלום:</span>
                    <span dir="ltr" className={`text-[16px] font-bold ${isFinished ? "text-[#0BB783]" : "text-[#F64E60]"}`}>₪{remainingAmount.toLocaleString("he-IL")}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[14px] text-white/70">תאריך התחלה:</span>
                    <span className="text-[16px] text-white">{startStr}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[14px] text-white/70">תאריך סיום:</span>
                    <span className="text-[16px] text-white">{endStr}</span>
                  </div>
                  {isFinished && (
                    <div className="text-center mt-[5px]">
                      <Badge className="text-[14px] bg-[#0BB783]/20 text-[#0BB783] px-[12px] py-[4px] rounded-full font-bold">התחייבות הסתיימה</Badge>
                    </div>
                  )}
                </div>

                <Button
                  type="button"
                  onClick={() => {
                    confirm(
                      `${c.name} תימחק לצמיתות.`,
                      async () => {
                        const supabase = createClient();
                        const { error } = await supabase.from("prior_commitments").update({ deleted_at: new Date().toISOString() }).eq("id", c.id);
                        if (error) {
                          showToast(`שגיאה: ${error.message}`, "error");
                          return;
                        }
                        showToast("התחייבות נמחקה", "success");
                        setShowCommitmentDetail(false);
                        setSelectedCommitment(null);
                        setRefreshTrigger((prev) => prev + 1);
                      },
                      "למחוק את ההתחייבות?"
                    );
                  }}
                  className="w-full bg-[#F64E60]/20 text-[#F64E60] text-[16px] font-semibold py-[12px] rounded-[10px] hover:bg-[#F64E60]/30 transition-colors"
                >
                  מחיקת התחייבות
                </Button>

                <Button
                  type="button"
                  onClick={() => { setShowCommitmentDetail(false); setSelectedCommitment(null); }}
                  className="w-full bg-[#29318A] text-white text-[16px] font-semibold py-[12px] rounded-[10px] hover:bg-[#3D44A0] transition-colors"
                >
                  סגור
                </Button>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* Image/Document Viewer Modal */}
      {viewerDocUrl && typeof window !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80"
          onClick={(e) => { e.stopPropagation(); setViewerDocUrl(null); }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Button
            type="button"
            onClick={(e) => { e.stopPropagation(); setViewerDocUrl(null); }}
            className="absolute top-[16px] right-[16px] z-[20] w-[40px] h-[40px] flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 transition-colors cursor-pointer pointer-events-auto"
          >
            <X size={24} className="text-white" />
          </Button>
          <Button
            type="button"
            onClick={(e) => { e.stopPropagation(); window.open(viewerDocUrl, '_blank'); }}
            className="absolute top-[16px] left-[16px] z-[20] flex items-center gap-[6px] px-[12px] py-[8px] rounded-full bg-black/60 hover:bg-black/80 transition-colors text-white text-[13px] cursor-pointer pointer-events-auto"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            פתח בכרטיסייה חדשה
          </Button>
          <div
            className="max-w-[90vw] max-h-[90vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {isPdfUrl(viewerDocUrl) ? (
              <iframe
                src={viewerDocUrl}
                className="w-[90vw] h-[90vh] rounded-[12px] border border-white/20"
                title="תצוגת מסמך"
              />
            ) : (
              <Image
                src={viewerDocUrl}
                alt="תצוגת מסמך"
                className="max-w-[90vw] max-h-[90vh] object-contain rounded-[12px]"
                width={800}
                height={600}
                unoptimized
              />
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
