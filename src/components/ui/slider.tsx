"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

/**
 * Field Scout slider — 2px ink track with a flat accent range and a square
 * 13px white thumb (1px ink border, accent border on hover). No soft shadows,
 * no round caps; motion is the system 200ms linear.
 */
const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center py-1.5 data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-[2px] w-full grow bg-ink">
      <SliderPrimitive.Range className="absolute h-full bg-accent" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-[13px] w-[13px] rounded-sm border border-ink bg-white transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
