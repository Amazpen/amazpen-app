"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface AiMarkdownRendererProps {
  content: string;
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
  p: ({ children }) => (
    <p className="text-white/90 text-[13px] sm:text-[14px] leading-relaxed mb-2 last:mb-0 [overflow-wrap:anywhere]">
      {children}
    </p>
  ),
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
  li: ({ children }) => <li className="text-white/90">{children}</li>,
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
    <td className="text-white/80 text-right px-2 sm:px-3 py-1.5 sm:py-2">{children}</td>
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
