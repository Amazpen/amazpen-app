"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Bot, Copy, Check } from "lucide-react";
import type { AiMessage } from "@/types/ai";
import { AiMarkdownRenderer } from "./AiMarkdownRenderer";

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
    <div ref={containerRef} className="w-full h-[200px]">
      {dimensions && children}
    </div>
  );
}

// AI bot icon
function AiIcon() {
  return (
    <div className="flex-shrink-0 w-[28px] h-[28px] rounded-full bg-[#6366f1]/20 flex items-center justify-center">
      <Bot className="w-4 h-4 text-white" />
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/10"
      title="העתק"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-400" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-white/40 hover:text-white/70" />
      )}
    </button>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

interface AiMessageBubbleProps {
  message: AiMessage;
  thinkingStatus?: string | null;
}

export function AiMessageBubble({ message, thinkingStatus }: AiMessageBubbleProps) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="group flex flex-col items-end gap-1" dir="rtl">
        <div className="max-w-[80%] bg-[#6366f1] text-white text-[14px] leading-relaxed px-4 py-2.5 rounded-[16px] rounded-tl-[4px]">
          {message.content}
        </div>
        <div className="flex items-center gap-1 px-1">
          <span className="text-white/30 text-[11px]">{formatTime(message.timestamp)}</span>
          <CopyButton text={message.content} />
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col items-start gap-1" dir="rtl">
      <div className="flex items-start gap-2 w-full">
        <AiIcon />
        <div className="flex-1 min-w-0">
          <div className="bg-[#29318A] text-white px-4 py-3 rounded-[16px] rounded-tr-[4px]">
            {!message.content && thinkingStatus ? (
              <div className="flex flex-row-reverse gap-2 items-center h-[20px]">
                <span className="text-white/60 text-[13px]">{thinkingStatus}</span>
                <div className="flex gap-1.5 items-center">
                  <div className="w-[6px] h-[6px] rounded-full bg-white/40 animate-bounce [animation-delay:0ms]" />
                  <div className="w-[6px] h-[6px] rounded-full bg-white/40 animate-bounce [animation-delay:150ms]" />
                  <div className="w-[6px] h-[6px] rounded-full bg-white/40 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            ) : (
              <AiMarkdownRenderer content={message.content} />
            )}
            {message.chartData && (
              <div className="mt-3 bg-[#0F1535] rounded-[12px] p-3">
                <p className="text-white/70 text-[12px] font-medium mb-2" dir="rtl">
                  {message.chartData.title}
                </p>
                <SafeChartContainer>
                  <LazyResponsiveContainer width="100%" height="100%">
                    <LazyBarChart data={message.chartData.data} barGap={4}>
                      <LazyCartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <LazyXAxis
                        dataKey={message.chartData.xAxisKey}
                        tick={{ fill: "#7B91B0", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <LazyYAxis
                        tick={{ fill: "#7B91B0", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={60}
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
                      {message.chartData.dataKeys.map((dk) => (
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
                <div className="flex flex-row-reverse justify-center flex-wrap gap-3 mt-2">
                  {message.chartData.dataKeys.map((dk) => (
                    <div key={dk.key} className="flex flex-row-reverse items-center gap-1.5">
                      <span className="text-white/50 text-[11px]">{dk.label}</span>
                      <div
                        className="w-[10px] h-[10px] rounded-[2px]"
                        style={{ backgroundColor: dk.color }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between px-1 mr-[36px]" dir="ltr" style={{ width: "calc(100% - 36px)" }}>
        <CopyButton text={message.content} />
        <span className="text-white/30 text-[11px]">{formatTime(message.timestamp)}</span>
      </div>
    </div>
  );
}

