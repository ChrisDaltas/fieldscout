/**
 * The user's own rankings as the phone lists them: ONE per position on each
 * of their boards — the season board and every weekly board this season (a
 * mobile "ranking" is one position's slice of a board, see `rankings-ops`).
 *
 * One derivation for every phone screen that lists them, so they always
 * agree: My rankings' cards, Profile › My stuff › Rankings' rows (gap list
 * §3 #22) and the count on Home's Rankings tile.
 */
import {
  RANK_POSITIONS,
  fromDbPos,
  isRankType,
  rankingScoring,
  scoringFromFormat,
  type RankPos,
  type RankType,
  type Scoring,
} from '@/components/mobile/rankings/rankings-ops'
import { latestSaved, type BoardPlayerLite, type MyBoard, type MyRankingBoards } from '@/hooks/use-mobile-rankings-boards'

export interface PositionRanking {
  /** `season-RB`, `w5-QB` — unique across the user's rankings. */
  key: string
  type: RankType
  pos: RankPos
  /** The position's players, in board order. */
  rows: BoardPlayerLite[]
  /** The latest save across those rows. */
  savedAt: string | null
  /** The scoring it is for — what the editor opens it on: the board's saved
   *  scoring, else Half PPR (`rankingScoring`). */
  scoring: Scoring
}

function slices(board: MyBoard, type: RankType): PositionRanking[] {
  const byPos = new Map<RankPos, BoardPlayerLite[]>()
  for (const r of board.players) {
    const pos = fromDbPos(r.player.position)
    if (!pos) continue
    const arr = byPos.get(pos) ?? []
    arr.push(r)
    byPos.set(pos, arr)
  }
  const scoring = rankingScoring(null, scoringFromFormat(board.scoringFormat))
  return RANK_POSITIONS.flatMap((pos) => {
    const rows = byPos.get(pos)
    if (!rows || rows.length === 0) return []
    return [{ key: `${type}-${pos}`, type, pos, rows, savedAt: latestSaved(rows), scoring }]
  })
}

/**
 * Every ranking the user has: the season board's first, then each week's in
 * week order; within a board, positions in the app's order (QB, RB, WR, TE,
 * K, D/ST). A position with no players on a board is no ranking; a week
 * outside 1–18 is none either.
 */
export function positionRankings(boards: MyRankingBoards): PositionRanking[] {
  const out: PositionRanking[] = boards.season ? slices(boards.season, 'season') : []
  for (const board of [...boards.weeks].sort((a, b) => a.week - b.week)) {
    const type = `w${board.week}`
    if (isRankType(type)) out.push(...slices(board, type))
  }
  return out
}
