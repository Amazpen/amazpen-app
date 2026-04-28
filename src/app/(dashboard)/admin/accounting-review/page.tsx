"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useDashboard } from "@/app/(dashboard)/layout";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DateRangePicker,
  type DateRange,
} from "@/components/ui/date-range-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  FileSpreadsheet,
  ArrowUpDown,
  Eye,
  Loader2,
  Search,
  CheckCheck,
  X,
} from "lucide-react";

// Lazy-load DocumentViewer (avoids loading pdfjs unless needed)
const DocumentViewer = dynamic(
  () => import("@/components/ocr/DocumentViewer"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin w-6 h-6 text-white/40" />
      </div>
    ),
  }
);

// ===== Types =====

interface Business {
  id: string;
  name: string;
  logo_url: string | null;
}

interface InvoiceRow {
  id: string;
  business_id: string;
  supplier_id: string;
  invoice_number: string | null;
  invoice_date: string;
  subtotal: number;
  vat_amount: number | null;
  total_amount: number;
  attachment_url: string | null;
  notes: string | null;
  approval_status: string | null;
  clarification_reason: string | null;
  bookkeeping_registered: boolean;
  bookkeeping_registered_by: string | null;
  bookkeeping_registered_at: string | null;
  supplier_name: string;
}

// ===== Helpers =====

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
  }).format(amount);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

// ===== Component =====

