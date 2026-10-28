/**
 * The FieldScout Mobile player profile (m-pprofile) rendered against seeded
 * caches — header, strip, tabs and each tab body — with the leagues release
 * gated off and on.
 */
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ leagues: false, messages: false }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    from: () => ({}),
    channel: () => ({ on: () => ({}), subscribe: () => ({}) }),
    removeChannel: () => {},
  }),
}))

import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys, type MyLeagueRow } from '@/hooks/use-leagues'
import type { ProfileStatLine } from '@/hooks/use-mobile-pprofile-stat-lines'
import type { PlayerStatsPlayer, PlayerStatsResponse } from '@/hooks/use-player-stats'
import { AUTH_SESSION_KEY } from '@/hooks/use-auth'
import { draftQueueKeys } from '@/hooks/use-draft-queue'
import type { CoreStatsPayload } from '@/lib/players/core-stats-ops'

import { ProfileLoaded } from './mobile-player-profile'
import { useProfileUiStore } from './profile-ui-store'
import { HistoryTab, GameLogTab, TeamTab } from './profile-stats-tabs'
import { LeaguesTab, QueueButton, TransactionsTab } from './profile-leagues'

const html = (el: ReactElement, qc: QueryClient) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(DialogPrimitive.Root, { open: true }, el)))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')

const player: PlayerStatsPlayer = {
  id: 'p1',
  full_name: 'Bijan Robinson',
  position: 'RB',
  team: 'ATL',
  headshot_url: null,
  status: 'Questionable',
  jersey_number: 7,
  height: '72',
  weight: 220,
  birth_date: '2002-01-30',
  college: null,
  experience_years: 3,
  bye_week: 5,
  draft_year: null,
  draft_round: null,
  draft_pick: null,
  adp: 3,
  sos: null,
  auction_value: null,
  injury_body_part: 'Ankle',
  injury_notes: null,
  injury_start_date: null,
  practice_participation: null,
}

const season = { season: 2026, gamesPlayed: 4, totals: {} as never, fantasy: { ppr: 0, standard: 0 } }
const data: PlayerStatsResponse = { player, seasons: { current: season, last: { ...season, season: 2025 }, projection: season }, gameLog: [] }

const core: CoreStatsPayload = {
  basis: { kind: 'system', system: 'espn_standard' },
  season: 2026,
  // The NFL calendar's week: his bye (week 5), between week 4 and week 6.
  week: 5,
  total_points: 55,
  games: 4,
  avg_points: 13.75,
  projected_points: 15.2,
  pos_rank: 24,
  overall_rank: 60,
  weekly: [
    { week: 4, points: 14.4, proj: 12.1 },
    { week: 6, points: null, proj: 15.25 },
  ],
  box: { games: 4, totals: { rush_attempts: 64, rush_yards: 300, rush_tds: 2, targets: 12, receptions: 10 } },
  usage: { snap_pct: 72.5, target_share: null },
}

const games = [
  { week: 4, home_team: 'LV', away_team: 'ATL', kickoff_at: '2026-10-04T17:00:00Z', status: 'final' },
  { week: 6, home_team: 'ATL', away_team: 'PHI', kickoff_at: '2026-10-18T17:00:00Z', status: 'scheduled' },
]
const lines: ProfileStatLine[] = [
  { season: 2026, week: 4, is_live: false, rush_attempts: 16, rush_yards: 80, rush_tds: 1, receptions: 3, receiving_yards: 17, targets: 4, receiving_tds: 0 },
  { season: 2025, week: 1, is_live: false, rush_attempts: 10, rush_yards: 50, rush_tds: 0 },
]

function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(['player-core-stats', 'p1', 'espn_standard'], core)
  qc.setQueryData(['player-core-stats', 'p1', 'ppr'], { ...core, basis: { kind: 'system', system: 'ppr' }, pos_rank: 11 })
  qc.setQueryData(['nfl-team-schedule', 2026, 'ATL'], games)
  qc.setQueryData(['defense-splits', 2026], [])
  qc.setQueryData(['mobile-pprofile-stat-lines', 'p1', 2026], lines)
  qc.setQueryData(['mobile-pprofile-depth-chart', 'ATL'], [
    { id: 'p1', full_name: 'Bijan Robinson', first_name: 'Bijan', last_name: 'Robinson', position: 'RB', birth_date: '2002-01-30', depth_chart_position: 'RB', depth_chart_order: 1 },
  ])
  qc.setQueryData(leaguesKeys.all, [])
  return qc
}

const target = { playerId: 'p1', leagueId: null, listContext: null }

/** Every button in the markup that can be tapped to do something — not a
 *  selected chip (tapping it changes nothing) and not a disabled one — with
 *  its opening tag and whether it tints when pressed (gap list §4 item 18):
 *  itself, the label inside it, or the tappable row it opens (a section
 *  row's title button). */
