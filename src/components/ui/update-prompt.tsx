"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

export function UpdatePrompt() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handleUpdate = (registration: ServiceWorkerRegistration) => {
      const newWorker = registration.waiting;
      if (newWorker) {
        setWaitingWorker(newWorker);
        setVisible(true);
      }
    };

    // Check if there's already a waiting SW when the component mounts
    navigator.serviceWorker.ready.then((registration) => {
      if (registration.waiting) {
        handleUpdate(registration);
      }

      // Listen for new SW updates
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            // New SW is installed and there's an existing controller = update available
            setWaitingWorker(newWorker);
            setVisible(true);
          }
        });
      });
    });

    // When the new SW takes over, reload the page
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }, []);

  const handleUpdate = () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    }
  };

  const handleDismiss = () => {
    setVisible(false);
  };

  if (!visible || !mounted) return null;

  // Render via portal directly to document.body to escape any Radix Dialog focus traps
  return createPortal(
    <div
      className="fixed bottom-[20px] left-[10px] right-[10px] lg:left-auto lg:right-[230px] lg:max-w-[400px] z-[999999] animate-slide-up"
      style={{ pointerEvents: 'auto' }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div dir="rtl" className="bg-[#1a7a4c] rounded-[14px] shadow-2xl overflow-hidden">
        <div className="p-[14px_16px] flex items-center gap-[12px]">
          {/* Update icon */}
          <div className="flex-shrink-0 w-[40px] h-[40px] bg-white/15 rounded-[10px] flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M21 2v6h-6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 12a9 9 0 0115.36-6.36L21 8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 22v-6h6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 12a9 9 0 01-15.36 6.36L3 16" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-white text-[14px] font-semibold leading-tight">עדכון מערכת זמין</p>
            <p className="text-white/60 text-[12px] mt-[2px]">גרסה חדשה מוכנה להתקנה</p>
          </div>

          {/* Update button */}
          <button
            type="button"
            onClick={handleUpdate}
            className="flex-shrink-0 bg-white text-[#1a7a4c] text-[13px] font-bold px-[14px] py-[7px] rounded-[8px] hover:bg-white/90 transition-colors"
          >
            עדכן עכשיו
          </button>

          {/* Close button */}
          <button
            type="button"
            onClick={handleDismiss}
            className="flex-shrink-0 text-white/50 hover:text-white transition-colors"
            aria-label="סגור"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
              <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
