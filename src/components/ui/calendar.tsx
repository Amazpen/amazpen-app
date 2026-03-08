"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-4",
        month_caption: "flex justify-center pt-1 relative items-center w-full",
        caption_label: "text-sm font-medium text-white",
        nav: "flex items-center gap-1",
        button_previous: cn(
          "absolute right-1 top-0 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-[#4C526B] bg-transparent text-white hover:bg-white/10 transition-colors"
        ),
        button_next: cn(
          "absolute left-1 top-0 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-[#4C526B] bg-transparent text-white hover:bg-white/10 transition-colors"
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "text-[#7B91B0] rounded-md w-9 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-[#29318A] [&:has([aria-selected].day-outside)]:bg-[#29318A]/50 [&:has([aria-selected].day-range-end)]:rounded-l-md first:[&:has([aria-selected])]:rounded-r-md last:[&:has([aria-selected])]:rounded-l-md"
        ),
        day_button: cn(
          "h-9 w-9 p-0 font-normal text-white hover:bg-white/10 rounded-md transition-colors inline-flex items-center justify-center",
          "aria-selected:opacity-100"
        ),
        range_end: "day-range-end",
        selected:
          "bg-[#29318A] text-white hover:bg-[#3D44A0] hover:text-white focus:bg-[#29318A] focus:text-white rounded-md",
        today: "bg-white/10 text-white rounded-md",
        outside:
          "day-outside text-white/30 aria-selected:text-white/70",
        disabled: "text-white/20 opacity-50",
        range_middle:
          "aria-selected:bg-[#29318A]/50 aria-selected:text-white",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          if (orientation === "left") {
            return <ChevronRight className="h-4 w-4" />
          }
          return <ChevronLeft className="h-4 w-4" />
        },
      }}
      {...props}
    />
  )
}

Calendar.displayName = "Calendar"

export { Calendar }
