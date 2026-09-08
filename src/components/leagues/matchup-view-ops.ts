/**
 * Pure helpers for `matchup-view.tsx` — M4 task L.D5.2 (spec §11.4, §16.2
 * `matchup-view`, §16.5.3 the scoring-mode variants, §16.5.4 the badge
 * lifecycle; PROGRESS D295/D296/D298/D321(4)/Q42). The `-ops` split
 * (`standings-table-ops.ts`, `schedule-view-ops.ts`): every decision the
 * view makes over the server's payloads lives here, node-testable, and the
 * component keeps only the hooks and the markup.
 *
 * NOTHING HERE COMPUTES A SCORE, A LOCK OR A COUNTDOWN. Every number is the
 * server's — `matchups.home_score` / `away_score` (the door's), a
 * `team_week_results.points` row, `league_weeks.median_score`, a box line's
 * `points` (the worker's function, run server-side) — and every state is a
 * stored status (`league_weeks.status`, `matchups.status`, `nfl_games.status`).
 * No clock is read (§23.3; the F226 posture extends to the UI: render the
 * server's instants, compute nothing).
 */
import type { BoxStarter, StarterPhase, TeamBoxScore } from '@/lib/leagues/api/box-score-service'
import type { MatchupRow, TeamWeekResultRow, WeekMatchups } from '@/lib/leagues/api/matchups-service'
import type { ScheduleWeek } from '@/hooks/use-schedule'

import { currentWeekOf } from './lineup-editor-ops'
import { formatScore, weekKind, weekStatusBadge } from './schedule-view-ops'
import { formatPoints } from './standings-table-ops'

export { formatPoints }

// ---------------------------------------------------------------------------
// Copy — single-sourced (§16.5.4 "designed copy, not blank")
// ---------------------------------------------------------------------------

export const NO_MATCHUPS_COPY = 'No matchups on record for this week.'
/** A playoff week before its round exists: the bracket is (re)built at the
 *  prior stage's ROLLOVER (`nfl_weeks.last_game_ends_at` — Q39 (E), 118). */
export const PLAYOFF_ROUND_PENDING_COPY = 'Playoff week — the pairings appear when the previous round rolls over.'
export const NO_LEADERBOARD_ROWS_COPY = 'No scores yet this week — the field fills in as the first scoring batch lands.'
export const NO_LINEUP_COPY = 'No lineup on record for this week.'
export const NO_STARTERS_COPY = 'Every starting slot is empty.'
export const NO_WEEK_COPY = 'No schedule yet — it is generated the moment the draft completes.'
export const PENDING_SCORE_COPY = 'pending'
export const WEEK_NOT_STARTED_TITLE = 'No score yet — the week has not started.'
export const PENDING_SCORE_TITLE =
  'Pending — a starter has an undelivered stat, or no scoring batch has reached this team yet (E61: never shown as 0.00).'
export const BOX_SUM_LABEL = 'Box total'
export const LEADERBOARD_TITLE = 'Week leaderboard'
export const MEDIAN_ROW_LABEL = 'vs League Median'
export const MEDIAN_PENDING_TITLE = 'The median line renders once every score of the week is in (§11.7).'
export const SECOND_CHIP_LABEL = '2nd opponent'

// ---------------------------------------------------------------------------
// The week badge — §16.5.4 `final (pending corrections)` → `final`
// ---------------------------------------------------------------------------

export type WeekBadgeState = 'upcoming' | 'live' | 'pending_corrections' | 'final'

export interface WeekBadge {
  state: WeekBadgeState
  label: string
  variant: ReturnType<typeof weekStatusBadge>['variant']
  title: string
}

const WEEK_BADGE_TITLES: Record<WeekBadgeState, string> = {
  upcoming: 'The week has not started.',
  live: 'Scores update as the pipeline writes them.',
  pending_corrections: 'Every game is over; an official stat correction inside the window still recomputes this matchup (§23.4).',
  final: 'Finalized — only a commissioner override changes it now (§10).',
}

/**
 * THE badge lifecycle, driven by `league_weeks.status` as the server holds
 * it (D295: `correction_window` IS "final (pending corrections)"; 116's
 * `finalize_matchups` flips the week to `final` after the window closes and
 * every game is final — the client never decides that). `upcoming` and
 * `live` are the two states before it. The LABEL and VARIANT are the
 * schedule grid's own (`weekStatusBadge`, L.D5.3 — one spelling of the
 * §16.5.4 vocabulary across the two surfaces); this adds the named state
 * the lifecycle pins assert on and the hover title.
 */
