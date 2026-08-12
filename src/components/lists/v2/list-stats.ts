import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import { CURRENT_SEASON, LAST_SEASON } from '@/lib/stats/aggregate-fantasy'

/**
 * Which per-player stat a list row can show.
 *
 * **This union is the retired `customize-popover.tsx`'s, moved rather than
 * rewritten (LV.7).** That file's popover had exactly one consumer — the
 * legacy detail view this task deletes — but its *type* had two, and
 * `list-display-store.ts`'s `DEFAULT_COLS` is keyed by these ids. Keeping a
 * whole component file alive to export a string union would have been the dead
 * code the cutover is meant to remove; changing the ids would have desynced the
 * store from the catalog below.
 */
export type ListRowStatKey =
  | 'proj'
  | 'current'
  | 'last'
  | 'adp'
  | 'sos'
  | 'auction'
  | 'bye'

/**
 * Lists v2 — the stat catalog the toolbar's `Stats N` picker chooses from.
 *
 * **Deliberately the *existing* seven options**, ids and all, rather than a new
 * vocabulary: `list-display-store.ts`'s `DEFAULT_COLS` already names three of
 * them (`proj`, `last`, `adp`) and treats stat ids as opaque strings, so
 * anything else would have desynced the store from its only consumer on day
 * one.
 *
 * The design's own catalog is larger and richer — searchable, grouped by how
 * much of *this* list each group covers, and carrying stats we hold no data
 * for at all (`Rostered`, `Targets`, `Target rate`, `aDOT`, `Carry share`).
 * That catalog is its own task; this is the picker over what the app can
 * actually render today. The visible consequence: the reference screenshots
 * show a `Rostered` column that no list here can produce.
 *
 * Labels follow the design's own wording — `Cost PPR` for the auction price,
 * `Proj`, `ADP`, `Bye`, `SOS` — and the two season columns carry the year.
 * `ADP` / `PPR` / `SOS` stay capitalised because they are genuine codes; every
 * other label is sentence case (CLAUDE.md, design LAW "Copy").
 */

export interface StatDef {
  id: ListRowStatKey
  /** Column header / row caption. */
  label: string
  /** Long form, shown in the picker. */
  full: string
  value: (entry: ListPlayerWithPlayer) => number | null
  format: (value: number) => string
}

const oneDecimal = (value: number) => value.toFixed(1)
const whole = (value: number) => String(Math.round(value))

export const STAT_CATALOG: readonly StatDef[] = [
  {
    id: 'adp',
    label: 'ADP',
    full: 'Average draft position',
    value: (entry) => entry.player.adp ?? null,
    format: oneDecimal,
  },
  {
    id: 'auction',
    label: 'Cost PPR',
    full: 'Auction value (PPR)',
    value: (entry) => entry.player.auction_value ?? null,
    format: (value) => `$${Math.round(value)}`,
  },
  {
    id: 'proj',
    label: 'Proj',
    full: 'Projected points',
    value: (entry) => entry.stats?.projected_pts ?? null,
    format: oneDecimal,
  },
  {
    id: 'current',
    label: String(CURRENT_SEASON),
    full: `${CURRENT_SEASON} points`,
    value: (entry) => entry.stats?.current_pts ?? null,
    format: oneDecimal,
  },
  {
    id: 'last',
    label: String(LAST_SEASON),
    full: `${LAST_SEASON} points`,
    value: (entry) => entry.stats?.last_pts ?? null,
    format: oneDecimal,
  },
  {
    id: 'bye',
    label: 'Bye',
    full: 'Bye week',
    value: (entry) => entry.player.bye_week ?? null,
    format: whole,
  },
  {
    id: 'sos',
    label: 'SOS',
    full: 'Strength of schedule',
    value: (entry) => entry.player.sos ?? null,
    format: whole,
  },
]

const BY_ID = new Map(STAT_CATALOG.map((stat) => [stat.id as string, stat]))

/** A chosen stat id, or `undefined` if the picker has never heard of it. */
export function statById(id: string): StatDef | undefined {
  return BY_ID.get(id)
}

/** The chosen ids that this catalog can actually render, in the chosen order. */
export function resolveStats(ids: readonly string[]): StatDef[] {
  return ids.map(statById).filter((stat): stat is StatDef => Boolean(stat))
}

/**
 * A player's value for one stat, already formatted.
 *
 * An em dash means "we hold no value", and it is deliberately not `0` — a
 * missing projection and a projection of zero are different facts, and only
 * one of them is a reason to fade a player down your board.
 */
export function formatStat(stat: StatDef, entry: ListPlayerWithPlayer): string {
  const value = stat.value(entry)
  return value == null || !Number.isFinite(value) ? '—' : stat.format(value)
}

/** The auction price a cost/budget grouping buckets on. `null` = unpriced. */
export function playerCost(entry: ListPlayerWithPlayer): number | null {
  const value = entry.player.auction_value
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** `4.8k` / `18.4k` — the design's view-count form. */
export function formatCount(value: number | null | undefined): string {
  const n = value ?? 0
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
}

/** `Aug 8` this year, `Nov 9, 2025` otherwise (design LAW "Copy"). */
export function formatCreated(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric'
  return date.toLocaleDateString('en-US', options)
}

/** `2h` / `5d` / a date once it stops being useful as an interval. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.floor((Date.now() - then) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return formatCreated(iso)
}
