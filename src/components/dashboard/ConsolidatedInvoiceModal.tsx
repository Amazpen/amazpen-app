"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { uploadFile } from "@/lib/uploadFile";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useFormDraft } from "@/hooks/useFormDraft";
import { generateUUID } from "@/lib/utils";
import SupplierSearchSelect from "@/components/ui/SupplierSearchSelect";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Business {
  id: string;
  name: string;
  vat_percentage?: number;
}

interface Supplier {
  id: string;
  name: string;
  waiting_for_coordinator: boolean;
}

interface DBDeliveryNote {
  id: string;
  delivery_note_number: string | null;
  delivery_date: string;
  subtotal: number;
  vat_amount: number | null;
  total_amount: number;
  notes: string | null;
}

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

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

  // Draft persistence
  const { saveDraft, restoreDraft, clearDraft } = useFormDraft("consolidatedInvoice:draft");
  const draftRestored = useRef(false);

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

  // Delivery notes state - Bubble-style with month selector + checkboxes
  const [allDeliveryNotes, setAllDeliveryNotes] = useState<DBDeliveryNote[]>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1); // 1-12
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());

  // Available months from delivery notes
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    allDeliveryNotes.forEach(note => {
      const d = new Date(note.delivery_date);
      months.add(`${d.getFullYear()}-${d.getMonth() + 1}`);
    });
    return months;
  }, [allDeliveryNotes]);

  // Filter delivery notes by selected month
  const filteredNotes = useMemo(() => {
    return allDeliveryNotes.filter(note => {
      const d = new Date(note.delivery_date);
      return d.getMonth() + 1 === selectedMonth && d.getFullYear() === selectedYear;
    });
  }, [allDeliveryNotes, selectedMonth, selectedYear]);

  // Get unique years from notes
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    allDeliveryNotes.forEach(note => {
      years.add(new Date(note.delivery_date).getFullYear());
    });
    // Always include current year
    years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [allDeliveryNotes]);

  // Selected notes from filtered view
  const selectedFilteredNotes = useMemo(() => {
    return filteredNotes.filter(n => selectedNoteIds.has(n.id));
  }, [filteredNotes, selectedNoteIds]);

  // All selected notes (across all months)
  const allSelectedNotes = useMemo(() => {
    return allDeliveryNotes.filter(n => selectedNoteIds.has(n.id));
  }, [allDeliveryNotes, selectedNoteIds]);

  // Are all filtered notes selected?
  const allFilteredSelected = filteredNotes.length > 0 && filteredNotes.every(n => selectedNoteIds.has(n.id));

  // Save draft on form changes
  const saveDraftData = useCallback(() => {
    saveDraft({
      selectedBusinessId, selectedSupplierId, invoiceDate, invoiceNumber,
      totalAmount, isClosed, notes, selectedNoteIds: Array.from(selectedNoteIds),
    });
  }, [saveDraft, selectedBusinessId, selectedSupplierId, invoiceDate, invoiceNumber,
    totalAmount, isClosed, notes, selectedNoteIds]);

  useEffect(() => {
    if (draftRestored.current && isOpen) {
      saveDraftData();
    }
  }, [saveDraftData, isOpen]);

  // Restore draft when modal opens
  useEffect(() => {
    if (isOpen) {
      draftRestored.current = false;
      setTimeout(() => {
        const draft = restoreDraft();
        if (draft) {
          if (draft.selectedBusinessId) setSelectedBusinessId(draft.selectedBusinessId as string);
          if (draft.selectedSupplierId) setSelectedSupplierId(draft.selectedSupplierId as string);
          if (draft.invoiceDate) setInvoiceDate(draft.invoiceDate as string);
          if (draft.invoiceNumber) setInvoiceNumber(draft.invoiceNumber as string);
          if (draft.totalAmount) setTotalAmount(draft.totalAmount as string);
          if (draft.isClosed) setIsClosed(draft.isClosed as string);
          if (draft.notes !== undefined) setNotes(draft.notes as string);
          if (draft.selectedNoteIds) setSelectedNoteIds(new Set(draft.selectedNoteIds as string[]));
        }
        draftRestored.current = true;
      }, 0);
    }
  }, [isOpen, restoreDraft]);

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

      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .single();

      if (profile?.is_admin) {
        const { data: allBusinesses } = await supabase
          .from("businesses")
          .select("id, name, vat_percentage")
          .is("deleted_at", null)
          .eq("status", "active")
          .order("name");

        if (allBusinesses) {
          setBusinesses(allBusinesses);
        }
      } else {
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

  // Fetch suppliers when business changes
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

  // Fetch ALL unlinked delivery notes when supplier is selected
  useEffect(() => {
    if (!selectedSupplierId || !selectedBusinessId) {
      setAllDeliveryNotes([]);
      setSelectedNoteIds(new Set());
      return;
    }

    const fetchUnlinkedDeliveryNotes = async () => {
      setIsLoadingNotes(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("delivery_notes")
        .select("id, delivery_note_number, delivery_date, subtotal, vat_amount, total_amount, notes")
        .eq("supplier_id", selectedSupplierId)
        .eq("business_id", selectedBusinessId)
        .is("invoice_id", null)
        .order("delivery_date", { ascending: true });

      if (data) {
        setAllDeliveryNotes(data);
        // Auto-select month of first note if available
        if (data.length > 0) {
          const firstDate = new Date(data[0].delivery_date);
          setSelectedMonth(firstDate.getMonth() + 1);
          setSelectedYear(firstDate.getFullYear());
        }
      } else {
        setAllDeliveryNotes([]);
      }
      setIsLoadingNotes(false);
    };

    fetchUnlinkedDeliveryNotes();
  }, [selectedSupplierId, selectedBusinessId]);

  // Toggle single note selection
  const toggleNoteSelection = (noteId: string) => {
    setSelectedNoteIds(prev => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  };

  // Toggle select all filtered notes
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      // Deselect all filtered
      setSelectedNoteIds(prev => {
        const next = new Set(prev);
        filteredNotes.forEach(n => next.delete(n.id));
        return next;
      });
    } else {
      // Select all filtered
      setSelectedNoteIds(prev => {
        const next = new Set(prev);
        filteredNotes.forEach(n => next.add(n.id));
        return next;
      });
    }
  };

  // Calculate total of selected notes (all months)
  const selectedTotal = useMemo(() => {
    return allSelectedNotes.reduce((sum, n) => sum + Number(n.total_amount), 0);
  }, [allSelectedNotes]);

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);

    try {
      for (const file of Array.from(files)) {
        const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];
        if (!allowedTypes.includes(file.type)) {
          showToast("קובץ לא נתמך. יש להעלות PNG, JPG או PDF", "warning");
          continue;
        }

        if (file.size > 5 * 1024 * 1024) {
          showToast("גודל הקובץ המקסימלי הוא 5MB", "warning");
          continue;
        }

        const fileExt = file.name.split(".").pop();
        const fileName = `consolidated-invoices/${generateUUID()}-${Date.now()}.${fileExt}`;

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
    setAllDeliveryNotes([]);
    setSelectedNoteIds(new Set());
    setSelectedMonth(new Date().getMonth() + 1);
    setSelectedYear(new Date().getFullYear());
  };

  // Close popup
  const handleClose = () => {
    handleReset();
    onClose();
  };

  // Submit form
  const handleSubmit = async () => {
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
    if (selectedNoteIds.size === 0) {
      showToast("יש לבחור לפחות תעודת משלוח אחת", "warning");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const total = parseFloat(totalAmount);
      const selectedBiz = businesses.find(b => b.id === selectedBusinessId);
      const bizVatRate = Number(selectedBiz?.vat_percentage) || 0.18;
      const subtotal = total / (1 + bizVatRate);
      const vatAmount = total - subtotal;

      const status = isClosed === "yes" ? "pending" : "needs_review";

      // Insert consolidated invoice
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
          invoice_type: "current",
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

      // Link selected delivery notes to the invoice
      if (invoice && selectedNoteIds.size > 0) {
        const noteIdsArray = Array.from(selectedNoteIds);
        const { error: linkError } = await supabase
          .from("delivery_notes")
          .update({
            invoice_id: invoice.id,
            is_verified: isClosed === "yes",
          })
          .in("id", noteIdsArray);

        if (linkError) {
          console.error("Error linking delivery notes:", linkError);
          showToast("החשבונית נשמרה אך היתה שגיאה בקישור תעודות המשלוח", "warning");
        }
      }

      clearDraft();
      showToast(isClosed === "yes" ? "המרכזת נסגרה ונשמרה בהצלחה" : "המרכזת נשמרה בהצלחה", "success");
      handleClose();
    } catch (err) {
      console.error("Error saving consolidated invoice:", err);
      showToast("שגיאה בשמירת המרכזת", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format date for display (DD/MM/YY)
  const formatDateShort = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = String(d.getFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
  };

  // Format number for display
  const formatNumber = (num: number) => {
    return num.toLocaleString("he-IL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  };

  // Get selected business name
  const selectedBusinessName = businesses.find(b => b.id === selectedBusinessId)?.name || "";

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <SheetContent
        side="bottom"
        className="h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0f1535] border-t border-[#4C526B] overflow-y-auto rounded-t-[20px]"
        showCloseButton={false}
      >
        <SheetHeader className="border-b border-[#4C526B] pb-4">
          <div className="flex justify-between items-center flex-row-reverse">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="text-[#7B91B0] hover:text-white transition-colors"
              title="סגור"
              aria-label="סגור"
            >
              <X className="w-6 h-6" />
            </Button>
            <div className="flex flex-col items-center gap-[2px]">
              {selectedBusinessName && (
                <span className="text-white text-[20px] font-bold">{selectedBusinessName}</span>
              )}
              <SheetTitle className="text-white text-[18px] font-normal">
                {selectedBusinessName ? "מרכזת | תעודות משלוח" : "הוספת מרכזת"}
              </SheetTitle>
            </div>
            <div className="w-[24px]" />
          </div>
        </SheetHeader>

        {/* Form */}
        <div className="flex flex-col gap-[15px] px-[5px]">
          {/* Business Select */}
          <div className="flex flex-col gap-[3px]">
            <label className="text-[15px] font-medium text-white text-right">בחירת עסק</label>
            <Select
              value={selectedBusinessId || "__none__"}
              onValueChange={(val) => setSelectedBusinessId(val === "__none__" ? "" : val)}
              disabled={isLoadingBusinesses}
            >
              <SelectTrigger className="w-full h-[48px] bg-[#0F1535] text-[16px] text-center rounded-[10px] border-[#4C526B]">
                <SelectValue placeholder={isLoadingBusinesses ? "טוען..." : "בחר/י עסק..."} />
              </SelectTrigger>
              <SelectContent>
                {businesses.map((business) => (
                  <SelectItem key={business.id} value={business.id}>
                    {business.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Supplier Select */}
          <SupplierSearchSelect
            suppliers={suppliers}
            value={selectedSupplierId}
            onChange={setSelectedSupplierId}
            label="בחירת ספק:"
            disabled={!selectedBusinessId || isLoadingSuppliers}
            placeholder={isLoadingSuppliers ? "טוען..." : "בחר/י ספק"}
            emptyMessage={selectedBusinessId ? "אין ספקי מרכזת" : undefined}
          />
          {selectedBusinessId && suppliers.length === 0 && !isLoadingSuppliers && (
            <p className="text-[12px] text-[#F64E60] text-right">
              אין ספקים מוגדרים כמרכזת. יש לסמן ספק כ&quot;מרכזת&quot; בהגדרות הספק.
            </p>
          )}

          {/* Month Selector - like Bubble */}
          {selectedSupplierId && (
            <div className="flex flex-col gap-[5px]">
              <label className="text-[15px] font-medium text-white text-right">בחירת חודש:</label>

              {/* Year selector if multiple years */}
              {availableYears.length > 1 && (
                <div className="flex items-center justify-end gap-[10px] mb-[5px]">
                  {availableYears.map(year => (
                    <button
                      key={year}
                      type="button"
                      onClick={() => setSelectedYear(year)}
                      className={`px-[12px] py-[4px] rounded-[7px] text-[14px] transition-all border ${
                        selectedYear === year
                          ? "border-white bg-white/10 text-white font-bold"
                          : "border-white/20 text-white/60 hover:border-white/40"
                      }`}
                    >
                      {year}
                    </button>
                  ))}
                </div>
              )}

              {/* Month buttons */}
              <div className="flex flex-col gap-[10px]">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                  const key = `${selectedYear}-${month}`;
                  const hasNotes = availableMonths.has(key);
                  const isSelected = selectedMonth === month && selectedYear === selectedYear;
                  const noteCount = allDeliveryNotes.filter(n => {
                    const d = new Date(n.delivery_date);
                    return d.getMonth() + 1 === month && d.getFullYear() === selectedYear;
                  }).length;

                  if (!hasNotes) return null; // Only show months that have delivery notes

                  return (
                    <button
                      key={month}
                      type="button"
                      onClick={() => setSelectedMonth(month)}
                      className={`flex items-center justify-between w-full min-h-[45px] rounded-[7px] px-[12px] py-[7px] transition-all border cursor-pointer ${
                        isSelected && selectedMonth === month
                          ? "border-white bg-white/10"
                          : "border-white/20 hover:border-white/40"
                      }`}
                    >
                      <span className="text-[13px] text-white/50">
                        {noteCount} תעודות
                      </span>
                      <span className="text-[16px] text-white">
                        חודש {HEBREW_MONTHS[month - 1]}
                      </span>
                    </button>
                  );
                })}

                {allDeliveryNotes.length === 0 && !isLoadingNotes && (
                  <div className="text-center text-white/35 text-[20px] font-bold py-[20px]">
                    אין תעודות משלוח
                  </div>
                )}

                {isLoadingNotes && (
                  <div className="text-center text-white/50 text-[14px] py-[20px]">
                    טוען תעודות משלוח...
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Delivery Notes Table - like Bubble */}
          {selectedSupplierId && filteredNotes.length > 0 && (
            <div className="flex flex-col gap-[10px]">
              <label className="text-[15px] font-medium text-white text-right">
                בחירת תעודות משלוח לסגירה:
              </label>

              <div className="flex flex-col border border-[#4C526B] rounded-[10px] overflow-hidden">
                {/* Table Header */}
                <div className="flex items-center justify-end gap-[10px] border-b border-[#4C526B] px-[7px] py-[7px] min-h-[40px]">
                  <div className="flex-1 text-center text-[14px] text-white">אחרי מע&quot;מ</div>
                  <div className="flex-1 text-center text-[14px] text-white">לפני מע&quot;מ</div>
                  <div className="flex-1 text-center text-[14px] text-white">אסמכתא</div>
                  <div className="flex items-center gap-[3px] w-[80px] justify-end">
                    <span className="text-[14px] text-white">בחר/י הכל</span>
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="w-[18px] h-[18px] flex items-center justify-center border border-white/60 rounded-[3px] transition-colors"
                      style={{
                        backgroundColor: allFilteredSelected ? "#3CD856" : "transparent",
                        borderColor: allFilteredSelected ? "#3CD856" : "rgba(255,255,255,0.6)",
                      }}
                    >
                      {allFilteredSelected && <Check className="w-[14px] h-[14px] text-white" />}
                    </button>
                  </div>
                </div>

                {/* Table Rows */}
                <div className="max-h-[300px] overflow-y-auto">
                  {filteredNotes.map(note => {
                    const isSelected = selectedNoteIds.has(note.id);
                    return (
                      <button
                        type="button"
                        key={note.id}
                        onClick={() => toggleNoteSelection(note.id)}
                        className={`flex items-center justify-end gap-[10px] w-full px-[7px] py-[7px] min-h-[45px] rounded-[7px] mx-[3px] my-[3px] transition-all cursor-pointer ${
                          isSelected ? "bg-white/10" : "hover:bg-white/5"
                        }`}
                        style={{ width: "calc(100% - 6px)" }}
                      >
                        <div className="flex-1 text-center text-[16px] text-white font-bold">
                          ₪{formatNumber(Number(note.total_amount))}
                        </div>
                        <div className="flex-1 text-center text-[16px] text-white font-bold">
                          ₪{formatNumber(Number(note.subtotal))}
                        </div>
                        <div className="flex-1 text-center text-[16px] text-white font-bold">
                          {note.delivery_note_number || "-"}
                        </div>
                        <div className="flex items-center gap-[3px] w-[80px] justify-end">
                          <span className="text-[14px] text-white font-bold">
                            {formatDateShort(note.delivery_date)}
                          </span>
                          <div
                            className="w-[20px] h-[20px] flex items-center justify-center border rounded-[3px] shrink-0 transition-colors"
                            style={{
                              backgroundColor: isSelected ? "#3CD856" : "transparent",
                              borderColor: isSelected ? "#3CD856" : "rgba(255,255,255,0.6)",
                            }}
                          >
                            {isSelected && <Check className="w-[14px] h-[14px] text-white" />}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Summary Stats - like Bubble */}
              <div className="flex flex-col gap-[5px] border border-white/35 rounded-[10px] p-[5px]">
                <div className="flex items-center justify-between">
                  <span className="text-[16px] text-white">
                    מספר שורות שנבחרו: {selectedNoteIds.size}
                  </span>
                  <span className="text-[16px] text-white">
                    מספר שורות: {filteredNotes.length}
                  </span>
                </div>
                <div className="text-right text-[16px] text-white">
                  סה&quot;כ תעודות משלוח שנבחרו: ₪{formatNumber(selectedTotal)}
                </div>
              </div>
            </div>
          )}

          {/* Close Fields Section */}
          {selectedSupplierId && (
            <div className="flex flex-col gap-[15px]">
              {/* Date Field */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">בחירת תאריך מרכזת:</label>
                <DatePickerField
                  value={invoiceDate}
                  onChange={(val) => setInvoiceDate(val)}
                />
              </div>

              {/* Invoice Number */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">מספר חשבונית מרכזת:</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <Input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="..."
                    className="w-full h-full bg-transparent text-white text-[16px] text-right rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                  />
                </div>
              </div>

              {/* Total Amount */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">סכום מרכזת כולל מע&quot;מ:</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    placeholder="..."
                    className="w-full h-full bg-transparent text-white text-[16px] text-right rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                  />
                </div>
              </div>

              {/* Is Closed - with red border like Bubble */}
              <div className="flex flex-col gap-[3px] border border-[#F64E60] rounded-[10px] p-[3px]">
                <label className="text-[15px] font-medium text-white text-right">האם נסגר?</label>
                <Select
                  value={isClosed || "__none__"}
                  onValueChange={(val) => setIsClosed(val === "__none__" ? "" : val)}
                >
                  <SelectTrigger className="w-full h-[48px] bg-[#0F1535] text-[16px] text-center rounded-[5px] border-[#4C526B]">
                    <SelectValue placeholder="כן/לא" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">כן</SelectItem>
                    <SelectItem value="no">לא</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">הערות:</label>
                <div className="border border-[#4C526B] rounded-[10px]">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="..."
                    rows={3}
                    className="w-full min-h-[100px] bg-transparent text-white text-[16px] text-right rounded-[10px] border-none outline-none p-[10px] placeholder:text-white/30 resize-none"
                  />
                </div>
              </div>

              {/* File Upload - with red border like Bubble */}
              <div className="flex flex-col gap-[5px] border border-[#F64E60] rounded-[10px] p-[3px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-[5px] flex-wrap">
                    {uploadedFiles.map((file, index) => (
                      <div
                        key={`file-${file.name}-${file.url}`}
                        className="flex items-center gap-[3px] bg-white/10 rounded-[5px] px-[8px] py-[3px]"
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveFile(index)}
                          className="text-[#F64E60] hover:text-[#ff6b7a] text-[14px] font-bold"
                        >
                          ×
                        </Button>
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
              <div className="flex items-center justify-around gap-0 mt-[30px] mb-[10px]">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleReset}
                  className="min-w-[40%] max-w-[40%] h-[40px] border border-white rounded-[5px] text-white text-[17px] font-semibold transition-all hover:bg-white/10"
                >
                  איפוס
                </Button>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting || !selectedBusinessId || !selectedSupplierId || !invoiceNumber || !totalAmount || !isClosed || selectedNoteIds.size === 0}
                  className="min-w-[40%] max-w-[40%] h-[40px] bg-[#0F1535] border border-[#0F1535] rounded-[5px] text-white text-[17px] font-semibold transition-all disabled:opacity-50 disabled:cursor-default hover:bg-[#1a2050]"
                >
                  {isSubmitting ? "שומר..." : "שמירה"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
