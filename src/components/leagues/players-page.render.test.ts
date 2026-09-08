/**
 * players-page.render.test.ts — the players / free agents page over REAL
 * static renders: §12.19's pool states, the 🔒 from the VIEW, the add/drop
 * flow's surfaces (the refusal VERBATIM, the readout), the honest waiver /
 * trade absences, the §16.5.4 states (M4 task L.D5.4; PROGRESS D324,
 * F227(f), F251(b)).
 *
 * The `team-page.render.test.ts` rig: `renderToStaticMarkup` over the actual
 * components with the React Query cache pre-seeded; `useAuth` mocked at the
 * module edge; `useLeagueChannel` a spy. `MovePanel` and `PoolTable` are
 * rendered directly for the states a static render cannot click into.
 *
 * Probes: (1) render the 🔒 from a kickoff compared with a clock → the
 * locked cells (a player whose row is `unlocked` but whose game "started"
 * must show no lock); (2) re-word the refusal → the verbatim cell; (3) mount
 * an Add button on a waivers row → the honest-absence cell.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { draftPoolKeys } from '@/hooks/use-draft-pool'
import { useLeagueChannel } from '@/hooks/use-league-channel'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguePoolKeys, type PoolRow } from '@/hooks/use-league-pool'
import { leaguesKeys } from '@/hooks/use-leagues'
import { leagueRosterKeys } from '@/hooks/use-rosters'
import type { AddDropResult } from '@/hooks/use-transactions'
import type { LeagueRosters, RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { MovePanel, PlayersPage, PoolTable } from './players-page'
import {
  LOCKED_ADD_TITLE,
  LOCKED_DROP_TITLE,
  NO_FREE_AGENTS_COPY,
  NO_MATCH_COPY,
  NO_SEAT_COPY,
  WAIVERS_ADD_TITLE,
  poolRows,
} from './players-page-ops'
import { STALE_LEAGUE_COPY } from './status-banners'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-manager' }, profile: { username: 'chris' } }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

const LEAGUE = 'league-1'
const MINE = 'team-mine'
const OTHER = 'team-other'

const detail: LeagueDetail = {
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
  settings: defaultsForTeamCount(8),
  members: [
    { id: 'm1', user_id: 'user-manager', team_id: MINE, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
    { id: 'm2', user_id: 'user-commish', team_id: OTHER, role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
  ],
  teams: [
    { id: MINE, name: 'My Team', owner_id: 'user-manager', status: 'active', created_at: null },
    { id: OTHER, name: 'Their Team', owner_id: 'user-commish', status: 'active', created_at: null },
  ],
  my_role: 'manager',
  active_draft: null,
}

function rp(over: Partial<RosterPlayer> & Pick<RosterPlayer, 'player_id' | 'full_name'>): RosterPlayer {
  return {
    position: 'WR',
    nfl_team: 'AAA',
    status: 'Active',
    bye_week: null,
    slot_key: 'bn',
    acquisition_type: null,
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: { state: 'unlocked', until: null },
    ...over,
  }
}
const rosters: LeagueRosters = {
  league_id: LEAGUE,
  season: 2099,
  teams: [
    { team_id: MINE, name: 'My Team', owner_id: 'user-manager', status: 'active', manager_user_id: 'user-manager', roster: [rp({ player_id: 'mine-open', full_name: 'Mine Open' }), rp({ player_id: 'mine-locked', full_name: 'Mine Locked', game_lock: { state: 'locked_release_unrecorded', until: null } })] },
    { team_id: OTHER, name: 'Their Team', owner_id: 'user-commish', status: 'active', manager_user_id: 'user-commish', roster: [rp({ player_id: 'theirs', full_name: 'Theirs' })] },
  ],
}
const pool: PoolRow[] = [
  { player_id: 'fa-open', state: 'free_agent', waivers_until: null, game_lock: { state: 'unlocked', until: null } },
  // Probe (1): the ROW is unlocked; a kickoff literal in the past on the
  // player would tempt a clock comparison — there is none to make.
  { player_id: 'fa-locked', state: 'locked_in_game', waivers_until: null, game_lock: { state: 'locked_until', until: '2099-09-15T04:00:00.000Z' } },
  { player_id: 'fa-waivers', state: 'on_waivers', waivers_until: '2099-09-12T17:00:00.000Z', game_lock: { state: 'unlocked', until: null } },
]
function pp(id: string, name: string, position = 'WR'): PoolPlayer {
  return { id, full_name: name, position, team: 'AAA', adp: null, headshot_url: null, status: 'Active' }
}
const players: PoolPlayer[] = [pp('fa-open', 'Free Open'), pp('fa-locked', 'Free Locked', 'RB'), pp('fa-waivers', 'Free Waivers'), pp('fa-norow', 'Free NoRow', 'TE'), pp('mine-open', 'Mine Open'), pp('mine-locked', 'Mine Locked'), pp('theirs', 'Theirs')]

function failQuery(client: QueryClient, queryKey: readonly unknown[], error: Error, data?: unknown) {
  const query = client.getQueryCache().build(client, { queryKey })
  if (data !== undefined) query.setData(data)
  query.setState({ status: 'error', error, fetchStatus: 'idle' })
}
function unescapeHtml(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}
function render(qc: QueryClient, element: React.ReactElement): string {
  return unescapeHtml(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element)))
}

interface Seed {
  detail?: LeagueDetail
  rosters?: LeagueRosters | 'error' | 'missing'
  pool?: PoolRow[] | 'error' | 'degraded'
  players?: PoolPlayer[] | 'error'
  connection?: 'live' | 'reconnecting'
}

function renderPage(seed: Seed = {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leaguesKeys.detail(LEAGUE), seed.detail ?? detail)
  const r = seed.rosters ?? rosters
  if (r === 'error') failQuery(qc, leagueRosterKeys.all(LEAGUE), new Error('rosters: boom'))
  else if (r !== 'missing') qc.setQueryData(leagueRosterKeys.all(LEAGUE), r)
  const p = seed.pool ?? pool
  if (p === 'error') failQuery(qc, leaguePoolKeys.all(LEAGUE), new Error('pool: boom'))
  else if (p === 'degraded') failQuery(qc, leaguePoolKeys.all(LEAGUE), new Error('pool: refetch boom'), pool)
  else qc.setQueryData(leaguePoolKeys.all(LEAGUE), p)
  const ps = seed.players ?? players
  if (ps === 'error') failQuery(qc, draftPoolKeys.pool('', ''), new Error('players: boom'))
  else qc.setQueryData(draftPoolKeys.pool('', ''), ps)
  vi.mocked(useLeagueChannel).mockReturnValue({ connection: seed.connection ?? 'live' })
  return render(qc, createElement(PlayersPage, { leagueId: LEAGUE }))
}

const rowsAll = poolRows(players, rosters, pool, MINE, 'all')
const rowOf = (id: string) => rowsAll.find((r) => r.player.id === id)!

// ---------------------------------------------------------------------------
// The page — the default scope is the free agents
// ---------------------------------------------------------------------------

describe('the page opens on the free agents: §12.19’s states per row, the 🔒 from the view, the honest absences', () => {
  it('free agents only; a rostered player (mine or theirs) is not in the default scope', () => {
    const html = renderPage()
    expect(html).toContain('data-pool-table')
    for (const id of ['fa-open', 'fa-locked', 'fa-waivers', 'fa-norow']) expect(html).toContain(`data-pool-row="${id}"`)
    expect(html).not.toContain('data-pool-row="mine-open"')
    expect(html).not.toContain('data-pool-row="theirs"')
  })
  it('an unlocked free agent — with a pool row or with NONE (lazy) — has a live Add', () => {
    const html = renderPage()
    for (const id of ['fa-open', 'fa-norow']) {
      const row = html.slice(html.indexOf(`data-pool-row="${id}"`), html.indexOf('</tr>', html.indexOf(`data-pool-row="${id}"`)))
      expect(row).toContain('data-availability="free_agent"')
      expect(row).not.toContain('data-locked')
      expect(row).toContain('data-action="add"')
      expect(row).not.toMatch(/data-action="add"[^>]*disabled/)
    }
  })
  it('a locked free agent (the tick’s `locked_in_game` row) shows 🔒 and a DISABLED Add with the reason — never a clock comparison', () => {
    const html = renderPage()
    const row = html.slice(html.indexOf('data-pool-row="fa-locked"'), html.indexOf('</tr>', html.indexOf('data-pool-row="fa-locked"')))
    expect(row).toContain('data-locked="true"')
    expect(row).toContain('🔒 locked')
    expect(row).toMatch(/disabled=""[^>]*title="[^"]*game has started/)
    expect(row).toContain(LOCKED_ADD_TITLE)
  })
  it('a player on waivers says until WHEN he clears and that claims arrive in a later update — no claim button', () => {
    const html = renderPage()
    const row = html.slice(html.indexOf('data-pool-row="fa-waivers"'), html.indexOf('</tr>', html.indexOf('data-pool-row="fa-waivers"')))
    expect(row).toContain('data-availability="on_waivers"')
    expect(row).toContain('On waivers')
    expect(row).toMatch(/until /)
    expect(row).toContain(WAIVERS_ADD_TITLE)
    expect(row).toMatch(/disabled=""/)
    expect(html).not.toMatch(/>Claim</)
  })
  it('the roster-move panel is idle with the STORED fill ("2 of 17" — the 8-team default roster), and no ledger code reaches the screen', () => {
    const html = renderPage()
    expect(html).toContain('data-move-panel="idle"')
    expect(html).toMatch(/Your roster: <span class="fs-num">2<\/span> of <span class="fs-num">17<\/span>/)
    expect(html.replace(/data-[a-z-]+="[^"]*"/g, '')).not.toMatch(/\b[QEF]\d+\b/)
  })
  it('a viewer without a franchise browses but cannot move — no Move column, the honest banner', () => {
    const noSeat = { ...detail, members: detail.members.map((m) => (m.user_id === 'user-manager' ? { ...m, team_id: null } : m)) }
    const html = renderPage({ detail: noSeat })
    expect(html).toContain(NO_SEAT_COPY)
    expect(html).not.toContain('data-action="add"')
    expect(html).not.toContain('data-move-panel')
  })
})

describe('PoolTable — the rostered scope: Drop for mine (disabled by the view’s lock), nothing for theirs', () => {
  const rostered = poolRows(players, rosters, pool, MINE, 'rostered')
  const html = unescapeHtml(
    renderToStaticMarkup(createElement(PoolTable, { rows: rostered, scope: 'rostered', hadSearch: false, canAct: true, intent: { add: null, drop: null }, leagueTimeZone: null, onAdd: () => {}, onDrop: () => {} })),
  )
  it('mine, unlocked → Drop; mine, locked → Drop disabled with the reason; theirs → a dash that names trades as later', () => {
    const open = html.slice(html.indexOf('data-pool-row="mine-open"'), html.indexOf('</tr>', html.indexOf('data-pool-row="mine-open"')))
    expect(open).toContain('data-action="drop"')
    expect(open).not.toMatch(/data-action="drop"[^>]*disabled/)
    expect(open).toContain('Your team')
    const locked = html.slice(html.indexOf('data-pool-row="mine-locked"'), html.indexOf('</tr>', html.indexOf('data-pool-row="mine-locked"')))
    expect(locked).toContain('🔒 locked')
    expect(locked).toContain(LOCKED_DROP_TITLE)
    expect(locked).toMatch(/disabled=""/)
    const theirs = html.slice(html.indexOf('data-pool-row="theirs"'), html.indexOf('</tr>', html.indexOf('data-pool-row="theirs"')))
    expect(theirs).toContain('Their Team')
    expect(theirs).not.toContain('data-action=')
    expect(theirs).toContain('trades arrive in a later update')
  })
  it('empty by reason: no free agents vs no match', () => {
    const none = (scope: 'free_agents' | 'rostered', hadSearch: boolean) =>
      unescapeHtml(renderToStaticMarkup(createElement(PoolTable, { rows: [], scope, hadSearch, canAct: true, intent: { add: null, drop: null }, leagueTimeZone: null, onAdd: () => {}, onDrop: () => {} })))
    expect(none('free_agents', false)).toContain(NO_FREE_AGENTS_COPY)
    expect(none('free_agents', true)).toContain(NO_MATCH_COPY)
  })
})

// ---------------------------------------------------------------------------
// MovePanel — the refusal VERBATIM, the readout, the armed form
// ---------------------------------------------------------------------------

describe('MovePanel — the server’s answer as it came back', () => {
  const myRoster = rosters.teams[0].roster
  const base = { myRoster, fill: { count: 2, size: 16 }, pending: false, result: null, refusal: null, leagueTimeZone: null, onDrop: () => {}, onClearAdd: () => {}, onSubmit: () => {}, onDone: () => {} }

  it('a refusal renders the RPC’s sentence VERBATIM in an alert — the player, the kickoff and the release named, nothing re-worded', () => {
    const refusal =
      "Free Locked's game kicked off at 2099-09-13T17:00:00+00:00 (nfl_games, week 1) — a player cannot be added or dropped from his kickoff until the week's last game has ended (last_game_ends_at is unrecorded — the week is not over)"
    const html = unescapeHtml(renderToStaticMarkup(createElement(MovePanel, { ...base, intent: { add: rowOf('fa-locked'), drop: null }, refusal })))
    expect(html).toContain('role="alert"')
    expect(html).toContain('data-move-refusal')
    expect(html).toContain(refusal)
    expect(html).not.toContain('Something went wrong')
    expect(html).toContain('Dismiss')
  })
  it('a result reads out 113’s payload: the add’s slot, the drop’s touched lineups, waivers until, the caps after', () => {
    const result: AddDropResult = {
      transaction_id: 'tx',
      action_id: 'a',
      league_id: LEAGUE,
      team_id: MINE,
      season: 2099,
      week: 3,
      type: 'add_drop',
      add_player_id: 'fa-open',
      drop_player_id: 'mine-open',
      add: { player_id: 'fa-open', name: 'Free Open', position: 'WR', nfl_team: 'AAA', from_state: 'free_agent', to_state: 'rostered', acquisition_type: 'free_agent', slot_key: 'bn', acquired_at: 'x', game_lock: {} },
      drop: { player_id: 'mine-open', name: 'Mine Open', position: 'WR', nfl_team: 'AAA', from_slot_key: 'wr', to_state: 'on_waivers', waivers_until: '2099-09-12T17:00:00.000Z', fa_hold: { hours: 0, acquisition_type: null, acquired_at: null, early: false }, lineups: [{ week: 3, slot: 'wr:1' }], game_lock: {} },
      roster: { count_after: 2, roster_size: 16 },
      caps: { acquisitions_per_week: '3', acquisitions_per_season: 'unlimited', used_week_after: 1, used_season_after: 4 },
      settings: {},
      evaluated_at: 'y',
    }
    const html = unescapeHtml(renderToStaticMarkup(createElement(MovePanel, { ...base, intent: { add: null, drop: null }, result })))
    expect(html).toContain('data-move-result')
    expect(html).toContain('Added Free Open · Dropped Mine Open')
    expect(html).toContain('Free Open lands on your bench.')
    expect(html).toContain('Cleared from week 3 WR')
    expect(html).toMatch(/Mine Open is on waivers until /)
    expect(html).toContain('Adds: 1 of 3 adds used this week · 4 this season (no season cap).')
  })
  it('armed with an add: the add named, Make move enabled; the drop trigger shows the chosen player', () => {
    const html = unescapeHtml(renderToStaticMarkup(createElement(MovePanel, { ...base, intent: { add: rowOf('fa-open'), drop: myRoster[0] } })))
    expect(html).toContain('data-move-panel="armed"')
    expect(html).toContain('data-move-add="fa-open"')
    expect(html).toContain('data-move-drop="mine-open"')
    expect(html).not.toMatch(/data-move-submit[^>]*disabled/)
  })
  it('nothing picked: Make move disabled with the route’s own rule', () => {
    const html = unescapeHtml(renderToStaticMarkup(createElement(MovePanel, { ...base, intent: { add: null, drop: null } })))
    expect(html).toMatch(/disabled=""[^>]*data-move-submit|data-move-submit[^>]*disabled=""/)
    expect(html).toContain('Pick a player to add, a player to drop, or both.')
  })
})

// ---------------------------------------------------------------------------
// §16.5.4 — the required states
// ---------------------------------------------------------------------------

describe('§16.5.4 — the required states', () => {
  it('skeleton while the rosters load', () => {
    expect(renderPage({ rosters: 'missing' })).toContain('data-skeleton="pool-table"')
  })
  it('error-with-retry when the rosters read fails with nothing to show', () => {
    const html = renderPage({ rosters: 'error' })
    expect(html).toContain('Couldn’t load the rosters.')
    expect(html).toContain('Retry')
  })
  it('error-with-retry when the pool read fails; the players read too', () => {
    expect(renderPage({ pool: 'error' })).toContain('Couldn’t load the player pool.')
    expect(renderPage({ players: 'error' })).toContain('Couldn’t load the player list.')
  })
  it('degraded: a failed pool refetch keeps the last-good rows behind the stale banner', () => {
    const html = renderPage({ pool: 'degraded' })
    expect(html).toContain(STALE_LEAGUE_COPY)
    expect(html).toContain('data-pool-row="fa-open"')
  })
  it('reconnecting: the room’s connection drives the banner', () => {
    expect(renderPage({ connection: 'reconnecting' })).toContain('Reconnecting')
  })
})
