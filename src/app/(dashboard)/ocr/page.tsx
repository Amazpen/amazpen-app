'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '../layout';
import { createClient } from '@/lib/supabase/client';
import DocumentViewer from '@/components/ocr/DocumentViewer';
import OCRForm from '@/components/ocr/OCRForm';
import DocumentQueue from '@/components/ocr/DocumentQueue';
import type { OCRDocument, OCRFormData, DocumentStatus } from '@/types/ocr';
import { MOCK_DOCUMENTS } from '@/types/ocr';

interface Business {
  id: string;
  name: string;
}

interface Supplier {
  id: string;
  name: string;
  waiting_for_coordinator?: boolean;
}

export default function OCRPage() {
  const router = useRouter();
  const { isAdmin } = useDashboard();

  // State - ALL hooks must be declared before any conditional returns
  const [documents, setDocuments] = useState<OCRDocument[]>(MOCK_DOCUMENTS);
  const [currentDocument, setCurrentDocument] = useState<OCRDocument | null>(null);
  const [filterStatus, setFilterStatus] = useState<DocumentStatus | 'all'>('pending');
  const [isLoading, setIsLoading] = useState(false);
  const [showMobileViewer, setShowMobileViewer] = useState(true);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Business and supplier state
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [coordinatorSuppliers, setCoordinatorSuppliers] = useState<Supplier[]>([]);

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

  // Fetch businesses (admin sees all active businesses)
  useEffect(() => {
    if (!isCheckingAuth && isAdmin) {
      const fetchBusinesses = async () => {
        const supabase = createClient();
        const { data } = await supabase
          .from('businesses')
          .select('id, name')
          .is('deleted_at', null)
          .eq('status', 'active')
          .order('name');

        if (data && data.length > 0) {
          setBusinesses(data);
          // Auto-select first business if none selected
          if (!selectedBusinessId) {
            setSelectedBusinessId(data[0].id);
          }
        }
      };
      fetchBusinesses();
    }
  }, [isCheckingAuth, isAdmin, selectedBusinessId]);

  // Fetch suppliers when selected business changes
  useEffect(() => {
    if (!selectedBusinessId) {
      setSuppliers([]);
      setCoordinatorSuppliers([]);
      return;
    }

    const fetchSuppliers = async () => {
      const supabase = createClient();

      // Fetch all active suppliers
      const { data } = await supabase
        .from('suppliers')
        .select('id, name, waiting_for_coordinator')
        .eq('business_id', selectedBusinessId)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('name');

      if (data) {
        setSuppliers(data);
        // Filter coordinator suppliers separately for summary tab
        setCoordinatorSuppliers(data.filter(s => s.waiting_for_coordinator === true));
      }
    };
    fetchSuppliers();
  }, [selectedBusinessId]);

  // Select first pending document on load
  useEffect(() => {
    if (!isCheckingAuth && isAdmin) {
      const pendingDocs = documents.filter((doc) => doc.status === 'pending');
      if (pendingDocs.length > 0 && !currentDocument) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCurrentDocument(pendingDocs[0]);
      }
    }
  }, [documents, currentDocument, isCheckingAuth, isAdmin]);

  // Handle document selection
  const handleSelectDocument = useCallback((document: OCRDocument) => {
    setCurrentDocument(document);
    if (document.status === 'pending') {
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === document.id ? { ...doc, status: 'reviewing' as DocumentStatus } : doc
        )
      );
    }
  }, []);

  // Handle form approval - saves to Supabase based on document type
  const handleApprove = useCallback(
    async (formData: OCRFormData) => {
      if (!currentDocument) return;

      setIsLoading(true);
      const supabase = createClient();

      try {
        const { data: { user } } = await supabase.auth.getUser();

        if (formData.document_type === 'invoice' || formData.document_type === 'credit_note') {
          // --- INVOICE / CREDIT NOTE ---
          const { data: newInvoice, error: invoiceError } = await supabase
            .from('invoices')
            .insert({
              business_id: formData.business_id,
              supplier_id: formData.supplier_id,
              invoice_number: formData.document_number || null,
              invoice_date: formData.document_date,
              subtotal: parseFloat(formData.amount_before_vat),
              vat_amount: parseFloat(formData.vat_amount),
              total_amount: parseFloat(formData.total_amount),
              status: formData.is_paid ? 'paid' : 'pending',
              notes: formData.notes || null,
              created_by: user?.id || null,
              invoice_type: formData.expense_type === 'goods' ? 'goods' : 'current',
            })
            .select()
            .single();

          if (invoiceError) throw invoiceError;

          // If paid, create payment + payment splits
          if (formData.is_paid && newInvoice && formData.payment_methods) {
            const paymentTotal = formData.payment_methods.reduce((sum, pm) => {
              return sum + (parseFloat(pm.amount.replace(/[^\d.]/g, '')) || 0);
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
              })
              .select()
              .single();

            if (paymentError) throw paymentError;

            if (newPayment) {
              for (const pm of formData.payment_methods) {
                const amount = parseFloat(pm.amount.replace(/[^\d.]/g, '')) || 0;
                if (amount > 0 && pm.method) {
                  const installmentsCount = parseInt(pm.installments) || 1;
                  if (pm.customInstallments.length > 0) {
                    for (const inst of pm.customInstallments) {
                      await supabase.from('payment_splits').insert({
                        payment_id: newPayment.id,
                        payment_method: pm.method,
                        amount: inst.amount,
                        installments_count: installmentsCount,
                        installment_number: inst.number,
                        reference_number: formData.payment_reference || null,
                        due_date: inst.dateForInput || null,
                      });
                    }
                  } else {
                    await supabase.from('payment_splits').insert({
                      payment_id: newPayment.id,
                      payment_method: pm.method,
                      amount: amount,
                      installments_count: 1,
                      installment_number: 1,
                      reference_number: formData.payment_reference || null,
                      due_date: formData.payment_date || formData.document_date || null,
                    });
                  }
                }
              }
            }
          }

        } else if (formData.document_type === 'delivery_note') {
          // --- DELIVERY NOTE ---
          const { error: deliveryNoteError } = await supabase
            .from('delivery_notes')
            .insert({
              business_id: formData.business_id,
              supplier_id: formData.supplier_id,
              delivery_note_number: formData.document_number || null,
              delivery_date: formData.document_date,
              subtotal: parseFloat(formData.amount_before_vat),
              vat_amount: parseFloat(formData.vat_amount),
              total_amount: parseFloat(formData.total_amount),
              notes: formData.notes || null,
              is_verified: false,
            });

          if (deliveryNoteError) throw deliveryNoteError;

        } else if (formData.document_type === 'payment') {
          // --- PAYMENT ---
          const totalAmount = formData.payment_methods
            ? formData.payment_methods.reduce((sum, pm) => sum + (parseFloat(pm.amount.replace(/[^\d.]/g, '')) || 0), 0)
            : parseFloat(formData.total_amount);

          const { data: newPayment, error: paymentError } = await supabase
            .from('payments')
            .insert({
              business_id: formData.business_id,
              supplier_id: formData.supplier_id,
              payment_date: formData.document_date,
              total_amount: totalAmount,
              notes: formData.payment_notes || formData.notes || null,
              created_by: user?.id || null,
            })
            .select()
            .single();

          if (paymentError) throw paymentError;

          // Create payment splits
          if (newPayment && formData.payment_methods) {
            for (const pm of formData.payment_methods) {
              const amount = parseFloat(pm.amount.replace(/[^\d.]/g, '')) || 0;
              if (amount > 0 && pm.method) {
                const installmentsCount = parseInt(pm.installments) || 1;
                if (pm.customInstallments.length > 0) {
                  for (const inst of pm.customInstallments) {
                    await supabase.from('payment_splits').insert({
                      payment_id: newPayment.id,
                      payment_method: pm.method,
                      amount: inst.amount,
                      installments_count: installmentsCount,
                      installment_number: inst.number,
                      reference_number: formData.payment_reference || null,
                      due_date: inst.dateForInput || null,
                    });
                  }
                } else {
                  await supabase.from('payment_splits').insert({
                    payment_id: newPayment.id,
                    payment_method: pm.method,
                    amount: amount,
                    installments_count: 1,
                    installment_number: 1,
                    reference_number: formData.payment_reference || null,
                    due_date: formData.document_date || null,
                  });
                }
              }
            }
          }

        } else if (formData.document_type === 'summary') {
          // --- SUMMARY (מרכזת) ---
          const total = parseFloat(formData.total_amount);
          const subtotal = total / 1.17;
          const vatAmount = total - subtotal;
          const isClosed = formData.summary_is_closed === 'yes';

          const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .insert({
              business_id: formData.business_id,
              supplier_id: formData.supplier_id,
              invoice_date: formData.document_date,
              invoice_number: formData.document_number,
              subtotal: subtotal,
              vat_amount: vatAmount,
              total_amount: total,
              status: isClosed ? 'pending' : 'needs_review',
              invoice_type: 'current',
              is_consolidated: true,
              notes: formData.notes || null,
              created_by: user?.id || null,
            })
            .select()
            .single();

          if (invoiceError) throw invoiceError;

          // Insert delivery notes linked to this invoice
          if (formData.summary_delivery_notes && formData.summary_delivery_notes.length > 0 && invoice) {
            const deliveryNotesData = formData.summary_delivery_notes.map(note => {
              const noteTotal = parseFloat(note.total_amount);
              const noteSubtotal = noteTotal / 1.17;
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
              };
            });

            const { error: notesError } = await supabase
              .from('delivery_notes')
              .insert(deliveryNotesData);

            if (notesError) {
              console.error('Error inserting delivery notes:', notesError);
            }
          }
        }

        // Update document status in local state
        setDocuments((prev) =>
          prev.map((doc) =>
            doc.id === currentDocument.id
              ? { ...doc, status: 'approved' as DocumentStatus, processed_at: new Date().toISOString() }
              : doc
          )
        );

        // Move to next pending document
        const pendingDocs = documents.filter(
          (doc) => doc.status === 'pending' && doc.id !== currentDocument.id
        );
        if (pendingDocs.length > 0) {
          setCurrentDocument(pendingDocs[0]);
        } else {
          setCurrentDocument(null);
        }

      } catch (error) {
        console.error('Error saving document:', error);
        alert('שגיאה בשמירת המסמך');
      } finally {
        setIsLoading(false);
      }
    },
    [currentDocument, documents]
  );

  // Handle document rejection
  const handleReject = useCallback(
    async (documentId: string, reason?: string) => {
      setIsLoading(true);

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Update document status
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === documentId
            ? {
                ...doc,
                status: 'rejected' as DocumentStatus,
                notes: reason,
              }
            : doc
        )
      );

      // Move to next pending document
      const pendingDocs = documents.filter(
        (doc) => doc.status === 'pending' && doc.id !== documentId
      );
      if (pendingDocs.length > 0) {
        setCurrentDocument(pendingDocs[0]);
      } else {
        setCurrentDocument(null);
      }

      setIsLoading(false);
      console.log('Rejected document:', documentId, reason);
    },
    [documents]
  );

  // Handle skip
  const handleSkip = useCallback(() => {
    if (!currentDocument) return;

    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === currentDocument.id ? { ...doc, status: 'pending' as DocumentStatus } : doc
      )
    );

    const pendingDocs = documents.filter(
      (doc) => doc.status === 'pending' && doc.id !== currentDocument.id
    );
    if (pendingDocs.length > 0) {
      setCurrentDocument(pendingDocs[0]);
    }
  }, [currentDocument, documents]);

  // Handle crop
  const handleCrop = useCallback((croppedImageUrl: string) => {
    if (!currentDocument) return;

    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === currentDocument.id ? { ...doc, image_url: croppedImageUrl } : doc
      )
    );

    setCurrentDocument((prev) => (prev ? { ...prev, image_url: croppedImageUrl } : null));
  }, [currentDocument]);

  // Count pending documents
  const pendingCount = documents.filter((doc) => doc.status === 'pending').length;

  // NOW we can do early returns - after all hooks have been declared

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
        <button
          onClick={() => setShowMobileViewer(true)}
          className={`flex-1 py-3 text-[14px] font-medium transition-colors ${
            showMobileViewer
              ? 'text-white border-b-2 border-[#29318A]'
              : 'text-white/50 border-b-2 border-transparent'
          }`}
        >
          תמונת מסמך
        </button>
        <button
          onClick={() => setShowMobileViewer(false)}
          className={`flex-1 py-3 text-[14px] font-medium transition-colors ${
            !showMobileViewer
              ? 'text-white border-b-2 border-[#29318A]'
              : 'text-white/50 border-b-2 border-transparent'
          }`}
        >
          פרטי מסמך
        </button>
      </div>

      {/* Main content area - 3 columns on desktop */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Document Queue - Left side (desktop) */}
        <div className="hidden lg:block lg:w-[200px] overflow-hidden lg:border-l border-[#4C526B]">
          <DocumentQueue
            documents={documents}
            currentDocumentId={currentDocument?.id || null}
            onSelectDocument={handleSelectDocument}
            filterStatus={filterStatus}
            onFilterChange={setFilterStatus}
            vertical={true}
          />
        </div>

        {/* OCR Form - Middle (desktop) / Tab 2 (mobile) */}
        <div
          className={`lg:w-[420px] lg:block ${
            !showMobileViewer ? 'flex-1' : 'hidden'
          } lg:border-l border-[#4C526B] overflow-hidden`}
        >
          <OCRForm
            document={currentDocument}
            suppliers={suppliers}
            coordinatorSuppliers={coordinatorSuppliers}
            businesses={businesses}
            selectedBusinessId={selectedBusinessId}
            onBusinessChange={setSelectedBusinessId}
            onApprove={handleApprove}
            onReject={handleReject}
            onSkip={handleSkip}
            isLoading={isLoading}
          />
        </div>

        {/* Document Viewer - Right side (desktop) / Tab 1 (mobile) */}
        <div
          className={`lg:flex-1 lg:block ${
            showMobileViewer ? 'flex-1' : 'hidden'
          } overflow-hidden`}
        >
          {currentDocument ? (
            <DocumentViewer
              imageUrl={currentDocument.image_url}
              onCrop={handleCrop}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-white/60 px-6">
              <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <p className="mt-4 text-lg">אין מסמך להצגה</p>
              <p className="mt-1 text-sm">בחר מסמך מהתור בצד שמאל</p>
            </div>
          )}
        </div>
      </div>

      {/* Document Queue - Bottom (mobile only) */}
      <div className="lg:hidden">
        <DocumentQueue
          documents={documents}
          currentDocumentId={currentDocument?.id || null}
          onSelectDocument={handleSelectDocument}
          filterStatus={filterStatus}
          onFilterChange={setFilterStatus}
          vertical={false}
        />
      </div>
    </div>
  );
}
