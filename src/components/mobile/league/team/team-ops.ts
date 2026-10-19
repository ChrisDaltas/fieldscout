/**
 * FieldScout Mobile — League › Team, Team view and the trade screens: the
 * pure half (handoff spec `docs/design/mobile/m-team.md`). Formatting and
 * derivation only — every rule (lineup legality, locks, trade legality) stays
 * the app's own ops (`lineup-editor-ops.ts`, `trades-ops.ts`) and the
 * server's. Nothing here reads a clock: relative times and ages are computed
 * against an instant the caller passes (a read's own `evaluated_at`).
 */
import type { ActivityItem } from '@/lib/leagues/api/activity-service'
import type { SlotInstance, SlotRow } from '@/components/leagues/lineup-editor-ops'
import type { StandingsRow } from '@/lib/leagues/api/standings-service'
import {
  injuredStarters,
  injuryTag,
  oprkOf,
  oprkRankedCount,
  oprkTone,
  projectedTotal,
  startersOnBye,
  type Tone,
  type WeekGame,
} from '@/components/leagues/my-team-ops'
import { cardProjection, teamAvatarClass } from '@/components/mobile/league/match/match-ops'
import { positionFillClass } from '@/components/players/position-badge'
import { liveClock } from '@/utils/game-clock'

// ---------------------------------------------------------------------------
// Names and numbers
// ---------------------------------------------------------------------------

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 23rd (handoff `ord`). */
export function ord(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/** A projection with 2 decimals ("19.71"), or the en dash. */
export function proj2(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toFixed(2)
}

// ---------------------------------------------------------------------------
// Slot chips (handoff "Slot chip colours")
// ---------------------------------------------------------------------------

/** The short code a slot chip prints: "QB", "FLEX", "D/ST", "BN". */
export function slotCode(slot: Pick<SlotInstance, 'label' | 'slotKey' | 'eligible' | 'kind'>): string {
  if (slot.kind === 'start') {
    if (slot.eligible.length === 1) {
      const pos = slot.eligible[0]
      if (pos === 'DST' || pos === 'DEF') return 'D/ST'
      return pos
    }
  }
  const first = slot.label.split(/[\s(]+/)[0] ?? slot.label
  const code = first.toUpperCase()
  return code.length > 5 ? code.slice(0, 4) : code
}

/** The bench chip — a literal #EDEDF0 / #1D1D1F in both themes (handoff). */
export const BENCH_CHIP_CLASS = 'bg-surface-hover text-ink'

/** A slot chip's fill: the position's colour for a one-position seat, ink
 *  (FLEX — flips in dark) for a multi-position seat, the bench grey for IR. */
export function slotChipClass(slot: Pick<SlotInstance, 'eligible' | 'kind'>): string {
  if (slot.kind === 'ir') return BENCH_CHIP_CLASS
  if (slot.eligible.length === 1) {
    const pos = slot.eligible[0]!
    return (pos !== 'FLEX' && positionFillClass(pos)) || 'bg-m-ink text-white'
  }
  return 'bg-m-ink text-white'
}

/** "RB", "D/ST" — a player's position as the rows print it. */
export function posCode(position: string | null | undefined): string {
  if (!position) return ''
  return position === 'DEF' || position === 'DST' ? 'D/ST' : position
}

// ---------------------------------------------------------------------------
// Team avatars — the handoff's per-team colour circle (§5 TEAMS: one colour
// per team everywhere). Teams have no stored colour, so the colour is
// DERIVED by the Match tab's rule (`teamAvatarClass`, match-ops.ts) — the
// viewer's own team is always the accent blue (#0088FF) and every other team
// takes the next palette colour in league order (`detail.teams`, oldest
// first) with yours left out — so a team reads the same colour on Match,
// Standings, the Team tab, the Team view and the trade screens.
// ---------------------------------------------------------------------------

/** The league's team ids in league order — `detail.teams` as the league
 *  read returns them (created_at ascending), the order Match / League use. */
export function teamOrder(teams: ReadonlyArray<{ id: string }>): string[] {
  return teams.map((t) => t.id)
}

/** A team's avatar fill. Pass the viewer's team as `myTeamId` (null = the
 *  viewer manages no team here: nobody is blue). A caller that doesn't pass
 *  it yet (undefined) keeps this file's earlier anchor — the league's first
 *  team is the blue one — until it does. */
export function teamAvClass(teamId: string, order: readonly string[], myTeamId?: string | null): string {
  return teamAvatarClass(order, teamId, myTeamId === undefined ? (order[0] ?? null) : myTeamId)
}

/** A team avatar's letter: the first character of the name. */
export function teamInitial(name: string | null | undefined): string {
  const c = (name ?? '').trim()[0]
  return c ? c.toUpperCase() : '?'
}

// ---------------------------------------------------------------------------
// Standings lines
// ---------------------------------------------------------------------------

export function recordText(row: Pick<StandingsRow, 'wins' | 'losses' | 'ties'>): string {
  return `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ''}`
}

/** 1-based rank of a value among the rows, highest first (ties share). */
function rankBy(rows: readonly StandingsRow[], teamId: string, value: (r: StandingsRow) => number): number | null {
  const me = rows.find((r) => r.team_id === teamId)
  if (!me) return null
  return rows.filter((r) => value(r) > value(me)).length + 1
}

/** "2-6 · 11th · PF 12th · PA 10th" — PF / PA ranks once a game has been
 *  played (before that every team ties and the ranks say nothing). */
export function summaryLine(rows: readonly StandingsRow[], teamId: string): string | null {
  const me = rows.find((r) => r.team_id === teamId)
  if (!me) return null
  const parts = [recordText(me), ord(me.rank)]
  if (me.games > 0) {
    const pf = rankBy(rows, teamId, (r) => r.points_for)
    const pa = rankBy(rows, teamId, (r) => r.points_against)
    if (pf !== null) parts.push(`PF ${ord(pf)}`)
    if (pa !== null) parts.push(`PA ${ord(pa)}`)
  }
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// The game line — "Sun 1:00 PM vs DET", "Q4 6:50 @ DEN" ("OT 2:31" in
// overtime — the shared `liveClock`), "Final W 31-20 @ GB"
// ---------------------------------------------------------------------------

export interface GameLineGame {
  /** `nfl_games.id` — the game screen the line opens (gap list §3 #17). */
  id?: string
  home_team: string
  away_team: string
  kickoff_at: string
  status: string | null
  home_score: number | null
  away_score: number | null
  quarter: number | null
  game_clock: string | null
}

export type GameLine =
  | { kind: 'game'; text: string; opp: string; started: boolean; gameId: string | null }
  | { kind: 'bye'; text: 'BYE' }
  | { kind: 'unknown' }

/** Weekday + time of a stored kickoff, viewer-local ("Sun 1:00 PM"). */
export function kickoffText(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)).replace(',', '')
}

export function gameLine(nflTeam: string | null | undefined, games: readonly GameLineGame[]): GameLine {
  if (!nflTeam || games.length === 0) return { kind: 'unknown' }
  const g = games.find((x) => x.home_team === nflTeam || x.away_team === nflTeam)
  if (!g) return { kind: 'bye', text: 'BYE' }
  const home = g.home_team === nflTeam
  const opp = home ? g.away_team : g.home_team
  const where = `${home ? 'vs' : '@'} ${opp}`
  const gameId = g.id ?? null
  const mine = home ? g.home_score : g.away_score
  const theirs = home ? g.away_score : g.home_score
  if (g.status === 'final') {
    if (mine === null || theirs === null) return { kind: 'game', text: `Final ${where}`, opp, started: true, gameId }
    const wl = mine > theirs ? 'W' : mine < theirs ? 'L' : 'T'
    return { kind: 'game', text: `Final ${wl} ${mine}-${theirs} ${where}`, opp, started: true, gameId }
  }
  if (g.status === 'live') {
    return { kind: 'game', text: `${liveClock(g) ?? 'Live'} ${where}`, opp, started: true, gameId }
  }
  const k = kickoffText(g.kickoff_at)
  return { kind: 'game', text: k ? `${k} ${where}` : where, opp, started: false, gameId }
}

/** OPRK as the rows print it: "(9th)" in the band colour (red = tough). */
export function oprkSpan(
  splits: ReadonlyArray<{ defense: string; position: string; rank: number }>,
  line: GameLine,
  position: string,
): { text: string; tone: Tone } | null {
  if (line.kind !== 'game') return null
  const r = oprkOf(splits, line.opp, position)
  if (r === null) return null
  return { text: `(${ord(r)})`, tone: oprkTone(r, oprkRankedCount(splits, position)) }
}

/** The handoff's rank colours: red #FF0028, orange #FF8A00, green #07A852. */
export const TONE_TEXT: Record<Tone, string> = {
  negative: 'text-m-red',
  caution: 'text-warn',
  positive: 'text-m-green',
}

// ---------------------------------------------------------------------------
// Lineup check (gap list §3 #11) — the desktop Lineup check's rules
// (`injuredStarters`, `startersOnBye`) on the phone's Team tab. Display-only:
// the projected scores are sums of stored projections (`league_player_values`)
// shown by the Match card's rule (`cardProjection` — no partial sums), never
// a score.
// ---------------------------------------------------------------------------

export type CheckTone = 'positive' | 'caution' | 'neutral'

export interface CheckPlayer {
  id: string
  name: string
  /** "Q", "O", "IR", "PUP"… (injured starters only). */
  tag: string | null
}

export interface CheckRow {
  id: 'starters' | 'injury' | 'bye' | 'proj'
  label: string
  /** The right-hand value ("9/9", "None", "2", your projected score). */
  value: string
  /** The opponent's projected score under yours (the projection row). */
  value2: string | null
  /** One plain line under the label ("vs Dev Pro Rivals"). */
  sub: string | null
  /** Why a value reads "–" (a failed read, a missing projection). */
  note: string | null
  tone: CheckTone
  /** The starters a row names (injured / on bye). */
  players: CheckPlayer[]
}

export type CheckOpponent =
  | { kind: 'opponent'; name: string; /** null = still loading */ starterIds: readonly string[] | null; error: boolean }
  | { kind: 'bye' }
  | null

export interface MobileLineupCheckInput {
  /** The saved lineup's starting seats (the team card's arrangement). */
  starters: readonly SlotRow[]
  /** Seats held by a dropped-after-he-played starter — filled, not empty. */
  kept: ReadonlyMap<string, string>
  week: number
  games: readonly WeekGame[]
  projOf: (playerId: string) => number | null
  projections: 'pending' | 'error' | 'ready'
  /** This week's opponent; null = no matchup this week (no projection row). */
  opponent: CheckOpponent
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export function lineupCheckRows(input: MobileLineupCheckInput): CheckRow[] {
  const { starters, kept, week, games, projOf, projections, opponent } = input
  const players = starters.flatMap((r) => (r.player ? [r.player] : []))
  const filled = starters.filter((r) => r.player || kept.has(r.slot.key)).length
  const empty = starters.length - filled
  const rows: CheckRow[] = [
    {
      id: 'starters',
      label: 'Starters set',
      value: `${filled}/${starters.length}`,
      value2: null,
      sub: empty > 0 ? `${empty} ${plural(empty, 'empty slot scores', 'empty slots score')} zero` : null,
      note: null,
      tone: empty > 0 ? 'caution' : 'positive',
      players: [],
    },
  ]
  const hurt = injuredStarters(players)
  rows.push({
    id: 'injury',
    label: 'Injured',
    value: hurt.length === 0 ? 'None' : String(hurt.length),
    value2: null,
    sub: null,
    note: null,
    tone: hurt.length === 0 ? 'positive' : 'caution',
    players: hurt.map((p) => ({ id: p.player_id, name: p.full_name, tag: injuryTag(p.status) })),
  })
  const bye = startersOnBye(players, week, games)
  rows.push({
    id: 'bye',
    label: 'On bye',
    value: bye.length === 0 ? 'None' : String(bye.length),
    value2: null,
    sub: null,
    note: null,
    tone: bye.length === 0 ? 'positive' : 'caution',
    players: bye.map((p) => ({ id: p.player_id, name: p.full_name, tag: null })),
  })

  if (opponent) {
    const ready = projections === 'ready'
    // Every filled seat counts — a kept (dropped-after-he-played) starter
    // too, as the Match card's box projection does — so a whole-looking
    // total is never missing a seat.
    const myIds = starters.map((r) => r.player?.player_id ?? kept.get(r.slot.key) ?? null)
    const myFilled = myIds.filter((id) => id !== null).length
    const myTotal = ready ? projectedTotal(myIds, projOf) : null
    const mine = myTotal ? cardProjection(myTotal, myFilled) : null
    if (opponent.kind === 'bye') {
      const why = projections === 'error' ? 'Couldn’t load the projections' : null
      rows.push({ id: 'proj', label: 'Projected score', value: mine ?? '–', value2: null, sub: 'No opponent this week', note: why, tone: 'neutral', players: [] })
    } else {
      const theirIds = opponent.starterIds
      const theirTotal = ready && theirIds ? projectedTotal(theirIds, projOf) : null
      const theirs = theirTotal && theirIds ? cardProjection(theirTotal, theirIds.length) : null
      // Why a side reads "–" — never a silent blank (CLAUDE.md).
      const anyProjection = [...myIds, ...(theirIds ?? [])].some((id) => id !== null && projOf(id) !== null)
      const why =
        projections === 'error'
          ? 'Couldn’t load the projections'
          : opponent.error
            ? 'Couldn’t load their lineup'
            : !ready || !theirIds
              ? null
              : theirIds.length === 0
                ? 'Their lineup isn’t set yet'
                : (mine === null && myFilled > 0) || theirs === null
                ? anyProjection
                  ? 'Not every starter has a projection yet'
                  : 'No projections for this week yet'
                : null
      // Ahead (or level) reads green, behind reads orange — only when both
      // sides have a whole projection to compare.
      const tone: CheckTone =
        mine !== null && theirs !== null && myTotal && theirTotal ? (myTotal.total >= theirTotal.total ? 'positive' : 'caution') : 'neutral'
      rows.push({ id: 'proj', label: 'Projected score', value: mine ?? '–', value2: theirs ?? '–', sub: `vs ${opponent.name}`, note: why, tone, players: [] })
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// Moves (team view "Recent moves", "My moves")
// ---------------------------------------------------------------------------

export interface MoveRow {
  id: string
  kind: 'Added' | 'Dropped'
  playerId: string | null
  name: string
  at: string | null
}

function side(p: unknown): { id: string | null; name: string } | null {
  if (!p || typeof p !== 'object') return null
  const o = p as { name?: unknown; player_id?: unknown }
  const name = typeof o.name === 'string' && o.name !== '' ? o.name : typeof o.player_id === 'string' ? o.player_id : null
  if (!name) return null
  return { id: typeof o.player_id === 'string' ? o.player_id : null, name }
}

/** Transactions flattened to one row per add / drop (handoff `tv.moves`). */
export function moveRows(items: readonly ActivityItem[]): MoveRow[] {
  const out: MoveRow[] = []
  for (const item of items) {
    if (item.kind !== 'transaction' || item.status !== 'complete') continue
    const payload = item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload) ? (item.payload as { add?: unknown; drop?: unknown }) : null
    if (!payload) continue
    const add = side(payload.add)
    const drop = side(payload.drop)
    if (add) out.push({ id: `${item.id}:add`, kind: 'Added', playerId: add.id, name: add.name, at: item.created_at })
    if (drop) out.push({ id: `${item.id}:drop`, kind: 'Dropped', playerId: drop.id, name: drop.name, at: item.created_at })
  }
  return out
}

/** The team view's "Recent moves" (handoff §2.3 8): the newest `n`
 *  transactions that went through, one row per add / drop. A transaction
 *  that didn't complete is skipped BEFORE counting — it never takes the
 *  place of an older move. `count` is how many transactions were used. */
export function recentMoveRows(items: readonly ActivityItem[], n: number): { rows: MoveRow[]; count: number } {
  const rows: MoveRow[] = []
  let count = 0
  for (const item of items) {
    if (count >= n) break
    const r = moveRows([item])
    if (r.length === 0) continue
    rows.push(...r)
    count += 1
  }
  return { rows, count }
}

/** "Oct 10" — a stored instant's month and day, viewer-local. */
export function monthDay(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(ms))
}

// ---------------------------------------------------------------------------
// Times against a read's own instant
// ---------------------------------------------------------------------------

/** "8m", "5h", "Tue", "Sep 24" — how long before `nowIso` (the read's own
 *  `evaluated_at`) an instant was. */
export function sinceText(iso: string, nowIso: string): string {
  const at = Date.parse(iso)
  const now = Date.parse(nowIso)
  if (Number.isNaN(at)) return ''
  if (Number.isNaN(now)) return monthDay(iso)
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  if (hours < 24 * 6) return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date(at))
  return monthDay(iso)
}

/** Whole years from a birth date to an instant (the trades read's
 *  `evaluated_at`); null when either is unreadable. */
export function ageOn(birthDate: string | null | undefined, atIso: string | null | undefined): number | null {
  if (!birthDate || !atIso) return null
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate)
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(atIso)
  if (!b || !a) return null
  const [by, bm, bd] = [Number(b[1]), Number(b[2]), Number(b[3])]
  const [ay, am, ad] = [Number(a[1]), Number(a[2]), Number(a[3])]
  let age = ay - by
  if (am < bm || (am === bm && ad < bd)) age -= 1
  return age >= 0 && age < 80 ? age : null
}

/** Stable position order for the builder grid: QB → RB → WR → TE → K → D/ST. */
const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DST']
export function byPositionOrder<T extends { position: string }>(players: readonly T[]): T[] {
  const rank = (p: string) => {
    const i = POS_ORDER.indexOf(p)
    return i < 0 ? POS_ORDER.length : i
  }
  return players
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p.position) - rank(b.p.position) || a.i - b.i)
    .map((x) => x.p)
}