function pressables(out: string): Array<{ tag: string; tints: boolean }> {
  return [...out.matchAll(/(<div class="[^"]*\bactive:bg-[^"]*"[^>]*>)?(<button\b[^>]*>)([\s\S]*?)<\/button>/g)]
    .filter(([, , tag]) => !/aria-pressed="true"|disabled=""/.test(tag!))
    .map(([, row, tag, inner]) => ({ tag: tag!, tints: !!row || /\bactive:bg-/.test(tag!) || /\bgroup-active:bg-/.test(inner!) }))
}

describe('mobile player profile — leagues gated off', () => {
  beforeEach(() => {
    flags.leagues = false
  })

  it('team-coloured header: close, + List, injury pill, name, team line, bio', () => {
    const out = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), seeded())
    expect(out).toContain('background:#A71930')
    expect(out).toContain('data-profile-close')
    expect(out).toContain('>List</button>')
    expect(out).not.toContain('data-profile-action')
    expect(out).toMatch(/data-profile-status[^>]*>Questionable</)
    expect(out).toContain('Bijan Robinson')
    expect(out).toContain('ATL · #7')
    expect(out).toMatch(/Age \d+ · 6'0" · 220 lb · 4th season/)
  })

  it("injury detail (pprofile-1): what is wrong is on screen in Home's words, never only a tooltip", () => {
    const hurt = { ...player, injury_body_part: 'Hamstring', practice_participation: 'Limited' }
    const out = html(createElement(ProfileLoaded, { data: { ...data, player: hurt }, target, onClose: () => {} }), seeded())
    // The pill keeps its look and its one word; the detail closes the name block, after the bio.
    const pill = out.match(/<span[^>]*data-profile-status[^>]*>Questionable</)?.[0] ?? ''
    expect(pill).toContain('bg-warn text-white')
    expect(pill).not.toContain('title=')
    expect(out).toMatch(/4th season<\/span><span[^>]*data-profile-injury[^>]*>Hamstring · limited practice<\/span><\/div>/)
    // Nothing hides it: no tooltip anywhere carries the injury.
    expect(out).not.toMatch(/title="[^"]*Hamstring/)
  })

  it('injury detail: Out keeps its own look, with the detail; no status, no detail', () => {
    const out = html(
      createElement(ProfileLoaded, {
        data: { ...data, player: { ...player, status: 'Out', injury_body_part: 'Ankle', injury_notes: 'Sprain' } },
        target,
        onClose: () => {},
      }),
      seeded(),
    )
    expect(out).toMatch(/<span[^>]*bg-m-gr text-m-tr[^>]*data-profile-status[^>]*>Out</)
    expect(out).toMatch(/data-profile-injury[^>]*>Ankle · Sprain</)

    // Healthy again but the feed left the body part behind: no pill, no detail.
    const healthy = html(
      createElement(ProfileLoaded, { data: { ...data, player: { ...player, status: 'Active' } }, target, onClose: () => {} }),
      seeded(),
    )
    expect(healthy).not.toContain('data-profile-status')
    expect(healthy).not.toContain('data-profile-injury')
    expect(healthy).not.toContain('Ankle')
  })

  it('an Out pill is the red tint with red text, never a bright-red fill (2026-10-18)', () => {
    const out = html(
      createElement(ProfileLoaded, { data: { ...data, player: { ...player, status: 'Out' } }, target, onClose: () => {} }),
      seeded(),
    )
    const pill = out.match(/<span[^>]*data-profile-status[^>]*>Out</)?.[0] ?? ''
    expect(pill).toContain('bg-m-gr')
    expect(pill).toContain('text-m-tr')
    expect(pill).not.toContain('bg-negative-strong')
    expect(pill).not.toContain('text-white')
  })

  it('strip: rank, avg, season pts, bye — and the tabs without the league ones', () => {
    const out = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), seeded())
    for (const s of ['#24', 'RB rank', '13.8', 'Avg pts', '55.0', '2026 pts', 'Bye week']) expect(out).toContain(s)
    expect(out).not.toContain('Rost')
    const tabs = [...out.matchAll(/data-profile-tab="(\w+)"/g)].map((m) => m[1])
    expect(tabs).toEqual(['summary', 'log', 'team', 'history'])
    expect(out).toMatch(/aria-selected="true"[^>]*data-profile-tab="summary"/)
  })

  it('scoring chip (gap list §3 #18): in the strip after the season points, named for the scoring it shows', () => {
    const out = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), seeded())
    const strip = [...out.matchAll(/data-strip="(\w+)"/g)].map((m) => m[1])
    expect(strip).toEqual(['rank', 'avg', 'total', 'scoring', 'bye'])
    // No pick, no league: ESPN Standard, said "Standard" as on the phone's other scoring pills.
    expect(out).toMatch(/<button type="button" aria-haspopup="dialog" aria-label="Scoring: Standard"[^>]*data-strip="scoring" data-profile-scoring="espn_standard"><span[^>]*>Standard<svg/)
    expect(out).toMatch(/data-profile-scoring[^]*?>Scoring<\/span><\/button>/)
    // The chip column takes its own width; the numbers share the rest.
    expect(out).toContain('grid-template-columns:minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto minmax(0, 1fr)')
  })

  it('scoring chip: a player with no bye on file still gets it, last', () => {
    const out = html(createElement(ProfileLoaded, { data: { ...data, player: { ...player, bye_week: null } }, target, onClose: () => {} }), seeded())
    expect([...out.matchAll(/data-strip="(\w+)"/g)].map((m) => m[1])).toEqual(['rank', 'avg', 'total', 'scoring'])
  })

  it('tabs pattern: one tab stop, the selected tab controls the panel that names it', () => {
    const out = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), seeded())
    const selected = out.match(/role="tab" aria-selected="true" id="([^"]+)" aria-controls="([^"]+)" tabindex="0"/)
    expect(selected).not.toBeNull()
    const [, tabId, panelId] = selected!
    expect(out).toContain(`id="${panelId}" role="tabpanel" aria-labelledby="${tabId}"`)
    expect([...out.matchAll(/role="tab" aria-selected="false" id="[^"]+" tabindex="-1"/g)]).toHaveLength(3)
  })

  it('summary: key stats tiles and the game cards; no ownership row, no news', () => {
    const out = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), seeded())
    expect(out).not.toContain('data-profile-ownership')
    expect(out).toContain('Key stats')
    expect(out).toContain('RB · 2026')
    expect(out).toContain('data-key-stat="snap_pct"')
    expect(out).toContain('Games and projections')
    expect(out).toMatch(/data-game-week="4"[\s\S]*?Points[\s\S]*?14\.4[\s\S]*?16 car 80 yds · 3 rec 17 yds/)
    // His bye falls between the last game played and the next one: it is this week.
    expect(out).toMatch(/data-game-week="5" data-current="true"[\s\S]*?Bye week/)
    expect(out).toMatch(/data-game-week="6"[\s\S]*?Projected[\s\S]*?15\.3[\s\S]*?Kickoff/)
    expect(out).not.toContain('Recent news')
  })

  it("this week's card shows the clock and score while his game is on, then the result (gap list §3 #19)", () => {
    const wk6 = { week: 6, home_team: 'ATL', away_team: 'PHI', kickoff_at: '2026-10-18T17:00:00Z' }
    const qc = seeded()
    qc.setQueryData(['nfl-team-schedule', 2026, 'ATL'], [games[0], { ...wk6, status: 'live', quarter: 4, game_clock: '2:00', home_score: 31, away_score: 7 }])
    const live = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), qc)
    // The live game is this week; the score and clock sit where the kickoff was.
    expect(live).toMatch(
      /data-game-week="6" data-current="true"[\s\S]*?Projected[\s\S]*?15\.3[\s\S]*?>Game<\/span><span class="whitespace-nowrap[^"]*">Q4 2:00 · 31-7<\/span>/,
    )

    // Over, the calendar still on week 6, its points not scored yet: the result.
    qc.setQueryData(['nfl-team-schedule', 2026, 'ATL'], [games[0], { ...wk6, status: 'final', quarter: null, game_clock: null, home_score: 31, away_score: 20 }])
    qc.setQueryData(['player-core-stats', 'p1', 'espn_standard'], { ...core, week: 6 })
    const final = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), qc)
    expect(final).toMatch(/data-game-week="6" data-current="true"[\s\S]*?>Game<\/span><span class="whitespace-nowrap[^"]*">Final W 31-20<\/span>/)
    expect(final).not.toMatch(/>(Live|Final)<\/span>/)
  })

  it("this week's card on the row the sync writes (status only, scores at the 0 default): plain Live / Final", () => {
    const synced = { week: 6, home_team: 'ATL', away_team: 'PHI', kickoff_at: '2026-10-18T17:00:00Z', quarter: null, game_clock: null, home_score: 0, away_score: 0 }
    const qc = seeded()
    qc.setQueryData(['nfl-team-schedule', 2026, 'ATL'], [games[0], { ...synced, status: 'live' }])
    const live = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), qc)
    expect(live).toMatch(/data-game-week="6" data-current="true"[\s\S]*?>Game<\/span><span class="whitespace-nowrap[^"]*">Live<\/span>/)
    expect(live).not.toContain('0-0')

    qc.setQueryData(['nfl-team-schedule', 2026, 'ATL'], [games[0], { ...synced, status: 'final' }])
    qc.setQueryData(['player-core-stats', 'p1', 'espn_standard'], { ...core, week: 6 })
    const final = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), qc)
    expect(final).toMatch(/data-game-week="6" data-current="true"[\s\S]*?>Game<\/span><span class="whitespace-nowrap[^"]*">Final<\/span>/)
    expect(final).not.toContain('0-0')
  })

  it('game log: season chips and the grouped table', () => {
    const qc = seeded()
    const out = html(
      createElement(GameLogTab, {
        player,
        season: 2026,
        year: 2026,
        onYear: () => {},
        choice: { kind: 'system', system: 'espn_standard' },
        core,
        schedule: [],
        lines,
        linesState: 'ready',
      }),
      qc,
    )
    expect([...out.matchAll(/aria-pressed="(true|false)"[^>]*>(\d{4})</g)].map((m) => [m[2], m[1]])).toEqual([
      ['2026', 'true'],
      ['2025', 'false'],
    ])
    expect(out).toContain('Fantasy')
    expect(out).toContain('Rushing')
    expect(out).toContain('Receiving')
    expect(out).toContain('data-table-row="4"')
    expect(out).toContain('14.40')
  })

  it('history: career rows without the transactions section; team tab depth chart', () => {
    const qc = seeded()
    const hist = html(
      createElement(HistoryTab, { player, season: 2026, choice: { kind: 'system', system: 'espn_standard' }, core, lines, linesState: 'ready', movesLeagueIds: null }),
      qc,
    )
    expect(hist).not.toContain('>Transactions<')
    expect(hist).toContain('Career')
    expect(hist).toContain('data-table-row="2026"')
    expect(hist).toContain('data-table-row="2025"')
    // Position rank [Std, PPR]: this season's from the two preset reads, tinted.
    expect(hist).toContain('Position rank')
    expect(hist).toMatch(/data-table-row="2026"[\s\S]*?bg-m-gr text-m-tr[^>]*>55\.0<[\s\S]*?bg-m-gr text-m-tr[^>]*>24<[\s\S]*?bg-m-gg text-m-tg[^>]*>11</)
    const team = html(createElement(TeamTab, { player }), qc)
    expect(team).toContain('Depth chart · ATL')
    expect(team).toContain('data-depth-slot="RB"')
    expect(team).toMatch(/text-accent[^>]*>Robinson</)
  })

  it('team tab (#45): each teammate’s name opens his profile; his own name is not a link', () => {
    const qc = seeded()
    qc.setQueryData(['mobile-pprofile-depth-chart', 'ATL'], [
      { id: 'p1', full_name: 'Bijan Robinson', first_name: 'Bijan', last_name: 'Robinson', position: 'RB', birth_date: '2002-01-30', depth_chart_position: 'RB', depth_chart_order: 1 },
      { id: 'p2', full_name: 'Tyler Allgeier', first_name: 'Tyler', last_name: 'Allgeier', position: 'RB', birth_date: '2000-04-15', depth_chart_position: 'RB', depth_chart_order: 2 },
    ])
    const team = html(createElement(TeamTab, { player, onOpenPlayer: () => {} }), qc)
    expect(team).toMatch(/<button type="button" aria-label="Open Tyler Allgeier"[^>]*data-depth-player="p2"[\s\S]*?>Allgeier</)
    expect(team).not.toContain('data-depth-player="p1"')
    expect(team).toMatch(/text-accent[^>]*>Robinson</)
    // Without a way to open a profile (outside the mobile profile), nothing is a button.
    expect(html(createElement(TeamTab, { player }), qc)).not.toContain('data-depth-player')
  })

  it('opened from a teammate (#45): the header’s Close is a Back to the first player, on its Team tab', () => {
    const nav = { kind: 'back' as const, label: 'Back to Drake London', run: () => {} }
    const out = html(createElement(ProfileLoaded, { data, target, onClose: () => {}, nav }), seeded())
    expect(out).toMatch(/aria-label="Back to Drake London"[^>]*data-profile-back/)
    expect(out).not.toContain('data-profile-close')
    // Back returns to the first player on the tab he was left on.
    useProfileUiStore.getState().setRestore({ playerId: 'p1', tab: 'team' })
    const back = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), seeded())
    expect(back).toMatch(/aria-selected="true"[^>]*data-profile-tab="team"/)
    expect(back).toContain('data-profile-team')
    useProfileUiStore.getState().setRestore(null)
    // A restore for another player is not his.
    useProfileUiStore.getState().setRestore({ playerId: 'p9', tab: 'team' })
    expect(html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), seeded())).toMatch(/aria-selected="true"[^>]*data-profile-tab="summary"/)
    useProfileUiStore.getState().setRestore(null)
  })

  it('key stats trends (#43): the arrow is the direction, the colour better or worse', () => {
    const qc = seeded()
    const wk = (week: number, rush_yards: number): ProfileStatLine => ({ season: 2026, week, is_live: false, rush_attempts: 10, rush_yards, rush_tds: 0, targets: 2, receptions: 1 })
    qc.setQueryData(['mobile-pprofile-stat-lines', 'p1', 2026], [wk(1, 120), wk(2, 120), wk(3, 40), wk(4, 40)])
    qc.setQueryData(['player-core-stats', 'p1', 'espn_standard'], {
      ...core,
      weekly: [1, 2, 3, 4].map((week) => ({ week, points: 10, proj: null })),
      box: { games: 4, totals: { rush_attempts: 40, rush_yards: 320, rush_tds: 0, targets: 8, receptions: 4 } },
    })
    const out = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), qc)
    // Rush yds per game fell (80 → 66.7): ▼ and red.
    expect(out).toMatch(/data-key-stat="rush_yds"[\s\S]*?text-m-red[^>]*data-key-trend="down" data-key-trend-tone="bad"[^>]*>▼ last 3 13\.3</)
  })

  it('key stats trends (#43): a QB throwing fewer interceptions lately is ▼ and GREEN — the colour follows better, not the arrow', () => {
    const qb: PlayerStatsResponse = { ...data, player: { ...player, position: 'QB' } }
    const qc = seeded()
    const wk = (week: number, interceptions: number): ProfileStatLine => ({
      season: 2026,
      week,
      is_live: false,
      pass_attempts: 30,
      pass_completions: 20,
      pass_yards: 250,
      pass_tds: 2,
      interceptions,
      rush_attempts: 3,
      rush_yards: 10,
      rush_tds: 0,
    })
    // 3 INT in week 1, then none: season 0.75 / gm, last 3 0.0 / gm.
    qc.setQueryData(['mobile-pprofile-stat-lines', 'p1', 2026], [wk(1, 3), wk(2, 0), wk(3, 0), wk(4, 0)])
    qc.setQueryData(['player-core-stats', 'p1', 'espn_standard'], {
      ...core,
      weekly: [1, 2, 3, 4].map((week) => ({ week, points: 10, proj: null })),
      box: {
        games: 4,
        totals: { pass_attempts: 120, pass_completions: 80, pass_yards: 1000, pass_tds: 8, interceptions: 3, rush_attempts: 12, rush_yards: 40, rush_tds: 0 },
      },
    })
    const out = html(createElement(ProfileLoaded, { data: qb, target, onClose: () => {} }), qc)
    const tile = out.match(/data-key-stat="int"[\s\S]*?<\/div>/)?.[0] ?? ''
    expect(tile).toMatch(/class="[^"]*text-m-green[^"]*" data-key-trend="down" data-key-trend-tone="good"[^>]*>▼ last 3 0\.8</)
    expect(tile).not.toContain('text-m-red')
  })
})

