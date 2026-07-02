import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The single button primitive used everywhere in the app. Always pill-shaped.
 * Variants:
 *   - invisible — no background, foreground text. Hover lifts to a faint
 *     bg-elevated-2 surface. Use for tertiary / cancel-like actions.
 *   - default   — solid dark-grey background with white text. The neutral
 *     default for most interactive controls (filters, dropdown triggers).
 *   - primary   — solid white background with dark text. The most prominent
 *     pill style, used for top-level page CTAs.
 *   - brand     — green background with dark text. Reserved for "save" and
 *     confirmation actions.
 *   - destructive — red background. Delete / dangerous actions.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        invisible:
          "bg-transparent text-text-secondary hover:bg-bg-elevated-2 hover:text-foreground",
        default:
          "bg-bg-elevated-2 text-foreground hover:bg-bg-elevated-3",
        primary:
          "bg-foreground text-background hover:bg-foreground/90",
        brand:
          "bg-primary text-background hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        default: "h-9 px-4 text-sm",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-6 text-sm",
        icon: "h-9 w-9 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
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
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
