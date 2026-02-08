"use client";

import { useState, useCallback, useRef } from "react";
import type { AiMessage } from "@/types/ai";

export function useAiChat(businessId: string | undefined) {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<AiMessage[]>([]);
  messagesRef.current = messages;

  const sendMessage = useCallback(
    async (content: string) => {
      if (!businessId || !content.trim()) return;

      const userMessage: AiMessage = {
        id: `user-${crypto.randomUUID()}`,
        role: "user",
        content,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        // Build recent history for context (last 10 messages)
        const recentHistory = [...messagesRef.current, userMessage]
          .slice(-10)
          .map((m) => ({
            role: m.role,
            content: m.content,
          }));

        abortRef.current = new AbortController();

        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: content,
            businessId,
            history: recentHistory,
          }),
          signal: abortRef.current.signal,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "שגיאה בתקשורת עם השרת");
        }

        const assistantMessage: AiMessage = {
          id: `assistant-${crypto.randomUUID()}`,
          role: "assistant",
          content: data.content,
          timestamp: new Date(),
          chartData: data.chartData,
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") return;

        const errorMessage: AiMessage = {
          id: `error-${crypto.randomUUID()}`,
          role: "assistant",
          content: `**שגיאה:** ${error instanceof Error ? error.message : "שגיאה לא צפויה. נסה שוב."}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [businessId]
  );

  const clearChat = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setIsLoading(false);
  }, []);

  return { messages, isLoading, sendMessage, clearChat };
}
