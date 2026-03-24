"use client";

import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface AiMarkdownRendererProps {
  content: string;
  searchQuery?: string;
}

/** Regex to match currency amounts, percentages, and standalone numbers */
const NUMBER_PATTERN = /(\u20AA[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?(?:\s*\u20AA)|[\d,]+(?:\.\d+)?%|(?<![א-ת\w])[\d,]{2,}(?:\.\d+)?(?![א-ת\w]))/g;

/** Regex to detect emoji at the start of a string */
const LEADING_EMOJI = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u;

/** Highlight search matches in a string */
function highlightSearch(text: string, query: string | undefined, keyPrefix: string): React.ReactNode {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={`${keyPrefix}-${i}`} className="bg-yellow-500/30 text-white rounded-sm px-0.5">{part}</mark>
    ) : (
      <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>
    )
  );
}

/** Highlight numbers and amounts in children text nodes, then search matches.
 *  If inheritColor is true, numbers inherit the parent's text color (used in colored table cells). */
function highlightNumbers(children: React.ReactNode, searchQuery?: string, inheritColor?: boolean): React.ReactNode {
  return React.Children.map(children, (child, ci) => {
    if (typeof child !== "string") return child;

    const parts = child.split(NUMBER_PATTERN);
    if (parts.length === 1) return highlightSearch(child, searchQuery, `s${ci}`);

    return parts.map((part, i) => {
      if (NUMBER_PATTERN.test(part)) {
        return (
          <span key={i} className={inheritColor ? "font-semibold" : "text-white font-semibold"} dir="ltr" style={{ unicodeBidi: "embed" }}>
            {highlightSearch(part, searchQuery, `n${ci}-${i}`)}
          </span>
        );
      }
      // Reset lastIndex since we reuse the regex
      NUMBER_PATTERN.lastIndex = 0;
      return highlightSearch(part, searchQuery, `t${ci}-${i}`);
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

function buildComponents(searchQuery?: string): Components {
  const hl = (children: React.ReactNode) => highlightNumbers(children, searchQuery);
  return {
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
            <span className="flex-1 min-w-0">{hl(rest)}</span>
          </p>
        );
      }
      return (
        <p className="text-white/90 text-[13px] sm:text-[14px] leading-relaxed mb-2 last:mb-0 [overflow-wrap:anywhere]">
          {hl(children)}
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
    li: ({ children }) => <li className="text-white/90">{hl(children)}</li>,
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
        <table className="w-full text-[11px] sm:text-[13px] border-collapse table-fixed" dir="rtl">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-[#29318A]/60">{children}</thead>
    ),
    tbody: ({ children }) => (
      <tbody className="[&>tr:nth-child(even)]:bg-white/[0.03]">{children}</tbody>
    ),
    tr: ({ children }) => {
      // Only color rows that have explicit ✅ or ⚠️ indicators from the AI
      const extractText = (node: React.ReactNode): string => {
        if (typeof node === "string") return node;
        if (React.isValidElement(node)) {
          const props = node.props as Record<string, unknown>;
          if (props.children) return React.Children.toArray(props.children as React.ReactNode).map(extractText).join("");
        }
        return "";
      };
      const text = React.Children.toArray(children).map(extractText).join("");

      const isTotal = /סה[""״]כ/.test(text);
      const hasGood = text.includes("✅");
      const hasBad = text.includes("⚠️");

      let rowClass = "border-b border-white/10 last:border-0";
      // Add data attribute so child td cells can inherit the row color
      let rowColor: "good" | "bad" | undefined;
      if (isTotal && !hasGood && !hasBad) rowClass += " bg-[#29318A]/30 font-bold";
      else if (hasBad) { rowClass += " bg-[#F64E60]/[0.07]"; rowColor = "bad"; }
      else if (hasGood) { rowClass += " bg-[#17DB4E]/[0.05]"; rowColor = "good"; }

      // If row is colored, clone children to pass the color hint
      if (rowColor) {
        const coloredChildren = React.Children.map(children, child => {
          if (React.isValidElement(child) && (child as React.ReactElement).type === "td") {
            // Can't easily pass props to markdown-generated td, so we use CSS class on tr
            return child;
          }
          return child;
        });
        return <tr className={`${rowClass} ${rowColor === "good" ? "[&>td]:text-[#17DB4E] [&>td>span]:!text-[#17DB4E]" : "[&>td]:text-[#F64E60] [&>td>span]:!text-[#F64E60]"}`}>{coloredChildren}</tr>;
      }

      return <tr className={rowClass}>{children}</tr>;
    },
    th: ({ children }) => (
      <th className="text-white font-semibold text-center px-1.5 sm:px-2 py-2 sm:py-2.5 whitespace-nowrap text-[10px] sm:text-[12px]">
        {children}
      </th>
    ),
    td: ({ children }) => {
      // Extract full text including from nested elements
      const extractCellText = (node: React.ReactNode): string => {
        if (typeof node === "string") return node;
        if (React.isValidElement(node)) {
          const props = node.props as Record<string, unknown>;
          if (props.children) return React.Children.toArray(props.children as React.ReactNode).map(extractCellText).join("");
        }
        return "";
      };
      const text = extractCellText(children);
      const trimmed = text.trim();
      const isNumeric = /₪/.test(trimmed) || /^\d/.test(trimmed) || /^[+\-±]/.test(trimmed);

      // Only color cells that have explicit ✅/⚠️ markers from the AI
      const hasGood = text.includes("✅");
      const hasBad = text.includes("⚠️");
      const isColored = hasGood || hasBad;

      let cellClass = "px-1.5 sm:px-2 py-1.5 sm:py-2 whitespace-nowrap";
      if (isNumeric) {
        cellClass += " text-center ltr-num font-medium tabular-nums";
      } else {
        cellClass += " text-right";
      }
      if (hasGood) cellClass += " text-[#17DB4E]";
      else if (hasBad) cellClass += " text-[#F64E60]";
      else cellClass += " text-white/80";

      // When cell is colored, use inheritColor so number spans don't override with text-white
      return <td className={cellClass}>{highlightNumbers(children, searchQuery, isColored)}</td>;
    },
    hr: () => <hr className="border-white/10 my-3" />,
  };
}

export function AiMarkdownRenderer({ content, searchQuery }: AiMarkdownRendererProps) {
  const components = useMemo(() => buildComponents(searchQuery), [searchQuery]);
  return (
    <div dir="rtl" className="overflow-hidden">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
