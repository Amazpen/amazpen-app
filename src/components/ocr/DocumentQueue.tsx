'use client';

import { useState, useRef, useEffect } from 'react';
import type { OCRDocument, DocumentStatus } from '@/types/ocr';
import { getStatusLabel, getSourceIcon, getSourceLabel, getDocumentTypeLabel } from '@/types/ocr';

interface DocumentQueueProps {
  documents: OCRDocument[];
  currentDocumentId: string | null;
  onSelectDocument: (document: OCRDocument) => void;
  filterStatus?: DocumentStatus | 'all';
  onFilterChange?: (status: DocumentStatus | 'all') => void;
  vertical?: boolean;
}

const STATUS_FILTERS: { value: DocumentStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'הכל' },
  { value: 'pending', label: 'ממתינים' },
  { value: 'reviewing', label: 'בבדיקה' },
  { value: 'approved', label: 'אושרו' },
  { value: 'rejected', label: 'נדחו' },
];

export default function DocumentQueue({
  documents,
  currentDocumentId,
  onSelectDocument,
  filterStatus = 'pending',
  onFilterChange,
  vertical = false,
}: DocumentQueueProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  // Check scroll position
  const checkScrollPosition = () => {
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
  };

  useEffect(() => {
    checkScrollPosition();
    window.addEventListener('resize', checkScrollPosition);
    return () => window.removeEventListener('resize', checkScrollPosition);
  }, [documents, vertical]);

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

  // Filter documents
  const filteredDocuments = filterStatus === 'all'
    ? documents
    : documents.filter((doc) => doc.status === filterStatus);

  // Count by status
  const statusCounts = documents.reduce(
    (acc, doc) => {
      acc[doc.status] = (acc[doc.status] || 0) + 1;
      return acc;
    },
    {} as Record<DocumentStatus, number>
  );

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

        {/* Filter buttons */}
        <div className="px-2 py-2 border-b border-[#4C526B]/50">
          <div className="flex flex-col gap-1.5">
            {STATUS_FILTERS.slice(0, 4).map((filter) => {
              const count = filter.value === 'all'
                ? documents.length
                : statusCounts[filter.value as DocumentStatus] || 0;

              return (
                <button
                  type="button"
                  key={filter.value}
                  onClick={() => onFilterChange?.(filter.value)}
                  className={`w-full px-3 py-2 rounded-lg text-[13px] font-medium transition-all flex items-center justify-between ${
                    filterStatus === filter.value
                      ? 'bg-[#29318A] text-white shadow-md'
                      : 'bg-[#4C526B]/20 text-white/60 hover:bg-[#4C526B]/40 hover:text-white/80'
                  }`}
                >
                  <span>{filter.label}</span>
                  <span className={`text-[11px] min-w-[24px] h-[20px] flex items-center justify-center rounded-full ${
                    filterStatus === filter.value
                      ? 'bg-white/20'
                      : 'bg-[#4C526B]/30'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Documents vertical scroll */}
        <div className="flex-1 relative overflow-hidden">
          {/* Scroll up button */}
          {canScrollUp && (
            <button
              type="button"
              title="גלול למעלה"
              onClick={() => scroll('up')}
              className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-[#0F1535] to-transparent z-10 flex items-start justify-center pt-1"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
          )}

          {/* Documents list */}
          <div
            ref={scrollContainerRef}
            onScroll={checkScrollPosition}
            className="h-full flex flex-col gap-2 p-2 overflow-y-auto scrollbar-hide"
          >
            {filteredDocuments.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-6 text-white/50 text-center text-[12px]">
                <span>אין מסמכים</span>
              </div>
            ) : (
              filteredDocuments.map((doc) => (
                <DocumentCardVertical
                  key={doc.id}
                  document={doc}
                  isSelected={doc.id === currentDocumentId}
                  onClick={() => onSelectDocument(doc)}
                />
              ))
            )}
          </div>

          {/* Scroll down button */}
          {canScrollDown && (
            <button
              type="button"
              title="גלול למטה"
              onClick={() => scroll('down')}
              className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[#0F1535] to-transparent z-10 flex items-end justify-center pb-1"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
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

            return (
              <button
                type="button"
                key={filter.value}
                onClick={() => onFilterChange?.(filter.value)}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                  filterStatus === filter.value
                    ? 'bg-[#29318A] text-white'
                    : 'bg-[#4C526B]/20 text-white/60 hover:bg-[#4C526B]/40'
                }`}
              >
                {filter.label}
                {count > 0 && (
                  <span className="mr-1 text-[11px] opacity-70">({count})</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Documents scroll area */}
      <div className="relative">
        {/* Scroll buttons */}
        {canScrollLeft && (
          <button
            type="button"
            title="גלול ימינה"
            onClick={() => scroll('left')}
            className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-transparent to-[#0F1535] z-10 flex items-center justify-start pr-2"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
        {canScrollRight && (
          <button
            type="button"
            title="גלול שמאלה"
            onClick={() => scroll('right')}
            className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-transparent to-[#0F1535] z-10 flex items-center justify-end pl-2"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
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
}

// Horizontal card for bottom queue
function DocumentCard({ document, isSelected, onClick }: DocumentCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  return (
    <button
      type="button"
      title="בחר מסמך"
      onClick={onClick}
      className={`flex-shrink-0 w-[140px] rounded-[10px] overflow-hidden transition-all ${
        isSelected
          ? 'ring-2 ring-[#29318A] ring-offset-2 ring-offset-[#0F1535]'
          : 'hover:ring-1 hover:ring-[#4C526B]'
      }`}
    >
      {/* Image thumbnail */}
      <div className="relative w-full h-[100px] bg-[#0a0d1f]">
        {!imageError ? (
          <>
            <img
              src={document.image_url}
              alt="תמונת מסמך"
              className={`w-full h-full object-cover transition-opacity ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
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
        {/* Document type or date */}
        <p className="text-[12px] text-white font-medium truncate">
          {document.document_type
            ? getDocumentTypeLabel(document.document_type)
            : 'סוג לא ידוע'}
        </p>

        {/* Supplier or amount */}
        <p className="text-[11px] text-white/50 truncate">
          {document.ocr_data?.supplier_name ||
           (document.ocr_data?.total_amount
             ? `₪${document.ocr_data.total_amount.toLocaleString()}`
             : new Date(document.created_at).toLocaleDateString('he-IL'))}
        </p>

        {/* Confidence score indicator */}
        {document.ocr_data?.confidence_score !== undefined && (
          <ConfidenceBar score={document.ocr_data.confidence_score} />
        )}
      </div>
    </button>
  );
}

// Vertical card for sidebar - compact with details
function DocumentCardVertical({ document, isSelected, onClick }: DocumentCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Determine sender info based on source
  const getSenderDisplay = () => {
    if (document.source === 'email') {
      return document.source_sender_name || '-';
    }
    // WhatsApp / Telegram - show phone
    return document.source_sender_phone || document.source_sender_name || '-';
  };

  // Format date
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('he-IL', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      });
    } catch {
      return '-';
    }
  };

  // Document type label with "unknown" fallback
  const docTypeLabel = document.document_type
    ? getDocumentTypeLabel(document.document_type)
    : 'לא זוהה';

  return (
    <button
      type="button"
      title="בחר מסמך"
      onClick={onClick}
      className={`w-full rounded-[10px] overflow-hidden transition-all cursor-pointer ${
        isSelected
          ? 'ring-2 ring-[#29318A] shadow-lg shadow-[#29318A]/20'
          : 'hover:ring-1 hover:ring-[#4C526B] hover:shadow-md'
      }`}
    >
      <div className="flex flex-row-reverse bg-[#0F1535]">
        {/* Small image thumbnail - right side */}
        <div className="relative w-[56px] h-[80px] flex-shrink-0 bg-[#0a0d1f]">
          {!imageError ? (
            <>
              <img
                src={document.image_url}
                alt="תמונת מסמך"
                className={`w-full h-full object-cover transition-opacity ${
                  imageLoaded ? 'opacity-100' : 'opacity-0'
                }`}
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageError(true)}
              />
              {!imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-white/40">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
          )}

          {/* Status badge on image */}
          <div
            className={`absolute top-1 right-0.5 px-1 py-0.5 rounded text-[8px] font-medium ocr-status-${document.status}`}
          >
            {getStatusLabel(document.status)}
          </div>
        </div>

        {/* Details - left side */}
        <div className="flex-1 p-1.5 flex flex-col justify-between min-w-0 text-right">
          {/* Source */}
          <div className="flex items-center justify-end gap-1">
            <span className="text-[10px] text-white/70 font-medium truncate">
              {getSourceLabel(document.source)}
            </span>
            <span className="text-[12px] flex-shrink-0">{getSourceIcon(document.source)}</span>
          </div>

          {/* Sender */}
          <p className="text-[10px] text-white/50 truncate" dir="ltr" style={{ textAlign: 'right' }}>
            {getSenderDisplay()}
          </p>

          {/* Date */}
          <p className="text-[10px] text-white/50">
            {formatDate(document.created_at)}
          </p>

          {/* Document type */}
          <p className="text-[10px] text-white font-medium truncate">
            {docTypeLabel}
          </p>
        </div>
      </div>
    </button>
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
