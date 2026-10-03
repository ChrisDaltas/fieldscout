/**
 * League-home SEASON heroes — pure derivation (M4 task L.D5.4; spec §16.5.1's
 * `in_season` / `playoffs` / `complete` rows, §16.5.3's total_points hero,
 * §16.5.4; PROGRESS F46, D324). Colocated with `league-home-season.tsx` (the
 * `league-home-states-ops.ts` precedent) and pure so the golden pins run
 * without React.
 *
 * NOTHING here computes a score, a lock, a countdown or an eligibility
 * (CLAUDE.md — server-authoritative; §23.3 / the F226 fence): every
 * function labels a STORED document — the ladder's status, the door's
 * cells, 117's ranked rows, the lineup row's `locked_at` record — and the
 * one week the hero shows is the ladder's current week (`currentWeekOf`,
 * D316(2)), never a clock or a literal. Not under `src/lib/leagues/**` (a
 * UI surface, not engine), so the D3 guard does not apply; even so, no
 * `Date` is read here.
 *
 * Copy carries NO ledger code (no E/F/Q/D numbers — F277(a)): a section
 * citation has house precedent, a ledger code does not.
 */
import type { LeagueDetail } from '@/hooks/use-league'
import type { ScheduleWeek } from '@/hooks/use-schedule'
import type { MatchupRow } from '@/lib/leagues/api/matchups-service'
import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'
import { describeWaiverSchedule, type WAIVER_SCHEDULE_KEYS } from '@/lib/leagues/time/waiver-schedule'
import type { WaiverWindowView } from '@/lib/leagues/waivers/waiver-window-view'

import { mockLauncherHref } from '@/components/draft/mock-launcher-entry'

import { currentWeekOf } from './lineup-editor-ops'
import { splitRows } from './matchup-view-ops'

// ---------------------------------------------------------------------------
// The week the hero shows
// ---------------------------------------------------------------------------

/**
 * THE week the matchup-of-the-week card points at: the ladder's current week
 * — the greatest started week, else the first (the team page's and the
 * matchup view's reading, D316(2)/D323(8)). `null` while the ladder is
 * unknown or empty. The DoD probe replaces this with a literal week and the
 * current-week fixture reds.
 */
export function heroWeek(weeks: readonly Pick<ScheduleWeek, 'week' | 'status'>[] | undefined): number | null {
  if (!weeks) return null
  return currentWeekOf(weeks)
}

// ---------------------------------------------------------------------------
// The viewer's matchup in the week's document
// ---------------------------------------------------------------------------

export type HeroMatchup =
  | { kind: 'mine'; row: MatchupRow }
  | { kind: 'no_seat' }
  | { kind: 'none_for_team' }
  | { kind: 'no_rows' }

/**
 * The viewer's PRIMARY matchup this week, strictly theirs — a stranger's row
 * is never the hero (the matchup view's `selectedMatchup` falls back to the
 * first row because a page must show something; a hero card must not
 * pretend). `no_seat` = the viewer manages no franchise here (a commissioner
 * without a team); `none_for_team` = the week has rows but none carries the
 * team (a playoff week after an exit — NOT a bye: 118 writes a bye as a row
 * with `away_team_id NULL`, which lands in `mine`; R896); `no_rows` = the
 * week has no pairings on record yet.
 */
export function heroMatchup(matchups: readonly MatchupRow[], myTeamId: string | null): HeroMatchup {
  if (!myTeamId) return { kind: 'no_seat' }
  const { primary } = splitRows(matchups)
  if (primary.length === 0) return { kind: 'no_rows' }
  const row = primary.find((m) => m.home_team_id === myTeamId || m.away_team_id === myTeamId)
  return row ? { kind: 'mine', row } : { kind: 'none_for_team' }
}

export const NO_SEAT_COPY = 'You don’t manage a team in this league — the matchups page shows the whole week.'
export const NO_ROWS_COPY = 'No pairings on record for this week yet.'
export const NONE_FOR_TEAM_COPY = 'No matchup on record for your team this week.'
/** R896: no "bye" hedge — under 118 a bye is a ROW (`away_team_id NULL`)
 *  that reaches the `mine` branch and the Scoreboard's own bye copy; this
 *  branch is an early exit. The bracket pointer arrived with L.D5.5: the
 *  bracket card sits on this very page. */
