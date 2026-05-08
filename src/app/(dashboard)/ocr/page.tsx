'use client';

/**
 * OCR Page — Mistral pipeline (production)
 *
 * Reads Mistral-extracted columns first, falls back to legacy Google Vision
 * values only if Mistral hasn't processed the doc yet. Re-OCR (triggered by
 * image crop) hits /api/ai/ocr-extract-mistral.
 */

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '../layout';
import { createClient } from '@/lib/supabase/client';
import DocumentViewer from '@/components/ocr/DocumentViewer';
import OCRForm from '@/components/ocr/OCRForm';
import DocumentQueue from '@/components/ocr/DocumentQueue';
import OCRFormResizer from '@/components/ocr/OCRFormResizer';
import OCRQueueResizer from '@/components/ocr/OCRQueueResizer';
import { OCRQueueSkeleton, OCRViewerSkeleton, OCRFormSkeleton } from '@/components/ocr/OCRSkeletons';
import QuickAddSupplierModal from '@/components/ocr/QuickAddSupplierModal';
import { useMultiTableRealtime } from '@/hooks/useRealtimeSubscription';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { OCRDocument, OCRFormData, DocumentStatus, OCRExtractedData, DocumentType } from '@/types/ocr';
import { Button } from "@/components/ui/button";
import { savePriceTrackingForLineItems } from '@/lib/priceTracking';
import { uploadFile } from '@/lib/uploadFile';
import { useToast } from "@/components/ui/toast";

interface Business {
  id: string;
  name: string;
  vat_percentage?: number;
}

interface Supplier {
  id: string;
  name: string;
  waiting_for_coordinator?: boolean;
  is_fixed_expense?: boolean;
  vat_type?: string | null;
  expense_type?: string | null;
}

