"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "pwa-install-dismissed";

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showManualGuide, setShowManualGuide] = useState(false);

  useEffect(() => {
    // Don't show if already installed (standalone mode)
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    // iOS standalone check
    if ("standalone" in navigator && (navigator as never as { standalone: boolean }).standalone) return;
    // Don't show if user previously dismissed
    if (localStorage.getItem(DISMISSED_KEY)) return;

    // Show the bubble after a short delay regardless of beforeinstallprompt
    const timer = setTimeout(() => {
      setVisible(true);
    }, 2000);

    const handler = (e: Event) => {
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const onInstalled = () => {
      setVisible(false);
      setShowManualGuide(false);
      localStorage.setItem(DISMISSED_KEY, "1");
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const isIOS = useCallback(() => {
    if (typeof navigator === "undefined") return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.userAgent.includes("Mac") && "ontouchend" in document);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setVisible(false);
        localStorage.setItem(DISMISSED_KEY, "1");
      }
      setDeferredPrompt(null);
    } else {
      // No native prompt available - show manual instructions
      setShowManualGuide(true);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    setShowManualGuide(false);
    localStorage.setItem(DISMISSED_KEY, "1");
  };

  if (!visible) return null;

  return (
    <div
      dir="rtl"
      className="fixed bottom-[20px] left-1/2 -translate-x-1/2 z-[9998] w-[calc(100%-20px)] max-w-[400px] animate-slide-up"
    >
      <div className="bg-[#29318A] rounded-[12px] shadow-2xl border border-white/10 overflow-hidden">
        <div className="p-[14px_16px] flex items-center gap-[12px]">
          {/* App icon */}
          <div className="flex-shrink-0 w-[40px] h-[40px] bg-white/15 rounded-[10px] flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-white text-[14px] font-semibold leading-tight">התקן את המצפן</p>
            <p className="text-white/60 text-[12px] mt-[2px]">גישה מהירה ישירות מהמסך הראשי</p>
          </div>

          {/* Install button */}
          <Button
            type="button"
            onClick={handleInstall}
            className="flex-shrink-0 bg-white text-[#29318A] text-[13px] font-bold px-[14px] py-[7px] rounded-[8px] hover:bg-white/90 transition-colors"
          >
            התקן
          </Button>

          {/* Close button */}
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

        {/* Manual install guide */}
        {showManualGuide && (
          <div className="px-[16px] pb-[14px] pt-[4px] border-t border-white/10">
            {isIOS() ? (
              <div className="flex items-start gap-[8px] text-white/80 text-[12px]">
                <span className="text-[16px] leading-none mt-[1px]">ℹ</span>
                <p>
                  לחץ על כפתור השיתוף{" "}
                  <svg className="inline-block mx-[2px] -mt-[2px]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points="16 6 12 2 8 6" strokeLinecap="round" strokeLinejoin="round" />
                    <line x1="12" y1="2" x2="12" y2="15" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>{" "}
                  בתחתית Safari, ואז בחר <strong>&quot;הוסף למסך הבית&quot;</strong>
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-[8px] text-white/80 text-[12px]">
                <span className="text-[16px] leading-none mt-[1px]">ℹ</span>
                <p>
                  לחץ על תפריט הדפדפן{" "}
                  <svg className="inline-block mx-[2px] -mt-[2px]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="5" r="1" />
                    <circle cx="12" cy="12" r="1" />
                    <circle cx="12" cy="19" r="1" />
                  </svg>{" "}
                  ובחר <strong>&quot;התקן אפליקציה&quot;</strong> או <strong>&quot;הוסף למסך הבית&quot;</strong>
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
