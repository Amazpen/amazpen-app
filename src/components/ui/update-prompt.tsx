"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

declare global {
  interface Window {
    __SW_UPDATE_CALLBACKS: ((worker: ServiceWorker) => void)[];
    __SW_WAITING: ServiceWorker | null;
  }
}

const SW_BUILD_KEY = "amazpen_sw_build_time";

export function UpdatePrompt() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isVersionUpdate, setIsVersionUpdate] = useState(false);

  // Check sw.js BUILD_TIME against stored version
  const checkSwVersion = useCallback(async () => {
    try {
      // Add cache-busting query param to bypass SW fetch handler cache
      const res = await fetch(`/sw.js?_cb=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const text = await res.text();
      const match = text.match(/\/\/ BUILD_TIME=(\d+)/);
      if (!match) return;
      const serverBuild = match[1];
      const storedBuild = localStorage.getItem(SW_BUILD_KEY);

      console.log("[SW Update]", { serverBuild, storedBuild });

      if (!storedBuild) {
        localStorage.setItem(SW_BUILD_KEY, serverBuild);
        console.log("[SW Update] First visit — stored build time");
        return;
      }

      if (storedBuild !== serverBuild) {
        localStorage.setItem(SW_BUILD_KEY, serverBuild);
        console.log("[SW Update] New version detected! Showing prompt");
        setIsVersionUpdate(true);
        setVisible(true);
      } else {
        console.log("[SW Update] Up to date");
      }
    } catch (e) {
      console.warn("[SW Update] Check failed:", e);
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setMounted(true);
    });

    if (typeof window === "undefined") return () => cancelAnimationFrame(id);
    if (!("serviceWorker" in navigator)) return () => cancelAnimationFrame(id);

    // Always run version check regardless of SW state
    checkSwVersion();

    // Recheck on visibility change and focus
    const onVisible = () => {
      if (document.visibilityState === "visible") checkSwVersion();
    };
    const onFocus = () => checkSwVersion();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    // Check if inline script already detected a waiting worker
    if (window.__SW_WAITING) {
      setWaitingWorker(window.__SW_WAITING);
      setVisible(true);
    }

    // Subscribe to future SW waiting updates
    if (window.__SW_UPDATE_CALLBACKS) {
      const callback = (worker: ServiceWorker) => {
        setWaitingWorker(worker);
        setVisible(true);
      };
      window.__SW_UPDATE_CALLBACKS.push(callback);

      return () => {
        cancelAnimationFrame(id);
        const idx = window.__SW_UPDATE_CALLBACKS.indexOf(callback);
        if (idx !== -1) window.__SW_UPDATE_CALLBACKS.splice(idx, 1);
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("focus", onFocus);
      };
    }

    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkSwVersion]);

  const handleUpdate = () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    } else if (isVersionUpdate) {
      window.location.reload();
    }
  };

  const handleDismiss = () => {
    setVisible(false);
  };

  if (!visible || !mounted) return null;

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
          <div className="flex-shrink-0 w-[40px] h-[40px] bg-white/15 rounded-[10px] flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M21 2v6h-6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 12a9 9 0 0115.36-6.36L21 8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 22v-6h6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 12a9 9 0 01-15.36 6.36L3 16" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white text-[14px] font-semibold leading-tight">עדכון מערכת זמין</p>
            <p className="text-white/60 text-[12px] mt-[2px]">גרסה חדשה מוכנה להתקנה</p>
          </div>

          <Button
            type="button"
            onClick={handleUpdate}
            className="flex-shrink-0 bg-white text-[#1a7a4c] text-[13px] font-bold px-[14px] py-[7px] rounded-[8px] hover:bg-white/90 transition-colors"
          >
            עדכן עכשיו
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleDismiss}
            className="flex-shrink-0 text-white/50 hover:text-white transition-colors"
            aria-label="סגור"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
              <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
