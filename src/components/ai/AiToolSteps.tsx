"use client";

import { useState, useEffect, useRef } from "react";
import type { UIMessage } from "ai";

const MONTH_NAMES = ["", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

/* ── Tool icon SVGs (no emojis) ── */

function IconChart({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />
    </svg>
  );
}

function IconSearch({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconCalendar({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" />
    </svg>
  );
}

function IconTarget({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function IconCalculate({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="16" height="20" x="4" y="2" rx="2" /><path d="M8 6h8" /><path d="M8 10h8" /><path d="M8 14h4" /><path d="M8 18h4" />
    </svg>
  );
}

function IconLightbulb({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 22h4" />
    </svg>
  );
}

function IconGear({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Tool display configuration with Hebrew labels and colored icons */
const toolDisplayMap: Record<string, {
  label: string;
  icon: (props: { className?: string }) => React.ReactElement;
  color: string; // Tailwind text color for the icon
  bgColor: string; // Tailwind bg color for the icon wrapper
  getDetail?: (input: Record<string, unknown>) => string;
}> = {
  getMonthlySummary: {
    label: "שליפת סיכום חודשי",
    icon: IconChart,
    color: "text-cyan-400",
    bgColor: "bg-cyan-400/15",
    getDetail: (input) => {
      const month = input.month as number;
      const year = input.year as number;
      return month && year ? `${MONTH_NAMES[month] || month}/${year}` : "";
    },
  },
  queryDatabase: {
    label: "שאילתה מבסיס הנתונים",
    icon: IconSearch,
    color: "text-blue-400",
    bgColor: "bg-blue-400/15",
    getDetail: (input) => (input.explanation as string) || "",
  },
  getBusinessSchedule: {
    label: "בדיקת לוח עבודה",
    icon: IconCalendar,
    color: "text-orange-400",
    bgColor: "bg-orange-400/15",
  },
  getGoals: {
    label: "בדיקת יעדים עסקיים",
    icon: IconTarget,
    color: "text-violet-400",
    bgColor: "bg-violet-400/15",
    getDetail: (input) => {
      const month = input.month as number;
      const year = input.year as number;
      return month && year ? `${MONTH_NAMES[month] || month}/${year}` : "";
    },
  },
  calculate: {
    label: "חישוב מתמטי",
    icon: IconCalculate,
    color: "text-amber-400",
    bgColor: "bg-amber-400/15",
    getDetail: (input) => (input.expression as string) || "",
  },
  proposeAction: {
    label: "הכנת הצעה",
    icon: IconLightbulb,
    color: "text-yellow-400",
    bgColor: "bg-yellow-400/15",
  },
};

const defaultToolDisplay = {
  label: "",
  icon: IconGear,
  color: "text-white/50",
  bgColor: "bg-white/10",
};

export interface ToolStep {
  toolName: string;
  label: string;
  detail: string;
  state: string;
  resultSummary: string;
}

/** Try to extract business name from tool output */
function getBusinessNameFromOutput(output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const out = output as Record<string, unknown>;
  if (out.businessName && typeof out.businessName === "string") return out.businessName;
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

      const display = toolDisplayMap[toolName] || defaultToolDisplay;
      const input = (toolPart.input || {}) as Record<string, unknown>;
      const isDone = toolPart.state === "output-available";

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
        label: display.label || toolName,
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

/** Minimum time (ms) to show the loading matrix so the user can see the animation */
const MIN_LOADING_MS = 1500;

export function AiToolSteps({ steps, isStreaming }: AiToolStepsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showLoading, setShowLoading] = useState(true);
  const loadStartRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const rawAllDone = steps.every((s) => s.state === "output-available") && !isStreaming;

  useEffect(() => {
    if (!rawAllDone) {
      // Reset timer when loading starts/continues
      loadStartRef.current = Date.now();
      setShowLoading(true);
      if (timerRef.current) clearTimeout(timerRef.current);
    } else {
      // Done — but hold the loading state for at least MIN_LOADING_MS
      const elapsed = Date.now() - loadStartRef.current;
      const remaining = MIN_LOADING_MS - elapsed;
      if (remaining > 0) {
        timerRef.current = setTimeout(() => setShowLoading(false), remaining);
      } else {
        setShowLoading(false);
      }
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [rawAllDone]);

  if (steps.length === 0) return null;

  const allDone = rawAllDone && !showLoading;
  const activeStep = !allDone ? (steps.find((s) => s.state !== "output-available") || steps[steps.length - 1]) : undefined;
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
            <MicroMatrix size={18} variant={activeStep ? toolToVariant(activeStep.toolName) : "thinking"} />
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
              {activeStep.label}
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
                if (group.count === 1) {
                  const step = group.items[0];
                  const isDone = step.state === "output-available";
                  const isActive = step.state === "input-streaming" || step.state === "input-available";
                  const display = toolDisplayMap[step.toolName] || defaultToolDisplay;
                  const ToolIcon = display.icon;

                  return (
                    <div key={`${step.toolName}-${gIdx}`} className="relative pr-6">
                      {/* Timeline dot - colored per tool */}
                      <div className={`absolute right-[1px] top-2 w-[13px] h-[13px] rounded-full flex items-center justify-center ${
                        isDone ? display.bgColor
                          : isActive ? display.bgColor
                            : "bg-white/10"
                      }`}>
                        <div className={`w-[5px] h-[5px] rounded-full ${
                          isDone ? display.color.replace("text-", "bg-")
                            : isActive ? `${display.color.replace("text-", "bg-")} animate-pulse`
                              : "bg-white/30"
                        }`} />
                      </div>
                      <div className={`py-1.5 px-2.5 rounded-lg ${isActive ? "bg-white/[0.04]" : ""}`}>
                        <div className="flex items-center gap-2">
                          <ToolIcon className={display.color} />
                          <span className={`text-[12px] font-medium ${isDone ? "text-white/70" : isActive ? "text-white/80" : "text-white/50"}`}>
                            {step.label}
                          </span>
                          {isDone && <CheckIcon />}
                          {isActive && <MicroMatrix size={14} variant={toolToVariant(step.toolName)} />}
                        </div>
                        {step.detail && (
                          <p className="text-white/35 text-[11px] mt-0.5 mr-[30px] leading-snug line-clamp-2">{step.detail}</p>
                        )}
                        {isDone && step.resultSummary && (
                          <p className={`text-[11px] mt-0.5 mr-[30px] leading-snug ${
                            step.resultSummary === "אין נתונים עדיין" ? "text-white/25" : `${display.color} opacity-60`
                          }`}>
                            {step.resultSummary}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                }

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
  const display = toolDisplayMap[group.toolName] || defaultToolDisplay;
  const ToolIcon = display.icon;

  return (
    <div className="relative pr-6">
      {/* Timeline dot - colored per tool */}
      <div className={`absolute right-[1px] top-2 w-[13px] h-[13px] rounded-full flex items-center justify-center ${display.bgColor}`}>
        <div className={`w-[5px] h-[5px] rounded-full ${
          group.allDone ? display.color.replace("text-", "bg-") : `${display.color.replace("text-", "bg-")} animate-pulse`
        }`} />
      </div>

      <div className="py-1.5 px-2.5 rounded-lg">
        {/* Group header */}
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="flex items-center gap-2 w-full text-right cursor-pointer select-none"
        >
          <ToolIcon className={display.color} />
          <span className={`text-[12px] font-medium ${group.allDone ? "text-white/70" : "text-white/80"}`}>
            {group.label}
          </span>
          <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${display.bgColor} ${display.color}`}>
            {group.count}x
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
                <span className={display.color} style={{ fontSize: "6px" }}>●</span>
                <span className="text-white/40 truncate max-w-[200px]">{step.detail || step.label}</span>
                {step.resultSummary && (
                  <span className={step.resultSummary === "אין נתונים עדיין" ? "text-white/20" : `${display.color} opacity-60`}>
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

/* ── MicroMatrix: dynamic 3×3 grid animation with unique shapes per variant ── */

export type MatrixVariant = "thinking" | "data" | "compute" | "goals" | "error" | "wave";

/** Shape types for dots */
type DotShape = "circle" | "square" | "diamond" | "star" | "triangle" | "ring";

interface VariantConfig {
  keyframe: string;
  duration: number;
  color: string;
  shape: DotShape;
  /** Per-dot delay in seconds */
  delay: (i: number, row: number, col: number) => number;
  /** Optional per-dot size multiplier (e.g. center dot bigger) */
  sizeMultiplier?: (i: number, row: number, col: number) => number;
}

const VARIANTS: Record<MatrixVariant, VariantConfig> = {
  wave: {
    keyframe: "mmWave",
    duration: 1.4,
    color: "bg-indigo-400",
    shape: "circle",
    delay: (_i, row, col) => (col + row) * 0.12,
    // Outer dots slightly larger for a "ripple" feel
    sizeMultiplier: (_i, row, col) => {
      const dist = Math.abs(row - 1) + Math.abs(col - 1);
      return dist === 0 ? 0.8 : dist === 1 ? 1 : 1.15;
    },
  },
  thinking: {
    keyframe: "mmBreathe",
    duration: 1.6,
    color: "bg-fuchsia-400",
    shape: "diamond",
    delay: (_i, row, col) => {
      // Spiral pattern from center outward
      const order = [4, 1, 5, 7, 3, 0, 2, 8, 6]; // center → edges spiral
      const idx = order.indexOf(row * 3 + col);
      return (idx >= 0 ? idx : 0) * 0.1;
    },
    sizeMultiplier: (_i, row, col) => {
      // Center biggest, shrinks outward
      const dist = Math.abs(row - 1) + Math.abs(col - 1);
      return dist === 0 ? 1.3 : dist === 1 ? 1 : 0.8;
    },
  },
  data: {
    keyframe: "mmScan",
    duration: 1.2,
    color: "bg-cyan-400",
    shape: "square",
    delay: (_i, row, col) => row * 0.2 + col * 0.06,
  },
  compute: {
    keyframe: "mmCompute",
    duration: 0.8,
    color: "bg-amber-400",
    shape: "diamond",
    delay: (i) => ((i * 7 + 3) % 9) * 0.07,
  },
  goals: {
    keyframe: "mmRadiate",
    duration: 1.6,
    color: "bg-violet-400",
    shape: "star",
    delay: (_i, row, col) => Math.max(Math.abs(row - 1), Math.abs(col - 1)) * 0.18,
    // Center dot is bigger — radiating outward
    sizeMultiplier: (_i, row, col) => {
      const dist = Math.max(Math.abs(row - 1), Math.abs(col - 1));
      return dist === 0 ? 1.4 : 1;
    },
  },
  error: {
    keyframe: "mmError",
    duration: 0.6,
    color: "bg-red-400",
    shape: "triangle",
    delay: (i) => i * 0.03,
  },
};

/** Get CSS styles for each dot shape */
function getShapeStyles(shape: DotShape, dotSize: number): React.CSSProperties {
  switch (shape) {
    case "circle":
      return { borderRadius: "50%" };
    case "square":
      return { borderRadius: `${Math.max(1, dotSize * 0.15)}px` };
    case "diamond":
      return { borderRadius: `${Math.max(1, dotSize * 0.15)}px`, transform: "rotate(45deg)" };
    case "star":
      return {
        borderRadius: "50%",
        clipPath: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
      };
    case "triangle":
      return {
        borderRadius: "0",
        clipPath: "polygon(50% 10%, 100% 90%, 0% 90%)",
      };
    case "ring":
      return { borderRadius: "50%" };
    default:
      return { borderRadius: "50%" };
  }
}

/** Map tool names to matrix variants */
function toolToVariant(toolName: string | undefined): MatrixVariant {
  switch (toolName) {
    case "getMonthlySummary":
    case "queryDatabase":
      return "data";
    case "calculate":
      return "compute";
    case "getGoals":
    case "getBusinessSchedule":
      return "goals";
    case "proposeAction":
      return "wave";
    default:
      return "wave";
  }
}

/**
 * CSS-only micro matrix loading indicator (3×3 grid).
 * Each variant has its own: keyframe, color, speed, delay pattern, AND dot shape.
 */
export function MicroMatrix({
  size = 16,
  variant = "wave",
  className = "",
}: {
  size?: number;
  variant?: MatrixVariant;
  className?: string;
}) {
  const baseDotSize = Math.max(2, Math.round(size / 5));
  const gap = Math.max(1, Math.round(size / 8));
  const config = VARIANTS[variant];
  const shapeBase = getShapeStyles(config.shape, baseDotSize);

  return (
    <div
      className={`inline-grid flex-shrink-0 ${className}`}
      style={{
        gridTemplateColumns: `repeat(3, ${baseDotSize}px)`,
        gap: `${gap}px`,
        width: size,
        height: size,
        placeContent: "center",
      }}
    >
      {Array.from({ length: 9 }, (_, i) => {
        const row = Math.floor(i / 3);
        const col = i % 3;
        const mult = config.sizeMultiplier ? config.sizeMultiplier(i, row, col) : 1;
        const dotSize = Math.round(baseDotSize * mult);

        return (
          <div
            key={i}
            className={config.color}
            style={{
              ...shapeBase,
              width: dotSize,
              height: dotSize,
              // Center within the grid cell if size differs
              margin: mult !== 1 ? `${(baseDotSize - dotSize) / 2}px` : undefined,
              animation: `${config.keyframe} ${config.duration}s ease-in-out infinite`,
              animationDelay: `${config.delay(i, row, col)}s`,
            }}
          />
        );
      })}
    </div>
  );
}
