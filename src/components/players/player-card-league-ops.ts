/**
 * The player card's league actions — pure derivation (League UX batch 2,
 * Chris 2026-10-03: "roster actions are reachable from the player").
 *
 * Everything here LABELS what the server already said: who holds him (the
 * rosters route), his pool row (free agent / on waivers), the tick's lock
 * view, the league's status, the trade deadline. The verbs (`useAddDrop`,
 * `useSubmitClaim`, the trade builder) decide; this file decides only which
 * button the card offers and, when one is closed, the reason in plain words
 * — so an invalid move is never offered (prevent, don't refuse).
 *
 * The server rules mirrored here, and where they live:
 *   - moves only while the league is `in_season` / `playoffs`
 *     (`roster_add_drop_internal` / `waiver_claim_submit_internal`, 157);
 *   - no add or drop on a player whose game has started (the game-day lock,
 *     the tick's `game_lock` view);
 *   - an add onto a full roster needs a drop (113's capacity check —
 *     roster_size = starters + bench + IR slots, counted over every row);
 *   - a FAAB bid is whole dollars from the league minimum to the balance;
 *   - no trade past the deadline, and none toward a team with no manager
 *     (174 — nobody could answer the offer).
 */
import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { LOCKED_ADD_TITLE, LOCKED_DROP_TITLE, poolRows, type PoolPlayerRow } from '@/components/leagues/players-page-ops'
import { pickupActions, type ActionState } from '@/components/leagues/waiver-claims-ops'
import type { PoolRow } from '@/hooks/use-league-pool'
import type { LeagueRosters, RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { WaiverWindowView } from '@/lib/leagues/waivers/waiver-window-view'

export type Gate = { open: true } | { open: false; reason: string }

export const MOVES_BEFORE_SEASON_COPY = 'Roster moves open once the draft is done.'
export const MOVES_AFTER_SEASON_COPY = 'The season is over — rosters are final.'
export const TRADE_DEADLINE_PASSED_COPY = 'The trade deadline has passed.'
export const NO_MANAGER_COPY = 'That team has no manager to answer a trade.'
export const NO_SEAT_CARD_COPY = 'You don’t manage a team in this league.'
export const ROSTER_FULL_COPY = 'Your roster is full — pick a player to drop.'

/** The league's own word for when moves are allowed (157's gate). */
export function movesGate(leagueStatus: string): Gate {
  if (leagueStatus === 'in_season' || leagueStatus === 'playoffs') return { open: true }
  if (leagueStatus === 'complete') return { open: false, reason: MOVES_AFTER_SEASON_COPY }
  return { open: false, reason: MOVES_BEFORE_SEASON_COPY }
}

export interface CardLeagueInput {
  player: PoolPlayer
  leagueName: string
  leagueStatus: string
  rosters: Pick<LeagueRosters, 'teams'> | undefined
  pool: readonly PoolRow[]
  myTeamId: string | null
  rosterSize: number
  waiverType: string
  waiverWindow: WaiverWindowView | null
  claimsLive: boolean
  tradesClosed: boolean
  minBid: number
  nextRunLocal: string | null
  /** Formats the on-waivers instant for the Add's title. */
  formatInstant: (iso: string) => string
}

export type CardLeagueView =
  | { kind: 'no_seat'; where: string; row: PoolPlayerRow }
  | { kind: 'mine'; where: string; row: PoolPlayerRow; drop: Gate; rosterPlayer: RosterPlayer }
  | { kind: 'theirs'; where: string; row: PoolPlayerRow; teamId: string; trade: Gate }
  | {
      kind: 'available'
      where: string
      row: PoolPlayerRow
      add: ActionState
      claim: ActionState
      /** The one "+" a press runs (D481). */
      acquire: Acquire
      nextRunLocal: string | null
      /** The roster is at roster_size: an add (or a claim) must name a drop. */
      needsDrop: boolean
      /** The bid's bounds when the claim is a FAAB bid; null otherwise. */
      faab: { min: number; max: number | null } | null
      myRoster: readonly RosterPlayer[]
    }

/** "Free agent in <League>" / "On your team in <League>" / "On <Team> · <League>". */
export function whereLine(row: PoolPlayerRow, leagueName: string): string {
  const a = row.availability
  if (a.kind === 'rostered') return a.mine ? `On your team in ${leagueName}` : `On ${a.teamName} · ${leagueName}`
  if (a.kind === 'on_waivers') return `On waivers in ${leagueName}`
  return `Free agent in ${leagueName}`
}

export function cardLeagueView(input: CardLeagueInput): CardLeagueView {
  const [row] = poolRows([input.player], input.rosters, input.pool, input.myTeamId, 'all')
  const where = whereLine(row, input.leagueName)
  const moves = movesGate(input.leagueStatus)
  const a = row.availability

  if (a.kind === 'rostered' && !a.mine) {
    // A viewer with no team has no side to trade from.
    const trade: Gate = !input.myTeamId
      ? { open: false, reason: NO_SEAT_CARD_COPY }
      : input.tradesClosed
        ? { open: false, reason: TRADE_DEADLINE_PASSED_COPY }
        : !a.managed
          ? { open: false, reason: NO_MANAGER_COPY }
          : { open: true }
    return { kind: 'theirs', where, row, teamId: a.teamId, trade }
  }
  if (!input.myTeamId) return { kind: 'no_seat', where, row }

  if (a.kind === 'rostered') {
    const drop: Gate = !moves.open ? moves : row.lock.locked ? { open: false, reason: LOCKED_DROP_TITLE } : { open: true }
    return { kind: 'mine', where, row, drop, rosterPlayer: row.roster! }
  }

  const myTeam = input.rosters?.teams.find((t) => t.team_id === input.myTeamId)
  const myRoster = myTeam?.roster ?? []
  let { add, claim } = pickupActions(row, {
    waiverType: input.waiverType,
    window: input.waiverWindow,
    addTitle: a.kind === 'on_waivers' ? `On waivers until ${input.formatInstant(a.until)} — a claim gets him at that run; an add before then is refused.` : undefined,
    lockedAddTitle: LOCKED_ADD_TITLE,
    nextRunLocal: input.nextRunLocal,
    claimsLive: input.claimsLive,
  })
  if (!moves.open) {
    add = add.show ? { show: true, disabled: true, title: moves.reason } : add
    claim = claim.show ? { show: true, disabled: true, title: moves.reason } : claim
  }
  const faab = input.waiverType === 'faab' ? { min: input.minBid, max: myTeam?.faab_balance ?? null } : null
  return {
    kind: 'available',
    where,
    row,
    add,
    claim,
    acquire: acquireAction(row, add, claim, input.waiverWindow),
    nextRunLocal: input.nextRunLocal,
    needsDrop: myRoster.length >= input.rosterSize,
    faab,
    myRoster,
  }
}

/** The bid stepper's next value, held inside [min, max] (max null = no
 *  known balance — the server's answer is the rule then). */
export function stepBid(current: number, delta: number, bounds: { min: number; max: number | null }): number {
  const next = current + delta
  if (next < bounds.min) return bounds.min
  if (bounds.max !== null && next > bounds.max) return Math.max(bounds.min, bounds.max)
  return next
}

/** A bid the card may send: whole dollars inside the bounds. */
export function bidAllowed(bid: number, bounds: { min: number; max: number | null }): boolean {
  return Number.isInteger(bid) && bid >= bounds.min && (bounds.max === null || bid <= bounds.max)
}

/** The roster players a drop may name — never a locked one. */
export function droppable(roster: readonly RosterPlayer[], isLocked: (p: RosterPlayer) => boolean): RosterPlayer[] {
  return roster.filter((p) => !isLocked(p))
}

/** The plain-words confirmation for a lone drop. Where he lands (waivers or
 *  free agency) is the server's to say — the result line names it. */
export function dropConfirmCopy(name: string): string {
  return `${name} leaves your roster, and other teams can pick him up.`
}

/**
 * The ONE "+" (Chris 2026-10-03: "just make it a plus button instead of claim
 * vs add" — D481). From the Add / Claim pair `pickupActions` already derives
 * from the server's rules, pick the single verb a press runs:
 *   - a live Claim while he is on waivers, or while the window is claims-only,
 *     wins — an Add there is the one the server refuses;
 *   - otherwise a live Add (free agency is open, or there are no waivers);
 *   - with the window unknown, a free agent is an Add (the server decides);
 *   - nothing live: the + is disabled with the closed door's reason.
 */
export type Acquire =
  | { kind: 'add' | 'claim'; disabled: false }
  | { kind: 'none'; disabled: true; title: string | undefined }

export function acquireAction(
  row: Pick<PoolPlayerRow, 'availability'>,
  add: ActionState,
  claim: ActionState,
  window: Pick<WaiverWindowView, 'free_agency_open'> | null | undefined,
): Acquire {
  const addLive = add.show && !add.disabled
  const claimLive = claim.show && !claim.disabled
  if (claimLive && (row.availability.kind === 'on_waivers' || (window && !window.free_agency_open) || !addLive)) {
    return { kind: 'claim', disabled: false }
  }
  if (addLive) return { kind: 'add', disabled: false }
  const title = (add.show && add.disabled ? add.title : undefined) ?? (claim.show && claim.disabled ? claim.title : undefined)
  return { kind: 'none', disabled: true, title }
}

/** The +'s accessible name: what a press does, with his name. */
export function acquireLabel(kind: Acquire['kind'], name: string): string {
  return kind === 'claim' ? `Claim ${name}` : `Add ${name}`
}

/** What a placed claim says, in plain words. */
export function claimPlacedCopy(name: string, nextRunLocal: string | null): string {
  return nextRunLocal ? `Claim placed for ${name} — processes ${nextRunLocal}.` : `Claim placed for ${name} — processes at the next waiver run.`
}

/** A league's status line in the global card's expander. */
export function leagueRowStatus(row: PoolPlayerRow): string {
  const a = row.availability
  if (a.kind === 'rostered') return a.mine ? 'On your team' : `On ${a.teamName}`
  if (a.kind === 'on_waivers') return 'On waivers'
  return 'Free agent'
}
