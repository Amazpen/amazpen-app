"use client";

import { useRef, useState } from "react";
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

export function DateRangePicker({ dateRange, onChange, className = "", variant = "compact" }: DateRangePickerProps) {
  const endInputRef = useRef<HTMLInputElement>(null);
  const startInputRef = useRef<HTMLInputElement>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedYear, setSelectedYear] = useState("");

  const formatDate = (date: Date) => date.toLocaleDateString('he-IL');

  const openEndPicker = () => {
    endInputRef.current?.showPicker?.();
  };

  const openStartPicker = () => {
    startInputRef.current?.showPicker?.();
  };

  // Quick selection handlers
  const selectYesterday = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    onChange({ start: yesterday, end: yesterday });
    setIsDropdownOpen(false);
  };

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
    setSelectedMonth(month);
    if (selectedYear) {
      applyMonthYear(month, selectedYear);
    }
  };

  const handleYearSelect = (year: string) => {
    setSelectedYear(year);
    if (selectedMonth) {
      applyMonthYear(selectedMonth, year);
    }
  };

  const applyMonthYear = (month: string, year: string) => {
    const monthNum = parseInt(month);
    const yearNum = parseInt(year);
    const start = new Date(yearNum, monthNum - 1, 1);
    const end = new Date(yearNum, monthNum, 0);
    onChange({ start, end });
    setIsDropdownOpen(false);
    setSelectedMonth("");
    setSelectedYear("");
  };

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  if (variant === "button") {
    return (
      <div className={`relative flex items-center gap-[8px] border border-[#4C526B] rounded-[7px] px-[12px] py-[8px] ${className}`}>
        <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className="text-[#4C526B]">
          <path d="M10 13L16 19L22 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span
          onClick={openEndPicker}
          className="text-[16px] text-white/80 ltr-num cursor-pointer"
        >
          {formatDate(dateRange.end)}
        </span>
        <span className="text-[16px] text-white/60">-</span>
        <span
          onClick={openStartPicker}
          className="text-[16px] text-white/80 ltr-num cursor-pointer"
        >
          {formatDate(dateRange.start)}
        </span>
        <input
          ref={endInputRef}
          type="date"
          value={dateRange.end.toISOString().split("T")[0]}
          onChange={(e) => onChange({ ...dateRange, end: new Date(e.target.value) })}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          title="תאריך סיום"
        />
        <input
          ref={startInputRef}
          type="date"
          value={dateRange.start.toISOString().split("T")[0]}
          onChange={(e) => onChange({ ...dateRange, start: new Date(e.target.value) })}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          title="תאריך התחלה"
        />
      </div>
    );
  }

  return (
    <div className="relative" dir="rtl">
      {/* Date Display - Clickable to open dropdown */}
      <button
        type="button"
        onClick={toggleDropdown}
        className={`inline-flex items-center border border-[#4C526B] rounded-[7px] px-3 py-2 sm:px-[8px] sm:py-[5px] cursor-pointer hover:border-[#29318A] transition-colors touch-manipulation min-h-[44px] sm:min-h-0 ${className}`}
      >
        <svg width="14" height="14" viewBox="0 0 32 32" fill="none" className="text-[#4C526B] ml-1 sm:w-3 sm:h-3">
          <path d="M10 13L16 19L22 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="text-[15px] sm:text-[14px] text-white leading-[1.4] ltr-num">
          {formatDate(dateRange.end)}
        </span>
        <span className="text-[15px] sm:text-[14px] text-white leading-[1.4] mx-1">-</span>
        <span className="text-[15px] sm:text-[14px] text-white leading-[1.4] ltr-num">
          {formatDate(dateRange.start)}
        </span>
      </button>

      {/* Hidden date inputs for manual date picking */}
      <input
        ref={endInputRef}
        type="date"
        value={dateRange.end.toISOString().split("T")[0]}
        onChange={(e) => {
          onChange({ ...dateRange, end: new Date(e.target.value) });
          setIsDropdownOpen(false);
        }}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        title="תאריך סיום"
      />
      <input
        ref={startInputRef}
        type="date"
        value={dateRange.start.toISOString().split("T")[0]}
        onChange={(e) => {
          onChange({ ...dateRange, start: new Date(e.target.value) });
          setIsDropdownOpen(false);
        }}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        title="תאריך התחלה"
      />

      {/* Dropdown Menu */}
      {isDropdownOpen && (
        <>
          {/* Overlay to close dropdown */}
          <div
            className="fixed inset-0 z-[100]"
            onClick={() => setIsDropdownOpen(false)}
          />

          {/* Dropdown content - same width as button */}
          <div className="absolute top-full left-0 right-0 mt-[5px] bg-[#0F1535] border-2 border-[#29318A] rounded-[10px] p-[5px] z-[101] flex flex-col gap-[1px]">
            {/* Quick options */}
            <button
              type="button"
              onClick={selectYesterday}
              className="text-[14px] text-white text-center leading-[1.2] py-[4px] hover:bg-[#29318A]/30 rounded-[5px] transition-colors"
            >
              אתמול
            </button>

            <button
              type="button"
              onClick={selectCurrentMonth}
              className="text-[14px] text-white text-center leading-[1.2] py-[4px] hover:bg-[#29318A]/30 rounded-[5px] transition-colors"
            >
              חודש נוכחי
            </button>

            <button
              type="button"
              onClick={selectLastMonth}
              className="text-[14px] text-white text-center leading-[1.2] py-[4px] hover:bg-[#29318A]/30 rounded-[5px] transition-colors"
            >
              חודש שעבר
            </button>

            {/* Divider */}
            <div className="border-t border-[#29318A]/50 my-[3px]" />

            {/* Month/Year Selection in one row */}
            <div className="flex items-center justify-center gap-[4px]">
              {/* Month */}
              <Select
                value={selectedMonth || "__none__"}
                onValueChange={(val) => handleMonthSelect(val === "__none__" ? "" : val)}
              >
                <SelectTrigger className="bg-transparent text-[12px] text-white text-center py-[3px] border-none h-auto min-h-0 px-[2px] w-auto gap-1">
                  <SelectValue placeholder="חודש" />
                </SelectTrigger>
                <SelectContent>
                  {hebrewMonths.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-white/50 text-[10px]">/</span>
              {/* Year */}
              <Select
                value={selectedYear || "__none__"}
                onValueChange={(val) => handleYearSelect(val === "__none__" ? "" : val)}
              >
                <SelectTrigger className="bg-transparent text-[12px] text-white text-center py-[3px] border-none h-auto min-h-0 px-[2px] w-auto gap-1">
                  <SelectValue placeholder="שנה" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Divider */}
            <div className="border-t border-[#29318A]/50 my-[3px]" />

            {/* Custom date range */}
            <div className="flex flex-col gap-[2px]">
              <span className="text-[12px] text-white text-center leading-[1.2]">טווח חופשי</span>
              <div className="flex items-center justify-center gap-[6px]">
                <button
                  type="button"
                  onClick={openStartPicker}
                  className="text-[11px] text-white/80 hover:text-white transition-colors"
                >
                  מתאריך
                </button>
                <span className="text-white/50 text-[11px]">-</span>
                <button
                  type="button"
                  onClick={openEndPicker}
                  className="text-[11px] text-white/80 hover:text-white transition-colors"
                >
                  עד תאריך
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
