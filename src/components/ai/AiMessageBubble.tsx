"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Copy, Check, ThumbsUp, ThumbsDown, X, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UIMessage } from "ai";
import type { AiChartData, AiProposedAction } from "@/types/ai";
import { AiMarkdownRenderer } from "./AiMarkdownRenderer";
import { AiActionCard } from "./AiActionCard";
import { AiToolSteps, getToolSteps, MicroMatrix } from "./AiToolSteps";
import { AiDataTable, type AiDataSection } from "./AiDataTable";

const LazyBarChart = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.BarChart })),
  { ssr: false }
);
const LazyBar = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.Bar })),
  { ssr: false }
);
const LazyXAxis = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.XAxis })),
  { ssr: false }
);
const LazyYAxis = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.YAxis })),
  { ssr: false }
);
const LazyTooltip = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.Tooltip })),
  { ssr: false }
);
const LazyResponsiveContainer = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.ResponsiveContainer })),
  { ssr: false }
);
const LazyCartesianGrid = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.CartesianGrid })),
  { ssr: false }
);

function SafeChartContainer({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full h-[160px] sm:h-[200px]">
      {dimensions && children}
    </div>
  );
}

// AI bot icon
function AiIcon() {
  return (
    <div className="flex-shrink-0 w-[24px] h-[24px] sm:w-[28px] sm:h-[28px] rounded-full overflow-hidden">
      <Image
        src="https://db.amazpenbiz.co.il/storage/v1/object/public/attachments/ai/ai-avatar.png"
        alt="דדי"
        width={28}
        height={28}
        className="w-full h-full object-cover"
        unoptimized
        loading="eager"
      />
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }, [text]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 sm:p-1 rounded hover:bg-white/10"
      title="העתק"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-400" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-white/40 hover:text-white/70" />
      )}
    </Button>
  );
}

