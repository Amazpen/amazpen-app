'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, Check, CheckCheck, Clock } from 'lucide-react';
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
  food_cost: number | null;
  current_expenses: number | null;
  avg_private: number | null;
  avg_business: number | null;
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

const CURRENCY_FIELDS = new Set([
  'total_register',
  'labor_cost',
  'discounts',
  'food_cost',
  'current_expenses',
  'avg_private',
  'avg_business',
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

export default function ApprovalModal({
  isOpen,
  onClose,
  businessId,
  cardFieldNames,
  cardTitle,
  onApproved,
}: ApprovalModalProps) {
  const [groups, setGroups] = useState<GroupedEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      let query = supabase
        .from('daily_entry_approvals')
        .select(
          `*, daily_entries(entry_date, total_register, labor_cost, labor_hours, discounts, food_cost, current_expenses, avg_private, avg_business)`
        )
        .eq('business_id', businessId)
        .eq('status', 'pending');

      if (cardFieldNames && cardFieldNames.length > 0) {
        query = query.in('field_name', cardFieldNames);
      }

      const { data, error: fetchError } = await query.order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      const approvals = (data ?? []) as ApprovalWithEntry[];

      // Group by daily_entry_id
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

      // Sort groups by entry_date descending
      const sorted = Array.from(groupMap.values()).sort(
        (a, b) => new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime()
      );

      setGroups(sorted);
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

  const totalCount = groups.reduce((acc, g) => acc + g.fields.length, 0);
  const selectedCount = groups.reduce(
    (acc, g) => acc + g.fields.filter((f) => f.selected).length,
    0
  );

  function toggleField(groupIdx: number, fieldIdx: number) {
    setGroups((prev) => {
      const next = prev.map((g, gi) =>
        gi !== groupIdx
          ? g
          : {
              ...g,
              fields: g.fields.map((f, fi) =>
                fi !== fieldIdx ? f : { ...f, selected: !f.selected }
              ),
            }
      );
      return next;
    });
  }

  function selectAll() {
    setGroups((prev) =>
      prev.map((g) => ({ ...g, fields: g.fields.map((f) => ({ ...f, selected: true })) }))
    );
  }

  function clearAll() {
    setGroups((prev) =>
      prev.map((g) => ({ ...g, fields: g.fields.map((f) => ({ ...f, selected: false })) }))
    );
  }

  async function handleApprove() {
    if (selectedCount === 0) return;
    setApproving(true);
    setError(null);
    try {
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
      onApproved();
      onClose();
    } catch (err) {
      console.error('ApprovalModal approve error:', err);
      setError(err instanceof Error ? err.message : 'שגיאה באישור');
    } finally {
      setApproving(false);
    }
  }

  if (!isOpen) return null;

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

        {/* Selection bar */}
        {!loading && totalCount > 0 && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-[#0f1231]">
            <span className="text-white/60 text-sm">
              <span className="ltr-num text-white font-medium">{selectedCount}</span>
              {' מתוך '}
              <span className="ltr-num text-white font-medium">{totalCount}</span>
              {' נבחרו'}
            </span>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="flex items-center gap-1 text-sm text-green-400 hover:text-green-300 transition-colors px-2 py-1 rounded-[6px] hover:bg-green-500/10"
              >
                <CheckCheck className="w-4 h-4" />
                <span>בחר הכל</span>
              </button>
              <button
                onClick={clearAll}
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
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-white/40">
              <Check className="w-8 h-8 text-green-400/50" />
              <span className="text-sm">אין שדות ממתינים לאישור</span>
            </div>
          ) : (
            <div className="px-4 py-3 space-y-4">
              {groups.map((group, gi) => (
                <div key={group.daily_entry_id}>
                  {/* Date label */}
                  <div className="text-white/50 text-xs font-medium mb-2 px-1">
                    <span className="ltr-num">{formatDate(group.entry_date)}</span>
                  </div>
                  {/* Fields */}
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
                            {/* Checkbox */}
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
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && totalCount > 0 && (
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
                disabled={approving || selectedCount === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-sm text-white bg-green-500 hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="w-4 h-4" />
                <span>
                  {approving ? 'מאשר...' : `אשר ${selectedCount} נבחרים`}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
