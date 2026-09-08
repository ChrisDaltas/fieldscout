/**
 * matchup-view.render.test.ts — L.D5.2's states checklist, the §16.5.4
 * badge lifecycle, the §16.5.3 variants and the elevation pin, over REAL
 * renders (spec §11.4, §16.2 `matchup-view`, §16.5.3, §16.5.4; PROGRESS
 * D295/D296/D321(4)/Q42; D323).
 *
 * The `standings-schedule.render.test.ts` rig: `renderToStaticMarkup` over
 * the actual components with the React Query cache pre-seeded (fetches are
 * effects and effects do not run in a static render, so the cache IS the
 * data). `useAuth` is mocked at the module edge; `useLeagueChannel` is a
 * spy so a cell can put the room in `reconnecting`.
 *
 * Probes of the PR: (1) THE DoD's — hide the pending badge while the window
 * is open (make `correction_window` render the `final` state) → the
 * lifecycle cells below go red; (2) render a pending starter as `0.00` →
 * the E61 cell; (3) a resting `shadow-hard-*` on a row → the elevation pin;
 * (4) drop the `stats_degraded` banner → the degraded cell.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { leagueBoxKeys } from '@/hooks/use-box-score'
import type { LeagueDetail } from '@/hooks/use-league'
import { useLeagueChannel } from '@/hooks/use-league-channel'
import { leaguesKeys } from '@/hooks/use-leagues'
import { leagueMatchupKeys } from '@/hooks/use-matchups'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import { statsDegradedKeys } from '@/hooks/use-stats-degraded'
import type { BoxStarter, TeamBoxScore } from '@/lib/leagues/api/box-score-service'
import type { WeekMatchups } from '@/lib/leagues/api/matchups-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import type { StatsDegradedFlag } from '@/lib/sync/ingest-flags'

import { MatchupPage } from './matchup-view'
import {
  NO_LINEUP_COPY,
  NO_WEEK_COPY,
  PENDING_SCORE_COPY,
  PLAYOFF_ROUND_PENDING_COPY,
  YET_TO_PLAY_TITLE,
  ZERO_BY_NAME_TITLE,
} from './matchup-view-ops'
import { LIVE_STATS_DELAYED_COPY, RECONNECTING_COPY, STALE_SCORES_COPY } from './status-banners'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-commish' }, profile: { username: 'chris' } }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))

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

function detailWith(over: Partial<LeagueDetail['settings']> = {}): LeagueDetail {
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
    },
    settings: { ...settings, ...over },
    members: [
      { id: 'm1', user_id: 'user-commish', team_id: T1, role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
      { id: 'm2', user_id: 'user-manager', team_id: T2, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
    ],
    teams: [...NAMES.entries()].map(([id, name]) => ({ id, name, owner_id: 'user-commish', status: 'active', created_at: null })),
    my_role: 'commissioner',
    active_draft: null,
  }
}

const SCHEDULE: LeagueSchedule = {
  weeks: [
    { id: 'w1', season: 2099, week: 1, status: 'live', finalized_at: null, median_score: null },
    { id: 'w2', season: 2099, week: 2, status: 'upcoming', finalized_at: null, median_score: null },
    { id: 'w3', season: 2099, week: 3, status: 'upcoming', finalized_at: null, median_score: null },
    { id: 'w4', season: 2099, week: 4, status: 'upcoming', finalized_at: null, median_score: null },
  ],
  matchups: [
    { id: 'm1', season: 2099, week: 1, round_type: 'regular', status: 'live', home_team_id: T1, away_team_id: T2, home_score: null, away_score: null, result: null, is_overridden: false },
    { id: 'm2', season: 2099, week: 1, round_type: 'regular', status: 'live', home_team_id: T3, away_team_id: T4, home_score: null, away_score: null, result: null, is_overridden: false },
  ],
}

function weekDoc(over: Partial<WeekMatchups> = {}): WeekMatchups {
  return {
    league_id: LEAGUE,
    season: 2099,
    week: 1,
    schedule_mode: 'h2h',
    league_week: { status: 'live', median_score: null, finalized_at: null },
    teams: [...NAMES.entries()].map(([id, name]) => ({ id, name, status: 'active' })),
    matchups: [
      { id: 'm1', season: 2099, week: 1, round_type: 'regular', status: 'live', home_team_id: T1, away_team_id: T2, home_score: 71.5, away_score: 35, result: null, is_overridden: false, updated_at: null },
      { id: 'm2', season: 2099, week: 1, round_type: 'regular', status: 'live', home_team_id: T3, away_team_id: T4, home_score: null, away_score: 12.25, result: null, is_overridden: false, updated_at: null },
    ],
    results: [],
    ...over,
  }
}

function starter(over: Partial<BoxStarter> & Pick<BoxStarter, 'slot'>): BoxStarter {
  return {
    slot_key: over.slot.split(':')[0],
    label: over.slot.split(':')[0].toUpperCase(),
    player: { id: `p-${over.slot}`, full_name: `Player ${over.slot}`, position: 'WR', nfl_team: 'AAA' },
    phase: 'up_next',
    game: null,
    points: 0,
    pending: [],
    reason: 'scored',
    line: null,
    ...over,
  }
}

const GAME_LIVE = { id: 'g1', status: 'live', home_team: 'AAA', away_team: 'BBB', home_score: 14, away_score: 10, quarter: 3, game_clock: '7:12', kickoff_at: '2099-09-13T17:00:00Z' }
const GAME_FINAL = { ...GAME_LIVE, id: 'g2', status: 'final', home_team: 'CCC', away_team: 'DDD', home_score: 24, away_score: 17, quarter: null, game_clock: null }
const GAME_NEXT = { ...GAME_LIVE, id: 'g3', status: 'scheduled', home_team: 'EEE', away_team: 'FFF', home_score: null, away_score: null, quarter: null, game_clock: null, kickoff_at: '2099-09-14T00:20:00Z' }

/** The box the DoD's three starter states are read from. */
function boxFor(teamId: string, over: Partial<TeamBoxScore> = {}): TeamBoxScore {
  return {
    league_id: LEAGUE,
    season: 2099,
    week: 1,
    team_id: teamId,
    lineup: { locked_at: '2099-09-13T17:00:00Z', set_at: '2099-09-12T10:00:00Z', edited_by_commish: false },
    starters: [
      starter({ slot: 'qb:0', phase: 'now_playing', game: GAME_LIVE, points: 18.34, line: { pass_yards: 212, pass_tds: 2 }, player: { id: 'qb', full_name: 'Now Playing QB', position: 'QB', nfl_team: 'AAA' } }),
      starter({ slot: 'rb:0', phase: 'done', game: GAME_FINAL, points: 9.1, line: { rush_yards: 61 }, player: { id: 'rb', full_name: 'Done RB', position: 'RB', nfl_team: 'CCC' } }),
      // E61: a line with an undelivered applicable key — PENDING, never 0.
      starter({ slot: 'rb:1', phase: 'done', game: GAME_FINAL, points: 0, pending: ['charted_placeholder'], player: { id: 'rbp', full_name: 'Pending RB', position: 'RB', nfl_team: 'DDD' } }),
      // Q42: no line in a FINAL game — the worker's 0 by name.
      starter({ slot: 'wr:0', phase: 'done', game: GAME_FINAL, points: 0, reason: 'no_stat_row', player: { id: 'wr0', full_name: 'No Line WR', position: 'WR', nfl_team: 'CCC' } }),
      // Q42: no line BEFORE his game — yet to play.
      starter({ slot: 'wr:1', phase: 'up_next', game: GAME_NEXT, points: 0, reason: 'no_stat_row', player: { id: 'wr1', full_name: 'Up Next WR', position: 'WR', nfl_team: 'EEE' } }),
      starter({ slot: 'te:0', reason: 'empty', player: null }),
    ],
    points: null,
    pending: [{ player_id: 'rbp', keys: ['charted_placeholder'] }],
    no_stat_row: ['wr0', 'wr1'],
    no_game_rows: false,
    ...over,
  }
}

