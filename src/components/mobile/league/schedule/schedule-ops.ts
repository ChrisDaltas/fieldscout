import { NO_MATCHUPS_COPY, PLAYOFF_ROUND_PENDING_COPY, scoreCell } from '@/components/leagues/matchup-view-ops'
import type { MatchupCell, WeekCell } from '@/components/leagues/schedule-view-ops'

/**
 * Pure decisions for the phone's Schedule screen (`schedule-screen.tsx`,
 * gap list §4 item 107). The weeks themselves come from the desktop page's
 * own reading (`scheduleGrid` — the ladder plus every stored pairing); this
 * file only shapes them for a phone: which team sits on top of a game, which
 * games a team filter keeps, what a week with no game says, and where the
 * screen opens. Scores and results are the server's (`scoreCell`, the stored
 * `result`) — nothing here works one out.
 */

export const SCHEDULE_TITLE = 'Schedule'
export const ALL_TEAMS_LABEL = 'All teams'
/** The filtered team has no game in a week that has games. */
export const NO_GAME_COPY = 'No game this week.'
export const NO_PLAYOFF_GAME_COPY = 'No playoff game this week.'
/** A total-points league stores no pairings — said once, over the weeks. */
export const TOTAL_POINTS_SCHEDULE_COPY = 'No matchups — a total-points league scores the whole field each week.'
/** The commissioner's door to the console's Schedule section (F580 / D493:
 *  this is a member page; the edit and the remix live in the console). */
export const SCHEDULE_DOOR_TITLE = 'Change matchups or remix the schedule'
export const SCHEDULE_DOOR_NOTE = 'In Commissioner tools.'

