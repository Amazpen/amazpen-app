'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, Check, CheckCheck, Clock, FileText, CreditCard } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { FIELD_LABELS } from '@/types/approvals';
import type { DailyEntryApproval } from '@/types/approvals';

interface ApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  businessId: string;
  cardFieldNames?: string[];
  cardTitle?: string;
  onApproved: () => void;
}

interface DailyEntryData {
  entry_date: string;
  total_register: number | null;
  labor_cost: number | null;
  labor_hours: number | null;
  discounts: number | null;
  waste: number | null;
  manager_daily_cost: number | null;
}

interface ApprovalWithEntry extends DailyEntryApproval {
  daily_entries: DailyEntryData;
}

interface GroupedEntry {
  daily_entry_id: string;
  entry_date: string;
  entryData: DailyEntryData;
  fields: { approval: DailyEntryApproval; selected: boolean }[];
}

interface PendingInvoice {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  total_amount: number;
  supplier_name: string;
  selected: boolean;
}

interface PendingPayment {
  id: string;
  payment_date: string;
  total_amount: number;
  supplier_name: string;
  selected: boolean;
}

const CURRENCY_FIELDS = new Set([
  'total_register',
  'labor_cost',
  'discounts',
  'waste',
  'manager_daily_cost',
]);

function formatFieldValue(fieldName: string, entryData: DailyEntryData): string {
  const raw = entryData[fieldName as keyof DailyEntryData];
  if (raw === null || raw === undefined) return '—';
  const num = Number(raw);
  if (isNaN(num)) return String(raw);
  if (CURRENCY_FIELDS.has(fieldName)) {
    return `₪${num.toLocaleString('he-IL')}`;
  }
  return num.toLocaleString('he-IL');
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

type TabType = 'daily' | 'invoices' | 'payments';

export default function ApprovalModal({
  isOpen,
  onClose,
  businessId,
  cardFieldNames,
  cardTitle,
  onApproved,
}: ApprovalModalProps) {
  const [groups, setGroups] = useState<GroupedEntry[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<PendingInvoice[]>([]);
  const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('daily');

  const fetchPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();

      // Fetch daily entry approvals
      let query = supabase
        .from('daily_entry_approvals')
        .select(
          `*, daily_entries(entry_date, total_register, labor_cost, labor_hours, discounts, waste, manager_daily_cost)`
        )
        .eq('business_id', businessId)
        .eq('status', 'pending');

      if (cardFieldNames && cardFieldNames.length > 0) {
        query = query.in('field_name', cardFieldNames);
      }

      // Fetch all 3 types in parallel
      const [approvalsRes, invoicesRes, paymentsRes] = await Promise.all([
        query.order('created_at', { ascending: false }),
        // Only fetch invoices/payments when no specific card filter
        !cardFieldNames || cardFieldNames.length === 0
          ? supabase
              .from('invoices')
              .select('id, invoice_number, invoice_date, total_amount, suppliers(name)')
              .eq('business_id', businessId)
              .eq('approval_status', 'pending_review')
              .is('deleted_at', null)
              .order('invoice_date', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        !cardFieldNames || cardFieldNames.length === 0
          ? supabase
              .from('payments')
              .select('id, payment_date, total_amount, suppliers(name)')
              .eq('business_id', businessId)
              .eq('approval_status', 'pending_review')
              .is('deleted_at', null)
              .order('payment_date', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (approvalsRes.error) throw approvalsRes.error;

      const approvals = (approvalsRes.data ?? []) as ApprovalWithEntry[];

      // Group daily approvals by entry
      const groupMap = new Map<string, GroupedEntry>();
      for (const approval of approvals) {
        const entryId = approval.daily_entry_id;
        const entryData = approval.daily_entries;
        if (!groupMap.has(entryId)) {
          groupMap.set(entryId, {
            daily_entry_id: entryId,
            entry_date: entryData.entry_date,
            entryData,
            fields: [],
          });
        }
        groupMap.get(entryId)!.fields.push({ approval, selected: true });
      }
      const sorted = Array.from(groupMap.values()).sort(
        (a, b) => new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime()
      );
      setGroups(sorted);

      // Process invoices
      const invoices: PendingInvoice[] = ((invoicesRes.data ?? []) as unknown as Array<{
        id: string;
        invoice_number: string | null;
        invoice_date: string;
        total_amount: number;
        suppliers: { name: string } | { name: string }[] | null;
      }>).map((inv) => ({
        id: inv.id,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        total_amount: inv.total_amount,
        supplier_name: Array.isArray(inv.suppliers) ? (inv.suppliers[0]?.name || 'ספק לא ידוע') : (inv.suppliers?.name || 'ספק לא ידוע'),
        selected: true,
      }));
      setPendingInvoices(invoices);

      // Process payments
      const payments: PendingPayment[] = ((paymentsRes.data ?? []) as unknown as Array<{
        id: string;
        payment_date: string;
        total_amount: number;
        suppliers: { name: string } | { name: string }[] | null;
      }>).map((pay) => ({
        id: pay.id,
        payment_date: pay.payment_date,
        total_amount: pay.total_amount,
        supplier_name: Array.isArray(pay.suppliers) ? (pay.suppliers[0]?.name || 'ספק לא ידוע') : (pay.suppliers?.name || 'ספק לא ידוע'),
        selected: true,
      }));
      setPendingPayments(payments);

      // Auto-select first tab with data
      if (sorted.length > 0) setActiveTab('daily');
      else if (invoices.length > 0) setActiveTab('invoices');
      else if (payments.length > 0) setActiveTab('payments');
      else setActiveTab('daily');
    } catch (err) {
      console.error('ApprovalModal fetch error:', err);
      setError('שגיאה בטעינת הנתונים');
    } finally {
      setLoading(false);
    }
  }, [businessId, cardFieldNames]);

  useEffect(() => {
    if (isOpen) {
      fetchPending();
    } else {
      setGroups([]);
      setPendingInvoices([]);
      setPendingPayments([]);
      setError(null);
    }
  }, [isOpen, fetchPending]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const dailyCount = groups.reduce((acc, g) => acc + g.fields.length, 0);
  const totalCount = dailyCount + pendingInvoices.length + pendingPayments.length;

  const selectedDailyCount = groups.reduce(
    (acc, g) => acc + g.fields.filter((f) => f.selected).length,
    0
  );
  const selectedInvoiceCount = pendingInvoices.filter((i) => i.selected).length;
  const selectedPaymentCount = pendingPayments.filter((p) => p.selected).length;

  const currentSelectedCount =
    activeTab === 'daily'
      ? selectedDailyCount
      : activeTab === 'invoices'
        ? selectedInvoiceCount
        : selectedPaymentCount;

  const currentTotalCount =
    activeTab === 'daily'
      ? dailyCount
      : activeTab === 'invoices'
        ? pendingInvoices.length
        : pendingPayments.length;

  function toggleField(groupIdx: number, fieldIdx: number) {
    setGroups((prev) =>
      prev.map((g, gi) =>
        gi !== groupIdx
          ? g
          : {
              ...g,
              fields: g.fields.map((f, fi) =>
                fi !== fieldIdx ? f : { ...f, selected: !f.selected }
              ),
            }
      )
    );
  }

  function toggleInvoice(idx: number) {
    setPendingInvoices((prev) =>
      prev.map((inv, i) => (i !== idx ? inv : { ...inv, selected: !inv.selected }))
    );
  }

  function togglePayment(idx: number) {
    setPendingPayments((prev) =>
      prev.map((pay, i) => (i !== idx ? pay : { ...pay, selected: !pay.selected }))
    );
  }

  function selectAllCurrent() {
    if (activeTab === 'daily') {
      setGroups((prev) =>
        prev.map((g) => ({ ...g, fields: g.fields.map((f) => ({ ...f, selected: true })) }))
      );
    } else if (activeTab === 'invoices') {
      setPendingInvoices((prev) => prev.map((i) => ({ ...i, selected: true })));
    } else {
      setPendingPayments((prev) => prev.map((p) => ({ ...p, selected: true })));
    }
  }

  function clearAllCurrent() {
    if (activeTab === 'daily') {
      setGroups((prev) =>
        prev.map((g) => ({ ...g, fields: g.fields.map((f) => ({ ...f, selected: false })) }))
      );
    } else if (activeTab === 'invoices') {
      setPendingInvoices((prev) => prev.map((i) => ({ ...i, selected: false })));
    } else {
      setPendingPayments((prev) => prev.map((p) => ({ ...p, selected: false })));
    }
  }

  async function handleApprove() {
    if (currentSelectedCount === 0) return;
    setApproving(true);
    setError(null);
    try {
      if (activeTab === 'daily') {
        for (const group of groups) {
          const selectedFields = group.fields
            .filter((f) => f.selected)
            .map((f) => ({ field_name: f.approval.field_name, approve: true }));
          if (selectedFields.length === 0) continue;
          const res = await fetch('/api/approvals/daily-entry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              daily_entry_id: group.daily_entry_id,
              fields: selectedFields,
            }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? `שגיאה ${res.status}`);
          }
        }
      } else if (activeTab === 'invoices') {
        for (const inv of pendingInvoices.filter((i) => i.selected)) {
          const res = await fetch('/api/approvals/invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoice_id: inv.id }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? `שגיאה ${res.status}`);
          }
        }
      } else {
        for (const pay of pendingPayments.filter((p) => p.selected)) {
          const res = await fetch('/api/approvals/payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payment_id: pay.id }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? `שגיאה ${res.status}`);
          }
        }
      }
      onApproved();
      // Refresh to update remaining items
      await fetchPending();
      // Close if nothing left
      const remaining = groups.reduce((a, g) => a + g.fields.length, 0) + pendingInvoices.length + pendingPayments.length;
      if (remaining === 0) onClose();
    } catch (err) {
      console.error('ApprovalModal approve error:', err);
      setError(err instanceof Error ? err.message : 'שגיאה באישור');
    } finally {
      setApproving(false);
    }
  }

  if (!isOpen) return null;

  const tabs: { key: TabType; label: string; count: number; icon: typeof Clock }[] = [
    { key: 'daily', label: 'נתונים יומיים', count: dailyCount, icon: Clock },
    { key: 'invoices', label: 'חשבוניות', count: pendingInvoices.length, icon: FileText },
    { key: 'payments', label: 'תשלומים', count: pendingPayments.length, icon: CreditCard },
  ];

  // If opened from a specific card, only show daily tab
  const showTabs = !cardFieldNames || cardFieldNames.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      dir="rtl"
    >
      <div className="bg-[#1a1f4e] rounded-[12px] w-[95vw] max-w-[600px] max-h-[80vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-400 shrink-0" />
            <span className="text-white font-semibold text-[15px]">
              {cardTitle ? `אישור: ${cardTitle}` : 'אישור נתונים ממתינים'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors rounded-[6px] p-1 hover:bg-white/10"
            aria-label="סגור"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        {showTabs && !loading && totalCount > 0 && (
          <div className="flex border-b border-white/10 bg-[#0f1231]">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors relative ${
                  activeTab === tab.key
                    ? 'text-white'
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className={`ltr-num text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                    activeTab === tab.key
                      ? 'bg-amber-500/30 text-amber-300'
                      : 'bg-white/10 text-white/50'
                  }`}>
                    {tab.count}
                  </span>
                )}
                {activeTab === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-amber-400 rounded-full" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Selection bar */}
        {!loading && currentTotalCount > 0 && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-[#0f1231]">
            <span className="text-white/60 text-sm">
              <span className="ltr-num text-white font-medium">{currentSelectedCount}</span>
              {' מתוך '}
              <span className="ltr-num text-white font-medium">{currentTotalCount}</span>
              {' נבחרו'}
            </span>
            <div className="flex gap-2">
              <button
                onClick={selectAllCurrent}
                className="flex items-center gap-1 text-sm text-green-400 hover:text-green-300 transition-colors px-2 py-1 rounded-[6px] hover:bg-green-500/10"
              >
                <CheckCheck className="w-4 h-4" />
                <span>בחר הכל</span>
              </button>
              <button
                onClick={clearAllCurrent}
                className="flex items-center gap-1 text-sm text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded-[6px] hover:bg-white/5"
              >
                <X className="w-4 h-4" />
                <span>נקה הכל</span>
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-white/50 text-sm">
              ...טוען
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16 text-red-400 text-sm">
              {error}
            </div>
          ) : totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-white/40">
              <Check className="w-8 h-8 text-green-400/50" />
              <span className="text-sm">אין נתונים ממתינים לאישור</span>
            </div>
          ) : activeTab === 'daily' && dailyCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-white/40">
              <Check className="w-8 h-8 text-green-400/50" />
              <span className="text-sm">אין שדות יומיים ממתינים לאישור</span>
            </div>
          ) : activeTab === 'invoices' && pendingInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-white/40">
              <Check className="w-8 h-8 text-green-400/50" />
              <span className="text-sm">אין חשבוניות ממתינות לאישור</span>
            </div>
          ) : activeTab === 'payments' && pendingPayments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-white/40">
              <Check className="w-8 h-8 text-green-400/50" />
              <span className="text-sm">אין תשלומים ממתינים לאישור</span>
            </div>
          ) : (
            <div className="px-4 py-3 space-y-4">
              {/* Daily fields tab */}
              {activeTab === 'daily' &&
                groups.map((group, gi) => (
                  <div key={group.daily_entry_id}>
                    <div className="text-white/50 text-xs font-medium mb-2 px-1">
                      <span className="ltr-num">{formatDate(group.entry_date)}</span>
                    </div>
                    <div className="space-y-2">
                      {group.fields.map((fieldItem, fi) => {
                        const label =
                          FIELD_LABELS[fieldItem.approval.field_name] ?? fieldItem.approval.field_name;
                        const value = formatFieldValue(
                          fieldItem.approval.field_name,
                          group.entryData
                        );
                        return (
                          <button
                            key={fieldItem.approval.id}
                            onClick={() => toggleField(gi, fi)}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-[8px] transition-all text-right ${
                              fieldItem.selected
                                ? 'bg-green-500/20 border border-green-500/30'
                                : 'bg-white/5 border border-transparent hover:bg-white/8'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-[20px] h-[20px] rounded-[4px] flex items-center justify-center shrink-0 transition-colors ${
                                  fieldItem.selected ? 'bg-green-500' : 'bg-white/10'
                                }`}
                              >
                                {fieldItem.selected && <Check className="w-3 h-3 text-white" />}
                              </div>
                              <span className="text-white text-sm">{label}</span>
                            </div>
                            <span className="ltr-num text-white/70 text-sm">{value}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

              {/* Invoices tab */}
              {activeTab === 'invoices' &&
                pendingInvoices.map((inv, idx) => (
                  <button
                    key={inv.id}
                    onClick={() => toggleInvoice(idx)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-[8px] transition-all text-right ${
                      inv.selected
                        ? 'bg-green-500/20 border border-green-500/30'
                        : 'bg-white/5 border border-transparent hover:bg-white/8'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-[20px] h-[20px] rounded-[4px] flex items-center justify-center shrink-0 transition-colors ${
                          inv.selected ? 'bg-green-500' : 'bg-white/10'
                        }`}
                      >
                        {inv.selected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-white text-sm">{inv.supplier_name}</span>
                        <span className="text-white/40 text-xs ltr-num">
                          {formatDate(inv.invoice_date)}
                          {inv.invoice_number ? ` · חשבונית ${inv.invoice_number}` : ''}
                        </span>
                      </div>
                    </div>
                    <span className="ltr-num text-white/70 text-sm">
                      ₪{inv.total_amount.toLocaleString('he-IL')}
                    </span>
                  </button>
                ))}

              {/* Payments tab */}
              {activeTab === 'payments' &&
                pendingPayments.map((pay, idx) => (
                  <button
                    key={pay.id}
                    onClick={() => togglePayment(idx)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-[8px] transition-all text-right ${
                      pay.selected
                        ? 'bg-green-500/20 border border-green-500/30'
                        : 'bg-white/5 border border-transparent hover:bg-white/8'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-[20px] h-[20px] rounded-[4px] flex items-center justify-center shrink-0 transition-colors ${
                          pay.selected ? 'bg-green-500' : 'bg-white/10'
                        }`}
                      >
                        {pay.selected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-white text-sm">{pay.supplier_name}</span>
                        <span className="text-white/40 text-xs ltr-num">
                          {formatDate(pay.payment_date)}
                        </span>
                      </div>
                    </div>
                    <span className="ltr-num text-white/70 text-sm">
                      ₪{pay.total_amount.toLocaleString('he-IL')}
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && currentTotalCount > 0 && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/10 bg-[#0f1231]">
            {error && !approving && (
              <span className="text-red-400 text-xs flex-1">{error}</span>
            )}
            {(!error || approving) && <div className="flex-1" />}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                disabled={approving}
                className="px-4 py-2 rounded-[8px] text-sm text-white bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
              >
                ביטול
              </button>
              <button
                onClick={handleApprove}
                disabled={approving || currentSelectedCount === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-sm text-white bg-green-500 hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="w-4 h-4" />
                <span>
                  {approving ? 'מאשר...' : `אשר ${currentSelectedCount} נבחרים`}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
