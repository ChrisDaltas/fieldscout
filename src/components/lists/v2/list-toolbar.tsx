'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  LIST_VIEWS,
  MAX_BUDGET,
  MIN_BUDGET,
  type ListOrg,
  type ListView,
} from '@/stores/list-display-store'

import { ORG_OPTIONS } from './list-buckets'
import { STAT_CATALOG } from './list-stats'

/**
 * Lists v2 — the detail toolbar.
 *
 * `screens/list-rail-list-view.png`: a **bare select** for grouping on the far
 * left (no border, no fill, bold, doubling as the heading for the body below),
 * then the icon-only view-style segment, `Stats N`, and `Add players` pushed
 * right in accent blue.
 *
 * **The handoff's critical note is honoured by construction:** every resting /
 * hover / active colour here is a Tailwind class, not an inline `style`. An
 * inline `background` outranks `:hover` and silently kills it — which is how
 * the segmented control lost its hover state in the prototype.
 */

const VIEW_META: Record<ListView, { label: string; icon: 'list' | 'table' | 'layers' }> = {
  list: { label: 'List', icon: 'list' },
  table: { label: 'Table', icon: 'table' },
  card: { label: 'Cards', icon: 'layers' },
}

interface ListToolbarProps {
  org: ListOrg
  onOrgChange: (org: ListOrg) => void
  view: ListView
  onViewChange: (view: ListView) => void
  cols: readonly string[]
  onToggleCol: (statId: string) => void
  budget: number
  onBudgetChange: (budget: number) => void
  /** Budget grouping is the only place the budget itself is adjustable. */
  showBudget: boolean
  canEdit: boolean
  /**
   * The `Add players` control — passed in so it can own its own popover.
   * Omitted entirely by the public share view (LV.6): grouping, view style and
   * `Stats` are *display* state that never leaves the session (D3), so a
   * stranger keeps them; `Add players` is the one control here that writes.
   */
  onAddPlayers?: React.ReactNode
}

