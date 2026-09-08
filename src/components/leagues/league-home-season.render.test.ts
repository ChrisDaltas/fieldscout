/**
 * league-home-season.render.test.ts — the three season heroes over REAL
 * static renders: §16.5.1's in_season / playoffs / complete rows, the R281
 * doors, the honest waiver/trade chips, §16.5.3's total_points hero, the
 * §16.5.4 states, the elevation pin (M4 task L.D5.4; PROGRESS F46, D324).
 *
 * The `matchup-view.render.test.ts` rig: `renderToStaticMarkup` over the
 * actual `LeagueHomeStates` with the React Query cache pre-seeded; `useAuth`
 * mocked at the module edge; `useLeagueChannel` a spy for the connection;
 * `useStatsDegraded` a spy so the F277(d) gate is observable.
 *
 * THE DoD PROBE: point the hero's matchup card at week 1 unconditionally
 * (`heroWeek` → 1) — the ladder below has week 1 FINAL and week 2 LIVE, and
 * week 1's seeded document carries NO row for the viewer while week 2's
 * does, so the "matchup of the week" cell goes red (the card would say "no
 * matchup on record" instead of rendering the viewer's live row).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { leagueActivityKeys } from '@/hooks/use-league-activity'
import { useLeagueChannel } from '@/hooks/use-league-channel'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import { teamLineupKeys, type TeamLineupRow } from '@/hooks/use-lineup'
import { leagueMatchupKeys } from '@/hooks/use-matchups'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import { leagueStandingsKeys } from '@/hooks/use-standings'
import { statsDegradedKeys, useStatsDegraded } from '@/hooks/use-stats-degraded'
import type { ActivityFeed } from '@/lib/leagues/api/activity-service'
import type { MatchupRow, WeekMatchups } from '@/lib/leagues/api/matchups-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import type { StatsDegradedFlag } from '@/lib/sync/ingest-flags'

import { FEED_EMPTY_COPY } from './activity-feed-ops'
import {
  CHAMPION_UNRECORDED_COPY,
  LINEUP_NOT_SET_COPY,
  NONE_FOR_TEAM_COPY,
  NO_LADDER_COPY,
  PLAYOFF_NONE_FOR_TEAM_COPY,
  PLAYOFF_NO_ROWS_COPY,
  TRADES_LATER_COPY,
  WAIVERS_LATER_COPY,
} from './league-home-season-ops'
import { LeagueHomeStates } from './league-home-states'
import { GOLDEN_STANDINGS } from './standings-schedule.fixtures'
import { NO_FINAL_WEEKS_COPY } from './standings-table-ops'
import { LIVE_STATS_DELAYED_COPY, RECONNECTING_COPY, STALE_SCORES_COPY } from './status-banners'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-commish' }, profile: { username: 'chris' } }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))
vi.mock('@/hooks/use-stats-degraded', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/hooks/use-stats-degraded')>()
  return { ...orig, useStatsDegraded: vi.fn(orig.useStatsDegraded) }
})

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

const LEAGUE = 'league-1'
const T1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const T2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const T3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const T4 = 'aaaaaaaa-0000-4000-8000-000000000004'
const NAMES = new Map([
  [T1, 'Alpha'],
  [T2, 'Bravo'],
  [T3, 'Charlie'],
  [T4, 'Delta'],
])
const settings = { ...defaultsForTeamCount(8), regular_season_weeks: 3 }

function detailWith(over: Partial<LeagueDetail['league']> = {}, settingsOver: Partial<LeagueDetail['settings']> = {}): LeagueDetail {
  return {
    league: {
      id: LEAGUE,
      name: 'Render League',
      avatar_url: null,
      description: null,
      season: 2099,
      status: 'in_season',
      owner_id: 'user-commish',
      scoring_system_id: null,
      invite_code: null,
      invite_slug: null,
      max_teams: 8,
      created_at: null,
      updated_at: null,
      champion_team_id: null,
      ...over,
    },
    settings: { ...settings, ...settingsOver },
    members: [
      { id: 'm1', user_id: 'user-commish', team_id: T1, role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
      { id: 'm2', user_id: 'user-manager', team_id: T2, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
    ],
    teams: [...NAMES.entries()].map(([id, name]) => ({ id, name, owner_id: 'user-commish', status: 'active', created_at: null })),
    my_role: 'commissioner',
    active_draft: null,
  }
}

/** Week 1 FINAL, week 2 LIVE, week 3 upcoming — the current week is 2. */
const SCHEDULE: LeagueSchedule = {
  weeks: [
    { id: 'w1', season: 2099, week: 1, status: 'final', finalized_at: '2099-09-17T10:05:00Z', median_score: null },
    { id: 'w2', season: 2099, week: 2, status: 'live', finalized_at: null, median_score: null },
    { id: 'w3', season: 2099, week: 3, status: 'upcoming', finalized_at: null, median_score: null },
  ],
  matchups: [],
}

