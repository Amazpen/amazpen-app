"use client";

import { WifiOff, RefreshCw, CheckCircle, AlertCircle, Clock } from "lucide-react";

interface OfflineIndicatorProps {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncResult: "success" | "partial" | "error" | null;
  onSync: () => void;
}

export function OfflineIndicator({
  isOnline,
  pendingCount,
  isSyncing,
  lastSyncResult,
  onSync,
}: OfflineIndicatorProps) {
  // Don't show anything if online with no pending and no recent result
  if (isOnline && pendingCount === 0 && !lastSyncResult && !isSyncing) {
    return null;
  }

  // Determine banner state
  if (!isOnline) {
    return (
      <div className="flex items-center justify-center gap-2 bg-orange-600/90 text-white text-sm py-2 px-4 rounded-lg mx-4 mt-2">
        <WifiOff className="w-4 h-4 shrink-0" />
        <span>אופליין - נתונים יישמרו ויסונכרנו אוטומטית כשיחזור חיבור</span>
        {pendingCount > 0 && (
          <span className="bg-white/20 rounded-full px-2 py-0.5 text-xs font-bold mr-1">
            {pendingCount}
          </span>
        )}
      </div>
    );
  }

  if (isSyncing) {
    return (
      <div className="flex items-center justify-center gap-2 bg-blue-600/90 text-white text-sm py-2 px-4 rounded-lg mx-4 mt-2">
        <RefreshCw className="w-4 h-4 shrink-0 animate-spin" />
        <span>מסנכרן רישומים...</span>
      </div>
    );
  }

  if (lastSyncResult === "success") {
    return (
      <div className="flex items-center justify-center gap-2 bg-green-600/90 text-white text-sm py-2 px-4 rounded-lg mx-4 mt-2">
        <CheckCircle className="w-4 h-4 shrink-0" />
        <span>כל הרישומים סונכרנו בהצלחה!</span>
      </div>
    );
  }

  if (lastSyncResult === "partial") {
    return (
      <div className="flex items-center justify-center gap-2 bg-yellow-600/90 text-white text-sm py-2 px-4 rounded-lg mx-4 mt-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>חלק מהרישומים סונכרנו. {pendingCount} ממתינים.</span>
        <button onClick={onSync} className="underline hover:no-underline text-xs">
          נסה שוב
        </button>
      </div>
    );
  }

  if (lastSyncResult === "error") {
    return (
      <div className="flex items-center justify-center gap-2 bg-red-600/90 text-white text-sm py-2 px-4 rounded-lg mx-4 mt-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>שגיאה בסנכרון. {pendingCount} רישומים ממתינים.</span>
        <button onClick={onSync} className="underline hover:no-underline text-xs">
          נסה שוב
        </button>
      </div>
    );
  }

  // Online but has pending entries (not yet synced)
  if (pendingCount > 0) {
    return (
      <div className="flex items-center justify-center gap-2 bg-blue-600/90 text-white text-sm py-2 px-4 rounded-lg mx-4 mt-2">
        <Clock className="w-4 h-4 shrink-0" />
        <span>{pendingCount} רישומים ממתינים לסנכרון</span>
        <button onClick={onSync} className="underline hover:no-underline text-xs">
          סנכרן עכשיו
        </button>
      </div>
    );
  }

  return null;
}