export default function AccountingReviewPage() {
  const supabase = createClient();
  const { showToast } = useToast();

  // Auth & admin
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Business selection
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] =
    usePersistedState<string>("admin-accounting-review:businessId", "");

  // Date range — from global context (shared across pages)
  const { globalDateRange: dateRange, setGlobalDateRange: setDateRange } = useDashboard();

  // Invoices
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Detail panel
  const [detailInvoice, setDetailInvoice] = useState<InvoiceRow | null>(null);

  // Filters
  const [filterSupplier, setFilterSupplier] = useState<string>("");
  const [filterReference, setFilterReference] = useState<string>("");
  const [filterAccounting, setFilterAccounting] = useState<string>("all"); // "all" | "yes" | "no"

  // "הצג הכל" — fetch all invoices regardless of month filter. A reference
  // search also implicitly disables the date filter so users can find an
  // invoice from any month by typing its number.
  const [showAllDates, setShowAllDates] = usePersistedState<boolean>(
    "admin-accounting-review:showAllDates",
    false,
  );
  // Debounce the reference input so typing doesn't hammer Supabase when it
  // forces a full-history fetch.
  const [debouncedReference, setDebouncedReference] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedReference(filterReference.trim()), 300);
    return () => clearTimeout(id);
  }, [filterReference]);
  const dateFilterDisabled = showAllDates || debouncedReference !== "";

  // ===== Auth check =====
  useEffect(() => {
    async function checkAdmin() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setIsLoading(false);
        return;
      }
      setUserId(user.id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .maybeSingle();

      const admin = profile?.is_admin === true;
      setIsAdmin(admin);
      setIsLoading(false);
    }
    checkAdmin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Fetch businesses =====
  useEffect(() => {
    if (!isAdmin) return;
    async function fetchBusinesses() {
      const { data } = await supabase
        .from("businesses")
        .select("id, name, logo_url")
        .order("name");
      if (data) setBusinesses(data);
    }
    fetchBusinesses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Reset filters only when the user switches businesses — NOT on every
  // refetch, otherwise typing in the reference box would wipe itself.
  useEffect(() => {
    setSelectedIds(new Set());
    setDetailInvoice(null);
    setFilterSupplier("");
    setFilterReference("");
    setFilterAccounting("all");
  }, [selectedBusinessId]);

  // ===== Fetch invoices when business / date range / scope changes =====
  const fetchInvoices = useCallback(async () => {
    if (!selectedBusinessId) {
      setInvoices([]);
      return;
    }
    setIsLoadingInvoices(true);

    // PostgREST caps a single response at 1000 rows, so "הצג הכל" on a large
    // business silently truncated. Paginate through the result with .range()
    // until we've pulled everything matching the current filters.
    const PAGE_SIZE = 1000;
    const buildQuery = () => {
      let q = supabase
        .from("invoices")
        .select(
          "id, business_id, supplier_id, invoice_number, invoice_date, subtotal, vat_amount, total_amount, attachment_url, notes, approval_status, clarification_reason, bookkeeping_registered, bookkeeping_registered_by, bookkeeping_registered_at, supplier:suppliers!inner(name)"
        )
        .eq("business_id", selectedBusinessId)
        .is("deleted_at", null);

      // Skip the date window when the user opts into "הצג הכל" or is actively
      // searching by reference — a reference search must hit all history so
      // invoices from other months are reachable.
      if (!dateFilterDisabled) {
        const startStr = dateRange.start.toISOString().split("T")[0];
        const endStr = dateRange.end.toISOString().split("T")[0];
        q = q.gte("invoice_date", startStr).lte("invoice_date", endStr);
      }

      // Push the reference filter to the server so we don't pull every invoice
      // ever when the user has no date bound — ilike is indexable via trigram.
      if (debouncedReference) {
        q = q.ilike("invoice_number", `%${debouncedReference}%`);
      }
      // Tie-break by id so paging is stable even when multiple invoices share
      // the same invoice_date.
      return q
        .order("invoice_date", { ascending: sortAsc })
        .order("id", { ascending: true });
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await buildQuery().range(from, to);
      if (error) {
        showToast("שגיאה בטעינת חשבוניות", "error");
        setIsLoadingInvoices(false);
        return;
      }
      const batch = data || [];
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      // Hard cap so a pathological query can never hang the UI.
      if (all.length >= 20000) break;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: InvoiceRow[] = all.map((row: any) => ({
      ...row,
      supplier_name: row.supplier?.name || "—",
    }));

    setInvoices(mapped);
    setIsLoadingInvoices(false);
  }, [selectedBusinessId, dateRange, sortAsc, supabase, showToast, dateFilterDisabled, debouncedReference]);

  useEffect(() => {
    if (isAdmin && selectedBusinessId) fetchInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId, dateRange, sortAsc, isAdmin, dateFilterDisabled, debouncedReference]);

  // Realtime — invoices and linked payments can be updated by others (or by
  // OCR approval flow) while this admin review screen is open. Auto-refresh
  // so approvals/status changes reflect without a manual reload.
  useMultiTableRealtime(
    ["invoices", "payments", "payment_splits"],
    fetchInvoices,
    !!(isAdmin && selectedBusinessId),
  );

  // ===== Toggle approval status =====
  const toggleApproval = useCallback(
    async (invoice: InvoiceRow) => {
      // Bookkeeping registration lives in its own column so it no longer
      // overwrites the manager-approval signal stored in approval_status.
      const nextRegistered = !invoice.bookkeeping_registered;

      const updatePayload = nextRegistered
        ? {
            bookkeeping_registered: true,
            bookkeeping_registered_by: userId,
            bookkeeping_registered_at: new Date().toISOString(),
          }
        : {
            bookkeeping_registered: false,
            bookkeeping_registered_by: null as string | null,
            bookkeeping_registered_at: null as string | null,
          };

      const { error } = await supabase
        .from("invoices")
        .update(updatePayload)
        .eq("id", invoice.id);

      if (error) {
        showToast("שגיאה בעדכון סטטוס", "error");
        return;
      }

      setInvoices((prev) =>
        prev.map((inv) =>
          inv.id === invoice.id
            ? {
                ...inv,
                bookkeeping_registered: nextRegistered,
                bookkeeping_registered_by: updatePayload.bookkeeping_registered_by,
                bookkeeping_registered_at: updatePayload.bookkeeping_registered_at,
              }
            : inv
        )
      );

      // Update detail panel if open
      setDetailInvoice((prev) =>
        prev?.id === invoice.id
          ? {
              ...prev,
              bookkeeping_registered: nextRegistered,
              bookkeeping_registered_by: updatePayload.bookkeeping_registered_by,
              bookkeeping_registered_at: updatePayload.bookkeeping_registered_at,
            }
          : prev
      );

      showToast(
        nextRegistered
          ? `חשבונית ${invoice.invoice_number || ""} סומנה כנרשמה בהנה"ח`
          : `חשבונית ${invoice.invoice_number || ""} סומנה כלא נרשמה`,
        nextRegistered ? "success" : "info"
      );
    },
    [supabase, userId, showToast]
  );

  // ===== Selection helpers =====
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredInvoices.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredInvoices.map((i) => i.id)));
    }
  };

  // Unique suppliers for filter dropdown
  const uniqueSuppliers = useMemo(() => {
    const names = [...new Set(invoices.map((i) => i.supplier_name))];
    return names.sort((a, b) => a.localeCompare(b, "he"));
  }, [invoices]);

  // Filtered invoices — reference filter here is case-insensitive and gives
  // instant feedback during the debounce window before the server query fires.
  const filteredInvoices = useMemo(() => {
    const refLower = filterReference.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (filterSupplier && inv.supplier_name !== filterSupplier) return false;
      if (refLower && !(inv.invoice_number || "").toLowerCase().includes(refLower)) return false;
      if (filterAccounting === "yes" && !inv.bookkeeping_registered) return false;
      if (filterAccounting === "no" && inv.bookkeeping_registered) return false;
      return true;
    });
  }, [invoices, filterSupplier, filterReference, filterAccounting]);

  const selectedInvoices = useMemo(
    () => filteredInvoices.filter((i) => selectedIds.has(i.id)),
    [filteredInvoices, selectedIds]
  );

  // ===== Bulk approve selected invoices =====
  const bulkApprove = useCallback(async () => {
    const toApprove = selectedInvoices.filter((inv) => !inv.bookkeeping_registered);
    if (toApprove.length === 0) {
      showToast("כל החשבוניות שנבחרו כבר נרשמו", "info");
      return;
    }

    const ids = toApprove.map((inv) => inv.id);
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("invoices")
      .update({
        bookkeeping_registered: true,
        bookkeeping_registered_by: userId,
        bookkeeping_registered_at: nowIso,
      })
      .in("id", ids);

    if (error) {
      showToast("שגיאה בעדכון סטטוס", "error");
      return;
    }

    setInvoices((prev) =>
      prev.map((inv) =>
        ids.includes(inv.id)
          ? {
              ...inv,
              bookkeeping_registered: true,
              bookkeeping_registered_by: userId,
              bookkeeping_registered_at: nowIso,
            }
          : inv
      )
    );
    // Clear the selection so the checkboxes reset and the user can keep working
    // on other rows without the previous batch staying ticked.
    setSelectedIds(new Set());
    showToast(`${toApprove.length} חשבוניות סומנו כנרשמו בהנה"ח`, "success");
  }, [selectedInvoices, supabase, userId, showToast]);

  // ===== CSV Export =====
  const exportCsv = useCallback(() => {
    if (selectedInvoices.length === 0) return;
    const headers = [
      "תאריך",
      "ספק",
      "אסמכתא",
      'סכום לפני מע"מ',
      'סכום אחרי מע"מ',
      'נרשם בהנה"ח',
      "הערות",
      "קישור למסמך",
    ];
    const rows = selectedInvoices.map((inv) => [
      formatDate(inv.invoice_date),
      inv.supplier_name,
      inv.invoice_number || "-",
      inv.subtotal.toString(),
      inv.total_amount.toString(),
      inv.bookkeeping_registered ? "כן" : "לא",
      inv.notes || "",
      inv.attachment_url || "",
    ]);

    const BOM = "\uFEFF";
    const csv =
      BOM +
      [
        headers.join(","),
        ...rows.map((r) =>
          r
            .map((c) => `"${c.replace(/"/g, '""')}"`)
            .join(",")
        ),
      ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `accounting-review-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`יוצאו ${selectedInvoices.length} חשבוניות ל-CSV`, "success");
  }, [selectedInvoices, showToast]);

  // ===== Download documents =====
  const downloadDocuments = useCallback(async () => {
    const withAttachments = selectedInvoices.filter((i) => i.attachment_url);
    if (withAttachments.length === 0) {
      showToast("אין מסמכים מצורפים לחשבוניות שנבחרו", "error");
      return;
    }

    // Download as ZIP (even single file — consistent behavior)
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      showToast(`מכין ${withAttachments.length} מסמכים להורדה...`, "info");

      // Sanitize names so Windows / macOS / Linux can all extract the zip.
      // Windows blocks: \ / : * ? " < > | and trailing dots/spaces.
      // Hebrew gershayim (״ U+05F4 and " U+0022) are common in supplier names
      // and break Windows extraction silently with "parameter is incorrect".
      const sanitizeFileName = (name: string): string =>
        name
          .replace(/["׳״'`]/g, "") // strip all quote variants
          .replace(/[\\/:*?<>|\x00-\x1f]/g, "_") // illegal chars → underscore
          .replace(/\s+/g, " ")
          .replace(/\.+$/, "") // no trailing dot
          .trim()
          .slice(0, 120); // keep total path < 240, leave room for ext + dir

      // Pull the real extension from the URL path, ignoring query strings AND
      // intermediate dots (e.g. "15.02.26" date in the path → '26' was being
      // treated as the extension and Windows refused the file).
      const extractExt = (url: string): string => {
        try {
          const path = new URL(url).pathname;
          const m = path.match(/\.(pdf|jpe?g|png|gif|webp|tiff?|heic|bmp)$/i);
          return m ? m[1].toLowerCase() : "pdf";
        } catch {
          const m = url.split("?")[0].match(/\.(pdf|jpe?g|png|gif|webp|tiff?|heic|bmp)$/i);
          return m ? m[1].toLowerCase() : "pdf";
        }
      };

      // Track filenames inside the zip and append a counter on collision so we
      // never silently overwrite (two invoices with the same number from the
      // same supplier on the same day used to produce one entry).
      const usedNames = new Set<string>();
      const uniqueName = (base: string, ext: string): string => {
        let candidate = `${base}.${ext}`;
        let n = 2;
        while (usedNames.has(candidate)) {
          candidate = `${base}_(${n}).${ext}`;
          n++;
        }
        usedNames.add(candidate);
        return candidate;
      };

      let successCount = 0;
      await Promise.all(
        withAttachments.map(async (inv, idx) => {
          try {
            const res = await fetch(inv.attachment_url!);
            if (!res.ok) return;
            const blob = await res.blob();
            const ext = extractExt(inv.attachment_url!);
            const supplier = sanitizeFileName(inv.supplier_name || "ספק");
            const docNum = sanitizeFileName(String(inv.invoice_number || idx));
            const date = sanitizeFileName(formatDate(inv.invoice_date));
            const base = `${supplier}_${docNum}_${date}`;
            const filename = uniqueName(base, ext);
            zip.file(filename, blob);
            successCount++;
          } catch {
            // Skip failed downloads
          }
        })
      );

      if (successCount === 0) {
        showToast("לא הצלחנו להוריד את המסמכים", "error");
        return;
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoices-${new Date().toISOString().split("T")[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`הורדו ${successCount} מסמכים בקובץ ZIP`, "success");
    } catch {
      // Fallback: open each in a new tab
      withAttachments.forEach((inv) => window.open(inv.attachment_url!, "_blank"));
      showToast("לא הצלחנו ליצור ZIP, נפתחו בכרטיסיות חדשות", "info");
    }
  }, [selectedInvoices, showToast]);

  // ===== Render =====

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin w-8 h-8 text-white/40" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full text-white/60">
        אין לך הרשאה לצפות בדף זה
      </div>
    );
  }

  return (
    <div className="flex flex-row-reverse overflow-hidden" style={{ height: "calc(100vh - 70px)" }}>
      {/* ===== Main Content ===== */}
      <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
        {/* Actions + Date Range */}
        <div className="flex items-center justify-between gap-4 flex-shrink-0">
          {selectedIds.size > 0 ? (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-white/70 bg-white/5 px-3 py-1.5 rounded-md border border-white/10">
                {selectedIds.size} נבחרו
              </span>
              <Button
                className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-green-500/30 bg-green-500/10 text-sm font-medium text-green-400 hover:bg-green-500/20 hover:border-green-500/40 transition-colors"
                onClick={bulkApprove}
              >
                <CheckCheck className="w-4 h-4" />
                סמן כנרשמו
              </Button>
              <Button
                className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-white/20 bg-white/5 text-sm font-medium text-white/90 hover:bg-white/10 hover:border-white/30 transition-colors"
                onClick={exportCsv}
              >
                <FileSpreadsheet className="w-4 h-4" />
                ייצא CSV
              </Button>
              <Button
                className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-white/20 bg-white/5 text-sm font-medium text-white/90 hover:bg-white/10 hover:border-white/30 transition-colors"
                onClick={downloadDocuments}
              >
                <Download className="w-4 h-4" />
                הורד מסמכים
              </Button>
            </div>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={() => setShowAllDates((v) => !v)}
              className={`inline-flex items-center h-9 px-3 rounded-md border text-sm font-medium transition-colors ${
                showAllDates
                  ? "border-[#4C9AFF]/60 bg-[#4C9AFF]/15 text-[#4C9AFF] hover:bg-[#4C9AFF]/25"
                  : "border-white/20 bg-white/5 text-white/90 hover:bg-white/10 hover:border-white/30"
              }`}
              title={showAllDates ? "מציג את כל התאריכים — לחץ כדי לחזור לסינון חודש" : "הצג את כל החשבוניות ללא סינון חודש"}
            >
              {showAllDates ? "כל התאריכים ✓" : "הצג הכל"}
            </Button>
            <div className={dateFilterDisabled ? "opacity-50 pointer-events-none" : ""}>
              <DateRangePicker dateRange={dateRange} onChange={setDateRange} />
            </div>
          </div>
        </div>
        {dateFilterDisabled && (
          <div className="flex-shrink-0 text-xs text-white/60 bg-[#4C9AFF]/10 border border-[#4C9AFF]/30 rounded-md px-3 py-1.5">
            {showAllDates
              ? "מציג את כל החשבוניות — ללא סינון חודשים"
              : "חיפוש לפי אסמכתא פעיל — סינון החודש הושבת באופן זמני"}
          </div>
        )}

        {/* Filters */}
        {selectedBusinessId && (invoices.length > 0 || filterReference || showAllDates) && (
          <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
            {/* Supplier filter */}
            <Select value={filterSupplier || "__all__"} onValueChange={(v) => setFilterSupplier(v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-9 min-w-[160px] border-white/20 bg-white/5 text-sm text-white/90">
                <SelectValue placeholder="כל הספקים" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">כל הספקים</SelectItem>
                {uniqueSuppliers.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filterSupplier && filterSupplier !== "__all__" && (
              <button
                className="text-white/40 hover:text-white/70 transition-colors -ms-2"
                onClick={() => setFilterSupplier("")}
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* Reference number filter */}
            <div className="relative">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
              <input
                type="text"
                placeholder="חיפוש אסמכתא..."
                value={filterReference}
                onChange={(e) => setFilterReference(e.target.value)}
                className="h-9 ps-8 pe-3 w-[160px] rounded-md border border-white/20 bg-white/5 text-sm text-white/90 placeholder:text-white/40 outline-none focus:border-white/40 transition-colors"
              />
              {filterReference && (
                <button
                  className="absolute end-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                  onClick={() => setFilterReference("")}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Accounting status filter */}
            <Select value={filterAccounting} onValueChange={setFilterAccounting}>
              <SelectTrigger className="h-9 min-w-[140px] border-white/20 bg-white/5 text-sm text-white/90">
                <SelectValue placeholder='נרשם בהנה"ח' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                <SelectItem value="yes">נרשם - כן</SelectItem>
                <SelectItem value="no">נרשם - לא</SelectItem>
              </SelectContent>
            </Select>

            {/* Active filters count */}
            {(filterSupplier || filterReference || filterAccounting !== "all") && (
              <button
                className="text-xs text-white/50 hover:text-white/80 underline transition-colors"
                onClick={() => {
                  setFilterSupplier("");
                  setFilterReference("");
                  setFilterAccounting("all");
                }}
              >
                נקה סינון
              </button>
            )}

            {filteredInvoices.length !== invoices.length && (
              <span className="text-xs text-white/40">
                מציג {filteredInvoices.length} מתוך {invoices.length}
              </span>
            )}
          </div>
        )}

        {/* Invoice Table */}
        <div className="flex-1 min-h-0 overflow-auto border border-white/10 rounded-lg">
          {!selectedBusinessId ? (
            <div className="flex items-center justify-center h-full text-white/40">
              בחר עסק מהרשימה
            </div>
          ) : isLoadingInvoices ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="animate-spin w-6 h-6 text-white/40" />
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="flex items-center justify-center h-full text-white/40">
              {invoices.length === 0 ? "אין חשבוניות בטווח התאריכים שנבחר" : "אין תוצאות לסינון שנבחר"}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-white/20 sticky top-0 bg-[#0F1535] z-10">
                  <TableHead className="w-10 text-center">
                    <Checkbox
                      checked={
                        selectedIds.size === filteredInvoices.length &&
                        filteredInvoices.length > 0
                      }
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead
                    className="text-center cursor-pointer select-none"
                    onClick={() => setSortAsc((prev) => !prev)}
                  >
                    <span className="inline-flex items-center gap-1">
                      תאריך
                      <ArrowUpDown className="w-4 h-4" />
                    </span>
                  </TableHead>
                  <TableHead className="text-center">ספק</TableHead>
                  <TableHead className="text-center">אסמכתא</TableHead>
                  <TableHead className="text-center">
                    סכום לפני מע&quot;מ
                  </TableHead>
                  <TableHead className="text-center">
                    סכום אחרי מע&quot;מ
                  </TableHead>
                  <TableHead className="text-center">
                    נרשם בהנה&quot;ח
                  </TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                    onClick={() => setDetailInvoice(inv)}
                  >
                    <TableCell
                      className="text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={selectedIds.has(inv.id)}
                        onCheckedChange={() => toggleSelect(inv.id)}
                      />
                    </TableCell>
                    <TableCell className="text-center font-medium">
                      {formatDate(inv.invoice_date)}
                    </TableCell>
                    <TableCell className="text-center">
                      {inv.supplier_name}
                    </TableCell>
                    <TableCell className="text-center">
                      {inv.invoice_number || "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      {formatCurrency(inv.subtotal)}
                    </TableCell>
                    <TableCell className="text-center">
                      {formatCurrency(inv.total_amount)}
                    </TableCell>
                    <TableCell
                      className="text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                          inv.bookkeeping_registered
                            ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                            : "bg-white/10 text-white/60 hover:bg-white/20"
                        }`}
                        onClick={() => toggleApproval(inv)}
                      >
                        {inv.bookkeeping_registered ? "כן" : "לא"}
                      </button>
                    </TableCell>
                    <TableCell className="text-center">
                      {inv.attachment_url && (
                        <Eye className="w-4 h-4 text-white/40 mx-auto" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Summary row */}
        {filteredInvoices.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 border border-white/10 rounded-lg text-sm text-white/80 flex-shrink-0">
            <span>כמות תנועות: <span className="font-bold text-white ltr-num">{filteredInvoices.length}</span></span>
            <span>סכום כולל מע&quot;מ: <span className="font-bold text-white ltr-num">{formatCurrency(filteredInvoices.reduce((sum, i) => sum + i.total_amount, 0))}</span></span>
          </div>
        )}
      </div>

      {/* ===== Business Sidebar (right in RTL) ===== */}
      <div className="w-[250px] flex-shrink-0 border-e border-white/10 flex flex-col overflow-hidden">
        <div className="text-center font-bold text-lg p-4 border-b border-white/10">
          בחירת עסק
        </div>
        <div className="flex-1 overflow-auto">
          {businesses.map((biz) => (
            <button
              key={biz.id}
              className={`w-full flex items-center gap-2.5 py-3 px-4 transition-colors text-sm ${
                selectedBusinessId === biz.id
                  ? "bg-primary text-white"
                  : "hover:bg-white/5 text-white/80"
              }`}
              onClick={() => setSelectedBusinessId(biz.id)}
            >
              {biz.logo_url ? (
                <img
                  src={biz.logo_url}
                  alt=""
                  className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 text-xs font-bold">
                  {biz.name.charAt(0)}
                </div>
              )}
              <span className="truncate">{biz.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ===== Detail Panel (slide-over from right in RTL) ===== */}
      {detailInvoice && (
        <div className="fixed inset-0 z-[2000] flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setDetailInvoice(null)}
          />
          {/* Panel */}
          <div className="relative me-auto w-full max-w-xl bg-[#0F1535] border-e border-white/10 h-full overflow-auto p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">פרטי חשבונית</h2>
              <Button
                className="h-8 w-8 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center"
                onClick={() => setDetailInvoice(null)}
              >
                ✕
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-white/50">ספק</span>
                <p className="font-medium">{detailInvoice.supplier_name}</p>
              </div>
              <div>
                <span className="text-white/50">תאריך</span>
                <p className="font-medium">
                  {formatDate(detailInvoice.invoice_date)}
                </p>
              </div>
              <div>
                <span className="text-white/50">אסמכתא</span>
                <p className="font-medium">
                  {detailInvoice.invoice_number || "-"}
                </p>
              </div>
              <div>
                <span className="text-white/50">סכום לפני מע&quot;מ</span>
                <p className="font-medium">
                  {formatCurrency(detailInvoice.subtotal)}
                </p>
              </div>
              <div>
                <span className="text-white/50">מע&quot;מ</span>
                <p className="font-medium">
                  {detailInvoice.vat_amount != null
                    ? formatCurrency(detailInvoice.vat_amount)
                    : "-"}
                </p>
              </div>
              <div>
                <span className="text-white/50">סכום אחרי מע&quot;מ</span>
                <p className="font-medium">
                  {formatCurrency(detailInvoice.total_amount)}
                </p>
              </div>
              <div>
                <span className="text-white/50">סטטוס הנה&quot;ח</span>
                <p
                  className={`font-medium ${detailInvoice.bookkeeping_registered ? "text-green-400" : "text-white/60"}`}
                >
                  {detailInvoice.bookkeeping_registered ? "נרשם" : "לא נרשם"}
                </p>
              </div>
            </div>

            {detailInvoice.notes && (
              <div>
                <span className="text-sm text-white/50">הערות</span>
                <p className="text-sm mt-1 p-3 bg-white/5 rounded-lg">
                  {detailInvoice.notes}
                </p>
              </div>
            )}

            {detailInvoice.clarification_reason && (
              <div>
                <span className="text-sm text-white/50">סיבת בירור</span>
                <p className="text-sm mt-1 p-3 bg-yellow-500/10 rounded-lg text-yellow-300">
                  {detailInvoice.clarification_reason}
                </p>
              </div>
            )}

            {/* Document Viewer */}
            {detailInvoice.attachment_url ? (
              <div className="flex-1 min-h-[400px] border border-white/10 rounded-lg overflow-hidden">
                <DocumentViewer imageUrl={detailInvoice.attachment_url} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 border border-white/10 rounded-lg text-white/30">
                אין מסמך מצורף
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