function mrow(over: Partial<MatchupRow> & Pick<MatchupRow, 'id' | 'week' | 'home_team_id' | 'away_team_id'>): MatchupRow {
  return { season: 2099, round_type: 'regular', status: 'live', home_score: null, away_score: null, result: null, is_overridden: false, updated_at: null, ...over }
}

function weekDoc(week: number, over: Partial<WeekMatchups> = {}): WeekMatchups {
  return {
    league_id: LEAGUE,
    season: 2099,
    week,
    schedule_mode: 'h2h',
    league_week: { status: week === 1 ? 'final' : 'live', median_score: null, finalized_at: null },
    teams: [...NAMES.entries()].map(([id, name]) => ({ id, name, status: 'active' })),
    matchups: [],
    results: [],
    ...over,
  }
}

/** Week 1's document carries NO row for the viewer (T1) — only T3 v T4 —
 *  so a hero pointed at week 1 by habit cannot pass the "my matchup" cell. */
const WEEK1 = weekDoc(1, { matchups: [mrow({ id: 'w1-m2', week: 1, home_team_id: T3, away_team_id: T4, status: 'final', home_score: 50, away_score: 40, result: 'home' })] })
/** Week 2 — the CURRENT week — has the viewer's live row. */
const WEEK2 = weekDoc(2, {
  matchups: [
    mrow({ id: 'w2-m1', week: 2, home_team_id: T1, away_team_id: T2, home_score: 71.5, away_score: 35 }),
    mrow({ id: 'w2-m2', week: 2, home_team_id: T3, away_team_id: T4, home_score: null, away_score: 12.25 }),
  ],
})

const LINEUP: TeamLineupRow = {
  id: 'l1',
  team_id: T1,
  season: 2099,
  week: 2,
  slot_map: { 'qb:0': 'qb1' },
  starters: [],
  bench: [],
  locked_at: '2099-09-13T17:00:00.000Z',
  edited_by_commish: false,
  set_at: '2099-09-10T00:00:00.000Z',
}

const FEED: ActivityFeed = {
  items: [
    { kind: 'transaction', id: 'tx1', created_at: '2099-09-10T12:00:00Z', type: 'add_drop', status: 'complete', week: 2, team_id: T1, actor_id: 'user-commish', action_id: 'a1', payload: { add: { name: 'Nine', player_id: 'p9', position: 'WR', nfl_team: 'AAA' }, drop: null } },
    { kind: 'system', id: 'c1', created_at: '2099-09-11T12:00:00Z', context: 'league', message: 'Schedule remixed by the commissioner.', actor_id: 'user-commish' },
    // R895: a week worker's notice — `user_id NULL` (116→118 `finalize_matchups`).
    { kind: 'system', id: 'c2', created_at: '2099-09-12T12:00:00Z', context: 'league', message: 'Week 2 finalized with a postponed game.', actor_id: null },
  ],
  limit: 8,
  has_more: false,
  next_before: null,
  next_before_id: null,
}

