import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Field Scout card — white surface, 1px ink border, near-square corners.
 *
 * **No resting shadow, ever.** Cards sit flat; the ink border is what
 * separates them from the page. Clickable cards opt in to lift via className
 * (`transition-shadow hover:shadow-hard-4`) — and only clickable ones, since
 * a card that lifts under the cursor but does nothing on click is a lie about
 * its own affordance. There is no "hero card rests elevated" escape hatch:
 * elevation is a hover/press affordance (CLAUDE.md → "Elevation").
 */
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("rounded-sm border border-ink bg-white text-ink", className)}
    {...props}
  />
))
Card.displayName = "Card"

/** Head row: fixed-feel 58px band with a full-width ink rule beneath. */
const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex min-h-header items-center justify-between gap-2 border-b border-ink px-card-pad py-2.5",
      className
    )}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-h6 text-ink", className)} {...props} />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm font-medium text-n-3", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-card-pad", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-card-pad pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
