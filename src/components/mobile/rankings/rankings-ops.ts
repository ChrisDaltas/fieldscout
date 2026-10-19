/**
 * Pure helpers for the mobile Rankings area (FieldScout Mobile "Lists and
 * Rankings" handoff — specs lr-hub.md, lr-myrank.md, lr-frame.md).
 *
 * The app's ranking model, which every screen here maps the design onto:
 *   - the user's SEASON board (the big board — "Rest of season" in season,
 *     "Pre-draft" in the offseason; the draft room reads it),
 *   - one WEEKLY board per NFL week (`big_board_weekly`), editable for this
 *     week and the next three, read-only once played.
 * Both are cross-position lists; a mobile "ranking" is one position's slice of
 * a board, edited in place inside that position's own slots.
 *
 * The hub's sources: Experts = the consensus of the app's AI expert boards,
 * Users = the cred-weighted average of users' rankings (`consensus_rankings`),
 * Scout AI = no ranking exists yet.
 */
import { tierChipClass } from '@/components/mobile/ui/tier-colors'
import type { ScoringFormat } from '@/lib/lists/ranking-publish'
import { activeWeekOf, LAST_REGULAR_WEEK, WEEKS_AHEAD } from '@/lib/rankings/week-window'

export const RANK_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const
export type RankPos = (typeof RANK_POSITIONS)[number]

/** The design's position code → the app's (`players.position`). */
export function dbPos(pos: RankPos): string {
  return pos === 'DST' ? 'DEF' : pos
}

export function fromDbPos(pos: string | null | undefined): RankPos | null {
  if (!pos) return null
  if (pos === 'DEF' || pos === 'DST') return 'DST'
  return (RANK_POSITIONS as readonly string[]).includes(pos) ? (pos as RankPos) : null
}

export function isRankPos(v: string | null | undefined): v is RankPos {
  return !!v && (RANK_POSITIONS as readonly string[]).includes(v)
}

export function rankPosLabel(pos: RankPos): string {
  return pos === 'DST' ? 'D/ST' : pos
}

/**
 * The hub's position chips (Chris, 2026-10-15, gap list #29): the ranked
 * positions plus FLEX — RB, WR and TE together, in overall order. FLEX is a
 * way to VIEW a source; a ranking is still made one position at a time, so
 * New ranking and the editor never take it.
 */
export const HUB_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'] as const
export type HubPos = (typeof HUB_POSITIONS)[number]
const FLEX_POSITIONS: readonly RankPos[] = ['RB', 'WR', 'TE']

export function isHubPos(v: string | null | undefined): v is HubPos {
  return !!v && (HUB_POSITIONS as readonly string[]).includes(v)
}

export function hubPosLabel(pos: HubPos): string {
  return pos === 'FLEX' ? 'FLEX' : rankPosLabel(pos)
}

/** The app's position codes (`players.position`) a hub chip covers. */
export function hubDbPositions(pos: HubPos): string[] {
  return pos === 'FLEX' ? FLEX_POSITIONS.map(dbPos) : [dbPos(pos)]
}

/** Is a player (by his `players.position`) in a hub chip's view? */
export function inHubPos(position: string | null | undefined, pos: HubPos): boolean {
  const p = fromDbPos(position)
  if (!p) return false
  return pos === 'FLEX' ? FLEX_POSITIONS.includes(p) : p === pos
}

/** The positions a board ranks anyone at, in chip order (QB · RB · WR · TE ·
 *  K · D/ST) — an AI expert's overall board's position chips. */
export function boardPositions(players: ReadonlyArray<{ position: string | null }>): RankPos[] {
  const has = new Set(players.map((p) => fromDbPos(p.position)))
  return RANK_POSITIONS.filter((p) => has.has(p))
}

/** A hub chip as a ranked position: itself, or `fallback` for FLEX. */
export function rankPosOr(pos: HubPos, fallback: RankPos): RankPos {
  return pos === 'FLEX' ? fallback : pos
}

/** A ranking period: the season board or one week's board. */
export type RankType = 'season' | `w${number}`

export function isRankType(v: string | null | undefined): v is RankType {
  if (v === 'season') return true
  if (!v || !/^w\d{1,2}$/.test(v)) return false
  const n = Number(v.slice(1))
  return n >= 1 && n <= 18
}

