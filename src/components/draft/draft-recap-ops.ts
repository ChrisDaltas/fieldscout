/**
 * Draft-recap derivations (M2 task L.B3.5; spec §8.8 "a finished mock keeps
 * a recap (full board + your roster vs. the CPUs')", §16.1 `/draft/recap` —
 * "real & mock: final board + rosters"; D103). Pure — colocated ops split.
 *
 * THE roster source is `draft_picks`, for BOTH variants, deliberately:
 * a completed REAL draft also populates `league_rosters` (072/D88), but a
 * completed MOCK bypasses that table entirely (§8.8 zero side effects —
 * D103), so the picks sheet is the one source the two recaps share. The
 * member RLS SELECT covers both. Undone picks are audit history (§12.4) and
 * never appear on a recap roster — E4's pool-return, final-board edition.
 */

import type { DraftPickSummary } from '@/hooks/use-draft'
import type { Draft } from '@/types/database'

import { roundForPick } from './draft-order'

// ---------------------------------------------------------------------------
// Variant resolution (mock vs real; the delete affordance is launcher-only)
// ---------------------------------------------------------------------------

export type RecapVariant =
  | {
      kind: 'mock'
      /** The practice seat (`config.mock.human_team_id` — D103(2)); null on
       *  a malformed config (render every roster undifferentiated). */
      humanTeamId: string | null
      /** §8.8: the recap's delete belongs to the LAUNCHER alone (the RPC
       *  refuses everyone else — the UI must not offer it more widely). */
      canDelete: boolean
    }
  | {
      kind: 'real'
      /** The viewer's franchise (leads the roster list); null for a
       *  seatless viewer (co-owners, departed managers, commissioners). */
      myTeamId: string | null
    }

/** Resolve which recap this draft renders for this viewer. */
export function recapVariant(
  draft: Pick<Draft, 'is_mock' | 'config'>,
  userId: string | null,
  myMemberTeamId: string | null,
): RecapVariant {
  if (!draft.is_mock) return { kind: 'real', myTeamId: myMemberTeamId }
  const config = draft.config as {
    mock?: { human_team_id?: string; launched_by?: string }
  } | null
  const mock = config?.mock ?? null
  return {
    kind: 'mock',
    humanTeamId: mock?.human_team_id ?? null,
    canDelete: Boolean(mock?.launched_by && userId && mock.launched_by === userId),
  }
}

// ---------------------------------------------------------------------------
// Rosters from the picks sheet (the shared derivation — both variants)
// ---------------------------------------------------------------------------

export interface RecapRoster {
  teamId: string
  /** This team's LIVE picks, ascending by pick number. */
  picks: DraftPickSummary[]
}

/**
 * Per-team rosters derived from `draft_picks` — non-undone rows only,
 * ascending by pick number within each team. NEVER `league_rosters` (a mock
 * has none to read — D103; one derivation serves both variants).
 */
export function recapRostersFromPicks(
  picks: readonly DraftPickSummary[],
): Map<string, DraftPickSummary[]> {
  const byTeam = new Map<string, DraftPickSummary[]>()
  for (const pick of picks) {
    if (pick.is_undone) continue // audit history — reverted, never rostered
    const roster = byTeam.get(pick.team_id)
    if (roster) roster.push(pick)
    else byTeam.set(pick.team_id, [pick])
  }
  for (const roster of byTeam.values()) {
    roster.sort((a, b) => a.pick_number - b.pick_number)
  }
  return byTeam
}

/**
 * The roster-section team order: the stored draft order, with the viewer's
 * anchor seat FIRST — the mock's human seat ("your roster vs the CPUs'",
 * §8.8) or the real viewer's own franchise. Teams that only appear in picks
 * (a defensive arm — e.g. an order the parser rejected) append after, so no
 * roster silently drops.
 */
export function recapTeamOrder(
  order: readonly string[],
  rosters: ReadonlyMap<string, DraftPickSummary[]>,
  anchorTeamId: string | null,
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  const push = (teamId: string) => {
    if (!seen.has(teamId)) {
      seen.add(teamId)
      result.push(teamId)
    }
  }
  if (anchorTeamId) push(anchorTeamId)
  for (const teamId of order) push(teamId)
  for (const teamId of rosters.keys()) push(teamId)
  return result
}

// ---------------------------------------------------------------------------
// Auction spend (M3 task L.C3.2 item 3 — "prices on the final board, per-team
// total spent + biggest buy")
// ---------------------------------------------------------------------------

