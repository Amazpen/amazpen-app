"use client";

import { useRef, useEffect, useState } from "react";
import dynamic from "next/dynamic";
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

// AI sparkle icon
function AiIcon() {
  return (
    <div className="flex-shrink-0 w-[28px] h-[28px] rounded-full bg-[#6366f1]/20 flex items-center justify-center">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-[#6366f1]">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="currentColor" />
      </svg>
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

interface AiMessageBubbleProps {
  message: AiMessage;
}

export function AiMessageBubble({ message }: AiMessageBubbleProps) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1" dir="rtl">
        <div className="max-w-[80%] bg-[#6366f1] text-white text-[14px] leading-relaxed px-4 py-2.5 rounded-[16px] rounded-tl-[4px]">
          {message.content}
        </div>
        <span className="text-white/30 text-[11px] px-1">{formatTime(message.timestamp)}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1" dir="rtl">
      <div className="flex items-start gap-2 max-w-[85%]">
        <AiIcon />
        <div className="flex-1 min-w-0">
          <div className="bg-[#29318A] text-white px-4 py-3 rounded-[16px] rounded-tr-[4px]">
            <AiMarkdownRenderer content={message.content} />
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
      <span className="text-white/30 text-[11px] px-1 mr-[36px]">{formatTime(message.timestamp)}</span>
    </div>
  );
}

// Typing indicator component
export function AiTypingIndicator() {
  return (
    <div className="flex items-start gap-2" dir="rtl">
      <AiIcon />
      <div className="bg-[#29318A] px-4 py-3 rounded-[16px] rounded-tr-[4px]">
        <div className="flex gap-1.5 items-center h-[20px]">
          <div className="w-[7px] h-[7px] rounded-full bg-white/40 animate-bounce [animation-delay:0ms]" />
          <div className="w-[7px] h-[7px] rounded-full bg-white/40 animate-bounce [animation-delay:150ms]" />
          <div className="w-[7px] h-[7px] rounded-full bg-white/40 animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}
