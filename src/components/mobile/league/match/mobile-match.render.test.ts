/**
 * The mobile League › Match tab over REAL renders (the desktop
 * `matchup-view.render.test.ts` rig: `renderToStaticMarkup` with the React
 * Query cache pre-seeded — fetches are effects, so the cache IS the data).
 * Pins the handoff's structure (m-match.md §2.1–§2.2) and the app's
 * honesty rules on mobile: stored scores, pending as a word, no invented
 * win probability or live-play row.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { leagueBoxKeys } from '@/hooks/use-box-score'
import { commishMatchupLockKeys } from '@/hooks/use-commish-matchup-lock'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguePlayerValueKeys } from '@/hooks/use-league-player-values'
import { leaguesKeys } from '@/hooks/use-leagues'
import { leagueMatchupKeys } from '@/hooks/use-matchups'
import { leagueRosterKeys } from '@/hooks/use-rosters'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import { leagueStandingsKeys } from '@/hooks/use-standings'
import { statCorrectionsKeys } from '@/hooks/use-stat-corrections'
import { statsDegradedKeys } from '@/hooks/use-stats-degraded'
import type { BoxStarter, TeamBoxScore } from '@/lib/leagues/api/box-score-service'
import type { WeekMatchups } from '@/lib/leagues/api/matchups-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import type { LiveScoringFlags } from '@/lib/sync/ingest-flags'
import { useOverrideMode } from '@/stores/commish-override-store'

import { useMatchStore } from './match-store'
import { MobileMatch } from './mobile-match'

const nav = vi.hoisted(() => ({ path: '/app/leagues/league-1/matchup' }))

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-me' }, profile: { username: 'me' } }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))
vi.mock('@/hooks/use-notifications', () => ({
  useNotifications: () => ({ data: { unreadCount: 3 } }),
}))
// The override store's hooks read the server snapshot (`getInitialState`)
// in a static render, so a test turns the mode on through this spy.
vi.mock('@/stores/commish-override-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/stores/commish-override-store')>()
  return { ...orig, useOverrideMode: vi.fn(orig.useOverrideMode) }
})
vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}))

const LEAGUE = 'league-1'
const ME = 'aaaaaaaa-0000-4000-8000-000000000001'
const OPP = 'aaaaaaaa-0000-4000-8000-000000000002'
const T3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const T4 = 'aaaaaaaa-0000-4000-8000-000000000004'
const NAMES = new Map([
  [OPP, 'Gridiron Gurus'],
  [ME, 'Touchdown Tacos'],
  [T3, 'Charlie'],
  [T4, 'Delta'],
])

function detail(over: Partial<LeagueDetail> = {}): LeagueDetail {
  return {
    league: {
      id: LEAGUE,
      name: 'Sunday Funday League',
      avatar_url: null,
      description: null,
      season: 2099,
      status: 'in_season',
      owner_id: 'user-x',
      scoring_system_id: null,
      invite_code: null,
      invite_slug: null,
      max_teams: 4,
      created_at: null,
      updated_at: null,
      champion_team_id: null,
    },
    settings: { ...defaultsForTeamCount(8), regular_season_weeks: 3 },
    members: [
      { id: 'm1', user_id: 'user-me', team_id: ME, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dalton', avatar_url: null } },
      { id: 'm2', user_id: 'user-opp', team_id: OPP, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'marcus', avatar_url: null } },
    ],
    teams: [...NAMES.entries()].map(([id, name]) => ({ id, name, owner_id: 'user-x', status: 'active', created_at: null })),
    my_role: 'manager',
    active_draft: null,
    ...over,
  }
}

const SCHEDULE: LeagueSchedule = {
  weeks: [
    { id: 'w1', season: 2099, week: 1, status: 'final', finalized_at: null, median_score: null },
    { id: 'w2', season: 2099, week: 2, status: 'live', finalized_at: null, median_score: null },
  ],
  matchups: [],
}

function weekDoc(over: Partial<WeekMatchups> = {}): WeekMatchups {
  return {
    league_id: LEAGUE,
    season: 2099,
    week: 2,
    schedule_mode: 'h2h',
    league_week: { status: 'live', median_score: null, finalized_at: null },
    teams: [...NAMES.entries()].map(([id, name]) => ({ id, name, status: 'active' })),
    matchups: [
      { id: 'mA', season: 2099, week: 2, round_type: 'regular', status: 'live', home_team_id: T3, away_team_id: T4, home_score: null, away_score: 12.25, result: null, is_overridden: false, updated_at: null },
      // You are the AWAY team here — the card still puts you on the left.
      { id: 'mB', season: 2099, week: 2, round_type: 'regular', status: 'live', home_team_id: OPP, away_team_id: ME, home_score: 16.4, away_score: 39.7, result: null, is_overridden: false, updated_at: null },
    ],
    results: [],
    ...over,
  }
}

const LIVE = { id: 'g1', status: 'live', home_team: 'KC', away_team: 'DEN', home_score: 14, away_score: 10, quarter: 4, game_clock: '6:50', kickoff_at: '2099-09-13T17:00:00Z' }
const FINAL = { id: 'g2', status: 'final', home_team: 'GB', away_team: 'DET', home_score: 20, away_score: 31, quarter: null, game_clock: null, kickoff_at: '2099-09-13T17:00:00Z' }
const NEXT = { id: 'g3', status: 'scheduled', home_team: 'CLE', away_team: 'PIT', home_score: null, away_score: null, quarter: null, game_clock: null, kickoff_at: '2099-09-14T17:00:00Z' }

function starter(over: Partial<BoxStarter> & Pick<BoxStarter, 'slot'>): BoxStarter {
  const key = over.slot.split(':')[0]!
  return {
    slot_key: key,
    label: key === 'flex' ? 'FLEX (W/R/T)' : key.toUpperCase(),
    player: null,
    phase: 'up_next',
    game: null,
    points: 0,
    pending: [],
    reason: 'scored',
    line: null,
    ...over,
  }
}

function box(teamId: string, starters: BoxStarter[]): TeamBoxScore {
  return {
    league_id: LEAGUE,
    season: 2099,
    week: 2,
    team_id: teamId,
    lineup: { locked_at: null, set_at: null, edited_by_commish: false },
    starters,
    points: null,
    pending: [],
    no_stat_row: [],
    no_game_rows: false,
    points_source: 'live',
    stored_source: null,
    stored_note: null,
    bench: [],
  }
}

const MY_BOX = box(ME, [
  starter({ slot: 'qb:0', phase: 'up_next', game: NEXT, reason: 'no_stat_row', player: { id: 'p-qb', full_name: 'Shedeur Sanders', position: 'QB', nfl_team: 'CLE', headshot_url: null } }),
  starter({ slot: 'wr:0', phase: 'done', game: FINAL, points: 26.3, player: { id: 'p-wr', full_name: 'Jameson Williams', position: 'WR', nfl_team: 'DET', headshot_url: null } }),
  starter({ slot: 'flex:0', phase: 'now_playing', game: LIVE, points: 4.1, player: { id: 'p-fx', full_name: 'Isiah Pacheco', position: 'RB', nfl_team: 'KC', headshot_url: null } }),
  starter({ slot: 'te:0', reason: 'empty' }),
])
const OPP_BOX = box(OPP, [
  starter({ slot: 'qb:0', phase: 'done', game: FINAL, points: 0, pending: ['pass_yards'], player: { id: 'p-oqb', full_name: 'Jared Goff', position: 'QB', nfl_team: 'DET', headshot_url: null } }),
  starter({ slot: 'wr:0', phase: 'up_next', game: NEXT, reason: 'no_stat_row', player: { id: 'p-owr', full_name: 'A.J. Brown', position: 'WR', nfl_team: 'PIT', headshot_url: null } }),
  starter({ slot: 'flex:0', phase: 'done', game: FINAL, points: 12.2, player: { id: 'p-ofx', full_name: 'Jahmyr Gibbs', position: 'RB', nfl_team: 'DET', headshot_url: null } }),
  starter({ slot: 'te:0', phase: 'up_next', game: NEXT, reason: 'no_stat_row', player: { id: 'p-ote', full_name: 'Pat Freiermuth', position: 'TE', nfl_team: 'PIT', headshot_url: null } }),
])

const FLAG_OK = {
  degraded: false,
  consecutive_failures: 0,
  last_failure_at: null,
  last_success_at: null,
  last_error: null,
  provider: 'x',
  stall: { stalled: false, reasons: [], rows: 0, oldest_enqueued_at: null, threshold_minutes: 10, ingest_stale: false, last_ingest_at: null, ingest_threshold_minutes: 120, checked_at: '2099-09-13T18:05:00Z' },
} as unknown as LiveScoringFlags

function errored(qc: QueryClient, queryKey: readonly unknown[], message: string) {
  const q = qc.getQueryCache().build(qc, { queryKey })
  q.setState({ status: 'error', error: new Error(message), fetchStatus: 'idle' })
}

function render(
  seed: {
    detail?: LeagueDetail | 'error'
    week?: WeekMatchups
    matchupId?: string | null
    boxes?: Record<string, TeamBoxScore>
    rosters?: unknown
    standings?: 'error' | 'pending'
    values?: 'error'
    corrections?: 'error'
    lockEditable?: boolean
    schedule?: LeagueSchedule | 'error' | 'pending'
    weekParam?: number
  } = {},
): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  if (seed.detail === 'error') {
    const q = qc.getQueryCache().build(qc, { queryKey: leaguesKeys.detail(LEAGUE) })
    q.setState({ status: 'error', error: new Error('League not found'), fetchStatus: 'idle' })
  } else {
    qc.setQueryData(leaguesKeys.detail(LEAGUE), seed.detail ?? detail())
  }
  if (seed.schedule === 'error') errored(qc, scheduleKeys.all(LEAGUE), 'schedule down')
  else if (seed.schedule !== 'pending') qc.setQueryData(scheduleKeys.all(LEAGUE), seed.schedule ?? SCHEDULE)
  const week = seed.week ?? weekDoc()
  qc.setQueryData(leagueMatchupKeys.week(LEAGUE, week.week), week)
  for (const [team, b] of Object.entries(seed.boxes ?? { [ME]: MY_BOX, [OPP]: OPP_BOX })) qc.setQueryData(leagueBoxKeys.team(LEAGUE, week.week, team), b)
  qc.setQueryData(statsDegradedKeys.flag(), FLAG_OK)
  if (seed.rosters) qc.setQueryData(leagueRosterKeys.all(LEAGUE), seed.rosters)
  if (seed.values === 'error') errored(qc, leaguePlayerValueKeys.week(LEAGUE, 2099, week.week), 'values down')
  else
    qc.setQueryData(leaguePlayerValueKeys.week(LEAGUE, 2099, week.week), [
      { player_id: 'p-qb', projected_points: 19.71, projected_missing: false, season_points: null, season_games: null },
      { player_id: 'p-wr', projected_points: 11.4, projected_missing: false, season_points: null, season_games: null },
      { player_id: 'p-fx', projected_points: 9.9, projected_missing: false, season_points: null, season_games: null },
    ])
  if (seed.standings === 'error') errored(qc, leagueStandingsKeys.all(LEAGUE), 'standings down')
  else if (seed.standings !== 'pending')
    qc.setQueryData(leagueStandingsKeys.all(LEAGUE), {
      standings: [
        { team_id: ME, wins: 2, losses: 6, ties: 0 },
        { team_id: OPP, wins: 8, losses: 0, ties: 0 },
      ],
    })
  if (seed.corrections === 'error') errored(qc, statCorrectionsKeys.list(LEAGUE, { week: week.week, limit: 100 }), 'corrections down')
  if (seed.lockEditable !== undefined) {
    for (const m of week.matchups) {
      qc.setQueryData(commishMatchupLockKeys.one(LEAGUE, week.week, m.id), {
        league_id: LEAGUE,
        matchup_id: m.id,
        season: 2099,
        week: week.week,
        editable: seed.lockEditable,
        message: seed.lockEditable ? null : 'A starter is still playing.',
      })
    }
  }
  const html = renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(MobileMatch, { leagueId: LEAGUE, matchupId: seed.matchupId ?? null, weekParam: seed.weekParam ?? null })),
  )
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

describe('mobile Match — header and card', () => {
  const html = render()

  it('carries the league header: Home, the league name, search / notifications / messages', () => {
    expect(html).toContain('aria-label="Home"')
    expect(html).toContain('href="/app"')
    expect(html).toContain('>Sunday Funday League<')
    expect(html).toContain('aria-label="Search"')
    expect(html).toContain('Notifications (3 unread)')
  })

  it('opens on your matchup, you on the left with the stored scores, even as the away team', () => {
    expect(html).toContain('data-matchup="mB"')
    const card = html.match(/data-matchup="mB"[\s\S]*?data-match-yet|data-matchup="mB"[\s\S]*$/)?.[0] ?? ''
    expect(card.indexOf('Touchdown Tacos')).toBeLessThan(card.indexOf('Gridiron Gurus'))
    expect(html).toContain('data-score="39.70"')
    expect(html).toContain('data-score="16.40"')
    expect(html).toContain('bg-accent') // you are the blue avatar
  })

  it('meta is @manager · record (mirrored on the right), the manager a profile link', () => {
    expect(html).toContain('@dalton')
    expect(html).toContain('href="/u/dalton"')
    expect(html).toContain('2-6')
    expect(html).toContain('8-0')
  })

  it('shows the projected total only for a side whose every starter has a projection', () => {
    expect(html.match(/data-proj-total[^>]*>([^<]*)</)?.[1]).toBe('41.01')
    expect(html.match(/data-proj-total/g)?.length).toBe(1)
  })

  it('invents nothing: no win probability, no live-play row — and no streak before a week is final', () => {
    expect(html).not.toMatch(/% win/)
    expect(html).not.toMatch(/[▲▼]/)
    expect(html).not.toContain('data-streak')
    expect(html).not.toContain('yd catch')
  })

  // Gap list #39 (Chris, 2026-10-15): the streak by the record, counted the
  // one way (`streak-ops`) — every decided result (Chris, 2026-10-16).
  const final = (id: string, week: number, home: string, away: string, result: string) => ({
    id, season: 2099, week, round_type: 'regular', status: 'final', home_team_id: home, away_team_id: away, home_score: 1, away_score: 0, result, is_overridden: false,
  })
  it('shows each side’s streak by its record: "@dalton · 2-6 ▼2L" and "8-0 ▲3W · @marcus"', () => {
    const withStreaks = render({
      schedule: {
        ...SCHEDULE,
        matchups: [
          final('w0a', 0, ME, T3, 'home'),
          final('w0b', 0, OPP, T4, 'home'),
          final('w1a', 1, T3, ME, 'home'),
          final('w1b', 1, OPP, T4, 'home'),
          final('w1c', 2, ME, T4, 'away'),
          // Not a result yet: a live week.
          { ...final('w2', 2, OPP, ME, 'away'), status: 'live' },
          // A playoff game is a game: it extends the run.
          { ...final('p1', 15, T3, OPP, 'away'), round_type: 'playoff' },
        ],
      },
    })
    const me = withStreaks.slice(withStreaks.indexOf(`data-side="${ME}"`))
    expect(me).toMatch(/@dalton<\/a> · 2-6 <span class="text-negative-strong" data-streak="▼2L">▼2L<\/span>/)
    const opp = withStreaks.slice(withStreaks.indexOf(`data-side="${OPP}"`))
    expect(opp).toMatch(/8-0 <span class="text-positive-strong" data-streak="▲3W">▲3W<\/span> · <a [^>]*>@marcus</)
  })

  it('a median league counts the result against the League Median last in its week: won the game, lost to the median → "▼1L"', () => {
    const median = (week: number, team: string, result: string) => ({ season: 2099, week, team_id: team, median_result: result, is_final: true })
    const html = render({
      schedule: {
        ...SCHEDULE,
        matchups: [final('w1a', 1, ME, T3, 'home'), final('w1b', 1, OPP, T4, 'away')],
        median_results: [median(1, ME, 'loss'), median(1, OPP, 'win'), median(1, T3, 'loss'), median(1, T4, 'win')],
      },
    })
    expect(html.slice(html.indexOf(`data-side="${ME}"`))).toMatch(/data-streak="▼1L">▼1L</)
    // Lost the game, beat the median: the week ends on the win.
    expect(html.slice(html.indexOf(`data-side="${OPP}"`))).toMatch(/data-streak="▲1W">▲1W</)
  })

  // Ruling #23 (2026-10-15): the dots are a position indicator — no tapping,
  // swiping moves. (Before, each dot was a button naming its matchup.)
  it('one pager dot per matchup, yours first and current — not tappable, a status for screen readers', () => {
    const pager = html.match(/data-match-pager="true">[\s\S]*?data-match-pager-step="next"[^>]*>[^<]*<\/button>/)?.[0] ?? ''
    const dots = pager.match(/data-match-dots="true">([\s\S]*?)<\/div>/)?.[1] ?? ''
    expect(pager).toMatch(/aria-hidden="true" data-match-dots/)
    expect(dots.match(/<span /g)).toHaveLength(2)
    expect(dots).not.toContain('<button')
    expect(dots).toMatch(/^<span class="[^"]*w-3\.5 bg-m-t1[^"]*" data-dot-current="true">/)
    expect(pager).toContain('<span role="status" class="sr-only">Matchup 1 of 2: Gridiron Gurus vs Touchdown Tacos</span>')
  })

  it('keeps Previous / Next matchup for a keyboard or screen reader, off screen until focused', () => {
    const steps = html.match(/<button[^>]*data-match-pager-step="(prev|next)"[^>]*>[^<]*<\/button>/g) ?? []
    expect(steps).toHaveLength(2)
    expect(steps[0]).toContain('>Previous matchup</button>')
    expect(steps[1]).toContain('>Next matchup</button>')
    for (const b of steps) expect(b).toMatch(/class="sr-only focus-visible:not-sr-only /)
  })

  it('the live week’s yet-to-play line names your positions; the right side its count', () => {
    expect(html).toContain('Yet to play: 1 · QB')
    expect(html).toContain('Yet to play: 2<')
  })
})

describe('mobile Match — starters', () => {
  const html = render()

  it('has the Starters header with the week stepper (‹ disabled at the ladder’s start → loads week 1)', () => {
    expect(html).toContain('>Starters<')
    expect(html).toContain('>Week 2<')
    expect(html).toContain('href="/app/leagues/league-1/matchup?week=1"')
    expect(html).toMatch(/aria-disabled="true" aria-label="Next week"/)
  })

  it('pairs both lineups by slot with the coloured slot chip between them', () => {
    const row = html.match(/data-slot-row="qb:0"[\s\S]*?data-slot-row="wr:0"/)?.[0] ?? ''
    expect(row).toContain('S. Sanders')
    expect(row).toContain('bg-pos-qb')
    expect(row).toContain('J. Goff')
    expect(row.indexOf('S. Sanders')).toBeLessThan(row.indexOf('>QB<'))
    expect(row.indexOf('>QB<')).toBeLessThan(row.indexOf('J. Goff'))
    expect(html).toContain('>FLEX<')
  })

  it('writes POS · TEAM, points, projection and the game line the design’s way', () => {
    expect(html).toContain(' vs PIT') // a kickoff, formatted, then the opponent
    expect(html).not.toContain('2099-09-14T17:00:00Z')
    expect(html).toContain('Final W 31-20 @ GB')
    expect(html).toContain('Q4 6:50 vs DEN')
    expect(html).toContain('>26.30<')
    expect(html).toContain('>19.71<')
    expect(html).toContain('A.J. Brown')
  })

  it('not played yet is "-", an empty seat is "Empty", and PENDING stays the word — never 0.00', () => {
    expect(html).toMatch(/data-starter-cell="yet_to_play">-</)
    expect(html).toContain('>Empty<')
    expect(html).toMatch(/data-starter-cell="pending">pending</)
  })

  it('player halves are buttons that open the profile', () => {
    expect(html).toMatch(/<button type="button" class="[^"]*" data-player="p-qb"/)
  })
})

describe('mobile Match — bench', () => {
  const roster = (player_id: string, full_name: string, position: string, nfl_team: string, bye_week: number, slot_key = 'bn') => ({
    player_id,
    full_name,
    position,
    nfl_team,
    bye_week,
    slot_key,
  })
  const html = render({
    boxes: {
      [ME]: { ...MY_BOX, bench: [{ player_id: 'p-bn', phase: 'done', game: FINAL, points: 3.2, pending: [], reason: 'scored' }] },
      [OPP]: { ...OPP_BOX, bench: [{ player_id: 'p-gone', phase: 'up_next', game: null, points: 0, pending: [], reason: 'no_stat_row' }] },
    },
    rosters: {
      teams: [
        { team_id: ME, roster: [roster('p-qb', 'Shedeur Sanders', 'QB', 'CLE', 9, 'qb'), roster('p-bn', 'Tyler Allgeier', 'RB', 'DET', 5)] },
        { team_id: OPP, roster: [] },
      ],
    },
  })

  it('lists both benches under a Bench title with BN chips, never counted', () => {
    expect(html).toContain('>Bench<')
    expect(html).toContain('Bench points don’t count toward the total.')
    expect(html).toContain('T. Allgeier')
    const bn = html.match(/<span class="([^"]*)">BN</)?.[1] ?? ''
    expect(bn).toContain('bg-surface-hover')
    expect(bn).toContain('text-ink')
    expect(bn).toContain('rounded-[8px]')
    expect(html).toContain('>BN<')
    expect(html).toContain('>3.20<')
  })

  it('names a bench line no roster holds any more instead of inventing a seat', () => {
    expect(html).toContain('Player no longer on this roster')
  })

  it('adds the bye week from the roster read to POS · TEAM', () => {
    expect(html).toContain(' · CLE (9)')
  })
})

describe('mobile Match — other states', () => {
  it('a named matchup opens on it, pending home score as the word', () => {
    const html = render({ matchupId: 'mA', boxes: {} })
    expect(html).toContain('data-matchup="mA"')
    expect(html).toContain('data-score="pending"')
    expect(html).toContain('data-score="12.25"')
  })

  it('a bye side says so', () => {
    const html = render({
      week: weekDoc({ matchups: [{ id: 'mB', season: 2099, week: 2, round_type: 'regular', status: 'live', home_team_id: ME, away_team_id: null, home_score: 10, away_score: null, result: null, is_overridden: false, updated_at: null }] }),
    })
    expect(html).toContain('data-side="bye"')
    expect(html).toContain('No opponent this week.')
  })

  it('a decided week puts the stored result where the design has the win %', () => {
    const html = render({
      week: weekDoc({
        league_week: { status: 'final', median_score: null, finalized_at: null },
        matchups: [{ id: 'mB', season: 2099, week: 2, round_type: 'regular', status: 'final', home_team_id: OPP, away_team_id: ME, home_score: 16.4, away_score: 39.7, result: 'away', is_overridden: true, updated_at: null }],
      }),
    })
    expect(html).toContain('data-result="win"')
    expect(html).toContain('data-result="loss"')
    expect(html).toContain('✸ Adjusted')
    expect(html).not.toContain('data-yet-to-play')
  })

  it('a total-points week shows the leaderboard instead of a matchup', () => {
    const html = render({ week: weekDoc({ schedule_mode: 'total_points', matchups: [] }) })
    expect(html).toContain('data-leaderboard')
    expect(html).toContain('>Week leaderboard<')
  })

  it('a league that will not load says so with a retry', () => {
    const html = render({ detail: 'error' })
    expect(html).toContain('Couldn’t load this league.')
    expect(html).toContain('>Try again<')
  })
})

describe('mobile Match — app-only content kept in the mobile language', () => {
  it('ends the starters with each side’s own box Total — pending stays the word', () => {
    const html = render()
    const total = html.match(/data-total-row[\s\S]*?<\/div>/)?.[0] ?? ''
    expect(total).toContain('>Total<')
    expect(html).toMatch(new RegExp(`data-box-total="${ME}"`))
    expect(html).toMatch(new RegExp(`data-box-total="${OPP}"`))
    expect(html.match(/data-box-sum="pending"/g)?.length).toBe(2)
    expect(html).not.toContain('data-box-sum="0.00"')
  })

  it('a decided box sum is the number', () => {
    const html = render({ boxes: { [ME]: { ...MY_BOX, points: 30.4 }, [OPP]: OPP_BOX } })
    expect(html).toContain('data-box-sum="30.40"')
  })

  it('a playoff matchup says so on the card', () => {
    const html = render({
      week: weekDoc({
        matchups: [{ id: 'mB', season: 2099, week: 2, round_type: 'playoff', status: 'live', home_team_id: OPP, away_team_id: ME, home_score: 16.4, away_score: 39.7, result: null, is_overridden: false, updated_at: null }],
      }),
    })
    expect(html).toContain('Week 2 · Playoffs')
    expect(render()).not.toContain('Playoffs')
  })

  it('the total-points week keeps its "Total points" label', () => {
    const html = render({ week: weekDoc({ schedule_mode: 'total_points', matchups: [] }) })
    expect(html).toContain('data-total-points-label')
    expect(html).toContain('>Total points<')
  })

  it('a failed corrections read is said in the mobile language, with a retry', () => {
    const html = render({ corrections: 'error' })
    const note = html.match(/data-correction-note="error"[\s\S]*?<\/div>/)?.[0] ?? ''
    expect(note).toContain('Couldn’t check this week’s stat corrections.')
    expect(note).toContain('>Try again<')
    expect(note).not.toContain('text-n-3')
  })

  it('the commissioner’s override panel renders in the mobile language (themed tokens, no desktop fills)', () => {
    vi.mocked(useOverrideMode).mockReturnValue(true)
    try {
      const html = render({ detail: detail({ my_role: 'commissioner' }), lockEditable: true })
      expect(html).toContain('data-override-indicator')
      const panel = html.match(/<section[^>]*data-override-panel[\s\S]*?<\/section>/)?.[0] ?? ''
      expect(panel).toContain('Correct this matchup')
      expect(panel).toContain('Save scores')
      expect(panel).toContain('Declare Gridiron Gurus the winner')
      expect(panel).toContain('Declare Touchdown Tacos the winner')
      expect(panel).toContain('bg-m-b1')
      expect(panel).not.toMatch(/bg-brand-soft|bg-white|border-n-4|text-n-6/)
      const locked = render({ detail: detail({ my_role: 'commissioner' }), lockEditable: false })
      expect(locked).toContain('data-override-lock="locked"')
      expect(locked).toContain('A starter is still playing.')
      expect(locked).not.toContain('Save scores')
    } finally {
      vi.mocked(useOverrideMode).mockReset()
    }
  })

  it('no override panel for a manager, even with the mode on', () => {
    vi.mocked(useOverrideMode).mockReturnValue(true)
    try {
      expect(render({ lockEditable: true })).not.toContain('data-override-panel')
    } finally {
      vi.mocked(useOverrideMode).mockReset()
    }
  })
})

describe('mobile Match — reads that fail are said, never silently missing', () => {
  it('records still loading hold a placeholder in the meta line', () => {
    const html = render({ standings: 'pending' })
    expect(html).toContain('data-record="loading"')
    expect(html).not.toContain('Couldn’t load the records.')
  })

  it('a failed standings read says the records could not load, with a retry', () => {
    const html = render({ standings: 'error' })
    expect(html).toContain('data-read-problem="records"')
    expect(html).toContain('Couldn’t load the records.')
    expect(html).not.toContain('2-6')
  })

  // Gap list #39 review: the streaks come from the schedule read; when it
  // fails the card says so rather than looking like a team with no streak.
  it('a failed schedule read (the week from the URL) says the streaks could not load, with a retry', () => {
    const html = render({ schedule: 'error', weekParam: 2 })
    expect(html).toContain('data-side=')
    expect(html).toContain('data-read-problem="streaks"')
    expect(html).toContain('Couldn’t load the streaks.')
    expect(html).not.toMatch(/data-streak="[▲▼]/)
  })

  it('streaks still loading hold a placeholder by the record', () => {
    const html = render({ schedule: 'pending', weekParam: 2 })
    expect(html).toContain('data-side=')
    expect(html).toContain('data-streak="loading"')
    expect(html).not.toContain('data-read-problem="streaks"')
  })

  it('a failed projections read says so instead of dropping the projections', () => {
    const html = render({ values: 'error' })
    expect(html).toContain('data-read-problem="projections"')
    expect(html).not.toContain('data-proj-total')
  })
})

describe('mobile Match — which matchup it opens on', () => {
  it('Back to a swiped matchup: the URL’s matchup wins over the page it was opened as', () => {
    nav.path = '/app/leagues/league-1/matchup/mA'
    try {
      const html = render({ matchupId: null, boxes: {} })
      expect(html).toContain('data-matchup="mA"')
    } finally {
      nav.path = '/app/leagues/league-1/matchup'
    }
  })

  it('arriving on the bare tab brings back the matchup swiped to before', () => {
    useMatchStore.setState({ spots: { [LEAGUE]: { matchupId: 'mA', week: null } } })
    try {
      expect(render({ boxes: {} })).toContain('data-matchup="mA"')
    } finally {
      useMatchStore.setState({ spots: {} })
    }
  })

  it('a route that names a matchup wins over the remembered one', () => {
    useMatchStore.setState({ spots: { [LEAGUE]: { matchupId: 'mA', week: null } } })
    try {
      expect(render({ matchupId: 'mB' })).toContain('data-matchup="mB"')
    } finally {
      useMatchStore.setState({ spots: {} })
    }
  })

  it('nothing remembered: your matchup', () => {
    useMatchStore.setState({ spots: {} })
    expect(render()).toContain('data-matchup="mB"')
  })
})
