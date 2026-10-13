"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"

import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

/**
 * Field Scout checkbox — 16px square, 1px ink border, near-square corners.
 * Hover previews the accent border; checked fills accent blue with a white
 * check (product override: checkboxes carry the marine accent, not green).
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer size-[14px] shrink-0 rounded-sm border-0 bg-white shadow-ring-control transition-colors hover:shadow-ring-control-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground data-[state=checked]:shadow-none",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Icon name="check" size={10} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
