'use client'

import { MSegmented } from '@/components/mobile/ui/m-segmented'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { PlayersView } from '@/hooks/use-mobile-players-ui'

/**
 * FieldScout Mobile — Players tab chrome (spec m-players §2.1, §2.3): the
 * sticky filter pill row with its quick-pick popover, and the list header
 * (title + count, the List / Cards / Sheet toggle, Customize).
 */

/** A 16-unit stroke icon drawn from one of the spec's own paths (`filled`
 *  also fills the shape — the favourites star when on). */
export function PathIcon({ d, size, stroke, className, filled = false }: { d: string; size: number; stroke: number; className?: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('flex-none', className)}
    >
      <path d={d} />
    </svg>
  )
}

export const CHEVRON_DOWN = 'M4 6l4 4 4-4'

// ---------------------------------------------------------------------------
// Filter bar + quick-pick popover
// ---------------------------------------------------------------------------

export interface PillOption {
  value: string
  label: string
}

export interface FilterPill {
  key: string
  /** The pill's own label (the default's name, or the chosen value). */
  label: string
  /** Filled ink when the filter is set (spec §2.1 "On" column). */
  on: boolean
  /** Popover title ("Show", "Stats for", "Position", "NFL team"). */
  title: string
  cols: number
  options: PillOption[]
  value: string
  /** Shown when the value is not the reset target. */
  canReset: boolean
  onPick: (value: string) => void
  onReset: () => void
}

/**
 * The sticky filter bar (spec §2.1): background b0, 10px top / 8px bottom
 * padding, 1px b2 divider; a sideways-scrolling row of 30px pills. The
 * popover is a MODAL Radix popover anchored to the bar: while it is open a
 * tap anywhere outside the card only closes it (spec §3 "Filter pill" — the
 * prototype's transparent full-screen backdrop), and it sits 3px under the
 * bar's divider, 12px in from each side, up to 340px tall.
 */
