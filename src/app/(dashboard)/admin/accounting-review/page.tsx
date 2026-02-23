"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";
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
  Download,
  FileSpreadsheet,
  ArrowUpDown,
  Eye,
  Loader2,
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
  review_approved_by: string | null;
  review_approved_at: string | null;
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

  // Date range — default: 1st of current month to today
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: now,
    };
  });

  // Invoices
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Detail panel
  const [detailInvoice, setDetailInvoice] = useState<InvoiceRow | null>(null);

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
        .select("id, name")
        .order("name");
      if (data) setBusinesses(data);
    }
    fetchBusinesses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // ===== Fetch invoices when business or date range changes =====
  const fetchInvoices = useCallback(async () => {
    if (!selectedBusinessId) {
      setInvoices([]);
      return;
    }
    setIsLoadingInvoices(true);
    setSelectedIds(new Set());
    setDetailInvoice(null);

    const startStr = dateRange.start.toISOString().split("T")[0];
    const endStr = dateRange.end.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("invoices")
      .select(
        "id, business_id, supplier_id, invoice_number, invoice_date, subtotal, vat_amount, total_amount, attachment_url, notes, approval_status, clarification_reason, review_approved_by, review_approved_at, supplier:suppliers!inner(name)"
      )
      .eq("business_id", selectedBusinessId)
      .is("deleted_at", null)
      .gte("invoice_date", startStr)
      .lte("invoice_date", endStr)
      .order("invoice_date", { ascending: sortAsc });

    if (error) {
      showToast("שגיאה בטעינת חשבוניות", "error");
      setIsLoadingInvoices(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: InvoiceRow[] = (data || []).map((row: any) => ({
      ...row,
      supplier_name: row.supplier?.name || "—",
    }));

    setInvoices(mapped);
    setIsLoadingInvoices(false);
  }, [selectedBusinessId, dateRange, sortAsc, supabase, showToast]);

  useEffect(() => {
    if (isAdmin && selectedBusinessId) fetchInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId, dateRange, sortAsc, isAdmin]);

  // ===== Toggle approval status =====
  const toggleApproval = useCallback(
    async (invoice: InvoiceRow) => {
      const isApproved = invoice.approval_status === "accounting_approved";
      const newStatus = isApproved ? null : "accounting_approved";

      const updatePayload = isApproved
        ? {
            approval_status: null as string | null,
            review_approved_by: null as string | null,
            review_approved_at: null as string | null,
          }
        : {
            approval_status: "accounting_approved" as string | null,
            review_approved_by: userId,
            review_approved_at: new Date().toISOString() as string | null,
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
                approval_status: newStatus,
                review_approved_by: updatePayload.review_approved_by,
                review_approved_at: updatePayload.review_approved_at,
              }
            : inv
        )
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
    if (selectedIds.size === invoices.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(invoices.map((i) => i.id)));
    }
  };

  const selectedInvoices = useMemo(
    () => invoices.filter((i) => selectedIds.has(i.id)),
    [invoices, selectedIds]
  );

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
    ];
    const rows = selectedInvoices.map((inv) => [
      formatDate(inv.invoice_date),
      inv.supplier_name,
      inv.invoice_number || "-",
      inv.subtotal.toString(),
      inv.total_amount.toString(),
      inv.approval_status === "accounting_approved" ? "כן" : "לא",
      inv.notes || "",
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

    if (withAttachments.length === 1) {
      window.open(withAttachments[0].attachment_url!, "_blank");
      return;
    }

    // Multiple files — download as ZIP
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      showToast("מכין קובץ ZIP להורדה...", "info");

      await Promise.all(
        withAttachments.map(async (inv, idx) => {
          try {
            const res = await fetch(inv.attachment_url!);
            const blob = await res.blob();
            const ext =
              inv.attachment_url!.split(".").pop()?.split("?")[0] || "pdf";
            const filename = `${inv.supplier_name}_${inv.invoice_number || idx}_${formatDate(inv.invoice_date)}.${ext}`;
            zip.file(filename, blob);
          } catch {
            // Skip failed downloads
          }
        })
      );

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoices-${new Date().toISOString().split("T")[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`הורדו ${withAttachments.length} מסמכים`, "success");
    } catch {
      showToast("שגיאה בהורדת מסמכים", "error");
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
    <div className="flex flex-row-reverse h-full overflow-hidden">
      {/* ===== Main Content ===== */}
      <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
        {/* Date Range Filter + Actions */}
        <div className="flex items-center gap-4">
          <DateRangePicker dateRange={dateRange} onChange={setDateRange} />
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 mr-auto">
              <span className="text-sm text-white/60">
                {selectedIds.size} נבחרו
              </span>
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <FileSpreadsheet className="w-4 h-4 ml-1" />
                ייצא CSV
              </Button>
              <Button size="sm" variant="outline" onClick={downloadDocuments}>
                <Download className="w-4 h-4 ml-1" />
                הורד מסמכים
              </Button>
            </div>
          )}
        </div>

        {/* Invoice Table */}
        <div className="flex-1 overflow-auto border border-white/10 rounded-lg">
          {!selectedBusinessId ? (
            <div className="flex items-center justify-center h-full text-white/40">
              בחר עסק מהרשימה
            </div>
          ) : isLoadingInvoices ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="animate-spin w-6 h-6 text-white/40" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex items-center justify-center h-full text-white/40">
              אין חשבוניות בטווח התאריכים שנבחר
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-white/20">
                  <TableHead className="w-10 text-center">
                    <Checkbox
                      checked={
                        selectedIds.size === invoices.length &&
                        invoices.length > 0
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
                {invoices.map((inv) => (
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
                          inv.approval_status === "accounting_approved"
                            ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                            : "bg-white/10 text-white/60 hover:bg-white/20"
                        }`}
                        onClick={() => toggleApproval(inv)}
                      >
                        {inv.approval_status === "accounting_approved"
                          ? "כן"
                          : "לא"}
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
              className={`w-full text-center py-3 px-4 transition-colors text-sm ${
                selectedBusinessId === biz.id
                  ? "bg-primary text-white"
                  : "hover:bg-white/5 text-white/80"
              }`}
              onClick={() => setSelectedBusinessId(biz.id)}
            >
              {biz.name}
            </button>
          ))}
        </div>
      </div>

      {/* ===== Detail Panel (slide-over) ===== */}
      {detailInvoice && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setDetailInvoice(null)}
          />
          {/* Panel */}
          <div className="relative ms-auto w-full max-w-xl bg-[#0a0a0a] border-s border-white/10 h-full overflow-auto p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">פרטי חשבונית</h2>
              <Button
                variant="ghost"
                size="sm"
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
                  className={`font-medium ${detailInvoice.approval_status === "accounting_approved" ? "text-green-400" : "text-white/60"}`}
                >
                  {detailInvoice.approval_status === "accounting_approved"
                    ? "נרשם"
                    : "לא נרשם"}
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
