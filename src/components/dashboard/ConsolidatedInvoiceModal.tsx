"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { X } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { uploadFile } from "@/lib/uploadFile";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface Business {
  id: string;
  name: string;
}

interface Supplier {
  id: string;
  name: string;
  waiting_for_coordinator: boolean;
}

interface DeliveryNote {
  id?: string;
  delivery_note_number: string;
  delivery_date: string;
  total_amount: string;
  notes: string;
}

interface ConsolidatedInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ConsolidatedInvoiceModal({
  isOpen,
  onClose,
}: ConsolidatedInvoiceModalProps) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>("");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState<string>("");
  const [invoiceNumber, setInvoiceNumber] = useState<string>("");
  const [totalAmount, setTotalAmount] = useState<string>("");
  const [isClosed, setIsClosed] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; url: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingBusinesses, setIsLoadingBusinesses] = useState(true);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(false);

  // Delivery notes state
  const [deliveryNotes, setDeliveryNotes] = useState<DeliveryNote[]>([]);
  const [showAddDeliveryNote, setShowAddDeliveryNote] = useState(false);
  const [newDeliveryNote, setNewDeliveryNote] = useState<DeliveryNote>({
    delivery_note_number: "",
    delivery_date: "",
    total_amount: "",
    notes: "",
  });

  // Set default date to today
  useEffect(() => {
    if (isOpen && !invoiceDate) {
      const today = new Date();
      const formattedDate = today.toISOString().split("T")[0];
      setInvoiceDate(formattedDate);
    }
  }, [isOpen, invoiceDate]);

  // Fetch businesses on open
  useEffect(() => {
    if (!isOpen) return;

    const fetchBusinesses = async () => {
      setIsLoadingBusinesses(true);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setIsLoadingBusinesses(false);
        return;
      }

      // Check if admin
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .single();

      if (profile?.is_admin) {
        // Admin sees all businesses
        const { data: allBusinesses } = await supabase
          .from("businesses")
          .select("id, name")
          .is("deleted_at", null)
          .eq("status", "active")
          .order("name");

        if (allBusinesses) {
          setBusinesses(allBusinesses);
        }
      } else {
        // Regular user sees only their businesses
        const { data: memberships } = await supabase
          .from("business_members")
          .select("business_id")
          .eq("user_id", user.id)
          .is("deleted_at", null);

        const businessIds = memberships?.map(m => m.business_id) || [];

        if (businessIds.length > 0) {
          const { data: userBusinesses } = await supabase
            .from("businesses")
            .select("id, name")
            .in("id", businessIds)
            .is("deleted_at", null)
            .eq("status", "active")
            .order("name");

          if (userBusinesses) {
            setBusinesses(userBusinesses);
          }
        }
      }

      setIsLoadingBusinesses(false);
    };

    fetchBusinesses();
  }, [isOpen]);

  // Fetch suppliers when business changes - only suppliers marked as "waiting_for_coordinator"
  useEffect(() => {
    if (!selectedBusinessId) {
      setSuppliers([]);
      setSelectedSupplierId("");
      return;
    }

    const fetchSuppliers = async () => {
      setIsLoadingSuppliers(true);
      const supabase = createClient();

      const { data: supplierData } = await supabase
        .from("suppliers")
        .select("id, name, waiting_for_coordinator")
        .eq("business_id", selectedBusinessId)
        .eq("waiting_for_coordinator", true)
        .is("deleted_at", null)
        .order("name");

      if (supplierData) {
        setSuppliers(supplierData);
      }
      setIsLoadingSuppliers(false);
    };

    fetchSuppliers();
  }, [selectedBusinessId]);

  // Calculate total from delivery notes
  const calculateDeliveryNotesTotal = () => {
    return deliveryNotes.reduce((sum, note) => {
      const amount = parseFloat(note.total_amount) || 0;
      return sum + amount;
    }, 0);
  };

  // Check if totals match
  const totalsMatch = () => {
    if (deliveryNotes.length === 0) return true;
    const invoiceTotal = parseFloat(totalAmount) || 0;
    const notesTotal = calculateDeliveryNotesTotal();
    return Math.abs(invoiceTotal - notesTotal) < 0.01;
  };

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);

    try {
      for (const file of Array.from(files)) {
        // Validate file type
        const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];
        if (!allowedTypes.includes(file.type)) {
          showToast("קובץ לא נתמך. יש להעלות PNG, JPG או PDF", "warning");
          continue;
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
          showToast("גודל הקובץ המקסימלי הוא 5MB", "warning");
          continue;
        }

        const fileExt = file.name.split(".").pop();
        const fileName = `consolidated-invoices/${crypto.randomUUID()}-${Date.now()}.${fileExt}`;

        const result = await uploadFile(file, fileName, "assets");

        if (result.success && result.publicUrl) {
          setUploadedFiles(prev => [...prev, { name: file.name, url: result.publicUrl! }]);
        } else {
          showToast(`שגיאה בהעלאת ${file.name}`, "error");
        }
      }
    } catch (err) {
      console.error("Error uploading files:", err);
      showToast("שגיאה בהעלאת הקבצים", "error");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Remove uploaded file
  const handleRemoveFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Add delivery note
  const handleAddDeliveryNote = () => {
    if (!newDeliveryNote.delivery_note_number.trim()) {
      showToast("יש להזין מספר תעודת משלוח", "warning");
      return;
    }
    if (!newDeliveryNote.delivery_date) {
      showToast("יש לבחור תאריך תעודה", "warning");
      return;
    }
    if (!newDeliveryNote.total_amount || parseFloat(newDeliveryNote.total_amount) <= 0) {
      showToast("יש להזין סכום תעודה", "warning");
      return;
    }

    setDeliveryNotes(prev => [...prev, { ...newDeliveryNote }]);
    setNewDeliveryNote({
      delivery_note_number: "",
      delivery_date: "",
      total_amount: "",
      notes: "",
    });
    setShowAddDeliveryNote(false);
  };

  // Remove delivery note
  const handleRemoveDeliveryNote = (index: number) => {
    setDeliveryNotes(prev => prev.filter((_, i) => i !== index));
  };

  // Reset form
  const handleReset = () => {
    setSelectedBusinessId("");
    setSelectedSupplierId("");
    setInvoiceDate(new Date().toISOString().split("T")[0]);
    setInvoiceNumber("");
    setTotalAmount("");
    setIsClosed("");
    setNotes("");
    setUploadedFiles([]);
    setDeliveryNotes([]);
    setShowAddDeliveryNote(false);
    setNewDeliveryNote({
      delivery_note_number: "",
      delivery_date: "",
      total_amount: "",
      notes: "",
    });
  };

  // Close popup
  const handleClose = () => {
    handleReset();
    onClose();
  };

  // Submit form
  const handleSubmit = async () => {
    // Validate required fields
    if (!selectedBusinessId) {
      showToast("יש לבחור עסק", "warning");
      return;
    }
    if (!selectedSupplierId) {
      showToast("יש לבחור ספק", "warning");
      return;
    }
    if (!invoiceDate) {
      showToast("יש לבחור תאריך", "warning");
      return;
    }
    if (!invoiceNumber.trim()) {
      showToast("יש להזין מספר חשבונית", "warning");
      return;
    }
    if (!totalAmount || parseFloat(totalAmount) <= 0) {
      showToast("יש להזין סכום חשבונית", "warning");
      return;
    }
    if (!isClosed) {
      showToast("יש לבחור האם החשבונית נסגרה", "warning");
      return;
    }

    // If closed, validate totals match
    if (isClosed === "yes" && deliveryNotes.length > 0 && !totalsMatch()) {
      showToast("סכום החשבונית לא תואם לסכום תעודות המשלוח", "warning");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const total = parseFloat(totalAmount);
      // Calculate VAT (assuming 17% VAT)
      const subtotal = total / 1.17;
      const vatAmount = total - subtotal;

      // Determine status: if closed -> pending (waiting for payment), if not -> needs_review
      const status = isClosed === "yes" ? "pending" : "needs_review";

      // Insert consolidated invoice into invoices table
      const { data: invoice, error: invoiceError } = await supabase
        .from("invoices")
        .insert({
          business_id: selectedBusinessId,
          supplier_id: selectedSupplierId,
          invoice_date: invoiceDate,
          invoice_number: invoiceNumber.trim(),
          subtotal: subtotal,
          vat_amount: vatAmount,
          total_amount: total,
          status: status,
          invoice_type: "current", // Consolidated invoice becomes a regular invoice
          is_consolidated: true,
          notes: notes.trim() || null,
          attachment_url: uploadedFiles.length > 0 ? uploadedFiles[0].url : null,
          created_by: user?.id,
        })
        .select()
        .single();

      if (invoiceError) {
        throw invoiceError;
      }

      // Insert delivery notes if any
      if (deliveryNotes.length > 0 && invoice) {
        const deliveryNotesData = deliveryNotes.map(note => {
          const noteTotal = parseFloat(note.total_amount);
          const noteSubtotal = noteTotal / 1.17;
          const noteVat = noteTotal - noteSubtotal;

          return {
            invoice_id: invoice.id,
            business_id: selectedBusinessId,
            supplier_id: selectedSupplierId,
            delivery_note_number: note.delivery_note_number.trim(),
            delivery_date: note.delivery_date,
            subtotal: noteSubtotal,
            vat_amount: noteVat,
            total_amount: noteTotal,
            notes: note.notes.trim() || null,
            is_verified: isClosed === "yes",
          };
        });

        const { error: notesError } = await supabase
          .from("delivery_notes")
          .insert(deliveryNotesData);

        if (notesError) {
          console.error("Error inserting delivery notes:", notesError);
          // Don't throw - invoice was already created
          showToast("החשבונית נשמרה אך היתה שגיאה בשמירת תעודות המשלוח", "warning");
        }
      }

      showToast(isClosed === "yes" ? "המרכזת נסגרה ונשמרה בהצלחה" : "המרכזת נשמרה בהצלחה", "success");
      handleClose();
    } catch (err) {
      console.error("Error saving consolidated invoice:", err);
      showToast("שגיאה בשמירת המרכזת", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format date for display
  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return "יום/חודש/שנה";
    const date = new Date(dateStr);
    return date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  // Format number for display
  const formatNumber = (num: number) => {
    return num.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <SheetContent
        side="bottom"
        className="h-auto max-h-[85vh] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
        showCloseButton={false}
      >
        <SheetHeader className="border-b border-[#4C526B] pb-4">
          <div className="flex justify-between items-center" dir="ltr">
            <button
              type="button"
              onClick={handleClose}
              className="text-[#7B91B0] hover:text-white transition-colors"
              title="סגור"
              aria-label="סגור"
            >
              <X className="w-6 h-6" />
            </button>
            <SheetTitle className="text-white text-xl font-bold">הוספת מרכזת</SheetTitle>
            <div className="w-[24px]" />
          </div>
        </SheetHeader>

        {/* Form */}
        <div className="flex flex-col gap-[15px] px-[5px]">
          {/* Business Select */}
          <div className="flex flex-col gap-[3px]">
            <label className="text-[15px] font-medium text-white text-right">בחירת עסק</label>
            <div className="border border-[#4C526B] rounded-[10px]">
              <select
                title="בחר עסק"
                value={selectedBusinessId}
                onChange={(e) => setSelectedBusinessId(e.target.value)}
                disabled={isLoadingBusinesses}
                className="w-full h-[48px] bg-[#0F1535] text-white/40 text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
              >
                <option value="" className="bg-[#0F1535] text-white/40">
                  {isLoadingBusinesses ? "טוען..." : "בחר/י עסק..."}
                </option>
                {businesses.map((business) => (
                  <option key={business.id} value={business.id} className="bg-[#0F1535] text-white">
                    {business.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Supplier Select - only shows suppliers marked as coordinator */}
          <div className="flex flex-col gap-[3px]">
            <label className="text-[15px] font-medium text-white text-right">בחירת ספק מרכזת</label>
            <div className="border border-[#4C526B] rounded-[10px]">
              <select
                title="בחר ספק"
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                disabled={!selectedBusinessId || isLoadingSuppliers}
                className="w-full h-[48px] bg-[#0F1535] text-white/40 text-[16px] text-center rounded-[10px] border-none outline-none px-[10px] disabled:opacity-50"
              >
                <option value="" className="bg-[#0F1535] text-white/40">
                  {isLoadingSuppliers ? "טוען..." : suppliers.length === 0 && selectedBusinessId ? "אין ספקי מרכזת" : "בחר/י ספק..."}
                </option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id} className="bg-[#0F1535] text-white">
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>
            {selectedBusinessId && suppliers.length === 0 && !isLoadingSuppliers && (
              <p className="text-[12px] text-[#F64E60] text-right">
                אין ספקים מוגדרים כמרכזת. יש לסמן ספק כ&quot;מרכזת&quot; בהגדרות הספק.
              </p>
            )}
          </div>

          {/* Date Field */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">תאריך מרכזת</label>
            <div className="relative border border-[#4C526B] rounded-[10px] h-[50px] px-[10px] flex items-center justify-center">
              <span className={`text-[16px] font-semibold pointer-events-none ${invoiceDate ? "text-white" : "text-white/40"}`}>
                {formatDateDisplay(invoiceDate)}
              </span>
              <input
                type="date"
                title="תאריך מרכזת"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
            </div>
          </div>

          {/* Invoice Number */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">מספר חשבונית מרכזת</label>
            <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="מספר חשבונית..."
                className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
              />
            </div>
          </div>

          {/* Total Amount */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">סכום כולל מע&quot;מ</label>
            <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
              <input
                type="text"
                inputMode="decimal"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="0.00"
                className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
              />
            </div>
          </div>

          {/* Delivery Notes Section */}
          <div className="flex flex-col gap-[10px] border border-[#4C526B] rounded-[10px] p-[10px]">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowAddDeliveryNote(!showAddDeliveryNote)}
                className="text-[14px] text-[#0075FF] hover:text-[#00D4FF] transition-colors"
              >
                + הוספת תעודה
              </button>
              <label className="text-[15px] font-medium text-white">תעודות משלוח</label>
            </div>

            {/* Add Delivery Note Form */}
            {showAddDeliveryNote && (
              <div className="flex flex-col gap-[10px] bg-[#1a1f42] rounded-[8px] p-[10px]">
                <div className="grid grid-cols-2 gap-[10px]">
                  <div className="flex flex-col gap-[3px]">
                    <label className="text-[12px] text-white/60 text-right">מספר תעודה</label>
                    <input
                      type="text"
                      value={newDeliveryNote.delivery_note_number}
                      onChange={(e) => setNewDeliveryNote(prev => ({ ...prev, delivery_note_number: e.target.value }))}
                      placeholder="מספר..."
                      className="h-[40px] bg-[#0F1535] border border-[#4C526B] rounded-[8px] text-white text-[14px] text-center px-[8px] placeholder:text-white/30"
                    />
                  </div>
                  <div className="flex flex-col gap-[3px]">
                    <label className="text-[12px] text-white/60 text-right">תאריך</label>
                    <input
                      type="date"
                      title="תאריך תעודה"
                      value={newDeliveryNote.delivery_date}
                      onChange={(e) => setNewDeliveryNote(prev => ({ ...prev, delivery_date: e.target.value }))}
                      className="h-[40px] bg-[#0F1535] border border-[#4C526B] rounded-[8px] text-white text-[14px] text-center px-[8px]"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-[10px]">
                  <div className="flex flex-col gap-[3px]">
                    <label className="text-[12px] text-white/60 text-right">סכום כולל</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={newDeliveryNote.total_amount}
                      onChange={(e) => setNewDeliveryNote(prev => ({ ...prev, total_amount: e.target.value }))}
                      placeholder="0.00"
                      className="h-[40px] bg-[#0F1535] border border-[#4C526B] rounded-[8px] text-white text-[14px] text-center px-[8px] placeholder:text-white/30"
                    />
                  </div>
                  <div className="flex flex-col gap-[3px]">
                    <label className="text-[12px] text-white/60 text-right">הערה</label>
                    <input
                      type="text"
                      value={newDeliveryNote.notes}
                      onChange={(e) => setNewDeliveryNote(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="הערה..."
                      className="h-[40px] bg-[#0F1535] border border-[#4C526B] rounded-[8px] text-white text-[14px] text-center px-[8px] placeholder:text-white/30"
                    />
                  </div>
                </div>
                <div className="flex gap-[10px]">
                  <button
                    type="button"
                    onClick={() => setShowAddDeliveryNote(false)}
                    className="flex-1 h-[36px] border border-white/30 rounded-[8px] text-white/60 text-[14px] hover:bg-white/5"
                  >
                    ביטול
                  </button>
                  <button
                    type="button"
                    onClick={handleAddDeliveryNote}
                    className="flex-1 h-[36px] bg-[#3CD856] rounded-[8px] text-white text-[14px] font-medium hover:bg-[#34c04c]"
                  >
                    הוסף
                  </button>
                </div>
              </div>
            )}

            {/* Delivery Notes List */}
            {deliveryNotes.length > 0 && (
              <div className="flex flex-col gap-[8px]">
                {deliveryNotes.map((note, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between bg-[#1a1f42] rounded-[8px] p-[10px]"
                  >
                    <button
                      type="button"
                      onClick={() => handleRemoveDeliveryNote(index)}
                      className="text-[#F64E60] text-[18px] font-bold hover:opacity-80"
                    >
                      ×
                    </button>
                    <div className="flex flex-col items-end flex-1 mr-[10px]">
                      <div className="flex items-center gap-[10px]">
                        <span className="text-[14px] text-white font-medium">₪{formatNumber(parseFloat(note.total_amount))}</span>
                        <span className="text-[14px] text-white">{note.delivery_note_number}</span>
                      </div>
                      <span className="text-[12px] text-white/50">{formatDateDisplay(note.delivery_date)}</span>
                    </div>
                  </div>
                ))}

                {/* Total of delivery notes */}
                <div className="flex items-center justify-between pt-[8px] border-t border-white/10">
                  <span className={`text-[14px] font-bold ${totalsMatch() ? "text-[#3CD856]" : "text-[#F64E60]"}`}>
                    ₪{formatNumber(calculateDeliveryNotesTotal())}
                  </span>
                  <span className="text-[14px] text-white/60">סה&quot;כ תעודות:</span>
                </div>
                {!totalsMatch() && totalAmount && (
                  <p className="text-[12px] text-[#F64E60] text-right">
                    הפרש: ₪{formatNumber(Math.abs(parseFloat(totalAmount) - calculateDeliveryNotesTotal()))}
                  </p>
                )}
              </div>
            )}

            {deliveryNotes.length === 0 && !showAddDeliveryNote && (
              <p className="text-[12px] text-white/40 text-center py-[10px]">
                לא נוספו תעודות משלוח
              </p>
            )}
          </div>

          {/* Is Closed */}
          <div className="flex flex-col gap-[3px] border border-[#F64E60] rounded-[10px] p-[8px]">
            <label className="text-[15px] font-medium text-white text-right">האם נסגר?</label>
            <p className="text-[12px] text-white/50 text-right mb-[5px]">
              אם כן - החשבונית תעבור לממתינות לתשלום
            </p>
            <div className="border border-[#4C526B] rounded-[10px]">
              <select
                title="האם נסגר"
                value={isClosed}
                onChange={(e) => setIsClosed(e.target.value)}
                className="w-full h-[48px] bg-[#0F1535] text-white/40 text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
              >
                <option value="" className="bg-[#0F1535] text-white/40">כן/לא</option>
                <option value="yes" className="bg-[#0F1535] text-white">כן</option>
                <option value="no" className="bg-[#0F1535] text-white">לא</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">הערות</label>
            <div className="border border-[#4C526B] rounded-[10px]">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="הערות..."
                rows={3}
                className="w-full min-h-[80px] bg-transparent text-white text-[16px] text-right rounded-[10px] border-none outline-none p-[10px] placeholder:text-white/30 resize-none"
              />
            </div>
          </div>

          {/* File Upload */}
          <div className="flex flex-col gap-[5px] border border-[#4C526B] rounded-[10px] p-[8px]">
            <div className="flex items-center justify-between mb-[5px]">
              <div className="flex items-center gap-[5px] flex-wrap">
                {uploadedFiles.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-[3px] bg-white/10 rounded-[5px] px-[8px] py-[3px]"
                  >
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(index)}
                      className="text-[#F64E60] hover:text-[#ff6b7a] text-[14px] font-bold"
                    >
                      ×
                    </button>
                    <span className="text-white text-[12px] truncate max-w-[80px]">{file.name}</span>
                  </div>
                ))}
              </div>
              <label className="text-[15px] font-medium text-white">הוספת תמונות</label>
            </div>

            <div className="relative border border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center cursor-pointer hover:border-white/30 transition-colors">
              <span className="text-[14px] text-white/40">
                {isUploading ? "מעלה..." : "הוסף תמונה/מסמך"}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                title="העלאת קבצים"
                accept=".png,.jpg,.jpeg,.pdf"
                multiple
                onChange={handleFileUpload}
                disabled={isUploading}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-center gap-[15px] mt-[20px] mb-[10px]">
            <button
              type="button"
              onClick={handleReset}
              className="flex-1 h-[45px] border border-white rounded-[10px] text-white text-[16px] font-semibold transition-colors hover:bg-white/10"
            >
              איפוס
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !selectedBusinessId || !selectedSupplierId || !invoiceNumber || !totalAmount || !isClosed}
              className="flex-1 h-[45px] bg-gradient-to-r from-[#0075FF] to-[#00D4FF] rounded-[10px] text-white text-[16px] font-semibold transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "שומר..." : "שמירה"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
