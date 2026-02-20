"use client";

import { useState, useRef, useEffect } from "react";
import type { UIMessage } from "ai";

/** Tool display configuration with Hebrew labels and descriptions */
const toolDisplayMap: Record<string, { label: string; emoji: string; getDetail?: (input: Record<string, unknown>) => string }> = {
  getMonthlySummary: {
    label: "שליפת סיכום חודשי",
    emoji: "📊",
    getDetail: (input) => {
      const month = input.month as number;
      const year = input.year as number;
      const months = ["", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
      return month && year ? `${months[month] || month}/${year}` : "";
    },
  },
  queryDatabase: {
    label: "שאילתה מבסיס הנתונים",
    emoji: "🔍",
    getDetail: (input) => (input.explanation as string) || "",
  },
  getBusinessSchedule: {
    label: "בדיקת לוח עבודה",
    emoji: "📅",
  },
  getGoals: {
    label: "בדיקת יעדים עסקיים",
    emoji: "🎯",
    getDetail: (input) => {
      const month = input.month as number;
      const year = input.year as number;
      const months = ["", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
      return month && year ? `${months[month] || month}/${year}` : "";
    },
  },
  calculate: {
    label: "חישוב מתמטי",
    emoji: "🧮",
    getDetail: (input) => (input.expression as string) || "",
  },
  proposeAction: {
    label: "הכנת הצעה",
    emoji: "💡",
  },
};

export interface ToolStep {
  toolName: string;
  label: string;
  emoji: string;
  detail: string;
  state: string;
  resultSummary: string;
}

/** Summarize tool output for display */
function summarizeOutput(toolName: string, output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const out = output as Record<string, unknown>;

  if (out.error) return `שגיאה: ${out.error}`;

  switch (toolName) {
    case "getMonthlySummary": {
      const income = out.total_income ?? (out.actuals && (out.actuals as Record<string, unknown>).totalIncome);
      if (income !== undefined && income !== null) {
        return `הכנסות: ₪${Number(income).toLocaleString("he-IL")}`;
      }
      if (out.businessName) return `עסק: ${out.businessName}`;
      return "נתונים התקבלו";
    }
    case "queryDatabase": {
      const rows = out.rows as unknown[] | undefined;
      const total = out.totalRows as number | undefined;
      if (rows) return `${total ?? rows.length} ${(total ?? rows.length) === 1 ? "תוצאה" : "תוצאות"}`;
      return "נתונים התקבלו";
    }
    case "getBusinessSchedule":
      return "לוח עבודה התקבל";
    case "getGoals":
      return "יעדים התקבלו";
    case "calculate": {
      const result = out.result;
      if (result !== undefined) return `תוצאה: ${result}`;
      return "חושב";
    }
    default:
      return "בוצע";
  }
}

/** Get a more specific summary text based on tool types used */
function getSmartSummary(steps: ToolStep[]): string {
  if (steps.length === 1) {
    const step = steps[0];
    switch (step.toolName) {
      case "getMonthlySummary": return "בדקתי סיכום חודשי";
      case "queryDatabase": return "שלפתי נתונים מהמערכת";
      case "getBusinessSchedule": return "בדקתי לוח עבודה";
      case "getGoals": return "בדקתי יעדים";
      case "calculate": return "חישבתי נתון";
      default: return "בדקתי נתון אחד";
    }
  }
  const hasQuery = steps.some((s) => s.toolName === "queryDatabase");
  const hasSummary = steps.some((s) => s.toolName === "getMonthlySummary");
  if (hasSummary && hasQuery) return `אספתי וניתחתי ${steps.length} מקורות נתונים`;
  if (hasQuery && steps.length > 1) return `הרצתי ${steps.length} שאילתות`;
  return `ביצעתי ${steps.length} פעולות כדי לענות`;
}

/** Extract tool steps from a message's parts */
export function getToolSteps(message: UIMessage): ToolStep[] {
  if (message.role !== "assistant") return [];

  const steps: ToolStep[] = [];
  const seen = new Set<string>();

  for (const part of message.parts) {
    if (part.type.startsWith("tool-") && part.type !== "tool-proposeAction") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolPart = part as any;
      const toolName = toolPart.toolName || part.type.replace("tool-", "");

      // Create a unique key per invocation (tool + input hash)
      const inputStr = JSON.stringify(toolPart.input || {});
      const key = `${toolName}:${inputStr}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const display = toolDisplayMap[toolName] || { label: toolName, emoji: "⚙️" };
      const input = (toolPart.input || {}) as Record<string, unknown>;
      const detail = display.getDetail ? display.getDetail(input) : "";

      const isDone = toolPart.state === "output-available";
      const resultSummary = isDone ? summarizeOutput(toolName, toolPart.output) : "";

      steps.push({
        toolName,
        label: display.label,
        emoji: display.emoji,
        detail,
        state: toolPart.state || "output-available",
        resultSummary,
      });
    }
  }

  return steps;
}

interface AiToolStepsProps {
  steps: ToolStep[];
  isStreaming?: boolean;
}

export function AiToolSteps({ steps, isStreaming }: AiToolStepsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [steps, isExpanded]);

  if (steps.length === 0) return null;

  const allDone = steps.every((s) => s.state === "output-available") && !isStreaming;
  const activeStep = steps.find((s) => s.state !== "output-available");

  return (
    <div className="mb-3 bg-white/[0.04] rounded-[10px] border border-white/[0.06]">
      {/* Clickable header */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex items-center gap-2.5 w-full text-right px-3 py-2 transition-colors cursor-pointer select-none hover:bg-white/[0.03] rounded-[10px]"
      >
        {/* Status icon */}
        {allDone ? (
          <div className="w-6 h-6 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        ) : (
          <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
            <div className="w-[18px] h-[18px] border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
          </div>
        )}

        {/* Summary text */}
        <div className="flex-1 min-w-0">
          {allDone ? (
            <span className="text-white/55 text-[12px] font-medium">
              {getSmartSummary(steps)}
            </span>
          ) : activeStep ? (
            <span className="text-white/65 text-[12px] font-medium">
              {activeStep.emoji} {activeStep.label}
              {activeStep.detail && <span className="text-white/35 mr-1.5">— {activeStep.detail}</span>}
            </span>
          ) : (
            <span className="text-white/60 text-[12px] font-medium">מעבד...</span>
          )}
        </div>

        {/* Chevron */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-white/25 flex-shrink-0 transition-transform duration-300 ease-out ${isExpanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Animated expandable area */}
      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-out"
        style={{ maxHeight: isExpanded ? `${contentHeight + 16}px` : "0px" }}
      >
        <div ref={contentRef}>
          {/* Separator */}
          <div className="mx-3 h-px bg-white/[0.06]" />

          <div className="px-3 py-2 mr-0.5 relative">
            {/* Vertical timeline line */}
            <div className="absolute right-3 top-3 bottom-3 w-px bg-white/[0.08]" />

            <div className="space-y-1">
              {steps.map((step, idx) => {
                const isDone = step.state === "output-available";
                const isActive = step.state === "input-streaming" || step.state === "input-available";

                return (
                  <div key={`${step.toolName}-${idx}`} className="relative pr-6">
                    {/* Timeline dot - larger */}
                    <div className={`absolute right-[3px] top-2.5 w-[9px] h-[9px] rounded-full border-2 ${
                      isDone
                        ? "bg-emerald-400 border-emerald-400"
                        : isActive
                          ? "bg-indigo-400 border-indigo-400 animate-pulse"
                          : "bg-white/20 border-white/30"
                    }`} />

                    <div className={`py-1.5 px-2.5 rounded-lg ${isActive ? "bg-white/[0.04]" : ""}`}>
                      {/* Tool name + emoji */}
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] leading-none">{step.emoji}</span>
                        <span className={`text-[12px] font-medium ${isDone ? "text-white/70" : isActive ? "text-white/80" : "text-white/50"}`}>
                          {step.label}
                        </span>
                        {isDone && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 flex-shrink-0">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                        {isActive && (
                          <div className="w-3.5 h-3.5 flex-shrink-0">
                            <div className="w-3.5 h-3.5 border-[1.5px] border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
                          </div>
                        )}
                      </div>

                      {/* Detail line - with line-clamp instead of truncate */}
                      {step.detail && (
                        <p className="text-white/35 text-[11px] mt-0.5 mr-[30px] leading-snug line-clamp-2">
                          {step.detail}
                        </p>
                      )}

                      {/* Result summary */}
                      {isDone && step.resultSummary && (
                        <p className="text-emerald-400/50 text-[11px] mt-0.5 mr-[30px] leading-snug">
                          ← {step.resultSummary}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