export function weekBadge(weekStatus: string): WeekBadge {
  const { label, variant } = weekStatusBadge(weekStatus)
  const state: WeekBadgeState =
    weekStatus === 'live' ? 'live' : weekStatus === 'correction_window' ? 'pending_corrections' : weekStatus === 'final' ? 'final' : 'upcoming'
  return { state, label, variant, title: WEEK_BADGE_TITLES[state] }
}

export const OVERRIDDEN_LABEL = '✸ Adjusted'
export const OVERRIDDEN_TITLE = 'Commissioner-adjusted — the stored scores and result stand as written (§22.2).'

// ---------------------------------------------------------------------------
// Scores and results — the server's cells, rendered
// ---------------------------------------------------------------------------

export interface ScoreCell {
  text: string
  title: string | null
  pending: boolean
}

/** A team score as the door wrote it: a number, or NULL — the write door's
 *  word for pending (E61 / F241(a); the R788 posture: never 0.00). The TEXT
 *  is the schedule grid's `formatScore` (one spelling: a `scheduled` row's
 *  NULL is a dash — "no score yet" — and an open row's NULL is `pending`);
 *  this adds the hover title. */
export function scoreCell(score: number | null, matchupStatus: string): ScoreCell {
  const text = formatScore(score, matchupStatus)
  if (score !== null) return { text, title: null, pending: false }
  if (matchupStatus === 'scheduled') return { text, title: WEEK_NOT_STARTED_TITLE, pending: false }
  return { text, title: PENDING_SCORE_TITLE, pending: true }
}

export type ResultVariant = 'green' | 'pink' | 'stroke'

export interface ResultChip {
  text: string
  variant: ResultVariant
  title: string
  decided: boolean
}

/** A stored `result` (E38's derivation, 116/117) as a chip. `null` is "not
 *  decided" — a live week, or a pending score — never inferred from the
 *  scores on the client. */
export function resultChip(result: string | null | undefined): ResultChip {
  switch (result) {
    case 'win':
      return { text: 'W', variant: 'green', title: 'Win', decided: true }
    case 'loss':
      return { text: 'L', variant: 'pink', title: 'Loss', decided: true }
    case 'tie':
      return { text: 'T', variant: 'stroke', title: 'Tie (two-decimal — E38)', decided: true }
    case 'bye':
      return { text: 'Bye', variant: 'stroke', title: 'Bye week — no opponent', decided: true }
    default:
      return { text: '—', variant: 'stroke', title: 'Not decided — the result is written at finalization.', decided: false }
  }
}

// ---------------------------------------------------------------------------
// The box lines — the worker's three starter states (D321(4)), rendered
// ---------------------------------------------------------------------------

export type StarterCellTone = 'scored' | 'pending' | 'zero_by_name' | 'yet_to_play' | 'bye' | 'empty' | 'unknown'

export interface StarterCell {
  text: string
  title: string | null
  tone: StarterCellTone
}

export const PENDING_STARTER_TITLE_PREFIX = 'Pending — not delivered yet: '
export const ZERO_BY_NAME_TITLE = 'No stat line on record for this game — scored 0 by name (Q42, open).'
export const PLAYING_NO_LINE_TITLE = 'Playing — no stat line yet; counts as 0 until one lands (Q42, open).'
export const YET_TO_PLAY_TITLE = 'Yet to play — counts as 0 until a stat line lands (Q42, open).'
export const BYE_TITLE = 'Bye week — no game on record for this team; scores 0 (§11.2).'
export const EMPTY_SEAT_TITLE = 'Empty slot.'
export const UNKNOWN_PLAYER_TITLE = 'Player not found — not scored.'

/**
 * One starter's points cell. PENDING (E61) renders as the word, NEVER a
 * number — a starter with an undelivered applicable key holds his team at
 * NULL and the cell says so. NO STAT LINE is the worker's "0 by name"
 * (Q42): in a game that is DONE the cell shows the 0.00 the worker scored
 * with the reason in its title; before or during his game the cell shows a
 * dash with the same reason (the number is 0 either way — the dash is a
 * presentation of "nothing landed yet", not a different score). A bye is
 * §11.2's own reading and scores 0.
 */
