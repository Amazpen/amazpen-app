'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import type { OCRDocument, OCRFormData, DocumentType, ExpenseType, OCRLineItem } from '@/types/ocr';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useFormDraft } from '@/hooks/useFormDraft';
import { createClient } from '@/lib/supabase/client';
import { useMultiTableRealtime } from '@/hooks/useRealtimeSubscription';
import SupplierSearchSelect from '@/components/ui/SupplierSearchSelect';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerField } from "@/components/ui/date-picker-field";

interface Supplier {
  id: string;
  name: string;
  notes?: string | null;
  default_payment_method?: string | null;
  default_credit_card_id?: string | null;
  default_discount_percentage?: number | null;
  waiting_for_coordinator?: boolean;
  is_fixed_expense?: boolean;
  vat_type?: string | null;
  // DB values: 'current_expenses' | 'goods_purchases' | 'employee_costs'
  expense_type?: string | null;
}

interface Business {
  id: string;
  name: string;
  vat_percentage?: number;
}

interface CoordinatorSupplier {
  id: string;
  name: string;
  waiting_for_coordinator?: boolean;
}

interface DeliveryNoteEntry {
  delivery_note_number: string;
  delivery_date: string;
  total_amount: string;
  notes: string;
}

interface OCRFormProps {
  document: OCRDocument | null;
  suppliers: Supplier[];
  coordinatorSuppliers: CoordinatorSupplier[];
  businesses: Business[];
  selectedBusinessId: string;
  onBusinessChange: (businessId: string) => void;
  onApprove: (formData: OCRFormData) => void;
  onReject: (documentId: string, reason?: string) => void;
  onDelete?: (documentId: string) => void;
  onSkip?: () => void;
  isLoading?: boolean;
  showCalculator?: boolean;
  onCalculatorToggle?: () => void;
  mergedDocuments?: OCRDocument[];
  pendingDocuments?: OCRDocument[];
  onMergeDocuments?: (docs: OCRDocument[]) => void;
}

// Tabs for document type selection
// Only 4 top-level tabs. Legacy types (delivery_note / disputed_invoice /
// partially_paid) are now expressed as toggles *inside* the invoice tab:
// - delivery_note  → invoice + "שייך למרכזת (ת.מ)"   (isSummaryLinked)
// - disputed_invoice → invoice + "מסמך בבירור"      (isDisputed)
// - partially_paid → invoice (simply unpaid invoice; isPaid=false)
const DOCUMENT_TABS: { value: DocumentType; label: string }[] = [
  { value: 'invoice', label: 'חשבונית' },
  { value: 'payment', label: 'תשלום' },
  { value: 'summary', label: 'מרכזת' },
  { value: 'daily_entry', label: 'רישום יומי' },
];

// Hebrew month grouping helpers (mirrors payments/page.tsx)
const HEBREW_MONTH_NAMES = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

function getMonthYearKey(dateStr: string): string {
  // If we got a clean YYYY-MM-DD already, parse the parts directly to avoid
  // any timezone conversion that could push a 31.03 value into April locally.
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}`;
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthYearLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${HEBREW_MONTH_NAMES[parseInt(month, 10) - 1]}, ${year}`;
}

function groupByMonth<T extends { [k: string]: unknown }>(items: T[], dateField: keyof T): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getMonthYearKey(String(item[dateField]));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
}

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'העברה בנקאית' },
  { value: 'cash', label: 'מזומן' },
  { value: 'check', label: "צ'ק" },
  { value: 'bit', label: 'ביט' },
  { value: 'paybox', label: 'פייבוקס' },
  { value: 'credit_card', label: 'כרטיס אשראי' },
  { value: 'credit_company', label: 'חברות הקפה' },
  { value: 'standing_order', label: 'הוראת קבע' },
  { value: 'other', label: 'אחר' },
];

const DEFAULT_businessVatRate = 0.18;

// Payment method entry for multiple payment methods support
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

