"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

/**
 * Field Scout progress — hard-edged meter: white track with a 1px ink border,
 * near-square corners, flat accent fill (override the indicator via
 * `indicatorClassName`, e.g. `bg-brand` for brand-lime moments). No rounded
 * caps; motion is the system 200ms linear.
 */
const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    indicatorClassName?: string
  }
>(({ className, value, indicatorClassName, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-1.5 w-full overflow-hidden rounded-sm border border-ink bg-white",
      className
    )}
    value={value}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn(
        "h-full w-full flex-1 bg-accent transition-transform",
        indicatorClassName
      )}
      style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
