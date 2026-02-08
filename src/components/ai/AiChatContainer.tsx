"use client";

import { useCallback } from "react";
import { Trash2 } from "lucide-react";
import { useAiChat } from "./useAiChat";
import { AiWelcomeScreen } from "./AiWelcomeScreen";
import { AiMessageList } from "./AiMessageList";
import { AiChatInput } from "./AiChatInput";

interface AiChatContainerProps {
  isAdmin: boolean;
  businessId: string | undefined;
}

export function AiChatContainer({ isAdmin, businessId }: AiChatContainerProps) {
  const { messages, isLoading, sendMessage, clearChat } = useAiChat(businessId);
  const hasMessages = messages.length > 0;

  const handleSuggestionClick = useCallback(
    (text: string) => {
      sendMessage(text);
    },
    [sendMessage]
  );

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0F1535]">
      {/* Chat header bar */}
      {hasMessages && (
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-white/10" dir="rtl">
          <div className="flex items-center gap-2">
            <div className="w-[8px] h-[8px] rounded-full bg-[#3CD856]" />
            <span className="text-white/50 text-[13px]">עוזר AI מוכן</span>
          </div>
          <button
            type="button"
            onClick={clearChat}
            className="flex items-center gap-1.5 text-white/30 hover:text-white/60 text-[12px] transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            נקה שיחה
          </button>
        </div>
      )}

      {/* Main content area */}
      {hasMessages ? (
        <AiMessageList messages={messages} isLoading={isLoading} />
      ) : (
        <AiWelcomeScreen
          isAdmin={isAdmin}
          onSuggestionClick={handleSuggestionClick}
        />
      )}

      {/* Input */}
      <AiChatInput onSend={sendMessage} disabled={isLoading || !businessId} />
    </div>
  );
}
