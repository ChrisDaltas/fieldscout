/**
 * The commissioner console's "needs you" read — M6 task L.E1.32,
 * `GET /api/leagues/[id]/commish/summary` (spec §10.1 as folded by v2.16.77:
 * the console is the commissioner's launchpad — "what needs the commissioner
 * right now"; §16.2; PROGRESS Q87 (a design choice) → D443; D446; D447;
 * D455 is this read's build note).
 *
 * **COMMISSIONERS ONLY — two gates, in the house order.** Membership first
 * (`assertLeagueMember`, R807): a non-member and a nonexistent league get
 * the in-season family's ONE no-leak 403, and a member whose league was
 * soft-deleted the 404 by name (R812). Then `is_league_commish` (052 —
 * commissioner or co-commissioner, the predicate every commissioner verb
 * checks): a manager gets this read's own 403. Nothing is read before both
 * pass.
 *
 * **COMPOSED, NOT INVENTED (the task text: "nothing invented where a read
 * does not exist").** Three sections, each an existing read:
 *   1. `unmanaged_teams` — teams with no manager and autopilot OFF: D339's
 *      predicate over `league_members` (a member row for the team and none
 *      carrying a `user_id`) with 139's `team_autopilot` (no row = OFF), the
 *      same reads `readRosters` makes. (No team is ever retired since 176 —
 *      F556: no retired filter.) A team with NO member
 *      row at all is D339's unsafe direction — autopilot declines it and the
 *      switch refuses it — so it is REPORTED in `no_seat_row`, never listed
 *      as switchable and never dropped.
 *   2. `trades_awaiting_review` — `readTrades(status: open)` (L.D3.6), the
 *      trades `in_review` while the league's `trade_review` is
 *      `commissioner` (§13.3: pending until the commissioner approves or
 *      vetoes, or the review period ends and it goes through). Under
 *      `league_vote` the league decides and under `none` nothing waits, so
 *      the list is empty and `review_mode` says why.
 *   3. `matchup_corrections` — every matchup of each week being played or
 *      in its correction window (`league_weeks.status` `live` /
 *      `correction_window`), each answered by 135's
 *      `commish_matchup_edit_lock` — the SAME door the matchup panel reads
 *      and the SAME helper the score / result verbs refuse on (D372, as
 *      re-cut by Q67 / D379), so the console can never disagree with them.
 *      Split `can_correct_now` / `not_yet`; a `not_yet` row carries the
 *      server's own sentence (D446: say why in words). A final week is
 *      always correctable and is not "needs you"; an upcoming week has
 *      nothing to correct.
 * **Not sections (the ruled form — F510):** open lineup reports (Q83: the
 * report flow is not built, L.E1.35 dropped) and `week_final` corrections
 * (Q81 / D438: a post-window correction records nothing league-side). No
 * placeholder for either is emitted.
 *
 * **DEPLOY BEFORE PUSH (D447 / TD15).** Each section degrades BY NAME: when
 * the exact object it reads is absent (PGRST205 / PGRST202 / 42P01 /
 * 42883, anchored on the object's name — `postgrest-errors.ts`) the section
 * is `{ state: 'unavailable', missing, message }` — never a 500, never an
 * empty list that reads as "nothing needs you". Any OTHER failure is the
 * whole read's 500 by name (loud, CLAUDE.md), not a quietly missing section.
 *
 * Reads only. Time: `evaluated_at` and the trades' countdowns are the
 * caller's `now` (the route passes the TimeProvider's); no Date or random
 * read in this file.
 */
import { dbFailure } from './db-failure'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'
import { isDoorNotPushed, isMissingSchemaObject } from '@/lib/supabase/postgrest-errors'

import type { CommishMatchupEditLock } from './commish-matchup-service'
import { assertBelowPostgrestCap, assertLeagueMember } from './inseason-reads'
import type { ServiceResult } from './leagues-service'
import { readTrades, TRADE_SCHEMA_OBJECTS, TRADES_UNAVAILABLE_MESSAGE, type TradesDocument, type TradeView } from './trades-service'

type Supabase = SupabaseClient<Database>

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** A member who is not a commissioner (or co-commissioner). */
export const COMMISH_SUMMARY_FORBIDDEN_MESSAGE =
  'Only this league’s commissioner (or a co-commissioner) can see what needs the commissioner.'

