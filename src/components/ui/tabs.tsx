"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { Icon, type IconName } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

/**
 * Field Scout tabs and segmented controls — **one control, two semantics.**
 *
 * Chris, 2026-08-11: *"Could you standardize all the tab and segment UI
 * controls to the same component? The one that's being used List / Cards /
 * Side by side. There should be 3 variations of this — icons + label, label
 * only, and icon only — × count."* Before this file said so there were four
 * looks in the app at once.
 *
 * **The three variations are content, not style.** Every item takes an
 * optional `icon`, optional `children` (the label) and an optional `count`:
 *
 * | variation | props |
 * | --- | --- |
 * | icon + label | `icon="list"` + children — the page-mode control |
 * | label only | children — `My lists 7`, `List · Details · Comments 3` |
 * | icon only | `icon` + `aria-label`, no children — the view-style toggle |
 *
 * `count` is a modifier on any of them: a mono (`fs-num`) numeral set beside
 * the label at 70% of the item's own text colour, so it de-emphasises itself
 * on an accent fill and on white without a second colour rule.
 *
 * **Two wrappers, one style source.** `segmentItemVariants` is the only place
 * a colour is written, and both wrappers key off the same `data-state`
 * attribute — Radix sets it, `SegmentItem` writes it by hand:
 *
 * - **`Tabs` / `TabsList` / `TabsTrigger` / `TabsContent`** — Radix, for a
 *   genuine tab set: one `tabpanel` per trigger, roving focus, arrow keys.
 *   Reach for this whenever the panel is a sibling of the tab row.
 * - **`Segment` / `SegmentItem`** — presentational, for a mutually-exclusive
 *   picker that is *not* a tab set: no panel to associate (`role="group"` with
 *   `aria-pressed` buttons), or a tab row that cannot wrap its content because
 *   the two live in different subtrees — `PageHeader` pushes the Lists header
 *   into the app shell through a store, so a `Tabs.Root` around both is not
 *   expressible. Each item is individually focusable and fires on Enter/Space;
 *   there is deliberately no roving tabindex, because that belongs to
 *   `tablist`/`radiogroup`, not to a group of toggle buttons.
 *
 * **Frame follows role, colour never changes.** `appearance="boxed"` is the
 * joined, ink-bordered segment (`screens/list-rail-list-view.png`: the
 * List / Cards / Side by side control and the view-style toggle);
 * `appearance="bare"` is the un-framed chip row (the same screenshot's
 * `My lists 7 / Saved 2` and `List / Details / Comments 0`). Active, inactive
 * and hover are identical in both. `Segment` defaults to boxed and `TabsList`
 * to bare, because that is how the design uses them; either can opt into the
 * other.
 *
 * **Every colour here is a class, never an inline style** — the handoff's
 * critical note. An inline `background` outranks the `:hover` rule and kills
 * the hover state silently, which is how the prototype's segmented control
 * lost its own.
 */

type SegmentAppearance = "boxed" | "bare"

/**
 * `w-fit` is load-bearing, not tidying. `inline-flex` sizes to content only
 * until the group lands in a column flex parent, where `align-self: stretch`
 * blows it out to the full column width — which is exactly what happened to
 * the attach-link form's kind picker. A definite width disables cross-axis
 * stretching; `w-full` from a caller still wins through `twMerge`, which is
 * how `window-shell.tsx` keeps its equal-width tabs.
 */
const segmentGroupVariants = cva("inline-flex w-fit shrink-0 items-stretch", {
  variants: {
    appearance: {
      boxed: "border-1 border-ink bg-white",
      bare: "gap-1",
    },
  },
  defaultVariants: { appearance: "boxed" },
})

/**
 * The single source of the look. Active is an accent fill with white text —
 * accent is "do a thing", and the design's own screenshot fills every active
 * tab and segment with it. Inactive is **full-contrast ink, never grey**, and
 * hover is an `accent-soft` wash.
 */
const segmentItemVariants = cva(
  "inline-flex h-tab select-none items-center justify-center gap-1.5 whitespace-nowrap text-[11px] font-bold leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=inactive]:text-ink data-[state=inactive]:hover:bg-accent-soft",
  {
    variants: {
      appearance: {
        boxed: "border-r border-n-4 last:border-r-0 data-[state=inactive]:bg-white",
        bare: "rounded-sm data-[state=inactive]:bg-transparent",
      },
      shape: {
        label: "px-2.5",
        icon: "w-[29px] px-0",
      },
    },
    defaultVariants: { appearance: "boxed", shape: "label" },
  },
)

