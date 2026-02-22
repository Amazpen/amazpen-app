"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useDashboard } from "../layout";
import { useToast } from "@/components/ui/toast";
import { uploadFile } from "@/lib/uploadFile";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useFormDraft } from "@/hooks/useFormDraft";
import { generateUUID } from "@/lib/utils";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Business from businesses table
interface Business {
  id: string;
  name: string;
  business_type: string | null;
  status: string | null;
  tax_id: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  vat_percentage?: number | null;
  created_at: string;
  deleted_at: string | null;
}

// Customer record linked to a business
interface Customer {
  id: string;
  business_id: string | null;
  contact_name: string;
  business_name: string;
  company_name: string | null;
  tax_id: string | null;
  work_start_date: string | null;
  setup_fee: string | null;
  payment_terms: string | null;
  agreement_url: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Retainer fields
  retainer_amount: number | null;
  retainer_type: 'monthly' | 'one_time' | 'fixed_term' | null;
  retainer_months: number | null;
  retainer_start_date: string | null;
  retainer_end_date: string | null;
  retainer_day_of_month: number | null;
  retainer_status: 'active' | 'paused' | 'completed' | null;
  linked_income_source_id: string | null;
  labor_type: 'global' | 'hourly' | null;
  labor_monthly_salary: number | null;
  labor_hourly_rate: number | null;
}

// Combined display item
interface CustomerDisplay {
  business: Business;
  customer: Customer | null;
  members: BusinessMember[];
}

// Customer service type
interface CustomerService {
  id: string;
  customer_id: string;
  name: string;
  amount: number;
  service_date: string;
  notes: string | null;
  created_at: string;
  deleted_at: string | null;
}

// Customer payment type
interface CustomerPayment {
  id: string;
  customer_id: string;
  payment_date: string;
  amount: number;
  description: string | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
  deleted_at: string | null;
}

// Business member
interface BusinessMember {
  user_id: string;
  role: string;
  profiles: {
    id: string;
    full_name: string | null;
    email: string;
  };
}

const paymentMethodLabels: Record<string, string> = {
  bank_transfer: "העברה בנקאית",
  credit: "אשראי",
  cash: "מזומן",
  bit: "ביט",
  paybox: "פייבוקס",
  check: "צ׳ק",
  other: "אחר",
};

