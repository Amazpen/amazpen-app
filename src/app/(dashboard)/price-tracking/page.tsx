'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '../layout';
import { createClient } from '@/lib/supabase/client';
import { useMultiTableRealtime } from '@/hooks/useRealtimeSubscription';
import type { PriceAlert, SupplierItem, SupplierItemPrice } from '@/types/price-tracking';
import SupplierSearchSelect from '@/components/ui/SupplierSearchSelect';
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

interface Supplier {
  id: string;
  name: string;
}

export default function PriceTrackingPage() {
  const router = useRouter();
  const { selectedBusinesses, isAdmin } = useDashboard();
  const businessId = selectedBusinesses[0] || '';

  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [supplierItems, setSupplierItems] = useState<SupplierItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [priceHistory, setPriceHistory] = useState<SupplierItemPrice[]>([]);
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

  // Fetch alerts
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
      setAlerts(data.map((a: Record<string, unknown>) => ({
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
      })));
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
        .limit(50);
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

  // Stats
  const unreadAlerts = useMemo(() => alerts.filter(a => a.status === 'unread'), [alerts]);
  const trackedItems = useMemo(() => {
    const unique = new Set(alerts.map(a => a.supplier_item_id));
    return unique.size;
  }, [alerts]);

  const selectedItem = supplierItems.find(si => si.id === selectedItemId);

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

      {/* Alerts section */}
      <div className="px-4 py-2">
        <h2 className="text-[16px] font-semibold text-white mb-2">התראות שינויי מחירים</h2>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        ) : unreadAlerts.length === 0 ? (
          <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-6 text-center">
            <p className="text-white/40 text-[14px]">אין התראות חדשות</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {unreadAlerts.slice(0, 20).map((alert) => (
              <div
                key={alert.id}
                className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-3 flex items-center gap-3"
              >
                {/* Change indicator */}
                <div className={`w-[40px] h-[40px] rounded-full flex items-center justify-center flex-shrink-0 ${
                  alert.change_pct > 0 ? 'bg-[#F64E60]/20' : 'bg-[#3CD856]/20'
                }`}>
                  <span className={`text-[14px] font-bold ltr-num ${
                    alert.change_pct > 0 ? 'text-[#F64E60]' : 'text-[#3CD856]'
                  }`}>
                    {alert.change_pct > 0 ? '+' : ''}{alert.change_pct.toFixed(1)}%
                  </span>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-white font-medium truncate">{alert.item_name}</p>
                  <p className="text-[12px] text-white/50">{alert.supplier_name}</p>
                  <p className="text-[12px] text-white/40 ltr-num">
                    &#8362;{alert.old_price.toFixed(2)} &larr; &#8362;{alert.new_price.toFixed(2)}
                    {alert.document_date && (
                      <span className="mr-2">
                        {new Date(alert.document_date).toLocaleDateString('he-IL')}
                      </span>
                    )}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-1 flex-shrink-0">
                  <Button
                    onClick={() => updateAlertStatus(alert.id, 'read')}
                    className="text-[12px] text-white/50 hover:text-white bg-[#29318A]/30 hover:bg-[#29318A] px-2 py-1 rounded-[6px] transition-colors"
                  >
                    ראיתי
                  </Button>
                  <Button
                    onClick={() => updateAlertStatus(alert.id, 'dismissed')}
                    className="text-[12px] text-white/30 hover:text-white/60 px-2 py-1 rounded-[6px] transition-colors"
                  >
                    בטל
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Supplier items browser */}
      <div className="px-4 py-3 mt-2 border-t border-[#4C526B]">
        <h2 className="text-[16px] font-semibold text-white mb-2">חיפוש מחירים לפי ספק</h2>

        {/* Supplier select */}
        <div className="mb-3">
          <SupplierSearchSelect
            suppliers={suppliers}
            value={selectedSupplierId}
            onChange={(id) => {
              setSelectedSupplierId(id);
              setSelectedItemId(null);
            }}
            placeholder="בחר ספק..."
            label="חיפוש ספק"
          />
        </div>

        {/* Items list */}
        {selectedSupplierId && (
          supplierItems.length === 0 ? (
            <div className="bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-6 text-center">
              <p className="text-white/40 text-[14px]">אין פריטים מעוקבים לספק זה</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {supplierItems.map((item) => (
                <Button
                  key={item.id}
                  onClick={() => setSelectedItemId(selectedItemId === item.id ? null : item.id)}
                  className={`w-full bg-[#0F1535] border rounded-[10px] p-3 flex items-center justify-between transition-colors ${
                    selectedItemId === item.id
                      ? 'border-[#29318A] bg-[#29318A]/10'
                      : 'border-[#4C526B] hover:border-[#29318A]/50'
                  }`}
                >
                  <div className="text-right">
                    <p className="text-[14px] text-white font-medium">{item.item_name}</p>
                    {item.last_price_date && (
                      <p className="text-[11px] text-white/40">
                        עדכון: {new Date(item.last_price_date).toLocaleDateString('he-IL')}
                      </p>
                    )}
                  </div>
                  <div className="text-left">
                    <p className="text-[16px] text-white font-bold ltr-num">
                      &#8362;{item.current_price?.toFixed(2) || '-'}
                    </p>
                  </div>
                </Button>
              ))}
            </div>
          )
        )}

        {/* Price history for selected item */}
        {selectedItemId && selectedItem && priceHistory.length > 0 && (
          <div className="mt-3 bg-[#0F1535] border border-[#4C526B] rounded-[10px] p-3">
            <h3 className="text-[14px] font-semibold text-white mb-2">
              היסטוריית מחירים: {selectedItem.item_name}
            </h3>
            <div className="overflow-x-auto">
              <Table className="w-full text-[13px]">
                <TableHeader>
                  <TableRow className="border-b border-[#4C526B] text-white/50">
                    <TableHead className="text-right py-2">תאריך</TableHead>
                    <TableHead className="text-center py-2">מחיר</TableHead>
                    <TableHead className="text-center py-2">כמות</TableHead>
                    <TableHead className="text-center py-2">שינוי</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {priceHistory.map((ph, idx) => {
                    const prevPrice = idx < priceHistory.length - 1 ? priceHistory[idx + 1].price : null;
                    const change = prevPrice ? ((ph.price - prevPrice) / prevPrice) * 100 : null;
                    return (
                      <TableRow key={ph.id} className="border-b border-[#4C526B]/50">
                        <TableCell className="text-right py-2 text-white/70 ltr-num">
                          {new Date(ph.document_date).toLocaleDateString('he-IL')}
                        </TableCell>
                        <TableCell className="text-center py-2 text-white font-medium ltr-num">
                          &#8362;{ph.price.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-center py-2 text-white/50 ltr-num">
                          {ph.quantity || '-'}
                        </TableCell>
                        <TableCell className="text-center py-2 ltr-num">
                          {change != null ? (
                            <span className={`font-medium ${change > 0 ? 'text-[#F64E60]' : change < 0 ? 'text-[#3CD856]' : 'text-white/40'}`}>
                              {change > 0 ? '+' : ''}{change.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-white/30">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      {/* Dismissed/Read alerts section */}
      {alerts.filter(a => a.status !== 'unread').length > 0 && (
        <div className="px-4 py-3 mt-2 border-t border-[#4C526B]">
          <h2 className="text-[14px] font-semibold text-white/50 mb-2">התראות קודמות</h2>
          <div className="flex flex-col gap-1">
            {alerts.filter(a => a.status !== 'unread').slice(0, 10).map((alert) => (
              <div
                key={alert.id}
                className="bg-[#0F1535]/50 border border-[#4C526B]/50 rounded-[8px] p-2 flex items-center gap-2 opacity-60"
              >
                <span className={`text-[12px] font-bold ltr-num ${
                  alert.change_pct > 0 ? 'text-[#F64E60]' : 'text-[#3CD856]'
                }`}>
                  {alert.change_pct > 0 ? '+' : ''}{alert.change_pct.toFixed(1)}%
                </span>
                <span className="text-[12px] text-white/50 truncate flex-1">
                  {alert.item_name} ({alert.supplier_name})
                </span>
                <span className="text-[11px] text-white/30 ltr-num">
                  &#8362;{alert.old_price.toFixed(2)} &larr; &#8362;{alert.new_price.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
