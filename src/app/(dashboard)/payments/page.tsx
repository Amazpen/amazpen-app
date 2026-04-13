"use client";

import { useState, useEffect, useCallback, useRef, Suspense, Fragment } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import { PieChart, Pie, Cell, ResponsiveContainer, Sector, type PieSectorDataItem } from "recharts";
import { X } from "lucide-react";
import { Wallet } from "@phosphor-icons/react";
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
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerField } from "@/components/ui/date-picker-field";

// Format date as YYYY-MM-DD using local timezone (avoids UTC shift from toISOString)
const toLocalDateStr = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// Supplier from database
interface Supplier {
  id: string;
  name: string;
  expense_type: string;
  default_payment_method?: string | null;
  default_credit_card_id?: string | null;
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
  notes: string | null;
}

interface RecentPaymentDisplay {
  id: string;
  paymentId: string; // Real payment UUID (id may be paymentId-splitId for flat display)
  date: string;
  rawDate: string;
  supplier: string;
  supplierId: string;
  expenseType: string;
  paymentMethod: string;
  paymentMethodKey: string;
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
  linkedInvoices: LinkedInvoice[]; // All linked invoices (when payment covers multiple)
  linkedInvoiceId: string | null;
  rawSplits: Array<{ id: string; payment_method: string; amount: number; installments_count: number | null; installment_number: number | null; due_date: string | null; check_number: string | null; reference_number: string | null; credit_card_id: string | null }>;
}

// Open invoice from database
interface OpenInvoice {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  total_amount: number;
  status: string;
  attachment_url: string | null;
  notes: string | null;
}

function parseAttachmentUrls(raw: string | null): string[] {
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try { return JSON.parse(raw).filter((u: unknown) => typeof u === "string" && u); } catch { return []; }
  }
  return [raw];
}

function isPdfUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return url.toLowerCase().includes(".pdf");
  }
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

