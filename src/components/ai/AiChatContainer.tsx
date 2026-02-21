"use client";

import { useCallback } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAiChat } from "./useAiChat";
import { AiWelcomeScreen } from "./AiWelcomeScreen";
import { AiMessageList } from "./AiMessageList";
import { AiChatInput } from "./AiChatInput";

interface AiChatContainerProps {
  isAdmin: boolean;
  businessId: string | undefined;
}

export function AiChatContainer({ isAdmin, businessId }: AiChatContainerProps) {
  const { messages, isLoading, thinkingStatus, isLoadingHistory, lastError, sendMessage, clearChat, getChartData, getDisplayText } = useAiChat(businessId, isAdmin);
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
        <div className="flex-shrink-0 sticky top-0 z-10 bg-[#0F1535] flex items-center justify-end px-3 sm:px-4 py-1.5 sm:py-2 border-b border-white/10" dir="rtl">
          <Button
            type="button"
            variant="ghost"
            onClick={clearChat}
            className="flex items-center gap-1.5 text-white hover:text-white/70 text-[12px] transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            נקה שיחה
          </Button>
        </div>
      )}

      {/* Main content area */}
      {isLoadingHistory ? (
        <AiWelcomeScreen
          isAdmin={isAdmin}
          onSuggestionClick={handleSuggestionClick}
        />
      ) : hasMessages ? (
        <AiMessageList
          messages={messages}
          isLoading={isLoading}
          thinkingStatus={thinkingStatus}
          lastError={lastError}
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
