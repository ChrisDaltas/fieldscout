/**
 * My Team — the pure half (League UX batch 3, Chris 2026-10-03; PROGRESS
 * D478). Built to the prototype's `MyTeam.jsx`: the stat columns and their
 * Customize menu, the Lineup check, the projected total, the matchup strip
 * and the AUTOSAVE queue.
 *
 * **Truthful numbers only.** Every value here comes from a server read —
 * projections and season points from `league_player_values` (137, scored
 * under the league's own rules), points from the box-score read (the
 * worker's own pipeline), the opponent and kickoff from `nfl_games`, OPRK
 * from `defense_position_splits`, snap % from `player_usage`, ADP from
 * `players`. A value the reads do not carry is "—", never a guess; a check
 * that cannot be computed truthfully is not shown. "Rostered %" has no
 * source in this app (no cross-league read), so it always reads "—".
 *
 * **Autosave (Chris 2026-10-03: "When I set my lineup, I still have to hit
 * a Save button").** Each completed move is sent at once; the screen never
 * runs ahead of the server — it shows "Saving…", then the server's
 * canonical map. One save in flight at a time; a move made meanwhile is
 * QUEUED and re-planned against the server's answer when its turn comes. A
 * refusal shows the server's words, drops the queue and leaves the
 * arrangement the server holds (the page re-reads). Locks still come from
 * the server (`game_lock` / the RPC). This supersedes the draft-and-Save
 * model of D293 / D315(8) — never its server-authoritative lock law.
 */
import { rateLimitRetryMs } from '@/lib/leagues/api/client-fetch'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'

import { designationOf, positionMatches, type MovePlan, type MoveTarget, type Placement, type SlotInstance, type SlotRow } from './lineup-editor-ops'

// ---------------------------------------------------------------------------
// Stat columns + Customize
// ---------------------------------------------------------------------------

export type StatColumnId = 'opp' | 'oprk' | 'points' | 'snap' | 'rostered' | 'adp' | 'proj'

export const STAT_COLUMNS: ReadonlyArray<{ id: StatColumnId; label: string; locked?: boolean }> = [
  { id: 'opp', label: 'Opp' },
  { id: 'oprk', label: 'OPRK' },
  { id: 'points', label: 'Points' },
  { id: 'snap', label: 'Snap %' },
  { id: 'rostered', label: 'Rostered' },
  { id: 'adp', label: 'ADP' },
  { id: 'proj', label: 'Proj', locked: true },
]

export const DEFAULT_STAT_COLUMNS: readonly StatColumnId[] = ['opp', 'oprk', 'proj']
export const STAT_COLUMNS_STORAGE_KEY = 'fs.myTeam.columns.v1'

/** The columns in their canonical order, Proj always present. */
export function normalizeColumns(ids: readonly string[]): StatColumnId[] {
  const set = new Set(ids)
  set.add('proj')
  return STAT_COLUMNS.map((c) => c.id).filter((id) => set.has(id))
}

/** A stored choice → the columns; anything unreadable is the default. */
export function parseStoredColumns(raw: string | null): StatColumnId[] {
  if (!raw) return [...DEFAULT_STAT_COLUMNS]
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_STAT_COLUMNS]
    return normalizeColumns(parsed.filter((x): x is string => typeof x === 'string'))
  } catch {
    return [...DEFAULT_STAT_COLUMNS]
  }
}

