/**
 * Players / free agents page — pure derivation (M4 task L.D5.4; spec §16.1
 * `…/players`, §16.2 `free-agents-table`, §12.19, §13.1, §16.5.2's Waivers
 * row "locked player rows (game started)", §16.5.4; PROGRESS D324, F251(b),
 * F227(f)).
 *
 * Everything here LABELS stored state. A player's availability is §12.19's
 * derived truth read from two documents — the rosters route (who holds him)
 * and the lazy pool row (`free_agent` · `on_waivers` + `waivers_until` ·
 * `locked_in_game`) — and never a guess; the 🔒 is the tick's VIEW
 * (`game_lock`, F241(d)) through the lineup editor's own `lockBadgeFor`
 * (one reading of the lock badge across the two surfaces), never a kickoff
 * compared with a clock. The add/drop verb is 113's: this file decides
 * only what the FORM may send (either side or both, never neither — the
 * route's own rule) and how the server's answer READS.
 *
 * No ledger code in any copy (F277(a)).
 */
import type { PoolPlayer } from '@/components/draft/available-players-ops'
import type { PoolRow } from '@/hooks/use-league-pool'
import type { AddDropResult } from '@/hooks/use-transactions'
import type { LeagueRosters, RosterPlayer } from '@/lib/leagues/api/rosters-service'

import { lockBadgeFor, type LockBadge } from './lineup-editor-ops'

// ---------------------------------------------------------------------------
// Scope + rows
// ---------------------------------------------------------------------------

export type PoolScope = 'free_agents' | 'rostered' | 'all'

export const SCOPE_LABELS: Record<PoolScope, string> = {
  free_agents: 'Free agents',
  rostered: 'On rosters',
  all: 'All',
}

export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const

export type Availability =
  | { kind: 'free_agent' }
  | { kind: 'on_waivers'; until: string }
  | { kind: 'rostered'; teamId: string; teamName: string; mine: boolean }

export interface PoolPlayerRow {
  player: PoolPlayer
  availability: Availability
  /** The tick's view (the current week's), through `lockBadgeFor`. */
  lock: LockBadge
  /** The pool's own word for the row (`free_agent` / `on_waivers` /
   *  `rostered` / `locked_in_game`), or `null` when no row exists yet
   *  (§12.19: lazy — an unowned player with no row IS a free agent). */
  poolState: string | null
}

/** Who holds each rostered player, from the rosters route (one map). */
export function holdersOf(rosters: Pick<LeagueRosters, 'teams'> | undefined): Map<string, { teamId: string; teamName: string; player: RosterPlayer }> {
  const out = new Map<string, { teamId: string; teamName: string; player: RosterPlayer }>()
  for (const team of rosters?.teams ?? []) {
    for (const player of team.roster) out.set(player.player_id, { teamId: team.team_id, teamName: team.name, player })
  }
  return out
}

/**
 * §12.19's derived truth per player, in the search window's order (ADP —
 * the window's own sort, never re-sorted here). A player on a roster is
 * `rostered` whatever his pool row says (the rosters route is the holder of
 * record; D294's reconciliation owns a broken mirror). `on_waivers` needs
 * its instant (113's CHECK ties them); a row that claims it without one is
 * rendered as a free agent rather than invented a date — the server's add
 * refusal, if any, says the rest. `locked_in_game` is a free agent whose
 * lock the tick recorded (116) — the availability is `free_agent`, the 🔒
 * comes from `game_lock`.
 */