/** `unmanaged_teams`' unavailable sentence — 139's switch table is absent. */
export const UNMANAGED_TEAMS_UNAVAILABLE_MESSAGE =
  'Teams without a manager can’t be listed yet — the league database hasn’t been updated for autopilot. Try again after the next update.'

/** `matchup_corrections`' unavailable sentence — 135's read door is absent. */
export const MATCHUP_CORRECTIONS_UNAVAILABLE_MESSAGE =
  'Which matchups can be corrected can’t be checked yet — the league database hasn’t been updated for it. Try again after the next update.'

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/** A section whose underlying read is absent on this database. */
export interface UnavailableSection {
  state: 'unavailable'
  /** The object(s) the database does not have yet, by name. */
  missing: string[]
  message: string
}

export interface TeamRef {
  team_id: string
  name: string
}

export interface UnmanagedTeam extends TeamRef {
  /** `teams.status` (`active`, or `orphaned` after a vacate). */
  status: string
}

export type UnmanagedTeamsSection =
  | {
      state: 'ok'
      /** No manager, autopilot OFF — the commissioner's call
       *  (put it on autopilot, or find a manager). */
      teams: UnmanagedTeam[]
      /** No `league_members` row at all (D339's unsafe
       *  direction): autopilot declines it and the switch refuses it. */
      no_seat_row: TeamRef[]
    }
  | UnavailableSection

export type TradesAwaitingReviewSection =
  | {
      state: 'ok'
      /** The league's `trade_review` as the verbs read it now. */
      review_mode: string
      /** In review under `commissioner` mode, newest first — each the
       *  trade read's own view (review end + countdown included). */
      trades: TradeView[]
    }
  | UnavailableSection

export interface MatchupCorrectionItem {
  matchup_id: string
  week: number
  round_type: string
  home: TeamRef
  /** Null for a matchup with no away side. */
  away: TeamRef | null
  /** 135's `why`, verbatim. */
  why: CommishMatchupEditLock['why']
  /** The server's sentence when not correctable yet; null when it is. */
  message: string | null
}

export type MatchupCorrectionsSection =
  | {
      state: 'ok'
      /** The weeks being played or in their correction window (ascending);
       *  empty = no week is in play, so nothing is listed. */
      weeks: number[]
      can_correct_now: MatchupCorrectionItem[]
      not_yet: MatchupCorrectionItem[]
    }
  | UnavailableSection

export interface CommishSummary {
  league_id: string
  season: number
  league_status: string
  /** The instant the read was made (the TimeProvider's now). */
  evaluated_at: string
  sections: {
    unmanaged_teams: UnmanagedTeamsSection
    trades_awaiting_review: TradesAwaitingReviewSection
    matchup_corrections: MatchupCorrectionsSection
  }
}

/** The objects each section reads that a database might not have yet. */
export const UNMANAGED_TEAMS_OBJECTS = ['team_autopilot'] as const
export const MATCHUP_LOCK_DOOR = { commish_matchup_edit_lock: ['p_league_id', 'p_matchup_id'] } as const

/** The week statuses whose matchups the section asks about (056's CHECK). */
export const IN_PLAY_WEEK_STATUSES = ['live', 'correction_window'] as const

/** A section's own failure: unavailable, or the whole read's loud 500. */
type SectionResult<T> = { section: T } | { fault: ServiceResult }

function fault(what: string, message: string): { fault: ServiceResult } {
  return { fault: { status: 500, body: { error: `${what}: ${message}` } } }
}

// ---------------------------------------------------------------------------
// Section 1 — teams with no manager and autopilot off
// ---------------------------------------------------------------------------

