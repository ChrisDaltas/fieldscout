/**
 * Lineup editor — pure derivation (M4 task L.D5.1; spec §11.2 lineups &
 * lock, §12.13 `slot_map`, §16.2 `lineup-editor`, §16.5.4 the badge catalog
 * + the four required states; PROGRESS D293 (lineup law), D315 (the hooks'
 * contracts), F224(e)/R779 (what the surface renders), F241(d) (the
 * `'infinity'` lock view)).
 *
 * Colocated with the component and pure (the `league-home-states-ops` /
 * `roster-tracker-ops` precedent) so every decision the editor makes can be
 * pinned in node without React or a socket. Deliberately NOT under
 * `src/lib/leagues/**`: this is a UI surface, not league engine. Even so,
 * nothing here reads a clock — there is no `now` in this file at all.
 *
 * ## The lock is READ, never computed here
 *
 * §11.2: a starter's slot locks at his own kickoff, evaluated from
 * `nfl_games.kickoff_at` at transaction time (E42 — a moved kickoff moves
 * the lock). The editor does not re-derive that: the per-player 🔒 comes
 * from the FETCHED evaluation — `use-rosters`'s `game_lock`, the pool VIEW
 * migration 116's `lineup_lock_tick` refreshes every minute from 115's
 * `pool_game_lock_any_internal` at the tick's instant (`unlocked` /
 * `locked_until` / `locked_release_unrecorded`; D315(5)). It never comes
 * from a stored instant: `team_lineups.locked_at` is the RECORD of the
 * earliest kickoff among the starters and is rendered as "locks at"
 * (R779), and `starters[].kickoff_at` is a datum shown beside the row,
 * never the decider. `lockedPlayerIds` is the one function that answers
 * "is this player locked" and it reads `game_lock` only — the DoD probe
 * (render the lock from `locked_at` instead) reds `lineup-editor-ops.test.ts`
 * on the moved-kickoff fixture.
 *
 * The pool view is the CURRENT week's evaluation (the tick evaluates every
 * week ≤ current whose last game has not ended), so it is applied only when
 * the lineup's week IS the league's current week: a future week has nothing
 * kicked off, and a past week is closed whole (`weekEditability`). The
 * server is the decider either way — `set_lineup` refuses a locked move by
 * name, and the surface renders that refusal verbatim (F224(e)).
 *
 * ## Current week, mirrored from the ladder
 *
 * 112's `lineup_current_week_internal` is the greatest `league_weeks` week
 * whose `nfl_weeks.starts_at` ≤ now, else the league's first week — and it
 * is deliberately not granted to clients (D315(3)/F248(b)). The UI reads
 * the same fact through `league_weeks.status` (`useSchedule`'s ladder):
 * `league_week_advance` flips a week out of `upcoming` at its `starts_at`
 * (116), so the greatest NON-`upcoming` week is the started one, and when
 * nothing has started the first week is current (112's COALESCE arm). No
 * wall-clock arithmetic anywhere (§23.3).
 */

