"use client";

import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "pwa-install-dismissed";

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if already installed (standalone mode)
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    // Don't show if user previously dismissed
    if (localStorage.getItem(DISMISSED_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const onInstalled = () => {
      setVisible(false);
      localStorage.setItem(DISMISSED_KEY, "1");
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
      localStorage.setItem(DISMISSED_KEY, "1");
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISSED_KEY, "1");
  };

  if (!visible) return null;

  return (
    <div
      dir="rtl"
      className="fixed bottom-[80px] left-1/2 -translate-x-1/2 z-[9998] w-[calc(100%-20px)] max-w-[400px] animate-slide-up"
    >
      <div className="bg-[#29318A] rounded-[14px] p-[14px_16px] shadow-2xl flex items-center gap-[12px]">
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
        <button
          type="button"
          onClick={handleInstall}
          className="flex-shrink-0 bg-white text-[#29318A] text-[13px] font-bold px-[14px] py-[7px] rounded-[8px] hover:bg-white/90 transition-colors"
        >
          התקן
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
  );
}