export function weekOf(type: RankType): number {
  return type === 'season' ? 0 : Number(type.slice(1))
}

/** Current NFL week as the app treats it: 0 (offseason) → week 1 is active. */
export { activeWeekOf } from '@/lib/rankings/week-window'

/** The season board's name: "Pre-draft" in the offseason, "Rest of season" in season. */
export function seasonLabel(currentWeek: number): 'Pre-draft' | 'Rest of season' {
  return currentWeek === 0 ? 'Pre-draft' : 'Rest of season'
}

export function typeLabel(type: RankType, currentWeek: number): string {
  return type === 'season' ? seasonLabel(currentWeek) : `Week ${weekOf(type)}`
}

export function rankingTitle(type: RankType, pos: RankPos, currentWeek: number): string {
  return `${typeLabel(type, currentWeek)} · ${rankPosLabel(pos)}`
}

// The rankable-week window is shared with desktop (`@/lib/rankings/week-window`).
export { LAST_REGULAR_WEEK, WEEKS_AHEAD } from '@/lib/rankings/week-window'

/** The weeks a ranking can be made or edited for right now: this week and
 *  the next three, capped at the regular season's last week. */
export function rankableWeeks(currentWeek: number): number[] {
  const active = activeWeekOf(currentWeek)
  const last = Math.min(active + WEEKS_AHEAD, LAST_REGULAR_WEEK)
  const out: number[] = []
  for (let w = active; w <= last; w++) out.push(w)
  return out
}

/** When a locked week becomes rankable: three weeks before it ("Opens in
 *  Week N", the handoff's N = week − 3). */
export { opensInWeek } from '@/lib/rankings/week-window'

/**
 * Past (read-only, Finalized), current (this week), upcoming (one of the
 * next three weeks — editable like this week) or future (locked, never
 * fetched). Opening an upcoming week never creates its board; only Publish
 * does.
 */
export function weekStatus(
  type: RankType,
  currentWeek: number,
): 'season' | 'past' | 'current' | 'upcoming' | 'future' {
  if (type === 'season') return 'season'
  const w = weekOf(type)
  const active = activeWeekOf(currentWeek)
  if (w < active) return 'past'
  if (w === active) return 'current'
  return w <= Math.min(active + WEEKS_AHEAD, LAST_REGULAR_WEEK) ? 'upcoming' : 'future'
}

/**
 * A ranking's status on the phone (Chris, 2026-10-15): Published — the
 * app's one saved state, which is the ranking that counts — or Finalized, a
 * played week. There is no "saved but not published" or draft state.
 */
export type RankStatus = 'Finalized' | 'Published'

/** A stored ranking's status: Finalized once its week is played, else
 *  Published (Publish is the only way to store one). */
export function rankingStatus(type: RankType, currentWeek: number): RankStatus {
  return weekStatus(type, currentWeek) === 'past' ? 'Finalized' : 'Published'
}

// ---------------------------------------------------------------------------
// Tiers (handoff `breaks`, lr-frame §2.13.8) — ported as specified. The hub
// cuts tiers from each source's scores; nothing stores them.
// ---------------------------------------------------------------------------

/**
 * Indices that START a new tier (a break before item i), given scores in the
 * order shown (no sort). A break needs gap > 1.55 × mean gap, at least 2
 * players in the tier so far, and fewer than 7 breaks (≤ 8 tiers).
 */
export function tierBreaks(scores: readonly number[]): number[] {
  const n = scores.length
  if (n < 2) return []
  const gaps: number[] = []
  for (let i = 0; i < n - 1; i++) gaps.push(scores[i]! - scores[i + 1]!)
  const mean = gaps.reduce((a, b) => a + b, 0) / Math.max(1, n - 1)
  const out: number[] = []
  let last = 0
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i]! > mean * 1.55 && i + 1 - last >= 2 && out.length < 7) {
      out.push(i + 1)
      last = i + 1
    }
  }
  return out
}

/** The "Tier N" chip for a 1-based tier — desktop's palette, the same colour
 *  for the same tier number as Lists and desktop (gap list #10). */
export function tierChipClassFor(tier: number): string {
  return tierChipClass(tier - 1)
}

// ---------------------------------------------------------------------------
// Sources: the AI experts' consensus and the comparison rules (lr-hub §3.4, §5.4)
// ---------------------------------------------------------------------------