async function unmanagedTeams(supabase: Supabase, leagueId: string): Promise<SectionResult<UnmanagedTeamsSection>> {
  const [teamsRes, membersRes, autopilotRes] = await Promise.all([
    supabase.from('teams').select('id, name, status').eq('league_id', leagueId).order('name').order('id'),
    supabase.from('league_members').select('team_id, user_id').eq('league_id', leagueId),
    supabase.from('team_autopilot').select('team_id, is_on, teams!inner(league_id)').eq('teams.league_id', leagueId),
  ])
  // R1361: a failure of the two tables every database has is loud FIRST —
  // "unavailable" is only ever the switch table's absence, never a mask for
  // a broken teams / members read.
  if (teamsRes.error) return fault('teams', teamsRes.error.message)
  if (membersRes.error) return fault('league_members', membersRes.error.message)
  if (autopilotRes.error && isMissingSchemaObject(autopilotRes.error, UNMANAGED_TEAMS_OBJECTS)) {
    return { section: { state: 'unavailable', missing: [...UNMANAGED_TEAMS_OBJECTS], message: UNMANAGED_TEAMS_UNAVAILABLE_MESSAGE } }
  }
  if (autopilotRes.error) return fault('team_autopilot', autopilotRes.error.message)
  const teams = teamsRes.data ?? []
  const members = membersRes.data ?? []
  const switches = autopilotRes.data ?? []
  for (const [rows, what] of [
    [teams, 'teams'],
    [members, 'league_members'],
    [switches, 'team_autopilot'],
  ] as const) {
    const capped = assertBelowPostgrestCap(rows, what)
    if (capped) return { fault: capped }
  }

  const seatRow = new Set<string>()
  const managed = new Set<string>()
  for (const m of members) {
    if (!m.team_id) continue
    seatRow.add(m.team_id)
    if (m.user_id) managed.add(m.team_id)
  }
  const autopilotOn = new Set(switches.filter((s) => s.is_on).map((s) => s.team_id))

  const unmanaged: UnmanagedTeam[] = []
  const noSeatRow: TeamRef[] = []
  for (const team of teams) {
    if (!seatRow.has(team.id)) {
      noSeatRow.push({ team_id: team.id, name: team.name })
      continue
    }
    if (managed.has(team.id) || autopilotOn.has(team.id)) continue
    unmanaged.push({ team_id: team.id, name: team.name, status: team.status })
  }
  return { section: { state: 'ok', teams: unmanaged, no_seat_row: noSeatRow } }
}

// ---------------------------------------------------------------------------
// Section 2 — trades waiting on the commissioner's review
// ---------------------------------------------------------------------------

async function tradesAwaitingReview(
  supabase: Supabase,
  leagueId: string,
  userId: string,
  now: Date,
): Promise<SectionResult<TradesAwaitingReviewSection>> {
  const res = await readTrades(supabase, leagueId, userId, { status: 'open' }, now)
  // R1362: the trade read's 503 is its named "no trade objects" answer
  // (`isMissingSchemaObject` over TRADE_SCHEMA_OBJECTS) and does not say
  // WHICH was absent — so the section names the set it stands for, and any
  // other 503 is not taken for it.
  const refusal = (res.body as { error?: unknown } | null)?.error
  if (res.status === 503 && refusal === TRADES_UNAVAILABLE_MESSAGE) {
    return { section: { state: 'unavailable', missing: [...TRADE_SCHEMA_OBJECTS], message: TRADES_UNAVAILABLE_MESSAGE } }
  }
  if (res.status !== 200) {
    return fault('trades', typeof refusal === 'string' ? refusal : JSON.stringify(refusal ?? res.body))
  }
  const doc = res.body as unknown as TradesDocument
  const reviewMode = doc.settings.trade_review
  const trades = reviewMode === 'commissioner' ? doc.trades.filter((t) => t.status === 'in_review') : []
  return { section: { state: 'ok', review_mode: reviewMode, trades } }
}

// ---------------------------------------------------------------------------
// Section 3 — matchups whose score can be corrected now vs not yet
// ---------------------------------------------------------------------------

