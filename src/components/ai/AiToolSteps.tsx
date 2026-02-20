"use client";

import { useState } from "react";
import type { UIMessage } from "ai";

const MONTH_NAMES = ["", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

/** Tool display configuration with Hebrew labels */
const toolDisplayMap: Record<string, { label: string; emoji: string; getDetail?: (input: Record<string, unknown>) => string }> = {
  getMonthlySummary: {
    label: "שליפת סיכום חודשי",
    emoji: "📊",
    getDetail: (input) => {
      const month = input.month as number;
      const year = input.year as number;
      return month && year ? `${MONTH_NAMES[month] || month}/${year}` : "";
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
      return month && year ? `${MONTH_NAMES[month] || month}/${year}` : "";
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

/** Try to extract business name from tool output */
function getBusinessNameFromOutput(output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const out = output as Record<string, unknown>;
  // From computed summary
  if (out.businessName && typeof out.businessName === "string") return out.businessName;
  // From cached metrics table
  if (out.business_name && typeof out.business_name === "string") return out.business_name as string;
  return "";
}

/** Summarize tool output for display */
function summarizeOutput(toolName: string, output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const out = output as Record<string, unknown>;

  if (out.error) return `שגיאה: ${String(out.error).slice(0, 60)}`;

  switch (toolName) {
    case "getMonthlySummary": {
      const income = out.total_income ?? (out.actuals && (out.actuals as Record<string, unknown>).totalIncome);
      const incomeNum = income !== undefined && income !== null ? Number(income) : NaN;
      if (!isNaN(incomeNum) && incomeNum > 0) {
        return `הכנסות: ₪${incomeNum.toLocaleString("he-IL")}`;
      }
      if (!isNaN(incomeNum) && incomeNum === 0) {
        return "אין נתונים עדיין";
      }
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
function getSmartSummary(groups: ToolGroup[]): string {
  const totalSteps = groups.reduce((sum, g) => sum + g.count, 0);
  if (totalSteps === 1) {
    const g = groups[0];
    switch (g.toolName) {
      case "getMonthlySummary": return "בדקתי סיכום חודשי";
      case "queryDatabase": return "שלפתי נתונים מהמערכת";
      case "getBusinessSchedule": return "בדקתי לוח עבודה";
      case "getGoals": return "בדקתי יעדים";
      case "calculate": return "חישבתי נתון";
      default: return "בדקתי נתון אחד";
    }
  }

  const uniqueTools = new Set(groups.map((g) => g.toolName));
  if (uniqueTools.has("getMonthlySummary") && groups.find((g) => g.toolName === "getMonthlySummary")!.count > 1) {
    const bizCount = groups.find((g) => g.toolName === "getMonthlySummary")!.count;
    return `בדקתי ${bizCount} עסקים`;
  }
  if (uniqueTools.has("queryDatabase") && uniqueTools.has("getMonthlySummary")) {
    return `אספתי וניתחתי ${totalSteps} מקורות נתונים`;
  }
  if (uniqueTools.has("queryDatabase") && totalSteps > 1) {
    return `הרצתי ${totalSteps} שאילתות`;
  }
  return `ביצעתי ${totalSteps} פעולות כדי לענות`;
}

/** A group of similar tool invocations */
interface ToolGroup {
  toolName: string;
  label: string;
  emoji: string;
  count: number;
  items: ToolStep[];
  allDone: boolean;
}

/** Group consecutive same-tool steps */
function groupSteps(steps: ToolStep[]): ToolGroup[] {
  const groups: ToolGroup[] = [];

  for (const step of steps) {
    const last = groups[groups.length - 1];
    if (last && last.toolName === step.toolName) {
      last.items.push(step);
      last.count++;
      last.allDone = last.allDone && step.state === "output-available";
    } else {
      groups.push({
        toolName: step.toolName,
        label: step.label,
        emoji: step.emoji,
        count: 1,
        items: [step],
        allDone: step.state === "output-available",
      });
    }
  }

  return groups;
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

      const inputStr = JSON.stringify(toolPart.input || {});
      const key = `${toolName}:${inputStr}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const display = toolDisplayMap[toolName] || { label: toolName, emoji: "⚙️" };
      const input = (toolPart.input || {}) as Record<string, unknown>;
      const isDone = toolPart.state === "output-available";

      // Build detail with business name from output if available
      let detail = display.getDetail ? display.getDetail(input) : "";
      if (isDone && toolName === "getMonthlySummary") {
        const bizName = getBusinessNameFromOutput(toolPart.output);
        if (bizName) {
          detail = detail ? `${bizName} — ${detail}` : bizName;
        }
      }

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
  const groups = groupSteps(steps);

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
            <MicroMatrix size={18} />
          </div>
        )}

        {/* Summary text */}
        <div className="flex-1 min-w-0">
          {allDone ? (
            <span className="text-white/55 text-[12px] font-medium">
              {getSmartSummary(groups)}
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

      {/* Expandable area with grid transition */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="mx-3 h-px bg-white/[0.06]" />

          <div className="px-3 py-2 mr-0.5 relative">
            <div className="absolute right-3 top-3 bottom-3 w-px bg-white/[0.08]" />

            <div className="space-y-1">
              {groups.map((group, gIdx) => {
                // Single item in group - render normally
                if (group.count === 1) {
                  const step = group.items[0];
                  const isDone = step.state === "output-available";
                  const isActive = step.state === "input-streaming" || step.state === "input-available";

                  return (
                    <div key={`${step.toolName}-${gIdx}`} className="relative pr-6">
                      <div className={`absolute right-[3px] top-2.5 w-[9px] h-[9px] rounded-full border-2 ${
                        isDone ? "bg-emerald-400 border-emerald-400"
                          : isActive ? "bg-indigo-400 border-indigo-400 animate-pulse"
                            : "bg-white/20 border-white/30"
                      }`} />
                      <div className={`py-1.5 px-2.5 rounded-lg ${isActive ? "bg-white/[0.04]" : ""}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] leading-none">{step.emoji}</span>
                          <span className={`text-[12px] font-medium ${isDone ? "text-white/70" : isActive ? "text-white/80" : "text-white/50"}`}>
                            {step.label}
                          </span>
                          {isDone && <CheckIcon />}
                          {isActive && <SpinnerIcon />}
                        </div>
                        {step.detail && (
                          <p className="text-white/35 text-[11px] mt-0.5 mr-[30px] leading-snug line-clamp-2">{step.detail}</p>
                        )}
                        {isDone && step.resultSummary && (
                          <p className="text-emerald-400/50 text-[11px] mt-0.5 mr-[30px] leading-snug">← {step.resultSummary}</p>
                        )}
                      </div>
                    </div>
                  );
                }

                // Multiple items - render as collapsed group
                return (
                  <GroupedSteps key={`group-${group.toolName}-${gIdx}`} group={group} />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Collapsed group of same-tool invocations */
function GroupedSteps({ group }: { group: ToolGroup }) {
  const [expanded, setExpanded] = useState(false);
  const hasData = group.items.some((s) => s.resultSummary && s.resultSummary !== "אין נתונים עדיין");

  return (
    <div className="relative pr-6">
      <div className={`absolute right-[3px] top-2.5 w-[9px] h-[9px] rounded-full border-2 ${
        group.allDone ? "bg-emerald-400 border-emerald-400" : "bg-indigo-400 border-indigo-400 animate-pulse"
      }`} />

      <div className="py-1.5 px-2.5 rounded-lg">
        {/* Group header */}
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="flex items-center gap-2 w-full text-right cursor-pointer select-none"
        >
          <span className="text-[14px] leading-none">{group.emoji}</span>
          <span className={`text-[12px] font-medium ${group.allDone ? "text-white/70" : "text-white/80"}`}>
            {group.label}
          </span>
          <span className="text-white/30 text-[11px] font-medium bg-white/[0.06] px-1.5 py-0.5 rounded-full">
            ×{group.count}
          </span>
          {group.allDone && <CheckIcon />}
          {hasData && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`text-white/20 mr-auto transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
        </button>

        {/* Expanded sub-items */}
        {expanded && (
          <div className="mt-1 mr-[30px] space-y-0.5">
            {group.items.map((step, idx) => (
              <div key={idx} className="flex items-baseline gap-1.5 text-[11px]">
                <span className="text-white/25">•</span>
                <span className="text-white/40 truncate max-w-[200px]">{step.detail || step.label}</span>
                {step.resultSummary && (
                  <span className={step.resultSummary === "אין נתונים עדיין" ? "text-white/20" : "text-emerald-400/50"}>
                    — {step.resultSummary}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 flex-shrink-0">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * CSS-only micro matrix loading indicator (3×3 dot grid with wave animation).
 * Exported so AiMessageBubble can use it for the thinking bubble.
 */
export function MicroMatrix({ size = 16, className = "" }: { size?: number; className?: string }) {
  const dotSize = Math.max(2, Math.round(size / 5));
  const gap = Math.max(1, Math.round(size / 8));

  return (
    <div
      className={`inline-grid flex-shrink-0 ${className}`}
      style={{
        gridTemplateColumns: `repeat(3, ${dotSize}px)`,
        gap: `${gap}px`,
        width: size,
        height: size,
        placeContent: "center",
      }}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <div
          key={i}
          className="rounded-full bg-indigo-400"
          style={{
            width: dotSize,
            height: dotSize,
            animation: `microMatrixPulse 1.4s ease-in-out infinite`,
            animationDelay: `${((i % 3) + Math.floor(i / 3)) * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}

function SpinnerIcon() {
  return <MicroMatrix size={14} />;
}
