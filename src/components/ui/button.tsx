import * as React from "react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

function Button({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  variant?: string
  size?: string
}) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(
        "disabled:pointer-events-none disabled:opacity-50 outline-none",
        className
      )}
      {...props}
    />
  )
}

export { Button }