export default function OCRForm({
  document,
  suppliers,
  coordinatorSuppliers,
  businesses,
  selectedBusinessId,
  onBusinessChange,
  onApprove,
  onReject,
  onDelete,
  onSkip,
  isLoading = false,
  showCalculator = false,
  onCalculatorToggle,
  mergedDocuments = [],
  pendingDocuments = [],
  onMergeDocuments,
}: OCRFormProps) {
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Draft persistence
  const draftKey = `ocrForm:draft:${selectedBusinessId}:${document?.id || 'none'}`;
  const { saveDraft, restoreDraft, clearDraft } = useFormDraft(draftKey);
  const draftRestored = useRef(false);
  // Keep a ref of `suppliers` so the OCR-data populate effect can read the
  // latest list without depending on `suppliers` (which would re-run the effect
  // every time the realtime subscription rebuilds the array, wiping out manual
  // edits like "delete all line items").
  const suppliersRef = useRef<Supplier[]>(suppliers);
  useEffect(() => { suppliersRef.current = suppliers; }, [suppliers]);

  // Form state
  const [documentType, setDocumentType] = useState<DocumentType>('invoice');
  const [expenseType, setExpenseType] = useState<ExpenseType>('goods');
  const [supplierId, setSupplierId] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountPercentage, setDiscountPercentage] = useState('');
  const [amountBeforeVat, setAmountBeforeVat] = useState('');
  const [vatAmount, setVatAmount] = useState('');
  const [partialVat, setPartialVat] = useState(false);
  const [notes, setNotes] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [isDisputed, setIsDisputed] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [isSummaryLinked, setIsSummaryLinked] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectCustomText, setRejectCustomText] = useState('');

  // Merge documents state
  const [showMergePicker, setShowMergePicker] = useState(false);
  const [mergeSelectedIds, setMergeSelectedIds] = useState<Set<string>>(new Set());
  // Preview a single doc full-screen from inside the merge picker.
  const [mergePreviewUrl, setMergePreviewUrl] = useState<string | null>(null);

  // Fixed-expense linking — when the selected supplier is marked as is_fixed_expense,
  // pull their currently-open monthly invoices so the user can attach this document
  // to an existing placeholder invoice instead of creating a duplicate.
  const [fixedOpenInvoices, setFixedOpenInvoices] = useState<{ id: string; invoice_date: string; subtotal: number; total_amount: number; month: string }[]>([]);
  const [linkToFixedInvoiceId, setLinkToFixedInvoiceId] = useState<string | null>(null); // null = create new
  const [showFixedInvoices, setShowFixedInvoices] = useState(false);

  // Fetch open fixed-expense invoices whenever the user picks a fixed-expense supplier
  useEffect(() => {
    const sel = suppliers.find(s => s.id === supplierId);
    if (!supplierId || !selectedBusinessId || !sel?.is_fixed_expense) {
      setFixedOpenInvoices([]);
      setLinkToFixedInvoiceId(null);
      setShowFixedInvoices(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // Only placeholder invoices (missing either invoice_number OR attachment)
      // are actually "open for linking" — a fixed-expense row that already has
      // both a reference number and a scanned document is fully filled and
      // shouldn't appear in the linking list.
      const { data: openInvs } = await supabase
        .from('invoices')
        .select('id, invoice_date, subtotal, total_amount, invoice_number, attachment_url')
        .eq('business_id', selectedBusinessId)
        .eq('supplier_id', supplierId)
        .eq('status', 'pending')
        .is('deleted_at', null)
        .or('invoice_number.is.null,attachment_url.is.null')
        .order('invoice_date', { ascending: false });

      if (cancelled) return;
      // Belt-and-suspenders: also filter empty strings, since PostgREST's
      // `.is.null` only matches NULL, not ''.
      const placeholders = (openInvs || []).filter(inv => {
        const hasRef = inv.invoice_number && String(inv.invoice_number).trim() !== '';
        const hasAtt = inv.attachment_url && String(inv.attachment_url).trim() !== '';
        return !(hasRef && hasAtt);
      });
      if (placeholders.length > 0) {
        const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
        const mapped = placeholders.map(inv => {
          const d = new Date(inv.invoice_date as string);
          return {
            id: inv.id as string,
            invoice_date: inv.invoice_date as string,
            subtotal: Number(inv.subtotal),
            total_amount: Number(inv.total_amount),
            month: `חודש ${monthNames[d.getMonth()]}, ${d.getFullYear()}`,
          };
        });
        setFixedOpenInvoices(mapped);
        setShowFixedInvoices(true);
      } else {
        setFixedOpenInvoices([]);
        setShowFixedInvoices(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supplierId, selectedBusinessId, suppliers]);

  // Payment fields for invoice tab (when isPaid is checked) - single payment method
  const [inlinePaymentMethod, setInlinePaymentMethod] = useState('');
  const [inlinePaymentDate, setInlinePaymentDate] = useState('');
  const [inlinePaymentReference, setInlinePaymentReference] = useState('');
  const [inlinePaymentNotes, setInlinePaymentNotes] = useState('');

  // Payment tab - multiple payment methods (aligned with payments page)
  const [paymentTabDate, setPaymentTabDate] = useState('');
  const [paymentTabExpenseType, setPaymentTabExpenseType] = useState<'all' | 'expenses' | 'purchases' | 'employees'>('all');
  const [paymentTabSupplierId, setPaymentTabSupplierId] = useState('');
  const [paymentTabReference, setPaymentTabReference] = useState('');
  const [paymentTabNotes, setPaymentTabNotes] = useState('');

  // Payment tab — open invoices for linking (mirrors payments/page.tsx)
  type PaymentOpenInvoice = { id: string; invoice_number: string | null; invoice_date: string; total_amount: number; status: string };
  const [paymentOpenInvoices, setPaymentOpenInvoices] = useState<PaymentOpenInvoice[]>([]);
  const [paymentSelectedInvoiceIds, setPaymentSelectedInvoiceIds] = useState<Set<string>>(new Set());
  const [paymentExpandedMonths, setPaymentExpandedMonths] = useState<Set<string>>(new Set());
  const [paymentIsLoadingInvoices, setPaymentIsLoadingInvoices] = useState(false);

  // Fetch open invoices whenever the user picks a supplier in the payment tab
  useEffect(() => {
    if (!paymentTabSupplierId || !selectedBusinessId) {
      setPaymentOpenInvoices([]);
      setPaymentSelectedInvoiceIds(new Set());
      setPaymentExpandedMonths(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      setPaymentIsLoadingInvoices(true);
      const supabase = createClient();
      const { data } = await supabase
        .from('invoices')
        .select('id, invoice_number, invoice_date, total_amount, status')
        .eq('business_id', selectedBusinessId)
        .eq('supplier_id', paymentTabSupplierId)
        .in('status', ['pending', 'clarification'])
        .is('deleted_at', null)
        .order('invoice_date', { ascending: false });
      if (cancelled) return;
      const mapped: PaymentOpenInvoice[] = (data || []).map(inv => ({
        id: inv.id as string,
        invoice_number: (inv.invoice_number as string) || null,
        invoice_date: inv.invoice_date as string,
        total_amount: Number(inv.total_amount),
        status: inv.status as string,
      }));
      setPaymentOpenInvoices(mapped);
      setPaymentSelectedInvoiceIds(new Set());
      // Auto-expand the most recent month so the user sees at least one invoice
      if (mapped.length > 0) {
        setPaymentExpandedMonths(new Set([getMonthYearKey(mapped[0].invoice_date)]));
      } else {
        setPaymentExpandedMonths(new Set());
      }
      setPaymentIsLoadingInvoices(false);
    })();
    return () => { cancelled = true; };
  }, [paymentTabSupplierId, selectedBusinessId]);

  // When invoices are selected, auto-sync the payment amount to match the total
  const paymentSelectedInvoicesTotal = useMemo(() => {
    return paymentOpenInvoices
      .filter(inv => paymentSelectedInvoiceIds.has(inv.id))
      .reduce((sum, inv) => sum + inv.total_amount, 0);
  }, [paymentOpenInvoices, paymentSelectedInvoiceIds]);

  // Track previous selection so we only auto-fill the amount when the user
  // actually changes the invoice selection — not on every paymentOpenInvoices
  // refetch. Otherwise a manually-edited partial-payment amount gets clobbered
  // back to the full invoice total.
  const prevSelectedInvoiceIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevSelectedInvoiceIdsRef.current;
    const curr = paymentSelectedInvoiceIds;
    const selectionChanged =
      prev.size !== curr.size ||
      Array.from(curr).some(id => !prev.has(id));
    if (!selectionChanged) return;
    prevSelectedInvoiceIdsRef.current = new Set(curr);

    setPaymentMethods(prevMethods => {
      if (prevMethods.length === 0) return prevMethods;
      const amountStr = curr.size === 0
        ? ''
        : (paymentSelectedInvoicesTotal.toFixed(2).replace(/\.?0+$/, '') || '0');
      return prevMethods.map((pm, i) => i === 0 ? { ...pm, amount: amountStr } : pm);
    });
  }, [paymentSelectedInvoiceIds, paymentSelectedInvoicesTotal]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodEntry[]>([
    { id: 1, method: '', amount: '', installments: '1', checkNumber: '', creditCardId: '', customInstallments: [] },
  ]);

  // Inline payment methods for invoice "paid in full" section
  const [inlinePaymentMethods, setInlinePaymentMethods] = useState<PaymentMethodEntry[]>([
    { id: 1, method: '', amount: '', installments: '1', checkNumber: '', creditCardId: '', customInstallments: [] },
  ]);

  // Summary (מרכזת) tab state
  const [summarySupplierId, setSummarySupplierId] = useState('');
  const [summaryDate, setSummaryDate] = useState('');
  const [summaryInvoiceNumber, setSummaryInvoiceNumber] = useState('');
  const [summaryTotalAmount, setSummaryTotalAmount] = useState('');
  const [summaryIsClosed, setSummaryIsClosed] = useState('');
  const [summaryNotes, setSummaryNotes] = useState('');
  const [summaryDeliveryNotes, setSummaryDeliveryNotes] = useState<DeliveryNoteEntry[]>([]);
  const [showAddDeliveryNote, setShowAddDeliveryNote] = useState(false);
  const [newDeliveryNote, setNewDeliveryNote] = useState<DeliveryNoteEntry>({
    delivery_note_number: '',
    delivery_date: '',
    total_amount: '',
    notes: '',
  });
  // Open delivery notes from DB for selected supplier
  const [openDeliveryNotes, setOpenDeliveryNotes] = useState<Array<{ id: string; delivery_note_number: string; delivery_date: string; total_amount: number; notes: string | null }>>([]);
  const [selectedDeliveryNoteIds, setSelectedDeliveryNoteIds] = useState<Set<string>>(new Set());
  const [isLoadingDeliveryNotes, setIsLoadingDeliveryNotes] = useState(false);
  // Summary tab — month groups expand/collapse state (keyed as "YYYY-MM")
  const [summaryExpandedMonths, setSummaryExpandedMonths] = useState<Set<string>>(new Set());

  // Business credit cards
  const [businessCreditCards, setBusinessCreditCards] = useState<{id: string, card_name: string, billing_day: number}[]>([]);

  // Daily Entry (רישום יומי) state
  const [dailyEntryDate, setDailyEntryDate] = useState('');
  const [dailyTotalRegister, setDailyTotalRegister] = useState('');
  const [dailyDayFactor, setDailyDayFactor] = useState('1');
  const [dailyLaborCost, setDailyLaborCost] = useState('');
  const [dailyLaborHours, setDailyLaborHours] = useState('');
  const [dailyDiscounts, setDailyDiscounts] = useState('');
  const [dailyDateWarning, setDailyDateWarning] = useState<string | null>(null);
  const [dailyDataLoading, setDailyDataLoading] = useState(false);
  // Dynamic data from DB
  const [dailyIncomeSources, setDailyIncomeSources] = useState<Array<{ id: string; name: string }>>([]);
  const [dailyReceiptTypes, setDailyReceiptTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [dailyCustomParameters, setDailyCustomParameters] = useState<Array<{ id: string; name: string }>>([]);
  const [dailyManagedProducts, setDailyManagedProducts] = useState<Array<{ id: string; name: string; unit: string; unit_cost: number; current_stock?: number }>>([]);
  // Dynamic form data
  const [dailyIncomeData, setDailyIncomeData] = useState<Record<string, { amount: string; orders_count: string }>>({});
  const [dailyReceiptData, setDailyReceiptData] = useState<Record<string, string>>({});
  const [dailyParameterData, setDailyParameterData] = useState<Record<string, string>>({});
  const [dailyProductUsage, setDailyProductUsage] = useState<Record<string, { opening_stock: string; received_quantity: string; closing_stock: string }>>({});
  // Pearla-specific
  const [dailyPearlaData, setDailyPearlaData] = useState({
    portions_count: '',
    portions_income: '',
    serving_supplement: '',
    serving_income: '',
    extras_income: '',
    total_income: '',
    salaried_labor_cost: '',
    salaried_labor_overhead: '',
    manpower_labor_cost: '',
  });

  // Duplicate detection
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const duplicateConfirmedRef = useRef(false);
  // Track confirmation for "this OCR will overwrite a fixed-expense invoice with very different values".
  const fixedOverwriteConfirmedRef = useRef(false);

  // Calculator
  const [calcDisplay, setCalcDisplay] = useState('0');
  const [calcExpression, setCalcExpression] = useState('');
  const [calcPos, setCalcPos] = useState<{ x: number; y: number } | null>(null);
  const calcDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Line items state for price tracking
  const [lineItems, setLineItems] = useState<OCRLineItem[]>([]);
  const [priceCheckDone, setPriceCheckDone] = useState(false);

  // Fetch price comparisons when supplier or document changes.
  // Uses a cancellation guard + doc-id gate so rapid document switches (e.g. after
  // saving one invoice and auto-advancing to the next) don't let a stale request
  // overwrite the fresh document's line items and cause the items table to "jump".
  useEffect(() => {
    if (!supplierId || !selectedBusinessId || lineItems.length === 0) {
      setPriceCheckDone(false);
      return;
    }
    let cancelled = false;
    const activeDocId = document?.id;

    (async () => {
      const supabase = createClient();
      const { data: supplierItems } = await supabase
        .from('supplier_items')
        .select('id, item_name, item_aliases, current_price')
        .eq('business_id', selectedBusinessId)
        .eq('supplier_id', supplierId)
        .eq('is_active', true);

      if (cancelled || document?.id !== activeDocId) return;

      if (!supplierItems) {
        setPriceCheckDone(true);
        return;
      }

      // Match against the LATEST lineItems via functional setState to avoid stale-closure overwrites.
      setLineItems(prev => prev.map((li) => {
        const desc = (li.description || '').trim().toLowerCase();
        if (!desc) return li;
        const match = supplierItems.find((si) => {
          const nameMatch = si.item_name.toLowerCase() === desc;
          const aliasMatch = (si.item_aliases || []).some((a: string) => a.toLowerCase() === desc);
          const partialMatch = si.item_name.toLowerCase().includes(desc) || desc.includes(si.item_name.toLowerCase());
          return nameMatch || aliasMatch || partialMatch;
        });
        if (match && match.current_price != null && li.unit_price != null) {
          // The LLM occasionally swaps qty<->unit_price when the document table
          // columns are unusual. Detect the swap by checking whether swapping
          // brings unit_price much closer to history than the current value:
          //   - current value diverges from history by >50% (real change)
          //   - swapped value matches history within 15%
          //   - swap improves the gap by at least 5x
          // qty*price is commutative so totals stay identical — only the per-
          // field assignment is corrected.
          let qty = li.quantity;
          let price = li.unit_price;
          if (qty != null && qty > 0 && price > 0 && match.current_price > 0) {
            const currentPctOff = Math.abs((price - match.current_price) / match.current_price) * 100;
            const swappedPctOff = Math.abs((qty - match.current_price) / match.current_price) * 100;
            const shouldSwap =
              currentPctOff > 50 &&
              swappedPctOff < 15 &&
              currentPctOff > swappedPctOff * 5;
            if (shouldSwap) {
              [qty, price] = [price, qty];
            }
          }
          const priceDiff = price - match.current_price;
          const changePct = match.current_price > 0 ? ((priceDiff / match.current_price) * 100) : 0;
          return {
            ...li,
            quantity: qty,
            unit_price: price,
            total: calcLineTotal(qty, price, li.discount_amount, li.discount_type),
            matched_supplier_item_id: match.id,
            previous_price: match.current_price,
            price_change_pct: Math.abs(changePct) < 0.01 ? 0 : changePct,
            is_new_item: false,
          };
        }
        return { ...li, is_new_item: true, matched_supplier_item_id: undefined, previous_price: undefined, price_change_pct: undefined };
      }));
      setPriceCheckDone(true);
    })();

    return () => { cancelled = true; };
  // Intentionally only re-run when the supplier/business/doc changes — NOT on every
  // lineItems change, which used to re-trigger the fetch and cause jitter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, selectedBusinessId, document?.id]);

  // Calculate line item total considering discount type (default: percent).
  const calcLineTotal = (qty: number | undefined, price: number | undefined, discountAmt: number | undefined, discountType: 'amount' | 'percent' | undefined) => {
    if (qty == null || price == null) return 0;
    const gross = qty * price;
    if (!discountAmt) return gross;
    if (discountType === 'amount') return gross - discountAmt;
    return gross * (1 - discountAmt / 100);
  };

  // Count price alerts
  const priceAlerts = useMemo(() => {
    return lineItems.filter(
      (li) => li.price_change_pct != null && li.price_change_pct !== 0
    );
  }, [lineItems]);

  // Duplicate detection: check if invoice/delivery_note with same number+supplier+business exists
  useEffect(() => {
    setDuplicateWarning(null);
    duplicateConfirmedRef.current = false;
    if (documentType === 'daily_entry') return;

    // Resolve (docNum, supId) for each tab — payments live on their own sub-form.
    const isPaymentTab = documentType === 'payment';
    const docNum = documentType === 'summary'
      ? summaryInvoiceNumber.trim()
      : isPaymentTab
        ? paymentTabReference.trim()
        : documentNumber.trim();
    const supId = documentType === 'summary'
      ? summarySupplierId
      : isPaymentTab
        ? paymentTabSupplierId
        : supplierId;
    if (!docNum || !supId || !selectedBusinessId) return;

    const timer = setTimeout(async () => {
      const supabase = createClient();
      if (isPaymentTab) {
        // For payments the reference_number lives on payment_splits; join to payments to
        // scope by business/supplier and skip deleted payments.
        const { data, error } = await supabase
          .from('payment_splits')
          .select('id, payments!inner(id, business_id, supplier_id, deleted_at)')
          .eq('reference_number', docNum)
          .eq('payments.business_id', selectedBusinessId)
          .eq('payments.supplier_id', supId)
          .is('payments.deleted_at', null)
          .limit(1);
        if (!error && data && data.length > 0) {
          const supplierName = suppliers.find(s => s.id === supId)?.name || 'הספק';
          setDuplicateWarning(`כבר קיים תשלום עם אסמכתא ${docNum} לספק ${supplierName}`);
        }
        return;
      }

      const table = documentType === 'delivery_note' ? 'delivery_notes' : 'invoices';
      const numberCol = documentType === 'delivery_note' ? 'delivery_note_number' : 'invoice_number';

      const { data, error } = await supabase
        .from(table)
        .select('id')
        .eq('business_id', selectedBusinessId)
        .eq('supplier_id', supId)
        .eq(numberCol, docNum)
        .is('deleted_at', null)
        .limit(1);

      if (!error && data && data.length > 0) {
        const supplierName = suppliers.find(s => s.id === supId)?.name || 'הספק';
        setDuplicateWarning(`כבר קיים מסמך עם מספר ${docNum} לספק ${supplierName}`);
      }
    }, 500); // debounce

    return () => clearTimeout(timer);
  }, [documentNumber, summaryInvoiceNumber, paymentTabReference, supplierId, summarySupplierId, paymentTabSupplierId, selectedBusinessId, documentType, suppliers]);

  // Pearla detection for daily entry
  const selectedBusiness = useMemo(() => businesses.find(b => b.id === selectedBusinessId), [businesses, selectedBusinessId]);
  const selectedBusinessName = selectedBusiness?.name;
  const isPearla = selectedBusinessName?.includes("פרלה") || false;
  const businessVatRate = Number(selectedBusiness?.vat_percentage) || DEFAULT_businessVatRate;

  // Load credit cards for all document types (needed for payment methods)
  const loadCreditCards = useCallback(async () => {
    if (!selectedBusinessId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('business_credit_cards')
      .select('id, card_name, billing_day')
      .eq('business_id', selectedBusinessId)
      .eq('is_active', true)
      .order('card_name');
    if (data) setBusinessCreditCards(data);
  }, [selectedBusinessId]);
  useEffect(() => { loadCreditCards(); }, [loadCreditCards]);
  // Realtime — a card added in Settings should appear in the payment dropdown
  // without a page refresh.
  useMultiTableRealtime(
    ['business_credit_cards'],
    loadCreditCards,
    !!selectedBusinessId,
  );

  // Load dynamic data for daily entry tab
  useEffect(() => {
    if (documentType !== 'daily_entry' || !selectedBusinessId) return;
    setDailyDataLoading(true);

    const loadDailyData = async () => {
      const supabase = createClient();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      const [
        { data: sources },
        { data: receipts },
        { data: parameters },
        { data: products },
        { data: lastEntry },
        { data: creditCardsData },
      ] = await Promise.all([
        supabase.from('income_sources').select('id, name').eq('business_id', selectedBusinessId).eq('is_active', true).is('deleted_at', null).order('display_order'),
        supabase.from('receipt_types').select('id, name').eq('business_id', selectedBusinessId).eq('is_active', true).is('deleted_at', null).order('display_order'),
        supabase.from('custom_parameters').select('id, name').eq('business_id', selectedBusinessId).eq('is_active', true).is('deleted_at', null).order('display_order'),
        supabase.from('managed_products').select('id, name, unit, unit_cost, current_stock, display_order').eq('business_id', selectedBusinessId).eq('is_active', true).is('deleted_at', null).order('display_order'),
        supabase.from('daily_entries').select('id, entry_date').eq('business_id', selectedBusinessId).lte('entry_date', yesterdayStr).order('entry_date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('business_credit_cards').select('id, card_name, billing_day').eq('business_id', selectedBusinessId).eq('is_active', true).order('card_name'),
      ]);

      if (creditCardsData) {
        setBusinessCreditCards(creditCardsData);
      }

      // Previous closing stock for product opening stock
      const previousClosingStock: Record<string, number> = {};
      if (lastEntry) {
        const { data: previousUsage } = await supabase.from('daily_product_usage').select('product_id, closing_stock').eq('daily_entry_id', lastEntry.id);
        if (previousUsage) {
          previousUsage.forEach((u) => { previousClosingStock[u.product_id] = u.closing_stock || 0; });
        }
      }

      setDailyIncomeSources(sources || []);
      setDailyReceiptTypes(receipts || []);
      setDailyCustomParameters(parameters || []);
      setDailyManagedProducts(products || []);

      // Initialize form data
      const initIncome: Record<string, { amount: string; orders_count: string }> = {};
      (sources || []).forEach((s) => { initIncome[s.id] = { amount: '', orders_count: '' }; });
      setDailyIncomeData(initIncome);

      const initReceipts: Record<string, string> = {};
      (receipts || []).forEach((r) => { initReceipts[r.id] = ''; });
      setDailyReceiptData(initReceipts);

      const initParams: Record<string, string> = {};
      (parameters || []).forEach((p) => { initParams[p.id] = ''; });
      setDailyParameterData(initParams);

      const initProducts: Record<string, { opening_stock: string; received_quantity: string; closing_stock: string }> = {};
      (products || []).forEach((p) => {
        const openingStock = previousClosingStock[p.id] ?? p.current_stock ?? 0;
        initProducts[p.id] = { opening_stock: openingStock > 0 ? openingStock.toString() : '', received_quantity: '', closing_stock: '' };
      });
      setDailyProductUsage(initProducts);

      // Set today's date
      if (!dailyEntryDate) {
        setDailyEntryDate(new Date().toISOString().split('T')[0]);
      }

      setDailyDataLoading(false);
    };

    loadDailyData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentType, selectedBusinessId]);

  // Check for existing daily entry on date change
  const checkDailyEntryDate = useCallback(async (date: string) => {
    if (!selectedBusinessId || !date) return;
    const supabase = createClient();
    const { data: existingEntry } = await supabase.from('daily_entries').select('id').eq('business_id', selectedBusinessId).eq('entry_date', date).maybeSingle();
    setDailyDateWarning(existingEntry ? 'כבר קיים רישום לתאריך זה' : null);

    // Fetch previous day's closing stock
    if (dailyManagedProducts.length > 0) {
      const { data: prevEntry } = await supabase.from('daily_entries').select('id').eq('business_id', selectedBusinessId).lt('entry_date', date).order('entry_date', { ascending: false }).limit(1).maybeSingle();
      if (prevEntry) {
        const { data: prevUsage } = await supabase.from('daily_product_usage').select('product_id, closing_stock').eq('daily_entry_id', prevEntry.id);
        if (prevUsage) {
          setDailyProductUsage(prev => {
            const updated = { ...prev };
            for (const usage of prevUsage) {
              if (updated[usage.product_id]) {
                updated[usage.product_id] = { ...updated[usage.product_id], opening_stock: (usage.closing_stock || 0) > 0 ? (usage.closing_stock || 0).toString() : '' };
              }
            }
            return updated;
          });
        }
      }
    }
  }, [selectedBusinessId, dailyManagedProducts.length]);

  // Calculate VAT and total (for invoice/delivery_note tabs)
  // Net before VAT = (before-VAT subtotal) − (overall invoice discount).
  // Either the ₪ field or the % field is authoritative; they're kept in sync
  // by the onChange handlers, so we just read discountAmount.
  //
  // A negative amount is a legitimate use case (credit note — חשבונית זיכוי),
  // so we must NOT clamp the result to zero. We only clamp on the positive
  // side when an over-discount would flip a normal invoice negative.
  const amountAfterDiscount = useMemo(() => {
    const amount = parseFloat(amountBeforeVat) || 0;
    const disc = parseFloat(discountAmount) || 0;
    const net = amount - disc;
    if (amount < 0) return net;          // credit note — keep it negative
    return Math.max(0, net);             // regular invoice — don't go negative from discount
  }, [amountBeforeVat, discountAmount]);

  const calculatedVat = useMemo(() => {
    return amountAfterDiscount * businessVatRate;
  }, [amountAfterDiscount]);

  const totalWithVat = useMemo(() => {
    const vat = partialVat ? (parseFloat(vatAmount) || 0) : calculatedVat;
    return amountAfterDiscount + vat;
  }, [amountAfterDiscount, vatAmount, partialVat, calculatedVat]);

  // Generate installments breakdown
  const generateInstallments = (numInstallments: number, totalAmount: number, startDateStr: string) => {
    if (numInstallments <= 1 || totalAmount === 0) return [];
    const installmentAmount = Math.round((totalAmount / numInstallments) * 100) / 100;
    const lastInstallmentAmount = Math.round((totalAmount - installmentAmount * (numInstallments - 1)) * 100) / 100;
    const startDate = startDateStr ? new Date(startDateStr) : new Date();
    const result = [];
    for (let i = 0; i < numInstallments; i++) {
      const date = new Date(startDate);
      date.setMonth(date.getMonth() + i);
      result.push({
        number: i + 1,
        date: date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }),
        dateForInput: date.toISOString().split('T')[0],
        amount: i === numInstallments - 1 ? lastInstallmentAmount : installmentAmount,
      });
    }
    return result;
  };

  // Get effective start date from existing methods
  const getEffectiveStartDate = (methods: PaymentMethodEntry[], fallbackDate: string) => {
    if (methods.length > 0 && methods[0].customInstallments.length > 0) {
      return methods[0].customInstallments[0].dateForInput;
    }
    return fallbackDate;
  };

  // Payment methods helpers (shared for both payment tab and inline payment)
  const addPaymentMethodEntry = (setter: React.Dispatch<React.SetStateAction<PaymentMethodEntry[]>>, methods: PaymentMethodEntry[]) => {
    const newId = Math.max(...methods.map(p => p.id)) + 1;
    // Auto-increment check number when the previous row was a check with a
    // numeric check_number — typical use case is writing 3 sequential checks
    // and not wanting to retype each number. Inherit the method too so the
    // user can just enter the next amount and stay on flow.
    const last = methods[methods.length - 1];
    const lastCheckNum = last && last.method === 'check' ? last.checkNumber.trim() : '';
    const lastCheckNumIsNumeric = lastCheckNum !== '' && /^\d+$/.test(lastCheckNum);
    const inheritedCheckNumber = lastCheckNumIsNumeric ? String(Number(lastCheckNum) + 1) : '';
    const inheritedMethod = last && last.method === 'check' ? 'check' : '';
    setter(prev => [...prev, {
      id: newId,
      method: inheritedMethod,
      amount: '',
      installments: '1',
      checkNumber: inheritedCheckNumber,
      creditCardId: '',
      customInstallments: [],
    }]);
  };

  const removePaymentMethodEntry = (setter: React.Dispatch<React.SetStateAction<PaymentMethodEntry[]>>, methods: PaymentMethodEntry[], id: number) => {
    if (methods.length > 1) {
      setter(prev => prev.filter(p => p.id !== id));
    }
  };

  // Calculate due date based on credit card billing day.
  // Payment is recorded 1 day BEFORE the card's billing day
  // (e.g. card withdraws on the 10th → payment date = the 9th).
  // Passing `billingDay - 1` to `new Date(y, m, d)` with d=0 rolls to the last
  // day of the previous month, which is the desired behaviour when billing_day=1.
  //
  // IMPORTANT: use local-date formatting, NOT `.toISOString().split('T')[0]`.
  // toISOString() converts to UTC, which shifts the day back by one in
  // east-of-UTC timezones (Israel = UTC+2/+3) — that's how we ended up saving
  // May 8 instead of May 9 for billing_day=10.
  const formatLocalYMD = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const calculateCreditCardDueDate = (paymentDateStr: string, billingDay: number): string => {
    // Payment date = the card's billing day itself (e.g. billing_day=15 → the 15th).
    // Parse the incoming YYYY-MM-DD as LOCAL midnight (not UTC), otherwise
    // `new Date("2026-04-10")` is interpreted as UTC and `.getDate()` in a
    // positive-offset TZ can flip to the previous day.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(paymentDateStr);
    const payDate = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(paymentDateStr);
    const dayOfMonth = payDate.getDate();

    if (dayOfMonth <= billingDay) {
      return formatLocalYMD(new Date(payDate.getFullYear(), payDate.getMonth(), billingDay));
    } else {
      return formatLocalYMD(new Date(payDate.getFullYear(), payDate.getMonth() + 1, billingDay));
    }
  };

  // Calculate smart default payment date based on method
  const getSmartPaymentDate = (method: string, invoiceDate: string, creditCardId?: string): string => {
    if (!method) return "";
    if (method === "credit_card") {
      if (creditCardId) {
        const card = businessCreditCards.find(c => c.id === creditCardId);
        if (card) {
          return calculateCreditCardDueDate(invoiceDate || new Date().toISOString().split("T")[0], card.billing_day);
        }
      }
      const today = new Date();
      const day = today.getDate();
      if (day < 10) {
        return new Date(today.getFullYear(), today.getMonth(), 10).toISOString().split("T")[0];
      } else {
        return new Date(today.getFullYear(), today.getMonth() + 1, 10).toISOString().split("T")[0];
      }
    }
    return invoiceDate || new Date().toISOString().split("T")[0];
  };

  // Generate installments with credit card billing day logic.
  // For 1 installment, returns a single row pinned to the card's billing day so
  // the user sees the actual charge date instead of the invoice date.
  const generateCreditCardInstallments = (numInstallments: number, totalAmount: number, paymentDateStr: string, billingDay: number) => {
    if (numInstallments < 1 || totalAmount === 0) return [];

    const installmentAmount = Math.round((totalAmount / numInstallments) * 100) / 100;
    const lastInstallmentAmount = Math.round((totalAmount - installmentAmount * (numInstallments - 1)) * 100) / 100;
    const firstDueDate = calculateCreditCardDueDate(paymentDateStr, billingDay);
    // Parse the local YYYY-MM-DD into a local Date (NOT UTC) so subsequent
    // setMonth/getDate calls and the formatLocalYMD output stay on the same
    // calendar day in IST (UTC+2/+3). new Date("YYYY-MM-DD") is UTC midnight
    // and shifts a day back when read with getDate() in IST.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(firstDueDate);
    const baseDate = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(firstDueDate);

    const result = [];
    for (let i = 0; i < numInstallments; i++) {
      const date = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, baseDate.getDate());

      result.push({
        number: i + 1,
        date: date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }),
        dateForInput: formatLocalYMD(date),
        amount: numInstallments > 1 && i === numInstallments - 1 ? lastInstallmentAmount : (numInstallments === 1 ? totalAmount : installmentAmount),
      });
    }
    return result;
  };

  // Compute next sequential cheque number from a starting reference. Reference may
  // contain non-digits (e.g. "A-12345"); we increment the trailing numeric portion
  // and preserve the prefix. Returns '' when no digits are present.
  const incrementCheckNumber = (reference: string, offset: number): string => {
    if (!reference) return '';
    const match = reference.match(/^(\D*)(\d+)(\D*)$/);
    if (!match) return '';
    const [, prefix, digits, suffix] = match;
    const next = (BigInt(digits) + BigInt(offset)).toString().padStart(digits.length, '0');
    return `${prefix}${next}${suffix}`;
  };

  const updatePaymentMethodField = (setter: React.Dispatch<React.SetStateAction<PaymentMethodEntry[]>>, methods: PaymentMethodEntry[], id: number, field: keyof PaymentMethodEntry, value: string, dateStr: string, dateSetter?: (d: string) => void, presetCreditCardId?: string, referenceNumber?: string) => {
    // Auto-set payment date when payment method is selected
    if (dateSetter && field === 'method' && value) {
      // If we're picking credit_card and have a preset card (supplier default),
      // use the card-aware smart date instead of the generic one.
      const smartDate = value === 'credit_card' && presetCreditCardId
        ? getSmartPaymentDate('credit_card', documentDate, presetCreditCardId)
        : getSmartPaymentDate(value, documentDate);
      if (smartDate) dateSetter(smartDate);
    }
    if (dateSetter && field === 'creditCardId' && value) {
      const smartDate = getSmartPaymentDate('credit_card', documentDate, value);
      if (smartDate) dateSetter(smartDate);
    }

    setter(prev => prev.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, [field]: value };
      // When switching to credit_card and we have a preset default card, apply it
      // here so installment generation below picks it up immediately.
      if (field === 'method' && value === 'credit_card' && presetCreditCardId && !p.creditCardId) {
        updated.creditCardId = presetCreditCardId;
      }

      // Clear creditCardId when switching away from credit_card method
      if (field === 'method' && value !== 'credit_card') {
        updated.creditCardId = '';
      }

      // Auto-generate installment rows for check or credit_card (shows date/amount inline).
      // Honour the user's current installments count — they may have clicked "+" on the
      // stepper before picking a method, in which case we need to populate that many rows.
      if (field === 'method' && (value === 'check' || value === 'credit_card')) {
        const totalAmount = parseFloat(p.amount.replace(/[^\d.-]/g, '')) || 0;
        const numInstallments = Math.max(1, parseInt(p.installments) || 1);
        const startDate = getEffectiveStartDate(methods, dateStr);
        // For credit_card with a card already selected (e.g. supplier default),
        // pin the row to the card's billing day; otherwise fall back to startDate.
        const effectiveCardId = updated.creditCardId;
        const card = value === 'credit_card' && effectiveCardId
          ? businessCreditCards.find(c => c.id === effectiveCardId)
          : null;
        if (card && startDate) {
          updated.customInstallments = generateCreditCardInstallments(numInstallments, totalAmount, startDate, card.billing_day);
        } else if (value === 'check') {
          // Cheques: split the total evenly across rows, dated one month apart,
          // with sequential cheque numbers seeded from the reference field if
          // provided (so cheque #2 = reference + 1).
          const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate || '');
          const baseDate = m
            ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
            : startDate ? new Date(startDate) : new Date();
          const installmentAmount = numInstallments > 0
            ? Math.round((totalAmount / numInstallments) * 100) / 100
            : 0;
          const lastInstallmentAmount = Math.round((totalAmount - installmentAmount * (numInstallments - 1)) * 100) / 100;
          const rows = [];
          for (let i = 0; i < numInstallments; i++) {
            const d = new Date(baseDate);
            d.setMonth(d.getMonth() + i);
            rows.push({
              number: i + 1,
              date: d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }),
              dateForInput: formatLocalYMD(d),
              amount: i === numInstallments - 1 ? lastInstallmentAmount : installmentAmount,
              checkNumber: i === 0
                ? (referenceNumber?.trim() || '')
                : incrementCheckNumber(referenceNumber?.trim() || '', i),
            });
          }
          updated.customInstallments = rows;
        } else {
          // credit_card without a known card — fall back to a single row at startDate.
          const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate || '');
          const date = m
            ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
            : startDate ? new Date(startDate) : new Date();
          updated.customInstallments = [{
            number: 1,
            date: date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }),
            dateForInput: formatLocalYMD(date),
            amount: totalAmount,
            checkNumber: '',
          }];
        }
      }

      // Regenerate installments when installments count changes
      if (field === 'installments') {
        const numInstallments = parseInt(value) || 1;
        const totalAmount = parseFloat(p.amount.replace(/[^\d.-]/g, '')) || 0;
        const startDate = p.customInstallments.length > 0 ? p.customInstallments[0].dateForInput : getEffectiveStartDate(methods, dateStr);
        const card = p.creditCardId ? businessCreditCards.find(c => c.id === p.creditCardId) : null;

        // Cheques: re-split the total evenly across the new row count and
        // assign sequential cheque numbers based on the first row's number
        // (which itself defaults to the reference field). User edits to a
        // specific row's amount/checkNumber are preserved when trimming.
        if (p.method === 'check') {
          const prevRows = p.customInstallments;
          const installmentAmount = numInstallments > 0
            ? Math.round((totalAmount / numInstallments) * 100) / 100
            : 0;
          const lastInstallmentAmount = Math.round((totalAmount - installmentAmount * (numInstallments - 1)) * 100) / 100;
          // Seed cheque numbering: prefer the user-typed first cheque number
          // (so they can override), fall back to the reference field.
          const seedCheck = (prevRows[0]?.checkNumber || '').trim() || (referenceNumber?.trim() || '');
          const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate || '');
          const baseDate = m
            ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
            : startDate ? new Date(startDate) : new Date();
          const rows = [];
          for (let i = 0; i < numInstallments; i++) {
            const prevRow = prevRows[i];
            const d = prevRow?.dateForInput
              ? new Date(prevRow.dateForInput)
              : (() => { const dd = new Date(baseDate); dd.setMonth(dd.getMonth() + i); return dd; })();
            rows.push({
              number: i + 1,
              date: d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }),
              dateForInput: prevRow?.dateForInput || formatLocalYMD(d),
              amount: i === numInstallments - 1 ? lastInstallmentAmount : installmentAmount,
              checkNumber: i === 0
                ? seedCheck
                : (prevRow?.checkNumber || incrementCheckNumber(seedCheck, i)),
            });
          }
          updated.customInstallments = rows;
        } else {
          // Credit card / bank transfer / cash — keep auto-split behaviour but
          // preserve any user-entered metadata for rows that still exist.
          let regenerated = card && startDate
            ? generateCreditCardInstallments(numInstallments, totalAmount, startDate, card.billing_day)
            : generateInstallments(numInstallments, totalAmount, startDate);
          regenerated = regenerated.map((row, idx) => {
            const prevRow = p.customInstallments[idx];
            if (!prevRow) return row;
            return {
              ...row,
              ...(prevRow.dateForInput ? { date: prevRow.date, dateForInput: prevRow.dateForInput } : {}),
            };
          });
          updated.customInstallments = regenerated;
        }
      }

      // When amount changes, recalculate installment amounts but keep dates
      if (field === 'amount') {
        const numInstallments = parseInt(p.installments) || 1;
        const totalAmount = parseFloat(value.replace(/[^\d.-]/g, '')) || 0;
        const shouldKeepSingleRow = p.method === 'check' || p.method === 'credit_card';
        if (p.customInstallments.length > 0 && totalAmount > 0) {
          const installmentAmount = Math.round((totalAmount / numInstallments) * 100) / 100;
          const lastInstallmentAmount = Math.round((totalAmount - installmentAmount * (numInstallments - 1)) * 100) / 100;
          updated.customInstallments = p.customInstallments.map((inst, idx) => ({
            ...inst,
            amount: idx === numInstallments - 1 ? lastInstallmentAmount : installmentAmount,
          }));
        } else if (totalAmount > 0 && (numInstallments > 1 || shouldKeepSingleRow)) {
          const startDate = getEffectiveStartDate(methods, dateStr);
          const card = p.creditCardId ? businessCreditCards.find(c => c.id === p.creditCardId) : null;
          if (card && startDate) {
            updated.customInstallments = generateCreditCardInstallments(numInstallments, totalAmount, startDate, card.billing_day);
          } else {
            updated.customInstallments = generateInstallments(numInstallments, totalAmount, startDate);
          }
        } else if (!shouldKeepSingleRow) {
          updated.customInstallments = [];
        }
      }

      return updated;
    }));
  };

  const handleInstallmentDateChange = (setter: React.Dispatch<React.SetStateAction<PaymentMethodEntry[]>>, paymentMethodId: number, installmentIndex: number, newDate: string, dateSetter?: (d: string) => void) => {
    setter(prev => prev.map(p => {
      if (p.id !== paymentMethodId) return p;
      const updatedInstallments = [...p.customInstallments];
      if (updatedInstallments[installmentIndex]) {
        const date = new Date(newDate);
        updatedInstallments[installmentIndex] = {
          ...updatedInstallments[installmentIndex],
          dateForInput: newDate,
          date: date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }),
        };
      }
      return { ...p, customInstallments: updatedInstallments };
    }));
    // Keep the top-level payment date in sync with the first installment of the
    // first payment method, so the DB's payment_date stays aligned with what the
    // user sees in the table.
    if (installmentIndex === 0 && dateSetter) {
      dateSetter(newDate);
    }
  };

  const handleInstallmentCheckNumberChange = (setter: React.Dispatch<React.SetStateAction<PaymentMethodEntry[]>>, paymentMethodId: number, installmentIndex: number, value: string) => {
    setter(prev => prev.map(p => {
      if (p.id !== paymentMethodId) return p;
      const updatedInstallments = [...p.customInstallments];
      if (updatedInstallments[installmentIndex]) {
        updatedInstallments[installmentIndex] = { ...updatedInstallments[installmentIndex], checkNumber: value };
      }
      return { ...p, customInstallments: updatedInstallments };
    }));
  };

  const handleInstallmentAmountChange = (setter: React.Dispatch<React.SetStateAction<PaymentMethodEntry[]>>, paymentMethodId: number, installmentIndex: number, newAmount: string) => {
    const amount = parseFloat(newAmount.replace(/[^\d.-]/g, '')) || 0;
    setter(prev => prev.map(p => {
      if (p.id !== paymentMethodId) return p;
      const totalAmount = parseFloat(p.amount.replace(/[^\d.-]/g, '')) || 0;
      const updatedInstallments = [...p.customInstallments];
      if (updatedInstallments[installmentIndex]) {
        const cappedAmount = Math.min(Math.round(amount * 100) / 100, totalAmount);
        updatedInstallments[installmentIndex] = { ...updatedInstallments[installmentIndex], amount: cappedAmount };
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

  const getInstallmentsTotal = (customInstallments: PaymentMethodEntry['customInstallments']) => {
    return customInstallments.reduce((sum, item) => sum + item.amount, 0);
  };

  // Auto-fetch open delivery notes when supplier is selected in summary tab
  useEffect(() => {
    if (!selectedBusinessId || !summarySupplierId || documentType !== 'summary') {
      setOpenDeliveryNotes([]);
      setSelectedDeliveryNoteIds(new Set());
      return;
    }
    let cancelled = false;
    async function fetchOpenNotes() {
      setIsLoadingDeliveryNotes(true);
      const supabase = (await import('@/lib/supabase/client')).createClient();
      const { data } = await supabase
        .from('delivery_notes')
        .select('id, delivery_note_number, delivery_date, total_amount, notes')
        .eq('business_id', selectedBusinessId)
        .eq('supplier_id', summarySupplierId)
        .is('invoice_id', null)
        .order('delivery_date', { ascending: true });
      if (!cancelled && data) {
        // Normalize delivery_date to a local-calendar YYYY-MM-DD string so
        // month grouping + display honour the user's timezone. The raw value
        // arrives either as "2026-03-31T22:00:00.000Z" (which is really
        // 01.04 in Israel) or as a Date object whose String() isn't ISO.
        // Converting via local getters keeps the day-of-month stable.
        const toLocalYMD = (raw: unknown): string => {
          if (!raw) return '';
          const s = String(raw);
          // Plain YYYY-MM-DD stays as-is.
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          const d = new Date(s);
          if (isNaN(d.getTime())) return s.substring(0, 10);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        };
        const mapped = data.map(d => ({
          id: d.id,
          delivery_note_number: d.delivery_note_number || '',
          delivery_date: toLocalYMD(d.delivery_date),
          total_amount: Number(d.total_amount) || 0,
          notes: d.notes,
        }));
        setOpenDeliveryNotes(mapped);
        // Auto-select all
        setSelectedDeliveryNoteIds(new Set(data.map(d => d.id)));
        // Auto-expand the most recent month group so users see the list
        if (mapped.length > 0) {
          const newestKey = mapped
            .map(n => getMonthYearKey(n.delivery_date))
            .sort()
            .pop()!;
          setSummaryExpandedMonths(new Set([newestKey]));
        } else {
          setSummaryExpandedMonths(new Set());
        }
      }
      if (!cancelled) setIsLoadingDeliveryNotes(false);
    }
    fetchOpenNotes();
    return () => { cancelled = true; };
  }, [selectedBusinessId, summarySupplierId, documentType]);

  // Calculate selected delivery notes total
  const selectedDeliveryNotesTotal = useMemo(() => {
    return openDeliveryNotes
      .filter(n => selectedDeliveryNoteIds.has(n.id))
      .reduce((sum, n) => sum + n.total_amount, 0);
  }, [openDeliveryNotes, selectedDeliveryNoteIds]);

  // Auto-fill total amount from selected delivery notes
  useEffect(() => {
    if (selectedDeliveryNoteIds.size > 0 && selectedDeliveryNotesTotal > 0) {
      setSummaryTotalAmount(selectedDeliveryNotesTotal.toFixed(2));
    }
  }, [selectedDeliveryNotesTotal, selectedDeliveryNoteIds.size]);

  // Summary tab helpers
  const summaryDeliveryNotesTotal = useMemo(() => {
    return summaryDeliveryNotes.reduce((sum, note) => sum + (parseFloat(note.total_amount) || 0), 0);
  }, [summaryDeliveryNotes]);

  const summaryTotalsMatch = useMemo(() => {
    if (summaryDeliveryNotes.length === 0) return true;
    const invoiceTotal = parseFloat(summaryTotalAmount) || 0;
    return Math.abs(invoiceTotal - summaryDeliveryNotesTotal) < 0.01;
  }, [summaryTotalAmount, summaryDeliveryNotesTotal, summaryDeliveryNotes.length]);

  const handleAddDeliveryNote = () => {
    if (!newDeliveryNote.delivery_note_number.trim()) return;
    if (!newDeliveryNote.delivery_date) return;
    if (!newDeliveryNote.total_amount || parseFloat(newDeliveryNote.total_amount) <= 0) return;

    setSummaryDeliveryNotes(prev => [...prev, { ...newDeliveryNote }]);
    setNewDeliveryNote({ delivery_note_number: '', delivery_date: '', total_amount: '', notes: '' });
    setShowAddDeliveryNote(false);
  };

  const handleRemoveDeliveryNote = (index: number) => {
    setSummaryDeliveryNotes(prev => prev.filter((_, i) => i !== index));
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Save draft on every form change
  const saveDraftData = useCallback(() => {
    saveDraft({
      documentType, expenseType, supplierId, documentDate, documentNumber,
      discountAmount, discountPercentage, amountBeforeVat, vatAmount, partialVat, notes, isPaid,
      inlinePaymentMethod, inlinePaymentDate, inlinePaymentReference, inlinePaymentNotes,
      inlinePaymentMethods,
      paymentTabDate, paymentTabExpenseType, paymentTabSupplierId, paymentTabReference, paymentTabNotes,
      paymentMethods,
      summarySupplierId, summaryDate, summaryInvoiceNumber, summaryTotalAmount, summaryIsClosed, summaryNotes,
      summaryDeliveryNotes,
    });
  }, [saveDraft, documentType, expenseType, supplierId, documentDate, documentNumber,
    discountAmount, discountPercentage, amountBeforeVat, vatAmount, partialVat, notes, isPaid,
    inlinePaymentMethod, inlinePaymentDate, inlinePaymentReference, inlinePaymentNotes,
    inlinePaymentMethods,
    paymentTabDate, paymentTabExpenseType, paymentTabSupplierId, paymentTabReference, paymentTabNotes,
    paymentMethods,
    summarySupplierId, summaryDate, summaryInvoiceNumber, summaryTotalAmount, summaryIsClosed, summaryNotes,
    summaryDeliveryNotes]);

  useEffect(() => {
    if (draftRestored.current) {
      saveDraftData();
    }
  }, [saveDraftData]);

  // Populate form from OCR data when document changes
  useEffect(() => {
    // Reset partialVat toggle on each new document — default is OFF (regular VAT).
    // It only turns ON below if the OCR'd vat_amount significantly deviates
    // from expected (businessVatRate × subtotal).
    setPartialVat(false);
    if (document?.ocr_data) {
      const data = document.ocr_data;

      if (document.document_type) {
        // Collapse legacy "sub-types" into the 4 top-level tabs + flags.
        // Tab-visible: invoice / payment / summary / daily_entry.
        // Everything else lives inside "invoice" and is expressed as a toggle.
        const raw = document.document_type as DocumentType;
        const topLevelTypes: DocumentType[] = ['invoice', 'payment', 'summary', 'daily_entry', 'credit_note'];
        const matchedSupplierIdForType = data.matched_supplier_id || supplierId;
        const matchedSupplierForType = suppliers.find(s => s.id === matchedSupplierIdForType);
        // Mistral sometimes mis-classifies regular invoices as "summary" (מרכזת).
        // A summary only makes sense when the supplier is actually a coordinator
        // (waiting_for_coordinator=true). For fixed-expense / regular suppliers
        // we fall back to a normal invoice so the doc isn't tagged "מרכזת" by
        // mistake (which would also save with is_consolidated=true).
        if (raw === 'summary' && !matchedSupplierForType?.waiting_for_coordinator) {
          setDocumentType('invoice');
          setIsSummaryLinked(false);
          setIsDisputed(false);
        } else if (topLevelTypes.includes(raw)) {
          setDocumentType(raw);
          setIsSummaryLinked(false);
          setIsDisputed(false);
        } else if (raw === 'delivery_note') {
          // The Mistral AI sometimes mis-classifies regular invoices as
          // delivery notes. Don't blindly set isSummaryLinked=true — that
          // would make the doc save as a delivery note even when the user
          // doesn't realize it (the toggle is hidden when the supplier
          // isn't flagged as waiting_for_coordinator). Instead, only set
          // it when the chosen supplier is actually a "מרכזת" supplier;
          // otherwise treat as a regular invoice and let the user toggle
          // it manually if needed.
          setDocumentType('invoice');
          const matchedSupplierId = data.matched_supplier_id || supplierId;
          const sup = suppliers.find(s => s.id === matchedSupplierId);
          setIsSummaryLinked(!!sup?.waiting_for_coordinator);
          setIsDisputed(false);
        } else if (raw === 'disputed_invoice') {
          setDocumentType('invoice');
          setIsDisputed(true);
          setIsSummaryLinked(false);
        } else if (raw === 'partially_paid') {
          setDocumentType('invoice');
          setIsSummaryLinked(false);
          setIsDisputed(false);
        } else {
          setDocumentType('invoice');
        }
      }
      if (document.expense_type) {
        setExpenseType(document.expense_type);
      }
      const docDate = data.document_date || new Date().toISOString().split('T')[0];
      setDocumentDate(docDate);
      setPaymentTabDate(docDate);

      // Reset OCR-driven fields first so stale values from a previous document
      // don't leak through when the new document's OCR didn't extract them.
      setDocumentNumber(data.document_number || '');
      setDiscountAmount(
        data.discount_amount !== undefined && data.discount_amount !== null
          ? data.discount_amount.toString()
          : ''
      );
      setDiscountPercentage(
        data.discount_percentage !== undefined && data.discount_percentage !== null
          ? data.discount_percentage.toString()
          : ''
      );
      setAmountBeforeVat(
        data.subtotal !== undefined && data.subtotal !== null
          ? data.subtotal.toString()
          : ''
      );
      if (data.vat_amount !== undefined && data.vat_amount !== null) {
        setVatAmount(data.vat_amount.toString());
        // Default: partial VAT toggle is OFF (regular VAT). The user must
        // explicitly toggle it ON if they want to override the calculated VAT.
        // Never auto-enable based on OCR data — it always defaulted to ON
        // for legitimate invoices and confused users.
      }
      // NOTE: VAT-exempt supplier override happens below, AFTER the supplier
      // is matched, because the matched supplier's vat_type trumps whatever
      // OCR pulled from the document (e.g. an OCR scan of a פטור-ממעמ
      // supplier that still lists a theoretical VAT line).

      // Pre-select supplier: prefer matched_supplier_id from AI, fallback to smart name matching.
      // Read suppliers from a ref so realtime updates to the supplier list don't
      // re-run this effect (which would clobber user edits like "delete all line items").
      const currentSuppliers = suppliersRef.current;
      let matchedId = '';
      if (data.matched_supplier_id && currentSuppliers.some(s => s.id === data.matched_supplier_id)) {
        matchedId = data.matched_supplier_id;
      } else if (data.supplier_name && currentSuppliers.length > 0) {
        // Normalize: remove double-quotes, geresh, periods, extra whitespace; normalize בעמ variations
        const normalize = (s: string) =>
          s
            .replace(/[\u0022\u0027\u05F4\u05F3"'`]/g, '') // all quote types incl. Hebrew gershayim
            .replace(/[.,]/g, '')
            .replace(/\u00A0/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/בע\s*מ/g, 'בעמ')
            .trim()
            .toLowerCase();

        const ocrName = normalize(data.supplier_name!);

        // Skip if OCR name is too short to be meaningful
        if (ocrName.length >= 2) {
          const scored: { supplier: (typeof currentSuppliers)[number]; score: number }[] = [];
          for (const s of currentSuppliers) {
            const sName = normalize(s.name);
            if (!sName) continue;

            let score = 0;
            // Exact match
            if (sName === ocrName) score = 1000;
            // Full substring (either direction)
            else if (sName.includes(ocrName)) score = 800 - Math.abs(sName.length - ocrName.length);
            else if (ocrName.includes(sName) && sName.length >= 3) score = 700 - Math.abs(sName.length - ocrName.length);
            else {
              // Word-level match: count matching tokens of length >= 2
              const ocrTokens = ocrName.split(' ').filter(t => t.length >= 2);
              const sTokens = sName.split(' ').filter(t => t.length >= 2);
              if (ocrTokens.length > 0 && sTokens.length > 0) {
                const matched = ocrTokens.filter(t =>
                  sTokens.some(st => st === t || st.includes(t) || t.includes(st))
                ).length;
                if (matched > 0) {
                  // Score based on ratio of matched tokens
                  score = 400 + (matched / Math.max(ocrTokens.length, sTokens.length)) * 200;
                }
              }
            }
            if (score > 0) scored.push({ supplier: s, score });
          }
          scored.sort((a, b) => b.score - a.score);
          // Require at least a token-level match (score >= 400)
          if (scored.length > 0 && scored[0].score >= 400) {
            matchedId = scored[0].supplier.id;
          }
        }
      }
      setSupplierId(matchedId);
      setPaymentTabSupplierId(matchedId);
      setSummarySupplierId(matchedId);

      // Auto-fill discount from supplier defaults
      if (matchedId) {
        const matched = currentSuppliers.find(s => s.id === matchedId);
        if (matched?.default_discount_percentage && matched.default_discount_percentage > 0) {
          setDiscountPercentage(matched.default_discount_percentage.toString());
        }
        // VAT-exempt supplier override. If the supplier is flagged vat_type='none',
        // the matched supplier's status wins over anything OCR extracted. Use the
        // invoice's total as the before-VAT amount (OCR may have split a gross
        // price into subtotal+vat even though the document has no VAT line) and
        // force the VAT override to 0.
        if (matched?.vat_type === 'none') {
          const total = data.total_amount !== undefined && data.total_amount !== null
            ? Number(data.total_amount)
            : (data.subtotal !== undefined && data.subtotal !== null ? Number(data.subtotal) : null);
          if (total !== null && !Number.isNaN(total)) {
            setAmountBeforeVat(total.toString());
          }
          setPartialVat(true);
          setVatAmount('0');
        }
      }

      // Reset payment fields
      setIsPaid(false);
      setInlinePaymentMethod('');
      setInlinePaymentDate('');
      setInlinePaymentReference('');
      setInlinePaymentNotes('');

      // For payment tab, pre-fill the amount from OCR total
      const totalStr = data.total_amount?.toString() || '';
      setPaymentMethods([{ id: 1, method: '', amount: totalStr, installments: '1', checkNumber: '', creditCardId: '', customInstallments: [] }]);
      setInlinePaymentMethods([{ id: 1, method: '', amount: '', installments: '1', checkNumber: '', creditCardId: '', customInstallments: [] }]);
      setPaymentTabReference(data.document_number || '');
      setPaymentTabNotes('');
      setNotes('');

      // Summary fields - use matched supplier and OCR data
      setSummaryDate(docDate);
      setSummaryInvoiceNumber(data.document_number || '');
      setSummaryTotalAmount(data.total_amount?.toString() || '');
      setSummaryIsClosed('');
      setSummaryNotes('');
      setSummaryDeliveryNotes([]);
      setShowAddDeliveryNote(false);
      setNewDeliveryNote({ delivery_note_number: '', delivery_date: '', total_amount: '', notes: '' });

      // Populate line items from OCR extraction
      if (data.line_items && data.line_items.length > 0) {
        setLineItems(data.line_items);
      } else {
        setLineItems([]);
      }
      setPriceCheckDone(false);
    } else {
      // Reset all fields
      setDocumentType('invoice');
      setExpenseType('goods');
      setSupplierId('');
      const today = new Date().toISOString().split('T')[0];
      setDocumentDate(today);
      setDocumentNumber('');
      setAmountBeforeVat('');
      setVatAmount('');
      setPartialVat(false);
      setNotes('');
      setIsPaid(false);
      setIsDisputed(false);
      setDisputeReason('');
      setIsSummaryLinked(false);
      setInlinePaymentMethod('');
      setInlinePaymentDate('');
      setInlinePaymentReference('');
      setInlinePaymentNotes('');
      setInlinePaymentMethods([{ id: 1, method: '', amount: '', installments: '1', checkNumber: '', creditCardId: '', customInstallments: [] }]);
      setPaymentTabDate(today);
      setPaymentTabExpenseType('expenses');
      setPaymentTabSupplierId('');
      setPaymentTabReference('');
      setPaymentTabNotes('');
      setPaymentMethods([{ id: 1, method: '', amount: '', installments: '1', checkNumber: '', creditCardId: '', customInstallments: [] }]);
      // Reset summary fields
      setSummarySupplierId('');
      setSummaryDate(new Date().toISOString().split('T')[0]);
      setSummaryInvoiceNumber('');
      setSummaryTotalAmount('');
      setSummaryIsClosed('');
      setSummaryNotes('');
      setSummaryDeliveryNotes([]);
      setShowAddDeliveryNote(false);
      setNewDeliveryNote({ delivery_note_number: '', delivery_date: '', total_amount: '', notes: '' });
      setLineItems([]);
      setPriceCheckDone(false);
    }
    // Restore the draft (per-document, keyed by business+document id) regardless
    // of whether the document has OCR data — the draft holds the user's manual
    // edits, which must outrank the OCR baseline. Without this, switching to a
    // sibling document and back wipes out edits the user already made.
    draftRestored.current = false;
    setTimeout(() => {
      const draft = restoreDraft();
      if (draft) {
        if (draft.documentType) setDocumentType(draft.documentType as DocumentType);
        if (draft.expenseType) setExpenseType(draft.expenseType as ExpenseType);
        if (draft.supplierId !== undefined) setSupplierId(draft.supplierId as string);
        if (draft.documentDate) setDocumentDate(draft.documentDate as string);
        if (draft.documentNumber !== undefined) setDocumentNumber(draft.documentNumber as string);
        if (draft.discountAmount !== undefined) setDiscountAmount(draft.discountAmount as string);
        if (draft.discountPercentage !== undefined) setDiscountPercentage(draft.discountPercentage as string);
        if (draft.amountBeforeVat !== undefined) setAmountBeforeVat(draft.amountBeforeVat as string);
        if (draft.vatAmount !== undefined) setVatAmount(draft.vatAmount as string);
        if (draft.partialVat !== undefined) setPartialVat(draft.partialVat as boolean);
        if (draft.notes !== undefined) setNotes(draft.notes as string);
        if (draft.isPaid !== undefined) setIsPaid(draft.isPaid as boolean);
        if (draft.inlinePaymentMethod !== undefined) setInlinePaymentMethod(draft.inlinePaymentMethod as string);
        if (draft.inlinePaymentDate !== undefined) setInlinePaymentDate(draft.inlinePaymentDate as string);
        if (draft.inlinePaymentReference !== undefined) setInlinePaymentReference(draft.inlinePaymentReference as string);
        if (draft.inlinePaymentNotes !== undefined) setInlinePaymentNotes(draft.inlinePaymentNotes as string);
        if (draft.inlinePaymentMethods) setInlinePaymentMethods(draft.inlinePaymentMethods as PaymentMethodEntry[]);
        if (draft.paymentTabDate) setPaymentTabDate(draft.paymentTabDate as string);
        if (draft.paymentTabExpenseType) setPaymentTabExpenseType(draft.paymentTabExpenseType as 'all' | 'expenses' | 'purchases' | 'employees');
        if (draft.paymentTabSupplierId !== undefined) setPaymentTabSupplierId(draft.paymentTabSupplierId as string);
        if (draft.paymentTabReference !== undefined) setPaymentTabReference(draft.paymentTabReference as string);
        if (draft.paymentTabNotes !== undefined) setPaymentTabNotes(draft.paymentTabNotes as string);
        if (draft.paymentMethods) setPaymentMethods(draft.paymentMethods as PaymentMethodEntry[]);
        if (draft.summarySupplierId !== undefined) setSummarySupplierId(draft.summarySupplierId as string);
        if (draft.summaryDate) setSummaryDate(draft.summaryDate as string);
        if (draft.summaryInvoiceNumber !== undefined) setSummaryInvoiceNumber(draft.summaryInvoiceNumber as string);
        if (draft.summaryTotalAmount !== undefined) setSummaryTotalAmount(draft.summaryTotalAmount as string);
        if (draft.summaryIsClosed !== undefined) setSummaryIsClosed(draft.summaryIsClosed as string);
        if (draft.summaryNotes !== undefined) setSummaryNotes(draft.summaryNotes as string);
        if (draft.summaryDeliveryNotes) setSummaryDeliveryNotes(draft.summaryDeliveryNotes as DeliveryNoteEntry[]);
      }
      draftRestored.current = true;
    }, 0);
    // Re-run only when the document identity changes — NOT when `suppliers` or
    // `document` (object reference) change. Realtime supplier refreshes used to
    // re-run this effect and silently restore line items the user had just
    // deleted. `suppliers` is read via suppliersRef.current inside the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document?.id, restoreDraft]);

  // Calculator drag handlers
  const handleCalcDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const el = (e.target as HTMLElement).closest('[data-calc-popup]') as HTMLElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    calcDragRef.current = { startX: clientX, startY: clientY, origX: rect.left, origY: rect.top };

    const handleMove = (ev: MouseEvent | TouchEvent) => {
      if (!calcDragRef.current) return;
      const cx = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
      const cy = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
      const dx = cx - calcDragRef.current.startX;
      const dy = cy - calcDragRef.current.startY;
      setCalcPos({ x: calcDragRef.current.origX + dx, y: calcDragRef.current.origY + dy });
    };
    const handleEnd = () => {
      calcDragRef.current = null;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);
  }, []);

  // Calculator logic
  const calcInput = useCallback((value: string) => {
    if (value === 'C') {
      setCalcDisplay('0');
      setCalcExpression('');
    } else if (value === '⌫') {
      setCalcDisplay(prev => prev.length > 1 ? prev.slice(0, -1) : '0');
    } else if (value === '=') {
      try {
        // Safe eval using Function constructor (only numbers and operators)
        const sanitized = calcExpression.replace(/[^0-9+\-*/.() ]/g, '');
        if (sanitized) {
          const result = new Function('return ' + sanitized)();
          const formatted = typeof result === 'number' && isFinite(result)
            ? parseFloat(result.toFixed(6)).toString()
            : 'שגיאה';
          setCalcDisplay(formatted);
          setCalcExpression(formatted);
        }
      } catch {
        setCalcDisplay('שגיאה');
        setCalcExpression('');
      }
    } else if (['+', '-', '*', '/'].includes(value)) {
      setCalcExpression(prev => prev + value);
      setCalcDisplay(value);
    } else if (value === '.') {
      setCalcExpression(prev => prev + '.');
      setCalcDisplay(prev => prev.includes('.') ? prev : prev + '.');
    } else {
      // digit
      setCalcExpression(prev => prev + value);
      setCalcDisplay(prev => prev === '0' || ['+', '-', '*', '/', 'שגיאה'].includes(prev) ? value : prev + value);
    }
  }, [calcExpression]);

  const handleSubmit = () => {
    if (!selectedBusinessId) {
      alert('נא לבחור עסק');
      return;
    }

    // Duplicate warning — ask for confirmation before proceeding
    if (duplicateWarning && !duplicateConfirmedRef.current) {
      confirm(`⚠️ ${duplicateWarning}\n\nהאם להמשיך בכל זאת?`, () => {
        duplicateConfirmedRef.current = true;
        handleSubmit();
      });
      return;
    }

    // Fixed-expense overwrite guard — when the user chose to update an existing fixed-expense
    // invoice, warn if the OCR values look like a different invoice (different number, or >20%
    // amount delta). Prevents silently overwriting a legitimate Bubble-imported invoice.
    if (linkToFixedInvoiceId && !fixedOverwriteConfirmedRef.current && (documentType === 'invoice' || documentType === 'credit_note' || documentType === 'disputed_invoice')) {
      const target = fixedOpenInvoices.find(f => f.id === linkToFixedInvoiceId);
      if (target) {
        const targetTotal = Number(target.total_amount) || 0;
        const newTotal = parseFloat(totalWithVat.toFixed(2)) || 0;
        const pctDiff = targetTotal > 0 ? Math.abs((newTotal - targetTotal) / targetTotal) * 100 : 0;
        const amountMismatch = targetTotal > 0 && pctDiff > 20;
        if (amountMismatch) {
          confirm(
            `⚠️ עדכון חשבונית הוצאה קבועה\n\nסכום החשבונית שנבחרה: ₪${targetTotal.toFixed(2)}\nסכום החדש מה-OCR: ₪${newTotal.toFixed(2)} (שינוי של ${pctDiff.toFixed(1)}%)\n\nנראה ששני הסכומים שונים מהותית — ייתכן שזו חשבונית אחרת ולא עדכון.\n\nלהמשיך ולדרוס את החשבונית הקיימת?`,
            () => {
              fixedOverwriteConfirmedRef.current = true;
              handleSubmit();
            }
          );
          return;
        }
      }
    }

    if (documentType === 'daily_entry') {
      // Daily entry validation
      if (!dailyEntryDate) {
        alert('נא לבחור תאריך');
        return;
      }
      const submitDailyEntry = () => {
        const formData: OCRFormData = {
          business_id: selectedBusinessId,
          document_type: 'daily_entry',
          expense_type: 'current',
          supplier_id: '',
          document_date: dailyEntryDate,
          document_number: '',
          amount_before_vat: '0',
          vat_amount: '0',
          total_amount: '0',
          notes: '',
          is_paid: false,
          daily_entry_date: dailyEntryDate,
          daily_total_register: dailyTotalRegister,
          daily_day_factor: dailyDayFactor,
          daily_labor_cost: dailyLaborCost,
          daily_labor_hours: dailyLaborHours,
          daily_discounts: dailyDiscounts,
          daily_income_data: dailyIncomeData,
          daily_receipt_data: dailyReceiptData,
          daily_parameter_data: dailyParameterData,
          daily_product_usage: dailyProductUsage,
          daily_managed_products: dailyManagedProducts.map(p => ({ id: p.id, unit_cost: p.unit_cost })),
          merged_document_ids: mergedDocuments.length > 0 ? mergedDocuments.map(d => d.id) : undefined,
          ...(isPearla && { daily_pearla_data: {
            portions_count: dailyPearlaData.portions_count,
            serving_supplement: dailyPearlaData.serving_supplement,
            extras_income: dailyPearlaData.extras_income,
            salaried_labor_cost: dailyPearlaData.salaried_labor_cost,
            manpower_labor_cost: dailyPearlaData.manpower_labor_cost,
          }}),
        };
        clearDraft();
        onApprove(formData);
      };
      if (dailyDateWarning) {
        confirm('כבר קיים רישום לתאריך זה. האם להמשיך?', submitDailyEntry);
        return;
      }
      submitDailyEntry();
      return;
    }

    if (documentType === 'payment') {
      // Payment tab validation
      if (!paymentTabSupplierId || !paymentTabDate) {
        alert('נא למלא את כל השדות הנדרשים');
        return;
      }
      // Validate installments sum matches payment amount
      for (const pm of paymentMethods) {
        if (pm.customInstallments.length > 0) {
          const pmTotal = parseFloat(pm.amount.replace(/[^\d.-]/g, '')) || 0;
          const installmentsTotal = getInstallmentsTotal(pm.customInstallments);
          if (Math.abs(installmentsTotal - pmTotal) > 0.01) {
            alert(`סכום התשלומים (${installmentsTotal.toFixed(2)}) לא תואם לסכום לתשלום (${pmTotal.toFixed(2)})`);
            return;
          }
        }
      }
      const formData: OCRFormData = {
        business_id: selectedBusinessId,
        document_type: documentType,
        expense_type: paymentTabExpenseType === 'purchases' ? 'goods' : paymentTabExpenseType === 'employees' ? 'employee_costs' : 'current',
        supplier_id: paymentTabSupplierId,
        document_date: paymentTabDate,
        document_number: '',
        amount_before_vat: '0',
        vat_amount: '0',
        total_amount: paymentMethods.reduce((s, p) => s + (parseFloat(p.amount.replace(/[^\d.-]/g, '')) || 0), 0).toFixed(2),
        notes: paymentTabNotes,
        is_paid: true,
        payment_method: paymentMethods[0]?.method || '',
        payment_date: paymentTabDate,
        payment_installments: parseInt(paymentMethods[0]?.installments) || 1,
        payment_reference: paymentTabReference,
        payment_notes: paymentTabNotes,
        payment_methods: paymentMethods,
        payment_linked_invoice_ids: Array.from(paymentSelectedInvoiceIds),
        merged_document_ids: mergedDocuments.length > 0 ? mergedDocuments.map(d => d.id) : undefined,
      };
      clearDraft();
      onApprove(formData);
    } else if (documentType === 'summary') {
      // Summary tab validation
      if (!summarySupplierId) {
        alert('נא לבחור ספק מרכזת');
        return;
      }
      if (!summaryDate) {
        alert('נא לבחור תאריך');
        return;
      }
      if (!summaryInvoiceNumber.trim()) {
        alert('נא להזין מספר חשבונית');
        return;
      }
      if (!summaryTotalAmount || parseFloat(summaryTotalAmount) <= 0) {
        alert('נא להזין סכום');
        return;
      }
      if (!summaryIsClosed) {
        alert('נא לבחור האם נסגר');
        return;
      }
      if (summaryIsClosed === 'yes' && summaryDeliveryNotes.length > 0 && !summaryTotalsMatch) {
        alert('סכום החשבונית לא תואם לסכום תעודות המשלוח');
        return;
      }

      const total = parseFloat(summaryTotalAmount);
      const subtotal = total / (1 + businessVatRate);
      const vat = total - subtotal;

      const formData: OCRFormData = {
        business_id: selectedBusinessId,
        document_type: 'summary',
        expense_type: 'goods',
        supplier_id: summarySupplierId,
        document_date: summaryDate,
        document_number: summaryInvoiceNumber.trim(),
        amount_before_vat: subtotal.toFixed(2),
        vat_amount: vat.toFixed(2),
        total_amount: total.toFixed(2),
        notes: summaryNotes,
        is_paid: false,
        summary_delivery_notes: summaryDeliveryNotes,
        summary_is_closed: summaryIsClosed,
        // Pass existing delivery note IDs to link (instead of creating new ones)
        summary_existing_delivery_note_ids: Array.from(selectedDeliveryNoteIds),
        merged_document_ids: mergedDocuments.length > 0 ? mergedDocuments.map(d => d.id) : undefined,
      };
      clearDraft();
      onApprove(formData);
      return;
    } else {
      // Invoice / Delivery Note / Credit Note
      if (!supplierId || !documentDate || !amountBeforeVat) {
        alert('נא למלא את כל השדות הנדרשים');
        return;
      }
      // Validate inline payment installments sum matches payment amount
      if (isPaid) {
        for (const pm of inlinePaymentMethods) {
          if (pm.customInstallments.length > 0) {
            const pmTotal = parseFloat(pm.amount.replace(/[^\d.-]/g, '')) || 0;
            const installmentsTotal = getInstallmentsTotal(pm.customInstallments);
            if (Math.abs(installmentsTotal - pmTotal) > 0.01) {
              alert(`סכום התשלומים (${installmentsTotal.toFixed(2)}) לא תואם לסכום לתשלום (${pmTotal.toFixed(2)})`);
              return;
            }
          }
        }
      }
      const formData: OCRFormData = {
        business_id: selectedBusinessId,
        document_type: isDisputed ? 'disputed_invoice' : isSummaryLinked ? 'delivery_note' : documentType,
        dispute_reason: isDisputed ? disputeReason : undefined,
        expense_type: expenseType,
        supplier_id: supplierId,
        document_date: documentDate,
        document_number: documentNumber,
        discount_amount: discountAmount,
        discount_percentage: discountPercentage,
        amount_before_vat: amountBeforeVat,
        vat_amount: partialVat ? vatAmount : calculatedVat.toFixed(2),
        total_amount: totalWithVat.toFixed(2),
        notes,
        is_paid: isPaid,
        link_to_fixed_invoice_id: linkToFixedInvoiceId,
        line_items: lineItems.length > 0 ? lineItems : undefined,
        merged_document_ids: mergedDocuments.length > 0 ? mergedDocuments.map(d => d.id) : undefined,
        ...(isPaid && {
          payment_method: inlinePaymentMethods[0]?.method || inlinePaymentMethod,
          payment_date: inlinePaymentDate,
          payment_installments: parseInt(inlinePaymentMethods[0]?.installments) || 1,
          payment_reference: inlinePaymentReference,
          payment_notes: inlinePaymentNotes,
          payment_methods: inlinePaymentMethods,
        }),
      };
      clearDraft();
      onApprove(formData);
    }
  };

  const handleReject = () => {
    if (document) {
      const finalReason = rejectReason === 'אחר' ? (rejectCustomText.trim() || 'אחר') : rejectReason;
      onReject(document.id, finalReason);
      setShowRejectModal(false);
      setRejectReason('');
      setRejectCustomText('');
    }
  };

  // Render payment methods section (reusable for both payment tab and inline)
  const renderPaymentMethodsSection = (
    methods: PaymentMethodEntry[],
    setter: React.Dispatch<React.SetStateAction<PaymentMethodEntry[]>>,
    dateStr: string,
    dateSetter?: (d: string) => void,
    activeSupplierId?: string,
    referenceNumber?: string,
  ) => (
    <div className="flex flex-col gap-[15px]">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-medium text-white">אמצעי תשלום</span>
        <Button
          type="button"
          onClick={() => addPaymentMethodEntry(setter, methods)}
          className="bg-[#29318A] text-white text-[14px] font-medium px-[12px] py-[6px] rounded-[7px] hover:bg-[#3D44A0] transition-colors h-auto"
        >
          + הוסף אמצעי תשלום
        </Button>
      </div>

      {methods.map((pm, pmIndex) => (
        <div key={pm.id} className="border border-[#4C526B] rounded-[10px] p-[10px] flex flex-col gap-[10px]">
          {methods.length > 1 && (
            <div className="flex items-center justify-between mb-[5px]">
              <span className="text-[14px] text-white/70">אמצעי תשלום {pmIndex + 1}</span>
              <Button
                type="button"
                variant="ghost"
                onClick={() => removePaymentMethodEntry(setter, methods, pm.id)}
                className="text-[14px] text-red-400 hover:text-red-300 transition-colors"
              >
                הסר
              </Button>
            </div>
          )}

          {/* Payment Method Select */}
          <Select
            value={pm.method || "__none__"}
            onValueChange={(val) => {
              const method = val === "__none__" ? "" : val;
              // When user picks credit_card and there's no card on this row yet,
              // resolve the supplier's default card so it gets auto-selected.
              let presetCardId: string | undefined;
              if (method === 'credit_card' && !pm.creditCardId && activeSupplierId) {
                const sup = suppliers.find(s => s.id === activeSupplierId);
                const defaultCardId = sup?.default_credit_card_id || '';
                if (defaultCardId && businessCreditCards.some(c => c.id === defaultCardId)) {
                  presetCardId = defaultCardId;
                }
              }
              updatePaymentMethodField(setter, methods, pm.id, 'method', method, dateStr, dateSetter, presetCardId, referenceNumber);
            }}
          >
            <SelectTrigger className="w-full h-[50px] bg-[#0F1535] text-[18px] text-white text-center rounded-[10px] border-[#4C526B] cursor-pointer">
              <SelectValue placeholder="בחר אמצעי תשלום..." />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((method) => (
                <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Credit Card Selection - only show when method is credit_card */}
          {pm.method === 'credit_card' && businessCreditCards.length > 0 && (
            <Select
              value={pm.creditCardId || "__none__"}
              onValueChange={(val) => {
                const cardId = val === "__none__" ? "" : val;
                // Auto-set payment date when credit card is selected
                if (dateSetter && cardId) {
                  const smartDate = getSmartPaymentDate('credit_card', documentDate, cardId);
                  if (smartDate) dateSetter(smartDate);
                }
                setter(prev => prev.map(p => {
                  if (p.id !== pm.id) return p;
                  const updated = { ...p, creditCardId: cardId };
                  const card = businessCreditCards.find(c => c.id === cardId);
                  // Pass documentDate (the invoice date) — calculateCreditCardDueDate
                  // uses it to derive the actual billing day. Using dateStr here
                  // would mean the previously-set payment date, which is stale
                  // (this same handler just called dateSetter above and dateStr
                  // is still the previous render's value).
                  const baseDate = documentDate || dateStr;
                  if (card && baseDate) {
                    const numInstallments = parseInt(p.installments) || 1;
                    const totalAmount = parseFloat(p.amount.replace(/[^\d.-]/g, '')) || 0;
                    if (totalAmount > 0) {
                      updated.customInstallments = generateCreditCardInstallments(numInstallments, totalAmount, baseDate, card.billing_day);
                    }
                  }
                  return updated;
                }));
              }}
            >
              <SelectTrigger className="w-full h-[50px] bg-[#0F1535] text-[18px] text-white text-center rounded-[10px] border-[#4C526B] cursor-pointer">
                <SelectValue placeholder="בחר כרטיס..." />
              </SelectTrigger>
              <SelectContent>
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
                // Strip everything except digits, dot, minus.
                let val = e.target.value.replace(/[^\d.-]/g, '');
                // If the user typed more than one dot, keep only the first
                // — KEEPING the digits that came after subsequent dots
                // (the previous regex `(\..*)\.` was greedy and silently
                // dropped the trailing portion, which scrambled the amount
                // when the user tried to insert a dot mid-string).
                const firstDot = val.indexOf('.');
                if (firstDot !== -1) {
                  const before = val.slice(0, firstDot + 1);
                  const after = val.slice(firstDot + 1).replace(/\./g, '');
                  val = before + after;
                }
                updatePaymentMethodField(setter, methods, pm.id, 'amount', val, dateStr);
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
                variant="ghost"
                size="icon"
                title="הפחת תשלום"
                onClick={() => updatePaymentMethodField(setter, methods, pm.id, 'installments', String(Math.max(1, parseInt(pm.installments) - 1)), dateStr, undefined, undefined, referenceNumber)}
                className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
              >
                -
              </Button>
              <Input
                type="text"
                inputMode="numeric"
                title="כמות תשלומים"
                value={pm.installments}
                onChange={(e) => updatePaymentMethodField(setter, methods, pm.id, 'installments', e.target.value.replace(/\D/g, '') || '1', dateStr, undefined, undefined, referenceNumber)}
                className="flex-1 h-[50px] bg-transparent text-[18px] text-white text-center focus:outline-none"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="הוסף תשלום"
                onClick={() => updatePaymentMethodField(setter, methods, pm.id, 'installments', String(parseInt(pm.installments) + 1), dateStr, undefined, undefined, referenceNumber)}
                className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
              >
                +
              </Button>
            </div>

            {/* Installments Breakdown */}
            {pm.customInstallments.length > 0 && (
              <div className="mt-[10px] border border-[#4C526B] rounded-[10px] p-[10px]">
                <div className="flex items-center gap-[8px] border-b border-[#4C526B] pb-[8px] mb-[8px]">
                  <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תשלום</span>
                  <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תאריך</span>
                  {pm.method === 'check' && <span className="text-[14px] font-medium text-white/70 flex-1 text-center">מס׳ צ׳ק</span>}
                  <span className="text-[14px] font-medium text-white/70 flex-1 text-center">סכום</span>
                </div>
                <div className="flex flex-col gap-[8px] max-h-[200px] overflow-y-auto">
                  {pm.customInstallments.map((item, index) => (
                    <div key={item.number} className="flex items-center gap-[8px]">
                      <span className="text-[14px] text-white ltr-num flex-1 text-center">{item.number}/{pm.installments}</span>
                      <div className="flex-1">
                        <DatePickerField
                          value={item.dateForInput}
                          onChange={(val) => handleInstallmentDateChange(
                            setter,
                            pm.id,
                            index,
                            val,
                            // Only sync top-level date when editing the first installment of the first payment method
                            pm.id === methods[0].id ? dateSetter : undefined,
                          )}
                          className="h-[36px] rounded-[7px] text-[14px]"
                        />
                      </div>
                      {pm.method === 'check' && (
                        <div className="flex-1">
                          <Input
                            type="text"
                            inputMode="numeric"
                            title={`מספר צ׳ק תשלום ${item.number}`}
                            value={item.checkNumber || ''}
                            onChange={(e) => handleInstallmentCheckNumberChange(setter, pm.id, index, e.target.value)}
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
                          onChange={(e) => handleInstallmentAmountChange(setter, pm.id, index, e.target.value)}
                          className="w-full h-[36px] bg-[#29318A]/30 border border-[#4C526B] rounded-[7px] text-[14px] text-white text-center focus:outline-none focus:border-white/50 px-[5px] ltr-num"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {(() => {
                  const installmentsTotal = getInstallmentsTotal(pm.customInstallments);
                  const pmTotal = parseFloat(pm.amount.replace(/[^\d.-]/g, '')) || 0;
                  const isMismatch = Math.abs(installmentsTotal - pmTotal) > 0.01;
                  return (
                    <div className="flex items-center gap-[8px] border-t border-[#4C526B] pt-[8px] mt-[8px]">
                      <span className="text-[14px] font-bold text-white w-[50px] text-center flex-shrink-0">סה&quot;כ</span>
                      <span className="flex-1"></span>
                      {pm.method === 'check' && <span className="flex-1"></span>}
                      <span className={`text-[14px] font-bold ltr-num flex-1 text-center ${isMismatch ? 'text-red-400' : 'text-white'}`}>
                        ₪{installmentsTotal.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
  );

  // Render Invoice / Delivery Note / Credit Note form (aligned with expenses new form)
  const renderInvoiceForm = () => (
    <div className="flex flex-col gap-[15px]">
      {/* Expense Type */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">סוג הוצאה</label>
        <div className="flex items-center justify-start gap-[20px]">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setExpenseType('goods')}
            className="flex items-center gap-[3px]"
          >
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={expenseType === 'goods' ? 'text-white' : 'text-white/50'}>
              {expenseType === 'goods' ? (
                <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor" />
              ) : (
                <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" />
              )}
            </svg>
            <span className={`text-[15px] font-semibold ${expenseType === 'goods' ? 'text-white' : 'text-white/50'}`}>
              קניות סחורה
            </span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setExpenseType('current')}
            className="flex items-center gap-[3px]"
          >
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={expenseType === 'current' ? 'text-white' : 'text-white/50'}>
              {expenseType === 'current' ? (
                <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor" />
              ) : (
                <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" />
              )}
            </svg>
            <span className={`text-[15px] font-semibold ${expenseType === 'current' ? 'text-white' : 'text-white/50'}`}>
              הוצאות שוטפות
            </span>
          </Button>
        </div>
      </div>

      {/* Date Field */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">תאריך</label>
        <DatePickerField
          value={documentDate}
          onChange={(val) => setDocumentDate(val)}
        />
      </div>

      {/* Supplier Select */}
      {document?.ocr_data?.supplier_name && !supplierId && (
        <div className="bg-[#29318A]/20 border border-[#29318A]/40 rounded-[8px] px-[10px] py-[6px]">
          <span className="text-[13px] text-[#00D4FF]">זוהה מ-OCR: </span>
          <span className="text-[13px] text-white font-medium">{document.ocr_data.supplier_name}</span>
        </div>
      )}
      <SupplierSearchSelect
        suppliers={suppliers}
        value={supplierId}
        onChange={(id) => {
          setSupplierId(id);
          setIsSummaryLinked(false);
          const sel = suppliers.find(s => s.id === id);
          // Auto-fill discount from supplier defaults
          if (sel?.default_discount_percentage && sel.default_discount_percentage > 0) {
            setDiscountPercentage(sel.default_discount_percentage.toString());
          } else {
            setDiscountPercentage('');
          }
          // VAT-exempt supplier (vat_type='none'): force VAT amount to 0
          if (sel?.vat_type === 'none') {
            setPartialVat(true);
            setVatAmount('0');
          } else {
            // Reset to standard VAT calculation when switching to a regular supplier
            setPartialVat(false);
            setVatAmount('');
          }
          // Auto-sync expense type to match the supplier's classification so
          // the created invoice lands under the right bucket in the P&L
          // report. Without this the expense stayed on the form's default
          // ("קניות סחורה") even when the user picked a "הוצאות שוטפות"
          // supplier, silently breaking the P&L totals.
          if (sel?.expense_type) {
            const mapped: ExpenseType | null =
              sel.expense_type === 'current_expenses' ? 'current' :
              sel.expense_type === 'goods_purchases' ? 'goods' :
              sel.expense_type === 'employee_costs' ? 'employee_costs' : null;
            if (mapped) setExpenseType(mapped);
          }
        }}
      />

      {/* Link to summary invoice checkbox - only for suppliers marked as מרכזת */}
      {(() => {
        const sel = suppliers.find(s => s.id === supplierId);
        if (!sel?.waiting_for_coordinator) return null;
        return (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setIsSummaryLinked(!isSummaryLinked)}
            className="flex items-center gap-[6px] min-h-[35px] w-full justify-start"
          >
            <svg width="21" height="21" viewBox="0 0 32 32" fill="none" className={isSummaryLinked ? 'text-[#A855F7]' : 'text-[#979797]'}>
              {isSummaryLinked ? (
                <>
                  <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor" />
                  <path d="M10 16L14 20L22 12" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </>
              ) : (
                <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" />
              )}
            </svg>
            <span className="text-[14px] font-medium text-white">שייך למרכזת (תעודת משלוח)</span>
          </Button>
        );
      })()}

      {/* Supplier Notes - show if selected supplier has notes */}
      {(() => {
        const selectedSupplier = suppliers.find(s => s.id === supplierId);
        if (selectedSupplier?.notes && selectedSupplier.notes.trim()) {
          return (
            <div className="bg-[#FFA500]/10 border border-[#FFA500]/40 rounded-[8px] px-[10px] py-[8px] flex items-start gap-[6px]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFA500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-[2px]">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span className="text-[13px] text-white/90 text-right leading-[1.4]">{selectedSupplier.notes}</span>
            </div>
          );
        }
        return null;
      })()}

      {/* Fixed Expense — link to existing open monthly invoice (or create new) */}
      {fixedOpenInvoices.length > 0 && (() => {
        const selectedSupplier = suppliers.find(s => s.id === supplierId);
        if (!selectedSupplier?.is_fixed_expense) return null;
        return (
          <div className="flex flex-col gap-[8px]">
            <div
              className="flex items-center gap-[5px] cursor-pointer"
              dir="rtl"
              onClick={() => setShowFixedInvoices(!showFixedInvoices)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={`text-white/70 transition-transform ${showFixedInvoices ? 'rotate-180' : ''}`}>
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
                      ? 'bg-[#4F46E5] text-white border border-white/30'
                      : 'bg-[#1A2150] text-white/70 border border-white/10 hover:bg-[#1A2150]/80'
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
                      fixedOverwriteConfirmedRef.current = false;
                      setAmountBeforeVat(String(inv.subtotal));
                      // NEVER overwrite documentDate when picking a fixed-expense
                      // month — even if it contains today's auto-default. The
                      // actual invoice date (whether OCR-extracted or
                      // user-typed) is always more accurate than the
                      // placeholder's month-start date. The intake API will
                      // update the placeholder's invoice_date to whatever the
                      // user submits.
                      if (selectedSupplier.vat_type === 'none') {
                        setPartialVat(true);
                        setVatAmount('0');
                      }
                    }}
                    className={`w-full text-right px-[12px] py-[10px] rounded-[10px] text-[13px] transition-all ${
                      linkToFixedInvoiceId === inv.id
                        ? 'bg-[#4F46E5] text-white border border-white/30'
                        : 'bg-[#1A2150] text-white/70 border border-white/10 hover:bg-[#1A2150]/80'
                    }`}
                  >
                    {inv.month} — &#8362;{inv.total_amount.toLocaleString('he-IL')}
                  </Button>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Document Number */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-normal text-white text-right">מספר חשבונית / תעודת משלוח</label>
        <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
          <Input
            type="text"
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
            placeholder="מספר מסמך..."
            className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
          />
        </div>
      </div>

      {/* Amount Before VAT — dir="ltr" keeps the minus sign on the
          left for negative amounts (credit notes). Without it, the
          browser puts '-' at the trailing edge of an RTL text-direction
          input, which looks like it's on the wrong side of the digits. */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">סכום לפני מע&apos;&apos;מ</label>
        <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
          <Input
            type="text"
            inputMode="decimal"
            dir="ltr"
            title="סכום לפני מע״מ"
            value={amountBeforeVat}
            onChange={(e) => setAmountBeforeVat(e.target.value)}
            placeholder="0.00"
            className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
          />
        </div>
      </div>

      {/* Overall invoice discount moved down into the line-items panel —
          see 'הנחה כללית' there. It used to live here at the top of the form,
          which made users expect it to affect the header totals even though
          it was only applied to line items. Now it's next to the items and
          it DOES reduce the invoice before-VAT / VAT / total. */}

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
              value={partialVat ? vatAmount : calculatedVat.toFixed(2)}
              onChange={(e) => setVatAmount(e.target.value)}
              disabled={!partialVat}
              className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px] disabled:text-white/50"
            />
          </div>
        </div>
        <div className="flex flex-col items-center gap-[5px]">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="הזנת סכום מע״מ חלקי"
            onClick={() => setPartialVat(!partialVat)}
            className="text-[#979797]"
          >
            <svg width="21" height="21" viewBox="0 0 32 32" fill="none">
              {partialVat ? (
                <>
                  <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor" />
                  <path d="M10 16L14 20L22 12" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </>
              ) : (
                <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" />
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
            value={totalWithVat.toFixed(2)}
            disabled
            className="w-full h-full bg-transparent text-white/50 text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
          />
        </div>
      </div>

      {/* Line Items & Price Tracking */}
      {(lineItems.length > 0 || documentType === 'invoice' || documentType === 'delivery_note') && (
        <div className="flex flex-col gap-[8px] border border-[#4C526B] rounded-[10px] p-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-medium text-white">פריטים ({lineItems.length})</span>
            <div className="flex items-center gap-[8px]">
              {priceAlerts.length > 0 && (
                <span className="text-[12px] font-medium bg-[#F64E60]/20 text-[#F64E60] px-[8px] py-[2px] rounded-full">
                  {priceAlerts.length} שינויי מחיר
                </span>
              )}
              {lineItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`למחוק את כל ${lineItems.length} הפריטים?`)) {
                      setLineItems([]);
                    }
                  }}
                  className="text-[12px] font-medium text-[#F64E60] hover:bg-[#F64E60]/10 px-[8px] py-[2px] rounded-[6px] transition-colors flex items-center gap-[4px]"
                  title="מחיקת כל הפריטים"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  <span>מחק הכל</span>
                </button>
              )}
            </div>
          </div>

          {/* Price alerts banner */}
          {priceCheckDone && priceAlerts.length > 0 && (
            <div className="bg-[#F64E60]/10 border border-[#F64E60]/30 rounded-[8px] p-[8px]">
              <p className="text-[12px] text-[#F64E60] font-medium text-right mb-[4px]">התראות שינוי מחיר:</p>
              {priceAlerts.map((li, idx) => (
                <div key={`alert-${li.description}-${idx}`} className="flex items-center justify-between text-[12px] py-[2px]">
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

          {/* Items table — editable quantity & price (#40) */}
          <div className="w-full text-[13px] overflow-x-auto" dir="rtl">
            {/* Header */}
            <div className="grid grid-cols-[1fr_50px_60px_75px_60px_28px] min-w-[320px] items-center border-b border-[#4C526B] text-white/60 py-[6px] px-[4px] gap-[2px]">
              <span className="text-right">פריט</span>
              <span className="text-center">כמות</span>
              <span className="text-center">מחיר</span>
              <span className="text-center">הנחה</span>
              <span className="text-center">סה&quot;כ</span>
              <span />
            </div>
            {/* Rows */}
            {lineItems.length === 0 && (
              <div className="text-center text-white/40 text-[13px] py-[10px]">אין פריטים — הוסף פריט ידנית</div>
            )}
            {lineItems.map((li, idx) => (
              <div key={`line-${idx}`} className="grid grid-cols-[1fr_50px_60px_75px_60px_28px] min-w-[320px] items-center border-b border-[#4C526B]/50 py-[6px] px-[4px] gap-[2px]">
                <span className="min-w-0 pr-[2px]">
                  <input
                    type="text"
                    value={li.description || ''}
                    onChange={(e) => {
                      setLineItems(prev => prev.map((item, i) => i !== idx ? item : { ...item, description: e.target.value }));
                    }}
                    className="w-full bg-transparent border border-[#4C526B]/50 focus:border-[#29318A] rounded-[4px] text-right text-white text-[13px] h-[28px] px-[3px] outline-none overflow-hidden text-ellipsis"
                    title={li.description || '-'}
                    dir="rtl"
                  />
                </span>
                <span className="px-[1px]">
                  <input
                    type="number"
                    value={li.quantity ?? ''}
                    onChange={(e) => {
                      const qty = e.target.value === '' ? undefined : Number(e.target.value);
                      setLineItems(prev => prev.map((item, i) => i !== idx ? item : {
                        ...item,
                        quantity: qty,
                        total: calcLineTotal(qty, item.unit_price, item.discount_amount, item.discount_type),
                      }));
                    }}
                    className="w-full bg-transparent border border-[#4C526B]/50 rounded-[4px] text-center text-white ltr-num text-[12px] h-[28px] px-[2px] outline-none focus:border-[#29318A] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    dir="ltr"
                  />
                </span>
                <span className="px-[1px]">
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      value={li.unit_price ?? ''}
                      onChange={(e) => {
                        const price = e.target.value === '' ? undefined : Number(e.target.value);
                        setLineItems(prev => prev.map((item, i) => {
                          if (i !== idx) return item;
                          // Recompute price_change_pct live when the user edits the unit price — so the
                          // inline ▲/▼ badge and the "התראות שינוי מחיר" banner stay in sync with the
                          // value the user just typed. Only recalculates when we have a matched
                          // supplier item with a previous_price to compare against.
                          const prev = item.previous_price;
                          let priceChangePct = item.price_change_pct;
                          if (prev != null && prev > 0 && price != null) {
                            const changePct = ((price - prev) / prev) * 100;
                            priceChangePct = Math.abs(changePct) < 0.01 ? 0 : changePct;
                          } else if (price == null) {
                            priceChangePct = undefined;
                          }
                          return {
                            ...item,
                            unit_price: price,
                            price_change_pct: priceChangePct,
                            total: calcLineTotal(item.quantity, price, item.discount_amount, item.discount_type),
                          };
                        }));
                      }}
                      className="w-full bg-transparent border border-[#4C526B]/50 rounded-[4px] text-center text-white ltr-num text-[12px] h-[28px] px-[2px] outline-none focus:border-[#29318A] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      dir="ltr"
                    />
                    {/* Always-rendered badge slot keeps the cell a stable 40px tall so toggling the badge doesn't jitter the row. */}
                    <span className="block h-[12px] leading-[12px] text-[9px] text-center">
                      {priceCheckDone && li.price_change_pct != null && li.price_change_pct !== 0 ? (
                        <span className={(li.price_change_pct || 0) > 0 ? 'text-[#F64E60]' : 'text-[#3CD856]'}>
                          {li.price_change_pct > 0 ? '▲' : '▼'}{Math.abs(li.price_change_pct).toFixed(1)}%
                        </span>
                      ) : priceCheckDone && li.is_new_item ? (
                        <span className="text-[#00D4FF]">חדש</span>
                      ) : ''}
                    </span>
                  </div>
                </span>
                <span className="px-[1px]">
                  <div className="flex items-center gap-[1px]">
                    <input
                      type="number"
                      step="0.01"
                      value={li.discount_amount ?? ''}
                      onChange={(e) => {
                        const disc = e.target.value === '' ? undefined : Number(e.target.value);
                        const dType = li.discount_type || 'percent'; // default: percent (most discounts are %)
                        setLineItems(prev => prev.map((item, i) => i !== idx ? item : {
                          ...item,
                          discount_amount: disc,
                          discount_type: dType,
                          total: calcLineTotal(item.quantity, item.unit_price, disc, dType),
                        }));
                      }}
                      className="w-[42px] bg-transparent border border-[#4C526B]/50 rounded-r-[4px] rounded-l-none text-center text-white ltr-num text-[12px] h-[28px] px-[1px] outline-none focus:border-[#29318A] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const newType = (li.discount_type || 'percent') === 'amount' ? 'percent' : 'amount';
                        setLineItems(prev => prev.map((item, i) => i !== idx ? item : {
                          ...item,
                          discount_type: newType,
                          total: calcLineTotal(item.quantity, item.unit_price, item.discount_amount, newType),
                        }));
                      }}
                      className="h-[28px] w-[28px] flex items-center justify-center bg-[#29318A]/50 hover:bg-[#29318A] border border-[#4C526B]/50 rounded-l-[4px] rounded-r-none text-[10px] text-white/70 hover:text-white transition-colors flex-shrink-0"
                      title={`לחץ להחלפה: ${(li.discount_type || 'percent') === 'amount' ? '₪ → %' : '% → ₪'}`}
                    >
                      {(li.discount_type || 'percent') === 'amount' ? '₪' : '%'}
                    </button>
                  </div>
                </span>
                <span className="text-center text-white/70 ltr-num text-[12px]">&#8362;{li.total?.toFixed(2) || '0'}</span>
                <span className="text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setLineItems(prev => prev.filter((_, i) => i !== idx))}
                    className="text-[#F64E60]/60 hover:text-[#F64E60] text-[14px] h-7 w-7"
                    title="הסר פריט"
                  >
                    &times;
                  </Button>
                </span>
              </div>
            ))}
            {/* Items total — display only, lets user verify amounts match */}
            {lineItems.length > 0 && (() => {
              const itemsTotal = lineItems.reduce((sum, li) => sum + (li.total || 0), 0);
              return (
                <div className="grid grid-cols-[1fr_50px_60px_75px_60px_28px] min-w-[320px] items-center border-t border-[#4C526B] py-[6px] px-[4px] gap-[2px]">
                  <span className="text-right text-white/70 text-[13px] font-medium">סה&quot;כ פריטים</span>
                  <span />
                  <span />
                  <span />
                  <span className="text-center text-white font-semibold ltr-num text-[13px]">&#8362;{itemsTotal.toFixed(2)}</span>
                  <span />
                </div>
              );
            })()}
            {/* Overall invoice discount — reduces the before-VAT amount and cascades
                into VAT and total. Lives next to line items because conceptually it's
                an items-level discount the supplier granted across the whole invoice. */}
            <div className="flex flex-col gap-[4px] border-t border-[#4C526B] pt-[8px] mt-[2px]">
              <label className="text-[13px] font-medium text-white/80 text-right">הנחה כללית</label>
              <div className="flex items-center gap-[5px]">
                <div className="border border-[#4C526B] rounded-[8px] h-[40px] flex-1">
                  <Input
                    type="text"
                    inputMode="decimal"
                    title="הנחה על כל הסכום"
                    value={discountAmount}
                    onChange={(e) => {
                      const val = e.target.value.replace(/,/g, '');
                      setDiscountAmount(val);
                      const baseAmount = parseFloat(amountBeforeVat) || 0;
                      const discAmt = parseFloat(val) || 0;
                      if (baseAmount > 0 && discAmt > 0) {
                        setDiscountPercentage(((discAmt / baseAmount) * 100).toFixed(2));
                      } else {
                        setDiscountPercentage('');
                      }
                    }}
                    placeholder="0.00"
                    className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[8px] border-none outline-none px-[8px]"
                  />
                </div>
                <span className="text-white/60 text-[13px]">או</span>
                <div className="border border-[#4C526B] rounded-[8px] h-[40px] w-[90px] flex items-center">
                  <Input
                    type="text"
                    inputMode="decimal"
                    title="הנחה באחוזים"
                    value={discountPercentage}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^\d.-]/g, '');
                      setDiscountPercentage(val);
                      const baseAmount = parseFloat(amountBeforeVat) || 0;
                      const pct = parseFloat(val) || 0;
                      if (baseAmount > 0 && pct > 0) {
                        setDiscountAmount((baseAmount * (pct / 100)).toFixed(2));
                      } else if (!val) {
                        setDiscountAmount('');
                      }
                    }}
                    placeholder="0"
                    className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[8px] border-none outline-none px-[5px]"
                  />
                  <span className="text-white/60 text-[13px] pe-[6px]">%</span>
                </div>
              </div>
            </div>
            {/* Add item button */}
            <Button
              type="button"
              variant="ghost"
              onClick={() => setLineItems(prev => [...prev, { description: '', quantity: 1, unit_price: 0, discount_amount: 0, discount_type: 'percent', total: 0 }])}
              className="w-full mt-[4px] text-[13px] text-[#00D4FF] hover:text-white hover:bg-[#29318A]/30 h-[32px] rounded-[6px] border border-dashed border-[#4C526B]/50"
            >
              + הוסף פריט
            </Button>
          </div>
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

      {/* Paid in Full Checkbox */}
      <div className="flex flex-col gap-[3px]" dir="rtl">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const newVal = !isPaid;
            setIsPaid(newVal);
            if (newVal) {
              const selectedSupplier = suppliers.find(s => s.id === supplierId);
              const defaultMethod = selectedSupplier?.default_payment_method || '';
              const defaultCardId = selectedSupplier?.default_credit_card_id || '';
              const smartDate = defaultMethod
                ? getSmartPaymentDate(defaultMethod, documentDate, defaultCardId || undefined)
                : new Date().toISOString().split('T')[0];
              setInlinePaymentDate(smartDate);
              if (defaultMethod) setInlinePaymentMethod(defaultMethod);
              const amount = totalWithVat > 0 ? totalWithVat.toString() : '';
              setInlinePaymentMethods([{
                id: 1,
                method: defaultMethod,
                amount,
                installments: '1',
                checkNumber: '',
                creditCardId: defaultCardId,
                customInstallments: amount ? generateInstallments(1, totalWithVat, smartDate) : [],
              }]);
            }
          }}
          className="flex items-center gap-[3px] min-h-[35px]"
        >
          <svg width="21" height="21" viewBox="0 0 32 32" fill="none" className="text-[#979797]">
            {isPaid ? (
              <>
                <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor" />
                <path d="M10 16L14 20L22 12" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </>
            ) : (
              <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" />
            )}
          </svg>
          <span className="text-[15px] font-medium text-white">התעודה שולמה במלואה</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          onClick={() => setIsDisputed(!isDisputed)}
          className="flex items-center gap-[3px] min-h-[35px]"
        >
          <svg width="21" height="21" viewBox="0 0 32 32" fill="none" className={isDisputed ? 'text-[#F59E0B]' : 'text-[#979797]'}>
            {isDisputed ? (
              <>
                <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor" />
                <path d="M10 16L14 20L22 12" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </>
            ) : (
              <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" />
            )}
          </svg>
          <span className="text-[15px] font-medium text-white">מסמך בבירור</span>
        </Button>

        {isDisputed && (
          <div className="flex flex-col gap-[8px] bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-[10px] p-[10px]">
            <span className="text-[13px] font-medium text-[#F59E0B] text-right">סיבת הבירור:</span>
            <div className="flex flex-wrap gap-[6px]">
              {['מחיר שגוי', 'כמות לא תואמת', 'פריט חסר', 'חשבונית כפולה', 'סחורה לא התקבלה'].map((reason) => (
                <Button
                  key={reason}
                  type="button"
                  variant="ghost"
                  onClick={() => setDisputeReason(disputeReason === reason ? '' : reason)}
                  className={`h-[32px] px-[10px] rounded-[8px] text-[12px] font-medium transition-colors ${
                    disputeReason === reason
                      ? 'bg-[#F59E0B] text-[#0F1535] border border-[#F59E0B]'
                      : 'bg-transparent text-white/60 border border-[#4C526B] hover:border-[#F59E0B]/50'
                  }`}
                >
                  {reason}
                </Button>
              ))}
            </div>
            <Textarea
              placeholder="או כתוב סיבה אחרת..."
              value={!['מחיר שגוי', 'כמות לא תואמת', 'פריט חסר', 'חשבונית כפולה', 'סחורה לא התקבלה'].includes(disputeReason) ? disputeReason : ''}
              onChange={(e) => setDisputeReason(e.target.value)}
              className="w-full h-[60px] bg-transparent text-white text-[13px] text-right border border-[#4C526B] rounded-[8px] p-2 resize-none placeholder:text-white/30"
            />
          </div>
        )}

        {/* Payment Details Section - aligned with expenses page payment section */}
        {isPaid && (
          <div className="bg-[#0F1535] rounded-[10px] p-[25px_5px_5px] mt-[15px]">
            <h3 className="text-[18px] font-semibold text-white text-center mb-[20px]">הוספת הוצאה - קליטת תשלום</h3>

            <div className="flex flex-col gap-[15px]">
              {/* Payment Methods */}
              {renderPaymentMethodsSection(inlinePaymentMethods, setInlinePaymentMethods, inlinePaymentDate, setInlinePaymentDate, supplierId, inlinePaymentReference)}

              {/* Payment Date — hidden once installments table is shown (each row has its own date there) */}
              {inlinePaymentMethods.every(pm => pm.customInstallments.length === 0) && (
                <div className="flex flex-col gap-[3px]">
                  <label className="text-[15px] font-medium text-white text-right">תאריך תשלום</label>
                  <DatePickerField
                    value={inlinePaymentDate}
                    onChange={(val) => {
                      setInlinePaymentDate(val);
                      setInlinePaymentMethods(prev => prev.map(p => {
                        const numInstallments = parseInt(p.installments) || 1;
                        const totalAmount = parseFloat(p.amount.replace(/[^\d.-]/g, '')) || 0;
                        if (numInstallments >= 1 && totalAmount > 0) {
                          return { ...p, customInstallments: generateInstallments(numInstallments, totalAmount, val) };
                        }
                        return { ...p, customInstallments: [] };
                      }));
                    }}
                  />
                </div>
              )}

              {/* Payment Reference */}
              <div className="flex flex-col gap-[3px]">
                <label className="text-[15px] font-medium text-white text-right">אסמכתא</label>
                <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
                  <Input
                    type="text"
                    placeholder="מספר אסמכתא..."
                    value={inlinePaymentReference}
                    onChange={(e) => setInlinePaymentReference(e.target.value)}
                    className="w-full h-[50px] bg-transparent text-[18px] text-white text-right focus:outline-none px-[10px] rounded-[10px]"
                  />
                </div>
              </div>

              {/* Payment Notes */}
              <div className="flex flex-col gap-[3px]">
                <label className="text-[15px] font-medium text-white text-right">הערות</label>
                <div className="border border-[#4C526B] rounded-[10px] min-h-[100px]">
                  <Textarea
                    value={inlinePaymentNotes}
                    onChange={(e) => setInlinePaymentNotes(e.target.value)}
                    placeholder="הערות..."
                    className="w-full h-[100px] bg-transparent text-[18px] text-white text-right focus:outline-none px-[10px] py-[10px] rounded-[10px] resize-none"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Render Daily Entry tab form (רישום יומי)
  const renderDailyEntryForm = () => {
    if (dailyDataLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <span className="mr-2 text-[#7B91B0]">טוען נתונים...</span>
        </div>
      );
    }

    const handleDailyPearlaChange = (field: string, value: string) => {
      setDailyPearlaData(prev => ({ ...prev, [field]: value }));
    };

    return (
      <div className="flex flex-col gap-4">
        {/* תאריך */}
        <div className="flex flex-col gap-[3px]">
          <label className="text-white text-[15px] font-medium text-right">תאריך</label>
          <DatePickerField
            value={dailyEntryDate}
            onChange={(val) => {
              setDailyEntryDate(val);
              checkDailyEntryDate(val);
            }}
            buttonClassName={dailyDateWarning ? 'border-[#FFA500]' : undefined}
          />
          {dailyDateWarning && <span className="text-[12px] text-[#FFA500] text-right mt-[3px]">{dailyDateWarning}</span>}
        </div>

        {/* יום חלקי/יום מלא */}
        <div className="flex flex-col gap-[3px]">
          <label className="text-white text-[15px] font-medium text-right">יום חלקי/יום מלא</label>
          <Input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            max="1"
            value={dailyDayFactor}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (e.target.value === '' || (val >= 0 && val <= 1)) {
                setDailyDayFactor(e.target.value);
              }
            }}
            className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
          />
        </div>

        {isPearla ? (
          <>
            {/* Pearla-specific fields */}
            <div className="flex flex-col gap-[3px]">
              <label className="text-white text-[15px] font-medium text-right">כמות מנות</label>
              <Input
                type="number"
                inputMode="decimal"
                value={dailyPearlaData.portions_count}
                onChange={(e) => handleDailyPearlaChange('portions_count', e.target.value)}
                className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
              />
            </div>

            <div className="flex flex-col gap-[3px]">
              <label className="text-white text-[15px] font-medium text-right">תוספת הגשה בש&quot;ח</label>
              <Input
                type="tel"
                inputMode="numeric"
                value={dailyPearlaData.serving_supplement}
                onChange={(e) => handleDailyPearlaChange('serving_supplement', e.target.value)}
                className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
              />
            </div>

            <div className="flex flex-col gap-[3px]">
              <label className="text-white text-[15px] font-medium text-right">סה&quot;כ הכנסות אקסטרות</label>
              <Input
                type="number"
                inputMode="decimal"
                value={dailyPearlaData.extras_income}
                onChange={(e) => handleDailyPearlaChange('extras_income', e.target.value)}
                className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
              />
            </div>

            <div className="flex flex-col gap-[3px]">
              <label className="text-white text-[15px] font-medium text-right">סה&quot;כ עלות עובדים שכירים</label>
              <Input
                type="number"
                inputMode="decimal"
                value={dailyPearlaData.salaried_labor_cost}
                onChange={(e) => handleDailyPearlaChange('salaried_labor_cost', e.target.value)}
                className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
              />
            </div>

            <div className="flex flex-col gap-[3px]">
              <label className="text-white text-[15px] font-medium text-right">סה&quot;כ עלות עובדי כ&quot;א</label>
              <Input
                type="number"
                inputMode="decimal"
                value={dailyPearlaData.manpower_labor_cost}
                onChange={(e) => handleDailyPearlaChange('manpower_labor_cost', e.target.value)}
                className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
              />
            </div>
          </>
        ) : (
          <>
            {/* Regular business fields */}
            <div className="flex flex-col gap-[3px]">
              <label className="text-white text-[15px] font-medium text-right">סה&quot;כ קופה</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={dailyTotalRegister}
                onChange={(e) => setDailyTotalRegister(e.target.value)}
                className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
              />
            </div>

            {/* מקורות הכנסה */}
            {dailyIncomeSources.length > 0 && (
              <div className="flex flex-col gap-4 mt-2">
                <div className="text-[#7B91B0] border-b border-[#4C526B] pb-2 text-right"><span className="font-medium">מקורות הכנסה</span></div>
                {dailyIncomeSources.map((source) => (
                  <div key={source.id} className="flex flex-col gap-3">
                    <div className="flex flex-col gap-[3px]">
                      <label className="text-white text-[15px] font-medium text-right">סה&quot;כ {source.name}</label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        placeholder="0"
                        value={dailyIncomeData[source.id]?.amount || ''}
                        onChange={(e) => setDailyIncomeData(prev => ({ ...prev, [source.id]: { ...prev[source.id], amount: e.target.value } }))}
                        className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
                      />
                    </div>
                    <div className="flex flex-col gap-[3px]">
                      <label className="text-white text-[15px] font-medium text-right">כמות הזמנות {source.name}</label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        placeholder="0"
                        value={dailyIncomeData[source.id]?.orders_count || ''}
                        onChange={(e) => setDailyIncomeData(prev => ({ ...prev, [source.id]: { ...prev[source.id], orders_count: e.target.value } }))}
                        className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* תקבולים */}
            {dailyReceiptTypes.length > 0 && (
              <div className="flex flex-col gap-4 mt-2">
                <div className="text-[#7B91B0] border-b border-[#4C526B] pb-2 text-right"><span className="font-medium">תקבולים</span></div>
                {dailyReceiptTypes.map((receipt) => (
                  <div key={receipt.id} className="flex flex-col gap-[3px]">
                    <label className="text-white text-[15px] font-medium text-right">{receipt.name}</label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder="0"
                      value={dailyReceiptData[receipt.id] || ''}
                      onChange={(e) => setDailyReceiptData(prev => ({ ...prev, [receipt.id]: e.target.value }))}
                      className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* פרמטרים נוספים */}
            {dailyCustomParameters.length > 0 && (
              <div className="flex flex-col gap-4 mt-2">
                <div className="text-[#7B91B0] border-b border-[#4C526B] pb-2 text-right"><span className="font-medium">פרמטרים נוספים</span></div>
                {dailyCustomParameters.map((param) => (
                  <div key={param.id} className="flex flex-col gap-[3px]">
                    <label className="text-white text-[15px] font-medium text-right">{param.name}</label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder="0"
                      value={dailyParameterData[param.id] || ''}
                      onChange={(e) => setDailyParameterData(prev => ({ ...prev, [param.id]: e.target.value }))}
                      className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* עלויות עובדים */}
            <div className="flex flex-col gap-[3px]">
              <label className="text-white text-[15px] font-medium text-right">סה&quot;כ עלות עובדים יומית</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={dailyLaborCost}
                onChange={(e) => setDailyLaborCost(e.target.value)}
                className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
              />
            </div>

            <div className="flex flex-col gap-[3px]">
              <label className="text-white text-[15px] font-medium text-right">כמות שעות עובדים</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={dailyLaborHours}
                onChange={(e) => setDailyLaborHours(e.target.value)}
                className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
              />
            </div>

            <div className="flex flex-col gap-[3px]">
              <label className="text-white text-[15px] font-medium text-right">זיכויים+ביטולים+הנחות ב-₪</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={dailyDiscounts}
                onChange={(e) => setDailyDiscounts(e.target.value)}
                className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
              />
            </div>

            {/* מוצרים מנוהלים */}
            {dailyManagedProducts.length > 0 && (
              <div className="flex flex-col gap-4 mt-2">
                <div className="text-[#7B91B0] border-b border-[#4C526B] pb-2 text-right"><span className="font-medium">מוצרים מנוהלים</span></div>
                {dailyManagedProducts.map((product) => (
                  <div key={product.id} className="border border-[#4C526B] rounded-[10px] p-4 flex flex-col gap-3">
                    <div className="text-white font-medium text-right"><span>{product.name}</span></div>
                    <div className="flex flex-col gap-[3px]">
                      <label className="text-white text-[15px] font-medium text-right">מלאי פתיחה ({product.unit})</label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        placeholder="0"
                        value={dailyProductUsage[product.id]?.opening_stock || ''}
                        onChange={(e) => setDailyProductUsage(prev => ({ ...prev, [product.id]: { ...prev[product.id], opening_stock: e.target.value } }))}
                        className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
                      />
                    </div>
                    <div className="flex flex-col gap-[3px]">
                      <label className="text-white text-[15px] font-medium text-right">כמה {product.unit} {product.name} קיבלנו היום?</label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        placeholder="0"
                        value={dailyProductUsage[product.id]?.received_quantity || ''}
                        onChange={(e) => setDailyProductUsage(prev => ({ ...prev, [product.id]: { ...prev[product.id], received_quantity: e.target.value } }))}
                        className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
                      />
                    </div>
                    <div className="flex flex-col gap-[3px]">
                      <label className="text-white text-[15px] font-medium text-right">כמה {product.unit} {product.name} נשאר?</label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        placeholder="0"
                        value={dailyProductUsage[product.id]?.closing_stock || ''}
                        onChange={(e) => setDailyProductUsage(prev => ({ ...prev, [product.id]: { ...prev[product.id], closing_stock: e.target.value } }))}
                        className="w-full h-[50px] bg-transparent border border-[#4C526B] text-white text-right rounded-[10px] px-[10px]"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // Render Payment tab form (aligned with payments page new payment form)
  const renderPaymentForm = () => (
    <div className="flex flex-col gap-[15px]">
      {/* Payment Date */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[16px] font-medium text-white text-right">תאריך קבלה</label>
        <DatePickerField
          value={paymentTabDate}
          onChange={(val) => setPaymentTabDate(val)}
        />
      </div>

      {/* Expense Type */}
      <div className="flex flex-col gap-[3px]">
        <label className="text-[16px] font-medium text-white text-right">סוג הוצאה</label>
        <div dir="rtl" className="flex items-start gap-[20px] flex-wrap">
          {([
            { key: 'all' as const, label: 'הכל' },
            { key: 'purchases' as const, label: 'קניות סחורה' },
            { key: 'expenses' as const, label: 'הוצאות שוטפות' },
            { key: 'employees' as const, label: 'עלות עובדים' },
          ]).map(({ key, label }) => (
            <Button
              key={key}
              type="button"
              variant="ghost"
              onClick={() => setPaymentTabExpenseType(key)}
              className="flex flex-row-reverse items-center gap-[3px] cursor-pointer"
            >
              <span className={`text-[16px] font-semibold ${paymentTabExpenseType === key ? 'text-white' : 'text-[#979797]'}`}>
                {label}
              </span>
              <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={paymentTabExpenseType === key ? 'text-white' : 'text-[#979797]'}>
                {paymentTabExpenseType === key ? (
                  <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor" />
                ) : (
                  <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" />
                )}
              </svg>
            </Button>
          ))}
        </div>
      </div>

      {/* Supplier */}
      {document?.ocr_data?.supplier_name && !paymentTabSupplierId && (
        <div className="bg-[#29318A]/20 border border-[#29318A]/40 rounded-[8px] px-[10px] py-[6px]">
          <span className="text-[13px] text-[#00D4FF]">זוהה מ-OCR: </span>
          <span className="text-[13px] text-white font-medium">{document.ocr_data.supplier_name}</span>
        </div>
      )}
      <SupplierSearchSelect
        suppliers={suppliers}
        value={paymentTabSupplierId}
        onChange={(id) => {
          setPaymentTabSupplierId(id);
          const sup = suppliers.find(s => s.id === id);
          // Sync the payment-tab expense type filter with the supplier's
          // own classification (same reason as the invoice tab).
          if (sup?.expense_type) {
            const mapped: 'expenses' | 'purchases' | 'employees' | null =
              sup.expense_type === 'current_expenses' ? 'expenses' :
              sup.expense_type === 'goods_purchases' ? 'purchases' :
              sup.expense_type === 'employee_costs' ? 'employees' : null;
            if (mapped) setPaymentTabExpenseType(mapped);
          }
          if (sup?.default_payment_method && paymentMethods.length > 0 && !paymentMethods[0].method) {
            const defaultMethod = sup.default_payment_method;
            const defaultCardId = sup.default_credit_card_id || '';
            const smartDate = getSmartPaymentDate(defaultMethod, paymentTabDate, defaultCardId || undefined);
            if (smartDate) setPaymentTabDate(smartDate);
            setPaymentMethods(prev => prev.map((pm, i) => i === 0 ? { ...pm, method: defaultMethod, creditCardId: defaultCardId } : pm));
          }
        }}
      />

      {/* Open invoices to link payment to — grouped by month */}
      {paymentTabSupplierId && (
        <div className="flex flex-col gap-[10px] border border-[#4C526B] rounded-[10px] p-[10px]">
          {/* Label on the right (DOM order first inside dir="rtl"),
              selection summary on the left. */}
          <div className="flex items-center justify-between">
            <label className="text-[15px] font-medium text-white">
              חשבוניות פתוחות ({paymentOpenInvoices.length})
            </label>
            <span className="text-[13px] text-white/60 ltr-num">
              {paymentSelectedInvoiceIds.size > 0 && (
                <>נבחרו {paymentSelectedInvoiceIds.size} — &#8362;{paymentSelectedInvoicesTotal.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
              )}
            </span>
          </div>

          {paymentIsLoadingInvoices ? (
            <div className="flex justify-center py-[15px]">
              <svg className="animate-spin w-5 h-5 text-white/40" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" strokeLinecap="round"/></svg>
            </div>
          ) : paymentOpenInvoices.length === 0 ? (
            <p className="text-[12px] text-white/40 text-center py-[10px]">אין חשבוניות פתוחות לספק זה</p>
          ) : (
            <div className="flex flex-col gap-[6px] max-h-[360px] overflow-y-auto">
              {groupByMonth(paymentOpenInvoices, 'invoice_date').map(([monthKey, monthInvs]) => {
                const isExpanded = paymentExpandedMonths.has(monthKey);
                const monthTotal = monthInvs.reduce((s, i) => s + i.total_amount, 0);
                const monthIds = monthInvs.filter(i => i.status !== 'clarification').map(i => i.id);
                const monthAllSelected = monthIds.length > 0 && monthIds.every(id => paymentSelectedInvoiceIds.has(id));
                const monthSomeSelected = monthIds.some(id => paymentSelectedInvoiceIds.has(id));
                return (
                  <div key={monthKey} className="flex flex-col gap-[4px]">
                    {/* Month header */}
                    <button
                      type="button"
                      onClick={() => setPaymentExpandedMonths(prev => {
                        const next = new Set(prev);
                        if (next.has(monthKey)) next.delete(monthKey); else next.add(monthKey);
                        return next;
                      })}
                      className={`flex items-center justify-between p-[8px_10px] rounded-[8px] border ${monthSomeSelected ? 'bg-[#29318A]/20 border-[#29318A]' : 'bg-[#1a1f42] border-[#4C526B]/50'} hover:border-white/30 transition-colors`}
                    >
                      <div className="flex items-center gap-[8px]">
                        <span className="text-[13px] text-white/80 font-semibold ltr-num">
                          &#8362;{monthTotal.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className="text-[11px] text-white/40">({monthInvs.length})</span>
                      </div>
                      <div className="flex items-center gap-[8px]">
                        <span className="text-[14px] text-white font-medium">{getMonthYearLabel(monthKey)}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={`text-white/60 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                          <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </button>

                    {/* Month items */}
                    {isExpanded && (
                      <div className="flex flex-col gap-[4px] pr-[6px]">
                        {monthIds.length > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setPaymentSelectedInvoiceIds(prev => {
                                const next = new Set(prev);
                                if (monthAllSelected) {
                                  monthIds.forEach(id => next.delete(id));
                                } else {
                                  monthIds.forEach(id => next.add(id));
                                }
                                return next;
                              });
                            }}
                            className="text-[12px] text-[#0075FF] hover:text-[#00D4FF] transition-colors self-start"
                          >
                            {monthAllSelected ? 'בטל הכל בחודש' : 'בחר הכל בחודש'}
                          </Button>
                        )}
                        {monthInvs.map(inv => {
                          const isSelected = paymentSelectedInvoiceIds.has(inv.id);
                          const disabled = inv.status === 'clarification';
                          return (
                            <button
                              key={inv.id}
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                if (disabled) return;
                                setPaymentSelectedInvoiceIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(inv.id)) next.delete(inv.id); else next.add(inv.id);
                                  return next;
                                });
                              }}
                              className={`flex items-center justify-between rounded-[8px] p-[10px] transition-colors ${
                                disabled
                                  ? 'bg-[#1a1f42] border border-[#F59E0B]/30 opacity-60 cursor-not-allowed'
                                  : isSelected
                                    ? 'bg-[#29318A]/40 border border-[#29318A] cursor-pointer'
                                    : 'bg-[#1a1f42] border border-transparent hover:border-white/20 cursor-pointer'
                              }`}
                            >
                              <div className="flex items-center gap-[8px]">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={isSelected ? 'text-[#3CD856]' : 'text-white/30'}>
                                  {isSelected ? (
                                    <><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" fill="currentColor"/><path d="M8 12l3 3 5-5" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></>
                                  ) : (
                                    <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2"/>
                                  )}
                                </svg>
                                <span className="text-[14px] text-white font-medium ltr-num">
                                  &#8362;{inv.total_amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                              <div className="flex flex-col items-end">
                                <span className="text-[14px] text-white">{inv.invoice_number || '(ללא מספר)'}</span>
                                <span className="text-[11px] text-white/50">
                                  {inv.invoice_date ? new Date(inv.invoice_date + 'T00:00:00').toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Payment Methods Section */}
      {renderPaymentMethodsSection(paymentMethods, setPaymentMethods, paymentTabDate, setPaymentTabDate, paymentTabSupplierId, paymentTabReference)}

      {/* Reference (upload button removed — the receipt is already attached from OCR) */}
      <div className="flex flex-col gap-[3px]">
        <label className="text-[16px] font-medium text-white text-right">אסמכתא</label>
        <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
          <Input
            type="text"
            value={paymentTabReference}
            onChange={(e) => setPaymentTabReference(e.target.value)}
            placeholder="מספר אסמכתא..."
            className="w-full h-[50px] bg-transparent text-[18px] text-white text-right focus:outline-none px-[10px] rounded-[10px]"
          />
        </div>
      </div>

      {/* Notes */}
      <div className="flex flex-col gap-[3px]">
        <label className="text-[16px] font-medium text-white text-right">הערות</label>
        <div className="border border-[#4C526B] rounded-[10px] min-h-[100px]">
          <Textarea
            value={paymentTabNotes}
            onChange={(e) => setPaymentTabNotes(e.target.value)}
            placeholder="הערות..."
            className="w-full h-[100px] bg-transparent text-[18px] text-white text-right focus:outline-none px-[10px] py-[10px] rounded-[10px] resize-none"
          />
        </div>
      </div>
    </div>
  );

  // Render Summary (מרכזת) tab - aligned with ConsolidatedInvoiceModal
  const renderSummaryForm = () => (
    <div className="flex flex-col gap-[15px]">
      {/* Coordinator Supplier Select */}
      <SupplierSearchSelect
        suppliers={coordinatorSuppliers}
        value={summarySupplierId}
        onChange={setSummarySupplierId}
        label="בחירת ספק מרכזת"
        disabled={!selectedBusinessId}
        emptyMessage={selectedBusinessId ? 'אין ספקי מרכזת' : undefined}
      />
      {selectedBusinessId && coordinatorSuppliers.length === 0 && (
        <p className="text-[12px] text-[#F64E60] text-right">
          אין ספקים מוגדרים כמרכזת. יש לסמן ספק כ&quot;מרכזת&quot; בהגדרות הספק.
        </p>
      )}

      {/* Date Field */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">תאריך מרכזת</label>
        <DatePickerField
          value={summaryDate}
          onChange={(val) => setSummaryDate(val)}
        />
      </div>

      {/* Invoice Number */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">מספר חשבונית מרכזת</label>
        <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
          <Input
            type="text"
            value={summaryInvoiceNumber}
            onChange={(e) => setSummaryInvoiceNumber(e.target.value)}
            placeholder="מספר חשבונית..."
            className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
          />
        </div>
      </div>

      {/* Total Amount */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">סכום כולל מע&quot;מ</label>
        <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
          <Input
            type="text"
            inputMode="decimal"
            value={summaryTotalAmount}
            onChange={(e) => setSummaryTotalAmount(e.target.value)}
            placeholder="0.00"
            className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
          />
        </div>
      </div>

      {/* Open Delivery Notes from DB */}
      <div className="flex flex-col gap-[10px] border border-[#4C526B] rounded-[10px] p-[10px]">
        {/* Label on the right (RTL natural), action button on the left. */}
        <div className="flex items-center justify-between">
          <label className="text-[15px] font-medium text-white">תעודות משלוח פתוחות ({openDeliveryNotes.length})</label>
          {openDeliveryNotes.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (selectedDeliveryNoteIds.size === openDeliveryNotes.length) {
                  setSelectedDeliveryNoteIds(new Set());
                } else {
                  setSelectedDeliveryNoteIds(new Set(openDeliveryNotes.map(n => n.id)));
                }
              }}
              className="text-[13px] text-[#0075FF] hover:text-[#00D4FF] transition-colors"
            >
              {selectedDeliveryNoteIds.size === openDeliveryNotes.length ? 'בטל הכל' : 'בחר הכל'}
            </Button>
          )}
        </div>

        {isLoadingDeliveryNotes ? (
          <div className="flex justify-center py-[15px]">
            <svg className="animate-spin w-5 h-5 text-white/40" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" strokeLinecap="round"/></svg>
          </div>
        ) : !summarySupplierId ? (
          <p className="text-[12px] text-white/40 text-center py-[10px]">בחר ספק כדי לראות תעודות</p>
        ) : openDeliveryNotes.length === 0 ? (
          <p className="text-[12px] text-white/40 text-center py-[10px]">אין תעודות משלוח פתוחות לספק זה</p>
        ) : (
          <div className="flex flex-col gap-[6px] max-h-[360px] overflow-y-auto">
            {groupByMonth(openDeliveryNotes, 'delivery_date').map(([monthKey, monthNotes]) => {
              const isExpanded = summaryExpandedMonths.has(monthKey);
              const monthTotal = monthNotes.reduce((sum, n) => sum + n.total_amount, 0);
              const monthIds = monthNotes.map(n => n.id);
              const monthAllSelected = monthIds.length > 0 && monthIds.every(id => selectedDeliveryNoteIds.has(id));
              const monthSomeSelected = monthIds.some(id => selectedDeliveryNoteIds.has(id));
              return (
                <div key={monthKey} className="flex flex-col gap-[4px]">
                  {/* Month header */}
                  <button
                    type="button"
                    onClick={() => setSummaryExpandedMonths(prev => {
                      const next = new Set(prev);
                      if (next.has(monthKey)) next.delete(monthKey); else next.add(monthKey);
                      return next;
                    })}
                    className={`flex items-center justify-between p-[8px_10px] rounded-[8px] border ${monthSomeSelected ? 'bg-[#29318A]/20 border-[#29318A]' : 'bg-[#1a1f42] border-[#4C526B]/50'} hover:border-white/30 transition-colors`}
                  >
                    <div className="flex items-center gap-[8px]">
                      <span className="text-[13px] text-white/80 font-semibold ltr-num">
                        &#8362;{monthTotal.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span className="text-[11px] text-white/40">({monthNotes.length})</span>
                    </div>
                    <div className="flex items-center gap-[8px]">
                      <span className="text-[14px] text-white font-medium">{getMonthYearLabel(monthKey)}</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={`text-white/60 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                        <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </button>

                  {/* Month items */}
                  {isExpanded && (
                    <div className="flex flex-col gap-[4px] pr-[6px]">
                      {/* Select all within month */}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setSelectedDeliveryNoteIds(prev => {
                            const next = new Set(prev);
                            if (monthAllSelected) {
                              monthIds.forEach(id => next.delete(id));
                            } else {
                              monthIds.forEach(id => next.add(id));
                            }
                            return next;
                          });
                        }}
                        className="text-[12px] text-[#0075FF] hover:text-[#00D4FF] transition-colors self-start"
                      >
                        {monthAllSelected ? 'בטל הכל בחודש' : 'בחר הכל בחודש'}
                      </Button>
                      {monthNotes.map(note => {
                        const isSelected = selectedDeliveryNoteIds.has(note.id);
                        return (
                          <button
                            key={note.id}
                            type="button"
                            onClick={() => {
                              setSelectedDeliveryNoteIds(prev => {
                                const next = new Set(prev);
                                if (next.has(note.id)) next.delete(note.id); else next.add(note.id);
                                return next;
                              });
                            }}
                            className={`flex items-center justify-between rounded-[8px] p-[10px] transition-colors cursor-pointer ${isSelected ? 'bg-[#29318A]/40 border border-[#29318A]' : 'bg-[#1a1f42] border border-transparent hover:border-white/20'}`}
                          >
                            <div className="flex items-center gap-[8px]">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={isSelected ? 'text-[#3CD856]' : 'text-white/30'}>
                                {isSelected ? (
                                  <><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" fill="currentColor"/><path d="M8 12l3 3 5-5" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></>
                                ) : (
                                  <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2"/>
                                )}
                              </svg>
                              <span className="text-[14px] text-white font-medium ltr-num">
                                &#8362;{note.total_amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-[14px] text-white">{note.delivery_note_number}</span>
                              <span className="text-[11px] text-white/50">
                                {note.delivery_date ? new Date(note.delivery_date + 'T00:00:00').toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {selectedDeliveryNoteIds.size > 0 && (
          <div className="flex items-center justify-between bg-[#29318A]/20 rounded-[7px] p-[8px] border border-[#29318A]">
            <span className="text-[14px] text-white font-bold ltr-num">
              ₪{selectedDeliveryNotesTotal.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[13px] text-white/70">
              {selectedDeliveryNoteIds.size} תעודות נבחרו
            </span>
          </div>
        )}
      </div>

      {/* Manual Delivery Notes (legacy) */}
      <div className="flex flex-col gap-[10px] border border-[#4C526B] rounded-[10px] p-[10px]" style={{ display: openDeliveryNotes.length > 0 ? 'none' : undefined }}>
        {/* Label on the right, action button on the left (RTL natural). */}
        <div className="flex items-center justify-between">
          <label className="text-[15px] font-medium text-white">תעודות משלוח</label>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowAddDeliveryNote(!showAddDeliveryNote)}
            className="text-[14px] text-[#0075FF] hover:text-[#00D4FF] transition-colors"
          >
            + הוספת תעודה
          </Button>
        </div>

        {/* Add Delivery Note Form */}
        {showAddDeliveryNote && (
          <div className="flex flex-col gap-[10px] bg-[#1a1f42] rounded-[8px] p-[10px]">
            <div className="grid grid-cols-2 gap-[10px]">
              <div className="flex flex-col gap-[3px]">
                <label className="text-[12px] text-white/60 text-right">מספר תעודה</label>
                <Input
                  type="text"
                  value={newDeliveryNote.delivery_note_number}
                  onChange={(e) => setNewDeliveryNote(prev => ({ ...prev, delivery_note_number: e.target.value }))}
                  placeholder="מספר..."
                  className="h-[40px] bg-[#0F1535] border border-[#4C526B] rounded-[8px] text-white text-[14px] text-center px-[8px] placeholder:text-white/30"
                />
              </div>
              <div className="flex flex-col gap-[3px]">
                <label className="text-[12px] text-white/60 text-right">תאריך</label>
                <DatePickerField
                  value={newDeliveryNote.delivery_date}
                  onChange={(val) => setNewDeliveryNote(prev => ({ ...prev, delivery_date: val }))}
                  className="h-[40px] rounded-[8px] text-[14px]"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-[10px]">
              <div className="flex flex-col gap-[3px]">
                <label className="text-[12px] text-white/60 text-right">סכום כולל</label>
                <Input
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
                <Input
                  type="text"
                  value={newDeliveryNote.notes}
                  onChange={(e) => setNewDeliveryNote(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="הערה..."
                  className="h-[40px] bg-[#0F1535] border border-[#4C526B] rounded-[8px] text-white text-[14px] text-center px-[8px] placeholder:text-white/30"
                />
              </div>
            </div>
            <div className="flex gap-[10px]">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddDeliveryNote(false)}
                className="flex-1 h-[36px] border border-white/30 rounded-[8px] text-white/60 text-[14px] hover:bg-white/5"
              >
                ביטול
              </Button>
              <Button
                type="button"
                onClick={handleAddDeliveryNote}
                className="flex-1 h-[36px] bg-[#3CD856] rounded-[8px] text-white text-[14px] font-medium hover:bg-[#34c04c]"
              >
                הוסף
              </Button>
            </div>
          </div>
        )}

        {/* Delivery Notes List */}
        {summaryDeliveryNotes.length > 0 && (
          <div className="flex flex-col gap-[8px]">
            {summaryDeliveryNotes.map((note, index) => (
              <div
                key={`dn-${note.delivery_note_number}-${note.delivery_date}`}
                className="flex items-center justify-between bg-[#1a1f42] rounded-[8px] p-[10px]"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveDeliveryNote(index)}
                  className="text-[#F64E60] text-[18px] font-bold hover:opacity-80"
                >
                  &times;
                </Button>
                <div className="flex flex-col items-end flex-1 mr-[10px]">
                  <div className="flex items-center gap-[10px]">
                    <span className="text-[14px] text-white font-medium">
                      &#8362;{formatNumber(parseFloat(note.total_amount))}
                    </span>
                    <span className="text-[14px] text-white">{note.delivery_note_number}</span>
                  </div>
                  <span className="text-[12px] text-white/50">
                    {note.delivery_date ? new Date(note.delivery_date).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''}
                  </span>
                </div>
              </div>
            ))}

            {/* Total of delivery notes */}
            <div className="flex items-center justify-between pt-[8px] border-t border-white/10">
              <span className={`text-[14px] font-bold ${summaryTotalsMatch ? 'text-[#3CD856]' : 'text-[#F64E60]'}`}>
                &#8362;{formatNumber(summaryDeliveryNotesTotal)}
              </span>
              <span className="text-[14px] text-white/60">סה&quot;כ תעודות:</span>
            </div>
            {!summaryTotalsMatch && summaryTotalAmount && (
              <p className="text-[12px] text-[#F64E60] text-right">
                הפרש: &#8362;{formatNumber(Math.abs((parseFloat(summaryTotalAmount) || 0) - summaryDeliveryNotesTotal))}
              </p>
            )}
          </div>
        )}

        {summaryDeliveryNotes.length === 0 && !showAddDeliveryNote && (
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
        <Select
          value={summaryIsClosed || "__none__"}
          onValueChange={(val) => setSummaryIsClosed(val === "__none__" ? "" : val)}
        >
          <SelectTrigger className="w-full h-[48px] bg-[#0F1535] text-[16px] text-center rounded-[10px] border-[#4C526B]">
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
        <label className="text-[15px] font-medium text-white text-right">הערות</label>
        <div className="border border-[#4C526B] rounded-[10px]">
          <Textarea
            value={summaryNotes}
            onChange={(e) => setSummaryNotes(e.target.value)}
            placeholder="הערות..."
            rows={3}
            className="w-full min-h-[80px] bg-transparent text-white text-[16px] text-right rounded-[10px] border-none outline-none p-[10px] placeholder:text-white/30 resize-none"
          />
        </div>
      </div>
    </div>
  );

  if (!document) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/60 px-6">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
        <p className="mt-4 text-lg">בחר מסמך לעריכה</p>
        <p className="mt-1 text-sm">בחר מסמך מהתור בתחתית המסך</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0F1535] rounded-[10px] overflow-hidden">
      <ConfirmDialog />
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0F1535] border-b border-[#4C526B]">
        <h2 className="text-[18px] font-bold text-white">פרטי מסמך</h2>
      </div>

      {/* Rejection reason banner for archived documents */}
      {document.status === 'archived' && document.rejection_reason && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-[#EB5757]/15 border-b border-[#EB5757]/30" dir="rtl">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EB5757" strokeWidth="2" className="shrink-0">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span className="text-[13px] text-[#EB5757] font-medium">סיבת דחיה: {document.rejection_reason}</span>
        </div>
      )}

      {/* OCR failed / no business warning */}
      {document && !document.business_id && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-[#FFA412]/15 border-b border-[#FFA412]/30" dir="rtl">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFA412" strokeWidth="2" className="shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span className="text-[13px] text-[#FFA412] font-medium">לא זוהה עסק אוטומטית — בחר עסק ידנית</span>
        </div>
      )}

      {/* Business Selector */}
      <div className="px-4 py-2 bg-[#0F1535] border-b border-[#4C526B]" dir="rtl">
        <Select
          value={selectedBusinessId || "__none__"}
          onValueChange={(val) => onBusinessChange(val === "__none__" ? "" : val)}
        >
          <SelectTrigger className="w-full h-[42px] bg-[#0F1535] text-white text-[15px] text-center rounded-[10px] border-[#4C526B] font-medium">
            <SelectValue placeholder="בחר/י עסק..." />
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

      {/* Document Type Tabs */}
      <div className="flex border-b border-[#4C526B]" dir="rtl">
        {DOCUMENT_TABS.map((tab) => (
          <Button
            key={tab.value}
            type="button"
            variant="ghost"
            onClick={() => setDocumentType(tab.value)}
            className={`flex-1 py-[12px] text-[12px] font-medium transition-colors ${
              documentType === tab.value
                ? 'text-white border-b-2 border-[#29318A] bg-[#29318A]/10'
                : 'text-white/50 border-b-2 border-transparent hover:text-white/70'
            }`}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Merge documents section */}
      {document && onMergeDocuments && (
        <div className="px-4 py-2 border-b border-[#4C526B]" dir="rtl">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              onClick={() => {
                setMergeSelectedIds(new Set());
                setShowMergePicker(true);
              }}
              className="bg-[#29318A]/30 hover:bg-[#29318A]/50 text-white text-[12px] font-medium px-3 py-1.5 rounded-[7px] transition-colors h-auto"
            >
              + צרף עמודים נוספים
            </Button>
            {mergedDocuments.map((md) => {
              const isPdf = md.file_type === 'pdf' || md.image_url?.toLowerCase().endsWith('.pdf');
              const totalAmount = md.ocr_data?.total_amount;
              return (
                <span
                  key={md.id}
                  className="inline-flex items-center gap-1.5 bg-[#29318A]/20 border border-[#29318A]/40 text-white text-[11px] px-2 py-1 rounded-[6px]"
                >
                  {/* Click on the chip body opens a preview of the merged doc.
                      Critical for the user to verify what's actually attached
                      — earlier the chip showed only a filename and the file
                      contents were unreachable from the form. */}
                  <button
                    type="button"
                    onClick={() => {
                      if (isPdf && md.image_url) {
                        window.open(md.image_url, '_blank', 'noopener,noreferrer');
                      } else if (md.image_url) {
                        setMergePreviewUrl(md.image_url);
                      }
                    }}
                    className="flex items-center gap-1.5 hover:text-[#bc76ff] transition-colors"
                    title={isPdf ? "פתח PDF" : "צפה בתמונה"}
                  >
                    {/* Tiny thumbnail (image only — PDFs show an icon) */}
                    {isPdf ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    ) : md.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={md.image_url} alt="" className="w-[20px] h-[20px] object-cover rounded-[3px] border border-white/20" />
                    ) : null}
                    <span className="truncate max-w-[120px]">
                      {md.ocr_data?.supplier_name || md.original_filename || md.source_sender_name || md.id.slice(0, 8)}
                    </span>
                    {totalAmount != null && totalAmount > 0 && (
                      <span className="text-[#17DB4E] text-[10px] font-semibold ltr-num" dir="ltr">
                        ₪{totalAmount.toLocaleString('he-IL')}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onMergeDocuments(mergedDocuments.filter(d => d.id !== md.id))}
                    className="text-white/50 hover:text-white pr-0.5 border-r border-white/10"
                    title="הסר מצירוף"
                  >
                    <X size={12} />
                  </button>
                </span>
              );
            })}
          </div>
          {/* Sum totals from merged docs — shown only when there's data and the
              user might want to combine. We deliberately DON'T auto-merge into
              amountBeforeVat to avoid confusion when the user attached pages
              of the SAME invoice (e.g. a multi-page scan) — adding them would
              double-count. The button gives the user explicit control. */}
          {mergedDocuments.some(md => md.ocr_data?.subtotal != null && md.ocr_data.subtotal !== 0) && (() => {
            const sumSubtotal = mergedDocuments.reduce((s, md) => s + (Number(md.ocr_data?.subtotal) || 0), 0);
            const currentSubtotal = parseFloat(amountBeforeVat) || 0;
            const combined = currentSubtotal + sumSubtotal;
            if (sumSubtotal === 0) return null;
            return (
              <div className="mt-2 flex items-center justify-between gap-2 bg-[#bc76ff]/10 border border-[#bc76ff]/30 rounded-[7px] px-3 py-2">
                <div className="flex flex-col text-right text-[11px] text-white/80 flex-1 min-w-0">
                  <span>
                    סכום במסמכים המצורפים: <span className="text-[#17DB4E] font-semibold ltr-num" dir="ltr">₪{sumSubtotal.toLocaleString('he-IL', { maximumFractionDigits: 2 })}</span>
                  </span>
                  <span className="text-white/40 text-[10px]">
                    אם זו אותה חשבונית בכמה עמודים — אל תוסיף. אם אלה חשבוניות שונות שאתה מאחד — לחץ &quot;חבר סכומים&quot;.
                  </span>
                </div>
                <Button
                  type="button"
                  onClick={() => setAmountBeforeVat(String(combined.toFixed(2)))}
                  className="bg-[#bc76ff]/30 hover:bg-[#bc76ff]/50 text-white text-[11px] font-medium px-3 py-1 rounded-[6px] transition-colors h-auto whitespace-nowrap"
                >
                  חבר סכומים
                </Button>
              </div>
            );
          })()}
        </div>
      )}

      {/* Merge picker Sheet */}
      <Sheet open={showMergePicker} onOpenChange={setShowMergePicker}>
        <SheetContent side="right" className="w-full sm:max-w-full bg-[#0F1535] border-l border-[#4C526B] p-0 flex flex-col">
          <SheetHeader className="px-4 py-3 border-b border-[#4C526B]">
            <SheetTitle className="text-white text-[15px] text-right">בחר מסמכים לצירוף</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 content-start" dir="rtl">
            {pendingDocuments.filter(d => d.id !== document?.id && !mergedDocuments.some(m => m.id === d.id)).length === 0 ? (
              <p className="text-white/50 text-[13px] text-center py-8">אין מסמכים ממתינים נוספים</p>
            ) : (
              pendingDocuments
                .filter(d => d.id !== document?.id && !mergedDocuments.some(m => m.id === d.id))
                .map((pd) => (
                  <label
                    key={pd.id}
                    className={`flex flex-col gap-2 p-2 rounded-[8px] cursor-pointer transition-colors ${
                      mergeSelectedIds.has(pd.id) ? 'bg-[#29318A]/30 border border-[#29318A]' : 'bg-[#1A1F3D] border border-[#4C526B]/50 hover:border-[#4C526B]'
                    }`}
                  >
                    {/* Top: checkbox + meta */}
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={mergeSelectedIds.has(pd.id)}
                        onChange={() => {
                          setMergeSelectedIds(prev => {
                            const next = new Set(prev);
                            if (next.has(pd.id)) next.delete(pd.id);
                            else next.add(pd.id);
                            return next;
                          });
                        }}
                        className="w-4 h-4 rounded accent-[#29318A] shrink-0 mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-[13px] truncate font-medium">
                          {pd.ocr_data?.supplier_name || pd.source_sender_name || pd.original_filename || 'מסמך'}
                        </p>
                        {pd.ocr_data?.total_amount != null && pd.ocr_data.total_amount > 0 && (
                          <p className="text-[#17DB4E] text-[12px] font-semibold ltr-num" dir="ltr">
                            ₪{pd.ocr_data.total_amount.toLocaleString('he-IL')}
                          </p>
                        )}
                        <p className="text-white/40 text-[10px]">
                          {new Date(pd.created_at).toLocaleDateString('he-IL')}
                          {pd.ocr_data?.document_number ? ` · ${pd.ocr_data.document_number}` : ''}
                        </p>
                      </div>
                    </div>

                    {/* Big preview */}
                    <div className="relative w-full h-[180px] rounded-[6px] overflow-hidden bg-[#0a0d1f] flex items-center justify-center group">
                      {pd.file_type === 'pdf' || pd.image_url?.toLowerCase().endsWith('.pdf') ? (
                        <a
                          href={pd.image_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex flex-col items-center gap-2 hover:opacity-80 transition-opacity"
                        >
                          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          <span className="text-[12px] text-indigo-400 font-bold">פתח PDF</span>
                        </a>
                      ) : (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={pd.image_url} alt="" className="w-full h-full object-contain" />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (pd.image_url) setMergePreviewUrl(pd.image_url);
                            }}
                            className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors"
                            title="הגדל"
                            aria-label="הגדל תמונה"
                          >
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-[#29318A] text-white text-[12px] font-medium px-3 py-1.5 rounded-[6px] flex items-center gap-1.5">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
                              הגדל
                            </span>
                          </button>
                        </>
                      )}
                    </div>
                  </label>
                ))
            )}
          </div>
          <div className="px-4 py-3 border-t border-[#4C526B]">
            <Button
              type="button"
              disabled={mergeSelectedIds.size === 0}
              onClick={() => {
                const selected = pendingDocuments.filter(d => mergeSelectedIds.has(d.id));
                onMergeDocuments?.([...mergedDocuments, ...selected]);
                setShowMergePicker(false);
              }}
              className="w-full h-[40px] bg-[#29318A] hover:bg-[#3D44A0] text-white text-[14px] font-medium rounded-[8px] transition-colors disabled:opacity-40"
            >
              צרף {mergeSelectedIds.size > 0 ? `(${mergeSelectedIds.size})` : ''}
            </Button>
          </div>

        </SheetContent>
      </Sheet>

      {/* Full-screen image preview overlay — kept outside the Sheet so the
          merged-doc chips in the form header can also open it (otherwise
          closing the Sheet would unmount the overlay). z-[200] beats the
          Sheet's z-index so it stacks on top whether the Sheet is open
          or not. */}
      {mergePreviewUrl && (
        <div
          role="dialog"
          aria-label="תצוגה מוגדלת"
          onClick={() => setMergePreviewUrl(null)}
          className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMergePreviewUrl(null); }}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            aria-label="סגור"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mergePreviewUrl}
            alt="תצוגה מוגדלת"
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full object-contain rounded-[8px] cursor-default"
          />
        </div>
      )}

      {/* Duplicate warning banner */}
      {duplicateWarning && (
        <div className="mx-4 mt-2 p-3 bg-[#F59E0B]/15 border border-[#F59E0B]/40 rounded-[8px] text-[#F59E0B] text-[13px] font-medium text-right" dir="rtl">
          {duplicateWarning}
        </div>
      )}

      {/* Form content - scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-4" dir="rtl">
        {(documentType === 'invoice' || documentType === 'credit_note') && renderInvoiceForm()}
        {documentType === 'payment' && renderPaymentForm()}
        {documentType === 'summary' && renderSummaryForm()}
        {documentType === 'daily_entry' && renderDailyEntryForm()}
      </div>

      {/* Calculator popup — draggable */}
      {showCalculator && (
        <div
          data-calc-popup
          className="z-50 bg-[#1A1F3D] border border-[#4C526B] rounded-[12px] shadow-2xl p-3 w-[240px]"
          dir="rtl"
          style={calcPos ? { position: 'fixed', left: calcPos.x, top: calcPos.y } : { position: 'fixed', top: 60, left: 16 }}
        >
          <div
            className="flex items-center justify-between mb-2 cursor-grab active:cursor-grabbing select-none"
            dir="ltr"
            onMouseDown={handleCalcDragStart}
            onTouchStart={handleCalcDragStart}
          >
            <span className="text-white/60 text-[12px]">מחשבון ⠿</span>
            <button onClick={() => { onCalculatorToggle?.(); setCalcPos(null); }} className="text-white/40 hover:text-white">
              <X size={14} />
            </button>
          </div>
          <div className="bg-[#0F1535] rounded-[8px] p-2 mb-2" dir="ltr">
            <div className="text-white/40 text-[11px] h-[16px] overflow-hidden text-right">{calcExpression || '\u00A0'}</div>
            <div className="text-white text-[22px] font-mono font-semibold text-right">{calcDisplay}</div>
          </div>
          <div className="grid grid-cols-4 gap-1" dir="ltr">
            {['C', '⌫', '/', '*',
              '7', '8', '9', '-',
              '4', '5', '6', '+',
              '1', '2', '3', '=',
              '0', '.', '', ''].map((btn, i) => btn ? (
              <button
                key={i}
                onClick={() => calcInput(btn)}
                className={`h-[38px] rounded-[6px] text-[16px] font-medium transition-colors ${
                  btn === '=' ? 'bg-[#22c55e] text-white row-span-1 hover:bg-[#16a34a]'
                  : ['C', '⌫'].includes(btn) ? 'bg-[#EB5757]/20 text-[#EB5757] hover:bg-[#EB5757]/30'
                  : ['+', '-', '*', '/'].includes(btn) ? 'bg-[#29318A] text-white hover:bg-[#3D44A0]'
                  : 'bg-[#4C526B]/30 text-white hover:bg-[#4C526B]/50'
                }`}
              >
                {btn}
              </button>
            ) : <div key={i} />)}
          </div>
        </div>
      )}

      {/* Action buttons - fixed at bottom, single row */}
      <div className="px-4 py-3 bg-[#0F1535] border-t border-[#4C526B]">
        <div className="flex gap-2 items-center">
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isLoading || (documentType === 'summary' && (!selectedBusinessId || !summarySupplierId || !summaryInvoiceNumber || !summaryTotalAmount || !summaryIsClosed)) || (documentType === 'daily_entry' && (!selectedBusinessId || !dailyEntryDate))}
            className={`flex-1 h-[44px] text-white text-[15px] font-semibold rounded-[10px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              documentType === 'summary' || documentType === 'daily_entry'
                ? 'bg-gradient-to-r from-[#0075FF] to-[#00D4FF]'
                : 'bg-[#22c55e] hover:bg-[#16a34a]'
            }`}
          >
            {isLoading ? 'שומר...' : documentType === 'summary' || documentType === 'daily_entry' ? 'שמירה' : 'אישור וקליטה'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowRejectModal(true)}
            disabled={isLoading}
            className="h-[44px] px-3 bg-[#EB5757]/20 hover:bg-[#EB5757]/30 text-[#EB5757] text-[14px] font-semibold rounded-[10px] transition-colors disabled:opacity-50 flex-shrink-0"
          >
            דחייה
          </Button>
          {onSkip && (
            <Button
              type="button"
              variant="ghost"
              onClick={onSkip}
              disabled={isLoading}
              className="h-[44px] px-3 bg-[#4C526B]/30 hover:bg-[#4C526B]/50 text-white/70 text-[14px] font-semibold rounded-[10px] transition-colors disabled:opacity-50 flex-shrink-0"
            >
              דלג
            </Button>
          )}
          {onDelete && document && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                confirm('האם אתה בטוח שברצונך למחוק את המסמך לצמיתות?', () => {
                  onDelete(document.id);
                });
              }}
              disabled={isLoading}
              className="h-[44px] w-[44px] bg-transparent hover:bg-[#EB5757]/10 text-[#EB5757]/40 hover:text-[#EB5757] rounded-[10px] transition-colors disabled:opacity-50 flex-shrink-0 p-0"
              title="מחק מסמך"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </Button>
          )}
        </div>
      </div>

      {/* Reject Modal */}
      <Sheet open={showRejectModal} onOpenChange={(open) => !open && setShowRejectModal(false)}>
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
                onClick={() => setShowRejectModal(false)}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </Button>
              <SheetTitle className="text-white text-xl font-bold">דחיית מסמך</SheetTitle>
              <div className="w-[24px]" />
            </div>
          </SheetHeader>
          <div className="flex flex-col gap-3 p-4" dir="rtl">
            {['מסמך לא קריא', 'מסמך כפול', 'לא מסמך עסקי', 'אחר'].map((reason) => (
              <Button
                key={reason}
                type="button"
                variant="ghost"
                onClick={() => setRejectReason(reason)}
                className={`h-[44px] rounded-[10px] text-[14px] font-medium transition-colors ${
                  rejectReason === reason
                    ? 'bg-[#29318A] text-white border border-[#29318A]'
                    : 'bg-transparent text-white/60 border border-[#4C526B] hover:border-[#29318A]/50'
                }`}
              >
                {reason}
              </Button>
            ))}
            {rejectReason === 'אחר' && (
              <div>
                <Textarea
                  placeholder="פרט את סיבת הדחייה..."
                  value={rejectCustomText}
                  onChange={(e) => setRejectCustomText(e.target.value)}
                  className="w-full h-[80px] bg-transparent text-white text-[14px] text-right border border-[#4C526B] rounded-[10px] p-3 resize-none"
                />
              </div>
            )}
            <div className="flex gap-3 mt-2">
              <Button
                type="button"
                onClick={handleReject}
                className="flex-1 h-[44px] bg-[#EB5757] hover:bg-[#d64545] text-white text-[14px] font-semibold rounded-[10px] transition-colors"
              >
                דחה מסמך
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowRejectModal(false)}
                className="flex-1 h-[44px] bg-[#4C526B]/30 hover:bg-[#4C526B]/50 text-white/70 text-[14px] font-semibold rounded-[10px] transition-colors"
              >
                ביטול
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
