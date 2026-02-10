'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import type { OCRDocument, OCRFormData, DocumentType, ExpenseType } from '@/types/ocr';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useFormDraft } from '@/hooks/useFormDraft';

interface Supplier {
  id: string;
  name: string;
}

interface Business {
  id: string;
  name: string;
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
}

// Tabs for document type selection
const DOCUMENT_TABS: { value: DocumentType; label: string }[] = [
  { value: 'invoice', label: 'חשבונית' },
  { value: 'payment', label: 'תשלום' },
  { value: 'delivery_note', label: 'תעודת משלוח' },
  { value: 'summary', label: 'מרכזת' },
];

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'העברה בנקאית' },
  { value: 'cash', label: 'מזומן' },
  { value: 'check', label: "צ'ק" },
  { value: 'bit', label: 'ביט' },
  { value: 'paybox', label: 'פייבוקס' },
  { value: 'credit_card', label: 'כרטיס אשראי' },
  { value: 'credit_companies', label: 'חברות הקפה' },
  { value: 'standing_order', label: 'הוראת קבע' },
  { value: 'other', label: 'אחר' },
];

const VAT_RATE = 0.17;

// Payment method entry for multiple payment methods support
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
}: OCRFormProps) {
  // Draft persistence
  const draftKey = `ocrForm:draft:${selectedBusinessId}:${document?.id || 'none'}`;
  const { saveDraft, restoreDraft, clearDraft } = useFormDraft(draftKey);
  const draftRestored = useRef(false);

  // Form state
  const [documentType, setDocumentType] = useState<DocumentType>('invoice');
  const [expenseType, setExpenseType] = useState<ExpenseType>('goods');
  const [supplierId, setSupplierId] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [amountBeforeVat, setAmountBeforeVat] = useState('');
  const [vatAmount, setVatAmount] = useState('');
  const [partialVat, setPartialVat] = useState(false);
  const [notes, setNotes] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Payment fields for invoice tab (when isPaid is checked) - single payment method
  const [inlinePaymentMethod, setInlinePaymentMethod] = useState('');
  const [inlinePaymentDate, setInlinePaymentDate] = useState('');
  const [inlinePaymentReference, setInlinePaymentReference] = useState('');
  const [inlinePaymentNotes, setInlinePaymentNotes] = useState('');

  // Payment tab - multiple payment methods (aligned with payments page)
  const [paymentTabDate, setPaymentTabDate] = useState('');
  const [paymentTabExpenseType, setPaymentTabExpenseType] = useState<'expenses' | 'purchases'>('expenses');
  const [paymentTabSupplierId, setPaymentTabSupplierId] = useState('');
  const [paymentTabReference, setPaymentTabReference] = useState('');
  const [paymentTabNotes, setPaymentTabNotes] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodEntry[]>([
    { id: 1, method: '', amount: '', installments: '1', customInstallments: [] },
  ]);

  // Inline payment methods for invoice "paid in full" section
  const [inlinePaymentMethods, setInlinePaymentMethods] = useState<PaymentMethodEntry[]>([
    { id: 1, method: '', amount: '', installments: '1', customInstallments: [] },
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

  // Calculate VAT and total (for invoice/delivery_note tabs)
  const calculatedVat = useMemo(() => {
    const amount = parseFloat(amountBeforeVat) || 0;
    return amount * VAT_RATE;
  }, [amountBeforeVat]);

  const totalWithVat = useMemo(() => {
    const amount = parseFloat(amountBeforeVat) || 0;
    const vat = partialVat ? (parseFloat(vatAmount) || 0) : calculatedVat;
    return amount + vat;
  }, [amountBeforeVat, vatAmount, partialVat, calculatedVat]);

  // Generate installments breakdown
  const generateInstallments = (numInstallments: number, totalAmount: number, startDateStr: string) => {
    if (numInstallments <= 1 || totalAmount === 0) return [];
    const installmentAmount = totalAmount / numInstallments;
    const startDate = startDateStr ? new Date(startDateStr) : new Date();
    const result = [];
    for (let i = 0; i < numInstallments; i++) {
      const date = new Date(startDate);
      date.setMonth(date.getMonth() + i);
      result.push({
        number: i + 1,
        date: date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }),
        dateForInput: date.toISOString().split('T')[0],
        amount: installmentAmount,
      });
    }
    return result;
  };

  // Payment methods helpers (shared for both payment tab and inline payment)
  const addPaymentMethodEntry = (setter: React.Dispatch<React.SetStateAction<PaymentMethodEntry[]>>, methods: PaymentMethodEntry[]) => {
    const newId = Math.max(...methods.map(p => p.id)) + 1;
    setter(prev => [...prev, { id: newId, method: '', amount: '', installments: '1', customInstallments: [] }]);
  };

  const removePaymentMethodEntry = (setter: React.Dispatch<React.SetStateAction<PaymentMethodEntry[]>>, methods: PaymentMethodEntry[], id: number) => {
    if (methods.length > 1) {
      setter(prev => prev.filter(p => p.id !== id));
    }
  };

  const updatePaymentMethodField = (setter: React.Dispatch<React.SetStateAction<PaymentMethodEntry[]>>, id: number, field: keyof PaymentMethodEntry, value: string, dateStr: string) => {
    setter(prev => prev.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, [field]: value };
      if (field === 'amount' || field === 'installments') {
        const numInstallments = parseInt(field === 'installments' ? value : p.installments) || 1;
        const totalAmount = parseFloat((field === 'amount' ? value : p.amount).replace(/[^\d.]/g, '')) || 0;
        updated.customInstallments = generateInstallments(numInstallments, totalAmount, dateStr);
      }
      return updated;
    }));
  };

  const handleInstallmentDateChange = (setter: React.Dispatch<React.SetStateAction<PaymentMethodEntry[]>>, paymentMethodId: number, installmentIndex: number, newDate: string) => {
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
  };

  const handleInstallmentAmountChange = (setter: React.Dispatch<React.SetStateAction<PaymentMethodEntry[]>>, paymentMethodId: number, installmentIndex: number, newAmount: string) => {
    const amount = parseFloat(newAmount.replace(/[^\d.]/g, '')) || 0;
    setter(prev => prev.map(p => {
      if (p.id !== paymentMethodId) return p;
      const updatedInstallments = [...p.customInstallments];
      if (updatedInstallments[installmentIndex]) {
        updatedInstallments[installmentIndex] = { ...updatedInstallments[installmentIndex], amount };
      }
      return { ...p, customInstallments: updatedInstallments };
    }));
  };

  const getInstallmentsTotal = (customInstallments: PaymentMethodEntry['customInstallments']) => {
    return customInstallments.reduce((sum, item) => sum + item.amount, 0);
  };

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
      amountBeforeVat, vatAmount, partialVat, notes, isPaid,
      inlinePaymentMethod, inlinePaymentDate, inlinePaymentReference, inlinePaymentNotes,
      inlinePaymentMethods,
      paymentTabDate, paymentTabExpenseType, paymentTabSupplierId, paymentTabReference, paymentTabNotes,
      paymentMethods,
      summarySupplierId, summaryDate, summaryInvoiceNumber, summaryTotalAmount, summaryIsClosed, summaryNotes,
      summaryDeliveryNotes,
    });
  }, [saveDraft, documentType, expenseType, supplierId, documentDate, documentNumber,
    amountBeforeVat, vatAmount, partialVat, notes, isPaid,
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
    if (document?.ocr_data) {
      const data = document.ocr_data;

      if (document.document_type) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDocumentType(document.document_type);
      }
      if (document.expense_type) {
        setExpenseType(document.expense_type);
      }
      const docDate = data.document_date || new Date().toISOString().split('T')[0];
      setDocumentDate(docDate);
      setPaymentTabDate(docDate);

      if (data.document_number) {
        setDocumentNumber(data.document_number);
      }
      if (data.subtotal !== undefined) {
        setAmountBeforeVat(data.subtotal.toString());
      }
      if (data.vat_amount !== undefined) {
        setVatAmount(data.vat_amount.toString());
        const expectedVat = (data.subtotal || 0) * VAT_RATE;
        if (Math.abs((data.vat_amount || 0) - expectedVat) > 0.01) {
          setPartialVat(true);
        }
      }

      // Pre-select supplier: prefer matched_supplier_id from AI, fallback to name matching
      let matchedId = '';
      if (data.matched_supplier_id && suppliers.some(s => s.id === data.matched_supplier_id)) {
        matchedId = data.matched_supplier_id;
      } else if (data.supplier_name && suppliers.length > 0) {
        const matchedSupplier = suppliers.find(
          (s) => s.name.includes(data.supplier_name!) || data.supplier_name!.includes(s.name)
        );
        if (matchedSupplier) {
          matchedId = matchedSupplier.id;
        }
      }
      setSupplierId(matchedId);
      setPaymentTabSupplierId(matchedId);
      setSummarySupplierId(matchedId);

      // Reset payment fields
      setIsPaid(false);
      setInlinePaymentMethod('');
      setInlinePaymentDate('');
      setInlinePaymentReference('');
      setInlinePaymentNotes('');

      // For payment tab, pre-fill the amount from OCR total
      const totalStr = data.total_amount?.toString() || '';
      setPaymentMethods([{ id: 1, method: '', amount: totalStr, installments: '1', customInstallments: [] }]);
      setInlinePaymentMethods([{ id: 1, method: '', amount: '', installments: '1', customInstallments: [] }]);
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
      setInlinePaymentMethod('');
      setInlinePaymentDate('');
      setInlinePaymentReference('');
      setInlinePaymentNotes('');
      setInlinePaymentMethods([{ id: 1, method: '', amount: '', installments: '1', customInstallments: [] }]);
      setPaymentTabDate(today);
      setPaymentTabExpenseType('expenses');
      setPaymentTabSupplierId('');
      setPaymentTabReference('');
      setPaymentTabNotes('');
      setPaymentMethods([{ id: 1, method: '', amount: '', installments: '1', customInstallments: [] }]);
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
    }
    // After OCR data is set, try to restore draft (user edits override OCR defaults)
    draftRestored.current = false;
    setTimeout(() => {
      const draft = restoreDraft();
      if (draft) {
        if (draft.documentType) setDocumentType(draft.documentType as DocumentType);
        if (draft.expenseType) setExpenseType(draft.expenseType as ExpenseType);
        if (draft.supplierId !== undefined) setSupplierId(draft.supplierId as string);
        if (draft.documentDate) setDocumentDate(draft.documentDate as string);
        if (draft.documentNumber !== undefined) setDocumentNumber(draft.documentNumber as string);
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
        if (draft.paymentTabExpenseType) setPaymentTabExpenseType(draft.paymentTabExpenseType as 'expenses' | 'purchases');
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
  }, [document, suppliers, restoreDraft]);

  const handleSubmit = () => {
    if (!selectedBusinessId) {
      alert('נא לבחור עסק');
      return;
    }

    if (documentType === 'payment') {
      // Payment tab validation
      if (!paymentTabSupplierId || !paymentTabDate) {
        alert('נא למלא את כל השדות הנדרשים');
        return;
      }
      const formData: OCRFormData = {
        business_id: selectedBusinessId,
        document_type: documentType,
        expense_type: paymentTabExpenseType === 'purchases' ? 'goods' : 'current',
        supplier_id: paymentTabSupplierId,
        document_date: paymentTabDate,
        document_number: '',
        amount_before_vat: '0',
        vat_amount: '0',
        total_amount: paymentMethods.reduce((s, p) => s + (parseFloat(p.amount.replace(/[^\d.]/g, '')) || 0), 0).toFixed(2),
        notes: paymentTabNotes,
        is_paid: true,
        payment_method: paymentMethods[0]?.method || '',
        payment_date: paymentTabDate,
        payment_installments: parseInt(paymentMethods[0]?.installments) || 1,
        payment_reference: paymentTabReference,
        payment_notes: paymentTabNotes,
        payment_methods: paymentMethods,
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
      const subtotal = total / 1.17;
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
      const formData: OCRFormData = {
        business_id: selectedBusinessId,
        document_type: documentType,
        expense_type: expenseType,
        supplier_id: supplierId,
        document_date: documentDate,
        document_number: documentNumber,
        amount_before_vat: amountBeforeVat,
        vat_amount: partialVat ? vatAmount : calculatedVat.toFixed(2),
        total_amount: totalWithVat.toFixed(2),
        notes,
        is_paid: isPaid,
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
      onReject(document.id, rejectReason);
      setShowRejectModal(false);
      setRejectReason('');
    }
  };

  // Render payment methods section (reusable for both payment tab and inline)
  const renderPaymentMethodsSection = (
    methods: PaymentMethodEntry[],
    setter: React.Dispatch<React.SetStateAction<PaymentMethodEntry[]>>,
    dateStr: string,
  ) => (
    <div className="flex flex-col gap-[15px]">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-medium text-white">אמצעי תשלום</span>
        <button
          type="button"
          onClick={() => addPaymentMethodEntry(setter, methods)}
          className="bg-[#29318A] text-white text-[14px] font-medium px-[12px] py-[6px] rounded-[7px] hover:bg-[#3D44A0] transition-colors"
        >
          + הוסף אמצעי תשלום
        </button>
      </div>

      {methods.map((pm, pmIndex) => (
        <div key={pm.id} className="border border-[#4C526B] rounded-[10px] p-[10px] flex flex-col gap-[10px]">
          {methods.length > 1 && (
            <div className="flex items-center justify-between mb-[5px]">
              <span className="text-[14px] text-white/70">אמצעי תשלום {pmIndex + 1}</span>
              <button
                type="button"
                onClick={() => removePaymentMethodEntry(setter, methods, pm.id)}
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
              onChange={(e) => updatePaymentMethodField(setter, pm.id, 'method', e.target.value, dateStr)}
              className="w-full h-[50px] bg-[#0F1535] text-[18px] text-white text-center focus:outline-none rounded-[10px] cursor-pointer select-dark"
            >
              <option value="" disabled>בחר אמצעי תשלום...</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method.value} value={method.value}>{method.label}</option>
              ))}
            </select>
          </div>

          {/* Payment Amount */}
          <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
            <input
              type="text"
              inputMode="decimal"
              value={pm.amount ? `₪${parseFloat(pm.amount.replace(/[^\d.]/g, '') || '0').toLocaleString('he-IL')}` : ''}
              onChange={(e) => {
                const rawValue = e.target.value.replace(/[^\d.]/g, '');
                updatePaymentMethodField(setter, pm.id, 'amount', rawValue, dateStr);
              }}
              placeholder="₪0.00 סכום"
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
                onClick={() => updatePaymentMethodField(setter, pm.id, 'installments', String(Math.max(1, parseInt(pm.installments) - 1)), dateStr)}
                className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
              >
                -
              </button>
              <input
                type="text"
                inputMode="numeric"
                title="כמות תשלומים"
                value={pm.installments}
                onChange={(e) => updatePaymentMethodField(setter, pm.id, 'installments', e.target.value.replace(/\D/g, '') || '1', dateStr)}
                className="flex-1 h-[50px] bg-transparent text-[18px] text-white text-center focus:outline-none"
              />
              <button
                type="button"
                title="הוסף תשלום"
                onClick={() => updatePaymentMethodField(setter, pm.id, 'installments', String(parseInt(pm.installments) + 1), dateStr)}
                className="w-[50px] h-[50px] flex items-center justify-center text-white text-[24px] font-bold"
              >
                +
              </button>
            </div>

            {/* Installments Breakdown */}
            {pm.customInstallments.length > 0 && (
              <div className="mt-[10px] border border-[#4C526B] rounded-[10px] p-[10px]">
                <div className="flex items-center gap-[8px] border-b border-[#4C526B] pb-[8px] mb-[8px]">
                  <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תשלום</span>
                  <span className="text-[14px] font-medium text-white/70 flex-1 text-center">תאריך</span>
                  <span className="text-[14px] font-medium text-white/70 flex-1 text-center">סכום</span>
                </div>
                <div className="flex flex-col gap-[8px] max-h-[200px] overflow-y-auto">
                  {pm.customInstallments.map((item, index) => (
                    <div key={item.number} className="flex items-center gap-[8px]">
                      <span className="text-[14px] text-white ltr-num flex-1 text-center">{item.number}/{pm.installments}</span>
                      <div className="flex-1 h-[36px] bg-[#29318A]/30 border border-[#4C526B] rounded-[7px] relative flex items-center justify-center">
                        <span className="text-[14px] text-white pointer-events-none ltr-num">
                          {item.dateForInput ? new Date(item.dateForInput).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''}
                        </span>
                        <input
                          type="date"
                          title={`תאריך תשלום ${item.number}`}
                          value={item.dateForInput}
                          onChange={(e) => handleInstallmentDateChange(setter, pm.id, index, e.target.value)}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        />
                      </div>
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          title={`סכום תשלום ${item.number}`}
                          value={item.amount.toFixed(2)}
                          onChange={(e) => handleInstallmentAmountChange(setter, pm.id, index, e.target.value)}
                          className="w-full h-[36px] bg-[#29318A]/30 border border-[#4C526B] rounded-[7px] text-[14px] text-white text-center focus:outline-none focus:border-white/50 px-[5px] ltr-num"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-[8px] border-t border-[#4C526B] pt-[8px] mt-[8px]">
                  <span className="text-[14px] font-bold text-white w-[50px] text-center flex-shrink-0">סה&quot;כ</span>
                  <span className="flex-1"></span>
                  <span className="text-[14px] font-bold text-white ltr-num flex-1 text-center">
                    ₪{getInstallmentsTotal(pm.customInstallments).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
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
          <button
            type="button"
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
          </button>
          <button
            type="button"
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
          </button>
        </div>
      </div>

      {/* Date Field */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">תאריך</label>
        <div className="relative border border-[#4C526B] rounded-[10px] h-[50px] px-[10px] flex items-center justify-center">
          <span className={`text-[16px] font-semibold pointer-events-none ${documentDate ? 'text-white' : 'text-white/40'}`}>
            {documentDate
              ? new Date(documentDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
              : 'יום/חודש/שנה'}
          </span>
          <input
            type="date"
            title="תאריך מסמך"
            value={documentDate}
            onChange={(e) => setDocumentDate(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
        </div>
      </div>

      {/* Supplier Select */}
      <div className="flex flex-col gap-[3px]">
        <label className="text-[15px] font-medium text-white text-right">שם ספק</label>
        {document?.ocr_data?.supplier_name && !supplierId && (
          <div className="bg-[#29318A]/20 border border-[#29318A]/40 rounded-[8px] px-[10px] py-[6px]">
            <span className="text-[13px] text-[#00D4FF]">זוהה מ-OCR: </span>
            <span className="text-[13px] text-white font-medium">{document.ocr_data.supplier_name}</span>
          </div>
        )}
        <div className="border border-[#4C526B] rounded-[10px]">
          <select
            title="בחר ספק"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
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

      {/* Document Number */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-normal text-white text-right">מספר חשבונית / תעודת משלוח</label>
        <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
          <input
            type="text"
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
            placeholder="מספר מסמך..."
            className="w-full h-full bg-transparent text-white text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
          />
        </div>
      </div>

      {/* Amount Before VAT */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">סכום לפני מע&apos;&apos;מ</label>
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
          <label className="text-[15px] font-medium text-white text-right">מע&quot;מ</label>
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
                  <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor" />
                  <path d="M10 16L14 20L22 12" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </>
              ) : (
                <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" />
              )}
            </svg>
          </button>
          <span className="text-[15px] font-medium text-white">הזנת סכום מע&quot;מ חלקי</span>
        </div>
      </div>

      {/* Total with VAT */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">סכום כולל מע&quot;מ</label>
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

      {/* Paid in Full Checkbox */}
      <div className="flex flex-col gap-[3px]" dir="rtl">
        <button
          type="button"
          onClick={() => {
            const newVal = !isPaid;
            setIsPaid(newVal);
            if (newVal) {
              const today = new Date().toISOString().split('T')[0];
              setInlinePaymentDate(today);
              const amount = totalWithVat > 0 ? totalWithVat.toString() : '';
              setInlinePaymentMethods([{
                id: 1,
                method: '',
                amount,
                installments: '1',
                customInstallments: amount ? generateInstallments(1, totalWithVat, today) : [],
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
        </button>

        {/* Payment Details Section - aligned with expenses page payment section */}
        {isPaid && (
          <div className="bg-[#0F1535] rounded-[10px] p-[25px_5px_5px] mt-[15px]">
            <h3 className="text-[18px] font-semibold text-white text-center mb-[20px]">הוספת הוצאה - קליטת תשלום</h3>

            <div className="flex flex-col gap-[15px]">
              {/* Payment Date */}
              <div className="flex flex-col gap-[3px]">
                <label className="text-[15px] font-medium text-white text-right">תאריך תשלום</label>
                <div className="relative border border-[#4C526B] rounded-[10px] h-[50px] px-[10px] flex items-center justify-center">
                  <span className={`text-[16px] font-semibold pointer-events-none ${inlinePaymentDate ? 'text-white' : 'text-white/40'}`}>
                    {inlinePaymentDate
                      ? new Date(inlinePaymentDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
                      : 'יום/חודש/שנה'}
                  </span>
                  <input
                    type="date"
                    title="תאריך תשלום"
                    value={inlinePaymentDate}
                    onChange={(e) => {
                      setInlinePaymentDate(e.target.value);
                      setInlinePaymentMethods(prev => prev.map(p => {
                        const numInstallments = parseInt(p.installments) || 1;
                        const totalAmount = parseFloat(p.amount.replace(/[^\d.]/g, '')) || 0;
                        if (numInstallments >= 1 && totalAmount > 0) {
                          return { ...p, customInstallments: generateInstallments(numInstallments, totalAmount, e.target.value) };
                        }
                        return { ...p, customInstallments: [] };
                      }));
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                </div>
              </div>

              {/* Payment Methods */}
              {renderPaymentMethodsSection(inlinePaymentMethods, setInlinePaymentMethods, inlinePaymentDate)}

              {/* Payment Reference */}
              <div className="flex flex-col gap-[3px]">
                <label className="text-[15px] font-medium text-white text-right">אסמכתא</label>
                <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
                  <input
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
                  <textarea
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

  // Render Payment tab form (aligned with payments page new payment form)
  const renderPaymentForm = () => (
    <div className="flex flex-col gap-[15px]">
      {/* Payment Date */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[16px] font-medium text-white text-right">תאריך קבלה</label>
        <div className="relative border border-[#4C526B] rounded-[10px] h-[50px] px-[10px] flex items-center justify-center">
          <span className={`text-[16px] font-semibold pointer-events-none ${paymentTabDate ? 'text-white' : 'text-white/40'}`}>
            {paymentTabDate
              ? new Date(paymentTabDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
              : 'יום/חודש/שנה'}
          </span>
          <input
            type="date"
            title="תאריך קבלה"
            value={paymentTabDate}
            onChange={(e) => setPaymentTabDate(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
        </div>
      </div>

      {/* Expense Type */}
      <div className="flex flex-col gap-[3px]">
        <label className="text-[16px] font-medium text-white text-right">סוג הוצאה</label>
        <div dir="rtl" className="flex items-start gap-[20px]">
          <button
            type="button"
            onClick={() => setPaymentTabExpenseType('purchases')}
            className="flex flex-row-reverse items-center gap-[3px] cursor-pointer"
          >
            <span className={`text-[16px] font-semibold ${paymentTabExpenseType === 'purchases' ? 'text-white' : 'text-[#979797]'}`}>
              קניות סחורה
            </span>
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={paymentTabExpenseType === 'purchases' ? 'text-white' : 'text-[#979797]'}>
              {paymentTabExpenseType === 'purchases' ? (
                <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor" />
              ) : (
                <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" />
              )}
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setPaymentTabExpenseType('expenses')}
            className="flex flex-row-reverse items-center gap-[3px] cursor-pointer"
          >
            <span className={`text-[16px] font-semibold ${paymentTabExpenseType === 'expenses' ? 'text-white' : 'text-[#979797]'}`}>
              הוצאות שוטפות
            </span>
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={paymentTabExpenseType === 'expenses' ? 'text-white' : 'text-[#979797]'}>
              {paymentTabExpenseType === 'expenses' ? (
                <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor" />
              ) : (
                <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Supplier */}
      <div className="flex flex-col gap-[3px]">
        <label className="text-[16px] font-medium text-white text-right">שם ספק</label>
        {document?.ocr_data?.supplier_name && !paymentTabSupplierId && (
          <div className="bg-[#29318A]/20 border border-[#29318A]/40 rounded-[8px] px-[10px] py-[6px]">
            <span className="text-[13px] text-[#00D4FF]">זוהה מ-OCR: </span>
            <span className="text-[13px] text-white font-medium">{document.ocr_data.supplier_name}</span>
          </div>
        )}
        <div className="border border-[#4C526B] rounded-[10px]">
          <select
            title="בחר ספק"
            value={paymentTabSupplierId}
            onChange={(e) => setPaymentTabSupplierId(e.target.value)}
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

      {/* Payment Methods Section */}
      {renderPaymentMethodsSection(paymentMethods, setPaymentMethods, paymentTabDate)}

      {/* Reference */}
      <div className="flex flex-col gap-[3px]">
        <label className="text-[16px] font-medium text-white text-right">אסמכתא</label>
        <div className="border border-[#4C526B] rounded-[10px] min-h-[50px]">
          <input
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
          <textarea
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
      <div className="flex flex-col gap-[3px]">
        <label className="text-[15px] font-medium text-white text-right">בחירת ספק מרכזת</label>
        <div className="border border-[#4C526B] rounded-[10px]">
          <select
            title="בחר ספק"
            value={summarySupplierId}
            onChange={(e) => setSummarySupplierId(e.target.value)}
            disabled={!selectedBusinessId}
            className="w-full h-[48px] bg-[#0F1535] text-white/40 text-[16px] text-center rounded-[10px] border-none outline-none px-[10px] disabled:opacity-50"
          >
            <option value="" className="bg-[#0F1535] text-white/40">
              {coordinatorSuppliers.length === 0 && selectedBusinessId ? 'אין ספקי מרכזת' : 'בחר/י ספק...'}
            </option>
            {coordinatorSuppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id} className="bg-[#0F1535] text-white">
                {supplier.name}
              </option>
            ))}
          </select>
        </div>
        {selectedBusinessId && coordinatorSuppliers.length === 0 && (
          <p className="text-[12px] text-[#F64E60] text-right">
            אין ספקים מוגדרים כמרכזת. יש לסמן ספק כ&quot;מרכזת&quot; בהגדרות הספק.
          </p>
        )}
      </div>

      {/* Date Field */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">תאריך מרכזת</label>
        <div className="relative border border-[#4C526B] rounded-[10px] h-[50px] px-[10px] flex items-center justify-center">
          <span className={`text-[16px] font-semibold pointer-events-none ${summaryDate ? 'text-white' : 'text-white/40'}`}>
            {summaryDate
              ? new Date(summaryDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
              : 'יום/חודש/שנה'}
          </span>
          <input
            type="date"
            title="תאריך מרכזת"
            value={summaryDate}
            onChange={(e) => setSummaryDate(e.target.value)}
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
          <input
            type="text"
            inputMode="decimal"
            value={summaryTotalAmount}
            onChange={(e) => setSummaryTotalAmount(e.target.value)}
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
        {summaryDeliveryNotes.length > 0 && (
          <div className="flex flex-col gap-[8px]">
            {summaryDeliveryNotes.map((note, index) => (
              <div
                key={index}
                className="flex items-center justify-between bg-[#1a1f42] rounded-[8px] p-[10px]"
              >
                <button
                  type="button"
                  onClick={() => handleRemoveDeliveryNote(index)}
                  className="text-[#F64E60] text-[18px] font-bold hover:opacity-80"
                >
                  &times;
                </button>
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
        <div className="border border-[#4C526B] rounded-[10px]">
          <select
            title="האם נסגר"
            value={summaryIsClosed}
            onChange={(e) => setSummaryIsClosed(e.target.value)}
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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0F1535] border-b border-[#4C526B]">
        <h2 className="text-[18px] font-bold text-white">פרטי מסמך</h2>
      </div>

      {/* Business Selector */}
      <div className="px-4 py-2 bg-[#0F1535] border-b border-[#4C526B]" dir="rtl">
        <div className="border border-[#4C526B] rounded-[10px]">
          <select
            title="בחר עסק"
            value={selectedBusinessId}
            onChange={(e) => onBusinessChange(e.target.value)}
            className="w-full h-[42px] bg-[#0F1535] text-white text-[15px] text-center rounded-[10px] border-none outline-none px-[10px] font-medium"
          >
            <option value="" className="bg-[#0F1535] text-white/40">בחר/י עסק...</option>
            {businesses.map((business) => (
              <option key={business.id} value={business.id} className="bg-[#0F1535] text-white">
                {business.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Document Type Tabs */}
      <div className="flex border-b border-[#4C526B]" dir="rtl">
        {DOCUMENT_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setDocumentType(tab.value)}
            className={`flex-1 py-[12px] text-[14px] font-medium transition-colors ${
              documentType === tab.value
                ? 'text-white border-b-2 border-[#29318A] bg-[#29318A]/10'
                : 'text-white/50 border-b-2 border-transparent hover:text-white/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Form content - scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-4" dir="rtl">
        {(documentType === 'invoice' || documentType === 'delivery_note' || documentType === 'credit_note') && renderInvoiceForm()}
        {documentType === 'payment' && renderPaymentForm()}
        {documentType === 'summary' && renderSummaryForm()}
      </div>

      {/* Action buttons - fixed at bottom */}
      <div className="px-4 py-4 bg-[#0F1535] border-t border-[#4C526B]">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isLoading || (documentType === 'summary' && (!selectedBusinessId || !summarySupplierId || !summaryInvoiceNumber || !summaryTotalAmount || !summaryIsClosed))}
            className={`flex-1 h-[50px] text-white text-[16px] font-semibold rounded-[10px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              documentType === 'summary'
                ? 'bg-gradient-to-r from-[#0075FF] to-[#00D4FF]'
                : 'bg-[#22c55e] hover:bg-[#16a34a]'
            }`}
          >
            {isLoading ? 'שומר...' : documentType === 'summary' ? 'שמירה' : 'אישור וקליטה'}
          </button>
          <button
            type="button"
            onClick={() => setShowRejectModal(true)}
            disabled={isLoading}
            className="h-[50px] px-6 bg-[#EB5757]/20 hover:bg-[#EB5757]/30 text-[#EB5757] text-[16px] font-semibold rounded-[10px] transition-colors disabled:opacity-50"
          >
            דחייה
          </button>
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              disabled={isLoading}
              className="h-[50px] px-6 bg-[#4C526B]/30 hover:bg-[#4C526B]/50 text-white/70 text-[16px] font-semibold rounded-[10px] transition-colors disabled:opacity-50"
            >
              דלג
            </button>
          )}
          {onDelete && document && (
            <button
              type="button"
              onClick={() => {
                if (confirm('האם אתה בטוח שברצונך למחוק את המסמך לצמיתות?')) {
                  onDelete(document.id);
                }
              }}
              disabled={isLoading}
              className="h-[50px] px-4 bg-transparent hover:bg-[#EB5757]/10 text-[#EB5757]/60 hover:text-[#EB5757] text-[14px] rounded-[10px] transition-colors disabled:opacity-50"
              title="מחק מסמך"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
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
            <div className="flex justify-between items-center" dir="ltr">
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="text-[#7B91B0] hover:text-white transition-colors"
                title="סגור"
                aria-label="סגור"
              >
                <X className="w-6 h-6" />
              </button>
              <SheetTitle className="text-white text-xl font-bold">דחיית מסמך</SheetTitle>
              <div className="w-[24px]" />
            </div>
          </SheetHeader>
          <div className="flex flex-col gap-3 p-4" dir="rtl">
            {['מסמך לא קריא', 'מסמך כפול', 'לא מסמך עסקי', 'אחר'].map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => setRejectReason(reason)}
                className={`h-[44px] rounded-[10px] text-[14px] font-medium transition-colors ${
                  rejectReason === reason
                    ? 'bg-[#29318A] text-white border border-[#29318A]'
                    : 'bg-transparent text-white/60 border border-[#4C526B] hover:border-[#29318A]/50'
                }`}
              >
                {reason}
              </button>
            ))}
            {rejectReason === 'אחר' && (
              <div>
                <textarea
                  placeholder="פרט את סיבת הדחייה..."
                  value={rejectReason === 'אחר' ? '' : rejectReason}
                  onChange={(e) => setRejectReason(e.target.value || 'אחר')}
                  className="w-full h-[80px] bg-transparent text-white text-[14px] text-right border border-[#4C526B] rounded-[10px] p-3 resize-none"
                />
              </div>
            )}
            <div className="flex gap-3 mt-2">
              <button
                type="button"
                onClick={handleReject}
                className="flex-1 h-[44px] bg-[#EB5757] hover:bg-[#d64545] text-white text-[14px] font-semibold rounded-[10px] transition-colors"
              >
                דחה מסמך
              </button>
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="flex-1 h-[44px] bg-[#4C526B]/30 hover:bg-[#4C526B]/50 text-white/70 text-[14px] font-semibold rounded-[10px] transition-colors"
              >
                ביטול
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