export function poolRows(
  players: readonly PoolPlayer[],
  rosters: Pick<LeagueRosters, 'teams'> | undefined,
  pool: readonly PoolRow[],
  myTeamId: string | null,
  scope: PoolScope,
): PoolPlayerRow[] {
  const holders = holdersOf(rosters)
  const poolById = new Map(pool.map((row) => [row.player_id, row]))
  const out: PoolPlayerRow[] = []
  for (const player of players) {
    const held = holders.get(player.id)
    const row = poolById.get(player.id)
    let availability: Availability
    if (held) {
      availability = { kind: 'rostered', teamId: held.teamId, teamName: held.teamName, mine: held.teamId === myTeamId }
    } else if (row && row.state === 'on_waivers' && row.waivers_until) {
      availability = { kind: 'on_waivers', until: row.waivers_until }
    } else {
      availability = { kind: 'free_agent' }
    }
    if (scope === 'free_agents' && availability.kind === 'rostered') continue
    if (scope === 'rostered' && availability.kind !== 'rostered') continue
    // The lock: the ROSTERED player's view rides on the rosters route (the
    // same evaluation, joined there); an unowned player's on his pool row.
    const gameLock = held ? held.player.game_lock : row?.game_lock ?? { state: 'unlocked' as const, until: null }
    out.push({ player, availability, lock: lockBadgeFor(gameLock, true), poolState: row?.state ?? null })
  }
  return out
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const FREE_AGENT_LABEL = 'Free agent'
export const ON_WAIVERS_LABEL = 'On waivers'
export const NO_MATCH_COPY = 'No players match that search.'
export const NO_FREE_AGENTS_COPY = 'No free agents match — every player in this window is on a roster.'
export const NO_ROSTERED_COPY = 'No rostered players match.'
export const NO_SEAT_COPY = 'You don’t manage a team in this league, so you can browse the pool but not make moves.'
export const LOCKED_ADD_TITLE = 'Locked — this player’s game has started; he can be added once the week’s last game ends.'
export const LOCKED_DROP_TITLE = 'Locked — this player’s game has started; he can be dropped once the week’s last game ends.'
export const WAIVERS_ADD_TITLE = 'On waivers — he can be added once he clears. Waiver claims arrive in a later update.'
export const ROSTERED_ELSEWHERE_TITLE = 'On another roster — trades arrive in a later update.'

export function emptyCopy(scope: PoolScope, hadSearch: boolean): string {
  if (scope === 'free_agents') return hadSearch ? NO_MATCH_COPY : NO_FREE_AGENTS_COPY
  if (scope === 'rostered') return hadSearch ? NO_MATCH_COPY : NO_ROSTERED_COPY
  return NO_MATCH_COPY
}

// ---------------------------------------------------------------------------
// The move form — what may be SENT (the route's own rule), nothing more
// ---------------------------------------------------------------------------

export type MoveIntent = { add: PoolPlayerRow | null; drop: RosterPlayer | null }

export const MOVE_NOTHING_COPY = 'Pick a player to add, a player to drop, or both.'

/** The one client-side check the route itself makes (`addDropInputSchema`:
 *  either side, never neither). Everything else — exclusivity, the lock,
 *  waivers, caps, capacity — is 113's and comes back as its own sentence. */
export function moveProblem(intent: MoveIntent): string | null {
  if (!intent.add && !intent.drop) return MOVE_NOTHING_COPY
  return null
}

/** Roster fill for the info line ("14 of 16") — the STORED count over the
 *  STORED size; no capacity judgement is made from it (the server refuses a
 *  full roster by name). */
export function rosterFill(roster: readonly RosterPlayer[] | undefined, rosterSize: number): { count: number; size: number } {
  return { count: roster?.length ?? 0, size: rosterSize }
}

// ---------------------------------------------------------------------------
// The server's answer, read out (F227(f)'s rendering duties)
// ---------------------------------------------------------------------------

export interface MoveReadout {
  headline: string
  lines: string[]
}

export function slotLabel(slotKey: string | null): string {
  if (!slotKey) return 'bench'
  const base = slotKey.split(':')[0]
  if (base === 'bn') return 'bench'
  if (base === 'dst') return 'D/ST'
  if (base.startsWith('ir')) return base.toUpperCase()
  return base.toUpperCase()
}

/**
 * 113's stored payload as sentences: the add (and the bench slot he landed
 * on), the drop (and, F227(f), every lineup the drop touched — a `{week,
 * slot}` per row, `slot: null` a bench-only touch), where the dropped player
 * went (waivers until an instant the host formats, or free agency), the
 * hold if the drop was early, and the caps AFTER the move (real numbers on
 * every move, incl. a drop-only — R763).
 */
export function moveReadout(result: AddDropResult, formatInstant: (iso: string) => string): MoveReadout {
  const lines: string[] = []
  const parts: string[] = []
  if (result.add) {
    parts.push(`Added ${result.add.name ?? result.add.player_id}`)
    lines.push(`${result.add.name ?? result.add.player_id} lands on your ${slotLabel(result.add.slot_key)}.`)
  }
  if (result.drop) {
    parts.push(`Dropped ${result.drop.name ?? result.drop.player_id}`)
    const touched = result.drop.lineups.filter((l) => l.slot !== null)
    if (touched.length > 0) {
      lines.push(
        `Cleared from ${touched.map((l) => `week ${l.week} ${slotLabel(l.slot)}`).join(', ')} — that seat is empty until you fill it.`,
      )
    }
    if (result.drop.to_state === 'on_waivers' && result.drop.waivers_until) {
      lines.push(`${result.drop.name ?? result.drop.player_id} is on waivers until ${formatInstant(result.drop.waivers_until)}.`)
    } else if (result.drop.to_state === 'free_agent') {
      lines.push(`${result.drop.name ?? result.drop.player_id} is a free agent now.`)
    }
    if (result.drop.fa_hold.early) {
      lines.push(`Dropped inside the ${result.drop.fa_hold.hours} h hold after pickup.`)
    }
  }
  lines.push(`Roster: ${result.roster.count_after} of ${result.roster.roster_size}.`)
  lines.push(capsLine(result.caps))
  return { headline: parts.join(' · ') || 'Move recorded.', lines }
}

export function capsLine(caps: AddDropResult['caps']): string {
  const week =
    caps.acquisitions_per_week === 'unlimited'
      ? `${caps.used_week_after} add${caps.used_week_after === 1 ? '' : 's'} this week (no weekly cap)`
      : `${caps.used_week_after} of ${caps.acquisitions_per_week} adds used this week`
  const season =
    caps.acquisitions_per_season === 'unlimited'
      ? `${caps.used_season_after} this season (no season cap)`
      : `${caps.used_season_after} of ${caps.acquisitions_per_season} this season`
  return `Adds: ${week} · ${season}.`
}
