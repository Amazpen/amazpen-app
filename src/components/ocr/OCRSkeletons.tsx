/**
 * Skeleton placeholders for the OCR pages while documents/businesses
 * load. Mirrors the real layout (queue sidebar, viewer, form) so the
 * page doesn't shift when data arrives.
 *
 * All elements are pure presentational divs with `animate-pulse` —
 * no data dependencies, safe to mount any time.
 */

const Bar = ({ className = "" }: { className?: string }) => (
  <div className={`bg-[#4C526B]/40 rounded ${className}`} />
);

export function OCRQueueSkeleton({ vertical = true }: { vertical?: boolean }) {
  if (!vertical) {
    // Mobile horizontal strip — 4 thumbnail-sized cards
    return (
      <div className="flex gap-3 px-4 py-4 overflow-x-auto animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-[140px] rounded-[10px] overflow-hidden bg-[#0F1535]">
            <Bar className="w-full h-[100px]" />
            <div className="p-2 flex flex-col gap-1.5">
              <Bar className="h-3 w-3/4" />
              <Bar className="h-2 w-1/2" />
              <Bar className="h-2.5 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  // Desktop vertical sidebar — 6 stacked cards
  return (
    <div className="h-full flex flex-col bg-[#0F1535] border-l border-[#4C526B] animate-pulse">
      <div className="px-3 py-3 border-b border-[#4C526B]/50 flex flex-col items-center gap-2">
        <Bar className="h-4 w-24" />
        <Bar className="h-3 w-16" />
      </div>
      <div className="px-2 py-2 border-b border-[#4C526B]/50">
        <Bar className="h-7 w-full rounded-md" />
      </div>
      <div className="px-2 py-2 border-b border-[#4C526B]/50 flex flex-col gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bar key={i} className="h-9 w-full rounded-lg" />
        ))}
      </div>
      <div className="flex-1 overflow-hidden flex flex-col gap-1 p-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="w-full p-2 rounded-lg bg-[#1a1f3d] flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Bar className="h-3 w-8 rounded" />
              <Bar className="h-3 flex-1" />
            </div>
            <Bar className="h-2 w-1/3" />
            <Bar className="h-2.5 w-2/3" />
            <div className="flex justify-between mt-1">
              <Bar className="h-2.5 w-1/4" />
              <Bar className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OCRViewerSkeleton() {
  return (
    <div className="h-full bg-[#0a0d1f] rounded-[10px] overflow-hidden animate-pulse flex flex-col">
      {/* toolbar */}
      <div className="flex items-center justify-between px-4 bg-[#0F1535] border-b border-[#4C526B] h-12">
        <div className="flex items-center gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Bar key={i} className="w-9 h-9 rounded-lg" />
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Bar className="w-9 h-9 rounded-lg" />
          <Bar className="w-9 h-9 rounded-lg" />
        </div>
      </div>
      {/* image placeholder */}
      <div className="flex-1 flex items-center justify-center bg-[#0a0d1f]">
        <div className="w-[60%] h-[80%] rounded-md bg-[#1a1f3d] flex items-center justify-center">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-white/15">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      </div>
    </div>
  );
}

export function OCRFormSkeleton() {
  return (
    <div className="flex flex-col h-full bg-[#0F1535] rounded-[10px] overflow-hidden animate-pulse">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#4C526B]">
        <Bar className="h-5 w-24" />
      </div>
      {/* business picker */}
      <div className="px-4 py-2 border-b border-[#4C526B]">
        <Bar className="h-[42px] w-full rounded-[10px]" />
      </div>
      {/* tabs */}
      <div className="flex border-b border-[#4C526B]">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bar key={i} className="flex-1 h-10 mx-1 my-1.5 rounded" />
        ))}
      </div>
      {/* fields */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Bar className="h-3.5 w-32" />
            <Bar className="h-[50px] w-full rounded-[10px]" />
          </div>
        ))}
        <div className="flex gap-3">
          <div className="flex flex-col gap-1.5 flex-1">
            <Bar className="h-3.5 w-16" />
            <Bar className="h-[50px] w-full rounded-[10px]" />
          </div>
          <div className="flex flex-col gap-1.5 flex-1">
            <Bar className="h-3.5 w-24" />
            <Bar className="h-[50px] w-full rounded-[10px]" />
          </div>
        </div>
      </div>
      {/* action bar */}
      <div className="px-4 py-3 border-t border-[#4C526B] flex gap-2">
        <Bar className="flex-1 h-[44px] rounded-[10px]" />
        <Bar className="w-16 h-[44px] rounded-[10px]" />
        <Bar className="w-12 h-[44px] rounded-[10px]" />
      </div>
    </div>
  );
}
