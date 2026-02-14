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
  const { messages, isLoading, thinkingStatus, isLoadingHistory, sendMessage, clearChat, getChartData, getDisplayText } = useAiChat(businessId, isAdmin);
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
        <div className="flex-shrink-0 flex items-center justify-end px-3 sm:px-4 py-1.5 sm:py-2 border-b border-white/10" dir="rtl">
          <button
            type="button"
            onClick={clearChat}
            className="flex items-center gap-1.5 text-white hover:text-white/70 text-[12px] transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            נקה שיחה
          </button>
        </div>
      )}

      {/* Main content area */}
      {isLoadingHistory ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      ) : hasMessages ? (
        <AiMessageList
          messages={messages}
          isLoading={isLoading}
          thinkingStatus={thinkingStatus}
          getChartData={getChartData}
          getDisplayText={getDisplayText}
        />
      ) : (
        <AiWelcomeScreen
          isAdmin={isAdmin}
          onSuggestionClick={handleSuggestionClick}
        />
      )}

      {/* Input */}
      <AiChatInput onSend={sendMessage} disabled={isLoading || (!isAdmin && !businessId)} />
    </div>
  );
}
