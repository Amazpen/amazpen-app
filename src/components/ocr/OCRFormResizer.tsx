'use client';

/**
 * Drag handle that lives on the inner edge of the OCR form panel and
 * controls the form's width via a parent-supplied setter.
 *
 * RTL note: the OCR form sits on the *visual left* in the dashboard layout,
 * so the resize handle must be on the form's *right* edge in the DOM, which
 * is `right: 0` (logical "start" in RTL = right). Dragging the mouse to the
 * left grows the form; dragging right shrinks it. We translate raw pointer
 * deltas accordingly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  width: number;
  onWidthChange: (width: number) => void;
  min?: number;
  max?: number;
}

export default function OCRFormResizer({
  width,
  onWidthChange,
  min = 320,
  max = 720,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      setIsDragging(true);
    },
    [width],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      // Form is on the left side of the screen; handle is on its right edge.
      // Mouse moving LEFT (clientX decreasing) should GROW the form.
      const dx = startXRef.current - e.clientX;
      const next = Math.min(max, Math.max(min, startWidthRef.current + dx));
      onWidthChange(next);
    };

    const handlePointerUp = () => setIsDragging(false);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    // Disable text selection and show resize cursor globally while dragging.
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [isDragging, max, min, onWidthChange]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={handlePointerDown}
      className={`hidden lg:block absolute top-0 right-0 h-full w-[6px] -mr-[3px] cursor-ew-resize z-20 group ${
        isDragging ? 'bg-[#29318A]/40' : 'hover:bg-[#29318A]/30'
      } transition-colors`}
      title="גרור להרחבה / הצרה"
    >
      {/* Visible grip line, centered in the wider hit area */}
      <div
        className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] ${
          isDragging ? 'bg-[#29318A]' : 'bg-transparent group-hover:bg-[#29318A]/60'
        } transition-colors`}
      />
    </div>
  );
}
