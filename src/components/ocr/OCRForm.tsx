'use client';

import { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import type { OCRDocument, OCRFormData, DocumentType, ExpenseType } from '@/types/ocr';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

interface Supplier {
  id: string;
  name: string;
}

interface OCRFormProps {
  document: OCRDocument | null;
  suppliers: Supplier[];
  onApprove: (formData: OCRFormData) => void;
  onReject: (documentId: string, reason?: string) => void;
  onSkip?: () => void;
  isLoading?: boolean;
}

const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'invoice', label: 'חשבונית' },
  { value: 'delivery_note', label: 'תעודת משלוח' },
  { value: 'credit_note', label: 'זיכוי' },
  { value: 'payment', label: 'תשלום' },
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

export default function OCRForm({
  document,
  suppliers,
  onApprove,
  onReject,
  onSkip,
  isLoading = false,
}: OCRFormProps) {
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
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentInstallments, setPaymentInstallments] = useState(1);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Calculate VAT and total
  const calculatedVat = useMemo(() => {
    const amount = parseFloat(amountBeforeVat) || 0;
    return amount * VAT_RATE;
  }, [amountBeforeVat]);

  const totalWithVat = useMemo(() => {
    const amount = parseFloat(amountBeforeVat) || 0;
    const vat = partialVat ? (parseFloat(vatAmount) || 0) : calculatedVat;
    return amount + vat;
  }, [amountBeforeVat, vatAmount, partialVat, calculatedVat]);

  const paymentPerInstallment = useMemo(() => {
    return paymentInstallments > 0 ? totalWithVat / paymentInstallments : 0;
  }, [totalWithVat, paymentInstallments]);

  // Populate form from OCR data when document changes
  useEffect(() => {
    if (document?.ocr_data) {
      const data = document.ocr_data;

      // Set document type
      if (document.document_type) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDocumentType(document.document_type);
      }

      // Set expense type
      if (document.expense_type) {
        setExpenseType(document.expense_type);
      }

      // Set date
      if (data.document_date) {
        setDocumentDate(data.document_date);
      } else {
        setDocumentDate(new Date().toISOString().split('T')[0]);
      }

      // Set document number
      if (data.document_number) {
        setDocumentNumber(data.document_number);
      }

      // Set amounts
      if (data.subtotal !== undefined) {
        setAmountBeforeVat(data.subtotal.toString());
      }
      if (data.vat_amount !== undefined) {
        setVatAmount(data.vat_amount.toString());
        // Check if VAT is different from standard rate
        const expectedVat = (data.subtotal || 0) * VAT_RATE;
        if (Math.abs((data.vat_amount || 0) - expectedVat) > 0.01) {
          setPartialVat(true);
        }
      }

      // Try to match supplier
      if (data.supplier_name) {
        const matchedSupplier = suppliers.find(
          (s) => s.name.includes(data.supplier_name!) || data.supplier_name!.includes(s.name)
        );
        if (matchedSupplier) {
          setSupplierId(matchedSupplier.id);
        }
      }

      // Reset payment fields
      setIsPaid(false);
      setPaymentMethod('');
      setPaymentDate('');
      setPaymentInstallments(1);
      setPaymentReference('');
      setPaymentNotes('');
      setNotes('');
    } else {
      // Reset all fields for empty document
      setDocumentType('invoice');
      setExpenseType('goods');
      setSupplierId('');
      setDocumentDate(new Date().toISOString().split('T')[0]);
      setDocumentNumber('');
      setAmountBeforeVat('');
      setVatAmount('');
      setPartialVat(false);
      setNotes('');
      setIsPaid(false);
      setPaymentMethod('');
      setPaymentDate('');
      setPaymentInstallments(1);
      setPaymentReference('');
      setPaymentNotes('');
    }
  }, [document, suppliers]);

  const handleSubmit = () => {
    if (!supplierId || !documentDate || !amountBeforeVat) {
      alert('נא למלא את כל השדות הנדרשים');
      return;
    }

    const formData: OCRFormData = {
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
        payment_method: paymentMethod,
        payment_date: paymentDate,
        payment_installments: paymentInstallments,
        payment_reference: paymentReference,
        payment_notes: paymentNotes,
      }),
    };

    onApprove(formData);
  };

  const handleReject = () => {
    if (document) {
      onReject(document.id, rejectReason);
      setShowRejectModal(false);
      setRejectReason('');
    }
  };

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
        {document.ocr_data?.confidence_score && (
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-white/60">דיוק OCR:</span>
            <span
              className={`text-[13px] font-semibold ${
                document.ocr_data.confidence_score > 0.9
                  ? 'text-[#22c55e]'
                  : document.ocr_data.confidence_score > 0.7
                  ? 'text-[#f59e0b]'
                  : 'text-[#EB5757]'
              }`}
            >
              {Math.round(document.ocr_data.confidence_score * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Form content - scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-4" dir="rtl">
        <div className="flex flex-col gap-[15px]">
          {/* Document Type */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">סוג מסמך</label>
            <div className="grid grid-cols-2 gap-2">
              {DOCUMENT_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setDocumentType(type.value)}
                  className={`h-[44px] rounded-[10px] text-[14px] font-medium transition-colors ${
                    documentType === type.value
                      ? 'bg-[#29318A] text-white border border-[#29318A]'
                      : 'bg-transparent text-white/60 border border-[#4C526B] hover:border-[#29318A]/50'
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Expense Type */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">סוג הוצאה</label>
            <div className="flex items-center justify-start gap-[20px]">
              <button
                type="button"
                onClick={() => setExpenseType('goods')}
                className="flex items-center gap-[6px]"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 32 32"
                  fill="none"
                  className={expenseType === 'goods' ? 'text-white' : 'text-white/50'}
                >
                  {expenseType === 'goods' ? (
                    <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor" />
                  ) : (
                    <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" />
                  )}
                </svg>
                <span
                  className={`text-[15px] font-semibold ${
                    expenseType === 'goods' ? 'text-white' : 'text-white/50'
                  }`}
                >
                  קניות סחורה
                </span>
              </button>
              <button
                type="button"
                onClick={() => setExpenseType('current')}
                className="flex items-center gap-[6px]"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 32 32"
                  fill="none"
                  className={expenseType === 'current' ? 'text-white' : 'text-white/50'}
                >
                  {expenseType === 'current' ? (
                    <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor" />
                  ) : (
                    <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" />
                  )}
                </svg>
                <span
                  className={`text-[15px] font-semibold ${
                    expenseType === 'current' ? 'text-white' : 'text-white/50'
                  }`}
                >
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
                  ? new Date(documentDate).toLocaleDateString('he-IL', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })
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
            <div className="border border-[#4C526B] rounded-[10px]">
              <select
                title="בחר ספק"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full h-[48px] bg-[#0F1535] text-white/40 text-[16px] text-center rounded-[10px] border-none outline-none px-[10px]"
              >
                <option value="" className="bg-[#0F1535] text-white/40">
                  בחר/י ספק...
                </option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id} className="bg-[#0F1535] text-white">
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>
            {document.ocr_data?.supplier_name && !supplierId && (
              <p className="text-[12px] text-[#f59e0b] mt-1">
                OCR זיהה: {document.ocr_data.supplier_name}
              </p>
            )}
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
            <label className="text-[15px] font-medium text-white text-right">סכום לפני מע״מ</label>
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
              <label className="text-[15px] font-medium text-white text-right">מע״מ</label>
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
              <span className="text-[15px] font-medium text-white">הזנת סכום מע״מ חלקי</span>
            </div>
          </div>

          {/* Total with VAT */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">סכום כולל מע״מ</label>
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
            <div className="border border-[#4C526B] rounded-[10px] min-h-[80px]">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="הערות למסמך..."
                className="w-full h-full min-h-[80px] bg-transparent text-white text-[16px] text-right rounded-[10px] border-none outline-none p-[10px] resize-none"
              />
            </div>
          </div>

          {/* Paid in Full Checkbox */}
          <div className="flex flex-col gap-[3px]">
            <button
              type="button"
              onClick={() => setIsPaid(!isPaid)}
              className="flex items-center gap-[6px] min-h-[35px]"
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

            {/* Payment Details Section */}
            {isPaid && (
              <div className="bg-[#0a0d1f] rounded-[10px] p-4 mt-3">
                <h3 className="text-[16px] font-semibold text-white text-center mb-4">פרטי תשלום</h3>

                <div className="flex flex-col gap-[15px]">
                  {/* Payment Method */}
                  <div className="flex flex-col gap-[3px]">
                    <label className="text-[15px] font-medium text-white text-right">אמצעי תשלום</label>
                    <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                      <select
                        title="אמצעי תשלום"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="w-full h-full bg-transparent text-white/40 text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
                      >
                        <option value="" className="bg-[#0F1535] text-white/40"></option>
                        {PAYMENT_METHODS.map((method) => (
                          <option key={method.value} value={method.value} className="bg-[#0F1535] text-white">
                            {method.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Payment Date */}
                  <div className="flex flex-col gap-[3px]">
                    <label className="text-[15px] font-medium text-white text-right">מתי יורד התשלום?</label>
                    <div className="relative border border-[#4C526B] rounded-[10px] h-[50px] px-[10px] flex items-center justify-center">
                      <span className={`text-[16px] font-semibold pointer-events-none ${paymentDate ? 'text-white' : 'text-white/40'}`}>
                        {paymentDate
                          ? new Date(paymentDate).toLocaleDateString('he-IL', {
                              day: '2-digit',
                              month: '2-digit',
                              year: '2-digit',
                            })
                          : 'יום/חודש/שנה'}
                      </span>
                      <input
                        type="date"
                        title="תאריך תשלום"
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                    </div>
                  </div>

                  {/* Number of Installments */}
                  <div className="flex flex-col gap-[3px]">
                    <label className="text-[15px] font-medium text-white text-right">כמות תשלומים שווים</label>
                    <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center justify-center gap-[30px] px-[10px]">
                      <button
                        type="button"
                        title="הוסף תשלום"
                        onClick={() => setPaymentInstallments((prev) => prev + 1)}
                        className="text-white"
                      >
                        <svg width="27" height="27" viewBox="0 0 32 32" fill="none">
                          <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2" />
                          <path d="M16 10V22M10 16H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
                      <span className="text-[20px] text-white">{paymentInstallments}</span>
                      <button
                        type="button"
                        title="הפחת תשלום"
                        onClick={() => setPaymentInstallments((prev) => Math.max(1, prev - 1))}
                        className="text-white"
                      >
                        <svg width="27" height="27" viewBox="0 0 32 32" fill="none">
                          <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2" />
                          <path d="M10 16H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Payment Amount per Installment */}
                  <div className="flex flex-col gap-[3px]">
                    <label className="text-[15px] font-medium text-white text-right">סכום לתשלום</label>
                    <div className="flex gap-[5px]">
                      <div className="flex-1 border border-[#4C526B] rounded-[10px] h-[50px]">
                        <input
                          type="text"
                          title="סכום לתשלום"
                          disabled
                          value={paymentPerInstallment.toFixed(2)}
                          className="w-full h-full bg-transparent text-white text-[14px] font-bold text-center rounded-[10px] border-none outline-none"
                        />
                      </div>
                      <div className="flex-1 border border-[#4C526B] rounded-[10px] h-[50px]">
                        <input
                          type="text"
                          title="סכום כולל"
                          disabled
                          value={totalWithVat.toFixed(2)}
                          className="w-full h-full bg-transparent text-white text-[14px] font-bold text-center rounded-[10px] border-none outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Payment Reference */}
                  <div className="flex flex-col gap-[3px]">
                    <label className="text-[15px] font-medium text-white text-right">מספר אסמכתא</label>
                    <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
                      <input
                        type="text"
                        title="מספר אסמכתא"
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                        className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
                      />
                    </div>
                  </div>

                  {/* Payment Notes */}
                  <div className="flex flex-col gap-[3px]">
                    <label className="text-[15px] font-medium text-white text-right">הערות לתשלום</label>
                    <div className="border border-[#4C526B] rounded-[10px] min-h-[75px]">
                      <textarea
                        title="הערות לתשלום"
                        value={paymentNotes}
                        onChange={(e) => setPaymentNotes(e.target.value)}
                        className="w-full h-full min-h-[75px] bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none p-[10px] resize-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action buttons - fixed at bottom */}
      <div className="px-4 py-4 bg-[#0F1535] border-t border-[#4C526B]">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isLoading}
            className="flex-1 h-[50px] bg-[#22c55e] hover:bg-[#16a34a] text-white text-[16px] font-semibold rounded-[10px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'שומר...' : 'אישור וקליטה'}
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
