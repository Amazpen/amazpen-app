"use client";

import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

interface QuickAddSupplierModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId: string;
  /**
   * If the OCR identified a supplier name on the document, prefill it so the
   * admin doesn't have to retype it. Same for the tax id when available.
   */
  initialName?: string;
  initialTaxId?: string;
  /**
   * Fires after a successful insert with the new supplier's id, so the
   * caller can refresh its supplier list and auto-select the new row.
   */
  onCreated: (supplierId: string) => void;
}

type ExpenseType = "goods_purchases" | "current_expenses" | "employee_costs";
type VatType = "regular" | "none";

const EXPENSE_OPTIONS: { value: ExpenseType; label: string }[] = [
  { value: "goods_purchases", label: "קניות סחורה" },
  { value: "current_expenses", label: "הוצאות שוטפות" },
  { value: "employee_costs", label: "עלות עובדים" },
];

const VAT_OPTIONS: { value: VatType; label: string }[] = [
  { value: "regular", label: "מע״מ רגיל" },
  { value: "none", label: "פטור ממע״מ" },
];

/**
 * Minimal "add supplier" sheet specifically for the OCR queue. The full
 * supplier editor on /suppliers exposes ~30 fields; David's review
 * complaint was that he had to leave the OCR screen any time a new
 * supplier showed up, which broke his flow. This sheet writes only the
 * NOT-NULL columns + the handful of fields the OCR form actually reads
 * back (vat_type, expense_type, default_payment_method) and lets the
 * admin go back to /suppliers later for finer config.
 */
