"use client";

import React from "react";

export interface AiDataSection {
  title: string;
  emoji?: string;
  rows: AiDataRow[];
  insight?: string;
  insightEmoji?: string;
}

export interface AiDataRow {
  label: string;
  values: (string | number | null)[];
  status?: "good" | "bad" | "neutral" | "total";
}

interface AiDataTableProps {
  sections: AiDataSection[];
  headers: string[];
  period?: string;
  businessName?: string;
}

function getRowClasses(status?: string) {
  switch (status) {
    case "good":
      return "bg-[#17DB4E]/[0.08] [&>td]:text-[#17DB4E] [&>td>span]:!text-[#17DB4E]";
    case "bad":
      return "bg-[#F64E60]/[0.08] [&>td]:text-[#F64E60] [&>td>span]:!text-[#F64E60]";
    case "total":
      return "bg-[#29318A]/40 font-bold [&>td]:text-white";
    default:
      return "";
  }
}

function formatCell(value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    if (Math.abs(value) >= 1000) return `₪${Math.round(value).toLocaleString("he-IL")}`;
    if (value % 1 !== 0) return value.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return value.toLocaleString("he-IL");
  }
  return String(value);
}

function isNumericCell(value: string | number | null): boolean {
  if (typeof value === "number") return true;
  if (typeof value === "string") {
    return /^[₪\d,+\-%.±\s—]+$/.test(value.trim()) || /₪/.test(value);
  }
  return false;
}

export function AiDataTable({ sections, headers, period, businessName }: AiDataTableProps) {
  return (
    <div className="flex flex-col gap-3 my-2" dir="rtl">
      {/* Header */}
      {businessName && (
        <div className="text-center">
          <h3 className="text-white text-[16px] font-bold">📊 סיכום מצטבר — {businessName}</h3>
          {period && <p className="text-white/50 text-[12px] mt-0.5">{period}</p>}
        </div>
      )}

      {/* Sections */}
      {sections.map((section, sIdx) => (
        <div key={sIdx} className="flex flex-col gap-1">
          {/* Section title */}
          <div className="flex items-center gap-1.5 mb-1">
            {section.emoji && <span className="text-[15px]">{section.emoji}</span>}
            <span className="text-white text-[14px] font-bold">{section.title}</span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-[8px] border border-white/10 scrollbar-thin">
            <table className="min-w-full text-[11px] sm:text-[12px] border-collapse" style={{ minWidth: "380px" }}>
              <thead className="bg-[#29318A]/60">
                <tr>
                  {headers.map((h, hIdx) => (
                    <th key={hIdx} className="text-white/80 font-semibold text-center px-2 py-2 whitespace-nowrap text-[10px] sm:text-[11px]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row, rIdx) => (
                  <tr key={rIdx} className={`border-b border-white/10 last:border-0 ${getRowClasses(row.status)}`}>
                    <td className="text-right px-2 py-1.5 whitespace-nowrap font-medium text-[11px] sm:text-[12px]">
                      {row.status === "good" && "✅ "}
                      {row.status === "bad" && "⚠️ "}
                      {row.label}
                    </td>
                    {row.values.map((val, vIdx) => {
                      const formatted = formatCell(val);
                      const numeric = isNumericCell(val);
                      return (
                        <td key={vIdx} className={`px-2 py-1.5 whitespace-nowrap text-[11px] sm:text-[12px] ${
                          numeric ? "text-center tabular-nums font-medium" : "text-center"
                        }`}>
                          {numeric ? (
                            <span dir="ltr" style={{ unicodeBidi: "embed" }}>{formatted}</span>
                          ) : formatted}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Insight */}
          {section.insight && (
            <p className="text-white/70 text-[12px] sm:text-[13px] leading-relaxed mt-0.5 flex items-start gap-1">
              <span className="flex-shrink-0">{section.insightEmoji || "💡"}</span>
              <span>{section.insight}</span>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** Parse a ```data-table-json code block into AiDataTable props */
export function parseDataTableJson(json: string): AiDataTableProps | null {
  try {
    const data = JSON.parse(json);
    if (data.sections && Array.isArray(data.sections) && data.headers && Array.isArray(data.headers)) {
      return data as AiDataTableProps;
    }
    return null;
  } catch {
    return null;
  }
}
