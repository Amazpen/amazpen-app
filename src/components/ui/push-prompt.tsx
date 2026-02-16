"use client";

import { useState, useEffect, useCallback, useRef } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function PushPrompt() {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Don't show if not supported
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    // Don't show if already granted or denied
    if (Notification.permission !== 'default') return;
    // Don't show if user dismissed before
    if (localStorage.getItem('pushPromptDismissed')) return;

    // Check if already subscribed
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        if (!sub) {
          // Small delay so it doesn't pop immediately
          timerRef.current = setTimeout(() => setShow(true), 3000);
        }
      });
    });

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const handleEnable = useCallback(async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setShow(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        setShow(false);
        return;
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
      });

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
    } catch {
      // Subscription failed
    }
    setShow(false);
  }, []);

  const handleDismiss = useCallback(() => {
    localStorage.setItem('pushPromptDismissed', 'true');
    setShow(false);
  }, []);

  if (!show) return null;

  return (
    <div
      dir="rtl"
      className="fixed bottom-[80px] left-1/2 -translate-x-1/2 z-[9998] w-[calc(100%-20px)] max-w-[400px] bg-[#29318A] rounded-[12px] p-[15px] shadow-2xl border border-white/10 animate-slide-up"
    >
      <div className="flex items-start gap-[12px]">
        <div className="w-[40px] h-[40px] rounded-full bg-[#FFA412]/20 flex items-center justify-center flex-shrink-0">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-[#FFA412]">
            <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-[14px] font-bold mb-[4px]">הפעלת התראות</p>
          <p className="text-white/60 text-[12px] leading-[1.4]">קבלו עדכונים ותזכורות גם כשהדפדפן סגור</p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-white/40 hover:text-white transition-colors flex-shrink-0"
          aria-label="סגור"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
            <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="flex gap-[8px] mt-[12px]">
        <button
          type="button"
          onClick={handleEnable}
          className="flex-1 h-[38px] bg-[#FFA412] text-white text-[14px] font-bold rounded-[8px] hover:bg-[#FFB94A] active:scale-[0.98] transition-all"
        >
          הפעל
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="flex-1 h-[38px] bg-white/10 text-white/70 text-[14px] rounded-[8px] hover:bg-white/15 active:scale-[0.98] transition-all"
        >
          לא עכשיו
        </button>
      </div>
    </div>
  );
}
