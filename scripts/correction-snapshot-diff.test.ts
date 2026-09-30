/**
 * correction-snapshot-diff.test.ts — M6 L.E2.5 (PROGRESS D458). The diff on
 * SYNTHETIC snapshot pairs (every recording here is built in the test — no
 * real correction is claimed by any cell). The load-bearing property: the
 * diff NEVER invents a change — identical snapshots, the ingest's absent ≡ 0
 * equality, a missing read, a mismatched pair all say so or throw.
 */
import { describe, expect, it } from 'vitest'

import type { FixtureEntry, FixtureRecording } from '../src/lib/leagues/stats/fixtures/fixture-format'
import type { ProviderPlayerWeekStats } from '../src/lib/leagues/stats/stats-provider'

import {
  diffSnapshots,
  renderSnapshotDiff,
  settleProfile,
  type FinalSeenGame,
  type LineMeta,
  type ProductionEvent,
  type Snapshot,
} from './correction-snapshot-diff'

const SEASON = 2031
const WEEK = 3
const T1 = '2031-09-30T13:40:00.000Z'
const T2 = '2031-10-02T00:30:00.000Z'
const GAMES = [
  { gameId: '2031_03_ATL_GB', homeTeam: 'GB', awayTeam: 'ATL' },
  { gameId: '2031_03_ARI_SF', homeTeam: 'SF', awayTeam: 'ARI' },
]

type Line = Pick<ProviderPlayerWeekStats, 'playerId' | 'stats'> & { advanced?: Record<string, number> }

function recording(opts: {
  t: string
  lines: Line[]
  status?: Record<string, 'scheduled' | 'live' | 'final' | 'postponed'>
  week?: number
  provider?: string
  statsOk?: boolean
}): FixtureRecording {
  const week = opts.week ?? WEEK
  const status = opts.status ?? {}
  const entries: FixtureEntry[] = [
    {
      t: opts.t,
      method: 'getSchedule',
      args: [SEASON],
      ok: true,
      status: null,
      body: GAMES.map((g) => ({ ...g, season: SEASON, week, kickoffAt: '2031-09-28T17:00:00.000Z', gameDate: '2031-09-28', status: status[g.gameId] ?? 'final' })),
    },
    { t: opts.t, method: 'getGameStates', args: [SEASON, week], ok: true, status: null, body: GAMES.map((g) => ({ gameId: g.gameId, status: status[g.gameId] ?? 'final' })) },
    opts.statsOk === false
      ? { t: opts.t, method: 'getWeekStats', args: [SEASON, week], ok: false, status: 503, error: 'Sleeper weekly stats fetch failed: 503' }
      : {
          t: opts.t,
          method: 'getWeekStats',
          args: [SEASON, week],
          ok: true,
          status: null,
          body: opts.lines.map((l) => ({ playerId: l.playerId, season: SEASON, week, stats: l.stats, advanced: l.advanced ?? {} })),
        },
  ]
  return { header: { format: 'fieldscout-fixture', version: 1, provider: opts.provider ?? 'sleeper+nflverse', season: SEASON, week }, entries }
}

function meta(team: string, name: string, lastModified: string | null = null): LineMeta {
  return { name, position: 'WR', team, opponent: null, gameDate: '2031-09-28', lastModified }
}

function snap(label: string, rec: FixtureRecording, lines?: Record<string, LineMeta>): Snapshot {
  return { label, recording: rec, lines: lines ? { note: 'test', season: SEASON, week: WEEK, capturedAt: rec.entries[0].t, lines } : null }
}

const LONDON = { playerId: '8112', stats: { receptions: 6, receiving_yards: 100, targets: 9 } }
const ROB = { playerId: '9509', stats: { rush_attempts: 20, rush_yards: 88, rush_tds: 1 } }
const META1 = { '8112': meta('ATL', 'Drake London', '2031-09-29T01:00:00.000Z'), '9509': meta('SF', 'Test Back', '2031-09-29T01:00:00.000Z') }
const FINAL_SEEN: FinalSeenGame[] = [
  { week: WEEK, homeTeam: 'GB', awayTeam: 'ATL', status: 'final', firstSeenFinalAt: '2031-09-29T00:00:00.000Z' },
  { week: WEEK, homeTeam: 'SF', awayTeam: 'ARI', status: 'final', firstSeenFinalAt: '2031-09-29T03:00:00.000Z' },
]