const FLAG_OK: StatsDegradedFlag = { degraded: false, consecutive_failures: 0, last_failure_at: null, last_success_at: '2099-09-13T18:00:00Z', last_error: null, provider: 'sleeper+nflverse' }
const FLAG_DEGRADED: StatsDegradedFlag = { ...FLAG_OK, degraded: true, consecutive_failures: 3, last_failure_at: '2099-09-13T18:03:00Z', last_error: 'timeout' }

function failQuery(client: QueryClient, queryKey: readonly unknown[], error: Error, data?: unknown) {
  const query = client.getQueryCache().build(client, { queryKey })
  if (data !== undefined) query.setData(data)
  query.setState({ status: 'error', error, fetchStatus: 'idle' })
}

function unescapeHtml(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

interface Seed {
  detail?: LeagueDetail
  schedule?: LeagueSchedule | 'error' | 'missing'
  weeks?: Record<number, WeekMatchups | 'error' | 'degraded'>
  standings?: typeof GOLDEN_STANDINGS | 'error' | 'missing'
  lineup?: TeamLineupRow | null | 'missing'
  feed?: ActivityFeed | 'error' | 'missing'
  flag?: StatsDegradedFlag
  connection?: 'live' | 'reconnecting' | 'connecting'
}

function renderHome(seed: Seed = {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  const detail = seed.detail ?? detailWith()
  qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)

  const schedule = seed.schedule ?? SCHEDULE
  if (schedule === 'error') failQuery(qc, scheduleKeys.all(LEAGUE), new Error('schedule read failed'))
  else if (schedule !== 'missing') qc.setQueryData(scheduleKeys.all(LEAGUE), schedule)

  const weeks = seed.weeks ?? { 1: WEEK1, 2: WEEK2 }
  for (const [w, doc] of Object.entries(weeks)) {
    const week = Number(w)
    if (doc === 'error') failQuery(qc, leagueMatchupKeys.week(LEAGUE, week), new Error('matchups read failed'))
    else if (doc === 'degraded') failQuery(qc, leagueMatchupKeys.week(LEAGUE, week), new Error('refetch failed'), WEEK2)
    else qc.setQueryData(leagueMatchupKeys.week(LEAGUE, week), doc)
  }

  const standings = seed.standings ?? GOLDEN_STANDINGS
  if (standings === 'error') failQuery(qc, leagueStandingsKeys.all(LEAGUE), new Error('standings read failed'))
  else if (standings !== 'missing') qc.setQueryData(leagueStandingsKeys.all(LEAGUE), standings)

  const lineup = seed.lineup === undefined ? LINEUP : seed.lineup
  if (lineup !== 'missing') qc.setQueryData(teamLineupKeys.week(T1, 2), lineup)

  const feed = seed.feed ?? FEED
  if (feed === 'error') failQuery(qc, leagueActivityKeys.feed(LEAGUE, { limit: 8 }), new Error('feed read failed'))
  else if (feed !== 'missing') qc.setQueryData(leagueActivityKeys.feed(LEAGUE, { limit: 8 }), feed)

  qc.setQueryData(statsDegradedKeys.flag(), seed.flag ?? FLAG_OK)

  vi.mocked(useLeagueChannel).mockReturnValue({ connection: seed.connection ?? 'live' })
  return unescapeHtml(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(LeagueHomeStates, { leagueId: LEAGUE }))))
}

// ---------------------------------------------------------------------------
// in_season — the hub (§16.5.1's in_season row)
// ---------------------------------------------------------------------------