export default function CustomersPage() {
  const { isAdmin } = useDashboard();
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Draft persistence
  const draftKey = "customerForm:draft";
  const { saveDraft, restoreDraft, clearDraft, resetCleared } = useFormDraft(draftKey);
  const draftRestored = useRef(false);

  // List state
  const [displayItems, setDisplayItems] = useState<CustomerDisplay[]>([]);
  const [standaloneCustomers, setStandaloneCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Add/Edit form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formBusinessId, setFormBusinessId] = useState<string | null>(null);
  const [formBusinessName, setFormBusinessName] = useState("");

  // Form fields
  const [fContactName, setFContactName] = useState("");
  const [fBusinessName, setFBusinessName] = useState("");
  const [fCompanyName, setFCompanyName] = useState("");
  const [fTaxId, setFTaxId] = useState("");
  const [fWorkStartDate, setFWorkStartDate] = useState("");
  const [fSetupFee, setFSetupFee] = useState("");
  const [fPaymentTerms, setFPaymentTerms] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fIsActive, setFIsActive] = useState(true);
  const [agreementFile, setAgreementFile] = useState<File | null>(null);
  const [fRetainerAmount, setFRetainerAmount] = useState("");
  const [fRetainerType, setFRetainerType] = useState<string>("");
  const [fRetainerMonths, setFRetainerMonths] = useState("");
  const [fRetainerStartDate, setFRetainerStartDate] = useState("");
  const [fRetainerDayOfMonth, setFRetainerDayOfMonth] = useState("1");

  // Detail popup state
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CustomerDisplay | null>(null);
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [detailMonth, setDetailMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Add payment sub-form
  const [isAddPaymentOpen, setIsAddPaymentOpen] = useState(false);
  const [newPaymentDate, setNewPaymentDate] = useState("");
  const [newPaymentAmount, setNewPaymentAmount] = useState("");
  const [newPaymentDescription, setNewPaymentDescription] = useState("");
  const [newPaymentMethod, setNewPaymentMethod] = useState("");
  const [newPaymentNotes, setNewPaymentNotes] = useState("");

  // Services state
  const [services, setServices] = useState<CustomerService[]>([]);
  const [isAddServiceOpen, setIsAddServiceOpen] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [newServiceAmount, setNewServiceAmount] = useState("");
  const [newServiceDate, setNewServiceDate] = useState("");
  const [newServiceNotes, setNewServiceNotes] = useState("");

  // Labor cost form state
  const [fLaborType, setFLaborType] = useState<string>("");
  const [fLaborMonthlySalary, setFLaborMonthlySalary] = useState("");
  const [fLaborHourlyRate, setFLaborHourlyRate] = useState("");

  // Survey state
  const [customerSurvey, setCustomerSurvey] = useState<{id: string; token: string; is_completed: boolean; created_at: string} | null>(null);
  const [surveyResponses, setSurveyResponses] = useState<{question_key: string; answer_value: string}[]>([]);

  // Available businesses for "add standalone" form
  const [allBusinesses, setAllBusinesses] = useState<Business[]>([]);

  // Dynamic VAT multiplier based on selected business
  const vatMultiplier = useMemo(() => {
    const biz = formBusinessId ? allBusinesses.find(b => b.id === formBusinessId) : null;
    const rate = Number(biz?.vat_percentage) || 0.18;
    return 1 + rate;
  }, [formBusinessId, allBusinesses]);

  // ─── Data Fetching ─────────────────────────────────────────

  useEffect(() => {
    async function fetchData() {
      if (!isAdmin) return;
      setIsLoading(true);
      const supabase = createClient();

      const [
        { data: businesses },
        { data: customers },
        { data: members },
      ] = await Promise.all([
        supabase
          .from("businesses")
          .select("*")
          .is("deleted_at", null)
          .order("name"),
        supabase
          .from("customers")
          .select("*")
          .is("deleted_at", null),
        supabase
          .from("business_members")
          .select("user_id, role, business_id, profiles(id, full_name, email)"),
      ]);

      const businessList = businesses || [];
      const customerList = customers || [];
      const memberList = (members as unknown as (BusinessMember & { business_id: string })[]) || [];

      setAllBusinesses(businessList);

      // Map businesses to display items
      const items: CustomerDisplay[] = businessList.map((biz) => ({
        business: biz,
        customer: customerList.find((c) => c.business_id === biz.id) || null,
        members: memberList.filter((m) => m.business_id === biz.id),
      }));

      setDisplayItems(items);

      // Standalone customers (not linked to any business)
      const standalone = customerList.filter(
        (c) => !c.business_id || !businessList.some((b) => b.id === c.business_id)
      );
      setStandaloneCustomers(standalone);

      setIsLoading(false);
    }
    fetchData();
  }, [isAdmin, refreshTrigger, showToast]);

  // ─── Detail Fetching ───────────────────────────────────────

  const fetchPayments = useCallback(async (customerId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("customer_payments")
      .select("*")
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .order("payment_date", { ascending: false });
    setPayments(data || []);
  }, []);

  const fetchServices = useCallback(async (customerId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("customer_services")
      .select("*")
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .order("service_date", { ascending: false });
    setServices(data || []);
  }, []);

  // ─── Monthly payments computed ─────────────────────────────

  const monthlyPayments = payments.filter((p) => {
    const d = new Date(p.payment_date);
    return d.getFullYear() === detailMonth.getFullYear() && d.getMonth() === detailMonth.getMonth();
  });
  const monthlyTotal = monthlyPayments.reduce((sum, p) => sum + Number(p.amount), 0);
  const totalIncome = payments.reduce((sum, p) => sum + Number(p.amount), 0);

  // ─── Handlers ──────────────────────────────────────────────

  const handleOpenDetail = async (item: CustomerDisplay) => {
    setSelectedItem(item);
    setDetailMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    setIsAddPaymentOpen(false);
    setIsAddServiceOpen(false);
    setCustomerSurvey(null);
    setSurveyResponses([]);
    setIsDetailOpen(true);
    if (item.customer) {
      await Promise.all([
        fetchPayments(item.customer.id),
        fetchServices(item.customer.id),
      ]);

      // Fetch survey if retainer completed
      if (item.customer.retainer_status === 'completed') {
        const supabase = createClient();
        const { data: survey } = await supabase
          .from("customer_surveys")
          .select("id, token, is_completed, created_at")
          .eq("customer_id", item.customer.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        setCustomerSurvey(survey);
        if (survey?.is_completed) {
          const { data: responses } = await supabase
            .from("customer_survey_responses")
            .select("question_key, answer_value")
            .eq("survey_id", survey.id);
          setSurveyResponses(responses || []);
        }
      }
    } else {
      setPayments([]);
      setServices([]);
    }
  };

  const handleCloseDetail = () => {
    setIsDetailOpen(false);
    setSelectedItem(null);
    setPayments([]);
    setServices([]);
    setCustomerSurvey(null);
    setSurveyResponses([]);
  };

  const resetForm = () => {
    setFContactName("");
    setFBusinessName("");
    setFCompanyName("");
    setFTaxId("");
    setFWorkStartDate("");
    setFSetupFee("");
    setFPaymentTerms("");
    setFNotes("");
    setFIsActive(true);
    setAgreementFile(null);
    setFormBusinessId(null);
    setFormBusinessName("");
    setFRetainerAmount("");
    setFRetainerType("");
    setFRetainerMonths("");
    setFRetainerStartDate("");
    setFRetainerDayOfMonth("1");
    setFLaborType("");
    setFLaborMonthlySalary("");
    setFLaborHourlyRate("");
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setIsEditMode(false);
    setEditingCustomer(null);
    resetForm();
  };

  // Open form to create/edit customer record for a business
  const handleSetupCustomer = (item: CustomerDisplay) => {
    setFormBusinessId(item.business.id);
    setFormBusinessName(item.business.name);

    if (item.customer) {
      // Edit existing customer record
      setFContactName(item.customer.contact_name);
      setFBusinessName(item.customer.business_name);
      setFCompanyName(item.customer.company_name || "");
      setFTaxId(item.customer.tax_id || item.business.tax_id || "");
      setFWorkStartDate(item.customer.work_start_date || "");
      setFSetupFee(item.customer.setup_fee || "");
      setFPaymentTerms(item.customer.payment_terms || "");
      setFNotes(item.customer.notes || "");
      setFIsActive(item.customer.is_active);
      setFRetainerAmount(item.customer.retainer_amount != null ? String(item.customer.retainer_amount) : "");
      setFRetainerType(item.customer.retainer_type || "");
      setFRetainerMonths(item.customer.retainer_months != null ? String(item.customer.retainer_months) : "");
      setFRetainerStartDate(item.customer.retainer_start_date || "");
      setFRetainerDayOfMonth(item.customer.retainer_day_of_month != null ? String(item.customer.retainer_day_of_month) : "1");
      setFLaborType(item.customer.labor_type || "");
      setFLaborMonthlySalary(item.customer.labor_monthly_salary != null ? String(item.customer.labor_monthly_salary) : "");
      setFLaborHourlyRate(item.customer.labor_hourly_rate != null ? String(item.customer.labor_hourly_rate) : "");
      setEditingCustomer(item.customer);
      setIsEditMode(true);
    } else {
      // New customer record for this business
      resetForm();
      setFormBusinessId(item.business.id);
      setFormBusinessName(item.business.name);
      setFBusinessName(item.business.name);
      setFTaxId(item.business.tax_id || "");
      setIsEditMode(false);
    }

    setIsDetailOpen(false);
    setIsFormOpen(true);
  };

  // Open form for standalone customer (not linked to existing business)
  const handleAddStandaloneCustomer = () => {
    resetForm();
    resetCleared();
    setFormBusinessId(null);
    setFormBusinessName("");
    setIsEditMode(false);
    setEditingCustomer(null);
    setIsFormOpen(true);
  };

  const handleEditCustomer = () => {
    if (!selectedItem) return;
    handleSetupCustomer(selectedItem);
  };

  const handleSaveCustomer = async () => {
    if (!fContactName.trim() || !fBusinessName.trim()) {
      showToast("שם הלקוח ושם העסק הם שדות חובה", "error");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();

    try {
      let agreementUrl = isEditMode ? editingCustomer?.agreement_url || null : null;

      if (agreementFile) {
        const ext = agreementFile.name.split(".").pop() || "pdf";
        const path = `customer-agreements/${generateUUID()}.${ext}`;
        const result = await uploadFile(agreementFile, path, "assets");
        if (result.success && result.publicUrl) {
          agreementUrl = result.publicUrl;
        } else {
          showToast(result.error || "שגיאה בהעלאת הקובץ", "error");
          setIsSubmitting(false);
          return;
        }
      }

      // Parse retainer fields
      const retainerAmount = fRetainerAmount ? parseFloat(fRetainerAmount) : null;
      const retainerType = (fRetainerType as 'monthly' | 'one_time' | 'fixed_term') || null;
      const retainerMonths = fRetainerMonths ? parseInt(fRetainerMonths, 10) : null;
      const retainerDayOfMonth = fRetainerDayOfMonth ? parseInt(fRetainerDayOfMonth, 10) : null;

      // Compute end date for fixed_term
      let retainerEndDate: string | null = null;
      if (retainerType === 'fixed_term' && fRetainerStartDate && retainerMonths) {
        const startDate = new Date(fRetainerStartDate);
        startDate.setMonth(startDate.getMonth() + retainerMonths);
        retainerEndDate = startDate.toISOString().split('T')[0];
      }

      const customerData = {
        business_id: formBusinessId || null,
        contact_name: fContactName.trim(),
        business_name: fBusinessName.trim(),
        company_name: fCompanyName.trim() || null,
        tax_id: fTaxId.trim() || null,
        work_start_date: fWorkStartDate || null,
        setup_fee: fSetupFee.trim() || null,
        payment_terms: fPaymentTerms.trim() || null,
        agreement_url: agreementUrl,
        notes: fNotes.trim() || null,
        is_active: fIsActive,
        retainer_amount: retainerAmount,
        retainer_type: retainerType,
        retainer_months: retainerMonths,
        retainer_start_date: fRetainerStartDate || null,
        retainer_end_date: retainerEndDate,
        retainer_day_of_month: retainerDayOfMonth,
        retainer_status: retainerAmount && retainerAmount > 0 ? (isEditMode && editingCustomer?.retainer_status ? editingCustomer.retainer_status : 'active' as const) : null,
        labor_type: fLaborType || null,
        labor_monthly_salary: fLaborMonthlySalary ? parseFloat(fLaborMonthlySalary) : null,
        labor_hourly_rate: fLaborHourlyRate ? parseFloat(fLaborHourlyRate) : null,
      };

      let savedCustomerId: string | null = null;
      let existingLinkedSourceId: string | null = null;

      if (isEditMode && editingCustomer) {
        savedCustomerId = editingCustomer.id;
        existingLinkedSourceId = editingCustomer.linked_income_source_id || null;

        const { error } = await supabase
          .from("customers")
          .update(customerData)
          .eq("id", editingCustomer.id);

        if (error) {
          showToast("שגיאה בעדכון לקוח", "error");
          console.error(error);
          setIsSubmitting(false);
          return;
        }
        showToast("הלקוח עודכן בהצלחה", "success");
      } else {
        savedCustomerId = generateUUID();
        const { error } = await supabase
          .from("customers")
          .insert({ id: savedCustomerId, ...customerData });

        if (error) {
          showToast("שגיאה בשמירת לקוח", "error");
          console.error(error);
          setIsSubmitting(false);
          return;
        }
        showToast("הלקוח נשמר בהצלחה", "success");
        clearDraft();
      }

      // Create linked income_source if retainer amount > 0 and no existing link
      if (retainerAmount && retainerAmount > 0 && !existingLinkedSourceId && formBusinessId && savedCustomerId) {
        const incomeSourceId = generateUUID();
        const { error: incomeError } = await supabase
          .from("income_sources")
          .insert({
            id: incomeSourceId,
            business_id: formBusinessId,
            name: `ריטיינר — ${fBusinessName.trim()}`,
            type: "retainer",
            is_active: true,
          });

        if (!incomeError) {
          // Link the income source to the customer
          await supabase
            .from("customers")
            .update({ linked_income_source_id: incomeSourceId })
            .eq("id", savedCustomerId);
        } else {
          console.error("Error creating income source:", incomeError);
        }
      }

      setRefreshTrigger((prev) => prev + 1);
      handleCloseForm();
    } catch (err) {
      console.error("Save error:", err);
      showToast("שגיאה בשמירת לקוח", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCustomer = () => {
    if (!selectedItem?.customer) return;
    if (payments.length > 0) {
      showToast("לא ניתן למחוק לקוח עם תשלומים קיימים", "error");
      return;
    }
    confirm("האם למחוק את רשומת הלקוח?", async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("customers")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", selectedItem!.customer!.id);

      if (error) {
        showToast("שגיאה במחיקת לקוח", "error");
      } else {
        showToast("הלקוח נמחק", "success");
        handleCloseDetail();
        setRefreshTrigger((prev) => prev + 1);
      }
    });
  };

  // ─── Payment Handlers ─────────────────────────────────────

  const handleAddPayment = async () => {
    if (!selectedItem?.customer || !newPaymentDate || !newPaymentAmount) return;

    const amount = parseFloat(newPaymentAmount);
    if (isNaN(amount) || amount <= 0) {
      showToast("יש להזין סכום תקין", "error");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.from("customer_payments").insert({
      id: generateUUID(),
      customer_id: selectedItem.customer.id,
      payment_date: newPaymentDate,
      amount,
      description: newPaymentDescription.trim() || null,
      payment_method: newPaymentMethod || null,
      notes: newPaymentNotes.trim() || null,
    });

    if (error) {
      showToast("שגיאה בשמירת תשלום", "error");
      console.error(error);
    } else {
      showToast("התשלום נשמר", "success");
      setNewPaymentDate("");
      setNewPaymentAmount("");
      setNewPaymentDescription("");
      setNewPaymentMethod("");
      setNewPaymentNotes("");
      setIsAddPaymentOpen(false);
      await fetchPayments(selectedItem.customer.id);
    }
    setIsSubmitting(false);
  };

  const handleDeletePayment = (paymentId: string) => {
    if (!selectedItem?.customer) return;
    confirm("האם למחוק את התשלום?", async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("customer_payments")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", paymentId);

      if (error) {
        showToast("שגיאה במחיקת תשלום", "error");
      } else {
        showToast("התשלום נמחק", "success");
        await fetchPayments(selectedItem!.customer!.id);
      }
    });
  };

  // ─── Service Handlers ────────────────────────────────────

  const handleAddService = async () => {
    if (!selectedItem?.customer || !newServiceName.trim() || !newServiceAmount) return;

    const amount = parseFloat(newServiceAmount);
    if (isNaN(amount) || amount <= 0) {
      showToast("יש להזין סכום תקין", "error");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const serviceId = generateUUID();
    const customerId = selectedItem.customer.id;
    const customerBusinessName = selectedItem.business.name;

    const { error } = await supabase.from("customer_services").insert({
      id: serviceId,
      customer_id: customerId,
      name: newServiceName.trim(),
      amount,
      service_date: newServiceDate || new Date().toISOString().split('T')[0],
      notes: newServiceNotes.trim() || null,
    });

    if (error) {
      showToast("שגיאה בשמירת שירות", "error");
      console.error(error);
    } else {
      // Also create income_source and daily_income_breakdown entry
      const incomeSourceId = generateUUID();
      const businessId = selectedItem.business.id;
      if (businessId) {
        const { error: incomeError } = await supabase.from("income_sources").insert({
          id: incomeSourceId,
          business_id: businessId,
          name: `שירות — ${newServiceName.trim()} (${customerBusinessName})`,
          type: "service",
          is_active: true,
        });

        if (!incomeError) {
          await supabase.from("daily_income_breakdown").insert({
            id: generateUUID(),
            business_id: businessId,
            income_source_id: incomeSourceId,
            date: newServiceDate || new Date().toISOString().split('T')[0],
            amount,
          });
        }
      }

      showToast("השירות נשמר", "success");
      setNewServiceName("");
      setNewServiceAmount("");
      setNewServiceDate("");
      setNewServiceNotes("");
      setIsAddServiceOpen(false);
      await fetchServices(customerId);
    }
    setIsSubmitting(false);
  };

  const handleDeleteService = (serviceId: string) => {
    if (!selectedItem?.customer) return;
    confirm("האם למחוק את השירות?", async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("customer_services")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", serviceId);

      if (error) {
        showToast("שגיאה במחיקת שירות", "error");
      } else {
        showToast("השירות נמחק", "success");
        await fetchServices(selectedItem!.customer!.id);
      }
    });
  };

  // ─── Draft Persistence ────────────────────────────────────

  const saveDraftData = useCallback(() => {
    if (!isFormOpen || isEditMode) return;
    saveDraft({
      fContactName, fBusinessName, fCompanyName, fTaxId,
      fWorkStartDate, fSetupFee, fPaymentTerms, fNotes,
      fRetainerAmount, fRetainerType, fRetainerMonths, fRetainerStartDate, fRetainerDayOfMonth,
      fLaborType, fLaborMonthlySalary, fLaborHourlyRate,
    });
  }, [saveDraft, isFormOpen, isEditMode, fContactName, fBusinessName, fCompanyName, fTaxId, fWorkStartDate, fSetupFee, fPaymentTerms, fNotes, fRetainerAmount, fRetainerType, fRetainerMonths, fRetainerStartDate, fRetainerDayOfMonth, fLaborType, fLaborMonthlySalary, fLaborHourlyRate]);

  useEffect(() => {
    if (draftRestored.current) saveDraftData();
  }, [saveDraftData]);

  useEffect(() => {
    if (isFormOpen && !isEditMode && !formBusinessId) {
      resetCleared();
      draftRestored.current = false;
      setTimeout(() => {
        const draft = restoreDraft();
        if (draft) {
          if (draft.fContactName) setFContactName(draft.fContactName as string);
          if (draft.fBusinessName) setFBusinessName(draft.fBusinessName as string);
          if (draft.fCompanyName) setFCompanyName(draft.fCompanyName as string);
          if (draft.fTaxId) setFTaxId(draft.fTaxId as string);
          if (draft.fWorkStartDate) setFWorkStartDate(draft.fWorkStartDate as string);
          if (draft.fSetupFee) setFSetupFee(draft.fSetupFee as string);
          if (draft.fPaymentTerms) setFPaymentTerms(draft.fPaymentTerms as string);
          if (draft.fNotes) setFNotes(draft.fNotes as string);
          if (draft.fRetainerAmount) setFRetainerAmount(draft.fRetainerAmount as string);
          if (draft.fRetainerType) setFRetainerType(draft.fRetainerType as string);
          if (draft.fRetainerMonths) setFRetainerMonths(draft.fRetainerMonths as string);
          if (draft.fRetainerStartDate) setFRetainerStartDate(draft.fRetainerStartDate as string);
          if (draft.fRetainerDayOfMonth) setFRetainerDayOfMonth(draft.fRetainerDayOfMonth as string);
          if (draft.fLaborType) setFLaborType(draft.fLaborType as string);
          if (draft.fLaborMonthlySalary) setFLaborMonthlySalary(draft.fLaborMonthlySalary as string);
          if (draft.fLaborHourlyRate) setFLaborHourlyRate(draft.fLaborHourlyRate as string);
        }
        draftRestored.current = true;
      }, 0);
    } else {
      draftRestored.current = true;
    }
  }, [isFormOpen, isEditMode, formBusinessId, restoreDraft, resetCleared]);

  // ─── Filtering ─────────────────────────────────────────────

  const filteredItems = displayItems.filter(
    (item) =>
      !searchQuery ||
      item.business.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.customer?.contact_name?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
      (item.business.tax_id?.includes(searchQuery) ?? false)
  );

  const filteredStandalone = standaloneCustomers.filter(
    (c) =>
      !searchQuery ||
      c.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.contact_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalCount = filteredItems.length + filteredStandalone.length;

  // ─── Access Guard ──────────────────────────────────────────

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-[#979797]">אין הרשאה לצפות בדף זה</span>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────

  return (
    <div dir="rtl" className="flex flex-col min-h-[calc(100vh-52px)] min-h-[calc(100dvh-52px)] text-white px-[5px] md:px-[20px] lg:px-[40px] py-[5px] pb-[80px] gap-[10px] mx-auto w-full max-w-[1600px]">
      <ConfirmDialog />
      {/* Header */}
      <div className="flex flex-col gap-[7px] p-[5px]">
        {/* Add Standalone Customer Button */}
        <Button
          variant="default"
          type="button"
          onClick={handleAddStandaloneCustomer}
          className="w-full md:w-auto min-h-[50px] bg-[#6B21A8] text-white text-[16px] font-semibold rounded-[5px] px-[24px] py-[12px] transition-colors duration-200 hover:bg-[#7C3AED] shadow-[0_7px_30px_-10px_rgba(41,49,138,0.1)]"
        >
          הוספת לקוח חדש
        </Button>
      </div>

      {/* Main Content Container */}
      <div className="flex-1 flex flex-col bg-[#0F1535] rounded-[10px] p-[5px_7px]">
        {/* Count and Search */}
        <div className="flex items-center gap-[10px] mb-[10px]">
          <Button
            variant="ghost"
            size="icon-sm"
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
              placeholder="חיפוש לקוח..."
              className="bg-[#6B21A8]/30 border border-[#6B6B6B] rounded-[7px] px-[12px] py-[6px] text-white text-[14px] placeholder:text-white/50 focus:outline-none focus:border-[#6B21A8] flex-1 text-right"
              autoFocus
            />
          ) : (
            <span className="text-[18px] font-bold text-white">{totalCount} לקוחות</span>
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto mt-[15px] mx-0">
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-[26px]">
              {[...Array(6)].map((_, i) => (
                <div
                  key={`skeleton-${i}`}
                  className="bg-[#6B21A8] rounded-[10px] p-[7px] min-h-[170px] flex flex-col items-center justify-center gap-[10px] animate-pulse"
                >
                  <div className="w-[120px] flex justify-center">
                    <div className="h-[16px] bg-white/20 rounded w-[100px]" />
                  </div>
                  <div className="w-[80px] flex justify-center">
                    <div className="h-[14px] bg-white/10 rounded w-[70px]" />
                  </div>
                </div>
              ))}
            </div>
          ) : totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-[50px]">
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none" className="text-[#979797] mb-[10px]">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-[14px] text-[#979797]">
                {searchQuery ? "לא נמצאו לקוחות" : "אין לקוחות עדיין"}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-[26px]">
              {/* Business-linked cards */}
              {filteredItems.map((item) => (
                <Button
                  variant="ghost"
                  key={item.business.id}
                  type="button"
                  onClick={() => handleOpenDetail(item)}
                  className={`bg-[#6B21A8] rounded-[10px] p-[7px] min-h-[170px] h-auto flex flex-col items-center justify-center gap-[10px] transition-colors duration-200 hover:bg-[#7C3AED] cursor-pointer relative ${item.customer && !item.customer.is_active ? "opacity-40" : ""}`}
                >
                  {/* Setup badge */}
                  {!item.customer && (
                    <Badge className="absolute top-[6px] left-[6px] text-[10px] bg-[#F6A609]/80 text-white px-[6px] py-[2px] rounded-full font-bold">
                      טרם הוקם
                    </Badge>
                  )}

                  {/* Inactive badge */}
                  {item.customer && !item.customer.is_active && (
                    <Badge className="absolute top-[6px] left-[6px] text-[10px] bg-[#F64E60]/80 text-white px-[6px] py-[2px] rounded-full font-bold">
                      לא פעיל
                    </Badge>
                  )}

                  {/* Business Logo */}
                  {item.business.logo_url ? (
                    <Image
                      src={item.business.logo_url}
                      alt={item.business.name}
                      className="w-[60px] h-[60px] rounded-full object-cover border-2 border-white/20"
                      width={60}
                      height={60}
                      unoptimized
                      loading="eager"
                    />
                  ) : (
                    <div className="w-[60px] h-[60px] rounded-full bg-white/10 flex items-center justify-center border-2 border-white/20">
                      <span className="text-[22px] font-bold text-white/60">{item.business.name.charAt(0)}</span>
                    </div>
                  )}

                  {/* Business Name */}
                  <div className="w-full max-w-[160px] text-center px-[4px]">
                    <span className="text-[18px] font-bold text-white leading-[1.4]">
                      {item.business.name}
                    </span>
                  </div>

                  {/* Contact name */}
                  {item.customer && (
                    <span className="text-[14px] text-white/70 text-center">{item.customer.contact_name}</span>
                  )}

                  {/* Members count */}
                  <span className="text-[12px] text-white/50">
                    {item.members.length} משתמשים
                  </span>

                  {/* Retainer info */}
                  {item.customer?.retainer_amount && item.customer.retainer_amount > 0 && (
                    <div className="flex flex-col items-center gap-[4px]">
                      <span className="text-[13px] text-purple-300 font-medium">
                        ₪{item.customer.retainer_amount.toLocaleString("he-IL")}
                      </span>
                      {item.customer.retainer_status && (
                        <Badge className={`text-[10px] px-[6px] py-[1px] rounded-full font-bold ${
                          item.customer.retainer_status === 'active'
                            ? 'bg-[#0BB783]/20 text-[#0BB783]'
                            : item.customer.retainer_status === 'paused'
                            ? 'bg-[#F6A609]/20 text-[#F6A609]'
                            : 'bg-white/10 text-white/50'
                        }`}>
                          {item.customer.retainer_status === 'active' ? 'פעיל' : item.customer.retainer_status === 'paused' ? 'מושהה' : 'הסתיים'}
                        </Badge>
                      )}
                    </div>
                  )}
                </Button>
              ))}

              {/* Standalone customers (not linked to business) */}
              {filteredStandalone.map((customer) => (
                <Button
                  variant="ghost"
                  key={customer.id}
                  type="button"
                  onClick={() => handleOpenDetail({
                    business: { id: "", name: customer.business_name, business_type: null, status: null, tax_id: customer.tax_id, address: null, city: null, phone: null, email: null, logo_url: null, created_at: "", deleted_at: null },
                    customer,
                    members: [],
                  })}
                  className={`bg-[#6B21A8] rounded-[10px] p-[7px] min-h-[170px] h-auto flex flex-col items-center justify-center gap-[10px] transition-colors duration-200 hover:bg-[#7C3AED] cursor-pointer relative ${!customer.is_active ? "opacity-40" : ""}`}
                >
                  {!customer.is_active && (
                    <Badge className="absolute top-[6px] left-[6px] text-[10px] bg-[#F64E60]/80 text-white px-[6px] py-[2px] rounded-full font-bold">
                      לא פעיל
                    </Badge>
                  )}

                  <Badge className="absolute top-[6px] right-[6px] text-[10px] bg-[#4C526B] text-white px-[6px] py-[2px] rounded-full font-bold">
                    עצמאי
                  </Badge>

                  <div className="w-full max-w-[160px] text-center px-[4px]">
                    <span className="text-[18px] font-bold text-white leading-[1.4]">
                      {customer.business_name}
                    </span>
                  </div>

                  <span className="text-[14px] text-white/70 text-center">{customer.contact_name}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ═══ Add/Edit Customer Form Sheet ═══ */}
      <Sheet open={isFormOpen} onOpenChange={(open) => !open && handleCloseForm()}>
        <SheetContent
          side="bottom"
          className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
          showCloseButton={false}
        >
          <SheetHeader className="border-b border-[#4C526B] pb-4">
            <div className="flex justify-between items-center" dir="ltr">
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={handleCloseForm}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </Button>
              <SheetTitle className="text-white text-xl font-bold">
                {isEditMode ? "עריכת לקוח" : formBusinessId ? `הקמת לקוח - ${formBusinessName}` : "הוספת לקוח חדש"}
              </SheetTitle>
              <div className="w-[24px]" />
            </div>
          </SheetHeader>

          <div className="flex flex-col gap-[10px] px-[5px]" dir="rtl">
            {/* שם הלקוח */}
            <div className="flex flex-col gap-[5px]">
              <label className="text-[15px] font-medium text-white text-right">שם הלקוח</label>
              <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                <Input
                  type="text"
                  title="שם הלקוח"
                  value={fContactName}
                  onChange={(e) => setFContactName(e.target.value)}
                  placeholder="לדוגמה: דוד סרור"
                  className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                />
              </div>
            </div>

            {/* שם העסק */}
            <div className="flex flex-col gap-[5px]">
              <label className="text-[15px] font-medium text-white text-right">שם העסק</label>
              <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                {formBusinessId ? (
                  <div className="w-full h-full flex items-center justify-center text-white text-[14px] px-[10px] opacity-70">
                    {formBusinessName}
                  </div>
                ) : (
                  <Input
                    type="text"
                    title="שם העסק"
                    value={fBusinessName}
                    onChange={(e) => setFBusinessName(e.target.value)}
                    placeholder='לדוגמה: פרגו נ"צ'
                    className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                  />
                )}
              </div>
            </div>

            {/* שם החברה */}
            <div className="flex flex-col gap-[5px]">
              <label className="text-[15px] font-medium text-white text-right">שם החברה</label>
              <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                <Input
                  type="text"
                  title="שם החברה"
                  value={fCompanyName}
                  onChange={(e) => setFCompanyName(e.target.value)}
                  placeholder="לא רלוונטי"
                  className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                />
              </div>
            </div>

            {/* ע.מ/ח.פ */}
            <div className="flex flex-col gap-[5px]">
              <label className="text-[15px] font-medium text-white text-right">ע.מ/ח.פ</label>
              <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                <Input
                  type="tel"
                  title="ע.מ/ח.פ"
                  value={fTaxId}
                  onChange={(e) => setFTaxId(e.target.value)}
                  placeholder="123456789"
                  className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                />
              </div>
            </div>

            {/* תאריך תחילת עבודה */}
            <div className="flex flex-col gap-[5px]">
              <label className="text-[15px] font-medium text-white text-right">תאריך תחילת עבודה</label>
              <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                <Input
                  type="date"
                  title="תאריך תחילת עבודה"
                  value={fWorkStartDate}
                  onChange={(e) => setFWorkStartDate(e.target.value)}
                  className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
                />
              </div>
            </div>

            {/* דמי הקמה */}
            <div className="flex flex-col gap-[5px]">
              <label className="text-[15px] font-medium text-white text-right">דמי הקמה</label>
              <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                <Input
                  type="text"
                  title="דמי הקמה"
                  value={fSetupFee}
                  onChange={(e) => setFSetupFee(e.target.value)}
                  placeholder="לדוגמה: 600 במקום 1200"
                  className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                />
              </div>
            </div>

            {/* תנאי תשלום */}
            <div className="flex flex-col gap-[5px]">
              <label className="text-[15px] font-medium text-white text-right">תנאי תשלום</label>
              <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                <Input
                  type="text"
                  title="תנאי תשלום"
                  value={fPaymentTerms}
                  onChange={(e) => setFPaymentTerms(e.target.value)}
                  placeholder="לדוגמה: ריטיינר חודשי"
                  className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                />
              </div>
            </div>

            {/* הסכם עבודה - file upload */}
            <div className="flex flex-col gap-[5px]">
              <label className="text-[15px] font-medium text-white text-right">הסכם עבודה</label>
              <label className="border border-[#4C526B] border-dashed rounded-[10px] min-h-[80px] px-[10px] py-[15px] flex flex-col items-center justify-center gap-[8px] cursor-pointer hover:border-[#6B21A8] transition-colors">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[#979797]">
                  <path d="M12 16V8M12 8L9 11M12 8L15 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 15V16C3 18.2091 4.79086 20 7 20H17C19.2091 20 21 18.2091 21 16V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-[14px] text-[#979797]">
                  {agreementFile ? agreementFile.name : isEditMode && editingCustomer?.agreement_url ? "הסכם קיים - לחץ להחלפה" : "לחץ להעלאת קובץ"}
                </span>
                <input
                  type="file"
                  title="העלאת הסכם"
                  onChange={(e) => setAgreementFile(e.target.files?.[0] || null)}
                  className="hidden"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                />
              </label>
            </div>

            {/* הערות */}
            <div className="flex flex-col gap-[5px]">
              <label className="text-[15px] font-medium text-white text-right">הערות</label>
              <div className="border border-[#4C526B] rounded-[10px] min-h-[80px] px-[10px] py-[8px]">
                <Textarea
                  title="הערות"
                  value={fNotes}
                  onChange={(e) => setFNotes(e.target.value)}
                  placeholder="הערות נוספות..."
                  className="w-full h-full min-h-[60px] bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none resize-none placeholder:text-white/30"
                />
              </div>
            </div>

            {/* ── Retainer Section ── */}
            <div className="flex flex-col gap-[10px] mt-[10px] border border-[#7C3AED]/40 rounded-[10px] p-[12px] bg-[#6B21A8]/10">
              <h3 className="text-[15px] font-bold text-[#C4B5FD] text-right">ריטיינר</h3>

              {/* סכום לפני מע"מ */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white/80 text-right">סכום לפני מע&quot;מ</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <Input
                    type="tel"
                    title="סכום ריטיינר"
                    value={fRetainerAmount}
                    onChange={(e) => setFRetainerAmount(e.target.value)}
                    placeholder="0"
                    className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                  />
                </div>
                {fRetainerAmount && parseFloat(fRetainerAmount) > 0 && (
                  <span className="text-[13px] text-[#C4B5FD] text-center">
                    ₪{parseFloat(fRetainerAmount).toLocaleString("he-IL")} + מע&quot;מ = ₪{(parseFloat(fRetainerAmount) * vatMultiplier).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>

              {/* סוג תשלום */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white/80 text-right">סוג תשלום</label>
                <Select value={fRetainerType || "__none__"} onValueChange={(val) => setFRetainerType(val === "__none__" ? "" : val)}>
                  <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[10px] text-[14px] text-white text-center">
                    <SelectValue placeholder="בחר סוג" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">בחר סוג</SelectItem>
                    <SelectItem value="monthly">ריטיינר חודשי</SelectItem>
                    <SelectItem value="one_time">חד פעמי</SelectItem>
                    <SelectItem value="fixed_term">מתמשך ל-X חודשים</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* כמות חודשים - only for fixed_term */}
              {fRetainerType === "fixed_term" && (
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[14px] font-medium text-white/80 text-right">כמות חודשים</label>
                  <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                    <Input
                      type="tel"
                      title="כמות חודשים"
                      value={fRetainerMonths}
                      onChange={(e) => setFRetainerMonths(e.target.value)}
                      placeholder="12"
                      className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                    />
                  </div>
                </div>
              )}

              {/* יום חיוב בחודש - for monthly or fixed_term */}
              {(fRetainerType === "monthly" || fRetainerType === "fixed_term") && (
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[14px] font-medium text-white/80 text-right">יום חיוב בחודש</label>
                  <Select value={fRetainerDayOfMonth} onValueChange={setFRetainerDayOfMonth}>
                    <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[10px] text-[14px] text-white text-center">
                      <SelectValue placeholder="בחר יום" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                        <SelectItem key={day} value={String(day)}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* תאריך תחילת ריטיינר */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white/80 text-right">תאריך תחילת ריטיינר</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <Input
                    type="date"
                    title="תאריך תחילת ריטיינר"
                    value={fRetainerStartDate}
                    onChange={(e) => setFRetainerStartDate(e.target.value)}
                    className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
                  />
                </div>
              </div>
            </div>

            {/* ── Labor Cost Section ── */}
            <div className="flex flex-col gap-[10px] mt-[10px] border border-purple-500/30 rounded-[10px] p-[12px] bg-purple-900/10">
              <h3 className="text-[15px] font-bold text-purple-300 text-right">עלות עבודה</h3>

              {/* סוג עלות */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white/80 text-right">סוג עלות</label>
                <Select value={fLaborType || "__none__"} onValueChange={(val) => setFLaborType(val === "__none__" ? "" : val)}>
                  <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[10px] text-[14px] text-white text-center">
                    <SelectValue placeholder="בחר סוג" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">בחר סוג</SelectItem>
                    <SelectItem value="global">גלובלי</SelectItem>
                    <SelectItem value="hourly">שעתי</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* משכורת חודשית - global */}
              {fLaborType === "global" && (
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[14px] font-medium text-white/80 text-right">משכורת חודשית (₪)</label>
                  <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                    <Input
                      type="tel"
                      title="משכורת חודשית"
                      value={fLaborMonthlySalary}
                      onChange={(e) => setFLaborMonthlySalary(e.target.value)}
                      placeholder="0"
                      className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                    />
                  </div>
                </div>
              )}

              {/* תעריף שעתי - hourly */}
              {fLaborType === "hourly" && (
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[14px] font-medium text-white/80 text-right">תעריף לשעה (₪)</label>
                  <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                    <Input
                      type="tel"
                      title="תעריף שעתי"
                      value={fLaborHourlyRate}
                      onChange={(e) => setFLaborHourlyRate(e.target.value)}
                      placeholder="0"
                      className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Active/Inactive toggle - edit mode only */}
            {isEditMode && (
              <div className="flex flex-col gap-[10px] items-start" dir="rtl">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setFIsActive(!fIsActive)}
                  className="flex items-center gap-[3px]"
                >
                  <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className={fIsActive ? "text-[#0BB783]" : "text-[#F64E60]"}>
                    {fIsActive ? (
                      <>
                        <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                        <path d="M10 16L14 20L22 12" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </>
                    ) : (
                      <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2"/>
                    )}
                  </svg>
                  <span className={`text-[15px] font-semibold ${fIsActive ? "text-[#0BB783]" : "text-[#F64E60]"}`}>
                    {fIsActive ? "לקוח פעיל" : "לקוח לא פעיל"}
                  </span>
                </Button>
              </div>
            )}

            {/* Submit and Cancel Buttons */}
            <div className="flex gap-[10px] mt-[15px] mb-[10px]">
              <Button
                variant="default"
                type="button"
                onClick={handleSaveCustomer}
                disabled={isSubmitting || !fContactName.trim() || !fBusinessName.trim()}
                className="flex-1 bg-[#6B21A8] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-[#7C3AED] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[8px]"
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {isEditMode ? "מעדכן..." : "שומר..."}
                  </>
                ) : (
                  isEditMode ? "עדכן לקוח" : "שמור לקוח"
                )}
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={handleCloseForm}
                disabled={isSubmitting}
                className="flex-1 bg-transparent border border-[#4C526B] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                ביטול
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ═══ Customer Detail Popup Sheet ═══ */}
      <Sheet open={isDetailOpen && !!selectedItem} onOpenChange={(open) => !open && handleCloseDetail()}>
        <SheetContent
          side="bottom"
          className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
          showCloseButton={false}
        >
          <SheetHeader className="border-b border-[#4C526B] pb-4">
            <div className="flex justify-between items-center" dir="ltr">
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={handleCloseDetail}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </Button>
              <SheetTitle className="text-white text-xl font-bold">פרטי לקוח</SheetTitle>
              <div className="flex items-center gap-[8px]">
                {/* Delete button - only if customer exists and no payments */}
                {selectedItem?.customer && payments.length === 0 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    title="מחיקת לקוח"
                    onClick={handleDeleteCustomer}
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
                {/* Edit / Setup button */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  title={selectedItem?.customer ? "עריכה" : "הקמת לקוח"}
                  onClick={handleEditCustomer}
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

          {selectedItem && (
            <div className="p-4" dir="rtl">
              {/* ── Section 1: Customer Info Grid ──────────────── */}
              <div className="bg-[#6B21A8]/30 rounded-[10px] p-[15px] mb-[15px]">
                {/* Business Name - large */}
                <div className="flex flex-col items-center text-center mb-[15px]">
                  <span className="text-[20px] text-white font-bold">{selectedItem.business.name}</span>
                </div>

                {selectedItem.customer ? (
                  <>
                    {/* Row 1 */}
                    <div className="grid grid-cols-2 gap-[10px] mb-[15px]">
                      <div className="flex flex-col items-center text-center">
                        <span className="text-[12px] text-white/60">שם הלקוח</span>
                        <span className="text-[14px] text-white font-medium">{selectedItem.customer.contact_name}</span>
                      </div>
                      <div className="flex flex-col items-center text-center">
                        <span className="text-[12px] text-white/60">שם החברה</span>
                        <span className="text-[14px] text-white font-medium">{selectedItem.customer.company_name || "לא רלוונטי"}</span>
                      </div>
                    </div>
                    {/* Row 2 */}
                    <div className="grid grid-cols-2 gap-[10px] mb-[15px]">
                      <div className="flex flex-col items-center text-center">
                        <span className="text-[12px] text-white/60">ע.מ/ח.פ</span>
                        <span dir="ltr" className="text-[14px] text-white font-medium">{selectedItem.customer.tax_id || selectedItem.business.tax_id || "-"}</span>
                      </div>
                      <div className="flex flex-col items-center text-center">
                        <span className="text-[12px] text-white/60">תאריך תחילת עבודה</span>
                        <span dir="ltr" className="text-[14px] text-white font-medium">
                          {selectedItem.customer.work_start_date
                            ? new Date(selectedItem.customer.work_start_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" })
                            : "-"}
                        </span>
                      </div>
                    </div>
                    {/* Row 3 */}
                    <div className="grid grid-cols-2 gap-[10px] mb-[15px]">
                      <div className="flex flex-col items-center text-center">
                        <span className="text-[12px] text-white/60">תנאי תשלום</span>
                        <span className="text-[14px] text-white font-medium">{selectedItem.customer.payment_terms || "-"}</span>
                      </div>
                      {selectedItem.customer.setup_fee && (
                        <div className="flex flex-col items-center text-center">
                          <span className="text-[12px] text-white/60">דמי הקמה</span>
                          <span className="text-[14px] text-white font-medium">{selectedItem.customer.setup_fee}</span>
                        </div>
                      )}
                    </div>
                    {/* Notes */}
                    {selectedItem.customer.notes && (
                      <div className="mt-[10px] bg-[#6B21A8]/20 rounded-[10px] p-[10px] border border-[#4C526B]">
                        <span className="text-[12px] text-white/60">הערות</span>
                        <p className="text-[14px] text-white mt-[4px] text-right whitespace-pre-wrap">{selectedItem.customer.notes}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-[10px] py-[10px]">
                    <span className="text-[14px] text-[#F6A609]">לקוח טרם הוקם במערכת</span>
                    <Button
                      variant="default"
                      type="button"
                      onClick={() => handleSetupCustomer(selectedItem)}
                      className="bg-[#6B21A8] text-white text-[14px] font-semibold px-[20px] py-[8px] rounded-[10px] hover:bg-[#7C3AED] transition-colors"
                    >
                      הקמת לקוח
                    </Button>
                  </div>
                )}
              </div>

              {/* ── Retainer Section ──────────────── */}
              {selectedItem.customer?.retainer_amount && selectedItem.customer.retainer_amount > 0 && (
                <div className="bg-[#6B21A8]/15 border border-[#7C3AED]/30 rounded-[10px] p-[15px] mb-[15px]">
                  <div className="flex items-center gap-[8px] mb-[12px]">
                    <h3 className="text-[15px] font-bold text-[#C4B5FD]">ריטיינר</h3>
                    {selectedItem.customer.retainer_status && (
                      <Badge className={`text-[11px] px-[8px] py-[2px] rounded-full font-bold ${
                        selectedItem.customer.retainer_status === 'active'
                          ? 'bg-[#0BB783]/20 text-[#0BB783]'
                          : selectedItem.customer.retainer_status === 'paused'
                          ? 'bg-[#F6A609]/20 text-[#F6A609]'
                          : 'bg-white/10 text-white/50'
                      }`}>
                        {selectedItem.customer.retainer_status === 'active' ? 'פעיל' : selectedItem.customer.retainer_status === 'paused' ? 'מושהה' : 'הסתיים'}
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-[10px] mb-[10px]">
                    <div className="flex flex-col items-center text-center">
                      <span className="text-[12px] text-white/60">סכום לפני מע&quot;מ</span>
                      <span className="text-[14px] text-white font-medium">₪{selectedItem.customer.retainer_amount.toLocaleString("he-IL")}</span>
                    </div>
                    <div className="flex flex-col items-center text-center">
                      <span className="text-[12px] text-white/60">סכום כולל מע&quot;מ</span>
                      <span className="text-[14px] text-[#C4B5FD] font-bold">₪{(selectedItem.customer.retainer_amount * (1 + (Number(selectedItem.business.vat_percentage) || 0.18))).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-[10px] mb-[10px]">
                    <div className="flex flex-col items-center text-center">
                      <span className="text-[12px] text-white/60">סוג</span>
                      <span className="text-[14px] text-white font-medium">
                        {selectedItem.customer.retainer_type === 'monthly' ? 'חודשי' : selectedItem.customer.retainer_type === 'one_time' ? 'חד פעמי' : selectedItem.customer.retainer_type === 'fixed_term' ? `מתמשך (${selectedItem.customer.retainer_months} חודשים)` : '-'}
                      </span>
                    </div>
                    {selectedItem.customer.retainer_day_of_month && (
                      <div className="flex flex-col items-center text-center">
                        <span className="text-[12px] text-white/60">יום חיוב</span>
                        <span className="text-[14px] text-white font-medium">{selectedItem.customer.retainer_day_of_month} לחודש</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-[10px]">
                    {selectedItem.customer.retainer_start_date && (
                      <div className="flex flex-col items-center text-center">
                        <span className="text-[12px] text-white/60">תאריך התחלה</span>
                        <span dir="ltr" className="text-[14px] text-white font-medium">
                          {new Date(selectedItem.customer.retainer_start_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" })}
                        </span>
                      </div>
                    )}
                    {selectedItem.customer.retainer_end_date && (
                      <div className="flex flex-col items-center text-center">
                        <span className="text-[12px] text-white/60">תאריך סיום</span>
                        <span dir="ltr" className="text-[14px] text-white font-medium">
                          {new Date(selectedItem.customer.retainer_end_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" })}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-[8px] mt-[12px]">
                    {selectedItem.customer.retainer_status === 'active' && (
                      <Button
                        variant="outline"
                        type="button"
                        onClick={() => {
                          confirm("האם להשהות את הריטיינר?", async () => {
                            const supabase = createClient();
                            await supabase.from("customers").update({ retainer_status: 'paused' }).eq("id", selectedItem!.customer!.id);
                            showToast("הריטיינר הושהה", "success");
                            setRefreshTrigger((prev) => prev + 1);
                            handleCloseDetail();
                          });
                        }}
                        className="flex-1 text-[13px] border-[#F6A609]/50 text-[#F6A609] hover:bg-[#F6A609]/10"
                      >
                        השהה ריטיינר
                      </Button>
                    )}
                    {selectedItem.customer.retainer_status === 'paused' && (
                      <Button
                        variant="outline"
                        type="button"
                        onClick={() => {
                          confirm("האם לחדש את הריטיינר?", async () => {
                            const supabase = createClient();
                            await supabase.from("customers").update({ retainer_status: 'active' }).eq("id", selectedItem!.customer!.id);
                            showToast("הריטיינר חודש", "success");
                            setRefreshTrigger((prev) => prev + 1);
                            handleCloseDetail();
                          });
                        }}
                        className="flex-1 text-[13px] border-[#0BB783]/50 text-[#0BB783] hover:bg-[#0BB783]/10"
                      >
                        חדש ריטיינר
                      </Button>
                    )}
                    {(selectedItem.customer.retainer_status === 'active' || selectedItem.customer.retainer_status === 'paused') && (
                      <Button
                        variant="outline"
                        type="button"
                        onClick={() => {
                          confirm("האם לעצור את הריטיינר לצמיתות?", async () => {
                            const supabase = createClient();
                            await supabase.from("customers").update({ retainer_status: 'completed' }).eq("id", selectedItem!.customer!.id);
                            showToast("הריטיינר הופסק", "success");
                            setRefreshTrigger((prev) => prev + 1);
                            handleCloseDetail();
                          });
                        }}
                        className="flex-1 text-[13px] border-[#F64E60]/50 text-[#F64E60] hover:bg-[#F64E60]/10"
                      >
                        עצור ריטיינר
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* ── Labor Info ──────────────── */}
              {selectedItem.customer?.labor_type && (
                <div className="bg-purple-900/10 border border-purple-500/30 rounded-[10px] p-[15px] mb-[15px]">
                  <h3 className="text-[15px] font-bold text-purple-300 mb-[10px]">עלות עבודה</h3>
                  <div className="grid grid-cols-2 gap-[10px]">
                    <div className="flex flex-col items-center text-center">
                      <span className="text-[12px] text-white/60">סוג</span>
                      <span className="text-[14px] text-white font-medium">
                        {selectedItem.customer.labor_type === 'global' ? 'גלובלי' : 'שעתי'}
                      </span>
                    </div>
                    {selectedItem.customer.labor_type === 'global' && selectedItem.customer.labor_monthly_salary != null && (
                      <div className="flex flex-col items-center text-center">
                        <span className="text-[12px] text-white/60">משכורת חודשית</span>
                        <span className="text-[14px] text-purple-300 font-bold">
                          ₪{selectedItem.customer.labor_monthly_salary.toLocaleString("he-IL")}
                        </span>
                      </div>
                    )}
                    {selectedItem.customer.labor_type === 'hourly' && selectedItem.customer.labor_hourly_rate != null && (
                      <div className="flex flex-col items-center text-center">
                        <span className="text-[12px] text-white/60">תעריף לשעה</span>
                        <span className="text-[14px] text-purple-300 font-bold">
                          ₪{selectedItem.customer.labor_hourly_rate.toLocaleString("he-IL")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Services Section ──────────────── */}
              {selectedItem.customer && (
                <div className="bg-purple-900/10 border border-purple-500/30 rounded-[10px] p-[15px] mb-[15px]">
                  <h3 className="text-[16px] font-bold text-purple-300 text-center mb-[10px]">מוצרים ושירותים</h3>

                  {services.length === 0 ? (
                    <div className="flex items-center justify-center py-[15px]">
                      <span className="text-[14px] text-white/50">אין מוצרים/שירותים</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-[8px] mb-[10px]">
                        {services.map((service) => (
                          <div key={service.id} className="flex flex-col gap-[4px] bg-white/5 rounded-[7px] p-[10px]">
                            <div className="flex items-center justify-between">
                              <span className="text-[14px] text-white font-medium">{service.name}</span>
                              <span dir="ltr" className="text-[14px] text-purple-300 font-medium">
                                ₪{Number(service.amount).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span dir="ltr" className="text-[12px] text-white/60">
                                {new Date(service.service_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() => handleDeleteService(service.id)}
                                className="text-[#F64E60]/50 hover:text-[#F64E60] transition-colors text-[11px]"
                              >
                                מחק
                              </Button>
                            </div>
                            {service.notes && (
                              <span className="text-[12px] text-white/40 text-right">{service.notes}</span>
                            )}
                          </div>
                        ))}
                      </div>
                      {/* Total */}
                      <div className="flex items-center justify-between border-t border-white/10 pt-[8px] mb-[10px]">
                        <span className="text-[13px] text-white/60">סה&quot;כ</span>
                        <span dir="ltr" className="text-[16px] text-purple-300 font-bold">
                          ₪{services.reduce((sum, s) => sum + Number(s.amount), 0).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </>
                  )}

                  {/* Add Service Toggle */}
                  <Button
                    variant="default"
                    type="button"
                    onClick={() => setIsAddServiceOpen(!isAddServiceOpen)}
                    className="w-full mt-[5px] bg-purple-700 text-white text-[14px] font-semibold py-[10px] rounded-[10px] hover:bg-purple-600 transition-colors"
                  >
                    {isAddServiceOpen ? "ביטול" : "+ הוסף מוצר/שירות"}
                  </Button>

                  {/* Add Service Sub-form */}
                  {isAddServiceOpen && (
                    <div className="flex flex-col gap-[8px] mt-[10px] border border-[#4C526B] rounded-[10px] p-[10px]">
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[13px] text-white/70 text-right">שם השירות/מוצר</label>
                        <div className="border border-[#4C526B] rounded-[7px] h-[40px]">
                          <Input
                            type="text"
                            title="שם שירות"
                            value={newServiceName}
                            onChange={(e) => setNewServiceName(e.target.value)}
                            placeholder="לדוגמה: עיצוב לוגו"
                            className="w-full h-full bg-transparent text-white text-[13px] text-center rounded-[7px] border-none outline-none px-[8px] placeholder:text-white/30"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[13px] text-white/70 text-right">סכום (₪) לפני מע&quot;מ</label>
                        <div className="border border-[#4C526B] rounded-[7px] h-[40px]">
                          <Input
                            type="tel"
                            title="סכום"
                            value={newServiceAmount}
                            onChange={(e) => setNewServiceAmount(e.target.value)}
                            placeholder="0"
                            className="w-full h-full bg-transparent text-white text-[13px] text-center rounded-[7px] border-none outline-none px-[8px] placeholder:text-white/30"
                          />
                        </div>
                        {newServiceAmount && parseFloat(newServiceAmount) > 0 && (
                          <span className="text-[12px] text-purple-300 text-center">
                            + מע&quot;מ = ₪{(parseFloat(newServiceAmount) * (1 + (Number(selectedItem.business.vat_percentage) || 0.18))).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[13px] text-white/70 text-right">תאריך</label>
                        <div className="border border-[#4C526B] rounded-[7px] h-[40px]">
                          <Input
                            type="date"
                            title="תאריך שירות"
                            value={newServiceDate}
                            onChange={(e) => setNewServiceDate(e.target.value)}
                            className="w-full h-full bg-transparent text-white text-[13px] text-center rounded-[7px] border-none outline-none px-[8px]"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[13px] text-white/70 text-right">הערות</label>
                        <div className="border border-[#4C526B] rounded-[7px] min-h-[40px] px-[8px] py-[6px]">
                          <Textarea
                            title="הערות"
                            value={newServiceNotes}
                            onChange={(e) => setNewServiceNotes(e.target.value)}
                            placeholder="הערות..."
                            className="w-full bg-transparent text-white text-[13px] text-right rounded-[7px] border-none outline-none resize-none min-h-[28px] placeholder:text-white/30"
                          />
                        </div>
                      </div>
                      <Button
                        variant="default"
                        type="button"
                        onClick={handleAddService}
                        disabled={!newServiceName.trim() || !newServiceAmount || isSubmitting}
                        className="w-full bg-purple-600 text-white text-[14px] font-semibold py-[10px] rounded-[10px] hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[6px]"
                      >
                        {isSubmitting ? (
                          <>
                            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            שומר...
                          </>
                        ) : (
                          "שמור שירות"
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Survey Section (Churned clients) ──────────────── */}
              {selectedItem.customer?.retainer_status === 'completed' && (
                <div className="bg-[#6B21A8]/15 border border-[#7C3AED]/30 rounded-[10px] p-[15px] mb-[15px]">
                  <h3 className="text-[15px] font-bold text-[#C4B5FD] mb-[10px]">סקר לקוח יוצא</h3>

                  {!customerSurvey ? (
                    <Button
                      variant="default"
                      type="button"
                      onClick={async () => {
                        if (!selectedItem.customer) return;
                        const supabase = createClient();
                        const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
                        const { data: survey, error } = await supabase
                          .from("customer_surveys")
                          .insert({ customer_id: selectedItem.customer.id, token })
                          .select("id, token")
                          .single();
                        if (error) {
                          showToast("שגיאה ביצירת סקר", "error");
                          return;
                        }
                        const surveyUrl = `${window.location.origin}/survey/${token}`;
                        navigator.clipboard.writeText(surveyUrl);
                        showToast("לינק הסקר הועתק ללוח", "success");
                        setCustomerSurvey({ id: survey.id, token: survey.token, is_completed: false, created_at: new Date().toISOString() });
                      }}
                      className="w-full bg-[#6B21A8] text-white text-[14px] font-semibold py-[10px] rounded-[10px] hover:bg-[#7C3AED] transition-colors"
                    >
                      שלח סקר
                    </Button>
                  ) : !customerSurvey.is_completed ? (
                    <div className="flex flex-col gap-[8px]">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] text-white/70">לינק הסקר:</span>
                        <Badge className="text-[11px] bg-[#F6A609]/20 text-[#F6A609] px-[8px] py-[2px] rounded-full font-bold">
                          הלינק נשלח
                        </Badge>
                      </div>
                      <Button
                        variant="outline"
                        type="button"
                        onClick={() => {
                          const surveyUrl = `${window.location.origin}/survey/${customerSurvey.token}`;
                          navigator.clipboard.writeText(surveyUrl);
                          showToast("הלינק הועתק ללוח", "success");
                        }}
                        className="w-full text-[13px] border-[#4C526B] text-white/70 hover:bg-white/5"
                      >
                        העתק לינק
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-[10px]">
                      <Badge className="self-start text-[11px] bg-[#0BB783]/20 text-[#0BB783] px-[8px] py-[2px] rounded-full font-bold">
                        הסקר הושלם
                      </Badge>

                      {/* Service Rating */}
                      {surveyResponses.find(r => r.question_key === 'service_rating') && (
                        <div className="flex items-center justify-between bg-white/5 rounded-[7px] p-[10px]">
                          <span className="text-[13px] text-white/70">דירוג שירות</span>
                          <div className="flex gap-[2px]">
                            {Array.from({ length: 5 }, (_, i) => (
                              <svg key={i} width="16" height="16" viewBox="0 0 24 24" fill={i < Number(surveyResponses.find(r => r.question_key === 'service_rating')?.answer_value || 0) ? "#F6A609" : "none"} stroke="#F6A609" strokeWidth="2">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                              </svg>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Leave Reason */}
                      {surveyResponses.find(r => r.question_key === 'leave_reason') && (
                        <div className="flex flex-col gap-[4px] bg-white/5 rounded-[7px] p-[10px]">
                          <span className="text-[13px] text-white/70">סיבת עזיבה</span>
                          <div className="flex flex-wrap gap-[4px]">
                            {(surveyResponses.find(r => r.question_key === 'leave_reason')?.answer_value || '').split(',').map((reason, i) => (
                              <Badge key={i} className="text-[11px] bg-white/10 text-white/80 px-[8px] py-[2px] rounded-full">
                                {reason.trim()}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* NPS */}
                      {surveyResponses.find(r => r.question_key === 'nps') && (() => {
                        const nps = Number(surveyResponses.find(r => r.question_key === 'nps')?.answer_value || 0);
                        const npsColor = nps <= 6 ? 'text-[#F64E60]' : nps <= 8 ? 'text-[#F6A609]' : 'text-[#0BB783]';
                        return (
                          <div className="flex items-center justify-between bg-white/5 rounded-[7px] p-[10px]">
                            <span className="text-[13px] text-white/70">NPS</span>
                            <span className={`text-[18px] font-bold ${npsColor}`}>{nps}</span>
                          </div>
                        );
                      })()}

                      {/* Free Text */}
                      {surveyResponses.find(r => r.question_key === 'free_text') && (
                        <div className="flex flex-col gap-[4px] bg-white/5 rounded-[7px] p-[10px]">
                          <span className="text-[13px] text-white/70">הערות חופשיות</span>
                          <p className="text-[14px] text-white/80 text-right italic border-r-2 border-purple-500/50 pr-[8px]">
                            &ldquo;{surveyResponses.find(r => r.question_key === 'free_text')?.answer_value}&rdquo;
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Section 2: Agreement Document ──────────────── */}
              {selectedItem.customer?.agreement_url && (
                <div className="bg-[#6B21A8]/30 rounded-[10px] p-[15px] mb-[15px]">
                  <h3 className="text-[14px] font-bold text-white mb-[10px]">הסכם עבודה</h3>
                  <div className="flex items-center gap-[10px]">
                    <a
                      href={selectedItem.customer.agreement_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#3F97FF] text-[14px] underline"
                    >
                      פתח הסכם
                    </a>
                  </div>
                </div>
              )}

              {/* ── Section 3: Active Users ────────────────────── */}
              {selectedItem.members.length > 0 && (
                <div className="bg-[#6B21A8]/30 rounded-[10px] p-[15px] mb-[15px]">
                  <div className="flex items-center gap-[8px] mb-[12px]">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-white/60">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <h3 className="text-[15px] font-bold text-white">משתמשים פעילים</h3>
                    <span className="text-[13px] text-white/50">({selectedItem.members.length})</span>
                  </div>
                  <div className="flex flex-col gap-[10px]">
                    {selectedItem.members.map((member) => (
                      <div key={member.user_id} className="flex items-center gap-[10px] bg-white/5 rounded-[8px] p-[10px]">
                        {/* Avatar circle */}
                        <div className="w-[36px] h-[36px] rounded-full bg-[#4A56D4]/30 flex items-center justify-center flex-shrink-0">
                          <span className="text-[14px] font-bold text-white/80">
                            {(member.profiles?.full_name || member.profiles?.email || "?").charAt(0)}
                          </span>
                        </div>
                        {/* Name + Email */}
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="text-[14px] text-white font-medium truncate">
                            {member.profiles?.full_name || member.profiles?.email}
                          </span>
                          <span className="text-[12px] text-white/40 truncate">{member.profiles?.email}</span>
                        </div>
                        {/* Role badge */}
                        <Badge
                          className={`text-[11px] font-bold px-[10px] py-[4px] rounded-full flex-shrink-0 ${
                            member.role === "owner"
                              ? "bg-[#4A56D4] text-white"
                              : member.role === "admin"
                              ? "bg-[#3CD856]/20 text-[#3CD856]"
                              : "bg-white/10 text-white/60"
                          }`}
                        >
                          {member.role === "owner" ? "בעלים" : member.role === "admin" ? "מנהל" : "עובד"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Section 4: Income / Monthly Payments ─────── */}
              {selectedItem.customer && (
                <div className="bg-[#6B21A8]/30 rounded-[10px] p-[15px]">
                  <h3 className="text-[16px] font-bold text-white text-center mb-[10px]">הכנסות</h3>

                  {/* Total all-time */}
                  <div className="flex items-center justify-between border-b border-white/10 pb-[8px] mb-[10px]">
                    <span className="text-[13px] text-white/60">סה&quot;כ כל התקופה</span>
                    <span dir="ltr" className="text-[16px] text-[#0BB783] font-bold">
                      ₪{totalIncome.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </span>
                  </div>

                  {/* Month Navigator */}
                  <div className="flex items-center justify-center gap-[10px] mb-[15px]">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      type="button"
                      onClick={() => setDetailMonth(new Date(detailMonth.getFullYear(), detailMonth.getMonth() + 1, 1))}
                      className="text-white/60 hover:text-white transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </Button>
                    <span className="text-[14px] text-white font-medium min-w-[120px] text-center">
                      {detailMonth.toLocaleDateString("he-IL", { month: "long", year: "numeric" })}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      type="button"
                      onClick={() => setDetailMonth(new Date(detailMonth.getFullYear(), detailMonth.getMonth() - 1, 1))}
                      className="text-white/60 hover:text-white transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </Button>
                  </div>

                  {/* Monthly Total */}
                  <div className="flex items-center justify-between border-b border-white/20 pb-[10px] mb-[10px]">
                    <span className="text-[13px] text-[#3CD856] font-medium">סה&quot;כ התקבל בחודש</span>
                    <span dir="ltr" className="text-[18px] text-[#3CD856] font-bold">
                      ₪{monthlyTotal.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </span>
                  </div>

                  {/* Payment items list */}
                  {monthlyPayments.length === 0 ? (
                    <div className="flex items-center justify-center py-[20px]">
                      <span className="text-[14px] text-white/50">אין תשלומים בחודש זה</span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-[8px]">
                      {monthlyPayments.map((payment) => (
                        <div key={payment.id} className="flex flex-col gap-[4px] bg-white/5 rounded-[7px] p-[10px]">
                          <div className="flex items-center justify-between">
                            <span dir="ltr" className="text-[14px] text-white font-medium">
                              ₪{Number(payment.amount).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            </span>
                            <span dir="ltr" className="text-[12px] text-white/60">
                              {new Date(payment.payment_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                            </span>
                          </div>
                          {payment.description && (
                            <span className="text-[13px] text-white/80 text-right">{payment.description}</span>
                          )}
                          {payment.payment_method && (
                            <span className="text-[12px] text-white/50 text-right">
                              {paymentMethodLabels[payment.payment_method] || payment.payment_method}
                            </span>
                          )}
                          {payment.notes && (
                            <span className="text-[12px] text-white/40 text-right">{payment.notes}</span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            onClick={() => handleDeletePayment(payment.id)}
                            className="self-end text-[#F64E60]/50 hover:text-[#F64E60] transition-colors text-[11px] mt-[4px]"
                          >
                            מחק
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Payment Toggle */}
                  <Button
                    variant="default"
                    type="button"
                    onClick={() => setIsAddPaymentOpen(!isAddPaymentOpen)}
                    className="w-full mt-[15px] bg-[#6B21A8] text-white text-[14px] font-semibold py-[10px] rounded-[10px] hover:bg-[#7C3AED] transition-colors"
                  >
                    {isAddPaymentOpen ? "ביטול" : "+ הוספת תשלום"}
                  </Button>

                  {/* Add Payment Sub-form */}
                  {isAddPaymentOpen && (
                    <div className="flex flex-col gap-[8px] mt-[10px] border border-[#4C526B] rounded-[10px] p-[10px]">
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[13px] text-white/70 text-right">תאריך</label>
                        <div className="border border-[#4C526B] rounded-[7px] h-[40px]">
                          <Input
                            type="date"
                            title="תאריך תשלום"
                            value={newPaymentDate}
                            onChange={(e) => setNewPaymentDate(e.target.value)}
                            className="w-full h-full bg-transparent text-white text-[13px] text-center rounded-[7px] border-none outline-none px-[8px]"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[13px] text-white/70 text-right">סכום (₪)</label>
                        <div className="border border-[#4C526B] rounded-[7px] h-[40px]">
                          <Input
                            type="tel"
                            title="סכום"
                            value={newPaymentAmount}
                            onChange={(e) => setNewPaymentAmount(e.target.value)}
                            placeholder="0"
                            className="w-full h-full bg-transparent text-white text-[13px] text-center rounded-[7px] border-none outline-none px-[8px] placeholder:text-white/30"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[13px] text-white/70 text-right">עבור מה</label>
                        <div className="border border-[#4C526B] rounded-[7px] h-[40px]">
                          <Input
                            type="text"
                            title="תיאור"
                            value={newPaymentDescription}
                            onChange={(e) => setNewPaymentDescription(e.target.value)}
                            placeholder="לדוגמה: ריטיינר חודשי"
                            className="w-full h-full bg-transparent text-white text-[13px] text-center rounded-[7px] border-none outline-none px-[8px] placeholder:text-white/30"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[13px] text-white/70 text-right">אמצעי תשלום</label>
                        <Select value={newPaymentMethod || "__none__"} onValueChange={(val) => setNewPaymentMethod(val === "__none__" ? "" : val)}>
                          <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[7px] h-[40px] px-[8px] text-[13px] text-white text-center">
                            <SelectValue placeholder="בחר" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">בחר</SelectItem>
                            <SelectItem value="bank_transfer">העברה בנקאית</SelectItem>
                            <SelectItem value="credit">אשראי</SelectItem>
                            <SelectItem value="cash">מזומן</SelectItem>
                            <SelectItem value="bit">ביט</SelectItem>
                            <SelectItem value="paybox">פייבוקס</SelectItem>
                            <SelectItem value="check">צ׳ק</SelectItem>
                            <SelectItem value="other">אחר</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[13px] text-white/70 text-right">הערות</label>
                        <div className="border border-[#4C526B] rounded-[7px] min-h-[40px] px-[8px] py-[6px]">
                          <Textarea
                            title="הערות"
                            value={newPaymentNotes}
                            onChange={(e) => setNewPaymentNotes(e.target.value)}
                            placeholder="הערות..."
                            className="w-full bg-transparent text-white text-[13px] text-right rounded-[7px] border-none outline-none resize-none min-h-[28px] placeholder:text-white/30"
                          />
                        </div>
                      </div>
                      <Button
                        variant="default"
                        type="button"
                        onClick={handleAddPayment}
                        disabled={!newPaymentDate || !newPaymentAmount || isSubmitting}
                        className="w-full bg-[#3CD856] text-white text-[14px] font-semibold py-[10px] rounded-[10px] hover:bg-[#2FB847] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[6px]"
                      >
                        {isSubmitting ? (
                          <>
                            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            שומר...
                          </>
                        ) : (
                          "שמור תשלום"
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
