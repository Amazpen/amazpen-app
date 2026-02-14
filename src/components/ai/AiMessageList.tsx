"use client";

import { useRef, useEffect, useCallback } from "react";
import type { UIMessage } from "ai";
import type { AiChartData } from "@/types/ai";
import { AiMessageBubble, AiThinkingBubble } from "./AiMessageBubble";

interface AiMessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  thinkingStatus?: string | null;
  getChartData: (message: UIMessage) => AiChartData | undefined;
  getDisplayText: (message: UIMessage) => string;
}

export function AiMessageList({ messages, isLoading, thinkingStatus, getChartData, getDisplayText }: AiMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const checkIfNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 100;
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]);

  return (
    <div
      ref={scrollRef}
      onScroll={checkIfNearBottom}
      className="flex-1 overflow-y-auto px-2 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4 scrollbar-thin"
    >
      {messages.map((message, idx) => (
        <AiMessageBubble
          key={message.id}
          message={message}
          thinkingStatus={isLoading && idx === messages.length - 1 ? thinkingStatus : null}
          getChartData={getChartData}
          getDisplayText={getDisplayText}
        />
      ))}
      {isLoading && messages.length > 0 && messages[messages.length - 1].role === "user" && (
        <AiThinkingBubble status={thinkingStatus || "חושב..."} />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
