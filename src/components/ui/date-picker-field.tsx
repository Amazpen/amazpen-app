"use client";

import { useState, useEffect } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { he } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface DatePickerFieldProps {
  value: string; // YYYY-MM-DD format
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

/**
 * Consistent date picker used across all forms.
 * Displays a Popover with Calendar (Hebrew locale).
 * Value format: YYYY-MM-DD string.
 *
 * UX:
 *   1. Popover opens with a typeable DD/MM/YYYY input above the calendar so the
 *      user can jump straight to a far-away date without clicking through months.
 *   2. Calendar uses fixedWeeks so the grid is always 6 rows tall — switching
 *      months never resizes the popover, which prevents misclicks when the
 *      user is hopping back over several months.
 */
export function DatePickerField({
  value,
  onChange,
  placeholder = "יום/חודש/שנה",
  className,
  buttonClassName,
  disabled = false,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  // Controlled "currently-displayed month" so typing a far-away date in the
  // input or clicking the prev/next chevrons stays in sync.
  const [displayMonth, setDisplayMonth] = useState<Date | undefined>(undefined);

  const valueAsDate = value ? new Date(value + "T00:00:00") : undefined;

  const displayValue = value
    ? valueAsDate!.toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : placeholder;

  // Seed the typed field from the currently selected value whenever the popover
  // opens, so the user sees the existing date already filled in (and can edit
  // just the year/month/day they want to change instead of retyping the whole
  // thing). Clearing on close keeps stale typing from leaking into the next
  // open with a different value.
  useEffect(() => {
    if (open) {
      setTyped(value ? formatToInput(valueAsDate!) : "");
      setDisplayMonth(valueAsDate ?? new Date());
    } else {
      setTyped("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commitTyped = (raw: string): boolean => {
    const parsed = parseTypedDate(raw);
    if (!parsed) return false;
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    onChange(`${yyyy}-${mm}-${dd}`);
    setDisplayMonth(parsed);
    return true;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex items-center justify-center w-full h-[50px] rounded-[10px] border border-[#4C526B] bg-transparent text-[16px] font-semibold cursor-pointer transition-colors hover:border-white/50",
            value ? "text-white" : "text-white/40",
            disabled && "opacity-50 cursor-not-allowed",
            buttonClassName,
            className
          )}
        >
          {displayValue}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 bg-[#0f1535] border-[#4C526B]"
        align="center"
      >
        {/* Manual typing row — jump straight to any date without months of
            clicking. Accepts DD/MM/YYYY or DD/MM/YY; commits on Enter or
            whenever the typed value parses successfully. */}
        <div className="border-b border-[#4C526B] px-3 py-2" dir="ltr">
          <input
            type="text"
            inputMode="numeric"
            placeholder="DD/MM/YYYY"
            value={typed}
            autoFocus
            onChange={(e) => {
              const raw = e.target.value;
              setTyped(raw);
              // Live-commit a complete date so the calendar highlight moves
              // immediately. If the parse fails (mid-typing) leave the
              // selection alone — the user will keep typing.
              const parsed = parseTypedDate(raw);
              if (parsed) commitTyped(raw);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (commitTyped(typed)) {
                  setOpen(false);
                }
                e.preventDefault();
              }
            }}
            className="w-full h-9 rounded-md bg-[#0a0e2a] border border-[#4C526B] text-white text-center text-[14px] px-2 placeholder:text-white/30 focus:outline-none focus:border-white/40"
          />
        </div>

        <Calendar
          mode="single"
          required
          selected={valueAsDate}
          onSelect={(date) => {
            // react-day-picker passes `undefined` when the user clicks the
            // already-selected day (toggle-off). For this field we never want
            // to unselect — `required` keeps the date set, and we close the
            // popover regardless so a confirming click on the same date still
            // dismisses the picker.
            if (date) {
              const yyyy = date.getFullYear();
              const mm = String(date.getMonth() + 1).padStart(2, "0");
              const dd = String(date.getDate()).padStart(2, "0");
              onChange(`${yyyy}-${mm}-${dd}`);
            }
            setOpen(false);
          }}
          month={displayMonth}
          onMonthChange={setDisplayMonth}
          fixedWeeks
          locale={he}
        />
        <div className="border-t border-[#4C526B] px-3 py-2">
          <button
            type="button"
            className="w-full text-center text-sm font-medium text-blue-400 hover:text-blue-300 hover:bg-white/5 rounded-md py-1.5 transition-colors"
            onClick={() => {
              const now = new Date();
              const yyyy = now.getFullYear();
              const mm = String(now.getMonth() + 1).padStart(2, "0");
              const dd = String(now.getDate()).padStart(2, "0");
              onChange(`${yyyy}-${mm}-${dd}`);
              setOpen(false);
            }}
          >
            היום
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatToInput(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

// Accept DD/MM/YYYY, DD/MM/YY, DD-MM-YYYY, DD.MM.YYYY. Returns a Date in local
// timezone (midnight) or null if the string isn't a complete valid date.
function parseTypedDate(raw: string): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const m = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) {
    // Two-digit year — assume 2000-2099 (this is a business app, not a
    // historical-records app, so all dates are in the current century).
    year += 2000;
  }
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  // Reject things like 31/02 that the Date constructor would silently roll
  // over into the next month.
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}
