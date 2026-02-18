"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useDashboard } from "../../layout";
import { useToast } from "@/components/ui/toast";
import { uploadFile } from "@/lib/uploadFile";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useFormDraft } from "@/hooks/useFormDraft";
import { generateUUID } from "@/lib/utils";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

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
}

// Combined display item
interface CustomerDisplay {
  business: Business;
  customer: Customer | null;
  members: BusinessMember[];
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

  // Available businesses for "add standalone" form
  const [_allBusinesses, setAllBusinesses] = useState<Business[]>([]);

  // ─── Data Fetching ─────────────────────────────────────────

  useEffect(() => {
    async function fetchData() {
      if (!isAdmin) return;
      setIsLoading(true);
      const supabase = createClient();

      // Fetch all businesses
      const { data: businesses } = await supabase
        .from("businesses")
        .select("*")
        .is("deleted_at", null)
        .order("name");

      // Fetch all customer records
      const { data: customers } = await supabase
        .from("customers")
        .select("*")
        .is("deleted_at", null);

      // Fetch all business members with profiles
      const { data: members } = await supabase
        .from("business_members")
        .select("user_id, role, business_id, profiles(id, full_name, email)");

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
    setIsDetailOpen(true);
    if (item.customer) {
      await fetchPayments(item.customer.id);
    } else {
      setPayments([]);
    }
  };

  const handleCloseDetail = () => {
    setIsDetailOpen(false);
    setSelectedItem(null);
    setPayments([]);
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
      };

      if (isEditMode && editingCustomer) {
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
        const { error } = await supabase
          .from("customers")
          .insert({ id: generateUUID(), ...customerData });

        if (error) {
          showToast("שגיאה בשמירת לקוח", "error");
          console.error(error);
          setIsSubmitting(false);
          return;
        }
        showToast("הלקוח נשמר בהצלחה", "success");
        clearDraft();
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

  // ─── Draft Persistence ────────────────────────────────────

  const saveDraftData = useCallback(() => {
    if (!isFormOpen || isEditMode) return;
    saveDraft({
      fContactName, fBusinessName, fCompanyName, fTaxId,
      fWorkStartDate, fSetupFee, fPaymentTerms, fNotes,
    });
  }, [saveDraft, isFormOpen, isEditMode, fContactName, fBusinessName, fCompanyName, fTaxId, fWorkStartDate, fSetupFee, fPaymentTerms, fNotes]);

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
    <div dir="rtl" className="flex flex-col min-h-[calc(100vh-52px)] min-h-[calc(100dvh-52px)] text-white px-[5px] py-[5px] pb-[80px] gap-[10px]">
      <ConfirmDialog />
      {/* Header */}
      <div className="flex flex-col gap-[7px] p-[5px]">
        {/* Add Standalone Customer Button */}
        <button
          type="button"
          onClick={handleAddStandaloneCustomer}
          className="w-full min-h-[50px] bg-[#29318A] text-white text-[16px] font-semibold rounded-[5px] px-[24px] py-[12px] transition-colors duration-200 hover:bg-[#3D44A0] shadow-[0_7px_30px_-10px_rgba(41,49,138,0.1)]"
        >
          הוספת לקוח חדש
        </button>
      </div>

      {/* Main Content Container */}
      <div className="flex-1 flex flex-col bg-[#0F1535] rounded-[10px] p-[5px_7px]">
        {/* Count and Search */}
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
              placeholder="חיפוש לקוח..."
              className="bg-[#29318A]/30 border border-[#6B6B6B] rounded-[7px] px-[12px] py-[6px] text-white text-[14px] placeholder:text-white/50 focus:outline-none focus:border-[#29318A] flex-1 text-right"
              autoFocus
            />
          ) : (
            <span className="text-[18px] font-bold text-white">{totalCount} לקוחות</span>
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto mt-[15px] mx-0">
          {isLoading ? (
            <div className="grid grid-cols-2 gap-[26px]">
              {[...Array(6)].map((_, i) => (
                <div
                  key={`skeleton-${i}`}
                  className="bg-[#29318A] rounded-[10px] p-[7px] min-h-[170px] flex flex-col items-center justify-center gap-[10px] animate-pulse"
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
            <div className="grid grid-cols-2 gap-[26px]">
              {/* Business-linked cards */}
              {filteredItems.map((item) => (
                <button
                  key={item.business.id}
                  type="button"
                  onClick={() => handleOpenDetail(item)}
                  className={`bg-[#29318A] rounded-[10px] p-[7px] min-h-[170px] flex flex-col items-center justify-center gap-[10px] transition-colors duration-200 hover:bg-[#3D44A0] cursor-pointer relative ${item.customer && !item.customer.is_active ? "opacity-40" : ""}`}
                >
                  {/* Setup badge */}
                  {!item.customer && (
                    <span className="absolute top-[6px] left-[6px] text-[10px] bg-[#F6A609]/80 text-white px-[6px] py-[2px] rounded-full font-bold">
                      טרם הוקם
                    </span>
                  )}

                  {/* Inactive badge */}
                  {item.customer && !item.customer.is_active && (
                    <span className="absolute top-[6px] left-[6px] text-[10px] bg-[#F64E60]/80 text-white px-[6px] py-[2px] rounded-full font-bold">
                      לא פעיל
                    </span>
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
                    />
                  ) : (
                    <div className="w-[60px] h-[60px] rounded-full bg-white/10 flex items-center justify-center border-2 border-white/20">
                      <span className="text-[22px] font-bold text-white/60">{item.business.name.charAt(0)}</span>
                    </div>
                  )}

                  {/* Business Name */}
                  <div className="w-[120px] text-center">
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
                </button>
              ))}

              {/* Standalone customers (not linked to business) */}
              {filteredStandalone.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => handleOpenDetail({
                    business: { id: "", name: customer.business_name, business_type: null, status: null, tax_id: customer.tax_id, address: null, city: null, phone: null, email: null, logo_url: null, created_at: "", deleted_at: null },
                    customer,
                    members: [],
                  })}
                  className={`bg-[#29318A] rounded-[10px] p-[7px] min-h-[170px] flex flex-col items-center justify-center gap-[10px] transition-colors duration-200 hover:bg-[#3D44A0] cursor-pointer relative ${!customer.is_active ? "opacity-40" : ""}`}
                >
                  {!customer.is_active && (
                    <span className="absolute top-[6px] left-[6px] text-[10px] bg-[#F64E60]/80 text-white px-[6px] py-[2px] rounded-full font-bold">
                      לא פעיל
                    </span>
                  )}

                  <span className="absolute top-[6px] right-[6px] text-[10px] bg-[#4C526B] text-white px-[6px] py-[2px] rounded-full font-bold">
                    עצמאי
                  </span>

                  <div className="w-[120px] text-center">
                    <span className="text-[18px] font-bold text-white leading-[1.4]">
                      {customer.business_name}
                    </span>
                  </div>

                  <span className="text-[14px] text-white/70 text-center">{customer.contact_name}</span>
                </button>
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
              <button
                type="button"
                onClick={handleCloseForm}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </button>
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
                <input
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
                  <input
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
                <input
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
                <input
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
                <input
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
                <input
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
                <input
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
              <label className="border border-[#4C526B] border-dashed rounded-[10px] min-h-[80px] px-[10px] py-[15px] flex flex-col items-center justify-center gap-[8px] cursor-pointer hover:border-[#29318A] transition-colors">
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
                <textarea
                  title="הערות"
                  value={fNotes}
                  onChange={(e) => setFNotes(e.target.value)}
                  placeholder="הערות נוספות..."
                  className="w-full h-full min-h-[60px] bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none resize-none placeholder:text-white/30"
                />
              </div>
            </div>

            {/* Active/Inactive toggle - edit mode only */}
            {isEditMode && (
              <div className="flex flex-col gap-[10px] items-start" dir="rtl">
                <button
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
                </button>
              </div>
            )}

            {/* Submit and Cancel Buttons */}
            <div className="flex gap-[10px] mt-[15px] mb-[10px]">
              <button
                type="button"
                onClick={handleSaveCustomer}
                disabled={isSubmitting || !fContactName.trim() || !fBusinessName.trim()}
                className="flex-1 bg-[#29318A] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-[#3D44A0] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[8px]"
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
              </button>
              <button
                type="button"
                onClick={handleCloseForm}
                disabled={isSubmitting}
                className="flex-1 bg-transparent border border-[#4C526B] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                ביטול
              </button>
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
              <button
                type="button"
                onClick={handleCloseDetail}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </button>
              <SheetTitle className="text-white text-xl font-bold">פרטי לקוח</SheetTitle>
              <div className="flex items-center gap-[8px]">
                {/* Delete button - only if customer exists and no payments */}
                {selectedItem?.customer && payments.length === 0 && (
                  <button
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
                  </button>
                )}
                {/* Edit / Setup button */}
                <button
                  type="button"
                  title={selectedItem?.customer ? "עריכה" : "הקמת לקוח"}
                  onClick={handleEditCustomer}
                  className="w-[24px] h-[24px] flex items-center justify-center text-white/70 hover:text-white"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
          </SheetHeader>

          {selectedItem && (
            <div className="p-4" dir="rtl">
              {/* ── Section 1: Customer Info Grid ──────────────── */}
              <div className="bg-[#29318A]/30 rounded-[10px] p-[15px] mb-[15px]">
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
                      <div className="mt-[10px] bg-[#29318A]/20 rounded-[10px] p-[10px] border border-[#4C526B]">
                        <span className="text-[12px] text-white/60">הערות</span>
                        <p className="text-[14px] text-white mt-[4px] text-right whitespace-pre-wrap">{selectedItem.customer.notes}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-[10px] py-[10px]">
                    <span className="text-[14px] text-[#F6A609]">לקוח טרם הוקם במערכת</span>
                    <button
                      type="button"
                      onClick={() => handleSetupCustomer(selectedItem)}
                      className="bg-[#29318A] text-white text-[14px] font-semibold px-[20px] py-[8px] rounded-[10px] hover:bg-[#3D44A0] transition-colors"
                    >
                      הקמת לקוח
                    </button>
                  </div>
                )}
              </div>

              {/* ── Section 2: Agreement Document ──────────────── */}
              {selectedItem.customer?.agreement_url && (
                <div className="bg-[#29318A]/30 rounded-[10px] p-[15px] mb-[15px]">
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
                <div className="bg-[#29318A]/30 rounded-[10px] p-[15px] mb-[15px]">
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
                        <span
                          className={`text-[11px] font-bold px-[10px] py-[4px] rounded-full flex-shrink-0 ${
                            member.role === "owner"
                              ? "bg-[#4A56D4] text-white"
                              : member.role === "admin"
                              ? "bg-[#3CD856]/20 text-[#3CD856]"
                              : "bg-white/10 text-white/60"
                          }`}
                        >
                          {member.role === "owner" ? "בעלים" : member.role === "admin" ? "מנהל" : "עובד"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Section 4: Income / Monthly Payments ─────── */}
              {selectedItem.customer && (
                <div className="bg-[#29318A]/30 rounded-[10px] p-[15px]">
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
                    <button
                      type="button"
                      onClick={() => setDetailMonth(new Date(detailMonth.getFullYear(), detailMonth.getMonth() + 1, 1))}
                      className="text-white/60 hover:text-white transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                    <span className="text-[14px] text-white font-medium min-w-[120px] text-center">
                      {detailMonth.toLocaleDateString("he-IL", { month: "long", year: "numeric" })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDetailMonth(new Date(detailMonth.getFullYear(), detailMonth.getMonth() - 1, 1))}
                      className="text-white/60 hover:text-white transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
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
                          <button
                            type="button"
                            onClick={() => handleDeletePayment(payment.id)}
                            className="self-end text-[#F64E60]/50 hover:text-[#F64E60] transition-colors text-[11px] mt-[4px]"
                          >
                            מחק
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Payment Toggle */}
                  <button
                    type="button"
                    onClick={() => setIsAddPaymentOpen(!isAddPaymentOpen)}
                    className="w-full mt-[15px] bg-[#29318A] text-white text-[14px] font-semibold py-[10px] rounded-[10px] hover:bg-[#3D44A0] transition-colors"
                  >
                    {isAddPaymentOpen ? "ביטול" : "+ הוספת תשלום"}
                  </button>

                  {/* Add Payment Sub-form */}
                  {isAddPaymentOpen && (
                    <div className="flex flex-col gap-[8px] mt-[10px] border border-[#4C526B] rounded-[10px] p-[10px]">
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[13px] text-white/70 text-right">תאריך</label>
                        <div className="border border-[#4C526B] rounded-[7px] h-[40px]">
                          <input
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
                          <input
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
                          <input
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
                        <div className="border border-[#4C526B] rounded-[7px] h-[40px]">
                          <select
                            title="אמצעי תשלום"
                            value={newPaymentMethod}
                            onChange={(e) => setNewPaymentMethod(e.target.value)}
                            className="w-full h-full bg-transparent text-white text-[13px] text-center rounded-[7px] border-none outline-none px-[8px] appearance-none"
                          >
                            <option value="" className="bg-[#0F1535]">בחר</option>
                            <option value="bank_transfer" className="bg-[#0F1535]">העברה בנקאית</option>
                            <option value="credit" className="bg-[#0F1535]">אשראי</option>
                            <option value="cash" className="bg-[#0F1535]">מזומן</option>
                            <option value="bit" className="bg-[#0F1535]">ביט</option>
                            <option value="paybox" className="bg-[#0F1535]">פייבוקס</option>
                            <option value="check" className="bg-[#0F1535]">צ׳ק</option>
                            <option value="other" className="bg-[#0F1535]">אחר</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[13px] text-white/70 text-right">הערות</label>
                        <div className="border border-[#4C526B] rounded-[7px] min-h-[40px] px-[8px] py-[6px]">
                          <textarea
                            title="הערות"
                            value={newPaymentNotes}
                            onChange={(e) => setNewPaymentNotes(e.target.value)}
                            placeholder="הערות..."
                            className="w-full bg-transparent text-white text-[13px] text-right rounded-[7px] border-none outline-none resize-none min-h-[28px] placeholder:text-white/30"
                          />
                        </div>
                      </div>
                      <button
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
                      </button>
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
