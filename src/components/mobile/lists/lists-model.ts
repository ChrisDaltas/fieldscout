import { buildBuckets } from '@/components/lists/v2/list-buckets'
import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import { poolPositions, type PoolPlayer } from '@/hooks/use-mobile-lists-pool'
import { COVER_COLOR_LABEL, coverColorOf, type CoverColor } from '@/lib/lists/cover-color'
import { hasTiers, rankingModeOf } from '@/lib/lists/ranking-mode'
import { DEFAULT_BUDGET } from '@/stores/list-display-store'
import {
  POSITION_FILTERS,
  TIER_VALUES,
  isTierKey,
  listTitleSchema,
  type ListBucketKey,
  type RankingMode,
} from '@/types/schemas/lists'

type PositionFilter = (typeof POSITION_FILTERS)[number]

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
// Cover colour (lr-lists §2.1/§2.2). The owner's chosen swatch wins
// (`lists.cover_color`, migration 188 — Chris, 2026-10-15); with none chosen
// the colour follows the list's position group (the 2026-08-11 ruling, in the
// design's own palette: QB red, RB blue, WR purple, default accent), so lists
// made before the swatches keep their colour.
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

/**
 * The six swatches, in the design's order (lr-lists §2.2): #0088FF accent,
 * #1D1D1F ink, #F75252 red (= pos-qb), #9D70E9 purple (= pos-wr), #5C7CE5
 * indigo (= pos-rb), #07B85A green (= confirm). Ink is the themed `m-ink`, as
 * the uploaded-image cover already is, so a black cover stays visible on the
 * dark page. `ring` is the selected swatch's outer ring in its own colour.
 */
export const COVER_SWATCHES: ReadonlyArray<{ key: CoverColor; label: string; bg: string; ring: string }> = [
  { key: 'blue', label: COVER_COLOR_LABEL.blue, bg: 'bg-accent', ring: 'ring-accent' },
  { key: 'ink', label: COVER_COLOR_LABEL.ink, bg: 'bg-m-ink', ring: 'ring-m-ink' },
  { key: 'red', label: COVER_COLOR_LABEL.red, bg: 'bg-pos-qb', ring: 'ring-pos-qb' },
  { key: 'purple', label: COVER_COLOR_LABEL.purple, bg: 'bg-pos-wr', ring: 'ring-pos-wr' },
  { key: 'indigo', label: COVER_COLOR_LABEL.indigo, bg: 'bg-pos-rb', ring: 'ring-pos-rb' },
  { key: 'green', label: COVER_COLOR_LABEL.green, bg: 'bg-confirm', ring: 'ring-confirm' },
]

const COVER_COLOR_BG = Object.fromEntries(COVER_SWATCHES.map((s) => [s.key, s.bg])) as Record<CoverColor, string>

/** A collage cover's fill: the chosen colour, else the position group's. */
export function coverBgClass(positionFilter: string | null | undefined, coverColor?: string | null): string {
  const chosen = coverColorOf({ cover_color: coverColor })
  if (chosen) return COVER_COLOR_BG[chosen]
  return (positionFilter && COVER_BG[positionFilter.toUpperCase()]) || 'bg-accent'
}

/**
 * The position group choice on New list / Edit details, in desktop's order
 * (list-form-dialog): "All" (no filter) first. Labels are the mobile ones
 * (`posLabel`: D/ST for a defence).
 */
export const POSITION_GROUP_OPTIONS: ReadonlyArray<{ value: PositionFilter | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'QB', label: 'QB' },
  { value: 'RB', label: 'RB' },
  { value: 'WR', label: 'WR' },
  { value: 'FLEX', label: 'FLEX' },
  { value: 'TE', label: 'TE' },
  { value: 'DEF', label: 'D/ST' },
  { value: 'K', label: 'K' },
]

/** A stored `position_filter` as the choice's value ('ALL' = none). */
export function positionGroupValue(positionFilter: string | null | undefined): PositionFilter | 'ALL' {
  const upper = positionFilter?.toUpperCase()
  return (POSITION_FILTERS as readonly string[]).includes(upper ?? '') ? (upper as PositionFilter) : 'ALL'
}

