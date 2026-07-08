import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Field Scout input — 51px tall, white fill, 1px ink border that turns
 * accent blue on focus (no ring glow). Labels above the field belong to
 * callers.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-input w-full rounded-sm border border-ink bg-white px-4 text-[14px] font-medium text-ink transition-colors file:border-0 file:bg-transparent file:text-[14px] file:font-medium file:text-ink placeholder:text-n-3 focus:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
