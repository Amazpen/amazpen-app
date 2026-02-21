"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Trash2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAiChat } from "./useAiChat";
import { AiWelcomeScreen } from "./AiWelcomeScreen";
import { AiMessageList } from "./AiMessageList";
import { AiChatInput } from "./AiChatInput";

interface HistoryResult {
  id: string;
  sessionId: string;
  sessionTitle: string | null;
  sessionDate: string | null;
  role: string;
  snippet: string;
  timestamp: string;
}

interface AiChatContainerProps {
  isAdmin: boolean;
  businessId: string | undefined;
}

export function AiChatContainer({ isAdmin, businessId }: AiChatContainerProps) {
  const { messages, isLoading, thinkingStatus, isLoadingHistory, lastError, sendMessage, clearChat, getChartData, getDisplayText } = useAiChat(businessId, isAdmin);
  const hasMessages = messages.length > 0;

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [historyResults, setHistoryResults] = useState<HistoryResult[]>([]);
  const [isSearchingHistory, setIsSearchingHistory] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Search history API when debounced query changes
  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setHistoryResults([]);
      return;
    }

    let cancelled = false;
    async function searchHistory() {
      setIsSearchingHistory(true);
      try {
        const res = await fetch("/api/ai/sessions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: debouncedQuery }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setHistoryResults(data.results || []);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setIsSearchingHistory(false);
      }
    }
    searchHistory();
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  // Filter current messages client-side
  const filteredMessages = useMemo(() => {
    if (debouncedQuery.length < 2) return messages;
    const q = debouncedQuery.toLowerCase();
    return messages.filter((m) => getDisplayText(m).toLowerCase().includes(q));
  }, [messages, debouncedQuery, getDisplayText]);

  const handleSuggestionClick = useCallback(
    (text: string) => {
      sendMessage(text);
    },
    [sendMessage]
  );

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
    setDebouncedQuery("");
    setHistoryResults([]);
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] h-[calc(100dvh-60px)] bg-[#0F1535]">
      {/* Chat header bar */}
      {hasMessages && (
        <div className="flex-shrink-0 sticky top-0 z-10 bg-[#0F1535] flex items-center justify-between px-3 sm:px-4 py-1.5 sm:py-2 border-b border-white/10" dir="rtl">
          <Button
            type="button"
            variant="ghost"
            onClick={clearChat}
            className="flex items-center gap-1.5 text-white hover:text-white/70 text-[12px] transition-colors flex-shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            נקה שיחה
          </Button>

          {/* Search area */}
          <div className="flex items-center gap-2">
            {isSearchOpen ? (
              <div className="flex items-center gap-1.5 bg-white/10 rounded-full px-2.5 py-1 animate-in slide-in-from-left-2 duration-200">
                <Search className="w-3.5 h-3.5 text-white/50 flex-shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="חפש בשיחות..."
                  className="bg-transparent text-white text-[12px] placeholder:text-white/30 outline-none w-[120px] sm:w-[180px]"
                  dir="rtl"
                />
                {debouncedQuery.length >= 2 && (
                  <span className="text-white/40 text-[10px] flex-shrink-0">
                    {filteredMessages.length}
                  </span>
                )}
                <button
                  type="button"
                  onClick={closeSearch}
                  className="p-0.5 rounded-full hover:bg-white/10 transition-colors"
                >
                  <X className="w-3 h-3 text-white/50" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={openSearch}
                className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
                title="חפש בשיחות"
              >
                <Search className="w-3.5 h-3.5 text-white/50" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* History search results dropdown */}
      {isSearchOpen && debouncedQuery.length >= 2 && historyResults.length > 0 && (
        <div className="flex-shrink-0 bg-[#0F1535] border-b border-white/10 max-h-[200px] overflow-y-auto px-3 sm:px-4 py-2 space-y-1.5" dir="rtl">
          <p className="text-white/40 text-[10px] font-medium mb-1">תוצאות מהיסטוריה</p>
          {historyResults.map((r) => (
            <div
              key={r.id}
              className="bg-white/5 rounded-lg px-2.5 py-1.5 hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-white/30 text-[10px]">
                  {r.role === "user" ? "אתה" : "דדי"}
                </span>
                <span className="text-white/20 text-[9px]">
                  {r.sessionDate ? new Date(r.sessionDate).toLocaleDateString("he-IL") : ""}
                </span>
              </div>
              <p className="text-white/70 text-[11px] leading-relaxed [overflow-wrap:anywhere]">
                <HighlightSnippet text={r.snippet} query={debouncedQuery} />
              </p>
            </div>
          ))}
        </div>
      )}

      {/* No results message */}
      {isSearchOpen && debouncedQuery.length >= 2 && !isSearchingHistory && filteredMessages.length === 0 && historyResults.length === 0 && (
        <div className="flex-shrink-0 bg-[#0F1535] border-b border-white/10 px-3 sm:px-4 py-3 text-center" dir="rtl">
          <span className="text-white/40 text-[12px]">לא נמצאו תוצאות עבור &quot;{debouncedQuery}&quot;</span>
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
          messages={filteredMessages}
          isLoading={isLoading}
          thinkingStatus={thinkingStatus}
          lastError={lastError}
          getChartData={getChartData}
          getDisplayText={getDisplayText}
          searchQuery={debouncedQuery.length >= 2 ? debouncedQuery : undefined}
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

/** Highlight matching text in a snippet */
function HighlightSnippet({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-500/30 text-white rounded-sm px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
