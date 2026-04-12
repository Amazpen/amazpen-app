"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const toLocalDateString = (date: Date) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

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
    // Use functional setState to read latest year (avoid stale closure)
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
        {/* Start → end in DOM order so RTL readers see "from X to Y"
            (first date on the right, second date on the left). */}
        <span
          onClick={openStartPicker}
          className="text-[16px] text-white/80 ltr-num cursor-pointer"
        >
          {formatDate(dateRange.start)}
        </span>
        <span className="text-[16px] text-white/60">-</span>
        <span
          onClick={openEndPicker}
          className="text-[16px] text-white/80 ltr-num cursor-pointer"
        >
          {formatDate(dateRange.end)}
        </span>
        <Input
          ref={endInputRef}
          type="date"
          value={toLocalDateString(dateRange.end)}
          onChange={(e) => onChange({ ...dateRange, end: new Date(e.target.value) })}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          title="תאריך סיום"
        />
        <Input
          ref={startInputRef}
          type="date"
          value={toLocalDateString(dateRange.start)}
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
    <div className="relative inline-block" dir="rtl">
      {/* Date Display - Clickable to open dropdown */}
      <Button
        type="button"
        variant="ghost"
        onClick={toggleDropdown}
        className={`inline-flex items-center border border-[#4C526B] rounded-[7px] px-3 py-2 sm:px-[8px] sm:py-[5px] cursor-pointer hover:border-[#29318A] transition-colors touch-manipulation min-h-[44px] sm:min-h-0 ${className}`}
      >
        <svg width="14" height="14" viewBox="0 0 32 32" fill="none" className="text-[#4C526B] ml-1 sm:w-3 sm:h-3">
          <path d="M10 13L16 19L22 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {/* Start → end in DOM order so RTL readers see "from X to Y"
            (first date on the right, second date on the left). */}
        <span className="text-[15px] sm:text-[14px] text-white leading-[1.4] ltr-num">
          {formatDate(dateRange.start)}
        </span>
        <span className="text-[15px] sm:text-[14px] text-white leading-[1.4] mx-1">-</span>
        <span className="text-[15px] sm:text-[14px] text-white leading-[1.4] ltr-num">
          {formatDate(dateRange.end)}
        </span>
      </Button>

      {/* Hidden date inputs for manual date picking */}
      <Input
        ref={endInputRef}
        type="date"
        value={toLocalDateString(dateRange.end)}
        onChange={(e) => {
          onChange({ ...dateRange, end: new Date(e.target.value) });
          setIsDropdownOpen(false);
        }}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        title="תאריך סיום"
      />
      <Input
        ref={startInputRef}
        type="date"
        value={toLocalDateString(dateRange.start)}
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
            <Button
              type="button"
              variant="ghost"
              onClick={selectYesterday}
              className="text-[14px] text-white text-center leading-[1.2] py-[4px] hover:bg-[#29318A]/30 rounded-[5px] transition-colors"
            >
              אתמול
            </Button>

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
                <SelectContent className="z-[200]">
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
                <SelectContent className="z-[200]">
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
                <Button
                  type="button"
                  variant="ghost"
                  onClick={openStartPicker}
                  className="text-[11px] text-white/80 hover:text-white transition-colors"
                >
                  מתאריך
                </Button>
                <span className="text-white/50 text-[11px]">-</span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={openEndPicker}
                  className="text-[11px] text-white/80 hover:text-white transition-colors"
                >
                  עד תאריך
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
