import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * FieldScout button — v7 (`FSButton7`): a pill with no border, semibold
 * label, colour change on hover and a gentle press (`scale .97`).
 *
 * v7 variants → names here (old names kept so call sites don't churn):
 *
 * | v7 | here | look |
 * | --- | --- | --- |
 * | primary | `blue` (alias `primary`) | blue fill |
 * | strong | `dark` | ink fill |
 * | secondary | `stroke` (alias `default`) | light grey fill |
 * | quiet | `ghost` (alias `invisible`) | no fill until hover |
 * | confirm | `green` (aliases `brand`, `lime`) | green fill |
 * | warning | `warning` | orange fill, ink text |
 * | destructive | `destructive` | red text, pink wash on hover |
 *
 * **No variant is elevated at rest** (CLAUDE.md → "Elevation"); v7 buttons
 * don't lift at all. `shadow` is kept as a no-op so existing call sites
 * compile — v7 marks a page's primary action by variant, not by a lift.
 */
const PRESS = "active:scale-[0.97]"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-pill font-semibold leading-none transition-[background-color,color,transform] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        blue: `bg-accent text-accent-foreground hover:bg-accent-strong ${PRESS}`,
        stroke: `bg-surface-control text-ink hover:bg-surface-pressed ${PRESS}`,
        ghost: `bg-transparent text-ink hover:bg-surface-hover ${PRESS}`,
        dark: `bg-ink text-white hover:bg-ink-2 ${PRESS}`,
        green: `bg-confirm text-white hover:bg-confirm-hover ${PRESS}`,
        lime: `bg-confirm text-white hover:bg-confirm-hover ${PRESS}`,
        warning: `bg-warn text-ink hover:bg-warn-hover ${PRESS}`,
        destructive: `bg-transparent text-negative-strong hover:bg-negative-soft ${PRESS}`,
        // Legacy aliases (pre-reskin call sites)
        primary: `bg-accent text-accent-foreground hover:bg-accent-strong ${PRESS}`,
        default: `bg-surface-control text-ink hover:bg-surface-pressed ${PRESS}`,
        brand: `bg-confirm text-white hover:bg-confirm-hover ${PRESS}`,
        invisible: `bg-transparent text-ink hover:bg-surface-hover ${PRESS}`,
      },
      // v7 sizes: sm 24 / md 27 / lg 34 (text 10 / 11 / 13, icon 11 / 12 / 14).
      size: {
        default: "h-btn px-[17px] text-[13px] [&_svg]:size-[14px]",
        md: "h-btn-md px-3 text-[11px] [&_svg]:size-[12px]",
        sm: "h-btn-sm px-[9px] text-[10px] [&_svg]:size-[11px]",
        lg: "h-btn px-[17px] text-[13px] [&_svg]:size-[14px]",
        icon: "h-btn w-btn px-0 [&_svg]:size-[18px]",
        "icon-md": "h-btn-md w-btn-md px-0 [&_svg]:size-[15px]",
        "icon-sm": "h-btn-sm w-btn-sm px-0 [&_svg]:size-[14px]",
      },
      /** Kept for call-site compatibility; v7 has no emphasis lift. */
      shadow: {
        true: "",
      },
    },
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