import type { ScheduleWeek } from '@/hooks/use-schedule'
import type { LineupStarter, SetLineupResult } from '@/lib/leagues/api/lineup-service'
import type { GameLockView, RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { RosterSettings } from '@/lib/leagues/settings/league-settings'

// ---------------------------------------------------------------------------
// Slot instances (§12.13 — `"<slot_key>:<index>"`)
// ---------------------------------------------------------------------------

export interface SlotInstance {
  /** The §12.13 instance key — `qb:0`, `wr:2`, `ir1:0`. */
  key: string
  slotKey: string
  label: string
  /** Positions the slot takes (`players.position` vocabulary — DEF for D/ST,
   *  which 112 fits as DST; empty for an IR spot, which takes a designation
   *  rather than a position). */
  eligible: readonly string[]
  kind: 'start' | 'ir'
}

/** 112's position bridge: `players.position` says `DEF`, the catalog's
 *  slot says `DST` (F224(h) — single-valued until a duals column exists). */
export function positionMatches(position: string, eligible: readonly string[]): boolean {
  const p = position === 'DEF' ? 'DST' : position
  return eligible.some((e) => (e === 'DEF' ? 'DST' : e) === p)
}

export function slotInstances(roster: RosterSettings): SlotInstance[] {
  const out: SlotInstance[] = []
  for (const slot of roster.starting_slots) {
    for (let i = 0; i < slot.count; i += 1) {
      out.push({ key: `${slot.key}:${i}`, slotKey: slot.key, label: slot.label, eligible: slot.eligible, kind: 'start' })
    }
  }
  for (const ir of roster.ir_slots) {
    out.push({ key: `${ir.key}:0`, slotKey: ir.key, label: ir.label ?? 'IR', eligible: [], kind: 'ir' })
  }
  return out
}

// ---------------------------------------------------------------------------
// The editor model — a placement over the roster
// ---------------------------------------------------------------------------

/** A `slot_map` as the client holds it while editing (§12.13's shape). */
export type Placement = Record<string, string>

export interface SlotRow {
  slot: SlotInstance
  player: RosterPlayer | null
}

export interface EditorModel {
  starters: SlotRow[]
  ir: SlotRow[]
  bench: RosterPlayer[]
  /** Map entries whose player is no longer on the roster (a drop since the
   *  set — 113 clears them, so this is a fault to NAME, never hide). */
  orphaned: Array<{ key: string; player_id: string }>
}

export function buildEditorModel(
  placement: Placement,
  roster: readonly RosterPlayer[],
  settings: RosterSettings,
): EditorModel {
  const byId = new Map(roster.map((p) => [p.player_id, p]))
  const placed = new Set<string>()
  const orphaned: EditorModel['orphaned'] = []
  const rows: SlotRow[] = slotInstances(settings).map((slot) => {
    const pid = placement[slot.key]
    if (!pid) return { slot, player: null }
    const player = byId.get(pid) ?? null
    if (!player) orphaned.push({ key: slot.key, player_id: pid })
    else placed.add(pid)
    return { slot, player }
  })
  const bench = roster.filter((p) => !placed.has(p.player_id))
  return {
    starters: rows.filter((r) => r.slot.kind === 'start'),
    ir: rows.filter((r) => r.slot.kind === 'ir'),
    bench,
    orphaned,
  }
}

/** The stored row's `slot_map` normalised to what the editor holds: every
 *  key whose player is rostered. Null (no row yet — D293/D313's "nothing
 *  set, week not opened") is an EMPTY placement: every slot open, the
 *  roster on the bench, exactly the row auto-carry would write. */
export function placementFromStored(
  slotMap: Record<string, string> | null | undefined,
  roster: readonly RosterPlayer[],
): Placement {
  if (!slotMap) return {}
  const ids = new Set(roster.map((p) => p.player_id))
  const out: Placement = {}
  for (const [key, pid] of Object.entries(slotMap)) if (ids.has(pid)) out[key] = pid
  return out
}

export function placementsEqual(a: Placement, b: Placement): boolean {
  const ak = Object.keys(a).sort()
  const bk = Object.keys(b).sort()
  if (ak.length !== bk.length) return false
  return ak.every((k, i) => k === bk[i] && a[k] === b[k])
}

// ---------------------------------------------------------------------------
// Lock state — the FETCHED evaluation only (§11.2 / D315(5) / F241(d))
// ---------------------------------------------------------------------------

export type LockBadge =
  | { locked: false }
  | { locked: true; copy: string; until: string | null }

/** F241(d)'s copy, rendered from the STATE and never from the raw column. */
export const LOCK_RELEASE_UNRECORDED_COPY = "locked — the week's last game has not ended"
export const LOCK_UNTIL_COPY = 'locked — game started'

export function lockBadgeFor(gameLock: GameLockView, weekIsCurrent: boolean): LockBadge {
  if (!weekIsCurrent) return { locked: false }
  switch (gameLock.state) {
    case 'unlocked':
      return { locked: false }
    case 'locked_until':
      return { locked: true, copy: LOCK_UNTIL_COPY, until: gameLock.until }
    case 'locked_release_unrecorded':
      return { locked: true, copy: LOCK_RELEASE_UNRECORDED_COPY, until: null }
  }
}

/**
 * THE lock decision for the editor: which rostered players may not move.
 * Reads `game_lock` — the server's own evaluation — and nothing else. A
 * moved kickoff (E42) reaches this through the tick's refresh of the pool
 * view; a stored `locked_at` / `starters[].kickoff_at` does not enter here
 * (the DoD probe: swap this to read the lineup row's instant and the
 * moved-kickoff fixture shows a stale 🔒).
 */
export function lockedPlayerIds(roster: readonly RosterPlayer[], weekIsCurrent: boolean): Set<string> {
  const out = new Set<string>()
  if (!weekIsCurrent) return out
  for (const p of roster) if (lockBadgeFor(p.game_lock, true).locked) out.add(p.player_id)
  return out
}

/**
 * How the tick's re-evaluation reaches an OPEN page (R822(ii) / F252).
 * Nothing broadcasts `league_player_pool` (see `use-rosters.ts`'s header), so
 * the page showing the CURRENT week's 🔒 polls the rosters route at the
 * tick's cadence (116: every minute); any other week reads no lock from the
 * view (`lockedPlayerIds` above) and polls nothing. The M4 interim — a pool
 * broadcast is L.D1.9's to decide.
 */
export const LOCK_POLL_MS = 60_000
export function lockPollInterval(week: number, currentWeek: number | null): number | false {
  return currentWeek !== null && week === currentWeek ? LOCK_POLL_MS : false
}

// ---------------------------------------------------------------------------
// Week ladder → current week + editability
// ---------------------------------------------------------------------------

/** 112's current-week fact read through the ladder (see the header). Null
 *  for a league with no `league_weeks` rows (pre-schedule). */
export function currentWeekOf(weeks: readonly Pick<ScheduleWeek, 'week' | 'status'>[]): number | null {
  if (weeks.length === 0) return null
  const started = weeks.filter((w) => w.status !== 'upcoming').map((w) => w.week)
  if (started.length > 0) return Math.max(...started)
  return Math.min(...weeks.map((w) => w.week))
}

export type WeekEditability =
  | { state: 'open' }
  | { state: 'closed'; reason: string }
  | { state: 'unknown' }

export const PAST_WEEK_COPY =
  'This week is in the past — a past week’s lineup changes only through the audited commissioner override (§11.2, M6).'
export const WEEK_OVER_COPY = 'This week’s games are over — the lineup is final for scoring.'

export function weekEditability(
  weeks: readonly Pick<ScheduleWeek, 'week' | 'status'>[],
  week: number,
  currentWeek: number | null,
): WeekEditability {
  if (currentWeek === null) return { state: 'unknown' }
  if (week < currentWeek) return { state: 'closed', reason: PAST_WEEK_COPY }
  const row = weeks.find((w) => w.week === week)
  if (row && (row.status === 'correction_window' || row.status === 'final')) {
    return { state: 'closed', reason: WEEK_OVER_COPY }
  }
  return { state: 'open' }
}

/** The week the page opens on: the current week when the ladder has one,
 *  else the first week of the ladder, else week 1. */
export function defaultLineupWeek(weeks: readonly Pick<ScheduleWeek, 'week' | 'status'>[]): number {
  return currentWeekOf(weeks) ?? 1
}

// ---------------------------------------------------------------------------
// Moves — the client's placement edits before a submit
// ---------------------------------------------------------------------------

export type MoveTarget = { kind: 'slot'; key: string } | { kind: 'bench' }

export interface MoveContext {
  slots: readonly SlotInstance[]
  players: ReadonlyMap<string, RosterPlayer>
  locked: ReadonlySet<string>
  /** Week ≥ current for IR-stint arithmetic (§7.3.2 Restricted IR). */
  currentWeek: number | null
}

export type MovePlan =
  | { ok: true; next: Placement; displaced: string | null }
  | { ok: false; reason: 'locked' | 'ineligible' | 'ir_stint' | 'ir_designation' | 'noop'; message: string }

function keyOf(placement: Placement, playerId: string): string | null {
  for (const [k, v] of Object.entries(placement)) if (v === playerId) return k
  return null
}

function shortName(p: RosterPlayer | undefined, id: string): string {
  return p?.full_name ?? id
}

/** 112's designation bridge, mirrored for the PRE-submit hint only (the
 *  server judges the real placement — F224(b) owns the vocabulary). */
export function designationOf(status: string | null | undefined): string | null {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'out':
      return 'OUT'
    case 'ir':
      return 'IR'
    case 'doubtful':
      return 'Doubtful'
    case 'pup':
      return 'PUP'
    case 'nfi':
      return 'NFI'
    case 'sus':
    case 'suspended':
      return 'Suspended'
    default:
      return null
  }
}

