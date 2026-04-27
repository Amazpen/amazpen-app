"use client";

/**
 * OCR Demo Page — Mistral Document AI Evaluation
 *
 * Standalone test page. Lets you upload any document and see how the
 * Mistral pipeline reads it (markdown + tables + per-page breakdown).
 * Does NOT save to the production OCR queue or touch any business data.
 */

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";

interface PageResult {
  page: number;
  chars: number;
  tableRows: number;
  markdown: string;
}

interface OcrResult {
  ok: boolean;
  error?: string;
  fileName?: string;
  processingMs?: number;
  pageCount?: number;
  totalChars?: number;
  totalTableRows?: number;
  pages?: PageResult[];
  model?: string;
}

export default function OcrDemoPage() {
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [activePage, setActivePage] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = async (mode: "file" | "url") => {
    setBusy(true);
    setResult(null);
    setActivePage(1);
    try {
      let res: Response;
      if (mode === "file" && file) {
        const fd = new FormData();
        fd.append("file", file);
        res = await fetch("/api/ai/ocr-demo", { method: "POST", body: fd });
      } else if (mode === "url" && fileUrl.trim()) {
        res = await fetch("/api/ai/ocr-demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_url: fileUrl.trim() }),
        });
      } else {
        return;
      }
      const data = (await res.json()) as OcrResult;
      setResult(data);
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setFileUrl("");
    setResult(null);
    setActivePage(1);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const currentPage = result?.pages?.find((p) => p.page === activePage);

  return (
    <div
      className="min-h-screen bg-[#0F1535] p-4 md:p-8"
      dir="rtl"
    >
      <div className="max-w-[1100px] mx-auto flex flex-col gap-[20px]">
        {/* Title */}
        <div>
          <h1 className="text-[24px] font-bold text-white">OCR דמו — Mistral Document AI</h1>
          <p className="text-[13px] text-white/60 mt-[4px]">
            עמוד בדיקה. אינו שומר נתונים, אינו פוגע במסמכים קיימים. רק להערכת איכות מנוע ה-OCR החדש.
          </p>
        </div>

        {/* Input card */}
        <div className="bg-[#1A1F3D] rounded-[12px] border border-[#4C526B]/40 p-5 flex flex-col gap-4">
          <div>
            <label className="text-[13px] text-white/80 block mb-[6px]">העלאת קובץ (PDF / תמונה / סרוק)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-[13px] text-white/80 file:mr-3 file:bg-[#29318A] file:text-white file:border-0 file:px-4 file:py-2 file:rounded-[6px] file:cursor-pointer"
            />
            {file && (
              <p className="text-[12px] text-white/50 mt-[4px]">
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[11px] text-white/40">או</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <div>
            <label className="text-[13px] text-white/80 block mb-[6px]">URL ציבורי לקובץ</label>
            <input
              type="url"
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder="https://..."
              className="w-full bg-[#0F1535] border border-[#4C526B]/60 rounded-[6px] px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#29318A]"
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => submit(file ? "file" : "url")}
              disabled={busy || (!file && !fileUrl.trim())}
              className="bg-[#29318A] hover:bg-[#3D44A0] text-white text-[14px] font-medium px-5 py-2 rounded-[6px] disabled:opacity-40"
            >
              {busy ? "מעבד..." : "הרץ Mistral OCR"}
            </Button>
            <Button
              type="button"
              onClick={reset}
              disabled={busy}
              className="bg-transparent border border-[#4C526B]/60 hover:bg-white/5 text-white/80 text-[14px] px-5 py-2 rounded-[6px]"
            >
              איפוס
            </Button>
          </div>
        </div>

        {/* Loading */}
        {busy && (
          <div className="bg-[#1A1F3D] rounded-[12px] border border-[#4C526B]/40 p-8 text-center">
            <div className="inline-block w-8 h-8 border-2 border-[#29318A] border-t-transparent rounded-full animate-spin"></div>
            <p className="text-[14px] text-white/70 mt-3">Mistral מעבד את המסמך — בדרך כלל 3-15 שניות...</p>
          </div>
        )}

        {/* Error */}
        {result && !result.ok && (
          <div className="bg-[#3D1F1F] border border-[#F64E60]/50 rounded-[12px] p-4">
            <p className="text-[14px] text-[#F64E60] font-semibold">שגיאה</p>
            <p className="text-[13px] text-white/80 mt-1 ltr-num">{result.error}</p>
            {result.processingMs && (
              <p className="text-[11px] text-white/40 mt-2 ltr-num">נכשל אחרי {(result.processingMs / 1000).toFixed(2)}s</p>
            )}
          </div>
        )}

        {/* Results */}
        {result?.ok && result.pages && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="עמודים" value={String(result.pageCount ?? 0)} />
              <StatCard
                label="זמן עיבוד"
                value={`${((result.processingMs ?? 0) / 1000).toFixed(2)}s`}
              />
              <StatCard label="סה״כ תווים" value={(result.totalChars ?? 0).toLocaleString()} />
              <StatCard label="שורות טבלה" value={String(result.totalTableRows ?? 0)} />
            </div>

            {/* Page tabs */}
            {result.pages.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {result.pages.map((p) => (
                  <button
                    type="button"
                    key={p.page}
                    onClick={() => setActivePage(p.page)}
                    className={`text-[13px] px-3 py-1.5 rounded-[6px] transition-colors ${
                      activePage === p.page
                        ? "bg-[#29318A] text-white"
                        : "bg-[#1A1F3D] border border-[#4C526B]/40 text-white/70 hover:bg-white/5"
                    }`}
                  >
                    עמוד {p.page} · {p.tableRows > 0 ? `${p.tableRows} שורות טבלה` : `${p.chars} תווים`}
                  </button>
                ))}
              </div>
            )}

            {/* Page content */}
            {currentPage && (
              <div className="bg-[#1A1F3D] rounded-[12px] border border-[#4C526B]/40 overflow-hidden">
                <div className="px-4 py-2 border-b border-[#4C526B]/40 flex items-center justify-between">
                  <span className="text-[13px] text-white/70">
                    עמוד {currentPage.page} · {currentPage.chars.toLocaleString()} תווים · {currentPage.tableRows} שורות טבלה
                  </span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(currentPage.markdown)}
                    className="text-[12px] text-white/50 hover:text-white"
                  >
                    העתק markdown
                  </button>
                </div>
                <pre
                  className="p-4 text-[13px] text-white/90 whitespace-pre-wrap overflow-auto max-h-[600px] font-mono"
                  dir="auto"
                >
                  {currentPage.markdown}
                </pre>
              </div>
            )}

            {/* Raw JSON (collapsed) */}
            <details className="bg-[#1A1F3D] rounded-[12px] border border-[#4C526B]/40 overflow-hidden">
              <summary className="px-4 py-2 cursor-pointer text-[13px] text-white/70 hover:text-white">
                JSON מלא (לבדיקה / debug)
              </summary>
              <pre className="p-4 text-[11px] text-white/70 overflow-auto max-h-[400px] font-mono ltr-num" dir="ltr">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </>
        )}

        {/* Help */}
        <div className="bg-[#0F1535] border border-[#4C526B]/30 rounded-[10px] p-4">
          <p className="text-[12px] text-white/60 leading-[1.7]">
            <strong className="text-white/80">למה הדמו הזה קיים:</strong> הזרימה הקיימת ב-n8n משתמשת ב-Google Vision שמחזיר טקסט שטוח ומאבד מבנה טבלאות.
            Mistral Document AI מחזיר את אותם המסמכים עם <strong className="text-white/80">טבלאות מובנות ב-Markdown</strong> + פיצול לעמודים.
            השוואה מדויקת לאיכות.
          </p>
          <p className="text-[12px] text-white/60 leading-[1.7] mt-2">
            <strong className="text-white/80">מה זה לא עושה:</strong> לא חולץ ספק/סכומים/שורות פריטים (זה השלב הבא — Claude). לא שומר ל-DB. לא משלח התראות. רק OCR.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#1A1F3D] rounded-[10px] border border-[#4C526B]/40 p-4">
      <p className="text-[11px] text-white/50">{label}</p>
      <p className="text-[20px] font-bold text-white ltr-num mt-1">{value}</p>
    </div>
  );
}