// =============================================================================
// Tier colours — desktop's palette, one definition for every mobile tier
// (gap list #10): `mobile/ui/tier-colors.ts`. `index` is 0-based (Tier 1 = 0).
// =============================================================================

export { tierChipClass, tierFillClass } from '@/components/mobile/ui/tier-colors'

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
// The editor's draft (Chris, 2026-10-15, gap list #16): every edit changes a
// local copy of the list; Update writes it, Back throws it away.
// =============================================================================

/**
 * The list as the editor holds it. `entries` is a local copy of the list's
 * players — each carrying its draft tier, kept in `position` order — so the
 * editor renders it exactly as it renders a stored list (`draftItems`).
 *
 * `base` is the list the draft was made from. The user's changes are the
 * draft measured against it — never against the list as it stands later,
 * which may since have changed elsewhere (desktop, another tab, or a refetch
 * of the cached copy the editor opened on). See `planSave`.
 */
export interface ListDraft {
  title: string
  mode: RankingMode
  entries: ListPlayerWithPlayer[]
  /** Tier lines added after the last player (Add tier line). They hold no
   *  one yet, so they are nothing to save. */
  pending: number
  /** The list as it stood when the draft was made. */
  base: StoredList
}

/** The list as the server holds it (or held it, for a draft's `base`). */
export interface StoredList {
  title: string
  ranking_mode: string
  players: readonly ListPlayerWithPlayer[]
}

export function draftOf(list: StoredList): ListDraft {
  return {
    title: list.title,
    mode: list.ranking_mode as RankingMode,
    entries: byPosition(list.players),
    pending: 0,
    base: { title: list.title, ranking_mode: list.ranking_mode, players: list.players },
  }
}

export function draftItems(draft: ListDraft): EdItem[] {
  const tiersOn = hasTiers(draft.mode)
  return editorItems(draft.entries, tiersOn, tiersOn ? draft.pending : 0)
}

/**
 * The draft after an arrangement edit — a drag, a tier merge, auto tiers.
 * The players take the items' order; while Tiers is on, each segment takes
 * its letter by `planCommit`'s rule (so a drag re-letters exactly as it did
 * when the editor wrote each change at once), and the tier lines left after
 * the last player stay as pending ones.
 */
export function arrangeDraft(draft: ListDraft, items: readonly EdItem[]): ListDraft {
  const tiersOn = hasTiers(draft.mode)
  const plan = planCommit(items, draft.entries, tiersOn)
  const tierBy = new Map(plan.tiers.map((change) => [change.playerId, change.tier]))
  const players = items.filter((item): item is Extract<EdItem, { t: 'p' }> => item.t === 'p')
  const entries = players.map(({ entry }, index) => {
    const position = index + 1
    const tier = tierBy.has(entry.player_id) ? (tierBy.get(entry.player_id) ?? null) : entry.tier
    return entry.position === position && tier === entry.tier ? entry : { ...entry, position, overall_rank: position, tier }
  })
  return { ...draft, entries, pending: tiersOn ? trailingMarkers(items) : 0 }
}

/** Ranked / Tiers (independent switches — `withNumbers` / `withTiers` in
 *  `@/lib/lists/ranking-mode` pick the mode). Leaving tiers drops the pending
 *  tier lines; flipping Ranked alone keeps them. */
export function setDraftMode(draft: ListDraft, mode: RankingMode): ListDraft {
  return { ...draft, mode, pending: hasTiers(mode) ? draft.pending : 0 }
}

/**
 * Add a player from the Add players pool: to the end of the list and, on a
 * tiered list, into its last tier — the design's append.
 *
 * The entry is local until Update. Its season figures are the pool's (the
 * rows' Pts / Avg and Auto tiers read them); last season's are never shown
 * in the editor, so they are zero here — the List view re-reads the real
 * ones after Update.
 */
