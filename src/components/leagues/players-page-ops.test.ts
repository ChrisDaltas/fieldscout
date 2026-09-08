/**
 * players-page-ops.test.ts — the players / free agents page's decisions,
 * pinned pure (spec §16.1 `…/players`, §16.2 `free-agents-table`, §12.19,
 * §13.1; PROGRESS D324, F227(f), F251(b)). Probes: (1) derive a row's lock
 * from a kickoff instant instead of `game_lock` → the locked-view cells;
 * (2) mark a rostered player a free agent when his pool row lags → the
 * holder-of-record cell; (3) render a caps line as "null of 3" → the
 * drop-only readout cell.
 */
import { describe, expect, it } from 'vitest'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import type { PoolRow } from '@/hooks/use-league-pool'
import type { AddDropResult } from '@/hooks/use-transactions'
import type { LeagueRosters, RosterPlayer } from '@/lib/leagues/api/rosters-service'

import * as ops from './players-page-ops'
import {
  LOCKED_ADD_TITLE,
  MOVE_NOTHING_COPY,
  NO_FREE_AGENTS_COPY,
  NO_MATCH_COPY,
  NO_ROSTERED_COPY,
  capsLine,
  emptyCopy,
  moveProblem,
  moveReadout,
  poolRows,
  rosterFill,
  slotLabel,
} from './players-page-ops'

