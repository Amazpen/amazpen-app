"use client";

import { useMemo, useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { allocatePartialPayment, ALLOC_EPS } from "@/lib/payments/allocatePartialPayment";

export type PartialModalInvoice = {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  total_amount: number;
  balance: number;
};

const fmt = (n: number) =>
  n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PartialPaymentModal({
  open,
  onClose,
  invoices,
  initialAmount,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  invoices: PartialModalInvoice[];
  initialAmount: number;
  onConfirm: (r: { paymentAmount: number; selectedInvoiceIds: string[] }) => void;
}) {
  // Oldest -> newest (FIFO order shown to the user).
  const ordered = useMemo(
    () => [...invoices].sort((a, b) => new Date(a.invoice_date).getTime() - new Date(b.invoice_date).getTime()),
    [invoices]
  );

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState<string>("");

  // Seed on open: all checked, amount = initialAmount.
  useEffect(() => {
    if (!open) return;
    setChecked(new Set(ordered.map((i) => i.id)));
    setAmount(initialAmount > 0 ? String(initialAmount) : "");
  }, [open, ordered, initialAmount]);

  const paymentAmount = parseFloat(amount) || 0;
  const checkedOrdered = ordered.filter((i) => checked.has(i.id));
  const selectedSum = checkedOrdered.reduce((s, i) => s + i.balance, 0);
  const remaining = selectedSum - paymentAmount;
  const isOverpay = paymentAmount > selectedSum + ALLOC_EPS;

  const preview = useMemo(
    () => allocatePartialPayment(checkedOrdered.map((i) => ({ id: i.id, balance: i.balance })), paymentAmount),
    [checkedOrdered, paymentAmount]
  );

  const canConfirm = paymentAmount > ALLOC_EPS && checkedOrdered.length > 0 && !isOverpay;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const statusFor = (id: string): "paid" | "partial" | null =>
    preview.lines.find((l) => l.invoice_id === id)?.new_status ?? null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#0f1535] border-[#4C526B] text-white rounded-[20px] p-[20px] sm:max-w-[560px]" dir="rtl">
        <DialogHeader className="border-b border-[#4C526B] pb-[14px]">
          <DialogTitle className="text-right text-[18px] font-bold text-white">תשלום חלקי</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-[14px] max-h-[70vh] overflow-y-auto">
          {/* Amount */}
          <div className="flex flex-col gap-[6px]">
            <label className="text-[13px] text-white/60 text-right">סכום התשלום</label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="bg-[#0f1535] border-[#727BA0] text-white text-center h-[44px] rounded-[10px]"
            />
          </div>

          {/* Three figures */}
          <div className="grid grid-cols-3 gap-[8px] text-center">
            <div className="bg-[#232B6A]/40 rounded-[10px] p-[8px]">
              <p className="text-[11px] text-white/50">סכום החשבוניות שנבחרו</p>
              <p className="text-[15px] font-semibold ltr-num">&#8362;{fmt(selectedSum)}</p>
            </div>
            <div className="bg-[#232B6A]/40 rounded-[10px] p-[8px]">
              <p className="text-[11px] text-white/50">סכום התשלום</p>
              <p className="text-[15px] font-semibold ltr-num">&#8362;{fmt(paymentAmount)}</p>
            </div>
            <div className="bg-[#232B6A]/40 rounded-[10px] p-[8px]">
              <p className="text-[11px] text-white/50">נותר לתשלום</p>
              <p className={`text-[15px] font-semibold ltr-num ${remaining < 0 ? "text-red-400" : "text-white"}`}>
                &#8362;{fmt(Math.max(0, remaining))}
              </p>
            </div>
          </div>

          {isOverpay && (
            <p className="text-[12px] text-red-400 text-right">שילמת יותר מהחוב הפתוח שנבחר. הקטן את הסכום או בחר עוד חשבוניות.</p>
          )}

          {/* Invoice list (oldest -> newest) with checkbox + preview badge */}
          <div className="flex flex-col gap-[6px]">
            {ordered.map((invItem) => {
              const st = checked.has(invItem.id) ? statusFor(invItem.id) : null;
              const partialLine = preview.lines.find((l) => l.invoice_id === invItem.id && l.new_status === "partial");
              return (
                <label
                  key={invItem.id}
                  className="flex items-center gap-[8px] bg-[#0f1535] border border-[#4C526B] rounded-[8px] px-[10px] py-[8px] cursor-pointer"
                >
                  <input type="checkbox" checked={checked.has(invItem.id)} onChange={() => toggle(invItem.id)} />
                  <span className="text-[13px] text-white/80 flex-1 text-right">
                    {invItem.invoice_number || "ללא מספר"} · {invItem.invoice_date}
                  </span>
                  <span className="text-[12px] text-white/60 ltr-num">&#8362;{fmt(invItem.balance)}</span>
                  {st === "paid" && <span className="text-[10px] text-green-400">נסגר</span>}
                  {st === "partial" && (
                    <span className="text-[10px] text-[#FFC107]">תשלום חלקי · נותר &#8362;{fmt(partialLine?.remaining_balance ?? 0)}</span>
                  )}
                </label>
              );
            })}
          </div>

          <div className="flex gap-[10px] pt-[5px]">
            <Button
              onClick={() => onConfirm({ paymentAmount, selectedInvoiceIds: checkedOrdered.map((i) => i.id) })}
              disabled={!canConfirm}
              className="flex-1 bg-[#4956D4] hover:bg-[#5A67E0] text-white text-[14px] font-semibold py-[10px] rounded-[10px] disabled:opacity-40"
            >
              אישור
            </Button>
            <Button variant="ghost" onClick={onClose} className="flex-1 text-white/60 text-[14px] py-[10px] rounded-[10px]">
              ביטול
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
