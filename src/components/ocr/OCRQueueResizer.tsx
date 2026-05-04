'use client';

/**
 * Drag handle on the inner edge of the OCR document queue panel.
 *
 * RTL note: the queue sits on the *visual right* of the dashboard layout
 * (it's the first item in the flex row, which under dir="rtl" is rendered
 * rightmost). The resize handle must be on the queue's *left* edge in the
 * DOM (the inner side), which is `left: 0`. Dragging the mouse to the
 * left SHRINKS the queue (more room for viewer/form), dragging right
 * grows it.
 *
 * Mirrors OCRFormResizer for consistency — same grip line, same hover
 * styling, same disabled text-selection during drag.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  width: number;
  onWidthChange: (width: number) => void;
  min?: number;
  max?: number;
}

export default function OCRQueueResizer({
  width,
  onWidthChange,
  min = 180,
  max = 480,
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
      // Queue is on the right side of the screen; handle is on its left
      // edge. Mouse moving LEFT (clientX decreasing) should SHRINK the
      // queue (give more space to viewer/form). Mouse moving RIGHT grows
      // the queue. Inverse of the form resizer because the queue lives
      // on the opposite end of the row.
      const dx = e.clientX - startXRef.current;
      const next = Math.min(max, Math.max(min, startWidthRef.current + dx));
      onWidthChange(next);
    };

    const handlePointerUp = () => setIsDragging(false);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

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
      className={`hidden lg:block absolute top-0 left-0 h-full w-[6px] -ml-[3px] cursor-ew-resize z-20 group ${
        isDragging ? 'bg-[#29318A]/40' : 'hover:bg-[#29318A]/30'
      } transition-colors`}
      title="גרור להרחבה / הצרה"
    >
      <div
        className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] ${
          isDragging ? 'bg-[#29318A]' : 'bg-transparent group-hover:bg-[#29318A]/60'
        } transition-colors`}
      />
    </div>
  );
}