/** Strip markdown tables from text when dashboard auto-renders the data */
function stripMarkdownTables(text: string): string {
  // Remove markdown table blocks (lines starting with |)
  const lines = text.split("\n");
  const filtered: string[] = [];
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|")) {
      inTable = true;
      continue; // skip table lines
    }
    if (inTable && trimmed === "") {
      inTable = false;
      continue; // skip blank line after table
    }
    inTable = false;
    // Also skip redundant section headers that the auto-table already shows
    if (/^#{1,3}\s*(סקירת ביצועי|סיכום מצטבר|מוצר מנוהל|משפכי הכנסות|בונוסים)/.test(trimmed)) continue;
    // Skip bullet lists that repeat auto-table data
    if (/^[-•]\s*(דג סלומון|שוארמה|פחית|מוצרלה|במקום|במשלוח):\s/.test(trimmed)) continue;
    if (/^[-•]\s*(דג סלומון|שוארמה|פחית|מוצרלה|במקום|במשלוח)\s/.test(trimmed)) continue;
    filtered.push(line);
  }
  // Clean up multiple consecutive blank lines
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Transform getMonthlySummary tool output into AiDataTable sections — approved format */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDashboardFromToolOutput(message: UIMessage): { sections: AiDataSection[]; businessName?: string; period?: string } | null {
  if (message.role !== "assistant") return null;
  if (!message.parts || !Array.isArray(message.parts)) return null;

  for (const part of message.parts) {
    if (part.type === "tool-getMonthlySummary") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolPart = part as any;
      if (toolPart.state !== "output-available" || !toolPart.output) continue;
      const d = toolPart.output;
      if (!d.actuals) continue;

      const fmt = (n: number | null | undefined) => n != null ? `₪${Math.round(n).toLocaleString("he-IL")}` : null;
      const fmtPct = (n: number | null | undefined) => n != null ? `${(Math.round(n * 100) / 100).toFixed(2)}%` : null;
      const fmtDiff = (n: number | null | undefined) => {
        if (n == null) return null;
        const rounded = Math.round(n);
        return `${rounded >= 0 ? "+" : ""}₪${rounded.toLocaleString("he-IL")}`;
      };
      const fmtDiffPct = (n: number | null | undefined) => {
        if (n == null) return null;
        const v = Math.round(n * 100) / 100;
        return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
      };
      const expStatus = (val: number | null): "good" | "bad" | "neutral" => {
        if (val == null) return "neutral";
        return val <= 0 ? "good" : "bad";
      };
      const incBeforeVat = d.actuals?.incomeBeforeVat || 0;

      const sections: AiDataSection[] = [];

      // 1. Income — one row, each value in its column
      sections.push({
        title: "הכנסות", emoji: "💰",
        headers: ["", "יעד חודשי", "יעד עד היום", "בפועל", "צפי חודשי", "הפרש מיעד"],
        rows: [{
          label: "מכירות כולל מע\"מ",
          values: [fmt(d.targets?.revenueTarget), fmt(d.targets?.revenueTargetProportional), fmt(d.actuals?.totalIncome), fmt(d.actuals?.monthlyPace), fmtDiff(d.targets?.targetDiffAmount)],
          status: d.targets?.targetDiffPct != null ? (d.targets.targetDiffPct >= 0 ? "good" : "bad") : "neutral",
        }],
      });

      // 2. Income breakdown
      if (d.incomeBreakdown && d.incomeBreakdown.length > 0) {
        sections.push({
          title: "משפכי הכנסות", emoji: "📊",
          headers: ["מקור", "יעד ממוצע", "ממוצע בפועל", "הפרש", "סה\"כ"],
          rows: d.incomeBreakdown.map((src: { name: string; totalAmount: number; avgTicket: number; avgTicketTarget: number | null; avgTicketDiff: number | null }) => ({
            label: src.name,
            values: [
              src.avgTicketTarget != null ? `₪${Math.round(src.avgTicketTarget)}` : "—",
              `₪${Math.round(src.avgTicket)}`,
              src.avgTicketDiff != null ? `${src.avgTicketDiff >= 0 ? "+" : ""}₪${Math.round(src.avgTicketDiff)}` : "—",
              fmt(src.totalAmount),
            ],
            status: src.avgTicketDiff != null ? (src.avgTicketDiff >= 0 ? "good" : "bad") : ("neutral" as const),
          })),
        });
      }

      // 3. Expenses — all in one table
      const expRows: AiDataSection["rows"] = [];

      // Labor
      expRows.push({
        label: "עלות עובדים",
        values: [fmtPct(d.targets?.laborTargetPct), fmtPct(d.costs?.laborCostPct), fmtDiffPct(d.targets?.laborDiffPct), d.targets?.laborDiffPct != null ? fmtDiff(Math.round((d.targets.laborDiffPct / 100) * incBeforeVat)) : "—"],
        status: expStatus(d.targets?.laborDiffPct),
      });

      // Food cost
      expRows.push({
        label: "עלות מכר",
        values: [fmtPct(d.targets?.foodTargetPct), fmtPct(d.costs?.foodCostPct), fmtDiffPct(d.targets?.foodDiffPct), d.targets?.foodDiffPct != null ? fmtDiff(Math.round((d.targets.foodDiffPct / 100) * incBeforeVat)) : "—"],
        status: expStatus(d.targets?.foodDiffPct),
      });

      // Managed products
      if (d.managedProducts) {
        for (const mp of d.managedProducts) {
          expRows.push({
            label: mp.name,
            values: [fmtPct(mp.targetPct), fmtPct(mp.pct), fmtDiffPct(mp.diffPct), mp.diffPct != null ? fmtDiff(Math.round((mp.diffPct / 100) * incBeforeVat)) : "—"],
            status: expStatus(mp.diffPct),
          });
        }
      }

      // Current expenses
      expRows.push({
        label: "הוצאות שוטפות",
        values: [fmtPct(d.costs?.currentExpensesTargetPct || null), fmtPct(d.costs?.currentExpensesPct), fmtDiffPct(d.costs?.currentExpensesDiffPct), d.costs?.currentExpensesDiffPct != null ? fmtDiff(Math.round((d.costs.currentExpensesDiffPct / 100) * incBeforeVat)) : "—"],
        status: expStatus(d.costs?.currentExpensesDiffPct),
      });

      sections.push({
        title: "הוצאות", emoji: "💼",
        headers: ["", "יעד", "בפועל", "הפרש", "הפרש ₪"],
        rows: expRows,
      });

      // 4. Profitability
      if (d.profit) {
        const profitStatus = d.profit.target != null && d.profit.actual != null ? (d.profit.actual >= d.profit.target ? "good" : "bad") : "neutral";
        sections.push({
          title: "רווחיות", emoji: "📈",
          headers: ["", "יעד", "בפועל", "הפרש"],
          rows: [{
            label: "רווח תפעולי",
            values: [
              d.profit.target != null ? `${fmt(d.profit.target)} (${fmtPct(d.profit.targetPct)})` : "—",
              `${fmt(d.profit.actual)} (${fmtPct(d.profit.actualPct)})`,
              d.profit.target != null ? fmtDiff(d.profit.actual - d.profit.target) : "—",
            ],
            status: profitStatus as "good" | "bad" | "neutral",
          }],
        });
      }

      // Build period string
      const periodStr = (() => {
        if (!d.period) return undefined;
        if (typeof d.period === "string") return d.period;
        const p = d.period as { year?: number; month?: number };
        const heMonths = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
        return `${heMonths[(p.month || 1) - 1] || ""} ${p.year || ""}`;
      })();

      return {
        sections,
        businessName: typeof d.businessName === "string" ? d.businessName : undefined,
        period: periodStr,
      };
    }
  }
  return null;
}

