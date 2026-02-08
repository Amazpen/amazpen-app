"use client";

import { useState, useCallback, useRef } from "react";
import type { AiMessage } from "@/types/ai";

export function useAiChat(businessId: string | undefined, isAdmin = false) {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<AiMessage[]>([]);
  messagesRef.current = messages;

  const sendMessage = useCallback(
    async (content: string) => {
      if ((!isAdmin && !businessId) || !content.trim()) return;

      const userMessage: AiMessage = {
        id: `user-${crypto.randomUUID()}`,
        role: "user",
        content,
        timestamp: new Date(),
      };

      const assistantId = `assistant-${crypto.randomUUID()}`;

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
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
            businessId: businessId || "",
            history: recentHistory,
          }),
          signal: abortRef.current.signal,
        });

        // Non-SSE error responses (4xx/5xx) still return JSON
        if (!response.ok) {
          let errorMsg = "שגיאה בתקשורת עם השרת";
          try {
            const errData = await response.json();
            errorMsg = errData.error || errorMsg;
          } catch {
            // couldn't parse JSON, use default
          }
          throw new Error(errorMsg);
        }

        const body = response.body;
        if (!body) throw new Error("אין תגובה מהשרת");

        // Add empty assistant message that we'll update progressively
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: "",
            timestamp: new Date(),
          },
        ]);

        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buffer.split("\n");
          // Keep the last incomplete line in buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            const jsonStr = trimmed.slice(6); // remove "data: "
            let event: { type: string; content?: string; chartData?: unknown; error?: string };
            try {
              event = JSON.parse(jsonStr);
            } catch {
              continue;
            }

            if (event.type === "text" && event.content) {
              // Append text chunk to the assistant message
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + event.content }
                    : m
                )
              );
            } else if (event.type === "chart" && event.chartData) {
              // Attach chart data to the assistant message
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, chartData: event.chartData as AiMessage["chartData"] }
                    : m
                )
              );
            } else if (event.type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: `**שגיאה:** ${event.error || "שגיאה לא צפויה"}` }
                    : m
                )
              );
            }
            // "done" event — nothing to do, stream ends naturally
          }
        }
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
    [businessId, isAdmin]
  );

  const clearChat = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setIsLoading(false);
  }, []);

  return { messages, isLoading, sendMessage, clearChat };
}
