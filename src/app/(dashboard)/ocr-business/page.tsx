'use client';

/**
 * OCR — Per-business portal
 *
 * Same Mistral pipeline as /ocr, but scoped strictly to the businesses the
 * user has currently selected in the dashboard's business switcher (or the
 * single business they're a member of). The admin /ocr page is the only
 * place that shows the full cross-business queue. This page MUST never leak
 * a document from a business the user didn't pick.
 *
 * Access gate: must be admin OR a member of at least one of the businesses
 * in the layout-allowlist (currently OUSHI). Otherwise redirected to /.
 */

// Businesses that may use this per-tenant portal. Membership in at least one
// of these is required for non-admins. Add another business id here to
// extend access.
const ALLOWED_BUSINESS_IDS = ['bcd1d49d-1fb7-4f50-b202-e8eae1d9fe70'];

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '../layout';
import { createClient } from '@/lib/supabase/client';
import DocumentViewer from '@/components/ocr/DocumentViewer';
import OCRForm from '@/components/ocr/OCRForm';
import DocumentQueue from '@/components/ocr/DocumentQueue';
import OCRFormResizer from '@/components/ocr/OCRFormResizer';
import OCRQueueResizer from '@/components/ocr/OCRQueueResizer';
import { OCRQueueSkeleton, OCRViewerSkeleton, OCRFormSkeleton } from '@/components/ocr/OCRSkeletons';
import { useMultiTableRealtime } from '@/hooks/useRealtimeSubscription';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { OCRDocument, OCRFormData, DocumentStatus, OCRExtractedData, DocumentType } from '@/types/ocr';
import { Button } from "@/components/ui/button";
import { savePriceTrackingForLineItems } from '@/lib/priceTracking';
import { fireBudgetAlert } from '@/lib/budget-alert';
import { uploadFile } from '@/lib/uploadFile';
import { useToast } from "@/components/ui/toast";
import ScannedDocumentsButton from '@/components/ocr/ScannedDocumentsButton';

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
  // false = opt out of line-item price tracking; null/undefined treated as true
  track_prices?: boolean;
}