export const PLAYOFF_NONE_FOR_TEAM_COPY = 'No playoff game on record for your team this week — the bracket below shows the round.'
export const PLAYOFF_NO_ROWS_COPY = 'Playoff week — the pairings appear when the previous round rolls over.'
export const NO_LADDER_COPY = 'No schedule yet — it is generated the moment the draft completes.'

// ---------------------------------------------------------------------------
// The Set-lineup CTA — the server's lock RECORD, never a countdown
// ---------------------------------------------------------------------------

/**
 * §16.5.1 prints "Set lineup (lock countdown)"; what the countdown counts
 * DOWN TO under the one per-player lock is an OPEN spec question (Q40 —
 * the team page's named placeholder, F251(a)). The CTA therefore renders
 * the lineup row's `locked_at` — the RECORD of the earliest starter kickoff
 * ("locks from", R779), a stored instant formatted by the host — and no
 * client-computed countdown. `null` lineup = nothing set for the week yet.
 */
export const LINEUP_NOT_SET_COPY = 'Nothing set for this week yet — the week opens with last week’s legal lineup carried over.'
export const LINEUP_NO_RECORD_COPY = 'No starter has a kickoff on record yet.'
export const LINEUP_READING_COPY = 'Reading this week’s lineup…'

export function setLineupCopy(
  lineup: { locked_at: string | null } | null | undefined,
  formattedLocksAt: string | null,
): string {
  if (lineup === undefined) return LINEUP_READING_COPY
  if (lineup === null) return LINEUP_NOT_SET_COPY
  if (!lineup.locked_at || !formattedLocksAt) return LINEUP_NO_RECORD_COPY
  return `Locks from ${formattedLocksAt}`
}

// ---------------------------------------------------------------------------
// The full standings card + the scoreboard's week tabs (League UX batch 4)
// ---------------------------------------------------------------------------

/** `team_id -> username` for every seated franchise: the manager line under
 *  each team on League Home's standings card, the scoreboard cards and the
 *  standings table. A franchise with no seated member is absent. */
export function managersByTeam(members: LeagueDetail['members']): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of members) if (m.team_id && m.profiles?.username) map.set(m.team_id, m.profiles.username)
  return map
}

export type ScoreboardTab = { kind: 'week'; week: number; label: string } | { kind: 'playoffs'; label: string }

/**
 * The scoreboard's tabs (the prototype's "current, next, Playoffs"): the
 * ladder's current week, the next week ON the ladder (absent past the last
 * one), and "Playoffs" while the league is in its playoffs. Pure over the
 * stored ladder: no clock.
 */
export function scoreboardTabs(
  weeks: readonly Pick<ScheduleWeek, 'week' | 'status'>[] | undefined,
  current: number | null,
  playoffs: boolean,
): ScoreboardTab[] {
  const tabs: ScoreboardTab[] = []
  if (current !== null) {
    tabs.push({ kind: 'week', week: current, label: `Week ${current}` })
    const next = (weeks ?? []).map((w) => w.week).filter((w) => w > current).sort((x, y) => x - y)[0]
    if (next !== undefined) tabs.push({ kind: 'week', week: next, label: `Week ${next}` })
  }
  if (playoffs) tabs.push({ kind: 'playoffs', label: 'Playoffs' })
  return tabs
}

// ---------------------------------------------------------------------------
// The chips — waivers / trades render HONESTLY from the stored settings
// ---------------------------------------------------------------------------

export interface HonestChip {
  label: string
  /** The stored setting behind the chip, and what is not built yet. */
  title: string
}

/**
 * The waiver chip (M5 L.D2.13 — it replaced "claims arrive in a later
 * update"): the league's NEXT RUN, from the server's window read (the league
 * detail's `waiver_window` — no clock here), formatted for the viewer by
 * `fmt`; the stored schedule said plainly in the title by the one describer
 * (`describeWaiverSchedule`). With no window (a failed read) the chip says
 * what the schedule means and names no instant it cannot know.
 */
