/**
 * player-points-store.test.ts — the pure pieces of M5 L.D3.11 (migration 158;
 * PROGRESS F405 / D422): the per-player rows a team's score is made of, the
 * pre-158 recognition (the MEASURED PostgREST answer), the door-report
 * reading, the locked-week classification and the drain's info line.
 */
import { describe, expect, it } from 'vitest'

import { isMissingPlayerPointsStore, type StoredPlayerPoints, storedTeamPoints } from './player-points-store'
import { classifyLockedCell } from './reconcile'
import { classifyDrain } from './score-week-invoker'
import {
  type BatchReport,
  type DoorReport,
  type LeagueWeekReport,
  playerPointsRows,
  playerPointsStorageOf,
  starterSlotsOf,
  startersOf,
  type TeamWeekScore,
} from './score-week-worker'

/** MEASURED 2026-09-28 on the local stack (PostgREST): a select of a table the schema lacks. */
const PGRST205 = { code: 'PGRST205', details: null, hint: "Perhaps you meant the table 'public.league_week_player_points'", message: "Could not find the table 'public.league_week_player_points' in the schema cache" }

describe('the slot-by-slot starters (the terms of the team’s sum)', () => {
  const map = { 'qb:0': 'q1', 'wr:0': 'w1', 'wr:1': 'w2', 'ir1:0': 'hurt', 'flex:0': '' }
  it('starterSlotsOf keeps each starting slot with its player, IR and empty seats out — and startersOf is exactly its players, in the same order', () => {
    expect(starterSlotsOf(map, new Set(['ir1']))).toEqual([
      { slot: 'qb:0', player_id: 'q1' },
      { slot: 'wr:0', player_id: 'w1' },
      { slot: 'wr:1', player_id: 'w2' },
    ])
    expect(startersOf(map, new Set(['ir1']))).toEqual(['q1', 'w1', 'w2'])
    expect(starterSlotsOf([], new Set())).toBeNull()
  })

  const team: TeamWeekScore = {
    team_id: 't1',
    points: 14.75,
    starters: [
      { player_id: 'q1', position: 'QB', points: 10.5, pending: [], reason: 'scored' },
      { player_id: 'w1', position: 'WR', points: 4.25, pending: [], reason: 'scored' },
      { player_id: 'w2', position: 'WR', points: 0, pending: [], reason: 'no_stat_row' },
    ],
    pending: [],
    no_stat_row: ['w2'],
  }
  it('playerPointsRows zips the slots with the scored starters — the rows the door stores WITH the score (Σ = 14.75)', () => {
    const rows = playerPointsRows(starterSlotsOf(map, new Set(['ir1']))!, team)
    expect(rows).toEqual([
      { slot: 'qb:0', player_id: 'q1', points: 10.5, pending: [], reason: 'scored' },
      { slot: 'wr:0', player_id: 'w1', points: 4.25, pending: [], reason: 'scored' },
      { slot: 'wr:1', player_id: 'w2', points: 0, pending: [], reason: 'no_stat_row' },
    ])
    expect(rows.reduce((a, r) => a + r.points, 0)).toBe(team.points)
  })
  it('…and refuses a misaligned pair loudly, never storing one player’s points under another’s slot', () => {
    expect(() => playerPointsRows([{ slot: 'qb:0', player_id: 'q1' }], team)).toThrow(/1 slots but 3 scored starters/)
    expect(() => playerPointsRows([{ slot: 'qb:0', player_id: 'x' }, { slot: 'wr:0', player_id: 'w1' }, { slot: 'wr:1', player_id: 'w2' }], team)).toThrow(/slot qb:0 holds x but the score at that position is q1/)
  })
})

