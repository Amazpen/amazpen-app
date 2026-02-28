"use client";

import { useState, useRef, useEffect } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

// ============================================================================
// TYPES
// ============================================================================

interface CsvRow {
  group_id: string;
  name: string;
  amount: number;
  installment_number: number;
  date: string;
  business_name: string;
}

interface ParsedCommitment {
  name: string;
  monthly_amount: number;
  total_installments: number;
  start_date: string;
  end_date: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function parseDate(raw: string): string {
  if (!raw) return "";
  const cleaned = raw.trim().split(" ")[0]; // strip time
  // DD/MM/YYYY
  const parts = cleaned.split("/");
  if (parts.length === 3 && parts[0].length <= 2) {
    return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  // YYYY-MM-DD
  if (cleaned.match(/^\d{4}-\d{2}-\d{2}$/)) return cleaned;
  return "";
}

function parseAmount(raw: string | number | undefined): number {
  if (raw === undefined || raw === null || raw === "") return 0;
  if (typeof raw === "number") return raw;
  const cleaned = raw.replace(/[₪$€,\s]/g, "").trim();
  if (cleaned === "-" || cleaned === "–" || cleaned === "") return 0;
  return parseFloat(cleaned) || 0;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function CommitmentsImportPage() {
  const supabase = createClient();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Business selection
  const [businesses, setBusinesses] = useState<{ id: string; name: string }[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState<string>("admin:commitments:businessId", "");

  // CSV data
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [parsedCommitments, setParsedCommitments] = useState<ParsedCommitment[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");

  // Header aliases for CSV columns
  const headerAliases: Record<string, string> = {
    "שם התחייבות": "name",
    "סכום": "amount",
    "מספר תשלום": "installment_number",
    "תאריך": "date",
    "התחייבות": "group_id",
    "עסק": "business_name",
  };

  // ============================================================================
  // FETCH BUSINESSES
  // ============================================================================

  useEffect(() => {
    (async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user) return;

      const { data: memberships } = await supabase
        .from("business_members")
        .select("business_id, businesses(id, name)")
        .eq("user_id", user.user.id);

      if (memberships) {
        const biz = memberships
          .map((m) => {
            const b = m.businesses as unknown as { id: string; name: string };
            return b ? { id: b.id, name: b.name } : null;
          })
          .filter(Boolean) as { id: string; name: string }[];
        setBusinesses(biz);
        if (!selectedBusinessId && biz.length > 0) setSelectedBusinessId(biz[0].id);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================================
  // CSV PARSING
  // ============================================================================

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: "UTF-8",
      complete: (result) => {
        const raw = result.data as Record<string, string>[];
        if (raw.length === 0) {
          showToast("הקובץ ריק", "error");
          return;
        }

        // Map headers
        const getField = (row: Record<string, string>, alias: string): string => {
          // Direct match
          if (row[alias] !== undefined) return row[alias];
          // Reverse alias lookup
          for (const [csvHeader, mapped] of Object.entries(headerAliases)) {
            if (mapped === alias && row[csvHeader] !== undefined) return row[csvHeader];
          }
          return "";
        };

        const rows: CsvRow[] = raw.map((row) => ({
          group_id: getField(row, "group_id"),
          name: getField(row, "name"),
          amount: parseAmount(getField(row, "amount")),
          installment_number: parseInt(getField(row, "installment_number")) || 0,
          date: parseDate(getField(row, "date")),
          business_name: getField(row, "business_name"),
        })).filter(r => r.group_id && r.name && r.amount > 0 && r.date);

        setCsvRows(rows);

        // Group by commitment ID
        const groups = new Map<string, CsvRow[]>();
        for (const row of rows) {
          if (!groups.has(row.group_id)) groups.set(row.group_id, []);
          groups.get(row.group_id)!.push(row);
        }

        const commitments: ParsedCommitment[] = Array.from(groups.values()).map((group) => {
          const sorted = group.sort((a, b) => a.date.localeCompare(b.date));
          return {
            name: group[0].name,
            monthly_amount: group[0].amount,
            total_installments: group.length,
            start_date: sorted[0].date,
            end_date: sorted[sorted.length - 1].date,
          };
        });

        setParsedCommitments(commitments);
        showToast(`נמצאו ${commitments.length} התחייבויות (${rows.length} שורות)`, "info");
      },
      error: () => {
        showToast("שגיאה בקריאת הקובץ", "error");
      },
    });
  };

  // ============================================================================
  // IMPORT
  // ============================================================================

  const handleImport = async () => {
    if (!selectedBusinessId) {
      showToast("יש לבחור עסק", "error");
      return;
    }
    if (parsedCommitments.length === 0) {
      showToast("אין התחייבויות לייבוא", "error");
      return;
    }

    setIsImporting(true);
    setImportProgress("מייבא...");

    try {
      const { data: user } = await supabase.auth.getUser();

      const records = parsedCommitments.map((c) => ({
        business_id: selectedBusinessId,
        name: c.name,
        monthly_amount: c.monthly_amount,
        total_installments: c.total_installments,
        start_date: c.start_date,
        end_date: c.end_date,
        created_by: user?.user?.id || null,
      }));

      const { error } = await supabase.from("prior_commitments").insert(records);

      if (error) {
        showToast(`שגיאה בייבוא: ${error.message}`, "error");
        return;
      }

      showToast(`יובאו ${records.length} התחייבויות בהצלחה`, "success");
      handleClear();
    } catch {
      showToast("שגיאה בלתי צפויה", "error");
    } finally {
      setIsImporting(false);
      setImportProgress("");
    }
  };

  const handleClear = () => {
    setCsvRows([]);
    setParsedCommitments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold text-white text-center">ייבוא התחייבויות קודמות</h1>

      {/* Business selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-300">עסק:</label>
        <Select value={selectedBusinessId} onValueChange={setSelectedBusinessId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="בחר עסק" />
          </SelectTrigger>
          <SelectContent>
            {businesses.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* File upload */}
      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          className="text-sm text-gray-300"
        />
        {csvRows.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleClear}>
            נקה
          </Button>
        )}
      </div>

      {/* Preview */}
      {parsedCommitments.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">
            תצוגה מקדימה - {parsedCommitments.length} התחייבויות ({csvRows.length} תשלומים)
          </h2>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">שם התחייבות</TableHead>
                <TableHead className="text-right">סכום חודשי</TableHead>
                <TableHead className="text-right">מס׳ תשלומים</TableHead>
                <TableHead className="text-right">תאריך התחלה</TableHead>
                <TableHead className="text-right">תאריך סיום</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parsedCommitments.map((c, i) => (
                <TableRow key={i}>
                  <TableCell className="text-right">{c.name}</TableCell>
                  <TableCell className="text-right">₪{c.monthly_amount.toLocaleString("he-IL")}</TableCell>
                  <TableCell className="text-right">{c.total_installments}</TableCell>
                  <TableCell className="text-right">{c.start_date}</TableCell>
                  <TableCell className="text-right">{c.end_date}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center gap-3">
            <Button onClick={handleImport} disabled={isImporting}>
              {isImporting ? importProgress : `ייבא ${parsedCommitments.length} התחייבויות`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
