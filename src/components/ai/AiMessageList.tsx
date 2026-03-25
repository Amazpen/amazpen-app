"use client";

import { useRef, useEffect, useCallback } from "react";
import type { UIMessage } from "ai";
import type { AiChartData } from "@/types/ai";
import { AiMessageBubble, AiThinkingBubble } from "./AiMessageBubble";

interface AiMessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  thinkingStatus?: string | null;
  lastError?: string | null;
  getChartData: (message: UIMessage) => AiChartData | undefined;
  getDisplayText: (message: UIMessage) => string;
  searchQuery?: string;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  userAvatarUrl?: string | null;
}

export function AiMessageList({ messages, isLoading, thinkingStatus, lastError, getChartData, getDisplayText, searchQuery, hasMore, isLoadingMore, onLoadMore, userAvatarUrl }: AiMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);

  const checkIfNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 100;
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // Detect scroll to top for loading more
  const handleScroll = useCallback(() => {
    checkIfNearBottom();
    const el = scrollRef.current;
    if (!el || !hasMore || isLoadingMore) return;
    // When scrolled near the top (within 50px), load more
    if (el.scrollTop < 50 && onLoadMore) {
      prevScrollHeightRef.current = el.scrollHeight;
      onLoadMore();
    }
  }, [checkIfNearBottom, hasMore, isLoadingMore, onLoadMore]);

  // After loading more messages, maintain scroll position
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !prevScrollHeightRef.current) return;
    const newScrollHeight = el.scrollHeight;
    const diff = newScrollHeight - prevScrollHeightRef.current;
    if (diff > 0) {
      el.scrollTop = diff;
    }
    prevScrollHeightRef.current = 0;
  }, [messages.length]);

  useEffect(() => {
    if (isNearBottomRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-2 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4 scrollbar-thin"
    >
      {/* Load more indicator */}
      {hasMore && (
        <div className="flex justify-center py-2">
          {isLoadingMore ? (
            <div className="flex items-center gap-2 text-white/40 text-xs">
              <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
              <span>טוען הודעות ישנות...</span>
            </div>
          ) : (
            <button
              onClick={onLoadMore}
              className="text-xs text-white/40 hover:text-white/70 transition-colors px-3 py-1 rounded-full border border-white/10 hover:border-white/20"
            >
              טען הודעות ישנות יותר
            </button>
          )}
        </div>
      )}
      {messages.map((message, idx) => (
        <AiMessageBubble
          key={message.id}
          message={message}
          thinkingStatus={isLoading && idx === messages.length - 1 ? thinkingStatus : null}
          errorText={!isLoading && idx === messages.length - 1 && lastError ? lastError : undefined}
          isStreaming={isLoading && idx === messages.length - 1}
          getChartData={getChartData}
          getDisplayText={getDisplayText}
          searchQuery={searchQuery}
          userAvatarUrl={userAvatarUrl}
        />
      ))}
      {isLoading && messages.length > 0 && messages[messages.length - 1].role === "user" && (
        <AiThinkingBubble status={thinkingStatus || "חושב..."} />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
