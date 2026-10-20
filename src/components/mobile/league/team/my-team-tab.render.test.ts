/**
 * my-team-tab.render.test.ts — the mobile League › Team tab over a REAL
 * render (the `matchup-view.render.test.ts` rig: `renderToStaticMarkup` with
 * the React Query cache pre-seeded; effects don't run, so the cache is the
 * data). Pins the handoff's structure (m-team.md §2.1) on real reads: the
 * team card from standings + the saved lineup's projection, the game line
 * from `nfl_games`, the Starters / Bench rows incl. empty bench seats, the
 * quick actions the app can do (no News, no win meter), a past week
 * being read-only, and the Lineup check card above Starters (gap list §3
 * #11).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { leagueBoxKeys } from '@/hooks/use-box-score'
import type { LeagueDetail } from '@/hooks/use-league'
import { teamLineupKeys, type TeamLineupRow } from '@/hooks/use-lineup'
import { leaguePlayerValueKeys } from '@/hooks/use-league-player-values'
import { leagueRosterKeys } from '@/hooks/use-rosters'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import { leagueStandingsKeys } from '@/hooks/use-standings'
import type { LeagueRosters, RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { LeagueStandings } from '@/lib/leagues/api/standings-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { MyTeamTab } from './my-team-tab'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-me' }, profile: { username: 'me' }, isLoading: false }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))

const LEAGUE = 'league-1'
const ME = 'aaaaaaaa-0000-4000-8000-000000000001'
const THEM = 'aaaaaaaa-0000-4000-8000-000000000002'
const settings = defaultsForTeamCount(8)

const detail: LeagueDetail = {
  league: {
    id: LEAGUE,
    name: 'Sunday Funday League',
    avatar_url: null,
    description: null,
    season: 2099,
    status: 'in_season',
    owner_id: 'user-them',
    scoring_system_id: null,
    invite_code: null,
    invite_slug: null,
    max_teams: 8,
    created_at: null,
    updated_at: null,
    champion_team_id: null,
  },
  settings,
  members: [
    { id: 'm1', user_id: 'user-me', team_id: ME, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'me', avatar_url: null } },
    { id: 'm2', user_id: 'user-them', team_id: THEM, role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'marcus', avatar_url: null } },
  ],
  teams: [
    { id: ME, name: 'Touchdown Tacos', owner_id: 'user-me', status: 'active', created_at: '2099-01-01T00:00:00Z' },
    { id: THEM, name: 'Gridiron Gurus', owner_id: 'user-them', status: 'active', created_at: '2099-01-02T00:00:00Z' },
  ],
  my_role: 'manager',
  active_draft: null,
}

function p(id: string, full_name: string, position: string, nfl_team: string, bye: number | null = null): RosterPlayer {
  return {
    player_id: id,
    full_name,
    position,
    nfl_team,
    status: 'Active',
    bye_week: bye,
    slot_key: null,
    acquisition_type: null,
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: { state: 'unlocked', until: null },
  }
}

const ROSTER = [p('qb', 'Shedeur Sanders', 'QB', 'CLE', 9), p('rb', 'Bijan Robinson', 'RB', 'ATL', 5), p('wr', 'A.J. Brown', 'WR', 'PHI', 9), p('bn', 'Kendrick Bourne', 'WR', 'ARI', 8)]

const ROSTERS: LeagueRosters = {
  league_id: LEAGUE,
  season: 2099,
  teams: [
    { team_id: ME, name: 'Touchdown Tacos', owner_id: 'user-me', status: 'active', manager_user_id: 'user-me', autopilot: false, faab_balance: null, waiver_priority: null, roster: ROSTER },
    { team_id: THEM, name: 'Gridiron Gurus', owner_id: 'user-them', status: 'active', manager_user_id: 'user-them', autopilot: false, faab_balance: null, waiver_priority: null, roster: [] },
  ],
}

const SCHEDULE: LeagueSchedule = {
  weeks: [
    { id: 'w4', season: 2099, week: 4, status: 'final', finalized_at: null, median_score: null },
    { id: 'w5', season: 2099, week: 5, status: 'live', finalized_at: null, median_score: null },
    { id: 'w6', season: 2099, week: 6, status: 'upcoming', finalized_at: null, median_score: null },
  ],
  matchups: [],
}

const LINEUP: TeamLineupRow = {
  id: 'l1',
  team_id: ME,
  season: 2099,
  week: 5,
  slot_map: { 'qb:0': 'qb', 'rb:0': 'rb', 'wr:0': 'wr' },
  starters: [],
  bench: ['bn'],
  locked_at: null,
  edited_by_commish: false,
  set_at: null,
}

const row = (team_id: string, rank: number, wins: number, losses: number, pf: number, pa: number) => ({
  rank,
  team_id,
  name: team_id,
  wins,
  losses,
  ties: 0,
  games: wins + losses,
  win_pct: 0,
  points_for: pf,
  points_against: pa,
  weeks: wins + losses,
  median_record: { wins: 0, losses: 0, ties: 0 },
  second_record: { wins: 0, losses: 0, ties: 0 },
  separated_by: null,
  faab_balance: null,
  waiver_priority: null,
})

function render(schedule: LeagueSchedule = SCHEDULE, d: LeagueDetail = detail, seed?: (qc: QueryClient) => void): string {
  const week = 5
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(scheduleKeys.all(LEAGUE), schedule)
  qc.setQueryData(leagueRosterKeys.all(LEAGUE), ROSTERS)
  qc.setQueryData(teamLineupKeys.week(ME, week), LINEUP)
  qc.setQueryData(leagueStandingsKeys.all(LEAGUE), { standings: [row(THEM, 1, 4, 0, 500, 300), row(ME, 2, 2, 2, 400, 450)] } as unknown as LeagueStandings)
  qc.setQueryData(leaguePlayerValueKeys.week(LEAGUE, 2099, week), [
    { player_id: 'qb', projected_points: 19.71, projected_missing: null, season_points: null, season_games: 0 },
    { player_id: 'rb', projected_points: 16.03, projected_missing: null, season_points: null, season_games: 0 },
    { player_id: 'bn', projected_points: 5.1, projected_missing: null, season_points: null, season_games: 0 },
  ])
  qc.setQueryData(['mobile-team-games', 2099, week], [
    { id: 'g1', home_team: 'ATL', away_team: 'PHI', kickoff_at: '2099-10-11T17:00:00Z', status: 'final', home_score: 19, away_score: 17, quarter: null, game_clock: null },
  ])
  qc.setQueryData(leagueBoxKeys.team(LEAGUE, week, ME), { starters: [{ slot: 'rb:0', player: { id: 'rb' }, phase: 'done', points: 9.6, pending: [] }], bench: [] })
  seed?.(qc)
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MyTeamTab, { leagueId: LEAGUE, teamId: ME, detail: d })))
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

describe('MyTeamTab (mobile League › Team)', () => {
  const html = render()

  it('renders the league header and the team card from real reads', () => {
    expect(html).toContain('Sunday Funday League')
    expect(html).toContain('Touchdown Tacos')
    expect(html).toContain('2-2 · 2nd · PF 2nd · PA 1st')
    // Σ of the SAVED starters' projections (qb + rb; wr has none).
    expect(html).toContain('35.74')
  })

  it('offers only the quick actions the app can do', () => {
    expect(html).toContain('data-quick-action="schedule"')
    expect(html).toContain('data-quick-action="trade"')
    expect(html).toContain('data-quick-action="moves"')
    expect(html).not.toContain('News')
    expect(html).not.toMatch(/% win/)
  })

  it('quick actions sit in the designed 4-column grid; Moves opens the Transactions screen’s My moves', () => {
    expect(html).toContain('grid grid-cols-4 gap-1.5')
    expect(html).toContain('data-quick-action="moves" href="/app/leagues/league-1/activity/transactions?mine=1"')
  })

  it('Schedule opens the league schedule on your team (gap list §4 item 107)', () => {
    expect(html).toContain(`data-quick-action="schedule" href="/app/leagues/league-1/schedule?team=${ME}"`)
  })

  it('the team card avatar is your team’s accent blue — even when yours isn’t the league’s oldest team', () => {
    const newer = render(SCHEDULE, { ...detail, teams: [...detail.teams].reverse() })
    expect(newer).toMatch(new RegExp(`class="[^"]*bg-accent[^"]*"[^>]*data-team-avatar="${ME}"`))
  })

  it('shows Starters with the swap prompt and week, rows with the game line and points', () => {
    expect(html).toContain('Tap a position to swap players')
    expect(html).toContain('Week 5')
    expect(html).toContain('Bijan Robinson')
    expect(html).toContain('RB · ATL (5)')
    expect(html).toContain('Final W 19-17 vs PHI')
    expect(html).toContain('9.60')
    expect(html).toContain('16.03')
  })

  it('a game line opens that NFL game’s box score (gap list §3 #17); a bye stays part of the player’s button', () => {
    expect(html).toMatch(/<a [^>]*href="\/app\/leagues\/league-1\/games\/g1"[^>]*>[^<]*(?:<[^>]*>[^<]*)*?Final W 19-17 vs PHI/)
    // Shedeur Sanders (CLE) has no game this week: his "BYE" opens nothing new.
    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Shedeur Sanders(?:(?!<\/button>)[\s\S])*BYE(?:(?!<\/button>)[\s\S])*<\/button>/)
    // Never a link nested in a player's button.
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<a [^>]*games\//)
  })

  it('the game line’s tap area reaches 30px without moving it — down into the row, not over the name', () => {
    const link = /<a [^>]*href="\/app\/leagues\/league-1\/games\/g1"[^>]*>/.exec(html)?.[0] ?? ''
    for (const c of ['pt-0.5', '-mt-0.5', 'pb-3', '-mb-3']) expect(link).toContain(c)
  })

  it('a game in overtime reads "OT", like Match — never "Q5" (gap list §4 item 14)', () => {
    const ot = render(SCHEDULE, detail, (qc) =>
      qc.setQueryData(['mobile-team-games', 2099, 5], [
        { id: 'g1', home_team: 'ATL', away_team: 'PHI', kickoff_at: '2099-10-11T17:00:00Z', status: 'live', home_score: 17, away_score: 17, quarter: 5, game_clock: '2:31' },
      ]),
    )
    expect(ot).toContain('OT 2:31 vs PHI')
    expect(ot).not.toContain('Q5')
  })

  it('lists the bench with its empty seats (bench size minus bench players)', () => {
    expect(html).toContain('Kendrick Bourne')
    const benchChips = html.match(/>BN</g) ?? []
    expect(benchChips.length).toBe(settings.roster_settings.bench)
  })

  it('a week whose games are over is read-only and says why', () => {
    const over = render({ ...SCHEDULE, weeks: SCHEDULE.weeks.map((w) => (w.week === 5 ? { ...w, status: 'final' } : w)) })
    expect(over).not.toContain('Tap a position to swap players')
    expect(over).toContain('This week’s games are over — the lineup is final for scoring.')
    // Read-only: the slot chips are labels, not buttons.
    expect(over).not.toMatch(/aria-label="QB: Shedeur Sanders — swap"/)
    expect(html).toMatch(/aria-label="QB: Shedeur Sanders — swap"/)
  })

  describe('the team card when the standings read fails (gap list §3 #14)', () => {
    const failStandings = (data?: unknown) => (qc: QueryClient) => {
      const q = qc.getQueryCache().find({ queryKey: leagueStandingsKeys.all(LEAGUE) })!
      if (data === undefined) q.setState({ data: undefined, dataUpdatedAt: 0 })
      q.setState({ status: 'error', error: new Error('standings read failed'), errorUpdatedAt: 1, fetchStatus: 'idle' })
    }
    // Try again on an errored query with no data: React Query v5 puts it
    // back to `pending` (error cleared, errorUpdatedAt kept) while it runs.
    const retryingStandings = (qc: QueryClient) => {
      const q = qc.getQueryCache().find({ queryKey: leagueStandingsKeys.all(LEAGUE) })!
      q.setState({ data: undefined, dataUpdatedAt: 0, status: 'pending', error: null, errorUpdatedAt: 1, fetchStatus: 'fetching' })
    }
    const firstLoad = (qc: QueryClient) => {
      const q = qc.getQueryCache().find({ queryKey: leagueStandingsKeys.all(LEAGUE) })!
      q.setState({ data: undefined, dataUpdatedAt: 0, status: 'pending', error: null, errorUpdatedAt: 0, fetchStatus: 'fetching' })
    }
    const card = (out: string) => out.slice(out.indexOf('data-team-card'), out.indexOf('data-quick-action'))

    it('says "Couldn’t load the standings." with Try again — never "No games played yet"', () => {
      const out = card(render(SCHEDULE, detail, failStandings()))
      expect(out).toMatch(/role="alert"[^>]*data-standings-problem[\s\S]*?Couldn’t load the standings\.[\s\S]*?<button type="button"[^>]*>Try again<\/button>/)
      expect(out).not.toContain('No games played yet')
      expect(out).not.toContain('Season hasn’t started')
    })

    it('says the same before the season starts', () => {
      const preseason: LeagueDetail = { ...detail, league: { ...detail.league, status: 'drafting' } }
      const out = card(render(SCHEDULE, preseason, failStandings()))
      expect(out).toContain('Couldn’t load the standings.')
      expect(out).not.toContain('Season hasn’t started')
    })

    it('a failed refresh over a table already shown keeps the record line', () => {
      const out = card(render(SCHEDULE, detail, failStandings('keep')))
      expect(out).toContain('2-2 · 2nd · PF 2nd · PA 1st')
      expect(out).not.toContain('data-standings-problem')
    })

    it('Try again keeps the problem line up, reading "Trying…" and disabled, until the retry lands', () => {
      const out = card(render(SCHEDULE, detail, retryingStandings))
      expect(out).toMatch(/data-standings-problem[\s\S]*?Couldn’t load the standings\.[\s\S]*?<button type="button" disabled=""[^>]*>Trying…<\/button>/)
      expect(out).not.toContain('>Try again<')
      expect(out).not.toContain('No games played yet')
    })

    it('the first load holds the record line with a no-break space (a plain one collapses the line)', () => {
      const out = card(render(SCHEDULE, detail, firstLoad))
      expect(out).not.toContain('data-standings-problem')
      expect(out).toContain('tabular-nums">\u00a0</span>')
      expect(out).not.toContain('No games played yet')
    })

    it('a table that has loaded never shows the problem line', () => {
      expect(card(html)).not.toContain('data-standings-problem')
      expect(card(html)).not.toContain('Couldn’t load the standings.')
    })
  })

  describe('the Lineup check card (gap list §3 #11)', () => {
    const starterCount = settings.roster_settings.starting_slots.reduce((n, sl) => n + sl.count, 0)
    const VS_THEM: LeagueSchedule = { ...SCHEDULE, matchups: [{ id: 'mu5', week: 5, home_team_id: ME, away_team_id: THEM } as LeagueSchedule['matchups'][number]] }
    const THEIR_LINEUP: TeamLineupRow = { ...LINEUP, id: 'l2', team_id: THEM, slot_map: { 'qb:0': 'tq', 'rb:0': 'tr', 'ir1:0': 'thurt' }, bench: [] }
    const values = (extra: Array<[string, number]>) => (qc: QueryClient) =>
      qc.setQueryData(
        leaguePlayerValueKeys.week(LEAGUE, 2099, 5),
        [['qb', 19.71], ['rb', 16.03], ['bn', 5.1], ...extra].map(([player_id, projected_points]) => ({ player_id, projected_points, projected_missing: null, season_points: null, season_games: 0 })),
      )

    it('sits above Starters: starters set N/N, bye starters named, nobody injured', () => {
      expect(html).toContain('data-lineup-check')
      expect(html.indexOf('Lineup check')).toBeLessThan(html.indexOf('Tap a position to swap players'))
      expect(html).toContain(`>3/${starterCount}<`)
      expect(html).toContain(`${starterCount - 3} empty slots score zero`)
      // CLE has no game in a week that has games → Shedeur Sanders is on bye.
      expect(html).toMatch(/data-check="bye" data-tone="caution"[\s\S]*?<button[^>]*>Shedeur Sanders<\/button>/)
      expect(html).toMatch(/data-check="injury" data-tone="positive"[\s\S]*?>None</)
      // No matchup on the schedule this week → no projection row.
      expect(html).not.toContain('data-check="proj"')
    })

    it('projected score vs this week’s opponent — their stored starters (IR seats left out)', () => {
      const out = render(VS_THEM, detail, (qc) => {
        values([['wr', 10], ['tq', 20], ['tr', 15], ['thurt', 99]])(qc)
        qc.setQueryData(teamLineupKeys.week(THEM, 5), THEIR_LINEUP)
      })
      expect(out).toMatch(/data-check="proj" data-tone="positive"[\s\S]*?vs Gridiron Gurus[\s\S]*?>45\.74<[\s\S]*?>35\.00</)
    })

    it('a starter with no projection shows "–" and says why — never a partial sum', () => {
      const out = render(VS_THEM, detail, (qc) => {
        values([['tq', 20], ['tr', 15]])(qc)
        qc.setQueryData(teamLineupKeys.week(THEM, 5), THEIR_LINEUP)
      })
      expect(out).toMatch(/data-check="proj" data-tone="neutral"[\s\S]*?Not every starter has a projection yet/)
    })

    it('is not shown for a week whose games are over', () => {
      const over = render({ ...SCHEDULE, weeks: SCHEDULE.weeks.map((w) => (w.week === 5 ? { ...w, status: 'final' } : w)) })
      expect(over).not.toContain('data-lineup-check')
    })

    it('in the playoffs, only a team still playing this week gets the check', () => {
      const playoffs: LeagueDetail = { ...detail, league: { ...detail.league, status: 'playoffs' } }
      expect(render(SCHEDULE, playoffs)).not.toContain('data-lineup-check')
      expect(render(VS_THEM, playoffs)).toContain('data-lineup-check')
    })
  })
})