async function matchupCorrections(
  supabase: Supabase,
  leagueId: string,
  season: number,
): Promise<SectionResult<MatchupCorrectionsSection>> {
  const { data: weekRows, error: weeksError } = await supabase
    .from('league_weeks')
    .select('week, status')
    .eq('league_id', leagueId)
    .eq('season', season)
    .in('status', [...IN_PLAY_WEEK_STATUSES])
    .order('week')
  if (weeksError) return fault('league_weeks', weeksError.message)
  const weeks = (weekRows ?? []).map((w) => w.week)
  if (weeks.length === 0) {
    return { section: { state: 'ok', weeks: [], can_correct_now: [], not_yet: [] } }
  }

  const [matchupsRes, teamsRes] = await Promise.all([
    supabase
      .from('matchups')
      .select('id, week, round_type, home_team_id, away_team_id')
      .eq('league_id', leagueId)
      .eq('season', season)
      .in('week', weeks)
      .order('week')
      .order('id'),
    supabase.from('teams').select('id, name').eq('league_id', leagueId),
  ])
  if (matchupsRes.error) return fault('matchups', matchupsRes.error.message)
  if (teamsRes.error) return fault('teams', teamsRes.error.message)
  const matchups = matchupsRes.data ?? []
  const capped = assertBelowPostgrestCap(matchups, 'matchups')
  if (capped) return { fault: capped }
  const names = new Map((teamsRes.data ?? []).map((t) => [t.id, t.name]))
  // Every side names a team of this league (the matchups FK); one that does
  // not is a broken invariant, named — never rendered as a nameless team.
  const strangers = matchups.flatMap((m) => [m.home_team_id, m.away_team_id]).filter((id): id is string => id !== null && !names.has(id))
  if (strangers.length > 0) return fault('teams', `matchup side(s) with no team in this league: ${[...new Set(strangers)].join(', ')}`)
  const ref = (teamId: string): TeamRef => ({ team_id: teamId, name: names.get(teamId)! })

  const answers = await Promise.all(
    matchups.map((m) => supabase.rpc('commish_matchup_edit_lock', { p_league_id: leagueId, p_matchup_id: m.id })),
  )
  const canCorrectNow: MatchupCorrectionItem[] = []
  const notYet: MatchupCorrectionItem[] = []
  for (const [i, answer] of answers.entries()) {
    const m = matchups[i]
    if (answer.error) {
      if (isDoorNotPushed(answer.error, MATCHUP_LOCK_DOOR)) {
        return {
          section: {
            state: 'unavailable',
            missing: Object.keys(MATCHUP_LOCK_DOOR),
            message: MATCHUP_CORRECTIONS_UNAVAILABLE_MESSAGE,
          },
        }
      }
      return fault('commish_matchup_edit_lock', answer.error.message)
    }
    const doc = answer.data as unknown as CommishMatchupEditLock | null
    // The panel's own guard (readCommishMatchupEditLock): an answer without a
    // boolean `editable` for THIS matchup is a fault, never "correctable".
    if (doc === null || typeof doc.editable !== 'boolean' || doc.matchup_id !== m.id) {
      return fault('commish_matchup_edit_lock', `no usable answer for matchup ${m.id}`)
    }
    const item: MatchupCorrectionItem = {
      matchup_id: m.id,
      week: m.week,
      round_type: m.round_type,
      home: ref(m.home_team_id),
      away: m.away_team_id ? ref(m.away_team_id) : null,
      why: doc.why,
      message: doc.editable ? null : doc.message,
    }
    ;(doc.editable ? canCorrectNow : notYet).push(item)
  }
  return { section: { state: 'ok', weeks, can_correct_now: canCorrectNow, not_yet: notYet } }
}

// ---------------------------------------------------------------------------
// GET …/commish/summary
// ---------------------------------------------------------------------------

export async function readCommishSummary(
  supabase: Supabase,
  leagueId: string,
  userId: string,
  now: Date,
): Promise<ServiceResult> {
  const refused = await assertLeagueMember(supabase, leagueId)
  if (refused) return refused
  const { data: isCommish, error: commishError } = await supabase.rpc('is_league_commish', { p_league_id: leagueId })
  if (commishError) return dbFailure('is_league_commish', commishError)
  if (isCommish !== true) return { status: 403, body: { error: COMMISH_SUMMARY_FORBIDDEN_MESSAGE } }

  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('season, status')
    .eq('id', leagueId)
    .is('deleted_at', null)
    .maybeSingle()
  if (leagueError) return dbFailure('leagues', leagueError)
  if (!league) return { status: 500, body: { error: 'leagues: the league row read empty after membership passed' } }

  const [teams, trades, matchups] = await Promise.all([
    unmanagedTeams(supabase, leagueId),
    tradesAwaitingReview(supabase, leagueId, userId, now),
    matchupCorrections(supabase, leagueId, league.season),
  ])
  for (const result of [teams, trades, matchups]) {
    if ('fault' in result) return result.fault
  }

  const summary: CommishSummary = {
    league_id: leagueId,
    season: league.season,
    league_status: league.status,
    evaluated_at: now.toISOString(),
    sections: {
      unmanaged_teams: (teams as { section: UnmanagedTeamsSection }).section,
      trades_awaiting_review: (trades as { section: TradesAwaitingReviewSection }).section,
      matchup_corrections: (matchups as { section: MatchupCorrectionsSection }).section,
    },
  }
  return { status: 200, body: summary as unknown as Json }
}