// Prior commitment from DB table
interface PriorCommitment {
  id: string;
  name: string;
  monthly_amount: number;
  total_installments: number;
  start_date: string;
  end_date: string;
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
  "credit_company": "אחר",
  "credit_companies": "אחר",
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
  // Parse YYYY-MM-DD from ISO string to avoid UTC timezone shift
  const [y, m, d] = dateStr.split("T")[0].split("-");
  return `${d}/${m}/${y.slice(2)}`;
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

// PDF Thumbnail component - renders first page of a PDF URL as an image
function PdfThumbnail({ url, className, onClick }: { url: string; className?: string; onClick?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfjsLib = await import("pdfjs-dist") as any;
        if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        }
        const loadingTask = pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const page = await pdf.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const desiredWidth = 140;
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = desiredWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (page.render as any)({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setLoaded(true);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) {
    return (
      <div className={className} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick?.()}>
        <div className="w-full h-full flex items-center justify-center bg-white/5">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/50">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className={className} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick?.()}>
      <canvas
        ref={canvasRef}
        className={`w-full h-full object-cover ${loaded ? '' : 'hidden'}`}
        style={{ display: loaded ? 'block' : 'none' }}
      />
      {!loaded && (
        <div className="w-full h-full flex items-center justify-center bg-white/5">
          <div className="w-[20px] h-[20px] border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={null}>
      <PaymentsPageInner />
    </Suspense>
  );
}

function PaymentsPageInner() {
  const router = useRouter();
  const { selectedBusinesses, isAdmin, globalDateRange, setGlobalDateRange } = useDashboard();
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const searchParams = useSearchParams();
  const highlightPaymentId = searchParams.get("paymentId");
  const dateRange = globalDateRange;
  const handleDateRangeChange = setGlobalDateRange;

  // Draft persistence for add payment form
  const paymentDraftKey = `paymentForm:draft:${selectedBusinesses[0] || "none"}`;
  const { saveDraft: savePaymentDraft, restoreDraft: restorePaymentDraft, clearDraft: clearPaymentDraft } = useFormDraft(paymentDraftKey);
  const paymentDraftRestored = useRef(false);

  const [showAddPaymentPopup, setShowAddPaymentPopup] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [originalPaymentSnapshot, setOriginalPaymentSnapshot] = useState<{ date: string; totalAmount: number; splits: Array<{ method: string; amount: number; dueDate: string | null; installmentNumber: number | null }> } | null>(null);
  const [updateConfirmation, setUpdateConfirmation] = useState<{ changes: Array<{ label: string; before: string; after: string }>; onConfirm: () => void } | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [filterBy, setFilterBy] = useState<string>("");
  const [filterValue, setFilterValue] = useState<string>("");
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [globalPaymentResults, setGlobalPaymentResults] = useState<RecentPaymentDisplay[] | null>(null);
  const [isGlobalPaymentSearching, setIsGlobalPaymentSearching] = useState(false);
  const [sortColumn, setSortColumn] = useState<"date" | "supplier" | "reference" | "installments" | "method" | "amount" | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>(null);
  const handleColumnSort = (col: "date" | "supplier" | "reference" | "installments" | "method" | "amount") => {
    if (sortColumn !== col) { setSortColumn(col); setSortOrder("asc"); }
    else if (sortOrder === "asc") { setSortOrder("desc"); }
    else { setSortColumn(null); setSortOrder(null); }
  };
  const filterMenuRef = useRef<HTMLDivElement | null>(null);

  // Global search: when filter is active, search DB without date/page restrictions
  useEffect(() => {
    setGlobalPaymentResults(null);
    if (!filterBy || !filterValue.trim() || !selectedBusinesses.length) return;

    const searchVal = filterValue.trim();

    const timer = setTimeout(async () => {
      setIsGlobalPaymentSearching(true);
      try {
        const supabase = createClient();
        let query = supabase
          .from("payments")
          .select(`
            *,
            supplier:suppliers(id, name),
            payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id),
            invoice:invoices(id, invoice_number, invoice_date, subtotal, vat_amount, total_amount, attachment_url, notes),
            payment_invoice_links(invoice:invoices(id, invoice_number, invoice_date, subtotal, vat_amount, total_amount, attachment_url, notes)),
            creator:profiles!payments_created_by_fkey(full_name)
          `)
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .order("payment_date", { ascending: false })
          .limit(50);

        // Apply DB-level filters where possible
        if (filterBy === "reference") {
          // Search by reference in payment_splits
          const { data: matchedSplits } = await supabase
            .from("payment_splits")
            .select("payment_id")
            .ilike("reference_number", `%${searchVal}%`);
          if (matchedSplits && matchedSplits.length > 0) {
            const paymentIds = [...new Set(matchedSplits.map(s => s.payment_id))];
            query = query.in("id", paymentIds);
          } else {
            setGlobalPaymentResults([]);
            setIsGlobalPaymentSearching(false);
            return;
          }
        } else if (filterBy === "supplier") {
          const { data: matchedSuppliers } = await supabase
            .from("suppliers")
            .select("id")
            .in("business_id", selectedBusinesses)
            .ilike("name", `%${searchVal}%`)
            .is("deleted_at", null);
          if (!matchedSuppliers || matchedSuppliers.length === 0) {
            setGlobalPaymentResults([]);
            setIsGlobalPaymentSearching(false);
            return;
          }
          query = query.in("supplier_id", matchedSuppliers.map(s => s.id));
        } else if (filterBy === "notes") {
          query = query.ilike("notes", `%${searchVal}%`);
        } else if (filterBy === "creditCard") {
          const { data: matchedCards } = await supabase
            .from("business_credit_cards")
            .select("id")
            .in("business_id", selectedBusinesses)
            .ilike("card_name", `%${searchVal}%`);
          if (!matchedCards || matchedCards.length === 0) {
            setGlobalPaymentResults([]);
            setIsGlobalPaymentSearching(false);
            return;
          }
          const cardIds = matchedCards.map(c => c.id);
          const { data: matchedSplits } = await supabase
            .from("payment_splits")
            .select("payment_id")
            .in("credit_card_id", cardIds);
          if (!matchedSplits || matchedSplits.length === 0) {
            setGlobalPaymentResults([]);
            setIsGlobalPaymentSearching(false);
            return;
          }
          const paymentIds = [...new Set(matchedSplits.map(s => s.payment_id))];
          query = query.in("id", paymentIds);
        }

        const { data } = await query;
        if (data && data.length > 0) {
          let results = transformPaymentsData(data);
          // Client-side filter for fields that can't be DB-filtered
          if (filterBy === "date") {
            results = results.filter(p => p.date.includes(searchVal));
          } else if (filterBy === "amount") {
            results = results.filter(p => p.totalAmount.toString().includes(searchVal) || p.totalAmount.toLocaleString().includes(searchVal));
          } else if (filterBy === "paymentNumber") {
            results = results.filter(p => p.checkNumber?.includes(searchVal) || p.rawSplits.some(s => s.check_number?.includes(searchVal)));
          }
          setGlobalPaymentResults(results);
        } else {
          setGlobalPaymentResults([]);
        }
      } catch {
        setGlobalPaymentResults([]);
      } finally {
        setIsGlobalPaymentSearching(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterBy, filterValue, selectedBusinesses]);

  // Close filter menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showFilterMenu && filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setShowFilterMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showFilterMenu]);

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
  const [businessVatRate, setBusinessVatRate] = useState(0.18);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [paymentMethodsData, setPaymentMethodsData] = useState<PaymentMethodSummary[]>([]);
  const [methodSupplierBreakdown, setMethodSupplierBreakdown] = useState<Record<string, MethodSupplierEntry[]>>({});
  const [selectedMethodPopup, setSelectedMethodPopup] = useState<PaymentMethodSummary | null>(null);
  const [recentPaymentsData, setRecentPaymentsData] = useState<RecentPaymentDisplay[]>([]);
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [showLinkedInvoices, setShowLinkedInvoices] = useState<string | null>(null);
  const [_isLoading, setIsLoading] = useState(true);
  const [hasMorePayments, setHasMorePayments] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [paymentsOffset, setPaymentsOffset] = useState(0);
  const paymentsListRef = useRef<HTMLDivElement>(null);
  const PAYMENTS_PAGE_SIZE = 20;
  const [isSaving, setIsSaving] = useState(false);

  // Auto-expand payment from URL param (e.g. /payments?paymentId=xxx)
  const highlightedRef = useRef(false);
  useEffect(() => {
    if (!highlightPaymentId || highlightedRef.current || recentPaymentsData.length === 0) return;
    const match = recentPaymentsData.find(p => p.paymentId === highlightPaymentId || p.id === highlightPaymentId);
    if (match) {
      highlightedRef.current = true;
      // rowKey format is "paymentId:splitIndex" — expand the first split row
      setExpandedPaymentId(`${match.id}:0`);
      // Scroll to the payment after render
      setTimeout(() => {
        const el = document.querySelector(`[data-payment-id="${match.id}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [highlightPaymentId, recentPaymentsData]);

  // Add payment form state
  const [paymentDate, setPaymentDate] = useState(() => toLocalDateStr(new Date()));
  const [expenseType, setExpenseType] = useState<"all" | "expenses" | "purchases" | "employees">("all");
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  // Receipt upload state — supports multiple files
  const [receiptFiles, setReceiptFiles] = useState<Array<{ file: File | null; preview: string }>>([]);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);

  // OCR state for receipt
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [ocrProcessingStep, setOcrProcessingStep] = useState("");
  const [ocrApplied, setOcrApplied] = useState(false);

  // OCR: extract data from receipt and populate form fields
  const processReceiptOcr = useCallback(async (file: File) => {
    setIsOcrProcessing(true);
    setOcrProcessingStep("מעלה את הקובץ...");
    try {
      let fileToSend = file;
      const isPdf = file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf");
      const isAvifOrHeic = /\.(avif|heic|heif)$/i.test(file.name?.toLowerCase() || "") ||
        ["image/avif", "image/heic", "image/heif"].includes(file.type);

      if (isPdf) {
        setOcrProcessingStep("ממיר PDF לתמונה...");
        try {
          fileToSend = await convertPdfToImage(file);
        } catch {
          // send as-is
        }
      } else if (isAvifOrHeic) {
        // Convert AVIF/HEIC to JPEG client-side (Google Vision doesn't support them)
        setOcrProcessingStep("ממיר תמונה...");
        try {
          const bitmap = await createImageBitmap(file);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bitmap, 0, 0);
            const blob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Canvas conversion failed")), "image/jpeg", 0.90);
            });
            fileToSend = new File([blob], file.name.replace(/\.(avif|heic|heif)$/i, ".jpg"), { type: "image/jpeg" });
            console.log(`[OCR] Converted ${file.type} → JPEG (${(blob.size / 1024).toFixed(0)}KB)`);
          }
          bitmap.close();
        } catch (convErr) {
          console.warn("[OCR] Client-side AVIF/HEIC conversion failed, sending as-is:", convErr);
        }
      }

      const fd = new FormData();
      fd.append("file", fileToSend);

      setOcrProcessingStep("סורק טקסט מהמסמך...");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const res = await fetch("/api/ai/ocr-extract", { method: "POST", body: fd, signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[OCR] Payment receipt error:", err.detail || err.error);
        throw new Error(err.error || "OCR failed");
      }

      setOcrProcessingStep("מחלץ נתונים...");
      const data = await res.json();

      // Check if OCR couldn't read the document — let user fill manually
      if (data.ocr_failed) {
        showToast("לא הצלחנו לזהות טקסט מהמסמך — ניתן למלא את הפרטים ידנית", "info");
      } else {
        if (data.document_date) setPaymentDate(data.document_date);
        if (data.document_number) setReference(data.document_number);
        if (data.matched_supplier_id) setSelectedSupplier(data.matched_supplier_id);
        showToast("נתונים זוהו מהקבלה בהצלחה", "success");
      }

      setOcrApplied(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        showToast("הזיהוי נכשל — חרג מזמן המתנה (60 שניות)", "info");
      } else {
        showToast("לא הצלחנו לזהות את המסמך — ניתן למלא את הפרטים ידנית", "info");
      }
      setOcrApplied(true);
    } finally {
      setIsOcrProcessing(false);
      setOcrProcessingStep("");
    }
  }, [showToast]);

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

  // Restore payment draft when popup opens (only for new payment, not edit)
  useEffect(() => {
    if (showAddPaymentPopup && !editingPaymentId) {
      paymentDraftRestored.current = false;
      const t = setTimeout(() => {
        const draft = restorePaymentDraft();
        if (draft) {
          if (draft.paymentDate) setPaymentDate(draft.paymentDate as string);
          if (draft.expenseType) setExpenseType(draft.expenseType as "all" | "expenses" | "purchases" | "employees");
          if (draft.selectedSupplier) setSelectedSupplier(draft.selectedSupplier as string);
          if (draft.reference) setReference(draft.reference as string);
          if (draft.notes !== undefined) setNotes(draft.notes as string);
        }
        paymentDraftRestored.current = true;
      }, 0);
      return () => clearTimeout(t);
    }
    if (editingPaymentId) {
      paymentDraftRestored.current = true;
    }
  }, [showAddPaymentPopup, editingPaymentId, restorePaymentDraft]);

  // Ensure at least 1 installment row exists when popup opens (for new payments)
  useEffect(() => {
    if (showAddPaymentPopup && !editingPaymentId) {
      setPaymentMethods(prev => prev.map(pm => {
        if (pm.customInstallments.length === 0) {
          return { ...pm, customInstallments: generateInstallments(parseInt(pm.installments) || 1, parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0, paymentDate || toLocalDateStr(new Date())) };
        }
        return pm;
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddPaymentPopup, editingPaymentId]);

  // Supplier filtering by expense type (ensure selected supplier is always included when editing)
  const expenseTypeMap = { expenses: "current_expenses", purchases: "goods_purchases", employees: "employee_costs" } as const;
  const filteredSuppliers = (() => {
    if (expenseType === "all") return suppliers;
    const filtered = suppliers.filter(s => s.expense_type === expenseTypeMap[expenseType]);
    if (selectedSupplier && !filtered.some(s => s.id === selectedSupplier)) {
      const missing = suppliers.find(s => s.id === selectedSupplier);
      if (missing) return [missing, ...filtered];
    }
    return filtered;
  })();

  // Open invoices state
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [showOpenInvoices, setShowOpenInvoices] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());
  const [expandedOpenInvoiceId, setExpandedOpenInvoiceId] = useState<string | null>(null);

  // Document viewer popup state (fullscreen preview)
  const [viewerDocUrl, setViewerDocUrl] = useState<string | null>(null);
  const [viewerDocIsPdf, setViewerDocIsPdf] = useState(false);

  // Forecast state
  const [showForecast, setShowForecast] = useState(false);
  const [forecastMonths, setForecastMonths] = useState<ForecastMonth[]>([]);
  const [forecastTotal, setForecastTotal] = useState(0);
  const [isLoadingForecast, setIsLoadingForecast] = useState(false);
  const [expandedForecastMonths, setExpandedForecastMonths] = useState<Set<string>>(new Set());
  const [expandedForecastDates, setExpandedForecastDates] = useState<Set<string>>(new Set());
  const [priorCommitments, setPriorCommitments] = useState<PriorCommitment[]>([]);
  const [showCommitments, setShowCommitments] = useState(false);

  // Past payments state (mirror of forecast but for past splits)
  const [showPastPayments, setShowPastPayments] = useState(false);
  const [pastMonths, setPastMonths] = useState<ForecastMonth[]>([]);
  const [pastTotal, setPastTotal] = useState(0);
  const [isLoadingPast, setIsLoadingPast] = useState(false);
  const [expandedPastMonths, setExpandedPastMonths] = useState<Set<string>>(new Set());
  const [expandedPastDates, setExpandedPastDates] = useState<Set<string>>(new Set());
  const [pastCommitments, setPastCommitments] = useState<PriorCommitment[]>([]);
  const [showPastCommitments, setShowPastCommitments] = useState(false);

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
    // Block selection of invoices in clarification status
    const inv = openInvoices.find(i => i.id === invoiceId);
    if (inv?.status === "clarification") return;

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
          const startDate = updated[0].customInstallments.length > 0 ? updated[0].customInstallments[0].dateForInput : paymentDate;
          updated[0] = { ...updated[0], amount: amountStr, customInstallments: generateInstallments(parseInt(updated[0].installments) || 1, selectedTotal, startDate) };
          return updated;
        });
      }

      return newSet;
    });
  };

  const toggleAllInvoices = (monthInvoices?: typeof openInvoices) => {
    const invoicesToToggle = (monthInvoices ?? openInvoices).filter(inv => inv.status !== "clarification");
    const allIds = invoicesToToggle.map(inv => inv.id);
    const allSelected = allIds.length > 0 && allIds.every(id => selectedInvoiceIds.has(id));

    const newSet = new Set(selectedInvoiceIds);
    if (allSelected) {
      allIds.forEach(id => newSet.delete(id));
    } else {
      allIds.forEach(id => newSet.add(id));
    }

    const selectedTotal = openInvoices
      .filter(inv => newSet.has(inv.id))
      .reduce((sum, inv) => sum + Number(inv.total_amount), 0);

    if (newSet.size > 0) {
      setPaymentMethods(prev => {
        const updated = [...prev];
        const amountStr = selectedTotal.toFixed(2).replace(/\.?0+$/, "") || "0";
        const startDate = updated[0].customInstallments.length > 0 ? updated[0].customInstallments[0].dateForInput : paymentDate;
        updated[0] = { ...updated[0], amount: amountStr, customInstallments: generateInstallments(parseInt(updated[0].installments) || 1, selectedTotal, startDate) };
        return updated;
      });
    }

    setSelectedInvoiceIds(newSet);
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
      if (selectedBusinesses.length === 0) {
        setPaymentMethodsData([]);
        setRecentPaymentsData([]);
        setSuppliers([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const supabase = createClient();

      try {
        // Fetch suppliers and business VAT for the selected businesses
        const [{ data: suppliersData }, { data: bizVatData }] = await Promise.all([
          supabase
            .from("suppliers")
            .select("id, name, expense_type, default_payment_method, default_credit_card_id")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .eq("is_active", true)
            .order("name"),
          supabase
            .from("businesses")
            .select("id, vat_percentage")
            .in("id", selectedBusinesses),
        ]);

        if (suppliersData) {
          setSuppliers(suppliersData);
        }
        if (bizVatData && bizVatData.length > 0) {
          const avgVat = bizVatData.reduce((sum, b) => sum + (Number(b.vat_percentage) || 0), 0) / bizVatData.length;
          if (avgVat > 0) setBusinessVatRate(avgVat);
        }

        // Fetch credit cards for the selected businesses
        const { data: creditCardsData } = await supabase
          .from("business_credit_cards")
          .select("id, card_name, billing_day")
          .in("business_id", selectedBusinesses)
          .eq("is_active", true)
          .order("card_name");

        if (creditCardsData) {
          setBusinessCreditCards(creditCardsData);
        }

        // Fetch payment splits for the date range — filtered by due_date (actual bank debit date)
        // instead of payment_date (when user recorded the payment) for accurate cash flow reporting
        const startDate = `${dateRange.start.getFullYear()}-${String(dateRange.start.getMonth() + 1).padStart(2, '0')}-${String(dateRange.start.getDate()).padStart(2, '0')}`;
        const endDate = `${dateRange.end.getFullYear()}-${String(dateRange.end.getMonth() + 1).padStart(2, '0')}-${String(dateRange.end.getDate()).padStart(2, '0')}`;

        const [{ data: splitsData }, { data: dailyEntriesData }] = await Promise.all([
          supabase
            .from("payment_splits")
            .select(`
              id, due_date, amount, payment_method,
              payment:payments!inner(id, business_id, deleted_at, total_amount,
                supplier:suppliers(id, name))
            `)
            .gte("due_date", startDate)
            .lte("due_date", endDate)
            .is("payment.deleted_at", null)
            .in("payment.business_id", selectedBusinesses)
            .order("due_date", { ascending: false })
            .limit(500),
          supabase
            .from("daily_entries")
            .select("total_register")
            .in("business_id", selectedBusinesses)
            .gte("entry_date", startDate)
            .lte("entry_date", endDate)
            .is("deleted_at", null),
        ]);

        // Calculate total revenue (including VAT) for percentage calculation
        const totalRevenueWithVat = (dailyEntriesData || []).reduce(
          (sum, e) => sum + (Number(e.total_register) || 0), 0
        );

        if (splitsData) {
          // Calculate payment method summary + supplier breakdown per method
          const methodTotals = new Map<string, number>();
          const methodSuppliers = new Map<string, Map<string, number>>();

          for (const split of splitsData) {
            const payment = split.payment as unknown as { id: string; supplier: { name: string } | null };
            const supplierName = payment?.supplier?.name || "לא ידוע";
            const method = split.payment_method || "other";
            const amount = Number(split.amount);

            methodTotals.set(method, (methodTotals.get(method) || 0) + amount);
            if (!methodSuppliers.has(method)) methodSuppliers.set(method, new Map());
            const supplierMap = methodSuppliers.get(method)!;
            supplierMap.set(supplierName, (supplierMap.get(supplierName) || 0) + amount);
          }

          // Calculate total for percentages
          const grandTotal = Array.from(methodTotals.values()).reduce((sum, val) => sum + val, 0);

          // Transform to display format
          const methodsSummary: PaymentMethodSummary[] = Array.from(methodTotals.entries())
            .map(([method, amount]) => ({
              id: method,
              name: paymentMethodNames[method] || "אחר",
              amount,
              percentage: totalRevenueWithVat > 0 ? (amount / totalRevenueWithVat) * 100 : 0,
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

          // Fetch first page of payments (no date filter) for the recent payments list
          const { data: allPaymentsData } = await supabase
            .from("payments")
            .select(`
              *,
              supplier:suppliers(id, name),
              payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id),
              invoice:invoices(id, invoice_number, invoice_date, subtotal, vat_amount, total_amount, attachment_url, notes),
            payment_invoice_links(invoice:invoices(id, invoice_number, invoice_date, subtotal, vat_amount, total_amount, attachment_url, notes)),
              creator:profiles!payments_created_by_fkey(full_name)
            `)
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .order("payment_date", { ascending: false })
            .range(0, PAYMENTS_PAGE_SIZE - 1);

          const recentDisplay = transformPaymentsData(allPaymentsData || [], suppliersData || []);
          setRecentPaymentsData(recentDisplay);
          setPaymentsOffset(recentDisplay.length);
          setHasMorePayments(recentDisplay.length >= PAYMENTS_PAGE_SIZE);
        }
      } catch (error) {
        console.error("Error fetching payments data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- transformPaymentsData is a plain function (not stateful); adding it would require memoization for no benefit.
  }, [selectedBusinesses, dateRange, refreshTrigger]);

  // Transform raw payment data to display format
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transformPaymentsData = (rawData: any[], suppliersList?: Supplier[]): RecentPaymentDisplay[] => {
    const suppliersToUse = suppliersList || suppliers;

    // Group sibling payments (same supplier + date + amount = covers multiple invoices)
    // Key: supplier_id|payment_date|total_amount
    const siblingGroups = new Map<string, { payments: typeof rawData; invoices: LinkedInvoice[] }>();
    for (const p of rawData) {
      const key = `${p.supplier_id}|${p.payment_date}|${p.total_amount}`;
      if (!siblingGroups.has(key)) {
        siblingGroups.set(key, { payments: [], invoices: [] });
      }
      const group = siblingGroups.get(key)!;
      group.payments.push(p);
      // Direct invoice_id link
      if (p.invoice) {
        const inv = p.invoice;
        if (!group.invoices.some(i => i.id === inv.id)) {
          group.invoices.push({
            id: inv.id,
            invoiceNumber: inv.invoice_number,
            date: formatDateString(inv.invoice_date),
            subtotal: Number(inv.subtotal),
            vatAmount: Number(inv.vat_amount),
            totalAmount: Number(inv.total_amount),
            attachmentUrl: inv.attachment_url,
            notes: inv.notes || null,
          });
        }
      }
      // N:M links via payment_invoice_links
      if (Array.isArray(p.payment_invoice_links)) {
        for (const link of p.payment_invoice_links) {
          const inv = link.invoice;
          if (!inv) continue;
          if (!group.invoices.some(i => i.id === inv.id)) {
            group.invoices.push({
              id: inv.id,
              invoiceNumber: inv.invoice_number,
              date: formatDateString(inv.invoice_date),
              subtotal: Number(inv.subtotal),
              vatAmount: Number(inv.vat_amount),
              totalAmount: Number(inv.total_amount),
              attachmentUrl: inv.attachment_url,
              notes: inv.notes || null,
            });
          }
        }
      }
    }

    const results: RecentPaymentDisplay[] = [];
    const processedGroups = new Set<string>();

    for (const p of rawData) {
      const key = `${p.supplier_id}|${p.payment_date}|${p.total_amount}`;
      const group = siblingGroups.get(key)!;
      const allLinkedInvoices = group.invoices;

      // If this is a sibling group with multiple payments, only process splits from the FIRST payment
      if (group.payments.length > 1) {
        if (processedGroups.has(key)) continue; // Skip duplicate payment records
        processedGroups.add(key);
      }

      const splits = p.payment_splits || [];
      const total = Number(p.total_amount);
      const inv = p.invoice;
      const subtotal = inv ? Number(inv.subtotal) : Math.round(total / (1 + businessVatRate) * 100) / 100;
      const vatAmount = inv ? Number(inv.vat_amount) : Math.round((total - subtotal) * 100) / 100;
      const expenseType = (() => {
        const s = suppliersToUse.find(s => s.id === p.supplier?.id);
        if (s?.expense_type === "goods_purchases") return "purchases";
        if (s?.expense_type === "employee_costs") return "employees";
        return "expenses";
      })();
      const linkedInvoice = allLinkedInvoices[0] || null;
      const allSplitsRaw = splits.map((s: { id: string; payment_method: string; amount: number; installments_count: number | null; installment_number: number | null; due_date: string | null; check_number: string | null; reference_number: string | null; credit_card_id?: string | null }) => ({
        id: s.id,
        payment_method: s.payment_method,
        amount: Number(s.amount),
        installments_count: s.installments_count,
        installment_number: s.installment_number,
        due_date: s.due_date,
        check_number: s.check_number,
        reference_number: s.reference_number,
        credit_card_id: s.credit_card_id || null,
      }));

      if (splits.length > 0) {
        for (const split of splits) {
          const installmentInfo = split.installments_count && split.installment_number
            ? `${split.installment_number}/${split.installments_count}`
            : "1/1";
          results.push({
            id: `${p.id}-${split.id}`,
            paymentId: p.id,
            date: formatDateString(split.due_date || p.payment_date),
            rawDate: split.due_date || p.payment_date,
            supplier: p.supplier?.name || "לא ידוע",
            supplierId: p.supplier?.id || "",
            expenseType,
            paymentMethod: paymentMethodNames[split.payment_method || "other"] || "אחר",
            paymentMethodKey: split.payment_method || "other",
            installments: installmentInfo,
            amount: Number(split.amount),
            totalAmount: total,
            subtotal,
            vatAmount,
            notes: p.notes || null,
            receiptUrl: p.receipt_url || null,
            reference: split.reference_number ? String(split.reference_number) : null,
            checkNumber: split.check_number || null,
            createdBy: p.creator?.full_name || null,
            createdAt: p.created_at ? formatDateString(p.created_at.split("T")[0]) : null,
            linkedInvoice,
            linkedInvoices: allLinkedInvoices,
            linkedInvoiceId: p.invoice_id || null,
            rawSplits: allSplitsRaw,
          });
        }
      } else {
        results.push({
          id: p.id,
          paymentId: p.id,
          date: formatDateString(p.payment_date),
          rawDate: p.payment_date,
          supplier: p.supplier?.name || "לא ידוע",
          supplierId: p.supplier?.id || "",
          expenseType,
          paymentMethod: "אחר",
          paymentMethodKey: "other",
          installments: "1/1",
          amount: total,
          totalAmount: total,
          subtotal,
          vatAmount,
          notes: p.notes || null,
          receiptUrl: p.receipt_url || null,
          reference: null,
          checkNumber: null,
          createdBy: p.creator?.full_name || null,
          createdAt: p.created_at ? formatDateString(p.created_at.split("T")[0]) : null,
          linkedInvoice,
          linkedInvoices: allLinkedInvoices,
          linkedInvoiceId: p.invoice_id || null,
          rawSplits: allSplitsRaw,
        });
      }
    }
    return results;
  };

  // Load more payments (infinite scroll)
  const loadMorePayments = useCallback(async () => {
    if (isLoadingMore || !hasMorePayments || selectedBusinesses.length === 0) return;
    setIsLoadingMore(true);
    const supabase = createClient();
    try {
      const { data } = await supabase
        .from("payments")
        .select(`
          *,
          supplier:suppliers(id, name),
          payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id),
          invoice:invoices(id, invoice_number, invoice_date, subtotal, vat_amount, total_amount, attachment_url, notes),
            payment_invoice_links(invoice:invoices(id, invoice_number, invoice_date, subtotal, vat_amount, total_amount, attachment_url, notes)),
          creator:profiles!payments_created_by_fkey(full_name)
        `)
        .in("business_id", selectedBusinesses)
        .is("deleted_at", null)
        .order("payment_date", { ascending: false })
        .range(paymentsOffset, paymentsOffset + PAYMENTS_PAGE_SIZE - 1);

      const newPayments = transformPaymentsData(data || []);
      setRecentPaymentsData(prev => [...prev, ...newPayments]);
      setPaymentsOffset(prev => prev + newPayments.length);
      setHasMorePayments(newPayments.length >= PAYMENTS_PAGE_SIZE);
    } catch (error) {
      console.error("Error loading more payments:", error);
    } finally {
      setIsLoadingMore(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- transformPaymentsData is a plain function (not stateful); adding it would require wrapping in useCallback for no benefit.
  }, [isLoadingMore, hasMorePayments, selectedBusinesses, paymentsOffset]);

  // Scroll handler for infinite scroll
  const handlePaymentsScroll = useCallback(() => {
    const el = paymentsListRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      loadMorePayments();
    }
  }, [loadMorePayments]);

  // Fetch forecast data (upcoming payment splits)
  const fetchForecast = useCallback(async () => {
    if (selectedBusinesses.length === 0) {
      setForecastMonths([]);
      setForecastTotal(0);
      setPriorCommitments([]);
      return;
    }

    setIsLoadingForecast(true);
    const supabase = createClient();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

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
        setPriorCommitments([]);
        setIsLoadingForecast(false);
        return;
      }

      // Group by month for forecast
      const monthMap = new Map<string, ForecastSplit[]>();
      let total = 0;

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

        // Parse date as local to avoid UTC timezone shift (e.g. "2026-05-09T21:00:00Z" → "2026-05-10")
        const [dY, dM] = row.due_date.split("T")[0].split("-");
        const key = `${dY}-${dM}`;
        if (!monthMap.has(key)) monthMap.set(key, []);
        monthMap.get(key)!.push(split);
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
    } catch (err) {
      console.error("Error fetching forecast:", err);
      showToast("שגיאה בטעינת צפי תשלומים", "error");
    } finally {
      setIsLoadingForecast(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinesses]);

  // Fetch prior commitments from DB
  const fetchPriorCommitments = useCallback(async () => {
    if (selectedBusinesses.length === 0) {
      setPriorCommitments([]);
      setPastCommitments([]);
      return;
    }
    const supabase = createClient();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const { data, error } = await supabase
      .from("prior_commitments")
      .select("id, name, monthly_amount, total_installments, start_date, end_date")
      .in("business_id", selectedBusinesses)
      .is("deleted_at", null);

    if (error || !data) {
      setPriorCommitments([]);
      setPastCommitments([]);
      return;
    }

    const future: PriorCommitment[] = [];
    const past: PriorCommitment[] = [];
    for (const row of data) {
      if (row.end_date > today) {
        future.push(row);
      } else {
        past.push(row);
      }
    }
    setPriorCommitments(future);
    setPastCommitments(past);
  }, [selectedBusinesses]);

  // Fetch prior commitments when businesses change
  useEffect(() => {
    fetchPriorCommitments();
  }, [fetchPriorCommitments, refreshTrigger]);

  // Fetch forecast when toggled on
  useEffect(() => {
    if (showForecast) {
      fetchForecast();
    }
  }, [showForecast, refreshTrigger, fetchForecast]);

  // Fetch past payments (splits with due_date < today)
  const fetchPastPayments = useCallback(async () => {
    if (selectedBusinesses.length === 0) {
      setPastMonths([]);
      setPastTotal(0);
      return;
    }

    setIsLoadingPast(true);
    const supabase = createClient();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    try {
      const { data, error } = await supabase
        .from("payment_splits")
        .select(`
          id, due_date, amount, payment_method, installment_number, installments_count,
          payment:payments!inner(id, business_id, deleted_at, receipt_url, notes, supplier:suppliers(name))
        `)
        .lte("due_date", today)
        .is("payment.deleted_at", null)
        .in("payment.business_id", selectedBusinesses)
        .order("due_date", { ascending: false })
        .limit(500);

      if (error) {
        showToast("שגיאה בטעינת תשלומי עבר", "error");
        setIsLoadingPast(false);
        return;
      }

      if (!data || data.length === 0) {
        setPastMonths([]);
        setPastTotal(0);
        setIsLoadingPast(false);
        return;
      }

      const monthMap = new Map<string, ForecastSplit[]>();
      let total = 0;

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

        // Parse date as local to avoid UTC timezone shift
        const [dY2, dM2] = row.due_date.split("T")[0].split("-");
        const key = `${dY2}-${dM2}`;
        if (!monthMap.has(key)) monthMap.set(key, []);
        monthMap.get(key)!.push(split);
      }

      // Sort months descending (newest first) for past payments
      const months: ForecastMonth[] = Array.from(monthMap.entries())
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([key, splits]) => {
          const [year, month] = key.split("-");
          return {
            key,
            label: `${hebrewMonthNames[parseInt(month) - 1]}, ${year}`,
            total: splits.reduce((sum, s) => sum + s.amount, 0),
            splits,
          };
        });

      setPastMonths(months);
      setPastTotal(total);
      if (months.length > 0) {
        setExpandedPastMonths(new Set([months[0].key]));
      }
    } catch (err) {
      console.error("Error fetching past payments:", err);
      showToast("שגיאה בטעינת תשלומי עבר", "error");
    } finally {
      setIsLoadingPast(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinesses]);

  // Fetch past payments when toggled on
  useEffect(() => {
    if (showPastPayments) {
      fetchPastPayments();
    }
  }, [showPastPayments, refreshTrigger, fetchPastPayments]);

  const togglePastMonth = useCallback((key: string) => {
    setExpandedPastMonths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) newSet.delete(key);
      else newSet.add(key);
      return newSet;
    });
  }, []);

  const togglePastDate = useCallback((key: string) => {
    setExpandedPastDates(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) newSet.delete(key);
      else newSet.add(key);
      return newSet;
    });
  }, []);

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

  // Prevent duplicate submission of save payment
  const savingPaymentRef = useRef(false);

  // Handle saving new payment
  const handleSavePayment = async () => {
    // Prevent duplicate submissions
    if (savingPaymentRef.current) return;
    savingPaymentRef.current = true;

    if (!selectedSupplier || !paymentDate || paymentMethods.every(pm => !pm.amount)) {
      showToast("נא למלא את כל השדות הנדרשים", "warning");
      savingPaymentRef.current = false;
      return;
    }

    if (paymentMethods.some(pm => parseFloat(pm.amount.replace(/[^\d.]/g, "")) > 0 && !pm.method)) {
      showToast("נא לבחור אמצעי תשלום", "warning");
      savingPaymentRef.current = false;
      return;
    }

    if (selectedBusinesses.length === 0) {
      showToast("נא לבחור עסק", "warning");
      savingPaymentRef.current = false;
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

    // Block partial payments - if invoices selected, total must match within ₪5
    if (selectedInvoiceIds.size > 0) {
      const paymentTotal = paymentMethods.reduce((sum, pm) => sum + (parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0), 0);
      const invoicesTotal = openInvoices
        .filter(inv => selectedInvoiceIds.has(inv.id))
        .reduce((sum, inv) => sum + Number(inv.total_amount), 0);
      const diff = Math.abs(invoicesTotal - paymentTotal);
      if (diff > 5) {
        showToast(`לא ניתן לבצע תשלום חלקי — הפרש של ₪${diff.toFixed(2)} בין סכום התשלום לסכום החשבוניות`, "error");
        savingPaymentRef.current = false;
        return;
      }
    }

    setIsSaving(true);
    const supabase = createClient();

    try {
      // Check if business is active
      const { data: bizCheck } = await supabase.from("businesses").select("status").eq("id", selectedBusinesses[0]).single();
      if (bizCheck?.status !== "active") {
        showToast("לא ניתן להוסיף תשלומים לעסק לא פעיל", "error");
        setIsSaving(false);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();

      // Calculate total amount
      const totalAmount = paymentMethods.reduce((sum, pm) => {
        return sum + (parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0);
      }, 0);

      // Upload receipts if selected
      let receiptUrl: string | null = null;
      const filesToUpload = receiptFiles.filter(r => r.file);
      const existingUrls = receiptFiles.filter(r => !r.file).map(r => r.preview);
      if (filesToUpload.length > 0) {
        setIsUploadingReceipt(true);
        const uploadedUrls: string[] = [...existingUrls];
        let uploadFailed = false;
        for (const entry of filesToUpload) {
          const fileExt = entry.file!.name.split('.').pop();
          const fileName = `receipt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${fileExt}`;
          const filePath = `payments/${fileName}`;
          const result = await uploadFile(entry.file!, filePath, "attachments");
          if (result.success && result.publicUrl) {
            uploadedUrls.push(result.publicUrl);
          } else {
            console.error("Receipt upload error:", result.error);
            uploadFailed = true;
          }
        }
        setIsUploadingReceipt(false);
        if (uploadFailed) {
          showToast("שגיאה בהעלאת הקובץ — האסמכתא לא נשמרה", "error");
          setIsSaving(false);
          return;
        }
        receiptUrl = uploadedUrls.length === 1 ? uploadedUrls[0] : uploadedUrls.length > 1 ? JSON.stringify(uploadedUrls) : null;
      } else if (existingUrls.length > 0) {
        receiptUrl = existingUrls.length === 1 ? existingUrls[0] : JSON.stringify(existingUrls);
      }

      // Create ONE payment that aggregates all selected invoices, then
      // link it to each invoice via payment_invoice_links with amount_allocated.
      const selectedInvoicesArr = Array.from(selectedInvoiceIds);

      const { data: newPayment, error: paymentError } = await supabase
        .from("payments")
        .insert({
          business_id: selectedBusinesses[0],
          supplier_id: selectedSupplier,
          payment_date: paymentDate,
          total_amount: totalAmount,
          // Direct FK only when a single invoice is paid; otherwise rely on links table.
          invoice_id: selectedInvoicesArr.length === 1 ? selectedInvoicesArr[0] : null,
          notes: notes || null,
          created_by: user?.id || null,
          receipt_url: receiptUrl,
        })
        .select()
        .single();

      if (paymentError) throw paymentError;
      if (!newPayment) throw new Error("Failed to create payment");

      // Create splits for the single payment
      for (const pm of paymentMethods) {
        const amount = parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0;
        if (amount <= 0) continue;
        const installmentsCount = parseInt(pm.installments) || 1;
        const creditCardId = pm.method === "credit_card" && pm.creditCardId ? pm.creditCardId : null;

        if (pm.customInstallments.length > 0) {
          for (const inst of pm.customInstallments) {
            await supabase.from("payment_splits").insert({
              payment_id: newPayment.id,
              payment_method: pm.method || "other",
              amount: inst.amount,
              installments_count: installmentsCount,
              installment_number: inst.number,
              reference_number: reference || null,
              check_number: (pm.method === "check" && inst.checkNumber) ? inst.checkNumber : (pm.checkNumber || null),
              credit_card_id: creditCardId,
              due_date: inst.dateForInput || paymentDate || null,
            });
          }
        } else {
          await supabase.from("payment_splits").insert({
            payment_id: newPayment.id,
            payment_method: pm.method || "other",
            amount: amount,
            installments_count: 1,
            installment_number: 1,
            reference_number: reference || null,
            check_number: pm.checkNumber || null,
            credit_card_id: creditCardId,
            due_date: paymentDate || null,
          });
        }
      }

      // Link the payment to each selected invoice via N:M table.
      // amount_allocated = invoice's total_amount (capped by remaining payment amount).
      if (selectedInvoicesArr.length > 1) {
        const selectedInvObjs = openInvoices.filter(inv => selectedInvoiceIds.has(inv.id));
        let remaining = totalAmount;
        for (const inv of selectedInvObjs) {
          const allocated = Math.min(Number(inv.total_amount), remaining);
          remaining -= allocated;
          await supabase.from("payment_invoice_links").insert({
            payment_id: newPayment.id,
            invoice_id: inv.id,
            amount_allocated: allocated,
          });
        }
      }

      // Update selected invoices - mark as paid
      // Tolerance of ₪5 to handle rounding differences (invoice amounts like 1542.0004 vs user-entered 1542)
      if (selectedInvoiceIds.size > 0) {
        const selectedInvoices = openInvoices
          .filter(inv => selectedInvoiceIds.has(inv.id));

        const invoicesTotal = selectedInvoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
        const diff = Math.abs(invoicesTotal - totalAmount);

        // If payment covers all selected invoices (within ₪5 tolerance), mark them all as paid
        if (diff <= 5) {
          const paidInvoiceIds = selectedInvoices.map(inv => inv.id);
          const { error: invoiceUpdateError } = await supabase
            .from("invoices")
            .update({ status: "paid" })
            .in("id", paidInvoiceIds);

          if (invoiceUpdateError) {
            console.error("Error updating invoice statuses:", invoiceUpdateError);
          }
        } else {
          // Fallback: mark invoices one by one from smallest to largest
          const sorted = [...selectedInvoices].sort((a, b) => Number(a.total_amount) - Number(b.total_amount));
          let remainingAmount = totalAmount;
          const paidInvoiceIds: string[] = [];

          for (const inv of sorted) {
            const invAmount = Number(inv.total_amount);
            if (invAmount <= remainingAmount + 1) {
              paidInvoiceIds.push(inv.id);
              remainingAmount -= invAmount;
            }
          }

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
      }

      // Refresh data
      clearPaymentDraft();
      handleClosePopup();
      // Delay refresh to ensure state updates from popup close are flushed (fixes mobile)
      setTimeout(() => setRefreshTrigger(t => t + 1), 100);
    } catch (error) {
      console.error("Error saving payment:", error);
      showToast("שגיאה בשמירת התשלום", "error");
    } finally {
      setIsSaving(false);
      savingPaymentRef.current = false;
    }
  };

  // Edit payment - pre-populate the form and open Sheet
  const handleEditPayment = (payment: RecentPaymentDisplay) => {
    // Determine correct expense type from current suppliers data (payment.expenseType may be stale)
    const supplierData = suppliers.find(s => s.id === payment.supplierId);
    const correctExpenseType: "expenses" | "purchases" | "employees" = supplierData?.expense_type === "goods_purchases" ? "purchases" : supplierData?.expense_type === "employee_costs" ? "employees" : "expenses";
    setExpenseType(correctExpenseType);
    // Store linked invoice IDs before setting supplier — the supplier-change useEffect should preserve them (#26)
    if (payment.linkedInvoiceId) {
      editLinkedInvoiceIds.current = new Set([payment.linkedInvoiceId]);
    }
    setSelectedSupplier(payment.supplierId);
    // Skip the paymentDate useEffect so it doesn't regenerate installments over the edit data
    skipPaymentDateEffect.current = true;
    setPaymentDate(payment.rawDate);
    setNotes(payment.notes || "");
    setReference(payment.reference || "");
    if (payment.receiptUrl) {
      let urls: string[];
      if (payment.receiptUrl.startsWith("[")) {
        try { urls = JSON.parse(payment.receiptUrl).filter((u: unknown) => typeof u === "string" && u); } catch { urls = [payment.receiptUrl]; }
      } else {
        urls = [payment.receiptUrl];
      }
      setReceiptFiles(urls.map(url => ({ file: null, preview: url })));
    } else {
      setReceiptFiles([]);
    }

    // Build payment methods from raw splits
    // Group splits by payment_method to reconstruct payment method entries
    const splitsByMethod = new Map<string, typeof payment.rawSplits>();
    for (const split of payment.rawSplits) {
      const key = `${split.payment_method}:${split.check_number || ""}`;
      if (!splitsByMethod.has(key)) splitsByMethod.set(key, []);
      splitsByMethod.get(key)!.push(split);
    }

    if (splitsByMethod.size > 0) {
      let entryId = 1;
      const entries: { id: number; method: string; amount: string; installments: string; checkNumber: string; creditCardId: string; customInstallments: Array<{ number: number; date: string; dateForInput: string; amount: number; checkNumber?: string; manuallyEdited?: boolean }> }[] = [];

      for (const [, splits] of splitsByMethod) {
        const totalForMethod = splits.reduce((sum, s) => sum + s.amount, 0);
        const installmentsCount = splits[0].installments_count || 1;

        const customInstallments = splits.map(s => {
              // Extract YYYY-MM-DD from ISO timestamp to avoid UTC timezone shift
              const dueDateStr = s.due_date ? s.due_date.split("T")[0] : "";
              const [y, m, d] = dueDateStr ? dueDateStr.split("-").map(Number) : [0, 0, 0];
              const localDate = dueDateStr ? new Date(y, m - 1, d) : null;
              return {
                number: s.installment_number || 1,
                date: localDate ? localDate.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "",
                dateForInput: dueDateStr,
                amount: s.amount,
                checkNumber: s.check_number || "",
                manuallyEdited: true,
              };
            });

        entries.push({
          id: entryId++,
          method: splits[0].payment_method,
          amount: totalForMethod.toString(),
          installments: installmentsCount.toString(),
          checkNumber: splits[0].check_number || "",
          creditCardId: (splits[0] as Record<string, unknown>).credit_card_id as string || "",
          customInstallments,
        });
      }
      setPaymentMethods(entries);
    } else {
      setPaymentMethods([{ id: 1, method: "", amount: payment.totalAmount.toString(), installments: "1", checkNumber: "", creditCardId: "", customInstallments: generateInstallments(1, payment.totalAmount, payment.rawDate) }]);
    }

    // Set linked invoices
    if (payment.linkedInvoiceId) {
      setSelectedInvoiceIds(new Set([payment.linkedInvoiceId]));
    } else {
      setSelectedInvoiceIds(new Set());
    }

    // Store original snapshot for change detection
    setOriginalPaymentSnapshot({
      date: payment.rawDate,
      totalAmount: payment.totalAmount,
      splits: payment.rawSplits.map(s => ({
        method: s.payment_method,
        amount: s.amount,
        dueDate: s.due_date,
        installmentNumber: s.installment_number,
      })),
    });

    setEditingPaymentId(payment.paymentId);
    setShowAddPaymentPopup(true);
  };

  // Handle deep-link from supplier card (?supplier=supplierId) — open form with pre-selected supplier (#17)
  useEffect(() => {
    if (typeof window === "undefined" || selectedBusinesses.length === 0 || suppliers.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const supplierId = params.get("supplier");
    if (!supplierId) return;

    // Clear the query param immediately
    window.history.replaceState({}, "", "/payments");

    // Find the supplier to determine expense type
    const supplier = suppliers.find(s => s.id === supplierId);
    if (!supplier) return;

    resetForm();
    setSelectedSupplier(supplierId);
    // Set expense type based on supplier type
    const typeMap: Record<string, "purchases" | "expenses" | "employees"> = {
      "סחורה": "purchases",
      "הוצאות": "expenses",
      "עובדים": "employees",
    };
    if (supplier.expense_type && typeMap[supplier.expense_type]) {
      setExpenseType(typeMap[supplier.expense_type]);
    }
    setShowAddPaymentPopup(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinesses, suppliers]);

  // Handle deep-link edit from supplier card (?edit=paymentId)
  useEffect(() => {
    if (typeof window === "undefined" || selectedBusinesses.length === 0 || suppliers.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    if (!editId) return;

    // Clear the query param immediately
    window.history.replaceState({}, "", "/payments");

    const fetchAndEdit = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("payments")
        .select(`
          *,
          supplier:suppliers(id, name),
          payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id),
          invoice:invoices(id, invoice_number, invoice_date, subtotal, vat_amount, total_amount, attachment_url, notes),
            payment_invoice_links(invoice:invoices(id, invoice_number, invoice_date, subtotal, vat_amount, total_amount, attachment_url, notes)),
          creator:profiles!payments_created_by_fkey(full_name)
        `)
        .eq("id", editId)
        .maybeSingle();

      if (data) {
        const payment = transformPaymentsData([data])[0];
        handleEditPayment(payment);
      }
    };
    fetchAndEdit();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinesses, suppliers]);

  // Detect changes between original and current payment for confirmation popup
  const detectPaymentChanges = () => {
    if (!originalPaymentSnapshot) return [];
    const changes: Array<{ label: string; before: string; after: string }> = [];
    const formatDate = (d: string) => d ? new Date(d).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
    const formatAmount = (n: number) => `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const getMethodLabel = (m: string) => paymentMethodOptions.find(o => o.value === m)?.label || m;

    // Check payment date change
    if (paymentDate !== originalPaymentSnapshot.date) {
      changes.push({ label: "תאריך תשלום", before: formatDate(originalPaymentSnapshot.date), after: formatDate(paymentDate) });
    }

    // Check total amount change
    const newTotal = paymentMethods.reduce((sum, pm) => sum + (parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0), 0);
    if (Math.abs(newTotal - originalPaymentSnapshot.totalAmount) > 0.01) {
      changes.push({ label: "סכום כולל", before: formatAmount(originalPaymentSnapshot.totalAmount), after: formatAmount(newTotal) });
    }

    // Check individual split changes (amounts and dates)
    const newSplits: Array<{ method: string; amount: number; dueDate: string | null; installmentNumber: number }> = [];
    for (const pm of paymentMethods) {
      if (pm.customInstallments.length > 0) {
        for (const inst of pm.customInstallments) {
          newSplits.push({ method: pm.method, amount: inst.amount, dueDate: inst.dateForInput || null, installmentNumber: inst.number });
        }
      } else {
        const amount = parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0;
        if (amount > 0) newSplits.push({ method: pm.method, amount, dueDate: paymentDate, installmentNumber: 1 });
      }
    }

    const oldSplits = originalPaymentSnapshot.splits;
    // Compare matching splits by index
    const maxLen = Math.max(oldSplits.length, newSplits.length);
    for (let i = 0; i < maxLen; i++) {
      const old = oldSplits[i];
      const cur = newSplits[i];
      const instLabel = maxLen > 1 ? ` (תשלום ${i + 1})` : "";

      if (old && cur) {
        if (Math.abs(old.amount - cur.amount) > 0.01) {
          changes.push({ label: `סכום${instLabel}`, before: formatAmount(old.amount), after: formatAmount(cur.amount) });
        }
        if ((old.dueDate || "") !== (cur.dueDate || "")) {
          changes.push({ label: `תאריך${instLabel}`, before: formatDate(old.dueDate || ""), after: formatDate(cur.dueDate || "") });
        }
      } else if (old && !cur) {
        changes.push({ label: `${getMethodLabel(old.method)}${instLabel}`, before: formatAmount(old.amount), after: "הוסר" });
      } else if (!old && cur) {
        changes.push({ label: `${getMethodLabel(cur.method)}${instLabel}`, before: "חדש", after: formatAmount(cur.amount) });
      }
    }

    return changes;
  };

  // Update payment - check for amount/date changes and show confirmation if needed
  const handleUpdatePayment = async () => {
    if (!editingPaymentId || !selectedSupplier || !paymentDate || paymentMethods.every(pm => !pm.amount)) {
      showToast("נא למלא את כל השדות הנדרשים", "warning");
      return;
    }

    if (paymentMethods.some(pm => parseFloat(pm.amount.replace(/[^\d.]/g, "")) > 0 && !pm.method)) {
      showToast("נא לבחור אמצעי תשלום", "warning");
      return;
    }

    // Validate installments sum
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

    // Detect changes in amount or date fields
    const changes = detectPaymentChanges();
    if (changes.length > 0) {
      setUpdateConfirmation({ changes, onConfirm: executeUpdatePayment });
      return;
    }

    // No significant changes - save directly
    await executeUpdatePayment();
  };

  // Execute the actual update (called after confirmation)
  const executeUpdatePayment = async () => {
    setIsSaving(true);
    setUpdateConfirmation(null);
    const supabase = createClient();

    try {
      const totalAmount = paymentMethods.reduce((sum, pm) => {
        return sum + (parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0);
      }, 0);

      // Upload new receipts if selected
      let receiptUrl: string | null = null;
      const filesToUpload = receiptFiles.filter(r => r.file);
      const existingUrls = receiptFiles.filter(r => !r.file).map(r => r.preview);
      if (filesToUpload.length > 0) {
        setIsUploadingReceipt(true);
        const uploadedUrls: string[] = [...existingUrls];
        let uploadFailed = false;
        for (const entry of filesToUpload) {
          const fileExt = entry.file!.name.split('.').pop();
          const fileName = `receipt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${fileExt}`;
          const filePath = `payments/${fileName}`;
          const result = await uploadFile(entry.file!, filePath, "attachments");
          if (result.success && result.publicUrl) {
            uploadedUrls.push(result.publicUrl);
          } else {
            console.error("Receipt upload error:", result.error);
            uploadFailed = true;
          }
        }
        setIsUploadingReceipt(false);
        if (uploadFailed) {
          showToast("שגיאה בהעלאת הקובץ — האסמכתא לא נשמרה", "error");
          setIsSaving(false);
          return;
        }
        receiptUrl = uploadedUrls.length === 1 ? uploadedUrls[0] : uploadedUrls.length > 1 ? JSON.stringify(uploadedUrls) : null;
      } else if (existingUrls.length > 0) {
        receiptUrl = existingUrls.length === 1 ? existingUrls[0] : JSON.stringify(existingUrls);
      }

      // Find the old payment to check if invoice link changed
      const oldPayment = recentPaymentsData.find(p => p.id === editingPaymentId);

      // Update the payment record
      const { error: paymentError } = await supabase
        .from("payments")
        .update({
          supplier_id: selectedSupplier,
          payment_date: paymentDate,
          total_amount: totalAmount,
          invoice_id: selectedInvoiceIds.size > 0 ? Array.from(selectedInvoiceIds)[0] : null,
          notes: notes || null,
          receipt_url: receiptUrl,
        })
        .eq("id", editingPaymentId);

      if (paymentError) throw paymentError;

      // Delete old splits and recreate
      await supabase
        .from("payment_splits")
        .delete()
        .eq("payment_id", editingPaymentId);

      // Create new splits
      for (const pm of paymentMethods) {
        const amount = parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0;
        if (amount > 0) {
          const installmentsCount = parseInt(pm.installments) || 1;
          const creditCardId = pm.method === "credit_card" && pm.creditCardId ? pm.creditCardId : null;
          const card = creditCardId ? businessCreditCards.find(c => c.id === creditCardId) : null;

          if (pm.customInstallments.length > 0) {
            for (const inst of pm.customInstallments) {
              await supabase
                .from("payment_splits")
                .insert({
                  payment_id: editingPaymentId,
                  payment_method: pm.method || "other",
                  amount: inst.amount,
                  installments_count: installmentsCount,
                  installment_number: inst.number,
                  reference_number: reference || null,
                  check_number: (pm.method === "check" && inst.checkNumber) ? inst.checkNumber : (pm.checkNumber || null),
                  credit_card_id: creditCardId,
                  due_date: inst.dateForInput || paymentDate || null,
                });
            }
          } else {
            // Edit path: same reasoning as the create path above — trust
            // the user-chosen payment date without re-applying the credit
            // card adjustment that's already been applied upstream.
            const dueDate = paymentDate || null;

            await supabase
              .from("payment_splits")
              .insert({
                payment_id: editingPaymentId,
                payment_method: pm.method || "other",
                amount: amount,
                installments_count: 1,
                installment_number: 1,
                reference_number: reference || null,
                check_number: pm.checkNumber || null,
                credit_card_id: creditCardId,
                due_date: dueDate,
              });
          }
        }
      }

      // If old invoice was linked and now different/removed, revert old invoice status
      if (oldPayment?.linkedInvoiceId && !selectedInvoiceIds.has(oldPayment.linkedInvoiceId)) {
        await supabase
          .from("invoices")
          .update({ status: "pending" })
          .eq("id", oldPayment.linkedInvoiceId);
      }

      // Mark newly selected invoices as paid (with ₪5 tolerance for rounding)
      if (selectedInvoiceIds.size > 0) {
        const selectedInvoices = openInvoices
          .filter(inv => selectedInvoiceIds.has(inv.id));

        const invoicesTotal = selectedInvoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
        const diff = Math.abs(invoicesTotal - totalAmount);

        if (diff <= 5) {
          const paidInvoiceIds = selectedInvoices.map(inv => inv.id);
          await supabase
            .from("invoices")
            .update({ status: "paid" })
            .in("id", paidInvoiceIds);
        } else {
          const sorted = [...selectedInvoices].sort((a, b) => Number(a.total_amount) - Number(b.total_amount));
          let remainingAmount = totalAmount;
          const paidInvoiceIds: string[] = [];
          for (const inv of sorted) {
            const invAmount = Number(inv.total_amount);
            if (invAmount <= remainingAmount + 1) {
              paidInvoiceIds.push(inv.id);
              remainingAmount -= invAmount;
            }
          }
          if (paidInvoiceIds.length > 0) {
            await supabase
              .from("invoices")
              .update({ status: "paid" })
              .in("id", paidInvoiceIds);
          }
        }
      }

      // Warn if payment amount changed and no longer matches linked invoices
      if (oldPayment && selectedInvoiceIds.size > 0) {
        const oldAmount = oldPayment.totalAmount;
        if (Math.abs(totalAmount - oldAmount) > 0.01) {
          const selectedInvoices = openInvoices.filter(inv => selectedInvoiceIds.has(inv.id));
          const invoicesTotal = selectedInvoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
          if (Math.abs(invoicesTotal - totalAmount) > 5) {
            showToast(`⚠️ סכום התשלום (₪${totalAmount.toLocaleString()}) לא תואם לסכום החשבוניות (₪${invoicesTotal.toLocaleString()}) — החשבוניות חזרו לסטטוס "ממתין"`, "warning");
          }
        }
      }

      showToast("התשלום עודכן בהצלחה", "success");
      handleClosePopup();
      setRefreshTrigger(t => t + 1);
    } catch (error) {
      console.error("Error updating payment:", error);
      showToast("שגיאה בעדכון התשלום", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Delete payment (soft delete)
  const handleDeletePayment = async (paymentId: string) => {
    const supabase = createClient();
    try {
      const payment = recentPaymentsData.find(p => p.id === paymentId);

      // Collect all invoice IDs linked to this payment (both direct FK and N:M links)
      const invoiceIdsToRevert = new Set<string>();
      if (payment?.linkedInvoiceId) invoiceIdsToRevert.add(payment.linkedInvoiceId);
      const { data: links } = await supabase
        .from("payment_invoice_links")
        .select("invoice_id")
        .eq("payment_id", paymentId);
      if (links) for (const l of links) if (l.invoice_id) invoiceIdsToRevert.add(l.invoice_id);

      // Hard delete - remove FK children first, then payment
      await supabase.from("payment_splits").delete().eq("payment_id", paymentId);
      await supabase.from("payment_invoice_links").delete().eq("payment_id", paymentId);
      const { error } = await supabase
        .from("payments")
        .delete()
        .eq("id", paymentId);

      if (error) throw error;

      // Revert all linked invoices to "pending" only if they have no other active payments
      for (const invId of invoiceIdsToRevert) {
        const [{ count: directCount }, { count: linkCount }] = await Promise.all([
          supabase.from("payments").select("id", { count: "exact", head: true }).eq("invoice_id", invId).is("deleted_at", null),
          supabase.from("payment_invoice_links").select("payment_id", { count: "exact", head: true }).eq("invoice_id", invId),
        ]);
        if ((directCount || 0) === 0 && (linkCount || 0) === 0) {
          await supabase.from("invoices").update({ status: "pending" }).eq("id", invId);
        }
      }

      showToast("התשלום נמחק בהצלחה", "success");
      setExpandedPaymentId(null);
      setRefreshTrigger(t => t + 1);
    } catch (error) {
      console.error("Error deleting payment:", error);
      showToast("שגיאה במחיקת התשלום", "error");
    }
  };

  // Payment methods with installments - supports multiple payment methods
  interface PaymentMethodEntry {
    id: number;
    method: string;
    amount: string;
    installments: string;
    checkNumber: string;
    creditCardId: string;
    customInstallments: Array<{
      number: number;
      date: string;
      dateForInput: string;
      amount: number;
      checkNumber?: string;
      manuallyEdited?: boolean;
    }>;
  }

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodEntry[]>([
    { id: 1, method: "", amount: "", installments: "1", checkNumber: "", creditCardId: "", customInstallments: [] }
  ]);

  // Business credit cards
  const [businessCreditCards, setBusinessCreditCards] = useState<{id: string, card_name: string, billing_day: number}[]>([]);

  // Calculate totals
  const totalPayments = paymentMethodsData.reduce((sum, item) => sum + item.amount, 0);

  // Active index for interactive pie chart hover
  const [activePaymentIndex, setActivePaymentIndex] = useState<number | undefined>(undefined);

  // Custom shape renderer for full pie chart (recharts v3 uses shape prop with isActive)
  const renderPaymentShape = (props: PieSectorDataItem & { isActive: boolean; index: number }) => {
    const { cx, cy, outerRadius, startAngle, endAngle, fill, isActive, payload, percent } = props as PieSectorDataItem & {
      isActive: boolean; payload: { name: string; amount: number }; percent: number;
    };

    // Calculate label position at ~60% of the radius (center of pie slice)
    const pct = ((percent as number) * 100);
    const showLabel = pct >= 5;
    const isFullCircle = Math.abs(endAngle - startAngle) >= 359;
    const midAngleDeg = (startAngle + endAngle) / 2;
    const midAngleRad = midAngleDeg * (Math.PI / 180);
    const labelRadius = (outerRadius as number) * 0.6;
    const labelX = isFullCircle ? (cx as number) : (cx as number) + labelRadius * Math.cos(midAngleRad);
    const labelY = isFullCircle ? (cy as number) : (cy as number) - labelRadius * Math.sin(midAngleRad);

    const innerHoleRadius = (outerRadius as number) * 0.55;
    const anyActive = activePaymentIndex !== undefined;

    if (!isActive) {
      return (
        <g>
          <Sector
            cx={cx}
            cy={cy}
            outerRadius={outerRadius}
            innerRadius={anyActive ? innerHoleRadius : 0}
            startAngle={startAngle}
            endAngle={endAngle}
            fill={fill}
          />
          {showLabel && !anyActive && (
            <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="central"
              fill="#fff" fontSize={12} fontWeight="bold" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
              {`${pct.toFixed(0)}%`}
            </text>
          )}
        </g>
      );
    }

    return (
      <g>
        <Sector cx={cx} cy={cy} outerRadius={(outerRadius as number) + 8} innerRadius={innerHoleRadius}
          startAngle={startAngle} endAngle={endAngle} fill={fill} />
        <Sector cx={cx} cy={cy} outerRadius={(outerRadius as number) + 14} innerRadius={(outerRadius as number) + 10}
          startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.3} />
        <text x={cx} y={cy as number - 18} textAnchor="middle" fill="#fff" fontSize={14} fontWeight="bold">
          {payload.name}
        </text>
        <text x={cx} y={cy as number + 6} textAnchor="middle" fill="#fff" fontSize={22} fontWeight="bold" direction="ltr">
          {`₪${payload.amount.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
        </text>
        <text x={cx} y={cy + 26} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize={13}>
          {`${(percent * 100).toFixed(1)}%`}
        </text>
      </g>
    );
  };

  // Generate initial installments breakdown
  const generateInstallments = (numInstallments: number, totalAmount: number, startDateStr: string) => {
    if (numInstallments < 1) {
      return [];
    }

    const installmentAmount = Math.round((totalAmount / numInstallments) * 100) / 100;
    const lastInstallmentAmount = Math.round((totalAmount - installmentAmount * (numInstallments - 1)) * 100) / 100;
    // Parse start date manually to avoid UTC timezone shift
    const parts = startDateStr ? startDateStr.split("-").map(Number) : null;
    const startYear = parts ? parts[0] : new Date().getFullYear();
    const startMonth = parts ? parts[1] - 1 : new Date().getMonth(); // 0-based
    const startDay = parts ? parts[2] : new Date().getDate();

    const result = [];
    for (let i = 0; i < numInstallments; i++) {
      // Always calculate from original start date to avoid cumulative month overflow
      const date = new Date(startYear, startMonth + i, startDay);

      // Format manually to avoid toISOString() UTC shift
      const dateForInput = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

      result.push({
        number: i + 1,
        date: date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
        dateForInput,
        amount: i === numInstallments - 1 ? lastInstallmentAmount : installmentAmount,
        checkNumber: "",
      });
    }

    return result;
  };

  // Calculate due date based on credit card billing day.
  // Payment date = the card's billing day itself (e.g. billing_day=10 → the 10th).
  const calculateCreditCardDueDate = (paymentDateStr: string, billingDay: number): string => {
    // Parse date parts manually to avoid UTC timezone shift
    // (new Date("YYYY-MM-DD") parses as UTC).
    const [year, month, day] = paymentDateStr.split("-").map(Number);

    let dueDate: Date;
    if (day <= billingDay) {
      dueDate = new Date(year, month - 1, billingDay);
    } else {
      dueDate = new Date(year, month, billingDay);
    }
    // Format manually to avoid toISOString() UTC shift
    return `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}-${String(dueDate.getDate()).padStart(2, "0")}`;
  };

  // Calculate smart default payment date based on method
  const getSmartPaymentDate = (method: string, invoiceDate: string, creditCardId?: string): string => {
    if (!method) return "";
    if (method === "credit_card") {
      if (creditCardId) {
        const card = businessCreditCards.find(c => c.id === creditCardId);
        if (card) {
          return calculateCreditCardDueDate(invoiceDate || toLocalDateStr(new Date()), card.billing_day);
        }
      }
      const today = new Date();
      const day = today.getDate();
      if (day < 10) {
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-10`;
      } else {
        const next = new Date(today.getFullYear(), today.getMonth() + 1, 10);
        return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-10`;
      }
    }
    return invoiceDate || toLocalDateStr(new Date());
  };

  // Generate installments with credit card billing day logic
  const generateCreditCardInstallments = (numInstallments: number, totalAmount: number, paymentDateStr: string, billingDay: number) => {
    if (numInstallments < 1) return [];

    const installmentAmount = Math.round((totalAmount / numInstallments) * 100) / 100;
    const lastInstallmentAmount = Math.round((totalAmount - installmentAmount * (numInstallments - 1)) * 100) / 100;
    // Use paymentDate directly if it's already the billing date, otherwise calculate
    const payDateDay = new Date(paymentDateStr).getDate();
    const firstDueDate = payDateDay === billingDay ? paymentDateStr : calculateCreditCardDueDate(paymentDateStr, billingDay);

    const result = [];
    // Parse firstDueDate manually to avoid UTC timezone shift
    const [fdYear, fdMonth, fdDay] = firstDueDate.split("-").map(Number);
    for (let i = 0; i < numInstallments; i++) {
      const date = new Date(fdYear, fdMonth - 1 + i, fdDay);

      result.push({
        number: i + 1,
        date: date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
        dateForInput: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
        amount: i === numInstallments - 1 ? lastInstallmentAmount : installmentAmount,
        checkNumber: "",
      });
    }
    return result;
  };

  // Get the effective start date for new installments:
  // Use the first payment method's first installment date if customized, otherwise fall back to paymentDate
  const getEffectiveStartDate = () => {
    if (paymentMethods.length > 0 && paymentMethods[0].customInstallments.length > 0) {
      return paymentMethods[0].customInstallments[0].dateForInput;
    }
    return paymentDate;
  };

  // Add new payment method entry - auto-fill remaining balance
  // If the last entry was a check with a check number, auto-increment it
  const addPaymentMethodEntry = () => {
    const newId = Math.max(...paymentMethods.map(p => p.id)) + 1;
    const startDate = getEffectiveStartDate();
    const lastEntry = paymentMethods[paymentMethods.length - 1];
    let newCheckNumber = "";
    let newMethod = "";
    if (lastEntry && lastEntry.method === "check") {
      newMethod = "check";
      const lastCheckNum = lastEntry.checkNumber ||
        (lastEntry.customInstallments.length > 0
          ? lastEntry.customInstallments[lastEntry.customInstallments.length - 1].checkNumber
          : "");
      if (lastCheckNum && /^\d+$/.test(lastCheckNum)) {
        newCheckNumber = String(parseInt(lastCheckNum) + 1);
      }
    }
    // Calculate remaining balance — use actual installments sum if they exist (user may have edited)
    const totalInvoice = Array.from(selectedInvoiceIds).reduce((sum, invId) => {
      const inv = openInvoices.find(i => i.id === invId);
      return sum + (inv ? Number(inv.total_amount) : 0);
    }, 0);
    const allocatedSoFar = paymentMethods.reduce((sum, p) => {
      if (p.customInstallments.length > 0) {
        return sum + p.customInstallments.reduce((s, inst) => s + (Number(inst.amount) || 0), 0);
      }
      return sum + (parseFloat(p.amount.replace(/[^\d.]/g, "")) || 0);
    }, 0);
    const remaining = Math.max(0, Math.round((totalInvoice - allocatedSoFar) * 100) / 100);
    setPaymentMethods(prev => [
      ...prev,
      { id: newId, method: newMethod, amount: remaining > 0 ? String(remaining) : "", installments: "1", checkNumber: newCheckNumber, creditCardId: "", customInstallments: generateInstallments(1, remaining, startDate) }
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
    // Do NOT auto-set paymentDate (תאריך קבלה) when selecting payment methods —
    // it's set by the user or defaults to today, and should not change based on payment method.
    const isFirstEntry = paymentMethods.length > 0 && paymentMethods[0].id === id;
    // For non-first entries: when credit card is selected, recalculate installments with correct billing date
    if (!isFirstEntry && field === "creditCardId" && value) {
      const selectedInvoice = openInvoices.find(inv => selectedInvoiceIds.has(inv.id));
      const invoiceDate = selectedInvoice ? toLocalDateStr(new Date(selectedInvoice.invoice_date)) : paymentDate;
      const card = businessCreditCards.find(c => c.id === value);
      if (card) {
        const smartDate = getSmartPaymentDate("credit_card", invoiceDate, value);
        const entry = paymentMethods.find(p => p.id === id);
        if (entry && smartDate) {
          const totalAmount = parseFloat(entry.amount.replace(/[^\d.]/g, "")) || 0;
          const numInstallments = parseInt(entry.installments) || 1;
          // Will be applied inside the setPaymentMethods below via the installments regeneration
          setTimeout(() => {
            setPaymentMethods(prev => prev.map(p => {
              if (p.id !== id) return p;
              return { ...p, customInstallments: generateCreditCardInstallments(numInstallments, totalAmount, smartDate, card.billing_day) };
            }));
          }, 0);
        }
      }
    }

    setPaymentMethods(prev => prev.map(p => {
      if (p.id !== id) return p;

      const updated = { ...p, [field]: value };

      // Clear creditCardId when switching away from credit_card method
      if (field === "method" && value !== "credit_card") {
        updated.creditCardId = "";
      }

      // Auto-generate 1 installment row when check is selected (to show check number field)
      if (field === "method" && value === "check") {
        const totalAmount = parseFloat(p.amount.replace(/[^\d.]/g, "")) || 0;
        const startDate = getEffectiveStartDate();
        const date = startDate ? new Date(startDate) : new Date();
        updated.customInstallments = [{
          number: 1,
          date: date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
          dateForInput: toLocalDateStr(date),
          amount: totalAmount,
          checkNumber: "",
        }];
      }

      // Regenerate installments when installments count changes
      if (field === "installments") {
        const numInstallments = parseInt(value) || 1;
        const totalAmount = parseFloat(p.amount.replace(/[^\d.]/g, "")) || 0;
        const startDate = p.customInstallments.length > 0 ? p.customInstallments[0].dateForInput : getEffectiveStartDate();
        const card = p.creditCardId ? businessCreditCards.find(c => c.id === p.creditCardId) : null;
        if (card && startDate) {
          updated.customInstallments = generateCreditCardInstallments(numInstallments, totalAmount, startDate, card.billing_day);
        } else {
          updated.customInstallments = generateInstallments(numInstallments, totalAmount, startDate);
        }
        // Preserve check numbers from previous installments and auto-fill new ones
        if (p.method === "check") {
          const oldInstallments = p.customInstallments;
          // For the first installment: use existing installment checkNumber or fall back to the single-check field (p.checkNumber)
          const firstCheckNum = oldInstallments[0]?.checkNumber || p.checkNumber || "";
          for (let i = 0; i < updated.customInstallments.length; i++) {
            if (i < oldInstallments.length && oldInstallments[i].checkNumber) {
              updated.customInstallments[i] = { ...updated.customInstallments[i], checkNumber: oldInstallments[i].checkNumber };
            } else if (i === 0 && firstCheckNum) {
              updated.customInstallments[i] = { ...updated.customInstallments[i], checkNumber: firstCheckNum };
            } else if (firstCheckNum && /^\d+$/.test(firstCheckNum)) {
              updated.customInstallments[i] = { ...updated.customInstallments[i], checkNumber: String(parseInt(firstCheckNum) + i) };
            }
          }
        }
      }

      // When amount changes, recalculate installment amounts but keep dates
      if (field === "amount") {
        const numInstallments = parseInt(p.installments) || 1;
        const totalAmount = parseFloat(value.replace(/[^\d.]/g, "")) || 0;
        if (p.customInstallments.length > 0 && totalAmount > 0) {
          const installmentAmount = Math.round((totalAmount / numInstallments) * 100) / 100;
          const lastInstallmentAmount = Math.round((totalAmount - installmentAmount * (numInstallments - 1)) * 100) / 100;
          updated.customInstallments = p.customInstallments.map((inst, idx) => ({
            ...inst,
            amount: idx === numInstallments - 1 ? lastInstallmentAmount : installmentAmount,
          }));
        } else if (totalAmount > 0) {
          const startDate = getEffectiveStartDate();
          const card = p.creditCardId ? businessCreditCards.find(c => c.id === p.creditCardId) : null;
          if (card && startDate) {
            updated.customInstallments = generateCreditCardInstallments(numInstallments, totalAmount, startDate, card.billing_day);
          } else {
            updated.customInstallments = generateInstallments(numInstallments, totalAmount, startDate);
          }
        } else if (p.customInstallments.length > 0) {
          updated.customInstallments = p.customInstallments.map(inst => ({ ...inst, amount: 0 }));
        } else {
          const startDate = getEffectiveStartDate();
          updated.customInstallments = generateInstallments(numInstallments, 0, startDate);
        }
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
        const cappedAmount = Math.min(Math.round(amount * 100) / 100, totalAmount);
        updatedInstallments[installmentIndex] = {
          ...updatedInstallments[installmentIndex],
          amount: cappedAmount,
          manuallyEdited: true,
        };
        // Calculate total of all manually edited installments (including current)
        const manualTotal = updatedInstallments.reduce((sum, inst, idx) => {
          if (inst.manuallyEdited || idx === installmentIndex) return sum + inst.amount;
          return sum;
        }, 0);
        // Distribute remainder only among non-edited installments
        const remaining = Math.max(0, Math.round((totalAmount - manualTotal) * 100) / 100);
        const autoIndices = updatedInstallments
          .map((inst, idx) => idx)
          .filter(idx => idx !== installmentIndex && !updatedInstallments[idx].manuallyEdited);
        if (autoIndices.length > 0) {
          const perOther = Math.floor((remaining / autoIndices.length) * 100) / 100;
          let distributed = 0;
          for (let i = 0; i < autoIndices.length; i++) {
            const idx = autoIndices[i];
            if (i === autoIndices.length - 1) {
              updatedInstallments[idx] = { ...updatedInstallments[idx], amount: Math.round((remaining - distributed) * 100) / 100 };
            } else {
              updatedInstallments[idx] = { ...updatedInstallments[idx], amount: perOther };
              distributed += perOther;
            }
          }
        }
      }
      return { ...p, customInstallments: updatedInstallments };
    }));
  };

  // Handle installment check number change for a specific payment method
  // Auto-increment subsequent installment check numbers if they are empty or were auto-filled
  const handleInstallmentCheckNumberChange = (paymentMethodId: number, installmentIndex: number, newCheckNumber: string) => {
    setPaymentMethods(prev => prev.map(p => {
      if (p.id !== paymentMethodId) return p;
      const updatedInstallments = [...p.customInstallments];
      if (updatedInstallments[installmentIndex]) {
        updatedInstallments[installmentIndex] = {
          ...updatedInstallments[installmentIndex],
          checkNumber: newCheckNumber,
        };
        // Auto-fill subsequent installments with incremented check numbers
        if (/^\d+$/.test(newCheckNumber)) {
          let nextNum = parseInt(newCheckNumber);
          for (let i = installmentIndex + 1; i < updatedInstallments.length; i++) {
            nextNum++;
            // Only auto-fill if the field is empty or contains a number (was auto-filled before)
            if (!updatedInstallments[i].checkNumber || /^\d+$/.test(updatedInstallments[i].checkNumber || "")) {
              updatedInstallments[i] = {
                ...updatedInstallments[i],
                checkNumber: String(nextNum),
              };
            }
          }
        }
      }
      return { ...p, customInstallments: updatedInstallments };
    }));
  };

  // Calculate total for a payment method's installments
  const getInstallmentsTotal = (customInstallments: PaymentMethodEntry["customInstallments"]) => {
    return customInstallments.reduce((sum, item) => sum + item.amount, 0);
  };

  // Update installments when payment date changes - only for payment methods that haven't been customized
  // Track whether we should skip the next paymentDate effect (e.g. when opening edit mode)
  const skipPaymentDateEffect = useRef(false);
  // When editing a payment, skip clearing selectedInvoiceIds in the supplier-change useEffect (#26)
  const editLinkedInvoiceIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (skipPaymentDateEffect.current) {
      skipPaymentDateEffect.current = false;
      return;
    }
    setPaymentMethods(prev => prev.map(p => {
      const numInstallments = parseInt(p.installments) || 1;
      const totalAmount = parseFloat(p.amount.replace(/[^\d.]/g, "")) || 0;
      if (numInstallments >= 1 && totalAmount > 0) {
        const card = p.creditCardId ? businessCreditCards.find(c => c.id === p.creditCardId) : null;
        if (card && paymentDate) {
          return { ...p, customInstallments: generateCreditCardInstallments(numInstallments, totalAmount, paymentDate, card.billing_day) };
        }
        return { ...p, customInstallments: generateInstallments(numInstallments, totalAmount, paymentDate) };
      }
      return { ...p, customInstallments: [] };
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentDate]);

  // Fetch open invoices when supplier changes
  useEffect(() => {
    // Check if we're in edit mode with linked invoices (#26)
    const linkedIds = editLinkedInvoiceIds.current;
    editLinkedInvoiceIds.current = null; // Consume the ref

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
          .select("id, invoice_number, invoice_date, total_amount, status, attachment_url, notes")
          .eq("supplier_id", selectedSupplier)
          .in("business_id", selectedBusinesses)
          .in("status", ["pending", "clarification"])
          .is("deleted_at", null)
          .order("invoice_date", { ascending: false });

        if (error) {
          console.error("Error fetching open invoices:", error);
          setOpenInvoices([]);
        } else {
          let allInvoices = data || [];

          // If editing, also fetch the currently linked invoice (may be "paid") and merge it (#26)
          if (linkedIds && linkedIds.size > 0) {
            const linkedIdsArr = Array.from(linkedIds);
            const alreadyInList = linkedIdsArr.every(id => allInvoices.some(inv => inv.id === id));
            if (!alreadyInList) {
              const { data: linkedData } = await supabase
                .from("invoices")
                .select("id, invoice_number, invoice_date, total_amount, status, attachment_url, notes")
                .in("id", linkedIdsArr)
                .is("deleted_at", null);
              if (linkedData && linkedData.length > 0) {
                // Merge linked invoices at the top
                const existingIds = new Set(allInvoices.map(inv => inv.id));
                const newLinked = linkedData.filter(inv => !existingIds.has(inv.id));
                allInvoices = [...newLinked, ...allInvoices];
              }
            }
          }

          setOpenInvoices(allInvoices);
          if (allInvoices.length > 0) {
            const firstKey = getMonthYearKey(allInvoices[0].invoice_date);
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

    // When editing, preserve selectedInvoiceIds and auto-show invoices section (#26)
    if (linkedIds && linkedIds.size > 0) {
      setSelectedInvoiceIds(linkedIds);
      setShowOpenInvoices(true);
    } else {
      setSelectedInvoiceIds(new Set());
      setShowOpenInvoices(false);
    }
  }, [selectedSupplier, selectedBusinesses]);

  const resetForm = () => {
    setPaymentDate(toLocalDateStr(new Date()));
    setExpenseType("purchases");
    setSelectedSupplier("");
    const todayStr = toLocalDateStr(new Date());
    setPaymentMethods([{ id: 1, method: "", amount: "", installments: "1", checkNumber: "", creditCardId: "", customInstallments: generateInstallments(1, 0, todayStr) }]);
    setReference("");
    setNotes("");
    setReceiptFiles([]);
    setOcrApplied(false);
    setOpenInvoices([]);
    setShowOpenInvoices(false);
    setSelectedInvoiceIds(new Set());
    setExpandedMonths(new Set());
    clearPaymentDraft();
  };

  const handleClosePopup = () => {
    setShowAddPaymentPopup(false);
    setEditingPaymentId(null);
    setOriginalPaymentSnapshot(null);
    setUpdateConfirmation(null);
    setIsAiPrefill(false);
    resetForm();
  };

  // AI prefill banner state
  const [isAiPrefill, setIsAiPrefill] = useState(false);

  // Auto-open payment form from supplier page link or AI agent redirect
  // Supports: /payments?supplierId=xxx&amount=123&paymentDate=2026-04-30
  // And AI:   /payments?mode=ai&supplier_id=xxx&amount=123&payment_method=cash&notes=...&payment_date=2026-04-30
  const prefillHandled = useRef(false);
  useEffect(() => {
    if (prefillHandled.current || suppliers.length === 0) return;

    const mode = searchParams.get("mode");
    const isAiMode = mode === "ai";

    // AI prefill params (snake_case)
    const aiSupplierId = searchParams.get("supplier_id");
    const aiAmount = searchParams.get("amount");
    const aiPaymentMethod = searchParams.get("payment_method");
    const aiNotes = searchParams.get("notes");
    const aiPaymentDate = searchParams.get("payment_date");
    const aiCheckNumber = searchParams.get("check_number");
    const aiInvoiceIds = searchParams.get("invoice_ids");

    // Legacy supplier page params (camelCase)
    const legacySupplierId = searchParams.get("supplierId");
    const legacyAmount = searchParams.get("amount");
    const legacyDate = searchParams.get("paymentDate");

    const supplierId = aiSupplierId || legacySupplierId;
    if (!supplierId && !isAiMode) return;

    // Only handle once
    prefillHandled.current = true;

    if (isAiMode) setIsAiPrefill(true);

    // Find supplier to determine its expense type
    if (supplierId) {
      const supplier = suppliers.find(s => s.id === supplierId);
      if (supplier) {
        setSelectedSupplier(supplierId);
        if (supplier.expense_type === "goods") setExpenseType("purchases");
        else if (supplier.expense_type === "current") setExpenseType("expenses");
        else if (supplier.expense_type === "employees") setExpenseType("employees");
      }
    }

    const dateVal = aiPaymentDate || legacyDate;
    if (dateVal) setPaymentDate(dateVal);

    const amountVal = aiAmount || legacyAmount;
    if (amountVal) {
      const methodVal = aiPaymentMethod || "";
      setPaymentMethods([{ id: 1, method: methodVal, amount: amountVal, installments: "1", checkNumber: aiCheckNumber || "", creditCardId: "", customInstallments: [] }]);
    }

    if (aiNotes) setNotes(aiNotes);

    // Auto-select invoices if AI provided invoice_ids
    if (aiInvoiceIds) {
      const ids = aiInvoiceIds.split(",").filter(Boolean);
      if (ids.length > 0) {
        setSelectedInvoiceIds(new Set(ids));
      }
    }

    setShowAddPaymentPopup(true);
    // Clean URL params without reload
    router.replace("/payments", { scroll: false });
  }, [suppliers, searchParams, router]);

  // Show message if no business selected
  if (selectedBusinesses.length === 0) {
    return (
      <div className="text-white p-[7px] pb-[10px]">
        <div className="bg-[#0F1535] rounded-[20px] p-[40px] text-center">
          <p className="text-[20px] text-white/70">יש לבחור עסק כדי לצפות בתשלומים</p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-white p-[7px] pb-[10px]">
      <ConfirmDialog />
      {/* Date Range and Add Button */}
      <div className="flex items-center justify-between mb-[10px]">
        <Button
          id="onboarding-payments-import"
          type="button"
          onClick={() => setShowAddPaymentPopup(true)}
          className="bg-[#29318A] text-white text-[16px] font-semibold px-[20px] py-[10px] rounded-[7px] transition-colors hover:bg-[#3D44A0]"
        >
          הוספת תשלום
        </Button>
        <div className="flex items-center gap-[8px]">
            <span className="text-[13px] text-white/50 font-medium hidden sm:inline">תקופה מוצגת:</span>
            <DateRangePicker dateRange={dateRange} onChange={handleDateRangeChange} />
          </div>
      </div>

      {/* Chart and Summary Section */}
      <div id="onboarding-payments-chart" className="bg-[#0F1535] rounded-[20px] p-[20px_0px_10px] mt-[10px]">
        {/* Header - Title and Total - hidden when no data */}
        {paymentMethodsData.length > 0 && (
          <div className="flex items-center justify-between">
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
            <div className="relative w-full h-[350px]">
              <ResponsiveContainer width="100%" height={350} minWidth={1} minHeight={1}>
                <PieChart>
                  <Pie
                    data={paymentMethodsData}
                    cx="50%"
                    cy="50%"
                    outerRadius={140}
                    dataKey="amount"
                    stroke="none"
                    animationBegin={0}
                    animationDuration={800}
                    animationEasing="ease-out"
                    shape={renderPaymentShape}
                    {...({ activeIndex: activePaymentIndex } as Record<string, unknown>)}
                    onMouseEnter={(_, index) => setActivePaymentIndex(index)}
                    onMouseLeave={() => setActivePaymentIndex(undefined)}
                  >
                    {paymentMethodsData.map((entry) => (
                      <Cell key={entry.id} fill={entry.color} style={{ cursor: "pointer", outline: "none" }} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
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
              <Button
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
                  ₪{method.amount % 1 === 0
                    ? method.amount.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                    : method.amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[16px] w-[65px] text-center ltr-num">{method.percentage.toFixed(2)}%</span>
              </Button>
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
                <Button
                  type="button"
                  onClick={() => setSelectedMethodPopup(null)}
                  className="opacity-50 hover:opacity-100 transition-opacity mb-[10px]"
                >
                  <X size={24} className="text-white" />
                </Button>
              </div>

              {/* Header - method name and total */}
              <div className="flex items-center justify-between mx-[10px] mb-[15px]">
                <span className="text-[25px] font-semibold text-white text-center">{selectedMethodPopup.name}</span>
                <div className="flex flex-col items-center">
                  <span className="text-[25px] font-semibold text-white text-center ltr-num">
                    ₪{selectedMethodPopup.amount.toLocaleString("he-IL", { minimumFractionDigits: selectedMethodPopup.amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}
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
                      ₪{entry.amount.toLocaleString("he-IL", { minimumFractionDigits: entry.amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}
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
            <Button
              type="button"
              onClick={() => setShowForecast(!showForecast)}
              className={`flex-1 text-white text-[14px] sm:text-[16px] font-semibold py-[6px] px-[5px] rounded-tl-[5px] rounded-tr-[5px] rounded-br-[20px] rounded-bl-[5px] min-h-[40px] sm:min-h-[50px] flex items-center justify-center gap-[5px] sm:gap-[8px] transition-colors ${showForecast ? "bg-[#3D44A0]" : "bg-[#29318A] hover:bg-[#3D44A0]"}`}
            >
              <svg width="14" height="14" viewBox="0 0 32 32" fill="none" className={`flex-shrink-0 transition-transform ${showForecast ? "-rotate-90" : ""}`}>
                <path d="M12 10L18 16L12 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>צפי תשלומים קדימה</span>
            </Button>
            <Button
              type="button"
              onClick={() => setShowPastPayments(!showPastPayments)}
              className={`flex-1 text-white text-[14px] sm:text-[16px] font-semibold py-[6px] px-[5px] rounded-tl-[5px] rounded-tr-[5px] rounded-br-[5px] rounded-bl-[20px] min-h-[40px] sm:min-h-[50px] flex items-center justify-center gap-[5px] sm:gap-[8px] transition-colors ${showPastPayments ? "bg-[#3D44A0]" : "bg-[#29318A] hover:bg-[#3D44A0]"}`}
            >
              <span>הצגת תשלומי עבר</span>
              <svg width="14" height="14" viewBox="0 0 32 32" fill="none" className={`flex-shrink-0 transition-transform ${showPastPayments ? "rotate-90" : ""}`}>
                <path d="M20 10L14 16L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Button>
          </div>
        )}
      </div>

      {/* Forecast Section - צפי תשלומים קדימה */}
      {showForecast && (
        <div className="bg-[#0F1535] rounded-[20px] mt-[10px] flex flex-col gap-[10px]">
          {isLoadingForecast && forecastMonths.length === 0 ? null : forecastMonths.length === 0 ? (
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
                      <Button
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
                      </Button>

                      {/* Expanded Content */}
                      {isExpanded && (
                        <div className="px-[5px] pb-[10px]">
                          {dateGroupsArr.map(([dateKey, splits]) => {
                            const dateExpanded = expandedForecastDates.has(`${month.key}__${dateKey}`);
                            return (
                            <div key={dateKey} className={`bg-white/5 border rounded-[7px] p-[3px_0px_3px_5px] mt-[10px] transition-colors ${dateExpanded ? "border-white" : "border-white/25"}`}>
                              {/* Date Group Header - clickable */}
                              <Button
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
                              </Button>

                              {/* Table - hidden until date header is clicked */}
                              {dateExpanded && (
                                <>
                                  {/* Table Header */}
                                  <div className="flex flex-row items-center rounded-t-[7px] border-b border-white/25 pb-[2px] mb-[5px] mt-[5px]">
                                    <span className="flex-1 text-[14px] font-medium text-white text-center">תאריך התשלום</span>
                                    <span className="flex-1 text-[14px] text-white text-center">ספק</span>
                                    <span className="flex-1 text-[14px] font-medium text-white text-center">סכום לתשלום</span>
                                    <span className="flex-1 text-[14px] font-medium text-white text-center">אמצעי תשלום</span>
                                  </div>

                                  {/* Payment Rows */}
                                  {splits.map((split) => (
                                    <div key={split.id} className="flex flex-row items-center rounded-[7px] min-h-[45px] py-[3px]">
                                      <span className="flex-1 text-[14px] text-white text-center">{formatForecastDateShort(split.due_date)}</span>
                                      <span className="flex-1 text-[14px] text-white text-center truncate">{split.supplier_name}</span>
                                      <span className="flex-1 text-[14px] text-white text-center">
                                        {`₪${split.amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                      </span>
                                      <span className="flex-1 text-[14px] text-white text-center">
                                        {paymentMethodNames[split.payment_method] || "אחר"}
                                      </span>
                                      {split.receipt_url && /^https?:\/\//.test(split.receipt_url) && (
                                        <Button type="button" onClick={() => setViewerDocUrl(split.receipt_url!)} className="flex-shrink-0 text-white opacity-70 hover:opacity-100 cursor-pointer">
                                          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
                                            <rect x="4" y="4" width="24" height="24" rx="4" stroke="currentColor" strokeWidth="2"/>
                                            <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.5"/>
                                            <path d="M4 22L11 17L16 21L22 16L28 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                          </svg>
                                        </Button>
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
              {priorCommitments.length > 0 && (
                <div className="bg-white/5 border border-white/25 rounded-[10px] p-[3px] mx-[5px]">
                  <Button
                    type="button"
                    onClick={() => setShowCommitments(!showCommitments)}
                    className="w-full cursor-pointer hover:bg-white/10 transition-colors rounded-[7px]"
                  >
                    <h3 className="text-[20px] font-bold text-white text-center py-[10px]">
                      התחייבויות קודמות
                    </h3>
                  </Button>

                  {showCommitments && (
                    <div className="flex flex-col gap-[1px]">
                      {priorCommitments.map((c) => {
                        const endDate = new Date(c.end_date);
                        const endDateStr = `${String(endDate.getDate()).padStart(2, "0")}/${String(endDate.getMonth() + 1).padStart(2, "0")}/${endDate.getFullYear()}`;
                        return (
                          <div
                            key={c.id}
                            className="flex items-center justify-between px-[10px] py-[8px] border-t border-white/10"
                          >
                            <span className="text-[16px] text-white flex-1">{`${c.name} (מסתיים ${endDateStr})`}</span>
                            <div className="flex flex-col items-end">
                              <span className="text-[16px] text-white">
                                {`₪${c.monthly_amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                              </span>
                              <span className="text-[12px] font-bold text-white">{`${c.total_installments} תשלומים`}</span>
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

      {/* Past Payments Section - תשלומי עבר */}
      {showPastPayments && (
        <div className="bg-[#0F1535] rounded-[20px] mt-[10px] flex flex-col gap-[10px]">
          {isLoadingPast && pastMonths.length === 0 ? null : pastMonths.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-[30px] gap-[8px]">
              <span className="text-[18px] text-white/50">אין תשלומי עבר</span>
              <span className="text-[14px] text-white/30">לא נמצאו תשלומים שבוצעו בעבר</span>
            </div>
          ) : (
            <>
              {/* Total Header */}
              <h2 className="text-[18px] font-bold text-white text-center px-[10px]">
                {`סה"כ תשלומים שבוצעו: ₪${pastTotal.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </h2>

              {/* Monthly Groups */}
              <div className="border border-white rounded-[7px] mx-[5px] overflow-hidden">
                {pastMonths.map((month, mi) => {
                  const isExpanded = expandedPastMonths.has(month.key);

                  const dateGroups = new Map<string, ForecastSplit[]>();
                  for (const split of month.splits) {
                    const key = split.due_date;
                    if (!dateGroups.has(key)) dateGroups.set(key, []);
                    dateGroups.get(key)!.push(split);
                  }
                  const dateGroupsArr = Array.from(dateGroups.entries()).sort((a, b) => b[0].localeCompare(a[0]));

                  return (
                    <div key={month.key} className={`${mi > 0 ? "border-t-[5px] border-transparent" : ""}`}>
                      <Button
                        type="button"
                        onClick={() => togglePastMonth(month.key)}
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
                          <span className="text-[12px] font-bold text-white">{`סה"כ שולם`}</span>
                        </div>
                      </Button>

                      {isExpanded && (
                        <div className="px-[5px] pb-[10px]">
                          {dateGroupsArr.map(([dateKey, splits]) => {
                            const dateExpanded = expandedPastDates.has(`${month.key}__${dateKey}`);
                            return (
                            <div key={dateKey} className={`bg-white/5 border rounded-[7px] p-[3px_0px_3px_5px] mt-[10px] transition-colors ${dateExpanded ? "border-white" : "border-white/25"}`}>
                              <Button
                                type="button"
                                onClick={() => togglePastDate(`${month.key}__${dateKey}`)}
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
                                  <span className="text-[12px] font-bold text-white">{`סה"כ שולם`}</span>
                                </div>
                              </Button>

                              {dateExpanded && (
                                <>
                                  <div className="flex flex-row items-center rounded-t-[7px] border-b border-white/25 pb-[2px] mb-[5px] mt-[5px]">
                                    <span className="flex-1 text-[14px] font-medium text-white text-center">תאריך התשלום</span>
                                    <span className="flex-1 text-[14px] text-white text-center">ספק</span>
                                    <span className="flex-1 text-[14px] font-medium text-white text-center">סכום ששולם</span>
                                    <span className="flex-1 text-[14px] font-medium text-white text-center">אמצעי תשלום</span>
                                  </div>

                                  {splits.map((split) => (
                                    <div key={split.id} className="flex flex-row items-center rounded-[7px] min-h-[45px] py-[3px]">
                                      <span className="flex-1 text-[14px] text-white text-center">{formatForecastDateShort(split.due_date)}</span>
                                      <span className="flex-1 text-[14px] text-white text-center truncate">{split.supplier_name}</span>
                                      <span className="flex-1 text-[14px] text-white text-center">
                                        {`₪${split.amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                      </span>
                                      <span className="flex-1 text-[14px] text-white text-center">
                                        {paymentMethodNames[split.payment_method] || "אחר"}
                                      </span>
                                      {split.receipt_url && /^https?:\/\//.test(split.receipt_url) && (
                                        <Button type="button" onClick={() => setViewerDocUrl(split.receipt_url!)} className="flex-shrink-0 text-white opacity-70 hover:opacity-100 cursor-pointer">
                                          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
                                            <rect x="4" y="4" width="24" height="24" rx="4" stroke="currentColor" strokeWidth="2"/>
                                            <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.5"/>
                                            <path d="M4 22L11 17L16 21L22 16L28 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                          </svg>
                                        </Button>
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

              {/* Past Commitments Section - התחייבויות שבוצעו */}
              {pastCommitments.length > 0 && (
                <div className="bg-white/5 border border-white/25 rounded-[10px] p-[3px] mx-[5px]">
                  <Button
                    type="button"
                    onClick={() => setShowPastCommitments(!showPastCommitments)}
                    className="w-full cursor-pointer hover:bg-white/10 transition-colors rounded-[7px]"
                  >
                    <h3 className="text-[20px] font-bold text-white text-center py-[10px]">
                      התחייבויות שבוצעו
                    </h3>
                  </Button>

                  {showPastCommitments && (
                    <div className="flex flex-col gap-[1px]">
                      {pastCommitments.map((c) => {
                        const endDate = new Date(c.end_date);
                        const endDateStr = `${String(endDate.getDate()).padStart(2, "0")}/${String(endDate.getMonth() + 1).padStart(2, "0")}/${endDate.getFullYear()}`;
                        return (
                          <div
                            key={c.id}
                            className="flex items-center justify-between px-[10px] py-[8px] border-t border-white/10"
                          >
                            <span className="text-[16px] text-white flex-1">{`${c.name} (הסתיים ${endDateStr})`}</span>
                            <div className="flex flex-col items-end">
                              <span className="text-[16px] text-white">
                                {`₪${c.monthly_amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                              </span>
                              <span className="text-[12px] font-bold text-white">{`${c.total_installments} תשלומים`}</span>
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
      <div id="onboarding-payments-list" className="bg-[#0F1535] rounded-[20px] p-[20px_0px] mt-[10px] flex flex-col gap-[23px]">
        {/* Header Row */}
        <div className="flex items-center justify-between px-[5px]">
          {/* Filter Dropdown */}
          <div className="relative" ref={filterMenuRef}>
            <Button
              type="button"
              title="סינון לפי"
              onClick={() => setShowFilterMenu(!showFilterMenu)}
              className={`${filterBy ? 'opacity-100' : 'opacity-50'} cursor-pointer`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className={filterBy ? 'text-[#bc76ff]' : 'text-white'}>
                <path d="M8.07136 12.6325C4.96261 10.3075 2.74511 7.75 1.53386 6.3125C1.15886 5.8675 1.03636 5.54125 0.962611 4.9675C0.710111 3.0025 0.583861 2.02 1.16011 1.385C1.73636 0.75 2.75511 0.75 4.79261 0.75H19.2076C21.2451 0.75 22.2639 0.75 22.8401 1.38375C23.4164 2.01875 23.2901 3.00125 23.0376 4.96625C22.9626 5.54 22.8401 5.86625 22.4664 6.31125C21.2539 7.75125 19.0326 10.3137 15.9164 12.6425C15.7723 12.7546 15.6531 12.8956 15.5666 13.0564C15.4801 13.2172 15.4281 13.3942 15.4139 13.5762C15.1051 16.99 14.8201 18.86 14.6426 19.805C14.3564 21.3325 12.1926 22.2513 11.0326 23.07C10.3426 23.5575 9.50511 22.9775 9.41636 22.2225C9.08445 19.3456 8.80357 16.4631 8.57386 13.5762C8.56102 13.3925 8.50964 13.2135 8.42307 13.0509C8.33649 12.8883 8.21666 12.7457 8.07136 12.6325Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Button>
            {showFilterMenu && (
              <div className="absolute top-[30px] right-0 bg-[#1A2150] border border-white/20 rounded-[10px] py-[5px] min-w-[160px] z-50 shadow-lg shadow-black/40">
                {[
                  { value: "", label: "ללא סינון" },
                  { value: "date", label: "תאריך התשלום" },
                  { value: "supplier", label: "ספק" },
                  { value: "paymentNumber", label: "מספר תשלום" },
                  { value: "reference", label: "מספר אסמכתא" },
                  { value: "installments", label: "כמות תשלומים" },
                  { value: "amount", label: "סכום התשלום" },
                  { value: "totalPaid", label: "סך התשלום שבוצע" },
                  { value: "creditCard", label: "כרטיס אשראי" },
                  { value: "notes", label: "הערות" },
                ].map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setFilterBy(option.value);
                      setShowFilterMenu(false);
                    }}
                    className={`w-full text-right px-[12px] py-[8px] text-[13px] transition-colors ${
                      filterBy === option.value
                        ? 'text-[#bc76ff] bg-white/10'
                        : 'text-white hover:bg-white/5'
                    }`}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Title */}
          <h2 className="text-[24px] font-bold text-center">תשלומים אחרונים ששולמו</h2>

          {/* Download CSV Button */}
          <Button
            type="button"
            className="flex flex-col items-center gap-[5px] cursor-pointer"
            onClick={() => {
              const searchVal = filterValue.trim().toLowerCase();
              const filtered = recentPaymentsData.filter((payment) => {
                if (!filterBy || !searchVal) return true;
                switch (filterBy) {
                  case "date": return payment.date.includes(searchVal);
                  case "supplier": return payment.supplier.toLowerCase().includes(searchVal);
                  case "paymentNumber": return payment.checkNumber?.includes(searchVal) || payment.rawSplits.some(s => s.check_number?.includes(searchVal));
                  case "reference": return (payment.reference || "").toLowerCase().includes(searchVal);
                  case "installments": return payment.installments.includes(searchVal);
                  case "amount": return payment.totalAmount.toLocaleString().includes(searchVal) || payment.totalAmount.toString().includes(searchVal) || payment.rawSplits.some(s => s.amount.toString().includes(searchVal));
                  case "totalPaid": return payment.totalAmount.toLocaleString().includes(searchVal) || payment.totalAmount.toString().includes(searchVal);
                  case "creditCard": {
                    const cardNames = payment.rawSplits
                      .filter(s => s.payment_method === "credit_card" && s.credit_card_id)
                      .map(s => (businessCreditCards.find(c => c.id === s.credit_card_id)?.card_name || "").toLowerCase());
                    return cardNames.some(n => n.includes(searchVal));
                  }
                  case "notes": return (payment.notes || "").toLowerCase().includes(searchVal);
                  default: return true;
                }
              });
              if (sortColumn && sortOrder) {
                filtered.sort((a, b) => {
                  let cmp = 0;
                  switch (sortColumn) {
                    case "date": {
                      const [dA, mA, yA] = a.date.split(".").map(Number);
                      const [dB, mB, yB] = b.date.split(".").map(Number);
                      cmp = ((yA + 2000) * 10000 + mA * 100 + dA) - ((yB + 2000) * 10000 + mB * 100 + dB);
                      break;
                    }
                    case "supplier": cmp = a.supplier.localeCompare(b.supplier, "he"); break;
                    case "reference": cmp = (a.reference || "").localeCompare(b.reference || "", "he"); break;
                    case "installments": cmp = a.installments.localeCompare(b.installments); break;
                    case "method": cmp = a.paymentMethod.localeCompare(b.paymentMethod, "he"); break;
                    case "amount": cmp = a.totalAmount - b.totalAmount; break;
                  }
                  return sortOrder === "asc" ? cmp : -cmp;
                });
              }
              const headers = ["תאריך", "ספק", "אמצעי תשלום", "מס׳ צ׳ק", "כמות תשלומים", "סכום", "אסמכתא", "הערות"];
              const rows: string[][] = [];
              for (const payment of filtered) {
                for (const split of payment.rawSplits) {
                  rows.push([
                    split.due_date ? (() => { const [y,m,d] = split.due_date.split("T")[0].split("-"); return `${d}/${m}/${y}`; })() : payment.date,
                    `"${payment.supplier.replace(/"/g, '""')}"`,
                    paymentMethodNames[split.payment_method] || split.payment_method,
                    split.check_number || "-",
                    split.installments_count ? `${split.installment_number || 1}/${split.installments_count}` : "1",
                    split.amount.toString(),
                    split.reference_number || payment.reference || "-",
                    `"${(payment.notes || "").replace(/"/g, '""')}"`,
                  ]);
                }
              }
              const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
              const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = `payments_${toLocalDateStr(new Date())}.csv`;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none" className="text-white">
              <path d="M16 4V22M16 22L10 16M16 22L22 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6 28H26" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="text-[12px] text-white text-center">הורדת תשלומים</span>
          </Button>
        </div>

        {/* Filter Input Bar */}
        {filterBy && (
          <div className="flex items-center gap-[10px] px-[10px]">
            <span className="text-[13px] text-white/60 whitespace-nowrap">
              {filterBy === "date" ? "תאריך:" : filterBy === "supplier" ? "ספק:" : filterBy === "paymentNumber" ? "מספר תשלום:" : filterBy === "reference" ? "אסמכתא:" : filterBy === "installments" ? "תשלומים:" : filterBy === "amount" ? "סכום:" : filterBy === "totalPaid" ? "סך תשלום:" : filterBy === "creditCard" ? "כרטיס אשראי:" : "הערות:"}
            </span>
            <Input
              type="text"
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
              placeholder={
                filterBy === "date" ? "לדוגמה: 01.02" :
                filterBy === "supplier" ? "הקלד שם ספק..." :
                filterBy === "amount" ? "הקלד סכום..." :
                filterBy === "reference" ? "הקלד אסמכתא..." :
                filterBy === "creditCard" ? "הקלד שם/מספר כרטיס..." :
                "הקלד טקסט..."
              }
              className="flex-1 bg-white/10 text-white text-[13px] rounded-[7px] px-[10px] py-[6px] outline-none placeholder:text-white/30"
            />
            <Button
              type="button"
              title="ניקוי סינון"
              onClick={() => { setFilterBy(""); setFilterValue(""); }}
              className="text-white/50 hover:text-white transition-colors cursor-pointer"
            >
              <X size={16} />
            </Button>
          </div>
        )}

        {/* Table */}
        <div className="w-full flex flex-col">
          {/* Header */}
          <div className="grid grid-cols-[0.6fr_1.4fr_0.8fr_0.6fr_0.7fr_0.9fr] bg-[#29318A] rounded-t-[7px] p-[10px_5px] pe-[13px] items-center">
            {([
              ["date", "תאריך"],
              ["supplier", "ספק"],
              ["reference", "אסמכתא"],
              ["installments", "תשלומים"],
              ["method", "אמצעי"],
              ["amount", "סכום"],
            ] as const).map(([col, label]) => (
              <Button key={col} type="button" onClick={() => handleColumnSort(col)}
                className="text-[13px] font-medium text-center cursor-pointer hover:text-white/80 transition-colors flex items-center justify-center gap-[3px]">
                {col === "reference" ? (<><span className="sm:hidden">אסמכ׳</span><span className="hidden sm:inline">אסמכתא</span></>) : label}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className={`flex-shrink-0 transition-opacity ${sortColumn === col ? 'opacity-100' : 'opacity-30'}`}>
                  <path d={sortColumn === col && sortOrder === "desc" ? "M12 5V19M12 19L5 12M12 19L19 12" : "M12 19V5M12 5L5 12M12 5L19 12"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Button>
            ))}
          </div>

          {/* Rows */}
          <div ref={paymentsListRef} onScroll={handlePaymentsScroll} className="max-h-[calc(100vh-280px)] overflow-y-auto flex flex-col gap-[5px]">
            {(() => {
              const searchVal = filterValue.trim().toLowerCase();
              const hasActiveFilter = filterBy && searchVal;
              // When filter is active, prefer global search results (all dates/pages)
              const basePayments = hasActiveFilter && globalPaymentResults && globalPaymentResults.length > 0
                ? globalPaymentResults
                : recentPaymentsData;
              const filteredPayments = basePayments.filter((payment) => {
                if (!filterBy || !searchVal) return true;
                switch (filterBy) {
                  case "date": return payment.date.includes(searchVal);
                  case "supplier": return payment.supplier.toLowerCase().includes(searchVal);
                  case "paymentNumber": return payment.checkNumber?.includes(searchVal) || payment.rawSplits.some(s => s.check_number?.includes(searchVal));
                  case "reference": return (payment.reference || "").toLowerCase().includes(searchVal);
                  case "installments": return payment.installments.includes(searchVal);
                  case "amount": return payment.totalAmount.toLocaleString().includes(searchVal) || payment.totalAmount.toString().includes(searchVal) || payment.rawSplits.some(s => s.amount.toString().includes(searchVal));
                  case "totalPaid": return payment.totalAmount.toLocaleString().includes(searchVal) || payment.totalAmount.toString().includes(searchVal);
                  case "creditCard": {
                    const cardNames = payment.rawSplits
                      .filter(s => s.payment_method === "credit_card" && s.credit_card_id)
                      .map(s => (businessCreditCards.find(c => c.id === s.credit_card_id)?.card_name || "").toLowerCase());
                    return cardNames.some(n => n.includes(searchVal));
                  }
                  case "notes": return (payment.notes || "").toLowerCase().includes(searchVal);
                  default: return true;
                }
              });
              const isShowingGlobal = hasActiveFilter && globalPaymentResults && globalPaymentResults.length > 0;
              let sortedPayments = filteredPayments;
              if (sortColumn && sortOrder) {
                sortedPayments = [...filteredPayments].sort((a, b) => {
                  let cmp = 0;
                  switch (sortColumn) {
                    case "date": {
                      const [dA, mA, yA] = a.date.split(".").map(Number);
                      const [dB, mB, yB] = b.date.split(".").map(Number);
                      cmp = ((yA + 2000) * 10000 + mA * 100 + dA) - ((yB + 2000) * 10000 + mB * 100 + dB);
                      break;
                    }
                    case "supplier": cmp = a.supplier.localeCompare(b.supplier, "he"); break;
                    case "reference": cmp = (a.reference || "").localeCompare(b.reference || "", "he"); break;
                    case "installments": cmp = a.installments.localeCompare(b.installments); break;
                    case "method": cmp = a.paymentMethod.localeCompare(b.paymentMethod, "he"); break;
                    case "amount": cmp = a.totalAmount - b.totalAmount; break;
                  }
                  return sortOrder === "asc" ? cmp : -cmp;
                });
              }
              if (sortedPayments.length === 0) return (
                <div className="flex items-center justify-center py-[40px]">
                  <span className="text-[16px] text-white/50">אין תשלומים להצגה</span>
                </div>
              );
              return sortedPayments.map((payment) => {
              const isExpanded = expandedPaymentId === payment.id;
              return (
              <div
                key={payment.id}
                data-payment-id={payment.id}
                className={`rounded-[7px] p-[7px_3px] border transition-colors ${isExpanded ? 'bg-white/5 border-white' : 'border-transparent'}`}
              >
                <div
                  onClick={() => setExpandedPaymentId(isExpanded ? null : payment.id)}
                  className="grid grid-cols-[0.6fr_1.4fr_0.8fr_0.6fr_0.7fr_0.9fr] w-full p-[5px_5px] hover:bg-[#29318A]/30 transition-colors rounded-[7px] items-center cursor-pointer"
                >
                  {/* Date */}
                  <div className="flex items-center justify-center gap-[2px]">
                    <svg width="12" height="12" viewBox="0 0 32 32" fill="none" className={`flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''} text-white/50`}>
                      <path d="M20 10L14 16L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="text-[12px] sm:text-[13px] font-medium ltr-num">{payment.date}</span>
                  </div>

                  {/* Supplier */}
                  <span className="text-[12px] sm:text-[13px] font-medium text-center leading-tight break-words px-[2px]">{payment.supplier}</span>

                  {/* Reference Number */}
                  <span className="text-[12px] sm:text-[13px] font-medium ltr-num text-center truncate px-[2px]" title={payment.reference || ""}>
                    {payment.reference || "-"}
                  </span>

                  {/* Installments */}
                  <span className="text-[12px] sm:text-[13px] font-medium ltr-num text-center">
                    {payment.installments}
                  </span>

                  {/* Payment Method */}
                  <span className="text-[12px] sm:text-[13px] font-medium text-center leading-tight truncate">{payment.paymentMethod}</span>

                  {/* Amount: split amount (large) + total (small) */}
                  <div className="flex flex-col items-center">
                    <span className="text-[12px] sm:text-[13px] font-medium ltr-num">
                      ₪{payment.amount % 1 === 0 ? payment.amount.toLocaleString("he-IL") : payment.amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    {payment.amount !== payment.totalAmount && (
                      <span className="text-[10px] text-white/40 ltr-num">
                        מתוך ₪{payment.totalAmount.toLocaleString("he-IL")}
                      </span>
                    )}
                  </div>
                </div>

              {/* Expanded Details */}
              {isExpanded && (
                  <div className="flex flex-col gap-[10px] mt-[5px]">
                    {/* Header: פרטים נוספים + action icons */}
                    <div className="flex items-center justify-between border-b border-white/20 pb-[8px] px-[7px]" dir="rtl">
                      <span className="text-[16px] font-medium">פרטים נוספים</span>
                      <div className="flex items-center gap-[5px]">
                        {/* Edit button - Admin only */}
                        {isAdmin && (
                          <Button
                            type="button"
                            onClick={() => handleEditPayment(payment)}
                            className="w-[20px] h-[20px] text-white opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                            title="עריכה"
                          >
                            <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </Button>
                        )}
                        {/* Delete button - Admin only */}
                        {isAdmin && (
                          <Button
                            type="button"
                            onClick={() => {
                              confirm("האם למחוק את התשלום?", () => {
                                handleDeletePayment(payment.paymentId);
                              });
                            }}
                            className="w-[20px] h-[20px] text-white opacity-70 hover:text-[#F64E60] transition-opacity cursor-pointer"
                            title="מחיקה"
                          >
                            <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              <line x1="10" y1="11" x2="10" y2="17"/>
                              <line x1="14" y1="11" x2="14" y2="17"/>
                            </svg>
                          </Button>
                        )}
                        {/* Receipt image — skip if same as linked invoice attachment (#24) */}
                        {payment.receiptUrl && !(payment.linkedInvoice?.attachmentUrl && payment.receiptUrl === payment.linkedInvoice.attachmentUrl) && (
                          <Button
                            type="button"
                            onClick={() => setViewerDocUrl(payment.receiptUrl!)}
                            className="w-[20px] h-[20px] text-white opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                            title="צפייה בקבלה"
                          >
                            <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                              <circle cx="8.5" cy="8.5" r="1.5"/>
                              <polyline points="21 15 16 10 5 21"/>
                            </svg>
                          </Button>
                        )}
                        {payment.receiptUrl && !(payment.linkedInvoice?.attachmentUrl && payment.receiptUrl === payment.linkedInvoice.attachmentUrl) && (
                          <Button
                            type="button"
                            className="w-[20px] h-[20px] text-white opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                            title="הורדה"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const url = payment.receiptUrl!;
                                const res = await fetch(url);
                                const blob = await res.blob();
                                const blobUrl = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = blobUrl;
                                const filename = url.split("/").pop() || "receipt";
                                a.download = filename;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(blobUrl);
                              } catch {
                                window.open(payment.receiptUrl!, "_blank");
                              }
                            }}
                          >
                            <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                              <polyline points="7 10 12 15 17 10"/>
                              <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Who performed + entry date */}
                    <div className="flex items-center justify-between px-[7px] flex-wrap gap-y-[8px]">
                      {payment.createdBy && (
                        <div className="flex flex-col items-center min-w-[60px]">
                          <span className="text-[13px] text-[#979797]">בוצע ע&quot;י</span>
                          <span className="text-[13px]">{payment.createdBy}</span>
                        </div>
                      )}
                      {payment.createdAt && (
                        <div className="flex flex-col items-center min-w-[60px]">
                          <span className="text-[13px] text-[#979797]">תאריך הזנה</span>
                          <span className="text-[13px] ltr-num">{payment.createdAt}</span>
                        </div>
                      )}
                    </div>

                    {/* Payment Methods Breakdown */}
                    {payment.rawSplits.length > 0 && (
                      <div className="flex flex-col gap-[5px] px-[7px]" dir="rtl">
                        <span className="text-[13px] text-[#979797] font-medium">אמצעי תשלום</span>
                        {(() => {
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
                                  <span className="text-[13px] font-medium">
                                    {paymentMethodNames[group.method] || "אחר"}
                                    {group.method === "credit_card" && (() => {
                                      const cardId = (group.splits[0] as Record<string, unknown>)?.credit_card_id as string | undefined;
                                      const card = cardId ? businessCreditCards.find(c => c.id === cardId) : null;
                                      return card ? ` ${card.card_name}` : "";
                                    })()}
                                  </span>
                                  {group.splits.length > 1 && (
                                    <span className="text-[11px] text-white/50">({group.splits.length} תשלומים)</span>
                                  )}
                                </div>
                                <span className="text-[13px] font-medium ltr-num">₪{group.splits.reduce((s, sp) => s + sp.amount, 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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

                    {/* Extra info: reference + notes */}
                    {(payment.reference || payment.notes) && (
                      <div className="flex flex-col gap-[5px] px-[7px]">
                        {payment.reference && (
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

                    {/* Linked Invoices */}
                    {payment.linkedInvoices && payment.linkedInvoices.length > 0 && (
                      <div className="flex flex-col gap-[8px] border border-white/30 rounded-[7px] p-[3px] mx-[3px]">
                        <Button
                          type="button"
                          onClick={() => setShowLinkedInvoices(showLinkedInvoices === payment.id ? null : payment.id)}
                          className="bg-[#29318A] text-white text-[15px] font-medium py-[5px] px-[14px] rounded-[7px] self-start cursor-pointer hover:bg-[#3D44A0] transition-colors"
                        >
                          הצגת חשבוניות מקושרות ({payment.linkedInvoices.length})
                        </Button>

                        {showLinkedInvoices === payment.id && (
                          <div className="flex flex-col gap-[2px]">
                            <span className="text-[13px] font-bold text-right px-[5px]">
                              סה&quot;כ סכום חשבוניות: ₪{payment.linkedInvoices.reduce((s, i) => s + i.totalAmount, 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            {/* Header */}
                            <div dir="rtl" className="flex items-center justify-between gap-[3px] border-b border-white/20 min-h-[40px] px-[3px]">
                              <span className="text-[13px] min-w-[50px] text-center">תאריך</span>
                              <span className="text-[13px] w-[65px] text-center">אסמכתא</span>
                              <span className="text-[13px] w-[65px] text-center">סכום לפני מע&quot;מ</span>
                              <span className="text-[13px] w-[65px] text-center">סכום אחרי מע&quot;מ</span>
                              <div className="flex items-center gap-[5px] min-w-[45px]">
                                <span className="text-[13px]">פעולות</span>
                              </div>
                            </div>
                            {/* Invoice rows */}
                            {payment.linkedInvoices.map((linkedInv) => {
                              const invoiceAttachmentUrls = parseAttachmentUrls(linkedInv.attachmentUrl);
                              return (
                                <div key={linkedInv.id}>
                                  <div dir="rtl" className="flex items-center justify-between gap-[3px] min-h-[45px] px-[3px] rounded-[7px] hover:bg-[#29318A]/30 transition-colors">
                                    <Button type="button" onClick={() => router.push(`/expenses?invoiceId=${linkedInv.id}`)} className="text-[13px] min-w-[50px] text-center ltr-num cursor-pointer hover:text-[#7C8FFF]">{linkedInv.date}</Button>
                                    <Button type="button" onClick={() => router.push(`/expenses?invoiceId=${linkedInv.id}`)} className="text-[13px] w-[65px] text-center ltr-num cursor-pointer hover:text-[#7C8FFF]">{linkedInv.invoiceNumber || "-"}</Button>
                                    <Button type="button" onClick={() => router.push(`/expenses?invoiceId=${linkedInv.id}`)} className="text-[13px] w-[65px] text-center ltr-num cursor-pointer hover:text-[#7C8FFF]">₪{linkedInv.subtotal.toLocaleString("he-IL")}</Button>
                                    <Button type="button" onClick={() => router.push(`/expenses?invoiceId=${linkedInv.id}`)} className="text-[13px] w-[65px] text-center ltr-num cursor-pointer hover:text-[#7C8FFF]">₪{linkedInv.totalAmount.toLocaleString("he-IL")}</Button>
                                    <div className="flex items-center gap-[5px] min-w-[45px]">
                                      {invoiceAttachmentUrls.length > 0 && (
                                        <>
                                          <Button
                                            type="button"
                                            title="צפייה בחשבונית"
                                            onClick={() => setViewerDocUrl(invoiceAttachmentUrls[0])}
                                            className="w-[20px] h-[20px] text-white opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                                          >
                                            <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2">
                                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                              <circle cx="8.5" cy="8.5" r="1.5"/>
                                              <polyline points="21 15 16 10 5 21"/>
                                            </svg>
                                          </Button>
                                          <Button
                                            type="button"
                                            title="הורדת חשבונית"
                                            className="w-[20px] h-[20px] text-white opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                                            onClick={async (e) => {
                                              e.stopPropagation();
                                              try {
                                                const url = invoiceAttachmentUrls[0];
                                                const res = await fetch(url);
                                                const blob = await res.blob();
                                                const blobUrl = URL.createObjectURL(blob);
                                                const a = document.createElement("a");
                                                a.href = blobUrl;
                                                const filename = url.split("/").pop() || "invoice";
                                                a.download = filename;
                                                document.body.appendChild(a);
                                                a.click();
                                                document.body.removeChild(a);
                                                URL.revokeObjectURL(blobUrl);
                                              } catch {
                                                window.open(invoiceAttachmentUrls[0], "_blank");
                                              }
                                            }}
                                          >
                                            <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                              <polyline points="7 10 12 15 17 10"/>
                                              <line x1="12" y1="15" x2="12" y2="3"/>
                                            </svg>
                                          </Button>
                                        </>
                                      )}
                                      {(invoiceAttachmentUrls.length > 1 || linkedInv.notes) && (
                                        <Button
                                          type="button"
                                          title="מסמכים והערות"
                                          onClick={() => setExpandedOpenInvoiceId(expandedOpenInvoiceId === linkedInv.id ? null : linkedInv.id)}
                                          className={`w-[20px] h-[20px] text-white opacity-70 hover:opacity-100 transition-all cursor-pointer ${expandedOpenInvoiceId === linkedInv.id ? "rotate-180" : ""}`}
                                        >
                                          <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M6 9l6 6 6-6"/>
                                          </svg>
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                  {/* Expanded: Attachment Thumbnails + Notes */}
                                  {expandedOpenInvoiceId === linkedInv.id && (
                                    <div className="flex flex-col gap-[8px] px-[5px] py-[8px] bg-white/5 rounded-[8px] mx-[3px] mb-[3px]">
                                      {invoiceAttachmentUrls.length > 0 && (
                                        <div className="flex flex-wrap gap-[6px]">
                                          {invoiceAttachmentUrls.map((url, idx) => (
                                            <Button
                                              key={`inv-attachment-${url}`}
                                              type="button"
                                              onClick={() => setViewerDocUrl(url)}
                                              className="border border-white/20 rounded-[6px] overflow-hidden w-[50px] h-[50px] hover:border-white/50 transition-colors cursor-pointer"
                                            >
                                              {isPdfUrl(url) ? (
                                                <div className="w-full h-full flex items-center justify-center bg-white/5">
                                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/50">
                                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                                    <polyline points="14 2 14 8 20 8"/>
                                                  </svg>
                                                </div>
                                              ) : (
                                                <Image src={url} alt={`חשבונית ${idx + 1}`} className="w-full h-full object-cover" width={70} height={70} unoptimized />
                                              )}
                                            </Button>
                                          ))}
                                        </div>
                                      )}
                                      {linkedInv.notes && (
                                        <div className="flex items-start gap-[5px]">
                                          <span className="text-[12px] text-[#979797] flex-shrink-0">הערות:</span>
                                          <span className="text-[12px] text-white/70 text-right">{linkedInv.notes}</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
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
            {isLoadingMore && (
              <div className="flex items-center justify-center py-[15px]">
                <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
              </div>
            )}
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
            <div className="flex justify-between items-center flex-row-reverse">
              <Button
                type="button"
                onClick={handleClosePopup}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </Button>
              <SheetTitle className="text-white text-xl font-bold">{editingPaymentId ? "עריכת תשלום" : "הוספת תשלום חדש"}</SheetTitle>
              <div className="w-[24px]" />
            </div>
          </SheetHeader>

            {/* AI prefill banner */}
            {isAiPrefill && (
              <div className="mx-4 mt-3 mb-1 p-2.5 bg-blue-500/10 border border-blue-500/30 rounded-lg text-center">
                <span className="text-[13px] text-blue-200 font-medium">מילוי אוטומטי מדדי — בדוק ואשר</span>
              </div>
            )}

            {/* Form */}
            <div className="flex flex-col gap-[5px] px-4 pb-[80px]">
              {/* Date Field */}
              <div className="flex flex-col gap-[5px]">
                <div className="flex items-start">
                  <span className="text-[16px] font-medium text-white">תאריך קבלה</span>
                </div>
                <DatePickerField
                  value={paymentDate}
                  onChange={(val) => setPaymentDate(val)}
                />
              </div>

              {/* Expense Type */}
              <div className="flex flex-col gap-[3px]">
                <div className="flex items-start">
                  <span className="text-[16px] font-medium text-white">סוג הוצאה</span>
                </div>
                <div dir="rtl" className="flex items-start gap-[20px]">
                  <Button
                    type="button"
                    onClick={() => { setExpenseType("all"); setSelectedSupplier(""); }}
                    className="flex flex-row-reverse items-center gap-[3px] cursor-pointer"
                  >
                    <span className={`text-[16px] font-semibold ${expenseType === "all" ? "text-white" : "text-[#979797]"}`}>
                      הכל
                    </span>
                    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={expenseType === "all" ? "text-white" : "text-[#979797]"}>
                      {expenseType === "all" ? (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
                      ) : (
                        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/>
                      )}
                    </svg>
                  </Button>
                  <Button
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
                  </Button>
                  <Button
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
                  </Button>
                  <Button
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
                  </Button>
                </div>
              </div>

              {/* Supplier */}
              <SupplierSearchSelect
                suppliers={filteredSuppliers}
                value={selectedSupplier}
                onChange={(id) => {
                  setSelectedSupplier(id);
                  const sup = suppliers.find(s => s.id === id);
                  if (sup?.default_payment_method && paymentMethods.length > 0 && !paymentMethods[0].method) {
                    const defaultMethod = sup.default_payment_method;
                    const defaultCardId = sup.default_credit_card_id || '';
                    const smartDate = getSmartPaymentDate(defaultMethod, paymentDate, defaultCardId || undefined);
                    if (smartDate) setPaymentDate(smartDate);
                    setPaymentMethods(prev => prev.map((pm, i) => i === 0 ? { ...pm, method: defaultMethod, creditCardId: defaultCardId } : pm));
                  }
                }}
              />

              {/* Open Invoices Section */}
              {openInvoices.length > 0 && (
                <div className="flex flex-col gap-[10px]">
                  <Button
                    type="button"
                    onClick={() => setShowOpenInvoices(!showOpenInvoices)}
                    className="bg-[#29318A] text-white text-[18px] font-bold py-[12px] px-[24px] rounded-[7px] transition-colors hover:bg-[#3D44A0] flex items-center justify-center gap-[8px]"
                  >
                    <span>{editingPaymentId ? "חשבוניות" : "חשבוניות פתוחות"} ({openInvoices.length})</span>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 32 32"
                      fill="none"
                      className={`transition-transform ${showOpenInvoices ? "rotate-180" : ""}`}
                    >
                      <path d="M10 14L16 20L22 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </Button>

                  {showOpenInvoices && (
                    <div dir="rtl" className="border border-[#4C526B] rounded-[10px] p-[10px] flex flex-col gap-[10px]">
                      {isLoadingInvoices ? (
                        <div className="text-center text-white/70 py-[20px]">טוען חשבוניות...</div>
                      ) : (
                        groupInvoicesByMonth(openInvoices).map(([monthKey, monthInvoices]) => (
                          <div key={monthKey} className="flex flex-col">
                            {/* Month Header */}
                            <Button
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
                            </Button>

                            {/* Month Invoices */}
                            {expandedMonths.has(monthKey) && (
                              <div className="flex flex-col">
                                {/* Column Headers */}
                                <div className="grid grid-cols-[24px_1fr_1fr_1fr_50px] gap-[3px] px-[3px] py-[3px] border-b border-white/20 items-center">
                                  <Button type="button" onClick={() => toggleAllInvoices(monthInvoices)} className="flex items-center justify-center">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                      {monthInvoices.length > 0 && monthInvoices.filter(inv => inv.status !== "clarification").every(inv => selectedInvoiceIds.has(inv.id)) && monthInvoices.some(inv => inv.status !== "clarification") ? (
                                        <>
                                          <rect x="3" y="3" width="18" height="18" rx="3" fill="#29318A" stroke="white" strokeWidth="1.5"/>
                                          <path d="M8 12L11 15L16 9" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                        </>
                                      ) : (
                                        <rect x="3" y="3" width="18" height="18" rx="3" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" fill="none"/>
                                      )}
                                    </svg>
                                  </Button>
                                  <span className="text-[14px] text-white/70 text-center">תאריך חשבונית</span>
                                  <span className="text-[14px] text-white/70 text-center">אסמכתא</span>
                                  <span className="text-[14px] text-white/70 text-center">סכום כולל מע&quot;מ</span>
                                  <span className="text-[14px] text-white/70 text-center">אפשרויות</span>
                                </div>

                                {/* Invoice Rows */}
                                {monthInvoices.map((inv) => {
                                  const attachmentUrls = parseAttachmentUrls(inv.attachment_url);
                                  const hasDetails = attachmentUrls.length > 0 || inv.notes;
                                  return (
                                  <div key={inv.id} className="flex flex-col">
                                    <div
                                      className={`grid grid-cols-[24px_1fr_1fr_1fr_50px] gap-[3px] px-[3px] py-[8px] rounded-[10px] transition-colors items-center ${
                                        inv.status === "clarification" ? "border border-[#FFA500]/50 bg-[#FFA500]/5 opacity-60 cursor-not-allowed" : "hover:bg-white/5 cursor-pointer"
                                      } ${selectedInvoiceIds.has(inv.id) ? "bg-[#29318A]/30" : ""}`}
                                      onClick={() => toggleInvoiceSelection(inv.id)}
                                    >
                                        {/* Checkbox */}
                                        <div className="flex items-center justify-center">
                                          {inv.status === "clarification" ? (
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                              <rect x="3" y="3" width="18" height="18" rx="3" stroke="rgba(255,165,0,0.5)" strokeWidth="1.5" fill="none"/>
                                              <line x1="7" y1="7" x2="17" y2="17" stroke="rgba(255,165,0,0.5)" strokeWidth="1.5"/>
                                              <line x1="17" y1="7" x2="7" y2="17" stroke="rgba(255,165,0,0.5)" strokeWidth="1.5"/>
                                            </svg>
                                          ) : (
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
                                          )}
                                        </div>
                                        <span className="text-[13px] text-white text-center ltr-num">
                                          {new Date(inv.invoice_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                                        </span>
                                        <span className="text-[13px] text-white text-center ltr-num">
                                          {inv.invoice_number || "-"}
                                        </span>
                                        <span className="text-[13px] text-white text-center ltr-num">
                                          ₪{Number(inv.total_amount).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          {inv.status === "paid" && <span className="text-[10px] text-green-400 mr-[3px]">(שולם)</span>}
                                          {inv.status === "clarification" && <span className="text-[10px] text-[#FFA500] mr-[3px]">(בבירור)</span>}
                                        </span>
                                      <div className="flex items-center justify-center gap-[5px]" onClick={(e) => e.stopPropagation()}>
                                        {attachmentUrls.length > 0 && (
                                          <Button
                                            type="button"
                                            title="צפייה בחשבונית"
                                            onClick={(e) => { e.stopPropagation(); setViewerDocUrl(attachmentUrls[0]); }}
                                            className="w-[20px] h-[20px] text-white opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                                          >
                                            <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2">
                                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                              <circle cx="8.5" cy="8.5" r="1.5"/>
                                              <polyline points="21 15 16 10 5 21"/>
                                            </svg>
                                          </Button>
                                        )}
                                        {attachmentUrls.length > 0 && (
                                          <Button
                                            type="button"
                                            title="הורדת חשבונית"
                                            className="w-[20px] h-[20px] text-white opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                                            onClick={async (e) => {
                                              e.stopPropagation();
                                              try {
                                                const url = attachmentUrls[0];
                                                const res = await fetch(url);
                                                const blob = await res.blob();
                                                const blobUrl = URL.createObjectURL(blob);
                                                const a = document.createElement("a");
                                                a.href = blobUrl;
                                                a.download = url.split("/").pop() || "invoice";
                                                document.body.appendChild(a);
                                                a.click();
                                                document.body.removeChild(a);
                                                URL.revokeObjectURL(blobUrl);
                                              } catch {
                                                window.open(attachmentUrls[0], "_blank");
                                              }
                                            }}
                                          >
                                            <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                              <polyline points="7 10 12 15 17 10"/>
                                              <line x1="12" y1="15" x2="12" y2="3"/>
                                            </svg>
                                          </Button>
                                        )}
                                        {inv.notes && (
                                          <Button
                                            type="button"
                                            title={inv.notes}
                                            onClick={(e) => { e.stopPropagation(); setExpandedOpenInvoiceId(expandedOpenInvoiceId === inv.id ? null : inv.id); }}
                                            className="w-[20px] h-[20px] text-yellow-400 opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                                          >
                                            <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                            </svg>
                                          </Button>
                                        )}
                                        {(attachmentUrls.length > 1 || (inv.notes && attachmentUrls.length > 0)) && (
                                          <Button
                                            type="button"
                                            title="מסמכים נוספים"
                                            onClick={(e) => { e.stopPropagation(); setExpandedOpenInvoiceId(expandedOpenInvoiceId === inv.id ? null : inv.id); }}
                                            className={`w-[20px] h-[20px] text-white opacity-70 hover:opacity-100 transition-all cursor-pointer ${expandedOpenInvoiceId === inv.id ? "rotate-180" : ""}`}
                                          >
                                            <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                              <path d="M6 9l6 6 6-6"/>
                                            </svg>
                                          </Button>
                                        )}
                                      </div>
                                    </div>

                                    {/* Expanded details: extra attachments + notes */}
                                    {expandedOpenInvoiceId === inv.id && (attachmentUrls.length > 1 || inv.notes) && (
                                      <div className="flex flex-col gap-[8px] px-[10px] py-[8px] bg-white/5 rounded-[8px] mx-[5px] mb-[5px]">
                                        {attachmentUrls.length > 1 && (
                                          <div className="flex flex-wrap gap-[8px]">
                                            {attachmentUrls.map((url: string, idx: number) => (
                                              <Button
                                                key={`attachment-${url}`}
                                                type="button"
                                                onClick={() => setViewerDocUrl(url)}
                                                className="border border-white/20 rounded-[8px] overflow-hidden w-[70px] h-[70px] hover:border-white/50 transition-colors cursor-pointer"
                                              >
                                                {isPdfUrl(url) ? (
                                                  <PdfThumbnail url={url} className="w-full h-full" />
                                                ) : (
                                                  <Image src={url} alt={`מסמך ${idx + 1}`} className="w-full h-full object-cover" width={70} height={70} unoptimized />
                                                )}
                                              </Button>
                                            ))}
                                          </div>
                                        )}
                                        {inv.notes && (
                                          <div className="flex items-start gap-[5px]">
                                            <span className="text-[13px] text-[#979797] flex-shrink-0">הערות:</span>
                                            <span className="text-[13px] text-white text-right">{inv.notes}</span>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  );
                                })}
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
                <div className="flex items-center">
                  <span className="text-[16px] font-medium text-white">אמצעי תשלום</span>
                </div>

                {paymentMethods.map((pm, pmIndex) => (
                  <Fragment key={pm.id}>
                  <div className="border border-[#4C526B] rounded-[10px] p-[10px] flex flex-col gap-[10px]">
                    {/* Header with remove button */}
                    {paymentMethods.length > 1 && (
                      <div className="flex items-center justify-between mb-[5px]">
                        <span className="text-[14px] text-white/70">אמצעי תשלום {pmIndex + 1}</span>
                        <Button
                          type="button"
                          onClick={() => removePaymentMethodEntry(pm.id)}
                          className="text-[14px] text-red-400 hover:text-red-300 transition-colors"
                        >
                          הסר
                        </Button>
                      </div>
                    )}

                    {/* Payment Method Select */}
                    <Select value={pm.method || "__none__"} onValueChange={(val) => updatePaymentMethodField(pm.id, "method", val === "__none__" ? "" : val)}>
                      <SelectTrigger className="w-full bg-transparent border border-[#4C526B] rounded-[10px] !h-[50px] px-[12px] text-[18px] text-white text-center">
                        <SelectValue placeholder="...בחר אמצעי תשלום" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" disabled>...בחר אמצעי תשלום</SelectItem>
                        {paymentMethodOptions.map((method) => (
                          <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Credit Card Selection - only show when method is credit_card */}
                    {pm.method === "credit_card" && businessCreditCards.length > 0 && (
                      <Select value={pm.creditCardId || "__none__"} onValueChange={(cardId) => {
                        const val = cardId === "__none__" ? "" : cardId;
                        setPaymentMethods(prev => prev.map(p => {
                          if (p.id !== pm.id) return p;
                          const updated = { ...p, creditCardId: val };
                          const card = businessCreditCards.find(c => c.id === val);
                          if (card && paymentDate) {
                            const numInstallments = parseInt(p.installments) || 1;
                            const totalAmount = parseFloat(p.amount.replace(/[^\d.]/g, "")) || 0;
                            if (numInstallments >= 1 && totalAmount > 0) {
                              updated.customInstallments = generateCreditCardInstallments(numInstallments, totalAmount, paymentDate, card.billing_day);
                            }
                          }
                          return updated;
                        }));
                      }}>
                        <SelectTrigger className="w-full bg-transparent border border-[#4C526B] rounded-[10px] !h-[50px] px-[12px] text-[18px] text-white text-center">
                          <SelectValue placeholder="בחר כרטיס..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">בחר כרטיס...</SelectItem>
                          {businessCreditCards.map(card => (
                            <SelectItem key={card.id} value={card.id}>
                              {card.card_name} (יורד ב-{card.billing_day} לחודש)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {/* Payment Amount */}
                    <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={(() => {
                          const raw = pm.amount.replace(/,/g, "");
                          const num = parseFloat(raw);
                          if (!raw || isNaN(num)) return pm.amount;
                          const [intPart, decPart] = raw.split(".");
                          const formatted = Number(intPart).toLocaleString("he-IL");
                          return decPart !== undefined ? `${formatted}.${decPart}` : formatted;
                        })()}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          // Allow only numbers and a single decimal point
                          const val = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
                          updatePaymentMethodField(pm.id, "amount", val);
                        }}
                        placeholder="סכום"
                        className="w-full h-[50px] bg-transparent text-[18px] text-white text-center focus:outline-none px-[10px] rounded-[10px] ltr-num"
                      />
                    </div>

                    {/* Installments */}
                    <div className="flex flex-col gap-[3px]">
                      <span className="text-[14px] text-white/70">כמות תשלומים</span>
                      <div className="border border-[#4C526B] rounded-[10px] min-h-[50px] flex items-center">
                        <Button
                          type="button"
                          title="הפחת תשלום"
                          onClick={() => updatePaymentMethodField(pm.id, "installments", String(Math.max(1, parseInt(pm.installments) - 1)))}
                          className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
                        >
                          -
                        </Button>
                        <Input
                          type="text"
                          inputMode="numeric"
                          title="כמות תשלומים"
                          value={pm.installments}
                          onChange={(e) => updatePaymentMethodField(pm.id, "installments", e.target.value.replace(/\D/g, "") || "1")}
                          className="flex-1 h-[50px] bg-transparent text-[18px] text-white text-center focus:outline-none"
                        />
                        <Button
                          type="button"
                          title="הוסף תשלום"
                          onClick={() => updatePaymentMethodField(pm.id, "installments", String(parseInt(pm.installments) + 1))}
                          className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
                        >
                          +
                        </Button>
                      </div>

                      {/* Installments Breakdown */}
                      {pm.customInstallments.length > 0 && (
                        <div className="mt-[10px] border border-[#4C526B] rounded-[10px] p-[10px]">
                          <div className="flex items-center gap-[8px] border-b border-[#4C526B] pb-[8px] mb-[8px]">
                            {pm.customInstallments.length > 1 && (
                              <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תשלום</span>
                            )}
                            <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תאריך</span>
                            {pm.method === "check" && (
                              <span className="text-[14px] font-medium text-white/70 flex-1 text-center">מס׳ צ׳ק</span>
                            )}
                            <span className="text-[14px] font-medium text-white/70 flex-1 text-center">סכום</span>
                          </div>
                          <div className="flex flex-col gap-[8px]">
                            {pm.customInstallments.map((item, index) => (
                              <div key={item.number} className="flex items-center gap-[8px]">
                                {pm.customInstallments.length > 1 && (
                                  <span className="text-[14px] text-white ltr-num flex-1 text-center">{item.number}/{pm.installments}</span>
                                )}
                                <div className="flex-1">
                                  <DatePickerField
                                    value={item.dateForInput}
                                    onChange={(val) => handleInstallmentDateChange(pm.id, index, val)}
                                    className="h-[36px] rounded-[7px] text-[14px]"
                                  />
                                </div>
                                {pm.method === "check" && (
                                  <div className="flex-1">
                                    <Input
                                      type="text"
                                      inputMode="numeric"
                                      title={`מספר צ׳ק תשלום ${item.number}`}
                                      value={item.checkNumber || ""}
                                      onChange={(e) => handleInstallmentCheckNumberChange(pm.id, index, e.target.value)}
                                      placeholder="מס׳ צ׳ק"
                                      className="w-full h-[36px] bg-[#29318A]/30 border border-[#4C526B] rounded-[7px] text-[14px] text-white text-center focus:outline-none focus:border-white/50 px-[5px] ltr-num"
                                    />
                                  </div>
                                )}
                                <div className="flex-1 relative">
                                  <Input
                                    type="text"
                                    inputMode="decimal"
                                    title={`סכום תשלום ${item.number}`}
                                    value={item.amount === 0 ? "" : (item.amount % 1 === 0 ? item.amount.toString() : item.amount.toFixed(2))}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) => handleInstallmentAmountChange(pm.id, index, e.target.value)}
                                    className="w-full h-[36px] bg-[#29318A]/30 border border-[#4C526B] rounded-[7px] text-[14px] text-white text-center focus:outline-none focus:border-white/50 px-[5px] ltr-num"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                          {pm.customInstallments.length > 1 && (() => {
                            const installmentsTotal = getInstallmentsTotal(pm.customInstallments);
                            const pmTotal = parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0;
                            const isMismatch = Math.abs(installmentsTotal - pmTotal) > 0.01;
                            return (
                              <div className="flex items-center gap-[8px] border-t border-[#4C526B] pt-[8px] mt-[8px]">
                                <span className="text-[14px] font-bold text-white flex-1 text-center">סה&quot;כ</span>
                                {pm.method === "check" && <span className="flex-1"></span>}
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
                  </Fragment>
                ))}
                <Button
                  type="button"
                  onClick={addPaymentMethodEntry}
                  className="w-full bg-[#29318A] text-white text-[16px] font-medium h-[50px] rounded-[10px] hover:bg-[#3D44A0] transition-colors"
                >
                  + הוסף אמצעי תשלום
                </Button>
              </div>

              {/* Reference + Receipt Upload — single row */}
              <div className="flex flex-col gap-[3px]">
                <div className="flex items-start">
                  <span className="text-[16px] font-medium text-white">אסמכתא</span>
                </div>
                <div className="flex gap-[8px] items-center">
                  <div className="flex-1 border border-[#4C526B] rounded-[10px] min-h-[50px]">
                    <Input
                      type="text"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="מספר אסמכתא..."
                      className="w-full h-[50px] bg-transparent text-[18px] text-white text-right focus:outline-none px-[10px] rounded-[10px]"
                    />
                  </div>
                  <label className="shrink-0 border border-[#4C526B] border-dashed rounded-[10px] w-[50px] h-[50px] flex items-center justify-center cursor-pointer hover:bg-white/5 transition-colors" onPointerDown={(e) => e.stopPropagation()}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/50">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      multiple
                      onChange={async (e) => {
                        const files = e.target.files;
                        if (files && files.length > 0) {
                          const arr = Array.from(files);
                          // Deduplicate by file name+size (#24)
                          const dedupedArr = arr.filter(f => !receiptFiles.some(existing => existing.file?.name === f.name && existing.file?.size === f.size));
                          if (dedupedArr.length === 0) { e.target.value = ""; return; }
                          const newEntries = dedupedArr.map(file => ({ file, preview: URL.createObjectURL(file) }));
                          setReceiptFiles(prev => [...prev, ...newEntries]);
                          if (!ocrApplied && arr.length > 0) {
                            processReceiptOcr(arr[0]);
                          }
                        }
                        e.target.value = "";
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
                {/* Existing files list */}
                {receiptFiles.length > 0 && (
                  <div className="flex flex-wrap gap-[8px]">
                    {receiptFiles.map((entry, idx) => {
                      const isPdf = entry.preview.toLowerCase().includes(".pdf") || (entry.file?.type === "application/pdf");
                      return (
                        <div key={`receipt-${entry.preview}`} className="relative group border border-[#4C526B] rounded-[7px] w-[80px] h-[80px] overflow-hidden flex items-center justify-center bg-white/5">
                          <Button type="button" onClick={() => { setViewerDocIsPdf(isPdf); setViewerDocUrl(entry.preview); }} className="w-full h-full cursor-pointer">
                            {isPdf ? (
                              <PdfThumbnail url={entry.preview} className="w-full h-full" />
                            ) : (
                              <Image src={entry.preview} alt="קבלה" className="w-full h-full object-cover" width={70} height={70} unoptimized />
                            )}
                          </Button>
                          <Button
                            type="button"
                            onClick={() => setReceiptFiles(prev => prev.filter((_, i) => i !== idx))}
                            className="absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-[#F64E60] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <span className="text-white text-[12px] leading-none">×</span>
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {isUploadingReceipt && (
                  <span className="text-[12px] text-white/50 text-center">מעלה קבצים...</span>
                )}
                {isOcrProcessing && (
                  <div className="flex items-center gap-[8px] justify-center py-[6px]">
                    <svg className="animate-spin h-4 w-4 text-[#29318A]" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-[13px] text-white/70">{ocrProcessingStep || "מזהה נתונים מהקבלה..."}</span>
                  </div>
                )}
                {ocrApplied && !isOcrProcessing && (
                  <span className="text-[12px] text-green-400 text-center">נתונים זוהו ומולאו בטופס</span>
                )}
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-[3px]">
                <div className="flex items-start">
                  <span className="text-[16px] font-medium text-white">הערות</span>
                </div>
                <div className="border border-[#4C526B] rounded-[10px] min-h-[100px]">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="הערות..."
                    className="w-full h-[100px] bg-transparent text-[18px] text-white text-right focus:outline-none px-[10px] py-[10px] rounded-[10px] resize-none"
                  />
                </div>
              </div>

              {/* Amount Mismatch Warning */}
              {(() => {
                const paymentTotal = paymentMethods.reduce((sum, pm) => sum + (parseFloat(pm.amount) || 0), 0);
                if (paymentTotal <= 0) return null;

                // Case 1: Invoices selected - compare payment to selected invoices total
                if (selectedInvoiceIds.size > 0) {
                  const invoicesTotal = openInvoices
                    .filter(inv => selectedInvoiceIds.has(inv.id))
                    .reduce((sum, inv) => sum + Number(inv.total_amount), 0);
                  const diff = Math.abs(invoicesTotal - paymentTotal);
                  if (diff > 0.01) {
                    const isBlocked = diff > 5;
                    const colorClass = isBlocked ? "bg-red-500/10 border-red-500/40" : "bg-yellow-500/10 border-yellow-500/40";
                    const textClass = isBlocked ? "text-red-400" : "text-yellow-400";
                    const strokeColor = isBlocked ? "#EF4444" : "#EAB308";
                    return (
                      <div className={`flex items-center gap-[8px] ${colorClass} border rounded-[10px] p-[10px]`}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
                          <path d="M12 9v4m0 4h.01M10.29 3.86l-8.8 15.36A2 2 0 003.24 22h17.53a2 2 0 001.75-2.78l-8.8-15.36a2 2 0 00-3.44 0z" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span className={`text-[14px] ${textClass}`}>
                          {isBlocked
                            ? `לא ניתן לבצע תשלום חלקי — הפרש של ₪${diff.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} בין סכום התשלום לסכום החשבוניות`
                            : `סכום התשלום (₪${paymentTotal.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) ${paymentTotal > invoicesTotal ? "גבוה" : "נמוך"} מסכום החשבוניות שנבחרו (₪${invoicesTotal.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) — הפרש: ₪${diff.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          }
                        </span>
                      </div>
                    );
                  }
                }

                // Case 2: Invoices visible but none selected - remind user to link
                if (showOpenInvoices && openInvoices.length > 0 && selectedInvoiceIds.size === 0) {
                  return (
                    <div className="flex items-center gap-[8px] bg-yellow-500/10 border border-yellow-500/40 rounded-[10px] p-[10px]">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
                        <path d="M12 9v4m0 4h.01M10.29 3.86l-8.8 15.36A2 2 0 003.24 22h17.53a2 2 0 001.75-2.78l-8.8-15.36a2 2 0 00-3.44 0z" stroke="#EAB308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span className="text-[14px] text-yellow-400">
                        יש {openInvoices.length} חשבוניות פתוחות שלא קושרו לתשלום זה. סמן חשבוניות לקישור או המשך ללא קישור.
                      </span>
                    </div>
                  );
                }

                return null;
              })()}

              {/* Payment mismatch warnings */}
              {(() => {
                const warnings: string[] = [];
                // Per-PM: check installments sum vs amount
                paymentMethods.forEach((pm, idx) => {
                  if (pm.customInstallments.length > 0) {
                    const pmAmount = parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0;
                    const instTotal = pm.customInstallments.reduce((s, inst) => s + (Number(inst.amount) || 0), 0);
                    if (pmAmount > 0 && Math.abs(instTotal - pmAmount) > 0.01) {
                      warnings.push(`אמצעי תשלום ${idx + 1}: סכום תשלומים (₪${instTotal.toFixed(2)}) לא תואם לסכום (₪${pmAmount.toFixed(2)})`);
                    }
                  }
                });
                // Total: check all payments vs invoices
                if (selectedInvoiceIds.size > 0) {
                  const actualPaymentTotal = paymentMethods.reduce((sum, pm) => {
                    if (pm.customInstallments.length > 0) {
                      return sum + pm.customInstallments.reduce((s, inst) => s + (Number(inst.amount) || 0), 0);
                    }
                    return sum + (parseFloat(pm.amount.replace(/[^\d.]/g, "")) || 0);
                  }, 0);
                  const invoicesTotal = openInvoices
                    .filter(inv => selectedInvoiceIds.has(inv.id))
                    .reduce((sum, inv) => sum + Number(inv.total_amount), 0);
                  const diff = invoicesTotal - actualPaymentTotal;
                  if (Math.abs(diff) > 5) {
                    warnings.push(diff > 0
                      ? `חסרים ₪${diff.toFixed(2)} לסגירת החשבוניות`
                      : `סכום התשלומים עולה ב-₪${Math.abs(diff).toFixed(2)} על סכום החשבוניות`);
                  }
                }
                if (warnings.length === 0) return null;
                return (
                  <div className="bg-red-500/20 border border-red-500/50 rounded-[10px] p-[10px] flex flex-col gap-[5px]">
                    {warnings.map((w, i) => (
                      <span key={i} className="text-[13px] text-red-400 font-medium text-center">{w}</span>
                    ))}
                  </div>
                );
              })()}

              {/* Action Buttons */}
              <div className="flex flex-col gap-[10px] mt-[20px]">
                <Button
                  type="button"
                  onClick={editingPaymentId ? handleUpdatePayment : handleSavePayment}
                  disabled={isSaving || isUploadingReceipt}
                  className="w-full bg-[#29318A] text-white text-[18px] font-semibold h-[50px] rounded-[10px] transition-colors hover:bg-[#3D44A0] disabled:opacity-50"
                >
                  {isSaving ? "שומר..." : isUploadingReceipt ? "מעלה קובץ..." : editingPaymentId ? "עדכון תשלום" : "הוספת תשלום"}
                </Button>
                <Button
                  type="button"
                  onClick={resetForm}
                  disabled={isSaving}
                  className="w-full text-white/60 text-[16px] font-medium h-[50px] rounded-[10px] transition-colors hover:text-white hover:bg-white/10 disabled:opacity-50"
                >
                  איפוס טופס
                </Button>
              </div>
            </div>

        {/* Fullscreen Document Viewer Popup - inside SheetContent to avoid Radix modal trap */}
        {viewerDocUrl && (
          <div
            className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80"
            onClick={(e) => { e.stopPropagation(); setViewerDocUrl(null); setViewerDocIsPdf(false); }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <Button
              type="button"
              onClick={(e) => { e.stopPropagation(); setViewerDocUrl(null); setViewerDocIsPdf(false); }}
              className="absolute top-[16px] right-[16px] z-[20] w-[40px] h-[40px] flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 transition-colors cursor-pointer pointer-events-auto"
            >
              <X size={24} className="text-white" />
            </Button>
            {/* Open in new tab button */}
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
            {/* Document content */}
            <div
              className="max-w-[90vw] max-h-[90vh] flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              {(isPdfUrl(viewerDocUrl) || viewerDocIsPdf) ? (
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
          </div>
        )}

        {/* Update Confirmation Popup - inside SheetContent to avoid Radix modal trap */}
        {updateConfirmation && (
          <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50" onClick={() => setUpdateConfirmation(null)} onPointerDown={(e) => e.stopPropagation()}>
            <div dir="rtl" className="bg-[#1A1F4E] rounded-[14px] border border-white/20 shadow-2xl p-[20px] w-[360px] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-[16px] font-bold text-white text-center mb-[15px]">אישור עדכון תשלום</h3>
              <p className="text-[14px] text-white/70 text-center mb-[15px]">השינויים הבאים זוהו:</p>

              <div className="flex flex-col gap-[10px] mb-[20px]">
                {updateConfirmation.changes.map((change) => (
                  <div key={`change-${change.label}`} className="bg-[#0F1535] rounded-[10px] p-[10px] border border-[#4C526B]">
                    <span className="text-[13px] font-medium text-white/70 block mb-[6px]">{change.label}</span>
                    <div className="flex items-center gap-[8px]">
                      <span className="text-[14px] text-red-400 ltr-num flex-1 text-center line-through">{change.before}</span>
                      <span className="text-[14px] text-white/50">←</span>
                      <span className="text-[14px] text-green-400 ltr-num flex-1 text-center font-bold">{change.after}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-[10px]">
                <Button
                  type="button"
                  onClick={() => updateConfirmation.onConfirm()}
                  className="flex-1 bg-[#29318A] text-white text-[14px] font-bold py-[10px] rounded-[10px] hover:bg-[#3D44A0] transition-colors cursor-pointer"
                >
                  אישור עדכון
                </Button>
                <Button
                  type="button"
                  onClick={() => setUpdateConfirmation(null)}
                  className="flex-1 bg-transparent border border-[#4C526B] text-white text-[14px] font-bold py-[10px] rounded-[10px] hover:bg-white/10 transition-colors cursor-pointer"
                >
                  ביטול
                </Button>
              </div>
            </div>
          </div>
        )}

        </SheetContent>
      </Sheet>

      {/* Fullscreen Document Viewer - outside Sheet, for when Sheet is closed */}
      {!showAddPaymentPopup && viewerDocUrl && (
        <div
          className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80"
          onClick={() => { setViewerDocUrl(null); setViewerDocIsPdf(false); }}
        >
          <Button
            type="button"
            onClick={(e) => { e.stopPropagation(); setViewerDocUrl(null); setViewerDocIsPdf(false); }}
            className="absolute top-[16px] right-[16px] z-[20] w-[40px] h-[40px] flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 transition-colors cursor-pointer pointer-events-auto"
          >
            <X size={24} className="text-white" />
          </Button>
          <Button
            type="button"
            onClick={(e) => { e.stopPropagation(); window.open(viewerDocUrl, '_blank'); }}
            className="absolute top-[16px] left-[16px] z-[20] flex items-center gap-[6px] px-[12px] py-[8px] rounded-full bg-black/60 hover:bg-black/80 transition-colors text-white text-[13px] cursor-pointer pointer-events-auto"
          >
            פתח בכרטיסייה חדשה
          </Button>
          <div className="max-w-[90vw] max-h-[90vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {(isPdfUrl(viewerDocUrl) || viewerDocIsPdf) ? (
              <iframe src={viewerDocUrl} className="w-[90vw] h-[90vh] rounded-[12px] border border-white/20" title="תצוגת מסמך" />
            ) : (
              <Image src={viewerDocUrl} alt="תצוגת מסמך" className="max-w-[90vw] max-h-[90vh] object-contain rounded-[12px]" width={800} height={600} unoptimized />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
