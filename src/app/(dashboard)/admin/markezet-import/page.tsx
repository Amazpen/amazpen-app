"use client";

import { useState, useEffect, useCallback } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface Business { id: string; name: string; }

interface MarkezetRow {
  unique_id: string;
  consolidated_number: string;
  supplier_name: string;
  year: string;
  month: string;
  date_str: string;
  amount: number;
  vat_amount: number;
  image_url: string;
  is_closed: boolean;
  notes: string;
  purchase_uids: string[]; // UIDs of child invoices
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseBubbleDate(raw: string): string {
  if (!raw) return "";
  const m = raw.trim().match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return "";
  const mon = MONTHS[m[1].toLowerCase()];
  if (!mon) return "";
  return `${m[3]}-${mon}-${m[2].padStart(2, "0")}`;
}

function normalizeUrl(u: string) { return u.startsWith("//") ? `https:${u}` : u; }

export default function MarkezetImportPage() {
  const supabase = createClient();
  const { showToast } = useToast();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>("");
  const [rows, setRows] = useState<MarkezetRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("businesses").select("id, name").order("name");
      setBusinesses(data || []);
    })();
  }, [supabase]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      encoding: "UTF-8",
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
      complete: (res) => {
        const parsed: MarkezetRow[] = res.data.map(r => {
          const parseAmount = (v: string) => parseFloat((v || "0").replace(/[₪,\s]/g, "")) || 0;
          const purchases = (r["קניות"] || "").split(/\s*,\s*/).filter(Boolean);
          return {
            unique_id: r["unique id"] || "",
            consolidated_number: r["מספר מרכזת"] || "",
            supplier_name: (r["ספק"] || "").trim(),
            year: r["שנה"] || "",
            month: r["חודש"] || "",
            date_str: r["תאריך מרכזת"] || "",
            amount: parseAmount(r["סכום מרכזת"]),
            vat_amount: parseAmount(r['סכום מע"מ']),
            image_url: r["תמונת מרכזת"] || r["תמונות"] || "",
            is_closed: (r["האם נסגר"] || "").trim() === "כן",
            notes: r["הערות"] || "",
            purchase_uids: purchases,
          };
        }).filter(r => r.unique_id && r.supplier_name);
        setRows(parsed);
      },
      error: () => showToast("שגיאה בקריאת הקובץ", "error"),
    });
  };

  const handleImport = useCallback(async () => {
    if (!selectedBusinessId || rows.length === 0) return;
    setIsImporting(true);
    setProgress("טוען ספקים וחשבוניות קיימות...");

    try {
      const { data: suppliers } = await supabase.from("suppliers").select("id, name").eq("business_id", selectedBusinessId).is("deleted_at", null);
      const supMap = new Map<string, string>();
      (suppliers || []).forEach(s => supMap.set(s.name.toLowerCase().trim(), s.id));

      // Load existing invoices by bubble UID
      const { data: existingInvs } = await supabase.from("invoices").select("id, data_source").eq("business_id", selectedBusinessId).is("deleted_at", null).like("data_source", "bubble:%");
      const uidToInvoiceId = new Map<string, string>();
      (existingInvs || []).forEach(i => {
        const uid = (i.data_source || "").replace("bubble:", "");
        if (uid) uidToInvoiceId.set(uid, i.id);
      });

      // Existing markezet invoices (don't duplicate)
      const { data: existingMarkezet } = await supabase.from("invoices").select("id, data_source").eq("business_id", selectedBusinessId).eq("is_consolidated", true).is("deleted_at", null);
      const existingMarkezetUids = new Set((existingMarkezet || []).map(i => (i.data_source || "").replace("bubble:", "")));

      const { data: { user } } = await supabase.auth.getUser();

      let created = 0, linked = 0, skipped = 0;
      for (let idx = 0; idx < rows.length; idx++) {
        const r = rows[idx];
        setProgress(`מעבד ${idx + 1}/${rows.length} (נוצרו ${created}, קושרו ${linked})`);
        if (idx % 5 === 0) await new Promise(res => setTimeout(res, 0));

        if (existingMarkezetUids.has(r.unique_id)) { skipped++; continue; }

        // David #14 — match by trimmed lower-cased name. Without .trim()
        // here the lookup would miss when import data has trailing spaces
        // ("גד " → no match) while suppliers stored their names trimmed.
        const supplierId = supMap.get(r.supplier_name.toLowerCase().trim());
        const invoiceDate = parseBubbleDate(r.date_str) || (r.year && r.month ? `${r.year}-${r.month.padStart(2, "0")}-01` : null);

        // Upload attachment if bubble URL
        let attachmentUrl: string | null = null;
        if (r.image_url) {
          const url = normalizeUrl(r.image_url);
          if (url.startsWith("http")) {
            if (url.includes("bubble.io") || url.includes("ae8ccc76")) {
              try {
                const resp = await fetch(url);
                if (resp.ok) {
                  const buf = new Uint8Array(await resp.arrayBuffer());
                  const lower = url.toLowerCase();
                  let ext = "jpg", ct = "image/jpeg";
                  if (lower.endsWith(".png")) { ext = "png"; ct = "image/png"; }
                  else if (lower.endsWith(".pdf")) { ext = "pdf"; ct = "application/pdf"; }
                  const path = `bubble-migrate/${selectedBusinessId}/markezet_${r.unique_id}.${ext}`;
                  const { error: upErr } = await supabase.storage.from("attachments").upload(path, buf, { contentType: ct, upsert: true });
                  if (!upErr) {
                    const { data: pub } = supabase.storage.from("attachments").getPublicUrl(path);
                    attachmentUrl = pub.publicUrl;
                  } else {
                    attachmentUrl = url;
                  }
                } else attachmentUrl = url;
              } catch { attachmentUrl = url; }
            } else {
              attachmentUrl = url;
            }
          }
        }

        // Create the markezet (consolidated) invoice
        const { data: newInv, error: insErr } = await supabase.from("invoices").insert({
          business_id: selectedBusinessId,
          supplier_id: supplierId || null,
          invoice_number: r.consolidated_number || null,
          invoice_date: invoiceDate,
          reference_date: invoiceDate,
          subtotal: r.amount - r.vat_amount,
          vat_amount: r.vat_amount,
          total_amount: r.amount,
          status: r.is_closed ? "paid" : "pending",
          notes: r.notes || null,
          created_by: user?.id || null,
          invoice_type: "current",
          is_consolidated: true,
          consolidated_reference: r.consolidated_number || null,
          consolidated_attachment_url: attachmentUrl,
          attachment_url: attachmentUrl,
          data_source: `bubble:${r.unique_id}`,
        }).select("id").single();

        if (insErr || !newInv) continue;
        created++;

        // Link child invoices to this markezet
        for (const childUid of r.purchase_uids) {
          const childId = uidToInvoiceId.get(childUid);
          if (!childId) continue;
          const { error: updErr } = await supabase.from("invoices").update({
            is_consolidated: false,
            consolidated_reference: r.consolidated_number || null,
          }).eq("id", childId);
          if (!updErr) linked++;
        }
      }

      showToast(`הושלם: נוצרו ${created} מרכזות, קושרו ${linked} חשבוניות, דולגו ${skipped}`, "success");
      setRows([]);
      setFileName("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה";
      showToast(`שגיאה: ${msg}`, "error");
    } finally {
      setIsImporting(false);
      setProgress("");
    }
  }, [selectedBusinessId, rows, supabase, showToast]);

  const totalSum = rows.reduce((a, r) => a + r.amount, 0);

  return (
    <div className="min-h-screen bg-[#0F1535] p-4 md:p-8" dir="rtl">
      <div className="max-w-[700px] mx-auto flex flex-col gap-[20px]">
        <div className="text-center">
          <h1 className="text-[22px] font-bold text-white">ייבוא מרכזות</h1>
          <p className="text-[14px] text-white/50 mt-1">העלה קובץ מרכזות מבאבל - יקשר אוטומטית לחשבוניות הקטנות</p>
        </div>

        <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">בחר עסק</h3>
          <Select value={selectedBusinessId || "__none__"} onValueChange={(val) => { setSelectedBusinessId(val === "__none__" ? "" : val); setRows([]); setFileName(""); }}>
            <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
              <SelectValue placeholder="בחר עסק" />
            </SelectTrigger>
            <SelectContent>
              {businesses.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {selectedBusinessId && (
          <div className="bg-[#4956D4]/20 rounded-[15px] p-[15px]">
            <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">העלאת קובץ מרכזות</h3>
            <input type="file" accept=".csv" onChange={handleFile} disabled={isImporting} className="block w-full text-sm text-white/70 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-[#4956D4] file:text-white hover:file:bg-[#3946B4]" />
            {fileName && <div className="mt-3 text-[13px] text-white/70 text-right">{fileName} - {rows.length} מרכזות נטענו, סה"כ ₪{totalSum.toLocaleString()}</div>}
          </div>
        )}

        {rows.length > 0 && (
          <Button disabled={isImporting} onClick={handleImport} className="bg-[#3CD856] hover:bg-[#2CC846] text-white h-[50px] text-[15px] font-bold">
            {isImporting ? progress || "טוען..." : `ייבא ${rows.length} מרכזות`}
          </Button>
        )}
      </div>
    </div>
  );
}