/** Extract proposeAction tool result from message parts */
function getProposedAction(message: UIMessage): AiProposedAction | null {
  if (message.role !== "assistant") return null;
  if (!message.parts || !Array.isArray(message.parts)) return null;

  for (const part of message.parts) {
    // AI SDK v6: tool parts have type "tool-{toolName}" (e.g. "tool-proposeAction")
    if (part.type === "tool-proposeAction") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolPart = part as any;
      if (
        toolPart.state === "output-available" &&
        toolPart.output
      ) {
        const result = toolPart.output as Record<string, unknown>;
        if (result.success === true && result.actionType) {
          return result as unknown as AiProposedAction;
        }
      }
    }
  }
  return null;
}

/** Highlight matching text in content */
function HighlightText({ text, query }: { text: string; query?: string }) {
  if (!query) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
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

// User avatar — shows profile photo or system logo as fallback
function UserIcon({ avatarUrl }: { avatarUrl?: string | null }) {
  const src = avatarUrl && avatarUrl.trim() ? avatarUrl : "/icon-192.png";
  return (
    <div className="flex-shrink-0 w-[24px] h-[24px] sm:w-[28px] sm:h-[28px] rounded-full overflow-hidden bg-[#29318A]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="משתמש"
        width={28}
        height={28}
        className="w-full h-full object-cover"
        loading="eager"
      />
    </div>
  );
}

// Training feedback buttons + correction modal (admin only)
function TrainingFeedback({
  userMessage,
  assistantMessage,
  businessId,
  sessionId,
}: {
  userMessage: string;
  assistantMessage: string;
  businessId?: string;
  sessionId?: string | null;
}) {
  const [status, setStatus] = useState<"idle" | "liked" | "disliked" | "correcting" | "saving" | "saved">("idle");
  const [correctionText, setCorrectionText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (status === "correcting" && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [status]);

  const submitFeedback = useCallback(async (feedbackType: "positive" | "negative", correction?: string) => {
    setStatus("saving");
    try {
      const res = await fetch("/api/ai/training-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId || null,
          businessId: businessId || null,
          userMessage,
          assistantMessage,
          feedbackType,
          correctionText: correction || null,
        }),
      });
      if (res.ok) {
        setStatus(feedbackType === "positive" ? "liked" : "disliked");
      } else {
        setStatus("idle");
      }
    } catch {
      setStatus("idle");
    }
  }, [userMessage, assistantMessage, businessId, sessionId]);

  const handleLike = useCallback(() => {
    submitFeedback("positive");
  }, [submitFeedback]);

  const handleDislike = useCallback(() => {
    setStatus("correcting");
  }, []);

  const handleSubmitCorrection = useCallback(() => {
    if (!correctionText.trim()) return;
    submitFeedback("negative", correctionText);
  }, [correctionText, submitFeedback]);

  const handleCancelCorrection = useCallback(() => {
    setStatus("idle");
    setCorrectionText("");
  }, []);

  if (status === "liked" || status === "disliked") {
    return (
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-[11px] text-white/40">
          {status === "liked" ? "תודה על הפידבק!" : "התיקון נשמר, תודה!"}
        </span>
        {status === "liked" ? (
          <ThumbsUp className="w-3 h-3 text-green-400" />
        ) : (
          <ThumbsDown className="w-3 h-3 text-orange-400" />
        )}
      </div>
    );
  }

  if (status === "saving") {
    return (
      <div className="flex items-center gap-1.5 mt-1">
        <div className="w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        <span className="text-[11px] text-white/40">שומר...</span>
      </div>
    );
  }

  if (status === "correcting") {
    return (
      <>
        {/* Full-screen overlay modal */}
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
          <div className="w-full max-w-[600px] bg-[#1A1F4E] rounded-[16px] border border-white/15 shadow-2xl shadow-black/50 flex flex-col max-h-[80vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <ThumbsDown className="w-4 h-4 text-orange-400" />
                <span className="text-[15px] text-white font-medium">תיקון תשובת הסוכן</span>
              </div>
              <button
                type="button"
                onClick={handleCancelCorrection}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4 text-white/50" />
              </button>
            </div>

            {/* Original messages preview */}
            <div className="px-5 py-3 border-b border-white/5 bg-white/[0.02] max-h-[200px] overflow-y-auto">
              <p className="text-[11px] text-white/40 mb-2">השאלה המקורית:</p>
              <p className="text-[13px] text-white/70 mb-3 bg-[#6366f1]/20 rounded-[10px] px-3 py-2 leading-relaxed">{userMessage.length > 300 ? userMessage.slice(0, 300) + "..." : userMessage}</p>
              <p className="text-[11px] text-white/40 mb-2">תשובת דדי:</p>
              <p className="text-[13px] text-white/50 bg-[#29318A]/30 rounded-[10px] px-3 py-2 leading-relaxed">{assistantMessage.length > 400 ? assistantMessage.slice(0, 400) + "..." : assistantMessage}</p>
            </div>

            {/* Correction input */}
            <div className="flex-1 px-5 py-4">
              <label className="text-[13px] text-white/70 font-medium mb-2 block">
                מה הייתה צריכה להיות התשובה הנכונה?
              </label>
              <textarea
                ref={textareaRef}
                value={correctionText}
                onChange={(e) => setCorrectionText(e.target.value)}
                placeholder="כתוב כאן את התשובה הנכונה, או תאר מה היה לא בסדר ומה צריך לשנות..."
                className="w-full bg-white/5 text-white text-[14px] leading-relaxed placeholder:text-white/30 rounded-[12px] p-4 outline-none border border-white/10 focus:border-indigo-400/50 resize-none min-h-[150px] max-h-[300px]"
                dir="rtl"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-white/10">
              <button
                type="button"
                onClick={handleCancelCorrection}
                className="text-[13px] text-white/50 hover:text-white/70 transition-colors px-4 py-2 rounded-[10px] hover:bg-white/5"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={handleSubmitCorrection}
                disabled={!correctionText.trim()}
                className="flex items-center gap-2 text-[13px] text-white font-medium bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-5 py-2.5 rounded-[10px]"
              >
                <Send className="w-3.5 h-3.5" />
                שמור תיקון
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Idle state — show like/dislike buttons
  return (
    <div className="flex items-center gap-1 mt-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleLike}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/10"
        title="תשובה טובה"
      >
        <ThumbsUp className="w-3.5 h-3.5 text-white/40 hover:text-green-400" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleDislike}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/10"
        title="תשובה לא טובה"
      >
        <ThumbsDown className="w-3.5 h-3.5 text-white/40 hover:text-orange-400" />
      </Button>
    </div>
  );
}

