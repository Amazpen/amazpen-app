"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  getPendingEntries,
  getPendingCount,
  removePendingEntry,
  type PendingDailyEntry,
} from "@/lib/offlineStore";

interface UseOfflineSyncResult {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncResult: "success" | "partial" | "error" | null;
  syncPending: () => Promise<void>;
  refreshPendingCount: () => Promise<void>;
}

export function useOfflineSync(): UseOfflineSyncResult {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<"success" | "partial" | "error" | null>(null);
  const syncInProgress = useRef(false);

  // Set initial online state in useEffect to avoid hydration mismatch
  useEffect(() => {
    setIsOnline(navigator.onLine);
  }, []);

  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch {
      // IndexedDB may not be available
    }
  }, []);

  // Sync a single pending entry to Supabase
  const syncEntry = async (entry: PendingDailyEntry): Promise<boolean> => {
    try {
      const supabase = createClient();

      const formData = entry.formData as Record<string, string>;
      const incomeData = entry.incomeData as Record<string, { amount: string; orders_count: string }>;
      const receiptData = entry.receiptData as Record<string, string>;
      const parameterData = entry.parameterData as Record<string, string>;
      const productUsage = entry.productUsage as Record<string, { opening_stock: string; received_quantity: string; closing_stock: string }>;

      // Create daily entry
      const { data: dailyEntry, error: entryError } = await supabase
        .from("daily_entries")
        .insert({
          business_id: entry.businessId,
          entry_date: formData.entry_date,
          total_register: parseFloat(formData.total_register) || 0,
          labor_cost: parseFloat(formData.labor_cost) || 0,
          labor_hours: parseFloat(formData.labor_hours) || 0,
          discounts: parseFloat(formData.discounts) || 0,
          day_factor: parseFloat(formData.day_factor) || 1,
          manager_daily_cost: 0,
          created_by: entry.userId || undefined,
        })
        .select()
        .single();

      if (entryError) {
        // Duplicate entry — consider it synced, remove from queue
        if (entryError.code === "23505") {
          return true;
        }
        throw entryError;
      }

      const dailyEntryId = dailyEntry.id;

      // Save income breakdown
      for (const [sourceId, data] of Object.entries(incomeData)) {
        const amount = parseFloat(data.amount) || 0;
        const ordersCount = parseInt(data.orders_count) || 0;
        if (amount > 0 || ordersCount > 0) {
          await supabase.from("daily_income_breakdown").insert({
            daily_entry_id: dailyEntryId,
            income_source_id: sourceId,
            amount,
            orders_count: ordersCount,
          });
        }
      }

      // Save receipts
      for (const [receiptId, value] of Object.entries(receiptData)) {
        const amount = parseFloat(value) || 0;
        if (amount > 0) {
          await supabase.from("daily_receipts").insert({
            daily_entry_id: dailyEntryId,
            receipt_type_id: receiptId,
            amount,
          });
        }
      }

      // Save custom parameters
      for (const [paramId, value] of Object.entries(parameterData)) {
        const val = parseFloat(value) || 0;
        if (val > 0) {
          await supabase.from("daily_parameters").insert({
            daily_entry_id: dailyEntryId,
            parameter_id: paramId,
            value: val,
          });
        }
      }

      // Save product usage
      for (const [productId, usage] of Object.entries(productUsage)) {
        const openingStock = parseFloat(usage.opening_stock) || 0;
        const receivedQty = parseFloat(usage.received_quantity) || 0;
        const closingStock = parseFloat(usage.closing_stock) || 0;
        if (openingStock > 0 || receivedQty > 0 || closingStock > 0) {
          const quantityUsed = openingStock + receivedQty - closingStock;
          await supabase.from("daily_product_usage").insert({
            daily_entry_id: dailyEntryId,
            product_id: productId,
            opening_stock: openingStock,
            received_quantity: receivedQty,
            closing_stock: closingStock,
            quantity: quantityUsed,
            unit_cost_at_time: 0,
          });
          // Update current stock
          await supabase
            .from("managed_products")
            .update({ current_stock: closingStock })
            .eq("id", productId);
        }
      }

      return true;
    } catch (err) {
      console.error("Failed to sync offline entry:", err);
      return false;
    }
  };

  const syncPending = useCallback(async () => {
    if (syncInProgress.current || !navigator.onLine) return;
    syncInProgress.current = true;
    setIsSyncing(true);
    setLastSyncResult(null);

    try {
      const entries = await getPendingEntries();
      if (entries.length === 0) {
        setIsSyncing(false);
        syncInProgress.current = false;
        return;
      }

      let successCount = 0;
      for (const entry of entries) {
        const ok = await syncEntry(entry);
        if (ok) {
          await removePendingEntry(entry.id);
          successCount++;
        }
      }

      await refreshPendingCount();

      if (successCount === entries.length) {
        setLastSyncResult("success");
      } else if (successCount > 0) {
        setLastSyncResult("partial");
      } else {
        setLastSyncResult("error");
      }

      // Clear result after 5 seconds
      setTimeout(() => setLastSyncResult(null), 5000);
    } catch {
      setLastSyncResult("error");
      setTimeout(() => setLastSyncResult(null), 5000);
    } finally {
      setIsSyncing(false);
      syncInProgress.current = false;
    }
  }, [refreshPendingCount]);

  // Listen to online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Auto-sync when coming back online
      syncPending();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial pending count
    refreshPendingCount();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncPending, refreshPendingCount]);

  return {
    isOnline,
    pendingCount,
    isSyncing,
    lastSyncResult,
    syncPending,
    refreshPendingCount,
  };
}
