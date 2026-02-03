'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '../layout';
import DocumentViewer from '@/components/ocr/DocumentViewer';
import OCRForm from '@/components/ocr/OCRForm';
import DocumentQueue from '@/components/ocr/DocumentQueue';
import type { OCRDocument, OCRFormData, DocumentStatus } from '@/types/ocr';
import { MOCK_DOCUMENTS } from '@/types/ocr';

// Mock suppliers for development
const MOCK_SUPPLIERS = [
  { id: 'sup-1', name: 'ספק לדוגמה בע"מ' },
  { id: 'sup-2', name: 'חברת משלוחים' },
  { id: 'sup-3', name: 'חברת חשמל' },
  { id: 'sup-4', name: 'ספק מאושר' },
  { id: 'sup-5', name: 'מזון טרי בע"מ' },
  { id: 'sup-6', name: 'משקאות ישראל' },
  { id: 'sup-7', name: 'ציוד משרדי' },
];

export default function OCRPage() {
  const router = useRouter();
  const { isAdmin } = useDashboard();

  // State
  const [documents, setDocuments] = useState<OCRDocument[]>(MOCK_DOCUMENTS);
  const [currentDocument, setCurrentDocument] = useState<OCRDocument | null>(null);
  const [filterStatus, setFilterStatus] = useState<DocumentStatus | 'all'>('pending');
  const [isLoading, setIsLoading] = useState(false);
  const [showMobileViewer, setShowMobileViewer] = useState(true);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Check admin access
  useEffect(() => {
    // Give time for isAdmin to be set from context
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

  // Select first pending document on load
  useEffect(() => {
    const pendingDocs = documents.filter((doc) => doc.status === 'pending');
    if (pendingDocs.length > 0 && !currentDocument) {
      setCurrentDocument(pendingDocs[0]);
    }
  }, [documents, currentDocument]);

  // Show loading while checking auth
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

  // Don't render anything if not admin (will redirect)
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

  // Handle document selection
  const handleSelectDocument = useCallback((document: OCRDocument) => {
    setCurrentDocument(document);
    // Mark as reviewing if pending
    if (document.status === 'pending') {
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === document.id ? { ...doc, status: 'reviewing' as DocumentStatus } : doc
        )
      );
    }
  }, []);

  // Handle form approval
  const handleApprove = useCallback(
    async (formData: OCRFormData) => {
      if (!currentDocument) return;

      setIsLoading(true);

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Update document status
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === currentDocument.id
            ? {
                ...doc,
                status: 'approved' as DocumentStatus,
                processed_at: new Date().toISOString(),
              }
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

      setIsLoading(false);
      console.log('Approved document:', currentDocument.id, formData);
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

    // Revert to pending status
    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === currentDocument.id ? { ...doc, status: 'pending' as DocumentStatus } : doc
      )
    );

    // Move to next pending document
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

    // Update document with cropped image
    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === currentDocument.id ? { ...doc, image_url: croppedImageUrl } : doc
      )
    );

    setCurrentDocument((prev) => (prev ? { ...prev, image_url: croppedImageUrl } : null));
  }, [currentDocument]);

  // Count pending documents
  const pendingCount = documents.filter((doc) => doc.status === 'pending').length;

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

      {/* Main content area */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Document Viewer - Left side (desktop) / Tab 1 (mobile) */}
        <div
          className={`lg:w-1/2 lg:block ${
            showMobileViewer ? 'flex-1' : 'hidden'
          } lg:border-l border-[#4C526B] overflow-hidden`}
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
              <p className="mt-1 text-sm">בחר מסמך מהתור למטה</p>
            </div>
          )}
        </div>

        {/* OCR Form - Right side (desktop) / Tab 2 (mobile) */}
        <div
          className={`lg:w-1/2 lg:block ${
            !showMobileViewer ? 'flex-1' : 'hidden'
          } overflow-hidden`}
        >
          <OCRForm
            document={currentDocument}
            suppliers={MOCK_SUPPLIERS}
            onApprove={handleApprove}
            onReject={handleReject}
            onSkip={handleSkip}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Document Queue - Bottom */}
      <DocumentQueue
        documents={documents}
        currentDocumentId={currentDocument?.id || null}
        onSelectDocument={handleSelectDocument}
        filterStatus={filterStatus}
        onFilterChange={setFilterStatus}
      />
    </div>
  );
}