/** "17 weeks · 14 regular season · 3 playoff" — the ladder's own count. */
export function seasonLine(weekCount: number, regularSeasonWeeks: number, totalPoints: boolean): string {
  const regular = Math.min(regularSeasonWeeks, weekCount)
  const playoff = weekCount - regular
  const parts = [`${weekCount} week${weekCount === 1 ? '' : 's'}`, `${regular} regular season`]
  if (playoff > 0) parts.push(`${playoff} playoff`)
  if (totalPoints) parts.push('total points')
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// The team filter (`?team=`)
// ---------------------------------------------------------------------------

/** The team the address asks for when it's one of the chips; otherwise
 *  null — every team. */
export function scheduleTeamFromParam(raw: string | null | undefined, teamIds: readonly string[]): string | null {
  return raw && teamIds.includes(raw) ? raw : null
}

/** The address for the filter on screen, keeping any other query. Every
 *  team is the bare address. */
export function scheduleSearch(search: string, teamId: string | null): string {
  const params = new URLSearchParams(search)
  if (teamId) params.set('team', teamId)
  else params.delete('team')
  const next = params.toString()
  return next ? `?${next}` : ''
}

/** The Schedule page, opened on one team (the Team tab's Schedule tile). */
export function scheduleHref(leagueId: string, teamId?: string | null): string {
  return `/app/leagues/${leagueId}/schedule${teamId ? `?team=${encodeURIComponent(teamId)}` : ''}`
}

// ---------------------------------------------------------------------------
// The weeks
// ---------------------------------------------------------------------------

export interface PhoneSide {
  id: string
  name: string
  /** The stored score as written (`scoreCell`): a number, "—" before the
   *  week starts, "pending" for an open score — never 0 by coercion. */
  score: string
  scoreTitle: string | null
  /** No score yet: the week hasn't started ("—"). */
  notStarted: boolean
  /** An open score ("pending"). */
  pending: boolean
  /** The stored result says this side lost. */
  lost: boolean
}

export interface PhoneRow {
  id: string
  roundType: string
  /** Consolation / Third place games say so; the title game and every
   *  regular-season game need no tag. */
  tag: string | null
  /** The filtered team (else yours, else the home team) on top. */
  top: PhoneSide
  /** null = a bye. */
  bottom: PhoneSide | null
  /** Your game — tinted, unless the filter is already your team. */
  mine: boolean
  tie: boolean
  overridden: boolean
  /** The home team — the commissioner log's filter for an adjusted game. */
  homeTeamId: string
}

export interface PhoneWeek {
  week: number
  status: string
  kind: 'regular' | 'playoff'
  isCurrent: boolean
  median: number | null
  /** The week's games (regular, playoff, consolation, third place). */
  primary: PhoneRow[]
  /** A second-opponent league's extra games, in their own group. */
  secondary: PhoneRow[]
  /** Why the week shows no game, by name — or null. */
  note: string | null
}

const ROUND_TAGS: Readonly<Record<string, string>> = {
  consolation: 'Consolation',
  third_place: 'Third place',
}

function side(id: string, name: string, score: number | null, matchupStatus: string, lost: boolean): PhoneSide {
  const cell = scoreCell(score, matchupStatus)
  return { id, name, score: cell.text, scoreTitle: cell.title, notStarted: score === null && !cell.pending, pending: cell.pending, lost }
}

function involves(row: Pick<MatchupCell, 'home' | 'away'>, teamId: string | null): boolean {
  return teamId !== null && (row.home.id === teamId || row.away?.id === teamId)
}

function phoneRow(row: MatchupCell, anchor: string | null, myTeamId: string | null, filter: string | null): PhoneRow {
  const home = side(row.home.id, row.home.name, row.home_score, row.status, row.result === 'away')
  const away = row.away ? side(row.away.id, row.away.name, row.away_score, row.status, row.result === 'home') : null
  const flip = away !== null && anchor !== null && away.id === anchor
  return {
    id: row.id,
    roundType: row.round_type,
    tag: ROUND_TAGS[row.round_type] ?? null,
    top: flip ? away : home,
    bottom: flip ? home : away,
    mine: involves(row, myTeamId) && filter !== myTeamId,
    tie: row.result === 'tie',
    overridden: row.is_overridden,
    homeTeamId: row.home.id,
  }
}

/** The anchor's game first, then the rest in the server's order (each group
 *  on its own — a second-opponent game never jumps the week's matchups). */
function anchorFirst(rows: readonly MatchupCell[], anchor: string | null): MatchupCell[] {
  const at = rows.findIndex((r) => involves(r, anchor))
  if (at <= 0) return [...rows]
  return [rows[at]!, ...rows.slice(0, at), ...rows.slice(at + 1)]
}

/**
 * The season as the phone shows it. With a team picked (`teamId`), each
 * week keeps only that team's games, the team on top; otherwise every game,
 * yours first and on top. A week with no game says why: a playoff week
 * before its round is set, a week with nothing on record, or — filtered — a
 * week the team doesn't play. A total-points league stores no pairings, so
 * its weeks carry no note (the page says it once).
 */
export function phoneWeeks(
  grid: readonly WeekCell[],
  opts: { teamId: string | null; myTeamId: string | null; currentWeek: number | null; totalPoints: boolean },
): PhoneWeek[] {
  const { teamId, myTeamId, currentWeek, totalPoints } = opts
  const anchor = teamId ?? myTeamId
  return grid.map((w) => {
    const kept = teamId ? w.rows.filter((r) => involves(r, teamId)) : w.rows
    const shape = (rows: MatchupCell[]) => anchorFirst(rows, anchor).map((r) => phoneRow(r, anchor, myTeamId, teamId))
    const primary = shape(kept.filter((r) => r.round_type !== 'secondary'))
    const secondary = shape(kept.filter((r) => r.round_type === 'secondary'))
    let note: string | null = null
    if (!totalPoints && kept.length === 0) {
      if (w.rows.length === 0) note = w.kind === 'playoff' ? PLAYOFF_ROUND_PENDING_COPY : NO_MATCHUPS_COPY
      else note = w.kind === 'playoff' ? NO_PLAYOFF_GAME_COPY : NO_GAME_COPY
    }
    return {
      week: w.week,
      status: w.status,
      kind: w.kind,
      isCurrent: w.week === currentWeek,
      median: w.median_score,
      primary,
      secondary,
      note,
    }
  })
}

/** The week the screen opens at: the ladder's current week, when the season
 *  has moved past its first week (before that the top of the page is the
 *  start of the season). Null = stay at the top. */
export function jumpWeek(weeks: readonly Pick<PhoneWeek, 'week'>[], currentWeek: number | null): number | null {
  if (currentWeek === null || weeks.length === 0) return null
  if (weeks[0]!.week === currentWeek) return null
  return weeks.some((w) => w.week === currentWeek) ? currentWeek : null
}

/** A game's spoken name for its door: "Week 3: Bench Mob vs Taco Tuesday". */
export function rowLabel(week: number, row: Pick<PhoneRow, 'top' | 'bottom'>): string {
  return `Week ${week}: ${row.top.name} ${row.bottom ? `vs ${row.bottom.name}` : '— bye'}`
}
