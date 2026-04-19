"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Suspense } from "react";
import { X } from "lucide-react";
import { CookingPot, Receipt, UsersThree } from "@phosphor-icons/react";
import { PieChart, Pie, Cell, ResponsiveContainer, Sector, type PieSectorDataItem } from "recharts";
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
import { useApprovals } from '@/hooks/useApprovals';
import SupplierSearchSelect from "@/components/ui/SupplierSearchSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import type { OCRLineItem, OCRExtractedData } from '@/types/ocr';
import { savePriceTrackingForLineItems } from '@/lib/priceTracking';

// Format date as YYYY-MM-DD using local timezone (avoids UTC shift from toISOString)
const toLocalDateStr = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// Supplier from database
interface Supplier {
  id: string;
  name: string;
  expense_category_id: string | null;
  expense_type?: string | null;
  waiting_for_coordinator: boolean;
  is_fixed_expense?: boolean;
  vat_type?: string; // "full" | "none" | "partial"
  default_payment_method?: string | null;
  default_credit_card_id?: string | null;
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
  approval_status: string | null;
  reference_date: string | null;
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

function isPdfUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return url.toLowerCase().includes(".pdf");
  }
}

// Invoice display for UI
interface InvoiceDisplay {
  id: string;
  date: string;
  rawDate: string;
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
  approval_status: string | null;
  referenceDate: string | null;
  linkedPayments: { id: string; paymentId: string; amount: number; method: string; date: string; checkNumber: string; installmentNumber: number | null; installmentsCount: number | null; referenceNumber: string; creditCardId: string | null; receiptUrl: string | null }[];
  linkedDeliveryNotes: { id: string; deliveryNoteNumber: string; date: string; amount: number; subtotal: number; attachmentUrl: string | null; attachmentUrls: string[]; notes: string }[];
  documentType: "invoice" | "delivery_note";
  invoiceType?: string;
  statusRaw?: string;
  parentInvoiceId?: string | null;
  consolidatedReference?: string | null;
  isConsolidated?: boolean;
}

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
  suppliers: { id: string; name: string; amount: number; percentage: number; isFixed?: boolean; hasPending?: boolean }[];
}

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
        const desiredWidth = 140; // 2x for retina on 70px thumbnail
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

export default function ExpensesPage() {
  return (
    <Suspense fallback={null}>
      <ExpensesPageInner />
    </Suspense>
  );
}

function ExpensesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightInvoiceId = searchParams.get("invoiceId");
  const { selectedBusinesses, isAdmin, globalDateRange, setGlobalDateRange } = useDashboard();
  const { approveInvoice, approvePayment } = useApprovals(selectedBusinesses);
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = usePersistedState<"expenses" | "purchases" | "employees">("expenses:tab", "expenses");
  const dateRange = globalDateRange;
  const handleDateRangeChange = setGlobalDateRange;

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

  // Daily entries labor data for employees tab
  interface DailyLaborEntry {
    entry_date: string;
    labor_cost: number;
    labor_hours: number;
    manager_daily_cost: number;
  }
  const [dailyLaborEntries, setDailyLaborEntries] = useState<DailyLaborEntry[]>([]);
  const [totalLaborFromDaily, setTotalLaborFromDaily] = useState(0);
  const [laborMarkupMultiplier, setLaborMarkupMultiplier] = useState(1);
  const [_isLoading, setIsLoading] = useState(true);
  const [hasMoreInvoices, setHasMoreInvoices] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [invoicesOffset, setInvoicesOffset] = useState(0);
  const invoicesListRef = useRef<HTMLDivElement>(null);
  const INVOICES_PAGE_SIZE = 20;
  const [isSaving, setIsSaving] = useState(false);
  const [expandedCategoryIds, setExpandedCategoryIds] = usePersistedState<string[]>("expenses:expandedCategories", []); // For drill-down (supports multiple)

  // Form state for new expense
  const [expenseDate, setExpenseDate] = useState(() => toLocalDateStr(new Date()));
  const [referenceDate, setReferenceDate] = useState(() => toLocalDateStr(new Date()));
  const referenceDateManuallySet = useRef(false);
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
  const [linkToCoordinator, setLinkToCoordinator] = useState(false);

  // Fixed expense linking - when supplier is_fixed_expense, show open invoices to link
  const [fixedOpenInvoices, setFixedOpenInvoices] = useState<{ id: string; invoice_date: string; subtotal: number; total_amount: number; month: string }[]>([]);
  const [linkToFixedInvoiceId, setLinkToFixedInvoiceId] = useState<string | null>(null); // null = create new
  const [showFixedInvoices, setShowFixedInvoices] = useState(false);

  // Line items for price tracking (goods expenses only)
  const [expenseLineItems, setExpenseLineItems] = useState<OCRLineItem[]>([]);
  const [showLineItems, setShowLineItems] = useState(false);
  const [lineItemsPriceCheckDone, setLineItemsPriceCheckDone] = useState(false);
  const [newLineItemDesc, setNewLineItemDesc] = useState('');
  const [newLineItemQty, setNewLineItemQty] = useState('');
  const [newLineItemPrice, setNewLineItemPrice] = useState('');

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
  const [showLinkedDeliveryNotes, setShowLinkedDeliveryNotes] = useState<string | null>(null);

  // Auto-expand invoice from URL param (e.g. /expenses?invoiceId=xxx)
  const highlightedRef = useRef(false);
  useEffect(() => {
    if (!highlightInvoiceId || highlightedRef.current || selectedBusinesses.length === 0) return;

    // Check if already in the list
    const existing = recentInvoices.find(inv => inv.id === highlightInvoiceId);
    if (existing) {
      highlightedRef.current = true;
      setExpandedInvoiceId(existing.id);
      setTimeout(() => {
        const el = document.querySelector(`[data-invoice-id="${existing.id}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
      return;
    }

    // Not in the list yet — fetch from DB, switch tab if needed, and prepend
    const fetchAndHighlight = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("invoices")
        .select(`
          *,
          supplier:suppliers(id, name, expense_category_id, is_fixed_expense),
          creator:profiles!invoices_created_by_fkey(full_name),
          payments!payments_invoice_id_fkey(id, payment_date, total_amount, receipt_url, payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id)),
          payment_invoice_links(payment:payments(id, payment_date, total_amount, receipt_url, payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id)))
        `)
        .eq("id", highlightInvoiceId)
        .in("business_id", selectedBusinesses)
        .is("deleted_at", null)
        .maybeSingle();

      if (!data) return;

      highlightedRef.current = true;

      // Switch to the correct tab based on invoice_type
      const tabMap: Record<string, "expenses" | "purchases" | "employees"> = {
        current: "expenses",
        goods: "purchases",
        employees: "employees",
      };
      const targetTab = tabMap[data.invoice_type] || "expenses";
      if (activeTab !== targetTab) {
        setActiveTab(targetTab);
        // Tab switch will trigger a data refetch — the next render cycle will find the invoice
        // We set a short timeout to let the refetch happen, then try again
        return;
      }

      // Prepend the invoice to the list so it's visible
      const transformed = transformInvoicesData([data]);
      if (transformed.length > 0) {
        setRecentInvoices(prev => {
          if (prev.find(inv => inv.id === transformed[0].id)) return prev;
          return [transformed[0], ...prev];
        });
        setExpandedInvoiceId(transformed[0].id);
        setTimeout(() => {
          const el = document.querySelector(`[data-invoice-id="${transformed[0].id}"]`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 200);
      }
    };

    fetchAndHighlight();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Only re-run when invoice list, tab, or businesses change
  }, [highlightInvoiceId, recentInvoices, activeTab, selectedBusinesses]);

  // Edit expense state
  const [editingInvoice, setEditingInvoice] = useState<InvoiceDisplay | null>(null);
  const [showEditPopup, setShowEditPopup] = useState(false);
  const [editReturnTo, setEditReturnTo] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState('');

  // Delete confirmation state
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [deletingDocumentType, setDeletingDocumentType] = useState<"invoice" | "delivery_note">("invoice");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // File upload state for new expense (supports multiple files)
  const [newAttachmentFiles, setNewAttachmentFiles] = useState<File[]>([]);
  const [newAttachmentPreviews, setNewAttachmentPreviews] = useState<string[]>([]);

  // File upload state for edit (supports multiple files)
  const [editAttachmentFiles, setEditAttachmentFiles] = useState<File[]>([]);
  const [editAttachmentPreviews, setEditAttachmentPreviews] = useState<string[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

  // OCR processing state
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [ocrProcessingStep, setOcrProcessingStep] = useState("");
  const [ocrApplied, setOcrApplied] = useState(false);

  // Invoice filter & sort state
  const [filterBy, setFilterBy] = useState<string>("");
  const [filterValue, setFilterValue] = useState<string>("");
  const [globalSearchResults, setGlobalSearchResults] = useState<InvoiceDisplay[] | null>(null);
  const [isGlobalSearching, setIsGlobalSearching] = useState(false);
  const [sortColumn, setSortColumn] = useState<"date" | "supplier" | "reference" | "amount" | "status" | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>(null);
  const [laborSortCol, setLaborSortCol] = useState<"date" | "labor_cost" | "labor_hours" | "manager_daily_cost" | "total" | "total_with_markup" | null>(null);
  const [laborSortOrder, setLaborSortOrder] = useState<"asc" | "desc" | null>(null);
  const handleLaborSort = (col: "date" | "labor_cost" | "labor_hours" | "manager_daily_cost" | "total" | "total_with_markup") => {
    if (laborSortCol !== col) { setLaborSortCol(col); setLaborSortOrder("asc"); }
    else if (laborSortOrder === "asc") { setLaborSortOrder("desc"); }
    else { setLaborSortCol(null); setLaborSortOrder(null); }
  };
  const handleColumnSort = (col: "date" | "supplier" | "reference" | "amount" | "status") => {
    if (sortColumn !== col) { setSortColumn(col); setSortOrder("asc"); }
    else if (sortOrder === "asc") { setSortOrder("desc"); }
    else { setSortColumn(null); setSortOrder(null); }
  };
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);

  // Global search: when any filter is active, search DB without date restrictions
  useEffect(() => {
    setGlobalSearchResults(null);
    if (!filterBy || !selectedBusinesses.length) return;
    // "fixed" filter works client-side only (no search value needed)
    if (filterBy === "fixed") return;
    if (!filterValue.trim()) return;

    const searchVal = filterValue.trim();

    const timer = setTimeout(async () => {
      setIsGlobalSearching(true);
      try {
        const supabase = createClient();
        let query = supabase
          .from("invoices")
          .select(`
            *,
            supplier:suppliers(id, name, expense_category_id, is_fixed_expense, is_active, deleted_at),
            creator:profiles!invoices_created_by_fkey(full_name),
            payments!payments_invoice_id_fkey(id, payment_date, total_amount, receipt_url, payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id)),
          payment_invoice_links(payment:payments(id, payment_date, total_amount, receipt_url, payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id)))
          `)
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .order("invoice_date", { ascending: false })
          .limit(50);

        // Also query delivery_notes in parallel for reference/supplier searches —
        // the main query only hits invoices, so delivery notes (like תעודת משלוח
        // for הקצב- סלמון) were invisible in global search. We merge results below.
        let deliveryNoteResults: InvoiceDisplay[] = [];
        const fetchMatchingDeliveryNotes = async () => {
          let dnQuery = supabase
            .from("delivery_notes")
            .select(`
              *,
              supplier:suppliers(id, name, expense_category_id, is_fixed_expense),
              creator:profiles!delivery_notes_created_by_fkey(full_name)
            `)
            .in("business_id", selectedBusinesses)
            .is("invoice_id", null)
            .order("delivery_date", { ascending: false })
            .limit(50);
          if (filterBy === "reference") {
            dnQuery = dnQuery.ilike("delivery_note_number", `%${searchVal}%`);
          } else if (filterBy === "supplier") {
            const { data: matchedSuppliersDn } = await supabase
              .from("suppliers")
              .select("id")
              .in("business_id", selectedBusinesses)
              .ilike("name", `%${searchVal}%`)
              .is("deleted_at", null);
            if (!matchedSuppliersDn || matchedSuppliersDn.length === 0) return;
            dnQuery = dnQuery.in("supplier_id", matchedSuppliersDn.map(s => s.id));
          } else if (filterBy === "notes") {
            dnQuery = dnQuery.ilike("notes", `%${searchVal}%`);
          } else if (filterBy === "amount") {
            const num = parseFloat(searchVal.replace(/[^\d.-]/g, ""));
            if (!isNaN(num)) dnQuery = dnQuery.eq("subtotal", num);
          } else {
            // date/reference_date/creditCard — not directly supported here; skip DN fetch
            return;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: dnData } = await dnQuery;
          deliveryNoteResults = (dnData || []).map((dn: Record<string, unknown>) => {
            const supplier = dn.supplier as { name?: string; is_fixed_expense?: boolean } | null;
            const creator = dn.creator as { full_name?: string } | null;
            return {
              id: dn.id as string,
              date: formatDateString(dn.delivery_date as string),
              rawDate: dn.delivery_date ? toLocalDateStr(new Date(dn.delivery_date as string)) : "",
              supplier: supplier?.name || "לא ידוע",
              reference: (dn.delivery_note_number as string) || "",
              amount: Number(dn.total_amount),
              amountWithVat: Number(dn.total_amount),
              amountBeforeVat: Number(dn.subtotal),
              status: "ת. משלוח",
              statusRaw: "delivery_note",
              enteredBy: creator?.full_name || "מערכת",
              entryDate: formatDateString(dn.created_at as string),
              notes: (dn.notes as string) || "",
              attachmentUrl: (dn.attachment_url as string) || null,
              attachmentUrls: parseAttachmentUrls(dn.attachment_url as string),
              clarificationReason: null,
              isFixed: supplier?.is_fixed_expense || false,
              approval_status: null,
              referenceDate: null,
              linkedPayments: [],
              linkedDeliveryNotes: [],
              documentType: "delivery_note" as const,
              parentInvoiceId: null,
            };
          });
        };

        // Apply filter to DB query based on filter type
        if (filterBy === "reference") {
          query = query.or(`invoice_number.ilike.%${searchVal}%,consolidated_reference.ilike.%${searchVal}%`);
        } else if (filterBy === "supplier") {
          const { data: matchedSuppliers } = await supabase
            .from("suppliers")
            .select("id")
            .in("business_id", selectedBusinesses)
            .ilike("name", `%${searchVal}%`)
            .is("deleted_at", null);
          if (!matchedSuppliers || matchedSuppliers.length === 0) {
            setGlobalSearchResults([]);
            setIsGlobalSearching(false);
            return;
          }
          query = query.in("supplier_id", matchedSuppliers.map(s => s.id));
        } else if (filterBy === "notes") {
          query = query.ilike("notes", `%${searchVal}%`);
        } else if (filterBy === "amount") {
          const numVal = parseFloat(searchVal.replace(/[^\d.-]/g, ""));
          if (!isNaN(numVal)) {
            query = query.eq("subtotal", numVal);
          }
        } else if (filterBy === "date") {
          // Date filter: search is done client-side on results
          // Just fetch without date range restriction
        } else if (filterBy === "reference_date") {
          // Same — fetch all, filter client-side by formatted date
        } else if (filterBy === "creditCard") {
          const { data: matchedCards } = await supabase
            .from("business_credit_cards")
            .select("id")
            .in("business_id", selectedBusinesses)
            .ilike("card_name", `%${searchVal}%`);
          if (!matchedCards || matchedCards.length === 0) {
            setGlobalSearchResults([]);
            setIsGlobalSearching(false);
            return;
          }
          const cardIds = matchedCards.map(c => c.id);
          const { data: matchedSplits } = await supabase
            .from("payment_splits")
            .select("payment_id")
            .in("credit_card_id", cardIds);
          if (!matchedSplits || matchedSplits.length === 0) {
            setGlobalSearchResults([]);
            setIsGlobalSearching(false);
            return;
          }
          const paymentIds = [...new Set(matchedSplits.map(s => s.payment_id))];
          const [{ data: directInvs }, { data: linkedRows }] = await Promise.all([
            supabase.from("payments").select("invoice_id").in("id", paymentIds).not("invoice_id", "is", null),
            supabase.from("payment_invoice_links").select("invoice_id").in("payment_id", paymentIds),
          ]);
          const invoiceIds = new Set<string>();
          if (directInvs) for (const p of directInvs) if (p.invoice_id) invoiceIds.add(p.invoice_id);
          if (linkedRows) for (const l of linkedRows) if (l.invoice_id) invoiceIds.add(l.invoice_id);
          if (invoiceIds.size === 0) {
            setGlobalSearchResults([]);
            setIsGlobalSearching(false);
            return;
          }
          query = query.in("id", [...invoiceIds]);
        }

        const { data } = await query;
        if (data && data.length > 0) {
          let results: InvoiceDisplay[] = data.map((inv: Invoice & { supplier: Supplier | null; creator: { full_name: string } | null; payments?: Array<{ id: string; payment_date: string; total_amount: number; payment_splits?: Array<{ id: string; payment_method: string; amount: number; installments_count: number; installment_number: number; due_date: string; check_number: string; reference_number: string }> }>; payment_invoice_links?: Array<{ payment: { id: string; payment_date: string; total_amount: number; payment_splits?: Array<{ id: string; payment_method: string; amount: number; installments_count: number; installment_number: number; due_date: string; check_number: string; reference_number: string }> } }> }) => {
            // Build linked payments from joined data (both direct invoice_id and payment_invoice_links)
            const linkedPayments: InvoiceDisplay["linkedPayments"] = [];
            const seenPaymentIds = new Set<string>();
            const allPayments: Array<{ id: string; payment_date: string; total_amount: number; payment_splits?: Array<{ id: string; payment_method: string; amount: number; installments_count: number; installment_number: number; due_date: string; check_number: string; reference_number: string }> }> = [];
            if (inv.payments && Array.isArray(inv.payments)) {
              for (const p of inv.payments) {
                if (!seenPaymentIds.has(p.id)) { seenPaymentIds.add(p.id); allPayments.push(p); }
              }
            }
            if (inv.payment_invoice_links && Array.isArray(inv.payment_invoice_links)) {
              for (const link of inv.payment_invoice_links) {
                const p = link.payment;
                if (p && !seenPaymentIds.has(p.id)) { seenPaymentIds.add(p.id); allPayments.push(p); }
              }
            }
            for (const payment of allPayments) {
              const paymentReceipt = (payment as unknown as { receipt_url?: string | null }).receipt_url || null;
              if (payment.payment_splits && Array.isArray(payment.payment_splits)) {
                for (const split of payment.payment_splits) {
                  linkedPayments.push({
                    id: `${payment.id}-${split.id || split.payment_method}`,
                    paymentId: payment.id,
                    amount: Number(split.amount),
                    method: paymentMethodNames[split.payment_method] || "אחר",
                    date: formatDateString(split.due_date || payment.payment_date),
                    checkNumber: split.check_number || "",
                    installmentNumber: split.installment_number || null,
                    installmentsCount: split.installments_count || null,
                    referenceNumber: split.reference_number || "",
                    creditCardId: (split as { credit_card_id?: string | null }).credit_card_id || null,
                    receiptUrl: paymentReceipt,
                  });
                }
              }
            }
            return {
              id: inv.id,
              date: formatDateString(inv.invoice_date),
              rawDate: inv.invoice_date ? toLocalDateStr(new Date(inv.invoice_date)) : "",
              supplier: inv.supplier?.name || "לא ידוע",
              reference: inv.invoice_number || "",
              amount: Number(inv.total_amount),
              amountWithVat: Number(inv.total_amount),
              amountBeforeVat: Number(inv.subtotal),
              status: inv.status === "paid" ? "שולם" : inv.status === "clarification" ? "בבירור" : "ממתין",
              statusRaw: inv.status || "pending",
              enteredBy: inv.creator?.full_name || "מערכת",
              entryDate: formatDateString(inv.created_at),
              notes: inv.notes || "",
              attachmentUrl: inv.attachment_url || null,
              attachmentUrls: parseAttachmentUrls(inv.attachment_url),
              clarificationReason: inv.clarification_reason || null,
              isFixed: inv.supplier?.is_fixed_expense || false,
              approval_status: inv.approval_status || null,
              referenceDate: inv.reference_date ? formatDateString(inv.reference_date) : null,
              linkedPayments,
              linkedDeliveryNotes: [],
              documentType: "invoice" as const,
              invoiceType: inv.invoice_type || undefined,
              consolidatedReference: (inv as unknown as { consolidated_reference?: string | null }).consolidated_reference || null,
              isConsolidated: !!(inv as unknown as { is_consolidated?: boolean }).is_consolidated,
            };
          });
          // Client-side filter for date/reference_date (formatted string match)
          if (filterBy === "date") {
            results = results.filter(inv => inv.date.includes(searchVal));
          } else if (filterBy === "reference_date") {
            results = results.filter(inv => inv.referenceDate?.includes(searchVal) || false);
          }

          // Load linked delivery notes for any markezet (is_consolidated=true) in results
          const markezetIds = results
            .filter(inv => {
              const raw = (data as Array<Record<string, unknown>>).find(d => d.id === inv.id);
              return raw?.is_consolidated === true;
            })
            .map(inv => inv.id);
          if (markezetIds.length > 0) {
            const { data: childDNs } = await supabase
              .from("delivery_notes")
              .select("id, invoice_id, delivery_note_number, delivery_date, subtotal, total_amount, attachment_url, notes")
              .in("invoice_id", markezetIds);
            if (childDNs && childDNs.length > 0) {
              const byParent = new Map<string, InvoiceDisplay["linkedDeliveryNotes"]>();
              for (const dn of childDNs) {
                const parentId = dn.invoice_id as string;
                const list = byParent.get(parentId) || [];
                list.push({
                  id: dn.id as string,
                  deliveryNoteNumber: (dn.delivery_note_number as string) || "",
                  date: formatDateString(dn.delivery_date as string),
                  amount: Number(dn.total_amount),
                  subtotal: Number(dn.subtotal),
                  attachmentUrl: (dn.attachment_url as string) || null,
                  attachmentUrls: parseAttachmentUrls(dn.attachment_url as string),
                  notes: (dn.notes as string) || "",
                });
                byParent.set(parentId, list);
              }
              for (const inv of results) {
                const children = byParent.get(inv.id);
                if (children) inv.linkedDeliveryNotes = children;
              }
            }
          }

          // Merge delivery_notes that also match the search
          await fetchMatchingDeliveryNotes();
          const mergedResults = [...results, ...deliveryNoteResults]
            .sort((a, b) => (b.rawDate || "").localeCompare(a.rawDate || ""));
          setGlobalSearchResults(mergedResults);
        } else {
          // No invoices matched — still check delivery_notes.
          await fetchMatchingDeliveryNotes();
          setGlobalSearchResults(deliveryNoteResults);
        }
      } catch {
        setGlobalSearchResults([]);
      } finally {
        setIsGlobalSearching(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterBy, filterValue, selectedBusinesses]);

  // Supplier detail popup state (from expenses breakdown)
  const [showSupplierBreakdownPopup, setShowSupplierBreakdownPopup] = useState(false);
  const [breakdownSupplierName, setBreakdownSupplierName] = useState("");
  const [breakdownSupplierCategory, setBreakdownSupplierCategory] = useState("");
  const [breakdownSupplierTotalWithVat, setBreakdownSupplierTotalWithVat] = useState(0);
  const [breakdownSupplierInvoices, setBreakdownSupplierInvoices] = useState<InvoiceDisplay[]>([]);
  const [isLoadingBreakdown, setIsLoadingBreakdown] = useState(false);
  const returnToBreakdownRef = useRef(false);

  // Status change state
  const [showStatusMenu, setShowStatusMenu] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const [statusConfirm, setStatusConfirm] = useState<{ invoiceId: string; newStatus: string; label: string } | null>(null);
  const [duplicateInvoicePrompt, setDuplicateInvoicePrompt] = useState<{ invoiceNumber: string } | null>(null);
  const duplicateProceedRef = useRef<(() => void) | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // Clarification popup state (when changing status to "בבירור")
  const [showClarificationPopup, setShowClarificationPopup] = useState(false);
  const [clarificationInvoiceId, setClarificationInvoiceId] = useState<string | null>(null);
  const [statusClarificationReason, setStatusClarificationReason] = useState("");

  // Total sales before VAT for the selected date range (used for % מפדיון calculation)
  const [totalSalesBeforeVat, setTotalSalesBeforeVat] = useState(0);
  const [businessVatRate, setBusinessVatRate] = useState(0.18);
  const [showStatusClarificationMenu, setShowStatusClarificationMenu] = useState(true);
  const [statusClarificationFile, setStatusClarificationFile] = useState<File | null>(null);
  const [statusClarificationFilePreview, setStatusClarificationFilePreview] = useState<string | null>(null);
  const [isSavingClarification, setIsSavingClarification] = useState(false);

  // Document viewer popup state (fullscreen preview)
  const [viewerDocUrl, setViewerDocUrl] = useState<string | null>(null);

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
    creditCardId: string;
    customInstallments: Array<{
      number: number;
      date: string;
      dateForInput: string;
      amount: number;
      checkNumber?: string;
    }>;
  }
  const [popupPaymentMethods, setPopupPaymentMethods] = useState<PaymentMethodEntry[]>([
    { id: 1, method: "", amount: "", installments: "1", checkNumber: "", creditCardId: "", customInstallments: [] }
  ]);

  // Business credit cards
  const [businessCreditCards, setBusinessCreditCards] = useState<{id: string, card_name: string, billing_day: number}[]>([]);

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

    const installmentAmount = Math.round((totalAmount / numInstallments) * 100) / 100;
    const lastInstallmentAmount = Math.round((totalAmount - installmentAmount * (numInstallments - 1)) * 100) / 100;
    const startDate = startDateStr ? new Date(startDateStr) : new Date();

    const result = [];
    for (let i = 0; i < numInstallments; i++) {
      const date = new Date(startDate);
      date.setMonth(date.getMonth() + i);

      result.push({
        number: i + 1,
        date: date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
        dateForInput: toLocalDateStr(date),
        amount: i === numInstallments - 1 ? lastInstallmentAmount : installmentAmount,
      });
    }

    return result;
  };

  // Calculate smart default payment date based on method
  // Cash/bank/bit/check → invoice date
  // Credit card → billing day from card, or 10th of month if no card info
  const getSmartPaymentDate = (method: string, invoiceDate: string, creditCardId?: string): string => {
    if (!method) return "";
    if (method === "credit_card") {
      if (creditCardId) {
        const card = businessCreditCards.find(c => c.id === creditCardId);
        if (card) {
          return calculateCreditCardDueDate(invoiceDate || toLocalDateStr(new Date()), card.billing_day);
        }
      }
      // No card info - default to 10th of current/next month
      const today = new Date();
      const day = today.getDate();
      if (day < 10) {
        return toLocalDateStr(new Date(today.getFullYear(), today.getMonth(), 10));
      } else {
        return toLocalDateStr(new Date(today.getFullYear(), today.getMonth() + 1, 10));
      }
    }
    // Cash, bank_transfer, bit, check, paybox, etc. → invoice date
    return invoiceDate || toLocalDateStr(new Date());
  };

  // Calculate due date based on credit card billing day.
  // Payment is recorded 1 day BEFORE the card's billing day
  // (e.g. card withdraws on the 10th → payment date = the 9th),
  // matching the same rule used in the OCR intake flow.
  // If billing_day is 1, `new Date(y, m, 0)` conveniently rolls to the
  // last day of the previous month.
  const calculateCreditCardDueDate = (paymentDateStr: string, billingDay: number): string => {
    // Parse as local midnight so timezones east of UTC don't flip the day.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(paymentDateStr);
    const payDate = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(paymentDateStr);
    const dayOfMonth = payDate.getDate();
    const adjustedDay = billingDay - 1;

    if (dayOfMonth < billingDay) {
      return toLocalDateStr(new Date(payDate.getFullYear(), payDate.getMonth(), adjustedDay));
    } else {
      return toLocalDateStr(new Date(payDate.getFullYear(), payDate.getMonth() + 1, adjustedDay));
    }
  };

  // Generate installments with credit card billing day logic
  // Uses paymentDate directly as first installment date (already calculated by getSmartPaymentDate)
  const generateCreditCardInstallments = (numInstallments: number, totalAmount: number, paymentDateStr: string, billingDay: number) => {
    if (numInstallments <= 1 || totalAmount === 0) return [];

    const installmentAmount = Math.round((totalAmount / numInstallments) * 100) / 100;
    const lastInstallmentAmount = Math.round((totalAmount - installmentAmount * (numInstallments - 1)) * 100) / 100;
    // Use paymentDate as-is for the first due date — it's already the correct billing date
    const firstDueDate = paymentDate || calculateCreditCardDueDate(paymentDateStr, billingDay);

    const result = [];
    for (let i = 0; i < numInstallments; i++) {
      const date = new Date(firstDueDate);
      date.setMonth(date.getMonth() + i);

      result.push({
        number: i + 1,
        date: date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
        dateForInput: toLocalDateStr(date),
        amount: i === numInstallments - 1 ? lastInstallmentAmount : installmentAmount,
      });
    }
    return result;
  };

  // Get the effective start date for new installments in popup
  const getPopupEffectiveStartDate = () => {
    if (popupPaymentMethods.length > 0 && popupPaymentMethods[0].customInstallments.length > 0) {
      return popupPaymentMethods[0].customInstallments[0].dateForInput;
    }
    return paymentDate;
  };

  // Add new payment method entry to popup — auto-fill remaining balance
  const addPopupPaymentMethodEntry = () => {
    const newId = Math.max(...popupPaymentMethods.map(p => p.id)) + 1;
    const totalInvoice = paymentInvoice ? paymentInvoice.amountWithVat : 0;
    const allocatedSoFar = popupPaymentMethods.reduce((sum, p) => sum + (parseFloat(p.amount.replace(/[^\d.-]/g, "")) || 0), 0);
    const remaining = Math.max(0, Math.round((totalInvoice - allocatedSoFar) * 100) / 100);
    setPopupPaymentMethods(prev => [
      ...prev,
      { id: newId, method: "", amount: remaining > 0 ? String(remaining) : "", installments: "1", checkNumber: "", creditCardId: "", customInstallments: [] }
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
    // Auto-set payment date when first payment method is selected
    if (field === "method" && value) {
      const invoiceDate = paymentInvoice ? paymentInvoice.rawDate : expenseDate;
      const smartDate = getSmartPaymentDate(value, invoiceDate);
      if (smartDate) setPaymentDate(smartDate);
    }
    // Auto-set payment date when credit card is selected (refine with billing day)
    if (field === "creditCardId" && value) {
      const invoiceDate = paymentInvoice ? paymentInvoice.rawDate : expenseDate;
      const smartDate = getSmartPaymentDate("credit_card", invoiceDate, value);
      if (smartDate) setPaymentDate(smartDate);
    }

    setPopupPaymentMethods(prev => prev.map(p => {
      if (p.id !== id) return p;

      const updated = { ...p, [field]: value };

      // Clear creditCardId when switching away from credit_card method
      if (field === "method" && value !== "credit_card") {
        updated.creditCardId = "";
      }

      // Auto-generate 1 installment row when check is selected (to show check number field)
      if (field === "method" && value === "check") {
        const totalAmount = parseFloat(p.amount.replace(/[^\d.-]/g, "")) || 0;
        const startDate = getPopupEffectiveStartDate();
        const date = startDate ? new Date(startDate) : new Date();
        updated.customInstallments = [{
          number: 1,
          date: date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
          dateForInput: toLocalDateStr(date),
          amount: totalAmount,
          checkNumber: "",
        }];
      }

      // Update installments when installments count changes - preserve existing dates
      if (field === "installments") {
        const numInstallments = parseInt(value) || 1;
        const totalAmount = parseFloat(p.amount.replace(/[^\d.-]/g, "")) || 0;

        if (numInstallments <= 1 || totalAmount === 0) {
          updated.customInstallments = [];
        } else {
          const existing = p.customInstallments;
          const installmentAmount = Math.round((totalAmount / numInstallments) * 100) / 100;
          const lastInstallmentAmount = Math.round((totalAmount - installmentAmount * (numInstallments - 1)) * 100) / 100;

          if (numInstallments > existing.length && existing.length > 0) {
            // Growing: keep existing installments, add new ones after the last date
            const lastExistingDate = existing[existing.length - 1].dateForInput;
            const kept = existing.map((inst, idx) => ({
              ...inst,
              amount: idx === numInstallments - 1 ? lastInstallmentAmount : installmentAmount,
            }));
            const newOnes = [];
            for (let i = existing.length; i < numInstallments; i++) {
              const date = new Date(lastExistingDate);
              date.setMonth(date.getMonth() + (i - existing.length + 1));
              newOnes.push({
                number: i + 1,
                date: date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }),
                dateForInput: toLocalDateStr(date),
                amount: i === numInstallments - 1 ? lastInstallmentAmount : installmentAmount,
              });
            }
            updated.customInstallments = [...kept, ...newOnes];
          } else if (numInstallments < existing.length) {
            // Shrinking: keep first N installments, recalculate amounts
            updated.customInstallments = existing.slice(0, numInstallments).map((inst, idx) => ({
              ...inst,
              number: idx + 1,
              amount: idx === numInstallments - 1 ? lastInstallmentAmount : installmentAmount,
            }));
          } else {
            // No existing installments or same count - generate fresh
            const card = p.creditCardId ? businessCreditCards.find(c => c.id === p.creditCardId) : null;
            const effectiveDate = existing.length > 0 ? existing[0].dateForInput : getPopupEffectiveStartDate();
            if (card) {
              updated.customInstallments = generateCreditCardInstallments(numInstallments, totalAmount, effectiveDate, card.billing_day);
            } else {
              updated.customInstallments = generatePopupInstallments(numInstallments, totalAmount, effectiveDate);
            }
          }
        }
      }

      // When amount changes, recalculate installment amounts but keep dates
      if (field === "amount") {
        const numInstallments = parseInt(p.installments) || 1;
        const totalAmount = parseFloat(value.replace(/[^\d.-]/g, "")) || 0;
        if (p.customInstallments.length > 0 && totalAmount > 0) {
          const installmentAmount = Math.round((totalAmount / numInstallments) * 100) / 100;
          const lastInstallmentAmount = Math.round((totalAmount - installmentAmount * (numInstallments - 1)) * 100) / 100;
          updated.customInstallments = p.customInstallments.map((inst, idx) => ({
            ...inst,
            amount: idx === numInstallments - 1 ? lastInstallmentAmount : installmentAmount,
          }));
        } else if (totalAmount > 0 && numInstallments > 1) {
          const card = p.creditCardId ? businessCreditCards.find(c => c.id === p.creditCardId) : null;
          const startDate = getPopupEffectiveStartDate();
          if (card) {
            updated.customInstallments = generateCreditCardInstallments(numInstallments, totalAmount, startDate, card.billing_day);
          } else {
            updated.customInstallments = generatePopupInstallments(numInstallments, totalAmount, startDate);
          }
        } else {
          updated.customInstallments = [];
        }
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
    const amount = parseFloat(newAmount.replace(/[^\d.-]/g, "")) || 0;
    setPopupPaymentMethods(prev => prev.map(p => {
      if (p.id !== paymentMethodId) return p;
      const totalAmount = parseFloat(p.amount.replace(/[^\d.-]/g, "")) || 0;
      const updatedInstallments = [...p.customInstallments];
      if (updatedInstallments[installmentIndex]) {
        const cappedAmount = Math.min(Math.round(amount * 100) / 100, totalAmount);
        updatedInstallments[installmentIndex] = {
          ...updatedInstallments[installmentIndex],
          amount: cappedAmount,
        };
        const remaining = Math.round((totalAmount - cappedAmount) * 100) / 100;
        const otherIndices = updatedInstallments.map((_, idx) => idx).filter(idx => idx !== installmentIndex);
        if (otherIndices.length > 0) {
          const perOther = Math.floor((remaining / otherIndices.length) * 100) / 100;
          let distributed = 0;
          for (let i = 0; i < otherIndices.length; i++) {
            const idx = otherIndices[i];
            if (i === otherIndices.length - 1) {
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

  // Handle check number change per installment (#21)
  const handlePopupInstallmentCheckNumberChange = (paymentMethodId: number, installmentIndex: number, value: string) => {
    setPopupPaymentMethods(prev => prev.map(p => {
      if (p.id !== paymentMethodId) return p;
      const updatedInstallments = [...p.customInstallments];
      if (updatedInstallments[installmentIndex]) {
        updatedInstallments[installmentIndex] = { ...updatedInstallments[installmentIndex], checkNumber: value };
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
    let stale = false;
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
        const targetYear = dateRange.start.getFullYear();
        const targetMonth = dateRange.start.getMonth() + 1;

        // Fetch suppliers for the selected businesses
        const { data: suppliersData } = await supabase
          .from("suppliers")
          .select("id, name, expense_category_id, expense_type, waiting_for_coordinator, vat_type, is_fixed_expense, default_payment_method, default_credit_card_id")
          .in("business_id", selectedBusinesses)
          .is("deleted_at", null)
          .eq("is_active", true)
          .order("name");

        if (suppliersData) {
          setSuppliers(suppliersData);
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

        // Fetch invoices for the date range (use local date format to avoid timezone issues)
        const formatLocalDate = (date: Date) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };
        const startDate = formatLocalDate(dateRange.start);
        const endDate = formatLocalDate(dateRange.end);

        // Fetch all invoices (all types) + delivery notes for the combined list.
        // Children of a markezet (consolidated_reference set but not is_consolidated themselves) are
        // hidden from the main list — they'll be shown inside the parent's expanded view.
        const [{ data: invoicesListData }, { data: deliveryNotesData }] = await Promise.all([
          supabase
            .from("invoices")
            .select(`
              *,
              supplier:suppliers(id, name, expense_category_id, is_fixed_expense),
              creator:profiles!invoices_created_by_fkey(full_name),
              payments!payments_invoice_id_fkey(id, payment_date, total_amount, receipt_url, payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id)),
          payment_invoice_links(payment:payments(id, payment_date, total_amount, receipt_url, payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id)))
            `)
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .gte("reference_date", startDate)
            .lte("reference_date", endDate)
            .or("consolidated_reference.is.null,is_consolidated.eq.true")
            .order("reference_date", { ascending: false })
            .range(0, INVOICES_PAGE_SIZE - 1),
          supabase
            .from("delivery_notes")
            .select(`
              *,
              supplier:suppliers(id, name, expense_category_id, is_fixed_expense),
              creator:profiles!delivery_notes_created_by_fkey(full_name)
            `)
            .in("business_id", selectedBusinesses)
            .gte("delivery_date", startDate)
            .lte("delivery_date", endDate)
            .order("delivery_date", { ascending: false })
            .range(0, INVOICES_PAGE_SIZE - 1),
        ]);

        if (stale) return;

        // Transform delivery notes to match InvoiceDisplay format
        const transformedDeliveryNotes: InvoiceDisplay[] = (deliveryNotesData || []).map((dn: any) => ({
          id: dn.id,
          date: formatDateString(dn.delivery_date),
          rawDate: dn.delivery_date ? toLocalDateStr(new Date(dn.delivery_date)) : "",
          supplier: dn.supplier?.name || "לא ידוע",
          reference: dn.delivery_note_number || "",
          amount: Number(dn.total_amount),
          amountWithVat: Number(dn.total_amount),
          amountBeforeVat: Number(dn.subtotal),
          status: dn.is_verified ? "אומת" : "ת. משלוח",
          enteredBy: dn.creator?.full_name || "מערכת",
          entryDate: formatDateString(dn.created_at),
          notes: dn.notes || "",
          attachmentUrl: dn.attachment_url || null,
          attachmentUrls: parseAttachmentUrls(dn.attachment_url),
          clarificationReason: null,
          isFixed: dn.supplier?.is_fixed_expense || false,
          approval_status: null,
          referenceDate: null,
          linkedPayments: [],
          linkedDeliveryNotes: [],
          documentType: "delivery_note" as const,
          parentInvoiceId: dn.invoice_id || null,
        }));

        // Merge and sort by date descending
        const allInvoices = transformInvoicesData(invoicesListData || []);

        // For each consolidated (markezet) invoice, load its linked delivery notes.
        // A markezet is an invoice with is_consolidated=true; the child invoices
        // and delivery notes also carry consolidated_reference (pointing to the
        // parent), so filter on is_consolidated from the raw data — not on
        // consolidatedReference alone, which would catch children too.
        const rawById = new Map<string, Record<string, unknown>>();
        for (const inv of (invoicesListData || []) as Array<Record<string, unknown>>) {
          if (inv && typeof inv.id === "string") rawById.set(inv.id, inv);
        }
        const markezetIds = allInvoices
          .filter(inv => {
            if (inv.documentType !== "invoice") return false;
            const raw = rawById.get(inv.id);
            return raw?.is_consolidated === true;
          })
          .map(inv => inv.id);
        if (markezetIds.length > 0) {
          const { data: childDNs } = await supabase
            .from("delivery_notes")
            .select("id, invoice_id, delivery_note_number, delivery_date, subtotal, total_amount, attachment_url, notes")
            .in("invoice_id", markezetIds);
          if (childDNs && childDNs.length > 0) {
            const byParent = new Map<string, InvoiceDisplay["linkedDeliveryNotes"]>();
            for (const dn of childDNs) {
              const parentId = dn.invoice_id as string;
              const list = byParent.get(parentId) || [];
              list.push({
                id: dn.id as string,
                deliveryNoteNumber: (dn.delivery_note_number as string) || "",
                date: formatDateString(dn.delivery_date as string),
                amount: Number(dn.total_amount),
                subtotal: Number(dn.subtotal),
                attachmentUrl: (dn.attachment_url as string) || null,
                attachmentUrls: parseAttachmentUrls(dn.attachment_url as string),
                notes: (dn.notes as string) || "",
              });
              byParent.set(parentId, list);
            }
            for (const inv of allInvoices) {
              const children = byParent.get(inv.id);
              if (children) inv.linkedDeliveryNotes = children;
            }
          }
        }

        const merged = [...allInvoices, ...transformedDeliveryNotes]
          .sort((a, b) => (b.rawDate || "").localeCompare(a.rawDate || ""))
          .slice(0, INVOICES_PAGE_SIZE);

        setRecentInvoices(merged);
        setInvoicesOffset(merged.length);
        setHasMoreInvoices(merged.length >= INVOICES_PAGE_SIZE);

        // Also fetch date-filtered invoices for the chart/summary
        const [
          { data: invoicesData },
          { data: categoriesData },
          { data: dailyEntries },
          { data: goalsData },
          { data: chartDeliveryNotes },
          { data: businessVatData },
        ] = await Promise.all([
          supabase
            .from("invoices")
            .select(`
              *,
              supplier:suppliers!inner(id, name, expense_category_id, is_fixed_expense, is_active, deleted_at, expense_type),
              creator:profiles!invoices_created_by_fkey(full_name)
            `)
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .gte("reference_date", startDate)
            .lte("reference_date", endDate)
            // Filter by the supplier's expense_type (source of truth) instead of
            // invoice_type on the invoice itself — invoice_type can be 'manual'
            // or NULL when created via intake/import/placeholder flows, which
            // would otherwise hide real fixed-expense invoices from this page.
            .eq("supplier.expense_type", activeTab === "expenses" ? "current_expenses" : activeTab === "employees" ? "employee_costs" : "goods_purchases")
            // Hide children of a markezet — only show orphans or the markezet parent itself.
            .or("consolidated_reference.is.null,is_consolidated.eq.true")
            .order("reference_date", { ascending: false }),
          supabase
            .from("expense_categories")
            .select("id, name")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .eq("is_active", true),
          supabase
            .from("daily_entries")
            .select("total_register, business_id")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .gte("entry_date", startDate)
            .lte("entry_date", endDate),
          supabase
            .from("goals")
            .select("business_id, vat_percentage, markup_percentage, expected_work_days")
            .in("business_id", selectedBusinesses)
            .eq("year", targetYear)
            .eq("month", targetMonth),
          supabase
            .from("delivery_notes")
            .select(`*, supplier:suppliers!inner(id, name, expense_category_id, is_fixed_expense, is_active, deleted_at, expense_type)`)
            .in("business_id", selectedBusinesses)
            .is("invoice_id", null)
            .gte("delivery_date", startDate)
            .lte("delivery_date", endDate)
            .eq("supplier.expense_type", activeTab === "expenses" ? "current_expenses" : activeTab === "employees" ? "employee_costs" : "goods_purchases"),
          supabase
            .from("businesses")
            .select("id, vat_percentage, markup_percentage, manager_monthly_salary")
            .in("id", selectedBusinesses),
        ]);

        // Fetch business_schedule + day_exceptions to compute expected work days
        // (same approach as dashboard/reports for manager-cost fallback)
        const [{ data: scheduleRows }, { data: exceptionRows }] = await Promise.all([
          supabase
            .from("business_schedule")
            .select("business_id, day_of_week, day_factor")
            .in("business_id", selectedBusinesses),
          supabase
            .from("business_day_exceptions")
            .select("business_id, exception_date, day_factor")
            .in("business_id", selectedBusinesses)
            .gte("exception_date", startDate)
            .lte("exception_date", endDate),
        ]);

        if (stale) return;

        // Calculate total sales before VAT
        const totalRegister = (dailyEntries || []).reduce((sum, e) => sum + (Number(e.total_register) || 0), 0);
        // Use goal VAT with business-level fallback (same logic as dashboard)
        const avgVat = (businessVatData || []).reduce((sum, b) => {
          const bGoal = (goalsData || []).find(g => g.business_id === b.id);
          return sum + (bGoal?.vat_percentage != null ? Number(bGoal.vat_percentage) : (Number(b.vat_percentage) || 0));
        }, 0) / Math.max((businessVatData || []).length, 1);
        const vatDivisor = avgVat > 0 ? 1 + avgVat : 1;
        const salesBeforeVat = totalRegister / vatDivisor;
        setTotalSalesBeforeVat(salesBeforeVat);
        if (avgVat > 0) setBusinessVatRate(avgVat);

        // Calculate average markup multiplier (same logic as dashboard)
        const avgMarkup = (businessVatData || []).reduce((sum, b) => {
          const bGoal = (goalsData || []).find(g => g.business_id === b.id);
          return sum + (bGoal?.markup_percentage != null ? Number(bGoal.markup_percentage) : (Number(b.markup_percentage) || 1));
        }, 0) / Math.max((businessVatData || []).length, 1);
        setLaborMarkupMultiplier(avgMarkup > 0 ? avgMarkup : 1);

        // Calculate totals per supplier (for chart/purchases) and per category with suppliers (for expenses drill-down)
        if (invoicesData) {
          const supplierTotals = new Map<string, { name: string; total: number; categoryId: string | null }>();
          const categoryTotals = new Map<string, { name: string; total: number; suppliers: Map<string, { name: string; total: number; isFixed: boolean; hasPending: boolean }> }>();

          // Initialize category totals with suppliers map
          if (categoriesData) {
            for (const cat of categoriesData) {
              categoryTotals.set(cat.id, { name: cat.name, total: 0, suppliers: new Map() });
            }
          }

          // Add "uncategorized" for suppliers without category
          const uncategorizedId = "__uncategorized__";

          // Sum invoice amounts by supplier and category
          // Include both invoices AND unlinked delivery notes (treated as invoices for
          // calculation; UI will still display them as 'תעודת משלוח' until they're
          // closed into a מרכזת invoice).
          const activeInvoices = invoicesData.filter(inv => {
            if (!inv.supplier) return false;
            const sup = inv.supplier as Record<string, unknown>;
            return sup.is_active !== false && sup.deleted_at == null;
          });
          // Add unlinked delivery notes as if they were invoices (status='pending')
          const unlinkedDNs = (chartDeliveryNotes || []).filter((dn: Record<string, unknown>) => {
            const sup = dn.supplier as Record<string, unknown> | null;
            return sup && sup.is_active !== false && sup.deleted_at == null;
          }).map((dn: Record<string, unknown>) => ({
            ...dn,
            status: 'pending',
          }));
          activeInvoices.push(...(unlinkedDNs as typeof activeInvoices));
          for (const inv of activeInvoices) {
            if (inv.supplier) {
              const supplierId = inv.supplier.id;
              const supplierName = inv.supplier.name;
              const subtotal = Number(inv.subtotal);
              const categoryId = inv.supplier.expense_category_id;
              // isFixed = supplier is marked as fixed expense
              const isFixed = inv.supplier.is_fixed_expense || false;
              // Track if this invoice is still pending (not paid)
              const isPending = inv.status !== "paid";

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
                  if (isFixed) supplier.isFixed = true;
                  // If any invoice is still pending, mark hasPending
                  if (isPending) supplier.hasPending = true;
                } else {
                  category.suppliers.set(supplierId, { name: supplierName, total: subtotal, isFixed, hasPending: isFixed && isPending });
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
                  if (isFixed) supplier.isFixed = true;
                  if (isPending) supplier.hasPending = true;
                } else {
                  uncategorized.suppliers.set(supplierId, { name: supplierName, total: subtotal, isFixed, hasPending: isFixed && isPending });
                }
              }
            }
          }

          // Use salesBeforeVat as denominator for percentage calculations (% מפדיון)
          const pctDenominator = salesBeforeVat;

          // Transform supplier data for chart/purchases tab
          const expensesSummary: ExpenseSummary[] = Array.from(supplierTotals.entries())
            .filter(([, data]) => data.total > 0)
            .map(([id, data]) => ({
              id,
              name: data.name,
              amount: data.total,
              percentage: pctDenominator > 0 ? (data.total / pctDenominator) * 100 : 0,
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
              percentage: pctDenominator > 0 ? (data.total / pctDenominator) * 100 : 0,
              suppliers: Array.from(data.suppliers.entries())
                .map(([supId, supData]) => ({
                  id: supId,
                  name: supData.name,
                  amount: supData.total,
                  percentage: pctDenominator > 0 ? (supData.total / pctDenominator) * 100 : 0,
                  isFixed: supData.isFixed,
                  hasPending: supData.hasPending,
                }))
                .sort((a, b) => b.amount - a.amount),
            }))
            .sort((a, b) => b.amount - a.amount);

          setCategoryData(categorySummary);
        }

        // For employees tab: fetch daily labor entries
        if (activeTab === "employees") {
          const { data: laborData } = await supabase
            .from("daily_entries")
            .select("entry_date, labor_cost, labor_hours, manager_daily_cost, day_factor")
            .in("business_id", selectedBusinesses)
            .is("deleted_at", null)
            .gte("entry_date", startDate)
            .lte("entry_date", endDate)
            .order("entry_date", { ascending: false });

          if (!stale && laborData) {
            // Compute expected work days in month from schedule + exceptions (matches dashboard/reports)
            const avgScheduleDayFactors: number[] = [0, 0, 0, 0, 0, 0, 0];
            const counts: number[] = [0, 0, 0, 0, 0, 0, 0];
            for (const row of (scheduleRows || [])) {
              const dow = Number(row.day_of_week);
              avgScheduleDayFactors[dow] += Number(row.day_factor) || 0;
              counts[dow] += 1;
            }
            for (let i = 0; i < 7; i++) {
              if (counts[i] > 0) avgScheduleDayFactors[i] /= counts[i];
            }
            const exceptionMap: Record<string, number> = {};
            for (const ex of (exceptionRows || [])) {
              if (ex.exception_date) {
                const d = new Date(ex.exception_date);
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                exceptionMap[key] = Number(ex.day_factor) || 0;
              }
            }
            const firstDay = new Date(targetYear, targetMonth - 1, 1);
            const lastDay = new Date(targetYear, targetMonth, 0);
            let scheduleWorkDays = 0;
            const cur = new Date(firstDay);
            while (cur <= lastDay) {
              const k = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
              scheduleWorkDays += exceptionMap[k] !== undefined ? exceptionMap[k] : (avgScheduleDayFactors[cur.getDay()] || 0);
              cur.setDate(cur.getDate() + 1);
            }
            // Match dashboard exactly: use schedule-derived work days, fallback to 26.
            const effectiveWorkDays = scheduleWorkDays > 0 ? scheduleWorkDays : 26;

            const totalManagerSalary = (businessVatData || []).reduce((sum, b) => sum + (Number(b.manager_monthly_salary) || 0), 0);
            const managerDailyCostComputed = effectiveWorkDays > 0 ? totalManagerSalary / effectiveWorkDays : 0;

            // Always compute manager cost from monthly_salary (matches dashboard exactly).
            // DB column is unreliable — use it only for display reference, not for totals.
            const entries = laborData.map(e => {
              const dayFactor = Number(e.day_factor) || 1;
              return {
                entry_date: e.entry_date,
                labor_cost: Number(e.labor_cost) || 0,
                labor_hours: Number(e.labor_hours) || 0,
                manager_daily_cost: managerDailyCostComputed * dayFactor,
              };
            }).filter(e => e.labor_cost > 0 || e.manager_daily_cost > 0);
            setDailyLaborEntries(entries);
            // (labor + manager) × markup — matching dashboard formula
            const markupForLabor = avgMarkup > 0 ? avgMarkup : 1;
            const laborTotal = entries.reduce((sum, e) => sum + e.labor_cost, 0);
            const managerTotal = entries.reduce((sum, e) => sum + e.manager_daily_cost, 0);
            setTotalLaborFromDaily((laborTotal + managerTotal) * markupForLabor);
          }
        } else {
          setDailyLaborEntries([]);
          setTotalLaborFromDaily(0);
        }
      } catch (error) {
        console.error("Error fetching expenses data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    return () => { stale = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- transformInvoicesData is a plain function (not stateful), defined below; adding it would require memoization for no benefit.
  }, [selectedBusinesses, dateRange, activeTab, refreshTrigger]);

  // Transform raw invoice data to display format
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transformInvoicesData = (rawData: any[]): InvoiceDisplay[] => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rawData.map((inv: any) => {
      // Build linked payments from joined data — grouped by payment ID
      const linkedPayments: InvoiceDisplay["linkedPayments"] = [];
      const seenPids = new Set<string>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allPays: any[] = [];
      if (inv.payments && Array.isArray(inv.payments)) {
        for (const p of inv.payments) {
          if (!seenPids.has(p.id)) { seenPids.add(p.id); allPays.push(p); }
        }
      }
      if (inv.payment_invoice_links && Array.isArray(inv.payment_invoice_links)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const link of inv.payment_invoice_links as any[]) {
          const p = link.payment;
          if (p && !seenPids.has(p.id)) { seenPids.add(p.id); allPays.push(p); }
        }
      }
      if (allPays.length > 0) {
        for (const payment of allPays) {
          const paymentReceipt = payment.receipt_url || null;
          if (payment.payment_splits && Array.isArray(payment.payment_splits)) {
            for (const split of payment.payment_splits) {
              linkedPayments.push({
                id: `${payment.id}-${split.id || split.payment_method}`,
                paymentId: payment.id,
                amount: Number(split.amount),
                method: paymentMethodNames[split.payment_method] || "אחר",
                date: formatDateString(split.due_date || payment.payment_date),
                checkNumber: split.check_number || "",
                installmentNumber: split.installment_number || null,
                installmentsCount: split.installments_count || null,
                referenceNumber: split.reference_number || "",
                creditCardId: split.credit_card_id || null,
                receiptUrl: paymentReceipt,
              });
            }
          }
        }
      }

      return {
        id: inv.id,
        date: formatDateString(inv.invoice_date),
        rawDate: inv.invoice_date ? toLocalDateStr(new Date(inv.invoice_date)) : "",
        supplier: inv.supplier?.name || "לא ידוע",
        reference: inv.invoice_number || "",
        amount: Number(inv.total_amount),
        amountWithVat: Number(inv.total_amount),
        amountBeforeVat: Number(inv.subtotal),
        status: inv.status === "paid" ? "שולם" : inv.status === "clarification" ? "בבירור" : "ממתין",
        statusRaw: inv.status || "pending",
        enteredBy: inv.creator?.full_name || "מערכת",
        entryDate: formatDateString(inv.created_at),
        notes: inv.notes || "",
        attachmentUrl: inv.attachment_url || null,
        attachmentUrls: parseAttachmentUrls(inv.attachment_url),
        clarificationReason: inv.clarification_reason || null,
        isFixed: inv.supplier?.is_fixed_expense || false,
        approval_status: inv.approval_status || null,
        referenceDate: inv.reference_date ? formatDateString(inv.reference_date) : null,
        linkedPayments,
        linkedDeliveryNotes: [],
        documentType: inv._documentType || "invoice",
        invoiceType: inv.invoice_type || undefined,
        consolidatedReference: inv.consolidated_reference || null,
        isConsolidated: !!inv.is_consolidated,
      };
    });
  };

  // Load more invoices (infinite scroll)
  const loadMoreInvoices = useCallback(async () => {
    if (isLoadingMore || !hasMoreInvoices || selectedBusinesses.length === 0) return;
    setIsLoadingMore(true);
    const supabase = createClient();
    try {
      const formatLocalDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const startDate = formatLocalDate(dateRange.start);
      const endDate = formatLocalDate(dateRange.end);
      const { data } = await supabase
        .from("invoices")
        .select(`
          *,
          supplier:suppliers(id, name, expense_category_id, is_fixed_expense),
          creator:profiles!invoices_created_by_fkey(full_name),
          payments!payments_invoice_id_fkey(id, payment_date, total_amount, receipt_url, payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id)),
          payment_invoice_links(payment:payments(id, payment_date, total_amount, receipt_url, payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id)))
        `)
        .in("business_id", selectedBusinesses)
        .is("deleted_at", null)
        .gte("reference_date", startDate)
        .lte("reference_date", endDate)
        .order("reference_date", { ascending: false })
        .range(invoicesOffset, invoicesOffset + INVOICES_PAGE_SIZE - 1);

      const newInvoices = transformInvoicesData(data || []);
      setRecentInvoices(prev => [...prev, ...newInvoices]);
      setInvoicesOffset(prev => prev + newInvoices.length);
      setHasMoreInvoices(newInvoices.length >= INVOICES_PAGE_SIZE);
    } catch (error) {
      console.error("Error loading more invoices:", error);
    } finally {
      setIsLoadingMore(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- transformInvoicesData is a plain function (not stateful); adding it would require wrapping in useCallback for no benefit.
  }, [isLoadingMore, hasMoreInvoices, selectedBusinesses, invoicesOffset, activeTab, dateRange]);

  // Scroll handler for infinite scroll
  const handleInvoicesScroll = useCallback(() => {
    const el = invoicesListRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      loadMoreInvoices();
    }
  }, [loadMoreInvoices]);

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

  // Live duplicate-invoice detection (same business + supplier + invoice_number)
  useEffect(() => {
    setDuplicateWarning(null);
    const num = invoiceNumber.trim();
    if (!num || !selectedSupplier || selectedBusinesses.length === 0) return;
    if (linkToCoordinator || linkToFixedInvoiceId) return;
    const timer = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("invoices")
        .select("id")
        .eq("business_id", selectedBusinesses[0])
        .eq("supplier_id", selectedSupplier)
        .eq("invoice_number", num)
        .limit(1);
      if (data && data.length > 0) {
        const supplierName = suppliers.find(s => s.id === selectedSupplier)?.name || "הספק";
        setDuplicateWarning(`כבר קיימת חשבונית עם מספר ${num} לספק ${supplierName}`);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [invoiceNumber, selectedSupplier, selectedBusinesses, linkToCoordinator, linkToFixedInvoiceId, suppliers]);

  // Calculate VAT and total
  // Save expense form draft
  const saveExpenseDraftData = useCallback(() => {
    if (!showAddExpensePopup) return;
    saveExpenseDraft({
      expenseDate, referenceDate, expenseType, selectedSupplier, invoiceNumber,
      amountBeforeVat, partialVat, vatAmount, notes,
      isPaidInFull, needsClarification, clarificationReason,
      paymentMethod, paymentDate, paymentInstallments, paymentReference, paymentNotes,
      popupPaymentMethods,
    });
  }, [saveExpenseDraft, showAddExpensePopup,
    expenseDate, referenceDate, expenseType, selectedSupplier, invoiceNumber,
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
          if (draft.referenceDate) {
            setReferenceDate(draft.referenceDate as string);
            referenceDateManuallySet.current = (draft.referenceDate as string) !== (draft.expenseDate as string);
          } else if (draft.expenseDate) {
            setReferenceDate(draft.expenseDate as string);
          }
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

  const calculatedVat = partialVat ? parseFloat(vatAmount) || 0 : (parseFloat(amountBeforeVat) || 0) * businessVatRate;
  const totalWithVat = (parseFloat(amountBeforeVat) || 0) + calculatedVat;

  // Chart data source: categories for expenses/employees tabs, suppliers for purchases tab
  // When categories are expanded, replace them with their suppliers in the chart
  // Always sorted by amount descending for clear chart readability
  const chartDataSource = useMemo(() => {
    if (activeTab === "purchases") return [...expensesData].sort((a, b) => b.amount - a.amount);

    if (activeTab === "employees") {
      // Employees tab: combine invoice-based data (categoryData) + daily labor total
      const result: { id: string; amount: number; percentage: number; name?: string; category?: string }[] = [];
      // Add daily labor as a single combined item if it exists
      if (totalLaborFromDaily > 0) {
        result.push({ id: "__daily_labor__", amount: totalLaborFromDaily, percentage: totalSalesBeforeVat > 0 ? (totalLaborFromDaily / totalSalesBeforeVat) * 100 : 0, name: "מילוי יומי" });
      }
      // Add invoice-based employee expense categories
      for (const cat of categoryData) {
        result.push({ ...cat, percentage: totalSalesBeforeVat > 0 ? (cat.amount / totalSalesBeforeVat) * 100 : 0 });
      }
      result.sort((a, b) => b.amount - a.amount);
      return result;
    }

    if (expandedCategoryIds.length === 0) return [...categoryData].sort((a, b) => b.amount - a.amount);

    // Build mixed chart: non-expanded categories + suppliers from expanded categories
    const result: { id: string; amount: number; percentage: number; name?: string; category?: string }[] = [];
    for (const cat of categoryData) {
      if (expandedCategoryIds.includes(cat.id) && cat.suppliers.length > 0) {
        // Replace this category with its individual suppliers
        for (const sup of cat.suppliers) {
          result.push({ id: sup.id, amount: sup.amount, percentage: 0, name: sup.name });
        }
      } else {
        result.push({ ...cat, percentage: 0 });
      }
    }
    // Recalculate percentages relative to sales before VAT (% מפדיון)
    for (const item of result) {
      item.percentage = totalSalesBeforeVat > 0 ? (item.amount / totalSalesBeforeVat) * 100 : 0;
    }
    // Sort by amount descending for clear chart readability
    result.sort((a, b) => b.amount - a.amount);
    return result;
  }, [activeTab, expensesData, categoryData, expandedCategoryIds, totalSalesBeforeVat, totalLaborFromDaily]);

  const totalExpenses = chartDataSource.reduce((sum, item) => sum + item.amount, 0);

  // Chart colors - used in both chart and table
  const chartColors = ["#FF2D55", "#00D68F", "#3366FF", "#FF9500", "#AF52DE", "#FFD600", "#00BCD4", "#FF4081", "#7C4DFF", "#00E676", "#FF6D00", "#2979FF", "#E91E63", "#00BFA5", "#FF3D00", "#651FFF", "#C6FF00", "#F50057", "#1DE9B6", "#D500F9"];

  // Active index for interactive donut chart hover
  const [activeExpenseIndex, setActiveExpenseIndex] = useState<number | undefined>(undefined);

  // Recharts data with colors
  const rechartsExpenseData = useMemo(() => {
    return chartDataSource.map((item, index) => ({
      ...item,
      displayName: (item as { name?: string }).name || (item as { category?: string }).category || "",
      fill: chartColors[index % chartColors.length],
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- chartColors is a static array defined outside the memo; it never changes.
  }, [chartDataSource]);

  // Custom shape renderer for donut chart — use activeExpenseIndex from state instead of Recharts' internal isActive
  const renderDonutShape = (props: PieSectorDataItem & { isActive: boolean; index: number }) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, index, payload, percent } = props as PieSectorDataItem & {
      isActive: boolean; index: number; payload: { displayName: string; amount: number }; percent: number;
    };
    const isActive = activeExpenseIndex === index;

    // Calculate label position at the middle of the arc (always on the colored segment)
    const pct = ((percent as number) * 100);
    const showLabel = pct >= 5;
    const midAngleDeg = (startAngle + endAngle) / 2;
    const midAngleRad = midAngleDeg * (Math.PI / 180);
    const midRadius = ((innerRadius as number) + (outerRadius as number)) / 2;
    const labelX = (cx as number) + midRadius * Math.cos(midAngleRad);
    const labelY = (cy as number) - midRadius * Math.sin(midAngleRad);

    if (!isActive) {
      return (
        <g>
          <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius} startAngle={startAngle} endAngle={endAngle} fill={fill} />
          {showLabel && (
            <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="central"
              fill="#fff" fontSize={11} fontWeight="bold" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
              {`${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2)}%`}
            </text>
          )}
        </g>
      );
    }

    return (
      <g>
        <Sector cx={cx} cy={cy} innerRadius={(innerRadius as number) - 4} outerRadius={(outerRadius as number) + 8}
          startAngle={startAngle} endAngle={endAngle} fill={fill} />
        <Sector cx={cx} cy={cy} innerRadius={(outerRadius as number) + 12} outerRadius={(outerRadius as number) + 16}
          startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.4} />
        <text x={cx} y={cy - 22} textAnchor="middle" fill="#fff" fontSize={14} fontWeight="bold">
          {payload.displayName}
        </text>
        <text x={cx} y={cy + 2} textAnchor="middle" fill="#fff" fontSize={24} fontWeight="bold" direction="ltr">
          {`₪${payload.amount % 1 === 0 ? payload.amount.toLocaleString("he-IL", { maximumFractionDigits: 0 }) : payload.amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        </text>
        <text x={cx} y={cy + 24} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize={14}>
          {`${((percent as number) * 100) % 1 === 0 ? ((percent as number) * 100).toFixed(0) : ((percent as number) * 100).toFixed(2)}%`}
        </text>
      </g>
    );
  };

  // Handle supplier selection - auto-set VAT based on supplier's vat_type
  const handleSupplierChange = useCallback(async (supplierId: string) => {
    setSelectedSupplier(supplierId);
    setLinkToCoordinator(false);
    setFixedOpenInvoices([]);
    setLinkToFixedInvoiceId(null);
    setShowFixedInvoices(false);
    if (!supplierId) return;
    const supplier = suppliers.find(s => s.id === supplierId);
    if (!supplier) return;
    // Auto-set expense type based on supplier
    if (supplier.expense_type === "goods_purchases") {
      setExpenseType("goods");
    } else if (supplier.expense_type === "employee_costs") {
      setExpenseType("employees");
    } else {
      setExpenseType("current");
    }
    if (supplier.vat_type === "none") {
      setPartialVat(true);
      setVatAmount("0");
    } else if (supplier.vat_type === "full" || !supplier.vat_type) {
      setPartialVat(false);
      setVatAmount("");
    }
    // For "partial" vat_type, keep current state - user enters manually

    // For fixed expense suppliers - fetch pending invoices to allow linking
    if (supplier.is_fixed_expense && selectedBusinesses.length > 0) {
      const supabase = createClient();
      const { data: openInvs } = await supabase
        .from("invoices")
        .select("id, invoice_date, subtotal, total_amount")
        .eq("business_id", selectedBusinesses[0])
        .eq("supplier_id", supplierId)
        .eq("status", "pending")
        .is("deleted_at", null)
        .order("invoice_date", { ascending: false });

      if (openInvs && openInvs.length > 0) {
        const mapped = openInvs.map(inv => {
          const d = new Date(inv.invoice_date);
          const monthNames = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
          return {
            id: inv.id,
            invoice_date: inv.invoice_date,
            subtotal: Number(inv.subtotal),
            total_amount: Number(inv.total_amount),
            month: `חודש ${monthNames[d.getMonth()]}, ${d.getFullYear()}`,
          };
        });
        setFixedOpenInvoices(mapped);
        setShowFixedInvoices(true);
      }
    }
  }, [suppliers, selectedBusinesses]);

  // Reset line items when expense type changes away from goods
  useEffect(() => {
    if (expenseType !== 'goods') {
      setExpenseLineItems([]);
      setShowLineItems(false);
      setLineItemsPriceCheckDone(false);
    }
  }, [expenseType]);

  // Fetch price comparisons when supplier changes and line items exist
  useEffect(() => {
    const businessId = selectedBusinesses[0];
    if (!selectedSupplier || !businessId || expenseLineItems.length === 0) {
      setLineItemsPriceCheckDone(false);
      return;
    }

    const checkPrices = async () => {
      const supabase = createClient();
      const { data: supplierItemsData } = await supabase
        .from('supplier_items')
        .select('id, item_name, item_aliases, current_price')
        .eq('business_id', businessId)
        .eq('supplier_id', selectedSupplier)
        .eq('is_active', true);

      if (!supplierItemsData) {
        setLineItemsPriceCheckDone(true);
        return;
      }

      const updated = expenseLineItems.map((li) => {
        const desc = (li.description || '').trim().toLowerCase();
        if (!desc) return li;

        const match = supplierItemsData.find((si) => {
          const nameMatch = si.item_name.toLowerCase() === desc;
          const aliasMatch = (si.item_aliases || []).some(
            (a: string) => a.toLowerCase() === desc
          );
          const partialMatch =
            si.item_name.toLowerCase().includes(desc) || desc.includes(si.item_name.toLowerCase());
          return nameMatch || aliasMatch || partialMatch;
        });

        if (match && match.current_price != null && li.unit_price != null) {
          const priceDiff = li.unit_price - match.current_price;
          const changePct = match.current_price > 0
            ? (priceDiff / match.current_price) * 100
            : 0;
          return {
            ...li,
            matched_supplier_item_id: match.id,
            previous_price: match.current_price,
            price_change_pct: Math.abs(changePct) < 0.01 ? 0 : changePct,
            is_new_item: false,
          };
        }

        return { ...li, is_new_item: true, matched_supplier_item_id: undefined, previous_price: undefined, price_change_pct: undefined };
      });

      setExpenseLineItems(updated);
      setLineItemsPriceCheckDone(true);
    };

    checkPrices();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSupplier, selectedBusinesses, expenseLineItems.length]);

  // Process OCR on uploaded file and populate form fields
  const processOcr = useCallback(async (file: File) => {
    setIsOcrProcessing(true);
    setOcrProcessingStep("מעלה את הקובץ...");
    try {
      // Convert unsupported formats client-side before sending to server
      let fileToSend = file;
      const isPdf = file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf");
      const isAvifOrHeic = /\.(avif|heic|heif)$/i.test(file.name?.toLowerCase() || "") ||
        ["image/avif", "image/heic", "image/heif"].includes(file.type);

      if (isPdf) {
        setOcrProcessingStep("ממיר PDF לתמונה...");
        try {
          fileToSend = await convertPdfToImage(file);
        } catch (pdfErr) {
          console.warn("[OCR] PDF to image conversion failed, sending as-is:", pdfErr);
        }
      } else if (isAvifOrHeic) {
        // Convert AVIF/HEIC to JPEG client-side using canvas (browser handles decoding)
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
      fd.append("suppliers", JSON.stringify(suppliers.map((s) => ({ id: s.id, name: s.name }))));

      setOcrProcessingStep("סורק טקסט מהמסמך...");

      // Timeout after 60 seconds
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const res = await fetch("/api/ai/ocr-extract", { method: "POST", body: fd, signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[OCR] Server error detail:", err.detail || err.error);
        throw new Error(err.error || "OCR failed");
      }

      setOcrProcessingStep("מחלץ נתונים...");
      const data = await res.json();

      // Check if OCR couldn't read the document — let user fill manually
      if (data.ocr_failed) {
        showToast("לא הצלחנו לזהות טקסט מהמסמך — ניתן למלא את הפרטים ידנית", "info");
        setOcrApplied(true);
      } else {
        // Populate form fields from extracted data
        setOcrProcessingStep("ממלא שדות בטופס...");
        if (data.document_date) {
          setExpenseDate(data.document_date);
          if (!referenceDateManuallySet.current) {
            setReferenceDate(data.document_date);
          }
        }
        if (data.document_number) setInvoiceNumber(data.document_number);
        if (data.subtotal != null) setAmountBeforeVat(data.subtotal.toString());
        if (data.vat_amount != null) {
          const expectedVat = (data.subtotal || 0) * 0.18;
          if (Math.abs(data.vat_amount - expectedVat) > 0.5) {
            setPartialVat(true);
            setVatAmount(data.vat_amount.toString());
          }
        }
        if (data.matched_supplier_id) {
          setSelectedSupplier(data.matched_supplier_id);
          // Auto-set expense type from supplier
          const matchedSup = suppliers.find(s => s.id === data.matched_supplier_id);
          if (matchedSup?.expense_type === "goods_purchases") setExpenseType("goods");
          else if (matchedSup?.expense_type === "employee_costs") setExpenseType("employees");
          else if (matchedSup?.expense_type) setExpenseType("current");
        }
        if (data.line_items && data.line_items.length > 0) {
          setExpenseLineItems(data.line_items);
          setShowLineItems(true);
        }

        setOcrApplied(true);
        showToast("נתונים זוהו מהמסמך בהצלחה", "success");
      }
    } catch (err) {
      console.error("OCR extraction error:", err);
      const msg = err instanceof DOMException && err.name === "AbortError"
        ? "הזיהוי נכשל — חרג מזמן המתנה (60 שניות)"
        : `לא הצלחנו לזהות נתונים: ${err instanceof Error ? err.message : "שגיאה לא ידועה"}`;
      showToast("לא הצלחנו לזהות את המסמך — ניתן למלא את הפרטים ידנית", "info");
      setOcrApplied(true);
      // Report OCR failure to DB
      try {
        const supabaseForLog = createClient();
        const { data: { user: logUser } } = await supabaseForLog.auth.getUser();
        await supabaseForLog.from("client_error_logs").insert({
          user_id: logUser?.id || null,
          business_id: selectedBusinesses[0] || null,
          action: "ocr_failed",
          error_message: msg,
          error_details: { fileName: file.name, fileType: file.type, fileSize: file.size },
          page: "expenses",
        });
      } catch { /* ignore */ }
    } finally {
      setIsOcrProcessing(false);
      setOcrProcessingStep("");
    }
  }, [suppliers, showToast, selectedBusinesses]);

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
      // Check if business is active
      const { data: bizCheck } = await supabase.from("businesses").select("status").eq("id", selectedBusinesses[0]).single();
      if (bizCheck?.status !== "active") {
        showToast("לא ניתן להוסיף הוצאות לעסק לא פעיל", "error");
        setIsSaving(false);
        return;
      }

      // Duplicate invoice-number check (same business + supplier + invoice_number)
      if (invoiceNumber && invoiceNumber.trim() && !linkToCoordinator && !linkToFixedInvoiceId && !duplicateProceedRef.current) {
        const { data: duplicates } = await supabase
          .from("invoices")
          .select("id")
          .eq("business_id", selectedBusinesses[0])
          .eq("supplier_id", selectedSupplier)
          .eq("invoice_number", invoiceNumber.trim())
          .limit(1);
        if (duplicates && duplicates.length > 0) {
          setIsSaving(false);
          setDuplicateInvoicePrompt({ invoiceNumber: invoiceNumber.trim() });
          return;
        }
      }
      duplicateProceedRef.current = null;

      const { data: { user } } = await supabase.auth.getUser();

      // Check if user chose to link to coordinator (מרכזת) - save as delivery note instead
      if (linkToCoordinator) {
        // For coordinator suppliers, save ONLY as delivery note (תעודת משלוח)
        // No invoice is created - will be created later when closing the coordinator
        const { data: newDeliveryNote, error: deliveryNoteError } = await supabase
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
            created_by: user?.id || null,
          })
          .select()
          .single();

        if (deliveryNoteError) {
          console.error("[Save Expense] Delivery note insert error:", deliveryNoteError);
          throw deliveryNoteError;
        }
        if (!newDeliveryNote) {
          console.error("[Save Expense] Delivery note insert returned null without error");
          throw new Error("לא התקבל מזהה תעודת משלוח מהשרת");
        }

        // Upload attachments for delivery note
        if (newAttachmentFiles.length > 0) {
          setIsUploadingAttachment(true);
          const uploadedUrls: string[] = [];
          for (const file of newAttachmentFiles) {
            const fileExt = file.name.split('.').pop();
            const fileName = `${newDeliveryNote.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${fileExt}`;
            const filePath = `delivery-notes/${fileName}`;
            const result = await uploadFile(file, filePath, "attachments");
            if (result.success && result.publicUrl) {
              uploadedUrls.push(result.publicUrl);
            }
          }
          setIsUploadingAttachment(false);
          if (uploadedUrls.length > 0) {
            const attachmentValue = uploadedUrls.length === 1 ? uploadedUrls[0] : JSON.stringify(uploadedUrls);
            const { error: attachErr } = await supabase.from("delivery_notes").update({ attachment_url: attachmentValue }).eq("id", newDeliveryNote.id);
            if (attachErr) console.error("[Save Expense] Attachment update error:", attachErr);
          }
        }

        // Price tracking: save line item prices for delivery notes too
        if (expenseType === 'goods' && newDeliveryNote && expenseLineItems.length > 0 && selectedSupplier) {
          await savePriceTrackingForLineItems(supabase, {
            businessId: selectedBusinesses[0],
            supplierId: selectedSupplier,
            invoiceId: null, // delivery note — no invoice FK
            documentDate: expenseDate,
            lineItems: expenseLineItems,
          });
        }

        showToast("תעודת המשלוח נשמרה בהצלחה", "success");
      } else if (linkToFixedInvoiceId) {
        // Link to existing fixed expense invoice — update it with real data
        // IMPORTANT: Do NOT change invoice_date — preserve original month from auto-generation
        const { data: updatedInvoice, error: updateError } = await supabase
          .from("invoices")
          .update({
            invoice_number: invoiceNumber || null,
            reference_date: referenceDate || null,
            subtotal: parseFloat(amountBeforeVat),
            vat_amount: calculatedVat,
            total_amount: totalWithVat,
            status: isPaidInFull ? "paid" : needsClarification ? "clarification" : "pending",
            notes: notes || null,
            created_by: user?.id || null,
            clarification_reason: needsClarification ? clarificationReason : null,
          })
          .eq("id", linkToFixedInvoiceId)
          .select()
          .single();

        if (updateError) throw updateError;

        // Use updatedInvoice as newInvoice for downstream logic (attachments, payments)
        const newInvoice = updatedInvoice;

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
            const { error: attachErr } = await supabase.from("invoices").update({ attachment_url: attachmentValue }).eq("id", newInvoice.id);
            if (attachErr) console.error("[Save Expense] Fixed invoice attachment update error:", attachErr);
          }
        }

        // If paid in full, create payment record
        if (isPaidInFull && newInvoice) {
          const paymentTotal = popupPaymentMethods.reduce((sum, pm) => {
            return sum + (parseFloat(pm.amount.replace(/[^\d.-]/g, "")) || 0);
          }, 0);

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

          if (!paymentError && newPayment) {
            for (const pm of popupPaymentMethods) {
              const pmAmount = parseFloat(pm.amount.replace(/[^\d.-]/g, "")) || 0;
              if (pmAmount > 0 && pm.method) {
                const installmentsCount = parseInt(pm.installments) || 1;
                if (pm.customInstallments.length > 0) {
                  for (const inst of pm.customInstallments) {
                    await supabase.from("payment_splits").insert({
                      payment_id: newPayment.id,
                      payment_method: pm.method,
                      amount: inst.amount,
                      installments_count: installmentsCount,
                      installment_number: inst.number,
                      reference_number: paymentReference || null,
                      check_number: pm.method === "check" ? (inst.checkNumber || pm.checkNumber || null) : null,
                      due_date: inst.dateForInput || paymentDate || expenseDate || null,
                    });
                  }
                } else {
                  await supabase.from("payment_splits").insert({
                    payment_id: newPayment.id,
                    payment_method: pm.method,
                    amount: pmAmount,
                    installments_count: installmentsCount,
                    due_date: paymentDate || expenseDate || null,
                    reference_number: paymentReference || null,
                    check_number: pm.method === "check" ? pm.checkNumber || null : null,
                  });
                }
              }
            }
          }
        }

        showToast("החשבונית עודכנה בהצלחה", "success");
      } else {
        // Regular supplier - create invoice as usual
        const { data: newInvoice, error: invoiceError } = await supabase
          .from("invoices")
          .insert({
            business_id: selectedBusinesses[0], // Use first selected business
            supplier_id: selectedSupplier,
            invoice_number: invoiceNumber || null,
            invoice_date: expenseDate,
            reference_date: referenceDate || null,
            subtotal: parseFloat(amountBeforeVat),
            vat_amount: calculatedVat,
            total_amount: totalWithVat,
            status: isPaidInFull ? "paid" : needsClarification ? "clarification" : "pending",
            notes: notes || null,
            created_by: user?.id || null,
            invoice_type: expenseType,
            clarification_reason: needsClarification ? clarificationReason : null,
            ...(ocrApplied ? { approval_status: 'pending_review', data_source: 'ocr' } : {}),
          })
          .select()
          .single();

        if (invoiceError) {
          console.error("[Save Expense] Invoice insert error:", invoiceError);
          throw invoiceError;
        }
        if (!newInvoice) {
          console.error("[Save Expense] Invoice insert returned null without error");
          throw new Error("לא התקבל מזהה חשבונית מהשרת");
        }

        // Upload attachments if any
        if (newAttachmentFiles.length > 0) {
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
            const { error: attachErr } = await supabase.from("invoices").update({ attachment_url: attachmentValue }).eq("id", newInvoice.id);
            if (attachErr) console.error("[Save Expense] Invoice attachment update error:", attachErr);
          }
        }

        // If paid in full, create payment record with all payment methods
        if (isPaidInFull && newInvoice) {
          const paymentTotal = popupPaymentMethods.reduce((sum, pm) => {
            return sum + (parseFloat(pm.amount.replace(/[^\d.-]/g, "")) || 0);
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
              const amount = parseFloat(pm.amount.replace(/[^\d.-]/g, "")) || 0;
              if (amount > 0 && pm.method) {
                const installmentsCount = parseInt(pm.installments) || 1;

                const creditCardId = pm.method === "credit_card" && pm.creditCardId ? pm.creditCardId : null;
                const card = creditCardId ? businessCreditCards.find(c => c.id === creditCardId) : null;

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
                        check_number: pm.method === "check" ? (inst.checkNumber || pm.checkNumber || null) : null,
                        credit_card_id: creditCardId,
                        due_date: inst.dateForInput || paymentDate || expenseDate || null,
                      });
                  }
                } else {
                  // Trust the user-chosen payment date as-is. getSmartPaymentDate
                  // already applied the billing-day adjustment when the card was
                  // picked, and any subsequent manual edit is the user's
                  // explicit intent (e.g. foreign services that charge
                  // immediately rather than on a card's billing cycle).
                  // Re-running calculateCreditCardDueDate here double-shifts.
                  const dueDate = paymentDate || expenseDate || null;

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
                      credit_card_id: creditCardId,
                      due_date: dueDate,
                    });
                }
              }
            }
          }
        }

        // Price tracking: save line item prices for goods expenses
        if (expenseType === 'goods' && newInvoice && expenseLineItems.length > 0 && selectedSupplier) {
          await savePriceTrackingForLineItems(supabase, {
            businessId: selectedBusinesses[0],
            supplierId: selectedSupplier,
            invoiceId: newInvoice.id,
            documentDate: expenseDate,
            lineItems: expenseLineItems,
          });
        }

        showToast("ההוצאה נשמרה בהצלחה", "success");

        // Check budget excess and send alert (fire-and-forget)
        if (newInvoice && selectedSupplier) {
          fetch("/api/budget-alert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              business_id: selectedBusinesses[0],
              supplier_id: selectedSupplier,
              invoice_subtotal: parseFloat(amountBeforeVat),
            }),
          }).catch((err) => console.warn("[Budget Alert] Failed:", err));
        }
      }

      // Switch to the correct tab so the new expense is visible
      const targetTab = expenseType === "current" ? "expenses" : expenseType === "goods" ? "purchases" : "employees";

      // Close popup and clear form first
      clearExpenseDraft();
      handleClosePopup();

      // Use setTimeout to ensure state updates from handleClosePopup are flushed
      // before triggering the re-fetch. This fixes mobile not refreshing after save.
      setTimeout(() => {
        if (activeTab !== targetTab) {
          setActiveTab(targetTab as "expenses" | "purchases" | "employees");
        }
        setRefreshTrigger(t => t + 1);
      }, 100);
    } catch (error: unknown) {
      console.error("[Save Expense] Full error:", error);
      const errMsg = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: string }).message) : "שגיאה לא ידועה";
      showToast(`שגיאה בשמירת ההוצאה: ${errMsg}`, "error");
      // Report error to DB for remote debugging
      try {
        const supabaseForLog = createClient();
        const { data: { user: logUser } } = await supabaseForLog.auth.getUser();
        await supabaseForLog.from("client_error_logs").insert({
          user_id: logUser?.id || null,
          business_id: selectedBusinesses[0] || null,
          action: "save_expense",
          error_message: errMsg,
          error_details: {
            supplier: selectedSupplier,
            expenseType,
            amount: amountBeforeVat,
            date: expenseDate,
            hasFiles: newAttachmentFiles.length > 0,
            isPaidInFull,
            linkToCoordinator,
            linkToFixedInvoiceId,
            rawError: String(error),
          },
          page: "expenses",
        });
      } catch { /* ignore logging errors */ }
    } finally {
      setIsSaving(false);
    }
  };

  const handleClosePopup = () => {
    setShowAddExpensePopup(false);
    // Reset form
    const today = toLocalDateStr(new Date());
    setExpenseDate(today);
    setReferenceDate(today);
    referenceDateManuallySet.current = false;
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
    setLinkToCoordinator(false);
    setFixedOpenInvoices([]);
    setLinkToFixedInvoiceId(null);
    setShowFixedInvoices(false);
    setPaymentMethod("");
    setPaymentDate("");
    setPaymentInstallments(1);
    setPaymentReference("");
    setPaymentNotes("");
    setPaymentReceiptFile(null);
    setPaymentReceiptPreview(null);
    setNewAttachmentFiles([]);
    setNewAttachmentPreviews([]);
    setIsOcrProcessing(false);
    setOcrApplied(false);
    setPopupPaymentMethods([{ id: 1, method: "", amount: "", installments: "1", checkNumber: "", creditCardId: "", customInstallments: [] }]);
    setShowClarificationMenu(false);
    setExpenseLineItems([]);
    setShowLineItems(false);
    setLineItemsPriceCheckDone(false);
    setNewLineItemDesc('');
    setNewLineItemQty('');
    setNewLineItemPrice('');
  };

  // Handle opening edit popup
  const handleEditInvoice = (invoice: InvoiceDisplay) => {
    setEditingInvoice(invoice);
    setEditStatus(invoice.statusRaw || '');
    // Pre-fill form with invoice data
    // Convert date from display format (DD.MM.YY) to input format (YYYY-MM-DD)
    const dateParts = invoice.date.split('.');
    if (dateParts.length === 3) {
      const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];
      setExpenseDate(`${year}-${dateParts[1]}-${dateParts[0]}`);
    }
    // Find supplier ID by name and set expense type + VAT based on supplier
    const supplier = suppliers.find(s => s.name === invoice.supplier);
    setSelectedSupplier(supplier?.id || "");
    if (supplier?.expense_type === "goods_purchases") setExpenseType("goods");
    else if (supplier?.expense_type === "employee_costs") setExpenseType("employees");
    else setExpenseType("current");
    // Pre-fill VAT from the existing invoice; enable manual mode when the saved VAT differs from auto-calc.
    const existingVat = Math.max(0, (invoice.amountWithVat || 0) - (invoice.amountBeforeVat || 0));
    const autoCalcVat = (invoice.amountBeforeVat || 0) * businessVatRate;
    const vatMismatch = Math.abs(existingVat - autoCalcVat) > 0.01;
    if (supplier?.vat_type === "none" || vatMismatch) {
      setPartialVat(true);
      setVatAmount(existingVat.toFixed(2));
    } else {
      setPartialVat(false);
      setVatAmount("");
    }
    setInvoiceNumber(invoice.reference);
    setAmountBeforeVat(invoice.amountBeforeVat.toString());
    setNotes(invoice.notes);
    setClarificationReason(invoice.clarificationReason || "");
    // Set reference date (convert from DD.MM.YY display format to YYYY-MM-DD)
    if (invoice.referenceDate) {
      const refParts = invoice.referenceDate.split('.');
      if (refParts.length === 3) {
        const refYear = refParts[2].length === 2 ? `20${refParts[2]}` : refParts[2];
        setReferenceDate(`${refYear}-${refParts[1]}-${refParts[0]}`);
      }
      referenceDateManuallySet.current = true;
    } else {
      // Default to invoice date
      const dateParts2 = invoice.date.split('.');
      if (dateParts2.length === 3) {
        const year2 = dateParts2[2].length === 2 ? `20${dateParts2[2]}` : dateParts2[2];
        setReferenceDate(`${year2}-${dateParts2[1]}-${dateParts2[0]}`);
      }
      referenceDateManuallySet.current = false;
    }
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
      const calculatedVatEdit = partialVat ? parseFloat(vatAmount) || 0 : (parseFloat(amountBeforeVat) || 0) * businessVatRate;
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
        reference_date: referenceDate || null,
        subtotal: parseFloat(amountBeforeVat),
        vat_amount: calculatedVatEdit,
        total_amount: totalWithVatEdit,
        notes: notes || null,
        invoice_type: expenseType,
        attachment_url: attachmentUrl,
      };

      // Update clarification reason if editing a "בבירור" invoice
      if (editingInvoice.status === "בבירור" || editStatus === "clarification") {
        updateData.clarification_reason = clarificationReason || null;
      }

      // Apply status from edit form
      if (editStatus) {
        updateData.status = editStatus;
      } else if (editingInvoice.isFixed && attachmentUrl && invoiceNumber) {
        updateData.status = "pending";
      }

      const { error } = await supabase
        .from("invoices")
        .update(updateData)
        .eq("id", editingInvoice.id);

      if (error) throw error;

      // Sync linked payments: if invoice amount changed, update linked payment status
      const newTotalAmount = parseFloat(amountBeforeVat) * (1 + (calculatedVatEdit / parseFloat(amountBeforeVat) || 0));
      const oldTotalAmount = editingInvoice.amountWithVat;
      if (Math.abs(newTotalAmount - oldTotalAmount) > 0.01) {
        // Find payments linked to this invoice
        const { data: linkedPayments } = await supabase
          .from("payments")
          .select("id, total_amount")
          .eq("invoice_id", editingInvoice.id)
          .is("deleted_at", null);

        if (linkedPayments && linkedPayments.length > 0) {
          for (const payment of linkedPayments) {
            const paymentAmount = Number(payment.total_amount);
            const diff = Math.abs(paymentAmount - (updateData.total_amount as number));
            // If payment no longer matches invoice amount, revert invoice to pending
            if (diff > 5) {
              await supabase
                .from("invoices")
                .update({ status: "pending" })
                .eq("id", editingInvoice.id);
              showToast(`⚠️ סכום החשבונית השתנה — הסטטוס חזר ל"ממתין" כי התשלום המקושר (₪${paymentAmount.toLocaleString()}) כבר לא תואם`, "warning");
            }
          }
        }
      }

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
    // Navigate back to source page FIRST if came from deep-link (before closing popup)
    // This prevents the user from briefly seeing the expenses page
    if (editReturnTo) {
      const returnPath = editReturnTo;
      setEditReturnTo(null);
      router.push(returnPath);
      return;
    }
    setShowEditPopup(false);
    setEditingInvoice(null);
    // Reset form
    const today = toLocalDateStr(new Date());
    setExpenseDate(today);
    setReferenceDate(today);
    referenceDateManuallySet.current = false;
    setExpenseType("current");
    setSelectedSupplier("");
    setInvoiceNumber("");
    setAmountBeforeVat("");
    setPartialVat(false);
    setVatAmount("");
    setNotes("");
    setClarificationReason("");
    // Reset attachments
    setEditAttachmentFiles([]);
    setEditAttachmentPreviews([]);
  };

  // Handle deep-link edit from supplier card (?edit=invoiceId)
  useEffect(() => {
    if (typeof window === "undefined" || selectedBusinesses.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    if (!editId) return;

    // Store returnTo before clearing params
    const returnTo = params.get("returnTo");
    if (returnTo) setEditReturnTo(`/${returnTo}`);

    // Clear the query param immediately
    window.history.replaceState({}, "", "/expenses");

    const fetchAndEdit = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("invoices")
        .select(`
          *,
          supplier:suppliers(id, name, expense_category_id, is_fixed_expense),
          creator:profiles!invoices_created_by_fkey(full_name),
          payments!payments_invoice_id_fkey(id, payment_date, total_amount, receipt_url, payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id)),
          payment_invoice_links(payment:payments(id, payment_date, total_amount, receipt_url, payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id)))
        `)
        .eq("id", editId)
        .maybeSingle();

      if (data) {
        const invoice = transformInvoicesData([data])[0];
        handleEditInvoice(invoice);
      }
    };
    fetchAndEdit();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinesses]);

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
        const today = toLocalDateStr(new Date());
        setPaymentDate(today);
        setPaymentReference("");
        setPaymentNotes("");
        setPopupPaymentMethods([{
          id: 1,
          method: "",
          amount: invoice.amountWithVat.toString(),
          installments: "1",
          checkNumber: "",
          creditCardId: "",
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

      const invoice = recentInvoices.find(inv => inv.id === statusConfirm.invoiceId);

      // If moving away from "paid", hard-delete linked payments
      if (invoice?.status === 'שולם' && statusConfirm.newStatus !== 'paid') {
        await supabase
          .from("payments")
          .delete()
          .eq("invoice_id", statusConfirm.invoiceId);
      }

      const { error } = await supabase
        .from("invoices")
        .update(updateData)
        .eq("id", statusConfirm.invoiceId);

      if (error) throw error;

      // If moving TO "paid" and no payment exists yet, create a payment record
      // so the invoice is actually marked as paid with a payment trail.
      if (statusConfirm.newStatus === 'paid' && invoice && invoice.status !== 'שולם') {
        const { data: existingPayments } = await supabase
          .from("payments")
          .select("id")
          .eq("invoice_id", statusConfirm.invoiceId)
          .is("deleted_at", null)
          .limit(1);

        if (!existingPayments || existingPayments.length === 0) {
          const { data: { user } } = await supabase.auth.getUser();
          // Fetch supplier_id from the invoice
          const { data: invRow } = await supabase
            .from("invoices")
            .select("supplier_id, business_id, total_amount, subtotal, vat_amount")
            .eq("id", statusConfirm.invoiceId)
            .maybeSingle();

          if (invRow) {
            const todayStr = toLocalDateStr(new Date());
            const defaultMethod = suppliers.find(s => s.id === invRow.supplier_id)?.default_payment_method || "other";
            const { data: newPayment, error: paymentError } = await supabase
              .from("payments")
              .insert({
                business_id: invRow.business_id,
                supplier_id: invRow.supplier_id,
                invoice_id: statusConfirm.invoiceId,
                payment_date: todayStr,
                total_amount: invRow.total_amount,
                subtotal: invRow.subtotal,
                vat_amount: invRow.vat_amount,
                created_by: user?.id || null,
              })
              .select()
              .single();

            if (paymentError) {
              console.error("[Status Change] Failed to create payment:", paymentError);
              throw paymentError;
            }

            if (newPayment) {
              await supabase.from("payment_splits").insert({
                payment_id: newPayment.id,
                payment_method: defaultMethod,
                amount: invRow.total_amount,
                installments_count: 1,
                installment_number: 1,
                due_date: todayStr,
              });
            }
          }
        }
      }

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
      // If moving away from "paid", hard-delete linked payments
      const invoice = recentInvoices.find(inv => inv.id === clarificationInvoiceId);
      if (invoice?.status === 'שולם') {
        await supabase
          .from("payments")
          .delete()
          .eq("invoice_id", clarificationInvoiceId);
      }

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
        const pmTotal = parseFloat(pm.amount.replace(/[^\d.-]/g, "")) || 0;
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
        return sum + (parseFloat(pm.amount.replace(/[^\d.-]/g, "")) || 0);
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
          const amount = parseFloat(pm.amount.replace(/[^\d.-]/g, "")) || 0;
          if (amount > 0 && pm.method) {
            const installmentsCount = parseInt(pm.installments) || 1;
            const creditCardId = pm.method === "credit_card" && pm.creditCardId ? pm.creditCardId : null;
            const card = creditCardId ? businessCreditCards.find(c => c.id === creditCardId) : null;

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
                    check_number: pm.method === "check" ? (inst.checkNumber || pm.checkNumber || null) : null,
                    credit_card_id: creditCardId,
                    due_date: inst.dateForInput || paymentDate || null,
                  });
              }
            } else {
              // Single payment: persist the user's chosen date directly.
              // See the matching comment in the other save path — the
              // credit-card adjustment is already applied upstream via
              // getSmartPaymentDate; re-running it here was double-shifting.
              const dueDate = paymentDate || null;

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
                  credit_card_id: creditCardId,
                  due_date: dueDate,
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
    setPopupPaymentMethods([{ id: 1, method: "", amount: "", installments: "1", checkNumber: "", creditCardId: "", customInstallments: [] }]);
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

      const [{ data: invoicesData }, { data: deliveryNotesData }] = await Promise.all([
        supabase
          .from("invoices")
          .select(`
            *,
            supplier:suppliers(id, name, expense_category_id, is_fixed_expense),
            creator:profiles!invoices_created_by_fkey(full_name),
            payments!payments_invoice_id_fkey(id, payment_date, total_amount, receipt_url, payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id)),
            payment_invoice_links(payment:payments(id, payment_date, total_amount, receipt_url, payment_splits(id, payment_method, amount, installments_count, installment_number, due_date, check_number, reference_number, credit_card_id)))
          `)
          .in("business_id", selectedBusinesses)
          .eq("supplier_id", supplierId)
          .is("deleted_at", null)
          .gte("reference_date", startDate)
          .lte("reference_date", endDate)
          .order("reference_date", { ascending: false }),
        supabase
          .from("delivery_notes")
          .select(`
            *,
            supplier:suppliers(id, name, expense_category_id, is_fixed_expense),
            creator:profiles!delivery_notes_created_by_fkey(full_name)
          `)
          .in("business_id", selectedBusinesses)
          .eq("supplier_id", supplierId)
          .is("invoice_id", null)
          .gte("delivery_date", startDate)
          .lte("delivery_date", endDate)
          .order("delivery_date", { ascending: false }),
      ]);

      const displayInvoices: InvoiceDisplay[] = (invoicesData || []).map((inv: Invoice & { supplier: Supplier | null; creator: { full_name: string } | null }) => ({
        id: inv.id,
        date: formatDateString(inv.invoice_date),
        rawDate: inv.invoice_date ? toLocalDateStr(new Date(inv.invoice_date)) : "",
        supplier: inv.supplier?.name || "לא ידוע",
        reference: inv.invoice_number || "",
        amount: Number(inv.total_amount),
        amountWithVat: Number(inv.total_amount),
        amountBeforeVat: Number(inv.subtotal),
        status: inv.status === "paid" ? "שולם" : inv.status === "clarification" ? "בבירור" : "ממתין",
        statusRaw: inv.status || "pending",
        enteredBy: inv.creator?.full_name || "מערכת",
        entryDate: formatDateString(inv.created_at),
        notes: inv.notes || "",
        attachmentUrl: inv.attachment_url || null,
        attachmentUrls: parseAttachmentUrls(inv.attachment_url),
        clarificationReason: inv.clarification_reason || null,
        isFixed: inv.supplier?.is_fixed_expense || false,
        approval_status: inv.approval_status || null,
        referenceDate: inv.reference_date ? formatDateString(inv.reference_date) : null,
        linkedPayments: [],
        linkedDeliveryNotes: [],
        documentType: "invoice",
        invoiceType: inv.invoice_type || undefined,
        consolidatedReference: (inv as { consolidated_reference?: string | null }).consolidated_reference || null,
        isConsolidated: !!(inv as { is_consolidated?: boolean }).is_consolidated,
      }));
      // Add unlinked delivery notes (status='ת. משלוח')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dnDisplay: InvoiceDisplay[] = (deliveryNotesData || []).map((dn: any) => ({
        id: dn.id,
        date: formatDateString(dn.delivery_date),
        rawDate: dn.delivery_date ? toLocalDateStr(new Date(dn.delivery_date)) : "",
        supplier: dn.supplier?.name || "לא ידוע",
        reference: dn.delivery_note_number || "",
        amount: Number(dn.total_amount),
        amountWithVat: Number(dn.total_amount),
        amountBeforeVat: Number(dn.subtotal),
        status: "ת. משלוח",
        statusRaw: "delivery_note",
        enteredBy: dn.creator?.full_name || "מערכת",
        entryDate: formatDateString(dn.created_at),
        notes: dn.notes || "",
        attachmentUrl: dn.attachment_url || null,
        attachmentUrls: parseAttachmentUrls(dn.attachment_url),
        clarificationReason: null,
        isFixed: dn.supplier?.is_fixed_expense || false,
        approval_status: null,
        referenceDate: null,
        linkedPayments: [],
        linkedDeliveryNotes: [],
        documentType: "delivery_note",
        parentInvoiceId: null,
      }));
      const merged = [...displayInvoices, ...dnDisplay].sort((a, b) => (b.rawDate || "").localeCompare(a.rawDate || ""));
      setBreakdownSupplierInvoices(merged);
      const totalWithVat = merged.reduce((sum, inv) => sum + inv.amountWithVat, 0);
      setBreakdownSupplierTotalWithVat(totalWithVat);
    } catch (error) {
      console.error("Error fetching supplier invoices:", error);
    } finally {
      setIsLoadingBreakdown(false);
    }
  };

  const handleCloseSupplierBreakdown = () => {
    setShowSupplierBreakdownPopup(false);
    // Only clear data if we're not returning to breakdown from a sub-popup
    if (!returnToBreakdownRef.current) {
      setBreakdownSupplierInvoices([]);
      setBreakdownSupplierName("");
      setBreakdownSupplierCategory("");
      setBreakdownSupplierTotalWithVat(0);
    }
  };

  // Handle delete confirmation
  const handleDeleteClick = (invoiceId: string, documentType: "invoice" | "delivery_note" = "invoice") => {
    if (showSupplierBreakdownPopup) {
      returnToBreakdownRef.current = true;
      setShowSupplierBreakdownPopup(false);
    }
    setDeletingInvoiceId(invoiceId);
    setDeletingDocumentType(documentType);
    setShowDeleteConfirm(true);
  };

  // Handle actual deletion — routes to the correct table based on documentType.
  const handleConfirmDelete = async () => {
    if (!deletingInvoiceId) return;

    setIsDeleting(true);
    const supabase = createClient();

    try {
      if (deletingDocumentType === "delivery_note") {
        // Delivery notes: hard delete from delivery_notes table (no deleted_at column).
        const { error } = await supabase
          .from("delivery_notes")
          .delete()
          .eq("id", deletingInvoiceId);
        if (error) throw error;
      } else {
        // Invoices: remove linked payments first (FK), then the invoice.
        await supabase.from("payments").delete().eq("invoice_id", deletingInvoiceId);
        const { error } = await supabase
          .from("invoices")
          .delete()
          .eq("id", deletingInvoiceId);
        if (error) throw error;
      }

      showToast("ההוצאה נמחקה בהצלחה", "success");
      const deletedId = deletingInvoiceId;
      setShowDeleteConfirm(false);
      setDeletingInvoiceId(null);
      setExpandedInvoiceId(null);
      // Return to supplier breakdown if we came from there
      if (returnToBreakdownRef.current) {
        returnToBreakdownRef.current = false;
        setShowSupplierBreakdownPopup(true);
        // Remove the deleted invoice from the breakdown list
        setBreakdownSupplierInvoices(prev => prev.filter(inv => inv.id !== deletedId));
      }
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
    if (returnToBreakdownRef.current) {
      returnToBreakdownRef.current = false;
      setShowSupplierBreakdownPopup(true);
    }
  };

  // Show message if no business selected
  if (selectedBusinesses.length === 0) {
    return (
      <div className="text-white p-[7px] pb-[10px]">
        <div className="bg-[#0F1535] rounded-[20px] p-[40px] text-center">
          <p className="text-[20px] text-white/70">יש לבחור עסק כדי לצפות בהוצאות</p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-white p-[7px] pb-[10px] w-full">
      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(val) => { setActiveTab(val as "expenses" | "purchases" | "employees"); setFilterBy(""); setFilterValue(""); }} dir="rtl">
        <TabsList className="w-full bg-transparent rounded-[7px] p-0 h-[50px] sm:h-[60px] mb-[34px] gap-0 border border-[#6B6B6B]">
          <TabsTrigger value="purchases" className="flex-1 text-[14px] sm:text-[20px] font-semibold py-0 h-full rounded-none rounded-r-[7px] border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent px-[4px] sm:px-[8px]"><span className="flex items-center gap-[4px]"><CookingPot size={16} weight="duotone" className="shrink-0" />קניות סחורה</span></TabsTrigger>
          <TabsTrigger value="expenses" className="flex-1 text-[14px] sm:text-[20px] font-semibold py-0 h-full rounded-none border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent px-[4px] sm:px-[8px]"><span className="flex items-center gap-[4px]"><Receipt size={16} weight="duotone" className="shrink-0" />הוצאות שוטפות</span></TabsTrigger>
          <TabsTrigger value="employees" className="flex-1 text-[14px] sm:text-[20px] font-semibold py-0 h-full rounded-none rounded-l-[7px] border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent px-[4px] sm:px-[8px]"><span className="flex items-center gap-[4px]"><UsersThree size={16} weight="duotone" className="shrink-0" />עלות עובדים</span></TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Date Range and Add Button */}
      <div className="flex items-center justify-between mb-[10px]">
        <Button
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
        </Button>
        <div className="flex items-center gap-[8px]">
          <span className="text-[13px] text-white/50 font-medium hidden sm:inline">תקופה מוצגת:</span>
          <DateRangePicker dateRange={dateRange} onChange={handleDateRangeChange} />
        </div>
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
            /* Interactive Donut Chart */
            <div className="relative w-full h-[350px]">
              <ResponsiveContainer width="100%" height={350}>
                <PieChart>
                  <Pie
                    data={rechartsExpenseData}
                    cx="50%"
                    cy="50%"
                    innerRadius={85}
                    outerRadius={130}
                    dataKey="amount"
                    stroke="none"
                    animationBegin={0}
                    animationDuration={800}
                    animationEasing="ease-out"
                    shape={renderDonutShape}
                    onMouseEnter={(_, index) => setActiveExpenseIndex(index)}
                    onMouseLeave={() => setActiveExpenseIndex(undefined)}
                  >
                    {rechartsExpenseData.map((entry) => (
                      <Cell key={entry.id} fill={entry.fill} style={{ cursor: "pointer", outline: "none" }} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {/* Center text - shown when no segment is hovered */}
              {activeExpenseIndex === undefined && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[18px] font-bold">{activeTab === "purchases" ? "קניות סחורה" : activeTab === "employees" ? "עלות עובדים" : "הוצאות שוטפות"}</span>
                  <span className="text-[22px] font-bold ltr-num">₪{totalExpenses % 1 === 0 ? totalExpenses.toLocaleString("he-IL", { maximumFractionDigits: 0 }) : totalExpenses.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span className="text-[18px] font-bold ltr-num">{totalSalesBeforeVat > 0 ? `${((totalExpenses / totalSalesBeforeVat) * 100) % 1 === 0 ? ((totalExpenses / totalSalesBeforeVat) * 100).toFixed(0) : ((totalExpenses / totalSalesBeforeVat) * 100).toFixed(2)}%` : "—"}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Expenses Detail Table - hidden when no data */}
        {(activeTab === "employees"
          ? (chartDataSource.length > 0)
          : activeTab === "expenses"
            ? categoryData.length > 0
            : expensesData.length > 0
        ) && (
        <div className="max-w-[400px] mx-auto">
          <h2 className="text-[24px] font-bold text-center mb-[20px]">פירוט הוצאות</h2>

          {/* Table Header */}
          <div className="flex items-center border-b border-white/20 p-[5px]">
            <span className="text-[16px] flex-1 text-right">
              {activeTab === "purchases" ? "שם ספק" : "קטגוריית ספק"}
            </span>
            <span className="text-[16px] flex-1 text-center">סכום</span>
            <span className="text-[16px] flex-1 text-center">(%) מפדיון</span>
          </div>

          {/* Table Rows */}
          <div className="flex flex-col">
            {activeTab === "employees" ? (
              /* עלות עובדים - מילוי יומי + חשבוניות */
              chartDataSource.length === 0 ? (
                <div className="flex items-center justify-center py-[30px]">
                  <span className="text-[16px] text-white/50">אין נתונים להצגה</span>
                </div>
              ) : (
                chartDataSource.map((item, index) => (
                  <div
                    key={item.id}
                    className={`flex items-center p-[5px] min-h-[50px] ${index > 0 ? 'border-t border-white/10' : ''}`}
                  >
                    <div className="flex items-center gap-[5px] flex-1">
                      <span
                        className="w-[12px] h-[12px] rounded-full flex-shrink-0"
                        style={{ backgroundColor: chartColors[index % chartColors.length] }}
                      />
                      <span className="text-[16px] text-right flex-1">
                        {(item as { name?: string }).name || (item as { category?: string }).category || ""}
                      </span>
                    </div>
                    <span className="text-[16px] flex-1 text-center ltr-num">₪{item.amount.toLocaleString()}</span>
                    <span className="text-[16px] flex-1 text-center ltr-num">{item.percentage % 1 === 0 ? item.percentage.toFixed(0) : item.percentage.toFixed(2)}%</span>
                  </div>
                ))
              )
            ) : activeTab !== "purchases" ? (
              /* הוצאות שוטפות - לפי קטגוריה עם drill-down */
              categoryData.length === 0 ? (
                <div className="flex items-center justify-center py-[30px]">
                  <span className="text-[16px] text-white/50">אין נתונים להצגה</span>
                </div>
              ) : (
                categoryData.map((cat, index) => (
                  <div key={cat.id}>
                    {/* Category Row */}
                    <Button
                      type="button"
                      onClick={() => setExpandedCategoryIds(prev => {
                        if (prev.includes(cat.id)) { return prev.filter(id => id !== cat.id); } else { return [...prev, cat.id]; }
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
                          className={`flex-shrink-0 transition-transform ${expandedCategoryIds.includes(cat.id) ? '-rotate-90' : ''}`}
                        >
                          <path d="M20 10L14 16L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span className="text-[16px] text-right flex-1">{cat.category}</span>
                      </div>
                      <span className="text-[16px] flex-1 text-center ltr-num">₪{cat.amount.toLocaleString()}</span>
                      <span className="text-[16px] flex-1 text-center ltr-num">{cat.percentage % 1 === 0 ? cat.percentage.toFixed(0) : cat.percentage.toFixed(2)}%</span>
                    </Button>

                    {/* Drill-down: Suppliers in this category */}
                    {expandedCategoryIds.includes(cat.id) && cat.suppliers.length > 0 && (
                      <div className="bg-white/5 rounded-[7px] mx-[10px] mb-[5px]">
                        {cat.suppliers.map((supplier, supIndex) => {
                          // Find supplier's color from chartDataSource
                          const chartIdx = chartDataSource.findIndex(d => d.id === supplier.id);
                          return (
                          <Button
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
                              <span className={`text-[14px] flex-1 text-center ${supplier.isFixed && supplier.hasPending ? 'text-[#bc76ff]' : 'text-white/80'}`}>{supplier.name}</span>
                            </div>
                            <span className={`text-[14px] flex-1 text-center ltr-num ${supplier.isFixed && supplier.hasPending ? 'text-[#bc76ff]' : 'text-white/80'}`}>₪{supplier.amount.toLocaleString()}</span>
                            <span className={`text-[14px] flex-1 text-center ltr-num ${supplier.isFixed && supplier.hasPending ? 'text-[#bc76ff]' : 'text-white/80'}`}>{supplier.percentage % 1 === 0 ? supplier.percentage.toFixed(0) : supplier.percentage.toFixed(2)}%</span>
                          </Button>
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
                  <Button
                    type="button"
                    key={supplier.id}
                    onClick={() => handleOpenSupplierBreakdown(supplier.id, supplier.name, "קניות סחורה")}
                    className={`flex items-center p-[5px] min-h-[50px] w-full hover:bg-[#29318A]/30 transition-colors cursor-pointer rounded-[7px] ${
                      index > 0 ? 'border-t border-white/10' : ''
                    }`}
                  >
                    <span
                      className="w-[12px] h-[12px] rounded-full flex-shrink-0 mr-[8px] ml-[5px]"
                      style={{ backgroundColor: chartColors[index % chartColors.length] }}
                    />
                    <span className="text-[16px] flex-1 text-right">{supplier.name}</span>
                    <span className="text-[16px] flex-1 text-center ltr-num">₪{supplier.amount.toLocaleString()}</span>
                    <span className="text-[16px] flex-1 text-center ltr-num">{supplier.percentage % 1 === 0 ? supplier.percentage.toFixed(0) : supplier.percentage.toFixed(2)}%</span>
                  </Button>
                ))
              )
            )}
          </div>
        </div>
        )}

        {/* Full Details Button - only show when there's data */}
        {(activeTab === "employees" ? chartDataSource.length > 0 : activeTab === "expenses" ? categoryData.length > 0 : expensesData.length > 0) && (
          <div className="flex justify-center mt-0">
            <Button
              type="button"
              onClick={() => router.push("/suppliers")}
              className="w-full bg-[#29318A] text-white text-[20px] font-semibold py-[14px] rounded-t-[5px] rounded-b-[20px] flex items-center justify-center gap-[8px] transition-colors hover:bg-[#3D44A0]"
            >
              <span>לפירוט המלא</span>
              <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className="flex-shrink-0">
                <path d="M20 10L14 16L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Button>
          </div>
        )}
      </div>

      {/* Recent Invoices Section - חשבוניות אחרונות שהוזנו (hidden for employees tab and when no invoices) */}
      {recentInvoices.length > 0 && activeTab !== "employees" && (
      <div id="onboarding-expenses-filters" className="bg-[#0F1535] rounded-[20px] p-[15px_0px] mt-[10px] flex flex-col gap-[15px] w-full">
        {/* Header Row - RTL: פילטר בימין, כותרת באמצע, הורדה בשמאל */}
        <div className="flex items-center justify-between">
          {/* Filter Dropdown - Right side */}
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
                  { value: "date", label: "תאריך חשבונית" },
                  { value: "reference_date", label: "תאריך אסמכתא" },
                  { value: "supplier", label: "ספק" },
                  { value: "reference", label: "מספר תעודה" },
                  { value: "amount", label: "סכום לפני מע\"מ" },
                  { value: "creditCard", label: "כרטיס אשראי" },
                  { value: "notes", label: "הערות" },
                  { value: "fixed", label: "הוצאות קבועות" },
                ].map((option) => (
                  <Button
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
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Title - Center */}
          <h2 className="text-[18px] font-bold text-center">חשבוניות אחרונות שהוזנו</h2>

          {/* Download Button - Left side */}
          <Button
            type="button"
            className="flex flex-col items-center gap-[5px] cursor-pointer"
            onClick={() => {
              const searchVal = filterValue.trim().toLowerCase();
              // For "reference" filter: include parent consolidated invoices when a delivery note matches
              const matchedParentIds = new Set<string>();
              if (filterBy === "reference" && searchVal) {
                for (const inv of recentInvoices) {
                  if (inv.documentType === "delivery_note" && inv.parentInvoiceId &&
                      inv.reference.toLowerCase().includes(searchVal)) {
                    matchedParentIds.add(inv.parentInvoiceId);
                  }
                }
              }
              let filtered = recentInvoices.filter((inv) => {
                if (!filterBy) return true;
                if (filterBy === "fixed") return inv.isFixed;
                if (!searchVal) return true;
                switch (filterBy) {
                  case "date": return inv.date.includes(searchVal);
                  case "reference_date": return inv.referenceDate?.includes(searchVal) || false;
                  case "supplier": return inv.supplier.toLowerCase().includes(searchVal);
                  case "reference": return inv.reference.toLowerCase().includes(searchVal) || matchedParentIds.has(inv.id) || (inv.consolidatedReference?.toLowerCase().includes(searchVal) ?? false);
                  case "amount": return inv.amountBeforeVat.toLocaleString().includes(searchVal) || inv.amountBeforeVat.toString().includes(searchVal);
                  case "creditCard": {
                    const names = inv.linkedPayments
                      .filter(p => p.creditCardId)
                      .map(p => (businessCreditCards.find(c => c.id === p.creditCardId)?.card_name || "").toLowerCase());
                    return names.some(n => n.includes(searchVal));
                  }
                  case "notes": return inv.notes.toLowerCase().includes(searchVal);
                  default: return true;
                }
              });
              if (sortColumn && sortOrder) {
                filtered = [...filtered].sort((a, b) => {
                  let cmp = 0;
                  switch (sortColumn) {
                    case "date": {
                      const [dA, mA, yA] = a.date.split(".").map(Number);
                      const [dB, mB, yB] = b.date.split(".").map(Number);
                      cmp = ((yA + 2000) * 10000 + mA * 100 + dA) - ((yB + 2000) * 10000 + mB * 100 + dB);
                      break;
                    }
                    case "supplier": cmp = a.supplier.localeCompare(b.supplier, "he"); break;
                    case "reference": cmp = a.reference.localeCompare(b.reference, "he"); break;
                    case "amount": cmp = a.amountBeforeVat - b.amountBeforeVat; break;
                    case "status": cmp = a.status.localeCompare(b.status, "he"); break;
                  }
                  return sortOrder === "asc" ? cmp : -cmp;
                });
              }
              const headers = ["תאריך", "ספק", "אסמכתא", "סכום לפני מע״מ", "סכום כולל מע״מ", "סטטוס", "הערות"];
              const rows = filtered.map((inv) => {
                const status = inv.isFixed && (inv.attachmentUrls.length === 0 && !inv.reference) ? "ה.קבועה" : inv.status;
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
              link.download = `expenses_${toLocalDateStr(new Date())}.csv`;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none" className="text-white">
              <path d="M16 4V22M16 22L10 16M16 22L22 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6 28H26" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="text-[12px] text-white text-center">הורדת חשבוניות</span>
          </Button>
        </div>

        {/* Filter Input Bar */}
        {filterBy && filterBy !== "fixed" && (
          <div className="flex items-center gap-[10px] px-[10px]">
            <span className="text-[13px] text-white/60 whitespace-nowrap">
              {filterBy === "date" ? "תאריך:" : filterBy === "reference_date" ? "תאריך אסמכתא:" : filterBy === "supplier" ? "ספק:" : filterBy === "reference" ? "אסמכתא:" : filterBy === "amount" ? "סכום:" : filterBy === "creditCard" ? "כרטיס אשראי:" : "הערות:"}
            </span>
            <Input
              type="text"
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
              placeholder={
                filterBy === "date" ? "לדוגמה: 01.02" :
                filterBy === "supplier" ? "הקלד שם ספק..." :
                filterBy === "reference" ? "הקלד מספר תעודה..." :
                filterBy === "amount" ? "הקלד סכום..." :
                filterBy === "creditCard" ? "הקלד שם/מספר כרטיס..." :
                "הקלד טקסט..."
              }
              className="flex-1 bg-white/10 text-white text-[13px] rounded-[7px] px-[10px] py-[6px] outline-none placeholder:text-white/30"
            />
            <Button
              type="button"
              title="ניקוי סינון"
              onClick={() => { setFilterBy(""); setFilterValue(""); }}
              className="text-white/50 hover:text-white transition-colors"
            >
              <X size={16} />
            </Button>
          </div>
        )}
        {filterBy === "fixed" && (
          <div className="flex items-center gap-[10px] px-[10px]">
            <span className="text-[13px] text-[#bc76ff]">מציג הוצאות קבועות בלבד</span>
            <Button
              type="button"
              title="ניקוי סינון"
              onClick={() => { setFilterBy(""); setFilterValue(""); }}
              className="text-white/50 hover:text-white transition-colors"
            >
              <X size={16} />
            </Button>
          </div>
        )}

        {/* Table */}
        <div id="onboarding-expenses-list" className="w-full flex flex-col gap-[5px]">
          {/* Table Header */}
          <div className="grid grid-cols-[0.7fr_1.4fr_1fr_0.8fr_0.9fr] bg-[#29318A] rounded-t-[7px] p-[10px_5px] pe-[13px] items-center">
            {([["date", "תאריך"], ["supplier", "ספק"], ["reference", "אסמכתא"], ["amount", "סכום"], ["status", "סטטוס"]] as const).map(([col, label]) => (
              <Button
                key={col}
                type="button"
                onClick={() => handleColumnSort(col)}
                className="text-[13px] font-medium text-center cursor-pointer hover:text-white/80 transition-colors flex items-center justify-center gap-[3px]"
              >
                {label}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className={`flex-shrink-0 transition-opacity ${sortColumn === col ? 'opacity-100' : 'opacity-30'}`}>
                  <path d={sortColumn === col && sortOrder === "desc" ? "M12 5V19M12 19L5 12M12 19L19 12" : "M12 19V5M12 5L5 12M12 5L19 12"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Button>
            ))}
          </div>

          {/* Table Rows */}
          <div ref={invoicesListRef} onScroll={handleInvoicesScroll} className="max-h-[calc(100vh-280px)] overflow-y-auto flex flex-col gap-[5px]">
            {(() => {
              const searchVal = filterValue.trim().toLowerCase();
              // For "reference" filter: include parent consolidated invoices when a delivery note matches
              const matchedParentIds = new Set<string>();
              if (filterBy === "reference" && searchVal) {
                for (const inv of recentInvoices) {
                  if (inv.documentType === "delivery_note" && inv.parentInvoiceId &&
                      inv.reference.toLowerCase().includes(searchVal)) {
                    matchedParentIds.add(inv.parentInvoiceId);
                  }
                }
              }
              let filtered = recentInvoices.filter((inv) => {
                if (!filterBy) return true;
                if (filterBy === "fixed") return inv.isFixed;
                if (!searchVal) return true;
                switch (filterBy) {
                  case "date": return inv.date.includes(searchVal);
                  case "reference_date": return inv.referenceDate?.includes(searchVal) || false;
                  case "supplier": return inv.supplier.toLowerCase().includes(searchVal);
                  case "reference": return inv.reference.toLowerCase().includes(searchVal) || matchedParentIds.has(inv.id) || (inv.consolidatedReference?.toLowerCase().includes(searchVal) ?? false);
                  case "amount": return inv.amountBeforeVat.toLocaleString().includes(searchVal) || inv.amountBeforeVat.toString().includes(searchVal);
                  case "creditCard": {
                    const names = inv.linkedPayments
                      .filter(p => p.creditCardId)
                      .map(p => (businessCreditCards.find(c => c.id === p.creditCardId)?.card_name || "").toLowerCase());
                    return names.some(n => n.includes(searchVal));
                  }
                  case "notes": return inv.notes.toLowerCase().includes(searchVal);
                  default: return true;
                }
              });
              if (sortColumn && sortOrder) {
                filtered = [...filtered].sort((a, b) => {
                  let cmp = 0;
                  switch (sortColumn) {
                    case "date": {
                      const [dA, mA, yA] = a.date.split(".").map(Number);
                      const [dB, mB, yB] = b.date.split(".").map(Number);
                      cmp = ((yA + 2000) * 10000 + mA * 100 + dA) - ((yB + 2000) * 10000 + mB * 100 + dB);
                      break;
                    }
                    case "supplier": cmp = a.supplier.localeCompare(b.supplier, "he"); break;
                    case "reference": cmp = a.reference.localeCompare(b.reference, "he"); break;
                    case "amount": cmp = a.amountBeforeVat - b.amountBeforeVat; break;
                    case "status": cmp = a.status.localeCompare(b.status, "he"); break;
                  }
                  return sortOrder === "asc" ? cmp : -cmp;
                });
              }
              // When filter is active, prefer global search results (all dates)
              const hasActiveFilter = filterBy && filterBy !== "fixed" && filterValue.trim();
              const displayInvoices = hasActiveFilter && globalSearchResults && globalSearchResults.length > 0
                ? globalSearchResults
                : filtered;
              const isShowingGlobal = hasActiveFilter && globalSearchResults && globalSearchResults.length > 0;

              return displayInvoices.length === 0 ? (
              <div className="flex items-center justify-center py-[40px]">
                <span className="text-[16px] text-white/50">{isGlobalSearching ? 'מחפש בכל החשבוניות...' : filterBy ? 'לא נמצאו תוצאות' : 'אין חשבוניות להצגה'}</span>
              </div>
            ) : (
              <>
              {isShowingGlobal && (
                <div className="bg-[#29318A]/30 border border-[#29318A]/50 rounded-[7px] px-[10px] py-[6px] mb-[5px]">
                  <span className="text-[12px] text-[#00D4FF]">נמצאו {globalSearchResults!.length} תוצאות מחוץ לטווח הנוכחי (טאב/תאריכים)</span>
                </div>
              )}
              {displayInvoices.map((invoice) => {
              // Fixed expense supplier - show purple only if missing attachment AND reference
              const hasAttachment = invoice.attachmentUrl && String(invoice.attachmentUrl).trim() !== "";
              const hasReference = invoice.reference && String(invoice.reference).trim() !== "" && invoice.reference !== "-";
              const isFixedPending = invoice.isFixed && !hasAttachment && !hasReference;
              return (
              <div
                key={invoice.id}
                data-invoice-id={invoice.id}
                className={`rounded-[7px] p-[7px_3px] border transition-colors ${
                  expandedInvoiceId === invoice.id ? 'bg-white/5 border-white'
                  : invoice.status === 'בבירור' ? 'border-[#FFA500]'
                  : invoice.approval_status === 'pending_review' ? 'border-[#bc76ff]/50'
                  : 'border-transparent'
                }`}
              >
                {/* Main Row */}
                <div className="grid grid-cols-[0.7fr_1.4fr_1fr_0.8fr_0.9fr] w-full p-[5px_5px] hover:bg-[#29318A]/30 transition-colors rounded-[7px] items-center">
                  {/* Date - Clickable */}
                  <Button
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
                  </Button>
                  {/* Supplier - Clickable */}
                  <Button
                    type="button"
                    onClick={() => setExpandedInvoiceId(expandedInvoiceId === invoice.id ? null : invoice.id)}
                    className={`text-[12px] text-center leading-tight cursor-pointer break-words px-[2px] ${isFixedPending ? 'text-[#bc76ff]' : ''}`}
                  >
                    {invoice.supplier}
                  </Button>
                  {/* Reference - Clickable */}
                  <Button
                    type="button"
                    onClick={() => setExpandedInvoiceId(expandedInvoiceId === invoice.id ? null : invoice.id)}
                    className={`text-[12px] text-center ltr-num cursor-pointer truncate px-[2px] ${isFixedPending ? 'text-[#bc76ff]' : ''}`}
                  >
                    {invoice.reference || "-"}
                  </Button>
                  {/* Amount - Clickable */}
                  <Button
                    type="button"
                    onClick={() => setExpandedInvoiceId(expandedInvoiceId === invoice.id ? null : invoice.id)}
                    className={`text-[12px] text-center ltr-num font-medium cursor-pointer ${isFixedPending ? 'text-[#bc76ff]' : ''}`}
                  >
                    ₪{invoice.amountBeforeVat.toLocaleString()}
                  </Button>
                  {/* Status - Clickable with dropdown */}
                  <div className="flex flex-col items-center justify-center min-w-0 gap-[3px]" data-status-menu>
                    {invoice.isConsolidated && (
                      <span className="text-[9px] font-bold px-[8px] py-[1px] rounded-full bg-[#FFB84D] text-black whitespace-nowrap leading-tight">
                        מרכזת
                      </span>
                    )}
                    {invoice.documentType === 'delivery_note' ? (
                      <span className="text-[12px] font-bold px-[14px] py-[5px] rounded-full bg-[#00bcd4] whitespace-nowrap min-w-[70px] text-center">
                        ת. משלוח
                      </span>
                    ) : invoice.approval_status === 'pending_review' ? (
                      <div className="flex items-center gap-[4px]">
                        {invoice.attachmentUrls.length > 0 && (
                          <button
                            className="w-[28px] h-[28px] rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                            title="צפייה במסמך"
                            onClick={(e) => { e.stopPropagation(); setViewerDocUrl(invoice.attachmentUrls[0]); }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                            </svg>
                          </button>
                        )}
                        <button
                          className="text-[12px] font-bold px-[14px] py-[5px] rounded-full bg-white/20 text-white/60 hover:bg-green-500 hover:text-white transition-colors whitespace-nowrap min-w-[70px] text-center"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await approveInvoice(invoice.id);
                              showToast("החשבונית אושרה", "success");
                            } catch (err) {
                              showToast(err instanceof Error ? err.message : "שגיאה באישור החשבונית", "error");
                            }
                          }}
                        >
                          ממתין לבדיקה ✓
                        </button>
                      </div>
                    ) : (
                      <Button
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
                        className={`text-[12px] font-bold px-[14px] py-[5px] rounded-full cursor-pointer hover:opacity-80 transition-opacity whitespace-nowrap min-w-[70px] text-center ${
                          isFixedPending ? 'bg-[#bc76ff]' :
                          invoice.status === 'שולם' ? 'bg-[#00E096]' :
                          invoice.status === 'בבירור' ? 'bg-[#FFA500]' : 'bg-[#29318A]'
                        }`}
                      >
                        {isFixedPending ? 'ה.קבועה' : invoice.status}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Expanded Content */}
                {expandedInvoiceId === invoice.id && (
                  <div className="flex flex-col gap-[20px] p-[5px] mt-[10px]">
                    {/* OCR Pending Review Banner */}
                    {invoice.approval_status === 'pending_review' && (
                      <div className="border border-[#bc76ff]/50 rounded-[7px] p-[10px] flex items-center justify-between bg-[#bc76ff]/10">
                        <div className="flex items-center gap-[8px]">
                          {invoice.attachmentUrls.length > 0 && (
                            <Button
                              type="button"
                              onClick={() => setViewerDocUrl(invoice.attachmentUrls[0])}
                              className="h-[34px] px-[12px] bg-white/10 hover:bg-white/20 rounded-[7px] text-white text-[13px] font-medium transition-colors flex items-center gap-[5px]"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                              </svg>
                              צפייה במסמך
                            </Button>
                          )}
                          <a
                            href="/ocr"
                            className="h-[34px] px-[12px] bg-[#bc76ff] hover:bg-[#a855f7] rounded-[7px] text-white text-[13px] font-medium transition-colors flex items-center gap-[5px]"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                            </svg>
                            לאישור ב-OCR
                          </a>
                        </div>
                        <span className="text-[13px] text-[#bc76ff] font-medium">ממתין לאישור סופי</span>
                      </div>
                    )}

                    {/* Notes Section - only show if has notes */}
                    {invoice.notes && invoice.notes.trim() !== "" && (
                      <div className="border border-white/50 rounded-[7px] p-[3px] flex flex-col gap-[3px]">
                        <span className="text-[14px] text-[#979797] text-right">הערות</span>
                        <Textarea
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
                            <Button
                              type="button"
                              title="צפייה בתמונה"
                              onClick={() => setViewerDocUrl(invoice.attachmentUrls[0])}
                              className="w-[18px] h-[18px] text-white/70 hover:text-white transition-colors"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <circle cx="8.5" cy="8.5" r="1.5"/>
                                <polyline points="21 15 16 10 5 21"/>
                              </svg>
                            </Button>
                          )}
                          {/* Download Icon - downloads ALL attachments */}
                          {invoice.attachmentUrls.length > 0 && (
                            <Button
                              type="button"
                              title={invoice.attachmentUrls.length > 1 ? `הורדת ${invoice.attachmentUrls.length} מסמכים` : "הורדה"}
                              className="w-[18px] h-[18px] text-white/70 hover:text-white transition-colors cursor-pointer"
                              onClick={async (e) => {
                                e.stopPropagation();
                                for (let i = 0; i < invoice.attachmentUrls.length; i++) {
                                  const url = invoice.attachmentUrls[i];
                                  try {
                                    const res = await fetch(url);
                                    const blob = await res.blob();
                                    const blobUrl = URL.createObjectURL(blob);
                                    const a = document.createElement("a");
                                    a.href = blobUrl;
                                    const baseName = url.split("/").pop() || `invoice-${i + 1}`;
                                    a.download = invoice.attachmentUrls.length > 1 ? `${i + 1}-${baseName}` : baseName;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    URL.revokeObjectURL(blobUrl);
                                    // small delay so the browser doesn't block multiple downloads
                                    if (i < invoice.attachmentUrls.length - 1) {
                                      await new Promise(resolve => setTimeout(resolve, 200));
                                    }
                                  } catch {
                                    window.open(url, "_blank");
                                  }
                                }
                              }}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                              </svg>
                            </Button>
                          )}
                          {/* Edit Icon - Admin only */}
                          {isAdmin && (
                            <Button
                              type="button"
                              title="עריכה"
                              onClick={() => handleEditInvoice(invoice)}
                              className="w-[18px] h-[18px] text-white/70 hover:text-white transition-colors"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </Button>
                          )}
                          {/* Delete Icon - Admin only */}
                          {isAdmin && (
                            <Button
                              type="button"
                              title="מחיקה"
                              onClick={() => handleDeleteClick(invoice.id, invoice.documentType)}
                              className="w-[18px] h-[18px] text-white/70 hover:text-[#F64E60] transition-colors"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                <line x1="10" y1="11" x2="10" y2="17"/>
                                <line x1="14" y1="11" x2="14" y2="17"/>
                              </svg>
                            </Button>
                          )}
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
                              className="border border-white/20 rounded-[8px] overflow-hidden w-[70px] h-[70px] hover:border-white/50 transition-colors cursor-pointer"
                            >
                              {isPdfUrl(url) ? (
                                <PdfThumbnail url={url} className="w-full h-full" />
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

                    {/* Linked Delivery Notes (markezet children) */}
                    {invoice.linkedDeliveryNotes.length > 0 && (
                      <div className="flex flex-col gap-[8px] border border-white/30 rounded-[7px] p-[3px] mx-[3px]">
                        <Button
                          type="button"
                          onClick={() => setShowLinkedDeliveryNotes(showLinkedDeliveryNotes === invoice.id ? null : invoice.id)}
                          className="bg-[#29318A] text-white text-[15px] font-medium py-[5px] px-[14px] rounded-[7px] self-start cursor-pointer hover:bg-[#3D44A0] transition-colors"
                        >
                          הצגת תעודות משלוח מקושרות ({invoice.linkedDeliveryNotes.length})
                        </Button>

                        {showLinkedDeliveryNotes === invoice.id && (
                          <div className="flex flex-col gap-[4px]">
                            <span className="text-[13px] font-bold text-right px-[5px]">
                              סה&quot;כ תעודות משלוח: ₪{invoice.linkedDeliveryNotes.reduce((sum, d) => sum + d.amount, 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <div dir="rtl" className="flex items-center justify-between gap-[3px] border-b border-white/20 min-h-[40px] px-[3px]">
                              <span className="text-[13px] min-w-[55px] text-center">תאריך</span>
                              <span className="text-[13px] flex-1 text-center">מספר</span>
                              <span className="text-[13px] w-[80px] text-center">לפני מע&quot;מ</span>
                              <span className="text-[13px] w-[80px] text-center">כולל מע&quot;מ</span>
                              <span className="text-[13px] w-[30px] text-center">צפייה</span>
                            </div>
                            {invoice.linkedDeliveryNotes.map((dn) => (
                              <div
                                key={dn.id}
                                dir="rtl"
                                className="flex items-center justify-between gap-[3px] min-h-[40px] px-[3px] rounded-[7px]"
                              >
                                <span className="text-[13px] min-w-[55px] text-center ltr-num">{dn.date}</span>
                                <span className="text-[13px] flex-1 text-center ltr-num">{dn.deliveryNoteNumber || "-"}</span>
                                <span className="text-[13px] w-[80px] text-center ltr-num">₪{dn.subtotal.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                <span className="text-[13px] w-[80px] text-center ltr-num">₪{dn.amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                <div className="w-[30px] flex items-center justify-center">
                                  {dn.attachmentUrls.length > 0 && (
                                    <Button
                                      type="button"
                                      title="צפייה בתעודת משלוח"
                                      onClick={() => setViewerDocUrl(dn.attachmentUrls[0])}
                                      className="text-white/70 hover:text-white transition-colors p-0 h-auto bg-transparent"
                                    >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                        <circle cx="8.5" cy="8.5" r="1.5"/>
                                        <polyline points="21 15 16 10 5 21"/>
                                      </svg>
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Linked Payments Section - only show if has payments */}
                    {invoice.linkedPayments.length > 0 && (
                      <div className="flex flex-col gap-[8px] border border-white/30 rounded-[7px] p-[3px] mx-[3px]">
                        <Button
                          type="button"
                          onClick={() => setShowLinkedPayments(showLinkedPayments === invoice.id ? null : invoice.id)}
                          className="bg-[#29318A] text-white text-[15px] font-medium py-[5px] px-[14px] rounded-[7px] self-start cursor-pointer hover:bg-[#3D44A0] transition-colors"
                        >
                          הצגת תשלומים מקושרים ({invoice.linkedPayments.length})
                        </Button>

                        {/* Linked Payments List */}
                        {showLinkedPayments === invoice.id && (
                          <div className="flex flex-col gap-[4px]">
                            {/* Total */}
                            <span className="text-[13px] font-bold text-right px-[5px]">
                              סה&quot;כ תשלומים: ₪{invoice.linkedPayments.reduce((sum, p) => sum + p.amount, 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            {/* Header */}
                            <div dir="rtl" className="flex items-center justify-between gap-[3px] border-b border-white/20 min-h-[40px] px-[3px]">
                              <span className="text-[13px] min-w-[50px] text-center">תאריך</span>
                              <span className="text-[13px] flex-1 text-center">אמצעי תשלום</span>
                              <span className="text-[13px] min-w-[55px] text-center">אסמכתא</span>
                              <span className="text-[13px] min-w-[45px] text-center">תשלום</span>
                              <span className="text-[13px] w-[65px] text-center">סכום</span>
                              <span className="text-[13px] w-[30px] text-center">קבלה</span>
                            </div>
                            {/* Payment rows - one per payment */}
                            {invoice.linkedPayments.map((payment) => (
                              <div
                                key={payment.id}
                                dir="rtl"
                                className="flex items-center justify-between gap-[3px] min-h-[40px] px-[3px] rounded-[7px]"
                              >
                                <span className="text-[13px] min-w-[50px] text-center ltr-num">{payment.date}</span>
                                <span className="text-[13px] flex-1 text-center">
                                  {payment.method}
                                  {payment.creditCardId && (() => {
                                    const card = businessCreditCards.find(c => c.id === payment.creditCardId);
                                    return card ? ` ${card.card_name}` : "";
                                  })()}
                                </span>
                                <span className="text-[13px] min-w-[55px] text-center ltr-num">{payment.checkNumber || payment.referenceNumber || "-"}</span>
                                <span className="text-[13px] min-w-[45px] text-center ltr-num">{payment.installmentsCount && payment.installmentsCount > 1 ? `${payment.installmentNumber}/${payment.installmentsCount}` : "-"}</span>
                                <span className="text-[13px] w-[65px] text-center ltr-num">₪{payment.amount % 1 === 0 ? payment.amount.toLocaleString("he-IL") : payment.amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                <div className="w-[30px] flex items-center justify-center">
                                  {payment.receiptUrl ? (
                                    <Button
                                      type="button"
                                      title="צפייה בקבלת התשלום"
                                      onClick={() => setViewerDocUrl(payment.receiptUrl!)}
                                      className="text-white/70 hover:text-white transition-colors p-0 h-auto bg-transparent"
                                    >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                        <circle cx="8.5" cy="8.5" r="1.5"/>
                                        <polyline points="21 15 16 10 5 21"/>
                                      </svg>
                                    </Button>
                                  ) : (
                                    <span className="text-[13px] text-white/30">-</span>
                                  )}
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
            })}
            </>
            );
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

      {/* Daily Labor Entries Table - only shown in employees tab */}
      {activeTab === "employees" && dailyLaborEntries.length > 0 && (
        <div className="bg-[#0F1535] rounded-[20px] p-[15px_0px] mt-[10px] flex flex-col gap-[15px] w-full">
          <h2 className="text-[18px] font-bold text-center">מילוי יומי — עלות עובדים</h2>
          <div className="w-full max-h-[500px] overflow-y-scroll">
            {/* Header with sortable columns */}
            <div className="grid grid-cols-[0.7fr_1.2fr_0.7fr_0.8fr_0.8fr_1fr] bg-[#29318A] rounded-t-[7px] p-[10px_5px] items-center sticky top-0 z-10">
              {([ ["date", "תאריך"], ["labor_cost", "עובדים שעתיים"], ["labor_hours", "שעות"], ["manager_daily_cost", "עלות מנהל"], ["total", "סה\"כ"], ["total_with_markup", "כולל העמסה"] ] as const).map(([col, label]) => (
                <Button key={col} type="button" onClick={() => handleLaborSort(col)}
                  className="text-[13px] font-medium text-center cursor-pointer hover:text-white/80 transition-colors flex items-center justify-center gap-[3px]">
                  {label}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className={`flex-shrink-0 transition-opacity ${laborSortCol === col ? 'opacity-100' : 'opacity-30'}`}>
                    <path d={laborSortCol === col && laborSortOrder === "desc" ? "M12 5V19M12 19L5 12M12 19L19 12" : "M12 19V5M12 5L5 12M12 5L19 12"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </Button>
              ))}
            </div>
            {/* Rows */}
            <div className="flex flex-col gap-[5px]">
              {[...dailyLaborEntries].sort((a, b) => {
                if (!laborSortCol || !laborSortOrder) return 0;
                let cmp = 0;
                if (laborSortCol === "date") cmp = a.entry_date.localeCompare(b.entry_date);
                else if (laborSortCol === "labor_cost") cmp = a.labor_cost - b.labor_cost;
                else if (laborSortCol === "labor_hours") cmp = a.labor_hours - b.labor_hours;
                else if (laborSortCol === "manager_daily_cost") cmp = a.manager_daily_cost - b.manager_daily_cost;
                else if (laborSortCol === "total") cmp = (a.labor_cost + a.manager_daily_cost) - (b.labor_cost + b.manager_daily_cost);
                else if (laborSortCol === "total_with_markup") cmp = ((a.labor_cost + a.manager_daily_cost) * laborMarkupMultiplier) - ((b.labor_cost + b.manager_daily_cost) * laborMarkupMultiplier);
                return laborSortOrder === "asc" ? cmp : -cmp;
              }).map((entry) => {
                const dateObj = new Date(entry.entry_date);
                const dateStr = `${String(dateObj.getDate()).padStart(2, '0')}.${String(dateObj.getMonth() + 1).padStart(2, '0')}.${String(dateObj.getFullYear()).slice(2)}`;
                const rowTotal = entry.labor_cost + entry.manager_daily_cost;
                const rowTotalWithMarkup = Math.round((entry.labor_cost + entry.manager_daily_cost) * laborMarkupMultiplier);
                return (
                  <div key={entry.entry_date} className="rounded-[7px] p-[7px_3px] border border-transparent">
                    <div className="grid grid-cols-[0.7fr_1.2fr_0.7fr_0.8fr_0.8fr_1fr] w-full p-[5px_5px] hover:bg-[#29318A]/30 transition-colors rounded-[7px] items-center">
                      <span className="text-[12px] ltr-num text-center">{dateStr}</span>
                      <span className="text-[12px] ltr-num text-center">{entry.labor_cost > 0 ? `₪${entry.labor_cost.toLocaleString()}` : "—"}</span>
                      <span className="text-[12px] ltr-num text-center text-white/60">{entry.labor_hours > 0 ? entry.labor_hours : "—"}</span>
                      <span className="text-[12px] ltr-num text-center">{entry.manager_daily_cost > 0 ? `₪${entry.manager_daily_cost.toLocaleString()}` : "—"}</span>
                      <span className="text-[12px] ltr-num text-center font-medium">₪{rowTotal.toLocaleString()}</span>
                      <span className="text-[12px] ltr-num text-center font-medium text-indigo-400">₪{rowTotalWithMarkup.toLocaleString()}</span>
                    </div>
                  </div>
                );
              })}
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
              <SheetTitle className="text-white text-xl font-bold">הוספת הוצאה חדשה</SheetTitle>
              <div className="w-[24px]" />
            </div>
          </SheetHeader>

            {/* Form */}
            <div className="flex flex-col gap-[15px] px-[5px]">
              {/* Image Upload - Multiple (top of form for OCR) */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[16px] font-medium text-white text-right">תמונות/מסמכים</label>
                {newAttachmentPreviews.length > 0 && (
                  <div className="flex flex-wrap gap-[8px] mb-[5px]">
                    {newAttachmentPreviews.map((preview, idx) => {
                      return (
                      <div key={`new-preview-${preview}`} className="flex flex-col items-center gap-[4px]">
                        <div className="relative border border-[#4C526B] rounded-[8px] overflow-hidden w-[100px] h-[100px]">
                          <Image src={preview} alt={`תמונה ${idx + 1}`} className="w-full h-full object-cover cursor-pointer" onClick={() => window.open(preview, '_blank')} width={100} height={100} unoptimized />
                        </div>
                        <Button
                          type="button"
                          onClick={() => {
                            setNewAttachmentFiles(prev => prev.filter((_, i) => i !== idx));
                            setNewAttachmentPreviews(prev => prev.filter((_, i) => i !== idx));
                          }}
                          className="text-[#F64E60] hover:text-[#ff3547] transition-colors"
                          title="הסר קובץ"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            <line x1="10" y1="11" x2="10" y2="17"/>
                            <line x1="14" y1="11" x2="14" y2="17"/>
                          </svg>
                        </Button>
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
                    accept="image/*,.pdf,.heic,.heif,.avif,.bmp,.tiff,.tif"
                    multiple
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (files && files.length > 0) {
                        const arr = Array.from(files);
                        // Deduplicate by file name+size (#24)
                        const dedupedArr = arr.filter(f => !newAttachmentFiles.some(existing => existing.name === f.name && existing.size === f.size));
                        if (dedupedArr.length === 0) { e.target.value = ""; return; }
                        setNewAttachmentFiles(prev => [...prev, ...dedupedArr]);
                        const previews = await Promise.all(dedupedArr.map(async (f) => {
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

                        if (!ocrApplied && dedupedArr.length > 0) {
                          // Send original file to OCR — API handles both images and PDFs
                          processOcr(dedupedArr[0]);
                        }
                      }
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                </label>
                {isUploadingAttachment && (
                  <span className="text-[12px] text-white/50 text-center">מעלה קבצים...</span>
                )}
                {isOcrProcessing && (
                  <div className="flex items-center gap-[8px] justify-center py-[8px]">
                    <svg className="animate-spin h-4 w-4 text-[#29318A]" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-[13px] text-white/70">{ocrProcessingStep || "מזהה נתונים מהמסמך..."}</span>
                  </div>
                )}
                {ocrApplied && !isOcrProcessing && (
                  <span className="text-[12px] text-green-400 text-center">נתונים זוהו ומולאו בטופס - ניתן לערוך לפני שמירה</span>
                )}
              </div>

              {/* Date Field */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">תאריך ערך</label>
                <DatePickerField
                  value={expenseDate}
                  onChange={(val) => {
                    setExpenseDate(val);
                    if (!referenceDateManuallySet.current) {
                      setReferenceDate(val);
                    }
                  }}
                />
              </div>

              {/* Reference Date Field */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">תאריך אסמכתא</label>
                <DatePickerField
                  value={referenceDate}
                  onChange={(val) => {
                    setReferenceDate(val);
                    referenceDateManuallySet.current = true;
                  }}
                />
              </div>

              {/* Expense Type */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">סוג הוצאה</label>
                <div className="flex items-center justify-start gap-[20px]">
                  <Button
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
                    <span className={`text-[15px] font-semibold flex items-center gap-[3px] ${expenseType === "goods" ? "text-white" : "text-white/50"}`}>
                      <CookingPot size={14} weight="duotone" />קניות סחורה
                    </span>
                  </Button>
                  <Button
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
                    <span className={`text-[15px] font-semibold flex items-center gap-[3px] ${expenseType === "current" ? "text-white" : "text-white/50"}`}>
                      <Receipt size={14} weight="duotone" />הוצאות שוטפות
                    </span>
                  </Button>
                  <Button
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
                    <span className={`text-[15px] font-semibold flex items-center gap-[3px] ${expenseType === "employees" ? "text-white" : "text-white/50"}`}>
                      <UsersThree size={14} weight="duotone" />עלות עובדים
                    </span>
                  </Button>
                </div>
              </div>

              {/* Supplier Select */}
              <SupplierSearchSelect
                suppliers={suppliers}
                value={selectedSupplier}
                onChange={handleSupplierChange}
              />

              {/* Link to Coordinator Option - shown only for coordinator suppliers */}
              {(() => {
                const supplierInfo = suppliers.find(s => s.id === selectedSupplier);
                if (!supplierInfo?.waiting_for_coordinator) return null;
                return (
                  <div
                    className="flex items-center gap-[5px] cursor-pointer"
                    dir="rtl"
                    onClick={() => setLinkToCoordinator(!linkToCoordinator)}
                  >
                    <Button
                      type="button"
                      className="w-[21px] h-[21px] flex items-center justify-center text-white"
                    >
                      {linkToCoordinator ? (
                        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                          <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" fill="#4F46E5"/>
                          <path d="M7 12L10.5 15.5L17 9" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                          <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                      )}
                    </Button>
                    <span className="text-[15px] font-medium text-white">האם לשייך למרכזת?</span>
                  </div>
                );
              })()}

              {/* Fixed Expense - Link to existing invoice or create new */}
              {fixedOpenInvoices.length > 0 && (() => {
                const supplierInfo = suppliers.find(s => s.id === selectedSupplier);
                if (!supplierInfo?.is_fixed_expense) return null;
                return (
                  <div className="flex flex-col gap-[8px]">
                    <div
                      className="flex items-center gap-[5px] cursor-pointer"
                      dir="rtl"
                      onClick={() => setShowFixedInvoices(!showFixedInvoices)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={`text-white/70 transition-transform ${showFixedInvoices ? "rotate-180" : ""}`}>
                        <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span className="text-[14px] font-medium text-[#bc76ff]">
                        הוצאה חודשית קבועה — {fixedOpenInvoices.length} חשבוניות פתוחות
                      </span>
                    </div>
                    {showFixedInvoices && (
                      <div className="flex flex-col gap-[6px] pr-[10px]">
                        <Button
                          type="button"
                          onClick={() => setLinkToFixedInvoiceId(null)}
                          className={`w-full text-right px-[12px] py-[10px] rounded-[10px] text-[13px] transition-all ${
                            linkToFixedInvoiceId === null
                              ? "bg-[#4F46E5] text-white border border-white/30"
                              : "bg-[#1A2150] text-white/70 border border-white/10 hover:bg-[#1A2150]/80"
                          }`}
                        >
                          פתח חשבונית חדשה
                        </Button>
                        {fixedOpenInvoices.map(inv => (
                          <Button
                            key={inv.id}
                            type="button"
                            onClick={() => {
                              setLinkToFixedInvoiceId(inv.id);
                              setAmountBeforeVat(String(inv.subtotal));
                              // Auto-set expense date to the original invoice date
                              setExpenseDate(inv.invoice_date);
                              if (supplierInfo.vat_type === "none") {
                                setPartialVat(true);
                                setVatAmount("0");
                              }
                            }}
                            className={`w-full text-right px-[12px] py-[10px] rounded-[10px] text-[13px] transition-all ${
                              linkToFixedInvoiceId === inv.id
                                ? "bg-[#4F46E5] text-white border border-white/30"
                                : "bg-[#1A2150] text-white/70 border border-white/10 hover:bg-[#1A2150]/80"
                            }`}
                          >
                            {inv.month} — ₪{inv.total_amount.toLocaleString("he-IL")}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Invoice Number */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-normal text-white text-right">מספר חשבונית / תעודת משלוח</label>
                <div className={`border rounded-[10px] h-[50px] ${duplicateWarning ? "border-[#F59E0B]" : "border-[#4C526B]"}`}>
                  <Input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="מספר חשבונית..."
                    className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
                  />
                </div>
                {duplicateWarning && (
                  <div className="p-[8px_12px] bg-[#F59E0B]/15 border border-[#F59E0B]/40 rounded-[8px] text-[#F59E0B] text-[13px] font-medium text-right" dir="rtl">
                    ⚠️ {duplicateWarning}
                  </div>
                )}
              </div>

              {/* Amount Before VAT */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">סכום לפני מע&apos;&apos;מ</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <Input
                    type="text"
                    inputMode="decimal"
                    title="סכום לפני מע״מ"
                    value={amountBeforeVat && !isNaN(parseFloat(amountBeforeVat)) ? (amountBeforeVat.endsWith(".") ? parseFloat(amountBeforeVat).toLocaleString("en-US", { maximumFractionDigits: 0 }) + "." : parseFloat(amountBeforeVat).toLocaleString("en-US", { maximumFractionDigits: 2 })) : amountBeforeVat}
                    onChange={(e) => setAmountBeforeVat(e.target.value.replace(/,/g, ""))}
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
                    <Input
                      type="text"
                      inputMode="decimal"
                      title="סכום מע״מ"
                      placeholder="0.00"
                      value={partialVat ? vatAmount : calculatedVat.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      onChange={(e) => setVatAmount(e.target.value.replace(/,/g, ""))}
                      disabled={!partialVat}
                      className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px] disabled:text-white/50"
                    />
                  </div>
                </div>
                <div className="flex flex-col items-center gap-[5px]">
                  <Button
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
                  </Button>
                  <span className="text-[15px] font-medium text-white">הזנת סכום מע&quot;מ חלקי</span>
                </div>
              </div>

              {/* Total with VAT */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">סכום כולל מע&quot;מ</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <Input
                    type="text"
                    title="סכום כולל מע״מ"
                    placeholder="0.00"
                    value={totalWithVat.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    disabled
                    className="w-full h-full bg-transparent text-white/50 text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
                  />
                </div>
              </div>

              {/* Line Items - Price Tracking (only for goods purchases) */}
              {expenseType === 'goods' && (
                <div className="flex flex-col gap-[8px]">
                  <Button
                    type="button"
                    onClick={() => setShowLineItems(!showLineItems)}
                    className="flex items-center justify-between w-full border border-[#4C526B] rounded-[10px] h-[50px] px-[15px] bg-transparent hover:bg-[#29318A]/10"
                  >
                    <span className="text-[15px] font-medium text-white">פריטים (מעקב מחירים)</span>
                    <span className="text-[13px] text-white/50">
                      {expenseLineItems.length > 0
                        ? `${expenseLineItems.length} פריטים`
                        : 'אופציונלי'}
                    </span>
                  </Button>

                  {showLineItems && (
                    <div className="border border-[#4C526B] rounded-[10px] p-[10px] flex flex-col gap-[8px]">
                      {/* Price alerts banner */}
                      {lineItemsPriceCheckDone && expenseLineItems.some(li => li.price_change_pct != null && li.price_change_pct !== 0) && (
                        <div className="bg-[#F64E60]/10 border border-[#F64E60]/30 rounded-[8px] p-[8px]">
                          <p className="text-[12px] text-[#F64E60] font-medium text-right mb-[4px]">התראות שינוי מחיר:</p>
                          {expenseLineItems
                            .filter(li => li.price_change_pct != null && li.price_change_pct !== 0)
                            .map((li, idx) => (
                              <div key={`alert-${idx}`} className="flex items-center justify-between text-[12px] py-[2px]">
                                <span className={`font-medium ltr-num ${(li.price_change_pct || 0) > 0 ? 'text-[#F64E60]' : 'text-[#3CD856]'}`}>
                                  {(li.price_change_pct || 0) > 0 ? '+' : ''}{li.price_change_pct?.toFixed(1)}%
                                </span>
                                <span className="text-white/70">
                                  {li.description}: &#8362;{li.previous_price?.toFixed(2)} &larr; &#8362;{li.unit_price?.toFixed(2)}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}

                      {/* Existing items table */}
                      {expenseLineItems.length > 0 && (
                        <div className="w-full text-[13px]" dir="rtl">
                          {/* Header */}
                          <div className="flex items-center border-b border-[#4C526B] text-white/60 py-[6px] px-[4px]">
                            <span className="flex-1 text-right">פריט</span>
                            <span className="w-[50px] text-center shrink-0">כמות</span>
                            <span className="w-[80px] text-center shrink-0">מחיר</span>
                            <span className="w-[80px] text-center shrink-0">סה&quot;כ</span>
                            <span className="w-[24px] shrink-0" />
                          </div>
                          {/* Rows */}
                          {expenseLineItems.map((li, idx) => (
                            <div key={`line-${idx}`} className="flex items-center border-b border-[#4C526B]/50 py-[6px] px-[4px]">
                              <span className="flex-1 min-w-0 text-right text-white overflow-hidden text-ellipsis whitespace-nowrap pr-[4px]">{li.description || '-'}</span>
                              <span className="w-[50px] text-center text-white/70 ltr-num shrink-0">{li.quantity ?? '-'}</span>
                              <span className="w-[80px] text-center ltr-num leading-tight shrink-0">
                                <span className="text-white">&#8362;{li.unit_price?.toFixed(2) ?? '0'}</span>
                                {lineItemsPriceCheckDone && li.price_change_pct != null && li.price_change_pct !== 0 && (
                                  <span className={`block text-[9px] ${li.price_change_pct > 0 ? 'text-[#F64E60]' : 'text-[#3CD856]'}`}>
                                    {li.price_change_pct > 0 ? '▲' : '▼'}{Math.abs(li.price_change_pct).toFixed(1)}%
                                  </span>
                                )}
                                {lineItemsPriceCheckDone && li.is_new_item && (
                                  <span className="block text-[9px] text-[#00D4FF]">חדש</span>
                                )}
                              </span>
                              <span className="w-[80px] text-center text-white/70 ltr-num shrink-0">&#8362;{li.total?.toFixed(2) ?? '0'}</span>
                              <span className="w-[24px] text-center shrink-0">
                                <Button
                                  type="button"
                                  onClick={() => setExpenseLineItems(prev => prev.filter((_, i) => i !== idx))}
                                  className="text-[#F64E60]/60 hover:text-[#F64E60] text-[14px] p-0 h-auto"
                                  title="הסר פריט"
                                >&times;</Button>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add new row */}
                      <div className="flex gap-[6px] items-center" dir="rtl">
                        <Input
                          type="text"
                          value={newLineItemDesc}
                          onChange={(e) => setNewLineItemDesc(e.target.value)}
                          placeholder="שם פריט"
                          className="flex-1 h-[40px] bg-transparent border border-[#4C526B] rounded-[8px] text-white text-[14px] text-right px-[8px]"
                        />
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={newLineItemQty}
                          onChange={(e) => setNewLineItemQty(e.target.value)}
                          placeholder="כמות"
                          className="w-[60px] h-[40px] bg-transparent border border-[#4C526B] rounded-[8px] text-white text-[14px] text-center px-[4px] ltr-num"
                        />
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={newLineItemPrice}
                          onChange={(e) => setNewLineItemPrice(e.target.value)}
                          placeholder="מחיר"
                          className="w-[70px] h-[40px] bg-transparent border border-[#4C526B] rounded-[8px] text-white text-[14px] text-center px-[4px] ltr-num"
                        />
                        <Button
                          type="button"
                          onClick={() => {
                            const desc = newLineItemDesc.trim();
                            const qty = parseFloat(newLineItemQty) || null;
                            const price = parseFloat(newLineItemPrice);
                            if (!desc || isNaN(price) || price <= 0) return;
                            const total = qty != null ? qty * price : price;
                            setExpenseLineItems(prev => [...prev, { description: desc, quantity: qty ?? undefined, unit_price: price, total }]);
                            setNewLineItemDesc('');
                            setNewLineItemQty('');
                            setNewLineItemPrice('');
                            setLineItemsPriceCheckDone(false);
                          }}
                          className="h-[40px] px-[12px] bg-[#29318A] text-white text-[14px] rounded-[8px] hover:bg-[#3D44A0] flex-shrink-0"
                        >
                          + הוסף
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">הערות למסמך</label>
                <div className="border border-[#4C526B] rounded-[10px] min-h-[100px]">
                  <Textarea
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
                <Button
                  type="button"
                  onClick={() => {
                    const newVal = !isPaidInFull;
                    setIsPaidInFull(newVal);
                    if (newVal) {
                      const sup = suppliers.find(s => s.id === selectedSupplier);
                      const defaultMethod = sup?.default_payment_method || "";
                      const defaultCardId = sup?.default_credit_card_id || "";
                      const smartDate = defaultMethod
                        ? getSmartPaymentDate(defaultMethod, expenseDate, defaultCardId || undefined)
                        : toLocalDateStr(new Date());
                      setPaymentDate(smartDate);
                      const amount = totalWithVat > 0 ? totalWithVat.toString() : "";
                      setPopupPaymentMethods([{
                        id: 1,
                        method: defaultMethod,
                        amount,
                        installments: "1",
                        checkNumber: "",
                        creditCardId: defaultCardId,
                        customInstallments: amount ? generatePopupInstallments(1, totalWithVat, smartDate) : [],
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
                </Button>

                {/* Payment Details Section - shown when isPaidInFull is true */}
                {isPaidInFull && (
                  <div className="bg-[#0F1535] rounded-[10px] p-[25px_5px_5px] mt-[15px]">
                    <h3 className="text-[18px] font-semibold text-white text-center mb-[20px]">הוספת הוצאה - קליטת תשלום</h3>

                    <div className="flex flex-col gap-[15px]">
                      {/* Payment Date */}
                      <div className="flex flex-col gap-[3px]">
                        <label className="text-[15px] font-medium text-white text-right">תאריך תשלום</label>
                        <DatePickerField
                          value={paymentDate}
                          onChange={(val) => {
                            setPaymentDate(val);
                            setPopupPaymentMethods(prev => prev.map(p => {
                              const numInstallments = parseInt(p.installments) || 1;
                              const totalAmount = parseFloat(p.amount.replace(/[^\d.-]/g, "")) || 0;
                              if (numInstallments >= 1 && totalAmount > 0) {
                                const card = p.creditCardId ? businessCreditCards.find(c => c.id === p.creditCardId) : null;
                                if (card) {
                                  return { ...p, customInstallments: generateCreditCardInstallments(numInstallments, totalAmount, val, card.billing_day) };
                                }
                                return { ...p, customInstallments: generatePopupInstallments(numInstallments, totalAmount, val) };
                              }
                              return { ...p, customInstallments: [] };
                            }));
                          }}
                        />
                      </div>

                      {/* Payment Methods Section */}
                      <div className="flex flex-col gap-[15px]">
                        <div className="flex items-center justify-between">
                          <span className="text-[15px] font-medium text-white">אמצעי תשלום</span>
                          <Button
                            type="button"
                            onClick={addPopupPaymentMethodEntry}
                            className="bg-[#29318A] text-white text-[14px] font-medium px-[12px] py-[6px] rounded-[7px] hover:bg-[#3D44A0] transition-colors"
                          >
                            + הוסף אמצעי תשלום
                          </Button>
                        </div>

                        {popupPaymentMethods.map((pm, pmIndex) => (
                          <div key={pm.id} className="border border-[#4C526B] rounded-[10px] p-[10px] flex flex-col gap-[10px]">
                            {popupPaymentMethods.length > 1 && (
                              <div className="flex items-center justify-between mb-[5px]">
                                <span className="text-[14px] text-white/70">אמצעי תשלום {pmIndex + 1}</span>
                                <Button
                                  type="button"
                                  onClick={() => removePopupPaymentMethodEntry(pm.id)}
                                  className="text-[14px] text-red-400 hover:text-red-300 transition-colors"
                                >
                                  הסר
                                </Button>
                              </div>
                            )}

                            <Select value={pm.method || "__none__"} onValueChange={(val) => updatePopupPaymentMethodField(pm.id, "method", val === "__none__" ? "" : val)}>
                              <SelectTrigger className="w-full bg-transparent border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[18px] text-white text-center">
                                <SelectValue placeholder="בחר אמצעי תשלום..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__" disabled>בחר אמצעי תשלום...</SelectItem>
                                {paymentMethodOptions.map((method) => (
                                  <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            {/* Credit Card Selection - only show when method is credit_card */}
                            {pm.method === "credit_card" && businessCreditCards.length > 0 && (
                              <Select value={pm.creditCardId || "__none__"} onValueChange={(cardId) => {
                                const val = cardId === "__none__" ? "" : cardId;
                                setPopupPaymentMethods(prev => prev.map(p => {
                                  if (p.id !== pm.id) return p;
                                  const updated = { ...p, creditCardId: val };
                                  const card = businessCreditCards.find(c => c.id === val);
                                  const effectiveDate = paymentDate || expenseDate;
                                  if (card && effectiveDate) {
                                    const numInstallments = parseInt(p.installments) || 1;
                                    const totalAmount = parseFloat(p.amount.replace(/[^\d.-]/g, "")) || 0;
                                    if (numInstallments > 1 && totalAmount > 0) {
                                      updated.customInstallments = generateCreditCardInstallments(numInstallments, totalAmount, effectiveDate, card.billing_day);
                                    }
                                  }
                                  return updated;
                                }));
                              }}>
                                <SelectTrigger className="w-full bg-transparent border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[18px] text-white text-center">
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

                            <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={pm.amount}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/[^\d.-]/g, "").replace(/(\..*)\./g, "$1");
                                  updatePopupPaymentMethodField(pm.id, "amount", val);
                                }}
                                placeholder="סכום"
                                className="w-full h-[50px] bg-transparent text-[18px] text-white text-center focus:outline-none px-[10px] rounded-[10px] ltr-num"
                              />
                            </div>

                            <div className="flex flex-col gap-[3px]">
                              <span className="text-[14px] text-white/70">כמות תשלומים</span>
                              <div className="border border-[#4C526B] rounded-[10px] min-h-[50px] flex items-center">
                                <Button
                                  type="button"
                                  title="הפחת תשלום"
                                  onClick={() => updatePopupPaymentMethodField(pm.id, "installments", String(Math.max(1, parseInt(pm.installments) - 1)))}
                                  className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
                                >
                                  -
                                </Button>
                                <Input
                                  type="text"
                                  inputMode="numeric"
                                  title="כמות תשלומים"
                                  value={pm.installments}
                                  onChange={(e) => updatePopupPaymentMethodField(pm.id, "installments", e.target.value.replace(/\D/g, "") || "1")}
                                  className="flex-1 h-[50px] bg-transparent text-[18px] text-white text-center focus:outline-none"
                                />
                                <Button
                                  type="button"
                                  title="הוסף תשלום"
                                  onClick={() => updatePopupPaymentMethodField(pm.id, "installments", String(parseInt(pm.installments) + 1))}
                                  className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
                                >
                                  +
                                </Button>
                              </div>

                              {pm.customInstallments.length > 0 && (
                                <div className="mt-[10px] border border-[#4C526B] rounded-[10px] p-[10px]">
                                  <div className="flex items-center gap-[8px] border-b border-[#4C526B] pb-[8px] mb-[8px]">
                                    <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תשלום</span>
                                    <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תאריך</span>
                                    {pm.method === "check" && <span className="text-[14px] font-medium text-white/70 flex-1 text-center">מס׳ צ׳ק</span>}
                                    <span className="text-[14px] font-medium text-white/70 flex-1 text-center">סכום</span>
                                  </div>
                                  <div className="flex flex-col gap-[8px] max-h-[200px] overflow-y-auto">
                                    {pm.customInstallments.map((item, index) => (
                                      <div key={`${pm.id}-${item.number}`} className="flex items-center gap-[8px]">
                                        <span className="text-[14px] text-white ltr-num flex-1 text-center">{item.number}/{pm.installments}</span>
                                        <div className="flex-1">
                                          <DatePickerField
                                            value={item.dateForInput}
                                            onChange={(val) => handlePopupInstallmentDateChange(pm.id, index, val)}
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
                                              onChange={(e) => handlePopupInstallmentCheckNumberChange(pm.id, index, e.target.value)}
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
                                            value={item.amount % 1 === 0 ? item.amount.toString() : item.amount.toFixed(2)}
                                            onFocus={(e) => e.target.select()}
                                            onChange={(e) => handlePopupInstallmentAmountChange(pm.id, index, e.target.value)}
                                            className="w-full h-[36px] bg-[#29318A]/30 border border-[#4C526B] rounded-[7px] text-[14px] text-white text-center focus:outline-none focus:border-white/50 px-[5px] ltr-num"
                                          />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  {(() => {
                                    const installmentsTotal = getPopupInstallmentsTotal(pm.customInstallments);
                                    const pmTotal = parseFloat(pm.amount.replace(/[^\d.-]/g, "")) || 0;
                                    const isMismatch = Math.abs(installmentsTotal - pmTotal) > 0.01;
                                    return (
                                      <div className="flex items-center gap-[8px] border-t border-[#4C526B] pt-[8px] mt-[8px]">
                                        <span className="text-[14px] font-bold text-white w-[50px] text-center flex-shrink-0">סה&quot;כ</span>
                                        <span className="flex-1"></span>
                                        {pm.method === "check" && <span className="flex-1"></span>}
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
                          <Input
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
                            <Button
                              type="button"
                              onClick={() => { setPaymentReceiptFile(null); setPaymentReceiptPreview(null); }}
                              className="text-[#F64E60] text-[14px] hover:underline"
                            >
                              הסר
                            </Button>
                            <div className="flex items-center gap-[10px]">
                              <span className="text-[14px] text-white/70 truncate max-w-[150px]">
                                {paymentReceiptFile?.name || "קובץ"}
                              </span>
                              <Button
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
                              </Button>
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
                              accept="image/*,.pdf,.heic,.heif,.avif,.bmp,.tiff,.tif"
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
                          <Textarea
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
                    <Button
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
                    </Button>

                    {/* Clarification Menu */}
                    {showClarificationMenu && (
                      <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-[10px] flex flex-col gap-[8px]">
                        {["הזמנה לא סופקה במלואה", "טעות במחיר", "תעודת משלוח", "אחר (פרט/י)"].map((option) => (
                          <Button
                            key={option}
                            type="button"
                            onClick={() => {
                              setClarificationReason(option === "אחר (פרט/י)" ? "" : option);
                              setShowClarificationMenu(false);
                            }}
                            className="text-[15px] text-white text-right py-[8px] px-[10px] hover:bg-[#29318A]/30 rounded-[7px] transition-colors"
                          >
                            {option}
                          </Button>
                        ))}
                      </div>
                    )}

                    {/* Clarification Reason Textarea - shown after selection */}
                    {needsClarification && !showClarificationMenu && (
                      <div className="border border-[#4C526B] rounded-[10px] min-h-[75px]">
                        <Textarea
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
                <Button
                  type="button"
                  onClick={handleSaveExpense}
                  disabled={isSaving}
                  className="flex-1 bg-[#29318A] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-[#3D44A0] disabled:opacity-50"
                >
                  {isSaving ? "שומר..." : "הוספת הוצאה"}
                </Button>
                <Button
                  type="button"
                  onClick={handleClosePopup}
                  className="flex-1 bg-transparent border border-[#4C526B] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-white/10"
                >
                  ביטול
                </Button>
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
            <div className="flex justify-between items-center flex-row-reverse">
              <Button
                type="button"
                onClick={handleCloseEditPopup}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </Button>
              <SheetTitle className="text-white text-xl font-bold">עריכת הוצאה</SheetTitle>
              <div className="w-[24px]" />
            </div>
          </SheetHeader>

            {/* Form */}
            <div className="flex flex-col gap-[15px] px-[5px]">
              {/* Date Field */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">תאריך ערך</label>
                <DatePickerField
                  value={expenseDate}
                  onChange={(val) => {
                    setExpenseDate(val);
                    if (!referenceDateManuallySet.current) {
                      setReferenceDate(val);
                    }
                  }}
                />
              </div>

              {/* Reference Date Field */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">תאריך אסמכתא</label>
                <DatePickerField
                  value={referenceDate}
                  onChange={(val) => {
                    setReferenceDate(val);
                    referenceDateManuallySet.current = true;
                  }}
                />
              </div>

              {/* Supplier Select */}
              <SupplierSearchSelect
                suppliers={suppliers}
                value={selectedSupplier}
                onChange={handleSupplierChange}
              />

              {/* Fixed Expense - Link to existing invoice (mobile) */}
              {fixedOpenInvoices.length > 0 && (() => {
                const supplierInfo = suppliers.find(s => s.id === selectedSupplier);
                if (!supplierInfo?.is_fixed_expense) return null;
                return (
                  <div className="flex flex-col gap-[8px]">
                    <div
                      className="flex items-center gap-[5px] cursor-pointer"
                      dir="rtl"
                      onClick={() => setShowFixedInvoices(!showFixedInvoices)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={`text-white/70 transition-transform ${showFixedInvoices ? "rotate-180" : ""}`}>
                        <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span className="text-[14px] font-medium text-[#bc76ff]">
                        הוצאה חודשית קבועה — {fixedOpenInvoices.length} חשבוניות פתוחות
                      </span>
                    </div>
                    {showFixedInvoices && (
                      <div className="flex flex-col gap-[6px] pr-[10px]">
                        <Button
                          type="button"
                          onClick={() => setLinkToFixedInvoiceId(null)}
                          className={`w-full text-right px-[12px] py-[10px] rounded-[10px] text-[13px] transition-all ${
                            linkToFixedInvoiceId === null
                              ? "bg-[#4F46E5] text-white border border-white/30"
                              : "bg-[#1A2150] text-white/70 border border-white/10 hover:bg-[#1A2150]/80"
                          }`}
                        >
                          פתח חשבונית חדשה
                        </Button>
                        {fixedOpenInvoices.map(inv => (
                          <Button
                            key={inv.id}
                            type="button"
                            onClick={() => {
                              setLinkToFixedInvoiceId(inv.id);
                              setAmountBeforeVat(String(inv.subtotal));
                              // Auto-set expense date to the original invoice date
                              setExpenseDate(inv.invoice_date);
                              if (supplierInfo.vat_type === "none") {
                                setPartialVat(true);
                                setVatAmount("0");
                              }
                            }}
                            className={`w-full text-right px-[12px] py-[10px] rounded-[10px] text-[13px] transition-all ${
                              linkToFixedInvoiceId === inv.id
                                ? "bg-[#4F46E5] text-white border border-white/30"
                                : "bg-[#1A2150] text-white/70 border border-white/10 hover:bg-[#1A2150]/80"
                            }`}
                          >
                            {inv.month} — ₪{inv.total_amount.toLocaleString("he-IL")}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Invoice Number */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-normal text-white text-right">מספר חשבונית / תעודת משלוח</label>
                <div className={`border rounded-[10px] h-[50px] ${duplicateWarning ? "border-[#F59E0B]" : "border-[#4C526B]"}`}>
                  <Input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="מספר חשבונית..."
                    className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
                  />
                </div>
                {duplicateWarning && (
                  <div className="p-[8px_12px] bg-[#F59E0B]/15 border border-[#F59E0B]/40 rounded-[8px] text-[#F59E0B] text-[13px] font-medium text-right" dir="rtl">
                    ⚠️ {duplicateWarning}
                  </div>
                )}
              </div>

              {/* Amount Before VAT */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">סכום לפני מע&apos;&apos;מ</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <Input
                    type="text"
                    inputMode="decimal"
                    title="סכום לפני מע״מ"
                    value={amountBeforeVat && !isNaN(parseFloat(amountBeforeVat)) ? (amountBeforeVat.endsWith(".") ? parseFloat(amountBeforeVat).toLocaleString("en-US", { maximumFractionDigits: 0 }) + "." : parseFloat(amountBeforeVat).toLocaleString("en-US", { maximumFractionDigits: 2 })) : amountBeforeVat}
                    onChange={(e) => setAmountBeforeVat(e.target.value.replace(/,/g, ""))}
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
                    <Input
                      type="text"
                      inputMode="decimal"
                      title="סכום מע״מ"
                      placeholder="0.00"
                      value={partialVat ? vatAmount : calculatedVat.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      onChange={(e) => setVatAmount(e.target.value.replace(/,/g, ""))}
                      disabled={!partialVat}
                      className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px] disabled:text-white/50"
                    />
                  </div>
                </div>
                <div className="flex flex-col items-center gap-[5px]">
                  <Button
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
                  </Button>
                  <span className="text-[15px] font-medium text-white">הזנת סכום מע&quot;מ ידני</span>
                </div>
              </div>

              {/* Total with VAT (read-only) */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">סכום כולל מע&quot;מ</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <Input
                    type="text"
                    readOnly
                    value={((parseFloat(amountBeforeVat) || 0) + (partialVat ? (parseFloat(vatAmount) || 0) : calculatedVat)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                      <div key={`edit-preview-${preview}`} className="flex flex-col items-center gap-[4px]">
                        <div className="relative border border-[#4C526B] rounded-[8px] overflow-hidden w-[100px] h-[100px]">
                          {isPdfUrl(preview) ? (
                            <PdfThumbnail url={preview} className="w-full h-full cursor-pointer" onClick={() => window.open(preview, '_blank')} />
                          ) : (
                            <Image src={preview} alt={`תמונה ${idx + 1}`} className="w-full h-full object-cover cursor-pointer" onClick={() => window.open(preview, '_blank')} width={100} height={100} unoptimized />
                          )}
                        </div>
                        <Button
                          type="button"
                          onClick={() => handleRemoveEditAttachment(idx)}
                          className="text-[#F64E60] hover:text-[#ff3547] transition-colors"
                          title="הסר קובץ"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            <line x1="10" y1="11" x2="10" y2="17"/>
                            <line x1="14" y1="11" x2="14" y2="17"/>
                          </svg>
                        </Button>
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
                    accept="image/*,.pdf,.heic,.heif,.avif,.bmp,.tiff,.tif"
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
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="הערות למסמך..."
                    className="w-full h-full min-h-[100px] bg-transparent text-white text-[16px] text-right rounded-[10px] border-none outline-none p-[10px] resize-none"
                  />
                </div>
              </div>

              {/* Clarification Reason - only show for invoices with "בבירור" status */}
              {editingInvoice?.status === "בבירור" && (
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[15px] font-medium text-[#FFA500] text-right">סיבת בירור</label>
                  <div className="border border-[#FFA500]/50 rounded-[10px] min-h-[80px]">
                    <Textarea
                      value={clarificationReason}
                      onChange={(e) => setClarificationReason(e.target.value)}
                      placeholder="סיבת הבירור..."
                      className="w-full h-full min-h-[80px] bg-transparent text-white text-[16px] text-right rounded-[10px] border-none outline-none p-[10px] resize-none"
                    />
                  </div>
                </div>
              )}

              {/* Status Select */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[15px] font-medium text-white text-right">סטטוס</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px] appearance-none cursor-pointer"
                    style={{ direction: 'rtl' }}
                  >
                    <option value="pending" className="bg-[#1A1F3D]">ממתין לתשלום</option>
                    <option value="paid" className="bg-[#1A1F3D]">שולם</option>
                    <option value="clarification" className="bg-[#1A1F3D]">בבירור</option>
                  </select>
                </div>
              </div>

              {/* Submit and Cancel Buttons */}
              <div className="flex gap-[10px] mt-[10px] mb-[10px]">
                <Button
                  type="button"
                  onClick={handleSaveEditedExpense}
                  disabled={isSaving || isUploadingAttachment}
                  className="flex-1 bg-[#29318A] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-[#3D44A0] disabled:opacity-50"
                >
                  {isSaving ? "שומר..." : isUploadingAttachment ? "מעלה קובץ..." : "שמור שינויים"}
                </Button>
                <Button
                  type="button"
                  onClick={handleCloseEditPopup}
                  className="flex-1 bg-transparent border border-[#4C526B] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-white/10"
                >
                  ביטול
                </Button>
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
              <Button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 bg-[#F64E60] text-white text-[16px] font-semibold py-[12px] rounded-[10px] transition-colors hover:bg-[#D9414F] disabled:opacity-50"
              >
                {isDeleting ? "מוחק..." : "מחק"}
              </Button>
              <Button
                type="button"
                onClick={handleCancelDelete}
                className="flex-1 bg-transparent border border-[#4C526B] text-white text-[16px] font-semibold py-[12px] rounded-[10px] transition-colors hover:bg-white/10"
              >
                ביטול
              </Button>
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
            <div className="flex justify-between items-center flex-row-reverse">
              <Button
                type="button"
                onClick={handleClosePaymentPopup}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </Button>
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
                <DatePickerField
                  value={paymentDate}
                  onChange={(val) => {
                    setPaymentDate(val);
                    // Recalculate all installment dates based on new date
                    setPopupPaymentMethods(prev => prev.map(p => {
                      const numInstallments = parseInt(p.installments) || 1;
                      const totalAmount = parseFloat(p.amount.replace(/[^\d.-]/g, "")) || 0;
                      if (numInstallments > 1 && totalAmount > 0) {
                        const card = p.creditCardId ? businessCreditCards.find(c => c.id === p.creditCardId) : null;
                        if (card) {
                          return { ...p, customInstallments: generateCreditCardInstallments(numInstallments, totalAmount, val, card.billing_day) };
                        }
                        return { ...p, customInstallments: generatePopupInstallments(numInstallments, totalAmount, val) };
                      }
                      return { ...p, customInstallments: [] };
                    }));
                  }}
                />
              </div>

              {/* Payment Methods Section */}
              <div className="flex flex-col gap-[15px]">
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-medium text-white">אמצעי תשלום</span>
                  <Button
                    type="button"
                    onClick={addPopupPaymentMethodEntry}
                    className="bg-[#29318A] text-white text-[14px] font-medium px-[12px] py-[6px] rounded-[7px] hover:bg-[#3D44A0] transition-colors"
                  >
                    + הוסף אמצעי תשלום
                  </Button>
                </div>

                {popupPaymentMethods.map((pm, pmIndex) => (
                  <div key={pm.id} className="border border-[#4C526B] rounded-[10px] p-[10px] flex flex-col gap-[10px]">
                    {/* Header with remove button */}
                    {popupPaymentMethods.length > 1 && (
                      <div className="flex items-center justify-between mb-[5px]">
                        <span className="text-[14px] text-white/70">אמצעי תשלום {pmIndex + 1}</span>
                        <Button
                          type="button"
                          onClick={() => removePopupPaymentMethodEntry(pm.id)}
                          className="text-[14px] text-red-400 hover:text-red-300 transition-colors"
                        >
                          הסר
                        </Button>
                      </div>
                    )}

                    {/* Payment Method Select */}
                    <Select value={pm.method || "__none__"} onValueChange={(val) => updatePopupPaymentMethodField(pm.id, "method", val === "__none__" ? "" : val)}>
                      <SelectTrigger className="w-full bg-transparent border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[18px] text-white text-center">
                        <SelectValue placeholder="בחר אמצעי תשלום..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" disabled>בחר אמצעי תשלום...</SelectItem>
                        {paymentMethodOptions.map((method) => (
                          <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Credit Card Selection - only show when method is credit_card */}
                    {pm.method === "credit_card" && businessCreditCards.length > 0 && (
                      <Select value={pm.creditCardId || "__none__"} onValueChange={(cardId) => {
                        const val = cardId === "__none__" ? "" : cardId;
                        setPopupPaymentMethods(prev => prev.map(p => {
                          if (p.id !== pm.id) return p;
                          const updated = { ...p, creditCardId: val };
                          const card = businessCreditCards.find(c => c.id === val);
                          if (card && paymentDate) {
                            const numInstallments = parseInt(p.installments) || 1;
                            const totalAmount = parseFloat(p.amount.replace(/[^\d.-]/g, "")) || 0;
                            if (numInstallments > 1 && totalAmount > 0) {
                              updated.customInstallments = generateCreditCardInstallments(numInstallments, totalAmount, paymentDate, card.billing_day);
                            }
                          }
                          return updated;
                        }));
                      }}>
                        <SelectTrigger className="w-full bg-transparent border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[18px] text-white text-center">
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
                        value={pm.amount}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.-]/g, "").replace(/(\..*)\./g, "$1");
                          updatePopupPaymentMethodField(pm.id, "amount", val);
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
                          onClick={() => updatePopupPaymentMethodField(pm.id, "installments", String(Math.max(1, parseInt(pm.installments) - 1)))}
                          className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
                        >
                          -
                        </Button>
                        <Input
                          type="text"
                          inputMode="numeric"
                          title="כמות תשלומים"
                          value={pm.installments}
                          onChange={(e) => updatePopupPaymentMethodField(pm.id, "installments", e.target.value.replace(/\D/g, "") || "1")}
                          className="flex-1 h-[50px] bg-transparent text-[18px] text-white text-center focus:outline-none"
                        />
                        <Button
                          type="button"
                          title="הוסף תשלום"
                          onClick={() => updatePopupPaymentMethodField(pm.id, "installments", String(parseInt(pm.installments) + 1))}
                          className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
                        >
                          +
                        </Button>
                      </div>

                      {/* Installments Breakdown */}
                      {pm.customInstallments.length > 0 && (
                        <div className="mt-[10px] border border-[#4C526B] rounded-[10px] p-[10px]">
                          <div className="flex items-center border-b border-[#4C526B] pb-[8px] mb-[8px]">
                            <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תשלום</span>
                            <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תאריך</span>
                            {pm.method === "check" && <span className="text-[14px] font-medium text-white/70 flex-1 text-center">מס׳ צ׳ק</span>}
                            <span className="text-[14px] font-medium text-white/70 flex-1 text-center">סכום</span>
                          </div>
                          <div className="flex flex-col gap-[8px] max-h-[200px] overflow-y-auto">
                            {pm.customInstallments.map((item, index) => (
                              <div key={`${pm.id}-${item.number}`} className="flex items-center gap-[8px]">
                                <span className="text-[14px] text-white ltr-num flex-1 text-center">{item.number}/{pm.installments}</span>
                                <div className="flex-1">
                                  <DatePickerField
                                    value={item.dateForInput}
                                    onChange={(val) => handlePopupInstallmentDateChange(pm.id, index, val)}
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
                                      onChange={(e) => handlePopupInstallmentCheckNumberChange(pm.id, index, e.target.value)}
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
                                    value={item.amount % 1 === 0 ? item.amount.toString() : item.amount.toFixed(2)}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) => handlePopupInstallmentAmountChange(pm.id, index, e.target.value)}
                                    className="w-full h-[36px] bg-[#29318A]/30 border border-[#4C526B] rounded-[7px] text-[14px] text-white text-center focus:outline-none focus:border-white/50 px-[5px] ltr-num"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                          {(() => {
                            const installmentsTotal = getPopupInstallmentsTotal(pm.customInstallments);
                            const pmTotal = parseFloat(pm.amount.replace(/[^\d.-]/g, "")) || 0;
                            const isMismatch = Math.abs(installmentsTotal - pmTotal) > 0.01;
                            return (
                              <div className="flex items-center border-t border-[#4C526B] pt-[8px] mt-[8px]">
                                <span className="text-[14px] font-bold text-white w-[50px] text-center flex-shrink-0">סה&quot;כ</span>
                                <span className="flex-1"></span>
                                {pm.method === "check" && <span className="flex-1"></span>}
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
                  <Input
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
                    <Button
                      type="button"
                      onClick={() => { setPaymentReceiptFile(null); setPaymentReceiptPreview(null); }}
                      className="text-[#F64E60] text-[14px] hover:underline"
                    >
                      הסר
                    </Button>
                    <div className="flex items-center gap-[10px]">
                      <span className="text-[14px] text-white/70 truncate max-w-[150px]">
                        {paymentReceiptFile?.name || "קובץ"}
                      </span>
                      <Button
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
                      </Button>
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
                      accept="image/*,.pdf,.heic,.heif,.avif,.bmp,.tiff,.tif"
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
                  <Textarea
                    title="הערות לתשלום"
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    className="w-full h-full min-h-[75px] bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none p-[10px] resize-none"
                  />
                </div>
              </div>

              {/* Submit and Cancel Buttons */}
              <div className="flex gap-[10px] mt-[10px] mb-[10px]">
                <Button
                  type="button"
                  onClick={handleSavePayment}
                  disabled={isSaving || isUploadingPaymentReceipt}
                  className="flex-1 bg-[#00E096] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-[#00C080] disabled:opacity-50"
                >
                  {isSaving ? "שומר..." : isUploadingPaymentReceipt ? "מעלה קובץ..." : "אשר תשלום"}
                </Button>
                <Button
                  type="button"
                  onClick={handleClosePaymentPopup}
                  className="flex-1 bg-transparent border border-[#4C526B] text-white text-[18px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-white/10"
                >
                  ביטול
                </Button>
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
            <Button
              type="button"
              onClick={handleCloseSupplierBreakdown}
              className="self-end text-white/50 hover:text-white transition-colors"
              title="סגור"
              aria-label="סגור"
            >
              <X className="w-[30px] h-[30px]" />
            </Button>

            {/* Supplier Title */}
            <h2 className="text-[25px] font-semibold text-white text-center">{breakdownSupplierName}</h2>

            {/* Summary Row */}
            <div className="flex items-center justify-between mx-[10px] mb-[15px]">
              <div className="flex flex-col items-center">
                <span className="text-[20px] font-bold text-white">{breakdownSupplierCategory}</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[20px] font-bold text-white ltr-num">₪{breakdownSupplierInvoices.reduce((sum, inv) => sum + (Number(inv.amountWithVat) || 0), 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span className="text-[14px] text-white/70">כולל מע&quot;מ · {breakdownSupplierInvoices.length} חשבוניות</span>
              </div>
            </div>

            {/* Invoices Table */}
            <div className="flex flex-col">
              {/* Table Header */}
              <div className="flex items-center justify-between border-b border-white/25 pb-[8px] px-[5px]">
                <span className="text-[14px] font-medium text-white text-right" style={{ width: 81, maxWidth: 81 }}>תאריך</span>
                <span className="text-[14px] font-medium text-white text-center" style={{ width: 66, maxWidth: 66 }}>מספר חשבונית</span>
                <span className="text-[14px] font-medium text-white text-center" style={{ width: 65, maxWidth: 65 }}>סכום לפני מע&quot;מ</span>
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
                    <div className="flex flex-col text-right" style={{ width: 81, maxWidth: 81 }}>
                      <span className="text-[14px] text-white ltr-num">{inv.date}</span>
                      {inv.referenceDate && <span className="text-[10px] text-white/40 ltr-num">אסמכתא: {inv.referenceDate}</span>}
                    </div>
                    <span className="text-[14px] text-white text-center ltr-num" style={{ width: 66, maxWidth: 66 }}>{inv.reference || "-"}</span>
                    <span className="text-[14px] text-white text-center ltr-num" style={{ width: 65, maxWidth: 65 }}>₪{inv.amountBeforeVat.toLocaleString()}</span>
                    <span className="text-[12px] text-center ltr-num" style={{ width: 60, maxWidth: 60 }}>
                      {inv.approval_status === 'pending_review' ? (
                        <button
                          className="text-[10px] font-bold px-[7px] py-[3px] rounded-full bg-white/20 text-white/60 hover:bg-green-500 hover:text-white transition-colors whitespace-nowrap"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await approveInvoice(inv.id);
                              showToast("החשבונית אושרה", "success");
                            } catch (err) {
                              showToast(err instanceof Error ? err.message : "שגיאה באישור החשבונית", "error");
                            }
                          }}
                        >
                          ממתין ✓
                        </button>
                      ) : (
                        <span className={`px-[7px] py-[3px] rounded-full ${
                          inv.status === "שולם" ? "bg-[#00E096]/20 text-[#00E096]" :
                          inv.status === "בבירור" ? "bg-[#FFA500]/20 text-[#FFA500]" :
                          inv.status === "ת. משלוח" ? "bg-[#00bcd4] text-white" :
                          "bg-[#29318A] text-white"
                        }`}>
                          {inv.status}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center justify-center gap-[4px]" style={{ width: 76, maxWidth: 76 }}>
                      {inv.notes && inv.notes.trim() && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              onClick={(e) => e.stopPropagation()}
                              className="w-[25px] h-[25px] flex items-center justify-center text-[#FFA412] hover:text-[#FFB84D] transition-colors"
                              title="הערות"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                              </svg>
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="bg-[#1A1F3D] border border-[#4C526B] rounded-[8px] p-[12px] max-w-[250px] text-right" dir="rtl" side="top">
                            <p className="text-[12px] text-[#FFA412] font-semibold mb-[4px]">הערות</p>
                            <p className="text-[13px] text-white leading-[1.5]">{inv.notes}</p>
                          </PopoverContent>
                        </Popover>
                      )}
                      {isAdmin && (
                        <Button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(inv.id, inv.documentType);
                          }}
                          className="w-[25px] h-[25px] flex items-center justify-center text-white/50 hover:text-white transition-colors"
                          title="מחק"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </Button>
                      )}
                      {inv.attachmentUrls.length > 0 && (
                        <Button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewerDocUrl(inv.attachmentUrls[0]);
                          }}
                          className="w-[25px] h-[25px] flex items-center justify-center text-white/50 hover:text-white transition-colors"
                          title="צפה בקובץ"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                            <path d="M21 15L16 10L5 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Show All Invoices Button */}
            <Button
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
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Fullscreen Document Viewer Popup */}
      {viewerDocUrl && typeof window !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80"
          onClick={(e) => { e.stopPropagation(); setViewerDocUrl(null); }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <Button
            type="button"
            onClick={(e) => { e.stopPropagation(); setViewerDocUrl(null); }}
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
                  <Button
                    key={option}
                    type="button"
                    onClick={() => {
                      setStatusClarificationReason(option === "אחר (פרט/י)" ? "" : option);
                      setShowStatusClarificationMenu(false);
                    }}
                    className="text-[14px] text-white text-right py-[10px] px-[10px] hover:bg-[#29318A]/30 rounded-[7px] transition-colors border border-white/10"
                  >
                    {option}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-[10px] mb-[15px]">
                {/* Reason textarea */}
                <div>
                  <div className="flex items-center justify-between mb-[5px]">
                    <span className="text-[13px] text-white/60">סיבת בירור:</span>
                    <Button
                      type="button"
                      onClick={() => setShowStatusClarificationMenu(true)}
                      className="text-[12px] text-[#3F97FF] hover:underline"
                    >
                      שנה בחירה
                    </Button>
                  </div>
                  <Textarea
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
                        <Image src={statusClarificationFilePreview} alt="תצוגה מקדימה" className="w-[50px] h-[50px] object-cover rounded-[6px]" width={50} height={50} unoptimized />
                      ) : (
                        <div className="w-[50px] h-[50px] flex items-center justify-center bg-white/5 rounded-[6px]">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/50">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                          </svg>
                        </div>
                      )}
                      <span className="text-[12px] text-white/70 flex-1 truncate">{statusClarificationFile?.name}</span>
                      <Button
                        type="button"
                        onClick={() => { setStatusClarificationFile(null); setStatusClarificationFilePreview(null); }}
                        className="text-[#F64E60] text-[18px] hover:text-[#ff7585]"
                      >
                        ✕
                      </Button>
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
                        accept="image/*,.pdf,.heic,.heif,.avif,.bmp,.tiff,.tif"
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
                  <Button
                    type="button"
                    onClick={handleSaveClarification}
                    disabled={isSavingClarification}
                    className="flex-1 bg-[#FFA500] hover:bg-[#e69500] disabled:opacity-50 text-[#0F1535] text-[14px] font-bold py-[10px] rounded-[8px] transition-colors flex items-center justify-center gap-[4px]"
                  >
                    {isSavingClarification ? (
                      <div className="w-4 h-4 border-2 border-[#0F1535]/30 border-t-[#0F1535] rounded-full animate-spin" />
                    ) : "העבר לבבירור"}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setShowClarificationPopup(false)}
                    className="flex-1 bg-white/10 hover:bg-white/20 text-white text-[14px] py-[10px] rounded-[8px] transition-colors"
                  >
                    ביטול
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Duplicate Invoice Number Confirmation */}
      {duplicateInvoicePrompt && typeof window !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/60"
          style={{ pointerEvents: 'auto' }}
          onPointerDownCapture={(e) => e.stopPropagation()}
          onMouseDownCapture={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setDuplicateInvoicePrompt(null); }}
        >
          <div
            dir="rtl"
            className="bg-[#1A1F4E] rounded-[14px] border border-white/20 shadow-2xl p-[20px] w-[340px]"
            onPointerDownCapture={(e) => e.stopPropagation()}
            onMouseDownCapture={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[16px] font-bold text-white text-center mb-[12px]">חשבונית כפולה</h3>
            <p className="text-[14px] text-white/80 text-center mb-[20px]">
              כבר קיימת חשבונית עם מספר <span className="font-bold text-white ltr-num">{duplicateInvoicePrompt.invoiceNumber}</span> עבור ספק זה.
              <br />האם לשמור בכל זאת?
            </p>
            <div className="flex gap-[10px]">
              <Button
                type="button"
                onPointerDownCapture={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setDuplicateInvoicePrompt(null);
                  duplicateProceedRef.current = () => {};
                  handleSaveExpense();
                }}
                className="flex-1 bg-[#FFA500] hover:bg-[#e8970e] text-[#0F1535] text-[14px] font-bold py-[10px] rounded-[8px] transition-colors"
              >
                שמור בכל זאת
              </Button>
              <Button
                type="button"
                onPointerDownCapture={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setDuplicateInvoicePrompt(null); }}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white text-[14px] py-[10px] rounded-[8px] transition-colors"
              >
                ביטול
              </Button>
            </div>
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
              <Button
                type="button"
                onClick={confirmStatusChange}
                disabled={isUpdatingStatus}
                className="flex-1 bg-[#3CD856] hover:bg-[#2db845] disabled:opacity-50 text-[#0F1535] text-[14px] font-bold py-[10px] rounded-[8px] transition-colors flex items-center justify-center gap-[4px]"
              >
                {isUpdatingStatus ? (
                  <div className="w-4 h-4 border-2 border-[#0F1535]/30 border-t-[#0F1535] rounded-full animate-spin" />
                ) : "אישור"}
              </Button>
              <Button
                type="button"
                onClick={() => setStatusConfirm(null)}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white text-[14px] py-[10px] rounded-[8px] transition-colors"
              >
                ביטול
              </Button>
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
          <Button
            type="button"
            onClick={() => handleStatusChange(showStatusMenu, 'pending')}
            disabled={isUpdatingStatus}
            className="w-full px-[12px] py-[8px] text-[13px] text-right hover:bg-white/10 transition-colors flex items-center gap-[8px] text-white"
          >
            <span className="w-[10px] h-[10px] rounded-full bg-[#29318A]"></span>
            <span>ממתין</span>
          </Button>
          <Button
            type="button"
            onClick={() => handleStatusChange(showStatusMenu, 'clarification')}
            disabled={isUpdatingStatus}
            className="w-full px-[12px] py-[8px] text-[13px] text-right hover:bg-white/10 transition-colors flex items-center gap-[8px] text-white"
          >
            <span className="w-[10px] h-[10px] rounded-full bg-[#FFA500]"></span>
            <span>בבירור</span>
          </Button>
          <Button
            type="button"
            onClick={() => handleStatusChange(showStatusMenu, 'paid')}
            disabled={isUpdatingStatus}
            className="w-full px-[12px] py-[8px] text-[13px] text-right hover:bg-white/10 transition-colors flex items-center gap-[8px] text-white"
          >
            <span className="w-[10px] h-[10px] rounded-full bg-[#00E096]"></span>
            <span>שולם</span>
          </Button>
        </div>,
        document.body
      )}
    </div>
  );
}
