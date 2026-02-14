"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ArrowUp, Mic, Square, Camera } from "lucide-react";

interface AiChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function AiChatInput({ onSend, disabled }: AiChatInputProps) {
  const [value, setValue] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const isBusy = disabled || isTranscribing;

  return (
    <div id="onboarding-ai-input" className="flex-shrink-0 border-t border-white/10 bg-[#0F1535] px-4 py-3">
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
        {/* OCR button */}
        <button
          type="button"
          disabled={isBusy}
          title="צלם וזהה טקסט"
          aria-label="צלם וזהה טקסט"
          className="flex-shrink-0 w-[44px] h-[44px] rounded-full bg-[#29318A] hover:bg-[#3a43a0] flex items-center justify-center text-white transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Camera className="w-5 h-5" />
        </button>
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
