"use client";

import { useState } from "react";
import type { UIMessage } from "ai";

/** Map tool names to Hebrew labels and icons */
const toolDisplayMap: Record<string, { label: string; icon: string }> = {
  getMonthlySummary: { label: "בודק סיכום חודשי", icon: "📊" },
  queryDatabase: { label: "שולף נתונים מהמערכת", icon: "🔍" },
  getBusinessSchedule: { label: "בודק לוח עבודה", icon: "📅" },
  getGoals: { label: "בודק יעדים", icon: "🎯" },
  calculate: { label: "מחשב נתונים", icon: "🧮" },
  proposeAction: { label: "מכין הצעה", icon: "💡" },
};

interface ToolStep {
  toolName: string;
  label: string;
  icon: string;
  state: string;
}

/** Extract completed tool steps from a message's parts */
export function getToolSteps(message: UIMessage): ToolStep[] {
  if (message.role !== "assistant") return [];

  const steps: ToolStep[] = [];
  const seen = new Set<string>();

  for (const part of message.parts) {
    if (part.type.startsWith("tool-") && part.type !== "tool-proposeAction") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolPart = part as any;
      const toolName = toolPart.toolName || part.type.replace("tool-", "");

      // Skip duplicates
      if (seen.has(toolName)) continue;
      seen.add(toolName);

      const display = toolDisplayMap[toolName] || { label: toolName, icon: "⚙️" };
      steps.push({
        toolName,
        label: display.label,
        icon: display.icon,
        state: toolPart.state || "output-available",
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
  const summaryText = allDone
    ? `ביצעתי ${steps.length} ${steps.length === 1 ? "פעולה" : "פעולות"}`
    : `מבצע פעולות...`;

  return (
    <div className="mb-2">
      {/* Clickable header */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex items-center gap-1.5 text-white/50 hover:text-white/70 transition-colors text-[12px] cursor-pointer select-none group/steps"
      >
        {/* Status indicator */}
        {allDone ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 flex-shrink-0">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <div className="w-[14px] h-[14px] flex-shrink-0">
            <div className="w-3 h-3 border-2 border-white/30 border-t-white/70 rounded-full animate-spin" />
          </div>
        )}

        <span>{summaryText}</span>

        {/* Chevron */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expanded list */}
      {isExpanded && (
        <div className="mt-1.5 mr-1 border-r border-white/10 pr-3 space-y-1.5">
          {steps.map((step) => (
            <div key={step.toolName} className="flex items-center gap-2 text-[12px]">
              {step.state === "output-available" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 flex-shrink-0">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <div className="w-3 h-3 flex-shrink-0">
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white/70 rounded-full animate-spin" />
                </div>
              )}
              <span className="text-white/60">{step.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
