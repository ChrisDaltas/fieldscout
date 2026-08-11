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
 * text. Button semantics with `aria-pressed`.
 *
 * **What is left here after LV.11, and why.** Chris ruled the single-select
 * chip rows onto the shared tab/segment control (*"Use the tab component for
 * now, we can create one for filters later"*), so this component is no longer
 * the app's general filter chip. It now covers exactly the two shapes a
 * segment cannot express, because a segment asserts **one item is always
 * active**:
 *
 * 1. **Multi-select** — several on at once. `lists/lists-browse.tsx` tag
 *    filters, `lists/builder/player-sidebar.tsx` positions,
 *    `lists/generate-ai-modal.tsx` ranking styles (which also carry a 1–3
 *    weight per chip), `leagues/roster-slot-builder.tsx` flex positions and IR
 *    designations.
 * 2. **Single-select where zero selected is valid** — tapping the on chip
 *    clears it and nothing is active. `layout/rail/players-panel.tsx`'s
 *    position row (clear = all positions) and `generate-ai-modal.tsx`'s
 *    optional AI-expert picker (starts with none chosen).
 *
 * Converting either of those would be a behaviour regression dressed as a
 * restyle. **Do not "finish the job" by folding them in.** The purpose-built
 * filter control Chris deferred is where they and the segment-borrowing rows
 * listed in `ui/tabs.tsx` are meant to end up together.
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