describe('mobile player profile — leagues on', () => {
  beforeEach(() => {
    flags.leagues = true
  })

  const league: MyLeagueRow = {
    id: 'L1',
    name: 'Sunday Funday League',
    avatar_url: null,
    season: 2026,
    status: 'in_season',
    team_count: 12,
    created_at: null,
    my_role: 'member',
    my_team_id: 't1',
  }
  const detail = {
    league: { id: 'L1', name: 'Sunday Funday League', status: 'in_season', season: 2026 },
    settings: { draft: { time_zone: null, draft_scheduled_at: null }, roster_settings: { starting_slots: [{ key: 'rb', count: 2 }], bench: 5, ir_slots: [], swap_spots: 0 }, waiver_type: 'rolling', faab_min_bid: 0 },
    members: [{ id: 'm1', user_id: 'u1', team_id: 't1', role: 'member', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dalton', avatar_url: null } }],
    teams: [{ id: 't1', name: 'Touchdown Tacos', owner_id: 'u1', status: 'active', created_at: null }],
    my_role: 'member',
    active_draft: null,
    waiver_window: null,
    waivers_live: true,
  } as unknown as LeagueDetail
  const rosterPlayer = {
    player_id: 'p1',
    full_name: 'Bijan Robinson',
    position: 'RB',
    nfl_team: 'ATL',
    status: null,
    bye_week: 5,
    slot_key: 'rb',
    acquisition_type: 'draft',
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: { state: 'unlocked', until: null },
  }

  function inLeague(): QueryClient {
    const qc = seeded()
    qc.setQueryData(leaguesKeys.all, [league])
    qc.setQueryData(leaguesKeys.detail('L1'), detail)
    qc.setQueryData(['league-rosters', 'L1'], {
      league_id: 'L1',
      season: 2026,
      teams: [{ team_id: 't1', name: 'Touchdown Tacos', owner_id: 'u1', status: 'active', manager_user_id: 'u1', autopilot: false, faab_balance: null, waiver_priority: 1, roster: [rosterPlayer] }],
    })
    qc.setQueryData(['league-pool', 'L1'], [])
    qc.setQueryData(['league-trade-deadline', 'L1'], { state: 'known', view: { passed: false, ms_remaining: null } })
    qc.setQueryData(AUTH_SESSION_KEY, { user: { id: 'u1' } })
    qc.setQueryData(['player-core-stats', 'p1', 'league:L1'], core)
    return qc
  }

  it('in his league: the Drop pill, the ownership row and the league tabs', () => {
    const out = html(createElement(ProfileLoaded, { data, target: { ...target, leagueId: 'L1' }, onClose: () => {} }), inLeague())
    expect(out).toMatch(/data-profile-action="mine"[^>]*>Drop</)
    expect(out).toContain('data-profile-ownership')
    expect(out).toContain('Touchdown Tacos · your team')
    // A long mixed summary truncates rather than pushing the row (and the
    // profile) into a sideways scroll on a phone.
    expect(out).toMatch(/class="min-w-0 max-w-\[60%\] truncate[^"]*"[^>]*data-profile-ownership-summary/)
    const tabs = [...out.matchAll(/data-profile-tab="(\w+)"/g)].map((m) => m[1])
    expect(tabs).toEqual(['summary', 'log', 'leagues', 'tx', 'team', 'history'])
  })

  it('scoring chip in his league: "League", named for that league, its scoring read', () => {
    const out = html(createElement(ProfileLoaded, { data, target: { ...target, leagueId: 'L1' }, onClose: () => {} }), inLeague())
    expect(out).toMatch(/aria-label="Scoring: Sunday Funday League"[^>]*data-profile-scoring="league:L1"><span[^>]*>League<svg/)
    expect(out).toMatch(/data-strip="rank"[^>]*><span[^>]*>#24</)
  })

  // F692 (Chris 2026-10-21, verbatim: "…the player detail page, mini modal or card should have "Drop" as an
  // option if they are droppable. Not if they are locked for the week though.")
  function lockedInLeague(): QueryClient {
    const qc = inLeague()
    qc.setQueryData(['league-rosters', 'L1'], {
      league_id: 'L1',
      season: 2026,
      teams: [
        {
          team_id: 't1',
          name: 'Touchdown Tacos',
          owner_id: 'u1',
          status: 'active',
          manager_user_id: 'u1',
          autopilot: false,
          faab_balance: null,
          waiver_priority: 1,
          roster: [{ ...rosterPlayer, game_lock: { state: 'locked_until', until: '2026-10-20T07:00:00Z' } }],
        },
      ],
    })
    return qc
  }

  it('F692: locked for the week, the header offers NO Drop (and nothing else in its place)', () => {
    const out = html(createElement(ProfileLoaded, { data, target: { ...target, leagueId: 'L1' }, onClose: () => {} }), lockedInLeague())
    expect(out).not.toContain('data-profile-action="mine"')
    expect(out).not.toMatch(/>Drop</)
    expect(out).toContain('Touchdown Tacos · your team')
  })

  it('F692: the Leagues tab row of one of mine offers Drop (red words on the red tint) — none while he is locked', () => {
    const tab = (qc: QueryClient) =>
      html(
        createElement(LeaguesTab, {
          player,
          pool: { id: 'p1', full_name: 'Bijan Robinson', position: 'RB', team: 'ATL', adp: 3, headshot_url: null, status: null },
          leagues: [league],
          pending: false,
          error: false,
          onMove: () => {},
          onTrade: () => {},
        }),
        qc,
      )
    const open = tab(inLeague())
    expect(open).toMatch(/data-profile-league-action="Drop" class="[^"]*bg-m-gr text-m-tr active:bg-m-gr\/70[^"]*">Drop</)
    expect(open).not.toMatch(/data-profile-league-action="Drop" class="[^"]*text-white/)
    const locked = tab(lockedInLeague())
    expect(locked).toContain('On your team · Touchdown Tacos')
    expect(locked).not.toContain('data-profile-league-action')
  })

  it('leagues tab: his row in each league', () => {
    const qc = inLeague()
    const out = html(
      createElement(LeaguesTab, {
        player,
        pool: { id: 'p1', full_name: 'Bijan Robinson', position: 'RB', team: 'ATL', adp: 3, headshot_url: null, status: null },
        leagues: [league],
        pending: false,
        error: false,
        onMove: () => {},
        onTrade: () => {},
      }),
      qc,
    )
    expect(out).toContain('data-profile-league-row="L1"')
    expect(out).toContain('On your team · Touchdown Tacos')
    expect(out).toContain('>SF<')
  })

  it('another team’s player: the header offers Propose trade (the builder opens over the profile)', () => {
    const qc = inLeague()
    qc.setQueryData(['league-rosters', 'L1'], {
      league_id: 'L1',
      season: 2026,
      teams: [
        { team_id: 't1', name: 'Touchdown Tacos', owner_id: 'u1', status: 'active', manager_user_id: 'u1', autopilot: false, faab_balance: null, waiver_priority: 1, roster: [] },
        { team_id: 't2', name: 'Gridiron Gurus', owner_id: 'u2', status: 'active', manager_user_id: 'u2', autopilot: false, faab_balance: null, waiver_priority: 2, roster: [rosterPlayer] },
      ],
    })
    const out = html(createElement(ProfileLoaded, { data, target: { ...target, leagueId: 'L1' }, onClose: () => {} }), qc)
    expect(out).toMatch(/data-profile-action="theirs"[^>]*>Propose trade</)
  })

  it('a draft seat’s Queue: the header pill, then "In your queue" once he is in it', () => {
    // (The seat reaches the profile through the profile store, which a
    // server render cannot seed — the pill itself is checked here.)
    const qc = inLeague()
    qc.setQueryData(draftQueueKeys.queue('d1', 't1'), [])
    const props = { leagueId: 'L1', leagueName: 'Sunday Funday League', draftId: 'd1', teamId: 't1', playerId: 'p1', variant: 'header' as const }
    expect(html(createElement(QueueButton, props), qc)).toMatch(/data-profile-queue="header"[^>]*>Add to queue</)
    qc.setQueryData(draftQueueKeys.queue('d1', 't1'), [{ player_id: 'p1', rank: 1 }])
    expect(html(createElement(QueueButton, props), qc)).toMatch(/disabled=""[^>]*data-profile-queue="header"[^>]*>In your queue</)
    // No read yet: the pill waits rather than treating the queue as empty.
    expect(html(createElement(QueueButton, { ...props, draftId: 'd2' }), qc)).toMatch(/disabled=""[^>]*>Add to queue</)
  })

  describe('pressed tints (gap list §4 item 18)', () => {
    const pool = { id: 'p1', full_name: 'Bijan Robinson', position: 'RB', team: 'ATL', adp: 3, headshot_url: null, status: null }
    const theirs = () => {
      const qc = inLeague()
      qc.setQueryData(['league-rosters', 'L1'], {
        league_id: 'L1',
        season: 2026,
        teams: [
          { team_id: 't1', name: 'Touchdown Tacos', owner_id: 'u1', status: 'active', manager_user_id: 'u1', autopilot: false, faab_balance: null, waiver_priority: 1, roster: [] },
          { team_id: 't2', name: 'Gridiron Gurus', owner_id: 'u2', status: 'active', manager_user_id: 'u2', autopilot: false, faab_balance: null, waiver_priority: 2, roster: [rosterPlayer] },
        ],
      })
      return qc
    }

    it('header: Close, + List and the Drop pill tint; the tabs and the scoring chip tint behind their words', () => {
      const out = html(createElement(ProfileLoaded, { data, target: { ...target, leagueId: 'L1' }, onClose: () => {} }), inLeague())
      // ATL's red takes white text: the see-through close fill doubles when pressed.
      expect(out).toMatch(/<button[^>]*class="[^"]*bg-white\/\[\.16\][^"]*active:bg-white\/\[\.28\][^"]*"[^>]*data-profile-close/)
      // A b2 control presses to b3s — b2h would not show in phone dark mode (b2h = b2 there).
      expect(out).toMatch(/class="[^"]*bg-m-b2 [^"]*active:bg-m-b3s[^"]*"[^>]*data-profile-list/)
      expect(out).toMatch(/class="[^"]*bg-m-gr text-m-tr active:bg-m-gr\/70[^"]*"[^>]*data-profile-action="mine"/)
      for (const tab of ['summary', 'log', 'leagues', 'tx', 'team', 'history']) {
        expect(out).toMatch(new RegExp(`class="group [^"]*"[^>]*data-profile-tab="${tab}"><span class="[^"]*rounded-pill[^"]*group-active:bg-m-b2"`))
      }
      expect(out).toMatch(/data-profile-scoring="league:L1"><span class="[^"]*bg-m-b2 [^"]*group-active:bg-m-b3s"/)
    })

    it('summary: the ownership row, the section rows (not under their own buttons) and Games’ prev / next', () => {
      const out = html(createElement(ProfileLoaded, { data, target: { ...target, leagueId: 'L1' }, onClose: () => {} }), inLeague())
      expect(out).toMatch(/class="[^"]*bg-m-b1 [^"]*active:bg-m-b2h"[^>]*data-profile-ownership/)
      const heads = [...out.matchAll(/<div class="([^"]*)" data-profile-section-head/g)].map((m) => m[1]!)
      expect(heads).toHaveLength(2)
      for (const cls of heads) {
        expect(cls).toContain('active:bg-m-b2')
        // Pressing prev / next presses the row too (:active climbs): the row stays clear.
        expect(cls).toContain('has-[[data-row-own]:active]:bg-transparent')
      }
      expect([...out.matchAll(/aria-label="(Earlier|Later) weeks" class="[^"]*bg-m-b2 [^"]*active:bg-m-b3s"[^>]*data-row-own/g)]).toHaveLength(2)
    })

    it('another team’s player: Propose trade presses to the strong blue', () => {
      const out = html(createElement(ProfileLoaded, { data, target: { ...target, leagueId: 'L1' }, onClose: () => {} }), theirs())
      expect(out).toMatch(/class="[^"]*bg-accent text-white active:bg-accent-strong[^"]*"[^>]*data-profile-action="theirs"/)
    })

    it('season chips: the others tint, the chosen one does not (tapping it changes nothing)', () => {
      const out = html(
        createElement(GameLogTab, {
          player,
          season: 2026,
          year: 2026,
          onYear: () => {},
          choice: { kind: 'system', system: 'espn_standard' },
          core,
          schedule: [],
          lines,
          linesState: 'ready',
        }),
        seeded(),
      )
      expect(out).toMatch(/aria-pressed="false" class="[^"]*bg-m-b2 text-m-t1 active:bg-m-b3s"[^>]*>2025</)
      const chosen = out.match(/<button[^>]*aria-pressed="true"[^>]*>2026</)?.[0] ?? ''
      expect(chosen).toContain('bg-m-ink')
      expect(chosen).not.toContain('active:')
    })

    it('league rows: Trade, and the league filter chips', () => {
      const leagues = html(
        createElement(LeaguesTab, { player, pool, leagues: [league], pending: false, error: false, onMove: () => {}, onTrade: () => {} }),
        theirs(),
      )
      expect(leagues).toMatch(/class="[^"]*bg-accent active:bg-accent-strong[^"]*">Trade</)
      const tx = html(createElement(TransactionsTab, { playerId: 'p1', leagues: [league], pending: false, error: false }), inLeague())
      expect(tx).toMatch(/aria-pressed="true" class="[^"]*bg-m-ink text-white"[^>]*>All leagues</)
      expect(tx).toMatch(/aria-pressed="false" class="[^"]*bg-m-b2 text-m-t1 active:bg-m-b3s"[^>]*>Sunday Funday League</)
    })

    it('Add to queue: the ink thins when pressed', () => {
      const qc = inLeague()
      qc.setQueryData(draftQueueKeys.queue('d1', 't1'), [])
      const out = html(createElement(QueueButton, { leagueId: 'L1', leagueName: 'Sunday Funday League', draftId: 'd1', teamId: 't1', playerId: 'p1' }), qc)
      expect(out).toMatch(/class="[^"]*bg-m-ink text-white [^"]*active:bg-m-ink\/70[^"]*"[^>]*>Add to queue</)
    })

    it('census: every button the profile can tap tints when pressed — and none lifts', () => {
      const qc = inLeague()
      qc.setQueryData(['mobile-pprofile-depth-chart', 'ATL'], [
        { id: 'p1', full_name: 'Bijan Robinson', first_name: 'Bijan', last_name: 'Robinson', position: 'RB', birth_date: '2002-01-30', depth_chart_position: 'RB', depth_chart_order: 1 },
        { id: 'p2', full_name: 'Tyler Allgeier', first_name: 'Tyler', last_name: 'Allgeier', position: 'RB', birth_date: '2000-04-15', depth_chart_position: 'RB', depth_chart_order: 2 },
      ])
      const outs = [
        html(createElement(ProfileLoaded, { data, target: { ...target, leagueId: 'L1' }, onClose: () => {} }), qc),
        html(createElement(ProfileLoaded, { data, target: { ...target, leagueId: 'L1' }, onClose: () => {} }), theirs()),
        html(
          createElement(GameLogTab, { player, season: 2026, year: 2026, onYear: () => {}, choice: { kind: 'system', system: 'espn_standard' }, core, schedule: [], lines, linesState: 'ready' }),
          qc,
        ),
        html(createElement(LeaguesTab, { player, pool, leagues: [league], pending: false, error: false, onMove: () => {}, onTrade: () => {} }), theirs()),
        html(createElement(TransactionsTab, { playerId: 'p1', leagues: [league], pending: false, error: false }), qc),
        html(createElement(TeamTab, { player, onOpenPlayer: () => {} }), qc),
      ]
      const all = outs.flatMap(pressables)
      expect(all.length).toBeGreaterThan(20)
      expect(all.filter((b) => !b.tints).map((b) => b.tag)).toEqual([])
      for (const out of outs) expect(out).not.toMatch(/active:shadow|hover:shadow/)
    })
  })
})
