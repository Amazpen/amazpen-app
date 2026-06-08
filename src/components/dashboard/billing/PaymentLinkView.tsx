"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Check, Share2 } from "lucide-react";

/**
 * Normalize an Israeli phone number to international format for wa.me.
 * Strips all non-digits; if it starts with "0", replaces the leading 0 with
 * "972" (e.g. 0541234567 -> 972541234567). Returns "" when no usable number.
 */
function normalizeIsraeliPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `972${digits.slice(1)}`;
  return digits;
}

/**
 * Shared "share payment link" view shown after create-lowprofile returns a URL.
 * The admin copies / WhatsApps the standalone Cardcom link to the customer.
 * While this view is mounted it polls charge/result so that if the customer
 * pays while the admin watches, it auto-succeeds and closes — but the admin is
 * NOT required to wait.
 */
export function PaymentLinkView({
  url,
  chargeId,
  phone,
  onSuccess,
  onClose,
}: {
  url: string;
  chargeId: string;
  phone?: string | null;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Background poll: pick up a payment completed by the customer while open.
  useEffect(() => {
    if (!chargeId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/billing/charge/result?chargeId=${chargeId}`);
        const data = await res.json();
        if (cancelled) return;
        const charge = data.charge as
          | { id: string; status: string; error_message: string | null }
          | null;
        if (charge?.status === "success") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          onSuccess();
        }
      } catch {
        // transient network error — keep polling
      }
    };
    pollRef.current = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargeId]);

  useEffect(() => {
    return () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        if (copyResetRef.current) clearTimeout(copyResetRef.current);
        copyResetRef.current = setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // clipboard unavailable / denied — the input is selectable as fallback
    }
  };

  const handleWhatsApp = () => {
    const text = encodeURIComponent(`שלום, לתשלום עבור המצפן: ${url}`);
    const intlPhone = normalizeIsraeliPhone(phone);
    const waUrl = intlPhone
      ? `https://wa.me/${intlPhone}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-3">
      <p className="text-white/70 text-[13px] text-right">
        שלח/י את הלינק ללקוח. כשהלקוח ישלם, הסטטוס יתעדכן אוטומטית.
      </p>

      <input
        type="text"
        readOnly
        dir="ltr"
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full bg-[#111056]/60 border border-[#727BA0] rounded-xl px-3 py-2 text-white text-[13px] outline-none select-all"
      />

      {/* RTL: first child = rightmost. "העתק לינק" on the right, WhatsApp on the left. */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-2 bg-[#29318A] hover:bg-[#333da3] text-white text-[14px] font-semibold rounded-xl px-4 py-2.5 transition-colors"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? "הועתק!" : "העתק לינק"}
        </button>
        <button
          type="button"
          onClick={handleWhatsApp}
          className="flex-1 flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1faa51] text-white text-[14px] font-semibold rounded-xl px-4 py-2.5 transition-colors"
        >
          <Share2 size={16} />
          וואטסאפ
        </button>
      </div>

      <div className="flex pt-1">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 px-4 py-2.5 rounded-xl text-[14px] text-white/70 border border-[#727BA0]/40 hover:text-white transition-colors"
        >
          סיום
        </button>
      </div>
    </div>
  );
}
