/**
 * swap-ops.test.ts — the mobile Swap player sheet's candidate lists, pinned
 * against the handoff's resolved examples (m-team.md §3 "Resolved examples")
 * on the app's lineup model, and the rules it must NOT weaken: every
 * candidate is a move `planMove` accepts (locks, eligibility, IR).
 */
import { describe, expect, it } from 'vitest'

import { buildEditorModel, slotInstances, type MoveContext, type Placement } from '@/components/leagues/lineup-editor-ops'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { RosterSettings } from '@/lib/leagues/settings/league-settings'

import { swapIsEmpty, swapOptions, type SwapOptions, type SwapSelection } from './swap-ops'
import { teamAvatarClass } from '@/components/mobile/league/match/match-ops'
import type { ActivityItem } from '@/lib/leagues/api/activity-service'

import { ageOn, gameLine, monthDay, ord, recentMoveRows, shortName, sinceText, summaryLine, teamAvClass, teamOrder } from './team-ops'

const SETTINGS: RosterSettings = {
  starting_slots: [
    { key: 'qb', label: 'QB', eligible: ['QB'], count: 1 },
    { key: 'rb', label: 'RB', eligible: ['RB'], count: 2 },
    { key: 'wr', label: 'WR', eligible: ['WR'], count: 2 },
    { key: 'te', label: 'TE', eligible: ['TE'], count: 1 },
    { key: 'flex', label: 'FLEX (W/R/T)', eligible: ['WR', 'RB', 'TE'], count: 1 },
    { key: 'k', label: 'K', eligible: ['K'], count: 1 },
    { key: 'dst', label: 'D/ST', eligible: ['DST'], count: 1 },
  ],
  bench: 6,
  ir_slots: [{ key: 'ir1', type: 'unrestricted', eligible_designations: ['OUT', 'IR'] }],
  swap_spots: 0,
} as RosterSettings

function p(id: string, full_name: string, position: string, extra: Partial<RosterPlayer> = {}): RosterPlayer {
  return {
    player_id: id,
    full_name,
    position,
    nfl_team: 'AAA',
    status: 'Active',
    bye_week: null,
    slot_key: null,
    acquisition_type: null,
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: { state: 'unlocked', until: null },
    ...extra,
  }
}

const ROSTER = [
  p('sanders', 'Shedeur Sanders', 'QB'),
  p('robinson', 'Bijan Robinson', 'RB'),
  p('conner', 'James Conner', 'RB'),
  p('brown', 'A.J. Brown', 'WR'),
  p('williams', 'Jameson Williams', 'WR'),
  p('engram', 'Evan Engram', 'TE'),
  p('pacheco', 'Isiah Pacheco', 'RB'),
  p('bates', 'Jake Bates', 'K'),
  p('steelers', 'Steelers D/ST', 'DEF'),
  p('bourne', 'Kendrick Bourne', 'WR'),
  p('allgeier', 'Tyler Allgeier', 'RB'),
  p('dotson', 'Jahan Dotson', 'WR'),
  p('stevenson', 'Rhamondre Stevenson', 'RB'),
  p('kincaid', 'Dalton Kincaid', 'TE'),
]

const PLACEMENT: Placement = {
  'qb:0': 'sanders',
  'rb:0': 'robinson',
  'rb:1': 'conner',
  'wr:0': 'brown',
  'wr:1': 'williams',
  'te:0': 'engram',
  'flex:0': 'pacheco',
  'k:0': 'bates',
  'dst:0': 'steelers',
}

function options(sel: SwapSelection, opts: { placement?: Placement; roster?: RosterPlayer[]; locked?: string[]; lockExempt?: boolean; kept?: Map<string, string> } = {}): SwapOptions {
  const roster = opts.roster ?? ROSTER
  const placement = opts.placement ?? PLACEMENT
  const slots = slotInstances(SETTINGS)
  const players = new Map(roster.map((r) => [r.player_id, r]))
  const ctx: MoveContext = { slots, players, locked: new Set(opts.locked ?? []), currentWeek: 5, lockExempt: opts.lockExempt ?? false, kept: opts.kept }
  const bench = buildEditorModel(placement, roster, SETTINGS).bench
  return swapOptions(sel, { placement, slots, players, bench, ctx })
}