export default function OCRBusinessPage() {
  const router = useRouter();
  const { isAdmin, selectedBusinesses, isProfileLoading } = useDashboard();
  const { showToast } = useToast();
  // Three access modes:
  // - hasFullAccess: admin OR member of an ALLOWED business (currently
  //   only OUSHI). Full UI, can approve/reject/delete.
  // - isPreviewMode: signed-in user with a non-allowed business selected.
  //   The page renders with their own data (queue + viewer + form) but
  //   blurred behind an overlay so they can see the feature exists. No
  //   ability to interact — the overlay swallows clicks.
  // - no access: not signed in / no business selected → handled by the
  //   layout's middleware. We don't redirect from this page anymore.
  const hasFullAccess = isAdmin || selectedBusinesses.some((id) => ALLOWED_BUSINESS_IDS.includes(id));
  const isPreviewMode = !hasFullAccess && selectedBusinesses.length > 0;
  const hasAccess = hasFullAccess || isPreviewMode;

  // State - ALL hooks must be declared before any conditional returns
  const [documents, setDocuments] = useState<OCRDocument[]>([]);
  // Mirror of `documents` for reading the latest list inside async handlers
  // without capturing a stale closure (handlers run many awaits before they
  // touch the list, during which realtime may have changed it).
  const documentsRef = useRef<OCRDocument[]>([]);
  useEffect(() => { documentsRef.current = documents; }, [documents]);
  const [currentDocument, setCurrentDocument] = useState<OCRDocument | null>(null);
  const [filterStatus, setFilterStatus] = usePersistedState<DocumentStatus | 'all'>('ocr-business:filterStatus', 'pending');
  // No business filter on this page — the document scope is already
  // restricted to selectedBusinesses and the per-tenant allowlist, so a
  // "filter by business" dropdown would be redundant. The DocumentQueue
  // hides the filter UI when onBusinessFilterChange isn't provided.

  useEffect(() => {
    if (filterStatus === 'reviewing') setFilterStatus('pending');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  // Tracks the very first fetch — render skeletons until data arrives.
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showMobileViewer, setShowMobileViewer] = useState(true);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [showCalculator, setShowCalculator] = useState(false);
  const [mergedDocuments, setMergedDocuments] = useState<OCRDocument[]>([]);
  // Resizable form panel — same key as /ocr so a reviewer's preferred width
  // carries across both pages.
  const [formWidth, setFormWidth] = usePersistedState<number>('ocr:formWidth', 420);
  // Queue panel width — shared key with /ocr for consistency across pages.
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
    // Per-tenant scope: ONLY documents from currently-selected businesses.
    // The admin /ocr page sees the cross-business queue; here we strictly
    // never query another business. If nothing is selected, return empty.
    // We rely on Supabase RLS to ensure the user can only read documents
    // for businesses they are a member of — preview mode shows their
    // *own* business's data (blurred), not OUSHI's.
    const visibleBusinessIds = selectedBusinesses;
    if (visibleBusinessIds.length === 0) {
      setDocuments([]);
      setIsInitialLoad(false);
      return [];
    }
    // The queue only ever renders status='pending' docs. Approved/archived
    // docs are never shown, so fetching them on every action re-pulled the
    // whole table per business. Scope to pending only — UI unchanged.
    const { data, error } = await supabase
      .from('ocr_documents')
      .select('*, ocr_extracted_data(*, ocr_extracted_line_items(*))')
      .in('business_id', visibleBusinessIds)
      .eq('status', 'pending')
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

        // Demo page reads MISTRAL columns first, falls back to Google Vision values
        // only if Mistral hasn't processed this doc yet. The line items come from
        // the JSONB mistral_line_items field (stored by Save Mistral Data) when
        // available, otherwise from the legacy ocr_extracted_line_items relation.
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
  }, [selectedBusinesses]);

  // Business and supplier state
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState('ocr-business:businessId', '');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [coordinatorSuppliers, setCoordinatorSuppliers] = useState<Supplier[]>([]);

  // "+ הוספת ספק חדש" — when /suppliers routes back with ?supplierAdded=<id>
  // we stash the new id here so OCRForm auto-selects it as soon as it
  // appears in the suppliers prop. Same pattern as the admin /ocr page.
  const [pendingSupplierToSelect, setPendingSupplierToSelect] = useState<string | null>(null);

  // Wait for the profile fetch in the dashboard layout before evaluating
  // access; a fixed 500ms timeout used to race the fetch and bounce users
  // back to "/" when the profile arrived late.
  useEffect(() => {
    if (!isProfileLoading) {
      setIsCheckingAuth(false);
    }
  }, [isProfileLoading]);

  useEffect(() => {
    if (!isCheckingAuth && !hasAccess) {
      router.replace('/');
    }
  }, [hasAccess, isCheckingAuth, router]);

  useEffect(() => {
    if (!isCheckingAuth && hasAccess) {
      fetchDocuments();
    }
  }, [isCheckingAuth, hasAccess, fetchDocuments]);

  // Debounced realtime refetch: a save touches both ocr_documents and
  // ocr_extracted_data, firing two events that would otherwise each trigger a
  // full refetch and race the optimistic local-state updates. Coalesce to one
  // refetch ~400ms after the last event — new docs still appear, mutations stay
  // snappy.
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedFetchDocuments = useCallback(() => {
    if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
    realtimeDebounceRef.current = setTimeout(() => {
      fetchDocuments();
    }, 400);
  }, [fetchDocuments]);
  useEffect(() => () => {
    if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
  }, []);
  useMultiTableRealtime(
    ['ocr_documents', 'ocr_extracted_data'],
    debouncedFetchDocuments,
    !isCheckingAuth && hasAccess
  );

  // Per-tenant scope: only currently-selected businesses appear in the
  // picker. The OCR form uses this picker to know which business to write
  // the new invoice/payment under, so it must mirror selectedBusinesses
  // exactly. Default selectedBusinessId to the first available so the
  // form has a valid target without the user having to pick.
  const fetchBusinesses = useCallback(async () => {
    if (isCheckingAuth || !hasAccess) return;
    const supabase = createClient();
    // Match fetchDocuments scope: list all currently-selected businesses,
    // RLS keeps the user from seeing anything they aren't a member of.
    const visibleBusinessIds = selectedBusinesses;
    if (visibleBusinessIds.length === 0) {
      setBusinesses([]);
      return;
    }
    const { data } = await supabase
      .from('businesses')
      .select('id, name, vat_percentage')
      .in('id', visibleBusinessIds)
      .is('deleted_at', null)
      .eq('status', 'active')
      .order('name');
    if (data && data.length > 0) {
      setBusinesses(data);
      // Re-pin selectedBusinessId if it points outside the current scope
      // (e.g. user switched businesses in the global switcher).
      if (!selectedBusinessId || !visibleBusinessIds.includes(selectedBusinessId)) {
        setSelectedBusinessId(data[0].id);
      }
    }
  }, [isCheckingAuth, hasAccess, selectedBusinesses, selectedBusinessId, setSelectedBusinessId]);
  useEffect(() => { fetchBusinesses(); }, [fetchBusinesses]);
  useMultiTableRealtime(
    ['businesses'],
    fetchBusinesses,
    !isCheckingAuth && hasAccess,
  );

  const fetchSuppliers = useCallback(async () => {
    if (!selectedBusinessId) {
      setSuppliers([]);
      setCoordinatorSuppliers([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from('suppliers')
      .select('id, name, waiting_for_coordinator, notes, default_payment_method, default_credit_card_id, default_discount_percentage, is_fixed_expense, vat_type, expense_type, track_prices, payment_terms_days')
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

  // Catch the return-trip from /suppliers (?supplierAdded=<id>). Mirrors the
  // admin /ocr flow — after a new supplier is created we refresh the list and
  // stash the new id in pendingSupplierToSelect so OCRForm auto-selects it.
  const consumedSupplierAddedRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (consumedSupplierAddedRef.current) return;
    if (!selectedBusinessId) return; // wait for persisted state to hydrate
    const params = new URLSearchParams(window.location.search);
    const addedId = params.get("supplierAdded");
    if (!addedId) return;
    consumedSupplierAddedRef.current = true;
    window.history.replaceState({}, "", "/ocr-business");
    fetchSuppliers().then(() => setPendingSupplierToSelect(addedId));
  }, [selectedBusinessId, fetchSuppliers]);

  useMultiTableRealtime(
    ['suppliers'],
    fetchSuppliers,
    !!selectedBusinessId,
  );

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

  useEffect(() => {
    if (!isCheckingAuth && hasAccess) {
      const pendingDocs = documents.filter((doc) => doc.status === 'pending');
      if (pendingDocs.length > 0 && !currentDocument) {
        handleSelectDocument(pendingDocs[0]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, currentDocument, isCheckingAuth, hasAccess]);

  const handleSelectDocument = useCallback((document: OCRDocument) => {
    setCurrentDocument(document);
    setMergedDocuments([]);
    // Sync the form-target business to whichever business the doc belongs
    // to. Safe: fetchDocuments only returns docs from selectedBusinesses,
    // so document.business_id is always within scope.
    if (document.business_id) {
      setSelectedBusinessId(document.business_id);
    }
  }, [setSelectedBusinessId]);

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

        // ── ATTACH-TO-EXISTING ─────────────────────────────────────────────
        // When the user chose "צרף דף לחשבונית הקיימת" from the duplicate
        // banner, append the current image to the existing row's attachment_url
        // and link the OCR doc to it. No new invoice/delivery_note is created.
        if (formData.attach_to_existing_id && formData.attach_to_existing_kind) {
          const targetTable = formData.attach_to_existing_kind === 'delivery_note' ? 'delivery_notes' : 'invoices';
          const { data: existingRow } = await supabase
            .from(targetTable)
            .select('id, attachment_url')
            .eq('id', formData.attach_to_existing_id)
            .maybeSingle();
          if (!existingRow) throw new Error('המסמך הקיים לצירוף לא נמצא');

          const existingUrls: string[] = (() => {
            const raw = (existingRow as { attachment_url: string | null }).attachment_url;
            if (!raw) return [];
            const trimmed = raw.trim();
            if (trimmed.startsWith('[')) {
              try {
                const parsed = JSON.parse(trimmed);
                return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : [raw];
              } catch { return [raw]; }
            }
            return [raw];
          })();
          const combined = Array.from(new Set([...existingUrls, ...allImageUrls]));
          const combinedAttachmentUrl = combined.length === 0 ? null
            : combined.length === 1 ? combined[0]
            : JSON.stringify(combined);

          const { error: attachUpdateError } = await supabase
            .from(targetTable)
            .update({ attachment_url: combinedAttachmentUrl })
            .eq('id', formData.attach_to_existing_id);
          if (attachUpdateError) throw attachUpdateError;

          if (formData.attach_to_existing_kind === 'delivery_note') {
            createdDeliveryNoteId = formData.attach_to_existing_id;
          } else {
            createdInvoiceId = formData.attach_to_existing_id;

            // Mirror of the same fix in /ocr/page.tsx — when the user marks
            // the OCR doc as paid AND chose "attach to existing", create the
            // payment + payment_splits and flip the existing invoice to
            // status=paid. Without this the image lands on the row but the
            // payment never exists in /payments.
            if (formData.is_paid && formData.payment_methods && formData.payment_methods.length > 0) {
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
                  invoice_id: formData.attach_to_existing_id,
                  notes: formData.payment_notes || null,
                  created_by: user?.id || null,
                  receipt_url: ocrImageUrl,
                })
                .select()
                .single();

              if (paymentError) {
                console.error('[OCR Business Approve] attach+pay: payment insert failed:', paymentError);
                throw paymentError;
              }
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

              const { error: statusError } = await supabase
                .from('invoices')
                .update({ status: 'paid' })
                .eq('id', formData.attach_to_existing_id);
              if (statusError) {
                console.error('[OCR Business Approve] attach+pay: invoice status update failed:', statusError);
              }
            }
          }
        } else if (formData.document_type === 'invoice' || formData.document_type === 'credit_note' || formData.document_type === 'disputed_invoice') {
          let newInvoice: { id: string } | null = null;
          let invoiceError: unknown = null;
          if (formData.link_to_fixed_invoice_id) {
            // Multi-month link mode — see /ocr/page.tsx for the full rationale.
            // The primary placeholder gets its own allocated subtotal slice;
            // each extra placeholder gets the same attachment + invoice_number
            // and its own slice, with vat/total scaled proportionally.
            const extras = formData.link_to_fixed_invoice_extras || [];
            const docTotalAmount = parseFloat(formData.total_amount);
            const docSubtotal = parseFloat(formData.amount_before_vat);
            const docVat = parseFloat(formData.vat_amount);
            const totalRatio = docSubtotal > 0 ? docTotalAmount / docSubtotal : 1;
            const vatRatio = docSubtotal > 0 ? docVat / docSubtotal : 0;
            const primarySubtotal = extras.length > 0 && typeof formData.fixed_invoice_primary_subtotal === 'number'
              ? formData.fixed_invoice_primary_subtotal
              : docSubtotal;
            const primaryVat = extras.length > 0 ? primarySubtotal * vatRatio : docVat;
            const primaryTotal = extras.length > 0 ? primarySubtotal * totalRatio : docTotalAmount;
            // Per-month date override — see /ocr/page.tsx for full rationale.
            const primaryDate = (extras.length > 0 && formData.fixed_invoice_primary_date)
              ? formData.fixed_invoice_primary_date
              : null;
            const { data, error } = await supabase
              .from('invoices')
              .update({
                invoice_number: formData.document_number || null,
                invoice_date: primaryDate || formData.document_date,
                reference_date: formData.value_date || primaryDate || formData.document_date,
                discount_amount: parseFloat(formData.discount_amount || '0') || 0,
                discount_percentage: parseFloat(formData.discount_percentage || '0') || 0,
                subtotal: primarySubtotal,
                vat_amount: primaryVat,
                total_amount: primaryTotal,
                status: formData.is_paid ? 'paid' : 'pending',
                notes: formData.notes || null,
                attachment_url: ocrImageUrl,
              })
              .eq('id', formData.link_to_fixed_invoice_id)
              .select()
              .single();
            newInvoice = data;
            invoiceError = error;

            if (!error && extras.length > 0) {
              for (const extra of extras) {
                const exSubtotal = Number(extra.subtotal) || 0;
                const exVat = exSubtotal * vatRatio;
                const exTotal = exSubtotal * totalRatio;
                const exDate = extra.reference_date || null;
                const update: Record<string, unknown> = {
                  invoice_number: formData.document_number || null,
                  subtotal: exSubtotal,
                  vat_amount: exVat,
                  total_amount: exTotal,
                  status: formData.is_paid ? 'paid' : 'pending',
                  notes: formData.notes || null,
                  attachment_url: ocrImageUrl,
                };
                if (exDate) {
                  // exDate sets the month (invoice_date); keep reference_date
                  // (תאריך ערך) as the form's value_date so they stay independent.
                  update.invoice_date = exDate;
                  update.reference_date = formData.value_date || exDate;
                }
                const { error: exError } = await supabase
                  .from('invoices')
                  .update(update)
                  .eq('id', extra.invoice_id);
                if (exError) {
                  console.error('[OCR Business Approve] extra fixed-invoice update failed:', extra.invoice_id, exError);
                }
              }
            }
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

          // Budget-overage alert (fire-and-forget). Skipped for
          // `link_to_fixed_invoice_id` because that path doesn't add new
          // monthly spend, it just back-fills an existing placeholder.
          if (newInvoice && !formData.link_to_fixed_invoice_id) {
            fireBudgetAlert({
              businessId: formData.business_id,
              supplierId: formData.supplier_id,
              invoiceSubtotal: formData.amount_before_vat,
            });
          }

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
              // Audit trail: stamp who clicked "אישור וקליטה" so the
              // expense list can show the real reviewer instead of
              // falling back to "מערכת". Aligned with the invoice +
              // payment inserts a few lines below which were already
              // setting created_by.
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
              reference_date: formData.value_date || formData.document_date,
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

          // Budget-overage alert for markezet/summary invoices too.
          if (invoice) {
            fireBudgetAlert({
              businessId: formData.business_id,
              supplierId: formData.supplier_id,
              invoiceSubtotal: subtotal,
            });
          }

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
          // Skip price tracking when the supplier has opted out (track_prices=false).
          const trackPricesSupplier = suppliers.find(s => s.id === formData.supplier_id);
          const shouldTrackPrices = trackPricesSupplier?.track_prices !== false;
          if (shouldTrackPrices) {
            await savePriceTrackingForLineItems(supabase, {
              businessId: formData.business_id,
              supplierId: formData.supplier_id,
              invoiceId: createdInvoiceId || null,
              ocrDocumentId: currentDocument.id,
              documentDate: formData.document_date,
              lineItems: formData.line_items,
            });
          }
        }

        const mergedIds = formData.merged_document_ids || [];
        const { error: ocrUpdateError } = await supabase.from('ocr_documents').update({
          status: 'approved',
          reviewed_by: user?.id || null,
          reviewed_at: new Date().toISOString(),
          document_type: formData.document_type === 'summary' ? 'invoice' : formData.document_type,
          // Mirror /ocr/page.tsx — sync business_id to whatever the form
          // carried so AI-misclassified docs land under the corrected
          // business in archive/approved views.
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

        // The approved doc (and any merged-in docs) left the pending queue —
        // remove them from local state instead of re-pulling the whole table.
        // Read from the ref to avoid a stale closure after the awaits above.
        const excludeIds = new Set([currentDocument.id, ...mergedIds]);
        const fresh = documentsRef.current.filter((d) => !excludeIds.has(d.id));
        setDocuments(fresh);
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
    [currentDocument, handleSelectDocument]
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

        // Archived doc left the pending queue — remove it locally. Read from
        // the ref to avoid a stale closure after the awaits above.
        const fresh = documentsRef.current.filter((d) => d.id !== documentId);
        setDocuments(fresh);
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
    [handleSelectDocument]
  );

  const handleDelete = useCallback(
    async (documentId: string) => {
      setIsLoading(true);
      try {
        const supabase = createClient();
        const { error } = await supabase.from('ocr_documents').delete().eq('id', documentId);
        if (error) throw error;

        // Drop the deleted doc from local state instead of re-pulling. Read
        // from the ref to avoid a stale closure after the await above.
        const fresh = documentsRef.current.filter((d) => d.id !== documentId);
        setDocuments(fresh);
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
    [handleSelectDocument]
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

  // Persist a rotation: same flow as handleCrop but no re-OCR.
  const handleRotateSave = useCallback(async (rotatedImageDataUrl: string) => {
    if (!currentDocument) return;
    showToast("שומר סיבוב...", "info");
    try {
      const blobRes = await fetch(rotatedImageDataUrl);
      const blob = await blobRes.blob();
      const fileName = `rotated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const storagePath = `rotated/${fileName}`;
      const file = new File([blob], fileName, { type: "image/jpeg" });
      const uploadRes = await uploadFile(file, storagePath, "ocr-documents");
      if (!uploadRes.success || !uploadRes.publicUrl) {
        throw new Error(uploadRes.error || "שגיאה בהעלאת התמונה");
      }
      const newImageUrl = uploadRes.publicUrl;
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("ocr_documents")
        .update({ image_url: newImageUrl, image_storage_path: storagePath, file_type: "image", updated_at: new Date().toISOString() })
        .eq("id", currentDocument.id);
      if (updateErr) throw updateErr;
      setDocuments((prev) => prev.map((doc) => doc.id === currentDocument.id ? { ...doc, image_url: newImageUrl } : doc));
      setCurrentDocument((prev) => prev ? { ...prev, image_url: newImageUrl } : null);
      showToast("הסיבוב נשמר", "success");
    } catch (err) {
      console.error("[Rotate] Save failed:", err);
      showToast(err instanceof Error ? err.message : "שגיאה בשמירת הסיבוב", "error");
    }
  }, [currentDocument, showToast]);

  // Crop → re-OCR via MISTRAL pipeline. This is the only line that differs
  // from /ocr — fetch goes to /api/ai/ocr-extract-mistral instead of
  // /api/ai/ocr-extract. Same response contract, same downstream behavior.
  const handleCrop = useCallback(async (croppedImageDataUrl: string) => {
    if (!currentDocument) return;
    showToast("שומר חיתוך ומריץ Mistral OCR מחדש...", "info");

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
        console.error("[Crop-Demo] Mistral re-OCR failed (non-fatal):", ocrErr);
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

      showToast(extracted ? "חיתוך נשמר ו-Mistral OCR חודש בהצלחה" : "חיתוך נשמר (Mistral OCR נכשל — נסה ידנית)", extracted ? "success" : "warning");
    } catch (err) {
      console.error("[Crop-Demo] Save failed:", err);
      showToast(err instanceof Error ? err.message : "שגיאה בשמירת החיתוך", "error");
    }
  }, [currentDocument, showToast]);

  // Re-run OCR extraction on the existing image without cropping. Useful when
  // first pass missed line items or got numbers wrong.
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
      const imgRes = await fetch(currentDocument.image_url);
      if (!imgRes.ok) throw new Error("לא ניתן לטעון את תמונת המסמך");
      const blob = await imgRes.blob();
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

      // Re-fetch from DB so the UI reads the same shape fetchDocuments builds
      // (mistral_* columns + line items relation) — a manual state merge would
      // miss supplier_tax_id, line item IDs, and the mistral-vs-legacy pick logic.
      const fresh = await fetchDocuments();
      const refreshed = fresh.find((d) => d.id === currentDocument.id);
      if (refreshed) {
        setCurrentDocument(refreshed);
      }

      showToast("OCR הסתיים — בדוק שהנתונים נכונים", "success");
    } catch (err) {
      console.error("[Re-extract] Failed:", err);
      showToast(err instanceof Error ? err.message : "שגיאה בהרצת OCR מחדש", "error");
    } finally {
      setIsReExtracting(false);
    }
  }, [currentDocument, isReExtracting, showToast, fetchDocuments]);

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

  if (!hasAccess) {
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
    <div className="relative flex flex-col h-[calc(100vh-60px)] bg-[#0a0d1f]">
      {/*
        Preview overlay — non-allowed businesses see a blurred version of the
        page (with their own data) plus a CTA, so they understand what the
        feature does without being able to use it. We blur the inner content
        with `filter: blur(8px)` and put a backdrop-blur overlay on top that
        captures all pointer events.
      */}
      {isPreviewMode && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-[#0a0d1f]/40 backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="max-w-md mx-4 rounded-2xl border border-[#29318A]/40 bg-[#0F1535]/95 p-8 shadow-2xl text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#29318A]/30 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#818cf8]">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h2 className="text-white text-[20px] font-bold mb-2">קליטת מסמכים OCR</h2>
            <p className="text-white/70 text-[14px] mb-1">פיצ&#39;ר זה זמין כעת לעסקים נבחרים בלבד.</p>
            <p className="text-white/50 text-[13px] mb-6">לפרטים נוספים — צור קשר עם הצוות.</p>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#FFA412]/15 border border-[#FFA412]/30">
              <span className="text-[#FFA412] text-[12px] font-semibold">בקרוב גם לעסק שלך</span>
            </div>
          </div>
        </div>
      )}

      <div
        className={`flex flex-col flex-1 min-h-0 ${isPreviewMode ? 'pointer-events-none select-none' : ''}`}
        style={isPreviewMode ? { filter: 'blur(6px)' } : undefined}
        aria-hidden={isPreviewMode}
      >
      {/* Page header - mobile only */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0F1535] border-b border-[#4C526B]">
        <h1 className="text-[18px] font-bold text-white">קליטת מסמכים OCR</h1>
        <div className="flex items-center gap-2">
          <ScannedDocumentsButton
            businessId={selectedBusinessId || undefined}
            suppliers={suppliers}
          />
          <span className="text-[14px] text-white/60">
            {pendingCount} ממתינים
          </span>
        </div>
      </div>

      {/* Page header - desktop only */}
      <div className="hidden lg:flex items-center justify-between px-4 py-2 bg-[#0F1535] border-b border-[#4C526B]">
        <div className="flex items-center gap-3">
          <h1 className="text-[16px] font-bold text-white">קליטת מסמכים OCR</h1>
          <span className="text-[13px] text-white/60">
            {pendingCount} ממתינים
          </span>
        </div>
        <ScannedDocumentsButton
          businessId={selectedBusinessId || undefined}
          suppliers={suppliers}
        />
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
              onRotate={handleRotateSave}
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
              onBusinessChange={setSelectedBusinessId}
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
                  ? () => {
                      // Same flow as admin /ocr: route to /suppliers with a
                      // prefill so the user gets the full add-supplier form
                      // (categories, payment defaults, etc). /suppliers
                      // returns here with ?supplierAdded=<id> which the
                      // effect above catches.
                      const name = currentDocument?.ocr_data?.supplier_name || "";
                      const taxId = currentDocument?.ocr_data?.supplier_tax_id || "";
                      const params = new URLSearchParams({
                        addSupplier: "1",
                        businessId: selectedBusinessId,
                        returnTo: "/ocr-business",
                      });
                      if (name) params.set("name", name);
                      if (taxId) params.set("taxId", taxId);
                      router.push(`/suppliers?${params.toString()}`);
                    }
                  : undefined
              }
              pendingSupplierToSelect={pendingSupplierToSelect}
              onSupplierAutoSelected={() => setPendingSupplierToSelect(null)}
              hideLineItems
            />
          )}
        </div>
      </div>

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
          />
        )}
      </div>
      </div>
    </div>
  );
}