function player(id: string, position = 'WR'): PoolPlayer {
  return { id, full_name: `Player ${id}`, position, team: 'AAA', adp: null, headshot_url: null, status: 'Active' }
}
function rostered(over: Partial<RosterPlayer> & Pick<RosterPlayer, 'player_id'>): RosterPlayer {
  return {
    full_name: `Player ${over.player_id}`,
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
const MINE = 'team-mine'
const OTHER = 'team-other'
const rosters: LeagueRosters = {
  league_id: 'L',
  season: 2099,
  teams: [
    { team_id: MINE, name: 'My Team', owner_id: 'u1', status: 'active', manager_user_id: 'u1', roster: [rostered({ player_id: 'r1' }), rostered({ player_id: 'r-locked', game_lock: { state: 'locked_release_unrecorded', until: null } })] },
    { team_id: OTHER, name: 'Their Team', owner_id: 'u2', status: 'active', manager_user_id: 'u2', roster: [rostered({ player_id: 'r2' })] },
  ],
}
const pool: PoolRow[] = [
  { player_id: 'fa-plain', state: 'free_agent', waivers_until: null, game_lock: { state: 'unlocked', until: null } },
  { player_id: 'fa-locked', state: 'locked_in_game', waivers_until: null, game_lock: { state: 'locked_until', until: '2099-09-15T04:00:00Z' } },
  { player_id: 'fa-waivers', state: 'on_waivers', waivers_until: '2099-09-12T17:00:00Z', game_lock: { state: 'unlocked', until: null } },
  { player_id: 'fa-waivers-no-instant', state: 'on_waivers', waivers_until: null, game_lock: { state: 'unlocked', until: null } },
  // A pool row that LAGS the rosters route (the mirror broken — D294's job):
  { player_id: 'r1', state: 'free_agent', waivers_until: null, game_lock: { state: 'unlocked', until: null } },
]
const players = ['fa-plain', 'fa-locked', 'fa-waivers', 'fa-waivers-no-instant', 'fa-norow', 'r1', 'r2', 'r-locked'].map((id) => player(id))

describe('poolRows — §12.19’s derived truth per player: the rosters are the holder of record, the pool row the rest', () => {
  const all = poolRows(players, rosters, pool, MINE, 'all')
  const by = (id: string) => all.find((r) => r.player.id === id)!

  it('keeps the window’s order (ADP — never re-sorted here)', () => {
    expect(all.map((r) => r.player.id)).toEqual(players.map((p) => p.id))
  })
  it('a free agent with a row · a free agent with NO row (lazy — §12.19) · both unlocked', () => {
    expect(by('fa-plain').availability).toEqual({ kind: 'free_agent' })
    expect(by('fa-norow')).toMatchObject({ availability: { kind: 'free_agent' }, lock: { locked: false }, poolState: null })
  })
  it('locked_in_game = a free agent whose lock the tick recorded: availability free_agent, 🔒 from game_lock', () => {
    expect(by('fa-locked').availability).toEqual({ kind: 'free_agent' })
    expect(by('fa-locked').lock).toEqual({ locked: true, copy: 'locked — game started', until: '2099-09-15T04:00:00Z' })
    expect(by('fa-locked').poolState).toBe('locked_in_game')
  })
  it('on_waivers carries its instant; a row claiming waivers WITHOUT one renders as a free agent (no invented date)', () => {
    expect(by('fa-waivers').availability).toEqual({ kind: 'on_waivers', until: '2099-09-12T17:00:00Z' })
    expect(by('fa-waivers-no-instant').availability).toEqual({ kind: 'free_agent' })
  })
  it('a rostered player is rostered whatever a lagging pool row says; mine is marked; the lock rides the rosters route', () => {
    expect(by('r1').availability).toEqual({ kind: 'rostered', teamId: MINE, teamName: 'My Team', mine: true })
    expect(by('r2').availability).toEqual({ kind: 'rostered', teamId: OTHER, teamName: 'Their Team', mine: false })
    expect(by('r-locked').lock).toEqual({ locked: true, copy: "locked — the week's last game has not ended", until: null })
  })
  it('scopes: free_agents drops rostered rows; rostered keeps only them', () => {
    expect(poolRows(players, rosters, pool, MINE, 'free_agents').map((r) => r.player.id)).toEqual(['fa-plain', 'fa-locked', 'fa-waivers', 'fa-waivers-no-instant', 'fa-norow'])
    expect(poolRows(players, rosters, pool, MINE, 'rostered').map((r) => r.player.id)).toEqual(['r1', 'r2', 'r-locked'])
  })
  it('no rosters yet (still loading) — every player reads as the pool says', () => {
    expect(poolRows(players, undefined, pool, MINE, 'all').find((r) => r.player.id === 'r2')!.availability).toEqual({ kind: 'free_agent' })
  })
})

describe('the copy per empty state and the one client-side form check', () => {
  it('emptyCopy per scope, per whether a search narrowed the window', () => {
    expect(emptyCopy('free_agents', false)).toBe(NO_FREE_AGENTS_COPY)
    expect(emptyCopy('free_agents', true)).toBe(NO_MATCH_COPY)
    expect(emptyCopy('rostered', false)).toBe(NO_ROSTERED_COPY)
    expect(emptyCopy('all', false)).toBe(NO_MATCH_COPY)
  })
  it('moveProblem: neither side is the ONLY refusal made here (the route’s own rule); everything else is the server’s', () => {
    expect(moveProblem({ add: null, drop: null })).toBe(MOVE_NOTHING_COPY)
    const add = poolRows([player('fa-locked')], rosters, pool, MINE, 'all')[0]
    // A LOCKED add is not refused here — the button carries the view's title
    // and the server's sentence is what a submit would show.
    expect(moveProblem({ add, drop: null })).toBeNull()
    expect(moveProblem({ add: null, drop: rostered({ player_id: 'r1' }) })).toBeNull()
    expect(LOCKED_ADD_TITLE).toMatch(/game has started/)
  })
  it('rosterFill: stored count over stored size, no judgement', () => {
    expect(rosterFill(rosters.teams[0].roster, 16)).toEqual({ count: 2, size: 16 })
    expect(rosterFill(undefined, 16)).toEqual({ count: 0, size: 16 })
  })
})

// ---------------------------------------------------------------------------
// The server's answer, read out (F227(f))
// ---------------------------------------------------------------------------

function result(over: Partial<AddDropResult>): AddDropResult {
  return {
    transaction_id: 'tx',
    action_id: 'a',
    league_id: 'L',
    team_id: MINE,
    season: 2099,
    week: 3,
    type: 'add_drop',
    add_player_id: null,
    drop_player_id: null,
    add: null,
    drop: null,
    roster: { count_after: 15, roster_size: 16 },
    caps: { acquisitions_per_week: 'unlimited', acquisitions_per_season: 'unlimited', used_week_after: 2, used_season_after: 7 },
    settings: {},
    evaluated_at: '2099-09-10T00:00:00Z',
    ...over,
  }
}
const fmt = (iso: string) => `@${iso}`

describe('moveReadout — 113’s stored payload as sentences', () => {
  it('an add: the name and the bench slot he landed on; the caps after', () => {
    const r = moveReadout(
      result({
        add_player_id: 'p9',
        add: { player_id: 'p9', name: 'Nine', position: 'WR', nfl_team: 'AAA', from_state: 'free_agent', to_state: 'rostered', acquisition_type: 'free_agent', slot_key: 'bn', acquired_at: 'x', game_lock: {} },
      }),
      fmt,
    )
    expect(r.headline).toBe('Added Nine')
    expect(r.lines).toEqual(['Nine lands on your bench.', 'Roster: 15 of 16.', 'Adds: 2 adds this week (no weekly cap) · 7 this season (no season cap).'])
  })
  it('a drop: every lineup the drop touched (`slot: null` = bench-only, not listed), where he went, the hold if early', () => {
    const r = moveReadout(
      result({
        drop_player_id: 'p1',
        drop: {
          player_id: 'p1',
          name: 'One',
          position: 'RB',
          nfl_team: 'BBB',
          from_slot_key: 'rb',
          to_state: 'on_waivers',
          waivers_until: '2099-09-12T17:00:00Z',
          fa_hold: { hours: 24, acquisition_type: 'free_agent', acquired_at: 'y', early: true },
          lineups: [
            { week: 3, slot: 'rb:1' },
            { week: 4, slot: null },
            { week: 5, slot: 'flex:0' },
          ],
          game_lock: {},
        },
        caps: { acquisitions_per_week: '3', acquisitions_per_season: '30', used_week_after: 2, used_season_after: 7 },
      }),
      fmt,
    )
    expect(r.headline).toBe('Dropped One')
    expect(r.lines).toEqual([
      'Cleared from week 3 RB, week 5 FLEX — that seat is empty until you fill it.',
      'One is on waivers until @2099-09-12T17:00:00Z.',
      'Dropped inside the 24 h hold after pickup.',
      'Roster: 15 of 16.',
      'Adds: 2 of 3 adds used this week · 7 of 30 this season.',
    ])
  })
  it('a drop-only move still reads REAL cap numbers (R763) — never "null of 3"', () => {
    const r = moveReadout(result({ drop_player_id: 'p1', drop: { player_id: 'p1', name: 'One', position: 'RB', nfl_team: null, from_slot_key: null, to_state: 'free_agent', waivers_until: null, fa_hold: { hours: 0, acquisition_type: null, acquired_at: null, early: false }, lineups: [], game_lock: {} }, caps: { acquisitions_per_week: '3', acquisitions_per_season: 'unlimited', used_week_after: 0, used_season_after: 0 } }), fmt)
    expect(r.lines).toContain('One is a free agent now.')
    expect(r.lines.at(-1)).toBe('Adds: 0 of 3 adds used this week · 0 this season (no season cap).')
    expect(r.lines.join(' ')).not.toMatch(/null|undefined|NaN/)
  })
  it('capsLine and slotLabel', () => {
    expect(capsLine({ acquisitions_per_week: '3', acquisitions_per_season: '30', used_week_after: 3, used_season_after: 12 })).toBe('Adds: 3 of 3 adds used this week · 12 of 30 this season.')
    expect(slotLabel('bn')).toBe('bench')
    expect(slotLabel(null)).toBe('bench')
    expect(slotLabel('dst:0')).toBe('D/ST')
    expect(slotLabel('ir1:0')).toBe('IR1')
    expect(slotLabel('wr:2')).toBe('WR')
  })
})

describe('no ledger code in any end-user copy (F277(a))', () => {
  it('every exported string constant is free of Q/E/F/D/R numbers', () => {
    for (const [name, value] of Object.entries(ops)) {
      if (typeof value === 'string') expect(value, name).not.toMatch(/\b[QEFDR]\d+\b/)
    }
  })
})
