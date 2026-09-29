/**
 * legality-plants.test.ts — R1266 (PROGRESS D423(10)): the season sim's own
 * §7.3.6 designations. `chooseLegalityPlants` picks ONE man per
 * `allow_illegal_lineups = false` league for a synthetic `Out`, and must never
 * re-create F374 (an OFF seat left with no legal man at a position).
 */
import { describe, expect, it } from 'vitest'

import { chooseLegalityPlants } from './season-runner'

type Row = { leagueId: string; teamId: string; playerId: string; position: string; adp: number | null; status: string | null }
const row = (leagueId: string, teamId: string, playerId: string, position: string, adp: number, status: string | null = null): Row => ({
  leagueId,
  teamId,
  playerId,
  position,
  adp,
  status,
})
const league = (label: string, leagueId: string, allow: boolean, managed: string[], offSeats: string[] = []) => ({
  label,
  leagueId,
  allowIllegalLineups: allow,
  managedTeams: new Set(managed),
  offSeats: new Set(offSeats),
})

describe('chooseLegalityPlants (R1266)', () => {
  it('plants the man the harness would START at a doubled position on a managed OFF seat — the backup keeps the slot', () => {
    const plants = chooseLegalityPlants({
      leagues: [league('#01', 'L1', false, ['T1'])],
      rosters: [row('L1', 'T1', 'qb1', 'QB', 10), row('L1', 'T1', 'wr1', 'WR', 5), row('L1', 'T1', 'wr2', 'WR', 90)],
      bridged: new Set(),
    })
    expect(plants).toEqual([{ leagueLabel: '#01', teamId: 'T1', playerId: 'wr1', position: 'WR', offHolders: 1 }])
  })

  it('plants a few — two per OFF league, on two different managed seats, never a third', () => {
    const plants = chooseLegalityPlants({
      leagues: [league('#01', 'L1', false, ['T1', 'T2', 'T3'])],
      rosters: ['T1', 'T2', 'T3'].flatMap((t, i) => [row('L1', t, `${t}-a`, 'RB', 10 + i), row('L1', t, `${t}-b`, 'RB', 50 + i)]),
      bridged: new Set(),
    })
    expect(plants.map((p) => [p.teamId, p.playerId])).toEqual([
      ['T1', 'T1-a'],
      ['T2', 'T2-a'],
    ])
  })

  it('refuses a man another OFF seat holds WITHOUT a backup (F374 is never re-created), and takes the next safe one', () => {
    const plants = chooseLegalityPlants({
      leagues: [league('#01', 'L1', false, ['T1']), league('#02', 'L2', false, ['T2'])],
      rosters: [
        // L1/T1 doubles at RB and at WR.
        row('L1', 'T1', 'rb1', 'RB', 3),
        row('L1', 'T1', 'rb2', 'RB', 80),
        row('L1', 'T1', 'wr1', 'WR', 5),
        row('L1', 'T1', 'wr2', 'WR', 90),
        // L2/T2 holds rb1 as its ONLY RB — planting rb1 would empty its slot.
        row('L2', 'T2', 'rb1', 'RB', 3),
        row('L2', 'T2', 'wr1', 'WR', 5),
        row('L2', 'T2', 'wr3', 'WR', 70),
      ],
      bridged: new Set(),
    })
    // L1: rb1 unsafe (L2/T2) → wr1, which L2/T2 also holds but with wr3 behind him.
    // L2: T2's only doubled position is WR, whose starter wr1 is already planted —
    // wr3 is its only healthy WR, so nothing more can be planted there.
    expect(plants.map((p) => [p.leagueLabel, p.playerId])).toEqual([['#01', 'wr1']])
    expect(plants[0]!.offHolders).toBe(2)
  })

  it('ignores ON-league holders (142 seats a blocked man there last, never leaves the slot empty) and OFF commissioner-managed seats', () => {
    const plants = chooseLegalityPlants({
      leagues: [league('#01', 'L1', false, ['T1'], ['T9']), league('#02', 'L2', true, ['T2'])],
      rosters: [
        row('L1', 'T1', 'te1', 'TE', 20),
        row('L1', 'T1', 'te2', 'TE', 99),
        row('L1', 'T9', 'te1', 'TE', 20), // the OFF control seat — seated by nobody
        row('L2', 'T2', 'te1', 'TE', 20), // an ON league
      ],
      bridged: new Set(),
    })
    expect(plants.map((p) => p.playerId)).toEqual(['te1'])
    expect(plants[0]!.offHolders).toBe(1)
  })

  it('never plants a §23.6 bridged man, an already-blocked man, or on an unmanaged seat', () => {
    const plants = chooseLegalityPlants({
      leagues: [league('#01', 'L1', false, ['T1'])],
      rosters: [
        row('L1', 'T1', 'k1', 'K', 100), // bridged
        row('L1', 'T1', 'k2', 'K', 120),
        row('L1', 'T2', 'dst1', 'DST', 50), // T2 unmanaged
        row('L1', 'T2', 'dst2', 'DST', 60),
        row('L1', 'T1', 'qb1', 'QB', 1, 'sim-world:Out'), // masked = healthy to the sim, but paired with a blocked one:
        row('L1', 'T1', 'qb2', 'QB', 30, 'IR'),
      ],
      bridged: new Set(['k1']),
    })
    expect(plants).toEqual([])
  })

  it('an OFF league with no safe candidate plants nothing (the run then names it — LEGALITY PREMISE)', () => {
    const plants = chooseLegalityPlants({
      leagues: [league('#01', 'L1', false, ['T1'])],
      rosters: [row('L1', 'T1', 'qb1', 'QB', 1), row('L1', 'T1', 'rb1', 'RB', 2)],
      bridged: new Set(),
    })
    expect(plants).toEqual([])
  })
})
