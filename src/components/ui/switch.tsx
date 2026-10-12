"use client"

import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

/**
 * FieldScout switch — v7 (`FSSwitch7`, size md): a 32×19 pill track with a
 * white knob. ON is the v7 green, OFF the light control grey; each darkens a
 * step on hover. The knob's small shadow is part of its shape (`shadow-knob`),
 * not elevation.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-[19px] w-8 shrink-0 cursor-pointer items-center rounded-pill bg-surface-pressed p-[2px] transition-colors hover:bg-surface-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:bg-brand data-[state=checked]:hover:bg-brand-hover",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block size-[15px] rounded-full bg-white shadow-knob transition-transform data-[state=checked]:translate-x-[13px] data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