describe('diffSnapshots — never invents a change', () => {
  it('N1 identical snapshots ⇒ zero changes, and the render says so in words', () => {
    const d = diffSnapshots(snap('final', recording({ t: T1, lines: [LONDON, ROB] }), META1), snap('window-end', recording({ t: T2, lines: [LONDON, ROB] }), META1))
    expect(d.changes).toEqual([])
    expect(d.notFinal).toEqual([])
    expect(d.vanished).toEqual([])
    expect(d.lines).toEqual({ first: 2, second: 2, both: 2, added: 0, vanished: 0, unchanged: 2 })
    expect(renderSnapshotDiff(d).join('\n')).toContain('FINAL-GAME CHANGES: none')
    expect(renderSnapshotDiff(d).join('\n')).toContain('never fabricated')
  })

  it("N2 the ingest's equality: an absent key and a 0 are the same line (no change)", () => {
    const before = { playerId: '8112', stats: { receptions: 6, receiving_yards: 100, rush_yards: 0 } }
    const after = { playerId: '8112', stats: { receptions: 6, receiving_yards: 100 } }
    const d = diffSnapshots(snap('final', recording({ t: T1, lines: [before] }), META1), snap('window-end', recording({ t: T2, lines: [after] }), META1))
    expect(d.changes).toEqual([])
    expect(d.lines.unchanged).toBe(1)
  })

  it('N3 …but a NULL_IS_PENDING key (yards allowed) absent vs 0 IS a change, as the ingest records it', () => {
    const before = { playerId: 'ATL', stats: { def_points_allowed: 17 } }
    const after = { playerId: 'ATL', stats: { def_points_allowed: 17, def_yards_allowed: 0 } }
    const d = diffSnapshots(snap('final', recording({ t: T1, lines: [before] }), { ATL: meta('ATL', 'Atlanta') }), snap('window-end', recording({ t: T2, lines: [after] }), { ATL: meta('ATL', 'Atlanta') }))
    expect(d.changes.map((c) => [c.statKey, c.old, c.new])).toEqual([['def_yards_allowed', null, 0]])
  })

  it('N4 a snapshot without a SUCCESSFUL week-stats read throws — never an empty diff', () => {
    expect(() =>
      diffSnapshots(snap('final', recording({ t: T1, lines: [LONDON], statsOk: false })), snap('window-end', recording({ t: T2, lines: [LONDON] }))),
    ).toThrow(/no successful getWeekStats\(2031,3\)/)
  })

  it('N5 a mismatched pair throws: another week, another provider, or not later', () => {
    const a = snap('final', recording({ t: T1, lines: [LONDON] }))
    expect(() => diffSnapshots(a, snap('window-end', recording({ t: T2, lines: [LONDON], week: 4 })))).toThrow(/not of one week/)
    expect(() => diffSnapshots(a, snap('window-end', recording({ t: T2, lines: [LONDON], provider: 'sleeper' })))).toThrow(/not of one week/)
    expect(() => diffSnapshots(a, snap('window-end', recording({ t: T1, lines: [LONDON] })))).toThrow(/is not later/)
  })

  it('N6 a player with two lines in one body throws — the diff never picks one', () => {
    expect(() =>
      diffSnapshots(snap('final', recording({ t: T1, lines: [LONDON, LONDON] })), snap('window-end', recording({ t: T2, lines: [LONDON] }))),
    ).toThrow(/has two lines/)
  })
})

