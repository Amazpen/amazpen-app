"use client";

// ---------------------------------------------------------------------------
// KartesetCheckPanel
// ---------------------------------------------------------------------------
// "בדיקת כרטסת" — supplier-statement reconciliation tool shown as a tab on
// /ocr (קליטת מסמכים). The user receives a כרטסת (statement) from the
// supplier listing invoices/payments on the supplier's side; this panel
// pulls every invoice + payment we have for that supplier in the chosen
// date range so the user can tick off each line that matches and spot
// rows that are missing from one side or the other.
//
// Persistence: when the user toggles a row we write
// invoices.karteset_checked_at / payments.karteset_checked_at directly
// (optimistic, with rollback on failure). When the user comes back they
// see green/grey markers and only touch the new stuff.
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

interface Supplier {
  id: string;
  name: string;
}

interface KartesetRow {
  kind: "invoice" | "payment";
  id: string;
  date: string;                 // YYYY-MM-DD
  reference: string | null;     // invoice_number or payment reference
  total: number;                // total_amount (כולל מע"מ for invoices, total_amount for payments)
  statusLabel: string;          // "שולם" / "ממתין לתשלום" / "תשלום שיצא" וכו'
  statusColor: string;          // tailwind text color class
  isChecked: boolean;           // karteset_checked_at != null
  checkedAt: string | null;
}

interface KartesetCheckPanelProps {
  businessId: string;
  suppliers: Supplier[];
  initialSupplierId?: string;
}

// Format date as YYYY-MM-DD using local timezone (avoids UTC shift)
const toLocalDateStr = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const formatDateDisplay = (s: string) => {
  const [y, m, d] = s.split("T")[0].split("-");
  return `${d}/${m}/${y.slice(2)}`;
};

const fmtMoney = (n: number) =>
  n.toLocaleString("he-IL", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });

// Auto-check rule: treat a row as "verified by the system" when at least 2 of
// the 3 key data points were captured cleanly — date, document number
// (reference) and a non-zero amount. This mimics the manual statement check:
// if the OCR pulled enough of the line in, we tick it off automatically so the
// user only has to eyeball the rows that are missing data.
const qualifiesForAutoCheck = (row: { date: string | null; reference: string | null; total: number }) => {
  let points = 0;
  if (row.date && row.date.trim() !== "") points++;
  if (row.reference && row.reference.trim() !== "") points++;
  if (Number.isFinite(row.total) && row.total > 0) points++;
  return points >= 2;
};

