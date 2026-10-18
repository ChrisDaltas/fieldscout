/**
 * League Menu › Draft results on the phone (gap list §3 #15; handoff
 * m-community G3): round chips over that round's picks, your own picks'
 * team name in blue — and By team, the desktop recap's rosters (yours first;
 * an auction's spend). The pure rows/rounds/teams/address helpers, then the screen
 * rendered from seeded queries (`renderToStaticMarkup`; effects don't run) —
 * the same reads as the desktop recap (`useCompletedRealDraft` → `useDraft`
 * → `usePlayersByIds`).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { draftKeys, type DraftPickSummary, type DraftState } from '@/hooks/use-draft'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import type { PlayerIdentity } from '@/hooks/use-players-by-ids'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import type { Draft } from '@/types/database'

import {
  AUCTION_LINE,
  EMPTY_ROUND_COPY,
  EMPTY_TEAM_COPY,
  MOCK_LINE,
  NO_RESULTS_COPY,
  draftResultRows,
  draftResultTeams,
  draftRoundCount,
  draftTeamSpend,
  resultsSearch,
  roundFromParam,
  rowsForTeam,
  rowsInRound,
  teamFromParam,
} from './draft-results-ops'
import { MobileDraftResults } from './draft-results-screen'

const search = { value: '' }
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app/leagues/league-1/draft/recap',
  useSearchParams: () => new URLSearchParams(search.value),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-me' }, profile: { username: 'dalton' }, isLoading: false }),
}))

const LEAGUE = 'league-1'
const DRAFT = 'draft-1'
const ME = 'team-me'
const T2 = 'team-2'
const T3 = 'team-3'

function pick(n: number, teamId: string, playerId: string, over: Partial<DraftPickSummary> = {}): DraftPickSummary {
  return {
    id: `p${n}`,
    pick_number: n,
    round: Math.floor((n - 1) / 3) + 1,
    team_id: teamId,
    player_id: playerId,
    is_auto: false,
    is_undone: false,
    price: null,
    made_via: 'manager',
    created_at: null,
    ...over,
  }
}

// A finished 3-team snake, 3 rounds stored, 2 drafted (round 3 never ran),
// with an undone pick at 2 that was re-made.
const PICKS: DraftPickSummary[] = [
  pick(1, T2, 'pl-1'),
  pick(2, ME, 'pl-x', { is_undone: true }),
  pick(2, ME, 'pl-2', { is_auto: true }),
  pick(3, T3, 'pl-3'),
  pick(4, T3, 'pl-4'),
  pick(5, ME, 'pl-5'),
  pick(6, T2, 'pl-6'),
]

const PLAYERS: PlayerIdentity[] = [
  { id: 'pl-1', full_name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', headshot_url: null, status: null },
  { id: 'pl-2', full_name: 'Bijan Robinson', position: 'RB', team: 'ATL', headshot_url: null, status: null },
  { id: 'pl-3', full_name: 'Josh Allen', position: 'QB', team: 'BUF', headshot_url: null, status: null },
  { id: 'pl-4', full_name: 'Brock Bowers', position: 'TE', team: 'LV', headshot_url: null, status: null },
  { id: 'pl-5', full_name: 'Bears D/ST', position: 'DEF', team: 'CHI', headshot_url: null, status: null },
  { id: 'pl-6', full_name: 'Free Agent Guy', position: 'WR', team: null, headshot_url: null, status: null },
]

function draftRow(over: Partial<Draft> = {}): Draft {
  return {
    budget_adjustments: {},
    completed_at: '2099-08-30T02:00:00Z',
    config: {},
    created_at: null,
    current_deadline: null,
    current_nomination: null,
    current_pick_number: null,
    current_round: null,
    deadline_remaining_ms: null,
    draft_order: [T2, ME, T3],
    draft_type: 'snake',
    id: DRAFT,
    is_mock: false,
    league_id: LEAGUE,
    nomination_order: null,
    on_clock_team_id: null,
    paused_at: null,
    started_at: null,
    status: 'complete',
    total_rounds: 3,
    updated_at: null,
    ...over,
  }
}

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
    max_teams: 3,
    created_at: null,
    updated_at: null,
    champion_team_id: null,
  },
  settings: defaultsForTeamCount(8),
  members: [
    { id: 'm1', user_id: 'user-me', team_id: ME, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dalton', avatar_url: null } },
  ],
  teams: [
    { id: T2, name: 'Gridiron Gurus', owner_id: 'user-2', status: 'active', created_at: '2099-01-01T00:00:00Z' },
    { id: ME, name: 'Touchdown Tacos', owner_id: 'user-me', status: 'active', created_at: '2099-01-02T00:00:00Z' },
    { id: T3, name: 'Waiver Wire Warriors', owner_id: 'user-3', status: 'active', created_at: '2099-01-03T00:00:00Z' },
  ],
  my_role: 'manager',
  active_draft: null,
}

const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

interface Seed {
  completed?: { id: string } | null | 'error'
  room?: DraftState | 'error'
  players?: PlayerIdentity[]
}

function render(seed: Seed, draftIdParam?: string): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)
  if (seed.completed === 'error') {
    const query = qc.getQueryCache().build(qc, { queryKey: ['completed-real-draft', LEAGUE] })
    query.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle', data: undefined, dataUpdatedAt: 0 })
  } else if (seed.completed !== undefined) qc.setQueryData(['completed-real-draft', LEAGUE], seed.completed)
  const id = draftIdParam ?? (seed.completed && seed.completed !== 'error' ? seed.completed.id : null)
  if (id && seed.room === 'error') {
    const query = qc.getQueryCache().build(qc, { queryKey: draftKeys.detail(id) })
    query.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle', data: undefined, dataUpdatedAt: 0 })
  } else if (id && seed.room) qc.setQueryData(draftKeys.detail(id), seed.room)
  if (seed.room && seed.room !== 'error') {
    const ids = [...new Set(seed.room.picks.filter((p) => !p.is_undone).map((p) => p.player_id))].sort()
    qc.setQueryData(['players-by-ids', ids], seed.players ?? PLAYERS)
  }
  return unescape(
    renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileDraftResults, { leagueId: LEAGUE, draftIdParam }))),
  )
}

const finished = (over: Partial<Draft> = {}, picks = PICKS): Seed => ({ completed: { id: DRAFT }, room: { draft: draftRow(over), picks } })

/** The pick rows, in order, as [label, name, owner]. */
function rowsOf(html: string): Array<[string, string, string]> {
  return [...html.matchAll(/data-draft-pick="\d+"[^>]*>(.*?)<\/button>/g)].map((m) => {
    const texts = [...m[1].matchAll(/>([^<>]+)</g)].map((t) => t[1].trim()).filter(Boolean)
    const name = /text-\[14px\] font-semibold text-m-t1">([^<]+)</.exec(m[1])?.[1] ?? ''
    return [texts[0], name, texts[texts.length - 1]] as [string, string, string]
  })
}