function names(o: SwapOptions) {
  if (o.kind !== 'list') return o
  const label = (c: { row: { slot: { key: string } | null; player: RosterPlayer | null } }) => `${c.row.slot?.key ?? 'bn'}:${c.row.player?.player_id ?? 'empty'}`
  return { starters: o.starters.map(label), bench: o.bench.map(label), reserve: o.reserve.map(label) }
}

describe('swapOptions — the handoff’s resolved examples on the app’s model', () => {
  it('QB → no starters; the bench offers only the empty seat', () => {
    expect(names(options({ kind: 'slot', key: 'qb:0' }))).toEqual({ starters: [], bench: ['bn:empty'], reserve: [] })
  })

  it('RB1 → RB2 and FLEX; bench RBs then the empty seat', () => {
    expect(names(options({ kind: 'slot', key: 'rb:0' }))).toEqual({
      starters: ['rb:1:conner', 'flex:0:pacheco'],
      bench: ['bn:allgeier', 'bn:stevenson', 'bn:empty'],
      reserve: [],
    })
  })

  it('WR1 → WR2 only (FLEX holds an RB who cannot play WR)', () => {
    expect(names(options({ kind: 'slot', key: 'wr:0' }))).toEqual({
      starters: ['wr:1:williams'],
      bench: ['bn:bourne', 'bn:dotson', 'bn:empty'],
      reserve: [],
    })
  })

  it('FLEX → both RBs; every flex-eligible bench player, then the empty seat', () => {
    expect(names(options({ kind: 'slot', key: 'flex:0' }))).toEqual({
      starters: ['rb:0:robinson', 'rb:1:conner'],
      bench: ['bn:bourne', 'bn:allgeier', 'bn:dotson', 'bn:stevenson', 'bn:kincaid', 'bn:empty'],
      reserve: [],
    })
  })

  it('a bench WR → the WR seats and FLEX; no bench-to-bench (the app’s bench is a set)', () => {
    expect(names(options({ kind: 'bench', playerId: 'bourne' }))).toEqual({ starters: ['wr:0:brown', 'wr:1:williams', 'flex:0:pacheco'], bench: [], reserve: [] })
  })

  it('an empty bench seat → every filled starter can come to the bench', () => {
    const o = names(options({ kind: 'bench-empty', index: 0 }))
    expect(o).toMatchObject({ bench: [], reserve: [] })
    expect((o as { starters: string[] }).starters).toHaveLength(9)
  })

  it('an empty QB seat → the bench QB comes in ("Moved S. Sanders to QB")', () => {
    const placement = { ...PLACEMENT }
    delete placement['qb:0']
    const o = options({ kind: 'slot', key: 'qb:0' }, { placement })
    expect(names(o)).toEqual({ starters: [], bench: ['bn:sanders'], reserve: [] })
    expect(o.kind === 'list' && o.bench[0].toast).toBe('Moved S. Sanders to QB')
    expect(o.kind === 'list' && o.bench[0].move).toEqual({ playerId: 'sanders', target: { kind: 'slot', key: 'qb:0' } })
  })

  it('says the handoff’s toasts', () => {
    const wr = options({ kind: 'slot', key: 'wr:0' })
    if (wr.kind !== 'list') throw new Error('expected a list')
    expect(wr.starters[0].toast).toBe('Swapped A.J. Brown and J. Williams')
    expect(wr.bench.find((c) => c.row.player === null)?.toast).toBe('Moved A.J. Brown to bench')
    expect(wr.bench[0].toast).toBe('Swapped A.J. Brown and K. Bourne')
  })
})

