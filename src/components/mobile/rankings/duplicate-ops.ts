import { classifyCommunityList, SCORING_FORMAT_LABEL, scoringFormatOf } from '@/components/mobile/community/community-ops'
import {
  boardPositions,
  fromDbPos,
  isRankType,
  opensInWeek,
  rankPosLabel,
  toRankingsSearch,
  typeLabel,
  weekOf,
  weekStatus,
  type RankPos,
  type RankType,
} from '@/components/mobile/rankings/rankings-ops'
import type { MyRankingBoards } from '@/hooks/use-mobile-rankings-boards'
import { featureFlags } from '@/lib/feature-flags'
import { DEFAULT_RANKING_SCORING, type ScoringFormat } from '@/lib/lists/ranking-publish'

/**
 * Duplicate — someone else's ranking becomes YOUR ranking (Chris,
 * 2026-10-18: "the way that works is a user duplicates the ranking, no need
 * for some make a new one like this"; 2026-10-19: "If a user dupes some
 * popular ranking it then becomes their own").
 *
 * On any ranking that isn't yours — an AI expert's board, another user's
 * season or weekly ranking — Duplicate publishes its order as your ranking
 * for the same period (Rest of season / Pre-draft, or the same week) and the
 * same position(s), through the ranking publish routes (`publish-board.ts`).
 * It is not a list copy: the result is in Rankings › Mine, editable and
 * published like any ranking of yours. A plain list, and a ranking of your
 * own, keep the list Duplicate.
 *
 * The pure half: what a Duplicate copies, where, with which scoring, and what
 * it says.
 */

export interface RankingDuplicate {
  /** Your ranking it becomes: the season board, or that week's. */
  type: RankType
  /** 0 = the season board, else the week. */
  week: number
  /** Why it can't be duplicated now — a played week, or one not open yet —
   *  else null. The control shows it disabled with this reason. */
  blocked: string | null
}

/**
 * The Duplicate a list gets, or null when it gets the list Duplicate: a plain
 * list, a ranking of your own, or Rankings switched off (there is no Rankings
 * › Mine to put it in). A weekly board becomes your ranking for the same
 * week — this week and the next three can be ranked (the one week window),
 * so a played or not-yet-open week can't be duplicated now.
 */
export function rankingDuplicateOf(
  list: { is_big_board: boolean | null; slug: string; ai_persona_id: string | null },
  opts: { owned: boolean; currentWeek: number; rankingsOn?: boolean },
): RankingDuplicate | null {
  if (opts.owned || !(opts.rankingsOn ?? featureFlags.weeklyRanks)) return null
  const c = classifyCommunityList(list)
  if (c.kind !== 'rank') return null
  const weekly = c.rankType === 'weekly' ? `w${c.week}` : null
  if (weekly !== null && !isRankType(weekly)) return null
  const type: RankType = weekly ?? 'season'
  const week = weekOf(type)
  const status = weekStatus(type, opts.currentWeek)
  const blocked =
    status === 'past'
      ? `Week ${week} is over`
      : status === 'future'
        ? `Week ${week} opens in Week ${opensInWeek(week)}`
        : null
  return { type, week, blocked }
}

interface SourceRow {
  player_id: string
  player: { position: string | null } | null
}

/** The positions a ranking ranks anyone at, in chip order. */
export function rankedPositions(rows: readonly SourceRow[]): RankPos[] {
  return boardPositions(rows.flatMap((r) => (r.player ? [{ position: r.player.position }] : [])))
}

/** The copied ranking's players at those positions, in its own order. */
export function duplicateOrder(rows: readonly SourceRow[], positions: readonly RankPos[]): string[] {
  const copied = new Set(positions)
  const out: string[] = []
  for (const r of rows) {
    const p = fromDbPos(r.player?.position)
    if (p && copied.has(p) && !out.includes(r.player_id)) out.push(r.player_id)
  }
  return out
}

export interface DuplicateScoring {
  /** The scoring your ranking is published with. */
  format: ScoringFormat
  /** Your board already had a scoring, and it stays. */
  keptYours: boolean
  /** The copied ranking's scoring (Half PPR when it has none saved). */
  original: ScoringFormat
}

/**
 * A board has ONE scoring for every position, so a Duplicate never relabels
 * the positions it doesn't copy: when your board for that period already has
 * a scoring, it stays; when it has none yet (a week not ranked before, a
 * board never published), the copy takes the original's — Half PPR when the
 * original has none saved (Chris, 2026-10-16).
 */
export function duplicateScoring(yours: unknown, original: unknown): DuplicateScoring {
  const mine = scoringFormatOf({ scoring_format: yours })
  const theirs = scoringFormatOf({ scoring_format: original }) ?? DEFAULT_RANKING_SCORING
  return mine ? { format: mine, keptYours: true, original: theirs } : { format: theirs, keptYours: false, original: theirs }
}

/** "RB", "RB and WR", "QB, RB and WR". */
export function positionsLabel(positions: readonly RankPos[]): string {
  const names = positions.map(rankPosLabel)
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Do you already have a ranking at any of these positions for that period?
 *  Then Duplicate asks before it replaces it (never silently). */
export function hasRankingAt(boards: MyRankingBoards | undefined, week: number, positions: readonly RankPos[]): boolean {
  const board = week === 0 ? boards?.season : boards?.weeks.find((w) => w.week === week)
  if (!board) return false
  const copied = new Set(positions)
  return board.players.some((r) => {
    const p = fromDbPos(r.player.position)
    return p !== null && copied.has(p)
  })
}

/** The question before a Duplicate replaces a ranking you have:
 *  "Replace your Week 7 RB ranking with this one?" */
export function replaceQuestion(type: RankType, positions: readonly RankPos[], currentWeek: number): string {
  const many = positions.length > 1
  return `Replace your ${typeLabel(type, currentWeek)} ${positionsLabel(positions)} ranking${many ? 's' : ''} with this one?`
}

/** The question when there's nothing to replace (desktop always asks). */
export function duplicateQuestion(type: RankType, positions: readonly RankPos[], currentWeek: number): string {
  const many = positions.length > 1
  return `Duplicate this as your ${typeLabel(type, currentWeek)} ${positionsLabel(positions)} ranking${many ? 's' : ''}?`
}

export const DUPLICATED_TITLE = 'Duplicated — it’s your ranking now'

/** The confirmation (a rounded-rectangle toast). It says so when your
 *  board's own scoring was kept over a different one on the original. */
export function duplicatedToast(scoring: DuplicateScoring, scoringError?: string): { title: string; description?: string } {
  if (scoringError) return { title: DUPLICATED_TITLE, description: `Its scoring wasn't saved: ${scoringError}` }
  if (scoring.keptYours && scoring.format !== scoring.original) {
    return { title: DUPLICATED_TITLE, description: `It keeps your ${SCORING_FORMAT_LABEL[scoring.format]} scoring.` }
  }
  return { title: DUPLICATED_TITLE }
}

/** Your ranking in the phone's editor: Rankings › Mine, that period and
 *  position (the one the original leads with). */
export function myRankingEditorHref(type: RankType, pos: RankPos): string {
  return `/app/weekly-ranks${toRankingsSearch({ src: 'mine', scoring: 'ppr', pos, overlay: { kind: 'edit', type, pos, from: null } })}`
}

/** Your ranking on desktop: the Rankings page's Pre-draft tab (the season
 *  board) or that week's board. */
export function myRankingDesktopHref(week: number): string {
  return week === 0 ? '/app/weekly-ranks?tab=pre' : `/app/big-board/week/${week}`
}
