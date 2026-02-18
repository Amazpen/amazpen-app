"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Check, X, AlertTriangle, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiProposedAction } from "@/types/ai";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "מזומן",
  check: "צ'ק",
  bank_transfer: "העברה בנקאית",
  credit_card: "כרטיס אשראי",
  bit: "ביט",
  paybox: "פייבוקס",
  other: "אחר",
};

const ACTION_TITLES: Record<string, string> = {
  expense: "הצעה ליצירת חשבונית",
  payment: "הצעה ליצירת תשלום",
  daily_entry: "הצעה ליצירת רישום יומי",
};

function formatCurrency(amount?: number) {
  if (amount == null) return "—";
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" }).format(amount);
}

function formatDate(dateStr?: string) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("he-IL", { year: "numeric", month: "long", day: "numeric" });
}

function DetailRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-2 text-[11px] sm:text-[12px]">
      <span className="text-white/50 flex-shrink-0">{label}:</span>
      <span className={`text-start truncate ${bold ? "text-white font-medium" : "text-white/80"}`}>{value}</span>
    </div>
  );
}

interface AiActionCardProps {
  action: AiProposedAction;
}

export function AiActionCard({ action }: AiActionCardProps) {
  const [status, setStatus] = useState<"pending" | "confirming" | "success" | "error" | "rejected">("pending");
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const needsSupplierCreation = action.supplierLookup?.needsCreation === true;

  const handleConfirm = useCallback(async () => {
    setStatus("confirming");
    try {
      // Build the payload based on action type
      const payload: Record<string, unknown> = {
        actionType: action.actionType,
        businessId: action.businessId,
      };

      if (action.actionType === "expense" && action.expenseData) {
        Object.assign(payload, {
          supplier_id: action.expenseData.supplier_id,
          invoice_date: action.expenseData.invoice_date,
          invoice_number: action.expenseData.invoice_number,
          subtotal: action.expenseData.subtotal,
          vat_amount: action.expenseData.vat_amount,
          total_amount: action.expenseData.total_amount,
          invoice_type: action.expenseData.invoice_type,
          notes: action.expenseData.notes,
        });
      } else if (action.actionType === "payment" && action.paymentData) {
        Object.assign(payload, {
          supplier_id: action.paymentData.supplier_id,
          payment_date: action.paymentData.payment_date,
          total_amount: action.paymentData.total_amount,
          payment_method: action.paymentData.payment_method,
          check_number: action.paymentData.check_number,
          reference_number: action.paymentData.reference_number,
          notes: action.paymentData.notes,
        });
      } else if (action.actionType === "daily_entry" && action.dailyEntryData) {
        Object.assign(payload, {
          entry_date: action.dailyEntryData.entry_date,
          total_register: action.dailyEntryData.total_register,
          labor_cost: action.dailyEntryData.labor_cost,
          labor_hours: action.dailyEntryData.labor_hours,
          discounts: action.dailyEntryData.discounts,
          notes: action.dailyEntryData.notes,
        });
      }

      const res = await fetch("/api/ai/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setResultMessage(data.error || "שגיאה ביצירת הרשומה");
        return;
      }

      setStatus("success");
      setResultMessage(data.message);
    } catch {
      setStatus("error");
      setResultMessage("שגיאה בתקשורת עם השרת");
    }
  }, [action]);

  const handleReject = useCallback(() => {
    setStatus("rejected");
    setResultMessage("הפעולה בוטלה");
  }, []);

  const confidenceColor =
    action.confidence >= 0.9 ? "text-green-400" :
    action.confidence >= 0.7 ? "text-yellow-400" :
    "text-orange-400";

  // After action is done, show result banner
  if (status === "success" || status === "rejected") {
    return (
      <div
        className={`mt-3 p-3 rounded-[12px] text-[12px] ${
          status === "success"
            ? "bg-green-500/10 border border-green-500/30 text-green-200"
            : "bg-white/5 border border-white/10 text-white/50"
        }`}
        dir="rtl"
      >
        {status === "success" ? "✓ " : "✗ "}
        {resultMessage}
      </div>
    );
  }

  return (
    <div className="mt-3 bg-[#1a1f4e] rounded-[10px] sm:rounded-[12px] p-3 sm:p-4 border border-[#6366f1]/30" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 sm:mb-3 gap-2">
        <h4 className="text-white font-medium text-[13px] sm:text-[14px]">{ACTION_TITLES[action.actionType]}</h4>
        <div className={`text-[10px] sm:text-[11px] flex-shrink-0 ${confidenceColor}`}>
          ביטחון: {Math.round(action.confidence * 100)}%
        </div>
      </div>

      {/* Reasoning */}
      <p className="text-white/70 text-[11px] sm:text-[12px] mb-2 sm:mb-3">{action.reasoning}</p>

      {/* Supplier warning */}
      {needsSupplierCreation && (
        <div className="mb-2 sm:mb-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-start gap-1.5 sm:gap-2">
          <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-[10px] sm:text-[11px] text-yellow-200">
            <strong>שימו לב:</strong> הספק &quot;{action.supplierLookup?.name}&quot; לא נמצא במערכת.
            יש ליצור ספק חדש לפני אישור הפעולה.
          </div>
        </div>
      )}

      {/* Details */}
      <div className="space-y-1.5 mb-3">
        {action.actionType === "expense" && action.expenseData && (
          <>
            <DetailRow label="ספק" value={action.supplierLookup?.name || action.expenseData.supplier_name || "—"} />
            <DetailRow label="תאריך חשבונית" value={formatDate(action.expenseData.invoice_date)} />
            {action.expenseData.invoice_number && (
              <DetailRow label="מספר חשבונית" value={action.expenseData.invoice_number} />
            )}
            <DetailRow label="לפני מע״מ" value={formatCurrency(action.expenseData.subtotal)} />
            <DetailRow label="מע״מ" value={formatCurrency(action.expenseData.vat_amount)} />
            <DetailRow label="סה״כ" value={formatCurrency(action.expenseData.total_amount)} bold />
            {action.expenseData.notes && <DetailRow label="הערות" value={action.expenseData.notes} />}
          </>
        )}

        {action.actionType === "payment" && action.paymentData && (
          <>
            <DetailRow label="ספק" value={action.supplierLookup?.name || action.paymentData.supplier_name || "—"} />
            <DetailRow label="תאריך תשלום" value={formatDate(action.paymentData.payment_date)} />
            <DetailRow label="סכום" value={formatCurrency(action.paymentData.total_amount)} bold />
            {action.paymentData.payment_method && (
              <DetailRow label="אמצעי תשלום" value={PAYMENT_METHOD_LABELS[action.paymentData.payment_method] || action.paymentData.payment_method} />
            )}
            {action.paymentData.check_number && <DetailRow label="מספר צ׳ק" value={action.paymentData.check_number} />}
            {action.paymentData.notes && <DetailRow label="הערות" value={action.paymentData.notes} />}
          </>
        )}

        {action.actionType === "daily_entry" && action.dailyEntryData && (
          <>
            <DetailRow label="תאריך" value={formatDate(action.dailyEntryData.entry_date)} />
            <DetailRow label="סה״כ קופה" value={formatCurrency(action.dailyEntryData.total_register)} bold />
            {action.dailyEntryData.labor_cost != null && (
              <DetailRow label="עלות עבודה" value={formatCurrency(action.dailyEntryData.labor_cost)} />
            )}
            {action.dailyEntryData.labor_hours != null && (
              <DetailRow label="שעות עבודה" value={`${action.dailyEntryData.labor_hours}`} />
            )}
            {action.dailyEntryData.discounts != null && action.dailyEntryData.discounts > 0 && (
              <DetailRow label="הנחות" value={formatCurrency(action.dailyEntryData.discounts)} />
            )}
            {action.dailyEntryData.notes && <DetailRow label="הערות" value={action.dailyEntryData.notes} />}
          </>
        )}
      </div>

      {/* Error message */}
      {status === "error" && resultMessage && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-[11px] text-red-200">
          {resultMessage}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-1.5 sm:gap-2">
        <Button
          type="button"
          onClick={handleConfirm}
          disabled={status === "confirming" || needsSupplierCreation}
          className="flex-1 flex items-center justify-center gap-1 sm:gap-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-[12px] sm:text-[13px] font-medium py-2 px-2 sm:px-3 rounded-lg transition-colors"
        >
          {status === "confirming" ? (
            <>
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>מאשר...</span>
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="truncate">{needsSupplierCreation ? "יש ליצור ספק תחילה" : "אישור"}</span>
            </>
          )}
        </Button>
        <Button
          type="button"
          onClick={handleReject}
          disabled={status === "confirming"}
          className="flex items-center justify-center gap-1 sm:gap-1.5 bg-red-600/20 hover:bg-red-600/30 disabled:opacity-50 text-red-300 text-[12px] sm:text-[13px] font-medium py-2 px-2 sm:px-3 rounded-lg transition-colors"
        >
          <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>ביטול</span>
        </Button>
      </div>

      {needsSupplierCreation && (
        <div className="mt-2 text-center">
          <Link
            href="/suppliers"
            className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
          >
            <Building2 className="w-3 h-3" />
            עבור לדף ספקים ליצירת ספק חדש
          </Link>
        </div>
      )}
    </div>
  );
}