beforeEach(() => {
  search.value = ''
})

describe('draftResultRows — the desktop recap’s rows, in the phone’s shape', () => {
  it('labels a snake pick "round.slot", skips undone picks and marks your own', () => {
    const rows = draftResultRows(PICKS, { auction: false, teamCount: 3, myTeamId: ME })
    expect(rows.map((r) => [r.label, r.playerId, r.mine])).toEqual([
      ['1.01', 'pl-1', false],
      ['1.02', 'pl-2', true],
      ['1.03', 'pl-3', false],
      ['2.01', 'pl-4', false],
      ['2.02', 'pl-5', true],
      ['2.03', 'pl-6', false],
    ])
    expect(rows.find((r) => r.playerId === 'pl-2')?.auto).toBe(true)
  })

  it('marks nothing yours for a viewer with no team', () => {
    expect(draftResultRows(PICKS, { auction: false, teamCount: 3, myTeamId: null }).some((r) => r.mine)).toBe(false)
  })

  it('an auction has no rounds: every buy in nomination order, labelled with its price', () => {
    const buys = [pick(2, ME, 'pl-2', { price: 45, round: null }), pick(1, T2, 'pl-1', { price: 61, round: null }), pick(3, T3, 'pl-3', { price: null, round: null })]
    expect(draftResultRows(buys, { auction: true, teamCount: 3, myTeamId: ME }).map((r) => [r.label, r.round, r.mine])).toEqual([
      ['$61', null, false],
      ['$45', null, true],
      ['$0', null, false],
    ])
  })
})