/** One AI expert's order at a position (player ids, best first). */
export interface ExpertOrder {
  expert: string
  players: readonly string[]
}

export interface ConsensusRow {
  id: string
  /** Mean rank across every expert (an unranked player counts one past
   *  that expert's last spot). Lower is better. */
  mean: number
  /** The ranks of the experts who did rank him (best first not implied). */
  ranks: number[]
}

/**
 * The Experts source: the experts' average rank, like the handoff's ECR
 * ("Consensus of 5 experts" = the mean of the five expert scores). Ties go
 * to the player more experts ranked, then the id (stable).
 */
export function expertConsensus(orders: readonly ExpertOrder[]): ConsensusRow[] {
  const ranks = new Map<string, number[]>()
  for (const o of orders) {
    o.players.forEach((id, i) => {
      const arr = ranks.get(id) ?? []
      arr.push(i + 1)
      ranks.set(id, arr)
    })
  }
  const rows: ConsensusRow[] = []
  for (const [id, own] of ranks) {
    let sum = 0
    for (const o of orders) {
      const i = o.players.indexOf(id)
      sum += i >= 0 ? i + 1 : o.players.length + 1
    }
    rows.push({ id, mean: sum / Math.max(1, orders.length), ranks: own })
  }
  rows.sort((a, b) => a.mean - b.mean || b.ranks.length - a.ranks.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return rows
}

export interface ExpertSpread {
  best: number
  worst: number
  /** Population standard deviation of the expert ranks. */
  sd: number
}

export function expertSpread(ranks: readonly number[]): ExpertSpread | null {
  if (ranks.length === 0) return null
  const mean = ranks.reduce((a, b) => a + b, 0) / ranks.length
  const sd = Math.sqrt(ranks.reduce((a, r) => a + (r - mean) ** 2, 0) / ranks.length)
  return { best: Math.min(...ranks), worst: Math.max(...ranks), sd }
}

/** The breakdown's agreement note (lr-hub §5.4), copy as designed except
 *  the design's "has him within two spots", which misreads for a D/ST and
 *  is gendered for everyone: the note names the player instead, like the
 *  "disagree" line does (gap list §4 item 16). */
export function agreementNote(short: string, s: ExpertSpread): string {
  if (s.sd > 2.2) {
    return `Experts disagree on ${short}. Range #${s.best} to #${s.worst} is wider than most at this tier.`
  }
  if (s.worst - s.best <= 2) return `Experts mostly agree. Every expert has ${short} within two spots.`
  return `Experts mostly agree. Range #${s.best} to #${s.worst}.`
}

/** Comparison colour (lr-hub §3.4): d = other − this; |d| ≥ 3 → red when
 *  the other source ranks him lower, green when higher; else t1. */
export function cmpToneClass(other: number | null | undefined, mine: number): string {
  if (typeof other !== 'number') return 'text-m-t1'
  const d = other - mine
  if (Math.abs(d) < 3) return 'text-m-t1'
  return d > 0 ? 'text-m-red' : 'text-m-green'
}

// ---------------------------------------------------------------------------
// Names, sublines, numbers
// ---------------------------------------------------------------------------

/** "Saquon Barkley" → "S. Barkley"; team defenses stay whole. */
export function shortName(fullName: string, position?: string | null): string {
  if (position === 'DEF' || position === 'DST') return fullName
  const parts = fullName.trim().split(/\s+/)
  if (parts.length < 2) return fullName
  return `${parts[0]![0]}. ${parts.slice(1).join(' ')}`
}

export interface WeekGameLite {
  home_team: string
  away_team: string
}

/** Weekly subline from the real schedule: "PHI @ BAL", "DET vs NYG", "KC · Bye". */
export function weeklySub(team: string | null, games: readonly WeekGameLite[] | undefined): string {
  if (!team) return 'Free agent'
  if (!games || games.length === 0) return team
  const g = games.find((x) => x.home_team === team || x.away_team === team)
  if (!g) return `${team} · Bye`
  return g.home_team === team ? `${team} vs ${g.away_team}` : `${team} @ ${g.home_team}`
}

/** A weekly ranking leaves out players on bye that week (lr-myrank §5,
 *  "Source rankings"). Unknown schedule → nobody is left out. */
export function onBye(team: string | null, games: readonly WeekGameLite[] | undefined): boolean {
  if (!team || !games || games.length === 0) return false
  return !games.some((g) => g.home_team === team || g.away_team === team)
}

/** Season subline: "CIN · Bye 10" (bye omitted when unknown). */
export function seasonSub(team: string | null, bye: number | null | undefined): string {
  if (!team) return 'Free agent'
  return typeof bye === 'number' && bye > 0 ? `${team} · Bye ${bye}` : team
}

export function fmt1(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '–'
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Card / footer publish stamp: "Just now" inside a minute, else "Oct 13". */
export function formatSaved(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  if (now - t < 60_000) return 'Just now'
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** "4m ago", "5h ago", "2d ago" (the handoff's community "time" format). */
export function relativeAgo(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const mins = Math.max(0, Math.round((now - t) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

/** Info-line "updated …" (lr-hub §2.8): "updated 4 min ago" inside an hour,
 *  "updated today 9:12 AM" the same day, else "updated Oct 13". */
export function updatedLabel(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const mins = Math.max(0, Math.round((now - t) / 60_000))
  if (mins < 60) return `updated ${Math.max(1, mins)} min ago`
  const d = new Date(t)
  if (d.toDateString() === new Date(now).toDateString()) {
    return `updated today ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  }
  return `updated ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

// ---------------------------------------------------------------------------
// Publishing (Chris, 2026-10-15): one commit button, no "save without
// publishing". Publish is the app's save — a saved ranking is the one that
// counts — and Back discards anything unpublished.
// ---------------------------------------------------------------------------

export interface PublishState {
  /** A played week (Finalized). */
  readOnly: boolean
  /** The ranking doesn't exist yet (a new ranking, or a week with no board). */
  isNew: boolean
  dirty: boolean
  publishing: boolean
}

/** The editor's one commit button: "Publish" for a ranking that doesn't
 *  exist yet, "Publish updates" for one that does, "Published" (inert) when
 *  there's nothing to publish. */
export function publishButtonLabel(s: PublishState): string {
  if (s.readOnly) return 'Finalized'
  if (s.publishing) return 'Publishing…'
  if (s.isNew) return 'Publish'
  return s.dirty ? 'Publish updates' : 'Published'
}

/** The confirmation toast after a publish. */
export function publishedToast(wasNew: boolean): string {
  return wasNew ? 'Ranking published' : 'Updates published'
}

/**
 * Is a ranking published at this position? Where the draft started (the
 * experts, an AI expert's board, …) doesn't change it: starting over a
 * ranking you already have still publishes updates to it. Once you've
 * published here, that publish says (an emptied position leaves none).
 */
export function rankingExists(
  rows: ReadonlyArray<{ player: { position: string } }>,
  pos: RankPos,
  publishedHere: boolean | null,
): boolean {
  return publishedHere ?? rows.some((r) => fromDbPos(r.player.position) === pos)
}

/** Each player's rank (1-based) in an order. */
export function rankMap(seq: readonly string[]): Map<string, number> {
  return new Map(seq.map((id, i) => [id, i + 1]))
}

/** A player's movement since a baseline (+ = moved up); null when the
 *  player wasn't in it. */
export function rankDelta(start: ReadonlyMap<string, number>, id: string, rank: number): number | null {
  const s = start.get(id)
  return s === undefined ? null : s - rank
}

/** Does the draft differ from the published order? A draft started from
 *  somewhere has an empty baseline, so any players make it publishable. */
export function orderChanged(seq: readonly string[], saved: readonly string[]): boolean {
  return seq.length !== saved.length || seq.some((id, i) => id !== saved[i])
}

export interface AfterPublish {
  /** The published order — the draft's new baseline (nothing unpublished). */
  savedSeq: string[]
  /** Whether a ranking exists here now (an emptied position leaves none). */
  hasRanking: boolean
}

/** The editor's state after a successful publish of `next`. Its movement
 *  arrows then show this publish against the one before (`editorMovement`). */
export function afterPublish(next: readonly string[]): AfterPublish {
  return { savedSeq: [...next], hasRanking: next.length > 0 }
}

/** What Back does: with unpublished changes it asks first ("Discard
 *  changes?"), without them it just leaves — and never mid-publish, which
 *  would leave a publish running behind a "discard". */
export function backAction(s: { dirty: boolean; publishing: boolean }): 'leave' | 'ask' | 'wait' {
  if (s.publishing) return 'wait'
  return s.dirty ? 'ask' : 'leave'
}

// ---------------------------------------------------------------------------
// Movement (Chris, 2026-10-15, gap list #33): how far each player moved
// between a ranking's CURRENT version and its PREVIOUS update. Each row keeps
// one number, the position he had before the latest publish
// (`list_players.previous_position`, migration 190); NULL = that publish
// added him. Nothing older is kept.
// ---------------------------------------------------------------------------

/** A player's movement: + = up, − = down, 0 = unmoved, or `new` (added
 *  since the previous version). A player with no entry shows nothing. */
export type Movement = number | 'new'

/**
 * Movement from one order to another. Counted among the players in BOTH, so
 * adding or dropping a player doesn't put an arrow on everyone below him — a
 * player the previous version didn't have is `new`. No previous version (an
 * empty `prev`) → no movement at all, rather than "new" on every row.
 */
export function movementBetween(prev: readonly string[], cur: readonly string[]): Map<string, Movement> {
  const out = new Map<string, Movement>()
  if (prev.length === 0) return out
  const inPrev = new Set(prev)
  const inCur = new Set(cur)
  const prevRank = new Map<string, number>()
  for (const id of prev) if (inCur.has(id) && !prevRank.has(id)) prevRank.set(id, prevRank.size + 1)
  let rank = 0
  for (const id of cur) {
    if (out.has(id)) continue
    if (!inPrev.has(id)) {
      out.set(id, 'new')
      continue
    }
    rank += 1
    out.set(id, prevRank.get(id)! - rank)
  }
  return out
}

/** A ranking's rows in their current order, each with the position it had
 *  before the latest publish (null = added by it; undefined = not read —
 *  the column isn't there yet). */
export interface PrevRow {
  id: string
  prev: number | null | undefined
}

/**
 * The previous version's order, rebuilt from the stored positions: the rows
 * that have one, by it (ties keep the current order). Null when no row has
 * one — the ranking hasn't been updated since movement was recorded, so
 * there is nothing to compare with.
 */
export function previousOrder(rows: readonly PrevRow[]): string[] | null {
  const had = rows
    .map((r, i) => ({ id: r.id, prev: r.prev, i }))
    .filter((r): r is { id: string; prev: number; i: number } => typeof r.prev === 'number')
  if (had.length === 0) return null
  return had.sort((a, b) => a.prev - b.prev || a.i - b.i).map((r) => r.id)
}

/** A published ranking's movement: its rows against its previous version. */
export function storedMovement(rows: readonly PrevRow[]): Map<string, Movement> {
  const prev = previousOrder(rows)
  return prev ? movementBetween(prev, rows.map((r) => r.id)) : new Map()
}

/**
 * The editor's movement — your own ranking, on screen. With nothing
 * unpublished it is the published ranking against its previous version (what
 * everyone else sees). With changes, it is the draft against what's
 * published — what Publish will record — so the arrows don't jump when you
 * publish. A ranking that isn't published yet has nothing to compare with.
 */
export function editorMovement(draft: readonly string[], published: readonly PrevRow[]): Map<string, Movement> {
  const pub = published.map((r) => r.id)
  if (pub.length === 0) return new Map()
  return orderChanged(draft, pub) ? movementBetween(pub, draft) : storedMovement(published)
}

/**
 * Does the editor's "Show movement" switch have anything to show? Only on a
 * published ranking, and only when there is a version to compare with: a
 * draft that changes the order (draft vs published), or a published ranking
 * that has a previous update stored. One never republished since movement
 * was recorded (or before migration 190 is pushed) has nothing, so no switch.
 */
export function editorMovementAvailable(published: readonly PrevRow[], orderDirty: boolean): boolean {
  return published.length > 0 && (orderDirty || published.some((r) => typeof r.prev === 'number'))
}

/** One AI expert's board at a position, with each row's stored previous
 *  position (`ExpertOrder` plus what movement needs). */
export interface ExpertOrderPrev extends ExpertOrder {
  prev: ReadonlyArray<number | null | undefined>
}

/**
 * The Experts consensus's movement: today's consensus against the one the
 * experts' previous versions make. An expert whose board hasn't been updated
 * since movement was recorded counts as unchanged; when none has, there is
 * no movement.
 */
export function consensusMovement(orders: readonly ExpertOrderPrev[]): Map<string, Movement> {
  let any = false
  const before: ExpertOrder[] = orders.map((o) => {
    const prev = previousOrder(o.players.map((id, i) => ({ id, prev: o.prev[i] })))
    if (prev) any = true
    return { expert: o.expert, players: prev ?? o.players }
  })
  if (!any) return new Map()
  return movementBetween(
    expertConsensus(before).map((c) => c.id),
    expertConsensus(orders).map((c) => c.id),
  )
}

/** "▲3" / "▼2" / "New"; nothing for 0. */
export function movementText(m: Movement | undefined): string {
  if (m === undefined || m === 0) return ''
  if (m === 'new') return 'New'
  return m > 0 ? `▲${m}` : `▼${-m}`
}

/** Arrows green up, red down (lr-hub §2.9); New in the accent. */
export function movementToneClass(m: Movement | undefined): string {
  if (m === 'new') return 'text-accent'
  return typeof m === 'number' && m > 0 ? 'text-m-green' : 'text-m-red'
}

// ---------------------------------------------------------------------------
// Saving a position slice of a cross-position board
// ---------------------------------------------------------------------------

export interface BoardRowLite {
  playerId: string
  /** The row's `list_players.position` (its slot in the board's order). */
  slot: number
  pos: RankPos | null
}

export interface SlicePlan {
  remove: string[]
  add: string[]
  /** Final slot for every player in the new slice, in order. */
  positions: Array<{ playerId: string; position: number }>
}

/**
 * Plan a save of one position's slice: the new order takes the slice's own
 * slots in order (surplus slots stay empty), extra players go after the
 * board's last slot. Only this position's rows are written, so every other
 * position keeps its place AND its saved date (the reorder RPC stamps
 * `updated_at` on each row it is sent).
 */
export function planSliceSave(rows: readonly BoardRowLite[], pos: RankPos, next: readonly string[]): SlicePlan {
  return planPositionsSave(rows, [pos], next)
}

/**
 * `planSliceSave` over several positions at once — a Duplicate of a ranking
 * that ranks more than one (an overall board): `next` is their players in
 * the copied ranking's own order, and it takes those positions' slots in
 * order, so the copied positions interleave as the original does while
 * every position NOT copied keeps its place and its saved date.
 */
export function planPositionsSave(
  rows: readonly BoardRowLite[],
  positions: readonly RankPos[],
  next: readonly string[],
): SlicePlan {
  const copied = new Set(positions)
  const order = Array.from(new Set(next))
  const slice = rows.filter((r) => r.pos !== null && copied.has(r.pos)).sort((a, b) => a.slot - b.slot)
  const keep = new Set(order)
  const onBoard = new Set(rows.map((r) => r.playerId))
  const slots = slice.map((r) => r.slot)
  const max = rows.reduce((m, r) => Math.max(m, r.slot), 0)
  return {
    remove: slice.filter((r) => !keep.has(r.playerId)).map((r) => r.playerId),
    add: order.filter((id) => !onBoard.has(id)),
    positions: order.map((playerId, i) => ({
      playerId,
      position: i < slots.length ? slots[i]! : max + 1 + (i - slots.length),
    })),
  }
}

/**
 * The order entries a publish sends. `isNew` = the player has no previous
 * position (the server stores NULL for him, #33): one this publish added —
 * and, on a ranking's FIRST publish (no ranking existed at the position),
 * everyone. A week's board is seeded from your latest ranking on its first
 * read, so its slots are not a previous version of this ranking: its first
 * version shows no movement at all.
 */
export function publishEntries(
  positions: ReadonlyArray<{ playerId: string; position: number }>,
  added: ReadonlySet<string>,
  firstPublish: boolean,
): Array<{ playerId: string; position: number; isNew?: true }> {
  return positions.map((p) =>
    firstPublish || added.has(p.playerId) ? { playerId: p.playerId, position: p.position, isNew: true } : { ...p },
  )
}

/** Move the item at `from` so it lands where the drop line shows: before
 *  index `to` in the CURRENT array (`to === length` = after the last). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items]
  const target = Math.max(0, Math.min(items.length, to))
  if (target === from || target === from + 1) return [...items]
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(target > from ? target - 1 : target, 0, moved!)
  return next
}

// ---------------------------------------------------------------------------
// URL state (the hub's filters and the overlay screens live in the query
// string so browser / OS Back steps through them).
// ---------------------------------------------------------------------------

/** Hub source tabs: Experts · Scout AI · Users · ADP · Auction · [an AI
 *  expert's board] · Mine (ADP and Auction: Chris, 2026-10-15, #29). */
export type SourceKey = 'experts' | 'ai' | 'users' | 'adp' | 'auction' | 'mine' | `p:${string}`

/** The tabs with the type / scoring / position filter bar. */
export const CHIP_SOURCES = ['experts', 'ai', 'users', 'adp', 'auction'] as const
export type ChipSource = (typeof CHIP_SOURCES)[number]

export function isChipSource(v: SourceKey): v is ChipSource {
  return (CHIP_SOURCES as readonly string[]).includes(v)
}

/**
 * The scoring rankings' points follow on the phone (Chris, 2026-10-15, gap
 * list #30): PPR, Half PPR, 0.25 PPR or Standard — the four differ only in
 * what a catch is worth. `std` is the URL value links already carry.
 */
export type Scoring = 'ppr' | 'half' | 'quarter' | 'std'

/** The scoring menu, in order. */
export const RANK_SCORINGS: ReadonlyArray<{ key: Scoring; label: string }> = [
  { key: 'ppr', label: 'PPR' },
  { key: 'half', label: 'Half PPR' },
  { key: 'quarter', label: '0.25 PPR' },
  { key: 'std', label: 'Standard' },
]

export function isScoring(v: string | null | undefined): v is Scoring {
  return RANK_SCORINGS.some((s) => s.key === v)
}

export function scoringLabel(s: Scoring): string {
  return RANK_SCORINGS.find((o) => o.key === s)?.label ?? 'PPR'
}

/** The scoring a ranking is saved with (`lists.scoring_format`, migration
 *  190 — the values Community filters on). */
export function scoringFormatOf(s: Scoring): ScoringFormat {
  return s === 'std' ? 'standard' : s
}

/** A saved scoring as the phone's; null when none is saved (or the column
 *  isn't there yet) or it's outside the vocabulary. */
export function scoringFromFormat(v: unknown): Scoring | null {
  if (v === 'standard') return 'std'
  return v === 'ppr' || v === 'half' || v === 'quarter' ? v : null
}

/** A ranking's scoring when none is chosen: Half PPR (Chris, 2026-10-16 —
 *  "if no scoring type is selected, default to half point ppr"). */
export const DEFAULT_RANK_SCORING: Scoring = 'half'

/** The scoring a ranking is made for in the editor: the one picked there,
 *  else the board's saved one, else Half PPR. The Rankings screen's own
 *  scoring filter is for reading others' rankings — it never picks yours. */
export function rankingScoring(picked: Scoring | null, saved: Scoring | null): Scoring {
  return picked ?? saved ?? DEFAULT_RANK_SCORING
}

/**
 * Is the scoring picked in the editor a change to publish on its own? Only
 * on a ranking that is already published (a new one carries its scoring in
 * its first publish), only where the board can keep one (`savable`: the
 * board is known and migration 190 is pushed), and only when the user
 * picked one that differs from the ranking's — the saved one, or Half PPR
 * when none is saved (that is what it already is). The scoring shown by
 * default never is a change. So a wrong tag can be fixed without moving a
 * player.
 */
export function scoringChanged(s: {
  picked: Scoring | null
  saved: Scoring | null
  savable: boolean
  hasRanking: boolean
}): boolean {
  return s.hasRanking && s.savable && s.picked !== null && s.picked !== (s.saved ?? DEFAULT_RANK_SCORING)
}

/** Where a new (unsaved) ranking starts from (lr-myrank §2.2 step 2). Someone
 *  else's ranking is never a start: it is Duplicated — published as yours —
 *  and the editor then opens yours (Chris, 2026-10-18/19). */
export type RankFrom = 'experts' | 'users' | 'carry' | 'blank'

export type RankOverlay =
  | { kind: 'new'; step: 1 | 2; type: RankType; pos: RankPos }
  | { kind: 'edit'; type: RankType; pos: RankPos; from: RankFrom | null }

export interface RankingsUrlState {
  /**
   * `mine` when the Mine tab is open. There is one Rankings screen (Chris,
   * 2026-10-15, gap list #28): `?view=mine` — the link Profile and Home use
   * — is simply the Mine tab's URL. Set on parse from `src`; writing reads
   * `src` only.
   */
  view: 'hub' | 'mine'
  src: SourceKey
  scoring: Scoring
  /** The hub's position chip — FLEX included; the overlays hold a ranked one. */
  pos: HubPos
  overlay: RankOverlay | null
}

const PERSONA_KEY = /^p:[\w-]+$/

function isSourceKey(v: string | null): v is SourceKey {
  return (
    v === 'mine' || (!!v && (CHIP_SOURCES as readonly string[]).includes(v)) || (!!v && PERSONA_KEY.test(v))
  )
}

export function isRankFrom(v: string | null): v is RankFrom {
  return v === 'experts' || v === 'users' || v === 'carry' || v === 'blank'
}

export function parseRankingsParams(
  sp: Pick<URLSearchParams, 'get'>,
  defaults: {
    type: RankType
    /** The position a URL that names none opens on — the one last used on
     *  this device (gap list #32); RB when nothing is remembered. */
    pos?: RankPos
  },
): RankingsUrlState {
  // `?tab=pre` is the desktop deep link Profile's ranking rows use; on a
  // phone those rows open the Mine tab (the handoff's `#mine`).
  const mineLink = sp.get('view') === 'mine' || (sp.get('tab') === 'pre' && !sp.get('src'))
  const srcRaw = sp.get('src')
  const src: SourceKey = mineLink ? 'mine' : isSourceKey(srcRaw) ? srcRaw : 'experts'
  const scoringRaw = sp.get('scoring')
  const scoring: Scoring = isScoring(scoringRaw) ? scoringRaw : 'ppr'
  const startPos: RankPos = defaults.pos ?? 'RB'
  const posRaw = sp.get('pos')
  const pos: HubPos = isHubPos(posRaw) ? posRaw : startPos

  let overlay: RankOverlay | null = null
  const nw = sp.get('new')
  const ed = sp.get('edit')
  if (ed && isRankType(ed)) {
    const ep = sp.get('ep')
    const from = sp.get('from')
    overlay = {
      kind: 'edit',
      type: ed,
      pos: isRankPos(ep) ? ep : rankPosOr(pos, startPos),
      from: isRankFrom(from) ? from : null,
    }
  } else if (nw === '1' || nw === '2') {
    const nt = sp.get('nt')
    const np = sp.get('np')
    overlay = {
      kind: 'new',
      step: nw === '2' ? 2 : 1,
      type: isRankType(nt) ? nt : defaults.type,
      pos: isRankPos(np) ? np : startPos,
    }
  }
  return { view: src === 'mine' ? 'mine' : 'hub', src, scoring, pos, overlay }
}

/**
 * The position a Rankings screen is using — the one the device remembers
 * (gap list #32): the editor's or New ranking's, else the hub chips' on the
 * tabs that have them. Mine (every position), an AI expert's board (its own
 * fixed position) and FLEX (not a position a ranking can start on) use none.
 */
export function positionInUse(s: Pick<RankingsUrlState, 'src' | 'pos' | 'overlay'>): RankPos | null {
  if (s.overlay) return s.overlay.pos
  return isChipSource(s.src) && s.pos !== 'FLEX' ? s.pos : null
}

export function toRankingsSearch(s: Omit<RankingsUrlState, 'view'>): string {
  const p = new URLSearchParams()
  // The Mine tab keeps the URL Profile and Home link to.
  if (s.src === 'mine') p.set('view', 'mine')
  else if (s.src !== 'experts') p.set('src', s.src)
  if (s.scoring !== 'ppr') p.set('scoring', s.scoring)
  // Always written: a URL without `pos` opens on the position last used
  // (gap list #32), so a screen the hub wrote keeps the one it showed.
  p.set('pos', s.pos)
  if (s.overlay?.kind === 'new') {
    p.set('new', String(s.overlay.step))
    p.set('nt', s.overlay.type)
    p.set('np', s.overlay.pos)
  } else if (s.overlay?.kind === 'edit') {
    p.set('edit', s.overlay.type)
    p.set('ep', s.overlay.pos)
    if (s.overlay.from) p.set('from', s.overlay.from)
  }
  const q = p.toString()
  return q ? `?${q}` : ''
}
