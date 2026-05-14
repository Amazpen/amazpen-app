'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { uploadFile } from '@/lib/uploadFile';
import { convertPdfToImages } from '@/lib/pdfToImagesAll';
import { useToast } from '@/components/ui/toast';

interface SupplierInfo {
  id: string;
  name: string;
}

interface ScannedDocumentsButtonProps {
  /**
   * If provided, every page is inserted with this business_id (so it shows
   * up in the user's per-business queue). On the admin /ocr page leave
   * undefined — admin will route docs to the right business afterwards.
   */
  businessId?: string;
  /**
   * Used to match supplier_name back to a supplier_id during OCR extraction.
   * Optional — when omitted, supplier matching simply falls back to the
   * reviewer doing it manually in the form.
   */
  suppliers?: SupplierInfo[];
  /** Visual variant. `compact` is for the desktop header chip. */
  variant?: 'default' | 'compact';
  className?: string;
}

/**
 * "מסמכים סרוקים" — Lets the reviewer pick a single multi-page PDF where
 * each page is a different scanned document. We split the PDF page-by-page,
 * upload each page as a JPEG to ocr-documents storage, run Mistral OCR on
 * each, and create one ocr_documents row per page. The OCR queue refreshes
 * via realtime once inserts land.
 */
export default function ScannedDocumentsButton({
  businessId,
  suppliers,
  variant = 'compact',
  className = '',
}: ScannedDocumentsButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const { showToast } = useToast();

  const handleClick = () => {
    if (isProcessing) return;
    inputRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input immediately so picking the same file twice still fires.
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;

    const isPdf =
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      showToast('יש לבחור קובץ PDF שמכיל את המסמכים הסרוקים', 'error');
      return;
    }

    setIsProcessing(true);
    setProgress({ done: 0, total: 0 });
    showToast('מפצל את ה-PDF לעמודים...', 'info');

    try {
      // 1. Split PDF → array of JPEG files (one per page)
      const pages = await convertPdfToImages(file, (current, total) => {
        setProgress({ done: current - 1, total });
      });

      if (pages.length === 0) {
        showToast('לא נמצאו עמודים בקובץ', 'error');
        return;
      }

      setProgress({ done: 0, total: pages.length });
      showToast(`נמצאו ${pages.length} עמודים — מריץ OCR על כל אחד...`, 'info');

      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      let successCount = 0;
      let failCount = 0;

      // 2. For each page → upload → OCR → insert. Sequentially so the user
      //    sees pages appear in order in the queue and we don't hammer the
      //    Mistral API with N parallel requests.
      for (let i = 0; i < pages.length; i++) {
        const pageFile = pages[i];
        const pageNum = i + 1;
        setProgress({ done: i, total: pages.length });

        try {
          // Upload the page image to ocr-documents storage.
          const ts = Date.now();
          const rand = Math.random().toString(36).slice(2, 8);
          const storagePath = `scanned/${ts}-${rand}-p${pageNum}.jpg`;
          const uploadRes = await uploadFile(pageFile, storagePath, 'ocr-documents');
          if (!uploadRes.success || !uploadRes.publicUrl) {
            throw new Error(uploadRes.error || 'שגיאה בהעלאת עמוד');
          }

          // Run Mistral OCR on the page.
          let extracted: Record<string, unknown> | null = null;
          try {
            const fd = new FormData();
            fd.append('file', pageFile);
            if (suppliers && suppliers.length > 0) {
              fd.append('suppliers', JSON.stringify(suppliers));
            }
            const ocrRes = await fetch('/api/ai/ocr-extract-mistral', {
              method: 'POST',
              body: fd,
            });
            if (ocrRes.ok) {
              extracted = await ocrRes.json();
            }
          } catch (ocrErr) {
            console.error(`[ScannedDocs] OCR failed for page ${pageNum} (non-fatal):`, ocrErr);
          }

          // Insert ocr_documents row.
          const { data: docRow, error: docErr } = await supabase
            .from('ocr_documents')
            .insert({
              business_id: businessId || null,
              source: 'upload',
              image_url: uploadRes.publicUrl,
              image_storage_path: storagePath,
              original_filename: pageFile.name,
              file_type: 'image',
              file_size_bytes: pageFile.size,
              status: 'pending',
              ocr_engine: extracted ? 'mistral' : null,
              ocr_processed_at: extracted ? new Date().toISOString() : null,
              reviewed_by: user?.id || null,
            })
            .select('id')
            .single();

          if (docErr || !docRow) {
            throw new Error(docErr?.message || 'שגיאה ביצירת רשומת מסמך');
          }

          // Insert ocr_extracted_data row (when OCR succeeded).
          if (extracted) {
            const nowIso = new Date().toISOString();
            const rawText = typeof extracted.raw_text === 'string' ? extracted.raw_text : null;
            await supabase.from('ocr_extracted_data').insert({
              document_id: docRow.id,
              raw_text: rawText,
              supplier_name: extracted.supplier_name ?? null,
              document_number: extracted.document_number ?? null,
              document_date: extracted.document_date ?? null,
              subtotal: extracted.subtotal ?? null,
              vat_amount: extracted.vat_amount ?? null,
              total_amount: extracted.total_amount ?? null,
              discount_amount: extracted.discount_amount ?? null,
              discount_percentage: extracted.discount_percentage ?? null,
              matched_supplier_id: extracted.matched_supplier_id ?? null,
              // Mirror to mistral_* so the page's "prefer mistral" read path
              // picks up the values (see fetchDocuments in ocr/page.tsx).
              mistral_markdown: rawText,
              mistral_processed_at: nowIso,
              mistral_supplier_name: extracted.supplier_name ?? null,
              mistral_document_number: extracted.document_number ?? null,
              mistral_document_date: extracted.document_date ?? null,
              mistral_subtotal: extracted.subtotal ?? null,
              mistral_vat_amount: extracted.vat_amount ?? null,
              mistral_total_amount: extracted.total_amount ?? null,
              mistral_discount_amount: extracted.discount_amount ?? null,
              mistral_discount_percentage: extracted.discount_percentage ?? null,
              mistral_matched_supplier_id: extracted.matched_supplier_id ?? null,
              mistral_line_items: extracted.line_items ?? null,
            });
          }

          successCount += 1;
        } catch (pageErr) {
          console.error(`[ScannedDocs] Page ${pageNum} failed:`, pageErr);
          failCount += 1;
        }
      }

      setProgress({ done: pages.length, total: pages.length });

      if (failCount === 0) {
        showToast(`${successCount} מסמכים נוצרו בהצלחה — מופיעים בתור`, 'success');
      } else if (successCount === 0) {
        showToast(`כל ${failCount} העמודים נכשלו — נסה שוב`, 'error');
      } else {
        showToast(
          `${successCount} מסמכים נוצרו, ${failCount} נכשלו`,
          'warning',
        );
      }
    } catch (err) {
      console.error('[ScannedDocs] Fatal error:', err);
      showToast(
        err instanceof Error ? err.message : 'שגיאה בעיבוד המסמכים הסרוקים',
        'error',
      );
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  const baseClasses =
    variant === 'compact'
      ? 'inline-flex items-center gap-2 px-3 py-2 rounded-[7px] bg-[#29318A] hover:bg-[#3a44b5] text-white text-[13px] font-medium border border-white/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors'
      : 'inline-flex items-center gap-2 px-4 py-2 rounded-[7px] bg-[#29318A] hover:bg-[#3a44b5] text-white text-[14px] font-semibold border border-white/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors';

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handleFile}
      />
      <Button
        type="button"
        onClick={handleClick}
        disabled={isProcessing}
        className={`${baseClasses} ${className}`}
        title="העלה PDF שמכיל מספר מסמכים — נריץ OCR על כל עמוד בנפרד"
      >
        {isProcessing ? (
          <>
            <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            <span>
              {progress && progress.total > 0
                ? `מעבד ${progress.done}/${progress.total}...`
                : 'מעבד...'}
            </span>
          </>
        ) : (
          <>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="15" x2="15" y2="15" />
              <line x1="12" y1="12" x2="12" y2="18" />
            </svg>
            <span>מסמכים סרוקים</span>
          </>
        )}
      </Button>
    </>
  );
}
