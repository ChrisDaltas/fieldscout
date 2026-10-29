/**
 * provider-faults-db.test.ts — M7 L.F2.3 DRILL 2: "delay and duplicate
 * provider rows (no double-scoring, reconciliation clean)" (tasks-M7 §6
 * L.F2.3; delivery plan :98; spec §23.2 "every upsert is idempotent and
 * diff-aware … provider outage: after 3 failed polls, raise stats_degraded
 * … scoring resumes and back-fills on recovery", §23.4 corrections, §24.3
 * "stats provider outage mid-Sunday"; PROGRESS D762).
 *
 * The REAL ingest and score worker over one league, fed by a scripted
 * Sunday through `FaultyProvider` (the §23.1 `StatsProvider` seam — no
 * network, nothing on the shared stack stopped):
 *
 *   P1  DUPLICATED ROWS — game 1 live, every row sent twice (one three
 *       times): each line is stored once, queued once, scored once.
 *   P2  the same answer polled again: no delta, nothing queued (idempotent).
 *   P3  OUTAGE mid-game — three polls fail: nothing is written, the
 *       `stats_degraded` tracker rises on the third.
 *   P4  RECOVERY with a DELAYED row — game 1 final, game 2 live, WR3's row
 *       held back: the recovery poll back-fills everything else, the
 *       tracker clears, the scores move.
 *   P5  every game final, WR3 and RB4 still held back.
 *   P6  WR3's row lands 1 h after the week's last game (inside the 6 h
 *       settle grace): scored, never recorded as a correction.
 *   P7  RB4's row lands 8 h after (past the grace, inside the window): a
 *       first line for a final week — recorded as a correction, one league
 *       post, scored once.
 *   P8  a STALE cached row for RB1 (100 → 90 rush yards), then the fresh
 *       one again: every answer is applied as the provider gives it, the
 *       score ends where the stats end — never doubled.
 *   P9  a CONFLICTING duplicate — RB2 twice with different numbers: Chris's
 *       F831 ruling (2026-10-27, "Skip it, retry next update") — a failed
 *       poll, nothing written, counted toward stats_degraded.
 *   P10 the provider answers cleanly again: the flag clears, on the goldens.
 *
 * Every phase is followed by a drain and the stored-literal goldens; the
 * drill ends with no duplicate point row, an empty queue, and reconcile
 * (in process — every cell compared, zero alerts — and the CLI, exit 0).
 *
 * Requires the local stack (D59(5)). Fixtures `chaos-f23 prov …`, season
 * 2072, `chaos_f23_prov_*` users — swept before and after.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { SyncClient } from '@/lib/sync/types'

import { reconcileSeason } from '../scoring/reconcile'
import { CHAOS_SEASON, census, must, mustRow, runReconcileCli, serviceClient, sweep } from './chaos-world'
import { FaultyProvider } from './faults'
import {
  T,
  at,
  buildScoringWorld,
  cellsOf,
  drain,
  finalLines,
  GOLDEN_SCORES,
  line,
  pid,
  poll,
  queueRows,
  schedule,
  statRowCount,
  storedLine,
  type ScoringWorld,
} from './scoring-world'

const service = serviceClient()
const db = service as unknown as SyncClient
let world: ScoringWorld
let faulty: FaultyProvider

async function posts(): Promise<string[]> {
  const rows = await must(service.from('league_chat').select('message').eq('league_id', world.leagues[0].id).eq('is_system', true).order('created_at'), 'posts')
  return (rows ?? []).map((r) => r.message)
}

async function events(): Promise<string[]> {
  const rows = await must(
    service.from('stat_correction_events').select('player_id, stat_key, old_value, new_value').eq('season', CHAOS_SEASON).order('detected_at').order('stat_key'),
    'events',
  )
  return (rows ?? []).map((e) => `${e.player_id.replace('chaos-f23-', '')} ${e.stat_key} ${e.old_value === null ? '∅' : Number(e.old_value)}→${Number(e.new_value)}`)
}

async function scores(): Promise<Array<[number | null, number | null]>> {
  return (await cellsOf(service, world.leagues[0])).scores
}

beforeAll(async () => {
  await sweep(service)
  world = await buildScoringWorld(service, 'prov', 1)
  faulty = new FaultyProvider(world.provider)
}, 120_000)

afterAll(async () => {
  await sweep(service)
  expect(Object.values(await census(service)).every((n) => n === 0)).toBe(true)
}, 120_000)

describe('L.F2.3 drill 2 — the provider delays and duplicates rows', () => {
  it('P1 DUPLICATED ROWS: every row twice (RB1 three times) — each line stored once, queued once, scored once', async () => {
    world.provider.games = schedule('live', 'scheduled')
    world.provider.lines = [line('rb1', { rush_yards: 60 }), line('wr1', { receiving_yards: 20, receptions: 2 }), line('rb2', { rush_yards: 30 }), line('wr2', { receiving_yards: 40 })]
    faulty.faults = { duplicate: new Map([[pid('rb1'), 3], [pid('wr1'), 2], [pid('rb2'), 2], [pid('wr2'), 2]]) }
    expect((await faulty.getWeekStats(CHAOS_SEASON, 1)).length).toBe(9) // the fault is real: 9 rows for 4 players
    const r = await poll(world, faulty, db, T.live)
    expect(r.ok).toBe(true)
    expect([r.stats.inserted, r.stats.enqueued]).toEqual([4, 4])
    // R1715: 9 rows for 4 players — 5 repeats collapsed, and said (F830).
    expect(r.stats.duplicates).toBe(5)
    expect(r.reasons).toContain('player_stats: 5 repeated provider row(s) — identical copies of a line already in this answer — written once (§23.2 idempotent; F830)')
    expect(await statRowCount(service)).toBe(4)
    await drain(world, service, at(T.live, 0.01))
    // RB1 6.00 + WR1 2.00 = 8.00; RB2 3.00 + WR2 4.00 = 7.00 — once, not three or two times.
    expect(await scores()).toEqual([[8, 7], [0, 0]])
    expect((await cellsOf(service, world.leagues[0])).duplicatePointRows).toEqual([])
  })

  it('P2 the same answer polled again: no delta, nothing queued', async () => {
    const r = await poll(world, faulty, db, at(T.live, 0.1))
    expect([r.ok, r.stats.deltas, r.stats.enqueued, r.stats.unchanged]).toEqual([true, 0, 0, 4])
    expect(await queueRows(service)).toEqual([])
  })

  it('P3 OUTAGE mid-game: three polls fail — nothing written; stats_degraded rises on the third', async () => {
    faulty.faults = { failPolls: 3 }
    world.provider.lines = [line('rb1', { rush_yards: 90 }), line('wr1', { receiving_yards: 40, receptions: 4 }), line('rb2', { rush_yards: 70 }), line('wr2', { receiving_yards: 110, receiving_tds: 1 })]
    const degradedAfter: boolean[] = []
    for (let i = 1; i <= 3; i++) {
      const r = await poll(world, faulty, db, at(T.live, 0.2 + i * 0.01))
      expect(r.ok).toBe(false)
      expect(r.reasons.join(' ')).toContain('nothing written')
      degradedAfter.push(world.degradation.degraded)
    }
    expect(degradedAfter).toEqual([false, false, true])
    expect(faulty.failed).toBe(3)
    expect((await storedLine(service, 'rb1'))?.rush_yards).toBe(60)
    expect(await queueRows(service)).toEqual([])
    expect(await scores()).toEqual([[8, 7], [0, 0]])
  })

  it('P4 RECOVERY with a DELAYED row: game 1 final, game 2 live, WR3 held back — the back-fill lands, the flag clears', async () => {
    world.provider.games = schedule('final', 'live')
    world.provider.lines = [...finalLines(['rb1', 'wr1', 'rb2', 'wr2']), line('rb3', { rush_yards: 20 }), line('wr3', { receiving_yards: 10 }), line('rb4', { rush_yards: 5 }), line('wr4', { receiving_yards: 30 })]
    faulty.faults = { withhold: new Set([pid('wr3')]) }
    const r = await poll(world, faulty, db, T.half)
    expect([r.ok, r.degraded]).toEqual([true, false])
    expect(world.degradation.degraded).toBe(false)
    expect([r.stats.inserted, r.stats.updated]).toEqual([3, 4])
    await drain(world, service, at(T.half, 0.01))
    // Game 1 at its final lines (21 / 26); RB3 2.00 (WR3 not in yet) v RB4 0.50 + WR4 3.00.
    expect(await scores()).toEqual([[21, 26], [2, 3.5]])
  })

  it('P5 every game final, WR3 and RB4 still held back: scored on what has arrived', async () => {
    world.provider.games = schedule('final', 'final')
    world.provider.lines = finalLines()
    faulty.faults = { withhold: new Set([pid('wr3'), pid('rb4')]) }
    const r = await poll(world, faulty, db, T.final)
    expect([r.ok, r.corrections.detected]).toEqual([true, 0])
    await drain(world, service, at(T.final, 0.01))
    // RB3 4.50 (WR3 missing) v WR4 7.70 (RB4's line is still the 5-yard one: 0.50).
    expect(await scores()).toEqual([[21, 26], [4.5, 8.2]])
    const wk = await mustRow(service.from('nfl_weeks').select('last_game_ends_at').eq('season', CHAOS_SEASON).eq('week', 1).single(), 'week')
    expect(wk.last_game_ends_at).not.toBeNull()
  })

  it('P6 WR3\'s row lands 1 h after the last game (inside the settle grace): scored, never recorded as a correction', async () => {
    faulty.faults = { withhold: new Set([pid('rb4')]) }
    const r = await poll(world, faulty, db, at(T.final, 1))
    expect([r.ok, r.stats.inserted, r.corrections.detected]).toEqual([true, 1, 0])
    expect(r.corrections.settled).toBeGreaterThan(0)
    await drain(world, service, at(T.final, 1.01))
    expect(await scores()).toEqual([[21, 26], [7.8, 8.2]])
    expect(await events()).toEqual([])
    expect(await posts()).toEqual([])
  })

  it('P7 RB4\'s row lands 8 h after (past the grace, inside the window): one correction, one league post, scored once', async () => {
    faulty.faults = {}
    const r = await poll(world, faulty, db, at(T.final, 8))
    expect([r.ok, r.stats.updated]).toEqual([true, 1])
    expect(r.corrections.detected).toBeGreaterThan(0)
    await drain(world, service, at(T.final, 8.01))
    expect(await scores()).toEqual(GOLDEN_SCORES)
    expect(await events()).toEqual(['rb4 fumbles_lost 0→1', 'rb4 rush_yards 5→12'])
    const p = await posts()
    expect(p).toHaveLength(1)
    expect(p[0]).toContain('Stat correction (Week 1): ')
  })

  it('P8 a STALE cached RB1 row (100 → 90), then the fresh one: each answer applied as given — the score ends where the stats end, never doubled', async () => {
    faulty.faults = { stale: new Map([[pid('rb1'), line('rb1', { rush_yards: 90, rush_tds: 1 })]]) }
    await poll(world, faulty, db, at(T.final, 9))
    await drain(world, service, at(T.final, 9.01))
    expect(await scores()).toEqual([[20, 26], [7.8, 6.9]])
    faulty.faults = {}
    await poll(world, faulty, db, at(T.final, 10))
    await drain(world, service, at(T.final, 10.01))
    expect(await scores()).toEqual(GOLDEN_SCORES)
    expect((await events()).filter((e) => e.startsWith('rb1'))).toEqual(['rb1 rush_yards 100→90', 'rb1 rush_yards 90→100'])
    console.log(`[L.F2.3 drill 2] P8 stale-then-fresh RB1: league posts now ${(await posts()).length} — ${JSON.stringify(await posts())}`)
  })

  // P9 — F831, RULED BY CHRIS 2026-10-27 (relayed by the orchestrator): two
  // DIFFERENT lines for one player in one update — "Skip it, retry next
  // update". The whole answer is a FAILED poll: the last good stored lines
  // stay, nothing is written, queued or announced for the week, it counts
  // toward stats_degraded, and the next poll tries again.
  it('P9a F831 — one copy equals the stored line, the other differs: the answer is skipped as a failed poll; RB2 keeps 80, nothing queued, nothing announced', async () => {
    faulty.faults = { conflicting: new Map([[pid('rb2'), { rush_yards: 85 }]]) }
    expect((await storedLine(service, 'rb2'))?.rush_yards).toBe(80)
    const eventsBefore = await events()
    const postsBefore = await posts()
    const failuresBefore = world.degradation.consecutiveFailures
    const r = await poll(world, faulty, db, at(T.final, 11))
    expect([r.ok, r.stats.duplicates, r.write.path]).toEqual([false, 0, 'none'])
    expect(r.error).toContain(`two different lines for 1 player(s) (${pid('rb2')})`)
    expect(r.reasons.join(' ')).toContain('Skip it, retry next update')
    expect(world.degradation.consecutiveFailures).toBe(failuresBefore + 1)
    expect((await storedLine(service, 'rb2'))?.rush_yards).toBe(80)
    expect(await queueRows(service)).toEqual([])
    expect([await events(), await posts()]).toEqual([eventsBefore, postsBefore])
    expect(await scores()).toEqual(GOLDEN_SCORES)
  })

  it("P9b F831 / F832 — both copies differ from the stored line: every poll is a FAILED poll (never a hard refusal), WR1's update in the same answer is not written, and stats_degraded rises on the third in a row", async () => {
    // RB2 answers 83 AND 82; the same answer also moves WR1 50 → 55.
    faulty.faults = { conflicting: new Map([[pid('rb2'), { rush_yards: 82 }]]) }
    world.provider.lines = [
      ...finalLines().filter((l) => !l.playerId.endsWith('wr1') && !l.playerId.endsWith('rb2')),
      line('rb2', { rush_yards: 83 }),
      line('wr1', { receiving_yards: 55, receptions: 5 }),
    ]
    const seen: Array<[boolean, boolean]> = []
    for (let i = 0; i < 4; i++) {
      const r = await poll(world, faulty, db, at(T.final, 12 + i * 0.01))
      expect(r.error).toContain('(F831)')
      seen.push([r.ok, r.degraded])
    }
    // P9a was the first failure in a row; these are the 2nd–5th.
    expect(seen).toEqual([
      [false, false],
      [false, true],
      [false, true],
      [false, true],
    ])
    expect([(await storedLine(service, 'rb2'))?.rush_yards, (await storedLine(service, 'wr1'))?.receiving_yards]).toEqual([80, 50])
    expect(await queueRows(service)).toEqual([])
    expect(await scores()).toEqual(GOLDEN_SCORES)
  })

  it('P10 the provider answers cleanly again: the poll succeeds, the flag clears, nothing moved while it was skipped — still on the goldens', async () => {
    faulty.faults = {}
    world.provider.lines = finalLines()
    const r = await poll(world, faulty, db, at(T.final, 13))
    expect([r.ok, r.degraded, r.stats.updated]).toEqual([true, false, 0])
    expect(world.degradation.degraded).toBe(false)
    await drain(world, service, at(T.final, 13.01))
    expect(await scores()).toEqual(GOLDEN_SCORES)
  })

  it('END no duplicate point row, the queue empty, reconcile clean in process and the CLI exits 0', async () => {
    faulty.faults = {}
    const c = await cellsOf(service, world.leagues[0])
    expect([c.points.length, c.duplicatePointRows]).toEqual([8, []])
    expect(await queueRows(service)).toEqual([])
    const ids = world.leagues.map((l) => l.id)
    const report = await reconcileSeason({ time: world.clock, db: service }, { season: CHAOS_SEASON, leagueIds: ids })
    expect(report.findings.filter((f) => f.severity === 'alert')).toEqual([])
    expect([report.leagues, report.cells]).toEqual([1, 4])
    const cli = runReconcileCli(ids)
    console.log(`[L.F2.3 drill 2] reconcile CLI exit ${cli.status}: ${JSON.stringify(cli.summary)}`)
    expect(cli.status, cli.stdout + cli.stderr).toBe(0)
    expect(cli.summary).toMatchObject({ leagues: 1, cells: 4, alerts: 0 })
  }, 150_000)
})
