/**
 * Pure helpers for `corrections-view.tsx`, the matchup page's correction
 * note and the box score's stored-points note — M6 task L.E2.4 (spec §23.4
 * "Stat Corrections" view, §16.2 `corrections-view`, §16.5.2 *Stat
 * corrections*, §7.3.6 `stat_correction_window`; tasks-M6 §6 L.E2.4 read
 * through Q81 / Q86; PROGRESS D454 / D456, F475 / F477 / F527 / F510).
 *
 * The `-ops` split (`matchup-view-ops.ts`, `activity-feed-ops.ts`): every
 * decision the view makes over the server's payloads lives here, node-
 * testable; the components keep only the hooks and the markup.
 *
 * NOTHING HERE COMPUTES A SCORE. Every number is the record's (172's
 * `league_stat_corrections`, served in words by L.E2.3's read) or the box
 * read's; this module only chooses which stored words to show and how to
 * phrase them for a league member ("receiving yards", never `rec_yd`).
 *
 * Q81 (Chris 2026-09-29): a stat fix after a week is final changes nothing
 * in the league, so it is never listed and there is no "week final" state,
 * no "would have been" number and no commissioner door anywhere here.
 */
import type { StatCorrectionsState } from '@/hooks/use-stat-corrections'
import {
  BOX_NO_GAME_NOTE,
  BOX_NONE_STORED_NOTE,
  BOX_OVERRIDDEN_NOTE,
  BOX_UNRECOVERABLE_NOTE,
} from '@/lib/leagues/api/box-score-copy'
import type { TeamBoxScore } from '@/lib/leagues/api/box-score-service'
import type { CorrectionStatChange, StatCorrectionItem } from '@/lib/leagues/api/corrections-service'
import { correctionLabel } from '@/lib/leagues/scoring/stat-correction-labels'
import { PRE_158_SENTENCE } from '@/lib/leagues/scoring/player-points-store'

import { activityHref } from './activity-page-ops'

// ---------------------------------------------------------------------------
// Copy — single-sourced
// ---------------------------------------------------------------------------

/** Q86 (Chris 2026-09-29, spec §7.3.6 v2.16.77): the one stat-fix rule, as the settings page states it. */
export const STAT_FIX_RULE_COPY = 'Stat fixes count until next week’s first game'

export const CORRECTIONS_TITLE = 'Stat corrections'
export const CORRECTIONS_INTRO_COPY = `Official stat fixes that changed a score in this league. ${STAT_FIX_RULE_COPY} — after that, a week’s scores never change.`
export const CORRECTIONS_PROBLEM_COPY = 'Couldn’t load the stat corrections.'
/** R1371: the degraded banner's words for THIS list (not the scoreboard's). */
export const CORRECTIONS_STALE_COPY = "Stat corrections aren't refreshing — showing the last list we read."
/** Only if the server ever sent an empty first page without its own words (it always sends `note`). */
export const CORRECTIONS_EMPTY_FALLBACK_COPY = 'No stat correction has changed a score in this league.'
export const CORRECTIONS_SHOW_OLDER_LABEL = 'Show older'
export const CORRECTIONS_ALL_WEEKS_LABEL = 'All weeks'
export const CORRECTIONS_LINK_LABEL = 'See stat corrections'

export const RESULT_NOT_YET_COPY = 'No result yet — the week’s games were still being played.'
export const RESULT_UNCHANGED_COPY = 'Result unchanged.'

export const MATCHUP_NOTE_SCORE_TITLE = 'A stat correction changed a score in this matchup.'
export const MATCHUP_NOTE_RESULT_TITLE = 'A stat correction changed the result of this matchup.'
/** R1368: a `total_points` week has no matchup — the note is about the one team shown. */
export const TEAM_NOTE_SCORE_TITLE = 'A stat correction changed this team’s score.'
export const TEAM_NOTE_RESULT_TITLE = 'A stat correction changed this team’s result this week.'
/** R1365: a flip of ANOTHER game (the median game, the second game) — listed under this neutral line, never as this matchup's result. */
export const OTHER_RESULTS_LINE = 'It also changed a result this week:'
export const MATCHUP_NOTE_PROBLEM_COPY = 'Couldn’t check this week’s stat corrections.'

// The box score's points note (F477) — each server note, in a member's words.
/** R1367: "final", not "locked" (a lineup lock is not the week being final); one short line. */
export const BOX_FINAL_STORED_COPY = 'Final points as scored — a stat fix after the week was final changes the stat line only.'
export const BOX_NONE_STORED_COPY =
  'These points are worked out from the latest stats — this week was scored before FieldScout kept each player’s points, so they may not add up to the final score.'
export const BOX_NO_GAME_COPY = 'This team had no game this week, so these points are worked out from the latest stats.'
export const BOX_OVERRIDDEN_COPY = 'The commissioner set this team’s score for the week, so these player points don’t add up to it.'
export const BOX_UNRECOVERABLE_COPY =
  'A stat fix reached a player after this week was scored, and the line he was scored on is gone — these points use the fixed stats and don’t add up to the final score.'