/**
 * Plan a move of `playerId` to `target` over `placement`. Refusals here are
 * the ones the CLIENT can see without the server (a locked player, a
 * position the slot does not take, a Restricted IR stint still running) —
 * copy the manager reads before a submit; every other law (E16's fit,
 * bye/OUT under `allow_illegal_lineups`, the kickoff read at transaction
 * time) is 112's and arrives as its verbatim refusal after the submit.
 */
export function planMove(
  placement: Placement,
  playerId: string,
  target: MoveTarget,
  ctx: MoveContext,
): MovePlan {
  const player = ctx.players.get(playerId)
  const name = shortName(player, playerId)
  const from = keyOf(placement, playerId)
  if (ctx.locked.has(playerId)) {
    return {
      ok: false,
      reason: 'locked',
      message: `${name} is locked — his game has started, and a locked player never moves (§11.2).`,
    }
  }
  if (target.kind === 'bench') {
    if (from === null) return { ok: false, reason: 'noop', message: `${name} is already on the bench.` }
    const fromSlot = ctx.slots.find((s) => s.key === from)
    const stint = fromSlot?.kind === 'ir' ? irStintRefusal(player, ctx.currentWeek) : null
    if (stint) return stint
    const next = { ...placement }
    delete next[from]
    return { ok: true, next, displaced: null }
  }
  const slot = ctx.slots.find((s) => s.key === target.key)
  if (!slot) return { ok: false, reason: 'ineligible', message: `There is no slot "${target.key}" in this league.` }
  if (from === target.key) return { ok: false, reason: 'noop', message: `${name} is already at ${slot.label}.` }
  if (slot.kind === 'ir') {
    const designation = designationOf(player?.status)
    if (!designation) {
      return {
        ok: false,
        reason: 'ir_designation',
        message: `${name} can’t go on ${slot.label} — an IR spot takes a player holding an eligible designation (§7.3.2), and he has none.`,
      }
    }
  } else if (player && !positionMatches(player.position, slot.eligible)) {
    return {
      ok: false,
      reason: 'ineligible',
      message: `${name} can’t start at ${slot.label} — it takes ${slot.eligible.join('/')}.`,
    }
  }
  const fromSlot = from ? ctx.slots.find((s) => s.key === from) : undefined
  if (fromSlot?.kind === 'ir') {
    const stint = irStintRefusal(player, ctx.currentWeek)
    if (stint) return stint
  }
  const occupant = placement[target.key] ?? null
  if (occupant && ctx.locked.has(occupant)) {
    const occ = ctx.players.get(occupant)
    return {
      ok: false,
      reason: 'locked',
      message: `${slot.label} is locked — ${shortName(occ, occupant)} has kicked off and a locked slot’s player never moves (§11.2).`,
    }
  }
  const next = { ...placement }
  if (from) delete next[from]
  next[target.key] = playerId
  // A swap: the occupant takes the mover's old slot when he fits it, else
  // he goes to the bench (E16's re-seat is the server's; the client keeps
  // every move legible).
  if (occupant) {
    const occ = ctx.players.get(occupant)
    if (from && fromSlot && fromSlot.kind === 'start' && occ && positionMatches(occ.position, fromSlot.eligible)) {
      next[from] = occupant
    }
  }
  return { ok: true, next, displaced: occupant }
}

