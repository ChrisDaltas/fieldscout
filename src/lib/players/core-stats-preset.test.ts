/**
 * The player page's pool (K0, F576): a preset prepares each line first, and a
 * league scores what is stored, untouched. No database: a stand-in returns only
 * the columns the read selected, so this also proves the widened reads carry
 * `two_point_conversions` and that it changes nothing for a league.
 */
import { describe, expect, it } from 'vitest'

import type { TimeProvider } from '@/lib/leagues/time/time-provider'

import type { CoreStatsPayload } from './core-stats-ops'
import { computePoolStandings, readPlayerCoreStats, storedLines } from './core-stats-service'
import { BASS_2026_WK1, BOSWELL_2026_WK8, cowboysThroughKickoff, fakeSupabase, storedGame } from './preset-scoring.fixtures'
import { presetLines, systemRules } from './preset-scoring'

const players = [
  { id: 'BASS', position: 'K', bye_week: null },
  { id: 'DAL', position: 'DEF', bye_week: null },
  { id: 'WR1', position: 'WR', bye_week: null },
]
const rules = systemRules('espn_standard')

/** An older row holding only the summed 2-pt column, no splits. */
const totalOnly = { ...storedGame('WR1', 2026, 1, { rec_yd: 10 }), two_point_conversions: 1 }

const client = () =>
  fakeSupabase({
    players,
    player_stats: [
      storedGame('BASS', 2026, 1, BASS_2026_WK1),
      storedGame('BASS', 2026, 8, BOSWELL_2026_WK8),
      ...cowboysThroughKickoff(),
      totalOnly,
    ],
  })

describe('computePoolStandings', () => {
  it('preset: kickers on the worked-out line, refused games dropped, the 2-pt fill runs', async () => {
    const pool = await computePoolStandings(client(), rules, new Map(), 2026, 9, presetLines)
    expect(pool.BASS).toMatchObject({ total: 21, games: 2, avg: 10.5 })
    expect(pool.DAL).toMatchObject({ total: 3, games: 2, avg: 1.5 })
    expect(pool.WR1).toMatchObject({ total: 3, games: 1 })
  })

  it('league: no preparation, the stored columns as they are. Bass is 13 + 8 now the map fills short FGs and misses (F870), the kickoff row still pays its +5, no 2-pt fill', async () => {
    const pool = await computePoolStandings(client(), rules, new Map(), 2026, 9, storedLines)
    expect(pool.BASS).toMatchObject({ total: 21, games: 2 })
    // Dallas weeks 5 and 6 as stored (−2, +5), and week 7 live: the stored 0 points allowed pays +5, yards pending.
    expect(pool.DAL?.total).toBe(8)
    expect(pool.WR1?.total).toBe(1)
  })

  it('league: the extra 2-pt column can not make a line count as a game (appeared reads a fixed list)', async () => {
    const pool = await computePoolStandings(
      fakeSupabase({ players, player_stats: [{ ...storedGame('WR1', 2026, 1, {}), two_point_conversions: 1 }] }),
      rules,
      new Map(),
      2026,
      9,
      storedLines,
    )
    expect(pool.WR1).toMatchObject({ total: 0, games: 0 })
  })

  it('a K with every game refused has no total and no rank, and never takes one from a real kicker', async () => {
    const pool = await computePoolStandings(
      fakeSupabase({
        players: [...players, { id: 'EMPTY', position: 'K', bye_week: null }],
        player_stats: [storedGame('BASS', 2026, 1, BASS_2026_WK1), storedGame('EMPTY', 2026, 1, {})],
      }),
      rules,
      new Map(),
      2026,
      9,
      presetLines,
    )
    expect(pool.EMPTY).toMatchObject({ total: null, games: 0, pos_rank: null, overall_rank: null })
    expect(pool.BASS).toMatchObject({ pos_rank: 1 })
  })

  it('the stand-in returns only what a read selected, so a wrong SELECT fails here as it would for real', async () => {
    const { data } = await fakeSupabase({ t: [{ a: 1, b: 2 }] }).from('t').select('a')
    expect(data).toEqual([{ a: 1 }])
  })
})

describe('readPlayerCoreStats', () => {
  const time = { now: () => new Date('2026-11-04T12:00:00Z') } as unknown as TimeProvider
  const tables = {
    players,
    player_stats: [storedGame('BASS', 2026, 1, BASS_2026_WK1), storedGame('BASS', 2026, 8, BOSWELL_2026_WK8), ...cowboysThroughKickoff(), totalOnly],
    leagues: [{ id: 'L', name: 'League', season: 2026, scoring_rules_snapshot: rules, deleted_at: null }],
    league_weeks: [{ league_id: 'L', season: 2026, week: 9, status: 'upcoming' }],
  }
  const read = async (playerId: string, choice: Parameters<typeof readPlayerCoreStats>[2]) => {
    const result = await readPlayerCoreStats(fakeSupabase(tables) as never, playerId, choice, time)
    expect(result.status).toBe(200)
    return result.body as unknown as CoreStatsPayload
  }
  const pointsByWeek = (body: CoreStatsPayload) => body.weekly.filter((cell) => cell.points !== null).map((cell) => [cell.week, cell.points])

  it('a preset: the worked-out kicker line, in the total and the weekly cells', async () => {
    const body = await read('BASS', { kind: 'system', system: 'espn_standard' })
    expect(body.total_points).toBe(21)
    expect(pointsByWeek(body)).toEqual([
      [1, 13],
      [8, 8],
    ])
  })

  it('a preset: a refused game has no cell and no count, and the 2-pt fill runs on the player page too', async () => {
    const dal = await read('DAL', { kind: 'system', system: 'ppr' })
    expect(dal).toMatchObject({ total_points: 3, games: 2 })
    expect(pointsByWeek(dal)).toEqual([
      [5, -2],
      [6, 5],
    ])
    expect((await read('WR1', { kind: 'system', system: 'espn_standard' })).total_points).toBe(3)
  })

  it('a league: the same rows score exactly as stored, and a filled kicker row equals the preset\'s number (F870)', async () => {
    const league = { kind: 'league', leagueId: 'L' } as const
    const k = await read('BASS', league)
    expect(k.total_points).toBe(21)
    expect(pointsByWeek(k)).toEqual([
      [1, 13],
      [8, 8],
    ])
    expect((await read('WR1', league)).total_points).toBe(1)
    expect((await read('DAL', league)).total_points).toBe(8)
  })
})