const SCORED_BOX = (teamId: string): TeamBoxScore => ({
  ...boxFor(teamId),
  starters: [starter({ slot: 'qb:0', phase: 'done', game: GAME_FINAL, points: 21.5 }), starter({ slot: 'rb:0', phase: 'done', game: GAME_FINAL, points: 13.5 })],
  points: 35,
  pending: [],
  no_stat_row: [],
})

const FLAG_OK: StatsDegradedFlag = { degraded: false, consecutive_failures: 0, last_failure_at: null, last_success_at: '2099-09-13T18:00:00Z', last_error: null, provider: 'sleeper+nflverse' }
const FLAG_DEGRADED: StatsDegradedFlag = { ...FLAG_OK, degraded: true, consecutive_failures: 3, last_failure_at: '2099-09-13T18:03:00Z', last_error: 'timeout' }

function failQuery(client: QueryClient, queryKey: readonly unknown[], error: Error, data?: unknown) {
  const query = client.getQueryCache().build(client, { queryKey })
  if (data !== undefined) query.setData(data)
  query.setState({ status: 'error', error, fetchStatus: 'idle' })
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
}

function unescapeHtml(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

function render(qc: QueryClient, element: React.ReactElement): string {
  return unescapeHtml(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element)))
}

interface Seed {
  detail?: LeagueDetail | 'error' | 'missing'
  schedule?: LeagueSchedule | 'error' | 'missing'
  week?: WeekMatchups | 'error' | 'degraded' | 'missing'
  boxes?: Record<string, TeamBoxScore | 'error' | 'missing'>
  flag?: StatsDegradedFlag
  matchupId?: string | null
  weekParam?: number | null
  connection?: 'live' | 'reconnecting' | 'connecting'
}

