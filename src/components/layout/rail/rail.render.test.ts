/**
 * The research rail's Players + Teams tools (D483, Chris 2026-10-03, built
 * to the Claude Design prototype's ResearchRail).
 *
 *  1. The strip: one button per tool (with its tooltip label), the account
 *     zone, no panel before mount.
 *  2. Players, league-scoped: the search, the All…DEF chips, the "On
 *     rosters" switch and its right-hand label, "Adds go to <team>", and a
 *     free agent's + — the player card's own flow (`data-card-action=
 *     "acquire"`, D481), never a re-implementation.
 *  3. The switch on: league-owned players with the owner's crest + "team ·
 *     manager"; no + on them.
 *  4. No league page + no leagues: a plain research list, no switch, no +.
 *  5. The census: every player name / face the rail renders is a card door.
 *  6. Teams, league-scoped: standings order, W–L, PF, manager.
 *  7. The pure helpers.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/research',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    from: () => ({}),
    channel: () => ({ on: () => ({}), subscribe: () => ({}) }),
    removeChannel: () => {},
  }),
}))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: { leagues: true, messages: false } }))

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { AUTH_SESSION_KEY } from '@/hooks/use-auth'
import { draftPoolKeys } from '@/hooks/use-draft-pool'
import { leaguePoolKeys } from '@/hooks/use-league-pool'
import { leaguesKeys } from '@/hooks/use-leagues'
import { leagueRosterKeys } from '@/hooks/use-rosters'
import { scheduleKeys } from '@/hooks/use-schedule'
import { leagueStandingsKeys } from '@/hooks/use-standings'
import { tradeDeadlineKeys } from '@/hooks/use-trade-deadline'
import type { RosterPlayer, RosterTeam } from '@/lib/leagues/api/rosters-service'

import { LeaguePlayersList, PlayersPanel } from './players-panel'
import {
  addsGoToLine,
  leagueIdFromPath,
  ownerTooltip,
  poolSwitchLabel,
  railMetaLine,
  recordText,
  rosterGroupOf,
} from './players-panel-ops'
import { ResearchRail } from './research-rail'
import { TeamsPanel } from './teams-panel'

const LG = 'lg-1'
const ME = 'user-me'

const html = (el: ReactElement, qc = new QueryClient()) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, el))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')

const UNLOCKED = { state: 'unlocked' as const, until: null }
function rp(id: string, slot: string, over: Partial<RosterPlayer> = {}): RosterPlayer {
  return {
    player_id: id,
    full_name: `Player ${id}`,
    position: 'WR',
    nfl_team: 'AAA',
    status: 'Active',
    bye_week: null,
    slot_key: slot,
    acquisition_type: 'draft',
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: UNLOCKED,
    ...over,
  }
}
function team(id: string, name: string, roster: RosterPlayer[]): RosterTeam {
  return { team_id: id, name, owner_id: `o-${id}`, status: 'active', manager_user_id: `u-${id}`, autopilot: false, faab_balance: 40, waiver_priority: 1, roster }
}
const pp = (id: string, name: string, pos = 'WR'): PoolPlayer => ({ id, full_name: name, position: pos, team: 'KC', adp: 1, headshot_url: null, status: 'Active' })

/** A seeded league: my team "Dal Squad" (1 bench player), their team
 *  "Rivals" holding p-held; p-free is a free agent; no waivers. */
function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  qc.setQueryData(AUTH_SESSION_KEY, { user: { id: ME } })
  qc.setQueryData(leaguesKeys.detail(LG), {
    league: { id: LG, name: 'Sunday League', status: 'in_season', season: 2099 },
    settings: {
      draft: { time_zone: 'America/New_York' },
      roster_settings: { starting_slots: [{ count: 1 }], bench: 3, ir_slots: [] },
      waiver_type: 'none_fcfs',
      faab_min_bid: 0,
    },
    members: [
      { id: 'm1', user_id: ME, team_id: 'mine', role: 'manager', profiles: { username: 'chris', avatar_url: null } },
      { id: 'm2', user_id: 'u-them', team_id: 'them', role: 'manager', profiles: { username: 'rival_mgr', avatar_url: null } },
    ],
    teams: [],
    my_role: 'manager',
    active_draft: null,
    waiver_window: { waivers: false, free_agency_open: true, why: 'free_agency', next_run_at: null, last_run_at: null, last_open_at: null, time_zone: 'America/New_York', paused: false, evaluated_at: '2099-09-12T12:00:00Z' },
    waivers_live: true,
  })
  qc.setQueryData(leagueRosterKeys.all(LG), {
    league_id: LG,
    season: 2099,
    teams: [team('mine', 'Dal Squad', [rp('p-mine', 'bn')]), team('them', 'Rivals', [rp('p-held', 'wr'), rp('p-ir', 'ir'), rp('p-bn', 'bn')])],
  })
  qc.setQueryData(leaguePoolKeys.all(LG), [])
  qc.setQueryData(tradeDeadlineKeys.all(LG), { state: 'unknown' })
  qc.setQueryData(scheduleKeys.all(LG), { weeks: [] })
  qc.setQueryData(draftPoolKeys.pool('', ''), [pp('p-free', 'Free Agent Fred'), pp('p-held', 'Held Harry'), pp('p-mine', 'Mine Mike')])
  qc.setQueryData(leaguesKeys.all, [])
  qc.setQueryData(leagueStandingsKeys.all(LG), {
    standings: [
      { rank: 1, team_id: 'them', name: 'Rivals', wins: 3, losses: 1, ties: 0, points_for: 456.7 },
      { rank: 2, team_id: 'mine', name: 'Dal Squad', wins: 1, losses: 3, ties: 0, points_for: 401.2 },
    ],
  })
  return qc
}

