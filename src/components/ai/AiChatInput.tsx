"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ArrowUp } from "lucide-react";

interface AiChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function AiChatInput({ onSend, disabled }: AiChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  return (
    <div id="onboarding-ai-input" className="flex-shrink-0 border-t border-white/10 bg-[#0F1535] px-4 py-3">
      <div className="flex items-end gap-3" dir="rtl">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="שאל שאלה על העסק שלך..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-[#29318A] text-white text-[15px] leading-[24px] rounded-[14px] px-4 py-3 placeholder:text-white/40 outline-none focus:ring-2 focus:ring-[#6366f1]/50 transition-shadow disabled:opacity-50 scrollbar-thin"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!value.trim() || disabled}
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