export function ListToolbar({
  org,
  onOrgChange,
  view,
  onViewChange,
  cols,
  onToggleCol,
  budget,
  onBudgetChange,
  showBudget,
  canEdit,
  onAddPlayers,
}: ListToolbarProps) {
  const activeOrg = ORG_OPTIONS.find((option) => option.id === org) ?? ORG_OPTIONS[0]

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-btn-sm shrink-0 items-center gap-1 whitespace-nowrap pr-1 text-[16px] font-bold text-ink transition-colors hover:text-n-3"
          >
            {activeOrg.label}
            <Icon name="arrow-bottom" size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[136px]">
          {ORG_OPTIONS.map((option) => (
            <DropdownMenuItem key={option.id} onSelect={() => onOrgChange(option.id)}>
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The **icon-only** variation of the shared control (`ui/tabs.tsx`).
          A `Segment`, not a Radix `Tabs`: it restyles the rows already on the
          page rather than swapping one panel for another, so there is no
          `tabpanel` to associate and `role="tab"` would promise one. */}
      <Segment aria-label="View style">
        {LIST_VIEWS.map((id) => {
          const meta = VIEW_META[id]
          return (
            <SegmentItem
              key={id}
              icon={meta.icon}
              active={view === id}
              title={`${meta.label} view`}
              aria-label={`${meta.label} view`}
              onClick={() => onViewChange(id)}
            />
          )
        })}
      </Segment>

      <StatsPicker cols={cols} onToggleCol={onToggleCol} />

      {showBudget && (
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-n-3">
          Budget
          <Input
            type="number"
            min={MIN_BUDGET}
            max={MAX_BUDGET}
            value={budget}
            onChange={(event) => onBudgetChange(event.target.valueAsNumber)}
            aria-label="Auction budget"
            className="h-btn-sm w-[68px] px-1.5 text-[11px]"
          />
        </label>
      )}

      {canEdit && onAddPlayers ? (
        <span className="ml-auto">{onAddPlayers}</span>
      ) : null}
    </div>
  )
}

/**
 * `Stats N` — the chosen-columns picker.
 *
 * The design's is a modal with search, groups ordered by coverage, and
 * reorderable chips. This is the same *control* over the seven stats the app
 * actually holds data for (see `list-stats.ts`); the richer catalog is its own
 * task. Chosen stats are session state (D3) and reset on reload.
 */
function StatsPicker({
  cols,
  onToggleCol,
}: {
  cols: readonly string[]
  onToggleCol: (statId: string) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="stroke" size="sm" className="shrink-0">
          <Icon name="gear" size={13} /> Stats
          <span className="fs-num ml-0.5 opacity-70">{cols.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[212px] p-0">
        <StatsCatalog cols={cols} onToggleCol={onToggleCol} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * The catalog itself, without the surface it is shown on.
 *
 * Exported at **LV.16** so the pop-out window's `gear` opens *this* picker
 * rather than a second one (D11). The window shows it in a **`Popover`**, like
 * the toolbar — anchored inside the window's frame, portalled to `<body>` at
 * `z-50`, and therefore *outside* the window's dark wrapper, which is what the
 * design LAW requires of it (it calls the surface the Stats **modal**; what is
 * normative there is "outside that wrapper … it belongs to the light page", not
 * the widget). Two surfaces, one catalog, one `toggleCol`.
 *
 * *(This paragraph said `Dialog` until **R242** measured it: the window's picker
 * renders as `[data-radix-popper-content-wrapper]`, parent `BODY`, `z-index: 50`
 * — a popover, and never a `Dialog`.)*
 */
export function StatsCatalog({
  cols,
  onToggleCol,
}: {
  cols: readonly string[]
  onToggleCol: (statId: string) => void
}) {
  return (
    <>
      <div className="border-b border-n-4 px-2.5 py-1.5">
        <span className="fs-overline text-n-3">Show stats</span>
      </div>
      <div className="py-1">
        {STAT_CATALOG.map((stat) => {
          const checked = cols.includes(stat.id)
          return (
            <button
              key={stat.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={checked}
              onClick={() => onToggleCol(stat.id)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors hover:bg-accent-soft"
            >
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
                  checked ? 'border-accent bg-accent text-accent-foreground' : 'border-ink bg-white',
                )}
              >
                {checked && <Icon name="check" size={12} />}
              </span>
              <span className="flex-1">{stat.full}</span>
              <span className="fs-num text-[10px] text-n-3">{stat.label}</span>
            </button>
          )
        })}
      </div>
      <p className="border-t border-n-4 px-2.5 py-1.5 text-[10px] font-medium leading-snug text-n-3">
        Cards view shows the first three.
      </p>
    </>
  )
}

/** Shape returned by `/api/players/builder`, narrowed to what this uses. */
interface BuilderPlayer {
  id: string
  full_name: string
  position: string | null
  team: string | null
}

/**
 * `Add players` — search the pool and add to this list.
 *
 * Uses the existing `/api/players/builder` endpoint and `useAddPlayer`, the
 * same pair today's list detail uses. No new route (plan §1).
 */
export function AddPlayersPopover({
  open,
  onOpenChange,
  addedIds,
  positionFilter,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  addedIds: Set<string>
  positionFilter: string | null | undefined
  onAdd: (player: BuilderPlayer) => void
}) {
  const [query, setQuery] = React.useState('')
  const [pool, setPool] = React.useState<BuilderPlayer[] | null>(null)
  const [failed, setFailed] = React.useState(false)
  const fetched = React.useRef(false)

  React.useEffect(() => {
    if (!open || fetched.current) return
    fetched.current = true
    const params = new URLSearchParams({ scoring: 'ppr' })
    if (positionFilter) params.set('positions', positionFilter)
    fetch(`/api/players/builder?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.json() as Promise<{ players: BuilderPlayer[] }>
      })
      .then((data) => setPool(data.players ?? []))
      // A failed fetch must not read as "no players match" — that is the
      // false-empty-state shape CLAUDE.md names outright.
      .catch(() => setFailed(true))
  }, [open, positionFilter])

  const needle = query.trim().toLowerCase()
  const matches = (pool ?? [])
    .filter((player) => !needle || player.full_name.toLowerCase().includes(needle))
    .slice(0, 8)

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="blue" size="sm" shadow>
          <Icon name="plus" size={13} /> Add players
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[268px] p-0">
        <div className="border-b border-n-4 p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search players…"
            aria-label="Search players"
            className="h-btn-sm text-[12px]"
          />
        </div>
        <div className="max-h-[240px] overflow-y-auto py-1">
          {failed && (
            <p className="px-3 py-2 text-[11px] font-semibold text-negative-strong">
              Could not load the player pool. Try again in a moment.
            </p>
          )}
          {!failed && pool === null && (
            <p className="px-3 py-2 text-[11px] font-semibold text-n-3">Loading…</p>
          )}
          {!failed && pool !== null && matches.length === 0 && (
            <p className="px-3 py-2 text-[11px] font-semibold text-n-3">No players found.</p>
          )}
          {matches.map((player) => {
            const added = addedIds.has(player.id)
            return (
              <button
                key={player.id}
                type="button"
                disabled={added}
                onClick={() => onAdd(player)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-medium transition-colors hover:bg-accent-soft disabled:opacity-45"
              >
                <span className="min-w-0 flex-1 truncate">{player.full_name}</span>
                <span className="fs-num shrink-0 text-[10px] text-n-3">
                  {player.position ?? '—'} {player.team ?? ''}
                </span>
                {added ? <Icon name="check" size={12} className="text-accent" /> : null}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
