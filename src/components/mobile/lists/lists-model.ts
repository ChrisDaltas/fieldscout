import { buildBuckets } from '@/components/lists/v2/list-buckets'
import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import { DEFAULT_BUDGET } from '@/stores/list-display-store'
import { TIER_VALUES, isTierKey, type ListBucketKey } from '@/types/schemas/lists'

/**
 * FieldScout Mobile — Lists (lr-lists.md). Pure helpers: copy formats, tier
 * colours, the editor's "players + tier lines" item model and what a change
 * to it writes, the auto-tier rule, YouTube ids. No React, no fetches.
 *
 * ## Tier lines vs the app's stored tiers
 *
 * The design keeps tier *markers* between players; the app stores a tier on
 * each player (`list_players.tier`, S–F). The two map onto each other: the
 * editor renders the list's tier buckets in order with a "Tier N" line between
 * them, and a change (drag, merge, auto tiers) is written back as each
 * player's new tier letter plus the new order. Six letters means six tiers at
 * most (lr-lists gap: the design allows eight).
 */

// =============================================================================
// Copy formats (lr-lists §5)
// =============================================================================

/** "1 player" / "5 players" (the design's "1 players" is a defect). */
export function playersLabel(n: number): string {
  return `${n} ${n === 1 ? 'player' : 'players'}`
}

