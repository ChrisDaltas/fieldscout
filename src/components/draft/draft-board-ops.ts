/**
 * Board-grid derivation — pure model for `draft-board-grid.tsx` (M2 task
 * L.B3.2; spec §8.5.2 "full pick grid (rounds × teams)"; §16.2
 * `draft-board-grid`; tasks-M2 D90).
 *
 * The D90 split, applied cell by cell:
 *  - a MADE pick's cell renders from its actual `draft_picks` row — team,
 *    player, autopick flag all come from the row, never from order math
 *    (a commissioner reassign that moved the pick to another team renders
 *    the row's truth in place);
 *  - an EMPTY (future) cell is labeled by `teamForPick` (draft-order.ts,
 *    the SQL-parity-pinned display mirror) over the CURRENT stored
 *    `draft_order` — so an E31 post-start order edit re-derives every
 *    remaining cell the moment the drafts row broadcast lands;
 *  - the ON-CLOCK cell is whichever cell holds `current_pick_number` — the
 *    drafts row names it; this module never decides who is up (§8.1).
 *
 * Undone picks are excluded (their number renders as open again — E4's
 * pool-return made visible); a re-pick of the same number lands as made
 * once its row arrives. Pure + wall-clock-free.
 */

import { roundForPick, slotIndexForPick, teamForPick, type OrderedDraftType } from './draft-order'

/** The pick-row slice the board consumes (DraftPickSummary-compatible). */
export interface BoardPickInput {
  pick_number: number
  team_id: string
  player_id: string
  is_auto: boolean | null
  is_undone: boolean | null
}

export interface BoardCell {
  pickNumber: number
  round: number
  /** 0-based column (round-1 slot) this pick lands in on the grid. */
  slotIndex: number
  /** Owning team: the made row's `team_id`, else the D90-predicted slot
   *  owner (null only when the order math cannot answer). */
  teamId: string | null
  /** Made pick's player; null for an open cell. */
  playerId: string | null
  isAuto: boolean
  isOnClock: boolean
}

export interface BoardModel {
  /** Column order = the stored round-1 `draft_order`. */
  order: string[]
  totalRounds: number
  /** rows[round-1][slotIndex] — every cell present, made or open. */
  rows: BoardCell[][]
}

export interface BoardModelInput {
  /** `drafts.draft_order` as parsed team ids (may be empty pre-order). */
  order: readonly string[]
  /** `drafts.total_rounds` (null-safe: non-positive ⇒ empty model). */
  totalRounds: number | null
  draftType: OrderedDraftType
  snakeReversal: boolean
  picks: readonly BoardPickInput[]
  currentPickNumber: number | null
}

/** `drafts.draft_order` JSONB → team-id array (strings only, else []). */
export function parseDraftOrder(order: unknown): string[] {
  if (!Array.isArray(order)) return []
  return order.filter((v): v is string => typeof v === 'string')
}

export function buildBoardModel(input: BoardModelInput): BoardModel {
  const order = [...input.order]
  const teamCount = order.length
  const totalRounds = input.totalRounds ?? 0
  if (teamCount < 1 || totalRounds < 1) {
    return { order, totalRounds: 0, rows: [] }
  }

  // One live (non-undone) row per pick number — E1's unique index promises
  // it; a duplicate here would mean the cache is mid-reconcile, and last
  // row wins until the refetch settles.
  const liveByNumber = new Map<number, BoardPickInput>()
  for (const pick of input.picks) {
    if (!pick.is_undone) liveByNumber.set(pick.pick_number, pick)
  }

  const rows: BoardCell[][] = []
  for (let round = 1; round <= totalRounds; round++) {
    const row: BoardCell[] = new Array(teamCount)
    for (let offset = 0; offset < teamCount; offset++) {
      const pickNumber = (round - 1) * teamCount + offset + 1
      const slotIndex =
        slotIndexForPick(pickNumber, teamCount, input.draftType, input.snakeReversal) ?? offset
      const made = liveByNumber.get(pickNumber)
      row[slotIndex] = {
        pickNumber,
        round,
        slotIndex,
        teamId: made
          ? made.team_id
          : teamForPick(pickNumber, order, input.draftType, input.snakeReversal),
        playerId: made ? made.player_id : null,
        isAuto: Boolean(made?.is_auto),
        isOnClock: input.currentPickNumber === pickNumber,
      }
    }
    rows.push(row)
  }

  return { order, totalRounds, rows }
}

/**
 * The §16.4 mobile ticker: the last `count` MADE picks (newest first) —
 * round/team/player chips the narrow room leads with; the on-clock cell
 * renders separately from the drafts row.
 */
export function recentPicks(
  picks: readonly BoardPickInput[],
  count: number,
): BoardPickInput[] {
  return picks
    .filter((p) => !p.is_undone)
    .sort((a, b) => b.pick_number - a.pick_number)
    .slice(0, count)
}

/** Pick-in-round label ("3.04" — round.slot-in-round) for dense cells. */
export function pickLabel(pickNumber: number, teamCount: number): string {
  if (teamCount < 1 || pickNumber < 1) return String(pickNumber)
  const round = roundForPick(pickNumber, teamCount)
  const inRound = ((pickNumber - 1) % teamCount) + 1
  return `${round}.${String(inRound).padStart(2, '0')}`
}

/**
 * §16.3 "my next pick — always visible": the first pick number ≥ `fromPick`
 * the order math assigns to `teamId`, or null when none remain (or the
 * inputs can't answer). Display-only, like everything here — an E31 order
 * edit re-derives it the moment the new `draft_order` lands.
 */
export function nextPickNumberForTeam(
  order: readonly string[],
  draftType: OrderedDraftType,
  snakeReversal: boolean,
  fromPick: number | null,
  totalRounds: number | null,
  teamId: string | null,
): number | null {
  const teamCount = order.length
  const lastPick = teamCount * (totalRounds ?? 0)
  if (!teamId || fromPick === null || fromPick < 1 || lastPick < 1) return null
  for (let pick = fromPick; pick <= lastPick; pick++) {
    if (teamForPick(pick, order, draftType, snakeReversal) === teamId) return pick
  }
  return null
}