export const BOX_PRE_STORE_COPY = 'These points are worked out from the latest stats.'

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

function sentenceStart(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1)
}

/** A score / points value as the league shows it (two decimals); NULL = pending (E61). */
export function pointsWords(value: number | null): string {
  return value === null ? 'pending' : value.toFixed(2)
}

function statValueWords(value: number | null): string {
  return value === null ? '—' : String(value)
}

/**
 * One moved stat in words: "Receiving yards 100 → 94". The stat is the
 * record's stored words (`stat`); should a raw key ever arrive in its place
 * (the words equal the key), the registry's words are used — a member never
 * reads `rec_yd`.
 */
export function statChangeText(change: CorrectionStatChange): string {
  const raw = change.stat.trim()
  const words = raw === '' || raw === change.stat_key ? correctionLabel(change.stat_key) : raw
  return `${sentenceStart(words)} ${statValueWords(change.old)} → ${statValueWords(change.new)}`
}

export type CorrectionResultTone = 'not_yet' | 'unchanged' | 'changed'

export interface CorrectionCard {
  id: string
  week: number
  recordedAt: string
  playerId: string
  playerName: string
  position: string | null
  nflTeam: string | null
  teamId: string
  teamName: string
  stats: string[]
  playerPoints: string
  teamScore: string
  result: { tone: CorrectionResultTone; lines: string[] }
}

/** One record → what its card says. */
export function correctionCard(item: StatCorrectionItem): CorrectionCard {
  const result: CorrectionCard['result'] = !item.result.known
    ? { tone: 'not_yet', lines: [RESULT_NOT_YET_COPY] }
    : item.result.changes.length === 0
      ? { tone: 'unchanged', lines: [RESULT_UNCHANGED_COPY] }
      : { tone: 'changed', lines: item.result.changes.map((c) => c.words) }
  return {
    id: item.id,
    week: item.week,
    recordedAt: item.recorded_at,
    playerId: item.player.id,
    playerName: item.player.name,
    position: item.player.position,
    nflTeam: item.player.nfl_team,
    teamId: item.team.id,
    teamName: item.team.name,
    stats: item.stat_changes.map(statChangeText),
    playerPoints: `His points ${pointsWords(item.player_points.before)} → ${pointsWords(item.player_points.after)}`,
    teamScore: `Team score ${pointsWords(item.team_score.before)} → ${pointsWords(item.team_score.after)}`,
    result,
  }
}

// ---------------------------------------------------------------------------
// The list's state — from the infinite query's pages
// ---------------------------------------------------------------------------

export type CorrectionsListView =
  /** 172 not on this database yet (the named 503) — the server's sentence, never an empty list. */
  | { kind: 'unavailable'; reason: string }
  /** The server said there are none — in its words. */
  | { kind: 'empty'; note: string }
  | { kind: 'items'; items: StatCorrectionItem[]; hasMore: boolean }

export function correctionsListView(pages: readonly StatCorrectionsState[]): CorrectionsListView {
  const unavailable = pages.find((p) => p.state === 'unavailable')
  if (unavailable && unavailable.state === 'unavailable') return { kind: 'unavailable', reason: unavailable.reason }
  const known = pages.flatMap((p) => (p.state === 'known' ? [p.page] : []))
  const items = known.flatMap((p) => p.items)
  if (items.length === 0) return { kind: 'empty', note: known[0]?.note ?? CORRECTIONS_EMPTY_FALLBACK_COPY }
  return { kind: 'items', items, hasMore: known[known.length - 1]?.has_more ?? false }
}

/** The week filter's choices: "All weeks", then the league's weeks in order. */
export function correctionWeekOptions(weeks: readonly number[], selected: number | null): Array<{ value: string; label: string }> {
  const all = [...new Set([...weeks, ...(selected === null ? [] : [selected])])].sort((a, b) => a - b)
  return [{ value: 'all', label: CORRECTIONS_ALL_WEEKS_LABEL }, ...all.map((w) => ({ value: String(w), label: `Week ${w}` }))]
}

/** The league's stat corrections — the Activity page's "Stat corrections" tab
 *  (L.E1.34, F536; the old `/corrections` route redirects here). */
export function correctionsHref(leagueId: string, week: number | null): string {
  return activityHref(leagueId, { tab: 'corrections', week })
}

// ---------------------------------------------------------------------------
// The matchup page's note (§16.5.2: "if result flipped: matchup shows change note")
// ---------------------------------------------------------------------------

/** Only a week that has started can hold a correction (an upcoming week never asks). */
export function weekMayHaveCorrections(weekStatus: string | null | undefined): boolean {
  return weekStatus === 'live' || weekStatus === 'correction_window' || weekStatus === 'final'
}

