/**
 * worker-crash-db.test.ts — M7 L.F2.3 DRILL 3: "crash a worker mid-batch
 * (idempotent re-run, no partial week)" (tasks-M7 §6 L.F2.3; delivery plan
 * :98; spec §22.2 / §22.3 "every job handler is idempotent … Edge Function
 * timeouts are absorbed by re-claiming" as built — 121's lease, 122's
 * deferral; §23.2 reconciliation; PROGRESS D763).
 *
 * The REAL ingest (`ingestWeek`) and the REAL score worker
 * (`runScoreWeekBatch`) over two leagues that start the same eight players,
 * so one drain is one batch across both. Each crash is injected at the
 * client seam (`crashingClient`) — nothing on the shared stack is stopped:
 *
 *   C1  the worker dies BEFORE league 2's score write leaves (league 1 is
 *       already written): league 1 whole, league 2 untouched, every queue
 *       row handed back; the re-run writes league 2 and changes nothing in
 *       league 1.
 *   C2  the worker dies AFTER both score writes committed but before its
 *       ack — and the release in its `finally` dies too (the process is
 *       gone): the rows stay leased; a restart inside the lease claims
 *       nothing (`all_leased`, named); one after the lease re-scores — no
 *       change — and drains the queue.
 *   C3  the ingest dies at its one-transaction door (lines + queue): no
 *       line and no queue row are written; the next poll writes them.
 *
 * Every arm ends on the stored-literal goldens, no duplicate point row, an
 * empty queue, and reconcile: in process (cells > 0, zero alerts) and the
 * CLI (`npm run reconcile`'s script), exit status 0.
 *
 * Requires the local stack (D59(5)); FAILS loudly when it is down.
 * Fixtures: `chaos-f23 crash …`, season 2072, `chaos_f23_crash_*` users —
 * swept before and after.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { SyncClient } from '@/lib/sync/types'

import { reconcileSeason } from '../scoring/reconcile'
import { CHAOS_SEASON, census, runReconcileCli, serviceClient, sweep } from './chaos-world'
import { crashingClient, WorkerCrash } from './faults'
import {
  T,
  at,
  buildScoringWorld,
  cellsOf,
  drain,
  finalLines,
  GOLDEN_SCORES,
  line,
  poll,
  queueRows,
  schedule,
  statRowCount,
  storedLine,
  type ScoringWorld,
} from './scoring-world'

const service = serviceClient()
/** A matchup row before its first score write (the column defaults). */
const UNSCORED = [
  [0, 0],
  [0, 0],
]
let world: ScoringWorld

beforeAll(async () => {
  await sweep(service)
  world = await buildScoringWorld(service, 'crash', 2)
}, 120_000)

afterAll(async () => {
  await sweep(service)
  expect(Object.values(await census(service)).every((n) => n === 0)).toBe(true)
}, 120_000)