export function starterCell(starter: Pick<BoxStarter, 'points' | 'pending' | 'reason' | 'phase'>): StarterCell {
  if (starter.reason === 'empty') return { text: '—', title: EMPTY_SEAT_TITLE, tone: 'empty' }
  if (starter.reason === 'unknown_player') return { text: '—', title: UNKNOWN_PLAYER_TITLE, tone: 'unknown' }
  if (starter.pending.length > 0) {
    return { text: PENDING_SCORE_COPY, title: `${PENDING_STARTER_TITLE_PREFIX}${starter.pending.join(', ')} (E61: never 0).`, tone: 'pending' }
  }
  if (starter.reason === 'no_stat_row') {
    if (starter.phase === 'bye') return { text: formatPoints(0), title: BYE_TITLE, tone: 'bye' }
    if (starter.phase === 'done') return { text: formatPoints(0), title: ZERO_BY_NAME_TITLE, tone: 'zero_by_name' }
    if (starter.phase === 'now_playing') return { text: '—', title: PLAYING_NO_LINE_TITLE, tone: 'yet_to_play' }
    return { text: '—', title: YET_TO_PLAY_TITLE, tone: 'yet_to_play' }
  }
  return { text: formatPoints(starter.points), title: null, tone: 'scored' }
}

/** The box's own sum, or pending: the worker's `computeTeamWeek` NULL (any
 *  starter pending — E61). */
export function boxSumCell(box: Pick<TeamBoxScore, 'points' | 'pending'>): ScoreCell {
  if (box.points !== null) return { text: formatPoints(box.points), title: null, pending: false }
  return {
    text: PENDING_SCORE_COPY,
    title: `${PENDING_STARTER_TITLE_PREFIX}${box.pending.map((p) => p.keys.join(', ')).join('; ')} (E61: never 0).`,
    pending: true,
  }
}

/** Live Mode's three groups (§11.4) — in this order; a bye is its own
 *  fourth so it never masquerades as "up next". */
export const PHASE_ORDER: readonly StarterPhase[] = ['now_playing', 'done', 'up_next', 'bye']
export const PHASE_LABELS: Record<StarterPhase, string> = {
  now_playing: 'Now playing',
  done: 'Done',
  up_next: 'Up next',
  bye: 'Bye',
}

export interface PhaseGroup {
  phase: StarterPhase
  label: string
  starters: BoxStarter[]
}

/** Starters grouped by phase in `PHASE_ORDER`, empty groups omitted; within
 *  a group the lineup's own slot order is kept. */
export function groupByPhase(starters: readonly BoxStarter[]): PhaseGroup[] {
  return PHASE_ORDER.map((phase) => ({
    phase,
    label: PHASE_LABELS[phase],
    starters: starters.filter((s) => s.phase === phase),
  })).filter((g) => g.starters.length > 0)
}

const LINE_LABELS: ReadonlyArray<[keyof NonNullable<BoxStarter['line']>, (n: number) => string]> = [
  ['pass_yards', (n) => `${n} pass yds`],
  ['pass_tds', (n) => `${n} pass TD`],
  ['interceptions', (n) => `${n} INT`],
  ['rush_yards', (n) => `${n} rush yds`],
  ['rush_tds', (n) => `${n} rush TD`],
  ['receptions', (n) => `${n} rec`],
  ['receiving_yards', (n) => `${n} rec yds`],
  ['receiving_tds', (n) => `${n} rec TD`],
  ['fumbles_lost', (n) => `${n} fum lost`],
  ['fg_made', (n) => `${n} FG`],
  ['def_sacks', (n) => `${n} sack${n === 1 ? '' : 's'}`],
  ['def_interceptions', (n) => `${n} INT`],
  ['def_tds', (n) => `${n} TD`],
  ['def_points_allowed', (n) => `${n} PA`],
]

/** The stored line as one glanceable string — non-zero headline stats
 *  only; an empty string for no line. */
export function lineSummary(line: BoxStarter['line']): string {
  if (!line) return ''
  const parts: string[] = []
  for (const [key, render] of LINE_LABELS) {
    const value = line[key]
    if (typeof value === 'number' && value !== 0) parts.push(render(value))
  }
  return parts.join(' · ')
}

/** A game's own state line for a Now Playing row — the provider's stored
 *  `quarter` / `game_clock` / score, never a clock. */