function renderMatchups(seed: Seed = {}): string {
  const qc = client()
  const detail = seed.detail ?? detailWith()
  if (detail === 'error') failQuery(qc, leaguesKeys.detail(LEAGUE), new Error('League not found'))
  else if (detail !== 'missing') qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)

  const schedule = seed.schedule ?? SCHEDULE
  if (schedule === 'error') failQuery(qc, scheduleKeys.all(LEAGUE), new Error('schedule read failed'))
  else if (schedule !== 'missing') qc.setQueryData(scheduleKeys.all(LEAGUE), schedule)

  const week = seed.week ?? weekDoc()
  const weekNumber = week !== 'error' && week !== 'degraded' && week !== 'missing' ? week.week : 1
  if (week === 'error') failQuery(qc, leagueMatchupKeys.week(LEAGUE, weekNumber), new Error('matchups read failed'))
  else if (week === 'degraded') failQuery(qc, leagueMatchupKeys.week(LEAGUE, weekNumber), new Error('refetch failed'), weekDoc())
  else if (week !== 'missing') qc.setQueryData(leagueMatchupKeys.week(LEAGUE, weekNumber), week)

  const boxes = seed.boxes ?? { [T1]: boxFor(T1), [T2]: SCORED_BOX(T2) }
  for (const [teamId, box] of Object.entries(boxes)) {
    if (box === 'error') failQuery(qc, leagueBoxKeys.team(LEAGUE, weekNumber, teamId), new Error('box read failed'))
    else if (box !== 'missing') qc.setQueryData(leagueBoxKeys.team(LEAGUE, weekNumber, teamId), box)
  }
  qc.setQueryData(statsDegradedKeys.flag(), seed.flag ?? FLAG_OK)

  vi.mocked(useLeagueChannel).mockReturnValue({ connection: seed.connection ?? 'live' })
  return render(qc, createElement(MatchupPage, { leagueId: LEAGUE, matchupId: seed.matchupId ?? null, weekParam: seed.weekParam ?? null }))
}

// ---------------------------------------------------------------------------
// The live scoreboard + the box (Live Mode) — the h2h default
// ---------------------------------------------------------------------------

