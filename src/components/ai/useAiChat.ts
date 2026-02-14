"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import type { AiChartData } from "@/types/ai";

/** Extract chart-json block from message text parts */
function getChartData(message: UIMessage): AiChartData | undefined {
  const text = getFullText(message);
  const match = text.match(/```chart-json\n([\s\S]*?)\n```/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]) as AiChartData;
  } catch {
    return undefined;
  }
}

/** Get display text (without chart-json block) from message */
function getDisplayText(message: UIMessage): string {
  const text = getFullText(message);
  return text.replace(/```chart-json\n[\s\S]*?\n```/g, "").trim();
}

/** Extract full text content from a UIMessage's parts */
function getFullText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Derive thinking status from tool invocations in the last message */
function getThinkingStatus(messages: UIMessage[], status: string): string | null {
  if (status === "ready") return null;

  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== "assistant") {
    return status === "submitted" ? "חושב..." : null;
  }

  // Check for active tool calls in parts
  const statusMap: Record<string, string> = {
    queryDatabase: "שולף נתונים מהמערכת...",
    getBusinessSchedule: "בודק לוח עבודה...",
    getGoals: "בודק יעדים...",
    calculate: "מחשב...",
    proposeAction: "מכין הצעה...",
  };

  for (const part of lastMsg.parts) {
    if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
      const toolPart = part as { type: string; toolName?: string; state?: string };
      if (toolPart.state === "input-streaming" || toolPart.state === "input-available") {
        const toolName = toolPart.toolName || part.type.replace("tool-", "");
        return statusMap[toolName] || "מעבד...";
      }
    }
  }

  // If no text yet (submitted or streaming), show thinking
  const hasText = lastMsg.parts.some((p) => p.type === "text" && (p as { text: string }).text.length > 0);
  if (!hasText) return "חושב...";

  return null;
}

export function useAiChat(businessId: string | undefined, isAdmin = false) {
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const sessionIdRef = useRef<string | null>(null);
  const pageContextRef = useRef<string>("");

  // Read page context on mount
  useEffect(() => {
    pageContextRef.current = localStorage.getItem("ai_page_context") || "";
  }, []);

  const {
    messages,
    sendMessage,
    status,
    setMessages,
    stop,
  } = useChat({
    id: "ai-chat",
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      body: () => ({
        businessId: businessId || "",
        sessionId: sessionIdRef.current || "",
        pageContext: pageContextRef.current || "",
      }),
    }),
    onError: (error) => {
      console.error("[AI Chat] Error:", error);
    },
  });

  // Load previous session history on mount
  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const res = await fetch("/api/ai/sessions");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        if (data.session && data.messages?.length > 0) {
          sessionIdRef.current = data.session.id;
          const uiMessages: UIMessage[] = data.messages.map(
            (m: { id: string; role: string; content: string; chartData?: unknown; timestamp: string }) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              parts: [
                { type: "text" as const, text: m.content },
              ],
            })
          );
          setMessages(uiMessages);
        }
      } catch {
        // Failed to load history, start fresh
      } finally {
        if (!cancelled) setIsLoadingHistory(false);
      }
    }
    loadHistory();
    return () => { cancelled = true; };
  }, [setMessages]);

  // Create a new session if we don't have one
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    try {
      const res = await fetch("/api/ai/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: businessId || null }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      sessionIdRef.current = data.sessionId;
      return data.sessionId;
    } catch {
      return null;
    }
  }, [businessId]);

  // Wrapped send that ensures session exists first
  const handleSend = useCallback(
    async (content: string) => {
      if ((!isAdmin && !businessId) || !content.trim()) return;
      await ensureSession();
      sendMessage({ text: content });
    },
    [businessId, isAdmin, ensureSession, sendMessage]
  );

  const clearChat = useCallback(async () => {
    stop();
    setMessages([]);

    // Delete session from DB
    if (sessionIdRef.current) {
      sessionIdRef.current = null;
      try {
        await fetch("/api/ai/sessions", { method: "DELETE" });
      } catch {
        // ignore
      }
    }
  }, [stop, setMessages]);

  const isLoading = status === "submitted" || status === "streaming";
  const thinkingStatus = useMemo(() => getThinkingStatus(messages, status), [messages, status]);

  return {
    messages,
    isLoading,
    thinkingStatus,
    isLoadingHistory,
    sendMessage: handleSend,
    clearChat,
    getChartData,
    getDisplayText,
  };
}
