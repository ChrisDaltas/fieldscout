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
import type { LeagueStandings, StandingsRow } from '@/lib/leagues/api/standings-service'
import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'

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
 * team (a playoff week after an exit, or a bye the engine wrote no row for);
 * `no_rows` = the week has no pairings on record yet.
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
export const PLAYOFF_NONE_FOR_TEAM_COPY =
  'No playoff game on record for your team this week — a bye or an early exit; the standings page carries the bracket.'
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
// The standings peek — 117's rows, in 117's order, a slice of them
// ---------------------------------------------------------------------------

export interface StandingsPeek {
  rows: StandingsRow[]
  /** True when rows between the top slice and the viewer's row were left out. */
  elided: boolean
  /** 117's own empty reason (`no_final_weeks`) — rendered as designed copy
   *  over the rows, never inferred from the length or from a 0. */
  reason: string | null
  weeksFinal: number
}

/**
 * The top `limit` rows plus the viewer's own row when it sits below them —
 * a SLICE of 117's ranked document, never a re-sort (D297: one ranking rule
 * in the product). A stored 0 is rendered as 0: this peek papers over
 * nothing (a never-scored team's stored 0 is indistinguishable from a scored
 * 0 by design of the results table — F273 is the schema's, not this view's);
 * what makes an all-zero table honest is 117's `reason`, carried through.
 */
export function standingsPeek(doc: LeagueStandings, myTeamId: string | null, limit = 4): StandingsPeek {
  const top = doc.standings.slice(0, limit)
  const mine = myTeamId ? doc.standings.find((r) => r.team_id === myTeamId) : undefined
  const rows = mine && !top.some((r) => r.team_id === mine.team_id) ? [...top, mine] : top
  const elided = rows.length > top.length && mine !== undefined && mine.rank > limit + 1
  return { rows, elided, reason: doc.reason, weeksFinal: doc.weeks_final }
}

// ---------------------------------------------------------------------------
// The chips — waivers / trades render HONESTLY (M4 has neither verb)
// ---------------------------------------------------------------------------

export interface HonestChip {
  label: string
  /** The stored setting behind the chip, and what is not built yet. */
  title: string
}

export const WAIVERS_LATER_COPY = 'Waiver claims arrive in a later update.'
export const TRADES_LATER_COPY = 'Trades arrive in a later update.'

/**
 * The waiver chip: the STORED settings said plainly, and the claim verb
 * named as not yet here. No run day/time is printed as a deadline — no job
 * processes claims yet, so a printed Wednesday would be a promise the
 * server does not keep; what a dropped player does today is the stored
 * `waiver_period_hours` (then first-come-first-served).
 */
export function waiverChip(settings: Pick<LeagueSettings, 'waiver_type' | 'waiver_period_hours'>): HonestChip {
  if (settings.waiver_type === 'none_fcfs') {
    return {
      label: 'No waivers — dropped players are free agents at once',
      title: `Waivers: off (first come, first served). ${WAIVERS_LATER_COPY}`,
    }
  }
  const hours = settings.waiver_period_hours
  return {
    label: `Waivers · dropped players clear after ${hours} h`,
    title: `Waiver type: ${waiverTypeLabel(settings.waiver_type)}. Until then a dropped player sits on waivers for ${hours} hour${hours === 1 ? '' : 's'}, then is free to add. ${WAIVERS_LATER_COPY}`,
  }
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

/** The trade chip: the STORED deadline week (or none), the verb named as
 *  not yet here. Whether the deadline has PASSED is never decided here —
 *  that needs the ladder and belongs to the trade verb when it lands. */
export function tradeChip(settings: Pick<LeagueSettings, 'trade_deadline_week'>): HonestChip {
  if (settings.trade_deadline_week === null) {
    return { label: 'No trade deadline', title: `Trades are allowed all season. ${TRADES_LATER_COPY}` }
  }
  return {
    label: `Trade deadline · Week ${settings.trade_deadline_week}`,
    title: `Trades close after Week ${settings.trade_deadline_week}. ${TRADES_LATER_COPY}`,
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
// Navigation — the league's in-season pages (F251(c) / F253(c) / F275(c))
// ---------------------------------------------------------------------------

export interface LeagueNavItem {
  key: 'team' | 'matchups' | 'standings' | 'schedule' | 'players'
  label: string
  href: string
}

/** The in-season surfaces, in reading order. The team entry is the viewer's
 *  OWN franchise and is absent when they manage none. */
export function leagueNav(leagueId: string, myTeamId: string | null): LeagueNavItem[] {
  const base = `/app/leagues/${leagueId}`
  const items: LeagueNavItem[] = []
  if (myTeamId) items.push({ key: 'team', label: 'My team', href: `${base}/team/${myTeamId}` })
  items.push(
    { key: 'matchups', label: 'Matchups', href: `${base}/matchup` },
    { key: 'standings', label: 'Standings', href: `${base}/standings` },
    { key: 'schedule', label: 'Schedule', href: `${base}/schedule` },
    { key: 'players', label: 'Players', href: `${base}/players` },
  )
  return items
}

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
