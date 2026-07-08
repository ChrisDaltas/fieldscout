import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Field Scout button — 1px ink border, near-square corners, press physics.
 *
 * Hover escalation by richness: ghost (text only) gains a background; stroke
 * (outline) inverts to solid ink; filled variants (blue/green/lime/dark) lift
 * up-left onto a hard shadow. With `shadow`, the button rests on a hard
 * shadow, lifts further on hover, and presses flat on click.
 *
 * Canonical variants: blue ("do a thing" primary), stroke, ghost, dark,
 * green (start/confirm), lime (brand-strong). Legacy aliases kept for
 * pre-reskin call sites: primary→blue, default→stroke, invisible→ghost,
 * brand→green.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-ink font-bold leading-none transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        blue: "bg-accent text-accent-foreground hover:bg-accent-strong hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4 active:translate-x-0 active:translate-y-0 active:shadow-none",
        stroke: "bg-transparent text-ink hover:bg-ink hover:text-white",
        ghost:
          "border-transparent bg-transparent text-ink hover:bg-n-4 hover:text-accent",
        dark: "bg-ink text-white hover:bg-ink-2 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3.2px_3.2px_0_#3d5cff] active:translate-x-0 active:translate-y-0 active:shadow-none",
        green:
          "bg-positive text-ink hover:brightness-[0.94] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4 active:translate-x-0 active:translate-y-0 active:shadow-none",
        lime: "bg-brand-strong text-ink hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4 active:translate-x-0 active:translate-y-0 active:shadow-none",
        destructive:
          "bg-negative text-ink hover:brightness-[0.94] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4 active:translate-x-0 active:translate-y-0 active:shadow-none",
        // Legacy aliases (pre-reskin call sites)
        primary:
          "bg-accent text-accent-foreground hover:bg-accent-strong hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4 active:translate-x-0 active:translate-y-0 active:shadow-none",
        default: "bg-transparent text-ink hover:bg-ink hover:text-white",
        brand:
          "bg-positive text-ink hover:brightness-[0.94] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4 active:translate-x-0 active:translate-y-0 active:shadow-none",
        invisible:
          "border-transparent bg-transparent text-ink hover:bg-n-4 hover:text-accent",
      },
      size: {
        default: "h-btn px-4 text-[14px] [&_svg]:size-[14px]",
        md: "h-btn-md px-3 text-[11px] [&_svg]:size-[13px]",
        sm: "h-btn-sm px-3 text-[11px] [&_svg]:size-[13px]",
        lg: "h-btn px-5 text-[14px] [&_svg]:size-[14px]",
        icon: "h-btn w-btn px-0 [&_svg]:size-[14px]",
        "icon-md": "h-btn-md w-btn-md px-0 [&_svg]:size-[13px]",
        "icon-sm": "h-btn-sm w-btn-sm px-0 [&_svg]:size-[13px]",
      },
      /** Resting hard shadow — "liftable/pressable". Ink fills take the
       *  accent shadow (an ink shadow disappears into the fill). */
      shadow: {
        true: "shadow-hard-4 hover:shadow-hard-6 hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-[3.2px] active:translate-y-[3.2px] active:shadow-none",
      },
    },
    compoundVariants: [
      {
        variant: "dark",
        shadow: true,
        className:
          "shadow-[3.2px_3.2px_0_#3d5cff] hover:shadow-[4.8px_4.8px_0_#3d5cff] active:shadow-none",
      },
    ],
    defaultVariants: {
      variant: "stroke",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, shadow, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, shadow, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
