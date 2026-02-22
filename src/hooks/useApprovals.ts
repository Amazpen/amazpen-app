'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { DailyEntryApproval } from '@/types/approvals';

const REALTIME_DISABLED = process.env.NEXT_PUBLIC_DISABLE_REALTIME === 'true';

interface PendingCounts {
  daily_fields: number;
  invoices: number;
  payments: number;
  total: number;
}

interface UseApprovalsReturn {
  pendingApprovals: DailyEntryApproval[];
  pendingCounts: PendingCounts;
  fieldPendingMap: Record<string, boolean>;
  loading: boolean;
  isFieldPending: (fieldName: string) => boolean;
  isCardPending: (cardFieldNames: string[]) => boolean;
  approveFields: (
    dailyEntryId: string,
    fields: { field_name: string; approve: boolean }[]
  ) => Promise<void>;
  approveInvoice: (invoiceId: string) => Promise<void>;
  approvePayment: (paymentId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useApprovals(businessIds: string[]): UseApprovalsReturn {
  const [pendingApprovals, setPendingApprovals] = useState<DailyEntryApproval[]>([]);
  const [pendingCounts, setPendingCounts] = useState<PendingCounts>({
    daily_fields: 0,
    invoices: 0,
    payments: 0,
    total: 0,
  });
  const [fieldPendingMap, setFieldPendingMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);

  const fetchPending = useCallback(async () => {
    if (businessIds.length === 0) {
      setPendingApprovals([]);
      setPendingCounts({ daily_fields: 0, invoices: 0, payments: 0, total: 0 });
      setFieldPendingMap({});
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();

      const [approvalsResult, invoicesResult, paymentsResult] = await Promise.all([
        supabase
          .from('daily_entry_approvals')
          .select('*')
          .in('business_id', businessIds)
          .eq('status', 'pending'),
        supabase
          .from('invoices')
          .select('*', { count: 'exact', head: true })
          .in('business_id', businessIds)
          .eq('approval_status', 'pending_review')
          .is('deleted_at', null),
        supabase
          .from('payments')
          .select('*', { count: 'exact', head: true })
          .in('business_id', businessIds)
          .eq('approval_status', 'pending_review')
          .is('deleted_at', null),
      ]);

      const approvals = (approvalsResult.data ?? []) as DailyEntryApproval[];
      const invoiceCount = invoicesResult.count ?? 0;
      const paymentCount = paymentsResult.count ?? 0;
      const dailyFieldsCount = approvals.length;

      const map: Record<string, boolean> = {};
      for (const approval of approvals) {
        map[approval.field_name] = true;
      }

      setPendingApprovals(approvals);
      setFieldPendingMap(map);
      setPendingCounts({
        daily_fields: dailyFieldsCount,
        invoices: invoiceCount,
        payments: paymentCount,
        total: dailyFieldsCount + invoiceCount + paymentCount,
      });
    } finally {
      setLoading(false);
    }
  }, [businessIds]);

  // Initial fetch and refetch when businessIds change
  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  // Real-time subscription
  useEffect(() => {
    if (REALTIME_DISABLED || businessIds.length === 0) {
      return;
    }

    const supabase = createClient();
    const channelName = `approvals-realtime-${Date.now()}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_entry_approvals' },
        () => { fetchPending(); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'invoices' },
        () => { fetchPending(); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments' },
        () => { fetchPending(); }
      );

    try {
      channel.subscribe();
    } catch {
      // Realtime not available — silently ignore
    }

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [businessIds, fetchPending]);

  const isFieldPending = useCallback(
    (fieldName: string): boolean => {
      return fieldPendingMap[fieldName] === true;
    },
    [fieldPendingMap]
  );

  const isCardPending = useCallback(
    (cardFieldNames: string[]): boolean => {
      return cardFieldNames.some((name) => fieldPendingMap[name] === true);
    },
    [fieldPendingMap]
  );

  const approveFields = useCallback(
    async (
      dailyEntryId: string,
      fields: { field_name: string; approve: boolean }[]
    ): Promise<void> => {
      await fetch('/api/approvals/daily-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daily_entry_id: dailyEntryId, fields }),
      });
      await fetchPending();
    },
    [fetchPending]
  );

  const approveInvoice = useCallback(
    async (invoiceId: string): Promise<void> => {
      await fetch('/api/approvals/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      await fetchPending();
    },
    [fetchPending]
  );

  const approvePayment = useCallback(
    async (paymentId: string): Promise<void> => {
      await fetch('/api/approvals/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id: paymentId }),
      });
      await fetchPending();
    },
    [fetchPending]
  );

  return {
    pendingApprovals,
    pendingCounts,
    fieldPendingMap,
    loading,
    isFieldPending,
    isCardPending,
    approveFields,
    approveInvoice,
    approvePayment,
    refresh: fetchPending,
  };
}
