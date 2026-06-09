"use client";

import { useState, useRef, useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface DateRange {
  start: Date;
  end: Date;
}

interface DateRangePickerProps {
  dateRange: DateRange;
  onChange: (dateRange: DateRange) => void;
  className?: string;
  variant?: "compact" | "button";
  // When true, adds a "טווח מותאם" section with free start/end date inputs so
  // the user can pick an arbitrary range (e.g. 01/01–31/03) instead of being
  // limited to whole months. Used by the pending-payments report.
  allowCustomRange?: boolean;
}

// Hebrew months for dropdown
const hebrewMonths = [
  { value: "01", label: "ינואר" },
  { value: "02", label: "פברואר" },
  { value: "03", label: "מרץ" },
  { value: "04", label: "אפריל" },
  { value: "05", label: "מאי" },
  { value: "06", label: "יוני" },
  { value: "07", label: "יולי" },
  { value: "08", label: "אוגוסט" },
  { value: "09", label: "ספטמבר" },
  { value: "10", label: "אוקטובר" },
  { value: "11", label: "נובמבר" },
  { value: "12", label: "דצמבר" },
];

// Generate years array (2024 to 2031)
const years = [2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031];

// Default year shown in the year dropdown when nothing has been picked yet.
// Keeps the picker pinned to the active operational year so users don't have
// to scroll/select a year for every month switch.
const DEFAULT_YEAR = "2026";

function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DateRangePicker({ dateRange, onChange, className = "", variant = "compact", allowCustomRange = false }: DateRangePickerProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedYear, setSelectedYear] = useState(DEFAULT_YEAR);
  // Custom-range draft inputs (only used when allowCustomRange).
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const applyCustomRange = () => {
    // Fall back to the values currently shown in the inputs — they display the
    // active range via `customStart || toInputDate(...)`, but the draft state
    // stays "" until the field is actively edited. Without this, touching only
    // one field (e.g. just מתאריך) leaves the other "" and the click silently
    // no-ops. What the user sees in the inputs is what gets applied.
    const startVal = customStart || toInputDate(dateRange.start);
    const endVal = customEnd || toInputDate(dateRange.end);
    if (!startVal || !endVal) return;
    const [sy, sm, sd] = startVal.split("-").map(Number);
    const [ey, em, ed] = endVal.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    if (end < start) return;
    onChange({ start, end });
    setIsDropdownOpen(false);
  };
  // Anchor: which side of the trigger the dropdown is pinned to. Defaults to
  // 'right' (RTL — opens leftwards from the trigger). When the trigger sits
  // close to the left edge of the viewport, the menu would clip off-screen,
  // so we measure on open and flip to 'left' (opens rightwards) instead.
  const [anchorSide, setAnchorSide] = useState<"right" | "left">("right");
  const triggerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!isDropdownOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownWidth = 200; // matches min-w-[180px] + padding
    // If anchoring right would leave the dropdown's left edge < 8px from the
    // viewport's left edge, flip to anchor on the left side instead.
    const wouldClipLeft = rect.right - dropdownWidth < 8;
    // setState in layout-effect after a DOM measurement — required to compute
    // anchor side based on the rendered position. This is the canonical use
    // case the linter rule allows (syncing with an external system: the DOM).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnchorSide(wouldClipLeft ? "left" : "right");
  }, [isDropdownOpen]);

  // Display: a whole-month range shows "אפריל 2026"; a custom range shows
  // "01/01/26 – 31/03/26". We detect a whole month by checking the range spans
  // exactly the 1st to the last day of one month.
  const isWholeMonth = (() => {
    const s = dateRange.start;
    const e = dateRange.end;
    const lastDay = new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate();
    return s.getDate() === 1
      && e.getDate() === lastDay
      && s.getMonth() === e.getMonth()
      && s.getFullYear() === e.getFullYear();
  })();
  const monthLabel = hebrewMonths[dateRange.start.getMonth()]?.label || "";
  const fmtShort = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
  const displayLabel = isWholeMonth
    ? `${monthLabel} ${dateRange.start.getFullYear()}`
    : `${fmtShort(dateRange.start)} – ${fmtShort(dateRange.end)}`;

  const selectCurrentMonth = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    onChange({ start, end });
    setIsDropdownOpen(false);
  };

  const selectLastMonth = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    onChange({ start, end });
    setIsDropdownOpen(false);
  };

  const handleMonthSelect = (month: string) => {
    setSelectedYear((currentYear) => {
      if (currentYear) {
        applyMonthYear(month, currentYear);
      } else {
        setSelectedMonth(month);
      }
      return currentYear;
    });
  };

  const handleYearSelect = (year: string) => {
    setSelectedMonth((currentMonth) => {
      if (currentMonth) {
        applyMonthYear(currentMonth, year);
      } else {
        setSelectedYear(year);
      }
      return currentMonth;
    });
  };

  const applyMonthYear = (month: string, year: string) => {
    const monthNum = parseInt(month);
    const yearNum = parseInt(year);
    const start = new Date(yearNum, monthNum - 1, 1);
    const end = new Date(yearNum, monthNum, 0);
    onChange({ start, end });
    setIsDropdownOpen(false);
    setSelectedMonth("");
    setSelectedYear(DEFAULT_YEAR);
  };

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  if (variant === "button") {
    return (
      <div ref={triggerRef} className={`relative flex items-center gap-[8px] border border-[#727BA0] rounded-[7px] px-[12px] py-[8px] cursor-pointer ${className}`} onClick={toggleDropdown}>
        <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className="text-[#4C526B]">
          <path d="M10 13L16 19L22 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="text-[16px] text-white/80">{displayLabel}</span>
        {isDropdownOpen && (
          <>
            <div className="fixed inset-0 z-[100]" onClick={(e) => { e.stopPropagation(); setIsDropdownOpen(false); }} />
            <div className={`absolute top-full ${anchorSide === "right" ? "right-0" : "left-0"} mt-[5px] bg-[#0F1535] border-2 border-[#29318A] rounded-[10px] p-[5px] z-[101] flex flex-col gap-[1px] min-w-[180px]`} onClick={(e) => e.stopPropagation()}>
              <Button type="button" variant="ghost" onClick={selectCurrentMonth} className="text-[14px] text-white text-center leading-[1.2] py-[4px] hover:bg-[#29318A]/30 rounded-[5px] transition-colors">חודש נוכחי</Button>
              <Button type="button" variant="ghost" onClick={selectLastMonth} className="text-[14px] text-white text-center leading-[1.2] py-[4px] hover:bg-[#29318A]/30 rounded-[5px] transition-colors">חודש שעבר</Button>
              <div className="border-t border-[#29318A]/50 my-[3px]" />
              <div className="flex items-center justify-center gap-[4px]">
                <Select value={selectedMonth || "__none__"} onValueChange={(val) => handleMonthSelect(val === "__none__" ? "" : val)}>
                  <SelectTrigger className="bg-transparent text-[12px] text-white text-center py-[3px] border-none h-auto min-h-0 px-[2px] w-auto gap-1"><SelectValue placeholder="חודש" /></SelectTrigger>
                  <SelectContent className="z-[200]">{hebrewMonths.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
                <span className="text-white/50 text-[10px]">/</span>
                <Select value={selectedYear || "__none__"} onValueChange={(val) => handleYearSelect(val === "__none__" ? "" : val)}>
                  <SelectTrigger className="bg-transparent text-[12px] text-white text-center py-[3px] border-none h-auto min-h-0 px-[2px] w-auto gap-1"><SelectValue placeholder="שנה" /></SelectTrigger>
                  <SelectContent className="z-[200]">{years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div ref={triggerRef} className="relative inline-block" dir="rtl">
      <Button
        type="button"
        variant="ghost"
        onClick={toggleDropdown}
        className={`inline-flex items-center border border-[#727BA0] rounded-[7px] px-3 py-2 sm:px-[8px] sm:py-[5px] cursor-pointer hover:border-[#29318A] transition-colors touch-manipulation min-h-[44px] sm:min-h-0 ${className}`}
      >
        <svg width="14" height="14" viewBox="0 0 32 32" fill="none" className="text-[#4C526B] ml-1 sm:w-3 sm:h-3">
          <path d="M10 13L16 19L22 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="text-[15px] sm:text-[14px] text-white leading-[1.4]">{displayLabel}</span>
      </Button>

      {isDropdownOpen && (
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setIsDropdownOpen(false)} />
          <div className={`absolute top-full ${anchorSide === "right" ? "right-0" : "left-0"} mt-[5px] bg-[#0F1535] border-2 border-[#29318A] rounded-[10px] p-[5px] z-[101] flex flex-col gap-[1px] min-w-[180px]`}>
            <Button
              type="button"
              variant="ghost"
              onClick={selectCurrentMonth}
              className="text-[14px] text-white text-center leading-[1.2] py-[4px] hover:bg-[#29318A]/30 rounded-[5px] transition-colors"
            >
              חודש נוכחי
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={selectLastMonth}
              className="text-[14px] text-white text-center leading-[1.2] py-[4px] hover:bg-[#29318A]/30 rounded-[5px] transition-colors"
            >
              חודש שעבר
            </Button>
            <div className="border-t border-[#29318A]/50 my-[3px]" />
            <div className="flex items-center justify-center gap-[4px]">
              <Select
                value={selectedMonth || "__none__"}
                onValueChange={(val) => handleMonthSelect(val === "__none__" ? "" : val)}
              >
                <SelectTrigger className="bg-transparent text-[12px] text-white text-center py-[3px] border-none h-auto min-h-0 px-[2px] w-auto gap-1">
                  <SelectValue placeholder="חודש" />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {hebrewMonths.map((month) => (
                    <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-white/50 text-[10px]">/</span>
              <Select
                value={selectedYear || "__none__"}
                onValueChange={(val) => handleYearSelect(val === "__none__" ? "" : val)}
              >
                <SelectTrigger className="bg-transparent text-[12px] text-white text-center py-[3px] border-none h-auto min-h-0 px-[2px] w-auto gap-1">
                  <SelectValue placeholder="שנה" />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {years.map((year) => (
                    <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {allowCustomRange && (
              <>
                <div className="border-t border-[#29318A]/50 my-[3px]" />
                <span className="text-[12px] text-white/60 text-center">טווח מותאם</span>
                <div className="flex flex-col gap-[4px] px-[2px]">
                  <label className="flex items-center justify-between gap-[6px] text-[11px] text-white/70">
                    מתאריך
                    <input
                      type="date"
                      value={customStart || toInputDate(dateRange.start)}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="bg-[#1a1f4e] border border-[#29318A] rounded-[5px] px-[6px] py-[3px] text-white text-[11px] ltr-num"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-[6px] text-[11px] text-white/70">
                    עד תאריך
                    <input
                      type="date"
                      value={customEnd || toInputDate(dateRange.end)}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="bg-[#1a1f4e] border border-[#29318A] rounded-[5px] px-[6px] py-[3px] text-white text-[11px] ltr-num"
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={applyCustomRange}
                    className="text-[12px] text-white bg-[#29318A] hover:bg-[#3D44A0] rounded-[5px] py-[4px] transition-colors"
                  >
                    החל טווח
                  </Button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