/** Which game the note's host row shows (R1365): a primary h2h row is `matchup`, a secondary row `second_game`; `team` = a `total_points` week's one team (R1368). */
export type CorrectionNoteScope = 'matchup' | 'second_game' | 'team'

export interface MatchupCorrectionNote {
  resultChanged: boolean
  title: string
  /** One per correction to a team of this matchup, newest first — the record's own sentence, and the flips of THIS game. */
  lines: Array<{ id: string; text: string; results: string[] }>
  /** Flips of the team's OTHER games this week (median, the other matchup row) — shown under `OTHER_RESULTS_LINE`. */
  otherResults: string[]
}

/**
 * The note for one matchup's teams (or a `total_points` week's one team), or
 * null when no correction touched them. The title says "the result of this
 * matchup" ONLY when the game this row shows flipped (R1365): a flip of the
 * team's median game or its other matchup row is listed under a neutral
 * line, never claimed for this one. In a `total_points` week every flip is
 * the team's own result (there is no matchup row).
 */
export function matchupCorrectionNote(
  items: readonly StatCorrectionItem[],
  teamIds: readonly (string | null)[],
  scope: CorrectionNoteScope = 'matchup',
): MatchupCorrectionNote | null {
  const ids = new Set(teamIds.filter((id): id is string => id !== null))
  const mine = items.filter((item) => ids.has(item.team.id))
  if (mine.length === 0) return null
  const isThisGame = (game: string) => scope === 'team' || game === scope
  const flips = (item: StatCorrectionItem) => (item.result.known ? item.result.changes : [])
  const resultChanged = mine.some((item) => flips(item).some((c) => isThisGame(c.game)))
  const title =
    scope === 'team'
      ? resultChanged
        ? TEAM_NOTE_RESULT_TITLE
        : TEAM_NOTE_SCORE_TITLE
      : resultChanged
        ? MATCHUP_NOTE_RESULT_TITLE
        : MATCHUP_NOTE_SCORE_TITLE
  return {
    resultChanged,
    title,
    lines: mine.map((item) => ({
      id: item.id,
      text: item.summary,
      results: flips(item)
        .filter((c) => isThisGame(c.game))
        .map((c) => `${item.team.name} — ${c.words}`),
    })),
    otherResults: mine.flatMap((item) =>
      flips(item)
        .filter((c) => !isThisGame(c.game))
        .map((c) => `${item.team.name} — ${c.words}`),
    ),
  }
}

/**
 * The note's read, decided (R1366). The note reads EVERY page of the week, so
 * it waits until the last page is in, and asks for the next page only while
 * none is in flight AND the last ask did not fail (`retry: false` — a failed
 * page would otherwise be asked for again on every render, forever). A
 * failed page — first or later — is said ("Couldn't check…"), never shown as
 * a partial note or as "no corrections".
 */
export interface NoteReadFlags {
  hasData: boolean
  isError: boolean
  isFetchNextPageError: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
}

export type NoteReadState = 'wait' | 'error' | 'ready'

export function noteReadState(f: NoteReadFlags): NoteReadState {
  if (f.isFetchNextPageError) return 'error'
  if (!f.hasData) return f.isError ? 'error' : 'wait'
  if (f.hasNextPage) return 'wait'
  return 'ready'
}

export function noteShouldFetchNextPage(f: NoteReadFlags): boolean {
  return f.hasData && f.hasNextPage && !f.isFetchingNextPage && !f.isFetchNextPageError && !f.isError
}

// ---------------------------------------------------------------------------
// The box score's points note (F477)
// ---------------------------------------------------------------------------

const BOX_NOTE_WORDS: ReadonlyMap<string, string> = new Map([
  [BOX_NONE_STORED_NOTE, BOX_NONE_STORED_COPY],
  [BOX_NO_GAME_NOTE, BOX_NO_GAME_COPY],
  [BOX_OVERRIDDEN_NOTE, BOX_OVERRIDDEN_COPY],
  [BOX_UNRECOVERABLE_NOTE, BOX_UNRECOVERABLE_COPY],
  [PRE_158_SENTENCE, BOX_PRE_STORE_COPY],
])

/**
 * What the box says about where its points come from, or null when there is
 * nothing to say. The server's `stored_note` always wins (in plain words; an
 * unknown note is shown as sent — never dropped). A FINAL week read from the
 * stored points says that the stat line may have moved since (F477's case:
 * 80 yards beside the 12.00 he was scored on). A live week, and a week still
 * in its correction window (a fix there re-scores, so line and points
 * agree), say nothing.
 */
export function boxPointsNote(box: Pick<TeamBoxScore, 'points_source' | 'stored_note'>, weekStatus: string | null | undefined): string | null {
  if (box.stored_note) {
    const words = BOX_NOTE_WORDS.get(box.stored_note)
    if (words) return words
    const sentence = sentenceStart(box.stored_note.trim())
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
  }
  if (box.points_source === 'stored' && weekStatus === 'final') return BOX_FINAL_STORED_COPY
  return null
}
