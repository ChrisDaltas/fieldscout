/**
 * League Menu › Draft results on the phone (handoff m-community G3; gap list
 * §3 #15): the league's finished draft, one round at a time behind round
 * chips, with your own picks' team name in blue — or By team, one team's
 * picks at a time (the desktop recap's rosters, kept on the phone). Pure —
 * the screen is `draft-results-screen.tsx`.
 *
 * The rows come from the desktop recap's own derivations (`draft-recap-ops`)
 * over the same `draft_picks` read, so the two layouts can never disagree:
 * undone picks never show, a snake/linear pick reads "round.slot", and an
 * AUCTION — which has no rounds (`pick_number` is the nomination order) — is
 * one list of every buy in nomination order with its price, never round
 * chips over a board it doesn't have. The By team view uses the recap's
 * team order (yours first) and, on an auction, its per-team spend.
 */

import {
  recapBuysInOrder,
  recapPicksByRound,
  recapRostersFromPicks,
  recapTeamOrder,
  recapTeamSpend,
  type RecapSpend,
} from '@/components/draft/draft-recap-ops'
import type { DraftPickSummary } from '@/hooks/use-draft'

/** One row of the results list. */
export interface DraftResultRow {
  /** The pick number — unique within a draft (the React key). */
  pickNumber: number
  /** The left column: "1.06" (snake/linear) or the price, "$45" (auction). */
  label: string
  /** 1-based round (snake/linear); null on an auction row. */
  round: number | null
  playerId: string
  teamId: string
  /** The viewer's own pick — its team name is drawn in blue. */
  mine: boolean
  /** Made by the autodrafter rather than the manager. */
  auto: boolean
}

/**
 * Every live pick as a results row, in pick order. `teamCount` is the
 * number of seats (`draft_order.length`) the "round.slot" label divides by;
 * `myTeamId` is the team whose picks are yours (null — a seatless viewer —
 * marks none).
 */
export function draftResultRows(
  picks: readonly DraftPickSummary[],
  opts: { auction: boolean; teamCount: number; myTeamId: string | null },
): DraftResultRow[] {
  const mine = (teamId: string) => opts.myTeamId !== null && teamId === opts.myTeamId
  if (opts.auction) {
    return recapBuysInOrder(picks).map((pick) => ({
      pickNumber: pick.pick_number,
      label: `$${pick.price ?? 0}`,
      round: null,
      playerId: pick.player_id,
      teamId: pick.team_id,
      mine: mine(pick.team_id),
      auto: pick.is_auto === true,
    }))
  }
  return recapPicksByRound(picks, opts.teamCount).map(({ pick, round, pickInRound }) => ({
    pickNumber: pick.pick_number,
    label: `${round}.${String(pickInRound).padStart(2, '0')}`,
    round,
    playerId: pick.player_id,
    teamId: pick.team_id,
    mine: mine(pick.team_id),
    auto: pick.is_auto === true,
  }))
}

/**
 * How many round chips to draw: the league's real round count (the design's
 * six are placeholder data), or more if a pick landed past it — never fewer
 * than one, so a draft that stored no round count still has a chip.
 */
export function draftRoundCount(totalRounds: number | null, rows: readonly DraftResultRow[]): number {
  let count = typeof totalRounds === 'number' && Number.isInteger(totalRounds) && totalRounds > 0 ? totalRounds : 0
  for (const row of rows) if (row.round !== null && row.round > count) count = row.round
  return Math.max(1, count)
}

/** The rows of one round, in pick order. */
export function rowsInRound(rows: readonly DraftResultRow[], round: number): DraftResultRow[] {
  return rows.filter((row) => row.round === round)
}

/** The round the address asks for (`?round=`), kept within the draft's
 *  rounds; Round 1 when it asks for none or for nonsense. */
export function roundFromParam(raw: string | null | undefined, roundCount: number): number {
  const n = raw != null && /^\d+$/.test(raw) ? Number(raw) : 1
  return Math.min(Math.max(n, 1), Math.max(1, roundCount))
}

/**
 * The By team chips, in the desktop recap's order: your team (or the
 * practice seat) first, then the draft order, then any team that only shows
 * up in the picks — so no team's picks silently drop.
 */
export function draftResultTeams(
  order: readonly string[],
  picks: readonly DraftPickSummary[],
  myTeamId: string | null,
): string[] {
  return recapTeamOrder(order, recapRostersFromPicks(picks), myTeamId)
}

/** One team's rows, in pick order. */
export function rowsForTeam(rows: readonly DraftResultRow[], teamId: string): DraftResultRow[] {
  return rows.filter((row) => row.teamId === teamId)
}

/** An auction team's money: what it spent and its biggest buy (the desktop
 *  recap's `recapTeamSpend` over the same picks). */
export function draftTeamSpend(picks: readonly DraftPickSummary[], teamId: string): RecapSpend {
  return recapTeamSpend(picks.filter((pick) => pick.team_id === teamId))
}

/** The team the address asks for (`?team=`) when it's one of this draft's;
 *  otherwise the first chip (yours). Null only for a draft with no teams. */
export function teamFromParam(raw: string | null | undefined, teams: readonly string[]): string | null {
  if (raw && teams.includes(raw)) return raw
  return teams[0] ?? null
}

/**
 * The address for what's on screen, keeping any other query (`?draft=`):
 * `?team=` while By team is open (dropped for By round), `?round=` past
 * Round 1 (Round 1 is the bare address). The round rides along in By team
 * so switching back lands where you were.
 */
export function resultsSearch(search: string, at: { round: number; team: string | null }): string {
  const params = new URLSearchParams(search)
  if (at.round <= 1) params.delete('round')
  else params.set('round', String(at.round))
  if (at.team) params.set('team', at.team)
  else params.delete('team')
  const next = params.toString()
  return next ? `?${next}` : ''
}

/** Said under the header when a round has no picks (a draft that ended
 *  before its last round) — the design leaves it blank. */
export const EMPTY_ROUND_COPY = 'No picks in this round.'

/** Said when the league has no finished draft to show yet. */
export const NO_RESULTS_COPY = 'Results show up here once your draft is done.'

/** Said when a team made no picks on the final board. */
export const EMPTY_TEAM_COPY = 'No picks for this team.'

/** The line over an auction's list (it has no rounds to chip). */
export const AUCTION_LINE = 'Every buy, in the order it was nominated.'

/** A practice draft's note (the desktop recap's mock banner, in short). */
export const MOCK_LINE = 'Practice draft — nothing here touches your league.'