describe('deploy before push — recognising a pre-158 database BY NAME', () => {
  it('the MEASURED PGRST205 for the table (and Postgres’s 42P01) is the missing store', () => {
    expect(isMissingPlayerPointsStore(PGRST205)).toBe(true)
    expect(isMissingPlayerPointsStore({ code: '42P01', message: 'relation "public.league_week_player_points" does not exist' })).toBe(true)
    // PostgREST names the schema it served (the stack cell reads it from graphql_public — R1257):
    expect(isMissingPlayerPointsStore({ code: 'PGRST205', message: "Could not find the table 'graphql_public.league_week_player_points' in the schema cache" })).toBe(true)
  })
  it('anchored: another missing table — even one whose HINT names ours — or any other error is NOT', () => {
    expect(isMissingPlayerPointsStore({ ...PGRST205, message: "Could not find the table 'public.league_week_player_pointz' in the schema cache" })).toBe(false)
    expect(isMissingPlayerPointsStore({ code: '42501', message: 'permission denied for table league_week_player_points' })).toBe(false)
    expect(isMissingPlayerPointsStore({ code: 'PGRST205', message: "Could not find the table 'public.matchups' in the schema cache" })).toBe(false)
    expect(isMissingPlayerPointsStore(null)).toBe(false)
  })
  const door119: DoorReport = { league_id: 'l', season: 2026, week: 3, mode: 'h2h', received: 2, writable: 1, written: 1, unchanged: 0, skipped: [], reason: null }
  it('the door report: 119’s shape (no player_points) ⇒ not_stored_pre_158; 158’s ⇒ stored', () => {
    expect(playerPointsStorageOf(door119)).toBe('not_stored_pre_158')
    expect(playerPointsStorageOf({ ...door119, player_points: { teams_sent: 2, teams_written: 2, rows_written: 3, rows_removed: 0 } })).toBe('stored')
  })
  it('classifyDrain names the pre-158 league-weeks as INFO (the scores were written as before) — never an alert', () => {
    const entry = { league_id: 'l', season: 2026, week: 3, outcome: 'written', player_points: 'not_stored_pre_158' } as unknown as LeagueWeekReport
    const report = { leagues: [entry], ack_missed: { restamped: 0, lease_lost: 0, gone: 0 }, reason: null, deferred: 0 } as unknown as BatchReport
    const verdict = classifyDrain(report)
    expect(verdict.alerts).toEqual([])
    expect(verdict.infos).toEqual(['1 league-week(s) scored without per-player points: the database predates migration 158 (box scores stay live until it is pushed)'])
  })
})

describe('a LOCKED week against its stored per-player points (the exact reconcile — F405 / F268)', () => {
  const row = (slot: string, player_id: string, points: number, over: Partial<StoredPlayerPoints> = {}): StoredPlayerPoints => ({
    team_id: 't1', week: 1, slot, player_id, points, pending: [], reason: 'scored', source: 'worker', ...over,
  })
  const rows = [row('wr:0', 'w1', 12), row('wr:1', 'w3', 3)]
  const today = (p1: number): TeamWeekScore => ({
    team_id: 't1', points: p1 + 3, pending: [], no_stat_row: [],
    starters: [{ player_id: 'w1', position: 'WR', points: p1, pending: [], reason: 'scored' }, { player_id: 'w3', position: 'WR', points: 3, pending: [], reason: 'scored' }],
  })
  it('storedTeamPoints: Σ in cents (exact), NULL when a row is pending', () => {
    expect(storedTeamPoints([row('a', 'x', 0.1), row('b', 'y', 0.2)])).toBe(0.3)
    expect(storedTeamPoints([row('a', 'x', 1, { pending: ['k'] })])).toBeNull()
  })
  it('stored = Σ rows and today’s stats agree ⇒ clean', () => {
    expect(classifyLockedCell(15, rows, today(12))).toEqual([])
  })
  it('stored = Σ rows but a line moved since the lock ⇒ post_window_correction [INFO], naming stored and current', () => {
    const v = classifyLockedCell(15, rows, today(14))
    expect(v.map((x) => [x.kind, x.severity])).toEqual([['post_window_correction', 'info']])
    expect(v[0].explanation).toContain("w1 (wr:0) stored 12, today's stats 14")
  })
  it('stored ≠ Σ rows ⇒ DRIFT [alert] — exact, nothing benign explains it', () => {
    expect(classifyLockedCell(16, rows, today(14)).map((x) => [x.kind, x.severity])).toEqual([['drift', 'alert']])
    expect(classifyLockedCell(16, rows, null).map((x) => x.kind)).toEqual(['drift'])
  })
  it('a backfill_unrecoverable team-week ⇒ INFO, named with both sums, never re-alerted', () => {
    const v = classifyLockedCell(7.5, [row('qb:0', 'q2', 8, { source: 'backfill_unrecoverable' })], null)
    expect(v.map((x) => [x.kind, x.severity])).toEqual([['backfill_unrecoverable', 'info']])
    expect(v[0].explanation).toContain('stored 7.5; the stored per-player points add up to 8')
  })
})
