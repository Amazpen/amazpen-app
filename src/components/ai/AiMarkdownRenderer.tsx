"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface AiMarkdownRendererProps {
  content: string;
}

/** Regex to match currency amounts, percentages, and standalone numbers */
const NUMBER_PATTERN = /(\u20AA[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?(?:\s*\u20AA)|[\d,]+(?:\.\d+)?%|(?<![א-ת\w])[\d,]{2,}(?:\.\d+)?(?![א-ת\w]))/g;

/** Regex to detect emoji at the start of a string */
const LEADING_EMOJI = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u;

/** Highlight numbers and amounts in children text nodes */
function highlightNumbers(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child !== "string") return child;

    const parts = child.split(NUMBER_PATTERN);
    if (parts.length === 1) return child;

    return parts.map((part, i) => {
      if (NUMBER_PATTERN.test(part)) {
        return (
          <span key={i} className="text-white font-semibold" dir="ltr" style={{ unicodeBidi: "embed" }}>
            {part}
          </span>
        );
      }
      // Reset lastIndex since we reuse the regex
      NUMBER_PATTERN.lastIndex = 0;
      return part;
    });
  });
}

/** Wrap leading emoji in a styled span for clean RTL display */
function handleLeadingEmoji(children: React.ReactNode): { emoji: string | null; rest: React.ReactNode } {
  const childArray = React.Children.toArray(children);
  if (childArray.length === 0) return { emoji: null, rest: children };

  const first = childArray[0];
  if (typeof first !== "string") return { emoji: null, rest: children };

  const match = first.match(LEADING_EMOJI);
  if (!match) return { emoji: null, rest: children };

  const emoji = match[1];
  const remaining = first.slice(match[0].length);
  const newChildren = [remaining, ...childArray.slice(1)];
  return { emoji, rest: newChildren };
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-white text-xl font-bold mb-3 pb-2 border-b border-white/10">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-white text-lg font-bold mb-2 pb-1.5 border-b border-white/10">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-white text-base font-bold mb-2">{children}</h3>
  ),
  p: ({ children }) => {
    const { emoji, rest } = handleLeadingEmoji(children);
    if (emoji) {
      return (
        <p className="text-white/90 text-[13px] sm:text-[14px] leading-relaxed mb-2 last:mb-0 [overflow-wrap:anywhere] flex items-start gap-1.5">
          <span className="text-[16px] leading-[1.4] flex-shrink-0 inline-block w-[20px] text-center" style={{ unicodeBidi: "isolate" }}>{emoji}</span>
          <span className="flex-1 min-w-0">{highlightNumbers(rest)}</span>
        </p>
      );
    }
    return (
      <p className="text-white/90 text-[13px] sm:text-[14px] leading-relaxed mb-2 last:mb-0 [overflow-wrap:anywhere]">
        {highlightNumbers(children)}
      </p>
    );
  },
  strong: ({ children }) => (
    <strong className="text-white font-bold">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="text-white/70 italic">{children}</em>
  ),
  ul: ({ children }) => (
    <ul className="text-white/90 text-[13px] sm:text-[14px] leading-relaxed mb-2 list-disc pr-4 sm:pr-5 space-y-1">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="text-white/90 text-[13px] sm:text-[14px] leading-relaxed mb-2 list-decimal pr-4 sm:pr-5 space-y-1">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="text-white/90">{highlightNumbers(children)}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#6366f1] hover:underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-r-[3px] border-[#6366f1] pr-3 my-2 bg-white/5 rounded-l-[8px] py-2 pl-3">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <div className="bg-[#0F1535] rounded-[8px] p-2 sm:p-3 my-2 overflow-x-auto -mx-1 sm:mx-0">
          <code className="text-[12px] sm:text-[13px] text-[#e2e8f0] font-mono leading-relaxed">
            {children}
          </code>
        </div>
      );
    }
    return (
      <code className="bg-white/10 text-[#e2e8f0] px-1 sm:px-1.5 py-0.5 rounded text-[12px] sm:text-[13px] font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => (
    <div className="overflow-x-auto my-2 rounded-[8px] border border-white/10 -mx-1 sm:mx-0">
      <table className="w-full text-[11px] sm:text-[13px]" dir="rtl">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-[#0F1535]">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="[&>tr:nth-child(even)]:bg-white/5">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="border-b border-white/10 last:border-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="text-white font-semibold text-right px-2 sm:px-3 py-1.5 sm:py-2">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="text-white/80 text-right px-2 sm:px-3 py-1.5 sm:py-2">{highlightNumbers(children)}</td>
  ),
  hr: () => <hr className="border-white/10 my-3" />,
};

export function AiMarkdownRenderer({ content }: AiMarkdownRendererProps) {
  return (
    <div dir="rtl" className="overflow-hidden">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
