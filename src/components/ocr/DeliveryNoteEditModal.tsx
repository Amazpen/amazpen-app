"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerField } from "@/components/ui/date-picker-field";

export type DeliveryNoteEditTarget = {
  id: string;
  delivery_note_number: string;
  delivery_date: string;
  total_amount: number;
  notes: string | null;
};

export type DeliveryNoteEditValues = {
  delivery_date: string;
  delivery_note_number: string;
  total_amount: number;
  notes: string;
};

// Quick editor for an open delivery note, opened from the markezet check list.
// Deliberately narrow: the fields the user needs to fix before ticking the
// delivery note onto a markezet. The full editor (supplier, category, VAT type,
// attachments) still lives in /expenses — this exists so a wrong scanned
// number/date/amount doesn't force the user out of the OCR flow.
export function DeliveryNoteEditModal({
  open,
  note,
  onClose,
  onSave,
}: {
  open: boolean;
  note: DeliveryNoteEditTarget | null;
  onClose: () => void;
  onSave: (values: DeliveryNoteEditValues) => Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Seed from the delivery note each time the modal opens.
  useEffect(() => {
    if (!open || !note) return;
    setDate(note.delivery_date || "");
    setNumber(note.delivery_note_number || "");
    setAmount(String(note.total_amount ?? ""));
    setNotes(note.notes || "");
    setIsSaving(false);
  }, [open, note]);

  if (!note) return null;

  const parsedAmount = parseFloat(amount);
  const canSave = !!date && Number.isFinite(parsedAmount) && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await onSave({
        delivery_date: date,
        delivery_note_number: number,
        total_amount: parsedAmount,
        notes,
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
            עריכת תעודת משלוח
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-[14px] max-h-[70vh] overflow-y-auto">
          <div className="flex flex-col gap-[6px]">
            <label className="text-[13px] text-white/60 text-right">תאריך תעודה</label>
            <DatePickerField value={date} onChange={setDate} />
          </div>

          <div className="flex flex-col gap-[6px]">
            <label className="text-[13px] text-white/60 text-right">מספר תעודה</label>
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
            <label className="text-[13px] text-white/60 text-right">הערה</label>
            <Input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ללא הערה"
              className="bg-transparent border border-[#727BA0] text-white text-right h-[50px] rounded-[10px] text-[16px] px-[10px]"
            />
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