describe('the h2h week — the viewer’s matchup, the door’s scores, the box in Live Mode groups', () => {
  const html = renderMatchups()

  it('opens on the viewer’s own matchup with the stored scores, two decimals, and the Live badge', () => {
    expect(html).toContain('data-matchup="m1"')
    expect(html).toContain('data-score="71.50"')
    expect(html).toContain('data-score="35.00"')
    expect(html).toContain('data-week-badge="live"')
    expect(html).toContain('>Live<')
    expect(html).toContain('data-variant="h2h"')
  })

  it('the other matchup is listed with its PENDING home score as the word, never 0.00 (E61) — and links to its own route', () => {
    expect(html).toContain('data-matchup-row="m2"')
    expect(html).toContain('href="/app/leagues/league-1/matchup/m2"')
    expect(html).toContain(`>${PENDING_SCORE_COPY}<`)
    expect(html).toContain('>12.25<')
    // The rendered TEXT never says 0.00 for the pending side (the E61 title
    // mentions the number only to say it is never shown).
    expect(html.match(/data-matchup-row="m2"[\s\S]*?<\/a>/)?.[0]).not.toContain('>0.00<')
  })

  it('the box renders Now playing / Done / Up next as groups, in that order', () => {
    const box = html.slice(html.indexOf(`data-box="${T1}"`))
    const now = box.indexOf('data-phase="now_playing"')
    const done = box.indexOf('data-phase="done"')
    const next = box.indexOf('data-phase="up_next"')
    expect(now).toBeGreaterThan(-1)
    expect(done).toBeGreaterThan(now)
    expect(next).toBeGreaterThan(done)
    expect(box).toContain('>Now playing<')
    expect(box).toContain('>Done<')
    expect(box).toContain('>Up next<')
  })

  it('a Now playing row carries the provider’s game state and the stored line; an Up next row its kickoff as a stored instant', () => {
    expect(html).toContain('BBB 10 – AAA 14 · Q3 7:12 · 212 pass yds · 2 pass TD')
    expect(html).toContain('Final · DDD 17 – CCC 24 · 61 rush yds')
    // The kickoff is formatted (viewer-local) — the literal instant never leaks raw.
    expect(html).not.toContain('2099-09-14T00:20:00Z')
    expect(html).toContain('data-starter="wr:1"')
  })

  it('a scored starter renders his rounded points', () => {
    expect(html).toContain('data-starter-cell="scored"')
    expect(html).toContain('>18.34<')
  })

  it('E61: a PENDING starter renders the word pending — never 0.00 — and holds the box total at pending', () => {
    const row = html.match(/data-starter="rb:1"[\s\S]*?data-starter-cell="([^"]+)"[^>]*>([^<]*)</)
    expect(row?.[1]).toBe('pending')
    expect(row?.[2]).toBe(PENDING_SCORE_COPY)
    expect(html).toContain('data-box-sum="pending"')
    expect(html).toContain('charted_placeholder')
  })

  it('Q42: a starter with NO line in a FINAL game renders the worker’s 0.00 by name, the reason in his title', () => {
    const row = html.match(/data-starter="wr:0"[\s\S]*?<span class="[^"]*" title="([^"]*)" data-starter-cell="zero_by_name">([^<]*)</)
    expect(row?.[1]).toBe(ZERO_BY_NAME_TITLE)
    expect(row?.[2]).toBe('0.00')
  })

  it('Q42: a starter with no line BEFORE his game is a dash that says it counts as 0 — not a 0.00 he has not earned, not a DNP label', () => {
    const row = html.match(/data-starter="wr:1"[\s\S]*?<span class="[^"]*" title="([^"]*)" data-starter-cell="yet_to_play">([^<]*)</)
    expect(row?.[1]).toBe(YET_TO_PLAY_TITLE)
    expect(row?.[2]).toBe('—')
    expect(html).not.toMatch(/DNP|Did not play/)
  })

  it('an empty seat is named, not scored', () => {
    expect(html).toContain('data-starter="te:0" data-starter-reason="empty"')
  })

  it('the opponent’s box total is the worker’s number', () => {
    expect(html).toContain('data-box-sum="35.00"')
  })

  it('no result chip is shown on a live row — the result is the server’s, written at finalization', () => {
    expect(html).not.toContain('data-result=')
  })
})

// ---------------------------------------------------------------------------
// THE DoD: the badge lifecycle — `Final (pending corrections)` → `Final`
// ---------------------------------------------------------------------------

describe('§16.5.4 — the badge lifecycle is league_weeks.status as the server holds it (D295)', () => {
  it('live → Live; nothing says final', () => {
    const html = renderMatchups({ week: weekDoc({ league_week: { status: 'live', median_score: null, finalized_at: null } }) })
    expect(html).toContain('data-week-badge="live"')
    expect(html).not.toContain('data-week-badge="pending_corrections"')
    expect(html).not.toContain('data-week-badge="final"')
    expect(html).not.toContain('Final (pending corrections)')
  })

  it('correction_window → `Final (pending corrections)` — the pending badge is SHOWN while the window is open, and `Final` alone is not', () => {
    const html = renderMatchups({
      week: weekDoc({
        league_week: { status: 'correction_window', median_score: null, finalized_at: null },
        matchups: weekDoc().matchups.map((m) => ({ ...m, status: 'live' })),
      }),
    })
    expect(html).toContain('data-week-badge="pending_corrections"')
    expect(html).toContain('>Final (pending corrections)<')
    expect(html).not.toContain('data-week-badge="final"')
    expect(html).not.toMatch(/>Final</)
  })

  it('final → `Final`; the pending badge is gone; the finalized results render their W/L chips', () => {
    const html = renderMatchups({
      week: weekDoc({
        league_week: { status: 'final', median_score: 53.25, finalized_at: '2099-09-18T10:05:00Z' },
        matchups: weekDoc().matchups.map((m) => ({ ...m, status: 'final', result: m.id === 'm1' ? 'home' : 'away' })),
        results: [
          { team_id: T1, points: 71.5, opponent_team_id: T2, h2h_result: 'win', median_result: null, second_opponent_team_id: null, second_result: null, is_final: true },
          { team_id: T2, points: 35, opponent_team_id: T1, h2h_result: 'loss', median_result: null, second_opponent_team_id: null, second_result: null, is_final: true },
        ],
      }),
    })
    expect(html).toContain('data-week-badge="final"')
    expect(html).toMatch(/>Final</)
    expect(html).not.toContain('pending_corrections')
    expect(html).not.toContain('Final (pending corrections)')
    expect(html).toContain('data-result="W"')
    expect(html).toContain('data-result="L"')
  })

  it('the badge is driven by the WEEK row, never by a matchup status or a score comparison — a final week with a NULL score still says Final', () => {
    const html = renderMatchups({
      week: weekDoc({
        league_week: { status: 'final', median_score: null, finalized_at: '2099-09-18T10:05:00Z' },
        matchups: [{ ...weekDoc().matchups[0], status: 'final', home_score: null, away_score: null, result: null }],
      }),
    })
    expect(html).toContain('data-week-badge="final"')
    expect(html).toContain('data-score="pending"')
  })

  it('a commissioner-adjusted row carries the ✸ chip', () => {
    const html = renderMatchups({ week: weekDoc({ matchups: [{ ...weekDoc().matchups[0], is_overridden: true }] }) })
    expect(html).toContain('data-overridden')
    expect(html).toContain('✸ Adjusted')
  })
})

// ---------------------------------------------------------------------------
// §16.5.3 — the three variants
// ---------------------------------------------------------------------------

describe('§16.5.3 — total_points REPLACES the matchup surface with the week leaderboard', () => {
  const doc = weekDoc({
    schedule_mode: 'total_points',
    matchups: [],
    results: [
      { team_id: T1, points: 101.02, opponent_team_id: null, h2h_result: null, median_result: null, second_opponent_team_id: null, second_result: null, is_final: false },
      { team_id: T2, points: 120.5, opponent_team_id: null, h2h_result: null, median_result: null, second_opponent_team_id: null, second_result: null, is_final: false },
    ],
  })
  const html = renderMatchups({ detail: detailWith({ schedule_mode: 'total_points' }), week: doc, boxes: { [T1]: SCORED_BOX(T1) } })

  it('renders the leaderboard, no scoreboard, no matchup list', () => {
    expect(html).toContain('data-variant="total_points"')
    expect(html).toContain('data-leaderboard')
    expect(html).not.toContain('data-matchup="')
    expect(html).not.toContain('data-matchup-row=')
  })

  it('ranks by stored points; a team with NO row is pending, unranked, at the bottom — never 0.00 (R788 / F241(b))', () => {
    const rows = [...html.matchAll(/data-leaderboard-row="([^"]+)" data-rank="([^"]+)"/g)].map((m) => [NAMES.get(m[1]), m[2]])
    expect(rows).toEqual([
      ['Bravo', '1'],
      ['Alpha', '2'],
      ['Charlie', 'pending'],
      ['Delta', 'pending'],
    ])
    expect(html).toContain('>120.50<')
    expect(html).toContain('>101.02<')
    const pendingRow = html.match(/data-leaderboard-row="[^"]+" data-rank="pending"[\s\S]*?<\/button>/)?.[0]
    expect(pendingRow).toContain('>pending<')
    expect(pendingRow).not.toContain('0.00')
  })

  it('opens the viewer’s own box beneath the board', () => {
    expect(html).toContain(`data-box="${T1}"`)
    expect(html).toContain('aria-pressed="true"')
  })
})

describe('§16.5.3 — median_game: the *vs League Median* row with its OWN W/L chip', () => {
  it('off by default — no median row', () => {
    expect(renderMatchups()).not.toContain('data-median-row')
  })
  it('live: the row renders with the median pending (NULL until every score is in) and no chip decided', () => {
    const html = renderMatchups({ detail: detailWith({ median_game: true }) })
    expect(html).toContain('data-median-row')
    expect(html).toContain('vs League Median')
    const row = html.match(/data-median-row[\s\S]*?<\/div>/)?.[0]
    expect(row).toContain('>—<')
  })
  it('final: the stored median and each side’s own median_result chip', () => {
    const html = renderMatchups({
      detail: detailWith({ median_game: true }),
      week: weekDoc({
        league_week: { status: 'final', median_score: 53.25, finalized_at: '2099-09-18T10:05:00Z' },
        matchups: weekDoc().matchups.map((m) => ({ ...m, status: 'final', result: 'home' })),
        results: [
          { team_id: T1, points: 71.5, opponent_team_id: T2, h2h_result: 'win', median_result: 'win', second_opponent_team_id: null, second_result: null, is_final: true },
          { team_id: T2, points: 35, opponent_team_id: T1, h2h_result: 'loss', median_result: 'loss', second_opponent_team_id: null, second_result: null, is_final: true },
        ],
      }),
    })
    const rows = [...html.matchAll(/data-median-row[\s\S]*?<\/div>/g)].map((m) => m[0])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('>53.25<')
    expect(rows[0]).toContain('data-median-result')
    expect(rows[0]).toMatch(/>W</)
    expect(rows[1]).toMatch(/>L</)
  })
})

describe('§16.5.3 — second_opponent: the second chip per side', () => {
  it('off by default — no second chip', () => {
    expect(renderMatchups()).not.toContain('data-second-chip')
  })
  it('live: the secondary row’s scores from each side, undecided; the secondary rows listed apart from the primary ones', () => {
    const html = renderMatchups({
      detail: detailWith({ second_opponent: true }),
      week: weekDoc({
        matchups: [
          ...weekDoc().matchups,
          { id: 's1', season: 2099, week: 1, round_type: 'secondary', status: 'live', home_team_id: T3, away_team_id: T1, home_score: 40, away_score: 71.5, result: null, is_overridden: false, updated_at: null },
          { id: 's2', season: 2099, week: 1, round_type: 'secondary', status: 'live', home_team_id: T2, away_team_id: T4, home_score: 35, away_score: 12.25, result: null, is_overridden: false, updated_at: null },
        ],
      }),
    })
    const chips = [...html.matchAll(/data-second-chip[\s\S]*?<\/div>/g)].map((m) => m[0])
    expect(chips).toHaveLength(2)
    expect(chips[0]).toContain('2nd opponent · Charlie')
    expect(chips[0]).toContain('71.50 – 40.00')
    expect(chips[1]).toContain('2nd opponent · Delta')
    expect(html).toContain('data-matchup-list="Second opponents"')
    // A secondary row is never the scoreboard's matchup.
    expect(html).not.toContain('data-matchup="s1"')
  })
  it('final: the results row’s second_result decides the chip', () => {
    const html = renderMatchups({
      detail: detailWith({ second_opponent: true }),
      week: weekDoc({
        league_week: { status: 'final', median_score: null, finalized_at: '2099-09-18T10:05:00Z' },
        matchups: weekDoc().matchups.map((m) => ({ ...m, status: 'final', result: 'home' })),
        results: [
          { team_id: T1, points: 71.5, opponent_team_id: T2, h2h_result: 'win', median_result: null, second_opponent_team_id: T3, second_result: 'win', is_final: true },
          { team_id: T2, points: 35, opponent_team_id: T1, h2h_result: 'loss', median_result: null, second_opponent_team_id: T4, second_result: 'tie', is_final: true },
        ],
      }),
    })
    const chips = [...html.matchAll(/data-second-chip[\s\S]*?<\/div>/g)].map((m) => m[0])
    expect(chips[0]).toMatch(/data-second-result[^>]*>W</)
    expect(chips[1]).toMatch(/data-second-result[^>]*>T</)
  })
  it('no division tags anywhere (Q30 (d), F221)', () => {
    expect(renderMatchups({ detail: detailWith({ median_game: true, second_opponent: true }) })).not.toMatch(/[Dd]ivision/)
  })
})

// ---------------------------------------------------------------------------
// §16.5.4 states — skeleton · empty by reason · error-with-retry · degraded
// ---------------------------------------------------------------------------

describe('§16.5.4 — the required states', () => {
  it('skeleton while the league loads; skeleton while the ladder is unknown', () => {
    expect(renderMatchups({ detail: 'missing' })).toContain('data-skeleton="matchup"')
    expect(renderMatchups({ schedule: 'missing' })).toContain('data-skeleton="matchup"')
  })
  it('skeleton for the week body while the matchups load', () => {
    const html = renderMatchups({ week: 'missing' })
    expect(html).toContain('data-week-strip')
    expect(html).toContain('data-skeleton="matchup"')
  })
  it('error-with-retry when the league / the schedule / the week fails with nothing to show', () => {
    expect(renderMatchups({ detail: 'error' })).toContain('Couldn’t load this league.')
    expect(renderMatchups({ schedule: 'error' })).toContain('Couldn’t load the schedule.')
    const html = renderMatchups({ week: 'error' })
    expect(html).toContain('Couldn’t load this week.')
    expect(html).toContain('Retry')
  })
  it('degraded: a failed refetch with last-good scores keeps the scores behind the stale banner', () => {
    const html = renderMatchups({ week: 'degraded' })
    expect(html).toContain(STALE_SCORES_COPY)
    expect(html).toContain('data-score="71.50"')
  })
  it('a box that failed with nothing to show is its own error-with-retry inside the card; the other box still renders', () => {
    const html = renderMatchups({ boxes: { [T1]: 'error', [T2]: SCORED_BOX(T2) } })
    expect(html).toContain('data-box-error')
    expect(html).toContain('data-box-sum="35.00"')
  })
  it('reconnecting: the room’s connection drives the banner (§9.3)', () => {
    expect(renderMatchups({ connection: 'reconnecting' })).toContain('Reconnecting — syncing this league…')
    expect(renderMatchups({ connection: 'live' })).not.toContain('Reconnecting')
    expect(RECONNECTING_COPY).toContain('Reconnecting')
  })
  it('"Live stats delayed" — the stats_degraded flag raises the banner and the scores STAY (honest staleness, never wrong numbers — §23.2/E45)', () => {
    const html = renderMatchups({ flag: FLAG_DEGRADED })
    expect(html).toContain(LIVE_STATS_DELAYED_COPY)
    expect(html).toContain('Last update')
    expect(html).toContain('data-score="71.50"')
    expect(html).toContain('>18.34<')
    expect(renderMatchups({ flag: FLAG_OK })).not.toContain(LIVE_STATS_DELAYED_COPY)
  })
  it('empty by reason: a playoff week before its round exists', () => {
    const html = renderMatchups({
      weekParam: 4,
      week: weekDoc({ week: 4, league_week: { status: 'upcoming', median_score: null, finalized_at: null }, matchups: [] }),
    })
    expect(html).toContain('data-empty="no-matchups"')
    expect(html).toContain(PLAYOFF_ROUND_PENDING_COPY)
  })
  it('empty by reason: no lineup on record for a team', () => {
    const html = renderMatchups({ boxes: { [T1]: boxFor(T1, { lineup: null, starters: [] }), [T2]: SCORED_BOX(T2) } })
    expect(html).toContain('data-empty="no-lineup"')
    expect(html).toContain(NO_LINEUP_COPY)
    // …and no sum is claimed for it — not even `pending`.
    expect(html.slice(html.indexOf(`data-box="${T1}"`), html.indexOf(`data-box="${T2}"`))).not.toContain('data-box-sum')
  })
  it('empty by reason: no schedule at all', () => {
    const html = renderMatchups({ schedule: { weeks: [], matchups: [] } })
    expect(html).toContain('data-empty="no-week"')
    expect(html).toContain(NO_WEEK_COPY)
  })
  it('a bye row renders the one side and says Bye', () => {
    const html = renderMatchups({
      week: weekDoc({ matchups: [{ ...weekDoc().matchups[0], away_team_id: null, away_score: null }] }),
      boxes: { [T1]: boxFor(T1) },
    })
    expect(html).toContain('data-side="bye"')
    expect(html).toContain('No opponent this week.')
  })
})

describe('the week is resolved from stored facts (F248(b)) — the URL’s matchup, ?week=, else the ladder', () => {
  it('a matchup id opens ITS week and selects it', () => {
    const html = renderMatchups({ matchupId: 'm2' })
    expect(html).toContain('data-matchup="m2"')
    expect(html).toContain('data-week="1"')
  })
  it('?week= names the week; prev/next walk the ladder', () => {
    const html = renderMatchups({ weekParam: 2, week: weekDoc({ week: 2, matchups: [] }) })
    expect(html).toContain('data-week="2"')
    expect(html).toContain('href="/app/leagues/league-1/matchup?week=1"')
    expect(html).toContain('href="/app/leagues/league-1/matchup?week=3"')
  })
  it('nothing named → the ladder’s current week (the greatest started week)', () => {
    expect(renderMatchups()).toContain('data-week="1"')
  })
})

// ---------------------------------------------------------------------------
// Elevation (CLAUDE.md) — the feature files, since ui/’s pin stops at ui/
// ---------------------------------------------------------------------------

const RESTING_SHADOW = /(?<![\w-])(?<!:)shadow-hard-[\w-]+/g
const INTERACTION_PREFIX = /(hover|active|focus|focus-visible|group-hover|peer-hover|data-\[[^\]]*\]):$/