describe('the round chips and the address', () => {
  const rows = draftResultRows(PICKS, { auction: false, teamCount: 3, myTeamId: ME })

  it('draws the draft’s own rounds — more if a pick landed past them, at least one', () => {
    expect(draftRoundCount(3, rows)).toBe(3)
    expect(draftRoundCount(1, rows)).toBe(2)
    expect(draftRoundCount(null, rows)).toBe(2)
    expect(draftRoundCount(null, [])).toBe(1)
  })

  it('splits the rows by round', () => {
    expect(rowsInRound(rows, 2).map((r) => r.label)).toEqual(['2.01', '2.02', '2.03'])
    expect(rowsInRound(rows, 3)).toEqual([])
  })

  it('reads ?round= within the draft’s rounds, else Round 1', () => {
    expect(roundFromParam('2', 3)).toBe(2)
    expect(roundFromParam('9', 3)).toBe(3)
    expect(roundFromParam('0', 3)).toBe(1)
    expect(roundFromParam('two', 3)).toBe(1)
    expect(roundFromParam(null, 3)).toBe(1)
  })

  it('writes the round into the address, keeping ?draft= — Round 1 is the bare address', () => {
    expect(resultsSearch('', { round: 3, team: null })).toBe('?round=3')
    expect(resultsSearch('?draft=d1', { round: 2, team: null })).toBe('?draft=d1&round=2')
    expect(resultsSearch('?draft=d1&round=2', { round: 1, team: null })).toBe('?draft=d1')
    expect(resultsSearch('?round=4', { round: 1, team: null })).toBe('')
  })

  it('writes the team while By team is open, and drops it for By round', () => {
    expect(resultsSearch('?draft=d1', { round: 1, team: T2 })).toBe(`?draft=d1&team=${T2}`)
    expect(resultsSearch('', { round: 2, team: ME })).toBe(`?round=2&team=${ME}`)
    expect(resultsSearch(`?round=2&team=${ME}`, { round: 2, team: null })).toBe('?round=2')
  })
})

describe('By team — the desktop recap’s rosters on the phone', () => {
  const rows = draftResultRows(PICKS, { auction: false, teamCount: 3, myTeamId: ME })

  it('orders the teams yours first, then the draft order, then any team only in the picks', () => {
    expect(draftResultTeams([T2, ME, T3], PICKS, ME)).toEqual([ME, T2, T3])
    expect(draftResultTeams([T2, ME, T3], PICKS, null)).toEqual([T2, ME, T3])
    expect(draftResultTeams([T2], PICKS, null)).toEqual([T2, ME, T3])
  })

  it('splits the rows by team, in pick order, without undone picks', () => {
    expect(rowsForTeam(rows, ME).map((r) => [r.label, r.playerId])).toEqual([
      ['1.02', 'pl-2'],
      ['2.02', 'pl-5'],
    ])
  })

  it('reads ?team= when it is one of the draft’s teams, else the first chip', () => {
    const teams = [ME, T2, T3]
    expect(teamFromParam(T3, teams)).toBe(T3)
    expect(teamFromParam('team-elsewhere', teams)).toBe(ME)
    expect(teamFromParam(null, teams)).toBe(ME)
    expect(teamFromParam(T3, [])).toBeNull()
  })

  it('an auction team’s spend: the live total and the biggest buy (ties to the earlier nomination)', () => {
    const buys = [
      pick(1, ME, 'pl-1', { price: 30, round: null }),
      pick(2, ME, 'pl-x', { price: 90, round: null, is_undone: true }),
      pick(3, ME, 'pl-3', { price: 41, round: null }),
      pick(4, T2, 'pl-4', { price: 70, round: null }),
      pick(5, ME, 'pl-5', { price: 41, round: null }),
    ]
    const spend = draftTeamSpend(buys, ME)
    expect(spend.total).toBe(112)
    expect(spend.biggest?.player_id).toBe('pl-3')
    expect(draftTeamSpend(buys, T3)).toEqual({ total: 0, biggest: null })
  })
})