export function addToDraft(draft: ListDraft, player: PoolPlayer, listId: string): ListDraft {
  if (draft.entries.some((entry) => entry.player_id === player.id)) return draft
  const position = draft.entries.reduce((max, entry) => Math.max(max, entry.position), 0) + 1
  const entry: ListPlayerWithPlayer = {
    id: `draft-${player.id}`,
    list_id: listId,
    player_id: player.id,
    position,
    overall_rank: position,
    tier: hasTiers(draft.mode) ? lastTierLetter(draft.entries) : null,
    rank_in_tier: null,
    notes: null,
    slot: null,
    added_at: null,
    updated_at: null,
    player: {
      id: player.id,
      full_name: player.full_name,
      position: player.position,
      team: player.team,
      headshot_url: player.headshot_url,
      status: player.status,
    },
    stats: {
      current_pts: player.current_pts,
      current_games: player.current_games,
      last_pts: 0,
      last_games: 0,
      projected_pts: player.projected_pts,
    },
  }
  return { ...draft, entries: [...draft.entries, entry] }
}

export function removeFromDraft(draft: ListDraft, playerId: string): ListDraft {
  const entries = draft.entries.filter((entry) => entry.player_id !== playerId)
  return entries.length === draft.entries.length ? draft : { ...draft, entries }
}

// =============================================================================
// Import a ranking (lr-lists §2.6 / §3 "Import sheet"; gap list §3 #5) —
// bring in another of the user's lists, or one of their rankings, in order
// and with its tiers. Like every other edit it lands in the draft; Update
// writes it (the bulk add skips anyone already on the list).
// =============================================================================

/** One player a source holds: who, and his position (for the list's
 *  position group). */
export interface ImportPick {
  player_id: string
  position: string | null
}

export interface ImportCounts {
  /** The source's players that fit the list's position group. */
  fits: number
  /** Of those, the ones the list doesn't hold yet — what an import adds. */
  fresh: number
  /** Skipped: already in the list. */
  inList: number
  /** Skipped: outside the list's position group. */
  outside: number
}

/**
 * What importing `source` into a list holding `inList` would do. Each player
 * appears once per list (CLAUDE.md rule 1), so anyone the list already holds
 * is skipped; so is anyone outside its position group, as Add players only
 * offers the group's players. A player the source repeats counts once.
 */
export function importCounts(
  source: readonly ImportPick[],
  inList: ReadonlySet<string>,
  positionFilter: string | null | undefined,
): ImportCounts {
  const allowed = poolPositions(positionFilter)
  const seen = new Set<string>()
  const counts: ImportCounts = { fits: 0, fresh: 0, inList: 0, outside: 0 }
  for (const pick of source) {
    if (seen.has(pick.player_id)) continue
    seen.add(pick.player_id)
    if (allowed && !allowed.includes(pick.position ?? '')) {
      counts.outside += 1
      continue
    }
    counts.fits += 1
    if (inList.has(pick.player_id)) counts.inList += 1
    else counts.fresh += 1
  }
  return counts
}

/** The list's position group in words, for "aren't QB" / "No QB players". */
export function groupName(positionFilter: string | null | undefined): string | null {
  const allowed = poolPositions(positionFilter)
  if (!allowed) return null
  const labels = allowed.map((pos) => (pos === 'DEF' ? 'D/ST' : pos))
  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
}

/**
 * An import option's sub-line, and whether it can be tapped — the design's
 * `"<n> players · <status>"`, counting only the players an import can bring
 * in. An option that would bring in nobody is shown but can't be tapped, with
 * the reason ("prevent, don't refuse"; the design's "Added 0 players" is a
 * defect, lr-lists gap list).
 *
 * `counts` is null while the source's players are still loading: the line
 * then shows the source's own count and the option stays tappable (the
 * import itself checks again).
 */
export function importOptionLine(
  counts: ImportCounts | null,
  total: number,
  extra: string | null,
  positionFilter: string | null | undefined,
): { sub: string; disabled: boolean } {
  const join = (...parts: Array<string | null>) => parts.filter(Boolean).join(' · ')
  if (!counts) return { sub: join(playersLabel(total), extra), disabled: false }
  if (counts.fresh === 0) {
    const group = groupName(positionFilter)
    if (counts.fits === 0) return { sub: group ? `No ${group} players` : 'No players', disabled: true }
    return { sub: 'All already in this list', disabled: true }
  }
  if (counts.inList > 0) return { sub: join(playersLabel(counts.fits), `${counts.inList} already in this list`), disabled: false }
  return { sub: join(playersLabel(counts.fits), extra), disabled: false }
}

