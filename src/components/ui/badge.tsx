import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Field Scout badge — 19px status/stat chip. 1px radius, 11px bold, sentence
 * case expected from callers.
 *
 * Canonical variants: stroke (ink outline), accent (ultramarine fill),
 * green/yellow/pink (football semantics: positive/caution/negative), black,
 * lime (brand fill), and soft-stroke tints (stroke-green/pink/purple = soft
 * fill + colored border). Legacy aliases kept for pre-reskin call sites:
 * default/secondary/outline→stroke, destructive→stroke-pink, brand→lime,
 * purple→accent.
 */
const badgeVariants = cva(
  "inline-flex h-chip items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-transparent px-2.5 text-[11px] font-bold leading-none text-ink transition-colors",
  {
    variants: {
      variant: {
        stroke: "border-ink bg-transparent text-ink",
        accent: "bg-accent text-accent-foreground",
        green: "bg-positive text-ink",
        yellow: "bg-caution text-ink",
        pink: "bg-negative text-ink",
        black: "bg-ink text-white",
        lime: "bg-brand text-ink",
        "stroke-green": "border-positive bg-positive-soft text-ink",
        "stroke-pink": "border-negative bg-negative-soft text-ink",
        "stroke-purple": "border-accent bg-accent-soft text-ink",
        // Legacy aliases (pre-reskin call sites)
        purple: "bg-accent text-accent-foreground",
        default: "border-ink bg-transparent text-ink",
        secondary: "border-ink bg-transparent text-ink",
        outline: "border-ink bg-transparent text-ink",
        destructive: "border-negative bg-negative-soft text-ink",
        brand: "bg-brand text-ink",
      },
    },
    defaultVariants: {
      variant: "stroke",
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

/**
 * Toggleable filter chip — the interactive sibling of the badge. 26px tall,
 * ink outline; off = white with a sunken-grey hover, on = ink fill with white
 * text (content filters select to black). Position filters override the on
 * state to the position colour via `className`. Button semantics with
 * `aria-pressed`.
 */
export interface FilterChipProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether the chip is toggled on. */
  pressed?: boolean
  /** Called with the next pressed state on click. */
  onPressedChange?: (pressed: boolean) => void
}

const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  (
    { className, pressed = false, onPressedChange, onClick, type = "button", ...props },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onPressedChange?.(!pressed)
      }}
      className={cn(
        "inline-flex h-btn-sm select-none items-center gap-1.5 whitespace-nowrap rounded-sm border border-ink px-3 text-[11px] font-bold leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40",
        pressed
          ? "bg-ink text-white hover:bg-ink-2"
          : "bg-white text-ink hover:bg-n-4",
        className,
      )}
      {...props}
    />
  ),
)
FilterChip.displayName = "FilterChip"

export { Badge, badgeVariants, FilterChip }
