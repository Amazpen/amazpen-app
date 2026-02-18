"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UIMessage } from "ai";
import type { AiChartData, AiProposedAction } from "@/types/ai";
import { AiMarkdownRenderer } from "./AiMarkdownRenderer";
import { AiActionCard } from "./AiActionCard";

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

/** Extract proposeAction tool result from message parts */
function getProposedAction(message: UIMessage): AiProposedAction | null {
  if (message.role !== "assistant") return null;

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

interface AiMessageBubbleProps {
  message: UIMessage;
  thinkingStatus?: string | null;
  errorText?: string;
  getChartData: (message: UIMessage) => AiChartData | undefined;
  getDisplayText: (message: UIMessage) => string;
}

export function AiMessageBubble({ message, thinkingStatus, errorText, getChartData, getDisplayText }: AiMessageBubbleProps) {
  const isUser = message.role === "user";
  const displayText = getDisplayText(message);
  const chartData = isUser ? undefined : getChartData(message);
  const proposedAction = isUser ? null : getProposedAction(message);

  if (isUser) {
    return (
      <div className="group flex flex-col items-end gap-1" dir="rtl">
        <div className="max-w-[88%] sm:max-w-[80%] lg:max-w-[70%] bg-[#6366f1] text-white text-[13px] sm:text-[14px] leading-relaxed px-3 sm:px-4 py-2 sm:py-2.5 rounded-[16px] rounded-tl-[4px] break-words">
          <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{displayText}</div>
        </div>
        <div className="flex items-center gap-1 px-1">
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
            {!displayText && thinkingStatus ? (
              <div className="flex gap-2 items-center h-[20px]">
                <span className="text-white/60 text-[13px]">{thinkingStatus}</span>
                <div className="flex gap-1.5 items-center">
                  <div className="w-[6px] h-[6px] rounded-full bg-white/40 animate-bounce [animation-delay:0ms]" />
                  <div className="w-[6px] h-[6px] rounded-full bg-white/40 animate-bounce [animation-delay:150ms]" />
                  <div className="w-[6px] h-[6px] rounded-full bg-white/40 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            ) : displayText ? (
              <AiMarkdownRenderer content={displayText} />
            ) : !proposedAction && !chartData ? (
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
            <div className="flex gap-2 items-center h-[20px]">
              <span className="text-white/60 text-[13px]">{status}</span>
              <div className="flex gap-1.5 items-center">
                <div className="w-[6px] h-[6px] rounded-full bg-white/40 animate-bounce [animation-delay:0ms]" />
                <div className="w-[6px] h-[6px] rounded-full bg-white/40 animate-bounce [animation-delay:150ms]" />
                <div className="w-[6px] h-[6px] rounded-full bg-white/40 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
