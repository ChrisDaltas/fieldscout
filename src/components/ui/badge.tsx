import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        // Subdued chip — the everyday label style.
        default:
          "border-transparent bg-bg-elevated-2 text-foreground",
        outline:
          "border-bg-elevated-3 bg-transparent text-text-secondary",
        destructive:
          "border-transparent bg-destructive/20 text-destructive",
        // Reserved for save/confirmation surfaces; rarely used on a badge.
        brand: "border-transparent bg-primary text-background",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