function irStintRefusal(player: RosterPlayer | undefined, currentWeek: number | null): MovePlan | null {
  if (!player || player.ir_lock_until_week === null || currentWeek === null) return null
  if (currentWeek < player.ir_lock_until_week) {
    const left = player.ir_lock_until_week - currentWeek
    return {
      ok: false,
      reason: 'ir_stint',
      message: `${player.full_name} is on a Restricted IR stint until week ${player.ir_lock_until_week} (${left} ${left === 1 ? 'week' : 'weeks'} left) — §7.3.2.`,
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Chips & hints (§16.5.4's catalog — locked 🔒 · DL stint · bye/OUT flags)
// ---------------------------------------------------------------------------

/** The DL-stint chip's copy ("weeks remaining"); null when the player is
 *  not on a counted stint. */
export function irStintChip(player: Pick<RosterPlayer, 'ir_lock_until_week' | 'ir_placed_week' | 'slot_key'>, currentWeek: number | null): string | null {
  if (player.ir_lock_until_week === null) return null
  if (currentWeek === null) return `IR · until wk ${player.ir_lock_until_week}`
  const left = player.ir_lock_until_week - currentWeek
  if (left <= 0) return 'IR · stint served'
  return `IR · ${left} ${left === 1 ? 'wk' : 'wks'} left`
}

export type HintTone = 'caution' | 'negative'
export interface StarterHint {
  tone: HintTone
  text: string
}

/** The PRE-submit hint for a placed starter (bye / designation) — the
 *  `allow_illegal_lineups` messaging (§7.3.6/D293): TRUE means the player
 *  starts and scores 0, flagged; FALSE means the submit will be refused. */
export function starterHint(
  player: Pick<RosterPlayer, 'bye_week' | 'status' | 'full_name'>,
  week: number,
  allowIllegal: boolean,
): StarterHint | null {
  const onBye = player.bye_week !== null && player.bye_week === week
  const designation = designationOf(player.status)
  if (!onBye && !designation) return null
  const what = onBye ? 'on bye' : `${designation}`
  return allowIllegal
    ? { tone: 'caution', text: `${what} — starts and scores 0 this week` }
    : { tone: 'negative', text: `${what} — this league blocks it; the save will be refused` }
}

/** The server's OWN flags on a stored starter (112 writes `bye` / `out` /
 *  `empty` / `ir_ineligible`) — rendered after a set, verbatim in spirit. */
export function starterFlagChips(flags: readonly string[], allowIllegal: boolean): StarterHint[] {
  const out: StarterHint[] = []
  for (const f of flags) {
    if (f === 'bye') out.push({ tone: allowIllegal ? 'caution' : 'negative', text: 'Bye — scores 0' })
    else if (f === 'out') out.push({ tone: allowIllegal ? 'caution' : 'negative', text: 'OUT — scores 0' })
    else if (f === 'ir_ineligible') out.push({ tone: 'negative', text: 'IR spot — no longer eligible' })
  }
  return out
}

/** `starters[]` by instance key — the stored flags and kickoff datum. */
export function startersByKey(starters: readonly LineupStarter[] | undefined): Map<string, LineupStarter> {
  return new Map((starters ?? []).map((s) => [s.slot, s]))
}

// ---------------------------------------------------------------------------
// The save's outcome (R779: `no_changes`, `rearranged` + `moved[]`)
// ---------------------------------------------------------------------------

export function saveOutcomeCopy(
  result: Pick<SetLineupResult, 'no_changes' | 'rearranged' | 'moved' | 'flags'>,
  nameOf: (playerId: string) => string,
  slotLabelOf: (key: string) => string,
): string {
  if (result.no_changes) return 'Nothing changed — this lineup was already set.'
  if (result.rearranged && result.moved.length > 0) {
    const moves = result.moved
      .map((m) => `${nameOf(m.player_id)} → ${slotLabelOf(m.to)}${m.from ? ` (from ${slotLabelOf(m.from)})` : ''}`)
      .join(', ')
    return `Saved — we re-seated ${result.moved.length === 1 ? 'one placement' : `${result.moved.length} placements`} so every starter fits: ${moves}.`
  }
  if (result.flags.illegal) return 'Saved — flagged: a starter is on bye or out and will score 0.'
  return 'Lineup saved.'
}

/** R779: `locked_at` is the RECORD ("locks at"), never the lock. The
 *  component formats the instant (viewer-local, league TZ on hover — §16.4);
 *  this pins the words around it. */
export const NO_LOCK_RECORD_COPY = 'No starter has a kickoff on record yet.'
export function locksAtCopy(formattedInstant: string | null): string {
  if (!formattedInstant) return NO_LOCK_RECORD_COPY
  return `Locks from ${formattedInstant}`
}