export default function QuickAddSupplierModal({
  open,
  onOpenChange,
  businessId,
  initialName,
  initialTaxId,
  onCreated,
}: QuickAddSupplierModalProps) {
  const [name, setName] = useState(initialName?.trim() || "");
  const [taxId, setTaxId] = useState(initialTaxId?.trim() || "");
  const [expenseType, setExpenseType] = useState<ExpenseType>("goods_purchases");
  const [vatType, setVatType] = useState<VatType>("regular");
  const [defaultDiscountPct, setDefaultDiscountPct] = useState<string>("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh prefilled fields whenever the modal opens with new OCR data —
  // otherwise stale values from a previous open stick around when the
  // admin clicks "+" on a different document.
  useEffect(() => {
    if (open) {
      setName(initialName?.trim() || "");
      setTaxId(initialTaxId?.trim() || "");
      setExpenseType("goods_purchases");
      setVatType("regular");
      setDefaultDiscountPct("");
      setPhone("");
      setEmail("");
      setNotes("");
      setError(null);
    }
  }, [open, initialName, initialTaxId]);

  const handleSave = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("נא למלא שם ספק");
      return;
    }
    if (!businessId) {
      setError("לא נבחר עסק — בחרו עסק מהתפריט בראש הדף לפני הוספת ספק");
      return;
    }
    setIsSaving(true);
    try {
      const supabase = createClient();
      const discountPctNum = parseFloat(defaultDiscountPct);
      const insertRow: Record<string, unknown> = {
        business_id: businessId,
        name: trimmedName,
        expense_type: expenseType,
        vat_type: vatType,
        is_active: true,
      };
      if (taxId.trim()) insertRow.tax_id = taxId.trim();
      if (phone.trim()) insertRow.phone = phone.trim();
      if (email.trim()) insertRow.email = email.trim();
      if (notes.trim()) insertRow.notes = notes.trim();
      if (!Number.isNaN(discountPctNum) && discountPctNum > 0) {
        insertRow.default_discount_percentage = discountPctNum;
      }

      const { data, error: insertError } = await supabase
        .from("suppliers")
        .insert(insertRow)
        .select("id")
        .single();

      if (insertError) {
        console.error("[QuickAddSupplier] insert failed:", insertError);
        setError(`שגיאה בהוספת ספק: ${insertError.message}`);
        setIsSaving(false);
        return;
      }
      if (!data?.id) {
        setError("הוספה הצליחה אבל לא הוחזר מזהה — נסו לרענן");
        setIsSaving(false);
        return;
      }
      onCreated(data.id);
      onOpenChange(false);
    } catch (err) {
      console.error("[QuickAddSupplier] unexpected error:", err);
      const msg = err instanceof Error ? err.message : "שגיאה לא ידועה";
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-[#0F1535] border-t border-white/10 max-h-[85vh] overflow-y-auto"
      >
        <SheetHeader className="text-right">
          <SheetTitle className="text-white text-[18px] font-bold">
            הוספת ספק חדש
          </SheetTitle>
          <p className="text-[12px] text-white/60 mt-1">
            הקלידו את הפרטים הבסיסיים — אפשר להשלים שאר השדות אחר כך מעמוד הספקים.
          </p>
        </SheetHeader>

        <div dir="rtl" className="flex flex-col gap-[14px] mt-[16px] px-[4px]">
          {/* Name */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[13px] font-medium text-white text-right">
              <span className="text-[#F64E60]">*</span> שם ספק
            </label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="לדוגמה: מאפיית אבי"
              className="h-[44px] bg-transparent border border-[#4C526B] text-white text-right rounded-[8px] px-[12px]"
            />
          </div>

          {/* Tax ID */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[13px] font-medium text-white text-right">
              ח.פ / עוסק מורשה
            </label>
            <Input
              type="text"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="9 ספרות"
              className="h-[44px] bg-transparent border border-[#4C526B] text-white text-center rounded-[8px] px-[12px]"
              dir="ltr"
            />
          </div>

          {/* Expense type */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[13px] font-medium text-white text-right">
              <span className="text-[#F64E60]">*</span> סוג הוצאה
            </label>
            <div className="grid grid-cols-3 gap-[6px]">
              {EXPENSE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setExpenseType(opt.value)}
                  className={`h-[42px] rounded-[8px] border text-[12px] transition ${
                    expenseType === opt.value
                      ? "bg-[#29318A] border-white text-white font-semibold"
                      : "bg-transparent border-[#4C526B] text-white/70 hover:border-white/40"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* VAT type */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[13px] font-medium text-white text-right">
              סטטוס מע״מ
            </label>
            <div className="grid grid-cols-2 gap-[6px]">
              {VAT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setVatType(opt.value)}
                  className={`h-[42px] rounded-[8px] border text-[12px] transition ${
                    vatType === opt.value
                      ? "bg-[#29318A] border-white text-white font-semibold"
                      : "bg-transparent border-[#4C526B] text-white/70 hover:border-white/40"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Default discount */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[13px] font-medium text-white text-right">
              אחוז הנחה ברירת מחדל
            </label>
            <div className="border border-[#4C526B] rounded-[8px] h-[44px] flex items-center">
              <span className="text-white/50 text-[13px] pr-[10px]">%</span>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={defaultDiscountPct}
                onChange={(e) => setDefaultDiscountPct(e.target.value)}
                placeholder="0"
                className="w-full h-full bg-transparent text-white text-[13px] text-center rounded-[8px] border-none outline-none px-[10px] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-[10px]">
            <div className="flex flex-col gap-[5px]">
              <label className="text-[13px] font-medium text-white text-right">טלפון</label>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="050-0000000"
                className="h-[44px] bg-transparent border border-[#4C526B] text-white text-center rounded-[8px] px-[10px]"
              />
            </div>
            <div className="flex flex-col gap-[5px]">
              <label className="text-[13px] font-medium text-white text-right">אימייל</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                className="h-[44px] bg-transparent border border-[#4C526B] text-white text-center rounded-[8px] px-[10px]"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[13px] font-medium text-white text-right">הערות</label>
            <Input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="(אופציונלי)"
              className="h-[44px] bg-transparent border border-[#4C526B] text-white text-right rounded-[8px] px-[12px]"
            />
          </div>

          {error && (
            <div className="bg-[#F64E60]/10 border border-[#F64E60]/40 text-[#F64E60] text-[12px] rounded-[8px] px-[12px] py-[8px] text-right">
              {error}
            </div>
          )}

          <div className="flex gap-[8px] mt-[8px]">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
              className="flex-1 h-[46px] bg-transparent border border-[#4C526B] text-white text-[14px] rounded-[8px]"
            >
              ביטול
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !name.trim()}
              className="flex-1 h-[46px] bg-[#29318A] hover:bg-[#3D44A0] text-white text-[14px] font-semibold rounded-[8px] disabled:opacity-50"
            >
              {isSaving ? "שומר…" : "שמור ספק"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