interface AiMessageBubbleProps {
  message: UIMessage;
  thinkingStatus?: string | null;
  errorText?: string;
  isStreaming?: boolean;
  getChartData: (message: UIMessage) => AiChartData | undefined;
  getDisplayText: (message: UIMessage) => string;
  searchQuery?: string;
  userAvatarUrl?: string | null;
  isAdmin?: boolean;
  businessId?: string;
  sessionId?: string | null;
  prevUserMessageText?: string;
}

export function AiMessageBubble({ message, thinkingStatus, errorText, isStreaming, getChartData, getDisplayText, searchQuery, userAvatarUrl, isAdmin, businessId, sessionId, prevUserMessageText }: AiMessageBubbleProps) {
  const isUser = message.role === "user";
  const displayText = getDisplayText(message);
  const chartData = isUser ? undefined : getChartData(message);
  const proposedAction = isUser ? null : getProposedAction(message);
  const toolSteps = isUser ? [] : getToolSteps(message);
  let dashboardData: ReturnType<typeof buildDashboardFromToolOutput> = null;
  if (!isUser) {
    try { dashboardData = buildDashboardFromToolOutput(message); } catch { /* prevent crash */ }
  }

  if (isUser) {
    return (
      <div className="group flex flex-col items-end gap-1" dir="rtl">
        <div className="flex items-start gap-1.5 sm:gap-2 flex-row-reverse w-full justify-start">
          <UserIcon avatarUrl={userAvatarUrl} />
          <div className="max-w-[88%] sm:max-w-[80%] lg:max-w-[70%] bg-[#6366f1] text-white text-[13px] sm:text-[14px] leading-relaxed px-3 sm:px-4 py-2 sm:py-2.5 rounded-[16px] rounded-tr-[4px] break-words">
            <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              <HighlightText text={displayText} query={searchQuery} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 px-1 mr-[30px] sm:mr-[36px]">
          <CopyButton text={displayText} />
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col items-start gap-1" dir="rtl">
      <div className="flex items-start gap-1.5 sm:gap-2 w-full">
        <AiIcon />
        <div className="flex-1 min-w-0">
          <div className="bg-[#29318A] text-white px-3 sm:px-4 py-2.5 sm:py-3 rounded-[16px] rounded-tr-[4px] overflow-hidden">
            {toolSteps.length > 0 && (
              <AiToolSteps steps={toolSteps} isStreaming={isStreaming} />
            )}
            {toolSteps.length > 0 && (displayText || dashboardData) && (
              <div className="h-px bg-white/[0.06] -mx-3 sm:-mx-4 mb-2.5" />
            )}
            {/* Dashboard data from getMonthlySummary tool — rendered as structured tables */}
            {dashboardData && (
              <div className="mb-2.5">
                <AiDataTable
                  sections={dashboardData.sections}
                  businessName={dashboardData.businessName}
                  period={dashboardData.period}
                />
              </div>
            )}
            {dashboardData && displayText && (
              <div className="h-px bg-white/[0.06] -mx-3 sm:-mx-4 mb-2.5" />
            )}
            {!displayText && thinkingStatus && toolSteps.length === 0 && !dashboardData ? (
              <div className="flex gap-2.5 items-center h-[20px]">
                <MicroMatrix size={16} variant="thinking" />
                <span className="text-white/60 text-[13px]">{thinkingStatus}</span>
              </div>
            ) : displayText ? (
              <AiMarkdownRenderer content={dashboardData ? stripMarkdownTables(displayText) : displayText} searchQuery={searchQuery} />
            ) : !isStreaming && !proposedAction && !chartData ? (
              <span className="text-white/50 text-[13px]">{errorText ? `שגיאה: ${errorText}` : "לא הצלחתי לייצר תשובה. נסה לשאול שוב."}</span>
            ) : null}
            {chartData && (
              <div className="mt-3 bg-[#0F1535] rounded-[12px] p-2 sm:p-3 overflow-x-auto">
                <p className="text-white/70 text-[11px] sm:text-[12px] font-medium mb-2" dir="rtl">
                  {chartData.title}
                </p>
                <SafeChartContainer>
                  <LazyResponsiveContainer width="100%" height="100%">
                    <LazyBarChart data={chartData.data} barGap={4}>
                      <LazyCartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <LazyXAxis
                        dataKey={chartData.xAxisKey}
                        tick={{ fill: "#7B91B0", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <LazyYAxis
                        tick={{ fill: "#7B91B0", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={45}
                      />
                      <LazyTooltip
                        contentStyle={{
                          backgroundColor: "#1a1f4e",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "8px",
                          color: "white",
                          fontSize: "12px",
                        }}
                        labelStyle={{ color: "#7B91B0" }}
                      />
                      {chartData.dataKeys.map((dk) => (
                        <LazyBar
                          key={dk.key}
                          dataKey={dk.key}
                          name={dk.label}
                          fill={dk.color}
                          radius={[4, 4, 0, 0]}
                        />
                      ))}
                    </LazyBarChart>
                  </LazyResponsiveContainer>
                </SafeChartContainer>
                {/* Chart legend */}
                <div className="flex flex-row-reverse justify-center flex-wrap gap-2 sm:gap-3 mt-2">
                  {chartData.dataKeys.map((dk) => (
                    <div key={dk.key} className="flex flex-row-reverse items-center gap-1 sm:gap-1.5">
                      <span className="text-white/50 text-[10px] sm:text-[11px]">{dk.label}</span>
                      <div
                        className="w-[8px] h-[8px] sm:w-[10px] sm:h-[10px] rounded-[2px]"
                        style={{ backgroundColor: dk.color }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {proposedAction && (
              <AiActionCard action={proposedAction} />
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center px-1 mr-[30px] sm:mr-[36px]">
        <CopyButton text={displayText} />
        {isAdmin && !isStreaming && displayText && prevUserMessageText && (
          <TrainingFeedback
            userMessage={prevUserMessageText}
            assistantMessage={displayText}
            businessId={businessId}
            sessionId={sessionId}
          />
        )}
      </div>
    </div>
  );
}

/** Standalone thinking bubble shown before assistant message arrives */
export function AiThinkingBubble({ status }: { status: string }) {
  return (
    <div className="flex flex-col items-start gap-1" dir="rtl">
      <div className="flex items-start gap-1.5 sm:gap-2 w-full">
        <AiIcon />
        <div className="flex-1 min-w-0">
          <div className="bg-[#29318A] text-white px-3 sm:px-4 py-2.5 sm:py-3 rounded-[16px] rounded-tr-[4px]">
            <div className="flex gap-2.5 items-center h-[20px]">
              <MicroMatrix size={16} variant="thinking" />
              <span className="text-white/60 text-[13px]">{status}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