export function waiverChip(
  settings: Pick<LeagueSettings, 'waiver_type' | (typeof WAIVER_SCHEDULE_KEYS)[number]>,
  window: Pick<WaiverWindowView, 'waivers' | 'next_run_at' | 'paused' | 'free_agency_open'> | null = null,
  fmt: (iso: string) => string = (iso) => iso,
): HonestChip {
  if (settings.waiver_type === 'none_fcfs' || window?.waivers === false) {
    return {
      label: 'No waivers — dropped players are free agents at once',
      title: 'Waivers: off (first come, first served) — any unowned player whose game hasn’t started can be picked up at once.',
    }
  }
  const schedule = `Waiver type: ${waiverTypeLabel(settings.waiver_type)}. ${describeWaiverSchedule(settings)}`
  if (window?.paused) return { label: 'Waivers paused', title: `Waiver runs are paused right now — claims stay pending. ${schedule}` }
  if (window?.next_run_at) {
    const state = window.free_agency_open ? ' Free agency is open now.' : ' Claims only until then.'
    return { label: `Next waiver run · ${fmt(window.next_run_at)}`, title: `${schedule}${state}` }
  }
  return { label: 'Waivers · dropped players wait for the next run', title: schedule }
}

export function waiverTypeLabel(type: string): string {
  switch (type) {
    case 'faab':
      return 'FAAB (blind bids)'
    case 'rolling_priority':
      return 'rolling priority'
    case 'reverse_standings':
      return 'reverse standings'
    case 'none_fcfs':
      return 'none (first come, first served)'
    default:
      return type
  }
}

/** The trade chip (M5 L.D3.7 — it replaced "trades arrive in a later
 *  update"): the STORED deadline week (or none), said the way Q76 rules it —
 *  deadline week N ⇒ offers can be made and accepted until week N+1 begins.
 *  Whether the deadline has PASSED is never decided here: the instant has no
 *  read door (F452), and a refused offer names it verbatim on the trade
 *  center. The host renders the chip as the door to the trade center. */
export function tradeChip(settings: Pick<LeagueSettings, 'trade_deadline_week'>): HonestChip {
  if (settings.trade_deadline_week === null) {
    return { label: 'No trade deadline', title: 'Trades are allowed all season. Open the trade center to offer one.' }
  }
  return {
    label: `Trade deadline · Week ${settings.trade_deadline_week}`,
    title: `Trades can be offered and accepted until Week ${settings.trade_deadline_week + 1} begins. Open the trade center to offer one.`,
  }
}

// ---------------------------------------------------------------------------
// The champion (complete) — a STORED id, or the honest absence
// ---------------------------------------------------------------------------

export const CHAMPION_UNRECORDED_COPY = 'No champion recorded for this season.'

/** `leagues.champion_team_id` (written at the `complete` flip — migration
 *  118) resolved to a team name; `null` when unwritten or unknown. */
export function championName(detail: Pick<LeagueDetail, 'league' | 'teams'>): string | null {
  const id = detail.league.champion_team_id
  if (!id) return null
  return detail.teams.find((t) => t.id === id)?.name ?? null
}

// ---------------------------------------------------------------------------
// Navigation — the league's pages are the league header's sub-nav now
// (`league-shell-ops.ts`, League UX batch 1); only the draft doors live here.
// ---------------------------------------------------------------------------

/** The two post-draft doors (F46 / R281): the draft recap and the practice
 *  launcher — post-draft the launcher is the resume/recap list surface
 *  (071 refuses a new launch), which is exactly why the door must exist. */
export function draftDoors(leagueId: string): { recap: string; practice: string } {
  return {
    recap: `/app/leagues/${leagueId}/draft/recap`,
    practice: mockLauncherHref(leagueId),
  }
}

/** The week's status → whether the scoring surfaces should ask about the
 *  stats_degraded flag at all (F277(d)): a week that is not scoring cannot
 *  be delayed. `null` = unknown ladder → ask (the conservative arm). */
export function scoringLive(weekStatus: string | null | undefined): boolean {
  if (weekStatus === null || weekStatus === undefined) return true
  return weekStatus === 'live' || weekStatus === 'correction_window'
}