export default function OCRPage() {
  const router = useRouter();
  const { isAdmin } = useDashboard();
  const { showToast } = useToast();

  // State - ALL hooks must be declared before any conditional returns
  const [documents, setDocuments] = useState<OCRDocument[]>([]);
  const [currentDocument, setCurrentDocument] = useState<OCRDocument | null>(null);
  const [filterStatus, setFilterStatus] = usePersistedState<DocumentStatus | 'all'>('ocr:filterStatus', 'pending');
  const [businessFilter, setBusinessFilter] = usePersistedState<string>('ocr:businessFilter', 'all');

  // Reviewers used to get stuck on filterStatus='reviewing' because the old
  // code flipped docs to that bucket on click and persisted the filter in
  // localStorage. We no longer use 'reviewing' at all — normalize any stale
  // stored value back to 'pending' on mount.
  useEffect(() => {
    if (filterStatus === 'reviewing') setFilterStatus('pending');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  // Distinct from isLoading (which tracks per-action work like approve/reject):
  // tracks the very first fetch of documents+businesses. Used by the render
  // path to swap the queue/viewer/form for skeletons until we have data.
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showMobileViewer, setShowMobileViewer] = useState(true);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [showCalculator, setShowCalculator] = useState(false);
  const [mergedDocuments, setMergedDocuments] = useState<OCRDocument[]>([]);
  // Resizable form panel — width persists across sessions per page so reviewers
  // can match the panel to their typical document shape (wide invoices benefit
  // from a narrower form, dense ones want it wider). Only applies on lg+; on
  // mobile the form panel takes full width via the tab layout.
  const [formWidth, setFormWidth] = usePersistedState<number>('ocr:formWidth', 420);
  // Queue panel width (desktop) — same persistence pattern as the form
  // panel so reviewers can match the queue width to their workflow.
  const [queueWidth, setQueueWidth] = usePersistedState<number>('ocr:queueWidth', 240);
  const [isLgScreen, setIsLgScreen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsLgScreen(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Fetch OCR documents from Supabase
  const fetchDocuments = useCallback(async (): Promise<OCRDocument[]> => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('ocr_documents')
      .select('*, ocr_extracted_data(*, ocr_extracted_line_items(*))')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching OCR documents:', error);
      setIsInitialLoad(false);
      return [];
    }

    if (data) {
      const mapped: OCRDocument[] = data.map((doc: Record<string, unknown>) => {
        const extracted = Array.isArray(doc.ocr_extracted_data) && doc.ocr_extracted_data.length > 0
          ? doc.ocr_extracted_data[0] as Record<string, unknown>
          : null;

        // Read MISTRAL columns first, fall back to legacy Google Vision values
        // only if Mistral hasn't processed this doc yet. Line items come from
        // the JSONB mistral_line_items field when available, otherwise from
        // the legacy ocr_extracted_line_items relation.
        const hasMistral = extracted?.mistral_processed_at != null
          && extracted?.mistral_supplier_name != null;

        const mistralItemsRaw = Array.isArray(extracted?.mistral_line_items)
          ? (extracted.mistral_line_items as Record<string, unknown>[])
          : [];
        const legacyItemsRaw = Array.isArray(extracted?.ocr_extracted_line_items)
          ? (extracted.ocr_extracted_line_items as Record<string, unknown>[])
          : [];
        const rawLineItems = hasMistral && mistralItemsRaw.length > 0
          ? mistralItemsRaw
          : legacyItemsRaw;
        const lineItems = rawLineItems.map((li) => ({
          id: (li.id as string) || undefined,
          description: (li.description as string) || undefined,
          quantity: li.quantity != null ? Number(li.quantity) : undefined,
          unit_price: li.unit_price != null ? Number(li.unit_price) : undefined,
          total: li.total != null ? Number(li.total) : undefined,
        }));

        const pick = <T,>(mistralVal: T, googleVal: T): T => (hasMistral && mistralVal != null ? mistralVal : googleVal);

        const ocrData: OCRExtractedData | undefined = extracted ? {
          supplier_name: pick(extracted.mistral_supplier_name as string, extracted.supplier_name as string) || undefined,
          supplier_tax_id: pick(extracted.mistral_supplier_tax_id as string, extracted.supplier_tax_id as string) || undefined,
          document_number: pick(extracted.mistral_document_number as string, extracted.document_number as string) || undefined,
          document_date: pick(extracted.mistral_document_date, extracted.document_date)
            ? String(pick(extracted.mistral_document_date, extracted.document_date)) : undefined,
          subtotal: pick(extracted.mistral_subtotal, extracted.subtotal) != null
            ? Number(pick(extracted.mistral_subtotal, extracted.subtotal)) : undefined,
          vat_amount: pick(extracted.mistral_vat_amount, extracted.vat_amount) != null
            ? Number(pick(extracted.mistral_vat_amount, extracted.vat_amount)) : undefined,
          total_amount: pick(extracted.mistral_total_amount, extracted.total_amount) != null
            ? Number(pick(extracted.mistral_total_amount, extracted.total_amount)) : undefined,
          confidence_score: extracted.overall_confidence != null ? Number(extracted.overall_confidence) : undefined,
          raw_text: (hasMistral ? (extracted.mistral_markdown as string) : (extracted.raw_text as string)) || undefined,
          matched_supplier_id: pick(extracted.mistral_matched_supplier_id as string, extracted.matched_supplier_id as string) || undefined,
          line_items: lineItems.length > 0 ? lineItems : undefined,
        } : undefined;

        return {
          id: doc.id as string,
          business_id: doc.business_id as string,
          source: (doc.source as string || 'upload') as OCRDocument['source'],
          source_sender_name: (doc.source_sender_name as string) || undefined,
          source_sender_phone: (doc.source_sender_phone as string) || undefined,
          image_url: doc.image_url as string,
          original_filename: (doc.original_filename as string) || undefined,
          file_type: (doc.file_type as string) || undefined,
          status: (doc.status as string || 'pending') as DocumentStatus,
          document_type: (pick(extracted?.mistral_document_type as DocumentType, doc.document_type as DocumentType)) || undefined,
          ocr_data: ocrData,
          created_at: doc.created_at as string,
          processed_at: (doc.ocr_processed_at as string) || undefined,
          reviewed_by: (doc.reviewed_by as string) || undefined,
          reviewed_at: (doc.reviewed_at as string) || undefined,
          rejection_reason: (doc.rejection_reason as string) || undefined,
          created_invoice_id: (doc.created_invoice_id as string) || undefined,
          created_payment_id: (doc.created_payment_id as string) || undefined,
          created_delivery_note_id: (doc.created_delivery_note_id as string) || undefined,
        };
      });
      setDocuments(mapped);
      setIsInitialLoad(false);
      return mapped;
    }
    setIsInitialLoad(false);
    return [];
  }, []);

  // Business and supplier state
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState('ocr:businessId', '');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [coordinatorSuppliers, setCoordinatorSuppliers] = useState<Supplier[]>([]);

  // Quick "+ ספק חדש" sheet — opens from inside OCRForm. We hold the state
  // here (not inside the form) so a successful insert can refresh the
  // suppliers list and bump pendingSupplierToSelect, which the form keys
  // off of to auto-select the new row without us having to remount.
  const [showQuickAddSupplier, setShowQuickAddSupplier] = useState(false);
  const [pendingSupplierToSelect, setPendingSupplierToSelect] = useState<string | null>(null);

  // When admin picks a business in the form, persist business_id on the
  // current document immediately. This way the doc routes to the correct
  // /ocr-business view without waiting for "אישור וקליטה" — fixes the
  // case where pending docs assigned to a business stay invisible to
  // that business's users until approved.
  const handleBusinessChange = useCallback(async (newBusinessId: string) => {
    setSelectedBusinessId(newBusinessId);
    if (!currentDocument) return;
    const targetId = newBusinessId || null;
    if (currentDocument.business_id === targetId) return;
    const supabase = createClient();
    const { error } = await supabase
      .from('ocr_documents')
      .update({ business_id: targetId, updated_at: new Date().toISOString() })
      .eq('id', currentDocument.id);
    if (error) {
      console.error('Failed to persist business_id on current OCR doc:', error);
      return;
    }
    setCurrentDocument(prev => prev && prev.id === currentDocument.id ? { ...prev, business_id: targetId || '' } : prev);
    setDocuments(prev => prev.map(d => d.id === currentDocument.id ? { ...d, business_id: targetId || '' } : d));
  }, [currentDocument, setSelectedBusinessId]);

  // Check admin access
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsCheckingAuth(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Redirect non-admin users
  useEffect(() => {
    if (!isCheckingAuth && !isAdmin) {
      router.replace('/');
    }
  }, [isAdmin, isCheckingAuth, router]);

  // Fetch OCR documents when admin is confirmed
  useEffect(() => {
    if (!isCheckingAuth && isAdmin) {
      fetchDocuments();
    }
  }, [isCheckingAuth, isAdmin, fetchDocuments]);

  // Realtime subscription - auto-refresh when new documents arrive or data changes
  useMultiTableRealtime(
    ['ocr_documents', 'ocr_extracted_data'],
    fetchDocuments,
    !isCheckingAuth && isAdmin
  );

  // Fetch businesses (admin sees all active businesses)
  const fetchBusinesses = useCallback(async () => {
    if (isCheckingAuth || !isAdmin) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('businesses')
      .select('id, name, vat_percentage')
      .is('deleted_at', null)
      .eq('status', 'active')
      .order('name');
    if (data && data.length > 0) {
      setBusinesses(data);
      if (!selectedBusinessId) {
        setSelectedBusinessId(data[0].id);
      }
    }
  }, [isCheckingAuth, isAdmin, selectedBusinessId, setSelectedBusinessId]);
  useEffect(() => { fetchBusinesses(); }, [fetchBusinesses]);
  // Realtime — new business added / business name changed / vat_percentage
  // edited should show up in the picker immediately.
  useMultiTableRealtime(
    ['businesses'],
    fetchBusinesses,
    !isCheckingAuth && isAdmin,
  );

  // Fetch suppliers for the selected business. Memoized so the realtime
  // subscription and window-focus handler can call it too.
  const fetchSuppliers = useCallback(async () => {
    if (!selectedBusinessId) {
      setSuppliers([]);
      setCoordinatorSuppliers([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from('suppliers')
      .select('id, name, waiting_for_coordinator, notes, default_payment_method, default_credit_card_id, default_discount_percentage, is_fixed_expense, vat_type, expense_type')
      .eq('business_id', selectedBusinessId)
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('name');
    if (data) {
      setSuppliers(data);
      setCoordinatorSuppliers(data.filter(s => s.waiting_for_coordinator === true));
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

  // Realtime: when someone creates/edits/deletes a supplier in the selected
  // business, refresh the list so the OCR form dropdown stays in sync without
  // requiring a manual page refresh.
  useMultiTableRealtime(
    ['suppliers'],
    fetchSuppliers,
    !!selectedBusinessId,
  );

  // Belt-and-suspenders: refetch when the user returns to the tab. Realtime
  // covers most cases, but if the websocket dropped while the tab was in the
  // background, this catches any suppliers created while we were away.
  useEffect(() => {
    const onFocus = () => { fetchSuppliers(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') fetchSuppliers(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchSuppliers]);

  // Select first pending document on load
  useEffect(() => {
    if (!isCheckingAuth && isAdmin) {
      const pendingDocs = documents.filter((doc) => doc.status === 'pending');
      if (pendingDocs.length > 0 && !currentDocument) {
        handleSelectDocument(pendingDocs[0]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, currentDocument, isCheckingAuth, isAdmin]);

  // Handle document selection.
  //
  // We used to flip the document from 'pending' → 'reviewing' the moment a
  // reviewer clicked on it, and also switched the sidebar filter to
  // 'reviewing' so they'd still see their working doc. That broke the
  // approve-flow: after approving the doc moved to 'approved', the filter
  // was left pointing at the now-empty 'reviewing' bucket, the selected
  // business filter appeared to reset, and the reviewer had to manually
  // switch back to 'ממתינים' every single time.
  //
  // The selection itself is already visually distinct (the card shows as
  // active), so there's no need for a separate status bucket. We now keep
  // the document on 'pending' until it's approved/rejected — the filter
  // stays on 'ממתינים' and the business filter stays intact through the
  // whole approve loop.
  const handleSelectDocument = useCallback((document: OCRDocument) => {
    setCurrentDocument(document);
    setMergedDocuments([]);
    // Auto-select the business identified by AI from the document
    if (document.business_id) {
      setSelectedBusinessId(document.business_id);
    }
  }, [setSelectedBusinessId]);

  // Per-card "✓ שייך לעסק הנבחר" handler. Reassigns the clicked document
  // (not necessarily the currently-open one) to whatever business is
  // selected in the form's top picker, so admins can claim a misrouted
  // doc without opening it first. David's request from the meeting.
  const handleConfirmBusinessForDoc = useCallback(async (document: OCRDocument) => {
    if (!selectedBusinessId) return;
    if (document.business_id === selectedBusinessId) return;
    const supabase = createClient();
    const { error } = await supabase
      .from('ocr_documents')
      .update({ business_id: selectedBusinessId, updated_at: new Date().toISOString() })
      .eq('id', document.id);
    if (error) {
      console.error('Failed to confirm business for OCR doc:', error);
      return;
    }
    setDocuments(prev => prev.map(d => d.id === document.id ? { ...d, business_id: selectedBusinessId } : d));
    if (currentDocument?.id === document.id) {
      setCurrentDocument(prev => prev ? { ...prev, business_id: selectedBusinessId } : prev);
    }
  }, [selectedBusinessId, currentDocument]);

  // Handle form approval - saves to Supabase based on document type
  const handleApprove = useCallback(
    async (formData: OCRFormData) => {
      if (!currentDocument) return;

      setIsLoading(true);
      const supabase = createClient();

      try {
        const { data: { user } } = await supabase.auth.getUser();

        const bizVatRate = Number(businesses.find(b => b.id === formData.business_id)?.vat_percentage) || 0.18;
        let supplierVatType: string | null = null;
        if (formData.supplier_id) {
          const { data: supRow } = await supabase
            .from('suppliers')
            .select('vat_type')
            .eq('id', formData.supplier_id)
            .maybeSingle();
          supplierVatType = supRow?.vat_type ?? null;
        }
        const effectiveVatRate = supplierVatType === 'none' ? 0 : bizVatRate;

        let createdInvoiceId: string | null = null;
        let createdPaymentId: string | null = null;
        let createdDeliveryNoteId: string | null = null;

        const mergedIdsForAttach = (formData.merged_document_ids || []).filter(Boolean);
        let mergedImageUrls: string[] = mergedDocuments
          .filter(d => d && d.image_url)
          .map(d => d.image_url as string);
        if (mergedIdsForAttach.length > 0 && mergedImageUrls.length !== mergedIdsForAttach.length) {
          const { data: mergedDocsFromDb } = await supabase
            .from('ocr_documents')
            .select('id, image_url')
            .in('id', mergedIdsForAttach);
          if (mergedDocsFromDb && mergedDocsFromDb.length > 0) {
            mergedImageUrls = mergedDocsFromDb
              .map(d => (d.image_url as string) || '')
              .filter(Boolean);
          }
        }
        const allImageUrls = [currentDocument.image_url, ...mergedImageUrls].filter(Boolean) as string[];
        const ocrImageUrl = allImageUrls.length === 0 ? null
          : allImageUrls.length === 1 ? allImageUrls[0]
          : JSON.stringify(allImageUrls);

        if (formData.document_type === 'invoice' || formData.document_type === 'credit_note' || formData.document_type === 'disputed_invoice') {
          let newInvoice: { id: string } | null = null;
          let invoiceError: unknown = null;
          if (formData.link_to_fixed_invoice_id) {
            const { data, error } = await supabase
              .from('invoices')
              .update({
                invoice_number: formData.document_number || null,
                invoice_date: formData.document_date,
                reference_date: formData.value_date || formData.document_date,
                discount_amount: parseFloat(formData.discount_amount || '0') || 0,
                discount_percentage: parseFloat(formData.discount_percentage || '0') || 0,
                subtotal: parseFloat(formData.amount_before_vat),
                vat_amount: parseFloat(formData.vat_amount),
                total_amount: parseFloat(formData.total_amount),
                status: formData.is_paid ? 'paid' : 'pending',
                notes: formData.notes || null,
                attachment_url: ocrImageUrl,
              })
              .eq('id', formData.link_to_fixed_invoice_id)
              .select()
              .single();
            newInvoice = data;
            invoiceError = error;
          } else {
            const isDisputed = formData.document_type === 'disputed_invoice';
            const { data, error } = await supabase
              .from('invoices')
              .insert({
                business_id: formData.business_id,
                supplier_id: formData.supplier_id,
                invoice_number: formData.document_number || null,
                invoice_date: formData.document_date,
                reference_date: formData.value_date || formData.document_date,
                discount_amount: parseFloat(formData.discount_amount || '0') || 0,
                discount_percentage: parseFloat(formData.discount_percentage || '0') || 0,
                subtotal: parseFloat(formData.amount_before_vat),
                vat_amount: parseFloat(formData.vat_amount),
                total_amount: parseFloat(formData.total_amount),
                status: isDisputed ? 'clarification' : (formData.is_paid ? 'paid' : 'pending'),
                clarification_reason: isDisputed ? (formData.dispute_reason || null) : null,
                notes: formData.notes || null,
                created_by: user?.id || null,
                invoice_type: formData.expense_type === 'goods' ? 'goods' : 'current',
                attachment_url: ocrImageUrl,
              })
              .select()
              .single();
            newInvoice = data;
            invoiceError = error;
          }

          if (invoiceError) throw invoiceError;
          createdInvoiceId = newInvoice?.id || null;

          if (formData.is_paid && newInvoice && formData.payment_methods) {
            const paymentTotal = formData.payment_methods.reduce((sum, pm) => {
              return sum + (parseFloat(pm.amount.replace(/[^\d.-]/g, '')) || 0);
            }, 0);

            const { data: newPayment, error: paymentError } = await supabase
              .from('payments')
              .insert({
                business_id: formData.business_id,
                supplier_id: formData.supplier_id,
                payment_date: formData.payment_date || formData.document_date,
                total_amount: paymentTotal || parseFloat(formData.total_amount),
                invoice_id: newInvoice.id,
                notes: formData.payment_notes || null,
                created_by: user?.id || null,
                receipt_url: ocrImageUrl,
              })
              .select()
              .single();

            if (paymentError) throw paymentError;
            createdPaymentId = newPayment?.id || null;

            if (newPayment) {
              for (const pm of formData.payment_methods) {
                const amount = parseFloat(pm.amount.replace(/[^\d.-]/g, '')) || 0;
                if (amount > 0 && pm.method) {
                  const installmentsCount = parseInt(pm.installments) || 1;
                  const creditCardId = pm.method === 'credit_card' && pm.creditCardId ? pm.creditCardId : null;

                  if (pm.customInstallments.length > 0) {
                    for (const inst of pm.customInstallments) {
                      await supabase.from('payment_splits').insert({
                        payment_id: newPayment.id,
                        payment_method: pm.method,
                        amount: inst.amount,
                        installments_count: installmentsCount,
                        installment_number: inst.number,
                        reference_number: formData.payment_reference || null,
                        // Per-installment cheque number — each cheque has its
                        // own sequential number. Fall back to the method-level
                        // value for legacy payloads.
                        check_number: inst.checkNumber || pm.checkNumber || null,
                        credit_card_id: creditCardId,
                        due_date: inst.dateForInput || formData.payment_date || formData.document_date || null,
                      });
                    }
                  } else {
                    const dueDate = formData.payment_date || formData.document_date || null;

                    await supabase.from('payment_splits').insert({
                      payment_id: newPayment.id,
                      payment_method: pm.method,
                      amount: amount,
                      installments_count: 1,
                      installment_number: 1,
                      reference_number: formData.payment_reference || null,
                      check_number: pm.checkNumber || null,
                      credit_card_id: creditCardId,
                      due_date: dueDate,
                    });
                  }
                }
              }
            }
          }

        } else if (formData.document_type === 'delivery_note') {
          const { data: newDeliveryNote, error: deliveryNoteError } = await supabase
            .from('delivery_notes')
            .insert({
              business_id: formData.business_id,
              supplier_id: formData.supplier_id,
              delivery_note_number: formData.document_number || null,
              delivery_date: formData.document_date,
              discount_amount: parseFloat(formData.discount_amount || '0') || 0,
              discount_percentage: parseFloat(formData.discount_percentage || '0') || 0,
              subtotal: parseFloat(formData.amount_before_vat),
              vat_amount: parseFloat(formData.vat_amount),
              total_amount: parseFloat(formData.total_amount),
              notes: formData.notes || null,
              is_verified: false,
              attachment_url: ocrImageUrl,
              // Audit: same as the invoice insert above — stamp the
              // approver so /expenses doesn't render "מערכת".
              created_by: user?.id || null,
            })
            .select()
            .single();

          if (deliveryNoteError) throw deliveryNoteError;
          createdDeliveryNoteId = newDeliveryNote?.id || null;

        } else if (formData.document_type === 'payment') {
          const totalAmount = formData.payment_methods
            ? formData.payment_methods.reduce((sum, pm) => sum + (parseFloat(pm.amount.replace(/[^\d.-]/g, '')) || 0), 0)
            : parseFloat(formData.total_amount);

          const selectedInvoicesArr = formData.payment_linked_invoice_ids || [];

          const { data: newPayment, error: paymentError } = await supabase
            .from('payments')
            .insert({
              business_id: formData.business_id,
              supplier_id: formData.supplier_id,
              payment_date: formData.document_date,
              total_amount: totalAmount,
              invoice_id: selectedInvoicesArr.length === 1 ? selectedInvoicesArr[0] : null,
              notes: formData.payment_notes || formData.notes || null,
              created_by: user?.id || null,
              receipt_url: ocrImageUrl,
            })
            .select()
            .single();

          if (paymentError) throw paymentError;
          if (!newPayment) throw new Error('Failed to create payment');
          if (!createdPaymentId && newPayment?.id) createdPaymentId = newPayment.id;

          if (formData.payment_methods) {
            for (const pm of formData.payment_methods) {
              const amount = parseFloat(pm.amount.replace(/[^\d.-]/g, '')) || 0;
              if (amount > 0 && pm.method) {
                const installmentsCount = parseInt(pm.installments) || 1;
                const creditCardId = pm.method === 'credit_card' && pm.creditCardId ? pm.creditCardId : null;

                if (pm.customInstallments.length > 0) {
                  for (const inst of pm.customInstallments) {
                    await supabase.from('payment_splits').insert({
                      payment_id: newPayment.id,
                      payment_method: pm.method,
                      amount: inst.amount,
                      installments_count: installmentsCount,
                      installment_number: inst.number,
                      reference_number: formData.payment_reference || null,
                      // Per-installment cheque number — each cheque has its
                      // own sequential number. Fall back to the method-level
                      // value for legacy payloads.
                      check_number: inst.checkNumber || pm.checkNumber || null,
                      credit_card_id: creditCardId,
                      due_date: inst.dateForInput || formData.document_date || null,
                    });
                  }
                } else {
                  const dueDate = formData.payment_date || formData.document_date || null;

                  await supabase.from('payment_splits').insert({
                    payment_id: newPayment.id,
                    payment_method: pm.method,
                    amount: amount,
                    installments_count: 1,
                    installment_number: 1,
                    reference_number: formData.payment_reference || null,
                    check_number: pm.checkNumber || null,
                    credit_card_id: creditCardId,
                    due_date: dueDate,
                  });
                }
              }
            }
          }

          if (selectedInvoicesArr.length > 1) {
            const { data: invDetails } = await supabase
              .from('invoices')
              .select('id, total_amount')
              .in('id', selectedInvoicesArr);
            let remaining = totalAmount;
            for (const inv of invDetails || []) {
              const allocated = Math.min(Number(inv.total_amount), remaining);
              remaining -= allocated;
              await supabase.from('payment_invoice_links').insert({
                payment_id: newPayment.id,
                invoice_id: inv.id,
                amount_allocated: allocated,
              });
            }
          }

          if (formData.payment_linked_invoice_ids && formData.payment_linked_invoice_ids.length > 0) {
            const { data: selectedInvs } = await supabase
              .from('invoices')
              .select('id, total_amount')
              .in('id', formData.payment_linked_invoice_ids);
            if (selectedInvs) {
              const invoicesTotal = selectedInvs.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
              const diff = Math.abs(invoicesTotal - totalAmount);
              if (diff <= 5) {
                await supabase
                  .from('invoices')
                  .update({ status: 'paid' })
                  .in('id', formData.payment_linked_invoice_ids);
              } else {
                const sorted = [...selectedInvs].sort((a, b) => Number(a.total_amount) - Number(b.total_amount));
                let remaining = totalAmount;
                const toMarkPaid: string[] = [];
                for (const inv of sorted) {
                  const invAmount = Number(inv.total_amount);
                  if (invAmount <= remaining + 1) {
                    toMarkPaid.push(inv.id as string);
                    remaining -= invAmount;
                  }
                }
                if (toMarkPaid.length > 0) {
                  await supabase.from('invoices').update({ status: 'paid' }).in('id', toMarkPaid);
                }
              }
            }
          }

        } else if (formData.document_type === 'summary') {
          const total = parseFloat(formData.total_amount);
          const subtotal = effectiveVatRate > 0 ? total / (1 + effectiveVatRate) : total;
          const vatAmount = total - subtotal;
          const isClosed = formData.summary_is_closed === 'yes';

          const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .insert({
              business_id: formData.business_id,
              supplier_id: formData.supplier_id,
              invoice_date: formData.document_date,
              reference_date: formData.document_date,
              invoice_number: formData.document_number,
              subtotal: subtotal,
              vat_amount: vatAmount,
              total_amount: total,
              status: isClosed ? 'pending' : 'needs_review',
              invoice_type: 'current',
              is_consolidated: true,
              notes: formData.notes || null,
              created_by: user?.id || null,
              attachment_url: ocrImageUrl,
            })
            .select()
            .single();

          if (invoiceError) throw invoiceError;
          createdInvoiceId = invoice?.id || null;

          if (formData.summary_existing_delivery_note_ids && formData.summary_existing_delivery_note_ids.length > 0 && invoice) {
            const { error: linkError } = await supabase
              .from('delivery_notes')
              .update({ invoice_id: invoice.id, is_verified: isClosed })
              .in('id', formData.summary_existing_delivery_note_ids);
            if (linkError) console.error('Error linking delivery notes:', linkError);
          }

          if (formData.summary_delivery_notes && formData.summary_delivery_notes.length > 0 && invoice) {
            const deliveryNotesData = formData.summary_delivery_notes.map(note => {
              const noteTotal = parseFloat(note.total_amount);
              const noteSubtotal = effectiveVatRate > 0 ? noteTotal / (1 + effectiveVatRate) : noteTotal;
              const noteVat = noteTotal - noteSubtotal;
              return {
                invoice_id: invoice.id,
                business_id: formData.business_id,
                supplier_id: formData.supplier_id,
                delivery_note_number: note.delivery_note_number.trim(),
                delivery_date: note.delivery_date,
                subtotal: noteSubtotal,
                vat_amount: noteVat,
                total_amount: noteTotal,
                notes: note.notes?.trim() || null,
                is_verified: isClosed,
                created_by: user?.id || null,
              };
            });

            const { error: notesError } = await supabase
              .from('delivery_notes')
              .insert(deliveryNotesData);

            if (notesError) {
              console.error('Error inserting delivery notes:', notesError);
            }
          }
        } else if (formData.document_type === 'daily_entry') {
          const { data: dailyEntry, error: dailyError } = await supabase
            .from('daily_entries')
            .insert({
              business_id: formData.business_id,
              entry_date: formData.daily_entry_date,
              total_register: parseFloat(formData.daily_total_register || '0') || 0,
              labor_cost: parseFloat(formData.daily_labor_cost || '0') || 0,
              labor_hours: parseFloat(formData.daily_labor_hours || '0') || 0,
              discounts: parseFloat(formData.daily_discounts || '0') || 0,
              day_factor: Math.min(1, Math.max(0, parseFloat(formData.daily_day_factor || '1') || 1)),
              manager_daily_cost: 0,
              created_by: user?.id || null,
            })
            .select()
            .single();

          if (dailyError) {
            if (dailyError.code === '23505') {
              alert('כבר קיים רישום לתאריך זה');
              setIsLoading(false);
              return;
            }
            throw dailyError;
          }

          const dailyEntryId = dailyEntry.id;

          if (formData.daily_income_data) {
            for (const [sourceId, data] of Object.entries(formData.daily_income_data)) {
              const amount = parseFloat(data.amount) || 0;
              const ordersCount = parseInt(data.orders_count) || 0;
              if (amount > 0 || ordersCount > 0) {
                await supabase.from('daily_income_breakdown').insert({
                  daily_entry_id: dailyEntryId,
                  income_source_id: sourceId,
                  amount,
                  orders_count: ordersCount,
                });
              }
            }
          }

          if (formData.daily_receipt_data) {
            for (const [receiptId, val] of Object.entries(formData.daily_receipt_data)) {
              const amount = parseFloat(val) || 0;
              if (amount > 0) {
                await supabase.from('daily_receipts').insert({
                  daily_entry_id: dailyEntryId,
                  receipt_type_id: receiptId,
                  amount,
                });
              }
            }
          }

          if (formData.daily_parameter_data) {
            for (const [paramId, val] of Object.entries(formData.daily_parameter_data)) {
              const value = parseFloat(val) || 0;
              if (value > 0) {
                await supabase.from('daily_parameters').insert({
                  daily_entry_id: dailyEntryId,
                  parameter_id: paramId,
                  value,
                });
              }
            }
          }

          if (formData.daily_product_usage && formData.daily_managed_products) {
            for (const product of formData.daily_managed_products) {
              const usage = formData.daily_product_usage[product.id];
              if (usage) {
                const openingStock = parseFloat(usage.opening_stock) || 0;
                const receivedQty = parseFloat(usage.received_quantity) || 0;
                const closingStock = parseFloat(usage.closing_stock) || 0;
                if (openingStock > 0 || receivedQty > 0 || closingStock > 0) {
                  const quantityUsed = openingStock + receivedQty - closingStock;
                  await supabase.from('daily_product_usage').insert({
                    daily_entry_id: dailyEntryId,
                    product_id: product.id,
                    opening_stock: openingStock,
                    received_quantity: receivedQty,
                    closing_stock: closingStock,
                    quantity: quantityUsed,
                    unit_cost_at_time: product.unit_cost,
                  });
                  await supabase.from('managed_products').update({ current_stock: closingStock }).eq('id', product.id);
                }
              }
            }
          }
        }

        if (formData.line_items && formData.line_items.length > 0 && formData.supplier_id) {
          await savePriceTrackingForLineItems(supabase, {
            businessId: formData.business_id,
            supplierId: formData.supplier_id,
            invoiceId: createdInvoiceId || null,
            ocrDocumentId: currentDocument.id,
            documentDate: formData.document_date,
            lineItems: formData.line_items,
          });
        }

        const mergedIds = formData.merged_document_ids || [];
        const { error: ocrUpdateError } = await supabase.from('ocr_documents').update({
          status: 'approved',
          reviewed_by: user?.id || null,
          reviewed_at: new Date().toISOString(),
          document_type: formData.document_type === 'summary' ? 'invoice' : formData.document_type,
          // Sync the OCR doc's business_id to whatever the reviewer picked.
          // Without this, a doc whose AI-detected business was wrong stays
          // visible under the wrong business in the per-tenant /ocr-business
          // queue even after approval. Fall back to the existing id when
          // the form didn't carry one through.
          business_id: formData.business_id || currentDocument.business_id || null,
          created_invoice_id: createdInvoiceId,
          created_payment_id: createdPaymentId,
          created_delivery_note_id: createdDeliveryNoteId,
          merged_document_ids: mergedIds.length > 0 ? mergedIds : null,
        }).eq('id', currentDocument.id);
        if (ocrUpdateError) throw ocrUpdateError;

        if (mergedIds.length > 0) {
          const { error: mergeUpdateError } = await supabase.from('ocr_documents').update({
            status: 'approved',
            reviewed_by: user?.id || null,
            reviewed_at: new Date().toISOString(),
          }).in('id', mergedIds);
          if (mergeUpdateError) throw mergeUpdateError;
        }

        // Fire-and-forget: hand the doc to the immediate-send endpoint.
        // It only emails when the business is configured for `daily`
        // frequency; weekly/monthly skip server-side and stay batched
        // through the regular cron. We don't await — the user shouldn't
        // wait for n8n on their save flow, and the cron is the safety net
        // if anything goes wrong here.
        const docIdsToSend = [currentDocument.id, ...mergedIds];
        for (const id of docIdsToSend) {
          fetch('/api/ocr/send-document-now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ocrDocumentId: id }),
          }).catch(() => { /* swallow — cron will retry */ });
        }

        alert('המסמך נקלט בהצלחה ✓');

        setMergedDocuments([]);

        const fresh = await fetchDocuments();
        const excludeIds = new Set([currentDocument.id, ...mergedIds]);
        const nextPending = fresh.find(
          (d) => d.status === 'pending' && !excludeIds.has(d.id)
        );
        if (nextPending) {
          handleSelectDocument(nextPending);
        } else {
          setCurrentDocument(null);
        }

      } catch (error) {
        console.error('Error saving document:', error);
        alert('שגיאה בשמירת המסמך — הנתונים לא נשמרו. נסה שוב.');
      } finally {
        setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentDocument, fetchDocuments, handleSelectDocument]
  );

  const handleReject = useCallback(
    async (documentId: string, reason?: string) => {
      setIsLoading(true);

      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        const { error } = await supabase.from('ocr_documents').update({
          status: 'archived',
          reviewed_by: user?.id || null,
          reviewed_at: new Date().toISOString(),
          rejection_reason: reason || null,
        }).eq('id', documentId);

        if (error) throw error;

        const fresh = await fetchDocuments();
        const nextPending = fresh.find(
          (d) => d.status === 'pending' && d.id !== documentId
        );
        if (nextPending) {
          handleSelectDocument(nextPending);
        } else {
          setCurrentDocument(null);
        }
      } catch (error) {
        console.error('Error rejecting document:', error);
        alert('שגיאה בדחיית המסמך');
      } finally {
        setIsLoading(false);
      }
    },
    [fetchDocuments, handleSelectDocument]
  );

  const handleDelete = useCallback(
    async (documentId: string) => {
      setIsLoading(true);
      try {
        const supabase = createClient();
        const { error } = await supabase.from('ocr_documents').delete().eq('id', documentId);
        if (error) throw error;

        const fresh = await fetchDocuments();
        const nextPending = fresh.find(
          (d) => d.status === 'pending' && d.id !== documentId
        );
        if (nextPending) {
          handleSelectDocument(nextPending);
        } else {
          setCurrentDocument(null);
        }
      } catch (error) {
        console.error('Error deleting document:', error);
        alert('שגיאה במחיקת המסמך');
      } finally {
        setIsLoading(false);
      }
    },
    [fetchDocuments, handleSelectDocument]
  );

  const handleSkip = useCallback(() => {
    if (!currentDocument) return;

    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === currentDocument.id ? { ...doc, status: 'pending' as DocumentStatus } : doc
      )
    );

    const supabase = createClient();
    supabase.from('ocr_documents').update({ status: 'pending' }).eq('id', currentDocument.id);

    const pendingDocs = documents.filter(
      (doc) => doc.status === 'pending' && doc.id !== currentDocument.id
    );
    if (pendingDocs.length > 0) {
      setCurrentDocument(pendingDocs[0]);
    }
  }, [currentDocument, documents]);

  // Crop → re-OCR via Mistral pipeline. Same response contract as the legacy
  // Google route, so all downstream behavior (form refresh, supplier match,
  // line items) works unchanged.
  const handleCrop = useCallback(async (croppedImageDataUrl: string) => {
    if (!currentDocument) return;
    showToast("שומר חיתוך ומריץ OCR מחדש...", "info");

    try {
      const blobRes = await fetch(croppedImageDataUrl);
      const blob = await blobRes.blob();
      const fileName = `cropped-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const storagePath = `cropped/${fileName}`;
      const file = new File([blob], fileName, { type: "image/jpeg" });

      const uploadRes = await uploadFile(file, storagePath, "ocr-documents");
      if (!uploadRes.success || !uploadRes.publicUrl) {
        throw new Error(uploadRes.error || "שגיאה בהעלאת הקובץ החתוך");
      }
      const newImageUrl = uploadRes.publicUrl;

      let extracted: Record<string, unknown> | null = null;
      try {
        const ocrFormData = new FormData();
        ocrFormData.append("file", file);
        const ocrRes = await fetch("/api/ai/ocr-extract-mistral", { method: "POST", body: ocrFormData });
        if (ocrRes.ok) {
          extracted = await ocrRes.json();
        }
      } catch (ocrErr) {
        console.error("[Crop] Mistral re-OCR failed (non-fatal):", ocrErr);
      }
      const newRawText = typeof extracted?.raw_text === "string" ? (extracted.raw_text as string) : null;

      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("ocr_documents")
        .update({ image_url: newImageUrl, image_storage_path: storagePath, file_type: "image", updated_at: new Date().toISOString() })
        .eq("id", currentDocument.id);
      if (updateErr) throw updateErr;

      if (extracted) {
        const { data: existing } = await supabase
          .from("ocr_extracted_data")
          .select("id")
          .eq("document_id", currentDocument.id)
          .maybeSingle();
        const extractedRow: Record<string, unknown> = {
          raw_text: newRawText,
          supplier_name: extracted.supplier_name ?? null,
          document_number: extracted.document_number ?? null,
          document_date: extracted.document_date ?? null,
          subtotal: extracted.subtotal ?? null,
          vat_amount: extracted.vat_amount ?? null,
          total_amount: extracted.total_amount ?? null,
          discount_amount: extracted.discount_amount ?? null,
          discount_percentage: extracted.discount_percentage ?? null,
          line_items: extracted.line_items ?? null,
          is_credit_note: extracted.is_credit_note ?? null,
        };
        if (existing?.id) {
          await supabase.from("ocr_extracted_data").update(extractedRow).eq("id", existing.id);
        } else {
          await supabase.from("ocr_extracted_data").insert({ document_id: currentDocument.id, ...extractedRow });
        }
      }

      const newOcrData = extracted ? { ...(currentDocument.ocr_data || {}), ...extracted } : (currentDocument.ocr_data || {});
      setDocuments((prev) => prev.map((doc) => doc.id === currentDocument.id ? {
        ...doc,
        image_url: newImageUrl,
        ocr_data: newOcrData,
      } : doc));
      setCurrentDocument((prev) => prev ? {
        ...prev,
        image_url: newImageUrl,
        ocr_data: newOcrData,
      } : null);

      showToast(extracted ? "חיתוך נשמר ו-OCR חודש בהצלחה" : "חיתוך נשמר (OCR נכשל — נסה ידנית)", extracted ? "success" : "warning");
    } catch (err) {
      console.error("[Crop] Save failed:", err);
      showToast(err instanceof Error ? err.message : "שגיאה בשמירת החיתוך", "error");
    }
  }, [currentDocument, showToast]);

  // Re-run OCR extraction on the existing image. Same Mistral pipeline as
  // crop, but we feed it the *current* image_url instead of a fresh crop —
  // useful when first pass missed line items or got numbers wrong, and the
  // user wants to retry without modifying the image. The model is partially
  // non-deterministic (temperature, ordering of OCR text) so a re-run can
  // produce different (often better) results, especially after we've tuned
  // the prompt.
  const [isReExtracting, setIsReExtracting] = useState(false);
  const handleReExtract = useCallback(async () => {
    if (!currentDocument || isReExtracting) return;
    if (!currentDocument.image_url) {
      showToast("אין תמונה למסמך זה — לא ניתן להריץ OCR מחדש", "error");
      return;
    }
    setIsReExtracting(true);
    showToast("מריץ OCR מחדש...", "info");
    try {
      // Fetch the existing image as a Blob so we can POST it like a fresh upload.
      // The Mistral endpoint expects multipart/form-data with a `file` field.
      const imgRes = await fetch(currentDocument.image_url);
      if (!imgRes.ok) throw new Error("לא ניתן לטעון את תמונת המסמך");
      const blob = await imgRes.blob();
      // Pick a sensible filename + content-type. PDFs need to keep their MIME
      // so Mistral picks the document_url path (PDFs go through Mistral file
      // upload), images go through the inline base64 path.
      const isPdf = (currentDocument.file_type || "").toLowerCase().includes("pdf")
        || currentDocument.image_url.toLowerCase().includes(".pdf");
      const ext = isPdf ? "pdf" : "jpg";
      const mime = isPdf ? "application/pdf" : (blob.type || "image/jpeg");
      const file = new File([blob], `re-extract-${Date.now()}.${ext}`, { type: mime });

      const ocrFormData = new FormData();
      ocrFormData.append("file", file);
      const ocrRes = await fetch("/api/ai/ocr-extract-mistral", { method: "POST", body: ocrFormData });
      if (!ocrRes.ok) {
        const errBody = await ocrRes.json().catch(() => ({}));
        throw new Error(errBody.error || `OCR נכשל (${ocrRes.status})`);
      }
      const extracted = await ocrRes.json();
      const newRawText = typeof extracted?.raw_text === "string" ? extracted.raw_text : null;

      const supabase = createClient();
      const { data: existing } = await supabase
        .from("ocr_extracted_data")
        .select("id")
        .eq("document_id", currentDocument.id)
        .maybeSingle();
      // Write the fresh extraction to BOTH the legacy fields and the mistral_*
      // fields. fetchDocuments prefers mistral_* when mistral_processed_at is
      // set, so we update those too — otherwise a re-run on a doc that was
      // originally Mistral-processed wouldn't show the new values in the UI.
      const nowIso = new Date().toISOString();
      const extractedRow: Record<string, unknown> = {
        raw_text: newRawText,
        supplier_name: extracted.supplier_name ?? null,
        document_number: extracted.document_number ?? null,
        document_date: extracted.document_date ?? null,
        subtotal: extracted.subtotal ?? null,
        vat_amount: extracted.vat_amount ?? null,
        total_amount: extracted.total_amount ?? null,
        discount_amount: extracted.discount_amount ?? null,
        discount_percentage: extracted.discount_percentage ?? null,
        line_items: extracted.line_items ?? null,
        is_credit_note: extracted.is_credit_note ?? null,
        // Mirror to mistral_* so the UI's "prefer mistral" read path picks it up.
        mistral_supplier_name: extracted.supplier_name ?? null,
        mistral_document_number: extracted.document_number ?? null,
        mistral_document_date: extracted.document_date ?? null,
        mistral_subtotal: extracted.subtotal ?? null,
        mistral_vat_amount: extracted.vat_amount ?? null,
        mistral_total_amount: extracted.total_amount ?? null,
        mistral_line_items: extracted.line_items ?? null,
        mistral_markdown: newRawText,
        mistral_matched_supplier_id: extracted.matched_supplier_id ?? null,
        mistral_processed_at: nowIso,
      };
      if (existing?.id) {
        await supabase.from("ocr_extracted_data").update(extractedRow).eq("id", existing.id);
      } else {
        await supabase.from("ocr_extracted_data").insert({ document_id: currentDocument.id, ...extractedRow });
      }

      const newOcrData = { ...(currentDocument.ocr_data || {}), ...extracted };
      setDocuments((prev) => prev.map((doc) => doc.id === currentDocument.id ? { ...doc, ocr_data: newOcrData } : doc));
      setCurrentDocument((prev) => prev ? { ...prev, ocr_data: newOcrData } : null);

      showToast("OCR הסתיים — בדוק שהנתונים נכונים", "success");
    } catch (err) {
      console.error("[Re-extract] Failed:", err);
      showToast(err instanceof Error ? err.message : "שגיאה בהרצת OCR מחדש", "error");
    } finally {
      setIsReExtracting(false);
    }
  }, [currentDocument, isReExtracting, showToast]);

  const pendingCount = documents.filter((doc) => doc.status === 'pending').length;

  if (isCheckingAuth) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-60px)] bg-[#0a0d1f]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-white/20 border-t-white/60 rounded-full animate-spin" />
          <span className="text-white/60">טוען...</span>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-60px)] bg-[#0a0d1f]">
        <div className="flex flex-col items-center gap-4 text-white/60">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <p className="text-lg">אין לך הרשאה לצפות בדף זה</p>
          <p className="text-sm">מפנה לדף הבית...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] bg-[#0a0d1f]">
      {/* Page header - mobile only */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0F1535] border-b border-[#4C526B]">
        <h1 className="text-[18px] font-bold text-white">קליטת מסמכים OCR</h1>
        <span className="text-[14px] text-white/60">
          {pendingCount} ממתינים
        </span>
      </div>

      {/* Mobile tabs */}
      <div className="lg:hidden flex border-b border-[#4C526B]">
        <Button
          onClick={() => setShowMobileViewer(true)}
          className={`flex-1 py-3 text-[14px] font-medium transition-colors ${
            showMobileViewer
              ? 'text-white border-b-2 border-[#29318A]'
              : 'text-white/50 border-b-2 border-transparent'
          }`}
        >
          תמונת מסמך
        </Button>
        <Button
          onClick={() => setShowMobileViewer(false)}
          className={`flex-1 py-3 text-[14px] font-medium transition-colors ${
            !showMobileViewer
              ? 'text-white border-b-2 border-[#29318A]'
              : 'text-white/50 border-b-2 border-transparent'
          }`}
        >
          פרטי מסמך
        </Button>
      </div>

      {/* Main content area - 3 columns on desktop (RTL: DOM order = visual right-to-left) */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        {/* Document Queue - Right side (desktop) */}
        <div
          id="onboarding-ocr-queue"
          className="hidden lg:flex lg:flex-col min-h-0 lg:border-l border-[#4C526B] lg:relative lg:flex-shrink-0"
          style={isLgScreen ? { width: `${queueWidth}px` } : undefined}
        >
          <OCRQueueResizer width={queueWidth} onWidthChange={setQueueWidth} />
          {isInitialLoad ? (
            <OCRQueueSkeleton vertical />
          ) : (
            <DocumentQueue
              documents={documents}
              currentDocumentId={currentDocument?.id || null}
              onSelectDocument={handleSelectDocument}
              filterStatus={filterStatus}
              onFilterChange={setFilterStatus}
              vertical={true}
              businesses={businesses}
              businessFilter={businessFilter}
              onBusinessFilterChange={setBusinessFilter}
              targetBusinessId={selectedBusinessId}
              onConfirmBusiness={handleConfirmBusinessForDoc}
            />
          )}
        </div>

        {/* Document Viewer - Center (desktop) / Tab 1 (mobile) */}
        <div
          id="onboarding-ocr-upload"
          className={`lg:flex-1 lg:block ${
            showMobileViewer ? 'flex-1' : 'hidden'
          }`}
          style={{ minHeight: 0, overflow: 'hidden', height: '100%' }}
        >
          {isInitialLoad ? (
            <OCRViewerSkeleton />
          ) : currentDocument ? (
            <DocumentViewer
              key={currentDocument.image_url + mergedDocuments.map(d => d.id).join(',')}
              imageUrl={currentDocument.image_url}
              imageUrls={[currentDocument.image_url, ...mergedDocuments.map(d => d.image_url)]}
              fileType={currentDocument.file_type}
              onCrop={handleCrop}
              onReExtract={handleReExtract}
              isReExtracting={isReExtracting}
              showCalculator={showCalculator}
              onCalculatorToggle={() => setShowCalculator(v => !v)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-white/60 px-6">
              <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <p className="mt-4 text-lg">אין מסמך להצגה</p>
              <p className="mt-1 text-sm">בחר מסמך מהתור</p>
            </div>
          )}
        </div>

        {/* OCR Form - Left side (desktop) / Tab 2 (mobile) */}
        <div
          id="onboarding-ocr-form"
          className={`lg:block ${
            !showMobileViewer ? 'flex-1' : 'hidden'
          } lg:border-r border-[#4C526B] overflow-hidden lg:relative lg:flex-shrink-0`}
          style={isLgScreen ? { width: `${formWidth}px` } : undefined}
        >
          <OCRFormResizer width={formWidth} onWidthChange={setFormWidth} />
          {isInitialLoad ? (
            <OCRFormSkeleton />
          ) : (
            <OCRForm
              key={currentDocument?.id || 'no-doc'}
              document={currentDocument}
              suppliers={suppliers}
              coordinatorSuppliers={coordinatorSuppliers}
              businesses={businesses}
              selectedBusinessId={selectedBusinessId}
              onBusinessChange={handleBusinessChange}
              onApprove={handleApprove}
              onReject={handleReject}
              onDelete={handleDelete}
              onSkip={handleSkip}
              isLoading={isLoading}
              showCalculator={showCalculator}
              onCalculatorToggle={() => setShowCalculator(v => !v)}
              mergedDocuments={mergedDocuments}
              pendingDocuments={documents.filter(d => {
                if (d.status !== 'pending') return false;
                const targetBiz = currentDocument?.business_id || selectedBusinessId;
                return !d.business_id || !targetBiz || d.business_id === targetBiz;
              })}
              onMergeDocuments={setMergedDocuments}
              onRequestAddSupplier={
                selectedBusinessId
                  ? () => setShowQuickAddSupplier(true)
                  : undefined
              }
              pendingSupplierToSelect={pendingSupplierToSelect}
              onSupplierAutoSelected={() => setPendingSupplierToSelect(null)}
            />
          )}
        </div>
      </div>

      {/* Quick add supplier — opened from inside OCRForm via the
          "+ הוספת ספק חדש" link. After save we refresh the supplier list
          and stash the new id in pendingSupplierToSelect; the form picks
          it up the moment the suppliers prop contains the new row. */}
      <QuickAddSupplierModal
        open={showQuickAddSupplier}
        onOpenChange={setShowQuickAddSupplier}
        businessId={selectedBusinessId}
        initialName={currentDocument?.ocr_data?.supplier_name}
        initialTaxId={currentDocument?.ocr_data?.supplier_tax_id}
        onCreated={async (newSupplierId) => {
          await fetchSuppliers();
          setPendingSupplierToSelect(newSupplierId);
        }}
      />

      {/* Document Queue - Bottom (mobile only) */}
      <div className="lg:hidden">
        {isInitialLoad ? (
          <OCRQueueSkeleton vertical={false} />
        ) : (
          <DocumentQueue
            documents={documents}
            currentDocumentId={currentDocument?.id || null}
            onSelectDocument={handleSelectDocument}
            filterStatus={filterStatus}
            onFilterChange={setFilterStatus}
            vertical={false}
            businesses={businesses}
            businessFilter={businessFilter}
            onBusinessFilterChange={setBusinessFilter}
            targetBusinessId={selectedBusinessId}
            onConfirmBusiness={handleConfirmBusinessForDoc}
          />
        )}
      </div>
    </div>
  );
}
