"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ArrowUp, Mic, Square, Camera, X, FileText, Loader2 } from "lucide-react";

const MAX_FILES = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

/** Send a file to the OCR API and return extracted text.
 *  For PDFs: first tries server-side text extraction.
 *  If that returns empty (scanned PDF), renders first page to image client-side and OCRs it. */
async function ocrFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/ai/ocr", { method: "POST", body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "שגיאה" }));
    throw new Error(err.error || "OCR failed");
  }
  const data = await res.json();

  // If we got text, return it
  if (data.text && data.text.trim().length > 0) return data.text;

  // For PDFs with no extracted text (scanned), render to image and OCR
  if (file.type === "application/pdf") {
    return ocrScannedPdf(file);
  }

  return "";
}

/** Render a scanned PDF's pages to images and OCR them client-side via Google Vision */
async function ocrScannedPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

  const results: string[] = [];
  const pagesToProcess = Math.min(pdf.numPages, 5);

  for (let i = 1; i <= pagesToProcess; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;

    // Convert canvas to blob and send as image
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) continue;

    const imageFile = new File([blob], `page-${i}.png`, { type: "image/png" });
    const fd = new FormData();
    fd.append("file", imageFile);
    const res = await fetch("/api/ai/ocr", { method: "POST", body: fd });
    if (res.ok) {
      const d = await res.json();
      if (d.text) results.push(d.text);
    }
  }

  return results.join("\n\n").trim();
}

interface AiChatInputProps {
  onSend: (message: string, ocrContext?: string) => void;
  onFilesSelected?: (files: File[]) => void;
  disabled?: boolean;
}

