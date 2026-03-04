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
  const trackedItems = useMemo(() => {
    const unique = new Set(alerts.map(a => a.supplier_item_id));
    return unique.size;
  }, [alerts]);

  // Filtered items for search
  const filteredItems = useMemo(() => {
    if (!itemSearchQuery.trim()) return supplierItems;
    const q = itemSearchQuery.trim().toLowerCase();
    return supplierItems.filter(si => si.item_name.toLowerCase().includes(q));
  }, [supplierItems, itemSearchQuery]);

  const selectedItem = supplierItems.find(si => si.id === selectedItemId);
  // Up to 5 price history columns (most recent first)
  const historyColumns = priceHistory.slice(0, 5);

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
      <div className="px-4 py-4 bg-[#0F1535] border-b border-[#4C526B]">
        <h1 className="text-[20px] font-bold text-white">מעקב מחירי ספקים</h1>
        <p className="text-[14px] text-white/50 mt-1">מעקב אחרי שינויי מחירים מחשבוניות</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-3 px-4 py-3">
        <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-3 text-center">
          <p className="text-[24px] font-bold text-[#F64E60] ltr-num">{unreadAlerts.length}</p>
          <p className="text-[12px] text-white/50">התראות חדשות</p>
        </div>
        <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-3 text-center">
          <p className="text-[24px] font-bold text-white ltr-num">{trackedItems}</p>
          <p className="text-[12px] text-white/50">פריטים במעקב</p>
        </div>
        <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-3 text-center">
          <p className="text-[24px] font-bold text-[#3CD856] ltr-num">{suppliers.length}</p>
          <p className="text-[12px] text-white/50">ספקים פעילים</p>
        </div>
      </div>

      {/* ===== SECTION 1: שינויי מחיר שזוהו ===== */}
      <div className="px-4 py-2">
        <h2 className="text-[16px] font-semibold text-white mb-2">שינויי מחיר שזוהו</h2>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        ) : unreadAlerts.length === 0 ? (
          <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-6 text-center">
            <p className="text-white/40 text-[14px]">אין התראות חדשות</p>
          </div>
        ) : (
          <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#4C526B] bg-[#0a0d1f]/40">
                    <th className="text-right py-2 px-3 text-white/50 font-medium">מוצר</th>
                    <th className="text-right py-2 px-3 text-white/50 font-medium">ספק</th>
                    <th className="text-center py-2 px-3 text-white/50 font-medium">מחיר חדש</th>
                    <th className="text-center py-2 px-3 text-white/50 font-medium">מחיר קודם</th>
                    <th className="text-center py-2 px-3 text-white/50 font-medium">שינוי</th>
                    <th className="text-center py-2 px-3 text-white/50 font-medium">שווי בש״ח</th>
                    <th className="py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {unreadAlerts.slice(0, 20).map((alert, idx) => {
                    const qty = lastQuantityMap.get(alert.supplier_item_id);
                    const valueChange = qty != null ? (alert.new_price - alert.old_price) * qty : null;
                    return (
                      <tr
                        key={alert.id}
                        className={`border-b border-[#4C526B]/40 ${idx % 2 !== 0 ? 'bg-white/[0.02]' : ''}`}
                      >
                        <td className="py-2 px-3 text-white font-medium">{alert.item_name}</td>
                        <td className="py-2 px-3 text-white/60">{alert.supplier_name}</td>
                        <td className="py-2 px-3 text-center text-white ltr-num">₪{alert.new_price.toFixed(2)}</td>
                        <td className="py-2 px-3 text-center text-white/50 ltr-num">₪{alert.old_price.toFixed(2)}</td>
                        <td className="py-2 px-3 text-center ltr-num">
                          <span className={`font-semibold ${alert.change_pct > 0 ? 'text-[#F64E60]' : 'text-[#3CD856]'}`}>
                            {alert.change_pct > 0 ? '▲' : '▼'} {Math.abs(alert.change_pct).toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center ltr-num">
                          {valueChange != null ? (
                            <span className={`font-medium ${valueChange > 0 ? 'text-[#F64E60]' : 'text-[#3CD856]'}`}>
                              {valueChange > 0 ? '+' : ''}₪{valueChange.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-white/30">-</span>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateAlertStatus(alert.id, 'read')}
                              className="text-[11px] text-white/50 hover:text-white bg-[#29318A]/30 hover:bg-[#29318A] px-2 py-1 rounded-[5px] transition-colors whitespace-nowrap"
                            >
                              ראיתי
                            </button>
                            <button
                              type="button"
                              onClick={() => updateAlertStatus(alert.id, 'dismissed')}
                              className="text-[11px] text-white/30 hover:text-white/60 px-2 py-1 rounded-[5px] transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ===== SECTION 2: בחירת ספק + חיפוש פריט ===== */}
      <div className="px-4 py-3 mt-2 border-t border-[#4C526B]">
        <h2 className="text-[16px] font-semibold text-white mb-3">חיפוש מחירים לפי ספק</h2>

        {/* Supplier select + item search side by side */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1">
            <SupplierSearchSelect
              suppliers={suppliers}
              value={selectedSupplierId}
              onChange={(id) => {
                setSelectedSupplierId(id);
                setSelectedItemId(null);
                setItemSearchQuery('');
              }}
              placeholder="בחר ספק..."
              label="חיפוש ספק"
            />
          </div>
          {selectedSupplierId && (
            <div className="flex-1">
              <input
                type="text"
                value={itemSearchQuery}
                onChange={(e) => setItemSearchQuery(e.target.value)}
                placeholder="חיפוש פריט מהרשימה..."
                className="w-full h-[42px] bg-[#0F1535] border border-[#4C526B] rounded-[8px] px-3 text-[14px] text-white placeholder-white/30 outline-none focus:border-[#29318A]"
                dir="rtl"
              />
            </div>
          )}
        </div>

        {/* Items list */}
        {selectedSupplierId && (
          supplierItems.length === 0 ? (
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
                <div
                  key={item.id}
                  className={`w-full bg-[#0F1535] border rounded-[10px] p-3 flex items-center gap-2 transition-colors ${
                    selectedItemId === item.id
                      ? 'border-[#29318A] bg-[#29318A]/10'
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
              ))}
            </div>
          )
        )}

        {/* Price history — horizontal table (like screenshot) */}
        {selectedItemId && selectedItem && historyColumns.length > 0 && (
          <div className="mt-3 bg-[#0F1535] border border-[#4C526B] rounded-[10px] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="text-[13px] w-full">
                <thead>
                  <tr className="border-b border-[#4C526B] bg-[#0a0d1f]/40">
                    {/* Item name header */}
                    <th className="text-right py-2 px-3 text-white/50 font-medium whitespace-nowrap min-w-[120px]">
                      שם הפריט
                    </th>
                    {/* Column headers: מחיר אחרון, מחיר קודם, מחיר קודם... */}
                    {historyColumns.map((_, idx) => (
                      <th key={idx} className="text-center py-2 px-3 text-white/50 font-medium whitespace-nowrap min-w-[90px]">
                        {idx === 0 ? 'מחיר אחרון בש״ח' : 'מחיר קודם'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Row 1: item name + prices */}
                  <tr className="border-b border-[#4C526B]/40">
                    <td className="py-2 px-3 text-white font-medium whitespace-nowrap">{selectedItem.item_name}</td>
                    {historyColumns.map((ph) => (
                      <td key={ph.id} className="py-2 px-3 text-center text-white font-semibold ltr-num whitespace-nowrap">
                        {ph.price.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                  {/* Row 2: change % */}
                  <tr className="border-b border-[#4C526B]/40">
                    <td className="py-2 px-3 text-white/40 text-[12px]"></td>
                    {historyColumns.map((ph, idx) => {
                      const prevPrice = idx < historyColumns.length - 1 ? historyColumns[idx + 1].price : null;
                      const change = prevPrice != null ? ((ph.price - prevPrice) / prevPrice) * 100 : null;
                      return (
                        <td key={ph.id} className="py-2 px-3 text-center ltr-num whitespace-nowrap">
                          {change != null ? (
                            <span className={`font-medium text-[12px] ${change > 0 ? 'text-[#F64E60]' : change < 0 ? 'text-[#3CD856]' : 'text-white/40'}`}>
                              {change > 0 ? '+' : ''}{change.toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-white/30">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {/* Row 3: dates */}
                  <tr>
                    <td className="py-2 px-3 text-white/40 text-[12px]"></td>
                    {historyColumns.map((ph) => (
                      <td key={ph.id} className="py-2 px-3 text-center text-white/50 text-[12px] ltr-num whitespace-nowrap">
                        {new Date(ph.document_date).toLocaleDateString('he-IL')}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Dismissed/Read alerts — compact table */}
      {alerts.filter(a => a.status !== 'unread').length > 0 && (
        <div className="px-4 py-3 mt-2 border-t border-[#4C526B]">
          <h2 className="text-[14px] font-semibold text-white/50 mb-2">התראות קודמות</h2>
          <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] overflow-hidden opacity-60">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <tbody>
                  {alerts.filter(a => a.status !== 'unread').slice(0, 10).map((alert, idx) => (
                    <tr key={alert.id} className={`border-b border-[#4C526B]/30 ${idx % 2 !== 0 ? 'bg-white/[0.02]' : ''}`}>
                      <td className="py-2 px-3 text-white/60 truncate max-w-[120px]">{alert.item_name}</td>
                      <td className="py-2 px-3 text-white/40 truncate max-w-[100px]">{alert.supplier_name}</td>
                      <td className="py-2 px-3 text-center text-white/50 ltr-num whitespace-nowrap">
                        ₪{alert.old_price.toFixed(2)} → ₪{alert.new_price.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-center ltr-num">
                        <span className={alert.change_pct > 0 ? 'text-[#F64E60]' : 'text-[#3CD856]'}>
                          {alert.change_pct > 0 ? '▲' : '▼'} {Math.abs(alert.change_pct).toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