export function FilterBar({ pills, open, onOpenChange }: { pills: FilterPill[]; open: string | null; onOpenChange: (key: string | null) => void }) {
  const menu = pills.find((p) => p.key === open) ?? null
  return (
    <Popover open={menu !== null} onOpenChange={(o) => !o && onOpenChange(null)} modal>
      <PopoverAnchor asChild>
        <div className="border-b border-m-b2 bg-m-b0 pb-2 pt-2.5" data-players-filters>
          <div className="flex gap-1.5 overflow-x-auto px-3 scrollbar-none">
            {pills.map((p) => {
              const ring = open === p.key && !p.on
              return (
                <button
                  key={p.key}
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={open === p.key}
                  onClick={() => onOpenChange(open === p.key ? null : p.key)}
                  className={cn(
                    'flex h-[30px] flex-none items-center gap-[5px] whitespace-nowrap rounded-full pl-3 pr-2.5 text-[13px] font-semibold',
                    p.on ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1',
                    ring && 'ring-[1.5px] ring-inset ring-m-ink',
                  )}
                  data-pill={p.key}
                >
                  {p.label}
                  <PathIcon d={CHEVRON_DOWN} size={10} stroke={2.4} />
                </button>
              )
            })}
          </div>
        </div>
      </PopoverAnchor>
      {menu && (
        // A true overlay (it floats over the list), so it keeps its resting
        // shadow — the README "Menus" shadow (CLAUDE.md → Elevation).
        <PopoverContent
          side="bottom"
          align="start"
          alignOffset={12}
          sideOffset={3}
          avoidCollisions={false}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="flex max-h-[340px] flex-col gap-2.5 overflow-y-auto rounded-[16px] bg-m-b0 p-3 text-m-t1 shadow-m-menu duration-0 scrollbar-none data-[state=closed]:animate-none data-[state=open]:animate-none"
          style={{ width: 'calc(var(--radix-popover-trigger-width) - 24px)' }}
          aria-label={menu.title}
          data-pill-menu={menu.key}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-m-t3">{menu.title}</span>
            {menu.canReset && (
              <button
                type="button"
                onClick={() => {
                  menu.onReset()
                  onOpenChange(null)
                }}
                className="text-[12px] font-semibold text-accent"
              >
                Reset
              </button>
            )}
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${menu.cols}, minmax(0, 1fr))` }}>
            {menu.options.map((o) => {
              const selected = o.value === menu.value
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    menu.onPick(o.value)
                    onOpenChange(null)
                  }}
                  className={cn(
                    'flex h-9 items-center justify-center whitespace-nowrap rounded-[10px] px-2 text-[13px] font-semibold',
                    selected ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1',
                  )}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// List header
// ---------------------------------------------------------------------------

const VIEWS: ReadonlyArray<{ value: PlayersView; label: string; icon: string }> = [
  { value: 'list', label: 'List', icon: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01' },
  { value: 'cards', label: 'Stats under each player', icon: 'M2.5 3h11v4h-11zM2.5 9h11v4h-11z' },
  { value: 'sheet', label: 'Sheet', icon: 'M2.5 3h11v10h-11zM2.5 6.5h11M2.5 9.8h11M6 3v10' },
]

const SLIDERS = 'M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M10 3v3M6 10v3'

/** Spec §2.3: "{title} {count}", the three-way view toggle, Customize.
 *  `updating` marks a stats read still landing for some rows (their cells
 *  show "–" until it does — said, not left to look like data). */
export function ListHeader({
  title,
  count,
  updating = false,
  view,
  onView,
  onCustomize,
}: {
  title: string
  count: string | null
  updating?: boolean
  view: PlayersView
  onView: (v: PlayersView) => void
  onCustomize: () => void
}) {
  return (
    <div className="flex items-center gap-2 pb-1.5 pl-4 pr-3 pt-4">
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-m-t1" data-players-title>
        {title}
        {count !== null && (
          <>
            {' '}
            <span className="text-[12px] font-medium tabular-nums text-m-t3" data-players-count>
              {count}
            </span>
          </>
        )}
        {updating && (
          <span className="text-[12px] font-medium text-m-t4" role="status" data-players-updating>
            {' '}
            · Updating…
          </span>
        )}
      </span>
      <MSegmented
        label="View"
        options={VIEWS.map((v) => ({
          value: v.value,
          label: (
            <>
              <PathIcon d={v.icon} size={14} stroke={1.7} />
              <span className="sr-only">{v.label}</span>
            </>
          ),
        }))}
        value={view}
        onChange={onView}
        className="flex-none gap-0 rounded-full"
        itemClassName="h-[26px] w-8 rounded-full"
      />
      <button
        type="button"
        onClick={onCustomize}
        className="flex h-[30px] flex-none items-center gap-[5px] rounded-full bg-m-b2 px-2.5 text-[12px] font-semibold text-m-t1"
      >
        <PathIcon d={SLIDERS} size={13} stroke={1.7} />
        Customize
      </button>
    </div>
  )
}

/** Compact notice line under the filters (waiver window, stale data …) —
 *  the app's status banners in the mobile language, with an optional
 *  "Try again" for a failed read. */
export function Notice({
  children,
  tone = 'neutral',
  action,
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'caution' | 'negative'
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div
      className={cn(
        'mx-3 mt-2.5 flex items-center gap-3 rounded-[12px] px-3 py-2 text-[12px] font-medium leading-[1.4]',
        tone === 'caution' ? 'bg-m-go text-m-to' : tone === 'negative' ? 'bg-m-gr text-m-tr' : 'bg-m-b1 text-m-t3',
      )}
      role={tone === 'neutral' ? undefined : 'alert'}
    >
      <p className="min-w-0 flex-1">{children}</p>
      {action && (
        <button type="button" onClick={action.onClick} className="flex-none text-[12px] font-semibold underline underline-offset-2">
          {action.label}
        </button>
      )}
    </div>
  )
}

/** Loading rows (design-language skeletons: rounded 14px b1). */
export function RowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 px-3 pt-2" data-skeleton="players">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-[52px] animate-pulse rounded-[14px] bg-m-b1" />
      ))}
    </div>
  )
}

/** Error with a retry, centred (extends the design's empty-state type). */
export function ProblemState({ title, detail, onRetry }: { title: string; detail?: string | null; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-8 py-10 text-center" role="alert">
      <p className="text-[15px] font-semibold text-m-t1">{title}</p>
      {detail && <p className="text-[13px] font-medium text-m-t3">{detail}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-1 h-9 rounded-full bg-m-b2 px-4 text-[13px] font-semibold text-m-t1 active:bg-m-b2h">
          Try again
        </button>
      )}
    </div>
  )
}

/** "Show more" — the next page of rows (the prototype caps at 40). */
export function ShowMore({ remaining, onMore }: { remaining: number; onMore: () => void }) {
  if (remaining <= 0) return null
  return (
    <div className="flex justify-center pb-5">
      <button type="button" onClick={onMore} className="h-9 rounded-full bg-m-b2 px-4 text-[13px] font-semibold text-m-t1 active:bg-m-b2h">
        Show {Math.min(remaining, 40)} more
      </button>
    </div>
  )
}
