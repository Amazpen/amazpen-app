"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerField } from "@/components/ui/date-picker-field";

export type OpenInvoiceEditStatus = "pending" | "paid" | "clarification" | "partial";

export type OpenInvoiceEditTarget = {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  total_amount: number;
  status: string;
};

export type OpenInvoiceEditValues = {
  invoice_date: string;
  invoice_number: string;
  total_amount: number;
  status: OpenInvoiceEditStatus;
};

// Quick editor for an open invoice, opened from the payment tab's invoice list.
// Deliberately narrow: the four fields the user needs to fix before paying.
// The full editor (supplier, category, VAT type, payment) still lives in
// /expenses — this exists so a wrong date/number/amount doesn't force the user
// out of the OCR flow mid-payment.
export function OpenInvoiceEditModal({
  open,
  invoice,
  onClose,
  onSave,
}: {
  open: boolean;
  invoice: OpenInvoiceEditTarget | null;
  onClose: () => void;
  onSave: (values: OpenInvoiceEditValues) => Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<OpenInvoiceEditStatus>("pending");
  const [isSaving, setIsSaving] = useState(false);

  // A partially-paid invoice keeps its own option so an untouched save can't
  // silently downgrade it to "ממתין לתשלום" and lose the נותר display.
  const isPartial = invoice?.status === "partial";

  // Seed from the invoice each time the modal opens.
  useEffect(() => {
    if (!open || !invoice) return;
    setDate(invoice.invoice_date || "");
    setNumber(invoice.invoice_number || "");
    setAmount(String(invoice.total_amount ?? ""));
    setStatus(
      invoice.status === "paid" || invoice.status === "clarification" || invoice.status === "partial"
        ? invoice.status
        : "pending"
    );
    setIsSaving(false);
  }, [open, invoice]);

  if (!invoice) return null;

  const parsedAmount = parseFloat(amount);
  const canSave = !!date && Number.isFinite(parsedAmount) && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await onSave({
        invoice_date: date,
        invoice_number: number,
        total_amount: parsedAmount,
        status,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="bg-[#0f1535] border-[#4C526B] text-white rounded-[20px] p-[20px] sm:max-w-[420px]"
        dir="rtl"
      >
        <DialogHeader className="border-b border-[#4C526B] pb-[14px]">
          <DialogTitle className="text-right text-[18px] font-bold text-white">
            עריכת חשבונית
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-[14px] max-h-[70vh] overflow-y-auto">
          <div className="flex flex-col gap-[6px]">
            <label className="text-[13px] text-white/60 text-right">תאריך חשבונית</label>
            <DatePickerField value={date} onChange={setDate} />
          </div>

          <div className="flex flex-col gap-[6px]">
            <label className="text-[13px] text-white/60 text-right">מספר חשבונית</label>
            <Input
              type="text"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="ללא מספר"
              className="bg-transparent border border-[#727BA0] text-white text-center h-[50px] rounded-[10px] text-[16px]"
            />
          </div>

          <div className="flex flex-col gap-[6px]">
            <label className="text-[13px] text-white/60 text-right">סכום כולל מע&quot;מ</label>
            <Input
              type="number"
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="bg-transparent border border-[#727BA0] text-white text-center h-[50px] rounded-[10px] text-[16px] ltr-num"
            />
          </div>

          <div className="flex flex-col gap-[6px]">
            <label className="text-[13px] text-white/60 text-right">סטטוס</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as OpenInvoiceEditStatus)}
              className="bg-transparent border border-[#727BA0] text-white h-[50px] rounded-[10px] text-[16px] px-[10px] cursor-pointer focus:outline-none focus:border-white/50 transition-colors"
            >
              {isPartial && (
                <option value="partial" className="bg-[#1A1F3D]">תשלום חלקי</option>
              )}
              <option value="pending" className="bg-[#1A1F3D]">ממתין לתשלום</option>
              <option value="paid" className="bg-[#1A1F3D]">שולם</option>
              <option value="clarification" className="bg-[#1A1F3D]">בבירור</option>
            </select>
          </div>

          <div className="flex gap-[10px] pt-[5px]">
            <Button
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 bg-[#4956D4] hover:bg-[#5A67E0] text-white text-[14px] font-semibold py-[10px] rounded-[10px] disabled:opacity-40"
            >
              {isSaving ? "שומר..." : "שמירה"}
            </Button>
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 text-white/60 text-[14px] py-[10px] rounded-[10px]"
            >
              ביטול
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