/**
 * The toast after an import: the design's "Added <k> players from your
 * ranking", plus what was skipped and why — never a count that hides a
 * skip.
 */
export function importToast(
  counts: ImportCounts,
  from: 'ranking' | 'list',
  positionFilter: string | null | undefined,
): { title: string; description?: string } {
  if (counts.fresh === 0) {
    const group = groupName(positionFilter)
    if (counts.fits === 0) return { title: `No ${group ? `${group} ` : ''}players in that ${from}` }
    return { title: `Everyone in that ${from} is already in this list` }
  }
  const title = `Added ${playersLabel(counts.fresh)} from your ${from}`
  const skipped: string[] = []
  if (counts.inList > 0) skipped.push(`${counts.inList} already in this list`)
  if (counts.outside > 0) skipped.push(`${counts.outside} that ${counts.outside === 1 ? 'isn’t' : 'aren’t'} ${groupName(positionFilter)}`)
  return skipped.length > 0 ? { title, description: `Skipped ${skipped.join(' and ')}.` } : { title }
}

export interface ImportResult {
  draft: ListDraft
  counts: ImportCounts
}

/**
 * The draft with a source's players brought in (lr-lists §3 "Import sheet"):
 *
 * - **In the source's order, with its tiers**: a tiered source (`sourceTiers`)
 *   keeps its Tier 1, Tier 2… as tier lines; any other source comes in as one
 *   run of players.
 * - **After the list's own players**, below a new tier line, so the import
 *   starts a tier of its own — or under the tier line the user already added
 *   at the end (the design adds a second line there, leaving an empty tier).
 * - **Each player once**: anyone the list holds, or outside its position
 *   group, is skipped (`importCounts`). Tier lines only ever sit between two
 *   imported players, so a skipped player never leaves an empty tier.
 * - **Ranked turns on**, as the design's import does; **Tiers turns on** when
 *   the import draws a tier line (the design turns it on even for a lone
 *   tier, which would only add a "Tier 1" heading). `lockMode` (a big board,
 *   whose grouping isn't the owner's to change) leaves both alone.
 * - **Six tiers at most** (`MAX_TIERS`): beyond that the last tiers merge,
 *   as every other tier edit here does (`planCommit`).
 *
 * The new players are local entries until Update, carrying the source's
 * player card and season figures (the rows' Pts / Avg, Auto tiers) but not
 * its notes — a note belongs to the list it was written in.
 *
 * With nothing to bring in, the draft is returned unchanged.
 */
export function importIntoDraft(
  draft: ListDraft,
  source: readonly ListPlayerWithPlayer[],
  opts: { listId: string; positionFilter: string | null | undefined; sourceTiers: boolean; lockMode?: boolean },
): ImportResult {
  const inList = new Set(draft.entries.map((entry) => entry.player_id))
  const counts = importCounts(
    source.map((entry) => ({ player_id: entry.player_id, position: entry.player.position })),
    inList,
    opts.positionFilter,
  )
  if (counts.fresh === 0) return { draft, counts }

  const allowed = poolPositions(opts.positionFilter)
  const taken = new Set(inList)
  const keep = (entry: ListPlayerWithPlayer) => {
    if (taken.has(entry.player_id)) return false
    if (allowed && !allowed.includes(entry.player.position ?? '')) return false
    taken.add(entry.player_id)
    return true
  }
  // The source as it reads: its tier sections in order, or one run.
  const groups = (opts.sourceTiers ? viewSections(source, true).map((s) => s.entries) : [byPosition(source)])
    .map((entries) => entries.filter(keep).map((entry) => importedEntry(entry, opts.listId)))
    .filter((entries) => entries.length > 0)

  const existing = draft.entries.length > 0
  const drawsLines = existing || groups.length > 1
  const mode = opts.lockMode ? draft.mode : rankingModeOf({ numbered: true, tiers: hasTiers(draft.mode) || drawsLines })
  const next: ListDraft = { ...draft, mode, pending: hasTiers(mode) ? draft.pending : 0 }

  if (!hasTiers(mode)) {
    const items: EdItem[] = [...draftItems(next), ...groups.flat().map((entry) => ({ t: 'p' as const, id: entry.id, entry }))]
    return { draft: arrangeDraft(next, items), counts }
  }

  // Tier lines with nobody above them (left after the players were removed)
  // would only lead with an empty tier.
  const items: EdItem[] = existing ? draftItems(next) : []
  groups.forEach((entries, index) => {
    const last = items[items.length - 1]
    if ((index > 0 || existing) && last?.t !== 'tier') items.push({ t: 'tier', id: `import-${index}`, pending: false })
    for (const entry of entries) items.push({ t: 'p', id: entry.id, entry })
  })
  return { draft: arrangeDraft(next, items), counts }
}

