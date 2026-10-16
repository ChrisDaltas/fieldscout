/**
 * Pure helpers for the mobile Rankings area (FieldScout Mobile "Lists and
 * Rankings" handoff — specs lr-hub.md, lr-myrank.md, lr-frame.md).
 *
 * The app's ranking model, which every screen here maps the design onto:
 *   - the user's SEASON board (the big board — "Rest of season" in season,
 *     "Pre-draft" in the offseason; the draft room reads it),
 *   - one WEEKLY board per NFL week (`big_board_weekly`), editable only while
 *     it is the current week, read-only once played.
 * Both are cross-position lists; a mobile "ranking" is one position's slice of
 * a board, edited in place inside that position's own slots.
 *
 * The hub's sources: Experts = the consensus of the app's AI expert boards,
 * Users = the cred-weighted average of users' rankings (`consensus_rankings`),
 * Scout AI = no ranking exists yet.
 */
import { tierChipClass } from '@/components/mobile/ui/tier-colors'

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
export function activeWeekOf(currentWeek: number): number {
  return currentWeek === 0 ? 1 : currentWeek
}

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

/** Past (read-only), current (editable) or future (locked, never fetched). */
export function weekStatus(type: RankType, currentWeek: number): 'season' | 'past' | 'current' | 'future' {
  if (type === 'season') return 'season'
  const w = weekOf(type)
  const active = activeWeekOf(currentWeek)
  if (currentWeek === 0) return w === 1 ? 'current' : 'future'
  return w < active ? 'past' : w === active ? 'current' : 'future'
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

/** The breakdown's agreement note (lr-hub §5.4), copy as designed. */
export function agreementNote(short: string, s: ExpertSpread): string {
  if (s.sd > 2.2) {
    return `Experts disagree on ${short}. Range #${s.best} to #${s.worst} is wider than most at this tier.`
  }
  if (s.worst - s.best <= 2) return 'Experts mostly agree. Every expert has him within two spots.'
  return `Experts mostly agree. Range #${s.best} to #${s.worst}.`
}

/** Comparison colour (lr-hub §3.4): d = other − this; |d| ≥ 3 → red when
 *  the other source ranks him lower, green when higher; else t1. */
export function cmpToneClass(other: number | null | undefined, mine: number): string {
  if (typeof other !== 'number') return 'text-m-t1'
  const d = other - mine
  if (Math.abs(d) < 3) return 'text-m-t1'
  return d > 0 ? 'text-negative-strong' : 'text-positive-strong'
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

/** Card / footer save stamp: "Just now" inside a minute, else "Oct 13". */
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
  const order = Array.from(new Set(next))
  const slice = rows.filter((r) => r.pos === pos).sort((a, b) => a.slot - b.slot)
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

/** Hub source tabs: Experts · Scout AI · Users · [an AI expert's board] · Mine. */
export type SourceKey = 'experts' | 'ai' | 'users' | 'mine' | `p:${string}`
export type Scoring = 'ppr' | 'std'
/** Where a new (unsaved) ranking starts from (lr-myrank §2.2 step 2). */
export type RankFrom = 'experts' | 'users' | 'carry' | 'blank' | `p:${string}`

export type RankOverlay =
  | { kind: 'new'; step: 1 | 2; type: RankType; pos: RankPos }
  | { kind: 'edit'; type: RankType; pos: RankPos; from: RankFrom | null }

export interface RankingsUrlState {
  /** `mine` = the standalone "My rankings" (no source tabs). */
  view: 'hub' | 'mine'
  src: SourceKey
  scoring: Scoring
  pos: RankPos
  overlay: RankOverlay | null
}

const PERSONA_KEY = /^p:[\w-]+$/

function isSourceKey(v: string | null): v is SourceKey {
  return v === 'experts' || v === 'ai' || v === 'users' || v === 'mine' || (!!v && PERSONA_KEY.test(v))
}

export function isRankFrom(v: string | null): v is RankFrom {
  return v === 'experts' || v === 'users' || v === 'carry' || v === 'blank' || (!!v && PERSONA_KEY.test(v))
}

export function parseRankingsParams(
  sp: Pick<URLSearchParams, 'get'>,
  defaults: { type: RankType },
): RankingsUrlState {
  // `?tab=pre` is the desktop deep link Profile's ranking rows use; on a
  // phone those rows open My rankings (the handoff's `#mine`).
  const view = sp.get('view') === 'mine' || (sp.get('tab') === 'pre' && !sp.get('src')) ? 'mine' : 'hub'
  const srcRaw = sp.get('src')
  const src: SourceKey = view === 'mine' ? 'mine' : isSourceKey(srcRaw) ? srcRaw : 'experts'
  const scoring: Scoring = sp.get('scoring') === 'std' ? 'std' : 'ppr'
  const posRaw = sp.get('pos')
  const pos: RankPos = isRankPos(posRaw) ? posRaw : 'RB'

  let overlay: RankOverlay | null = null
  const nw = sp.get('new')
  const ed = sp.get('edit')
  if (ed && isRankType(ed)) {
    const ep = sp.get('ep')
    const from = sp.get('from')
    overlay = {
      kind: 'edit',
      type: ed,
      pos: isRankPos(ep) ? ep : pos,
      from: isRankFrom(from) ? from : null,
    }
  } else if (nw === '1' || nw === '2') {
    const nt = sp.get('nt')
    const np = sp.get('np')
    overlay = {
      kind: 'new',
      step: nw === '2' ? 2 : 1,
      type: isRankType(nt) ? nt : defaults.type,
      pos: isRankPos(np) ? np : 'RB',
    }
  }
  return { view, src, scoring, pos, overlay }
}

export function toRankingsSearch(s: RankingsUrlState): string {
  const p = new URLSearchParams()
  if (s.view === 'mine') p.set('view', 'mine')
  else if (s.src !== 'experts') p.set('src', s.src)
  if (s.scoring !== 'ppr') p.set('scoring', s.scoring)
  if (s.pos !== 'RB') p.set('pos', s.pos)
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