describe('swapOptions never weakens a rule', () => {
  it('a locked player’s seat offers nothing and says why', () => {
    const o = options({ kind: 'slot', key: 'rb:0' }, { locked: ['robinson'] })
    expect(o.kind).toBe('locked')
    expect(o.kind === 'locked' && o.message).toMatch(/Bijan Robinson is locked/)
  })

  it('a seat held by a locked player is not offered to anyone else', () => {
    expect(names(options({ kind: 'slot', key: 'rb:1' }, { locked: ['robinson'] }))).toMatchObject({ starters: ['flex:0:pacheco'] })
  })

  it('a locked bench player is not offered', () => {
    expect((names(options({ kind: 'slot', key: 'rb:0' }, { locked: ['allgeier'] })) as { bench: string[] }).bench).toEqual(['bn:stevenson', 'bn:empty'])
  })

  it('override mode lifts the lock (the audited verb’s rule), never eligibility', () => {
    const o = names(options({ kind: 'slot', key: 'rb:0' }, { locked: ['robinson'], lockExempt: true }))
    expect(o).toMatchObject({ starters: ['rb:1:conner', 'flex:0:pacheco'] })
  })

  it('a kept starter’s seat is locked', () => {
    const placement = { ...PLACEMENT }
    delete placement['k:0']
    const o = options({ kind: 'slot', key: 'k:0' }, { placement, kept: new Map([['k:0', 'gone']]) })
    expect(o.kind).toBe('locked')
  })

  it('IR: only a player with an IR designation is offered the IR seat', () => {
    const roster = ROSTER.map((r) => (r.player_id === 'kincaid' ? { ...r, status: 'Out' } : r))
    const o = names(options({ kind: 'bench', playerId: 'kincaid' }, { roster }))
    expect(o).toMatchObject({ reserve: ['ir1:0:empty'] })
    expect((names(options({ kind: 'bench', playerId: 'dotson' })) as { reserve: string[] }).reserve).toEqual([])
  })

  it('IR: a Restricted-stint occupant is never offered for benching by a bench player coming in', () => {
    // Kincaid sits in IR on a stint running past week 5; Dotson (Out) on
    // the bench would fit the seat, but taking it would bench Kincaid.
    const roster = ROSTER.map((r) =>
      r.player_id === 'kincaid' ? { ...r, status: 'IR', ir_lock_until_week: 7 } : r.player_id === 'dotson' ? { ...r, status: 'Out' } : r,
    )
    const placement = { ...PLACEMENT, 'ir1:0': 'kincaid' }
    const held = names(options({ kind: 'slot', key: 'ir1:0' }, { roster, placement })) as { bench: string[] }
    expect(held.bench).not.toContain('bn:dotson')
    // Once the stint is over, the same swap is offered.
    const freed = roster.map((r) => (r.player_id === 'kincaid' ? { ...r, ir_lock_until_week: 5 } : r))
    expect((names(options({ kind: 'slot', key: 'ir1:0' }, { roster: freed, placement })) as { bench: string[] }).bench).toContain('bn:dotson')
  })

  it('nothing eligible → empty', () => {
    const roster = ROSTER.filter((r) => r.player_id !== 'sanders')
    const placement = { ...PLACEMENT }
    delete placement['qb:0']
    expect(swapIsEmpty(options({ kind: 'slot', key: 'qb:0' }, { roster, placement }))).toBe(true)
  })
})