function importedEntry(entry: ListPlayerWithPlayer, listId: string): ListPlayerWithPlayer {
  return {
    id: `draft-${entry.player_id}`,
    list_id: listId,
    player_id: entry.player_id,
    position: entry.position,
    overall_rank: entry.position,
    // The draft's tier lines decide the letter (`arrangeDraft`).
    tier: null,
    rank_in_tier: null,
    notes: null,
    slot: null,
    added_at: null,
    updated_at: null,
    player: entry.player,
    stats: entry.stats ?? null,
  }
}

/**
 * The writes that apply the user's changes — the draft measured against its
 * `base` — to the list as `stored` holds it now, each through a route the app
 * already has:
 *
 * - `fields`: the name (when it is a valid title) and Ranked / Tiers, when
 *   the user changed them and the list doesn't already hold the change;
 * - `remove`: players the user dropped that the list still holds; `add`:
 *   players the user added that it doesn't hold yet, in draft order (the
 *   bulk add appends them in that order);
 * - `tiers`: players whose draft tier the user changed (or added) and the
 *   list holds differently (an added player is stored with none);
 * - `order`: when the user reordered, the draft's order — with anyone only
 *   the list holds (added elsewhere) after them — if it differs from what the
 *   list will hold once the removals and additions land.
 *
 * Anything changed elsewhere since the draft was made, and not by the user,
 * is left as the list has it: a player added on desktop is not removed, a
 * player removed there is not put back, a tier or name set there is not
 * reverted (lr-lists, gap list #16 review). With `stored` equal to the base —
 * the editor's "has anything changed?" — this is simply draft vs list.
 */
export interface SavePlan {
  fields: { title?: string; ranking_mode?: RankingMode }
  remove: string[]
  add: string[]
  tiers: Array<{ playerId: string; tier: ListBucketKey | null }>
  order: string[] | null
}

export function planSave(draft: ListDraft, stored: StoredList): SavePlan {
  const base = draft.base
  const baseById = new Map(base.players.map((entry) => [entry.player_id, entry]))
  const storedById = new Map(stored.players.map((entry) => [entry.player_id, entry]))
  const draftOrder = byPosition(draft.entries).map((entry) => entry.player_id)
  const inDraft = new Set(draftOrder)
  const storedOrder = byPosition(stored.players).map((entry) => entry.player_id)

  // The user's own removals and additions — only where the list still needs them.
  const remove = storedOrder.filter((id) => baseById.has(id) && !inDraft.has(id))
  const add = draftOrder.filter((id) => !baseById.has(id) && !storedById.has(id))
  const removed = new Set(remove)
  // The list's players once those land, in the order they leave it.
  const expected = [...storedOrder.filter((id) => !removed.has(id)), ...add]
  const onList = new Set(expected)

  const tiers: SavePlan['tiers'] = []
  for (const entry of byPosition(draft.entries)) {
    const id = entry.player_id
    if (!onList.has(id)) continue // removed elsewhere: nothing to tier
    const after = entry.tier ?? null
    const was = baseById.get(id)
    if (was && (was.tier ?? null) === after) continue // not the user's change
    if ((storedById.get(id)?.tier ?? null) !== after) tiers.push({ playerId: id, tier: after as ListBucketKey | null })
  }

  // Did the user move anyone? (Removals close up and additions append on
  // their own, so neither is a reorder.)
  const baseOrder = byPosition(base.players).map((entry) => entry.player_id)
  const userAdded = draftOrder.filter((id) => !baseById.has(id))
  const reordered = !sameOrder([...baseOrder.filter((id) => inDraft.has(id)), ...userAdded], draftOrder)
  let order: string[] | null = null
  if (reordered) {
    const desired = [...draftOrder.filter((id) => onList.has(id)), ...expected.filter((id) => !inDraft.has(id))]
    if (!sameOrder(desired, expected)) order = desired
  }

  const fields: SavePlan['fields'] = {}
  const title = listTitleSchema.safeParse(draft.title)
  if (title.success && title.data !== base.title && title.data !== stored.title) fields.title = title.data
  if (draft.mode !== base.ranking_mode && draft.mode !== stored.ranking_mode) fields.ranking_mode = draft.mode
  return { fields, remove, add, tiers, order }
}

