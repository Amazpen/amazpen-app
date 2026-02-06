"use client";

import { useRef, useEffect, useCallback } from "react";
import type { AiMessage } from "@/types/ai";
import { AiMessageBubble, AiTypingIndicator } from "./AiMessageBubble";

interface AiMessageListProps {
  messages: AiMessage[];
  isLoading: boolean;
}

export function AiMessageList({ messages, isLoading }: AiMessageListProps) {
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
      className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin"
    >
      {messages.map((message) => (
        <AiMessageBubble key={message.id} message={message} />
      ))}
      {isLoading && <AiTypingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