export function gameStateLine(game: BoxStarter['game']): string | null {
  if (!game) return null
  if (game.status === 'live') {
    const clock = [game.quarter !== null ? `Q${game.quarter}` : null, game.game_clock].filter(Boolean).join(' ')
    const score = game.home_score !== null && game.away_score !== null ? `${game.away_team} ${game.away_score} – ${game.home_team} ${game.home_score}` : `${game.away_team} @ ${game.home_team}`
    return clock ? `${score} · ${clock}` : score
  }
  if (game.status === 'final') {
    return game.home_score !== null && game.away_score !== null
      ? `Final · ${game.away_team} ${game.away_score} – ${game.home_team} ${game.home_score}`
      : `Final · ${game.away_team} @ ${game.home_team}`
  }
  return `${game.away_team} @ ${game.home_team}`
}

// ---------------------------------------------------------------------------
// The week — which matchup, which rows, which variant
// ---------------------------------------------------------------------------

/** `?week=` as the page received it: an integer 1–18 or nothing. */
export function weekFromParam(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined || value === '') return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 18 ? n : null
}

/**
 * The week a page shows. A matchup id names its own week through the
 * ladder (`useSchedule` carries every pairing); else the `?week=` param;
 * else the ladder's current week (`currentWeekOf` — D316(2): the greatest
 * started week, or the first) — the F248(b) product choice, the same one
 * the team page makes. `null` while the ladder is unknown and nothing else
 * names a week.
 */
export function resolveWeek(input: {
  matchupId: string | null
  weekParam: number | null
  weeks: readonly Pick<ScheduleWeek, 'week' | 'status'>[] | undefined
  matchups: readonly Pick<MatchupRow, 'id' | 'week'>[] | undefined
}): number | null {
  if (input.matchupId && input.matchups) {
    const row = input.matchups.find((m) => m.id === input.matchupId)
    if (row) return row.week
  }
  if (input.weekParam !== null) return input.weekParam
  if (!input.weeks) return null
  return currentWeekOf(input.weeks)
}

export function weekNav(weeks: readonly Pick<ScheduleWeek, 'week'>[], week: number): { prev: number | null; next: number | null } {
  const sorted = [...new Set(weeks.map((w) => w.week))].sort((a, b) => a - b)
  const prev = sorted.filter((w) => w < week).pop() ?? null
  const next = sorted.find((w) => w > week) ?? null
  return { prev, next }
}

/** The week's primary rows (`regular` / `playoff`) and its `secondary`
 *  rows (the second-opponent games 110 materialised — §11.7), in the
 *  service's order. */
export function splitRows(matchups: readonly MatchupRow[]): { primary: MatchupRow[]; secondary: MatchupRow[] } {
  return {
    primary: matchups.filter((m) => m.round_type !== 'secondary'),
    secondary: matchups.filter((m) => m.round_type === 'secondary'),
  }
}

/** Which primary row a page opens on: the one named in the URL when it is
 *  of this week; else the viewer's own; else the first. `null` for a week
 *  with no primary rows. */
export function selectedMatchup(primary: readonly MatchupRow[], matchupId: string | null, myTeamId: string | null): MatchupRow | null {
  if (primary.length === 0) return null
  if (matchupId) {
    const named = primary.find((m) => m.id === matchupId)
    if (named) return named
  }
  if (myTeamId) {
    const mine = primary.find((m) => m.home_team_id === myTeamId || m.away_team_id === myTeamId)
    if (mine) return mine
  }
  return primary[0]
}

export function teamName(doc: Pick<WeekMatchups, 'teams'>, teamId: string | null): string {
  if (!teamId) return 'Bye'
  return doc.teams.find((t) => t.id === teamId)?.name ?? teamId
}

export function teamResult(doc: Pick<WeekMatchups, 'results'>, teamId: string): TeamWeekResultRow | null {
  return doc.results.find((r) => r.team_id === teamId) ?? null
}

/** The H2H result chip for one side of a primary row: the stored `result`
 *  read from the row's perspective (`home` / `away` / `tie` / `bye`), or
 *  the finalized `h2h_result` when the results row exists. */
export function sideResult(row: Pick<MatchupRow, 'result' | 'home_team_id' | 'away_team_id'>, teamId: string, results: readonly TeamWeekResultRow[]): string | null {
  const final = results.find((r) => r.team_id === teamId)
  if (final?.h2h_result) return final.h2h_result
  if (row.result === null) return null
  if (row.away_team_id === null) return 'bye'
  if (row.result === 'tie') return 'tie'
  if (row.result === 'home') return row.home_team_id === teamId ? 'win' : 'loss'
  if (row.result === 'away') return row.away_team_id === teamId ? 'win' : 'loss'
  return row.result
}