export default function KartesetCheckPanel({ businessId, suppliers, initialSupplierId }: KartesetCheckPanelProps) {
  const { showToast } = useToast();

  // Defaults: current month
  const [supplierId, setSupplierId] = useState<string>(initialSupplierId || "");
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date();
    return toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [dateTo, setDateTo] = useState<string>(() => {
    const d = new Date();
    return toLocalDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  });

  const [rows, setRows] = useState<KartesetRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  const supplierName = useMemo(
    () => suppliers.find(s => s.id === supplierId)?.name || "",
    [suppliers, supplierId]
  );

  // Fetch invoices + payments for the chosen supplier and date range.
  // Run only when the user explicitly clicks "טען" — supplier + range is a
  // lot of data and auto-fetching on every keystroke kills the network tab.
  const fetchRows = useCallback(async () => {
    if (!supplierId || !dateFrom || !dateTo) {
      showToast("בחר ספק וטווח תאריכים", "warning");
      return;
    }
    setIsLoading(true);
    const supabase = createClient();
    try {
      const [invoicesRes, paymentsRes] = await Promise.all([
        supabase
          .from("invoices")
          .select("id, invoice_number, invoice_date, total_amount, status, karteset_checked_at")
          .eq("business_id", businessId)
          .eq("supplier_id", supplierId)
          .is("deleted_at", null)
          .neq("status", "cancelled")
          .gte("invoice_date", dateFrom)
          .lte("invoice_date", dateTo)
          .order("invoice_date", { ascending: true }),
        supabase
          .from("payments")
          .select("id, payment_date, total_amount, karteset_checked_at, notes")
          .eq("business_id", businessId)
          .eq("supplier_id", supplierId)
          .is("deleted_at", null)
          .gte("payment_date", dateFrom)
          .lte("payment_date", dateTo)
          .order("payment_date", { ascending: true }),
      ]);

      if (invoicesRes.error) throw invoicesRes.error;
      if (paymentsRes.error) throw paymentsRes.error;

      const merged: KartesetRow[] = [];

      for (const inv of (invoicesRes.data || [])) {
        const statusLabel =
          inv.status === "paid" ? "שולם" :
          inv.status === "clarification" ? "בבירור" :
          "ממתין לתשלום";
        const statusColor =
          inv.status === "paid" ? "text-emerald-300" :
          inv.status === "clarification" ? "text-purple-300" :
          "text-orange-300";
        merged.push({
          kind: "invoice",
          id: inv.id,
          date: inv.invoice_date,
          reference: inv.invoice_number || null,
          total: Number(inv.total_amount) || 0,
          statusLabel,
          statusColor,
          isChecked: !!inv.karteset_checked_at,
          checkedAt: inv.karteset_checked_at,
        });
      }

      for (const p of (paymentsRes.data || [])) {
        merged.push({
          kind: "payment",
          id: p.id,
          date: p.payment_date,
          reference: p.notes ? String(p.notes).slice(0, 30) : null,
          total: Number(p.total_amount) || 0,
          statusLabel: "תשלום שיצא",
          statusColor: "text-blue-300",
          isChecked: !!p.karteset_checked_at,
          checkedAt: p.karteset_checked_at,
        });
      }

      // Sort by date ascending; same date — invoice before payment
      merged.sort((a, b) => {
        const d = a.date.localeCompare(b.date);
        if (d !== 0) return d;
        if (a.kind !== b.kind) return a.kind === "invoice" ? -1 : 1;
        return 0;
      });

      // Auto-check: rows the OCR captured well enough (2 of 3 — date / number /
      // amount) get ticked automatically so the user only reviews the gaps.
      // Only touch rows that aren't already checked, then persist the new
      // marks to the DB so they stick on the next visit (same column the
      // manual toggle writes).
      const autoTs = new Date().toISOString();
      const autoInvoiceIds: string[] = [];
      const autoPaymentIds: string[] = [];
      for (const r of merged) {
        if (!r.isChecked && qualifiesForAutoCheck(r)) {
          r.isChecked = true;
          r.checkedAt = autoTs;
          if (r.kind === "invoice") autoInvoiceIds.push(r.id);
          else autoPaymentIds.push(r.id);
        }
      }
      if (autoInvoiceIds.length > 0) {
        const { error: aiErr } = await supabase.from("invoices").update({ karteset_checked_at: autoTs }).in("id", autoInvoiceIds);
        if (aiErr) console.error("Karteset auto-check (invoices) failed:", aiErr);
      }
      if (autoPaymentIds.length > 0) {
        const { error: apErr } = await supabase.from("payments").update({ karteset_checked_at: autoTs }).in("id", autoPaymentIds);
        if (apErr) console.error("Karteset auto-check (payments) failed:", apErr);
      }

      setRows(merged);
      setHasFetched(true);
      const autoCount = autoInvoiceIds.length + autoPaymentIds.length;
      if (autoCount > 0) {
        showToast(`${autoCount} שורות סומנו אוטומטית (זוהו 2 מתוך 3: תאריך/מספר/סכום)`, "success");
      }
    } catch (err) {
      console.error("Karteset fetch failed:", err);
      showToast("שגיאה בטעינת הכרטסת", "error");
    } finally {
      setIsLoading(false);
    }
  }, [businessId, supplierId, dateFrom, dateTo, showToast]);

  // Toggle the check mark on one row (optimistic; rollback on failure).
  const toggleCheck = useCallback(async (row: KartesetRow) => {
    const supabase = createClient();
    const nextVal = row.isChecked ? null : new Date().toISOString();
    const table = row.kind === "invoice" ? "invoices" : "payments";

    // Optimistic
    setRows(prev => prev.map(r =>
      (r.kind === row.kind && r.id === row.id)
        ? { ...r, isChecked: !r.isChecked, checkedAt: nextVal }
        : r
    ));

    try {
      const { error } = await supabase
        .from(table)
        .update({ karteset_checked_at: nextVal })
        .eq("id", row.id);
      if (error) throw error;
    } catch (err) {
      console.error("Karteset toggle failed:", err);
      showToast("שגיאה בעדכון סימון", "error");
      // Rollback
      setRows(prev => prev.map(r =>
        (r.kind === row.kind && r.id === row.id)
          ? { ...r, isChecked: row.isChecked, checkedAt: row.checkedAt }
          : r
      ));
    }
  }, [showToast]);

  // Bulk: mark every row as checked at once (lets the user blast through a
  // statement that fully matches without 30 individual clicks).
  const markAllChecked = useCallback(async () => {
    if (rows.length === 0) return;
    const supabase = createClient();
    const ts = new Date().toISOString();
    const invoiceIds = rows.filter(r => r.kind === "invoice" && !r.isChecked).map(r => r.id);
    const paymentIds = rows.filter(r => r.kind === "payment" && !r.isChecked).map(r => r.id);
    if (invoiceIds.length === 0 && paymentIds.length === 0) {
      showToast("הכל כבר מסומן", "info");
      return;
    }
    setRows(prev => prev.map(r => r.isChecked ? r : { ...r, isChecked: true, checkedAt: ts }));
    try {
      if (invoiceIds.length > 0) {
        await supabase.from("invoices").update({ karteset_checked_at: ts }).in("id", invoiceIds);
      }
      if (paymentIds.length > 0) {
        await supabase.from("payments").update({ karteset_checked_at: ts }).in("id", paymentIds);
      }
      showToast(`סומנו ${invoiceIds.length + paymentIds.length} שורות`, "success");
    } catch (err) {
      console.error("Karteset bulk mark failed:", err);
      showToast("שגיאה בסימון מרוכז", "error");
    }
  }, [rows, showToast]);

  // Bulk: clear the check mark on every row at once (undo for "סמן הכל כנבדק"
  // and for the auto-check — lets the user reset and re-verify from scratch).
  const markAllUnchecked = useCallback(async () => {
    if (rows.length === 0) return;
    const supabase = createClient();
    const invoiceIds = rows.filter(r => r.kind === "invoice" && r.isChecked).map(r => r.id);
    const paymentIds = rows.filter(r => r.kind === "payment" && r.isChecked).map(r => r.id);
    if (invoiceIds.length === 0 && paymentIds.length === 0) {
      showToast("אין שורות מסומנות", "info");
      return;
    }
    setRows(prev => prev.map(r => r.isChecked ? { ...r, isChecked: false, checkedAt: null } : r));
    try {
      if (invoiceIds.length > 0) {
        await supabase.from("invoices").update({ karteset_checked_at: null }).in("id", invoiceIds);
      }
      if (paymentIds.length > 0) {
        await supabase.from("payments").update({ karteset_checked_at: null }).in("id", paymentIds);
      }
      showToast(`בוטל הסימון של ${invoiceIds.length + paymentIds.length} שורות`, "success");
    } catch (err) {
      console.error("Karteset bulk unmark failed:", err);
      showToast("שגיאה בביטול סימון מרוכז", "error");
    }
  }, [rows, showToast]);

  // Totals — show separate sums for invoices and payments and a net balance,
  // because for a statement check the user is comparing two parallel columns
  // (what we owe vs. what we paid) and a single grand total would just
  // confuse the reconciliation.
  const totals = useMemo(() => {
    let invoicesSum = 0;
    let paymentsSum = 0;
    let checkedSum = 0;
    let uncheckedCount = 0;
    for (const r of rows) {
      if (r.kind === "invoice") invoicesSum += r.total;
      else paymentsSum += r.total;
      if (r.isChecked) checkedSum += r.total;
      else uncheckedCount++;
    }
    return { invoicesSum, paymentsSum, balance: invoicesSum - paymentsSum, checkedSum, uncheckedCount };
  }, [rows]);

  // Reset hasFetched when the user changes filters (so they know they need to re-load).
  useEffect(() => {
    setHasFetched(false);
    setRows([]);
  }, [supplierId, dateFrom, dateTo]);

  const gridCols = "grid-cols-[36px_90px_1.2fr_110px_110px_60px]";

  return (
    <div dir="rtl" className="flex flex-col gap-[12px] p-[4px]">
      {/* Filters */}
      <div className="bg-[#0F1535] border border-[#727BA0] rounded-[10px] p-[12px] flex flex-col gap-[10px]">
        <h3 className="text-[16px] font-bold text-white">בדיקת כרטסת</h3>
        <p className="text-[12px] text-white/60 leading-[1.5]">
          טען את כל החשבוניות והתשלומים של ספק לטווח תאריכים, וסמן ✓ כל שורה שמופיעה גם בכרטסת שקיבלת מהספק.
          הסימון נשמר אוטומטית — בפעם הבאה תראה מה כבר אישרת.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_140px_100px] gap-[8px]">
          {/* Supplier */}
          <div className="flex flex-col gap-[4px]">
            <label className="text-[12px] text-white/70">שם הספק</label>
            <Select value={supplierId || "__none__"} onValueChange={(v) => setSupplierId(v === "__none__" ? "" : v)}>
              <SelectTrigger className="bg-transparent border border-[#727BA0] rounded-[8px] h-[40px] px-[10px] text-[14px] text-white text-right">
                <SelectValue placeholder="בחר ספק..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" disabled>בחר ספק...</SelectItem>
                {suppliers.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date from */}
          <div className="flex flex-col gap-[4px]">
            <label className="text-[12px] text-white/70">מתאריך</label>
            <DatePickerField
              value={dateFrom}
              onChange={setDateFrom}
              placeholder="מתאריך"
              className="bg-transparent border border-[#727BA0] rounded-[8px] h-[40px] px-[10px] text-[14px] text-white"
            />
          </div>

          {/* Date to */}
          <div className="flex flex-col gap-[4px]">
            <label className="text-[12px] text-white/70">עד תאריך</label>
            <DatePickerField
              value={dateTo}
              onChange={setDateTo}
              placeholder="עד תאריך"
              className="bg-transparent border border-[#727BA0] rounded-[8px] h-[40px] px-[10px] text-[14px] text-white"
            />
          </div>

          {/* Load button */}
          <div className="flex flex-col gap-[4px]">
            <label className="text-[12px] text-transparent">.</label>
            <Button
              type="button"
              onClick={fetchRows}
              disabled={!supplierId || isLoading}
              className="bg-[#29318A] hover:bg-[#3D44A0] text-white text-[14px] font-semibold rounded-[8px] h-[40px] transition-colors disabled:opacity-50"
            >
              {isLoading ? "טוען..." : "טען"}
            </Button>
          </div>
        </div>
      </div>

      {/* Results */}
      {hasFetched && (
        <div className="bg-[#0F1535] border border-[#727BA0] rounded-[10px] p-[12px] flex flex-col gap-[10px]">
          <div className="flex items-center justify-between flex-wrap gap-[8px]">
            <div className="flex items-center gap-[10px]">
              <span className="text-[14px] font-bold text-white">{supplierName}</span>
              <span className="text-[12px] text-white/50 ltr-num">
                {formatDateDisplay(dateFrom)} — {formatDateDisplay(dateTo)}
              </span>
            </div>
            {rows.length > 0 && (
              <div className="flex items-center gap-[8px]">
                {totals.uncheckedCount > 0 && (
                  <Button
                    type="button"
                    onClick={markAllChecked}
                    className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-[12px] font-semibold px-[12px] py-[6px] rounded-[6px] transition-colors"
                  >
                    ✓ סמן הכל כנבדק
                  </Button>
                )}
                {totals.uncheckedCount < rows.length && (
                  <Button
                    type="button"
                    onClick={markAllUnchecked}
                    className="bg-white/5 hover:bg-white/10 text-white/70 text-[12px] font-semibold px-[12px] py-[6px] rounded-[6px] transition-colors"
                  >
                    ✕ בטל סימון להכל
                  </Button>
                )}
              </div>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="text-center text-white/50 py-[30px] text-[14px]">
              אין חשבוניות או תשלומים עבור הספק והטווח שנבחרו
            </div>
          ) : (
            <div className="w-full flex flex-col">
              {/* Table header */}
              <div className={`grid ${gridCols} bg-[#29318A] rounded-t-[7px] p-[10px_5px] items-center text-[12px] font-semibold text-white gap-[4px]`}>
                <span className="text-center">✓</span>
                <span className="text-center">תאריך</span>
                <span className="text-right ps-[5px]">מספר / תיאור</span>
                <span className="text-center">סכום כולל מע&quot;מ</span>
                <span className="text-center">סטטוס</span>
                <span className="text-center">סוג</span>
              </div>

              {/* Rows */}
              <div className="max-h-[70vh] min-h-[300px] overflow-y-auto flex flex-col gap-[2px]">
                {rows.map(row => (
                  <div
                    key={`${row.kind}-${row.id}`}
                    className={`grid ${gridCols} w-full p-[8px_5px] items-center text-[12px] text-white border-b border-white/5 gap-[4px] transition-colors ${
                      row.isChecked ? "bg-emerald-500/10" : "hover:bg-white/[0.03]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleCheck(row)}
                      className={`flex items-center justify-center w-[24px] h-[24px] rounded-[4px] border transition-colors mx-auto ${
                        row.isChecked
                          ? "bg-emerald-500/40 border-emerald-400 text-emerald-100"
                          : "bg-transparent border-white/30 text-transparent hover:border-white/60"
                      }`}
                      aria-label={row.isChecked ? "הסר סימון" : "סמן כנבדק"}
                    >
                      {row.isChecked ? "✓" : ""}
                    </button>
                    <span className="text-center ltr-num">{formatDateDisplay(row.date)}</span>
                    <span className="text-right ps-[5px] truncate" title={row.reference || ""}>
                      {row.reference || <span className="text-white/30">—</span>}
                    </span>
                    <span className="text-center ltr-num font-semibold">₪{fmtMoney(row.total)}</span>
                    <span className={`text-center ${row.statusColor}`}>{row.statusLabel}</span>
                    <span className={`text-center text-[11px] ${row.kind === "invoice" ? "text-orange-200" : "text-blue-200"}`}>
                      {row.kind === "invoice" ? "חשבונית" : "תשלום"}
                    </span>
                  </div>
                ))}
              </div>

              {/* Footer totals */}
              <div className={`grid ${gridCols} bg-[#29318A]/60 rounded-b-[7px] p-[10px_5px] items-center text-[12px] font-bold text-white border-t-2 border-white/30 gap-[4px]`}>
                <span></span>
                <span className="text-center">סה&quot;כ</span>
                <span className="text-right ps-[5px] text-white/70">
                  {rows.length} שורות · {totals.uncheckedCount > 0 ? `${totals.uncheckedCount} לא נבדקו` : "הכל נבדק"}
                </span>
                <span className="text-center ltr-num">₪{fmtMoney(totals.checkedSum)}</span>
                <span></span>
                <span></span>
              </div>

              {/* Summary footer with both sums + balance */}
              <div className="mt-[10px] grid grid-cols-3 gap-[8px] text-[12px]">
                <div className="bg-orange-500/10 border border-orange-400/30 rounded-[6px] px-[10px] py-[6px] text-center">
                  <div className="text-orange-200">סה&quot;כ חשבוניות</div>
                  <div className="text-white font-bold ltr-num">₪{fmtMoney(totals.invoicesSum)}</div>
                </div>
                <div className="bg-blue-500/10 border border-blue-400/30 rounded-[6px] px-[10px] py-[6px] text-center">
                  <div className="text-blue-200">סה&quot;כ תשלומים</div>
                  <div className="text-white font-bold ltr-num">₪{fmtMoney(totals.paymentsSum)}</div>
                </div>
                <div className={`border rounded-[6px] px-[10px] py-[6px] text-center ${
                  totals.balance > 0.01
                    ? "bg-yellow-500/10 border-yellow-400/30"
                    : totals.balance < -0.01
                      ? "bg-purple-500/10 border-purple-400/30"
                      : "bg-emerald-500/10 border-emerald-400/30"
                }`}>
                  <div className="text-white/70">יתרה (חשבוניות − תשלומים)</div>
                  <div className="text-white font-bold ltr-num">₪{fmtMoney(totals.balance)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
