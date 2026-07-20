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

// A parsed line from the supplier statement (כרטסת) the user pastes in.
interface StatementLine {
  date: string | null;     // YYYY-MM-DD if parseable
  reference: string | null; // document number
  amount: number | null;    // absolute amount
  raw: string;              // original text line
}

// Parse pasted statement text into structured lines. The user pastes rows
// copied from the supplier's כרטסת; each line typically has a date, a document
// number, and an amount somewhere in it. We extract those three with tolerant
// regexes (Hebrew statements vary wildly in column order/separators).
function parseStatementText(text: string): StatementLine[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out: StatementLine[] = [];
  for (const line of lines) {
    // Date: dd/mm/yy(yy) or dd.mm.yy(yy) or dd-mm-yy(yy)
    const dateMatch = line.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    let date: string | null = null;
    if (dateMatch) {
      const d = dateMatch[1].padStart(2, "0");
      const m = dateMatch[2].padStart(2, "0");
      let y = dateMatch[3];
      if (y.length === 2) y = `20${y}`;
      date = `${y}-${m}-${d}`;
    }
    // Amount: the largest number with optional decimals (statements list the
    // line amount; we take the max number on the line that isn't the doc/date).
    const numbers = (line.match(/-?[\d,]+\.?\d*/g) || [])
      .map(n => parseFloat(n.replace(/,/g, "")))
      .filter(n => Number.isFinite(n) && Math.abs(n) >= 1);
    const amount = numbers.length > 0 ? Math.abs(numbers.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a))) : null;
    // Reference: a run of 4+ digits that isn't part of the date.
    const refCandidates = (line.match(/\d{4,}/g) || []).filter(r => !dateMatch || !dateMatch[0].includes(r));
    const reference = refCandidates.length > 0 ? refCandidates[0] : null;
    out.push({ date, reference, amount, raw: line });
  }
  return out;
}

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
  // Raw statement text pasted by the user (from the supplier's כרטסת).
  const [statementText, setStatementText] = useState("");
  const [showStatementInput, setShowStatementInput] = useState(false);

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

      // No blanket auto-check: the previous version ticked every row with 2 of
      // 3 fields, which marked the WHOLE month (every מצפן invoice has date +
      // number + amount) even when those lines weren't on the statement at all.
      // Matching against the statement now happens only when the user pastes
      // the כרטסת text (see statementLines / matching below).
      setRows(merged);
      setHasFetched(true);
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
      // Checked total is a running ledger balance: invoices add (what we owe),
      // payments (תשלום שיצא) subtract (what we already paid). A statement is a
      // debit/credit reconciliation, so a payment must reduce the marked total.
      if (r.isChecked) checkedSum += r.kind === "invoice" ? r.total : -r.total;
      else uncheckedCount++;
    }
    return { invoicesSum, paymentsSum, balance: invoicesSum - paymentsSum, checkedSum, uncheckedCount };
  }, [rows]);

  // Compare the pasted statement against מצפן rows.
  // A statement line is "missing from מצפן" when no מצפן row matches it.
  // Match priority: document number, else (date + amount within ₪1).
  const statementLines = useMemo(() => parseStatementText(statementText), [statementText]);

  const missingFromMatzpen = useMemo(() => {
    if (statementLines.length === 0) return [];
    const refs = new Set(rows.map(r => (r.reference || "").replace(/\D/g, "")).filter(Boolean));
    const missing: StatementLine[] = [];
    for (const line of statementLines) {
      const lineRef = (line.reference || "").replace(/\D/g, "");
      let matched = false;
      if (lineRef && refs.has(lineRef)) {
        matched = true;
      } else if (line.amount != null) {
        // Fall back to date + amount match (±₪1, same day).
        matched = rows.some(r =>
          Math.abs(r.total - (line.amount as number)) <= 1 &&
          (!line.date || r.date.split("T")[0] === line.date)
        );
      }
      if (!matched) missing.push(line);
    }
    return missing;
  }, [statementLines, rows]);

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
          הסימון נשמר אוטומטית - בפעם הבאה תראה מה כבר אישרת.
        </p>

        {/* Container-safe layout: this panel lives inside the narrow OCR
            sidebar, so we must NOT rely on viewport `sm:` breakpoints (they
            key off the wide screen and forced a 4-col grid whose fixed
            columns overflowed the sidebar, clipping the "טען" button off the
            left edge). Stack supplier full-width, dates in a 2-col row, and
            keep the load button on its own full-width row so it is always
            visible regardless of container width. */}
        <div className="flex flex-col gap-[8px]">
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

          {/* Dates */}
          <div className="grid grid-cols-2 gap-[8px]">
            {/* Date from */}
            <div className="flex flex-col gap-[4px] min-w-0">
              <label className="text-[12px] text-white/70">מתאריך</label>
              <DatePickerField
                value={dateFrom}
                onChange={setDateFrom}
                placeholder="מתאריך"
                className="bg-transparent border border-[#727BA0] rounded-[8px] h-[40px] px-[10px] text-[14px] text-white"
              />
            </div>

            {/* Date to */}
            <div className="flex flex-col gap-[4px] min-w-0">
              <label className="text-[12px] text-white/70">עד תאריך</label>
              <DatePickerField
                value={dateTo}
                onChange={setDateTo}
                placeholder="עד תאריך"
                className="bg-transparent border border-[#727BA0] rounded-[8px] h-[40px] px-[10px] text-[14px] text-white"
              />
            </div>
          </div>

          {/* Load button — full width, own row, never clipped */}
          <Button
            type="button"
            onClick={fetchRows}
            disabled={!supplierId || isLoading}
            className="w-full bg-[#29318A] hover:bg-[#3D44A0] text-white text-[14px] font-semibold rounded-[8px] h-[40px] transition-colors disabled:opacity-50"
          >
            {isLoading ? "טוען..." : "טען"}
          </Button>
        </div>
      </div>

      {/* Results */}
      {hasFetched && (
        <div className="bg-[#0F1535] border border-[#727BA0] rounded-[10px] p-[12px] flex flex-col gap-[10px]">
          <div className="flex items-center justify-between flex-wrap gap-[8px]">
            <div className="flex items-center gap-[10px]">
              <span className="text-[14px] font-bold text-white">{supplierName}</span>
              <span className="text-[12px] text-white/50 ltr-num">
                {formatDateDisplay(dateFrom)} - {formatDateDisplay(dateTo)}
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

              {/* Statement comparison — paste the כרטסת text and the system
                  flags lines that appear in the statement but NOT in מצפן. */}
              <div className="mt-[14px] border-t border-white/15 pt-[12px] flex flex-col gap-[8px]">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-bold text-white">השוואה מול כרטסת הספק</span>
                  <Button
                    type="button"
                    onClick={() => setShowStatementInput(v => !v)}
                    className="text-[12px] text-[#00D4FF] hover:text-white transition-colors"
                  >
                    {showStatementInput ? "הסתר" : "הדבק תנועות מהכרטסת"}
                  </Button>
                </div>

                {showStatementInput && (
                  <>
                    <p className="text-[11px] text-white/50 leading-[1.5]">
                      העתק את שורות הכרטסת מהספק והדבק כאן (כל תנועה בשורה - תאריך, מספר מסמך וסכום).
                      המערכת תזהה אילו תנועות קיימות בכרטסת אך חסרות במצפן.
                    </p>
                    <textarea
                      value={statementText}
                      onChange={(e) => setStatementText(e.target.value)}
                      placeholder={"28/04/26  439756  1,451.40\n28/04/26  439814  1,804.00\n..."}
                      rows={5}
                      dir="ltr"
                      className="w-full bg-[#1a1f4e] border border-[#727BA0] rounded-[8px] p-[10px] text-[12px] text-white ltr-num resize-y focus:outline-none focus:border-[#4956D4]"
                    />
                  </>
                )}

                {statementLines.length > 0 && (
                  <div className="flex flex-col gap-[6px]">
                    {missingFromMatzpen.length === 0 ? (
                      <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-[6px] px-[12px] py-[8px] text-[13px] text-emerald-200 text-center">
                        ✓ כל {statementLines.length} התנועות מהכרטסת קיימות במצפן
                      </div>
                    ) : (
                      <div className="bg-[#F64E60]/10 border border-[#F64E60]/40 rounded-[8px] p-[10px]">
                        <div className="text-[14px] font-bold text-[#F64E60] mb-[8px]">
                          תנועות חסרות - יש בכרטסת ואין במצפן ({missingFromMatzpen.length})
                        </div>
                        <div className="grid grid-cols-[90px_1fr_110px] text-[11px] text-white/50 font-medium pb-[4px] border-b border-white/10">
                          <span>תאריך</span>
                          <span>מספר מסמך</span>
                          <span className="text-left">סכום</span>
                        </div>
                        <div className="flex flex-col gap-[2px] max-h-[200px] overflow-y-auto mt-[4px]">
                          {missingFromMatzpen.map((line, i) => (
                            <div key={i} className="grid grid-cols-[90px_1fr_110px] text-[12px] text-white py-[3px] ltr-num">
                              <span>{line.date ? formatDateDisplay(line.date) : "—"}</span>
                              <span className="truncate" title={line.raw}>{line.reference || "—"}</span>
                              <span className="text-left font-semibold">{line.amount != null ? `₪${fmtMoney(line.amount)}` : "—"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
