"use client";

import { useState } from "react";
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

  const displayValue = value
    ? new Date(value + "T00:00:00").toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : placeholder;

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
        <Calendar
          mode="single"
          selected={value ? new Date(value + "T00:00:00") : undefined}
          onSelect={(date) => {
            if (date) {
              const yyyy = date.getFullYear();
              const mm = String(date.getMonth() + 1).padStart(2, "0");
              const dd = String(date.getDate()).padStart(2, "0");
              onChange(`${yyyy}-${mm}-${dd}`);
              setOpen(false);
            }
          }}
          defaultMonth={value ? new Date(value + "T00:00:00") : undefined}
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