/** What a team spent, and the buy that cost the most. */
export interface RecapSpend {
  /** Σ price over this team's LIVE picks. Rows with a null price contribute
   *  0 — an auction award always writes one (086), so a null here is a snake
   *  row or a hint row that has not reconciled, never a free player. */
  total: number
  /** The most expensive live buy; ties go to the EARLIER nomination (the
   *  first team to pay that much). Null when the team bought nothing. */
  biggest: DraftPickSummary | null
}

/** Per-team spend from the picks sheet — the same source the rosters use. */
export function recapTeamSpend(picks: readonly DraftPickSummary[]): RecapSpend {
  let total = 0
  let biggest: DraftPickSummary | null = null
  for (const pick of picks) {
    if (pick.is_undone) continue
    total += pick.price ?? 0
    if (
      biggest === null ||
      (pick.price ?? 0) > (biggest.price ?? 0) ||
      ((pick.price ?? 0) === (biggest.price ?? 0) && pick.pick_number < biggest.pick_number)
    ) {
      biggest = pick
    }
  }
  return { total, biggest }
}

/**
 * The AUCTION's final board: every live buy in nomination order.
 *
 * An auction has no rounds × teams grid to lay out — `pick_number` is the
 * nomination SEQUENCE, and which team won each one is a bid result, not a
 * board coordinate. Feeding those rows to `buildBoardModel` would put a pick
 * into whatever cell the snake mapping named and label it with the winner's
 * name, i.e. print a team's buy inside another team's column. The honest
 * final board is the order the money was spent in.
 */
export function recapBuysInOrder(picks: readonly DraftPickSummary[]): DraftPickSummary[] {
  return picks.filter((p) => !p.is_undone).sort((a, b) => a.pick_number - b.pick_number)
}

// ---------------------------------------------------------------------------
// The SNAKE/LINEAR flat cut (MP task MP.8 — D230(2)/(3): two column sets,
// never one table with blanks)
// ---------------------------------------------------------------------------

/** One drafted player, with the two coordinates a snake row is read by. */
export interface RecapDraftedRow {
  pick: DraftPickSummary
  /** 1-based round. */
  round: number
  /** 1-based slot WITHIN that round (the ".04" of "3.04"). */
  pickInRound: number
}

/**
 * The SNAKE/LINEAR sibling of `recapBuysInOrder` — every live pick in pick
 * order, each carrying the round and the slot-in-round it landed on.
 *
 * **Why this is a second derivation rather than a reuse.** `recapBuysInOrder`
 * answers the auction's question: `pick_number` there is a NOMINATION
 * sequence and there is no round at all, which is the whole reason D230(2)
 * refuses one table with a blank `round` column. Here `pick_number` is a
 * board coordinate, and the report's column set is *round · pick #* — so the
 * round has to be resolved rather than printed.
 *
 * **`round` is resolved, not trusted, and the fallback is not cosmetic.**
 * `draft_picks.round` is nullable on the wire (`DraftPickSummary.round`), and
 * an auction award writes NULL into it (066). A row whose stored round
 * disagrees with the arithmetic is a row the engine wrote out of band, so the
 * stored value wins when it is a sane positive integer and the arithmetic
 * fills in only when it is absent — printing a blank round would be the
 * "an empty column claims the value exists and is unknown" failure D230(2)
 * names, one column over.
 *
 * **`pickInRound` is ALWAYS the arithmetic, even when the stored round wins**
 * (R542). The two therefore come from different sources in the one case they
 * can disagree, and a `9.01` label is then a real round with a derived slot.
 * That is deliberate: the stored round is the ENGINE's record of which round a
 * pick belongs to, while the slot is a position within the sheet's own
 * numbering and has no stored counterpart to prefer — deriving it from the
 * stored round would invent a coordinate the sheet never assigned. Callers
 * that need the two to agree should print the round alone.
 *
 * `teamCount` is the number of seats (`draft_order.length`). With no seats to
 * divide by, the arithmetic cannot answer: the round falls back to the stored
 * value or 1 and the slot to the pick number, so a malformed draft still
 * prints its picks rather than rendering nothing.
 */
export function recapPicksByRound(
  picks: readonly DraftPickSummary[],
  teamCount: number,
): RecapDraftedRow[] {
  const live = picks.filter((p) => !p.is_undone).sort((a, b) => a.pick_number - b.pick_number)
  return live.map((pick) => {
    const derivedRound = roundForPick(pick.pick_number, teamCount)
    const storedRound =
      typeof pick.round === 'number' && Number.isInteger(pick.round) && pick.round > 0
        ? pick.round
        : null
    return {
      pick,
      round: storedRound ?? (derivedRound > 0 ? derivedRound : 1),
      pickInRound:
        teamCount > 0 && pick.pick_number > 0
          ? ((pick.pick_number - 1) % teamCount) + 1
          : pick.pick_number,
    }
  })
}