/** Toggle one column; Proj cannot be turned off. */
export function toggleColumn(cols: readonly StatColumnId[], id: StatColumnId): StatColumnId[] {
  if (id === 'proj') return normalizeColumns(cols)
  return normalizeColumns(cols.includes(id) ? cols.filter((c) => c !== id) : [...cols, id])
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** Per-viewer convenience — every access wrapped (private windows throw). */
export function readColumns(storage: StorageLike | null | undefined): StatColumnId[] {
  try {
    return parseStoredColumns(storage?.getItem(STAT_COLUMNS_STORAGE_KEY) ?? null)
  } catch {
    return [...DEFAULT_STAT_COLUMNS]
  }
}

export function writeColumns(storage: StorageLike | null | undefined, cols: readonly StatColumnId[]): void {
  try {
    storage?.setItem(STAT_COLUMNS_STORAGE_KEY, JSON.stringify(cols))
  } catch {
    // A blocked store only loses the remembered choice.
  }
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export interface WeekGame {
  home_team: string
  away_team: string
  kickoff_at: string
}

export type Opponent = { kind: 'game'; label: string; opp: string; kickoff_at: string } | { kind: 'bye' } | { kind: 'unknown' }

/** "vs DAL" (home) / "@ DAL" (away); a team with no game in a week that has
 *  games is on bye; no games on record (or no NFL team) is unknown. */
export function opponentOf(nflTeam: string | null, games: readonly WeekGame[]): Opponent {
  if (games.length === 0 || !nflTeam) return { kind: 'unknown' }
  const g = games.find((x) => x.home_team === nflTeam || x.away_team === nflTeam)
  if (!g) return { kind: 'bye' }
  const home = g.home_team === nflTeam
  const opp = home ? g.away_team : g.home_team
  return { kind: 'game', label: `${home ? 'vs' : '@'} ${opp}`, opp, kickoff_at: g.kickoff_at }
}

/** OPRK in the fantasy-platform orientation (1 = toughest defense against
 *  the position). 033 stores 1 = MOST generous, so the order is flipped
 *  within the position's own ranked set — same data, the familiar reading.
 *  Null when the opponent or the position has no row (or a rank of 0 —
 *  033's "unranked"). */
export function oprkOf(
  splits: ReadonlyArray<{ defense: string; position: string; rank: number }>,
  opp: string | null,
  position: string,
): number | null {
  if (!opp) return null
  const pos = position === 'DST' ? 'DEF' : position
  const ranked = splits.filter((s) => s.position === pos && s.rank > 0)
  const row = ranked.find((s) => s.defense === opp)
  if (!row) return null
  const worst = Math.max(...ranked.map((s) => s.rank))
  return worst + 1 - row.rank
}

export type Tone = 'positive' | 'caution' | 'negative'

/** How many defenses carry a rank for the position (the OPRK scale's size). */
export function oprkRankedCount(
  splits: ReadonlyArray<{ position: string; rank: number }>,
  position: string,
): number {
  const pos = position === 'DST' ? 'DEF' : position
  return splits.filter((s) => s.position === pos && s.rank > 0).length
}

/** THE one OPRK band rule — every OPRK chip / badge uses it (D486(16)).
 *  Chris 2026-10-04: "ideally green top 10, orange 11-22, red bottom 10."
 *  With 1 = toughest out of 32: 1–10 red (negative), 11–22 orange (caution),
 *  23–32 green (positive). A position with fewer ranked teams scales: each
 *  end band is min(10, floor(ranked / 3)) teams by count (10 for 30+ ranked),
 *  everything between is caution. `ranked` defaults to 32. */
export function oprkTone(oprk: number, ranked = 32): Tone {
  const total = Math.max(ranked, oprk)
  const band = Math.min(10, Math.floor(total / 3))
  if (oprk <= band) return 'negative'
  if (oprk > total - band) return 'positive'
  return 'caution'
}

/** THE one OPRK pill look (D497, Chris 2026-10-05): a soft tint with very
 *  dark text of the same hue and no border — red / orange / green by the
 *  `oprkTone` band. Every OPRK chip (My Team, Matchup, Players, the player
 *  modal and card) takes its colours from here so they change together. */
export const OPRK_PILL: Record<Tone, string> = {
  negative: 'bg-oprk-hard text-oprk-hard-fg',
  caution: 'bg-oprk-mid text-oprk-mid-fg',
  positive: 'bg-oprk-easy text-oprk-easy-fg',
}

export function oprkPillClass(tone: Tone): string {
  return OPRK_PILL[tone]
}

export function formatPoints(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(1)
}

/** `snap_pct` is already a 0–100 percentage (F579/R1509) — never scale it. */
export function formatSnap(pct: number | null | undefined): string {
  return pct === null || pct === undefined || !Number.isFinite(pct) ? '—' : `${Math.round(pct)}%`
}

export function formatAdp(adp: number | null | undefined): string {
  return adp === null || adp === undefined || !Number.isFinite(adp) || adp <= 0 ? '—' : adp.toFixed(1)
}

/** The status tag beside a name: Q / D / O / IR (the feed's spelling). */
export function statusTag(status: string | null | undefined): 'Q' | 'D' | 'O' | 'IR' | null {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'questionable':
      return 'Q'
    case 'doubtful':
      return 'D'
    case 'out':
      return 'O'
    case 'ir':
      return 'IR'
    default:
      return null
  }
}

/** A week's points for a player, from the box read: shown once his game is
 *  under way or done; "—" before kickoff or on bye. */
export function pointsCell(line: { phase: string; points: number; pending: readonly string[] } | null | undefined): {
  text: string
  pending: boolean
} {
  if (!line || line.phase === 'up_next' || line.phase === 'bye') return { text: '—', pending: false }
  return { text: line.points.toFixed(1), pending: line.pending.length > 0 }
}

// ---------------------------------------------------------------------------
// Projected total + Lineup check
// ---------------------------------------------------------------------------

export interface ProjectedTotal {
  /** Σ of the starters' projections that exist (an empty seat adds 0). */
  total: number
  /** Filled starters with no projection on record. */
  missing: number
}

export function projectedTotal(
  starterIds: ReadonlyArray<string | null>,
  projOf: (playerId: string) => number | null | undefined,
): ProjectedTotal {
  let total = 0
  let missing = 0
  for (const id of starterIds) {
    if (!id) continue
    const p = projOf(id)
    if (p === null || p === undefined) missing += 1
    else total += p
  }
  return { total: Math.round(total * 100) / 100, missing }
}

/**
 * A lineup's projected total when it can be stated truthfully — the ONE rule
 * every surface that shows one follows (phone: the Match card, the Team tab
 * card, the Team view header, the Lineup check, the Home card; desktop: the
 * team page's projected total row, matchup strip and "Proj vs opponent",
 * and the matchup page): a number only when the lineup has filled starters
 * and EVERY one has a stored projection. A partial sum would understate the
 * side, an empty lineup has nothing to project, and while the projections
 * read is loading — or after it failed — no starter has one. Null = the
 * dash, never "0.00". `filled` counts every filled seat, a kept
 * (dropped-after-he-played) starter included.
 */
export function wholeProjectedTotal(total: ProjectedTotal | null, filled: number): number | null {
  if (!total || filled === 0 || total.missing > 0) return null
  return total.total
}

/** A stored lineup's starters — every seat of the slot map except the IR
 *  ones (`roster_settings.ir_slots`): the opponent side of "Proj vs
 *  opponent" on the desktop team page and the phone's Lineup check. */
export function starterIdsOf(slotMap: Readonly<Record<string, string>>, irSlots: ReadonlyArray<{ key: string }>): string[] {
  const irKeys = new Set(irSlots.map((s) => s.key))
  return Object.entries(slotMap)
    .filter(([key]) => !irKeys.has(key.split(':')[0]!))
    .map(([, pid]) => pid)
}

export interface LineupCheck {
  id: 'starters' | 'injury' | 'bye' | 'proj'
  label: string
  value: string
  note: string
  tone: 'positive' | 'caution'
}

export interface LineupCheckInput {
  starters: readonly SlotRow[]
  week: number
  games: readonly WeekGame[]
  /** My projected total — null when it cannot be stated truthfully. */
  mine: ProjectedTotal | null
  opponent: { name: string; projected: ProjectedTotal } | null
}

function names(players: readonly RosterPlayer[]): string {
  return players.map((p) => p.full_name).join(', ')
}

/** The Lineup check's injury rule: a starter carrying a status tag (Q / D /
 *  O / IR) or an injury designation (PUP, NFI, Suspended…). One rule for the
 *  desktop check and the phone's Lineup check card. */
export function injuredStarters(players: readonly RosterPlayer[]): RosterPlayer[] {
  return players.filter((p) => statusTag(p.status) !== null || designationOf(p.status) !== null)
}

/** The tag a flagged starter is named with: "Q", "O", "IR", "PUP"… */
export function injuryTag(status: string | null | undefined): string | null {
  return statusTag(status) ?? designationOf(status)
}

/** The Lineup check's bye rule: the player's own bye week, or no game for
 *  his team in a week that has games. */
export function startersOnBye(players: readonly RosterPlayer[], week: number, games: readonly WeekGame[]): RosterPlayer[] {
  return players.filter((p) => (p.bye_week !== null && p.bye_week === week) || opponentOf(p.nfl_team, games).kind === 'bye')
}

export function lineupChecks({ starters, week, games, mine, opponent }: LineupCheckInput): LineupCheck[] {
  const out: LineupCheck[] = []
  const filled = starters.filter((r) => r.player)
  const empty = starters.length - filled.length
  out.push({
    id: 'starters',
    label: 'Starters set',
    value: `${filled.length} / ${starters.length}`,
    note: empty > 0 ? 'Empty slots score zero — fill them before kickoff.' : 'Every starting slot is filled.',
    tone: empty > 0 ? 'caution' : 'positive',
  })
  const hurt = injuredStarters(filled.map((r) => r.player!))
  out.push({
    id: 'injury',
    label: 'Injury risk',
    value: hurt.length === 0 ? 'None' : `${hurt.length} flagged`,
    note: hurt.length === 0 ? 'No starter carries an injury designation.' : `${names(hurt)} — check before kickoff.`,
    tone: hurt.length === 0 ? 'positive' : 'caution',
  })
  const onBye = startersOnBye(filled.map((r) => r.player!), week, games)
  out.push({
    id: 'bye',
    label: 'Players on bye',
    value: onBye.length === 0 ? 'None' : `${onBye.length}`,
    note: onBye.length === 0 ? 'No starter is on bye this week.' : `${names(onBye)} — on bye, scores zero.`,
    tone: onBye.length === 0 ? 'positive' : 'caution',
  })
  // Only when BOTH sides' projections are complete — a partial sum is not a comparison.
  if (mine && opponent && mine.missing === 0 && opponent.projected.missing === 0) {
    const diff = Math.round((mine.total - opponent.projected.total) * 10) / 10
    out.push({
      id: 'proj',
      label: 'Proj vs opponent',
      value: `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)}`,
      note: `${mine.total.toFixed(1)} vs ${opponent.name}’s ${opponent.projected.total.toFixed(1)} projected`,
      tone: diff >= 0 ? 'positive' : 'caution',
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// The Move menu's entries
// ---------------------------------------------------------------------------

export interface MoveOption {
  target: MoveTarget
  label: string
  /** Why this entry cannot be taken (a locked occupant), or null. */
  disabledReason: string | null
}

/** The seats a player can go to, each with its current occupant, then the
 *  bench. IR is offered only to a player holding an IR designation. */
/** Two empty seats sharing a label read apart: "RB 1" / "RB 2". */
function seatLabel(slot: SlotInstance, slots: readonly SlotInstance[]): string {
  const same = slots.filter((s) => s.label === slot.label)
  return same.length > 1 ? `${slot.label} ${same.indexOf(slot) + 1}` : slot.label
}

export function moveOptions(args: {
  player: RosterPlayer
  placement: Placement
  slots: readonly SlotInstance[]
  players: ReadonlyMap<string, RosterPlayer>
  locked: ReadonlySet<string>
  lockExempt: boolean
}): MoveOption[] {
  const { player, placement, slots, players, locked, lockExempt } = args
  const from = Object.entries(placement).find(([, v]) => v === player.player_id)?.[0] ?? null
  const fromSlot = from ? slots.find((s) => s.key === from) ?? null : null
  const out: MoveOption[] = []
  for (const slot of slots) {
    if (slot.key === from) continue
    if (slot.kind === 'start' && !positionMatches(player.position, slot.eligible)) continue
    if (slot.kind === 'ir' && !designationOf(player.status)) continue
    const occId = placement[slot.key] ?? null
    const occ = occId ? players.get(occId) ?? null : null
    const occLocked = Boolean(occId && locked.has(occId) && !lockExempt)
    out.push({
      target: { kind: 'slot', key: slot.key },
      label: `${occ ? slot.label : seatLabel(slot, slots)} — ${occ ? occ.full_name : 'Empty'}`,
      disabledReason: occLocked ? `${occ?.full_name ?? 'That player'}’s game has started — that seat is locked.` : null,
    })
  }
  if (fromSlot) {
    out.push({
      target: { kind: 'bench' },
      label: fromSlot.kind === 'start' ? `To bench — leave ${fromSlot.label} empty` : 'To bench',
      disabledReason: null,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// F570 — a rail player dragged onto the lineup
// ---------------------------------------------------------------------------

/** The drop id of a move target: `slot:<key>` or `bench`. */
export function railDropId(target: MoveTarget): string {
  return target.kind === 'slot' ? `slot:${target.key}` : 'bench'
}

/** A drop id back to its move target (null = not a lineup target). */
export function railDropTarget(id: string): MoveTarget | null {
  if (id === 'bench') return { kind: 'bench' }
  if (id.startsWith('slot:') && id.length > 5) return { kind: 'slot', key: id.slice(5) }
  return null
}

/**
 * The lineup targets that ACCEPT a rail drag (prevent, don't refuse — the
 * rest are never offered). A player already on this team takes exactly the
 * Move menu's open entries (`moveOptions`: slot eligibility, the IR rule, a
 * locked occupant's seat excluded) — none at all while his own game locks
 * him. A free agent goes to the BENCH only, through the add's confirm step
 * (the card's + flow), and only on the viewer's own team. A player on
 * another team, another league's drag, or a read-only lineup: nothing.
 */
export function railDropTargets(args: {
  drag: { leagueId: string; playerId: string; availability: 'free_agent' | 'rostered'; teamId: string | null } | null
  leagueId: string
  teamId: string
  readOnly: boolean
  ownTeam: boolean
  placement: Placement
  slots: readonly SlotInstance[]
  players: ReadonlyMap<string, RosterPlayer>
  locked: ReadonlySet<string>
  lockExempt: boolean
}): Set<string> {
  const { drag } = args
  if (!drag || drag.leagueId !== args.leagueId || args.readOnly) return new Set()
  const player = args.players.get(drag.playerId)
  if (player) {
    if (args.locked.has(player.player_id) && !args.lockExempt) return new Set()
    return new Set(
      moveOptions({ player, placement: args.placement, slots: args.slots, players: args.players, locked: args.locked, lockExempt: args.lockExempt })
        .filter((o) => o.disabledReason === null)
        .map((o) => railDropId(o.target)),
    )
  }
  if (drag.availability === 'free_agent' && args.ownTeam) return new Set(['bench'])
  return new Set()
}

/** The toast after a move lands — plain words. */
export function moveToastCopy(args: {
  player: string
  target: MoveTarget
  targetLabel: string | null
  displaced: string | null
}): string {
  const { player, target, targetLabel, displaced } = args
  if (target.kind === 'bench') return `${player} moved to the bench.`
  if (displaced) return `${player} is in at ${targetLabel}; ${displaced} moved out.`
  return `${player} is in at ${targetLabel}.`
}

// ---------------------------------------------------------------------------
// AUTOSAVE — one save in flight, the next queued
// ---------------------------------------------------------------------------

export interface QueuedMove {
  playerId: string
  target: MoveTarget
}

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface AutosaveDeps<R> {
  /** Plan a move over the server's current arrangement. */
  plan: (base: Placement, move: QueuedMove) => MovePlan
  /** Send the WHOLE resulting map; resolves with the server's document. */
  send: (slotMap: Placement) => Promise<R>
  /** The server's canonical map from its answer. */
  canonical: (result: R) => Placement
  onStatus: (status: AutosaveStatus, queued: number) => void
  onSaved: (result: R, move: QueuedMove, plan: Extract<MovePlan, { ok: true }>) => void
  /** The server refused — its own words. The queue has been dropped. */
  onRefused: (message: string, move: QueuedMove) => void
  /** The client-side plan refused (a lock, an ineligible seat) — nothing sent. */
  onPlanRefused: (message: string, move: QueuedMove) => void
  /** §22.5 (L.F2.6): ms to wait before re-sending after this error, or null
   *  when it is a real refusal. Default: a 429's Retry-After. */
  retryAfterMs?: (error: unknown) => number | null
  /** The wait itself (injected by tests). Default: a timer. */
  wait?: (ms: number) => Promise<void>
}

/**
 * The autosave queue. Never optimistic: `base` is the server's arrangement
 * and only a server answer moves it. A move made while a save is in flight
 * waits its turn and is planned against the answer that save brings back;
 * every move waiting when the save lands goes out together as ONE save
 * (coalesced — L.F2.6 R1685), and a 429 is waited out and re-sent, never
 * dropped. `onSaved` fires once per save, with the batch's last move.
 */
export class LineupAutosaver<R> {
  private base: Placement
  private queue: QueuedMove[] = []
  private inFlight = false
  private savedInRun = false
  private retries = 0

  constructor(
    base: Placement,
    private readonly deps: AutosaveDeps<R>,
  ) {
    this.base = base
  }

  get placement(): Placement {
    return this.base
  }

  get saving(): boolean {
    return this.inFlight
  }

  /** The server's arrangement changed underneath (a refetch). Ignored while
   *  a save is in flight or queued — that save's answer is newer. */
  setBase(next: Placement): void {
    if (this.inFlight || this.queue.length > 0) return
    this.base = next
  }

  enqueue(move: QueuedMove): void {
    this.queue.push(move)
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.inFlight) {
      this.deps.onStatus('saving', this.queue.length)
      return
    }
    if (this.queue.length === 0) {
      // R1466: the queue emptied with nothing in flight — always emit a
      // terminal status, or a trailing no-op/refused move leaves 'saving'.
      this.deps.onStatus(this.savedInRun ? 'saved' : 'idle', 0)
      this.savedInRun = false
      return
    }
    // COALESCE (§22.5, L.F2.6 R1685 — D707): every move queued so far is
    // planned in order over the server's arrangement and the RESULT is sent
    // once — a burst of moves is one save, not one per move.
    const batch = this.queue
    this.queue = []
    let next = this.base
    const landed: Array<{ move: QueuedMove; plan: Extract<MovePlan, { ok: true }> }> = []
    for (const move of batch) {
      const plan = this.deps.plan(next, move)
      if (!plan.ok) {
        if (plan.reason !== 'noop') this.deps.onPlanRefused(plan.message, move)
        continue
      }
      next = plan.next
      landed.push({ move, plan })
    }
    if (landed.length === 0) return this.pump()
    this.inFlight = true
    this.deps.onStatus('saving', this.queue.length)
    try {
      const result = await this.deps.send(next)
      this.base = this.deps.canonical(result)
      this.inFlight = false
      this.savedInRun = true
      this.retries = 0
      const last = landed[landed.length - 1]
      this.deps.onSaved(result, last.move, last.plan)
      return this.pump()
    } catch (e) {
      // A 429 is a wait, not a refusal: hold the batch (moves made meanwhile
      // queue behind it), wait out Retry-After, and re-plan it from the
      // server's arrangement — nothing the manager did is dropped.
      const wait = (this.deps.retryAfterMs ?? rateLimitRetryMs)(e)
      if (wait !== null && this.retries < LINEUP_SAVE_MAX_RETRIES) {
        this.retries += 1
        this.queue = [...landed.map((l) => l.move), ...this.queue]
        this.deps.onStatus('saving', this.queue.length)
        const sleep = this.deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
        await sleep(wait)
        this.inFlight = false
        return this.pump()
      }
      this.inFlight = false
      this.savedInRun = false
      this.retries = 0
      this.queue = []
      this.deps.onStatus('error', 0)
      this.deps.onRefused(e instanceof Error ? e.message : String(e), landed[landed.length - 1].move)
    }
  }
}

/** How many 429s in a row a lineup save waits out before it says so. */
export const LINEUP_SAVE_MAX_RETRIES = 5


/** R1467: the week tabs wait while a save is in flight — a week switch
 *  mid-save could otherwise send a map built from the wrong week. */
export const WEEK_TABS_SAVING_REASON = 'Saving this week’s lineup — switch weeks once it’s saved.'
export function weekTabsLockedReason(saving: boolean): string | null {
  return saving ? WEEK_TABS_SAVING_REASON : null
}
