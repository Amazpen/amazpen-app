import { get, set, del, keys, createStore } from "idb-keyval";

// Separate IndexedDB stores for different data types
const pendingStore = createStore("amazpen-offline", "pendingEntries");
const configStore = createStore("amazpen-offline-config", "businessConfig");

// ============================================
// Pending Daily Entries (offline queue)
// ============================================

export interface PendingDailyEntry {
  id: string;
  businessId: string;
  timestamp: number;
  formData: Record<string, unknown>;
  incomeData: Record<string, unknown>;
  receiptData: Record<string, unknown>;
  parameterData: Record<string, unknown>;
  productUsage: Record<string, unknown>;
  pearlaData?: Record<string, unknown>;
  userId?: string;
}

export async function savePendingEntry(entry: PendingDailyEntry): Promise<void> {
  await set(entry.id, entry, pendingStore);
}

export async function getPendingEntries(): Promise<PendingDailyEntry[]> {
  const allKeys = await keys(pendingStore);
  const entries: PendingDailyEntry[] = [];
  for (const key of allKeys) {
    const entry = await get<PendingDailyEntry>(key, pendingStore);
    if (entry) entries.push(entry);
  }
  return entries.sort((a, b) => a.timestamp - b.timestamp);
}

export async function getPendingCount(): Promise<number> {
  const allKeys = await keys(pendingStore);
  return allKeys.length;
}

export async function removePendingEntry(id: string): Promise<void> {
  await del(id, pendingStore);
}

// ============================================
// Business Config Cache (for offline form loading)
// ============================================

export interface BusinessConfigCache {
  businessId: string;
  cachedAt: number;
  incomeSources: unknown[];
  receiptTypes: unknown[];
  customParameters: unknown[];
  managedProducts: unknown[];
  goals: unknown | null;
  business: unknown | null;
}

export async function saveBusinessConfig(
  businessId: string,
  config: Omit<BusinessConfigCache, "businessId" | "cachedAt">
): Promise<void> {
  await set(
    businessId,
    { ...config, businessId, cachedAt: Date.now() },
    configStore
  );
}

export async function getBusinessConfig(
  businessId: string
): Promise<BusinessConfigCache | null> {
  const config = await get<BusinessConfigCache>(businessId, configStore);
  return config || null;
}
