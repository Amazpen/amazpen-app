'use client';

import { useState, useRef, useEffect } from 'react';
import type { OCRDocument, DocumentStatus } from '@/types/ocr';
import { getStatusLabel, getStatusColor, getSourceIcon, getDocumentTypeLabel } from '@/types/ocr';

interface DocumentQueueProps {
  documents: OCRDocument[];
  currentDocumentId: string | null;
  onSelectDocument: (document: OCRDocument) => void;
  filterStatus?: DocumentStatus | 'all';
  onFilterChange?: (status: DocumentStatus | 'all') => void;
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
}: DocumentQueueProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Check scroll position
  const checkScrollPosition = () => {
    const container = scrollContainerRef.current;
    if (container) {
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 10);
    }
  };

  useEffect(() => {
    checkScrollPosition();
    window.addEventListener('resize', checkScrollPosition);
    return () => window.removeEventListener('resize', checkScrollPosition);
  }, [documents]);

  const scroll = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (container) {
      const scrollAmount = 200;
      container.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
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
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
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

function DocumentCard({ document, isSelected, onClick }: DocumentCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  return (
    <button
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
          className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded text-[10px] font-medium"
          style={{
            backgroundColor: `${getStatusColor(document.status)}20`,
            color: getStatusColor(document.status),
          }}
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
          <div className="flex items-center gap-1 mt-1">
            <div className="flex-1 h-1 bg-[#4C526B]/30 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${document.ocr_data.confidence_score * 100}%`,
                  backgroundColor:
                    document.ocr_data.confidence_score > 0.9
                      ? '#22c55e'
                      : document.ocr_data.confidence_score > 0.7
                      ? '#f59e0b'
                      : '#EB5757',
                }}
              />
            </div>
            <span className="text-[9px] text-white/40">
              {Math.round(document.ocr_data.confidence_score * 100)}%
            </span>
          </div>
        )}
      </div>
    </button>
  );
}
