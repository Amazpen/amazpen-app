"use client";

import { useState } from "react";
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

  if (steps.length === 0) return null;

  const allDone = steps.every((s) => s.state === "output-available") && !isStreaming;
  const activeStep = steps.find((s) => s.state !== "output-available");

  return (
    <div className="mb-2.5">
      {/* Clickable header */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex items-center gap-2 w-full text-right hover:bg-white/[0.03] rounded-lg px-1 py-1 -mx-1 transition-colors cursor-pointer select-none"
      >
        {/* Status icon */}
        {allDone ? (
          <div className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        ) : (
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            <div className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
          </div>
        )}

        {/* Summary text */}
        <div className="flex-1 min-w-0">
          {allDone ? (
            <span className="text-white/50 text-[12px]">
              ביצעתי {steps.length} {steps.length === 1 ? "פעולה" : "פעולות"} כדי לענות
            </span>
          ) : activeStep ? (
            <span className="text-white/60 text-[12px]">
              {activeStep.emoji} {activeStep.label}
              {activeStep.detail && <span className="text-white/35 mr-1">— {activeStep.detail}</span>}
            </span>
          ) : (
            <span className="text-white/60 text-[12px]">מעבד...</span>
          )}
        </div>

        {/* Chevron */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-white/30 flex-shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="mt-1 mr-2.5 relative">
          {/* Vertical timeline line */}
          <div className="absolute right-0 top-1 bottom-1 w-px bg-white/10" />

          <div className="space-y-0.5">
            {steps.map((step, idx) => {
              const isDone = step.state === "output-available";
              const isActive = step.state === "input-streaming" || step.state === "input-available";
              const isLast = idx === steps.length - 1;

              return (
                <div key={`${step.toolName}-${idx}`} className="relative pr-5">
                  {/* Timeline dot */}
                  <div className={`absolute right-[-3px] top-2.5 w-[7px] h-[7px] rounded-full border-2 ${
                    isDone
                      ? "bg-emerald-400 border-emerald-400"
                      : isActive
                        ? "bg-indigo-400 border-indigo-400 animate-pulse"
                        : "bg-white/20 border-white/30"
                  }`} />

                  <div className={`py-1.5 px-2 rounded-md ${isActive ? "bg-white/[0.03]" : ""}`}>
                    {/* Tool name + emoji */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] leading-none">{step.emoji}</span>
                      <span className={`text-[12px] font-medium ${isDone ? "text-white/70" : isActive ? "text-white/80" : "text-white/50"}`}>
                        {step.label}
                      </span>
                      {isDone && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 flex-shrink-0">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      {isActive && (
                        <div className="w-3 h-3 flex-shrink-0">
                          <div className="w-3 h-3 border-[1.5px] border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
                        </div>
                      )}
                    </div>

                    {/* Detail line (query explanation, month/year, etc) */}
                    {step.detail && (
                      <p className="text-white/35 text-[11px] mt-0.5 mr-[23px] leading-snug truncate max-w-[280px]">
                        {step.detail}
                      </p>
                    )}

                    {/* Result summary */}
                    {isDone && step.resultSummary && (
                      <p className="text-white/40 text-[11px] mt-0.5 mr-[23px] leading-snug">
                        → {step.resultSummary}
                      </p>
                    )}
                  </div>

                  {/* Separator */}
                  {!isLast && <div className="h-px bg-white/[0.04] mr-2 ml-1" />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
