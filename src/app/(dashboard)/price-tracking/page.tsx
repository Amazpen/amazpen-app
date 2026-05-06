'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '../layout';
import { createClient } from '@/lib/supabase/client';
import { useMultiTableRealtime } from '@/hooks/useRealtimeSubscription';
import type { PriceAlert, SupplierItem, SupplierItemPrice } from '@/types/price-tracking';
import SupplierSearchSelect from '@/components/ui/SupplierSearchSelect';

interface Supplier {
  id: string;
  name: string;
}

export default function PriceTrackingPage() {
  const router = useRouter();
  const { selectedBusinesses, isAdmin } = useDashboard();
  const businessId = selectedBusinesses[0] || '';

  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [lastQuantityMap, setLastQuantityMap] = useState<Map<string, number>>(new Map());
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [supplierItems, setSupplierItems] = useState<SupplierItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [priceHistory, setPriceHistory] = useState<SupplierItemPrice[]>([]);
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Per-alert price history modal
  const [historyModalAlert, setHistoryModalAlert] = useState<PriceAlert | null>(null);
  const [historyModalRows, setHistoryModalRows] = useState<SupplierItemPrice[]>([]);
  const [historyModalLoading, setHistoryModalLoading] = useState(false);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const startEditRow = useCallback((row: SupplierItemPrice) => {
    setEditingRowId(row.id);
    setEditPrice(String(row.price));
    setEditQty(row.quantity != null ? String(row.quantity) : '');
  }, []);

  const cancelEditRow = useCallback(() => {
    setEditingRowId(null);
    setEditPrice('');
    setEditQty('');
  }, []);

  const saveEditRow = useCallback(async (row: SupplierItemPrice) => {
    const priceNum = parseFloat(editPrice);
    if (!Number.isFinite(priceNum) || priceNum < 0) return;
    const qtyNum = editQty.trim() === '' ? null : parseFloat(editQty);
    if (qtyNum != null && (!Number.isFinite(qtyNum) || qtyNum < 0)) return;

    setEditSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('supplier_item_prices')
      .update({ price: priceNum, quantity: qtyNum })
      .eq('id', row.id);

    if (!error) {
      // Refresh modal rows in place
      setHistoryModalRows(prev => prev.map(r => r.id === row.id ? { ...r, price: priceNum, quantity: qtyNum ?? undefined } : r));

      // If this is the latest record for the item, also sync supplier_items.current_price
      const isLatest = historyModalRows.length > 0 && historyModalRows[0].id === row.id;
      if (isLatest) {
        await supabase
          .from('supplier_items')
          .update({ current_price: priceNum })
          .eq('id', row.supplier_item_id);
      }

      // Also reflect in the page's supplierItems list if this product is loaded there
      setSupplierItems(prev => prev.map(si =>
        si.id === row.supplier_item_id && historyModalRows[0]?.id === row.id
          ? { ...si, current_price: priceNum }
          : si
      ));

      cancelEditRow();
    }
    setEditSaving(false);
  }, [editPrice, editQty, historyModalRows, cancelEditRow]);

  const openHistoryModal = useCallback(async (alert: PriceAlert) => {
    setHistoryModalAlert(alert);
    setHistoryModalRows([]);
    setHistoryModalLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('supplier_item_prices')
      .select('*')
      .eq('supplier_item_id', alert.supplier_item_id)
      .order('document_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) {
      setHistoryModalRows(data.map((p: Record<string, unknown>) => ({
        id: p.id as string,
        supplier_item_id: p.supplier_item_id as string,
        price: Number(p.price),
        quantity: p.quantity != null ? Number(p.quantity) : undefined,
        invoice_id: (p.invoice_id as string) || undefined,
        ocr_document_id: (p.ocr_document_id as string) || undefined,
        document_date: p.document_date as string,
        notes: (p.notes as string) || undefined,
        created_at: p.created_at as string,
      })));
    }
    setHistoryModalLoading(false);
  }, []);

  // Auth check
  useEffect(() => {
    const timer = setTimeout(() => setIsCheckingAuth(false), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isCheckingAuth && !isAdmin) {
      router.replace('/');
    }
  }, [isAdmin, isCheckingAuth, router]);

  // Fetch alerts + last quantities for שווי calculation
  const fetchAlerts = useCallback(async () => {
    if (!businessId) return;
    setIsLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('price_alerts')
      .select('*, supplier_items(item_name), suppliers(name)')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (data) {
      const mapped = data.map((a: Record<string, unknown>) => ({
        id: a.id as string,
        business_id: a.business_id as string,
        supplier_item_id: a.supplier_item_id as string,
        supplier_id: a.supplier_id as string,
        ocr_document_id: (a.ocr_document_id as string) || undefined,
        old_price: Number(a.old_price),
        new_price: Number(a.new_price),
        change_pct: Number(a.change_pct),
        document_date: (a.document_date as string) || undefined,
        status: a.status as PriceAlert['status'],
        created_at: a.created_at as string,
        item_name: (a.supplier_items as Record<string, unknown>)?.item_name as string,
        supplier_name: (a.suppliers as Record<string, unknown>)?.name as string,
      }));
      setAlerts(mapped);

      // Fetch last quantity for each unique supplier_item_id in unread alerts (for שווי column)
      const uniqueItemIds = [...new Set(mapped.filter(a => a.status === 'unread').map(a => a.supplier_item_id))];
      if (uniqueItemIds.length > 0) {
        const { data: prices } = await supabase
          .from('supplier_item_prices')
          .select('supplier_item_id, quantity, document_date')
          .in('supplier_item_id', uniqueItemIds)
          .order('document_date', { ascending: false });

        if (prices) {
          const qMap = new Map<string, number>();
          for (const p of prices) {
            if (!qMap.has(p.supplier_item_id) && p.quantity != null) {
              qMap.set(p.supplier_item_id, Number(p.quantity));
            }
          }
          setLastQuantityMap(qMap);
        }
      }
    }
    setIsLoading(false);
  }, [businessId]);

  // Fetch suppliers
  useEffect(() => {
    if (!businessId) return;
    const fetchSuppliers = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('business_id', businessId)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('name');
      if (data) setSuppliers(data);
    };
    fetchSuppliers();
  }, [businessId]);

  useEffect(() => {
    if (!isCheckingAuth && isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- async call, setState deferred
      fetchAlerts();
    }
  }, [isCheckingAuth, isAdmin, fetchAlerts]);

  // Realtime for price_alerts
  useMultiTableRealtime(
    ['price_alerts'],
    fetchAlerts,
    !isCheckingAuth && isAdmin && !!businessId
  );

  // Fetch supplier items when supplier changes
  useEffect(() => {
    if (!selectedSupplierId || !businessId) {
      requestAnimationFrame(() => {
        setSupplierItems([]);
        setSelectedItemId(null);
        setItemSearchQuery('');
      });
      return;
    }
    const fetchItems = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('supplier_items')
        .select('*')
        .eq('business_id', businessId)
        .eq('supplier_id', selectedSupplierId)
        .eq('is_active', true)
        .order('item_name');
      if (data) {
        setSupplierItems(data.map((si: Record<string, unknown>) => ({
          id: si.id as string,
          business_id: si.business_id as string,
          supplier_id: si.supplier_id as string,
          item_name: si.item_name as string,
          item_aliases: (si.item_aliases as string[]) || [],
          unit: (si.unit as string) || undefined,
          current_price: si.current_price != null ? Number(si.current_price) : undefined,
          last_price_date: (si.last_price_date as string) || undefined,
          is_active: si.is_active as boolean,
          alert_muted: (si.alert_muted as boolean) ?? false,
          created_at: si.created_at as string,
          updated_at: si.updated_at as string,
        })));
      }
    };
    fetchItems();
  }, [selectedSupplierId, businessId]);

  // Fetch price history for selected item
  useEffect(() => {
    if (!selectedItemId) {
      requestAnimationFrame(() => setPriceHistory([]));
      return;
    }
    const fetchHistory = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('supplier_item_prices')
        .select('*')
        .eq('supplier_item_id', selectedItemId)
        .order('document_date', { ascending: false })
        .limit(10);
      if (data) {
        setPriceHistory(data.map((p: Record<string, unknown>) => ({
          id: p.id as string,
          supplier_item_id: p.supplier_item_id as string,
          price: Number(p.price),
          quantity: p.quantity != null ? Number(p.quantity) : undefined,
          invoice_id: (p.invoice_id as string) || undefined,
          ocr_document_id: (p.ocr_document_id as string) || undefined,
          document_date: p.document_date as string,
          notes: (p.notes as string) || undefined,
          created_at: p.created_at as string,
        })));
      }
    };
    fetchHistory();
  }, [selectedItemId]);

  // Mark alert as read/dismissed
  const updateAlertStatus = async (alertId: string, status: 'read' | 'dismissed') => {
    const supabase = createClient();
    await supabase.from('price_alerts').update({ status }).eq('id', alertId);
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status } : a));
  };

  // Toggle mute alerts for a supplier item
  const toggleMuteItem = async (itemId: string, currentMuted: boolean) => {
    const supabase = createClient();
    await supabase.from('supplier_items').update({ alert_muted: !currentMuted }).eq('id', itemId);
    setSupplierItems(prev => prev.map(si => si.id === itemId ? { ...si, alert_muted: !currentMuted } : si));
  };

  // Stats
  const unreadAlerts = useMemo(() => alerts.filter(a => a.status === 'unread'), [alerts]);
  const recentAlerts = useMemo(() => alerts.slice(0, 10), [alerts]);

  // Business-actionable insights (replaces the previous "alerts/items/suppliers"
  // counters that didn't tell the owner anything about money).
  type SupplierInsight = { name: string; impact: number; count: number; avgPct: number };
  type SpikeInsight = { item: string; supplier: string; pct: number };
  type Insights = {
    monthCostImpact: number;
    monthAlertCount: number;
    topSupplier: SupplierInsight | null;
    biggestSpike: SpikeInsight | null;
  };
  const insights = useMemo<Insights>(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let monthCostImpact = 0; // ₪ delta this month based on last-quantity
    let monthAlertCount = 0;

    type SupplierAgg = { name: string; impact: number; count: number; pctSum: number };
    const bySupplier = new Map<string, SupplierAgg>();
    let biggestSpike: { item: string; supplier: string; pct: number } | null = null;

    for (const a of alerts) {
      if (a.status !== 'unread') continue;
      const qty = lastQuantityMap.get(a.supplier_item_id);
      const impact = qty != null ? (a.new_price - a.old_price) * qty : 0;

      const created = a.created_at ? new Date(a.created_at) : null;
      if (created && created >= monthStart) {
        monthCostImpact += impact;
        monthAlertCount += 1;
      }

      const supKey = a.supplier_id;
      const existing = bySupplier.get(supKey) || { name: a.supplier_name || 'ספק לא ידוע', impact: 0, count: 0, pctSum: 0 };
      existing.impact += impact;
      existing.count += 1;
      existing.pctSum += a.change_pct;
      bySupplier.set(supKey, existing);

      if (!biggestSpike || Math.abs(a.change_pct) > Math.abs(biggestSpike.pct)) {
        biggestSpike = {
          item: a.item_name || 'מוצר',
          supplier: a.supplier_name || '',
          pct: a.change_pct,
        };
      }
    }

    let topSupplier: SupplierInsight | null = null;
    bySupplier.forEach((v) => {
      const candidate: SupplierInsight = { name: v.name, impact: v.impact, count: v.count, avgPct: v.pctSum / v.count };
      if (!topSupplier || Math.abs(candidate.impact) > Math.abs(topSupplier.impact)) {
        topSupplier = candidate;
      }
    });

    return { monthCostImpact, monthAlertCount, topSupplier, biggestSpike };
  }, [alerts, lastQuantityMap]);

  // Filtered items for search
  const filteredItems = useMemo(() => {
    if (!itemSearchQuery.trim()) return supplierItems;
    const q = itemSearchQuery.trim().toLowerCase();
    return supplierItems.filter(si => si.item_name.toLowerCase().includes(q));
  }, [supplierItems, itemSearchQuery]);

  const selectedItem = supplierItems.find(si => si.id === selectedItemId);
  // Up to 10 price history columns (most recent first) (#43)
  const historyColumns = priceHistory.slice(0, 10);

  if (isCheckingAuth) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-60px)] bg-[#0a0d1f]">
        <div className="w-10 h-10 border-4 border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-60px)] bg-[#0a0d1f]">
        <p className="text-white/60 text-lg">אין לך הרשאה לצפות בדף זה</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] bg-[#0a0d1f] overflow-y-auto" dir="rtl">
      {/* Header */}
      <div className="px-4 py-4 bg-[#0F1535] border-b border-[#4C526B] flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold text-white">מעקב מחירים</h1>
          <p className="text-[14px] text-white/50 mt-1">מעקב אחרי שינויי מחירים מחשבוניות</p>
        </div>
        <div className="w-[260px] flex-shrink-0">
          <SupplierSearchSelect
            suppliers={suppliers}
            value={selectedSupplierId}
            onChange={(id) => {
              setSelectedSupplierId(id);
              setSelectedItemId(null);
              setItemSearchQuery('');
            }}
            placeholder="חפש ספק..."
            label=""
          />
        </div>
      </div>

      {/* Insight cards — money/action-oriented */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-4 py-3">
        {/* Card 1: monthly cost impact */}
        <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-3 text-center flex flex-col gap-[4px] min-h-[92px] justify-between">
          <p className="text-[11px] text-white/50">השפעת השינויים החודש</p>
          {insights.monthAlertCount === 0 ? (
            <>
              <p className="text-[20px] font-bold text-white/40 ltr-num text-center">—</p>
              <p className="text-[11px] text-white/40">לא זוהו שינויים החודש</p>
            </>
          ) : (
            <>
              <p className={`text-[22px] font-bold ltr-num text-center ${insights.monthCostImpact > 0 ? 'text-[#F64E60]' : insights.monthCostImpact < 0 ? 'text-[#3CD856]' : 'text-white'}`}>
                {insights.monthCostImpact > 0 ? '+' : ''}₪{Math.round(insights.monthCostImpact).toLocaleString('he-IL')}
              </p>
              <p className="text-[11px] text-white/50">
                {insights.monthCostImpact > 0
                  ? `עליות מחירים מוסיפות לעלויות`
                  : insights.monthCostImpact < 0
                    ? `הוזלות חוסכות לכם`
                    : `שינויי מחיר מאוזנים`}
                {' '}· {insights.monthAlertCount} שינויים
              </p>
            </>
          )}
        </div>

        {/* Card 2: supplier with biggest impact */}
        <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-3 text-center flex flex-col gap-[4px] min-h-[92px] justify-between">
          <p className="text-[11px] text-white/50">הספק עם ההשפעה הגדולה</p>
          {!insights.topSupplier ? (
            <>
              <p className="text-[20px] font-bold text-white/40">—</p>
              <p className="text-[11px] text-white/40">אין נתונים להצגה</p>
            </>
          ) : (
            <>
              <p className="text-[16px] font-bold text-white truncate" title={insights.topSupplier.name}>{insights.topSupplier.name}</p>
              <p className="text-[11px] text-white/60">
                <span className={`ltr-num font-medium ${insights.topSupplier.impact > 0 ? 'text-[#F64E60]' : 'text-[#3CD856]'}`}>
                  {insights.topSupplier.impact > 0 ? '+' : ''}₪{Math.round(insights.topSupplier.impact).toLocaleString('he-IL')}
                </span>
                {' '}· {insights.topSupplier.count} פריטים · ממוצע{' '}
                <span className={`ltr-num ${insights.topSupplier.avgPct > 0 ? 'text-[#F64E60]' : 'text-[#3CD856]'}`}>
                  {insights.topSupplier.avgPct > 0 ? '+' : ''}{insights.topSupplier.avgPct.toFixed(1)}%
                </span>
              </p>
            </>
          )}
        </div>

        {/* Card 3: biggest single jump */}
        <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-3 text-center flex flex-col gap-[4px] min-h-[92px] justify-between">
          <p className="text-[11px] text-white/50">הקפיצה הגדולה ביותר</p>
          {!insights.biggestSpike ? (
            <>
              <p className="text-[20px] font-bold text-white/40">—</p>
              <p className="text-[11px] text-white/40">אין שינויים פעילים</p>
            </>
          ) : (
            <>
              <p className="text-[16px] font-bold text-white truncate" title={insights.biggestSpike.item}>
                {insights.biggestSpike.item}
                {' '}
                <span className={`ltr-num text-[15px] ${insights.biggestSpike.pct > 0 ? 'text-[#F64E60]' : 'text-[#3CD856]'}`}>
                  {insights.biggestSpike.pct > 0 ? '▲' : '▼'}{Math.abs(insights.biggestSpike.pct).toFixed(1)}%
                </span>
              </p>
              <p className="text-[11px] text-white/50 truncate" title={insights.biggestSpike.supplier}>
                {insights.biggestSpike.supplier || '—'}
              </p>
            </>
          )}
        </div>
      </div>

      {/* ===== SECTION 1: שינויי מחיר שזוהו (10 אחרונים) ===== */}
      <div className="px-4 py-2">
        <h2 className="text-[16px] font-semibold text-white mb-2">שינויי מחיר שזוהו</h2>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        ) : recentAlerts.length === 0 ? (
          <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-6 text-center">
            <p className="text-white/40 text-[14px]">אין שינויי מחיר</p>
          </div>
        ) : (
          <div className="w-full flex flex-col">
            {/* Header */}
            <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1.2fr_auto] bg-[#29318A] rounded-t-[7px] p-[10px_5px] pe-[13px] items-center text-[13px]">
              <span className="text-white/80 font-medium text-right px-2">מוצר</span>
              <span className="text-white/80 font-medium text-right px-2">ספק</span>
              <span className="text-white/80 font-medium text-center px-2">מחיר קודם</span>
              <span className="text-white/80 font-medium text-center px-2">מחיר חדש</span>
              <span className="text-white/80 font-medium text-center px-2">שינוי</span>
              <span className="text-white/80 font-medium text-center px-2">שווי בש״ח</span>
              <span className="w-[70px]"></span>
            </div>
            {/* Rows */}
            <div className="max-h-[400px] overflow-y-auto flex flex-col gap-[3px] mt-[3px]">
              {recentAlerts.map((alert) => {
                const qty = lastQuantityMap.get(alert.supplier_item_id);
                const valueChange = qty != null ? (alert.new_price - alert.old_price) * qty : null;
                const isUnread = alert.status === 'unread';
                return (
                  <div
                    key={alert.id}
                    onClick={() => openHistoryModal(alert)}
                    className={`grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1.2fr_auto] w-full p-[8px_5px] rounded-[7px] items-center text-[13px] cursor-pointer hover:bg-[#29318A]/40 transition-colors ${
                      isUnread ? 'bg-[#0F1535]' : 'bg-[#0F1535]/60'
                    }`}
                    title="לחץ לצפייה בהיסטוריית המוצר"
                  >
                    <span className="text-white font-medium truncate px-2">{alert.item_name}</span>
                    <span className="text-white/60 truncate px-2">{alert.supplier_name}</span>
                    <span className="text-white/50 text-center ltr-num px-2">₪{alert.old_price.toFixed(2)}</span>
                    <span className="text-white text-center font-semibold ltr-num px-2">₪{alert.new_price.toFixed(2)}</span>
                    <span className="text-center ltr-num px-2">
                      <span className={`font-semibold ${alert.change_pct > 0 ? 'text-[#F64E60]' : 'text-[#3CD856]'}`}>
                        {alert.change_pct > 0 ? '▲' : '▼'} {Math.abs(alert.change_pct).toFixed(1)}%
                      </span>
                    </span>
                    <span className="text-center ltr-num px-2">
                      {valueChange != null ? (
                        <span className={`font-medium ${valueChange > 0 ? 'text-[#F64E60]' : 'text-[#3CD856]'}`}>
                          {valueChange > 0 ? '+' : ''}₪{valueChange.toFixed(0)}
                        </span>
                      ) : (
                        <span className="text-white/30">-</span>
                      )}
                    </span>
                    <span className="w-[70px] flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {isUnread && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); updateAlertStatus(alert.id, 'read'); }}
                            className="text-[11px] text-white/50 hover:text-white bg-[#29318A]/30 hover:bg-[#29318A] px-2 py-1 rounded-[5px] transition-colors whitespace-nowrap"
                          >
                            ראיתי
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); updateAlertStatus(alert.id, 'dismissed'); }}
                            className="text-[11px] text-white/30 hover:text-white/60 px-1 py-1 rounded-[5px] transition-colors"
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Supplier items modal — triggered by header search */}
      {selectedSupplierId && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => { setSelectedSupplierId(''); setSelectedItemId(null); setItemSearchQuery(''); }}
        >
          <div
            className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] max-w-[820px] w-full max-h-[88vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="flex items-start justify-between p-[14px] border-b border-[#4C526B]">
              <div className="flex flex-col gap-[2px] min-w-0">
                <span className="text-white text-[16px] font-semibold truncate">
                  {suppliers.find(s => s.id === selectedSupplierId)?.name || 'מחירים לפי ספק'}
                </span>
                <span className="text-white/50 text-[12px]">{supplierItems.length} פריטים מעוקבים</span>
              </div>
              <button
                type="button"
                onClick={() => { setSelectedSupplierId(''); setSelectedItemId(null); setItemSearchQuery(''); }}
                className="text-white/50 hover:text-white text-[20px] leading-none flex-shrink-0"
                aria-label="סגור"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col flex-1 overflow-hidden p-[14px]">
            {/* Item search input */}
            <div className="mb-3 flex-shrink-0">
              <input
                type="text"
                value={itemSearchQuery}
                onChange={(e) => setItemSearchQuery(e.target.value)}
                placeholder="חיפוש פריט מהרשימה..."
                className="w-full h-[42px] bg-[#0F1535] border border-[#4C526B] rounded-[8px] px-3 text-[14px] text-white placeholder-white/30 outline-none focus:border-[#29318A]"
                dir="rtl"
              />
            </div>

            <div className="flex-1 overflow-y-auto -mx-[14px] px-[14px]">
            {supplierItems.length === 0 ? (
              <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-6 text-center">
                <p className="text-white/40 text-[14px]">אין פריטים מעוקבים לספק זה</p>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-4 text-center">
                <p className="text-white/40 text-[14px]">לא נמצאו פריטים תואמים</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {filteredItems.map((item) => (
                  <div key={item.id} className="flex flex-col gap-0">
                    <div
                      className={`w-full bg-[#0F1535] border rounded-[10px] p-3 flex items-center gap-2 transition-colors cursor-pointer ${
                        selectedItemId === item.id
                          ? 'border-[#29318A] bg-[#29318A]/10 rounded-b-none'
                          : 'border-[#4C526B]'
                      } ${item.alert_muted ? 'opacity-60' : ''}`}
                    >
                      {/* Item info — clickable for history */}
                      <button
                        type="button"
                        onClick={() => setSelectedItemId(selectedItemId === item.id ? null : item.id)}
                        className="flex-1 flex items-center justify-between min-w-0"
                      >
                        <div className="text-right min-w-0">
                          <p className="text-[14px] text-white font-medium truncate">{item.item_name}</p>
                          <div className="flex items-center gap-2">
                            {item.alert_muted && (
                              <span className="text-[10px] text-[#bc76ff]">ללא התראות</span>
                            )}
                            {item.last_price_date && (
                              <p className="text-[11px] text-white/40">
                                עדכון: {new Date(item.last_price_date).toLocaleDateString('he-IL')}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-left flex-shrink-0 ml-2">
                          <p className="text-[16px] text-white font-bold ltr-num">
                            &#8362;{item.current_price?.toFixed(2) || '-'}
                          </p>
                        </div>
                      </button>

                      {/* Mute toggle */}
                      <button
                        type="button"
                        title={item.alert_muted ? 'הפעל התראות לפריט זה' : 'השתק התראות לפריט זה'}
                        onClick={(e) => { e.stopPropagation(); toggleMuteItem(item.id, item.alert_muted); }}
                        className={`flex-shrink-0 w-[32px] h-[32px] rounded-[8px] flex items-center justify-center transition-colors ${
                          item.alert_muted
                            ? 'bg-[#bc76ff]/20 text-[#bc76ff]'
                            : 'bg-white/5 text-white/30 hover:text-white/60 hover:bg-white/10'
                        }`}
                      >
                        {item.alert_muted ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                            <path d="M18.63 13A17.89 17.89 0 0 1 18 8"/>
                            <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/>
                            <path d="M18 8a6 6 0 0 0-9.33-5"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                          </svg>
                        )}
                      </button>
                    </div>

                    {/* Price history grid — inline under item */}
                    {/* Price history grid — up to 10 prices (#43) */}
                    {selectedItemId === item.id && historyColumns.length > 0 && (
                      <div className="bg-[#0F1535] border border-t-0 border-[#29318A] rounded-b-[10px] overflow-hidden">
                        <div className="overflow-x-auto">
                          <div className="min-w-fit" style={{ minWidth: `${120 + historyColumns.length * 80}px` }}>
                            {/* Header row */}
                            <div
                              className="grid items-center bg-[#29318A]/30 border-b border-[#4C526B]/40 text-[11px]"
                              style={{ gridTemplateColumns: `100px repeat(${historyColumns.length}, 80px)` }}
                            >
                              <span className="py-2 px-2 text-white/50 font-medium text-right">שם הפריט</span>
                              {historyColumns.map((ph) => (
                                <span key={ph.id} className="py-2 px-1 text-white/50 font-medium text-center whitespace-nowrap ltr-num">
                                  {new Date(ph.document_date).toLocaleDateString('he-IL')}
                                </span>
                              ))}
                            </div>
                            {/* Prices row */}
                            <div
                              className="grid items-center border-b border-[#4C526B]/40 text-[13px]"
                              style={{ gridTemplateColumns: `100px repeat(${historyColumns.length}, 80px)` }}
                            >
                              <span className="py-2 px-2 text-white/40 text-[11px]">מחיר</span>
                              {historyColumns.map((ph) => (
                                <span key={ph.id} className="py-2 px-1 text-center text-white font-semibold ltr-num">
                                  {ph.price.toFixed(2)}
                                </span>
                              ))}
                            </div>
                            {/* Quantity row */}
                            <div
                              className="grid items-center border-b border-[#4C526B]/40 text-[12px]"
                              style={{ gridTemplateColumns: `100px repeat(${historyColumns.length}, 80px)` }}
                            >
                              <span className="py-1 px-2 text-white/40 text-[11px]">כמות</span>
                              {historyColumns.map((ph) => (
                                <span key={ph.id} className="py-1 px-1 text-center text-white/60 ltr-num">
                                  {ph.quantity ?? '-'}
                                </span>
                              ))}
                            </div>
                            {/* Change % row */}
                            <div
                              className="grid items-center text-[11px]"
                              style={{ gridTemplateColumns: `100px repeat(${historyColumns.length}, 80px)` }}
                            >
                              <span className="py-1 px-2 text-white/40">שינוי</span>
                              {historyColumns.map((ph, idx) => {
                                const prevPrice = idx < historyColumns.length - 1 ? historyColumns[idx + 1].price : null;
                                const change = prevPrice != null ? ((ph.price - prevPrice) / prevPrice) * 100 : null;
                                return (
                                  <span key={ph.id} className="py-1 px-1 text-center ltr-num">
                                    {change != null ? (
                                      <span className={`font-medium ${change > 0 ? 'text-[#F64E60]' : change < 0 ? 'text-[#3CD856]' : 'text-white/40'}`}>
                                        {change > 0 ? '+' : ''}{change.toFixed(1)}%
                                      </span>
                                    ) : (
                                      <span className="text-white/30">-</span>
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Price history modal */}
      {historyModalAlert && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setHistoryModalAlert(null)}
        >
          <div
            className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] max-w-[640px] w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="flex items-start justify-between p-[14px] border-b border-[#4C526B]">
              <div className="flex flex-col gap-[2px]">
                <span className="text-white text-[16px] font-semibold">היסטוריית מחירים — {historyModalAlert.item_name}</span>
                <span className="text-white/50 text-[12px]">{historyModalAlert.supplier_name}</span>
              </div>
              <button
                type="button"
                onClick={() => setHistoryModalAlert(null)}
                className="text-white/50 hover:text-white text-[20px] leading-none"
                aria-label="סגור"
              >
                ×
              </button>
            </div>

            {/* Change summary banner */}
            <div className="p-[12px] bg-[#29318A]/20 border-b border-[#4C526B]/50">
              <div className="grid grid-cols-3 gap-[8px] text-center">
                <div className="flex flex-col gap-[2px]">
                  <span className="text-[10px] text-white/50">מחיר קודם</span>
                  <span className="text-[14px] text-white ltr-num">₪{historyModalAlert.old_price.toFixed(2)}</span>
                </div>
                <div className="flex flex-col gap-[2px]">
                  <span className="text-[10px] text-white/50">מחיר חדש</span>
                  <span className="text-[14px] text-white font-semibold ltr-num">₪{historyModalAlert.new_price.toFixed(2)}</span>
                </div>
                <div className="flex flex-col gap-[2px]">
                  <span className="text-[10px] text-white/50">שינוי</span>
                  <span className={`text-[14px] font-semibold ltr-num ${historyModalAlert.change_pct > 0 ? 'text-[#F64E60]' : 'text-[#3CD856]'}`}>
                    {historyModalAlert.change_pct > 0 ? '▲' : '▼'} {Math.abs(historyModalAlert.change_pct).toFixed(1)}%
                  </span>
                </div>
              </div>
              {historyModalAlert.document_date && (
                <div className="mt-[8px] text-center text-[11px] text-white/50">
                  זוהה ב-{new Date(historyModalAlert.document_date).toLocaleDateString('he-IL')}
                </div>
              )}
            </div>

            {/* History list */}
            <div className="flex-1 overflow-y-auto">
              {historyModalLoading ? (
                <div className="p-[20px] text-center text-white/50 text-[13px]">טוען היסטוריה...</div>
              ) : historyModalRows.length === 0 ? (
                <div className="p-[20px] text-center text-white/50 text-[13px]">אין היסטוריית מחירים למוצר זה</div>
              ) : (
                <div className="flex flex-col">
                  <div className="grid grid-cols-[1fr_90px_70px_70px_60px] bg-[#29318A]/40 sticky top-0 px-[12px] py-[7px] text-[11px] text-white/70">
                    <span className="text-right">תאריך</span>
                    <span className="text-center">מחיר</span>
                    <span className="text-center">כמות</span>
                    <span className="text-center">שינוי</span>
                    <span></span>
                  </div>
                  {historyModalRows.map((row, idx) => {
                    const next = idx < historyModalRows.length - 1 ? historyModalRows[idx + 1] : null;
                    const change = next ? ((row.price - next.price) / next.price) * 100 : null;
                    const isAlertRow = row.price === historyModalAlert.new_price &&
                      historyModalAlert.document_date && row.document_date === historyModalAlert.document_date;
                    const isEditing = editingRowId === row.id;
                    return (
                      <div
                        key={row.id}
                        className={`grid grid-cols-[1fr_90px_70px_70px_60px] px-[12px] py-[8px] border-b border-[#4C526B]/30 text-[12.5px] items-center ${isAlertRow ? 'bg-[#29318A]/30' : ''} ${isEditing ? 'bg-[#29318A]/40' : ''}`}
                      >
                        <span className="text-white/90 text-right">
                          {row.document_date ? new Date(row.document_date).toLocaleDateString('he-IL') : '-'}
                          {isAlertRow && <span className="mr-[6px] text-[10px] text-[#FFB84D]">(שינוי שזוהה)</span>}
                        </span>
                        {isEditing ? (
                          <span className="text-center px-[2px]">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={editPrice}
                              onChange={(e) => setEditPrice(e.target.value)}
                              className="w-full bg-transparent border border-[#4C526B] rounded-[4px] text-center text-white text-[12px] h-[26px] px-[4px] outline-none focus:border-[#29318A] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              dir="ltr"
                              autoFocus
                            />
                          </span>
                        ) : (
                          <span className="text-white text-center ltr-num">₪{Number(row.price).toFixed(2)}</span>
                        )}
                        {isEditing ? (
                          <span className="text-center px-[2px]">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={editQty}
                              onChange={(e) => setEditQty(e.target.value)}
                              className="w-full bg-transparent border border-[#4C526B] rounded-[4px] text-center text-white text-[12px] h-[26px] px-[4px] outline-none focus:border-[#29318A] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              dir="ltr"
                            />
                          </span>
                        ) : (
                          <span className="text-white/70 text-center ltr-num">{row.quantity != null ? row.quantity : '-'}</span>
                        )}
                        <span className="text-center ltr-num">
                          {change != null ? (
                            <span className={`font-medium ${change > 0 ? 'text-[#F64E60]' : change < 0 ? 'text-[#3CD856]' : 'text-white/40'}`}>
                              {change > 0 ? '+' : ''}{change.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-white/30">-</span>
                          )}
                        </span>
                        <span className="flex items-center justify-center gap-[3px]">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => saveEditRow(row)}
                                disabled={editSaving}
                                title="שמור"
                                className="w-[24px] h-[24px] flex items-center justify-center rounded-[5px] bg-[#3CD856]/20 hover:bg-[#3CD856]/40 text-[#3CD856] transition disabled:opacity-50"
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditRow}
                                disabled={editSaving}
                                title="ביטול"
                                className="w-[24px] h-[24px] flex items-center justify-center rounded-[5px] bg-white/5 hover:bg-white/15 text-white/60 transition disabled:opacity-50"
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditRow(row)}
                              title="ערוך מחיר/כמות"
                              className="w-[24px] h-[24px] flex items-center justify-center rounded-[5px] bg-white/5 hover:bg-[#29318A] text-white/50 hover:text-white transition"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