function restingShadowsIn(source: string): string[] {
  const hits: string[] = []
  for (const match of source.matchAll(RESTING_SHADOW)) {
    const before = source.slice(Math.max(0, match.index - 40), match.index)
    if (INTERACTION_PREFIX.test(before)) continue
    const line = source.slice(source.lastIndexOf('\n', match.index) + 1, match.index)
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    hits.push(match[0])
  }
  return hits
}

const FILES = ['matchup-view.tsx', 'matchup-view-ops.ts', 'status-banners.tsx']
const HOOKS = ['use-box-score.ts', 'use-stats-degraded.ts']

describe('elevation is a hover affordance, never a resting one — the L.D5.2 files', () => {
  const read = (dir: string, f: string) => readFileSync(path.resolve(process.cwd(), dir, f), 'utf8')

  it('no feature file carries a resting shadow', () => {
    for (const f of FILES) expect(restingShadowsIn(read('src/components/leagues', f)), f).toEqual([])
  })

  it('no dark: variants, no next-themes (single theme); no clock (§23.3 / F226) in the view, the ops or the hooks', () => {
    for (const f of FILES) {
      const src = read('src/components/leagues', f)
      expect(src, f).not.toMatch(/\bdark:/)
      expect(src, f).not.toContain('next-themes')
      expect(src, f).not.toMatch(/Date\.now\(\)|new Date\(\)/)
    }
    for (const f of HOOKS) {
      const src = read('src/hooks', f)
      expect(src, f).not.toMatch(/Date\.now\(\)|new Date\(\)/)
      expect(src, f).not.toContain('.channel(')
    }
  })

  it('the view computes no score: no arithmetic over scores, no result derived from a comparison, no countdown', () => {
    const src = read('src/components/leagues', 'matchup-view.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(src).not.toMatch(/home_score\s*[-+*/><]|away_score\s*[-+*/><]|points\s*[-+*/]\s*/)
    expect(src).not.toMatch(/setInterval|setTimeout|countdown/i)
  })

  it('the selected side is a resting FILL, never a shadow (state by fill, elevation by hover)', () => {
    const src = read('src/components/leagues', 'matchup-view.tsx')
    expect(src).toContain("mine && 'bg-accent-soft'")
  })
})
