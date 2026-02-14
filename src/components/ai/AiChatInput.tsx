"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ArrowUp, Mic, Square, Camera, X, FileText } from "lucide-react";

const MAX_FILES = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

interface AiChatInputProps {
  onSend: (message: string) => void;
  onFilesSelected?: (files: File[]) => void;
  disabled?: boolean;
}

export function AiChatInput({ onSend, onFilesSelected, disabled }: AiChatInputProps) {
  const [value, setValue] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
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

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

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
              onSend(data.text);
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
  }, [onSend]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

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

  const isBusy = disabled || isTranscribing;

  return (
    <div id="onboarding-ai-input" className="flex-shrink-0 border-t border-white/10 bg-[#0F1535] px-4 py-3">
      {/* Selected files preview — square thumbnails */}
      {selectedFiles.length > 0 && (
        <div className="mb-3" dir="rtl">
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-[11px] text-white/50">
              {selectedFiles.length} {selectedFiles.length === 1 ? "קובץ" : "קבצים"} מחכים לשליחה
            </span>
          </div>
          <div className="flex flex-wrap gap-2 px-1">
            {selectedFiles.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="relative w-[72px] h-[72px] rounded-[10px] overflow-hidden bg-[#29318A] border-2 border-[#6366f1]/40 flex-shrink-0 shadow-lg shadow-[#6366f1]/10"
              >
                {filePreviews[idx] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={filePreviews[idx]!}
                    alt={file.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                    <FileText className="w-5 h-5 text-white/50" />
                    <span className="text-[9px] text-white/40 uppercase font-medium">PDF</span>
                  </div>
                )}
                {/* Remove button — always visible */}
                <button
                  type="button"
                  onClick={() => removeFile(idx)}
                  className="absolute top-1 left-1 w-[20px] h-[20px] rounded-full bg-black/70 flex items-center justify-center"
                  aria-label="הסר קובץ"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
                {/* File name at bottom */}
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1 py-1">
                  <span className="text-[8px] text-white/90 block truncate leading-tight">{file.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-end gap-3" dir="rtl">
        {/* Mic button - right side in RTL */}
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isBusy && !isRecording}
          title={isRecording ? "עצור הקלטה" : "הקלט הודעה קולית"}
          aria-label={isRecording ? "עצור הקלטה" : "הקלט הודעה קולית"}
          className={`flex-shrink-0 w-[44px] h-[44px] rounded-full flex items-center justify-center text-white transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
            isRecording
              ? "bg-red-500 hover:bg-red-600 animate-pulse"
              : "bg-[#29318A] hover:bg-[#3a43a0]"
          }`}
        >
          {isRecording ? (
            <Square className="w-4 h-4" />
          ) : (
            <Mic className="w-5 h-5" />
          )}
        </button>
        {/* File/Camera button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy || selectedFiles.length >= MAX_FILES}
          title="צלם או העלה מסמך"
          aria-label="צלם או העלה מסמך"
          className={`relative flex-shrink-0 w-[44px] h-[44px] rounded-full bg-[#29318A] hover:bg-[#3a43a0] flex items-center justify-center text-white transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
            selectedFiles.length > 0 ? "ring-2 ring-[#6366f1]" : ""
          }`}
        >
          <Camera className="w-5 h-5" />
          {selectedFiles.length > 0 && (
            <span className="absolute -top-1 -left-1 w-[18px] h-[18px] rounded-full bg-[#6366f1] text-[10px] font-bold flex items-center justify-center">
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
          placeholder={isTranscribing ? "ממלל הודעה קולית..." : "שאל שאלה על העסק שלך..."}
          disabled={isBusy}
          rows={1}
          className="flex-1 resize-none bg-[#29318A] text-white text-[15px] leading-[24px] rounded-[14px] px-4 py-3 placeholder:text-white/40 outline-none focus:ring-2 focus:ring-[#6366f1]/50 transition-shadow disabled:opacity-50 scrollbar-thin"
        />
        {/* Send button - left side in RTL */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!value.trim() || isBusy}
          title="שלח הודעה"
          aria-label="שלח הודעה"
          className="flex-shrink-0 w-[44px] h-[44px] rounded-full bg-[#6366f1] flex items-center justify-center text-white transition-all hover:bg-[#5558e6] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[#6366f1] disabled:active:scale-100"
        >
          <ArrowUp className="w-5 h-5 -rotate-45" />
        </button>
      </div>
    </div>
  );
}
