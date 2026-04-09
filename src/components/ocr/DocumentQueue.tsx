'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Button } from "@/components/ui/button";
import type { OCRDocument, DocumentStatus } from '@/types/ocr';
import { getStatusLabel, getSourceIcon, getSourceLabel, getDocumentTypeLabel, getDocumentTypeColor } from '@/types/ocr';

interface QueueBusiness {
  id: string;
  name: string;
}

interface DocumentQueueProps {
  documents: OCRDocument[];
  currentDocumentId: string | null;
  onSelectDocument: (document: OCRDocument) => void;
  filterStatus?: DocumentStatus | 'all';
  onFilterChange?: (status: DocumentStatus | 'all') => void;
  vertical?: boolean;
  businesses?: QueueBusiness[];
  businessFilter?: string; // business id or 'all'
  onBusinessFilterChange?: (businessId: string) => void;
}

const STATUS_FILTERS: { value: DocumentStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'הכל' },
  { value: 'pending', label: 'ממתינים' },
  { value: 'reviewing', label: 'בבדיקה' },
  { value: 'approved', label: 'אושרו' },
  { value: 'archived', label: 'ארכיון' },
];

export default function DocumentQueue({
  documents,
  currentDocumentId,
  onSelectDocument,
  filterStatus = 'pending',
  onFilterChange,
  vertical = false,
  businesses = [],
  businessFilter = 'all',
  onBusinessFilterChange,
}: DocumentQueueProps) {
  // Map business_id -> name for card lookups
  const businessNameById = new Map(businesses.map(b => [b.id, b.name]));
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  // Check scroll position
  const checkScrollPosition = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      if (vertical) {
        setCanScrollUp(container.scrollTop > 0);
        setCanScrollDown(container.scrollTop < container.scrollHeight - container.clientHeight - 10);
      } else {
        setCanScrollLeft(container.scrollLeft > 0);
        setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 10);
      }
    }
  }, [vertical]);

  useEffect(() => {
    checkScrollPosition();
    window.addEventListener('resize', checkScrollPosition);
    return () => window.removeEventListener('resize', checkScrollPosition);
  }, [documents, vertical, checkScrollPosition]);

  const scroll = (direction: 'left' | 'right' | 'up' | 'down') => {
    const container = scrollContainerRef.current;
    if (container) {
      const scrollAmount = 150;
      if (direction === 'left' || direction === 'right') {
        container.scrollBy({
          left: direction === 'left' ? -scrollAmount : scrollAmount,
          behavior: 'smooth',
        });
      } else {
        container.scrollBy({
          top: direction === 'up' ? -scrollAmount : scrollAmount,
          behavior: 'smooth',
        });
      }
    }
  };

  // Filter documents by status + business
  const filteredDocuments = documents.filter((doc) => {
    if (filterStatus !== 'all' && doc.status !== filterStatus) return false;
    if (businessFilter !== 'all' && doc.business_id !== businessFilter) return false;
    return true;
  });

  // Count by status (respecting current business filter so numbers match what's shown)
  const businessScoped = businessFilter === 'all'
    ? documents
    : documents.filter((doc) => doc.business_id === businessFilter);
  const statusCounts = businessScoped.reduce(
    (acc, doc) => {
      acc[doc.status] = (acc[doc.status] || 0) + 1;
      return acc;
    },
    {} as Record<DocumentStatus, number>
  );

  // Count docs per business (for the business filter list, scoped to current status)
  const businessCounts: Record<string, number> = { all: 0 };
  for (const doc of documents) {
    if (filterStatus !== 'all' && doc.status !== filterStatus) continue;
    businessCounts.all += 1;
    businessCounts[doc.business_id] = (businessCounts[doc.business_id] || 0) + 1;
  }

  // Vertical layout for desktop sidebar
  if (vertical) {
    return (
      <div className="h-full flex flex-col bg-[#0F1535] border-l border-[#4C526B]">
        {/* Header */}
        <div className="px-3 py-3 border-b border-[#4C526B]/50">
          <h3 className="text-[14px] font-semibold text-white text-center">תור מסמכים</h3>
          <p className="text-[12px] text-white/60 text-center mt-1">
            {filteredDocuments.length} {filterStatus === 'all' ? 'סה״כ' : getStatusLabel(filterStatus as DocumentStatus)}
          </p>
        </div>

        {/* Business filter (folder-like list) */}
        {businesses.length > 0 && onBusinessFilterChange && (
          <div className="px-2 py-2 border-b border-[#4C526B]/50">
            <div className="text-[11px] text-white/40 text-right px-1 mb-1.5">סינון לפי עסק</div>
            <div className="flex flex-col gap-1 max-h-[150px] overflow-y-auto">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onBusinessFilterChange('all')}
                className={`w-full px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center justify-between gap-2 ${
                  businessFilter === 'all'
                    ? 'bg-[#29318A] text-white'
                    : 'bg-[#4C526B]/15 text-white/60 hover:bg-[#4C526B]/30 hover:text-white/80'
                }`}
              >
                <span className="truncate text-right flex-1">כל העסקים</span>
                <span className={`text-[10px] min-w-[20px] h-[16px] flex items-center justify-center rounded-full ${
                  businessFilter === 'all' ? 'bg-white/20' : 'bg-[#4C526B]/30'
                }`}>
                  {businessCounts.all || 0}
                </span>
              </Button>
              {businesses.map((biz) => {
                const count = businessCounts[biz.id] || 0;
                return (
                  <Button
                    type="button"
                    variant="ghost"
                    key={biz.id}
                    onClick={() => onBusinessFilterChange(biz.id)}
                    className={`w-full px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center justify-between gap-2 ${
                      businessFilter === biz.id
                        ? 'bg-[#29318A] text-white'
                        : 'bg-[#4C526B]/15 text-white/60 hover:bg-[#4C526B]/30 hover:text-white/80'
                    }`}
                  >
                    <span className="truncate text-right flex-1" title={biz.name}>{biz.name}</span>
                    <span className={`text-[10px] min-w-[20px] h-[16px] flex items-center justify-center rounded-full ${
                      businessFilter === biz.id ? 'bg-white/20' : 'bg-[#4C526B]/30'
                    }`}>
                      {count}
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {/* Filter buttons */}
        <div className="px-2 py-2 border-b border-[#4C526B]/50">
          <div className="flex flex-col gap-1.5">
            {STATUS_FILTERS.map((filter) => {
              const count = filter.value === 'all'
                ? businessScoped.length
                : statusCounts[filter.value as DocumentStatus] || 0;
              const isArchive = filter.value === 'archived';

              return (
                <Button
                  type="button"
                  variant="ghost"
                  key={filter.value}
                  onClick={() => onFilterChange?.(filter.value)}
                  className={`w-full px-3 py-2 rounded-lg text-[13px] font-medium transition-all flex items-center justify-between ${
                    filterStatus === filter.value
                      ? isArchive
                        ? 'bg-[#EB5757]/20 text-[#EB5757] shadow-md'
                        : 'bg-[#29318A] text-white shadow-md'
                      : isArchive
                        ? 'bg-[#EB5757]/10 text-[#EB5757]/50 hover:bg-[#EB5757]/20 hover:text-[#EB5757]/80'
                        : 'bg-[#4C526B]/20 text-white/60 hover:bg-[#4C526B]/40 hover:text-white/80'
                  }`}
                >
                  <span>{filter.label}</span>
                  <span className={`text-[11px] min-w-[24px] h-[20px] flex items-center justify-center rounded-full ${
                    filterStatus === filter.value
                      ? isArchive ? 'bg-[#EB5757]/30' : 'bg-white/20'
                      : isArchive ? 'bg-[#EB5757]/15' : 'bg-[#4C526B]/30'
                  }`}>
                    {count}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Documents vertical scroll */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <div
            ref={scrollContainerRef}
            onScroll={checkScrollPosition}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              padding: '6px',
            }}
          >
            {filteredDocuments.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>
                אין מסמכים
              </div>
            ) : (
              filteredDocuments.map((doc) => (
                <DocumentCardVertical
                  key={doc.id}
                  document={doc}
                  isSelected={doc.id === currentDocumentId}
                  onClick={() => onSelectDocument(doc)}
                  businessName={businessNameById.get(doc.business_id)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // Horizontal layout for mobile/tablet
  return (
    <div className="bg-[#0F1535] border-t border-[#4C526B]">
      {/* Header with filters */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#4C526B]/50">
        <div className="flex items-center gap-3">
          <h3 className="text-[16px] font-semibold text-white">תור מסמכים</h3>
          <span className="text-[14px] text-white/60">
            ({filteredDocuments.length} {filterStatus === 'all' ? 'סה״כ' : getStatusLabel(filterStatus as DocumentStatus)})
          </span>
        </div>

        {/* Status filter buttons */}
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map((filter) => {
            const count = filter.value === 'all'
              ? documents.length
              : statusCounts[filter.value as DocumentStatus] || 0;
            const isArchive = filter.value === 'archived';

            return (
              <Button
                type="button"
                variant="ghost"
                key={filter.value}
                onClick={() => onFilterChange?.(filter.value)}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                  filterStatus === filter.value
                    ? isArchive
                      ? 'bg-[#EB5757]/20 text-[#EB5757]'
                      : 'bg-[#29318A] text-white'
                    : isArchive
                      ? 'bg-[#EB5757]/10 text-[#EB5757]/50 hover:bg-[#EB5757]/20'
                      : 'bg-[#4C526B]/20 text-white/60 hover:bg-[#4C526B]/40'
                }`}
              >
                {filter.label}
                {count > 0 && (
                  <span className="mr-1 text-[11px] opacity-70">({count})</span>
                )}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Documents scroll area */}
      <div className="relative">
        {/* Scroll buttons */}
        {canScrollLeft && (
          <Button
            type="button"
            variant="ghost"
            title="גלול ימינה"
            onClick={() => scroll('left')}
            className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-transparent to-[#0F1535] z-10 flex items-center justify-start pr-2"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Button>
        )}
        {canScrollRight && (
          <Button
            type="button"
            variant="ghost"
            title="גלול שמאלה"
            onClick={() => scroll('right')}
            className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-transparent to-[#0F1535] z-10 flex items-center justify-end pl-2"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Button>
        )}

        {/* Documents list */}
        <div
          ref={scrollContainerRef}
          onScroll={checkScrollPosition}
          className="flex gap-3 px-4 py-4 overflow-x-auto scrollbar-hide"
        >
          {filteredDocuments.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-6 text-white/50">
              <span>אין מסמכים {filterStatus !== 'all' && getStatusLabel(filterStatus as DocumentStatus)}</span>
            </div>
          ) : (
            filteredDocuments.map((doc) => (
              <DocumentCard
                key={doc.id}
                document={doc}
                isSelected={doc.id === currentDocumentId}
                onClick={() => onSelectDocument(doc)}
                businessName={businessNameById.get(doc.business_id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface DocumentCardProps {
  document: OCRDocument;
  isSelected: boolean;
  onClick: () => void;
  businessName?: string;
}

// Format upload time: "לפני 3 שעות" / "לפני 2 ימים" / DD/MM HH:mm
function formatUploadedAt(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'הרגע';
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.round(hours / 24);
  if (days < 7) return `לפני ${days} ימים`;
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function isPdfDocument(doc: OCRDocument): boolean {
  const ft = doc.file_type?.toLowerCase();
  if (ft === 'pdf' || ft === 'application/pdf') return true;
  try {
    const pathname = new URL(doc.image_url).pathname;
    return pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return doc.image_url?.toLowerCase().includes('.pdf') ?? false;
  }
}

// Static PDF icon fallback — no client-side PDF rendering in queue thumbnails
function PdfThumbnail({ url: _url }: { url: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1a1f3d]">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span className="text-[11px] text-indigo-400 font-bold mt-1">PDF</span>
    </div>
  );
}

// Horizontal card for bottom queue
function DocumentCard({ document, isSelected, onClick, businessName }: DocumentCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const isPdf = isPdfDocument(document);

  return (
    <Button
      type="button"
      variant="ghost"
      title="בחר מסמך"
      onClick={onClick}
      className={`flex-shrink-0 w-[140px] rounded-[10px] overflow-hidden transition-all h-auto p-0 ${
        isSelected
          ? 'ring-2 ring-[#29318A] ring-offset-2 ring-offset-[#0F1535]'
          : 'hover:ring-1 hover:ring-[#4C526B]'
      }`}
    >
      {/* Image thumbnail */}
      <div className="relative w-full h-[100px] bg-[#0a0d1f]">
        {isPdf ? (
          <PdfThumbnail url={document.image_url} />
        ) : !imageError ? (
          <>
            <Image
              src={document.image_url}
              alt="תמונת מסמך"
              className={`w-full h-full object-cover transition-opacity ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              fill
              sizes="100px"
              unoptimized
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        )}

        {/* Status badge */}
        <div
          className={`absolute top-1.5 right-1.5 px-2 py-0.5 rounded text-[10px] font-medium ocr-status-${document.status}`}
        >
          {getStatusLabel(document.status)}
        </div>

        {/* Source icon */}
        <div className="absolute bottom-1.5 left-1.5 text-[14px]">
          {getSourceIcon(document.source)}
        </div>
      </div>

      {/* Info */}
      <div className="p-2 bg-[#0F1535]">
        {/* Business name - primary label */}
        <p className="text-[12px] font-semibold text-white truncate" title={businessName || 'עסק לא ידוע'}>
          {businessName || 'עסק לא ידוע'}
        </p>

        {/* Upload time */}
        <p className="text-[10px] text-white/40 truncate">
          {formatUploadedAt(document.created_at)}
        </p>

        {/* Document type */}
        <p className="text-[11px] font-medium truncate mt-0.5" style={{ color: document.document_type ? getDocumentTypeColor(document.document_type) : '#9CA3AF' }}>
          {document.document_type
            ? getDocumentTypeLabel(document.document_type)
            : 'סוג לא ידוע'}
        </p>

        {/* Supplier or amount */}
        <p className="text-[11px] text-white/50 truncate">
          {document.ocr_data?.supplier_name ||
           (document.ocr_data?.total_amount
             ? `₪${document.ocr_data.total_amount.toLocaleString()}`
             : '')}
        </p>

        {/* Rejection reason for archived documents */}
        {document.status === 'archived' && document.rejection_reason && (
          <p className="text-[10px] text-[#EB5757] truncate mt-0.5">
            סיבה: {document.rejection_reason}
          </p>
        )}

        {/* Confidence score indicator */}
        {document.ocr_data?.confidence_score !== undefined && (
          <ConfidenceBar score={document.ocr_data.confidence_score} />
        )}
      </div>
    </Button>
  );
}

// Vertical card for sidebar - business name is the primary label
function DocumentCardVertical({ document, isSelected, onClick, businessName }: DocumentCardProps) {
  const supplierName = document.ocr_data?.supplier_name || 'ממתין לזיהוי';
  const docTypeLabel = document.document_type
    ? getDocumentTypeLabel(document.document_type)
    : '';
  const totalAmount = document.ocr_data?.total_amount;
  const bizLabel = businessName || 'עסק לא ידוע';
  const uploadedAt = formatUploadedAt(document.created_at);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      style={{
        width: '100%',
        padding: '8px 10px',
        borderRadius: '8px',
        cursor: 'pointer',
        backgroundColor: isSelected ? '#29318A' : '#1a1f3d',
        borderRight: isSelected ? '3px solid #818cf8' : '3px solid transparent',
        direction: 'rtl',
      }}
    >
      {/* Business name - primary label (what this document belongs to) */}
      <div
        title={bizLabel}
        style={{ color: '#fff', fontSize: '13px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {bizLabel}
      </div>

      {/* Upload time */}
      <div style={{ color: '#9ca3af', fontSize: '10px', marginTop: '2px' }}>
        {uploadedAt}
      </div>

      {/* Supplier name (if detected) */}
      <div
        title={supplierName}
        style={{ color: '#c7d2fe', fontSize: '11px', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {supplierName}
      </div>

      {/* Document type + amount */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '3px' }}>
        <span style={{ color: document.document_type ? getDocumentTypeColor(document.document_type) : '#818cf8', fontSize: '11px', fontWeight: 600 }}>{docTypeLabel}</span>
        {totalAmount != null && totalAmount > 0 && (
          <span style={{ color: '#34d399', fontSize: '12px', fontWeight: 700, direction: 'ltr' }}>
            ₪{totalAmount.toLocaleString('he-IL', { maximumFractionDigits: 0 })}
          </span>
        )}
      </div>

      {/* Source */}
      <div style={{ color: '#7B91B0', fontSize: '10px', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '3px' }}>
        <span>{getSourceIcon(document.source)}</span>
        <span>{document.source_sender_name || document.source_sender_phone || getSourceLabel(document.source)}</span>
      </div>

      {document.status === 'archived' && document.rejection_reason && (
        <div style={{ color: '#EB5757', fontSize: '10px', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          סיבה: {document.rejection_reason}
        </div>
      )}
    </div>
  );
}

// Confidence bar component - uses ref to avoid inline style warning
function ConfidenceBar({ score }: { score: number }) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (barRef.current) {
      barRef.current.style.width = `${score * 100}%`;
    }
  }, [score]);

  const colorClass =
    score > 0.9
      ? 'ocr-confidence-high'
      : score > 0.7
      ? 'ocr-confidence-medium'
      : 'ocr-confidence-low';

  return (
    <div className="flex items-center gap-1 mt-1">
      <div className="flex-1 h-1 bg-[#4C526B]/30 rounded-full overflow-hidden">
        <div ref={barRef} className={`h-full rounded-full ${colorClass}`} />
      </div>
      <span className="text-[9px] text-white/40">{Math.round(score * 100)}%</span>
    </div>
  );
}