/**
 * The group tells its items how it is framed, so a caller sets `appearance`
 * once and cannot get a boxed item inside a bare row.
 */
const AppearanceContext = React.createContext<SegmentAppearance | undefined>(undefined)

function useAppearance(explicit: SegmentAppearance | null | undefined, fallback: SegmentAppearance) {
  const inherited = React.useContext(AppearanceContext)
  return explicit ?? inherited ?? fallback
}

/** Shared per-item content props — the three variations plus the count. */
interface SegmentContentProps {
  /** Leading glyph. On its own (no children) this is the icon-only variation. */
  icon?: IconName
  /** Optional trailing count. `null`/`undefined` renders nothing — `0` renders. */
  count?: number | null
}

function SegmentContent({
  icon,
  count,
  children,
}: SegmentContentProps & { children?: React.ReactNode }) {
  return (
    <>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
      {count == null ? null : (
        <span className="fs-num text-[10px] font-medium opacity-70">{count}</span>
      )}
    </>
  )
}

/**
 * An icon-only item has no visible label, so it must carry one for assistive
 * tech. The type makes that non-optional rather than leaving it to review.
 */
type SegmentLabelling =
  | { children: React.ReactNode; icon?: IconName }
  | { children?: undefined; icon: IconName; "aria-label": string }

// =============================================================================
// Radix — genuine tab sets (a panel per trigger, roving focus, arrow keys)
// =============================================================================

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> &
    VariantProps<typeof segmentGroupVariants>
>(({ className, appearance, ...props }, ref) => {
  const resolved = useAppearance(appearance, "bare")
  return (
    <AppearanceContext.Provider value={resolved}>
      <TabsPrimitive.List
        ref={ref}
        className={cn(segmentGroupVariants({ appearance: resolved }), className)}
        {...props}
      />
    </AppearanceContext.Provider>
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

type TabsTriggerProps = Omit<
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>,
  "children"
> &
  VariantProps<typeof segmentGroupVariants> &
  SegmentContentProps &
  SegmentLabelling

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, appearance, icon, count, children, ...props }, ref) => {
  const resolved = useAppearance(appearance, "bare")
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        segmentItemVariants({
          appearance: resolved,
          shape: children == null ? "icon" : "label",
        }),
        className,
      )}
      {...props}
    >
      <SegmentContent icon={icon} count={count}>
        {children}
      </SegmentContent>
    </TabsPrimitive.Trigger>
  )
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

// =============================================================================
// Presentational — a mutually-exclusive picker that is not a tab set
// =============================================================================

type SegmentProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof segmentGroupVariants>

const Segment = React.forwardRef<HTMLDivElement, SegmentProps>(
  ({ className, appearance, ...props }, ref) => {
    const resolved = useAppearance(appearance, "boxed")
    return (
      <AppearanceContext.Provider value={resolved}>
        <div
          ref={ref}
          role="group"
          className={cn(segmentGroupVariants({ appearance: resolved }), className)}
          {...props}
        />
      </AppearanceContext.Provider>
    )
  },
)
Segment.displayName = "Segment"

type SegmentItemProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "aria-label"
> &
  VariantProps<typeof segmentGroupVariants> &
  SegmentContentProps &
  SegmentLabelling & {
    /** Whether this item is the selected one. */
    active: boolean
  }

/**
 * `data-state` is written by hand so the one CVA above styles this button and
 * a Radix trigger identically — Radix sets the same attribute. `aria-pressed`
 * carries the state to assistive tech, which is the right role for a toggle
 * button inside a group; `aria-selected` would claim a tab set that has no
 * panels.
 */
const SegmentItem = React.forwardRef<HTMLButtonElement, SegmentItemProps>(
  ({ className, appearance, active, icon, count, children, type = "button", ...props }, ref) => {
    const resolved = useAppearance(appearance, "boxed")
    return (
      <button
        ref={ref}
        type={type}
        aria-pressed={active}
        data-state={active ? "active" : "inactive"}
        className={cn(
          segmentItemVariants({
            appearance: resolved,
            shape: children == null ? "icon" : "label",
          }),
          className,
        )}
        {...props}
      >
        <SegmentContent icon={icon} count={count}>
          {children}
        </SegmentContent>
      </button>
    )
  },
)
SegmentItem.displayName = "SegmentItem"

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Segment,
  SegmentItem,
  segmentGroupVariants,
  segmentItemVariants,
}
export type { SegmentAppearance }
