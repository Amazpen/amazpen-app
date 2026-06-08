"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

type View = "form" | "iframe";

export function AddBillingCustomerModal({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();

  const [view, setView] = useState<View>("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [taxId, setTaxId] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [chargeId, setChargeId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resetToForm = () => {
    setView("form");
    setIframeUrl(null);
    setChargeId(null);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const resetAll = () => {
    resetToForm();
    setName("");
    setPhone("");
    setEmail("");
    setTaxId("");
    setAmount("");
    setSubmitting(false);
    setFormError(null);
  };

  // Reset state whenever the dialog is closed.
  useEffect(() => {
    if (!open) resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Poll the charge result while the Cardcom iframe is shown.
  useEffect(() => {
    if (view !== "iframe" || !chargeId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/billing/charge/result?chargeId=${chargeId}`);
        const data = await res.json();
        if (cancelled) return;
        const charge = data.charge as
          | { id: string; status: string; error_message: string | null }
          | null;
        if (!charge) return;
        if (charge.status === "success") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          showToast("החיוב בוצע, המנוי הופעל", "success");
          onDone();
          onOpenChange(false);
        } else if (charge.status === "failed") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setFormError(charge.error_message || "החיוב נכשל, נסה שוב");
          resetToForm();
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
  }, [view, chargeId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    const monthlyAmount = Number(amount);
    if (!trimmedName) {
      setFormError("יש להזין שם");
      return;
    }
    if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) {
      setFormError("יש להזין סכום חודשי גדול מ-0");
      return;
    }

    setSubmitting(true);
    try {
      const custRes = await fetch("/api/billing/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          phone: phone.trim() || null,
          email: email.trim() || null,
          tax_id: taxId.trim() || null,
        }),
      });
      const custData = await custRes.json();
      if (!custRes.ok || !custData.customer) {
        setFormError(custData.error || "שגיאה ביצירת לקוח");
        return;
      }

      const lpRes = await fetch("/api/billing/charge/create-lowprofile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: custData.customer.id,
          monthlyAmount,
        }),
      });
      const lpData = await lpRes.json();
      if (!lpRes.ok || !lpData.url) {
        setFormError(lpData.error || "שגיאה ביצירת דף תשלום");
        return;
      }

      setIframeUrl(lpData.url);
      setChargeId(lpData.chargeId);
      setView("iframe");
    } catch {
      setFormError("שגיאת רשת");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="bg-[#0F1535] border border-white/10 text-white sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle className="text-right">
            {view === "form" ? "לקוח חדש" : "הזנת פרטי תשלום"}
          </DialogTitle>
        </DialogHeader>

        {view === "form" ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-[13px] text-white/70 mb-1 text-right">
                שם <span className="text-[#F64E60]">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#111056]/60 border border-[#727BA0] rounded-xl px-3 py-2 text-white text-[14px] text-right placeholder:text-white/30 focus:border-white/50 outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] text-white/70 mb-1 text-right">טלפון</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-[#111056]/60 border border-[#727BA0] rounded-xl px-3 py-2 text-white text-[14px] text-right ltr-num placeholder:text-white/30 focus:border-white/50 outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] text-white/70 mb-1 text-right">מייל</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#111056]/60 border border-[#727BA0] rounded-xl px-3 py-2 text-white text-[14px] text-right ltr-num placeholder:text-white/30 focus:border-white/50 outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] text-white/70 mb-1 text-right">ח.פ / ת.ז</label>
                <input
                  type="text"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  className="w-full bg-[#111056]/60 border border-[#727BA0] rounded-xl px-3 py-2 text-white text-[14px] text-right ltr-num placeholder:text-white/30 focus:border-white/50 outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] text-white/70 mb-1 text-right">
                  סכום חודשי (₪) <span className="text-[#F64E60]">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-[#111056]/60 border border-[#727BA0] rounded-xl px-3 py-2 text-white text-[14px] text-right ltr-num placeholder:text-white/30 focus:border-white/50 outline-none"
                />
                {Number(amount) > 0 && (
                  <p className="text-[11px] text-white/50 mt-1 text-right ltr-num">
                    ₪{Number(amount).toLocaleString("he-IL")} לחודש
                  </p>
                )}
              </div>
            </div>

            {formError && (
              <p className="text-[#F64E60] text-[12px] text-right">{formError}</p>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 bg-[#29318A] hover:bg-[#333da3] disabled:opacity-50 text-white text-[14px] font-semibold rounded-xl px-4 py-2.5 transition-colors"
              >
                {submitting ? "מעבד…" : "המשך לתשלום"}
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="px-4 py-2.5 rounded-xl text-[14px] text-white/70 border border-[#727BA0]/40 hover:text-white transition-colors"
              >
                ביטול
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-2">
            <p className="text-white/60 text-[12px] text-center">
              ממתין להשלמת התשלום… העמוד יתעדכן אוטומטית
            </p>
            {iframeUrl && (
              <iframe
                src={iframeUrl}
                title="Cardcom"
                className="w-full h-[600px] rounded-lg border border-white/10 bg-white"
              />
            )}
            <button
              type="button"
              onClick={resetToForm}
              className="text-white/50 hover:text-white text-[12px] underline"
            >
              חזרה לטופס
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