export function AiChatInput({ onSend, onFilesSelected, disabled }: AiChatInputProps) {
  const [value, setValue] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isProcessingOcr, setIsProcessingOcr] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 24;
    const maxHeight = lineHeight * 4;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleSend = useCallback(async () => {
    const trimmed = value.trim();
    const hasFiles = selectedFiles.length > 0;
    if ((!trimmed && !hasFiles) || disabled) return;

    // If there are files, process them through OCR first
    if (hasFiles) {
      setIsProcessingOcr(true);
      try {
        const ocrResults = await Promise.all(selectedFiles.map(ocrFile));
        const ocrTexts = ocrResults.filter((t) => t.length > 0);

        // Build OCR context (hidden from chat, sent to AI only)
        const ocrParts: string[] = [];
        if (ocrTexts.length > 0) {
          for (let i = 0; i < ocrTexts.length; i++) {
            const fileName = selectedFiles[i].name;
            ocrParts.push(`תוכן מ-"${fileName}":\n${ocrTexts[i]}`);
          }
        }
        const ocrContext = ocrParts.join("\n\n");

        // Display message: user text or file summary
        const fileNames = selectedFiles.map((f) => f.name).join(", ");
        const displayMessage = trimmed
          ? `${trimmed}\n📎 ${fileNames}`
          : `📎 העלאת מסמך: ${fileNames}`;

        onSend(displayMessage, ocrContext || undefined);

        // Clear files after processing
        setSelectedFiles([]);
        onFilesSelected?.([]);
      } catch {
        // OCR failed — send just the text if available
        if (trimmed) onSend(trimmed);
      } finally {
        setIsProcessingOcr(false);
      }
    } else {
      onSend(trimmed);
    }

    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend, selectedFiles, onFilesSelected]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Whisper-based recording: record audio → send to /api/ai/transcribe → put text in textarea
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      chunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size === 0) return;

        setIsTranscribing(true);
        try {
          const formData = new FormData();
          formData.append("audio", blob, "recording.webm");

          const res = await fetch("/api/ai/transcribe", {
            method: "POST",
            body: formData,
          });

          if (res.ok) {
            const data = await res.json();
            if (data.text) {
              // Put transcribed text in textarea for user to review/edit before sending
              setValue((prev) => {
                const separator = prev && !prev.endsWith(" ") ? " " : "";
                return prev + separator + data.text;
              });
              // Focus textarea so user can edit or press Enter to send
              setTimeout(() => textareaRef.current?.focus(), 100);
            }
          }
        } catch {
          // transcription failed silently
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      // microphone access denied or not available
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const handleMicClick = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const newFiles: File[] = [];
    const totalAllowed = MAX_FILES - selectedFiles.length;

    for (let i = 0; i < Math.min(fileList.length, totalAllowed); i++) {
      const file = fileList[i];
      if (!ACCEPTED_TYPES.includes(file.type)) continue;
      if (file.size > MAX_FILE_SIZE) continue;
      newFiles.push(file);
    }

    if (newFiles.length > 0) {
      const updated = [...selectedFiles, ...newFiles].slice(0, MAX_FILES);
      setSelectedFiles(updated);
      onFilesSelected?.(updated);
    }

    // Reset input so same file can be re-selected
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [selectedFiles, onFilesSelected]);

  const removeFile = useCallback((index: number) => {
    const updated = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(updated);
    onFilesSelected?.(updated);
  }, [selectedFiles, onFilesSelected]);

  // Generate preview URLs for all files (images + PDFs)
  const [filePreviews, setFilePreviews] = useState<(string | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];

    async function generatePreviews() {
      const previews: (string | null)[] = [];

      for (const file of selectedFiles) {
        if (file.type.startsWith("image/")) {
          const url = URL.createObjectURL(file);
          urls.push(url);
          previews.push(url);
        } else if (file.type === "application/pdf") {
          try {
            const pdfjs = await import("pdfjs-dist");
            pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 0.5 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvas, viewport }).promise;
            previews.push(canvas.toDataURL("image/png"));
          } catch {
            previews.push(null);
          }
        } else {
          previews.push(null);
        }
      }

      if (!cancelled) {
        setFilePreviews(previews);
      }
    }

    if (selectedFiles.length > 0) {
      generatePreviews();
    } else {
      setFilePreviews([]);
    }

    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [selectedFiles]);

  const isBusy = disabled || isTranscribing || isProcessingOcr;

  return (
    <div id="onboarding-ai-input" className="flex-shrink-0 border-t border-white/10 bg-[#0F1535] px-2 sm:px-4 py-2 sm:py-3">
      {/* Selected files preview — square thumbnails */}
      {selectedFiles.length > 0 && (
        <div className="mb-2 sm:mb-3" dir="rtl">
          <div className="flex items-center gap-2 mb-1.5 sm:mb-2 px-1">
            <span className="text-[11px] text-white/50">
              {selectedFiles.length} {selectedFiles.length === 1 ? "קובץ" : "קבצים"} מחכים לשליחה
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:gap-2 px-1">
            {selectedFiles.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="relative w-[56px] h-[56px] sm:w-[72px] sm:h-[72px] rounded-[8px] sm:rounded-[10px] overflow-hidden bg-[#29318A] border-2 border-[#6366f1]/40 flex-shrink-0 shadow-lg shadow-[#6366f1]/10"
              >
                {filePreviews[idx] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={filePreviews[idx]!}
                    alt={file.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-0.5 sm:gap-1">
                    <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-white/50" />
                    <span className="text-[8px] sm:text-[9px] text-white/40 uppercase font-medium">PDF</span>
                  </div>
                )}
                {/* Remove button — always visible */}
                <button
                  type="button"
                  onClick={() => removeFile(idx)}
                  className="absolute top-0.5 left-0.5 sm:top-1 sm:left-1 w-[18px] h-[18px] sm:w-[20px] sm:h-[20px] rounded-full bg-black/70 flex items-center justify-center"
                  aria-label="הסר קובץ"
                >
                  <X className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />
                </button>
                {/* File name at bottom */}
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-0.5 sm:px-1 py-0.5 sm:py-1">
                  <span className="text-[7px] sm:text-[8px] text-white/90 block truncate leading-tight">{file.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-end gap-1.5 sm:gap-3" dir="rtl">
        {/* Mic button - right side in RTL */}
        <button
          type="button"
          onClick={handleMicClick}
          disabled={isBusy && !isRecording}
          title={isRecording ? "עצור הקלטה" : "הקלט הודעה קולית"}
          aria-label={isRecording ? "עצור הקלטה" : "הקלט הודעה קולית"}
          className={`flex-shrink-0 w-[38px] h-[38px] sm:w-[44px] sm:h-[44px] rounded-full flex items-center justify-center text-white transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
            isRecording
              ? "bg-red-500 hover:bg-red-600 animate-pulse"
              : "bg-[#29318A] hover:bg-[#3a43a0]"
          }`}
        >
          {isRecording ? (
            <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          ) : (
            <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
          )}
        </button>
        {/* File/Camera button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy || selectedFiles.length >= MAX_FILES}
          title="צלם או העלה מסמך"
          aria-label="צלם או העלה מסמך"
          className={`relative flex-shrink-0 w-[38px] h-[38px] sm:w-[44px] sm:h-[44px] rounded-full bg-[#29318A] hover:bg-[#3a43a0] flex items-center justify-center text-white transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
            selectedFiles.length > 0 ? "ring-2 ring-[#6366f1]" : ""
          }`}
        >
          <Camera className="w-4 h-4 sm:w-5 sm:h-5" />
          {selectedFiles.length > 0 && (
            <span className="absolute -top-1 -left-1 w-[16px] h-[16px] sm:w-[18px] sm:h-[18px] rounded-full bg-[#6366f1] text-[9px] sm:text-[10px] font-bold flex items-center justify-center">
              {selectedFiles.length}
            </span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          capture="environment"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isProcessingOcr ? "מזהה טקסט מהקבצים..." : isTranscribing ? "ממלל הודעה קולית..." : "שאל שאלה על העסק שלך..."}
          disabled={isBusy}
          rows={1}
          className="flex-1 resize-none bg-[#29318A] text-white text-[14px] sm:text-[15px] leading-[22px] sm:leading-[24px] rounded-[12px] sm:rounded-[14px] px-3 sm:px-4 py-2 sm:py-3 placeholder:text-white/40 outline-none focus:ring-2 focus:ring-[#6366f1]/50 transition-shadow disabled:opacity-50 scrollbar-thin"
        />
        {/* Send button - left side in RTL */}
        <button
          type="button"
          onClick={handleSend}
          disabled={(!value.trim() && selectedFiles.length === 0) || isBusy}
          title="שלח הודעה"
          aria-label="שלח הודעה"
          className="flex-shrink-0 w-[38px] h-[38px] sm:w-[44px] sm:h-[44px] rounded-full bg-[#6366f1] flex items-center justify-center text-white transition-all hover:bg-[#5558e6] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[#6366f1] disabled:active:scale-100"
        >
          {isProcessingOcr ? (
            <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
          ) : (
            <ArrowUp className="w-4 h-4 sm:w-5 sm:h-5 -rotate-45" />
          )}
        </button>
      </div>
    </div>
  );
}