// ---------------------------------------------------------------------------
// 1. The strip
// ---------------------------------------------------------------------------

describe('ResearchRail — the strip', () => {
  it('one button per tool, the account zone, and no panel before mount', () => {
    const out = html(createElement(ResearchRail), seeded())
    for (const id of ['notifications', 'teams', 'players']) expect(out).toContain(`data-rail-tool="${id}"`)
    expect(out).not.toContain('data-rail-tool="messages"') // flagged off
    expect(out).toMatch(/aria-label="Players"/)
    expect(out).toContain('data-rail-account="closed"')
    expect(out).not.toContain('Players panel')
    // A pinned overlay: the strip's border is at rest, never a hard shadow.
    expect(out).not.toMatch(/shadow-hard/)
  })
})

// ---------------------------------------------------------------------------
// 2–3. Players, league-scoped
// ---------------------------------------------------------------------------

describe('PlayersPanel — on a league page', () => {
  const leaguePath = `/app/leagues/${LG}/team/mine`

  it('header: search, All…DEF chips, the switch with "Free agents", and "Adds go to <team>"', () => {
    const out = html(createElement(PlayersPanel, { onClose: () => {}, pathname: leaguePath }), seeded())
    expect(out).toContain('placeholder="Search players…"')
    for (const chip of ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF']) expect(out).toContain(`>${chip}</button>`)
    expect(out).toMatch(/data-rail-switch[^>]*aria-checked="false"|aria-checked="false"[^>]*data-rail-switch/)
    expect(out).toMatch(/data-rail-switch-label="true">Free agents</)
    expect(out).toMatch(/data-rail-adds-to="true">Adds go to Dal Squad</)
    // No league picker on a league page — it is scoped to that league.
    expect(out).not.toContain('data-rail-league-pick')
  })

  it('a free agent row carries the card’s own + (D481), and only free agents do', () => {
    const out = html(createElement(PlayersPanel, { onClose: () => {}, pathname: leaguePath }), seeded())
    expect(out).toContain('data-rail-row="p-free"')
    expect(out).not.toContain('data-rail-row="p-held"') // owned → not in the FA list
    expect(out).not.toContain('data-rail-row="p-mine"')
    const row = out.slice(out.indexOf('data-rail-row="p-free"'))
    expect(row).toMatch(/data-card-action="acquire" data-acquire="add"/)
    expect(row).toContain('aria-label="Add Free Agent Fred"')
    // The step is not open until the + is pressed (confirm first).
    expect(out).not.toContain('data-card-acquire-choice')
    // F565: no invented rostered-% / FAAB average.
    expect(out).not.toMatch(/rostered|% avg|FAAB avg/i)
  })

  it('the meta line never invents a number: no values → just the NFL team', () => {
    const out = html(createElement(PlayersPanel, { onClose: () => {}, pathname: leaguePath }), seeded())
    expect(out).toMatch(/data-rail-meta="true">KC</)
  })
})

describe('LeaguePlayersList — the switch on (league-owned)', () => {
  it('owned rows show the owner crest with "team · manager", and no +', () => {
    const out = html(createElement(LeaguePlayersList, { leagueId: LG, query: '', position: null, onRosters: true }), seeded())
    expect(out).toContain('data-rail-row="p-held"')
    expect(out).toContain('data-rail-row="p-mine"')
    expect(out).not.toContain('data-rail-row="p-free"')
    expect(out).toContain('aria-label="Rivals · rival_mgr"')
    expect(out).not.toContain('data-card-action="acquire"')
  })
})

// ---------------------------------------------------------------------------
// 4. No league
// ---------------------------------------------------------------------------

describe('PlayersPanel — off a league page with no leagues', () => {
  it('a plain research list: no picker, no switch, no "Adds go to", no +', () => {
    const qc = seeded()
    qc.setQueryData(['rail-players', '', null], [pp('r1', 'Research Rob')])
    const out = html(createElement(PlayersPanel, { onClose: () => {}, pathname: '/app/lists' }), qc)
    expect(out).toContain('data-rail-row="r1"')
    expect(out).not.toContain('data-rail-league-pick')
    expect(out).not.toContain('data-rail-switch')
    expect(out).not.toContain('data-rail-adds-to')
    expect(out).not.toContain('data-card-action="acquire"')
  })

  it('with leagues: a picker of your leagues, scoped to the first', () => {
    const qc = seeded()
    qc.setQueryData(leaguesKeys.all, [{ id: LG, name: 'Sunday League', avatar_url: null, season: 2099, status: 'in_season', team_count: 2, created_at: null, my_role: 'manager', my_team_id: 'mine' }])
    const out = html(createElement(PlayersPanel, { onClose: () => {}, pathname: '/app' }), qc)
    expect(out).toContain('data-rail-league-pick')
    expect(out).toContain('>Sunday League</option>')
    expect(out).toMatch(/Adds go to Dal Squad/)
  })
})

// ---------------------------------------------------------------------------
// 5. Census — every rail player name / face opens the card
// ---------------------------------------------------------------------------

describe('census: every player the rail renders is a card door', () => {
  const surfaces: Array<[string, () => string]> = [
    ['players · free agents', () => html(createElement(PlayersPanel, { onClose: () => {}, pathname: `/app/leagues/${LG}` }), seeded())],
    [
      'players · on rosters',
      () => {
        return html(createElement(LeaguePlayersList, { leagueId: LG, query: '', position: null, onRosters: true }), seeded())
      },
    ],
    [
      'players · research',
      () => {
        const qc = seeded()
        qc.setQueryData(['rail-players', '', null], [pp('r1', 'Research Rob'), pp('r2', 'Research Ray')])
        return html(createElement(PlayersPanel, { onClose: () => {}, pathname: '/app/lists' }), qc)
      },
    ],
  ]
  for (const [label, render] of surfaces) {
    it(`${label}: each row's name and headshot are doors to his card`, () => {
      const out = render()
      const rows = [...out.matchAll(/data-rail-row="([^"]+)"/g)].map((m) => m[1])
      expect(rows.length).toBeGreaterThan(0)
      for (const id of rows) {
        expect(out, `${id} name`).toContain(`data-player-link="${id}"`)
        expect(out, `${id} face`).toContain(`data-player-face="${id}"`)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// 6. Teams, league-scoped
// ---------------------------------------------------------------------------

describe('TeamsPanel — on a league page', () => {
  it('standings order with rank, team, manager, W–L and PF', () => {
    const out = html(createElement(TeamsPanel, { onClose: () => {}, pathname: `/app/leagues/${LG}/standings` }), seeded())
    const a = out.indexOf('data-rail-team="them"')
    const b = out.indexOf('data-rail-team="mine"')
    expect(a).toBeGreaterThan(-1)
    expect(b).toBeGreaterThan(a)
    expect(out).toContain('rival_mgr')
    expect(out).toContain('3–1')
    expect(out).toContain('456.7 PF')
  })
})

// ---------------------------------------------------------------------------
// 7. Pure helpers
// ---------------------------------------------------------------------------

describe('players-panel-ops', () => {
  it('leagueIdFromPath scopes to the league page, not the index / new / join', () => {
    expect(leagueIdFromPath('/app/leagues/abc/team/t1')).toBe('abc')
    expect(leagueIdFromPath('/app/leagues/abc')).toBe('abc')
    expect(leagueIdFromPath('/app/leagues')).toBeNull()
    expect(leagueIdFromPath('/app/leagues/new')).toBeNull()
    expect(leagueIdFromPath('/app/lists/x')).toBeNull()
    expect(leagueIdFromPath(null)).toBeNull()
  })
  it('switch label, adds line, owner tooltip, record', () => {
    expect(poolSwitchLabel(false)).toBe('Free agents')
    expect(poolSwitchLabel(true)).toBe('League-owned players')
    expect(addsGoToLine('Dal Squad')).toBe('Adds go to Dal Squad')
    expect(addsGoToLine(null)).toBeNull()
    expect(ownerTooltip('Rivals', 'rival_mgr')).toBe('Rivals · rival_mgr')
    expect(ownerTooltip('Rivals', null)).toBe('Rivals · no manager')
    expect(recordText(3, 1, 0)).toBe('3–1')
    expect(recordText(3, 1, 1)).toBe('3–1–1')
  })
  it('meta line: values only when present, never a 0 for a missing one', () => {
    expect(railMetaLine('KC', null)).toBe('KC')
    expect(railMetaLine('KC', { proj: 12.34, season: 45.6 })).toBe('KC · Proj 12.3 · 45.6 pts')
    expect(railMetaLine('KC', { proj: null, season: 45.6 })).toBe('KC · 45.6 pts')
    expect(railMetaLine('KC', { proj: 0, season: null })).toBe('KC · Proj 0.0')
    expect(railMetaLine(null, { proj: 8, season: 1 }, { season: false })).toBe('FA · Proj 8.0')
  })
  it('roster groups: ir → Injured, bn / none → Bench, any other slot → Starters', () => {
    expect(rosterGroupOf('ir')).toBe('Injured')
    expect(rosterGroupOf('bn')).toBe('Bench')
    expect(rosterGroupOf(null)).toBe('Bench')
    expect(rosterGroupOf('flex')).toBe('Starters')
  })
})
