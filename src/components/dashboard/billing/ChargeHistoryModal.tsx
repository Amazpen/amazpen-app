"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BillingCharge, ChargeStatus, ChargeType } from "@/types/billing";

const CHARGE_TYPE_LABELS: Record<ChargeType, string> = {
  initial: "ראשוני",
  recurring: "חוזר",
  manual: "ידני",
  one_time: "חד-פעמי",
};

const CHARGE_STATUS_META: Record<ChargeStatus, { label: string; color: string }> = {
  pending: { label: "ממתין", color: "#9CA3AF" },
  success: { label: "הצליח", color: "#17DB4E" },
  failed: { label: "נכשל", color: "#F64E60" },
};

function formatChargeDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChargeHistoryModal({
  customerId,
  customerName,
  open,
  onOpenChange,
}: {
  customerId: string | null;
  customerName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [charges, setCharges] = useState<BillingCharge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/charges?customerId=${customerId}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "שגיאה בטעינת היסטוריית חיובים");
        setCharges([]);
        return;
      }
      setCharges((data.charges || []) as BillingCharge[]);
    } catch {
      setError("שגיאת רשת בטעינת היסטוריית חיובים");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    if (!open || !customerId) return;
    load();
  }, [open, customerId, load]);

  const deleteCharge = async (charge: BillingCharge) => {
    if (!window.confirm("למחוק לינק/חיוב זה?")) return;
    setDeletingId(charge.id);
    try {
      const res = await fetch(`/api/billing/charges?id=${charge.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        window.alert(data.error || "מחיקת החיוב נכשלה");
        return;
      }
      await load();
    } catch {
      window.alert("שגיאת רשת");
    } finally {
      setDeletingId(null);
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
            {customerName ? `היסטוריית חיובים - ${customerName}` : "היסטוריית חיובים"}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-[#111056]/40 border border-white/5 rounded-[7px] h-12" />
            ))}
          </div>
        ) : error ? (
          <p className="text-[#F64E60] text-[13px] text-center py-6">{error}</p>
        ) : charges.length === 0 ? (
          <p className="text-white/50 text-center py-6 text-[13px]">אין חיובים עדיין</p>
        ) : (
          <div className="w-full flex flex-col">
            {/* Header */}
            <div className="grid grid-cols-[1.2fr_0.8fr_0.9fr_0.8fr] bg-[#29318A] rounded-t-[7px] p-[10px_5px] items-center">
              <span className="text-[13px] font-medium text-center">תאריך</span>
              <span className="text-[13px] font-medium text-center">סוג</span>
              <span className="text-[13px] font-medium text-center">סכום (₪)</span>
              <span className="text-[13px] font-medium text-center">סטטוס</span>
            </div>
            {/* Rows */}
            <div className="max-h-[450px] overflow-y-auto flex flex-col gap-[5px]">
              {charges.map((charge) => {
                const meta = CHARGE_STATUS_META[charge.status];
                return (
                  <div
                    key={charge.id}
                    className="grid grid-cols-[1.2fr_0.8fr_0.9fr_0.8fr] w-full p-[5px_5px] hover:bg-[#29318A]/30 transition-colors rounded-[7px] items-center"
                  >
                    <span className="text-[12px] ltr-num text-center">
                      {formatChargeDate(charge.charged_at || charge.created_at)}
                    </span>
                    <span className="text-[12px] text-center">
                      {CHARGE_TYPE_LABELS[charge.type]}
                    </span>
                    <span className="text-[12px] ltr-num text-center font-medium flex flex-col items-center leading-tight">
                      <span>₪{charge.amount.toLocaleString("he-IL")}</span>
                      {charge.net_amount != null && charge.vat_amount != null && (
                        <span className="text-[10px] text-white/45 font-normal">
                          נטו ₪{charge.net_amount.toLocaleString("he-IL")} + מע&quot;מ ₪{charge.vat_amount.toLocaleString("he-IL")}
                        </span>
                      )}
                    </span>
                    <span className="text-center inline-flex items-center justify-center gap-1.5">
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: `${meta.color}1a`, color: meta.color }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
                        {meta.label}
                      </span>
                      {charge.status !== "success" && (
                        <button
                          type="button"
                          disabled={deletingId === charge.id}
                          onClick={() => deleteCharge(charge)}
                          title="מחק לינק/חיוב"
                          className="p-1 rounded-md bg-[#F64E60]/15 text-[#F64E60] hover:bg-[#F64E60]/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                    {charge.status === "failed" && charge.error_message && (
                      <span className="col-span-4 text-[11px] text-[#F64E60] text-right px-1 pt-0.5">
                        {charge.error_message}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