// ---------------------------------------------------------------------------
// §16.5.3 variants
// ---------------------------------------------------------------------------

export interface MedianRow {
  /** `league_weeks.median_score` — the rounded store of the exact median
   *  116 compared; NULL until finalization writes it ("once all scores are
   *  in", §16.5.3). */
  median: number | null
  /** The team's `median_result` from its results row, or null. */
  result: string | null
}

/** The `median_game` second row for one team, or null when the setting is
 *  off. Its OWN W/L chip (§16.5.3), from the stored `median_result` — never
 *  compared on the client. */
export function medianRow(doc: Pick<WeekMatchups, 'league_week' | 'results'>, teamId: string, medianGame: boolean): MedianRow | null {
  if (!medianGame) return null
  return { median: doc.league_week.median_score, result: teamResult(doc, teamId)?.median_result ?? null }
}

export interface SecondChip {
  opponent_team_id: string | null
  /** The `secondary` row's live scores for the pair, when one exists. */
  score: number | null
  opponent_score: number | null
  result: string | null
}

/** The `second_opponent` second chip for one team (§16.5.3 — "two result
 *  chips per week, both feeding the record"): the finalized `second_result`
 *  when the results row exists, else the live `secondary` row's scores with
 *  no result yet. Null when the setting is off. */
export function secondChip(doc: Pick<WeekMatchups, 'matchups' | 'results'>, teamId: string, secondOpponent: boolean): SecondChip | null {
  if (!secondOpponent) return null
  const final = teamResult(doc, teamId)
  const row = doc.matchups.find((m) => m.round_type === 'secondary' && (m.home_team_id === teamId || m.away_team_id === teamId)) ?? null
  const home = row?.home_team_id === teamId
  return {
    opponent_team_id: final?.second_opponent_team_id ?? (row ? (home ? row.away_team_id : row.home_team_id) : null),
    score: row ? (home ? row.home_score : row.away_score) : null,
    opponent_score: row ? (home ? row.away_score : row.home_score) : null,
    result: final?.second_result ?? (row ? sideResult(row, teamId, []) : null),
  }
}

export interface LeaderboardRow {
  rank: number | null
  team_id: string
  name: string
  /** `team_week_results.points` — the worker's provisional row (F241(b):
   *  one per seated team at its first batch) or the final one. */
  points: number | null
  is_final: boolean
}

/**
 * The `total_points` weekly leaderboard (§16.5.3 — "matchup routes render a
 * weekly scores leaderboard instead"): every seated (non-retired) team,
 * ranked by its stored `points` descending; a team with NO results row is
 * PENDING at the bottom, unranked — the worker's absence is not a score
 * (R788 / F241(b): never zero-filled). Ties share a rank (1, 1, 3).
 */
export function leaderboardRows(doc: Pick<WeekMatchups, 'teams' | 'results'>): LeaderboardRow[] {
  const seated = doc.teams.filter((t) => t.status !== 'retired')
  const scored: LeaderboardRow[] = []
  const pending: LeaderboardRow[] = []
  for (const team of seated) {
    const row = teamResult(doc, team.id)
    if (row) scored.push({ rank: null, team_id: team.id, name: team.name, points: Number(row.points), is_final: row.is_final })
    else pending.push({ rank: null, team_id: team.id, name: team.name, points: null, is_final: false })
  }
  scored.sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || a.name.localeCompare(b.name))
  let rank = 0
  scored.forEach((row, i) => {
    if (i === 0 || row.points !== scored[i - 1].points) rank = i + 1
    row.rank = rank
  })
  return [...scored, ...pending]
}

/** The empty-state copy for an h2h week with no primary rows, BY REASON: a
 *  playoff week before its round exists (Q39 (E) — `weekKind` is the
 *  schedule grid's own regular/playoff reading, §7.3.1), else "none on
 *  record". */
export function emptyWeekCopy(week: number, weeks: readonly Pick<ScheduleWeek, 'week'>[], regularSeasonWeeks: number): string {
  if (weeks.length > 0) {
    const firstWeek = Math.min(...weeks.map((w) => w.week))
    if (weekKind(week, firstWeek, regularSeasonWeeks) === 'playoff') return PLAYOFF_ROUND_PENDING_COPY
  }
  return NO_MATCHUPS_COPY
}