describe('the Draft results screen', () => {
  it('draws the handoff’s page: blue Back, "Draft results", the round chips with Round 1 on', () => {
    const html = render(finished())
    expect(html).toMatch(/<button[^>]*aria-label="Back"[^>]*class="[^"]*text-accent[^"]*"[^>]*data-draft-results-back/)
    expect(html).toContain('>Draft results</h1>')
    const chips = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>Round (\d+)<\/button>/g)].map((m) => [m[2], m[1]])
    expect(chips).toEqual([
      ['1', 'true'],
      ['2', 'false'],
      ['3', 'false'],
    ])
    // On: white on ink; off: t1 on b2.
    expect(html).toMatch(/aria-pressed="true" class="[^"]*bg-m-ink text-white[^"]*">Round 1</)
    expect(html).toMatch(/aria-pressed="false" class="[^"]*bg-m-b2 text-m-t1[^"]*">Round 2</)
  })

  it('lists Round 1’s picks with the pick, the player and the team — yours in blue', () => {
    const html = render(finished())
    expect(rowsOf(html)).toEqual([
      ['1.01', 'Jahmyr Gibbs', 'Gridiron Gurus'],
      ['1.02', 'Bijan Robinson', 'Touchdown Tacos'],
      ['1.03', 'Josh Allen', 'Waiver Wire Warriors'],
    ])
    expect(html).toMatch(/class="[^"]*font-semibold text-accent[^"]*">Touchdown Tacos</)
    expect(html).toMatch(/class="[^"]*font-medium text-m-t3[^"]*">Gridiron Gurus</)
    expect(html).toMatch(/data-draft-pick="2"[^>]*data-mine="true"/)
    expect(html).not.toMatch(/data-draft-pick="1"[^>]*data-mine/)
    // Position · team in the position's colour; an autopick says so.
    expect(html).toMatch(/text-m-pos-rb">RB · DET</)
    expect(html).toMatch(/text-m-pos-qb">QB · BUF</)
    expect(html).toContain('> · Auto<')
    // The undone pick never shows.
    expect(html).not.toContain('pl-x')
  })

  it('opens at the round the address names', () => {
    search.value = 'round=2'
    const html = render(finished())
    expect(html).toMatch(/aria-pressed="true"[^>]*>Round 2</)
    expect(rowsOf(html)).toEqual([
      ['2.01', 'Brock Bowers', 'Waiver Wire Warriors'],
      ['2.02', 'Bears D/ST', 'Touchdown Tacos'],
      ['2.03', 'Free Agent Guy', 'Gridiron Gurus'],
    ])
    expect(html).toMatch(/text-m-pos-dst">D\/ST · CHI</)
    expect(html).toMatch(/text-m-pos-wr">WR · FA</)
  })

  it('a round with no picks says so', () => {
    search.value = 'round=3'
    const html = render(finished())
    expect(html).toMatch(/aria-pressed="true"[^>]*>Round 3</)
    expect(rowsOf(html)).toEqual([])
    expect(html).toContain(EMPTY_ROUND_COPY)
  })

  it('an auction lists every buy with its price, no round chips', () => {
    const buys = [pick(1, T2, 'pl-1', { price: 61, round: null }), pick(2, ME, 'pl-2', { price: 45, round: null }), pick(3, T3, 'pl-3', { price: 12, round: null })]
    const html = render(finished({ draft_type: 'auction', total_rounds: null }, buys))
    expect(html).not.toContain('data-draft-rounds')
    expect(html).toMatch(/aria-pressed="true"[^>]*>All buys</)
    expect(html).toContain(AUCTION_LINE)
    expect(rowsOf(html)).toEqual([
      ['$61', 'Jahmyr Gibbs', 'Gridiron Gurus'],
      ['$45', 'Bijan Robinson', 'Touchdown Tacos'],
      ['$12', 'Josh Allen', 'Waiver Wire Warriors'],
    ])
  })

  it('a By round / By team switch sits over the chips, By round on', () => {
    const html = render(finished())
    expect(html).toMatch(/aria-label="Draft results view"/)
    expect(html).toMatch(/aria-pressed="true"[^>]*>By round</)
    expect(html).toMatch(/aria-pressed="false"[^>]*>By team</)
    expect(html).not.toContain('data-draft-teams')
  })

  it('By team (?team=): team chips with yours first and in blue, then that team’s picks', () => {
    search.value = `team=${T3}`
    const html = render(finished())
    expect(html).toMatch(/aria-pressed="true"[^>]*>By team</)
    expect(html).not.toContain('data-draft-rounds')
    const chips = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"([^>]*)><span class="truncate">([^<]+)<\/span><\/button>/g)].map((m) => [m[3], m[1], /data-mine/.test(m[0])])
    expect(chips).toEqual([
      ['Touchdown Tacos', 'false', true],
      ['Gridiron Gurus', 'false', false],
      ['Waiver Wire Warriors', 'true', false],
    ])
    expect(html).toMatch(/class="[^"]*bg-m-b2 text-accent[^"]*"><span class="truncate">Touchdown Tacos</)
    // Waiver Wire Warriors' picks, without the (repeated) team name.
    const picks = [...html.matchAll(/data-draft-pick="(\d+)"/g)].map((m) => m[1])
    expect(picks).toEqual(['3', '4'])
    expect(html).toContain('>Josh Allen<')
    expect(html).toContain('>Brock Bowers<')
    expect(html).not.toMatch(/data-draft-pick="\d+"[^>]*>(?:(?!<\/button>).)*Waiver Wire Warriors/)
    expect(html).not.toContain('data-draft-spend')
  })

  it('By team opens on your team when the address names none of the draft’s', () => {
    search.value = 'team=team-elsewhere'
    const html = render(finished())
    expect(html).toMatch(/aria-pressed="true"[^>]*><span class="truncate">Touchdown Tacos</)
    expect([...html.matchAll(/data-draft-pick="(\d+)"/g)].map((m) => m[1])).toEqual(['2', '5'])
  })

  it('By team on a team with no picks says so', () => {
    search.value = `team=${T3}`
    const html = render(finished({}, PICKS.filter((p) => p.team_id !== T3)))
    expect(html).toContain(EMPTY_TEAM_COPY)
  })

  it('an auction By team shows what the team spent and its biggest buy', () => {
    search.value = `team=${ME}`
    const buys = [pick(1, T2, 'pl-1', { price: 61, round: null }), pick(2, ME, 'pl-2', { price: 45, round: null }), pick(3, ME, 'pl-3', { price: 12, round: null })]
    const html = render(finished({ draft_type: 'auction', total_rounds: null }, buys))
    expect(html).toMatch(/aria-pressed="false"[^>]*>All buys</)
    expect(html).toMatch(/aria-pressed="true"[^>]*>By team</)
    expect(html).not.toContain(AUCTION_LINE)
    const spend = /data-draft-spend="true">(.*?)<\/p>/.exec(html)?.[1].replace(/<[^>]+>/g, '')
    expect(spend).toBe('$57 spent · biggest buy Bijan Robinson $45')
    expect([...html.matchAll(/data-draft-pick="(\d+)"/g)].map((m) => m[1])).toEqual(['2', '3'])
    expect(html).toMatch(/data-draft-pick="2"[^>]*>.*?>\$45</)
  })

  it('no finished draft yet (or one still running): one plain note', () => {
    expect(render({ completed: null })).toContain(NO_RESULTS_COPY)
    const live = render(finished({ status: 'live' }))
    expect(live).toContain(NO_RESULTS_COPY)
    expect(live).not.toContain('data-draft-pick')
    // Another league's draft by id is the same note — nothing leaks.
    expect(render({ room: { draft: draftRow({ league_id: 'other' }), picks: PICKS } }, DRAFT)).toContain(NO_RESULTS_COPY)
  })

  it('a practice draft opened by id says it is practice; the played seat is "yours"', () => {
    const html = render({ room: { draft: draftRow({ is_mock: true, config: { mock: { human_team_id: T3, launched_by: 'user-3' } } }), picks: PICKS } }, DRAFT)
    expect(html).toContain(MOCK_LINE)
    expect(html).toMatch(/class="[^"]*font-semibold text-accent[^"]*">Waiver Wire Warriors</)
    expect(html).toMatch(/class="[^"]*font-medium text-m-t3[^"]*">Touchdown Tacos</)
  })

  it('a failed read says so, with Try again — never the empty note', () => {
    const lookup = render({ completed: 'error' })
    expect(lookup).toContain('Couldn’t load the draft results.')
    expect(lookup).toContain('>Try again<')
    expect(lookup).not.toContain(NO_RESULTS_COPY)
    const picks = render({ completed: { id: DRAFT }, room: 'error' })
    expect(picks).toContain('Couldn’t load the draft results.')
    expect(picks).not.toContain(NO_RESULTS_COPY)
  })

  it('loads with skeleton chips and rows', () => {
    const html = render({})
    expect(html).toContain('data-draft-results="loading"')
    expect(html).toContain('aria-busy="true"')
  })
})