describe('diffSnapshots — names every final-game change', () => {
  const corrected = { playerId: '8112', stats: { receptions: 6, receiving_yards: 94, targets: 9 } }

  it('C1 one scorable correction: player, key, old → new, game (by team), and the change window', () => {
    const late = { ...META1, '8112': meta('ATL', 'Drake London', '2031-10-01T00:08:41.000Z') }
    const d = diffSnapshots(snap('final', recording({ t: T1, lines: [LONDON, ROB] }), META1), snap('window-end', recording({ t: T2, lines: [corrected, ROB] }), late), { finalSeen: FINAL_SEEN })
    expect(d.changes).toHaveLength(1)
    const c = d.changes[0]
    expect([c.name, c.team, c.statKey, c.label, c.surface, c.old, c.new, c.gameId, c.gameBy, c.line]).toEqual([
      'Drake London',
      'ATL',
      'receiving_yards',
      'Receiving Yards',
      'scorable',
      100,
      94,
      '2031_03_ATL_GB',
      'team',
      'updated',
    ])
    // F528: first seen final 2031-09-29T00:00Z (production); changed after T1, by Sleeper's stamp.
    expect(c.finalSeenSource).toBe('production')
    expect(c.changedBy).toBe('2031-10-01T00:08:41.000Z')
    expect(c.changedBySource).toBe('sleeper_last_modified')
    // R1378: measured on production's arm — the WEEK's last game (SF, 03:00Z 9-29): 34h40m / 45h08.7m.
    expect(c.productionArm).toBe('week')
    expect(c.minutesAfterFinal).toEqual({ min: 2080, max: 2708.7 })
    expect(c.grace).toBe('outside')
    // His own game (ATL@GB, 00:00Z) is information only.
    expect(c.playerGame).toEqual({ finalAtFirst: true, finalSeenAt: '2031-09-29T00:00:00.000Z', minutesAfterFinal: { min: 2260, max: 2888.7 } })
    const text = renderSnapshotDiff(d).join('\n')
    expect(text).toContain('Drake London (WR, ATL; id 8112) — receiving_yards "Receiving Yards" 100 → 94 [scorable] — game 2031_03_ATL_GB (by team)')
    expect(text).toContain("measured from the WEEK's last game")
    expect(text).toContain('2080–2708.7 min after final — settle grace: outside')
    expect(text).toContain('info only — his own game: final at snapshot 1, first seen final 2031-09-29T00:00:00.000Z → 2260–2888.7 min after final')
  })

  it("C2 (R1378) the verdict is on PRODUCTION's arm: a Sunday player's fix inside 6 h of MONDAY NIGHT is inside, though hours after his own game", () => {
    // The reviewer's case: his Sunday game first seen final Sun 20:30Z, Monday night's final Tue 03:30Z,
    // snapshot 1 Tue 04:00Z, Sleeper's stamp Tue 05:08Z. Production (no game id on the line) measures from
    // the week's last game: 30–98 min ⇒ inside — a settle it re-scores silently, never a correction.
    const finalSeen: FinalSeenGame[] = [
      { week: WEEK, homeTeam: 'GB', awayTeam: 'ATL', status: 'final', firstSeenFinalAt: '2031-09-28T20:30:00.000Z' },
      { week: WEEK, homeTeam: 'SF', awayTeam: 'ARI', status: 'final', firstSeenFinalAt: '2031-09-30T03:30:00.000Z' },
    ]
    const stamped = { ...META1, '8112': meta('ATL', 'Drake London', '2031-09-30T05:08:00.000Z') }
    const d = diffSnapshots(
      snap('final', recording({ t: '2031-09-30T04:00:00.000Z', lines: [LONDON] }), META1),
      snap('window-end', recording({ t: T2, lines: [corrected] }), stamped),
      { finalSeen },
    )
    const c = d.changes[0]
    expect(c.productionArm).toBe('week')
    expect(c.finalSeenAt).toBe('2031-09-30T03:30:00.000Z')
    expect(c.minutesAfterFinal).toEqual({ min: 30, max: 98 })
    expect(c.grace).toBe('inside')
    // Measured from his own game it would read "outside" (≥ 1890 min) — shown as information only.
    expect(c.playerGame?.minutesAfterFinal.min).toBe(1890)
  })

  it("C9 (R1378) his game final but another in-week game not ⇒ NOT final on production's arm (production records none)", () => {
    const status = { '2031_03_ARI_SF': 'live' as const }
    const d = diffSnapshots(snap('final', recording({ t: T1, lines: [LONDON], status }), META1), snap('window-end', recording({ t: T2, lines: [corrected] }), META1))
    expect(d.changes).toEqual([])
    expect(d.notFinal.map((c) => [c.statKey, c.productionArm, c.finalAtFirst, c.playerGame?.finalAtFirst])).toEqual([['receiving_yards', 'week', false, true]])
  })

  it('C3 a change on a game NOT final at snapshot 1 is listed apart — an in-game change, not a correction', () => {
    const status = { '2031_03_ATL_GB': 'live' as const }
    const d = diffSnapshots(snap('final', recording({ t: T1, lines: [LONDON], status }), META1), snap('window-end', recording({ t: T2, lines: [corrected] }), META1))
    expect(d.changes).toEqual([])
    expect(d.notFinal.map((c) => [c.statKey, c.old, c.new, c.finalAtFirst])).toEqual([['receiving_yards', 100, 94, false]])
    expect(renderSnapshotDiff(d).join('\n')).toContain("CHANGES NOT FINAL ON PRODUCTION'S ARM")
  })

  it('C4 no sidecar ⇒ the whole week stands in (D432(3)); a change counts only if every in-week game was final', () => {
    const allFinal = diffSnapshots(snap('final', recording({ t: T1, lines: [LONDON] })), snap('window-end', recording({ t: T2, lines: [corrected] })))
    expect(allFinal.changes.map((c) => [c.gameBy, c.gameId, c.name])).toEqual([['week', null, null]])
    const oneLive = diffSnapshots(
      snap('final', recording({ t: T1, lines: [LONDON], status: { '2031_03_ARI_SF': 'live' } })),
      snap('window-end', recording({ t: T2, lines: [corrected] })),
    )
    expect(oneLive.changes).toEqual([])
    expect(oneLive.notFinal).toHaveLength(1)
  })

  it('C5 a line first seen at snapshot 2 on a final game is a change (a gap filled late), old = none', () => {
    const d = diffSnapshots(snap('final', recording({ t: T1, lines: [LONDON] }), META1), snap('window-end', recording({ t: T2, lines: [LONDON, ROB] }), META1))
    expect(d.lines.added).toBe(1)
    expect(d.changes.map((c) => [c.playerId, c.line, c.statKey, c.old, c.new])).toEqual([
      ['9509', 'added', 'rush_yards', null, 88], // registry order
      ['9509', 'added', 'rush_tds', null, 1],
      ['9509', 'added', 'rush_attempts', null, 20],
    ])
  })

  it('C6 a line the provider dropped is listed as vanished, never as a change', () => {
    const d = diffSnapshots(snap('final', recording({ t: T1, lines: [LONDON, ROB] }), META1), snap('window-end', recording({ t: T2, lines: [LONDON] }), META1))
    expect(d.changes).toEqual([])
    expect(d.vanished).toEqual([{ playerId: '9509', name: 'Test Back', team: 'SF' }])
  })

  it('C7 production events: a matching event is named with the change; an unmatched one is production-only', () => {
    const events: ProductionEvent[] = [
      { playerId: '8112', statKey: 'receiving_yards', oldValue: 100, newValue: 94, detectedAt: '2031-10-01T01:00:00Z', weekState: 'open', gameId: null },
      { playerId: '9509', statKey: 'rush_yards', oldValue: 88, newValue: 90, detectedAt: '2031-09-30T02:00:00Z', weekState: 'open', gameId: null },
    ]
    const d = diffSnapshots(snap('final', recording({ t: T1, lines: [LONDON, ROB] }), META1), snap('window-end', recording({ t: T2, lines: [corrected, ROB] }), META1), { events })
    expect(d.changes[0].productionEvent).toBe(events[0])
    expect(d.productionOnly).toEqual([events[1]])
    expect(renderSnapshotDiff(d).join('\n')).toContain('production events: 1 match a change above; 1 production-only')
  })

  it('C8 without production instants the recorder bound gives only a lower bound (max unknown)', () => {
    const d = diffSnapshots(snap('final', recording({ t: T1, lines: [LONDON] }), META1), snap('window-end', recording({ t: T2, lines: [corrected] }), META1))
    expect(d.changes[0].finalSeenSource).toBe('recorder')
    expect(d.changes[0].minutesAfterFinal).toEqual({ min: 0, max: null })
    expect(d.changes[0].grace).toBe('undetermined')
  })
})

describe('settleProfile (F528)', () => {
  it('P1 buckets each line by Sleeper stamp − production first-seen-final', () => {
    const lines = {
      '8112': meta('ATL', 'A', '2031-09-28T23:00:00.000Z'), // before final (−60)
      '9509': meta('SF', 'B', '2031-09-29T05:00:00.000Z'), // 120 min after SF's 03:00Z
    }
    const p = settleProfile(snap('final', recording({ t: T1, lines: [LONDON, ROB] }), lines), FINAL_SEEN)
    expect(p.measured).toBe(2)
    expect(p.buckets.map((b) => b.count)).toEqual([1, 0, 1, 0, 0, 0])
  })
})
