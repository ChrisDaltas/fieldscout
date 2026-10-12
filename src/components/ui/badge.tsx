import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * FieldScout badge — v7 status pill: 18px tall, 10px semibold, no border.
 * Sentence case expected from callers.
 *
 * Variants keep their old names; v7 colours them as soft tint + same-hue
 * text, which is how v7 draws status (e.g. "Questionable", "Live").
 * stroke (neutral grey), accent (blue fill, white — counts), green / yellow /
 * pink (positive / caution / negative tints), black (ink fill), lime (live —
 * green tint), lock (D497), and the stroke-* tints, which add an inset ring
 * of the same hue. Legacy aliases: default/secondary/outline→stroke,
 * destructive→stroke-pink, brand→lime, purple→accent.
 */
const RING_GREEN = "shadow-ring-positive"
const RING_PINK = "shadow-ring-negative"
const RING_BLUE = "shadow-ring-accent"

const badgeVariants = cva(
  "inline-flex h-[18px] items-center justify-center gap-1 whitespace-nowrap rounded-pill px-[7px] text-[10px] font-semibold leading-none transition-colors",
  {
    variants: {
      variant: {
        stroke: "bg-surface-control text-n-2",
        accent: "bg-accent text-accent-foreground",
        green: "bg-positive-soft text-positive-strong",
        yellow: "bg-caution-soft text-caution-strong",
        pink: "bg-negative-soft text-negative-strong",
        black: "bg-ink text-white",
        lime: "bg-brand-soft text-brand-strong",
        // Locked player (D497): light yellow fill, dark same-hue text/glyph.
        lock: "bg-lock text-lock-fg",
        "stroke-green": `bg-positive-soft text-positive-strong ${RING_GREEN}`,
        "stroke-pink": `bg-negative-soft text-negative-strong ${RING_PINK}`,
        "stroke-purple": `bg-accent-soft text-accent-deep ${RING_BLUE}`,
        // Legacy aliases (pre-reskin call sites)
        purple: "bg-accent text-accent-foreground",
        default: "bg-surface-control text-n-2",
        secondary: "bg-surface-control text-n-2",
        outline: "bg-surface-control text-n-2",
        destructive: `bg-negative-soft text-negative-strong ${RING_PINK}`,
        brand: "bg-brand-soft text-brand-strong",
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
 * Toggleable filter chip — the interactive sibling of the badge. v7 pill,
 * 24px: off = light grey fill (darker on hover); on = blue tint, deep-blue
 * text and a 1px blue inset ring (v7's selected-source chip). Button
 * semantics with `aria-pressed`.
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
        "inline-flex h-btn-sm select-none items-center gap-1.5 whitespace-nowrap rounded-pill px-[9px] text-[11px] font-semibold leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40",
        pressed
          ? `bg-accent-soft text-accent-deep ${RING_BLUE}`
          : "bg-surface-control text-n-2 hover:bg-surface-pressed",
        className,
      )}
      {...props}
    />
  ),
)
FilterChip.displayName = "FilterChip"

export { Badge, badgeVariants, FilterChip }
