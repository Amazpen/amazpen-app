"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { computeVat, DEFAULT_VAT_PERCENT } from "@/lib/billing/vat";
import { PaymentLinkView } from "./PaymentLinkView";

type View = "form" | "link";

/**
 * One-time charge for an EXISTING billing customer.
 * POSTs create-lowprofile with mode "one_time" (no subscription, no token),
 * then shows a shareable payment link — same pattern as the new-customer flow.
 */
export function OneTimeChargeModal({
  customerId,
  customerName,
  customerPhone,
  open,
  onOpenChange,
  onDone,
}: {
  customerId: string;
  customerName: string;
  customerPhone?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();

  const [view, setView] = useState<View>("form");
  const [amount, setAmount] = useState("");
  const [vatPercent, setVatPercent] = useState(String(DEFAULT_VAT_PERCENT));
  const [numPayments, setNumPayments] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [chargeId, setChargeId] = useState<string | null>(null);

  const resetToForm = () => {
    setView("form");
    setPayUrl(null);
    setChargeId(null);
  };

  const resetAll = () => {
    resetToForm();
    setAmount("");
    setVatPercent(String(DEFAULT_VAT_PERCENT));
    setNumPayments("1");
    setSubmitting(false);
    setFormError(null);
  };

  useEffect(() => {
    if (!open) resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const oneTimeAmount = Number(amount);
    if (!Number.isFinite(oneTimeAmount) || oneTimeAmount <= 0) {
      setFormError("יש להזין סכום גדול מ-0");
      return;
    }

    setSubmitting(true);
    try {
      const lpRes = await fetch("/api/billing/charge/create-lowprofile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          monthlyAmount: oneTimeAmount,
          vatPercent: Number(vatPercent) || 0,
          numOfPayments: Math.max(1, Math.floor(Number(numPayments) || 1)),
          mode: "one_time",
        }),
      });
      const lpData = await lpRes.json();
      if (!lpRes.ok || !lpData.url) {
        setFormError(lpData.error || "שגיאה ביצירת דף תשלום");
        return;
      }

      setPayUrl(lpData.url);
      setChargeId(lpData.chargeId);
      setView("link");
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
            {view === "form" ? `חיוב חד-פעמי — ${customerName}` : "לינק לתשלום"}
          </DialogTitle>
        </DialogHeader>

        {view === "form" ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* RTL: first child = right. Amount (right) → VAT% → מספר תשלומים (left) */}
            <div className="grid grid-cols-[1fr_0.5fr_0.6fr] gap-3">
              <div>
                <label className="block text-[13px] text-white/70 mb-1 text-right">
                  סכום (לפני מע&quot;מ) ₪ <span className="text-[#F64E60]">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-[#111056]/60 border border-[#727BA0] rounded-xl px-3 py-2 text-white text-[14px] text-right ltr-num placeholder:text-white/30 focus:border-white/50 outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] text-white/70 mb-1 text-right">מע&quot;מ %</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={vatPercent}
                  onChange={(e) => setVatPercent(e.target.value)}
                  className="w-full bg-[#111056]/60 border border-[#727BA0] rounded-xl px-3 py-2 text-white text-[14px] text-right ltr-num placeholder:text-white/30 focus:border-white/50 outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] text-white/70 mb-1 text-right">מס׳ תשלומים</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={numPayments}
                  onChange={(e) => setNumPayments(e.target.value)}
                  className="w-full bg-[#111056]/60 border border-[#727BA0] rounded-xl px-3 py-2 text-white text-[14px] text-right ltr-num placeholder:text-white/30 focus:border-white/50 outline-none"
                />
              </div>
            </div>

            {Number(amount) > 0 && (() => {
              const b = computeVat(Number(amount), Number(vatPercent) || 0);
              const n = Math.max(1, Math.floor(Number(numPayments) || 1));
              const perPayment = b.gross / n;
              return (
                <p className="text-[12px] text-white/70 text-right ltr-num">
                  נטו ₪{b.net.toLocaleString("he-IL")} · מע&quot;מ {b.vatPercent}% ₪{b.vatAmount.toLocaleString("he-IL")} · לחיוב ₪{b.gross.toLocaleString("he-IL")}
                  {n > 1 && (
                    <> · {n} תשלומים של ₪{perPayment.toLocaleString("he-IL", { maximumFractionDigits: 2 })}</>
                  )}
                </p>
              );
            })()}

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
          payUrl && chargeId && (
            <PaymentLinkView
              url={payUrl}
              chargeId={chargeId}
              phone={customerPhone}
              onSuccess={() => {
                showToast("התשלום התקבל", "success");
                onDone();
                onOpenChange(false);
              }}
              onClose={() => {
                onDone();
                onOpenChange(false);
              }}
            />
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