/** "J. Allen" — first initial + every later word; D/ST names unchanged. */
export function shortName(full: string, position?: string | null): string {
  const name = full.trim()
  if (position === 'DEF' || position === 'DST' || /D\/ST$/.test(name)) return name
  const parts = name.split(/\s+/)
  if (parts.length < 2) return name
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

/** "just now", "12m ago", "3h ago", "2d ago", then "Aug 20" / "Nov 9, 2025". */
export function updatedLabel(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.floor((now - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const date = new Date(then)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (date.getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric'
  return date.toLocaleDateString('en-US', opts)
}

// =============================================================================
// Cover colour (lr-lists §2.1 — the design's colour swatches have no column in
// the app; a list's colour follows its position group, the 2026-08-11 ruling,
// in the design's own palette: QB red, RB blue, WR purple, default accent)
// =============================================================================

const COVER_BG: Record<string, string> = {
  QB: 'bg-pos-qb',
  RB: 'bg-pos-rb',
  WR: 'bg-pos-wr',
  TE: 'bg-pos-te',
  K: 'bg-pos-k',
  DEF: 'bg-pos-def',
  FLEX: 'bg-pos-flex',
}

export function coverBgClass(positionFilter: string | null | undefined): string {
  return (positionFilter && COVER_BG[positionFilter.toUpperCase()]) || 'bg-accent'
}

// =============================================================================
// Tier colours (TIERC): blue, purple, green, gold, red, teal; Tier 7+ grey
// =============================================================================

const TIER_TEXT = [
  'text-m-pos-rb',
  'text-m-pos-wr',
  'text-positive-strong',
  'text-m-pos-te',
  'text-m-pos-qb',
  'text-m-pos-k',
] as const
const TIER_FILL = ['bg-m-pos-rb', 'bg-m-pos-wr', 'bg-positive-strong', 'bg-m-pos-te', 'bg-m-pos-qb', 'bg-m-pos-k'] as const

/** `index` is 0-based (Tier 1 = 0). */
export function tierTextClass(index: number): string {
  return TIER_TEXT[index] ?? 'text-m-t3'
}
export function tierFillClass(index: number): string {
  return TIER_FILL[index] ?? 'bg-m-t3'
}

/** Most tiers a list can store (`TIER_VALUES`, S–F). */
export const MAX_TIERS = TIER_VALUES.length

// =============================================================================
// Display sections (List view) — buckets in tier order
// =============================================================================

export interface Section {
  /** `null` = no header (untiered list). */
  label: string | null
  /** 0-based tier index for the colour, or -1 for "Ungrouped". */
  tierIndex: number
  entries: ListPlayerWithPlayer[]
}

/** Players in array order (the API returns them by `position`). */
export function byPosition(players: readonly ListPlayerWithPlayer[]): ListPlayerWithPlayer[] {
  return [...players].sort((a, b) => a.position - b.position)
}

export function viewSections(players: readonly ListPlayerWithPlayer[], tiersOn: boolean): Section[] {
  const ordered = byPosition(players)
  if (!tiersOn) return [{ label: null, tierIndex: 0, entries: ordered }]
  const buckets = buildBuckets({ org: 'tier', entries: ordered, bandLabels: {}, budget: DEFAULT_BUDGET })
  let tier = 0
  return buckets.map((bucket) => {
    if (bucket.key === 'ungrouped') return { label: 'Ungrouped', tierIndex: -1, entries: bucket.entries }
    const index = tier
    tier += 1
    return { label: `Tier ${index + 1}`, tierIndex: index, entries: bucket.entries }
  })
}

// =============================================================================
// Editor item model
// =============================================================================

export type EdItem =
  | { t: 'p'; id: string; entry: ListPlayerWithPlayer }
  /** A tier line. `pending` = added locally and not yet holding players. */
  | { t: 'tier'; id: string; pending: boolean }
  /** The header over players with no tier letter (desktop-assigned rounds, or
   *  players added elsewhere). Not draggable, not removable. */
  | { t: 'ungrouped'; id: 'ungrouped' }

export function editorItems(
  players: readonly ListPlayerWithPlayer[],
  tiersOn: boolean,
  pendingMarkers: number,
): EdItem[] {
  const ordered = byPosition(players)
  const items: EdItem[] = []
  if (!tiersOn) {
    for (const entry of ordered) items.push({ t: 'p', id: entry.id, entry })
    return items
  }
  const sections = viewSections(ordered, true)
  let tier = 0
  for (const section of sections) {
    if (section.tierIndex === -1) {
      items.push({ t: 'ungrouped', id: 'ungrouped' })
    } else {
      if (tier > 0) items.push({ t: 'tier', id: `tier-${tier}`, pending: false })
      tier += 1
    }
    for (const entry of section.entries) items.push({ t: 'p', id: entry.id, entry })
  }
  for (let i = 0; i < pendingMarkers; i += 1) items.push({ t: 'tier', id: `pending-${i}`, pending: true })
  return items
}

/** How many tiers the items show (Tier 1 + every tier line). */
export function tierCount(items: readonly EdItem[]): number {
  return 1 + items.filter((item) => item.t === 'tier').length
}

/** Tier lines after the last player — the ones not yet holding anyone. */
export function trailingMarkers(items: readonly EdItem[]): number {
  let n = 0
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (item.t === 'p') break
    if (item.t === 'tier') n += 1
  }
  return n
}

/** Move `from` to `to` (the moved item takes index `to`). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items]
  if (from === to || from < 0 || from >= next.length) return next
  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
  return next
}

export interface CommitPlan {
  /** Player ids in their new order, or null when the order is unchanged. */
  order: string[] | null
  tiers: Array<{ playerId: string; tier: ListBucketKey | null }>
}

/**
 * What a new arrangement of the editor's items writes.
 *
 * - **Order**: the players in item order, when it differs from the stored one.
 * - **Tiers** (only while Tiers is on): every non-empty segment between tier
 *   lines takes the next letter, S first (empty tiers are skipped, so letters
 *   stay contiguous). A single tier that holds no letters writes nothing — a
 *   round key (a desktop label set) is never overwritten by a plain reorder.
 *   Players under "Ungrouped" lose a letter but keep anything else.
 */
export function planCommit(
  items: readonly EdItem[],
  stored: readonly ListPlayerWithPlayer[],
  tiersOn: boolean,
): CommitPlan {
  const players = items.filter((item): item is Extract<EdItem, { t: 'p' }> => item.t === 'p')
  const nextOrder = players.map((item) => item.entry.player_id)
  const prevOrder = byPosition(stored).map((entry) => entry.player_id)
  const order = sameOrder(prevOrder, nextOrder) ? null : nextOrder

  const tiers: CommitPlan['tiers'] = []
  if (tiersOn) {
    type Segment = { ungrouped: boolean; entries: ListPlayerWithPlayer[] }
    const segments: Segment[] = [{ ungrouped: false, entries: [] }]
    for (const item of items) {
      if (item.t === 'tier') segments.push({ ungrouped: false, entries: [] })
      else if (item.t === 'ungrouped') segments.push({ ungrouped: true, entries: [] })
      else segments[segments.length - 1].entries.push(item.entry)
    }
    const tiered = segments.filter((segment) => !segment.ungrouped && segment.entries.length > 0)
    // One tier holding no letters stays as it is (an untiered list renders as
    // Tier 1); otherwise every tier takes its letter.
    const lettered = tiered.length >= 2 || tiered.some((segment) => segment.entries.some((e) => isTierKey(e.tier)))
    if (lettered) {
      tiered.forEach((segment, index) => {
        const letter = TIER_VALUES[Math.min(index, TIER_VALUES.length - 1)]
        for (const entry of segment.entries) {
          if (letter !== (entry.tier ?? null)) tiers.push({ playerId: entry.player_id, tier: letter })
        }
      })
    }
    for (const segment of segments) {
      if (!segment.ungrouped) continue
      for (const entry of segment.entries) {
        if (isTierKey(entry.tier)) tiers.push({ playerId: entry.player_id, tier: null })
      }
    }
  }
  return { order, tiers }
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

/** The tier letter a newly added player should take so it joins the last tier
 *  (the design appends to the end of the list), or null when the list stores
 *  no tiers. */
export function lastTierLetter(players: readonly ListPlayerWithPlayer[]): ListBucketKey | null {
  let last: ListBucketKey | null = null
  for (const letter of TIER_VALUES) {
    if (players.some((entry) => entry.tier === letter)) last = letter
  }
  return last
}

// =============================================================================
// Auto tiers — the design's `breaks()` (lr-frame §2.13.8)
// =============================================================================

/**
 * Break indexes for scores in the order given: a new tier starts before item
 * i+1 when the gap is over 1.55× the mean gap, the tier already has two
 * players, and fewer than `maxBreaks` breaks exist. A non-positive mean (an
 * order running against the scores) yields no breaks rather than the
 * prototype's erratic ones.
 */
export function breaks(scores: readonly number[], maxBreaks = MAX_TIERS - 1): number[] {
  const n = scores.length
  if (n < 3) return []
  const gaps: number[] = []
  for (let i = 0; i < n - 1; i += 1) gaps.push(scores[i] - scores[i + 1])
  const mean = gaps.reduce((sum, g) => sum + g, 0) / Math.max(1, n - 1)
  if (!(mean > 0)) return []
  const out: number[] = []
  let last = 0
  for (let i = 0; i < gaps.length; i += 1) {
    if (out.length >= maxBreaks) break
    if (gaps[i] > mean * 1.55 && i + 1 - last >= 2) {
      out.push(i + 1)
      last = i + 1
    }
  }
  return out
}

/** Fill missing scores with the previous known one (the next for a leading
 *  gap) so a player without a projection adds no gap of its own. */
export function fillScores(values: ReadonlyArray<number | null | undefined>): number[] | null {
  const firstKnown = values.find((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (firstKnown === undefined) return null
  let prev = firstKnown
  return values.map((v) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      prev = v
      return v
    }
    return prev
  })
}

/**
 * Items rebuilt from the players in their current order, with tier lines at
 * the auto-tier breaks (every old line and the Ungrouped header removed).
 *
 * `null` when there is nothing to apply — no projections, or no gap clears the
 * rule (too few players, an order that runs against the projections, or no
 * big drop). The user's own tiers are then left alone rather than collapsed
 * into one, and the caller doesn't claim success (lr-lists gap 19).
 */
export function autoTierItems(items: readonly EdItem[]): EdItem[] | null {
  const players = items.filter((item): item is Extract<EdItem, { t: 'p' }> => item.t === 'p')
  const scores = fillScores(players.map((item) => item.entry.stats?.projected_pts ?? null))
  if (!scores) return null
  const cuts = new Set(breaks(scores))
  if (cuts.size === 0) return null
  const out: EdItem[] = []
  players.forEach((item, index) => {
    if (cuts.has(index)) out.push({ t: 'tier', id: `auto-${index}`, pending: false })
    out.push(item)
  })
  return out
}

// =============================================================================
// YouTube (lr-lists §3 "Link input")
// =============================================================================

const YT_HOST = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i

/**
 * The 11-character video id of a YouTube link, or null. The design's regex
 * (`youtu.be/`, `?v=`/`&v=`, `/shorts/`, `/embed/`), tightened to YouTube's
 * own hosts and widened to `/live/` (lr-lists gap 21).
 */
export function youTubeId(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (!YT_HOST.test(url.hostname)) return null
  const match = /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/.exec(url.href)
  return match ? match[1] : null
}

export function youTubeThumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}
