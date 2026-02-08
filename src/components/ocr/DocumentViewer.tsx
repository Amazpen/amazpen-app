'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface DocumentViewerProps {
  imageUrl: string;
  onCrop?: (croppedImageUrl: string) => void;
}

export default function DocumentViewer({ imageUrl, onCrop }: DocumentViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [cropArea, setCropArea] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [cropStart, setCropStart] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + 0.25, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - 0.25, 0.25));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // Rotation controls
  const handleRotateCW = useCallback(() => {
    setRotation(prev => (prev + 90) % 360);
  }, []);

  const handleRotateCCW = useCallback(() => {
    setRotation(prev => (prev - 90 + 360) % 360);
  }, []);

  // Pan/Drag functionality
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isCropping) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setCropStart({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
        setCropArea({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          width: 0,
          height: 0,
        });
      }
    } else {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      });
    }
  }, [position, isCropping]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isCropping && cropStart.x !== 0) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        setCropArea({
          x: Math.min(cropStart.x, currentX),
          y: Math.min(cropStart.y, currentY),
          width: Math.abs(currentX - cropStart.x),
          height: Math.abs(currentY - cropStart.y),
        });
      }
    } else if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  }, [isDragging, dragStart, isCropping, cropStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    if (isCropping && cropArea.width > 10 && cropArea.height > 10) {
      // Keep crop area visible for confirmation
    } else if (isCropping) {
      setCropArea({ x: 0, y: 0, width: 0, height: 0 });
    }
  }, [isCropping, cropArea]);

  // Mouse wheel zoom - use native event listener for non-passive support
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(prev => Math.min(Math.max(prev + delta, 0.25), 5));
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  // Crop functionality
  const startCropping = useCallback(() => {
    setIsCropping(true);
    setCropArea({ x: 0, y: 0, width: 0, height: 0 });
  }, []);

  const cancelCropping = useCallback(() => {
    setIsCropping(false);
    setCropArea({ x: 0, y: 0, width: 0, height: 0 });
  }, []);

  const confirmCrop = useCallback(() => {
    if (cropArea.width > 10 && cropArea.height > 10 && imageRef.current && onCrop) {
      // Create canvas and crop image
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const img = imageRef.current;
        const scaleX = img.naturalWidth / img.width;
        const scaleY = img.naturalHeight / img.height;

        canvas.width = cropArea.width * scaleX;
        canvas.height = cropArea.height * scaleY;

        ctx.drawImage(
          img,
          cropArea.x * scaleX,
          cropArea.y * scaleY,
          cropArea.width * scaleX,
          cropArea.height * scaleY,
          0,
          0,
          canvas.width,
          canvas.height
        );

        onCrop(canvas.toDataURL('image/jpeg', 0.9));
      }
    }
    setIsCropping(false);
    setCropArea({ x: 0, y: 0, width: 0, height: 0 });
  }, [cropArea, onCrop]);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Reset image state when URL changes
  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
  }, [imageUrl]);

  return (
    <div style={{ height: '100%', background: '#0a0d1f', borderRadius: '10px', overflow: 'hidden' }}>
      {/* Toolbar - fixed height 48px */}
      <div className="flex items-center justify-between px-4 bg-[#0F1535] border-b border-[#4C526B]" style={{ height: '48px' }}>
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <button
            onClick={handleZoomOut}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#29318A]/30 hover:bg-[#29318A]/50 text-white transition-colors"
            title="הקטן"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>

          <span className="text-white text-sm min-w-[50px] text-center">
            {Math.round(zoom * 100)}%
          </span>

          <button
            onClick={handleZoomIn}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#29318A]/30 hover:bg-[#29318A]/50 text-white transition-colors"
            title="הגדל"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>

          <button
            onClick={handleZoomReset}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#29318A]/30 hover:bg-[#29318A]/50 text-white transition-colors"
            title="איפוס זום"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              <polyline points="23 1 23 10 14 10" />
              <polyline points="1 23 1 14 10 14" />
            </svg>
          </button>

          <div className="w-px h-6 bg-[#4C526B] mx-1" />

          {/* Rotation controls */}
          <button
            onClick={handleRotateCCW}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#29318A]/30 hover:bg-[#29318A]/50 text-white transition-colors"
            title="סובב שמאלה"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>

          <button
            onClick={handleRotateCW}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#29318A]/30 hover:bg-[#29318A]/50 text-white transition-colors"
            title="סובב ימינה"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>

          <div className="w-px h-6 bg-[#4C526B] mx-1" />

          {/* Crop controls */}
          {!isCropping ? (
            <button
              onClick={startCropping}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#29318A]/30 hover:bg-[#29318A]/50 text-white transition-colors"
              title="חיתוך"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15" />
                <path d="M1 6.13L16 6a2 2 0 0 1 2 2v15" />
              </svg>
            </button>
          ) : (
            <>
              <button
                onClick={confirmCrop}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#22c55e]/30 hover:bg-[#22c55e]/50 text-[#22c55e] transition-colors"
                title="אשר חיתוך"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
              <button
                onClick={cancelCropping}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#EB5757]/30 hover:bg-[#EB5757]/50 text-[#EB5757] transition-colors"
                title="בטל חיתוך"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Fullscreen toggle */}
        <button
          onClick={toggleFullscreen}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#29318A]/30 hover:bg-[#29318A]/50 text-white transition-colors"
          title={isFullscreen ? 'צא ממסך מלא' : 'מסך מלא'}
        >
          {isFullscreen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          )}
        </button>
      </div>

      {/* Image container - takes remaining height after toolbar (48px) and mobile slider (44px on mobile, 0 on desktop) */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          position: 'relative',
          height: 'calc(100% - 48px)',
          overflow: 'hidden',
          cursor: isCropping ? 'crosshair' : isDragging ? 'grabbing' : 'grab',
        }}
      >
        {/* Error state */}
        {imageError && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#EB5757', flexDirection: 'column', gap: '8px' }}>
            <p>שגיאה בטעינת התמונה</p>
            <a href={imageUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#4C9AFF', textDecoration: 'underline', fontSize: '14px' }}>פתח תמונה בחלון חדש</a>
          </div>
        )}

        {/* Image */}
        <img
          ref={imageRef}
          src={imageUrl}
          alt="מסמך"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
          style={{
            display: imageError ? 'none' : 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            userSelect: 'none',
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.2s ease-out',
          }}
          draggable={false}
        />

        {/* Crop overlay */}
        {isCropping && cropArea.width > 0 && cropArea.height > 0 && (
          <>
            {/* Dark overlay */}
            <div className="absolute inset-0 bg-black/50 pointer-events-none" />

            {/* Crop selection */}
            <div
              className="absolute border-2 border-white bg-transparent pointer-events-none"
              style={{
                left: cropArea.x,
                top: cropArea.y,
                width: cropArea.width,
                height: cropArea.height,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
              }}
            >
              {/* Corner handles */}
              <div className="absolute -top-1 -left-1 w-3 h-3 bg-white rounded-full" />
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full" />
              <div className="absolute -bottom-1 -left-1 w-3 h-3 bg-white rounded-full" />
              <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-white rounded-full" />

              {/* Size indicator */}
              <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                {Math.round(cropArea.width)} x {Math.round(cropArea.height)}
              </div>
            </div>
          </>
        )}

        {/* Instructions when cropping */}
        {isCropping && cropArea.width === 0 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/80 text-white text-sm px-4 py-2 rounded-lg">
            גרור לבחירת אזור החיתוך
          </div>
        )}
      </div>

      {/* Zoom slider (optional - for mobile) */}
      <div className="px-4 py-2 bg-[#0F1535] border-t border-[#4C526B] lg:hidden">
        <input
          type="range"
          min="25"
          max="500"
          value={zoom * 100}
          onChange={(e) => setZoom(Number(e.target.value) / 100)}
          className="w-full h-2 bg-[#4C526B] rounded-lg appearance-none cursor-pointer"
        />
      </div>
    </div>
  );
}