describe('L.F2.3 drill 3 — a worker crashes mid-batch', () => {
  it('setup: one poll with every game final queues the eight players; nothing is scored yet', async () => {
    world.provider.games = schedule('final', 'final')
    world.provider.lines = finalLines()
    const r = await poll(world, world.provider, service as unknown as SyncClient, T.final)
    expect(r.ok).toBe(true)
    expect([r.stats.inserted, r.stats.enqueued]).toEqual([8, 8])
    expect((await queueRows(service)).length).toBe(8)
    for (const l of world.leagues) expect((await cellsOf(service, l)).scores).toEqual(UNSCORED)
  })

  it('C1 the worker dies BEFORE league 2\'s score write leaves: league 1 is whole, league 2 untouched, every row handed back', async () => {
    const { client, log } = crashingClient(service, [{ rpc: 'score_write_week_batch', mode: 'before', on: (n) => n === 2 }])
    await expect(drain(world, client, at(T.final, 0.1))).rejects.toBeInstanceOf(WorkerCrash)
    expect(log.crashes).toEqual(['score_write_week_batch #2 before'])
    const [first, second] = [await cellsOf(service, world.leagues[0]), await cellsOf(service, world.leagues[1])]
    // Which league the drain reached first is its sort order (ids); one is whole, the other has nothing.
    const written = [first, second].filter((c) => JSON.stringify(c.scores) === JSON.stringify(GOLDEN_SCORES))
    const untouched = [first, second].filter((c) => JSON.stringify(c.scores) === JSON.stringify(UNSCORED))
    expect([written.length, untouched.length]).toEqual([1, 1])
    // NO PARTIAL WEEK: the untouched league has no stored point row either.
    expect(untouched[0].points).toEqual([])
    expect(written[0].points).toHaveLength(8)
    // The finally's empty ack released the lease: all eight rows back, none leased.
    const q = await queueRows(service)
    expect([q.length, q.filter((r) => r.claim_token !== null).length]).toEqual([8, 0])
  })

  it('C1 re-run: the next drain writes league 2, changes nothing in league 1, and drains the queue', async () => {
    const r = await drain(world, service, at(T.final, 0.2))
    expect([r.written, r.no_change, r.failed, r.drained]).toEqual([1, 1, 0, 8])
    for (const l of world.leagues) {
      const c = await cellsOf(service, l)
      expect(c.scores).toEqual(GOLDEN_SCORES)
      expect([c.points.length, c.duplicatePointRows]).toEqual([8, []])
    }
    expect(await queueRows(service)).toEqual([])
  })

  it('C2 a late live delta, then the worker dies AFTER both writes committed — and its release dies too: the rows stay leased', async () => {
    // WR4's line moves 77 → 87 (+1.00): a real delta, one queue row.
    world.provider.lines = [...finalLines().filter((l) => !l.playerId.endsWith('wr4')), line('wr4', { receiving_yards: 87 })]
    const r = await poll(world, world.provider, service as unknown as SyncClient, at(T.final, 1))
    expect([r.stats.updated, r.stats.enqueued]).toEqual([1, 1])
    const { client, log } = crashingClient(service, [
      { rpc: 'score_write_week_batch', mode: 'after', on: (n) => n === 2 },
      { rpc: 'score_fanout_ack', mode: 'before', on: () => true },
    ])
    await expect(drain(world, client, at(T.final, 1.01))).rejects.toBeInstanceOf(WorkerCrash)
    expect(log.crashes).toEqual(['score_write_week_batch #2 after', 'score_fanout_ack #1 before'])
    // Both writes reached the database before the crash: Team 4 = 7.90 everywhere.
    for (const l of world.leagues) expect((await cellsOf(service, l)).scores).toEqual([[21, 26], [7.8, 7.9]])
    const q = await queueRows(service)
    expect(q.map((x) => [x.player_id.endsWith('wr4'), x.claim_token !== null])).toEqual([[true, true]])
  })

  it('C2 a restart INSIDE the lease claims nothing and says why (all_leased) — never an empty success', async () => {
    const r = await drain(world, service, at(T.final, 1.02))
    expect([r.claimed, r.reason]).toEqual([0, 'all_leased'])
    expect(r.problems.join(' ')).toContain('leased by another drain 1')
  })

  it('C2 a restart AFTER the lease (120 s) re-claims, re-scores to no change, and drains', async () => {
    const r = await drain(world, service, at(T.final, 1.01 + 125 / 3600))
    expect([r.claimed, r.written, r.no_change, r.drained]).toEqual([1, 0, 2, 1])
    for (const l of world.leagues) {
      const c = await cellsOf(service, l)
      expect(c.scores).toEqual([[21, 26], [7.8, 7.9]])
      expect(c.duplicatePointRows).toEqual([])
    }
    expect(await queueRows(service)).toEqual([])
  })

  it('C3 the ingest dies at its one-transaction door: no line moves and no queue row is written; the next poll heals it', async () => {
    // Back to the final line (87 → 77).
    world.provider.lines = finalLines()
    const before = [await statRowCount(service), (await storedLine(service, 'wr4'))?.receiving_yards]
    const { client, log } = crashingClient(service, [{ rpc: 'ingest_write_batch', mode: 'before', on: () => true }])
    await expect(poll(world, world.provider, client as unknown as SyncClient, at(T.final, 2))).rejects.toBeInstanceOf(WorkerCrash)
    expect(log.crashes).toEqual(['ingest_write_batch #1 before'])
    expect([await statRowCount(service), (await storedLine(service, 'wr4'))?.receiving_yards]).toEqual(before)
    expect(await queueRows(service)).toEqual([])
    const healed = await poll(world, world.provider, service as unknown as SyncClient, at(T.final, 2.01))
    expect([healed.ok, healed.stats.updated, healed.stats.enqueued]).toEqual([true, 1, 1])
    const r = await drain(world, service, at(T.final, 2.02))
    expect([r.written, r.drained]).toEqual([2, 1])
    for (const l of world.leagues) expect((await cellsOf(service, l)).scores).toEqual(GOLDEN_SCORES)
  })

  it('END reconcile is clean: in process (every cell compared, zero alerts) and the CLI exits 0', async () => {
    const ids = world.leagues.map((l) => l.id)
    const report = await reconcileSeason({ time: world.clock, db: service }, { season: CHAOS_SEASON, leagueIds: ids })
    expect(report.findings.filter((f) => f.severity === 'alert')).toEqual([])
    expect([report.leagues, report.cells]).toEqual([2, 8])
    const cli = runReconcileCli(ids)
    console.log(`[L.F2.3 drill 3] reconcile CLI exit ${cli.status}: ${JSON.stringify(cli.summary)}`)
    expect(cli.status, cli.stdout + cli.stderr).toBe(0)
    expect(cli.summary).toMatchObject({ leagues: 2, cells: 8, alerts: 0 })
  }, 150_000)
})