describe('in_season — the matchup of the week is the viewer’s row at the ladder’s CURRENT week (the DoD probe)', () => {
  it('renders L.D5.2’s Scoreboard for week 2 (live), with the viewer’s side filled and the door’s stored scores', () => {
    const html = renderHome()
    expect(html).toContain('data-season-hero="in_season"')
    expect(html).toContain('data-matchup="w2-m1"')
    expect(html).toContain('Week 2 · Your matchup')
    expect(html).toContain('data-week-badge="live"')
    expect(html).toContain('data-score="71.50"')
    expect(html).toContain('data-score="35.00"')
    expect(html).toContain(`data-side="${T1}" data-mine="true"`)
    // The probe's negative controls: week 1's row is NOT the hero, and the
    // "no matchup on record" copy (which a week-1 hero would show) is absent.
    expect(html).not.toContain('data-matchup="w1-m2"')
    expect(html).not.toContain(NONE_FOR_TEAM_COPY)
    // The door into the matchup page names the row.
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/matchup/w2-m1"`)
    // The old placeholder is gone for this status.
    expect(html).not.toContain('The in-season experience lands in a later update')
  })

  it('the Set-lineup CTA links the viewer’s team page and renders the server’s lock RECORD — no countdown, no ledger code on screen', () => {
    const html = renderHome()
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/team/${T1}"`)
    expect(html).toContain('data-set-lineup-cta')
    expect(html).toMatch(/Week <span class="fs-num">2<\/span> · Locks from /)
    expect(html).not.toMatch(/countdown/i)
    expect(html.replace(/data-[a-z-]+="[^"]*"/g, '')).not.toMatch(/\b[QEF]\d+\b/)
  })

  it('no lineup row yet → the honest "nothing set" line; the roster-move door points at the players page', () => {
    const html = renderHome({ lineup: null })
    expect(html).toContain(LINEUP_NOT_SET_COPY)
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/players"`)
  })

  it('the standings peek is 117’s order (Alpha · Bravo · Charlie · Delta) with the viewer’s row filled, never a shadow', () => {
    const html = renderHome()
    const peek = html.slice(html.indexOf('data-standings-peek'), html.indexOf('data-activity-feed'))
    const order = [...peek.matchAll(/data-peek-row="([^"]+)"/g)].map((m) => m[1])
    expect(order).toEqual(['t1', 't2', 't3', 't4'])
    expect(peek).toContain('3-0')
    expect(peek).toContain('310.50')
    expect(peek).toContain(`href="/app/leagues/${LEAGUE}/standings"`)
  })

  it('an all-zero table with 117’s `no_final_weeks` reason renders the reason — a stored 0 is shown as 0, nothing papered over (F273)', () => {
    const zeros = {
      ...GOLDEN_STANDINGS,
      weeks_final: 0,
      reason: 'no_final_weeks',
      standings: GOLDEN_STANDINGS.standings.map((r) => ({ ...r, wins: 0, losses: 0, points_for: 0, points_against: 0, win_pct: 0 })),
    }
    const html = renderHome({ standings: zeros })
    expect(html).toContain('data-standings-reason="no_final_weeks"')
    expect(html).toContain(NO_FINAL_WEEKS_COPY)
    expect(html).toContain('0.00')
  })

  it('the waiver and trade chips render HONESTLY — the stored settings, the verbs named as later', () => {
    const html = renderHome()
    expect(html).toContain('data-chip="waivers"')
    expect(html).toContain('data-chip="trades"')
    expect(html).toContain(`Trade deadline · Week ${settings.trade_deadline_week}`)
    expect(html).toContain(WAIVERS_LATER_COPY)
    expect(html).toContain(TRADES_LATER_COPY)
    // Never a claim/propose button that posts nowhere.
    expect(html).not.toMatch(/>Claim<|>Propose trade</)
  })

  it('the activity feed renders L.D4.2’s items: a move with its team and week, an actor’s system post with the ✸ commissioner label, a NULL-actor notice with the plain system chip (R895)', () => {
    const html = renderHome()
    expect(html).toContain('data-feed-item="transaction"')
    expect(html).toContain('added Nine (WR · AAA)')
    expect(html).toContain('data-feed-item="system"')
    const c1 = html.slice(html.indexOf('Schedule remixed by the commissioner.') - 600, html.indexOf('Schedule remixed by the commissioner.'))
    expect(c1).toContain('data-commissioner')
    expect(c1).toContain('✸ commissioner')
    const c2 = html.slice(html.indexOf('Week 2 finalized with a postponed game.') - 600, html.indexOf('Week 2 finalized with a postponed game.'))
    expect(c2).toContain('data-system')
    expect(c2).toContain('>system<')
    expect(c2).not.toContain('data-commissioner')
    expect((html.match(/data-commissioner/g) ?? []).length).toBe(1)
  })

  it('the league nav carries the five in-season pages; both post-draft doors are present (F46 / R281)', () => {
    const html = renderHome()
    for (const key of ['team', 'matchups', 'standings', 'schedule', 'players']) expect(html).toContain(`data-nav="${key}"`)
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/draft/recap"`)
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/draft?practice=1"`)
    expect(html).toContain('data-door="recap"')
    expect(html).toContain('data-door="practice"')
  })

  it('a viewer without a franchise: no CTA, the honest no-seat copy, the whole-week door', () => {
    const detail = detailWith()
    detail.members = detail.members.map((m) => (m.user_id === 'user-commish' ? { ...m, team_id: null } : m))
    const html = renderHome({ detail })
    expect(html).toContain('data-empty="no_seat"')
    expect(html).not.toContain('data-set-lineup-cta')
    expect(html).not.toContain('data-nav="team"')
  })

  it('a week with rows but none for the viewer → the honest copy, never a stranger’s row', () => {
    const html = renderHome({ weeks: { 2: weekDoc(2, { matchups: [mrow({ id: 'x', week: 2, home_team_id: T3, away_team_id: T4 })] }) } })
    expect(html).toContain('data-empty="none_for_team"')
    expect(html).toContain(NONE_FOR_TEAM_COPY)
    expect(html).not.toContain('data-matchup="x"')
  })
})

describe('§16.5.3 — a total_points league’s hero is "your week so far vs the field"', () => {
  it('the leaderboard rows with the viewer’s row filled; absence is pending, never 0', () => {
    const doc = weekDoc(2, {
      schedule_mode: 'total_points',
      results: [
        { team_id: T2, points: 90, opponent_team_id: null, h2h_result: null, median_result: null, second_opponent_team_id: null, second_result: null, is_final: false },
        { team_id: T1, points: 71.5, opponent_team_id: null, h2h_result: null, median_result: null, second_opponent_team_id: null, second_result: null, is_final: false },
      ],
    })
    const html = renderHome({ weeks: { 2: doc } })
    expect(html).toContain('data-week-so-far')
    expect(html).toContain('Your week so far vs the field')
    expect(html).toContain(`data-leaderboard-row="${T2}"`)
    expect(html).toContain('90.00')
    expect(html).toContain('71.50')
    expect(html).toContain('>pending<')
    expect(html).not.toContain('data-matchup=')
  })
})

// ---------------------------------------------------------------------------
// playoffs — the bracket state the reads expose (no client bracket math)
// ---------------------------------------------------------------------------

describe('playoffs — the hero shows the playoff week’s row for the viewer, or says honestly why there is none', () => {
  const playoffLadder: LeagueSchedule = {
    weeks: [
      { id: 'w1', season: 2099, week: 1, status: 'final', finalized_at: null, median_score: null },
      { id: 'w2', season: 2099, week: 2, status: 'final', finalized_at: null, median_score: null },
      { id: 'w3', season: 2099, week: 3, status: 'final', finalized_at: null, median_score: null },
      { id: 'w4', season: 2099, week: 4, status: 'live', finalized_at: null, median_score: null },
    ],
    matchups: [],
  }
  it('a playoff row for the viewer renders as a Playoff matchup', () => {
    const html = renderHome({
      detail: detailWith({ status: 'playoffs' }),
      schedule: playoffLadder,
      weeks: { 4: weekDoc(4, { matchups: [mrow({ id: 'p1', week: 4, round_type: 'playoff', home_team_id: T1, away_team_id: T4 })] }) },
    })
    expect(html).toContain('data-season-hero="playoffs"')
    expect(html).toContain('Week 4 · Playoff matchup')
    expect(html).toContain('data-matchup="p1"')
  })
  it('no row for the viewer in a playoff week → the honest no-record copy (no bracket pointer at an unbuilt tab, no bye hedge — R896), never "eliminated"', () => {
    const html = renderHome({
      detail: detailWith({ status: 'playoffs' }),
      schedule: playoffLadder,
      weeks: { 4: weekDoc(4, { matchups: [mrow({ id: 'p2', week: 4, round_type: 'playoff', home_team_id: T2, away_team_id: T3 })] }) },
    })
    expect(html).toContain(PLAYOFF_NONE_FOR_TEAM_COPY)
    expect(html).not.toMatch(/eliminated/i)
    expect(html).not.toMatch(/standings page carries the bracket|a bye or/)
  })
  it('no rows yet → the round-pending copy', () => {
    const html = renderHome({ detail: detailWith({ status: 'playoffs' }), schedule: playoffLadder, weeks: { 4: weekDoc(4) } })
    expect(html).toContain(PLAYOFF_NO_ROWS_COPY)
  })
})

// ---------------------------------------------------------------------------
// complete — the champion banner, the final table, View History (§16.5.1)
// ---------------------------------------------------------------------------

describe('complete — the champion banner from the STORED id, the final standings, the View History door', () => {
  it('the champion by name; the full StandingsTable; View History → the recap door; no matchup card', () => {
    const html = renderHome({ detail: detailWith({ status: 'complete', champion_team_id: T2 }) })
    expect(html).toContain('data-season-hero="complete"')
    expect(html).toContain(`data-champion="Bravo"`)
    expect(html).toContain('data-final-standings')
    expect(html).toContain('data-standings-table')
    expect(html).toContain('>View History<')
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/draft/recap"`)
    expect(html).not.toContain('data-matchup=')
    expect(html).not.toContain('data-set-lineup')
  })
  it('an unwritten champion is said, never inferred from rank 1', () => {
    const html = renderHome({ detail: detailWith({ status: 'complete', champion_team_id: null }) })
    expect(html).toContain('data-champion="unrecorded"')
    expect(html).toContain(CHAMPION_UNRECORDED_COPY)
    expect(html).not.toContain('data-champion="Alpha"')
  })
  it('the stats_degraded poll is OFF for a complete league (F277(d))', () => {
    vi.mocked(useStatsDegraded).mockClear()
    renderHome({ detail: detailWith({ status: 'complete' }) })
    expect(vi.mocked(useStatsDegraded).mock.calls.at(-1)).toEqual([{ enabled: false }])
  })
})

// ---------------------------------------------------------------------------
// §16.5.4 — the required states
// ---------------------------------------------------------------------------

describe('§16.5.4 — the required states', () => {
  it('skeleton while the ladder is unknown', () => {
    expect(renderHome({ schedule: 'missing' })).toContain('data-skeleton="matchup-of-the-week"')
  })
  it('empty by reason: no ladder at all', () => {
    expect(renderHome({ schedule: { weeks: [], matchups: [] } })).toContain(NO_LADDER_COPY)
  })
  it('error-with-retry when the week read fails with nothing to show', () => {
    const html = renderHome({ weeks: { 2: 'error' } })
    expect(html).toContain('data-problem')
    expect(html).toContain('Couldn’t load this week.')
    expect(html).toContain('Retry')
  })
  it('degraded: a failed refetch keeps the last-good scores behind the stale banner', () => {
    const html = renderHome({ weeks: { 2: 'degraded' } })
    expect(html).toContain(STALE_SCORES_COPY)
    expect(html).toContain('data-matchup="w2-m1"')
  })
  it('reconnecting: the room’s connection drives the banner (§9.3)', () => {
    expect(renderHome({ connection: 'reconnecting' })).toContain(RECONNECTING_COPY.split(' —')[0])
  })
  it('"Live stats delayed" raises the banner and the scores STAY; the poll asks only while the week is scoring', () => {
    vi.mocked(useStatsDegraded).mockClear()
    const html = renderHome({ flag: FLAG_DEGRADED })
    expect(html).toContain(LIVE_STATS_DELAYED_COPY)
    expect(html).toContain('data-score="71.50"')
    expect(vi.mocked(useStatsDegraded).mock.calls.at(-1)).toEqual([{ enabled: true }])
    // An upcoming current week: the hero mounts the hook OFF.
    vi.mocked(useStatsDegraded).mockClear()
    renderHome({ schedule: { weeks: [{ id: 'w9', season: 2099, week: 9, status: 'upcoming', finalized_at: null, median_score: null }], matchups: [] }, weeks: { 9: weekDoc(9, { league_week: { status: 'upcoming', median_score: null, finalized_at: null } }) } })
    expect(vi.mocked(useStatsDegraded).mock.calls.at(-1)).toEqual([{ enabled: false }])
  })
  it('the feed: empty by reason · error-with-retry', () => {
    expect(renderHome({ feed: { ...FEED, items: [] } })).toContain(FEED_EMPTY_COPY)
    expect(renderHome({ feed: 'error' })).toContain('Couldn’t load the activity feed.')
  })
  it('the standings peek: error-with-retry', () => {
    expect(renderHome({ standings: 'error' })).toContain('Couldn’t load the standings.')
  })
})

// ---------------------------------------------------------------------------
// House rules over the new files
// ---------------------------------------------------------------------------

describe('elevation is a hover affordance, never a resting one — the L.D5.4 files', () => {
  const files = [
    'src/components/leagues/league-home-season.tsx',
    'src/components/leagues/league-home-season-ops.ts',
    'src/components/leagues/activity-feed.tsx',
    'src/components/leagues/activity-feed-ops.ts',
    'src/components/leagues/players-page.tsx',
    'src/components/leagues/players-page-ops.ts',
    'src/hooks/use-league-pool.ts',
  ]
  const read = (f: string) => readFileSync(path.resolve(process.cwd(), f), 'utf8')
  const code = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')

  it('no feature file carries a resting shadow', () => {
    for (const f of files) {
      for (const m of code(read(f)).matchAll(/(?<![\w-])(?<!:)shadow-hard-[\w-]+/g)) {
        const before = code(read(f)).slice(Math.max(0, m.index - 40), m.index)
        expect(before, `${f}: ${m[0]}`).toMatch(/(hover|active|focus|focus-visible|group-hover|peer-hover|data-\[[^\]]*\]):$/)
      }
    }
  })
  it('no dark: variants, no next-themes; no clock read (§23.3 / F226) in the heroes, the ops or the hook; no second .channel(', () => {
    for (const f of files) {
      const src = code(read(f))
      expect(src, f).not.toMatch(/\bdark:/)
      expect(src, f).not.toContain('next-themes')
      expect(src, f).not.toMatch(/Date\.now\(|new Date\(\)/)
      expect(src, f).not.toContain('.channel(')
    }
  })
  it('the heroes compute no score, no countdown and no elimination — nothing is derived from a comparison of scores', () => {
    const src = code(read('src/components/leagues/league-home-season.tsx')) + code(read('src/components/leagues/league-home-season-ops.ts'))
    expect(src).not.toMatch(/home_score\s*[<>]|away_score\s*[<>]|setInterval|eliminated/)
  })
  it('no ledger code reaches the screen in any state (F277(a))', () => {
    for (const html of [renderHome(), renderHome({ detail: detailWith({ status: 'complete' }) }), renderHome({ lineup: null })]) {
      expect(html.replace(/data-[a-z-]+="[^"]*"/g, '')).not.toMatch(/\b[QEF]\d+\b/)
    }
  })
})
