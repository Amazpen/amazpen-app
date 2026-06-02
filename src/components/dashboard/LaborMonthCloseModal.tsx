"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Plus } from "lucide-react";

interface EmployeeSupplier { id: string; name: string; }

interface CloseLineState {
  key: string;
  supplier_id: string;
  label: string;
  estimate: number;
  amount: string; // user-entered actual
}

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: string;
  year: number;
  month: number;
  salaryEstimate: number;       // rawLabor + manager (no markup)
  employerEstimate: number;     // markup delta (pension/NI/severance proxy)
  employeeSuppliers: EmployeeSupplier[];
  onClosed: () => void;         // refresh callback
}

const monthNames = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

export function LaborMonthCloseModal({
  open, onClose, businessId, year, month,
  salaryEstimate, employerEstimate, employeeSuppliers, onClosed,
}: Props) {
  const [lines, setLines] = useState<CloseLineState[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On open: provision the salary supplier and pre-fill lines.
  useEffect(() => {
    if (!open) return;
    (async () => {
      setError(null);
      const res = await fetch("/api/labor-close/salary-supplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId }),
      });
      const json = await res.json();
      const salaryId = json?.supplier?.id || "";

      const initial: CloseLineState[] = [
        { key: "salary", supplier_id: salaryId, label: "שכר עובדים", estimate: Math.round(salaryEstimate), amount: String(Math.round(salaryEstimate)) },
        ...employeeSuppliers.map((s, i) => ({
          key: `sup-${s.id}-${i}`, supplier_id: s.id, label: s.name, estimate: 0, amount: "",
        })),
      ];
      setLines(initial);
    })();
  }, [open, businessId, salaryEstimate, employeeSuppliers]);

  const addLine = () => {
    setLines((prev) => [...prev, { key: `extra-${prev.length}`, supplier_id: "", label: "", estimate: 0, amount: "" }]);
  };

  const updateLine = (key: string, patch: Partial<CloseLineState>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const estimateTotal = Math.round(salaryEstimate + employerEstimate);
  const actualTotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const payload = {
      business_id: businessId,
      year, month,
      estimate_total: estimateTotal,
      lines: lines
        .filter((l) => l.supplier_id && Number(l.amount) > 0)
        .map((l) => ({ supplier_id: l.supplier_id, amount: Number(l.amount) })),
    };
    if (payload.lines.length === 0) {
      setError("יש להזין לפחות שורה אחת עם סכום.");
      setSaving(false);
      return;
    }
    const res = await fetch("/api/labor-close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setError(json?.error || "שמירה נכשלה"); return; }
    onClosed();
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content
          dir="rtl"
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[92vw] max-w-[560px] max-h-[88vh] overflow-y-auto rounded-[12px] bg-[#1a1d2e] p-5 text-white shadow-xl"
        >
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-[17px] font-bold">
              סגירת חודש עלות עובדים — {monthNames[month - 1]} {year}
            </Dialog.Title>
            <button onClick={onClose} aria-label="סגור" className="text-white/60 hover:text-white">
              <X size={20} />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-[1fr_120px] gap-2 items-center">
                {l.key === "salary" || l.key.startsWith("sup-") ? (
                  <span className="text-[14px]">{l.label}</span>
                ) : (
                  <select
                    value={l.supplier_id}
                    onChange={(e) => {
                      const sup = employeeSuppliers.find((s) => s.id === e.target.value);
                      updateLine(l.key, { supplier_id: e.target.value, label: sup?.name || "" });
                    }}
                    className="bg-[#252a40] rounded-[7px] px-2 py-1.5 text-[14px]"
                  >
                    <option value="">בחר ספק…</option>
                    {employeeSuppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                )}
                <input
                  type="number"
                  inputMode="decimal"
                  value={l.amount}
                  placeholder={l.estimate ? String(l.estimate) : "0"}
                  onChange={(e) => updateLine(l.key, { amount: e.target.value })}
                  className="bg-[#252a40] rounded-[7px] px-2 py-1.5 text-[14px] text-left ltr-num"
                />
              </div>
            ))}
          </div>

          <button onClick={addLine} className="mt-3 flex items-center gap-1 text-[13px] text-[#7c84d8] hover:text-white">
            <Plus size={15} /> הוסף שורה
          </button>

          <div className="mt-4 border-t border-white/10 pt-3 flex flex-col gap-1 text-[14px]">
            <div className="flex justify-between"><span className="text-white/60">סה&quot;כ הערכה</span><span className="ltr-num">{estimateTotal.toLocaleString("he-IL")} ₪</span></div>
            <div className="flex justify-between"><span className="text-white/60">סה&quot;כ בפועל</span><span className="ltr-num font-bold">{actualTotal.toLocaleString("he-IL")} ₪</span></div>
            <div className="flex justify-between"><span className="text-white/60">הפרש</span><span className="ltr-num">{(actualTotal - estimateTotal).toLocaleString("he-IL")} ₪</span></div>
          </div>

          {error && <p className="mt-3 text-[13px] text-[#F64E60]">{error}</p>}

          <div className="mt-5 flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-[#29318A] hover:bg-[#343da3] rounded-[8px] py-2.5 text-[15px] font-bold disabled:opacity-50"
            >
              {saving ? "סוגר…" : "סגור חודש"}
            </button>
            <button onClick={onClose} className="px-4 rounded-[8px] py-2.5 text-[15px] bg-white/10 hover:bg-white/15">ביטול</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