describe('team-ops', () => {
  it('ord', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ord)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd'])
  })

  it('shortName', () => {
    expect(shortName('Bijan Robinson')).toBe('B. Robinson')
    expect(shortName('A.J. Brown')).toBe('A.J. Brown')
    expect(shortName('Steelers D/ST')).toBe('Steelers D/ST')
    expect(shortName('Pittsburgh Steelers', 'DEF')).toBe('Pittsburgh Steelers')
  })

  it('gameLine reads the stored game state, never a clock', () => {
    const g = { home_team: 'GB', away_team: 'DET', kickoff_at: '2026-10-11T17:00:00Z', home_score: 20, away_score: 31, quarter: null, game_clock: null }
    expect(gameLine('DET', [{ ...g, status: 'final' }])).toMatchObject({ kind: 'game', text: 'Final W 31-20 @ GB', opp: 'GB' })
    expect(gameLine('GB', [{ ...g, status: 'live', quarter: 4, game_clock: '6:50' }])).toMatchObject({ text: 'Q4 6:50 vs DET' })
    // Overtime is "OT", like Match — never "Q5" (gap list §4 item 14).
    expect(gameLine('GB', [{ ...g, status: 'live', quarter: 5, game_clock: '2:31' }])).toMatchObject({ text: 'OT 2:31 vs DET' })
    expect(gameLine('KC', [{ ...g, status: 'final' }])).toEqual({ kind: 'bye', text: 'BYE' })
    expect(gameLine('KC', [])).toEqual({ kind: 'unknown' })
  })

  it('summaryLine ranks PF / PA once games are played', () => {
    const row = (team_id: string, rank: number, w: number, l: number, pf: number, pa: number) =>
      ({ rank, team_id, name: team_id, wins: w, losses: l, ties: 0, games: w + l, win_pct: 0, points_for: pf, points_against: pa, weeks: w + l, median_record: { wins: 0, losses: 0, ties: 0 }, second_record: { wins: 0, losses: 0, ties: 0 }, separated_by: null, faab_balance: null, waiver_priority: null }) as never
    const rows = [row('a', 1, 8, 0, 400, 300), row('b', 2, 2, 6, 350, 380)]
    expect(summaryLine(rows, 'b')).toBe('2-6 · 2nd · PF 2nd · PA 1st')
  })

  // The Team view's streak is `streak-ops` (one count with Match and Standings — gap list #39).

  it('team colours: yours is always the accent; the rest follow league order without you (the Match tab’s rule)', () => {
    const teams = [{ id: 'a' }, { id: 'me' }, { id: 'b' }]
    const order = teamOrder(teams)
    expect(order).toEqual(['a', 'me', 'b'])
    // Your team is blue even when it isn't the league's oldest team.
    expect(teamAvClass('me', order, 'me')).toBe('bg-accent')
    expect(teamAvClass('a', order, 'me')).toBe('bg-m-ink')
    expect(teamAvClass('b', order, 'me')).toBe('bg-pos-wr')
    for (const id of order) expect(teamAvClass(id, order, 'me')).toBe(teamAvatarClass(order, id, 'me'))
  })

  it('recent moves: a transaction that didn’t complete is skipped before counting', () => {
    const tx = (id: string, status: string, add: string | null, drop: string | null) =>
      ({
        kind: 'transaction',
        id,
        status,
        created_at: '2026-10-10T12:00:00Z',
        payload: { add: add ? { player_id: add, name: add } : null, drop: drop ? { player_id: drop, name: drop } : null },
      }) as unknown as ActivityItem
    const items = [tx('1', 'failed', 'Lost Claim', null), tx('2', 'complete', 'A', 'B'), tx('3', 'complete', 'C', null), tx('4', 'complete', null, 'D'), tx('5', 'complete', 'E', null)]
    const r = recentMoveRows(items, 3)
    expect(r.count).toBe(3)
    expect(r.rows.map((m) => `${m.kind}:${m.name}`)).toEqual(['Added:A', 'Dropped:B', 'Added:C', 'Dropped:D'])
    expect(recentMoveRows([tx('1', 'failed', 'X', null)], 3)).toEqual({ rows: [], count: 0 })
  })

  it('times are against the read’s own instant', () => {
    expect(sinceText('2026-10-15T11:52:00Z', '2026-10-15T12:00:00Z')).toBe('8m')
    expect(sinceText('2026-10-15T07:00:00Z', '2026-10-15T12:00:00Z')).toBe('5h')
    expect(monthDay('2026-09-24T12:00:00Z')).toBe('Sep 24')
    expect(ageOn('2000-10-16', '2026-10-15T12:00:00Z')).toBe(25)
    expect(ageOn('2000-10-15', '2026-10-15T12:00:00Z')).toBe(26)
  })
})