/** Whether the draft holds any change of the user's (draft vs its base). */
export function draftChanged(draft: ListDraft): boolean {
  return !planIsEmpty(planSave(draft, draft.base))
}

export function planIsEmpty(plan: SavePlan): boolean {
  return (
    Object.keys(plan.fields).length === 0 &&
    plan.remove.length === 0 &&
    plan.add.length === 0 &&
    plan.tiers.length === 0 &&
    plan.order === null
  )
}

const countOf = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`

/** A plan in words, for the save-failure note: "the name", "2 added players"… */
export function planParts(plan: SavePlan): string[] {
  const parts: string[] = []
  if (plan.fields.title !== undefined) parts.push('the name')
  if (plan.fields.ranking_mode !== undefined) parts.push('Ranked / Tiers')
  if (plan.add.length > 0) parts.push(countOf(plan.add.length, 'added player'))
  if (plan.remove.length > 0) parts.push(countOf(plan.remove.length, 'removed player'))
  if (plan.tiers.length > 0) parts.push(`tiers for ${countOf(plan.tiers.length, 'player')}`)
  if (plan.order) parts.push('the order')
  return parts
}

/** The part of `attempted` that landed: what no longer appears in `remaining`. */
export function landedPlan(attempted: SavePlan, remaining: SavePlan): SavePlan {
  const left = (ids: readonly string[], rest: readonly string[]) => ids.filter((id) => !rest.includes(id))
  const tierLeft = new Set(remaining.tiers.map((change) => change.playerId))
  return {
    fields: {
      ...(attempted.fields.title !== undefined && remaining.fields.title === undefined ? { title: attempted.fields.title } : {}),
      ...(attempted.fields.ranking_mode !== undefined && remaining.fields.ranking_mode === undefined
        ? { ranking_mode: attempted.fields.ranking_mode }
        : {}),
    },
    remove: left(attempted.remove, remaining.remove),
    add: left(attempted.add, remaining.add),
    tiers: attempted.tiers.filter((change) => !tierLeft.has(change.playerId)),
    order: attempted.order && !remaining.order ? attempted.order : null,
  }
}

/** The editor's note after a failed Update: the error, then what saved and
 *  what didn't — never a partial save passed off as a whole one. */
export function saveFailureNote(error: string, attempted: SavePlan | null, remaining: SavePlan | null): string {
  if (!attempted) return `${error} Nothing was saved.`
  if (!remaining) return `${error} What saved couldn’t be checked — your changes are still here.`
  const saved = planParts(landedPlan(attempted, remaining))
  const unsaved = planParts(remaining)
  const savedText = saved.length > 0 ? `Saved: ${saved.join(', ')}.` : 'Nothing was saved.'
  const unsavedText = unsaved.length > 0 ? ` Not saved: ${unsaved.join(', ')}.` : ''
  return `${error} ${savedText}${unsavedText}`
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

// One definition, shared with the server's attach route (its oEmbed title
// lookup), so both agree on what a YouTube video link is.
export { youTubeId, youTubeThumb } from '@/utils/youtube'
